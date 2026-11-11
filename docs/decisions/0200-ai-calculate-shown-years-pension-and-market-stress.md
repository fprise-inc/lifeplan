# 0200. AI接続口の計算の年を画面の表にそろえ、主な数字に年金の見込みを足し、比べる道具で「相場が下がった場合」を選べるようにする

- 状態: 採用（2026-11-11）
- 固定の強さ: 道具の入出力（`calculate` の `years`・表の行・`totals` の年、`keyFigures.pension`、`omit` の `pension`、`compare` の `market_stress` と答えの `marketStress`・`diff.pensionMonthly`・`diff.pensionClaimedMonthly`）は試験版（0015 と同じ。予告して変えることがある）。作り（画面の年金の見込みの関数を状態に依らない所へ切り出して同梱する・数字の根拠の JS にも Math の代わりを置く）は内部
- 前提にする記録: 0005（計算の実行環境）、0015（AI接続口）、0026（相場が下がった場合）、0067・0075（年金の見込み）、0194（主な数字）、0195（組み込みの代わり）、0198（比べる道具）

## 背景

- 0194 の未確定「計算の最初の年」: `calculate` の年ごとの合計（`years`）・表の行・合計（`totals`）は計算の最初の年から出していた。計算基準月が年の途中（見本の世帯はどれも 2026-10 か 2026-11）だと、最初の年は数か月分しかない。画面の表・主な数字（`keyFigures`）・数字の根拠（`explain_value`）はその年を出さない（`explain_value` はその年を聞かれると「表の年を指定して」と返す）。AI が数か月分の収入を「2026年の収入」として話すおそれがあった。
- 0194・0198 の未確定「年金の見込み」: 画面の「プランを比べる」の比較の表には、65歳からの年金の月額（世帯の合計・今の水準。0075）の行がある。接続口の主な数字には無かった。
- 0198 の未確定「相場が下がった場合」: 画面の資産運用のタブの「相場が下がった場合」（3つの型。0026）を、比べる道具の通りに選べなかった（エンジンの型 `stress_test` は既定の値で動き、画面の型とは年・下がる幅が違う）。
- 利用者の判断（2026-11-11）: 最初の年は画面にそろえる（答えが変わってよい）・通りの上限は8のまま・年金の月額は既定で入れ、`omit` で省けるようにする。

## 決定

### 1. 計算の年を画面の表にそろえる

- `calculate`（と、同じ関数で作る `compare` の系列）の `years`・表の行（`output: "table"`）・年齢の行・必要保障額の年は、画面の表に出す年から（画面の `present.ts` の `displayYears` と同じ決まり: 計算基準月が1月ならその年、2月以降なら翌年から。`calc.rs` の `first_shown_year`）。
- `totals`（表の形の `summary.totals` も）は、エンジンの表の要約と同じ数え方（`cf.income`・`cf.taxSi`・`cf.expense` の下の行と `cf.net`）で、同じ年だけを数え直す。これで `totals.income − totals.taxSi` が主な数字の生涯の手取りと、`totals.expense` が生涯の支出と同じになる。表の形の `summary` のほかの要約（保険の年ごとの要約など）はエンジンの物のまま。
- 決まりは1行の年の数え方だけなので接続口に書き、どの見本の世帯でも主な数字の数えた年（`keyFigures.years.from`）・生涯の手取りと支出と合う（テスト）。
- 比べる道具（0198）は、系列の最初の年を主な数字の年から取っていた（この変更の前の取り繕い）。`calculate` と同じ `calc::shape` がそろえるので、その取り繕いは外した。

### 2. 主な数字に、65歳からの年金の月額を足す

- `keyFigures.pension`: 画面の比較の表の年金の行（App.tsx の `usePlanPensions`。0075）と同じ写しの要求（今の水準＝賃金・物価の伸びとマクロ経済スライドを外し、万一の想定・必要保障額・相続税の目安も外す。65歳からは受け取り開始を外した写し、受け取り開始を変えた人がいれば変えたままの写しも）を、画面と同じく計算の前の処理を当てて計算し、同じ関数で数える。
  - `monthly`（65歳からの世帯の合計の月額。全員受け取り中なら今の月額）・`claimedMonthly`（受け取り開始からの世帯の月額。変えた人がいなければ `monthly` と同じ）・`receiving`・`anyClaim`・`people`（人ごと: 年齢の鍵 `who`・受け取り開始の文 `from`・年額 `annual`・月額 `monthly`・推計か `estimated`）・`claimedPeople`（受け取り開始を変えた人がいるときだけ）。
  - 年金のカードに出す人（本人・配偶者）がいなければ null。受け取り開始の次の年が表の外なら、その人の額は null（画面は「—」）。
