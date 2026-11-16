// 画面の呼び方: 上のタブは「入力／結果／資産と負債／収益不動産／万一のとき／提案書」（収益不動産は物件のある世帯だけ）、比較するものは「プラン」（表記は「プランB」）。
// 利用者に見える文字列（画面・提案書の帳票・帳票の見本・ヒアリングシート）に、以前の呼び方「見通し」（画面）・「B案」「案A」「〜の案」が残っていないこと。
// 「提案」「提案書」「案内」などの別の言葉は残してよい。コメント・正規表現（以前の名前「B案」を読むためのもの）は見ない
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { REPO_DIR } from "../scripts/lib.ts";
import { modernPlanName, suggestName } from "../src/workspace/plans/plans.ts";
import { planLetters } from "../src/workspace/plans/band.ts";
import { TABS } from "../src/workspace/App.tsx";

/** 「案」を含んでも別の言葉のもの（提案・案内など） */
const OTHER_WORDS = /提案|案内|答案|草案|原案|法案|議案|考案|立案|図案|思案|新案|代案|懸案|腹案|名案|妙案|試案|私案|発案|翻案|文案|成案/g;

/** 以前の呼び方「案」が残っているか */
export const hasOldPlanWord = (s: string): boolean => s.replace(OTHER_WORDS, "").includes("案");

/**
 * 表示の設定の案（0215）の画面の部品。利用者の判断で「案」を使う（2026-11-15。「今 → 案」「AIからの表示の設定の案」）。
 * この部品だけは、「案」そのものでなく、以前のプランの呼び方の形（hasOldPlanName）を止める
 */
const DISPLAY_PROPOSAL_FILES = new Set(["app/src/connector/displayProposal.ts", "app/src/workspace/office/DisplayProposalsSection.tsx", "app/src/workspace/office/displayProposals.ts", "app/src/workspace/ai/AiDisplayCandidateBand.tsx", "app/src/workspace/ai/AiDisplayProposals.tsx", "app/src/workspace/ai/displayProposals.ts"]);

/** 以前のプランの呼び方の形（B案・案A・基準の案・選んだ案・比較する案・案として保存・案を保存・案の名前・案を比較）が残っているか */
export const hasOldPlanName = (s: string): boolean => /[A-ZＡ-Ｚ]案|案[A-ZＡ-Ｚ]|基準の案|選んだ案|比較する案|案として保存|案を保存|案の名前|案を比較/.test(s.replace(OTHER_WORDS, ""));

const isDisplayProposalFile = (at: string): boolean => DISPLAY_PROPOSAL_FILES.has(at.slice(0, at.lastIndexOf(":")));

function files(dir: string, ext: RegExp): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === "dist" || name === "target") continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...files(p, ext));
    else if (ext.test(name)) out.push(p);
  }
  return out;
}

/** TypeScript のファイルの文字列（文字列・テンプレート・JSX の文字と属性）。コメントと正規表現は含まない */
function tsStrings(file: string): { at: string; text: string }[] {
  const src = ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true, file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const out: { at: string; text: string }[] = [];
  const visit = (node: ts.Node) => {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) || ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node) || ts.isJsxText(node)) {
      const line = src.getLineAndCharacterOfPosition(node.getStart(src)).line + 1;
      out.push({ at: `${relative(REPO_DIR, file)}:${line}`, text: node.text });
    }
    ts.forEachChild(node, visit);
  };
  visit(src);
  return out;
}

/** JSON の文字列の値（ヒアリングシートの定義・帳票の見本の入力） */
function jsonStrings(file: string): { at: string; text: string }[] {
  const out: { at: string; text: string }[] = [];
  const walk = (v: unknown, path: string) => {
    if (typeof v === "string") out.push({ at: `${relative(REPO_DIR, file)} ${path}`, text: v });
    else if (Array.isArray(v)) v.forEach((x, i) => walk(x, `${path}[${i}]`));
    else if (v !== null && typeof v === "object") for (const [k, x] of Object.entries(v)) walk(x, `${path}.${k}`);
  };
  walk(JSON.parse(readFileSync(file, "utf8")), "$");
  return out;
}

/** Typst の帳票の文字（// の行コメントを除く） */
function typstText(file: string): { at: string; text: string }[] {
  return readFileSync(file, "utf8")
    .split("\n")
    .map((l, i) => ({ at: `${relative(REPO_DIR, file)}:${i + 1}`, text: l.replace(/(^|[^:])\/\/.*$/, "$1") }));
}

