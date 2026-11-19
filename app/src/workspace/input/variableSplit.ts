// 変額保険を「続ける」（A）と「解約して、保障（掛け捨ての保険）と運用（NISA など）に分ける」（B）の比較の試算（0233）。
// 商品を特定せず、おすすめも出さない（比較の試算として並べるだけ）。計算は今の部品のまま（解約の月・掛け捨ての保険の契約・NISA の積立）で、
// 画面の側で B の要求を組み立てる（エンジンに解約したお金の行き先は持たせない）。
// - 解約する月: 選んだ年の1月（計算基準年は計算基準月）。解約返戻金は、その月までに終わった保険年度の数表の額（insurance.policy と同じ）。
//   数表に無ければ FP が入れた額を、B のプランだけ、その保険年度の数表の行として足す
// - 掛け捨ての保険: 定期保険か収入保障保険を、解約の月に契約者・被保険者・受取人を変額保険と同じにして入れる。保険料は FP が入れる（月払い）。
//   保障の額の既定は今の死亡保険金、保障と払込の終わりは被保険者の年齢（既定 65歳。今もう近ければ10年後）
// - 運用: 契約者の名義の NISA の口座を1つ足す（利回りは A と同じ前提にそろえられ、口座の「運用の費用」で信託報酬などを引く）。浮いた保険料（A の保険料−掛け捨ての保険料。マイナスなら
//   積み立てない）を、解約の月から A の払込が終わる前の月まで、つみたて投資枠で毎月。解約返戻金（税を引く前。税は預金から払う。0026 の4 と同じ近似）は、
//   成長投資枠に年ごとの枠の残りまで（解約の年は解約の月、次の年からは1月）。NISA の生涯の枠に入らない分は、解約の月に課税口座へ。
//   枠の数え方はエンジンの NISA の部品と同じ（つみたて投資枠を超えた積立は成長投資枠へ）。名義の人の今の NISA の積立・使った枠も数える
import { SPLIT_CAUTIONS } from "../../../../report/src/variableSplit.ts";
import type { Account, EngineRequest, Household, InsuranceContract, Member, PreviewResult, TableCell, Timepoint } from "../../engine/types.ts";
import { addMonths, ageAt } from "../levers.ts";
import { classRate, expectedReturn } from "../plans/allocation.ts";
import { cmpRate, pctText, subRate } from "../plans/decimal.ts";
import type { Catalog } from "../plans/items.ts";
import { planView, recordPlanEdit } from "../plans/planEdit.ts";
import { resolveTimepoint } from "../timepoint.ts";
import { newId, type WorkingHousehold } from "./household.ts";
import { kindOf } from "./insuranceKinds.ts";
import { CLASSES, defaultFee, investmentOf, methodOf, NISA_LIMITS, stopAgeOrEstimate, stopMonth } from "./savings/model.ts";

const VARIABLE = "insurance.variable";

/** 掛け捨ての保険の種類 */
export type CoverKind = "term" | "incomeProtection";
/** B の運用の利回りの選び方: 数表（設計書）の利回り・資産クラスの前提・入れる */
export type RateKind = "illustrated" | "class" | "custom";

export interface SplitOptions {
  /** 解約する年 */
  year: number;
  cover: CoverKind;
  /** 掛け捨ての保険の保険料（月額。未入力は null） */
  premium: number | null;
  /** 保障の額（定期保険は死亡保険金、収入保障保険は年金月額） */
  amount: number;
  /** 保障と払込の終わり（被保険者の年齢） */
  endAge: number;
  rateKind: RateKind;
  /** 数表（設計書）の運用の利回り（年率の10進。未入力は null） */
  illustrated: string | null;
  /** 資産クラス（前提条件の資産の種類ごとの利回り） */
  assetClass: string;
  /** 入れた利回り（年率の10進。未入力は null） */
  custom: string | null;
  /** 解約返戻金（数表に解約の保険年度の行が無いときに FP が入れる額。null は入れていない） */
  surrenderValue: number | null;
  /** B の運用の費用（信託報酬など。年率の10進。上の利回りから引く。口座の「運用の費用」と同じ） */
  fee: string;
}

