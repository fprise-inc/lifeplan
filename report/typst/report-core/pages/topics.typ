// 6の続き（資産残高のグラフ・資産と負債の推移）　7. 教育費の推移　8. 住宅ローン　9. 老後の必要資金と年金の受取予想
#import "../parts/format.typ": *
#import "../parts/layout.typ": *

#let assets-page(data) = {
  pagebreak(weak: true)
  let land = is-land(data)
  let s = data.summary
  let marks = ()
  if s.current.depletion != none { marks.push((year: s.current.depletion.year, label: "現状 不足")) }
  if s.proposal.depletion != none { marks.push((year: s.proposal.depletion.year, label: "提案 不足")) }
  let chart = line-chart(data.basis.years, (
    (label: "提案", values: data.assets.proposal, stroke: 1.6pt + accent),
    (label: "現状", values: data.assets.current, stroke: (paint: muted, thickness: 1.2pt, dash: "dashed")),
  ), height: if land { 260pt } else { 230pt }, marks: marks)
  let idx = data.basis.years.enumerate().filter(((i, y)) => calc.rem(y, 5) == 0 or i == 0 or i == data.basis.years.len() - 1).map(((i, y)) => i)
  let table5 = data-table(
    columns: (auto, auto, 1fr, 1fr),
    header: ("年", "年齢", "現状", "提案"),
    align: (x, y) => if x <= 1 { left + horizon } else { right + horizon },
    idx.map(i => {
      let y = data.basis.years.at(i)
      let ages = data.members.filter(m => m.key == "self" or m.key == "spouse").filter(m => m.ages.at(i) != none).map(m => m.label + str(m.ages.at(i)) + "歳").join("・")
      (str(y), text(fill: muted, ages), man-unit(data.assets.current.at(i)), man-unit(data.assets.proposal.at(i)))
    }).flatten(),
  )
  if land {
    // 横の紙: グラフと5年ごとの表を左右に並べる
    grid(
      columns: (1.5fr, 1fr),
      column-gutter: 12pt,
      { section("資産残高の推移（現状と提案）"); chart },
      { section("5年ごとの金融資産残高"); table5 },
    )
  } else {
    section("資産残高の推移（現状と提案）")
    chart
    section("5年ごとの金融資産残高")
    table5
  }
}

#let education(data) = {
  let e = data.education
  chapter("教育費の推移", sub: "提案の前提にしている、お子さまの教育費（学校の費用・入学金・塾など）です。")
  grid(
    columns: (1fr, 1fr),
    column-gutter: 8pt,
    figure-card("教育費の合計", man-unit(e.grandTotal), sub: str(e.years.first()) + "〜" + str(e.years.last()) + "年"),
    figure-card("いちばん多い年", {
      let i = e.total.position(v => v == calc.max(..e.total))
      str(e.years.at(i)) + "年 " + man-unit(e.total.at(i))
    }),
  )
  section("年ごとの教育費")
  data-table(
    columns: (auto, ..e.rows.map(_ => 1fr), 1fr),
    header: ("年", ..e.rows.map(r => r.label), "合計"),
    size: 8pt,
    e.years.enumerate().map(((i, y)) => (str(y), ..e.rows.map(r => man-unit(r.amounts.at(i))), text(weight: "bold", man-unit(e.total.at(i))))).flatten()
      + (text(weight: "bold", "合計"), ..e.rows.map(r => text(weight: "bold", man-unit(r.total))), text(weight: "bold", man-unit(e.grandTotal))),
  )
}

#let housing(data) = {
  let hl = data.housingLoan
  chapter("住宅ローン", sub: "返済額と残高の推移（提案）と、現状との比較です。")
  data-table(
    columns: (1fr, 1fr, 1fr),
    header: ("", "返済が終わる年", "返済額の合計（表の期間）"),
    hl.compare.map(c => (c.label, if c.payoff == none { "表の期間の後" } else { c.payoff.label }, man-unit(c.totalRepayment))).flatten(),
  )
  if hl.effect != none {
    callout[繰上返済などの見直しで、返済額の合計が *#man-diff(hl.effect)* 変わります（提案−現状）。]
  }
  section("返済表（提案）")
  columns(if is-land(data) { 3 } else { 2 }, gutter: 12pt, data-table(
    columns: (auto, 1fr, 1fr),
    header: ("年", "年間の返済額", "年末の残高"),
    size: 8pt,
    hl.years.enumerate().map(((i, y)) => (str(y), man-unit(hl.repayment.at(i)), man-unit(hl.balance.at(i)))).flatten(),
  ))
}

