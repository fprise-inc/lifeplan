// 資産運用の計画（運用の期間の図・口座ごとの推移・資産の内訳）と、相場が下がった場合（0026）
#import "../parts/format.typ": *
#import "../parts/layout.typ": *

/// 口座ごとの積み上げの面のグラフ（年を横軸、万円の目盛り）。series: ((label, color, values)…)。値は変えない
#let stack-chart(years, series, height: 150pt) = {
  let n = years.len()
  if n == 0 or series.len() == 0 { return none }
  let tops = range(n).map(i => series.map(s => calc.max(0, s.values.at(i))).sum())
  let hi = calc.max(1, ..tops) / 10000
  let step = nice-step(hi)
  hi = calc.ceil(hi / step) * step
  layout(size => {
    let left-w = 46pt
    let w = size.width - left-w - 4pt
    let ht = height
    let xs(i) = left-w + (if n == 1 { w / 2 } else { w * i / (n - 1) })
    let ys(v) = ht - ht * (v / 10000) / hi
    block(width: 100%, height: ht + 44pt, inset: (top: 14pt), {
      let t = 0
      while t <= hi + step / 1000 {
        let y = ht - ht * t / hi
        place(top + left, dx: left-w, dy: y, line(length: w, stroke: if t == 0 { 0.8pt + ink } else { 0.3pt + rule }))
        place(top + left, dx: 0pt, dy: y - 4pt, box(width: left-w - 4pt, align(right, text(size: 6.5pt, fill: muted, group(int(t))))))
        t += step
      }
      place(top + left, dx: 0pt, dy: -12pt, text(size: 6.5pt, fill: muted, "（万円）"))
      for (i, y) in years.enumerate() {
        if calc.rem(y, 5) == 0 or i == 0 {
          place(top + left, dx: xs(i) - 12pt, dy: ht + 3pt, box(width: 24pt, align(center, text(size: 6.5pt, fill: muted, str(y)))))
        }
      }
      let acc = range(n).map(_ => 0)
      for s in series {
        let lo = acc
        acc = range(n).map(i => acc.at(i) + calc.max(0, s.values.at(i)))
        let top-pts = range(n).map(i => (xs(i), ys(acc.at(i))))
        let bottom-pts = range(n).rev().map(i => (xs(i), ys(lo.at(i))))
        place(top + left, polygon(fill: rgb(s.color), stroke: 0.3pt + white, ..top-pts, ..bottom-pts))
      }
      place(top + left, dx: left-w, dy: ht + 16pt, {
        set text(size: 7pt)
        for s in series {
          box(baseline: -1pt, rect(width: 9pt, height: 7pt, fill: rgb(s.color)))
          h(3pt)
          box(s.label)
          h(10pt)
        }
      })
    })
  })
}

/// 資産の内訳（ドーナツと、名前・金額・割合）。区切りは6つまで（ほかはまとめる）
#let donut(title, items, size: 92pt) = {
  let sorted = items.sorted(key: x => -x.amount)
  let shown = if sorted.len() > 6 {
    let rest = sorted.slice(5)
    sorted.slice(0, 5) + ((label: "その他（" + str(rest.len()) + "つ）", amount: rest.map(x => x.amount).sum(), color: "#d9dde3"),)
  } else { sorted }
  let total = shown.map(x => x.amount).sum(default: 0)
  block(breakable: false, {
    text(size: 9pt, weight: "bold", title)
    v(2pt)
    grid(columns: (size + 6pt, 1fr), column-gutter: 6pt, align: horizon, {
      box(width: size, height: size, {
        let r = size / 2
        let r0 = r * 0.58
        let a0 = -90deg
        for x in shown {
          let sweep = if total > 0 { 360deg * x.amount / total } else { 0deg }
          let k = calc.max(2, int(calc.ceil(sweep / 6deg)))
          let outer = range(k + 1).map(j => { let a = a0 + sweep * j / k; (r + r * calc.cos(a), r + r * calc.sin(a)) })
          let inner = range(k + 1).rev().map(j => { let a = a0 + sweep * j / k; (r + r0 * calc.cos(a), r + r0 * calc.sin(a)) })
          if sweep > 0deg { place(top + left, polygon(fill: rgb(x.color), stroke: 0.4pt + white, ..outer, ..inner)) }
          a0 = a0 + sweep
        }
        place(center + horizon, align(center, text(size: 8pt, weight: "bold", man(total)) + linebreak() + text(size: 6pt, fill: muted, "万円")))
      })
    }, {
      set text(size: 7.5pt)
      if shown.len() == 0 { text(fill: muted, "金融資産はありません") }
      grid(columns: (8pt, 1fr, auto, auto), column-gutter: 4pt, row-gutter: 3pt,
        ..shown.map(x => (box(rect(width: 7pt, height: 7pt, fill: rgb(x.color))), x.label, align(right, man-unit(x.amount)), align(right, text(fill: muted, if total > 0 { str(calc.round(x.amount / total * 100)) + "%" } else { "" })))).flatten())
    })
  })
}

