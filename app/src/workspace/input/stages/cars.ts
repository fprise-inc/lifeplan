// 車のカード（0069）: 車ごとの買い替え（買い方・下取り・ローン）・維持費（入れ方 合計／内訳・名前つきの行）・手放す時期と、
// 車のカードの出るお金の行（車を持たない移動の費用・手放した後の移動の費用・古くなってからの修理費・車の用品）と、今返している自動車ローン。
// エンジンの cars（0008 の追記）をそのまま読み書きする。値の箱を持たない項目なので、空欄を目安で補った値は「推定」の印を
// 画面の側（assumed。0.16 の欄のキーで読み替えられる欄）か物の値の状態の欄（valueStates。新しい欄）に持つ
import type { Car, Debt, Household, Member, PeriodicExpense, Timepoint } from "../../../engine/types.ts";
import { addMonths, ageAt, parseYm } from "../../levers.ts";
import type { Address } from "../../store/readings.ts";
import { CAR_ESTIMATE, type Estimate } from "../estimates.ts";
import { byId, field, getPath, plain, resolveTimepoint, setPath, timepointField, timeView, type ActionDef, type FieldDef, type Finder, type GroupDef, type Level, type SectionDef, type StageDef } from "../form.ts";
import { mutate, newId, presetBasis, standardBox, type WorkingHousehold } from "../household.ts";
import { GROWTH_KINDS, memberLabel, memberOptions } from "../labels.ts";
import { addExpense, moneySections } from "../moneyRows.ts";
import { materializeEvent } from "../namedEvents.ts";
import { manYen } from "../readLines.ts";
import { putRow, type StateRow } from "../rows.ts";
import { oneMinus } from "../units.ts";
import { carLoanGroups, newCarLoan } from "./housing.ts";
import { fixGrowth } from "./living.ts";
import { onContingencyDetailFields, onContingencyFields } from "./onContingency.ts";

type Obj = Record<string, unknown>;
const cars = (h: Household) => h.cars;
const inputOf = (req: WorkingHousehold["request"]): Obj => req.input as unknown as Obj;
const addr = (id: string, item: string, at: string[] = []): Address => ({ target: { object: id }, item, at });
const estRow = (basis: string): StateRow => ({ state: "estimated", origin: { kind: "auto" }, estimate: { method: "standard", basis } });
const withAddress = (f: FieldDef, a: Address): FieldDef => ({ ...f, address: () => a });

/** ローンの目安（借入8割・5年・年2.5%。目安のボタンの値＝推定） */
const LOAN_SHARE = "0.8";
const LOAN_RATE = "0.025";
const LOAN_TERM = 60;
const LOAN_BASIS = { share: presetBasis("借入 下取りを引いた額の8割"), rate: presetBasis("金利 年2.5%"), term: presetBasis("5年で返す") };
/** 次の買い替え・購入の時期の標準の値（3年後） */
const FIRST_BASIS = "標準の値（3年後。この世帯に合わせて直してください）";

/**
 * 下取り・売却の残価の目安（ひな形。車両の価格に対する割合。3年50%・5年35%・8年15%・10年以上5%、その間はならす）。
 * 原本で確かめた市場の統計ではないので、根拠は「ひな形の目安」と書く
 */
export function residualRate(years: number): number {
  const pts: readonly [number, number][] = [
    [3, 0.5],
    [5, 0.35],
    [8, 0.15],
    [10, 0.05],
  ];
  if (years <= 3) return 0.5;
  for (let i = 1; i < pts.length; i++) {
    const [y1, r1] = pts[i] as [number, number];
    const [y0, r0] = pts[i - 1] as [number, number];
    if (years <= y1) return r0 + ((r1 - r0) * (years - y0)) / (y1 - y0);
  }
  return 0.05;
}

/** 下取りの目安の額と根拠（価格×周期の残価の目安。1万円単位） */
export function tradeInEstimate(price: number, everyYears: number): Estimate {
  const rate = residualRate(everyYears);
  const value = Math.round((price * rate) / 10000) * 10000;
  return { value, basis: `ひな形の目安（${everyYears}年乗ったときの残価: 車両の価格の${Math.round(rate * 100)}%。この世帯に合わせて直してください）` };
}

/** 車の円の欄（箱を持たない数）。estimate があれば、空欄は目安で補い「推定」の印を付ける */
function carYen(o: {
  key: string;
  item: string;
  label: string;
  level: Level;
  basis: "annual" | "once";
  find: Finder;
  path: readonly string[];
  estimate?: Estimate | ((wh: WorkingHousehold) => Estimate);
  optional?: boolean;
  help?: string;
  after?: (w: WorkingHousehold) => WorkingHousehold;
}): FieldDef {
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
      const est = typeof o.estimate === "function" ? o.estimate(wh) : o.estimate;
      const next = mutate(wh, (h, req) => {
        const t = o.find(h, { ...wh, request: req });
        if (t === undefined) return;
        setPath(t, o.path, v === null ? est?.value : Number(v));
      });
      const assumed = { ...next.assumed };
      if (v === null && est !== undefined) assumed[o.key] = est.basis;
      else delete assumed[o.key];
      const out = { ...next, assumed };
      return o.after !== undefined ? o.after(out) : out;
    },
  });
}

