// 会社と合わせたバランスシート（合算BS。法人の顧問向けの機能。0108）: 事務所の設定で使うと決めたときだけ、役員として働く人のいる世帯に出す。
// 見せ方だけで計算の結果は変えない。時点を並べる・プランを比較でも、連帯保証の点線の箱は今の年の図の下にだけ出す
import { describe, expect, it } from "vitest";
import { h } from "preact";
import { renderToString } from "preact-render-to-string";
import { BalanceTab } from "../src/presentation/BalanceTab.tsx";
import { balanceTabModel, bsPlan, defaultGuideBasis, DEFAULT_BS_GUIDE, DEFAULT_BS_POINTS } from "../src/workspace/balanceTab.ts";
import { combinedBsView, manTextToYen, withCombinedField, yenToManText } from "../src/workspace/combined/combinedView.ts";
import { DEFAULT_OFFICE_SETTINGS, isDefaultSettings, readOfficeSettings } from "../src/workspace/office/settings.ts";
import { executiveMembers } from "../src/workspace/input/officer.ts";
import type { CombinedBsInput } from "../../report/src/index.ts";
import type { EngineRequest } from "../src/engine/types.ts";
import { modelHousehold, preview } from "./helpers.ts";

const noop = () => undefined;
const M = 10000;
const box = (v: number) => ({ value: v, state: "confirmed", origin: { kind: "manual" } }) as never;

/** 役員のモデル世帯に、自社株（出資額）1,000万・会社への貸付金800万・保証5,000万を足す */
function executiveReq(): EngineRequest {
  const req = modelHousehold("executiveOwner");
  const hh = req.input.household;
  const officer = executiveMembers(hh)[0]!;
  hh.accounts = [
    ...(hh.accounts ?? []),
    { id: "00000000-0000-4000-8000-000000010701", kind: "otherAsset", subtype: "ownCompanyShares", owner: officer.id, marketValue: box(1000 * M), asOf: req.input.baseMonth, contributions: [] },
    { id: "00000000-0000-4000-8000-000000010702", kind: "otherAsset", subtype: "loanToCompany", owner: officer.id, marketValue: box(800 * M), asOf: req.input.baseMonth, contributions: [] },
  ] as never;
  hh.members = hh.members.map((m) => (m.id === officer.id ? { ...m, companyGuarantee: box(5000 * M) } : m));
  return req;
}

const company: CombinedBsInput = {
  version: 1,
  asOf: "2026-09",
  amounts: { cash: 2000 * M, receivables: 1500 * M, inventory: 800 * M, otherCurrent: 200 * M, land: 1500 * M, buildings: 1200 * M, investments: 500 * M, otherFixed: 300 * M, shortDebt: 1000 * M, longDebt: 4000 * M, loanFromOwner: 800 * M, otherLiabilities: 700 * M, capital: 1000 * M, retained: 500 * M, monthlyFixed: 420 * M, monthlyLoanPay: 80 * M },
  stage: "stable",
  ownerMonthly: 60 * M,
  restated: {},
  useRestated: false,
};

describe("事務所の設定: 法人の顧問向けの機能（0108）", () => {
  it("既定は使わない。欄の無い古い事務所データも使わない。使うと決めたら既定と違う設定として保存する", () => {
    expect(DEFAULT_OFFICE_SETTINGS.features.combinedBs).toBe(false);
    expect(readOfficeSettings({}).features.combinedBs).toBe(false);
    expect(readOfficeSettings({ features: { combinedBs: "yes" } }).features.combinedBs).toBe(false);
    const on = readOfficeSettings({ features: { combinedBs: true } });
    expect(on.features.combinedBs).toBe(true);
    expect(isDefaultSettings(on)).toBe(false);
    expect(isDefaultSettings(DEFAULT_OFFICE_SETTINGS)).toBe(true);
  });
});

