// 6. キャッシュフロー表（現状／提案）と資産残高のグラフ
// 載せ方（帳票の入力の layout.cashflow）:
//   summary … 主要な行（収入合計・支出合計・年間収支・金融資産残高）を、現状と提案を並べて全年（標準。ページが少ない）
//   excerpt … 全部の行を、最初と最後の年・5年ごと・主なできごとの年だけ
//   full    … 全部の行・全年
// 紙の向き（layout.orientation）: 縦の紙では年を縦（行）に並べ、横の紙では年を横（列）に並べる。
// mixed（以前の形）は、この章だけ A4 横のページにする。どの形でも、表の数字は min-size より小さくしない
#import "../parts/format.typ": *
#import "../parts/layout.typ": *

/// 紙の幅から余白を除いた幅（lib.typ の余白と同じ）
#let width-portrait = 210mm - 2 * 16mm
#let width-landscape = 297mm - 2 * 16mm
#let width-mixed = 297mm - 2 * 12mm

/// 金額の列の幅（「▲1,234」が入る幅。BIZ UDゴシックの数字は半角 0.5em、▲は全角）
#let money-col(size) = size * 3.5 + 4pt

/// 要約に載せる行（現状と提案のそれぞれ）
#let summary-keys = ("incomeTotal", "expenseTotal", "net", "financial")
#let summary-labels = (incomeTotal: "収入合計", expenseTotal: "支出合計", net: "年間収支", financial: "金融資産残高")

/// 載せる年（basis.years の位置）。excerpt は最初と最後の年・5年ごと・主な出来事の年（現状と提案の両方の出来事の年 cashflow.keyYears。
/// 省略は前の版の入力で、ライフイベント表の年。0126）
#let year-index(data, mode) = {
  let years = data.basis.years
  let n = years.len()
  if mode != "excerpt" { return range(n) }
  let marked = data.cashflow.at("keyYears", default: data.events.map(e => e.year))
  range(n).filter(i => i == 0 or i == n - 1 or calc.rem(years.at(i), 5) == 0 or years.at(i) in marked)
}

/// 金額のマス（金融資産残高のマイナスは赤字・太字、合計の行は太字）
#let money-cell(r, c) = {
  let s = man(c)
  if r.key == "financial" and c != none and c < 0 { text(fill: warn, weight: "bold", s) } else if r.kind == "total" { text(weight: "bold", s) } else { s }
}

/// その年たちで値のある行か（合計の行はいつも載せる。値の行は、その年たちがすべて空・0 なら省く）
#let has-values(r, idx) = r.kind == "total" or idx.any(i => {
  let c = r.cells.at(i)
  c != none and c != 0
})

/// 年齢の表示（世帯にいない年は空）
#let age-text(a) = if a == none { "" } else { str(a) }

#let table-stroke = (x, y) => (bottom: 0.3pt + rule, top: if y == 0 { 0.8pt + ink } else { none })

// ---- 年を横（列）に並べる表（横の紙）----

/// 全部の行の表（年を列に）。行は、その年たちで値の無いものを省く
#let wide-full(data, t, idx, size, label-w) = {
  let n = idx.len()
  set text(size: size)
  let rows = ()
  for m in data.members {
    if idx.any(i => m.ages.at(i) != none) {
      rows.push((text(fill: muted, m.label + "（歳）"), ..idx.map(i => text(fill: muted, age-text(m.ages.at(i))))))
    }
  }
  let pending = none
  for r in t.rows {
    if r.kind == "group" {
      pending = r
    } else if has-values(r, idx) {
      if pending != none {
        rows.push((table.cell(colspan: n + 1, fill: band, text(weight: "bold", pending.label)),))
        pending = none
      }
      rows.push((if r.kind == "total" { text(weight: "bold", r.label) } else { "　" + r.label }, ..idx.map(i => money-cell(r, r.cells.at(i)))))
    }
  }
  table(
    columns: (label-w, ..range(n).map(_ => 1fr)),
    stroke: table-stroke,
    inset: (x: 2pt, y: 2.6pt),
    align: (x, y) => if x == 0 { left + horizon } else { right + horizon },
    fill: (x, y) => if y == 0 { band } else { none },
    table.header(text(weight: "bold", "（万円）"), ..idx.map(i => text(weight: "bold", str(data.basis.years.at(i))))),
    ..rows.flatten(),
  )
}

// ---- 年を縦（行）に並べる表（縦の紙）----

