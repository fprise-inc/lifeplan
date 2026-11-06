// 収益不動産のタブの「年ごとの手残りとローン残高」のグラフ（提示層の部品。0128）。受け取るのは RentalChartModel と年を選ぶ手続きだけ。
// 結果のタブのグラフ（MainChart.tsx）の部品をそのまま使う: 枠と年のできごとの丸の置き方（frameOf・eventLayout）、座標（chart.ts）、
// できごとの丸と説明（EventDot.tsx。修繕・売却の「不」）、年と年齢の目盛り（AgeAxis.tsx）、年を指したときの札の置き方（yearPick.ts）、
// 棒の塗りと凡例の見本（StackChart.tsx）、文字の大きさ（ルートの文字の大きさに比例。中・大の切り替えで一緒に大きくなる）。
// - 手残り（税引前・税引後）は年ごとに2本並べた棒（左の目盛り）。マイナスの年の棒は赤い斜線を重ね、0 の線より下に伸びる（結果のタブの赤字の年と同じ印）
// - ローン残高は線（右の目盛り。ローンが無ければ出さない）
// - カーソルを合わせるとその年の数字の札。押すか左右のキーで、その年を指標の年にする（下の表の行を押したのと同じ）
import { useLayoutEffect, useRef, useState } from "preact/hooks";
import { domainOf, linePath, niceStep, scaleOf, type Domain } from "./chart.ts";
import { EVENT_R, EventDotSvg, EventTip, eventLabel, useEventFocus } from "./EventDot.tsx";
import { AgeAxisSvg, ageExtra, yearHead } from "./AgeAxis.tsx";
import { eventGap, eventLayout, frameOf, tickText, useBoxSize } from "./MainChart.tsx";
import { Pattern, Swatch } from "./StackChart.tsx";
import { estimateWidth, indexAt, placeAbove, placeTip } from "./yearPick.ts";
import type { RentalChartModel, Yen } from "./model.ts";

/** 棒の系列の鍵（塗りは CSS の .pbg-<鍵>。StackChart.tsx の PATTERN） */
const BAR_KEYS = { before: "rentalBefore", after: "rentalAfter" } as const;

/** グラフの高さ: 結果のタブのグラフより低く（下に表があるため）。文字を大きくすると少し高く */
export function rentalChartHeight(innerHeight: number, fontPx: number): number {
  const h = (innerHeight - 250 * (fontPx / 16)) * 0.62;
  return Math.round(Math.max(300 * (fontPx / 16), Math.min(440 * (fontPx / 16), h)));
}

/**
 * ローン残高の右の目盛りの範囲（0 から。万円。0 は手残りの 0 の線、最大は上の端）。count は目盛りの数の目安
 * （0 の線から上の端までの高さで決める。手残りのマイナスが大きく 0 の線が上にあるときは、目盛りを減らして重ねない）
 */
export function loanDomain(loan: readonly Yen[], count = 5): Domain {
  const hi = Math.max(0, ...loan) / 10000;
  if (!(hi > 0)) return domainOf([loan]);
  const step = niceStep(hi, count);
  return { min: 0, max: Math.ceil(hi / step - 1e-9) * step, step };
}

export interface RentalChartProps {
  model: RentalChartModel;
  /** 指標を見ている年（細い縦の線を引く） */
  selected: number;
  onYear: (year: number) => void;
  /** 読み上げの名前（例: 「見本ハイツの年ごとの手残りとローン残高」） */
  label: string;
}

