// 収益不動産のまとめ（提案のプランの貸している物件。0082）: 物件が2件以上なら全体の1枚、物件ごとに1枚。
// 分析の数字はエンジンの asset.realEstateAnalysis の出力（帳票の入力の rental）。金額は計算し直さず、書式だけを当てる。率は書式を当てた文字列
#import "../parts/format.typ": *
#import "../parts/layout.typ": *

/// 年月（YYYY-MM → YYYY年M月）
#let ym-ja(s) = { let x = s.split("-"); x.at(0) + "年" + str(int(x.at(1))) + "月" }

/// 表に載せる年: 多いときは最初の10年と5年ごと、元金の返済が減価償却費を上回る年、最後の年
#let rental-rows(years, max: 28) = {
  if years.len() <= max { return years }
  years.enumerate().filter(((i, y)) => i < 10 or calc.rem(y.year, 5) == 0 or y.deadCross or i == years.len() - 1).map(((i, y)) => y)
}

/// 建物の無い種類（貸している土地・駐車場）か（種類の鍵で見る。画面と同じ）
#let rental-land-only(p) = p.kind != none and (p.kind.key == "land" or p.kind.key == "parking")

/// 収入の列の名前（貸している土地は地代、駐車場は駐車場の収入。画面と同じ）
#let rental-income-label(p) = if p.kind != none and p.kind.key == "land" { "地代収入" } else if p.kind != none and p.kind.key == "parking" { "駐車場の収入" } else { "家賃収入" }

/// 減価償却の無い物件（建物の無い種類で、どの年も減価償却費が 0）。元金の返済が減価償却費を上回る年は出さない
#let rental-no-depreciation(p) = rental-land-only(p) and p.builtYear == none and p.years.all(y => y.depreciation == none or y.depreciation == 0)

/// 年ごとの表（万円）。大きな修繕のある物件だけ、その列を出す
#let rental-year-table(years, size: 7pt, income: "家賃収入", dead-mark: true) = {
  let repairs = years.any(y => y.repairs != 0)
  let rows = rental-rows(years)
  let head = ("年", income, "経費") + (if repairs { ("大きな修繕",) } else { () }) + ("減価償却", "利息", "不動産所得", "返済", "手残り（税引前）", "手残り（税引後）", "ローン残高", "評価額")
  data-table(
    columns: (auto,) + head.slice(1).map(_ => 1fr),
    header: head,
    size: size,
    rows.map(y => {
      let year = if dead-mark and y.deadCross { text(fill: warn, weight: "bold", str(y.year) + " ◆") } else { str(y.year) }
      (year, man(y.rent), man(y.expenses)) + (if repairs { (man(y.repairs),) } else { () }) + (
        if y.depreciation == none { "—" } else { man(y.depreciation) },
        if y.interest == none { "—" } else { man(y.interest) },
        if y.income == none { "—" } else { man(y.income) },
        man(y.repayment),
        man(y.cashBeforeTax),
        man(y.cashAfterTax),
        man(y.loanBalance),
        if y.value == none { "—" } else { man(y.value) },
      )
    }).flatten(),
  )
}

/// 指標の札（4つずつ2段）
#let rental-cards(m, lodging, land-only: false, land: false) = {
  let cards = (
    if lodging and m.lodging != none { ("稼働率", m.lodging.occupancy) } else { ("表面利回り", m.grossYield) },
    ("実質利回り（NOI）", m.netYield),
    (if lodging { "損益分岐の稼働率" } else if land { "損益分岐の地代の割合" } else if land-only { "損益分岐の稼働率" } else { "損益分岐の入居率" }, m.breakEven),
    ("返済比率", m.repaymentRatio),
    ("返済余裕率（DSCR）", m.dscr),
    ("借入の割合（LTV）", m.ltv),
    ("月の手残り（税引前）", yen(m.monthlyBeforeTax)),
    ("月の手残り（税引後）", yen(m.monthlyAfterTax)),
  )
  grid(columns: (1fr, 1fr, 1fr, 1fr), column-gutter: 6pt, row-gutter: 6pt, ..cards.map(((l, v)) => figure-card(l, v)))
}

