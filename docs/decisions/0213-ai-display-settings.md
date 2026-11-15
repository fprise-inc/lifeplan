# 0213. FP の AI に画面の見せ方の設定を変えてもらう（表示の設定）の全体の形と、段A: 表示の設定を読む道具 get_display_settings

- 状態: 採用（一部未確定）（2026-11-14）
- 固定の強さ: 道具の名前と入出力（`get_display_settings`・一覧の `display-settings-reference@1.0` の欄）、設定の id、使い方の例 `office_display`、接続口とアプリ本体の依頼（`getOfficeDisplay`・`getShareDisplay`）は試験版（0015・0016 の 2026-11-01 の追記の9 と同じ。予告して変えることがある）。次は固定: 載せるのは値も計算の結果も変えない見せ方の設定だけ、計算のお知らせの「入力が足りない」「計算に入れていない」と確かめの注意はどの設定でも隠せない、AI は設定を直接変えない（変えるのは FP がアプリで押したときだけ）、事務所の既定値はカスタム層に置かない（0016 の 2026-11-02 の追記の3）
- 前提にする記録: 0015（AI接続口）、0016（画面の安全とカスタマイズ層。2026-11-02 の追記の3「既定の値はカスタム層では扱わない」）、0027（資産と負債のタブ）、0073（事務所の既定値）、0083・0091（入力項目の選び方）、0084（対策に最初から出す項目）、0085（万一のタブの想定の前提と場面の帯）、0107（合算BS）、0109（基本生活費の内訳の並べ方）、0110（機能を有効にするコード）、0212（差し替えられる文の一覧 `list_custom_texts`）

## 背景

- FP から「対策に最初から NISA も出して」「家計の体力の目安の幅を変えたい」のように、画面の見せ方を AI に頼みたいという声がある。見せ方の設定は、事務所の既定値の画面（0073・0084・0085・0091・0109）と、結果のタブ・資産と負債のタブの「表示の設定」（世帯ごと）に分かれていて、どこで変えるかを FP が覚えていないことが多い。
- AI接続口には、画面の文と名前（`list_custom_texts`。カスタム層の `settings/texts.json`・`settings/terms.json`）を直す道はあるが、見せ方の設定を読む道具も変える道具も無かった。0016 の 2026-11-02 の追記の3 は、既定の値をカスタム層に置かず、事務所の既定値を AI から変える道は「カスタム層の承認の台帳とは別の道」にすると決めていた。
- 0016 の 2026-10-17 の追記と 0027 の6 は、結果のタブ・資産と負債のタブの表示の設定を「事務所の設定」と書いていたが、今は世帯ごと（世帯ファイルの本文の `display.result`・`display.balance`）に持っている（下の 6 で直した）。

## 決定（全体の形。利用者の決定 2026-11-14）

### 1. 範囲: 見せ方だけの設定

- 載せるのは、値も計算の結果も変えない見せ方の設定だけ。
- 載せない物:
  - 計算の結果を変える設定（前提条件の標準値 `assumptions`・必要保障額の数え方 `protection`・本人と配偶者の介護 `care`・受け取る予定の相続の見込み `inheritLikelihood`・不動産の評価の割合 `realEstateRatio`・表の最後の年の年齢 `endAge`・FP顧問料の料金表 `fee`・事務所の推定の値 `estimates`）
  - 名前・ロゴ・色・見た目（branding）
  - Web のヒアリングのひな形と話題（今は）
- どの設定でも隠せない物は今のまま: 計算のお知らせの「入力が足りない」「計算に入れていない」と、入力のタブの確かめの一覧の確かめの注意。値の入っている入力項目・入力の欄も、出さない設定でも出す（0083 の4・0016 の 2026-11-02 の追記の2）。

### 2. 流れ

1. AI が、今の設定と選べる値を読む（段A。この記録で作った）。
2. AI が、変える案を新しい道具で出す。形は `propose_scenario`・`propose_feature_code` と同じ「アプリの画面に承認待ちの候補として出すだけ」で、カスタム層のファイルは使わない（0016 の 2026-11-02 の追記の3。事務所の既定値はカスタム層に置かない）。
3. アプリは設定ごとに「今 → 案」を並べ、FP が「反映する」か「捨てる」を選ぶ。
4. 反映した後も、前の値に戻せる。

### 3. 効く範囲

