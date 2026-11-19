# 0228. AI のアプリに、ボタン1つで AI接続口を登録する（0015 の10 の最初の版）

- 状態: 採用（一部未確定）（2026-11-19）
- 固定の強さ: 登録の名前 `fprise-lifeplan`・起動するのは接続口の絶対パスと引数 `mcp`・FP が押したときだけ書く・ほかの設定を消さない・書く前に控えを残す・Claude Desktop の起動中は書かない・Claude Code は `claude mcp add` を呼ぶは 0015 の10 のとおり骨格。命令 `ai_apps_status`・`ai_app_register`・`ai_app_unregister` の形と画面の言葉は内部。Gemini CLI の対応は試験版（実物で試していない）
- 前提にする記録: 0015（AI接続口。10 の AI のアプリの設定の書き込みと、2026-10-08 の Claude Desktop の追記・2026-11-19 の配布物への同梱）、0016 の1（画面にパスを渡さない）

## 背景

- 0015 の10 で「見つかった AI のアプリごとに、書き込む中身を FP に見せ、FP がボタンを押したときだけ書き込む」と決めたが、2026-10-19 の組み込みでは文面を見せて「文面をコピー」で写すだけにした（0015 の追記 2026-10-19 の4）。FP は AI のアプリの設定を手で書く必要があり、Claude Desktop は完全に終了してから `claude_desktop_config.json` を編集しないと消える。
- 2026-11-19 に配布物へ接続口を同梱した（0015 の追記）ので、インストールしたアプリから登録できるようになった。
- 利用者の判断（2026-11-19）: ボタン1つで AI のアプリに登録できるようにする。対象は Claude Desktop・Claude Code・Codex。Gemini CLI も、決まりに合えば足す（利用者が Gemini も使えるか気にしている）。

## 決定

### 1. AI のアプリごとの登録のしかた

| AIのアプリ | 登録のしかた | 状態の見方 |
|---|---|---|
| Claude Desktop | 設定のファイル（Mac `~/Library/Application Support/Claude/claude_desktop_config.json`、Windows `%APPDATA%\Claude\claude_desktop_config.json`）の `mcpServers.fprise-lifeplan` を足す・直す・外す。**Claude Desktop が起動しているあいだは書かない**（Mac は `pgrep -x Claude`、Windows は `claude.exe` の実行ファイルの場所が `AnthropicClaude` かストア版の `Claude_` の下か。Claude Code の `claude.exe` と見分けるため）。起動中なら「終了してから『もう一度確かめる』」と出す | 同じファイルを読む |
| Claude Code | ファイルを直接書かず、`claude mcp add --transport stdio --scope user fprise-lifeplan -- <接続口の絶対パス> mcp` を呼ぶ（すでにあれば `claude mcp remove --scope user` の後に足す。外すのは `claude mcp remove`）。`claude` は PATH と、よく入る場所（`~/.local/bin`・`~/.claude/local`・Homebrew・npm など。GUI のアプリの PATH は短いため）から探す。無ければ押せない | `~/.claude.json` の `mcpServers` を読むだけ |
| Codex | `~/.codex/config.toml`（`CODEX_HOME`）の `[mcp_servers.fprise-lifeplan]` だけを、`toml_edit` で足す・直す・外す（コメント・ほかの行は残る） | 同じファイルを読む |
| Gemini CLI | `~/.gemini/settings.json` の `mcpServers.fprise-lifeplan` を、Claude Desktop と同じ形（`command`・`args`）で足す・直す・外す（Gemini CLI の説明書の user の設定の形） | 同じファイルを読む |

- AI のアプリが見つからない（設定のフォルダもアプリ・コマンドも無い）ときは「このPCに見つかりません」と出し、書かない。Linux の Claude Desktop は「この OS では使えません」。

### 2. Claude Desktop の拡張（MCPB）は今回は作らない