/** B で足す物の ID */
export interface SplitIds {
  cover: string;
  coverMain: string;
  nisa: string;
  taxable: string;
}

export const newSplitIds = (): SplitIds => ({ cover: newId(), coverMain: newId(), nisa: newId(), taxable: newId() });

/** 必ず出す注意（提案書の注意書きと同じ文。report/src/variableSplit.ts） */
export { SPLIT_CAUTIONS };

export const COVER_OPTIONS: readonly { value: CoverKind; label: string }[] = [
  { value: "term", label: "定期保険" },
  { value: "incomeProtection", label: "収入保障保険" },
];

/** 資産クラスの選択肢（前提条件の資産の種類のうち、運用する種類） */
export const CLASS_OPTIONS: readonly { value: string; label: string }[] = CLASSES.filter((c) => c.risky || c.key === "bond.global").map((c) => ({ value: c.key, label: c.name }));

// ---- 読むだけの小さな部品 ----

const idx = (ym: string): number => Number(ym.slice(0, 4)) * 12 + Number(ym.slice(5, 7)) - 1;
const yearOf = (ym: string): number => Number(ym.slice(0, 4));
const memberOf = (h: Household, id: string): Member | undefined => h.members.find((m) => m.id === id);

/** 「解約して分けたら」を出す契約（変額保険で、解約の予定がまだ無いもの） */
export function splitTargets(req: EngineRequest): InsuranceContract[] {
  return (req.input.household.insuranceContracts ?? []).filter((c) => c.template === VARIABLE && c.surrender === undefined);
}

/** 合計の入れ方では口座に分けないので、B の運用を分けて計算できない */
export const splitUnavailable = (req: EngineRequest): string | null => (methodOf(req) === "total" ? "貯蓄・運用を「合計」で入れているため、運用の口座を分けて計算できません（口座か資産配分の入れ方で使えます）" : null);

/** 解約する月（選んだ年の1月。計算基準年より前・同じ年は計算基準月） */
export function surrenderYm(req: EngineRequest, year: number): string {
  const base = req.input.baseMonth;
  return year <= yearOf(base) ? base : `${year}-01`;
}

/** 解約する月までに終わった保険年度の数（insurance.policy の解約返戻金と同じ数え方） */
export const yearsDone = (c: InsuranceContract, ym: string): number => Math.floor((idx(ym) - idx(c.contractDate)) / 12);

/** 円の目安の形か（積立金を前提の利回りで伸ばさない形） */
export const isEstimate = (c: InsuranceContract): boolean => c.simple?.estimate === true;

/** 数表に解約返戻金の行があるか */
export const hasSchedule = (c: InsuranceContract): boolean => (c.schedule?.rows ?? []).some((r) => r.surrenderValue !== undefined);

/** 解約する月の数表の解約返戻金（契約から1年未満は0。行が無ければ null） */
export function scheduledSurrender(c: InsuranceContract, ym: string): number | null {
  const py = yearsDone(c, ym);
  if (py <= 0) return 0;
  let found = false;
  let s = 0;
  for (const r of c.schedule?.rows ?? []) {
    if (r.policyYear !== py || r.surrenderValue === undefined) continue;
    found = true;
    s += r.surrenderValue;
  }
  return found ? s : null;
}

/** 解約返戻金を FP が入れる必要があるか（数表に解約の保険年度の行が無い） */
export const needsSurrenderValue = (c: InsuranceContract, ym: string): boolean => scheduledSurrender(c, ym) === null;

/** 払込の終わり（その月から払わない。終身払いは null） */
export const payEndOf = (h: Household, c: InsuranceContract): string | null => resolveTimepoint(h, c.premium.payUntil);

