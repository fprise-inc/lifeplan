// AI接続口（crates/lifeplan）に同梱する、比べた答えのグラフ（0203）。比べる道具（compare）と同じ道で計算した通りごとの数字から、
// 画面のグラフと同じ見た目の SVG を作る:
// - 座標と目盛りは画面のグラフと同じ関数（presentation/chart.ts の FRAME・domainOf・scaleOf・linePath・spreadX）、線の色は画面の
//   全部のプランを重ねる表示と同じ色（presentation/planColors.ts。暗い画面の色も同じ）、文字・線の色と大きさは画面の色の決め事（app.css）と同じ
//   （app/test/chart-colors.test.ts で確かめる）。線は実線、線の端に丸と通りの文字（A・B…）を置く（色だけに頼らない。画面と同じ）
// - 必ず入れる物: 題・凡例（通りの文字と名前）・単位（万円）・前提の短い注（金利の見込み・物価・運用利回り・相場の想定）・試算の旨と出典
// - お客さまの名前・物の ID は入れない（受け取るのは通りの名前と数字と本人の年齢だけ。家族の呼び方も入れない）
// - 住宅ローンの利息の推移（interest）と金利の推移（rate）のグラフも作れる（0204）。金利は縦の目盛りを % にする（ほかは万円）
// - 外へは何も送らない。接続口が PNG にするときは、同梱の字体（BIZ UDゴシック）だけで描く
// - 画面の部品（preact）・本体の命令は読まない（lint とまとめる道具が止める）。結果が OS で変わる Math の関数は使わない
import { domainOf, FRAME, linePath, scaleOf, spreadX, type Frame, type Scale } from "../presentation/chart.ts";
import { group, man } from "../presentation/format.ts";
import { colorStyle, PLAN_COLOR_DARK } from "../presentation/planColors.ts";
import { mulRate, pctText } from "../workspace/plans/decimal.ts";

/**
 * グラフの種類: 金融資産の推移（折れ線）・住宅ローンの返済額の推移（折れ線）・主な数字の比べ（棒）・住宅ローンの利息の推移（折れ線。年額）・
 * 住宅ローンの金利の推移（折れ線。その年の最後の返済に当てた金利。0204）
 */
export type ChartKind = "assets" | "repayment" | "keyFigures" | "interest" | "rate";
export const CHART_KINDS: readonly ChartKind[] = ["assets", "repayment", "keyFigures", "interest", "rate"];

/** 主な数字の比べで選べる数字（compare の keyFigures の項目） */
export type FigureKey = "assetsAtAge" | "minimum" | "loanRepayment" | "loanInterest" | "lifetimeTakeHome" | "lifetimeExpense";
export const FIGURE_KEYS: readonly FigureKey[] = ["assetsAtAge", "minimum", "loanRepayment", "loanInterest", "lifetimeTakeHome", "lifetimeExpense"];
/** 主な数字の比べの既定の数字 */
export const DEFAULT_FIGURES: readonly FigureKey[] = ["assetsAtAge", "minimum", "loanRepayment"];

/** 通り1つ（接続口が compare の答えから渡す。名前と数字だけ） */
export interface ChartVariant {
  label: string;
  /** 年ごとの数字（compare の series と同じ。金融資産・住宅ローンの返済・利息・金利〔10進の文字〕） */
  series: { year: number; financialAssets?: number; loanRepayment?: number; loanInterest?: number; loanRate?: string }[];
  keyFigures: {
    assetsAtAge?: { age: number; amount: number }[];
    minimum?: { year: number; amount: number };
    loanRepayment?: number;
    loanInterest?: number;
    lifetimeTakeHome?: number;
    lifetimeExpense?: number;
  };
  /** 当てたプランの変更（compare の planChanges。項目の名前と後の値の文） */
  planChanges?: { label: string; to: string }[];
  /** 計算の前提（当てた後の要求の assumptions のうち、物価と運用利回り） */
  assumptions?: { inflation?: { default: string; byYear?: Record<string, string> }; investmentReturn?: { default: string; byYear?: Record<string, string> } };
  /** 重ねた相場の想定・ストレステストの文 */
  stress?: string;
}

