// 前提条件の入力項目をふつうの欄の形にする（0260）: 境目（計算の基準の月が1〜3月・誕生月・入れ方の違い・空欄・推定のままと FP が入れた値）、
// 運用の利回りを世帯の入力の画面から外した扱い（出す世帯・出さない世帯・口座の利回りの空欄の出どころ・提案書の行を出すかの判定）、
// 前提と推定の一覧の「確かめた」と世帯ファイルの記録 household.agreed をなくしたこと、全部の見本・モデル世帯で計算の結果が変わらないこと
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { h } from "preact";
import { renderToString } from "preact-render-to-string";
import { afterEach, describe, expect, it } from "vitest";
import { investmentReturnUsed } from "../../engine/src/sdk/returnUse.ts";
import type { Account, EngineRequest } from "../src/engine/types.ts";
import { assumptionRows } from "../src/workspace/input/assumptionList.ts";
import { checkList } from "../src/workspace/input/checkRows.ts";
import { allFields, type FieldDef } from "../src/workspace/input/form.ts";
import { blankHousehold, fromRequest, mutate, standardEndYear, type WorkingHousehold } from "../src/workspace/input/household.ts";
import { InputPanel } from "../src/workspace/input/InputPanel.tsx";
import { inputItems } from "../src/workspace/input/items.ts";
import { investDefaultSource, rateSourceOf } from "../src/workspace/input/savings/model.ts";
import { buildStage } from "../src/workspace/input/stages/index.ts";
import { investmentReturnShown } from "../src/workspace/input/stages/assumptions.ts";
import { fieldStatus } from "../src/workspace/input/valueState.ts";
import { setOfficeNow, STANDARD_OFFICE_NOW } from "../src/workspace/office/current.ts";
import { DEFAULT_OFFICE_SETTINGS, publishOfficeSettings } from "../src/workspace/office/settings.ts";
import { CURRENT } from "../src/workspace/plans/band.ts";
import { DEFAULT_BALANCE_SETTINGS, DEFAULT_DISPLAY_SETTINGS } from "../src/workspace/settings.ts";
import { bodyObject, EMPTY_CARRY, fromBody, type BodyState } from "../src/workspace/store/body.ts";
import { REPO_DIR } from "../scripts/lib.ts";
import { modelHousehold, preview } from "./helpers.ts";

