// 事務所の既定値の「預金の利回り」と「貸していない不動産（空き家・土地・別荘）の値動き」（0073 の追記 2026-11-07）:
// 新しい世帯に推定の印で写す（預金の利回りは前提条件の年ごとの列、貸していない不動産の値動きは資産の種類ごとの利回りの不動産）。
// 既定のままなら何も写さない（預金 0.1%・不動産 0%）。後で変えたら確かめの一覧に知らせる。資産配分から戻しても事務所の不動産の値動きは残す
import { h } from "preact";
import { renderToString } from "preact-render-to-string";
import { afterEach, describe, expect, it } from "vitest";
import type { Account } from "../src/engine/types.ts";
import { checkList } from "../src/workspace/input/checkRows.ts";
import { allFields, type FieldDef } from "../src/workspace/input/form.ts";
import { blankHousehold, type WorkingHousehold } from "../src/workspace/input/household.ts";
import { switchMethod } from "../src/workspace/input/savings/model.ts";
import { buildStage } from "../src/workspace/input/stages/index.ts";
import { fieldStatus } from "../src/workspace/input/valueState.ts";
import { officeAssumptionOfKey, setOfficeNow, STANDARD_OFFICE_NOW } from "../src/workspace/office/current.ts";
import { OfficeSettingsPanel } from "../src/workspace/office/OfficeSettingsPanel.tsx";
import { applyOfficeDefaults, ASSUMPTION_STANDARDS, DEFAULT_OFFICE_SETTINGS, OFFICE_ASSUMPTIONS, publishOfficeSettings, readOfficeSettings, type OfficeSettings } from "../src/workspace/office/settings.ts";
import { preview } from "./helpers.ts";

