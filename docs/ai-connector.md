# AI接続口（`lifeplan mcp`）のつなぎ方

ファイナンシアの AI接続口は、FPのPCの中だけで動く MCP サーバーです（設計記録 [0015](decisions/0015-ai-connector-mcp.md)）。
AIのアプリ（Claude Code・Claude Desktop・Codex）が `lifeplan mcp` を起動し、**標準入出力だけ**で話します。ネットワークの口は開けません。

> アプリの画面では、世帯の一覧の「AI接続口」（事務所全体の設定。既定はオフ）で使うかどうかを決め、接続の設定の文面を見られます
> （接続口の場所は画面では伏せ、「文面をコピー」で本物の場所の入った文面をクリップボードに写します）。アプリが AI のアプリの設定を
> 書き換えることはまだしないので、下の設定は手で書きます（「AIとつなぐ」の書き込みは 0015 の10。後の回）。

## 1. 作る

```sh
cd engine && npm ci && npm run build && cd ..   # 計算エンジンと制度データ・対応範囲の一覧（engine/dist）
cd app && npm ci && npm run build:explain && cd ..   # 数字の根拠の読み方とプランの動かす項目（crates/lifeplan/dist/explain.js・plan.js。0183・0195）
cargo build --release -p lifeplan               # → target/release/lifeplan（Windows は lifeplan.exe）
target/release/lifeplan --version
```

以下の `<接続口の絶対パス>` は、`target/release/lifeplan` の絶対パス（例: `/Users/you/Projects/fprise-lifeplan/target/release/lifeplan`）に置き換えます。
設定の名前は **`fprise-lifeplan`**、引数は **`mcp`** の1つだけです（0015 の10）。

## 2. Claude Code

```sh
claude mcp add --transport stdio --scope user fprise-lifeplan -- <接続口の絶対パス> mcp
claude mcp list        # fprise-lifeplan が Connected になる
```

外すときは `claude mcp remove --scope user fprise-lifeplan`。

## 3. Claude Desktop

**Claude Desktop を完全に終了してから**（メニューの「終了」。ウィンドウを閉じるだけでは足りません）、設定ファイルを編集します。
Claude Desktop は終了するときに設定ファイルを書き直すので、起動中に書き足すと消えます（0015 の追記）。

- Mac: `~/Library/Application Support/Claude/claude_desktop_config.json`
- Windows: `%APPDATA%\Claude\claude_desktop_config.json`

`mcpServers` に `fprise-lifeplan` だけを足します（ほかのサーバーの設定は消さない）。

```json
{
  "mcpServers": {
    "fprise-lifeplan": {
      "command": "<接続口の絶対パス>",
      "args": ["mcp"]
    }
  }
}
```

保存してから Claude Desktop を起動し、道具の一覧に `fprise-lifeplan` が出ることを確かめます。
ワンクリックで入る拡張（MCPB）は、署名の回で用意します（0015 の10）。

## 4. Codex

`~/.codex/config.toml`（`CODEX_HOME` があればその下）に足します。

```toml
[mcp_servers.fprise-lifeplan]
command = "<接続口の絶対パス>"
args = ["mcp"]
```

## 5. 道具

