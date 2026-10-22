// バランスシートの図（提示層の部品）: 左に資産、右に負債と純資産を、金額に比例した高さの箱で描く。左右の高さはいつもそろう（資産の合計＝負債の合計＋純資産）。
// - 資産は上から「すぐ使えるお金・値動きのある運用・引き出せないお金・換金しにくい資産」。上の3つは左のかっこで「金融資産 ○万円」
// - 小さい箱も読める最低限の高さにする（比例からずれた年は図の下に目立たない注記。bsLayout.ts の allocHeights）
// - 箱はどれも枠線なしのベタ塗りで、箱の間に細い余白（BOX_GAP）を空け、角を少し丸める（BOX_RADIUS）。純資産も同じ（色はアプリの藍の仲間）。
//   左右の柱を囲む枠は描かない。箱の中の文字はどれも白（色はどれも白い文字が読める濃さ。balance.css）。下の線（0 の線）は箱の後に1本だけ描く
//   今の年（事実）も先の年（見込み）も同じ見た目で、見込みかどうかは左上の札（「事実（今・入力した値）」「見込み（○年）」）で示す
// - 純資産のマイナスは左の下に点線・灰色の斜線（ほかの箱と意味が違うので、ここだけ点線の枠）、資金の不足は右（その他の負債）に薄い赤の斜線
// - 狭い画面（スマホ。narrow.ts）では、図の外の左右の札（名前と金額・金融資産のかっこ）を描かず、柱を幅いっぱいにして、
//   名前と金額は箱の中と図の下の一覧（HTML。折り返すので画面の端で切れない）に出す
// - 箱の中の名前と金額は、1行で間が取れるときだけ1行（名前は左・金額は右）。取れなければ金額を名前の下の行に回し、
//   それも入らない小さな箱は、狭い画面では金額だけ（名前は図の下の一覧）、広い画面では名前だけ（金額は図の外の札）にする（boxTextFit）
// - 縮尺（scale）を渡さなければその年がいっぱいの高さ。年を変えると、箱と縮尺が前の形から行き過ぎなく動く（tween.ts）
// - 箱を押すと内訳の小窓（もう一度押す・×・Esc・外を押すと閉じる）
// - 箱（項目）にカーソルを合わせると、名前・金額・どの分け方のうちかの札（FigTip.tsx）。キーボードで箱のまとまりを選んだときは、
//   まとまりの名前・合計・内訳の札。薄くて名前や金額を書けない箱も、これで読める。タッチでは押すと内訳の小窓が開く
import type { ComponentChildren } from "preact";
import { useEffect, useId, useLayoutEffect, useRef, useState } from "preact/hooks";
import { allocHeights, figureBoxes, spreadLabels, tickStep, FINANCIAL_GROUPS, type FigBox } from "./bsLayout.ts";
import { FigTip, useFigTip, type FigTipData } from "./FigTip.tsx";
import { group, man } from "./format.ts";
import { useNarrow } from "./narrow.ts";
import type { BsGroupKey, BsYearModel, Yen } from "./model.ts";
import { useTween } from "./tween.ts";

