# sdk/（SDK フォルダの手書きの正本）

FP の PC のカスタム層に置く SDK フォルダ（設計記録 [0019](../docs/decisions/0019-sdk-folder-and-agents-md.md)）のうち、手で書く説明書（`docs/`）と見本（`examples/`）の正本です。
型・JSON Schema・公式の計算部品と帳票の部品（`types/`・`schemas/`・`reference/`）はリリースのビルドがリポジトリの正本から作るので、ここには置きません。

- `docs/reports.md` … 帳票（Typst）の作り変えと、帳票に渡す値の場所
- `docs/extensions.md` … 拡張の束（宣言型の入力欄・見せ方の差し込み口 `view.balance`・`report.chapter`・提案書の拡張の章）の作り方（0114）
- `docs/extension-points.md` … 計算エンジンの差し込み口と、差し替えてよい公式部品の一覧・差し替えの約束（入力と出力の形・約束の版と改訂・公式の計算と違うことの見せ方。0119）
- `examples/reports/<帳票名>/main.typ` … 独自帳票の見本（カスタム層の `reports/<帳票名>/` と同じ形）
- `examples/extensions/<束の名前>/` … 拡張の束の見本（カスタム層の `modules/<束の名前>/` と同じ形）。`combined-bs/` は合算BS で、アプリに同梱した公式の拡張 `ext.official.combinedBs` と同じファイル（アプリはここを読み込む）

拡張の束が読む `@lifeplan/sdk` の型の正本は `report/src/sdk.ts` です（リポジトリの中では、アプリと帳票の部品の設定がこの名前をこのファイルにつなぎます）。
