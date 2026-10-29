// 入るお金の種類ごとの既定（0044）: 課税の扱い・1回の行の表の行・くり返す行の表の行。生成物に頼らない（画面の側のテストがこの表を直接読んで
// app/src/workspace/input/moneyRows.ts の表と突き合わせる。型のほかは何も読み込まない）
import type { IncomeFlowKind, IncomeTaxTreatment } from "../engine/types.ts";

/**
 * 所得の区分（税の計算。0085）: 課税の扱いが、税・社会保険料の計算でどの所得に入るか。表の行（見せ方。種類の既定か row）とは別に持ち、
 * 表の行を何にしても税の計算は変わらない。null は所得に入れない（非課税・相続税で見る・贈与税で見る）
 * - salary 給与所得（給与の収入として本業と合わせる）・business 事業所得（赤字はほかの所得と通算する）・miscellaneous 公的年金等以外の雑所得
 *   （業務・その他を1つの区分として差し引き、赤字は雑所得の中でだけ引く）・temporary 一時所得・capitalGains 分離課税の譲渡所得
 */
export type IncomeCategory = "salary" | "business" | "miscellaneous" | "temporary" | "capitalGains";

/** 課税の扱いごとの所得の区分（0085） */
export const INCOME_CATEGORY_OF: Readonly<Record<IncomeTaxTreatment, IncomeCategory | null>> = {
  nonTaxable: null,
  temporary: "temporary",
  miscBusiness: "miscellaneous",
  miscOther: "miscellaneous",
  salary: "salary",
  business: "business",
  capitalGains: "capitalGains",
  inheritance: null,
  gift: null,
};

/** 入るお金の種類ごとの既定: 課税の扱い・1回の行の表の行・くり返す行の表の行 */
export const INCOME_KIND_DEFAULTS: Readonly<Record<IncomeFlowKind, { readonly tax: IncomeTaxTreatment; readonly once: string; readonly repeat: string }>> = {
  inheritance: { tax: "inheritance", once: "cf.income.lumpSum.inheritance", repeat: "cf.income.lumpSum.inheritance" },
  giftReceived: { tax: "gift", once: "cf.income.lumpSum.gift", repeat: "cf.income.lumpSum.gift" },
  support: { tax: "nonTaxable", once: "cf.income.lumpSum.other", repeat: "cf.income.other" },
  educationSupport: { tax: "nonTaxable", once: "cf.income.lumpSum.other", repeat: "cf.income.other" },
  childSupport: { tax: "nonTaxable", once: "cf.income.other", repeat: "cf.income.other" },
  propertyDivision: { tax: "nonTaxable", once: "cf.income.lumpSum.other", repeat: "cf.income.other" },
  householdContribution: { tax: "nonTaxable", once: "cf.income.other", repeat: "cf.income.other" },
  benefit: { tax: "nonTaxable", once: "cf.income.benefit", repeat: "cf.income.benefit" },
  unemployment: { tax: "nonTaxable", once: "cf.income.benefit.unemployment", repeat: "cf.income.benefit.unemployment" },
  survivorPension: { tax: "nonTaxable", once: "cf.income.pension", repeat: "cf.income.pension" },
  foreignPension: { tax: "miscOther", once: "cf.income.pension", repeat: "cf.income.pension" },
  scholarshipGrant: { tax: "nonTaxable", once: "cf.income.benefit.education", repeat: "cf.income.benefit.education" },
  childPays: { tax: "nonTaxable", once: "cf.income.other", repeat: "cf.income.other" },
  sideJob: { tax: "miscBusiness", once: "cf.income.other.sideJob", repeat: "cf.income.other.sideJob" },
  otherWork: { tax: "salary", once: "cf.income.salary", repeat: "cf.income.salary" },
  saleBusiness: { tax: "capitalGains", once: "cf.income.lumpSum.other", repeat: "cf.income.lumpSum.other" },
  saleGoods: { tax: "nonTaxable", once: "cf.income.lumpSum.other", repeat: "cf.income.lumpSum.other" },
  temporary: { tax: "temporary", once: "cf.income.lumpSum.other", repeat: "cf.income.other" },
  celebration: { tax: "nonTaxable", once: "cf.income.lumpSum.other", repeat: "cf.income.lumpSum.other" },
  subsidy: { tax: "temporary", once: "cf.income.lumpSum.other", repeat: "cf.income.other" },
  powerSale: { tax: "miscOther", once: "cf.income.other", repeat: "cf.income.other" },
  insuranceBenefit: { tax: "nonTaxable", once: "cf.income.other.insuranceBenefit", repeat: "cf.income.other.insuranceBenefit" },
  other: { tax: "nonTaxable", once: "cf.income.lumpSum.other", repeat: "cf.income.other" },
};

