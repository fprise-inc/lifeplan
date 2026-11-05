// 建物の無い種類（貸している土地・駐車場）の言葉（2026-11-06。0079 の追記）: 評価額の欄の名前と「?」、土地の評価額の増減率の「?」、
// 延べ床面積・共益費・駐車場の収入・経費の費目の出し方と名前、家賃収入の言葉（地代・駐車料）、結果のタブの指標と表の列の名前。計算は変えない
import { describe, expect, it } from "vitest";
import { allFields, type FieldDef, type StageDef } from "../src/workspace/input/form.ts";
import { fromRequest, mutate, type WorkingHousehold } from "../src/workspace/input/household.ts";
import { buildStage } from "../src/workspace/input/stages/index.ts";
import { rentalProperties } from "../src/workspace/input/stages/rental.ts";
import { analysisOf, propertyMetrics, yearTable } from "../src/workspace/rentalTab.ts";
import { modelHousehold, preview } from "./helpers.ts";

const open = (id = "dualAssetsTwoKids"): WorkingHousehold => fromRequest(modelHousehold(id));
const stageOf = (wh: WorkingHousehold): StageDef => buildStage("rental", wh);
const fields = (wh: WorkingHousehold): FieldDef[] => allFields(stageOf(wh));
const keysOf = (wh: WorkingHousehold) => fields(wh).map((f) => f.key);
const fieldOf = (wh: WorkingHousehold, key: string): FieldDef => {
  const f = fields(wh).find((x) => x.key === key);
  if (f === undefined) throw new Error(`欄が無い: ${key}`);
  return f;
};
const first = (wh: WorkingHousehold) => rentalProperties(wh.request.input.household)[0]!;
const setProp = (wh: WorkingHousehold, f: (p: Record<string, unknown>) => void) =>
  mutate(wh, (hh) => {
    const a = (hh.accounts ?? []).find((x) => x.kind === "realEstate" && x.property !== undefined)!;
    f(a.property as Record<string, unknown>);
  });
/** 建物の分を外した、その種類の物件 */
const ofKind = (kind: string, f: (p: Record<string, unknown>) => void = () => undefined) =>
  setProp(open(), (p) => {
    p.kind = kind;
    delete p.landShare;
    delete p.structure;
    delete p.builtYear;
    const acq = p.acquisition as { parts?: { building?: number } } | undefined;
    if (acq?.parts !== undefined) delete acq.parts.building;
    f(p);
  });

describe("評価額の欄と土地の評価額の増減率の「?」", () => {
  it("駐車場は「土地と設備の合計」、貸している土地は「土地」。増減率の「?」に建物の耐用年数を書かない", () => {
    const park = ofKind("parking");
    const a = first(park);
    expect(fieldOf(park, `sav/${a.id}/value`).label).toBe("今の評価額（土地と設備の合計）");
    expect(fieldOf(park, `sav/${a.id}/value`).help).toContain("設備も含めた");
    expect(fieldOf(park, `sav/${a.id}/growth`).help).not.toContain("構造の耐用年数");
    expect(fieldOf(park, `sav/${a.id}/growth`).help).toContain("設備の分も");
    const land = ofKind("land");
    expect(fieldOf(land, `sav/${first(land).id}/value`).label).toBe("今の評価額（土地）");
    expect(fieldOf(land, `sav/${first(land).id}/growth`).help).not.toContain("建物は");
  });

  it("前の版で建物の分（土地の割合）が入っている物件と、建物のある種類は、今までの名前と「?」のまま", () => {
    const legacy = setProp(open(), (p) => {
      p.kind = "parking";
      p.landShare = "0.3";
    });
    const id = first(legacy).id;
    expect(fieldOf(legacy, `sav/${id}/value`).label).toBe("今の評価額（土地と建物の合計）");
    expect(fieldOf(legacy, `sav/${id}/growth`).help).toContain("建物は構造の耐用年数で減らします");
    const apt = setProp(open(), (p) => void (p.kind = "apartment"));
    expect(fieldOf(apt, `sav/${first(apt).id}/value`).label).toBe("今の評価額（土地と建物の合計）");
  });
});

