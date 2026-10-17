// 積み上げの棒グラフ（SVG）: 収支の推移・資産と負債の推移・説明モードで使う。
// 0 より上に積む系列（収入・資産）と、0 より下に積む系列（支出・負債。値は正の額で渡す）。
// 系列は落ち着いた色に加えて塗りの模様を変え、凡例にも同じ模様を出す（色だけで区別しない）。
// 赤字の年・不足は赤の斜線と「▲」で示す
import { FRAME, linePath, scale } from "./chart.ts";
import { group, man } from "./format.ts";
import type { StackSeries, Yen } from "./model.ts";

/** 系列の鍵 → 模様（solid・stripe・dots・cross・hline）。色は CSS の .pbg-<鍵> */
export const PATTERN: Readonly<Record<string, string>> = {
  salary: "solid",
  work: "solid",
  pension: "stripe",
  incomeOther: "dots",
  living: "solid",
  housing: "hline",
  education: "stripe",
  insurance: "dots",
  expenseOther: "cross",
  deposit: "solid",
  nisa: "stripe",
  dc: "dots",
  assetOther: "cross",
  mortgage: "hline",
  debtOther: "cross",
};

function Pattern({ k }: { k: string }) {
  const p = PATTERN[k] ?? "solid";
  return (
    <pattern id={`pt-${k}`} patternUnits="userSpaceOnUse" width="6" height="6" patternTransform={p === "stripe" ? "rotate(45)" : undefined}>
      <rect width="6" height="6" class={`pbg-${k}`} />
      {p === "stripe" ? <line x1="0" y1="0" x2="0" y2="6" class="pfg" /> : null}
      {p === "hline" ? <line x1="0" y1="3" x2="6" y2="3" class="pfg" /> : null}
      {p === "dots" ? <circle cx="3" cy="3" r="1.1" class="pfg-dot" /> : null}
      {p === "cross" ? <path d="M0 0L6 6M6 0L0 6" class="pfg" /> : null}
    </pattern>
  );
}

/** 凡例の見本（同じ模様の小さな四角） */
export function Swatch({ k }: { k: string }) {
  return (
    <svg class="swatch" viewBox="0 0 16 12" aria-hidden="true">
      <defs>
        <Pattern k={k} />
      </defs>
      <rect x="0.5" y="0.5" width="15" height="11" fill={`url(#pt-${k})`} class="swatch-box" />
    </svg>
  );
}

export interface StackChartProps {
  years: number[];
  ages: (number | null)[];
  up: StackSeries[];
  down: StackSeries[];
  /** 0 より下に赤の斜線で積む額（不足。正の額） */
  hatchedDown?: Yen[];
  /** 線（純資産・金融資産） */
  line?: { label: string; values: Yen[] } | null;
  /** 赤字などの印を付ける年 */
  flags?: boolean[];
  selectedYear: number | null;
  onSelectYear?: (year: number) => void;
  label: string;
}

