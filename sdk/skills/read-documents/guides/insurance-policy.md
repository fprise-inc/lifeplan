# 保険証券・ご契約内容のお知らせ・設計書の読み方

- `docType`: `insurancePolicy`
- 名義の人: 証券の契約者（`holder`）。被保険者が別の人なら、FP の言った続柄で書く
- 単位: 円。保険金・給付金は1回の額、収入保障・就業不能は月額、個人年金は年額、保険料は1回の額
- 何が入るか: 1通の証券（主契約と特約で1つの契約）ごとに、新しい保険の契約（`objects`）を1つ書き、名前・種類・契約者・被保険者・契約の年月・払い方・保険料・主契約の保障の額を入れます。**特約の額は照合だけの値**にします（足した契約の中に特約の行がまだ無いため。FP が画面で特約を足して入れます）
- 確かめた資料: 保険証券・設計書には国の決まった様式がありません（会社・商品・年で違います）。言葉は、アプリの保険の入力の欄と、一般的な証券の見出しの言葉に合わせています

## 1. 読む欄

| 書類の欄 | 入力項目ID・場所 | 書き方 |
|---|---|---|
| （1つの契約） | `objects` に1つ | `{"key": "c1", "kind": "insurance:<種類>"}`。主契約の種類で選ぶ（下の「保険の種類の選び方」）。定期付終身は主契約（終身保険）の種類にする |
| 保険会社名と商品名 | `insurance.label` | 文字。証券番号は入れない |
| 契約者 | `insurance.policyholder` | `"holder"`（宛名の人）か続柄の鍵 |
| 被保険者 | `insurance.insured` | 契約者と同じ名前なら `"holder"`。別の人で、FP が続柄を言っていればその鍵（`"spouse"`・`"child1"`…）、分からなければ書かず `note` に |
| 契約日・契約の年月 | `insurance.contractDate` | `"YYYY-MM"` |
| 払込方法 | `insurance.premium` `["frequency"]` | `"monthly"`（月払）・`"annual"`（年払）・`"single"`（一時払）。払い方の候補を保険料の額より先に書く |
| 保険料（1回の額。月払なら毎月の額） | `insurance.premium` `["amount"]` | 円の整数・`"period": "once"`。主契約と特約の合計（証券の「合計保険料」） |
| 主契約の保障の額（死亡保険金・入院給付金日額・がん診断給付金・年金月額・就業不能の月額・満期金・年金の年額） | `insurance.coverages` `["amount"]` | 円の整数。`period` は種類の主な保障の期間（[fields.md](../fields.md) の「新しい物の種類」の表）。医療保険は1日の額で `"once"` |
| 保険料払込免除特約がある | `insurance.waiver` | `true` |
| 保険料控除の区分（一般・介護医療・個人年金。証券に書いてあるとき） | `insurance.deductionCategory` `["type"]` | `"general"`・`"careMedical"`・`"pension"`。地震保険料は `"earthquake"`、旧長期損害保険料は `"longTermNonLife"` |
| 新旧の制度（「新」「旧」・新制度・旧制度。証券に書いてあるとき） | `insurance.deductionCategory` `["regime"]` | `"new"`・`"old"`（2012年1月以後の契約は新制度） |
| 払込が終わった時の解約返戻率（設計書。円建ての貯蓄型の契約） | `insurance.simple` `["returnRate"]` | `"98.5%"` のように % を付ける。確かさ `medium`。外貨建て・変額では書かない |
| 特約の保障（定期保険特約の死亡保険金・入院特約の日額・手術給付金・先進医療など） | 照合だけの値 | `{"label": "特約: 定期保険特約 死亡保険金", "amount": …}`。1つの特約に1つ |