- 既定は事務所全体（事務所の既定値。どの世帯にも効く）。共有中の世帯（同意があり、FP が「この世帯をAIに渡す」で渡した世帯）には、世帯ごとの案も出せる（段B の後半）。
- 結果のタブ・資産と負債のタブの表示の設定にも、事務所の既定値を足す。値を変えていない世帯は事務所の既定値に従い、変えた世帯はその世帯の値のまま（段C）。

### 4. 段の分け方

| 段 | 中身 | 状態 |
|---|---|---|
| 段A | 読むだけ: 表示の設定の一覧（id・画面と同じ名前・効く所・変える所・値の形・選べる値・既定）と、事務所の既定値・渡された世帯の今の値を返す道具 `get_display_settings`。カスタム層の入力の欄の一覧（`settings/fields.json`）を `list_custom_texts` に足す。使い方の例 `office_display` | この記録で作った |
| 段B | 案を出す: 事務所の既定値の見せ方の設定の案を、承認待ちの候補としてアプリに出す道具。アプリの「今 → 案」・「反映する」「捨てる」・前の値に戻す。後半で、渡された世帯の世帯ごとの設定の案 | 前半は 0215 で作った。後半は次 |
| 段C | 結果のタブ・資産と負債のタブの表示の設定に事務所の既定値を足し、値を変えていない世帯は事務所の既定値に従う形にする（世帯ファイルの形と読み方を変える） | 0216 で作った |

## 段A で作った物

### 5. 表示の設定の一覧（`display-settings-reference@1.0`）

- 一覧は画面の定数からビルドの時に作る（`app/src/connector/displayCatalog.ts` の `buildDisplayCatalog`。`npm run build:explain` が `crates/lifeplan/dist/display-catalog.json` に書き、接続口が埋め込む）。選べる種類・既定は画面の定数（`LEVER_KINDS`・`DEFAULT_LEVER_KINDS`・`PREMISE_KINDS`・`DEFAULT_PREMISE_KINDS`・`SCENE_KINDS`・`OPEN_SCENES`・`STAGE_ORDER`・`ALWAYS_SHOWN`・`STANDARD_LIVING_NAMES`・`METRIC_CHOICES`・`AGE_OPTIONS`・`LAYOUT_CHOICES`・`DEFAULT_DISPLAY_SETTINGS`・`BS_POINT_CHOICES`・`DEFAULT_BS_POINTS`・`DEFAULT_BS_GUIDE`・`MONEY_THREE_NAME_CHOICES`・何か月分と何年先までの範囲）をそのまま使い、手で写さない。種類を足す・既定を変えると、接続口の一覧も一緒に変わる。
- 1件の欄: `id`（変えない id。画面の区画.設定）・`label`（画面と同じ名前）・`scope`（`office`＝事務所の既定値・`household`＝世帯ごと・`both`）・`screen`（効く画面）・`change`（アプリのどこで変えるか。`office`・`household` ごとに画面と区画の名前）・`stored`（事務所データ・世帯ファイルの本文の欄）・`officeEffect`（事務所の既定値の効き方: `live`＝どの世帯にもすぐ効く・`newHouseholds`＝新しく作る世帯に写すだけ）・`reaches`（提案書の PDF・持ち帰り用のレポートに出るか）・`type`（値の形）・`choices`（選べる値と画面の言葉。見出し `group`・補足 `note`・外せない印 `fixed`）・`min`・`max`・`shape`（値の形の補い）・`default`・`readOnly`・`note`。
- 一覧の外の欄: `neverHidden`（どの設定でも隠せない物）・`outOfScope`（1 の載せない物）・`pending`（作っている途中で、まだ載せていない設定）。
- 今の21件:

| id | 名前 | どこで決めるか | お客さまに渡す物 |
|---|---|---|---|
| `input.order` | 入力のホームの入力項目の並び | 事務所（すぐ効く） | 出ない |
| `input.items` | 新しい世帯で出す入力項目と、開いたときの入れ方 | 両方（事務所の既定は新しい世帯に写す。世帯ごとは「入力項目を選ぶ」） | 出ない |
| `input.living` | 基本生活費の内訳の並べ方 | 事務所（すぐ効く） | 出ない |
| `result.levers` | 対策に最初から出す項目 | 事務所（すぐ効く） | 出ない |
| `result.addedItems` | 対策に足した項目 | 世帯 | 出ない |
| `result.metrics` | 出す数字 | 世帯 | 出ない（お客さまと一緒に見る結果のタブに出る） |
| `result.atAge` | 「○歳時点の金融資産」の年齢 | 世帯 | 提案書の目標の年齢・持ち帰り用のレポート |
| `result.layout` | 比較の仕方 | 世帯 | 出ない |
| `result.invBreakdown` | 口座の内訳を表示 | 世帯 | 出ない |
| `result.invPeriods` | 運用の期間を表示 | 世帯 | 出ない |
| `contingency.premises` | 想定の前提に最初から出す項目 | 事務所（すぐ効く） | 出ない |
| `contingency.scenes` | 場面の帯に並べる場面 | 事務所（すぐ効く） | 出ない |
| `contingency.openScene` | 開いたときに選んでおく場面 | 事務所（すぐ効く） | 出ない |
| `balance.health` | 家計の体力の目安を表示する | 世帯 | 出ない（もともと載せていない） |
| `balance.guide` | 家計の体力の目安の幅 | 世帯 | 出ない |
| `balance.points` | 「時点を並べる」の既定 | 世帯 | 提案書のバランスシートの図 |
| `balance.columns` | この世帯で並べる時点 | 世帯だけ（事務所の既定にはしない） | 提案書のバランスシートの図 |
| `balance.moneyThree.wording` | お金の3つの分け方の呼び方 | 世帯 | 提案書・持ち帰り用のレポート |
| `balance.moneyThree.months` | お金の3つの分け方の「何か月分」 | 世帯 | 提案書・持ち帰り用のレポート |
| `balance.moneyThree.years` | お金の3つの分け方の「何年先まで」 | 世帯 | 提案書・持ち帰り用のレポート |
| `features.combinedBs` | 合算BS（経営者個人と会社のバランスシート）を使う | 事務所（読むだけ。機能を有効にするコードが要る） | 提案書の合算BS の章 |

- 結果のタブ・資産と負債のタブの表示の設定の欄すべてに id があることを、テストで確かめる（`RESULT_SETTING_IDS`・`BALANCE_SETTING_IDS` は `DisplaySettings`・`BalanceSettings` の欄の名前を鍵にした表。欄を足すと型の検査で止まる）。
- 資産と負債のタブの「家計の体力の目安」を表示・非表示にする設定（世帯ごと。0027 の 2026-11-13 の追記）は、同じ時期に入ったので `balance.health` として載せた。作っている途中の設定は、答えの `pending` に書く（今は無し）。

### 6. 今の値（アプリが起動していて、AI接続口がオンのとき）

- 事務所の既定値: 接続口がアプリ本体に `getOfficeDisplay` を頼み、アプリ本体が事務所データの `defaults` から見せ方だけの欄（`layout`・`items`・`living`・`levers`・`premises`・`scenes`・`features.combinedBs`）を名前で選んで写して返す（`crates/ai-share` の `display::office_display_of`。知らない欄も通さない）。合算BS には、機能を有効にするコードで今使えるか（`featureCodes`）を添える。事務所データは世帯の中身ではないので、AIに渡した記録には残さない。
- 渡された世帯: `share_id` を書くと、接続口が `getShareDisplay` を頼む。共有の決まりは世帯を扱う道具と同じ（期限内・取り消されていない・同意がある。架空の世帯は同意が無くても渡せる）で、読むたびに道具の名前 `get_display_settings` で「AIに渡した記録」に残る（項目は `display.result`・`display.balance`・`household.itemChoice`・`workspace.shownItems`）。
  - 渡すのは世帯ファイルの本文の見せ方の区画だけ（`display`・`household.itemChoice`・`workspace.shownItems`）。共有の元を作るときに、値を数・真偽・null・短い英数字の文字に限って切り出す（`display::household_display_of`。人が書いた文章が入る経路を作らない）。縮約版の許可リスト（計算に要る項目の一覧）とは別の区画で、計算の入力・FP のメモ・プランは入らない。
  - 対策に足した項目の鍵の中の物の ID（`loan:<ID>:rate` など）は、共有ごとの仮の ID に置き換える。この共有の世帯に無い ID を含む鍵は渡さない。
