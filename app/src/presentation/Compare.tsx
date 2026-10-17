// 案の比較（提示層の部品）: 資産のグラフに案を重ねる部品と、主な数字を並べる表の部品。
// 色だけで区別しないよう、案ごとに線の形（実線・破線・点線…）と印（●■▲◆×）を変え、凡例と表の見出しにも同じ見本を出す。
// どちらも独立した部品で、配置は使う側（画面の大枠）が決める
import { FRAME, linePath, scale } from "./chart.ts";
import { group } from "./format.ts";
import type { CompareChartModel, CompareTableModel } from "./model.ts";

/** 印の形（style 1〜5）。0 は現状（印なし・灰の破線） */
function Marker({ style, x, y }: { style: number; x: number; y: number }) {
  const r = 4.5;
  const cls = `mk mk-${style}`;
  if (style === 1) return <circle cx={x} cy={y} r={r} class={cls} />;
  if (style === 2) return <rect x={x - r} y={y - r} width={r * 2} height={r * 2} class={cls} />;
  if (style === 3) return <path d={`M${x} ${y - r - 1} L${x + r + 1} ${y + r} L${x - r - 1} ${y + r} Z`} class={cls} />;
  if (style === 4) return <path d={`M${x} ${y - r - 1} L${x + r + 1} ${y} L${x} ${y + r + 1} L${x - r - 1} ${y} Z`} class={cls} />;
  if (style === 5) return <path d={`M${x - r} ${y - r} L${x + r} ${y + r} M${x + r} ${y - r} L${x - r} ${y + r}`} class={`${cls} mk-x`} />;
  return null;
}

/** 線と印の見本（凡例・表の見出し） */
export function LineSwatch({ style }: { style: number }) {
  return (
    <svg class="line-swatch" viewBox="0 0 34 12" aria-hidden="true">
      <path d="M1 6 H33" class={`cmp-line cl-${style}`} />
      <Marker style={style} x={17} y={6} />
    </svg>
  );
}

export function CompareChart({ model }: { model: CompareChartModel }) {
  const n = model.years.length;
  const f = FRAME;
  const s = scale(
    model.series.map((x) => x.values),
    n,
  );
  const labelEvery = n > 60 ? 10 : 5;
  const tickText = (t: number) => (t < 0 ? "▲" : "") + group(t);
  return (
    <div class="compare-chart" data-compare-chart>
      <div class="legend">
        {model.series.map((x) => (
          <span class="lg" key={x.key}>
            <LineSwatch style={x.style} />
            {x.name}
          </span>
        ))}
      </div>
      <div class="chart">
        <svg viewBox={`0 0 ${f.width} ${f.height}`} role="img" aria-label={`金融資産の推移の比較（${model.series.map((x) => x.name).join("・")}）`}>
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
          {model.series.map((x) => (
            <g key={x.key}>
              <path d={linePath(x.values, s)} class={`cmp-line cl-${x.style}`} />
              {x.style > 0 ? x.values.map((v, i) => (i % labelEvery === (x.style % labelEvery) || i === n - 1 ? <Marker key={i} style={x.style} x={s.x(i)} y={s.y(v)} /> : null)) : null}
            </g>
          ))}
          {model.years.map((y, i) =>
            i % labelEvery === 0 || i === n - 1 ? (
              <g key={y}>
                <text x={s.x(i)} y={f.height - f.bottom + 20} class="axis-label" text-anchor="middle">
                  {y}
                </text>
                {model.ages[i] != null ? (
                  <text x={s.x(i)} y={f.height - f.bottom + 36} class="axis-label sub" text-anchor="middle">
                    {model.ages[i]}歳
                  </text>
                ) : null}
              </g>
            ) : null,
          )}
        </svg>
      </div>
    </div>
  );
}

export function CompareTable({ model }: { model: CompareTableModel }) {
  return (
    <div class="cmp-table-wrap">
      <table class="cmp-table" data-compare-table>
        <thead>
          <tr>
            <th scope="col" class="stub">
              主な数字
            </th>
            {model.columns.map((c, i) => (
              <th scope="col" key={i}>
                <LineSwatch style={c.style} />
                <span class="cmp-name">{c.name}</span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {model.rows.map((r) => (
            <tr key={r.key}>
              <th scope="row" class="stub">
                {r.label}
              </th>
              {r.cells.map((c, i) => (
                <td key={i} class={c.bad ? "bad" : ""}>
                  <span class="v">{c.text}</span>
                  {c.bad ? <span class="bad-tag">注意</span> : null}
                  {c.diff !== null ? <span class="d">現状より {c.diff}</span> : null}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