- 保険期間・払込期間の終わり（「65歳まで」「終身」「2045年まで」）・更新の年は時点の欄なので書かない。更新型なら `note` に「10年ごとの更新型です」。
- **設計書の数表**（年ごとの解約返戻金・保険金額の推移）は写さない（例示の利率・為替の表で、とくに外貨建て・変額は入力にしない）。外貨建ての死亡保険金は、設計書に円換算の額があればその額を保障の額にし、確かさ `medium`、`note` に「円換算の額（為替で変わります）」。外貨の額しか無ければ書かない。
- 証券に複数の被保険者（家族型の医療保険など）があるときは、本人の分だけを主契約にし、家族の分は照合だけの値にして `note` に書く。
- 「ご契約内容のお知らせ」の契約者貸付の残高・積立金の額は照合だけの値にする。
- 「ご契約内容のお知らせ」で今ある契約の値を読むとき（新しく足さないとき）は、`objects` を書かず、値の候補に `"member": "holder"`（名義の人の契約）か、AI接続口で受け取った契約の ID を `"object"` に書く。名義の人の契約が何件もあれば、FP が当てる契約を選ぶ。FP が「新しい契約として足す」と言ったときだけ `objects` に書く。
- 生命保険料・地震保険料の控除証明書は読まない（アプリは保険の書類の答えだけを読む）。控除証明書を渡されたら、FP に「控除証明書の枚数と、入れた契約の数を比較してください。足りない契約は、保険証券で読めます」と伝える。

### 保険の種類の選び方（`objects[].kind`）

主契約の種類の名前（証券の「保険の種類」「主契約」の言葉）で選びます。

| 証券の「保険の種類」・主契約の言葉 | kind |
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
| 火災保険・地震保険 | `insurance:nonLife` |
| 団体定期保険（勤務先） | `insurance:groupTerm` |

名前から決められないときは、いちばん近い種類にし、物の確かさを `"low"`、`note` に「種類は保険の種類の名前から選びました」と書く。

## 2. 読まないもの

- 証券番号・保険証券番号・記号番号・お客さま番号・代理店のコード。
- 契約者・被保険者・受取人の名前・住所・生年月日（受取人は、FP が続柄を言ったときだけ `insurance.beneficiaries` に続柄の鍵か `"ext:child"` などで書く）。
- **告知・健康の情報**（告知の内容・特別条件〔部位不担保など〕の病名・診査の結果）。特別条件があることだけを `note` に「特別条件があります」と書くのはよい。
- 担当者の名前・電話番号。

## 3. 答えの見本（架空の値）

終身保険（定期保険特約つき）の証券:

```json
{
  "contract": "document-candidates@1",
  "docType": "insurancePolicy",
  "asOf": "2026-04",
  "holder": "self",
  "objects": [
    { "key": "c1", "kind": "insurance:wholeLife", "source": { "page": 1, "where": "主契約", "text": "終身保険（低解約返戻金特則なし）" }, "confidence": "high" }
  ],
  "values": [
    { "item": "insurance.label", "newObject": "c1", "value": "架空のさくら生命 終身保険", "source": { "page": 1, "where": "保険会社名・商品名" }, "confidence": "high" },
    { "item": "insurance.policyholder", "newObject": "c1", "value": "holder", "source": { "page": 1, "where": "契約者" }, "confidence": "high", "note": "名前は読んでいません" },
    { "item": "insurance.insured", "newObject": "c1", "value": "holder", "source": { "page": 1, "where": "被保険者" }, "confidence": "medium", "note": "契約者と同じ名前でした" },
    { "item": "insurance.contractDate", "newObject": "c1", "value": "2016-10", "source": { "page": 1, "where": "契約日", "text": "平成28年10月1日" }, "confidence": "high" },
    { "item": "insurance.premium", "at": ["frequency"], "newObject": "c1", "value": "monthly", "source": { "page": 1, "where": "払込方法", "text": "月払（口座振替）" }, "confidence": "high" },
    { "item": "insurance.premium", "at": ["amount"], "newObject": "c1", "value": 8900, "period": "once", "source": { "page": 1, "where": "合計保険料", "text": "8,900円" }, "confidence": "high" },
    { "item": "insurance.coverages", "at": ["amount"], "newObject": "c1", "value": 3000000, "period": "once", "source": { "page": 1, "where": "主契約 死亡・高度障害保険金", "text": "300万円" }, "confidence": "high" },
    { "item": "insurance.waiver", "newObject": "c1", "value": true, "source": { "page": 1, "where": "保険料払込免除特約" }, "confidence": "high" }
  ],
  "references": [
    { "label": "特約: 定期保険特約 死亡保険金", "amount": 10000000, "source": { "page": 1, "where": "定期保険特約", "text": "1,000万円（65歳まで）" } }
  ]
}
```
