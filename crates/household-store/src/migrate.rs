//! 形式の版と一方向の移行（0011 の5）。
//!
//! - 本文の形式の版は `MAJOR.MINOR`。β公開までは `0.x`（最初は `0.1`）で書く（0011 の追記）。
//! - 読み込み時に、古い版から今の版まで、版が上がった順に1段ずつ変換する。各段は入力と出力が決まった純粋な関数。
//!   MINOR だけが上がった段も、中身が「何もしない」でも置く（全段がそろっていることをテストで確かめる）。
//! - MAJOR が新しいファイルは開かない。MINOR だけが新しいファイルは閲覧だけ（保存させない）。
//! - 過去のすべての版の見本を `tests/fixtures/household-format/<版>/` に置き、消さない（テストで毎回開いて今の版へ変換する）。

use serde_json::{Map, Value};

use crate::readings;
use crate::StoreError;

/// 今の形式の版（保存は常にこの版）
pub const CURRENT: &str = "0.46";

/// これまでのすべての形式の版（古い順）。消さない
/// - 0.1: 最初の版（2026-10-18）
/// - 0.2: 誰が直したか（`meta.savedBy`・`meta.revisions`・`meta.editors`・`household.memoBy`・
///   `consents[].recordedBy`・`candidates[].decidedByMember`）を足した（0023 の6。足すだけの MINOR）
/// - 0.3: 控えの区画 `snapshots`（0009 の2。任意。控えが無ければ区画ごと無い）を足した（足すだけの MINOR）
/// - 0.4: 世帯のデータに、持ち家の評価 `residences[].valuation`・売却 `residences[].sale`・器の種類 `otherAsset`（その他の資産）と
///   評価額の増減率 `accounts[].valueGrowth`・前提 `assumptions.realEstateValuation` を足した（どれも任意。足すだけの MINOR。0025）
/// - 0.5: 資産運用（0026）。器の種類 `pooled`（まとめた金融資産）・器の利回り `accounts[].expectedReturn`・運用の費用 `accounts[].fee`・
///   受け取ったお金の行き先 `accounts[].payout.destination`・前提 `assumptions.investment`・`assumptions.assetVolatility`・
///   `assumptions.returnShifts` を足した（どれも任意）。読み方を2つ変えた: 積立の終わり（`contributions[].to`）が空の積立は
///   「表の最後まで」ではなく「名義の人の退職の月まで（推定）」、iDeCo・企業型DC の受け取りの始まりが空なら「75歳」ではなく
///   「退職の年（60〜65歳に収める）」。データは書き換えず、空のまま新しい読み方で読む（画面は「推定あり」の印を出す）
/// - 0.6: 住まい以外の不動産の中身 `accounts[].property`（土地と建物に分ける・取得・家賃収入・経費・売却）と、その不動産のローン
///   `debts[].property` を足した（どれも任意。足すだけの MINOR。0028）。読み方は変えない（中身の無い不動産の器は今までどおり1行で評価する）
/// - 0.7: 表示の設定に、資産と負債のタブで時点を並べるときの既定の時点 `display.bsPoints` と、この世帯で選んだ時点 `display.bsColumns`
///   （候補の鍵か決まった年）を足した（どちらも任意。無ければ既定。足すだけの MINOR。0027 の追記）。0.6 の間に足した家計の体力の目安の幅
///   `display.bsGuide`（任意）も、この版から形式の一部として数える
/// - 0.8: 表示の設定をタブごとの区画に分けた（`display.result`: 結果のタブ ＝ `metrics`・`atAge`・`layout`・`invBreakdown`・`invPeriods`、
///   `display.balance`: 資産と負債のタブ ＝ `guide`・`points`・`columns`）。なくした「操作中はグラフを上に表示」の `display.dock` は持たない。
///   形を変える段（0.7 → 0.8）で、直下の値を区画へ移す（`bsGuide` → `balance.guide`、`bsPoints` → `balance.points`、`bsColumns` → `balance.columns`）
/// - 0.9: 教育の目標に、保育所の段の保育の時間 `stages[].hours`・国の基準に対する自治体の水準の割合 `stages[].feeRatio` と、
///   公立の小学校・中学校の給食費 `education.schoolLunch` を足した（どれも任意。足すだけの MINOR。0029）。読み方を1つ変えた:
///   保育所の段の月額（`stages[].monthly`）が空なら「0円」ではなく「世帯の収入から自動で計算した保育料（目安）」。データは書き換えず、
///   空のまま新しい読み方で読む（月額 0 を入れた段は今までどおり保育料なし）
/// - 0.10: 控えのきっかけに `takeaway`（持ち帰り用のレポートを書き出した時点）と、その記録 `snapshots[].takeaway`（載せたプラン・
///   FP の提案のプラン・パスワードの有無・顧客が動かせるつまみ・載せた画面・作成日・ファイルの指紋。パスワード・宛名は持たない）を足した
///   （足すだけの MINOR。0030）。0.9 までのアプリは知らないきっかけの控えを読み落とすので、版を上げて閲覧だけにする
/// - 0.11: 前提に、黒字のうち貯まる割合 `assumptions.surplusSaving`（割合・上限・期間で変える組）と生活防衛資金
///   `assumptions.emergencyReserve`（金額か基本生活費の○か月分・「○歳まで持つ」の判定に含めるか）、まとめた金融資産の器の
///   運用しない分 `accounts[].uninvested` を足した（どれも任意。足すだけの MINOR。0031）。読み方は変えない（無ければ今まで通り）。
///   0.10 までのアプリの計算エンジンはこの欄を知らないので、版を上げて閲覧だけにする
/// - 0.12: 生活防衛資金をなくした（0031 の追記）。前提の `assumptions.emergencyReserve` と、プランの差分のうちその前提を動かすもの
///   （動かす項目 `reserve:months`）・対策に足した項目の `reserve:months` を、変換の段で捨てる（形を変える MINOR）。控えの中身は変えない。
///   0.11 のアプリは前提が無ければ今まで通りに読むが、捨てた値を書き戻さないよう版を上げる
/// - 0.13: 資産と負債のタブの表示の設定に、お金の3つの分け方 `display.balance.moneyThree`（何か月分 `months`・何年先まで `years`・
///   呼び方 `wording`）を足した（任意。無ければ既定の 6か月・10年・使う／貯める／増やす。足すだけの MINOR。0032）。
///   0.12 までのアプリは知らない欄を読み落として書き戻さないので、版を上げて閲覧だけにする（0.7 と同じ考え方）
/// - 0.14: 本文の区画 `statements`（明細の取り込みの記録。口座・カードの呼び名と持ち主、取り込みごとの元のファイルの指紋・読み手・
///   列の対応付け・期間・番号を消した後の行と FP が決めたこと、世帯の決まり、構成員ごとの働き方、候補を取り込んだ記録。0034）を足した
///   （任意。取り込んでいない世帯は区画ごと無い。足すだけの MINOR）。元のファイルは持たない。0.13 までのアプリは知らない区画を
///   読み落として書き戻さないので、版を上げて閲覧だけにする
/// - 0.15: 区画 `statements` に、前もってお客さまに印を付けてもらう確認シートの依頼の記録 `requests`（依頼番号・書き出した日時・
///   書き出したファイルの指紋と大きさ・シートの番号 → 取り込みの ID と行の ID・取り込んだ記録 `received`）を足した（任意。書き出して
///   いなければ無い。足すだけの MINOR。0034 の9）。0.14 のアプリは知らない欄を読み落として書き戻すので、版を上げて閲覧だけにする
/// - 0.16: 確認シートの依頼の記録 `requests` の行の対応 `rows` で、同じ番号に複数の行を対応させられるようにした（店ごとにまとめた
///   シートの1行。0034 の9）。欄は足していない。0.15 のアプリは同じ番号の2つ目からを捨てて書き戻すので、版を上げて閲覧だけにする
/// - 0.17: 作りの変わる形を1段で変える（0035）。並びの要素の ID（決まった作り方で振る）、世帯の外の家族の印 `members[].outside`
///   （親・祖父母の構成員に付け、開いたときの知らせを書く。贈与者 `donors` は同じ ID の世帯の外の家族にして区画をなくす）、
///   値の状態の欄 `valueStates`（仮の印 `household.assumed` を読み替え表で移す）、プランの差分を当て先の形に（0036）、
///   対策に足した項目 `workspace.shownItems` を当て先に。控え・ヒアリング・明細の取り込み・拡張領域は変えない
/// - 0.18: 段階と例外の年（周期的な支出・家賃・修繕費・固定資産税・住まい以外の不動産の家賃と経費の `stages`・`exceptions`、
///   器の利回りの `returnStages`・`returnExceptions`、資産配分の `allocation.stages`）と、働き方の期間ごとの伸び（給与の
///   `salary.growth.rate`・事業所得の `business.growth`）を足した（足すだけの MINOR。0040）。0.17 のアプリは知らない欄を読み落として
///   書き戻すので、版を上げて閲覧だけにする
/// - 0.19: 世帯の外の家族のお金 `members[].wallet`（預金・生活費・年金・一時の入金。0042）を足した（任意。入れていなければ無い。
///   足すだけの MINOR）。0.18 のアプリは知らない欄を読み落として書き戻すので、版を上げて閲覧だけにする
/// - 0.20: お金の行（0044）。入るお金の行 `incomeFlows`、出るお金の行 `periodicExpenses` の `monthly`・`kind`・`counterparty`・
///   `payer`・`priority`・`gift`、口座の間の移し替えの入れ物 `transfers`、負債の `inheritedFrom`・`likelihood`・`includeInBase` を
///   足した（どれも任意。足すだけの MINOR）。0.19 のアプリは知らない欄を読み落として書き戻すので、版を上げて閲覧だけにする
/// - 0.21: 住まい・ローンのカード（0052・0053）。住まいの建て方 `residences[].style`、譲渡所得の税の額 `residences[].sale.tax`、
///   負債の名前 `debts[].label` と種類の細目 `debts[].subtype`、画面の側のローンの入れ方の区分 `household.loanEntry` を足した
///   （どれも任意。足すだけの MINOR）。0.20 のアプリは知らない欄を読み落として書き戻すので、版を上げて閲覧だけにする
/// - 0.22: 退職金・企業年金のカード（0057）。退職給付の名前 `retirementBenefits[].label` と学歴 `retirementBenefits[].education`
///   （退職一時金の目安の元）を足した（どれも任意。計算には使わない。足すだけの MINOR）。0.21 のアプリは知らない欄を読み落として
///   書き戻すので、版を上げて閲覧だけにする
/// - 0.23: 子ども・教育のカード（0062・0063）。教育の目標の学校外の費用の入れ方 `goals[].education.outOfSchoolMode` と、塾・習い事の行の種類
///   `goals[].education.lessons[].kind` を足した（どれも任意。足すだけの MINOR。入れ方の無い目標は前の形のまま計算する）。
///   0.22 のアプリは知らない欄を読み落として書き戻すので、版を上げて閲覧だけにする
/// - 0.24: 相続・贈与のカード（0060・0061）。計算の要求の入力に、相続税の目安の設定 `inheritanceTax`（時点を入れない設定だけ）と
///   遺したい額 `legacy` を足した（どれも任意。足すだけの MINOR）。0.23 のアプリは知らない欄を読み落として書き戻すので、版を上げて閲覧だけにする
/// - 0.25: 保険のカード（0054・0055）。保険の種類の細目 `insuranceContracts[].subtype`・名前 `label`、保障の行の被保険者
///   `coverages[].insured`・入院の1回の限度日数 `coverages[].maxDays`・給付の種類 `threeMajorLump`、円の目安の形 `simple.estimate`、
///   画面の側の万一の前提の病気の想定 `household.contingency.illness` の `disease`・`hospitalDays`・`surgeries` を足した
///   （どれも任意。足すだけの MINOR）。0.24 のアプリは知らない欄を読み落として書き戻すので、版を上げて閲覧だけにする
/// - 0.26: 車のカード（0069）。車の維持費の入れ方 `cars[].upkeepMode`（合計だけ／内訳だけを数える）と、内訳の名前つきの行
///   `cars[].upkeepOther[]`（ID・名前・年額）を足した（どれも任意。足すだけの MINOR。入れ方の無い車は前の形〔入っている物を全部数える〕で計算する）。
///   0.25 のアプリは知らない欄を読み落として書き戻すので、版を上げて閲覧だけにする
/// - 0.27: 前提条件と万一のタブの前提（0070・0071）。画面の側の万一の前提 `household.contingency` に、子の独立とみなす年齢
///   `survivor.independenceAge`・業務上の死亡 `survivor.deathBenefits.workRelated`・必要保障額の出し方 `protection`・働き方を変える時点
///   `work.<人>.from`・復帰の後の働き方 `illness.afterMonths`・`afterRatio`・収入が減る場面 `incomeDrop`・下げる資産と戻り方
///   `market.classes`・`recoveryYears`・`recoveryCap`・相場の下落を重ねる印 `stackMarket` を、画面の側の値に前提と推定の一覧の
///   確かめた記録 `household.agreed` を足した（どれも任意。足すだけの MINOR）。万一の前提のプランごとの上書きは、0.17 からある向き先
///   `{plan: "contingency"}` の差分で書く（入力項目ID contingencyPremise.*）。0.26 のアプリは知らない欄を読み落として書き戻すので、
///   版を上げて閲覧だけにする
/// - 0.28: 年金のカード（0066・0067）。入るお金の行の受給中の遺族年金・障害年金の種類 `incomeFlows[].pensionType`（表示と終わりの推定だけ）と、
///   画面の側の年金の入れ方を切り替えたときに残した前の記録 `household.pensionKept` を足した（どれも任意。足すだけの MINOR）。
///   前の版のアプリは知らない欄を読み落として書き戻すので、版を上げて閲覧だけにする
/// - 0.29: 入力のホームの確かめの一覧（0072）。画面の側の「次回確かめる」の印 `household.recheck`（行の ID・カード・見出し・付けた日）を足した
///   （任意。足すだけの MINOR）。前の版のアプリは知らない欄を読み落として書き戻すので、版を上げて閲覧だけにする
/// - 0.30: 年金の記録が無い人（推計の区分）の受け取り開始 `members[].pensionClaim`（0078。基礎・厚生の受給を始める時点。計算に使う）を足した
///   （任意。足すだけの MINOR）。前の版のアプリは知らない欄を読み落として書き戻すので、版を上げて閲覧だけにする
/// - 0.31: 収益不動産の物件を見分ける欄 `accounts[].property` の `name`・`kind`・`location`・`share`・`tenure`・`units`・`area`・`memo`
///   （0079。どれも任意で表示用。計算には使わない。足すだけの MINOR）。前の版のアプリは知らない欄を読み落として書き戻すので、版を上げて閲覧だけにする
/// - 0.32: 収益不動産のお金の欄 `accounts[].property` の `acquisition.parts`・`acquisition.equipmentLife`・`acquisition.costs`・`acquisition.equity`・
///   `rental.commonFee`・`rental.parking`・`rental.otherMonthly`・`rental.keyMoney`・`expenses.items`・`repairs`・`lodging`（0080。どれも任意。
///   自己資金と修繕の中身のほかは計算に使う。足すだけの MINOR）。前の版のアプリは知らない欄を読み落として書き戻すので、版を上げて閲覧だけにする
/// - 0.33: 収益不動産の税と出口の欄 `accounts[].property.sale.repayLoan`・`accounts[].property.lodging.incomeKind` と、申告の仕方
///   `members[].taxReturn`（0081。どれも任意で計算に使う。足すだけの MINOR）。前の版のアプリは知らない欄を読み落として書き戻すので、版を上げて閲覧だけにする
/// - 0.34: 画面の側の入力項目の選び方 `household.itemChoice`（0083。入力のホームに出さない入力項目 `hidden` と、開いたときの入れ方 `levels`。
///   任意。計算には使わない。足すだけの MINOR）。前の版のアプリは知らない欄を読み落として書き戻すので、版を上げて閲覧だけにする
/// - 0.35: 画面の側の確かめの注意の「確認した」の印 `household.noticeAcks`（0041・0055。注意の ID `id`・確認したときの中身 `of`・確認した日 `on`。
///   任意。計算には使わない。足すだけの MINOR）。前の版のアプリは知らない欄を読み落として書き戻すので、版を上げて閲覧だけにする
/// - 0.36: 画面の側の万一の前提に、就業不能・収入が減るの場面の配偶者の働き方 `household.contingency.partnerWork`（0085。場面の種類 →
///   構成員の ID → 働き方。任意。計算に使う。足すだけの MINOR）。前の版のアプリは知らない欄を読み落として書き戻すので、版を上げて閲覧だけにする
/// - 0.37: 入るお金の行の表の行に「雑所得」`incomeFlows[].row = "cf.income.other.miscellaneous"` を足した（0086。選べる値を足すだけの MINOR。
///   前の版のエンジンはこの値を知らずに計算できないので、版を上げて閲覧だけにする）。既存の行の値は書き換えない（課税の扱いの既定は同じ）
/// - 0.38: 給与からの推定のままの標準報酬月額の置き換え口 `employmentPeriods[].standardMonthlyRemuneration` を外した（0047 の追記 2026-10-29 の2。
///   前の画面が新しい働き方の期間に書いていた推定の額。外すと計算エンジンが給与から毎年9月に決め直し、昇給が保険料と厚生年金に入る）。
///   FP が入れた値は変えない。結果が変わるので、外した世帯には開いたときの知らせ `smrBlank` を1回だけ見せる。前の版のアプリは推定を書き戻すので、
///   版を上げて閲覧だけにする
/// - 0.39: 教育の目標の段に、段ごとの給食費の選び方 `goals[].education.stages[].schoolLunch`・部活動などの費用の年額 `clubAnnual`・
///   保育所の段の保育料とは別にかかるお金の年額 `extraAnnual` を足した（0062・0029 の追記 2026-10-30。どれも任意で計算に使う。足すだけの MINOR）。
///   前の版のアプリは知らない欄を読み落として書き戻すので、版を上げて閲覧だけにする
/// - 0.40: 教育の目標に留学 `goals[].education.abroad`（0088。段・学年・留学の形〔休学して1年・単位が認められる1年・短期〕・1回の額・万一のときの扱い。
///   任意で計算に使う。足すだけの MINOR）。前の版の出るお金の行の留学は書き換えない。前の版のアプリは知らない欄を読み落として書き戻すので、
///   版を上げて閲覧だけにする
/// - 0.41: 教育の段の種類に大学院 `stage: graduateMaster`（修士・博士前期）・`graduateDoctor`（博士・博士後期）、公立・私立の選び方に
///   インターナショナルスクール `sector: international`（幼稚園〜高校）を足した（0089。選べる値を足すだけの MINOR。前の版のエンジンはこの値を
///   知らずに計算できないので、版を上げて閲覧だけにする）。前の版の段は書き換えない
/// - 0.42: 教育の段の種類に高専 `stage: kosen`・専門職大学院 `graduateProfessional`、系統に法科大学院 `field: law` を足した（0090。選べる値を
///   足すだけの MINOR。前の版のエンジンはこの値を知らずに計算できないので、版を上げて閲覧だけにする）。前の版の段は書き換えない
/// - 0.43: 基本生活費の内訳に通信費 `communication`・交通費 `transit`・こづかいと交際費 `pocketAndSocial`・その他 `other` を足し（0100。選べる値を
///   足すだけの MINOR。前の版の内訳の交通・通信 `transport` とその他の消費 `otherConsumption` は書き換えない）、基本生活費の入力項目から「わからない」を
///   なくした。変換の段は、基本生活費（`livingExpenses`）と年払い・数年おきの暮らしの支出（`periodicExpenses` の種類 `livingAnnual`）の「わからない」を
///   推定にし、内訳の束の合計を動かしたプランの差分（`livingGroupDaily`・`livingGroupMisc`）を代表の内訳の差分にする
/// - 0.44: 値の状態の「わからない」（`state: unknown`）を「書類で確かめる」にし、書類から写す欄（住民税の年税額・退職金と企業年金の見込み額・
///   年金の加入月数・今の住宅ローンの借入額と金利と返済期間と残高・保険の手術の1回の額・自動車ローン）だけに残した（0041 の追記 2026-10-31。
///   形は変えない MINOR。前の版のアプリは、ほかの欄に「わからない」を入れて書き戻すので、版を上げて閲覧だけにする）。変換の段は、ほかの欄の
///   「わからない」を推定にし（値は変えない）、開いたときの知らせ `unknownEstimated` を足す
/// - 0.45: 車の買い替え `cars[].purchase.replace`（買い替え続ける・この1台だけ・○歳まで）と、リース・長期レンタル `cars[].lease`（種類・月額・
///   借り始め・契約の年数・月額に含む物）を足した（0101。足すだけの MINOR。リースの車は `purchase` を持たない。前の版のアプリは、知らない欄を
///   読み落として書き戻し、リースの車を読めないので、版を上げて閲覧だけにする）。変換の段は形式の版だけを書き換える（買い替えの無い車は買い替え続ける）
/// - 0.46: 夢プランを出るお金の行の種類 `dream` と、その行の `dream`（順位・計算に入れるか・ひとことメモ）で持ち、子への援助
///   `goals[].education.gifts[]` に優先度 `priority`（必ず・できれば）を足した（0103。足すだけの MINOR。前の版のアプリは種類 dream の行を読めず、
///   援助の優先度を読み落として書き戻すので、版を上げて閲覧だけにする）。変換の段は形式の版だけを書き換える（前の援助は「必ず」のまま）
pub const KNOWN: &[&str] = &[
    "0.1", "0.2", "0.3", "0.4", "0.5", "0.6", "0.7", "0.8", "0.9", "0.10", "0.11", "0.12", "0.13",
    "0.14", "0.15", "0.16", "0.17", "0.18", "0.19", "0.20", "0.21", "0.22", "0.23", "0.24", "0.25",
    "0.26", "0.27", "0.28", "0.29", "0.30", "0.31", "0.32", "0.33", "0.34", "0.35", "0.36", "0.37",
    "0.38", "0.39", "0.40", "0.41", "0.42", "0.43", "0.44", "0.45", "0.46",
];