describe("資産と負債のタブの見るもの（合算BS）", () => {
  const req = executiveReq();
  const r = preview(req);
  const plan = bsPlan({ key: "A", letter: "A", name: "現状", title: "", base: true, req, table: r.table });
  const home = plan.years[0]!;
  const model = (views: ReturnType<typeof combinedBsView>[]) => balanceTabModel({ plans: [plan], selected: "A", base: "A", guide: DEFAULT_BS_GUIDE, guideBasis: defaultGuideBasis(req), pointDefaults: DEFAULT_BS_POINTS, columns: null, prevChoices: [], prev: { status: "idle", model: null }, provisional: false, who: "ご本人", customViews: views });

  it("使わない（customViews が空）なら、見るものの切り替えも合算BS も出さない", () => {
    const html = renderToString(h(BalanceTab, { model: model([]), band: null, onPrev: noop, onGuide: noop, onColumns: noop, onPointDefaults: noop }));
    expect(html).not.toContain("見るもの");
    expect(html).not.toContain("合算BS");
  });

  it("会社の数字が無ければ、入力欄を開いて案内の文を出す", () => {
    const v = combinedBsView(null, home);
    expect(v.empty).toContain("試算表");
    expect(v.form?.open).toBe(true);
    expect(v.steps).toBeUndefined();
    const html = renderToString(h(BalanceTab, { model: model([v]), band: null, onPrev: noop, onGuide: noop, onColumns: noop, onPointDefaults: noop, initial: { open: "combined" } }));
    expect(html).toContain("会社の数字を入れる");
    expect(html).toContain('data-bs-custom-field="amount:cash"');
    expect(html).toContain("data-bs-custom-empty");
  });

  it("会社の数字を入れると、3つの段・相殺の組・純資産の内訳・何か月分・段階の1文。図は合算の1枚の純資産を2つに分ける", () => {
    const v = combinedBsView(company, home);
    expect(v.steps?.map((s) => s.label)).toEqual(["① 2枚を並べる", "② 貸し借りを相殺する", "③ 足して1枚にする"]);
    expect(v.sections?.map((s) => s.key)).toEqual(["pairs", "net", "months", "stage"]);
    const combined = v.steps?.[2]?.columns[2]?.at;
    expect(combined?.netParts?.map((p) => p.label)).toEqual(["会社の財産（剰余金）", "個人の財産"]);
    expect(combined!.netParts!.reduce((s, p) => s + p.amount, 0)).toBe(combined!.netWorth);
    expect(v.notices?.some((n) => n.includes("二重には数えません"))).toBe(true);
    const html = renderToString(h(BalanceTab, { model: model([v]), band: null, onPrev: noop, onGuide: noop, onColumns: noop, onPointDefaults: noop, initial: { open: "combined" } }));
    expect(html).toContain("家計のバランスシート");
    expect(html).toContain("合算（経営者個人＋会社）");
    expect(html).toContain("相殺した4つの組");
    expect(html).toContain("安定成長期");
    expect(html).toContain('data-bs-part="netCompany"');
    expect(html).toContain("お知らせ");
  });

  it("計算の結果は変わらない: 会社の入力は計算の要求に入らず、家計のバランスシートも同じ", () => {
    const before = plan.years.map((y) => [y.year, y.totalAssets, y.totalLiabilities, y.netWorth]);
    combinedBsView(company, home);
    expect(JSON.stringify(req)).not.toContain("companyBs");
    const again = bsPlan({ key: "A", letter: "A", name: "現状", title: "", base: true, req, table: preview(req).table });
    expect(again.years.map((y) => [y.year, y.totalAssets, y.totalLiabilities, y.netWorth])).toEqual(before);
  });

  it("連帯保証の点線の箱: 時点を並べる・プランを比較でも、今の年の図の下にだけ", () => {
    const three = renderToString(h(BalanceTab, { model: model([]), band: null, onPrev: noop, onGuide: noop, onColumns: noop, onPointDefaults: noop, initial: { view: "three" } }));
    expect(three.split("data-bs-guarantee").length - 1).toBe(1);
    const later = renderToString(h(BalanceTab, { model: model([]), band: null, onPrev: noop, onGuide: noop, onColumns: noop, onPointDefaults: noop, initial: { view: "one", year: home.year + 5 } }));
    expect(later).not.toContain("data-bs-guarantee");
  });
});

describe("入力欄（万円の文字）", () => {
  it("万円の文字を円に。マイナスは剰余金だけ。読めない値は変えない", () => {
    expect(manTextToYen("2,000")).toBe(20_000_000);
    expect(manTextToYen("１２．５万")).toBe(125_000);
    expect(manTextToYen("")).toBeNull();
    expect(manTextToYen("▲300")).toBeUndefined();
    expect(manTextToYen("▲300", true)).toBe(-3_000_000);
    expect(manTextToYen("abc")).toBeUndefined();
    expect(yenToManText(12_345_000)).toBe("1234.5");
  });
  it("欄を変えると入力が変わり、全部空になれば欄を持たない", () => {
    const a = withCombinedField(null, "amount:cash", "2000");
    expect(a?.amounts.cash).toBe(20_000_000);
    expect(withCombinedField(a ?? null, "amount:cash", "x")).toBeUndefined();
    expect(withCombinedField(a ?? null, "amount:retained", "-50")?.amounts.retained).toBe(-500_000);
    expect(withCombinedField(a ?? null, "asOf", "2026/9")?.asOf).toBe("2026-09");
    expect(withCombinedField(a ?? null, "stage", "crisis")?.stage).toBe("crisis");
    expect(withCombinedField(a ?? null, "restated:land", "900")?.restated.land).toBe(9_000_000);
    expect(withCombinedField(a ?? null, "useRestated", "1")?.useRestated).toBe(true);
    expect(withCombinedField(a ?? null, "amount:cash", "")).toBeNull();
    expect(withCombinedField(null, "nope", "1")).toBeUndefined();
  });
});
