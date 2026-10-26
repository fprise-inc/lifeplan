// 保険の種類（ひな形。0055）: 画面で選ぶ種類の細目（insurance.subtype）ごとの、計算の型（template）・簡易の「主な保障の額」の給付・
// 保障の終わりと払込の終わりの既定・控除の区分の既定。ひな形は選択肢を増やすだけで、計算の型は今の10のまま（項目を増やさない）。
// 既定の値はどれも推定（根拠「ひな形の標準の値」）で、物の値の状態の欄に行で持つ。保険料と保障の額は目安を作らない（未入力の警告）
import type { Coverage, Debt, Household, Illness, InsuranceContract, Member, Timepoint } from "../../engine/types.ts";
import { addMonths } from "../levers.ts";
import { resolveTimepoint } from "../timepoint.ts";
import type { Address } from "../store/readings.ts";
import type { YenBasis } from "./units.ts";
import { formatYen } from "./units.ts";
import type { StateRow } from "./rows.ts";

type Obj = Record<string, unknown>;

export type InsuranceKind =
  | "term"
  | "decreasingTerm"
  | "incomeProtection"
  | "wholeLife"
  | "endowment"
  | "medical"
  | "cancer"
  | "incapacity"
  | "education"
  | "privateAnnuity"
  | "mutualAid"
  | "groupTerm"
  | "care"
  | "foreignCurrency"
  | "variable"
  | "nonLife";

/** 終わりの既定（被保険者の年齢・終身・出来事から） */
type EndRule = { age: number } | "lifetime" | "mortgagePayoff" | "retirement" | { childAge: number };

export interface KindDef {
  kind: InsuranceKind;
  label: string;
  template: string;
  /** 簡易の「主な保障の額」（null は保険料だけの契約） */
  main: { benefit: string; label: string; basis: YenBasis; help?: string } | null;
  /** 保障の終わりの既定（個人年金は受け取りの始まり） */
  end: EndRule;
  /** 払込の終わりの既定: "end" は保障の終わりと同じ、数は被保険者の年齢、"lifetime" は終身払い */
  payUntil: "end" | number | "lifetime";
  deduction: "general" | "careMedical" | "pension" | "earthquake" | "none";
  /** 貯蓄型（解約返戻金が貯まる。返戻率が空なら未入力の警告） */
  savings?: boolean;
  /** 円の目安の形（外貨建て・変額） */
  estimate?: boolean;
  /** 被保険者の既定が末の子（学資保険） */
  child?: boolean;
  /** 減る形（逓減定期） */
  decreasing?: boolean;
  /** 欄の下の説明 */
  note?: string;
}