/// 1段分の変換
pub struct Step {
    pub from: &'static str,
    pub to: &'static str,
    pub apply: fn(Value) -> Result<Value, StoreError>,
}

/// 変換の段（古い順）。版を上げるときは、ここに1段と、その版の見本を足す。消さない
pub const STEPS: &[Step] = &[
    Step {
        from: "0.1",
        to: "0.2",
        apply: v0_1_to_0_2,
    },
    Step {
        from: "0.2",
        to: "0.3",
        apply: v0_2_to_0_3,
    },
    Step {
        from: "0.3",
        to: "0.4",
        apply: v0_3_to_0_4,
    },
    Step {
        from: "0.4",
        to: "0.5",
        apply: v0_4_to_0_5,
    },
    Step {
        from: "0.5",
        to: "0.6",
        apply: v0_5_to_0_6,
    },
    Step {
        from: "0.6",
        to: "0.7",
        apply: v0_6_to_0_7,
    },
    Step {
        from: "0.7",
        to: "0.8",
        apply: v0_7_to_0_8,
    },
    Step {
        from: "0.8",
        to: "0.9",
        apply: v0_8_to_0_9,
    },
    Step {
        from: "0.9",
        to: "0.10",
        apply: v0_9_to_0_10,
    },
    Step {
        from: "0.10",
        to: "0.11",
        apply: v0_10_to_0_11,
    },
    Step {
        from: "0.11",
        to: "0.12",
        apply: v0_11_to_0_12,
    },
    Step {
        from: "0.12",
        to: "0.13",
        apply: v0_12_to_0_13,
    },
    Step {
        from: "0.13",
        to: "0.14",
        apply: v0_13_to_0_14,
    },
    Step {
        from: "0.14",
        to: "0.15",
        apply: v0_14_to_0_15,
    },
    Step {
        from: "0.15",
        to: "0.16",
        apply: v0_15_to_0_16,
    },
    Step {
        from: "0.16",
        to: "0.17",
        apply: v0_16_to_0_17,
    },
    Step {
        from: "0.17",
        to: "0.18",
        apply: v0_17_to_0_18,
    },
    Step {
        from: "0.18",
        to: "0.19",
        apply: v0_18_to_0_19,
    },
    Step {
        from: "0.19",
        to: "0.20",
        apply: v0_19_to_0_20,
    },
    Step {
        from: "0.20",
        to: "0.21",
        apply: v0_20_to_0_21,
    },
    Step {
        from: "0.21",
        to: "0.22",
        apply: v0_21_to_0_22,
    },
    Step {
        from: "0.22",
        to: "0.23",
        apply: v0_22_to_0_23,
    },
    Step {
        from: "0.23",
        to: "0.24",
        apply: v0_23_to_0_24,
    },
    Step {
        from: "0.24",
        to: "0.25",
        apply: v0_24_to_0_25,
    },
    Step {
        from: "0.25",
        to: "0.26",
        apply: v0_25_to_0_26,
    },
    Step {
        from: "0.26",
        to: "0.27",
        apply: v0_26_to_0_27,
    },
    Step {
        from: "0.27",
        to: "0.28",
        apply: v0_27_to_0_28,
    },
    Step {
        from: "0.28",
        to: "0.29",
        apply: v0_28_to_0_29,
    },
    Step {
        from: "0.29",
        to: "0.30",
        apply: v0_29_to_0_30,
    },
    Step {
        from: "0.30",
        to: "0.31",
        apply: v0_30_to_0_31,
    },
    Step {
        from: "0.31",
        to: "0.32",
        apply: v0_31_to_0_32,
    },
    Step {
        from: "0.32",
        to: "0.33",
        apply: v0_32_to_0_33,
    },
    Step {
        from: "0.33",
        to: "0.34",
        apply: v0_33_to_0_34,
    },
    Step {
        from: "0.34",
        to: "0.35",
        apply: v0_34_to_0_35,
    },
    Step {
        from: "0.35",
        to: "0.36",
        apply: v0_35_to_0_36,
    },
    Step {
        from: "0.36",
        to: "0.37",
        apply: v0_36_to_0_37,
    },
    Step {
        from: "0.37",
        to: "0.38",
        apply: v0_37_to_0_38,
    },
    Step {
        from: "0.38",
        to: "0.39",
        apply: v0_38_to_0_39,
    },
    Step {
        from: "0.39",
        to: "0.40",
        apply: v0_39_to_0_40,
    },
    Step {
        from: "0.40",
        to: "0.41",
        apply: v0_40_to_0_41,
    },
    Step {
        from: "0.41",
        to: "0.42",
        apply: v0_41_to_0_42,
    },
    Step {
        from: "0.42",
        to: "0.43",
        apply: v0_42_to_0_43,
    },
    Step {
        from: "0.43",
        to: "0.44",
        apply: v0_43_to_0_44,
    },
    Step {
        from: "0.44",
        to: "0.45",
        apply: v0_44_to_0_45,
    },
    Step {
        from: "0.45",
        to: "0.46",
        apply: v0_45_to_0_46,
    },
];

/// 0.1 → 0.2: 改訂の履歴と、出てくるメンバーの表示名を空で足す（ほかの欄は任意なので足さない）
fn v0_1_to_0_2(mut body: Value) -> Result<Value, StoreError> {
    let obj = body.as_object_mut().ok_or(StoreError::BODY)?;
    let meta = obj
        .entry("meta")
        .or_insert_with(|| Value::Object(serde_json::Map::new()));
    let meta = meta.as_object_mut().ok_or(StoreError::BODY)?;
    meta.entry("revisions")
        .or_insert_with(|| Value::Array(vec![]));
    meta.entry("editors")
        .or_insert_with(|| Value::Object(serde_json::Map::new()));
    meta.insert("formatVersion".into(), "0.2".into());
    Ok(body)
}

/// 0.2 → 0.3: 控えの区画は任意なので足さない（控えの無い世帯は区画ごと無い）。形式の版だけを書き換える
fn v0_2_to_0_3(mut body: Value) -> Result<Value, StoreError> {
    let obj = body.as_object_mut().ok_or(StoreError::BODY)?;
    if let Some(meta) = obj.get_mut("meta").and_then(Value::as_object_mut) {
        meta.insert("formatVersion".into(), "0.3".into());
    }
    Ok(body)
}

/// 0.3 → 0.4: 足した欄はどれも任意なので足さない（評価・売却・その他の資産が無い世帯は、今までどおりの計算）。形式の版だけを書き換える
fn v0_3_to_0_4(mut body: Value) -> Result<Value, StoreError> {
    let obj = body.as_object_mut().ok_or(StoreError::BODY)?;
    if let Some(meta) = obj.get_mut("meta").and_then(Value::as_object_mut) {
        meta.insert("formatVersion".into(), "0.4".into());
    }
    Ok(body)
}

/// 0.4 → 0.5: 足した欄はどれも任意なので足さない。積立の終わり・iDeCo の受け取りの始まりが空の値は、空のまま新しい読み方
/// （退職の月まで・退職の年に受け取る。推定）で読む（0026）。形式の版だけを書き換える
fn v0_4_to_0_5(mut body: Value) -> Result<Value, StoreError> {
    let obj = body.as_object_mut().ok_or(StoreError::BODY)?;
    if let Some(meta) = obj.get_mut("meta").and_then(Value::as_object_mut) {
        meta.insert("formatVersion".into(), "0.5".into());
    }
    Ok(body)
}

/// 0.5 → 0.6: 足した欄（不動産の中身・不動産のローンの指定）はどれも任意なので足さない（中身の無い不動産の器は今までどおりの計算）。
/// 形式の版だけを書き換える（0028）
fn v0_5_to_0_6(mut body: Value) -> Result<Value, StoreError> {
    let obj = body.as_object_mut().ok_or(StoreError::BODY)?;
    if let Some(meta) = obj.get_mut("meta").and_then(Value::as_object_mut) {
        meta.insert("formatVersion".into(), "0.6".into());
    }
    Ok(body)
}

/// 0.6 → 0.7: 足した欄（並べる時点の既定・この世帯で選んだ時点）はどちらも任意なので足さない（無ければ既定の 今・退職の年・75歳）。
/// 形式の版だけを書き換える（0027 の追記）
fn v0_6_to_0_7(mut body: Value) -> Result<Value, StoreError> {
    let obj = body.as_object_mut().ok_or(StoreError::BODY)?;
    if let Some(meta) = obj.get_mut("meta").and_then(Value::as_object_mut) {
        meta.insert("formatVersion".into(), "0.7".into());
    }
    Ok(body)
}

/// 表示の設定の直下の欄のうち、結果のタブの区画へ移すもの（名前は変えない）
const RESULT_KEYS: &[&str] = &["metrics", "atAge", "layout", "invBreakdown", "invPeriods"];
/// 資産と負債のタブの区画へ移すもの（前の名前 → 区画の中の名前）
const BALANCE_KEYS: &[(&str, &str)] = &[
    ("bsGuide", "guide"),
    ("bsPoints", "points"),
    ("bsColumns", "columns"),
];

/// 0.7 → 0.8: 表示の設定を、タブごとの区画（`display.result`・`display.balance`）へ移す。なくした `display.dock` は捨てる。
/// 区画へ移す欄のほか（知らない欄）は、そのまま直下に残す（失わない）。表示の設定の無い本文には足さない（画面が既定で読む）
fn v0_7_to_0_8(mut body: Value) -> Result<Value, StoreError> {
    let obj = body.as_object_mut().ok_or(StoreError::BODY)?;
    if let Some(display) = obj.get_mut("display").and_then(Value::as_object_mut) {
        if !display.contains_key("result") && !display.contains_key("balance") {
            let mut result = serde_json::Map::new();
            for k in RESULT_KEYS {
                if let Some(v) = display.remove(*k) {
                    result.insert((*k).into(), v);
                }
            }
            let mut balance = serde_json::Map::new();
            for (from, to) in BALANCE_KEYS {
                if let Some(v) = display.remove(*from) {
                    balance.insert((*to).into(), v);
                }
            }
            display.insert("result".into(), Value::Object(result));
            display.insert("balance".into(), Value::Object(balance));
        }
        display.remove("dock");
    }
    if let Some(meta) = obj.get_mut("meta").and_then(Value::as_object_mut) {
        meta.insert("formatVersion".into(), "0.8".into());
    }
    Ok(body)
}

/// 0.8 → 0.9: 足した欄（保育の時間・自治体の水準の割合・給食費）はどれも任意なので足さない。保育所の段の空の月額は書き換えず、
/// 新しい読み方（収入から自動で計算）で読む。形式の版だけを書き換える（0029）
fn v0_8_to_0_9(mut body: Value) -> Result<Value, StoreError> {
    let obj = body.as_object_mut().ok_or(StoreError::BODY)?;
    if let Some(meta) = obj.get_mut("meta").and_then(Value::as_object_mut) {
        meta.insert("formatVersion".into(), "0.9".into());
    }
    Ok(body)
}

/// 開き方
/// 0.9 → 0.10: 足した欄（控えのきっかけ takeaway とその記録）は任意なので足さない。形式の版だけを書き換える（0030）
fn v0_9_to_0_10(mut body: Value) -> Result<Value, StoreError> {
    let obj = body.as_object_mut().ok_or(StoreError::BODY)?;
    if let Some(meta) = obj.get_mut("meta").and_then(Value::as_object_mut) {
        meta.insert("formatVersion".into(), "0.10".into());
    }
    Ok(body)
}

/// 0.10 → 0.11: 足した欄（黒字のうち貯まる割合・生活防衛資金・運用しない分）はどれも任意なので足さない。形式の版だけを書き換える（0031）
fn v0_10_to_0_11(mut body: Value) -> Result<Value, StoreError> {
    let obj = body.as_object_mut().ok_or(StoreError::BODY)?;
    if let Some(meta) = obj.get_mut("meta").and_then(Value::as_object_mut) {
        meta.insert("formatVersion".into(), "0.11".into());
    }
    Ok(body)
}

/// なくした生活防衛資金の前提の入力項目ID・動かす項目のキー（0031 の追記）
const REMOVED_RESERVE_ITEM: &str = "assumptions.emergencyReserve";
const REMOVED_RESERVE_KEY: &str = "reserve:months";

/// 0.11 → 0.12: なくした生活防衛資金を捨てる（0031 の追記）。現状の前提 `household.request.input.assumptions.emergencyReserve`、
/// プランの差分のうちその前提を動かすもの（入力項目が `assumptions.emergencyReserve` か、キーが `reserve:months`）、
/// 対策に足した項目（`workspace.shownItems`）の `reserve:months`。控え（`snapshots`）の中身は変えない（画面が計算するときに無視する）
fn v0_11_to_0_12(mut body: Value) -> Result<Value, StoreError> {
    let obj = body.as_object_mut().ok_or(StoreError::BODY)?;
    if let Some(a) = obj
        .get_mut("household")
        .and_then(|h| h.get_mut("request"))
        .and_then(|r| r.get_mut("input"))
        .and_then(|i| i.get_mut("assumptions"))
        .and_then(Value::as_object_mut)
    {
        a.remove("emergencyReserve");
    }
    if let Some(list) = obj.get_mut("proposals").and_then(Value::as_array_mut) {
        for p in list {
            if let Some(diffs) = p.get_mut("diffs").and_then(Value::as_array_mut) {
                diffs.retain(|d| {
                    d.get("item").and_then(Value::as_str) != Some(REMOVED_RESERVE_ITEM)
                        && d.get("key").and_then(Value::as_str) != Some(REMOVED_RESERVE_KEY)
                });
            }
        }
    }
    if let Some(shown) = obj
        .get_mut("workspace")
        .and_then(|w| w.get_mut("shownItems"))
        .and_then(Value::as_array_mut)
    {
        shown.retain(|k| k.as_str() != Some(REMOVED_RESERVE_KEY));
    }
    if let Some(meta) = obj.get_mut("meta").and_then(Value::as_object_mut) {
        meta.insert("formatVersion".into(), "0.12".into());
    }
    Ok(body)
}

/// 0.12 → 0.13: 足した欄（お金の3つの分け方の表示の設定）は任意なので足さない。形式の版だけを書き換える（0032）
fn v0_12_to_0_13(mut body: Value) -> Result<Value, StoreError> {
    let obj = body.as_object_mut().ok_or(StoreError::BODY)?;
    if let Some(meta) = obj.get_mut("meta").and_then(Value::as_object_mut) {
        meta.insert("formatVersion".into(), "0.13".into());
    }
    Ok(body)
}

/// 0.13 → 0.14: 足した区画（明細の取り込みの記録 `statements`）は任意なので足さない。形式の版だけを書き換える（0034）
fn v0_13_to_0_14(mut body: Value) -> Result<Value, StoreError> {
    let obj = body.as_object_mut().ok_or(StoreError::BODY)?;
    if let Some(meta) = obj.get_mut("meta").and_then(Value::as_object_mut) {
        meta.insert("formatVersion".into(), "0.14".into());
    }
    Ok(body)
}

/// 0.14 → 0.15: 足した欄（確認シートの依頼の記録 `statements.requests`）は任意なので足さない。形式の版だけを書き換える（0034 の9）
fn v0_14_to_0_15(mut body: Value) -> Result<Value, StoreError> {
    let obj = body.as_object_mut().ok_or(StoreError::BODY)?;
    if let Some(meta) = obj.get_mut("meta").and_then(Value::as_object_mut) {
        meta.insert("formatVersion".into(), "0.15".into());
    }
    Ok(body)
}

/// 0.15 → 0.16: 0.15 の依頼の記録は番号ごとに1行なので、そのまま 0.16 の形として読める。形式の版だけを書き換える（0034 の9）
fn v0_15_to_0_16(mut body: Value) -> Result<Value, StoreError> {
    let obj = body.as_object_mut().ok_or(StoreError::BODY)?;
    if let Some(meta) = obj.get_mut("meta").and_then(Value::as_object_mut) {
        meta.insert("formatVersion".into(), "0.16".into());
    }
    Ok(body)
}

/// 0.17 → 0.18: 足した欄（段階・例外の年・器の利回りの段階・資産配分の段階・期間ごとの伸び）は任意なので足さない。
/// 形式の版だけを書き換える（0040）
fn v0_17_to_0_18(mut body: Value) -> Result<Value, StoreError> {
    let obj = body.as_object_mut().ok_or(StoreError::BODY)?;
    if let Some(meta) = obj.get_mut("meta").and_then(Value::as_object_mut) {
        meta.insert("formatVersion".into(), "0.18".into());
    }
    Ok(body)
}