const hasBreakdown = (c: Car): boolean => c.tax !== undefined || c.insurance !== undefined || c.inspection !== undefined || c.parking !== undefined || c.fuel !== undefined || (c.upkeepOther ?? []).length > 0;

/** 維持費の入れ方: 合計の1欄か、内訳（自動車税・保険・車検・駐車場・燃料・名前つきの行）か。入れ方の無い古い車は入っている物から読む */
export function upkeepMode(c: Car): "total" | "detail" {
  if (c.upkeepMode !== undefined) return c.upkeepMode;
  if (c.upkeep !== undefined) return "total";
  return hasBreakdown(c) ? "detail" : "total";
}

/** 内訳を年額にならした合計（車検は1回の額÷周期。名前つきの行を含む） */
export function breakdownAnnual(c: Car): number {
  const insp = c.inspection === undefined ? 0 : Math.round(c.inspection.amount / (c.inspection.everyYears ?? 2));
  return (c.tax?.annual ?? 0) + (c.insurance?.annual ?? 0) + insp + (c.parking?.annual ?? 0) + (c.fuel?.annual ?? 0) + (c.upkeepOther ?? []).reduce((s, o) => s + o.annual, 0);
}

/** 計算に入る維持費の年額（入れ方のとおり。入れ方の無い古い車は入っている物を全部） */
export function upkeepAnnual(c: Car): number {
  if (c.upkeepMode === "total") return c.upkeep?.annual ?? 0;
  if (c.upkeepMode === "detail") return breakdownAnnual(c);
  return (c.upkeep?.annual ?? 0) + breakdownAnnual(c);
}

/** 2つの年月の間の月数（b − a） */
function monthsBetween(a: string, b: string): number {
  const x = parseYm(a);
  const y = parseYm(b);
  return (y.y - x.y) * 12 + (y.m - x.m);
}

/**
 * この車の一生の費用（今の値段で）: 計算の最後か手放す月までの、買い替え（下取りを引いた額）と維持費の合計。ローンの利息・物価の伸びは入れない
 * （エンジンの計算とは別の、見出しの目安）。買い替えの回数も返す
 */
export function lifetimeCost(h: Household, c: Car, baseMonth: string, endYear: number): { total: number; purchases: number } | null {
  const first = resolveTimepoint(h, c.purchase.first);
  if (first === null) return null;
  const endYm = `${endYear}-12`;
  const untilYm = c.until == null ? endYm : (resolveTimepoint(h, c.until) ?? endYm);
  const last = untilYm < endYm ? untilYm : endYm;
  let total = 0;
  let purchases = 0;
  for (let m = first, k = 0; m <= last; m = addMonths(m, 12 * c.purchase.everyYears), k++) {
    if (m < baseMonth) continue;
    total += Math.max(0, c.purchase.price - (k > 0 || c.purchase.owned === true ? (c.purchase.tradeIn ?? 0) : 0));
    purchases++;
  }
  const from = c.purchase.owned === true || first < baseMonth ? baseMonth : first;
  const months = Math.max(0, monthsBetween(from, last) + 1);
  total += Math.round((upkeepAnnual(c) * months) / 12);
  return { total, purchases };
}

const ownerOf = (h: Household, c: Car | undefined): Member | undefined => (c === undefined ? undefined : h.members.find((m) => m.id === c.owner));
const isEventForm = (t: Timepoint | null | undefined): boolean => t?.event !== undefined;

/** 車の購入・手放す時期を指す出来事の時点（まだ出来事でなければ出来事にする。書き換える世帯 h の上で）。offsetMonths は足すずらし（月） */
function carEventAt(h: Household, c: Car, kind: "carPurchase" | "carRelease", offsetMonths: number): Timepoint | null {
  const cur = kind === "carPurchase" ? c.purchase.first : c.until;
  if (cur == null) return null;
  const tp = isEventForm(cur) ? structuredClone(cur) : materializeEvent(h, { event: `new:${kind}:${c.id}` }, newId);
  if (tp === null) return null;
  const months = (tp.offset?.years ?? 0) * 12 + (tp.offset?.months ?? 0) + offsetMonths;
  const { offset: _o, ...rest } = tp;
  void _o;
  const mm = months % 12;
  return months === 0 ? rest : { ...rest, offset: { years: Math.trunc(months / 12), months: mm === 0 ? 0 : mm } };
}

/** 手放した後の移動の費用（タクシー・バスなど。ひな形の目安 月1万円。始まりは出来事「車を手放す」の翌月） */
export const AFTER_CAR_PRESET = { monthly: 10000, basis: "ひな形の目安（手放した後の移動の費用 月1万円。この世帯に合わせて直してください）" };
/** 車を持たない移動の費用（カーシェア・レンタカー。ひな形の目安 月1万円） */
export const CARSHARE_PRESET = { monthly: 10000, basis: "ひな形の目安（カーシェア・レンタカー 月1万円。この世帯に合わせて直してください）" };
/** 古くなってからの修理費（ひな形の目安 年10万円。始まりは出来事「車の購入」から10年後） */
export const REPAIR_PRESET = { annual: 100000, afterYears: 10, basis: "ひな形の目安（古くなってからの修理費 年10万円。この世帯に合わせて直してください）" };

