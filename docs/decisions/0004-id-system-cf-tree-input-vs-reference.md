# 0004. ID体系と科目の木・入力値と参照値

- 状態: 採用（一部未確定）（2026-10-08）
- 固定の強さ: β公開から変えない（骨格）。各IDの一覧（登録簿）と科目の木は公開の約束（安定）。明細の段の科目は追加だけ可

## 背景

ファイナンシアでは、同じ「項目」を多くの場所が指す。移行の読み取り規則、ヒアリングシート、FPのAI、カスタム部品、提案の差分、手修正、帳票、根拠の記録。どれかが項目を名前（日本語の見出し）で指すと、言い回しを変えただけで全部が壊れる。

また、他のソフトから移行するときは、旧ソフトが計算した結果（キャッシュフロー表の数字）を取り込む。これを入力と混ぜると、旧ソフトの計算の誤りや前提の違いがそのまま入り、照合（差を説明すること）もできなくなる。

## 決定

### 1. ID の6種類

| 種類 | 例 | 用途 | 欄名の例 |
|---|---|---|---|
| 入力項目ID | `income.salary.annual` | データモデルの項目。移行・ヒアリング・AI・提案の差分の対応先 | `item` |
| 計算部品ID | `pension.oldAge.basic` | 部品表での差し替えの単位。取り下げの単位にもなる（0006・0009） | `component` |
| 制度の値ID | `incomeTax.basicDeduction` | 制度データの値。取り下げもこの単位（0007） | `param` |
| 出力の行ID | `cf.expense.housing.loan` | キャッシュフロー表などの科目。照合・帳票・手修正 | `row` |
| ヒアリング項目のキー | `hs.income.salary` | ヒアリングシートの項目。入力項目IDへの変換表はシート定義に持つ（0018） | `hsKey` |
| 世帯内の物のID | （乱数。下の4） | ローン1本・保険1件・目標1件・イベント1件ごと。提案の差分・候補が指す先 | `object` |

- 世帯の中で「どの物のどの項目か」を指すときは、物のIDと入力項目IDの組で指す（例: `{"object": "（ローンのID）", "item": "loan.rate.initial"}`）。入力項目IDは「項目の種類」で、物のIDは「どの1件か」を表す。

### 2. 名前の付け方（乱数ID以外の5種類）

- 点区切り。各段は英小文字で始まる英数字（lowerCamelCase）。書式は `^[a-z][a-zA-Z0-9]*(\.[a-z][a-zA-Z0-9]*)+$`。
- 段は大きい分類から順に並べる（`分野.対象.中身`）。
- 接頭辞の予約:
  - `cf.` … キャッシュフロー表の行
  - `hs.` … ヒアリング項目
  - `conv.` … エンジンの規約（端数処理など。0002）
  - `slot.` … 差し込み口（0006）
  - `ext.<作成者>.` … 利用者の拡張（拡張領域・カスタム部品の独自ID。0011・0016）
  - `test.` … テスト専用（製品のデータに現れたらエラー）
- 日本語の表示名はIDに入れず、登録簿（下の5）に別に持つ。画面の言葉を変えてもIDは変わらない。
- 種類をまたいでも同じ文字列は使わない（AIが取り違えないように）。CIで検査する。

### 3. 使い回しの禁止・廃止・別名

- 一度公開したIDは、別の意味に使い回さない。
- 廃止しても登録簿から消さず、状態を `deprecated`（新しく使わない。読み込みは続ける）か `removed`（もう現れない。欠番）にする。
- 名前を付け直すときは、新しいIDを作り、古いIDを新しいIDの別名（`aliases`）として登録する。読み込みのときに別名を新しいIDへ置き換える。
- 意味が変わるとき（例: 制度の仕組みが変わって中身が別物になる）は、同じ系統の別IDにする（新旧の制度の切り替えは 0006・0007）。

### 4. 乱数ID

