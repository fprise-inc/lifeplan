# 差し込み口と、差し替えてよい公式部品

計算エンジンの計算を変える道は2つあります（設計記録 0006 の3・0119）。

- **追加**（`extend`）: 差し込み口に計算を足す。例: 支出の行を足す `slot.expense.flow`。
- **差し替え**（`replace`）: 公式の計算部品の1つを、自分の計算に置き換える。差し替えられるのは、下の表の「差し替えてよい公式部品」だけです。

> **今のアプリは、カスタム層の `modules/` に置いた束をまだ読み込みません**（0114 の段1）。束の読み込み・承認・隔離実行は β公開の後に入ります。下の一覧と約束は、そのときも同じ形で使えるように β公開の前に決めたものです。

## 先に: 差し替えなくてよい場合

差し替えは「計算の仕方」を変えるときに使います。値だけを変えたいときは、差し替えは要りません。

| 変えたいもの | 使うもの |
|---|---|
| 推定の元の統計・目安の値（教育費の平均、介護の月額の目安、昇給カーブなど） | 事務所の既定値の画面の「推定の値」（0111） |
| 物価上昇率・運用利回り・賃金上昇率など（年ごとに変えてもよい） | 前提条件 |
| その世帯だけの値（ねんきん定期便の見込額、返済額、手取りなど） | 入力（置き換え口のある欄は、その値をそのまま使います） |
| 支出の行を足したい | 差し込み口 `slot.expense.flow`（追加） |
| 提案書に章を足したい | 拡張の束の `report.chapter`（`extensions.md`） |

## 差し込み口

| 差し込み口 | 中身 | 今 |
|---|---|---|
| `slot.expense.flow` | 支出の行を足す（`cf.expense` の下と、その下の `ext.<作成者>.<キー>` の行だけ） | 開く予定 |
| `slot.protection.method` | 必要保障額の考え方 | 開く予定（中身は検討中。下の `protection.need` の差し替えでも同じことができます） |
| `slot.retirement.rules` | 退職給付の規程 | 開く予定（中身は検討中。下の `retirement.benefit` の差し替えでも同じことができます） |
| `slot.income.flow`・`slot.lumpSum`・`slot.account`・`slot.insurance.table`・`slot.withdrawal.order` | 収入・一時金・資産の器・保険の数表・取り崩しの順序 | 後の版で開く |

## 差し替えてよい公式部品

推定・目安、FP の考え方、事務所・勤め先の決まりで結果が決まる部品だけです。

| 部品 | 名前 | 約束の版 | 入力・出力のスキーマ | 向いている使い方 |
|---|---|---|---|---|
| `expense.living` | 生活費 | 1.0 | `empty.input`・`flows.output` | 段階（子の独立・退職後・年代ごと）や万一の後の割合を、事務所の考え方で付ける |
| `education.cost` | 教育費 | 1.1 | `member.input`・`education.cost.output` | 進路の見込み・在学年数・平均の取り方を事務所の考え方にする（公的支援は公式のまま） |
| `housing.valuation` | 持ち家の評価額と売却 | 1.1 | `empty.input`・`housing.valuation.output` | 土地・建物の評価の下がり方を事務所の考え方にする |
| `asset.car` | 車の評価額 | 1.0 | `empty.input`・`asset.car.output` | 車の評価の下がり方を変える |
| `contingency.lumpSum` | 万一のときの一時のお金 | 1.0 | `empty.input`・`flows.output` | 整理資金の見込み方を変える（相続税は計算しない部品です） |
| `protection.need` | 必要保障額の推移 | 1.1 | `protection.need.input`・`protection.need.output` | 必要保障額の数え方（遺族の生活費の割合・期間・数える費用）を事務所の考え方にする。遺族年金などは公式の部品を呼べます |
| `retirement.benefit` | 退職給付 | 1.0 | `member.input`・`retirement.benefit.output` | 勤め先の退職金規程を写した計算にする（退職所得の税は公式のまま） |
| `expense.advisoryFee` | FP顧問料 | 1.0 | `empty.input`・`flows.output` | 料金表の形で入らない料金の決め方（資産の額に応じた料金など） |