- 値の読み方は画面と同じ欄ごとの関数（`readLeverChoice`・`readPremiseChoice`・`readSceneChoice`・`readItemChoice`・`cardOrder`・`readLivingLayout`・`readBsGuide`・`readBsPoints`・`readBsColumns`・`readMoneyThree`）で、接続口に同梱した画面の部品の JS（`plan.js`。`app/src/connector/display.ts` の `displayCurrent`）が読む。事務所データ全体を読む `readOfficeSettings`・世帯ファイルの本文を読む `readDisplay` は拡張・ヒアリングの部品まで読み込むので同梱せず、同じ答えになることをテスト（`app/test/connector-display.test.ts`）で確かめる。
- 1つの今の値は `{ value, isDefault, text }`（`value` は事務所データ・世帯ファイルと同じ形を読んだ後の値、`text` は画面の言葉の短い要約）。設定の `current.office`（`scope` が `office`・`both`）と `current.household`（`household`・`both`）に入る。

### 7. アプリが起動していないとき

- 一覧と既定だけを返す（`app.status` が `notRunning`。「アプリが起動していないか、アプリの「AI接続口」がオフなので、今の値は返せません。一覧（選べる値と既定）だけを返します…」）。`share_id` を書いたときも同じで、`household.status` が `notRunning`。
- 共有が期限切れ・取り消し・同意の撤回のときは、ほかの世帯を扱う道具と同じ失敗（`EXPIRED`・`REVOKED` など）を返す。

### 8. 変え方の案内

- この道具では設定を変えない。答えの `howToChange` に「変えるときは、各設定の change に書いたアプリの画面と区画で FP が変える。変える案を出す道具は次の段」と書く。
- 接続口の説明（INSTRUCTIONS）に、見せ方を変えたいと頼まれたら `get_display_settings` を引き、変えたときの見え方を説明して、変える所（画面と区画の名前）を FP に伝えること、計算の結果を変える設定はこの一覧に無いこと、隠せない知らせがあることを足した。今ある「設定を直接変える道具はありません」の行は残した。
- 使い方の例 `office_display`（「画面の見せ方の設定を確かめる」。引数は変えたい見せ方 `want`・世帯 `household`。どちらも任意）を足した。案を出すのは次の段であることを文の中に書いた。

### 9. 入力の欄の一覧を `list_custom_texts` に足す

- `list_custom_texts` の `file` に `fields`（カスタム層の `settings/fields.json`。入力の欄ごとの隠す・並べ替え）を足した。中身はアプリ本体が埋め込む欄の一覧（`fields-reference@1.0`。`app/scripts/textsCatalog.ts` の `buildFieldsCatalog`）と同じで、`npm run build:explain` が `crates/lifeplan/dist/fields-catalog.json` に書く。答えの `howTo` に `settings/fields.json` の書き方（行は `id` と `hide`・`order`。値の入った欄は隠しても出る・既定の値は書けない・計算は変わらない）を添える。承認の場所は事務所の既定値の画面の「入力の欄の見せ方（カスタム層）」。

## 見本の答え（対策に最初から出す項目。事務所の既定値で NISA を足した事務所）

```json
{ "id": "result.levers", "label": "対策に最初から出す項目", "scope": "office", "screen": "結果のタブの対策",
  "change": { "office": "世帯の一覧の「事務所の既定値」の区画「対策に最初から出す項目」（見出しごとのチェック。「既定に戻す」）" },
  "officeEffect": "live", "reaches": { "proposal": false, "takeaway": false }, "type": "kinds",
  "choices": [{ "value": "lever:retireAge", "label": "働く最後の年齢（ご本人）", "group": "対策" }, { "value": "lever:nisaMonthly", "label": "NISAの積立額（月）", "group": "対策" }, "…（20種類）"],
  "default": ["lever:retireAge", "lever:pensionAge", "lever:livingMonthly", "spouse:work"],
  "current": { "office": { "value": ["lever:retireAge", "lever:pensionAge", "lever:nisaMonthly", "lever:livingMonthly", "spouse:work"], "isDefault": false,
    "text": "働く最後の年齢（ご本人）・年金を受け取り始める年齢（ご本人）・NISAの積立額（月）・毎月の生活費・配偶者の働き方と年収" } } }
```

- 大きさ: 一覧の全部（21件）で約 30KB。`ids` で設定を選ぶと小さくなる（1件で約 1〜3KB）。

## 理由

