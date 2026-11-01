# 推定の目安の見直しの一覧（リリースのたびに見る）

空欄・「わからない」を補う目安の値（0008 の2 の「推定」）と、ボタンで足すときのひな形の値のうち、**時とともに古くなる物**の一覧です。市場の金利・値段・調査の年がある統計・よくある額の目安を、リリースのたびにこの一覧で見直します。

- **リリースの前に**: 下の「見直し」が「毎リリース」の行は必ず、それ以外は「次の見直し」の時期を過ぎた行を確かめる。値を変えたら、この一覧の「値」「出典・時点」も直す。
- **統計の値の正本は `data/master/` の YAML**（0007）。変えるときは新しい行（`rev`）を足し、古い行に `supersededIn` を書く。出典（`url`・`retrievedAt`・`sha256`・`locator`）と照らし合わせの記録（`approval`）を必ず書く。画面とヒアリングシートの写しは `hearing/` で `npm run statistics` で作り直す（`npm run statistics:check` が CI で確かめる）。
- **コードの中の目安**（出典の無いひな形）は、置き場所のファイルの定数を直す。同じ値が2か所以上にある物は、下の「まとめて直す値」を見る。
- 制度の値（税・社会保険・年金などの法令で決まる値。`data/regulation/`）はこの一覧の外（制度データの見直しで扱う）。ただし、全国健康保険協会の都道府県支部の料率・国民健康保険の全国の標準・後期高齢者医療の全国平均・介護保険の第1号の基準額のように毎年変わる値は、年1回の制度データの見直しで確かめる。

種類: **統計**＝出典のある公的な統計（マスタデータ）、**相場**＝市場で動く値（公的機関・民間〔主要な銀行など〕の公表の値と、出典の無い目安の物がある。民間の値は画面に会社の名前を出さず「主要な銀行が公表する金利の平均」のように呼び、出典の URL はマスタデータに書く）、**目安**＝出典の無いよくある額・割合のひな形、**法令**＝法令の値をコードに直書きしている物。

## 1. マスタデータ（`data/master/`）

