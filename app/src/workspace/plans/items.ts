// 主画面で動かせる項目（「動かす項目」）の一覧。
// - 対策の固定の項目（働く最後の年齢・年金の受け取り開始・NISA・生活費・FP顧問料）
// - よく使う項目（住宅ローンの借入額か繰上返済・金利・変動金利の上昇・資産運用の配分）
// - 入力の項目の定義（input/stages/ の欄）から作る、数の欄すべて
// 動かした値は案（plans.ts）の差分にだけ入り、入力（現状）は変えない（0008 の5）
import type { Debt, EngineRequest } from "../../engine/types.ts";
import { group, monthlyMan } from "../../presentation/format.ts";
import type { DemoHousehold } from "../catalog.ts";
import { allFields, resolveTimepoint, type FieldDef, type StageDef } from "../input/form.ts";
import { mutate, reemploymentOf, type WorkingHousehold } from "../input/household.ts";
import { ACCOUNT_KINDS, memberLabel } from "../input/labels.ts";
import { buildStages, STAGE_ORDER } from "../input/stages/index.ts";
import { pctFromRate, sameRate } from "../input/units.ts";
import { addMonths, advisoryFeeInCurrent, hasAdvisoryFee, LEVER_KEYS, parseYm, readLevers, type LeverKey, type LeverValues } from "../levers.ts";
import { roles } from "../roles.ts";
import { bucketShares, expectedReturn, type MixPart } from "./allocation.ts";
import { addRate, cmpRate, nonNegative, pctText, subRate } from "./decimal.ts";
import { ageAt } from "../levers.ts";
import { setSurplusRatio, surplusRatioOf } from "../surplus.ts";
import { accountsOf, drawdownOf, drawdownStartDefault, INVEST_KINDS, methodOf, NOT_FINANCIAL, portfolioOf, rateOf, rateText, setDrawdown, setStopAge, stopAgeOf, stopAgeOrEstimate, stopEstimateOf, totalViewOf, valueOf } from "../input/savings/model.ts";

/** 変動金利の上乗せ（前提の assumptions.loanRateShifts の1件） */
export interface RateShift {
  /** 上乗せの幅（率） */
  add: string;
  /** 上乗せが始まる月 "YYYY-MM" */
  from: string;
}

export type ItemValue = number | string | boolean | MixPart[] | RateShift | null;

/** 差分の向き先（0008 の5）: 物・構成員・プランの前提 */
export type DiffTarget = { object: string } | { member: string } | { plan: "assumptions" };

/** 金額のスライダーの刻み（1万円。月額は月1万円、年額は年1万円） */
export const AMOUNT_STEP = 10_000;

export type Control =
  /** 年齢のスライダー（対策の固定の項目のうち、働く最後の年齢・年金の受け取り開始）。1歳ずつ動き、目盛りの数字は ticks だけ出す */
  | { kind: "age"; min: number; max: number; ticks: number[]; tick: (v: number) => string }
  /** 円などの数のスライダー（金額は1万円の刻み。per は月額・年額の別） */
  | { kind: "range"; min: number; max: number; step: number; ticks: number[]; tick: (v: number) => string; per?: "月" | "年" | "" }
  /** 率のスライダー（10進の文字列） */
  | { kind: "rate"; min: string; max: string; step: string }
  | { kind: "toggle" }
  /** 配分（株式・債券・預金） */
  | { kind: "mix"; accountKind: string }
  /** 変動金利の上昇（幅と始まりの年） */
  | { kind: "shift"; years: number[] }
  /** 入力の欄と同じ形の数値の欄（金額の欄は、1万円の刻みのスライダーも付ける） */
  | { kind: "field"; field: FieldDef; slider?: { min: number; max: number; step: number; per: "月" | "年" | "" } };

export interface MovableItem {
  /** 動かす項目のキー（差分の key。物の ID を含む） */
  key: string;
  /** 入力項目ID（0004・registry/items.yaml） */
  item: string;
  target: DiffTarget;
  label: string;
  /** 案の名前の例に使う短い名前（例: 借入） */
  short: string;
  /** 追加のメニューの見出し */
  group: string;
  /** 対策に最初から出す項目 */
  builtin: boolean;
  /** 当てる順番: 欄 → 対策の固定の項目 → FP顧問料 */
  phase: "field" | "lever" | "fee";
  control: Control;
  /** 現状の値 */
  read: (wh: WorkingHousehold) => ItemValue;
  /** 値を当てる（phase が field のときだけ使う。元の世帯は変えない） */
  apply: (wh: WorkingHousehold, v: ItemValue) => WorkingHousehold;
  text: (v: ItemValue) => string;
  same: (a: ItemValue, b: ItemValue) => boolean;
  /** スライダーの下の補足 */
  note?: (v: ItemValue) => string | null;
}

export interface Catalog {
  selfId: string;
  items: MovableItem[];
  byKey: Map<string, MovableItem>;
}

const jsonSame = (a: ItemValue, b: ItemValue) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
const manText = (n: number) => `${group(Math.round(n / 10000))}万円`;
const ymText = (ym: string) => `${Number(ym.slice(0, 4))}年${Number(ym.slice(5))}月`;
const MAN = 10000;

/** 金額のスライダーの範囲を1万円の倍数にそろえる（今の値と基準の値も必ず含む） */
export function amountRange(min: number, max: number, ...include: (number | null | undefined)[]): { min: number; max: number } {
  const xs = include.filter((x): x is number => typeof x === "number" && Number.isFinite(x));
  const lo = Math.min(min, ...xs);
  const hi = Math.max(max, ...xs);
  return { min: Math.max(0, Math.floor(lo / AMOUNT_STEP) * AMOUNT_STEP), max: Math.ceil(hi / AMOUNT_STEP) * AMOUNT_STEP };
}