export interface ChartArgs {
  kind: ChartKind;
  theme?: "light" | "dark";
  /** 題（省くと種類ごとの既定） */
  title?: string;
  /** 計算基準月（試算の時点の文） */
  baseMonth: string;
  variants: ChartVariant[];
  /** 年ごとの本人の年齢（基本の通り。年の目盛りの下に出す） */
  selfAges?: Record<string, number>;
  /** 主な数字の比べの数字（既定 DEFAULT_FIGURES） */
  figures?: FigureKey[];
}

export interface ChartOut {
  status: "ok" | "invalid";
  svg?: string;
  title?: string;
  /** 画像の説明（読み上げ・代わりの文） */
  alt?: string;
  width?: number;
  height?: number;
  reason?: string;
}

/** 文字と線の色（画面の色の決め事 app.css の --card・--ink・--ink-2・--line・--line-2・--short-bg・--short-ink。明るい画面と暗い画面） */
export const CHART_THEME = {
  light: { card: "#ffffff", ink: "#1a1d21", ink2: "#3c4450", line: "#cfd4db", line2: "#e3e6ea", shortBg: "#fdecea", shortInk: "#a61b1b" },
  dark: { card: "#1f2329", ink: "#e6e8eb", ink2: "#b9c0c9", line: "#4b535e", line2: "#363c45", shortBg: "#3d2423", shortInk: "#ff8f89" },
} as const;

/** 字体（画面の --font と同じ並び。接続口が PNG にするときは、同梱の BIZ UDゴシックで描く） */
export const CHART_FONT = `"BIZ UDPGothic", "BIZ UDGothic", "Hiragino Sans", "Yu Gothic UI", Meiryo, sans-serif`;

/** 画像の幅（画面のグラフの枠 FRAME と同じ） */
const W = FRAME.width;
const PAD = 16;
/** 線の端の文字を置く分だけ、右の余白を画面の枠より広げる */
const PLOT: Frame = { ...FRAME, right: 44, bottom: 56 };
/** 文字の大きさ（画面の .chart .axis-label 12px・.unit 12px・.ml-end 0.8rem） */
const FS = { title: 19, legend: 13, axis: 12, sub: 11, unit: 12, end: 12.8, note: 11, value: 11 };

const esc = (s: string): string => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const fx = (n: number): string => n.toFixed(1);
/** 通りの文字（A・B…。画面のプランの文字と同じ書き方） */
export const letterOf = (i: number): string => String.fromCharCode(65 + i);

/** 文字の幅の目安（全角は1字、半角は約0.55字。字体の寸法を読めないので、折り返しと置き場所だけに使う） */
export function textWidth(s: string, size: number): number {
  let w = 0;
  for (const ch of s) w += (ch.codePointAt(0) ?? 0) < 0x2000 ? 0.56 : 1;
  return w * size;
}

/** 幅に収まるように折り返す（句読点「・」「／」「、」の後と空白で切る。切れなければ字で切る） */
export function wrap(s: string, size: number, width: number): string[] {
  const out: string[] = [];
  let line = "";
  const tokens = s.match(/[^・／、。 ]+[・／、。 ]?|[・／、。 ]/g) ?? [s];
  for (const t of tokens) {
    if (textWidth(line + t, size) <= width) {
      line += t;
      continue;
    }
    if (line !== "") out.push(line.trimEnd());
    let rest = t;
    while (textWidth(rest, size) > width) {
      let k = rest.length;
      while (k > 1 && textWidth(rest.slice(0, k), size) > width) k--;
      out.push(rest.slice(0, k));
      rest = rest.slice(k);
    }
    line = rest;
  }
  if (line.trim() !== "") out.push(line.trimEnd());
  return out;
}

const DEFAULT_TITLE: Record<ChartKind, string> = {
  assets: "金融資産の推移の比べ",
  repayment: "住宅ローンの返済額の推移の比べ（年額）",
  keyFigures: "主な数字の比べ",
  interest: "住宅ローンの利息の推移の比べ（年額）",
  rate: "住宅ローンの金利の推移の比べ",
};

