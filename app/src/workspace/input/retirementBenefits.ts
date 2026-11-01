// 退職金・企業年金のカードの決まり（作業の層。0057）: 退職給付の種類ごとの初めの形・目安（推定）・目安の入れ直し・種類を変えたときの引き継ぎ。
// - 目安の数は hearing/src/estimates.ts（統計の写し）から読み、ここに数を書かない。目安の無い物（国民年金基金・年金払い退職給付の年額）は
//   未入力の警告にする（0円で黙って計算しない）
// - 値の箱を持たない値（最終の月給・退職の理由・功績倍率・年金の年数・一時金の割合）の推定は、退職給付の値の状態の欄の行に持つ
// - 辞め方（働き方の期間の終わり方 endsWith）・勤続（働き方の期間）は働き方と収入のカードの物。ここは読むだけ
import type { Box, EmploymentPeriod, Household, Member, RetirementBenefit, Timepoint } from "../../engine/types.ts";
import { retirementLumpSumEstimate, retirementPrevalence, salaryEstimate, type Estimate, type RetirementReason } from "../../../../hearing/src/estimates.ts";
import { addMonths, ageAt, ageReachedMonth } from "../levers.ts";
import { resolveTimepoint } from "../timepoint.ts";
import type { Address } from "../store/readings.ts";
import { estimatedBox } from "./household.ts";
import { putRow, rowAt, type StateRow } from "./rows.ts";
import { defaultEndsWith } from "./claims.ts";

type Obj = Record<string, unknown>;

export type BenefitKind = "lumpSum" | "db" | "civilServantAllowance" | "civilServantPension" | "nationalPensionFund" | "officerAllowance";

export const BENEFIT_KINDS: readonly { value: BenefitKind; label: string }[] = [
  { value: "lumpSum", label: "退職一時金（中退共・特退共を含む）" },
  { value: "db", label: "確定給付企業年金（企業年金基金・企業年金連合会を含む）" },
  { value: "civilServantAllowance", label: "退職手当（公務員）" },
  { value: "civilServantPension", label: "年金払い退職給付（公務員）" },
  { value: "nationalPensionFund", label: "国民年金基金" },
  { value: "officerAllowance", label: "役員退職慰労金" },
];

/** 見出しに使う短い名前 */
export const KIND_SHORT: Readonly<Record<string, string>> = {
  lumpSum: "退職一時金",
  db: "確定給付企業年金",
  civilServantAllowance: "退職手当",
  civilServantPension: "年金払い退職給付",
  nationalPensionFund: "国民年金基金",
  officerAllowance: "役員退職慰労金",
};

/** 年金だけの給付（受け取り方を選ばせない。年額が要る） */
export const ANNUITY_ONLY: ReadonlySet<string> = new Set(["civilServantPension", "nationalPensionFund"]);
/** 一時金だけの給付 */
export const LUMP_ONLY: ReadonlySet<string> = new Set(["lumpSum", "civilServantAllowance", "officerAllowance"]);
/** 一時金の見込み額を持つ給付（DB は一時金で受けた場合の額） */
export const HAS_AMOUNT: ReadonlySet<string> = new Set(["lumpSum", "db", "civilServantAllowance", "officerAllowance"]);
/** 見込みの計算（値を持たない推定）を持つ給付 */
export const COMPUTED: ReadonlySet<string> = new Set(["civilServantAllowance", "officerAllowance"]);

/** 新しく入れたとき（働き方を正社員・公務員にした・会社員として入れた）に、目安の退職給付を自動で足す働き方 */
export const AUTO_TYPES: ReadonlySet<string> = new Set(["regular", "civilServant"]);

export const EDUCATION_OPTIONS = [
  { value: "university", label: "大学・大学院卒" },
  { value: "highSchoolOffice", label: "高校卒（管理・事務・技術職）" },
  { value: "highSchoolManual", label: "高校卒（現業職）" },
] as const;

const REASON_LABEL: Readonly<Record<RetirementReason, string>> = { mandatory: "定年", company: "会社都合", voluntary: "自己都合", earlyIncentive: "早期退職の優遇" };

/** 年金払い退職給付を2件に分けて持つときの名前（終身の半分・有期の半分。名前で組にする） */
export const CIVIL_PENSION_LIFE = "年金払い退職給付（終身の半分）";
export const CIVIL_PENSION_FIXED = "年金払い退職給付（有期の半分）";