| 群 | 道具 | 使える条件 |
|---|---|---|
| 単体で使える | `list_sample_households`（架空の見本の世帯の一覧）・`get_sample_household`（見本の世帯の計算の入力）・`calculate`（見本の世帯・渡された世帯・AIが組み立てた入力に、プランや想定の変更を当てて計算）・`list_plan_items`（その世帯で、画面の結果のタブのプランで動かせる項目を、対象・入力項目ID・今の値・範囲で。0195）・`compare`（基本と最大8通りを1回で計算し、主な数字・基本との差・選んだ数字の系列を並べる。0198）・`chart`（`compare` と同じ書き方で計算した答えを、画面のグラフと同じ見た目の PNG・SVG にする。0203）・`explain_value`（キャッシュフロー表の1つの数字の根拠。画面の「数字の根拠」と同じ中身に制度の値ID を添える）・`get_regulation_value`（制度の値を値・適用期間・出典つきで）・`search_coverage`・`get_coverage`（何をどう計算しているか〔入っている・近似している・まだ入っていない〕を、同梱した対応範囲の一覧〔`docs/coverage/`〕から探す。0183）・`get_input_guide`（計算の入力の形の案内: 形の決まり・区分ごとの欄・必須・選べる値・例・計算できる最小の入力の例。0196）・`get_input_recipe`（家を買う・子が生まれる・退職・繰上返済・NISA と iDeCo・万一の想定の手本を、世帯に合わせた changes で。0196） | いつでも（アプリが起動していなくてよい。`list_plan_items`・`get_input_recipe`・`compare`・`chart` の `share_id` は下の「世帯を扱う」と同じ条件） |
| 世帯を扱う | `list_shared_households`・`get_shared_household`・`propose_scenario`（プランの候補を承認待ちで出す）・`propose_inputs`（保険の書類から読んだ値を、現状の入力の候補として承認待ちで出す）、`calculate`・`explain_value`・`list_plan_items`・`compare`・`chart` の `share_id` | アプリが起動していて、FPが「この世帯をAIに渡す」で渡した世帯が期限内で取り消されていないときだけ |
| 設定の候補を出す | `propose_feature_code`（FPが渡した「機能を有効にするコード」を、アプリの画面に承認待ちの候補として出す。コードは入らない） | アプリが起動していて、AI接続口がオンのときだけ（世帯を渡していなくてよい） |

道具の名前と入出力は試験版です（予告して変えることがあります。0001・0015）。

試しに、AIに次のように頼みます。

- 「fprise-lifeplan の見本の世帯の一覧を見せて」
- 「salariedCoupleTwoKids で、物価上昇率を 1% にしたら老後の金融資産はどう変わる？」
- 「salariedCoupleTwoKids で、働く最後の年齢を 60〜65歳で振ったら、金融資産がいちばん少ない年はどう変わる？」（`list_plan_items` → `calculate` の `plan_changes`）
- 「salariedCoupleTwoKids で、働く最後の年齢を63歳にする・生活費を月25万円にする・NISA を月3万円にする、の3つを並べて」「dualNoKids と salariedCoupleTwoKids と single25 を比べて」（`compare`）
- 「salariedCoupleTwoKids で、変動金利の上がり方を3通り（今のまま・10年で+1%・10年で+2%）にして比べ、グラフにして」（`list_plan_items` の「金利の見込み（変動金利）」→ `chart`）
- 「所得税の基礎控除の今の額と出典は？」
- 「salariedCoupleTwoKids の2030年の税・社会保険料は、どんな計算で出ている？」（`explain_value`）
- 「ファイナンシアに高額療養費は入っている？ iDeCo の受け取り方はどう計算している？」（`search_coverage`・`get_coverage`）
- 「セミナー用に、35歳の会社員と扶養のパートの妻・3歳の子・賃貸の架空の世帯を作って、2028年に4,000万円の家を買ったら老後の資産はどうなるか計算して」（`get_input_guide`・`get_input_recipe`・`calculate`）

### 計算の入力を組み立てる（0196）

- `get_input_guide` を `section` なしで呼ぶと、形の決まり（ID は UUID 第4版・金額は値の箱・率は文字・時点の形）、区分の一覧、計算できる最小の入力の例（`skeleton`）、新しい UUID が返ります。`section` に区分の鍵（`residences` など）か入力の中の場所（`/household/residences/purchase` など）を渡すと、その物の欄・条件・例を返します。どれもエンジンと同じスキーマから作ります。
- `get_input_recipe` は、場面の手本を、その世帯の ID と配列の位置に合わせた `changes` で返します（関係する欄も一緒に。家なら頭金・諸費用・入居・住宅ローン・住宅ローン控除の住宅の情報、子なら親子の関係・教育の目標・子の生活費）。`params` で時期や額を変えられます。手本を重ねるときは `apply: true` で返る `input` を次の手本に渡します。
- `calculate`・`explain_value` が入力の形の誤りで止まったときは、エラーの文に「直し方」（足りない欄・知らない欄・選べる値・正しい形）が付きます。同じスキーマで確かめ直した手がかりで、判定はエンジンが正です。入力の値はエラーの文に写しません。