function figureLabel(k: FigureKey, v: ChartVariant): string {
  if (k === "assetsAtAge") return `${v.keyFigures.assetsAtAge?.[0]?.age ?? 95}歳時点の金融資産`;
  if (k === "minimum") return "金融資産がいちばん少ない額";
  if (k === "loanRepayment") return "住宅ローンの返済の合計";
  if (k === "loanInterest") return "住宅ローンの利息の合計";
  if (k === "lifetimeTakeHome") return "生涯の手取りの合計";
  return "生涯の支出の合計";
}

function figureValue(k: FigureKey, v: ChartVariant): number | null {
  const f = v.keyFigures;
  if (k === "assetsAtAge") return f.assetsAtAge?.[0]?.amount ?? null;
  if (k === "minimum") return f.minimum?.amount ?? null;
  const x = f[k];
  return typeof x === "number" ? x : null;
}

/** 率の文（例: 年1%。年により変わるときは添える） */
function rateNote(s: { default: string; byYear?: Record<string, string> } | undefined): string | null {
  if (s === undefined) return null;
  return `年${pctText(s.default)}${s.byYear !== undefined && Object.keys(s.byYear).length > 0 ? "（年により変わる）" : ""}`;
}

/** 前提の短い注（金利の見込み・プランの変更・物価・運用利回り・相場の想定・単位・試算の旨と出典） */
export function chartNotes(a: ChartArgs): string[] {
  const notes: string[] = [];
  const changes = a.variants.map((v, i) => {
    // 基本に重ねた通りは、基本の変更の後に通りの変更が並ぶ。同じ項目は後の物（その通りの値）だけを書く
    const all = v.planChanges ?? [];
    const rows = all.filter((c, k) => !all.slice(k + 1).some((x) => x.label === c.label));
    const list = rows.map((c) => `${c.label.replace(/^住宅ローン(\s*\d+（[^）]*）)?の/, "")} ${c.to}`);
    return `${letterOf(i)}: ${list.length > 0 ? list.join("・") : "変更なし"}`;
  });
  if (a.variants.some((v) => (v.planChanges ?? []).length > 0)) notes.push(`通りの違い\u3000${changes.join("／")}`);
  const pre = (v: ChartVariant) =>
    [rateNote(v.assumptions?.inflation) !== null ? `物価上昇率 ${rateNote(v.assumptions?.inflation)}` : null, rateNote(v.assumptions?.investmentReturn) !== null ? `運用利回り ${rateNote(v.assumptions?.investmentReturn)}（資産ごとの指定が無いもの）` : null]
      .filter((x) => x !== null)
      .join("・");
  const pres = a.variants.map(pre);
  if (pres.every((p) => p === pres[0])) {
    if ((pres[0] ?? "") !== "") notes.push(`前提\u3000${pres[0]}`);
  } else notes.push(`前提\u3000${pres.map((p, i) => `${letterOf(i)}: ${p || "—"}`).join("／")}`);
  const stress = a.variants.map((v, i) => (v.stress !== undefined && v.stress !== "" ? `${letterOf(i)}: ${v.stress}` : null)).filter((x) => x !== null);
  if (stress.length > 0) notes.push(`相場などの想定\u3000${stress.join("／")}`);
  notes.push(
    a.kind === "keyFigures"
      ? "単位は万円（万円未満は四捨五入）。生涯の合計・利息の合計は表の期間の合計です。"
      : a.kind === "repayment"
        ? "単位は万円（年額。繰上返済・手数料を含む。万円未満は四捨五入）。"
        : a.kind === "interest"
          ? "単位は万円（年額。返済のうち利息に充てた額。万円未満は四捨五入）。"
          : a.kind === "rate"
            ? "単位は%（年率。その年の最後の返済に当てた住宅ローンの金利）。"
            : "単位は万円（年末の残高。万円未満は四捨五入）。",
  );
  const [y, m] = a.baseMonth.split("-");
  notes.push(`ファイナンシアで試算（${Number(y)}年${Number(m)}月時点の入力による試算で、将来の結果を約束するものではありません）`);
  return notes;
}

interface Svg {
  parts: string[];
  y: number;
}