/** 車のカードの出るお金の行を足す（種類「車の修理・用品など」・表の行「車の維持費」）。額の印は推定（ひな形の目安） */
function addCarRow(wh: WorkingHousehold, o: { label: string; amount: number; monthly: boolean; basis: string; from?: (h: Household) => Timepoint | null; to?: (h: Household) => Timepoint | null }, id: string = newId()): WorkingHousehold {
  const w = addExpense(wh, "car", id);
  return mutate(w, (h) => {
    const p = (h.periodicExpenses ?? []).find((x) => x.id === id) as PeriodicExpense | undefined;
    if (p === undefined) return;
    p.label = o.label;
    p.row = "cf.expense.living.car";
    p.everyYears = 1;
    if (o.monthly) p.monthly = true;
    else delete p.monthly;
    p.amount = standardBox(o.amount, o.basis) as PeriodicExpense["amount"];
    const from = o.from?.(h);
    if (from != null) p.from = from;
    p.to = o.to?.(h) ?? null;
  });
}

/** 手放した後の移動の費用を足す（始まりは、その車を手放す出来事の翌月。車の手放す時期が動けば一緒に動く） */
export function addAfterCar(wh: WorkingHousehold, carId: string, id: string = newId()): WorkingHousehold {
  return addCarRow(
    wh,
    {
      label: "手放した後の移動の費用（タクシー・バスなど）",
      amount: AFTER_CAR_PRESET.monthly,
      monthly: true,
      basis: AFTER_CAR_PRESET.basis,
      from: (h) => {
        const c = (h.cars ?? []).find((x) => x.id === carId);
        return c === undefined ? null : carEventAt(h, c, "carRelease", 1);
      },
    },
    id,
  );
}

/** 古くなってからの修理費を足す（始まりは出来事「この車の購入」から10年後。今の車は次の買い替えの周期の前に買ったとみなす。終わりは手放す時期） */
export function addRepair(wh: WorkingHousehold, carId: string, id: string = newId()): WorkingHousehold {
  return addCarRow(
    wh,
    {
      label: "古くなってからの修理費",
      amount: REPAIR_PRESET.annual,
      monthly: false,
      basis: REPAIR_PRESET.basis,
      from: (h) => {
        const c = (h.cars ?? []).find((x) => x.id === carId);
        if (c === undefined) return null;
        const back = c.purchase.owned === true ? c.purchase.everyYears : 0;
        return carEventAt(h, c, "carPurchase", (REPAIR_PRESET.afterYears - back) * 12);
      },
      to: (h) => {
        const c = (h.cars ?? []).find((x) => x.id === carId);
        return c === undefined || c.until == null ? null : carEventAt(h, c, "carRelease", 0);
      },
    },
    id,
  );
}

/** この車の続きを足す: 手放す時期の翌月に、同じ名義・同じ欄の車（これから買う車）を足す。手放す時期が動けば次の車の購入も動く */
export function addNextCar(wh: WorkingHousehold, carId: string, id: string = newId()): WorkingHousehold {
  const k = `ev/car/${id}`;
  let ok = false;
  const next = mutate(wh, (h) => {
    const c = (h.cars ?? []).find((x) => x.id === carId);
    if (c === undefined) return;
    const first = carEventAt(h, c, "carRelease", 1);
    if (first === null) return;
    const copy = structuredClone(c);
    delete copy.valueStates;
    const others = copy.upkeepOther?.map((o) => ({ ...o, id: newId() }));
    (h.cars ??= []).push({ ...copy, id, purchase: { ...copy.purchase, first, owned: false }, until: null, ...(others !== undefined ? { upkeepOther: others } : {}) });
    ok = true;
  });
  if (!ok) return wh;
  // 推定の印は元の車の印を写す（同じ値なので）
  const src = `ev/car/${carId}/`;
  const assumed = { ...next.assumed };
  for (const [key, v] of Object.entries(wh.assumed)) if (key.startsWith(src)) assumed[`${k}/${key.slice(src.length)}`] = v;
  return { ...next, assumed };
}

/** その車を手放す出来事を、手放した後の移動の費用の行がもう指しているか */
function afterCarAdded(h: Household, carId: string): boolean {
  const ev = (h.cars ?? []).find((x) => x.id === carId)?.until?.event;
  return ev !== undefined && (h.periodicExpenses ?? []).some((p) => p.from.event === ev && p.kind === "car");
}

