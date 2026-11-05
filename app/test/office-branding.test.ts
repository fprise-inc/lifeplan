// 事務所の見た目（0121）: 基調の色から色の決め事を導く・見やすさを直す・意味を持つ色と紛れる色を断る・読み書きの形・
// 左上のロゴと名前・画面の明るさ・提案書と持ち帰り用のレポートの色・CSS に直書きの白が残っていないこと
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { h } from "preact";
import { renderToString } from "preact-render-to-string";
import { BASE_SAMPLES, checkBase, contrast, DARK_CARD, DARK_CONTRAST, DARK_ON_FILL, MIN_CONTRAST, normalizeHex, STANDARD_BASE, themeVars } from "../src/presentation/theme.ts";
import { logoBox } from "../src/presentation/LogoCanvas.tsx";
import { applyLook, base64Of, brandOf, lookVars, readBranding, readLogoHeader, reportAccent, resolveMode, usesStandardColor } from "../src/workspace/office/branding.ts";
import { TopBar } from "../src/workspace/header/TopBar.tsx";
import { BrandingSection } from "../src/workspace/office/BrandingSection.tsx";

const png = (w: number, h: number) => {
  const b = new Uint8Array(33);
  b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]);
  new DataView(b.buffer).setUint32(16, w);
  new DataView(b.buffer).setUint32(20, h);
  return b;
};

describe("基調の色の確かめ（presentation/theme.ts）", () => {
  it("見本の色はどれも使え、明るい画面は白地で、暗い画面はカードの地で読める", () => {
    expect(BASE_SAMPLES[0]!.color).toBe(STANDARD_BASE);
    for (const s of BASE_SAMPLES) {
      const r = checkBase(s.color);
      expect(r.ok, s.name).toBe(true);
      expect(r.notes.filter((n) => n !== "good"), s.name).toEqual([]);
      expect(r.light, s.name).toBe(s.color);
      expect(contrast(r.light, "#ffffff")).toBeGreaterThanOrEqual(MIN_CONTRAST);
      expect(contrast(r.dark, DARK_CARD)).toBeGreaterThanOrEqual(DARK_CONTRAST - 0.01);
      expect(contrast(r.dark, DARK_ON_FILL)).toBeGreaterThanOrEqual(DARK_CONTRAST - 0.01);
    }
  });

  it("明るすぎる色は色相を保って濃くし、知らせる", () => {
    const r = checkBase("#9fc5e8");
    expect(r.ok).toBe(true);
    expect(r.notes).toContain("darkened");
    expect(contrast(r.light, "#ffffff")).toBeGreaterThanOrEqual(MIN_CONTRAST);
    expect(r.light).not.toBe("#9fc5e8");
  });

  it("不足の赤・推定の橙・灰に近い色は使えない（直さずに断る）", () => {
    expect(checkBase("#c00000").refused).toContain("short");
    expect(checkBase("#a61b1b").refused).toContain("short");
    expect(checkBase("#7a5230").refused).toContain("est");
    expect(checkBase("#888888").refused).toContain("grey");
    expect(checkBase("#111111").refused).toContain("grey");
    // えんじは不足の赤と見分けられる
    expect(checkBase("#7a2a4f").ok).toBe(true);
  });

  it("済みの緑に近い色は使えるが知らせる", () => {
    const r = checkBase("#1b6b45");
    expect(r.ok).toBe(true);
    expect(r.notes).toContain("good");
  });

  it("色の番号の形", () => {
    expect(normalizeHex("#2B4C8C")).toBe("#2b4c8c");
    expect(normalizeHex("#abc")).toBe("#aabbcc");
    expect(normalizeHex("blue")).toBeNull();
  });

  it("app.css の暗い画面の藍は、標準の色から導いた値と同じ", () => {
    const css = readFileSync(join(__dirname, "../src/styles/app.css"), "utf8");
    const dark = /html\.dark \{([\s\S]*?)\n\}/.exec(css)![1]!;
    const v = themeVars(STANDARD_BASE, "dark");
    expect(dark).toContain(`--prop: ${v["--prop"]};`);
    expect(dark).toContain(`--prop-ink: ${v["--prop-ink"]};`);
    expect(dark).toContain(`--prop-bg: ${v["--prop-bg"]};`);
  });
});

