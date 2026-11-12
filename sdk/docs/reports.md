# 帳票（Typst）の作り変え

独自帳票は、カスタム層の `reports/<帳票名>/main.typ` に置く Typst の文書です（0016）。アプリが提案書を作るときと同じ値を渡し、同じ仕組みで PDF にします。

## 読めるもの・守ること

- 読めるのは、アプリが渡す **帳票の入力**（`/input.json`）と **外枠の値**（`/frame.json`）、同梱の公式の帳票の部品 `@lifeplan/report-core` だけです。ほかのファイル・ネットワーク・時計は読めません（`datetime.today()` はエラー）。フォントは同梱の `BIZ UDGothic` だけです。
- 金額は計算し直しません。帳票の入力の金額（円の整数）に、書式（万円への四捨五入・3桁区切り・▲）だけを当てます。公式の部品の `man`（万円）・`man-unit`（万円の単位つき）・`yen`（円）を使えます。
- ページの下端の `frame.band`（pt）の高さには描きません。刻印（制度データの版・計算基準日）と「β版・試算」の透かしは、アプリが組んだ後に重ねます（帳票からは消せません）。
- 必須の記載 `frame.notices` をどこかに載せます。載っていなければ、アプリが「注意書き」のページを最後に足します。
- 帳票の入力には、氏名・宛名・FP のメモ・世帯の内部 ID は入っていません。構成員は提示用の鍵（`self`・`spouse`・`child1` …）と呼び方（ご本人・配偶者・第1子 …）で表します。

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
| `cashflow.current`・`.proposal` | キャッシュフロー表（現状・提案）の行（住まい以外の不動産のローンがある世帯は、行の鍵 `realEstateLoan`〔不動産のローンの返済〕・`realEstateDebt`〔不動産のローン残高〕もある。住まい以外の不動産を売る予定を入れた世帯は、収入の行の鍵 `realEstateSale`〔不動産の売却。売った手取り。「その他の収入」から外す〕もある。事業所得のある人は人ごとの行の鍵 `business:<人の鍵>`〔○○の事業所得〕、年金で受け取る企業年金・iDeCo・個人年金保険などがあれば `corporatePension`〔企業年金・個人年金〕もある。どちらも「その他の収入」から外す） |
| `cashflow.keyYears` | 抜粋で必ず載せる年（現状と提案の両方の出来事の年。任意） |
| `assets`・`balanceSheet` | 金融資産の推移、資産と負債 |
| `comparison` | 案の比較（列は現状と各案） |
| `realEstate` | 住まい以外の不動産の物件ごとの数字（下） |
| `rental` | 収益不動産のまとめ（公式の帳票の章の材料。下。物件が無い・章を外したときは null） |
| `extensions` | 提案書の拡張の章の材料（章の id `ext.<作成者>.<名前>` → 束の関数が返した対。`extensions.md`。合算BS は `ext.official.combinedBs`。章を選んでいないときは null） |

欄を足すときは、同じ版の中で任意の欄として足します。古い入力では無いことがあるので、`data.at("realEstate", default: …)` のように読みます。

## 住まい以外の不動産の物件ごとの数字（`realEstate`）

独自帳票のための値です（公式の帳票の収益不動産のまとめは、下の `rental` を読みます）。収益不動産を扱う帳票（物件ごとの収支・ローン・評価額）を作るときに読みます。

- `realEstate.current`・`realEstate.proposal` … 現状と提案の物件の配列。`realEstate.plans` … 案の比較の各案（`letter`・`name`・`properties`。案の比較が無ければ空）
- 持っていない案は**空の配列**です。ページを出すかどうかはこれで決めます。
- 入るのは、中身（土地と建物・家賃収入・経費）を入れた不動産だけです。住まい（持ち家）は入りません。

物件1件の欄:

| 欄 | 中身 |
|---|---|
| `key`・`label` | 提示用の鍵（`property1` …）と呼び方（不動産1 …）。世帯の並び順 |
| `name`・`kind` | 物件名（入れていれば。無ければ null）と種類（`key` は `condo`・`apartment` など、`label` は区分マンションなど）。所在地・メモは入りません |
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

