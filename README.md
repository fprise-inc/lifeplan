# ファイナンシア ライフプラン（Financia Lifeplan）

FP（ファイナンシャルプランナー）向けの無料ライフプランソフトです。開発中のため、このリポジトリはβ公開（2027年2月予定）まで非公開です。

- 提供: FPRISE, INC.
- ライセンス: FPライズが書いたコードは MIT（[LICENSE](LICENSE)）

## 開発

- 設計の決定は [`docs/decisions/`](docs/decisions/README.md)（ADR）にある。作業の前に関係する記録を読む。
- `engine/` … 計算エンジン（TypeScript）。`npm ci` の後、`npm run typecheck`・`npm run lint`・`npm test`・`npm run build`
- `crates/engine-host/` … エンジンを quickjs-ng で動かす Rust のホストと、JSON を受けて JSON を返すコマンド `engine-host`
- `data/regulation/` … 制度データの正本（YAML。いまは所得税・住民税と被用者保険。すべての行が原本での確認待ち）。`npm run build` で `engine/dist/regulation/` に正規化した JSON を作る
- `data/modelHouseholds/` … 架空のモデル世帯（CC0）。`engine/` で `npm run models` を流すと制度改正の差分を表にする
- `registry/` … ID の登録簿（科目の木・入力項目・計算部品・制度の値）。入力項目・計算部品・制度の値は `npm run gen` が正本から作る
- 答え合わせ（検証 L2）: `engine/` で `npm run l2`（公式の計算例との一致の合格率）
- 一致テスト: `cargo build --release` の後、`engine/` で `npm run parity`（Node・quickjs-ng・JavaScriptCore（Bun があれば）で同じ入力から同じ結果になることを SHA-256 で確かめる。`-- --jsc` で Bun を必須にする）
