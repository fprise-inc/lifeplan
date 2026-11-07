# 入力の欄の一覧（書類から入る入力項目）

<!-- 自動生成（app/scripts/documentFields.ts。npm run gen:document-fields）。手で直さない -->

書類の候補の `values[].item`（入力項目ID）と `at`（場所）は、この一覧の組み合わせだけを書きます。値は「値の書き方」の形で、円の欄の `period` は「額の期間」に合わせます（違う期間の額は、FP が直して入れることになります）。

- **場所**の `<ID>` は、物の中の明細（保険の保障・ローンの金利の段階など）の ID です。ID を知らないときは `<ID>` を除いて書きます（例: `["<ID>", "amount"]` → `"at": ["amount"]`。何本も当たれば FP が選びます）。場所が「（なし）」の欄は `at` を書きません。
- **人・物**: 「人の欄」は `member`（`holder`〔書類の名義の人〕・`self`・`spouse`・`child1`…）を書きます。「人の物の欄」（その人の働き方・年金の記録・保険の契約など）は `member` で当たります（今の働き方の期間が先）。新しく足す物（保険の契約）の欄は `newObject`（`objects` の鍵）を書きます。「物の欄」（ローンなど）は `object`（今ある物の ID。AI接続口で世帯を受け取ったときだけ）を書き、分からなければ書きません（FP が当てる物を選びます）。
- **種類を決める欄**は、計算を大きく変えるので、FP が1つずつ承認します（まとめての承認に入りません）。
- 欄の名前は、入力の画面の名前です（世帯・種類によって名前が変わる欄は、いくつか並べています）。
- **時点の欄**（「年月（YYYY-MM。時点の欄）」。借りた年月・払込の終わりのように、年月か年齢・出来事で決める欄）は、書類に印字された年月だけを `"YYYY-MM"` で書きます（決まった年月の時点として入ります）。年齢・出来事で決める入れ方は、FP が欄で直します。

## account

| 入力項目ID | 場所 at | 欄の名前 | 値の書き方 | 額の期間 | 人・物 |
|---|---|---|---|---|---|
| `account.contributions`（積立・掛金） | （なし） | 毎月の積立 | 円の整数 | 月額 | 人の物の欄 |
| `account.contributions`（積立・掛金） | （なし） | 積立の終わり | 年月（YYYY-MM。時点の欄） |  | 人の物の欄 |
| `account.contributions`（積立・掛金） | （なし） | 積立をやめる年齢（ご本人）・積立をやめる年齢 | 整数（歳）・20〜90 |  | 世帯の欄 |
| `account.enrolledSince`（iDeCo・企業型DC の加入者等期間の始まり） | （なし） | 加入した年月 | 年月（YYYY-MM） |  | 人の物の欄 |
| `account.owner`（名義の構成員） | （なし） | 名義 | 人（self・spouse・child1…・holder） |  | 人の物の欄 |

## debt

