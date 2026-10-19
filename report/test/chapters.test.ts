// 章の選び方と案の比較のページ（帳票の入力の組み立て）
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Ajv2020 } from "ajv/dist/2020.js";
import { describe, expect, it } from "vitest";
import { buildProposalInput, comparisonMetrics, displayYears } from "../src/build.ts";
import { CHAPTERS, hasMaterial, selectChapters, type ChapterId } from "../src/chapters.ts";
import { REPORT_DIR } from "../scripts/engine.ts";
import { salariedCoupleBundle } from "../scripts/sampleBundles.ts";

const schema = JSON.parse(readFileSync(join(REPORT_DIR, "schema", "proposal-input.schema.json"), "utf8")) as object;
const validate = new Ajv2020({ allErrors: true, strict: true }).compile(schema);
const bundle = salariedCoupleBundle();
const full = buildProposalInput(bundle);

describe("章を選ぶ", () => {
  it("省略はすべての章（chapters の欄を持たない）。材料はそろっている", () => {
    expect(full.chapters).toBeUndefined();
    for (const c of CHAPTERS) expect(hasMaterial(full, c.id), c.id).toBe(true);
  });

  it("外した章の材料は帳票に渡さない。外せない章は残る。JSON Schema に合う", () => {
    const chosen: ChapterId[] = ["summary", "cashflow", "changes"];
    const input = selectChapters(full, chosen);
    expect(input.chapters).toEqual(["cover", "assumptions", "summary", "cashflow", "changes"]);
    expect(input.education).toBeNull();
    expect(input.housingLoan).toBeNull();
    expect(input.retirement).toBeNull();
    expect(input.contingency).toBeNull();
    expect(input.insurance).toBeNull();
    expect(input.comparison).toBeNull();
    expect(input.events).toEqual([]);
    // 外さない章の数字は変わらない
    expect(input.cashflow).toEqual(full.cashflow);
    expect(input.summary).toEqual(full.summary);
    expect(validate(input), JSON.stringify(validate.errors)).toBe(true);
  });

  it("組み立ての材料（bundle.chapters）で選んでも同じ", () => {
    const chosen: ChapterId[] = ["summary", "retirement", "comparison"];
    expect(buildProposalInput({ ...bundle, chapters: chosen })).toEqual(selectChapters(full, chosen));
  });
});

describe("プランの比較のページ", () => {
  const c = full.comparison;
  it("列は現状とプラン、基準の列は差を持たない。JSON Schema に合う", () => {
    expect(validate(full), JSON.stringify(validate.errors)).toBe(true);
    expect(c?.columns.map((x) => x.letter)).toEqual(["A", "B", "C"]);
    expect(c?.base).toBe(0);
    for (const r of c?.rows ?? []) expect(r.diffs[0]).toBeNull();
  });

  it("数字は主画面の比較の表と同じ決め方（エンジンの出力の表から）で、差は「そのプラン−基準」", () => {
    const years = displayYears(bundle.proposal.request);
    const ms = (bundle.comparison?.plans ?? []).map((p) => comparisonMetrics(p.run, years, full.summary.target.year));
    const row = (k: string) => c?.rows.find((r) => r.key === k);
    expect(row("target")?.values).toEqual(ms.map((m) => m.target));
    expect(row("takeHome")?.values).toEqual(ms.map((m) => m.takeHome));
    expect(row("expense")?.values).toEqual(ms.map((m) => m.expense));
    expect(row("min")?.values).toEqual(ms.map((m) => m.min.amount));
    expect(row("min")?.years).toEqual(ms.map((m) => m.min.year));
    expect(row("target")?.diffs).toEqual(ms.map((m, i) => (i === 0 ? null : m.target - (ms[0]?.target ?? 0))));
    // 提案の列の目標の年の金融資産は、変更点の章の「提案」と同じ
    expect(row("target")?.values[2]).toBe(full.summary.proposal.financialAtTarget);
    expect(row("target")?.values[0]).toBe(full.summary.current.financialAtTarget);
  });

  it("プランが1つだけなら比較のページを作らない", () => {
    const one = buildProposalInput({ ...bundle, comparison: { base: 0, plans: (bundle.comparison?.plans ?? []).slice(0, 1) } });
    expect(one.comparison).toBeNull();
    expect(hasMaterial(one, "comparison")).toBe(false);
  });
});

describe("帳票の組み方（紙の向き・キャッシュフロー表の載せ方）", () => {
  it("省略は縦にそろえる・要約。指定はそのまま渡る。JSON Schema に合う", () => {
    expect(full.layout).toEqual({ orientation: "portrait", cashflow: "summary" });
    const land = buildProposalInput({ ...bundle, layout: { orientation: "landscape", cashflow: "excerpt" } });
    expect(land.layout).toEqual({ orientation: "landscape", cashflow: "excerpt" });
    expect(validate(land), JSON.stringify(validate.errors)).toBe(true);
    expect(validate({ ...land, layout: { orientation: "sideways", cashflow: "full" } })).toBe(false);
  });
});
