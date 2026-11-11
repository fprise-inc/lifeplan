// 会社と合わせたバランスシート（合算BS。同梱の公式の拡張 ext.official.combinedBs。0107・0114）の部品と、提案書の拡張の章
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Ajv2020 } from "ajv/dist/2020.js";
import { describe, expect, it } from "vitest";
import { buildProposalInput } from "../src/build.ts";
import { CHAPTER_IDS, selectChapters, type ChapterId } from "../src/chapters.ts";
import type { BsAt } from "../src/bsGroups.ts";
import { combinedBs, monthsGuideText, readCombinedInput, type CombinedBsInput, type CombinedHousehold } from "../../sdk/examples/extensions/combined-bs/parts/combinedBs.ts";
import { chapter, type CombinedBsChapter } from "../../sdk/examples/extensions/combined-bs/parts/chapter.ts";
import { renderAndExtract, reportPdfBin, sampleFrame } from "../scripts/reportPdf.ts";
import { salariedCoupleBundle } from "../scripts/sampleBundles.ts";
import { REPORT_DIR } from "../scripts/engine.ts";
import { normalize } from "./helpers.ts";

const M = 10000;
const schema = JSON.parse(readFileSync(join(REPORT_DIR, "schema", "proposal-input.schema.json"), "utf8")) as object;
const validate = new Ajv2020({ allErrors: true, strict: true }).compile(schema);

/** 架空の例: 経営者個人は預金3,000万・自宅4,000万（土地・建物）・自社株1,000万・会社への貸付金800万／住宅ローン2,500万、保証5,000万 */
const at: BsAt = {
  year: 2026,
  lines: [
    { key: "deposit", label: "預金", group: "liquid", amount: 3000 * M },
    { key: "land", label: "土地", group: "illiquid", amount: 2500 * M },
    { key: "building", label: "建物", group: "illiquid", amount: 1500 * M },
    { key: "ownShares", label: "自社株（出資額）", group: "illiquid", amount: 1000 * M },
    { key: "loanToCompany", label: "会社への貸付金", group: "illiquid", amount: 800 * M },
    { key: "mortgage", label: "住宅ローン", group: "mortgage", amount: 2500 * M },
  ],
  totalAssets: 8800 * M,
  totalLiabilities: 2500 * M,
  netWorth: 6300 * M,
  financial: 3000 * M,
  shortfall: 0,
};
const household: CombinedHousehold = { at, monthly: 55 * M, guarantee: 5000 * M };
/** 会社: 現預金2,000万・ほか6,000万／借入金5,000万・ほか1,500万（経営者からの借入金800万を含む）・資本金1,000万・剰余金500万 */
const company: CombinedBsInput = {
  version: 1,
  asOf: "2026-09",
  amounts: {
    cash: 2000 * M,
    receivables: 1500 * M,
    inventory: 800 * M,
    otherCurrent: 200 * M,
    land: 1500 * M,
    buildings: 1200 * M,
    investments: 500 * M,
    otherFixed: 300 * M,
    shortDebt: 1000 * M,
    longDebt: 4000 * M,
    loanFromOwner: 800 * M,
    otherLiabilities: 700 * M,
    capital: 1000 * M,
    retained: 500 * M,
    monthlyFixed: 420 * M,
    monthlyLoanPay: 80 * M,
  },
  stage: "stable",
  ownerMonthly: 60 * M,
  restated: {},
  useRestated: false,
};

