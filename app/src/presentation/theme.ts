// 事務所の見た目の色（0121。提示層の部品。画面・持ち帰り用のレポートの両方で使う）:
// 基調の色1つから、画面の色の決め事（CSS の変数）の --prop・--prop-ink・--prop-bg を、明るい画面と暗い画面の分だけ導く。
// - 文字と背景の見やすさ（WCAG のコントラスト比）が足りない色は、色相と彩度を保って明るさだけを直す（OKLCH の L を動かす）:
//   明るい画面は白地で 4.5:1 以上（白抜きの文字も同じ比）、暗い画面はカードの地で 5.5:1 以上（暗い文字を重ねても同じ比）。
// - 意味を持つ色（不足の赤・注意〔推定〕の橙・現状の灰）と紛れる色は使わない（直さずに断る。見分けは OKLab の距離と彩度で決める）。
//   「済み」の緑に近い色は使えるが、知らせを出す（✓ の印で見分けられる）。
// - 意味を持つ色そのもの（不足・注意・済み・グラフの複数のプランの色）は変えない（app.css の値のまま。暗い画面の値も app.css）。
// 色の計算は浮動小数点だが、画面の見た目だけに使う（計算の結果には入らない）

/** 標準の基調の色（ファイナンシアの藍。app.css の --prop と同じ） */
export const STANDARD_BASE = "#2b4c8c";

/** 選びやすい色の見本（落ち着いた色。どれも下の確かめを通る） */
export const BASE_SAMPLES: readonly { color: string; name: string }[] = [
  { color: STANDARD_BASE, name: "藍" },
  { color: "#24606b", name: "青緑" },
  { color: "#2d5a46", name: "緑" },
  { color: "#5c4033", name: "茶" },
  { color: "#7a2a4f", name: "えんじ" },
  { color: "#4a3b72", name: "紫" },
];

/** 明るい画面の白地・暗い画面のカードの地（app.css の --card と同じ） */
export const LIGHT_CARD = "#ffffff";
export const DARK_CARD = "#1f2329";
/** 暗い画面で、塗った所に重ねる文字の色（app.css の暗い画面の --on-fill と同じ） */
export const DARK_ON_FILL = "#14171b";

/** 意味を持つ色（app.css の明るい画面の値）。基調の色がこれらに近いと断る */
const SHORT = ["#c62828", "#a61b1b"];
const EST = ["#b36b00", "#7a4800"];
const GOOD = "#1b6b45";
/** 近すぎるとみなす OKLab の距離（不足の赤・注意の橙・済みの緑） */
const NEAR_SHORT = 0.09;
const NEAR_EST = 0.06;
const NEAR_GOOD = 0.05;
/** これより彩度の低い色は、現状のプランの灰と見分けにくい */
const MIN_CHROMA = 0.03;
/** これより暗い色は、文字の黒と見分けにくいので少し明るくする（OKLCH の L） */
const MIN_L = 0.3;
/** 見やすさの目標（文字の WCAG AA） */
export const MIN_CONTRAST = 4.5;
/** 暗い画面の基調の色の目標（暗い地では同じ比でも沈んで見えるので、少し上げる） */
export const DARK_CONTRAST = 5.5;

type Rgb = [number, number, number];

/** `#rrggbb`（大文字・3桁も読む）を小文字の6桁に。読めなければ null */
export function normalizeHex(s: string): string | null {
  const t = s.trim().toLowerCase();
  const m6 = /^#([0-9a-f]{6})$/.exec(t);
  if (m6 !== null) return t;
  const m3 = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/.exec(t);
  if (m3 !== null) return `#${m3[1]}${m3[1]}${m3[2]}${m3[2]}${m3[3]}${m3[3]}`;
  return null;
}

const rgbOf = (hex: string): Rgb => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255) as Rgb;
const hexOf = (c: Rgb): string => `#${c.map((v) => Math.round(Math.min(1, Math.max(0, v)) * 255).toString(16).padStart(2, "0")).join("")}`;
const toLin = (v: number) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
const fromLin = (v: number) => (v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055);

