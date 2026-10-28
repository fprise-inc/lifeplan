// 収益不動産の入力項目（0079）: 物件ごとのまとまり・物件を見分ける欄（計算には使わない）・物件の一覧表・持っていない世帯の出し方・
// 保存済みの世帯（中身のある不動産）がそのまま出ること・持ち帰り用のレポートで物件名などを外すこと
import { describe, expect, it } from "vitest";
import { h } from "preact";
import { renderToString } from "preact-render-to-string";
import type { Account, Debt } from "../src/engine/types.ts";
import { allFields, type FieldDef, type StageDef } from "../src/workspace/input/form.ts";
import { blankHousehold, fromRequest, mutate, type WorkingHousehold } from "../src/workspace/input/household.ts";
import { inputItems } from "../src/workspace/input/items.ts";
import { RentalOverview } from "../src/workspace/input/RentalOverview.tsx";
import { buildStage } from "../src/workspace/input/stages/index.ts";
import { addRentalProperty, LODGING_NOTE, loanBalanceNow, RENTAL_HELP, RENTAL_KINDS, rentalName, rentalOverview, rentalProperties } from "../src/workspace/input/stages/rental.ts";
import { fieldStatus } from "../src/workspace/input/valueState.ts";
import { IdMap, sanitizeRequest } from "../src/workspace/takeaway/sanitize.ts";
import { modelHousehold, preview } from "./helpers.ts";

