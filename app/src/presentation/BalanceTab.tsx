// 資産と負債のタブ（提示層の部品。家計のバランスシートを図で見せる）。受け取るのは BalanceTabModel と手続きだけ（0016 の2）。
// 配置（上から）: 見るもの（家計のバランスシート／合算BS（カスタマイズで追加）の入口）→ プランの帯（作業の層が渡す）→
// バランスシートの図（1年ずつ見る／時点を並べる／プランを並べる／前回と比べる）→ 年のつまみ（図のすぐ下。図とつまみが同時に画面に収まるよう、
// 窓の高さが低いときは図を縮める）→ 家計の体力の目安（横いっぱいに4つ並べる）→ 表で見る（既定は閉じる）→ 資産と負債の推移のグラフ（押すとその年のバランスシート）。
// 図の読み方・その年の解説は FP が口頭でする前提で、図の下に要約・解説の文は置かない。
// このタブの表示の設定（図の見出しの右の「表示の設定」。結果のタブの表示の設定とは別）: 時点を並べるときの既定の時点と、家計の体力の目安の幅
import type { ComponentChildren } from "preact";
import { useEffect, useLayoutEffect, useRef, useState } from "preact/hooks";
import { BsFigure, useBoxSize } from "./BsFigure.tsx";
import { BsTrend, TrendLegend, trendRange } from "./BsTrend.tsx";
import { healthOf, monthsValue, scaleFor, type HealthItem } from "./bsLayout.ts";
import { FALLBACK, colsOf, resolveColumns, nextColumns, type ResolvedColumn } from "./bsColumns.ts";
import { group, man, manDiff } from "./format.ts";
import { PopIcon } from "./icons.tsx";
import type { BalanceTabModel, BsColumn, BsGroupKey, BsGuide, BsPlanModel, BsPointKey, BsYearModel, MoneyThreeModel, MoneyThreeWording, MoneyThreeSettings, VerdictPart, Yen } from "./model.ts";
import { MoneyThreeSection } from "./MoneyThree.tsx";

export type BsView = "one" | "three" | "plans" | "prev";

/** お金の3つの分け方の呼び方の選択肢（作業の層が渡す） */
export interface MoneyThreeNameChoice {
  key: MoneyThreeWording;
  names: [string, string, string];
  note: string;
}

export interface BalanceTabProps {
  model: BalanceTabModel;
  /** プランの帯（作業の層の部品。結果のタブと同じ） */
  band: ComponentChildren;
  /** 前回と比べるで控えを選んだ（作業の層が計算する） */
  onPrev: (key: string) => void;
  /** 家計の体力の目安の幅を変えた（このタブの表示の設定） */
  onGuide: (g: BsGuide) => void;
  /** 並べる時点をこの世帯で変えた（null は既定に戻す） */
  onColumns: (c: BsColumn[] | null) => void;
  /** 時点を並べるときの既定の時点を変えた（このタブの表示の設定） */
  onPointDefaults: (k: BsPointKey[]) => void;
  /** お金の3つの分け方（図の下の区画。0032）。flash が変わると区画へ移って光らせる（#bsm3 で開いたとき） */
  moneyThree?: { model: MoneyThreeModel | null; onSettings: (s: Partial<MoneyThreeSettings>) => void; flash: number; nameChoices: readonly MoneyThreeNameChoice[] };
  /** 画面の確かめ用の最初の状態 */
  initial?: { view?: BsView; year?: number; open?: "combined"; table?: boolean; settings?: boolean };
}

const Parts = ({ parts }: { parts: readonly VerdictPart[] }) => <>{parts.map((p, i) => (p.strong === true ? <b key={i}>{p.text}</b> : <span key={i}>{p.text}</span>))}</>;
const mn = (v: Yen) => `${man(v)}万円`;
const g = (y: BsYearModel, k: BsGroupKey) => y.lines.reduce((s, l) => (l.group === k ? s + l.amount : s), 0);

function KindTag({ fact, year }: { fact: boolean; year?: number }) {
  return fact ? <span class="bs-kind f">事実（今・入力した値）</span> : <span class="bs-kind e">見込み{year !== undefined ? `（${year}年）` : ""}</span>;
}

/** 図の高さ（文字の大きさ 16px のとき）の上限と下限 */
const FIG_H = { main: 560, compact: 460, min: 320 };

/**
 * 図の高さ: 図の見出しの行（head）・図・年のつまみ（bar）が同時に窓に収まる高さ（上限 max、下限 FIG_H.min。文字の大きさに比例）。
 * つまみを動かしたときに図の変化が見えるように、窓の高さが低いときは図を縮める
 */
