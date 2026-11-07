// 架空の書類の見本（0148 の6・0159）: 確かめの画面を、見本の世帯で試すための答え（読み口 proposal.ts が受ける形）。保険証券と
// ご契約内容のお知らせの2通（0159 で読める書類を保険だけにした）。
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
    id: "medicalPolicy",
    label: "医療保険の保険証券（架空・新しい契約）",
    raw: {
      contract: PROPOSAL_CONTRACT,
      docType: "insurancePolicy",
      asOf: "2026-04",
      holder: "self",
      objects: [{ key: "c1", kind: "insurance:medical", source: { page: 1, where: "主契約", text: "医療保険（無配当）" }, confidence: "high" }],
      values: [
        { item: "insurance.label", newObject: "c1", value: "架空のあおば生命 医療保険", source: { page: 1, where: "保険会社名・商品名" }, confidence: "high" },
        { item: "insurance.policyholder", newObject: "c1", value: "holder", source: { page: 1, where: "契約者" }, confidence: "high", note: "名前は読んでいません" },
        { item: "insurance.insured", newObject: "c1", value: "holder", source: { page: 1, where: "被保険者" }, confidence: "medium", note: "契約者と同じ名前でした" },
        { item: "insurance.contractDate", newObject: "c1", value: "2018-04", source: { page: 1, where: "契約日", text: "契約日 2018年4月1日 証券番号 1234 5678 9012" }, confidence: "high" },
        { item: "insurance.premium", at: ["frequency"], newObject: "c1", value: "monthly", source: { page: 1, where: "払込方法", text: "月払（口座振替）" }, confidence: "high" },
        { item: "insurance.premium", at: ["amount"], newObject: "c1", value: 3240, period: "once", source: { page: 1, where: "合計保険料", text: "月払保険料 3,240円" }, confidence: "high" },
        { item: "insurance.coverages", at: ["amount"], newObject: "c1", value: 5000, period: "once", source: { page: 1, where: "主契約 入院給付金日額", text: "日額 5,000円" }, confidence: "high" },
        // 証券番号の欄（候補ごと落ちる）
        { item: "insurance.label", newObject: "c1", value: "AB-0012345678", source: { page: 1, where: "証券番号" }, confidence: "high" },
      ],
      references: [{ label: "特約: 先進医療特約 通算限度額", amount: 20000000, source: { page: 1, where: "先進医療特約", text: "通算 2,000万円" } }],
    },
  },
  {
    id: "wholeLifeNotice",
    label: "終身保険のご契約内容のお知らせ（架空・今の契約）",
    raw: {
      contract: PROPOSAL_CONTRACT,
      docType: "insurancePolicy",
      asOf: "2026-06",
      holder: "self",
      values: [
        { item: "insurance.premium", at: ["amount"], member: "holder", value: 16200, period: "once", source: { page: 1, where: "合計保険料", text: "月払保険料 16,200円" }, confidence: "high", note: "今の入力の保険料と違います。特約を足したかを確かめてください" },
        { item: "insurance.contractDate", member: "holder", value: "2012-06", source: { page: 1, where: "契約日", text: "平成24年6月1日" }, confidence: "high" },
        // 番号の欄（候補ごと落ちる）
        { item: "insurance.label", member: "holder", value: "1234 5678 9012", source: { page: 1, where: "お客さま番号" }, confidence: "high" },
      ],
      references: [{ label: "積立金の額", amount: 1830000, source: { page: 1, where: "積立金", text: "積立金 1,830,000円 お客さま番号 1234 5678 9012" } }],
    },
  },
];
