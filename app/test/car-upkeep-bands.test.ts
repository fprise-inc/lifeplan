// 車の入力項目の3つの手直し（0253）: 維持費の目安を車両の価格の帯で・「手放した後」の見出しにいつのことかを書く・これから買う車の「購入済みにする」
import { afterEach, describe, expect, it } from "vitest";
import type { Car } from "../src/engine/types.ts";
import { carBand, carBandEstimates, carUpkeepEstimates } from "../../hearing/src/estimates.ts";
import { carPurchaseYms } from "../src/workspace/input/carPurchases.ts";
import { allFields, resolveTimepoint, type FieldDef, type GroupDef } from "../src/workspace/input/form.ts";
import { fromRequest, mutate, type WorkingHousehold } from "../src/workspace/input/household.ts";
import { addMonths, ageAt } from "../src/workspace/levers.ts";
import { putRow } from "../src/workspace/input/rows.ts";
import { addAfterCar, addCar, addLeaseCar, addNextCar, addRepair, afterCarTitle, breakdownAnnual, carRowsByCar, markBought, repairAdded, REST_LABEL, setReplace, setUpkeepMode, upkeepEstimate } from "../src/workspace/input/stages/cars.ts";
import { buildStage } from "../src/workspace/input/stages/index.ts";
import { fieldStatus } from "../src/workspace/input/valueState.ts";
import { EMPTY_ESTIMATES, publishOfficeEstimates, withOfficeValue } from "../src/workspace/office/estimates.ts";
import { modelHousehold, preview } from "./helpers.ts";

afterEach(() => publishOfficeEstimates(undefined));