const text = (x: number, y: number, s: string, attrs: string): string => `<text x="${fx(x)}" y="${fx(y)}" ${attrs}>${esc(s)}</text>`;

/** 線と端の丸の色（暗い画面は画面と同じ明るい色） */
function lineColor(i: number, theme: "light" | "dark"): string {
  const c = colorStyle(i).color;
  return theme === "dark" ? (PLAN_COLOR_DARK[c] ?? c) : c;
}

/** 凡例（通りの文字・線の見本・名前。幅に収まらなければ次の行へ） */
function legend(svg: Svg, a: ChartArgs, theme: "light" | "dark", bars: boolean): void {
  const t = CHART_THEME[theme];
  let x = PAD;
  let y = svg.y + 16;
  for (const [i, v] of a.variants.entries()) {
    const label = `${letterOf(i)}\u3000${v.label}`;
    const w = 34 + 8 + textWidth(label, FS.legend) + 22;
    if (x + w > W - PAD && x > PAD) {
      x = PAD;
      y += 22;
    }
    const c = lineColor(i, theme);
    if (bars) svg.parts.push(`<rect x="${fx(x + 4)}" y="${fx(y - 10)}" width="26" height="14" rx="2" fill="${c}"/>`);
    else {
      svg.parts.push(`<line x1="${fx(x + 1)}" x2="${fx(x + 33)}" y1="${fx(y - 4)}" y2="${fx(y - 4)}" stroke="${c}" stroke-width="3"/>`);
      svg.parts.push(`<circle cx="${fx(x + 17)}" cy="${fx(y - 4)}" r="4.2" fill="${c}" stroke="${t.card}" stroke-width="1.2"/>`);
    }
    svg.parts.push(text(x + 42, y, label, `font-size="${FS.legend}" font-weight="700" fill="${t.ink}" data-legend="${letterOf(i)}"`));
    x += w;
  }
  svg.y = y + 12;
}

/**
 * 縦の目盛りの単位（万円。金利のグラフは %）。金利は1億分の1（0.000001%）を1円として目盛りの関数に渡すので、目盛り（万の単位）は 0.01% の数
 */
interface Unit {
  label: string;
  tick: (tk: number) => string;
}
const MAN: Unit = { label: "（万円）", tick: (tk) => `${tk < 0 ? "▲" : ""}${group(tk)}` };
const PCT: Unit = { label: "（%）", tick: (tk) => `${tk < 0 ? "▲" : ""}${String(Math.abs(tk) / 100)}` };

/** 金利（10進の文字）を、目盛りの関数に渡す数（1億分の1＝1。0.0065 → 650,000）にする（浮動小数点を使わない） */
const rateValue = (r: string | undefined): number | undefined => (r === undefined ? undefined : Number(mulRate(r, "100000000")));

/** 縦の目盛り・格子・単位（画面の MainChart.tsx と同じ形） */
function axes(svg: Svg, s: Scale, f: Frame, top: number, theme: "light" | "dark", unit: Unit = MAN): void {
  const t = CHART_THEME[theme];
  svg.parts.push(text(f.left - 8, top + f.top - 10, unit.label, `font-size="${FS.unit}" font-weight="700" fill="${t.ink2}" text-anchor="end" data-unit=""`));
  for (const tk of s.ticks) {
    const y = top + s.y(tk * 10000);
    svg.parts.push(`<line x1="${fx(f.left)}" x2="${fx(f.width - f.right)}" y1="${fx(y)}" y2="${fx(y)}" stroke="${tk === 0 ? t.ink : t.line2}" stroke-width="${tk === 0 ? 2 : 1}"/>`);
    svg.parts.push(text(f.left - 8, y + 4, unit.tick(tk), `font-size="${FS.axis}" fill="${t.ink2}" text-anchor="end"`));
  }
}

