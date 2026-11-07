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
import { buildStages } from "../src/workspace/input/stages/index.ts";
import { fieldStatus } from "../src/workspace/input/valueState.ts";
import { IdMap, sanitizeRequest } from "../src/workspace/takeaway/sanitize.ts";
import { full, modelHousehold, preview } from "./helpers.ts";

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
    // 評価額がまだ入っていない物件は、見出しで未入力と分かる。売却・大きな修繕の予定は、標準では別の「▸」の入口（売却・大きな修繕の予定）から開く
    expect(titles).toEqual(["物件1（評価額は未入力）", "土地と建物", "減価償却を確定申告の数字から引き継ぐ", "家賃収入", "経費", "売却・大きな修繕の予定", "売却", "申告（ご本人）: 持ち主ごと・その人の物件をまとめて"]);
    expect(stageOf(wh).sections[0]!.groups.flatMap((g) => g.actions).map((x) => x.key)).toContain(`${k}/property/addLoan`);
    expect(fieldStatus(fieldOf(wh, `${k}/value`), wh).status).toBe("missing");
    expect(fieldStatus(fieldOf(wh, `${k}/property/rent`), wh).status).toBe("missing");
    // 家賃は物件全体の満室時の合計、空室はその割合（顧客が読める説明）
    expect(fieldOf(wh, `${k}/property/rent`)).toMatchObject({ label: "満室時の家賃（合計）", level: "simple" });
    expect(fieldOf(wh, `${k}/property/rent`).help).toContain("すべての部屋（区画）が埋まっているとき");
    expect(fieldOf(wh, `${k}/property/vacancy`)).toMatchObject({ label: "空室率", level: "simple" });
    expect(fieldOf(wh, `${k}/property/vacancy`).help).toContain("満室時の家賃からこの割合を引いて計算します");
    expect(allFields(stageOf(wh)).some((f) => /空室を見込む|空室の割合/u.test(`${f.label}${f.help ?? ""}`))).toBe(false);
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
    expect(groups.find((g) => g.key === `sav/${b.id}`)?.title).toBe("物件2（評価額は未入力）");
    // 面積を空にすると、空の入れ物を残さない
    wh = fieldOf(wh, `${k}/landArea`).set(wh, null);
    wh = fieldOf(wh, `${k}/floorArea`).set(wh, null);
    expect(prop(wh, a.id).area).toBeUndefined();
    // 欄の当て先（物件名・所在地・メモは自分の入力項目ID）
    expect(fieldOf(wh, `${k}/name`).address!(wh)).toEqual({ target: { object: a.id }, item: "account.property.name", at: [] });
    expect(fieldOf(wh, `${k}/units`).address!(wh)).toEqual({ target: { object: a.id }, item: "account.property", at: ["units"] });
  });

  it("持分を入れると「計算はまだ全部を名義の人の分として扱います」の知らせ。民泊・宿を選んでも種類の欄に知らせは出さない（消費税・個人事業税を扱わないことは「?」の中。0081）", () => {
    let wh = addRentalProperty(blankHousehold("2026-10", seq()));
    const a = rentalProperties(wh.request.input.household)[0]!;
    const k = `sav/${a.id}/property`;
    expect(fieldOf(wh, `${k}/share`).get(wh).warn ?? null).toBeNull();
    wh = fieldOf(wh, `${k}/share`).set(wh, "0.5");
    expect(fieldOf(wh, `${k}/share`).get(wh).warn).toContain("計算はまだ全部を名義の人の分として扱います");
    wh = fieldOf(wh, `${k}/kind`).set(wh, "lodging");
    expect(fieldOf(wh, `${k}/kind`).get(wh).warn ?? null).toBeNull();
    expect(fieldOf(wh, `${k}/kind`).help).toContain(LODGING_NOTE);
    expect(LODGING_NOTE).not.toContain("不動産所得として計算しています");
    expect(LODGING_NOTE).toContain("消費税と、個人事業税は計算しません");
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
  it("物件名・種類・評価額・ローン残高・月の収入（空室率を引いた後）と合計の行", () => {
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
      { id: a.id, name: "物件1", kind: null, value: 18_000_000, loan: 9_500_000, income: Math.floor(95_000 * 0.95) },
      { id: b.id, name: "月極の駐車場", kind: "駐車場", value: 5_000_000, loan: 0, income: 54_000 },
    ]);
    expect(ov.total).toEqual({ value: 23_000_000, loan: 9_500_000, income: Math.floor(95_000 * 0.95) + 54_000 });
    const html = renderToString(h(RentalOverview, { wh }));
    expect(html).toContain("data-rental-overview");
    expect(html).toContain("月の収入（空室率を引いた後）");
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

describe("お金の欄（0080）", () => {
  const actionOf = (wh: WorkingHousehold, key: string) => {
    const x = stageOf(wh).sections[0]!.groups.flatMap((g) => g.actions).find((y) => y.key === key);
    if (x === undefined) throw new Error(`操作が無い: ${key}`);
    return x;
  };
  const rows = (wh: WorkingHousehold, row: string, ym: string, formula?: string) =>
    full(wh.request).flows.filter((f) => f.row === row && f.ym === ym && (formula === undefined || f.formula === formula)).reduce((s0, f) => s0 + f.amount, 0);
  const groupTitles = (wh: WorkingHousehold) => stageOf(wh).sections[0]!.groups.map((g) => g.title).filter((t) => t !== undefined);

  it("今の世帯（新しい欄を入れていない）の計算の結果は変わらない: 欄を足しても、入れなければ要求は同じ", () => {
    const wh = open();
    const before = JSON.stringify(wh.request);
    for (const st of buildStages(wh)) void allFields(st);
    expect(JSON.stringify(wh.request)).toBe(before);
  });

  it("取得価額の内訳（詳細）: 入れると取得価額は内訳の合計になり、土地の割合の既定は内訳の土地の割合。建物附属設備を入れると耐用年数の欄が出る。諸費用・自己資金は取得の中", () => {
    let wh = addRentalProperty(blankHousehold("2026-10", seq()));
    const a = rentalProperties(wh.request.input.household)[0]!;
    const k = `sav/${a.id}/property`;
    expect(fieldOf(wh, `${k}/part/land`).level).toBe("detail");
    expect(allFields(stageOf(wh)).some((f) => f.key === `${k}/acqCosts`)).toBe(false);
    wh = fieldOf(wh, `${k}/part/land`).set(wh, 6_000_000);
    wh = fieldOf(wh, `${k}/part/building`).set(wh, 12_000_000);
    expect(allFields(stageOf(wh)).some((f) => f.key === `${k}/equipmentLife`)).toBe(false);
    wh = fieldOf(wh, `${k}/part/equipment`).set(wh, 2_000_000);
    expect(prop(wh, a.id).acquisition).toEqual({ price: 20_000_000, at: "2026-10", parts: { land: 6_000_000, building: 12_000_000, equipment: 2_000_000 } });
    const price = fieldOf(wh, `${k}/acqPrice`);
    expect(price.readOnly).toBeDefined();
    expect(price.get(wh)).toMatchObject({ value: 20_000_000, derived: "内訳の合計" });
    expect(fieldOf(wh, `${k}/landShare`).get(wh)).toMatchObject({ value: "0.3", implicit: true });
    expect(fieldOf(wh, `${k}/equipmentLife`).get(wh)).toMatchObject({ value: 15, implicit: true });
    for (const key of ["acqCosts", "equity"]) expect(fieldOf(wh, `${k}/${key}`).level).toBe("detail");
    wh = fieldOf(wh, `${k}/acqCosts`).set(wh, 1_000_000);
    wh = fieldOf(wh, `${k}/equity`).set(wh, 5_000_000);
    expect(prop(wh, a.id).acquisition).toMatchObject({ costs: 1_000_000, equity: 5_000_000 });
    expect(() => preview(wh.request)).not.toThrow();
    // 内訳を消すと取得価額は残りの内訳の合計になり、全部消すと最後の合計のまま、取得価額の欄で直せるようになる
    wh = fieldOf(wh, `${k}/part/land`).set(wh, null);
    expect(prop(wh, a.id).acquisition?.price).toBe(14_000_000);
    for (const key of ["building", "equipment"]) wh = fieldOf(wh, `${k}/part/${key}`).set(wh, null);
    expect(prop(wh, a.id).acquisition).toEqual({ price: 2_000_000, at: "2026-10", costs: 1_000_000, equity: 5_000_000 });
    expect(fieldOf(wh, `${k}/acqPrice`).readOnly).toBeUndefined();
  });

  it("家賃以外の月の収入・礼金と更新料（詳細）は家賃と同じ空室の割合で、一覧表の月の収入に入る", () => {
    let wh = open();
    const a = rentalProperties(wh.request.input.household)[0]!;
    const k = `sav/${a.id}/property`;
    for (const key of ["commonFee", "parking", "otherMonthly", "keyMoney"]) expect(fieldOf(wh, `${k}/${key}`).level, key).toBe("detail");
    const before = rentalOverview(wh)!.rows[0]!.income;
    wh = fieldOf(wh, `${k}/commonFee`).set(wh, 5_000);
    wh = fieldOf(wh, `${k}/parking`).set(wh, 10_000);
    wh = fieldOf(wh, `${k}/keyMoney`).set(wh, 200_000);
    expect(prop(wh, a.id).rental).toMatchObject({ commonFee: 5_000, parking: 10_000, keyMoney: 200_000 });
    expect(rentalOverview(wh)!.rows[0]!.income).toBe(before + Math.floor(15_000 * (1 - Number(prop(wh, a.id).rental!.vacancyRate ?? "0"))));
    expect(() => preview(wh.request)).not.toThrow();
  });

  it("経費の費目（詳細）: 1つでも入れたら、年額の欄は費目の合計（書き換えられない）。地代は借地権のとき、民泊・宿の費目は民泊・宿のとき出す", () => {
    let wh = addRentalProperty(blankHousehold("2026-10", seq()));
    const a = rentalProperties(wh.request.input.household)[0]!;
    const k = `sav/${a.id}/property`;
    const has = (key: string) => allFields(stageOf(wh)).some((f) => f.key === `${k}/expItem/${key}`);
    expect(["management", "propertyTax", "insurance", "facility", "leasing", "other"].every(has)).toBe(true);
    expect(["groundRent", "cleaning", "supplies", "utilities"].some(has)).toBe(false);
    wh = fieldOf(wh, `${k}/expAnnual`).set(wh, 300_000);
    expect(fieldOf(wh, `${k}/expAnnual`).readOnly).toBeUndefined();
    wh = fieldOf(wh, `${k}/expItem/management`).set(wh, 120_000);
    wh = fieldOf(wh, `${k}/expItem/propertyTax`).set(wh, 80_000);
    expect(fieldOf(wh, `${k}/expAnnual`).readOnly).toBeDefined();
    expect(fieldOf(wh, `${k}/expAnnual`).get(wh)).toMatchObject({ value: 200_000, derived: "費目の合計" });
    wh = fieldOf(wh, `${k}/tenure`).set(wh, "leasehold");
    expect(has("groundRent")).toBe(true);
    wh = fieldOf(wh, `${k}/kind`).set(wh, "lodging");
    expect(["cleaning", "supplies", "utilities"].every(has)).toBe(true);
    expect(has("leasing")).toBe(false);
    expect(() => preview(wh.request)).not.toThrow();
  });

  it("大きな修繕の予定（詳細）: 年月・金額・中身の行を足せ、その月の一時の支出に出る。持ち帰り用のレポートでは中身を外す", () => {
    let wh = open();
    const a = rentalProperties(wh.request.input.household)[0]!;
    const k = `sav/${a.id}/property`;
    const add = actionOf(wh, `${k}/addRepair`);
    expect(add.level).toBe("detail");
    wh = add.run(wh);
    const r = prop(wh, a.id).repairs![0]!;
    expect(groupTitles(wh)).toContain("大きな修繕 1");
    wh = fieldOf(wh, `${k}/repair/${r.id}/amount`).set(wh, 4_000_000);
    wh = fieldOf(wh, `${k}/repair/${r.id}/label`).set(wh, "外壁と屋上防水");
    expect(groupTitles(wh)).toContain("大きな修繕 1（外壁と屋上防水）");
    expect(rows(wh, "cf.expense.other.realEstate", "2031-10", "asset.realEstate.repair")).toBe(4_000_000);
    const out = JSON.stringify(sanitizeRequest(wh.request, new IdMap()));
    expect(out).not.toContain("外壁と屋上防水");
    wh = actionOf(wh, `${k}/repair/${r.id}/remove`).run(wh);
    expect(prop(wh, a.id).repairs).toBeUndefined();
  });

  it("物件のローン: 借入先（負債の名前）・団信を出し、詳細で金利の段階・繰上返済・借り換えを足せる", () => {
    let wh = open();
    const a = rentalProperties(wh.request.input.household)[0]!;
    const d = (wh.request.input.household.debts ?? []).find((x) => x.property === a.id)!;
    const k = `housing/debt/${d.id}`;
    const keys = allFields(stageOf(wh)).map((f) => f.key);
    for (const key of ["label", "principal", "start", "rate", "term", "method", "creditLife"]) expect(keys, key).toContain(`${k}/${key}`);
    wh = fieldOf(wh, `${k}/label`).set(wh, "架空銀行");
    expect(groupTitles(wh)).toContain("この物件のローン（架空銀行）");
    for (const key of ["addRate", "addPrepay", "addRefinance"]) expect(actionOf(wh, `${k}/${key}`).level, key).toBe("detail");
    wh = actionOf(wh, `${k}/addRefinance`).run(wh);
    expect(groupTitles(wh)).toContain("借り換え 1");
    wh = fieldOf(wh, `${k}/refinance/0/rate`).set(wh, "0.015");
    wh = fieldOf(wh, `${k}/refinance/0/costs`).set(wh, 500_000);
    expect((wh.request.input.household.debts ?? []).find((x) => x.id === d.id)!.refinance![0]).toMatchObject({ termMonths: 240, costs: 500_000, rateSchedule: [{ type: "fixed", rate: "0.015" }] });
    wh = actionOf(wh, `${k}/addPrepay`).run(wh);
    expect(groupTitles(wh)).toContain("繰上返済 1");
    expect(() => preview(wh.request)).not.toThrow();
  });

  it("民泊・宿: 種類で入れ方が変わる（営業の形・売上の入れ方・1泊の単価・稼働率・営業日数か月の売上の見込み、仲介サイトの手数料）。空室の割合は出さない。住宅宿泊事業で180日を超えたら知らせる", () => {
    let wh = addRentalProperty(blankHousehold("2026-10", seq()));
    const a = rentalProperties(wh.request.input.household)[0]!;
    const k = `sav/${a.id}/property`;
    wh = fieldOf(wh, `${k}/kind`).set(wh, "lodging");
    expect(prop(wh, a.id).lodging).toEqual({});
    expect(groupTitles(wh)).toContain("宿泊の売上");
    const keys = () => allFields(stageOf(wh)).map((f) => f.key);
    expect(keys()).not.toContain(`${k}/vacancy`);
    expect(keys()).not.toContain(`${k}/commonFee`);
    expect(fieldOf(wh, `${k}/rent`).label).toBe("月の売上の見込み");
    expect(fieldOf(wh, `${k}/expRate`).label).toBe("運営代行の手数料（売上に対する割合）");
    expect(keys()).toContain(`${k}/platformRate`);
    wh = fieldOf(wh, `${k}/lodgingBusiness`).set(wh, "privateLodging");
    wh = fieldOf(wh, `${k}/salesBy`).set(wh, "night");
    expect(keys()).not.toContain(`${k}/rent`);
    wh = fieldOf(wh, `${k}/nightly`).set(wh, 20_000);
    wh = fieldOf(wh, `${k}/occupancy`).set(wh, "0.6");
    expect(fieldOf(wh, `${k}/days`).get(wh)).toMatchObject({ value: 180, implicit: true });
    expect(fieldOf(wh, `${k}/days`).get(wh).warn ?? null).toBeNull();
    wh = fieldOf(wh, `${k}/days`).set(wh, 250);
    expect(fieldOf(wh, `${k}/days`).get(wh).warn).toContain("180日で計算しています");
    // 一覧表の月の収入: 20,000×0.6×180÷12
    expect(rentalOverview(wh)!.rows[0]!.income).toBe(180_000);
    expect(rows(wh, "cf.income.other.rental", "2027-01")).toBe(180_000);
    // 欄を空にしても入れ方は残り、種類を変えると外れる
    wh = fieldOf(wh, `${k}/lodgingBusiness`).set(wh, null);
    expect(prop(wh, a.id).lodging).toBeDefined();
    wh = fieldOf(wh, `${k}/kind`).set(wh, "condo");
    expect(prop(wh, a.id).lodging).toBeUndefined();
    expect(keys()).toContain(`${k}/vacancy`);
  });
});

describe("税と出口（0081）", () => {
  const groupOf = (wh: WorkingHousehold, key: string) => stageOf(wh).sections[0]!.groups.find((g) => g.key === key);
  const flowsOf = (wh: WorkingHousehold) => full(wh.request).flows;

  it("売却: 「売ったときに、この物件のローンを返す」（詳細・既定はオン）。オンなら売る月に残りを返し、譲渡所得の税を翌年3月・翌年度に出す", () => {
    let wh = open();
    const a = rentalProperties(wh.request.input.household)[0]!;
    const k = `sav/${a.id}/property`;
    expect(allFields(stageOf(wh)).some((f) => f.key === `${k}/saleRepay`)).toBe(false);
    wh = fieldOf(wh, `${k}/sell`).set(wh, true);
    expect(fieldOf(wh, `${k}/sell`).help).toContain("譲渡所得の税");
    const repay = fieldOf(wh, `${k}/saleRepay`);
    expect(repay).toMatchObject({ level: "detail", label: "売ったときに、この物件のローンを返す" });
    expect(repay.get(wh)).toMatchObject({ value: true, implicit: true });
    wh = fieldOf(wh, `${k}/salePrice`).set(wh, 30_000_000);
    const at = (prop(wh, a.id).sale!.at as { at: string }).at;
    const f1 = flowsOf(wh);
    expect(f1.some((f) => f.formula === "debt.schedule.salePayoff" && f.ym === at)).toBe(true);
    const saleYear = Number(at.slice(0, 4));
    expect(f1.find((f) => f.row === "cf.taxSi.incomeTax.realEstateSale")?.ym).toBe(`${saleYear + 1}-03`);
    expect(f1.filter((f) => f.row === "cf.taxSi.residentTax.realEstateSale").map((f) => f.ym)).toEqual([`${saleYear + 1}-06`, `${saleYear + 1}-08`, `${saleYear + 1}-10`, `${saleYear + 2}-01`]);
    // オフ: 欄に false を書き、返済は予定のまま。オンに戻すと省略に戻る
    wh = fieldOf(wh, `${k}/saleRepay`).set(wh, false);
    expect(prop(wh, a.id).sale!.repayLoan).toBe(false);
    expect(flowsOf(wh).some((f) => f.formula === "debt.schedule.salePayoff")).toBe(false);
    wh = fieldOf(wh, `${k}/saleRepay`).set(wh, true);
    expect(prop(wh, a.id).sale!.repayLoan).toBeUndefined();
  });

  it("民泊・宿の所得の区分（詳細）: 空欄は営業の形から（住宅宿泊事業は雑所得、旅館業は事業所得）。入れた区分で計算する", () => {
    let wh = addRentalProperty(blankHousehold("2026-10", seq()));
    const a = rentalProperties(wh.request.input.household)[0]!;
    const k = `sav/${a.id}/property`;
    wh = fieldOf(wh, `${k}/kind`).set(wh, "lodging");
    wh = fieldOf(wh, `${k}/lodgingBusiness`).set(wh, "privateLodging");
    const kind = () => fieldOf(wh, `${k}/incomeKind`);
    expect(kind()).toMatchObject({ level: "detail", label: "所得の区分" });
    expect(kind().get(wh)).toMatchObject({ value: "miscellaneous", implicit: true });
    expect(kind().help).toContain("雑所得の赤字は給与などほかの所得から引けません");
    wh = fieldOf(wh, `${k}/lodgingBusiness`).set(wh, "inn");
    expect(kind().get(wh)).toMatchObject({ value: "business", implicit: true });
    wh = kind().set(wh, "realEstate");
    expect(prop(wh, a.id).lodging!.incomeKind).toBe("realEstate");
    expect(() => preview(wh.request)).not.toThrow();
  });

  it("申告（物件の持ち主ごと・詳細）: 申告の仕方は既定で白色（10万円までの人は推定の印なし）。青色にすると青色申告特別控除（既定10万円）を選べ、事業的規模の目安に当たらないのに55万円・65万円なら知らせる", () => {
    let wh = open();
    const a = rentalProperties(wh.request.input.household)[0]!;
    const g = `rental/taxReturn/${a.owner}`;
    const member = () => wh.request.input.household.members.find((m) => m.id === a.owner)!;
    expect(groupOf(wh, g)).toMatchObject({ level: "detail" });
    expect(groupOf(wh, g)!.title).toMatch(/^申告（/);
    expect(fieldOf(wh, `${g}/method`).get(wh)).toMatchObject({ value: "white", implicit: true });
    expect(allFields(stageOf(wh)).some((f) => f.key === `${g}/blueDeduction`)).toBe(false);
    // 事業的規模の目安（見せるだけ。最終の判断は税理士に、は「?」の中）
    const scale = () => fieldOf(wh, `${g}/scale`);
    expect(scale().readOnly).toBeDefined();
    expect(scale().get(wh).value).toBe("当たりません");
    expect(scale().help).toContain("最終の判断は税理士");
    wh = fieldOf(wh, `${g}/method`).set(wh, "blue");
    expect(member().taxReturn).toEqual({ method: "blue" });
    expect(fieldOf(wh, `${g}/blueDeduction`).get(wh)).toMatchObject({ value: "simple", implicit: true });
    wh = fieldOf(wh, `${g}/blueDeduction`).set(wh, "doubleEntry");
    expect(member().taxReturn).toEqual({ method: "blue", blueDeduction: "doubleEntry" });
    expect(fieldOf(wh, `${g}/blueDeduction`).get(wh).warn).toContain("10万円で計算しています");
    // 一棟アパート10戸にすると目安に当たり、知らせは消える
    const k = `sav/${a.id}/property`;
    wh = fieldOf(wh, `${k}/kind`).set(wh, "apartment");
    wh = fieldOf(wh, `${k}/units`).set(wh, 10);
    expect(scale().get(wh).value).toBe("当たります（10室）");
    expect(fieldOf(wh, `${g}/blueDeduction`).get(wh).warn ?? null).toBeNull();
    expect(() => preview(wh.request)).not.toThrow();
    // 白色に戻すと白色と書き（入れていない＝省略の白色と見分ける。青色の区分は外す）、空にすると申告の欄ごと外れる（0155）
    wh = fieldOf(wh, `${g}/method`).set(wh, "white");
    expect(member().taxReturn).toEqual({ method: "white" });
    expect(fieldOf(wh, `${g}/method`).get(wh).implicit).toBeUndefined();
    wh = fieldOf(wh, `${g}/method`).set(wh, null);
    expect(member().taxReturn).toBeUndefined();
  });

  it("物件の無い世帯には申告のまとまりを出さない", () => {
    const wh = blankHousehold("2026-10", seq());
    expect(stageOf(wh).sections[0]!.groups.some((g) => g.key.startsWith("rental/taxReturn/"))).toBe(false);
  });
});