/** 枠の幅と文字の大きさを測る（文字を大きくしたとき・窓の幅を変えたときも測り直す） */
export function useBoxSize<T extends HTMLElement>(initial = 720): { ref: { current: T | null }; w: number; fs: number } {
  const ref = useRef<T>(null);
  const [size, setSize] = useState({ w: initial, fs: 16 });
  useLayoutEffect(() => {
    const el = ref.current;
    if (el === null) return;
    const measure = () => {
      const fs = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
      const w = Math.max(200, Math.round(el.clientWidth));
      setSize((s) => (s.w === w && s.fs === fs ? s : { w, fs }));
    };
    measure();
    const ro = typeof ResizeObserver === "function" ? new ResizeObserver(measure) : null;
    ro?.observe(el);
    ro?.observe(document.documentElement);
    window.addEventListener("resize", measure);
    return () => {
      ro?.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, []);
  return { ref, ...size };
}

/** 項目の色（CSS の変数。balance.css）。分からない項目は分け方の色 */
export const lineColor = (key: string, g?: BsGroupKey | "netWorth" | "neg") => `var(--bs-${key}, var(--bs-g-${g ?? "illiquid"}))`;
/** 箱の中の文字の色: どの箱も白（色は白い文字が読める濃さにそろえてある。balance.css）。資金の不足の斜線だけ濃い文字 */
const boxInk = (key: string) => (key === "short" ? "var(--ink)" : "#fff");

/** 箱の間の余白と角の丸み（図の座標。文字の大きさ 16px のときの px） */
export const BOX_GAP = 2;
/** 薄い項目の見えない当たりの帯の高さ */
const HIT_H = 9;
export const BOX_RADIUS = 4;

/** 文字の幅の目安（全角1・半角0.6） */
const textW = (s: string, f: number) => [...s].reduce((w, c) => w + (c.charCodeAt(0) > 255 ? 1 : 0.6), 0) * f;
const fmt = (yen: Yen) => group(Math.round(yen / 10000));

/**
 * 箱の中の太字の幅の目安（少し広めに見積もる）。全角1・数字0.78・かんま0.36・細い英字（I・J・i・j・l）0.45・ほかの英大文字0.84・ほかの半角0.68。
 * 図の外の札の textW（半角0.6）より広い: 箱の中は名前と金額を同じ行に置くので、狭く見積もると2つが詰まって見える
 */
export const boxTextW = (s: string, f: number) => [...s].reduce((w, c) => w + (c.charCodeAt(0) > 255 ? 1 : /[0-9]/.test(c) ? 0.78 : /[,.]/.test(c) ? 0.36 : /[IJijl]/.test(c) ? 0.45 : /[A-Z]/.test(c) ? 0.84 : 0.68), 0) * f;

/**
 * 箱の中の名前と金額の置き方:
 * - "one": 名前を左・金額を右の1行（間を文字1つ分ほど空けられるとき）
 * - "two": 名前の下の行に金額（1行では詰まるが、箱に2行分の高さがあるとき）
 * - "value": 金額だけ（狭い画面で箱が小さいとき。名前は図の下の一覧に出す）
 * - "name": 名前だけ（広い画面で箱が小さいとき。金額は図の外の札に出す）
 * - "none": 何も入れない
 */
export type BoxTextFit = "one" | "two" | "value" | "name" | "none";
export function boxTextFit(name: string, value: string, colW: number, h: number, f: number, narrow: boolean): BoxTextFit {
  if (h < f * 1.55) return "none";
  const pad = 10;
  const nmW = boxTextW(name, f);
  const vW = boxTextW(value, f);
  const gap = Math.max(10, f * 0.9);
  if (pad + nmW + gap + vW + pad <= colW) return "one";
  if (h >= f * 3 && Math.max(nmW, vW) + 2 * pad <= colW) return "two";
  if (narrow) return vW + 2 * pad <= colW ? "value" : "none";
  return nmW + 2 * pad <= colW ? "name" : "none";
}

export interface BsFigureProps {
  year: BsYearModel;
  /** 分け方の名前と短い名前 */
  groups: Record<BsGroupKey, { name: string; short: string }>;
  /** 縮尺（いっぱいの高さに当たる額）。省略はその年の大きさ */
  scale?: Yen;
  /** 並べて小さく見せる形（見出し・札を短く） */
  compact?: boolean;
  /** 図の高さ（px。文字の大きさ 16px のとき） */
  height: number;
  /** 左上の「事実／見込み」の札を出さない */
  noTag?: boolean;
  /** 比例からずれた箱があるかを知らせる（注記を出すため） */
  onAdjusted?: (adjusted: boolean) => void;
  /** 読み上げの名前（例: 「2026年のバランスシート」） */
  label: string;
}

interface Drawn {
  box: FigBox;
  top: number;
  bot: number;
  x: number;
  parts: { key: string; label: string; value: number; y: number; h: number }[];
}

/** 値の束（補間用）: 項目の額・純資産・縮尺 */
function seriesOf(y: BsYearModel, scale: Yen, seen: Map<string, { label: string; group: BsGroupKey }>): Record<string, number[]> {
  const out: Record<string, number[]> = { nw: [y.netWorth], sc: [scale] };
  for (const k of seen.keys()) out[`l.${k}`] = [0];
  for (const l of y.lines) out[`l.${l.key}`] = [l.amount];
  return out;
}

export function BsFigure({ year, groups, scale, compact = false, height, noTag = false, onAdjusted, label }: BsFigureProps) {
  const { ref, w, fs: px } = useBoxSize<HTMLDivElement>(compact ? 420 : 760);
  const uid = useId().replace(/[^a-zA-Z0-9]/g, "");
  const narrow = useNarrow();
  const seen = useRef(new Map<string, { label: string; group: BsGroupKey }>());
  for (const l of year.lines) seen.current.set(l.key, { label: l.label, group: l.group });
  const total = Math.max(year.totalAssets, year.totalLiabilities, 1);
  const t = useTween(seriesOf(year, Math.max(scale ?? total, total), seen.current));
  // 補間した値から、描く年の値を組み立て直す（項目の名前・分け方は変わらない）
  const lines = [...seen.current.entries()].map(([key, v]) => ({ key, label: v.label, group: v.group, amount: Math.max(0, t[`l.${key}`]?.[0] ?? 0) })).filter((l) => l.amount > 0.5);
  const sorted = year.lines.map((l) => l.key);
  lines.sort((a, b) => {
    const ia = sorted.indexOf(a.key);
    const ib = sorted.indexOf(b.key);
    return (ia < 0 ? 999 : ia) - (ib < 0 ? 999 : ib);
  });
  const nw = t.nw?.[0] ?? year.netWorth;
  const shown = { lines, netWorth: nw };
  const A = lines.filter((l) => l.group !== "mortgage" && l.group !== "debt").reduce((s, l) => s + l.amount, 0);
  const L = lines.filter((l) => l.group === "mortgage" || l.group === "debt").reduce((s, l) => s + l.amount, 0);
  const Tot = Math.max(A, L, 1);
  const SC = Math.max(t.sc?.[0] ?? Tot, Tot);
  const fin = lines.filter((l) => FINANCIAL_GROUPS.includes(l.group)).reduce((s, l) => s + l.amount, 0);

  const [open, setOpen] = useState<string | null>(null);
  const wrap = useRef<HTMLDivElement>(null);
  const figTip = useFigTip();
  useEffect(() => {
    if (open === null) return;
    const close = (e: Event) => {
      if (e instanceof KeyboardEvent ? e.key === "Escape" : !(wrap.current?.contains(e.target as Node) ?? false)) setOpen(null);
    };
    document.addEventListener("click", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("click", close);
      document.removeEventListener("keydown", close);
    };
  }, [open]);

  // 配置（図を主役に。箱は太く、間とラベルの余白はゆったり）
  const fs = px * (compact ? 0.92 : 1);
  // 狭い枠（並べる表示・文字「大」）では、図に要る最小の幅で描いて枠の幅に縮める（札・目盛りが枠からはみ出さない）
  // 狭い画面では枠の幅のまま描く（縮めない。札は図の下の一覧に回すので、柱を幅いっぱいにできる）
  const W = narrow ? Math.max(fs * 15, w) : Math.max(compact ? fs * 26 : 420, w);
  const H = Math.round(height * (px / 16 > 1.1 ? 1.08 : 1));
  const est = !year.fact;
  const headH = fs * (compact ? 2.7 : 3.4);
  // 目盛りの「0」（下の線の高さに文字の中ほど）が図の下の端で切れないよう、下の線を少し上げる（どの幅でも）
  const base = H - 2 - fs * 0.45;
  const plotH = base - headH;
  const padL = narrow ? 2 : compact ? 0 : fs * 1.7;
  // 目盛りの幅: 一番大きい目盛りの数字（1億円を超えると「15,000」の5桁）が、目盛りの線と印に重ならず右の柱にも触れない幅
  const step = tickStep(SC, compact ? 4 : 6);
  const tickF = fs * 0.7;
  const axW = Math.max(fs * (narrow ? 3.0 : compact ? 3.2 : 4.4), textW(fmt(Math.floor(SC / step) * step), tickF) + fs * 0.6 + 8);
  const labW = narrow ? 0 : compact ? Math.max(fs * 6.4, (W - axW) * 0.26) : Math.max(130, Math.min(250, (W - padL - axW) * 0.22));
  const gap = narrow ? fs * 1.5 : compact ? fs * 1.4 : Math.max(36, fs * 2.6);
  const colW = Math.max(fs * 3.4, Math.min(narrow ? 240 : compact ? 190 : 320, (W - padL - axW - 2 * labW - gap) / 2));
  const x0 = padL + Math.max(0, (W - padL - axW - (2 * labW + 2 * colW + gap)) / 2);
  const xL = x0 + labW;
  const xR = xL + colW + gap;
  const colH = (plotH * Tot) / SC;
  const colTop = base - colH;
  const kLin = colH / Tot;
  const { left, right } = figureBoxes(shown);
  const minH = fs * (compact ? 1.6 : 2.1);
  const al = allocHeights(left.map((b) => b.value), colH, minH);
  const ar = allocHeights(right.map((b) => b.value), colH, minH);
  const adjusted = al.adjusted || ar.adjusted;
  useEffect(() => onAdjusted?.(adjusted), [adjusted]);
  const drawn: Drawn[] = [];
  const stack = (boxes: FigBox[], hs: number[], x: number) => {
    let yb = base;
    // 下から積む（左はマイナスの箱が一番下、右は純資産が一番下）
    for (let i = boxes.length - 1; i >= 0; i--) {
      const b = boxes[i] as FigBox;
      const h = hs[i] ?? 0;
      const bot = yb;
      yb -= h;
      let yy = bot;
      const parts = [...b.parts].reverse().map((p) => {
        const ph = b.value > 0 ? (p.value / b.value) * h : 0;
        yy -= ph;
        return { ...p, y: yy, h: ph };
      });
      drawn.push({ box: b, top: yb, bot, x, parts: parts.reverse() });
    }
  };
  stack(left, al.heights, xL);
  stack(right, ar.heights, xR);
  const short = compact || narrow;
  // 純資産のマイナスは、並べる小さな図では「純資産」（金額に▲が付くので「純資産 ▲○万円」と読める。長い名前は枠の左で切れる）
  const nameOf = (b: FigBox) => (b.key === "netWorth" ? "純資産" : b.key === "neg" ? (compact ? "純資産" : "純資産のマイナス") : compact ? groups[b.key].short : groups[b.key].name);

  const axL = xR + colW + labW + fs * (narrow ? 0.4 : 0.6);
  const axX = axL + axW - fs * 0.6;
  const ticks: number[] = [];
  for (let v = 0; v <= SC + 1; v += step) if (base - v * kLin >= base - plotH - 2) ticks.push(v);
  const hy2 = colTop - fs * 0.55;
  const hy1 = hy2 - fs * (compact ? 1.2 : 1.55);
  const nmF = fs * (compact ? 0.76 : 0.9);
  // 見出しの合計の金額: 1億円を超えて桁が増えても、左右の金額が真ん中の「＝」に触れないよう、入らなければ文字を小さくする
  const amF0 = fs * (compact ? 1.05 : 1.45);
  const headW = (v: number) => textW(fmt(v), amF0) + textW("万円", amF0 * 0.6);
  const headRoom = colW + gap - textW("＝", amF0) - fs * 0.9;
  const amF = amF0 * Math.max(0.62, Math.min(1, headRoom / Math.max(headW(A), headW(L + Math.max(0, nw)), 1)));
  const subF = fs * (compact ? 0.78 : 0.86);
  const lh = fs * (compact ? 2.5 : 3.2);
  const fg = drawn.filter((d) => FINANCIAL_GROUPS.includes(d.box.key as BsGroupKey) && d.bot - d.top >= 0.3);
  const labels = (narrow ? [] : (["L", "R"] as const)).flatMap((side) => {
    const ls = drawn.filter((d) => d.box.side === side && d.box.value >= 5000 && d.bot - d.top >= 0.3);
    const ys = spreadLabels(
      ls.map((d) => (d.top + d.bot) / 2),
      colTop + lh * 0.3,
      base - lh * 0.38,
      lh,
    );
    return ls.map((d, i) => ({ d, y: ys[i] as number }));
  });
  const tag = est ? `見込み（${year.year}年）` : "事実（今・入力した値）";
  const tagW = textW(tag, fs * 0.8) + 18;

  const openBox = drawn.find((d) => d.box.key === open && d.box.value > 0.5) ?? null;
  // 札の中身は描いている値（補間の途中）ではなく、その年の値
  const amountOf = (key: string) => (key === "netWorth" || key === "neg" ? Math.abs(year.netWorth) : (year.lines.find((l) => l.key === key)?.amount ?? 0));
  const tipAt = (d: Drawn, y: number): Pick<FigTipData, "x" | "y" | "side"> => (d.box.side === "L" ? { x: d.x + colW + 6, y, side: "r" } : { x: d.x - 6, y, side: "l" });
  const partTip = (d: Drawn, q: Drawn["parts"][number]): FigTipData => {
    const isNw = q.key === "netWorth";
    const isNeg = q.key === "neg";
    const gname = d.box.key === "netWorth" || d.box.key === "neg" ? "" : groups[d.box.key].name;
    const many = d.parts.filter((x) => x.value > 0.5).length > 1;
    const note = isNw ? "資産 − 負債" : isNeg ? "資産より負債が多い分（債務超過）" : q.key === "short" ? "金融資産が尽きた後の足りない分" : many ? `${gname}のうち` : gname !== q.label ? gname : undefined;
    return {
      key: q.key,
      title: isNw ? "純資産" : isNeg ? "純資産のマイナス" : q.label,
      amount: amountOf(q.key),
      ...(note !== undefined ? { note } : {}),
      swatch: isNw ? "var(--bs-netWorth)" : isNeg ? "#b5bcc6" : q.key === "short" ? "var(--bs-short-line)" : lineColor(q.key, d.box.key),
      ...tipAt(d, q.y + q.h / 2),
    };
  };
  const boxTip = (d: Drawn): FigTipData => {
    const k = d.box.key;
    if (k === "netWorth" || k === "neg") return partTip(d, d.parts[0] as Drawn["parts"][number]);
    const ls = year.lines.filter((l) => l.group === k);
    return { key: `g.${k}`, title: groups[k].name, amount: ls.reduce((a, l) => a + l.amount, 0), ...(ls.length > 1 ? { rows: ls.map((l) => ({ label: l.label, amount: l.amount })) } : {}), swatch: lineColor(ls[0]?.key ?? k, k), ...tipAt(d, (d.top + d.bot) / 2) };
  };
  return (
    <div class={`bsf${compact ? " compact" : ""}${est ? " est" : " fact"}`} ref={wrap} data-bs-figure={year.year}>
      <div class="bsf-svg" ref={ref}>
        <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} role="img" aria-label={`${label}。資産${fmt(year.totalAssets)}万円＝負債${fmt(year.totalLiabilities)}万円＋純資産${man(year.netWorth)}万円`}>
          <defs>
            <pattern id={`${uid}-ht`} width="7" height="7" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
              <rect width="7" height="7" fill="var(--bs-short)" />
              <line x1="0" y1="0" x2="0" y2="7" stroke="var(--bs-short-line)" stroke-width="2" />
            </pattern>
            <pattern id={`${uid}-ng`} width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(-45)">
              <rect width="8" height="8" fill="#fff" />
              <line x1="0" y1="0" x2="0" y2="8" stroke="#b5bcc6" stroke-width="2" />
            </pattern>
          </defs>
          {/* 目盛り（右端）。「0」の印は下の線が兼ねる（重ねて描くと線が太く見えるため） */}
          <line x1={axL} x2={axL} y1={base - plotH} y2={base} stroke="var(--line)" />
          {ticks.map((v) => (
            <g key={v}>
              {v > 0 ? <line x1={axL} x2={axL + 5} y1={base - v * kLin} y2={base - v * kLin} stroke="#9aa3ae" /> : null}
              <text x={axX} y={base - v * kLin + fs * 0.27} text-anchor="end" font-size={tickF} fill="var(--ink-2)">
                {fmt(v)}
              </text>
            </g>
          ))}
          <text x={axX} y={base - plotH - fs * 0.55} text-anchor="end" font-size={fs * 0.66} fill="var(--ink-2)">
            （万円）
          </text>
          {/* 見出し（合計） */}
          <text x={xL + colW / 2} y={hy1} text-anchor="middle" font-size={nmF} font-weight="700" fill="var(--ink-2)">
            {short ? "資産" : "資産（持っているもの）"}
          </text>
          <text x={xL + colW / 2} y={hy2} text-anchor="middle" font-size={amF} font-weight="700" fill="var(--ink)" class="num">
            {fmt(A)}
            <tspan font-size={amF * 0.6}>万円</tspan>
          </text>
          <text x={xR + colW / 2} y={hy1} text-anchor="middle" font-size={nmF} font-weight="700" fill="var(--ink-2)">
            {short ? "負債＋純資産" : "負債（借りているもの）＋純資産"}
          </text>
          <text x={xR + colW / 2} y={hy2} text-anchor="middle" font-size={amF} font-weight="700" fill="var(--ink)" class="num">
            {fmt(L + Math.max(0, nw))}
            <tspan font-size={amF * 0.6}>万円</tspan>
          </text>
          <text x={(xL + colW + xR) / 2} y={hy2} text-anchor="middle" font-size={amF} font-weight="700" fill="var(--ink-2)">
            ＝
          </text>
          {/* 箱 */}
          {drawn.map((d) =>
            d.bot - d.top < 0.3 ? null : (
              <g
                key={d.box.key}
                class="bsf-box"
                data-bs-box={d.box.key}
                tabIndex={0}
                role="button"
                aria-expanded={open === d.box.key}
                aria-label={`${nameOf(d.box)} ${d.box.key === "neg" ? "▲" : ""}${fmt(d.box.value)}万円${d.parts.length > 1 ? `（${d.parts.map((q) => `${q.label} ${fmt(q.value)}万円`).join("、")}）` : ""}。押すと内訳`}
                onClick={(e) => {
                  e.stopPropagation();
                  figTip.hide();
                  setOpen(open === d.box.key ? null : d.box.key);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    figTip.hide();
                    setOpen(open === d.box.key ? null : d.box.key);
                  }
                }}
                {...figTip.focus(boxTip(d))}
              >
                {d.parts.map((q) => {
                  if (q.h < 0.3) return null;
                  const isNw = q.key === "netWorth";
                  const isNeg = q.key === "neg";
                  const fill = q.key === "short" ? `url(#${uid}-ht)` : isNeg ? `url(#${uid}-ng)` : isNw ? "var(--bs-netWorth)" : lineColor(q.key, d.box.key);
                  const inset = isNeg ? 1 : 0;
                  // 箱の間の余白（上下に半分ずつ）。ごく薄い箱は余白で消えないよう、余白なしで描く
                  const g2 = q.h > BOX_GAP * 2.5 ? BOX_GAP / 2 : 0;
                  const rh = Math.max(0, q.h - 2 * inset - 2 * g2);
                  const name = short && q.key === "insurance" ? "返戻金" : short && q.key === "corporateDc" ? "DC" : q.label;
                  // 純資産の箱の中は、広い図では「資産 − 負債」の説明（名前と金額は図の外の札）。狭い画面ではほかの箱と同じく名前と金額
                  const showText = (!isNw || narrow) && !isNeg;
                  const tf = boxInk(q.key);
                  const ty = q.y + q.h / 2 + subF * 0.36;
                  // 名前と金額: 1行で間が取れれば1行、取れなければ金額を名前の下の行に、それも入らなければ金額だけ（狭い画面）か名前だけ
                  const fit = showText ? boxTextFit(name, fmt(q.value), colW, q.h, subF, narrow) : "none";
                  const two = fit === "two";
                  return (
                    <g key={q.key} {...(open === null ? figTip.hover(partTip(d, q)) : {})} data-bs-part={q.key}>
                      <rect
                        class="bsf-seg"
                        x={d.x + inset}
                        y={q.y + inset + g2}
                        width={colW - 2 * inset}
                        height={rh}
                        rx={Math.min(BOX_RADIUS, rh / 2, colW / 2)}
                        fill={fill}
                        stroke={isNeg ? "var(--base-ink)" : undefined}
                        stroke-width={isNeg ? 1.8 : undefined}
                        stroke-dasharray={isNeg ? "6 4" : undefined}
                      />
                      {fit === "one" || fit === "two" || fit === "name" ? (
                        <text x={d.x + 10} y={two ? ty - subF * 0.62 : ty} font-size={subF} font-weight="700" fill={tf} data-bs-text="name">
                          {name}
                        </text>
                      ) : null}
                      {two || fit === "value" ? (
                        <text x={d.x + 10} y={two ? ty + subF * 0.62 : ty} font-size={subF} font-weight="700" fill={tf} class="num" data-bs-text="value">
                          {fmt(q.value)}
                        </text>
                      ) : null}
                      {fit === "one" ? (
                        <text x={d.x + colW - 10} y={ty} text-anchor="end" font-size={subF} font-weight="700" fill={tf} class="num" data-bs-text="value">
                          {fmt(q.value)}
                        </text>
                      ) : null}
                    </g>
                  );
                })}
                {d.box.key === "netWorth" && d.bot - d.top >= fs * 2.4 && !compact && !narrow ? (
                  <text x={d.x + colW / 2} y={(d.top + d.bot) / 2 + fs * 0.32} text-anchor="middle" font-size={fs * 0.86} fill="#fff" font-weight="700">
                    資産 − 負債
                  </text>
                ) : null}
                {d.box.key === "neg" && d.bot - d.top >= fs * 1.6 ? (
                  <text x={d.x + colW / 2} y={(d.top + d.bot) / 2 + fs * 0.3} text-anchor="middle" font-size={fs * 0.8} fill="var(--ink-2)" font-weight="700" paint-order="stroke" stroke="#fff" stroke-width="4">
                    足りない分
                  </text>
                ) : null}
                {open === d.box.key ? <rect x={d.x - 3} y={d.top - 3} width={colW + 6} height={d.bot - d.top + 6} fill="none" stroke="var(--ink)" stroke-width="2.5" rx={BOX_RADIUS + 2} /> : null}
              </g>
            ),
          )}
          {/* 薄い項目（読める高さより低い箱）は、カーソルを合わせやすいよう見えない当たりの帯を箱の上に重ねる（押すとその箱の内訳） */}
          {open === null
            ? drawn.flatMap((d) =>
                d.parts
                  .filter((q) => q.h >= 0.3 && q.h < HIT_H)
                  .map((q) => (
                    <rect
                      key={`hit-${q.key}`}
                      class="bsf-hit"
                      x={d.x}
                      y={q.y + q.h / 2 - HIT_H / 2}
                      width={colW}
                      height={HIT_H}
                      fill="transparent"
                      {...figTip.hover(partTip(d, q))}
                      onClick={(e) => {
                        e.stopPropagation();
                        figTip.hide();
                        setOpen(d.box.key);
                      }}
                    />
                  )),
              )
            : null}
          {/* 下の線（0 の線）: 箱の後に1本で描く。箱の白い縁の下に隠れて、柱の間・両端だけが太く・点のように見えないように。
              右端は目盛りの「0」の印まで延ばす（印は描かない） */}
          <line data-bs-baseline x1={Math.max(0.5, xL - 8)} x2={axL + 5} y1={base + 0.6} y2={base + 0.6} stroke="#9aa3ae" stroke-width="1.2" />
          {!compact && !noTag && !narrow ? (
            <g data-bs-kind={est ? "est" : "fact"}>
              <rect x="2" y="2" width={tagW} height={fs * 1.55} rx="4" fill={est ? "#fff" : "var(--ink)"} stroke={est ? "var(--ink-2)" : "var(--ink)"} stroke-width="1.5" />
              <text x="11" y={2 + fs * 1.1} font-size={fs * 0.8} font-weight="700" fill={est ? "var(--ink-2)" : "#fff"}>
                {tag}
              </text>
            </g>
          ) : null}
          {/* 金融資産（3つの層）のかっこ */}
          {!compact && !narrow && fg.length > 0
            ? (() => {
                const ft = Math.min(...fg.map((d) => d.top));
                const fb = Math.max(...fg.map((d) => d.bot));
                const bx = fs * 1.1;
                const txt = `金融資産 ${fmt(fin)}万円`;
                return (
                  <g data-bs-financial>
                    <path d={`M${bx + 7} ${ft + 1} L${bx} ${ft + 1} L${bx} ${fb - 1} L${bx + 7} ${fb - 1}`} fill="none" stroke="#7d8794" stroke-width="1.5" />
                    {fb - ft > txt.length * fs * 0.66 + 8 ? (
                      <text transform={`translate(${bx - 5} ${(ft + fb) / 2}) rotate(-90)`} text-anchor="middle" font-size={fs * 0.74} font-weight="700" fill="var(--ink-2)">
                        {txt}
                      </text>
                    ) : null}
                  </g>
                );
              })()
            : null}
          {/* 外側の大きな名前と金額（引き出し線つき） */}
          {labels.map(({ d, y }) => {
            const Ls = d.box.side === "L";
            const ex = Ls ? xL : xR + colW;
            const tx = Ls ? xL - 16 : xR + colW + 16;
            const anc = Ls ? "end" : "start";
            const by = Math.min(Math.max(y, d.top + 1), d.bot - 1);
            // 札が枠の外で欠けないよう、入る幅（左は枠の左端まで、右は目盛りまで）に収まらなければ文字を小さくする（純資産のマイナスの「▲」など）
            const room = Ls ? tx - 2 : axL - tx - 4;
            const need = Math.max(textW(nameOf(d.box), fs * (compact ? 0.8 : 1.0)), textW(`${d.box.key === "neg" ? "▲" : ""}${fmt(d.box.value)}`, fs * (compact ? 1.1 : 1.6)) + textW("万円", fs * (compact ? 1.1 : 1.6) * 0.55));
            const fit = Math.max(0.6, Math.min(1, room / Math.max(need, 1)));
            const nF = fs * (compact ? 0.8 : 1.0) * fit;
            const aF = fs * (compact ? 1.1 : 1.6) * fit;
            return (
              <g key={`lb-${d.box.key}`} class="bsf-label" data-bs-label={d.box.key}>
                <path d={`M${ex + (Ls ? -2 : 2)} ${by} L${tx + (Ls ? 5 : -5)} ${y}`} stroke="#9aa3ae" fill="none" />
                <text x={tx} y={y - lh * 0.2} text-anchor={anc} font-size={nF} font-weight="700" fill="var(--ink-2)">
                  {nameOf(d.box)}
                </text>
                <text x={tx} y={y + lh * 0.38} text-anchor={anc} font-size={aF} font-weight="700" fill={d.box.key === "netWorth" ? "var(--bs-netWorth-ink)" : "var(--ink)"} class="num">
                  {d.box.key === "neg" ? "▲" : ""}
                  {fmt(d.box.value)}
                  <tspan font-size={aF * 0.55}>万円</tspan>
                </text>
              </g>
            );
          })}
        </svg>
        {figTip.tip !== null && openBox === null ? <FigTip d={figTip.tip} W={W} H={H} /> : null}
      </div>
      {narrow ? <BoxList year={year} groups={groups} /> : null}
      {openBox !== null ? <BoxPop d={openBox} year={year} name={nameOf(openBox.box)} colW={colW} xL={xL} xR={xR} W={W} onClose={() => setOpen(null)} /> : null}
    </div>
  );
}