/** 年の目盛りと本人の年齢の段（画面の AgeAxis.tsx と同じ並び。5年ごと） */
function years(svg: Svg, s: Scale, f: Frame, top: number, ys: readonly number[], ages: Record<string, number> | undefined, theme: "light" | "dark"): void {
  const t = CHART_THEME[theme];
  const yearY = top + f.height - f.bottom + 18;
  const step = ys.length > 40 ? 10 : 5;
  for (const [i, y] of ys.entries()) {
    // 最初の年と、step の倍数の年（最初の年に近すぎる倍数の年は、文字が重なるので出さない）
    if (i !== 0 && (y % step !== 0 || (i < 3 && (ys[0] as number) % step !== 0))) continue;
    svg.parts.push(text(s.x(i), yearY, String(y), `font-size="${FS.axis}" fill="${t.ink2}" text-anchor="middle"`));
    const age = ages?.[String(y)];
    if (age !== undefined) svg.parts.push(text(s.x(i), yearY + 16, `${age}歳`, `font-size="${FS.sub}" fill="${t.ink2}" text-anchor="middle"`));
  }
  if (ages !== undefined && Object.keys(ages).length > 0) svg.parts.push(text(f.left - 14, yearY + 16, "ご本人", `font-size="10" fill="${t.ink2}" text-anchor="end"`));
}

/** 折れ線（金融資産・返済額）。値の無い年は 0 にしない（その通りの表の年だけ描く） */
function lines(svg: Svg, a: ChartArgs, pick: (p: ChartVariant["series"][number]) => number | undefined, theme: "light" | "dark", trimZeroTail: boolean, zone: string | null, unit: Unit = MAN): boolean {
  const t = CHART_THEME[theme];
  const all = [...new Set(a.variants.flatMap((v) => v.series.map((p) => p.year)))].sort((x, y) => x - y);
  let ys = all;
  if (trimZeroTail) {
    // 返済額: どの通りも返済の無くなった後の年は描かない（いちばん遅く返し終える年まで）
    const last = Math.max(...a.variants.flatMap((v) => v.series.filter((p) => (pick(p) ?? 0) > 0).map((p) => p.year)), -Infinity);
    if (!Number.isFinite(last)) return false;
    ys = all.filter((y) => y <= last);
  }
  if (ys.length < 2) return false;
  const vals = a.variants.map((v) => ys.map((y) => pick(v.series.find((p) => p.year === y) ?? { year: y })));
  const s = scaleOf(domainOf(vals.map((l) => l.filter((x): x is number => x !== undefined))), ys.length, PLOT);
  const top = svg.y;
  axes(svg, s, PLOT, top, theme, unit);
  years(svg, s, PLOT, top, ys, a.selfAges, theme);
  svg.parts.push(`<g transform="translate(0 ${fx(top)})">`);
  // 0未満の範囲: 線には塗りを付けず、薄い地と言葉で示す（画面の全部のプランを重ねる表示と同じ。範囲が狭ければ言葉は出さない）
  if (zone !== null && s.min < 0) {
    const y0 = s.y(0);
    const y1 = s.y(s.min * 10000);
    svg.parts.push(`<rect x="${fx(PLOT.left)}" y="${fx(y0)}" width="${fx(PLOT.width - PLOT.left - PLOT.right)}" height="${fx(Math.max(0, y1 - y0))}" fill="${t.shortBg}" opacity="0.55"/>`);
    if (y1 - y0 > 28) svg.parts.push(text(PLOT.left + 6, y1 - 7, `↓ ${zone}`, `font-size="${FS.unit}" font-weight="700" fill="${t.shortInk}" data-zone=""`));
  }
  const ends: { i: number; x: number; y: number }[] = [];
  // 重ね順: 基本（A）をいちばん下に
  for (const [i, l] of vals.entries()) {
    const idx = l.map((x, j) => (x !== undefined ? j : -1)).filter((j) => j >= 0);
    if (idx.length === 0) continue;
    const first = idx[0] as number;
    const last = idx[idx.length - 1] as number;
    const run = l.slice(first, last + 1).map((x) => x ?? 0);
    const shifted: Scale = { ...s, x: (j) => s.x(j + first) };
    const c = lineColor(i, theme);
    svg.parts.push(`<path d="${linePath(run, shifted)}" fill="none" stroke="${c}" stroke-width="3" stroke-linejoin="round" data-line="${letterOf(i)}"/>`);
    svg.parts.push(`<circle cx="${fx(s.x(last))}" cy="${fx(s.y(l[last] ?? 0))}" r="5.5" fill="${c}" stroke="${t.card}" stroke-width="1.5"/>`);
    ends.push({ i, x: s.x(last), y: s.y(l[last] ?? 0) });
  }
  // 線の右端の通りの文字（重なるときは縦にずらす。画面と同じ spreadX）
  const placed = spreadX(
    ends.map((e) => e.y),
    15,
    PLOT.top,
    PLOT.height - PLOT.bottom,
  );
  for (const [k, e] of ends.entries()) {
    svg.parts.push(text(e.x + 10, (placed[k] ?? e.y) + 4.5, letterOf(e.i), `font-size="${FS.end}" font-weight="700" fill="${lineColor(e.i, theme)}" stroke="${t.card}" stroke-width="3" paint-order="stroke" data-end="${letterOf(e.i)}"`));
  }
  svg.parts.push("</g>");
  svg.y = top + PLOT.height + 6;
  return true;
}

