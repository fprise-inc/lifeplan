// 前提条件は事務所の既定値で決め、世帯では「事務所の既定値」か「この世帯だけ」と見せる（0213）:
// 事務所データの形（版 2・版 1 も読む）、新しい世帯に写す、欄の印と「事務所の既定値に戻す」、たたんだ1行の数、事務所の既定値を変えたときの知らせ、
// 古い世帯の読み方、見本の世帯の計算の結果が変わらないこと、事務所の既定値の画面の3つの区画
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { h } from "preact";
import { renderToString } from "preact-render-to-string";
import { afterEach, describe, expect, it } from "vitest";
import { checkList } from "../src/workspace/input/checkRows.ts";
import { assumptionRows } from "../src/workspace/input/assumptionList.ts";
import { allFields, type FieldDef } from "../src/workspace/input/form.ts";
import { blankHousehold, fromRequest, mutate, type WorkingHousehold } from "../src/workspace/input/household.ts";
import { InputPanel } from "../src/workspace/input/InputPanel.tsx";
import { inputItems } from "../src/workspace/input/items.ts";
import { PREMISE_DEFS, premiseCounts, premiseOfId, premiseSummary } from "../src/workspace/input/premiseDefaults.ts";
import { buildStage } from "../src/workspace/input/stages/index.ts";
import { fieldStatus } from "../src/workspace/input/valueState.ts";
import { setOfficeNow, STANDARD_OFFICE_NOW } from "../src/workspace/office/current.ts";
import { OfficeSettingsPanel } from "../src/workspace/office/OfficeSettingsPanel.tsx";
import { applyOfficeDefaults, DEFAULT_OFFICE_SETTINGS, officePremise, officePremises, publishOfficeSettings, readOfficeSettings, withOfficePremise, type OfficeSettings } from "../src/workspace/office/settings.ts";
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
const premiseOf = (wh: WorkingHousehold, key: string) => fieldStatus(fieldOf(wh, key), wh).premise;
const panel = (wh: WorkingHousehold, extra: Record<string, unknown> = {}) => renderToString(h(InputPanel, { wh, itemId: "assumptions", level: "detail", onLevel: noop, onSave: noop, onClose: noop, ...extra }));
const MODELS = readdirSync(join(REPO_DIR, "data", "modelHouseholds"))
  .filter((f) => f.endsWith(".json"))
  .map((f) => f.replace(/\.json$/, ""))
  .sort();

/** 前提条件の全部の区画を事務所で決めた設定 */
const OFFICE: OfficeSettings = {
  ...DEFAULT_OFFICE_SETTINGS,
  assumptions: { inflation: "0.015", educationInflation: "0.02", heldEstateGrowth: "0.005" },
  realEstateValuation: { landGrowth: "0.005", usefulLife: { wood: 30 } },
  assetReturns: { "equity.global": "0.05" },
  changedOn: "2026-11-14",
};

/** 木造の持ち家のある新しい世帯（不動産の評価の区画を出す。見本の持ち家の形を写す） */
function withHome(wh: WorkingHousehold): WorkingHousehold {
  const home = structuredClone(modelHousehold("salariedCoupleTwoKids").input.household.residences![0]!);
  return mutate(wh, (hh) => {
    (hh.residences ??= []).push({ ...home, from: { at: "2016-04" }, ownership: [{ member: hh.members[0]!.id, share: "1" }] } as never);
  });
}

afterEach(() => setOfficeNow(STANDARD_OFFICE_NOW));