### 計算の答えの主な数字・年齢・大きさ（0194）

`calculate` の答えには、年ごとの数字のほかに次が付きます。

- `keyFigures`（主な数字）: アプリの「プランを比べる」と同じ関数で数えた、`at_ages`（既定は95歳）の時点の金融資産・資産が尽きる年・金融資産がいちばん少ない年と額・生涯の手取りの合計・生涯の支出の合計・住宅ローンの返済の合計と、65歳からの年金の月額 `pension`（世帯の合計 `monthly`・受け取り開始からの月額 `claimedMonthly`・人ごと `people`。今の水準＝賃金・物価の伸びとマクロ経済スライドを外した額で、アプリの比較の表の年金の行と同じ。0200）。
- 年ごとの数字・表の行・合計 `totals` は、アプリの画面の表に出す年からです（計算基準月が年の途中なら、数か月分しかない計算の最初の年は入れません。主な数字・数字の根拠と同じ。`totals.income − totals.taxSi` が生涯の手取りと同じになります。0200）。
- `members` と年ごとの `ages`: 家族の年齢（アプリのキャッシュフロー表の年齢の行と同じ呼び方・同じ「世帯にいる年」）。
- `protection`・`inheritanceTax`: 入力に必要保障額（`/protection`）・相続税の目安（`/inheritanceTax`。`points` に `now`・`bothAfter`・`contingency` を入れる）があれば、その答え（人に `self`・`spouse` などの鍵を添える）。

答えは次で小さくできます（何も選ばなければ今までどおり）。比べる・振るときは主な数字だけを取ると、1通り 0.7KB ほどです（年金の見込みは写しをもう1〜2回計算するので、要らなければ `omit` に `pension` を入れると速くなります）。

| 選ぶ物 | 意味 |
|---|---|
| `every_years` | 何年おきの年だけ（1〜10。最初と最後の年はいつも入る） |
| `fields` | summary の年ごとの数字を選ぶ（`income`・`taxSi`・`expense`・`net`・`financialAssets`・`debt`・`shortfall`） |
| `omit` | 省く物（`notices`・`packs`・`totals`・`insurance`・`ages`・`years`・`keyFigures`・`protection`・`protectionDetail`・`inheritanceTax`・`pension`） |
| `at_ages` | 主な数字の「○歳時点」の本人の年齢（5つまで） |

`explain_value` も `omit`（`sources`＝出典の文・`params`＝使った制度の値・`message`＝読み方の案内）で小さくできます。出典は制度の値ID から `get_regulation_value` で引けます。

頼み方の例: 「salariedCoupleTwoKids と dualNoKids の、資産が尽きる年と65歳・90歳の時点の資産を比べて」「salariedCoupleTwoKids の金融資産の推移を5年ごとに、家族の年齢つきの表にして」

### 計算の前の処理（画面と同じ。0184）

`calculate`・`explain_value` は、アプリの画面と同じく、計算の前に次を当ててから計算します（画面の関数 `app/src/engine/moneyRows.ts` の `forEngine` を接続口に同梱して動かすので、画面と同じ数字になります）。

- 計算に入れない物を外す: 見込みが「当てにしない」の受け取る相続・遺贈・贈与と、相続で受け継ぐ借金（「基本の計算に入れる」にした物は残す）。「計算に入れない」を選んだ夢。見本の世帯・渡された世帯・AIが組み立てた入力のどれにも当てます。
- 事務所の推定の値を足す: FPの事務所が既定値の画面で変えた推定の値と、推定で埋めない目安。渡された世帯（`share_id`）のときだけ、アプリ本体が計算に使う読み取りに事務所データの値を添えます（`get_shared_household` の答えには入りません。FPが書いた根拠の文はAIに渡りません）。

