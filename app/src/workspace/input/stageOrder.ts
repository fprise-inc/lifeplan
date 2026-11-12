// 入力の15項目の標準の順番と名前（入力のホームの入力項目・確かめの一覧・計算のお知らせの「入力で開く」の先の名前）。
// 段階の定義（stages/index.ts）から分けた小さな表で、画面の部品を読まない所（AI接続口の計算のお知らせ。0210）からも読む
import type { StageId } from "./form.ts";

export const STAGE_ORDER: readonly { id: StageId; label: string }[] = [
  { id: "family", label: "家族" },
  { id: "work", label: "働き方と収入" },
  { id: "retirement", label: "退職金・企業年金" },
  { id: "pension", label: "年金" },
  { id: "living", label: "基本生活費" },
  { id: "education", label: "子ども・教育" },
  { id: "housing", label: "住まい・ローン" },
  { id: "insurance", label: "保険" },
  { id: "savings", label: "貯蓄・運用" },
  { id: "rental", label: "収益不動産" },
  { id: "events", label: "ライフイベント" },
  { id: "car", label: "車" },
  { id: "care", label: "介護・親" },
  { id: "inheritance", label: "相続・贈与" },
  { id: "assumptions", label: "前提条件" },
];