function useFitHeight(head: { current: HTMLElement | null }, bar: { current: HTMLElement | null }, max: number, deps: readonly unknown[]): number {
  const [h, setH] = useState(max);
  useLayoutEffect(() => {
    const measure = () => {
      if (typeof window === "undefined") return;
      const fs = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
      const k = fs / 16;
      const big = k > 1.1 ? 1.08 : 1;
      const headH = head.current?.getBoundingClientRect().height ?? fs * 4;
      const barH = bar.current?.getBoundingClientRect().height ?? fs * 7;
      // 図の上下の余白・カードの内側の余白の分
      const avail = window.innerHeight - headH - barH - fs * 2.6;
      const px = Math.max(FIG_H.min * k, Math.min(max * k, avail));
      const v = Math.round(px / big / k);
      setH((o) => (o === v ? o : v));
    };
    measure();
    const ro = typeof ResizeObserver === "function" ? new ResizeObserver(measure) : null;
    if (bar.current !== null) ro?.observe(bar.current);
    ro?.observe(document.documentElement);
    window.addEventListener("resize", measure);
    return () => {
      ro?.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [max, ...deps]);
  return h;
}

export function BalanceTab({ model, band, onPrev, onGuide, onColumns, onPointDefaults, moneyThree, initial }: BalanceTabProps) {
  const [sub, setSub] = useState<"home" | "combined">(initial?.open === "combined" ? "combined" : "home");
  const [view, setView] = useState<BsView>(initial?.view ?? "one");
  const plan = model.plans.find((p) => p.key === model.selected) ?? model.plans[0];
  const basePlan = model.plans.find((p) => p.key === model.base) ?? null;
  const n = plan?.years.length ?? 0;
  const [yi, setYi] = useState(() => {
    const i = initial?.year !== undefined ? (plan?.years.findIndex((y) => y.year === initial.year) ?? -1) : -1;
    return Math.max(0, i);
  });
  const [lr, setLr] = useState<{ l: string; r: string }>({ l: model.base, r: model.selected !== model.base ? model.selected : (model.plans.find((p) => p.key !== model.base)?.key ?? model.base) });
  const [prevKey, setPrevKey] = useState<string | null>(null);
  const [table, setTable] = useState(initial?.table === true);
  const [adjusted, setAdjusted] = useState(false);
  // このタブの表示の設定（図の見出しの右のボタンで、見出しのすぐ下に開く）。体力の目安・既定の時点の「変える」からも開く（開いた欄へスクロール）
  const [settingsOpen, setSettingsOpen] = useState(initial?.settings === true);
  const [settingsNonce, setSettingsNonce] = useState(0);
  const settingsRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (settingsNonce === 0) return;
    settingsRef.current?.scrollIntoView({ block: "nearest", behavior: "auto" });
  }, [settingsNonce]);
  const openSettings = () => {
    setSettingsOpen(true);
    setSettingsNonce((n) => n + 1);
  };
  const headRef = useRef<HTMLDivElement>(null);
  const barRef = useRef<HTMLDivElement>(null);
  const fitMain = useFitHeight(headRef, barRef, FIG_H.main, [view]);
  // プランを並べるときは、選ぶ欄・図の見出し・図の下の純資産の行の分だけ低くする
  const fitPlans = Math.max(FIG_H.min, Math.min(FIG_H.compact, fitMain - 110));
  // 再生（1年ずつ見せる）
  const [play, setPlay] = useState<{ on: boolean; from: number } | null>(null);
  const yiRef = useRef(yi);
  yiRef.current = yi;
  useEffect(() => {
    if (play === null || !play.on) return;
    const t = setInterval(() => {
      if (yiRef.current >= n - 1) {
        setPlay((p) => (p === null ? null : { ...p, on: false }));
        return;
      }
      setYi((i) => Math.min(n - 1, i + 1));
    }, 750);
    return () => clearInterval(t);
  }, [play?.on, n]);
  useEffect(() => {
    if (yi >= n && n > 0) setYi(n - 1);
  }, [n]);
  // 前回と比べる: 選んだ控え（最初は一番新しい控え）を作業の層に計算してもらう
  const prevChoice = prevKey ?? model.prevChoices[0]?.key ?? null;
  useEffect(() => {
    // 計算中は頼み直さない（同じ控えを二重に計算しない）
    if (view === "prev" && prevChoice !== null && model.prev.status !== "loading" && (model.prev.model?.key !== prevChoice || model.prev.status === "idle")) onPrev(prevChoice);
  }, [view, prevChoice, model.prev.status]);
  if (plan === undefined) return <p class="loading">計算しています…</p>;
  const year = plan.years[Math.min(yi, n - 1)] as BsYearModel;
  const stopPlay = () => setPlay((p) => (p === null ? null : { ...p, on: false }));
  const pick = (i: number) => {
    stopPlay();
    if (view === "three" || view === "prev") setView("one");
    setYi(Math.max(0, Math.min(n - 1, i)));
  };
  const views: { key: BsView; label: string }[] = [
    { key: "one", label: "1年ずつ見る" },
    { key: "three", label: `${colsOf(model.columns, model.pointDefaults).length}時点を並べる` },
    ...(model.plans.length > 1 ? [{ key: "plans" as const, label: "プランを並べる" }] : []),
    ...(model.prevChoices.length > 0 ? [{ key: "prev" as const, label: "前回と比べる" }] : []),
  ];
  const range = trendRange(model.plans);
  const trendPlan = view === "plans" ? (model.plans.find((p) => p.key === lr.r) ?? plan) : plan;
  const trendBase = view === "plans" ? (lr.l !== lr.r ? (model.plans.find((p) => p.key === lr.l) ?? null) : null) : basePlan !== null && basePlan.key !== plan.key ? basePlan : null;
  const cols = resolveColumns(plan, model.columns, model.pointDefaults);
  const trendMarks = view === "three" ? cols.map((x) => x.index) : view === "prev" ? [0] : [yi];

  return (
    <div class="bs-tab" data-balance-tab>
      <div class="bs-views" role="group" aria-label="見るもの">
        <span class="k">見るもの</span>
        <button type="button" class="bs-vbtn" aria-pressed={sub === "home"} onClick={() => setSub("home")} data-bs-sub="home">
          家計のバランスシート
        </button>
        {model.customViews.map((c) => (
          <button type="button" key={c.key} class="bs-vbtn" aria-pressed={sub === "combined"} onClick={() => setSub("combined")} data-bs-sub={c.key}>
            {c.label}
          </button>
        ))}
        {model.customViews.length === 0 ? (
          <button type="button" class="bs-vbtn custom" aria-pressed={sub === "combined"} onClick={() => setSub("combined")} data-bs-sub="combined">
            合算BS<span class="bs-ctag">カスタマイズで追加</span>
          </button>
        ) : null}
        <span class="bs-vnote">会社と経営者個人を合わせて見る画面を、カスタマイズでここに足せます</span>
      </div>
      {sub === "combined" ? (
        <CombinedIntro model={model} onBack={() => setSub("home")} />
      ) : (
        <>
          {band}
          <section class="card bs-card" aria-labelledby="h-bs">
            <div ref={headRef}>
              <div class="bs-head">
                <h2 id="h-bs">バランスシート（資産と負債）</h2>
                <span class="seg-g" role="group" aria-label="見せ方">
                  {views.map((v) => (
                    <button
                      type="button"
                      key={v.key}
                      aria-pressed={view === v.key}
                      onClick={() => {
                        stopPlay();
                        setView(v.key);
                      }}
                      data-bs-view={v.key}
                    >
                      {v.label}
                    </button>
                  ))}
                </span>
                {model.provisional ? (
                  <span class="provisional" title="指を離すと正式な計算に置き換わります">
                    確定前
                  </span>
                ) : null}
                <button type="button" class="set-btn bs-set-btn" aria-expanded={settingsOpen} onClick={() => setSettingsOpen(!settingsOpen)} data-bs-settings-open>
                  表示の設定
                </button>
              </div>
              <p class="bs-subline">箱の高さは金額に比例（1年ずつ見るときはその年がいっぱいに見える縮尺。並べるときは共通の縮尺）。箱にカーソルを合わせると名前と金額、押すと内訳が開きます</p>
            </div>
            {settingsOpen ? (
              <div ref={settingsRef}>
                <BalanceSettingsPanel
                  model={model}
                  available={plan.points.map((p) => p.key)}
                  onGuide={onGuide}
                  onPointDefaults={onPointDefaults}
                  {...(moneyThree?.model != null ? { moneyThree: { value: moneyThree.model.settings.wording, choices: moneyThree.nameChoices, onChange: (n: MoneyThreeWording) => moneyThree.onSettings({ wording: n }) } } : {})}
                  onClose={() => setSettingsOpen(false)}
                />
              </div>
            ) : null}
            {view === "one" ? (
              <OneYear model={model} plan={plan} year={year} yi={yi} onPick={pick} onAdjusted={setAdjusted} height={fitMain} />
            ) : view === "three" ? (
              <ThreeView model={model} plan={plan} cols={cols} onGo={(i) => pick(i)} onColumns={onColumns} onEditDefaults={openSettings} height={FIG_H.compact} />
            ) : view === "plans" ? (
              <PlansView model={model} lr={lr} onLr={setLr} yi={yi} height={fitPlans} part="figs" />
            ) : (
              <PrevView model={model} choice={prevChoice} onChoice={(k) => setPrevKey(k)} />
            )}
            {view === "one" || view === "plans" ? (
              <YearBar
                barRef={barRef}
                plan={view === "plans" ? (model.plans.find((p) => p.key === lr.r) ?? plan) : plan}
                yi={yi}
                onYear={(i) => {
                  stopPlay();
                  setYi(i);
                }}
                play={play}
                onPlay={() => {
                  if (play?.on === true) return stopPlay();
                  if (yi >= n - 1) setYi(0);
                  setPlay({ on: true, from: play !== null && yi > 0 ? play.from : yi >= n - 1 ? 0 : yi });
                }}
                onStop={() => {
                  const from = play?.from ?? 0;
                  setPlay(null);
                  setYi(from);
                }}
              />
            ) : null}
            {view === "plans" ? <PlansView model={model} lr={lr} onLr={setLr} yi={yi} height={fitPlans} part="diff" /> : null}
            {view === "one" ? <OneYearBelow model={model} plan={plan} year={year} adjusted={adjusted} onEditGuide={openSettings} /> : null}
            <details class="bs-tbl" open={table} onToggle={(e) => setTable((e.currentTarget as HTMLDetailsElement).open)} data-bs-table>
              <summary>
                <b>表で見る</b>
                <span>数字の表は必要なときだけ開きます（既定は閉じています）</span>
              </summary>
              {table ? <SheetTable plan={view === "plans" ? (model.plans.find((p) => p.key === lr.r) ?? plan) : plan} yi={view === "three" || view === "prev" ? 0 : yi} groups={model.groups} /> : null}
            </details>
          </section>
          {moneyThree?.model != null ? <MoneyThreeSection model={moneyThree.model} onSettings={moneyThree.onSettings} flash={moneyThree.flash} /> : null}
          <section class="card bs-trend-card" aria-labelledby="h-bst">
            <div class="bs-head">
              <h2 id="h-bst">資産と負債の推移</h2>
              <span class="bs-subline inline">
                {view === "three" || view === "prev" ? "グラフを押すと「1年ずつ見る」に切り替わり、その年のバランスシートになります" : "グラフを押すと、その年のバランスシートになります（上の図とつまみが動きます）。← → キーでも動かせます"}
              </span>
            </div>
            <TrendLegend base={trendBase !== null ? `${trendBase.name}${trendBase.base ? "（基準）" : ""}` : null} />
            <BsTrend plan={trendPlan} base={trendBase} range={range} marks={trendMarks} onPick={pick} height={330} />
          </section>
        </>
      )}
    </div>
  );
}

