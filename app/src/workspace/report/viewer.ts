// 提案書の見本の画面の計算（画面の DOM に依らない部分）: 拡大・縮小の倍率、ページを先に読む順、見本の SVG の要素と属性の許可。
// 倍率は「1pt あたりの CSS の画素」で持ち、表示は実寸（1pt = 96/72 CSS px）を 100% とする

/** 実寸（100%）の倍率: 1pt あたりの CSS の画素 */
export const ACTUAL = 96 / 72;

/** ＋／− で進む倍率の刻み（実寸に対する割合） */
export const ZOOM_STEPS = [0.25, 0.33, 0.5, 0.67, 0.75, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3, 4] as const;
const FIRST_STEP = 0.25;
const LAST_STEP = 4;
export const MIN_ZOOM = FIRST_STEP * ACTUAL;
export const MAX_ZOOM = LAST_STEP * ACTUAL;

/** 拡大・縮小の決め方: ページ全体（窓に収める・既定）／幅に合わせる／倍率を指定 */
export type Zoom = { mode: "page" } | { mode: "width" } | { mode: "custom"; scale: number };

/** ページの周りの余白（CSS px） */
export const VIEW_PAD = 12;

const clamp = (v: number) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, v));

/**
 * 見本の倍率（1pt あたりの CSS px）。view: 見本の枠の内側の大きさ（CSS px）、page: ページの大きさ（pt）
 * 「ページ全体」は縦も横も収まる倍率、「幅に合わせる」は横幅が収まる倍率（縦はスクロール）
 */
export function scaleOf(zoom: Zoom, view: readonly [number, number], page: readonly [number, number]): number {
  const [vw, vh] = view;
  const [pw, ph] = page;
  if (zoom.mode === "custom") return clamp(zoom.scale);
  if (pw <= 0 || ph <= 0 || vw <= 0 || vh <= 0) return ACTUAL;
  const byWidth = (vw - 2 * VIEW_PAD) / pw;
  if (zoom.mode === "width") return clamp(byWidth);
  return clamp(Math.min(byWidth, (vh - 2 * VIEW_PAD) / ph));
}

/** 倍率の表示（実寸を 100% とした整数の %） */
export const percentOf = (scale: number): number => Math.round((scale / ACTUAL) * 100);

/** ＋（dir = 1）・−（dir = -1）: 今の倍率の次の刻みへ */
export function stepZoom(scale: number, dir: 1 | -1): number {
  const r = scale / ACTUAL;
  const eps = 0.005;
  if (dir > 0) return clamp((ZOOM_STEPS.find((s) => s > r + eps) ?? LAST_STEP) * ACTUAL);
  return clamp(([...ZOOM_STEPS].reverse().find((s) => s < r - eps) ?? FIRST_STEP) * ACTUAL);
}

/** Ctrl/⌘＋ホイール: 回した量に応じてなめらかに拡大・縮小する */
export const wheelZoom = (scale: number, deltaY: number): number => clamp(scale * Math.exp(-deltaY * 0.002));

/**
 * ページを先に読む順: 表示中のページ → 次のページ → 前のページ → 近い順。読み終えたページ（done）は除く
 */
export function prefetchOrder(current: number, pages: number, done: ReadonlySet<number>): number[] {
  const out: number[] = [];
  const push = (i: number) => {
    if (i >= 0 && i < pages && !done.has(i) && !out.includes(i)) out.push(i);
  };
  push(current);
  for (let d = 1; d < pages; d++) {
    push(current + d);
    push(current - d);
  }
  return out;
}

// ---- 見本の SVG の要素と属性の許可（本体が作った SVG でも、画面に入れる前に確かめる。0016 の1）----

/** 残す要素（Typst の SVG が使うもの） */
const ALLOWED_TAGS = new Set(["svg", "g", "path", "use", "defs", "symbol", "clippath", "lineargradient", "radialgradient", "stop", "pattern", "rect", "circle", "ellipse", "line", "polyline", "polygon", "mask", "title"]);

/** 要素を残すか（script・foreignObject・image・style・リンク（a）などは中身ごと捨てる） */
export const allowedSvgTag = (name: string): boolean => ALLOWED_TAGS.has(name.toLowerCase());

/** 属性を残すか: on…（スクリプト）・style（CSP で止まる）と、文書の中の印（#…）でない参照は捨てる */
export function allowedSvgAttr(name: string, value: string): boolean {
  const n = name.toLowerCase();
  if (n.startsWith("on") || n === "style") return false;
  if (n === "href" || n === "xlink:href") return value.startsWith("#");
  if (/url\(\s*['"]?(?!#)/i.test(value)) return false;
  return true;
}