/// 0.18 → 0.19: 足した欄（世帯の外の家族のお金 `members[].wallet`。0042）は任意なので足さない。形式の版だけを書き換える
fn v0_18_to_0_19(mut body: Value) -> Result<Value, StoreError> {
    let obj = body.as_object_mut().ok_or(StoreError::BODY)?;
    if let Some(meta) = obj.get_mut("meta").and_then(Value::as_object_mut) {
        meta.insert("formatVersion".into(), "0.19".into());
    }
    Ok(body)
}

/// 0.19 → 0.20: 足した欄（お金の行。0044）は任意なので足さない。形式の版だけを書き換える
fn v0_19_to_0_20(mut body: Value) -> Result<Value, StoreError> {
    let obj = body.as_object_mut().ok_or(StoreError::BODY)?;
    if let Some(meta) = obj.get_mut("meta").and_then(Value::as_object_mut) {
        meta.insert("formatVersion".into(), "0.20".into());
    }
    Ok(body)
}

/// 0.20 → 0.21: 足した欄（住まいの建て方・譲渡所得の税の額・負債の名前と種類の細目・ローンの入れ方の区分。0052・0053）は任意なので
/// 足さない。形式の版だけを書き換える
fn v0_20_to_0_21(mut body: Value) -> Result<Value, StoreError> {
    let obj = body.as_object_mut().ok_or(StoreError::BODY)?;
    if let Some(meta) = obj.get_mut("meta").and_then(Value::as_object_mut) {
        meta.insert("formatVersion".into(), "0.21".into());
    }
    Ok(body)
}

/// 0.21 → 0.22: 足した欄（退職給付の名前と学歴。0057）は任意なので足さない。形式の版だけを書き換える
fn v0_21_to_0_22(mut body: Value) -> Result<Value, StoreError> {
    let obj = body.as_object_mut().ok_or(StoreError::BODY)?;
    if let Some(meta) = obj.get_mut("meta").and_then(Value::as_object_mut) {
        meta.insert("formatVersion".into(), "0.22".into());
    }
    Ok(body)
}

/// 0.22 → 0.23: 足した欄（教育の目標の学校外の費用の入れ方・塾・習い事の行の種類。0063）は任意なので足さない。
/// 入れ方の無い目標は前の形（統計の平均に行を足す）で計算するので、黙って書き換えない。形式の版だけを書き換える
fn v0_22_to_0_23(mut body: Value) -> Result<Value, StoreError> {
    let obj = body.as_object_mut().ok_or(StoreError::BODY)?;
    if let Some(meta) = obj.get_mut("meta").and_then(Value::as_object_mut) {
        meta.insert("formatVersion".into(), "0.23".into());
    }
    Ok(body)
}

/// 0.23 → 0.24: 足した欄（相続税の目安の設定・遺したい額。0060・0061）は任意なので足さない。形式の版だけを書き換える
fn v0_23_to_0_24(mut body: Value) -> Result<Value, StoreError> {
    let obj = body.as_object_mut().ok_or(StoreError::BODY)?;
    if let Some(meta) = obj.get_mut("meta").and_then(Value::as_object_mut) {
        meta.insert("formatVersion".into(), "0.24".into());
    }
    Ok(body)
}

/// 0.24 → 0.25: 足した欄（保険の種類の細目と名前・保障の行の被保険者と限度日数・円の目安の形・病気の想定。0054・0055）は任意なので
/// 足さない。形式の版だけを書き換える
fn v0_24_to_0_25(mut body: Value) -> Result<Value, StoreError> {
    let obj = body.as_object_mut().ok_or(StoreError::BODY)?;
    if let Some(meta) = obj.get_mut("meta").and_then(Value::as_object_mut) {
        meta.insert("formatVersion".into(), "0.25".into());
    }
    Ok(body)
}

/// 0.25 → 0.26: 足した欄（車の維持費の入れ方と内訳の名前つきの行。0069）は任意なので足さない。形式の版だけを書き換える
fn v0_25_to_0_26(mut body: Value) -> Result<Value, StoreError> {
    let obj = body.as_object_mut().ok_or(StoreError::BODY)?;
    if let Some(meta) = obj.get_mut("meta").and_then(Value::as_object_mut) {
        meta.insert("formatVersion".into(), "0.26".into());
    }
    Ok(body)
}

/// 0.26 → 0.27: 足した欄（万一の前提の任意の欄・確かめた記録。0070・0071）は任意なので足さない。形式の版だけを書き換える
fn v0_26_to_0_27(mut body: Value) -> Result<Value, StoreError> {
    let obj = body.as_object_mut().ok_or(StoreError::BODY)?;
    if let Some(meta) = obj.get_mut("meta").and_then(Value::as_object_mut) {
        meta.insert("formatVersion".into(), "0.27".into());
    }
    Ok(body)
}

/// 0.27 → 0.28: 足した欄（受給中の遺族年金・障害年金の種類・残した年金の記録。0066・0067）は任意なので足さない。形式の版だけを書き換える
fn v0_27_to_0_28(mut body: Value) -> Result<Value, StoreError> {
    let obj = body.as_object_mut().ok_or(StoreError::BODY)?;
    if let Some(meta) = obj.get_mut("meta").and_then(Value::as_object_mut) {
        meta.insert("formatVersion".into(), "0.28".into());
    }
    Ok(body)
}

/// 0.28 → 0.29: 足した欄（次回確かめるの印。0072）は任意なので足さない。形式の版だけを書き換える
fn v0_28_to_0_29(mut body: Value) -> Result<Value, StoreError> {
    let obj = body.as_object_mut().ok_or(StoreError::BODY)?;
    if let Some(meta) = obj.get_mut("meta").and_then(Value::as_object_mut) {
        meta.insert("formatVersion".into(), "0.29".into());
    }
    Ok(body)
}

/// 0.29 → 0.30: 足した欄（推計の区分の受け取り開始。0078）は任意なので足さない。形式の版だけを書き換える
fn v0_29_to_0_30(mut body: Value) -> Result<Value, StoreError> {
    let obj = body.as_object_mut().ok_or(StoreError::BODY)?;
    if let Some(meta) = obj.get_mut("meta").and_then(Value::as_object_mut) {
        meta.insert("formatVersion".into(), "0.30".into());
    }
    Ok(body)
}

/// 0.30 → 0.31: 足した欄（収益不動産の物件を見分ける欄。0079）は任意なので足さない。形式の版だけを書き換える
fn v0_30_to_0_31(mut body: Value) -> Result<Value, StoreError> {
    let obj = body.as_object_mut().ok_or(StoreError::BODY)?;
    if let Some(meta) = obj.get_mut("meta").and_then(Value::as_object_mut) {
        meta.insert("formatVersion".into(), "0.31".into());
    }
    Ok(body)
}

/// 0.31 → 0.32: 足した欄（収益不動産のお金の欄。0080）は任意なので足さない。形式の版だけを書き換える
fn v0_31_to_0_32(mut body: Value) -> Result<Value, StoreError> {
    let obj = body.as_object_mut().ok_or(StoreError::BODY)?;
    if let Some(meta) = obj.get_mut("meta").and_then(Value::as_object_mut) {
        meta.insert("formatVersion".into(), "0.32".into());
    }
    Ok(body)
}

/// 0.32 → 0.33: 足した欄（収益不動産の税と出口・申告の仕方。0081）は任意なので足さない。形式の版だけを書き換える
fn v0_32_to_0_33(mut body: Value) -> Result<Value, StoreError> {
    let obj = body.as_object_mut().ok_or(StoreError::BODY)?;
    if let Some(meta) = obj.get_mut("meta").and_then(Value::as_object_mut) {
        meta.insert("formatVersion".into(), "0.33".into());
    }
    Ok(body)
}

/// 0.33 → 0.34: 足した欄（入力項目の選び方。0083）は任意なので足さない。形式の版だけを書き換える
fn v0_33_to_0_34(mut body: Value) -> Result<Value, StoreError> {
    let obj = body.as_object_mut().ok_or(StoreError::BODY)?;
    if let Some(meta) = obj.get_mut("meta").and_then(Value::as_object_mut) {
        meta.insert("formatVersion".into(), "0.34".into());
    }
    Ok(body)
}

/// 0.34 → 0.35: 足した欄（確かめの注意の「確認した」の印。0041・0055）は任意なので足さない。形式の版だけを書き換える
fn v0_34_to_0_35(mut body: Value) -> Result<Value, StoreError> {
    let obj = body.as_object_mut().ok_or(StoreError::BODY)?;
    if let Some(meta) = obj.get_mut("meta").and_then(Value::as_object_mut) {
        meta.insert("formatVersion".into(), "0.35".into());
    }
    Ok(body)
}

/// 0.35 → 0.36: 足した欄（就業不能・収入が減るの場面の配偶者の働き方。0085）は任意なので足さない。形式の版だけを書き換える
fn v0_35_to_0_36(mut body: Value) -> Result<Value, StoreError> {
    let obj = body.as_object_mut().ok_or(StoreError::BODY)?;
    if let Some(meta) = obj.get_mut("meta").and_then(Value::as_object_mut) {
        meta.insert("formatVersion".into(), "0.36".into());
    }
    Ok(body)
}

/// 0.36 → 0.37: 足した値（入るお金の行の表の行「雑所得」。0086）は選べる値が増えただけで、前の版の行は書き換えない。形式の版だけを書き換える
fn v0_36_to_0_37(mut body: Value) -> Result<Value, StoreError> {
    let obj = body.as_object_mut().ok_or(StoreError::BODY)?;
    if let Some(meta) = obj.get_mut("meta").and_then(Value::as_object_mut) {
        meta.insert("formatVersion".into(), "0.37".into());
    }
    Ok(body)
}

/// 標準報酬月額の入力項目ID と、働き方の期間の欄の名前
const SMR_ITEM: &str = "employment.standardMonthlyRemuneration";
const SMR_ITEM_FIELD: &str = "standardMonthlyRemuneration";

/// 標準報酬月額の片方の箱が FP の入れた値でない: 推定のまま（出どころ auto）か、わからないの代わりの値が給与からの推定（出し方 derived）のまま
fn smr_not_entered(b: Option<&Value>) -> bool {
    let Some(b) = b.filter(|b| !b.is_null()) else {
        return true;
    };
    match b.get("state").and_then(Value::as_str) {
        Some("estimated") => b["origin"]["kind"] == "auto",
        Some("unknown") => {
            b["substitute"]["origin"]["kind"] == "auto"
                && b["substitute"]["estimate"]["method"] == "derived"
        }
        _ => false,
    }
}

/// 置き換え口が給与からの推定のまま（健康保険・厚生年金の両方が FP の入れた値でない）か
fn smr_auto(smr: &Value) -> bool {
    smr.is_object() && smr_not_entered(smr.get("health")) && smr_not_entered(smr.get("pension"))
}

/// 箱の数（わからないは代わりの値）
fn box_number(b: &Value) -> Option<f64> {
    b.get("value")
        .and_then(Value::as_f64)
        .or_else(|| b["substitute"]["value"].as_f64())
}

/// 働き方の期間から、推定のままの標準報酬月額の置き換え口を外す。外したら、その期間の厚生年金の額（定年後の予定と比べる）を返す
fn drop_auto_smr(period: &mut Value) -> Option<Option<f64>> {
    let p = period.as_object_mut()?;
    if !p.get(SMR_ITEM_FIELD).is_some_and(smr_auto) {
        return None;
    }
    let smr = p.remove(SMR_ITEM_FIELD)?;
    Some(box_number(&smr["pension"]))
}

/// 0.37 → 0.38: 給与からの推定のままの標準報酬月額の置き換え口を外す（0047 の追記 2026-10-29 の2）。
/// - 現状の働き方の期間 `household.request.input.household.employmentPeriods[]`: 健康保険・厚生年金の両方が FP の入れた値でない置き換え口を外す
///   （片方を FP が入れ、もう片方をその額から推定した置き換え口は FP の値なので残す）
/// - 定年後の予定 `household.postRetirement[構成員].standardMonthlyRemuneration`: 外した期間の厚生年金の額を写したもの（前の画面が推定を写していた）なら外す
/// - プランの差分: 足す物（働き方の期間）の中の置き換え口は同じ決まりで外す。標準報酬月額を書く差分のうち、値が FP の入れた値でないもの
///   （置き換え口の全体なら推定のまま）で、向き先が外した期間か現状に無い期間のものは捨てる（その期間は給与から計算する）
/// - 控え（`snapshots`）・ヒアリングの記録の中身は変えない
/// - 外した物があれば、開いたときの知らせ `{"kind": "smrBlank", "count": 現状の期間の数, "plans": プランの差分を変えた数}` を足す
fn v0_37_to_0_38(mut body: Value) -> Result<Value, StoreError> {
    let obj = body.as_object_mut().ok_or(StoreError::BODY)?;
    let mut cleared: Vec<String> = Vec::new();
    let mut present: Vec<String> = Vec::new();
    let mut pension: Vec<(String, f64)> = Vec::new();
    if let Some(list) = obj
        .get_mut("household")
        .and_then(|h| h.get_mut("request"))
        .and_then(|r| r.get_mut("input"))
        .and_then(|i| i.get_mut("household"))
        .and_then(|h| h.get_mut("employmentPeriods"))
        .and_then(Value::as_array_mut)
    {
        for p in list {
            let id = p
                .get("id")
                .and_then(Value::as_str)
                .unwrap_or("")
                .to_string();
            let member = p
                .get("member")
                .and_then(Value::as_str)
                .unwrap_or("")
                .to_string();
            present.push(id.clone());
            if let Some(v) = drop_auto_smr(p) {
                cleared.push(id);
                if let Some(v) = v {
                    pension.push((member, v));
                }
            }
        }
    }
    if let Some(post) = obj
        .get_mut("household")
        .and_then(|h| h.get_mut("postRetirement"))
        .and_then(Value::as_object_mut)
    {
        for (member, p) in post.iter_mut() {
            let Some(p) = p.as_object_mut() else { continue };
            let v = p.get(SMR_ITEM_FIELD).and_then(Value::as_f64);
            if v.is_some_and(|v| pension.iter().any(|(m, x)| m == member && *x == v)) {
                p.remove(SMR_ITEM_FIELD);
            }
        }
    }
    let mut changed = 0usize;
    if let Some(list) = obj.get_mut("proposals").and_then(Value::as_array_mut) {
        for plan in list {
            let Some(diffs) = plan.get_mut("diffs").and_then(Value::as_array_mut) else {
                continue;
            };
            for d in diffs.iter_mut() {
                if d.get("op").and_then(Value::as_str) == Some("add")
                    && d["target"]["collection"] == "employment"
                    && d.get_mut("value").and_then(drop_auto_smr).is_some()
                {
                    changed += 1;
                }
            }
            let before = diffs.len();
            diffs.retain(|d| {
                if d.get("op").and_then(Value::as_str) != Some("set")
                    || d.get("item").and_then(Value::as_str) != Some(SMR_ITEM)
                {
                    return true;
                }
                let at: Vec<&str> = d
                    .get("at")
                    .and_then(Value::as_array)
                    .map(|a| a.iter().filter_map(Value::as_str).collect())
                    .unwrap_or_default();
                let auto = match at.as_slice() {
                    [] => smr_auto(&d["value"]),
                    ["health"] | ["pension"] => smr_not_entered(d.get("value")),
                    _ => false,
                };
                let target = d["target"]["object"].as_str().unwrap_or("");
                !(auto
                    && (cleared.iter().any(|x| x == target)
                        || !present.iter().any(|x| x == target)))
            });
            changed += before - diffs.len();
        }
    }
    if !cleared.is_empty() || changed > 0 {
        if let Some(screen) = obj.get_mut("household").and_then(Value::as_object_mut) {
            let list = screen
                .entry("notices")
                .or_insert_with(|| Value::Array(Vec::new()));
            if let Some(list) = list.as_array_mut() {
                list.push(serde_json::json!({
                    "id": readings::migration_id(&format!("notices/smrBlank/{}/{changed}", cleared.join("/"))),
                    "kind": "smrBlank",
                    "count": cleared.len(),
                    "plans": changed,
                }));
            }
        }
    }
    if let Some(meta) = obj.get_mut("meta").and_then(Value::as_object_mut) {
        meta.insert("formatVersion".into(), "0.38".into());
    }
    Ok(body)
}

/// 0.38 → 0.39: 足した欄（教育の段の給食費の選び方・部活動などの費用・保育料とは別にかかるお金。0062・0029 の追記 2026-10-30）は任意なので足さない。
/// 形式の版だけを書き換える
fn v0_38_to_0_39(mut body: Value) -> Result<Value, StoreError> {
    let obj = body.as_object_mut().ok_or(StoreError::BODY)?;
    if let Some(meta) = obj.get_mut("meta").and_then(Value::as_object_mut) {
        meta.insert("formatVersion".into(), "0.39".into());
    }
    Ok(body)
}

/// 0.39 → 0.40: 足した欄（教育の目標の留学。0088）は任意なので足さない。前の版の出るお金の行の留学は書き換えない。形式の版だけを書き換える
fn v0_39_to_0_40(mut body: Value) -> Result<Value, StoreError> {
    let obj = body.as_object_mut().ok_or(StoreError::BODY)?;
    if let Some(meta) = obj.get_mut("meta").and_then(Value::as_object_mut) {
        meta.insert("formatVersion".into(), "0.40".into());
    }
    Ok(body)
}

/// 0.40 → 0.41: 足した値（大学院の段・インターナショナルスクール。0089）は選べる値が増えただけで、前の版の段は書き換えない。形式の版だけを書き換える
fn v0_40_to_0_41(mut body: Value) -> Result<Value, StoreError> {
    let obj = body.as_object_mut().ok_or(StoreError::BODY)?;
    if let Some(meta) = obj.get_mut("meta").and_then(Value::as_object_mut) {
        meta.insert("formatVersion".into(), "0.41".into());
    }
    Ok(body)
}

/// 0.41 → 0.42: 足した値（高専・専門職大学院の段・法科大学院の系統。0090）は選べる値が増えただけで、前の版の段は書き換えない。形式の版だけを書き換える
fn v0_41_to_0_42(mut body: Value) -> Result<Value, StoreError> {
    let obj = body.as_object_mut().ok_or(StoreError::BODY)?;
    if let Some(meta) = obj.get_mut("meta").and_then(Value::as_object_mut) {
        meta.insert("formatVersion".into(), "0.42".into());
    }
    Ok(body)
}

/// わからないにしたとき、前に入っていた確定の値を代わりにした印（画面の valueState.ts の PREVIOUS_VALUE と同じ）
const PREVIOUS_VALUE: &str = "前に入っていた値を代わりに使う";

