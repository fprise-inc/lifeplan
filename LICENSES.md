# フォルダとライセンスの対応

0021 の決定に従い、フォルダごとのライセンスをここにまとめる。新しいデータのフォルダを作るときは、そのフォルダに `LICENSE` を置き、この表に足す。

| フォルダ | 中身 | ライセンス |
|---|---|---|
| （下に無いもの） | 提供元（FPRISE, INC.）が書いたコード | MIT（[LICENSE](LICENSE)） |
| `data/regulation/tax/`・`data/regulation/socialInsurance/` | 制度データ（提供元が整理した部分）。出典は値ごとの `sources`（国・地方公共団体・保険者の公表資料。各提供元の利用条件に従う） | CC0 1.0（[tax](data/regulation/tax/LICENSE)・[socialInsurance](data/regulation/socialInsurance/LICENSE)） |
| `data/modelHouseholds/` | 架空のモデル世帯 | CC0 1.0（[LICENSE](data/modelHouseholds/LICENSE)） |
| `engine/test/fixtures/regulation/` | 【架空の見本】テスト用の制度データ。実在の制度の値ではない | CC0 1.0（各フォルダの LICENSE） |
| `app/src-tauri/icons/` | アプリのアイコン（提供元が作ったもの） | MIT（[LICENSE](LICENSE)） |
| `app/src/assets/illustrations/` | 入力のホームのカードのイラスト（ファイナンシアのために作成したイラスト。画像生成AIで作り、提供元が仕上げたもの） | CC0 1.0（[LICENSE](app/src/assets/illustrations/LICENSE)） |
| `report/fonts/` | 提案書の PDF に同梱するフォント（BIZ UDゴシック。googlefonts/morisawa-biz-ud-gothic のコミット 18934af のもの） | SIL OFL 1.1（[OFL.txt](report/fonts/OFL.txt)。0021 の表の「同梱フォント」） |
| `registry/` | ID の登録簿（科目の木・入力項目・計算部品・制度の値） | CC0 1.0（[LICENSE](registry/LICENSE)） |

第三者の依存のライセンスは、CI で検査する（npm は `engine/scripts/check-licenses.ts`・`app/scripts/check-licenses.ts`、Rust は `deny.toml`・`app/src-tauri/deny.toml` と cargo-deny）。
アプリの画面に同梱するフォント（BIZ UDPGothic）は SIL OFL 1.1（npm の `@fontsource/biz-udpgothic` から。0021 の表の「同梱フォント」）。
