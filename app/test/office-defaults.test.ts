// 事務所の既定値（0073）: 読むときの形の確かめ・新しい世帯に写す・後で変えたときの知らせ・受け取る予定の見込みの既定・％の入力
import { afterEach, describe, expect, it } from "vitest";
import { checkList } from "../src/workspace/input/checkRows.ts";
import { blankHousehold } from "../src/workspace/input/household.ts";
import { addIncome, addInheritedDebt } from "../src/workspace/input/moneyRows.ts";
import { fieldStatus } from "../src/workspace/input/valueState.ts";
import { allFields } from "../src/workspace/input/form.ts";
import { buildStage } from "../src/workspace/input/stages/index.ts";
import { setOfficeNow, STANDARD_OFFICE_NOW } from "../src/workspace/office/current.ts";
import { h } from "preact";
import { renderToString } from "preact-render-to-string";
import { feeFromTexts, feeYenFromText, OfficeSettingsPanel, pctToRate, rateToPct, yenFromText } from "../src/workspace/office/OfficeSettingsPanel.tsx";
import { applyOfficeDefaults, DEFAULT_OFFICE_SETTINGS, isDefaultSettings, layoutOf, officeBasis, publishOfficeSettings, readFeeTable, readOfficeSettings, STANDARD_FEE_TABLE, type OfficeSettings } from "../src/workspace/office/settings.ts";
import { addAdvisoryFee } from "../src/workspace/input/stages/fees.ts";
import { officeNow } from "../src/workspace/office/current.ts";
import { DEFAULT_LAYOUT, inputItems } from "../src/workspace/input/items.ts";
import { bodyObject, EMPTY_CARRY, fromBody, type BodyState } from "../src/workspace/store/body.ts";
import { preview } from "./helpers.ts";

