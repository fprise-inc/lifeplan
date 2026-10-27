// 独自帳票の見本: 収益不動産のまとめ（帳票の入力の realEstate を使う。説明は sdk/docs/reports.md）
// - 読めるのは、アプリが渡す帳票の入力（/input.json）と外枠の値（/frame.json）、同梱の公式の帳票の部品（@lifeplan/report-core）だけ
// - 金額は計算し直さない。書式（万円への四捨五入・3桁区切り・▲）は公式の部品の man を使う
// - 刻印の帯（下端の frame.band の高さ）の内側に描かない。刻印と「β版・試算」の透かしはアプリが組んだ後に重ねる
#import "@lifeplan/report-core:0.1.0": man, man-unit, data-table, section, note, callout, ink, muted

#let data = json("/input.json")
#let frame = json("/frame.json")
#assert(data.format == "lifeplan.proposalInput", message: "帳票の入力の形式が違います")

#set document(title: "収益不動産のまとめ", author: ())
#set text(font: "BIZ UDGothic", lang: "ja", region: "jp", size: 9pt, fill: ink)
#set par(justify: false, leading: 0.7em)
#set page(paper: "a4", margin: (top: 16mm, x: 14mm, bottom: 12mm + frame.band * 1pt))

// realEstate が無い入力（この欄の前の版）は、物件が無いのと同じに扱う
#let re = data.at("realEstate", default: (current: (), proposal: (), plans: ()))

/// 物件の見出しの一行（名義・構造・建った年・種類）
#let headline(p) = {
  let parts = ()
  if p.owner != none { parts.push(p.owner.label + "名義") }
  parts.push(p.structure.label)
  if p.builtYear != none { parts.push(str(p.builtYear) + "年築") }
  parts.push(if p.use == "rental" { "貸している" } else { "貸していない" })
  p.label + "（" + parts.join("・") + "）"
}

/// 年月（YYYY-MM → YYYY年M月）
#let month-ja(s) = { let x = s.split("-"); x.at(0) + "年" + str(int(x.at(1))) + "月" }

/// 1件の物件: 取得・売却の一行、表の期間の合計、年ごとの表（持っている年と、お金の動きのある年だけ）
#let property(p) = {
  section(headline(p))
  let facts = ()
  if p.acquisition != none { facts.push("取得 " + month-ja(p.acquisition.month) + "・" + man-unit(p.acquisition.price)) }
  if p.sale != none {
    facts.push("売却 " + month-ja(p.sale.month) + "・売却価格 " + man-unit(p.sale.price) + "・費用 " + man-unit(p.sale.costs) + "・手取り " + man-unit(p.sale.proceeds))
  }
  if facts.len() > 0 { block(below: 6pt, text(fill: muted, facts.join("　"))) }
  callout[
    表の期間の合計: 家賃収入 #man-unit(p.totals.rent)　経費 #man-unit(p.totals.expenses)　ローンの返済 #man-unit(p.totals.loanRepayment)　手残り #man-unit(p.totals.cashAfterLoan)
  ]
  let rows = p.years.filter(y => y.held or y.rent != 0 or y.expenses != 0 or y.loanRepayment != 0)
  data-table(
    columns: (auto, 1fr, 1fr, 1fr, 1fr, 1fr, 1fr, 1fr, 1fr),
    header: ("年", "家賃収入", "経費", "減価償却", "利息", "不動産所得", "ローン残高", "手残り", "評価額"),
    size: 7.5pt,
    rows.map(y => (
      str(y.year),
      man(y.rent),
      man(y.expenses),
      if y.depreciation == none { "—" } else { man(y.depreciation) },
      if y.interest == none { "—" } else { man(y.interest) },
      if y.income == none { "—" } else { man(y.income) },
      man(y.loanBalance),
      man(y.cashAfterLoan),
      if y.value == none { "—" } else { man(y.value.total) },
    )).flatten(),
  )
  note[単位は万円。手残り＝家賃収入−経費−ローンの返済（繰上返済を含む）。不動産所得＝家賃収入−経費（貸している月の分）−減価償却費−借入の利息（マイナスは損失）。評価額は年末の土地と建物の合計（売った年からは「—」）。]
}

/// 1つの案の物件の一覧
#let plan(title, props) = {
  heading(level: 1, title)
  if props.len() == 0 { text(fill: muted, "住まい以外の不動産はありません。") } else {
    for p in props { property(p) }
  }
}

#text(size: 16pt, weight: "bold", "収益不動産のまとめ")
#v(2pt)
#text(fill: muted, "計算基準月 " + data.basis.baseMonthLabel + "　作成日 " + data.document.issuedOn)
#v(8pt)

#if re.current.len() == 0 and re.proposal.len() == 0 {
  text("住まい以外の不動産はありません。")
} else {
  plan("提案", re.proposal)
  pagebreak(weak: true)
  plan("現状", re.current)
}

// 必須の記載（試算である旨など）。帳票に無いとアプリが「注意書き」のページを足す
#v(12pt)
#heading(level: 1, "注意書き")
#for n in frame.notices { block(below: 5pt, "・" + n) }
