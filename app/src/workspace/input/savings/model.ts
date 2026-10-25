// 資産運用（入力の「貯蓄・運用」のパネル。0026）の作業の層の決まり: 入れ方（合計／口座／資産配分）の切り替え、期間を分けた積立、
// 積立をやめる年、まとめた金融資産の器（合計の入れ方・まだ口座に分けていない分）、資産配分、iDeCo・企業型DC の受け取り。
// どれも世帯の要求（0008 の形）を読み書きする。計算はエンジン（engine/investment.ts・plan.cashflow）が行い、ここは入力の形を整えるのと、
// 画面に添える見込み（NISA の枠を使い切る年・受け取りの概算）だけを出す
import type { Account, EngineRequest, Household, InvestmentSetting, Member, Timepoint } from "../../../engine/types.ts";
import { addMonths, ageAt, ageReachedMonth, parseYm, readLevers } from "../../levers.ts";
import { expectedReturn } from "../../plans/allocation.ts";
import { resolveTimepoint } from "../form.ts";
import { confirmedBox, mutate, newId, type WorkingHousehold } from "../household.ts";

export type Method = "total" | "accounts" | "allocation";
export const METHODS: readonly { id: Method; label: string; lead: string }[] = [
  { id: "total", label: "合計", lead: "金融資産をまとめて1つで入れます（合計・毎月の積立・平均の利回り）。" },
  { id: "accounts", label: "口座", lead: "預金・NISA・iDeCo・企業型DC・課税口座ごとに入れます。" },
  { id: "allocation", label: "資産配分", lead: "口座ごとの値に、株・債券などの割合と期待リターンを入れます。" },
];

/** 金融資産に入れない器（不動産・その他の資産・保険） */
export const NOT_FINANCIAL: ReadonlySet<string> = new Set(["realEstate", "otherAsset", "insurance"]);
/** 積立の終わりを書き換えない器（加入の決まりで止まる） */
export const DC_KINDS: ReadonlySet<string> = new Set(["ideco", "corporateDc"]);
/** 運用する器（資産配分を当てる。エンジンの INVEST_KINDS のうち、まとめた金融資産の器を除く） */
export const INVEST_KINDS: ReadonlySet<string> = new Set(["taxable", "nisa", "childNisa", "juniorNisa", "legacyNisa", "ideco", "corporateDc", "esop"]);

/** 口座の表の並びと名前・説明 */
export const KIND_INFO: Record<string, { name: string; memo: string; color: string }> = {
  deposit: { name: "預金", memo: "普通・定期。いつでも引き出せる", color: "#cad2dd" },
  nisa: { name: "NISA", memo: "つみたて投資枠 年120万円・成長投資枠 年240万円。生涯の枠1,800万円（簿価）", color: "#8ea7d5" },
  ideco: { name: "iDeCo", memo: "受け取り方は下の欄で", color: "#a8c59e" },
  corporateDc: { name: "企業型DC（会社の掛金）", memo: "受け取り方は下の欄で", color: "#7aa56f" },
  taxable: { name: "課税口座（特定口座）", memo: "利益に約20%の税", color: "#e2cd9b" },
  zaikei: { name: "財形貯蓄", memo: "勤め先の給与天引き", color: "#c8cfa8" },
  esop: { name: "持株会", memo: "勤め先の株", color: "#d9b8a0" },
  fxDeposit: { name: "外貨預金", memo: "為替で増減", color: "#b8c6d6" },
  childNisa: { name: "こどもNISA", memo: "お子さまの名義", color: "#a9bce0" },
  legacyNisa: { name: "旧NISA", memo: "非課税期間が終わると課税口座へ", color: "#9fb0cf" },
  juniorNisa: { name: "ジュニアNISA", memo: "お子さまの名義", color: "#9fb0cf" },
  smallBusinessMutualAid: { name: "小規模企業共済", memo: "掛金は所得控除", color: "#c2b59b" },
  pooled: { name: "まだ分けていない", memo: "合計の入れ方で入れた値のうち、まだ口座に分けていない分。口座に入れると減り、0になると消えます", color: "#ddd6e8" },
};
const KIND_ORDER = ["deposit", "nisa", "childNisa", "legacyNisa", "juniorNisa", "ideco", "corporateDc", "taxable", "zaikei", "esop", "fxDeposit", "smallBusinessMutualAid"];

const MAN = 10000;

export const isFinancial = (a: Account) => !NOT_FINANCIAL.has(a.kind);
export const accountsOf = (h: Household) => (h.accounts ?? []).filter((a) => isFinancial(a) && a.kind !== "pooled").sort((a, b) => KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind));
export const pooledOf = (h: Household): Account | undefined => (h.accounts ?? []).find((a) => a.kind === "pooled");
export const investmentOf = (req: EngineRequest): InvestmentSetting => (req.input.assumptions?.investment as InvestmentSetting | undefined) ?? {};
export const methodOf = (req: EngineRequest): Method => investmentOf(req).method ?? "accounts";
export const valueOf = (a: Account | undefined) => a?.marketValue?.value ?? 0;
export const selfOf = (h: Household): Member | undefined => h.members.find((m) => m.kind === "self");