- 拡張（`.mcpb`。zip に `manifest.json` と実行ファイルを入れ、Claude Desktop で開くと入る）なら、起動中に設定のファイルを書いて消える問題は避けられる。ただし次の理由で今回は採らない:
  1. 拡張は中の実行ファイルを Claude Desktop の拡張のフォルダに写して動かす。アプリの更新のたびに写した接続口が古くなり（`VERSION_MISMATCH`）、FP が拡張を入れ直す必要がある（0015 の1 の「版を合わせる」と合わない）。`mcp_config.command` にアプリの中の絶対パスを書く形は、仕様に書かれておらず、試せていない。
  2. 拡張の署名（`mcpb sign`。X.509 の証明書と PKCS#7）は、0015 の10 で「FPRISE, INC. の署名つき」と決めたが、その証明書を用意していない。署名の無い拡張を Claude Desktop がどう見せるかも確かめていない。
  3. 本物の Claude Desktop に入れて確かめることが、この回ではできない（利用者の PC の本物の設定に触れない）。
- 設定のファイルを書く形は、0015 の追記（2026-10-08）の「終了している間に書き込む」をそのまま行う。

### 3. 設定のファイルの書き方

- **ほかの設定は1文字も変えない**: JSON は一番上と `mcpServers` の中を順番どおりに読み、値は元の文のまま写す（キーの並び・字下げ・数の書き方も変わらない）。`fprise-lifeplan` の所だけを足す・直す・外す。TOML は `toml_edit` で、コメント・空行・ほかの表を残す。BOM と Windows の改行（CRLF）も元のとおりにする。
- **登録済みなら場所だけ直す**: すでに `fprise-lifeplan` があれば、`command` と `args`（`["mcp"]`）だけを直し、FP が自分で足した欄（`env` など）は残す。同じ中身なら書かない。
- **読めない形なら書かない**: JSON でない・コメントが入っている（JSON として読めない）・`mcpServers` が表でない・自分の登録が表でない、のときは書かずに止め、画面は「手で設定する」の「文面をコピー」に戻す。
- **書く前に控える**: 元のファイルがあれば、アプリのデータの場所の `ai-app-backups/` に `<AI のアプリ>-<日時>-<ファイル名>` で写してから書く。控えを残せなければ書かない。書くのは同じフォルダの一時ファイルに書いてから置き換える（途中で止まっても元のファイルが半端にならない。元のファイルの権限を写す）。
- **外す**: `fprise-lifeplan` の所だけを外す（`mcpServers` が空になっても `mcpServers` は残す）。外す前も控える。

### 4. 元に戻すボタンは作らない

- 0015 の10 は「元に戻す」と「つなぐ設定を外す」のボタンとしていたが、この回は「登録を外す」だけにする。控えのファイルごと戻すと、登録の後に FP や AI のアプリが書いた設定（ほかのサーバー・Claude Desktop の設定の変更）まで消えるため。控えは残すので、要るときは手で写す（手引きに書いた）。

### 5. 場所が古いとき

- 状態は、事務所の設定の AI の区画を開いたとき・「もう一度確かめる」を押したときに確かめる。登録した `command` が今の接続口の場所と違う（パスの文字列が違い、実体も違う）か、登録した場所に物が無いときは「場所が古い」と出し、「場所を直す」で今の場所に書き直す。自動では書き換えない（0015 の10）。
- 起動のときに帯で知らせることは、この回ではしない（未確定）。
- Mac で dmg から直接開いた・ダウンロードのまま開いた（App Translocation。場所が `/Volumes/` か `AppTranslocation` の下）アプリからは登録しない（閉じると消える場所を登録してしまうため）。「アプリケーション」フォルダに入れてから開き直すよう出す。

### 6. 画面

- 事務所の設定の AI の区画の「AI のアプリに登録する」に、AI のアプリごとに名前・状態（登録済み・未登録・場所が古い・設定のファイルを読めません・このPCに見つかりません・この OS では使えません）・ボタン（登録する・場所を直す・登録を外す）・注意の1文・押せない理由を出す。「書き込む場所と中身」（Claude Code は「呼ぶコマンド」）を開くと、書く場所（ホームを `~` にした表示）と書く中身（接続口の場所を `<AI とつなぐ道具の場所>` に伏せた文面）を見られる。
- 今の「文面をコピー」は「手で設定する」として下に残す（手で書きたい人・書けなかったとき向け）。
- 画面の文に「接続口」と書かない（テストで確かめる）。
- 画面には接続口の本物の場所・設定のファイルの本物の場所を渡さない（0016 の1）。命令が受け取るのは AI のアプリの種類（`client`）だけ。

