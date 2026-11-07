# 入力の欄の一覧（保険の書類から入る入力項目）

<!-- 自動生成（app/scripts/documentFields.ts。npm run gen:document-fields）。手で直さない -->

書類の候補の `values[].item`（入力項目ID）と `at`（場所）は、この一覧の組み合わせだけを書きます。値は「値の書き方」の形で、円の欄の `period` は「額の期間」に合わせます（違う期間の額は、FP が直して入れることになります）。

- 読めるのは保険証券・ご契約内容のお知らせ・設計書だけです（`docType` は `insurancePolicy`）。この一覧に無い入力項目の候補は、アプリが読みません。
- **場所**の `<ID>` は、物の中の明細（保険の保障など）の ID です。ID を知らないときは `<ID>` を除いて書きます（例: `["<ID>", "amount"]` → `"at": ["amount"]`。何本も当たれば FP が選びます）。場所が「（なし）」の欄は `at` を書きません。
- **人・物**: 「人の欄」は `member`（`holder`〔書類の名義の人〕・`self`・`spouse`・`child1`…）を書きます。「人の物の欄」（その人の保険の契約）は `member` で当たります（その人の契約が何件もあれば FP が選びます）。新しく足す契約の欄は `newObject`（`objects` の鍵）を書きます。今ある契約の ID が分かるとき（AI接続口で世帯を受け取ったとき）だけ `object` に書きます。
- **種類を決める欄**は、計算を大きく変えるので、FP が1つずつ承認します（まとめての承認に入りません）。
- 欄の名前は、入力の画面の名前です（世帯・種類によって名前が変わる欄は、いくつか並べています）。
- **時点の欄**（「年月（YYYY-MM。時点の欄）」。払込の終わり・保障の終わりのように、年月か年齢・出来事で決める欄）は、書類に印字された年月だけを `"YYYY-MM"` で書けます（決まった年月の時点として入ります）。保険の手引きでは書かない欄です（年齢で決まることが多いため）。

## insurance