- 読む道具を先に作った: 案を出す道具（段B）は、AI が今の値・選べる値・効く範囲を間違えずに知っていることが前提。先に読む道具だけを出せば、FP は今日から「どこで変える？」を AI に聞ける。
- 一覧を画面の定数から作った: 手で写した一覧は、種類を足したときにずれる（0212 の説明の一覧と同じ考え方）。
- 事務所の既定値をカスタム層に置かない: 0016 の 2026-11-02 の追記の3 のとおり、置き場所を2つにすると、どちらが効いているかを FP が見失う。承認待ちの候補の形（段B）なら、置き場所は今の事務所データのまま。
- 渡された世帯の見せ方を、計算の縮約版とは別の区画で渡した: 縮約版は計算に要る項目の許可リストで、見せ方の値は計算に要らない。見せ方の値は数と選択肢だけで顧客の文章を含まないので、同じ共有の決まり（同意・期限・記録）の下で、別の依頼として渡す。

## 代案（採らなかったもの）

- **一覧を接続口の Rust に手で書く**: 画面の種類を足したときにずれる。
- **事務所データ全体を接続口に渡し、接続口の側で見せ方の欄を選ぶ**: 推定の値・料金表などを接続口に渡す道ができる。アプリ本体の側で名前で選んで写す。
- **事務所の既定値の書き出しファイルを AI に書かせて読み込む**（0016 の 2026-11-02 の追記の3 の「のちに」の形）: 承認待ちの候補の形のほうが、「今 → 案」を設定ごとに見せられ、前の値に戻す操作も同じ所に置ける。ファイルの書き出し・読み込みは、事務所の既定値をほかの PC に移す回に別に考える。
- **渡された世帯の見せ方を `get_shared_household` の答えに足す**: 計算の入力と同じ指紋・同じ項目の記録に混ざり、縮約版の許可リストの意味が変わる。

## 影響

- 接続口: `crates/lifeplan/src/display.rs`（新）・`server.rs`（道具 `get_display_settings`・説明）・`prompts.rs`（`office_display`）・`custom_texts.rs`（`file: fields`）・`build.rs`（`display-catalog.json`・`fields-catalog.json` を埋め込む）。
- 接続口とアプリ本体の依頼: `crates/ai-ipc` の `Request::GetOfficeDisplay`・`GetShareDisplay`（取り決めの版は上げない。接続口とアプリ本体の版がそろっていないと話さないため）。
- アプリ本体の側: `crates/ai-share` の `display.rs`（新。切り出し）・`registry.rs`（`set_office_display`・`handle_office_display`・`handle_get_display`）・`source.rs`（共有の元の `display`）・`book.rs`・`reduce.rs`（`Pseudonyms::alias_of`）・`endpoint.rs`、`app/src-tauri/src/ai.rs`（事務所の既定値の見せ方の欄を読む所）・`features.rs`（今使える機能）。
- 画面の側: `app/src/connector/displayCatalog.ts`・`display.ts`（新）・`plan.ts`（`displayCurrent` を同梱）、`app/scripts/build-explain.ts`、`app/src/workspace/moneyThree.ts`・`report/src/moneyThree.ts`（何か月分・何年先までの範囲を書き出す）、`app/eslint.config.js`（接続口が読める作業の層の部品）。画面の見た目・世帯ファイルの形式・事務所データの形・計算は変えない。
- 試験: `app/test/connector-display.test.ts`（新）、`crates/lifeplan/tests/mcp_connector.rs` の `display_settings_list_the_catalog_and_current_values`（新）と道具・使い方の例の一覧・`list_custom_texts` の `fields`、`crates/ai-share` の `display` の試験、`crates/ai-ipc` の依頼の形、`app/src-tauri` の `office_display_is_cut_from_the_office_defaults`、道具の入力の形の見本 `get_display_settings.input-schema.json`。

## 未確定（段B・段C で決めること）

