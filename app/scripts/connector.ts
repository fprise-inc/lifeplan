// 0015 の追記（2026-11-19）: 配布物に AI接続の本体（crates/lifeplan の `lifeplan`。0015 の1）を同梱する段取り。
// app/scripts/bundle.ts が、tauri build の前に呼ぶ。Tauri の externalBin（サイドカー）で入れるので、Tauri がアプリの実行ファイルと同じフォルダ
// （Mac は Financia.app/Contents/MacOS、Windows はインストール先、Linux の deb は /usr/bin）に置き、アプリと一緒に署名する
// （Mac は中から外の順に署名して .app ごと公証、Windows はインストーラーに入れる前に署名）。アプリ本体の connector_path() はそこを探す。
// - externalBin は bundle.ts の上書きの設定にだけ書く（tauri.conf.json に書くと、開発用の起動〔tauri dev〕と CI のテストのビルドでも
//   tauri-build がサイドカーのファイルを求めて止まるため）
// - サイドカーの名前は Tauri の決まりで `binaries/lifeplan-<ターゲット>`（Windows は .exe）。Mac の universal は、アーキテクチャごとの
//   2つ（アプリの各アーキテクチャのビルドで tauri-build が写す）と、lipo でまとめた `-universal-apple-darwin`（Tauri が .app に入れる）の3つ
import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { APP_DIR, REPO_DIR } from "./lib.ts";

/** Tauri の設定の externalBin に書く名前（src-tauri からの場所。末尾にターゲットが付く） */
export const SIDECAR = "binaries/lifeplan";
export const SIDECAR_DIR = join(APP_DIR, "src-tauri", "binaries");
const UNIVERSAL = "universal-apple-darwin";
const MAC_ARCHS = ["aarch64-apple-darwin", "x86_64-apple-darwin"] as const;

export interface ConnectorPlan {
  /** cargo build --target で作るターゲット */
  build: string[];
  /** lipo でまとめた universal も作るか */
  universal: boolean;
  /** Tauri が配布物に入れるサイドカーのターゲット（版を確かめるのもこれ） */
  bundled: string;
}

/** tauri build の引数（--target）と、この PC の Rust のターゲットから、接続の本体をどのターゲットで作るか */
export function connectorPlan(tauriArgs: string[], hostTriple: string): ConnectorPlan {
  const i = tauriArgs.findIndex((a) => a === "--target" || a === "-t");
  const eq = tauriArgs.find((a) => a.startsWith("--target="));
  const target = i >= 0 ? tauriArgs[i + 1] : eq !== undefined ? eq.slice("--target=".length) : hostTriple;
  if (target === undefined || target === "") throw new Error("tauri build の --target の後にターゲットがありません");
  if (target === UNIVERSAL) return { build: [...MAC_ARCHS], universal: true, bundled: UNIVERSAL };
  return { build: [target], universal: false, bundled: target };
}

/** サイドカーのファイル名（Windows のターゲットは .exe） */
export function sidecarFile(triple: string): string {
  return `lifeplan-${triple}${triple.includes("-windows-") ? ".exe" : ""}`;
}

/** Cargo.toml の [package] の version */
export function cargoVersion(toml: string): string | null {
  const pkg = toml.split(/^\[/m).find((s) => s.startsWith("package]"));
  return pkg?.match(/^version\s*=\s*"([^"]+)"/m)?.[1] ?? null;
}

/** アプリの版（tauri.conf.json の version。アプリ本体の app_version はこれ）と、接続の本体の版（crates/lifeplan の Cargo.toml）が同じか。
 * 違うと、配布物の中で接続の本体が VERSION_MISMATCH を返し、事務所の設定の画面にも「版が違います」と出る */
