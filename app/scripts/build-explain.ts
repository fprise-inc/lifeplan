// AI接続口（crates/lifeplan）に同梱する「数字の根拠」の読み方（src/connector/explain.ts。0183）と計算の前の処理（src/connector/prepare.ts。0184）と主な数字（src/connector/summary.ts。0194）を、
// 1つの JS（crates/lifeplan/dist/explain.js）にまとめる。プランの動かす項目（src/connector/plan.ts。0195）は、入力の欄の定義まで読むので大きく
// （約2MB）、別の JS（crates/lifeplan/dist/plan.js）にまとめる（プランを当てないときの計算で読み込まない）。
// 見本の世帯の一覧の名前と目印（src/connector/samples.ts。0199）は、JS ではなく JSON（crates/lifeplan/dist/samples.json）にする（接続口はそのまま埋め込む）。
// カスタム層の説明の一覧と名前の一覧（scripts/textsCatalog.ts。0016 の追記・0212）も JSON（crates/lifeplan/dist/texts-catalog.json・terms-catalog.json）にする
// （接続口の list_custom_texts が返す。アプリ本体が埋め込む app/src/generated の物と同じ中身）。
// - 接続口はこれを計算と同じ固めた実行環境（quickjs-ng）で動かす。画面の根拠のパネルと同じ関数なので、根拠の文が画面とずれない
// - 外の部品（npm のパッケージ）を1つも入れない（入ったら止める）。動的な import をしない（1つの iife）
// - 中身が変わっていなければ作り直さない（src/・report/src/・hearing/src/ の指紋で見る）
// 直接流すとき: npm run build:explain（先に prepare-assets で src/generated を作る）
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { build, type Plugin } from "vite";
import { connectorSamples } from "../src/connector/samples.ts";
import { APP_DIR, REPO_DIR } from "./lib.ts";

export const EXPLAIN_OUT = join(REPO_DIR, "crates", "lifeplan", "dist");

function files(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...files(p));
    else if (/\.(ts|tsx|json)$/.test(name)) out.push(p);
  }
  return out;
}

function inputDigest(): string {
  const h = createHash("sha256");
  const list = [...files(join(APP_DIR, "src")), ...files(join(REPO_DIR, "report", "src")), ...files(join(REPO_DIR, "hearing", "src")), join(APP_DIR, "package-lock.json"), join(APP_DIR, "scripts", "build-explain.ts")].sort();
  for (const f of list) {
    h.update(relative(REPO_DIR, f));
    h.update("\0");
    h.update(readFileSync(f));
  }
  return h.digest("hex");
}

/**
 * まとめた JS の頭に置く、画面の部品が使う組み込みの代わり（0195）。Math.round・Math.pow は数字の根拠の JS（explain.js）にも置く
 * （年金の見込みの世帯の月額の丸めに Math.round を使う。0199）。接続口の固めた実行環境（0005 の3）には、structuredClone が無く、
 * 結果がエンジンや OS で変わる Math の関数（round・pow など）は呼ぶとエラーになる。画面の部品はそれを使うので、まとめた JS の中だけで
 * 同じ名前を、OS に依らず同じ答えになる実装に置き換える（グローバルの組み込みは変えない）:
 * - Math.round: 仕様どおり（x − floor(x) は丸めずに出るので、0.5 以上なら切り上げ。負の数の 0 も仕様どおり）
 * - Math.pow: 指数が整数のときだけ、2乗を重ねて求める（住宅ローンの返済額の式など。整数でない指数はエラー）
 * - structuredClone: 世帯の要求（JSON の値）と Map・Set だけを写す
 * - TextEncoder: UTF-8 に直す encode だけ（古い要素に決まった ID を振るときの指紋に使う）
 * - crypto.randomUUID: 呼ぶ順の番号で作る UUID 第4版の形（プランを当てる途中の、差分の仮の ID に使う。計算の要求には入らない）
 * - 数の toLocaleString（固めた実行環境には Intl が無く、桁の区切りが付かない）: まとめた JS の中の `x.toLocaleString(…)` の呼び出しを
 *   `__fxLocale(x, …)` に書き換え（localeCalls）、数なら Intl と同じ形（3桁ごとのコンマ・小数は最大 maximumFractionDigits 桁〔既定3〕で
 *   四捨五入〔0 から遠い方〕・後ろの0を落とす・負の数は "-"）にする。数でない物は String（日時の文は画面だけで、プランを当てる道筋では使わない）
 * 残りの disabled な関数（sqrt・log など）はそのまま呼ぶとエラー（プランを当てる道筋では使わない。使えばテストで止まる）
 */
