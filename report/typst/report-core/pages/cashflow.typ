// 6. キャッシュフロー表（現状／提案）と資産残高のグラフ
#import "../parts/format.typ": *
#import "../parts/layout.typ": *

/// 1ページに載せる年の数（A4 横）
#let years-per-page = 20

#let cf-chunk(data, t, from, to) = {
  let years = data.basis.years.slice(from, to)
  let n = years.len()
  set text(size: 7.6pt)
  let rows = ()
  // 年齢の行（世帯にいる年だけ）
  for m in data.members {
    rows.push((text(fill: muted, m.label + "（歳）"), ..m.ages.slice(from, to).map(a => text(fill: muted, if a == none { "" } else { str(a) }))))
  }
  for r in t.rows {
    if r.kind == "group" {
      rows.push((table.cell(colspan: n + 1, fill: band, text(weight: "bold", r.label)),))
    } else {
      let cells = r.cells.slice(from, to).map(c => {
        let s = man(c)
        if r.key == "financial" and c != none and c < 0 { text(fill: warn, weight: "bold", s) } else if r.kind == "total" { text(weight: "bold", s) } else { s }
      })
      rows.push((if r.kind == "total" { text(weight: "bold", r.label) } else { "　" + r.label }, ..cells))
    }
  }
  table(
    columns: (42mm, ..range(n).map(_ => 1fr)),
    stroke: (x, y) => (bottom: 0.3pt + rule, top: if y == 0 { 0.8pt + ink } else { none }),
    inset: (x: 2.5pt, y: 2.9pt),
    align: (x, y) => if x == 0 { left + horizon } else { right + horizon },
    fill: (x, y) => if y == 0 { band } else { none },
    table.header(text(weight: "bold", "（万円）"), ..years.map(y => text(weight: "bold", str(y)))),
    ..rows.flatten(),
  )
}

#let cashflow(data, band-height) = {
  let n = data.basis.years.len()
  let chunks = range(0, n, step: years-per-page).map(i => (i, calc.min(i + years-per-page, n)))
  let first = true
  for t in (data.cashflow.current, data.cashflow.proposal) {
    for (from, to) in chunks {
      page(flipped: true, margin: (top: 14mm, left: 12mm, right: 12mm, bottom: 12mm + band-height), {
        if first {
          chapter("キャッシュフロー表", newpage: false, sub: "現状と提案の、年ごとの収入・支出・金融資産の残高です（各年の額。万円未満は四捨五入）。")
          first = false
        }
        block(below: 6pt, text(size: 11pt, weight: "bold", t.title + "　" + str(data.basis.years.at(from)) + "〜" + str(data.basis.years.at(to - 1)) + "年"))
        cf-chunk(data, t, from, to)
        note("金融資産残高がマイナス（赤字）の年は、預金などの金融資産が不足することを表します。")
      })
    }
  }
}