describe("合算BS の部品", () => {
  const r = combinedBs(company, household);
  it("①並べる: 家計と会社のそれぞれで、資産＝負債＋純資産", () => {
    expect(r.side[0].netWorth).toBe(6300 * M);
    expect(r.side[1].totalAssets).toBe(8000 * M);
    expect(r.side[1].totalLiabilities).toBe(6500 * M);
    expect(r.side[1].netWorth).toBe(1500 * M);
    expect(r.asOfLabel).toBe("2026年9月末");
  });
  it("②相殺: 自社株↔資本金・会社への貸付金↔経営者からの借入金を両側から消す。合わせた財産の合計は変わらない", () => {
    expect(r.pairs.map((p) => [p.key, p.owner / M, p.company / M])).toEqual([
      ["shares", 1000, 1000],
      ["loanToCompany", 800, 800],
      ["loanFromCompany", 0, 0],
      ["unpaid", 0, 0],
    ]);
    expect(r.netted[0].lines.some((l) => l.key === "ownShares" || l.key === "loanToCompany")).toBe(false);
    expect(r.netted[1].lines.some((l) => l.key === "co-loanFromOwner")).toBe(false);
  });
  it("③合算: 資産1億5,000万・負債8,200万・純資産6,800万＝会社の財産（剰余金）500万＋個人の財産6,300万", () => {
    expect(r.combined.totalAssets).toBe(15000 * M);
    expect(r.combined.totalLiabilities).toBe(8200 * M);
    expect(r.netWorth).toEqual({ company: 500 * M, others: 0, owner: 6300 * M, total: 6800 * M });
    expect(r.combined.netParts?.map((p) => [p.label, p.amount / M])).toEqual([
      ["会社の財産（剰余金）", 500],
      ["個人の財産", 6300],
    ]);
    expect(r.scale).toBe(15000 * M);
  });
  it("指標: 現預金 ÷ 毎月の固定の支出（総合・個人・会社）。目安に届かないときは段で目指す", () => {
    expect(r.indicators.map((x) => [x.key, x.months])).toEqual([
      ["total", 8.9],
      ["owner", 50],
      ["company", 4],
    ]);
    expect(r.indicators[2]?.text).toBe("目安の6か月分より少なめです。まず6か月分を目指しましょう。");
    expect(monthsGuideText(2)).toContain("まず3か月分");
    expect(monthsGuideText(13)).toContain("12か月分にも届いて");
  });
  it("段階の1文・連帯保証のお知らせ（組が合っていれば組のお知らせは出ない）", () => {
    expect(r.stage?.label).toBe("安定成長期");
    expect(r.notices).toEqual(["経営者の連帯保証（5,000万円）は、会社の借入金として合算の負債に入っているので、二重には数えません。"]);
  });
  it("組の額が合わない・片方にしか載っていないときは、会社の側に合わせてお知らせ。差は個人の財産に入る", () => {
    const x = combinedBs({ ...company, amounts: { ...company.amounts, advanceToOwner: 100 * M, cash: 1900 * M } }, { ...household, at: { ...at, lines: at.lines.filter((l) => l.key !== "loanToCompany"), totalAssets: 8000 * M, netWorth: 5500 * M } });
    expect(x.notices.filter((n) => n.includes("片方にしか載っていません")).length).toBe(2);
    // 家計の書き漏れ（会社への貸付金800万）は、会社の側に合わせて個人の財産に入れ、立替金100万は経営者の未払金として個人の財産から引く
    expect(x.netWorth.owner).toBe((5500 + 800 - 100) * M);
    expect(x.combined.totalAssets - x.combined.totalLiabilities).toBe(x.netWorth.total);
  });
  it("実力に直した額: 直した額で並べると、会社の財産（剰余金）が変わり、保証している債務は負債に足す", () => {
    const x = combinedBs({ ...company, restated: { receivables: 1200 * M, guaranteed: 100 * M }, useRestated: true }, household);
    expect(x.side[1].name).toBe("会社（直した額）");
    expect(x.netWorth.company).toBe((500 - 300 - 100) * M);
    expect(x.restated.rows.map((r) => [r.label, r.book, r.adjusted])).toEqual([
      ["売上債権", 1500 * M, 1200 * M],
      ["会社が保証している債務", null, 100 * M],
    ]);
    // 直した額で並べないときは帳簿の額のまま
    expect(combinedBs({ ...company, restated: { receivables: 1200 * M } }, household).netWorth.company).toBe(500 * M);
  });
  it("世帯ファイルの値を読む: 形の合わない所は捨て、何も無ければ null", () => {
    expect(readCombinedInput(null)).toBeNull();
    expect(readCombinedInput({ amounts: { cash: -1, retained: -5 * M, nope: 3 }, stage: "x", asOf: "2026-13" })).toEqual({ version: 1, asOf: null, amounts: { retained: -5 * M }, stage: null, ownerMonthly: null, restated: {}, useRestated: false });
    expect(readCombinedInput({ amounts: {} })).toBeNull();
    expect(readCombinedInput(company)).toEqual(company);
  });
});

