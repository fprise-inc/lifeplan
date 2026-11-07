# ねんきん定期便・年金額改定通知書の読み方

- `docType`: ねんきん定期便は `pensionStatement`、年金額改定通知書は `pensionNotice`
- 名義の人: 書類の宛名の人（`holder`）。値の候補はどれも `"member": "holder"`
- 単位: 円（年額）と月数。書類の数字は円のまま書く（万円に丸めない）
- 確かめた資料: 日本年金機構のねんきん定期便のページ（様式の種類と、年齢ごとの記載の違い）・年金額改定通知書の見方のページ（HTML）。**定期便の様式のサンプルと見方ガイドは PDF のため開いていません**（欄の名前は、アプリの入力の欄の説明と年金機構のページの言葉に合わせています。様式の版で少し違うことがあります）

## 1. 書類の種類（いちばん大事）

年金の記録の型は、計算の結果を大きく変えます。**書類の見出しの言葉で決め、年齢から推測しない**でください。

| 書類 | 見分ける言葉 | `pensionRecord.kind` の値 |
|---|---|---|
| ねんきん定期便（50歳未満のはがき・35歳と45歳の封書） | 年金額の欄が「これまでの加入実績に応じた年金額」 | `statementUnder50` |
| ねんきん定期便（50歳以上のはがき・59歳の封書） | 年金額の欄が「老齢年金の種類と見込額」（65歳からの見込額） | `statementOver50` |
| 年金額改定通知書（受給中。毎年6月ごろ） | 「年金額改定通知書」。国民年金（基礎年金）・厚生年金保険の「基本額」「支給停止額」「年金額」 | `receiving` |
| 年金を受けている人の定期便（年金額の欄が無い） | 年金額の欄が無く、加入期間と月別の状況だけ | 型は書かない（加入月数だけ書き、`note` に「受給中の人の定期便です」） |

- 型の候補は2つ書く: まず入れ方 `{"item": "pensionRecord.kind", "value": "document"}`（書類から入れる）、次に書類の種類 `{"item": "pensionRecord.kind", "value": "statementUnder50"}`。どちらも `at` は書かない。
- 見出しが読めない・どちらとも言えないときは、書類の種類を `"value": null, "unreadable": true` にする（FP が選ぶ）。
- 令和8年10月からの定期便には、短時間労働者の保険料の調整を受けている人に軽減前の額も載ります。保険料の欄は読まないので、そのままで構いません。
- 年金振込通知書（2か月ごとの振込額・税などを引いた後）は年金額の書類ではありません。額を写さず、FP に年金額改定通知書を頼んでもらう。

## 2. 読む欄

### ねんきん定期便

| 書類の欄 | 入力項目ID・場所 | 書き方 |
|---|---|---|
| 作成の年月（「作成」「時点」の日付） | `pensionRecord.asOf` | `"YYYY-MM"`。答えの `asOf` にも同じ年月 |
| 年金加入期間の合計（未納月数を除く。国民年金の計〔第1号・第3号〕と厚生年金保険の計の合計） | `pensionRecord.months` `["basic"]` | 月数の整数。20歳前・60歳からの厚生年金の月、免除・猶予の月は含めない。書類で分けられないときは合計のまま書き、`note` に「20歳前の厚生年金の月が含まれているかもしれません」、確かさ `medium` |
| 厚生年金保険の加入期間の計 | `pensionRecord.months` `["employee"]` | 月数の整数（一般厚生年金・公務員・私学の期間の合計） |
| 受給資格期間（合算対象期間などを含む月数） | `pensionRecord.months` `["qualifying"]` | 月数の整数。欄が無ければ書かない |
| 国民年金の第1号の納付済み・全額免除・4分の3免除・半額免除・4分の1免除・納付猶予（学生納付特例）の月数（封書の加入履歴などで分かるとき） | `pensionRecord.months` `["category1", "paid"]`・`["category1", "exemptFull"]`・`["category1", "exemptThreeQuarters"]`・`["category1", "exemptHalf"]`・`["category1", "exemptQuarter"]`・`["category1", "deferred"]` | 月数の整数。分かる月だけ |
| 50歳未満: 「これまでの加入実績に応じた年金額」の老齢厚生年金 | `pensionRecord.amounts` `["employee"]` | 円の整数・`"period": "annual"`。一般厚生年金・公務員・私学の期間の額の合計 |
| 50歳未満: 同じ欄の老齢基礎年金 | 照合だけの値 | `references` に `{"label": "老齢基礎年金（加入実績に応じた額）", "amount": …}`。アプリは加入月数から計算するので入力にしない |
| 50歳以上: 見込額の老齢基礎年金（65歳から） | `pensionRecord.amounts` `["basic"]` | 円の整数・年額 |
| 50歳以上: 見込額の老齢厚生年金の報酬比例部分（65歳から） | `pensionRecord.amounts` `["employee"]` | 円の整数・年額。一般厚生年金・公務員・私学の期間の額の合計 |
| 50歳以上: 経過的加算部分 | 照合だけの値 | `references` に。アプリは加入月数から計算する |
| 50歳以上: 特別支給の老齢厚生年金（報酬比例部分。60〜64歳の年齢の欄に額があるとき） | `pensionRecord.amounts` `["special"]` | 円の整数・年額。額が「－」や空なら書かない |

