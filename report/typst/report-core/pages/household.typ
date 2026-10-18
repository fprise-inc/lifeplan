// 3. 世帯サマリー　4. 基本項目　5. ライフイベント表
#import "../parts/format.typ": *
#import "../parts/layout.typ": *

/// 結論の一文（現状と提案の「資産が尽きる年」の組み合わせから選ぶ。数字は入力の値をそのまま出す）
#let verdict(s) = {
  let c = s.current.depletion
  let p = s.proposal.depletion
  if p == none and c != none [提案では、#s.target.label まで*資産が尽きません*（現状は#c.label に不足）。]
  else if p == none and c == none [現状も提案も、#s.target.label まで*資産が尽きません*。]
  else if p != none and c == none [提案では#p.label に*資産が不足*します（現状は不足しません）。]
  else if p.year == c.year [資産が不足する時期は変わりません（#p.label）。]
  else if s.depletionShift > 0 [資産が不足する時期が*#str(s.depletionShift)年遅く*なります（現状 #c.label → 提案 #p.label）。]
  else [資産が不足する時期が*#str(-s.depletionShift)年早く*なります（現状 #c.label → 提案 #p.label）。]
}

#let summary(data) = {
  chapter("世帯サマリー")
  let s = data.summary
  {
    set text(size: 9pt)
    data.members.map(m => box(inset: (x: 6pt, y: 3pt), radius: 8pt, fill: band, m.label + " " + str(m.ageAtBase) + "歳")).join(h(4pt))
    h(6pt)
    text(fill: muted, "（" + data.basis.baseMonthLabel + "時点）")
  }
  v(8pt)
  callout(text(size: 11pt, verdict(s)))
  v(6pt)
  grid(
    columns: (1fr, 1fr, 1fr),
    column-gutter: 8pt,
    figure-card(s.target.label + "の金融資産（提案）", man-unit(s.proposal.financialAtTarget), sub: "現状 " + man-unit(s.current.financialAtTarget)),
    figure-card("提案と現状の差", man-diff(s.diffAtTarget), sub: s.target.label + "時点"),
    figure-card("金融資産が不足する年（提案）", if s.proposal.depletion == none { "不足しない" } else { s.proposal.depletion.label }, sub: "現状 " + if s.current.depletion == none { "不足しない" } else { s.current.depletion.label }),
  )
  let totals = data-table(
    columns: (1fr, 1fr, 1fr),
    header: ("", "現状", "提案"),
    (
      ("収入", s.current.totals.income, s.proposal.totals.income),
      ("税・社会保険料", s.current.totals.taxSi, s.proposal.totals.taxSi),
      ("支出", s.current.totals.expense, s.proposal.totals.expense),
      ("年間収支の合計", s.current.totals.net, s.proposal.totals.net),
    ).map(((l, c, p)) => (l, man-unit(c), man-unit(p))).flatten(),
  )
  let totals-note = note("表の期間（計算基準月から" + str(data.basis.years.last()) + "年まで）の合計。万円未満は四捨五入しています。")
  let marks = ()
  if s.current.depletion != none { marks.push((year: s.current.depletion.year, label: "現状 不足")) }
  if s.proposal.depletion != none { marks.push((year: s.proposal.depletion.year, label: "提案 不足")) }
  let chart(h) = line-chart(data.basis.years, (
    (label: "提案", values: data.assets.proposal, stroke: 1.6pt + accent),
    (label: "現状", values: data.assets.current, stroke: (paint: muted, thickness: 1.2pt, dash: "dashed")),
  ), height: h, marks: marks)
  if is-land(data) {
    // 横の紙: 合計の表とグラフを左右に並べる
    grid(
      columns: (1fr, 1.6fr),
      column-gutter: 12pt,
      { section("表の期間の合計"); totals; totals-note },
      { section("金融資産の推移"); chart(150pt) },
    )
  } else {
    section("表の期間の合計")
    totals
    totals-note
    section("金融資産の推移")
    chart(170pt)
  }
}

#let basics(data) = {
  chapter("基本項目", sub: "現状の家族・収支・資産と負債です。")
  let b = data.basics
  grid(
    columns: (1fr, 1fr),
    column-gutter: 14pt,
    {
      section("家族")
      data-table(
        columns: (1fr, auto),
        header: ("", data.basis.baseMonthLabel + "時点"),
        data.members.map(m => (m.label, str(m.ageAtBase) + "歳")).flatten(),
      )
      section("資産（" + str(b.balanceYear) + "年末の見込み）")
      data-table(columns: (1fr, auto), header: ("", "金額"), b.assets.map(x => (x.label, man-unit(x.amount))).flatten())
      if b.debts.len() > 0 {
        section("負債（" + str(b.balanceYear) + "年末の見込み）")
        data-table(columns: (1fr, auto), header: ("", "残高"), b.debts.map(x => (x.label, man-unit(x.amount))).flatten())
      }
    },
    {
      section("収支（" + str(b.year) + "年）")
      data-table(
        columns: (1fr, auto),
        header: ("", "年額"),
        (
          (text(weight: "bold", "収入"), ""),
          ..b.income.map(x => ("　" + x.label, man-unit(x.amount))),
          (text(weight: "bold", "支出"), ""),
          ..b.expense.map(x => ("　" + x.label, man-unit(x.amount))),
          (text(weight: "bold", "年間収支"), text(weight: "bold", man-unit(b.net))),
        ).flatten(),
      )
    },
  )
}

#let events(data) = {
  chapter("ライフイベント表", sub: "提案の前提にしている、ご家族の主な出来事です。")
  data-table(
    columns: (auto, auto, 1fr),
    header: ("年", "年齢", "出来事"),
    align: (x, y) => left + horizon,
    data.events.map(e => (str(e.year), text(fill: muted, e.ages), e.items.join("\n"))).flatten(),
  )
}
