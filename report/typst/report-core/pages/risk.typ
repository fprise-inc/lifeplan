// 10. 世帯主・配偶者の万一　11. 保障内容一覧と払込保険料の推移
#import "../parts/format.typ": *
#import "../parts/layout.typ": *

#let contingency(data) = {
  let c = data.contingency
  chapter("万一のとき", sub: "亡くなった場合などの、ご家族の暮らしの見通しと、必要な保障の額です。")
  for (k, s) in c.scenarios.enumerate() {
    if k > 0 { pagebreak() }
    section(s.title)
    let land = is-land(data)
    let head = callout(if s.depletion == none [この場合も、表の期間の最後まで金融資産は不足しません。] else [この場合、*#s.depletion.label* に金融資産が不足します。], color: if s.depletion == none { accent } else { warn })
    // 金融資産が足りなくなる所の「!」: 万一の場合は赤の塗り、万一なし（提案と同じ線）は白抜き
    let base-dep = data.summary.proposal.depletion
    let shorts = ()
    if base-dep != none { shorts.push((year: base-dep.year, base: true, label: "万一なし " + base-dep.label)) }
    if s.depletion != none { shorts.push((year: s.depletion.year, base: false, label: "万一の場合 " + s.depletion.label)) }
    let chart = line-chart(data.basis.years, (
      (label: "万一の場合", values: s.withEvent, stroke: 1.6pt + warn),
      (label: "万一が無い場合（提案）", values: s.withoutEvent, stroke: (paint: muted, thickness: 1.2pt, dash: "dashed")),
    ), height: if land { 170pt } else { 140pt }, shorts: shorts)
    let diff = {
      section("万一が無い場合との差（表の期間の合計）")
      data-table(columns: (1fr, auto), header: ("", "差"), s.breakdown.map(b => (b.label, man-diff(b.amount))).flatten())
    }
    let pension = if s.survivorPension.len() > 0 {
      section("遺族年金（年ごと）")
      set text(size: 7pt)
      grid(columns: (auto, 1fr, auto, 1fr), column-gutter: 6pt, row-gutter: 3pt,
        ..s.survivorPension.map(p => (str(p.year), align(right, man-unit(p.amount)))).flatten())
      v(4pt)
      text(size: 8pt, [遺族年金の合計 *#man-unit(s.survivorPensionTotal)*])
    }
    if land {
      // 横の紙: 左に見通しのグラフと差、右に遺族年金
      grid(columns: (1.5fr, 1fr), column-gutter: 14pt, { head; chart; diff }, pension)
    } else {
      head
      chart
      grid(columns: (1fr, 1fr), column-gutter: 12pt, diff, pension)
    }
    for n in s.notices { note("※ " + n) }
  }
  if c.protection.len() > 0 {
    pagebreak(weak: true)
    section("必要保障額の推移（その年に亡くなった場合）")
    if data.assumptions.survivorReform { note("※ 遺族年金は2028年4月の見直し前の制度で計算しています（2028年4月以後に亡くなる想定）。") }
    for p in c.protection {
      block(breakable: false, {
        text(size: 10pt, weight: "bold", p.title)
        h(6pt)
        text(size: 8pt, fill: muted, p.sub)
        line-chart(p.years, (
          (label: "必要保障額（金融資産を差し引いた額）", values: p.needWithAssets, stroke: 1.6pt + warn),
          (label: "必要保障額（金融資産を含まない額）", values: p.need, stroke: (paint: warn, thickness: 0.9pt, dash: "dotted")),
          (label: "加入中の死亡保険金", values: p.coverage, stroke: 1.4pt + good),
        ), height: 120pt)
        if p.maxShort != none {
          note("不足がいちばん大きいのは " + str(p.maxShort.year) + "年で、" + man-unit(p.maxShort.amount) + " 不足します。")
        } else {
          note("表の期間では、加入中の死亡保険金が必要保障額（金融資産を差し引いた額）を上回っています。")
        }
      })
    }
  }
}

#let insurance(data) = {
  let ins = data.insurance
  chapter("保障内容と払込保険料", sub: "ご加入の保険と、提案での見直しの内容です。")
  data-table(
    columns: (1.2fr, auto, 1.3fr, 1.6fr, auto),
    header: ("保険", "被保険者", "保険料", "主な保障", "提案"),
    align: (x, y) => left + horizon,
    size: 8pt,
    ins.contracts.map(c => (c.label, c.insured, c.premium, if c.benefits.len() == 0 { text(fill: muted, "（契約の内容で計算）") } else { c.benefits.join("\n") }, c.status)).flatten(),
  )
  grid(
    columns: (1fr, 1fr),
    column-gutter: 8pt,
    figure-card("払込保険料の合計（現状）", man-unit(ins.total.current), sub: "表の期間"),
    figure-card("払込保険料の合計（提案）", man-unit(ins.total.proposal), sub: "表の期間"),
  )
  if ins.table.rows.len() > 0 {
    section("払込保険料の推移")
    columns(if is-land(data) { 3 } else { 2 }, gutter: 12pt, year-table(ins.table, size: 7pt, ages: false))
  }
}