/** 金額の欄のスライダーの範囲: 0 から、今の値の2倍（少なくとも月額10万円・年額と一時金100万円）まで */
export function fieldAmountRange(basis: "monthly" | "annual" | "once", now: number | null): { min: number; max: number } {
  const floor = basis === "monthly" ? 100_000 : 1_000_000;
  return amountRange(0, Math.max(floor, (now ?? 0) * 2));
}

// ---- 対策の固定の項目（今までの主画面のスライダー）----

/** 打ち手の目盛り: 見本の世帯の目盛りに、今の値（現状）を足す。見本の無い世帯は標準の目盛り */
export function leverSteps(demo: DemoHousehold | null, base: Partial<LeverValues>): Record<LeverKey, number[]> {
  const living = base.livingMonthly ?? 250000;
  const around = [-40000, -20000, 0, 20000].map((d) => Math.max(50000, Math.round((living + d) / 10000) * 10000));
  const std: Record<LeverKey, number[]> = { retireAge: [60, 62, 65, 68, 70], pensionAge: [60, 65, 68, 70, 75], nisaMonthly: [0, 10000, 30000, 50000], livingMonthly: around };
  const out = {} as Record<LeverKey, number[]>;
  for (const k of LEVER_KEYS) {
    const steps = new Set(demo?.steps[k] ?? std[k]);
    const b = base[k];
    if (b !== undefined) steps.add(b);
    out[k] = [...steps].sort((a, z) => a - z);
  }
  return out;
}

/** 年金の受け取り開始の年齢の範囲（繰上げ60歳〜繰下げ75歳。制度は1か月単位だが、対策のスライダーは1歳ずつ） */
export const PENSION_AGE_RANGE = { min: 60, max: 75 } as const;

/** 働く最後の年齢のスライダーの広さ: 目盛りの外でも、50歳（まだ来ていなければ次の年齢）から75歳までは選べる */
export const RETIRE_AGE_REACH = { min: 50, max: 75 } as const;

/** 働く最後の年齢のスライダー: 目盛り（見本の世帯の段）より広く、今の年齢の次から選べる（早期退職の55歳など） */
export function retireAgeControl(steps: readonly number[], tick: (v: number) => string, nowAge: number | null): Control & { kind: "age" } {
  const lo = Math.max(RETIRE_AGE_REACH.min, nowAge === null ? RETIRE_AGE_REACH.min : nowAge + 1);
  const min = Math.min(Math.min(...steps), lo);
  const max = Math.max(Math.max(...steps), RETIRE_AGE_REACH.max);
  // 目盛りの数字は、見本の世帯の段に範囲の両端を足す（目盛りの外でも選べることが見えるように）
  return { kind: "age", min, max, ticks: [...new Set([min, ...steps, max])].sort((a, b) => a - b), tick };
}

/** 年齢のスライダー: 目盛りの最小〜最大を1歳ずつ（limit があればその中に収める）。目盛りの数字は今の段を残す */
export function ageControl(steps: readonly number[], tick: (v: number) => string, limit: { min: number; max: number } | null): Control & { kind: "age" } {
  let min = Math.min(...steps);
  let max = Math.max(...steps);
  if (limit !== null) {
    min = Math.max(limit.min, min);
    max = Math.min(limit.max, max);
  }
  return { kind: "age", min, max, ticks: steps.filter((v) => v >= min && v <= max), tick };
}

const LEVER_LABEL: Record<LeverKey, (who: string) => string> = {
  retireAge: (who) => `${who}が働く最後の年齢`,
  pensionAge: (who) => `${who}の年金の受け取り開始`,
  nisaMonthly: () => "NISAの積立額（月）",
  livingMonthly: () => "毎月の生活費",
};
const LEVER_SHORT: Record<LeverKey, string> = { retireAge: "働く年齢", pensionAge: "年金の受け取り", nisaMonthly: "NISA", livingMonthly: "生活費" };
const LEVER_ITEM: Record<LeverKey, string> = { retireAge: "employment.to", pensionAge: "pensionRecord.claim", nisaMonthly: "account.contributions", livingMonthly: "livingExpense.monthly" };

export const leverValueText = (k: LeverKey, v: number): string =>
  k === "retireAge" ? `${v}歳まで` : k === "pensionAge" ? `${v}歳から` : k === "nisaMonthly" ? (v === 0 ? "なし" : `月${monthlyMan(v)}`) : `月${monthlyMan(v)}`;
const leverTick = (k: LeverKey, v: number): string => (k === "nisaMonthly" || k === "livingMonthly" ? (v === 0 ? "0" : `${v / 10000}万`) : String(v));
const pct = (r: string) => `${Math.round(Number(r) * 100)}%`;