describe("事務所データの形（版 2。0213 の2）", () => {
  it("版 1 の事務所データはそのまま読め、読んだら版 2（足した欄は「決めていない」）", () => {
    const v1 = { version: 1, assumptions: { inflation: "0.015", heldEstateGrowth: "0.01" }, realEstateRatio: "0.7", changedOn: "2026-10-27" };
    const r = readOfficeSettings(v1);
    expect(r.version).toBe(2);
    expect(r.assumptions).toEqual({ inflation: "0.015", heldEstateGrowth: "0.01" });
    expect(r.realEstateValuation).toBeUndefined();
    expect(r.assetReturns).toBeUndefined();
    // 貸していない不動産の値動きは、資産の種類ごとの利回りの不動産（id assetReturns.realEstate）
    expect(officePremises(r)).toEqual({ inflation: "0.015", "assetReturns.realEstate": "0.01" });
  });

  it("版 2 の欄を読み、範囲の外・読めない値・知らない種類は読まない。保存して読み戻せる", () => {
    const r = readOfficeSettings({
      version: 2,
      assumptions: { educationInflation: "0.02", pensionMacroSlideEmployee: "0.5" },
      realEstateValuation: { landGrowth: "0.3", usefulLife: { wood: 30, rc: 0, steel: 34.5, nope: 10 } },
      assetReturns: { "equity.global": "0.05", "bond.global": "abc", realEstate: "0.01", crypto: "0.1" },
    });
    expect(r.assumptions).toEqual({ educationInflation: "0.02" });
    expect(r.realEstateValuation).toEqual({ usefulLife: { wood: 30 } });
    expect(r.assetReturns).toEqual({ "equity.global": "0.05" });
    expect(readOfficeSettings(JSON.parse(JSON.stringify(OFFICE)))).toEqual({ ...OFFICE, version: 2 });
  });

  it("前提条件の id ごとに読み書きでき、決めていない（null）に戻すと欄を外す", () => {
    let s: OfficeSettings = DEFAULT_OFFICE_SETTINGS;
    s = withOfficePremise(s, "realEstateValuation.usefulLife.rc", "50");
    s = withOfficePremise(s, "assetReturns.equity.domestic", "0.04");
    s = withOfficePremise(s, "assetReturns.realEstate", "0.002");
    expect(s.realEstateValuation).toEqual({ usefulLife: { rc: 50 } });
    expect(s.assetReturns).toEqual({ "equity.domestic": "0.04" });
    expect(s.assumptions).toEqual({ heldEstateGrowth: "0.002" });
    expect(officePremise(s, "realEstateValuation.usefulLife.rc")).toBe("50");
    s = withOfficePremise(withOfficePremise(withOfficePremise(s, "realEstateValuation.usefulLife.rc", null), "assetReturns.equity.domestic", null), "assetReturns.realEstate", null);
    expect(s).toEqual(DEFAULT_OFFICE_SETTINGS);
    // 事務所の推定の値で決める物（土地の割合など）は、この形に入れない
    expect(withOfficePremise(DEFAULT_OFFICE_SETTINGS, "realEstateValuation.landShare", "0.4")).toBe(DEFAULT_OFFICE_SETTINGS);
  });

  it("欄の表は経済の前提7・不動産の評価8・資産の種類ごとの利回り12。id と欄のキーは重ならない", () => {
    expect(PREMISE_DEFS.filter((d) => d.section === "economy")).toHaveLength(7);
    expect(PREMISE_DEFS.filter((d) => d.section === "realEstate")).toHaveLength(8);
    expect(PREMISE_DEFS.filter((d) => d.section === "assetReturns")).toHaveLength(12);
    expect(new Set(PREMISE_DEFS.map((d) => d.id)).size).toBe(PREMISE_DEFS.length);
    expect(new Set(PREMISE_DEFS.map((d) => d.key)).size).toBe(PREMISE_DEFS.length);
    expect(PREMISE_DEFS.filter((d) => d.live !== undefined).map((d) => d.id)).toEqual(["realEstateValuation.landShare", "realEstateValuation.residualFloor", "realEstateValuation.saleCostRate"]);
  });
});

