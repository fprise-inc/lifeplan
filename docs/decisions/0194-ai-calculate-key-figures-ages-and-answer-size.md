# 0194. AI接続口の計算の答えに、主な数字・家族の年齢・必要保障額と相続税の目安を足し、答えの大きさを選べるようにする

- 状態: 採用（一部未確定）（2026-11-11）
- 固定の強さ: 道具の入出力（`calculate` の `every_years`・`fields`・`omit`・`at_ages` と答えの `keyFigures`・`members`・`ages`・`protection`・`inheritanceTax`、`explain_value` の `omit`）は試験版（0015 と同じ。予告して変えることがある）。作り（主な数字と年齢は画面の関数を同梱して数える・答えの絞り方）は内部
- 前提にする記録: 0005（計算の実行環境）、0015（AI接続口）、0039（相続税の目安）、0054（必要保障額）、0183（数字の根拠）、0184（計算の前の処理）

## 背景

- AI接続口の `calculate` を、FP が自分の AI からよく頼みそうな使い方（2つの世帯を比べる・想定を振る・境目を探す・推移を表やグラフにする・保障や相続の数字を聞く）で呼んでみると、次のことが分かった。
  - **答えが大きい**: 年ごとの合計（56年分）で約11KB、表の形は絞らないと約190KB。表の形を金融資産の行だけに絞っても、保険の年ごとの要約（約9KB）がいつも付く。比べる・振るたびに1通り11KB ずつ積み上がる。
  - **主な数字が無い**: 「資産が尽きる年」「いちばん少ない年と額」「○歳の時点の資産」「生涯の手取り」を、AI が年ごとの数字から自分で数える。数え方（表に出す年・尽きたとみる決まり。0179）が画面の「プランを比べる」と違うおそれがある。
  - **年齢が無い**: グラフ・表にするたびに、AI が生年月から家族の年齢を数える。
  - **落ちている数字**: 入力に必要保障額（`protection`）・相続税の目安（`inheritanceTax`）を入れるとエンジンは計算するのに、接続口が答えに写していなかった。
  - `explain_value` の答えの多く（税・社会保険料の1年で約11KB のうち約8KB）は、使った制度の値の出典の文。

## 決定

### 1. 答えに足す物（今までの項目は変えない）

- **`keyFigures`（主な数字）**: 画面の「プランを比べる」の比較の表と同じ関数（`app/src/workspace/plans/compare.ts` の `metricsOf`）で数える。
  - `assetsAtAge`: `at_ages` の本人の年齢ごとの、その年の金融資産（`age`・`year`・`amount`）。年齢の既定は画面の表示の設定の既定（95歳）。今より前の年齢は画面と同じく表の最初の年の年齢にする
  - `depletion`: 資産が尽きる年（尽きなければ null）と、その年の本人の年齢
  - `minimum`: 金融資産がいちばん少ない年と額と本人の年齢
  - `lifetimeTakeHome`（生涯の手取りの合計）・`lifetimeExpense`（生涯の支出の合計。税・社会保険料を除く）・`loanRepayment`（住宅ローンの返済の合計。繰上返済・手数料を含む）
  - `years`: 数えた年（画面の表に出す年。計算基準月が年の途中なら翌年から）。`years`（年ごとの合計）は今までどおり計算の最初の年からなので、最初の年が1つずれることがある
- **`members` と年ごとの `ages`（家族の年齢）**: 画面のキャッシュフロー表の年齢の行と同じ関数（`app/src/workspace/present.ts` の `ageRows`。今回 export した）で、同じ呼び方（ご本人・配偶者・第1子・お母さま…）と同じ「世帯にいる年」で出す。`members` は鍵（`self`・`spouse`・`child1`…）と呼び方、年ごとは鍵 → 年齢。summary では `years` の各年に `ages`、table では `ages`（年ごとの1行）。世帯の物の ID は鍵にしない
- **`protection`（必要保障額の推移）・`inheritanceTax`（相続税の目安）**: 入力にあればエンジンの出力をそのまま写し、人に年齢の鍵（`who`・`survivorWho`・`decedentWho`、相続人の `who`）を添える。必要保障額の年は、答えの年（`from_year`・`to_year`・`every_years`）と同じに絞る。相続税の目安は、画面と同じく時点（`points`）を入れたときだけ計算される（時点の無い設定は表示だけの設定として計算の前に外す。0184）