/** 前提 investment を書き換える（空になった欄は消す） */
export function setInvestment(req: EngineRequest, patch: Partial<InvestmentSetting>): void {
  const a = (req.input.assumptions ??= { investmentReturn: { default: "0.01" } });
  const next: Record<string, unknown> = { ...(a.investment ?? {}), ...patch };
  for (const [k, v] of Object.entries(next)) if (v === undefined) delete next[k];
  if (Object.keys(next).length === 0) delete a.investment;
  else a.investment = next as InvestmentSetting;
}

// ---- 期間を分けた積立 ----

/** 積立の期間1つ（始まりの年齢と毎月の額）。終わりは次の期間の始まりの前の月か、積立をやめる年 */
export interface Step {
  fromAge: number;
  monthly: number;
}

/** NISA の枠（tranche）。NISA 以外は "all" */
export type Tranche = "tsumitate" | "growth" | "all";
const trancheOf = (c: { tranche?: string }): Tranche => (c.tranche === "growth" ? "growth" : "tsumitate");
/** その枠の積立か（企業型DC は会社の掛金も含めて1つの期間の並びで見る。ほかは本人が払う分だけ） */
const sameTranche = (a: Account, c: { tranche?: string; payer?: string }, t: Tranche) => (c.payer !== "employer" || a.kind === "corporateDc") && (t === "all" || a.kind !== "nisa" || trancheOf(c) === t);

/** 器の名義の人（無ければ本人） */
export function ownerOf(h: Household, a: Account): Member | undefined {
  return h.members.find((m) => m.id === a.owner) ?? selfOf(h);
}

/** 積立の期間（年齢の昇順）。最初の期間の始まりは今の年齢にそろえる */
export function stepsOf(h: Household, base: string, a: Account, t: Tranche = "all"): Step[] {
  const owner = ownerOf(h, a);
  if (owner === undefined) return [];
  const now = ageAt(owner, base);
  const list = (a.contributions ?? [])
    .filter((c) => sameTranche(a, c, t))
    .map((c) => ({ from: resolveTimepoint(h, c.from) ?? base, monthly: c.monthly }))
    .sort((x, y) => (x.from < y.from ? -1 : 1));
  const out: Step[] = [];
  for (const c of list) {
    const age = Math.max(now, ageAt(owner, c.from < base ? base : c.from));
    const last = out.at(-1);
    if (last !== undefined && last.fromAge === age) last.monthly = c.monthly;
    else out.push({ fromAge: age, monthly: c.monthly });
  }
  if (out.length > 0) (out[0] as Step).fromAge = now;
  return out;
}

/** 器のその年齢の毎月の積立（NISA はつみたて投資枠と成長投資枠を足す。会社の掛金は含めない） */
export function accountMonthlyAt(h: Household, base: string, a: Account, age: number): number {
  if (a.kind === "corporateDc") return 0;
  const tranches: Tranche[] = a.kind === "nisa" ? ["tsumitate", "growth"] : ["all"];
  return tranches.reduce((s, t) => s + monthlyAt(stepsOf(h, base, a, t), age), 0);
}

/** その年齢の毎月の積立（期間から） */
export function monthlyAt(steps: readonly Step[], age: number): number {
  let m = 0;
  for (const s of steps) if (age >= s.fromAge) m = s.monthly;
  return m;
}

/** 積立をやめる月（本人の年齢。null は空欄＝退職の月まで） */
export function stopMonth(h: Household, age: number | null): string | null {
  const self = selfOf(h);
  return age === null || self === undefined ? null : addMonths(ageReachedMonth(self, age), -1);
}

/** 期間を積立の予定（contributions）に書き戻す。その枠のほかの予定は残す */
export function writeSteps(h: Household, base: string, a: Account, t: Tranche, steps: readonly Step[], stopAge: number | null): void {
  const owner = ownerOf(h, a);
  if (owner === undefined) return;
  const keep = (a.contributions ?? []).filter((c) => !sameTranche(a, c, t));
  // iDeCo・企業型DC は加入の決まりで止まるので、終わりは空のまま（積立をやめる年を当てない）
  const stop = DC_KINDS.has(a.kind) ? null : stopMonth(h, stopAge);
  const payer = a.kind === "corporateDc" ? ((a.contributions ?? []).find((c) => sameTranche(a, c, t))?.payer ?? "employer") : undefined;
  const sorted = [...steps].sort((x, y) => x.fromAge - y.fromAge);
  const made = sorted.map((s, i) => {
    const from = i === 0 ? base : ageReachedMonth(owner, s.fromAge);
    const next = sorted[i + 1];
    let to: string | null = next === undefined ? stop : addMonths(ageReachedMonth(owner, next.fromAge), -1);
    if (stop !== null && to !== null && to > stop) to = stop;
    return { from: { at: from } as Timepoint, to: to === null ? null : ({ at: to } as Timepoint), monthly: s.monthly, ...(a.kind === "nisa" && t === "growth" ? { tranche: "growth" } : {}), ...(payer !== undefined ? { payer } : {}) };
  });
  a.contributions = [...keep, ...made.filter((c) => c.monthly > 0 || made.length === 1)];
  if (a.contributions.length === 1 && (a.contributions[0] as { monthly: number }).monthly === 0 && keep.length === 0) a.contributions = [];
}