describe("事務所の見た目の読み書きと当て方（office/branding.ts）", () => {
  it("読めない欄は無し・色は小文字", () => {
    expect(readBranding(null)).toEqual({});
    expect(readBranding({ name: "  みどりFP事務所 ", color: "#2D5A46", appearance: "dark", logo: { mime: "image/gif", width: 1, height: 1, data: "x" } })).toEqual({ name: "みどりFP事務所", color: "#2d5a46", appearance: "dark" });
    expect(readBranding({ appearance: "sepia", color: "green" })).toEqual({});
  });

  it("標準の色・使えない色は何も上書きしない（app.css のまま）。ほかの色は --prop などを上書きする", () => {
    expect(lookVars({}, "light")).toEqual({});
    expect(lookVars({ color: STANDARD_BASE }, "dark")).toEqual({});
    expect(usesStandardColor({ color: "#c00000" })).toBe(true);
    expect(Object.keys(lookVars({ color: "#2d5a46" }, "light"))).toEqual(["--prop", "--prop-ink", "--prop-bg"]);
    expect(lookVars({ color: "#2d5a46" }, "light")["--prop"]).toBe("#2d5a46");
  });

  it("画面の明るさ: OS に合わせるは OS の設定、明るい・暗いはそのまま", () => {
    expect(resolveMode(undefined, true)).toBe("dark");
    expect(resolveMode("system", false)).toBe("light");
    expect(resolveMode("light", true)).toBe("light");
    expect(resolveMode("dark", false)).toBe("dark");
  });

  it("html の class と変数に当て、標準に戻すと変数を外す", () => {
    const vars = new Map<string, string>();
    const cls = new Set<string>();
    const root = {
      classList: { toggle: (c: string, on: boolean) => (on ? cls.add(c) : cls.delete(c)) },
      style: { setProperty: (k: string, v: string) => vars.set(k, v), removeProperty: (k: string) => vars.delete(k) },
    } as unknown as HTMLElement;
    applyLook(root, { color: "#7a2a4f" }, "dark");
    expect(cls.has("dark")).toBe(true);
    expect(vars.get("--prop")).toBe(checkBase("#7a2a4f").dark);
    applyLook(root, {}, "light");
    expect(cls.has("dark")).toBe(false);
    expect(vars.size).toBe(0);
  });

  it("提案書・持ち帰り用のレポートの色は明るい画面の色（標準なら null＝帳票の標準の色）", () => {
    expect(reportAccent({})).toBeNull();
    expect(reportAccent({ color: STANDARD_BASE })).toBeNull();
    expect(reportAccent({ color: "#9fc5e8" })).toBe(checkBase("#9fc5e8").light);
    expect(reportAccent({ color: "#c00000" })).toBeNull();
  });

  it("ロゴの画像の見出し（本体と同じ決まり）: PNG・JPEG だけ、小さすぎ・大きすぎは断る", () => {
    expect(readLogoHeader(png(320, 80))).toEqual({ mime: "image/png", width: 320, height: 80 });
    const jpg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 4, 0, 0, 0xff, 0xc0, 0, 11, 8, 0, 120, 1, 144, 1, 1, 0x11, 0, 0xff, 0xd9]);
    expect(readLogoHeader(jpg)).toEqual({ mime: "image/jpeg", width: 400, height: 120 });
    expect(readLogoHeader(new TextEncoder().encode("<svg xmlns='http://www.w3.org/2000/svg'/>"))).toBe("E_STORE_LOGO");
    expect(readLogoHeader(png(4, 4))).toBe("E_STORE_LOGO");
    expect(readLogoHeader(png(5000, 100))).toBe("E_STORE_LOGO_TOO_LARGE");
    expect(base64Of(new Uint8Array([1, 2, 3]))).toBe("AQID");
  });

  it("ロゴの表示の大きさ: 高さをそろえ、横に長いロゴは幅の上限まで縮める", () => {
    expect(logoBox({ width: 128, height: 128 }, 24, 132)).toEqual({ w: 24, h: 24 });
    expect(logoBox({ width: 1000, height: 100 }, 24, 132)).toEqual({ w: 132, h: 13 });
  });
});