/// sizes[from..] を k 個の続いたかたまりに分けるとき、いちばん大きいかたまりが最も小さくなる分け方。
/// 返すのは (いちばん大きいかたまりの大きさ, 区切りの位置の並び)。どう分けても max を超えるときは none
#let best-cuts(sizes, from, k, max) = {
  let n = sizes.len()
  if k == 1 {
    let total = sizes.slice(from).sum(default: 0)
    return if total <= max and from < n { (total, ()) } else { none }
  }
  let best = none
  let acc = 0
  for i in range(from, n - k + 1) {
    acc += sizes.at(i)
    if acc > max { break }
    let rest = best-cuts(sizes, i + 1, k - 1, max)
    if rest != none {
      let m = calc.max(acc, rest.at(0))
      if best == none or m < best.at(0) { best = (m, (i + 1, ..rest.at(1))) }
    }
  }
  best
}

/// 全部の行の表の列を、1つの表に max 個までのかたまりに分ける（収入・支出・貯蓄と資産の区切りを優先）。
/// 返すのは表ごとの (label: 上の段の見出し, cols: 行の定義の並び) の並び
#let tall-parts(t, idx, max) = {
  let groups = ()
  let cur = none
  for r in t.rows {
    if r.kind == "group" {
      if cur != none and cur.cols.len() > 0 { groups.push(cur) }
      cur = (label: r.label, cols: ())
    } else if has-values(r, idx) {
      // 年間収支は見出しの段のかたまりを分ける（帳票の入力では支出の後ろに見出しなしで続く）
      if cur == none or r.key == "net" {
        if cur != none and cur.cols.len() > 0 { groups.push(cur) }
        cur = (label: "収支", cols: ())
      }
      cur.cols.push(r)
    }
  }
  if cur != none and cur.cols.len() > 0 { groups.push(cur) }
  // 1つのかたまりが max を超えるときは分けておく
  let pieces = ()
  for g in groups {
    pieces += balanced-chunks(g.cols.len(), max).map(((a, b)) => (label: g.label, cols: g.cols.slice(a, b)))
  }
  // かたまりの区切りで、なるべく少ない数の表に、列の数がなるべくそろうように分ける
  let sizes = pieces.map(p => p.cols.len())
  let k = 1
  let cuts = best-cuts(sizes, 0, k, max)
  while cuts == none {
    k += 1
    cuts = best-cuts(sizes, 0, k, max)
  }
  let bounds = (0, ..cuts.at(1), pieces.len())
  range(k).map(j => pieces.slice(bounds.at(j), bounds.at(j + 1)))
}

/// 年を行にした表。heads: 見出しの上の段（(label, 列の数)…）、cols: 各列の見出しと、年ごとのマスを返す関数
#let tall-table(data, idx, members, heads, cols, size) = {
  set text(size: size)
  let lead = 1 + members.len()
  // 上の段のかたまりの区切りに縦の線を引く
  let starts = ()
  let x = lead
  for (_, span) in heads {
    starts.push(x)
    x += span
  }
  table(
    columns: (auto, ..members.map(_ => auto), ..cols.map(_ => 1fr)),
    stroke: (x, y) => (
      bottom: 0.3pt + rule,
      top: if y == 0 { 0.8pt + ink } else { none },
      left: if x in starts { 0.5pt + rule } else { none },
    ),
    inset: (x: 2pt, y: 1.8pt),
    align: (x, y) => if x < lead { center + horizon } else { right + horizon },
    fill: (x, y) => if y <= 1 { band } else { none },
    table.header(
      table.cell(rowspan: 2, align: center + horizon, text(weight: "bold", "年")),
      ..members.map(m => table.cell(rowspan: 2, align: center + horizon, text(weight: "bold", m.label))),
      ..heads.map(((label, span)) => table.cell(colspan: span, align: center, text(weight: "bold", label))),
      ..cols.map(c => table.cell(align: center + bottom, text(weight: "bold", size: size - 0.5pt, c.label))),
    ),
    ..idx.map(i => (
      str(data.basis.years.at(i)),
      ..members.map(m => text(fill: muted, age-text(m.ages.at(i)))),
      ..cols.map(c => (c.cell)(i)),
    )).flatten(),
  )
}

/// 要約の表（年を行に。現状と提案の主要な行を並べる）
#let tall-summary(data, idx, size) = {
  let members = data.members.filter(m => m.key == "self" or m.key == "spouse")
  let cols = ()
  let heads = ()
  for (side, t) in (("現状", data.cashflow.current), ("提案", data.cashflow.proposal)) {
    let rs = summary-keys.map(k => t.rows.find(r => r.key == k)).filter(r => r != none)
    heads.push((side, rs.len()))
    cols += rs.map(r => (label: summary-labels.at(r.key), cell: i => money-cell(r, r.cells.at(i))))
  }
  tall-table(data, idx, members, heads, cols, size)
}