/** 主な数字の比べ（棒。数字ごとのまとまりに、通りごとの棒を並べ、棒の上に万円の数を書く） */
function bars(svg: Svg, a: ChartArgs, figures: readonly FigureKey[], theme: "light" | "dark"): boolean {
  const t = CHART_THEME[theme];
  const keys = figures.filter((k) => a.variants.some((v) => figureValue(k, v) !== null));
  if (keys.length === 0) return false;
  const vals = keys.map((k) => a.variants.map((v) => figureValue(k, v)));
  const f: Frame = { ...PLOT, right: 16, bottom: 46 };
  const s = scaleOf(domainOf(vals.map((l) => l.filter((x): x is number => x !== null))), keys.length, f);
  const top = svg.y;
  axes(svg, s, f, top, theme);
  svg.parts.push(`<g transform="translate(0 ${fx(top)})">`);
  const n = a.variants.length;
  const gw = s.band * 0.78;
  const bw = gw / n;
  for (const [g, k] of keys.entries()) {
    const cx = s.x(g);
    for (const [i, v] of (vals[g] ?? []).entries()) {
      if (v === null) continue;
      const x = cx - gw / 2 + bw * i;
      const y0 = s.y(0);
      const y1 = s.y(v);
      const c = lineColor(i, theme);
      svg.parts.push(`<rect x="${fx(x + 1)}" y="${fx(Math.min(y0, y1))}" width="${fx(Math.max(1, bw - 2))}" height="${fx(Math.max(1, Math.abs(y1 - y0)))}" fill="${c}" data-bar="${k}:${letterOf(i)}"/>`);
      const label = man(v);
      const ty = v >= 0 ? y1 - 4 : y1 + FS.value + 2;
      svg.parts.push(text(x + bw / 2, ty, label, `font-size="${n > 4 ? 9.5 : FS.value}" font-weight="700" fill="${t.ink}" text-anchor="middle"`));
      svg.parts.push(text(x + bw / 2, f.height - f.bottom + 14, letterOf(i), `font-size="${FS.sub}" font-weight="700" fill="${c}" text-anchor="middle"`));
    }
    const label = figureLabel(k, a.variants[0] as ChartVariant);
    const ls = wrap(label, FS.axis, s.band - 8);
    ls.forEach((l, j) => svg.parts.push(text(cx, f.height - f.bottom + 30 + j * 14, l, `font-size="${FS.axis}" font-weight="700" fill="${t.ink2}" text-anchor="middle"`)));
  }
  svg.parts.push("</g>");
  svg.y = top + f.height + 6;
  return true;
}

/** 画像の説明（読み上げ・代わりの文）: 題と、通りごとの主な数字 */
function altText(a: ChartArgs, title: string): string {
  const per = a.variants.map((v, i) => {
    const at = v.keyFigures.assetsAtAge?.[0];
    // 利息・金利のグラフは、利息の合計も書く（0204）
    const interest = (a.kind === "interest" || a.kind === "rate") && v.keyFigures.loanInterest !== undefined ? `住宅ローンの利息の合計${man(v.keyFigures.loanInterest)}万円` : null;
    const parts = [at !== undefined ? `${at.age}歳時点の金融資産${man(at.amount)}万円` : null, v.keyFigures.loanRepayment !== undefined ? `住宅ローンの返済の合計${man(v.keyFigures.loanRepayment)}万円` : null, interest].filter((x) => x !== null);
    return `${letterOf(i)}（${v.label}）${parts.length > 0 ? `: ${parts.join("・")}` : ""}`;
  });
  return `${title}。${per.join("。")}。`;
}

