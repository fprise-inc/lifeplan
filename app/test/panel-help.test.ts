// 入力のパネルの説明の「?」（0077 の追記）: 開いただけでは説明が出ない（フォーカスで開くのはキーボードで移ったときだけ・開いた直後に「?」へ移らない）。
// 標準／詳細の切り替えの右の「?」（2026-10-29 に左から右へ）は、入力項目ごとの2文（標準で入れるもの・詳細で増えるもの）で、並べるものはその入力項目の標準・詳細に出る欄に当たる。
// 相続・贈与のパネルの相続税の目安は、入れる区画の下（0060 の追記）
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { h } from "preact";
import { renderToString } from "preact-render-to-string";
import { focusOpensHelp } from "../src/presentation/Help.tsx";
import { fromRequest, type WorkingHousehold } from "../src/workspace/input/household.ts";
import { InputPanel, PANEL_FIRST_FOCUS } from "../src/workspace/input/InputPanel.tsx";
import { itemStage } from "../src/workspace/input/items.ts";
import { LEVEL_HELP, LEVEL_HELP_COMMON, levelDiffLine, levelHelpLines } from "../src/workspace/input/levelHelp.ts";
import { STAGE_ORDER } from "../src/workspace/input/stages/index.ts";
import { APP_DIR, REPO_DIR } from "../scripts/lib.ts";
import { modelHousehold } from "./helpers.ts";

const noop = () => undefined;
const MODELS = readdirSync(join(REPO_DIR, "data", "modelHouseholds"))
  .filter((f) => f.endsWith(".json"))
  .map((f) => f.slice(0, -5));
const open = (m: string): WorkingHousehold => fromRequest(modelHousehold(m), {});
const panel = (wh: WorkingHousehold, card: string, level: "simple" | "detail" = "simple") => renderToString(h(InputPanel, { wh, itemId: card, level, onLevel: noop, onSave: noop, onClose: noop }));

