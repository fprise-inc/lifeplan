// 提示層の部品（主画面）。受け取るのは PresentationModel（とその一部）と、年・根拠を選ぶ手続きだけ（0016 の2）
import type { CashflowTableModel, EventChip, FeeLine, GoalsModel, Headline as HeadlineModel, PresentationModel, Verdict as VerdictModel, YearDetail as YearDetailModel } from "./model.ts";
import { man, manDiff } from "./format.ts";
import { AssetChart } from "./AssetChart.tsx";
import { BalanceChartView, ChartTabs, FlowChartView, type ChartTab } from "./FlowCharts.tsx";

export interface Selectors {
  onSelectYear: (year: number) => void;
  onEvidence: (rowKey: string, year: number) => void;
}

export function Headline({ model, provisional }: { model: HeadlineModel; provisional: boolean }) {
  return (
    <div class="hero">
      <div class="hero-label">
        {model.label}
        {provisional ? <span class="provisional" title="指を離すと正式な計算に置き換わります">確定前</span> : null}
      </div>
      <div class={`hero-num num${model.amount < 0 ? " neg" : ""}`}>
        {man(model.amount)}
        <span class="u">万円</span>
      </div>
      <div class="hero-diff">
        現状より <span class={`d${model.diff < 0 ? " neg" : ""}`}>{manDiff(model.diff)}万円</span>
        <span class="was">
          現状: {man(model.currentAmount)}万円{model.currentNote !== null ? `（${model.currentNote}）` : ""}
        </span>
      </div>
    </div>
  );
}

export function Verdict({ model }: { model: VerdictModel }) {
  return (
    <div class={`verdict ${model.tone}`} aria-live="polite">
      {model.parts.map((p, i) => (p.strong === true ? <b key={i}>{p.text}</b> : <span key={i}>{p.text}</span>))}
    </div>
  );
}

/** FP顧問料の ON/OFF の一文（対策で切り替える） */
export function FeeNote({ model }: { model: FeeLine }) {
  return (
    <div class={`fee-note${model.on ? " on" : ""}`} data-fee-note>
      <span class="fee-tag">{model.on ? "顧問料込み" : "顧問料なし"}</span>
      <span>{model.parts.map((p, i) => (p.strong === true ? <b key={i}>{p.text}</b> : <span key={i}>{p.text}</span>))}</span>
    </div>
  );
}

export function Legend({ labels }: { labels?: { proposal: string; current: string } } = {}) {
  return (
    <div class="legend">
      <span class="lg">
        <i />
        {labels?.proposal ?? "提案"}
      </span>
      <span class="lg base">
        <i />
        {labels?.current ?? "現状"}
      </span>
      <span class="lg short">
        <i />
        不足（▲）
      </span>
    </div>
  );
}

export function YearDetail({ model }: { model: YearDetailModel }) {
  return (
    <div class="yearline">
      <span class="y">{model.year}年</span>
      <span>{model.members}</span>
      <span class="kv">
        収入 <b>{man(model.income)}</b>万円
      </span>
      <span class="kv">
        支出 <b>{man(model.expense)}</b>万円
      </span>
      <span class={`kv${model.net < 0 ? " neg" : ""}`}>
        収支 <b>{man(model.net)}</b>万円
      </span>
      <span class={`kv${model.financial < 0 ? " neg" : ""}`}>
        金融資産 <b>{man(model.financial)}</b>万円
      </span>
    </div>
  );
}

export function EventChips({ events, selectedYear, onSelectYear }: { events: EventChip[]; selectedYear: number; onSelectYear: (y: number) => void }) {
  return (
    <div class="chips" aria-label="ライフイベント">
      {events.map((e, i) => (
        <button type="button" key={i} class={`chip${e.short ? " short" : ""}${e.year === selectedYear ? " on" : ""}`} onClick={() => onSelectYear(e.year)}>
          <span class="ic" aria-hidden="true">
            {e.icon}
          </span>
          <span class="yr">{e.year}</span>
          {e.text}
        </button>
      ))}
    </div>
  );
}

export function GoalCards({ model }: { model: GoalsModel }) {
  return (
    <section class="card">
      <div class="card-h">
        <h2>目標</h2>
        <span class="aside">優先度: 必要／希望／夢</span>
      </div>
      <div class="goal-sum">
        必要な目標 {model.needTotal}件中 <span class="big">{model.needReady}件</span> 準備OK
      </div>
      <div class="goals">
        {model.cards.map((g, i) =>
          g.ready === null ? (
            <div class="goal dream" key={i}>
              <div class="goal-top">
                <span class="goal-cat">{g.category}</span>
                <span class="prio p3">{g.priority}</span>
              </div>
              <h3>{g.title}</h3>
              <div class="when">{g.when}</div>
            </div>
          ) : (
            <div class={`goal${g.ready ? "" : " ng"}`} key={i}>
              <div class="goal-top">
                <span class="goal-cat">{g.category}</span>
                <span class={`prio${g.priority === "希望" ? " p2" : ""}`}>{g.priority}</span>
              </div>
              <h3>{g.title}</h3>
              <div class="when">{g.when}</div>
              {g.amount !== null ? (
                <div class="amt num">
                  {man(g.amount)}
                  <span class="u">万円</span>
                </div>
              ) : null}
              {g.ready ? <span class="st ok">準備できています</span> : <span class="st ng">{g.shortNote}</span>}
            </div>
          ),
        )}
      </div>
    </section>
  );
}