/** WCAG の相対輝度 */
export function luminance(hex: string): number {
  const [r, g, b] = rgbOf(hex).map(toLin) as Rgb;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG のコントラスト比 */
export function contrast(a: string, b: string): number {
  const x = luminance(a);
  const y = luminance(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

/** sRGB → OKLab */
function oklab(hex: string): Rgb {
  const [r, g, b] = rgbOf(hex).map(toLin) as Rgb;
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s, 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s, 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s];
}

/** OKLab → sRGB（範囲の外も返す） */
function fromOklab([L, a, b]: Rgb): Rgb {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [fromLin(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s), fromLin(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s), fromLin(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s)];
}

/** OKLCH（L・C・色相の度） */
export function oklch(hex: string): { l: number; c: number; h: number } {
  const [L, a, b] = oklab(hex);
  return { l: L, c: Math.hypot(a, b), h: ((Math.atan2(b, a) * 180) / Math.PI + 360) % 360 };
}

/** OKLCH から `#rrggbb`。sRGB に入らないときは彩度を下げて入れる */
export function fromOklch(l: number, c: number, h: number): string {
  const rad = (h * Math.PI) / 180;
  let lo = 0;
  let hi = c;
  const at = (cc: number): Rgb => fromOklab([l, cc * Math.cos(rad), cc * Math.sin(rad)]);
  const inGamut = (x: Rgb) => x.every((v) => v >= -1e-4 && v <= 1 + 1e-4);
  if (inGamut(at(c))) return hexOf(at(c));
  for (let i = 0; i < 24; i++) {
    const mid = (lo + hi) / 2;
    if (inGamut(at(mid))) lo = mid;
    else hi = mid;
  }
  return hexOf(at(lo));
}

/** OKLab の距離 */
export function distance(a: string, b: string): number {
  const x = oklab(a);
  const y = oklab(b);
  return Math.hypot(x[0] - y[0], x[1] - y[1], x[2] - y[2]);
}

/**
 * 地 `ground` との比が `target` 以上になるまで明るさだけを動かした色（darker: 暗くする向き）。
 * もう足りていればそのまま。動かしきっても足りなければ端の色
 */
function toContrast(hex: string, ground: string, target: number, darker: boolean): string {
  if (contrast(hex, ground) >= target) return hex;
  const { l, c, h } = oklch(hex);
  let ok = darker ? 0 : 1;
  let bad = l;
  for (let i = 0; i < 30; i++) {
    const mid = (ok + bad) / 2;
    if (contrast(fromOklch(mid, c, h), ground) >= target) ok = mid;
    else bad = mid;
  }
  return fromOklch(ok, c, h);
}

/** 基調の色の確かめの結果 */
export interface BaseCheck {
  /** 選んだ色（小文字の6桁） */
  base: string;
  /** 使えるか（意味を持つ色と紛れる・灰に近い色は使えない） */
  ok: boolean;
  /** 使えない理由（ok が false のとき） */
  refused: ("short" | "est" | "grey")[];
  /** 知らせ（使えるが、直した・似ている） */
  notes: ("darkened" | "lightened" | "good")[];
  /** 明るい画面の基調の色（白地で 4.5:1 以上に直した色）。提案書のアクセントの色にも使う */
  light: string;
  /** 暗い画面の基調の色（カードの地で 4.5:1 以上に直した色） */
  dark: string;
}

/** 基調の色を確かめて、明るい画面・暗い画面の色を導く */
export function checkBase(input: string): BaseCheck {
  const base = normalizeHex(input) ?? STANDARD_BASE;
  const refused: BaseCheck["refused"] = [];
  const notes: BaseCheck["notes"] = [];
  let light = toContrast(base, LIGHT_CARD, MIN_CONTRAST, true);
  if (light !== base) notes.push("darkened");
  const { l, c, h } = oklch(light);
  if (l < MIN_L) {
    light = fromOklch(MIN_L, c, h);
    // 明るくしても白地の比は足りる（L 0.3 は白地で 10:1 ほど）
    notes.push("lightened");
  }
  if (oklch(base).c < MIN_CHROMA) refused.push("grey");
  if (SHORT.some((x) => distance(light, x) < NEAR_SHORT)) refused.push("short");
  if (EST.some((x) => distance(light, x) < NEAR_EST)) refused.push("est");
  if (distance(light, GOOD) < NEAR_GOOD) notes.push("good");
  const dark = toContrast(toContrast(base, DARK_CARD, DARK_CONTRAST, false), DARK_ON_FILL, DARK_CONTRAST, false);
  return { base, ok: refused.length === 0, refused, notes, light, dark };
}

/** 確かめの結果の文（事務所の見た目の画面に出す） */
export function checkText(r: BaseCheck): string[] {
  const out: string[] = [];
  if (r.refused.includes("short")) out.push("不足の赤と見分けにくい色なので使えません。もう少し紫や茶に寄せた色にしてください。");
  if (r.refused.includes("est")) out.push("推定の印の橙と見分けにくい色なので使えません。もう少し赤や茶の濃い色にしてください。");
  if (r.refused.includes("grey")) out.push("灰色に近い色は、グラフの現状（灰色）と見分けにくいので使えません。");
  if (r.notes.includes("darkened")) out.push(`明るい色なので、文字が読めるように少し濃くして使います（${r.light}）。`);
  if (r.notes.includes("lightened")) out.push(`黒に近い色なので、文字の黒と見分けられるように少し明るくして使います（${r.light}）。`);
  if (r.notes.includes("good")) out.push("「済み」の印の緑と似た色です（✓ の印で見分けられます）。");
  return out;
}

/** 画面の色の決め事のうち、基調の色から導くもの（CSS の変数の名前 → 値） */
export function themeVars(base: string, mode: "light" | "dark"): Record<string, string> {
  const r = checkBase(base);
  const prop = mode === "light" ? r.light : r.dark;
  const { l, c, h } = oklch(prop);
  if (mode === "light") {
    return {
      "--prop": prop,
      // 文字に使う濃い方（--prop-bg の上でも 7:1 ほど）
      "--prop-ink": fromOklch(Math.max(0.2, l - 0.06), c, h),
      // 選んだ所などの薄い地
      "--prop-bg": fromOklch(0.955, Math.min(c * 0.2, 0.022), h),
    };
  }
  return {
    "--prop": prop,
    "--prop-ink": fromOklch(Math.min(0.92, l + 0.08), c, h),
    "--prop-bg": fromOklch(0.31, Math.min(c * 0.45, 0.05), h),
  };
}