/** 積立をやめる年（本人の年齢）。口座・枠ごとの最後の期間の終わりのうち、空のものが1つでもあれば null（退職の年まで・推定） */
export function stopAgeOf(h: Household): number | null {
  const self = selfOf(h);
  if (self === undefined) return null;
  let last: string | null = null;
  for (const a of h.accounts ?? []) {
    if (DC_KINDS.has(a.kind) || !isFinancial(a)) continue;
    const tranches: Tranche[] = a.kind === "nisa" ? ["tsumitate", "growth"] : ["all"];
    for (const t of tranches) {
      const list = (a.contributions ?? []).filter((c) => sameTranche(a, c, t) && c.monthly > 0);
      if (list.length === 0) continue;
      const tail = list.reduce((x, y) => ((resolveTimepoint(h, y.from) ?? "") > (resolveTimepoint(h, x.from) ?? "") ? y : x));
      const to = resolveTimepoint(h, tail.to);
      if (to === null) return null;
      if (last === null || to > last) last = to;
    }
  }
  return last === null ? null : ageAt(self, addMonths(last, 1));
}

/** 積立をやめる年を、すべての積立（iDeCo・企業型DC を除く）に当てる（空なら終わりを空にする＝退職の年まで） */
export function setStopAge(h: Household, base: string, age: number | null): void {
  for (const a of h.accounts ?? []) {
    if (DC_KINDS.has(a.kind) || !isFinancial(a) || (a.contributions ?? []).length === 0) continue;
    const tranches: Tranche[] = a.kind === "nisa" ? ["tsumitate", "growth"] : ["all"];
    for (const t of tranches) {
      const steps = stepsOf(h, base, a, t);
      if (steps.length > 0) writeSteps(h, base, a, t, steps, age);
    }
  }
}

/** 退職の年齢（本人） */
export function retireAgeOf(req: EngineRequest): number | null {
  const self = selfOf(req.input.household);
  return self === undefined ? null : (readLevers(req, self.id).retireAge ?? null);
}

const WORKING: ReadonlySet<string> = new Set(["regular", "contract", "partTime", "civilServant", "executive", "selfEmployed"]);

/** 本人の退職の月（エンジンと同じ読み方: 退職のイベントか、最後の働き方の期間の終わり。終わりの無い働き方なら null、分からなければ undefined） */
function retirementMonthOf(h: Household, member: string): string | null | undefined {
  const ev = (h.events ?? []).find((e) => e.kind === "retirement" && e.member === member);
  if (ev !== undefined) return resolveTimepoint(h, ev.at) ?? undefined;
  let last: string | undefined;
  for (const p of h.employmentPeriods ?? []) {
    if (p.member !== member || !WORKING.has(p.type)) continue;
    const t = resolveTimepoint(h, p.to);
    if (t === null) return null;
    if (last === undefined || t > last) last = t;
  }
  return last;
}

/** 積立をやめる年齢（本人）が空欄のときの推定と、その説明（0026。エンジンの読み方と同じ） */
export interface StopEstimate {
  age: number;
  /** もう退職している（退職の月が計算基準月より前） */
  retired: boolean;
  /** 「〜まで積み立てる」の「〜」 */
  until: string;
}

export function stopEstimateOf(req: EngineRequest): StopEstimate {
  const h = req.input.household;
  const self = selfOf(h);
  const r = retireAgeOf(req) ?? 65;
  const base = req.input.baseMonth;
  const ret = self === undefined ? undefined : retirementMonthOf(h, self.id);
  if (self === undefined || ret === undefined || ret === null || ret >= base) return { age: r, retired: false, until: `退職の年（${r}歳）` };
  // もう退職した人: 取り崩しを始める前まで。取り崩しの予定が無いか、始まりが今より前なら表の最後まで
  const dd = investmentOf(req).drawdown;
  const start = dd === undefined ? null : resolveTimepoint(h, dd.start);
  if (start !== null && start > base) {
    const age = ageAt(self, start);
    return { age, retired: true, until: `取り崩しを始める前（${age}歳）` };
  }
  return { age: ageAt(self, `${req.input.endYear}-12`) + 1, retired: true, until: "最後" };
}

/** 積立をやめる年齢（本人）。空欄なら推定 */
export function stopAgeOrEstimate(req: EngineRequest): number {
  return stopAgeOf(req.input.household) ?? stopEstimateOf(req).age;
}

// ---- 利回り ----