何かを当てたときは、答えに `preparation`（外した物と、足した事務所の値の値ID）が付きます。当てないのは、画面の結果の見方（「確実な分だけ」・物ごとの入れ外し）と、保存していない変更です（渡されるのは保存した世帯）。そのときは、画面の数字と違うことがあります。

### 比べる（0198）

「対策を3つ並べて」「この世帯とこの世帯を比べて」「物価 0%・1%・2% で並べて」のように何通りも並べるときは、`calculate` を何度も呼ばず `compare` を使います。

- 基本の世帯（`sample_household_id`・`share_id`・`input` のどれか1つ）と、基本に当てる `changes`・`plan_changes`・`stress_test`（か `market_stress`）を書き、`variants` に8通りまで並べます。
- 世帯を書かない通りは基本に重ねます（基本の変更の後に、その通りの `plan_changes`・`changes` を当てる。`stress_test`・`market_stress` はどちらかを書けばその通りの物、書かなければ基本の物）。`sample_household_id`・`share_id`・`input` を書いた通りは、その世帯で計算します（見本の世帯どうし・渡された世帯どうしも並べられます）。
- 答えの `results` の1つ目が基本で、通りごとに主な数字 `keyFigures`（`calculate` と同じ。アプリの「プランを比べる」と同じ数え方）・基本との差 `diff`（この通り − 基本の円。資産が尽きる年は画面の比較の表と同じ文）・選んだ数字の年ごとの系列 `series`（`series` で選ぶ。既定は金融資産を5年ごと・家族の年齢つき。画面の表に出す年から）・当てたプランの変更 `planChanges` が出ます。
- `market_stress` は、アプリの資産運用のタブの「相場が下がった場合」の型です: `drop`（退職の直後に株などが下がる）・`low`（取り崩しを始めてから、予定が無ければ退職から、しばらく利回りが低いまま）・`minus1`（利回りがずっと想定より1%低い）。画面と同じ関数で、プランの変更を当てた後に重ねます（`stress_test` とは1つの通りにどちらか1つ）。答えの `marketStress` に画面の文が出ます。頼み方の例: 「investmentCouple で、相場が下がった場合の3つを並べて」
- 主な数字には65歳からの年金の月額が入り、`diff` に `pensionMonthly`・`pensionClaimedMonthly`（基本との月額の差）が出ます。
- 形の違う通り・当てはまらない変更・読めない共有・計算できない入力・9通り目から後は、その通りだけ `status: "error"` と理由 `reason` を返し、ほかの通りは計算します。
- 1通りの計算は `calculate` と同じ道（プランの変更 → 計算の前の処理 → 計算 → 主な数字）です。渡された世帯は `calculate` と同じくアプリ本体に頼み、読むたびに道具の名前 `compare` で「AIに渡した記録」に残ります（1回の呼び出しで同じ世帯は1回だけ読みます）。
- 大きさと時間の目安（見本の世帯）: 基本＋3通りで約 9KB・0.7 秒、基本＋8通りで約 19KB・約 1.8 秒（年金の見込みを含む。0200）。`ages: false` で年齢を省くと1通り約 0.7KB 小さくなります。

### 比べた答えをグラフにする（0203）

「変動金利の上がり方を3通りにして比べ、グラフにして」のように、比べた答えをセミナーの資料やブログに使うグラフにするときは、AI のアプリに数字を描かせず `chart` を使います。

