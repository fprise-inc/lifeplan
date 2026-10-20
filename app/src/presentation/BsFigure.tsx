// バランスシートの図（提示層の部品）: 左に資産、右に負債と純資産を、金額に比例した高さの箱で描く。左右の高さはいつもそろう（資産の合計＝負債の合計＋純資産）。
// - 資産は上から「すぐ使えるお金・値動きのある運用・引き出せないお金・換金しにくい資産」。上の3つは左のかっこで「金融資産 ○万円」
// - 小さい箱も読める最低限の高さにする（比例からずれた年は図の下に目立たない注記。bsLayout.ts の allocHeights）
// - 今の年（事実）も先の年（見込み）も同じ色・同じ実線の枠。見込みかどうかは左上の札（「事実（今・入力した値）」「見込み（○年）」）で示す
// - 純資産のマイナスは左の下に点線・灰色の斜線、資金の不足は右（その他の負債）に薄い赤の斜線
// - 縮尺（scale）を渡さなければその年がいっぱいの高さ。年を変えると、箱と縮尺が前の形から行き過ぎなく動く（tween.ts）
// - 箱を押すと内訳の小窓（もう一度押す・×・Esc・外を押すと閉じる）
import type { ComponentChildren } from "preact";
import { useEffect, useId, useLayoutEffect, useRef, useState } from "preact/hooks";
import { allocHeights, figureBoxes, spreadLabels, tickStep, FINANCIAL_GROUPS, type FigBox } from "./bsLayout.ts";
import { group, man } from "./format.ts";
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
/** 箱の中の文字を白にする濃い色の項目 */
const DARK = new Set(["deposit", "zaikei", "finOther", "nisa", "land", "mortgage"]);

