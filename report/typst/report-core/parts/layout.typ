// 共通の部品（見出し・表・グラフの枠）。色だけに頼らず、線の形と印でも区別する
#import "format.typ": *

#let ink = rgb("#1f2933")
#let muted = rgb("#5f6b7a")
#let rule = rgb("#c9d1db")
#let band = rgb("#eef2f6")
#let accent = rgb("#1d5fa8")
#let warn = rgb("#b42318")
#let good = rgb("#1a7f4b")

/// 表の数字の文字の大きさの下限（年ごとの表を1ページに多く入れるときも、これより小さくしない）
#let min-size = 7pt

/// 帳票の組み方（帳票の入力の layout。省略は標準: 縦にそろえる・キャッシュフロー表は要約）
///   orientation: "portrait"（縦にそろえる）・"landscape"（横にそろえる）・"mixed"（年ごとの表だけ横。以前の形）
///   cashflow: "summary"（主要な行・全年）・"excerpt"（全部の行・5年ごとと主なできごとの年）・"full"（全部の行・全年）
#let layout-of(data) = {
  let l = data.at("layout", default: none)
  if l == none { l = (:) }
  (orientation: l.at("orientation", default: "portrait"), cashflow: l.at("cashflow", default: "summary"))
}

/// 横にそろえる帳票か
#let is-land(data) = layout-of(data).orientation == "landscape"

/// n 個を、1つあたり max 個までの、なるべく同じ数のかたまりに分ける（(from, to) の並び）
#let balanced-chunks(n, max) = {
  if n == 0 { return () }
  let k = calc.ceil(n / calc.max(1, max))
  let base = calc.quo(n, k)
  let extra = calc.rem(n, k)
  let out = ()
  let from = 0
  for i in range(k) {
    let len = base + if i < extra { 1 } else { 0 }
    out.push((from, from + len))
    from += len
  }
  out
}

/// 章の見出しの形（heading の level 1 に当てる。PDF のしおりにもなる）
#let chapter-style(it) = block(width: 100%, below: 10pt, {
  grid(
    columns: (auto, 1fr),
    column-gutter: 8pt,
    align: horizon,
    box(fill: accent, inset: (x: 6pt, y: 4pt), radius: 2pt, text(fill: white, weight: "bold", size: 11pt, counter(heading).display("1"))),
    text(size: 15pt, weight: "bold", fill: ink, it.body),
  )
  v(2pt)
  line(length: 100%, stroke: 0.8pt + accent)
})

/// 章（新しいページから）
#let chapter(title, sub: none, newpage: true) = {
  if newpage { pagebreak(weak: true) }
  heading(level: 1, title)
  if sub != none { block(above: 0pt, below: 8pt, text(size: 8.5pt, fill: muted, sub)) }
}

/// 小見出し
#let section(title) = block(above: 12pt, below: 6pt, text(size: 11pt, weight: "bold", fill: ink, title))

/// 注記（小さい灰色の文）
#let note(body) = block(above: 4pt, below: 4pt, text(size: 7.5pt, fill: muted, body))

/// 枠で囲んだ強調（大事な数字の一文）
#let callout(body, color: accent) = block(width: 100%, inset: 8pt, radius: 3pt, stroke: 0.8pt + color, fill: color.lighten(92%), body)

/// 数字の大きな札
#let figure-card(label, value, sub: none) = block(width: 100%, inset: 8pt, radius: 3pt, fill: band, {
  text(size: 8pt, fill: muted, label)
  linebreak()
  text(size: if value.len() > 18 { 12pt } else { 15pt }, weight: "bold", fill: ink, value)
  if sub != none { linebreak(); text(size: 8pt, fill: muted, sub) }
})

/// 表の基本の形（見出しの行は繰り返す）
#let data-table(columns: (), header: (), align: auto, size: 8.5pt, rows) = {
  set text(size: size)
  table(
    columns: columns,
    stroke: (x, y) => (bottom: 0.4pt + rule, top: if y == 0 { 0.8pt + ink } else { none }),
    fill: (x, y) => if y == 0 { band } else { none },
    inset: (x: 4pt, y: 3.2pt),
    align: if align == auto { (x, y) => if x == 0 { left + horizon } else { right + horizon } } else { align },
    table.header(..header.map(h => text(weight: "bold", h))),
    ..rows,
  )
}

