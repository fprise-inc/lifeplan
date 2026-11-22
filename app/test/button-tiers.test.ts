// ボタンは4段 × 大きさ2つ、選んでいる状態は藍（0240）。見た目（CSS とクラス名）だけの決まりなので、CSS の決まりの行とクラス名を読んで確かめる。
// - 段と大きさを決める行は app.css の1か所だけ。場所ごとの余白・文字の大きさ・押せないときの見た目の上書きが増えていない
// - 小さいボタンの名前は .small だけ（.sm は使わない）。小の大きさは、欄のまわりの「＋ 〜」（.add-btn）と同じ
// - 選んでいる・押し込んでいる・開いている状態を、墨の塗り・墨の枠で見せる所が増えていない
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const src = join(dirname(fileURLToPath(import.meta.url)), "..", "src");
const styles = join(src, "styles");
/** アプリの画面と持ち帰り用のレポートの CSS（お客さまのヒアリングのページ hearingForm は別の画面なので見ない） */
const files = [...readdirSync(styles).filter((f) => f.endsWith(".css")).map((f) => join(styles, f)), join(src, "takeaway", "takeaway.css")];
const app = readFileSync(join(styles, "app.css"), "utf8");

interface Rule {
  file: string;
  selector: string;
  body: string;
}
/** 1行に1つの決まり（`セレクタ { 中身 }`）を全部読む（@media の中の字下げした行も） */
const rules: Rule[] = files.flatMap((file) =>
  readFileSync(file, "utf8")
    .split("\n")
    .flatMap((l) => {
      const m = /^\s*([^{}@/][^{}]*?)\s*\{([^{}]*)\}\s*$/.exec(l);
      return m === null ? [] : [{ file: file.slice(src.length + 1), selector: m[1] ?? "", body: m[2] ?? "" }];
    }),
);
const rule = (selector: string): string => {
  const hit = rules.filter((r) => r.file === join("styles", "app.css") && r.selector === selector);
  if (hit.length !== 1) throw new Error(`決まりが1つではありません（${hit.length}）: ${selector}`);
  return hit[0]?.body ?? "";
};
/** セレクタの指す先（カンマで分けたそれぞれの、最後のひとかたまり。`:not(…)` の中は見ない） */
const subjects = (selector: string) => selector.split(",").map((part) => (part.trim().split(/[\s>+~]+/).at(-1) ?? "").replace(/:not\([^)]*\)/g, ""));
/** セレクタが .btn（.add-btn・.link-btn などの別の名前でなく）を指しているか */
const onBtn = (selector: string) => subjects(selector).some((s) => /\.btn(?![\w-])/.test(s));
const onLink = (selector: string) => subjects(selector).some((s) => /\.link-btn(?![\w-])/.test(s));

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? sources(join(dir, e.name)) : /\.tsx?$/.test(e.name) ? [join(dir, e.name)] : []));
}

describe("ボタンは4段（主・ふつう・控えめ・危ない）", () => {
  it("主は藍の塗り、ふつうは白地に藍の枠と藍の文字、危ないは赤い文字、控えめは下線のリンク", () => {
    expect(rule(".btn.primary")).toContain("background: var(--prop)");
    expect(rule(".btn.primary")).toContain("color: var(--on-fill)");
    expect(rule(".btn")).toContain("border: 2px solid var(--prop)");
    expect(rule(".btn")).toContain("background: var(--card)");
    expect(rule(".btn")).toContain("color: var(--prop-ink)");
    expect(rule(".btn.danger")).toContain("color: var(--short-ink)");
    expect(rule(".link-btn.danger")).toContain("color: var(--short-ink)");
    expect(rule(".link-btn")).toContain("text-decoration: underline");
    expect(rule(".link-btn")).toContain("border: 0");
  });

  it("段を決める行は1か所だけ（.link-btn を2回定義しない）", () => {
    for (const selector of [".btn", ".btn.primary", ".btn.danger", ".btn.small", ".link-btn", ".link-btn.danger"]) expect(rules.filter((r) => r.selector === selector).map((r) => r.file), selector).toEqual([join("styles", "app.css")]);
  });

  it("欄のまわりの「＋ 〜」（.add-btn）も、ふつうの段と同じ色（藍の枠・藍の文字・重ねると薄い藍）", () => {
    expect(rule(".add-btn")).toContain("border: 1.5px solid var(--prop)");
    expect(rule(".add-btn")).toContain("color: var(--prop-ink)");
    expect(rule(".add-btn:hover")).toBe(rule(".btn:hover"));
  });
});