/** A の月の保険料（その月の更新を入れる。年払いは12で割る。一時払い・払込が終わっていれば0） */
export function premiumMonthly(h: Household, c: InsuranceContract, ym: string): number {
  if (c.premium.frequency === "single") return 0;
  const end = payEndOf(h, c);
  if (end !== null && end <= ym) return 0;
  let a = c.premium.amount;
  const rs = (c.renewals ?? []).map((r) => ({ ym: resolveTimepoint(h, r.at), premium: r.premium })).filter((r) => r.ym !== null && r.ym <= ym).sort((x, y) => ((x.ym ?? "") < (y.ym ?? "") ? -1 : 1));
  for (const r of rs) a = r.premium;
  return c.premium.frequency === "annual" ? Math.round(a / 12) : a;
}

/** 基本保険金額（主契約の死亡保障の額） */
export const basicAmount = (c: InsuranceContract): number => (c.coverages ?? []).filter((x) => x.role === "main" && x.benefit === "death").reduce((s, x) => s + x.amount, 0);

/** 既定の選び方（今の死亡保険金は、計算の結果があればその年の額、無ければ基本保険金額） */
export function defaultSplit(req: EngineRequest, c: InsuranceContract, nowDeath?: number): SplitOptions {
  const h = req.input.household;
  const year = yearOf(req.input.baseMonth);
  const ym = surrenderYm(req, year);
  const insured = memberOf(h, c.insured);
  const age = insured === undefined ? 40 : ageAt(insured, ym);
  const cls = c.simple?.assetClass !== undefined && CLASS_OPTIONS.some((o) => o.value === c.simple?.assetClass) ? c.simple.assetClass : "equity.global";
  return {
    year,
    cover: "term",
    premium: null,
    amount: nowDeath !== undefined && nowDeath > 0 ? nowDeath : basicAmount(c),
    endAge: Math.max(65, age + 10),
    rateKind: isEstimate(c) ? "class" : "illustrated",
    illustrated: null,
    assetClass: cls,
    custom: null,
    surrenderValue: null,
    fee: defaultFeeOf(req),
  };
}

/**
 * B の運用の費用の既定（今の作りに合わせる）: 資産配分の入れ方で信託報酬を入れていればその値、ほかは事務所の既定の運用の費用
 * （資産配分の既定と同じ目安 preset.invest.fee）
 */
export const defaultFeeOf = (req: EngineRequest): string => investmentOf(req).allocation?.fee ?? defaultFee();

/**
 * 資産配分の入れ方で配分を入れている世帯は、計算のエンジンが運用する口座の利回りを世帯の資産配分にそろえる（口座の利回りは使わない。0026 の5）ので、
 * B の口座も世帯の資産配分（費用を引く前の期待リターンと、信託報酬。信託報酬が無ければ B の運用の費用）で計算する。ほかの入れ方は null
 */
export function allocationRate(req: EngineRequest, o: SplitOptions): { gross: string; fee: string } | null {
  const inv = investmentOf(req);
  if (methodOf(req) !== "allocation" || inv.allocation === undefined) return null;
  return { gross: expectedReturn(req, { kind: "nisa", assetMix: inv.allocation.mix }, yearOf(req.input.baseMonth) + 1), fee: inv.allocation.fee ?? o.fee };
}

/**
 * 掛け捨ての保険の保障の額の既定: 定期保険は今の死亡保険金、収入保障保険は今の死亡保険金を解約の月から保障の終わりまでの月数で割った
 * 年金月額（千円単位に切り上げ。はじめの受け取りの合計が今の死亡保険金を下回らない）
 */
export function defaultAmount(req: EngineRequest, c: InsuranceContract, cover: CoverKind, year: number, endAge: number, nowDeath: number): number {
  if (cover === "term") return nowDeath;
  const end = resolveTimepoint(req.input.household, { memberAge: { member: c.insured, years: endAge, months: 0 } });
  const months = end === null ? 0 : idx(end) - idx(surrenderYm(req, year));
  return months <= 0 ? 0 : Math.ceil(nowDeath / months / 1000) * 1000;
}

