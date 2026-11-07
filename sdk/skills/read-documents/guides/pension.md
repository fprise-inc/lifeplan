# ねんきん定期便・年金額改定通知書の読み方

- `docType`: ねんきん定期便は `pensionStatement`、年金額改定通知書は `pensionNotice`
- 名義の人: 書類の宛名の人（`holder`）。値の候補はどれも `"member": "holder"`
- 単位: 円（年額）と月数。書類の数字は円のまま書く（万円に丸めない）
- 確かめた資料: 日本年金機構の令和8年度のねんきん定期便の様式のサンプルと見方ガイド（はがきの50歳未満・50歳以上・年金受給者〔10月以降の送付分〕と、35歳・45歳の封書）、年金額改定通知書の見方のページ。9月以前と10月以降の送付分は、加入期間と年金額の欄の並びが同じです（10月からは、保険料の調整を受けている短時間労働者に軽減前の保険料の額が載るだけ）

## 1. 書類の種類（いちばん大事）

年金の記録の型は、計算の結果を大きく変えます。**書類の見出しの言葉で決め、年齢から推測しない**でください。

| 書類 | 見分ける言葉 | `pensionRecord.kind` の値 |
|---|---|---|
| ねんきん定期便（50歳未満のはがき・35歳と45歳の封書） | 裏の「３．これまでの加入実績に応じた年金額（年額）」 | `statementUnder50` |
| ねんきん定期便（50歳以上のはがき・59歳の封書） | 裏の「３．老齢年金の種類と見込額（年額）」（受給開始年齢ごとの見込額） | `statementOver50` |
| 年金額改定通知書（受給中。毎年6月ごろ） | 「年金額改定通知書」。国民年金（基礎年金）・厚生年金保険の「基本額」「支給停止額」「年金額」 | `receiving` |
| 年金を受けている人の定期便（年金額の欄が無い） | 「最近の月別状況」と「これまでの年金加入期間」だけで、年金額の欄が無い | 型は書かない（加入月数だけ書き、`note` に「受給中の人の定期便です」） |

- 型の候補は2つ書く: まず入れ方 `{"item": "pensionRecord.kind", "value": "document"}`（書類から入れる）、次に書類の種類 `{"item": "pensionRecord.kind", "value": "statementUnder50"}`。どちらも `at` は書かない。
- 見出しが読めない・どちらとも言えないときは、書類の種類を `"value": null, "unreadable": true` にする（FP が選ぶ）。
- 年金振込通知書（2か月ごとの振込額・税などを引いた後）は年金額の書類ではありません。額を写さず、FP に年金額改定通知書を頼んでもらう。

## 2. 加入月数の読み方（定期便の「２．これまでの年金加入期間」）

定期便の加入期間の欄は、国民年金（ａ）〔第１号被保険者（未納月数を除く）・第３号被保険者・国民年金 計〕、厚生年金保険（ｂ）〔一般厚生年金・公務員厚生年金・私学共済厚生年金・厚生年金保険 計〕、船員保険（ｃ）、**年金加入期間 合計（未納月数を除く）（ａ＋ｂ＋ｃ）**、合算対象期間等（ｄ）、**受給資格期間（ａ＋ｂ＋ｃ＋ｄ）**、付加保険料納付済月数です。

ファイナンシアの「国民年金の加入月数」（`pensionRecord.months` `["basic"]`）は、**老齢基礎年金の額に満額で数える月**（第１号の納付済・第３号・20〜59歳の厚生年金の月）です。定期便の「合計」とは、次の2つがずれます。

1. **第１号の免除・猶予の月**: 「第１号被保険者（未納月数を除く）」は、保険料を納めた月と**免除された月**の合計です（全額・一部免除、学生納付特例・納付猶予の月も未納ではないので入っています）。合計にもそのまま入っています。ファイナンシアでは免除・猶予の月を加入月数に入れず、免除・猶予の内訳に分けます。
2. **20歳前・60歳から後の厚生年金の月**: 「厚生年金保険 計」と合計には、20歳前（高校を出てすぐ働いた月など）と60歳から後に厚生年金に入っていた月も入っています。老齢基礎年金の額には数えないので、加入月数からは引きます（厚生年金の加入月数には入れたまま）。

### はがき（毎年の定期便）

はがきには第１号の免除の内訳が無く（最近の13か月の月別状況だけ）、加入の歴史も無いので、上の2つは分けられません。

