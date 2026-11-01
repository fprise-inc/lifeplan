// 会社と合わせたバランスシート（合算BS。法人の顧問向けの機能。0108）: 経営者個人（家計）と会社のバランスシートを並べ、間の貸し借り（4つの組）を
// 相殺して1枚にする。値は帳票の入力の combinedBs（report/src/combinedBs.ts が作る。アプリの見るものと同じ）。会社の先の年の見込みは作らない。
// 計算し直さず、書式だけを当てる
#import "../parts/format.typ": *
#import "../parts/layout.typ": *

/// 3枚の図（共通の縮尺）
#let combined-figure(fig, height: 150pt) = {
  let cols = fig.columns
  grid(
    columns: cols.map(_ => 1fr),
    column-gutter: 10pt,
    ..cols.map(c => block(width: 100%, inset: 6pt, radius: 3pt, stroke: 0.5pt + rule, {
      text(size: 9pt, weight: "bold", c.name)
      linebreak()
      text(size: min-size, fill: muted, c.sub)
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
        bs-column(c.assets, c.totalAssets, fig.scale, height, 100%, true, neg: c.negative, labels: true),
        bs-column(c.liabilities, c.totalLiabilities + calc.max(0, c.netWorth), fig.scale, height, 100%, true, labels: true),
      )
      v(3pt)
      text(size: 8.5pt, weight: "bold", [純資産 #text(fill: if c.netWorth < 0 { muted } else { accent }, man-unit(c.netWorth))])
    })),
  )
}

/// 何か月分（小数第1位まで。アプリの画面と同じ「4.0か月分」）
#let months-text(m) = {
  let r = calc.round(m, digits: 1)
  (if r == calc.floor(r) { str(int(r)) + ".0" } else { str(r) }) + "か月分"
}

#let combined-bs(data) = {
  let cb = data.combinedBs
  chapter("会社と合わせたバランスシート", sub: "経営者個人（家計）と会社のバランスシートを並べ、間の貸し借りを相殺して1枚にしたものです。")
  let land = is-land(data)
  section("2枚を並べて、合算する")
  combined-figure(cb.figure, height: if land { 110pt } else { 125pt })
  note("箱の高さは金額に比例します（3枚で共通の縮尺）。家計は" + str(cb.householdYear) + "年末（今の年）、会社は" + if cb.asOf != none { cb.asOf + "の" } else { "" } + "試算表の数字です（基準日がずれることがあります）。合算の純資産は、会社の財産（剰余金）と個人の財産に分けています。資本金は財産に数えません。会社の先の年の見込みは作っていません。")
  if cb.notices.len() > 0 {
    callout[
      #text(weight: "bold", "お知らせ")
      #for n in cb.notices [
        - #n
      ]
    ]
  }
  section("相殺した4つの組")
  data-table(
    columns: (1.6fr, 1.2fr, 1.2fr),
    header: ("組", "経営者の側", "会社の側"),
    align: (x, y) => left + horizon,
    cb.pairs.map(p => (p.label, p.ownerLabel + " " + man-unit(p.owner), p.companyLabel + " " + man-unit(p.company))).flatten(),
  )
  note("両側の額が合わないときは、会社の側の額に合わせて見ています。相殺しても、合わせた財産の合計は変わりません。")
  section("合算の純資産の内訳")
  data-table(
    columns: (2fr, 1fr),
    header: ("", "金額"),
    (
      ("会社の財産（剰余金）", man-unit(cb.netWorth.company)),
      ..if cb.netWorth.others != 0 { (("ほかの株主の出資", man-unit(cb.netWorth.others)),) } else { () },
      ("個人の財産", man-unit(cb.netWorth.owner)),
      (text(weight: "bold", "合算の純資産"), text(weight: "bold", man-unit(cb.netWorth.total))),
    ).flatten(),
  )
  section("現預金は毎月の固定の支出の何か月分か")
  data-table(
    columns: (1fr, 1fr, 1.1fr, 0.9fr, 2.4fr),
    header: ("", "現預金", "毎月の固定の支出", "何か月分", ""),
    align: (x, y) => if x == 0 or x == 4 { left + horizon } else { right + horizon },
    cb.indicators.map(i => (i.label, man-unit(i.cash), man-unit(i.monthly), if i.months == none { "—" } else { months-text(i.months) }, text(size: 7.5pt, i.text))).flatten(),
  )
  note("目安は6か月分、できれば12か月分。会社の固定の支出は固定費（仕入は含めない）＋借入の返済、個人は生活費＋ローン返済（家賃収入で返す不動産のローンは除く）です。")
  if cb.stage != none {
    // 見出しと文を同じページに（見出しだけがページの下に残らないように）
    block(breakable: false, {
      section("会社の段階（" + cb.stage.label + "）と、お金を厚くする口座の目安")
      callout(cb.stage.text)
    })
  }
  if cb.restated.rows.len() > 0 {
    section(if cb.restated.used { "実力に直した額（この額で並べています）" } else { "実力に直した額（参考）" })
    data-table(
      columns: (2fr, 1fr, 1fr),
      header: ("科目", "帳簿の額", "直した額"),
      cb.restated.rows.map(r => (r.label, man-unit(r.book), man-unit(r.adjusted))).flatten(),
    )
    note("直した額は担当の FP が試算表をもとに見積もった額です。")
  }
}