export function carGroups(wh: WorkingHousehold, c: Car, i: number, all: readonly Car[]): GroupDef[] {
  const find = byId(cars, c.id);
  const k = `ev/car/${c.id}`;
  const car = (h: Household, w: WorkingHousehold) => find(h, w) as Car | undefined;
  const owner = (h: Household) => ownerOf(h, (h.cars ?? []).find((x) => x.id === c.id));
  const mode = upkeepMode(c);
  const h0 = wh.request.input.household;
  // 推定のままの下取りは、価格・周期を直したら目安を入れ直す
  const refreshTradeIn = (w: WorkingHousehold): WorkingHousehold => {
    const key = `${k}/tradeIn`;
    if (w.assumed[key] === undefined) return w;
    const x = car(w.request.input.household, w);
    if (x === undefined) return w;
    const e = tradeInEstimate(x.purchase.price, x.purchase.everyYears);
    const moved = mutate(w, (h, req) => {
      const t = car(h, { ...w, request: req });
      if (t !== undefined) t.purchase.tradeIn = e.value;
    });
    return { ...moved, assumed: { ...moved.assumed, [key]: e.basis } };
  };
  const fields: FieldDef[] = [
    plain({ key: `${k}/owner`, item: "car.owner", label: "名義（使う人）", level: "simple", kind: "select", options: memberOptions(wh), find, path: ["owner"] }),
    withAddress(
      timepointField({
        key: `${k}/first`,
        item: "car.purchase",
        label: c.purchase.owned === true ? "次の買い替えの時期" : "購入の時期",
        level: "simple",
        find,
        path: ["purchase", "first"],
        ageOf: owner,
        mode: "now",
        anchor: "carPurchase",
        help: "「今から○年後」・名義の人の年齢・年月で入れます",
      }),
      addr(c.id, "car.purchase", ["first"]),
    ),
    field({
      key: `${k}/every`,
      item: "car.purchase",
      label: "買い替えの周期",
      level: "simple",
      kind: "int",
      suffix: "年ごと",
      min: 1,
      max: 30,
      get: (w) => ({ value: car(w.request.input.household, w)?.purchase.everyYears ?? null, assumed: w.assumed[`${k}/every`] ?? null }),
      set: (w, v) => {
        if (v === null) return w;
        const next = mutate(w, (h, req) => {
          const t = car(h, { ...w, request: req });
          if (t !== undefined) t.purchase.everyYears = Number(v);
        });
        const rest = Object.fromEntries(Object.entries(next.assumed).filter(([key]) => key !== `${k}/every`));
        return refreshTradeIn({ ...next, assumed: rest });
      },
    }),
    carYen({ key: `${k}/price`, item: "car.purchase", label: "車両の価格", level: "simple", basis: "once", find, path: ["purchase", "price"], estimate: CAR_ESTIMATE.price, help: "今の価格で入れます（物価上昇率で伸ばします）。空欄なら目安で計算します", after: refreshTradeIn }),
    carYen({
      key: `${k}/tradeIn`,
      item: "car.purchase",
      label: "下取り",
      level: "detail",
      basis: "once",
      find,
      path: ["purchase", "tradeIn"],
      estimate: (w) => {
        const x = car(w.request.input.household, w);
        return tradeInEstimate(x?.purchase.price ?? CAR_ESTIMATE.price.value, x?.purchase.everyYears ?? CAR_ESTIMATE.everyYears.value);
      },
      help: "次の買い替えで車両の価格から引く額です。空欄なら、車両の価格と周期から残価の目安で入れます。下取りを引いた額を車両の価格に入れたときは0円に",
    }),
    plain({
      key: `${k}/owned`,
      item: "car.purchase",
      label: "今の車を持っている",
      level: "detail",
      kind: "bool",
      find,
      path: ["purchase", "owned"],
      optional: true,
      fallback: false,
      help: "持っているときは、上の時期から買い替えます（その前の車検も数え、1回目から下取りを引きます）",
    }),
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
      help: "残価設定ローン・カーリースは、まだ計算に入っていません（リースは車両の価格を0円にして、リース料を下の出るお金の行で入れてください）",
      get: (w) => ({ value: car(w.request.input.household, w)?.loan === undefined ? "cash" : "loan" }),
      set: (w, v) => {
        const loan = v === "loan";
        const next = mutate(w, (h, req) => {
          const x = car(h, { ...w, request: req });
          if (x === undefined) return;
          if (!loan) delete x.loan;
          else x.loan ??= { share: LOAN_SHARE, rate: LOAN_RATE, termMonths: LOAN_TERM };
        });
        // ローンの目安（借入8割・5年・年2.5%）は推定の印。現金に戻したら印も外す
        const keys = { [`${k}/down`]: LOAN_BASIS.share, [`${k}/term`]: LOAN_BASIS.term, [`${k}/rate`]: LOAN_BASIS.rate };
        const assumed = Object.fromEntries(Object.entries(next.assumed).filter(([key]) => !(key in keys)));
        return { ...next, assumed: loan && c.loan === undefined ? { ...assumed, ...keys } : loan ? next.assumed : assumed };
      },
    }),
  ];
  if (c.loan !== undefined) {
    fields.push(
      withAddress(
        field({
          key: `${k}/down`,
          item: "car.loan",
          label: "頭金（下取りを引いた額に対する割合）",
          // ローンの条件（頭金・年数・金利）は目安で十分なので詳細。標準はローンかどうかの選び方だけ（0078）
          level: "detail",
          kind: "pct",
          optional: true,
          help: "残りをローンで借ります。買い替えのたびに同じ割合で借ります",
          get: (w) => {
            const share = car(w.request.input.household, w)?.loan?.share;
            const assumed = w.assumed[`${k}/down`] ?? null;
            return share === undefined ? { value: "0", implicit: true, assumed } : { value: oneMinus(share), assumed };
          },
          set: (w, v) =>
            mutate(w, (h, req) => {
              const x = car(h, { ...w, request: req });
              if (x?.loan === undefined) return;
              if (v === null || Number(v) === 0) delete x.loan.share;
              else x.loan.share = oneMinus(String(v));
            }),
        }),
        addr(c.id, "car.loan", ["share"]),
      ),
      withAddress(
        field({
          key: `${k}/term`,
          item: "car.loan",
          label: "ローンの年数",
          level: "detail",
          kind: "int",
          suffix: "年",
          min: 1,
          max: 10,
          get: (w) => {
            const t = car(w.request.input.household, w)?.loan?.termMonths;
            const assumed = w.assumed[`${k}/term`] ?? null;
            return t === undefined ? { value: null, assumed } : { value: Math.round(t / 12), derived: t % 12 !== 0 ? `${t}か月（年に直すとずれる）` : null, assumed };
          },
          set: (w, v) =>
            mutate(w, (h, req) => {
              const x = car(h, { ...w, request: req });
              if (x?.loan !== undefined && v !== null) x.loan.termMonths = Number(v) * 12;
            }),
        }),
        addr(c.id, "car.loan", ["termMonths"]),
      ),
      withAddress(plain({ key: `${k}/rate`, item: "car.loan", label: "ローンの金利（年・固定）", level: "detail", kind: "pct", find, path: ["loan", "rate"] }), addr(c.id, "car.loan", ["rate"])),
    );
  }
  // 維持費（入れ方: 合計／内訳。どちらの値も残し、計算は入れ方の側だけを数える。0069）
  fields.push(
    withAddress(
      field({
        key: `${k}/upkeepMode`,
        item: "car.upkeepMode",
        label: "維持費の入れ方",
        level: "detail",
        kind: "select",
        structural: true,
        options: [
          { value: "total", label: "合計（年額）で入れる" },
          { value: "detail", label: "内訳で入れる" },
        ],
        help: "切り替えても、もう片方の値は消さずに残します（計算は選んだ入れ方の側だけ）",
        get: (w) => {
          const x = car(w.request.input.household, w);
          return { value: x === undefined ? null : upkeepMode(x) };
        },
        set: (w, v) => setUpkeepMode(w, c.id, v === "detail" ? "detail" : "total"),
      }),
      addr(c.id, "car.upkeepMode"),
    ),
  );
  const detailGroups: GroupDef[] = [];
  if (mode === "total")
    fields.push(carYen({ key: `${k}/upkeep`, item: "car.upkeep", label: "維持費（年額の合計）", level: "simple", basis: "annual", find, path: ["upkeep", "annual"], estimate: CAR_ESTIMATE.upkeep, help: "自動車税・保険・車検・駐車場・燃料などの合計。空欄なら目安で計算します（車の修理・用品などは下の出るお金の行でも足せます）" }));
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
          return { value: x === undefined ? null : breakdownAnnual(x) };
        },
        set: (w) => w,
      }),
      carYen({ key: `${k}/tax`, item: "car.tax", label: "自動車税（年額）", level: "detail", basis: "annual", find, path: ["tax", "annual"], estimate: CAR_ESTIMATE.tax }),
      carYen({ key: `${k}/insurance`, item: "car.insurance", label: "自動車保険（年額）", level: "detail", basis: "annual", find, path: ["insurance", "annual"], estimate: CAR_ESTIMATE.insurance }),
      carYen({ key: `${k}/inspection`, item: "car.inspection", label: "車検（1回の額）", level: "detail", basis: "once", find, path: ["inspection", "amount"], estimate: CAR_ESTIMATE.inspection }),
      plain({ key: `${k}/inspFirst`, item: "car.inspection", label: "最初の車検（購入から）", level: "detail", kind: "int", suffix: "年後", min: 1, max: 10, find, path: ["inspection", "firstAfterYears"], optional: true, fallback: 3 }),
      plain({ key: `${k}/inspEvery`, item: "car.inspection", label: "その後の車検の周期", level: "detail", kind: "int", suffix: "年ごと", min: 1, max: 10, find, path: ["inspection", "everyYears"], optional: true, fallback: 2 }),
      carYen({ key: `${k}/parking`, item: "car.parking", label: "駐車場（年額）", level: "detail", basis: "annual", find, path: ["parking", "annual"], optional: true }),
      carYen({ key: `${k}/fuel`, item: "car.fuel", label: "ガソリン・電気代（年額）", level: "detail", basis: "annual", find, path: ["fuel", "annual"], optional: true }),
    );
    // 内訳の名前つきの行（タイヤ・防錆など）
    for (const o of c.upkeepOther ?? []) {
      const ok = `${k}/other/${o.id}`;
      const ofind: Finder = (h, w) => ((car(h, w)?.upkeepOther ?? []).find((x) => x.id === o.id) as Obj | undefined) ?? undefined;
      detailGroups.push({
        key: ok,
        title: `内訳: ${o.label !== undefined && o.label !== "" ? o.label : "名前のない行"}`,
        level: "detail",
        fields: [
          withAddress(plain({ key: `${ok}/label`, item: "car.upkeepOther", label: "名前", level: "detail", kind: "text", find: ofind, path: ["label"], optional: true }), addr(c.id, "car.upkeepOther", [o.id, "label"])),
          withAddress(
            field({
              key: `${ok}/annual`,
              item: "car.upkeepOther",
              label: "年額",
              level: "detail",
              kind: "yen",
              basis: "annual",
              get: (w) => {
                const v = getPath(ofind(w.request.input.household, w), ["annual"]);
                return { value: typeof v === "number" ? v : null, assumed: w.assumed[`${ok}/annual`] ?? null };
              },
              set: (w, v) =>
                v === null
                  ? w
                  : mutate(w, (h, req) => {
                      const t = ofind(h, { ...w, request: req });
                      if (t !== undefined) t.annual = Number(v);
                    }),
            }),
            addr(c.id, "car.upkeepOther", [o.id, "annual"]),
          ),
        ],
        actions: [
          {
            key: `${ok}/remove`,
            label: "外す",
            level: "detail",
            danger: true,
            run: (w) => {
              const next = mutate(w, (h, req) => {
                const x = car(h, { ...w, request: req });
                if (x === undefined) return;
                x.upkeepOther = (x.upkeepOther ?? []).filter((y) => y.id !== o.id);
                if (x.upkeepOther.length === 0) delete x.upkeepOther;
              });
              return { ...next, assumed: Object.fromEntries(Object.entries(next.assumed).filter(([key]) => !key.startsWith(`${ok}/`))) };
            },
          },
        ],
      });
    }
    detailGroups.push({
      key: `${k}/other/add`,
      level: "detail",
      fields: [],
      actions: [
        {
          key: `${k}/other/add`,
          label: "＋ 内訳の行", help: "タイヤ・防錆など、名前をつけて足す維持費の行です",
          level: "detail",
          run: (w) =>
            mutate(w, (h, req) => {
              const x = car(h, { ...w, request: req });
              if (x !== undefined) (x.upkeepOther ??= []).push({ id: newId(), label: "", annual: 0 });
            }),
        },
      ],
    });
  }
  // いつまで乗るか（名義の人の年齢で）
  fields.push(
    field({
      key: `${k}/untilAge`,
      item: "car.until",
      label: "手放す時期",
      level: "simple",
      kind: "int",
      suffix: "歳",
      min: 18,
      max: 100,
      optional: true,
      help: "名義の人の年齢で入れます。その年齢に達する月で手放します（空欄は最後まで乗る）。手放すときの売却額は、まだ計算に入っていません",
      get: (w) => {
        const h = w.request.input.household;
        const x = car(h, w);
        const raw = x?.until;
        if (raw == null) return { value: null, hint: "最後まで", implicit: true };
        // 出来事「車を手放す」を指しているときは、出来事の時点で読む
        const ev = raw.event !== undefined && raw.offset === undefined ? (h.events ?? []).find((e) => e.id === raw.event) : undefined;
        const u = ev?.at ?? raw;
        if (u.memberAge !== undefined && u.memberAge.member === x?.owner && (u.memberAge.months ?? 0) === 0) return { value: u.memberAge.years };
        const o = ownerOf(h, x);
        const ym = resolveTimepoint(h, u);
        return { value: o !== undefined && ym !== null ? ageAt(o, ym) : null, derived: u.at !== undefined ? `年月（${u.at}）で入っています。書き換えると年齢の形にします` : "ほかの形の時点で入っています" };
      },
      set: (w, v) =>
        mutate(w, (h, req) => {
          const x = car(h, { ...w, request: req });
          if (x === undefined) return;
          if (v === null) {
            if (x.until !== undefined) x.until = null;
            return;
          }
          const at = { memberAge: { member: x.owner, years: Number(v), months: 0 } };
          // 出来事「車を手放す」を指しているときは、出来事のほうを動かす（手放した後の移動の費用・続きの車も一緒に動く）
          const ev = x.until?.event !== undefined && x.until.offset === undefined ? (h.events ?? []).find((e) => e.id === x.until?.event && e.kind === "carRelease") : undefined;
          if (ev !== undefined) ev.at = at;
          else x.until = at;
        }),
      // 時点の部品（0038）: 名義の人の年齢（既定）・年月・今から・出来事からで入れる。結果のタブで動かす項目は年齢の整数のまま
      time: timeView({
        ageOf: owner,
        optional: true,
        nullText: "最後まで",
        anchor: "carRelease",
        read: (w) => car(w.request.input.household, w)?.until ?? null,
        write: (w, tp) =>
          mutate(w, (h, req) => {
            const x = car(h, { ...w, request: req });
            if (x === undefined) return;
            if (tp === null) {
              if (x.until !== undefined) x.until = null;
            } else x.until = tp;
          }),
      }),
    }),
    plain({ key: `${k}/growth`, item: "car.growth", label: "価格・維持費の伸び方", level: "detail", kind: "select", options: GROWTH_KINDS, find, path: ["growth", "kind"], fallback: "inflation", optional: true, after: (_h, t, v) => fixGrowth(t, v) }),
  );
  if (c.growth?.kind === "rate") fields.push(plain({ key: `${k}/growthRate`, item: "car.growth", label: "決まった伸び率（年）", level: "detail", kind: "pct", find, path: ["growth", "rate"] }));
  fields.push(...onContingencyFields({ key: `${k}/on`, item: "car.onContingency", find, path: ["onContingency"], level: "detail", help: "名義の人などの万一の月の翌月から、買い替えと維持費に当てます。組んだローンの返済は続きます" }));
  fields.push(...onContingencyDetailFields({ key: `${k}/on`, item: "car.onContingency", find, path: ["onContingency"], on: c.onContingency, level: "detail" }));
  // 見出しの一生の費用（今の値段で）
  const life = lifetimeCost(h0, c, wh.request.input.baseMonth, wh.request.input.endYear);
  const lifeNote = life === null ? null : `この車の一生の費用（今の値段で・${c.until == null ? "最後まで" : "手放すまで"}）約${manYen(Math.round(life.total / 10000) * 10000)}（買い替え${life.purchases}回・維持費 年${manYen(upkeepAnnual(c))}。ローンの利息・物価の伸びは含みません）`;
  // 車のメニュー（続きの車・手放した後の移動の費用・古くなってからの修理費）
  const actions: ActionDef[] = [];
  const firstYm = resolveTimepoint(h0, c.purchase.first);
  const untilYm = c.until == null ? null : resolveTimepoint(h0, c.until);
  const lastCar = all.filter((x) => x.owner === c.owner).at(-1)?.id === c.id;
  if (c.until != null && lastCar) {
    actions.push({ key: `${k}/next`, label: "＋ この車の続きを足す", help: "手放した翌月から次の車を持つ形で足します", level: "detail", run: (w) => addNextCar(w, c.id) });
    if (!afterCarAdded(h0, c.id)) actions.push({ key: `${k}/afterCar`, label: `＋ 手放した後の移動の費用を足す（目安 年${manYen(AFTER_CAR_PRESET.monthly * 12)}）`, level: "simple", run: (w) => addAfterCar(w, c.id) });
  }
  const neverReplaced = untilYm !== null && firstYm !== null && (c.purchase.owned === true ? untilYm < firstYm : untilYm < addMonths(firstYm, 12 * c.purchase.everyYears));
  if (c.purchase.everyYears >= 10 || neverReplaced) actions.push({ key: `${k}/repair`, label: `＋ 古くなってからの修理費を足す（目安 年${manYen(REPAIR_PRESET.annual)}）`, level: "detail", run: (w) => addRepair(w, c.id) });
  actions.push({
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
  });
  const head: GroupDef = { key: k, title: `車 ${i + 1}（${memberLabel(wh, c.owner)}）`, ...(lifeNote !== null ? { note: lifeNote } : {}), level: "simple", fields, actions };
  return [head, ...detailGroups];
}