export function StackChart(p: StackChartProps) {
  const n = p.years.length;
  const f = FRAME;
  const upTot = p.years.map((_, i) => p.up.reduce((s, x) => s + Math.max(0, x.values[i] ?? 0), 0));
  const downTot = p.years.map((_, i) => p.down.reduce((s, x) => s + Math.max(0, x.values[i] ?? 0), 0) + Math.max(0, p.hatchedDown?.[i] ?? 0));
  const s = scale([upTot, downTot.map((v) => -v), p.line?.values ?? []], n);
  const w = Math.max(2, s.band * 0.72);
  const selIdx = p.selectedYear === null ? -1 : p.years.indexOf(p.selectedYear);
  const labelEvery = n > 60 ? 10 : 5;
  const keys = [...p.up, ...p.down].map((x) => x.key);
  const onKey = (e: KeyboardEvent) => {
    if (selIdx < 0 || p.onSelectYear === undefined) return;
    const next = e.key === "ArrowRight" ? selIdx + 1 : e.key === "ArrowLeft" ? selIdx - 1 : -1;
    const y = p.years[next];
    if (y !== undefined) {
      e.preventDefault();
      p.onSelectYear(y);
    }
  };
  const bars: preact.JSX.Element[] = [];
  for (let i = 0; i < n; i++) {
    const x = s.x(i) - w / 2;
    let acc = 0;
    for (const sr of p.up) {
      const v = Math.max(0, sr.values[i] ?? 0);
      if (v === 0) continue;
      const y0 = s.y(acc);
      const y1 = s.y(acc + v);
      bars.push(<rect key={`u${sr.key}${i}`} x={x} y={y1} width={w} height={Math.max(0.5, y0 - y1)} fill={`url(#pt-${sr.key})`} class={`bar b-${sr.key}`} />);
      acc += v;
    }
    acc = 0;
    for (const sr of p.down) {
      const v = Math.max(0, sr.values[i] ?? 0);
      if (v === 0) continue;
      const y0 = s.y(-acc);
      const y1 = s.y(-acc - v);
      bars.push(<rect key={`d${sr.key}${i}`} x={x} y={y0} width={w} height={Math.max(0.5, y1 - y0)} fill={`url(#pt-${sr.key})`} class={`bar b-${sr.key}`} />);
      acc += v;
    }
    const hv = Math.max(0, p.hatchedDown?.[i] ?? 0);
    if (hv > 0) bars.push(<rect key={`h${i}`} x={x} y={s.y(-acc)} width={w} height={Math.max(0.5, s.y(-acc - hv) - s.y(-acc))} class="area-short" />);
  }
  // 赤字の年: 下の帯（赤の斜線）。続く年のまとまりの初めに「▲」
  const flagBand: preact.JSX.Element[] = [];
  const bandY = f.height - f.bottom - 9;
  (p.flags ?? []).forEach((on, i) => {
    if (!on) return;
    flagBand.push(<rect key={`f${i}`} x={s.x(i) - s.band / 2} y={bandY} width={s.band} height={9} class="flag-band" />);
    if (i === 0 || p.flags?.[i - 1] !== true)
      flagBand.push(
        <text key={`ft${i}`} x={s.x(i) - s.band / 2} y={bandY - 3} class="flag-txt">
          ▲
        </text>,
      );
  });
  const tickText = (t: number) => (t < 0 ? "▲" : "") + group(t);
  return (
    <div class="chart stack" tabIndex={p.onSelectYear !== undefined ? 0 : undefined} onKeyDown={onKey} role="group" aria-label={`${p.label}。左右の矢印で年を選べます`}>
      <svg viewBox={`0 0 ${f.width} ${f.height}`} role="img" aria-label={`${p.label}（${p.years[0]}年〜${p.years.at(-1)}年）`}>
        <defs>
          {keys.map((k) => (
            <Pattern key={k} k={k} />
          ))}
          <pattern id="hatch-short" patternUnits="userSpaceOnUse" width="7" height="7" patternTransform="rotate(45)">
            <rect width="7" height="7" class="hatch-bg" />
            <line x1="0" y1="0" x2="0" y2="7" class="hatch-line" />
          </pattern>
        </defs>
        <text x={f.left - 8} y={f.top - 10} class="unit" text-anchor="end">
          （万円）
        </text>
        {s.ticks.map((t) => (
          <g key={t}>
            <line x1={f.left} x2={f.width - f.right} y1={s.y(t * 10000)} y2={s.y(t * 10000)} class={t === 0 ? "axis0" : "gridline"} />
            <text x={f.left - 8} y={s.y(t * 10000) + 4} class="axis-label" text-anchor="end">
              {tickText(t)}
            </text>
          </g>
        ))}
        {bars}
        {flagBand}
        {p.line != null ? <path d={linePath(p.line.values, s)} class="line-prop line-over" /> : null}
        {selIdx >= 0 ? <rect x={s.x(selIdx) - s.band / 2} y={f.top} width={s.band} height={f.height - f.top - f.bottom} class="selband" /> : null}
        {p.years.map((y, i) =>
          i % labelEvery === 0 || i === n - 1 ? (
            <g key={y}>
              <text x={s.x(i)} y={f.height - f.bottom + 20} class="axis-label" text-anchor="middle">
                {y}
              </text>
              {p.ages[i] != null ? (
                <text x={s.x(i)} y={f.height - f.bottom + 36} class="axis-label sub" text-anchor="middle">
                  {p.ages[i]}歳
                </text>
              ) : null}
            </g>
          ) : null,
        )}
        {p.onSelectYear !== undefined
          ? p.years.map((y, i) => (
              <rect key={y} x={s.x(i) - s.band / 2} y={f.top} width={s.band} height={f.height - f.top - f.bottom} class="hit" onClick={() => p.onSelectYear?.(y)}>
                <title>{y}年</title>
              </rect>
            ))
          : null}
      </svg>
    </div>
  );
}

/** 凡例（上に積む系列・下に積む系列・そのほかの印） */
export function StackLegend({ up, down, extra }: { up: StackSeries[]; down: StackSeries[]; extra?: preact.JSX.Element | null }) {
  return (
    <div class="legend stack-legend">
      {up.map((s) => (
        <span class="lg" key={s.key}>
          <Swatch k={s.key} />
          {s.label}
        </span>
      ))}
      {down.length > 0 ? <span class="lg-sep" aria-hidden="true" /> : null}
      {down.map((s) => (
        <span class="lg" key={s.key}>
          <Swatch k={s.key} />
          {s.label}
        </span>
      ))}
      {extra ?? null}
    </div>
  );
}

/** 選んだ年の内訳の1行 */
export function YearBreakdown({ year, index, groups, tail }: { year: number; index: number; groups: { label: string; series: StackSeries[] }[]; tail?: { label: string; amount: Yen; bad?: boolean }[] }) {
  return (
    <div class="yearline stack-year">
      <span class="y">{year}年</span>
      <span class="kv-unit">（万円）</span>
      {groups.map((g) => (
        <span class="kv-group" key={g.label}>
          <b class="kv-h">{g.label}</b>
          {g.series
            .filter((s) => (s.values[index] ?? 0) !== 0)
            .map((s) => (
              <span class="kv" key={s.key}>
                {s.label} <b>{man(s.values[index] ?? 0)}</b>
              </span>
            ))}
        </span>
      ))}
      {(tail ?? []).map((t) => (
        <span class={`kv${t.bad === true ? " neg" : ""}`} key={t.label}>
          {t.label} <b>{man(t.amount)}</b>万円
        </span>
      ))}
    </div>
  );
}