| 推定 | 置き場所（値ID） | 値 | 出典・時点 | 種類 | 見直し |
|---|---|---|---|---|---|
| 全期間固定の住宅ローンの当初の金利 | `housing.statistics.mortgageRate.fixed` | 年3.83% | 住宅金融支援機構【フラット３５】の最も多い借入金利（2026年10月。借入期間21〜35年・融資率9割以下・新機構団信付き）。取得 2026-10-31 | 相場（統計） | **毎リリース**（毎月第1営業日に公表） |
| 固定期間選択型（当初10年）の住宅ローンの当初の金利 | `housing.statistics.mortgageRate.fixedPeriod10` | 年3.80% | 主要な銀行（4行）が公表する当初10年の最も低い適用金利の平均（2026年11月の借入〔1行は10月〕。民間の公表の金利。各行の URL・取得日・sha256 は値のファイルの sources）。取得 2026-10-31 | 相場（民間の公表） | **毎リリース**（各行が毎月の初めに公表） |
| 変動金利の住宅ローンの当初の金利 | `housing.statistics.mortgageRate.variable` | 年1.31% | 主要な銀行（4行）が公表する変動金利の最も低い適用金利の平均（同上）。参考: 住宅金融支援機構「住宅ローン利用者の実態調査」2026年1月調査の借入金利の中央値は約0.85%（2025年4〜9月の借入） | 相場（民間の公表） | **毎リリース**（同上。店頭金利から最大の引き下げ幅を引いて出す行は、両方の数を読み直す） |
| 貸与の奨学金の利率（子ども・教育の入力項目の貸与の奨学金と、ほかのローンの「奨学金の返済」の両方） | `loanRates.scholarship`（`hearing/src/loanRates.ts` の `scholarshipRateEstimate`） | 年3% | 日本学生支援機構 第二種奨学金の貸与利率（基本月額・利率固定方式。令和8年9月に貸与を終えた人。上限は年3%）。取得 2026-10-31 | 相場（公的機関の公表） | **毎リリース**（毎月公表。利率見直し方式は 2.4%） |
| 自動車ローンの金利（車の入力項目の自動車ローンと、今返している自動車ローンの両方） | `loanRates.carLoan`（同 `carLoanRateEstimate`） | 年2.14% | 主要な銀行（2行）が公表する自動車ローンの最も低い金利の平均（2026年10月。民間の公表の金利）。取得 2026-10-31 | 相場（民間の公表） | **毎リリース**（読める行が増えたら足す） |
| 家賃の変動率（空欄のときの知らせ） | `housing.statistics.rentGrowth` | 年−0.01%（ほぼ横ばい） | 総務省「消費者物価指数」2025年基準 民営家賃 全国 年平均の2015→2025年。e-Stat 公開 2026-08-07 | 統計 | 年1回（年平均の公表〔1月〕のあと） |
| 基本生活費（2人以上の世帯） | `living.statistics.basicMonthly` | 2人 235,225円〜6人以上 303,204円（月） | 総務省「家計調査」2025年 二人以上の世帯 第3-1表（e-Stat 2026-02-06） | 統計 | 年1回（毎年2月） |
| 基本生活費の費目の割合 | `living.statistics.categoryMonthly.*`（8値） | 費目ごとの月額 | 同上 | 統計 | 年1回（毎年2月） |
| 介護の費用・期間 | `care.statistics.monthly`・`monthlyHome`・`monthlyFacility`・`months`・`initial`（5値） | 月9.0万円・在宅5.2万円・施設13.8万円・55か月・一時費用47.2万円 | 生命保険文化センター「生命保険に関する全国実態調査」2024（令和6）年度 | 統計 | 3年ごと（次は2027年度調査） |
| 平均余命（亡くなる見込み） | `lifeTable.lifeExpectancy`（男女） | 主な年齢の平均余命 | 厚生労働省「令和7年簡易生命表」（2026-07-24） | 統計 | 年1回（毎年7月） |
| 学校の費用・学校外活動費・給食費 | `education.statistics.{kindergarten,elementary,juniorHigh,highSchool}.*`（18値） | 学校段階・公私ごとの年額 | 文部科学省「子供の学習費調査」令和5年度（2026-01-16 訂正版） | 統計 | 2年ごと（**次の令和7年度調査は2026年12月ごろの見込み**） |
| 私立大学・短大の入学金・授業料・施設設備費 | `education.statistics.university.private.*`・`juniorCollege.private.*`（15値） | 系統ごとの額 | 文部科学省「私立大学等 学生納付金等調査」令和7年度入学者（2025-12-26） | 統計 | 年1回（毎年12月ごろ） |
| 国立大学の入学金・授業料 | `education.statistics.university.national.*`（2値） | 282,000円・535,800円 | 国立大学等の授業料その他の費用に関する省令の標準額 | 法令（統計の形） | 省令の改正のとき |
| 公立大学の入学金・授業料 | `education.statistics.university.public.*`（2値） | 平均の額 | 文部科学省「国公私立大学の授業料等の推移」令和5年度 | 統計 | 年1回（ほかより古い年度） |
| 自宅外の通学の費用 | `education.statistics.boarding.*`（2値） | 年95.8万円・初年度38.7万円 | 日本政策金融公庫「教育費負担の実態調査」令和3年度（2021-12-20） | 統計 | 年1回（**最も古い値。後の調査が出ていないか確かめる**） |
| 給与・賞与（雇用形態・性別・年齢階級・企業規模） | `wageStats.scheduledMonthly.*`・`contractualMonthly.*`・`annualBonus.*`・`byAge.*`・`partTimeHourly.*`・`default`（昇給カーブ） | 例: 正社員・男 月425,600円・賞与1,297,900円 | 厚生労働省「賃金構造基本統計調査」令和7年（2026-03-24） | 統計 | 年1回（毎年3月） |
| 国家公務員の給与 | `wageStats.civilServant.monthly`・`monthlyByAge` | 月414,480円 | 人事院「国家公務員給与等実態調査」令和7年 | 統計 | 年1回 |
| 自営業の事業所得 | `wageStats.business.operatingProfit` | 年218万円 | 総務省「個人企業経済調査」2025年調査（2026-03-02） | 統計 | 年1回（毎年3月） |
| 退職給付制度がある企業の割合・退職給付額 | `retirementBenefit.prevalence`・`prevalence.bySize`・`{mandatory,company,voluntary,earlyIncentive}.*`（12値と3表） | 74.9%・定年・大卒 1,896万円など | 厚生労働省「就労条件総合調査」令和5年 | 統計 | 5年ごと（次は令和10年調査） |
| 中小企業のモデル退職金 | `retirementBenefit.smallFirm.*`（6表） | 勤続年数ごとの額 | 東京都産業労働局「中小企業の賃金・退職金事情」令和6年版 | 統計 | 2年ごと（退職金は隔年の項目） |

