// 0017 の2: 配布元の設定（config/distribution.toml）から Tauri の設定を作り、ほかの場所に識別子・配信先が書かれていないことを確かめる
//   npm run gen:distribution    … app/src-tauri/tauri.conf.json の identifier・productName・publisher・ウィンドウの題名を書き換える
//   npm run check:distribution  … 書き換えが要らないこと（CI）と、識別子・配信先のホスト名がこのファイルと tauri.conf.json の外に無いこと
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parse } from "smol-toml";
import { APP_DIR, REPO_DIR } from "./lib.ts";

interface Distribution {
  identifier: string;
  product_name: { ja: string; en: string };
  publisher: string;
  endpoints: { host: string };
  feedback: { form: string };
  keys: Record<string, string[]>;
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
if (before !== after) problems.push("app/src-tauri/tauri.conf.json が config/distribution.toml と食い違っています（npm run gen:distribution）");
// 更新の公開鍵・配信先は、配布・更新の回で distribution.toml から入れる（いまは Tauri の updater を使っていない）
if (conf.plugins !== undefined && "updater" in conf.plugins) problems.push("tauri.conf.json に updater の設定が直接書かれています（distribution.toml から作る）");

// 識別子・配信先のホスト名・要望のフォームのひな形（0087）が、設定の2つのファイルと設計記録（docs/）の外に書かれていないこと
const allowed = new Set(["config/distribution.toml", "app/src-tauri/tauri.conf.json"]);
const files = execFileSync("git", ["ls-files", "-co", "--exclude-standard"], { cwd: REPO_DIR, encoding: "utf8" })
  .split("\n")
  .filter((f) => f !== "" && !allowed.has(f) && !f.startsWith("docs/") && !/\.(png|ico|icns|woff2?|ttf)$/.test(f) && !f.includes("node_modules/"));
// 機能を有効にするコードの公開鍵（0110）も、このファイルの外に直接書かない（差し替えるときに1か所で済むように）
const featureKeys = (dist.keys.feature_code ?? []).map((k) => k.slice(k.indexOf(":") + 1)).filter((k) => k.length >= 40);
for (const needle of [dist.identifier, dist.endpoints.host, dist.feedback.form, ...featureKeys]) {
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