/** 箱を押したときの内訳の小窓 */
function BoxPop({ d, year, name, colW, xL, xR, W, onClose }: { d: Drawn; year: BsYearModel; name: string; colW: number; xL: number; xR: number; W: number; onClose: () => void }) {
  const el = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 340, h: 160 });
  useLayoutEffect(() => {
    const e = el.current;
    if (e !== null && (Math.abs(e.offsetWidth - size.w) > 1 || Math.abs(e.offsetHeight - size.h) > 1)) setSize({ w: e.offsetWidth, h: e.offsetHeight });
  });
  const k = d.box.key;
  const rows: ComponentChildren[] = [];
  const row = (key: string, label: string, v: Yen, cls = "", sw?: string) => (
    <div class={`r ${cls}`} key={key}>
      <span>
        {sw !== undefined ? <i style={{ background: sw }} class={key === "short" ? "ht" : ""} /> : null}
        {label}
      </span>
      <span class="num">{man(v)}万円</span>
    </div>
  );
  // 内訳は描いている値ではなく、その年の値（補間の途中の値を出さない）
  const lines = year.lines.filter((l) => l.group === k);
  if (k === "netWorth" || k === "neg") {
    const illiquid = year.lines.filter((l) => l.group === "illiquid").reduce((s, l) => s + l.amount, 0);
    rows.push(row("a", "資産の合計", year.totalAssets), row("l", "− 負債の合計", year.totalLiabilities), row("n", k === "neg" ? "＝ 足りない分" : "＝ 純資産", year.netWorth, "tot"));
    if (k === "netWorth") rows.push(row("x", "うち 換金しにくい資産を除くと", year.netWorth - illiquid));
  } else {
    for (const l of lines) rows.push(row(l.key, l.label, l.amount, "", lineColor(l.key, l.group)));
    if (lines.length > 1) rows.push(row("t", "合計", lines.reduce((s, l) => s + l.amount, 0), "tot"));
  }
  const note = year.notes[k];
  const cy = (d.top + d.bot) / 2;
  const leftSide = d.box.side === "L";
  const left = Math.max(-8, Math.min(W - size.w + 8, leftSide ? xL + colW + 10 : xR - 10 - size.w));
  const top = Math.max(0, cy - 26);
  return (
    <div class={`bsf-pop ${leftSide ? "to-r" : "to-l"}`} ref={el} style={{ left: `${left}px`, top: `${top}px` }} role="dialog" aria-label={`${name}の内訳`} data-bs-pop={k} onClick={(e) => e.stopPropagation()}>
      <div class="pt">
        <span class="sw" style={{ background: k === "netWorth" ? "var(--bs-netWorth)" : k === "neg" ? "#fff" : lineColor(lines[0]?.key ?? k, k) }} />
        {name}
        <span class="py num">{year.year}年</span>
        <button type="button" class="x" aria-label="閉じる" onClick={onClose}>
          ×
        </button>
      </div>
      {rows}
      {note !== undefined ? <p class="pn">{note}</p> : null}
    </div>
  );
}

