# フォルダとライセンスの対応

0021 の決定に従い、フォルダごとのライセンスをここにまとめる。新しいデータのフォルダを作るときは、そのフォルダに `LICENSE` を置き、この表に足す。

| フォルダ | 中身 | ライセンス |
|---|---|---|
| （下に無いもの） | 提供元（FPRISE, INC.）が書いたコード | MIT（[LICENSE](LICENSE)） |
| `data/regulation/sample/` | 【架空の見本】土台の確認用の制度データ。実在の制度の値ではない | CC0 1.0（[LICENSE](data/regulation/sample/LICENSE)） |
| `registry/` | ID の登録簿（キャッシュフロー表の科目の木） | CC0 1.0（[LICENSE](registry/LICENSE)） |

第三者の依存のライセンスは、CI で検査する（npm は `engine/scripts/check-licenses.ts`、Rust は `deny.toml` と cargo-deny）。
