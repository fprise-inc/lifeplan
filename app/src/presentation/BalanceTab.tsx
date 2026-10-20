// 資産と負債のタブ（提示層の部品。家計のバランスシートを図で見せる）。受け取るのは BalanceTabModel と手続きだけ（0016 の2）。
// 配置（上から）: 見るもの（家計のバランスシート／合算BS（カスタマイズで追加）の入口）→ プランの帯（作業の層が渡す）→
// バランスシートの図（1年ずつ見る／3時点を並べる／プランを並べる／前回と比べる）→ ひと言の解説と家計の体力の目安 → 年のつまみ →
// 表で見る（既定は閉じる）→ 資産と負債の推移のグラフ（押すとその年のバランスシート）
import type { ComponentChildren } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";
import { BsFigure, useBoxSize } from "./BsFigure.tsx";
import { BsTrend, TrendLegend, trendRange } from "./BsTrend.tsx";
import { healthOf, monthsValue, scaleFor, type HealthItem } from "./bsLayout.ts";
import { group, man, manDiff } from "./format.ts";
import type { BalanceTabModel, BsGroupKey, BsGuide, BsPlanModel, BsYearModel, VerdictPart, Yen } from "./model.ts";

export type BsView = "one" | "three" | "plans" | "prev";

export interface BalanceTabProps {
  model: BalanceTabModel;
  /** プランの帯（作業の層の部品。結果のタブと同じ） */
  band: ComponentChildren;
  /** 前回と比べるで控えを選んだ（作業の層が計算する） */
  onPrev: (key: string) => void;
  /** 家計の体力の目安の幅を変えた（事務所の設定） */
  onGuide: (g: BsGuide) => void;
  /** 画面の確かめ用の最初の状態 */
  initial?: { view?: BsView; year?: number; open?: "combined"; table?: boolean };
}

const Parts = ({ parts }: { parts: readonly VerdictPart[] }) => <>{parts.map((p, i) => (p.strong === true ? <b key={i}>{p.text}</b> : <span key={i}>{p.text}</span>))}</>;
const mn = (v: Yen) => `${man(v)}万円`;
const g = (y: BsYearModel, k: BsGroupKey) => y.lines.reduce((s, l) => (l.group === k ? s + l.amount : s), 0);

function KindTag({ fact, year }: { fact: boolean; year?: number }) {
  return fact ? <span class="bs-kind f">事実（今・入力した値）</span> : <span class="bs-kind e">見込み{year !== undefined ? `（${year}年）` : ""}</span>;
}

/** 図の高さ（文字の大きさ 16px のとき） */
const FIG_H = { main: 560, compact: 460 };