## 収益不動産のまとめ（`rental`）

公式の帳票の章「収益不動産のまとめ」の材料です。提案のプランの貸している物件の分析の数字（エンジンの `asset.realEstateAnalysis` の出力）に、書式を当てたものです。独自帳票からも読めます。

- `rental.pointYear` … 指標を見る年（表の最初の年）
- `rental.properties[]` … 物件ごと。`label`（物件名。無ければ物件1 …）・`kind`・`owner`・`structure`・`builtYear`・`acquisition`（取得の年月・取得価額の合計・諸費用・自己資金）・`legalLife`（法定耐用年数）・`depreciationEnd`（減価償却が終わる年）・`depreciationEndText`（その文。売るまでに終わらなければ「売るまでには終わりません（2065年に終わる見込み）」、償却が無ければ null）・`deadCross`（元金の返済が減価償却費を上回る最初の年）・`deadCrossNow`（計算の最初の年から、もう上回っている）・`lodging`（民泊・宿）・`actualRent`（今の実際の家賃収入で入れた物件。省略は満室時の家賃で入れた物件）・`depreciationFrom`（減価償却を確定申告の数字から引き継いだ年。省略は取得価額からの計算）。建物の無い物件（貸している土地・駐車場）は `builtYear`・`legalLife` が null
  - `point` … その年の指標。率は書式を当てた文字列（`5.2%`・`1.16倍`。分母が0・無いときは `—`）: `grossYield` 表面利回り（民泊・宿は `—`。`actualRent` の物件は今の収入での表面利回り）・`netYield` 実質利回り・`breakEven` 損益分岐の入居率（`actualRent` の物件は `—`）・`repaymentRatio` 返済比率・`dscr` 返済余裕率・`ltv` 借入の割合・`ccr` 自己資金に対する手残りの割合。`monthlyBeforeTax`・`monthlyAfterTax` 月の手残り（円）、`unrealizedGain` 含み益（評価額−帳簿価額〔取得価額＋取得時の諸費用−減価償却の累計〕。取得価額が無ければ null）、`equity` 売ったときの手残りの目安（評価額−ローン残高。売却の費用・税は引かない）、`age`・`remainingLife` 築年数・残りの耐用年数、`lodging` 民泊・宿の稼働率・1泊の単価・営業日数・年の売上
  - `years[]` … 年ごと（表の年のうち持っている年）: `rent`・`expenses`・`repairs`・`depreciation`・`interest`・`income`・`repayment`・`cashBeforeTax`・`tax`（その物件で増える税と社会保険料の近似）・`cashAfterTax`・`loanBalance`・`value`・`deadCross`（その年が元金の返済が減価償却費を上回る最初の年か）
  - `exit` … 今の予定の売却（手取り・ローンの一括返済・譲渡所得の税・税引後の手取り `net`）。売らなければ null
  - `saleCompare` … 売る年を変えた比較（`rows[]` の `label`・`current`・`net` 税引後の手取り・`financialEnd` 表の最後の年の金融資産・`diff` 今の予定との差・`equityEnd` 表の最後の年の評価額−ローン残高）。材料が無ければ null
- `rental.total` … 全物件の合計（物件が2件以上のとき。`point` と `years`）。1件なら null

## 見本

- `examples/reports/rental-property-summary/main.typ` … 収益不動産のまとめ（独自帳票の作り方の見本。公式の帳票にも同じ名前の章があります）。提案と現状の物件ごとに、見出し（名義・構造・建った年）、取得と売却、表の期間の合計、年ごとの表（年・家賃収入・経費・減価償却・利息・不動産所得・ローン残高・手残り・評価額）。物件が無ければ「ありません」の1ページ。

## 今の制限（試験版）

- 独自帳票は `main.typ` の1つのファイルだけです（同じフォルダのほかのファイルを読み込む形は後の版）。
- 公式の帳票の部品の名前（`man`・`data-table` など）は、部品の版（`@lifeplan/report-core:0.1.0`）ごとに決まります。版が上がったら `changes/` を読みます。
