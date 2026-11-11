// AI接続口のグラフ（connector/chart.ts。0202）の色が、画面の色の決め事（app.css）と同じこと: 文字・線・地の色（明るい画面と暗い画面）と、
// 全部のプランを重ねる表示の線の色（暗い画面の上書きも）。画面の色を直したら、グラフの色も一緒に直す
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { CHART_THEME } from "../src/connector/chart.ts";
import { PLAN_COLOR_DARK, PLAN_COLOR_STYLES } from "../src/presentation/planColors.ts";

const CSS = readFileSync(join(import.meta.dirname, "..", "src", "styles", "app.css"), "utf8");

/** 区切り（:root か html.dark）の中の CSS の変数 */
function vars(selector: ":root" | "html.dark"): Record<string, string> {
  const at = CSS.indexOf(`${selector} {`);
  const body = CSS.slice(at, CSS.indexOf("}", at));
  return Object.fromEntries([...body.matchAll(/--([a-z0-9-]+):\s*([^;]+);/g)].map((m) => [m[1] as string, (m[2] as string).trim()]));
}

describe("グラフの色は画面と同じ", () => {
  it("文字・線・地・不足の範囲の色", () => {
    for (const [theme, sel] of [["light", ":root"], ["dark", "html.dark"]] as const) {
      const v = vars(sel);
      const t = CHART_THEME[theme];
      expect({ card: t.card, ink: t.ink, ink2: t.ink2, line: t.line, line2: t.line2, shortBg: t.shortBg, shortInk: t.shortInk }, theme).toEqual({
        card: v.card,
        ink: v.ink,
        ink2: v["ink-2"],
        line: v.line,
        line2: v["line-2"],
        shortBg: v["short-bg"],
        shortInk: v["short-ink"],
      });
    }
  });

  it("線の色（暗い画面の上書きも）", () => {
    for (const { color } of PLAN_COLOR_STYLES) {
      const m = new RegExp(`html\\.dark \\[stroke="${color}"\\]:not\\(\\.tk \\*\\) \\{ stroke: (#[0-9a-f]{6}) !important; \\}`).exec(CSS);
      expect(m?.[1], color).toBe(PLAN_COLOR_DARK[color]);
    }
    expect(Object.keys(PLAN_COLOR_DARK)).toHaveLength(PLAN_COLOR_STYLES.length);
  });
});