/// 全部の行の表（年を行に）。列が多いときは、収入・支出などのかたまりで表を分ける
#let tall-full(data, t, idx, size, width, first) = {
  let members = data.members.filter(m => idx.any(i => m.ages.at(i) != none))
  let fixed = 9mm + members.len() * (size * 2 + 4pt)
  let max = calc.max(4, calc.floor((width - fixed) / money-col(size)))
  let parts = tall-parts(t, idx, max)
  for (k, part) in parts.enumerate() {
    // 年の多い表は、章の最初の表のほかは新しいページから（1つの表がなるべく1ページに収まるように）
    if (k > 0 or not first) and idx.len() > 30 { pagebreak(weak: true) }
    let cols = part.map(p => p.cols).flatten().map(r => (label: r.label, cell: i => money-cell(r, r.cells.at(i))))
    let heads = part.map(p => (p.label, p.cols.len()))
    block(sticky: true, below: 4pt, text(size: 10pt, weight: "bold", t.title + if parts.len() > 1 { "（" + str(k + 1) + "/" + str(parts.len()) + "）" } else { "" }))
    tall-table(data, idx, members, heads, cols, size)
    v(8pt)
  }
}

// ---- 章 ----

/// 章の説明の文（載せ方ごと）
#let cf-sub(mode) = (
  "現状と提案の、年ごとの収入・支出・金融資産の残高です"
    + (
      if mode == "summary" { "（主な数字だけ。収入・支出の内訳は省いています）" }
      else if mode == "excerpt" { "（最初と最後の年・5年ごと・主なできごとの年だけ。間の年は省いています）" }
      else { "" }
    )
    + "。各年の額で、万円未満は四捨五入しています。金融資産残高がマイナス（赤字）の年は、金融資産が不足することを表します。"
)

#let cashflow-body(data, mode, land, width) = {
  let idx = year-index(data, mode)
  let years = data.basis.years
  let span(part) = str(years.at(part.first())) + "〜" + str(years.at(part.last())) + "年"
  if mode == "summary" {
    block(sticky: true, below: 4pt, text(size: 10pt, weight: "bold", "キャッシュフロー表（要約）　" + span(idx)))
    if land {
      // 横の紙: 年を行にした要約の表を、左右の2段に分ける（1ページに収まる年の数なら半分ずつ。多ければ段に流す）
      if idx.len() <= 64 {
        let half = calc.ceil(idx.len() / 2)
        grid(columns: (1fr, 1fr), column-gutter: 8mm, tall-summary(data, idx.slice(0, half), 7.5pt), tall-summary(data, idx.slice(half), 7.5pt))
      } else {
        columns(2, gutter: 8mm, tall-summary(data, idx, 7.5pt))
      }
    } else {
      tall-summary(data, idx, 8pt)
    }
  } else {
    // 横の紙: 7.5pt で組み、下限の 7pt にすれば表の数が減るときだけ 7pt にする
    let label-w = 30mm
    let fit(sz) = calc.floor((width - label-w) / money-col(sz))
    let size = if not land { min-size } else if calc.ceil(idx.len() / fit(7.5pt)) > calc.ceil(idx.len() / fit(min-size)) { min-size } else { 7.5pt }
    for t in (data.cashflow.current, data.cashflow.proposal) {
      if land {
        let max = fit(size)
        for (from, to) in balanced-chunks(idx.len(), max) {
          let part = idx.slice(from, to)
          block(breakable: false, below: 10pt, {
            block(below: 4pt, text(size: 10pt, weight: "bold", t.title + "　" + span(part)))
            wide-full(data, t, part, size, label-w)
          })
        }
      } else {
        tall-full(data, t, idx, size, width, t == data.cashflow.current)
      }
    }
  }
}

#let cashflow(data, band-height) = {
  let lay = layout-of(data)
  let mode = lay.cashflow
  // 説明は章の見出しの下に置く（表がページいっぱいのときに、注記だけが次のページに残らないように）
  let sub = cf-sub(mode)
  if lay.orientation == "mixed" {
    // 以前の形: この章だけ A4 横のページ
    page(flipped: true, margin: (top: 14mm, left: 12mm, right: 12mm, bottom: 12mm + band-height), {
      chapter("キャッシュフロー表", newpage: false, sub: sub)
      cashflow-body(data, mode, true, width-mixed)
    })
  } else {
    let land = lay.orientation == "landscape"
    chapter("キャッシュフロー表", sub: sub)
    cashflow-body(data, mode, land, if land { width-landscape } else { width-portrait })
  }
}