let n = 0;
const ids = () => () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`;
const noop = () => undefined;
const fieldOf = (wh: WorkingHousehold, key: string): FieldDef => {
  const f = allFields(buildStage("assumptions", wh)).find((x) => x.key === key);
  if (f === undefined) throw new Error(`欄が無い: ${key}`);
  return f;
};
const hasField = (wh: WorkingHousehold, key: string) => allFields(buildStage("assumptions", wh)).some((x) => x.key === key);
const panel = (wh: WorkingHousehold, level: "simple" | "detail" = "detail") => renderToString(h(InputPanel, { wh, itemId: "assumptions", level, onLevel: noop, onSave: noop, onClose: noop }));
const MODELS = readdirSync(join(REPO_DIR, "data", "modelHouseholds"))
  .filter((f) => f.endsWith(".json"))
  .map((f) => f.replace(/\.json$/, ""))
  .sort();
/** 運用の利回りだけを変えた要求 */
const withReturn = (req: EngineRequest, r: string): EngineRequest => {
  const x = structuredClone(req);
  (x.input.assumptions as { investmentReturn: { default: string } }).investmentReturn = { default: r };
  return x;
};
const withInvestment = (wh: WorkingHousehold, series: { default: string; byYear?: Record<string, string> }) => mutate(wh, (_h, req) => void (req.input.assumptions!.investmentReturn = series));

afterEach(() => setOfficeNow(STANDARD_OFFICE_NOW));

describe("境目: 計算の基準の月が1〜3月・誕生月（表を何歳まで見るかの何年分）", () => {
  it("基準の月が1月なら、その年から。2月・3月・12月は翌年から（表の最初の年）", () => {
    for (const [bm, first] of [
      ["2027-01", 2027],
      ["2027-02", 2028],
      ["2027-03", 2028],
      ["2026-12", 2027],
    ] as const) {
      const wh = blankHousehold(bm, ids());
      const st = fieldOf(wh, "assume/endYear").get(wh);
      const end = wh.request.input.endYear;
      expect(st.hint, bm).toBe(`${String(first)}年〜${String(end)}年の${String(end - first + 1)}年分（ご本人100歳の年まで）`);
      expect(st.talkHelp, bm).toContain(`${String(first)}年から${String(end)}年まで、${String(end - first + 1)}年分`);
      // 事務所の既定値どおり（印は出さない）
      expect(fieldStatus(fieldOf(wh, "assume/endYear"), wh).premise?.state, bm).toBe("office");
    }
  });

  it("誕生月が1月でも12月でも、同じ年に生まれた人は同じ年が表の最後（その年に何歳になるか）。何年分の言葉も同じ", () => {
    const born = (wh: WorkingHousehold, ym: string) => {
      const w = mutate(wh, (hh) => void (hh.members[0]!.birth = { ...hh.members[0]!.birth, birthYearMonth: ym }));
      return fieldOf(w, "assume/endYear").set(w, "default");
    };
    const base = blankHousehold("2027-03", ids());
    const jan = born(base, "1987-01");
    const dec = born(base, "1987-12");
    expect(jan.request.input.endYear).toBe(2087);
    expect(dec.request.input.endYear).toBe(standardEndYear(dec.request.input.household, dec.request.input.baseMonth));
    expect(dec.request.input.endYear).toBe(jan.request.input.endYear);
    expect(fieldOf(dec, "assume/endYear").get(dec).hint).toBe(fieldOf(jan, "assume/endYear").get(jan).hint);
    expect(fieldOf(jan, "assume/endYear").get(jan).hint).toBe("2028年〜2087年の60年分（ご本人100歳の年まで）");
  });
});

describe("境目: 空欄（欄の中に薄く計算に使う値。推定の見た目にしない）", () => {
  it("資産の種類ごとの利回りの空欄は運用の利回り、預金・外貨預金は預金の利回り、教育費・土地の上昇率は物価の上昇率", () => {
    const wh = withInvestment(blankHousehold("2026-11", ids()), { default: "0.02" });
    expect(fieldOf(wh, "assume/assetReturns/equity.domestic/default").get(wh)).toMatchObject({ value: null, blankShown: "0.02", hint: null });
    expect(fieldOf(wh, "assume/assetReturns/cash.deposit/default").get(wh)).toMatchObject({ value: null, blankShown: "0.001", hint: "空欄: 預金の利回りと同じ" });
    expect(fieldOf(wh, "assume/assetReturns/realEstate/default").get(wh)).toMatchObject({ value: "0" });
    expect(fieldOf(wh, "assume/educationInflation").get(wh)).toMatchObject({ value: null, blankShown: "0.01", hint: "空欄: 物価の上昇率と同じ" });
    // 空欄の欄は推定ではない（「推定」の印・「この値にする」を出さない）
    for (const key of ["assume/assetReturns/equity.domestic/default", "assume/educationInflation"]) expect(fieldStatus(fieldOf(wh, key), wh).status, key).toBe("confirmed");
    const html = panel(wh);
    expect(html).not.toContain("est-ghost");
    // 値を入れて空にすると、事務所の既定値に戻る（空欄）
    const f = fieldOf(wh, "assume/assetReturns/equity.domestic/default");
    const own = f.set(wh, "0.05");
    expect(f.get(own)).toMatchObject({ value: "0.05", premise: { state: "household", officeValue: "2%" } });
    expect(f.set(own, null).request).toEqual(wh.request);
  });

  it("口座の利回りの空欄は「空欄: 年1.0%（事務所の既定値）」のように出どころを出す（配分・預金・暗号資産はそれぞれの出どころ）", () => {
    const wh = fromRequest(modelHousehold("single45"));
    const accs = (wh.request.input.household.accounts ?? []) as Account[];
    const blank = accs.find((a) => a.kind === "nisa" || a.kind === "ideco");
    if (blank !== undefined && blank.expectedReturn === undefined && (blank.assetMix ?? []).length === 0) expect(rateSourceOf(wh, blank)).toBe("事務所の既定値");
    const nisa = { id: "a", kind: "nisa", owner: "o", marketValue: { value: 0, state: "confirmed" }, asOf: "2026-11", contributions: [] } as unknown as Account;
    expect(rateSourceOf(wh, nisa)).toBe("事務所の既定値");
    expect(rateSourceOf(wh, { ...nisa, assetMix: [{ assetClass: "equity.global", share: "1" }] } as Account)).toBe("資産の配分から");
    expect(rateSourceOf(wh, { ...nisa, kind: "fxDeposit" } as Account)).toBe("預金の利回り");
    const fxOwn = mutate(wh, (_h, req) => void ((req.input.assumptions!.assetReturns ??= {})["cash.foreign"] = { default: "0.015" }));
    expect(rateSourceOf(fxOwn, { ...nisa, kind: "fxDeposit" } as Account)).toBe("資産の種類ごとの利回りの外貨預金");
    expect(rateSourceOf(wh, { ...nisa, kind: "cryptoAsset" } as Account)).toBe("今の評価額のまま");
    // 前の世帯の「この世帯だけ」の運用の利回り
    const own = withInvestment(wh, { default: "0.035" });
    expect(investDefaultSource(own)).toBe("前提条件のこの世帯の値");
    expect(rateSourceOf(own, nisa)).toBe("前提条件のこの世帯の値");
    // 事務所の既定値を後で変えた（この世帯は前の値のまま）
    publishOfficeSettings({ ...DEFAULT_OFFICE_SETTINGS, assumptions: { investmentReturn: "0.02" }, changedOn: "2026-11-25" });
    expect(investDefaultSource(wh)).toBe("前の事務所の既定値");
    setOfficeNow(STANDARD_OFFICE_NOW);
    // 貯蓄・運用の入力項目の欄の下（stages/savings.ts）
    const f = allFields(buildStage("savings", wh)).find((x) => x.key.endsWith("/rate") && x.get(wh).value === null && (x.get(wh).hint ?? "").includes("事務所の既定値"));
    if (f !== undefined) expect(f.get(wh).hint).toMatch(/^空欄: 年\d+\.\d%（事務所の既定値）$/);
  });
});

describe("境目: 推定のままと FP が入れた値（運用の利回りを画面に出すか）", () => {
  it("触っていない・FP が事務所の既定値と同じ値を入れた（確定の行あり）なら出さない。違う値・推定の印・例外の年なら詳細に1行", () => {
    const wh = blankHousehold("2026-11", ids());
    expect(investmentReturnShown(wh)).toBe(false);
    // FP が既定と同じ値を「この値にする」で確定にした（前の版の世帯の形）: 事務所の既定値と同じなので出さない
    const same = mutate(wh, (_h, req) => void ((req.input as unknown as { valueStates?: Record<string, unknown> }).valueStates = { "assumptions.investmentReturn/default": { state: "confirmed", origin: { kind: "manual" } } }));
    expect(investmentReturnShown(same)).toBe(false);
    // FP が違う値を入れた: この世帯だけ
    const own = withInvestment(wh, { default: "0.03" });
    expect(investmentReturnShown(own)).toBe(true);
    expect(fieldStatus(fieldOf(own, "assume/investmentReturn"), own).premise?.state).toBe("household");
    // 推定の印（事務所の既定値でない仮の印）のまま: 推定として出す（黙って隠さない）
    const est = { ...own, assumed: { ...own.assumed, "assume/investmentReturn": "既定の値（仮の値）" } };
    expect(investmentReturnShown(est)).toBe(true);
    expect(fieldStatus(fieldOf(est, "assume/investmentReturn"), est).status).toBe("estimated");
    // 例外の年だけ
    expect(investmentReturnShown(withInvestment(wh, { default: "0.01", byYear: { "2027": "0.03" } }))).toBe(true);
    // 標準では出さない
    expect(panel(own, "simple")).not.toContain('data-field="assume/investmentReturn"');
    expect(panel(own)).toContain('data-field="assume/investmentReturn"');
  });

  it("資産配分の期待リターンの目安から書いた値は、推定のまま（印は推定。一覧も推定）", () => {
    const wh = blankHousehold("2026-11", ids());
    const w = { ...wh, assumed: { ...wh.assumed, "assume/assetReturns/equity.global/default": "外国株式の期待リターンの目安 6%" }, request: mutate(wh, (_h, req) => void ((req.input.assumptions!.assetReturns ??= {})["equity.global"] = { default: "0.06" })).request };
    expect(fieldStatus(fieldOf(w, "assume/assetReturns/equity.global/default"), w).status).toBe("estimated");
    expect(assumptionRows(w).find((r) => r.id === "field:assume/assetReturns/equity.global/default")).toMatchObject({ tone: "estimated", state: "推定" });
  });
});

describe("境目: 入れ方の違い（運用の利回りを計算に使う物の判定。提案書の前提の一覧の「運用利回り」の行）", () => {
  const blank = blankHousehold("2026-11", ids()).request;
  const acc = (o: Partial<Account> & { kind: string }) => ({ id: `a-${o.kind}`, owner: "o", marketValue: { value: 1_000_000, state: "confirmed" }, asOf: "2026-11", contributions: [], ...o }) as unknown as Account;
  const req = (accounts: Account[], extra: Record<string, unknown> = {}) => {
    const r = structuredClone(blank);
    r.input.household.accounts = accounts;
    Object.assign(r.input.assumptions!, extra);
    return r;
  };

  it("口座ごと: 利回りも配分も無い運用の口座は使う。利回りを入れた口座・預金・暗号資産・評価額の増減率のある不動産は使わない", () => {
    expect(investmentReturnUsed(req([acc({ kind: "deposit" })]).input)).toBe(false);
    expect(investmentReturnUsed(req([acc({ kind: "nisa" })]).input)).toBe(true);
    expect(investmentReturnUsed(req([acc({ kind: "nisa", expectedReturn: "0.03" })]).input)).toBe(false);
    expect(investmentReturnUsed(req([acc({ kind: "cryptoAsset" })]).input)).toBe(false);
    expect(investmentReturnUsed(req([acc({ kind: "realEstate" })]).input)).toBe(false);
    expect(investmentReturnUsed(req([acc({ kind: "otherAsset" })]).input)).toBe(false);
    // 預金の利回りが無い前の要求は、預金も運用の利回り
    const noDeposit = req([acc({ kind: "deposit" })]);
    delete (noDeposit.input.assumptions as { depositReturn?: unknown }).depositReturn;
    expect(investmentReturnUsed(noDeposit.input)).toBe(true);
  });

  it("資産の配分: 種類ごとの利回りが空欄の種類があれば使う（預金の種類・不動産は使わない）。利回りの段階も見る", () => {
    const mix = [{ assetClass: "equity.global", share: "0.6" }, { assetClass: "cash.deposit", share: "0.4" }];
    expect(investmentReturnUsed(req([acc({ kind: "nisa", assetMix: mix })]).input)).toBe(true);
    expect(investmentReturnUsed(req([acc({ kind: "nisa", assetMix: mix })], { assetReturns: { "equity.global": { default: "0.05" } } }).input)).toBe(false);
    // 段階の配分に空欄の種類
    const staged = acc({ kind: "nisa", expectedReturn: "0.03", returnStages: [{ id: "s", at: { at: "2030-01" }, assetMix: [{ assetClass: "bond.domestic", share: "1" }] }] } as never);
    expect(investmentReturnUsed(req([staged]).input)).toBe(true);
    expect(investmentReturnUsed(req([acc({ kind: "nisa", expectedReturn: "0.03", returnStages: [{ id: "s", at: { at: "2030-01" }, expectedReturn: "0.02" }] } as never)]).input)).toBe(false);
  });

  it("資産配分の入れ方: 運用する口座は共通の配分（段階も）で決まり、口座の利回りは使わない。合計の入れ方はまとめた口座だけ", () => {
    const alloc = (m: { assetClass: string; share: string }[]) => ({ investment: { method: "allocation", allocation: { mix: m } } });
    expect(investmentReturnUsed(req([acc({ kind: "nisa", expectedReturn: "0.03" })], alloc([{ assetClass: "equity.global", share: "1" }])).input)).toBe(true);
    expect(investmentReturnUsed(req([acc({ kind: "nisa" })], { ...alloc([{ assetClass: "equity.global", share: "1" }]), assetReturns: { "equity.global": { default: "0.05" } } }).input)).toBe(false);
    const total = { investment: { method: "total" } };
    expect(investmentReturnUsed(req([acc({ kind: "pooled" }), acc({ kind: "nisa", expectedReturn: "0.03" })], total).input)).toBe(true);
    expect(investmentReturnUsed(req([acc({ kind: "pooled", expectedReturn: "0.02" }), acc({ kind: "nisa" })], total).input)).toBe(false);
  });

  it("保険の貯蓄型（資産の種類が無いか、その利回りが無い）と、必要保障額の逆算方式は使う", () => {
    const fund = (simple: Record<string, unknown>) => ({ ...req([acc({ kind: "deposit" })]).input, household: { ...req([acc({ kind: "deposit" })]).input.household, insuranceContracts: [{ template: "insurance.variable", simple }] } });
    expect(investmentReturnUsed(fund({}) as never)).toBe(true);
    expect(investmentReturnUsed(fund({ estimate: true }) as never)).toBe(false);
    expect(investmentReturnUsed({ ...fund({ assetClass: "equity.global" }), assumptions: { ...fund({}).assumptions, assetReturns: { "equity.global": { default: "0.05" } } } } as never)).toBe(false);
    expect(investmentReturnUsed({ ...req([acc({ kind: "deposit" })]).input, protection: { method: "reverse" } } as never)).toBe(true);
  });

  it("どのモデル世帯でも: 使わないと判定した世帯は、運用の利回りを変えても結果が1円も変わらない（判定が計算と食い違わない）", () => {
    let usedCount = 0;
    for (const id of MODELS) {
      const r = modelHousehold(id);
      if (investmentReturnUsed(r.input)) {
        usedCount++;
        continue;
      }
      expect(JSON.stringify(preview(withReturn(r, "0.05")).table), id).toBe(JSON.stringify(preview(withReturn(r, "0.01")).table));
    }
    // 運用の利回りで伸びる口座を持つ世帯もある（利回りも配分も入れていない口座・空欄の種類）
    expect(usedCount).toBeGreaterThan(0);
    expect(investmentReturnUsed(modelHousehold("sampleParentsCare").input)).toBe(true);
  });
});

describe("前提と推定の一覧の「確かめた」をなくした（世帯ファイルの household.agreed も。0260）", () => {
  it("前の版の本文に記録があっても、作業中の世帯に持たず、保存の本文にも書かない。一覧の行に確かめた印は無い", () => {
    const wh = fromRequest(modelHousehold("salariedCoupleTwoKids"));
    const state: BodyState = { wh, workspace: { template: "salariedCoupleTwoKids", band: [], base: CURRENT, selected: CURRENT, shownItems: [] }, display: { result: DEFAULT_DISPLAY_SETTINGS, balance: DEFAULT_BALANCE_SETTINGS }, carry: EMPTY_CARRY };
    const body = bodyObject(state) as unknown as { household: Record<string, unknown> };
    expect(body.household.agreed).toBeUndefined();
    const old = { ...body, household: { ...body.household, agreed: { current: { "field:assume/inflation": { on: "2026-10-20", note: "面談で確かめた" } }, "plan-b": { "cg:market/drop": { on: "2026-11-01" } } } } };
    const back = fromBody(JSON.stringify(old));
    expect("agreed" in back.wh).toBe(false);
    expect((bodyObject(back) as unknown as { household: Record<string, unknown> }).household.agreed).toBeUndefined();
    expect(back.wh.request).toEqual(fromBody(JSON.stringify(body)).wh.request);
    const html = panel(back.wh);
    expect(html).not.toContain("確かめた");
    expect(assumptionRows(back.wh).every((r) => !("agreeable" in r))).toBe(true);
  });
});

describe("全部の見本・モデル世帯: 前提条件の画面・一覧・確かめの一覧・本文の読み書きで計算の要求も結果も変わらない（運用の利回りの扱いを含む）", () => {
  it.each(MODELS)("%s", (id) => {
    const wh = fromRequest(modelHousehold(id));
    const before = JSON.stringify(wh.request);
    const table = JSON.stringify(preview(wh.request).table);
    panel(wh, "simple");
    panel(wh, "detail");
    assumptionRows(wh);
    checkList(wh);
    inputItems(wh);
    expect(JSON.stringify(wh.request)).toBe(before);
    // 運用の利回りを画面に出すかは見せ方だけ（計算の要求は同じ）。出す世帯は、この世帯だけの値などがある世帯だけ
    expect(investmentReturnShown(wh)).toBe(hasField(wh, "assume/investmentReturn"));
    // 本文に書いて読み戻しても計算の結果は同じ（前の版の確かめた記録が付いていても）
    const state: BodyState = { wh, workspace: { template: id, band: [], base: CURRENT, selected: CURRENT, shownItems: [] }, display: { result: DEFAULT_DISPLAY_SETTINGS, balance: DEFAULT_BALANCE_SETTINGS }, carry: EMPTY_CARRY };
    const body = bodyObject(state) as unknown as { household: Record<string, unknown> };
    const back = fromBody(JSON.stringify({ ...body, household: { ...body.household, agreed: { current: { "field:assume/inflation": { on: "2026-10-20" } } } } }));
    expect(JSON.stringify(preview(back.wh.request).table)).toBe(table);
    // 事務所の既定値の運用の利回りを変えても、作った世帯の計算は変わらない（黙って変えない。0073 の3）
    publishOfficeSettings({ ...DEFAULT_OFFICE_SETTINGS, assumptions: { investmentReturn: "0.04" }, changedOn: "2026-11-25" });
    expect(JSON.stringify(preview(wh.request).table)).toBe(table);
    setOfficeNow(STANDARD_OFFICE_NOW);
  });
});
