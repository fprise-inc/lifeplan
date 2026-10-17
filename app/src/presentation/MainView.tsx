// 提示層の部品（主画面）。受け取るのは PresentationModel（とその一部）と、年・根拠を選ぶ手続きだけ（0016 の2）。
// 配置（上から）: 案の帯（PlanBand.tsx）→ グラフ（ResultCard）→ 対策（作業の層）→ 生涯キャッシュフロー表（CashflowTable）
import type { ComponentChildren } from "preact";
import { useEffect, useRef } from "preact/hooks";
import type { AgeMark, CashflowTableModel, ExplainModel, FeeLine, GoalsModel, Headline as HeadlineModel, ResultVerdict, Verdict as VerdictModel, VerdictPart } from "./model.ts";
import { man, manDiff } from "./format.ts";
import { CHART_MODES, ExplainBar, MainChart, MainLegend, type ChartMode, type MainChartModel } from "./MainChart.tsx";

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

const Parts = ({ parts }: { parts: VerdictPart[] }) => <>{parts.map((p, i) => (p.strong === true ? <b key={i}>{p.text}</b> : <span key={i}>{p.text}</span>))}</>;

/** 主画面の結論の1文（例: 「B案は100歳まで足ります」と、2行目に基準の案） */
export function ResultVerdictView({ model }: { model: ResultVerdict }) {
  return (
    <p class={`verdict-line ${model.tone}`} aria-live="polite" data-verdict>
      <Parts parts={model.parts} />
      {model.sub.length > 0 ? (
        <span class="v-sub">
          <Parts parts={model.sub} />
        </span>
      ) : null}
    </p>
  );
}

export interface ResultCardProps {
  model: MainChartModel;
  verdict: ResultVerdict;
  provisional: boolean;
  mode: ChartMode;
  onMode: (m: ChartMode) => void;
  explain: { model: ExplainModel; step: number } | null;
  onExplain: (step: number | null) => void;
  ageMark: AgeMark | null;
  onSelectYear: (year: number) => void;
  /** 右の操作の後ろに置くもの（表示の設定のボタン。作業の層が渡す） */
  tools?: ComponentChildren;
  /** 結論の下に置くもの（表示の設定の欄・FP顧問料の一文） */
  below?: ComponentChildren;
}

/** グラフの枠: 結論の1文・グラフの切り替え・説明モード・凡例・グラフ・説明モードの帯 */
export function ResultCard(p: ResultCardProps) {
  const ex = p.explain;
  const step = ex !== null ? Math.max(0, Math.min(ex.model.steps.length - 1, ex.step)) : 0;
  const s = ex?.model.steps[step];
  return (
    <section class="card chart-card" aria-label="グラフ" data-result-card>
      <div class="cc-head">
        {ex !== null && s !== undefined ? (
          <p class="verdict-line" aria-live="polite" data-verdict>
            <span class="ord">
              説明 {step + 1}/{ex.model.steps.length} {s.title}
            </span>
            <Parts parts={s.sentence} />
            <span class="v-sub">{p.model.names.selected}の内容で説明しています</span>
          </p>
        ) : (
          <ResultVerdictView model={p.verdict} />
        )}
        <div class="cc-tools">
          {p.provisional ? (
            <span class="provisional" title="指を離すと正式な計算に置き換わります">
              確定前
            </span>
          ) : null}
          <span class="seg-g" role="group" aria-label="グラフの切り替え">
            {CHART_MODES.map((m) => (
              <button type="button" key={m.id} aria-pressed={ex === null && p.mode === m.id} disabled={ex !== null} onClick={() => p.onMode(m.id)} data-chart-tab={m.id}>
                {m.label}
              </button>
            ))}
          </span>
          <button type="button" class="explain-btn" aria-pressed={ex !== null} onClick={() => p.onExplain(ex !== null ? null : 0)} data-explain-open>
            説明モード
          </button>
          {p.tools ?? null}
        </div>
      </div>
      {p.below ?? null}
      <MainLegend model={p.model} mode={p.mode} explain={ex} />
      <MainChart model={p.model} mode={p.mode} explain={ex} ageMark={p.ageMark} onSelectYear={p.onSelectYear} />
      {ex !== null ? <ExplainBar model={ex.model} step={step} onStep={(i) => p.onExplain(i)} onClose={() => p.onExplain(null)} /> : null}
    </section>
  );
}

