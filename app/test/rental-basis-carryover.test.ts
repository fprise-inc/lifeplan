// 収益不動産の家賃の入れ方と、減価償却の確定申告の数字からの引き継ぎ（0126）: 家賃の入れ方の選び方（種類ごとの言葉）、今の実際の家賃収入での
// 空室率の扱い（欄を出さない・残りの知らせと「外す」）、物件の一覧表の月の収入、引き継ぎの欄（年の入れ方・片方だけの知らせ・全部を空にしたら外す・
// 設備の知らせ）、収益不動産のタブの指標（今の収入での表面利回り・損益分岐の入居率を出さない）と見出しの1行
import { describe, expect, it } from "vitest";
import { allFields, type FieldDef, type StageDef } from "../src/workspace/input/form.ts";
import { fromRequest, mutate, type WorkingHousehold } from "../src/workspace/input/household.ts";
import { buildStage } from "../src/workspace/input/stages/index.ts";
import { carryoverActive, monthlyIncome, rentalProperties, rentByWords } from "../src/workspace/input/stages/rental.ts";
import { rentalTabModel, NO_FULL_TEXT } from "../src/workspace/rentalTab.ts";
import type { RentalPropertyViewModel } from "../src/presentation/model.ts";
import { modelHousehold, preview } from "./helpers.ts";

const open = (): WorkingHousehold => fromRequest(modelHousehold("dualAssetsTwoKids"));
const stageOf = (wh: WorkingHousehold): StageDef => buildStage("rental", wh);
const fieldOf = (wh: WorkingHousehold, key: string): FieldDef => {
  const f = allFields(stageOf(wh)).find((x) => x.key === key);
  if (f === undefined) throw new Error(`欄が無い: ${key}`);
  return f;
};
const hasField = (wh: WorkingHousehold, key: string) => allFields(stageOf(wh)).some((x) => x.key === key);
const first = (wh: WorkingHousehold) => rentalProperties(wh.request.input.household)[0]!;
const set = (wh: WorkingHousehold, key: string, v: Parameters<FieldDef["set"]>[1]) => fieldOf(wh, key).set(wh, v);

describe("家賃の入れ方（0126）", () => {
  it("標準の段に「家賃の入れ方」。省略は満室時の家賃と空室率で、種類ごとの言葉（駐車場・貸している土地）。民泊・宿には出さない", () => {
    const wh = open();
    const a = first(wh);
    const k = `sav/${a.id}/property`;
    const f = fieldOf(wh, `${k}/rentBy`);
    expect(f).toMatchObject({ label: "家賃の入れ方", level: "simple" });
    expect(f.get(wh).value).toBe("fullOccupancy");
    expect(f.kind === "select" && f.options.map((o) => o.label)).toEqual(["満室時の家賃と空室率で", "今の実際の家賃収入で"]);
    expect(rentByWords("parking").options.map((o) => o.label)).toEqual(["満車時の駐車料と空き区画の割合で", "今の実際の駐車料の収入で"]);
    expect(rentByWords("land").options.map((o) => o.label)).toEqual(["地代と貸していない割合で", "今の実際の地代収入で"]);
    const lodging = set(wh, `sav/${a.id}/property/kind`, "lodging");
    expect(hasField(lodging, `${k}/rentBy`)).toBe(false);
  });

  it("今の実際の家賃収入を選ぶと、家賃の欄の名前と説明が変わり、空室率の欄を出さない。空室率が残っていれば、使っていないと知らせて「外す」を添える", () => {
    let wh = open();
    const a = first(wh);
    const k = `sav/${a.id}/property`;
    wh = mutate(wh, (h) => void ((h.accounts ?? []).find((x) => x.id === a.id)!.property!.rental!.vacancyRate = "0.05"));
    wh = set(wh, `${k}/rentBy`, "actual");
    expect(first(wh).property?.rental?.rentBy).toBe("actual");
    expect(fieldOf(wh, `${k}/rent`).label).toBe("今の家賃収入（合計・月額）");
    expect(fieldOf(wh, `${k}/rent`).help).toContain("空室率は引きません");
    expect(hasField(wh, `${k}/vacancy`)).toBe(false);
    const left = fieldOf(wh, `${k}/vacancyLeft`);
    const st = left.get(wh);
    expect(st.warn).toContain("計算には使っていません");
    expect(st.warn).toContain("5%");
    const fixed = st.warnFix!.run(wh);
    expect(first(fixed).property?.rental?.vacancyRate).toBeUndefined();
    expect(hasField(fixed, `${k}/vacancyLeft`)).toBe(false);
    // 満室時の家賃に戻すと、空室率の欄が戻る（既定に戻すと欄の値を外す）
    const back = set(fixed, `${k}/rentBy`, "fullOccupancy");
    expect(first(back).property?.rental?.rentBy).toBeUndefined();
    expect(hasField(back, `${k}/vacancy`)).toBe(true);
  });

  it("物件の一覧表の月の収入: 今の実際の家賃収入なら空室率を引かない（家賃以外の月の収入も）", () => {
    const wh = open();
    const a = first(wh);
    const p = { ...a.property!, rental: { ...a.property!.rental!, monthly: { ...a.property!.rental!.monthly, value: 100_000 }, vacancyRate: "0.1", commonFee: 10_000 } };
    expect(monthlyIncome({ ...a, property: p })).toBe(90_000 + 9_000);
    expect(monthlyIncome({ ...a, property: { ...p, rental: { ...p.rental, rentBy: "actual" } } })).toBe(110_000);
  });

  it("収益不動産のタブ: 表面利回りは今の収入から（名前に添える）、損益分岐の入居率は出さない。見出しの1行に入れ方を書く", () => {
    let wh = open();
    const a = first(wh);
    wh = set(wh, `sav/${a.id}/property/rentBy`, "actual");
    const req = wh.request;
    const r = preview(req);
    const m = rentalTabModel({ req, result: r, ui: { view: null, year: null }, sale: null, provisional: false })!;
    const v = m.view as RentalPropertyViewModel;
    const gy = v.metrics.find((x) => x.key === "grossYield")!;
    expect(gy.label).toBe("表面利回り（今の収入で）");
    expect(gy.value).toMatch(/%$/);
    expect(v.metrics.find((x) => x.key === "breakEven")!.value).toBe(NO_FULL_TEXT);
    expect(v.facts).toContain("家賃収入は今の実際の額で入力");
  });
});

