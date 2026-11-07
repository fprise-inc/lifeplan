# 住宅ローンの年末残高等証明書・返済予定表の読み方

- `docType`: 年末残高等証明書（住宅取得資金に係る借入金の年末残高等証明書）は `housingLoanBalance`、税務署から届く「年末調整のための住宅借入金等特別控除証明書」は `housingLoanCredit`、返済予定表（償還予定表）は `loanSchedule`
- 名義の人: 借入をした人（`holder`）。ローンの値は人ではなく**ローン（物）の欄**です
- 単位: 円（残高・借入額）、年（返済期間）、%（金利）
- どのローンか: AI接続口で世帯を受け取っていれば、そのローンの ID を `"object"` に書きます。ウェブのチャットでは ID が分からないので `object` を書きません（FP が確かめの画面で当てるローンを選びます）。
- **世帯に住宅ローンがまだ無いとき**（FP が「新しいローン」と言ったとき・AI接続口の世帯に住宅ローンが無いとき）は、`objects` に `{"key": "l1", "kind": "debt:mortgage"}` を書き、ローンの値の候補に `"newObject": "l1"` を書きます。FP が確かめの画面で「足す」か「今の住宅ローンに当てる」を選びます（同じローンが世帯にあれば、黙って増えません）
- 返済期間の欄は2通りあります: 今のローン（借入額から入れたローン）は**返済期間（年の整数）**、新しく足すローン（今の残高から入れるローン）は**完済の年月**（`"YYYY-MM"`。償還期間の「至」の年月）。どちらも `debt.repayment` の `["termMonths"]` です。`object` を書かないときは年の整数、`newObject` のときは完済の年月を書きます
- 確かめた資料: 国税庁の住宅借入金等特別控除の資料・記載例（年末残高と当初借入金額の書き方）と、年末残高の情報のマイナポータル連携のページ。証明書の様式（PDF）は開いていません。返済予定表には決まった様式がありません（銀行ごとに違います）

## 1. 年末残高等証明書

| 書類の欄 | 入力項目ID・場所 | 書き方 |
|---|---|---|
| 年末残高（住宅借入金等の金額） | `debt.balance` | 円の整数・`"period": "once"` |
| 証明の年の12月 | `debt.balanceAsOf` | `"YYYY-12"`（令和7年末の残高 → `"2025-12"`）。答えの `asOf` も同じ |
| 当初金額（当初借入金額。括弧の中に書かれていることが多い） | `debt.principal` | 円の整数・`"period": "once"` |
| 償還期間（賦払期間）の年数 | `debt.repayment` `["termMonths"]` | 今のローン（`object` を書かない・ID を書く）は**年の整数**。「35年0月」→ `35`。月の端数があれば書かず、`note` に「償還期間 34年6か月」。新しく足すローン（`newObject`）は償還期間の「至」の年月（`"2053-04"`） |
| 居住開始年月日（書いてあるとき） | `debt.housing` `["moveIn"]` | `"YYYY-MM"` |
| 住宅の取得の対価の額（書いてあるとき） | `debt.housing` `["acquisitionCost"]` | 円の整数・`"period": "once"` |
| 当初借入年月日（借入の年月） | `debt.start` | `"YYYY-MM"`（時点の欄。書類の年月を決まった年月として入れる）。分からなければ書かない |
| 連帯債務・連帯保証の記載 | （書かない） | `note` に「連帯債務の記載があります」。ローンの名義は FP が決める |

- 連帯債務で夫婦それぞれに証明書があるときは、1通ずつ答えを分ける（残高は2人の合計ではなく、それぞれの証明書の額）。
- 令和5年以後に入居して、金融機関から税務署への調書の方式になった人には、証明書の代わりに税務署から年末残高の情報が届きます。同じ項目があれば同じように読む。
- マイナポータルから保存した電子データ（XML）の証明書は、アプリが自分で読めます（このパソコンの中だけで読む。FP に「入力のホームの書類の読み取りの『控除証明書の電子データ（XML）を読む』で読めます」と伝える）。

## 1-2. 年末調整のための住宅借入金等特別控除証明書（税務署）

| 書類の欄 | 入力項目ID・場所 | 書き方 |
|---|---|---|
| 居住開始年月日 | `debt.housing`（`at` なし） | `"YYYY-MM"`（入居の年月（控除）） |
| 住宅の区分等（認定住宅・ＺＥＨ水準省エネ住宅・省エネ基準適合住宅） | `debt.housing` `["propertyType"]` | `"certified"`・`"zeh"`・`"energySaving"`。区分の記載が無く「中居住者用」だけなら `"other"`（確かさ `medium`） |
| 住宅の区分等（新築・買取再販・中古住宅） | `debt.housing` `["newBuild"]` | 新築・買取再販は `"new"`、中古住宅は `"used"` |
| 住宅借入金等の年末残高（令和5年以降の居住の版にある） | `debt.balance` | 住宅のみ・土地等のみ・住宅及び土地等の額を足した円の整数・`"period": "once"`・確かさ `medium` |
| 年末調整の年分 | `debt.balanceAsOf` | 年末残高を読んだときだけ、その年の12月（`"2026-12"`） |

- 控除率・控除限度額・最高限度額・控除額は、アプリが計算するので書かない。

## 2. 返済予定表