let n = 0;
const ids = () => () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`;
const SETTINGS: OfficeSettings = { ...DEFAULT_OFFICE_SETTINGS, assumptions: { depositReturn: "0.002", heldEstateGrowth: "0.01" }, changedOn: "2026-11-07" };
const ESTATE_KEY = "assume/assetReturns/realEstate/default";
const fieldIn = (wh: WorkingHousehold, stage: "assumptions" | "savings", key: string): FieldDef | undefined => allFields(buildStage(stage, wh)).find((f) => f.key === key);

/** 貸していない不動産（評価額の伸び率は入れない）を足した世帯 */
function withHeldEstate(wh: WorkingHousehold, value: number): { wh: WorkingHousehold; a: Account } {
  const others = buildStage("savings", wh).sections.find((s) => s.key === "sav/others")!;
  let next = others.actions.find((x) => x.key === "sav/add/realEstate")!.run(wh);
  const a = (next.request.input.household.accounts ?? []).filter((x) => x.kind === "realEstate").at(-1) as Account;
  next = fieldIn(next, "savings", `sav/${a.id}/value`)!.set(next, value);
  return { wh: next, a };
}
const estateAt = (wh: WorkingHousehold, id: string, year: number) =>
  preview(wh.request)
    .table.filter((c: { row: string; year: number; object?: string }) => c.year === year && c.object === id && c.row.startsWith("cf.balance.account.realEstate"))
    .reduce((s: number, c: { amount: number }) => s + c.amount, 0);

afterEach(() => setOfficeNow(STANDARD_OFFICE_NOW));

describe("事務所の既定値の預金の利回り・貸していない不動産の値動き", () => {
  it("前提条件の既定値に2つの系列があり、既定は今のまま（預金 0.1%・貸していない不動産 0%）。既定のままなら新しい世帯に何も写さない", () => {
    expect(OFFICE_ASSUMPTIONS).toContain("depositReturn");
    expect(OFFICE_ASSUMPTIONS).toContain("heldEstateGrowth");
    expect(ASSUMPTION_STANDARDS.depositReturn).toBe("0.001");
    expect(ASSUMPTION_STANDARDS.heldEstateGrowth).toBe("0");
    const wh0 = blankHousehold("2026-11", ids());
    expect(applyOfficeDefaults(wh0, DEFAULT_OFFICE_SETTINGS)).toBe(wh0);
    expect(wh0.request.input.assumptions?.depositReturn?.default).toBe("0.001");
    expect(wh0.request.input.assumptions?.assetReturns?.realEstate).toBeUndefined();
  });

  it("新しい世帯に推定の印（根拠「事務所の既定値（年月）」）で写す。預金は前提条件の預金の利回り、不動産は資産の種類ごとの利回りの不動産", () => {
    const wh = applyOfficeDefaults(blankHousehold("2026-11", ids()), SETTINGS);
    const a = wh.request.input.assumptions!;
    expect(a.depositReturn?.default).toBe("0.002");
    expect(a.assetReturns?.realEstate?.default).toBe("0.01");
    // ほかの前提はそのまま
    expect(a.investmentReturn?.default).toBe("0.01");
    for (const key of ["assume/depositReturn", ESTATE_KEY]) {
      const f = fieldIn(wh, "assumptions", key)!;
      expect(f, key).toBeDefined();
      expect(fieldStatus(f, wh), key).toMatchObject({ status: "estimated", basis: "事務所の既定値（2026-11）" });
    }
  });

  it("写した値は計算に効く: 評価額の伸び率を入れていない貸していない不動産が年1%で動く（入れた伸び率があればそちら）", () => {
    const base = withHeldEstate(blankHousehold("2026-11", ids()), 10_000_000);
    const office = withHeldEstate(applyOfficeDefaults(blankHousehold("2026-11", ids()), SETTINGS), 10_000_000);
    expect(estateAt(base.wh, base.a.id, 2028)).toBe(estateAt(base.wh, base.a.id, 2027));
    const y1 = estateAt(office.wh, office.a.id, 2027);
    const y2 = estateAt(office.wh, office.a.id, 2028);
    expect(y2 / y1).toBeCloseTo(1.01, 4);
    // その物の伸び率を入れれば、事務所の値でなくそちら
    const own = fieldIn(office.wh, "savings", `sav/${office.a.id}/growth`)!.set(office.wh, "0");
    expect(estateAt(own, office.a.id, 2028)).toBe(estateAt(own, office.a.id, 2027));
  });

  it("後で事務所の値を変えたら、推定のままの世帯の確かめの一覧に「事務所の新しい値があります」（不動産の値動きも）。押すと事務所の値になる", () => {
    const wh = applyOfficeDefaults(blankHousehold("2026-11", ids()), SETTINGS);
    expect(officeAssumptionOfKey(ESTATE_KEY)).toBe("heldEstateGrowth");
    expect(officeAssumptionOfKey("assume/depositReturn")).toBe("depositReturn");
    expect(officeAssumptionOfKey("assume/assetReturns/equity.global/default")).toBeNull();
    publishOfficeSettings({ ...SETTINGS, assumptions: { depositReturn: "0.003", heldEstateGrowth: "0.005" }, changedOn: "2026-12-01" });
    const rows = checkList(wh);
    const estate = rows.find((r) => r.fieldKey === ESTATE_KEY && r.kind === "notice")!;
    expect(estate.detail).toContain("事務所の新しい値があります（0.5%）");
    expect(rows.find((r) => r.fieldKey === "assume/depositReturn" && r.kind === "notice")!.detail).toContain("事務所の新しい値があります（0.3%）");
    const next = estate.actions.find((x) => x.key === "office")!.run(wh);
    expect(next.request.input.assumptions?.assetReturns?.realEstate?.default).toBe("0.005");
    expect(fieldStatus(fieldIn(next, "assumptions", ESTATE_KEY)!, next)).toMatchObject({ status: "estimated", basis: "事務所の既定値（2026-12）" });
  });

  it("資産配分に切り替えて戻しても、事務所の既定値で写した不動産の値動きは外さない（資産配分の目安の期待リターンだけ外す）", () => {
    const wh = applyOfficeDefaults(blankHousehold("2026-11", ids()), SETTINGS);
    const alloc = switchMethod(wh, "allocation");
    expect(Object.keys(alloc.request.input.assumptions?.assetReturns ?? {}).length).toBeGreaterThan(1);
    const back = switchMethod(alloc, "accounts");
    expect(back.request.input.assumptions?.assetReturns).toEqual({ realEstate: { default: "0.01" } });
    expect(back.assumed[ESTATE_KEY]).toBe("事務所の既定値（2026-11）");
  });

  it("「＋ 不動産」で資産の種類ごとの利回りに不動産を足すと、今の計算と同じ0%から始める（足しただけで値動きを変えない）", () => {
    const wh = blankHousehold("2026-11", ids());
    const sec = buildStage("assumptions", wh).sections.find((s) => s.key === "assume/assetReturns")!;
    const next = sec.actions.find((a) => a.key === "assume/addReturn/realEstate")!.run(wh);
    expect(next.request.input.assumptions?.assetReturns?.realEstate?.default).toBe("0");
    expect(fieldIn(next, "assumptions", ESTATE_KEY)!.help).toContain("貸していない不動産");
  });

  it("事務所データを読むときは系列ごとの欄の範囲で確かめる（-10%〜は読み、範囲の外は読まない）", () => {
    const r = readOfficeSettings({ assumptions: { inflation: "-0.08", depositReturn: "0.002", heldEstateGrowth: "-0.02", investmentReturn: "0.18", pensionMacroSlide: "-0.01" } });
    expect(r.assumptions).toEqual({ inflation: "-0.08", depositReturn: "0.002", heldEstateGrowth: "-0.02" });
    expect(readOfficeSettings(JSON.parse(JSON.stringify(SETTINGS)))).toEqual(SETTINGS);
  });

  it("事務所の既定値の画面の「前提条件の既定値」に2つの欄が出る（入れなければ既定の値）", () => {
    const html = renderToString(h(OfficeSettingsPanel, { value: SETTINGS, onSave: async () => undefined, shared: false, onClose: () => undefined }));
    expect(html).toContain("預金の利回り（年）");
    expect(html).toContain("貸していない不動産（空き家・土地・別荘）の値動き（年）");
    expect(html).toContain('data-office-setting="depositReturn"');
    expect(html).toContain('data-office-setting="heldEstateGrowth"');
    expect(html).toContain("入れなければ0%（評価額のまま）");
  });
});
