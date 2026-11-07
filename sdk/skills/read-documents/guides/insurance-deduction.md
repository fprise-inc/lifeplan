# 保険料控除証明書（生命保険料・地震保険料）の読み方

- `docType`: 生命保険料控除証明書は `lifeInsuranceDeduction`、地震保険料控除証明書は `earthquakeInsuranceDeduction`
- 名義の人: 証明書の宛名の人（ふつうは契約者。`holder`）
- 単位: 円。証明書の「証明額」「申告額」は**その年の払込の合計（年額）**で、1回の保険料ではありません
- 何が入るか: 証明書の**1件の契約ごとに、新しい保険の契約**（`objects`）を1つ書き、その中に名前・種類・契約の年月・控除の区分・払い方を入れます。保障の額は証明書に無いので書きません（FP が保険証券で入れます）
- 確かめた資料: 国税庁「控除申告書データに係る仕様」の構造XML定義書・その補足（年末調整の申告書のデータに入る控除証明書の項目: 保険会社等の名称・保険の種類・保険期間・契約者・被保険者・受取人・新旧の区分・区分ごとの額など）。紙の証明書の書式は保険会社ごとに違います
- マイナポータルからダウンロードした控除証明書の XML は、アプリの中で読む部品で読みます（AI に渡さなくてよい）。紙・PDF の証明書を読むときに、この手引きを使います

## 1. 読む欄

| 書類の欄 | 入力項目ID・場所 | 書き方 |
|---|---|---|
| （1件の契約） | `objects` に1つ | `{"key": "c1", "kind": "insurance:<種類>"}`。種類は保険の種類の名前から下の表で選ぶ |
| 保険会社名と保険の種類（商品名） | `insurance.label` | 文字。例「架空のあおば生命 医療保険」。証券番号は入れない |
| 保険料控除の区分（一般・介護医療・個人年金） | `insurance.deductionCategory` `["type"]` | `"general"`・`"careMedical"`・`"pension"`。地震保険料は `"earthquake"`、旧長期損害保険料は `"longTermNonLife"` |
| 新旧の制度（「新」「旧」・新制度・旧制度） | `insurance.deductionCategory` `["regime"]` | `"new"`・`"old"`（地震保険料控除証明書には無い） |
| 契約日（契約年月日） | `insurance.contractDate` | `"YYYY-MM"`（日は書かない） |
| 払込方法（月払・年払・一時払） | `insurance.premium`（`at` なし） | `"monthly"`・`"annual"`・`"single"`。半年払いは書かず `note` に |
| 1回の保険料（「月払保険料」などとして印字されているとき） | `insurance.premium` `["amount"]` | 円の整数・`"period": "once"`。払込方法の候補より後に書く |
| 契約者 | `insurance.policyholder` | 宛名の人なら `"holder"`。名前は書かない |
| 被保険者 | `insurance.insured` | 契約者と同じ名前なら `"holder"`。違えば書かず、`note` に「被保険者は契約者と違う方です」 |
| 証明額（申告日の時点の払込額）・申告額（12月までの払込見込みの額） | 照合だけの値 | `label` は「一般生命保険料の申告額（新制度）」のように区分と新旧を入れる。契約ごとに1つ |

- 証明書の額（年額）を12で割って1回の保険料にしない。1回の保険料が印字されていなければ、保険料の値の候補は書かない（FP が保険証券で入れます）。
- 保険期間・払込期間（「終身」「2045年まで」など）は時点の欄なので書かない。必要なら `note` に。
- 1通の証明書に何件も契約があれば、`objects` を件数分（`c1`・`c2`…）書く。同じ契約がもう世帯にあれば、アプリが「同じ契約が、もうあるかもしれません」と知らせます（AI は気にしなくてよい）。

### 保険の種類の選び方（`objects[].kind`）

| 証明書の「保険の種類」の言葉 | kind |
|---|---|
| 終身保険・終身保険（低解約返戻金型） | `insurance:wholeLife`・`insurance:lowSurrender` |
| 定期保険・定期付終身の定期部分 | `insurance:term` |
| 収入保障保険・家族収入保険 | `insurance:incomeProtection` |
| 養老保険 | `insurance:endowment` |
| 医療保険・入院保険 | `insurance:medical` |
| がん保険 | `insurance:cancer` |
| 三大疾病保険・特定疾病保障保険 | `insurance:threeMajor` |
| 就業不能保険・所得補償保険 | `insurance:incapacity` |
| 介護保険（民間） | `insurance:care` |
| 学資保険・こども保険 | `insurance:education` |
| 個人年金保険 | `insurance:privateAnnuity` |
| 変額保険・変額個人年金 | `insurance:variable` |
| 外貨建て保険 | `insurance:foreignCurrency` |
| 共済（総合・医療） | `insurance:mutualAid` |
| 火災保険・地震保険（地震保険料控除証明書） | `insurance:nonLife` |
| 団体定期保険（勤務先） | `insurance:groupTerm` |