| 入力項目ID | 場所 at | 欄の名前 | 値の書き方 | 額の期間 | 人・物 |
|---|---|---|---|---|---|
| `insurance.annuitant`（満期金・年金・祝金の受取人） | （なし） | 満期金・年金・祝金の受取人 | 人（self・spouse・child1…・holder） |  | 人の物の欄 |
| `insurance.beneficiaries`（死亡保険金の受取人） | （なし） | 受取人（死亡保険金） | 人（self・spouse・child1…・holder）か `ext:child`（子（世帯の外））・`ext:parent`（親（世帯の外））・`ext:sibling`（兄弟姉妹（世帯の外））・`ext:other`（その他（世帯の外）） |  | 人の物の欄 |
| `insurance.contractDate`（契約の年月） | （なし） | 契約年月 | 年月（YYYY-MM） |  | 人の物の欄 |
| `insurance.coverages`（主契約と特約の明細） | `["<ID>","amount"]` | 就業不能の月額・年金月額 | 円の整数 | 月額 | 人の物の欄 |
| `insurance.coverages`（主契約と特約の明細） | `["<ID>","amount"]` | 年金の年額 | 円の整数 | 年額 | 人の物の欄 |
| `insurance.coverages`（主契約と特約の明細） | `["<ID>","amount"]` | 死亡保険金・入院日額（1日）・満期金・金額 | 円の整数 | 1回の額・時点の額 | 人の物の欄 |
| `insurance.coverages`（主契約と特約の明細） | `["<ID>","everyYears"]` | 祝金の間隔 | 整数（年）・1〜50 |  | 人の物の欄 |
| `insurance.coverages`（主契約と特約の明細） | `["<ID>","from"]` | 受け取りの始まり | 年月（YYYY-MM。時点の欄） |  | 人の物の欄 |
| `insurance.coverages`（主契約と特約の明細） | `["<ID>","insured"]` | 被保険者 | 人（self・spouse・child1…・holder） |  | 人の物の欄 |
| `insurance.coverages`（主契約と特約の明細） | `["<ID>","maxDays"]` | 入院の1回の限度日数 | 整数（日）・1〜1095 |  | 人の物の欄 |
| `insurance.coverages`（主契約と特約の明細） | `["<ID>","minimumMonths"]` | 最低保証の月数 | 整数（か月）・0〜600 |  | 人の物の欄 |
| `insurance.coverages`（主契約と特約の明細） | `["<ID>","to"]` | 保障の終わり | 年月（YYYY-MM。時点の欄） |  | 人の物の欄 |
| `insurance.coverages`（主契約と特約の明細） | `["<ID>","waitingMonths"]` | 免責の月数 | 整数（か月）・0〜120 |  | 人の物の欄 |
| `insurance.coverages`（主契約と特約の明細） | `["<ID>","years"]` | 年金の年数 | 整数（年）・1〜100 |  | 人の物の欄 |
| `insurance.coverages`（主契約と特約の明細） | （なし） | 保障の始まり | 年月（YYYY-MM。時点の欄） |  | 人の物の欄 |
| `insurance.coverages`（主契約と特約の明細） | （なし） | 死亡保険金 | 円の整数 | 1回の額・時点の額 | 人の物の欄 |
| `insurance.coverages`（主契約と特約の明細） | （なし） | 給付の種類 | 選択肢: `death`（死亡保険金）・`incomeProtection`（収入保障（年金月額））・`incapacity`（就業不能）・`highDisability`（高度障害）・`maturity`（満期金）・`annuity`（年金）・`survival`（祝金）・`hospitalDaily`（入院日額）・`surgery`（手術）・`cancerLump`（がん一時金）・`threeMajorLump`（三大疾病一時金（がん・心疾患・脳卒中））・`other`（その他（計算に入りません）） |  | 人の物の欄 |
| `insurance.deductionCategory`（保険料控除の区分） | `["regime"]` | 新旧の制度 | 選択肢: `new`（新制度（2012年以後の契約））・`old`（旧制度） |  | 人の物の欄 |
| `insurance.deductionCategory`（保険料控除の区分） | `["type"]` | 保険料控除の区分 | 選択肢: `general`（一般生命保険料）・`careMedical`（介護医療保険料）・`pension`（個人年金保険料）・`earthquake`（地震保険料）・`longTermNonLife`（旧長期損害保険料）・`none`（控除の対象外） |  | 人の物の欄 |
| `insurance.insured`（被保険者） | （なし） | 被保険者 | 人（self・spouse・child1…・holder） |  | 人の物の欄 |
| `insurance.label`（名前） | （なし） | 契約の表示名 | 文字（200字まで） |  | 人の物の欄 |
| `insurance.policyholder`（契約者） | （なし） | 契約者 | 人（self・spouse・child1…・holder） |  | 人の物の欄 |
| `insurance.premium`（保険料） | `["amount"]` | 保険料（月額）・保険料（年額） | 円の整数 | 1回の額・時点の額 | 人の物の欄 |
| `insurance.premium`（保険料） | `["frequency"]` | 払い方 | 選択肢: `monthly`（月払い）・`annual`（年払い）・`single`（一時払い） |  | 人の物の欄 |
| `insurance.premium`（保険料） | `["payUntil"]` | 払込の終わり・保険期間の終わり | 年月（YYYY-MM。時点の欄） |  | 人の物の欄 |
| `insurance.schedule`（年次の数表） | `["rows","<ID>","surrenderValue"]` | 解約の月の解約返戻金（円） | 円の整数 | 1回の額・時点の額 | 人の物の欄 |
| `insurance.schedule`（年次の数表） | （なし） | 保障の推移の形 | 選択肢: `constant`（一定）・`decreasing`（毎年同じ額ずつ減る（終わりに0円）） |  | 人の物の欄 |
| `insurance.simple`（数表の無い契約を型） | `["account","after"]` | 払込が終わった後（種類を決める欄） | 選択肢: `wholeLife`（終身保険に移す）・`annuity`（年金で受け取る）・`surrender`（解約して受け取る） |  | 人の物の欄 |
| `insurance.simple`（数表の無い契約を型） | `["account","deathBenefit"]` | 終身保険の死亡保険金 | 円の整数 | 1回の額・時点の額 | 人の物の欄 |
| `insurance.simple`（数表の無い契約を型） | `["account","value"]` | 払込が終わった時の積立金の目安 | 円の整数 | 1回の額・時点の額 | 人の物の欄 |
| `insurance.simple`（数表の無い契約を型） | `["returnRateDuring"]` | 払込中の解約返戻率 | 率（「1.2%」のように % を付けた文字） |  | 人の物の欄 |
| `insurance.simple`（数表の無い契約を型） | `["returnRate"]` | 解約返戻率（払込の終わりの時点）・払込が終わった時の解約返戻率 | 率（「1.2%」のように % を付けた文字） |  | 人の物の欄 |
| `insurance.surrender`（解約する月） | （なし） | 解約の月 | 年月（YYYY-MM。時点の欄） |  | 人の物の欄 |
| `insurance.template`（保険の種類のひな形） | （なし） | 種類（種類を決める欄） | 選択肢: `term`（定期保険）・`decreasingTerm`（逓減定期保険）・`incomeProtection`（収入保障保険）・`wholeLife`（終身保険）・`lowSurrender`（低解約返戻金型終身保険）・`account`（アカウント型保険（利率変動型積立終身保険））・`endowment`（養老保険）・`groupTerm`（団体保険（勤務先））・`medical`（医療保険）・`cancer`（がん保険）・`threeMajor`（三大疾病保険）・`incapacity`（就業不能保険）・`care`（民間の介護保険）・`education`（学資保険）・`privateAnnuity`（個人年金保険）・`foreignCurrency`（外貨建て保険（目安））・`variable`（変額保険（目安））・`mutualAid`（共済（総合・医療））・`nonLife`（損害保険） |  | 人の物の欄 |
| `insurance.waiver`（保険料の払込免除） | （なし） | 払込免除 | 真偽（true・false） |  | 人の物の欄 |

