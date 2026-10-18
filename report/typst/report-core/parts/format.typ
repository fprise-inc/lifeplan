// 表示の書式（計算ではない）。金額は円の整数で受け取り、3桁区切り・万円への丸め（四捨五入・符号は対称）・マイナスの「▲」だけを行う。
// アプリの画面の書式（app/src/presentation/format.ts）と同じ規則

/// 3桁ごとのカンマ（符号は付けない）
#let group(n) = {
  let s = str(calc.abs(n))
  let len = s.len()
  let out = ""
  for (i, ch) in s.clusters().enumerate() {
    if i > 0 and calc.rem(len - i, 3) == 0 { out += "," }
    out += ch
  }
  out
}

/// 万円の数（四捨五入。符号は対称）
#let to-man(yen) = {
  let v = calc.quo(calc.abs(yen) + 5000, 10000)
  if yen < 0 { -v } else { v }
}

/// 万円の文字列（単位なし）: 50920000 → "5,092"、-20270000 → "▲2,027"。none は空
#let man(yen) = if yen == none { "" } else {
  let v = to-man(yen)
  (if v < 0 { "▲" } else { "" }) + group(v)
}

/// 万円の文字列（単位つき）
#let man-unit(yen) = if yen == none { "—" } else { man(yen) + "万円" }

/// 差の万円（＋／▲つき）
#let man-diff(yen) = if yen == none { "—" } else {
  let v = to-man(yen)
  if v == 0 { "±0万円" } else { (if v > 0 { "+" } else { "▲" }) + group(v) + "万円" }
}

/// 円の文字列: 3012537 → "3,012,537円"
#let yen(n) = if n == none { "—" } else { (if n < 0 { "▲" } else { "" }) + group(n) + "円" }

/// 差の円（＋／▲つき）
#let yen-diff(n) = if n == none { "—" } else if n == 0 { "±0円" } else { (if n > 0 { "+" } else { "▲" }) + group(n) + "円" }

/// 年の差（＋○年）
#let year-diff(n) = if n == none { "—" } else if n == 0 { "変わらない" } else if n > 0 { str(n) + "年遅く" } else { str(-n) + "年早く" }

/// 日付（YYYY-MM-DD → YYYY年M月D日）
#let date-ja(s) = {
  let p = s.split("-")
  p.at(0) + "年" + str(int(p.at(1))) + "月" + str(int(p.at(2))) + "日"
}
