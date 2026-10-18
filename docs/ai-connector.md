# AI接続口（`lifeplan mcp`）のつなぎ方

ファイナンシアの AI接続口は、FPのPCの中だけで動く MCP サーバーです（設計記録 [0015](decisions/0015-ai-connector-mcp.md)）。
AIのアプリ（Claude Code・Claude Desktop・Codex）が `lifeplan mcp` を起動し、**標準入出力だけ**で話します。ネットワークの口は開けません。

> いまは開発中の版です。アプリ本体への組み込み（「AIとつなぐ」画面・「この世帯をAIに渡す」画面）はまだなので、
> 下の設定は手で書きます。製品では、アプリの「AIとつなぐ」画面が同じ中身を見せてからボタンで書き込みます（0015 の10）。

## 1. 作る

```sh
cd engine && npm ci && npm run build && cd ..   # 計算エンジンと制度データ（engine/dist）
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
| 単体で使える | `list_sample_households`（架空の見本の世帯の一覧）・`get_sample_household`（見本の世帯の計算の入力）・`calculate`（見本の世帯・渡された世帯・AIが組み立てた入力に、案や想定の変更を当てて計算）・`get_regulation_value`（制度の値を値・適用期間・出典つきで） | いつでも（アプリが起動していなくてよい） |
| 世帯を扱う | `list_shared_households`・`get_shared_household`・`propose_scenario`（案を承認待ちで出す）、`calculate` の `share_id` | アプリが起動していて、FPが「この世帯をAIに渡す」で渡した世帯が期限内で取り消されていないときだけ |

道具の名前と入出力は試験版です（予告して変えることがあります。0001・0015）。

試しに、AIに次のように頼みます。

- 「fprise-lifeplan の見本の世帯の一覧を見せて」
- 「salariedCoupleTwoKids で、物価上昇率を 1% にしたら老後の金融資産はどう変わる？」
- 「所得税の基礎控除の今の額と出典は？」

## 6. 世帯を渡すと何が起きるか

- 世帯の復号・許可の判定・縮約・文章の包み方・記録は、**アプリ本体だけ**が行います（`crates/ai-share`）。接続口は鍵も世帯ファイルも扱いません。
- 渡るのは既定で**縮約版**（計算に要る入力項目だけ。許可リストは `crates/ai-share/data/reduced-allowlist.json`）。自由記述・FPのメモ・見出しは既定で外れ、FPが項目ごとに足したときだけ `client_text` に包んで渡ります。世帯の内部ID・顧客番号・呼び名は、どの版でも渡りません。物の ID は共有ごとの仮の ID に置き換わります。
- 共有は期限つき（既定60分・最長8時間）で、取り消し・同意の撤回・アプリの終了で止まります。止まるのは今後の読み取りだけで、すでに送った内容はAIの会社の側に残ります。
- 読まれるたびに、世帯の「AIに渡した記録」（0014）に、日時・道具・渡した項目・中身の指紋・観測できた呼び出し元（接続口と親のプロセスの実行ファイル、AIのアプリの名乗り。どれも認証ではない）が残ります。
- `propose_scenario` の案は「外から来た案」に承認待ちで入るだけで、世帯のデータは変わりません。

同じ OS ユーザーで動く悪いプログラムは、FPが今渡している世帯の縮約版を読めてしまいます（防げない範囲。0015 の9）。

## 7. 開発者向け: アプリ本体への組み込み（次の回）

アプリ本体（`app/src-tauri`）には、次の形で組み込みます（今回は組み込んでいません）。

1. 依存に `ai-share = { path = "../../crates/ai-share" }` を足す。
2. 起動時（`setup`）に `ShareRegistry` を1つ作り、tauri のランタイムの中で `AppEndpoint::start(registry.clone(), <アプリの版>, &ai_ipc::runtime_dir())` を呼ぶ。終了時に `shutdown()`（すべての共有を「アプリの終了」で閉じ、`app.json` を消す）。
3. 「この世帯をAIに渡す」画面から `registry.grant(SharedHouseholdSource { … }, GrantOptions { … })`。同意が無ければ `GrantError::ConsentMissing` が返るので、警告を見せ、FPが続けるなら `proceed_without_consent: true` で呼び直す。渡す項目の一覧は `Granted::fields`（縮約版の全項目は `reduce::reduced_items()`）。
4. 共有中の帯は `registry.active_shares()`、取り消しは `revoke`、同意の撤回は `withdraw_consent`、世帯を直したら `update_source`。
5. 世帯を開いたら `load_records(世帯ID, aiShares)`、保存の前に `records(世帯ID)` を `verify_append_only(前の記録, 新しい記録)` で確かめて `aiShares` に書く。
6. 届いた案は `take_proposals()` で受け取り、「外から来た案」（0008）に入れる（AIが書いた題名・説明は信用しない文章として表示する。0016）。
7. 接続口の版（`lifeplan --version`）とアプリの版をそろえる（違うと `VERSION_MISMATCH`）。

テスト（`cargo test --release -p lifeplan -p ai-share -p ai-ipc`）は、この流れをテストの中の受け口とモデル世帯で確かめています。
作業フォルダは環境変数 `LIFEPLAN_RUNTIME_DIR` で差し替えられます（開発とテストのためだけ）。既定は Mac `~/Library/Application Support/com.fprise.lifeplan/run/`、Windows `%LOCALAPPDATA%\com.fprise.lifeplan\run\`（識別子は `config/distribution.toml` から）。
