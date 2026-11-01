// 「書類で確かめる」（値の状態 unknown。前の「わからない」）を出す欄の、確かめる書類（欄の定義の docCheck に入れる。0041 の追記 2026-10-31）。
// 確かめの一覧の「書類待ち」の行と、欄の状態の印・操作の説明に出す。欄の定義から読むだけなので、ほかに依らない小さな表にしておく
export const CHECK_DOCUMENTS = {
  residentTax: "住民税の決定通知書",
  retirement: "会社の退職金規程・制度の資料",
  pension: "ねんきん定期便",
  loan: "返済予定表",
  surgery: "保険証券",
} as const;