/** 未入力の0円の印（値の状態の決まり: 根拠の文が「未入力」で始まる推定は「未入力（0円で計算中）」） */
export const UNENTERED_AMOUNT = "未入力（0円で計算）";

/** 推定の根拠（値の箱を持たない値の行） */
export const DB_YEARS_BASIS = "確定給付企業年金の年金の年数の既定の値（10年）";
export const LUMP_SHARE_BASIS = "一時金と年金の併用の割合の既定の値（半分ずつ）";
export const MULTIPLIER_BASIS = "功績倍率の既定の値（1.0。役員の地位でおよそ1.0〜3.0）";
export const CIVIL_REASON_BASIS = "働き方の期間の辞め方から";

// ---- 当て先と行 ----

export const benefitAt = (id: string, item: string, at: string[] = []): Address => ({ target: { object: id }, item, at });
export const estRow = (method: string, basis: string): StateRow => ({ state: "estimated", origin: { kind: "auto" }, estimate: { method, basis } });
const wrap = (b: RetirementBenefit): Obj => ({ household: { retirementBenefits: [b] } });

/** 退職給付の行（値の状態の欄。物を直接読む） */
export const rowOfBenefit = (b: RetirementBenefit, a: Address): StateRow | undefined => rowAt(wrap(b), a);
const putBenefitRow = (b: RetirementBenefit, a: Address, row: StateRow | undefined): void => void putRow(wrap(b), a, row);

/** 前の版の「見込みの計算」の行（見込みの計算の欄の全体に1行。0041 の推定で埋める） */
const LEGACY_ESTIMATE = (id: string) => benefitAt(id, "retirementBenefit.estimate");
export const finalMonthlyAt = (id: string) => benefitAt(id, "retirementBenefit.estimate", ["finalMonthly"]);
export const reasonAt = (id: string) => benefitAt(id, "retirementBenefit.estimate", ["reason"]);
export const multiplierAt = (id: string) => benefitAt(id, "retirementBenefit.estimate", ["multiplier"]);
export const yearsAt = (id: string) => benefitAt(id, "retirementBenefit.receipt", ["years"]);
export const lumpShareAt = (id: string) => benefitAt(id, "retirementBenefit.receipt", ["lumpShare"]);

const isAutoRow = (r: StateRow | undefined): boolean => r?.state === "estimated" && r.origin.kind === "auto";
/** 見込みの計算の欄（最終の月給・理由）が推定のままか（その欄の行が無ければ、前の版の全体の行で読む） */
export function estimatePartIsAuto(b: RetirementBenefit, a: Address): boolean {
  const own = rowOfBenefit(b, a);
  if (own !== undefined) return isAutoRow(own);
  return isAutoRow(rowOfBenefit(b, LEGACY_ESTIMATE(b.id)));
}

const isAutoBox = (x: Box<number> | undefined): boolean => x !== undefined && x.state === "estimated" && x.origin.kind === "auto";
const basisOf = (x: Box<number> | undefined): string => ((x as { estimate?: { basis?: string } } | undefined)?.estimate?.basis ?? "");
/** 「未入力（0円で計算）」の印の箱か */
export const isUnenteredBox = (x: Box<number> | undefined): boolean => isAutoBox(x) && basisOf(x).startsWith("未入力");
/** 統計の目安のままの箱か（未入力の印は含めない） */
export const isEstimateBox = (x: Box<number> | undefined): boolean => isAutoBox(x) && !isUnenteredBox(x);

// ---- 勤め先・勤続・辞め方（働き方と収入のカードの物を読む）----

export function periodOf(h: Household, b: Pick<RetirementBenefit, "employment">): EmploymentPeriod | undefined {
  return b.employment === undefined ? undefined : (h.employmentPeriods ?? []).find((p) => p.id === b.employment);
}

export interface Span {
  from: string;
  to: string;
  /** 勤続年数（1年未満は切り捨て） */
  years: number;
  /** 辞めた翌月の年齢 */
  age: number;
}

