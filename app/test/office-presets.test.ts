// 0111 の2回目: コードの中の目安（hearing/src/presets.ts と engine/src/sdk/estimates.ts の一覧）を事務所の推定の値で上書きする
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { forEngine } from "../src/engine/moneyRows.ts";
import { officeEstimateNoFill, officeEstimateValues } from "../src/engine/officeValues.ts";
import type { EngineRequest, PreviewResult } from "../src/engine/types.ts";
import { PRESETS, presetValue } from "../../hearing/src/presets.ts";
import { ENGINE_PRESETS } from "../../engine/src/sdk/estimates.ts";
import { CAR_ESTIMATE } from "../../hearing/src/estimates.ts";
import { estimateEntries, estimateEntry, formatNumber, officialEstimate, parseNumber, searchEstimates } from "../src/workspace/office/estimateCatalog.ts";
import { basisOf, EMPTY_ESTIMATES, engineNoFillOf, engineValuesOf, keepOfficeValue, officialUpdates, publishOfficeEstimates, readOfficeEstimates, withNoFill, withOfficeValue, type OfficeEstimates } from "../src/workspace/office/estimates.ts";
import { previewOfficeChange } from "../src/workspace/office/estimatePreview.ts";
import { blankHousehold, type WorkingHousehold } from "../src/workspace/input/household.ts";
import { withRefreshedEstimates } from "../src/workspace/input/estimates.ts";
import { gapsOf } from "../src/workspace/input/fill.ts";
import { VALUATION_DEFAULTS } from "../src/workspace/input/labels.ts";
import { modelHousehold, realEngine } from "./helpers.ts";

afterEach(() => publishOfficeEstimates(undefined));

const ON = "2026-11-02";
const RENT = "preset.housing.rent";
const LAND = "preset.realEstate.landShare";

function run(req: EngineRequest): PreviewResult {
  const { engine, packs } = realEngine();
  const out = JSON.parse(engine.runBatch(JSON.stringify([req]), packs, '{"preview":true}')) as (PreviewResult & { error?: { code: string } })[];
  const r = out[0] as PreviewResult & { error?: { code: string } };
  if (r.error !== undefined) throw new Error(JSON.stringify(r.error));
  return r;
}
const total = (r: PreviewResult, prefix: string) => r.table.filter((c) => c.row.startsWith(prefix)).reduce((s, c) => s + c.amount, 0);
const wh = (req: EngineRequest): WorkingHousehold => ({ ...blankHousehold("2026-10"), request: req });

describe("コードの中の目安の一覧", () => {
  it("値ID は preset. で始まり重ならず、画面の一覧に名前・まとまり・出典・効く所つきで載る", () => {
    const ids = PRESETS.map((d) => d.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const d of PRESETS) {
      expect(d.id.startsWith("preset.")).toBe(true);
      const e = estimateEntry(d.id);
      expect(e?.source).toBe("preset");
      expect(e?.name).toBe(d.name);
      expect(e?.use).toBe(d.use);
      expect(officialEstimate(d.id)).toMatchObject({ value: d.value, rev: d.rev, title: d.source });
    }
    // エンジンが引く目安も同じ一覧に入る（値を書く所はエンジンの1か所）
    for (const d of ENGINE_PRESETS) expect(ids).toContain(d.id);
    expect(estimateEntries().filter((e) => e.source === "preset")).toHaveLength(PRESETS.length);
    expect(searchEstimates("家賃").map((e) => e.id)).toContain(RENT);
  });

  it("コードで引いている目安の値ID は、どれも一覧にある（打ち間違いが無い）", () => {
    const roots = [join(import.meta.dirname, "../src"), join(import.meta.dirname, "../../hearing/src"), join(import.meta.dirname, "../../engine/src")];
    const files: string[] = [];
    const walk = (d: string) => {
      for (const f of readdirSync(d)) {
        const p = join(d, f);
        if (statSync(p).isDirectory()) {
          if (f !== "generated" && f !== "node_modules") walk(p);
        } else if (/\.(ts|tsx)$/.test(f)) files.push(p);
      }
    };
    roots.forEach(walk);
    const known = new Set(PRESETS.map((d) => d.id));
    const used = new Set<string>();
    for (const f of files) for (const m of readFileSync(f, "utf8").matchAll(/"(preset\.[A-Za-z0-9.]+)"/g)) used.add(m[1] as string);
    // 型を組み立てて引く値ID（preset.wage.provisional.<働き方>.<性別>.* ・ preset.living.annual.<key> ・ preset.invest.<種類>.* ・ preset.loan.outlook.<型>.*）は一覧から数える
    const missing = [...used].filter((id) => !known.has(id) && !id.endsWith("."));
    expect(missing).toEqual([]);
    expect(used.size).toBeGreaterThan(60);
  });

  it("集め直す前の値と同じ（結果を変えない）", () => {
    expect(presetValue(RENT)).toBe(80000);
    expect(VALUATION_DEFAULTS).toEqual({ landShare: "0.3", residualFloor: "0.2", saleCostRate: "0.04" });
    expect(CAR_ESTIMATE.price.value).toBe(2500000);
    expect(CAR_ESTIMATE.keepYears.value).toBe(13);
  });

  it("単位の読み方（歳・日・年数・時間は整数、％は率の文字）", () => {
    expect(parseNumber("age", "65歳")).toBe(65);
    expect(parseNumber("days", "90")).toBe(90);
    expect(parseNumber("yearCount", "1.5")).toBeUndefined();
    expect(parseNumber("pct", "-1")).toBe("-0.01");
    expect(formatNumber("days", 60)).toBe("60日");
    expect(formatNumber("age", 60)).toBe("60歳");
  });
});

