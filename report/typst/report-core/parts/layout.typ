// 共通の部品（見出し・表・グラフの枠）。色だけに頼らず、線の形と印でも区別する
#import "format.typ": *

#let ink = rgb("#1f2933")
#let muted = rgb("#5f6b7a")
#let rule = rgb("#c9d1db")
#let band = rgb("#eef2f6")
// アクセントの色（見出しの番号の箱・見出しの線・グラフの提案の線など）。事務所の見た目（0121）で事務所の基調の色にできる:
// アプリは白地で読める濃さに直した色を sys.inputs の lifeplan-accent に入れる。無ければ標準の色
#let accent = rgb(sys.inputs.at("lifeplan-accent", default: "#1d5fa8"))
/// 資産と負債の図の純資産の金額の色（標準のアクセントの色のまま。事務所の色で科目の色を変えない。0121）
#let bs-net-ink = rgb("#1d5fa8")
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

/// 見本の世帯でだけ載せた拡張の章の印（0197。見出しの下。公式の帳票が付ける）
#let sample-mark = block(width: 100%, above: 0pt, below: 8pt, inset: (x: 8pt, y: 5pt), radius: 3pt, stroke: (paint: muted, thickness: 0.8pt, dash: "dashed"), {
  box(inset: (x: 4pt, y: 1pt), radius: 2pt, stroke: 0.8pt + muted, text(size: 8pt, weight: "bold", fill: muted, "見本"))
  h(6pt)
  text(size: 8pt, fill: muted, "見本の世帯（架空）なので、機能を有効にするコードが無くても載せています。お客さまの世帯の提案書に載せるには、コードが要ります。")
})

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

// ---- 金融資産が足りなくなる所の印（アプリの画面のグラフと同じ形）----
// 「!」の丸を、グラフの面のすぐ下（年の目盛りのすぐ上）の専用の段に置き、線が0を切る所（前の年の金額と足りなくなる年の金額を直線で結んで0になる所）から赤い点線でつなぐ。
// 丸も同じ横の位置を基準に置く。図の下の説明の年・年齢は初めて足りなくなる年
// 選んだプラン（提案・万一の場合）は赤の塗りに白い「!」、基準のプラン（現状・万一なし）は白抜きに赤い「!」。
// 白黒で刷っても分かれるように、白抜きの枠は太めにし、点線は丸い点の並び（系列の破線とも目盛りの細い線とも違う形）にする

/// 「!」の丸の半径と、段の高さ（丸の直径と、上の余白 3pt・下の余白 2pt）
#let short-r = 4.6pt
#let short-row = 2 * short-r + 5pt
/// 線が0を切る所から「!」までの点線
#let short-stroke = (paint: warn, thickness: 1.2pt, dash: "dotted", cap: "round")

/// 「!」の丸（base: 基準のプランの白抜き）。グラフの段と、図の下の説明の両方で使う
#let short-dot(base: false) = box(width: 2 * short-r, height: 2 * short-r, {
  place(top + left, circle(radius: short-r, fill: if base { white } else { warn }, stroke: (if base { 1.1pt } else { 0.6pt }) + warn))
  place(center + horizon, text(size: 7pt, weight: "bold", fill: if base { warn } else { white }, "!"))
})

/// 丸の x を、重ならないように並べ直す（近い丸はまとめて、元の位置の平均を中心に gap の間隔で並べる。lo〜hi の中に収める）。
/// アプリの画面のグラフ（presentation の chart.ts の spreadX）と同じ決め方
#let spread-x(xs, gap, lo, hi) = {
  let order = range(xs.len()).sorted(key: i => xs.at(i).pt())
  let left-of(ids, sum) = {
    let span = (ids.len() - 1) * gap
    calc.max(lo, calc.min(hi - span, sum / ids.len() - span / 2))
  }
  let groups = ()
  for i in order {
    let x = xs.at(i)
    groups.push((ids: (i,), sum: x, left: left-of((i,), x)))
    // 前のまとまりと重なる間は1つにまとめる
    while groups.len() >= 2 {
      let b = groups.at(-1)
      let a = groups.at(-2)
      if a.left + a.ids.len() * gap <= b.left + 0.01pt { break }
      let ids = a.ids + b.ids
      let sum = a.sum + b.sum
      let _ = groups.pop()
      let _ = groups.pop()
      groups.push((ids: ids, sum: sum, left: left-of(ids, sum)))
    }
  }
  let out = xs.map(_ => 0pt)
  for g in groups {
    for (k, id) in g.ids.enumerate() { out.at(id) = g.left + k * gap }
  }
  out
}