function leverNote(k: LeverKey, wh: WorkingHousehold, selfId: string, demo: DemoHousehold | null, v: number | undefined): string | null {
  const h = wh.request.input.household;
  if (k === "retireAge") {
    const p = wh.postRetirement[selfId];
    if (p?.type != null && p.annualSalary !== null) return `${p.fromAge}歳から${p.type === "selfEmployed" ? "自営業" : p.type === "partTime" ? "パート" : "再雇用"}（年収${Math.round(p.annualSalary / 10000)}万円）`;
    return null;
  }
  if (k === "pensionAge") return v === 65 ? "原則の65歳" : null;
  if (k === "nisaMonthly") return demo?.notes?.nisaMonthly ?? "働いている間、毎月積み立てる";
  const st = (h.livingExpenses ?? []).find((l) => l.mode === "total")?.stages ?? [];
  const names: Record<string, string> = { childIndependence: "子の独立後は", retirement: "退職後は", age70: "70歳から", age80: "80歳から" };
  const parts = st.filter((s) => s.ratio !== undefined && names[s.label] !== undefined).map((s) => `${names[s.label]}${pct(s.ratio as string)}`);
  return parts.length > 0 ? parts.join("、") : null;
}

function leverItems(wh: WorkingHousehold, selfId: string, demo: DemoHousehold | null): MovableItem[] {
  const base = readLevers(wh.request, selfId);
  const steps = leverSteps(demo, base);
  const who = roles(wh.request).find((r) => r.key === "self")?.label ?? "本人";
  const h = wh.request.input.household;
  const targetOf = (k: LeverKey): DiffTarget => {
    if (k === "nisaMonthly") {
      const a = (h.accounts ?? []).find((x) => x.kind === "nisa" && x.owner === selfId);
      if (a !== undefined) return { object: a.id };
    }
    if (k === "livingMonthly") {
      const l = (h.livingExpenses ?? []).find((x) => x.mode === "total");
      if (l !== undefined) return { object: l.id };
    }
    return { member: selfId };
  };
  // 年齢は1歳ずつ、金額（NISA・生活費）は1万円の刻みのスライダー。範囲は目盛りの最小から最大まで（今の考え方のまま）
  const controlOf = (k: LeverKey): Control => {
    const tick = (v: number) => leverTick(k, v);
    if (k === "retireAge") {
      const self = h.members.find((m) => m.id === selfId);
      return retireAgeControl(steps[k], tick, self === undefined ? null : ageAt(self, wh.request.input.baseMonth));
    }
    if (k === "pensionAge") return ageControl(steps[k], tick, PENSION_AGE_RANGE);
    const r = amountRange(Math.min(...steps[k]), Math.max(...steps[k]));
    return { kind: "range", min: r.min, max: r.max, step: AMOUNT_STEP, ticks: steps[k], tick, per: "月" };
  };
  return LEVER_KEYS.filter((k) => base[k] !== undefined).map((k) => ({
    key: `lever:${k}`,
    item: LEVER_ITEM[k],
    target: targetOf(k),
    label: LEVER_LABEL[k](who),
    short: LEVER_SHORT[k],
    group: "対策",
    builtin: true,
    phase: "lever" as const,
    control: controlOf(k),
    read: (w: WorkingHousehold) => readLevers(w.request, selfId)[k] ?? null,
    apply: (w: WorkingHousehold) => w,
    text: (v: ItemValue) => (typeof v === "number" ? leverValueText(k, v) : "—"),
    same: jsonSame,
    note: (v: ItemValue) => leverNote(k, wh, selfId, demo, typeof v === "number" ? v : undefined),
  }));
}

function feeItem(wh: WorkingHousehold): MovableItem[] {
  if (!hasAdvisoryFee(wh.request)) return [];
  const first = (wh.request.input.household.advisoryFees ?? [])[0] as { id: string };
  return [
    {
      key: "lever:fee",
      item: "advisoryFee.enabled",
      target: { object: first.id },
      label: "FP顧問料",
      short: "FP顧問料",
      group: "対策",
      builtin: true,
      phase: "fee",
      control: { kind: "toggle" },
      read: (w) => advisoryFeeInCurrent(w.request),
      apply: (w) => w,
      text: (v) => (v === true ? "入れる" : "入れない"),
      same: jsonSame,
    },
  ];
}

// ---- 資産運用（0026）: 毎月の積立額・運用の利回り・積立をやめる年齢・取り崩しを始める年齢・毎月の取り崩し額・毎年の取り崩し率 ----

/** 万円（1万円未満は小数1桁）: 57000 → 「5.7万円」 */
const manDecimal = (v: number) => `${v % MAN === 0 ? group(v / MAN) : (Math.round(v / 1000) / 10).toFixed(1)}万円`;

/** 今の毎月の積立額（本人の払う分。会社の掛金を除く。合計の入れ方はまとめた器の額） */
export function investMonthlyNow(req: EngineRequest): number {
  const v = totalViewOf(req);
  return v.steps[0]?.monthly ?? 0;
}

/** 運用の利回り（運用する口座の残高で平均。資産配分の入れ方は割合から、合計の入れ方は平均の利回り）。10進の文字列 */
export function investRateNow(req: EngineRequest): string {
  const m = methodOf(req);
  if (m === "total") return totalViewOf(req).rate;
  if (m === "allocation") return rateText(portfolioOf(req).net);
  const list = accountsOf(req.input.household).filter((a) => INVEST_KINDS.has(a.kind));
  const w = list.reduce((s, a) => s + valueOf(a), 0);
  if (list.length === 0) return totalViewOf(req).rate;
  const avg = w > 0 ? list.reduce((s, a) => s + valueOf(a) * Number(rateOf(req, a)), 0) / w : list.reduce((s, a) => s + Number(rateOf(req, a)), 0) / list.length;
  return rateText(avg);
}