- 世帯の内部ID・構成員のID・PCのID・世帯内の物のIDは、すべて UUID 第4版（122ビットの乱数）を、小文字・ハイフンつきの36文字で書く（例: `3f2b8c1e-9a4d-4e7b-8c21-5d0f6a9b7e10`）。
- 接頭辞は付けない。何のIDかは、それが入っている欄と配列で分かる。
- 作成日時・PC・人の情報を含めない（0012）。
- 乱数はアプリ本体（Rust）で作る。計算エンジンは乱数を持たないので、IDを作らない（0005）。
- 世帯内の物のIDは、その世帯ファイルの中で一意であればよい。プランを複製しても物のIDは変えない（差分が同じ物を指し続けるため）。ひな形から新しい世帯を作るときは、すべて振り直す。

### 5. 登録簿

- 入力項目ID・計算部品ID・制度の値ID・出力の行ID・ヒアリング項目のキーは、種類ごとに機械で読める登録簿に載せる。登録簿の1件:

```yaml
- id: income.salary.annual
  status: active        # active | deprecated | removed
  label: 給与収入（年額）
  since: household-file@1.0
  aliases: []
  replacedBy: null
```

- 入力項目IDの正本はデータモデル（JSON Schema）。登録簿はスキーマから作り、手で食い違わないようにする。ヒアリングのシート定義は、その上の「見せ方」として入力項目IDを指す。
- 計算部品IDは部品のマニフェスト（0006）、制度の値IDは制度データ（0007）から集める。
- 登録簿は SDK フォルダ（0019）にも同梱し、FPのAIが参照できるようにする。

### 6. キャッシュフロー表の科目の木

- 科目は木構造（大分類→中分類→明細）で、IDを固定する。
- 大分類（第1段）と中分類（第2段）はこの記録で固定する。

| 大分類 | 中分類（ID の例） |
|---|---|
| `cf.income` 収入 | `.salary` 給与、`.business` 事業、`.pension` 公的年金、`.corporatePension` 企業年金・個人年金、`.lumpSum` 一時金（退職金・保険金・満期金）、`.benefit` 給付・手当（児童手当・育休給付など）、`.other` その他 |
| `cf.taxSi` 税・社会保険料 | `.incomeTax` 所得税（復興特別所得税を含む）、`.residentTax` 住民税、`.businessTax` 個人事業税、`.health` 健康保険・国保・後期高齢者医療、`.care` 介護保険、`.pension` 厚生年金・国民年金、`.employment` 雇用保険、`.childSupport` 子ども・子育て支援金 |
| `cf.expense` 支出 | `.living` 基本生活費、`.housing` 住居関連費（`.rent` 家賃、`.loan` 住宅ローン、`.propertyTax` 固定資産税、`.maintenance` 修繕・管理費）、`.education` 教育費、`.insurance` 保険料、`.debt` 住宅ローン以外の負債の返済、`.lumpSum` 一時的支出、`.care` 介護・医療、`.other` その他 |
| `cf.transfer` 器の間の移動 | `.nisa` NISAへの積立、`.ideco` iDeCo・DCの掛金、`.savings` 財形・積立預金、`.withdrawal` 取り崩し |
| `cf.net` 年間収支 | （収入−税・社会保険料−支出） |
| `cf.balance` 残高 | `.financial` 金融資産の合計、`.account` 器ごと、`.return` 運用益、`.debt` 負債残高 |

- 明細（第3段以下）は登録簿に足していく。足すのは自由だが、消す・意味を変えるのは上の3の規則に従う。
- 行は「行ID」だけでなく、必要に応じて構成員のIDや物のIDと組で持つ（例: 夫と妻の給与は同じ `cf.income.salary` に `member` を付けて分ける。ローンが2本なら `object` で分ける）。
- 税・社会保険料を `cf.expense` の下ではなく独立した大分類 `cf.taxSi` に置く。表示は次の2つを切り替えられ、どちらも同じ木の上の「見せ方」の宣言で作る。
  - **額面方式**: 収入を額面で載せ、税・社会保険料を支出の側に並べる。
  - **可処分所得方式**: 収入から税・社会保険料を引いた「可処分所得」の行を作り、その下に支出を並べる（国内のFPの標準の様式と同じ考え方）。
- 器の間の移動（NISAへの積立など）は収支（`cf.net`）に含めない。資産の器（0008）の残高の増減として扱う。
- 差し込み口から追加の行を出すときは、差し込み口ごとに決めた枝の下に `ext.<作成者>.<キー>` で置く（例: `cf.expense.other.ext.example.petCare`）。
- 移行元のソフトの科目との対応は、移行の読み取り規則・用語辞書の側に持ち、科目の木には入れない。
- 科目の木の正本は機械で読めるファイル（登録簿の出力の行ID）に置き、この表はその上2段の要約とする。