export const KINDS: readonly KindDef[] = [
  { kind: "term", label: "定期保険", template: "insurance.term", main: { benefit: "death", label: "死亡保険金", basis: "once" }, end: { age: 65 }, payUntil: "end", deduction: "general" },
  {
    kind: "decreasingTerm",
    label: "逓減定期保険（住宅ローンの分など）",
    template: "insurance.term",
    main: { benefit: "death", label: "死亡保険金（はじめの額）", basis: "once", help: "保障の終わりまで毎年同じ額ずつ減り、終わりに0円になる形で計算します" },
    end: "mortgagePayoff",
    payUntil: "end",
    deduction: "general",
    decreasing: true,
  },
  { kind: "incomeProtection", label: "収入保障保険", template: "insurance.incomeProtection", main: { benefit: "incomeProtection", label: "年金月額", basis: "monthly", help: "亡くなった月の翌月から、保障の終わりまで毎月受け取ります" }, end: { age: 65 }, payUntil: "end", deduction: "general" },
  { kind: "wholeLife", label: "終身保険", template: "insurance.wholeLife", main: { benefit: "death", label: "死亡保険金", basis: "once" }, end: "lifetime", payUntil: 65, deduction: "general", savings: true },
  { kind: "endowment", label: "養老保険", template: "insurance.wholeLife", main: { benefit: "death", label: "死亡保険金（＝満期金）", basis: "once" }, end: { age: 60 }, payUntil: "end", deduction: "general", savings: true },
  { kind: "medical", label: "医療保険", template: "insurance.medical", main: { benefit: "hospitalDaily", label: "入院日額（1日）", basis: "once" }, end: "lifetime", payUntil: "lifetime", deduction: "careMedical" },
  { kind: "cancer", label: "がん保険", template: "insurance.cancer", main: { benefit: "cancerLump", label: "がん一時金（診断給付金）", basis: "once" }, end: "lifetime", payUntil: "lifetime", deduction: "careMedical" },
  { kind: "incapacity", label: "就業不能保険", template: "insurance.term", main: { benefit: "incapacity", label: "就業不能の月額", basis: "monthly", help: "働けない想定の月から、免責の月数の後に毎月受け取ります" }, end: { age: 65 }, payUntil: "end", deduction: "general" },
  { kind: "education", label: "学資保険", template: "insurance.education", main: { benefit: "maturity", label: "満期金", basis: "once" }, end: { childAge: 18 }, payUntil: "end", deduction: "general", savings: true, child: true },
  { kind: "privateAnnuity", label: "個人年金保険", template: "insurance.privateAnnuity", main: { benefit: "annuity", label: "年金の年額", basis: "annual", help: "受け取りの始まりから10年間（年数は詳細で）" }, end: { age: 65 }, payUntil: 60, deduction: "pension", savings: true },
  { kind: "mutualAid", label: "共済（総合・医療）", template: "insurance.term", main: { benefit: "death", label: "死亡保険金（共済金）", basis: "once", help: "年齢で保障が段階的に変わる型は、詳細で保障の行を期間で分けて入れます" }, end: { age: 65 }, payUntil: "end", deduction: "general" },
  { kind: "groupTerm", label: "団体保険（勤務先）", template: "insurance.term", main: { benefit: "death", label: "死亡保険金", basis: "once" }, end: "retirement", payUntil: "end", deduction: "general" },
  {
    kind: "care",
    label: "民間の介護保険",
    template: "insurance.medical",
    main: { benefit: "other", label: "介護の一時金", basis: "once", help: "計算の型に無い給付なので、この額は計算に入りません。受け取る見込みは下の「入るお金」の行（計算の型に無い保険の給付の見込み）で入れてください" },
    end: "lifetime",
    payUntil: 65,
    deduction: "careMedical",
  },
  { kind: "foreignCurrency", label: "外貨建て保険（目安）", template: "insurance.foreignCurrency", main: { benefit: "death", label: "死亡保険金（円の目安）", basis: "once" }, end: "lifetime", payUntil: 65, deduction: "general", estimate: true, note: "目安（為替で変わります）。円の目安の額だけで計算し、積立金を前提の利回りで伸ばしません" },
  { kind: "variable", label: "変額保険（目安）", template: "insurance.variable", main: { benefit: "death", label: "死亡保険金（円の目安）", basis: "once" }, end: "lifetime", payUntil: 65, deduction: "general", estimate: true, note: "目安（運用で変わります）。円の目安の額だけで計算し、積立金を前提の利回りで伸ばしません" },
  { kind: "nonLife", label: "損害保険（火災・地震・自動車など）", template: "insurance.nonLife", main: null, end: "lifetime", payUntil: "lifetime", deduction: "none", note: "保険料だけを計算します。保険金は計算しません（受け取る見込みは入るお金の行で）" },
];

export const KIND_OPTIONS = KINDS.map((k) => ({ value: k.kind, label: k.label }));

const BY_KIND = new Map(KINDS.map((k) => [k.kind, k]));
const FROM_TEMPLATE: Readonly<Record<string, InsuranceKind>> = {
  "insurance.term": "term",
  "insurance.wholeLife": "wholeLife",
  "insurance.incomeProtection": "incomeProtection",
  "insurance.medical": "medical",
  "insurance.cancer": "cancer",
  "insurance.education": "education",
  "insurance.privateAnnuity": "privateAnnuity",
  "insurance.foreignCurrency": "foreignCurrency",
  "insurance.variable": "variable",
  "insurance.nonLife": "nonLife",
};

/** 契約の種類（種類の細目が無い古い契約は計算の型から読む。逓減・団体保険・共済などは型が同じなので定期保険などで開く） */
export function kindOf(c: Pick<InsuranceContract, "subtype" | "template">): KindDef {
  const k = (c.subtype !== undefined ? BY_KIND.get(c.subtype as InsuranceKind) : undefined) ?? BY_KIND.get(FROM_TEMPLATE[c.template] ?? "term");
  return k ?? (KINDS[0] as KindDef);
}

