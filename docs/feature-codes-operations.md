# 機能を有効にするコードの鍵・発行・取り下げの手順（提供元が手で行う）

機能を有効にするコード（設計記録 0110）の、本番の鍵を作る・控える・公開鍵を渡す・コードを発行する・止める（取り下げる）手順。
鍵の体系・保管・入れ替え・失くしたときの決まりは、配布の鍵（設計記録 0117 の2）と同じ。コードを止めるだけの手軽な鍵と、その一覧の決まりは 0117 の追記（2026-11-04 の2）。発行と取り下げの自動化は β の後に決める。

- 道具はリポジトリの中で動かす: `cargo run -p feature-code --bin feature-code -- <命令>`（以下 `feature-code`）、`cargo run -p distribution --bin dist-keys -- <命令>`（以下 `dist-keys`）。
- **秘密鍵・発行の記録・下書きはリポジトリに入れない。** 既定の置き場所はホームの `~/.lifeplan-issuer/`（環境変数 `LIFEPLAN_ISSUER_DIR` で変えられる）。道具は git の作業フォルダの中の場所を断る。
- 鍵の名前は「役割の略・作った年・通し文字」（例: コードの発行の鍵 `fc-2026a`・`fc-2026b`、コードを止めるだけの鍵 `fr-2026a`・`fr-2026b`、取り下げ用の鍵 `rv-2026a`・`rv-2026b`）。`dev-` で始まる名前は開発用の鍵で、製品のビルドでは受け付けない。

## 0. 提供元が手で行う作業の一覧

| いつ | すること | 節 |
|---|---|---|
| 公開の前に1回 | コードの発行の鍵（現用・次期）を作る | 1 の2 |
| 公開の前に1回 | **コードを止めるだけの鍵（現用・次期）を作る。現用を GitHub の環境の秘密の値に置く**（2026-11-04 の2 で増えた） | 1 の3・1 の4 |
| 公開の前に1回 | 取り下げ用の鍵（現用・次期）を作る（配布の鍵の作業と同じ日） | 1 の5 |
| 公開の前に1回 | 秘密鍵を暗号化した USB 2本に控える。公開鍵の PR を作る | 1 の6・1 の7 |
| 公開の前に1回 | 最初の2つの一覧を作って配信元に置く（配信元が決まってから） | 1 の8 |
| FP に渡すたび | コードを発行する | 2 |
| 返金などで止めるたび | **GitHub の Actions で「feature-code-revocations」を押す**（オフラインの鍵は出さない） | 3 |
| 90日ごと（期限の前） | 2つの一覧を出し直す（コードを止めるだけの一覧は Actions、取り下げの一覧はオフラインの鍵） | 4 |
| 漏れた・失くしたとき | 5 の表 | 5 |

## 1. 公開の前に1回（配布の鍵を作る日に一緒に行う）

0117 の2 の「入れ替え（ふだん）」の1（4種類とも現用と次期の2本を作る）と同じ日に、コードの発行の鍵2本と、コードを止めるだけの鍵2本も作る。

1. 置き場所を用意する: 暗号化した USB メモリ2本（別の場所に保管する）と、発行に使う PC の暗号化したディスク。
2. コードの発行の鍵（現用・次期）を作る。発行に使う PC で:
   ```sh
   feature-code keygen --kid fc-2026a --key ~/.lifeplan-issuer/fc-2026a.key
   feature-code keygen --kid fc-2026b --key ~/.lifeplan-issuer/fc-2026b.key
   ```
   それぞれ「鍵の名前:公開鍵」の1行が出る（公開鍵は秘密ではない）。ふだん発行に使うのは現用（`fc-2026a`）。既定の `~/.lifeplan-issuer/signing.key` を使うなら、現用をその名前で作ってもよい。
3. **コードを止めるだけの鍵（現用・次期）を作る**。発行に使う PC で:
   ```sh
   dist-keys keygen feature_code_revocation fr-2026a ~/.lifeplan-issuer/fr-2026a.key
   dist-keys keygen feature_code_revocation fr-2026b ~/.lifeplan-issuer/fr-2026b.key
   ```
   この鍵で署名できるのは、コードを止めるだけの一覧だけ（鍵・アプリの版・データパックの取り下げや、ほかの鍵の取り外しはできない）。オンラインに置いてよい。
4. **現用（`fr-2026a`）を GitHub の環境の秘密の値に置く**（リポジトリの Settings → Environments）:
   - 環境の名前: `feature-code-revocation`
   - Deployment branches: 既定のブランチ（`main`）だけ
   - 必須の承認（Required reviewers）: 付けない（押す人＝提供元が、その場で止められるように。付けるなら提供元自身を1人）
   - 秘密の値（Environment secrets）: `FEATURE_CODE_REVOCATION_KEY` に、`~/.lifeplan-issuer/fr-2026a.key` の中身をそのまま（4行）貼る
   - 次期（`fr-2026b`）は CI に入れない（入れ替えるまで USB だけ。0117 の2 の「各次期は CI に入れない」）