/** 狭い画面で図の下に出す、箱の名前と金額の一覧（左: 資産、右: 負債と純資産。その年の値。補間の途中の値は出さない） */
function BoxList({ year, groups }: { year: BsYearModel; groups: Record<BsGroupKey, { name: string; short: string }> }) {
  const { left, right } = figureBoxes(year);
  const fin = year.lines.filter((l) => FINANCIAL_GROUPS.includes(l.group)).reduce((s, l) => s + l.amount, 0);
  const item = (b: FigBox) => {
    const nw = b.key === "netWorth";
    const ng = b.key === "neg";
    const sw = nw ? "var(--bs-netWorth)" : ng ? undefined : lineColor(b.parts[0]?.key ?? b.key, b.key as BsGroupKey);
    return (
      <li key={b.key} class={nw ? "nw" : ng ? "ng" : ""} data-bs-list={b.key}>
        <i class={ng ? "ng" : b.parts[0]?.key === "short" ? "ht" : ""} style={sw !== undefined ? { background: sw } : undefined} aria-hidden="true" />
        <span class="nm">{nw ? "純資産" : ng ? "純資産のマイナス" : groups[b.key as BsGroupKey].name}</span>
        <span class="am num">
          {ng ? "▲" : ""}
          {fmt(b.value)}
          <small>万円</small>
        </span>
      </li>
    );
  };
  const ls = left.filter((b) => b.value >= 5000);
  const rs = right.filter((b) => b.value >= 5000);
  return (
    <div class="bsf-list" data-bs-list-wrap>
      <ul aria-label="資産">
        <li class="lh">資産</li>
        {ls.map(item)}
        {ls.some((b) => FINANCIAL_GROUPS.includes(b.key as BsGroupKey)) ? (
          <li class="sub" key="fin" data-bs-list="financial">
            <i aria-hidden="true" />
            <span class="nm">うち金融資産</span>
            <span class="am num">
              {fmt(fin)}
              <small>万円</small>
            </span>
          </li>
        ) : null}
      </ul>
      <ul aria-label="負債と純資産">
        <li class="lh">負債＋純資産</li>
        {rs.map(item)}
      </ul>
    </div>
  );
}