const ids = () => {
  let n = 0;
  return () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`;
};
const open = (id: string): WorkingHousehold => fromRequest(modelHousehold(id));
const stage = (wh: WorkingHousehold) => buildStage("car", wh);
const fieldOf = (wh: WorkingHousehold, suffix: string) => {
  const f = allFields(stage(wh)).find((x) => x.key.endsWith(suffix));
  if (f === undefined) throw new Error(`no field ${suffix}`);
  return f as FieldDef;
};
const groups = (wh: WorkingHousehold): GroupDef[] => stage(wh).sections[0]!.groups;
const car0 = (wh: WorkingHousehold): Car => wh.request.input.household.cars![0]!;
/** 手放す時期の推定の印を外す（FP が「この値にする」で確かめたのと同じ） */
const confirmUntil = (wh: WorkingHousehold, carId: string): WorkingHousehold =>
  mutate(wh, (_h, req) => putRow(req.input as unknown as Record<string, unknown>, { target: { object: carId }, item: "car.until", at: [] }, undefined));
const rows = (wh: WorkingHousehold, id: string, row: string, year: number) =>
  preview(wh.request)
    .table.filter((c) => c.object === id && c.row === row && c.year === year)
    .reduce((s, c) => s + c.amount, 0);
const yearOf = (ym: string) => Number(ym.slice(0, 4));

describe("維持費の目安を車両の価格の帯で（0253）", () => {
  it("帯の境目: 200万円未満は軽・コンパクト、200万円ちょうどから普通車、400万円ちょうどから大型・高級車。価格の無い車（リース）は普通車", () => {
    expect(carBand(1999999)).toBe("small");
    expect(carBand(2000000)).toBe("normal");
    expect(carBand(3999999)).toBe("normal");
    expect(carBand(4000000)).toBe("large");
    expect(carBand(0)).toBe("small");
    expect(carBand(null)).toBe("normal");
    expect(carBand(undefined)).toBe("normal");
  });

  it("帯ごとの維持費と内訳の目安（普通車は前と同じ値）。根拠の文に帯を書く（価格の分からない車は前の文のまま）", () => {
    const v = (p: number | null) => {
      const e = carUpkeepEstimates(p);
      return [e.upkeep.value, e.tax.value, e.insurance.value, e.inspection.value, e.fuel.value];
    };
    expect(v(1500000)).toEqual([250000, 10800, 55000, 70000, 80000]);
    expect(v(2500000)).toEqual([360000, 36000, 70000, 100000, 100000]);
    expect(v(5000000)).toEqual([500000, 50000, 100000, 130000, 140000]);
    expect(v(null)).toEqual([360000, 36000, 70000, 100000, 100000]);
    expect(carUpkeepEstimates(1500000).upkeep.basis).toContain("軽・コンパクト（車両の価格200万円未満）");
    expect(carUpkeepEstimates(2000000).upkeep.basis).toContain("普通車（車両の価格200万円以上400万円未満）");
    expect(carUpkeepEstimates(4000000).tax.basis).toContain("2.5リットル超3リットル以下");
    expect(carUpkeepEstimates(4000000).tax.basis).toContain("大型・高級車（車両の価格400万円以上）の目安");
    expect(carUpkeepEstimates(1500000).tax.basis).toContain("軽自動車税");
    expect(carUpkeepEstimates(null).upkeep.basis).not.toContain("普通車");
  });

  it("帯の境目と額は事務所の推定の値で直せる", () => {
    publishOfficeEstimates(withOfficeValue(withOfficeValue(EMPTY_ESTIMATES, "preset.car.band.smallBelow", 1500000, null, "2026-11-23"), "preset.car.upkeep.small", 240000, null, "2026-11-23"));
    expect(carBand(1499999)).toBe("small");
    expect(carBand(1500000)).toBe("normal");
    expect(carBand(1800000)).toBe("normal");
    expect(carUpkeepEstimates(1000000).upkeep.value).toBe(240000);
    expect(carBandEstimates("normal").upkeep.basis).toContain("150万円以上400万円未満");
  });

  it("推定のままの維持費は、価格を直すと帯の目安で入れ直す（境目ちょうども）。FP が入れた維持費は変えない", () => {
    let wh = addCar(open("salariedCoupleTwoKids"), ids());
    expect(car0(wh).upkeep).toEqual({ annual: 360000 });
    const steps: [number, number][] = [
      [1999999, 250000],
      [2000000, 360000],
      [4000000, 500000],
      [3999999, 360000],
      [1500000, 250000],
    ];
    for (const [price, upkeep] of steps) {
      wh = fieldOf(wh, "/price").set(wh, price);
      expect(car0(wh).upkeep, String(price)).toEqual({ annual: upkeep });
      expect(fieldStatus(fieldOf(wh, "/upkeep"), wh).status).toBe("estimated");
    }
    expect(fieldStatus(fieldOf(wh, "/upkeep"), wh).basis).toContain("軽・コンパクト");
    // 価格を空にすると価格の目安（250万円）＝普通車
    wh = fieldOf(wh, "/price").set(wh, null);
    expect(car0(wh).upkeep).toEqual({ annual: 360000 });
    // FP が入れた維持費は、価格を直しても変えない
    wh = fieldOf(wh, "/upkeep").set(wh, 300000);
    wh = fieldOf(wh, "/price").set(wh, 5000000);
    expect(car0(wh).upkeep).toEqual({ annual: 300000 });
    expect(fieldStatus(fieldOf(wh, "/upkeep"), wh).status).toBe("confirmed");
  });

  it("内訳: 初めて分けるときは帯の目安（燃料も）、残りは「その他（まだ分けていない）」。価格を直すと推定のままの内訳と差の行を入れ直し、FP が入れた内訳は変えない", () => {
    let wh = addCar(open("salariedCoupleTwoKids"), ids());
    wh = fieldOf(wh, "/price").set(wh, 1500000);
    const id = car0(wh).id;
    wh = setUpkeepMode(wh, id, "detail");
    const rest = () => car0(wh).upkeepOther!.find((o) => o.label === REST_LABEL)!;
    expect(car0(wh)).toMatchObject({ upkeep: { annual: 250000 }, tax: { annual: 10800 }, insurance: { annual: 55000 }, inspection: { amount: 70000 }, fuel: { annual: 80000 } });
    expect(rest().annual).toBe(250000 - 10800 - 55000 - 35000 - 80000);
    expect(breakdownAnnual(car0(wh))).toBe(250000);
    expect(fieldStatus(fieldOf(wh, "/insurance"), wh).basis).toContain("軽・コンパクト");
    // 大型・高級車に: 推定のままの内訳はみな入れ直す
    wh = fieldOf(wh, "/price").set(wh, 4500000);
    expect(car0(wh)).toMatchObject({ upkeep: { annual: 500000 }, tax: { annual: 50000 }, insurance: { annual: 100000 }, inspection: { amount: 130000 }, fuel: { annual: 140000 } });
    expect(rest().annual).toBe(500000 - 50000 - 100000 - 65000 - 140000);
    expect(breakdownAnnual(car0(wh))).toBe(500000);
    for (const s of ["/tax", "/insurance", "/inspection", "/fuel", `/other/${rest().id}/annual`]) expect(fieldStatus(fieldOf(wh, s), wh).status, s).toBe("estimated");
    // FP が入れた保険は変えない（差の行は FP の値で出し直す）
    wh = fieldOf(wh, "/insurance").set(wh, 90000);
    wh = fieldOf(wh, "/price").set(wh, 3000000);
    expect(car0(wh)).toMatchObject({ upkeep: { annual: 360000 }, tax: { annual: 36000 }, insurance: { annual: 90000 }, inspection: { amount: 100000 }, fuel: { annual: 100000 } });
    expect(rest().annual).toBe(360000 - 36000 - 90000 - 50000 - 100000);
    expect(fieldStatus(fieldOf(wh, "/insurance"), wh).status).toBe("confirmed");
    // 差が無くなれば差の行を外す
    wh = fieldOf(wh, "/insurance").set(wh, 300000);
    wh = fieldOf(wh, "/price").set(wh, 2500000);
    expect(car0(wh).upkeepOther ?? []).toEqual([]);
  });

  it("FP の合計が目安の内訳より少ないとき: 燃料は残り全部で、差の行は作らない。その燃料（合計から分けた残り）は価格を直しても変えない", () => {
    let wh = addCar(open("salariedCoupleTwoKids"), ids());
    wh = fieldOf(wh, "/price").set(wh, 1500000);
    wh = fieldOf(wh, "/upkeep").set(wh, 150000);
    const id = car0(wh).id;
    wh = setUpkeepMode(wh, id, "detail");
    const left = 150000 - 10800 - 55000 - 35000;
    expect(car0(wh).fuel).toEqual({ annual: left });
    expect(car0(wh).upkeepOther).toBeUndefined();
    expect(fieldStatus(fieldOf(wh, "/fuel"), wh).basis).toContain("を引いた残り");
    wh = fieldOf(wh, "/price").set(wh, 5000000);
    expect(car0(wh).fuel).toEqual({ annual: left });
    expect(car0(wh).tax).toEqual({ annual: 50000 });
  });

  it("リース・長期レンタルの「月額に含む物を引く」は帯の目安と同じ値で引く（価格が無いので普通車）", () => {
    const wh = addLeaseCar(open("salariedCoupleTwoKids"), ids());
    const e = carUpkeepEstimates(null);
    expect(car0(wh).upkeep).toEqual({ annual: e.upkeep.value - e.tax.value - Math.round(e.inspection.value / 2) });
    expect(upkeepEstimate(car0(wh)).basis).toBe(`${e.upkeep.basis}から、月額に含む自動車税・車検の目安を引いた額`);
  });
});

describe("「手放した後」の見出しにいつのことかを書く（0253）", () => {
  it("手放す月と名義の人の年齢。推定のままなら〔推定〕。手放す時期を直せば一緒に変わる", () => {
    let wh = addCar(open("salariedCoupleTwoKids"), ids());
    const c = car0(wh);
    const at = (w: WorkingHousehold) => {
      const h = w.request.input.household;
      const ym = resolveTimepoint(h, car0(w).until)!;
      const o = h.members.find((m) => m.id === c.owner)!;
      return { ym, age: ageAt(o, ym) };
    };
    const title = (w: WorkingHousehold) => groups(w).find((g) => g.key === `ev/car/${c.id}/afterCar`)!.title;
    const a = at(wh);
    expect(a.age).toBe(75);
    expect(title(wh)).toBe(`手放した後（${yearOf(a.ym)}年${Number(a.ym.slice(5))}月・ご本人75歳〔推定〕、買い替えはここまでで、この後は世帯に車がありません）`);
    // FP が手放す時期を確かめた・直した
    wh = confirmUntil(fieldOf(wh, "/untilAge").set(wh, 70), c.id);
    const b = at(wh);
    expect(b.age).toBe(70);
    expect(title(wh)).toBe(`手放した後（${yearOf(b.ym)}年${Number(b.ym.slice(5))}月・ご本人70歳、買い替えはここまでで、この後は世帯に車がありません）`);
  });

  it("基準月が1月で、名義の人の誕生月も1月: 75歳になる月（誕生月）で書く", () => {
    const src = open("salariedCoupleTwoKids");
    const seeded = mutate(src, (h, req) => {
      req.input.baseMonth = "2027-01";
      const self = h.members.find((m) => m.kind === "self")!;
      self.birth = { ...self.birth, birthYearMonth: "1980-01" };
    });
    const wh = addCar(seeded, ids());
    expect(afterCarTitle(wh, car0(wh))).toBe("手放した後（2055年1月・ご本人75歳〔推定〕、買い替えはここまでで、この後は世帯に車がありません）");
  });

  it("買い替えない車・リースは「買い替えはここまで」を書かない。買い替えない車の目安（推定）も〔推定〕", () => {
    let wh = addCar(open("salariedCoupleTwoKids"), ids());
    wh = setReplace(wh, car0(wh).id, "none");
    expect(afterCarTitle(wh, car0(wh))).toMatch(/^手放した後（\d{4}年\d{1,2}月・ご本人\d+歳〔推定〕、この後は世帯に車がありません）$/);
    const lease = addLeaseCar(open("salariedCoupleTwoKids"), ids());
    expect(afterCarTitle(lease, car0(lease))).toMatch(/^手放した後（\d{4}年\d{1,2}月・ご本人75歳〔推定〕、この後は世帯に車がありません）$/);
  });
});

describe("これから買う車の「購入済みにする」（0253）", () => {
  const HELP = "プランを見直したときに、この車をもう買っていたら押します。入れた値はそのままで「今の車」になります。";
  const headOf = (wh: WorkingHousehold, id: string) => groups(wh).find((g) => g.key === `ev/car/${id}`)!;

  it("これから買う車にだけ、詳細で見出しの行（「外す」の横）に出す。今の車・リースには出さない。「今の車」のチェックの欄は無い", () => {
    const gen = ids();
    let wh = addCar(open("salariedCoupleTwoKids"), gen, false);
    wh = addCar(wh, gen, true);
    wh = addLeaseCar(wh, gen);
    const [future, owned, lease] = wh.request.input.household.cars! as [Car, Car, Car];
    const act = headOf(wh, future.id).actions.find((a) => a.key.endsWith("/bought"))!;
    expect(act).toMatchObject({ label: "購入済みにする", level: "detail", head: true, help: HELP });
    expect(headOf(wh, future.id).actions.map((a) => a.label)).toEqual(["購入済みにする", "外す"]);
    expect(headOf(wh, owned.id).actions.map((a) => a.label)).toEqual(["外す"]);
    expect(headOf(wh, lease.id).actions.map((a) => a.label)).toEqual(["外す"]);
    // 中枠のボタンの並びには出さない
    expect(groups(wh).filter((g) => g.key !== `ev/car/${future.id}`).some((g) => g.actions.some((a) => a.key.endsWith("/bought")))).toBe(false);
    expect(allFields(stage(wh)).some((f) => f.key.endsWith("/owned"))).toBe(false);
  });

  /** 購入の時期を基準の月から months か月後にした、これから買う車（周期は推定の8年） */
  const futureCar = (months: number, base?: string): WorkingHousehold => {
    let src = open("salariedCoupleTwoKids");
    if (base !== undefined) src = mutate(src, (_h, req) => void (req.input.baseMonth = base));
    const wh = addCar(src, ids(), false);
    return mutate(wh, (h, req) => void (h.cars![0]!.purchase!.first = { at: addMonths(req.input.baseMonth, months) }));
  };
  const firstOf = (wh: WorkingHousehold) => resolveTimepoint(wh.request.input.household, car0(wh).purchase!.first)!;

  it("押すと今の車に: 見出しは「今の車」、次の買い替えの時期は今から周期の年数後（推定）。予定より早く・予定どおり・予定より後のどれでも同じ。逆向きのボタンは出さない", () => {
    for (const months of [36, 0, -12]) {
      let wh = futureCar(months);
      const c = car0(wh);
      const base = wh.request.input.baseMonth;
      expect(headOf(wh, c.id).title).toBe("車 1（ご本人・これから買う車）");
      expect(fieldOf(wh, "/first").label).toBe("購入の時期");
      wh = headOf(wh, c.id).actions.find((a) => a.key.endsWith("/bought"))!.run(wh);
      const d = car0(wh);
      expect(d.purchase!.owned, String(months)).toBe(true);
      expect(firstOf(wh), String(months)).toBe(addMonths(base, 96));
      // ほかの値はそのまま
      const { valueStates: _v1, ...dRest } = d;
      const { valueStates: _v2, ...cRest } = c;
      void _v1;
      void _v2;
      expect({ ...dRest, purchase: { ...d.purchase!, first: c.purchase!.first } }).toEqual({ ...cRest, purchase: { ...c.purchase!, owned: true } });
      expect(headOf(wh, c.id).title).toBe("車 1（ご本人・今の車）");
      expect(headOf(wh, c.id).actions.map((a) => a.label)).toEqual(["外す"]);
      const first = fieldOf(wh, "/first");
      expect(first.label).toBe("次の買い替えの時期");
      expect(fieldStatus(first, wh)).toMatchObject({ status: "estimated" });
      expect(fieldStatus(first, wh).basis).toContain("買い替えの周期（8年）後");
      // 過ぎた時点の知らせ（「今から○年後」で入れ直してください）は出ない
      expect((first as { warn?: (w: WorkingHousehold) => string | null }).warn?.(wh) ?? null).toBeNull();
      // 今返しているローンを車の枠の中で足せる
      expect(groups(wh).some((g) => g.key === `ev/car/${c.id}/addNowLoan`)).toBe(true);
      // もう一度押しても変わらない
      expect(markBought(wh, c.id)).toBe(wh);
    }
  });

  it("基準月が1〜3月でも、今（基準の月）から周期の年数後の同じ月", () => {
    for (const base of ["2027-01", "2027-02", "2027-03"]) {
      const wh = markBought(futureCar(36, base), "00000000-0000-4000-8000-000000000001");
      expect(firstOf(wh), base).toBe(addMonths(base, 96));
    }
  });

  it("周期が推定のままでも FP が入れた値でも、その周期で数える", () => {
    let wh = futureCar(36);
    wh = fieldOf(wh, "/every").set(wh, 5);
    expect(fieldStatus(fieldOf(wh, "/every"), wh).status).toBe("confirmed");
    wh = markBought(wh, car0(wh).id);
    expect(firstOf(wh)).toBe(addMonths(wh.request.input.baseMonth, 60));
    expect(fieldStatus(fieldOf(wh, "/first"), wh).basis).toContain("買い替えの周期（5年）後");
  });

  it("読み替え: 次の買い替えから下取りを引く、維持費は今から、購入の月は次の買い替えから周期ごと", () => {
    const wh0 = futureCar(36);
    const c = car0(wh0);
    const base = wh0.request.input.baseMonth;
    const next = addMonths(base, 96);
    // 比べる物: 同じ月に買う、これから買う車（1回目は下取りを引かない）
    const ref = mutate(wh0, (h) => void (h.cars![0]!.purchase!.first = { at: next }));
    expect(rows(wh0, c.id, "cf.expense.living.car", yearOf(base))).toBe(0);
    const wh = markBought(wh0, c.id);
    expect(carPurchaseYms(wh.request.input.household, car0(wh), `${yearOf(base) + 40}-12`)).toEqual(carPurchaseYms(ref.request.input.household, car0(ref), `${yearOf(base) + 40}-12`));
    const ratio = rows(wh, c.id, "cf.expense.lumpSum.car", yearOf(next)) / rows(ref, c.id, "cf.expense.lumpSum.car", yearOf(next));
    expect(ratio).toBeCloseTo((c.purchase!.price - c.purchase!.tradeIn!) / c.purchase!.price, 2);
    expect(rows(wh, c.id, "cf.expense.living.car", yearOf(base))).toBeGreaterThan(0);
  });

  it("ローンで買う車: ローンの条件はそのまま、次の買い替えで下取りを引いた額から借りる", () => {
    let wh0 = futureCar(36);
    wh0 = fieldOf(wh0, "/pay").set(wh0, "loan");
    const c = car0(wh0);
    const next = addMonths(wh0.request.input.baseMonth, 96);
    const ref = mutate(wh0, (h) => void (h.cars![0]!.purchase!.first = { at: next }));
    const wh = markBought(wh0, c.id);
    expect(car0(wh).loan).toEqual(c.loan);
    // 頭金（借りない分）も下取りを引いた額に対する割合
    const ratio = rows(wh, c.id, "cf.expense.lumpSum.car", yearOf(next)) / rows(ref, c.id, "cf.expense.lumpSum.car", yearOf(next));
    expect(ratio).toBeCloseTo((c.purchase!.price - c.purchase!.tradeIn!) / c.purchase!.price, 2);
  });

  it("この1台だけの車: もう買わず、手放す時期の目安（買ってから13年・推定）は今から13年、古くなってからの修理費は今から10年に。FP が入れた手放す時期は変えない", () => {
    let wh = futureCar(36);
    const id = car0(wh).id;
    wh = setReplace(wh, id, "none");
    wh = addRepair(wh, id, "00000000-0000-4000-8000-0000000000aa");
    const base = wh.request.input.baseMonth;
    const h0 = wh.request.input.household;
    expect(resolveTimepoint(h0, car0(wh).until)).toBe(addMonths(base, 36 + 156));
    const repair = (w: WorkingHousehold) => resolveTimepoint(w.request.input.household, w.request.input.household.periodicExpenses!.find((p) => p.id === "00000000-0000-4000-8000-0000000000aa")!.from);
    expect(repair(wh)).toBe(addMonths(base, 36 + 120));
    const buys = (w: WorkingHousehold) => preview(w.request).table.filter((x) => x.object === id && x.row === "cf.expense.lumpSum.car").length;
    expect(buys(wh)).toBeGreaterThan(0);
    const bought = markBought(wh, id);
    expect(buys(bought)).toBe(0);
    expect(resolveTimepoint(bought.request.input.household, car0(bought).until)).toBe(addMonths(base, 156));
    expect(fieldStatus(fieldOf(bought, "/untilAge"), bought).status).toBe("estimated");
    expect(repair(bought)).toBe(addMonths(base, 120));
    expect(rows(bought, id, "cf.expense.living.car", yearOf(base))).toBeGreaterThan(0);
    // FP が年齢で入れた手放す時期は変えない
    const fp = fieldOf(wh, "/untilAge").set(wh, 70);
    const until = car0(fp).until;
    expect(car0(markBought(fp, id)).until).toEqual(until);
  });
});

describe("「＋ 古くなってからの修理費」は足した後は出さない", () => {
  const repairBtn = (wh: WorkingHousehold, id: string) => stage(wh).sections.flatMap((s) => s.groups.flatMap((g) => g.actions)).find((a) => a.key === `ev/car/${id}/repair`);
  const repairRows = (wh: WorkingHousehold) => (wh.request.input.household.periodicExpenses ?? []).filter((p) => p.label === "古くなってからの修理費");

  it("足すとボタンが消え、行を外すとまた出る。ほかの車のボタンは残る", () => {
    const gen = ids();
    let wh = addCar(open("salariedCoupleTwoKids"), gen, false);
    wh = addCar(wh, gen, false);
    const [a, b] = wh.request.input.household.cars! as [Car, Car];
    wh = setReplace(setReplace(wh, a.id, "none"), b.id, "none");
    expect(repairBtn(wh, a.id)).toBeDefined();
    wh = repairBtn(wh, a.id)!.run(wh);
    expect(repairRows(wh)).toHaveLength(1);
    expect(repairBtn(wh, a.id)).toBeUndefined();
    expect(repairAdded(wh.request.input.household, a.id)).toBe(true);
    expect(repairBtn(wh, b.id)).toBeDefined();
    expect(repairAdded(wh.request.input.household, b.id)).toBe(false);
    // 行を外すとまた出る
    const rowId = repairRows(wh)[0]!.id;
    wh = mutate(wh, (h) => void (h.periodicExpenses = (h.periodicExpenses ?? []).filter((p) => p.id !== rowId)));
    expect(repairBtn(wh, a.id)).toBeDefined();
  });

  it("「購入済みにする」で修理費の始まりを前へずらした後も、足した行として数える（周期12年で始まりが購入の出来事より前でも）", () => {
    let wh = futureCarRepair(12);
    const id = car0(wh).id;
    wh = repairBtn(wh, id)!.run(wh);
    wh = markBought(wh, id);
    expect(repairRows(wh)[0]!.from.offset).toEqual({ years: -2, months: 0 });
    expect(repairAdded(wh.request.input.household, id)).toBe(true);
    expect(repairBtn(wh, id)).toBeUndefined();
    // 行は前へずらした後もその車の枠の中（「維持費」の後。0257）
    expect(carRowsByCar(wh.request.input.household).upkeep.get(id)?.map((p) => p.label)).toEqual(["古くなってからの修理費"]);
  });

  it("手放した後の移動の費用の行は、続きの車の修理費の行として数えない", () => {
    let wh = addCar(open("salariedCoupleTwoKids"), ids(), false);
    const a = car0(wh);
    wh = confirmUntil(fieldOf(wh, "/untilAge").set(wh, 60), a.id);
    wh = addNextCar(wh, a.id, "00000000-0000-4000-8000-0000000000cc");
    wh = addAfterCar(wh, "00000000-0000-4000-8000-0000000000cc");
    // 続きの車（購入の時期が車1を手放す出来事の翌月）に修理費の行は無い
    expect(repairAdded(wh.request.input.household, "00000000-0000-4000-8000-0000000000cc")).toBe(false);
  });
});

/** 周期 every 年の、これから買う車（購入は3年後） */
function futureCarRepair(every: number): WorkingHousehold {
  const wh = addCar(open("salariedCoupleTwoKids"), ids(), false);
  return mutate(wh, (h) => void (h.cars![0]!.purchase!.everyYears = every));
}