5. 取り下げ用の鍵（現用・次期）は、配布の鍵の作業（0117 の2）で USB の上に作る（ネットにつないだ PC に置かない）:
   ```sh
   dist-keys keygen revocation rv-2026a /Volumes/<USB>/rv-2026a.key
   dist-keys keygen revocation rv-2026b /Volumes/<USB>/rv-2026b.key
   ```
6. 控える: コードの発行の鍵2本・コードを止めるだけの鍵2本・取り下げ用の鍵2本の秘密鍵のファイルを、暗号化した USB 2本に写す。発行に使う PC から次期（`fc-2026b`・`fr-2026b`）を消してもよい（入れ替えるときに USB から戻す）。USB とディスクの暗号化のパスワードは、紙とパスワード管理に控える（0117 の2。秘密鍵のファイルそのものは暗号化されていないので、暗号化した場所にだけ置く）。
7. 公開鍵を渡す: 出た行を `config/distribution.toml` の `[keys]` に書く PR を作る（コードの発行の鍵は `feature_code`、コードを止めるだけの鍵は `feature_code_revocation`、取り下げ用の鍵は `revocation`。それぞれ現用・次期の2行）。`app/` で `npm run check:distribution` を流して通ることを確かめる（`dev-` の名前・同じ鍵の使い回し・3本以上は止まる）。
8. 最初の2つの一覧を作り、配信元に置く（配信元が決まってから。0117 の未確定）:
   ```sh
   # 取り下げの一覧（取り下げ用の鍵。オフライン）
   dist-keys revocations new ~/.lifeplan-issuer/revocations-draft.json
   dist-keys revocations sign /Volumes/<USB>/rv-2026a.key ~/.lifeplan-issuer/revocations-draft.json ./revocations.json
   ```
   出た `revocations.json` を配信元の `/v1/revocations/revocations.json` に置く。コードを止めるだけの一覧は、GitHub の Actions の「feature-code-revocations」を **first に印を付けて**（番号は空のまま）1回押し、成果物の `feature-codes.json` を配信元の `/v1/revocations/feature-codes.json` に置く。
9. 試しの鍵（開発用の `dev-1`）で発行したコードは、製品のビルドでは使えない。β の FP には、本番の鍵で発行し直したコードを渡す。

## 2. コードを発行する

```sh
feature-code issue --key ~/.lifeplan-issuer/fc-2026a.key --name "<FP の表示名>" --features combinedBs --no-expires
feature-code batch --key ~/.lifeplan-issuer/fc-2026a.key --input 一覧.csv --out 結果.csv
```

- 発行の記録（`~/.lifeplan-issuer/issued.csv`）に1行ずつ足される。番号（`id`）は止めるときに使う。
- 期限つきのコードは `--expires YYYY-MM-DD`。期限なしは `--no-expires`（止めるときは 3）。

## 3. 止める（返金した人のコード・漏れたコード）

ふだんは、コードを止めるだけの一覧（`/v1/revocations/feature-codes.json`）を **GitHub の Actions で** 出し直す。オフラインの取り下げ用の鍵は出さない。

1. GitHub のリポジトリの Actions → 「feature-code-revocations」→ Run workflow。
   - `add` に止める番号（空白で区切る。例 `0007 0012`）、止めるのをやめる（返金の取り消し・番号の打ち間違い）ときは `remove` に番号。`first` は印を付けない（最初の1回だけ）。
   - 環境 `feature-code-revocation` の秘密の値で署名する。中では、配信元の今の一覧を取り、配布元の設定の鍵で確かめてから番号を足す・外し、通し番号を1つ上げて署名する（有効期限は90日後）。
2. 終わったら成果物 `feature-codes` の `feature-codes.json` をダウンロードし、配信元の `/v1/revocations/feature-codes.json` に置き換える（配信元へ自動で置く段は、配信元が決まってから足す）。
3. アプリは次に確かめたとき（起動したとき・動いている間は1日1回）から止める（最長およそ1日）。データは消えない。外した番号は、次に確かめたときに自動で戻る。