/** Rust の文字列（"…"。// のコメントの行を除く） */
function rustStrings(file: string): { at: string; text: string }[] {
  return readFileSync(file, "utf8")
    .split("\n")
    .flatMap((l, i) => (/^\s*\/\//.test(l) ? [] : [...l.matchAll(/"((?:[^"\\]|\\.)*)"/g)].map((m) => ({ at: `${relative(REPO_DIR, file)}:${i + 1}`, text: m[1] as string }))));
}

describe("利用者に見える文字列の呼び方", () => {
  it("画面（app/src）に「見通し」「B案」「〜の案」が残っていない", () => {
    const strs = files(join(REPO_DIR, "app", "src"), /\.tsx?$/).flatMap(tsStrings);
    expect(strs.length).toBeGreaterThan(1000);
    expect(strs.filter((s) => (isDisplayProposalFile(s.at) ? hasOldPlanName(s.text) : hasOldPlanWord(s.text))).map((s) => `${s.at} ${s.text}`)).toEqual([]);
    // 表示の設定の案の画面の部品は、実際に「案」を使っている（外す部品の名前が古くなったら気づく）
    expect(strs.filter((s) => isDisplayProposalFile(s.at) && s.text.includes("案")).length).toBeGreaterThan(5);
    expect(strs.filter((s) => s.text.includes("見通し")).map((s) => `${s.at} ${s.text}`)).toEqual([]);
  });

  it("提案書（report/src・帳票の見本・Typst の帳票・report-pdf）に「B案」「〜の案」が残っていない", () => {
    const strs = [
      ...files(join(REPO_DIR, "report", "src"), /\.ts$/).flatMap(tsStrings),
      ...files(join(REPO_DIR, "report", "scripts"), /\.ts$/).flatMap(tsStrings),
      ...files(join(REPO_DIR, "report", "typst"), /\.typ$/).flatMap(typstText),
      ...files(join(REPO_DIR, "crates", "report-pdf", "src"), /\.rs$/).flatMap(rustStrings),
      ...files(join(REPO_DIR, "crates", "report-pdf", "tests", "fixtures"), /\.json$/).flatMap(jsonStrings),
    ];
    expect(strs.length).toBeGreaterThan(300);
    expect(strs.filter((s) => hasOldPlanWord(s.text)).map((s) => `${s.at} ${s.text}`)).toEqual([]);
  });

  it("ヒアリングシート（シートの定義・見本・読み書き）に「B案」「〜の案」が残っていない", () => {
    const strs = [...files(join(REPO_DIR, "hearing", "sheets"), /\.json$/).flatMap(jsonStrings), ...files(join(REPO_DIR, "hearing", "samples"), /\.json$/).flatMap(jsonStrings), ...files(join(REPO_DIR, "hearing", "src"), /\.ts$/).flatMap(tsStrings)];
    expect(strs.length).toBeGreaterThan(300);
    expect(strs.filter((s) => hasOldPlanWord(s.text)).map((s) => `${s.at} ${s.text}`)).toEqual([]);
  });

  it("見分け方: 「提案」「案内」は別の言葉。「B案」「案A」「基準の案」「案として保存」は以前の呼び方", () => {
    for (const s of ["提案書", "現状と提案", "アプリの更新を案内", "答案"]) expect(hasOldPlanWord(s), s).toBe(false);
    for (const s of ["B案", "案A", "基準の案", "案として保存", "提案と案"]) expect(hasOldPlanWord(s), s).toBe(true);
  });

  it("表示の設定の案の画面の部品の見分け方: 「今 → 案」「表示の設定の案」は通り、以前のプランの呼び方の形は止める", () => {
    for (const s of ["今 → 案", "AIから、表示の設定の案が届いています", "AIからの表示の設定の案", "この案は反映できません", "AIの案を反映する前", "1つの設定には1つの案", "案を出せるのは input.order です", "提案書"]) expect(hasOldPlanName(s), s).toBe(false);
    for (const s of ["B案", "Ｃ案", "案A", "基準の案", "選んだ案", "比較する案", "案として保存", "案を保存", "案の名前", "案を比較"]) expect(hasOldPlanName(s), s).toBe(true);
    // ほかの画面は今までどおり「案」そのものを止める
    expect(hasOldPlanWord("今 → 案")).toBe(true);
  });
});

describe("タブとプランの表記", () => {
  it("上のタブは「入力／結果／資産と負債／収益不動産／万一のとき／提案書」（収益不動産は物件のある世帯だけ）", () => {
    expect(TABS.map((t) => t.label)).toEqual(["入力", "結果", "資産と負債", "収益不動産", "万一のとき", "提案書"]);
  });

  it("新しいプランの名前は「プランB …」。以前の「B案 …」の名前も文字を読み、画面では「プランB」と出す", () => {
    const p = (id: string, name: string) => ({ id, name, createdAt: "", updatedAt: "", base: null, tags: [], diffs: [] });
    const ls = planLetters([p("x", "B案 借入を500万円減らす"), p("y", "プランC プランB＋金利が上がる"), p("z", "D案 B案＋NISA"), p("w", "名前だけ")]);
    expect(ls.get("x")).toEqual({ letter: "B", name: "借入を500万円減らす" });
    expect(ls.get("y")).toEqual({ letter: "C", name: "プランB＋金利が上がる" });
    expect(ls.get("z")).toEqual({ letter: "D", name: "プランB＋NISA" });
    expect(ls.get("w")).toEqual({ letter: "E", name: "名前だけ" });
    expect(modernPlanName("C案 B案＋提案の見直し")).toBe("プランC プランB＋提案の見直し");
    const wh = { proposals: [p("x", "B案 借入を減らす")] } as never;
    expect(suggestName([p("x", "B案 借入を減らす")], {}, wh, { items: [] } as never)).toBe("プランC");
  });
});
