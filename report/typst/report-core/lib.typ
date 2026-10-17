// 公式の帳票（提案書の標準構成。構想書 6.11・0009 の9）の入口。
//   #import "@lifeplan/report-core:0.1.0": proposal
//   #proposal(json("/input.json"), json("/frame.json"))
// data: 帳票の入力（lifeplan.proposalInput 0.1.0。提示に必要な値だけ）
// frame: アプリが帳票の外側で決める値（刻印の帯の高さ band（pt）、必須の記載 notices）。刻印そのものはアプリが組んだ後に重ねる
// 帳票は刻印の帯（下端の band の高さ）の内側に描かない。金額は計算し直さず、書式だけを当てる
#import "parts/format.typ": *
#import "parts/layout.typ": *
#import "pages/front.typ": cover, assumptions
#import "pages/household.typ": summary, basics, events
#import "pages/cashflow.typ": cashflow
#import "pages/topics.typ": assets-page, education, housing, retirement
#import "pages/risk.typ": contingency, insurance
#import "pages/changes.typ": changes

#let supported = "0.1.0"

#let proposal(data, frame) = {
  assert(data.format == "lifeplan.proposalInput", message: "帳票の入力の形式が違います")
  assert(data.version == supported, message: "帳票の入力の版が対応していません: " + data.version)
  let band-height = frame.band * 1pt
  set document(title: data.document.title, author: ())
  set text(font: "BIZ UDGothic", lang: "ja", region: "jp", size: 9.5pt, fill: ink)
  set par(justify: false, leading: 0.7em)
  set page(paper: "a4", margin: (top: 18mm, left: 16mm, right: 16mm, bottom: 14mm + band-height))
  set heading(numbering: "1")
  show heading.where(level: 1): chapter-style

  cover(data)
  assumptions(data, frame)
  summary(data)
  basics(data)
  if data.events.len() > 0 { events(data) }
  cashflow(data, band-height)
  assets-page(data)
  if data.education != none { education(data) }
  if data.housingLoan != none { housing(data) }
  if data.retirement != none { retirement(data) }
  if data.contingency != none { contingency(data) }
  if data.insurance != none { insurance(data) }
  changes(data)
}