export const kindDef = (k: string): KindDef | undefined => BY_KIND.get(k as InsuranceKind);

/** 主契約の主な給付の保障（簡易の「主な保障の額」） */
export function mainCoverage(c: InsuranceContract, k: KindDef = kindOf(c)): Coverage | undefined {
  if (k.main === null) return undefined;
  const covs = c.coverages ?? [];
  return covs.find((x) => x.role === "main" && x.benefit === k.main?.benefit) ?? covs.find((x) => x.benefit === k.main?.benefit);
}

// ---- 当て先と値の状態の行 ----

export const at = (object: string, item: string, path: string[] = []): Address => ({ target: { object }, item, at: path });
export const estRow = (method: string, basis: string): StateRow => ({ state: "estimated", origin: { kind: "auto" }, estimate: { method, basis } });
const key = (item: string, path: readonly string[]) => [item, ...path].join("/");

/** 契約の中の値の状態の行（読むだけ） */
export function rowIn(c: Obj, item: string, path: readonly string[] = []): StateRow | undefined {
  const s = c.valueStates as Record<string, StateRow> | undefined;
  return s?.[key(item, path)];
}

/** 契約の中の値の状態の行を書く（undefined は消す） */
export function putRowIn(c: Obj, item: string, path: readonly string[], row: StateRow | undefined): void {
  const s = { ...((c.valueStates as Record<string, StateRow> | undefined) ?? {}) };
  if (row === undefined) delete s[key(item, path)];
  else s[key(item, path)] = structuredClone(row);
  if (Object.keys(s).length === 0) delete c.valueStates;
  else c.valueStates = s;
}

/** 推定（出どころ auto）の行か。head があれば根拠の頭で見分ける */
export const isAuto = (r: StateRow | undefined, head?: string): boolean => r?.state === "estimated" && r.origin.kind === "auto" && (head === undefined || (r.estimate?.basis ?? "").startsWith(head));

export const UNENTERED_PREMIUM = "未入力（保険料を入れてください。0円で計算中）";
export const UNENTERED_MAIN = "未入力（保障の額を入れてください。保障は0円で計算中）";
export const STANDARD = "ひな形の標準の値";

// ---- 既定の値 ----

/** 末の子（学資保険の被保険者の既定） */
export function youngestChild(h: Household): Member | undefined {
  return [...h.members.filter((m) => m.kind === "child")].sort((a, b) => (a.birth.birthYearMonth < b.birth.birthYearMonth ? 1 : -1))[0];
}

/** 住宅ローンの完済の月（最初の住宅ローン。返済期間から） */
export function mortgagePayoff(h: Household): string | null {
  const d = (h.debts ?? []).find((x) => x.kind === "mortgage") as (Debt & { repayment?: { termMonths?: number } }) | undefined;
  if (d === undefined) return null;
  const start = resolveTimepoint(h, d.start as Timepoint | undefined);
  const term = d.repayment?.termMonths;
  return start === null || term === undefined ? null : addMonths(start, term - 1);
}

/** 被保険者の今の勤め先の終わり（退職の出来事があればそれ） */
function retirementOf(h: Household, member: string): { tp: Timepoint; what: string } | null {
  const ev = (h.events ?? []).find((e) => (e.kind === "retirement" || e.kind === "lastWork") && (e as { member?: string }).member === member);
  if (ev !== undefined) return { tp: { event: ev.id }, what: "退職の出来事" };
  const p = (h.employmentPeriods ?? []).filter((x) => x.member === member && x.to != null && x.type !== "unemployed").sort((a, b) => ((resolveTimepoint(h, a.to) ?? "") < (resolveTimepoint(h, b.to) ?? "") ? 1 : -1))[0];
  const ym = p === undefined ? null : resolveTimepoint(h, p.to);
  return ym === null ? null : { tp: { at: ym }, what: "今の勤め先の終わり" };
}

const age = (member: string, years: number): Timepoint => ({ memberAge: { member, years, months: 0 } });

