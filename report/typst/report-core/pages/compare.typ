// 13. 案の比較（現状と、FP が選んだ案。主画面の「比較の表」と同じ数字。差はいつも「その案−基準」）
#import "../parts/format.typ": *
#import "../parts/layout.typ": *

#let depletion-text(v) = if v == none { "尽きない" } else { str(v) + "年" }

/// 基準との差の文（資産が尽きる年は、尽きる・尽きないの変わり方も言葉で出す）
#let compare-diff(row, i, base) = {
  if i == base { return [] }
  let d = row.diffs.at(i)
  if row.unit == "year" {
    let v = row.values.at(i)
    let b = row.values.at(base)
    if v == none and b == none { [] }
    else if v == none { "尽きなくなる" }
    else if b == none { "尽きるようになる" }
    else { year-diff(d) }
  } else { man-diff(d) }
}

#let comparison(data, newpage: true) = {
  let c = data.comparison
  chapter("案の比較", newpage: newpage, sub: "現状と、ご検討いただいた案の主な数字です。差は基準（" + c.columns.at(c.base).letter + "案）との差です。")
  let n = c.columns.len()
  let head = ("",) + c.columns.enumerate().map(((i, col)) => {
    text(weight: "bold", col.letter + "案") + if i == c.base { text(fill: muted, "（基準）") } else { [] }
    linebreak()
    text(size: 7.5pt, weight: "regular", col.name)
  })
  // narrow: 列の狭い表（行と列を入れ替えたとき）は、額の年を次の行に出す
  let cell-of(row, i, narrow: false) = {
    let v = row.values.at(i)
    let at-year = row.years.len() > i and row.years.at(i) != none
    let main = if row.unit == "year" { depletion-text(v) } else if at-year and narrow {
      [#man-unit(v)#linebreak()#text(size: 7pt, "（" + str(row.years.at(i)) + "年）")]
    } else {
      man-unit(v) + if at-year { "（" + str(row.years.at(i)) + "年）" } else { "" }
    }
    let d = compare-diff(row, i, c.base)
    align(right, {
      text(fill: if row.unit == "yen" and v != none and v < 0 { warn } else { ink }, main)
      if d != [] { linebreak(); text(size: 7.5pt, fill: muted, d) }
    })
  }
  let cells = c.rows.map(row => (text(size: 8.5pt, row.label),) + range(n).map(i => cell-of(row, i))).flatten()
  // 縦の紙で案が多い（4案より多い）ときは、行と列を入れ替える（案を行、数字の項目を列に）
  let transpose = layout-of(data).orientation == "portrait" and n > 4
  if transpose {
    data-table(
      columns: (1.3fr,) + c.rows.map(_ => 1fr),
      header: ("",) + c.rows.map(row => text(size: 7.5pt, row.label)),
      align: (x, y) => if x == 0 { left + horizon } else { right + horizon },
      size: 8pt,
      c.columns.enumerate().map(((i, col)) => {
        (
          {
            text(weight: "bold", col.letter + "案") + if i == c.base { text(fill: muted, "（基準）") } else { [] }
            linebreak()
            text(size: 7pt, col.name)
          },
          ..c.rows.map(row => cell-of(row, i, narrow: true)),
        )
      }).flatten(),
    )
  } else {
    data-table(
      columns: (1.5fr,) + range(n).map(_ => 1fr),
      header: head,
      align: (x, y) => if x == 0 { left + horizon } else { right + horizon },
      size: 8.5pt,
      cells,
    )
  }
  note("金額は万円未満を四捨五入しています。生涯の合計は、表の期間（" + str(data.basis.years.first()) + "年〜" + str(data.basis.years.last()) + "年）の合計です。")
}