/** 器の利回り（FP が入れた値か、資産の配分・前提から。10進の文字列） */
export function rateOf(req: EngineRequest, a: Account): string {
  if (a.expectedReturn !== undefined) return a.expectedReturn;
  return expectedReturn(req, a, parseYm(req.input.baseMonth).y + 1);
}

// ---- 合計の入れ方とまだ分けていない分 ----

/** 今の月から表の最後の年までの、月ごとの本人の積立（器の一覧から） */
function monthlyByMonth(h: Household, base: string, end: string, list: readonly Account[], stop: string | null): Map<string, number> {
  const out = new Map<string, number>();
  for (const a of list) {
    for (const c of a.contributions ?? []) {
      if (c.payer === "employer" || c.monthly <= 0) continue;
      const from = resolveTimepoint(h, c.from) ?? base;
      const to = resolveTimepoint(h, c.to) ?? (DC_KINDS.has(a.kind) ? end : (stop ?? end));
      for (let m = from < base ? base : from; m <= to && m <= end; m = addMonths(m, 1)) out.set(m, (out.get(m) ?? 0) + c.monthly);
    }
  }
  return out;
}

/** 月ごとの額を、本人の年齢の期間にまとめる（今の年齢から） */
function stepsFromMonthly(h: Household, base: string, monthly: Map<string, number>, untilAge: number): Step[] {
  const self = selfOf(h);
  if (self === undefined) return [];
  const now = ageAt(self, base);
  const out: Step[] = [];
  for (let age = now; age < Math.max(untilAge, now + 1); age++) {
    const m = age === now ? base : ageReachedMonth(self, age);
    const v = Math.round(monthly.get(m) ?? 0);
    const last = out.at(-1);
    if (last === undefined || last.monthly !== v) out.push({ fromAge: age, monthly: v });
  }
  return out.length > 0 ? out : [{ fromAge: now, monthly: 0 }];
}

export interface Unallocated {
  value: number;
  steps: Step[];
  rate: string;
}

/** まだ口座に分けていない分（口座・資産配分の入れ方で、まとめた器がある世帯）。無ければ null */
export function unallocatedOf(req: EngineRequest): Unallocated | null {
  const h = req.input.household;
  const p = pooledOf(h);
  if (p === undefined) return null;
  const base = req.input.baseMonth;
  const end = `${req.input.endYear}-12`;
  const stopAge = stopAgeOrEstimate(req);
  const stop = stopMonth(h, stopAge);
  const others = accountsOf(h);
  const value = Math.max(0, valueOf(p) - others.reduce((s, a) => s + valueOf(a), 0));
  const mine = monthlyByMonth(h, base, end, [p], stop);
  const theirs = monthlyByMonth(h, base, end, others, stop);
  const rest = new Map<string, number>();
  for (const [m, v] of mine) rest.set(m, Math.max(0, v - (theirs.get(m) ?? 0)));
  const steps = stepsFromMonthly(h, base, rest, stopAge);
  return { value, steps, rate: p.expectedReturn ?? "0.02" };
}

/** まだ分けていない分が残っているか */
export const hasUnallocated = (u: Unallocated | null): boolean => u !== null && (u.value > 0 || u.steps.some((s) => s.monthly > 0));

/** 合計の入れ方で見た値（合計・毎月の積立の期間・平均の利回り） */
export interface TotalView {
  value: number;
  steps: Step[];
  rate: string;
  /** 運用しない分（金額。合計の入れ方のときだけ。入れていなければ null。0031） */
  uninvested: number | null;
}

export function totalViewOf(req: EngineRequest): TotalView {
  const h = req.input.household;
  const p = pooledOf(h);
  if (methodOf(req) === "total" && p !== undefined) return { value: valueOf(p), steps: stepsOf(h, req.input.baseMonth, p), rate: p.expectedReturn ?? "0.02", uninvested: p.uninvested ?? null };
  const base = req.input.baseMonth;
  const end = `${req.input.endYear}-12`;
  const stopAge = stopAgeOrEstimate(req);
  const list = accountsOf(h);
  const un = unallocatedOf(req);
  const unValue = un?.value ?? 0;
  const value = list.reduce((s, a) => s + valueOf(a), 0) + unValue;
  const monthly = monthlyByMonth(h, base, end, list, stopMonth(h, stopAge));
  if (un !== null) {
    const self = selfOf(h);
    for (let m = base; m <= end; m = addMonths(m, 1)) {
      const age = self === undefined ? 0 : ageAt(self, m);
      const v = monthlyAt(un.steps, age);
      if (v > 0 && (self === undefined || age < stopAge)) monthly.set(m, (monthly.get(m) ?? 0) + v);
    }
  }
  // 平均の利回り: 残高で重み（残高が無ければ単純な平均）
  const parts = list.map((a) => ({ v: valueOf(a), r: Number(rateOf(req, a)) }));
  if (un !== null) parts.push({ v: unValue, r: Number(un.rate) });
  const wsum = parts.reduce((s, x) => s + x.v, 0);
  const avg = parts.length === 0 ? 0.02 : wsum > 0 ? parts.reduce((s, x) => s + x.v * x.r, 0) / wsum : parts.reduce((s, x) => s + x.r, 0) / parts.length;
  return { value, steps: stepsFromMonthly(h, base, monthly, stopAge), rate: rateText(avg), uninvested: null };
}