// ---- 1年ずつ見る ----

function OneYear({ model, plan, year, yi, onPick, onAdjusted, height }: { model: BalanceTabModel; plan: BsPlanModel; year: BsYearModel; yi: number; onPick: (i: number) => void; onAdjusted: (a: boolean) => void; height: number }) {
  return (
    <div class="bs-one">
      <div class="bs-fig-main">
        <BsFigure year={year} groups={model.groups} height={height} onAdjusted={onAdjusted} label={`${year.year}年のバランスシート`} />
      </div>
      <aside class="bs-side">
        <div class="bs-year num" data-bs-year={year.year}>
          {year.year}年
        </div>
        <div class="bs-ages">
          {year.members}
          {year.fact ? "（今）" : ""}
        </div>
        <div class="bs-evs">
          {year.events.length > 0 ? (
            year.events.map((e, i) => (
              <span key={i} class={`bs-ev k-${e.kind}`}>
                {e.text}
              </span>
            ))
          ) : (
            <span class="bs-ev none">この年の出来事なし</span>
          )}
        </div>
        <Spark plan={plan} yi={yi} onPick={onPick} />
      </aside>
    </div>
  );
}

/** 1年ずつ見るときの、つまみの下（家計の体力の目安。横いっぱいに広げる） */
function OneYearBelow({ model, plan, year, adjusted, onEditGuide }: { model: BalanceTabModel; plan: BsPlanModel; year: BsYearModel; adjusted: boolean; onEditGuide: () => void }) {
  return (
    <>
      {adjusted ? <p class="bs-adjnote">※小さい項目は読める高さにしているため、その箱だけ高さが金額の比例より少し大きめです</p> : null}
      <HealthCard year={year} first={plan.years[0] as BsYearModel} guide={model.guide} onEditGuide={onEditGuide} wide />
    </>
  );
}

/** 資産の大きさの推移（小さなグラフ。今の位置に印。押すとその年へ） */
function Spark({ plan, yi, onPick }: { plan: BsPlanModel; yi: number; onPick: (i: number) => void }) {
  const { ref, w, fs } = useBoxSize<HTMLDivElement>(260);
  const W = Math.max(180, w);
  const H = Math.round(fs * 6.2);
  const m = { l: 4, r: 4, t: fs * 0.9, b: fs * 1.2 };
  const ys = plan.years;
  const N = ys.length;
  let mx = 1;
  let mnv = 0;
  for (const y of ys) {
    mx = Math.max(mx, y.totalAssets);
    mnv = Math.min(mnv, y.netWorth);
  }
  const X = (i: number) => m.l + ((W - m.l - m.r) * i) / Math.max(1, N - 1);
  const Y = (v: number) => m.t + ((H - m.t - m.b) * (mx - v)) / (mx - mnv);
  const area = `M${X(0)} ${Y(0)} ${ys.map((y, i) => `L${X(i).toFixed(1)} ${Y(y.totalAssets).toFixed(1)}`).join(" ")} L${X(N - 1)} ${Y(0)} Z`;
  const cur = ys[yi] as BsYearModel;
  const anchor = X(yi) < 60 ? "start" : X(yi) > W - 60 ? "end" : "middle";
  return (
    <div class="bs-spark-card">
      <div class="bs-spark-h">
        <b>資産の大きさの推移</b>
        <small>押すとその年へ</small>
      </div>
      <div class="bs-spark" ref={ref}>
        <svg
          viewBox={`0 0 ${W} ${H}`}
          width={W}
          height={H}
          aria-label="資産の大きさの推移。押すとその年へ"
          onClick={(e) => {
            const b = (e.currentTarget as Element).getBoundingClientRect();
            onPick(Math.round(((e.clientX - b.left - m.l) / (b.width - m.l - m.r)) * (N - 1)));
          }}
        >
          <path d={area} fill="var(--bs-g-market)" fill-opacity="0.45" />
          <path d={ys.map((y, i) => `${i === 0 ? "M" : "L"}${X(i).toFixed(1)} ${Y(y.netWorth).toFixed(1)}`).join(" ")} fill="none" stroke="var(--prop-ink)" stroke-width="2" />
          <line x1={m.l} x2={W - m.r} y1={Y(0)} y2={Y(0)} stroke="#9aa3ae" />
          <line x1={X(yi)} x2={X(yi)} y1={m.t - 4} y2={H - m.b} stroke="var(--ink)" stroke-width="1.5" />
          <circle cx={X(yi)} cy={Y(cur.totalAssets)} r="4.5" fill="#fff" stroke="var(--ink)" stroke-width="2" />
          <text x={anchor === "start" ? m.l : anchor === "end" ? W - m.r : X(yi)} y={m.t - 5} text-anchor={anchor} font-size={fs * 0.68} font-weight="700" fill="var(--ink)">
            {cur.year}年 {group(Math.round(cur.totalAssets / 10000))}万円
          </text>
          <text x={m.l} y={H - 3} font-size={fs * 0.62} fill="var(--ink-2)">
            {ys[0]?.age != null ? `${ys[0].age}歳` : ys[0]?.year}
          </text>
          <text x={W - m.r} y={H - 3} text-anchor="end" font-size={fs * 0.62} fill="var(--ink-2)">
            {ys.at(-1)?.age != null ? `${ys.at(-1)?.age}歳` : ys.at(-1)?.year}
          </text>
          <text x={W / 2} y={H - 3} text-anchor="middle" font-size={fs * 0.62} fill="var(--ink-2)">
            {"面＝資産\u3000線＝純資産"}
          </text>
        </svg>
      </div>
      <p class="bs-spark-note">図は、その年がいっぱいの高さに見える縮尺です。金額の大きさは右の目盛りと、この小さなグラフで見ます。</p>
    </div>
  );
}