/** 保障の終わりの既定と根拠（null は終身） */
export function defaultEnd(h: Household, k: KindDef, insured: string): { tp: Timepoint | null; basis: string } {
  const e = k.end;
  if (e === "lifetime") return { tp: null, basis: `${STANDARD}（${k.label}: 終身）` };
  if (e === "mortgagePayoff") {
    const ym = mortgagePayoff(h);
    if (ym !== null) return { tp: { at: ym }, basis: `住宅ローンの完済の月（${Number(ym.slice(0, 4))}年${Number(ym.slice(5))}月）` };
    return { tp: age(insured, 65), basis: `${STANDARD}（${k.label}: 65歳。住宅ローンの完済に合わせて直してください）` };
  }
  if (e === "retirement") {
    const r = retirementOf(h, insured);
    if (r !== null) return { tp: r.tp, basis: `${r.what}（${k.label}は退職で終わります）` };
    return { tp: age(insured, 65), basis: `${STANDARD}（${k.label}: 65歳。退職に合わせて直してください）` };
  }
  if ("childAge" in e) return { tp: age(insured, e.childAge), basis: `${STANDARD}（${k.label}: 被保険者の${e.childAge}歳）` };
  return { tp: age(insured, e.age), basis: `${STANDARD}（${k.label}: ${e.age}歳）` };
}

/** 払込の終わりの既定と根拠（null は終身払い） */
export function defaultPayUntil(h: Household, k: KindDef, insured: string): { tp: Timepoint | null; basis: string } {
  if (k.payUntil === "lifetime") return { tp: null, basis: `${STANDARD}（${k.label}: 終身払い）` };
  if (k.payUntil === "end") {
    const e = defaultEnd(h, k, insured);
    return { tp: e.tp, basis: `保障の終わりと同じ（${k.label}）` };
  }
  return { tp: age(insured, k.payUntil), basis: `${STANDARD}（${k.label}: ${k.payUntil}歳まで）` };
}

/** 保険料控除の新旧の制度（2012年1月以後の契約は新制度） */
export const regimeOf = (contractDate: string): "new" | "old" => (contractDate >= "2012-01" ? "new" : "old");

/** 手術の額の既定（入院日額の10倍） */
export const SURGERY_RATIO = 10;
export const surgeryBasis = (daily: number) => `${STANDARD}（入院日額 ${formatYen(daily, "yen")}円の${SURGERY_RATIO}倍）`;

/** 入院の1回の限度日数の既定 */
export const DEFAULT_MAX_DAYS = 60;

// ---- 医療・がんの給付の見込み（読むだけ。計算エンジンの insurance.policy と同じ決まり） ----

export interface MedicalPart {
  coverage: string;
  benefit: string;
  label: string;
  amount: number;
}

/** 病気の想定で受け取る見込み（給付ごと。0円の給付は入れない）。起きる月に保障が続いている契約だけ（呼ぶ側が確かめる） */
export function medicalParts(c: InsuranceContract, member: string, ill: Illness): MedicalPart[] {
  const out: MedicalPart[] = [];
  for (const x of c.coverages ?? []) {
    if ((x.insured ?? c.insured) !== member) continue;
    let amount: number;
    let label: string;
    if (x.benefit === "hospitalDaily") {
      const days = Math.min(ill.hospitalDays ?? 0, x.maxDays ?? DEFAULT_MAX_DAYS);
      amount = x.amount * days;
      label = `入院 ${days}日`;
    } else if (x.benefit === "surgery") {
      amount = x.amount * (ill.surgeries ?? 0);
      label = `手術 ${ill.surgeries ?? 0}回`;
    } else if (x.benefit === "cancerLump") {
      amount = ill.disease === "cancer" ? x.amount : 0;
      label = "がん一時金";
    } else if (x.benefit === "threeMajorLump") {
      amount = ill.disease === "cancer" || ill.disease === "heartStroke" ? x.amount : 0;
      label = "三大疾病一時金";
    } else continue;
    if (amount > 0) out.push({ coverage: x.id, benefit: x.benefit, label, amount });
  }
  return out;
}

// ---- 受け取るお金の税（読むだけ） ----

/** 死亡保険金の税の区分（契約者・被保険者・受取人の組から） */
export function deathTaxText(c: InsuranceContract, receiver: string | null): string {
  if (c.policyholder === c.insured) return "相続税（死亡保険金の非課税枠の対象）";
  if (receiver !== null && receiver === c.policyholder) return "所得税・住民税（一時所得）";
  return "贈与税（契約者・被保険者・受取人が全部違う組。計算はしません）";
}

export const DISEASES = [
  { value: "cancer", label: "がん" },
  { value: "heartStroke", label: "心疾患・脳卒中" },
  { value: "other", label: "そのほか" },
] as const;
