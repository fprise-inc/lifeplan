// お金の3つの分け方（説明用の図。0032）: アプリの「資産と負債」のタブの区画と同じ値・同じ言葉（帳票の入力の moneyThree。report/src/moneyThree.ts が作る）。
// 左＝使う時期で分けた3つの箱（上ほどすぐ使う。薄い色＋同じ色相の枠）、右＝今の置き場所（バランスシートの図と同じ色）。左右は同じ縮尺。
// 分け方と置き場所のずれ（預金などのままの分・足りない分）は図に描かず、上の囲みの文で示す（アプリの画面と同じ）。
// 3つの箱の中身は同じ形（名前と額・中身の一文・中身の一覧・まとめ・ひと言）で、貯めるお金の全部の年の表を下に置く。計算し直さず、書式だけを当てる
#import "../parts/format.typ": *
#import "../parts/layout.typ": *

#let m3-fill = (rgb("#f4e4cc"), rgb("#dfeadb"), rgb("#dde5f3"))
#let m3-line = (rgb("#b98a4a"), rgb("#6f9a68"), rgb("#7088b8"))

/// 文の並び（strong は太字・藍）
#let m3-parts(ps) = ps.map(p => if p.at("strong", default: false) { text(weight: "bold", fill: accent, p.text) } else { p.text }).join()

#let m3-place-color(l) = if l.key == "pooledCash" { bs-colors.liquid } else { bs-colors.at(l.group, default: band) }

/// 図（左右の2列。左右は同じ縮尺）
#let m3-figure(m, w: 82mm, h: 170pt) = {
  let total = calc.max(m.place.total, m.need, 1)
  let k = h / total
  let mid = 12mm
  let colw = (w - mid) / 2
  let xr = colw + mid
  let top = 24pt
  let sum = m.boxes.map(b => b.amount).sum()
  let tile(x, y, bh, fill, stroke, body) = {
    if bh > 0.4pt {
      let g = if bh > bs-gap * 2.5 { bs-gap / 2 } else { 0pt }
      place(dx: x, dy: y + g, rect(width: colw, height: bh - g * 2, fill: fill, stroke: stroke, radius: calc.min(bs-radius, bh / 2), inset: (x: 3pt), body))
    }
  }
  let label(bh, name, amount, color) = if bh >= 13pt {
    set text(size: min-size, weight: "bold", fill: color)
    align(horizon, grid(columns: (1fr, auto), name, man(amount)))
  }
  let yF = top + k * m.place.total
  box(width: w, height: top + h + 6pt, {
    place(dx: 0pt, dy: 0pt, box(width: colw, align(center, text(size: min-size, fill: muted, "いつ使うお金か") + linebreak() + text(size: 9pt, weight: "bold", man-unit(sum)))))
    place(dx: xr, dy: 0pt, box(width: colw, align(center, text(size: min-size, fill: muted, "今どこにあるか") + linebreak() + text(size: 9pt, weight: "bold", man-unit(m.place.total)))))
    let y = top
    for (i, b) in m.boxes.enumerate() {
      let bh = k * b.amount
      tile(0pt, y, bh, m3-fill.at(i), 0.8pt + m3-line.at(i), label(bh, b.name, b.amount, ink))
      y += bh
    }
    y = top
    for l in m.place.lines {
      let bh = k * l.amount
      tile(xr, y, bh, m3-place-color(l), none, label(bh, l.label, l.amount, white))
      y += bh
    }
    // 金融資産の合計でも足りない分（右の列の下に点線の空箱）
    if m.overFinancial > 0 {
      let bh = k * m.overFinancial
      tile(xr, yF, bh, white, (paint: muted, thickness: 0.7pt, dash: "dashed"), if bh >= 13pt { align(horizon + center, text(size: min-size, fill: muted, weight: "bold", "金融資産で足りない分")) })
    }
    place(dx: 0pt, dy: top + h + 1pt, line(length: w, stroke: 0.5pt + rule))
  })
}