## 2. 住まい・ローン（コードの中の目安）

| 推定 | 置き場所 | 値 | 出典・時点 | 種類 | 見直し |
|---|---|---|---|---|---|
| 金利の目安の予備の値（写しが読めないとき） | `hearing/src/housingEstimates.ts` の `FALLBACK`・`hearing/src/loanRates.ts` の `estimateOf` の予備 | 住宅ローン 変動0.8%・ほか2%、奨学金1%、自動車ローン2.5% | 仮の値 | 相場（目安） | 毎リリース（マスタデータと大きくずれていないか） |
| 変動金利の見込みの型 | `app/src/workspace/input/stages/housingLoans.ts` の `RATE_OUTLOOKS` | 今のまま／10年で+1%／10年で+2%（5年ごと） | 出典なし | 目安 | 年1回 |
| 金利の段階を足すときの初めの値 | 同 `loanMoreActions`（`＋ 金利の段階`） | 前の段の金利（無ければ1%） | 出典なし | 相場（目安） | 毎リリース |
| ほかのローンの金利 | 同 `LOAN_SUBTYPES` | カードローン15%・リフォーム2.5%・契約者貸付3%・親・知人0%・その他3%（期間60か月）。奨学金はマスタデータ `loanRates.scholarship` | 出典なし（奨学金を除く） | 相場（目安） | 毎リリース |
| 新しい住宅ローンの借入額・今の残高 | 同 `newMortgage` | 3,000万円 | 出典なし | 目安 | 年1回 |
| 返済期間の標準 | 同 `standardTermMonths`・`hearing/src/loan.ts` | 35年（完済が80歳を超えないように） | 出典なし | 目安 | 年1回 |
| 物件の価格 | `app/src/workspace/input/stages/housing.ts` の `PRICE_PRESET` | 4,000万円 | 出典なし | 相場（目安） | 年1回 |
| 頭金・諸費用の割合 | 同 `DOWN_RATE`・`COSTS_RATE` | 価格の10%・5%（諸費用の目安は新築3〜7%・中古6〜10%） | 出典なし | 目安 | 年1回 |
| 購入の時期 | 同 `housing/addPurchase` | 2年後 | — | 目安 | 年1回 |
| 固定資産税・都市計画税 | 同 `TAX_PRESET` | 年12万円 | 出典なし | 目安 | 年1回 |
| 修繕・管理の費用（毎月） | 同 `MAINT_PRESET` | 月1.5万円 | 出典なし | 目安 | 年1回 |
| 家賃 | `app/src/workspace/input/fill.ts` の `RENT_STANDARD` | 月8万円 | 出典なし（地域・人数の統計はまだ無い） | 相場（目安） | 年1回 |
| 修繕・リフォームの行 | `app/src/workspace/input/moneyRows.ts` の `OUT_KINDS`（repair） | 10年ごとに100万円 | 出典なし | 目安 | 年1回 |
| 繰上返済の行を足すとき | `housingLoans.ts` の `loanMoreActions`（`＋ 繰上返済`） | 5年後に100万円 | — | 目安 | 年1回 |
| 持ち家の評価: 土地の割合・建物の下限・売却の費用 | `app/src/workspace/input/labels.ts` の `VALUATION_DEFAULTS`・`engine/src/sdk/helpers.ts` の `LAND_SHARE`・`RESIDUAL_FLOOR`・`SALE_COST_RATE` | 0.3・0.2・0.04 | 0025（土地付き注文住宅の土地の割合・固定資産評価の下限・仲介手数料など） | 目安 | 年1回 |
| 構造ごとの耐用年数 | `labels.ts` の `USEFUL_LIFE`・`helpers.ts`・`engine/src/components/asset.realEstate/index.ts` の `TAX_USEFUL_LIFE` | 木造22・軽量鉄骨19・重量鉄骨34・RC47年 | 減価償却資産の耐用年数等に関する省令 | 法令 | 法改正のとき |
| 収益不動産のローン・修繕・借り換え | `app/src/workspace/input/stages/rental.ts` | 2,000万円・固定2%・25年、5年後に100万円、前の金利（無ければ2%）・240か月 | 出典なし | 相場（目安） | 年1回 |
| ヒアリングの住宅ローン控除の仮の条件 | `hearing/src/import.ts` | 新築は省エネ基準適合住宅・中古は一般の住宅・持分100% | — | 法令（仮定） | 法改正のとき |