### 7. 入力値と参照値を分ける

- **入力値**: 世帯の事実と前提。計算の入力になる。状態（確定・わからない・該当なし・推定）と出どころ（手入力・ヒアリング・移行・AI・自動・上書き・手修正）と承認の記録を持つ（値の状態は 0008）。
- **計算結果**: いつもエンジンが入力から計算し直して作る。作業中のプランには保存しない（顧客に見せた版の控えにだけ保存する。0009）。
- **参照値**: 外から来た「計算結果」。旧ソフトのキャッシュフロー表の数字などで、照合のためだけに持つ。
  - 置き場所は取り込みの記録（0011）。1件の形: `{"row": "cf.income.pension"（対応する行IDがなければ null）, "year": 2035, "amount": 1834000, "label": "（伏せ字後の元の見出し）", "basisMonth": "（旧プランの計算基準日）"}`。
  - **エンジンの入力のスキーマには参照値の欄を作らない**（`additionalProperties: false`）。参照値が計算に入ることは仕組みの上で起きない。
  - 参照値を入力として使いたいときは、FPの操作で「候補」（提案の差分と同じ形。0008）に変え、出どころ「移行」として承認する。
- 「計算に使うかどうか」で入力値と参照値を分ける。
  - ねんきん定期便の見込額、返済額の直接入力、手取りの直接入力のように、計算の代わりに使う値は**入力値**。部品ごとに決めた「置き換え口」（0006）を通して入れる。
  - 比べるだけの値は**参照値**。
- キャッシュフロー表のセルの手修正は入力値の一種で、`{"row": ..., "year": ..., "member"/"object": ..., "amount": ...}` をキーに保存する。計算の後に重ね、根拠に「手修正」と出す。計算結果そのものは保存しない。

## 理由

- 6種類に分けるのは、それぞれ寿命と持ち主が違うため。入力項目IDはデータモデルの都合、計算部品IDは差し替えと取り下げの都合、制度の値IDは制度改正の都合、出力の行IDは帳票と照合の都合で増減する。
- IDを点区切りの英字にし、日本語の名前を別にするのは、画面の言葉を変える（用語セットの切り替えを含む）たびに、移行の規則・ヒアリング・カスタム・AIの手順が壊れるのを防ぐため。
- 乱数IDを UUID 第4版にそろえるのは、検査が1つで済み、どの言語にも標準の実装があるため。接頭辞を付けないのは、欄名と重複し、物の分類が変わったときにIDまで変わるのを避けるため。
- 税・社会保険料を独立の大分類にするのは、額面方式と可処分所得方式のどちらも、行の移動なしに見せ方の宣言だけで作れるようにするため。
- 参照値をスキーマの上で入力から締め出すのは、運用の注意（「参照値を入力に使わない」）では、AIを含めて誰かが必ず破るため。

## 影響

- 後から変えると、移行・ヒアリング・カスタム・AIの手順がすべて壊れる。
- 守るべき決まり:
  - 新しい項目・部品・値・行を作るときは、先に登録簿に足す。
  - 公開したIDは消さない・使い回さない。
  - 参照値をエンジンの入力に入れる経路を作らない。
- テストで確かめること（CI）:
  - すべてのIDが書式に合うこと、種類をまたいで重複がないこと。
  - コード・制度データ・シート定義・帳票が参照するIDが登録簿にあること（参照切れの検出）。
  - β公開の時点の登録簿を固定ファイルとして持ち、そこにあったIDが消えたら失敗すること（`deprecated`・`removed` への変更は可）。
  - 別名で書いた古いファイルが新しいIDで読めること。
  - エンジンの入力のスキーマが、知らない欄（参照値を含む）を拒むこと。
  - 額面方式と可処分所得方式で、`cf.net` と残高が一致すること。

## 未確定