let n = 0;
const ids = () => () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`;
const SETTINGS: OfficeSettings = { ...DEFAULT_OFFICE_SETTINGS, care: { selfAndSpouse: "fill" }, inheritLikelihood: "uncertain", assumptions: { inflation: "0.015", investmentReturn: "0.02" }, realEstateRatio: "0.7", changedOn: "2026-10-27", layout: { order: ["family", "living", "work"] } };
const state = (wh: BodyState["wh"]): BodyState => ({ wh, workspace: { template: null, band: [], base: "current", selected: "current", shownItems: [] }, display: { result: {}, balance: {} } as unknown as BodyState["display"], carry: EMPTY_CARRY });

afterEach(() => setOfficeNow(STANDARD_OFFICE_NOW));

describe("読むときの形の確かめ", () => {
  it("読めない値は既定。知らないカード・重なりは捨てる", () => {
    expect(readOfficeSettings(null)).toEqual(DEFAULT_OFFICE_SETTINGS);
    expect(readOfficeSettings({ care: { selfAndSpouse: "x" }, assumptions: { inflation: "abc", wageGrowth: "0.5" }, realEstateRatio: "2", inheritLikelihood: "maybe" })).toEqual(DEFAULT_OFFICE_SETTINGS);
    // 前の版の「最初の5枚」（first）は読まない（あっても誤りにしない）
    const r = readOfficeSettings({ ...SETTINGS, layout: { order: ["family", "x", "family", "living"], first: ["living", "nope"] } });
    expect(r.layout).toEqual({ order: ["family", "living"] });
    expect(readOfficeSettings(JSON.parse(JSON.stringify(SETTINGS)))).toEqual(SETTINGS);
    expect(isDefaultSettings(DEFAULT_OFFICE_SETTINGS)).toBe(true);
    expect(isDefaultSettings(SETTINGS)).toBe(false);
    expect(officeBasis(SETTINGS)).toBe("事務所の既定値（2026-10）");
  });

  it("並び: 設定の順に、設定に無いカードを標準の順で後ろに足す", () => {
    const wh = blankHousehold("2026-10", ids());
    const items = inputItems(wh, { layout: layoutOf(SETTINGS) });
    expect(items.slice(0, 3).map((i) => i.id)).toEqual(["family", "living", "work"]);
    expect(items).toHaveLength(15);
    expect(layoutOf(DEFAULT_OFFICE_SETTINGS)).toBe(DEFAULT_LAYOUT);
  });
});

describe("新しい世帯に写す", () => {
  it("前提条件の標準値・不動産の評価の割合は推定の印（事務所の標準）で入り、本人の介護は目安で入る。計算できる", () => {
    const wh0 = blankHousehold("2026-10", ids());
    const wh = applyOfficeDefaults(wh0, SETTINGS);
    expect(wh.request.input.assumptions?.inflation?.default).toBe("0.015");
    expect(wh.request.input.assumptions?.investmentReturn?.default).toBe("0.02");
    expect(wh.request.input.assumptions?.wageGrowth?.default).toBe("0.01");
    expect(wh.request.input.inheritanceTax?.realEstateRatio).toBe("0.7");
    const f = allFields(buildStage("assumptions", wh)).find((x) => x.key === "assume/inflation")!;
    expect(fieldStatus(f, wh)).toMatchObject({ status: "estimated", basis: "事務所の既定値（2026-10）" });
    expect((wh.request.input.household.careExpenses ?? []).length).toBe(1);
    expect(() => preview(wh.request)).not.toThrow();
    // 保存して読み直しても推定の印が残る
    const back = fromBody(JSON.stringify(bodyObject(state(wh)))).wh;
    expect(fieldStatus(f, back)).toMatchObject({ status: "estimated", basis: "事務所の既定値（2026-10）" });
    // 既定のままなら何も変えない
    expect(applyOfficeDefaults(wh0, DEFAULT_OFFICE_SETTINGS)).toBe(wh0);
  });

  it("事務所の値を後で変えても世帯は黙って変わらず、確かめの一覧に「事務所の新しい値があります」。押すと推定の印のまま事務所の値になる", () => {
    const wh = blankHousehold("2026-10", ids());
    expect(checkList(wh).some((r) => r.actions.some((a) => a.key === "office"))).toBe(false);
    publishOfficeSettings({ ...DEFAULT_OFFICE_SETTINGS, assumptions: { inflation: "0.02" }, changedOn: "2026-11-01" });
    const row = checkList(wh).find((r) => r.fieldKey === "assume/inflation")!;
    expect(row).toMatchObject({ kind: "notice" });
    expect(row.detail).toContain("事務所の新しい値があります（2%）");
    const next = row.actions.find((a) => a.key === "office")!.run(wh);
    expect(next.request.input.assumptions?.inflation?.default).toBe("0.02");
    const f = allFields(buildStage("assumptions", next)).find((x) => x.key === "assume/inflation")!;
    expect(fieldStatus(f, next)).toMatchObject({ status: "estimated", basis: "事務所の既定値（2026-11）" });
    expect(checkList(next).some((r) => r.fieldKey === "assume/inflation" && r.kind === "notice")).toBe(false);
    // 確定にした値には知らせを出さない
    const conf = checkList(wh).find((r) => r.fieldKey === "assume/wageGrowth");
    // 前提条件の標準の値は、推定でなく「前提条件の標準の値」の行（0041 の追記 2026-11-06）
    expect(conf?.kind).toBe("premise");
  });
});

describe("受け取る予定の相続・贈与の見込みの既定", () => {
  it("「不確か」なら、足した受け取る相続と受け継ぐ借金が不確かになる。ほかのカードの入るお金は変えない", () => {
    publishOfficeSettings({ ...DEFAULT_OFFICE_SETTINGS, inheritLikelihood: "uncertain" });
    const wh0 = blankHousehold("2026-10", ids());
    const parent = ids()();
    const wh = { ...wh0, request: structuredClone(wh0.request) };
    const self = wh.request.input.household.members[0]!;
    wh.request.input.household.members.push({ id: parent, kind: "parent", birth: { birthYearMonth: "1955-04", bornOnFirst: false }, sex: "female", joins: null, leaves: null, expected: false, outside: { of: self.id, periods: [] } } as never);
    const a = addIncome(wh, "inheritance", "00000000-0000-4000-8000-0000000000a1");
    expect(a.request.input.household.incomeFlows?.at(-1)?.likelihood).toBe("uncertain");
    const d = addInheritedDebt(wh, "00000000-0000-4000-8000-0000000000a2");
    expect(d.request.input.household.debts?.at(-1)?.likelihood).toBe("uncertain");
    setOfficeNow(STANDARD_OFFICE_NOW);
    expect(addIncome(wh, "inheritance", "00000000-0000-4000-8000-0000000000a3").request.input.household.incomeFlows?.at(-1)?.likelihood).toBeUndefined();
  });
});

describe("％の入力", () => {
  it("「1.5」→ 0.015、空は null、読めない・範囲の外は undefined", () => {
    expect(pctToRate("1.5")).toBe("0.015");
    expect(pctToRate("0.4%")).toBe("0.004");
    expect(pctToRate("")).toBeNull();
    expect(pctToRate("abc")).toBeUndefined();
    expect(pctToRate("50")).toBeUndefined();
    expect(pctToRate("70", 0, 100)).toBe("0.7");
    expect(rateToPct("0.015")).toBe("1.5");
    expect(rateToPct(null)).toBe("");
  });

  it("評価の割合は 100%（時価のまま）まで入れられ、事務所の既定値に保存して読み戻せる。前提の率の範囲の外（3桁）は読まない", () => {
    expect(pctToRate("100", 0, 100)).toBe("1");
    expect(pctToRate("100%", 0, 100)).toBe("1");
    expect(pctToRate("100.5", 0, 100)).toBeUndefined();
    expect(pctToRate("100")).toBeUndefined();
    expect(pctToRate("-100")).toBeUndefined();
    const back = readOfficeSettings(JSON.parse(JSON.stringify({ ...DEFAULT_OFFICE_SETTINGS, realEstateRatio: pctToRate("100", 0, 100) })));
    expect(back.realEstateRatio).toBe("1");
    expect(rateToPct(back.realEstateRatio)).toBe("100");
  });
});

describe("FP顧問料の料金表", () => {
  it("読むときの形の確かめ（読めない所は標準。段階は2年目から・年目の順・重なりは後の物）", () => {
    expect(readFeeTable(undefined)).toEqual(STANDARD_FEE_TABLE);
    expect(readOfficeSettings({}).fee).toEqual(STANDARD_FEE_TABLE);
    const t = readFeeTable({ oneTime: 200000, per: "year", amount: 150000, steps: [{ year: 5, amount: 200000 }, { year: 1, amount: 1 }, { year: 3, amount: 180000 }, { year: 5, amount: 210000 }, { year: 3.5, amount: 1 }], onContingency: "continue" });
    expect(t).toEqual({ oneTime: 200000, per: "year", amount: 150000, steps: [{ year: 3, amount: 180000 }, { year: 5, amount: 210000 }], onContingency: "continue" });
    expect(readFeeTable({ oneTime: -1, amount: "x", onContingency: "ratio" })).toEqual(STANDARD_FEE_TABLE);
    expect(isDefaultSettings({ ...DEFAULT_OFFICE_SETTINGS, fee: t })).toBe(false);
    expect(readOfficeSettings(JSON.parse(JSON.stringify({ ...SETTINGS, fee: t }))).fee).toEqual(t);
  });

  it("画面の欄の文字から料金表（万円・○年目。入力の画面の FP顧問料と同じ万円）。読めない・重なる段階は保存しない", () => {
    expect(yenFromText("12,000円")).toBe(12000);
    expect(yenFromText("１２０００")).toBe(12000);
    expect(yenFromText("")).toBeUndefined();
    expect(yenFromText("1.5")).toBeUndefined();
    // 料金表の額は万円（「30」は30万円）。円を付ければ円で読む
    expect(feeYenFromText("30")).toBe(300000);
    expect(feeYenFromText("1.2")).toBe(12000);
    expect(feeYenFromText("12,000円")).toBe(12000);
    expect(feeYenFromText("")).toBeUndefined();
    expect(feeYenFromText("x")).toBeUndefined();
    const ok = feeFromTexts(STANDARD_FEE_TABLE, { oneTime: "30", amount: "1", steps: [{ year: "4", amount: "1.5" }, { year: "2", amount: "1.2" }] });
    expect(ok).toMatchObject({ oneTime: 300000, amount: 10000 });
    expect(ok?.steps).toEqual([{ year: 2, amount: 12000 }, { year: 4, amount: 15000 }]);
    expect(feeFromTexts(STANDARD_FEE_TABLE, { oneTime: "0", amount: "1", steps: [{ year: "1", amount: "1" }] })).toBeNull();
    expect(feeFromTexts(STANDARD_FEE_TABLE, { oneTime: "0", amount: "1", steps: [{ year: "2", amount: "1" }, { year: "2", amount: "2" }] })).toBeNull();
  });

  it("画面に料金表の区画（払い方・段階・万一のときの扱い）を出す。率の欄は無い", () => {
    const html = renderToString(h(OfficeSettingsPanel, { value: { ...DEFAULT_OFFICE_SETTINGS, fee: { ...STANDARD_FEE_TABLE, steps: [{ year: 3, amount: 12000 }] } }, onSave: async () => undefined, shared: false, onClose: () => undefined }));
    expect(html).toContain("FP顧問料の料金表");
    expect(html).toContain("年目から月");
    expect(html).toContain('data-office-fee-on="stop"');
    expect(html).not.toContain("値上げの率（");
  });

  it("契約を足す操作は、今の事務所の料金表を写す（後で変えても足した契約は変わらない）", () => {
    const fee = { oneTime: 100000, per: "month" as const, amount: 20000, steps: [{ year: 2, amount: 25000 }], onContingency: "stop" as const };
    publishOfficeSettings({ ...DEFAULT_OFFICE_SETTINGS, fee });
    expect(officeNow().fee).toEqual(fee);
    const wh = addAdvisoryFee(blankHousehold("2026-10", ids()), ids());
    const before = JSON.stringify(wh.request.input.household.advisoryFees);
    expect(wh.request.input.household.advisoryFees![0]!.terms).toMatchObject({ oneTime: [{ amount: 100000 }], recurring: { monthly: 20000, revision: { steps: [{ at: { at: "2028-11" }, monthly: 25000 }] } } });
    publishOfficeSettings(DEFAULT_OFFICE_SETTINGS);
    expect(JSON.stringify(wh.request.input.household.advisoryFees)).toBe(before);
  });
});
