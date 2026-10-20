// 資産と負債の推移（提示層の部品。資産と負債のタブの図の下）: 年ごとに資産を上・負債を下に積んだ棒と、純資産の線。基準のプランの純資産を点線で重ねる。
// 今の年は事実（はっきりした色）、先の年は見込み（少し薄い色）。押すとその年のバランスシートに（← → キーでも動かせる）。
// 縦の目盛りは全部のプランの中で決める（プランを切り替えても目盛りが動かない）
import { useState } from "preact/hooks";
import { useBoxSize } from "./BsFigure.tsx";
import { group, man } from "./format.ts";
import type { BsPlanModel, BsYearModel, Yen } from "./model.ts";

/** 推移の積み上げの区分（上に積む資産・下に積む負債）。色は balance.css */
export const TREND_ASSETS: readonly { key: string; label: string; of: (y: BsYearModel) => Yen }[] = [
  { key: "liquid", label: "すぐ使えるお金", of: (y) => sumWhere(y, (l) => l.group === "liquid") },
  { key: "market", label: "値動きのある運用", of: (y) => sumWhere(y, (l) => l.group === "market") },
  { key: "locked", label: "引き出せないお金", of: (y) => sumWhere(y, (l) => l.group === "locked") },
  { key: "realEstate", label: "不動産", of: (y) => sumWhere(y, (l) => l.key === "home" || l.key === "realEstateOther") },
  { key: "other", label: "車・その他", of: (y) => sumWhere(y, (l) => l.group === "illiquid" && l.key !== "home" && l.key !== "realEstateOther") },
];
export const TREND_DEBTS: readonly { key: string; label: string; of: (y: BsYearModel) => Yen }[] = [
  { key: "mortgage", label: "住宅ローン", of: (y) => sumWhere(y, (l) => l.group === "mortgage") },
  { key: "debt", label: "その他の負債", of: (y) => sumWhere(y, (l) => l.group === "debt" && l.key !== "short") },
  { key: "short", label: "資金の不足", of: (y) => y.shortfall },
];

function sumWhere(y: BsYearModel, p: (l: BsYearModel["lines"][number]) => boolean): Yen {
  return y.lines.reduce((s, l) => (p(l) ? s + l.amount : s), 0);
}

/** 縦の目盛りの範囲（円。2,000万円の刻みに丸める）: 全部のプランの資産の合計の最大と、負債の合計・純資産の最小 */
export function trendRange(plans: readonly BsPlanModel[]): { max: Yen; min: Yen; step: Yen } {
  let mx = 0;
  let mnv = 0;
  for (const p of plans)
    for (const y of p.years) {
      mx = Math.max(mx, y.totalAssets);
      mnv = Math.min(mnv, -y.totalLiabilities, y.netWorth);
    }
  const span = mx - mnv;
  const step = span > 160_000_000 ? 40_000_000 : span > 80_000_000 ? 20_000_000 : span > 30_000_000 ? 10_000_000 : 5_000_000;
  return { max: Math.max(step, Math.ceil(mx / step) * step), min: Math.floor(mnv / step) * step, step };
}

export function TrendLegend({ base }: { base: string | null }) {
  return (
    <div class="bst-legend" aria-hidden="true">
      {TREND_ASSETS.map((s) => (
        <span class="bl" key={s.key}>
          <i style={{ background: `var(--bs-g-${s.key})` }} />
          {s.label}
        </span>
      ))}
      {TREND_DEBTS.map((s) => (
        <span class="bl" key={s.key}>
          <i class={s.key === "short" ? "ht" : ""} style={s.key === "short" ? undefined : { background: `var(--bs-t-${s.key})` }} />
          {s.label}
        </span>
      ))}
      <span class="bl">
        <i class="ln" />
        純資産
      </span>
      {base !== null ? (
        <span class="bl">
          <i class="dl" />
          純資産 {base}
        </span>
      ) : null}
      <span class="bl note">今の年は事実、先の年は見込み（少し薄い色）</span>
    </div>
  );
}

export interface BsTrendProps {
  plan: BsPlanModel;
  /** 点線で重ねるプラン（基準）。同じなら null */
  base: BsPlanModel | null;
  range: { max: Yen; min: Yen; step: Yen };
  /** 印を付ける年の番号（1つ、または3時点） */
  marks: readonly number[];
  onPick: (index: number) => void;
  height: number;
}

