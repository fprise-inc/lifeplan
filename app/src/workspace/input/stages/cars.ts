// 車（ライフイベントの段階の区画）: 車のひな形（買い替えの周期・車両の価格・現金かローンか・維持費・手放す年齢・万一のときの扱い）。
// エンジンの cars（0008 の追記）をそのまま読み書きする。値の箱を持たない項目なので、空欄を目安で補った値は「推定」の印を画面の側（assumed）に持つ
import type { Car, Household, Member } from "../../../engine/types.ts";
import { addMonths, ageAt } from "../../levers.ts";
import { CAR_ESTIMATE, type Estimate } from "../estimates.ts";
import { byId, field, getPath, plain, setPath, timepointField, type FieldDef, type Finder, type GroupDef, type Level, type SectionDef } from "../form.ts";
import { mutate, newId, type WorkingHousehold } from "../household.ts";
import { GROWTH_KINDS, memberLabel, memberOptions } from "../labels.ts";
import { oneMinus } from "../units.ts";
import { fixGrowth } from "./living.ts";
import { onContingencyDetailFields, onContingencyFields } from "./onContingency.ts";

const cars = (h: Household) => h.cars;

/** 車の円の欄（箱を持たない数）。estimate があれば、空欄は目安で補い「推定」の印を付ける */
function carYen(o: { key: string; item: string; label: string; level: Level; basis: "annual" | "once"; find: Finder; path: readonly string[]; estimate?: Estimate; optional?: boolean; help?: string }): FieldDef {
  return field({
    key: o.key,
    item: o.item,
    label: o.label,
    level: o.level,
    kind: "yen",
    basis: o.basis,
    ...(o.help !== undefined ? { help: o.help } : {}),
    optional: o.optional === true || o.estimate !== undefined,
    ...(o.estimate !== undefined ? { blankIsEstimate: true } : {}),
    get: (wh) => {
      const v = getPath(o.find(wh.request.input.household, wh), o.path);
      return { value: typeof v === "number" ? v : null, estimated: wh.assumed[o.key] ?? null };
    },
    set: (wh, v) => {
      const next = mutate(wh, (h, req) => {
        const t = o.find(h, { ...wh, request: req });
        if (t === undefined) return;
        setPath(t, o.path, v === null ? o.estimate?.value : Number(v));
      });
      const assumed = { ...next.assumed };
      if (v === null && o.estimate !== undefined) assumed[o.key] = o.estimate.basis;
      else delete assumed[o.key];
      return { ...next, assumed };
    },
  });
}

/** 維持費の入れ方: 合計の1欄か、内訳（自動車税・保険・車検・駐車場・燃料）か */
export function upkeepMode(c: Car): "total" | "detail" {
  if (c.upkeep !== undefined) return "total";
  return c.tax !== undefined || c.insurance !== undefined || c.inspection !== undefined || c.parking !== undefined || c.fuel !== undefined ? "detail" : "total";
}

/** 内訳を年額にならした合計（車検は1回の額÷周期） */
export function upkeepAnnual(c: Car): number {
  if (c.upkeep !== undefined) return c.upkeep.annual;
  const insp = c.inspection === undefined ? 0 : Math.round(c.inspection.amount / (c.inspection.everyYears ?? 2));
  return (c.tax?.annual ?? 0) + (c.insurance?.annual ?? 0) + insp + (c.parking?.annual ?? 0) + (c.fuel?.annual ?? 0);
}

const ownerOf = (h: Household, c: Car | undefined): Member | undefined => (c === undefined ? undefined : h.members.find((m) => m.id === c.owner));

