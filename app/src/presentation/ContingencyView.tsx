// 提示層の部品（万一の想定の画面）。受け取るのは提示用の値（ContingencyModel とその一部）と、想定・年を選ぶ手続きだけ（0016 の2）。
// 主画面と同じ見た目: 白いカード、藍（必要保障額・万一の場合）と灰（死亡保険金・万一なし）の2色、不足は赤の斜線と「▲」
import { AssetChart } from "./AssetChart.tsx";
import { FRAME, linePath, scale } from "./chart.ts";
import { group, man, manDiff } from "./format.ts";
import { Headline, Legend, Verdict } from "./MainView.tsx";
import type { ContingencyModel, ProtectionChartModel, ScenarioModel } from "./model.ts";

// 2つ並べるので、主画面のグラフより小さい枠（文字が小さくなりすぎないように）
const F = { ...FRAME, width: 520, height: 250, left: 58 };

/** 2つの系列の間の面（下は lower、上は upper。upper が上回るところだけ） */
function bandPath(upper: number[], lower: number[], s: ReturnType<typeof scale>): string {
  const parts: string[] = [];
  let run: { i: number }[] = [];
  const flush = () => {
    if (run.length === 0) return;
    const top = run.map(({ i }) => `${s.x(i).toFixed(1)} ${s.y(upper[i] as number).toFixed(1)}`);
    const bottom = [...run].reverse().map(({ i }) => `${s.x(i).toFixed(1)} ${s.y(lower[i] as number).toFixed(1)}`);
    const w = s.band / 2;
    const first = run[0]?.i as number;
    const last = run.at(-1)?.i as number;
    parts.push(
      `M${(s.x(first) - w).toFixed(1)} ${s.y(upper[first] as number).toFixed(1)} L${top.join(" L")} L${(s.x(last) + w).toFixed(1)} ${s.y(upper[last] as number).toFixed(1)} L${(s.x(last) + w).toFixed(1)} ${s.y(lower[last] as number).toFixed(1)} L${bottom.join(" L")} L${(s.x(first) - w).toFixed(1)} ${s.y(lower[first] as number).toFixed(1)} Z`,
    );
    run = [];
  };
  upper.forEach((u, i) => {
    if (u > (lower[i] as number)) run.push({ i });
    else flush();
  });
  flush();
  return parts.join(" ");
}

/** 死亡保険金の階段の面（年ごとの帯） */
function stepArea(values: number[], s: ReturnType<typeof scale>): string {
  if (values.length === 0) return "";
  const w = s.band / 2;
  const pts: string[] = [];
  values.forEach((v, i) => {
    pts.push(`${(s.x(i) - w).toFixed(1)} ${s.y(v).toFixed(1)}`, `${(s.x(i) + w).toFixed(1)} ${s.y(v).toFixed(1)}`);
  });
  const x0 = (s.x(0) - w).toFixed(1);
  const x1 = (s.x(values.length - 1) + w).toFixed(1);
  return `M${x0} ${s.y(0).toFixed(1)} L${pts.join(" L")} L${x1} ${s.y(0).toFixed(1)} Z`;
}

export function ProtectionLegend() {
  return (
    <div class="legend">
      <span class="lg">
        <i />
        必要保障額（金融資産を含まない）
      </span>
      <span class="lg dot">
        <i />
        金融資産を差し引いた額
      </span>
      <span class="lg cover">
        <i />
        加入中の死亡保険金
      </span>
      <span class="lg short">
        <i />
        不足（▲）
      </span>
    </div>
  );
}

