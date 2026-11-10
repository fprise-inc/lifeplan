# AI接続口（`lifeplan mcp`）のつなぎ方

ファイナンシアの AI接続口は、FPのPCの中だけで動く MCP サーバーです（設計記録 [0015](decisions/0015-ai-connector-mcp.md)）。
AIのアプリ（Claude Code・Claude Desktop・Codex）が `lifeplan mcp` を起動し、**標準入出力だけ**で話します。ネットワークの口は開けません。

> アプリの画面では、世帯の一覧の「AI接続口」（事務所全体の設定。既定はオフ）で使うかどうかを決め、接続の設定の文面を見られます
> （接続口の場所は画面では伏せ、「文面をコピー」で本物の場所の入った文面をクリップボードに写します）。アプリが AI のアプリの設定を
> 書き換えることはまだしないので、下の設定は手で書きます（「AIとつなぐ」の書き込みは 0015 の10。後の回）。

## 1. 作る

```sh
cd engine && npm ci && npm run build && cd ..   # 計算エンジンと制度データ・対応範囲の一覧（engine/dist）
cd app && npm ci && npm run build:explain && cd ..   # 数字の根拠の読み方（crates/lifeplan/dist/explain.js。0183）
cargo build --release -p lifeplan               # → target/release/lifeplan（Windows は lifeplan.exe）
target/release/lifeplan --version
```

以下の `<接続口の絶対パス>` は、`target/release/lifeplan` の絶対パス（例: `/Users/you/Projects/fprise-lifeplan/target/release/lifeplan`）に置き換えます。
設定の名前は **`fprise-lifeplan`**、引数は **`mcp`** の1つだけです（0015 の10）。

## 2. Claude Code

```sh
claude mcp add --transport stdio --scope user fprise-lifeplan -- <接続口の絶対パス> mcp
claude mcp list        # fprise-lifeplan が Connected になる
```

外すときは `claude mcp remove --scope user fprise-lifeplan`。

## 3. Claude Desktop

**Claude Desktop を完全に終了してから**（メニューの「終了」。ウィンドウを閉じるだけでは足りません）、設定ファイルを編集します。
Claude Desktop は終了するときに設定ファイルを書き直すので、起動中に書き足すと消えます（0015 の追記）。

- Mac: `~/Library/Application Support/Claude/claude_desktop_config.json`
- Windows: `%APPDATA%\Claude\claude_desktop_config.json`

`mcpServers` に `fprise-lifeplan` だけを足します（ほかのサーバーの設定は消さない）。

```json
{
  "mcpServers": {
    "fprise-lifeplan": {
      "command": "<接続口の絶対パス>",
      "args": ["mcp"]
    }
  }
}
```

保存してから Claude Desktop を起動し、道具の一覧に `fprise-lifeplan` が出ることを確かめます。
ワンクリックで入る拡張（MCPB）は、署名の回で用意します（0015 の10）。

## 4. Codex

`~/.codex/config.toml`（`CODEX_HOME` があればその下）に足します。

```toml
[mcp_servers.fprise-lifeplan]
command = "<接続口の絶対パス>"
args = ["mcp"]
```

## 5. 道具

| 群 | 道具 | 使える条件 |
|---|---|---|
| 単体で使える | `list_sample_households`（架空の見本の世帯の一覧）・`get_sample_household`（見本の世帯の計算の入力）・`calculate`（見本の世帯・渡された世帯・AIが組み立てた入力に、プランや想定の変更を当てて計算）・`explain_value`（キャッシュフロー表の1つの数字の根拠。画面の「数字の根拠」と同じ中身に制度の値ID を添える）・`get_regulation_value`（制度の値を値・適用期間・出典つきで）・`search_coverage`・`get_coverage`（何をどう計算しているか〔入っている・近似している・まだ入っていない〕を、同梱した対応範囲の一覧〔`docs/coverage/`〕から探す。0183） | いつでも（アプリが起動していなくてよい） |
| 世帯を扱う | `list_shared_households`・`get_shared_household`・`propose_scenario`（プランの候補を承認待ちで出す）・`propose_inputs`（保険の書類から読んだ値を、現状の入力の候補として承認待ちで出す）、`calculate`・`explain_value` の `share_id` | アプリが起動していて、FPが「この世帯をAIに渡す」で渡した世帯が期限内で取り消されていないときだけ |
| 設定の候補を出す | `propose_feature_code`（FPが渡した「機能を有効にするコード」を、アプリの画面に承認待ちの候補として出す。コードは入らない） | アプリが起動していて、AI接続口がオンのときだけ（世帯を渡していなくてよい） |

道具の名前と入出力は試験版です（予告して変えることがあります。0001・0015）。

試しに、AIに次のように頼みます。

- 「fprise-lifeplan の見本の世帯の一覧を見せて」
- 「salariedCoupleTwoKids で、物価上昇率を 1% にしたら老後の金融資産はどう変わる？」
- 「所得税の基礎控除の今の額と出典は？」
- 「salariedCoupleTwoKids の2030年の税・社会保険料は、どんな計算で出ている？」（`explain_value`）
- 「ファイナンシアに高額療養費は入っている？ iDeCo の受け取り方はどう計算している？」（`search_coverage`・`get_coverage`）