/// 1つの箱のカード（3枚とも同じ形）
#let m3-card(b, i) = block(width: 100%, inset: (x: 7pt, y: 6pt), radius: 3pt, stroke: 0.5pt + rule, breakable: false, {
  grid(
    columns: (auto, 1fr, auto),
    column-gutter: 5pt,
    align: horizon,
    box(width: 8pt, height: 8pt, fill: m3-fill.at(i), stroke: 0.8pt + m3-line.at(i), radius: 1.5pt),
    text(size: 9.5pt, weight: "bold", b.name),
    text(size: 11pt, weight: "bold", man(b.amount)) + text(size: 7pt, weight: "bold", "万円"),
  )
  block(above: 3pt, below: 3pt, text(size: 7.5pt, fill: muted, b.formula))
  if b.items.len() > 0 or b.rest != none {
    set text(size: 7.5pt)
    // 先頭の文字（年・符号）が1つも無い一覧は、その列を詰める
    let lead = b.items.any(it => it.lead != "")
    let row(l, label, amount) = (..if lead { (text(fill: muted, l),) } else { () }, label, align(right, amount))
    grid(
      columns: if lead { (2.4em, 1fr, auto) } else { (1fr, auto) },
      column-gutter: 4pt,
      row-gutter: 2.5pt,
      ..b.items.map(it => row(it.lead, it.label, text(weight: "bold", it.per + man(it.amount)) + text(size: 6.5pt, "万円"))).flatten(),
      ..if b.rest != none { row("", text(fill: muted, "ほか" + str(b.rest.count) + "件"), text(weight: "bold", man(b.rest.amount)) + text(size: 6.5pt, "万円")) } else { () },
    )
  }
  if b.note != none { block(above: 3pt, below: 0pt, text(size: 7pt, fill: muted, b.note)) }
})

#let money-three(data) = {
  let m = data.at("moneyThree", default: none)
  if m == none { return }
  chapter("お金の3つの分け方", sub: "提案のプラン・" + str(m.year) + "年の時点。説明用の図です。キャッシュフロー表・結果の計算には混ぜません")
  callout({
    text(size: 10pt, weight: "bold", m3-parts(m.say.head))
    if m.say.sub.len() > 0 { linebreak(); text(size: 8pt, fill: muted, m3-parts(m.say.sub)) }
    if m.say.eq != none { linebreak(); text(size: 7.5pt, fill: muted, m.say.eq) }
  })
  v(4pt)
  let land = is-land(data)
  grid(
    columns: (if land { 100mm } else { 84mm }, 1fr),
    column-gutter: 10pt,
    {
      m3-figure(m, w: if land { 100mm } else { 82mm }, h: if land { 150pt } else { 190pt })
      v(4pt)
      text(size: 7pt, fill: muted, {
        "今どこにあるか："
        m.place.lines.map(l => l.label + " " + man-unit(l.amount)).join("・")
      })
    },
    stack(dir: ttb, spacing: 5pt, ..m.boxes.enumerate().map(((i, b)) => m3-card(b, i))),
  )
  if m.table.len() > 0 {
    section(m.names.at(1) + "の内訳（" + m.range + "の全部の年）")
    table(
      columns: (auto, 1fr, auto, auto, auto),
      stroke: (x, y) => if y == 0 { (bottom: 0.6pt + ink) } else { (bottom: 0.4pt + rule) },
      inset: (x: 4pt, y: 3pt),
      align: (x, y) => if x >= 2 { right } else { left },
      table.header(..("年", "できごと", "支出", "収入の残り", "賄えない分").map(t => text(size: 7.5pt, weight: "bold", fill: muted, t))),
      ..m.table.map(r => (str(r.year), r.label, man(r.expense), man(r.leftover), text(fill: if r.uncovered > 0 { ink } else { muted }, man(r.uncovered)))).flatten().map(c => text(size: 7.5pt, c)),
      text(size: 7.5pt, weight: "bold", "合計"), "", "", "", text(size: 7.5pt, weight: "bold", man(m.boxes.at(1).amount)),
    )
    note("金額は万円。収入の残り＝その年の手取り収入から、ふだんの支出（基本生活費・住まい・保険料など毎年続く支出）を引いた額。できごとの支出がそれより小さい年は 0 で、黒字は次の年に繰り越しません。" + if m.clipped != none { m.clipped } else { "" })
  }
}