/** 合計と内訳の差を置く名前つきの行の名前 */
export const REST_LABEL = "その他（まだ分けていない）";

/**
 * 維持費の入れ方を変える（0069）。どちらの値も消さない:
 * - 内訳へ（初めて）: 合計を目安の割合で分ける（自動車税・保険・車検は目安、残りを燃料。推定の印）
 * - 内訳へ（前に分けた内訳がある）: 内訳は前のまま。合計のほうが多ければ、差を名前つきの行「その他（まだ分けていない）」に置く（推定の印）
 * - 合計へ: 合計が無ければ内訳の合計を入れる（内訳は残す）
 */
export function setUpkeepMode(wh: WorkingHousehold, carId: string, to: "total" | "detail"): WorkingHousehold {
  const k = `ev/car/${carId}`;
  const cur = (wh.request.input.household.cars ?? []).find((x) => x.id === carId);
  if (cur === undefined || cur.upkeepMode === to) return wh;
  const assumed = { ...wh.assumed };
  const next = mutate(wh, (h) => {
    const x = (h.cars ?? []).find((y) => y.id === carId);
    if (x === undefined) return;
    x.upkeepMode = to;
    if (to === "total") {
      if (x.upkeep === undefined) x.upkeep = { annual: breakdownAnnual(x) };
      return;
    }
    const total = x.upkeep?.annual;
    if (!hasBreakdown(x)) {
      const t = total ?? CAR_ESTIMATE.upkeep.value;
      x.tax = { annual: CAR_ESTIMATE.tax.value };
      x.insurance = { annual: CAR_ESTIMATE.insurance.value };
      x.inspection = { amount: CAR_ESTIMATE.inspection.value };
      const rest = t - CAR_ESTIMATE.tax.value - CAR_ESTIMATE.insurance.value - Math.round(CAR_ESTIMATE.inspection.value / 2);
      if (rest > 0) x.fuel = { annual: rest };
      assumed[`${k}/tax`] = CAR_ESTIMATE.tax.basis;
      assumed[`${k}/insurance`] = CAR_ESTIMATE.insurance.basis;
      assumed[`${k}/inspection`] = CAR_ESTIMATE.inspection.basis;
      if (rest > 0) assumed[`${k}/fuel`] = `維持費の合計（年${manYen(t)}）から自動車税・保険・車検の目安を引いた残り`;
      return;
    }
    if (total === undefined) return;
    const others = (x.upkeepOther ?? []).filter((o) => o.label !== REST_LABEL);
    const diff = total - breakdownAnnual({ ...x, upkeepOther: others });
    const old = (x.upkeepOther ?? []).find((o) => o.label === REST_LABEL);
    if (diff > 0) {
      const id = old?.id ?? newId();
      x.upkeepOther = [...others, { id, label: REST_LABEL, annual: diff }];
      assumed[`${k}/other/${id}/annual`] = `合計（年${manYen(total)}）と内訳の差（内訳を直したら外してください）`;
    } else if (old !== undefined && assumed[`${k}/other/${old.id}/annual`] !== undefined) {
      // 差が無くなった推定の行は外す（FP が直した行は残す）
      if (others.length === 0) delete x.upkeepOther;
      else x.upkeepOther = others;
      delete assumed[`${k}/other/${old.id}/annual`];
    }
  });
  return { ...next, assumed };
}