/// 線が0を切る所の位置（年の番号を小数で）: 前の年（i − 1）の金額と初めて足りなくなる年（i）の金額を直線で結び、0 になる所。
/// 前の年が無い（最初の年からマイナス）・前の年もマイナスのとき（金額の並びが無いときも）は i。アプリの画面のグラフ（presentation の ShortMark.tsx の crossIndex）と同じ決め方
#let cross-index(v, i) = {
  if v == none or i <= 0 or i >= v.len() { return i }
  let a = v.at(i - 1)
  let b = v.at(i)
  if a < 0 or b >= 0 { return i }
  i - 1 + a / (a - b)
}

/// 現状と提案の「!」（帳票の入力の summary と資産の推移の金額から。現状は白抜き）
#let plan-shorts(data) = {
  let s = data.summary
  let out = ()
  if s.current.depletion != none { out.push((year: s.current.depletion.year, values: data.assets.current, base: true, label: "現状 " + s.current.depletion.label)) }
  if s.proposal.depletion != none { out.push((year: s.proposal.depletion.year, values: data.assets.proposal, base: false, label: "提案 " + s.proposal.depletion.label)) }
  out
}

/// 図の下の説明（紙ではカーソルの札が出せないので、画面の札と同じ言葉で年を書く）。選んだプランを先に書く
#let short-note(shorts) = {
  if shorts.len() == 0 { return none }
  block({
    set text(size: 7pt, fill: ink)
    [金融資産が足りなくなる年]
    for m in shorts.sorted(key: m => if m.base { 1 } else { 0 }) {
      h(8pt)
      box(baseline: 1.9pt, short-dot(base: m.base))
      h(2.5pt)
      m.label
    }
  })
}

