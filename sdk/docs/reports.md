# 帳票（Typst）の作り変え

独自帳票は、カスタム層の `reports/<帳票名>/main.typ` に置く Typst の文書です（0016）。アプリが提案書を作るときと同じ値を渡し、同じ仕組みで PDF にします。

## 読めるもの・守ること

- 読めるのは、アプリが渡す **帳票の入力**（`/input.json`）と **外枠の値**（`/frame.json`）、同梱の公式の帳票の部品 `@lifeplan/report-core` だけです。ほかのファイル・ネットワーク・時計は読めません（`datetime.today()` はエラー）。フォントは同梱の `BIZ UDGothic` だけです。
- 金額は計算し直しません。帳票の入力の金額（円の整数）に、書式（万円への四捨五入・3桁区切り・▲）だけを当てます。公式の部品の `man`（万円）・`man-unit`（万円の単位つき）・`yen`（円）を使えます。
- ページの下端の `frame.band`（pt）の高さには描きません。刻印（制度データの版・計算基準日）と「β版・試算」の透かしは、アプリが組んだ後に重ねます（帳票からは消せません）。
- 必須の記載 `frame.notices` をどこかに載せます。載っていなければ、アプリが「注意書き」のページを最後に足します。
- 帳票の入力には、氏名・宛名・FP のメモ・世帯の内部 ID は入っていません。構成員は提示用の鍵（`self`・`spouse`・`child1` …）と呼び方（ご主人・奥様・長男 …）で表します。

```typst
#import "@lifeplan/report-core:0.1.0": man, man-unit, data-table, section, note, ink
#let data = json("/input.json")
#let frame = json("/frame.json")
#set text(font: "BIZ UDGothic", lang: "ja", size: 9pt, fill: ink)
#set page(paper: "a4", margin: (top: 16mm, x: 14mm, bottom: 12mm + frame.band * 1pt))
```

## 帳票の入力（`lifeplan.proposalInput` 0.1.0。試験版）

形の正は JSON Schema（`schemas/` の帳票に渡す値）です。主な欄:

| 欄 | 中身 |
|---|---|
| `basis.years` | 表に出す年（年ごとの並びは、どれもこの順） |
| `members` | 構成員の鍵・呼び方・年ごとの年齢 |
| `cashflow.current`・`.proposal` | キャッシュフロー表（現状・提案）の行 |
| `assets`・`balanceSheet` | 金融資産の推移、資産と負債 |
| `comparison` | 案の比較（列は現状と各案） |
| `realEstate` | 住まい以外の不動産の物件ごとの数字（下） |

欄を足すときは、同じ版の中で任意の欄として足します。古い入力では無いことがあるので、`data.at("realEstate", default: …)` のように読みます。

## 住まい以外の不動産の物件ごとの数字（`realEstate`）

公式の帳票は使わない、独自帳票のための値です。収益不動産を扱う帳票（物件ごとの収支・ローン・評価額）を作るときに読みます。

- `realEstate.current`・`realEstate.proposal` … 現状と提案の物件の配列。`realEstate.plans` … 案の比較の各案（`letter`・`name`・`properties`。案の比較が無ければ空）
- 持っていない案は**空の配列**です。ページを出すかどうかはこれで決めます。
- 入るのは、中身（土地と建物・家賃収入・経費）を入れた不動産だけです。住まい（持ち家）は入りません。

物件1件の欄:

| 欄 | 中身 |
|---|---|
| `key`・`label` | 提示用の鍵（`property1` …）と呼び方（不動産1 …）。世帯の並び順。物件の名前の欄はまだありません |
| `owner` | 名義の人（`members` と同じ `key`・`label`） |
| `use` | `rental`（貸している）・`held`（貸していない） |
| `structure` | 建物の構造（`key` は `wood`・`lightSteel`・`steel`・`rc`、`label` は木造など） |
| `builtYear`・`acquisition` | 建った年（入れた年。省略は null）、取得価額と取得の年月（無ければ null） |
| `years[]` | 年ごと（`basis.years` と同じ並び）。下の表 |
| `totals` | 表の期間の合計（家賃収入・経費・返済・手残り） |
| `sale` | 売却（`month`・`value` 売る年の評価額・`price`・`costs`・`proceeds` 手取り・`tax`）。売らなければ null。`tax` は税の額の口がまだ無いので null |

`years[]` の欄:

| 欄 | 中身 |
|---|---|
| `held`・`value` | 年末に持っているか、年末の評価額（`land`・`building`・`total`。持っていない年は null） |
| `rent`・`expenses` | 家賃収入・経費（キャッシュフロー表の「家賃収入」「不動産の経費」の行の、この物件の分。経費は貸していない月の分も含む） |
| `depreciation`・`interest`・`landInterest`・`income` | 減価償却費・借入の利息・そのうち土地の取得のための分・不動産所得（貸している年だけ。ほかは null） |
| `loanBalance`・`loanRepayment` | この物件のための借入の年末の残高と、その年の返済額（繰上返済・手数料を含む） |
| `cashAfterLoan` | 物件の手残り（家賃収入−経費−返済額） |

すべての物件の `rent` の合計は、キャッシュフロー表の「家賃収入」の行と同じです（経費も同じ）。

## 見本

- `examples/reports/rental-property-summary/main.typ` … 収益不動産のまとめ。提案と現状の物件ごとに、見出し（名義・構造・建った年）、取得と売却、表の期間の合計、年ごとの表（年・家賃収入・経費・減価償却・利息・不動産所得・ローン残高・手残り・評価額）。物件が無ければ「ありません」の1ページ。

## 今の制限（試験版）

- 独自帳票は `main.typ` の1つのファイルだけです（同じフォルダのほかのファイルを読み込む形は後の版）。
- 公式の帳票の部品の名前（`man`・`data-table` など）は、部品の版（`@lifeplan/report-core:0.1.0`）ごとに決まります。版が上がったら `changes/` を読みます。