| 入力項目ID | 場所 at | 欄の名前 | 値の書き方 | 額の期間 | 人・物 |
|---|---|---|---|---|---|
| `debt.balanceAsOf`（残高の時点） | （なし） | 残高の時点 | 年月（YYYY-MM） |  | 物の欄 |
| `debt.balance`（残高） | （なし） | 今の残高 | 円の整数 | 1回の額・時点の額 | 物の欄 |
| `debt.creditLife`（団体信用生命保険） | `["ratio"]` | 保障割合 | 率（「1.2%」のように % を付けた文字） |  | 物の欄 |
| `debt.creditLife`（団体信用生命保険） | （なし） | 団体信用生命保険（団信）の対象 | 人（self・spouse・child1…・holder） |  | 物の欄 |
| `debt.creditLife`（団体信用生命保険） | （なし） | 疾病の特約 | 選択肢: `cancer`（がんの特約）・`threeMajor`（3大疾病の特約）・`eightMajor`（8大疾病の特約） |  | 物の欄 |
| `debt.creditLife`（団体信用生命保険） | （なし） | 高度障害も対象・就業不能の特約・夫婦連生 | 真偽（true・false） |  | 物の欄 |
| `debt.debtors`（債務者） | （なし） | ご本人の負担割合（連帯債務） | 率（「1.2%」のように % を付けた文字） |  | 物の欄 |
| `debt.debtors`（債務者） | （なし） | ローンの名義（種類を決める欄） | 選択肢: `self`（ご本人）・`spouse`（配偶者）・`joint`（夫婦で連帯債務（1本を2人で））・`guarantor`（収入合算（配偶者が連帯保証人）） |  | 物の欄 |
| `debt.housing`（住宅ローン控除に使う住宅の情報） | `["acquisitionCost"]` | 取得対価（控除） | 円の整数 | 1回の額・時点の額 | 物の欄 |
| `debt.housing`（住宅ローン控除に使う住宅の情報） | `["childRearing"]` | 子育て世帯・若者夫婦世帯の上乗せ（控除） | 選択肢: `auto`（自動（家族から判定））・`yes`（対象）・`no`（対象外） |  | 物の欄 |
| `debt.housing`（住宅ローン控除に使う住宅の情報） | `["creditDisabled"]` | 住宅ローン控除を受ける | 真偽（true・false） |  | 物の欄 |
| `debt.housing`（住宅ローン控除に使う住宅の情報） | `["moveIn"]` | 入居の年月（控除） | 年月（YYYY-MM） |  | 物の欄 |
| `debt.housing`（住宅ローン控除に使う住宅の情報） | `["newBuild"]` | 新築か中古か（控除） | 選択肢: `new`（新築・買取再販）・`used`（中古） |  | 物の欄 |
| `debt.housing`（住宅ローン控除に使う住宅の情報） | `["propertyType"]` | 住宅の種類（控除） | 選択肢: `certified`（長期優良住宅・低炭素住宅（認定住宅））・`zeh`（ZEH水準省エネ住宅）・`energySaving`（省エネ基準適合住宅）・`other`（その他の住宅（一般の住宅）） |  | 物の欄 |
| `debt.housing`（住宅ローン控除に使う住宅の情報） | （なし） | 入居の年月（控除） | 年月（YYYY-MM） |  | 物の欄 |
| `debt.label`（名前） | （なし） | 借入先・名前 | 文字（200字まで） |  | 物の欄 |
| `debt.prepayments`（繰上返済） | `["<ID>","amount"]` | 額 | 円の整数 | 1回の額・時点の額 | 物の欄 |
| `debt.prepayments`（繰上返済） | （なし） | 年月 | 年月（YYYY-MM。時点の欄） |  | 物の欄 |
| `debt.prepayments`（繰上返済） | （なし） | 方法 | 選択肢: `shortenTerm`（期間短縮型）・`reducePayment`（返済額軽減型） |  | 物の欄 |
| `debt.principal`（借入額） | （なし） | 借入額 | 円の整数 | 1回の額・時点の額 | 物の欄 |
| `debt.product`（商品） | （なし） | 商品 | 選択肢: `bank`（銀行などの住宅ローン）・`flat35`（フラット35（全期間固定）） |  | 物の欄 |
| `debt.rateSchedule`（金利の段階） | `["<ID>","rate"]` | 金利（当初・年）・金利（年） | 率（「1.2%」のように % を付けた文字） |  | 物の欄 |
| `debt.rateSchedule`（金利の段階） | （なし） | この金利になる年月 | 年月（YYYY-MM。時点の欄） |  | 物の欄 |
| `debt.rateSchedule`（金利の段階） | （なし） | 当初の金利の引き下げ（期間）（種類を決める欄） | 選択肢: `0`（なし）・`60`（5年）・`120`（10年） |  | 物の欄 |
| `debt.rateSchedule`（金利の段階） | （なし） | 金利の種類 | 選択肢: `variable`（変動金利）・`fixedPeriod`（固定期間選択型）・`fixed`（全期間固定） |  | 物の欄 |
| `debt.rateSchedule`（金利の段階） | （なし） | 金利の見込み（変動金利）（種類を決める欄） | 選択肢: `flat`（今の金利のまま）・`up1`（10年で1%上がる（5年後に＋0.5%・10年後に＋1%））・`up2`（10年で2%上がる（5年後に＋1%・10年後に＋2%））・`custom`（金利の段階で入れる） |  | 物の欄 |
| `debt.refinance`（借り換え） | （なし） | 借り換えの年月 | 年月（YYYY-MM。時点の欄） |  | 物の欄 |
| `debt.repayment`（返済の方法） | `["bonusShare"]` | ボーナス返済の割合 | 率（「1.2%」のように % を付けた文字） |  | 物の欄 |
| `debt.repayment`（返済の方法） | `["termMonths"]` | 完済の年月 | 年月（YYYY-MM） |  | 物の欄 |
| `debt.repayment`（返済の方法） | `["termMonths"]` | 返済期間 | 整数（年）・1〜50 |  | 物の欄 |
| `debt.repayment`（返済の方法） | （なし） | 5年ルール・125%ルール | 真偽（true・false） |  | 物の欄 |
| `debt.repayment`（返済の方法） | （なし） | 毎月の返済額 | 円の整数 | 月額 | 物の欄 |
| `debt.repayment`（返済の方法） | （なし） | 返済方法 | 選択肢: `equalPayment`（元利均等）・`equalPrincipal`（元金均等） |  | 物の欄 |
| `debt.start`（借入の月） | （なし） | 借入の年月・借りた年月（入居の年月） | 年月（YYYY-MM。時点の欄） |  | 物の欄 |
| `debt.subtype`（ローンの種類の細目） | （なし） | 種類（種類を決める欄） | 選択肢: `cardLoan`（カードローン・リボ）・`scholarship`（奨学金の返済（第二種・有利子））・`scholarshipFree`（奨学金の返済（第一種・無利子））・`renovation`（リフォームローン）・`policyLoan`（契約者貸付（保険））・`personal`（親・知人からの借入）・`other`（その他のローン） |  | 物の欄 |