## 3. 生活費

| 推定 | 置き場所 | 値 | 出典・時点 | 種類 | 見直し |
|---|---|---|---|---|---|
| 1人の世帯の基本生活費 | `hearing/src/estimates.ts` の `LIVING_SINGLE` | 月14万円 | 仮の値（統計の表に単身世帯が無い） | 目安 | 年1回 |
| 生活費の段階（退職後など） | `app/src/workspace/input/livingStages.ts` の `AGE_LEVELS` | 退職後80%・70歳から75%・80歳から70% | 出典なし | 目安 | 年1回 |
| 節目のボタンの割合 | `app/src/workspace/input/stages/living.ts` の `DEFAULT_RATIO` | 子の独立0.85・退職0.8・70歳0.75・80歳0.7・その他0.9 | 出典なし | 目安 | 年1回 |
| 年払い・数年おきの支出のひな形 | 同 `ANNUAL_TEMPLATES` | 帰省 年10万・家電と家具 8年ごと40万・年会費 年3万・スマホ 4年ごと12万・PC 5年ごと15万・通院 年5万・ペットの医療 年5万・旅行 年20万 | よくある額の目安 | 目安 | 年1回 |
| 年払いの支出の行 | `moneyRows.ts` の `OUT_KINDS`（livingAnnual） | 年10万円 | 出典なし | 目安 | 年1回 |
| 黒字のうち貯金に回る割合 | `app/src/workspace/surplus.ts` の `PRESET_RATIOS` | 0.6／子育て中0.5→独立後0.8／退職前0.6→退職後0.8 | 出典なし | 目安 | 年1回 |
| 遺族の生活費の割合 | `engine/src/components/expense.living`・`protection.need`・`app/src/workspace/contingency/inputs.ts`・`assumptionList.ts` | 子がいる間0.7・末子の独立後0.5・子がいない世帯0.7 | 出典の確かめ前 | 目安 | 年1回 |

## 4. 教育

| 推定 | 置き場所 | 値 | 出典・時点 | 種類 | 見直し |
|---|---|---|---|---|---|
| 標準の進路・進路の型 | `app/src/workspace/input/stages/education.ts` の `defaultStages`・`COURSE_PRESETS` | 幼稚園〜高校は公立・大学は私立文系の自宅 | 出典なし | 目安 | 年1回 |
| 塾・習い事などの行 | 同（学校外の行を足すとき） | 塾 月2万・習い事 月8千・その他 月5千 | 出典なし | 目安 | 年1回 |
| 貸与の奨学金 | 同 `addScholarship`・`SCHOLARSHIP_BASIS` | 月5万・20年（利率はマスタデータ `loanRates.scholarship`） | 額と期間は仮の値 | 目安 | 年1回（利率は1章） |
| 教育ローン | 同 | 200万・2.5%・15年 | 出典なし | 相場（目安） | 毎リリース |
| 留学・その他の教育費・子への援助 | 同・`app/src/workspace/input/items.ts`・`moneyRows.ts` | 350万・年10万・30歳で100万 | 出典なし | 目安 | 年1回 |
| 保育料の自治体の水準 | `engine/src/components/education.nurseryFee` の `NURSERY_FEE_RATIO_DEFAULT` | 国の基準の0.8 | 0029 | 目安 | 年1回 |

## 5. 介護

| 推定 | 置き場所 | 値 | 出典・時点 | 種類 | 見直し |
|---|---|---|---|---|---|
| 統計が無いときの介護の期間 | `app/src/workspace/input/fill.ts` の `careTemplate`・`stages/care.ts` | 55か月 | 統計の値と同じ数の直書き | 目安 | 統計の更新のとき |
| 仕送りの行 | `moneyRows.ts` の `OUT_KINDS`（allowance） | 月3万円 | 出典なし | 目安 | 年1回 |