- 加入月数 `["basic"]` には「年金加入期間 合計（未納月数を除く）」を書き、**確かさは `medium`**、`note` に「合計には第１号の免除・猶予の月と、20歳前・60歳から後の厚生年金の月が含まれます。あれば引いてください」と書く。
- 「第１号被保険者（未納月数を除く）」が0月なら、免除・猶予の月は無いので、`note` は20歳前・60歳から後の厚生年金の月のことだけでよい。
- 最近の月別状況に「全額免除」「半額免除」「学特」「猶予」などの月があれば、確かさを `low` にし、`note` にその月の数を書く（それより前の免除は、はがきでは分からない）。
- 免除・猶予の内訳の候補（`["category1", …]`）は、はがきからは書かない。

### 封書（35歳・45歳・59歳の定期便）

封書には、国民年金（ａ）の内訳（納付済月数・全額免除月数・半額免除月数・４分の３免除月数・４分の１免除月数・学特等月数〔うち猶予〕・産前産後免除月数・第３号月数・計・付加保険料納付済月数・未納月数）と、年金加入履歴（加入した制度と、資格を取った・失った年月日）があります。

- 加入月数 `["basic"]` = 納付済月数 ＋ 産前産後免除月数 ＋ 第３号月数 ＋ 厚生年金保険 計 ＋ 船員保険（ｃ）。確かさ `medium`、`note` に足し算を書く。20歳前・60歳から後の厚生年金の月は、加入履歴と生年月日が無いと分からない（生年月日は読まない）ので、`note` に「20歳前・60歳から後の厚生年金の月があれば引いてください」。
- 免除・猶予の内訳は、0月でない欄だけ書く:

  | 封書の欄 | 場所 `at` |
  |---|---|
  | 納付済月数 ＋ 産前産後免除月数（産前産後の免除は納めた月と同じに数える） | `["category1", "paid"]` |
  | 全額免除月数 | `["category1", "exemptFull"]` |
  | ４分の３免除月数 | `["category1", "exemptThreeQuarters"]` |
  | 半額免除月数 | `["category1", "exemptHalf"]` |
  | ４分の１免除月数 | `["category1", "exemptQuarter"]` |
  | 学特等月数（学生納付特例・納付猶予。追納した月は納付済に入っている） | `["category1", "deferred"]` |

  - 一部免除の月数は「免除の後の残りを納めた月」の数です（残りを納めていない月は未納）。書類の数のまま書く。
  - 免除・猶予の内訳は、世帯の年金の記録にその内訳の欄がまだ無いと「入れる欄がありません」になります。FP が年金の画面の「＋ 免除・猶予の月を入れる」を押すと当たります（答えの外で FP に知らせる）。

## 3. 読む欄

### ねんきん定期便

| 書類の欄 | 入力項目ID・場所 | 書き方 |
|---|---|---|
| ［データ作成日］ | `pensionRecord.asOf` | `"YYYY-MM"`（作成日の年月）。答えの `asOf` にも同じ年月。記録はデータ作成日の前々月までです |
| 加入月数（上の 2） | `pensionRecord.months` `["basic"]` | 月数の整数。確かさ `medium`（はがき・封書とも） |
| 厚生年金保険 計 | `pensionRecord.months` `["employee"]` | 月数の整数（一般厚生年金・公務員厚生年金・私学共済厚生年金の合計） |
| 受給資格期間（ａ＋ｂ＋ｃ＋ｄ） | `pensionRecord.months` `["qualifying"]` | 月数の整数 |
| 免除・猶予の内訳（封書だけ。上の 2） | `pensionRecord.months` `["category1", …]` | 月数の整数 |
| 50歳未満: 「３．これまでの加入実績に応じた年金額（年額）」の（２）老齢厚生年金 | `pensionRecord.amounts` `["employee"]` | 一般厚生年金期間・公務員厚生年金期間・私学共済厚生年金期間の額の合計。円の整数・`"period": "annual"`。一般厚生年金期間には厚生年金基金の代行部分が、公務員・私学の期間には経過的職域加算額（共済年金）が入っています（そのまま足す） |
| 50歳未満: 同じ欄の（１）老齢基礎年金 | 照合だけの値 | `references` に `{"label": "老齢基礎年金（加入実績に応じた額）", …}`。アプリは加入月数から計算するので入力にしない（付加年金の額も入っている） |
| 50歳未満: （１）と（２）の合計（表の「これまでの加入実績に応じた年金額（今年）」と同じ額） | 照合だけの値 | `{"label": "加入実績に応じた年金額の合計（今年）", …}` |
| 50歳以上: 見込額の表の65歳からの列の（１）基礎年金の老齢基礎年金 | `pensionRecord.amounts` `["basic"]` | 円の整数・年額 |
| 50歳以上: 65歳からの列の（２）厚生年金の（報酬比例部分） | `pensionRecord.amounts` `["employee"]` | 一般厚生年金期間・公務員厚生年金期間・私学共済厚生年金期間の報酬比例部分と、経過的職域加算額（共済年金）の合計。円の整数・年額。`note` に足した欄を書く |
| 50歳以上: 65歳からの列の（経過的加算部分） | 照合だけの値 | `references` に。アプリは加入月数から計算する |
| 50歳以上: 60〜64歳の列（「○歳～」）の特別支給の老齢厚生年金の（報酬比例部分） | `pensionRecord.amounts` `["special"]` | 円の整数・年額。いちばん早い受給開始年齢の列の額。列が無い・額が無ければ書かない。（定額部分）があれば照合だけの値にする |
| 50歳以上: （１）と（２）の合計 | 照合だけの値 | `{"label": "見込額の合計（65歳から）", …}` |

