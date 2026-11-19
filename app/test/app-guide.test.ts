// 画面の操作の手引き（docs/app-guide。AI接続の search_app_guide・get_app_guide が同梱して読む。0227）が、今の画面とずれていないかを確かめる。
// - 手引きの「」の中（画面のボタン・見出し・タブ・メニューの名前）が、今の画面の文にそのままあること。画面の言葉を変えて手引きを直し忘れたら落ちる
//   画面の文として読むのは app/src の ts・tsx（コメントを外す）・prepare-assets が作る差し替えられる文と名前の一覧（src/generated）・
//   提案書と持ち帰り用のレポートの文（report/src）・本体が決める AI のアプリの設定の文面の題（app/src-tauri/src）
// - 手引きの言葉の決まり（「接続口」などを書かない）と、節の形（id・探す言葉・要点）。形の細かい読み方は接続口の側（crates/lifeplan/src/app_guide.rs）の試験
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { APP_DIR, REPO_DIR } from "../scripts/lib.ts";

const GUIDE_DIR = join(REPO_DIR, "docs", "app-guide");

/** 手引きのファイル（NN-<画面>.md。README.md は書き方の説明なので入れない。接続口の build.rs と同じ選び方） */
function guideFiles(): string[] {
  return readdirSync(GUIDE_DIR)
    .filter((n) => /^\d\d-.+\.md$/.test(n))
    .sort();
}

function walk(dir: string, exts: string[], out: string[] = []): string[] {
  if (!existsSync(dir)) return out;
  for (const n of readdirSync(dir)) {
    const p = join(dir, n);
    if (statSync(p).isDirectory()) walk(p, exts, out);
    else if (exts.some((e) => n.endsWith(e))) out.push(p);
  }
  return out;
}

/** コメントを外す（行の頭の // と *、空白の後の // から行末、/* … *\/）。URL の // は「:」の後なので残る */
function withoutComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .split("\n")
    .filter((l) => !/^\s*(\/\/|\*)/.test(l))
    .map((l) => l.replace(/(^|\s)\/\/.*$/, "$1"))
    .join("\n");
}

/** 今の画面の文（ソースの文字をそのまま。JSX の行の折り返しは空白1つにも読む） */
function screenText(): string {
  const files = [
    ...walk(join(APP_DIR, "src"), [".ts", ".tsx"]).filter((p) => !p.includes(`${join("src", "generated")}`)),
    ...walk(join(REPO_DIR, "report", "src"), [".ts", ".tsx"]),
    ...walk(join(APP_DIR, "src-tauri", "src"), [".rs"]),
  ];
  const parts = files.map((p) => withoutComments(readFileSync(p, "utf8")));
  // 差し替えられる文と名前の一覧（prepare-assets が作る。npm test の前に作られる）
  for (const p of walk(join(APP_DIR, "src", "generated"), [".json"])) parts.push(readFileSync(p, "utf8"));
  const all = parts.join("\n");
  return `${all}\n${all.replace(/\s*\n\s*/g, " ")}\n${all.replace(/\s*\n\s*/g, "")}`;
}

/** 本文の「」の中（入れ子は内側から）。見出しの行（## …）は外す */
function quoted(text: string): string[] {
  const body = text
    .split("\n")
    .filter((l) => !l.startsWith("## ") && !l.startsWith("# "))
    .join("\n");
  return [...body.matchAll(/「([^「」]+)」/g)].map((m) => m[1]!);
}

describe("画面の操作の手引き（0227）", () => {
  const files = guideFiles();

  it("手引きのファイルがある", () => {
    expect(files.length).toBeGreaterThanOrEqual(8);
  });

  it("「」の中の画面の名前が、今の画面の文にそのままある", () => {
    const screen = screenText();
    const missing: string[] = [];
    for (const f of files) {
      for (const q of quoted(readFileSync(join(GUIDE_DIR, f), "utf8"))) {
        if (!screen.includes(q)) missing.push(`${f}: 「${q}」`);
      }
    }
    // 落ちたら: 画面の言葉が変わったなら手引きを今の言葉に直す。画面の名前でない言葉なら「」を外す（docs/app-guide/README.md）
    expect(missing, `今の画面に無い名前:\n${missing.join("\n")}`).toEqual([]);
  });

  it("手引きの言葉の決まり（書かない言葉）", () => {
    const banned = ["接続口", "当て", "比べ", "札", "カード"];
    const found: string[] = [];
    for (const f of files) {
      readFileSync(join(GUIDE_DIR, f), "utf8")
        .split("\n")
        .forEach((l, i) => {
          for (const w of banned) if (l.includes(w)) found.push(`${f}:${i + 1}: ${w}`);
        });
    }
    expect(found).toEqual([]);
  });

  it("節の形（{#id}・探す言葉・要点）と id の重なり", () => {
    const ids = new Set<string>();
    const problems: string[] = [];
    for (const f of files) {
      const text = readFileSync(join(GUIDE_DIR, f), "utf8");
      if (!text.startsWith("# ")) problems.push(`${f}: 1行目が「# 画面の題」でない`);
      for (const sec of text.split(/\n(?=## )/).slice(1)) {
        const head = sec.split("\n")[0]!;
        const id = /\{#([a-z][a-zA-Z0-9]*(?:\.[a-zA-Z0-9]+)+)\}\s*$/.exec(head)?.[1];
        if (id === undefined) {
          problems.push(`${f}: ${head} に {#id} が無い`);
          continue;
        }
        if (ids.has(id)) problems.push(`${f}: id ${id} が重なる`);
        ids.add(id);
        if (!/\n探す言葉: .+/.test(sec) || !/\n要点: .+/.test(sec)) problems.push(`${f}: ${id} に「探す言葉:」「要点:」が無い`);
      }
    }
    expect(problems).toEqual([]);
    expect(ids.size).toBeGreaterThanOrEqual(40);
  });
});
