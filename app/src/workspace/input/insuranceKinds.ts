// 保険の種類（ひな形。0055）: 画面で選ぶ種類の細目（insurance.subtype）ごとの、計算の型（template）・簡易の「主な保障の額」の給付・
// 保障の終わりと払込の終わりの既定・控除の区分の既定。ひな形は選択肢を増やすだけで、計算の型は今の10のまま（項目を増やさない）。
// 既定の値はどれも推定（根拠「ひな形の標準の値」）で、物の値の状態の欄に行で持つ。保険料と保障の額は目安を作らない（未入力の警告）
import type { Coverage, Debt, Household, InsuranceContract, Member, Timepoint } from "../../engine/types.ts";
import { addMonths } from "../levers.ts";
import { resolveTimepoint } from "../timepoint.ts";
import type { Address } from "../store/readings.ts";
import type { YenBasis } from "./units.ts";
import { formatYen } from "./units.ts";
import type { StateRow } from "./rows.ts";
import { presetNum, presetRate, presetText } from "../../../../hearing/src/presets.ts";
import { pctText } from "../../../../hearing/src/housingEstimates.ts";

type Obj = Record<string, unknown>;

export type InsuranceKind =
  | "term"
  | "decreasingTerm"
  | "incomeProtection"
  | "wholeLife"
  | "lowSurrender"
  | "account"
  | "endowment"
  | "medical"
  | "cancer"
  | "threeMajor"
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

/** 種類を選ぶ一覧の分類（「＋ 保険契約を足す」の見出し。2026-11-02） */
export type KindGroup = "death" | "illness" | "savings" | "other";

export const KIND_GROUPS: readonly { group: KindGroup; label: string }[] = [
  { group: "death", label: "死亡の保障" },
  { group: "illness", label: "病気・けが" },
  { group: "savings", label: "貯める・受け取る" },
  { group: "other", label: "そのほか" },
];