describe("新しい世帯に写す・欄の印", () => {
  it("事務所で決めた欄を世帯に書き、「事務所の既定値（年月）」の印。どれも決まった値の「事務所の既定値」で、計算に効く", () => {
    publishOfficeSettings(OFFICE);
    const wh = withHome(applyOfficeDefaults(blankHousehold("2026-11", ids()), OFFICE));
    const a = wh.request.input.assumptions!;
    expect(a.educationInflation).toEqual({ default: "0.02" });
    expect(a.realEstateValuation?.landGrowth).toEqual({ default: "0.005" });
    expect(a.realEstateValuation?.usefulLife).toEqual({ wood: 30 });
    expect(a.assetReturns?.["equity.global"]).toEqual({ default: "0.05" });
    for (const key of ["assume/inflation", "assume/educationInflation", "assume/realEstate/landGrowth", "assume/realEstate/life/wood", "assume/assetReturns/equity.global/default", "assume/assetReturns/realEstate/default"]) {
      expect(wh.assumed[key], key).toBe("事務所の既定値（2026-11）");
      expect(fieldStatus(fieldOf(wh, key), wh), key).toMatchObject({ status: "confirmed", basis: null, premise: { state: "office", decided: true } });
    }
    expect(premiseSummary(wh)).toBe("前提条件: 事務所の既定値どおり（この世帯だけ変えた所 0件）");
    expect(inputItems(wh).find((i) => i.id === "assumptions")?.status).toBe("std");
    // 耐用年数 30年は計算に効く（22年と違う）
    const base = withHome(blankHousehold("2026-11", ids()));
    expect(JSON.stringify(preview(wh.request).table)).not.toBe(JSON.stringify(preview(base.request).table));
  });

  it("欄に「事務所の既定値」。値を変えると「この世帯だけ」と「事務所の既定値に戻す」。戻すと元の形", () => {
    const wh = withHome(blankHousehold("2026-11", ids()));
    let html = panel(wh, { focusKey: "assume/realEstate/life/wood" });
    expect(html).toContain('data-premise="office"');
    // 耐用年数の欄には「この値にする」が無い（推定でない）
    const at = html.indexOf('data-field="assume/realEstate/life/wood"');
    expect(html.slice(at, html.indexOf("data-field=", at + 10))).not.toContain("data-fill-estimate");
    const f = fieldOf(wh, "assume/realEstate/life/wood");
    const own = f.set(wh, 25);
    expect(own.request.input.assumptions?.realEstateValuation?.usefulLife).toEqual({ wood: 25 });
    expect(premiseOf(own, "assume/realEstate/life/wood")).toMatchObject({ state: "household", wasText: "25年", officeText: "22年" });
    html = panel(own, { focusKey: "assume/realEstate/life/wood" });
    expect(html).toContain('data-premise="household"');
    expect(html).toContain(">この世帯だけ<");
    expect(html).toContain("事務所の既定値に戻す");
    const back = premiseOf(own, "assume/realEstate/life/wood")!.reset(own);
    expect(back.request).toEqual(wh.request);
    expect(back.assumed).toEqual(wh.assumed);
  });

  it("土地の割合など3つは事務所の推定の値（その場の値）: 空欄の物件は事務所の値を見せて「事務所の既定値」。違う値は「この世帯だけ」", () => {
    publishOfficeSettings({ ...DEFAULT_OFFICE_SETTINGS, estimates: { values: { "preset.realEstate.landShare": { value: "0.4", changedOn: "2026-11-14", officialRev: 1, officialValue: "0.3" } }, noFill: [] } });
    const wh = withHome(blankHousehold("2026-11", ids()));
    const f = fieldOf(wh, "assume/realEstate/landShare");
    expect(f.get(wh)).toMatchObject({ value: "0.4", premise: { state: "office", officeText: "40%" } });
    const own = f.set(wh, "0.35");
    expect(premiseOf(own, "assume/realEstate/landShare")?.state).toBe("household");
    // 戻すと値を外す（その場の事務所の値）
    expect(premiseOf(own, "assume/realEstate/landShare")!.reset(own).request.input.assumptions?.realEstateValuation).toBeUndefined();
  });
});

