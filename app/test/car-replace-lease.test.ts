// 車の買い替え（買い替え続ける・この1台だけ・○歳まで）・リースと長期レンタル・時点の入れ方・手放した後の移動の費用（0101）
import { describe, expect, it } from "vitest";
import type { Car } from "../src/engine/types.ts";
import { carPurchaseYms } from "../src/workspace/input/carPurchases.ts";
import { allFields, resolveTimepoint, type FieldDef, type GroupDef } from "../src/workspace/input/form.ts";
import { fromRequest, mutate, type WorkingHousehold } from "../src/workspace/input/household.ts";
import { inputItems } from "../src/workspace/input/items.ts";
import { scheduleItems } from "../src/workspace/input/schedule.ts";
import { addCar, addLeaseCar, addNextCar, LEASE_UNENTERED, lastCarOfHousehold, lifetimeCost, setReplace, setUpkeepMode, upkeepEstimate } from "../src/workspace/input/stages/cars.ts";
import { buildStage } from "../src/workspace/input/stages/index.ts";
import { fieldStatus } from "../src/workspace/input/valueState.ts";
import { strictShown, type WhenCtx } from "../src/workspace/input/when.ts";
import { modelHousehold, preview } from "./helpers.ts";

const ids = () => {
  let n = 0;
  return () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`;
};
const open = (id: string): WorkingHousehold => fromRequest(modelHousehold(id));
const stage = (wh: WorkingHousehold) => buildStage("car", wh);
const fieldOf = (wh: WorkingHousehold, suffix: string) => allFields(stage(wh)).find((f) => f.key.endsWith(suffix)) as FieldDef;
const fieldsOf = (wh: WorkingHousehold, carId: string, level?: "simple" | "detail") =>
  allFields(stage(wh))
    .filter((f) => f.key.startsWith(`ev/car/${carId}/`) && (level === undefined || f.level === level))
    .map((f) => f.key.slice(`ev/car/${carId}/`.length));
const carOf = (wh: WorkingHousehold, id: string) => wh.request.input.household.cars!.find((c) => c.id === id)!;
const groups = (wh: WorkingHousehold): GroupDef[] => stage(wh).sections[0]!.groups;
const buys = (wh: WorkingHousehold, id: string) =>
  preview(wh.request)
    .table.filter((c) => c.object === id && c.row === "cf.expense.lumpSum.car")
    .map((c) => c.year);
const addAt = (ym: (base: string) => string) => (wh: WorkingHousehold, carId: string) =>
  mutate(wh, (h, req) => {
    const c = h.cars!.find((x) => x.id === carId)!;
    c.purchase!.first = { at: ym(req.input.baseMonth) };
  });
const yearPlus = (base: string, y: number) => `${Number(base.slice(0, 4)) + y}${base.slice(4)}`;

describe("買い替えの欄（0101）", () => {
  it("名義のすぐ下。標準は「買い替え続ける（○年ごと）」「この1台だけ」、詳細は「○歳まで買い替える」も。どの車も買い替え続けるで始まる", () => {
    const gen = ids();
    let wh = addCar(open("salariedCoupleTwoKids"), gen);
    wh = addCar(wh, gen, false);
    const [a, b] = wh.request.input.household.cars! as [Car, Car];
    expect(a.purchase?.replace).toBeUndefined();
    expect(b.purchase?.replace).toBeUndefined();
    expect(fieldsOf(wh, a.id, "simple").slice(0, 2)).toEqual(["owner", "replace"]);
    const simple = allFields(stage(wh)).find((f) => f.key === `ev/car/${b.id}/replace`)!;
    expect(simple.kind === "select" && simple.options.map((o) => o.label)).toEqual(["買い替え続ける（8年ごと）", "この1台だけ（買い替えない）"]);
    expect(simple.simpleOnly).toBe(true);
    const detail = allFields(stage(wh)).find((f) => f.key === `ev/car/${b.id}/replaceAll`)!;
    expect(detail.level).toBe("detail");
    expect(detail.kind === "select" && detail.options.map((o) => o.value)).toEqual(["repeat", "none", "until"]);
    // 今の車は「今の車に乗り続ける」。2台目の「?」は、2台目は1回だけのことが多いと添える
    const own = allFields(stage(wh)).find((f) => f.key === `ev/car/${a.id}/replace`)!;
    expect(own.kind === "select" && own.options[1]!.label).toBe("今の車に乗り続ける（買い替えない）");
    expect(own.help).not.toContain("2台目");
    expect(simple.help).toContain("2台目は、買い替えずにこの1台だけのことも多いです");
  });

  it("この1台だけ（これから買う車）: 周期・下取りを出さない（値は残す）。手放す時期は出来事「車の購入」から13年後の推定で、購入と一緒に動く", () => {
    let wh = addCar(open("salariedCoupleTwoKids"), ids(), false);
    const id = wh.request.input.household.cars![0]!.id;
    wh = fieldOf(wh, `${id}/replace`).set(wh, "none");
    const c = carOf(wh, id);
    expect(c.purchase).toMatchObject({ replace: { kind: "none" }, everyYears: 8, tradeIn: 380000 });
    expect(fieldsOf(wh, id)).not.toContain("every");
    expect(fieldsOf(wh, id)).not.toContain("tradeIn");
    expect(fieldsOf(wh, id)).toEqual(expect.arrayContaining(["first", "price", "pay"]));
    const ev = wh.request.input.household.events!.find((e) => e.kind === "carPurchase")!;
    expect(c.purchase!.first).toEqual({ event: ev.id });
    expect(c.until).toEqual({ event: ev.id, offset: { years: 13, months: 0 } });
    const st = fieldStatus(fieldOf(wh, `${id}/untilAge`), wh);
    expect(st.status).toBe("estimated");
    expect(st.basis).toContain("13.35年");
    expect(st.basis).toContain("自動車検査登録情報協会");
    const h = wh.request.input.household;
    const first = resolveTimepoint(h, c.purchase!.first)!;
    expect(resolveTimepoint(h, c.until)).toBe(yearPlus(first, 13));
    // 購入の時期を動かすと（出来事が動き）、手放す時期も一緒に動く
    const moved = fieldOf(wh, `${id}/first`).set(wh, { at: yearPlus(wh.request.input.baseMonth, 5) });
    expect(resolveTimepoint(moved.request.input.household, carOf(moved, id).until)).toBe(yearPlus(wh.request.input.baseMonth, 18));
    expect(moved.request.input.household.events!.find((e) => e.id === ev.id)!.at).toEqual({ at: yearPlus(wh.request.input.baseMonth, 5) });
    // 1回だけ買う
    expect(buys(wh, id)).toEqual([Number(first.slice(0, 4))]);
  });

  it("手放す時期を空にすると目安（推定）に戻る。買い替え続けるに戻すと、推定のままの手放す時期は外れる（最後まで）", () => {
    let wh = addCar(open("salariedCoupleTwoKids"), ids(), false);
    const id = wh.request.input.household.cars![0]!.id;
    wh = setReplace(wh, id, "none");
    const until = fieldOf(wh, `${id}/untilAge`);
    expect(until.blankIsEstimate).toBe(true);
    wh = until.set(wh, 70);
    expect(fieldStatus(fieldOf(wh, `${id}/untilAge`), wh).status).toBe("confirmed");
    wh = fieldOf(wh, `${id}/untilAge`).set(wh, null);
    expect(fieldStatus(fieldOf(wh, `${id}/untilAge`), wh).status).toBe("estimated");
    expect(carOf(wh, id).until?.offset).toEqual({ years: 13, months: 0 });
    const back = setReplace(wh, id, "repeat");
    expect(carOf(back, id).purchase!.replace).toBeUndefined();
    // 買い替え続けるに戻すと、推定のままの手放す時期は、買い替える車の既定（名義の人の75歳。推定）に戻る
    expect(carOf(back, id).until).toMatchObject({ memberAge: { years: 75, months: 0 } });
    expect(fieldStatus(fieldOf(back, `${id}/untilAge`), back).basis).toContain("75歳");
    // FP が入れた手放す時期は、戻しても残す
    const kept = setReplace(setReplace(until.set(wh, 72), id, "none"), id, "repeat");
    expect(carOf(kept, id).until).toMatchObject({ memberAge: { years: 72 } });
  });

  it("今の車に乗り続ける: 次の買い替えの時期・価格・買い方・周期・下取りを出さず、手放す時期を買い替えのすぐ下に。手放す時期は今から5年の推定で、買わない", () => {
    let wh = addCar(open("salariedCoupleTwoKids"), ids());
    const id = wh.request.input.household.cars![0]!.id;
    wh = setReplace(wh, id, "none");
    const shown = fieldsOf(wh, id);
    for (const k of ["first", "price", "pay", "every", "tradeIn"]) expect(shown, k).not.toContain(k);
    expect(fieldsOf(wh, id, "simple").slice(0, 3)).toEqual(["owner", "replace", "untilAge"]);
    expect(fieldOf(wh, `${id}/untilAge`).help).toContain("今の車を手放す時期です");
    expect(carOf(wh, id).until).toEqual({ at: yearPlus(wh.request.input.baseMonth, 5) });
    expect(fieldStatus(fieldOf(wh, `${id}/untilAge`), wh).basis).toContain("今から5年");
    expect(carOf(wh, id).purchase).toMatchObject({ price: 2500000, everyYears: 8 });
    expect(buys(wh, id)).toEqual([]);
    const life = lifetimeCost(wh.request.input.household, carOf(wh, id), wh.request.input.baseMonth, wh.request.input.endYear)!;
    expect(life.purchases).toBe(0);
  });

  it("○歳まで買い替える: 年齢の欄（70歳まで・推定）を出し、その年齢になる前の月までの買い替えだけ。手放す時期より後なら知らせ", () => {
    let wh = addCar(open("salariedCoupleTwoKids"), ids());
    const id = wh.request.input.household.cars![0]!.id;
    wh = setReplace(wh, id, "until");
    const c = carOf(wh, id);
    expect(c.purchase!.replace).toEqual({ kind: "until", until: { memberAge: { member: c.owner, years: 69, months: 11 } } });
    const f = fieldOf(wh, `${id}/replaceUntil`);
    expect(f.level).toBe("simple");
    expect(fieldStatus(f, wh).status).toBe("estimated");
    // 標準の選び方にも「○歳まで」が出る（この車がその形だから）
    const simple = allFields(stage(wh)).find((x) => x.key === `ev/car/${id}/replace`)!;
    expect(simple.kind === "select" && simple.options.map((o) => o.value)).toEqual(["repeat", "none", "until"]);
    const h = wh.request.input.household;
    const last = resolveTimepoint(h, c.purchase!.replace!.kind === "until" ? c.purchase!.replace!.until : null)!;
    const years = carPurchaseYms(h, c, `${wh.request.input.endYear}-12`);
    expect(years.length).toBeGreaterThan(0);
    expect(years.every((m) => m <= last)).toBe(true);
    expect(years.length).toBeLessThan(carPurchaseYms(h, { ...c, purchase: { ...c.purchase!, replace: { kind: "repeat" } } }, `${wh.request.input.endYear}-12`).length);
    expect(f.get(wh).warn ?? null).toBeNull();
    const early = fieldOf(wh, `${id}/untilAge`).set(wh, 65);
    expect(fieldOf(early, `${id}/replaceUntil`).get(early).warn).toBe("手放す時期より後の年齢なので、「買い替え続ける」と同じです");
  });
});

describe("手放す月には買わない（0101）", () => {
  it("買い替えの月と手放す月が重なると、その月には買わない（エンジン・一生の費用・この世帯の予定が同じ）", () => {
    let wh = addCar(open("salariedCoupleTwoKids"), ids(), false);
    const id = wh.request.input.household.cars![0]!.id;
    const base = wh.request.input.baseMonth;
    wh = addAt((b) => yearPlus(b, 1))(wh, id);
    wh = mutate(wh, (h) => {
      h.cars![0]!.purchase!.everyYears = 5;
      h.cars![0]!.until = { at: yearPlus(base, 11) };
    });
    const y = Number(base.slice(0, 4));
    expect(buys(wh, id)).toEqual([y + 1, y + 6]);
    expect(lifetimeCost(wh.request.input.household, carOf(wh, id), base, wh.request.input.endYear)!.purchases).toBe(2);
    expect(scheduleItems(wh).filter((x) => x.name.startsWith("車の")).map((x) => x.year)).toEqual([y + 1, y + 6]);
  });
});

describe("次の買い替えの時期・購入の時期は「今から○年後」だけ（0101）", () => {
  it("入れ方は今からだけ。年齢で入っている前の値は同じ月の今からで見せ、1行添える。過ぎた時点は知らせ", () => {
    let wh = addCar(open("salariedCoupleTwoKids"), ids());
    const c = wh.request.input.household.cars![0]!;
    const f = fieldOf(wh, `${c.id}/first`);
    expect(f.time?.when.modes).toEqual(["now"]);
    expect(f.time?.when.strictModes).toBe(true);
    // 年齢の前の値
    wh = mutate(wh, (h) => {
      h.cars![0]!.purchase!.first = { memberAge: { member: c.owner, years: 50 } };
    });
    const st = fieldOf(wh, `${c.id}/first`).time!.state(wh);
    const shown = strictShown(st.raw, st.ctx as WhenCtx)!;
    expect(shown.tp.at).toBe(resolveTimepoint(wh.request.input.household, st.raw));
    expect(shown.note).toContain("年齢（50歳）で入っています");
    expect(shown.note).toContain("「○年後」");
    // 直すと今からの形（年月）で書く
    const w2 = fieldOf(wh, `${c.id}/first`).set(wh, { at: yearPlus(wh.request.input.baseMonth, 4) });
    expect(carOf(w2, c.id).purchase!.first).toEqual({ at: yearPlus(wh.request.input.baseMonth, 4) });
    // 過ぎた時点
    const past = mutate(wh, (h) => {
      h.cars![0]!.purchase!.first = { at: yearPlus(wh.request.input.baseMonth, -2) };
    });
    expect(fieldOf(past, `${c.id}/first`).get(past).warn).toContain("過ぎた時点");
    expect(strictShown({ at: yearPlus(wh.request.input.baseMonth, -2) }, st.ctx as WhenCtx)).toBeNull();
  });

  it("ほかの出来事から決めた前の値は、今からで見せて切り離すと1行添える", () => {
    let wh = addCar(open("salariedCoupleTwoKids"), ids());
    const c = wh.request.input.household.cars![0]!;
    wh = mutate(wh, (h) => {
      (h.events ??= []).push({ id: "00000000-0000-4000-8000-0000000000e1", kind: "relocation", at: { at: yearPlus(wh.request.input.baseMonth, 2) } });
      h.cars![0]!.purchase!.first = { event: "00000000-0000-4000-8000-0000000000e1", offset: { years: 1 } };
    });
    const st = fieldOf(wh, `${c.id}/first`).time!.state(wh);
    const shown = strictShown(st.raw, st.ctx as WhenCtx)!;
    expect(shown.tp).toEqual({ at: yearPlus(wh.request.input.baseMonth, 3) });
    expect(shown.note).toContain("出来事から切り離します");
  });

  it("続きの車の購入の時期は読むだけ（車1を手放した翌月。車1の手放す時期で直す）", () => {
    let wh = addCar(open("salariedCoupleTwoKids"), ids());
    const a = wh.request.input.household.cars![0]!;
    wh = fieldOf(wh, `${a.id}/untilAge`).set(wh, 70);
    wh = addNextCar(wh, a.id, "00000000-0000-4000-8000-0000000000bb");
    const f = fieldOf(wh, "00000000-0000-4000-8000-0000000000bb/first");
    expect(f.readOnly).toBe("車1の手放す時期で直します");
    expect(String(f.get(wh).value)).toMatch(/^車1を手放した翌月（今から\d+年(\d+か月)?後）$/);
  });
});

describe("手放した後の移動の費用は世帯が最後に手放す車だけ（0101）", () => {
  it("どの車も手放す時期があり、いちばん後に手放す車に「この後、世帯に車がありません」のまとまりとボタン", () => {
    const gen = ids();
    let wh = addCar(open("salariedCoupleTwoKids"), gen);
    wh = addCar(wh, gen, false);
    const [a, b] = wh.request.input.household.cars! as [Car, Car];
    wh = fieldOf(wh, `${a.id}/untilAge`).set(wh, 75);
    // まだ手放す時期の無い車（最後まで乗る）がある: どちらにも出さない
    wh = fieldOf(wh, `${b.id}/untilAge`).set(wh, null);
    expect(groups(wh).some((g) => g.key.endsWith("/afterCar"))).toBe(false);
    wh = fieldOf(wh, `${b.id}/untilAge`).set(wh, 72);
    expect(lastCarOfHousehold(wh.request.input.household, a.id)).toBe(true);
    expect(lastCarOfHousehold(wh.request.input.household, b.id)).toBe(false);
    const g = groups(wh).find((x) => x.key.endsWith("/afterCar"))!;
    expect(g.key).toBe(`ev/car/${a.id}/afterCar`);
    expect(g.title).toBe("この後、世帯に車がありません");
    expect(g.actions[0]!.label).toBe("＋ 手放した後の移動の費用を足す");
    // 手放す時期の説明に、75歳ごろを目安にする FP が多いこと。足した車の既定は名義の人の75歳（推定）
    expect(fieldOf(wh, `${a.id}/untilAge`).help).toContain("75歳ごろ");
    const fresh = addCar(open("salariedCoupleTwoKids"), ids());
    const fc = fresh.request.input.household.cars![0]!;
    expect(fc.until).toEqual({ memberAge: { member: fc.owner, years: 75, months: 0 } });
    expect(fieldStatus(fieldOf(fresh, `${fc.id}/untilAge`), fresh).status).toBe("estimated");
  });
});

describe("リース・長期レンタル（0101）", () => {
  it("「＋ リース・長期レンタル（月額）」で足す。月額は目安を入れず未入力（0円で計算中）。維持費の合計は月額に含む分を引いた目安", () => {
    const wh0 = open("salariedCoupleTwoKids");
    const act = stage(wh0).sections[0]!.actions.find((a) => a.key === "ev/addCarLease")!;
    expect(act.label).toBe("＋ リース・長期レンタル（月額）");
    expect(stage(wh0).sections.flatMap((s) => s.actions).some((a) => a.label === "＋ カーシェア・レンタカー")).toBe(false);
    let wh = act.run(wh0);
    const c = wh.request.input.household.cars![0]!;
    expect(c.purchase).toBeUndefined();
    expect(c.lease).toEqual({ type: "carLease", monthly: 0 });
    expect(c.upkeep).toEqual({ annual: 360000 - 36000 - 50000 });
    const monthly = fieldOf(wh, `${c.id}/lease/monthly`);
    expect(fieldStatus(monthly, wh)).toMatchObject({ status: "missing", basis: LEASE_UNENTERED });
    // 買い替えの欄は出さない
    const shown = fieldsOf(wh, c.id);
    for (const k of ["replace", "first", "every", "price", "tradeIn", "owned", "pay"]) expect(shown, k).not.toContain(k);
    expect(fieldsOf(wh, c.id, "simple")).toEqual(["owner", "lease/type", "lease/monthly", "lease/from", "upkeep", "untilAge"]);
    expect(fieldOf(wh, `${c.id}/upkeep`).help).toContain("月額に含まれない分（駐車場・燃料など）を入れます");
    expect(fieldOf(wh, `${c.id}/lease/inc/taxAndCompulsory`).help).toContain("自賠責保険は車検");
    wh = monthly.set(wh, 40000);
    expect(fieldStatus(fieldOf(wh, `${c.id}/lease/monthly`), wh).status).toBe("confirmed");
    // 要約は月額も維持費に数える
    expect(inputItems(wh).find((x) => x.id === "car")?.summary).toMatchObject({ main: "1" });
    const rows = preview(wh.request).table.filter((x) => x.object === c.id && x.row === "cf.expense.living.car");
    const y = Number(wh.request.input.baseMonth.slice(0, 4)) + 1;
    expect(rows.filter((x) => x.year === y).reduce((s, x) => s + x.amount, 0)).toBeGreaterThanOrEqual(40000 * 12 + 274000);
    expect(preview(wh.request).table.some((x) => x.object === c.id && x.row === "cf.expense.lumpSum.car")).toBe(false);
  });

  it("種類と月額に含む物: 長期レンタルは保険も含む。推定のままの維持費の合計は入れ直す。内訳では含む物の欄を出さない（値は残す）", () => {
    let wh = addLeaseCar(open("salariedCoupleTwoKids"), ids());
    const id = wh.request.input.household.cars![0]!.id;
    expect(fieldOf(wh, `${id}/lease/inc/insurance`).get(wh)).toMatchObject({ value: false, implicit: true });
    wh = fieldOf(wh, `${id}/lease/type`).set(wh, "longRental");
    expect(carOf(wh, id).upkeep).toEqual({ annual: 360000 - 36000 - 50000 - 70000 });
    expect(fieldOf(wh, `${id}/lease/inc/insurance`).get(wh)).toMatchObject({ value: true, implicit: true });
    expect(upkeepEstimate(carOf(wh, id)).basis).toContain("月額に含む自動車税・車検・保険の目安を引いた額");
    // 含む物を外すと、その分を足した目安に
    wh = fieldOf(wh, `${id}/lease/inc/insurance`).set(wh, false);
    expect(carOf(wh, id).lease!.includes).toEqual({ insurance: false });
    expect(carOf(wh, id).upkeep).toEqual({ annual: 360000 - 36000 - 50000 });
    // 内訳で入れる: 月額に含む自動車税・車検の欄は出さない
    wh = setUpkeepMode(wh, id, "detail");
    const shown = fieldsOf(wh, id);
    expect(shown).not.toContain("tax");
    expect(shown).not.toContain("inspection");
    expect(shown).toContain("insurance");
    expect(carOf(wh, id).tax).toBeUndefined();
  });

  it("借り始めの空はもう借りている。手放す時期・続きの車はほかの車と同じ", () => {
    let wh = addLeaseCar(open("salariedCoupleTwoKids"), ids());
    const id = wh.request.input.household.cars![0]!.id;
    expect(fieldOf(wh, `${id}/lease/from`).get(wh).value).toBeNull();
    wh = fieldOf(wh, `${id}/lease/monthly`).set(wh, 30000);
    wh = fieldOf(wh, `${id}/untilAge`).set(wh, 70);
    wh = addNextCar(wh, id, "00000000-0000-4000-8000-0000000000dd");
    const next = carOf(wh, "00000000-0000-4000-8000-0000000000dd");
    expect(next.lease).toMatchObject({ type: "carLease", monthly: 30000, from: { offset: { years: 0, months: 1 } } });
    expect(next.purchase).toBeUndefined();
    expect(() => preview(wh.request)).not.toThrow();
  });
});