/** 毎月の積立額を変える: 増やした分は本人の NISA のつみたて投資枠（無ければ合計の器・預金）のどの期間にも足し、減らした分はどの積立も同じ割合で減らす */
function applyMonthly(w: WorkingHousehold, v: number): WorkingHousehold {
  const now = investMonthlyNow(w.request);
  const delta = v - now;
  if (delta === 0) return w;
  return mutate(w, (h, req) => {
    const self = h.members.find((m) => m.kind === "self");
    const total = methodOf(req) === "total";
    const list = (h.accounts ?? []).filter((a) => (total ? a.kind === "pooled" : a.kind !== "pooled" && !NOT_FINANCIAL.has(a.kind) && a.kind !== "corporateDc"));
    if (delta > 0) {
      const target = list.find((a) => a.kind === "nisa" && a.owner === self?.id) ?? list.find((a) => a.kind === "pooled") ?? list.find((a) => a.kind === "deposit") ?? list[0];
      if (target === undefined) return;
      const own = (target.contributions ?? []).filter((c) => c.tranche !== "growth" && c.payer !== "employer");
      if (own.length === 0) (target.contributions ??= []).push({ from: { at: req.input.baseMonth }, to: null, monthly: delta });
      else for (const c of own) c.monthly += delta;
      return;
    }
    const k = now > 0 ? Math.max(0, v) / now : 0;
    for (const a of list) for (const c of a.contributions ?? []) if (c.payer !== "employer") c.monthly = Math.round((c.monthly * k) / 1000) * 1000;
  });
}

function investItems(wh: WorkingHousehold): MovableItem[] {
  const req = wh.request;
  const h = req.input.household;
  const self = h.members.find((m) => m.kind === "self");
  if (self === undefined || !(h.accounts ?? []).some((a) => !NOT_FINANCIAL.has(a.kind))) return [];
  const nowAge = ageAt(self, req.input.baseMonth);
  const monthly = investMonthlyNow(req);
  const rate = investRateNow(req);
  const dd = drawdownOf(req);
  const plan = { plan: "assumptions" } as const;
  const ageTicks = (lo: number, hi: number) => [lo, ...[55, 60, 65, 70, 75, 80].filter((x) => x > lo && x < hi), hi];
  const out: MovableItem[] = [
    {
      key: "inv:monthly",
      item: "account.contributions",
      target: plan,
      label: "毎月の積立額（今の額）",
      short: "積立",
      group: "資産運用",
      builtin: false,
      phase: "field",
      control: { kind: "range", ...amountRange(0, Math.max(300_000, monthly * 2), monthly), step: AMOUNT_STEP, ticks: [0, monthly], tick: (v) => `${v / MAN}万`, per: "月" },
      read: (w) => investMonthlyNow(w.request),
      apply: (w, v) => (typeof v === "number" ? applyMonthly(w, v) : w),
      text: (v) => (typeof v === "number" ? `月${manDecimal(v)}` : "—"),
      same: jsonSame,
      note: () => "期間を分けているときは、どの期間も同じだけ増減します（増やした分は NISA のつみたて投資枠へ）",
    },
    {
      key: "inv:rate",
      item: "assumptions.returnShifts",
      target: plan,
      label: "運用の利回り（預金を除く）",
      short: "利回り",
      group: "資産運用",
      builtin: false,
      phase: "field",
      control: { kind: "rate", min: "0", max: addRate(rate, "0.03"), step: "0.0005" },
      read: (w) => investRateNow(w.request),
      apply: (w, v) => {
        if (typeof v !== "string") return w;
        const delta = subRate(v, investRateNow(w.request));
        if (cmpRate(delta, "0") === 0) return w;
        const request = structuredClone(w.request);
        const a = (request.input.assumptions ??= { investmentReturn: { default: "0.01" } });
        a.returnShifts = [...(a.returnShifts ?? []), { from: parseYm(request.input.baseMonth).y, add: delta }];
        return { ...w, request };
      },
      text: (v) => (typeof v === "string" ? `年${pctText(v, 1)}` : "—"),
      same: (a, b) => (typeof a === "string" && typeof b === "string" ? sameRate(a, b) : a === b),
      note: () => "運用する口座の利回りを、どの口座も同じ幅だけ動かします",
    },
    {
      key: "inv:stop",
      item: "account.contributions",
      target: plan,
      label: "積立をやめる年齢",
      short: "積立をやめる年",
      group: "資産運用",
      builtin: false,
      phase: "field",
      control: ageControl(ageTicks(Math.max(nowAge + 1, 50), 75), (v) => String(v), { min: nowAge + 1, max: 80 }),
      read: (w) => stopAgeOrEstimate(w.request),
      apply: (w, v) => (typeof v === "number" && v !== stopAgeOrEstimate(w.request) ? mutate(w, (hh, r) => setStopAge(hh, r.input.baseMonth, v)) : w),
      text: (v) => (typeof v === "number" ? `${v}歳でやめる` : "—"),
      same: jsonSame,
      note: () => (stopAgeOf(h) === null ? `入力は空欄（${stopEstimateOf(req).until}まで・推定）` : null),
    },
  ];
  const wStart = (w: WorkingHousehold) => (drawdownOf(w.request).method === "none" ? null : drawdownOf(w.request).startAge);
  out.push(
    {
      key: "inv:wStart",
      item: "assumptions.investment",
      target: plan,
      label: "取り崩しを始める年齢",
      short: "取り崩しの始まり",
      group: "資産運用",
      builtin: false,
      phase: "field",
      control: ageControl(ageTicks(Math.max(nowAge + 1, 55), 85), (v) => String(v), { min: nowAge + 1, max: 90 }),
      read: (w) => wStart(w) ?? drawdownStartDefault(w.request),
      apply: (w, v) => {
        if (typeof v !== "number") return w;
        const d = drawdownOf(w.request);
        if (d.method !== "none" ? d.startAge === v : v === drawdownStartDefault(w.request)) return w;
        return mutate(w, (_h, r) => setDrawdown(r, { ...d, method: d.method === "none" ? "fixed" : d.method, startAge: v }));
      },
      text: (v) => (typeof v === "number" ? `${v}歳から` : "—"),
      same: jsonSame,
      note: () => (dd.method === "none" ? "取り崩しの予定が無いときは、毎月の取り崩し額（今の値）で始めます" : null),
    },
    {
      key: "inv:wAmt",
      item: "assumptions.investment",
      target: plan,
      label: "毎月の取り崩し額",
      short: "取り崩し",
      group: "資産運用",
      builtin: false,
      phase: "field",
      control: { kind: "range", ...amountRange(0, 500_000, dd.monthly), step: AMOUNT_STEP, ticks: [0, dd.method === "fixed" ? dd.monthly : 0], tick: (v) => `${v / MAN}万`, per: "月" },
      read: (w) => (drawdownOf(w.request).method === "fixed" ? drawdownOf(w.request).monthly : 0),
      apply: (w, v) => {
        if (typeof v !== "number") return w;
        const d = drawdownOf(w.request);
        if (d.method === "fixed" && d.monthly === v) return w;
        if (v <= 0) return d.method === "fixed" ? mutate(w, (_h, r) => setDrawdown(r, { ...d, method: "none" })) : w;
        return mutate(w, (_h, r) => setDrawdown(r, { ...d, method: "fixed", monthly: v, startAge: d.method === "none" ? drawdownStartDefault(w.request) : d.startAge }));
      },
      text: (v) => (typeof v === "number" ? (v === 0 ? "予定なし" : `月${manDecimal(v)}`) : "—"),
      same: jsonSame,
      note: () => "年金などで足りない分を含めた、金融資産から使う額（収支の不足のほうが大きい年は不足の分）",
    },
    {
      key: "inv:wRate",
      item: "assumptions.investment",
      target: plan,
      label: "毎年の取り崩し率",
      short: "取り崩し率",
      group: "資産運用",
      builtin: false,
      phase: "field",
      control: { kind: "rate", min: "0", max: "0.1", step: "0.0005" },
      read: (w) => (drawdownOf(w.request).method === "rate" ? drawdownOf(w.request).rate : "0"),
      apply: (w, v) => {
        if (typeof v !== "string") return w;
        const d = drawdownOf(w.request);
        if (d.method === "rate" && sameRate(d.rate, v)) return w;
        if (cmpRate(v, "0") <= 0) return d.method === "rate" ? mutate(w, (_h, r) => setDrawdown(r, { ...d, method: "none" })) : w;
        return mutate(w, (_h, r) => setDrawdown(r, { ...d, method: "rate", rate: v, startAge: d.method === "none" ? drawdownStartDefault(w.request) : d.startAge }));
      },
      text: (v) => (typeof v === "string" ? (cmpRate(v, "0") <= 0 ? "予定なし" : `年${pctText(v, 1)}`) : "—"),
      same: (a, b) => (typeof a === "string" && typeof b === "string" ? sameRate(a, b) : a === b),
      note: () => "その年の初めの金融資産に対する率",
    },
  );
  return out;
}

