// 架空の書類の見本（0148 の6）: 確かめの画面を、見本の世帯で試すための答え（読み口 proposal.ts が受ける形）。
// 会社名・金額・番号はどれも架空。見本の世帯でだけ出す（実在の世帯に架空の値の候補を入れない）。
// 個人番号の入った所（番号の欄・元の場所の文字）を1つずつ混ぜ、読み口で落ちること・消えることを画面で見られるようにしている
import { PROPOSAL_CONTRACT } from "./types.ts";

export interface SampleDocument {
  id: string;
  label: string;
  raw: unknown;
}

export const SAMPLE_DOCUMENTS: readonly SampleDocument[] = [
  {
    id: "residentTax",
    label: "住民税の決定通知書（架空・ご本人）",
    raw: {
      contract: PROPOSAL_CONTRACT,
      docType: "residentTaxNotice",
      asOf: "2026-05",
      holder: "self",
      values: [
        { item: "residentTaxAssessment.amount", member: "holder", value: 318000, period: "annual", source: { page: 1, where: "特別徴収税額（年額）", text: "特別徴収税額 318,000円" }, confidence: "high" },
        // 番号の欄（候補ごと落ちる）
        { item: "residentTaxAssessment.amount", member: "holder", value: "1234 5678 9012", source: { page: 1, where: "個人番号" }, confidence: "high" },
      ],
      references: [{ label: "給与収入（通知書の記載）", amount: 6400000, source: { page: 1, where: "給与収入", text: "給与収入 6,400,000 個人番号 1234 5678 9012" } }],
    },
  },
  {
    id: "withholding",
    label: "給与所得の源泉徴収票（架空・ご本人）",
    raw: {
      contract: PROPOSAL_CONTRACT,
      docType: "withholdingSlip",
      asOf: "2026-01",
      holder: "self",
      values: [
        { item: "employment.salary.annual", member: "holder", value: 5200000, period: "annual", source: { page: 1, where: "支払金額（賞与を除く分）", text: "支払金額 6,400,000（うち賞与 1,200,000）" }, confidence: "medium", note: "支払金額から、明細の賞与の合計を引いた額です" },
        { item: "employment.salary.bonus", member: "holder", value: 1200000, period: "annual", source: { page: 1, where: "賞与の合計", text: "賞与 1,200,000" }, confidence: "low" },
      ],
      references: [
        { label: "源泉徴収税額", amount: 152300, row: "cf.taxSi.incomeTax", year: 2025, source: { page: 1, where: "源泉徴収税額", text: "源泉徴収税額 152,300" } },
        { label: "社会保険料等の金額", amount: 948000, source: { page: 1, where: "社会保険料等の金額", text: "社会保険料等の金額 948,000" } },
      ],
    },
  },
  {
    id: "lifeInsurance",
    label: "生命保険料控除証明書（架空・医療保険1件）",
    raw: {
      contract: PROPOSAL_CONTRACT,
      docType: "lifeInsuranceDeduction",
      asOf: "2026-10",
      holder: "self",
      objects: [{ key: "c1", kind: "insurance:medical", source: { where: "保険種類", text: "医療保険（無配当）" }, confidence: "high" }],
      values: [
        { item: "insurance.label", newObject: "c1", value: "架空のあおば生命 医療保険", source: { where: "保険会社名・保険種類" }, confidence: "high" },
        { item: "insurance.insured", newObject: "c1", value: "holder", source: { where: "被保険者" }, confidence: "medium", note: "名前は読んでいません。書類の名義の人にしています" },
        { item: "insurance.contractDate", newObject: "c1", value: "2018-04", source: { where: "契約日", text: "契約日 2018年4月1日" }, confidence: "high" },
        { item: "insurance.premium", at: ["amount"], newObject: "c1", value: 3240, period: "once", source: { where: "証明額（月払）", text: "月払保険料 3,240円" }, confidence: "high" },
        { item: "insurance.deductionCategory", at: ["type"], newObject: "c1", value: "careMedical", source: { where: "新制度・介護医療" }, confidence: "high" },
        // 証券番号の欄（候補ごと落ちる）
        { item: "insurance.label", newObject: "c1", value: "AB-0012345678", source: { where: "証券番号" }, confidence: "high" },
      ],
      references: [{ label: "介護医療保険料（年間・新制度）", amount: 38880, source: { where: "証明額（12月期想定）", text: "38,880円" } }],
    },
  },
];