- 既定で入る。写しの要求を1〜2回余分に計算するので、`omit` の `pension` で省ける（省けば計算もしない）。`keyFigures` を省いたときも計算しない。
- 比べる道具の `diff` に `pensionMonthly`・`pensionClaimedMonthly`（この通り − 基本の月額）を足した。
- 作り:
  - 画面の `input/pensionEstimate.ts` から、画面の状態（preact のフック）に依らない部分（写しの要求 `pensionEstimateRequest`・人ごとの年額 `pensionLines`・世帯の月額・比較の表の1列 `planPensionOf`）を `input/pensionLines.ts` に移した。入力の欄の定義（`stages/pension.ts`）にあった `claimMonth`・`pensionMembers`・`modeOf` も移した（どちらのファイルも同じ名前で出し直す）。画面の比較の表の年金の行も `planPensionOf` を使う（答えは同じ）。写しは JSON で写す（固めた実行環境に `structuredClone` が無い。要求は JSON の値なので同じ）。
  - 接続口は、数字の根拠の JS（`explain.js`）の `pensionRequests` で写しの要求を作り、計算の前の処理を当てて計算し、結果を `summarize` に渡す（`answer.rs` の `pension_results`）。世帯の月額の丸めに `Math.round` を使うので、`explain.js` の頭にも `plan.js` と同じ `Math.round`・`Math.pow` の代わり（0195 の4。`MATH_INTRO`）を置いた（固めた実行環境のグローバルは変えない。前は呼ぶとエラーになったので、今までの答えは変わらない）。`explain.js` は 305KB → 313KB。
  - lint の許可に `input/pensionLines` を足した。

### 3. 比べる道具で「相場が下がった場合」の型を選べるようにする

- 基本と通りに `market_stress`（`drop`＝退職の直後に株などが下がる・`low`＝取り崩しを始めてから〔予定が無ければ退職から〕しばらく利回りが低いまま・`minus1`＝利回りがずっと想定より1%低い）を書ける。画面の資産運用のタブと同じ関数（`invest/present.ts` の `stressRequests`・`stressLabel`）で、画面と同じくプランの変更を当てた後の要求に重ねる（退職の年・取り崩しを始める年はその要求から読み、下がる幅・年数は画面と同じ既定）。答えの通りに `marketStress`（`key` と画面の文 `label`）を添える。
- エンジンの型 `stress_test` とは1つの通りにどちらか1つ（両方書いた通り・知らない型の通りは、その通りだけ理由を返す）。基本に重ねる通りは、`stress_test` も `market_stress` も書かなければ基本の物を使い、どちらかを書けば通りの物だけを使う。
- 作りは `plan.js`（`connector/plan.ts` の `marketStress`）。lint の許可に `invest/present` を足した。`calculate` には足していない（並べて見る物なので）。

### 4. 変わった見本の数字（1 の確かめ）

- 接続口のテストの見本のうち、画面の数字の `years`・`totals` を持つ物（`fixtures/plan/expected.json` の6つの問いと渡された世帯、`fixtures/prepare/expected.json` の2つ）を作り直した。見本の画面の数字は、画面の表に出す年（`displayYears`）で数えるようにした（`app/test/helpers.ts` の `screenYears`・`screenTotals`）。
- 前と後を比べると、どれも「年ごとの数字から 2026年（基準月 2026-10 の、10〜12月の3か月分）の1行が外れ、ほかの年は1円も変わらない」「合計の年間収支の差が、外した 2026年の年間収支とちょうど同じ（例: 働く最後の年齢を63歳に 623,302円）」「収入・税・支出の差も 2026年の分だけ（例: 2,760,009円・569,351円・1,567,356円）」だった。根拠・変更の見本は変わっていない。主な数字の見本（`fixtures/calc-summary/expected.json`）は、`pension` が足されただけで、ほかの数字・年齢は同じ。表が 2027年までの見本（`single25`）の `years` は、2026年・2027年の2行から 2027年の1行になった（テストを直した）。

### 5. 測った数字（見本の世帯 `salariedCoupleTwoKids`、リリースのビルド、10コアの手元の機械。2回目以降）

| 呼び方 | 前（0198） | 後 | 答えの大きさ |
|---|---|---|---|
| `calculate`（主な数字だけ） | 0.24 秒 | 0.42 秒（`omit` に `pension` で 0.22 秒） | 0.4KB → 0.7KB |
| `compare` 基本＋3通り（プランの変更） | 0.39 秒 | 0.65 秒 | 7.6KB → 9.2KB |
| `compare` 基本＋8通り（プランの変更） | 1.0 秒 | 1.8 秒 | 16.2KB → 19.4KB |
| `compare` 基本＋8通り（別の見本の世帯） | 0.39 秒 | 0.78 秒 | 10.4KB → 13.6KB |
| `compare` 基本＋相場の3型（`investmentCouple`） | — | 0.70 秒 | 9.5KB |