export function versionProblems(appVersion: string | undefined, connectorVersion: string | null): string[] {
  if (appVersion === undefined) return ["app/src-tauri/tauri.conf.json に version がありません"];
  if (connectorVersion === null) return ["crates/lifeplan/Cargo.toml の [package] に version がありません"];
  if (appVersion !== connectorVersion) return [`アプリの版（app/src-tauri/tauri.conf.json の ${appVersion}）と AI接続の本体の版（crates/lifeplan/Cargo.toml の ${connectorVersion}）をそろえてください（0015 の1）`];
  return [];
}

export function appVersion(): string | undefined {
  return (JSON.parse(readFileSync(join(APP_DIR, "src-tauri", "tauri.conf.json"), "utf8")) as { version?: string }).version;
}

export function connectorCargoVersion(): string | null {
  return cargoVersion(readFileSync(join(REPO_DIR, "crates", "lifeplan", "Cargo.toml"), "utf8"));
}

function hostTriple(): string {
  const out = execFileSync("rustc", ["-vV"], { encoding: "utf8" });
  const m = out.match(/^host:\s*(\S+)/m);
  if (m?.[1] === undefined) throw new Error("rustc -vV から、この PC のターゲットを読めません");
  return m[1];
}

/**
 * 接続の本体を作り、サイドカーの場所に置いて、版を確かめる。
 * 順番: 計算エンジンのまとめた JS と制度データ（engine/dist。CI の前の段）→ 同梱の JS と一覧（npm run build:explain → crates/lifeplan/dist）
 * → cargo build -p lifeplan（build.rs が両方を埋め込む）→ binaries/ に写す（universal は lipo）→ `--version` がアプリの版と同じか
 */
export function buildConnector(tauriArgs: string[]): ConnectorPlan {
  const version = appVersion();
  const problems = versionProblems(version, connectorCargoVersion());
  if (problems.length > 0) throw new Error(problems.join("\n"));
  if (!existsSync(join(REPO_DIR, "engine", "dist", "engine.js"))) {
    throw new Error("計算エンジンのまとめた JS（engine/dist/engine.js）がありません。先に engine/ で `npm ci && npm run build` を流してください");
  }
  const plan = connectorPlan(tauriArgs, hostTriple());
  const win = process.platform === "win32";
  console.log("AI接続の本体: 同梱の JS と一覧を作る（npm run build:explain）");
  execFileSync("npm", ["run", "build:explain"], { cwd: APP_DIR, stdio: "inherit", shell: win });
  mkdirSync(SIDECAR_DIR, { recursive: true });
  for (const t of plan.build) {
    console.log(`AI接続の本体: cargo build -p lifeplan --target ${t}`);
    execFileSync("cargo", ["build", "--release", "--locked", "-p", "lifeplan", "--target", t], { cwd: REPO_DIR, stdio: "inherit" });
    const exe = join(REPO_DIR, "target", t, "release", t.includes("-windows-") ? "lifeplan.exe" : "lifeplan");
    copyFileSync(exe, join(SIDECAR_DIR, sidecarFile(t)));
  }
  if (plan.universal) {
    execFileSync("lipo", ["-create", "-output", join(SIDECAR_DIR, sidecarFile(UNIVERSAL)), ...MAC_ARCHS.map((t) => join(SIDECAR_DIR, sidecarFile(t)))], { stdio: "inherit" });
    execFileSync("lipo", ["-info", join(SIDECAR_DIR, sidecarFile(UNIVERSAL))], { stdio: "inherit" });
  }
  // 配布物に入る物の版（この PC で動かせるターゲットのとき。CI の Mac は universal、Windows・Linux は自分のターゲット）
  const bundled = join(SIDECAR_DIR, sidecarFile(plan.bundled));
  const said = execFileSync(bundled, ["--version"], { encoding: "utf8" }).trim();
  if (said !== `lifeplan ${version}`) throw new Error(`AI接続の本体の --version が「${said}」で、アプリの版 ${version} と違います`);
  console.log(`AI接続の本体: ${sidecarFile(plan.bundled)}（${said}）を配布物に入れる`);
  return plan;
}