名前から決められないときは、いちばん近い種類にし、物の確かさを `"low"`、`note` に「種類は保険の種類の名前から選びました」と書く。

## 2. 読まないもの

- 証券番号・保険証券番号・被保険者番号・お客さま番号・契約者番号。
- 契約者・被保険者・年金受取人の名前・住所。
- 証明書の中の健康の情報（告知など）。

## 3. 答えの見本（架空の値）

生命保険料控除証明書（2件の契約）:

```json
{
  "contract": "document-candidates@1",
  "docType": "lifeInsuranceDeduction",
  "asOf": "2025-10",
  "holder": "self",
  "objects": [
    { "key": "c1", "kind": "insurance:medical", "source": { "page": 1, "where": "保険の種類", "text": "医療保険（無配当）" }, "confidence": "high" },
    { "key": "c2", "kind": "insurance:privateAnnuity", "source": { "page": 2, "where": "保険の種類", "text": "個人年金保険" }, "confidence": "high" }
  ],
  "values": [
    { "item": "insurance.label", "newObject": "c1", "value": "架空のあおば生命 医療保険", "source": { "page": 1, "where": "保険会社名・保険の種類" }, "confidence": "high" },
    { "item": "insurance.deductionCategory", "at": ["type"], "newObject": "c1", "value": "careMedical", "source": { "page": 1, "where": "介護医療保険料" }, "confidence": "high" },
    { "item": "insurance.deductionCategory", "at": ["regime"], "newObject": "c1", "value": "new", "source": { "page": 1, "where": "新制度" }, "confidence": "high" },
    { "item": "insurance.contractDate", "newObject": "c1", "value": "2019-07", "source": { "page": 1, "where": "契約日", "text": "令和元年7月1日" }, "confidence": "high" },
    { "item": "insurance.premium", "newObject": "c1", "value": "monthly", "source": { "page": 1, "where": "払込方法", "text": "月払" }, "confidence": "high" },
    { "item": "insurance.premium", "at": ["amount"], "newObject": "c1", "value": 3240, "period": "once", "source": { "page": 1, "where": "月払保険料", "text": "3,240円" }, "confidence": "high" },
    { "item": "insurance.policyholder", "newObject": "c1", "value": "holder", "source": { "page": 1, "where": "契約者" }, "confidence": "high", "note": "名前は読んでいません。宛名の方としています" },
    { "item": "insurance.insured", "newObject": "c1", "value": "holder", "source": { "page": 1, "where": "被保険者" }, "confidence": "medium", "note": "契約者と同じ名前でした" },
    { "item": "insurance.label", "newObject": "c2", "value": "架空のみなと生命 個人年金保険", "source": { "page": 2, "where": "保険会社名・保険の種類" }, "confidence": "high" },
    { "item": "insurance.deductionCategory", "at": ["type"], "newObject": "c2", "value": "pension", "source": { "page": 2, "where": "個人年金保険料" }, "confidence": "high" },
    { "item": "insurance.deductionCategory", "at": ["regime"], "newObject": "c2", "value": "new", "source": { "page": 2, "where": "新制度" }, "confidence": "high" },
    { "item": "insurance.contractDate", "newObject": "c2", "value": "2015-04", "source": { "page": 2, "where": "契約日", "text": "平成27年4月1日" }, "confidence": "high" },
    { "item": "insurance.premium", "newObject": "c2", "value": "monthly", "source": { "page": 2, "where": "払込方法", "text": "月払" }, "confidence": "high" },
    { "item": "insurance.premium", "at": ["amount"], "newObject": "c2", "value": null, "unreadable": true, "source": { "page": 2, "where": "月払保険料" }, "confidence": "low" }
  ],
  "references": [
    { "label": "介護医療保険料の申告額（新制度）", "amount": 38880, "source": { "page": 1, "where": "申告額（12月まで）", "text": "38,880円" } },
    { "label": "個人年金保険料の申告額（新制度）", "amount": 120000, "source": { "page": 2, "where": "申告額（12月まで）", "text": "120,000円" } }
  ]
}
```