## employment

| 入力項目ID | 場所 at | 欄の名前 | 値の書き方 | 額の期間 | 人・物 |
|---|---|---|---|---|---|
| `employment.business.income`（事業所得） | （なし） | 事業所得（年額） | 円の整数 | 年額 | 人の物の欄 |
| `employment.salary.annual`（給与） | （なし） | 年収（税込み・賞与を除く） | 円の整数 | 年額 | 人の物の欄 |
| `employment.salary.bonus`（賞与） | （なし） | 賞与（年間の合計） | 円の整数 | 年額 | 人の物の欄 |
| `employment.standardMonthlyRemuneration`（置き換え口: 標準報酬月額） | `["health"]` | 標準報酬月額（健康保険） | 円の整数 | 月額 | 人の物の欄 |
| `employment.standardMonthlyRemuneration`（置き換え口: 標準報酬月額） | `["pension"]` | 標準報酬月額（厚生年金） | 円の整数 | 月額 | 人の物の欄 |

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

## member

| 入力項目ID | 場所 at | 欄の名前 | 値の書き方 | 額の期間 | 人・物 |
|---|---|---|---|---|---|
| `member.taxReturn`（所得税の申告の仕方） | `["blueDeduction"]` | 青色申告特別控除 | 選択肢: `electronic`（65万円）・`doubleEntry`（55万円）・`simple`（10万円） |  | 人の欄 |
| `member.taxReturn`（所得税の申告の仕方） | `["method"]` | 申告の仕方（種類を決める欄） | 選択肢: `white`（白色）・`blue`（青色） |  | 人の欄 |

## pensionRecord

