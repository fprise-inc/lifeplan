// 資産配分の割合の表の作り直し（0252）:
// - 割合の既定は GPIF の基本ポートフォリオ（事務所の既定の割合があればそちら）。割合を持っている世帯は変えない
// - 表で選べる種類（11種類）・「＋ 資産の種類を足す」・「外す」・割合の割り直し（合計をちょうど100%に）
// - 資産の種類ごとの信託報酬（空欄は目安）と、割合でならした全体の信託報酬。前の版の配分全体の信託報酬は全部の種類に同じ値
// - 事務所データの assetMix（形の版 5）
// 境目: 計算の基準月が1〜3月の世帯・入れ方の違い（口座ごと／資産配分）・空欄・推定のままと FP が入れた値
import { afterEach, describe, expect, it } from "vitest";
import { blankHousehold, fromRequest, mutate, type WorkingHousehold } from "../src/workspace/input/household.ts";
import { modelHousehold, preview } from "./helpers.ts";
import {
  addableClasses,
  addClass,
  allocationGaps,
  classFeeOf,
  classFeePreset,
  classReturnKey,
  classRows,
  CLASSES,
  defaultFees,
  defaultMix,
  fillAllocation,
  GPIF_MIX,
  investmentOf,
  mixFromWeights,
  portfolioOf,
  removeClass,
  RISKY_CLASSES,
  setClassFee,
  setClassReturn,
  setClassWeight,
  switchMethod,
} from "../src/workspace/input/savings/model.ts";
import { setOfficeNow, STANDARD_OFFICE_NOW } from "../src/workspace/office/current.ts";
import { DEFAULT_OFFICE_SETTINGS, readOfficeAssetMix, readOfficeSettings, withOfficeAssetMix } from "../src/workspace/office/settings.ts";
import { officeMixFromTexts } from "../src/workspace/office/OfficeSettingsPanel.tsx";
import { ASSET_CLASSES } from "../src/workspace/input/labels.ts";
import { investCorrelation, presetRate } from "../../hearing/src/presets.ts";
import type { EngineRequest } from "../src/engine/types.ts";

afterEach(() => setOfficeNow(STANDARD_OFFICE_NOW));