// ---- 黒字の貯まり方（0031）: 黒字のうち貯まる割合 ----

function surplusItems(wh: WorkingHousehold): MovableItem[] {
  const h = wh.request.input.household;
  if (!h.members.some((m) => m.kind === "self")) return [];
  const plan = { plan: "assumptions" } as const;
  const ratioNow = (w: WorkingHousehold) => surplusRatioOf(w.request) ?? "1";
  return [
    {
      key: "surplus:ratio",
      item: "assumptions.surplusSaving",
      target: plan,
      label: "黒字のうち貯まる割合",
      short: "貯まる割合",
      group: "貯まり方",
      builtin: false,
      phase: "field",
      control: { kind: "rate", min: "0", max: "1", step: "0.05" },
      read: ratioNow,
      apply: (w, v) => {
        if (typeof v !== "string" || sameRate(v, ratioNow(w))) return w;
        return { ...w, request: setSurplusRatio(w.request, cmpRate(v, "1") >= 0 ? null : v) };
      },
      text: (v) => (typeof v !== "string" ? "—" : cmpRate(v, "1") >= 0 ? "100%（全部貯まる）" : pctText(v, 0)),
      same: (a, b) => (typeof a === "string" && typeof b === "string" ? sameRate(a, b) : a === b),
      note: () => "黒字の年だけ、貯まらない分を「ゆとりの支出」として支出に入れます（赤字の年・退職金などの一時金・取り崩しの計画がある年は対象外）",
    },
  ];
}

// ---- よく使う項目 ----

function loanLabel(wh: WorkingHousehold, d: Debt, mortgages: Debt[]): string {
  const n = mortgages.length > 1 ? ` ${mortgages.indexOf(d) + 1}（${memberLabel(wh, (d.debtors.find((x) => x.role === "primary") ?? d.debtors[0])?.member)}）` : "";
  return `住宅ローン${n}`;
}

/** 借入がもう始まっていて、残高を入れているローン（借入額を変えても計算は変わらないので、繰上返済で動かす） */
export function loanStarted(req: EngineRequest, d: Debt): boolean {
  const start = resolveTimepoint(req.input.household, d.start);
  return start !== null && start <= req.input.baseMonth && d.balance?.value != null;
}