この一覧は、登録簿 `registry/components.yaml` で `replaceable: true` の付いた部品と同じです。

## 差し替えられない公式部品

| 部品 | 理由 |
|---|---|
| `incomeTax.annual`・`residentTax.annual`・`residentTax.exemption`・`tax.deductions`・`tax.dependentDeduction`・`tax.spouseDeduction`・`tax.employmentIncome`・`tax.publicPensionIncome`・`tax.retirementIncome`・`tax.realEstateSale`・`tax.lossCarryforward`・`tax.housingLoanCredit`・`tax.housingLoanCreditYears`・`tax.socialInsurancePaid`・`tax.totalIncome`・`tax.incomeOrder`・`tax.incomeWithin`・`tax.survivorStatus`・`insurance.income`・`gift.tax`・`inheritance.estimate`・`asset.realEstate`・`asset.heldSale` | 法律で決まる税の計算（不動産は減価償却と不動産所得の計算が中心） |
| `socialInsurance.coverage`・`socialInsurance.employeeStatus`・`socialInsurance.healthStatus`・`socialInsurance.health`・`socialInsurance.pension`・`socialInsurance.employment`・`socialInsurance.nationalHealth`・`socialInsurance.nationalPension`・`socialInsurance.continuation`・`socialInsurance.lateElderly`・`socialInsurance.careFirst` | 法律で決まる社会保険の資格と保険料 |
| `pension.record`・`pension.category`・`pension.employeeMonths`・`pension.revision`・`pension.oldAgeBase`・`pension.oldAge`・`pension.survivorRight`・`pension.survivor`・`pension.disability`・`pension.supplementaryBenefit` | 法律で決まる公的年金 |
| `benefit.childAllowance`・`benefit.employment`・`benefit.unemployment`・`benefit.health`・`medical.highCost`・`care.expense`・`education.support`・`education.nurseryFee`・`ideco.contribution`・`account.ideco`・`account.idecoPayout`・`account.mutualAid` | 法律で決まる公的な給付・自己負担・支援・保育料と、iDeCo・企業型DC・小規模企業共済の決まり |
| `income.salary`・`income.business`・`income.flows`・`expense.periodic`・`expense.car`・`housing.residence`・`debt.schedule`・`debt.creditLifeEvents`・`insurance.policy`・`insurance.premiumPayment`・`insurance.term`・`account.contribution` | 入力・契約のとおりに並べる部品。違う結果は入力・前提・事務所の推定の値で作る |
| `plan.cashflow`・`plan.flows`・`plan.memberFlows`・`retirement.receipts`・`gift.received`・`account.dcList`・`contingency.event`・`outside.wallet`・`expense.reconcile`・`asset.realEstateAnalysis` | 集める・組み立てる・判定する部品。替えるとキャッシュフロー表の作りが変わる |

税・社会保険・年金の計算に誤りを見つけたときは、差し替えではなく公式への報告で直してください。

## 差し替えの約束

### マニフェスト（`manifest.json`）

```json
{
  "manifestVersion": "1.0",
  "id": "ext.myOffice.protection",
  "name": "必要保障額（事務所の数え方）",
  "version": "1.0.0",
  "author": "（作成者の表示名）",
  "license": "MIT",
  "kind": "component",
  "entry": "index.ts",
  "provides": [
    { "type": "replace", "target": "protection.need", "contract": "1", "basedOn": 5 }
  ]
}
```

- `target` は上の表の部品の ID、`contract` は約束の版の MAJOR（`"1"`）です。
- `basedOn` は、差し替えを作ったときに見た公式部品の改訂（`revision`）です。公式部品が新しくなったとき、アプリが「差し替えている公式の部品が新しくなった」と知らせるのに使います。
- 1つの公式部品に有効な差し替えは1つだけです。

