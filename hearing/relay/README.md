# Web のヒアリングの受け付けのサーバー（`hearing/relay/`）

お客さまが答えた Web のヒアリングの**暗号文だけ**を預かる Cloudflare Workers のサーバー。決まりは [設計記録 0125](../../docs/decisions/0125-web-hearing-e2e.md)。

- `handler.ts` … API の処理（Web 標準の Request と Response だけ。試し・開発用のサーバーでも同じものを動かす）
- `worker.ts` … Workers の入口（API と、お客さまのページ `/h/` の静的なファイル。どの答えにも守りの見出しを付ける）
- `r2.ts`・`store.ts` … 置き場（本番は R2、試しはメモリ）
- `wrangler.toml` … 設定（**値はすべて仮の値**。「置き換える」の印の所を本番の前に置き換える）

サーバーが持つのは、問い・答え・書類の暗号文と、2つの合言葉の SHA-256・日時だけ。開く鍵は URL のフラグメント（サーバーに送られない）と FP の世帯ファイルの中にしか無い。コードは中身・IP・合言葉をログに書かない（console を使わない。lint で止める）。

## 手元で動かす（アカウントは要らない）

```sh
# 1. お客さまのページを作る（app/dist-hearing-form/h/）
cd app && npm run build:hearing-form && cd ..
# 2. 受け付けを手元で動かす（miniflare が R2 と回数の制限を手元に作る。外には何も登録しない）
cd hearing/relay
WRANGLER_SEND_METRICS=false npx --yes wrangler@4.45.0 dev --local --ip 127.0.0.1 --port 8787
# 3. 別の端末で、一周（発行 → 書類 → 送信 → 2回目を断る → 受け取り → 消す）を流す
cd hearing && node --disable-warning=ExperimentalWarning scripts/relay-smoke.ts http://127.0.0.1:8787
```

- `wrangler` は依存に入れていない（大きいため。CI では流さない）。`npx` で版を決めて流す。
- FP のアプリを手元の受け付けに向けるには、開発用のビルドで `FINANCIA_DEV_HEARING_RELAY=http://127.0.0.1:8787/api/hearing/v1` を付けて起こす（お客さまのページは `http://127.0.0.1:8787/h/`）。
- 開発用のサーバー（`app/` の `vite`）だけで試すときは、受け付けの処理を同じ所の `/api/hearing/v1` でメモリの置き場で動かす（`FINANCIA_DEV_HEARING_RELAY=http://127.0.0.1:8787` を付けると、手元の wrangler dev に回す）。発行した URL（`http://localhost:<port>/h/#…`）をそのまま開ける。

## 配るファイルの指紋

`npm run build:hearing-form` は `app/dist-hearing-form/h/fingerprints.json` に、配るファイルの SHA-256 を書く（HTML の script・link には完全性の印も付ける）。リリースのときにこの指紋を公開しておけば、配られているページがすり替えられていないかを、誰でも次のように確かめられる。

```sh
curl -s https://<受け付けのホスト>/h/ | shasum -a 256
curl -s https://<受け付けのホスト>/h/fingerprints.json
```

## 本番に出す（利用者の手作業）

順番と中身は、利用者への報告と 0125 の「影響」「未確定」を正とする。ここには設定の置き場だけを書く。

- `wrangler.toml` の `name`・`bucket_name`・`namespace_id`・`routes` を置き換える。
- R2 のバケットに期限の決まり（31日で消す）を足す。
- `config/distribution.toml` の `[hearing_web]` の `relay`・`page` が、置いた場所と同じかを確かめる（アプリは build.rs がここから写す）。
