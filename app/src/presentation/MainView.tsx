// 提示層の部品（主画面）。受け取るのは PresentationModel（とその一部）と、年・根拠を選ぶ手続きだけ（0016 の2）。
// 配置（上から）: 案の帯（PlanBand.tsx）→ グラフ（ResultCard）→ 対策（作業の層）→ 生涯キャッシュフロー表（CashflowTable）
import type { ComponentChildren } from "preact";
import { useEffect, useLayoutEffect, useRef, useState } from "preact/hooks";
import type { AgeMark, CashflowTableModel, EventChip, ExplainModel, FeeLine, GoalsModel, Headline as HeadlineModel, ResultVerdict, Verdict as VerdictModel, VerdictPart } from "./model.ts";
import { PipButton } from "./ChartPip.tsx";
import { EventDotHtml, EventTip, eventLabel, placeFixedAbove, useEventFocus } from "./EventDot.tsx";
import { man, manDiff } from "./format.ts";
import { CHART_MODES, ExplainBar, MainChart, MainLegend, multiOn, type ChartLayout, type ChartMode, type MainChartModel } from "./MainChart.tsx";
import { MultiLegend } from "./planLines.tsx";

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
        <span class="aside">優先度: 必ず／できれば</span>
      </div>
      <div class="goal-sum">
        「必ず」の目標 {model.needTotal}件中 <span class="big">{model.needReady}件</span> 準備OK
      </div>
      <div class="goals">
        {model.cards.map((g, i) =>
          g.ready === null ? (
            <div class="goal dream" key={i}>
              <div class="goal-top">
                <span class="goal-cat">{g.category}</span>
                <span class="prio p2">{g.priority}</span>
              </div>
              <h3>{g.title}</h3>
              <div class="when">{g.when}</div>
            </div>
          ) : (
            <div class={`goal${g.ready ? "" : " ng"}`} key={i}>
              <div class="goal-top">
                <span class="goal-cat">{g.category}</span>
                <span class={`prio${g.priority === "できれば" ? " p2" : ""}`}>{g.priority}</span>
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
  /** 比べ方（省略は重ねる） */
  layout?: ChartLayout;
  explain: { model: ExplainModel; step: number } | null;
  onExplain: (step: number | null) => void;
  ageMark: AgeMark | null;
  /** グラフで固定した年（固定していなければ null） */
  pinnedYear: number | null;
  /** 年を固定する・外す（null） */
  onSelectYear: (year: number | null) => void;
  /** 右の操作の後ろ（小窓のボタンの前）に置くもの（表示の設定のボタン。作業の層が渡す） */
  tools?: ComponentChildren;
  /** 結論の下に置くもの（表示の設定の欄・FP顧問料の一文） */
  below?: ComponentChildren;
  /** 全部の案を色分けで重ねる表示で、一時的に隠している案（帯の文字）と、隠す・戻す手続き */
  multi?: MultiHidden;
  /** グラフのすぐ上に置くもの（資産の推移の口座の内訳・運用の期間・相場が下がった場合の切り替え。0026） */
  bar?: ComponentChildren;
  /** グラフのすぐ下に置くもの（資産の内訳のドーナツ） */
  after?: ComponentChildren;
  /** 運用の期間の帯の切れ目を動かした */
  onBand?: (which: "stop" | "wd", age: number, phase: "slide" | "release") => void;
  /** 運用の期間の帯の切れ目を動かせない理由（つまみの札。動かせるときは省略） */
  bandLock?: string;
}

export interface MultiHidden {
  hidden: readonly string[];
  onToggle: (key: string) => void;
}

/** 凡例とグラフ（重ねる・左右に並べる・全部の案を重ねる）。全部の案を重ねる表示では、凡例で合わせた案をグラフで強調する */
function LegendAndChart(p: Omit<ResultCardProps, "verdict" | "onMode" | "onExplain" | "tools" | "below" | "bar" | "after"> & { height?: number }) {
  const [focus, setFocus] = useState<string | null>(null);
  const ex = p.explain;
  const layout = p.layout ?? "overlay";
  // 左右に並べるのは、説明モードの外で、選んだ案が基準の案と違うときだけ（MainChart と同じ決まり）
  const side = layout === "side" && ex === null && !p.model.names.same;
  const all = multiOn(layout, ex, p.model);
  const hidden = p.multi?.hidden ?? [];
  return (
    <>
      {all ? (
        <MultiLegend plans={p.model.plans ?? []} mode={p.mode} focus={focus} onFocus={setFocus} hidden={hidden} onToggle={p.multi?.onToggle ?? (() => undefined)} />
      ) : (
        <MainLegend model={p.model} mode={p.mode} explain={ex} side={side} />
      )}
      <MainChart
        model={p.model}
        mode={p.mode}
        explain={ex}
        ageMark={p.ageMark}
        pinnedYear={p.pinnedYear}
        onSelectYear={p.onSelectYear}
        layout={layout}
        multi={{ focus: focus !== null && !hidden.includes(focus) ? focus : null, hidden }}
        {...(p.height !== undefined ? { height: p.height } : {})}
        {...(p.onBand !== undefined ? { onBand: p.onBand } : {})}
        {...(p.bandLock !== undefined ? { bandLock: p.bandLock } : {})}
      />
    </>
  );
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
          <p class="verdict-line ex-verdict" aria-live="polite">
            {/* 全部の段の文を同じ場所に重ね、今の段だけ見せる。箱の高さはいちばん長い段に合わせて決まり、段を進めても下のグラフ・ボタンが動かない */}
            <span class="ex-says">
              {ex.model.steps.map((x, i) => (
                <span key={x.key} class={`ex-say${i === step ? "" : " ex-hide"}`} {...(i === step ? { "data-verdict": "" } : { "aria-hidden": true })} data-ex-say={i}>
                  <span class="ord">
                    説明 {i + 1}/{ex.model.steps.length} {x.title}
                  </span>
                  <Parts parts={x.sentence} />
                </span>
              ))}
            </span>
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
          <PipButton />
        </div>
      </div>
      {p.below ?? null}
      {ex === null ? (p.bar ?? null) : null}
      <LegendAndChart {...p} />
      {ex === null ? (p.after ?? null) : null}
      {ex !== null ? <ExplainBar model={ex.model} step={step} onStep={(i) => p.onExplain(i)} onClose={() => p.onExplain(null)} /> : null}
    </section>
  );
}

/** 小窓のグラフ（ChartPip の中身）: 元のグラフと同じ部品（凡例・グラフ・補間）を、決めた高さで描く */
export function PipResult(p: Omit<ResultCardProps, "verdict" | "onMode" | "onExplain" | "tools" | "below" | "bar" | "after"> & { height: number }) {
  return (
    <div class="pip-chart" data-pip-chart="main">
      <LegendAndChart {...p} />
    </div>
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
  /** 光らせる年（グラフで固定した年。固定していなければ null） */
  selectedYear: number | null;
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
  // 開いている行（行の左の「▸」。子の行を持つ行だけ）
  const [openRows, setOpenRows] = useState<string[]>([]);
  // 年の見出しの行（付いてくる写し）: 表は縦に全部の行を出し、縦は画面全体だけでスクロールする（表の中は横だけ）。
  // 表の中が横にスクロールする箱だと、その中の sticky は画面に付いてこないので、見出しの行の写しを箱の外に置き、画面の上に付いてこさせる。
  // 列の幅は本物の表から測ってそろえ、横の位置は本物の表の横のスクロールに合わせる（写しは読み上げない。本物の見出しが表の見出し）
  const table = useRef<HTMLTableElement>(null);
  const headIn = useRef<HTMLDivElement>(null);
  const [head, setHead] = useState<{ cols: number[]; width: number; height: number } | null>(null);
  useLayoutEffect(() => {
    const t = table.current;
    if (t === null || typeof ResizeObserver !== "function") return;
    const measure = () => {
      const ths = Array.from(t.querySelectorAll<HTMLElement>("thead tr.r-year > th"));
      const cols = ths.map((th) => th.getBoundingClientRect().width);
      const width = t.getBoundingClientRect().width;
      const height = ths[0]?.getBoundingClientRect().height ?? 0;
      setHead((p) => (p !== null && p.width === width && p.height === height && p.cols.length === cols.length && p.cols.every((w, i) => w === cols[i]) ? p : { cols, width, height }));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(t);
    return () => ro.disconnect();
  }, [model]);
  const hasHead = head !== null;
  useEffect(() => {
    const w = wrap.current;
    const hd = headIn.current;
    if (w === null || hd === null) return;
    const sync = () => {
      hd.scrollLeft = w.scrollLeft;
    };
    sync();
    w.addEventListener("scroll", sync, { passive: true });
    return () => w.removeEventListener("scroll", sync);
  }, [hasHead]);
  // ライフイベントの丸の説明（グラフの下の丸と同じ部品）。表は横に動くので、画面に対して置く（動かしたら閉じる）
  const ev = useEventFocus<string>();
  const dots = useRef(new Map<string, HTMLSpanElement>());
  const evChip: EventChip | undefined = ev.on === null ? undefined : eventAt(model, ev.on);
  const clearEv = ev.clear;
  useEffect(() => {
    if (ev.on === null) return;
    const close = () => clearEv();
    window.addEventListener("scroll", close, { capture: true, passive: true });
    window.addEventListener("resize", close);
    return () => {
      window.removeEventListener("scroll", close, { capture: true });
      window.removeEventListener("resize", close);
    };
  }, [ev.on, clearEv]);
  return (
    <section class="card cf-card" aria-labelledby="h-cf" data-cf-card>
      <div class="cf-head">
        <h2 id="h-cf">{model.title}</h2>
        {controls !== undefined ? (
          <>
            <span class="k">表示するプラン</span>
            <span class="seg-g" role="group" aria-label="表示するプラン">
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
      <div class="cf-body">
        {head !== null ? (
          <div class="cf-sticky" style={{ height: `${head.height}px`, marginBottom: `-${head.height}px` }} aria-hidden="true" data-cf-sticky>
            <div class="cf-sticky-in" ref={headIn}>
              <table class="cf cf-headcopy" style={{ width: `${head.width}px` }}>
                <colgroup>
                  {head.cols.map((w, i) => (
                    <col key={i} style={{ width: `${w}px` }} />
                  ))}
                </colgroup>
                <thead>
                  <tr class="r-year">
                    <th class="stub">{corner ?? "年"}</th>
                    {model.years.map((y) => (
                      <th key={y} class={sel(y)}>
                        <button type="button" class="ybtn" tabIndex={-1} onClick={() => onSelectYear(y)}>
                          {y}
                        </button>
                      </th>
                    ))}
                  </tr>
                </thead>
              </table>
            </div>
          </div>
        ) : null}
        <div class="cf-wrap" ref={wrap}>
          <table class="cf" ref={table}>
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
                      {r.events.map((chips, i) => (
                        <td key={i} class={sel(model.years[i] as number)}>
                          {chips.map((c, j) => {
                            const k = `${i}:${j}`;
                            return <EventDotHtml key={j} chip={c} on={ev.on === k} handlers={ev.bind(k)} dotRef={(el) => {
                                  if (el !== null) dots.current.set(k, el);
                                  else dots.current.delete(k);
                                }} />;
                          })}
                        </td>
                      ))}
                    </tr>
                  );
                if (r.kind === "diff")
                  return (
                    <tr class="r-diff" key={r.key} data-diff-row={r.key}>
                      <th class="stub" scope="row" {...(r.note !== undefined ? { title: r.note } : {})}>
                        {r.label}
                      </th>
                      {r.cells.map((v, i) => (
                        <td key={i} class={`${v === null ? "" : v < 0 ? "minus" : Math.round(v / 10000) === 0 ? "zero" : ""}${sel(model.years[i] as number)}`}>
                          {v === null ? "" : manDiff(v)}
                        </td>
                      ))}
                    </tr>
                  );
                const kids = r.children !== undefined && r.children.length > 0 ? r.children : null;
                const isOpen = kids !== null && openRows.includes(r.key);
                const main = (
                  <tr class={r.kind === "total" ? "r-total" : ""} key={r.key}>
                    <th class="stub" scope="row" {...(r.note !== undefined ? { title: r.note } : {})}>
                      {kids !== null ? (
                        <button type="button" class="row-open" aria-expanded={isOpen} aria-label={`${r.label}の内訳を${isOpen ? "閉じる" : "開く"}`} onClick={() => setOpenRows((o) => (o.includes(r.key) ? o.filter((k) => k !== r.key) : [...o, r.key]))} data-row-open={r.key}>
                          {isOpen ? "▾" : "▸"}
                        </button>
                      ) : null}
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
                if (!isOpen) return main;
                // 開いた行の子の行（物ごと・出どころごとの額。根拠は出さない）
                return [
                  main,
                  ...kids.map((k) => (
                    <tr class="r-child" key={`${r.key}/${k.key}`} data-child-row={k.key}>
                      <th class="stub" scope="row">
                        {k.label}
                      </th>
                      {k.cells.map((c, i) => (
                        <td key={i} class={`${c.amount !== null && c.amount < 0 ? "neg" : ""}${sel(model.years[i] as number)}`}>
                          {c.amount === null || c.amount === 0 ? "" : man(c.amount)}
                        </td>
                      ))}
                    </tr>
                  )),
                ];
              })}
            </tbody>
          </table>
        </div>
      </div>
      {evChip !== undefined && ev.on !== null ? <TableEventTip chip={evChip} anchor={dots.current.get(ev.on) ?? null} /> : null}
    </section>
  );
}

/** 表の丸の鍵（「年の位置:その年の何番目」）から、できごと */
function eventAt(model: CashflowTableModel, key: string): EventChip | undefined {
  const [i, j] = key.split(":").map(Number) as [number, number];
  for (const r of model.rows) if (r.kind === "events") return r.events[i]?.[j];
  return undefined;
}

/** 表の丸の説明: 丸の真上の中央（入らなければ下）。大きさは描いてから測り直す */
function TableEventTip({ chip, anchor }: { chip: EventChip; anchor: HTMLElement | null }) {
  const tip = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  useLayoutEffect(() => {
    const el = tip.current;
    if (el === null) return;
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    if (w > 0 && h > 0 && (size === null || Math.abs(size.w - w) > 0.5 || Math.abs(size.h - h) > 0.5)) setSize({ w, h });
  });
  if (anchor === null || typeof window === "undefined") return null;
  const r = anchor.getBoundingClientRect();
  const fs = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
  const w = size?.w ?? eventLabel(chip).length * 0.85 * fs + 40;
  const h = size?.h ?? 2 * fs;
  const p = placeFixedAbove(r, w, h, window.innerWidth);
  return <EventTip chip={chip} fixed tipRef={tip} style={{ left: `${p.left.toFixed(1)}px`, top: `${p.top.toFixed(1)}px` }} />;
}
