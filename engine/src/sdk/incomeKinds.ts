// 入るお金の種類ごとの既定（0044）: 課税の扱い・1回の行の表の行・くり返す行の表の行。生成物に頼らない（画面の側のテストがこの表を直接読んで
// app/src/workspace/input/moneyRows.ts の表と突き合わせる。型のほかは何も読み込まない）
import type { IncomeFlowKind, IncomeTaxTreatment } from "../engine/types.ts";

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