#let retirement(data) = {
  let r = data.retirement
  chapter("老後の必要資金と年金の受取予想", sub: "公的年金の受け取りの見込みと、退職後の収支です（提案）。")
  data-table(
    columns: (1fr, 1.4fr, 1fr, 1fr),
    header: ("", "受け取り開始", "年額（開始の翌年）", "受け取りの合計（表の期間）"),
    r.pensions.map(p => (p.label, if p.start == none { "表の期間の後" } else { p.start.label }, man-unit(p.annual), man-unit(p.total))).flatten(),
  )
  if r.afterRetirement != none {
    let a = r.afterRetirement
    section("退職後（" + str(a.from) + "年〜" + str(data.basis.years.last()) + "年）の収支の合計")
    grid(
      columns: (1fr, 1fr, 1fr),
      column-gutter: 8pt,
      figure-card("収入（年金など）", man-unit(a.income)),
      figure-card("支出（税・社会保険料を含む）", man-unit(a.spending)),
      figure-card("差（金融資産から取り崩す額）", man-diff(a.gap)),
    )
  }
  if r.atRetirement.len() > 0 {
    section("退職の年の金融資産")
    data-table(columns: (1.6fr, 1fr, 1fr), header: ("", "現状", "提案"), r.atRetirement.map(x => (x.label, man-unit(x.current), man-unit(x.proposal))).flatten())
  }
  if r.deferral != none {
    section(r.deferral.label + "の年金の受け取り開始の比較（繰下げ）")
    data-table(
      columns: (1fr, 1fr, 1.2fr, 1.2fr),
      header: ("", "年額（開始の翌年）", "受け取りの合計（" + data.summary.target.label + "まで）", data.summary.target.label + "の金融資産"),
      r.deferral.options.map(o => (o.label, man-unit(o.annual), man-unit(o.totalToTarget), man-unit(o.financialAtTarget))).flatten(),
    )
    note("受け取りを遅らせると年額は増えますが、受け取る期間は短くなります。合計と金融資産は、目標の年までの計算です。")
  }
  section("年金の受取予想（年ごと）")
  columns(if is-land(data) { 3 } else { 2 }, gutter: 12pt, year-table(r.table, size: 7pt, ages: false))
}

/// 資産と負債の推移（全資産・全負債）: 純資産の推移のグラフ（現状と提案）と、年の抜粋のバランスシート（提案）
#let balance-page(data) = {
  let bs = data.balanceSheet
  if bs == none { return }
  pagebreak(weak: true)
  let land = is-land(data)
  let chart = line-chart(data.basis.years, (
    (label: "提案", values: bs.netWorth.proposal, stroke: 1.6pt + accent),
    (label: "現状", values: bs.netWorth.current, stroke: (paint: muted, thickness: 1.2pt, dash: "dashed")),
  ), height: if land { 170pt } else { 170pt })
  section("純資産の推移（現状と提案。不動産・その他の資産を含む資産の合計−負債の合計）")
  chart
  section("年の抜粋のバランスシート（提案）")
  sheet-table(bs.proposal, extra: (("純資産（現状）", bs.currentNetWorth),))
  note("金額は各年の年末の見込みです。不動産は持ち家の評価額（土地は上昇率で動かし、建物は構造の耐用年数で定額で減らし、建てた時の価値の一定の割合を下限にした見込み）で、売却の予定があれば売った年から現金（金融資産）に変わります。その他の資産は車・保険の解約返戻金などです。老後の資金が足りるかは、前のページの金融資産で見ます。")
}