### 年金額改定通知書（受給中）

| 書類の欄 | 入力項目ID・場所 | 書き方 |
|---|---|---|
| 通知の年月 | `pensionRecord.asOf` | `"YYYY-MM"` |
| 国民年金（基礎年金）の年金額 | `pensionRecord.amounts` `["basic"]` | 円の整数・年額 |
| 厚生年金保険の年金額 | `pensionRecord.amounts` `["employee"]` | 円の整数・年額。加給年金額・振替加算・経過的加算が分けて書いてあれば、それを除いた額にし、経過的加算は `["transitional"]` に書く。分けて書いていなければ年金額のまま書き、`note` に「加給年金・経過的加算を含むかもしれません」、確かさ `medium` |
| 支給停止額（0円でないとき） | 照合だけの値 | `references` に `{"label": "厚生年金の支給停止額", …}`。年金額の候補の確かさを `medium` にし、`note` に「支給停止額があります」 |
| 合計年金額（年額） | 照合だけの値 | `references` に |

## 3. 読まないもの

- 基礎年金番号・年金コード・照会番号（ねんきんネットの番号を含む）・お客さま番号。宛名の名前・住所・生年月日。
- 保険料の納付額・月別の状況の標準報酬月額（入力の欄が無い。加入履歴の行を写すのは、この手引きの範囲の外）。
- 受け取り開始の年齢（`pensionRecord.claim`）は書類からは決めない（FP とお客さまが決める）。

## 4. 答えの見本（架空の値）

ねんきん定期便（50歳未満のはがき）:

```json
{
  "contract": "document-candidates@1",
  "docType": "pensionStatement",
  "asOf": "2026-06",
  "holder": "self",
  "values": [
    { "item": "pensionRecord.kind", "member": "holder", "value": "document", "source": { "page": 1, "where": "ねんきん定期便" }, "confidence": "high" },
    { "item": "pensionRecord.kind", "member": "holder", "value": "statementUnder50", "source": { "page": 1, "where": "これまでの加入実績に応じた年金額" }, "confidence": "high", "note": "年金額の欄の見出しから、50歳未満の定期便としました" },
    { "item": "pensionRecord.asOf", "member": "holder", "value": "2026-06", "source": { "page": 1, "where": "作成の年月", "text": "令和8年6月" }, "confidence": "high" },
    { "item": "pensionRecord.months", "at": ["basic"], "member": "holder", "value": 196, "source": { "page": 1, "where": "年金加入期間 合計（未納月数を除く）", "text": "合計 196月" }, "confidence": "high" },
    { "item": "pensionRecord.months", "at": ["employee"], "member": "holder", "value": 172, "source": { "page": 1, "where": "厚生年金保険 計", "text": "172月" }, "confidence": "high" },
    { "item": "pensionRecord.months", "at": ["qualifying"], "member": "holder", "value": null, "unreadable": true, "source": { "page": 1, "where": "受給資格期間" }, "confidence": "low" },
    { "item": "pensionRecord.amounts", "at": ["employee"], "member": "holder", "value": 412300, "period": "annual", "source": { "page": 1, "where": "老齢厚生年金（加入実績に応じた額）", "text": "412,300円" }, "confidence": "high" }
  ],
  "references": [
    { "label": "老齢基礎年金（加入実績に応じた額）", "amount": 339600, "source": { "page": 1, "where": "老齢基礎年金", "text": "339,600円" } }
  ]
}
```

年金額改定通知書:

```json
{
  "contract": "document-candidates@1",
  "docType": "pensionNotice",
  "asOf": "2026-06",
  "holder": "self",
  "values": [
    { "item": "pensionRecord.kind", "member": "holder", "value": "document", "source": { "page": 1, "where": "年金額改定通知書" }, "confidence": "high" },
    { "item": "pensionRecord.kind", "member": "holder", "value": "receiving", "source": { "page": 1, "where": "年金額改定通知書" }, "confidence": "high" },
    { "item": "pensionRecord.asOf", "member": "holder", "value": "2026-06", "source": { "page": 1, "where": "通知の年月", "text": "令和8年6月" }, "confidence": "high" },
    { "item": "pensionRecord.amounts", "at": ["basic"], "member": "holder", "value": 798000, "period": "annual", "source": { "page": 1, "where": "国民年金（基礎年金） 年金額", "text": "798,000円" }, "confidence": "high" },
    { "item": "pensionRecord.amounts", "at": ["employee"], "member": "holder", "value": 1104000, "period": "annual", "source": { "page": 1, "where": "厚生年金保険 年金額", "text": "1,104,000円" }, "confidence": "medium", "note": "加給年金・経過的加算が分けて書かれていません。含まれていれば除いてください" }
  ],
  "references": [
    { "label": "合計年金額（年額）", "amount": 1902000, "row": "cf.income.pension", "year": 2026, "source": { "page": 1, "where": "合計年金額（年額）", "text": "1,902,000円" } }
  ]
}
```