/** 表の上の切り替え（見る案・差を表示） */
export interface TableControls {
  plans: { key: string; letter: string }[];
  shown: string;
  onShow: (key: string) => void;
  diff: { on: boolean; disabled: boolean; label: string };
  onDiff: (on: boolean) => void;
}

export interface CashflowTableProps {
  model: CashflowTableModel;
  selectedYear: number;
  onSelectYear: (year: number) => void;
  onEvidence: (rowKey: string, year: number) => void;
  controls?: TableControls;
  /** 表の左上（例: 「B案「65歳まで働く」」） */
  corner?: string;
  /** 値が変わるたびに、選んだ年の列まで横に動かす（グラフで年を押したとき） */
  scrollNonce?: number;
}

export function CashflowTable({ model, selectedYear, onSelectYear, onEvidence, controls, corner, scrollNonce }: CashflowTableProps) {
  const sel = (y: number) => (y === selectedYear ? " sel" : "");
  const wrap = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (scrollNonce === undefined || scrollNonce === 0) return;
    const el = wrap.current;
    const th = el?.querySelector<HTMLElement>(`thead th[data-year="${selectedYear}"]`);
    const stub = el?.querySelector<HTMLElement>(".stub");
    if (el == null || th == null || stub == null) return;
    const reduce = typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    el.scrollTo({ left: Math.max(0, th.offsetLeft - stub.offsetWidth - 120), behavior: reduce ? "auto" : "smooth" });
  }, [scrollNonce]);
  const diffOn = controls?.diff.on === true && !controls.diff.disabled;
  return (
    <section class="card cf-card" aria-labelledby="h-cf" data-cf-card>
      <div class="cf-head">
        <h2 id="h-cf">{model.title}</h2>
        {controls !== undefined ? (
          <>
            <span class="k">表示する案</span>
            <span class="seg-g" role="group" aria-label="表示する案">
              {controls.plans.map((x) => (
                <button type="button" key={x.key} aria-pressed={x.key === controls.shown} onClick={() => controls.onShow(x.key)} data-table-plan={x.key}>
                  {x.letter}
                </button>
              ))}
            </span>
            <label class={`chk${diffOn ? " on" : ""}`}>
              <input type="checkbox" checked={controls.diff.on} disabled={controls.diff.disabled} onChange={(e) => controls.onDiff((e.currentTarget as HTMLInputElement).checked)} data-diff-toggle />
              <span>{controls.diff.label}</span>
            </label>
          </>
        ) : null}
        <span class="cf-note">
          単位: 万円／年齢は各年12月末時点／▲はマイナス／数字を押すと根拠が出ます
          {diffOn ? (
            <span class="chg-key">
              <i />
              基準と違うマス
            </span>
          ) : null}
        </span>
      </div>
      <div class="cf-wrap" ref={wrap}>
        <table class="cf">
          <thead>
            <tr class="r-year">
              <th class="stub" scope="col">
                {corner ?? "年"}
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
              if (r.kind === "diff")
                return (
                  <tr class="r-diff" key={r.key} data-diff-row={r.key}>
                    <th class="stub" scope="row">
                      {r.label}
                    </th>
                    {r.cells.map((v, i) => (
                      <td key={i} class={`${v === null ? "" : v < 0 ? "minus" : Math.round(v / 10000) === 0 ? "zero" : ""}${sel(model.years[i] as number)}`}>
                        {v === null ? "" : manDiff(v)}
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
                    const cls = `${c.amount !== null && c.amount < 0 ? "neg" : ""}${c.short === true ? " short" : ""}${c.changed === true ? " chg" : ""}${sel(y)}`;
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