- **戻せるのは、この一覧で止めた番号だけ。** 取り下げの一覧（取り下げ用の鍵）の `revoked.featureCodes` に載せた番号は、この一覧から外しても止まったまま（戻すには取り下げの一覧を出し直す）。ふだんは取り下げの一覧に番号を載せない（5 の「コードを止めるだけの鍵が漏れた」ときだけ写す）。
- `first` を誤って付けると通し番号が1から始まり、アプリは「古い一覧」として受け付けない（止まらないだけで、壊れはしない）。そのときは印を付けずに押し直す。
- 手元で行うとき（GitHub が使えないなど）は、配信元の一覧から下書きを作ってから直す（手元に残っている古い下書きは使わない。通し番号が戻ると、アプリは受け付けない）:
  ```sh
  feature-code revocations open ./feature-codes.json          # 配信元から取ってきた今の一覧（配布元の設定の鍵で確かめる）
  feature-code revocations add 0007                             # 止める（remove で外す。発行の記録に無い番号は知らせる）
  dist-keys revocations sign ~/.lifeplan-issuer/fr-2026a.key ~/.lifeplan-issuer/feature-code-revocations-draft.json ./feature-codes.json
  ```
  終わったら下書き（`~/.lifeplan-issuer/feature-code-revocations-draft.json`）はゴミ箱に移す（次も配信元の一覧から作る）。
- `feature-code revocations show` で下書きの止める番号、`dist-keys revocations show <下書き>` で下書きの全体（通し番号・有効期限・載っている数）を見られる。

## 4. 定期の作業

- **2つの一覧は、有効期限（署名から90日）の前に出し直す**（中身が同じでも）。期限の切れた一覧も、載っている取り下げはアプリが当て続けるが、新しい取り下げが届いているかの目安になる（0117 の3 (3)）。
  - コードを止めるだけの一覧: Actions の「feature-code-revocations」を、番号を空のまま押し、3 の2 のとおり置き直す。
  - 取り下げの一覧: 取り下げ用の鍵の USB をつなぎ、`dist-keys revocations sign /Volumes/<USB>/rv-2026a.key ~/.lifeplan-issuer/revocations-draft.json ./revocations.json` で出し直して `/v1/revocations/revocations.json` に置く（下書きは消したり作り直したりしない。通し番号が戻ると、アプリは古い一覧として受け付けない）。

## 5. 漏れた・失くしたとき

| 起きたこと | すること |
|---|---|
| コードの発行の鍵の現用が漏れた | 取り下げの一覧の下書きの `revoked.keys` にその鍵の名前（例: `fc-2026a`）を手で足し、4 の取り下げの一覧と同じ段取りで出す（`dist-keys revocations show` で形を確かめる）。その鍵のコードはアプリで「確かめられないコード」になる（データは消えない）。次期（`fc-2026b`）で発行し直したコードを FP に渡し、次の版のアプリで `[keys] feature_code` を「元の次期を現用に、新しい次期を足す」に直す |
| コードの発行の鍵の現用を失くした（漏れていない） | 次期で発行を始める。次の版で新しい次期を足す（前に出したコードはそのまま使える） |
| コードの発行の鍵を2本とも失くした | 新しい鍵を作ってアプリ本体の更新で入れるまで、新しいコードを発行できない（前に出したコードは使える）。これを避けるため、USB の控えを2か所に持つ |
| **コードを止めるだけの鍵の現用が漏れた**（CI の秘密の値が漏れたなど） | 漏れた鍵でできるのは、コードを止める・この一覧で止めたのを戻すことだけ（新しいコードは出せない。鍵・版・パックは止められない）。1. 今の一覧で止めている番号を、取り下げの一覧の下書きに写す（`feature-code revocations add --draft ~/.lifeplan-issuer/revocations-draft.json <番号>…`）。2. 同じ下書きの `revoked.keys` に `fr-2026a` を手で足す。3. 取り下げ用の鍵で署名して置く（4 と同じ段取り）。アプリはその鍵を束から外し、その鍵で署名した一覧（偽の一覧も）を使わなくなる。写した番号は取り下げの一覧で止まり続ける。4. GitHub の秘密の値 `FEATURE_CODE_REVOCATION_KEY` を次期（`fr-2026b`。USB から）に替え、Actions を **first に印を付けて** 1回押して置き直す（新しい鍵の一覧は空から始めてよい。通し番号も1からでよい）。5. 次の版のアプリで `[keys] feature_code_revocation` を「元の次期を現用に、新しい次期を足す」に直す |
| コードを止めるだけの鍵の現用を失くした（漏れていない） | 秘密の値を次期に替え、Actions を first に印を付けずに押す（配信元の今の一覧は、配布元の設定の鍵で確かめられるので続きから出せる）。次の版で新しい次期を足す |
| コードを止めるだけの鍵を2本とも失くした | 新しい鍵を入れたアプリ本体の更新を配るまで、止めるのは取り下げの一覧（取り下げ用の鍵）で行う（`feature-code revocations add --draft ~/.lifeplan-issuer/revocations-draft.json <番号>`）。今の一覧で止めていた番号も写しておく |
| 取り下げ用の鍵 | 0117 の2 の表のとおり（1本が漏れたらもう1本で出し続け、アプリ本体の更新で入れ替える） |