/** 勤続期間: 退職給付の勤続期間か、勤め先の働き方の期間。終わりの無い期間は60歳になる前の月まで */
export function spanOf(h: Household, m: Member, b: Pick<RetirementBenefit, "service"> | undefined, p: EmploymentPeriod | undefined): Span | null {
  const from = resolveTimepoint(h, b?.service?.from ?? p?.from);
  const to = resolveTimepoint(h, b?.service?.to ?? p?.to ?? null) ?? addMonths(ageReachedMonth(m, 60), -1);
  if (from === null || to < from) return null;
  const [fy, fm] = from.split("-").map(Number) as [number, number];
  const [ty, tm] = to.split("-").map(Number) as [number, number];
  return { from, to, years: Math.floor(((ty - fy) * 12 + (tm - fm) + 1) / 12), age: ageAt(m, addMonths(to, 1)) };
}

/**
 * 辞め方（働き方の期間の終わり方）。FP が働き方の期間に入れた値か、働き方と収入のカードと同じ既定（claims.ts の defaultEndsWith: 終わりが
 * 60歳に達した月以後か定年の出来事なら定年、それ以外は自己都合）。終わりを決めていない期間は、勤続を60歳になる前の月までとみなすので定年
 */
export function endingOf(h: Household, m: Member, p: EmploymentPeriod | undefined): string {
  if (p === undefined || p.to === null) return "retirement";
  if (typeof p.endsWith === "string") return p.endsWith;
  return defaultEndsWith(h, m, p);
}

/** 退職一時金の目安の辞め方（定年・会社都合・自己都合） */
export function lumpReason(ending: string): RetirementReason {
  if (ending === "retirement") return "mandatory";
  if (ending === "involuntary") return "company";
  return "voluntary";
}

// ---- 目安 ----

const memberOf = (h: Household, id: string) => h.members.find((x) => x.id === id);

/** 会社員の退職一時金の目安（勤続年数・辞め方・学歴。統計の写し）。作れなければ null */
export function lumpEstimate(h: Household, b: Pick<RetirementBenefit, "member" | "employment" | "service" | "education">): Estimate | null {
  const m = memberOf(h, b.member);
  if (m === undefined) return null;
  const p = periodOf(h, b);
  const s = spanOf(h, m, b, p);
  if (s === null || s.years <= 0) return null;
  const reason = lumpReason(endingOf(h, m, p));
  const est = retirementLumpSumEstimate({ reason, yearsOfService: s.years, ageAtRetirement: s.age, ...(b.education !== undefined ? { education: b.education } : {}) });
  if (est === null) return null;
  const edu = EDUCATION_OPTIONS.find((o) => o.value === (b.education ?? "university"))?.label ?? "";
  return { value: est.value, basis: `${est.basis}（${REASON_LABEL[reason]}・${edu}${b.education === undefined ? "とみなす" : ""}）` };
}

/** 公務員の退職手当の見込みの計算に使う最終の月給の目安と理由。作れなければ null */
export function civilEstimate(h: Household, b: Pick<RetirementBenefit, "member" | "employment" | "service">): { finalMonthly: number; reason: "retirementAge" | "voluntary"; basis: string } | null {
  const m = memberOf(h, b.member);
  if (m === undefined) return null;
  const p = periodOf(h, b);
  const s = spanOf(h, m, b, p);
  if (s === null) return null;
  const sal = salaryEstimate("civilServant", m.sex, { age: Math.max(18, s.age - 1) });
  if (sal === null) return null;
  const ending = endingOf(h, m, p);
  return {
    finalMonthly: Math.round(sal.annual.value / 12),
    reason: ending === "retirement" || ending === "involuntary" ? "retirementAge" : "voluntary",
    basis: `退職手当の見込みの計算（最終の月給は ${sal.annual.basis} を12で割った目安）`,
  };
}

/** 役員の最終報酬月額の目安（役員の期間の年収÷12）。作れなければ null */
export function officerEstimate(h: Household, b: Pick<RetirementBenefit, "employment">): { finalMonthly: number; basis: string } | null {
  const p = periodOf(h, b);
  const annual = p?.salary?.annual?.value;
  if (annual == null || annual <= 0) return null;
  return { finalMonthly: Math.round(annual / 12), basis: "最終報酬月額は役員の期間の年収÷12" };
}

/** 退職給付の制度がある勤め先の割合の文（確かめの一覧に出す） */
export function prevalenceText(): string {
  const p = retirementPrevalence();
  return p === null ? "" : `（制度がある企業は ${(p.value / 10).toFixed(1)}%。${p.basis}）`;
}

