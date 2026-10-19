// 12. 提案での変更点の一覧（現状との差）と、FP顧問料込みの効果（顧問料を除いた場合との差。0008 の FP顧問料）
#import "../parts/format.typ": *
#import "../parts/layout.typ": *

#let changes(data) = {
  let ch = data.changes
  chapter("提案での変更点", sub: "現状から変える内容と、その効果です。")
  if ch.items.len() > 0 {
    section("変える内容")
    data-table(columns: (1fr, 1fr, 1.4fr), header: ("項目", "現状", "提案"), align: (x, y) => left + horizon, ch.items.map(i => (i.label, i.current, i.proposal)).flatten())
  }
  section("現状との差")
  data-table(
    columns: (1.6fr, 1fr, 1fr, 1fr),
    header: ("", "現状", "提案", "差（提案−現状）"),
    ch.metrics.map(m => if m.unit == "year" {
      (m.label, if m.current == none { "不足しない" } else { str(m.current) + "年" }, if m.proposal == none { "不足しない" } else { str(m.proposal) + "年" }, year-diff(m.diff))
    } else {
      (m.label, man-unit(m.current), man-unit(m.proposal), man-diff(m.diff))
    }).flatten(),
  )
  if ch.fee != none {
    let f = ch.fee
    section("FP顧問料込みの効果")
    callout[
      FP顧問料を#if f.diffAtTarget >= 0 [払っても] else [含めると]、#data.summary.target.label の金融資産は現状より *#man-diff(f.diffAtTarget)* です。
      #if f.diffWithoutFee != none [（顧問料を除くと #man-diff(f.diffWithoutFee)）]
    ]
  }
  if ch.steps != none {
    section("打ち手ごとの効果（" + data.summary.target.label + "の金融資産。1件ずつ足していった順）")
    data-table(
      columns: (2fr, 1fr, 1fr),
      header: ("打ち手", "効果", "累計"),
      ch.steps.map(s => (s.label + if s.investment { "（運用の前提の変更）" } else { "" }, man-diff(s.effect), man-diff(s.cumulative))).flatten(),
    )
    if ch.excludingInvestment != none {
      callout(color: if ch.excludingInvestment >= 0 { good } else { warn })[運用の前提の変更を除いた効果は *#man-diff(ch.excludingInvestment)* です。]
      note("運用の利回りは前提であり、将来の成果を約束するものではありません。運用の前提の変更を除いても効果があるかをご確認ください。")
    }
  }
}
