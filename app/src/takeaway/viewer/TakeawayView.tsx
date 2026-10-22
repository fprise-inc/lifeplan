// 持ち帰り用のレポートの画面（0030）: アプリの結果の画面を顧客向けに簡単にしたもの。
// - 上から: 見出し（宛名・作成日・事務所名）→ プランの帯 → 大きなグラフ（資産の推移・収支の推移。ホバーで○・クリックで固定）→
//   試してみる（FP が許したつまみだけ。1つ前に戻す・最初に戻す＝FP の提案の値）→ 資産と負債の図 → キャッシュフロー表の要約 → 注意書き
// - グラフ・帯の見た目・資産と負債の図は、アプリの提示層の部品（MainChart・BsFigure）と同じもの。数字はファイルの中の計算エンジンで計算する
// - 受け取るのは TakeawayData（model.ts の許可した値）と計算エンジンだけ
import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import type { EngineRequest } from "../../engine/types.ts";
import { BsFigure } from "../../presentation/BsFigure.tsx";
import { group, man } from "../../presentation/format.ts";
import { CHART_MODES, MainChart, MainLegend, type ChartMode } from "../../presentation/MainChart.tsx";
import { ResultVerdictView } from "../../presentation/MainView.tsx";
import type { BsGroupKey, CashflowTableModel, TableRowModel } from "../../presentation/model.ts";
import { bsPlan } from "../../workspace/balanceTab.ts";
import { MoneyThreeCards, MoneyThreeFigure, MoneyThreeSay } from "../../presentation/MoneyThree.tsx";
import { moneyThreeModel } from "../../workspace/moneyThree.ts";
import { depletionYear, displayYears, toPresentation } from "../../workspace/present.ts";
import { ageInYear, roles } from "../../workspace/roles.ts";
import { BS_GROUP_LABEL, BS_GROUP_SHORT, type BsGroup } from "../../../../report/src/index.ts";
import { applyTry, feeOn, leverText, leverValues, NO_TRY, tickText, type TryValues } from "../levers.ts";
import { TAKEAWAY_NOTES, type TakeawayData, type TakeawayLever } from "../model.ts";
import { TakeawayCalc, type EngineLike } from "./calc.ts";

const planLabel = (letter: string) => `プラン${letter}`;
const GROUPS = Object.fromEntries((Object.keys(BS_GROUP_LABEL) as BsGroup[]).map((k) => [k, { name: BS_GROUP_LABEL[k], short: BS_GROUP_SHORT[k] }])) as Record<BsGroupKey, { name: string; short: string }>;

/** 作成日の文字（例: 2026年10月21日） */
export function dateText(ymd: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd);
  return m === null ? ymd : `${Number(m[1])}年${Number(m[2])}月${Number(m[3])}日`;
}

/** スライダーの値の位置（つまみの幅の分を除いた、線の上の割合。アプリの対策と同じ） */
const tickLeft = (v: number, min: number, max: number): string => {
  const f = max > min ? Math.max(0, Math.min(1, (v - min) / (max - min))) : 0;
  return `calc(var(--thumb, 16px) / 2 + (100% - var(--thumb, 16px)) * ${f.toFixed(4)})`;
};

/** 画面の幅と高さ（スマホの縦の画面ではグラフを低めにする） */
function useViewport(): { w: number; h: number } {
  const get = () => ({ w: typeof window === "undefined" ? 1200 : window.innerWidth, h: typeof window === "undefined" ? 800 : window.innerHeight });
  const [v, setV] = useState(get);
  useEffect(() => {
    const on = () => setV(get());
    window.addEventListener("resize", on);
    return () => window.removeEventListener("resize", on);
  }, []);
  return v;
}

type Tries = Record<string, TryValues>;

const hasTry = (t: TryValues | undefined) => t !== undefined && (Object.keys(t.levers).length > 0 || t.fee !== undefined);

export interface TakeawayViewProps {
  data: TakeawayData;
  engine: EngineLike;
  /** アプリの中の見本のとき（見出しに「見本」を出す） */
  preview?: boolean;
}

