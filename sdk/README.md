# sdk/（SDK フォルダの手書きの正本）

FP の PC のカスタム層に置く SDK フォルダ（設計記録 [0019](../docs/decisions/0019-sdk-folder-and-agents-md.md)）のうち、手で書く説明書（`docs/`）と見本（`examples/`）の正本です。
型・JSON Schema・公式の計算部品と帳票の部品（`types/`・`schemas/`・`reference/`）はリリースのビルドがリポジトリの正本から作るので、ここには置きません。

- `docs/reports.md` … 帳票（Typst）の作り変えと、帳票に渡す値の場所
- `examples/reports/<帳票名>/main.typ` … 独自帳票の見本（カスタム層の `reports/<帳票名>/` と同じ形）