## 新しい物の種類（`objects[].kind`）

保険の契約は、証券1通（主契約と特約で1つの契約）ごとに `objects` に1つ書き、その契約の値の候補に `newObject` でその鍵を書きます。同じ契約が世帯にもうあれば、FP が確かめの画面で「今の○○に当てる」を選びます（AI は、今ある契約の ID が分かるときだけ `object` に書き、`objects` には書きません）。

| kind | 名前 | 主な保障（`insurance.coverages` の `["amount"]`） | 保障の額の期間 |
|---|---|---|---|
| `insurance:term` | 定期保険 | 死亡保険金 | 1回の額・時点の額 |
| `insurance:decreasingTerm` | 逓減定期保険 | 死亡保険金（はじめの額） | 1回の額・時点の額 |
| `insurance:incomeProtection` | 収入保障保険 | 年金月額 | 月額 |
| `insurance:wholeLife` | 終身保険 | 死亡保険金 | 1回の額・時点の額 |
| `insurance:lowSurrender` | 低解約返戻金型終身保険 | 死亡保険金 | 1回の額・時点の額 |
| `insurance:account` | アカウント型保険（利率変動型積立終身保険） | 死亡保険金（保障の部分） | 1回の額・時点の額 |
| `insurance:endowment` | 養老保険 | 死亡保険金（＝満期金） | 1回の額・時点の額 |
| `insurance:groupTerm` | 団体保険（勤務先） | 死亡保険金 | 1回の額・時点の額 |
| `insurance:medical` | 医療保険 | 入院日額（1日） | 1回の額・時点の額 |
| `insurance:cancer` | がん保険 | がん一時金（診断給付金） | 1回の額・時点の額 |
| `insurance:threeMajor` | 三大疾病保険 | 三大疾病一時金 | 1回の額・時点の額 |
| `insurance:incapacity` | 就業不能保険 | 就業不能の月額 | 月額 |
| `insurance:care` | 民間の介護保険 | 介護の一時金 | 1回の額・時点の額 |
| `insurance:education` | 学資保険 | 満期金 | 1回の額・時点の額 |
| `insurance:privateAnnuity` | 個人年金保険 | 年金の年額 | 年額 |
| `insurance:foreignCurrency` | 外貨建て保険（目安） | 死亡保険金（円の目安） | 1回の額・時点の額 |
| `insurance:variable` | 変額保険（目安） | 死亡保険金（円の目安） | 1回の額・時点の額 |
| `insurance:mutualAid` | 共済（総合・医療） | 死亡保険金（共済金） | 1回の額・時点の額 |
| `insurance:nonLife` | 損害保険 | （保障の額を持たない。保険料だけ） |  |