## 6. 働き方・収入・退職金

| 推定 | 置き場所 | 値 | 出典・時点 | 種類 | 見直し |
|---|---|---|---|---|---|
| 公務員の賞与・役員の報酬 | `hearing/src/estimates.ts` の `PROVISIONAL` | 公務員の賞与 男160万・女140万、役員 男600万・女480万 | 仮の値 | 目安 | 年1回 |
| 統計が無いときの給与の予備の値 | 同 | 正社員 男430万+100万・女330万+70万 など | 仮の値 | 目安 | 年1回 |
| パートの年収の時間 | 同 `PART_TIME_HOURS` | 週15時間×52週 | — | 目安 | 年1回 |
| 健康保険組合・共済組合の料率 | 同 `healthRateEstimate` | 全国健康保険協会（東京支部）の料率の半分／共済は0.0490 | 制度データ＋仮の値 | 目安 | 年1回（毎年3月の料率の改定のあと） |
| 住民税の概算の仮定 | 同 `residentTaxEstimate` | 所得割10%・社会保険料は収入の15% | 仮定 | 目安 | 年1回 |
| 定年 | `app/src/workspace/input/stages/work.ts` の `retirementAgeEstimate` | 60歳 | 出典なし | 目安 | 年1回 |
| ヒアリングの勤め先の規模・勤務時間 | `hearing/src/import.ts` | 300人（パートは30人）・週40時間（パートは20時間） | 仮の値 | 目安 | 年1回 |
| 役員の功績倍率・確定給付企業年金の受け取り方 | `app/src/workspace/input/retirementBenefits.ts` | 1.0・年金10年・一時金と年金の半分ずつ | 出典なし | 目安 | 年1回 |

## 7. 保険・車

| 推定 | 置き場所 | 値 | 出典・時点 | 種類 | 見直し |
|---|---|---|---|---|---|
| 保険の種類ごとの保障の終わり・手術・入院の限度日数 | `app/src/workspace/input/insuranceKinds.ts` の `KINDS`・`SURGERY_RATIO`・`engine/src/components/insurance.policy` の `DEFAULT_MAX_DAYS` | 65歳まで・入院日額の10倍・60日 など | ひな形 | 目安 | 年1回 |
| 車の目安 | `hearing/src/estimates.ts` の `CAR_ESTIMATE` | 乗り換え8年・新車250万・維持費 年36万・任意保険 年7万・車検10万 など | 仮の値 | 相場（目安） | 年1回 |
| 下取り・売却の残価 | `app/src/workspace/input/stages/cars.ts` の `residualRate` | 3年50%・5年35%・8年15%・10年以上5% | ひな形 | 目安 | 年1回 |
| 自動車ローン（借入の割合・期間） | `cars.ts` の `LOAN_SHARE`・`LOAN_TERM`・`housing.ts` の `newCarLoan` | 下取りを引いた額の8割・60か月／今返している分 200万・5年（金利はマスタデータ `loanRates.carLoan`） | 出典なし | 目安 | 年1回（金利は1章） |
| 手放した後の移動・古くなってからの修理・用品 | `cars.ts`・`moneyRows.ts` | 月1万・年10万（10年後から）・年5万 | よくある額 | 目安 | 年1回 |

## 8. 前提条件・資産運用