export const MATH_INTRO = `
const Math = Object.create(globalThis.Math, {
  round: { value: (x) => { x = +x; const f = globalThis.Math.floor(x); const r = x - f >= 0.5 ? f + 1 : f; return r === 0 && (x < 0 || Object.is(x, -0)) ? -0 : r; } },
  pow: { value: (a, b) => {
    a = +a; b = +b;
    if (!Number.isInteger(b) || globalThis.Math.abs(b) > 100000) throw new TypeError("Math.pow with a non-integer exponent is disabled (0195)");
    let n = globalThis.Math.abs(b), base = a, out = 1;
    while (n > 0) { if (n % 2 === 1) out *= base; base *= base; n = globalThis.Math.floor(n / 2); }
    return b < 0 ? 1 / out : out;
  } },
});
`;

/**
 * 世帯の要求を写す・要素の ID を振る部品が使う組み込みの代わり（structuredClone・crypto.randomUUID・TextEncoder。上の説明のとおり）。
 * プランの動かす項目の JS と、数字の根拠の JS（計算のお知らせの物の呼び名を引くとき、画面と同じく作業中の世帯を作る。0210）の両方に置く
 */
export const CLONE_INTRO = `
const structuredClone = (v) => {
  if (typeof v !== "object" || v === null) return v;
  if (Array.isArray(v)) return v.map(structuredClone);
  if (v instanceof Map) return new Map([...v].map(([k, x]) => [structuredClone(k), structuredClone(x)]));
  if (v instanceof Set) return new Set([...v].map(structuredClone));
  const o = {};
  for (const k of Object.keys(v)) o[k] = structuredClone(v[k]);
  return o;
};
let uuidCount = 0;
const crypto = {
  randomUUID: () => {
    uuidCount += 1;
    return "00000000-0000-4000-8000-" + uuidCount.toString(16).padStart(12, "0");
  },
};
class TextEncoder {
  encode(s) {
    s = String(s);
    const out = [];
    for (let i = 0; i < s.length; i++) {
      let c = s.charCodeAt(i);
      if (c >= 0xd800 && c <= 0xdbff && i + 1 < s.length) {
        const d = s.charCodeAt(i + 1);
        if (d >= 0xdc00 && d <= 0xdfff) { c = 0x10000 + ((c - 0xd800) << 10) + (d - 0xdc00); i++; }
        else c = 0xfffd;
      } else if (c >= 0xd800 && c <= 0xdfff) c = 0xfffd;
      if (c < 0x80) out.push(c);
      else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 63));
      else if (c < 0x10000) out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
      else out.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 63), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
    }
    return new Uint8Array(out);
  }
}
`;

/**
 * プランの動かす項目の JS の頭（MATH_INTRO と CLONE_INTRO に、数の toLocaleString の代わりを足した物）
 */
export const PLAN_INTRO = `${MATH_INTRO}${CLONE_INTRO}
const __fxLocale = (x, locale, opts) => {
  if (typeof x !== "number") return String(x);
  if (Number.isNaN(x)) return "NaN";
  const neg = x < 0 || Object.is(x, -0);
  if (!Number.isFinite(x)) return neg ? "-∞" : "∞";
  const max = opts !== undefined && opts.maximumFractionDigits !== undefined ? opts.maximumFractionDigits : 3;
  const min = opts !== undefined && opts.minimumFractionDigits !== undefined ? opts.minimumFractionDigits : 0;
  // いちばん短い10進の形（Intl も同じ桁から丸める）を、指数の無い形にする
  let t = String(neg ? -x : x);
  const e = t.indexOf("e");
  if (e >= 0) {
    const exp = Number(t.slice(e + 1));
    const digits = t.slice(0, e).replace(".", "");
    const point = (t.slice(0, e).indexOf(".") < 0 ? t.slice(0, e).length : t.slice(0, e).indexOf(".")) + exp;
    t = point <= 0 ? "0." + "0".repeat(-point) + digits : point >= digits.length ? digits + "0".repeat(point - digits.length) : digits.slice(0, point) + "." + digits.slice(point);
  }
  let [int, frac = ""] = t.split(".");
  if (frac.length > max) {
    const up = frac.charCodeAt(max) >= 53;
    frac = frac.slice(0, max);
    if (up) {
      const all = (int + frac).split("").map(Number);
      let i = all.length - 1;
      while (i >= 0) { if (all[i] === 9) { all[i] = 0; i--; } else { all[i] += 1; break; } }
      if (i < 0) all.unshift(1);
      const s2 = all.join("");
      int = s2.slice(0, s2.length - frac.length);
      frac = s2.slice(s2.length - frac.length);
    }
  }
  while (frac.length > min && frac.endsWith("0")) frac = frac.slice(0, -1);
  while (frac.length < min) frac += "0";
  int = int.replace(/^0+(?=\\d)/, "").replace(/\\B(?=(\\d{3})+(?!\\d))/g, ",");
  return (neg ? "-" : "") + int + (frac.length > 0 ? "." + frac : "");
};
`;