### 計算の前の処理（画面と同じ。0184）

`calculate`・`explain_value` は、アプリの画面と同じく、計算の前に次を当ててから計算します（画面の関数 `app/src/engine/moneyRows.ts` の `forEngine` を接続口に同梱して動かすので、画面と同じ数字になります）。

- 計算に入れない物を外す: 見込みが「当てにしない」の受け取る相続・遺贈・贈与と、相続で受け継ぐ借金（「基本の計算に入れる」にした物は残す）。「計算に入れない」を選んだ夢。見本の世帯・渡された世帯・AIが組み立てた入力のどれにも当てます。
- 事務所の推定の値を足す: FPの事務所が既定値の画面で変えた推定の値と、推定で埋めない目安。渡された世帯（`share_id`）のときだけ、アプリ本体が計算に使う読み取りに事務所データの値を添えます（`get_shared_household` の答えには入りません。FPが書いた根拠の文はAIに渡りません）。

何かを当てたときは、答えに `preparation`（外した物と、足した事務所の値の値ID）が付きます。当てないのは、画面の結果の見方（「確実な分だけ」・物ごとの入れ外し）と、保存していない変更です（渡されるのは保存した世帯）。そのときは、画面の数字と違うことがあります。

## 6. 世帯を渡すと何が起きるか

- 世帯の復号・許可の判定・縮約・文章の包み方・記録は、**アプリ本体だけ**が行います（`crates/ai-share`）。接続口は鍵も世帯ファイルも扱いません。
- 渡るのは既定で**縮約版**（計算に要る入力項目だけ。許可リストは `crates/ai-share/data/reduced-allowlist.json`）。自由記述・FPのメモ・見出しは既定で外れ、FPが項目ごとに足したときだけ `client_text` に包んで渡ります。世帯の内部ID・顧客番号・呼び名は、どの版でも渡りません。物の ID は共有ごとの仮の ID に置き換わります。
- 共有は期限つき（既定60分・最長8時間）で、取り消し・同意の撤回・アプリの終了で止まります。止まるのは今後の読み取りだけで、すでに送った内容はAIの会社の側に残ります。
- 読まれるたびに、世帯の「AIに渡した記録」（0014）に、日時・道具・渡した項目・中身の指紋・観測できた呼び出し元（接続口と親のプロセスの実行ファイル、AIのアプリの名乗り。どれも認証ではない）が残ります。`calculate`・`explain_value` の読み取りも同じで、計算に使う事務所の推定の値は記録の中身（項目・指紋）に入りません（世帯の中身ではないため。0184）。
- `propose_scenario` のプランの候補は、アプリの「AIからの候補」に承認待ちで入るだけで、世帯のデータは変わりません。FPが中身を確かめて「プランとして保存」したときだけ、プラン（プランA・プランB …）として入ります。
- `propose_inputs` の書類の候補は、入力のホームの「取り込む」の「書類の読み取り」に承認待ちで入るだけです（画面の上に「AI から書類の候補が届きました」の帯が出ます）。FPが確かめの画面で値ごとに承認したものだけが現状に入ります。答えの形は `document-candidates@1`（ウェブのチャット AI の答えを貼り付ける入口と同じ形）で、書類1通につき1回呼びます。読むのは保険証券・ご契約内容のお知らせ・設計書（`docType` が `insurancePolicy`）の、保険の契約の欄の候補だけです（ほかの書類の答えはアプリが読みません。設計記録 0159）。登録簿に無い入力項目・形の違う候補・個人番号などの番号らしい所は、アプリが読まずに落とします。届いた答えはアプリのメモリの中だけに置き、世帯ファイルには、アプリが確かめた候補だけが入ります（設計記録 0151）。書類の候補を受けるのは、お客さまの同意が書類を AI に渡すことを含む世帯（同意の説明の版2〜）だけです。前の版の説明で同意した世帯では `NOT_SHARED` を返します（共有は閉じず、計算の項目は読めます。設計記録 0157）。
- `propose_feature_code` のコードの候補は、世帯の一覧の「事務所の既定値」のいちばん下に承認待ちで出るだけです（画面の上にも帯が出ます）。FPが、有効になる機能・名前・期限と、入れる前と後を確かめて「このコードを入れる」を押したときだけ入ります（設計記録 0110 の5・0015 の追記）。

同じ OS ユーザーで動く悪いプログラムは、FPが今渡している世帯の縮約版を読めてしまいます（防げない範囲。0015 の9）。

## 7. アプリの画面（0014・0015）