/** 率の小数（0.0374…）を、0.1% の刻みの10進の文字列にする */
export function rateText(r: number): string {
  const per = Math.round(r * 1000);
  const sign = per < 0 ? "-" : "";
  const a = Math.abs(per);
  return `${sign}${Math.floor(a / 1000)}.${String(a % 1000).padStart(3, "0")}`.replace(/\.?0+$/, "") || "0";
}

/** 入れ方を切り替える（入力は消さない。合計にするときは、口座ごとの値を足して合計の器を作り直す） */
export function switchMethod(wh: WorkingHousehold, to: Method): WorkingHousehold {
  const from = methodOf(wh.request);
  if (from === to) return wh;
  return mutate(wh, (h, req) => {
    if (to === "total") {
      const view = totalViewOf({ ...req, input: { ...req.input, assumptions: { ...req.input.assumptions, investment: { ...investmentOf(req), method: from } } } } as EngineRequest);
      let p = pooledOf(h);
      const self = selfOf(h);
      if (p === undefined) {
        p = { id: newId(), kind: "pooled", owner: self?.id ?? h.members[0]?.id ?? "", marketValue: confirmedBox(0), asOf: req.input.baseMonth, contributions: [] };
        (h.accounts ??= []).push(p);
      }
      p.marketValue = confirmedBox(Math.round(view.value));
      p.expectedReturn = view.rate;
      writeSteps(h, req.input.baseMonth, p, "all", view.steps, stopAgeOf(h));
    }
    setInvestment(req, { method: to === "accounts" ? undefined : to });
    if (to !== "total") dropDoneUnallocated(h, req);
  });
}

/** まだ分けていない分が0になったら、まとめた器を外す（外したら true） */
export function dropDoneUnallocated(h: Household, req: EngineRequest): boolean {
  if (methodOf(req) === "total") return false;
  const p = pooledOf(h);
  if (p === undefined) return false;
  if (hasUnallocated(unallocatedOf(req))) return false;
  h.accounts = (h.accounts ?? []).filter((a) => a !== p);
  return true;
}

/** 合計の入れ方の値を書き換える（まとめた器が無ければ作る） */
export function editTotal(wh: WorkingHousehold, patch: { value?: number; rate?: string; steps?: Step[]; uninvested?: number | null }): WorkingHousehold {
  return mutate(wh, (h, req) => {
    let p = pooledOf(h);
    if (p === undefined) {
      const view = totalViewOf(req);
      const self = selfOf(h);
      p = { id: newId(), kind: "pooled", owner: self?.id ?? h.members[0]?.id ?? "", marketValue: confirmedBox(Math.round(view.value)), asOf: req.input.baseMonth, expectedReturn: view.rate, contributions: [] };
      writeSteps(h, req.input.baseMonth, p, "all", view.steps, stopAgeOf(h));
      (h.accounts ??= []).push(p);
    }
    if (patch.value !== undefined) p.marketValue = confirmedBox(Math.max(0, Math.round(patch.value)));
    if (patch.rate !== undefined) p.expectedReturn = patch.rate;
    if (patch.steps !== undefined) writeSteps(h, req.input.baseMonth, p, "all", patch.steps, stopAgeOf(h));
    // 運用しない分（0031。0 と空は外す）
    if (patch.uninvested !== undefined) {
      if (patch.uninvested === null || patch.uninvested <= 0) delete p.uninvested;
      else p.uninvested = Math.round(patch.uninvested);
    }
  });
}

// ---- 資産配分 ----

/** 資産配分の資産の種類（画面の5つ）と、事務所の標準値（仮の値。根拠を確かめて事務所で直す前提） */
export const CLASSES: readonly { key: string; name: string; color: string; risky: boolean; mu: string; sd: string }[] = [
  { key: "equity.domestic", name: "国内株", color: "#2b4c8c", risky: true, mu: "0.05", sd: "0.18" },
  { key: "equity.global", name: "外国株", color: "#5a7fc0", risky: true, mu: "0.06", sd: "0.2" },
  { key: "bond.global", name: "債券", color: "#9db3d9", risky: false, mu: "0.01", sd: "0.05" },
  { key: "reit.global", name: "REIT", color: "#c8a35a", risky: true, mu: "0.04", sd: "0.18" },
  { key: "cash.deposit", name: "現金", color: "#cfd5dd", risky: false, mu: "0.001", sd: "0.005" },
];
/** 相場が下がる場合に下げる資産クラス（株・REIT） */
export const RISKY_CLASSES: readonly string[] = ["equity.domestic", "equity.global", "reit.domestic", "reit.global"];
/** 資産の種類の間の相関（値動きの大きさを組み合わせるときだけに使う。表示用の目安） */
const CORR: readonly (readonly number[])[] = [
  [1, 0.6, 0.1, 0.6, 0],
  [0.6, 1, 0.2, 0.6, 0],
  [0.1, 0.2, 1, 0.3, 0],
  [0.6, 0.6, 0.3, 1, 0],
  [0, 0, 0, 0, 1],
];
export const DEFAULT_MIX: readonly { assetClass: string; share: string }[] = [
  { assetClass: "equity.domestic", share: "0.25" },
  { assetClass: "equity.global", share: "0.4" },
  { assetClass: "bond.global", share: "0.2" },
  { assetClass: "reit.global", share: "0.05" },
  { assetClass: "cash.deposit", share: "0.1" },
];
export const DEFAULT_FEE = "0.0025";