- 明細（第3段）の科目の一覧。部品を作りながら11〜12月に登録簿へ足し、β公開の時点で固定ファイルにする。
- 可処分所得方式の行の並びと名前を、国内のFPの標準の様式にどこまで合わせるか（帳票の設計の1月に決める）。
- 器ごとの残高の行（`cf.balance.account`）を、器の種類（NISA・iDeCoなど）で分けるか、物のIDで分けるか、両方か。資産の器のデータモデル（0008）と合わせて11月に決める。
- 登録簿のファイルの置き場所と形式（YAML か JSON か）。エンジンの土台を作る11月に決める。

## 追記

- 2026-10-08（登録簿の置き場所）: 「未確定」の登録簿の置き場所と形式を決めた。リポジトリ直下の `registry/` に種類ごとの YAML を置き、YAML を正本、ビルドで JSON にする。出力の行IDの登録簿は `registry/rows.yaml`。
- 2026-10-09（科目の木の確定: 中分類と明細）: β公開で固定する段として、中分類を確定し、この作業（資産の器・取り崩し・NISA・iDeCo・住宅ローン）と次の2回の作業（教育・退職給付・役員／万一・保険・介護・医療・贈与・ストレステスト）で使う明細を `registry/rows.yaml` に入れた（132行）。上の6の表の中分類はそのままで、次の中分類を足した。
  - `cf.taxSi.giftTax` 贈与税、`cf.taxSi.inheritanceTax` 相続税（贈与・万一の作業で使う）
  - `cf.expense.advisoryFee` **FP顧問料**（生活費・その他に混ぜない。部品は3回目の作業で作る。中分類だけ先に置く）
  - `cf.transfer.investment` 課税口座への積立、`cf.transfer.mutualAid` 小規模企業共済の掛金（役員の作業で使う）、`cf.transfer.rollover` 非課税期間の終了による課税口座への移管（旧NISA・ジュニアNISA。お金は動かず器の種類が変わる）
  - `cf.balance.nisaFrame` NISA の非課税保有限度額の残り（簿価。構成員ごと）、`cf.balance.shortfall` 資金不足（取り崩す器が無くて決済口座が負になった額）
  - 確定した中分類（上の表と合わせた全部）: 収入 `salary`・`business`・`pension`・`corporatePension`・`lumpSum`・`benefit`・`other`／税・社会保険料 `incomeTax`・`residentTax`・`businessTax`・`health`・`care`・`pension`・`employment`・`childSupport`・`giftTax`・`inheritanceTax`／支出 `living`・`housing`・`education`・`insurance`・`debt`・`lumpSum`・`care`・`advisoryFee`・`other`／器の間の移動 `nisa`・`ideco`・`savings`・`withdrawal`・`investment`・`mutualAid`・`rollover`／残高 `financial`・`account`・`return`・`debt`・`nisaFrame`・`shortfall`。CI（`test/ids.test.ts`）でこの並びを確かめる。
  - 足した明細の主なもの: 収入 `salary.executive`（役員報酬）、`pension.survivor`・`.disability`、`corporatePension.db`・`.dc`・`.ideco`・`.smallBusiness`・`.privateAnnuity`、`lumpSum.retirement`・`.db`・`.dc`・`.ideco`・`.smallBusiness`・`.insurance`・`.maturity`・`.surrender`・`.gift`・`.inheritance`・`.realEstateSale`・`.other`、`benefit.childAllowance`・`.childcare`・`.health`・`.employment`・`.medical`・`.care`・`.education`、`other.rental`・`.sideJob`／税 `incomeTax.capitalGains`・`.retirement`、`residentTax.capitalGains`・`.retirement`／支出 `living.allowance`、`housing.rent.renewal`、`housing.loan.prepayment`・`.fees`、`housing.purchase`（`.downPayment`・`.costs`）、`education.school`・`.entrance`・`.outOfSchool`・`.boarding`、`insurance.life`・`.medical`・`.savings`・`.nonLife`、`debt.car`・`.scholarship`・`.other`、`lumpSum.car`・`.wedding`・`.gift`・`.other`、`care.nursing`・`.medical`・`.facility`／移動 `nisa.tsumitate`・`.growth`・`.child`、`ideco.ideco`・`.matching`・`.employer`（企業型DCの事業主掛金。世帯の支払いではないので年間収支にも決済口座にも入らない）、`savings.zaikei`・`.esop`・`.deposit`／残高 `account.<器の種類>`（13種）、`debt.mortgage`・`.unpaidInterest`・`.other`。
  - 「未確定」の器ごとの残高の行は、**器の種類の明細**（`cf.balance.account.nisa` など）に**物のID**（`object`）と名義（`member`）を付ける形（両方）に決めた。種類ごとの合計は行IDで、器1つは物のIDで引ける。取り崩し（`cf.transfer.withdrawal`）も物のIDで売った器を指す。
  - 明細の段は、これまでどおり足していける（消す・意味を変えるのは3の規則）。既存の部品が出す中分類の行（`cf.income.pension` など）は変えていない。