/** 資産クラスの前提の利回り（前提条件の資産の種類ごとの利回り。無ければ運用利回り。計算のエンジンと同じ） */
export const classPremise = (req: EngineRequest, cls: string): string => classRate(req, cls, yearOf(req.input.baseMonth) + 1).rate;

/** A の積立金の利回り（前の入れ方〔円の目安の形でない〕の変額保険。エンジンが積立金を伸ばす利回り） */
export const fundRate = (req: EngineRequest, c: InsuranceContract): string => classRate(req, c.simple?.assetClass ?? "", yearOf(req.input.baseMonth) + 1).rate;

/**
 * B の運用の利回り（費用を引く前。入っていなければ null）。どの選び方も「市場の利回り」の前提で、B はそこから運用の費用を引く
 * （A の数表は、保険の費用を引いた後の解約返戻金なので、同じ利回りの例から、それぞれの費用を引いた形で並ぶ）
 */
export function rateOf(req: EngineRequest, c: InsuranceContract, o: SplitOptions): string | null {
  const alloc = allocationRate(req, o);
  if (alloc !== null) return alloc.gross;
  if (o.rateKind === "class") return classPremise(req, o.assetClass);
  if (o.rateKind === "custom") return o.custom;
  return isEstimate(c) ? o.illustrated : fundRate(req, c);
}

/** B の運用の費用（資産配分の入れ方は世帯の信託報酬） */
export const feeOf = (req: EngineRequest, o: SplitOptions): string => allocationRate(req, o)?.fee ?? o.fee;

/** B の運用の費用を引いた後の利回り（入っていなければ null） */
export function netRateOf(req: EngineRequest, c: InsuranceContract, o: SplitOptions): string | null {
  const g = rateOf(req, c, o);
  return g === null ? null : subRate(g, feeOf(req, o));
}

/** A の解約返戻金・積立金がどの利回りの数字か（数表の利回りを入れていない・数表の無い目安の形は null） */
export const aRateOf = (req: EngineRequest, c: InsuranceContract, o: SplitOptions): string | null => (isEstimate(c) ? (hasSchedule(c) ? o.illustrated : null) : fundRate(req, c));

/** 利回りを並べる行（設計書の利回り・資産クラスの前提・B に使う利回りと費用を引いた後・そろっているか） */
export function rateLines(req: EngineRequest, c: InsuranceContract, o: SplitOptions): string[] {
  const out: string[] = [];
  const pct = (r: string) => pctText(r, 2);
  const aRate = aRateOf(req, c, o);
  if (!isEstimate(c)) out.push(`A の積立金: 年${pct(fundRate(req, c))}の前提で伸ばしています（保険料のうち積立に回らない分を引いた後）`);
  else if (!hasSchedule(c)) out.push("A: 数表（設計書の解約返戻金）が入っていないので、これからの解約返戻金は出せません");
  else out.push(aRate === null ? "A の数表（設計書）の利回り: 未入力（設計書の運用実績の例の利回りを入れてください）" : `A の数表（設計書）: 年${pct(aRate)}の運用の例（解約返戻金は保険の費用を引いた後の額）`);
  const cls = CLASS_OPTIONS.find((x) => x.value === o.assetClass)?.label ?? o.assetClass;
  out.push(`資産クラスの前提: ${cls} 年${pct(classPremise(req, o.assetClass))}（前提条件の利回り。費用を引く前）`);
  const alloc = allocationRate(req, o);
  const b = rateOf(req, c, o);
  const fee = feeOf(req, o);
  const net = netRateOf(req, c, o);
  const head = alloc !== null ? "B の運用の利回り（世帯の資産配分）" : "B の運用の利回り";
  out.push(b === null || net === null ? `${head}: 未入力` : `${head}: 年${pct(b)}−運用の費用 年${pct(fee)}＝費用を引いた後 年${pct(net)}`);
  if (alloc !== null) out.push("資産配分の入れ方のため、B の運用も世帯の資産配分と信託報酬で計算します");
  if (b !== null && aRate !== null && cmpRate(b, aRate) !== 0) out.push("A と B の利回りの前提がそろっていません（そろえると、保険と運用の違いだけを比較できます）");
  out.push("設計書の利回りは運用の例で、約束された値ではありません。高い利回りの例だけで判断しないでください");
  return out;
}