| 書類の欄 | 入力項目ID・場所 | 書き方 |
|---|---|---|
| 金利の種類（変動・固定期間選択・全期間固定） | `debt.rateSchedule`（`at` なし） | `"variable"`・`"fixedPeriod"`・`"fixed"`。金利の段階が何本かあるときは FP が当てる段階を選ぶ |
| 今の適用金利 | `debt.rateSchedule` `["rate"]` | `"0.775%"` のように % を付ける。金利の段階が何本かあるときは FP が当てる段階を選ぶ |
| 返済方法（元利均等・元金均等） | `debt.repayment`（`at` なし） | `"equalPayment"`・`"equalPrincipal"` |
| 返済後の残高（FP が言った月か、表の作成日に近い過ぎた返済日の行） | `debt.balance` | 円の整数・`"period": "once"` |
| その行の返済日の年月 | `debt.balanceAsOf` | `"YYYY-MM"` |
| 借入金額（表の見出し） | `debt.principal` | 円の整数・`"period": "once"` |
| 返済期間（表の見出しに年数があるとき） | `debt.repayment` `["termMonths"]` | 年の整数 |
| 毎月の返済額（元金＋利息） | 照合だけの値 | `{"label": "毎月の返済額", "amount": …}`（月額。行・年は書かない） |
| ボーナス返済の額 | 照合だけの値 | `{"label": "ボーナス返済の額（1回）", …}`。ボーナス返済の割合は書かない（割合の決め方が銀行で違う） |
| 最終回の返済日 | （書かない） | `note` に「最終回 2059年3月」 |

- 表の行を何十行も写さない（読むのは見出しと、残高の1行だけ）。
- 金利が今後変わる予定（固定期間の終わり）は、`note` に「固定期間は 2030年9月まで」と書く。金利の見込みは FP が決める。

## 3. 読まないもの

- 口座番号・お客さま番号・ローンの番号（融資番号・契約番号）・証明書の発行番号・整理番号・お問い合わせ番号。
- 借入をした人・連帯債務者の名前・住所・生年月日。証明書のあて名（郵便番号・住所・氏名）。担保の物件の地番・住所。
- 団体信用生命保険の告知の内容。

## 4. 答えの見本（架空の値）

年末残高等証明書（ウェブのチャットで読んだので、ローンの ID は書かない）:

```json
{
  "contract": "document-candidates@1",
  "docType": "housingLoanBalance",
  "asOf": "2025-12",
  "holder": "self",
  "values": [
    { "item": "debt.balance", "value": 28450000, "period": "once", "source": { "page": 1, "where": "住宅借入金等の金額 年末残高", "text": "28,450,000円" }, "confidence": "high" },
    { "item": "debt.balanceAsOf", "value": "2025-12", "source": { "page": 1, "where": "年末残高（令和7年12月31日）" }, "confidence": "high" },
    { "item": "debt.principal", "value": 35000000, "period": "once", "source": { "page": 1, "where": "当初金額", "text": "（35,000,000円）" }, "confidence": "high" },
    { "item": "debt.repayment", "at": ["termMonths"], "value": 35, "source": { "page": 1, "where": "償還期間", "text": "35年0月" }, "confidence": "high" },
    { "item": "debt.start", "value": "2018-04", "source": { "page": 1, "where": "当初借入年月日", "text": "平成30年4月25日" }, "confidence": "high" }
  ]
}
```

世帯に住宅ローンがまだ無いときの年末残高等証明書（新しいローンとして足す。返済期間の欄は完済の年月）:

```json
{
  "contract": "document-candidates@1",
  "docType": "housingLoanBalance",
  "asOf": "2026-01",
  "holder": "self",
  "objects": [{ "key": "l1", "kind": "debt:mortgage", "source": { "page": 1, "where": "住宅借入金等に係る債権者", "text": "架空の銀行 住宅ローン" }, "confidence": "high" }],
  "values": [
    { "item": "debt.balance", "newObject": "l1", "value": 28450000, "period": "once", "source": { "page": 1, "where": "住宅借入金等の金額 年末残高", "text": "28,450,000円" }, "confidence": "high" },
    { "item": "debt.balanceAsOf", "newObject": "l1", "value": "2025-12", "source": { "page": 1, "where": "年末残高（令和7年12月31日）" }, "confidence": "high" },
    { "item": "debt.principal", "newObject": "l1", "value": 35000000, "period": "once", "source": { "page": 1, "where": "当初金額", "text": "（35,000,000円）" }, "confidence": "high" },
    { "item": "debt.start", "newObject": "l1", "value": "2018-04", "source": { "page": 1, "where": "当初借入年月日", "text": "平成30年4月25日" }, "confidence": "high" },
    { "item": "debt.repayment", "at": ["termMonths"], "newObject": "l1", "value": "2053-04", "source": { "page": 1, "where": "償還期間（至）", "text": "令和35年4月" }, "confidence": "high" }
  ]
}
```

返済予定表:

```json
{
  "contract": "document-candidates@1",
  "docType": "loanSchedule",
  "asOf": "2026-10",
  "holder": "self",
  "values": [
    { "item": "debt.rateSchedule", "value": "variable", "source": { "page": 1, "where": "金利の種類", "text": "変動金利型" }, "confidence": "high" },
    { "item": "debt.rateSchedule", "at": ["rate"], "value": "0.775%", "source": { "page": 1, "where": "適用金利", "text": "年 0.775%" }, "confidence": "high" },
    { "item": "debt.repayment", "value": "equalPayment", "source": { "page": 1, "where": "返済方法", "text": "元利均等返済" }, "confidence": "high" },
    { "item": "debt.balance", "value": 27612000, "period": "once", "source": { "page": 2, "where": "2026年10月 返済後残高", "text": "27,612,000" }, "confidence": "medium", "note": "表の作成日に近い、過ぎた返済日の行の残高です" },
    { "item": "debt.balanceAsOf", "value": "2026-10", "source": { "page": 2, "where": "返済日", "text": "2026/10/27" }, "confidence": "medium" }
  ],
  "references": [
    { "label": "毎月の返済額", "amount": 93550, "source": { "page": 2, "where": "返済額（元金＋利息）", "text": "93,550" } }
  ]
}
```