/// 基本生活費の「わからない」の値の箱を推定の箱にする（0100）。変えたら true
/// - 代わりの値が自動の推定（統計・按分・ひな形の目安）なら、その推定の箱にする（値は同じ。推定の入れ直しの対象になる）
/// - 代わりの値が FP の入れた値（前に入っていた値・自動でない値）なら、その値のまま推定の印を付ける（出どころ manual。入れ直さないので結果は黙って変わらない）
fn living_unknown_box(b: &mut Value) -> bool {
    let Some(o) = b.as_object() else {
        return false;
    };
    if o.get("state").and_then(Value::as_str) != Some("unknown") {
        return false;
    }
    let Some(sub) = o.get("substitute").filter(|s| s.is_object()) else {
        return false;
    };
    let Some(value) = sub.get("value").filter(|v| !v.is_null()).cloned() else {
        return false;
    };
    let method = sub["estimate"]["method"]
        .as_str()
        .unwrap_or("standard")
        .to_string();
    let basis = sub["estimate"]["basis"].as_str().unwrap_or("").to_string();
    let auto = sub["origin"]["kind"] == "auto" && basis != PREVIOUS_VALUE && !basis.is_empty();
    let approval = o.get("approval").cloned();
    let mut next = if auto {
        let mut s = sub.clone();
        s["state"] = "estimated".into();
        s
    } else {
        let note = if basis.is_empty() || basis == PREVIOUS_VALUE {
            "「わからない」の代わりに使っていた値（前に入っていた値）".to_string()
        } else {
            format!("「わからない」の代わりに使っていた値（{basis}）")
        };
        serde_json::json!({
            "value": value,
            "state": "estimated",
            "origin": {"kind": "manual"},
            "estimate": {"method": method, "basis": note},
        })
    };
    // 承認の記録（ヒアリングの候補を承認した物）は残す
    if let (Some(a), Some(n)) = (approval, next.as_object_mut()) {
        n.insert("approval".into(), a);
    }
    *b = next;
    true
}

/// 物の中の「わからない」をすべて推定にする（値の箱は living_unknown_box、値の状態の行〔valueStates〕は状態だけを推定に）。変えた数を返す
fn living_unknowns_in(v: &mut Value) -> usize {
    let mut n = 0;
    match v {
        Value::Object(o) => {
            if let Some(states) = o.get_mut("valueStates").and_then(Value::as_object_mut) {
                for row in states.values_mut() {
                    if row.get("state").and_then(Value::as_str) == Some("unknown") {
                        row["state"] = "estimated".into();
                        n += 1;
                    }
                }
            }
            for (k, x) in o.iter_mut() {
                if k == "valueStates" {
                    continue;
                }
                if living_unknown_box(x) {
                    n += 1;
                } else {
                    n += living_unknowns_in(x);
                }
            }
        }
        Value::Array(a) => {
            for x in a {
                if living_unknown_box(x) {
                    n += 1;
                } else {
                    n += living_unknowns_in(x);
                }
            }
        }
        _ => {}
    }
    n
}

/// プランの差分の値（箱、または箱でない値の状態つきの形）の「わからない」を推定にする。変えたら true
fn living_unknown_diff_value(v: &mut Value) -> bool {
    if living_unknown_box(v) {
        return true;
    }
    // 箱でない値（段の割合など）の差分の値: 値と状態の行を1つにした形。代わりの値は無く、根拠は estimate に持つ
    if v.get("state").and_then(Value::as_str) == Some("unknown") && v.get("substitute").is_none() {
        v["state"] = "estimated".into();
        return true;
    }
    false
}

/// 内訳の束の合計の合成の対策（0048 の2。束は 0100 でなくした）: 束の名前 → 差を置く代表の内訳と、束のほかの内訳
const LIVING_BUNDLES: &[(&str, &str, &[&str])] = &[
    ("livingGroupDaily", "furniture", &["clothing"]),
    (
        "livingGroupMisc",
        "otherConsumption",
        &["health", "allowance"],
    ),
];

/// 束の合計を動かしたプランの差分を、代表の内訳の月額の差分にする（束の直し方と同じ: 代表＝束の合計−ほかの内訳の今の値。ほかの内訳は現状の値で数える）。
/// 代表の内訳が現状に無いときは変えない（プランの一覧の「要確認」に読み替えられない差分として出る）
fn living_bundle_diff(d: &mut Value, livings: &[Value]) -> bool {
    let Some(lever) = d["target"]["lever"].as_str() else {
        return false;
    };
    let Some((_, rep, others)) = LIVING_BUNDLES.iter().find(|(k, _, _)| *k == lever) else {
        return false;
    };
    let Some(object) = d["target"]["object"].as_str().map(str::to_string) else {
        return false;
    };
    let Some(l) = livings.iter().find(|l| l["id"] == object.as_str()) else {
        return false;
    };
    let cats: Vec<&Value> = l["categories"]
        .as_array()
        .map(|a| a.iter().collect())
        .unwrap_or_default();
    let Some(rep_el) = cats.iter().find(|c| c["category"] == *rep) else {
        return false;
    };
    let Some(rep_id) = rep_el["id"].as_str() else {
        return false;
    };
    let mut value = d["value"].clone();
    living_unknown_box(&mut value);
    let Some(total) = value.get("value").and_then(Value::as_f64) else {
        return false;
    };
    let rest: f64 = cats
        .iter()
        .filter(|c| others.iter().any(|o| c["category"] == *o))
        .filter_map(|c| box_number(&c["monthly"]))
        .sum();
    // 円の金額（整数）
    value["value"] = Value::from((total - rest).max(0.0).round() as i64);
    d["target"] = serde_json::json!({ "object": object });
    d["item"] = "livingExpense.categories".into();
    d["at"] = serde_json::json!([rep_id, "monthly"]);
    d["value"] = value;
    d["before"] = rep_el["monthly"].clone();
    true
}

/// 0.42 → 0.43: 基本生活費の内訳の分け直し（0100）。
/// - 内訳に足した値（通信費・交通費・こづかいと交際費・その他）は選べる値が増えただけ。前の版の内訳（交通・通信・その他の消費）は書き換えない
/// - 基本生活費の物（`livingExpenses[]`）と、年払い・数年おきの暮らしの支出（`periodicExpenses[]` の種類 `livingAnnual`）の中の「わからない」を推定にする
///   （値の箱は living_unknown_box、値の状態の行は状態だけを推定に。値は変えない）
/// - プランの差分: 基本生活費の入力項目（`livingExpense.*`）・livingAnnual の行を向き先にする差分の値と前の値、足す物の中の「わからない」も同じく推定にする。
///   束の合計の合成の対策（`livingGroupDaily`・`livingGroupMisc`）は代表の内訳の差分にする
/// - 控え（`snapshots`）・ヒアリングの記録の中身は変えない
/// - 「わからない」を推定にした物があれば、開いたときの知らせ `{"kind": "livingUnknown", "count": 現状で変えた数, "plans": プランの差分を変えた数}` を足す
fn v0_42_to_0_43(mut body: Value) -> Result<Value, StoreError> {
    let obj = body.as_object_mut().ok_or(StoreError::BODY)?;
    let mut count = 0usize;
    let mut annual: Vec<String> = Vec::new();
    let mut livings: Vec<Value> = Vec::new();
    if let Some(h) = obj
        .get_mut("household")
        .and_then(|h| h.get_mut("request"))
        .and_then(|r| r.get_mut("input"))
        .and_then(|i| i.get_mut("household"))
        .and_then(Value::as_object_mut)
    {
        if let Some(list) = h.get_mut("livingExpenses").and_then(Value::as_array_mut) {
            for l in list.iter_mut() {
                count += living_unknowns_in(l);
            }
            livings = list.clone();
        }
        if let Some(list) = h.get_mut("periodicExpenses").and_then(Value::as_array_mut) {
            for p in list.iter_mut().filter(|p| p["kind"] == "livingAnnual") {
                if let Some(id) = p["id"].as_str() {
                    annual.push(id.to_string());
                }
                count += living_unknowns_in(p);
            }
        }
    }
    let mut plans = 0usize;
    if let Some(list) = obj.get_mut("proposals").and_then(Value::as_array_mut) {
        for plan in list {
            let Some(diffs) = plan.get_mut("diffs").and_then(Value::as_array_mut) else {
                continue;
            };
            // このプランで足した年払いの行も向き先に数える
            let mut rows = annual.clone();
            for d in diffs.iter() {
                if d["op"] == "add"
                    && d["target"]["collection"] == "periodicExpense"
                    && d["value"]["kind"] == "livingAnnual"
                {
                    if let Some(id) = d["value"]["id"].as_str() {
                        rows.push(id.to_string());
                    }
                }
            }
            for d in diffs.iter_mut() {
                let item = d["item"].as_str().unwrap_or("").to_string();
                let target = d["target"]["object"].as_str().unwrap_or("").to_string();
                let op = d["op"].as_str().unwrap_or("").to_string();
                let mut changed = false;
                if living_bundle_diff(d, &livings) {
                    // 束の合計の差分は値の意味が変わらない（代表の内訳に置き直しただけ）ので、知らせの数には入れない
                    continue;
                }
                let living = item.starts_with("livingExpense.")
                    || (item.starts_with("periodicExpense.") && rows.contains(&target));
                if op == "add" {
                    let added = (d["target"]["collection"] == "livingExpense")
                        || (d["target"]["collection"] == "periodicExpense"
                            && d["value"]["kind"] == "livingAnnual")
                        || living;
                    if added
                        && d.get_mut("value")
                            .is_some_and(|v| living_unknowns_in(v) > 0 || living_unknown_box(v))
                    {
                        changed = true;
                    }
                } else if op == "set" && living {
                    for k in ["value", "before"] {
                        if d.get_mut(k).is_some_and(living_unknown_diff_value) && k == "value" {
                            changed = true;
                        }
                    }
                }
                if changed {
                    plans += 1;
                }
            }
        }
    }
    if count > 0 || plans > 0 {
        if let Some(screen) = obj.get_mut("household").and_then(Value::as_object_mut) {
            let list = screen
                .entry("notices")
                .or_insert_with(|| Value::Array(Vec::new()));
            if let Some(list) = list.as_array_mut() {
                list.push(serde_json::json!({
                    "id": readings::migration_id(&format!("notices/livingUnknown/{count}/{plans}")),
                    "kind": "livingUnknown",
                    "count": count,
                    "plans": plans,
                }));
            }
        }
    }
    if let Some(meta) = obj.get_mut("meta").and_then(Value::as_object_mut) {
        meta.insert("formatVersion".into(), "0.43".into());
    }
    Ok(body)
}

/// 「書類で確かめる」（前の「わからない」）を残す欄か（0041 の追記 2026-10-31）。並び（`coll`）・物・物の中の値の箱の場所（`path`）か
/// 値の状態の行の鍵（`row`）で決める。残すのは、書類から写す値の欄だけ:
/// - 住民税の年税額（`residentTaxAssessments[].amount`）
/// - 退職金・企業年金の見込み額（`retirementBenefits[].amount`）と年金の年額（行 `retirementBenefit.receipt/annualAmount`）
/// - ねんきん定期便の国民年金・厚生年金の加入月数（行 `pensionRecord.months/basic`・`/employee`）
/// - 今の住宅ローン（収益不動産でない住宅ローンで、借入の年月が計算の基準の月まで）の借入額・金利・返済期間（行）と今の残高（箱）
/// - 保険の手術の1回の額（行 `insurance.coverages/<保障>/amount`。保障の種類が手術）
/// - 自動車ローンの頭金・年数・金利（行 `car.loan/…`）
enum DocPlace<'a> {
    Box(&'a [String]),
    Row(&'a str),
}

/// 今借りている住宅ローンか（画面の housingLoans.ts の currentHomeLoan と同じ。年月で書いていない借入の時点は今のものとみなす）
fn current_home_loan(d: &Value, base: &str) -> bool {
    if d["kind"] != "mortgage" || d.get("property").is_some_and(|p| !p.is_null()) {
        return false;
    }
    match d["start"]["at"].as_str() {
        Some(at) => at <= base,
        None => true,
    }
}

fn doc_check_kept(coll: &str, obj: Option<&Value>, place: DocPlace, base: &str) -> bool {
    let home = || obj.is_none_or(|d| current_home_loan(d, base));
    match (coll, place) {
        ("residentTaxAssessments", DocPlace::Box(p)) => p == ["amount"],
        ("retirementBenefits", DocPlace::Box(p)) => p == ["amount"],
        ("retirementBenefits", DocPlace::Row(k)) => k == "retirementBenefit.receipt/annualAmount",
        ("pensionRecords", DocPlace::Row(k)) => {
            k == "pensionRecord.months/basic" || k == "pensionRecord.months/employee"
        }
        ("debts", DocPlace::Box(p)) => p == ["balance"] && home(),
        ("debts", DocPlace::Row(k)) => {
            (k == "debt.principal"
                || k == "debt.repayment/termMonths"
                || (k.starts_with("debt.rateSchedule/") && k.ends_with("/rate")))
                && home()
        }
        ("insuranceContracts", DocPlace::Row(k)) => {
            let parts: Vec<&str> = k.split('/').collect();
            parts.len() == 3
                && parts[0] == "insurance.coverages"
                && parts[2] == "amount"
                && obj.is_some_and(|c| {
                    c["coverages"].as_array().is_some_and(|a| {
                        a.iter()
                            .any(|x| x["id"] == parts[1] && x["benefit"] == "surgery")
                    })
                })
        }
        ("cars", DocPlace::Row(k)) => k.starts_with("car.loan/"),
        _ => false,
    }
}

/// 値の状態の行の「わからない」を推定の行にする（根拠はそのまま。前の値を代わりにした印は「わからない」の代わりの値の文にする）
fn unknown_row_to_estimate(row: &mut Value) {
    row["state"] = "estimated".into();
    if row["estimate"]["basis"].as_str() == Some(PREVIOUS_VALUE) {
        row["estimate"]["basis"] =
            "「わからない」の代わりに使っていた値（前に入っていた値）".into();
    }
}

/// 物（並び `coll` の1件）の中の値の箱と値の状態の行の「わからない」のうち、書類で確かめる欄でないものを推定にする。変えた数を返す
fn unknowns_to_estimates(coll: &str, obj: &mut Value, base: &str) -> usize {
    let snap = obj.clone();
    let mut path = Vec::new();
    walk_unknowns(coll, &snap, obj, &mut path, base)
}

fn walk_unknowns(
    coll: &str,
    snap: &Value,
    v: &mut Value,
    path: &mut Vec<String>,
    base: &str,
) -> usize {
    let mut n = 0;
    match v {
        Value::Object(o) => {
            if let Some(states) = o.get_mut("valueStates").and_then(Value::as_object_mut) {
                for (k, row) in states.iter_mut() {
                    if row.get("state").and_then(Value::as_str) == Some("unknown")
                        && !doc_check_kept(coll, Some(snap), DocPlace::Row(k), base)
                    {
                        unknown_row_to_estimate(row);
                        n += 1;
                    }
                }
            }
            for (k, x) in o.iter_mut() {
                if k == "valueStates" {
                    continue;
                }
                path.push(k.clone());
                if x.get("state").and_then(Value::as_str) == Some("unknown")
                    && x.get("origin").is_some()
                {
                    if !doc_check_kept(coll, Some(snap), DocPlace::Box(path), base)
                        && living_unknown_box(x)
                    {
                        n += 1;
                    }
                } else {
                    n += walk_unknowns(coll, snap, x, path, base);
                }
                path.pop();
            }
        }
        Value::Array(a) => {
            for (i, x) in a.iter_mut().enumerate() {
                path.push(i.to_string());
                if x.get("state").and_then(Value::as_str) == Some("unknown")
                    && x.get("origin").is_some()
                {
                    if !doc_check_kept(coll, Some(snap), DocPlace::Box(path), base)
                        && living_unknown_box(x)
                    {
                        n += 1;
                    }
                } else {
                    n += walk_unknowns(coll, snap, x, path, base);
                }
                path.pop();
            }
        }
        _ => {}
    }
    n
}

/// プランの差分の物の集まりの名前（x-collection）→ 世帯の並びの名前（書類で確かめる欄を持つ物だけ）
const DOC_COLLECTIONS: &[(&str, &str)] = &[
    ("residentTaxAssessment", "residentTaxAssessments"),
    ("retirementBenefit", "retirementBenefits"),
    ("pensionRecord", "pensionRecords"),
    ("debt", "debts"),
    ("insurance", "insuranceContracts"),
    ("car", "cars"),
];

/// 値を変える差分（set）の向き先が、書類で確かめる欄か。入力項目ID と物の中の場所（at）で見る。向き先の物が見つからない差分（対策の項目など）は、
/// 入力項目ID だけで決める（住宅ローンの欄は残す側に。保険の手術の額は保障の種類が分からないので残さない）
fn doc_check_kept_diff(item: &str, at: &[String], obj: Option<(&str, &Value)>, base: &str) -> bool {
    let o = obj.map(|(_, v)| v);
    let coll = |want: &str| obj.is_none_or(|(c, _)| c == want);
    match item {
        "residentTaxAssessment.amount" => coll("residentTaxAssessments") && at.is_empty(),
        "retirementBenefit.amount" => coll("retirementBenefits") && at.is_empty(),
        "retirementBenefit.receipt" => coll("retirementBenefits") && at == ["annualAmount"],
        "pensionRecord.months" => coll("pensionRecords") && (at == ["basic"] || at == ["employee"]),
        "debt.balance" => {
            coll("debts") && at.is_empty() && o.is_none_or(|d| current_home_loan(d, base))
        }
        "debt.principal" | "debt.repayment" | "debt.rateSchedule" => {
            let key = std::iter::once(item.to_string())
                .chain(at.iter().cloned())
                .collect::<Vec<_>>()
                .join("/");
            coll("debts") && doc_check_kept("debts", o, DocPlace::Row(&key), base)
        }
        "insurance.coverages" => {
            let key = std::iter::once(item.to_string())
                .chain(at.iter().cloned())
                .collect::<Vec<_>>()
                .join("/");
            o.is_some() && doc_check_kept("insuranceContracts", o, DocPlace::Row(&key), base)
        }
        "car.loan" => coll("cars"),
        _ => false,
    }
}

/// 0.43 → 0.44: 値の状態の「わからない」を「書類で確かめる」にし、書類で確かめる欄だけに残した（0041 の追記 2026-10-31。形は変えない）。
/// - 現状の世帯の物の中の「わからない」のうち、書類で確かめる欄（doc_check_kept）でないものを推定にする（値の箱は living_unknown_box と同じ:
///   代わりの値が自動の推定ならその推定の箱、FP の入れた値ならその値のまま推定の印。値の状態の行は状態だけを推定に）。値は変えない
/// - プランの差分: 値を変える差分（set）の値と前の値、足す差分（add）の物の中も同じ決まりで推定にする
/// - 書類で確かめる欄の「わからない」はそのまま（画面では「書類待ち」）。控え（`snapshots`）・ヒアリングの記録の中身は変えない
/// - 推定にした物があれば、開いたときの知らせ `{"kind": "unknownEstimated", "count": 現状で変えた数, "plans": プランの差分を変えた数}` を足す
fn v0_43_to_0_44(mut body: Value) -> Result<Value, StoreError> {
    let obj = body.as_object_mut().ok_or(StoreError::BODY)?;
    let base = obj
        .get("household")
        .and_then(|h| h["request"]["input"]["baseMonth"].as_str())
        .unwrap_or("9999-12")
        .to_string();
    let mut count = 0usize;
    // 物の ID → （並びの名前, 物）。プランの差分の向き先を見るため（変換の後の物で見る。書類で確かめる欄かどうかは変換で変わらない）
    let mut objects: Vec<(String, String, Value)> = Vec::new();
    if let Some(h) = obj
        .get_mut("household")
        .and_then(|h| h.get_mut("request"))
        .and_then(|r| r.get_mut("input"))
        .and_then(|i| i.get_mut("household"))
        .and_then(Value::as_object_mut)
    {
        for (coll, list) in h.iter_mut() {
            match list {
                Value::Array(items) => {
                    for x in items.iter_mut() {
                        count += unknowns_to_estimates(coll, x, &base);
                        if let Some(id) = x["id"].as_str() {
                            objects.push((id.to_string(), coll.clone(), x.clone()));
                        }
                    }
                }
                other => count += unknowns_to_estimates(coll, other, &base),
            }
        }
    }
    let mut plans = 0usize;
    if let Some(list) = obj.get_mut("proposals").and_then(Value::as_array_mut) {
        for plan in list {
            let Some(diffs) = plan.get_mut("diffs").and_then(Value::as_array_mut) else {
                continue;
            };
            // このプランで足した物も向き先に数える
            let mut known = objects.clone();
            for d in diffs.iter() {
                if d["op"] != "add" {
                    continue;
                }
                let Some(coll) = d["target"]["collection"]
                    .as_str()
                    .and_then(|c| DOC_COLLECTIONS.iter().find(|(k, _)| *k == c))
                else {
                    continue;
                };
                if let Some(id) = d["value"]["id"].as_str() {
                    known.push((id.to_string(), coll.1.to_string(), d["value"].clone()));
                }
            }
            for d in diffs.iter_mut() {
                let op = d["op"].as_str().unwrap_or("").to_string();
                let mut changed = false;
                if op == "add" {
                    let coll = d["target"]["collection"]
                        .as_str()
                        .map(|c| {
                            DOC_COLLECTIONS
                                .iter()
                                .find(|(k, _)| *k == c)
                                .map_or(c.to_string(), |(_, p)| p.to_string())
                        })
                        .unwrap_or_default();
                    if let Some(v) = d.get_mut("value") {
                        if v.get("state").and_then(Value::as_str) == Some("unknown") {
                            changed = living_unknown_diff_value(v);
                        } else {
                            changed = unknowns_to_estimates(&coll, v, &base) > 0;
                        }
                    }
                } else if op == "set" {
                    let item = d["item"].as_str().unwrap_or("").to_string();
                    let at: Vec<String> = d["at"]
                        .as_array()
                        .map(|a| {
                            a.iter()
                                .map(|x| x.as_str().map_or_else(|| x.to_string(), str::to_string))
                                .collect()
                        })
                        .unwrap_or_default();
                    let target = d["target"]["object"].as_str().map(str::to_string);
                    let found = target
                        .as_ref()
                        .and_then(|id| known.iter().find(|(k, _, _)| k == id))
                        .map(|(_, c, v)| (c.as_str(), v));
                    if !doc_check_kept_diff(&item, &at, found, &base) {
                        for k in ["value", "before"] {
                            if d.get_mut(k).is_some_and(living_unknown_diff_value) && k == "value" {
                                changed = true;
                            }
                        }
                    }
                }
                if changed {
                    plans += 1;
                }
            }
        }
    }
    if count > 0 || plans > 0 {
        if let Some(screen) = obj.get_mut("household").and_then(Value::as_object_mut) {
            let list = screen
                .entry("notices")
                .or_insert_with(|| Value::Array(Vec::new()));
            if let Some(list) = list.as_array_mut() {
                list.push(serde_json::json!({
                    "id": readings::migration_id(&format!("notices/unknownEstimated/{count}/{plans}")),
                    "kind": "unknownEstimated",
                    "count": count,
                    "plans": plans,
                }));
            }
        }
    }
    if let Some(meta) = obj.get_mut("meta").and_then(Value::as_object_mut) {
        meta.insert("formatVersion".into(), "0.44".into());
    }
    Ok(body)
}

/// 0.44 → 0.45: 足した欄（車の買い替え `purchase.replace` とリース・長期レンタル `lease`。0101）は任意なので足さない。形式の版だけを書き換える
fn v0_44_to_0_45(mut body: Value) -> Result<Value, StoreError> {
    let obj = body.as_object_mut().ok_or(StoreError::BODY)?;
    if let Some(meta) = obj.get_mut("meta").and_then(Value::as_object_mut) {
        meta.insert("formatVersion".into(), "0.45".into());
    }
    Ok(body)
}

/// 0.45 → 0.46: 足した欄（夢プランの種類 `dream` と行の `dream`、子への援助の優先度 `priority`。0103）は任意なので足さない。形式の版だけを書き換える
fn v0_45_to_0_46(mut body: Value) -> Result<Value, StoreError> {
    let obj = body.as_object_mut().ok_or(StoreError::BODY)?;
    if let Some(meta) = obj.get_mut("meta").and_then(Value::as_object_mut) {
        meta.insert("formatVersion".into(), "0.46".into());
    }
    Ok(body)
}

/// 0.17 で ID を振る並び（物の集まり → その物から並びまでの欄の名前。0035 の5）
const ELEMENT_LISTS: &[(&str, &[&[&str]])] = &[
    ("livingExpenses", &[&["stages"], &["categories"]]),
    ("accounts", &[&["contributions"]]),
    ("debts", &[&["rateSchedule"], &["prepayments"]]),
    ("residences", &[&["purchase", "gifts"]]),
    ("insuranceContracts", &[&["renewals"]]),
    (
        "goals",
        &[
            &["education", "stages"],
            &["education", "lessons"],
            &["education", "scholarships"],
            &["education", "loans"],
            &["education", "gifts"],
        ],
    ),
    (
        "advisoryFees",
        &[
            &["terms", "oneTime"],
            &["terms", "recurring", "revision", "steps"],
        ],
    ),
];
/// 0.17 で ID を振る前提の列（親は `assumptions`）
const ASSUMPTION_LISTS: &[&[&str]] = &[
    &["marketShocks"],
    &["loanRateShifts"],
    &["incomeShocks"],
    &["returnShifts"],
    &["surplusSaving", "changes"],
];

fn get_path_mut<'a>(mut v: &'a mut Value, path: &[&str]) -> Option<&'a mut Value> {
    for k in path {
        v = v.as_object_mut()?.get_mut(*k)?;
    }
    Some(v)
}

