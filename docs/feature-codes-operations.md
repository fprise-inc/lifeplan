# 機能を有効にするコードの鍵・発行・取り下げの手順（提供元が手で行う）

機能を有効にするコード（設計記録 0110）の、本番の鍵を作る・控える・公開鍵を渡す・コードを発行する・止める（取り下げる）手順。
鍵の体系・保管・入れ替え・失くしたときの決まりは、配布の鍵（設計記録 0117 の2）と同じ。発行と取り下げの自動化は β の後に決める。

- 道具はリポジトリの中で動かす: `cargo run -p feature-code --bin feature-code -- <命令>`（以下 `feature-code`）、`cargo run -p distribution --bin dist-keys -- <命令>`（以下 `dist-keys`）。
- **秘密鍵・発行の記録・下書きはリポジトリに入れない。** 既定の置き場所はホームの `~/.lifeplan-issuer/`（環境変数 `LIFEPLAN_ISSUER_DIR` で変えられる）。道具は git の作業フォルダの中の場所を断る。
- 鍵の名前は「役割の略・作った年・通し文字」（例: コードの鍵 `fc-2026a`・`fc-2026b`、取り下げ用の鍵 `rv-2026a`・`rv-2026b`）。`dev-` で始まる名前は開発用の鍵で、製品のビルドでは受け付けない。

## 1. 公開の前に1回（配布の鍵を作る日に一緒に行う）

0117 の2 の「入れ替え（ふだん）」の1（4種類とも現用と次期の2本を作る）と同じ日に、コードの鍵の2本も作る。取り下げ用の鍵は配布の鍵の作業で作る2本をそのまま使う（コードの取り下げも同じ一覧・同じ鍵）。

1. 置き場所を用意する: 暗号化した USB メモリ2本（別の場所に保管する）と、発行に使う PC の暗号化したディスク。
2. コードの鍵（現用・次期）を作る。発行に使う PC で:
   ```sh
   feature-code keygen --kid fc-2026a --key ~/.lifeplan-issuer/fc-2026a.key
   feature-code keygen --kid fc-2026b --key ~/.lifeplan-issuer/fc-2026b.key
   ```
   それぞれ「鍵の名前:公開鍵」の1行が出る（公開鍵は秘密ではない）。ふだん発行に使うのは現用（`fc-2026a`）。既定の `~/.lifeplan-issuer/signing.key` を使うなら、現用をその名前で作ってもよい。
3. 取り下げ用の鍵（現用・次期）は、配布の鍵の作業（0117 の2）で USB の上に作る（ネットにつないだ PC に置かない）:
   ```sh
   dist-keys keygen revocation rv-2026a /Volumes/<USB>/rv-2026a.key
   dist-keys keygen revocation rv-2026b /Volumes/<USB>/rv-2026b.key
   ```
4. 控える: コードの鍵2本と取り下げ用の鍵2本の秘密鍵のファイルを、暗号化した USB 2本に写す。コードの鍵の次期は、発行に使う PC から消してもよい（入れ替えるときに USB から戻す）。USB とディスクの暗号化のパスワードは、紙とパスワード管理に控える（0117 の2。秘密鍵のファイルそのものは暗号化されていないので、暗号化した場所にだけ置く）。
5. 公開鍵を渡す: 出た行を `config/distribution.toml` の `[keys]` に書く PR を作る（コードの鍵は `feature_code`、取り下げ用の鍵は `revocation`。それぞれ現用・次期の2行）。`app/` で `npm run check:distribution` を流して通ることを確かめる（`dev-` の名前・同じ鍵の使い回し・3本以上は止まる）。
6. 最初の取り下げの一覧を作り、配信元に置く（配信元が決まってから。0117 の未確定）:
   ```sh
   dist-keys revocations new ~/.lifeplan-issuer/revocations-draft.json
   dist-keys revocations sign /Volumes/<USB>/rv-2026a.key ~/.lifeplan-issuer/revocations-draft.json ./revocations.json
   ```
   出た `revocations.json` を配信元の `/v1/revocations/revocations.json` に置く。
7. 試しの鍵（開発用の `dev-1`）で発行したコードは、製品のビルドでは使えない。β の FP には、本番の鍵で発行し直したコードを渡す。

## 2. コードを発行する

```sh
feature-code issue --key ~/.lifeplan-issuer/fc-2026a.key --name "<FP の表示名>" --features combinedBs --no-expires
feature-code batch --key ~/.lifeplan-issuer/fc-2026a.key --input 一覧.csv --out 結果.csv
```

- 発行の記録（`~/.lifeplan-issuer/issued.csv`）に1行ずつ足される。番号（`id`）は止めるときに使う。
- 期限つきのコードは `--expires YYYY-MM-DD`。期限なしは `--no-expires`（止めるときは 3）。

## 3. 止める（漏れたコード・返金した人のコード）

1. 下書きに番号を足す（発行の記録に無い番号は知らせる）:
   ```sh
   feature-code revocations add 0007
   ```
2. 取り下げ用の鍵の USB をつなぎ、署名する（通し番号が1つ上がり、有効期限は90日後になる）:
   ```sh
   dist-keys revocations sign /Volumes/<USB>/rv-2026a.key ~/.lifeplan-issuer/revocations-draft.json ./revocations.json
   ```
3. `revocations.json` を配信元の `/v1/revocations/revocations.json` に置き換える。アプリは次に確かめたとき（起動したとき・動いている間は1日1回）から止める（最長およそ1日）。データは消えない。
4. 止めるのをやめるとき（返金の取り消しなど）は `feature-code revocations remove 0007` のあと、2・3 と同じ。アプリは次に確かめたときに自動で戻す。

- `feature-code revocations show` で止める番号、`dist-keys revocations show <下書き>` で一覧の全体（通し番号・有効期限・載っている数）を見られる。
- 下書きは配信元に置いた一覧の中身と同じもの。消したり作り直したりしない（通し番号が戻ると、アプリは古い一覧として受け付けない）。

## 4. 定期の作業

- **取り下げの一覧は、有効期限（署名から90日）の前に出し直す**（中身が同じでも 3 の2・3 を行う）。期限の切れた一覧も、載っている取り下げはアプリが当て続けるが、新しい取り下げが届いているかの目安になる（0117 の3 (3)）。

## 5. 漏れた・失くしたとき

| 起きたこと | すること |
|---|---|
| コードの鍵の現用が漏れた | 下書きの `revoked.keys` にその鍵の名前（例: `fc-2026a`）を手で足し、3 の2・3 で出す（`dist-keys revocations show` で形を確かめる）。その鍵のコードはアプリで「確かめられないコード」になる（データは消えない）。次期（`fc-2026b`）で発行し直したコードを FP に渡し、次の版のアプリで `[keys] feature_code` を「元の次期を現用に、新しい次期を足す」に直す |
| コードの鍵の現用を失くした（漏れていない） | 次期で発行を始める。次の版で新しい次期を足す（前に出したコードはそのまま使える） |
| コードの鍵を2本とも失くした | 新しい鍵を作ってアプリ本体の更新で入れるまで、新しいコードを発行できない（前に出したコードは使える）。これを避けるため、USB の控えを2か所に持つ |
| 取り下げ用の鍵 | 0117 の2 の表のとおり（1本が漏れたらもう1本で出し続け、アプリ本体の更新で入れ替える） |