// ---- 家計の体力の目安 ----

function Gauge({ value, max, band }: { value: number; max: number; band: [number, number] }) {
  return (
    <div class="gauge" aria-hidden="true">
      <span class="band" style={{ left: `${(band[0] / max) * 100}%`, width: `${((band[1] - band[0]) / max) * 100}%` }} />
      <span class="mk" style={{ left: `${Math.min(100, Math.max(0, (value / max) * 100))}%` }} />
    </div>
  );
}

const HealthText = ({ item }: { item: HealthItem }) => (
  <span class="hn">
    {item.text.map((t, i) => (t.strong === true ? <b key={i}>{t.text}</b> : <span key={i}>{t.text}</span>))}
  </span>
);

/** 家計の体力の目安。onEditGuide を渡すと「目安の幅を変える」（このタブの表示の設定を開く）を出す。wide は横いっぱいに4つ並べる（狭い幅では折り返す） */
export function HealthCard({ year, first, guide, onEditGuide, wide = false }: { year: BsYearModel; first: BsYearModel; guide: BsGuide; onEditGuide?: () => void; wide?: boolean }) {
  const h = healthOf(year, guide);
  const mv = h.months.value !== null ? monthsValue(h.months.value) : null;
  const d = year.netWorth - first.netWorth;
  return (
    <div class={`bs-health${wide ? " wide" : ""}`} data-bs-health>
      <div class="hh2">
        家計の体力の目安 <KindTag fact={year.fact} />
        <small>{year.living > 0 ? `生活費 月${man(year.living / 12)}万円で計算` : ""}</small>
      </div>
      <div class="hm" data-health="months">
        <span class="hk">すぐ使えるお金</span>
        <span class="hv num">
          {mv !== null ? mv.value : "—"}
          <small>{mv !== null ? mv.unit : ""}</small>
        </span>
        {h.months.value !== null ? <Gauge value={h.months.value} max={Math.max(36, guide.months[1] * 2)} band={guide.months} /> : null}
        <HealthText item={h.months} />
      </div>
      <div class="hm" data-health="risk">
        <span class="hk">資産のうち値動きのある資産</span>
        <span class="hv num">
          {h.risk.value !== null ? Math.round(h.risk.value) : "—"}
          <small>%</small>
        </span>
        {h.risk.value !== null ? <Gauge value={h.risk.value} max={100} band={guide.risk} /> : null}
        <HealthText item={h.risk} />
      </div>
      <div class="hm" data-health="debt">
        <span class="hk">負債の重さ（負債 ÷ 資産）</span>
        <span class="hv num">
          {h.debt.value !== null ? Math.round(h.debt.value) : "—"}
          <small>%</small>
        </span>
        <Gauge value={Math.min(h.debt.value ?? 100, 100)} max={100} band={[0, guide.debt]} />
        <HealthText item={h.debt} />
      </div>
      <div class="hm" data-health="netWorth">
        <span class="hk">純資産</span>
        <span class="hv nw num">
          {man(year.netWorth)}
          <small>万円</small>
        </span>
        <span class="hn">{year.fact ? "入力した値から計算" : `今から ${manDiff(d)}万円`}</span>
      </div>
      {onEditGuide !== undefined ? (
        <div class="hg">
          <button type="button" class="link-btn" onClick={onEditGuide} data-bs-guide-open>
            目安の幅を変える（表示の設定）
          </button>
        </div>
      ) : null}
    </div>
  );
}

function GuideEditor({ guide, onGuide }: { guide: BsGuide; onGuide: (g: BsGuide) => void }) {
  const num = (v: string, def: number) => {
    const x = Number(v);
    return Number.isFinite(x) && x >= 0 ? x : def;
  };
  const set = (patch: Partial<BsGuide>) => {
    const next = { ...guide, ...patch };
    if (next.months[1] > next.months[0] && next.risk[1] > next.risk[0] && next.debt > 0 && next.debt <= 100 && next.risk[1] <= 100) onGuide(next);
  };
  const box = (label: string, value: number, on: (v: number) => void, unit: string, key: string) => (
    <label class="hg-f">
      <span>{label}</span>
      <input type="number" min={0} max={unit === "%" ? 100 : 120} value={value} onChange={(e) => on(num((e.currentTarget as HTMLInputElement).value, value))} data-guide={key} />
      <span>{unit}</span>
    </label>
  );
  return (
    <div class="hg-edit" role="group" aria-label="家計の体力の目安の幅">
      <p>家計の体力の目安で、ゲージに帯で見せる幅です（最初の値: 6〜12か月分・10〜40%・50%未満）。</p>
      <div class="hg-row">
        すぐ使えるお金 {box("下限", guide.months[0], (v) => set({ months: [v, guide.months[1]] }), "か月分", "months0")}〜{box("上限", guide.months[1], (v) => set({ months: [guide.months[0], v] }), "か月分", "months1")}
      </div>
      <div class="hg-row">
        値動きのある資産 {box("下限", guide.risk[0], (v) => set({ risk: [v, guide.risk[1]] }), "%", "risk0")}〜{box("上限", guide.risk[1], (v) => set({ risk: [guide.risk[0], v] }), "%", "risk1")}
      </div>
      <div class="hg-row">負債の重さ {box("上限", guide.debt, (v) => set({ debt: v }), "%未満", "debt")}</div>
    </div>
  );
}

// ---- 年のつまみ ----