export interface ClassRow {
  key: string;
  name: string;
  color: string;
  /** 割合（%） */
  weight: number;
  /** 期待リターン（10進の文字列）と、FP が入れた値か */
  mu: string;
  muOwn: boolean;
  sd: string;
  sdOwn: boolean;
}

export function classRows(req: EngineRequest): ClassRow[] {
  const inv = investmentOf(req);
  const mix = inv.allocation?.mix ?? DEFAULT_MIX;
  const a = req.input.assumptions;
  return CLASSES.map((c) => {
    const own = a?.assetReturns?.[c.key]?.default;
    const sd = a?.assetVolatility?.[c.key];
    return { key: c.key, name: c.name, color: c.color, weight: Math.round(Number(mix.find((m) => m.assetClass === c.key)?.share ?? "0") * 1000) / 10, mu: own ?? c.mu, muOwn: own !== undefined, sd: sd ?? c.sd, sdOwn: sd !== undefined };
  });
}

export interface Portfolio {
  /** 組み合わせた期待リターン（割合で平均） */
  expected: number;
  fee: number;
  /** 信託報酬を引いた利回り */
  net: number;
  /** 値動きの大きさ（相関の目安で組み合わせた標準偏差） */
  sd: number;
  /** 株などの割合 */
  risky: number;
}

export function portfolioOf(req: EngineRequest): Portfolio {
  const rows = classRows(req);
  const total = rows.reduce((s, r) => s + r.weight, 0) || 1;
  const w = rows.map((r) => r.weight / total);
  const expected = rows.reduce((s, r, i) => s + (w[i] ?? 0) * Number(r.mu), 0);
  let v = 0;
  for (let i = 0; i < rows.length; i++) for (let j = 0; j < rows.length; j++) v += (w[i] ?? 0) * (w[j] ?? 0) * Number(rows[i]?.sd) * Number(rows[j]?.sd) * (CORR[i]?.[j] ?? 0);
  const fee = Number(investmentOf(req).allocation?.fee ?? DEFAULT_FEE);
  const risky = rows.reduce((s, r, i) => s + (CLASSES[i]?.risky === true ? (w[i] ?? 0) : 0), 0);
  return { expected, fee, net: expected - fee, sd: Math.sqrt(v), risky };
}

/** 割合（%の数）を、合計で割った10進の文字列の配分にする（0の種類は外す） */
export function mixFromWeights(weights: readonly { key: string; weight: number }[]): { assetClass: string; share: string }[] {
  const total = weights.reduce((s, x) => s + Math.max(0, x.weight), 0);
  if (total <= 0) return [...DEFAULT_MIX];
  return weights.filter((x) => x.weight > 0).map((x) => ({ assetClass: x.key, share: rateTextFine(x.weight / total) }));
}

/** 率の小数を、小数4桁までの10進の文字列にする */
function rateTextFine(r: number): string {
  const n = Math.round(r * 10000);
  return n >= 10000 ? "1" : `0.${String(n).padStart(4, "0")}`.replace(/0+$/, "").replace(/\.$/, "") || "0";
}

/** 資産配分を書き換える（まだ無ければ既定から始める） */
export function editAllocation(req: EngineRequest, patch: { mix?: { assetClass: string; share: string }[]; fee?: string; rebalance?: boolean }): void {
  const inv = investmentOf(req);
  const cur = inv.allocation ?? { mix: [...DEFAULT_MIX], fee: DEFAULT_FEE };
  const next = { ...cur, ...patch };
  if (next.rebalance === true) delete next.rebalance;
  setInvestment(req, { allocation: next });
}

// ---- 取り崩しの順番 ----

/** 取り崩しの順番の3つのまとまり（器の種類） */
export const ORDER_GROUPS: Record<string, { name: string; kinds: string[] }> = {
  dep: { name: "預金", kinds: ["deposit", "fxDeposit", "zaikei"] },
  tax: { name: "課税口座", kinds: ["taxable", "esop"] },
  nisa: { name: "NISA", kinds: ["legacyNisa", "nisa"] },
};
export const DEFAULT_ORDER = ["dep", "tax", "nisa"];