// ---- NISA の枠（名義の人の今の NISA の分を数える） ----

/** 名義の人の今の NISA の使った枠と、年ごとの積立（つみたて投資枠・成長投資枠）。savings/model.ts の nisaHitOf と同じ読み方 */
function nisaUse(req: EngineRequest, owner: string, skip: ReadonlySet<string>): { used: number; usedG: number; byYear: Map<number, { t: number; g: number }> } {
  const h = req.input.household;
  const base = req.input.baseMonth;
  const end = `${req.input.endYear}-12`;
  const stop = stopMonth(h, stopAgeOrEstimate(req));
  let used = 0;
  let usedG = 0;
  const byYear = new Map<number, { t: number; g: number }>();
  for (const a of (h.accounts ?? []).filter((x) => x.kind === "nisa" && x.owner === owner && !skip.has(x.id))) {
    const frame = a.frame as { lifetimeUsedCost?: number; growthUsedCost?: number } | undefined;
    used += frame?.lifetimeUsedCost ?? a.costBasis?.value ?? a.marketValue?.value ?? 0;
    usedG += frame?.growthUsedCost ?? 0;
    for (const c of a.contributions ?? []) {
      if (c.payer === "employer") continue;
      const from = resolveTimepoint(h, c.from) ?? base;
      const to = resolveTimepoint(h, c.to) ?? stop ?? end;
      for (let m = from < base ? base : from; m <= to && m <= end; m = addMonths(m, 1)) {
        const e = byYear.get(yearOf(m)) ?? { t: 0, g: 0 };
        if (c.tranche === "growth") e.g += c.monthly;
        else e.t += c.monthly;
        byYear.set(yearOf(m), e);
      }
    }
  }
  return { used, usedG, byYear };
}

/** B のお金の動きの予定 */
export interface SplitPlan {
  /** 解約する月 */
  ym: string;
  /** 受け取る解約返戻金（税を引く前） */
  lump: number;
  /** A の月の保険料（解約の月の） */
  aPremium: number;
  /** 浮く保険料（月。A の保険料−掛け捨ての保険料。マイナスもそのまま） */
  saving: number;
  /** 浮いた保険料を積み立てる最後の月（積み立てないなら null） */
  savingUntil: string | null;
  /** 成長投資枠に入れる（年ごと） */
  chunks: { ym: string; amount: number }[];
  /** NISA の生涯の枠に入らない分（解約の月に課税口座へ） */
  taxable: number;
}