describe("ボタンの大きさは2つ（ふつう・小）", () => {
  const decl = (body: string, name: string) => new RegExp(`(^|;)\\s*${name}:\\s*([^;]+)`).exec(body)?.[2]?.trim();

  it("ふつうは今までの大きさのまま（パネルの足元の「キャンセル／保存」）", () => {
    expect(decl(rule(".btn"), "padding")).toBe("8px 18px");
    expect(decl(rule(".btn.primary"), "padding")).toBe("8px 28px");
    expect(decl(rule(".btn"), "font-size")).toBeUndefined();
  });

  it("小（.small）は、欄のまわりの「＋ 〜」（.add-btn）と同じ余白・文字の大きさ・線の太さ", () => {
    const small = rule(".btn.small");
    const add = rule(".add-btn");
    expect(decl(small, "padding")).toBe(decl(add, "padding"));
    expect(decl(small, "font-size")).toBe(decl(add, "font-size"));
    expect(decl(small, "border-width")).toBe("1.5px");
    // 小は主より後ろに書く（主の広い余白より小の余白が勝つ）
    expect(app.indexOf("\n.btn.small {")).toBeGreaterThan(app.indexOf("\n.btn.primary {"));
  });

  it("場所ごとに余白・文字の大きさ・線の太さを上書きしない（中身が2行の「選ぶための大きなボタン」だけ別）", () => {
    const sized = rules.filter((r) => onBtn(r.selector) && /(^|;)\s*(padding|padding-(top|right|bottom|left|inline|block)|font-size|border-width|border|line-height|height|min-height):/.test(r.body)).map((r) => r.selector);
    expect(sized.sort()).toEqual([".btn", ".btn.primary", ".btn.small", ".fork-choices .btn"]);
  });

  it("小さいボタンの名前は .small だけ（.sm は使わない）", () => {
    expect(rules.filter((r) => /\.btn[\w.-]*\.sm(?![\w-])/.test(r.selector)).map((r) => r.selector)).toEqual([]);
    const bad = sources(src).filter((f) => /class=(["{`])[^"}]*\bbtn\b[^"}]*\bsm\b/.test(readFileSync(f, "utf8")));
    expect(bad).toEqual([]);
  });
});

describe("押せないボタンは、どの段・どの画面でも同じ見た目", () => {
  it("地・枠・文字を灰にする（透かして薄くしない）", () => {
    const off = rule(".btn:disabled, .btn:disabled:hover");
    expect(off).toContain("background: var(--base-bg)");
    expect(off).toContain("border-color: var(--line)");
    expect(off).toContain("color: var(--field)");
    expect(off).toContain("cursor: not-allowed");
    expect(off).not.toContain("opacity");
    // 欄のまわりの「＋ 〜」も同じ
    expect(rule(".add-btn:disabled, .add-btn:disabled:hover")).toBe(off);
  });

  it("押せないときの決まりは、主・危ない・小・選んでいる状態より後ろに書く（どの段でも灰が勝つ）", () => {
    const at = (selector: string) => app.indexOf(`\n${selector} {`);
    const off = at(".btn:disabled, .btn:disabled:hover");
    for (const selector of [".btn.primary", ".btn.primary:hover", ".btn.danger", ".btn.danger:hover", ".btn.small", '.btn.on, .btn.on:hover, .btn[aria-pressed="true"], .btn[aria-pressed="true"]:hover']) {
      expect(at(selector), selector).toBeGreaterThan(-1);
      expect(off, selector).toBeGreaterThan(at(selector));
    }
  });

  it("押せないときの見た目を、場所ごとに決めない（.btn と .link-btn）", () => {
    const off = rules.filter((r) => (onBtn(r.selector) || onLink(r.selector)) && r.selector.includes(":disabled")).map((r) => r.selector);
    expect(off.sort()).toEqual([".btn:disabled, .btn:disabled:hover", ".link-btn:disabled"]);
  });
});

describe("選んでいる・押し込んでいる・開いている状態は藍（墨で塗らない）", () => {
  /** 選んでいる・押し込んでいる・開いている状態を指すセレクタ */
  const active = (selector: string) => /\.on(?![\w-])|aria-(pressed|expanded|checked|selected)="true"/.test(selector);

  it("藍の塗りにそろえた部品（選んでいる方が藍の塗り・塗った上の文字の色）", () => {
    for (const selector of [
      '.btn.on, .btn.on:hover, .btn[aria-pressed="true"], .btn[aria-pressed="true"]:hover',
      '.add-btn[aria-pressed="true"], .add-btn[aria-pressed="true"]:hover',
      '.set-btn[aria-expanded="true"]',
      '.explain-btn[aria-pressed="true"]',
      '.pip-btn[aria-pressed="true"]',
      '.tg button[aria-pressed="true"], .tg button[aria-pressed="true"]:hover',
      ".ys-btn.on",
      '.fpm-btn[aria-expanded="true"]',
      '.bell-btn.quiet[aria-expanded="true"]',
      ".nc-tabs button.on, .nc-tabs button.on:hover",
      '.fs-opt[aria-checked="true"]',
      '.bs-vbtn[aria-pressed="true"], .bs-vbtn[aria-pressed="true"]:hover',
      '.jb[aria-pressed="true"], .jb[aria-pressed="true"]:hover',
      ".stress-btn.on",
      ".tag-filter button.on",
    ]) {
      const hit = rules.filter((r) => r.selector === selector);
      expect(hit.length, selector).toBe(1);
      expect(hit[0]?.body, selector).toContain("background: var(--prop)");
      expect(hit[0]?.body, selector).toContain("color: var(--on-fill)");
    }
  });

  it("並んだ中から1つ選ぶ切り替えは、選んでいない方も藍の文字・枠も藍", () => {
    const body = (selector: string) => rules.find((r) => r.selector === selector)?.body ?? "";
    for (const selector of [".nc-tabs button", ".tg button", ".bs-vbtn", ".jb", ".fs-opt"]) expect(body(selector), selector).toContain("color: var(--prop-ink)");
    for (const selector of [".nc-tabs", ".tg", ".bs-vbtn", ".jb", ".fs-opt"]) expect(body(selector), selector).toMatch(/border: (2|1\.5)px solid var\(--prop\)/);
  });

  it("いくつも選べる絞り込みの印（見本の棚の特徴）は、藍の枠と薄い藍の地", () => {
    const body = rules.find((r) => r.selector === ".hh-trait.on")?.body ?? "";
    expect(body).toContain("border-color: var(--prop)");
    expect(body).toContain("background: var(--prop-bg)");
  });

  it("選んでいる状態を墨の塗り・墨の枠で見せる所は、決めて残した4つだけ", () => {
    const ink = rules.filter((r) => active(r.selector) && /(background|border|border-color|box-shadow):[^;]*var\(--(ink|ink-2|sel)\)/.test(r.body)).map((r) => r.selector);
    // お知らせの種類の絞り込み（種類の色の見直しと一緒に決める）・色の見本（見本の色と混ざらないよう墨の輪）・
    // グラフのプランの線の見出し（マウスを乗せた線の強調）・グラフの年の印（選んでいる年。線の色〔藍〕と混ざらないよう墨）
    expect(ink.sort()).toEqual([".chip.on", ".ml-item:hover, .ml-item.on", ".nc-cat-pick.on", '.os-swatch[aria-checked="true"]']);
  });
});