| 入力項目ID | 場所 at | 欄の名前 | 値の書き方 | 額の期間 | 人・物 |
|---|---|---|---|---|---|
| `pensionRecord.amounts`（置き換え口: 記録の年金額） | `["basic"]` | 老齢基礎年金（65歳からの見込額）・老齢基礎年金（今の年額）・老齢基礎年金（見込額） | 円の整数 | 年額 | 人の物の欄 |
| `pensionRecord.amounts`（置き換え口: 記録の年金額） | `["employee"]` | 老齢厚生年金（これまでの加入実績に応じた額）・老齢厚生年金（65歳からの見込額）・老齢厚生年金（今の年額・報酬比例部分）・老齢厚生年金（見込額） | 円の整数 | 年額 | 人の物の欄 |
| `pensionRecord.amounts`（置き換え口: 記録の年金額） | `["special"]` | 特別支給の老齢厚生年金（報酬比例部分） | 円の整数 | 年額 | 人の物の欄 |
| `pensionRecord.amounts`（置き換え口: 記録の年金額） | `["transitional"]` | 経過的加算 | 円の整数 | 年額 | 人の物の欄 |
| `pensionRecord.asOf`（記録の時点） | （なし） | 書類の作成年月 | 年月（YYYY-MM） |  | 人の物の欄 |
| `pensionRecord.claim`（受給を始める月） | `["basic"]` | 老齢基礎年金の受け取り開始 | 整数（歳から）・60〜75 |  | 人の欄 |
| `pensionRecord.claim`（受給を始める月） | `["employee"]` | 老齢厚生年金の受け取り開始 | 整数（歳から）・60〜75 |  | 人の欄 |
| `pensionRecord.claim`（受給を始める月） | （なし） | 受け取り開始（基礎・厚生とも）・老齢基礎年金の受け取り開始・老齢厚生年金の受け取り開始 | 整数（歳から）・60〜75 |  | 人の欄・人の物の欄 |
| `pensionRecord.kind`（記録の型） | （なし） | 年金の入れ方（種類を決める欄） | 選択肢: `document`（書類から）・`history`（加入歴から） |  | 人の欄 |
| `pensionRecord.kind`（記録の型） | （なし） | 書類の種類（種類を決める欄） | 選択肢: `statementUnder50`（ねんきん定期便（50歳未満））・`statementOver50`（ねんきん定期便（50歳以上））・`receiving`（年金額改定通知書（受給中））・`projection`（ねんきんネットの見込額・見込額だけ） |  | 人の欄 |
| `pensionRecord.months`（加入期間の月数） | `["basic"]` | 国民年金の加入月数 | 整数（か月）・0〜600 |  | 人の物の欄 |
| `pensionRecord.months`（加入期間の月数） | `["category1","deferred"]` | 納付猶予・学生納付特例の月数（追納していない分） | 整数（か月）・0〜480 |  | 人の物の欄 |
| `pensionRecord.months`（加入期間の月数） | `["category1","exemptFull"]` | 全額免除の月数 | 整数（か月）・0〜480 |  | 人の物の欄 |
| `pensionRecord.months`（加入期間の月数） | `["category1","exemptHalf"]` | 半額免除の月数 | 整数（か月）・0〜480 |  | 人の物の欄 |
| `pensionRecord.months`（加入期間の月数） | `["category1","exemptQuarter"]` | 4分の1免除の月数 | 整数（か月）・0〜480 |  | 人の物の欄 |
| `pensionRecord.months`（加入期間の月数） | `["category1","exemptThreeQuarters"]` | 4分の3免除の月数 | 整数（か月）・0〜480 |  | 人の物の欄 |
| `pensionRecord.months`（加入期間の月数） | `["category1","paid"]` | 第1号の納付済みの月数 | 整数（か月）・0〜480 |  | 人の物の欄 |
| `pensionRecord.months`（加入期間の月数） | `["employee"]` | 厚生年金の加入月数 | 整数（か月）・0〜900 |  | 人の物の欄 |
| `pensionRecord.months`（加入期間の月数） | `["qualifying"]` | 受給資格期間の月数 | 整数（か月）・0〜900 |  | 人の物の欄 |

## residentTaxAssessment

| 入力項目ID | 場所 at | 欄の名前 | 値の書き方 | 額の期間 | 人・物 |
|---|---|---|---|---|---|
| `residentTaxAssessment.amount`（住民税の年税額） | （なし） | 住民税（2026年度の年税額） | 円の整数 | 年額 | 人の欄 |

## 新しい物の種類（`objects[].kind`）

保険の契約・住宅ローン・iDeCo・小規模企業共済は、書類の1件ごとに `objects` に1つ書き、その物の値の候補に `newObject` でその鍵を書きます。同じ物が世帯にもうあれば、FP が確かめの画面で「今の○○に当てる」を選びます（AI は、今ある物の ID が分かるときだけ `object` に書き、`objects` には書きません）。

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
| `debt:mortgage` | 住宅ローン | （保障の欄は無い。`debt.` の欄に当てる） |  |
| `account:ideco` | iDeCo | （保障の欄は無い。`account.` の欄に当てる） |  |
| `account:smallBusinessMutualAid` | 小規模企業共済 | （保障の欄は無い。`account.` の欄に当てる） |  |