/// 目盛りのよい刻み（万円の単位で）
#let nice-step(range) = {
  if range <= 0 { return 1 }
  let raw = range / 5
  let mag = calc.pow(10.0, calc.floor(calc.log(raw, base: 10)))
  let f = raw / mag
  let m = if f <= 1 { 1 } else if f <= 2 { 2 } else if f <= 5 { 5 } else { 10 }
  m * mag
}

/// 折れ線のグラフ（年を横軸、金額を縦軸。万円の目盛り）。
/// series: ((label: "提案", values: (…円…), stroke: 線, mark: "●")…)。値の縮尺を合わせるだけで、値は変えない
#let line-chart(years, series, height: 150pt, marks: ()) = {
  let n = years.len()
  if n == 0 { return none }
  let all = series.map(s => s.values).flatten().map(v => v / 10000)
  let lo = calc.min(0, ..all)
  let hi = calc.max(0, ..all)
  let step = nice-step(hi - lo)
  lo = calc.floor(lo / step) * step
  hi = calc.ceil(hi / step) * step
  if hi == lo { hi = lo + step }
  layout(size => {
    let left-w = 46pt
    let w = size.width - left-w - 4pt
    let ht = height
    let xs(i) = left-w + (if n == 1 { w / 2 } else { w * i / (n - 1) })
    let ys(v) = ht - ht * (v / 10000 - lo) / (hi - lo)
    block(width: 100%, height: ht + 44pt, inset: (top: 14pt), {
      // 目盛りの線と数字
      let t = lo
      while t <= hi + step / 1000 {
        let y = ht - ht * (t - lo) / (hi - lo)
        place(top + left, dx: left-w, dy: y, line(length: w, stroke: if t == 0 { 0.8pt + ink } else { 0.3pt + rule }))
        place(top + left, dx: 0pt, dy: y - 4pt, box(width: left-w - 4pt, align(right, text(size: 6.5pt, fill: muted, (if t < 0 { "▲" } else { "" }) + group(int(t))))))
        t += step
      }
      place(top + left, dx: 0pt, dy: -12pt, text(size: 6.5pt, fill: muted, "（万円）"))
      // 横軸の年（5年ごと）
      for (i, y) in years.enumerate() {
        let last-near = i == n - 1 and calc.rem(y, 5) != 0 and calc.rem(y, 5) <= 2 and n > 5
        if calc.rem(y, 5) == 0 or i == 0 or (i == n - 1 and not last-near) {
          place(top + left, dx: xs(i) - 12pt, dy: ht + 3pt, box(width: 24pt, align(center, text(size: 6.5pt, fill: muted, str(y)))))
        }
      }
      // 系列
      for s in series {
        let pts = s.values.enumerate().map(((i, v)) => (xs(i), ys(v)))
        if pts.len() > 1 {
          place(top + left, curve(stroke: s.stroke, curve.move(pts.at(0)), ..pts.slice(1).map(p => curve.line(p))))
        }
      }
      // 印（資産が尽きる年など）
      for m in marks {
        let i = years.position(y => y == m.year)
        if i != none {
          place(top + left, dx: xs(i) - 0.4pt, dy: 0pt, line(start: (0pt, 0pt), end: (0pt, ht), stroke: (paint: warn, thickness: 0.6pt, dash: "dashed")))
          place(top + left, dx: xs(i) + 2pt, dy: 2pt, text(size: 6.5pt, fill: warn, m.label))
        }
      }
      // 凡例
      place(top + left, dx: left-w, dy: ht + 16pt, {
        set text(size: 7pt)
        for s in series {
          box(baseline: -2.5pt, line(length: 16pt, stroke: s.stroke))
          h(3pt)
          box(s.label)
          h(12pt)
        }
      })
    })
  })
}