// ---- 初めの形 ----

/** 65歳からの受け取り（年金払い退職給付・国民年金基金の既定。省略の多い支給の始まり） */
const at65 = (m: Member): Timepoint => ({ memberAge: { member: m.id, years: 65 } });

/** 種類ごとの初めの形（目安・未入力の印つき）。id・人・勤め先は呼ぶ側 */
export function initialBenefit(h: Household, m: Member, kind: BenefitKind, base: { id: string; employment?: string }): RetirementBenefit {
  const b: RetirementBenefit = { id: base.id, member: m.id, kind, ...(base.employment !== undefined ? { employment: base.employment } : {}) };
  switch (kind) {
    case "lumpSum": {
      const e = lumpEstimate(h, b);
      b.amount = e !== null ? estimatedBox(e.value, e.basis) : estimatedBox(0, UNENTERED_AMOUNT);
      break;
    }
    case "db":
      b.amount = estimatedBox(0, UNENTERED_AMOUNT);
      break;
    case "civilServantAllowance": {
      const e = civilEstimate(h, b);
      if (e !== null) {
        b.estimate = { finalMonthly: e.finalMonthly, reason: e.reason };
        putBenefitRow(b, finalMonthlyAt(b.id), estRow("derived", e.basis));
        putBenefitRow(b, reasonAt(b.id), estRow("derived", CIVIL_REASON_BASIS));
      } else b.amount = estimatedBox(0, UNENTERED_AMOUNT);
      break;
    }
    case "officerAllowance": {
      const e = officerEstimate(h, b);
      b.estimate = { multiplier: "1" };
      putBenefitRow(b, multiplierAt(b.id), estRow("standard", MULTIPLIER_BASIS));
      if (e !== null) {
        b.estimate.finalMonthly = e.finalMonthly;
        putBenefitRow(b, finalMonthlyAt(b.id), estRow("derived", e.basis));
      }
      break;
    }
    case "civilServantPension":
      b.label = CIVIL_PENSION_LIFE;
      b.receipt = { start: at65(m), years: null };
      break;
    case "nationalPensionFund":
      b.receipt = { start: at65(m), years: null };
      break;
  }
  return b;
}

/** 年金払い退職給付の有期の半分（終身の半分と組にする。20年） */
export function civilPensionFixedHalf(m: Member, id: string, employment?: string): RetirementBenefit {
  return { id, member: m.id, kind: "civilServantPension", label: CIVIL_PENSION_FIXED, ...(employment !== undefined ? { employment } : {}), receipt: { start: at65(m), years: 20 } };
}

/**
 * 種類を変える（0057。文書の3-5）: 同じ意味の欄（勤め先・勤続・受け取る時期・名前・学歴・障害による退職）は引き継ぎ、FP が入れた見込み額は
 * 一時金の額を持つ種類どうしなら残す。年金の欄・見込みの計算の欄は新しい種類の初めの値にする。目安のままの値は新しい種類の目安に入れ替える
 */
export function convertBenefit(h: Household, b: RetirementBenefit, kind: BenefitKind): RetirementBenefit {
  const m = memberOf(h, b.member);
  if (m === undefined || b.kind === kind) return b;
  const next = initialBenefit(h, m, kind, { id: b.id, ...(b.employment !== undefined ? { employment: b.employment } : {}) });
  for (const k of ["service", "officerService", "paidAt", "education", "disability"] as const) if (b[k] !== undefined) (next as Obj)[k] = structuredClone(b[k]);
  // 名前は FP が付けたものだけ引き継ぐ（種類から付けた名前は付け直す）
  if (b.label !== undefined && b.label !== CIVIL_PENSION_LIFE && b.label !== CIVIL_PENSION_FIXED) next.label = b.label;
  // FP が入れた額（確定・わからない・該当なし）は残す。見込みの計算の種類でも、額があれば額を使う
  if (HAS_AMOUNT.has(kind) && b.amount !== undefined && !isAutoBox(b.amount) && HAS_AMOUNT.has(b.kind)) next.amount = structuredClone(b.amount);
  return next;
}

// ---- 推定の入れ直し（元の値が変わったら、推定のままの値だけ。文書の5-1）----