export function CashflowTable({ model, selectedYear, onSelectYear, onEvidence }: { model: CashflowTableModel; selectedYear: number } & Selectors) {
  const sel = (y: number) => (y === selectedYear ? " sel" : "");
  return (
    <section class="card cf-card" aria-labelledby="h-cf">
      <div class="card-h">
        <h2 id="h-cf">{model.title}</h2>
        <span class="aside">単位: 万円／年齢は各年12月末時点／▲はマイナス／数字を押すと根拠が出ます</span>
      </div>
      <div class="cf-wrap">
        <table class="cf">
          <thead>
            <tr class="r-year">
              <th class="stub" scope="col">
                年
              </th>
              {model.years.map((y) => (
                <th scope="col" key={y} class={sel(y)} data-year={y}>
                  <button type="button" class="ybtn" onClick={() => onSelectYear(y)}>
                    {y}
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {model.rows.map((r) => {
              if (r.kind === "group")
                return (
                  <tr class="r-group" key={r.key}>
                    <th class="stub" scope="row">
                      {r.label}
                    </th>
                    <td colSpan={model.years.length} />
                  </tr>
                );
              if (r.kind === "age")
                return (
                  <tr class="r-age" key={r.key}>
                    <th class="stub" scope="row">
                      {r.label}
                    </th>
                    {r.ages.map((a, i) => (
                      <td key={i} class={sel(model.years[i] as number)}>
                        {a ?? ""}
                      </td>
                    ))}
                  </tr>
                );
              if (r.kind === "events")
                return (
                  <tr class="r-ev" key={r.key}>
                    <th class="stub" scope="row">
                      {r.label}
                    </th>
                    {r.icons.map((ics, i) => (
                      <td key={i} class={sel(model.years[i] as number)}>
                        {ics.map((ic, j) => (
                          <span key={j} class={`evi${ic === "！" ? " short" : ""}`}>
                            {ic}
                          </span>
                        ))}
                      </td>
                    ))}
                  </tr>
                );
              return (
                <tr class={r.kind === "total" ? "r-total" : ""} key={r.key}>
                  <th class="stub" scope="row">
                    {r.label}
                  </th>
                  {r.cells.map((c, i) => {
                    const y = model.years[i] as number;
                    const cls = `${c.amount !== null && c.amount < 0 ? "neg" : ""}${c.short === true ? " short" : ""}${sel(y)}`;
                    if (c.amount === null || (c.amount === 0 && r.kind === "value")) return <td key={i} class={cls} />;
                    return (
                      <td key={i} class={cls}>
                        {r.evidence ? (
                          <button type="button" class="cellbtn" onClick={() => onEvidence(r.key, y)} aria-label={`${y}年 ${r.label} の根拠`}>
                            {c.short === true ? <span class="short-lbl">不足</span> : null}
                            {man(c.amount)}
                          </button>
                        ) : (
                          man(c.amount)
                        )}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

/** 資産の推移のグラフ（凡例・グラフ・年の内訳） */
export function AssetChartView({ model, onSelectYear }: { model: PresentationModel; onSelectYear: (y: number) => void }) {
  return (
    <>
      <div class="chart-top">
        <Legend />
        <span class="footnote">グラフの年を押すと、下の表の同じ年が光ります</span>
      </div>
      <AssetChart model={model.chart} selectedYear={model.selectedYear} onSelectYear={onSelectYear} />
      {model.yearDetail !== null ? <YearDetail model={model.yearDetail} /> : null}
    </>
  );
}

/** 主画面の中央（主役の数字・結論・グラフの切り替え・年の内訳・イベント） */
export function MainCard({ model, onSelectYear, chartTab = "assets", onChartTab }: { model: PresentationModel; onSelectYear: (y: number) => void; chartTab?: ChartTab; onChartTab?: (t: ChartTab) => void }) {
  return (
    <section class="card col-main" aria-label="資産残高の見通し">
      <Headline model={model.headline} provisional={model.provisional} />
      <Verdict model={model.verdict} />
      {model.fee !== null ? <FeeNote model={model.fee} /> : null}
      {onChartTab !== undefined ? <ChartTabs tab={chartTab} onTab={onChartTab} /> : null}
      {chartTab === "flows" ? (
        <FlowChartView model={model.flows} selectedYear={model.selectedYear} onSelectYear={onSelectYear} />
      ) : chartTab === "balance" ? (
        <BalanceChartView model={model.balance} selectedYear={model.selectedYear} onSelectYear={onSelectYear} />
      ) : (
        <AssetChartView model={model} onSelectYear={onSelectYear} />
      )}
      <EventChips events={model.events} selectedYear={model.selectedYear} onSelectYear={onSelectYear} />
    </section>
  );
}