- 50歳以上の見込額は、60歳未満の人は今の加入を60歳まで続けたと仮定した額、60〜64歳の人はその時点までの加入に応じた額です（どちらも65歳から受け取る額）。70歳・75歳まで遅らせた場合の額は読まない（受け取り開始は FP とお客さまが決める）。
- 受給資格期間が足りない人は、見込額が「＊」で表示されます。額の候補を書かず、`note` に「見込額が＊（受給資格期間が足りない）」と書く。
- 50歳未満の老齢厚生年金には、経過的加算・従前額保障が入っていません（アプリが計算する）。50歳以上の見込額には入っていますが、経過的加算は別の欄なので、報酬比例部分だけを書けばよい。

### 年金額改定通知書（受給中）

| 書類の欄 | 入力項目ID・場所 | 書き方 |
|---|---|---|
| 通知の年月 | `pensionRecord.asOf` | `"YYYY-MM"` |
| 国民年金（基礎年金）の年金額 | `pensionRecord.amounts` `["basic"]` | 円の整数・年額 |
| 厚生年金保険の年金額 | `pensionRecord.amounts` `["employee"]` | 円の整数・年額。加給年金額・振替加算・経過的加算が分けて書いてあれば、それを除いた額にし、経過的加算は `["transitional"]` に書く。分けて書いていなければ年金額のまま書き、`note` に「加給年金・経過的加算を含むかもしれません」、確かさ `medium` |
| 支給停止額（0円でないとき） | 照合だけの値 | `references` に `{"label": "厚生年金の支給停止額", …}`。年金額の候補の確かさを `medium` にし、`note` に「支給停止額があります」 |
| 合計年金額（年額） | 照合だけの値 | `references` に |

## 4. 読まないもの

- 照会番号・公務員共済と私学共済の加入者番号・**ねんきんネットの「お客様のアクセスキー」（17桁）**・基礎年金番号・年金コード・二次元コード・音声コードの中身。
- 宛名の名前・住所・生年月日。封書の年金加入履歴の勤め先の名前と資格の年月日（生年月日が分かってしまうため。月数の計算に要るときも、答えには書かない）。
- 保険料納付額（累計額）・最近の月別状況の標準報酬月額・標準賞与額・保険料納付額（入力の欄が無い）。
- 70歳・75歳まで遅らせた場合の見込額。受け取り開始の年齢（`pensionRecord.claim`）は書類からは決めない。

## 5. 答えの見本（架空の値）

ねんきん定期便（50歳未満のはがき）:

```json
{
  "contract": "document-candidates@1",
  "docType": "pensionStatement",
  "asOf": "2026-06",
  "holder": "self",
  "values": [
    { "item": "pensionRecord.kind", "member": "holder", "value": "document", "source": { "page": 1, "where": "ねんきん定期便" }, "confidence": "high" },
    { "item": "pensionRecord.kind", "member": "holder", "value": "statementUnder50", "source": { "page": 2, "where": "３．これまでの加入実績に応じた年金額" }, "confidence": "high", "note": "年金額の欄の見出しから、50歳未満の定期便としました" },
    { "item": "pensionRecord.asOf", "member": "holder", "value": "2026-06", "source": { "page": 2, "where": "データ作成日", "text": "令和8年6月" }, "confidence": "high" },
    { "item": "pensionRecord.months", "at": ["basic"], "member": "holder", "value": 196, "source": { "page": 2, "where": "年金加入期間 合計（未納月数を除く）", "text": "196月" }, "confidence": "medium", "note": "第１号被保険者は0月なので免除の月はありません。20歳前・60歳から後の厚生年金の月があれば引いてください" },
    { "item": "pensionRecord.months", "at": ["employee"], "member": "holder", "value": 196, "source": { "page": 2, "where": "厚生年金保険 計", "text": "196月" }, "confidence": "high" },
    { "item": "pensionRecord.months", "at": ["qualifying"], "member": "holder", "value": null, "unreadable": true, "source": { "page": 2, "where": "受給資格期間（ａ＋ｂ＋ｃ＋ｄ）" }, "confidence": "low" },
    { "item": "pensionRecord.amounts", "at": ["employee"], "member": "holder", "value": 412300, "period": "annual", "source": { "page": 2, "where": "（２）老齢厚生年金 一般厚生年金期間", "text": "412,300円" }, "confidence": "high" }
  ],
  "references": [
    { "label": "老齢基礎年金（加入実績に応じた額）", "amount": 339600, "source": { "page": 2, "where": "（１）老齢基礎年金", "text": "339,600円" } },
    { "label": "加入実績に応じた年金額の合計（今年）", "amount": 751900, "source": { "page": 2, "where": "（１）と（２）の合計", "text": "751,900円" } }
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

ねんきん定期便（45歳の封書。国民年金の免除の内訳がある）:

```json
{
  "contract": "document-candidates@1",
  "docType": "pensionStatement",
  "asOf": "2026-05",
  "holder": "self",
  "values": [
    { "item": "pensionRecord.kind", "member": "holder", "value": "document", "source": { "page": 1, "where": "ねんきん定期便（封書）" }, "confidence": "high" },
    { "item": "pensionRecord.kind", "member": "holder", "value": "statementUnder50", "source": { "page": 3, "where": "３．これまでの加入実績に応じた年金額" }, "confidence": "high" },
    { "item": "pensionRecord.asOf", "member": "holder", "value": "2026-05", "source": { "page": 1, "where": "データ作成日", "text": "令和8年5月" }, "confidence": "high" },
    { "item": "pensionRecord.months", "at": ["basic"], "member": "holder", "value": 255, "source": { "page": 7, "where": "国民年金（ａ）納付済月数・厚生年金保険 計", "text": "納付済 30月 厚生年金保険 計 225月" }, "confidence": "medium", "note": "納付済30月＋厚生年金225月です。全額免除18月・学特等24月は内訳に分けました。20歳前・60歳から後の厚生年金の月があれば引いてください" },
    { "item": "pensionRecord.months", "at": ["employee"], "member": "holder", "value": 225, "source": { "page": 7, "where": "厚生年金保険 計", "text": "225月" }, "confidence": "high" },
    { "item": "pensionRecord.months", "at": ["qualifying"], "member": "holder", "value": 297, "source": { "page": 7, "where": "受給資格期間（ａ＋ｂ＋ｃ＋ｄ）", "text": "297月" }, "confidence": "high" },
    { "item": "pensionRecord.months", "at": ["category1", "paid"], "member": "holder", "value": 30, "source": { "page": 7, "where": "国民年金（ａ）納付済月数", "text": "30月" }, "confidence": "high" },
    { "item": "pensionRecord.months", "at": ["category1", "exemptFull"], "member": "holder", "value": 18, "source": { "page": 7, "where": "国民年金（ａ）全額免除月数", "text": "18月" }, "confidence": "high" },
    { "item": "pensionRecord.months", "at": ["category1", "deferred"], "member": "holder", "value": 24, "source": { "page": 7, "where": "国民年金（ａ）学特等月数", "text": "24月（うち猶予 0月）" }, "confidence": "high" },
    { "item": "pensionRecord.amounts", "at": ["employee"], "member": "holder", "value": 498200, "period": "annual", "source": { "page": 3, "where": "（２）老齢厚生年金 一般厚生年金期間", "text": "498,200円" }, "confidence": "high" }
  ],
  "references": [
    { "label": "老齢基礎年金（加入実績に応じた額）", "amount": 465300, "source": { "page": 3, "where": "（１）老齢基礎年金", "text": "465,300円" } }
  ]
}
```