/** 車を足す（目安の値で。目安で入れた欄は「推定」）。owned は今の車（次の買い替えから）か、これから買う車か */
export function addCar(wh: WorkingHousehold, id: () => string = newId, owned = true): WorkingHousehold {
  const h = wh.request.input.household;
  const owner = h.members.find((m) => m.kind === "self") ?? h.members[0];
  if (owner === undefined) return wh;
  const carId = id();
  const k = `ev/car/${carId}`;
  const trade = tradeInEstimate(CAR_ESTIMATE.price.value, CAR_ESTIMATE.everyYears.value);
  const next = mutate(wh, (hh, req) => {
    (hh.cars ??= []).push({
      id: carId,
      owner: owner.id,
      purchase: { first: { at: addMonths(wh.request.input.baseMonth, 36) }, everyYears: CAR_ESTIMATE.everyYears.value, price: CAR_ESTIMATE.price.value, tradeIn: trade.value, owned },
      upkeep: { annual: CAR_ESTIMATE.upkeep.value },
      upkeepMode: "total",
    });
    putRow(inputOf(req), addr(carId, "car.purchase", ["first"]), estRow(FIRST_BASIS));
  });
  return { ...next, assumed: { ...next.assumed, [`${k}/every`]: CAR_ESTIMATE.everyYears.basis, [`${k}/price`]: CAR_ESTIMATE.price.basis, [`${k}/tradeIn`]: trade.basis, [`${k}/upkeep`]: CAR_ESTIMATE.upkeep.basis } };
}