describe("詳細の欄（延べ床面積・共益費・駐車場の収入）", () => {
  it("建物の無い種類では、延べ床面積・共益費・駐車場の収入を出さない（建物のある種類は出す）", () => {
    for (const kind of ["land", "parking"]) {
      const wh = ofKind(kind, (p) => {
        const r = p.rental as Record<string, unknown>;
        delete r.commonFee;
        delete r.parking;
        delete (p.area as Record<string, unknown> | undefined)?.floor;
      });
      const kp = `sav/${first(wh).id}/property`;
      for (const x of ["floorArea", "commonFee", "parking"]) expect(keysOf(wh), `${kind} ${x}`).not.toContain(`${kp}/${x}`);
      expect(keysOf(wh)).toContain(`${kp}/otherMonthly`);
    }
    const apt = setProp(open(), (p) => void (p.kind = "apartment"));
    const kp = `sav/${first(apt).id}/property`;
    for (const x of ["floorArea", "commonFee", "parking"]) expect(keysOf(apt)).toContain(`${kp}/${x}`);
  });

  it("値が入っていれば黙って捨てずに出す。駐車場の種類の駐車場の収入は、満車時の駐車料と重なることを知らせる", () => {
    const wh = ofKind("parking", (p) => {
      Object.assign(p.rental as object, { commonFee: 3000, parking: 20000 });
      p.area = { floor: "50" };
    });
    const kp = `sav/${first(wh).id}/property`;
    for (const x of ["floorArea", "commonFee", "parking"]) expect(keysOf(wh)).toContain(`${kp}/${x}`);
    expect(fieldOf(wh, `${kp}/parking`).get(wh).warn).toContain("満車時の駐車料（合計）");
    expect(fieldOf(wh, `${kp}/commonFee`).get(wh).warn).toBeUndefined();
    // 貸している土地で駐車場の収入が入っていても、重なりの知らせは出さない（駐車場の種類だけ）
    const land = ofKind("land", (p) => void Object.assign(p.rental as object, { parking: 20000 }));
    expect(fieldOf(land, `sav/${first(land).id}/property/parking`).get(land).warn).toBeUndefined();
  });

  it("家賃収入の言葉: 駐車場は駐車料・空き区画、貸している土地は地代", () => {
    const park = ofKind("parking");
    const kp = `sav/${first(park).id}/property`;
    expect(fieldOf(park, `${kp}/rent`).label).toBe("満車時の駐車料（合計）");
    expect(fieldOf(park, `${kp}/vacancy`).label).toBe("空き区画の割合");
    expect(stageOf(park).sections[0]!.groups.find((g) => g.key === `${kp}/rental`)!.title).toBe("駐車場の収入");
    const land = ofKind("land");
    const kl = `sav/${first(land).id}/property`;
    expect(fieldOf(land, `${kl}/rent`).label).toBe("地代（月額）");
    expect(fieldOf(land, `${kl}/keyMoney`).label).toBe("権利金・更新料（年あたりの見込み）");
    expect(stageOf(land).sections[0]!.groups.find((g) => g.key === `${kl}/rental`)!.title).toBe("地代収入");
  });
});

describe("経費の費目", () => {
  const items = (wh: WorkingHousehold) => {
    const kp = `sav/${first(wh).id}/property/expItem/`;
    return new Map(fields(wh).filter((f) => f.key.startsWith(kp)).map((f) => [f.key.slice(kp.length), f.label]));
  };
  it("駐車場は「管理費・設備の保守」、貸している土地は建物の管理・共用部の費目を出さない", () => {
    const park = items(ofKind("parking", (p) => delete (p.expenses as { items?: unknown } | undefined)?.items));
    expect(park.get("management")).toBe("管理費・設備の保守");
    expect(park.get("insurance")).toBe("保険料（施設賠償責任など）");
    expect(park.get("leasing")).toBe("利用者の募集の費用");
    const land = items(ofKind("land", (p) => delete (p.expenses as { items?: unknown } | undefined)?.items));
    expect(land.has("management")).toBe(false);
    expect(land.has("facility")).toBe(false);
    expect(land.get("propertyTax")).toBe("固定資産税・都市計画税");
    for (const label of land.values()) expect(label).not.toMatch(/建物|修繕積立金|入居者/);
  });
  it("貸している土地でも、値が入っていれば「管理費」として出す。建物のある種類は今までの名前", () => {
    const land = items(ofKind("land", (p) => {
      p.expenses ??= {};
      (p.expenses as Record<string, unknown>).items = { management: 50000 };
    }));
    expect(land.get("management")).toBe("管理費");
    const apt = items(setProp(open(), (p) => void (p.kind = "apartment")));
    expect(apt.get("management")).toBe("建物管理費・修繕積立金");
  });
});

describe("結果の収益不動産のタブ", () => {
  it("貸している土地（ローンあり）: 損益分岐は稼働率、減価償却は「建物が無い」、元金の返済が減価償却費を上回る年は出さない、表の列は地代収入", () => {
    const wh = ofKind("land");
    const p = analysisOf(preview(wh.request))!.properties[0]!;
    const y = p.years.find((x) => x.year === 2027);
    const ms = propertyMetrics(p, y, { baseYear: 2026, landOnly: true, kind: "land" });
    const m = (k: string) => ms.find((x) => x.key === k)!;
    expect(m("breakEven").label).toBe("損益分岐の稼働率");
    expect(m("grossYield").help).toContain("地代");
    expect(m("depreciationEnd").value).toBe("—（建物が無いので、減価償却しません）");
    expect(m("deadCross").value).toBe("—（減価償却がありません）");
    expect(m("deadCross").help).not.toContain("建物");
    expect(yearTable(p.years, { lodging: false, deadCross: null, kind: "land" }).columns[1]!.label).toBe("地代収入");
  });
  it("駐車場で設備を入れていなければ「設備を入れていないので」。建物のある種類は今までの名前", () => {
    const wh = ofKind("parking", (p) => delete (p.acquisition as { parts?: unknown } | undefined)?.parts);
    const p = analysisOf(preview(wh.request))!.properties[0]!;
    const ms = propertyMetrics(p, p.years[1], { baseYear: 2026, landOnly: true, kind: "parking" });
    expect(ms.find((x) => x.key === "depreciationEnd")!.value).toBe("—（設備を入れていないので、減価償却しません）");
    expect(yearTable(p.years, { lodging: false, deadCross: null, kind: "parking" }).columns[1]!.label).toBe("駐車場の収入");
    const apt = analysisOf(preview(open().request))!.properties[0]!;
    expect(propertyMetrics(apt, apt.years[1], { baseYear: 2026 }).find((x) => x.key === "breakEven")!.label).toBe("損益分岐の入居率");
  });
  it("言葉だけで、計算の結果は変わらない（共益費・駐車場の収入を入れたまま種類を変えても、収入は同じ）", () => {
    const withExtra = (kind: string) =>
      analysisOf(preview(ofKind(kind, (p) => void Object.assign(p.rental as object, { commonFee: 3000, parking: 20000 })).request))!.properties[0]!.years.map((x) => x.rent);
    expect(withExtra("parking")).toEqual(withExtra("land"));
  });
});