- 2026-10-09（万一・保険・介護・贈与の行）: 科目の木に、明細の行を2つ足した（足すだけなので3の規則の範囲）: `cf.income.other.insuranceBenefit`（収入保障・就業不能の保険の月ごとの給付）、`cf.expense.lumpSum.funeral`（整理資金。葬儀・お墓など）。ほかは既存の行に載せる: 死亡保険金・高度障害保険金は `cf.income.lumpSum.insurance`、満期金・祝金は `cf.income.lumpSum.maturity`、解約返戻金は `cf.income.lumpSum.surrender`、個人年金は `cf.income.corporatePension.privateAnnuity`、遺族年金・障害年金は `cf.income.pension` の明細、死亡退職金・確定拠出年金の死亡一時金は `cf.income.lumpSum.inheritance`、贈与税は `cf.taxSi.giftTax`、介護・医療の自己負担は `cf.expense.care` の明細。保険の解約返戻金の残高は `cf.balance.account.insurance`（物のIDは保険契約。金融資産の合計には入れない。解約したときだけ現金になる）。
- 2026-10-19（全資産・全負債のバランスシート。0025）: 器ごとの残高の明細に `cf.balance.account.otherAsset`（その他の資産）と `cf.balance.account.car`（車の評価額。物の ID は車）を足した（足すだけなので3の規則の範囲。中分類は変えていない）。不動産・保険の解約返戻金・車・その他の資産の行は、金融資産の合計 `cf.balance.financial` に入れない。持ち家の売却の手取りは既存の `cf.income.lumpSum.realEstateSale` に載せる。
- 2026-10-20（住まい以外の不動産と土地・建物。0028）: 器ごとの残高の不動産の行の下に、明細 `cf.balance.account.realEstate.land`（土地）・`cf.balance.account.realEstate.building`（建物）を足し、持ち家と、中身を入れた住まい以外の不動産の評価額はこの2行に出す（合計の行は出さない。親の行は子の合計として木の上で足す。中身の無い不動産の器だけが親の行そのものに出る）。支出の明細に `cf.expense.other.realEstate`（不動産の経費）を足した。家賃収入は既存の `cf.income.other.rental` に載せる。どれも足すだけなので3の規則の範囲。
- 2026-10-26（並びの要素の ID・入力項目ID の足しと廃止・読み替え表。0035・0036）: 4 の世帯内の物の ID を、物の中の並びの要素（関係・生活費の段階と費目・積立の期間・金利の段階・繰上返済・住宅資金の援助・保険の更新・教育の目標の段など）にも持たせる。世帯ファイルの形式 0.17 の変換の段で古い要素に振る ID は、段を純粋な関数のまま保つため、場所から決まった作り方で作る（UUID 第4版の書式。0035 の10）。入力項目ID に `plan.endYear`・`plan.baseMonth`・`member.outside` を足し、`donor.kind`・`donor.of` を廃止（読み替え先 `member.kind`・`member.outside`）にする。プランで変えられる画面の側の値も入力項目ID を持ち、同じ登録簿に載せる。古い欄のキー・動かす項目のキーの読み替え表を `registry/readings.yaml` に置く（0035 の9）。1の「物の ID と入力項目ID の組で指す」は、場所 `at` を足した当て先として 0036 の2 で決めた。
- 2026-10-26（不動産の譲渡所得の税の額の口。0053）: 税・社会保険料の明細に `cf.taxSi.incomeTax.realEstateSale`・`cf.taxSi.residentTax.realEstateSale`（住まいの売却で入れた譲渡所得の税の額を、所得税と住民税に分けた分）を足した（足すだけなので3の規則の範囲。中分類は変えていない）。
