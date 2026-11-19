// 0117 の5: CI でアプリをビルドする（.github/workflows/app-bundle.yml から呼ぶ）。
//   node scripts/bundle.ts [--plan] -- <tauri build の引数>
// 秘密の値（CI の secrets）があれば署名・公証・更新のファイルの署名をし、無ければ署名せずに普通にビルドする。
// 署名の名前（秘密でないもの）は config/distribution.toml の [signing] から読む。--plan は段取りを出すだけでビルドしない。
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parse } from "smol-toml";
import { APP_DIR, REPO_DIR } from "./lib.ts";
import { signingPlan, signingProblems, type Os, type Signing } from "./signing.ts";

/** Windows の署名の道具の版（2026-11-18 に署名が通った版） */
const ARTIFACT_SIGNING_CLI_VERSION = "0.12.0";

const args = process.argv.slice(2);
const planOnly = args.includes("--plan");
const sep = args.indexOf("--");
const tauriArgs = sep >= 0 ? args.slice(sep + 1) : [];

const dist = parse(readFileSync(join(REPO_DIR, "config", "distribution.toml"), "utf8")) as unknown as { product_name: { en: string }; signing?: Signing };
const problems = signingProblems(dist.signing);
if (problems.length > 0 || dist.signing === undefined) {
  for (const p of problems) console.error(p);
  process.exit(1);
}
const os: Os = process.platform === "darwin" ? "macos" : process.platform === "win32" ? "windows" : "linux";
const plan = signingPlan(os, dist.signing, process.env, dist.product_name.en);
for (const n of plan.notes) console.log(n);
if (planOnly) {
  console.log(JSON.stringify(plan.config, null, 2));
  process.exit(0);
}

const env: Record<string, string | undefined> = { ...process.env };
for (const n of plan.unset) delete env[n];
const work = mkdtempSync(join(tmpdir(), "financia-bundle-"));
if (plan.writeApiKeyFile) {
  // 公証の API キー（.p8 の中身）を一時ファイルに書き、Tauri には場所だけを渡す
  const p8 = join(work, "AuthKey.p8");
  writeFileSync(p8, env.APPLE_API_KEY_P8 ?? "", { mode: 0o600 });
  env.APPLE_API_KEY_PATH = p8;
  delete env.APPLE_API_KEY_P8;
}
if (plan.needsArtifactSigningCli) {
  // Windows の署名の道具（Tauri の説明のとおり cargo で入れる。版は固定する）。CI のキャッシュが「入っている」という記録だけを戻して
  // 本体の .exe を戻さないことがあり、そのときは cargo が入れ直さずに署名で止まるので、動かないときは --force で入れ直す（0117 の追記 2026-11-18）
  const cli = ["install", "artifact-signing-cli", "--version", ARTIFACT_SIGNING_CLI_VERSION, "--locked"];
  const runs = spawnSync("artifact-signing-cli", ["--version"], { stdio: "ignore" }).error === undefined;
  execFileSync("cargo", runs ? cli : [...cli, "--force"], { stdio: "inherit" });
}
const override = join(work, "signing.json");
writeFileSync(override, JSON.stringify(plan.config));
const r = spawnSync("npx", ["tauri", "build", ...tauriArgs, "--config", override], { cwd: APP_DIR, env, stdio: "inherit", shell: process.platform === "win32" });
if (r.status === 0 && plan.writeApiKeyFile) {
  // Tauri が公証してチケットを貼るのは .app だけで、dmg は署名だけになる。署名つきの dmg は Gatekeeper が開く前に公証を確かめるので、
  // 配る入れ物の dmg も公証して貼り、Gatekeeper の判定が通ることまで確かめる（0117 の4）
  for (const dmg of builtDmgs(join(APP_DIR, "src-tauri", "target"))) {
    const key = ["--key", env.APPLE_API_KEY_PATH ?? "", "--key-id", env.APPLE_API_KEY ?? "", "--issuer", env.APPLE_API_ISSUER ?? ""];
    execFileSync("xcrun", ["notarytool", "submit", dmg, ...key, "--wait"], { stdio: "inherit" });
    execFileSync("xcrun", ["stapler", "staple", dmg], { stdio: "inherit" });
    execFileSync("spctl", ["--assess", "-vv", "--type", "open", "--context", "context:primary-signature", dmg], { stdio: "inherit" });
  }
}
process.exit(r.status ?? 1);

/** target/release/bundle/dmg と target/<ターゲット>/release/bundle/dmg にできた dmg */
function builtDmgs(target: string): string[] {
  const dirs = [join(target, "release", "bundle", "dmg"), ...readdirSync(target).map((t) => join(target, t, "release", "bundle", "dmg"))];
  return [...new Set(dirs)].filter((d) => existsSync(d)).flatMap((d) => readdirSync(d).filter((f) => f.endsWith(".dmg")).map((f) => join(d, f)));
}