### 2. 答えの大きさの選択（何も選ばなければ今までどおり。足した物が付くだけ）

- `every_years`（1〜10）: 何年おきの年だけ。絞った範囲の最初の年と最後の年はいつも入る。summary の `years`・table の行・年齢・必要保障額の年に効く。主な数字は毎年で数える
- `fields`: summary の年ごとの数字を選ぶ（`income`・`taxSi`・`expense`・`net`・`financialAssets`・`debt`・`shortfall`）。`year` はいつも入る
- `omit`: 省く物（`notices`・`packs`・`totals`・`insurance`〔table の summary の保険の年ごとの要約〕・`ages`・`years`〔主な数字だけにする〕・`keyFigures`・`protection`・`protectionDetail`〔必要保障額の内訳だけ〕・`inheritanceTax`）
- `at_ages`: 主な数字の年齢（0〜120 を5つまで）
- 選べない値は、選べる値を並べたエラーで返す
- `explain_value` に `omit`（`sources`＝制度の値の出典の文、`params`＝使った制度の値と `ids.regulation`、`message`＝読み方の案内）を足す。残りの中身は画面の根拠と同じまま（項目を落とすだけ）。出典は制度の値ID から `get_regulation_value` で引ける
- INSTRUCTIONS と道具の説明に、比べる・振るときは `omit` に `years` を入れて主な数字だけを取ること、推移は `every_years`・`fields` で絞ることを書いた

### 3. 作り

- 主な数字と年齢は `app/src/connector/summary.ts` の `summarize`（画面の `metricsOf`・`ageRows`・`roles` を呼ぶだけ）を、数字の根拠・計算の前の処理と同じ1つの JS（`crates/lifeplan/dist/explain.js`）に入れ、計算と同じ固めた新しい実行環境（quickjs-ng）で動かす（0183・0184 と同じやり方）。接続口に数え方を書き直さない。lint の許可に `roles`・`plans/compare` を足した
- 渡すのは表示の形の計算の出力と、計算の前の処理を当てる前の要求（数字の根拠と同じ。画面の比較の表も、計算の前の処理を当てる前の世帯の要求で数える）。`changes` を当てた後の要求なので、AI が生年月や表の最後の年を変えれば、それに合わせて数える
- 足し引きは `crates/lifeplan/src/answer.rs`（`calc::shape` の答えに足して絞る）。年齢も主な数字も人の鍵も要らない選択なら、同梱の関数は動かさない
- 時間: 見本の世帯で1回あたり約25ms 増える（計算は約0.2秒）

### 4. テスト

- 画面の側（`app/test/connector-summary.test.ts`）: 7つの見本の問い（尽きる世帯・年齢を2つと想定の変更・家を買う・単身・世帯の外の家族・必要保障額の見本・今より前の年齢）で、`summarize` の主な数字が `metricsOf` と同じで、`compareTable`（画面の比較の表）の文字とも合うこと、年齢が `ageRows` と同じこと、世帯の物の ID が答えに出ないこと、どのモデル世帯でも数えられること、年齢の既定が画面の既定と同じことを確かめ、答えを見本（`crates/lifeplan/tests/fixtures/calc-summary/expected.json`）に書く（`LIFEPLAN_UPDATE_FIXTURES=1` で作り直す）
- 接続口の側（`crates/lifeplan/tests/mcp_connector.rs` の `calculate_key_figures_match_the_screen`）: 本物の接続口を MCP で呼び、見本と同じ主な数字・年齢（summary と table の両方）、今までの項目が残ること、主な数字だけで 1KB 足らずになること、`every_years`・`fields`・`omit`、必要保障額・相続税の目安と人の鍵、選べない値のエラー、`explain_value` の `omit` を確かめる。`answer.rs` の単体のテストで、足すだけで今までの項目が変わらないことを確かめる

