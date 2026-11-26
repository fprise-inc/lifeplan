// 事務所の既定値の画面の7つの画面の名前と並び（0261）。画面（pages.ts）・AI接続口の表示の設定の一覧（connector/displayCatalog.ts）・
// 手引き（docs/app-guide/08-office.md）が同じ名前で呼ぶ。ほかの部品を読み込まない小さな置き場（接続口のまとめにも入る）

/** 7つの画面 */
export type OfficePageId = "premises" | "fee" | "estimates" | "input" | "results" | "look" | "custom";

/**
 * 画面の並びと名前（左の目次の順）。上の3つ（よく変える前提・料金・推定の値）と、線の下の4つ（画面の見せ方・見た目・カスタム層）に分ける。
 * about は左の目次の要約（今の値で作らない画面）
 */
export const OFFICE_PAGES: readonly { id: OfficePageId; name: string; about: string }[] = [
  { id: "premises", name: "前提条件の既定値", about: "これから作る世帯に写す物価・賃金・利回り・不動産の評価・表の期間" },
  { id: "fee", name: "FP顧問料の料金表", about: "契約を足すときに写す単発の料金・継続の顧問料" },
  { id: "estimates", name: "推定の値（統計・目安）", about: "空欄・「わからない」を補う推定の元の値" },
  { id: "input", name: "入力の画面", about: "入力項目の並び・新しい世帯で出す項目・基本生活費の内訳・介護・相続の見込み" },
  { id: "results", name: "結果と万一の画面", about: "対策に出す項目・表示の設定・万一のときのタブ" },
  { id: "look", name: "事務所の見た目と機能", about: "名前・ロゴ・基調の色・機能のコード" },
  { id: "custom", name: "カスタム層", about: "説明の文・名前・入力の欄の見せ方" },
];

export const officePageName = (id: OfficePageId): string => OFFICE_PAGES.find((p) => p.id === id)?.name ?? id;

export const isOfficePage = (v: unknown): v is OfficePageId => typeof v === "string" && OFFICE_PAGES.some((p) => p.id === v);
