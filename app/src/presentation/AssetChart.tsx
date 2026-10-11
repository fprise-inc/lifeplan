// 資産のグラフ（SVG）: 提案＝藍の実線、現状＝灰の破線、不足＝赤の斜線と「▲」の文字（色だけで区別しない）
import { areaAbove, areaBelow, FRAME, linePath, scale } from "./chart.ts";
import { group } from "./format.ts";
import type { ChartModel } from "./model.ts";

export function AssetChart({ model, selectedYear, onSelectYear }: { model: ChartModel; selectedYear: number; onSelectYear: (y: number) => void }) {
  const n = model.years.length;
  const s = scale([model.proposal, model.current], n);
  const f = FRAME;
  const selIdx = model.years.indexOf(selectedYear);
  const labelEvery = n > 60 ? 10 : 5;
  const onKey = (e: KeyboardEvent) => {
    if (selIdx < 0) return;
    const next = e.key === "ArrowRight" ? selIdx + 1 : e.key === "ArrowLeft" ? selIdx - 1 : -1;
    const y = model.years[next];
    if (y !== undefined) {
      e.preventDefault();
      onSelectYear(y);
    }
  };
  const tickText = (t: number) => (t < 0 ? "▲" : "") + group(t);
  return (
    <div class="chart" tabIndex={0} onKeyDown={onKey} role="group" aria-label="金融資産の推移のグラフ。左右の矢印で年を選べます">
      <svg viewBox={`0 0 ${f.width} ${f.height}`} role="img" aria-label={`金融資産の推移（${model.years[0]}年〜${model.years.at(-1)}年）`}>
        <defs>
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
        <path d={areaAbove(model.proposal, s)} class="area-prop" />
        <path d={areaBelow(model.current, s)} class="area-short" />
        <path d={areaBelow(model.proposal, s)} class="area-short" />
        <path d={linePath(model.current, s)} class="line-base" />
        <path d={linePath(model.proposal, s)} class="line-prop" />
        {selIdx >= 0 ? <rect x={s.x(selIdx) - s.band / 2} y={f.top} width={s.band} height={f.height - f.top - f.bottom} class="selband" /> : null}
        {model.depletions.map((d) => {
          const i = model.years.indexOf(d.year);
          if (i < 0) return null;
          const x = s.x(i);
          const y0 = s.y(0);
          return (
            <g key={d.series}>
              <line x1={x} x2={x} y1={y0} y2={f.height - f.bottom} class="dep-line" />
              <path d={`M${x} ${y0 + 2} l-8 14 h16 z`} class={`dep-tri ${d.series === "current" ? "base" : ""}`} />
              <text x={x + 12} y={y0 + 18 + (d.series === "proposal" ? 18 : 0)} class="dep-txt">
                {d.label}
              </text>
            </g>
          );
        })}
        {model.years.map((y, i) =>
          i % labelEvery === 0 || i === n - 1 ? (
            <g key={y}>
              <text x={s.x(i)} y={f.height - f.bottom + 20} class="axis-label" text-anchor="middle">
                {y}
              </text>
              {model.ages[i] !== null ? (
                <text x={s.x(i)} y={f.height - f.bottom + 36} class="axis-label sub" text-anchor="middle">
                  {model.ages[i]}歳
                </text>
              ) : null}
            </g>
          ) : null,
        )}
        {model.years.map((y, i) => (
          <rect key={y} x={s.x(i) - s.band / 2} y={f.top} width={s.band} height={f.height - f.top - f.bottom} class="hit" onClick={() => onSelectYear(y)}>
            <title>{y}年</title>
          </rect>
        ))}
      </svg>
    </div>
  );
}