function YearBar({ plan, yi, onYear, play, onPlay, onStop, barRef }: { plan: BsPlanModel; yi: number; onYear: (i: number) => void; play: { on: boolean; from: number } | null; onPlay: () => void; onStop: () => void; barRef?: { current: HTMLDivElement | null } }) {
  const { ref, w, fs } = useBoxSize<HTMLDivElement>(640);
  const n = plan.years.length;
  const y = plan.years[yi] as BsYearModel;
  const th = 11;
  const pos = (i: number) => th + ((w - 2 * th) * i) / Math.max(1, n - 1);
  // 札が重なるときは2段にする
  let lastEnd = [-1e9, -1e9];
  const marks = plan.marks.map((m) => {
    const wd = m.label.length * fs * 0.72 + 12;
    const x = pos(m.index);
    const row = x - wd / 2 < (lastEnd[0] as number) + 4 ? 1 : 0;
    lastEnd = row === 0 ? [x + wd / 2, lastEnd[1] as number] : [lastEnd[0] as number, x + wd / 2];
    return { ...m, x, row };
  });
  const two = marks.some((m) => m.row === 1);
  const first = plan.years[0]?.age;
  const every = pos(5) - pos(0) < fs * 3.3 ? 10 : 5;
  // 目盛りは5歳（狭ければ10歳）ごと。右の端には表の最後の年の年齢を必ず出す（計算の期間の終わりが分かるように。近い目盛りは外す）
  const lastAge = plan.years[n - 1]?.age ?? null;
  const ticks = plan.years
    .map((yy, i) => ({ i, age: yy.age, end: false }))
    .filter((t) => t.age !== null && (t.age as number) % every === 0 && (lastAge === null || t.i === n - 1 || pos(n - 1) - pos(t.i) >= fs * 2.6));
  if (lastAge !== null && ticks.at(-1)?.i !== n - 1) ticks.push({ i: n - 1, age: lastAge, end: true });
  const playing = play?.on === true;
  return (
    <div class="bs-yb" data-bs-yearbar ref={barRef}>
      <div class="yb-l">
        <div class="yb-year num">
          {y.year}年<small>{y.members}</small>
        </div>
        <div class="yb-play">
          <button type="button" class="btn" aria-pressed={playing} onClick={onPlay} data-bs-play>
            {playing ? "❚❚ 一時停止" : play !== null && yi > 0 && yi < n - 1 ? "▶ 続ける" : "▶ 1年ずつ見せる"}
          </button>
          {play !== null && !playing && yi > 0 ? (
            <button type="button" class="link-btn" onClick={onStop} data-bs-stop>
              止める
            </button>
          ) : null}
        </div>
      </div>
      <div class={`yb-mid${two ? " two" : ""}`}>
        <div class="yb-ticks" aria-hidden="true">
          {marks.map((m) => (
            <button type="button" tabIndex={-1} key={`${m.kind}${m.index}`} class={`yb-tk k-${m.kind}${m.row === 1 ? " r2" : ""}`} style={{ left: `${m.x}px` }} title={`${plan.years[m.index]?.year}年へ`} onClick={() => onYear(m.index)}>
              {m.label}
            </button>
          ))}
        </div>
        <div ref={ref}>
          <input
            type="range"
            class="yb-range"
            min={0}
            max={n - 1}
            step={1}
            value={yi}
            style={{ "--p": `${(yi / Math.max(1, n - 1)) * 100}%` }}
            aria-label="表示する年"
            aria-valuetext={`${y.year}年 ${y.members}`}
            onInput={(e) => onYear(Number((e.currentTarget as HTMLInputElement).value))}
            data-bs-range
          />
        </div>
        <div class="yb-scale" aria-hidden="true">
          {ticks.map((t) => (
            <span key={t.i} class={t.end ? "end" : undefined} style={{ left: `${pos(t.i)}px` }} title={t.end ? "表の最後の年（計算の期間の終わり）" : undefined}>
              {t.age}歳
            </span>
          ))}
          {first == null
            ? plan.years
                .filter((_, i) => i % 10 === 0)
                .map((yy, k) => (
                  <span key={k} style={{ left: `${pos(k * 10)}px` }}>
                    {yy.year}
                  </span>
                ))
            : null}
        </div>
        <div class="yb-key">
          <span class="bs-kind f">事実</span>
          今の年は入力した値
          <span class="bs-kind e">見込み</span>
          つまみを先に動かした年（図の左上の札で分かります）
        </div>
      </div>
      <div class="yb-r">
        <span class="k">主な年へ</span>
        <div class="yb-jumps">
          {plan.jumps.map((j) => {
            const jy = plan.years[j.index] as BsYearModel;
            return (
              <button type="button" key={j.key} class="jb" aria-pressed={yi === j.index} onClick={() => onYear(j.index)} data-bs-jump={j.key}>
                {j.label}
                <small>
                  {jy.year}年{jy.age !== null ? `・${jy.age}歳` : ""}
                </small>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ---- 時点を並べる（既定は3つ。2〜4つ）----

const MIN_COLS = 2;
const MAX_COLS = 4;
function ThreeView({ model, plan, cols, onGo, onColumns, onEditDefaults, height }: { model: BalanceTabModel; plan: BsPlanModel; cols: ResolvedColumn[]; onGo: (i: number) => void; onColumns: (c: BsColumn[] | null) => void; onEditDefaults: () => void; height: number }) {
  const [open, setOpen] = useState<number | null>(null);
  const ys = cols.map((p) => plan.years[p.index] as BsYearModel);
  const sc = scaleFor(ys);
  const raw = colsOf(model.columns, model.pointDefaults);
  const put = (next: BsColumn[]) => {
    setOpen(null);
    onColumns(nextColumns(next, model.pointDefaults));
  };
  const add = () => {
    // まだ並べていない候補のうち、最初のもの（10年後・20年後…の順）
    const used = new Set(cols.map((c) => c.index));
    const cand = [...FALLBACK.map((k) => plan.points.find((x) => x.key === k)), ...plan.points].find((p) => p !== undefined && !used.has(p.index));
    if (cand !== undefined) put([...raw, { point: cand.key }]);
  };
  const defaultsText = model.pointDefaults.map((k) => model.pointChoices.find((c) => c.key === k)?.label ?? k).join("・");
  return (
    <div class="bs-three-wrap">
      <div class="bs-pick bs-cols-bar" data-bs-cols-bar>
        <span class="k">並べる時点</span>
        <span class="note">
          見出しを押すと、その時点の年を変えられます（この世帯で覚えます）
          {model.columns !== null ? <b class="bs-custom-tag">この世帯で選んだ時点</b> : null}
        </span>
        <span class="bs-cols-act">
          {cols.length < MAX_COLS ? (
            <button type="button" class="btn" onClick={add} data-bs-col-add>
              ＋ 時点を足す
            </button>
          ) : null}
          {model.columns !== null ? (
            <button type="button" class="link-btn" onClick={() => onColumns(null)} data-bs-col-reset>
              既定（{defaultsText}）に戻す
            </button>
          ) : null}
          <button type="button" class="link-btn" onClick={onEditDefaults} data-bs-defaults-open>
            既定の時点を変える（表示の設定）
          </button>
        </span>
      </div>
      <div class={`bs-three n${cols.length}`} data-bs-three={cols.length}>
        {cols.map((p, k) => {
          const y = ys[k] as BsYearModel;
          const prev = k > 0 ? (ys[k - 1] as BsYearModel) : null;
          return (
            <div class="bs-tcard-wrap" key={p.pos}>
              {k > 0 ? (
                <div class="arrow" aria-hidden="true">
                  →
                </div>
              ) : null}
              <div class="bs-tcard">
                <ColumnHead
                  open={open === p.pos}
                  onToggle={() => setOpen(open === p.pos ? null : p.pos)}
                  onClose={() => setOpen(null)}
                  plan={plan}
                  col={p}
                  who={model.who}
                  canRemove={cols.length > MIN_COLS}
                  onPick={(c) => put(raw.map((x, i) => (i === p.pos ? c : x)))}
                  onRemove={() => put(raw.filter((_, i) => i !== p.pos))}
                />
                {p.note !== null ? <p class="bs-colnote">{p.note}</p> : null}
                <BsFigure year={y} groups={model.groups} scale={sc} compact height={cols.length >= 4 ? Math.round(height * 0.9) : height} label={`${p.label}（${y.year}年）のバランスシート`} />
                <div class="tn">
                  純資産 <span class={`num${y.netWorth < 0 ? " neg" : ""}`}>{mn(y.netWorth)}</span>
                </div>
                <p class="ts">{threeSentence(y, prev)}</p>
                <button type="button" class="link-btn go" onClick={() => onGo(p.index)} data-bs-go={p.index}>
                  この年を1年ずつ見る →
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** 時点の見出し（押すと年を選ぶ小窓: 主な年の候補・年のつまみと年の入力・この時点を外す） */
function ColumnHead({ open, onToggle, onClose, plan, col, who, canRemove, onPick, onRemove }: { open: boolean; onToggle: () => void; onClose: () => void; plan: BsPlanModel; col: ResolvedColumn; who: string; canRemove: boolean; onPick: (c: BsColumn) => void; onRemove: () => void }) {
  const y = plan.years[col.index] as BsYearModel;
  const wrap = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: Event) => {
      if (e instanceof KeyboardEvent ? e.key === "Escape" : !(wrap.current?.contains(e.target as Node) ?? false)) onClose();
    };
    document.addEventListener("click", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("click", close);
      document.removeEventListener("keydown", close);
    };
  }, [open]);
  return (
    <div class="th-wrap" ref={wrap}>
      <div class="th">
        <button type="button" class="th-btn" aria-expanded={open} aria-haspopup="dialog" onClick={onToggle} title="この時点の年を変える" data-bs-col={col.pos}>
          <b>{col.label}</b>
          <span>
            {y.year}年{y.age !== null ? `・${who}${y.age}歳` : ""}
          </span>
          <PopIcon />
        </button>
        <KindTag fact={y.fact} />
      </div>
      {open ? <ColumnPicker plan={plan} index={col.index} canRemove={canRemove} onPick={onPick} onRemove={onRemove} onClose={onClose} /> : null}
    </div>
  );
}

function ColumnPicker({ plan, index, canRemove, onPick, onRemove, onClose }: { plan: BsPlanModel; index: number; canRemove: boolean; onPick: (c: BsColumn) => void; onRemove: () => void; onClose: () => void }) {
  const n = plan.years.length;
  const [yi, setYi] = useState(index);
  const y = plan.years[yi] as BsYearModel;
  const first = plan.years[0] as BsYearModel;
  const last = plan.years[n - 1] as BsYearModel;
  return (
    <div class="bs-colpick" role="dialog" aria-label="この時点の年を選ぶ" data-bs-colpick>
      <div class="cp-h">
        <b>この時点の年を選ぶ</b>
        <button type="button" class="link-btn" onClick={onClose} aria-label="閉じる">
          ×
        </button>
      </div>
      <div class="cp-k">主な年</div>
      <div class="cp-points">
        {plan.points.map((p) => {
          const py = plan.years[p.index] as BsYearModel;
          return (
            <button type="button" key={p.key} class="jb" aria-pressed={p.index === index} onClick={() => onPick({ point: p.key })} data-bs-colpoint={p.key}>
              {p.label}
              <small>
                {py.year}年{py.age !== null ? `・${py.age}歳` : ""}
              </small>
            </button>
          );
        })}
      </div>
      <div class="cp-k">年を選ぶ</div>
      <div class="cp-year">
        <input
          type="range"
          class="yb-range"
          min={0}
          max={n - 1}
          step={1}
          value={yi}
          style={{ "--p": `${(yi / Math.max(1, n - 1)) * 100}%` }}
          aria-label="選ぶ年"
          aria-valuetext={`${y.year}年 ${y.members}`}
          onInput={(e) => setYi(Number((e.currentTarget as HTMLInputElement).value))}
          data-bs-colrange
        />
        <label class="cp-num">
          <input
            type="number"
            min={first.year}
            max={last.year}
            value={y.year}
            onChange={(e) => {
              const v = Number((e.currentTarget as HTMLInputElement).value);
              if (Number.isFinite(v)) setYi(Math.max(0, Math.min(n - 1, Math.round(v) - first.year)));
            }}
            aria-label="年"
            data-bs-colyear
          />
          年
        </label>
        <span class="cp-who">{y.members}</span>
        <button type="button" class="btn primary" onClick={() => onPick({ year: y.year })} data-bs-colyear-ok>
          この年にする
        </button>
      </div>
      <p class="cp-foot">
        主な年を選ぶと、プランごとの年になります（例: 退職の年は、プランの退職の年齢に付いてきます）。年を選ぶと、どのプランでもその年です。範囲は {first.year}年〜{last.year}年（計算の期間）。
      </p>
      {canRemove ? (
        <button type="button" class="link-btn cp-remove" onClick={onRemove} data-bs-colremove>
          この時点を外す
        </button>
      ) : null}
    </div>
  );
}

/**
 * 資産と負債のタブの表示の設定（図の見出しのすぐ下に開く。別の窓は出さない）: 時点を並べるときの既定の時点と、家計の体力の目安の幅。
 * 結果のタブの表示の設定とは別に持つ
 */
export function BalanceSettingsPanel({
  model,
  available,
  onGuide,
  onPointDefaults,
  moneyThree,
  onClose,
}: {
  model: BalanceTabModel;
  available?: readonly BsPointKey[];
  onGuide: (g: BsGuide) => void;
  onPointDefaults: (k: BsPointKey[]) => void;
  /** お金の3つの分け方の呼び方（0032） */
  moneyThree?: { value: MoneyThreeWording; choices: readonly MoneyThreeNameChoice[]; onChange: (n: MoneyThreeWording) => void };
  onClose: () => void;
}) {
  return (
    <div class="disp-settings bs-settings" role="group" aria-label="資産と負債の表示の設定" data-bs-settings>
      <div class="ds-head">
        <b>表示の設定</b>
        <span class="ds-note">資産と負債のタブの見せ方を選びます（結果のタブの表示の設定とは別。世帯を保存していれば、世帯のファイルに一緒に保存します）</span>
        <button type="button" class="link-btn" onClick={onClose}>
          閉じる
        </button>
      </div>
      <div class="ds-layout ds-bspoints" data-bs-points-setting>
        <span class="ds-k">「時点を並べる」の既定</span>
        <PointDefaultsEditor choices={model.pointChoices} value={model.pointDefaults} {...(available !== undefined ? { available } : {})} onChange={onPointDefaults} />
      </div>
      <div class="ds-layout ds-bspoints" data-bs-guide-setting>
        <span class="ds-k">家計の体力の目安の幅</span>
        <GuideEditor guide={model.guide} onGuide={onGuide} />
      </div>
      {moneyThree !== undefined ? (
        <div class="ds-layout" role="radiogroup" aria-label="お金の3つの分け方の呼び方" data-m3-names-setting>
          <span class="ds-k">お金の3つの分け方の呼び方</span>
          {moneyThree.choices.map((c) => (
            <label key={c.key} class={`ds-item${moneyThree.value === c.key ? " on" : ""}`}>
              <input type="radio" name="m3-names" value={c.key} checked={moneyThree.value === c.key} onChange={() => moneyThree.onChange(c.key)} data-m3-names={c.key} />
              <span class="ds-l">
                {c.names.join("・")}
                <small>{c.note}。何か月分・何年先までは、区画の欄で変えます</small>
              </span>
            </label>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/** 既定の時点（このタブの表示の設定）: 候補から2〜4つ */
export function PointDefaultsEditor({ choices, value, available, onChange }: { choices: BalanceTabModel["pointChoices"]; value: readonly BsPointKey[]; available?: readonly BsPointKey[]; onChange: (k: BsPointKey[]) => void }) {
  const set = new Set(value);
  const toggle = (k: BsPointKey, on: boolean) => {
    const next = choices.map((c) => c.key).filter((x) => (x === k ? on : set.has(x)));
    if (next.length >= MIN_COLS && next.length <= MAX_COLS) onChange(next);
  };
  return (
    <div class="bs-defaults" role="group" aria-label="既定の時点" data-bs-defaults>
      <p>
        見出しを変えていない世帯で並べる時点です。{MIN_COLS}〜{MAX_COLS}つ選びます（最初の値: 今・退職の年・75歳）。世帯に無い時点（例: ローンの無い世帯のローン完済）は、10年後などで埋めます。
      </p>
      <div class="bs-defaults-list">
        {choices.map((c) => {
          const on = set.has(c.key);
          const disabled = on ? value.length <= MIN_COLS : value.length >= MAX_COLS;
          const absent = available !== undefined && !available.includes(c.key);
          return (
            <label key={c.key} class={`ds-item${on ? " on" : ""}${disabled ? " off" : ""}`} title={c.note}>
              <input type="checkbox" checked={on} disabled={disabled} onChange={(e) => toggle(c.key, (e.currentTarget as HTMLInputElement).checked)} data-bs-default={c.key} />
              <span class="ds-l">
                {c.label}
                {absent ? <small>この世帯には無い</small> : c.note !== "" ? <small>{c.note}</small> : null}
              </span>
            </label>
          );
        })}
      </div>
    </div>
  );
}

function threeSentence(y: BsYearModel, prev: BsYearModel | null): string {
  const mort = g(y, "mortgage");
  if (prev === null) return `${mort > 0 ? `ローンの残り${mn(mort)}。` : ""}資産のうち換金しにくい資産は${mn(g(y, "illiquid"))}で、すぐ使えるお金は${mn(g(y, "liquid"))}。`;
  if (y.shortfall > 0) return `金融資産が尽き、資金の不足が${mn(y.shortfall)}。純資産は${mn(y.netWorth)}。`;
  const dn = y.netWorth - prev.netWorth;
  if (prev.fact) return `純資産は今より${mn(Math.abs(dn))}${dn >= 0 ? "増え" : "減り"}ます。ローンの残りは${mort > 0 ? mn(mort) : "なし"}。`;
  const df = y.financial - prev.financial;
  return `前の時点より金融資産が${mn(Math.abs(df))}${df < 0 ? "減り" : "増え"}、${mn(y.financial)}。ローンは${mort > 0 ? `残り${mn(mort)}` : "返し終わっています"}。`;
}

// ---- プランを並べる ----

/** プランを並べる。part="figs" は選ぶ欄と2つの図、part="diff" は差の1文（年のつまみの下に置く） */
function PlansView({ model, lr, onLr, yi, height, part }: { model: BalanceTabModel; lr: { l: string; r: string }; onLr: (v: { l: string; r: string }) => void; yi: number; height: number; part: "figs" | "diff" }) {
  const pl = model.plans.find((p) => p.key === lr.l) ?? (model.plans[0] as BsPlanModel);
  const pr = model.plans.find((p) => p.key === lr.r) ?? (model.plans[0] as BsPlanModel);
  const yl = pl.years[yi] as BsYearModel;
  const yr = pr.years[yi] as BsYearModel;
  const sc = scaleFor([yl, yr]);
  const sel = (side: "l" | "r", v: string) => (
    <select value={v} onChange={(e) => onLr({ ...lr, [side]: (e.currentTarget as HTMLSelectElement).value })} aria-label={side === "l" ? "左のプラン" : "右のプラン"} data-bs-plan-select={side}>
      {model.plans.map((p) => (
        <option key={p.key} value={p.key}>
          {p.name} {p.title}
        </option>
      ))}
    </select>
  );
  const d = yr.netWorth - yl.netWorth;
  const df = yr.financial - yl.financial;
  const dl = yr.totalLiabilities - yl.totalLiabilities;
  const who = yr.age !== null ? `${yr.year}年（${model.who}${yr.age}歳）` : `${yr.year}年`;
  const parts: string[] = [];
  if (Math.round(Math.abs(df) / 10000) >= 1) parts.push(`金融資産が${df > 0 ? pr.name : pl.name}の方が${mn(Math.abs(df))}多い`);
  if (Math.round(Math.abs(dl) / 10000) >= 1) parts.push(`負債が${dl > 0 ? pr.name : pl.name}の方が${mn(Math.abs(dl))}多い`);
  if (part === "diff")
    return (
      <div class="bs-diff" aria-live="polite" data-bs-plan-diff>
        {pl.key === pr.key ? (
          "同じプランを選んでいます。左右で別のプランを選んでください。"
        ) : Math.round(Math.abs(d) / 10000) === 0 ? (
          `${who}では、2つのプランの純資産はほぼ同じです。`
        ) : (
          <>
            {who}では、{d > 0 ? pr.name : pl.name}の純資産が <b class="num">{mn(Math.abs(d))}</b> 多くなります。
          </>
        )}
        {pl.key !== pr.key && parts.length > 0 ? <span class="s2">差の中身: {parts.join("、")}。</span> : null}
      </div>
    );
  return (
    <>
      <div class="bs-pick">
        <span class="k">左</span>
        {sel("l", lr.l)}
        <span class="k">右</span>
        {sel("r", lr.r)}
        <span class="note">同じ年のバランスシートを左右に並べます。下のつまみで年を動かせます</span>
      </div>
      <div class="bs-pair">
        {[
          { p: pl, y: yl },
          { p: pr, y: yr },
        ].map(({ p, y }, k) => (
          <div class="bs-pane" key={k} data-bs-pane={p.key}>
            <div class="ph">
              <span class="p-letter">{p.letter}</span>
              {p.name}
              {"\u3000"}
              {p.title}
              <KindTag fact={y.fact} />
            </div>
            <BsFigure year={y} groups={model.groups} scale={sc} compact height={height} label={`${p.name}の${y.year}年のバランスシート`} />
            <div class="pn">
              純資産 <span class={`num${y.netWorth < 0 ? " neg" : ""}`}>{mn(y.netWorth)}</span>
              <small>
                金融資産 {mn(y.financial)}・負債 {mn(y.totalLiabilities)}
              </small>
            </div>
          </div>
        ))}
      </div>
    </>
  );
}

// ---- 前回と比べる ----

function PrevView({ model, choice, onChoice }: { model: BalanceTabModel; choice: string | null; onChoice: (k: string) => void }) {
  const pm = model.prev.model !== null && model.prev.model.key === choice ? model.prev.model : null;
  const loading = model.prev.status === "loading" || pm === null;
  return (
    <div class="bs-prev" data-bs-prev>
      <div class="bs-pick">
        <span class="k">比べる控え</span>
        <select value={choice ?? ""} onChange={(e) => onChoice((e.currentTarget as HTMLSelectElement).value)} aria-label="比べる控え" data-bs-prev-select>
          {model.prevChoices.map((c) => (
            <option key={c.key} value={c.key}>
              {c.label}
            </option>
          ))}
        </select>
        <span class="note">入力ホームの「控え」（前の面談の時点を残したもの）から、そのとき見込んでいた「今」のバランスシートを出し、今の実際と並べます</span>
      </div>
      {loading ? (
        <p class="loading">控えの内容で計算しています…</p>
      ) : (
        <>
          <div class="bs-pair">
            {(() => {
              const sc = scaleFor(pm.expected !== null ? [pm.expected, pm.actual] : [pm.actual]);
              const pane = (y: BsYearModel | null, head: ComponentChildren, key: string) => (
                <div class="bs-pane" key={key} data-bs-pane={key}>
                  <div class="ph">{head}</div>
                  {y !== null ? (
                    <>
                      <BsFigure year={y} groups={model.groups} scale={sc} compact height={FIG_H.compact} label={key === "expected" ? "前回の見込みのバランスシート" : "今の実際のバランスシート"} />
                      <div class="pn">
                        純資産 <span class={`num${y.netWorth < 0 ? " neg" : ""}`}>{mn(y.netWorth)}</span>
                        <small>
                          すぐ使えるお金 {mn(g(y, "liquid"))}・値動きのある運用 {mn(g(y, "market"))}
                        </small>
                      </div>
                    </>
                  ) : (
                    <p class="bs-noprev" data-bs-noprev>
                      {pm.reason}
                    </p>
                  )}
                </div>
              );
              return [
                pane(
                  pm.expected,
                  <>
                    <KindTag fact={false} /> <b>前回の見込み</b>
                    <small>
                      （{pm.label}で見込んだ{pm.actual.year}年）
                    </small>
                  </>,
                  "expected",
                ),
                pane(
                  pm.actual,
                  <>
                    <KindTag fact /> <b>今の実際</b>
                    <small>（{pm.actual.year}年）</small>
                  </>,
                  "actual",
                ),
              ];
            })()}
          </div>
          <div class="bs-diff prev" data-bs-prev-diff>
            <Parts parts={pm.summary} />
            {pm.items.length > 0 ? (
              <ul>
                {pm.items.map((x, i) => (
                  <li key={i}>{x}</li>
                ))}
              </ul>
            ) : null}
            <span class="memo">バランスシートを毎年残して比べると、計画とのずれが早めに分かります（キャッシュフロー表は先の見込みですが、今のバランスシートは事実で答え合わせができます）。</span>
          </div>
        </>
      )}
    </div>
  );
}

// ---- 表で見る ----

function SheetTable({ plan, yi, groups }: { plan: BsPlanModel; yi: number; groups: BalanceTabModel["groups"] }) {
  const y0 = plan.years[0] as BsYearModel;
  const y = plan.years[yi] as BsYearModel;
  const keys = (gk: BsGroupKey) => {
    const out: { key: string; label: string }[] = [];
    for (const l of [...y0.lines, ...y.lines]) if (l.group === gk && !out.some((o) => o.key === l.key)) out.push({ key: l.key, label: l.label });
    return out;
  };
  const amt = (yy: BsYearModel, k: string) => yy.lines.find((l) => l.key === k)?.amount ?? 0;
  const row = (cls: string, name: string, a: Yen, b: Yen, key: string) => (
    <tr class={cls} key={key}>
      <th scope="row" class={cls === "s" ? "sub" : ""}>
        {name}
      </th>
      <td class="num">{man(b)}</td>
      <td class="num">{man(a)}</td>
      <td class="num dn">{yi === 0 ? "" : manDiff(a - b)}</td>
    </tr>
  );
  const head = (
    <thead>
      <tr>
        <th scope="col">項目</th>
        <th scope="col">
          今（{y0.year}年・事実）
        </th>
        <th scope="col">
          {y.year}年{yi > 0 ? "（見込み）" : ""}
        </th>
        <th scope="col">差</th>
      </tr>
    </thead>
  );
  const groupRows = (gks: BsGroupKey[]) =>
    gks.flatMap((gk) => [row("g", groups[gk].name, g(y, gk), g(y0, gk), gk), ...keys(gk).filter((k) => k.label !== groups[gk].name).map((k) => row("s", k.label, amt(y, k.key), amt(y0, k.key), `${gk}-${k.key}`))]);
  return (
    <div class="bs-tbl-in" data-bs-sheet>
      <table>
        <caption>資産</caption>
        {head}
        <tbody>
          {groupRows(["liquid", "market", "locked", "illiquid"])}
          {row("tot", "資産の合計", y.totalAssets, y0.totalAssets, "ta")}
        </tbody>
      </table>
      <table>
        <caption>負債・純資産</caption>
        {head}
        <tbody>
          {groupRows(["mortgage", "debt"])}
          {row("g", "負債の合計", y.totalLiabilities, y0.totalLiabilities, "tl")}
          {row("g", "純資産", y.netWorth, y0.netWorth, "nw")}
          {row("tot", "負債と純資産の合計", y.totalLiabilities + y.netWorth, y0.totalLiabilities + y0.netWorth, "tt")}
        </tbody>
      </table>
      <p class="foot">
        単位: 万円（年末）。{plan.name}（{plan.title}）。純資産は不動産・車などを含みます。万円未満を四捨五入するため、内訳の和と合計が合わないことがあります。
      </p>
    </div>
  );
}

// ---- 合算BS（カスタマイズで追加）の入口 ----

function CombinedIntro({ model, onBack }: { model: BalanceTabModel; onBack: () => void }) {
  const cv = model.customViews[0];
  if (cv !== undefined) {
    const sc = scaleFor(cv.columns.map((c) => c.at));
    return (
      <section class="card bs-card" data-bs-custom={cv.key}>
        <div class="bs-head">
          <h2>{cv.label}</h2>
        </div>
        <div class="bs-pair many">
          {cv.columns.map((c) => (
            <div class="bs-pane" key={c.name}>
              <div class="ph">
                <b>{c.name}</b>
              </div>
              <BsFigure year={c.at} groups={model.groups} scale={sc} compact height={FIG_H.compact} label={`${c.name}のバランスシート`} />
            </div>
          ))}
        </div>
        <p class="bs-subline">{cv.note}</p>
      </section>
    );
  }
  return (
    <section class="card bs-combined" data-bs-combined>
      <div class="bs-cb-text">
        <h2>
          合算BS <span class="bs-ctag">カスタマイズで追加</span>
        </h2>
        <p>会社のバランスシートと、経営者個人の家計のバランスシートを合わせて見る画面を、カスタマイズでここに足します。今は入口と考え方だけです（会社の数字の計算はありません）。</p>
        <ul>
          <li>左右に「会社」「経営者個人」、右端に「合算」を並べる（家計と同じ縮尺・同じ色の約束）</li>
          <li>会社と個人の間の貸し借り（役員借入金・役員貸付金）は、合わせるときに相殺する</li>
          <li>経営者が持つ自社株は、合算では会社の純資産と置き換える（二重に数えない）</li>
          <li>役員報酬・退職金を動かすと、会社と家計の箱が同時に動く</li>
        </ul>
        <button type="button" class="btn" onClick={onBack} data-bs-back>
          ← 家計のバランスシートに戻る
        </button>
      </div>
      <div class="bs-cb-fig" aria-hidden="true">
        <div class="cols">
          {[
            { name: "会社", a: [70], r: [36, 34], c: "co" },
            { name: "経営者個人（家計）", a: [42], r: [20, 22], c: "hh" },
            { name: "合算", a: [100], r: [40, 60], c: "sum" },
          ].map((x, i) => (
            <div class="col" key={x.name}>
              {i > 0 ? <span class="op">{i === 1 ? "＋" : "＝"}</span> : null}
              <div class="nm">{x.name}</div>
              <div class="bars">
                <span class={`a ${x.c}`} style={{ height: `${x.a[0]}%` }} />
                <span class="r">
                  <span class="d" style={{ height: `${x.r[0]}%` }} />
                  <span class="n" style={{ height: `${x.r[1]}%` }} />
                </span>
              </div>
            </div>
          ))}
        </div>
        <small>（図はイメージ。貸し借り・自社株は相殺して合わせる）</small>
      </div>
    </section>
  );
}