/** グラフの SVG（argsJson は ChartArgs。戻り値は JSON の文字 ChartOut） */
export function chart(argsJson: string, _a: string, _b: string): string {
  void _a;
  void _b;
  const a = JSON.parse(argsJson) as ChartArgs;
  const out = (o: ChartOut) => JSON.stringify(o);
  if (!CHART_KINDS.includes(a.kind)) return out({ status: "invalid", reason: `グラフの種類は ${CHART_KINDS.join("・")} のどれかです。` });
  if (a.variants.length === 0) return out({ status: "invalid", reason: "通りがありません。" });
  const theme = a.theme === "dark" ? "dark" : "light";
  const t = CHART_THEME[theme];
  const title = (a.title ?? "").trim() !== "" ? (a.title as string).trim() : DEFAULT_TITLE[a.kind];
  const svg: Svg = { parts: [], y: 0 };
  // 題（長ければ折り返す）
  const tl = wrap(title, FS.title, W - PAD * 2);
  tl.forEach((l, j) => svg.parts.push(text(PAD, 30 + j * 25, l, `font-size="${FS.title}" font-weight="700" fill="${t.ink}" data-title=""`)));
  svg.y = 30 + (tl.length - 1) * 25 + 8;
  legend(svg, a, theme, a.kind === "keyFigures");
  const drawn =
    a.kind === "assets"
      ? lines(svg, a, (p) => p.financialAssets, theme, false, "0未満は不足")
      : a.kind === "repayment"
        ? lines(svg, a, (p) => p.loanRepayment, theme, true, null)
        : a.kind === "interest"
          ? lines(svg, a, (p) => p.loanInterest, theme, true, null)
          : a.kind === "rate"
            ? lines(svg, a, (p) => rateValue(p.loanRate), theme, true, null, PCT)
            : bars(svg, a, a.figures !== undefined && a.figures.length > 0 ? a.figures.filter((k) => FIGURE_KEYS.includes(k)) : DEFAULT_FIGURES, theme);
  if (!drawn)
    return out({
      status: "invalid",
      reason:
        a.kind === "repayment" || a.kind === "interest"
          ? "どの通りにも住宅ローンの返済がありません。"
          : a.kind === "rate"
            ? "どの通りにも、その年の金利が1つに決まる住宅ローンの返済がありません（金利の違う住宅ローンを2本以上返している年は描きません）。"
            : "描ける数字がありません。",
    });
  // 注（前提・単位・試算の旨と出典）
  const noteLines = chartNotes(a).flatMap((n) => wrap(n, FS.note, W - PAD * 2));
  svg.y += 6;
  svg.parts.push(`<line x1="${PAD}" x2="${W - PAD}" y1="${fx(svg.y)}" y2="${fx(svg.y)}" stroke="${t.line}" stroke-width="1"/>`);
  svg.y += 4;
  for (const l of noteLines) {
    svg.y += 16;
    svg.parts.push(text(PAD, svg.y, l, `font-size="${FS.note}" fill="${t.ink2}" data-note=""`));
  }
  const height = Math.ceil(svg.y + 14);
  const alt = altText(a, title);
  const body = [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${height}" width="${W}" height="${height}" role="img" aria-label="${esc(title)}" font-family="${esc(CHART_FONT)}" data-chart="${a.kind}" data-theme="${theme}">`,
    `<title>${esc(title)}</title>`,
    `<desc>${esc(alt)}</desc>`,
    `<rect width="${W}" height="${height}" fill="${t.card}"/>`,
    ...svg.parts,
    "</svg>",
  ].join("\n");
  return out({ status: "ok", svg: body, title, alt, width: W, height });
}