export function splitPlan(req: EngineRequest, c: InsuranceContract, o: SplitOptions, skip: ReadonlySet<string> = new Set()): SplitPlan {
  const h = req.input.household;
  const ym = surrenderYm(req, o.year);
  const lump = Math.max(0, scheduledSurrender(c, ym) ?? o.surrenderValue ?? 0);
  const aPremium = premiumMonthly(h, c, ym);
  const saving = aPremium - (o.premium ?? 0);
  const end = `${req.input.endYear}-12`;
  const payEnd = payEndOf(h, c);
  let savingUntil: string | null = null;
  if (saving > 0) {
    const last = payEnd === null ? end : addMonths(payEnd, -1);
    savingUntil = last < end ? last : end;
    if (savingUntil < ym) savingUntil = null;
  }
  const N = NISA_LIMITS;
  const use = nisaUse(req, c.policyholder, skip);
  let used = use.used;
  let usedG = use.usedG;
  let rest = lump;
  const chunks: { ym: string; amount: number }[] = [];
  for (let y = yearOf(ym); y <= req.input.endYear && rest > 0; y++) {
    const e = use.byYear.get(y) ?? { t: 0, g: 0 };
    let months = 0;
    if (savingUntil !== null) {
      const a = Math.max(idx(ym), y * 12);
      const b = Math.min(idx(savingUntil), y * 12 + 11);
      months = Math.max(0, b - a + 1);
    }
    const t = e.t + saving * months;
    const tIn = Math.min(t, N.tsumitate);
    const g0 = e.g + (t - tIn);
    const roomLife = Math.max(0, N.lifetime - used - tIn - g0);
    const room = Math.max(0, Math.min(N.growth - g0, N.growthLifetime - usedG - g0, roomLife));
    const chunk = Math.min(rest, room);
    if (chunk > 0) chunks.push({ ym: y === yearOf(ym) ? ym : `${y}-01`, amount: chunk });
    used += tIn + g0 + chunk;
    usedG += g0 + chunk;
    rest -= chunk;
    // 生涯の枠を使い切ったら、残りは入らない
    if (N.lifetime - used <= 0 || N.growthLifetime - usedG <= 0) break;
  }
  return { ym, lump, aPremium, saving, savingUntil, chunks, taxable: rest };
}

/** 年末にまだ NISA に入れていない解約返戻金（預金に置いている分） */
export const waitingAt = (p: SplitPlan, year: number): number => p.chunks.filter((x) => yearOf(x.ym) > year).reduce((s, x) => s + x.amount, 0);

const box0 = () => ({ value: 0, state: "confirmed", origin: { kind: "manual" } });

/**
 * B の要求（解約の月・掛け捨ての保険・NISA の口座。数表に無い解約返戻金は数表の行として足す）。rate は B の運用の利回り（費用を引く前）。
 * 変額保険が見つからなければ同じ中身の写し
 */
export function splitRequest(req: EngineRequest, contract: string, o: SplitOptions, rate: string, ids: SplitIds): EngineRequest {
  const out = structuredClone(req);
  const h = out.input.household;
  const c = (h.insuranceContracts ?? []).find((x) => x.id === contract);
  if (c === undefined) return out;
  const p = splitPlan(req, c, o, new Set([ids.nisa]));
  c.surrender = { at: p.ym };
  const py = yearsDone(c, p.ym);
  if (py > 0 && scheduledSurrender(c, p.ym) === null && o.surrenderValue !== null) {
    c.schedule = { ...(c.schedule ?? {}), rows: [...(c.schedule?.rows ?? []), { policyYear: py, surrenderValue: Math.max(0, o.surrenderValue) }] };
  }
  const endTp: Timepoint = { memberAge: { member: c.insured, years: o.endAge, months: 0 } };
  const term = o.cover === "term";
  const cover: InsuranceContract = {
    id: ids.cover,
    template: term ? "insurance.term" : "insurance.incomeProtection",
    subtype: o.cover,
    label: "分けた保障（掛け捨て）",
    policyholder: c.policyholder,
    insured: c.insured,
    contractDate: p.ym,
    currency: "JPY",
    premium: { amount: Math.max(0, o.premium ?? 0), frequency: "monthly", payUntil: endTp },
    deductionCategory: { type: "general", regime: "new" },
    coverages: [{ id: ids.coverMain, role: "main", benefit: term ? "death" : "incomeProtection", amount: Math.max(0, o.amount), from: { at: p.ym }, to: endTp }],
    ...(c.beneficiaries !== undefined ? { beneficiaries: structuredClone(c.beneficiaries) } : {}),
  };
  (h.insuranceContracts ??= []).push(cover);
  const contributions: NonNullable<Account["contributions"]> = [];
  if (p.savingUntil !== null) contributions.push({ from: { at: p.ym }, to: { at: p.savingUntil }, monthly: p.saving });
  for (const x of p.chunks) contributions.push({ from: { at: x.ym }, to: { at: x.ym }, monthly: x.amount, tranche: "growth" });
  const accounts = (h.accounts ??= []);
  // 運用の費用は口座の「運用の費用」に入れ、計算のエンジンが利回りから引く（資産配分の入れ方で信託報酬があれば、エンジンがそちらに置き換える）
  const feeField = cmpRate(o.fee, "0") > 0 ? { fee: o.fee } : {};
  accounts.push({ id: ids.nisa, kind: "nisa", owner: c.policyholder, label: "分けた運用（NISA）", marketValue: box0(), asOf: out.input.baseMonth, contributions, expectedReturn: rate, ...feeField });
  if (p.taxable > 0) {
    accounts.push({ id: ids.taxable, kind: "taxable", owner: c.policyholder, label: "分けた運用（課税口座）", marketValue: box0(), asOf: out.input.baseMonth, contributions: [{ from: { at: p.ym }, to: { at: p.ym }, monthly: p.taxable }], expectedReturn: rate, ...feeField });
  }
  return out;
}