/**
 * 前の版の入れ方の選択（目安で／額で。0057 の 2026-10-29 の追記で外した）の跡を、選択の無い形に読み替える。h をそのまま書き換える
 * - 退職一時金を「額で」にして額を打っていない物（目安の額を初めの値にした推定）: 推定のままなので、目安に戻す（目安と同じく入れ直す）
 * - 公務員の退職手当・役員退職慰労金を「額で」にして額を打っていない物（未入力の0円）で、見込みの計算の月給があるもの: 見込みの計算に戻す
 */
function dropModeTraces(h: Household): void {
  for (const b of h.retirementBenefits ?? []) {
    if (b.kind === "lumpSum" && isEstimateBox(b.amount) && (b.amount as { estimate?: { method?: string } }).estimate?.method === "standard" && basisOf(b.amount).startsWith(LEGACY_AMOUNT_MODE)) {
      const e = lumpEstimate(h, b);
      if (e !== null) b.amount = estimatedBox(e.value, e.basis);
    }
    if (COMPUTED.has(b.kind) && isUnenteredBox(b.amount) && b.estimate?.finalMonthly !== undefined) delete b.amount;
  }
}

/** 前の版の「額で」の跡の根拠の文の頭（目安の額を初めの値にした推定） */
const LEGACY_AMOUNT_MODE = "目安の額を初めの値にした";

/** 推定のままの退職給付の値を、勤続・辞め方・学歴・年収に合わせて入れ直す。h をそのまま書き換える */
export function refreshRetirement(h: Household): void {
  dropModeTraces(h);
  for (const b of h.retirementBenefits ?? []) {
    if (b.kind === "lumpSum" && isEstimateBox(b.amount) && (b.amount as { estimate?: { method?: string } }).estimate?.method === "statistic") {
      const e = lumpEstimate(h, b);
      if (e !== null && (b.amount?.value !== e.value || basisOf(b.amount) !== e.basis)) b.amount = estimatedBox(e.value, e.basis);
    }
    if (b.kind === "civilServantAllowance" && b.amount === undefined && b.estimate !== undefined) {
      const e = civilEstimate(h, b);
      if (e === null) continue;
      if (estimatePartIsAuto(b, finalMonthlyAt(b.id)) && b.estimate.finalMonthly !== e.finalMonthly) b.estimate = { ...b.estimate, finalMonthly: e.finalMonthly };
      if (estimatePartIsAuto(b, reasonAt(b.id)) && b.estimate.reason !== e.reason) b.estimate = { ...b.estimate, reason: e.reason };
    }
    if (b.kind === "officerAllowance" && b.amount === undefined && b.estimate !== undefined && isAutoRow(rowOfBenefit(b, finalMonthlyAt(b.id)))) {
      const e = officerEstimate(h, b);
      if (e !== null && b.estimate.finalMonthly !== e.finalMonthly) b.estimate = { ...b.estimate, finalMonthly: e.finalMonthly };
    }
  }
}

/**
 * 自動で足した目安の退職給付か（物そのものが推定）: 会社員の退職一時金の額が統計の目安のまま、または公務員の退職手当が見込みの計算で、
 * 最終の月給が推定のまま
 */
export function isAutoBenefit(b: RetirementBenefit): boolean {
  if (b.kind === "lumpSum") return isEstimateBox(b.amount) && (b.amount as { estimate?: { method?: string } }).estimate?.method === "statistic";
  if (b.kind === "civilServantAllowance") return b.amount === undefined && b.estimate?.finalMonthly !== undefined && estimatePartIsAuto(b, finalMonthlyAt(b.id));
  return false;
}

/** 自動で足す種類（正社員は退職一時金、公務員は退職手当） */
export const autoKindOf = (type: string): BenefitKind | null => (type === "regular" ? "lumpSum" : type === "civilServant" ? "civilServantAllowance" : null);

/** 「＋ 足す」の種類の既定（働き方と、もう入れてある物から） */
export function addKindOf(type: string | undefined, have: readonly RetirementBenefit[]): BenefitKind {
  if (type === "selfEmployed") return "nationalPensionFund";
  if (type === "executive") return "officerAllowance";
  if (type === "civilServant") return have.some((b) => b.kind === "civilServantAllowance") ? "civilServantPension" : "civilServantAllowance";
  if (type === "regular" && have.some((b) => b.kind === "lumpSum")) return "db";
  return "lumpSum";
}