/// 折れ線のグラフ（年を横軸、金額を縦軸。万円の目盛り）。
/// series: ((label: "提案", values: (…円…), stroke: 線, mark: "●")…)。値の縮尺を合わせるだけで、値は変えない。
/// shorts: 金融資産が足りなくなる所の「!」（(year: 初めて足りなくなる年, values: その線の金額の並び, base: 白抜きか, label: 図の下の説明の文)…。
/// 年が表の期間に無いものは描かない。点線と丸の横の位置は、values の線が0を切る所（cross-index）
#let line-chart(years, series, height: 150pt, shorts: ()) = {
  let n = years.len()
  if n == 0 { return none }
  let shorts = shorts.filter(m => years.contains(m.year))
  // 「!」の段（あるときだけ、面と年の目盛りの間に設ける）
  let row = if shorts.len() > 0 { short-row } else { 0pt }
  let all = series.map(s => s.values).flatten().map(v => v / 10000)
  let lo = calc.min(0, ..all)
  let hi = calc.max(0, ..all)
  let step = nice-step(hi - lo)
  lo = calc.floor(lo / step) * step
  hi = calc.ceil(hi / step) * step
  if hi == lo { hi = lo + step }
  let chart = layout(size => {
    let left-w = 46pt
    let w = size.width - left-w - 4pt
    let ht = height
    let xs(i) = left-w + (if n == 1 { w / 2 } else { w * i / (n - 1) })
    let ys(v) = ht - ht * (v / 10000 - lo) / (hi - lo)
    block(width: 100%, height: ht + row + 44pt, inset: (top: 14pt), {
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
          place(top + left, dx: xs(i) - 12pt, dy: ht + row + 3pt, box(width: 24pt, align(center, text(size: 6.5pt, fill: muted, str(y)))))
        }
      }
      // 系列
      for s in series {
        let pts = s.values.enumerate().map(((i, v)) => (xs(i), ys(v)))
        if pts.len() > 1 {
          place(top + left, curve(stroke: s.stroke, curve.move(pts.at(0)), ..pts.slice(1).map(p => curve.line(p))))
        }
      }
      // 金融資産が足りなくなる所: 線が0を切る所から面の下の端までまっすぐ下ろし、そこから「!」の丸へ折る点線と、段の丸（近い丸は横に並べる）
      if shorts.len() > 0 {
        let x0 = shorts.map(m => xs(cross-index(m.at("values", default: none), years.position(y => y == m.year))))
        let at = spread-x(x0, 2 * short-r + 1.5pt, left-w + short-r, left-w + w - short-r)
        let cy = ht + 3pt + short-r
        for (j, m) in shorts.enumerate() {
          place(top + left, curve(stroke: short-stroke, curve.move((x0.at(j), ys(0))), curve.line((x0.at(j), ht)), curve.line((at.at(j), cy - short-r))))
        }
        for (j, m) in shorts.enumerate() {
          place(top + left, dx: at.at(j) - short-r, dy: cy - short-r, short-dot(base: m.base))
        }
      }
      // 凡例
      place(top + left, dx: left-w, dy: ht + row + 16pt, {
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
  // 図の下の説明は図とひとかたまりにする（図と説明の間は詰め、説明の後ろは「!」が無いときの図と同じ間隔）
  if shorts.len() == 0 { chart } else { stack(dir: ttb, spacing: 2pt, chart, short-note(shorts)) }
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

/// 時点の呼び方を、名前（「退職の年」「ご本人75歳」）と、かっこの中（「ご本人65歳」。無ければ none）に分ける
#let bs-point-parts(label) = {
  let i = label.position("（")
  if i == none { (label, none) } else { (label.slice(0, i), label.slice(i + "（".len()).trim("）", at: end)) }
}

/// 年の抜粋のバランスシート（行は資産・負債・純資産、列は時点。万円）。extra は表の最後に足す行（(label, amounts) の組。灰色）
#let sheet-table(view, extra: (), size: 8pt) = {
  let cols = view.points.len()
  let row(l) = (sheet-label(l), ..l.amounts.map(v => sheet-amount(l, v)))
  let group-row(label) = (table.cell(colspan: cols + 1, fill: band.lighten(40%), text(weight: "bold", size: size - 0.5pt, label)),)
  data-table(
    columns: (auto, ..range(cols).map(_ => 1fr)),
    // 見出しは名前・かっこの中（年齢）・年の行に分ける（列が狭くても名前の途中で折り返さない）
    header: ("（万円）", ..view.points.map(p => {
      let (name, sub) = bs-point-parts(p.label)
      name + if sub != none { "\n" + sub } else { "" } + "\n" + str(p.year) + "年"
    })),
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

// ---- バランスシートの図（アプリの「資産と負債」のタブと同じ分け方・色。時点を並べ、共通の縮尺）----

// 箱の中の文字はどれも白（7pt の太字で小さい文字なので、どの色も白い文字との差 4.5:1 以上）。色は画面の balance.css と同じ（意味で色相を分ける:
// 資産は青の仲間で、すぐ使えるお金ほどあざやか・換金しにくい資産は灰色がかった青、負債は茶、純資産はアプリの藍の仲間）。
// 隣り合う箱は明るさを交互にして、白黒で印刷しても分かれる（建物は土地より明るい: 年数とともに減っていく資産）
#let bs-colors = (
  liquid: rgb("#0f61a5"),
  market: rgb("#007fa4"),
  locked: rgb("#00524d"),
  illiquid: rgb("#4f6079"),
  land: rgb("#4f6079"),
  building: rgb("#6a7780"),
  illiquidOther: rgb("#414f5a"),
  mortgage: rgb("#a46738"),
  propertyLoan: rgb("#4a2712"),
  debt: rgb("#65411f"),
  netWorth: rgb("#355ba4"),
)
// 箱の形: 箱の間に細い余白を空け、角を少し丸める（画面の図と同じ形）
#let bs-gap = 1.5pt
#let bs-radius = 3pt
#let bs-short = (liquid: "すぐ使える", market: "値動きあり", locked: "引き出せない", illiquid: "換金しにくい", land: "土地", building: "建物", illiquidOther: "車・その他", mortgage: "住宅ローン", propertyLoan: "不動産のローン", debt: "その他の負債", netWorth: "純資産")

/// 1本の柱（箱を上から積む）。total はこの柱の額、h は縮尺の高さ（scale の額に当たる）
/// labels: true なら箱の中に入力の label をそのまま書く（会社と合わせたバランスシートの「会社の財産」「個人の財産」など。0107）
#let bs-column(boxes, total, scale, h, w, fact, neg: 0, labels: false) = {
  let colh = h * (total + neg) / scale
  // 箱はどれも枠線なしのベタ塗り（純資産も同じ）。箱の間に細い余白、角は少し丸める。柱を囲む枠は描かない（見込みかどうかは時点の札で示す）
  // 外の箱は金額に比例した高さ（余白を含む）、中の箱はその高さから余白を引いた形。ごく薄い箱は余白で消えないよう余白なし
  let tile(bh, fill, stroke: none, body) = {
    let g = if bh > bs-gap * 2.5 { bs-gap / 2 } else { 0pt }
    block(width: 100%, height: bh, inset: (y: g), spacing: 0pt,
      block(width: 100%, height: 100%, fill: fill, stroke: stroke, radius: calc.min(bs-radius, bh / 2 - g), inset: (x: 3pt), spacing: 0pt, body))
  }
  let cells = boxes.map(b => {
    let bh = colh * b.amount / (total + neg)
    let fill = bs-colors.at(b.key, default: band)
    tile(bh, fill, {
      if bh >= 15pt {
        set text(size: min-size, fill: if b.key in bs-colors { white } else { ink }, weight: "bold")
        align(horizon, stack(dir: ttb, spacing: 1pt, if labels { b.label } else { bs-short.at(b.key, default: b.label) }, man(b.amount)))
      }
    })
  })
  if neg > 0 {
    let nh = colh * neg / (total + neg)
    cells.push(tile(nh, white, stroke: (paint: muted, thickness: 0.7pt, dash: "dashed"), {
      if nh >= 15pt { align(horizon, text(size: min-size, fill: muted, weight: "bold", "足りない分\n▲" + man(neg))) }
    }))
  }
  box(width: w, height: h, align(bottom, block(width: w, height: colh, spacing: 0pt, stack(dir: ttb, ..cells))))
}

/// 図の見出しの短い呼び方（例: 今・退職の年・75歳）。本人の年齢の時点は本人の呼び方を外す
#let bs-point-short(label, who) = {
  let name = bs-point-parts(label).at(0)
  if who != none and name.starts-with(who) and name.ends-with("歳") { name.slice(who.len()) } else { name }
}

/// バランスシートの図（時点を横に並べる。2〜4つ）。figure は帳票の入力の balanceSheet.figure
/// 見出しは1行目に時点の名前と札、2行目に年末とかっこの中（年齢）。4つ並べても見出しが折り返さず、図の下端がそろう
#let bs-figure(figure, height: 150pt) = {
  let cols = figure.columns
  grid(
    columns: cols.map(_ => 1fr),
    column-gutter: if cols.len() >= 4 { 7pt } else { 10pt },
    ..cols.map(c => block(width: 100%, inset: 6pt, radius: 3pt, stroke: 0.5pt + rule, {
      let (name, sub) = bs-point-parts(c.point.label)
      grid(
        columns: (1fr, auto),
        column-gutter: 4pt,
        text(size: 9pt, weight: "bold", name),
        box(inset: (x: 3pt, y: 1pt), radius: 2pt, stroke: if c.fact { 0.6pt + ink } else { 0.6pt + muted }, fill: if c.fact { ink } else { white }, text(size: min-size, weight: "bold", fill: if c.fact { white } else { muted }, if c.fact { "事実（今）" } else { "見込み" })),
      )
      text(size: min-size, fill: muted, str(c.point.year) + "年末" + if sub != none { "・" + sub } else { "" })
      v(2pt)
      grid(
        columns: (1fr, 1fr),
        column-gutter: 4pt,
        align(center, text(size: min-size, fill: muted, "資産 " + man(c.totalAssets))),
        align(center, text(size: min-size, fill: muted, "負債＋純資産")),
      )
      grid(
        columns: (1fr, 1fr),
        column-gutter: 4pt,
        bs-column(c.assets, c.totalAssets, figure.scale, height, 100%, c.fact, neg: c.negative),
        bs-column(c.liabilities, c.totalLiabilities + calc.max(0, c.netWorth), figure.scale, height, 100%, c.fact),
      )
      v(3pt)
      text(size: 8.5pt, weight: "bold", [純資産 #text(fill: if c.netWorth < 0 { muted } else { bs-net-ink }, man-unit(c.netWorth))])
      linebreak()
      // 4つ並べると幅が狭いので、金融資産と負債を2行に分ける
      text(size: min-size, fill: muted, "金融資産 " + man-unit(c.financial) + if cols.len() >= 4 { "\n" } else { "・" } + "負債 " + man-unit(c.totalLiabilities))
    })),
  )
}