describe("事務所の値が画面の目安に効く", () => {
  it("家賃の目安が事務所の値と根拠の文になる（書いた文はそのまま、自動の文には年月が付く）", () => {
    publishOfficeEstimates(withOfficeValue(EMPTY_ESTIMATES, RENT, 95000, "当事務所の地域の相場", ON));
    const w = blankHousehold("2026-10");
    const gap = gapsOf(w).find((g) => g.id === "housing");
    // 事務所の値から作った推定の根拠は、書いた文そのもの（年月を付けない・ほかの文を足さない）
    expect(gap?.basis).toBe("当事務所の地域の相場");
    const fill = gap?.fill;
    if (fill === undefined) throw new Error("住居費の「目安で入れる」が無い");
    const filled = fill(w);
    expect(filled.request.input.household.residences?.[0]?.rent?.monthly).toMatchObject({ value: 95000, state: "estimated" });
    publishOfficeEstimates(withOfficeValue(EMPTY_ESTIMATES, RENT, 95000, "  ", ON));
    expect(gapsOf(blankHousehold("2026-10")).find((g) => g.id === "housing")?.basis).toBe("事務所の目安（2026年11月）");
  });

  it("推定のままの値（車の目安）は入れ直しで新しい値になり、世帯で入れた値は変わらない（世帯ごとの上書きが優先）", () => {
    publishOfficeEstimates(withOfficeValue(EMPTY_ESTIMATES, "preset.car.price", 3000000, null, ON));
    expect(CAR_ESTIMATE.price).toEqual({ value: 3000000, basis: "事務所の目安（2026年11月）" });
    const req = modelHousehold("salariedCoupleTwoKids");
    const confirmed = structuredClone(req);
    const l = confirmed.input.household.livingExpenses?.[0];
    if (l !== undefined) l.monthly = { value: 333000, state: "confirmed", origin: { kind: "manual" } };
    const after = withRefreshedEstimates(wh(confirmed));
    expect(after.request.input.household.livingExpenses?.[0]?.monthly).toEqual({ value: 333000, state: "confirmed", origin: { kind: "manual" } });
  });
});

describe("事務所の値がエンジンが引く目安に効く（画面とエンジンで同じ値）", () => {
  it("エンジンが引く目安は estimateValues で渡り、画面の欄の既定も同じ値。画面だけの目安は渡さない", () => {
    const e = withOfficeValue(withOfficeValue(EMPTY_ESTIMATES, LAND, "0.6", null, ON), RENT, 95000, null, ON);
    publishOfficeEstimates(e);
    expect(engineValuesOf(e)).toEqual({ [LAND]: "0.6" });
    expect(officeEstimateValues()).toEqual({ [LAND]: "0.6" });
    expect(VALUATION_DEFAULTS.landShare).toBe("0.6");
    const req = modelHousehold("housingPurchase");
    const sent = forEngine(req);
    expect(sent.input.estimateValues).toEqual({ [LAND]: "0.6" });
    expect(req.input.estimateValues).toBeUndefined();
    publishOfficeEstimates(undefined);
    expect(JSON.stringify(run(sent).table)).not.toEqual(JSON.stringify(run(forEngine(req)).table));
  });

  it("エンジンの一覧に無い値ID・法令の値はエンジンが断る", () => {
    const req = modelHousehold("parentCare");
    expect(() => run({ ...req, input: { ...req.input, estimateValues: { [RENT]: 95000 } } })).toThrow("E_ARGUMENT");
    expect(() => run({ ...req, input: { ...req.input, estimateValues: { "incomeTax.basicDeduction": 0 } } })).toThrow("E_ARGUMENT");
  });
});

