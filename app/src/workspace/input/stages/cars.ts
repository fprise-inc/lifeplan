// 車のカード（0069）: 車ごとの買い替え（買い方・下取り・ローン）・維持費（入れ方 合計／内訳・名前つきの行）・手放す時期と、
// 車のカードの出るお金の行（車を持たない移動の費用・手放した後の移動の費用・古くなってからの修理費・車の用品）と、今返している自動車ローン。
// エンジンの cars（0008 の追記）をそのまま読み書きする。値の箱を持たない項目なので、空欄を目安で補った値は「推定」の印を
// 画面の側（assumed。0.16 の欄のキーで読み替えられる欄）か物の値の状態の欄（valueStates。新しい欄）に持つ。
// 0101: 車ごとの「買い替え」（買い替え続ける・この1台だけ・○歳まで）、リース・長期レンタル（月額）、手放す月に買わない、
// 次の買い替え・購入の時期は「今から○年後」だけで入れる、手放した後の移動の費用は世帯が最後に手放す車だけ
import { carLeaseIncludes } from "../../../../../engine/src/sdk/cars.ts";
import type { Car, Debt, Household, Member, PeriodicExpense, Timepoint } from "../../../engine/types.ts";
import { addMonths, ageAt, parseYm } from "../../levers.ts";
import { carPurchaseYms } from "../carPurchases.ts";
import { monthIndex } from "../../timepoint.ts";
import { wareki } from "../units.ts";
import type { Address } from "../../store/readings.ts";
import { CAR_ESTIMATE, type Estimate } from "../estimates.ts";
import { byId, field, getPath, plain, resolveTimepoint, setPath, timepointField, timeView, type ActionDef, type FieldDef, type Finder, type GroupDef, type Level, type SectionDef, type StageDef } from "../form.ts";
import { mutate, newId, presetBasis, standardBox, wrapBasis, type WorkingHousehold } from "../household.ts";
import { ADULTS_WHO, GROWTH_KINDS, holderOptions, memberLabel, WORDS } from "../labels.ts";
import { addExpense, moneySections } from "../moneyRows.ts";
import { materializeEvent } from "../namedEvents.ts";
import { manYen } from "../readLines.ts";
import { putRow, rowAt, type StateRow } from "../rows.ts";
import { amountText, oneMinus, rateText } from "../units.ts";
import { carLoanGroups, newCarLoan } from "./housing.ts";
import { fixGrowth } from "./living.ts";
import { onContingencyDetailFields, onContingencyFields } from "./onContingency.ts";
import { GROWTH_RANGE } from "../rateRanges.ts";
import { carLoanRateEstimate } from "../../../../../hearing/src/loanRates.ts";
import { presetNum, presetRate, presetText } from "../../../../../hearing/src/presets.ts";

type Obj = Record<string, unknown>;
const cars = (h: Household) => h.cars;
const inputOf = (req: WorkingHousehold["request"]): Obj => req.input as unknown as Obj;
const addr = (id: string, item: string, at: string[] = []): Address => ({ target: { object: id }, item, at });
const estRow = (basis: string): StateRow => ({ state: "estimated", origin: { kind: "auto" }, estimate: { method: "standard", basis } });
const withAddress = (f: FieldDef, a: Address): FieldDef => ({ ...f, address: () => a });

/** ローンの目安（借入8割・5年。金利は今返している自動車ローンと同じ目安〔マスタデータ master.loanRates〕。目安のボタンの値＝推定） */
// 自動車ローンの目安（presets.ts の借入の割合・返済期間と、マスタデータの自動車ローンの金利。事務所の推定の値があればその値。読むたびに引く）
const loanShare = () => presetRate("preset.car.loan.share");
const loanTerm = () => presetNum("preset.car.loan.termMonths");
const loanBasis = () => ({
  share: presetBasis(presetText("preset.car.loan.share", (v) => `借入 下取りを引いた額の${Math.abs(Number(v) * 10 - Math.round(Number(v) * 10)) < 1e-9 ? `${String(Math.round(Number(v) * 10))}割` : `${String(Math.round(Number(v) * 1000) / 10)}%`}`)),
  rate: presetBasis(wrapBasis(carLoanRateEstimate().basis, (b) => `金利 ${b}`)),
  term: presetBasis(presetText("preset.car.loan.termMonths", (v) => (Number(v) % 12 === 0 ? `${String(Number(v) / 12)}年で返す` : `${String(v)}か月で返す`))),
});
/** 次の買い替え・購入の時期の標準の値（3年後） */
const FIRST_BASIS = "既定の値（3年後。この世帯に合わせて直してください）";

/**
 * 下取り・売却の残価の目安（ひな形。車両の価格に対する割合。3年50%・5年35%・8年15%・10年以上5%、その間はならす）。
 * 原本で確かめた市場の統計ではないので、根拠は「ひな形の目安」と書く
 */