/** まとめた JS の中の `x.toLocaleString(…)` を `__fxLocale(x, …)` に書き換える（PLAN_INTRO の __fxLocale。プランの動かす項目の JS だけ） */
function localeCalls(): Plugin {
  type Node = { type: string; start: number; end: number; [k: string]: unknown };
  const isNode = (v: unknown): v is Node => typeof v === "object" && v !== null && typeof (v as Node).type === "string";
  return {
    name: "financia-plan-locale",
    renderChunk(code) {
      const edits: { at: number; end: number; text: string }[] = [];
      const walk = (n: unknown): void => {
        if (Array.isArray(n)) return n.forEach(walk);
        if (!isNode(n)) return;
        const callee = n.callee as Node | undefined;
        const prop = callee?.property as Node | undefined;
        if (n.type === "CallExpression" && callee?.type === "MemberExpression" && callee.computed !== true && prop?.type === "Identifier" && prop.name === "toLocaleString") {
          const dot = code.lastIndexOf(".", prop.start);
          const open = code.indexOf("(", prop.end);
          if (code[dot - 1] === "?") throw new Error("toLocaleString の ?. の呼び出しは書き換えられません");
          edits.push({ at: callee.start, end: callee.start, text: "__fxLocale(" });
          edits.push({ at: dot, end: open + 1, text: (n.arguments as unknown[]).length > 0 ? ", " : "" });
        }
        for (const [k, v] of Object.entries(n)) if (k !== "type" && k !== "start" && k !== "end") walk(v);
      };
      walk(this.parse(code));
      if (edits.length === 0) return null;
      edits.sort((a, b) => b.at - a.at || b.end - a.end);
      let out = code;
      for (const e of edits) out = out.slice(0, e.at) + e.text + out.slice(e.end);
      if (/\.toLocaleString\(/.test(out)) throw new Error("書き換えていない toLocaleString が残りました");
      return { code: out, map: null };
    },
  };
}

/** 1つの入口を1つの iife の JS にまとめ、外の部品・動的な import が入っていないことを確かめる */
async function bundle(entry: string, name: string, fileName: string, intro: string | undefined, plugins: Plugin[] = []): Promise<void> {
  const out = await build({
    configFile: false,
    plugins,
    root: APP_DIR,
    logLevel: "warn",
    publicDir: false,
    mode: "production",
    define: { "import.meta.env.DEV": "false", "process.env.NODE_ENV": JSON.stringify("production") },
    build: {
      outDir: EXPLAIN_OUT,
      target: "es2022",
      minify: false,
      sourcemap: false,
      reportCompressedSize: false,
      emptyOutDir: false,
      lib: { entry: join(APP_DIR, "src", "connector", entry), formats: ["iife"], name, fileName: () => fileName },
      ...(intro !== undefined ? { rollupOptions: { output: { intro } } } : {}),
    },
  });
  const outputs = (Array.isArray(out) ? out : [out]) as { output?: { moduleIds?: string[] }[] }[];
  const ids = outputs.flatMap((o) => o.output ?? []).flatMap((c) => c.moduleIds ?? []);
  if (ids.length === 0) throw new Error("まとめた JS の中身の一覧が取れませんでした");
  const outside = ids.filter((id) => id.replaceAll("\\", "/").includes("/node_modules/") || id.startsWith("\0"));
  if (outside.length > 0) throw new Error(`AI接続口の ${fileName} に、外の部品が入りました（画面の部品を読まないようにする）: ${outside.join(", ")}`);
  const text = readFileSync(join(EXPLAIN_OUT, fileName), "utf8");
  if (/\bimport\s*\(/.test(text)) throw new Error(`AI接続口の ${fileName} に、動的な import があります`);
}

export async function buildExplain(force = false): Promise<void> {
  const digest = inputDigest();
  const stamp = join(EXPLAIN_OUT, ".digest");
  const outs = ["explain.js", "plan.js", "samples.json", "texts-catalog.json", "terms-catalog.json"].map((f) => join(EXPLAIN_OUT, f));
  if (!force && existsSync(stamp) && readFileSync(stamp, "utf8") === digest && outs.every((f) => existsSync(f))) return;
  rmSync(EXPLAIN_OUT, { recursive: true, force: true });
  mkdirSync(EXPLAIN_OUT, { recursive: true });
  await bundle("explain.ts", "FinanciaExplain", "explain.js", `${MATH_INTRO}${CLONE_INTRO}`);
  await bundle("plan.ts", "FinanciaPlan", "plan.js", PLAN_INTRO, [localeCalls()]);
  writeFileSync(join(EXPLAIN_OUT, "samples.json"), `${JSON.stringify(connectorSamples(), null, 1)}\n`);
  const { buildTermsCatalog, buildTextsCatalog } = await import("./textsCatalog.ts");
  writeFileSync(join(EXPLAIN_OUT, "texts-catalog.json"), `${JSON.stringify(buildTextsCatalog(), null, 1)}\n`);
  writeFileSync(join(EXPLAIN_OUT, "terms-catalog.json"), `${JSON.stringify(buildTermsCatalog(), null, 1)}\n`);
  writeFileSync(stamp, digest);
}

if (import.meta.url === `file://${process.argv[1]}`) await buildExplain(process.argv.includes("--force"));