describe("公式の値が新しくなったとき（目安の版・値）", () => {
  const older = (bumpRev: boolean): OfficeEstimates => {
    const e = withOfficeValue(EMPTY_ESTIMATES, RENT, 95000, null, "2026-01-10");
    const v = e.values[RENT]!;
    return { ...e, values: { [RENT]: { ...v, officialRev: bumpRev ? v.officialRev - 1 : v.officialRev, officialValue: 70000 } } };
  };
  it("版が進んだか、値そのものが変わっていれば知らせる（「このまま」で消える）", () => {
    expect(officialUpdates(older(true))).toEqual([{ id: RENT, name: estimateEntry(RENT)?.name, change: "70,000円 → 80,000円", broken: false, rev: 1 }]);
    // 版を上げ忘れても、値が変わっていれば知らせる
    expect(officialUpdates(older(false))).toHaveLength(1);
    expect(officialUpdates(keepOfficeValue(older(true), RENT))).toEqual([]);
  });
});

describe("代表の世帯で差を見る（エンジンが引く目安）", () => {
  it("遺族の生活費の割合を変える前に、見本の世帯で差を見られる", async () => {
    const { engine, packs } = realEngine();
    const deps = {
      open: async (id: string) => modelHousehold(id),
      compute: async (reqs: readonly EngineRequest[]) => (JSON.parse(engine.runBatch(JSON.stringify(reqs), packs, '{"preview":true}')) as PreviewResult[]).map((r) => ((r as { error?: unknown }).error === undefined ? r : null)),
    };
    const more = withOfficeValue(EMPTY_ESTIMATES, "preset.realEstate.saleCostRate", "0.1", null, ON);
    const rows = await previewOfficeChange(deps, EMPTY_ESTIMATES, more);
    expect(rows).toHaveLength(3);
    const same = await previewOfficeChange(deps, more, more);
    expect(same.every((r) => !r.changed)).toBe(true);
    expect(officeEstimateValues()).toBeNull();
  });
});

describe("推定で埋めない（エンジンが引く統計の目安）", () => {
  it("選んだ目安は計算の要求の estimateNoFill で渡り、介護の空欄は0円になる", () => {
    const e = withNoFill(EMPTY_ESTIMATES, "engine.care", true);
    expect(engineNoFillOf(e)).toEqual(["care"]);
    // 事務所データから読むときも、知っている欄だけ
    expect(readOfficeEstimates({ values: {}, noFill: ["engine.care", "engine.rent"] }).noFill).toEqual(["engine.care"]);
    const req = modelHousehold("parentCare");
    const base = run(forEngine(req));
    publishOfficeEstimates(e);
    expect(officeEstimateNoFill()).toEqual(["care"]);
    const sent = forEngine(req);
    expect(sent.input.estimateNoFill).toEqual(["care"]);
    expect(req.input.estimateNoFill).toBeUndefined();
    expect(total(run(sent), "cf.expense.care")).toBeLessThan(total(base, "cf.expense.care"));
  });

  it("根拠の文は空にならない（目安も同じ決まり）", () => {
    const e = withOfficeValue(EMPTY_ESTIMATES, RENT, 95000, "\n", ON);
    expect(basisOf(e.values[RENT]!)).toBe("事務所の目安（2026年11月）");
  });
});

describe("控え（計算に使った事務所の推定の値を写す）", () => {
  it("控えの要求に、その時点の事務所の値と推定で埋めない目安が入る（世帯の要求には入れない）", async () => {
    const { makeSnapshot } = await import("../src/workspace/snapshots/snapshots.ts");
    const w = wh(modelHousehold("parentCare"));
    const draft = { trigger: "manual" as const, memo: "", plan: null };
    const plain = await makeSnapshot({ wh: w, drafts: {}, draft, appVersion: "0", id: "a" });
    expect(plain.inputs.request.input.estimateValues).toBeUndefined();
    publishOfficeEstimates(withNoFill(withOfficeValue(EMPTY_ESTIMATES, "care.statistics.months", 120, null, ON), "engine.care", true));
    const s = await makeSnapshot({ wh: w, drafts: {}, draft, appVersion: "0", id: "b" });
    expect(s.inputs.request.input.estimateValues).toEqual({ "care.statistics.months": 120 });
    expect(s.inputs.request.input.estimateNoFill).toEqual(["care"]);
    expect(w.request.input.estimateValues).toBeUndefined();
    // 後で事務所の値を外しても、控えから計算し直すと控えの時点の値で計算する
    const shown = run(forEngine(s.inputs.request));
    publishOfficeEstimates(undefined);
    expect(run(forEngine(s.inputs.request)).table).toEqual(shown.table);
  });
});