1. `list_plan_items` で、住宅ローンの「金利の見込み（変動金利）」の項目（`kind: "rateOutlook"`。変動金利の住宅ローンごとに1つ）を探します。入力の「住まい・ローン」の「金利の見込み（変動金利）」の欄と同じ型（`presets`: `flat`＝今の金利のまま・`up1`＝10年で1%上がる〔5年後に＋0.5%・10年後に＋1%〕・`up2`＝10年で2%上がる〔5年後に＋1%・10年後に＋2%〕）と、今の金利 `currentRate`・起点の月 `from` が出ます。
2. `chart` の基本と通りの `plan_changes` に、その項目（`target`・`item` と、一覧が添えた場所 `lever`）と値を入れます。値は型の名前か、5年ごとの上乗せ `{"adds": ["0.005", "0.01"]}`（5年後に＋0.5%・10年後に＋1%。6段まで。各段 −3%〜+5%）。入力の欄で型を選んだときと同じ関数で当たるので、画面で同じ型を選んだときと同じ数字になります。
3. 返るのは、説明と通りごとの主な数字（キャプション用）の文章、続けてグラフの PNG（MCP の image。AI のアプリでそのまま見える）と、`format` が `svg`・`both` なら SVG（`image/svg+xml`）です。

例:

```json
{ "sample_household_id": "salariedCoupleTwoKids", "label": "今のまま",
  "plan_changes": [{ "target": "<ローンの ID>", "item": "debt.rateSchedule", "lever": "loanRateOutlook", "value": "flat" }],
  "variants": [
    { "label": "10年で+1%", "plan_changes": [{ "target": "<ローンの ID>", "item": "debt.rateSchedule", "lever": "loanRateOutlook", "value": "up1" }] },
    { "label": "10年で+2%", "plan_changes": [{ "target": "<ローンの ID>", "item": "debt.rateSchedule", "lever": "loanRateOutlook", "value": "up2" }] } ],
  "charts": ["assets", "repayment", "keyFigures"], "format": "both" }
```

- グラフの種類（`charts`。既定は3つとも）: `assets`（通りごとの金融資産の推移）・`repayment`（通りごとの住宅ローンの返済額の推移。年額）・`keyFigures`（主な数字の棒。`figures` で `assetsAtAge`・`minimum`・`loanRepayment`・`lifetimeTakeHome`・`lifetimeExpense` から選ぶ）。`title` は1種類だけのときに渡せます。`theme` は `light`（既定。白地・印刷向け）か `dark`。
- どのグラフにも、題・凡例（通りの文字 A・B… と名前）・単位（万円）・前提の短い注（通りの違い・物価上昇率・運用利回り・相場の想定）・「ファイナンシアで試算」の旨と試算の時点が入ります。線の右端と棒の下にも通りの文字が入り、色だけに頼りません。
- 数字は `compare` と同じ道で計算した物だけを描きます（AI から数字を受け取りません）。どれかの通りを計算できないときは、グラフを作らずに理由を返します。
- 見た目は画面と同じです（座標・目盛りの関数、線の色〔色の見分けにくい人にも見分けやすい組み合わせ〕、文字と線の色）。PNG は接続口に同梱した字体（BIZ UDゴシック）で描き、外へは何も送りません。
- お客さまの名前・ID は描きません。通りの名前（`label`）と題（`title`）に書いた文字はそのまま入るので、お客さまの名前を書かないでください。公開に使うときは、実在のお客さまの世帯なら、金額を丸める・珍しい組み合わせを変える・お客さまに一言ことわる、のどれかをしてから使ってください（見本の世帯はすべて架空です）。
- 系列の住宅ローンの数字は `compare` の `series`・`calculate` の `fields` でも選べます: `loanRepayment`（住宅ローンの返済。年額。繰上返済・手数料を含み、表に出す年の合計が `keyFigures.loanRepayment`）・`loanBalance`（住宅ローン残高。画面の表の行と同じ）。適用金利と利息はまだ返しません。
- 変動金利の上がり方は、この項目のほかに、結果のタブの「変動金利の上昇」（前提の `loanRateShifts`。ある年から一律の上乗せ）と、ストレステスト `rateRise`（決まった型。上げ幅を選べない）があります。どちらも今ある後の段に重なるので、入力の欄の型とは当て方が違います。
- 大きさと時間の目安（見本の世帯で3通り）: 3つのグラフの PNG と SVG で約 350KB・約 1.3 秒、PNG だけ（既定）で約 290KB、1つだけなら約 100KB。

