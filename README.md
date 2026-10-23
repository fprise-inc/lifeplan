# ファイナンシア ライフプラン（Financia Lifeplan）

FP（ファイナンシャルプランナー）向けの無料ライフプランソフトです。開発中のため、このリポジトリはβ公開（2027年2月予定）まで非公開です。

- 提供: FPRISE, INC.
- ライセンス: FPライズが書いたコードは MIT（[LICENSE](LICENSE)）

## 開発

- 設計の決定は [`docs/decisions/`](docs/decisions/README.md)（ADR）にある。作業の前に関係する記録を読む。
- `engine/` … 計算エンジン（TypeScript）。`npm ci` の後、`npm run typecheck`・`npm run lint`・`npm test`・`npm run build`
- `crates/engine-host/` … エンジンを quickjs-ng で動かす Rust のホストと、JSON を受けて JSON を返すコマンド `engine-host`
- `crates/lifeplan/` … AI接続口（MCP サーバー。`lifeplan mcp`、標準入出力だけ。0015）。`crates/ai-share/` はアプリ本体に組み込む側（共有の台帳・縮約版・文章の包み方・AIに渡した記録・受け口。0014・0015）、`crates/ai-ipc/` は両者の間の取り決め。つなぎ方は [`docs/ai-connector.md`](docs/ai-connector.md)。テストは `cargo test --release -p lifeplan -p ai-share -p ai-ipc`（`engine/dist` が要る）
- `data/regulation/` … 制度データの正本（YAML。いまは所得税・住民税（`tax`）、社会保険（`socialInsurance`。被用者保険・国民年金・国民健康保険・後期高齢者医療・介護保険の第1号・雇用保険の給付など）、公的年金（`pension`）。すべての行が原本での確認待ち）。`npm run build` で `engine/dist/regulation/` に正規化した JSON を作る
- `data/modelHouseholds/` … 架空のモデル世帯（CC0）。`engine/` で `npm run models` を流すと制度改正の差分を表にする
- `app/` … アプリ本体（Tauri 2）。画面は Preact＋TypeScript（`app/src/`）、本体は Rust（`app/src-tauri/`）。`engine/` で `npm run build` の後、`app/` で `npm ci`・`npm run typecheck`・`npm run lint`・`npm test`。起動は `npx tauri dev`（ブラウザだけで画面を見るなら `npm run dev` で http://localhost:1420/ ）。本体のテストは `app/src-tauri/` で `cargo test`。3つの OS でのビルド（バンドル）は GitHub Actions の `app-bundle`（手で起動するかリリースのときだけ）
- `report/` … 提案書の PDF（提案書の標準構成。0009）。計算結果から帳票の入力（JSON。形は `report/schema/proposal-input.schema.json`）を組み立てる部品（`report/src/`）と、公式の帳票（Typst のパッケージ `@lifeplan/report-core`。`report/typst/report-core/`）、同梱フォント（BIZ UDゴシック。`report/fonts/`）。`engine/` で `npm run build` の後、`report/` で `npm ci`・`npm run typecheck`・`npm run lint`・`npm test`。見本の PDF は `npm run samples`（`report/dist/samples/` に出る。CI の成果物 `proposal-samples` でも見られる）
- `crates/report-pdf/` … Typst をライブラリとして組み込み、帳票の入力から PDF を作る（刻印・必須の記載・内部情報はここで帳票の外側から付ける）。呼び出し口は `report_pdf::render_proposal`。重いので既定のビルドには入れていない: `cargo build -p report-pdf`・`cargo test -p report-pdf`
- 提案書の PDF とヒアリングシートは、アプリの画面（上のタブ「提案書」、入力のホームの「ヒアリングシート」）につないである。PDF は本体（`app/src-tauri/src/report.rs`）が report-pdf で作り、保存とシートの読み書きのファイルの出入りは本体の平文の書き出しの出口（`app/src-tauri/src/export.rs`。0020 の5）を通す。アプリ本体のビルドには report-pdf（Typst）が入る
- 持ち帰り用のレポート（0030）… 顧客に渡す HTML ファイル1つ（オフラインで開き、許したつまみを動かして試せる）。提案書のタブの「持ち帰り用のレポート」から書き出す。画面の部品は `app/src/takeaway/`（`app/` の `npm run prepare-assets` が `public/takeaway/` に1つの JS・CSS にまとめる）、中身を作るのは `app/src/workspace/takeaway/`、保存は本体の `app/src-tauri/src/takeaway.rs` から平文の書き出しの出口へ。ネットワークを切ったヘッドレスのブラウザでの確かめは `app/` で `npm run check:takeaway -- <パスワードなしの HTML> [<パスワードありの HTML> <パスワード>]`（ブラウザの場所は環境変数 `HEADLESS_BROWSER`）。見本のファイルは `TAKEAWAY_SAMPLE_DIR=<出力先> npx vitest run test/takeaway.test.ts -t 見本のファイル`
- `hearing/` … ヒアリングシート（0018）。シート定義（`hearing/sheets/<シートID>/<版>.json`。形式は `hearing/schema/`）、.xlsx の書き出しと取り込み、世帯データとの変換（不足・矛盾・推定の印）。npm の依存なしの TypeScript で、画面からも読める。`engine/` で `npm run build` の後、`hearing/` で `npm ci`・`npm run typecheck`・`npm run lint`・`npm test`。見本のシート（架空の記入例）は `hearing/samples/`（`npm run sample` で作り直す）
- `statement/` … 明細の取り込みと仕分け（0034）。クレジットカード・銀行・家計簿アプリの明細の CSV と文字の入った PDF を PC の中だけで読み（カード番号・口座番号らしき数字は読んだ時点で消す。元のファイルは持たない）、列の対応付け・店の名前の辞書（同梱＋事務所で覚える）・働き方ごとの区分で仕分け、基本生活費の内訳の月平均と年1回の支払いを候補にする。迷う行を前もってお客さまに印を付けてもらう確認シート（.xlsx）の書き出しと読み込みもここ。npm の依存なしの TypeScript で、画面からも読む。`statement/` で `npm ci`・`npm run typecheck`・`npm run lint`・`npm test`。テストの明細はすべて架空（`npm run fixtures` で `test/fixtures/` を作り直す）
- `xlsx/` … 表計算のファイル（.xlsx）の書き出しと読み込みの土台（zip・XML・書式・入力規則・管理の値を3か所に書く・返ってきたファイルを信用しない読み込み）。`hearing/`・`statement/` が使う。npm の依存なしの TypeScript で、画面からも読む。`xlsx/` で `npm ci`・`npm run typecheck`・`npm run lint`・`npm test`
- `config/distribution.toml` … 配布元の設定（識別子・名前・配信先・公開鍵。0017 の2）。`app/` で `npm run gen:distribution` が Tauri の設定を作る
- `registry/` … ID の登録簿（科目の木・入力項目・計算部品・制度の値）。入力項目・計算部品・制度の値は `npm run gen` が正本から作る
- 答え合わせ（検証 L2）: `engine/` で `npm run l2`（公式の計算例との一致の合格率）
- 一致テスト: `cargo build --release` の後、`engine/` で `npm run parity`（Node・quickjs-ng・JavaScriptCore（Bun があれば）で同じ入力から同じ結果になることを SHA-256 で確かめる。`-- --jsc` で Bun を必須にする）。まとめて計算（`runBatch`）の結果も比べる
- 速さの計測: `cargo build --release` の後、`engine/` で `npm run bench`（100年分のモデル世帯の5案×4想定を Node・JavaScriptCore・quickjs-ng で測り、目標と `engine/bench/baseline.json` の前の値を表にする。CI でも毎回測る。0005 の追記）