function loanItems(wh: WorkingHousehold): MovableItem[] {
  const req = wh.request;
  const h = req.input.household;
  const mortgages = (h.debts ?? []).filter((d) => d.kind === "mortgage");
  const out: MovableItem[] = [];
  const find = (w: WorkingHousehold, id: string) => (w.request.input.household.debts ?? []).find((x) => x.id === id);
  for (const d of mortgages) {
    const name = loanLabel(wh, d, mortgages);
    if (!loanStarted(req, d)) {
      const p = d.principal;
      const min = Math.max(0, Math.floor((p - 20_000_000) / 1_000_000) * 1_000_000);
      const max = Math.ceil((p + 10_000_000) / 1_000_000) * 1_000_000;
      const start = resolveTimepoint(h, d.start);
      out.push({
        key: `loan:${d.id}:principal`,
        item: "debt.principal",
        target: { object: d.id },
        label: `${name}の借入額`,
        short: "借入",
        group: "よく使う",
        builtin: false,
        phase: "field",
        control: { kind: "range", min, max, step: AMOUNT_STEP, ticks: [min, p, max], tick: (v) => `${group(v / MAN)}万`, per: "" },
        read: (w) => find(w, d.id)?.principal ?? null,
        apply: (w, v) =>
          typeof v !== "number"
            ? w
            : mutate(w, (hh) => {
                const x = (hh.debts ?? []).find((y) => y.id === d.id);
                if (x !== undefined) x.principal = v;
              }),
        text: (v) => (typeof v === "number" ? manText(v) : "—"),
        same: jsonSame,
        note: () => `借入${start !== null ? `は${ymText(start)}` : ""}。頭金・物件の価格は変えません`,
      });
    } else {
      const bal = d.balance?.value ?? 0;
      const max = Math.max(1_000_000, Math.floor(bal / 1_000_000) * 1_000_000);
      const at = addMonths(req.input.baseMonth, 1);
      out.push({
        key: `loan:${d.id}:prepay`,
        item: "debt.prepayments",
        target: { object: d.id },
        label: `${name}の繰上返済（借入を減らす）`,
        short: "借入",
        group: "よく使う",
        builtin: false,
        phase: "field",
        control: { kind: "range", min: 0, max, step: AMOUNT_STEP, ticks: [0, max], tick: (v) => `${group(v / MAN)}万`, per: "" },
        read: () => 0,
        apply: (w, v) =>
          typeof v !== "number" || v <= 0
            ? w
            : mutate(w, (hh) => {
                const x = (hh.debts ?? []).find((y) => y.id === d.id);
                if (x !== undefined) x.prepayments = [...(x.prepayments ?? []), { at: { at }, amount: v, mode: "shortenTerm" }];
              }),
        text: (v) => (typeof v === "number" && v > 0 ? `${manText(v)}（${ymText(at)}）` : "なし"),
        same: jsonSame,
        note: () => `今の残高 ${manText(bal)}。預金から払い、返済の期間を短くします（借入はもう始まっているため、借入額の代わりに繰上返済で減らします）`,
      });
    }
    const r0 = d.rateSchedule[0]?.rate;
    if (r0 !== undefined) {
      const later = d.rateSchedule.slice(1).map((s) => `${(resolveTimepoint(h, s.from) ?? "").slice(0, 4)}年から${pctText(s.rate)}`);
      out.push({
        key: `loan:${d.id}:rate`,
        item: "debt.rateSchedule",
        target: { object: d.id },
        label: `${name}の金利`,
        short: "金利",
        group: "よく使う",
        builtin: false,
        phase: "field",
        control: { kind: "rate", min: nonNegative(subRate(r0, "0.01")), max: addRate(r0, "0.03"), step: "0.0005" },
        read: (w) => find(w, d.id)?.rateSchedule[0]?.rate ?? null,
        apply: (w, v) => {
          if (typeof v !== "string") return w;
          // 当初の金利を動かした幅だけ、金利の段階もすべて同じ幅で動かす（0 を下回らない）
          const delta = subRate(v, r0);
          if (delta === "0") return w;
          return mutate(w, (hh) => {
            const x = (hh.debts ?? []).find((y) => y.id === d.id);
            if (x !== undefined) for (const s of x.rateSchedule) s.rate = nonNegative(addRate(s.rate, delta));
          });
        },
        text: (v) => (typeof v === "string" ? `当初${pctText(v)}` : "—"),
        same: (a, b) => typeof a === "string" && typeof b === "string" ? sameRate(a, b) : a === b,
        note: (v) => {
          if (later.length === 0) return d.rateSchedule[0]?.type === "variable" ? "変動金利" : null;
          if (typeof v !== "string" || sameRate(v, r0)) return `金利の段階: ${later.join("・")}`;
          const delta = subRate(v, r0);
          const moved = d.rateSchedule.slice(1).map((s) => `${(resolveTimepoint(h, s.from) ?? "").slice(0, 4)}年から${pctText(nonNegative(addRate(s.rate, delta)))}`);
          return `金利の段階も同じ幅で動かします: ${moved.join("・")}`;
        },
      });
    }
  }
  if (mortgages.some((d) => d.rateSchedule.some((s) => s.type === "variable"))) {
    const by = parseYm(req.input.baseMonth).y;
    const years = Array.from({ length: 15 }, (_, i) => by + 1 + i);
    const read = (w: WorkingHousehold): RateShift => {
      const s = (w.request.input.assumptions?.loanRateShifts as RateShift[] | undefined)?.[0];
      return s !== undefined ? { add: s.add, from: s.from } : { add: "0", from: `${by + 3}-01` };
    };
    out.push({
      key: "rates:shift",
      item: "assumptions.loanRateShifts",
      target: { plan: "assumptions" },
      label: "変動金利の上昇",
      short: "金利の上昇",
      group: "よく使う",
      builtin: false,
      phase: "field",
      control: { kind: "shift", years },
      read,
      apply: (w, v) => {
        if (v === null || typeof v !== "object" || Array.isArray(v)) return w;
        const s = v as RateShift;
        const request = structuredClone(w.request);
        const a = (request.input.assumptions ??= { investmentReturn: { default: "0.01" } }) as Record<string, unknown>;
        if (cmpRate(s.add, "0") === 0) delete a.loanRateShifts;
        else a.loanRateShifts = [{ from: s.from, add: s.add }];
        return { ...w, request };
      },
      text: (v) => {
        const s = v as RateShift | null;
        return s === null || cmpRate(s.add, "0") === 0 ? "上がらない" : `${Number(s.from.slice(0, 4))}年から +${pctText(s.add)}`;
      },
      same: (a, b) => {
        const x = a as RateShift | null;
        const y = b as RateShift | null;
        const zero = (s: RateShift | null) => s === null || cmpRate(s.add, "0") === 0;
        if (zero(x) || zero(y)) return zero(x) && zero(y);
        return sameRate((x as RateShift).add, (y as RateShift).add) && (x as RateShift).from === (y as RateShift).from;
      },
      note: () => "変動金利の段に、その年の1月から上乗せします（固定金利の段は変わりません）",
    });
  }
  return out;
}