export function BsTrend({ plan, base, range, marks, onPick, height }: BsTrendProps) {
  const { ref, w, fs: px } = useBoxSize<HTMLDivElement>(1100);
  const [hover, setHover] = useState<number | null>(null);
  const fs = px;
  const W = Math.max(400, w);
  const H = Math.round(height * (px / 16 > 1.1 ? 1.08 : 1));
  const m = { l: fs * 3.6, r: 12, t: fs * 1.4, b: fs * 2.6 };
  const pw = W - m.l - m.r;
  const ph = H - m.t - m.b;
  const ys = plan.years;
  const N = ys.length;
  const X = (i: number) => m.l + (pw * (i + 0.5)) / N;
  const Y = (v: Yen) => m.t + (ph * (range.max - v)) / (range.max - range.min);
  const bw = (pw / N) * 0.72;
  const idxAt = (clientX: number, el: Element) => {
    const b = el.getBoundingClientRect();
    return Math.max(0, Math.min(N - 1, Math.floor(((clientX - b.left) / b.width) * N)));
  };
  const grid: number[] = [];
  for (let v = range.min; v <= range.max; v += range.step) grid.push(v);
  const path = (p: BsPlanModel) => p.years.map((y, i) => `${i === 0 ? "M" : "L"}${X(i).toFixed(1)} ${Y(y.netWorth).toFixed(1)}`).join(" ");
  const tickEvery = N > 40 ? 5 : N > 20 ? 5 : 2;
  const hv = hover !== null ? ys[hover] : undefined;
  const hb = hover !== null && base !== null ? base.years[hover] : undefined;
  const tipLeft = hover !== null ? (X(hover) + 16 + 270 > W - 4 ? X(hover) - 16 - 270 : X(hover) + 16) : 0;
  return (
    <div class="bst" ref={ref} data-bs-trend>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        width={W}
        height={H}
        role="slider"
        tabIndex={0}
        aria-label="資産と負債の推移。左右のキーで年を動かします"
        aria-valuemin={ys[0]?.year}
        aria-valuemax={ys.at(-1)?.year}
        aria-valuenow={ys[marks[0] ?? 0]?.year}
        onKeyDown={(e) => {
          const cur = marks[0] ?? 0;
          if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
            e.preventDefault();
            onPick(Math.max(0, Math.min(N - 1, cur + (e.key === "ArrowRight" ? 1 : -1))));
          }
        }}
      >
        <defs>
          <pattern id="bst-ht" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <rect width="6" height="6" fill="var(--bs-short)" />
            <line x1="0" y1="0" x2="0" y2="6" stroke="var(--bs-short-line)" stroke-width="2" />
          </pattern>
        </defs>
        {grid.map((v) => (
          <g key={v}>
            <line x1={m.l} x2={m.l + pw} y1={Y(v)} y2={Y(v)} stroke="var(--line-2)" />
            <text x={m.l - 6} y={Y(v) + fs * 0.28} text-anchor="end" font-size={fs * 0.74} fill="var(--ink-2)">
              {man(v)}
            </text>
          </g>
        ))}
        <text x={m.l - 6} y={m.t - fs * 0.55} text-anchor="end" font-size={fs * 0.7} fill="var(--ink-2)">
          （万円）
        </text>
        {ys.map((y, i) => {
          const op = y.fact ? undefined : 0.72;
          let top = 0;
          let bot = 0;
          return (
            <g key={y.year} class="bst-bar">
              {TREND_ASSETS.map((s) => {
                const v = s.of(y);
                if (v <= 0) return null;
                const r = <rect key={s.key} x={X(i) - bw / 2} y={Y(top + v)} width={bw} height={Math.max(0, Y(top) - Y(top + v))} fill={`var(--bs-g-${s.key})`} fill-opacity={op} />;
                top += v;
                return r;
              })}
              {TREND_DEBTS.map((s) => {
                const v = s.of(y);
                if (v <= 0) return null;
                const r = <rect key={s.key} x={X(i) - bw / 2} y={Y(bot)} width={bw} height={Math.max(0, Y(bot - v) - Y(bot))} fill={s.key === "short" ? "url(#bst-ht)" : `var(--bs-t-${s.key})`} fill-opacity={s.key === "short" ? undefined : op} />;
                bot -= v;
                return r;
              })}
            </g>
          );
        })}
        <line x1={m.l} x2={m.l + pw} y1={Y(0)} y2={Y(0)} stroke="#6b7380" stroke-width="1.2" />
        {base !== null ? <path d={path(base)} fill="none" stroke="var(--base-ink)" stroke-width="2" stroke-dasharray="6 5" data-bst-base /> : null}
        <path d={path(plan)} fill="none" stroke="var(--prop)" stroke-width="var(--lw-prop)" data-bst-nw />
        {ys.map((y, i) =>
          i === 0 || (y.age !== null ? y.age % 5 === 0 : (y.year - (ys[0]?.year ?? 0)) % tickEvery === 0) ? (
            <g key={`t${y.year}`}>
              <text x={X(i)} y={m.t + ph + fs * 1.05} text-anchor="middle" font-size={fs * 0.72} fill="var(--ink-2)">
                {y.year}
              </text>
              {y.age !== null ? (
                <text x={X(i)} y={m.t + ph + fs * 2.0} text-anchor="middle" font-size={fs * 0.66} fill="var(--ink-2)">
                  {y.age}歳
                </text>
              ) : null}
            </g>
          ) : null,
        )}
        <rect x={m.l} y={m.t} width={pw} height={ph} fill="none" stroke="var(--line)" />
        {marks.map((si) => {
          const y = ys[si];
          if (y === undefined) return null;
          const lx = Math.min(Math.max(X(si), m.l + 40), m.l + pw - 40);
          return (
            <g key={`m${si}`} data-bst-mark={y.year}>
              <line x1={X(si)} x2={X(si)} y1={m.t} y2={m.t + ph} stroke="var(--ink)" stroke-width="1.5" />
              <circle cx={X(si)} cy={Y(y.netWorth)} r="5.5" fill="var(--prop)" stroke="#fff" stroke-width="2" />
              <text x={lx} y={m.t - fs * 0.35} text-anchor="middle" font-size={fs * 0.8} font-weight="700" fill="var(--ink)">
                {y.year}年
              </text>
            </g>
          );
        })}
        {hover !== null && hv !== undefined ? (
          <g pointer-events="none">
            <line x1={X(hover)} x2={X(hover)} y1={m.t} y2={m.t + ph} stroke="var(--ink-2)" stroke-dasharray="3 3" />
            {hb !== undefined ? <circle cx={X(hover)} cy={Y(hb.netWorth)} r="4.5" fill="#fff" stroke="var(--base-ink)" stroke-width="2" /> : null}
            <circle cx={X(hover)} cy={Y(hv.netWorth)} r="5.5" fill="var(--prop)" stroke="#fff" stroke-width="2" />
          </g>
        ) : null}
        <rect
          x={m.l}
          y={m.t}
          width={pw}
          height={ph + m.b}
          fill="transparent"
          style={{ cursor: "pointer" }}
          onMouseMove={(e) => setHover(idxAt(e.clientX, e.currentTarget as Element))}
          onMouseLeave={() => setHover(null)}
          onClick={(e) => {
            e.stopPropagation();
            onPick(idxAt(e.clientX, e.currentTarget as Element));
          }}
        />
      </svg>
      {hover !== null && hv !== undefined ? (
        <div class="bst-tip" style={{ left: `${tipLeft}px`, top: `${m.t + 24}px` }} data-bst-tip>
          <div class="tt">
            {hv.year}年<small>{hv.members}</small>
          </div>
          <div class="r">
            <span>資産</span>
            <span class="num">{group(Math.round(hv.totalAssets / 10000))}万円</span>
          </div>
          <div class="r">
            <span>負債</span>
            <span class="num">{group(Math.round(hv.totalLiabilities / 10000))}万円</span>
          </div>
          <div class="r tot">
            <span>純資産 {plan.name}</span>
            <span class="num">{man(hv.netWorth)}万円</span>
          </div>
          {hb !== undefined && base !== null ? (
            <div class="r">
              <span>純資産 {base.name}</span>
              <span class="num">{man(hb.netWorth)}万円</span>
            </div>
          ) : null}
          <div class="pin">押すと、この年のバランスシートになります</div>
        </div>
      ) : null}
    </div>
  );
}