function carGroup(wh: WorkingHousehold, c: Car, i: number): GroupDef {
  const find = byId(cars, c.id);
  const k = `ev/car/${c.id}`;
  const car = (h: Household, w: WorkingHousehold) => find(h, w) as Car | undefined;
  const owner = (h: Household) => ownerOf(h, (h.cars ?? []).find((x) => x.id === c.id));
  const mode = upkeepMode(c);
  const fields: FieldDef[] = [
    plain({ key: `${k}/owner`, item: "car.owner", label: "名義", level: "simple", kind: "select", options: memberOptions(wh), find, path: ["owner"] }),
    plain({
      key: `${k}/owned`,
      item: "car.purchase",
      label: "今の車を持っている",
      level: "simple",
      kind: "bool",
      find,
      path: ["purchase", "owned"],
      optional: true,
      fallback: false,
      help: "持っているときは、下の年月から買い替えます（その前の車検も数えます）",
    }),
    timepointField({ key: `${k}/first`, item: "car.purchase", label: c.purchase.owned === true ? "次の買い替えの年月" : "購入の年月", level: "simple", find, path: ["purchase", "first"], ageOf: owner }),
    plain({ key: `${k}/every`, item: "car.purchase", label: "買い替えの周期", level: "simple", kind: "int", suffix: "年ごと", min: 1, max: 30, find, path: ["purchase", "everyYears"] }),
    carYen({ key: `${k}/price`, item: "car.purchase", label: "車両の価格", level: "simple", basis: "once", find, path: ["purchase", "price"], estimate: CAR_ESTIMATE.price, help: "今の価格で入れます（物価上昇率で伸ばします）。空欄なら目安で計算します" }),
    carYen({ key: `${k}/tradeIn`, item: "car.purchase", label: "下取り", level: "simple", basis: "once", find, path: ["purchase", "tradeIn"], optional: true, help: "下取りを引いた額を車両の価格に入れたときは空欄に" }),
    field({
      key: `${k}/pay`,
      item: "car.loan",
      label: "買い方",
      level: "simple",
      kind: "select",
      structural: true,
      options: [
        { value: "cash", label: "現金" },
        { value: "loan", label: "ローン" },
      ],
      get: (w) => ({ value: car(w.request.input.household, w)?.loan === undefined ? "cash" : "loan" }),
      set: (w, v) =>
        mutate(w, (h, req) => {
          const x = car(h, { ...w, request: req });
          if (x === undefined) return;
          if (v === "loan") x.loan ??= { share: "0.8", rate: "0.025", termMonths: 60 };
          else delete x.loan;
        }),
    }),
  ];
  if (c.loan !== undefined) {
    fields.push(
      field({
        key: `${k}/down`,
        item: "car.loan",
        label: "頭金（下取りを引いた額に対する割合）",
        level: "simple",
        kind: "pct",
        optional: true,
        help: "残りをローンで借ります。買い替えのたびに同じ割合で借ります",
        get: (w) => {
          const share = car(w.request.input.household, w)?.loan?.share;
          return share === undefined ? { value: "0", implicit: true } : { value: oneMinus(share) };
        },
        set: (w, v) =>
          mutate(w, (h, req) => {
            const x = car(h, { ...w, request: req });
            if (x?.loan === undefined) return;
            if (v === null || Number(v) === 0) delete x.loan.share;
            else x.loan.share = oneMinus(String(v));
          }),
      }),
      field({
        key: `${k}/term`,
        item: "car.loan",
        label: "ローンの年数",
        level: "simple",
        kind: "int",
        suffix: "年",
        min: 1,
        max: 10,
        get: (w) => {
          const t = car(w.request.input.household, w)?.loan?.termMonths;
          return t === undefined ? { value: null } : { value: Math.round(t / 12), derived: t % 12 !== 0 ? `${t}か月（年に直すとずれる）` : null };
        },
        set: (w, v) =>
          mutate(w, (h, req) => {
            const x = car(h, { ...w, request: req });
            if (x?.loan !== undefined && v !== null) x.loan.termMonths = Number(v) * 12;
          }),
      }),
      plain({ key: `${k}/rate`, item: "car.loan", label: "ローンの金利（年・固定）", level: "simple", kind: "pct", find, path: ["loan", "rate"] }),
    );
  }
  // 維持費
  fields.push(
    field({
      key: `${k}/upkeepMode`,
      item: "car.upkeep",
      label: "維持費の入れ方",
      level: "detail",
      kind: "select",
      structural: true,
      options: [
        { value: "total", label: "合計（年額）で入れる" },
        { value: "detail", label: "内訳（自動車税・保険・車検・駐車場・燃料）で入れる" },
      ],
      get: (w) => {
        const x = car(w.request.input.household, w);
        return { value: x === undefined ? null : upkeepMode(x) };
      },
      set: (w, v) => {
        const next = mutate(w, (h, req) => {
          const x = car(h, { ...w, request: req });
          if (x === undefined) return;
          if (v === "detail" && x.upkeep !== undefined) {
            const total = x.upkeep.annual;
            delete x.upkeep;
            x.tax = { annual: CAR_ESTIMATE.tax.value };
            x.insurance = { annual: CAR_ESTIMATE.insurance.value };
            x.inspection = { amount: CAR_ESTIMATE.inspection.value };
            const rest = total - CAR_ESTIMATE.tax.value - CAR_ESTIMATE.insurance.value - Math.round(CAR_ESTIMATE.inspection.value / 2);
            if (rest > 0) x.fuel = { annual: rest };
          } else if (v === "total" && x.upkeep === undefined) {
            const total = upkeepAnnual(x);
            for (const f of ["tax", "insurance", "inspection", "parking", "fuel"] as const) delete x[f];
            x.upkeep = { annual: total };
          }
        });
        return next;
      },
    }),
  );
  if (mode === "total")
    fields.push(carYen({ key: `${k}/upkeep`, item: "car.upkeep", label: "維持費（年額の合計）", level: "simple", basis: "annual", find, path: ["upkeep", "annual"], estimate: CAR_ESTIMATE.upkeep, help: "自動車税・保険・車検・駐車場・燃料などの合計。空欄なら目安で計算します" }));
  else {
    fields.push(
      field({
        key: `${k}/upkeepSum`,
        item: "car.upkeep",
        label: "維持費（年額の合計）",
        level: "simple",
        kind: "yen",
        basis: "annual",
        readOnly: "内訳で入れています（詳細で直せます）。車検は1回の額を周期でならしています",
        get: (w) => {
          const x = car(w.request.input.household, w);
          return { value: x === undefined ? null : upkeepAnnual(x) };
        },
        set: (w) => w,
      }),
      carYen({ key: `${k}/tax`, item: "car.tax", label: "自動車税（年額・毎年5月）", level: "detail", basis: "annual", find, path: ["tax", "annual"], estimate: CAR_ESTIMATE.tax }),
      carYen({ key: `${k}/insurance`, item: "car.insurance", label: "自動車保険（年額）", level: "detail", basis: "annual", find, path: ["insurance", "annual"], estimate: CAR_ESTIMATE.insurance }),
      carYen({ key: `${k}/inspection`, item: "car.inspection", label: "車検（1回の額）", level: "detail", basis: "once", find, path: ["inspection", "amount"], estimate: CAR_ESTIMATE.inspection }),
      plain({ key: `${k}/inspFirst`, item: "car.inspection", label: "最初の車検（購入から）", level: "detail", kind: "int", suffix: "年後", min: 1, max: 10, find, path: ["inspection", "firstAfterYears"], optional: true, fallback: 3 }),
      plain({ key: `${k}/inspEvery`, item: "car.inspection", label: "その後の車検の周期", level: "detail", kind: "int", suffix: "年ごと", min: 1, max: 10, find, path: ["inspection", "everyYears"], optional: true, fallback: 2 }),
      carYen({ key: `${k}/parking`, item: "car.parking", label: "駐車場（年額）", level: "detail", basis: "annual", find, path: ["parking", "annual"], optional: true }),
      carYen({ key: `${k}/fuel`, item: "car.fuel", label: "ガソリン（年額）", level: "detail", basis: "annual", find, path: ["fuel", "annual"], optional: true }),
    );
  }
  // いつまで乗るか（名義の人の年齢で）
  fields.push(
    field({
      key: `${k}/untilAge`,
      item: "car.until",
      label: "手放す年齢（名義の人）",
      level: "simple",
      kind: "int",
      suffix: "歳",
      min: 18,
      max: 100,
      optional: true,
      help: "その年齢に達する月で手放します（空欄は最後まで）",
      get: (w) => {
        const h = w.request.input.household;
        const x = car(h, w);
        const u = x?.until;
        if (u == null) return { value: null, hint: "最後まで", implicit: true };
        if (u.memberAge !== undefined && u.memberAge.member === x?.owner && (u.memberAge.months ?? 0) === 0) return { value: u.memberAge.years };
        const o = ownerOf(h, x);
        const ym = u.at;
        return { value: o !== undefined && ym !== undefined ? ageAt(o, ym) : null, derived: ym !== undefined ? `年月（${ym}）で入っています。書き換えると年齢の形にします` : "ほかの形の時点で入っています" };
      },
      set: (w, v) =>
        mutate(w, (h, req) => {
          const x = car(h, { ...w, request: req });
          if (x === undefined) return;
          if (v === null) {
            if (x.until !== undefined) x.until = null;
          } else x.until = { memberAge: { member: x.owner, years: Number(v), months: 0 } };
        }),
    }),
    plain({ key: `${k}/growth`, item: "car.growth", label: "価格・維持費の伸び方", level: "detail", kind: "select", options: GROWTH_KINDS, find, path: ["growth", "kind"], fallback: "inflation", optional: true, after: (_h, t, v) => fixGrowth(t, v) }),
  );
  if (c.growth?.kind === "rate") fields.push(plain({ key: `${k}/growthRate`, item: "car.growth", label: "決まった伸び率（年）", level: "detail", kind: "pct", find, path: ["growth", "rate"] }));
  fields.push(...onContingencyFields({ key: `${k}/on`, item: "car.onContingency", find, path: ["onContingency"], help: "名義の人などの万一の月の翌月から、買い替えと維持費に当てます。組んだローンの返済は続きます" }));
  fields.push(...onContingencyDetailFields({ key: `${k}/on`, item: "car.onContingency", find, path: ["onContingency"], on: c.onContingency }));
  return {
    key: k,
    title: `車 ${i + 1}（${memberLabel(wh, c.owner)}）`,
    level: "simple",
    fields,
    actions: [
      {
        key: `${k}/remove`,
        label: "外す",
        level: "simple",
        danger: true,
        run: (w) => {
          const next = mutate(w, (h) => {
            h.cars = (h.cars ?? []).filter((x) => x.id !== c.id);
            if (h.cars.length === 0) delete h.cars;
          });
          return { ...next, assumed: Object.fromEntries(Object.entries(next.assumed).filter(([key]) => !key.startsWith(`${k}/`))) };
        },
      },
    ],
  };
}