/// 物件の1枚
#let rental-property(p, first: false, sub: none) = {
  let title = p.label + (if p.kind != none { "（" + p.kind.label + "）" } else { "" })
  if first { chapter("収益不動産のまとめ", sub: sub) } else { pagebreak(weak: true) }
  section(title)
  let facts = ()
  if p.owner != none { facts.push(p.owner.label + "名義") }
  // 建物の無い物件（貸している土地・駐車場）は、構造と建った年を載せない
  if p.builtYear != none { facts.push(p.structure.label) }
  if p.builtYear != none { facts.push(str(p.builtYear) + "年築") }
  if p.acquisition != none {
    let a = "取得 " + ym-ja(p.acquisition.month) + " " + man-unit(p.acquisition.total)
    if p.acquisition.costs != 0 { a += "（諸費用 " + man-unit(p.acquisition.costs) + "）" }
    facts.push(a)
    if p.acquisition.equity != none { facts.push("自己資金 " + man-unit(p.acquisition.equity)) }
  }
  if p.exit != none { facts.push("売却の予定 " + ym-ja(p.exit.month)) }
  block(below: 6pt, text(fill: muted, facts.join("・")))
  let m = p.point
  if m != none {
    text(size: 8pt, fill: muted, str(m.year) + "年の指標")
    v(2pt)
    rental-cards(m, p.lodging, land-only: rental-land-only(p), land: p.kind != none and p.kind.key == "land")
    let more = ()
    more.push("自己資金に対する手残りの割合（CCR） " + m.ccr)
    if m.at("unrealizedGain", default: none) != none { more.push("含み益 " + man-unit(m.unrealizedGain)) }
    if m.equity != none { more.push("売ったときの手残りの目安（ローン返済後・売却の費用と税の前） " + man-unit(m.equity)) }
    if m.age != none { more.push("築" + str(m.age) + "年・残りの耐用年数 " + str(m.remainingLife) + "年") }
    if p.lodging and m.lodging != none { more.push("1泊の単価 " + yen(m.lodging.nightly) + "・営業日数 " + str(m.lodging.days) + "日・年の売上 " + man-unit(m.lodging.sales)) }
    let dep = p.depreciationEnd.building
    let depText = p.at("depreciationEndText", default: none)
    // 建物の無い物件で減価償却が無ければ、その理由を書く（「売るまで続く」にしない）
    if rental-no-depreciation(p) {
      more.push("減価償却 なし（" + if p.kind.key == "parking" { "設備を入れていません" } else { "建物がありません" } + "）")
    } else {
      more.push("減価償却が終わる年 " + if depText != none { depText } else if dep != none { str(dep) + "年" } else if p.exit != none and p.acquisition != none { "売るまで続く" } else { "—" })
    }
    block(above: 6pt, below: 4pt, text(size: 8pt, more.join("　")))
  }
  if p.deadCross != none and not rental-no-depreciation(p) {
    let first = if p.years.len() > 0 { p.years.first().year } else { p.deadCross }
    if p.at("deadCrossNow", default: false) {
      callout(color: warn)[元金の返済が減価償却費を、もう上回っています（手残りがあっても、税の上の所得が増えやすくなります）。]
    } else if p.deadCross < first {
      callout(color: warn)[#str(p.deadCross)年から、元金の返済が減価償却費を上回っています（手残りがあっても、税の上の所得が増えやすくなります）。]
    } else {
      callout(color: warn)[◆ #str(p.deadCross)年から、元金の返済が減価償却費を上回ります（手残りがあっても、税の上の所得が増えやすくなります）。]
    }
  }
  section("年ごとの数字（万円）")
  rental-year-table(p.years, income: if p.lodging { "売上" } else { rental-income-label(p) }, dead-mark: not rental-no-depreciation(p))
  if p.exit != none {
    block(above: 6pt, text(size: 8pt, "売却（" + ym-ja(p.exit.month) + "）: 手取り " + man-unit(p.exit.proceeds) + " − ローンの一括返済 " + man-unit(p.exit.loanPayoff) + " − 譲渡所得の税 " + man-unit(p.exit.tax) + " ＝ 税引後の手取り " + man-unit(p.exit.net)))
  }
  if p.saleCompare != none {
    let c = p.saleCompare
    section("売る年を変えた比べ")
    data-table(
      columns: (auto, 1fr, 1fr, 1fr, 1fr),
      header: ("売る時期", "税引後の手取り", str(c.endYear) + "年の金融資産", "今の予定との差", str(c.endYear) + "年の評価額−ローン残高"),
      size: 8pt,
      c.rows.map(r => (
        if r.current { text(weight: "bold", r.label) } else { r.label },
        man-unit(r.net),
        man-unit(r.financialEnd),
        if r.current { "—" } else { man-diff(r.diff) },
        man-unit(r.equityEnd),
      )).flatten(),
    )
  }
  note[手残り＝実際に入る家賃収入−経費−大きな修繕−ローンの返済（繰上返済を含む。売ったときの一括返済は除く）。税引後は、その物件の所得の分だけ増える所得税・住民税・国民健康保険料などを近似で引いた額。率は、その年の家賃収入などを年あたりに直して出しています（実質利回りの分母は取得価額＋取得時の諸費用。返済比率・返済余裕率・損益分岐は約定の返済で）。◆は元金の返済が減価償却費を上回る最初の年。売る年を変えた比べは、売る年だけを変えて計算し直したもの（5年前・5年後はその年の評価額で売るとしています）。]
}

/// 全体の1枚（物件が2件以上）
#let rental-total(r, sub: none) = {
  chapter("収益不動産のまとめ", sub: sub)
  section("物件ごとの数字（" + str(r.pointYear) + "年）")
  data-table(
    columns: (auto, auto, 1fr, 1fr, 1fr, 1fr, 1fr, 1fr),
    header: ("物件", "種類", "表面利回り", "実質利回り", "月の手残り（税引前）", "返済余裕率（DSCR）", "借入の割合（LTV）", "ローン残高"),
    size: 7.5pt,
    r.properties.map(p => {
      let m = p.point
      let last = p.years.find(y => y.year == r.pointYear)
      (
        p.label,
        if p.kind == none { "—" } else { p.kind.label },
        if m == none { "—" } else { m.grossYield },
        if m == none { "—" } else { m.netYield },
        if m == none { "—" } else { yen(m.monthlyBeforeTax) },
        if m == none { "—" } else { m.dscr },
        if m == none { "—" } else { m.ltv },
        if last == none { "—" } else { man-unit(last.loanBalance) },
      )
    }).flatten() + {
      let t = r.total.point
      (
        text(weight: "bold", "合計（" + str(r.properties.len()) + "件）"),
        "",
        if t == none { "—" } else { t.grossYield },
        if t == none { "—" } else { t.netYield },
        if t == none { "—" } else { yen(t.monthlyBeforeTax) },
        if t == none { "—" } else { t.dscr },
        if t == none { "—" } else { t.ltv },
        { let ty = r.total.years.find(y => y.year == r.pointYear); if ty == none { "—" } else { man-unit(ty.loanBalance) } },
      )
    },
  )
  section("全物件の合計の年ごとの数字（万円）")
  rental-year-table(r.total.years)
  note[合計の率は、物件ごとの年あたりの額を足して出しています（分母は数字のある物件の分）。物件ごとの数字は次のページから。]
}

#let rental(data) = {
  let r = data.rental
  let sub = "提案のプランで貸している物件の、利回り・返済・手残りと、売る年を変えた場合の比べです。"
  if r.total != none {
    rental-total(r, sub: sub)
    for p in r.properties { rental-property(p) }
  } else {
    for (i, p) in r.properties.enumerate() { rental-property(p, first: i == 0, sub: sub) }
  }
}