## 理由

- 主な数字を画面と同じ関数で数えれば、AI が FP に言う「尽きる年」「95歳の時点の資産」が、画面の「プランを比べる」と同じになる（数え方の細かい決まり〔表に出す年・資金不足の行で尽きたとみる・今より前の年齢〕を二重に持たない）。
- 年齢も画面の表の年齢の行と同じ関数なら、結婚の予定・独立・世帯の外の家族の扱いが画面とそろう。
- 答えの大きさは AI が選ぶ。既定を小さくすると今の呼び方の答えが変わるので、既定は今までどおりにして、足した物と絞り方の案内を説明に書いた。

## 代案（採らなかったもの）

- **主な数字を Rust で数える**: 尽きたとみる決まり（0179）・表に出す年・年齢の決まりを二重に持つことになり、ずれる。
- **既定の答えを小さくする（5年おき・知らせを省く）**: 今の呼び方の答えが変わる。AI が年ごとの数字を前提に使っている会話がある。
- **比べる道具を一緒に足す**: 1回で何通りも計算する道具は、上限と答えの形の決めが別に要るので、別の変更にする。主な数字はその土台になる。

## 影響

- 新しいファイル: `app/src/connector/summary.ts`・`app/test/connector-summary.test.ts`・`crates/lifeplan/src/answer.rs`・`crates/lifeplan/tests/fixtures/calc-summary/expected.json`。
- 直したファイル: `app/src/connector/explain.ts`（`summarize` も出す）・`app/src/workspace/present.ts`（`ageRows` を export。中身は変えない）・`app/eslint.config.js`・`app/scripts/build-explain.ts`（コメント）・`crates/lifeplan/src/{engine.rs,server.rs,main.rs}`・`crates/lifeplan/tests/fixtures/tools/explain_value.input-schema.json`・`docs/ai-connector.md`。
- 画面・計算の結果・エンジン・制度データ・世帯ファイルの形式・縮約版・AIに渡した記録は変えない。
- 大きさ（見本の世帯 `salariedCoupleTwoKids`）: 主な数字だけ（`omit` に years・notices・packs・ages・totals）で 11.0KB → 0.5KB、5年おきの金融資産だけ（知らせ・版を省く）で 1.6KB、表の形の金融資産の行を5年おき・保険の要約と知らせを省くと 15.1KB → 1.9KB、`explain_value` の税・社会保険料の1年は出典を省くと 11.3KB → 7.4KB、制度の値を省くと 2.3KB。既定の年ごとの合計は年齢が付いて 11.0KB → 13.4KB。必要保障額の見本は、必要保障額の推移（2人×20年の内訳つき）が付いて 8.0KB → 32.6KB（`protectionDetail` で内訳を省ける）。

## 未確定

- **既定の大きさ**: FP の使い方を見て、既定で知らせを省くか・年齢を付けるかを見直す。
- **主な数字に足す物**: 画面の比較の表にある年金の見込み（65歳からの月額。0075）は、年金の見込みを別に計算するので入れていない。比べる道具と一緒に考える。
- **計算の最初の年**: 年ごとの合計（`years`）は計算の最初の年（計算基準月が年の途中でも）から、主な数字と画面の表は翌年から。年ごとの合計の始まりを画面にそろえるかは、今の呼び方を変えるので後で決める。
- **知らせを文にする**: 計算の知らせ（`notices`）はコードのまま。画面の文にするのは別の変更で。

## 追記

### 2026-11-11: 比べる道具（0198）

- 主な数字 `keyFigures` を土台に、1回で何通りも計算して並べる道具 `compare` を足した（0198）。年金の見込み（65歳からの月額）と、年ごとの合計の最初の年をそろえるかは、0198 の未確定に引き継いだ（比べる道具の系列は画面の表に出す年から）。