export function residualRate(years: number): number {
  // 割合は presets.ts の目安（事務所の推定の値があればその値）
  const pts: readonly [number, number][] = [
    [3, presetNum("preset.car.residual.year3")],
    [5, presetNum("preset.car.residual.year5")],
    [8, presetNum("preset.car.residual.year8")],
    [10, presetNum("preset.car.residual.year10")],
  ];
  if (years <= 3) return pts[0]?.[1] as number;
  for (let i = 1; i < pts.length; i++) {
    const [y1, r1] = pts[i] as [number, number];
    const [y0, r0] = pts[i - 1] as [number, number];
    if (years <= y1) return r0 + ((r1 - r0) * (years - y0)) / (y1 - y0);
  }
  return pts[3]?.[1] as number;
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

/** 買い替え（0101）。省略は買い替え続ける */
export type ReplaceKind = "repeat" | "none" | "until";
export const replaceKind = (c: Car): ReplaceKind => c.purchase?.replace?.kind ?? "repeat";

/** リース・長期レンタルの車か（買い替えの欄を持たない。0101） */
export const isLeaseCar = (c: Car): boolean => c.purchase === undefined && c.lease !== undefined;

/** リースの月額に含む物（書いていない物は種類の既定。リースでなければ null） */
export const leaseIncludes = (c: Car): ReturnType<typeof carLeaseIncludes> | null => (isLeaseCar(c) && c.lease !== undefined ? carLeaseIncludes(c.lease) : null);

/** リース・長期レンタルの月額の年額（リースでなければ0） */
export const leaseAnnual = (c: Car): number => (isLeaseCar(c) ? (c.lease?.monthly ?? 0) * 12 : 0);

/** 維持費の入れ方: 合計の1欄か、内訳（自動車税・保険・車検・駐車場・燃料・名前つきの行）か。入れ方の無い古い車は入っている物から読む */
export function upkeepMode(c: Car): "total" | "detail" {
  if (c.upkeepMode !== undefined) return c.upkeepMode;
  if (c.upkeep !== undefined) return "total";
  return hasBreakdown(c) ? "detail" : "total";
}

/** 内訳を年額にならした合計（車検は1回の額÷周期。名前つきの行を含む。リースの月額に含む物は数えない） */
export function breakdownAnnual(c: Car): number {
  const inc = leaseIncludes(c);
  const insp = c.inspection === undefined || inc?.inspectionMaintenance === true ? 0 : Math.round(c.inspection.amount / (c.inspection.everyYears ?? 2));
  const tax = inc?.taxAndCompulsory === true ? 0 : (c.tax?.annual ?? 0);
  const insurance = inc?.insurance === true ? 0 : (c.insurance?.annual ?? 0);
  return tax + insurance + insp + (c.parking?.annual ?? 0) + (c.fuel?.annual ?? 0) + (c.upkeepOther ?? []).reduce((s, o) => s + o.annual, 0);
}

/** 計算に入る維持費の年額（入れ方のとおり。入れ方の無い古い車は入っている物を全部。リースの月額は含まない） */
export function upkeepAnnual(c: Car): number {
  if (c.upkeepMode === "total") return c.upkeep?.annual ?? 0;
  if (c.upkeepMode === "detail") return breakdownAnnual(c);
  return (c.upkeep?.annual ?? 0) + breakdownAnnual(c);
}

/**
 * 維持費の合計の目安（買う車は車の目安。リース・長期レンタルは、月額に含む自動車税・車検・保険の目安を引いた額。0101）
 */
export function upkeepEstimate(c: Car): Estimate {
  const inc = leaseIncludes(c);
  if (inc === null) return CAR_ESTIMATE.upkeep;
  let value = CAR_ESTIMATE.upkeep.value;
  const parts: string[] = [];
  if (inc.taxAndCompulsory) {
    value -= CAR_ESTIMATE.tax.value;
    parts.push("自動車税");
  }
  if (inc.inspectionMaintenance) {
    value -= Math.round(CAR_ESTIMATE.inspection.value / 2);
    parts.push("車検");
  }
  if (inc.insurance) {
    value -= CAR_ESTIMATE.insurance.value;
    parts.push("保険");
  }
  return parts.length === 0 ? CAR_ESTIMATE.upkeep : { value, basis: `${CAR_ESTIMATE.upkeep.basis}から、月額に含む${parts.join("・")}の目安を引いた額` };
}

/** 2つの年月の間の月数（b − a） */
function monthsBetween(a: string, b: string): number {
  const x = parseYm(a);
  const y = parseYm(b);
  return (y.y - x.y) * 12 + (y.m - x.m);
}

/**
 * この車の一生の費用（今の値段で）: 計算の最後か手放す月までの、買い替え（下取りを引いた額）・リースの月額と維持費の合計。ローンの利息・物価の伸びは入れない
 * （エンジンの計算とは別の、見出しの目安。購入の月はエンジンと同じ決まり）。買い替えの回数も返す
 */
export function lifetimeCost(h: Household, c: Car, baseMonth: string, endYear: number): { total: number; purchases: number } | null {
  const endYm = `${endYear}-12`;
  const untilYm = c.until == null ? endYm : (resolveTimepoint(h, c.until) ?? endYm);
  const last = untilYm < endYm ? untilYm : endYm;
  let total = 0;
  let purchases = 0;
  let from: string;
  const p = c.purchase;
  if (p !== undefined) {
    const first = resolveTimepoint(h, p.first);
    if (first === null) return null;
    carPurchaseYms(h, c, endYm).forEach((m, k) => {
      if (m < baseMonth) return;
      total += Math.max(0, p.price - (k > 0 || p.owned === true ? (p.tradeIn ?? 0) : 0));
      purchases++;
    });
    from = p.owned === true || first < baseMonth ? baseMonth : first;
  } else if (c.lease !== undefined) {
    const f = c.lease.from === undefined ? baseMonth : (resolveTimepoint(h, c.lease.from) ?? baseMonth);
    from = f < baseMonth ? baseMonth : f;
    total += c.lease.monthly * Math.max(0, monthsBetween(from, last) + 1);
  } else return null;
  const months = Math.max(0, monthsBetween(from, last) + 1);
  total += Math.round((upkeepAnnual(c) * months) / 12);
  return { total, purchases };
}

const ownerOf = (h: Household, c: Car | undefined): Member | undefined => (c === undefined ? undefined : h.members.find((m) => m.id === c.owner));
const isEventForm = (t: Timepoint | null | undefined): boolean => t?.event !== undefined;

/** 車の購入・手放す時期を指す出来事の時点（まだ出来事でなければ出来事にする。書き換える世帯 h の上で）。offsetMonths は足すずらし（月） */
function carEventAt(h: Household, c: Car, kind: "carPurchase" | "carRelease", offsetMonths: number): Timepoint | null {
  const cur = kind === "carPurchase" ? c.purchase?.first : c.until;
  if (cur == null) return null;
  const tp = isEventForm(cur) ? structuredClone(cur) : materializeEvent(h, { event: `new:${kind}:${c.id}` }, newId);
  if (tp === null) return null;
  const months = (tp.offset?.years ?? 0) * 12 + (tp.offset?.months ?? 0) + offsetMonths;
  const { offset: _o, ...rest } = tp;
  void _o;
  const mm = months % 12;
  return months === 0 ? rest : { ...rest, offset: { years: Math.trunc(months / 12), months: mm === 0 ? 0 : mm } };
}

// 次の3つのひな形のボタンは名前だけ（額を出さない）。足した行の額は推定で、根拠はよくある目安（原本で確かめた統計ではない。0044 の追記 2026-10-29）
/** 手放した後の移動の費用（タクシー・バスなど。よくある額の目安 月1万円。始まりは出来事「車を手放す」の翌月） */
export const AFTER_CAR_PRESET = {
  get monthly(): number {
    return presetNum("preset.car.afterMonthly");
  },
  get basis(): string {
    return presetText("preset.car.afterMonthly", (v) => `よくある額の目安（手放した後の移動の費用 月${String(Number(v) / 10000)}万円。この世帯に合わせて直してください）`);
  },
};
/** 古くなってからの修理費（よくある額の目安 年10万円・毎年。始まりは出来事「車の購入」から10年後） */
export const REPAIR_PRESET = {
  get annual(): number {
    return presetNum("preset.car.oldRepair");
  },
  afterYears: 10,
  get basis(): string {
    return presetText("preset.car.oldRepair", (v) => `よくある額の目安（古くなってからの修理費 年${String(Number(v) / 10000)}万円。この世帯に合わせて直してください）`);
  },
  everyYears: "よくある間隔の目安（古くなってからの修理費 毎年。この世帯に合わせて直してください）",
};

/**
 * 車のカードの出るお金の行を足す（種類「車の修理・用品など」・表の行「車の維持費」）。額の印は推定（よくある目安）。毎月でない行（年ごと）は
 * 何年ごと（毎年）も推定（物の値の状態の欄を持たない数なので、仮の印で持つ。年払いのひな形と同じ）
 */
function addCarRow(
  wh: WorkingHousehold,
  o: { label: string; amount: number; monthly: boolean; basis: string; everyBasis?: string; from?: (h: Household) => Timepoint | null; to?: (h: Household) => Timepoint | null },
  id: string = newId(),
): WorkingHousehold {
  const w = addExpense(wh, "car", id);
  const next = mutate(w, (h) => {
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
  return o.monthly || o.everyBasis === undefined ? next : { ...next, assumed: { ...next.assumed, [`ev/${id}/every`]: o.everyBasis } };
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
      everyBasis: REPAIR_PRESET.everyYears,
      from: (h) => {
        const c = (h.cars ?? []).find((x) => x.id === carId);
        if (c === undefined) return null;
        if (c.purchase === undefined) return null;
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

/** この車の続きを足す: 手放す時期の翌月に、同じ名義・同じ欄の車（これから買う車。リースは同じ月額のリース）を足す。手放す時期が動けば次の車の購入も動く */
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
    const body: Car = { ...copy, id, until: null, ...(others !== undefined ? { upkeepOther: others } : {}) };
    if (copy.purchase !== undefined) body.purchase = { ...copy.purchase, first, owned: false };
    else if (copy.lease !== undefined) body.lease = { ...copy.lease, from: first };
    (h.cars ??= []).push(body);
    ok = true;
  });
  if (!ok) return wh;
  // 推定の印は元の車の印を写す（同じ値なので）
  const src = `ev/car/${carId}/`;
  const assumed = { ...next.assumed };
  for (const [key, v] of Object.entries(wh.assumed)) if (key.startsWith(src)) assumed[`${k}/${key.slice(src.length)}`] = v;
  // 買い替えない車の続きは、手放す時期を目安で入れる（この1台だけの車と同じ）
  return withOneTimeUntil({ ...next, assumed }, id);
}

/** 買い替えない車の手放す時期の目安（0101）: これから買う車は買ってから13年（出来事「車の購入」から。購入が動けば一緒に動く）、今の車は今から5年 */
export const KEEP_ESTIMATE = { future: CAR_ESTIMATE.keepYears, owned: CAR_ESTIMATE.keepYearsOwned };
const KEEP_BASES: readonly string[] = [KEEP_ESTIMATE.future.basis, KEEP_ESTIMATE.owned.basis];

/** 手放す時期が、買い替えない車の目安（推定）のままか */
function untilIsKeepEstimate(wh: WorkingHousehold, carId: string): boolean {
  const row = rowAt(inputOf(wh.request), addr(carId, "car.until"));
  return row?.state === "estimated" && KEEP_BASES.includes(row.estimate?.basis ?? "");
}

/**
 * 買い替えない車（この1台だけ）で手放す時期が空なら、目安を推定で入れる（0101）。これから買う車は出来事「車の購入」から13年後、今の車は今から5年後。
 * ほかの車・手放す時期が入っている車はそのまま
 */
export function withOneTimeUntil(wh: WorkingHousehold, carId: string): WorkingHousehold {
  const c = (wh.request.input.household.cars ?? []).find((x) => x.id === carId);
  if (c?.purchase === undefined || replaceKind(c) !== "none" || c.until != null) return wh;
  return mutate(wh, (h, req) => {
    const x = (h.cars ?? []).find((y) => y.id === carId);
    if (x?.purchase === undefined) return;
    if (x.purchase.owned === true) {
      x.until = { at: addMonths(req.input.baseMonth, 12 * KEEP_ESTIMATE.owned.value) };
      putRow(inputOf(req), addr(carId, "car.until"), estRow(KEEP_ESTIMATE.owned.basis));
      return;
    }
    const tp = carEventAt(h, x, "carPurchase", 12 * KEEP_ESTIMATE.future.value);
    if (tp === null) return;
    x.until = tp;
    putRow(inputOf(req), addr(carId, "car.until"), estRow(KEEP_ESTIMATE.future.basis));
  });
}

/** 「○歳まで買い替える」を選んだときの標準（70歳まで。その年齢になる前の月まで買い替える） */
const REPLACE_UNTIL_AGE = 70;
const REPLACE_UNTIL_BASIS = `既定の値（${REPLACE_UNTIL_AGE}歳まで買い替え、その後は手放すまで乗る。この世帯に合わせて直してください）`;

/**
 * 買い替えを変える（0101）。買い替え続けるは省略（replace を消す）。この1台だけは、手放す時期が空なら目安を推定で入れる。
 * ○歳までは70歳まで（推定）。買い替える形に戻したとき、推定のままの手放す時期（この1台だけの目安）は、買い替える車の既定（名義の人の75歳。推定）に戻す。
 * 既定（75歳）のままの車をこの1台だけにしたら、この1台だけの目安に入れ替える。周期・下取りなどの値は残す
 */
export function setReplace(wh: WorkingHousehold, carId: string, kind: ReplaceKind): WorkingHousehold {
  const cur = (wh.request.input.household.cars ?? []).find((x) => x.id === carId);
  if (cur?.purchase === undefined || replaceKind(cur) === kind) return wh;
  const dropUntil = kind !== "none" && untilIsKeepEstimate(wh, carId);
  // 足したときの既定（名義の人の75歳）のままの車を「この1台だけ」にしたら、この1台だけの目安（推定）に入れ替える
  const dropRelease = kind === "none" && untilIsReleaseEstimate(wh, carId);
  const next = mutate(wh, (h, req) => {
    const x = (h.cars ?? []).find((y) => y.id === carId);
    if (x?.purchase === undefined) return;
    const input = inputOf(req);
    if (kind === "repeat") delete x.purchase.replace;
    else if (kind === "none") x.purchase.replace = { kind: "none" };
    else {
      x.purchase.replace = { kind: "until", until: { memberAge: { member: x.owner, years: REPLACE_UNTIL_AGE - 1, months: 11 } } };
      putRow(input, addr(carId, "car.replace", ["until"]), estRow(REPLACE_UNTIL_BASIS));
    }
    if (kind !== "until") putRow(input, addr(carId, "car.replace", ["until"]), undefined);
    if (dropUntil) {
      // 買い替える形に戻したら、推定のままの手放す時期は、買い替える車の既定（名義の人の75歳。推定）に戻す
      x.until = releaseAt(h, x.owner, req.input.baseMonth);
      putRow(input, addr(carId, "car.until"), estRow(RELEASE_BASIS));
    }
    if (dropRelease) {
      x.until = null;
      putRow(input, addr(carId, "car.until"), undefined);
    }
  });
  return kind === "none" ? withOneTimeUntil(next, carId) : next;
}

/** その車を手放す出来事を、手放した後の移動の費用の行がもう指しているか（手放す時期の翌月から始まる車の行） */
function afterCarAdded(h: Household, carId: string): boolean {
  const u = (h.cars ?? []).find((x) => x.id === carId)?.until;
  const ev = u?.event;
  if (ev === undefined || u == null) return false;
  const off = (t: Timepoint) => (t.offset?.years ?? 0) * 12 + (t.offset?.months ?? 0);
  return (h.periodicExpenses ?? []).some((p) => p.kind === "car" && p.from.event === ev && off(p.from) === off(u) + 1);
}

/**
 * 世帯が最後に手放す車か（0101）: どの車も手放す時期が入っていて、この車の手放す月がいちばん後（同じ月なら並びの後の車）。
 * 「手放した後の移動の費用」はこの車にだけ出す（ほかの車がまだあるうちは移動の費用はかからない）
 */
export function lastCarOfHousehold(h: Household, carId: string): boolean {
  const list = h.cars ?? [];
  if (list.length === 0 || list.some((x) => x.until == null)) return false;
  let best: { id: string; ym: string } | null = null;
  for (const x of list) {
    const ym = resolveTimepoint(h, x.until);
    if (ym === null) return false;
    if (best === null || ym >= best.ym) best = { id: x.id, ym };
  }
  return best?.id === carId;
}

/** 続きの車（購入の時期が、ほかの車を手放す出来事から決まる車）の、元の車（無ければ null） */
function predecessorOf(h: Household, c: Car): { car: Car; index: number; offset: number } | null {
  const ev = c.purchase?.first.event;
  if (ev === undefined) return null;
  const e = (h.events ?? []).find((x) => x.id === ev);
  if (e === undefined || e.kind !== "carRelease") return null;
  const list = h.cars ?? [];
  const index = list.findIndex((x) => x.id !== c.id && x.until?.event === ev && x.until.offset === undefined);
  if (index < 0) return null;
  const f = c.purchase?.first;
  return { car: list[index] as Car, index, offset: (f?.offset?.years ?? 0) * 12 + (f?.offset?.months ?? 0) };
}

/** 年数の文（「12年後」「3年6か月後」） */
const laterText = (months: number): string => {
  const y = Math.floor(Math.abs(months) / 12);
  const m = Math.abs(months) % 12;
  const t = y > 0 && m > 0 ? `${y}年${m}か月` : y > 0 ? `${y}年` : `${m}か月`;
  return months === 0 ? "今月" : months > 0 ? `${t}後` : `${t}前`;
};

export function carGroups(wh: WorkingHousehold, c: Car, i: number, all: readonly Car[]): GroupDef[] {
  const find = byId(cars, c.id);
  const k = `ev/car/${c.id}`;
  const car = (h: Household, w: WorkingHousehold) => find(h, w) as Car | undefined;
  const owner = (h: Household) => ownerOf(h, (h.cars ?? []).find((x) => x.id === c.id));
  const mode = upkeepMode(c);
  const h0 = wh.request.input.household;
  const base = wh.request.input.baseMonth;
  const lease = isLeaseCar(c);
  const kind = replaceKind(c);
  const owned = c.purchase?.owned === true;
  // 今の車に乗り続ける（買い替えない）: 次の買い替えの時期・価格・買い方・周期・下取りを出さない（値は残す）。手放す時期を買い替えのすぐ下に
  const keepCurrent = !lease && owned && kind === "none";
  const inc = leaseIncludes(c);
  // 推定のままの下取りは、価格・周期を直したら目安を入れ直す
  const refreshTradeIn = (w: WorkingHousehold): WorkingHousehold => {
    const key = `${k}/tradeIn`;
    if (w.assumed[key] === undefined) return w;
    const x = car(w.request.input.household, w);
    if (x?.purchase === undefined) return w;
    const e = tradeInEstimate(x.purchase.price, x.purchase.everyYears);
    const moved = mutate(w, (h, req) => {
      const t = car(h, { ...w, request: req });
      if (t?.purchase !== undefined) t.purchase.tradeIn = e.value;
    });
    return { ...moved, assumed: { ...moved.assumed, [key]: e.basis } };
  };
  // 推定のままの維持費の合計は、リースの種類・月額に含む物を直したら目安を入れ直す
  const refreshUpkeep = (w: WorkingHousehold): WorkingHousehold => {
    const key = `${k}/upkeep`;
    if (w.assumed[key] === undefined) return w;
    const x = car(w.request.input.household, w);
    if (x === undefined || x.upkeep === undefined) return w;
    const e = upkeepEstimate(x);
    const moved = mutate(w, (h, req) => {
      const t = car(h, { ...w, request: req });
      if (t?.upkeep !== undefined) t.upkeep.annual = e.value;
    });
    return { ...moved, assumed: { ...moved.assumed, [key]: e.basis } };
  };
  // 名義の候補は持てる人だけ（今の車・リースは今18歳以上、これから買う車は買う月に18歳以上）。名義を変えたら、推定のままの手放す時期（名義の人の年齢）も新しい名義の人に
  const holderAt = !lease && !owned && c.purchase !== undefined ? (resolveTimepoint(h0, c.purchase.first) ?? undefined) : undefined;
  const fields: FieldDef[] = [
    plain({
      key: `${k}/owner`,
      item: "car.owner",
      label: WORDS.holder,
      level: "simple",
      kind: "select",
      options: holderOptions(wh, "age18", c.owner, holderAt),
      find,
      path: ["owner"],
      help: "使う人で選びます（手放す時期・買い替える年齢は、この人の年齢で数えます）",
      after: (hh, t, _v, w) => {
        if (untilIsReleaseEstimate(w, c.id)) (t as unknown as Car).until = releaseAt(hh, String(t.owner), w.request.input.baseMonth);
      },
    }),
  ];
  if (lease) fields.push(...leaseFields(c, k, find, refreshUpkeep));
  else {
    fields.push(...replaceFields(c, i, k));
    if (kind === "until") fields.push(replaceUntilField(c, k, find, owner));
    if (keepCurrent) fields.push(untilField(c, k, car, owner, true));
    else fields.push(firstField(wh, c, k, find, owner));
    if (kind !== "none")
      fields.push(
        field({
          key: `${k}/every`,
          item: "car.purchase",
          label: "買い替えの周期",
          level: "simple",
          kind: "int",
          suffix: "年ごと",
          min: 1,
          max: 30,
          get: (w) => ({ value: car(w.request.input.household, w)?.purchase?.everyYears ?? null, assumed: w.assumed[`${k}/every`] ?? null }),
          set: (w, v) => {
            if (v === null) return w;
            const next = mutate(w, (h, req) => {
              const t = car(h, { ...w, request: req });
              if (t?.purchase !== undefined) t.purchase.everyYears = Number(v);
            });
            const rest = Object.fromEntries(Object.entries(next.assumed).filter(([key]) => key !== `${k}/every`));
            return refreshTradeIn({ ...next, assumed: rest });
          },
        }),
      );
    if (!keepCurrent)
      fields.push(carYen({ key: `${k}/price`, item: "car.purchase", label: "車両の価格", level: "simple", basis: "once", find, path: ["purchase", "price"], estimate: CAR_ESTIMATE.price, help: "今の価格で入れます（物価上昇率で伸ばします）", after: refreshTradeIn }));
    if (kind !== "none")
      fields.push(
        carYen({
          key: `${k}/tradeIn`,
          item: "car.purchase",
          label: "下取り",
          level: "detail",
          basis: "once",
          find,
          path: ["purchase", "tradeIn"],
          estimate: (w) => {
            const x = car(w.request.input.household, w)?.purchase;
            return tradeInEstimate(x?.price ?? CAR_ESTIMATE.price.value, x?.everyYears ?? CAR_ESTIMATE.everyYears.value);
          },
          help: "次の買い替えで車両の価格から引く額です。推定は、車両の価格と周期からの残価です。下取りを引いた額を車両の価格に入れたときは0円に",
        }),
      );
    fields.push(
      plain({
        key: `${k}/owned`,
        item: "car.purchase",
        label: "今の車（外すと「これから買う車」）",
        level: "detail",
        kind: "bool",
        find,
        path: ["purchase", "owned"],
        optional: true,
        fallback: false,
        help: "持っているときは、上の時期から買い替えます（その前の車検も数え、1回目から下取りを引きます）",
      }),
    );
    if (!keepCurrent) fields.push(...payFields(c, k, car));
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
  const leaseUpkeepHelp = "月額に含まれない分（駐車場・燃料など）を入れます。入れなければ、車の目安から月額に含む分を引いた額で計算します";
  const detailGroups: GroupDef[] = [];
  if (mode === "total")
    fields.push(
      carYen({
        key: `${k}/upkeep`,
        item: "car.upkeep",
        label: "維持費（年額の合計）",
        level: "simple",
        basis: "annual",
        find,
        path: ["upkeep", "annual"],
        estimate: (w) => {
          const x = car(w.request.input.household, w);
          return x === undefined ? CAR_ESTIMATE.upkeep : upkeepEstimate(x);
        },
        help: lease ? leaseUpkeepHelp : "自動車税・保険・車検・駐車場・燃料などの合計。車の修理・用品などは、下の出るお金の行でも足せます",
      }),
    );
  else {
    fields.push(
      field({
        key: `${k}/upkeepSum`,
        item: "car.upkeep",
        label: "維持費（年額の合計）",
        level: "simple",
        // 読むだけの合計は、欄の外の額の書き方（万円で小数1桁まで）で見せる
        kind: "text",
        readOnly: `内訳で入れています（「詳細」で直せます）。車検は1回の額を周期でならしています${lease ? "。リース・長期レンタルの月額に含む分は数えません" : ""}`,
        get: (w) => {
          const x = car(w.request.input.household, w);
          return { value: x === undefined ? null : amountText(breakdownAnnual(x), "year") };
        },
        set: (w) => w,
      }),
    );
    // リースの月額に含む物は、内訳の欄を出さない（値は残す。0101）
    if (inc?.taxAndCompulsory !== true) fields.push(carYen({ key: `${k}/tax`, item: "car.tax", label: "自動車税（年額）", level: "detail", basis: "annual", find, path: ["tax", "annual"], estimate: CAR_ESTIMATE.tax }));
    if (inc?.insurance !== true) fields.push(carYen({ key: `${k}/insurance`, item: "car.insurance", label: "自動車保険（年額）", level: "detail", basis: "annual", find, path: ["insurance", "annual"], estimate: CAR_ESTIMATE.insurance }));
    if (inc?.inspectionMaintenance !== true)
      fields.push(
        carYen({ key: `${k}/inspection`, item: "car.inspection", label: "車検（1回の額）", level: "detail", basis: "once", find, path: ["inspection", "amount"], estimate: CAR_ESTIMATE.inspection }),
        plain({ key: `${k}/inspFirst`, item: "car.inspection", label: lease ? "最初の車検（借り始めから）" : "最初の車検（購入から）", level: "detail", kind: "int", suffix: "年後", min: 1, max: 10, find, path: ["inspection", "firstAfterYears"], optional: true, fallback: 3 }),
        plain({ key: `${k}/inspEvery`, item: "car.inspection", label: "その後の車検の周期", level: "detail", kind: "int", suffix: "年ごと", min: 1, max: 10, find, path: ["inspection", "everyYears"], optional: true, fallback: 2 }),
      );
    fields.push(
      carYen({ key: `${k}/parking`, item: "car.parking", label: "駐車場（年額）", level: "detail", basis: "annual", find, path: ["parking", "annual"], optional: true }),
      carYen({ key: `${k}/fuel`, item: "car.fuel", label: "ガソリン・電気代（年額）", level: "detail", basis: "annual", find, path: ["fuel", "annual"], optional: true }),
    );
    detailGroups.push(...upkeepOtherGroups(c, k, car));
  }
  // いつまで乗るか（名義の人の年齢で）。今の車に乗り続けるときは、買い替えのすぐ下に出している
  if (!keepCurrent) fields.push(untilField(c, k, car, owner, false));
  fields.push(plain({ key: `${k}/growth`, item: "car.growth", label: lease ? "維持費の伸び方" : "価格・維持費の伸び方", level: "detail", kind: "select", options: GROWTH_KINDS, find, path: ["growth", "kind"], fallback: "inflation", optional: true, after: (_h, t, v) => fixGrowth(t, v), ...(lease ? { help: "リース・長期レンタルの月額は伸ばしません（契約の額のまま）" } : {}) }));
  if (c.growth?.kind === "rate") fields.push(plain({ key: `${k}/growthRate`, item: "car.growth", label: WORDS.growthRate, level: "detail", kind: "pct", ...GROWTH_RANGE, find, path: ["growth", "rate"] }));
  fields.push(...onContingencyFields({ key: `${k}/on`, item: "car.onContingency", find, path: ["onContingency"], level: "detail", help: lease ? "名義の人などの万一の月の翌月から、リースの月額と維持費をこの扱いにします" : "名義の人などの万一の月の翌月から、買い替えと維持費をこの扱いにします。組んだローンの返済は続きます" }));
  fields.push(...onContingencyDetailFields({ key: `${k}/on`, item: "car.onContingency", find, path: ["onContingency"], on: c.onContingency, level: "detail" }));
  // 見出しの一生の費用（今の値段で）
  const life = lifetimeCost(h0, c, base, wh.request.input.endYear);
  const lifeNote =
    life === null
      ? null
      : `この車の一生の費用（今の値段で・${c.until == null ? "最後まで" : "手放すまで"}）約${manYen(Math.round(life.total / 10000) * 10000)}（${lease ? `月額 ${(c.lease?.monthly ?? 0) > 0 ? manYen(c.lease?.monthly ?? 0) : "未入力"}` : `買い替え${life.purchases}回`}・維持費 年${manYen(upkeepAnnual(c))}。${lease ? "" : "ローンの利息・"}物価の伸びは含みません）`;
  // 車のメニュー（続きの車・手放した後の移動の費用・古くなってからの修理費）
  const actions: ActionDef[] = [];
  const firstYm = c.purchase === undefined ? null : resolveTimepoint(h0, c.purchase.first);
  const untilYm = c.until == null ? null : resolveTimepoint(h0, c.until);
  const lastCar = all.filter((x) => x.owner === c.owner).at(-1)?.id === c.id;
  if (c.until != null && lastCar) actions.push({ key: `${k}/next`, label: "＋ この車の続きを足す", help: "手放した翌月から次の車を持つ形で足します", level: "detail", run: (w) => addNextCar(w, c.id) });
  if (c.purchase !== undefined) {
    const neverReplaced = kind === "none" || (untilYm !== null && firstYm !== null && (owned ? untilYm < firstYm : untilYm < addMonths(firstYm, 12 * c.purchase.everyYears)));
    if (c.purchase.everyYears >= 10 || neverReplaced) actions.push({ key: `${k}/repair`, label: "＋ 古くなってからの修理費を足す", help: "買ってから10年たった頃からの修理費を、よくある額の目安で毎年足します（足した後に直せます）", level: "detail", run: (w) => addRepair(w, c.id) });
  }
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
  const head: GroupDef = { key: k, title: `車 ${i + 1}（${memberLabel(wh, c.owner)}・${lease ? (c.lease?.type === "longRental" ? "長期レンタル" : "カーリース") : owned ? "今の車" : "これから買う車"}）`, ...(lifeNote !== null ? { note: lifeNote } : {}), level: "simple", moreLabel: lease ? "契約の年数・月額の中身を入れる" : "維持費の内訳・ローンを入れる", fields, actions };
  // 世帯が最後に手放す車にだけ、手放した後の移動の費用（0101。各名義の最後の車ではない）
  const after: GroupDef[] =
    lastCarOfHousehold(h0, c.id) && !afterCarAdded(h0, c.id)
      ? [
          {
            key: `${k}/afterCar`,
            title: "この後、世帯に車がありません",
            level: "simple",
            fields: [],
            actions: [{ key: `${k}/afterCar`, label: "＋ 手放した後の移動の費用を足す", help: "タクシー・バスなど、世帯の最後の車を手放した翌月からの移動の費用を、よくある額の目安で足します（足した後に直せます）", level: "simple", run: (w) => addAfterCar(w, c.id) }],
          },
        ]
      : [];
  return [head, ...detailGroups, ...after];
}

/** 買い替えの選び方（0101）。標準は「買い替え続ける」「この1台だけ」（「○歳まで」はこの車がその形のときだけ）、詳細は3つとも */
function replaceFields(c: Car, i: number, k: string): FieldDef[] {
  const every = c.purchase?.everyYears ?? CAR_ESTIMATE.everyYears.value;
  const owned = c.purchase?.owned === true;
  const opts = {
    repeat: { value: "repeat", label: `買い替え続ける（${every}年ごと）` },
    none: { value: "none", label: owned ? "今の車に乗り続ける（買い替えない）" : "この1台だけ（買い替えない）" },
    until: { value: "until", label: "○歳まで買い替える" },
  };
  const help = [
    owned ? "今の車に乗り続けるときは、手放す時期まで買い替えずに乗ります" : "この1台だけのときは、買った後は手放す時期まで乗ります",
    "「○歳まで買い替える」は「詳細」で選べます（最後の買い替えの後は、手放す時期まで乗ります）",
    ...(i > 0 ? ["2台目は、買い替えずにこの1台だけのことも多いです"] : []),
  ].join("。");
  const kind = replaceKind(c);
  // 標準の「買い替え」を「▸ 続きを見る」で詳細の欄に入れ替えたときの知らせ（選べる物が増えるときだけ。「○歳まで」を選んでいる車は、標準でも3つとも出す）
  const swapNote = kind === "until" ? undefined : "買い替えに、「○歳まで買い替える」を足して出しています";
  const def = (key: string, level: Level, options: { value: string; label: string }[], simpleOnly: boolean): FieldDef =>
    withAddress(
      {
        ...field({
          key,
          item: "car.replace",
          label: "買い替え",
          level,
          kind: "select",
          structural: true,
          options,
          help,
          get: (w) => {
            const x = (w.request.input.household.cars ?? []).find((y) => y.id === c.id);
            return { value: x === undefined ? null : replaceKind(x) };
          },
          set: (w, v) => setReplace(w, c.id, v === "none" ? "none" : v === "until" ? "until" : "repeat"),
        }),
        ...(simpleOnly ? { simpleOnly: true, ...(swapNote !== undefined ? { swapNote } : {}) } : {}),
      },
      addr(c.id, "car.replace"),
    );
  return [def(`${k}/replace`, "simple", kind === "until" ? [opts.repeat, opts.none, opts.until] : [opts.repeat, opts.none], true), def(`${k}/replaceAll`, "detail", [opts.repeat, opts.none, opts.until], false)];
}

/** 「○歳まで買い替える」の年齢（その年齢になる前の月まで買い替える。働く最後の「○歳まで」と同じ読み方。0101） */
function replaceUntilField(c: Car, k: string, find: Finder, owner: (h: Household) => Member | undefined): FieldDef {
  return withAddress(
    timepointField({
      key: `${k}/replaceUntil`,
      item: "car.replace",
      label: "買い替える年齢（○歳まで）",
      // この形を選んでいる車は、標準でも出す（選んでいない車には出さない）
      level: "simple",
      find,
      path: ["purchase", "replace", "until"],
      ageOf: owner,
      who: ADULTS_WHO,
      mode: "age",
      modes: ["age", "ym"],
      ageMeans: "before",
      help: "名義の人がこの年齢になる前の月までに来る買い替えまで数えます。その後は手放す時期まで、最後に買った車に乗ります",
      warn: (w) => {
        const h = w.request.input.household;
        const x = (h.cars ?? []).find((y) => y.id === c.id);
        const r = x?.purchase?.replace;
        if (x === undefined || r?.kind !== "until" || x.until == null) return null;
        const lastAt = resolveTimepoint(h, r.until);
        const release = resolveTimepoint(h, x.until);
        return lastAt !== null && release !== null && lastAt >= release ? "手放す時期より後の年齢なので、「買い替え続ける」と同じです" : null;
      },
    }),
    addr(c.id, "car.replace", ["until"]),
  );
}

/**
 * 次の買い替えの時期／購入の時期（0101）。「今から○年後」だけで入れる（年齢・出来事から決めた前の値は、同じ月の「今から」で見せ、直すと「今から」の形にする）。
 * 出来事「この車の購入」を指しているときは出来事を動かす。続きの車（ほかの車を手放した翌月）は読むだけ（元の車の手放す時期で直す）
 */
function firstField(wh: WorkingHousehold, c: Car, k: string, find: Finder, owner: (h: Household) => Member | undefined): FieldDef {
  const h0 = wh.request.input.household;
  const owned = c.purchase?.owned === true;
  const label = owned ? "次の買い替えの時期" : "購入の時期";
  const pre = predecessorOf(h0, c);
  if (pre !== null) {
    const name = `車${pre.index + 1}`;
    const ym = resolveTimepoint(h0, c.purchase?.first);
    const when = ym === null ? "" : `（今から${laterText(monthIndex(ym) - monthIndex(wh.request.input.baseMonth))}）`;
    const rel = pre.offset === 1 ? "手放した翌月" : pre.offset === 0 ? "手放した月" : `手放してから${laterText(pre.offset)}`;
    return withAddress(field({ key: `${k}/first`, item: "car.purchase", label, level: "simple", kind: "text", readOnly: `${name}の手放す時期で直します`, get: () => ({ value: `${name}を${rel}${when}` }), set: (w) => w }), addr(c.id, "car.purchase", ["first"]));
  }
  return withAddress(
    timepointField({
      key: `${k}/first`,
      item: "car.purchase",
      label,
      level: "simple",
      find,
      path: ["purchase", "first"],
      ageOf: owner,
      mode: "now",
      modes: ["now"],
      strictModes: true,
      anchor: "carPurchase",
      help: "「今から○年後」で入れます",
      warn: (w) => {
        const h = w.request.input.household;
        const ym = resolveTimepoint(h, (h.cars ?? []).find((x) => x.id === c.id)?.purchase?.first);
        return ym !== null && ym < w.request.input.baseMonth ? `過ぎた時点（${wareki(ym)}）が入っています。「今から○年後」で入れ直してください` : null;
      },
    }),
    addr(c.id, "car.purchase", ["first"]),
  );
}

/** ローンで買うときの借り方の1行（標準の買い方の欄の下。条件は「▸」の中で直す） */
export function loanLine(l: NonNullable<Car["loan"]>): string {
  const n = l.share === undefined ? 1 : Number(l.share);
  const share = n >= 1 ? "全額" : Math.abs(n * 10 - Math.round(n * 10)) < 1e-9 ? `${String(Math.round(n * 10))}割` : rateText(l.share as string);
  const term = l.termMonths % 12 === 0 ? `${l.termMonths / 12}年` : `${l.termMonths}か月`;
  return `借入: 下取りを引いた額の${share}・${term}・年${rateText(l.rate)}（▸ で変えられます）`;
}

/** 買い方（現金／ローン）とローンの条件 */
function payFields(c: Car, k: string, car: (h: Household, w: WorkingHousehold) => Car | undefined): FieldDef[] {
  const fields: FieldDef[] = [
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
      help: "残価設定ローンは、まだ計算に入っていません。リース・長期レンタルは「＋ リース・長期レンタル（月額）」で足します",
      get: (w) => {
        const x = car(w.request.input.household, w);
        return { value: x?.loan === undefined ? "cash" : "loan", hint: x?.loan === undefined ? null : loanLine(x.loan) };
      },
      set: (w, v) => {
        const loan = v === "loan";
        const next = mutate(w, (h, req) => {
          const x = car(h, { ...w, request: req });
          if (x === undefined) return;
          if (!loan) delete x.loan;
          else x.loan ??= { share: loanShare(), rate: carLoanRateEstimate().rate, termMonths: loanTerm() };
        });
        // ローンの目安（借入8割・5年・金利は自動車ローンの目安）は推定の印。現金に戻したら印も外す
        const lb = loanBasis();
        const keys = { [`${k}/down`]: lb.share, [`${k}/term`]: lb.term, [`${k}/rate`]: lb.rate };
        const assumed = Object.fromEntries(Object.entries(next.assumed).filter(([key]) => !(key in keys)));
        return { ...next, assumed: loan && c.loan === undefined ? { ...assumed, ...keys } : loan ? next.assumed : assumed };
      },
    }),
  ];
  if (c.loan === undefined) return fields;
  const find: Finder = (h, w) => car(h, w) as Obj | undefined;
  // これから買う車のローンの条件には「書類で確かめる」を出さない（まだ返済予定表が無い。目安のままにすればよい）。返済予定表で確かめるのは
  // 今返している自動車ローン（carLoanSection。0041 の追記 2026-11-01）
  fields.push(
    withAddress(
      {
        ...field({
          key: `${k}/down`,
          item: "car.loan",
          label: "頭金（下取りを引いた額に対する割合）",
          // ローンの条件（頭金・年数・金利）は目安で十分なので詳細。標準はローンかどうかの選び方だけ（0078）
          level: "detail",
          kind: "pct",
          // 0〜100%（0175。ほかの割合の欄と同じく、範囲の外は打った時点で止める）
          min: 0,
          max: 100,
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
      },
      addr(c.id, "car.loan", ["share"]),
    ),
    withAddress(
      {
        ...field({
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
      },
      addr(c.id, "car.loan", ["termMonths"]),
    ),
    withAddress(plain({ key: `${k}/rate`, item: "car.loan", label: "ローンの金利（年・固定）", level: "detail", kind: "pct", find, path: ["loan", "rate"] }), addr(c.id, "car.loan", ["rate"])),
  );
  return fields;
}

/** リースの月額が空（未入力）の印 */
export const LEASE_UNENTERED = "未入力（リース・長期レンタルの月額を入れてください。0円で計算中）";

/** リース・長期レンタルの欄（種類・月額・始まり・契約の年数・月額に含む物。0101）。キーは ev/car/<ID>/lease/… */
function leaseFields(c: Car, k: string, find: Finder, refreshUpkeep: (w: WorkingHousehold) => WorkingHousehold): FieldDef[] {
  const lk = `${k}/lease`;
  const leaseOf = (w: WorkingHousehold) => (w.request.input.household.cars ?? []).find((x) => x.id === c.id)?.lease;
  const monthlyAddr = addr(c.id, "car.lease", ["monthly"]);
  const incField = (key: "taxAndCompulsory" | "inspectionMaintenance" | "insurance", label: string, help: string): FieldDef =>
    withAddress(
      field({
        key: `${lk}/inc/${key}`,
        item: "car.lease",
        label,
        level: "detail",
        kind: "bool",
        optional: true,
        help,
        get: (w) => {
          const l = leaseOf(w);
          if (l === undefined) return { value: null };
          const v = l.includes?.[key];
          return v === undefined ? { value: carLeaseIncludes(l)[key], implicit: true } : { value: v };
        },
        set: (w, v) =>
          refreshUpkeep(
            mutate(w, (h) => {
              const l = (h.cars ?? []).find((x) => x.id === c.id)?.lease;
              if (l === undefined) return;
              const inc = { ...(l.includes ?? {}) };
              // 種類の既定と同じなら書かない（種類を変えたときに既定に従う）
              const d = carLeaseIncludes({ type: l.type })[key];
              if (v === null || v === d) delete inc[key];
              else inc[key] = v === true;
              if (Object.keys(inc).length === 0) delete l.includes;
              else l.includes = inc;
            }),
          ),
      }),
      addr(c.id, "car.lease", ["includes", key]),
    );
  return [
    withAddress(
      field({
        key: `${lk}/type`,
        item: "car.lease",
        label: "種類",
        level: "simple",
        kind: "select",
        structural: true,
        options: [
          { value: "carLease", label: "カーリース" },
          { value: "longRental", label: "長期レンタル" },
        ],
        help: "月額に含む物の既定が変わります（カーリース: 自動車税・自賠責と車検・メンテ、長期レンタル: それに保険も）。「詳細」で直せます",
        get: (w) => ({ value: leaseOf(w)?.type ?? null }),
        set: (w, v) =>
          refreshUpkeep(
            mutate(w, (h) => {
              const l = (h.cars ?? []).find((x) => x.id === c.id)?.lease;
              if (l !== undefined && (v === "carLease" || v === "longRental")) l.type = v;
            }),
          ),
      }),
      addr(c.id, "car.lease", ["type"]),
    ),
    withAddress(
      field({
        key: `${lk}/monthly`,
        item: "car.lease",
        label: "月額",
        level: "simple",
        kind: "yen",
        basis: "monthly",
        help: "契約の月額です（物価では伸ばしません）。契約の年数が終わっても、手放す時期まで同じ月額で続けます",
        get: (w) => ({ value: leaseOf(w)?.monthly ?? null }),
        set: (w, v) =>
          mutate(w, (h, req) => {
            const l = (h.cars ?? []).find((x) => x.id === c.id)?.lease;
            if (l === undefined) return;
            l.monthly = v === null ? 0 : Number(v);
            putRow(inputOf(req), monthlyAddr, v === null ? estRow(LEASE_UNENTERED) : undefined);
          }),
      }),
      monthlyAddr,
    ),
    withAddress(
      timepointField({
        key: `${lk}/from`,
        item: "car.lease",
        label: "借り始め",
        level: "simple",
        find,
        path: ["lease", "from"],
        optional: true,
        absentWhenEmpty: true,
        nullText: "もう借りている",
        mode: "now",
        modes: ["now", "ym"],
        help: "これから借りるときに入れます（入れなければ、もう借りているとみなします）",
      }),
      addr(c.id, "car.lease", ["from"]),
    ),
    withAddress(
      plain({ key: `${lk}/term`, item: "car.lease", label: "契約の年数", level: "detail", kind: "int", suffix: "年", min: 1, max: 30, find, path: ["lease", "termYears"], optional: true, help: "表示だけです（計算には使いません。終わった後も同じ月額で続け、精算はしません）" }),
      addr(c.id, "car.lease", ["termYears"]),
    ),
    incField("taxAndCompulsory", "月額に含む: 自動車税・自賠責", "含むときは自動車税を数えません。この入力項目では、自賠責保険は車検（1回の額）の中に入れています（自賠責は車検・メンテのほうで数えます）"),
    incField("inspectionMaintenance", "月額に含む: 車検・メンテ", "含むときは車検（自賠責を含む）を数えません"),
    incField("insurance", "月額に含む: 自動車保険", "含むときは自動車保険を数えません"),
  ];
}

/** 内訳の名前つきの行（タイヤ・防錆など）と、行を足すボタン */
function upkeepOtherGroups(c: Car, k: string, car: (h: Household, w: WorkingHousehold) => Car | undefined): GroupDef[] {
  const groups: GroupDef[] = [];
  for (const o of c.upkeepOther ?? []) {
    const ok = `${k}/other/${o.id}`;
    const ofind: Finder = (h, w) => ((car(h, w)?.upkeepOther ?? []).find((x) => x.id === o.id) as Obj | undefined) ?? undefined;
    groups.push({
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
  groups.push({
    key: `${k}/other/add`,
    level: "detail",
    fields: [],
    actions: [
      {
        key: `${k}/other/add`,
        label: "＋ 内訳の行",
        help: "タイヤ・防錆など、名前をつけて足す維持費の行です",
        level: "detail",
        run: (w) =>
          mutate(w, (h, req) => {
            const x = car(h, { ...w, request: req });
            if (x !== undefined) (x.upkeepOther ??= []).push({ id: newId(), label: "", annual: 0 });
          }),
      },
    ],
  });
  return groups;
}

/** 手放す時期（名義の人の年齢で）。prominent は今の車に乗り続けるとき（買い替えのすぐ下に出す） */
function untilField(c: Car, k: string, car: (h: Household, w: WorkingHousehold) => Car | undefined, owner: (h: Household) => Member | undefined, prominent: boolean): FieldDef {
  const oneTime = !isLeaseCar(c) && replaceKind(c) === "none";
  const help = [
    prominent ? "今の車を手放す時期です。名義の人の年齢で入れます" : "名義の人の年齢で入れます",
    `その年齢に達する月で手放します（${oneTime ? (c.purchase?.owned === true ? "推定は今から5年です" : "推定は、買ってから13年〔乗用車の平均使用年数の目安〕です") : `足したときは名義の人の${RELEASE_AGE}歳を推定で入れています。空にすると最後まで乗ります`}）`,
    "運転免許の更新で認知機能の検査が始まる75歳ごろを目安にするFPも多いです",
    isLeaseCar(c) ? "リース・長期レンタルは、手放す月まで月額を数えます" : "手放すときの売却額は、まだ計算に入っていません",
  ].join("。");
  const setNull = (w: WorkingHousehold, write: (x: Car) => void): WorkingHousehold => {
    const next = mutate(w, (h, req) => {
      const x = car(h, { ...w, request: req });
      if (x === undefined) return;
      write(x);
      putRow(inputOf(req), addr(c.id, "car.until"), undefined);
    });
    // 買い替えない車は、空にしたら目安（推定）に戻す
    return withOneTimeUntil(next, c.id);
  };
  // 推定の印（足したときの既定・この1台だけの目安）は物の値の状態の行に持つので、その行を当て先にする（「この値にする」で印が外れる）
  return withAddress(field({
    key: `${k}/untilAge`,
    item: "car.until",
    label: "手放す時期",
    level: "simple",
    kind: "int",
    suffix: "歳",
    min: 18,
    max: 100,
    optional: true,
    ...(oneTime ? { blankIsEstimate: true } : {}),
    help,
    get: (w) => {
      const h = w.request.input.household;
      const x = car(h, w);
      const raw = x?.until;
      if (raw == null) return { value: null, hint: "最後まで", implicit: true };
      // 買い替えない車の目安（推定）は、物の値の状態の行で持つ（欄の当て先は結果のタブで動かす項目のまま。0101）
      const row = rowAt(inputOf(w.request), addr(c.id, "car.until"));
      const estimated = row?.state === "estimated" ? (row.estimate?.basis ?? "推定") : null;
      // 出来事「車を手放す」を指しているときは、出来事の時点で読む
      const ev = raw.event !== undefined && raw.offset === undefined ? (h.events ?? []).find((e) => e.id === raw.event) : undefined;
      const u = ev?.at ?? raw;
      if (u.memberAge !== undefined && u.memberAge.member === x?.owner && (u.memberAge.months ?? 0) === 0) return { value: u.memberAge.years, estimated };
      const o = ownerOf(h, x);
      const ym = resolveTimepoint(h, u);
      return { value: o !== undefined && ym !== null ? ageAt(o, ym) : null, estimated, derived: u.at !== undefined ? `年月（${u.at}）で入っています。書き換えると年齢の形にします` : "ほかの形の時点で入っています" };
    },
    set: (w, v) => {
      if (v === null)
        return setNull(w, (x) => {
          if (x.until !== undefined) x.until = null;
        });
      return mutate(w, (h, req) => {
        const x = car(h, { ...w, request: req });
        if (x === undefined) return;
        const at = { memberAge: { member: x.owner, years: Number(v), months: 0 } };
        // 出来事「車を手放す」を指しているときは、出来事のほうを動かす（手放した後の移動の費用・続きの車も一緒に動く）
        const ev = x.until?.event !== undefined && x.until.offset === undefined ? (h.events ?? []).find((e) => e.id === x.until?.event && e.kind === "carRelease") : undefined;
        if (ev !== undefined) ev.at = at;
        else x.until = at;
      });
    },
    // 時点の部品（0038）: 名義の人の年齢（既定）・年月・今から・出来事からで入れる。結果のタブで動かす項目は年齢の整数のまま
    time: timeView({
      ageOf: owner,
      who: ADULTS_WHO,
      optional: true,
      nullText: oneTime ? "推定" : "最後まで",
      anchor: "carRelease",
      read: (w) => car(w.request.input.household, w)?.until ?? null,
      write: (w, tp) => {
        if (tp === null)
          return setNull(w, (x) => {
            if (x.until !== undefined) x.until = null;
          });
        return mutate(w, (h, req) => {
          const x = car(h, { ...w, request: req });
          if (x !== undefined) x.until = tp;
        });
      },
    }),
  }), addr(c.id, "car.until"));
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
      const t = total ?? upkeepEstimate(x).value;
      // リース・長期レンタルの月額に含む物は、合計に入っていないので分けない（欄も出さない。0101）
      const inc = leaseIncludes(x);
      const parts: string[] = [];
      let rest = t;
      if (inc?.taxAndCompulsory !== true) {
        x.tax = { annual: CAR_ESTIMATE.tax.value };
        assumed[`${k}/tax`] = CAR_ESTIMATE.tax.basis;
        rest -= CAR_ESTIMATE.tax.value;
        parts.push("自動車税");
      }
      if (inc?.insurance !== true) {
        x.insurance = { annual: CAR_ESTIMATE.insurance.value };
        assumed[`${k}/insurance`] = CAR_ESTIMATE.insurance.basis;
        rest -= CAR_ESTIMATE.insurance.value;
        parts.push("保険");
      }
      if (inc?.inspectionMaintenance !== true) {
        x.inspection = { amount: CAR_ESTIMATE.inspection.value };
        assumed[`${k}/inspection`] = CAR_ESTIMATE.inspection.basis;
        rest -= Math.round(CAR_ESTIMATE.inspection.value / 2);
        parts.push("車検");
      }
      if (rest > 0) x.fuel = { annual: rest };
      if (rest > 0) assumed[`${k}/fuel`] = parts.length === 0 ? `維持費の合計（年${manYen(t)}）` : `維持費の合計（年${manYen(t)}）から${parts.join("・")}の目安を引いた残り`;
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

/**
 * 足した車の手放す時期の既定（推定）: 名義の人が75歳になる月（運転免許の更新で認知機能の検査が始まる年齢の目安。利用者の判断で「最後まで」から変えた）。
 * 名義の人がもう75歳以上なら次の誕生月の年齢（足した車がすぐ消えないように）。これから足す車だけで、前に足した車は書き換えない
 */
export const RELEASE_AGE = 75;
export const RELEASE_BASIS = `既定の値（名義の人が${RELEASE_AGE}歳で手放す。運転免許の更新で認知機能の検査が始まる年齢の目安。この世帯に合わせて直してください）`;

/** 名義の人の手放す時期の既定の時点（75歳、もう過ぎていれば次の年齢） */
export function releaseAt(h: Household, ownerId: string, baseMonth: string): Timepoint {
  const o = h.members.find((m) => m.id === ownerId);
  const age = o === undefined ? 0 : ageAt(o, baseMonth);
  return { memberAge: { member: ownerId, years: Math.max(RELEASE_AGE, age + 1), months: 0 } };
}

/** 手放す時期が、足したときの既定（名義の人の75歳。推定）のままか */
function untilIsReleaseEstimate(wh: WorkingHousehold, carId: string): boolean {
  const row = rowAt(inputOf(wh.request), addr(carId, "car.until"));
  return row?.state === "estimated" && row.estimate?.basis === RELEASE_BASIS;
}

/** 車を足す（目安の値で。目安で入れた欄は「推定」）。owned は今の車（次の買い替えから）か、これから買う車か。手放す時期は名義の人の75歳（推定） */
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
      until: releaseAt(hh, owner.id, wh.request.input.baseMonth),
    });
    putRow(inputOf(req), addr(carId, "car.purchase", ["first"]), estRow(FIRST_BASIS));
    putRow(inputOf(req), addr(carId, "car.until"), estRow(RELEASE_BASIS));
  });
  return { ...next, assumed: { ...next.assumed, [`${k}/every`]: CAR_ESTIMATE.everyYears.basis, [`${k}/price`]: CAR_ESTIMATE.price.basis, [`${k}/tradeIn`]: trade.basis, [`${k}/upkeep`]: CAR_ESTIMATE.upkeep.basis } };
}

/**
 * リース・長期レンタルの車を足す（0101）。月額は目安を入れず、未入力の印（0円で計算中）。維持費の合計は、月額に含む物（カーリース: 自動車税・車検）を引いた目安（推定）
 */
export function addLeaseCar(wh: WorkingHousehold, id: () => string = newId): WorkingHousehold {
  const h = wh.request.input.household;
  const owner = h.members.find((m) => m.kind === "self") ?? h.members[0];
  if (owner === undefined) return wh;
  const carId = id();
  const k = `ev/car/${carId}`;
  const body: Car = { id: carId, owner: owner.id, lease: { type: "carLease", monthly: 0 }, upkeepMode: "total" };
  const est = upkeepEstimate(body);
  const next = mutate(wh, (hh, req) => {
    (hh.cars ??= []).push({ ...body, upkeep: { annual: est.value }, until: releaseAt(hh, owner.id, wh.request.input.baseMonth) });
    putRow(inputOf(req), addr(carId, "car.lease", ["monthly"]), estRow(LEASE_UNENTERED));
    putRow(inputOf(req), addr(carId, "car.until"), estRow(RELEASE_BASIS));
  });
  return { ...next, assumed: { ...next.assumed, [`${k}/upkeep`]: est.basis } };
}

/** 車の入力項目の出るお金の行の区画（車の修理・用品・手放した後の移動の費用など。ときどき使うカーシェア・レンタカーは基本生活費の交通費で入れる。0101） */
function moveSection(wh: WorkingHousehold): SectionDef | null {
  const out = moneySections(wh, "car", { claimed: new Set(), level: "simple", outTitle: "出るお金" }).find((s) => s.key.endsWith("/out"));
  if (out === undefined) return null;
  const empty = out.groups.length === 0;
  return {
    ...out,
    note: `${empty ? "まだありません。" : ""}車の修理・用品、手放した後の移動の費用などを入れます（ときどき使うカーシェア・レンタカーは、基本生活費の「交通費」で入れます）`,
  };
}

/** 今の自動車ローン（今返している分。kind car の負債） */
export const carDebts = (h: Household): Debt[] => (h.debts ?? []).filter((d) => d.kind === "car" && d.property === undefined && d.inheritedFrom === undefined);

/** 今返している自動車ローン（住まい・ローンのカードから移した。0069）。返済の欄は、ほかのローンと同じ部品 */
function carLoanSection(wh: WorkingHousehold): SectionDef {
  const debts = carDebts(wh.request.input.household);
  // 今の車があれば、標準にも足すボタン（今の車のローンが残っているかは面談で毎回聞く）
  const ownedCar = (wh.request.input.household.cars ?? []).some((c) => c.purchase?.owned === true);
  const level = debts.length > 0 || ownedCar ? "simple" : "detail";
  return {
    key: "car/loans",
    title: "今返している自動車ローン",
    ...(debts.length === 0 ? { note: "今の車のローンを返しているときに入れます（これから買う車のローンは、車の「買い方」で入れます）" } : {}),
    level,
    groups: debts.flatMap((d, i) => carLoanGroups(wh, d, i)),
    actions: [{ key: "car/addCarLoan", label: ownedCar ? "＋ 今返している自動車ローン" : "＋ 自動車ローン", level, run: (w) => newCarLoan(w) }],
  };
}

/** 車のパネル: 持っている車を1台ずつ（台数に上限なし）、車のカードの出るお金の行、今返している自動車ローン */
export function carStage(wh: WorkingHousehold): StageDef {
  const list = wh.request.input.household.cars ?? [];
  const move = moveSection(wh);
  return {
    id: "car",
    label: "車",
    lead: "車ごとの買い替え・リース・維持費・手放す時期と、手放した後の移動の費用。",
    sections: [
      {
        key: "ev/cars",
        title: "車",
        note: "買い替え（下取り・ローン）・リースの月額と維持費を、車ごとに入れます。2台目からは「＋ もう1台」で足します。基本生活費の「交通費」には車の費用を入れないでください（二重になります）",
        level: "simple",
        groups: list.flatMap((c, i) => carGroups(wh, c, i, list)),
        actions: [
          ...(list.length === 0
            ? [
                { key: "ev/addCar", label: "＋ 今の車", help: "価格・維持費などは目安の値で入れます（あとで直せます）", level: "simple" as const, run: (w: WorkingHousehold) => addCar(w) },
                { key: "ev/addCarNew", label: "＋ これから買う車", help: "価格・維持費などは目安の値で入れます（あとで直せます）", level: "simple" as const, run: (w: WorkingHousehold) => addCar(w, newId, false) },
              ]
            : [
                { key: "ev/addCar", label: "＋ もう1台（今の車）", help: "価格・維持費などは目安の値で入れます（あとで直せます）", level: "simple" as const, run: (w: WorkingHousehold) => addCar(w) },
                { key: "ev/addCarNew", label: "＋ もう1台（これから買う車）", help: "価格・維持費などは目安の値で入れます（あとで直せます）", level: "simple" as const, run: (w: WorkingHousehold) => addCar(w, newId, false) },
              ]),
          {
            key: "ev/addCarLease",
            label: "＋ リース・長期レンタル（月額）",
            help: "カーリース・長期レンタルの車を、月額で足します。月額は契約書の額を入れてください（入れるまでは0円で計算します）",
            level: "simple",
            run: (w: WorkingHousehold) => addLeaseCar(w),
          },
        ],
      },
      ...(move !== null ? [move] : []),
      carLoanSection(wh),
    ],
  };
}