### 7. 開発用のビルド

- 開発用のビルドは `fprise-lifeplan-dev` という名前で登録する（製品の登録を上書きしない）。作業フォルダの指定（`LIFEPLAN_RUNTIME_DIR`）も入れる。

## 理由

- 0015 の10 の決まり（FP が押したときだけ・ほかを消さない・控え・場所のずれを直す）を守ったまま、手で設定のファイルを書く手間と、Claude Desktop の起動中に書いて消える失敗をなくせる。
- 元の文をそのまま写す書き方なら、ほかのサーバーの設定の並びや書き方が変わらず、FP が自分の設定の変化に驚かない。

## 影響

- `app/src-tauri/src/ai_apps.rs`（新規。状態・書き方・控え・Claude Code の呼び方と、命令3つ）、`app/src-tauri/src/ai.rs`（`connector_path` を crate の中から使えるように）、`build.rs`・`capabilities/main.json`・`lib.rs`（命令を足す）、`Cargo.toml`（`toml_edit` 0.25〔Tauri の依存が既に使っている版〕・`serde_json` の `raw_value`）。
- 画面: `app/src/workspace/ai/AiAppRegister.tsx`（新規）、`AiConnectorPanel.tsx`（見出しを「AI のアプリに登録する」と「手で設定する」にした）、`app/src/engine/host.ts`（`apps`・`registerApp`・`unregisterApp`。開発用のブラウザの本体には無い）。
- 手引き: `docs/ai-connector.md` の0（ボタンで登録する）を先に、2〜4（手で書く）を後にした。

## 試験での確認

- 一時フォルダで（`ai_apps.rs` のテスト）: ほかのサーバー・ほかの欄が元の文のまま残る・控えのファイル・同じ中身なら書かない・登録済みの場所だけ直す（自分で足した `env` は残る）・外すと元と同じ中身に戻る・読めない形（コメント・配列・表でない `mcpServers`）は書かない・新しいファイル・BOM と CRLF・Codex の TOML のコメントが残る・Claude Desktop の起動中は書かない・場所が古いの判定・Mac の一時的な場所・Claude Code は代わりの `claude`（受け取った引数を書くだけ）で、足す・場所を直す（外してから足す）・外すの呼び方。
- 画面（`app/test/ai-apps.test.ts`）: 状態ごとのボタン・押せない理由・Gemini CLI の「まだ試していません」・一時的な場所では押せない・「接続口」と書かない。

## 未確定

- **本物の AI のアプリでの確かめ**: この回は、本物の Claude Desktop・Claude Code・Codex・Gemini CLI の設定に書いて動かすことはしていない（利用者の PC の本物の設定に触れないため）。β公開の前に、テスト用の PC かユーザーで、4つとも登録・場所を直す・外すを確かめる。特に Gemini CLI は提供元の環境に無く、画面と手引きに「まだ試していません」と書いた。
- **Windows**: Claude Desktop の起動中の判定（PowerShell で実行ファイルの場所を見る）と、ストア版（MSIX）の設定のファイルの場所（0015 の未確定）は試していない。ストア版は、今は `%APPDATA%\Claude\` だけを見る。
- **Claude Code の `claude` が見つからない PC**: 手で設定する文面に戻すだけ。`~/.claude.json` を直接書く道は作らない（Claude Code が起動中に同じファイルを書き直すため）。
- **起動のときの知らせ**: 場所が古い登録を、起動のときに帯で知らせるか（5）。
- **拡張（MCPB）**: 2 の理由が解けたら（アプリの中の絶対パスを指す形が使える・証明書を用意する）、Claude Desktop には拡張を勧めるか。