### プランの動かす項目（画面と同じ。0195）

画面の結果のタブのプランで動かす項目（働く最後の年齢・年金の受け取り開始・NISA の積立・毎月の生活費・配偶者の働き方と年収・FP顧問料・資産運用の利回りと配分・住宅ローンの借入額・繰上返済・金利・変動金利の上昇、入力の数の欄など）は、1つ動かすと関係する欄も一緒に動きます（働く最後の年齢なら、働き方の期間の終わり・生活費の「退職後」の段階・積立の終わり・定年後の働き方）。`changes`（JSON Pointer）で欄を1つだけ動かすと、画面と違う数字になることがあります。

1. `list_plan_items` で、その世帯で動かせる項目を見ます。項目ごとに `target`（対象）・`item`（入力項目ID）・`label`・今の値 `value`・値の形 `kind`・`unit`・範囲 `min`・`max`・`slider`・`options`・補足 `note`・プランの候補に出せるか `proposable` が返ります。既定は対策・資産運用・貯まり方・よく使う項目だけで、`fields: true` か `group` で入力の欄から作った項目も返します。
2. `calculate`・`explain_value` の `plan_changes` に、同じ `[{ "target": …, "item": …, "value": … }]` を渡します。画面のプランと同じ関数（`app/src/workspace/plans/` の動かす項目の一覧と当て方）を接続口に同梱して当てるので、画面で同じ値にしたときと同じ数字になります。答えの `planChanges` に、変更ごとの前と後の文と `status`（`applied`・`same`）が出ます。当てはまらない変更（対象・入力項目ID の違い・値の形・範囲の外）があれば、計算せずに理由を返します。
3. 同じ書き方を、渡された世帯なら `propose_scenario` の `changes` にそのまま渡せます（AI が計算で確かめた物と、プランの候補が同じになります）。

`plan_changes` は `changes`・`stress_test` の後、計算の前の処理の前に当てます（`changes` と一緒に使えます）。同じ対象・同じ入力項目ID で場所だけ違う項目（資産運用の「毎月の積立額」「積立をやめる年齢」、取り崩しの3項目など）は、この書き方では選べないので一覧に出ません（`unlisted` に数）。渡された世帯では、縮約版の定年後の働き方の条件（`get_shared_household` の `postRetirement`）を、画面で保存した世帯を開いたときと同じくそのまま使います。渡されるのは保存した世帯の現状なので、保存したプラン（プランA・プランB …）の上に重ねて試すことはできません。

画面の部品は `crates/lifeplan/dist/plan.js`（約 2MB）にまとめ、計算と同じ固めた実行環境で、プランを当てるときと一覧を返すときだけ読み込みます。固めた実行環境に無い組み込み（`structuredClone`・数の `toLocaleString` など）と呼べない Math の関数（`round`・整数の指数の `pow`）は、その JS の中だけで、画面と同じ答えになる実装に置き換えます（設計記録 0195 の4）。

## 6. 世帯を渡すと何が起きるか

