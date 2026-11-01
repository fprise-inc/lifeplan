// 役員として働く人の家計の側（0105）: 自社株（出資額）・会社への貸付金・会社からの借入金・会社の借入の連帯保証の額。
// 欄は役員の働き方（employmentPeriods の type executive）のある構成員がいるときだけ出す。会社の側の数字（会社の決算・会社の BS）は扱わない
import type { Household, Member } from "../../engine/types.ts";

/** 役員の働き方の期間がある構成員（世帯の中の人だけ。並びは構成員の順） */
export function executiveMembers(h: Household): Member[] {
  const ids = new Set((h.employmentPeriods ?? []).filter((p) => p.type === "executive").map((p) => p.member));
  return h.members.filter((m) => ids.has(m.id) && m.outside === undefined);
}

/** 役員として働く人がいる世帯か */
export function hasExecutive(h: Household): boolean {
  return executiveMembers(h).length > 0;
}

/** その他の資産の細目の名前と説明（0105） */
export const ASSET_SUBTYPES = {
  ownCompanyShares: {
    label: "自社株（出資額）",
    note: "役員を務める会社の株を、払い込んだ額（出資額）で入れます。実際の株の価値はずっと高いことがあり、相続税に影響します。評価額は増減させず、出資額のまま見ます。",
  },
  loanToCompany: {
    label: "会社への貸付金",
    note: "役員を務める会社に貸しているお金（会社の帳簿では役員からの借入金）。返ってくる見込みは FP のメモで補います。",
  },
} as const;

/** 会社の借入の連帯保証の額の合計（今の額。負債には入れない） */
export function guaranteeTotal(h: Household): number {
  return h.members.reduce((s, m) => s + (m.companyGuarantee?.value ?? 0), 0);
}