1. **事務所全体の設定**（世帯の一覧の下の「AI接続口」）: 使うかどうか（既定はオフ。事務所データに暗号化して保存）。オンのときだけ、アプリ本体が受け口（ソケットと `app.json`）を開けます。オフにすると、共有中の世帯をすべて取り消して口を閉じます。共有中の世帯の一覧と「止める」、接続の設定の文面、防げること・防げないことも、ここに出します。
2. **世帯ごとの同意**（上の帯の世帯の右の「AI: …」）: 外部AIへの提供の同意を記録します（使う AI サービスで学習に使われない設定を確かめたか・渡してよい範囲（縮約版）・同意の取り方・日付・FPの確認）。説明文の指紋と文面は世帯ファイルに残ります。説明文は版2から、書類の読み取りで名前・番号を伏せた書類を AI に渡すことを含みます。前の版の説明で同意した世帯は、計算の項目はそのまま渡せますが、書類を AI に渡す前に「今の説明で同意を記録し直す」で取り直します（設計記録 0157）。同意の取り方に「ヒアリングシートの同意欄」を選ぶと、シートの同意欄の文で記録し、書類を AI に渡すことは含みません（書類を渡す世帯は、今の説明を見せて取り直します）。同意は「外部の AI サービスに渡すことへの同意」1つで、どの AI の会社かは聞きません（前に記録した会社はそのまま残ります。設計記録 0172）。**同意が記録されていない世帯は、AIに渡せません**（接続口からも見えません）。撤回を記録すると、その世帯の共有はすぐに止まります。
3. **世帯を渡す**: 同意のある世帯だけ、使うAIのアプリの名前（申告）と期限（15分〜8時間。既定1時間）を選んで渡します。渡すのは縮約版だけで、FPのメモ・相談内容などの文章は渡しません。共有中は画面の上に帯が出て、そこから取り消せます。
4. **共有の記録**: 世帯ごとに、渡した日時・期限・終わり方・申告した接続先・範囲・読まれた日時と回数・道具・呼び出し元（参考情報。実行ファイルはファイル名だけ）・届いた候補・同意の記録を見られます。記録は追記だけです。
5. **AIからの候補**（結果の画面のプランの帯の下）: `propose_scenario` で届いたプランの候補を、変える項目・今の値・候補の値・AIの理由で確かめ、「プランとして保存」か「捨てる」を選びます。保存したプランの差分は、出どころ「AI」と FP の承認の記録を持ちます。結果の画面のプランで動かせない項目は取り込みません（理由を出します）。AIが書いた題名・説明・理由は文字のまま出し、プランの名前はアプリが作ります。

世帯ファイルの `consents`・`consentExplanations`・`aiShares`・`candidates` はアプリ本体（`crates/ai-share` の `HouseholdBook`）だけが書きます。画面から届いた本文にこれらの区画が入っていても使わず、書く前に追記だけかを確かめます。

## 8. 開発者向け: アプリ本体への組み込み（`app/src-tauri/src/ai.rs`）

- 起動時に `ShareRegistry` を作り、`require_consent(true)`（同意が `given` の世帯だけを渡せる）。事務所の推定の値を読む所（事務所データの `defaults.estimates` を切り出す）を `set_office_estimates` で入れる。接続口の計算に使う読み取り（`getShare` の `forCalc`）の返事にだけ、そのときの値を `officeEstimates` として添える（0184）。受け口（`AppEndpoint`）は事務所の設定がオンのときだけ開け、終了時（`RunEvent::Exit`）に、すべての共有を「アプリの終了」で閉じて記録を書き戻し、口を閉じます。
- 世帯を開く・作るときに帳面（`HouseholdBook::from_opened`）を作り、同じ起動で初めてなら `load_records`（終わりの記録が無い共有は「アプリの終了」で閉じる）。保存は帳面の `compose`（追記だけかを確かめる）を通し、共有中なら `update_source` で渡す中身を置き換えます。
- 2秒ごとの見回りで、期限切れを閉じ、`take_proposals` の候補を帳面に入れ、記録を世帯ファイルへ書き戻します（画面への通知は使わず、画面は3秒ごとに読み直す）。
- 画面から呼べる命令は `ai_status`・`ai_set_enabled`・`ai_setup_copy`・`ai_household`・`ai_consent_record`・`ai_share_start`・`ai_share_stop`・`ai_candidate_decide` だけで、パスも鍵も受け取らない・返しません。
- 開発用のビルドは、作業フォルダを `<アプリのデータの場所>/run-dev/`（`FINANCIA_DEV_RUNTIME_DIR` で差し替え）にし、製品の口とぶつからないようにします。接続の設定の文面には、作業フォルダの指定（`LIFEPLAN_RUNTIME_DIR`）が加わります。
- 接続口の版（`lifeplan --version`）とアプリの版をそろえる（違うと `VERSION_MISMATCH`。事務所の設定の画面にも出す）。接続口の同梱（アプリと同じフォルダに置く）は配布の回で行います。

テスト: `cargo test --release -p lifeplan -p ai-share -p ai-ipc -p household-store`（本物の接続口を起動してアプリの方針の流れを確かめる `app_policy_consent_is_required_end_to_end` を含む）、`app/src-tauri` の `cargo test`、`app` の `npm test`（`test/ai.test.ts`）。
作業フォルダは環境変数 `LIFEPLAN_RUNTIME_DIR` で差し替えられます（開発とテストのためだけ）。既定は Mac `~/Library/Application Support/com.fprise.lifeplan/run/`、Windows `%LOCALAPPDATA%\com.fprise.lifeplan\run\`（識別子は `config/distribution.toml` から）。