/** 文字の幅の目安（全角1・半角0.6） */
const textW = (s: string, f: number) => [...s].reduce((w, c) => w + (c.charCodeAt(0) > 255 ? 1 : 0.6), 0) * f;
const fmt = (yen: Yen) => group(Math.round(yen / 10000));

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
  const W = Math.max(compact ? fs * 26 : 420, w);
  const H = Math.round(height * (px / 16 > 1.1 ? 1.08 : 1));
  const est = !year.fact;
  const headH = fs * (compact ? 2.7 : 3.4);
  const base = H - 2;
  const plotH = base - headH;
  const padL = compact ? 0 : fs * 1.7;
  const axW = fs * (compact ? 3.2 : 4.4);
  const labW = compact ? Math.max(fs * 6.4, (W - axW) * 0.26) : Math.max(130, Math.min(250, (W - padL - axW) * 0.22));
  const gap = compact ? fs * 1.4 : Math.max(36, fs * 2.6);
  const colW = Math.max(fs * 3.4, Math.min(compact ? 190 : 320, (W - padL - axW - 2 * labW - gap) / 2));
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
  const nameOf = (b: FigBox) => (b.key === "netWorth" ? "純資産" : b.key === "neg" ? "純資産のマイナス" : compact ? groups[b.key].short : groups[b.key].name);

  const step = tickStep(SC, compact ? 4 : 6);
  const axL = xR + colW + labW + fs * 0.6;
  const axX = axL + axW - fs * 0.6;
  const ticks: number[] = [];
  for (let v = 0; v <= SC + 1; v += step) if (base - v * kLin >= base - plotH - 2) ticks.push(v);
  const hy2 = colTop - fs * 0.55;
  const hy1 = hy2 - fs * (compact ? 1.2 : 1.55);
  const nmF = fs * (compact ? 0.76 : 0.9);
  const amF = fs * (compact ? 1.05 : 1.45);
  const subF = fs * (compact ? 0.78 : 0.86);
  const lh = fs * (compact ? 2.5 : 3.2);
  const fg = drawn.filter((d) => FINANCIAL_GROUPS.includes(d.box.key as BsGroupKey) && d.bot - d.top >= 0.3);
  const labels = (["L", "R"] as const).flatMap((side) => {
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
          {/* 目盛り（右端） */}
          <line x1={axL} x2={axL} y1={base - plotH} y2={base} stroke="var(--line)" />
          {ticks.map((v) => (
            <g key={v}>
              <line x1={axL} x2={axL + 5} y1={base - v * kLin} y2={base - v * kLin} stroke="#9aa3ae" />
              <text x={axX} y={base - v * kLin + fs * 0.27} text-anchor="end" font-size={fs * 0.7} fill="var(--ink-2)">
                {fmt(v)}
              </text>
            </g>
          ))}
          <text x={axX} y={base - plotH - fs * 0.55} text-anchor="end" font-size={fs * 0.66} fill="var(--ink-2)">
            （万円）
          </text>
          {/* 見出し（合計） */}
          <text x={xL + colW / 2} y={hy1} text-anchor="middle" font-size={nmF} font-weight="700" fill="var(--ink-2)">
            {compact ? "資産" : "資産（持っているもの）"}
          </text>
          <text x={xL + colW / 2} y={hy2} text-anchor="middle" font-size={amF} font-weight="700" fill="var(--ink)" class="num">
            {fmt(A)}
            <tspan font-size={amF * 0.6}>万円</tspan>
          </text>
          <text x={xR + colW / 2} y={hy1} text-anchor="middle" font-size={nmF} font-weight="700" fill="var(--ink-2)">
            {compact ? "負債＋純資産" : "負債（借りているもの）＋純資産"}
          </text>
          <text x={xR + colW / 2} y={hy2} text-anchor="middle" font-size={amF} font-weight="700" fill="var(--ink)" class="num">
            {fmt(L + Math.max(0, nw))}
            <tspan font-size={amF * 0.6}>万円</tspan>
          </text>
          <text x={(xL + colW + xR) / 2} y={hy2} text-anchor="middle" font-size={amF} font-weight="700" fill="var(--ink-2)">
            ＝
          </text>
          <line x1={xL - 8} x2={xR + colW + 8} y1={base + 0.5} y2={base + 0.5} stroke="#9aa3ae" stroke-width="1.2" />
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
                aria-label={`${nameOf(d.box)} ${d.box.key === "neg" ? "▲" : ""}${fmt(d.box.value)}万円。押すと内訳`}
                onClick={(e) => {
                  e.stopPropagation();
                  setOpen(open === d.box.key ? null : d.box.key);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    setOpen(open === d.box.key ? null : d.box.key);
                  }
                }}
              >
                {d.parts.map((q) => {
                  if (q.h < 0.3) return null;
                  const isNw = q.key === "netWorth";
                  const isNeg = q.key === "neg";
                  const fill = q.key === "short" ? `url(#${uid}-ht)` : isNeg ? `url(#${uid}-ng)` : isNw ? "var(--bs-netWorth)" : lineColor(q.key, d.box.key);
                  const inset = isNw || isNeg ? 1 : 0;
                  const name = compact && q.key === "insurance" ? "返戻金" : compact && q.key === "corporateDc" ? "DC" : q.label;
                  const showText = !isNw && !isNeg && q.h >= subF * 1.55;
                  const tf = DARK.has(q.key) ? "#fff" : "var(--ink)";
                  const nmW = textW(name, subF);
                  const vW = fmt(q.value).length * subF * 0.6;
                  const ty = q.y + q.h / 2 + subF * 0.36;
                  return (
                    <g key={q.key}>
                      <rect
                        class="bsf-seg"
                        x={d.x + inset}
                        y={q.y + inset}
                        width={colW - 2 * inset}
                        height={Math.max(0, q.h - 2 * inset)}
                        fill={fill}
                        stroke={isNeg ? "var(--base-ink)" : isNw ? "var(--prop)" : "#fff"}
                        stroke-width={isNeg ? 1.8 : 2}
                        stroke-dasharray={isNeg ? "6 4" : undefined}
                      />
                      {showText && nmW + 20 <= colW ? (
                        <text x={d.x + 10} y={ty} font-size={subF} font-weight="700" fill={tf}>
                          {name}
                        </text>
                      ) : null}
                      {showText && nmW + vW + 30 <= colW ? (
                        <text x={d.x + colW - 10} y={ty} text-anchor="end" font-size={subF} font-weight="700" fill={tf} class="num">
                          {fmt(q.value)}
                        </text>
                      ) : null}
                    </g>
                  );
                })}
                {d.box.key === "netWorth" && d.bot - d.top >= fs * 2.4 && !compact ? (
                  <text x={d.x + colW / 2} y={(d.top + d.bot) / 2 + fs * 0.32} text-anchor="middle" font-size={fs * 0.86} fill="var(--prop-ink)" font-weight="700">
                    資産 − 負債
                  </text>
                ) : null}
                {d.box.key === "neg" && d.bot - d.top >= fs * 1.6 ? (
                  <text x={d.x + colW / 2} y={(d.top + d.bot) / 2 + fs * 0.3} text-anchor="middle" font-size={fs * 0.8} fill="var(--ink-2)" font-weight="700" paint-order="stroke" stroke="#fff" stroke-width="4">
                    足りない分
                  </text>
                ) : null}
                {open === d.box.key ? <rect x={d.x - 3} y={d.top - 3} width={colW + 6} height={d.bot - d.top + 6} fill="none" stroke="var(--ink)" stroke-width="2.5" rx="2" /> : null}
              </g>
            ),
          )}
          {/* 枠は今の年も先の年も同じ実線（見込みかどうかは札で示す） */}
          {[xL, xR].map((x) => (
            <rect key={x} x={x - 1.5} y={colTop - 1.5} width={colW + 3} height={base - colTop + 3} fill="none" pointer-events="none" stroke="var(--ink)" stroke-width={1.4} />
          ))}
          {!compact && !noTag ? (
            <g data-bs-kind={est ? "est" : "fact"}>
              <rect x="2" y="2" width={tagW} height={fs * 1.55} rx="4" fill={est ? "#fff" : "var(--ink)"} stroke={est ? "var(--ink-2)" : "var(--ink)"} stroke-width="1.5" />
              <text x="11" y={2 + fs * 1.1} font-size={fs * 0.8} font-weight="700" fill={est ? "var(--ink-2)" : "#fff"}>
                {tag}
              </text>
            </g>
          ) : null}
          {/* 金融資産（3つの層）のかっこ */}
          {!compact && fg.length > 0
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
            const nF = fs * (compact ? 0.8 : 1.0);
            const aF = fs * (compact ? 1.1 : 1.6);
            return (
              <g key={`lb-${d.box.key}`} class="bsf-label" data-bs-label={d.box.key}>
                <path d={`M${ex + (Ls ? -2 : 2)} ${by} L${tx + (Ls ? 5 : -5)} ${y}`} stroke="#9aa3ae" fill="none" />
                <text x={tx} y={y - lh * 0.2} text-anchor={anc} font-size={nF} font-weight="700" fill="var(--ink-2)">
                  {nameOf(d.box)}
                </text>
                <text x={tx} y={y + lh * 0.38} text-anchor={anc} font-size={aF} font-weight="700" fill={d.box.key === "netWorth" ? "var(--prop-ink)" : "var(--ink)"} class="num">
                  {d.box.key === "neg" ? "▲" : ""}
                  {fmt(d.box.value)}
                  <tspan font-size={aF * 0.55}>万円</tspan>
                </text>
              </g>
            );
          })}
        </svg>
      </div>
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