const MIX_KINDS = new Set(["deposit", "taxable", "nisa", "childNisa", "juniorNisa", "legacyNisa", "ideco", "corporateDc", "zaikei", "esop", "fxDeposit"]);

/** 配分の見せ方: 「株式60%・債券20%・預金20%（年2.48%）」 */
export function mixText(req: EngineRequest, kind: string, mix: readonly MixPart[] | null): string {
  const year = parseYm(req.input.baseMonth).y + 1;
  const r = pctText(expectedReturn(req, { kind, ...(mix !== null ? { assetMix: [...mix] } : {}) }, year));
  if (mix === null || mix.length === 0) return kind === "deposit" ? `預金100%（年${r}）` : `配分なし・運用利回り（年${r}）`;
  const b = bucketShares(mix, kind);
  const parts = [b.equity > 0 ? `株式${b.equity}%` : "", b.bond > 0 ? `債券${b.bond}%` : "", b.cash > 0 ? `預金${b.cash}%` : "", b.other > 0 ? `その他${b.other}%` : ""].filter((x) => x !== "");
  return `${parts.join("・")}（年${r}）`;
}

function mixItems(wh: WorkingHousehold): MovableItem[] {
  const req = wh.request;
  return (req.input.household.accounts ?? [])
    .filter((a) => MIX_KINDS.has(a.kind))
    .map((a) => {
      const kindLabel = ACCOUNT_KINDS.find((o) => o.value === a.kind)?.label ?? "口座";
      const find = (w: WorkingHousehold) => (w.request.input.household.accounts ?? []).find((x) => x.id === a.id);
      return {
        key: `mix:${a.id}`,
        item: "account.assetMix",
        target: { object: a.id },
        label: `資産運用の配分（${kindLabel}・${memberLabel(wh, a.owner)}）`,
        short: "配分",
        group: "よく使う",
        builtin: false,
        phase: "field" as const,
        control: { kind: "mix" as const, accountKind: a.kind },
        read: (w: WorkingHousehold) => {
          const m = find(w)?.assetMix;
          return m === undefined || m.length === 0 ? null : m.map((x) => ({ assetClass: x.assetClass, share: x.share }));
        },
        apply: (w: WorkingHousehold, v: ItemValue) =>
          mutate(w, (hh) => {
            const x = (hh.accounts ?? []).find((y) => y.id === a.id);
            if (x === undefined) return;
            if (v === null || !Array.isArray(v) || v.length === 0) delete x.assetMix;
            else x.assetMix = (v as MixPart[]).map((m) => ({ assetClass: m.assetClass, share: m.share }));
          }),
        text: (v: ItemValue) => mixText(req, a.kind, Array.isArray(v) ? (v as MixPart[]) : null),
        same: (x: ItemValue, y: ItemValue) => jsonSame(Array.isArray(x) && x.length === 0 ? null : x, Array.isArray(y) && y.length === 0 ? null : y),
        note: () => `残高 ${manText(a.marketValue?.value ?? 0)}。利回りは「前提条件」の資産の種類ごとの利回り（無い種類は運用利回り）`,
      };
    });
}

// ---- 入力の項目の定義から作る項目 ----

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/;
const NUMERIC = new Set(["yen", "int", "pct", "decimal"]);

export function fieldText(f: FieldDef, v: ItemValue): string {
  if (v === null || v === undefined) return "なし";
  if (f.kind === "yen") {
    const n = Number(v);
    const per = f.basis === "monthly" ? "月" : f.basis === "annual" ? "年" : "";
    return `${per}${n % MAN === 0 || Math.abs(n) >= MAN * 10 ? manText(n) : `${group(n)}円`}`;
  }
  if (f.kind === "pct") return `${pctFromRate(String(v))}%`;
  if ((f.kind === "int" || f.kind === "decimal") && f.suffix !== undefined) return `${String(v)}${f.suffix}`;
  return String(v);
}