- 世帯の復号・許可の判定・縮約・文章の包み方・記録は、**アプリ本体だけ**が行います（`crates/ai-share`）。接続口は鍵も世帯ファイルも扱いません。
- 渡るのは既定で**縮約版**（計算に要る入力項目と、定年後の働き方の条件の数と選択肢だけ〔0195〕。許可リストは `crates/ai-share/data/reduced-allowlist.json`）。自由記述・FPのメモ・見出しは既定で外れ、FPが項目ごとに足したときだけ `client_text` に包んで渡ります。世帯の内部ID・顧客番号・呼び名は、どの版でも渡りません。物の ID は共有ごとの仮の ID に置き換わります。
- 共有は期限つき（既定60分・最長8時間）で、取り消し・同意の撤回・アプリの終了で止まります。止まるのは今後の読み取りだけで、すでに送った内容はAIの会社の側に残ります。
- 読まれるたびに、世帯の「AIに渡した記録」（0014）に、日時・道具・渡した項目・中身の指紋・観測できた呼び出し元（接続口と親のプロセスの実行ファイル、AIのアプリの名乗り。どれも認証ではない）が残ります。`calculate`・`explain_value`・`list_plan_items`・`compare` の読み取りも同じで、計算に使う事務所の推定の値は記録の中身（項目・指紋）に入りません（世帯の中身ではないため。0184）。
- `propose_scenario` のプランの候補は、アプリの「AIからの候補」に承認待ちで入るだけで、世帯のデータは変わりません。FPが中身を確かめて「プランとして保存」したときだけ、プラン（プランA・プランB …）として入ります。
- `propose_inputs` の書類の候補は、入力のホームの「取り込む」の「書類の読み取り」に承認待ちで入るだけです（画面の上に「AI から書類の候補が届きました」の帯が出ます）。FPが確かめの画面で値ごとに承認したものだけが現状に入ります。答えの形は `document-candidates@1`（ウェブのチャット AI の答えを貼り付ける入口と同じ形）で、書類1通につき1回呼びます。読むのは保険証券・ご契約内容のお知らせ・設計書（`docType` が `insurancePolicy`）の、保険の契約の欄の候補だけです（ほかの書類の答えはアプリが読みません。設計記録 0159）。登録簿に無い入力項目・形の違う候補・個人番号などの番号らしい所は、アプリが読まずに落とします。届いた答えはアプリのメモリの中だけに置き、世帯ファイルには、アプリが確かめた候補だけが入ります（設計記録 0151）。書類の候補を受けるのは、お客さまの同意が書類を AI に渡すことを含む世帯（同意の説明の版2〜）だけです。前の版の説明で同意した世帯では `NOT_SHARED` を返します（共有は閉じず、計算の項目は読めます。設計記録 0157）。
- `propose_feature_code` のコードの候補は、世帯の一覧の「事務所の既定値」のいちばん下に承認待ちで出るだけです（画面の上にも帯が出ます）。FPが、有効になる機能・名前・期限と、入れる前と後を確かめて「このコードを入れる」を押したときだけ入ります（設計記録 0110 の5・0015 の追記）。

同じ OS ユーザーで動く悪いプログラムは、FPが今渡している世帯の縮約版を読めてしまいます（防げない範囲。0015 の9）。

## 7. アプリの画面（0014・0015）

1. **事務所全体の設定**（世帯の一覧の下の「AI接続口」）: 使うかどうか（既定はオフ。事務所データに暗号化して保存）。オンのときだけ、アプリ本体が受け口（ソケットと `app.json`）を開けます。オフにすると、共有中の世帯をすべて取り消して口を閉じます。共有中の世帯の一覧と「止める」、接続の設定の文面、防げること・防げないことも、ここに出します。
2. **世帯ごとの同意**（上の帯の世帯の右の「AI: …」）: 外部AIへの提供の同意を記録します（使う AI サービスで学習に使われない設定を確かめたか・渡してよい範囲（縮約版）・同意の取り方・日付・FPの確認）。説明文の指紋と文面は世帯ファイルに残ります。説明文は版2から、書類の読み取りで名前・番号を伏せた書類を AI に渡すことを含みます。前の版の説明で同意した世帯は、計算の項目はそのまま渡せますが、書類を AI に渡す前に「今の説明で同意を記録し直す」で取り直します（設計記録 0157）。同意の取り方に「ヒアリングシートの同意欄」を選ぶと、シートの同意欄の文で記録し、書類を AI に渡すことは含みません（書類を渡す世帯は、今の説明を見せて取り直します）。同意は「外部の AI サービスに渡すことへの同意」1つで、どの AI の会社かは聞きません（前に記録した会社はそのまま残ります。設計記録 0172）。**同意が記録されていない世帯は、AIに渡せません**（接続口からも見えません）。撤回を記録すると、その世帯の共有はすぐに止まります。
3. **世帯を渡す**: 同意のある世帯だけ、使うAIのアプリの名前（申告）と期限（15分〜8時間。既定1時間）を選んで渡します。渡すのは縮約版だけで、FPのメモ・相談内容などの文章は渡しません。共有中は画面の上に帯が出て、そこから取り消せます。
4. **共有の記録**: 世帯ごとに、渡した日時・期限・終わり方・申告した接続先・範囲・読まれた日時と回数・道具・呼び出し元（参考情報。実行ファイルはファイル名だけ）・届いた候補・同意の記録を見られます。記録は追記だけです。
5. **AIからの候補**（結果の画面のプランの帯の下）: `propose_scenario` で届いたプランの候補を、変える項目・今の値・候補の値・AIの理由で確かめ、「プランとして保存」か「捨てる」を選びます。保存したプランの差分は、出どころ「AI」と FP の承認の記録を持ちます。結果の画面のプランで動かせない項目は取り込みません（理由を出します）。AIが書いた題名・説明・理由は文字のまま出し、プランの名前はアプリが作ります。

