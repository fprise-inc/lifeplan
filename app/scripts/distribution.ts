// 0017 の2: 配布元の設定（config/distribution.toml）から Tauri の設定を作り、ほかの場所に識別子・配信先が書かれていないことを確かめる
//   npm run gen:distribution    … app/src-tauri/tauri.conf.json の identifier・productName・publisher・ウィンドウの題名を書き換える
//   npm run check:distribution  … 書き換えが要らないこと（CI）と、識別子・配信先のホスト名がこのファイルと tauri.conf.json の外に無いこと、
//                                  配信先の欄が外部送信の一覧（docs/decisions/0012 の5）に載っていること
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parse } from "smol-toml";
import { APP_DIR, REPO_DIR } from "./lib.ts";
import { KEY_ROLES, keyProblems, signingProblems, type Signing } from "./signing.ts";

interface Distribution {
  identifier: string;
  product_name: { ja: string; en: string };
  publisher: string;
  endpoints: { host: string; feature_code_revocations?: string } & Record<string, string>;
  feedback: { form: string };
  keys: Record<string, string[]>;
  signing?: Signing;
}

const distPath = join(REPO_DIR, "config", "distribution.toml");
const confPath = join(APP_DIR, "src-tauri", "tauri.conf.json");
const dist = parse(readFileSync(distPath, "utf8")) as unknown as Distribution;
const check = process.argv.includes("--check");

type Conf = {
  identifier: string;
  productName: string;
  bundle: { publisher: string; copyright: string };
  app: { windows: { label: string; title: string }[] };
  plugins?: Record<string, unknown>;
};
const before = readFileSync(confPath, "utf8");
const conf = JSON.parse(before) as Conf;
conf.identifier = dist.identifier;
conf.productName = dist.product_name.en;
conf.bundle.publisher = dist.publisher;
conf.bundle.copyright = dist.publisher;
for (const w of conf.app.windows) w.title = dist.product_name.ja;
const after = JSON.stringify(conf, null, 2) + "\n";

const problems: string[] = [];
// 0117: 4種類の鍵（現用＋次期の2本まで・書き方・役割をまたいだ重なり）と、OS のコード署名の名前（[signing]）の形
problems.push(...keyProblems(dist.keys), ...signingProblems(dist.signing));
if (before !== after) problems.push("app/src-tauri/tauri.conf.json が config/distribution.toml と食い違っています（npm run gen:distribution）");
// 更新の公開鍵・配信先は、配布・更新の回で distribution.toml から入れる（いまは Tauri の updater を使っていない）
if (conf.plugins !== undefined && "updater" in conf.plugins) problems.push("tauri.conf.json に updater の設定が直接書かれています（distribution.toml から作る）");

// 識別子・配信先のホスト名・要望のフォームのひな形（0087）が、設定の2つのファイルと設計記録（docs/）の外に書かれていないこと
const allowed = new Set(["config/distribution.toml", "app/src-tauri/tauri.conf.json"]);
const files = execFileSync("git", ["ls-files", "-co", "--exclude-standard"], { cwd: REPO_DIR, encoding: "utf8" })
  .split("\n")
  .filter((f) => f !== "" && !allowed.has(f) && !f.startsWith("docs/") && !/\.(png|ico|icns|woff2?|ttf)$/.test(f) && !f.includes("node_modules/"));