export function TakeawayView({ data, engine, preview = false }: TakeawayViewProps) {
  const p = data.payload;
  const calc = useMemo(() => new TakeawayCalc(engine, data.packs), [engine, data]);
  const letters = p.plans.map((x) => x.letter);
  const [sel, setSel] = useState(letters.includes(p.proposal) ? p.proposal : (letters[0] ?? "A"));
  const [tries, setTries] = useState<Tries>({});
  const [history, setHistory] = useState<Tries[]>([]);
  const [mode, setMode] = useState<ChartMode>("assets");
  const [pinned, setPinned] = useState<number | null>(null);
  const [bsIdx, setBsIdx] = useState(0);
  const [allYears, setAllYears] = useState(false);
  const before = useRef<Tries | null>(null);
  const vp = useViewport();

  const planOf = (l: string) => p.plans.find((x) => x.letter === l) ?? (p.plans[0] as (typeof p.plans)[number]);
  const requests = useMemo(() => Object.fromEntries(p.plans.map((x) => [x.letter, applyTry(x.request, p.levers, tries[x.letter] ?? NO_TRY)])) as Record<string, EngineRequest>, [data, tries]);
  const results = useMemo(() => calc.run(requests), [calc, requests]);
  const current = (p.plans[0] as (typeof p.plans)[number]).request;
  const years = displayYears(current);
  const self = roles(current).find((r) => r.key === "self");
  const endAge = self !== undefined ? ageInYear(self.member, years.at(-1) ?? current.input.endYear) : null;

  const selRes = results[sel];
  const baseRes = results[p.base];
  const names = { selected: planLabel(sel), base: planLabel(p.base), same: sel === p.base };
  const model = useMemo(() => {
    if (selRes === undefined || baseRes === undefined || !selRes.ok || !baseRes.ok) return null;
    return toPresentation({ base: current, proposal: requests[sel] as EngineRequest, current: baseRes.result, proposed: selRes.result, targetAge: p.targetAge, selectedYear: pinned, provisional: false, names, baseProposal: requests[p.base] as EngineRequest });
  }, [selRes, baseRes, pinned, sel, p.base]);
  const pinnedYear = pinned !== null && model?.selectedYear === pinned ? pinned : null;
  const error = selRes !== undefined && !selRes.ok ? selRes.code : baseRes !== undefined && !baseRes.ok ? baseRes.code : null;

  const bs = useMemo(() => (selRes?.ok === true && p.views.balance ? bsPlan({ key: sel, letter: sel, name: planLabel(sel), title: planOf(sel).name, base: sel === p.base, req: requests[sel] as EngineRequest, table: selRes.result.table }) : null), [selRes, sel]);
  // お金の3つの分け方（0032）: 見ているプランの今の時点。何か月分・何年先までは FP が決めた値（顧客は変えられない）
  const m3 = useMemo(() => {
    if (selRes?.ok !== true || p.views.moneyThree !== true || p.moneyThree === undefined) return null;
    try {
      return moneyThreeModel({ req: requests[sel] as EngineRequest, table: selRes.result.table, settings: p.moneyThree });
    } catch {
      return null;
    }
  }, [selRes, sel]);
  const bsYear = bs === null ? null : (bs.years[Math.max(0, Math.min(bs.years.length - 1, bsIdx))] ?? null);
  // グラフで年を固定したら、資産と負債の図もその年にする
  useEffect(() => {
    if (pinned === null || bs === null) return;
    const i = bs.years.findIndex((y) => y.year === pinned);
    if (i >= 0) setBsIdx(i);
  }, [pinned, bs !== null]);

  // ---- つまみ ----
  const locked = sel === "A" ? "現状（プランA）はつまみで動かせません。上のプランの帯でほかのプランを選ぶと、つまみで試せます。" : null;
  const fpValues = leverValues(planOf(sel).request, p.levers);
  const nowValues = leverValues(requests[sel] as EngineRequest, p.levers);
  const fpFee = feeOn(planOf(sel).request);
  const nowFee = feeOn(requests[sel] as EngineRequest);
  const begin = () => {
    if (before.current === null) before.current = tries;
  };
  const commit = () => {
    const b = before.current;
    before.current = null;
    if (b !== null) setHistory((h) => [...h.slice(-49), b]);
  };
  const setLever = (k: TakeawayLever["key"], v: number) => {
    begin();
    setTries((t) => {
      const cur = t[sel] ?? NO_TRY;
      const levers = { ...cur.levers };
      if (v === fpValues[k]) delete levers[k];
      else levers[k] = v;
      return { ...t, [sel]: { ...cur, levers } };
    });
  };
  const setFee = (on: boolean) => {
    const b = tries;
    const cur = tries[sel] ?? NO_TRY;
    const next: TryValues = { levers: cur.levers };
    if (on !== fpFee) next.fee = on;
    setTries({ ...tries, [sel]: next });
    setHistory((h) => [...h.slice(-49), b]);
  };
  const undo = () => {
    const last = history.at(-1);
    if (last === undefined) return;
    setTries(last);
    setHistory((h) => h.slice(0, -1));
  };
  const resetAll = () => {
    if (!Object.values(tries).some(hasTry)) return;
    setHistory((h) => [...h.slice(-49), tries]);
    setTries({});
  };
  const anyTry = Object.values(tries).some(hasTry);

  // ---- 帯 ----
  const cards = p.plans.map((x) => {
    const r = results[x.letter];
    let status = "計算できませんでした";
    let ok: boolean | null = null;
    if (r?.ok === true) {
      const dep = depletionYear(r.result.table, years);
      ok = dep === null;
      status = dep === null ? (endAge !== null ? `${endAge}歳まで足りる` : "最後まで足りる") : self !== undefined ? `${ageInYear(self.member, dep)}歳で不足` : `${dep}年に不足`;
    }
    return { letter: x.letter, name: x.name, status, ok, base: x.letter === p.base, shown: x.letter === sel, proposal: x.letter === p.proposal, tried: hasTry(tries[x.letter]) };
  });

  const small = vp.w < 760;
  const chartH = small ? Math.round(Math.max(300, Math.min(460, vp.h * 0.55))) : undefined;

  return (
    <div class={`tk${preview ? " tk-preview" : ""}`} data-takeaway>
      <header class="tk-head">
        <div>
          <h1>ライフプランの試算{preview ? <span class="tk-sample">見本</span> : null}</h1>
          {p.addressee !== null ? <p class="tk-to">{p.addressee} 様</p> : null}
        </div>
        <dl class="tk-meta">
          <div>
            <dt>作成日</dt>
            <dd>{dateText(p.createdOn)}</dd>
          </div>
          {p.office !== null ? (
            <div>
              <dt>作成</dt>
              <dd>{p.office}</dd>
            </div>
          ) : null}
        </dl>
      </header>
      <p class="tk-lead">グラフの下のつまみを動かすと、その場で計算し直します。このファイルの中だけで計算し、どこにも送りません。</p>

      <section class="band tk-band" aria-label="プラン" data-band>
        <div class="band-cards" role="group" aria-label="グラフに出すプラン">
          {cards.map((c) => (
            <button type="button" key={c.letter} class={`plan${c.shown ? " is-sel" : ""}${c.base ? " is-base" : ""}`} aria-pressed={c.shown} onClick={() => setSel(c.letter)} data-plan-card={c.letter}>
              <span class="p-top">
                <span class="p-letter">{c.letter}</span>
                <span class="p-name">{c.name}</span>
                {c.proposal ? <span class="p-tag tk-prop">FPの提案</span> : c.base ? <span class="p-tag base">基準</span> : null}
                {c.shown ? <span class="p-tag show">表示中</span> : null}
              </span>
              <span class="p-nums">
                <span class={`p-st ${c.ok === null ? "wait" : c.ok ? "ok" : "ng"}`}>{c.status}</span>
                {c.tried ? <span class="p-mod">試し中</span> : null}
              </span>
              <span class="p-line" aria-hidden="true" />
            </button>
          ))}
        </div>
      </section>

      <section class="card chart-card tk-chart" aria-label="グラフ" data-result-card>
        {model !== null ? (
          <>
            <div class="cc-head">
              <ResultVerdictView model={model.result} />
              <div class="cc-tools">
                <span class="seg-g" role="group" aria-label="グラフの切り替え">
                  {CHART_MODES.map((m) => (
                    <button type="button" key={m.id} aria-pressed={mode === m.id} onClick={() => setMode(m.id)} data-chart-tab={m.id}>
                      {m.label}
                    </button>
                  ))}
                </span>
              </div>
            </div>
            <MainLegend model={model} mode={mode} explain={null} />
            <MainChart model={model} mode={mode} explain={null} ageMark={null} pinnedYear={pinnedYear} onSelectYear={setPinned} {...(chartH !== undefined ? { height: chartH } : {})} />
          </>
        ) : (
          <p class="fatal" role="alert">
            この条件では計算できませんでした（{error ?? "計算しています"}）。「1つ前に戻す」か「最初に戻す」を押してください。
          </p>
        )}
      </section>

      <Levers
        sel={sel}
        locked={locked}
        items={p.levers.items}
        fpValues={fpValues}
        nowValues={nowValues}
        fee={p.levers.fee === null ? null : { note: p.levers.fee.note, on: nowFee, fp: fpFee }}
        onSlide={setLever}
        onRelease={commit}
        onFee={setFee}
        onUndo={undo}
        canUndo={history.length > 0}
        onReset={resetAll}
        canReset={anyTry}
      />

      {bs !== null && bsYear !== null ? (
        <section class="card tk-bs" aria-label="資産と負債" data-takeaway-bs>
          <div class="card-h">
            <h2>資産と負債（{planLabel(sel)}）</h2>
            <span class="aside">
              {bsYear.year}年{bsYear.members !== "" ? `・${bsYear.members}` : ""}
            </span>
          </div>
          <BsFigure year={bsYear} groups={GROUPS} height={small ? 300 : 380} compact={small} label={`${bsYear.year}年のバランスシート`} />
          <div class="tk-bs-year">
            <input type="range" min={0} max={bs.years.length - 1} step={1} value={Math.min(bsIdx, bs.years.length - 1)} aria-label="資産と負債の図の年" aria-valuetext={`${bsYear.year}年`} onInput={(e) => setBsIdx(Number((e.currentTarget as HTMLInputElement).value))} data-takeaway-bs-year />
            <div class="tk-jumps">
              {bs.jumps.map((j) => (
                <button type="button" key={j.key} class={`btn small${j.index === bsIdx ? " on" : ""}`} onClick={() => setBsIdx(j.index)}>
                  {j.label}
                </button>
              ))}
            </div>
          </div>
          <p class="tk-bs-sum num">
            純資産 <b class={bsYear.netWorth < 0 ? "neg" : ""}>{man(bsYear.netWorth)}万円</b>（資産 {man(bsYear.totalAssets)}万円・負債 {man(bsYear.totalLiabilities)}万円）
          </p>
        </section>
      ) : null}

      {m3 !== null ? (
        <section class="card tk-m3" aria-labelledby="tk-m3h" data-takeaway-m3>
          <div class="card-h">
            <h2 id="tk-m3h">お金の3つの分け方（{planLabel(sel)}）</h2>
            <span class="aside">{m3.year}年の時点</span>
          </div>
          <p class="tk-m3-lead">これからの予定をもとに、金融資産をいつ使うお金かで3つに分けて、今どこにあるかと並べました。</p>
          <MoneyThreeSay model={m3} />
          <div class="m3-grid">
            <div>
              <MoneyThreeFigure model={m3} list />
            </div>
            <MoneyThreeCards model={m3} />
          </div>
          <p class="m3-note">この図は説明のためのものです。キャッシュフロー表や結果の計算には使っていません。</p>
        </section>
      ) : null}

      {p.views.table && model !== null ? <CfSummary table={model.table} pinned={pinnedYear} all={allYears} onAll={setAllYears} title={`キャッシュフロー表の要約（${planLabel(sel)}）`} /> : null}

      <footer class="tk-foot">
        <h2>ご注意</h2>
        <ul>
          {TAKEAWAY_NOTES.map((n) => (
            <li key={n}>{n}</li>
          ))}
          {p.notices.map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>
        <p class="tk-stamp">
          作成日 {dateText(p.createdOn)}・制度データの版 {p.dataSet}
          {p.office !== null ? `・${p.office}` : ""}
        </p>
        <p class="tk-stamp">このファイルに入れた部品のライセンス（MIT）は、ファイルの末尾に書いてあります。</p>
      </footer>
    </div>
  );
}

interface LeversProps {
  sel: string;
  locked: string | null;
  items: readonly TakeawayLever[];
  fpValues: Partial<Record<TakeawayLever["key"], number>>;
  nowValues: Partial<Record<TakeawayLever["key"], number>>;
  fee: { note: string; on: boolean; fp: boolean } | null;
  onSlide: (k: TakeawayLever["key"], v: number) => void;
  onRelease: () => void;
  onFee: (on: boolean) => void;
  onUndo: () => void;
  canUndo: boolean;
  onReset: () => void;
  canReset: boolean;
}

function Levers(p: LeversProps) {
  const rows = p.items.filter((it) => p.nowValues[it.key] !== undefined);
  if (rows.length === 0 && p.fee === null) return null;
  const locked = p.locked !== null;
  const fpTag = (t: string) => `FPの提案: ${t}`;
  return (
    <section class="card levers tk-levers" aria-labelledby="tk-lev" data-levers>
      <div class="lv-head">
        <h2 id="tk-lev">試してみる</h2>
        <span class="lv-who">{locked ? <>{planLabel(p.sel)}を表示中</> : <><b>{planLabel(p.sel)}</b>に効きます</>}</span>
        <span class="lv-gap" />
        <button type="button" class="btn" disabled={!p.canUndo} onClick={p.onUndo} title="最後に動かした1つだけを戻します" data-takeaway-undo>
          <span aria-hidden="true">↶ </span>1つ前に戻す
        </button>
        <button type="button" class="btn" disabled={!p.canReset} onClick={p.onReset} title="動かしたものを全部戻し、FPの提案の値にします" data-takeaway-reset>
          最初に戻す
        </button>
      </div>
      {locked ? (
        <p class="lv-lock" data-lever-lock>
          {p.locked}
        </p>
      ) : null}
      <fieldset class="lv-grid" disabled={locked}>
        {rows.map((it) => {
          const v = p.nowValues[it.key] as number;
          const fp = p.fpValues[it.key] ?? v;
          const min = Math.min(it.min, v, fp);
          const max = Math.max(it.max, v, fp);
          const note = it.key === "pensionAge" && v === 65 ? "原則の65歳" : it.note;
          return (
            <div class={`lever${v !== fp ? " changed" : ""}`} key={it.key} data-lever-kind={it.kind}>
              <div class="lever-head">
                <label for={`tk-${it.key}`}>{it.label}</label>
                <span class="lever-val">{leverText(it.key, v)}</span>
              </div>
              <input
                id={`tk-${it.key}`}
                type="range"
                min={min}
                max={max}
                step={it.step}
                value={v}
                data-lever={it.key}
                aria-valuetext={leverText(it.key, v)}
                onInput={(e) => p.onSlide(it.key, Number((e.currentTarget as HTMLInputElement).value))}
                onChange={p.onRelease}
                onPointerUp={p.onRelease}
                onKeyUp={p.onRelease}
              />
              {it.kind === "age" ? (
                <div class="ticks age-ticks">
                  {fp >= min && fp <= max ? <i class="age-base" style={{ left: tickLeft(fp, min, max) }} aria-hidden="true" /> : null}
                  {it.ticks
                    .filter((t) => t >= min && t <= max)
                    .map((t) => (
                      <button
                        type="button"
                        key={t}
                        tabIndex={-1}
                        class={`tick${t === v ? " is-on" : ""}${t === fp ? " is-base" : ""}`}
                        style={{ left: tickLeft(t, min, max) }}
                        onClick={() => {
                          p.onSlide(it.key, t);
                          p.onRelease();
                        }}
                      >
                        {tickText(it.key, t)}
                      </button>
                    ))}
                </div>
              ) : (
                <div class="range-scale">
                  <span>{tickText(it.key, min)}</span>
                  <span class="amt-step">1万円ずつ</span>
                  <span>{tickText(it.key, max)}</span>
                </div>
              )}
              <div class="lever-note">
                {note !== null ? <span>{note}</span> : <span />}
                <span class="base-tag">{fpTag(leverText(it.key, fp))}</span>
              </div>
            </div>
          );
        })}
        {p.fee !== null ? (
          <div class={`lever toggle${p.fee.on !== p.fee.fp ? " changed" : ""}`}>
            <div class="lever-head">
              <span class="lever-label">FP顧問料</span>
              <span class="lever-val">{p.fee.on ? "入れる" : "入れない"}</span>
            </div>
            <span class="tg" role="group" aria-label="FP顧問料">
              <button type="button" aria-pressed={!p.fee.on} onClick={() => p.fee?.on === true && p.onFee(false)} data-fee-toggle="off">
                入れない
              </button>
              <button type="button" aria-pressed={p.fee.on} onClick={() => p.fee?.on === false && p.onFee(true)} data-fee-toggle="on">
                入れる
              </button>
            </span>
            <div class="lever-note">
              <span>{p.fee.note}</span>
              <span class="base-tag">{fpTag(p.fee.fp ? "入れる" : "入れない")}</span>
            </div>
          </div>
        ) : null}
      </fieldset>
    </section>
  );
}

const SUMMARY_KEYS = ["incomeTotal", "expenseTotal", "net", "financial"] as const;

/** キャッシュフロー表の要約（年齢・収入合計・支出合計・年間収支・金融資産残高）。既定は5年ごと（最初と最後の年を含む） */
function CfSummary({ table, pinned, all, onAll, title }: { table: CashflowTableModel; pinned: number | null; all: boolean; onAll: (v: boolean) => void; title: string }) {
  const idx = table.years.map((_, i) => i).filter((i) => all || i === 0 || i === table.years.length - 1 || (table.years[i] as number) % 5 === 0 || table.years[i] === pinned);
  const ages = table.rows.filter((r): r is Extract<TableRowModel, { kind: "age" }> => r.kind === "age" && (r.key === "age:self" || r.key === "age:spouse"));
  const rows = SUMMARY_KEYS.map((k) => table.rows.find((r) => r.key === k)).filter((r): r is Extract<TableRowModel, { kind: "value" | "total" }> => r !== undefined && (r.kind === "total" || r.kind === "value"));
  return (
    <section class="card tk-cf" aria-label="キャッシュフロー表の要約" data-takeaway-cf>
      <div class="card-h">
        <h2>{title}</h2>
        <span class="aside">単位: 万円</span>
      </div>
      <div class="tk-cf-scroll">
        <table class="tk-cf-t num">
          <thead>
            <tr>
              <th scope="col">年</th>
              {idx.map((i) => (
                <th scope="col" key={i} class={table.years[i] === pinned ? "is-pin" : ""}>
                  {table.years[i]}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {ages.map((r) => (
              <tr key={r.key} class="tk-age">
                <th scope="row">{r.label}</th>
                {idx.map((i) => (
                  <td key={i} class={table.years[i] === pinned ? "is-pin" : ""}>
                    {r.ages[i] === null ? "" : `${r.ages[i]}歳`}
                  </td>
                ))}
              </tr>
            ))}
            {rows.map((r) => (
              <tr key={r.key} class={r.key === "net" || r.key === "financial" ? "tk-strong" : ""}>
                <th scope="row">{r.label}</th>
                {idx.map((i) => {
                  const c = r.cells[i];
                  // 合計の行は、その年に動きが無ければ 0
                  const a = c?.amount ?? (r.kind === "total" ? 0 : null);
                  return (
                    <td key={i} class={`${a !== null && a < 0 ? "neg" : ""}${table.years[i] === pinned ? " is-pin" : ""}`}>
                      {a === null ? "" : man(a)}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <button type="button" class="link-btn" onClick={() => onAll(!all)} data-takeaway-cf-all>
        {all ? "5年ごとに戻す" : "すべての年を見る"}
      </button>
      <p class="tk-hint">年間収支・金融資産残高のマイナスは「▲」で示しています（{group(table.years.length)}年分）。</p>
    </section>
  );
}