export function ProtectionChart({ model, selectedYear, onPick }: { model: ProtectionChartModel; selectedYear: number | null; onPick: (year: number) => void }) {
  const n = model.years.length;
  const s = scale([model.need, model.needWithAssets, model.coverage], n, F);
  const sel = selectedYear === null ? -1 : model.years.indexOf(selectedYear);
  const labelEvery = n > 30 ? 10 : 5;
  const ms = model.maxShort;
  const msi = ms === null ? -1 : model.years.indexOf(ms.year);
  const ri = model.reformFrom === null ? -1 : model.years.indexOf(model.reformFrom);
  return (
    <figure class="pchart" data-protection={model.key}>
      <figcaption>
        <b>{model.title}</b>
        <span class="aside">{model.sub}</span>
      </figcaption>
      <div class="chart">
        <svg viewBox={`0 0 ${F.width} ${F.height}`} role="img" aria-label={`${model.title}の必要保障額の推移（${model.years[0]}年〜${model.years.at(-1)}年）`}>
          <defs>
            <pattern id={`hatch-p-${model.key}`} patternUnits="userSpaceOnUse" width="7" height="7" patternTransform="rotate(45)">
              <rect width="7" height="7" class="hatch-bg" />
              <line x1="0" y1="0" x2="0" y2="7" class="hatch-line" />
            </pattern>
          </defs>
          <text x={F.left - 8} y={F.top - 10} class="unit" text-anchor="end">
            （万円）
          </text>
          {s.ticks.map((t) => (
            <g key={t}>
              <line x1={F.left} x2={F.width - F.right} y1={s.y(t * 10000)} y2={s.y(t * 10000)} class={t === 0 ? "axis0" : "gridline"} />
              <text x={F.left - 8} y={s.y(t * 10000) + 4} class="axis-label" text-anchor="end">
                {group(t)}
              </text>
            </g>
          ))}
          {ri >= 0 ? <rect x={s.x(ri) - s.band / 2} y={F.top} width={s.x(n - 1) - s.x(ri) + s.band} height={F.height - F.top - F.bottom} class="reform-band" /> : null}
          <path d={stepArea(model.coverage, s)} class="area-cover" />
          <path d={bandPath(model.needWithAssets, model.coverage, s)} class="area-pshort" fill={`url(#hatch-p-${model.key})`} />
          <path d={linePath(model.need, s)} class="line-prop" />
          <path d={linePath(model.needWithAssets, s)} class="line-prop2" />
          {sel >= 0 ? <rect x={s.x(sel) - s.band / 2} y={F.top} width={s.band} height={F.height - F.top - F.bottom} class="selband" /> : null}
          {ms !== null && msi >= 0 ? (
            <g>
              <circle cx={s.x(msi)} cy={s.y(model.needWithAssets[msi] as number)} r={4} class="dep-tri" />
              <text x={s.x(msi) + (msi > n / 2 ? -10 : 10)} y={s.y(model.needWithAssets[msi] as number) - 8} class="dep-txt" text-anchor={msi > n / 2 ? "end" : "start"}>
                ▲ 不足 最大{man(ms.amount)}万円（{ms.year}年）
              </text>
            </g>
          ) : null}
          {model.years.map((y, i) =>
            i % labelEvery === 0 || i === n - 1 ? (
              <g key={y}>
                <text x={s.x(i)} y={F.height - F.bottom + 20} class="axis-label" text-anchor="middle">
                  {y}
                </text>
                {model.ages[i] !== null ? (
                  <text x={s.x(i)} y={F.height - F.bottom + 36} class="axis-label sub" text-anchor="middle">
                    {model.ages[i]}歳
                  </text>
                ) : null}
              </g>
            ) : null,
          )}
          {model.years.map((y, i) => (
            <rect key={y} x={s.x(i) - s.band / 2} y={F.top} width={s.band} height={F.height - F.top - F.bottom} class="hit" onClick={() => onPick(y)}>
              <title>
                {y}年に亡くなった場合: 必要保障額 {man(model.need[i] as number)}万円・金融資産を差し引くと {man(model.needWithAssets[i] as number)}万円・死亡保険金 {man(model.coverage[i] as number)}万円
              </title>
            </rect>
          ))}
        </svg>
      </div>
      {sel >= 0 ? (
        <div class="pline">
          <span class="y">{model.years[sel]}年に亡くなった場合</span>
          <span class="kv">
            必要保障額 <b>{man(model.need[sel] as number)}</b>万円
          </span>
          <span class="kv">
            金融資産を差し引くと <b>{man(model.needWithAssets[sel] as number)}</b>万円
          </span>
          <span class="kv">
            死亡保険金 <b>{man(model.coverage[sel] as number)}</b>万円
          </span>
          {(model.needWithAssets[sel] as number) > (model.coverage[sel] as number) ? (
            <span class="kv neg">
              ▲ 不足 <b>{man((model.needWithAssets[sel] as number) - (model.coverage[sel] as number))}</b>万円
            </span>
          ) : null}
        </div>
      ) : null}
      {model.reformFrom !== null ? <p class="cg-notice">{model.reformFrom}年から（2028年4月以後に亡くなる年）の遺族年金は、見直し前の制度で計算しています</p> : null}
    </figure>
  );
}