// 機能を有効にするコードの公開鍵（0110）と、その止めた一覧の公開鍵（0110 の追記。コードの鍵とは別）も、このファイルの外に直接書かない（差し替えるときに1か所で済むように）
const featureKeys = [...(dist.keys.feature_code ?? []), ...(dist.keys.feature_code_revocation ?? [])].map((k) => k.slice(k.indexOf(":") + 1)).filter((k) => k.length >= 40);
// 4種類の鍵（0017 の5・0117）も同じ（Tauri の公開鍵の文字列はそのまま、ほかは公開鍵の部分）
const roleKeys = KEY_ROLES.flatMap((r) => dist.keys[r] ?? []).map((k) => (k.includes(":") ? k.slice(k.indexOf(":") + 1) : k)).filter((k) => k.length >= 40);
// 止めた一覧の場所は、自動通信の相手（host）の https だけ。クエリは付けない（0017 の4・0110 の追記）
const revUrl = dist.endpoints.feature_code_revocations;
if (revUrl === undefined) problems.push("config/distribution.toml に [endpoints] の feature_code_revocations がありません（0110 の追記）");
else if (!revUrl.startsWith(`https://${dist.endpoints.host}/`) || /[?#@\\ ]/.test(revUrl)) problems.push(`config/distribution.toml の feature_code_revocations（${revUrl}）は https://${dist.endpoints.host}/… の形にする`);
const revKeys = new Set(dist.keys.feature_code_revocation ?? []);
if ((dist.keys.feature_code ?? []).some((k) => revKeys.has(k))) problems.push("config/distribution.toml: 止めた一覧の鍵（feature_code_revocation）は、コードの鍵（feature_code）と別の鍵にする");
for (const needle of [dist.identifier, dist.endpoints.host, dist.feedback.form, ...featureKeys, ...roleKeys]) {
  for (const f of files) {
    let text: string;
    try {
      text = readFileSync(join(REPO_DIR, f), "utf8");
    } catch {
      continue;
    }
    if (text.includes(needle)) problems.push(`${f} に ${needle} が直接書かれています（config/distribution.toml だけに書く。0017 の2）`);
  }
}

// 外部送信の一覧（0012 の5）と実装を突き合わせる: [endpoints] の欄（host のほか）は、どれも一覧の表のどこかの行の「相手」に `欄の名前` で載っていること。
// 本体（build.rs）が読む欄は、状態が「入れた」の行に載っていること（アプリが自動で通信するのは「入れた」の行だけ）
const sendList = (() => {
  const doc = readFileSync(join(REPO_DIR, "docs", "decisions", "0012-identifiers-and-data-not-held.md"), "utf8");
  const start = doc.indexOf("### 5. 外部送信の一覧");
  if (start < 0) return null;
  const end = doc.indexOf("\n## ", start);
  const rows = doc
    .slice(start, end < 0 ? undefined : end)
    .split("\n")
    .filter((l) => l.startsWith("| ") && !l.startsWith("| 送るもの") && !l.startsWith("|---"))
    .map((l) => l.split("|").map((c) => c.trim()))
    .map((c) => ({ keys: [...(c[2] ?? "").matchAll(/`([a-z_]+)`/g)].map((m) => m[1] as string), done: c[c.length - 2] === "入れた" }));
  return rows;
})();
if (sendList === null) problems.push("docs/decisions/0012-identifiers-and-data-not-held.md に「### 5. 外部送信の一覧」がありません");
else {
  const buildRs = readFileSync(join(APP_DIR, "src-tauri", "build.rs"), "utf8");
  for (const key of Object.keys(dist.endpoints).filter((k) => k !== "host")) {
    const rows = sendList.filter((r) => r.keys.includes(key));
    if (rows.length === 0) problems.push(`config/distribution.toml の [endpoints] の ${key} が、外部送信の一覧（docs/decisions/0012 の5）に載っていません（相手の欄に \`${key}\` で書く）`);
    else if (buildRs.includes(`"${key}"`) && !rows.some((r) => r.done)) problems.push(`本体（app/src-tauri/build.rs）が [endpoints] の ${key} を読んでいますが、外部送信の一覧（docs/decisions/0012 の5）の行の状態が「入れた」ではありません`);
  }
}

if (check) {
  if (problems.length > 0) {
    for (const p of problems) console.error(p);
    process.exit(1);
  }
  console.log(`配布元の設定: OK（${dist.identifier}）`);
} else {
  if (before !== after) writeFileSync(confPath, after);
  for (const p of problems.filter((x) => !x.startsWith("app/src-tauri/tauri.conf.json"))) console.error(p);
  console.log("app/src-tauri/tauri.conf.json を config/distribution.toml から作りました");
}