- 年金の見込みは、1通りあたり写しの要求の計算1回（受け取り開始を変えた通りは2回）と、その計算の前の処理で約 0.2 秒増える。上限の8通りでも約2秒の見込みの内。
- 手本が計算できることを見本の世帯ごとに確かめるテスト（`tests/input_guide.rs`）は、年金の見込みを確かめる物ではないので `omit` に `pension` を入れて軽くした（テストを並べて流すと、最適化しないビルドで計算の時間の上限に届くことがあったため）。

### 6. テスト

- 画面の側:
  - `app/test/connector-summary.test.ts`: 主な数字の年金の見込みが、画面の比較の表（`compareTable` に `planPensionOf` の列を渡した年金の行の文）と同じ（繰下げの見本・受け取り中の見本を含む）。世帯の月額が人ごとの年額の合計÷12。見本を作り直した。
  - `app/test/connector-compare.test.ts`: 比較の表の年金の行の列（`planPensionOf`）と、相場が下がった場合の3つの型を重ねたプランの主な数字・型の文・金融資産を見本に足した（基本のプランを動かした見本を含む）。
  - `app/test/connector-plan.test.ts`・`connector-prepare.test.ts`: 画面の数字を画面の表に出す年で数える（`helpers.ts`）。
- 接続口の側（`crates/lifeplan/tests/mcp_connector.rs`）:
  - `reduced_view_calculates_the_same_for_every_model_household`: どの見本の世帯でも、`years` の最初の年が主な数字の数えた年、`totals.income − totals.taxSi` が生涯の手取り、`totals.expense` が生涯の支出と同じ。縮約版でも主な数字（年金の見込みを含む）が同じ。
  - `calculate_key_figures_match_the_screen`: 年金の見込みが既定で入り、`omit` の `pension` で省ける。
  - `compare_matches_the_screen`: 通りの年金の月額・受け取り開始からの月額と差が画面の比較の表と同じ。相場が下がった場合の型が画面と同じ数字・同じ文。型の誤り・エンジンの型と一緒の通り・基本の型を受け継ぐ通り。
  - `calc.rs` の単体のテスト（最初の年・合計の数え直し・表の形の要約）、`compare.rs` の単体のテスト（型の確かめ）。

## 理由

- 計算の年を画面の表にそろえれば、`calculate`・主な数字・数字の根拠・画面で同じ年を見る（数か月分の年を1年分として話さない。`explain_value` に渡せない年を返さない）。
- 年金の見込みは、画面の比較の表と同じ写しの要求・同じ関数で数えれば、AI が FP に言う「65歳からの年金は月○万円」が画面とずれない。画面の状態に依らない部分を切り出したので、画面と接続口が同じ1つの関数を使う。
- 相場が下がった場合を画面と同じ関数で重ねれば、画面の資産運用のタブで見た「○歳まで持つ」と同じ前提で並べられる。

## 代案（採らなかったもの）

- **計算の最初の年に「何か月分」の印を付けて残す**: 今の答えは変わらないが、主な数字・数字の根拠・画面と年がずれたまま。利用者の判断で、そろえることにした。
- **年金の世帯の月額の丸めを接続口（Rust）で行う**: 数え方を二重に持つことになる。固めた実行環境で `Math.round` を呼べないので、`plan.js` と同じ代わりを `explain.js` にも置いた。
- **年金の見込みを `plan.js` で数える**: `plan.js`（約 2MB）を計算ごとに読み込むことになり、1回約 0.1 秒×2 増える。切り出した部分は小さく、`explain.js` は 8KB 増えるだけ。
- **年金の見込みを既定で省く**: 利用者の判断で既定で入れる（速さが要るときは `omit`）。

## 影響

- 新しいファイル: `app/src/workspace/input/pensionLines.ts`。
- 直したファイル: `app/src/workspace/input/{pensionEstimate.ts,stages/pension.ts}`（移した関数を出し直す。画面の答えは変えない）・`app/src/connector/{summary.ts,explain.ts,plan.ts}`・`app/scripts/build-explain.ts`・`app/eslint.config.js`・`app/test/{helpers.ts,connector-summary.test.ts,connector-compare.test.ts,connector-plan.test.ts,connector-prepare.test.ts}`・`crates/lifeplan/src/{calc.rs,answer.rs,engine.rs,compare.rs,server.rs}`・`crates/lifeplan/tests/{mcp_connector.rs,input_guide.rs}`・見本（`fixtures/{plan,prepare,calc-summary,compare}/expected.json`・`fixtures/tools/compare.input-schema.json`）・`docs/ai-connector.md`・0194・0198・この索引。
- `calculate` の答え: `years`・表の行・年齢の行・必要保障額の年から計算の最初の年（基準月が年の途中のとき）が外れ、`totals` がその年を除いた合計になる。`keyFigures` に `pension` が加わる。
- 画面・エンジン・制度データ・世帯ファイルの形式・縮約版・AIに渡した記録は変えない。