/// 年を行にした縦の表（YearTable）。列の数が多いときは文字を小さくする
#let year-table(t, size: 7.5pt, unit: "万円", ages: true) = {
  let cols = t.columns.len()
  let lead = if ages { 2 } else { 1 }
  data-table(
    columns: (auto, ..if ages { (auto,) } else { () }, ..range(cols).map(_ => 1fr)),
    header: ("年", ..if ages { ("年齢",) } else { () }, ..t.columns.map(c => c + "（" + unit + "）")),
    size: size,
    align: (x, y) => if x < lead { left + horizon } else { right + horizon },
    t.rows.map(r => (str(r.year), ..if ages { (text(fill: muted, r.ages),) } else { () }, ..r.cells.map(c => man(c)))).flatten(),
  )
}

/// バランスシートの行の見出しと金額（kind: item・sub（内訳。字下げ・小さく）・total（太字））
#let sheet-label(line) = if line.kind == "sub" { text(fill: muted, "　" + line.label) } else if line.kind == "total" { text(weight: "bold", line.label) } else { line.label }
#let sheet-amount(line, v) = if line.kind == "total" { text(weight: "bold", man(v)) } else if line.kind == "sub" { text(fill: muted, man(v)) } else { man(v) }

/// 1つの時点のバランスシート（左に資産、右に負債と純資産。万円）。col は列（時点）の位置
#let sheet-pair(view, col: 0, size: 8.5pt) = {
  let assets = view.assets
  let liab = view.liabilities
  let net = view.netWorth.at(col)
  let total-a = assets.last().amounts.at(col)
  // 右は 負債の行・純資産・負債と純資産の合計。左右の合計の行をそろえる（短い側に空の行を足す）
  let right = (..liab.map(l => (sheet-label(l), sheet-amount(l, l.amounts.at(col)))), (text(weight: "bold", "純資産"), text(weight: "bold", fill: if net < 0 { warn } else { ink }, man(net))))
  let left = assets.slice(0, assets.len() - 1).map(l => (sheet-label(l), sheet-amount(l, l.amounts.at(col))))
  let n = calc.max(left.len(), right.len())
  let pad(xs) = xs + range(n - xs.len()).map(_ => ("", ""))
  let side(rows, total-label, total) = data-table(
    columns: (1fr, auto),
    header: rows.at(0),
    size: size,
    (..rows.slice(1).flatten(), text(weight: "bold", total-label), text(weight: "bold", man(total))),
  )
  grid(
    columns: (1fr, 1fr),
    column-gutter: 8pt,
    side((("資産", "万円"), ..pad(left)), "資産の合計", total-a),
    side((("負債・純資産", "万円"), ..pad(right)), "負債と純資産の合計", liab.last().amounts.at(col) + net),
  )
}

/// 年の抜粋のバランスシート（行は資産・負債・純資産、列は時点。万円）。extra は表の最後に足す行（(label, amounts) の組。灰色）
#let sheet-table(view, extra: (), size: 8pt) = {
  let cols = view.points.len()
  let row(l) = (sheet-label(l), ..l.amounts.map(v => sheet-amount(l, v)))
  let group-row(label) = (table.cell(colspan: cols + 1, fill: band.lighten(40%), text(weight: "bold", size: size - 0.5pt, label)),)
  data-table(
    columns: (auto, ..range(cols).map(_ => 1fr)),
    header: ("（万円）", ..view.points.map(p => p.label + "\n" + str(p.year) + "年")),
    size: size,
    (
      ..group-row("資産"),
      ..view.assets.map(row).flatten(),
      ..group-row("負債"),
      ..view.liabilities.map(row).flatten(),
      text(weight: "bold", "純資産"),
      ..view.netWorth.map(v => text(weight: "bold", fill: if v < 0 { warn } else { ink }, man(v))),
      ..extra.map(((label, amounts)) => (text(fill: muted, label), ..amounts.map(v => text(fill: muted, man(v))))).flatten(),
    ),
  )
}