/** 車のカードの出るお金の行の区画（車を持たない移動の費用・車の修理・用品など。空ならカーシェアのひな形のボタン） */
function moveSection(wh: WorkingHousehold, list: readonly Car[]): SectionDef | null {
  const out = moneySections(wh, "car", { claimed: new Set(), level: "simple", outTitle: "出るお金" }).find((s) => s.key.endsWith("/out"));
  if (out === undefined) return null;
  const empty = out.groups.length === 0;
  const share: ActionDef = {
    key: "money/car/out/template/carshare",
    label: `＋ カーシェア・レンタカー（目安 月${manYen(CARSHARE_PRESET.monthly)}）`,
    level: "simple",
    run: (w) => addCarRow(w, { label: "カーシェア・レンタカー", amount: CARSHARE_PRESET.monthly, monthly: true, basis: CARSHARE_PRESET.basis }),
  };
  return {
    ...out,
    note: `${empty ? "まだありません。" : ""}車の修理・用品、車を持たない移動の費用（カーシェア・レンタカー・タクシー）、手放した後の移動の費用。表の行の既定は「車の維持費」${list.length === 0 ? "" : "。手放した後の移動の費用は、手放す時期を入れた車のボタンで足すと、手放す時期と一緒に動きます"}`,
    actions: [...(empty ? [share] : []), ...out.actions],
  };
}