| 推定 | 置き場所 | 値 | 出典・時点 | 種類 | 見直し |
|---|---|---|---|---|---|
| 物価・賃金・運用利回り・マクロ経済スライド（標準の前提） | `app/src/workspace/input/household.ts` の `DEFAULT_ASSUMPTIONS`・`hearing/src/import.ts`・`stages/assumptions.ts` の `STANDARD_BASIS` | 1%・1%・1%・0.4% | 仮の値（事務所の値ができるまで） | 目安 | 年1回 |
| 注意の線 | `stages/assumptions.ts` | 運用5%超・物価0%未満か4%超 など | 初めの線の仮の値 | 目安 | 年1回 |
| 資産の種類ごとの期待リターンとばらつき・配分の既定・費用 | `app/src/workspace/input/savings/model.ts` の `CLASSES`・`DEFAULT_MIX`・`DEFAULT_FEE` | 国内株5%/18%・外国株6%/20%・債券1%/5% など、費用0.25% | 仮の値 | 相場（目安） | 年1回 |
| 運用利回りのボタン・まとめた口座の利回り | 同 `RATE_PRESETS` など | 1%・2%・3%、2% | 仮の値 | 目安 | 年1回 |
| 取り崩しの計画・確定拠出年金の受け取りの概算 | 同 | 65歳から月15万・定率4%、年金10年・税5% | 仮の値 | 目安 | 年1回 |
| ストレステストの既定 | `engine/src/engine/overlay.ts`・`app/src/workspace/invest/present.ts` | 低い利回り0.5%×10年・物価4%×5年・金利+1% など | 出典なし | 目安 | 年1回 |

## 9. その他（万一・相続・ライフイベント・料金）

| 推定 | 置き場所 | 値 | 出典・時点 | 種類 | 見直し |
|---|---|---|---|---|---|
| 一時的支出・養育費・不動産の一時の経費・その他の支出の行 | `moneyRows.ts` の `OUT_KINDS` | 50万・月4万・100万・10万 | 出典なし | 目安 | 年1回 |
| ライフイベントのひな形・予備費・ペット | `app/src/workspace/input/stages/events.ts`・`items.ts` | 家族旅行 年30万・大きな買い物50万・予備費 毎年生活費の1か月分・ペット 年18万を14年 | よくある額 | 目安 | 年1回 |
| 相続で受け継ぐ借金 | `moneyRows.ts` | 100万・2%・5年 | 仮の値 | 目安 | 年1回 |
| 相続税の目安の不動産の割合 | `engine/src/components/inheritance.estimate` の `REAL_ESTATE_RATIO`・`stages/inheritance.ts` | 時価の0.8 | 路線価は公示価格の8割程度（国税庁） | 目安 | 年1回 |
| 大きな病気・入院の日数の想定 | `app/src/workspace/contingency/requests.ts` の `ILLNESS_DEFAULT`・`HOSPITAL_DAYS_DEFAULT` | 働けない12か月・医療費 月60万を6か月、がん20日・心疾患と脳卒中30日・その他10日 | 患者調査の平均在院日数を丸めた仮の値（版は未確認） | 統計（未確認） | 3年ごと（患者調査の公表のあと） |
| 相場が下がる・収入が減る場面 | `contingency/requests.ts`・`engine/src/engine/overlay.ts` | 3割・本人2割を3年 | 仮の値 | 目安 | 年1回 |
| FP顧問料の標準の料金表 | `app/src/workspace/office/current.ts` の `STANDARD_FEE_TABLE` | 単発30万・継続 月1万 | 事務所の値 | 目安 | 料金の改定のとき |

## まとめて直す値（2か所以上にある同じ値）

| 値 | 場所 |
|---|---|
| 住宅ローンの目安の金利 | マスタデータ `housing.statistics.*` だけ（画面の新しい住宅ローンとヒアリングの簡易版の住宅ローンは、どちらも `hearing/src/housingEstimates.ts` から読む） |
| 奨学金・自動車ローンの目安の金利 | マスタデータ `loanRates.*` だけ（2026-10-31 にそろえた。前は奨学金が1%と0.5%、自動車ローンが2.5%と2%で2か所に違う値があった。どちらも `hearing/src/loanRates.ts` から読む） |
| 標準の前提（物価・賃金・運用） | `app/src/workspace/input/household.ts` の `DEFAULT_ASSUMPTIONS` と `hearing/src/import.ts`、ほかに直書きの `"0.01"` |
| 持ち家の評価の目安 | `app/src/workspace/input/labels.ts` と `engine/src/sdk/helpers.ts`（と `asset.realEstate`） |
| 遺族の生活費の割合 | `engine` の2つの部品・`app/src/workspace/contingency/inputs.ts`・`assumptionList.ts` |
| 介護の期間 55か月 | マスタデータと `fill.ts`・`stages/care.ts` の予備の値 |
| 入院の限度日数 60日 | `insuranceKinds.ts` と `engine/src/components/insurance.policy` |