describe("左上のロゴと名前（header/TopBar.tsx）", () => {
  const base = { tabs: [{ id: "a" as const, label: "結果" }], tab: "a" as const, onTab: () => undefined, household: null, alerts: [], notices: { items: [], onRead: () => undefined, onFeedback: () => undefined, focus: null }, tools: null, big: false, onBig: () => undefined };
  const logo = { mime: "image/png", width: 120, height: 40, data: base64Of(png(120, 40)) };
  it("事務所の見た目が無ければ今のまま「ファイナンシア」", () => {
    const html = renderToString(h(TopBar, { ...base, brand: brandOf({}) }));
    expect(html).toContain("brand-mark");
    expect(html).toContain(">ファイナンシア<");
  });
  it("名前だけなら名前、ロゴがあればキャンバスに描く（img は使わない）。ソフトの名前はかざしたときの説明に残す", () => {
    const named = renderToString(h(TopBar, { ...base, brand: brandOf({ name: "みどりFP事務所" }) }));
    expect(named).toContain(">みどりFP事務所<");
    expect(named).not.toContain("brand-mark");
    expect(named).toContain('title="みどりFP事務所（ファイナンシア）"');
    const both = renderToString(h(TopBar, { ...base, brand: brandOf({ name: "みどりFP事務所", logo: { ...logo, mime: "image/png" } }) }));
    expect(both).toContain("<canvas");
    expect(both).toContain('aria-label="みどりFP事務所"');
    expect(both).not.toContain("<img");
    const only = renderToString(h(TopBar, { ...base, brand: brandOf({ logo: { ...logo, mime: "image/png" } }) }));
    expect(only).toContain("<canvas");
    expect(only).not.toContain("brand-name");
  });
  it("画面の明るさのボタン（選ぶ物を渡したときだけ）", () => {
    expect(renderToString(h(TopBar, base))).not.toContain("data-look-pick");
    const html = renderToString(h(TopBar, { ...base, appearance: "dark", onAppearance: () => undefined }));
    expect(html).toContain('aria-label="画面の明るさ（暗い）"');
  });
});

describe("事務所の既定値のパネルの区画「事務所の見た目」", () => {
  it("見本の色・自由な色・ロゴを選ぶ・使えない色の知らせ", () => {
    const props = { onPreview: () => undefined, onSave: async () => ({}), onPickLogo: async () => null, shared: true };
    const html = renderToString(h(BrandingSection, { ...props, value: {} }));
    for (const s of BASE_SAMPLES) expect(html).toContain(`data-branding-color="${s.color}"`);
    expect(html).toContain("data-branding-color-free");
    expect(html).toContain("data-branding-logo-pick");
    expect(html).toContain("事務所で共有していても、この PC の設定です。");
    const bad = renderToString(h(BrandingSection, { ...props, value: { color: "#c00000" } }));
    expect(bad).toContain('data-branding-notes="refused"');
    expect(bad).toContain("不足の赤と見分けにくい");
  });
});

describe("CSS の色（暗い画面）", () => {
  it("塗りと文字の白は色の決め事（--card・--on-fill）にしてある（暗い画面で入れ替わる）", () => {
    const dir = join(__dirname, "../src/styles");
    for (const f of readdirSync(dir).filter((x) => x.endsWith(".css"))) {
      const css = readFileSync(join(dir, f), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
      expect(css, f).not.toMatch(/(?<![-\w])(background|color|fill|stroke|border[a-z-]*)\s*:[^;{}]*#fff\b/);
    }
  });
});
