// 公式の帳票（提案書の標準構成。0009 の9）の入口。
//   #import "@lifeplan/report-core:0.1.0": proposal
//   #proposal(json("/input.json"), json("/frame.json"))
// data: 帳票の入力（lifeplan.proposalInput 0.1.0。提示に必要な値だけ。任意の chapters で載せる章を、comparison で案の比較を、
//       layout で紙の向きとキャッシュフロー表の載せ方を渡す。layout の省略は、縦にそろえる・キャッシュフロー表は要約）
// frame: アプリが帳票の外側で決める値（刻印の帯の高さ band（pt）、必須の記載 notices）。刻印そのものはアプリが組んだ後に重ねる
// 帳票は刻印の帯（下端の band の高さ）の内側に描かない。金額は計算し直さず、書式だけを当てる
#import "parts/format.typ": *
#import "parts/layout.typ": *
#import "pages/front.typ": cover, assumptions
#import "pages/household.typ": summary, basics, events
#import "pages/cashflow.typ": cashflow
#import "pages/topics.typ": assets-page, balance-page, education, housing, retirement
#import "pages/risk.typ": contingency, insurance
#import "pages/invest.typ": investment, market-drop
#import "pages/changes.typ": changes
#import "pages/compare.typ": comparison
#import "pages/money3.typ": money-three
#import "pages/rental.typ": rental

#let supported = "0.1.0"

#let proposal(data, frame) = {
  assert(data.format == "lifeplan.proposalInput", message: "帳票の入力の形式が違います")
  assert(data.version == supported, message: "帳票の入力の版が対応していません: " + data.version)
  let band-height = frame.band * 1pt
  set document(title: data.document.title, author: ())
  set text(font: "BIZ UDGothic", lang: "ja", region: "jp", size: 9.5pt, fill: ink)
  set par(justify: false, leading: 0.7em)
  // 紙の向き（layout.orientation）: 1冊の中で向きをそろえる（縦・横）か、年ごとの表だけ横にする（mixed。以前の形）
  let lay = layout-of(data)
  let land = lay.orientation == "landscape"
  set page(
    paper: "a4",
    flipped: land,
    margin: if land { (top: 14mm, left: 16mm, right: 16mm, bottom: 12mm + band-height) } else { (top: 18mm, left: 16mm, right: 16mm, bottom: 14mm + band-height) },
  )
  set heading(numbering: "1")
  show heading.where(level: 1): chapter-style

  // 載せる章（省略はすべて。表紙と前提条件と注意書きは外せない）。材料の無い章は省く
  let chosen = data.at("chapters", default: none)
  let on(id) = chosen == none or id in chosen
  let compared = data.at("comparison", default: none)

  cover(data)
  assumptions(data, frame)
  if on("summary") { summary(data) }
  if on("basics") { basics(data) }
  if on("events") and data.events.len() > 0 { events(data) }
  if on("cashflow") {
    cashflow(data, band-height)
    assets-page(data)
    balance-page(data)
  }
  if on("moneyThree") and data.at("moneyThree", default: none) != none { money-three(data) }
  if on("education") and data.education != none { education(data) }
  if on("housing") and data.housingLoan != none { housing(data) }
  if on("rental") and data.at("rental", default: none) != none { rental(data) }
  if on("retirement") and data.retirement != none { retirement(data) }
  if on("investment") and data.at("investment", default: none) != none { investment(data) }
  if on("marketDrop") and data.at("marketDrop", default: none) != none { market-drop(data) }
  if on("contingency") and data.contingency != none { contingency(data) }
  if on("insurance") and data.insurance != none { insurance(data) }
  if on("changes") { changes(data) }
  // 案の比較: 以前の形（mixed）では列が多い（4案より多い）ときだけ A4 横にする。縦にそろえるときは、列が多ければ行と列を入れ替える
  if on("comparison") and compared != none {
    if lay.orientation == "mixed" and compared.columns.len() > 4 {
      page(flipped: true, comparison(data, newpage: false))
    } else {
      comparison(data)
    }
  }
}