/// 並びの要素に、場所から決まった ID を振る（ID がある要素はそのまま。0035 の10 の1）
fn assign_ids(list: &mut Value, place: &str) {
    if let Some(arr) = list.as_array_mut() {
        for (i, el) in arr.iter_mut().enumerate() {
            if let Some(o) = el.as_object_mut() {
                if !o.contains_key("id") {
                    o.insert(
                        "id".into(),
                        Value::String(readings::migration_id(&format!("{place}/{i}"))),
                    );
                }
            }
        }
    }
}

fn assign_element_ids(input: &mut Value) {
    if let Some(h) = input.get_mut("household").and_then(Value::as_object_mut) {
        for (coll, paths) in ELEMENT_LISTS {
            let Some(objs) = h.get_mut(*coll).and_then(Value::as_array_mut) else {
                continue;
            };
            for obj in objs.iter_mut() {
                let Some(id) = obj.get("id").and_then(Value::as_str).map(str::to_owned) else {
                    continue;
                };
                for path in *paths {
                    if let Some(list) = get_path_mut(obj, path) {
                        assign_ids(list, &format!("{id}/{}", path.join("/")));
                    }
                }
            }
        }
        if let Some(rels) = h.get_mut("relations").and_then(Value::as_array_mut) {
            for (i, r) in rels.iter_mut().enumerate() {
                let Some(o) = r.as_object_mut() else { continue };
                if o.contains_key("id") {
                    continue;
                }
                let end = |a: &str, b: &str| -> String {
                    let x = o.get(a).or_else(|| o.get(b)).and_then(Value::as_str);
                    x.unwrap_or("").to_owned()
                };
                let place = format!("relations/{i}/{}/{}", end("a", "parent"), end("b", "child"));
                o.insert("id".into(), Value::String(readings::migration_id(&place)));
            }
        }
    }
    if let Some(a) = input.get_mut("assumptions") {
        for path in ASSUMPTION_LISTS {
            if let Some(list) = get_path_mut(a, path) {
                assign_ids(list, &format!("assumptions/{}", path.join("/")));
            }
        }
    }
}

/// 親・祖父母の構成員を世帯の外の家族にし（不具合の直しとして書き換える唯一の例外）、贈与者を同じ ID の世帯の外の家族にする（0035 の10 の2）。
/// 戻り値は世帯の外の家族にした親・祖父母の ID
fn convert_outside_family(input: &mut Value) -> Vec<String> {
    let Some(h) = input.get_mut("household").and_then(Value::as_object_mut) else {
        return Vec::new();
    };
    let rels = h.get("relations").cloned().unwrap_or(Value::Null);
    let members: Vec<Value> = h
        .get("members")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    let converts = |m: &Value| {
        matches!(m["kind"].as_str(), Some("parent" | "grandparent")) && m.get("outside").is_none()
    };
    // 世帯の中に残る構成員（親とする関係の子として探す）
    let inside: Vec<&str> = members
        .iter()
        .filter(|m| !converts(m) && m.get("outside").is_none())
        .filter_map(|m| m["id"].as_str())
        .collect();
    let self_id: Option<String> = members
        .iter()
        .find(|m| m["kind"] == "self")
        .and_then(|m| m["id"].as_str())
        .map(str::to_owned);
    let mut changed = Vec::new();
    if let Some(list) = h.get_mut("members").and_then(Value::as_array_mut) {
        for m in list.iter_mut() {
            if !converts(m) {
                continue;
            }
            let id = m["id"].as_str().unwrap_or("").to_owned();
            let children: Vec<&str> = rels
                .as_array()
                .map(|a| {
                    a.iter()
                        .filter(|r| {
                            r["type"] == "parentOf" && r["parent"].as_str() == Some(id.as_str())
                        })
                        .filter_map(|r| r["child"].as_str())
                        .collect()
                })
                .unwrap_or_default();
            // 誰の家族か: 世帯の中に残る子（親とする関係）、無ければ本人（0035 の4。省けるのは贈与者から作った人だけ）
            let of = inside
                .iter()
                .find(|i| children.contains(i))
                .copied()
                .or(self_id.as_deref());
            let mut outside = serde_json::json!({"periods": []});
            if let Some(of) = of {
                outside["of"] = Value::String(of.to_owned());
            }
            m["outside"] = outside;
            changed.push(id);
        }
    }
    if let Some(donors) = h.remove("donors") {
        let list = h
            .entry("members")
            .or_insert_with(|| Value::Array(Vec::new()))
            .as_array_mut();
        if let Some(list) = list {
            for d in donors.as_array().into_iter().flatten() {
                let mut outside = serde_json::json!({"periods": []});
                if let Some(of) = d.get("of") {
                    outside["of"] = of.clone();
                }
                list.push(serde_json::json!({
                    "id": d["id"],
                    "kind": d["kind"],
                    "joins": null,
                    "leaves": null,
                    "expected": false,
                    "outside": outside,
                }));
            }
        }
    }
    changed
}

/// 当て先の場所の文字（`valueStates` の鍵。0035 の3）
fn state_key(address: &Value) -> Option<String> {
    let item = address["item"].as_str()?;
    let at: Vec<&str> = address["at"]
        .as_array()?
        .iter()
        .filter_map(Value::as_str)
        .collect();
    Some(if at.is_empty() {
        item.to_owned()
    } else {
        format!("{item}/{}", at.join("/"))
    })
}

fn is_box(v: Option<&Value>) -> bool {
    v.is_some_and(|v| {
        v.get("state").is_some_and(Value::is_string)
            && v.get("origin").is_some_and(Value::is_object)
    })
}

/// 当て先の向き先の物（構成員・物の集まりの1件）か、要求の入力（前提・表の最後の年）
fn target_mut<'a>(input: &'a mut Value, target: &Value) -> Option<&'a mut Value> {
    if target.get("plan").is_some() {
        return Some(input);
    }
    let id = target
        .get("object")
        .or_else(|| target.get("member"))?
        .as_str()?
        .to_owned();
    input
        .get_mut("household")?
        .as_object_mut()?
        .values_mut()
        .filter_map(Value::as_array_mut)
        .flatten()
        .find(|x| x.get("id").and_then(Value::as_str) == Some(id.as_str()))
}

/// 仮の印（household.assumed）を、当て先の物の値の状態の欄（推定）へ移す。移せない印は残す（0035 の10 の3）
fn move_assumed(screen: &mut Map<String, Value>, input: &mut Value, read: &Value) {
    let Some(assumed) = screen.get("assumed").and_then(Value::as_object).cloned() else {
        return;
    };
    let mut kept = Map::new();
    for (k, basis) in assumed {
        let r = readings::resolve_assumed_key(&k, read);
        let Some(r) = r.filter(|r| r["kind"] == "address") else {
            kept.insert(k, basis);
            continue;
        };
        let address = &r["address"];
        let cur = readings::read_at(read, address);
        // 値の無い場所（無くなった要素・まだ入れていない欄）には行を書かない。値の箱を持つ値は、箱の状態が正
        if cur.is_none_or(Value::is_null) || is_box(cur) {
            continue;
        }
        let (Some(key), Some(obj)) = (state_key(address), target_mut(input, &address["target"]))
        else {
            kept.insert(k, basis);
            continue;
        };
        let Some(obj) = obj.as_object_mut() else {
            kept.insert(k, basis);
            continue;
        };
        let text = basis
            .as_str()
            .filter(|s| !s.is_empty())
            .unwrap_or("仮の値")
            .to_owned();
        let method = r["method"].as_str().unwrap_or("standard").to_owned();
        let states = obj
            .entry("valueStates")
            .or_insert_with(|| Value::Object(Map::new()));
        if let Some(states) = states.as_object_mut() {
            states.insert(
                key,
                serde_json::json!({"state": "estimated", "origin": {"kind": "auto"}, "estimate": {"method": method, "basis": text}}),
            );
        }
    }
    if kept.is_empty() {
        screen.remove("assumed");
    } else {
        screen.insert("assumed".into(), Value::Object(kept));
    }
}

/// 0.16 の差分を当て先の形に読み替える（0036 の5）。戻り値は読み替えられなかった差分の数
fn convert_diffs(proposals: &mut Value, read: &Value) -> usize {
    let mut unresolved = 0;
    for p in proposals.as_array_mut().into_iter().flatten() {
        let Some(diffs) = p.get_mut("diffs").and_then(Value::as_array_mut) else {
            continue;
        };
        for d in diffs.iter_mut() {
            let Some(o) = d.as_object_mut() else { continue };
            let Some(key) = o.remove("key").and_then(|k| k.as_str().map(str::to_owned)) else {
                continue; // もう当て先の形
            };
            let old_target = o.get("target").cloned().unwrap_or(Value::Null);
            let old_item = o.get("item").cloned().unwrap_or(Value::Null);
            o.insert(
                "legacy".into(),
                serde_json::json!({"key": key, "target": old_target, "item": old_item}),
            );
            o.insert("op".into(), "set".into());
            match readings::resolve_key(&key, read) {
                Some(r) if r["kind"] == "address" => {
                    o.insert("target".into(), r["address"]["target"].clone());
                    o.insert("item".into(), r["address"]["item"].clone());
                    o.insert("at".into(), r["address"]["at"].clone());
                }
                Some(r) if r["kind"] == "lever" => {
                    let mut t = serde_json::json!({"lever": r["lever"]});
                    for k in ["object", "member"] {
                        if let Some(v) = r.get(k) {
                            t[k] = v.clone();
                        }
                    }
                    o.insert("target".into(), t);
                    o.insert("at".into(), Value::Array(Vec::new()));
                }
                _ => {
                    o.insert("at".into(), Value::Null);
                    o.insert("unresolved".into(), Value::Bool(true));
                    unresolved += 1;
                }
            }
        }
    }
    unresolved
}

/// 対策に足した項目（動かす項目のキー）を当て先にする。読み替えられない項目は捨てる（画面の並びの好みで、値ではないため）
fn convert_shown_items(workspace: &mut Value, read: &Value) {
    let Some(list) = workspace
        .get_mut("shownItems")
        .and_then(Value::as_array_mut)
    else {
        return;
    };
    let mut out = Vec::new();
    for k in list.iter() {
        let Some(k) = k.as_str() else { continue };
        match readings::resolve_key(k, read) {
            Some(r) if r["kind"] == "address" => out.push(r["address"].clone()),
            Some(r) if r["kind"] == "lever" => {
                let mut t = serde_json::json!({"lever": r["lever"]});
                for key in ["object", "member"] {
                    if let Some(v) = r.get(key) {
                        t[key] = v.clone();
                    }
                }
                out.push(serde_json::json!({"target": t, "item": null, "at": []}));
            }
            _ => {}
        }
    }
    *list = out;
}