describe("たたんだ1行（0213 の4）", () => {
  it("ふだんは1行（経済の前提・例外の年・不動産の評価・資産の種類ごとの利回りを出さない）。この世帯だけの数・変わった数を数える", () => {
    let wh = blankHousehold("2026-11", ids());
    const html = panel(wh);
    expect(html).toContain('data-premise-fold="closed"');
    expect(html).toContain("前提条件: 事務所の既定値どおり（この世帯だけ変えた所 0件）");
    expect(html).not.toContain('data-section="assume/main"');
    expect(html).not.toContain('data-field="assume/inflation"');
    // FP顧問料はたたまない
    expect(html).toContain("FP顧問料");
    wh = fieldOf(wh, "assume/inflation").set(wh, "0.02");
    wh = fieldOf(wh, "assume/assetReturns/equity.global/default").set(wh, "0.06");
    expect(premiseCounts(wh)).toEqual({ own: 2, changed: 0 });
    expect(premiseSummary(wh)).toBe("前提条件: 事務所の既定値と、この世帯だけ変えた所 2件");
    publishOfficeSettings({ ...DEFAULT_OFFICE_SETTINGS, assumptions: { wageGrowth: "0.02" }, changedOn: "2026-11-14" });
    expect(premiseSummary(wh)).toBe("前提条件: 事務所の既定値と、この世帯だけ変えた所 2件（事務所の既定値が変わった所 1件）");
  });

  it("確かめの一覧・検索から前提条件の欄へ来たときは開いて出す", () => {
    const wh = blankHousehold("2026-11", ids());
    const html = panel(wh, { focusKey: "assume/inflation" });
    expect(html).toContain('data-premise-fold="open"');
    expect(html).toContain('data-field="assume/inflation"');
    expect(panel(wh, { focusAt: { kind: "field", key: "assume/assetReturns/equity.global/default" } })).toContain('data-premise-fold="open"');
  });
});

describe("事務所の既定値を後で変えたとき（0213 の5）", () => {
  it("写した値は変えず、確かめの一覧に「事務所の既定値が変わりました（前→今）」。1押しで当てる（今回足した欄も）", () => {
    publishOfficeSettings(OFFICE);
    const wh = withHome(applyOfficeDefaults(blankHousehold("2026-11", ids()), OFFICE));
    const before = JSON.stringify(wh.request);
    publishOfficeSettings({ ...OFFICE, realEstateValuation: { landGrowth: "0.005", usefulLife: { wood: 25 } }, assetReturns: { "equity.global": "0.055" }, changedOn: "2026-12-01" });
    const rows = checkList(wh).filter((r) => r.kind === "notice" && r.fieldKey?.startsWith("assume/"));
    const life = rows.find((r) => r.fieldKey === "assume/realEstate/life/wood")!;
    expect(life.detail).toBe("事務所の既定値が変わりました（30年→25年）。この世帯は前の値で計算しています");
    expect(rows.find((r) => r.fieldKey === "assume/assetReturns/equity.global/default")!.detail).toContain("事務所の既定値が変わりました（5%→5.5%）");
    expect(JSON.stringify(wh.request)).toBe(before);
    expect(premiseOf(wh, "assume/realEstate/life/wood")?.state).toBe("officeChanged");
    expect(panel(wh, { focusKey: "assume/realEstate/life/wood" })).toContain("今の既定値にする");
    const next = life.actions.find((a) => a.key === "office")!.run(wh);
    expect(life.actions[0]!.label).toBe("この世帯に当てる");
    expect(next.request.input.assumptions?.realEstateValuation?.usefulLife).toEqual({ wood: 25 });
    expect(next.assumed["assume/realEstate/life/wood"]).toBe("事務所の既定値（2026-12）");
    expect(premiseOf(next, "assume/realEstate/life/wood")?.state).toBe("office");
    expect(checkList(next).some((r) => r.kind === "notice" && r.fieldKey === "assume/realEstate/life/wood")).toBe(false);
  });

  it("古い世帯: 提供元の既定の値のまま触っていない欄は知らせ、FP が決めた値は「この世帯だけ」（知らせなし）", () => {
    // 事務所の既定値の無いころに作った世帯（物価は既定の値で行が無い・賃金は「この値にする」で確定・運用利回りは打った値）
    const req = structuredClone(modelHousehold("salariedCoupleTwoKids"));
    (req.input as unknown as { valueStates?: Record<string, unknown> }).valueStates = { "assumptions.wageGrowth/default": { state: "confirmed", origin: { kind: "manual" }, estimate: { method: "standard", basis: "既定の値（仮の値。事務所で根拠を確かめて直してください）" } } };
    const wh = fromRequest(req, {});
    expect(premiseOf(wh, "assume/inflation")?.state).toBe("office");
    expect(premiseOf(wh, "assume/wageGrowth")?.state).toBe("office");
    publishOfficeSettings({ ...DEFAULT_OFFICE_SETTINGS, assumptions: { inflation: "0.02", wageGrowth: "0.02", investmentReturn: "0.03" }, changedOn: "2026-11-14" });
    expect(premiseOf(wh, "assume/inflation")).toMatchObject({ state: "officeChanged", wasText: "1%", officeText: "2%" });
    expect(premiseOf(wh, "assume/wageGrowth")).toMatchObject({ state: "household" });
    // 見本の運用利回りも既定の値のまま（触っていない）ので知らせる
    expect(premiseOf(wh, "assume/investmentReturn")).toMatchObject({ state: "officeChanged", wasText: "1%", officeText: "3%" });
    // 見本の外国株式の利回りは見本の作り手が入れた値（この世帯だけ）
    expect(premiseOf(wh, "assume/assetReturns/equity.global/default")).toMatchObject({ state: "household" });
    const notices = checkList(wh).filter((r) => r.kind === "notice" && r.fieldKey?.startsWith("assume/"));
    expect(notices.map((r) => r.fieldKey).sort()).toEqual(["assume/inflation", "assume/investmentReturn"]);
    // 前提と推定の一覧の状態と出典
    const rows = assumptionRows(wh);
    expect(rows.find((r) => r.id === "field:assume/inflation")).toMatchObject({ state: "事務所の既定値が変わりました", source: "前の事務所の既定値（今は 2%）" });
    expect(rows.find((r) => r.id === "field:assume/wageGrowth")).toMatchObject({ state: "この世帯だけ", agreeable: true });
  });

  it("資産配分の期待リターンの目安（推定の目安から書いた値）は推定のまま（0213 の4 の例外）", () => {
    const wh = blankHousehold("2026-11", ids());
    const w = { ...wh, assumed: { ...wh.assumed, "assume/assetReturns/equity.global/default": "外国株式の期待リターンの目安 6%" }, request: mutate(wh, (_h, req) => void ((req.input.assumptions!.assetReturns ??= {})["equity.global"] = { default: "0.06" })).request };
    const s = fieldStatus(fieldOf(w, "assume/assetReturns/equity.global/default"), w);
    expect(s).toMatchObject({ status: "estimated", basis: "外国株式の期待リターンの目安 6%" });
    expect(s.premise).toBeUndefined();
  });
});