export function BalanceTab({ model, band, onPrev, onGuide, initial }: BalanceTabProps) {
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
    if (view === "prev" && prevChoice !== null && (model.prev.model?.key !== prevChoice || model.prev.status === "idle")) onPrev(prevChoice);
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
    { key: "three", label: "3時点を並べる" },
    ...(model.plans.length > 1 ? [{ key: "plans" as const, label: "プランを並べる" }] : []),
    ...(model.prevChoices.length > 0 ? [{ key: "prev" as const, label: "前回と比べる" }] : []),
  ];
  const range = trendRange(model.plans);
  const trendPlan = view === "plans" ? (model.plans.find((p) => p.key === lr.r) ?? plan) : plan;
  const trendBase = view === "plans" ? (lr.l !== lr.r ? (model.plans.find((p) => p.key === lr.l) ?? null) : null) : basePlan !== null && basePlan.key !== plan.key ? basePlan : null;
  const threeIdx = threePoints(plan);
  const trendMarks = view === "three" ? threeIdx.map((x) => x.index) : view === "prev" ? [0] : [yi];

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
            </div>
            <p class="bs-subline">箱の高さは金額に比例（1年ずつ見るときはその年がいっぱいに見える縮尺。並べるときは共通の縮尺）。箱を押すと内訳が開きます</p>
            {view === "one" ? (
              <OneYear model={model} plan={plan} year={year} yi={yi} onPick={pick} onAdjusted={setAdjusted} adjusted={adjusted} onGuide={onGuide} />
            ) : view === "three" ? (
              <ThreeView model={model} plan={plan} points={threeIdx} onGo={(i) => pick(i)} />
            ) : view === "plans" ? (
              <PlansView model={model} lr={lr} onLr={setLr} yi={yi} />
            ) : (
              <PrevView model={model} choice={prevChoice} onChoice={(k) => setPrevKey(k)} />
            )}
            {view === "one" || view === "plans" ? (
              <YearBar
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
            <details class="bs-tbl" open={table} onToggle={(e) => setTable((e.currentTarget as HTMLDetailsElement).open)} data-bs-table>
              <summary>
                <b>表で見る</b>
                <span>数字の表は必要なときだけ開きます（既定は閉じています）</span>
              </summary>
              {table ? <SheetTable plan={view === "plans" ? (model.plans.find((p) => p.key === lr.r) ?? plan) : plan} yi={view === "three" || view === "prev" ? 0 : yi} groups={model.groups} /> : null}
            </details>
          </section>
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

function OneYear({ model, plan, year, yi, onPick, onAdjusted, adjusted, onGuide }: { model: BalanceTabModel; plan: BsPlanModel; year: BsYearModel; yi: number; onPick: (i: number) => void; onAdjusted: (a: boolean) => void; adjusted: boolean; onGuide: (g: BsGuide) => void }) {
  const eq = year.totalAssets === year.totalLiabilities + year.netWorth;
  return (
    <>
      <div class="bs-one">
        <div class="bs-fig-main">
          <BsFigure year={year} groups={model.groups} height={FIG_H.main} onAdjusted={onAdjusted} label={`${year.year}年のバランスシート`} />
          <div class="bs-figlegend">
            <span>
              <i class="f" />
              今＝入力した事実（はっきりした色・実線）
            </span>
            <span>
              <i class="e" />
              先の年＝見込み（少し薄い色・点線の枠）
            </span>
            <span>左右の箱は必ず同じ高さ（資産＝負債＋純資産）</span>
          </div>
          {adjusted ? <p class="bs-adjnote">※小さい項目は読める高さにしているため、その箱だけ高さが金額の比例より少し大きめです</p> : null}
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
      <div class="bs-below">
        <div class="bs-talk">
          <div class="bs-say" aria-live="polite" data-bs-say>
            <Parts parts={year.say.head} />
            {year.say.sub.length > 0 ? (
              <span class="s2">
                <Parts parts={year.say.sub} />
              </span>
            ) : null}
          </div>
          <div class="bs-ins">
            <span class="ik">バランスシートで見えること</span>
            <Parts parts={year.insight} />
          </div>
          <div class="bs-eq" data-bs-eq>
            <span class="num">
              資産 {group(Math.round(year.totalAssets / 10000))} ＝ 負債 {group(Math.round(year.totalLiabilities / 10000))} ＋ 純資産 {man(year.netWorth)}
            </span>
            {eq ? <span class="ok">✓ 合っています</span> : null}
          </div>
        </div>
        <HealthCard year={year} first={plan.years[0] as BsYearModel} guide={model.guide} onGuide={onGuide} />
      </div>
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
          <path d={area} fill="var(--bs-g-locked)" fill-opacity="0.7" />
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

export function HealthCard({ year, first, guide, onGuide }: { year: BsYearModel; first: BsYearModel; guide: BsGuide; onGuide?: (g: BsGuide) => void }) {
  const h = healthOf(year, guide);
  const [edit, setEdit] = useState(false);
  const mv = h.months.value !== null ? monthsValue(h.months.value) : null;
  const d = year.netWorth - first.netWorth;
  return (
    <div class="bs-health" data-bs-health>
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
      {onGuide !== undefined ? (
        <div class="hg">
          <button type="button" class="link-btn" aria-expanded={edit} onClick={() => setEdit(!edit)} data-bs-guide-open>
            目安の幅を変える（事務所の設定）
          </button>
          {edit ? <GuideEditor guide={guide} onGuide={onGuide} /> : null}
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
      <p>FP が事務所で使う目安の幅です。どの世帯でも同じ幅で見せます（最初の値: 6〜12か月分・10〜40%・50%未満）。</p>
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

function YearBar({ plan, yi, onYear, play, onPlay, onStop }: { plan: BsPlanModel; yi: number; onYear: (i: number) => void; play: { on: boolean; from: number } | null; onPlay: () => void; onStop: () => void }) {
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
  const ticks = plan.years.map((yy, i) => ({ i, age: yy.age })).filter((t) => t.age !== null && (t.age as number) % every === 0);
  const playing = play?.on === true;
  return (
    <div class="bs-yb" data-bs-yearbar>
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
            <span key={t.i} style={{ left: `${pos(t.i)}px` }}>
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
          <i class="f" />
          今は事実
          <i class="e" />
          つまみを先に動かすと「見込み」
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

// ---- 3時点を並べる ----

/** 3時点: 今・退職の年・75歳（退職の年・75歳が無ければ10年後で埋める） */
export function threePoints(plan: BsPlanModel): { label: string; index: number }[] {
  const j = (k: string) => plan.jumps.find((x) => x.key === k);
  const out: { label: string; index: number }[] = [{ label: "今", index: 0 }];
  for (const k of ["retire", "age75", "ten"]) {
    const x = j(k);
    if (x !== undefined && out.length < 3 && !out.some((o) => o.index === x.index)) out.push({ label: x.label, index: x.index });
  }
  return out.sort((a, b) => a.index - b.index);
}

function ThreeView({ model, plan, points, onGo }: { model: BalanceTabModel; plan: BsPlanModel; points: { label: string; index: number }[]; onGo: (i: number) => void }) {
  const ys = points.map((p) => plan.years[p.index] as BsYearModel);
  const sc = scaleFor(ys);
  return (
    <div class="bs-three" data-bs-three>
      {points.map((p, k) => {
        const y = ys[k] as BsYearModel;
        const prev = k > 0 ? (ys[k - 1] as BsYearModel) : null;
        return (
          <div class="bs-tcard-wrap" key={p.index}>
            {k > 0 ? (
              <div class="arrow" aria-hidden="true">
                →
              </div>
            ) : null}
            <div class="bs-tcard">
              <div class="th">
                <b>{p.label}</b>
                <span>
                  {y.year}年{y.age !== null ? `・${model.who}${y.age}歳` : ""}
                </span>
                <KindTag fact={y.fact} />
              </div>
              <BsFigure year={y} groups={model.groups} scale={sc} compact height={FIG_H.compact} label={`${p.label}（${y.year}年）のバランスシート`} />
              <div class="tn">
                純資産 <span class={`num${y.netWorth < 0 ? " neg" : ""}`}>{mn(y.netWorth)}</span>
              </div>
              <p class="ts">{threeSentence(y, prev, k)}</p>
              <button type="button" class="link-btn go" onClick={() => onGo(p.index)} data-bs-go={p.index}>
                この年を1年ずつ見る →
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function threeSentence(y: BsYearModel, prev: BsYearModel | null, k: number): string {
  const mort = g(y, "mortgage");
  if (prev === null) return `${mort > 0 ? `ローンの残り${mn(mort)}。` : ""}資産のうち換金しにくい資産は${mn(g(y, "illiquid"))}で、すぐ使えるお金は${mn(g(y, "liquid"))}。`;
  if (y.shortfall > 0) return `金融資産が尽き、資金の不足が${mn(y.shortfall)}。純資産は${mn(y.netWorth)}。`;
  const dn = y.netWorth - prev.netWorth;
  if (k === 1) return `純資産は${k === 1 ? "今" : "前"}より${mn(Math.abs(dn))}${dn >= 0 ? "増え" : "減り"}ます。ローンの残りは${mort > 0 ? mn(mort) : "なし"}。`;
  const df = y.financial - prev.financial;
  return `前の時点より金融資産が${mn(Math.abs(df))}${df < 0 ? "減り" : "増え"}、${mn(y.financial)}。ローンは${mort > 0 ? `残り${mn(mort)}` : "返し終わっています"}。`;
}

// ---- プランを並べる ----

function PlansView({ model, lr, onLr, yi }: { model: BalanceTabModel; lr: { l: string; r: string }; onLr: (v: { l: string; r: string }) => void; yi: number }) {
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
            <BsFigure year={y} groups={model.groups} scale={sc} compact height={FIG_H.compact} label={`${p.name}の${y.year}年のバランスシート`} />
            <div class="pn">
              純資産 <span class={`num${y.netWorth < 0 ? " neg" : ""}`}>{mn(y.netWorth)}</span>
              <small>
                金融資産 {mn(y.financial)}・負債 {mn(y.totalLiabilities)}
              </small>
            </div>
          </div>
        ))}
      </div>
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
