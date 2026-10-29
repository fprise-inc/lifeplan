// 車のカードの中身（0069）: 下取りの残価の目安・維持費の入れ方（両方の値を残す・名前つきの行）・手放した後の移動の費用と修理費のひな形・
// 続きの車・今返している自動車ローン（住まい・ローンのカードから移した）・一生の費用の見出し
import { describe, expect, it } from "vitest";
import type { Car } from "../src/engine/types.ts";
import { allFields, resolveTimepoint, type FieldDef, type StageDef } from "../src/workspace/input/form.ts";
import { fromRequest, mutate, type WorkingHousehold } from "../src/workspace/input/household.ts";
import { itemStage } from "../src/workspace/input/items.ts";
import { addAfterCar, addCar, addNextCar, addRepair, breakdownAnnual, lifetimeCost, REST_LABEL, residualRate, setUpkeepMode, tradeInEstimate, upkeepAnnual, upkeepMode } from "../src/workspace/input/stages/cars.ts";
import { buildStage } from "../src/workspace/input/stages/index.ts";
import { fieldStatus } from "../src/workspace/input/valueState.ts";
import { modelHousehold, preview } from "./helpers.ts";

const ids = () => {
  let n = 0;
  return () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`;
};
const open = (id: string): WorkingHousehold => fromRequest(modelHousehold(id));
const fieldOf = (wh: WorkingHousehold, suffix: string) => allFields(buildStage("car", wh)).find((f) => f.key.endsWith(suffix)) as FieldDef;
const car0 = (wh: WorkingHousehold) => wh.request.input.household.cars![0]!;
const carRows = (wh: WorkingHousehold, id: string, year: number) => preview(wh.request).table.filter((c) => c.object === id && c.year === year && c.row === "cf.expense.living.car").reduce((s, c) => s + c.amount, 0);

describe("下取りの残価の目安（ひな形）", () => {
  it("3年50%・5年35%・8年15%・10年以上5%、その間はならす", () => {
    expect(residualRate(1)).toBe(0.5);
    expect(residualRate(3)).toBe(0.5);
    expect(residualRate(4)).toBeCloseTo(0.425);
    expect(residualRate(8)).toBeCloseTo(0.15);
    expect(residualRate(9)).toBeCloseTo(0.1);
    expect(residualRate(15)).toBe(0.05);
    expect(tradeInEstimate(2500000, 8)).toMatchObject({ value: 380000 });
    expect(tradeInEstimate(2500000, 8).basis).toContain("ひな形の目安");
  });

  it("推定のままの下取りは、価格・周期を直したら目安を入れ直す。打った下取りは変えない", () => {
    let wh = addCar(open("salariedCoupleTwoKids"), ids());
    wh = fieldOf(wh, "/price").set(wh, 4000000);
    expect(car0(wh).purchase.tradeIn).toBe(600000);
    wh = fieldOf(wh, "/every").set(wh, 5);
    expect(car0(wh).purchase.tradeIn).toBe(1400000);
    expect(fieldStatus(fieldOf(wh, "/every"), wh).status).toBe("confirmed");
    expect(fieldStatus(fieldOf(wh, "/tradeIn"), wh).status).toBe("estimated");
    wh = fieldOf(wh, "/tradeIn").set(wh, 1000000);
    wh = fieldOf(wh, "/price").set(wh, 3000000);
    expect(car0(wh).purchase.tradeIn).toBe(1000000);
    expect(fieldStatus(fieldOf(wh, "/tradeIn"), wh).status).toBe("confirmed");
  });

  it("簡易は名義・次の買い替えの時期・周期・価格・買い方・維持費の合計・手放す時期。下取り・今の車か・入れ方・万一は詳細", () => {
    const wh = addCar(open("salariedCoupleTwoKids"), ids());
    const simple = allFields(buildStage("car", wh)).filter((f) => f.level === "simple" && f.key.startsWith("ev/car/")).map((f) => f.key.split("/").at(-1));
    expect(simple).toEqual(["owner", "first", "every", "price", "pay", "upkeep", "untilAge"]);
    const detail = allFields(buildStage("car", wh)).filter((f) => f.level === "detail" && f.key.startsWith("ev/car/")).map((f) => f.key.split("/").slice(3).join("/"));
    expect(detail).toEqual(expect.arrayContaining(["tradeIn", "owned", "upkeepMode", "growth", "on/mode"]));
  });
});

describe("維持費の入れ方（合計／内訳。両方の値を残す）", () => {
  it("内訳へ: 初めては目安で分ける（推定）。合計へ戻しても内訳は残り、計算は入れ方の側だけ", () => {
    let wh = addCar(open("salariedCoupleTwoKids"), ids());
    const id = car0(wh).id;
    const before = carRows(wh, id, 2028);
    wh = setUpkeepMode(wh, id, "detail");
    expect(car0(wh)).toMatchObject({ upkeepMode: "detail", upkeep: { annual: 360000 }, tax: { annual: 36000 }, insurance: { annual: 70000 }, inspection: { amount: 100000 }, fuel: { annual: 204000 } });
    for (const s of ["/tax", "/insurance", "/inspection", "/fuel"]) expect(fieldStatus(fieldOf(wh, s), wh).status, s).toBe("estimated");
    // 合計に戻す: 合計の値（36万円）を数え、内訳は残すが数えない
    const back = setUpkeepMode(fieldOf(wh, "/parking").set(wh, 120000), id, "total");
    expect(car0(back).parking).toEqual({ annual: 120000 });
    expect(upkeepAnnual(car0(back))).toBe(360000);
    expect(carRows(back, id, 2028)).toBe(before);
  });

  it("内訳→合計→合計を直した→内訳: 内訳は前のまま、差は「その他（まだ分けていない）」の行（推定）", () => {
    let wh = addCar(open("salariedCoupleTwoKids"), ids());
    const id = car0(wh).id;
    wh = setUpkeepMode(wh, id, "detail");
    const parts = breakdownAnnual(car0(wh));
    wh = setUpkeepMode(wh, id, "total");
    wh = fieldOf(wh, "/upkeep").set(wh, 400000);
    wh = setUpkeepMode(wh, id, "detail");
    const rest = car0(wh).upkeepOther!.find((o) => o.label === REST_LABEL)!;
    expect(rest.annual).toBe(400000 - parts);
    expect(breakdownAnnual(car0(wh))).toBe(400000);
    expect(fieldOf(wh, `/other/${rest.id}/annual`).get(wh).assumed).toContain("内訳の差");
    // 名前つきの行を足して計算に入る（車の維持費の行）
    wh = buildStage("car", wh).sections[0]!.groups.flatMap((g) => g.actions).find((a) => a.key.endsWith("/other/add"))!.run(wh);
    const row = car0(wh).upkeepOther!.at(-1)!;
    wh = fieldOf(wh, `/other/${row.id}/annual`).set(wh, 24000);
    wh = fieldOf(wh, `/other/${row.id}/label`).set(wh, "スタッドレスタイヤ");
    expect(car0(wh).upkeepOther!.at(-1)).toEqual({ id: row.id, label: "スタッドレスタイヤ", annual: 24000 });
    const r = preview(wh.request);
    expect(r.table.some((c) => c.object === id && c.row === "cf.expense.living.car")).toBe(true);
  });

  it("入れ方の無い古い車は、入っている物から入れ方を読み、開いただけでは書き換えない", () => {
    const wh = open("unexplainedSpending");
    const before = JSON.stringify(wh.request);
    buildStage("car", wh);
    expect(JSON.stringify(wh.request)).toBe(before);
    for (const c of wh.request.input.household.cars ?? []) {
      expect(c.upkeepMode).toBeUndefined();
      expect(upkeepMode(c)).toBe(c.upkeep !== undefined ? "total" : "detail");
    }
  });
});

describe("車のひな形のボタン（出来事に結ぶ）", () => {
  const withUntil = (): WorkingHousehold => {
    let wh = addCar(open("salariedCoupleTwoKids"), ids());
    wh = fieldOf(wh, "/untilAge").set(wh, 75);
    return wh;
  };

  it("手放した後の移動の費用: 出来事「車を手放す」の翌月から毎月（推定）。手放す時期を動かすと一緒に動く", () => {
    let wh = withUntil();
    const c = car0(wh);
    const act = buildStage("car", wh).sections[0]!.groups.flatMap((g) => g.actions).find((a) => a.key.endsWith("/afterCar"));
    expect(act?.level).toBe("simple");
    expect(act?.label).toBe("＋ 手放した後の移動の費用を足す");
    wh = addAfterCar(wh, c.id);
    const h = wh.request.input.household;
    const ev = h.events!.find((e) => e.kind === "carRelease")!;
    expect(car0(wh).until).toEqual({ event: ev.id });
    const row = h.periodicExpenses!.find((p) => p.label?.startsWith("手放した後の移動の費用"))!;
    expect(row).toMatchObject({ kind: "car", row: "cf.expense.living.car", monthly: true, from: { event: ev.id, offset: { years: 0, months: 1 } }, to: null });
    expect(row.amount.state).toBe("estimated");
    expect(fieldStatus(fieldOf(wh, `ev/${row.id}/amount`), wh).basis).toBe("よくある額の目安（手放した後の移動の費用 月1万円。この世帯に合わせて直してください）");
    // 車のカードに出る。ボタンは消える
    expect(buildStage("car", wh).sections.find((s) => s.key === "money/car/out")!.groups.some((g) => g.key === `ev/${row.id}`)).toBe(true);
    expect(buildStage("car", wh).sections[0]!.groups.flatMap((g) => g.actions).some((a) => a.key.endsWith("/afterCar"))).toBe(false);
    const start1 = resolveTimepoint(wh.request.input.household, row.from);
    wh = fieldOf(wh, "/untilAge").set(wh, 70);
    const start2 = resolveTimepoint(wh.request.input.household, wh.request.input.household.periodicExpenses!.find((p) => p.id === row.id)!.from);
    expect(Number(start1!.slice(0, 4)) - Number(start2!.slice(0, 4))).toBe(5);
    expect(() => preview(wh.request)).not.toThrow();
  });

  it("古くなってからの修理費: 周期10年以上か、手放すまで買い替えない車にボタン。始まりは購入から10年後、終わりは手放す時期", () => {
    let wh = withUntil();
    const id = car0(wh).id;
    expect(buildStage("car", wh).sections[0]!.groups.flatMap((g) => g.actions).some((a) => a.key.endsWith("/repair"))).toBe(false);
    wh = fieldOf(wh, "/every").set(wh, 12);
    expect(buildStage("car", wh).sections[0]!.groups.flatMap((g) => g.actions).find((a) => a.key.endsWith("/repair"))?.label).toBe("＋ 古くなってからの修理費を足す");
    wh = addRepair(wh, id);
    const h = wh.request.input.household;
    const row = h.periodicExpenses!.find((p) => p.label === "古くなってからの修理費")!;
    const purchase = h.events!.find((e) => e.kind === "carPurchase")!;
    // 今の車は、次の買い替えの周期（12年）の前に買ったとみなす: 購入の出来事から −2年
    expect(row.from).toEqual({ event: purchase.id, offset: { years: -2, months: 0 } });
    expect(row.to?.event).toBe(h.events!.find((e) => e.kind === "carRelease")!.id);
    expect(row.everyYears).toBe(1);
    expect(fieldStatus(fieldOf(wh, `ev/${row.id}/amount`), wh)).toMatchObject({ status: "estimated", basis: "よくある額の目安（古くなってからの修理費 年10万円。この世帯に合わせて直してください）" });
    expect(fieldStatus(fieldOf(wh, `ev/${row.id}/every`), wh)).toMatchObject({ status: "estimated", basis: "よくある間隔の目安（古くなってからの修理費 毎年。この世帯に合わせて直してください）" });
    expect(() => preview(wh.request)).not.toThrow();
  });

  it("この車の続きを足す: 手放した翌月に、同じ欄のこれから買う車。推定の印も写す", () => {
    let wh = withUntil();
    const id = car0(wh).id;
    wh = addNextCar(wh, id, "00000000-0000-4000-8000-0000000000aa");
    const [a, b] = wh.request.input.household.cars! as [Car, Car];
    const ev = wh.request.input.household.events!.find((e) => e.kind === "carRelease")!;
    expect(a.until).toEqual({ event: ev.id });
    expect(b).toMatchObject({ purchase: { first: { event: ev.id, offset: { years: 0, months: 1 } }, owned: false, price: a.purchase.price }, until: null });
    expect(wh.assumed[`ev/car/${b.id}/price`]).toBe(wh.assumed[`ev/car/${a.id}/price`]);
    expect(() => preview(wh.request)).not.toThrow();
  });
});

describe("今返している自動車ローン・一生の費用・カードの要約", () => {
  it("自動車ローン（今返している）は車のカードで入れ、住まい・ローンのカードは読むだけの1行", () => {
    const wh0 = open("salariedCoupleTwoKids");
    const sec = (wh: WorkingHousehold) => buildStage("car", wh).sections.find((s) => s.key === "car/loans")!;
    expect((itemStage(wh0, "housing") as StageDef).sections.flatMap((s) => s.actions).some((a) => a.key === "housing/addCarLoan")).toBe(false);
    const wh = sec(wh0).actions.find((a) => a.key === "car/addCarLoan")!.run(wh0);
    const d = wh.request.input.household.debts!.find((x) => x.kind === "car")!;
    expect(sec(wh).groups.some((g) => g.key === `housing/debt/${d.id}`)).toBe(true);
    const housing = itemStage(wh, "housing") as StageDef;
    expect(housing.sections.flatMap((s) => s.groups).some((g) => g.key === `housing/debt/${d.id}`)).toBe(false);
    expect(allFields(housing).find((f) => f.key === "ro/housing/carLoans")?.readOnly).toBe("車の項目で入れます");
    // 車が無くても、ローンがあれば車のカードは物がある
    expect(buildStage("car", wh).sections[0]!.groups).toEqual([]);
  });

  it("見出しにこの車の一生の費用（今の値段で）。買い替えの回数と維持費の年額", () => {
    const wh = addCar(open("salariedCoupleTwoKids"), ids());
    const c = car0(wh);
    const life = lifetimeCost(wh.request.input.household, c, wh.request.input.baseMonth, wh.request.input.endYear)!;
    expect(life.purchases).toBeGreaterThan(3);
    expect(life.total).toBeGreaterThan(life.purchases * (c.purchase.price - (c.purchase.tradeIn ?? 0)));
    const head = buildStage("car", wh).sections[0]!.groups.find((g) => g.key === `ev/car/${c.id}`)!;
    expect(head.note).toMatch(/^この車の一生の費用（今の値段で・最後まで）約[\d,.]+万円（買い替え\d+回・維持費 年36万円/);
  });

  it("車を持たない移動の費用: 空のときカーシェアのひな形（月1万円・推定・車の維持費の行）", () => {
    const wh0 = open("salariedCoupleTwoKids");
    const sec = buildStage("car", wh0).sections.find((s) => s.key === "money/car/out")!;
    const wh = sec.actions.find((a) => a.key === "money/car/out/template/carshare")!.run(wh0);
    const p = wh.request.input.household.periodicExpenses!.at(-1)!;
    expect(sec.actions.find((a) => a.key === "money/car/out/template/carshare")!.label).toBe("＋ カーシェア・レンタカー");
    expect(p).toMatchObject({ label: "カーシェア・レンタカー", kind: "car", row: "cf.expense.living.car", monthly: true, amount: { value: 10000, state: "estimated" } });
    expect(fieldStatus(fieldOf(wh, `ev/${p.id}/amount`), wh).basis).toBe("よくある額の目安（カーシェア・レンタカー 月1万円。この世帯に合わせて直してください）");
    // 毎月の行には何年ごとの仮の印を付けない
    expect(wh.assumed[`ev/${p.id}/every`]).toBeUndefined();
    expect(mutate(wh, () => undefined).request.input.household.cars).toBeUndefined();
  });
});