describe("見本の世帯の計算の結果は変わらない（0213 の6）", () => {
  it.each(MODELS)("%s: 読むだけで計算の要求を変えず、事務所の既定値を変えても計算の結果は同じ", (id) => {
    const wh = fromRequest(modelHousehold(id), {});
    const before = JSON.stringify(wh.request);
    const table = JSON.stringify(preview(wh.request).table);
    publishOfficeSettings(OFFICE);
    panel(wh);
    checkList(wh);
    assumptionRows(wh);
    premiseCounts(wh);
    expect(JSON.stringify(wh.request)).toBe(before);
    expect(JSON.stringify(preview(wh.request).table)).toBe(table);
  });
});

describe("事務所の既定値の画面の前提条件（0213 の1・4）", () => {
  it("経済の前提・不動産の評価・資産の種類ごとの利回りの3つの区画。不動産の評価と資産の種類ごとの利回りは小さな欄の並び", () => {
    const html = renderToString(h(OfficeSettingsPanel, { value: OFFICE, onSave: async () => undefined, shared: false, onClose: noop }));
    for (const sec of ["economy", "realEstate", "assetReturns"]) expect(html).toContain(`data-office-premises="${sec}"`);
    expect(html.match(/class="os-grid os-compact"/g)).toHaveLength(2);
    for (const d of PREMISE_DEFS) expect(html, d.id).toContain(`data-office-setting="${d.id}"`);
    // 決めた値は欄に入っている（％・年）
    expect(html).toMatch(/value="30"[^>]*data-office-setting="realEstateValuation.usefulLife.wood"/);
    expect(html).toMatch(/value="5"[^>]*data-office-setting="assetReturns.equity.global"/);
    expect(html).toMatch(/placeholder="物価上昇率と同じ"[^>]*data-office-setting="realEstateValuation.landGrowth"|data-office-setting="realEstateValuation.landGrowth"/);
    expect(premiseOfId("assetReturns.realEstate")?.officeLabel).toBe("不動産（貸していない不動産の値動き）");
  });
});