/** 今の自動車ローン（今返している分。kind car の負債） */
export const carDebts = (h: Household): Debt[] => (h.debts ?? []).filter((d) => d.kind === "car" && d.property === undefined && d.inheritedFrom === undefined);

/** 今返している自動車ローン（住まい・ローンのカードから移した。0069）。返済の欄は、ほかのローンと同じ部品 */
function carLoanSection(wh: WorkingHousehold): SectionDef {
  const debts = carDebts(wh.request.input.household);
  return {
    key: "car/loans",
    title: "今返している自動車ローン",
    ...(debts.length === 0 ? { note: "今の車のローンを返しているときに入れます（これから買う車のローンは、車の「買い方」で入れます）" } : {}),
    level: debts.length === 0 ? "detail" : "simple",
    groups: debts.flatMap((d, i) => carLoanGroups(wh, d, i)),
    actions: [{ key: "car/addCarLoan", label: "＋ 自動車ローン", level: "detail", run: (w) => newCarLoan(w) }],
  };
}

/** 車のパネル: 持っている車を1台ずつ（台数に上限なし）、車のカードの出るお金の行、今返している自動車ローン */
export function carStage(wh: WorkingHousehold): StageDef {
  const list = wh.request.input.household.cars ?? [];
  const move = moveSection(wh, list);
  return {
    id: "car",
    label: "車",
    lead: "車ごとの買い替え・維持費・手放す時期と、車を持たない移動の費用。",
    sections: [
      {
        key: "ev/cars",
        title: "車",
        note: "買い替え（下取り・ローン）と維持費を、車ごとに入れます。2台目からは「＋ もう1台」で足します。基本生活費の「交通」には車の費用を入れないでください（二重になります）",
        level: "simple",
        groups: list.flatMap((c, i) => carGroups(wh, c, i, list)),
        actions:
          list.length === 0
            ? [
                { key: "ev/addCar", label: "＋ 今の車", help: "価格・維持費などは目安の値で入れます（あとで直せます）", level: "simple", run: (w) => addCar(w) },
                { key: "ev/addCarNew", label: "＋ これから買う車", help: "価格・維持費などは目安の値で入れます（あとで直せます）", level: "simple", run: (w) => addCar(w, newId, false) },
              ]
            : [
                { key: "ev/addCar", label: "＋ もう1台（今の車）", help: "価格・維持費などは目安の値で入れます（あとで直せます）", level: "simple", run: (w) => addCar(w) },
                { key: "ev/addCarNew", label: "＋ もう1台（これから買う車）", help: "価格・維持費などは目安の値で入れます（あとで直せます）", level: "simple", run: (w) => addCar(w, newId, false) },
              ],
      },
      ...(move !== null ? [move] : []),
      carLoanSection(wh),
    ],
  };
}