export function ProtectionCard({ model, selected, onPick }: { model: ContingencyModel["protection"]; selected: { key: string; year: number } | null; onPick: (key: string, year: number) => void }) {
  return (
    <section class="card cg-prot" aria-labelledby="h-prot" aria-busy={model.status === "loading"}>
      <div class="card-h">
        <h2 id="h-prot">必要保障額の推移</h2>
        <span class="aside">「この年に亡くなったら」を1年ずつずらした計算。年を押すと、その年の死亡の想定を下に出します</span>
      </div>
      {model.status === "loading" ? (
        <p class="loading cg-loading" role="status">
          必要保障額の推移を計算しています…
        </p>
      ) : model.status === "error" ? (
        <p class="fatal">計算できませんでした（{model.error}）</p>
      ) : model.charts.length === 0 ? (
        <p class="in-note">遺族（配偶者・子）がいないので、必要保障額は出しません。</p>
      ) : (
        <>
          <ProtectionLegend />
          <div class="pcharts">
            {model.charts.map((c) => (
              <ProtectionChart key={c.key} model={c} selectedYear={selected !== null && selected.key === c.key ? selected.year : null} onPick={(y) => onPick(c.key, y)} />
            ))}
          </div>
        </>
      )}
    </section>
  );
}

export function Breakdown({ model }: { model: ScenarioModel["breakdown"] }) {
  return (
    <table class="cg-break">
      <caption>万一なしと比べた増減（▲は減る）</caption>
      <thead>
        <tr>
          <th scope="col">項目</th>
          <th scope="col">{model.firstYearLabel}</th>
          <th scope="col">{model.totalLabel}</th>
        </tr>
      </thead>
      <tbody>
        {model.rows.map((r) => (
          <tr key={r.label} class={`g-${r.group}`}>
            <th scope="row">{r.label}</th>
            <td class={r.firstYear < 0 ? "neg" : ""}>{manDiff(r.firstYear)}万円</td>
            <td class={r.total < 0 ? "neg" : ""}>{manDiff(r.total)}万円</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function ScenarioCard({
  model,
  selectedYear,
  onSelectScenario,
  onSelectYear,
  onSelectChartYear,
}: {
  model: ContingencyModel;
  selectedYear: number;
  onSelectScenario: (key: string) => void;
  onSelectYear: (year: number) => void;
  onSelectChartYear: (year: number) => void;
}) {
  const sm = model.scenario.model;
  return (
    <section class="card cg-scenario" aria-labelledby="h-sc" aria-busy={model.scenario.status === "loading"}>
      <div class="card-h">
        <h2 id="h-sc">想定を選ぶ</h2>
        <span class="aside">現状の世帯に万一の想定を重ねて計算します</span>
      </div>
      <div class="cg-pick">
        <div class="seg" role="group" aria-label="想定">
          {model.scenarios.map((s) => (
            <button type="button" key={s.key} class={s.key === model.selected ? "on" : ""} aria-pressed={s.key === model.selected} onClick={() => onSelectScenario(s.key)} data-scenario={s.key}>
              {s.label}
            </button>
          ))}
        </div>
        <label class="cg-year">
          起きる年
          <select value={String(model.year)} onChange={(e) => onSelectYear(Number((e.currentTarget as HTMLSelectElement).value))} data-scenario-year>
            {model.yearOptions.map((o) => (
              <option key={o.value} value={String(o.value)}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
      </div>
      {model.scenario.status === "loading" && sm === null ? (
        <p class="loading cg-loading" role="status">
          計算しています…
        </p>
      ) : model.scenario.status === "error" ? (
        <p class="fatal">計算できませんでした（{model.scenario.error}）</p>
      ) : sm !== null ? (
        <div class={model.scenario.stale ? "is-stale" : ""}>
          <h3 class="cg-title">{sm.title}</h3>
          <Headline model={sm.headline} provisional={model.scenario.stale} />
          <Verdict model={sm.verdict} />
          {sm.notices.map((t) => (
            <p class="cg-notice" key={t} data-notice>
              {t}
            </p>
          ))}
          {sm.choice !== null ? (
            <p class="cg-choice" data-choice>
              {sm.choice}
            </p>
          ) : null}
          <div class="chart-top">
            <Legend labels={{ proposal: "万一の場合", current: "万一なし" }} />
          </div>
          <AssetChart model={sm.chart} selectedYear={selectedYear} onSelectYear={onSelectChartYear} />
          <Breakdown model={sm.breakdown} />
        </div>
      ) : null}
    </section>
  );
}