const seq = () => {
  let n = 0;
  return () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`;
};
const open = (id = "dualAssetsTwoKids"): WorkingHousehold => fromRequest(modelHousehold(id));
const stageOf = (wh: WorkingHousehold): StageDef => buildStage("rental", wh);
const fieldOf = (wh: WorkingHousehold, key: string): FieldDef => {
  const f = allFields(stageOf(wh)).find((x) => x.key === key);
  if (f === undefined) throw new Error(`欄が無い: ${key}`);
  return f;
};
const itemOf = (wh: WorkingHousehold, id: string) => inputItems(wh).find((i) => i.id === id)!;
const prop = (wh: WorkingHousehold, id: string) => (wh.request.input.household.accounts ?? []).find((a) => a.id === id)!.property!;

describe("収益不動産の入力項目", () => {
  it("中身のある不動産（保存済みの世帯）は、そのまま収益不動産に出る。貯蓄・運用には出さず、要約も二重に数えない", () => {
    const wh = open();
    const rental = rentalProperties(wh.request.input.household);
    expect(rental).toHaveLength(1);
    const a = rental[0]!;
    const g = stageOf(wh).sections[0]!.groups[0]!;
    expect(g.key).toBe(`sav/${a.id}`);
    expect(g.title).toBe("物件1（評価額 1,800万円）");
    // 欄のキーは貯蓄・運用の中にあったときのまま
    for (const k of ["value", "property/structure", "property/rent", "property/expAnnual"]) expect(allFields(stageOf(wh)).some((f) => f.key === `sav/${a.id}/${k}`), k).toBe(true);
    expect(allFields(buildStage("savings", wh)).some((f) => f.key.startsWith(`sav/${a.id}/`))).toBe(false);
    // この物件のローンも収益不動産の中
    const loan = (wh.request.input.household.debts ?? []).find((d) => d.property === a.id)!;
    expect(allFields(stageOf(wh)).some((f) => f.key === `housing/debt/${loan.id}/principal`)).toBe(true);
    expect(itemOf(wh, "rental")).toMatchObject({ status: "done", summary: { main: "1", unit: "件・評価額 1,800万円" } });
    // 貯蓄・運用の要約は、物件を除いた世帯と同じ
    const without = mutate(wh, (hh) => void (hh.accounts = hh.accounts!.filter((x) => x.id !== a.id)));
    expect(itemOf(wh, "savings").summary).toEqual(itemOf(without, "savings").summary);
  });

  it("持っていない世帯: ほかの項目と同じ「まだ入れていない」の控えめな出し方で、「当てはまらない」の1押しで抜けられる。?の説明は貸していない土地・別荘の行き先を案内する", () => {
    const wh = blankHousehold("2026-10", seq());
    const it0 = itemOf(wh, "rental");
    expect(it0).toMatchObject({ label: "収益不動産", status: "empty", summary: null, canNa: true, hint: "入れなくても計算できます（貸している不動産は無しで計算中）", art: "rental" });
    const sec = stageOf(wh).sections[0]!;
    expect(sec.note).toBe(`まだありません。${RENTAL_HELP}`);
    expect(RENTAL_HELP).toContain("貸していない土地・別荘は『貯蓄・運用』のその他の資産に入れます");
    expect(sec.actions.map((a) => a.label)).toEqual(["＋ 物件を足す"]);
  });

  it("「＋ 物件を足す」: 最初から中身の欄（土地と建物・家賃収入・経費・売却・ローン）が出る。評価額と家賃は未入力（0円で計算中）で始まる", () => {
    const wh = addRentalProperty(blankHousehold("2026-10", seq()));
    const a = rentalProperties(wh.request.input.household)[0]!;
    const k = `sav/${a.id}`;
    const titles = stageOf(wh).sections[0]!.groups.map((g) => g.title).filter((t) => t !== undefined);
    expect(titles).toEqual(["物件1（評価額 0万円）", "土地と建物", "家賃収入", "経費", "売却"]);
    expect(stageOf(wh).sections[0]!.groups.flatMap((g) => g.actions).map((x) => x.key)).toContain(`${k}/property/addLoan`);
    expect(fieldStatus(fieldOf(wh, `${k}/value`), wh).status).toBe("missing");
    expect(fieldStatus(fieldOf(wh, `${k}/property/rent`), wh).status).toBe("missing");
    expect(itemOf(wh, "rental").status).toBe("missing");
    expect(() => preview(wh.request)).not.toThrow();
  });

  it("物件を見分ける欄: 物件名・種類（標準）、所在地・持分・権利・面積・メモ（詳細）、戸数は一棟のとき標準。見出しは物件名・種類・評価額", () => {
    let wh = addRentalProperty(addRentalProperty(blankHousehold("2026-10", seq())));
    const [a, b] = rentalProperties(wh.request.input.household) as [Account, Account];
    const k = `sav/${a.id}/property`;
    const level = (key: string) => fieldOf(wh, `${k}/${key}`).level;
    expect(["name", "kind"].map(level)).toEqual(["simple", "simple"]);
    expect(["location", "share", "tenure", "landArea", "floorArea", "memo", "units"].map(level)).toEqual(Array(7).fill("detail"));
    expect(allFields(stageOf(wh)).some((f) => f.key.endsWith("/occupied"))).toBe(false);
    expect(RENTAL_KINDS.map((o) => o.label)).toEqual(["区分マンション", "一棟アパート", "一棟マンション", "戸建て", "店舗/事務所", "駐車場", "貸している土地", "民泊・宿"]);
    wh = fieldOf(wh, `${k}/name`).set(wh, "駅前のアパート");
    wh = fieldOf(wh, `${k}/kind`).set(wh, "apartment");
    wh = fieldOf(wh, `sav/${a.id}/value`).set(wh, 60_000_000);
    expect(level("units")).toBe("simple");
    wh = fieldOf(wh, `${k}/units`).set(wh, 8);
    wh = fieldOf(wh, `${k}/location`).set(wh, "埼玉県さいたま市");
    wh = fieldOf(wh, `${k}/tenure`).set(wh, "leasehold");
    wh = fieldOf(wh, `${k}/landArea`).set(wh, "165.3");
    wh = fieldOf(wh, `${k}/floorArea`).set(wh, "198.72");
    wh = fieldOf(wh, `${k}/memo`).set(wh, "管理会社と年1回打ち合わせ");
    expect(prop(wh, a.id)).toMatchObject({ name: "駅前のアパート", kind: "apartment", units: 8, location: "埼玉県さいたま市", tenure: "leasehold", area: { land: "165.3", floor: "198.72" }, memo: "管理会社と年1回打ち合わせ" });
    const groups = stageOf(wh).sections[0]!.groups;
    expect(groups.find((g) => g.key === `sav/${a.id}`)?.title).toBe("駅前のアパート（一棟アパート・評価額 6,000万円）");
    // 名前の無い2件目は「物件2」
    expect(rentalName(wh.request.input.household, b)).toBe("物件2");
    expect(groups.find((g) => g.key === `sav/${b.id}`)?.title).toBe("物件2（評価額 0万円）");
    // 面積を空にすると、空の入れ物を残さない
    wh = fieldOf(wh, `${k}/landArea`).set(wh, null);
    wh = fieldOf(wh, `${k}/floorArea`).set(wh, null);
    expect(prop(wh, a.id).area).toBeUndefined();
    // 欄の当て先（物件名・所在地・メモは自分の入力項目ID）
    expect(fieldOf(wh, `${k}/name`).address!(wh)).toEqual({ target: { object: a.id }, item: "account.property.name", at: [] });
    expect(fieldOf(wh, `${k}/units`).address!(wh)).toEqual({ target: { object: a.id }, item: "account.property", at: ["units"] });
  });

  it("持分を入れると「計算はまだ全部を名義の人の分として扱います」の知らせ。民泊・宿を選ぶと、売上と経費の入れ方は今後の版の知らせ", () => {
    let wh = addRentalProperty(blankHousehold("2026-10", seq()));
    const a = rentalProperties(wh.request.input.household)[0]!;
    const k = `sav/${a.id}/property`;
    expect(fieldOf(wh, `${k}/share`).get(wh).warn ?? null).toBeNull();
    wh = fieldOf(wh, `${k}/share`).set(wh, "0.5");
    expect(fieldOf(wh, `${k}/share`).get(wh).warn).toContain("計算はまだ全部を名義の人の分として扱います");
    wh = fieldOf(wh, `${k}/kind`).set(wh, "lodging");
    expect(fieldOf(wh, `${k}/kind`).get(wh).warn).toBe(LODGING_NOTE);
    expect(LODGING_NOTE).toContain("今は家賃の欄に月の売上の見込みを入れてください");
    expect(stageOf(wh).sections[0]!.groups[0]!.note).toContain(LODGING_NOTE);
  });

  it("物件を見分ける欄は計算に使わない（入れても結果は同じ）。要求はスキーマを通る", () => {
    const base = open();
    const id = rentalProperties(base.request.input.household)[0]!.id;
    const wh = mutate(base, (hh) => {
      const p = hh.accounts!.find((x) => x.id === id)!.property!;
      Object.assign(p, { name: "架空のマンション", kind: "condo", location: "東京都世田谷区", share: "0.5", tenure: "ownership", units: 1, area: { floor: "55.2" }, memo: "架空のメモ" });
    });
    expect(preview(wh.request).table).toEqual(preview(base.request).table);
  });
});

describe("物件の一覧表（入力から出せる数字だけ）", () => {
  it("物件名・種類・評価額・ローン残高・月の家賃（空室を見込んだ後）と合計の行", () => {
    let wh = open();
    const a = rentalProperties(wh.request.input.household)[0]!;
    wh = addRentalProperty(wh);
    const b = rentalProperties(wh.request.input.household)[1]!;
    wh = mutate(wh, (hh) => {
      const x = hh.accounts!.find((y) => y.id === b.id)!;
      x.marketValue = { value: 5_000_000, state: "confirmed", origin: { kind: "manual" } };
      x.property = { name: "月極の駐車場", kind: "parking", rental: { monthly: { value: 60_000, state: "confirmed", origin: { kind: "manual" } }, vacancyRate: "0.1" } };
    });
    const ov = rentalOverview(wh)!;
    expect(ov.rows).toEqual([
      { id: a.id, name: "物件1", kind: null, value: 18_000_000, loan: 9_500_000, rent: Math.floor(95_000 * 0.95) },
      { id: b.id, name: "月極の駐車場", kind: "駐車場", value: 5_000_000, loan: 0, rent: 54_000 },
    ]);
    expect(ov.total).toEqual({ value: 23_000_000, loan: 9_500_000, rent: Math.floor(95_000 * 0.95) + 54_000 });
    const html = renderToString(h(RentalOverview, { wh }));
    expect(html).toContain("data-rental-overview");
    expect(html).toContain("月の家賃（空室を見込んだ後）");
    expect(html).toContain("2,300万円");
    expect(renderToString(h(RentalOverview, { wh: blankHousehold("2026-10", seq()) }))).toBe("");
  });

  it("ローン残高: 今の残高を入れていればその値、無ければ借入額と最初の金利・期間から計算の基準の月の残高の目安", () => {
    const hh = blankHousehold("2026-10", seq()).request.input.household;
    const d: Debt = { id: "x", kind: "other", debtors: [], principal: 12_000_000, start: { at: "2026-10" }, rateSchedule: [{ from: { at: "2026-10" }, type: "fixed", rate: "0" }], repayment: { method: "equalPayment", termMonths: 120 } };
    expect(loanBalanceNow(hh, d, "2026-10")).toBe(12_000_000);
    expect(loanBalanceNow(hh, { ...d, start: { at: "2027-04" } }, "2026-10")).toBe(0);
    expect(loanBalanceNow(hh, { ...d, start: { at: "2021-10" } }, "2026-10")).toBe(6_000_000);
    expect(loanBalanceNow(hh, { ...d, start: { at: "2010-01" } }, "2026-10")).toBe(0);
    const withRate = loanBalanceNow(hh, { ...d, start: { at: "2021-10" }, rateSchedule: [{ from: { at: "2021-10" }, type: "fixed", rate: "0.02" }] }, "2026-10");
    expect(withRate).toBeGreaterThan(6_000_000);
    expect(withRate).toBeLessThan(7_000_000);
    expect(loanBalanceNow(hh, { ...d, balance: { value: 3_000_000, state: "confirmed", origin: { kind: "manual" } } }, "2026-10")).toBe(3_000_000);
  });
});

describe("持ち帰り用のレポート", () => {
  it("物件名・所在地・メモは外す（種類・持分・戸数・面積は残す）", () => {
    const req = structuredClone(modelHousehold("dualAssetsTwoKids"));
    const p = req.input.household.accounts!.find((a) => a.property !== undefined)!.property!;
    Object.assign(p, { name: "架空の物件名X", location: "架空県架空市", memo: "架空のメモY", kind: "condo", units: 1 });
    const out = sanitizeRequest(req, new IdMap());
    const s = JSON.stringify(out);
    for (const t of ["架空の物件名X", "架空県架空市", "架空のメモY"]) expect(s).not.toContain(t);
    expect(out.input.household.accounts!.find((a) => a.property !== undefined)!.property).toMatchObject({ kind: "condo", units: 1 });
  });
});