/// 運用の期間の図（積み立てる・据え置く・取り崩すの帯。年の幅にそろえる）
#let period-band(years, p) = {
  let n = years.len()
  if n == 0 { return none }
  let idx(y) = if y == none { n } else { let i = years.position(x => x >= y); if i == none { n } else { i } }
  let a = idx(p.accumEnd)
  let wd = if p.wdStart == none { n } else { idx(p.wdStart) }
  layout(size => {
    let left-w = 46pt
    let w = size.width - left-w - 4pt
    let x(i) = left-w + w * i / n
    block(width: 100%, height: 40pt, {
      let seg(i0, i1, fill, stroke, body) = if i1 > i0 {
        place(top + left, dx: x(i0), dy: 0pt, box(width: x(i1) - x(i0), height: 36pt, fill: fill, stroke: 0.8pt + stroke, radius: 2pt, inset: 3pt, clip: true, text(size: 6.5pt, body)))
      }
      seg(0, a, rgb("#e7eef9"), rgb("#4a6fb0"), [*↑ #p.accumText*#if p.estimated [（推定）] \ #p.steps.map(s => str(s.year) + "年〜 " + s.label).join("　")])
      seg(a, wd, rgb("#eef0f2"), rgb("#7d8794"), [*→ #p.holdText* \ #p.holdSub])
      if p.wdStart != none { seg(wd, n, rgb("#fbe9df"), rgb("#c9703f"), [*↓ #p.wdText* \ #p.wdSub]) }
    })
  })
}

#let investment(data) = {
  let inv = data.investment
  chapter("資産運用の計画", sub: "金融資産の積み立て方・据え置き方・取り崩し方と、口座ごとの見通しです（入れ方: " + inv.method + "）。")
  callout([提案では、金融資産は *#inv.lasts.proposal*（現状は#inv.lasts.current）。#inv.condition。])
  section("運用の期間")
  period-band(data.basis.years, inv.periods)
  if inv.periods.estimated { note("※ 積立をやめる年は、退職の年までと仮に置いています（推定）。") }
  section("口座ごとの残高の推移（提案）")
  stack-chart(data.basis.years, inv.accounts, height: if is-land(data) { 150pt } else { 170pt })
  section("資産の内訳（" + inv.donut.label + "）")
  grid(columns: (1fr, 1fr), column-gutter: 14pt, donut("現状", inv.donut.current), donut("提案", inv.donut.proposal))
  note("利回りは口座ごとの見込み（FP が入れた値か、資産の種類ごとの期待リターンから信託報酬を引いた値）で、毎年同じとして計算しています。実際の値動きは年によって大きく変わります。特定の商品をおすすめするものではありません。")
}

#let market-drop(data) = {
  let m = data.marketDrop
  chapter("相場が下がった場合", sub: "よくある下がり方を当てはめて、金融資産がいつまで持つかを比べたものです。")
  let colors = (rgb("#b03a2e"), rgb("#8a5a00"), rgb("#5b3f99"))
  let dashes = ("solid", "dashed", "dotted")
  line-chart(data.basis.years, (
    (label: "提案（" + m.lasts + "）", values: m.proposal, stroke: 1.6pt + accent),
    ..m.lines.enumerate().map(((i, l)) => (label: l.label, values: l.values, stroke: (paint: colors.at(calc.rem(i, 3)), thickness: 1.1pt, dash: dashes.at(calc.rem(i, 3))))),
  ), height: if is-land(data) { 200pt } else { 220pt })
  data-table(columns: (1fr, auto), header: ("相場の動き", "金融資産"), ("見込みどおり（提案）", m.lasts) + m.lines.map(l => (l.label, l.lasts)).flatten())
  note("株などが下がる型は、運用する口座のうち株・REIT の部分だけを下げ、その後は元の利回りに戻る計算です。利回りが低い型は、運用する口座の利回りを抑えた計算です。預金は変えていません。")
}