export interface KindDef {
  kind: InsuranceKind;
  label: string;
  /** 種類を選ぶ一覧の分類 */
  group: KindGroup;
  /** 一覧の上の「よく使う」にも出す */
  frequent?: boolean;
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
  { kind: "term", label: "定期保険", group: "death", frequent: true, template: "insurance.term", main: { benefit: "death", label: "死亡保険金", basis: "once" }, end: { age: 65 }, payUntil: "end", deduction: "general" },
  {
    kind: "decreasingTerm",
    label: "逓減定期保険",
    group: "death",
    template: "insurance.term",
    main: { benefit: "death", label: "死亡保険金（はじめの額）", basis: "once", help: "保障の終わりまで毎年同じ額ずつ減り、終わりに0円になる形で計算します" },
    end: "mortgagePayoff",
    payUntil: "end",
    deduction: "general",
    decreasing: true,
  },
  { kind: "incomeProtection", label: "収入保障保険", group: "death", template: "insurance.incomeProtection", main: { benefit: "incomeProtection", label: "年金月額", basis: "monthly", help: "亡くなった月の翌月から、保障の終わりまで毎月受け取ります" }, end: { age: 65 }, payUntil: "end", deduction: "general" },
  { kind: "wholeLife", label: "終身保険", group: "death", template: "insurance.wholeLife", main: { benefit: "death", label: "死亡保険金", basis: "once" }, end: "lifetime", payUntil: 65, deduction: "general", savings: true },
  {
    kind: "lowSurrender",
    label: "低解約返戻金型終身保険",
    group: "death",
    template: "insurance.wholeLife",
    main: { benefit: "death", label: "死亡保険金", basis: "once" },
    end: "lifetime",
    payUntil: 65,
    deduction: "general",
    savings: true,
    note: "解約返戻金は、払った保険料の累計に、払込中は払込中の率、払込が終わってからは払込が終わった時の率を掛けて計算します（設計書の率に直してください）",
  },
  {
    kind: "account",
    label: "アカウント型保険（利率変動型積立終身保険）",
    group: "death",
    template: "insurance.wholeLife",
    main: {
      benefit: "death",
      label: "死亡保険金（保障の部分）",
      basis: "once",
      help: "定期保険と同じく、保障の終わりまで出ます（亡くなったときは、その時の積立金も受け取ります）。更新で保険料が上がる分は「詳細」の「＋ 更新」、医療などの特約は「＋ 保障」で入れてください",
    },
    end: { age: 65 },
    payUntil: "end",
    deduction: "general",
    note: "積立金は、払込が終わった時の額（設計書の額）まで毎年まっすぐ増えるものとして計算します。利率が変わったときは、新しい設計書の数字に入れ直してください",
  },
  { kind: "endowment", label: "養老保険", group: "death", template: "insurance.wholeLife", main: { benefit: "death", label: "死亡保険金（＝満期金）", basis: "once" }, end: { age: 60 }, payUntil: "end", deduction: "general", savings: true },
  { kind: "groupTerm", label: "団体保険（勤務先）", group: "death", template: "insurance.term", main: { benefit: "death", label: "死亡保険金", basis: "once" }, end: "retirement", payUntil: "end", deduction: "general" },
  { kind: "medical", label: "医療保険", group: "illness", frequent: true, template: "insurance.medical", main: { benefit: "hospitalDaily", label: "入院日額（1日）", basis: "once" }, end: "lifetime", payUntil: "lifetime", deduction: "careMedical" },
  { kind: "cancer", label: "がん保険", group: "illness", template: "insurance.cancer", main: { benefit: "cancerLump", label: "がん一時金（診断給付金）", basis: "once" }, end: "lifetime", payUntil: "lifetime", deduction: "careMedical" },
  {
    kind: "threeMajor",
    label: "三大疾病保険",
    group: "illness",
    template: "insurance.medical",
    main: {
      benefit: "threeMajorLump",
      label: "三大疾病一時金",
      basis: "once",
      help: "がん・心疾患・脳卒中になったときに1回受け取る一時金です（特定疾病保障保険も、この種類で入れます）。死亡・高度障害でも保険金が出る型（特定疾病保障定期保険など）は、「詳細」の「＋ 保障」で死亡保険金を足してください",
    },
    end: "lifetime",
    payUntil: "lifetime",
    deduction: "careMedical",
  },
  { kind: "incapacity", label: "就業不能保険", group: "illness", template: "insurance.term", main: { benefit: "incapacity", label: "就業不能の月額", basis: "monthly", help: "働けない想定の月から、免責の月数の後に毎月受け取ります" }, end: { age: 65 }, payUntil: "end", deduction: "general" },
  {
    kind: "care",
    label: "民間の介護保険",
    group: "illness",
    template: "insurance.medical",
    main: { benefit: "other", label: "介護の一時金", basis: "once", help: "この給付はソフトでは計算しないので、この額は計算に入りません。受け取る見込みは下の「入るお金」の行で入れてください" },
    end: "lifetime",
    payUntil: 65,
    deduction: "careMedical",
  },
  { kind: "education", label: "学資保険", group: "savings", frequent: true, template: "insurance.education", main: { benefit: "maturity", label: "満期金", basis: "once" }, end: { childAge: 18 }, payUntil: "end", deduction: "general", savings: true, child: true },
  { kind: "privateAnnuity", label: "個人年金保険", group: "savings", template: "insurance.privateAnnuity", main: { benefit: "annuity", label: "年金の年額", basis: "annual", help: "受け取りの始まりから10年間（年数は「詳細」で）" }, end: { age: 65 }, payUntil: 60, deduction: "pension", savings: true },
  { kind: "foreignCurrency", label: "外貨建て保険（目安）", group: "savings", template: "insurance.foreignCurrency", main: { benefit: "death", label: "死亡保険金（円の目安）", basis: "once" }, end: "lifetime", payUntil: 65, deduction: "general", estimate: true, note: "目安（為替で変わります）。円の目安の額だけで計算し、積立金を前提の利回りで伸ばしません" },
  { kind: "variable", label: "変額保険（目安）", group: "savings", template: "insurance.variable", main: { benefit: "death", label: "死亡保険金（円の目安）", basis: "once" }, end: "lifetime", payUntil: 65, deduction: "general", estimate: true, note: "目安（運用で変わります）。円の目安の額だけで計算し、積立金を前提の利回りで伸ばしません" },
  { kind: "mutualAid", label: "共済（総合・医療）", group: "other", template: "insurance.term", main: { benefit: "death", label: "死亡保険金（共済金）", basis: "once", help: "年齢で保障が段階的に変わる型は、「詳細」で保障の行を期間で分けて入れます" }, end: { age: 65 }, payUntil: "end", deduction: "general" },
  { kind: "nonLife", label: "損害保険", group: "other", template: "insurance.nonLife", main: null, end: "lifetime", payUntil: "lifetime", deduction: "none", note: "保険料だけを計算します。保険金は計算しません（受け取る見込みは入るお金の行で）" },
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
export const STANDARD = "ひな形の既定の値";
/** ひな形の既定の値の推定のままか（前の言い方「ひな形の標準の値」で保存した世帯も同じに見る） */
export const isAutoStandard = (r: StateRow | undefined): boolean => isAuto(r, STANDARD) || isAuto(r, "ひな形の標準の値");

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

/** 手術の額の既定（入院日額の10倍。presets.ts の目安） */
export const surgeryRatio = (): number => presetNum("preset.insurance.surgeryRatio");
export const surgeryBasis = (daily: number) => presetText("preset.insurance.surgeryRatio", (v) => `${STANDARD}（入院日額 ${formatYen(daily, "yen")}円の${String(v)}倍）`);

/** 低解約返戻金型終身保険の解約返戻率の既定（presets.ts の目安。払込中の率と払込が終わった時の率。0055 の追記 2026-11-03） */
export const LOW_CV_PRESET = { during: "preset.insurance.lowSurrender.duringRate", end: "preset.insurance.lowSurrender.endRate" } as const;
export const lowCvRate = (which: keyof typeof LOW_CV_PRESET): string => presetRate(LOW_CV_PRESET[which]);
export const lowCvBasis = (which: keyof typeof LOW_CV_PRESET): string =>
  presetText(LOW_CV_PRESET[which], (v) => `${STANDARD}（低解約返戻金型終身保険: ${which === "during" ? "払込中" : "払込が終わった時"}の解約返戻率 ${pctText(v)}。設計書の率に直してください）`);

/** 入院の1回の限度日数の既定（計算エンジンの insurance.policy と同じ目安。engine/src/sdk/estimates.ts） */
export const defaultMaxDays = (): number => presetNum("preset.insurance.hospitalMaxDays");

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