// ---- 年ごとの表 ----

export interface SplitRow {
  year: number;
  /** 被保険者のその年の年末の年齢 */
  age: number | null;
  /** A の解約返戻金（数表の無い目安の形は null） */
  aSurrender: number | null;
  /** B の運用残高（NISA・課税口座と、まだ NISA に入れていない分） */
  bInvest: number;
  /** 亡くなったときに家族に入る額（A は死亡保険金、B は掛け捨ての保険金＋運用残高） */
  aDeath: number;
  bDeath: number;
}

type ByYear = { year: number; object: string; deathBenefit: number; surrenderValue: number };
const byYearOf = (r: PreviewResult | null): ByYear[] => ((r?.summary as { insurance?: { byYear?: ByYear[] } } | null)?.insurance?.byYear ?? []) as ByYear[];
const balance = (t: readonly TableCell[], object: string, year: number): number => t.reduce((s, x) => (x.year === year && x.object === object && x.row.startsWith("cf.balance.account.") ? s + x.amount : s), 0);

/** 解約の年から表の最後の年まで、年ごとの A と B */
export function splitRows(req: EngineRequest, c: InsuranceContract, o: SplitOptions, ids: SplitIds, a: PreviewResult | null, b: PreviewResult | null): SplitRow[] {
  if (a === null || b === null) return [];
  const p = splitPlan(req, c, o, new Set([ids.nisa]));
  const insured = memberOf(req.input.household, c.insured);
  const aYears = new Map(byYearOf(a).filter((x) => x.object === c.id).map((x) => [x.year, x]));
  const bCover = new Map(byYearOf(b).filter((x) => x.object === ids.cover).map((x) => [x.year, x]));
  const unknown = isEstimate(c) && !hasSchedule(c);
  const rows: SplitRow[] = [];
  for (let y = yearOf(p.ym); y <= req.input.endYear; y++) {
    const ay = aYears.get(y);
    const invest = balance(b.table, ids.nisa, y) + balance(b.table, ids.taxable, y) + waitingAt(p, y);
    rows.push({
      year: y,
      age: insured === undefined ? null : ageAt(insured, `${y}-12`),
      aSurrender: unknown ? null : (ay?.surrenderValue ?? 0),
      bInvest: invest,
      aDeath: ay?.deathBenefit ?? 0,
      bDeath: (bCover.get(y)?.deathBenefit ?? 0) + invest,
    });
  }
  return rows;
}