/** 車を足す（目安の値で。目安で入れた欄は「推定」） */
export function addCar(wh: WorkingHousehold, id: () => string = newId): WorkingHousehold {
  const h = wh.request.input.household;
  const owner = h.members.find((m) => m.kind === "self") ?? h.members[0];
  if (owner === undefined) return wh;
  const carId = id();
  const k = `ev/car/${carId}`;
  const next = mutate(wh, (hh) => {
    (hh.cars ??= []).push({
      id: carId,
      owner: owner.id,
      purchase: { first: { at: addMonths(wh.request.input.baseMonth, 36) }, everyYears: CAR_ESTIMATE.everyYears.value, price: CAR_ESTIMATE.price.value, tradeIn: CAR_ESTIMATE.tradeIn.value, owned: true },
      upkeep: { annual: CAR_ESTIMATE.upkeep.value },
    });
  });
  return { ...next, assumed: { ...next.assumed, [`${k}/price`]: CAR_ESTIMATE.price.basis, [`${k}/tradeIn`]: CAR_ESTIMATE.tradeIn.basis, [`${k}/upkeep`]: CAR_ESTIMATE.upkeep.basis } };
}

export function carSection(wh: WorkingHousehold): SectionDef {
  const list = wh.request.input.household.cars ?? [];
  return {
    key: "ev/cars",
    title: "車",
    note: "買い替え（下取り・ローン）と維持費を、車ごとに入れます。基本生活費の「交通」には車の費用を入れないでください（二重になります）",
    level: "simple",
    groups: list.map((c, i) => carGroup(wh, c, i)),
    actions: [{ key: "ev/addCar", label: "＋ 車（目安の値で入れる）", level: "simple", run: (w) => addCar(w) }],
  };
}