const seq = () => {
  let n = 0;
  return () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`;
};
const blank = (base = "2026-10"): WorkingHousehold => blankHousehold(base, seq());
const edit = (wh: WorkingHousehold, f: (r: EngineRequest) => void): WorkingHousehold => fillAllocation(mutate(wh, (_h, r) => f(r)));
const keys = (wh: WorkingHousehold) => classRows(wh.request).map((r) => r.key);
const total = (wh: WorkingHousehold) => (investmentOf(wh.request).allocation?.mix ?? []).reduce((s, m) => s + Math.round(Number(m.share) * 10000), 0);

describe("選べる資産の種類（0252）", () => {
  it("株式3・債券3・REIT2・コモディティ・預金・外貨預金の11種類。前の外国株式・外国債券は先進国（キーは変えない）。バランス型・不動産・その他は出さない", () => {
    expect(CLASSES.map((c) => c.name)).toEqual(["国内株式", "先進国株式", "新興国株式", "国内債券", "先進国債券", "新興国債券", "国内REIT", "外国REIT", "コモディティ（金など）", "預金", "外貨預金"]);
    expect(CLASSES.find((c) => c.key === "equity.global")?.name).toBe("先進国株式");
    expect(CLASSES.find((c) => c.key === "bond.global")?.name).toBe("先進国債券");
    expect(CLASSES.some((c) => ["balanced", "realEstate", "other"].includes(c.key))).toBe(false);
    // 前提条件の利回りには残す（14種類）
    expect(ASSET_CLASSES.map((o) => o.value)).toEqual(expect.arrayContaining(["balanced", "realEstate", "other", "equity.emerging", "bond.emerging"]));
    expect(RISKY_CLASSES).toContain("equity.emerging");
  });

  it("どの種類にも値動きの大きさ・信託報酬の目安があり、外貨預金のほかは期待リターンの目安もある。相関は対称で、同じ種類は1", () => {
    for (const c of CLASSES) {
      expect(Number(c.sd), c.key).toBeGreaterThan(0);
      expect(classFeePreset(c.key), c.key).not.toBeNull();
      if (c.key !== "cash.foreign") expect(Number(presetRate(`preset.invest.${c.key}.return`)), c.key).not.toBeNaN();
      for (const d of CLASSES) expect(investCorrelation(c.key, d.key)).toBe(investCorrelation(d.key, c.key));
      expect(investCorrelation(c.key, c.key)).toBe(1);
    }
    expect(classFeePreset("balanced")).toBeNull();
  });
});

describe("割合の既定（0252）", () => {
  it("割合を持たない世帯は GPIF の基本ポートフォリオ（25%ずつ）。信託報酬は種類ごとの目安を割合でならした値", () => {
    const wh = switchMethod(blank(), "allocation");
    const alloc = investmentOf(wh.request).allocation;
    expect(alloc?.mix).toEqual(GPIF_MIX);
    expect(alloc?.fees).toEqual(defaultFees(GPIF_MIX));
    expect(keys(wh)).toEqual(["equity.domestic", "equity.global", "bond.domestic", "bond.global"]);
    const fee = GPIF_MIX.reduce((s, m) => s + 0.25 * Number(classFeePreset(m.assetClass)), 0);
    expect(portfolioOf(wh.request).fee).toBeCloseTo(fee, 10);
    expect(portfolioOf(wh.request).risky).toBeCloseTo(0.5, 10);
  });

  it("事務所の既定の割合があれば、割合を持たない世帯はそれで始める。割合を持っている世帯は変えない", () => {
    const own = switchMethod(blank(), "allocation");
    setOfficeNow({ ...STANDARD_OFFICE_NOW, assetMix: [{ assetClass: "equity.global", share: "0.8" }, { assetClass: "cash.deposit", share: "0.2" }] });
    expect(defaultMix()).toEqual([{ assetClass: "equity.global", share: "0.8" }, { assetClass: "cash.deposit", share: "0.2" }]);
    const next = switchMethod(blank(), "allocation");
    expect(investmentOf(next.request).allocation?.mix).toEqual(defaultMix());
    expect(investmentOf(next.request).allocation?.fees).toEqual({ "equity.global": classFeePreset("equity.global"), "cash.deposit": "0" });
    expect(investmentOf(own.request).allocation?.mix).toEqual(GPIF_MIX);
    // まだ資産配分にしていない世帯の表も既定の割合を見せる（口座ごとの入れ方。期待リターンは目安）
    const accounts = blank();
    expect(keys(accounts)).toEqual(["equity.global", "cash.deposit"]);
    expect(classRows(accounts.request).find((r) => r.key === "equity.global")?.mu).toBe(presetRate("preset.invest.equity.global.return"));
  });
});

describe("表の操作（0252）", () => {
  it("＋ 資産の種類を足す: 割合0%・信託報酬は目安・期待リターンは目安を推定の印で。足した種類は一覧から消える", () => {
    let wh = switchMethod(blank(), "allocation");
    expect(addableClasses(wh.request).flatMap((g) => g.list.map((c) => c.key))).toContain("equity.emerging");
    wh = edit(wh, (r) => addClass(r, "equity.emerging"));
    const row = classRows(wh.request).find((r) => r.key === "equity.emerging")!;
    expect(row).toMatchObject({ weight: 0, fee: classFeePreset("equity.emerging"), feeOwn: true });
    expect(keys(wh).indexOf("equity.emerging")).toBe(2);
    expect(addableClasses(wh.request).flatMap((g) => g.list.map((c) => c.key))).not.toContain("equity.emerging");
    // 0%の間は期待リターンを書かない。割合を入れると目安を推定の印で書く
    expect(wh.request.input.assumptions?.assetReturns?.["equity.emerging"]).toBeUndefined();
    wh = edit(wh, (r) => setClassWeight(r, "equity.emerging", 20));
    expect(wh.request.input.assumptions?.assetReturns?.["equity.emerging"]?.default).toBe(presetRate("preset.invest.equity.emerging.return"));
    expect(wh.assumed[classReturnKey("equity.emerging")]).toBeDefined();
    // 割合は合計で割り直し、合計はちょうど100%（20÷120 = 16.67%、ほかは 20.83%）
    expect(total(wh)).toBe(10000);
    expect(classRows(wh.request).find((r) => r.key === "equity.emerging")?.weight).toBe(16.7);
  });

  it("外す: 残りを割り直し、信託報酬も外す（段階の配分にある種類は残す）。1行だけなら外さない", () => {
    let wh = switchMethod(blank(), "allocation");
    wh = edit(wh, (r) => removeClass(r, "bond.domestic"));
    expect(keys(wh)).toEqual(["equity.domestic", "equity.global", "bond.global"]);
    expect(total(wh)).toBe(10000);
    expect(investmentOf(wh.request).allocation?.fees?.["bond.domestic"]).toBeUndefined();
    // 段階の配分にある種類は、信託報酬を残す
    wh = mutate(wh, (_h, r) => {
      r.input.assumptions!.investment!.allocation!.stages = [{ id: "00000000-0000-4000-8000-0000000000f1", at: { at: "2040-01" }, mix: [{ assetClass: "bond.global", share: "1" }] }];
    });
    wh = edit(wh, (r) => removeClass(r, "bond.global"));
    expect(investmentOf(wh.request).allocation?.fees?.["bond.global"]).toBeDefined();
    wh = edit(wh, (r) => removeClass(r, "equity.domestic"));
    expect(keys(wh)).toEqual(["equity.global"]);
    wh = edit(wh, (r) => removeClass(r, "equity.global"));
    expect(keys(wh)).toEqual(["equity.global"]);
  });

  it("割合の割り直しは、端数を最も大きい行で合わせて合計をちょうど100%にする。0%の行は残し、全部0なら既定", () => {
    const m = mixFromWeights([{ key: "a", weight: 1 }, { key: "b", weight: 1 }, { key: "c", weight: 1 }]);
    expect(m.reduce((s, x) => s + Math.round(Number(x.share) * 10000), 0)).toBe(10000);
    expect(mixFromWeights([{ key: "a", weight: 50 }, { key: "b", weight: 0 }])).toEqual([{ assetClass: "a", share: "1" }, { assetClass: "b", share: "0" }]);
    expect(mixFromWeights([{ key: "a", weight: 0 }])).toEqual(GPIF_MIX);
  });

  it("信託報酬: 打った値は確定、空欄は目安に戻す。全体は割合でならした値", () => {
    let wh = switchMethod(blank(), "allocation");
    wh = edit(wh, (r) => setClassFee(r, "equity.global", "0.005"));
    expect(classRows(wh.request).find((r) => r.key === "equity.global")?.fee).toBe("0.005");
    const others = ["equity.domestic", "bond.domestic", "bond.global"].reduce((s, c) => s + 0.25 * Number(classFeePreset(c)), 0);
    expect(portfolioOf(wh.request).fee).toBeCloseTo(others + 0.25 * 0.005, 10);
    wh = edit(wh, (r) => setClassFee(r, "equity.global", null));
    expect(classRows(wh.request).find((r) => r.key === "equity.global")?.fee).toBe(classFeePreset("equity.global"));
    expect(allocationGaps(wh.request)).toEqual([]);
  });
});

describe("前の版の配分（0252）", () => {
  const old = (alloc: NonNullable<NonNullable<NonNullable<EngineRequest["input"]["assumptions"]>["investment"]>["allocation"]>) =>
    mutate(blank(), (_h, r) => {
      r.input.assumptions = { ...r.input.assumptions!, investment: { method: "allocation", allocation: alloc } };
    });

  it("配分全体の信託報酬（fee）だけの配分は、どの種類もその値で計算する（知らせを出さない）。種類ごとに直すと、その種類だけ変わる", () => {
    let wh = old({ mix: [{ assetClass: "equity.global", share: "0.6" }, { assetClass: "bond.global", share: "0.4" }], fee: "0.0025" });
    expect(classFeeOf(wh.request, "equity.global")).toBe("0.0025");
    expect(classRows(wh.request).every((r) => !r.feeOwn)).toBe(true);
    expect(portfolioOf(wh.request).fee).toBeCloseTo(0.0025, 10);
    expect(allocationGaps(wh.request).some((g) => g.includes("信託報酬"))).toBe(false);
    wh = edit(wh, (r) => setClassFee(r, "equity.global", "0.001"));
    expect(portfolioOf(wh.request).fee).toBeCloseTo(0.6 * 0.001 + 0.4 * 0.0025, 10);
  });

  it("信託報酬の無い配分（空欄）は引かずに計算し、まだ計算に入っていないと知らせる。押すと目安を入れる", () => {
    const wh = old({ mix: [{ assetClass: "equity.global", share: "1" }] });
    expect(portfolioOf(wh.request).fee).toBe(0);
    expect(allocationGaps(wh.request)).toContain("先進国株式の信託報酬");
    const fixed = fillAllocation(wh);
    expect(investmentOf(fixed.request).allocation?.fees).toEqual({ "equity.global": classFeePreset("equity.global") });
    expect(allocationGaps(fixed.request)).toEqual([]);
  });

  it("推定のままの期待リターンと FP が入れた期待リターン: 足した種類の目安は推定、打った値は確定（印を外す）", () => {
    let wh = edit(switchMethod(blank(), "allocation"), (r) => addClass(r, "reit.domestic"));
    wh = edit(wh, (r) => setClassWeight(r, "reit.domestic", 10));
    expect(wh.assumed[classReturnKey("reit.domestic")]).toBeDefined();
    wh = setClassReturn(wh, "reit.domestic", "0.035");
    expect(wh.assumed[classReturnKey("reit.domestic")]).toBeUndefined();
    expect(classRows(wh.request).find((r) => r.key === "reit.domestic")).toMatchObject({ mu: "0.035", muOwn: true });
  });

  it("計算の基準月が1〜3月の世帯も同じ既定の割合と信託報酬（年の区切りに関わらない）", () => {
    for (const base of ["2027-01", "2027-03", "2027-04"]) {
      const wh = switchMethod(blank(base), "allocation");
      expect(investmentOf(wh.request).allocation?.mix, base).toEqual(GPIF_MIX);
      expect(portfolioOf(wh.request).fee, base).toBeCloseTo(portfolioOf(switchMethod(blank(), "allocation").request).fee, 10);
    }
  });
});

describe("口座の運用の費用と配分の信託報酬（0252 の点検の直し）", () => {
  it("口座ごとの入れ方で口座に運用の費用を入れた世帯を資産配分にしても、種類ごとに違う信託報酬と二重に引かない", () => {
    const base = fromRequest(modelHousehold("investmentCouple"));
    const withFee = mutate(base, (h) => {
      for (const a of h.accounts ?? []) if (["nisa", "ideco", "taxable"].includes(a.kind)) a.fee = "0.01";
    });
    const alloc = (w: WorkingHousehold) => switchMethod(w, "allocation");
    const a = alloc(withFee);
    const b = alloc(base);
    // 既定（GPIF）の信託報酬は種類ごとに違う（0.15%・0.1%）
    expect(new Set(Object.values(investmentOf(a.request).allocation?.fees ?? {})).size).toBeGreaterThan(1);
    expect((a.request.input.household.accounts ?? []).some((x) => x.fee === "0.01")).toBe(true);
    const last = a.request.input.endYear;
    const fin = (w: WorkingHousehold) => preview(w.request).table.filter((c) => c.row === "cf.balance.financial" && c.year === last).reduce((s, c) => s + c.amount, 0);
    expect(fin(a)).toBe(fin(b));
  });
});

describe("事務所の既定の割合（0252。事務所データの形の版 5）", () => {
  it("表の種類だけ・同じ種類は1つ・合計が100%のときだけ読む。前の版の事務所データ（欄なし）は GPIF", () => {
    const ok = [{ assetClass: "equity.global", share: "0.7" }, { assetClass: "bond.domestic", share: "0.3" }];
    expect(readOfficeAssetMix(ok)).toEqual(ok);
    expect(readOfficeAssetMix([{ assetClass: "equity.global", share: "0.7" }])).toBeNull();
    expect(readOfficeAssetMix([{ assetClass: "balanced", share: "1" }])).toBeNull();
    expect(readOfficeAssetMix([...ok, { assetClass: "equity.global", share: "0" }])).toBeNull();
    expect(readOfficeAssetMix("x")).toBeNull();
    const s = readOfficeSettings({ version: 4, assetMix: ok });
    expect(s.version).toBe(5);
    expect(s.assetMix).toEqual(ok);
    expect(readOfficeSettings({ version: 4 }).assetMix).toBeUndefined();
    expect(withOfficeAssetMix(s, null).assetMix).toBeUndefined();
    expect(withOfficeAssetMix(DEFAULT_OFFICE_SETTINGS, ok).assetMix).toEqual(ok);
  });

  it("事務所の画面の欄の文字: 全部空欄は既定（GPIF）、合計が100%でなければ保存できない", () => {
    expect(officeMixFromTexts({})).toBeNull();
    expect(officeMixFromTexts({ "assetMix.equity.global": "60", "assetMix.bond.domestic": "40" })).toEqual([
      { assetClass: "equity.global", share: "0.6" },
      { assetClass: "bond.domestic", share: "0.4" },
    ]);
    expect(officeMixFromTexts({ "assetMix.equity.global": "60", "assetMix.bond.domestic": "30" })).toBeUndefined();
    expect(officeMixFromTexts({ "assetMix.equity.global": "0" })).toBeUndefined();
    expect(officeMixFromTexts({ "assetMix.equity.global": "abc" })).toBeUndefined();
  });
});