export function orderOf(req: EngineRequest): string[] {
  const o = req.input.assumptions?.withdrawal?.order;
  if (o === undefined) return [...DEFAULT_ORDER];
  const out: string[] = [];
  for (const x of o) {
    const g = "kind" in x ? Object.entries(ORDER_GROUPS).find(([, v]) => v.kinds.includes(x.kind))?.[0] : undefined;
    if (g !== undefined && !out.includes(g)) out.push(g);
  }
  for (const g of DEFAULT_ORDER) if (!out.includes(g)) out.push(g);
  return out;
}

export function setOrder(req: EngineRequest, groups: readonly string[]): void {
  const a = (req.input.assumptions ??= { investmentReturn: { default: "0.01" } });
  const w = { ...(a.withdrawal ?? {}) };
  if (groups.join() === DEFAULT_ORDER.join()) delete w.order;
  else w.order = groups.flatMap((g) => (ORDER_GROUPS[g]?.kinds ?? []).map((kind) => ({ kind })));
  if (Object.keys(w).length === 0) delete a.withdrawal;
  else a.withdrawal = w;
}

// ---- NISA の枠の見込み ----

/** NISA の枠（画面の知らせだけに使う目安。計算はエンジンの制度データ） */
const NISA = { tsumitate: 1_200_000, growth: 2_400_000, lifetime: 18_000_000, growthLifetime: 12_000_000 };

export interface NisaHit {
  year: number;
  age: number | null;
  kind: "lifetime" | "annual";
  /** その年に枠に入らない額 */
  over: number;
}

/**
 * NISA の枠を使い切る年の見込み（本人と配偶者の NISA。売った分の枠の復活は数えない）。つみたて投資枠の年120万円を超えた分は成長投資枠へ
 */
export function nisaHitOf(req: EngineRequest): NisaHit | null {
  const h = req.input.household;
  const base = req.input.baseMonth;
  const end = `${req.input.endYear}-12`;
  const stop = stopMonth(h, stopAgeOrEstimate(req));
  let best: NisaHit | null = null;
  for (const a of (h.accounts ?? []).filter((x) => x.kind === "nisa")) {
    const owner = ownerOf(h, a);
    let used = (a.frame as { lifetimeUsedCost?: number } | undefined)?.lifetimeUsedCost ?? a.costBasis?.value ?? valueOf(a);
    let usedG = (a.frame as { growthUsedCost?: number } | undefined)?.growthUsedCost ?? 0;
    const by = new Map<number, { t: number; g: number }>();
    for (const c of a.contributions ?? []) {
      const from = resolveTimepoint(h, c.from) ?? base;
      const to = resolveTimepoint(h, c.to) ?? stop ?? end;
      for (let m = from < base ? base : from; m <= to && m <= end; m = addMonths(m, 1)) {
        const y = parseYm(m).y;
        const e = by.get(y) ?? { t: 0, g: 0 };
        if (trancheOf(c) === "growth") e.g += c.monthly;
        else e.t += c.monthly;
        by.set(y, e);
      }
    }
    for (const y of [...by.keys()].sort((p, q) => p - q)) {
      const e = by.get(y) as { t: number; g: number };
      let t = Math.min(e.t, NISA.tsumitate);
      let g = e.g + (e.t - t);
      let over = 0;
      let kind: NisaHit["kind"] | null = null;
      if (g > NISA.growth) {
        over += g - NISA.growth;
        g = NISA.growth;
        kind = "annual";
      }
      const room = Math.max(0, NISA.lifetime - used);
      if (t > room) {
        over += t - room;
        t = room;
        kind = "lifetime";
      }
      const roomG = Math.min(room - t, Math.max(0, NISA.growthLifetime - usedG));
      if (g > roomG) {
        over += g - roomG;
        g = roomG;
        kind = "lifetime";
      }
      used += t + g;
      usedG += g;
      if (kind !== null && over > 0) {
        if (best === null || y < best.year) best = { year: y, age: owner === undefined ? null : y - parseYm(owner.birth.birthYearMonth).y, kind, over };
        break;
      }
    }
  }
  return best;
}

// ---- iDeCo・企業型DC の受け取り ----

export type PayoutMethod = "lumpSum" | "annuity" | "mixed";
export const PAYOUT_METHODS: readonly { id: PayoutMethod; label: string }[] = [
  { id: "lumpSum", label: "一時金" },
  { id: "annuity", label: "年金（10年）" },
  { id: "mixed", label: "併用（半分ずつ）" },
];

/** 受け取りを始める年齢の推定（退職の年。60〜65歳に収める） */
export function defaultPayoutAge(req: EngineRequest, a: Account): number {
  const h = req.input.household;
  const owner = ownerOf(h, a);
  const self = selfOf(h);
  const retire = owner !== undefined && owner.id !== self?.id ? (readLevers(req, owner.id).retireAge ?? retireAgeOf(req)) : retireAgeOf(req);
  return Math.min(65, Math.max(60, retire ?? 65));
}

/** 受け取りを始める年齢（入れていれば。空欄は null） */
export function payoutAgeOf(h: Household, a: Account): number | null {
  const owner = ownerOf(h, a);
  const at = resolveTimepoint(h, a.payout?.start);
  return at === null || owner === undefined ? null : ageAt(owner, at);
}