const numberOr = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

function fieldItems(wh: WorkingHousehold, stages: StageDef[], skip: Set<string>): MovableItem[] {
  const members = new Set(wh.request.input.household.members.map((m) => m.id));
  const out: MovableItem[] = [];
  stages.forEach((stage, i) => {
    const stageLabel = STAGE_ORDER[i]?.label ?? stage.label;
    for (const section of stage.sections)
      for (const g of section.groups)
        for (const f of g.fields) {
          if (!NUMERIC.has(f.kind) || f.readOnly !== undefined || f.structural === true || skip.has(f.key)) continue;
          const id = UUID.exec(f.key)?.[0];
          const target: DiffTarget = id === undefined ? { plan: "assumptions" } : members.has(id) ? { member: id } : { object: id };
          const where = g.title ?? section.title;
          out.push({
            key: `field:${f.key}`,
            item: f.item ?? "screen",
            target,
            label: where !== undefined && where !== f.label ? `${where}: ${f.label}` : f.label,
            short: f.label,
            group: stageLabel,
            builtin: false,
            phase: "field",
            control: { kind: "field", field: f, ...(f.kind === "yen" ? { slider: { ...fieldAmountRange(f.basis, numberOr(f.get(wh).value)), step: AMOUNT_STEP, per: f.basis === "monthly" ? ("月" as const) : f.basis === "annual" ? ("年" as const) : ("" as const) } } : {}) },
            read: (w) => f.get(w).value as ItemValue,
            apply: (w, v) => f.set(w, v as number | string | null),
            text: (v) => fieldText(f, v),
            same: (a, b) => (f.kind === "pct" || f.kind === "decimal" ? sameRate(a as string | null, b as string | null) : a === b),
          });
        }
  });
  return out;
}

/** 現状の世帯の要求の入力 → 動かす項目のキー（差分を動かす項目のキーに戻すとき、一覧にある鍵を選ぶため。plans.ts の diffKey） */
const CATALOG_KEYS = new WeakMap<object, ReadonlySet<string>>();
export function catalogKeysOf(input: object): ReadonlySet<string> | undefined {
  return CATALOG_KEYS.get(input);
}

/** 動かす項目の一覧を作る（現状の世帯から。現状が変わったら作り直す） */
export function buildCatalog(wh: WorkingHousehold, selfId: string, demo: DemoHousehold | null): Catalog {
  const cat = buildCatalogOf(wh, selfId, demo);
  CATALOG_KEYS.set(wh.request.input, new Set(cat.items.map((i) => i.key)));
  return cat;
}

function buildCatalogOf(wh: WorkingHousehold, selfId: string, demo: DemoHousehold | null): Catalog {
  const h = wh.request.input.household;
  const base = readLevers(wh.request, selfId);
  // 対策・よく使う項目と同じものを動かす入力の欄は、一覧に重ねて出さない
  const skip = new Set<string>();
  const living = (h.livingExpenses ?? []).find((l) => l.mode === "total");
  if (living !== undefined && base.livingMonthly !== undefined) skip.add(`living/${living.id}/monthly`);
  const nisa = (h.accounts ?? []).find((a) => a.kind === "nisa" && a.owner === selfId);
  if (nisa !== undefined && base.nisaMonthly !== undefined) skip.add(`sav/${nisa.id}/monthly`);
  for (const d of h.debts ?? []) {
    if (d.kind !== "mortgage") continue;
    skip.add(`housing/debt/${d.id}/rate`);
    skip.add(`housing/debt/${d.id}/principal`);
  }
  // 資産運用の項目と同じものを動かす入力の欄（積立をやめる年齢・まとめた器の欄）は重ねて出さない
  skip.add("sav/stopAge");
  // 黒字の貯まり方の項目と同じ欄（0031。基本生活費のカードの欄）
  skip.add("living/surplus/ratio");
  // 本人の「働く最後の年齢（現状の予定）」の欄は、対策の「働く最後の年齢」と同じものを動かす。欄を足すと同じ値の部品が2つ並び、
  // 欄で入れた値は対策のつまみの値（欄の後に当てる）で上書きされて効かないため、一覧に出さない
  if (base.retireAge !== undefined) skip.add(`work/${selfId}/retireAge`);
  // 年収（賞与込み）の欄は2つの値（年収・賞与）の合計を見せる欄なので、動かす項目にはしない（差分は年収・賞与の当て先に付き、
  // 働き方の期間の年収・賞与の欄が動かす項目になる。0078）
  for (const m of h.members) skip.add(`work/${m.id}/now/total`);
  const items = [...leverItems(wh, selfId, demo), ...feeItem(wh), ...investItems(wh), ...surplusItems(wh), ...loanItems(wh), ...mixItems(wh), ...fieldItems(wh, buildStages(wh), skip)];
  return { selfId, items, byKey: new Map(items.map((i) => [i.key, i])) };
}

/** 定年後の予定の条件（働く最後の年齢を延ばすときの働き方） */
export function reemploymentFor(wh: WorkingHousehold, selfId: string) {
  return reemploymentOf(wh.postRetirement[selfId]);
}

/** 全部の欄（テスト用） */
export function numericFieldCount(stages: StageDef[]): number {
  return stages.flatMap((s) => allFields(s)).filter((f) => NUMERIC.has(f.kind) && f.readOnly === undefined).length;
}