describe("開いただけでは説明が出ない", () => {
  it("フォーカスで開くのはキーボードで移ったとき（:focus-visible）だけ。読めない画面では開く", () => {
    expect(focusOpensHelp({ matches: (q) => q === ":focus-visible" })).toBe(true);
    expect(focusOpensHelp({ matches: () => false })).toBe(false);
    expect(
      focusOpensHelp({
        matches: () => {
          throw new Error("unsupported");
        },
      }),
    ).toBe(true);
  });
  it("開いた直後に移る先のボタンに、説明の「?」（data-help-btn）を選ばない", () => {
    const buttons = PANEL_FIRST_FOCUS.filter((q) => q.includes("button"));
    expect(buttons.length).toBeGreaterThan(0);
    for (const q of buttons) expect(q).toContain(":not([data-help-btn])");
    // 欄・最初のボタンの後は閉じるボタン（どのパネルにもある）
    expect(PANEL_FIRST_FOCUS.at(-1)).toBe(".x-btn");
  });
  it.each(MODELS)("%s: どのカードのパネルも、開いたときは説明の箱が隠れている（開いている「?」が無い）", (m) => {
    const wh = open(m);
    for (const s of STAGE_ORDER) {
      for (const level of ["simple", "detail"] as const) {
        const html = panel(wh, s.id, level);
        if (html === "") continue;
        expect(html, `${s.label}`).not.toContain('aria-expanded="true"');
        for (const pop of html.matchAll(/<span id="help-[^"]*" role="tooltip"([^>]*)>/g)) expect(pop[1], `${s.label}`).toContain("hidden");
      }
    }
  });
});

describe("標準／詳細の切り替えの右の「?」", () => {
  it("どの入力項目にもあり、切り替えのすぐ右・閉じるの手前（入力項目ごとの2文。「?」は説明する物の右＝2026-10-29 の追記）", () => {
    const wh = open(MODELS[0]!);
    for (const s of STAGE_ORDER) {
      const html = panel(wh, s.id);
      const tools = /<div class="level-switch"[\s\S]*?<\/div>([\s\S]*?)<button type="button" class="x-btn"/.exec(html);
      expect(tools, s.label).not.toBeNull();
      expect(tools![1]).toContain('data-help="level"');
      expect(tools![1]).toContain('aria-label="標準と詳細の違いの説明"');
      expect(LEVEL_HELP_COMMON).toEqual([]);
      expect(tools![1]).toContain(levelDiffLine(s.id));
      const [a, b] = levelHelpLines(s.id);
      expect(a).toMatch(/^標準では、[^。]+など、結果を大きく動かすものを入れます。$/);
      expect(b).toMatch(/^詳細では、さらに[^。]+も入れられます。入れなければ(推定|既定の値)で計算します。$/);
      // 「欄」「項目」とは書かない（「項目」は入力項目のこと）
      expect(a + b, s.label).not.toMatch(/欄|項目/);
    }
  });
  it("カードの説明の「?」には、標準／詳細の話を重ねない", () => {
    const html = panel(open(MODELS[0]!), "family");
    const head = /data-help="panel"[\s\S]*?<\/h2>/.exec(html)![0];
    expect(head).not.toContain("標準／詳細");
  });
  it("並べるものは、その入力項目の標準に出る欄・詳細でだけ出る欄（ボタン・区画の名前を含む）に当たる（見本の世帯のどれかで）", () => {
    const names = new Map<string, Set<string>>();
    const simpleNames = new Map<string, Set<string>>();
    for (const m of MODELS) {
      const wh = open(m);
      for (const s of STAGE_ORDER) {
        const st = itemStage(wh, s.id);
        if (st === null) continue;
        const set = names.get(s.id) ?? new Set<string>();
        names.set(s.id, set);
        const easy = simpleNames.get(s.id) ?? new Set<string>();
        simpleNames.set(s.id, easy);
        const put = (deep: boolean, name: string) => (deep ? set : easy).add(name);
        for (const sec of st.sections) {
          put(sec.level === "detail", sec.title);
          for (const a of sec.actions) put(sec.level === "detail" || a.level === "detail", a.label);
          for (const g of sec.groups) {
            const deep = sec.level === "detail" || g.level === "detail";
            for (const f of g.fields) put(deep || f.level === "detail", f.label);
            for (const a of g.actions) put(deep || a.level === "detail", a.label);
          }
        }
      }
    }
    for (const s of STAGE_ORDER) {
      // FP顧問料は前提条件のパネルの中の区画なので、前提条件の欄で確かめる
      const at = s.id === "fee" ? "assumptions" : s.id;
      const set = [...(names.get(at) ?? [])];
      for (const [text, probe] of LEVEL_HELP[s.id].detail) expect(set.some((n) => n.includes(probe ?? text)), `${s.label}（詳細）: ${text}`).toBe(true);
      const easy = [...(simpleNames.get(at) ?? [])];
      for (const [text, probe] of LEVEL_HELP[s.id].simple) expect(easy.some((n) => n.includes(probe ?? text)), `${s.label}（標準）: ${text}`).toBe(true);
    }
  });
});

describe("相続・贈与のパネルの相続税の目安は、入れる区画の下", () => {
  // 目安は計算の結果から読む（画面の外の文字列では出ない）ので、パネルの組み立ての順で確かめる
  const src = readFileSync(join(APP_DIR, "src", "workspace", "input", "InputPanel.tsx"), "utf8");
  it("目安の箱は見出しの帯（ip-head）ではなく本体（ip-body）の中で、入れる区画の後", () => {
    const head = src.indexOf('<div class="ip-head">');
    const body = src.indexOf('<div class="ip-body"');
    const sectionsAt = src.indexOf("{sections.map((s) => (", body);
    const box = src.indexOf("data-inheritance-line");
    const foot = src.indexOf('<div class="ip-foot"');
    expect(head).toBeGreaterThan(0);
    expect(sectionsAt).toBeGreaterThan(body);
    expect(box).toBeGreaterThan(sectionsAt);
    expect(box).toBeLessThan(foot);
    expect(src.indexOf("data-inheritance-line")).toBe(src.lastIndexOf("data-inheritance-line"));
  });
});
