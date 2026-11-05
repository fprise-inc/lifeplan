// 1. 表紙　2. 前提条件と注意書き
#import "../parts/format.typ": *
#import "../parts/layout.typ": *

/// 宛名欄の大きさ（表紙の部品が宣言する。0009 の3・9）
#let addressee-size = (width: 110mm, height: 14mm)

/// 宛名欄（宛名は印刷・出力のときに重ねる。保存しない）。位置と大きさを内部の印（metadata）で宣言する
#let addressee-field() = grid(
  columns: (auto, auto),
  column-gutter: 6pt,
  align: bottom,
  box(width: addressee-size.width, height: addressee-size.height, stroke: (bottom: 0.8pt + ink), context {
    let p = here().position()
    [#metadata((page: p.page, x: p.x.pt(), y: p.y.pt(), width: addressee-size.width.pt(), height: addressee-size.height.pt())) <lifeplan-addressee>]
  }),
  text(size: 14pt, "様"),
)

#let cover-facts(data) = {
  set text(size: 10pt)
  grid(
    columns: (auto, 1fr),
    row-gutter: 8pt,
    column-gutter: 14pt,
    text(fill: muted, "作成日"), date-ja(data.document.issuedOn),
    text(fill: muted, "計算基準日"), data.basis.baseMonthLabel,
    text(fill: muted, "試算の期間"), str(data.basis.years.first()) + "年〜" + str(data.basis.years.last()) + "年",
    ..if data.document.preparedBy != none { (text(fill: muted, "担当"), data.document.preparedBy) } else { () },
  )
}

#let cover-outline() = block(width: 100%, inset: 10pt, fill: band, radius: 3pt, {
  text(size: 9pt, weight: "bold", "目次")
  v(4pt)
  set text(size: 8.5pt)
  outline(title: none, depth: 1, indent: 0pt)
})

/// 事務所の見た目（0121）: 表紙の上に出す事務所のロゴと名前。どちらも無ければ none
#let cover-brand(brand) = {
  if brand == none { return none }
  let office = brand.at("office", default: none)
  let logo = brand.at("logo", default: none)
  // 画像の種類（png・jpg。アプリが外枠の値で渡す）
  let fmt = brand.at("format", default: auto)
  if office == none and logo == none { return none }
  grid(
    columns: (auto, auto),
    column-gutter: 10pt,
    align: horizon,
    if logo != none {
      // 高さ 14mm にそろえ、横に長いロゴは幅 60mm までに収める
      context {
        let img = image(logo, format: fmt, height: 14mm)
        if measure(img).width > 60mm { image(logo, format: fmt, width: 60mm) } else { img }
      }
    } else { [] },
    if office != none { text(size: 12pt, weight: "bold", fill: ink, office) } else { [] },
  )
}

/// 横の紙の表紙: 左に題名・宛名・作成日など、右に目次
#let cover-landscape(data, brand: none) = grid(
  columns: (1.15fr, 1fr),
  column-gutter: 14mm,
  {
    let b = cover-brand(brand)
    if b != none {
      b
      v(12mm)
    } else {
      v(24mm)
    }
    text(size: 11pt, fill: muted, data.basis.baseMonthLabel + "時点の試算")
    v(4pt)
    text(size: 26pt, weight: "bold", fill: ink, data.document.title)
    v(20mm)
    addressee-field()
    v(20mm)
    cover-facts(data)
  },
  {
    v(18mm)
    cover-outline()
  },
)

#let cover-portrait(data, brand: none) = {
  let b = cover-brand(brand)
  if b != none {
    b
    v(20mm)
  } else {
    v(36mm)
  }
  text(size: 11pt, fill: muted, data.basis.baseMonthLabel + "時点の試算")
  v(4pt)
  text(size: 26pt, weight: "bold", fill: ink, data.document.title)
  v(26mm)
  // 宛名欄: 宛名は印刷・出力のときに重ねる（保存しない）
  addressee-field()
  v(30mm)
  cover-facts(data)
  v(1fr)
  cover-outline()
}

#let cover(data, brand: none) = if is-land(data) { cover-landscape(data, brand: brand) } else { cover-portrait(data, brand: brand) }

#let assumptions(data, frame) = {
  chapter("前提条件と注意書き", sub: "この提案書の数字は、次の前提で計算した試算です。")
  let a = data.assumptions
  section("計算の前提")
  data-table(
    columns: (auto, 1fr),
    header: ("項目", "前提"),
    align: (x, y) => left + horizon,
    (
      ("計算基準日", data.basis.baseMonthLabel),
      ("表の期間", str(data.basis.years.first()) + "年〜" + str(data.basis.years.last()) + "年（各年12月末時点の年齢）"),
      ..a.rates.map(r => (r.label, r.value)),
      ..if a.survivor != none {
        (("遺族の生活費の割合", "末子の独立前 " + a.survivor.beforeIndependence + "、独立後 " + a.survivor.afterIndependence + "、子がいない場合 " + a.survivor.noChildren + if a.survivor.source == "default" { "（既定の割合）" } else { "" }),)
      } else { () },
    ).flatten(),
  )
  if a.advisoryFee != none {
    section("FP顧問料")
    let f = a.advisoryFee
    let parts = f.contracts.map(c => {
      let xs = c.oneTime.map(o => "単発 " + yen(o.amount) + "（" + o.month + "）")
      if c.recurring != none {
        let r = c.recurring
        xs.push((if r.per == "year" { "継続 年" } else { "継続 月" }) + yen(r.amount) + "（" + r.from + "から" + (if r.to != none { r.to + "まで" } else { "" }) + (if r.revision != none { "、" + r.revision } else { "" }) + "）")
      }
      c.label + ": " + xs.join("、")
    })
    callout[
      この試算には、FP顧問料（#parts.join("。")）を含みます。
      #if f.firstYear != none [支払いは#str(f.firstYear)年〜#str(f.lastYear)年、]累計は *#yen(f.total)* です。
    ]
  }
  if a.notes.len() > 0 { for n in a.notes { note(n) } }
  section("制度データの版")
  {
    set text(size: 8pt)
    grid(
      columns: (1fr, 1fr),
      column-gutter: 12pt,
      row-gutter: 4pt,
      ..a.dataSet.map(d => d.label + "　" + d.version + if d.fictional { "（架空の見本）" } else { "" }),
    )
  }
  section("ご留意いただきたいこと")
  // 必須の記載（試算である旨・出典名・担当FPが設定している旨など）の決まった欄。中身はアプリが帳票の外側で決めて渡す（0009 の6）
  block(width: 100%, inset: 10pt, radius: 3pt, stroke: 0.8pt + rule, {
    set text(size: 8.5pt)
    for n in frame.notices { block(below: 5pt, "・" + n) }
  })
}