/** 受け取りの欄を書き換える（受け取り方を空にすると、ほかの欄も外して推定に戻す） */
export function editPayout(h: Household, a: Account, patch: { method?: PayoutMethod | null; age?: number | null; destination?: "deposit" | "invest" }): void {
  const owner = ownerOf(h, a);
  if (patch.method === null) {
    delete a.payout;
    return;
  }
  if (a.payout === undefined && patch.method === undefined && (patch.age === null || patch.destination === "deposit")) return;
  const cur = a.payout ?? { method: "lumpSum" as PayoutMethod };
  const next: NonNullable<Account["payout"]> = { ...cur };
  if (patch.method !== undefined) {
    next.method = patch.method;
    if (patch.method === "mixed") next.lumpShare = "0.5";
    else delete next.lumpShare;
    if (patch.method !== "lumpSum") next.annuityYears ??= 10;
    else delete next.annuityYears;
  }
  if (patch.age !== undefined) {
    if (patch.age === null || owner === undefined) delete next.start;
    else {
      // 年齢で決めた時点（memberAge）は、同じ形のまま年齢だけ変える
      const ma = (cur.start as { memberAge?: { member: string; years: number } } | undefined)?.memberAge;
      next.start = ma !== undefined ? ({ memberAge: { ...ma, years: patch.age } } as Timepoint) : { at: ageReachedMonth(owner, patch.age) };
    }
  }
  if (patch.destination !== undefined) {
    if (patch.destination === "deposit") delete next.destination;
    else next.destination = patch.destination;
  }
  a.payout = next;
}

/** 受け取る額の概算（年1回の複利で、受け取りの年齢までの残高。税は一時金0・年金5%の目安） */
export function payoutEstimate(req: EngineRequest, a: Account): { age: number; balance: number; lump: number; annual: number; years: number } {
  const h = req.input.household;
  const owner = ownerOf(h, a);
  const base = req.input.baseMonth;
  const age = payoutAgeOf(h, a) ?? defaultPayoutAge(req, a);
  const now = owner === undefined ? age : ageAt(owner, base);
  const r = Number(rateOf(req, a));
  const steps = stepsOf(h, base, { ...a, contributions: (a.contributions ?? []).map((c) => ({ ...c, payer: "self" as const })) });
  let v = valueOf(a);
  for (let x = now; x < age; x++) v = v * (1 + r) + monthlyAt(steps, x) * 12 * (1 + r / 2);
  const method = a.payout?.method ?? "lumpSum";
  const years = a.payout?.annuityYears ?? 10;
  const lump = method === "lumpSum" ? v : method === "mixed" ? v / 2 : 0;
  const annual = method === "lumpSum" ? 0 : ((v - lump) / years) * 0.95;
  return { age, balance: v, lump, annual, years };
}

// ---- 取り崩しの計画 ----

export interface DrawdownView {
  method: "none" | "fixed" | "rate";
  startAge: number;
  monthly: number;
  rate: string;
}

export function drawdownOf(req: EngineRequest): DrawdownView {
  const h = req.input.household;
  const self = selfOf(h);
  const dd = investmentOf(req).drawdown;
  if (dd === undefined || self === undefined) return { method: "none", startAge: 65, monthly: 15 * MAN, rate: "0.04" };
  const at = resolveTimepoint(h, dd.start) ?? req.input.baseMonth;
  return { method: dd.method, startAge: ageAt(self, at), monthly: dd.monthly ?? 15 * MAN, rate: dd.rate ?? "0.04" };
}

/** 本人が次に迎える年齢（その年齢に達する月が計算の基準の月より前なら、次の年齢）。取り崩しを始める年齢の下限 */
export function nextAgeOf(req: EngineRequest): number | null {
  const self = selfOf(req.input.household);
  if (self === undefined) return null;
  const now = ageAt(self, req.input.baseMonth);
  return ageReachedMonth(self, now) >= req.input.baseMonth ? now : now + 1;
}

/**
 * 取り崩しを始める年齢の初めの値: 予定があればその年齢、無ければ65歳か退職の年齢の遅い方。
 * どちらも過ぎた年齢（受給中の世帯など）なら、次に迎える年齢にする
 */
export function drawdownStartDefault(req: EngineRequest): number {
  const d = drawdownOf(req);
  const age = d.method === "none" ? Math.max(65, retireAgeOf(req) ?? 65) : d.startAge;
  const next = nextAgeOf(req);
  return next !== null && age < next ? next : age;
}

export function setDrawdown(req: EngineRequest, v: DrawdownView): void {
  const self = selfOf(req.input.household);
  if (v.method === "none" || self === undefined) {
    setInvestment(req, { drawdown: undefined });
    return;
  }
  setInvestment(req, { drawdown: { start: { at: ageReachedMonth(self, v.startAge) }, method: v.method, ...(v.method === "fixed" ? { monthly: Math.max(0, Math.round(v.monthly)) } : { rate: v.rate }) } });
}