/** 表に出す年（解約の年・5年ごと・A の払込が終わる年・掛け捨ての保険が終わる年・最後の年） */
export function shownYears(req: EngineRequest, c: InsuranceContract, o: SplitOptions, rows: readonly SplitRow[]): number[] {
  if (rows.length === 0) return [];
  const h = req.input.household;
  const first = (rows[0] as SplitRow).year;
  const last = (rows.at(-1) as SplitRow).year;
  const keys = new Set<number>([first, last]);
  for (let y = first + 5; y < last; y += 5) keys.add(y);
  const payEnd = payEndOf(h, c);
  if (payEnd !== null && yearOf(payEnd) > first && yearOf(payEnd) < last) keys.add(yearOf(payEnd));
  const coverEnd = resolveTimepoint(h, { memberAge: { member: c.insured, years: o.endAge, months: 0 } });
  if (coverEnd !== null && yearOf(coverEnd) > first && yearOf(coverEnd) < last) keys.add(yearOf(coverEnd));
  return [...keys].sort((x, y) => x - y);
}

/** 浮く保険料の1行 */
export function savingLine(p: SplitPlan): string {
  const yen = (v: number) => `${Math.abs(v).toLocaleString("ja-JP")}円`;
  if (p.aPremium === 0) return "A の保険料の払込は終わっています（B は掛け捨ての保険料を家計から払います）";
  if (p.saving > 0) return `浮く保険料: 月 ${yen(p.saving)}（A の保険料 ${yen(p.aPremium)}−掛け捨ての保険料）を NISA で積み立てます`;
  if (p.saving === 0) return "浮く保険料はありません（A の保険料と掛け捨ての保険料が同じ）";
  return `掛け捨ての保険料が A の保険料より月 ${yen(p.saving)} 高く、浮く保険料はありません（差は家計から払います）`;
}

/** 解約返戻金の行き先の1行 */
export function lumpLine(p: SplitPlan): string {
  const man = (v: number) => `${Math.round(v / 10000).toLocaleString("ja-JP")}万円`;
  const years = [...new Set(p.chunks.map((x) => yearOf(x.ym)))];
  const nisa = p.chunks.reduce((s, x) => s + x.amount, 0);
  const parts: string[] = [`解約返戻金 ${man(p.lump)}（税を引く前。一時所得の税は預金から払います）`];
  if (nisa > 0) parts.push(years.length > 1 ? `NISA の成長投資枠に ${years[0]}〜${years.at(-1)}年の${years.length}年に分けて ${man(nisa)}` : `NISA の成長投資枠に ${man(nisa)}`);
  if (p.taxable > 0) parts.push(`NISA の生涯の枠に入らない ${man(p.taxable)} は課税口座へ`);
  return parts.join("・");
}

// ---- プランを作る ----

/** その分け方のプランの名前（頭はプランの呼び名。例: 「プランC 変額保険 1（ご本人）を解約して分ける」） */
export const splitPlanName = (head: string, contractName: string): string => `${head} ${contractName}を解約して分ける`;

/** 契約の呼び名（名前か種類と番号） */
export function splitContractName(req: EngineRequest, contract: string): string {
  const list = req.input.household.insuranceContracts ?? [];
  const i = list.findIndex((c) => c.id === contract);
  const c = list[i];
  if (c === undefined) return "変額保険";
  return c.label !== undefined && c.label !== "" ? c.label : `${kindOf(c).label.replace(/（目安）$/, "")} ${i + 1}`;
}

/**
 * プラン pid（作ったばかりの、見ているプランを土台にしたプラン）に、変額保険 contract を解約して分ける差分を記録する（0128 の売る年のプランと同じ
 * 作り方。入力画面でプランを直したときと同じ差分の記録）。現状（入力）は変えない。利回りが入っていなければ何もしない
 */
export function recordSplit(wh: WorkingHousehold, cat: Catalog, pid: string, contract: string, o: SplitOptions): WorkingHousehold {
  const before = planView(wh, cat, pid);
  const c = (before.request.input.household.insuranceContracts ?? []).find((x) => x.id === contract);
  if (c === undefined) return wh;
  const rate = rateOf(before.request, c, o);
  if (rate === null || o.premium === null) return wh;
  const after: WorkingHousehold = { ...before, request: splitRequest(before.request, contract, o, rate, newSplitIds()) };
  return recordPlanEdit(wh, cat, pid, before, after);
}
