// 合算BS（同梱の公式の拡張 ext.official.combinedBs）の入口（manifest.json の entry。0114 の2）。
// 差し込み口に載せる関数を、マニフェストの provides の export の名前で出す。
// - balanceView: view.balance（資産と負債のタブの見るもの）
// - chapter: report.chapter（提案書の拡張の章の材料。reports/chapter.typ が読む）
export { balanceView } from "./parts/view.ts";
export { chapter } from "./parts/chapter.ts";