/// 0.16 → 0.17（0035 の10）: 作りの変わる形を1段で変える。並びの要素の ID・世帯の外の家族・仮の印・プランの差分・対策に足した項目。
/// 控え・ヒアリング・明細の取り込み・拡張領域は変えない
fn v0_16_to_0_17(mut body: Value) -> Result<Value, StoreError> {
    let obj = body.as_object_mut().ok_or(StoreError::BODY)?;
    let mut outside = Vec::new();
    let mut read = Value::Null;
    if let Some(input) = obj
        .get_mut("household")
        .and_then(|h| h.get_mut("request"))
        .and_then(|r| r.get_mut("input"))
    {
        assign_element_ids(input);
        outside = convert_outside_family(input);
        read = input.clone();
    }
    if let Some(screen) = obj.get_mut("household").and_then(Value::as_object_mut) {
        let mut input = screen
            .get_mut("request")
            .and_then(|r| r.get_mut("input"))
            .map(std::mem::take)
            .unwrap_or(Value::Null);
        if input.is_object() {
            move_assumed(screen, &mut input, &read);
            if let Some(r) = screen.get_mut("request").and_then(Value::as_object_mut) {
                r.insert("input".into(), input);
            }
        }
    }
    let unresolved = match obj.get_mut("proposals") {
        Some(p) => convert_diffs(p, &read),
        None => 0,
    };
    if let Some(w) = obj.get_mut("workspace") {
        convert_shown_items(w, &read);
    }
    let mut notices = Vec::new();
    if !outside.is_empty() {
        notices.push(serde_json::json!({
            "id": readings::migration_id(&format!("notices/outsideFamily/{}", outside.join("/"))),
            "kind": "outsideFamily",
            "members": outside,
        }));
    }
    if unresolved > 0 {
        notices.push(serde_json::json!({
            "id": readings::migration_id(&format!("notices/unresolvedDiffs/{unresolved}")),
            "kind": "unresolvedDiffs",
            "count": unresolved,
        }));
    }
    if !notices.is_empty() {
        if let Some(screen) = obj.get_mut("household").and_then(Value::as_object_mut) {
            let list = screen
                .entry("notices")
                .or_insert_with(|| Value::Array(Vec::new()));
            if let Some(list) = list.as_array_mut() {
                list.extend(notices);
            }
        }
    }
    if let Some(meta) = obj.get_mut("meta").and_then(Value::as_object_mut) {
        meta.insert("formatVersion".into(), "0.17".into());
    }
    Ok(body)
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Access {
    /// 保存できる（今の版か、変換できる古い版）
    ReadWrite,
    /// MINOR だけが新しい: 閲覧だけ（保存・控え・PDF の出力はさせない）
    ReadOnly,
}

pub fn parse(v: &str) -> Option<(u32, u32)> {
    let (a, b) = v.split_once('.')?;
    let ok = |s: &str| {
        !s.is_empty()
            && s.len() <= 6
            && s.bytes().all(|c| c.is_ascii_digit())
            && (s == "0" || !s.starts_with('0'))
    };
    if !ok(a) || !ok(b) {
        return None;
    }
    Some((a.parse().ok()?, b.parse().ok()?))
}

/// この版のファイルをどう開くか
pub fn access(version: &str) -> Result<Access, StoreError> {
    let (ma, mi) = parse(version).ok_or(StoreError::FORMAT_UNKNOWN)?;
    let (cma, cmi) = parse(CURRENT).expect("今の版");
    if ma > cma {
        return Err(StoreError::FORMAT_TOO_NEW);
    }
    if ma == cma && mi > cmi {
        return Ok(Access::ReadOnly);
    }
    if KNOWN.contains(&version) {
        Ok(Access::ReadWrite)
    } else {
        Err(StoreError::FORMAT_UNKNOWN)
    }
}

/// 古い版の本文を今の版へ変換する（閲覧だけの新しい版は、そのまま返す）
pub fn upgrade(version: &str, mut body: Value) -> Result<Value, StoreError> {
    if access(version)? == Access::ReadOnly {
        return Ok(body);
    }
    let mut v = version;
    while v != CURRENT {
        let step = STEPS
            .iter()
            .find(|s| s.from == v)
            .ok_or(StoreError::FORMAT_UNKNOWN)?;
        body = (step.apply)(body)?;
        v = step.to;
    }
    Ok(body)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_known_version_has_a_path_to_current() {
        assert_eq!(*KNOWN.last().unwrap(), CURRENT, "今の版は一覧の最後");
        let mut sorted: Vec<(u32, u32)> = KNOWN.iter().map(|v| parse(v).unwrap()).collect();
        let orig = sorted.clone();
        sorted.sort();
        assert_eq!(orig, sorted, "古い順に並べる");
        for v in KNOWN.iter().filter(|v| **v != CURRENT) {
            let step = STEPS.iter().find(|s| s.from == *v);
            assert!(step.is_some(), "{v} から次の版への変換の段が無い");
            let next = KNOWN.iter().position(|k| k == v).unwrap() + 1;
            assert_eq!(
                step.unwrap().to,
                KNOWN[next],
                "{v} の次の段は一覧の次の版へ"
            );
        }
        assert_eq!(STEPS.len(), KNOWN.len() - 1, "段の数＝版の数−1");
    }

    #[test]
    fn newer_versions_are_refused_or_read_only() {
        assert_eq!(access(CURRENT).unwrap(), Access::ReadWrite);
        assert_eq!(access("0.1").unwrap(), Access::ReadWrite);
        assert_eq!(access("0.2").unwrap(), Access::ReadWrite);
        assert_eq!(access("0.3").unwrap(), Access::ReadWrite);
        assert_eq!(access("0.4").unwrap(), Access::ReadWrite);
        assert_eq!(access("0.5").unwrap(), Access::ReadWrite);
        assert_eq!(access("0.6").unwrap(), Access::ReadWrite);
        assert_eq!(access("0.7").unwrap(), Access::ReadWrite);
        assert_eq!(access("0.8").unwrap(), Access::ReadWrite);
        assert_eq!(access("0.9").unwrap(), Access::ReadWrite);
        assert_eq!(access("0.10").unwrap(), Access::ReadWrite);
        assert_eq!(access("0.11").unwrap(), Access::ReadWrite);
        assert_eq!(access("0.12").unwrap(), Access::ReadWrite);
        assert_eq!(access("0.13").unwrap(), Access::ReadWrite);
        assert_eq!(access("0.14").unwrap(), Access::ReadWrite);
        assert_eq!(access("0.15").unwrap(), Access::ReadWrite);
        assert_eq!(access("0.16").unwrap(), Access::ReadWrite);
        assert_eq!(access("0.17").unwrap(), Access::ReadWrite);
        assert_eq!(access("0.18").unwrap(), Access::ReadWrite);
        assert_eq!(access("0.19").unwrap(), Access::ReadWrite);
        assert_eq!(access("0.20").unwrap(), Access::ReadWrite);
        assert_eq!(access("0.21").unwrap(), Access::ReadWrite);
        assert_eq!(access("0.22").unwrap(), Access::ReadWrite);
        assert_eq!(access("0.23").unwrap(), Access::ReadWrite);
        assert_eq!(access("0.24").unwrap(), Access::ReadWrite);
        assert_eq!(access("0.25").unwrap(), Access::ReadWrite);
        assert_eq!(access("0.26").unwrap(), Access::ReadWrite);
        assert_eq!(access("0.27").unwrap(), Access::ReadWrite);
        assert_eq!(access("0.28").unwrap(), Access::ReadWrite);
        assert_eq!(access("0.29").unwrap(), Access::ReadWrite);
        assert_eq!(access("0.30").unwrap(), Access::ReadWrite);
        assert_eq!(access("0.31").unwrap(), Access::ReadWrite);
        assert_eq!(access("0.32").unwrap(), Access::ReadWrite);
        assert_eq!(access("0.33").unwrap(), Access::ReadWrite);
        assert_eq!(access("0.34").unwrap(), Access::ReadWrite);
        assert_eq!(access("0.35").unwrap(), Access::ReadWrite);
        assert_eq!(access("0.36").unwrap(), Access::ReadWrite);
        assert_eq!(access("0.37").unwrap(), Access::ReadWrite);
        assert_eq!(access("0.38").unwrap(), Access::ReadWrite);
        assert_eq!(access("0.39").unwrap(), Access::ReadWrite);
        assert_eq!(access("0.40").unwrap(), Access::ReadWrite);
        assert_eq!(access("0.41").unwrap(), Access::ReadWrite);
        assert_eq!(access("0.42").unwrap(), Access::ReadWrite);
        assert_eq!(access("0.43").unwrap(), Access::ReadWrite);
        assert_eq!(access("0.44").unwrap(), Access::ReadWrite);
        assert_eq!(access("0.45").unwrap(), Access::ReadWrite);
        assert_eq!(access("0.46").unwrap(), Access::ReadWrite);
        assert_eq!(access("0.47").unwrap(), Access::ReadOnly);
        assert_eq!(access("0.99").unwrap(), Access::ReadOnly);
        assert_eq!(access("1.0").unwrap_err(), StoreError::FORMAT_TOO_NEW);
        assert_eq!(
            access("0.0").unwrap_err(),
            StoreError::FORMAT_UNKNOWN,
            "開発中の古い形式は読めなくてよい"
        );
        assert_eq!(access("x").unwrap_err(), StoreError::FORMAT_UNKNOWN);
        assert_eq!(access("01.1").unwrap_err(), StoreError::FORMAT_UNKNOWN);
        let b = serde_json::json!({"a": 1});
        assert_eq!(upgrade(CURRENT, b.clone()).unwrap(), b);
        assert_eq!(
            upgrade("0.47", b.clone()).unwrap(),
            b,
            "新しい MINOR は閲覧だけ（変換しない）"
        );
    }

    #[test]
    fn v0_38_to_0_39_only_bumps_version() {
        // 足した欄（段の給食費の選び方・部活動などの費用・保育料とは別にかかるお金）は任意なので、前の版の教育の目標は書き換えない
        let b = serde_json::json!({
            "meta": {"formatVersion": "0.38"},
            "household": {"request": {"input": {"household": {"goals": [
                {"id": "g1", "kind": "education", "owner": "c1", "education": {"schoolLunch": "free", "stages": [{"stage": "nursery"}, {"stage": "elementary", "sector": "public"}]}}
            ]}}}}
        });
        let u = upgrade("0.38", b.clone()).unwrap();
        assert_eq!(u["meta"]["formatVersion"], CURRENT);
        assert_eq!(u["household"], b["household"]);
    }

    #[test]
    fn v0_42_to_0_43_turns_living_unknowns_into_estimates() {
        let stat = serde_json::json!({"value": 235000, "state": "estimated", "origin": {"kind": "auto"}, "estimate": {"method": "statistic", "basis": "家計調査"}});
        let b = serde_json::json!({
            "meta": {"formatVersion": "0.42"},
            "household": {"request": {"input": {"household": {
                "livingExpenses": [{
                    "id": "l1", "mode": "byCategory",
                    "monthly": {"state": "unknown", "origin": {"kind": "manual"}, "substitute": stat},
                    "categories": [
                        {"id": "c1", "category": "transport", "monthly": {"state": "unknown", "origin": {"kind": "manual"}, "substitute": {"value": 30000, "state": "estimated", "origin": {"kind": "auto"}, "estimate": {"method": "standard", "basis": "前に入っていた値を代わりに使う"}}}},
                        {"id": "c2", "category": "otherConsumption", "monthly": {"value": 50000, "state": "confirmed", "origin": {"kind": "manual"}}},
                        {"id": "c3", "category": "furniture", "monthly": {"value": 10000, "state": "confirmed", "origin": {"kind": "manual"}}},
                        {"id": "c4", "category": "clothing", "monthly": {"value": 8000, "state": "confirmed", "origin": {"kind": "manual"}}}
                    ],
                    "stages": [{"id": "s1", "at": {"at": "2040-04"}, "ratio": "0.8"}],
                    "valueStates": {"livingExpense.stages/s1/ratio": {"state": "unknown", "origin": {"kind": "manual"}, "estimate": {"method": "derived", "basis": "推定の段階"}}}
                }],
                "periodicExpenses": [
                    {"id": "p1", "kind": "livingAnnual", "amount": {"state": "unknown", "origin": {"kind": "manual"}, "substitute": {"value": 100000, "state": "estimated", "origin": {"kind": "auto"}, "estimate": {"method": "standard", "basis": "よくある額の目安"}}}},
                    {"id": "p2", "kind": "general", "amount": {"state": "unknown", "origin": {"kind": "manual"}, "substitute": {"value": 500000, "state": "estimated", "origin": {"kind": "auto"}, "estimate": {"method": "standard", "basis": "目安"}}}}
                ],
                "employmentPeriods": [{"id": "e1", "salary": {"annual": {"state": "unknown", "origin": {"kind": "manual"}, "substitute": {"value": 4000000, "state": "estimated", "origin": {"kind": "auto"}, "estimate": {"method": "statistic", "basis": "賃金"}}}}}]
            }}}},
            "proposals": [{"id": "P", "diffs": [
                {"id": "d1", "op": "set", "target": {"lever": "livingMonthly"}, "item": "livingExpense.monthly", "at": [], "value": {"state": "unknown", "origin": {"kind": "manual"}, "substitute": {"value": 280000, "state": "estimated", "origin": {"kind": "auto"}, "estimate": {"method": "standard", "basis": "前に入っていた値を代わりに使う"}}}, "before": {"value": 235000, "state": "estimated", "origin": {"kind": "auto"}, "estimate": {"method": "statistic", "basis": "家計調査"}}},
                {"id": "d2", "op": "set", "target": {"object": "l1"}, "item": "livingExpense.stages", "at": ["s1", "ratio"], "value": {"value": "0.7", "state": "unknown", "origin": {"kind": "manual"}, "estimate": {"method": "standard", "basis": "前に入っていた値を代わりに使う"}}},
                {"id": "d3", "op": "set", "target": {"lever": "livingGroupDaily", "object": "l1"}, "item": "livingExpense.categories", "at": [], "value": {"value": 30000, "state": "confirmed", "origin": {"kind": "manual"}}, "before": null},
                {"id": "d4", "op": "set", "target": {"object": "e1"}, "item": "employment.salary.annual", "at": [], "value": {"state": "unknown", "origin": {"kind": "manual"}, "substitute": {"value": 1, "state": "estimated", "origin": {"kind": "auto"}, "estimate": {"method": "standard", "basis": "前に入っていた値を代わりに使う"}}}}
            ]}]
        });
        let u = v0_42_to_0_43(b).unwrap();
        assert_eq!(u["meta"]["formatVersion"], "0.43");
        let h = &u["household"]["request"]["input"]["household"];
        let l = &h["livingExpenses"][0];
        // 統計の代わりの値は、その推定の箱（値は同じ）
        assert_eq!(
            l["monthly"],
            serde_json::json!({"value": 235000, "state": "estimated", "origin": {"kind": "auto"}, "estimate": {"method": "statistic", "basis": "家計調査"}})
        );
        // FP の前の値の代わりは、その値のまま推定の印（出どころ manual。入れ直さない）
        assert_eq!(l["categories"][0]["monthly"]["value"], 30000);
        assert_eq!(l["categories"][0]["monthly"]["state"], "estimated");
        assert_eq!(l["categories"][0]["monthly"]["origin"]["kind"], "manual");
        assert!(l["categories"][0]["monthly"]["estimate"]["basis"]
            .as_str()
            .unwrap()
            .contains("「わからない」の代わりに使っていた値"));
        // 前の版の内訳（交通・通信・その他の消費）の名前は書き換えない
        assert_eq!(l["categories"][0]["category"], "transport");
        assert_eq!(l["categories"][1]["monthly"]["state"], "confirmed");
        // 段の割合の行は推定の行に
        assert_eq!(
            l["valueStates"]["livingExpense.stages/s1/ratio"]["state"],
            "estimated"
        );
        // 年払い・数年おきの暮らしの支出だけ（ほかの種類の行・年収は変えない）
        assert_eq!(h["periodicExpenses"][0]["amount"]["state"], "estimated");
        assert_eq!(h["periodicExpenses"][0]["amount"]["value"], 100000);
        assert_eq!(h["periodicExpenses"][1]["amount"]["state"], "unknown");
        assert_eq!(
            h["employmentPeriods"][0]["salary"]["annual"]["state"],
            "unknown"
        );
        // プランの差分
        let d = &u["proposals"][0]["diffs"];
        assert_eq!(d[0]["value"]["state"], "estimated");
        assert_eq!(d[0]["value"]["value"], 280000);
        assert_eq!(d[0]["value"]["origin"]["kind"], "manual");
        assert_eq!(d[1]["value"]["state"], "estimated");
        assert_eq!(d[1]["value"]["value"], "0.7");
        // 束の合計（日用品・衣服 30,000）は、代表の内訳（家具・家事用品）＝30,000−被服 8,000 の差分に
        assert_eq!(d[2]["target"], serde_json::json!({"object": "l1"}));
        assert_eq!(d[2]["at"], serde_json::json!(["c3", "monthly"]));
        assert_eq!(d[2]["value"]["value"], 22000);
        assert_eq!(d[2]["before"]["value"], 10000);
        assert_eq!(d[3]["value"]["state"], "unknown");
        // 開いたときの知らせ（現状 4件: 総額・内訳・段の割合・年払い。プラン 2件）
        let n = u["household"]["notices"].as_array().unwrap();
        assert_eq!(n.len(), 1);
        assert_eq!(n[0]["kind"], "livingUnknown");
        assert_eq!(n[0]["count"], 4);
        assert_eq!(n[0]["plans"], 2);
    }

    #[test]
    fn v0_43_to_0_44_keeps_doc_check_unknowns_and_estimates_the_rest() {
        let sub = |v: i64, method: &str, basis: &str| serde_json::json!({"value": v, "state": "estimated", "origin": {"kind": "auto"}, "estimate": {"method": method, "basis": basis}});
        let unk = |s: Value| serde_json::json!({"state": "unknown", "origin": {"kind": "manual"}, "substitute": s});
        let row = |basis: &str| serde_json::json!({"state": "unknown", "origin": {"kind": "manual"}, "estimate": {"method": "derived", "basis": basis}});
        let b = serde_json::json!({
            "meta": {"formatVersion": "0.43"},
            "household": {"request": {"input": {"baseMonth": "2026-10", "household": {
                "employmentPeriods": [{"id": "e1", "salary": {
                    "annual": unk(sub(4000000, "statistic", "賃金構造基本統計調査")),
                    "bonus": unk(sub(800000, "standard", "前に入っていた値を代わりに使う"))
                }}],
                "residentTaxAssessments": [{"id": "t1", "amount": unk(sub(180000, "derived", "前の年の所得から概算"))}],
                "retirementBenefits": [{"id": "r1", "kind": "db", "amount": unk(sub(5000000, "statistic", "退職金の目安")),
                    "valueStates": {"retirementBenefit.receipt/annualAmount": row("前に入っていた値を代わりに使う")}}],
                "pensionRecords": [{"id": "p1", "months": {"basic": 300, "employee": 200},
                    "valueStates": {"pensionRecord.months/basic": row("代わりの値"), "pensionRecord.months/employee": row("代わりの値")}}],
                "debts": [
                    {"id": "d1", "kind": "mortgage", "start": {"at": "2020-04"}, "principal": 30000000, "balance": unk(sub(25000000, "derived", "逆算")),
                        "valueStates": {"debt.principal": row("前に入っていた値を代わりに使う"), "debt.repayment/termMonths": row("逆算"), "debt.rateSchedule/r1/rate": row("逆算")}},
                    {"id": "d2", "kind": "mortgage", "start": {"at": "2030-04"}, "principal": 40000000,
                        "valueStates": {"debt.principal": row("前に入っていた値を代わりに使う")}},
                    {"id": "d3", "kind": "mortgage", "property": "a1", "start": {"at": "2020-04"}, "principal": 20000000,
                        "valueStates": {"debt.principal": row("前に入っていた値を代わりに使う")}}
                ],
                "insuranceContracts": [{"id": "i1", "coverages": [{"id": "c1", "benefit": "hospitalDaily", "amount": 5000}, {"id": "c2", "benefit": "surgery", "amount": 50000}],
                    "valueStates": {"insurance.coverages/c1/amount": row("前に入っていた値を代わりに使う"), "insurance.coverages/c2/amount": row("入院日額の10倍")}}],
                "cars": [{"id": "k1", "loan": {"rate": "0.025", "termMonths": 60},
                    "valueStates": {"car.loan/rate": row("目安"), "car.purchase/price": row("目安")}}],
                "residences": [{"id": "h1", "kind": "own", "propertyTax": {"annual": unk(sub(120000, "standard", "目安のボタンの値"))}}]
            }}}},
            "proposals": [{"id": "P", "diffs": [
                {"id": "x1", "op": "set", "target": {"object": "e1"}, "item": "employment.salary.annual", "at": [], "value": unk(sub(5000000, "standard", "前に入っていた値を代わりに使う")), "before": unk(sub(4000000, "statistic", "賃金構造基本統計調査"))},
                {"id": "x2", "op": "set", "target": {"object": "t1"}, "item": "residentTaxAssessment.amount", "at": [], "value": unk(sub(200000, "standard", "前に入っていた値を代わりに使う"))},
                {"id": "x3", "op": "set", "target": {"object": "d1"}, "item": "debt.repayment", "at": ["termMonths"], "value": {"value": 420, "state": "unknown", "origin": {"kind": "manual"}, "estimate": {"method": "standard", "basis": "前に入っていた値を代わりに使う"}}},
                {"id": "x4", "op": "add", "target": {"collection": "car"}, "value": {"id": "k2", "price": unk(sub(3000000, "standard", "目安")), "valueStates": {"car.loan/termMonths": row("目安")}}}
            ]}]
        });
        let u = v0_43_to_0_44(b).unwrap();
        assert_eq!(u["meta"]["formatVersion"], "0.44");
        let h = &u["household"]["request"]["input"]["household"];
        // 年収: 統計の代わりの値はその推定の箱（値は同じ）。賞与: 前の値の代わりは、その値のまま推定の印（出どころ manual）
        assert_eq!(
            h["employmentPeriods"][0]["salary"]["annual"],
            sub(4000000, "statistic", "賃金構造基本統計調査")
        );
        let bonus = &h["employmentPeriods"][0]["salary"]["bonus"];
        assert_eq!(bonus["value"], 800000);
        assert_eq!(bonus["state"], "estimated");
        assert_eq!(bonus["origin"]["kind"], "manual");
        // 書類で確かめる欄は残す
        assert_eq!(h["residentTaxAssessments"][0]["amount"]["state"], "unknown");
        assert_eq!(h["retirementBenefits"][0]["amount"]["state"], "unknown");
        assert_eq!(
            h["retirementBenefits"][0]["valueStates"]["retirementBenefit.receipt/annualAmount"]
                ["state"],
            "unknown"
        );
        for k in [
            "pensionRecord.months/basic",
            "pensionRecord.months/employee",
        ] {
            assert_eq!(h["pensionRecords"][0]["valueStates"][k]["state"], "unknown");
        }
        let d1 = &h["debts"][0];
        assert_eq!(d1["balance"]["state"], "unknown");
        for k in [
            "debt.principal",
            "debt.repayment/termMonths",
            "debt.rateSchedule/r1/rate",
        ] {
            assert_eq!(d1["valueStates"][k]["state"], "unknown", "{k}");
        }
        // これから借りる住宅ローン・収益不動産のローンは推定に（前の値の代わりの根拠は「わからない」の代わりの値の文に）
        for i in [1, 2] {
            let r = &h["debts"][i]["valueStates"]["debt.principal"];
            assert_eq!(r["state"], "estimated");
            assert!(r["estimate"]["basis"]
                .as_str()
                .unwrap()
                .contains("「わからない」の代わりに使っていた値"));
        }
        // 保険: 手術の額だけ残す
        let iv = &h["insuranceContracts"][0]["valueStates"];
        assert_eq!(iv["insurance.coverages/c1/amount"]["state"], "estimated");
        assert_eq!(iv["insurance.coverages/c2/amount"]["state"], "unknown");
        // 車: ローンは残し、車両の価格は推定に
        assert_eq!(
            h["cars"][0]["valueStates"]["car.loan/rate"]["state"],
            "unknown"
        );
        assert_eq!(
            h["cars"][0]["valueStates"]["car.purchase/price"]["state"],
            "estimated"
        );
        assert_eq!(
            h["residences"][0]["propertyTax"]["annual"],
            sub(120000, "standard", "目安のボタンの値")
        );
        // プランの差分
        let d = &u["proposals"][0]["diffs"];
        assert_eq!(d[0]["value"]["state"], "estimated");
        assert_eq!(d[0]["value"]["value"], 5000000);
        assert_eq!(d[0]["value"]["origin"]["kind"], "manual");
        assert_eq!(
            d[0]["before"],
            sub(4000000, "statistic", "賃金構造基本統計調査")
        );
        assert_eq!(d[1]["value"]["state"], "unknown");
        assert_eq!(d[2]["value"]["state"], "unknown");
        assert_eq!(d[3]["value"]["price"]["state"], "estimated");
        assert_eq!(
            d[3]["value"]["valueStates"]["car.loan/termMonths"]["state"],
            "unknown"
        );
        // 開いたときの知らせ（現状 7か所: 年収・賞与・ローン2本の借入額・保険の入院日額・車両の価格・固定資産税。プラン 2件）
        let n = u["household"]["notices"].as_array().unwrap();
        assert_eq!(n.len(), 1);
        assert_eq!(n[0]["kind"], "unknownEstimated");
        assert_eq!(n[0]["count"], 7);
        assert_eq!(n[0]["plans"], 2);
    }

    #[test]
    fn v0_43_to_0_44_without_other_unknowns_only_bumps_version() {
        let b = serde_json::json!({
            "meta": {"formatVersion": "0.43"},
            "household": {"request": {"input": {"baseMonth": "2026-10", "household": {"residentTaxAssessments": [
                {"id": "t1", "amount": {"state": "unknown", "origin": {"kind": "manual"}, "substitute": {"value": 180000, "state": "estimated", "origin": {"kind": "auto"}, "estimate": {"method": "derived", "basis": "概算"}}}}
            ]}}}}
        });
        let u = upgrade("0.43", b.clone()).unwrap();
        assert_eq!(u["meta"]["formatVersion"], "0.46");
        assert_eq!(u["household"], b["household"]);
    }

    #[test]
    fn v0_44_to_0_45_only_bumps_version() {
        // 足した欄（車の買い替え・リース。0101）は任意なので、前の版の車はそのまま（買い替え続ける）
        let b = serde_json::json!({
            "meta": {"formatVersion": "0.44"},
            "household": {"request": {"input": {"baseMonth": "2026-10", "household": {"cars": [
                {"id": "k1", "owner": "m1", "purchase": {"first": {"at": "2029-04"}, "everyYears": 8, "price": 2500000}}
            ]}}}}
        });
        let u = upgrade("0.44", b.clone()).unwrap();
        assert_eq!(u["meta"]["formatVersion"], "0.46");
        assert_eq!(u["household"], b["household"]);
    }

    #[test]
    fn v0_45_to_0_46_only_bumps_version() {
        // 足した欄（夢プラン・子への援助の優先度。0103）は任意なので、前の版の行と援助はそのまま（援助は「必ず」）
        let b = serde_json::json!({
            "meta": {"formatVersion": "0.45"},
            "household": {"request": {"input": {"baseMonth": "2026-10", "household": {
                "periodicExpenses": [{"id": "p1", "row": "cf.expense.lumpSum.other", "from": {"at": "2030-04"}, "to": {"at": "2030-04"}, "everyYears": 1, "amount": {"value": 500000, "state": "confirmed", "origin": {"kind": "manual"}}, "priority": "wish"}],
                "goals": [{"id": "g1", "kind": "education", "owner": "c1", "education": {"stages": [], "gifts": [{"id": "x1", "at": {"at": "2050-04"}, "amount": 1000000, "purpose": "wedding"}]}}]
            }}}}
        });
        let u = upgrade("0.45", b.clone()).unwrap();
        assert_eq!(u["meta"]["formatVersion"], "0.46");
        assert_eq!(u["household"], b["household"]);
    }

    #[test]
    fn v0_42_to_0_43_without_unknowns_only_bumps_version() {
        let b = serde_json::json!({
            "meta": {"formatVersion": "0.42"},
            "household": {"request": {"input": {"household": {"livingExpenses": [
                {"id": "l1", "mode": "total", "monthly": {"value": 264000, "state": "estimated", "origin": {"kind": "auto"}, "estimate": {"method": "statistic", "basis": "家計調査"}}}
            ]}}}}
        });
        let u = v0_42_to_0_43(b.clone()).unwrap();
        assert_eq!(u["meta"]["formatVersion"], "0.43");
        assert_eq!(u["household"], b["household"]);
    }

    #[test]
    fn v0_41_to_0_42_only_bumps_version() {
        // 高専・専門職大学院の段・法科大学院の系統は選べる値が増えただけ。前の版の段は書き換えない
        let b = serde_json::json!({
            "meta": {"formatVersion": "0.41"},
            "household": {"request": {"input": {"household": {"goals": [
                {"id": "g1", "kind": "education", "owner": "c1", "education": {"stages": [{"stage": "highSchool", "sector": "public"}, {"stage": "graduateMaster", "sector": "national"}]}}
            ]}}}}
        });
        let u = upgrade("0.41", b.clone()).unwrap();
        assert_eq!(u["meta"]["formatVersion"], CURRENT);
        assert_eq!(u["household"], b["household"]);
    }

    #[test]
    fn v0_40_to_0_41_only_bumps_version() {
        // 大学院の段・インターナショナルスクールは選べる値が増えただけ。前の版の段は書き換えない
        let b = serde_json::json!({
            "meta": {"formatVersion": "0.40"},
            "household": {"request": {"input": {"household": {"goals": [
                {"id": "g1", "kind": "education", "owner": "c1", "education": {"stages": [{"stage": "highSchool", "sector": "private"}, {"stage": "university", "sector": "national"}]}}
            ]}}}}
        });
        let u = upgrade("0.40", b.clone()).unwrap();
        assert_eq!(u["meta"]["formatVersion"], CURRENT);
        assert_eq!(u["household"], b["household"]);
    }

    #[test]
    fn v0_39_to_0_40_keeps_old_abroad_rows() {
        // 前の版の留学（出るお金の行・種類 教育費）はそのまま残し、教育の目標の留学（0088）は足さない
        let b = serde_json::json!({
            "meta": {"formatVersion": "0.39"},
            "household": {"request": {"input": {"household": {
                "goals": [{"id": "g1", "kind": "education", "owner": "c1", "education": {"stages": [{"stage": "university", "sector": "private"}]}}],
                "periodicExpenses": [{"id": "e1", "label": "留学", "kind": "education", "row": "cf.expense.education", "from": {"memberAge": {"member": "c1", "years": 20}}, "everyYears": 1}]
            }}}}
        });
        let u = upgrade("0.39", b.clone()).unwrap();
        assert_eq!(u["meta"]["formatVersion"], CURRENT);
        assert_eq!(u["household"], b["household"]);
    }

    #[test]
    fn v0_37_leaves_estimated_smr_blank() {
        // 給与からの推定のままの標準報酬月額は外し（エンジンが給与から毎年決め直す）、FP の入れた値は残す（0047 の追記 2026-10-29 の2）
        let est = |v: i64| serde_json::json!({"value": v, "state": "estimated", "origin": {"kind": "auto"}, "estimate": {"method": "derived", "basis": "年収（賞与を除く）÷12 を標準報酬月額の等級表に当てた目安"}});
        let fp = |v: i64| serde_json::json!({"value": v, "state": "confirmed", "origin": {"kind": "manual"}});
        let unknown = |v: i64| serde_json::json!({"state": "unknown", "origin": {"kind": "manual"}, "substitute": {"value": v, "state": "estimated", "origin": {"kind": "auto"}, "estimate": {"method": "derived", "basis": "目安"}}});
        let previous = |v: i64| serde_json::json!({"state": "unknown", "origin": {"kind": "manual"}, "substitute": {"value": v, "state": "estimated", "origin": {"kind": "auto"}, "estimate": {"method": "standard", "basis": "前に入れた値"}}});
        let b = serde_json::json!({
            "meta": {"formatVersion": "0.37"},
            "household": {
                "request": {"input": {"household": {"employmentPeriods": [
                    {"id": "p1", "member": "m1", "standardMonthlyRemuneration": {"health": est(300000), "pension": est(300000)}},
                    {"id": "p2", "member": "m1", "standardMonthlyRemuneration": {"health": fp(320000), "pension": est(320000)}},
                    {"id": "p3", "member": "m2", "standardMonthlyRemuneration": {"health": unknown(240000), "pension": est(240000)}},
                    {"id": "p4", "member": "m2", "standardMonthlyRemuneration": {"health": previous(260000), "pension": est(260000)}},
                    {"id": "p5", "member": "m2"}
                ]}}},
                "postRetirement": {"m1": {"fromAge": 60, "type": "contract", "annualSalary": 3600000, "standardMonthlyRemuneration": 300000}, "m2": {"fromAge": 60, "type": "contract", "annualSalary": 3000000, "standardMonthlyRemuneration": 200000}},
                "notices": [{"id": "n0", "kind": "unresolvedDiffs", "count": 1}]
            },
            "proposals": [{"id": "x", "diffs": [
                {"id": "d1", "op": "set", "target": {"object": "p1"}, "item": "employment.standardMonthlyRemuneration", "at": ["health"], "value": est(320000)},
                {"id": "d2", "op": "set", "target": {"object": "p1"}, "item": "employment.salary.annual", "at": [], "value": fp(4000000)},
                {"id": "d3", "op": "set", "target": {"object": "p2"}, "item": "employment.standardMonthlyRemuneration", "at": ["pension"], "value": est(340000)},
                {"id": "d4", "op": "set", "target": {"object": "p1"}, "item": "employment.standardMonthlyRemuneration", "at": ["pension"], "value": fp(340000)},
                {"id": "d5", "op": "add", "target": {"collection": "employment"}, "item": null, "at": [], "value": {"id": "p9", "member": "m1", "standardMonthlyRemuneration": {"health": est(200000), "pension": est(200000)}}},
                {"id": "d6", "op": "set", "target": {"object": "p9"}, "item": "employment.standardMonthlyRemuneration", "at": [], "value": {"health": est(220000), "pension": est(220000)}}
            ]}],
            "snapshots": [{"inputs": {"request": {"input": {"household": {"employmentPeriods": [{"id": "p1", "standardMonthlyRemuneration": {"health": est(300000), "pension": est(300000)}}]}}}}}]
        });
        let u = v0_37_to_0_38(b.clone()).unwrap();
        assert_eq!(u["meta"]["formatVersion"], "0.38");
        let ps = &u["household"]["request"]["input"]["household"]["employmentPeriods"];
        assert!(
            ps[0].get("standardMonthlyRemuneration").is_none(),
            "推定のままは外す"
        );
        assert_eq!(
            ps[1], b["household"]["request"]["input"]["household"]["employmentPeriods"][1],
            "片方を FP が入れた置き換え口は残す"
        );
        assert!(
            ps[2].get("standardMonthlyRemuneration").is_none(),
            "わからない（代わりの値が給与からの推定）も外す"
        );
        assert_eq!(
            ps[3], b["household"]["request"]["input"]["household"]["employmentPeriods"][3],
            "わからないの代わりの値が FP の前の値なら残す"
        );
        assert_eq!(
            ps[4],
            b["household"]["request"]["input"]["household"]["employmentPeriods"][4]
        );
        let post = &u["household"]["postRetirement"];
        assert!(
            post["m1"].get("standardMonthlyRemuneration").is_none(),
            "外した期間の額を写した定年後の予定の額は外す"
        );
        assert_eq!(post["m2"]["standardMonthlyRemuneration"], 200000);
        let ids: Vec<&str> = u["proposals"][0]["diffs"]
            .as_array()
            .unwrap()
            .iter()
            .map(|d| d["id"].as_str().unwrap())
            .collect();
        assert_eq!(
            ids,
            ["d2", "d3", "d4", "d5"],
            "外した期間・現状に無い期間の推定の差分は捨て、FP の値と FP の入れた期間の差分は残す"
        );
        assert!(
            u["proposals"][0]["diffs"][3]["value"]
                .get("standardMonthlyRemuneration")
                .is_none(),
            "足す期間の中の推定も外す"
        );
        assert_eq!(u["snapshots"], b["snapshots"], "控えの中身は変えない");
        let notices = u["household"]["notices"].as_array().unwrap();
        assert_eq!(notices.len(), 2);
        assert_eq!(notices[0]["kind"], "unresolvedDiffs");
        assert_eq!(notices[1]["kind"], "smrBlank");
        assert_eq!(notices[1]["count"], 2);
        assert_eq!(notices[1]["plans"], 3);
        // 推定が無ければ知らせは足さない
        let plain = serde_json::json!({"meta": {"formatVersion": "0.37"}, "household": {"request": {"input": {"household": {"employmentPeriods": [{"id": "p2", "standardMonthlyRemuneration": {"health": fp(1), "pension": est(1)}}]}}}}});
        let u = upgrade("0.37", plain.clone()).unwrap();
        assert!(u["household"].get("notices").is_none());
        assert_eq!(u["household"]["request"], plain["household"]["request"]);
    }

    #[test]
    fn v0_11_drops_the_removed_emergency_reserve() {
        // 生活防衛資金（0031 の追記でなくした）の前提・プランの差分・対策に足した項目を捨て、ほかの前提・差分・控えは変えない
        let b = serde_json::json!({
            "meta": {"formatVersion": "0.11", "revisions": [], "editors": {}},
            "household": {"request": {"input": {"assumptions": {"surplusSaving": {"ratio": "0.6"}, "emergencyReserve": {"months": 6}}}}},
            "proposals": [{"id": "p1", "diffs": [
                {"key": "surplus:ratio", "item": "assumptions.surplusSaving"},
                {"key": "reserve:months", "item": "assumptions.emergencyReserve"},
                {"key": "x", "item": "assumptions.emergencyReserve"}
            ]}, {"id": "p2"}],
            "workspace": {"shownItems": ["surplus:ratio", "reserve:months"]},
            "snapshots": [{"inputs": {"request": {"input": {"assumptions": {"emergencyReserve": {"months": 6}}}}}}]
        });
        let u = upgrade("0.11", b.clone()).unwrap();
        assert_eq!(u["meta"]["formatVersion"], CURRENT);
        let a = &u["household"]["request"]["input"]["assumptions"];
        assert!(a.get("emergencyReserve").is_none());
        assert_eq!(a["surplusSaving"]["ratio"], "0.6");
        // 0.17 で差分は当て先（ここでは合成の対策）の形に、対策に足した項目は当て先に読み替わる
        assert_eq!(
            u["proposals"][0]["diffs"],
            serde_json::json!([{"op": "set", "target": {"lever": "surplusRatio"}, "item": "assumptions.surplusSaving", "at": [], "legacy": {"key": "surplus:ratio", "target": null, "item": "assumptions.surplusSaving"}}])
        );
        assert_eq!(u["proposals"][1], b["proposals"][1]);
        assert_eq!(
            u["workspace"]["shownItems"],
            serde_json::json!([{"target": {"lever": "surplusRatio"}, "item": null, "at": []}])
        );
        assert_eq!(u["snapshots"], b["snapshots"], "控えの中身は変えない");
        // 前提・プラン・対策の無い本文もそのまま
        let bare = serde_json::json!({"meta": {"formatVersion": "0.11"}, "household": {}});
        assert_eq!(
            upgrade("0.11", bare).unwrap()["household"],
            serde_json::json!({})
        );
        assert!(upgrade("0.11", serde_json::json!(null)).is_err());
    }

    #[test]
    fn v0_1_gains_empty_editor_records() {
        let b = serde_json::json!({"meta": {"formatVersion": "0.1", "customerNo": "A1"}, "household": {"memo": ["x"]}});
        let u = upgrade("0.1", b).unwrap();
        assert_eq!(u["meta"]["revisions"], serde_json::json!([]));
        assert_eq!(u["meta"]["editors"], serde_json::json!({}));
        assert_eq!(u["meta"]["formatVersion"], CURRENT);
        assert_eq!(u["meta"]["customerNo"], "A1");
        assert_eq!(u["household"]["memo"], serde_json::json!(["x"]));
        // meta の無い本文にも足す。既にある値は変えない
        let u2 = upgrade("0.1", serde_json::json!({"meta": {"revisions": [1]}})).unwrap();
        assert_eq!(u2["meta"]["revisions"], serde_json::json!([1]));
        assert!(upgrade("0.1", serde_json::json!([])).is_err());
    }

    #[test]
    fn v0_2_keeps_everything_and_has_no_snapshots_section() {
        let b = serde_json::json!({"meta": {"formatVersion": "0.2", "revisions": [], "editors": {}}, "household": {"memo": ["x"]}, "ext": {"ext.a.b": 1}});
        let u = upgrade("0.2", b.clone()).unwrap();
        assert_eq!(u["meta"]["formatVersion"], CURRENT);
        assert_eq!(u["household"], b["household"]);
        assert_eq!(u["ext"], b["ext"]);
        assert!(
            u.get("snapshots").is_none(),
            "控えの区画は任意なので足さない"
        );
        // 0.1 からも1段ずつ今の版へ
        let u1 = upgrade("0.1", serde_json::json!({"meta": {"formatVersion": "0.1"}})).unwrap();
        assert_eq!(u1["meta"]["formatVersion"], CURRENT);
        assert!(upgrade("0.2", serde_json::json!("x")).is_err());
    }

    #[test]
    fn v0_3_keeps_everything_and_adds_no_valuation() {
        let b = serde_json::json!({"meta": {"formatVersion": "0.3", "revisions": [], "editors": {}}, "household": {"request": {"input": {"household": {"residences": [{"kind": "own"}]}}}}, "snapshots": [{"a": 1}]});
        let u = upgrade("0.3", b.clone()).unwrap();
        assert_eq!(u["meta"]["formatVersion"], CURRENT);
        assert_eq!(
            u["household"], b["household"],
            "評価・売却の欄は任意なので足さない"
        );
        assert_eq!(u["snapshots"], b["snapshots"]);
        assert!(upgrade("0.3", serde_json::json!(1)).is_err());
    }

    #[test]
    fn v0_4_keeps_empty_contribution_ends_as_they_are() {
        // 積立の終わりが空の積立・受け取りの始まりが空の iDeCo は、書き換えずに新しい読み方（退職の月まで・退職の年。推定）で読む
        let acc = serde_json::json!([{"kind": "nisa", "contributions": [{"from": {"at": "2026-01"}, "to": null, "monthly": 30000}]}, {"kind": "ideco", "contributions": []}]);
        let b = serde_json::json!({"meta": {"formatVersion": "0.4", "revisions": [], "editors": {}}, "household": {"request": {"input": {"household": {"accounts": acc}}}}});
        let u = upgrade("0.4", b.clone()).unwrap();
        assert_eq!(u["meta"]["formatVersion"], CURRENT);
        assert_eq!(u["household"], b["household"]);
        assert!(upgrade("0.4", serde_json::json!(null)).is_err());
    }

    #[test]
    fn v0_5_keeps_real_estate_without_contents() {
        // 中身（property）の無い不動産の器は、そのまま今までどおり（評価額の増減率で1行）に読む。中身もローンの指定も足さない（0028）
        let acc = serde_json::json!([{"kind": "realEstate", "marketValue": {"value": 18000000}, "valueGrowth": "-0.005", "contributions": []}]);
        let debts = serde_json::json!([{"kind": "other", "principal": 1000000}]);
        let b = serde_json::json!({"meta": {"formatVersion": "0.5", "revisions": [], "editors": {}}, "household": {"request": {"input": {"household": {"accounts": acc, "debts": debts}}}}});
        let u = upgrade("0.5", b.clone()).unwrap();
        assert_eq!(u["meta"]["formatVersion"], CURRENT);
        assert_eq!(u["household"], b["household"]);
        assert!(upgrade("0.5", serde_json::json!(null)).is_err());
    }

    #[test]
    fn v0_6_keeps_display_and_adds_no_columns() {
        // 並べる時点の欄は任意なので足さない（無ければ画面が既定で読む）。ほかの表示の設定はそのまま
        let b = serde_json::json!({"meta": {"formatVersion": "0.6", "revisions": [], "editors": {}}, "household": {"memo": ["x"]}, "display": {"metrics": ["takeHome"], "bsGuide": {"months": [6, 12], "risk": [10, 40], "debt": 50}}});
        let u = upgrade("0.6", b.clone()).unwrap();
        assert_eq!(u["meta"]["formatVersion"], CURRENT);
        // 0.7 → 0.8 で区画へ移る（中身は同じ）
        assert_eq!(u["display"]["result"]["metrics"], b["display"]["metrics"]);
        assert_eq!(u["display"]["balance"]["guide"], b["display"]["bsGuide"]);
        assert!(u["display"]["balance"].get("columns").is_none());
        assert!(upgrade("0.6", serde_json::json!(null)).is_err());
    }

    #[test]
    fn v0_7_moves_display_into_tab_sections_and_drops_dock() {
        let display = serde_json::json!({
            "metrics": ["takeHome"], "atAge": 90, "layout": "side", "invBreakdown": true, "invPeriods": null, "dock": "large",
            "bsGuide": {"months": [6, 12], "risk": [10, 40], "debt": 50},
            "bsPoints": ["now", "retire", "age75"], "bsColumns": [{"point": "now"}, {"year": 2042}],
            "ext.unknown": 1
        });
        let b = serde_json::json!({"meta": {"formatVersion": "0.7", "revisions": [], "editors": {}}, "household": {"memo": ["x"]}, "display": display});
        let u = upgrade("0.7", b.clone()).unwrap();
        assert_eq!(u["meta"]["formatVersion"], CURRENT);
        assert_eq!(u["household"], b["household"]);
        let d = &u["display"];
        assert_eq!(
            d["result"],
            serde_json::json!({"metrics": ["takeHome"], "atAge": 90, "layout": "side", "invBreakdown": true, "invPeriods": null})
        );
        assert_eq!(
            d["balance"],
            serde_json::json!({"guide": {"months": [6, 12], "risk": [10, 40], "debt": 50}, "points": ["now", "retire", "age75"], "columns": [{"point": "now"}, {"year": 2042}]})
        );
        assert!(d.get("dock").is_none(), "なくした設定は持たない");
        for k in ["metrics", "bsGuide", "bsPoints", "bsColumns"] {
            assert!(d.get(k).is_none(), "{k} は区画へ移す");
        }
        assert_eq!(d["ext.unknown"], 1, "知らない欄は失わない");
        // 表示の設定の無い本文には足さない。ある値だけ移す
        let none = upgrade("0.7", serde_json::json!({"meta": {"formatVersion": "0.7"}})).unwrap();
        assert!(none.get("display").is_none());
        let some = upgrade("0.7", serde_json::json!({"display": {"atAge": 80}})).unwrap();
        assert_eq!(
            some["display"],
            serde_json::json!({"result": {"atAge": 80}, "balance": {}})
        );
        assert!(upgrade("0.7", serde_json::json!(null)).is_err());
    }

    #[test]
    fn v0_16_changes_the_shapes_in_one_step() {
        // 0035 の10: 並びの要素の ID・世帯の外の家族・仮の印・プランの差分・対策に足した項目。控え・拡張領域は変えない
        let s = "11111111-1111-4111-8111-111111111111";
        let p = "22222222-2222-4222-8222-222222222222";
        let c = "33333333-3333-4333-8333-333333333333";
        let d = "44444444-4444-4444-8444-444444444444";
        let debt = "55555555-5555-4555-8555-555555555555";
        let res = "66666666-6666-4666-8666-666666666666";
        let birth = serde_json::json!({"birthYearMonth": "1980-04", "bornOnFirst": false});
        let member = |id: &str, kind: &str| serde_json::json!({"id": id, "kind": kind, "birth": birth, "sex": "female", "joins": null, "leaves": null, "expected": false});
        let b = serde_json::json!({
            "meta": {"formatVersion": "0.16", "revisions": [], "editors": {}},
            "household": {
                "request": {"trace": "none", "input": {
                    "baseMonth": "2026-10",
                    "endYear": 2080,
                    "household": {
                        "members": [member(s, "self"), member(c, "child"), member(p, "parent")],
                        "relations": [{"type": "parentOf", "parent": p, "child": s}, {"type": "parentOf", "parent": s, "child": c}],
                        "events": [], "employmentPeriods": [], "accounts": [], "insuranceContracts": [],
                        "debts": [{"id": debt, "kind": "mortgage", "principal": 30000000, "rateSchedule": [{"from": {"at": "2026-10"}, "type": "fixed", "rate": "0.008"}, {"from": {"at": "2031-10"}, "type": "fixed", "rate": "0.01"}]}],
                        "residences": [{"id": res, "kind": "own", "purchase": {"price": 40000000, "gifts": [{"recipient": c, "donor": d, "amount": 1000000}]}}],
                        "donors": [{"id": d, "kind": "grandparent", "of": s}]
                    },
                    "assumptions": {"investmentReturn": {"default": "0.02"}, "surplusSaving": {"ratio": "0.5", "changes": [{"from": {"at": "2030-01"}, "ratio": "0.3"}]}}
                }},
                "assumed": {
                    format!("housing/debt/{debt}/principal"): "物件の価格−頭金",
                    format!("family/{s}/birth"): "仮の値（40歳として計算）",
                    "unknown/key": "残る"
                }
            },
            "proposals": [{"id": "p1", "title": "プランB", "base": null, "diffs": [
                {"id": "d1", "key": format!("field:housing/debt/{debt}/principal"), "target": {"object": debt}, "item": "debt.principal", "op": "set", "value": {"value": 25000000, "state": "confirmed", "origin": {"kind": "manual"}}, "before": {"value": 30000000, "state": "confirmed", "origin": {"kind": "manual"}}, "enabled": true, "origin": {"kind": "manual"}, "note": null},
                {"id": "d2", "key": "lever:retireAge", "target": {"member": s}, "item": "employment.to", "op": "set", "value": {"value": 65, "state": "confirmed", "origin": {"kind": "manual"}}, "before": {"value": 60, "state": "confirmed", "origin": {"kind": "manual"}}, "enabled": false, "origin": {"kind": "manual"}, "note": null},
                {"id": "d3", "key": format!("field:housing/debt/{debt}/rate/1/rate"), "target": {"object": debt}, "item": "debt.rateSchedule", "op": "set", "value": {"value": "0.012", "state": "confirmed", "origin": {"kind": "manual"}}, "before": {"value": "0.01", "state": "confirmed", "origin": {"kind": "manual"}}, "enabled": true, "origin": {"kind": "manual"}, "note": null},
                {"id": "d4", "key": "field:weird/key", "target": {"plan": "assumptions"}, "item": "screen", "op": "set", "value": {"value": 1, "state": "confirmed", "origin": {"kind": "manual"}}, "before": {"value": 0, "state": "confirmed", "origin": {"kind": "manual"}}, "enabled": true, "origin": {"kind": "manual"}, "note": "そのまま残る"}
            ]}],
            "workspace": {"template": null, "band": [], "base": "current", "selected": "current", "shownItems": [format!("loan:{debt}:principal"), "lever:retireAge", "nope"]},
            "snapshots": [{"inputs": {"request": {"input": {"household": {"donors": [{"id": d, "kind": "grandparent"}]}}}}}],
            "ext": {"ext.a.b": 1}
        });
        let u = upgrade("0.16", b.clone()).unwrap();
        assert_eq!(u["meta"]["formatVersion"], CURRENT);
        let h = &u["household"]["request"]["input"]["household"];
        // 世帯の外の家族: 親は印を付け（of は親とする関係の子）、贈与者は同じ ID の構成員になる。donors は無くなる
        let ms = h["members"].as_array().unwrap();
        assert_eq!(ms.len(), 4);
        assert_eq!(
            ms[2]["outside"],
            serde_json::json!({"periods": [], "of": s})
        );
        assert_eq!(ms[2]["birth"], birth, "親の生年月・同居の印などは変えない");
        assert!(ms[0].get("outside").is_none() && ms[1].get("outside").is_none());
        assert_eq!(
            ms[3],
            serde_json::json!({"id": d, "kind": "grandparent", "joins": null, "leaves": null, "expected": false, "outside": {"of": s, "periods": []}})
        );
        assert!(h.get("donors").is_none());
        assert_eq!(
            h["residences"][0]["purchase"]["gifts"][0]["donor"], d,
            "援助の贈与者はそのまま当たる"
        );
        // 並びの要素の ID は場所から決まる
        let rate1 = readings::migration_id(&format!("{debt}/rateSchedule/1"));
        assert_eq!(h["debts"][0]["rateSchedule"][1]["id"], rate1.as_str());
        assert_eq!(
            h["residences"][0]["purchase"]["gifts"][0]["id"],
            readings::migration_id(&format!("{res}/purchase/gifts/0")).as_str()
        );
        assert_eq!(
            h["relations"][0]["id"],
            readings::migration_id(&format!("relations/0/{p}/{s}")).as_str()
        );
        assert_eq!(
            u["household"]["request"]["input"]["assumptions"]["surplusSaving"]["changes"][0]["id"],
            readings::migration_id("assumptions/surplusSaving/changes/0").as_str()
        );
        // 仮の印は値の状態の欄（推定）へ。移せない印は残る
        assert_eq!(
            h["debts"][0]["valueStates"]["debt.principal"],
            serde_json::json!({"state": "estimated", "origin": {"kind": "auto"}, "estimate": {"method": "derived", "basis": "物件の価格−頭金"}})
        );
        assert_eq!(
            ms[0]["valueStates"]["member.birth"]["estimate"]["method"],
            "standard"
        );
        assert_eq!(
            u["household"]["assumed"],
            serde_json::json!({"unknown/key": "残る"})
        );
        // プランの差分は当て先の形に
        let diffs = u["proposals"][0]["diffs"].as_array().unwrap();
        assert_eq!(diffs[0]["target"], serde_json::json!({"object": debt}));
        assert_eq!(diffs[0]["item"], "debt.principal");
        assert_eq!(diffs[0]["at"], serde_json::json!([]));
        assert_eq!(
            diffs[0]["legacy"]["key"],
            format!("field:housing/debt/{debt}/principal")
        );
        assert!(diffs[0].get("key").is_none());
        assert_eq!(diffs[0]["value"], b["proposals"][0]["diffs"][0]["value"]);
        assert_eq!(
            diffs[1]["target"],
            serde_json::json!({"lever": "retireAge"})
        );
        assert_eq!(diffs[1]["enabled"], false);
        assert_eq!(diffs[2]["at"], serde_json::json!([rate1, "rate"]));
        assert_eq!(diffs[3]["unresolved"], true);
        assert_eq!(diffs[3]["at"], Value::Null);
        assert_eq!(diffs[3]["note"], "そのまま残る");
        // 対策に足した項目は当て先に（読み替えられない項目は捨てる）
        assert_eq!(
            u["workspace"]["shownItems"],
            serde_json::json!([{"target": {"object": debt}, "item": "debt.principal", "at": []}, {"target": {"lever": "retireAge"}, "item": null, "at": []}])
        );
        // 開いたときの知らせ
        let notices = u["household"]["notices"].as_array().unwrap();
        assert_eq!(notices[0]["kind"], "outsideFamily");
        assert_eq!(notices[0]["members"], serde_json::json!([p]));
        assert_eq!(
            notices[1],
            serde_json::json!({"id": readings::migration_id("notices/unresolvedDiffs/1"), "kind": "unresolvedDiffs", "count": 1})
        );
        // 控え・拡張領域は1文字も変えない。同じ本文からは同じ結果
        assert_eq!(u["snapshots"], b["snapshots"]);
        assert_eq!(u["ext"], b["ext"]);
        assert_eq!(upgrade("0.16", b).unwrap(), u);
        assert!(upgrade("0.16", serde_json::json!(null)).is_err());
    }

    #[test]
    fn v0_8_keeps_nursery_stage_without_monthly() {
        // 保育所の段の空の月額は書き換えない（新しい読み方で収入から自動で計算する）。足した欄は足さない
        let goals = serde_json::json!([{"id": "g", "kind": "education", "owner": "c", "education": {"stages": [{"stage": "nursery"}, {"stage": "nursery", "monthly": 0}]}}]);
        let b = serde_json::json!({"meta": {"formatVersion": "0.8", "revisions": [], "editors": {}}, "household": {"request": {"input": {"household": {"goals": goals}}}}, "display": {"result": {}, "balance": {}}});
        let u = upgrade("0.8", b.clone()).unwrap();
        assert_eq!(u["meta"]["formatVersion"], CURRENT);
        // 0.17 で段に ID が付くほかは同じ
        let stages =
            &u["household"]["request"]["input"]["household"]["goals"][0]["education"]["stages"];
        assert!(stages[0].get("monthly").is_none());
        assert_eq!(stages[1]["monthly"], 0);
        assert!(stages[0]["id"].is_string() && stages[1]["id"].is_string());
        assert_eq!(u["display"], b["display"]);
        assert!(upgrade("0.8", serde_json::json!(null)).is_err());
    }

    #[test]
    fn v0_16_parent_without_relation_is_family_of_self_and_no_state_for_missing_places() {
        // 親とする関係の無い親・祖父母は本人の家族（0035 の4。省けるのは贈与者から作った人だけ）。
        // 無い要素・まだ入れていない欄への仮の印は、値の状態の行にしない（0035 の3）
        let s = "11111111-1111-4111-8111-111111111111";
        let g = "22222222-2222-4222-8222-222222222222";
        let l = "33333333-3333-4333-8333-333333333333";
        let birth = serde_json::json!({"birthYearMonth": "1950-04", "bornOnFirst": false});
        let b = serde_json::json!({
            "meta": {"formatVersion": "0.16", "revisions": [], "editors": {}},
            "household": {
                "request": {"trace": "none", "input": {"baseMonth": "2026-10", "endYear": 2080, "household": {
                    "members": [
                        {"id": s, "kind": "self", "birth": birth, "sex": "male", "joins": null, "leaves": null, "expected": false},
                        {"id": g, "kind": "grandparent", "birth": birth, "sex": "female", "joins": null, "leaves": null, "expected": false}
                    ],
                    "relations": [], "events": [], "employmentPeriods": [], "accounts": [], "insuranceContracts": [],
                    "livingExpenses": [{"id": l, "mode": "total", "monthly": {"value": 250000, "state": "confirmed", "origin": {"kind": "manual"}}, "stages": [{"at": {"at": "2040-04"}, "ratio": "0.8"}]}]
                }}},
                "assumed": {format!("living/{l}/stage/0/ratio"): "仮の割合", format!("living/{l}/stage/3/ratio"): "無い段"}
            },
            "proposals": []
        });
        let u = upgrade("0.16", b).unwrap();
        let h = &u["household"]["request"]["input"]["household"];
        assert_eq!(h["members"][1]["outside"]["of"], s);
        let states = &h["livingExpenses"][0]["valueStates"];
        let keys: Vec<&String> = states.as_object().unwrap().keys().collect();
        assert_eq!(keys.len(), 1, "{keys:?}");
        assert!(u["household"].get("assumed").is_none());
        assert!(
            crate::readings::value_state_problems(&u["household"]["request"]["input"]).is_empty()
        );
    }
}