- 段B で最初に案を出せる設定: 事務所の既定値の7つ（`input.order`・`input.items`・`input.living`・`result.levers`・`contingency.premises`・`contingency.scenes`・`contingency.openScene`）から始め、世帯ごとの設定（`result.*`・`balance.*`）は渡された世帯だけに後半で足す案。`result.addedItems`（作業の状態で、物の ID を含む）と `features.combinedBs`（機能を有効にするコードが要る）は読むだけのままにする案。
- 前の値に戻す: 事務所の既定値の「反映する」ごとに、前の値を事務所データに数件だけ残す（追記だけ）か、アプリを開いている間だけ持つか。
- `input.items` の案を反映したとき、作った世帯にもそろえる操作（0091 の「事務所の既定にそろえる」）を案と一緒に出すか。
- 基本生活費の内訳の並べ方の案で、AI が書いた行の名前（20文字まで）をそのまま出すか。
- 段C の世帯ファイルの形: 「値を変えていない」を欄が無いことで持つか、印で持つか（前の版のアプリが書き戻したときに事務所の既定値に従わなくなる）。

## 追記

### 2026-11-15: 段B の前半を作った（0215）。未確定の段B の項目で決まったこと（利用者の決定）

- 段B で最初に案を出せる設定: 事務所の既定値の7つ（`input.order`・`input.items`・`input.living`・`result.levers`・`contingency.premises`・`contingency.scenes`・`contingency.openScene`）だけ。結果のタブ・資産と負債のタブの設定（`result.*`・`balance.*`）と渡された世帯ごとの案は、段B の後半・段C で扱う。`result.addedItems`・`features.combinedBs` は読むだけのまま。前提条件（0214）は対象の外。一覧の7件に `proposable: true` を付け、`get_display_settings` の答えに `proposable`（id の並び）を足した。
- 案を出す道具は `propose_display_settings`（0215 の2）。値は一覧の選べる値・値の形で確かめ、知らない id・選べない値・7つ以外の設定は理由と近い候補を添えて断る。
- 前の値に戻す: 「反映する」ごとに前の値を事務所データに残す（`defaults.displayHistory`。追記だけで設定ごとに直近3件。事務所データの形の版 3）。アプリを開いている間だけ持つ形にはしない。
- `input.items` の案を反映しても、作った世帯にそろえる操作は出さない（新しい世帯にだけ効く、のまま）。
- 基本生活費の内訳の並べ方の案で AI が書いた行の名前は、20文字まで受け、それより長いものは断る。制御文字・見えない書式の文字は通さない。
- どの設定でも隠せない知らせ（1）は今のまま。
- 8 の「変える案を出す道具は次の段」の文（答えの `howToChange`・説明・使い方の例 `office_display`）は、案を出せる7つは `propose_display_settings` を使い、ほかは変える所を伝える進め方に直した。
- 段の表の段B は「前半は 0215 で作った。後半（渡された世帯ごとの案）は次」。段C は変えない。

### 2026-11-15: 段C を作った（0216）。未確定の段C の項目で決まったこと（利用者の決定）

- 対象は結果のタブ・資産と負債のタブの表示の設定の11件（`result.metrics`・`result.atAge`・`result.layout`・`result.invBreakdown`・`result.invPeriods`・`balance.health`・`balance.guide`・`balance.points`・`balance.moneyThree.wording`・`balance.moneyThree.months`・`balance.moneyThree.years`）。この世帯で並べる時点（`balance.columns`）と対策に足した項目（`result.addedItems`。物の ID を含む）は世帯だけのまま。5 の表の11件は「両方」（`scope: both`）になり、事務所の既定値の効き方は `followers`（事務所の既定値に従う世帯にすぐ効く）。
- 世帯ファイルの形: 「事務所の既定値に従う」は、欄が無いことでなく**印**（`display.followOffice`。設定の id の並び）で持つ。印のある設定は事務所の既定値を読み、その世帯で値を変えたら印を外してその世帯の値を持つ（世帯ファイルの形式の版 0.79）。
- 前からある世帯（印の無い世帯ファイル）は、どの設定も「この世帯だけ」として今の値のまま読む（今の値が既定と同じでも、従う印を付けて読まない）。理由は 0216 の3。
- 前の版のアプリは 0.79 の世帯ファイルを閲覧だけで開く（版を上げたため。書き戻さない）。
- 事務所の既定値を変えても、作った世帯にそろえる操作は出さない（従う印のある世帯は自然に従う。印の無い世帯は変わらない）。
- AI は11件の事務所の既定値の案も出せる（一覧の `proposable` は18件。`get_display_settings` の `current.office` に11件も入る）。渡された世帯ごとの案は段B の後半（次）。
- 段の表の段C は「0216 で作った」。