世帯ファイルの `consents`・`consentExplanations`・`aiShares`・`candidates` はアプリ本体（`crates/ai-share` の `HouseholdBook`）だけが書きます。画面から届いた本文にこれらの区画が入っていても使わず、書く前に追記だけかを確かめます。

## 8. 開発者向け: アプリ本体への組み込み（`app/src-tauri/src/ai.rs`）

- 起動時に `ShareRegistry` を作り、`require_consent(true)`（同意が `given` の世帯だけを渡せる）。事務所の推定の値を読む所（事務所データの `defaults.estimates` を切り出す）を `set_office_estimates` で入れる。接続口の計算に使う読み取り（`getShare` の `forCalc`）の返事にだけ、そのときの値を `officeEstimates` として添える（0184）。受け口（`AppEndpoint`）は事務所の設定がオンのときだけ開け、終了時（`RunEvent::Exit`）に、すべての共有を「アプリの終了」で閉じて記録を書き戻し、口を閉じます。
- 世帯を開く・作るときに帳面（`HouseholdBook::from_opened`）を作り、同じ起動で初めてなら `load_records`（終わりの記録が無い共有は「アプリの終了」で閉じる）。保存は帳面の `compose`（追記だけかを確かめる）を通し、共有中なら `update_source` で渡す中身を置き換えます。
- 2秒ごとの見回りで、期限切れを閉じ、`take_proposals` の候補を帳面に入れ、記録を世帯ファイルへ書き戻します（画面への通知は使わず、画面は3秒ごとに読み直す）。
- 画面から呼べる命令は `ai_status`・`ai_set_enabled`・`ai_setup_copy`・`ai_household`・`ai_consent_record`・`ai_share_start`・`ai_share_stop`・`ai_candidate_decide` だけで、パスも鍵も受け取らない・返しません。
- 開発用のビルドは、作業フォルダを `<アプリのデータの場所>/run-dev/`（`FINANCIA_DEV_RUNTIME_DIR` で差し替え）にし、製品の口とぶつからないようにします。接続の設定の文面には、作業フォルダの指定（`LIFEPLAN_RUNTIME_DIR`）が加わります。
- 接続口の版（`lifeplan --version`）とアプリの版をそろえる（違うと `VERSION_MISMATCH`。事務所の設定の画面にも出す）。接続口の同梱（アプリと同じフォルダに置く）は配布の回で行います。

テスト: `cargo test --release -p lifeplan -p ai-share -p ai-ipc -p household-store`（本物の接続口を起動してアプリの方針の流れを確かめる `app_policy_consent_is_required_end_to_end` を含む）、`app/src-tauri` の `cargo test`、`app` の `npm test`（`test/ai.test.ts`）。
作業フォルダは環境変数 `LIFEPLAN_RUNTIME_DIR` で差し替えられます（開発とテストのためだけ）。既定は Mac `~/Library/Application Support/com.fprise.lifeplan/run/`、Windows `%LOCALAPPDATA%\com.fprise.lifeplan\run\`（識別子は `config/distribution.toml` から）。