export function RentalChart({ model, selected, onYear, label }: RentalChartProps) {
  const box = useRef<HTMLDivElement>(null);
  const svg = useRef<SVGSVGElement>(null);
  const tip = useRef<HTMLDivElement>(null);
  const evTipEl = useRef<HTMLDivElement>(null);
  const tipSize = useBoxSize(tip);
  const evTipSize = useBoxSize(evTipEl);
  const evFocus = useEventFocus<number>();
  const [hover, setHover] = useState<number | null>(null);
  const [size, setSize] = useState<{ w: number; h: number; fs: number }>({ w: 1000, h: 360, fs: 1 });
  // 幅は枠に合わせ、高さは画面の高さに合わせる（文字を大きくしたときも測り直す。結果のタブのグラフと同じ）
  useLayoutEffect(() => {
    const el = box.current;
    if (el === null) return;
    const measure = () => {
      const px = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
      const w = Math.max(300, Math.round(el.clientWidth));
      const h = rentalChartHeight(window.innerHeight, px);
      setSize((s) => (s.w === w && s.h === h && s.fs === px / 16 ? s : { w, h, fs: px / 16 }));
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

  const { years, before, after, loan } = model;
  const n = years.length;
  const fs = size.fs;
  const hasLoan = loan !== null;
  // 右の余白: ローン残高の目盛りの数字の分
  const right = hasLoan ? 58 : 20;
  const evList = model.events.filter((e) => years.includes(e.year));
  const evLay = eventLayout(evList, years, frameOf(size.w, size.h, fs, right), fs);
  const axis = model.axis;
  const f = frameOf(size.w, size.h, fs, right, evList.length > 0 ? evLay.rows : 0, false, axis.length);
  const s = scaleOf(domainOf([before, after]), n, f);
  // ローン残高の右の目盛りは、0 を手残りの 0 の線にそろえ、上の端までを使う（0 の線が2本にならない）
  const zeroY = s.y(0);
  const ld = hasLoan ? loanDomain(loan, Math.max(1, Math.floor((zeroY - f.top) / (16 * fs)))) : null;
  const ly = (v: Yen) => (ld === null || ld.max <= 0 ? zeroY : zeroY - (zeroY - f.top) * (v / 10000 / ld.max));
  const lticks: number[] = [];
  if (ld !== null) for (let t = Math.ceil(ld.min / ld.step - 1e-9) * ld.step; t <= ld.max + ld.step / 1e6; t += ld.step) lticks.push(Math.round(t));

  // 棒: 年ごとに税引前（左）と税引後（右）を並べる
  const bw = Math.max(1.5, s.band * 0.34);
  const gap = Math.min(2, s.band * 0.04);
  const bars: preact.JSX.Element[] = [];
  const negs: preact.JSX.Element[] = [];
  const bar = (key: string, i: number, v: Yen, x: number) => {
    if (v === 0) return;
    const y0 = s.y(0);
    const y1 = s.y(v);
    const r = { x, y: Math.min(y0, y1), width: bw, height: Math.max(0.5, Math.abs(y1 - y0)) };
    bars.push(<rect key={`${key}${i}`} {...r} fill={`url(#pt-${key})`} class={`bar b-${key}`} />);
    if (v < 0) negs.push(<rect key={`n${key}${i}`} {...r} class="area-short rt-neg" data-rental-neg={years[i]} />);
  };
  for (let i = 0; i < n; i++) {
    bar(BAR_KEYS.before, i, before[i] ?? 0, s.x(i) - bw - gap / 2);
    bar(BAR_KEYS.after, i, after[i] ?? 0, s.x(i) + gap / 2);
  }

  // 年のできごと（「不」の丸）
  const evR = EVENT_R * fs;
  const evYs = evLay.row.map((r) => f.height - f.bottom + 4 * fs + evR + r * eventGap(fs));
  const evOn = evFocus.on;
  const evNow = evOn !== null ? evList[evOn] : undefined;
  const evText = evNow !== undefined ? eventLabel(evNow) : "";
  const evPlace =
    evNow !== undefined && evOn !== null ? placeAbove(evLay.x[evOn] as number, (evYs[evOn] as number) - evR, (evYs[evOn] as number) + evR, evTipSize?.w ?? estimateWidth([evText], 13 * fs), evTipSize?.h ?? 30 * fs, f.width, f.height) : null;

  // 年を指したときの札
  const hi = hover !== null ? years.indexOf(hover) : -1;
  const mx = hi >= 0 ? s.x(hi) : 0;
  const head = hi >= 0 ? yearHead(years[hi] as number, model.family[hi]) : "";
  const lines =
    hi >= 0
      ? [
          { key: "before", label: "手残り（税引前）", value: model.text.before[hi] ?? "", neg: (before[hi] ?? 0) < 0 },
          { key: "after", label: "手残り（税引後）", value: model.text.after[hi] ?? "", neg: (after[hi] ?? 0) < 0 },
          ...(hasLoan ? [{ key: "loan", label: "ローン残高", value: model.text.loan[hi] ?? "", neg: false }] : []),
        ]
      : [];
  const evAt = hi >= 0 ? evList.filter((e) => e.year === years[hi]) : [];
  const tipLines = [head, ...lines.map((l) => `${l.label} ${l.value}`), ...evAt.map((e) => `不 ${e.text}`), "押すとこの年の指標になります"];
  const tw = tipSize?.w ?? estimateWidth(tipLines, 13 * fs);
  const th = tipSize?.h ?? (tipLines.length * 19 + 12) * fs;
  const dotYs = hi >= 0 ? [s.y(Math.max(before[hi] ?? 0, after[hi] ?? 0, 0)), ...(hasLoan ? [ly(loan[hi] ?? 0)] : [])] : [0];
  const place = hi >= 0 ? placeTip(mx, Math.min(...dotYs), Math.max(...dotYs), tw, th, f.width, f.height) : null;
  const pct = (v: number, of: number) => `${((v / of) * 100).toFixed(3)}%`;
  const si = years.indexOf(selected);
  // 年の目盛りの数字: 5年ごと。狭い幅で5年の間が文字の幅より狭いときは10年ごと（結果のタブのグラフと同じ決まり）
  const labelStep = n > 5 && Math.abs(s.x(5) - s.x(0)) < 46 * fs ? 10 : 5;

  const yearAt = (e: MouseEvent): number | null => {
    const el = svg.current;
    if (el === null) return null;
    const r = el.getBoundingClientRect();
    const x = (e.clientX - r.left) * (r.width > 0 ? f.width / r.width : 1);
    const i = indexAt(x, f, n);
    return i === null ? null : (years[i] ?? null);
  };
  const onKey = (e: KeyboardEvent) => {
    const dir = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
    if (dir === 0) return;
    const i = Math.max(0, Math.min(n - 1, (si < 0 ? 0 : si) + dir));
    const y = years[i];
    if (y !== undefined) {
      e.preventDefault();
      onYear(y);
    }
  };

  return (
    <div class="chart rt-chart" ref={box} tabIndex={0} onKeyDown={onKey} role="group" aria-label={`${label}のグラフ。カーソルを合わせるとその年の数字が出ます。押すか左右の矢印キーで、その年の指標にします`} data-rental-chart>
      <div class="plot">
        <svg ref={svg} viewBox={`0 0 ${f.width} ${f.height}`} width={f.width} height={f.height} role="img" aria-label={`${label}（${years[0] ?? ""}年〜${years.at(-1) ?? ""}年）`}>
          <defs>
            <Pattern k={BAR_KEYS.before} />
            <Pattern k={BAR_KEYS.after} />
            <pattern id="hatch-short" patternUnits="userSpaceOnUse" width="7" height="7" patternTransform="rotate(45)">
              <rect width="7" height="7" class="hatch-bg" />
              <line x1="0" y1="0" x2="0" y2="7" class="hatch-line" />
            </pattern>
          </defs>
          <text x={f.left - 8} y={f.top - 10} class="unit" text-anchor="end">
            （万円）
          </text>
          {s.ticks.map((tk) => (
            <g key={tk}>
              <line x1={f.left} x2={f.width - f.right} y1={s.y(tk * 10000)} y2={s.y(tk * 10000)} class={tk === 0 ? "axis0" : "gridline"} />
              <text x={f.left - 8} y={s.y(tk * 10000) + 4} class="axis-label" text-anchor="end">
                {tickText(tk)}
              </text>
            </g>
          ))}
          {ld !== null ? (
            <g class="rt-loan-axis" data-rental-loan-axis>
              <text x={f.width - f.right + 6} y={f.top - 10} class="unit rt-loan-unit" text-anchor="start">
                残高
              </text>
              {lticks.map((tk) => (
                <text key={tk} x={f.width - f.right + 6} y={ly(tk * 10000) + 4} class="axis-label rt-loan-tick" text-anchor="start">
                  {tickText(tk)}
                </text>
              ))}
            </g>
          ) : null}
          {si >= 0 && hi < 0 ? <line x1={s.x(si)} x2={s.x(si)} y1={f.top - 4} y2={f.height - f.bottom} class="hv-guide pinned" data-rental-selected={selected} /> : null}
          <g class="rt-bars">{bars}</g>
          <g class="rt-negs">{negs}</g>
          <line x1={f.left} x2={f.width - f.right} y1={s.y(0)} y2={s.y(0)} class="axis0" />
          {hasLoan ? <path d={linePath([...loan], { ...s, y: ly })} class="rt-loan-line" data-rental-loan /> : null}
          {hi >= 0 ? <line x1={mx} x2={mx} y1={f.top - 4} y2={f.height - f.bottom} class="hv-guide" /> : null}
          {evNow !== undefined ? <line x1={s.x(years.indexOf(evNow.year))} x2={s.x(years.indexOf(evNow.year))} y1={f.top - 4} y2={f.height - f.bottom} class="hv-guide ev-guide" /> : null}
          <AgeAxisSvg years={years} axis={axis} x={s.x} show={(y, i) => y % labelStep === 0 || (i === 0 && n < 10)} yearY={f.height - (24 + ageExtra(axis.length)) * fs} left={f.left} fs={fs} />
          {hi >= 0 && hasLoan ? (
            <g class="hv-dots" data-year-mark>
              <circle cx={mx} cy={ly(loan[hi] ?? 0)} r={5.5 * fs} class="hv-dot rt-loan-dot" />
            </g>
          ) : null}
          <rect
            x={f.left}
            y={f.top - 4}
            width={Math.max(0, f.width - f.left - f.right)}
            height={Math.max(0, f.height - f.top + 4)}
            class="hit-area"
            data-hit-area
            onPointerMove={(e) => {
              const y = yearAt(e);
              if (y !== hover) setHover(y);
            }}
            onPointerLeave={() => setHover(null)}
            onClick={(e) => {
              const y = yearAt(e);
              if (y !== null) onYear(y);
            }}
          />
          {/* できごとの丸は、年を読む面より上に置く（カーソルを合わせられるように） */}
          <g class="evs">
            {evList.map((e, j) => (
              <EventDotSvg key={`${e.year}-${j}`} chip={e} x={evLay.x[j] as number} y={evYs[j] as number} r={evR} on={evOn === j} handlers={evFocus.bind(j)} />
            ))}
          </g>
        </svg>
        {place !== null ? (
          <div ref={tip} class="sel-lbl year-tip" style={{ left: pct(place.left, f.width), top: pct(place.top, f.height) }} data-year-tip={place.side} data-rental-tip>
            <div class="yt-h">{head}</div>
            {lines.map((l) => (
              <div class="yt-v" key={l.key}>
                <span class="yt-s">
                  {l.key === "loan" ? <i class="yt-dot rt-loan-dot" aria-hidden="true" /> : <Swatch k={l.key === "before" ? BAR_KEYS.before : BAR_KEYS.after} />}
                  {l.label} <b class={l.neg ? "neg" : ""}>{l.value}</b>
                </span>
              </div>
            ))}
            {evAt.map((e, j) => (
              <div class="yt-x" key={j}>
                <span class="ev-ic" aria-hidden="true">
                  {e.icon}
                </span>{" "}
                {e.text}
              </div>
            ))}
          </div>
        ) : null}
        {evNow !== undefined && evPlace !== null ? <EventTip chip={evNow} tipRef={evTipEl} style={{ left: pct(evPlace.left, f.width), top: pct(evPlace.top, f.height) }} /> : null}
      </div>
    </div>
  );
}

/** 凡例（結果のタブのグラフの凡例と同じ書き方。マイナスの年があるときだけその印） */
export function RentalChartLegend({ model }: { model: RentalChartModel }) {
  const neg = model.before.some((v) => v < 0) || model.after.some((v) => v < 0);
  return (
    <div class="legend main-legend rt-legend-chart" data-rental-chart-legend>
      <span class="lg">
        <Swatch k={BAR_KEYS.before} />
        手残り（税引前）
      </span>
      <span class="lg">
        <Swatch k={BAR_KEYS.after} />
        手残り（税引後）
      </span>
      {model.loan !== null ? (
        <span class="lg rt-loan">
          <i />
          ローン残高（右の目盛り）
        </span>
      ) : null}
      {neg ? (
        <span class="lg short">
          <i />
          手残りがマイナスの年（▲）
        </span>
      ) : null}
      {model.events.length > 0 ? (
        <span class="lg rt-ev">
          <span class="ev-dot rt-ev-dot" aria-hidden="true">
            <span class="ev-dot-t">不</span>
          </span>
          売却・大きな修繕
        </span>
      ) : null}
    </div>
  );
}