describe("減価償却の引き継ぎ（0126）", () => {
  it("詳細の段のまとまり。額を入れると引き継ぐ年（前の年）も入れ、片方だけなら知らせる。全部を空にしたら引き継ぎごと外す", () => {
    let wh = open();
    const a = first(wh);
    const k = `sav/${a.id}/property/carry`;
    const g = stageOf(wh).sections[0]!.groups.find((x) => x.key === k)!;
    expect(g).toMatchObject({ title: "減価償却を確定申告の数字から引き継ぐ", level: "detail" });
    expect(fieldOf(wh, `${k}/year`).get(wh).value).toBe(Number(wh.request.input.baseMonth.slice(0, 4)) - 1);
    wh = set(wh, `${k}/building/book`, 9_000_000);
    expect(first(wh).property?.depreciationCarryover).toEqual({ year: Number(wh.request.input.baseMonth.slice(0, 4)) - 1, building: { book: 9_000_000 } });
    expect(carryoverActive(first(wh).property)).toBe(false);
    expect(fieldOf(wh, `${k}/building/book`).get(wh).warn).toContain("年間の償却費も入れてください");
    wh = set(wh, `${k}/building/annual`, 300_000);
    expect(carryoverActive(first(wh).property)).toBe(true);
    expect(fieldOf(wh, `${k}/building/book`).get(wh).warn).toBeFalsy();
    expect(stageOf(wh).sections[0]!.groups.find((x) => x.key === k)!.note).toContain("確定申告の数字から");
    // 計算に入る（取得価額からの計算と違う減価償却費）
    const before = preview(open().request).summary as { realEstate?: { object: string; income: { year: number; depreciation: number }[] }[] };
    const after = preview(wh.request).summary as typeof before;
    const y = Number(wh.request.input.baseMonth.slice(0, 4)) + 1;
    expect(after.realEstate?.find((p) => p.object === a.id)?.income.find((x) => x.year === y)?.depreciation).toBe(300_000);
    expect(before.realEstate?.find((p) => p.object === a.id)?.income.find((x) => x.year === y)?.depreciation).not.toBe(300_000);
    // 全部を空にしたら外す
    wh = set(set(wh, `${k}/building/book`, null), `${k}/building/annual`, null);
    expect(first(wh).property?.depreciationCarryover).toBeUndefined();
  });

  it("取得価額の内訳に建物附属設備があり、引き継ぎに設備が無ければ、設備の減価償却をしていないと知らせる", () => {
    let wh = open();
    const a = first(wh);
    const k = `sav/${a.id}/property/carry`;
    wh = mutate(wh, (h) => {
      const p = (h.accounts ?? []).find((x) => x.id === a.id)!.property!;
      p.acquisition = { price: 20_000_000, at: "2018-04", parts: { land: 8_000_000, building: 10_000_000, equipment: 2_000_000 } };
      p.depreciationCarryover = { year: 2025, building: { book: 7_000_000, annual: 250_000 } };
    });
    expect(fieldOf(wh, `${k}/equipment/book`).get(wh).warn).toContain("減価償却はしていません");
  });
});