describe("提案書の章（会社と合わせたバランスシート）", () => {
  const ID = "ext.official.combinedBs";
  const material = chapter({ values: { [ID]: company as unknown as Record<string, unknown> }, balance: { now: household } }) as CombinedBsChapter;
  const bundle = { ...salariedCoupleBundle(), chapters: [...CHAPTER_IDS, ID] as ChapterId[], extensions: { [ID]: material as unknown as Record<string, unknown> } };
  const input = buildProposalInput(bundle);
  const cb = () => input.extensions?.[ID] as CombinedBsChapter | undefined;
  it("材料があれば載り、JSON Schema に合う。章を外すと材料を渡さない", () => {
    expect(cb()?.figure.columns.map((c) => c.name)).toEqual(["経営者個人（家計）", "会社", "合算（経営者個人＋会社）"]);
    expect(cb()?.figure.columns[2]?.liabilities.map((b) => b.label)).toEqual(["住宅ローン", "借入金など", "会社の財産", "個人の財産"]);
    expect(validate(input), JSON.stringify(validate.errors)).toBe(true);
    expect(selectChapters(input, ["summary"]).extensions).toBeNull();
    expect(buildProposalInput(salariedCoupleBundle()).extensions).toBeNull();
  });
  it("拡張の章は「提案での変更点」の後・「プランの比較」の前に並ぶ。会社の数字が無ければ材料を作らない", () => {
    const ids = input.chapters ?? [];
    expect(ids.indexOf(ID)).toBe(ids.indexOf("changes") + 1);
    expect(ids.indexOf("comparison")).toBe(ids.indexOf(ID) + 1);
    expect(chapter({ values: { [ID]: null }, balance: { now: household } })).toBeNull();
    expect(chapter({ values: { [ID]: company as unknown as Record<string, unknown> } })).toBeNull();
  });
  it("見本の世帯でだけ載せた章（0197）: 材料のある章の id だけを extensionSamples に渡し、章を外すと印も外す。印が無ければ null", () => {
    expect(input.extensionSamples).toBeNull();
    const sample = buildProposalInput({ ...bundle, extensionSamples: [ID, ID, "ext.official.nope"] });
    expect(sample.extensionSamples).toEqual([ID]);
    expect(validate(sample), JSON.stringify(validate.errors)).toBe(true);
    expect(selectChapters(sample, ["summary"]).extensionSamples).toBeNull();
    expect(buildProposalInput({ ...salariedCoupleBundle(), extensionSamples: [ID] }).extensionSamples).toBeNull();
  });
  const bin = reportPdfBin();
  it.skipIf(bin === null)("見本の世帯でだけ載せた章は、見出しの下に「見本」の印が付く（0197）。印の無い章には付かない", () => {
    const sample = buildProposalInput({ ...bundle, extensionSamples: [ID] });
    const pages = (b: typeof input) => renderAndExtract(bin as string, b, sampleFrame(bundle, b)).pages.map(normalize);
    const mark = normalize("機能を有効にするコードが無くても載せています");
    const withMark = pages(sample);
    const start = withMark.findIndex((p) => p.includes(normalize("相殺した4つの組")));
    expect(withMark[start]).toContain(mark);
    expect(withMark.filter((p) => p.includes(mark))).toHaveLength(1);
    expect(pages(input).some((p) => p.includes(mark))).toBe(false);
  });
  it.skipIf(bin === null)("PDF に章の見出し・3枚の図・相殺の組・何か月分・段階の1文が載る", () => {
    const r = renderAndExtract(bin as string, input, sampleFrame(bundle, input));
    // 章は1〜2ページ（見出しのページから最後まで）
    const start = r.pages.findIndex((p) => normalize(p).includes(normalize("相殺した4つの組")));
    expect(start).toBeGreaterThan(0);
    const t = normalize(r.pages.slice(start).join("\n"));
    for (const s of ["経営者個人（家計）", "合算（経営者個人＋会社）", "会社の財産", "個人の財産", "自社株と資本金", "8.9か月分", "安定成長期", "6,800万円"]) expect(t, s).toContain(normalize(s));
  });
});

describe("提案書のバランスシートの図の注（会社の借入の連帯保証。0107）", () => {
  it("保証のある世帯だけ、今の額と保証を含めた今の純資産を1行の注に。保証の無い世帯は欄を持たない", () => {
    const b = salariedCoupleBundle();
    const withG = structuredClone(b);
    const m = withG.proposal.request.input.household.members[0] as { companyGuarantee?: unknown };
    m.companyGuarantee = { value: 30_000_000, state: "confirmed", origin: { kind: "manual" } };
    const input = buildProposalInput(withG);
    const now = input.balanceSheet?.figure.columns.find((c) => c.fact)?.netWorth ?? 0;
    expect(input.balanceSheet?.guarantee).toEqual({ amount: 30_000_000, netWorthWith: now - 30_000_000 });
    expect(validate(input), JSON.stringify(validate.errors)).toBe(true);
    expect(buildProposalInput(b).balanceSheet?.guarantee).toBeUndefined();
  });
});