### 部品（`defineComponent`）

```ts
import { defineComponent, formatYm, yen } from "@lifeplan/sdk";

export default defineComponent({
  id: "expense.living",            // 差し替える公式部品と同じ ID
  contract: "1.0",                 // 公式と同じ MAJOR。MINOR は公式以下
  revision: 1,                     // この部品自身の改訂（1から）
  requires: { "contingency.event": ">=1 <2" },
  params: [],
  reads: ["livingExpense.monthly", "livingExpense.from", "livingExpense.to", "assumptions.inflation"],
  input: "empty.input",            // 公式と同じスキーマのキー
  output: "flows.output",          // 公式と同じスキーマのキー
  compute(_input, ctx) {
    // … 事務所の考え方で毎月の生活費を出す
    return { flows: [{ row: "cf.expense.living", ym: formatYm(ctx.time.base), amount: yen(0), accrualYear: 2026, formula: "ext.myOffice.living.monthly" }] };
  },
});
```

守ること（守らない差し替えは、アプリが計算の前に拒みます。黙って公式の計算に戻すことはしません）:

- **ID・入力・出力**: `id` は差し替える公式部品と同じ。`input`・`output` は公式部品と同じスキーマのキー（入出力の形は変えられません）。出力は毎回スキーマで検査されます。
- **約束の版**: `contract` は公式と同じ MAJOR で、MINOR は公式以下。MINOR が公式より古い差し替えは使えます。公式の MAJOR が上がると、その差し替えを使う案は計算を止め、「差し替えを直す／公式に戻す」を選ぶまで計算しません（`changes/` に移行の手順が載ります）。
- **計算式ID**: 出すお金の動き・年ごとの行の `formula` は `ext.<作成者>.` で始めます。公式部品が返した行をそのまま返すことはできません。
- **読むもの**: `reads`・`params`・`requires` に書いたものだけを読めます（公式部品と同じでなくてよい）。差し込み口（`slots`）は、公式部品が呼ぶものの内だけ。`replaceable` は書きません（公式部品だけが持つ印です）。
- そのほかの決まり（時計・乱数・`Math.pow` を使わない、金額は `ctx` の関数で計算する、読み込めるのは束の中の相対パスと `@lifeplan/sdk` だけ）は、ほかの計算部品と同じです（`extensions.md` の「計算部品の決まり」）。

## 公式の計算と違うことの見せ方

差し替えた計算で作った結果には、公式の計算と違うことが必ず残ります。FP が消すことはできません。

- **計算の結果の見出し**: 部品表に、差し替えた部品が `origin: "replacement"` と指紋で残ります。
- **根拠の表示**: 計算式ID が `ext.` で始まる行は「事務所の計算」と出ます。
- **FP 向けの画面**: 案の一覧の名前の横の小さな印と、結果のタブの計算のお知らせの1行（差し替えた公式部品の名前と束の名前）。そこから「公式の計算と比べる」で、同じ案を公式の計算で計算した結果と並べて見られます。
- **控え・PDF の内部情報**: 差し替えた部品・束の版・指紋が残ります。
- 顧客が見る面（提案書の印刷される面・提示層）には、「標準の計算と違う」「事務所の計算」とは出ません。差し替えるのは FP の考え方の部品なので、顧客への説明は FP が行います。上の4つ（見出し・根拠・FP 向けの画面・控え）には必ず残ります。

## 公式の更新への追従

- 公式部品の改訂（`revision`）が上がっても、差し替えはそのまま使われます。アプリが知らせるので、`changes/` を読み、公式の計算と比べて、必要なら差し替えを直してください。
- 公式部品の約束の版の MINOR が上がっても、そのまま使えます（足された欄は任意です）。
- MAJOR が上がったら、差し替えを直すまで、その差し替えを使う案は計算されません。
