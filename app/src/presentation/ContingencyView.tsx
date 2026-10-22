// 提示層の部品（万一のときの画面）。受け取るのは提示用の値（ContingencyModel とその一部）と、場面・年を選ぶ手続きだけ（0016 の2）。
// 配置（上から。見通しと同じ流れ）: 場面の帯（ScenarioBand。見通しの案の帯と同じ見た目）→ 年ごとの結果の帯（YearStrip。起きる年を1年ずつ選ぶ・1年ずつ見せる）
// → グラフ（ContingencyChartCard。資産の推移／必要保障額の推移の切り替え）→ 想定の前提（作業の層の部品）。グラフは主画面と同じ幅・高さの感覚で、年の選び方（線の上の○・クリックで固定・薄いグレーの実線の補助線）と
// 補間の動き（tween.ts）も主画面と同じ決まり（yearPick.ts）で描く。色は藍（万一の場合・必要保障額）と灰（万一なし・死亡保険金）、不足は赤のベタ塗りと「▲」。
// 金融資産が足りなくなる所は主画面と同じ「!」の段と赤い点線（ShortMark.tsx）
import { useEffect, useLayoutEffect, useRef, useState } from "preact/hooks";
import { PipButton } from "./ChartPip.tsx";
import { areaAbove, areaBelow, linePath, scale, type Frame, type Scale } from "./chart.ts";
import { group, man, manDiff } from "./format.ts";
import { chartHeight, TOUCH_HINT } from "./MainChart.tsx";
import type { ChartModel, ContingencyModel, ProtectionChartModel, ScenarioModel, VerdictPart, YearStripModel } from "./model.ts";
import { useEventFocus } from "./EventDot.tsx";
import { SHORT_R, SHORT_ROW, ShortDotsSvg, ShortLinesSvg, ShortTip, shortCenter, shortText, shortXs, type ShortSource } from "./ShortMark.tsx";
import { useTween, type Series } from "./tween.ts";
import { estimateWidth, indexAt, placeAbove, placeTip, shownYear, stepYear, togglePin } from "./yearPick.ts";

// ---- ① 場面の帯 ----

export interface ScenarioBandProps {
  model: ContingencyModel;
  onSelect: (key: string) => void;
  /** 見るプランの切り替え（既定は現状のプランA。プランが1つなら出さない） */
  plan?: { options: { id: string; text: string }[]; value: string; onChange: (id: string) => void };
  /** 「計算しています」を出すまでの時間（ミリ秒。既定は LOADING_DELAY_MS） */
  loadingAfter?: number;
}

/** 場面の帯: 「ご主人が亡くなったら」などを小さなカードで横に並べる（見通しの案の帯と同じ見た目）。起きる年は下の年ごとの結果の帯で選ぶ */
export function ScenarioBand({ model, onSelect, plan, loadingAfter = LOADING_DELAY_MS }: ScenarioBandProps) {
  const many = model.scenarios.length > 4;
  const showLoading = useDelayed(model.scenarios.some((c) => c.loading), loadingAfter);
  return (
    <section class={`band cg-band${many ? " many" : ""}`} aria-label="場面" data-cg-band data-prot-status={model.protection.status}>
      <div class="band-head">
        <span class="band-t">場面</span>
        {plan !== undefined && plan.options.length > 1 ? (
          <label>
            見るプラン
            <select value={plan.value} title={plan.options.find((o) => o.id === plan.value)?.text ?? ""} onChange={(e) => plan.onChange((e.currentTarget as HTMLSelectElement).value)} data-cg-plan>
              {plan.options.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.text}
                </option>
              ))}
            </select>
          </label>
        ) : null}
      </div>
      <div class="band-cards" role="group" aria-label="グラフに出す場面">
        {model.scenarios.map((c, i) => {
          const on = c.key === model.selected;
          return (
            <button type="button" key={c.key} class={`plan${on ? " is-sel" : ""}`} aria-pressed={on} title={c.title} onClick={() => onSelect(c.key)} data-scenario={c.key}>
              <span class="p-top">
                <span class="p-letter">{i + 1}</span>
                <span class="p-name">{c.title}</span>
                {on ? <span class="p-tag show">表示中</span> : null}
              </span>
              <span class="p-nums">
                {c.loading && !showLoading ? <span class="p-st wait" aria-hidden="true">{"\u00a0"}</span> : <span class={`p-st ${c.tone}`}>{c.status}</span>}
              </span>
              <span class="p-line" aria-hidden="true" />
            </button>
          );
        })}
      </div>
    </section>
  );
}

// ---- 年ごとの結果の帯 ----

/** 1年ずつ見せている状態（見せていなければ null） */
export type PlayState = "playing" | "paused" | null;

export interface YearStripProps {
  model: YearStripModel;
  /** 選んでいる年（グラフに出している年） */
  selected: number;
  onSelect: (year: number) => void;
  play: PlayState;
  onPlay: () => void;
  onPause: () => void;
  onStop: () => void;
  /** 小窓の中の縮めた表示（年齢を省く） */
  compact?: boolean;
  /** 「計算しています」を出すまでの時間（ミリ秒。既定は LOADING_DELAY_MS） */
  loadingAfter?: number;
}

const cellMark = (c: YearStripModel["cells"][number]) => (c.state === "ok" ? "✓" : c.state === "short" ? `▲${c.shortYear ?? ""}` : c.state === "error" ? "－" : "…");

/**
 * 年ごとの結果の帯: 選べる年を横一列のマスで並べ、マスごとに「その年に起きても最後まで足りるか」を色と印で出す
 * （足りる＝落ち着いた緑の ✓、途中で不足＝赤系の ▲と不足の始まる年。色だけに頼らない）。マスのクリック・← → キーで年を選ぶ。
 * 「▶ 1年ずつ見せる」で1年ずつ進める（一時停止・止める）。狭い窓ではマスが横に動く
 */
export function YearStrip({ model, selected, onSelect, play, onPlay, onPause, onStop, compact = false, loadingAfter = LOADING_DELAY_MS }: YearStripProps) {
  const row = useRef<HTMLDivElement>(null);
  const counting = model.done < model.total;
  const showCounting = useDelayed(counting, loadingAfter);
  const years = model.cells.map((c) => c.year);
  // 選んだ年のマスが見えるように、帯の中だけを横に動かす（ページは動かさない）
  useEffect(() => {
    const el = row.current;
    const cell = el?.querySelector<HTMLElement>(`[data-year-cell="${selected}"]`);
    if (el == null || cell == null) return;
    const left = cell.offsetLeft - el.offsetLeft;
    if (left < el.scrollLeft + 8 || left + cell.offsetWidth > el.scrollLeft + el.clientWidth - 8) el.scrollLeft = Math.max(0, left - el.clientWidth / 2 + cell.offsetWidth / 2);
  }, [selected, model.cells.length]);
  const onKey = (e: KeyboardEvent) => {
    const i = years.indexOf(selected);
    const to = e.key === "ArrowRight" ? years[i + 1] : e.key === "ArrowLeft" ? years[i - 1] : e.key === "Home" ? years[0] : e.key === "End" ? years.at(-1) : undefined;
    if (to === undefined) return;
    e.preventDefault();
    onSelect(to);
    row.current?.querySelector<HTMLElement>(`[data-year-cell="${to}"]`)?.focus();
  };
  return (
    <section class={`card ys${compact ? " compact" : ""}${model.stale ? " is-stale" : ""}`} aria-label="起きる年ごとの結果" data-year-strip={model.tone} data-year-done={`${model.done}/${model.total}`}>
      <div class="ys-head">
        <span class="ys-t">
          起きる年<small>（{model.who}の年齢）</small>
        </span>
        <span class={`ys-sum ${model.tone}`} aria-live="polite" data-year-summary>
          {counting && !showCounting ? "" : model.summary}
        </span>
        <span class="ys-play">
          {play === null ? (
            <button type="button" class="ys-btn" onClick={onPlay} disabled={model.cells.length < 2} data-play>
              ▶ 1年ずつ見せる
            </button>
          ) : (
            <>
              {play === "playing" ? (
                <button type="button" class="ys-btn on" onClick={onPause} data-pause>
                  ❚❚ 一時停止
                </button>
              ) : (
                <button type="button" class="ys-btn" onClick={onPlay} data-play>
                  ▶ 続ける
                </button>
              )}
              <button type="button" class="ys-btn" onClick={onStop} data-stop>
                ■ 止める
              </button>
            </>
          )}
        </span>
      </div>
      <div class="ys-row" ref={row} role="radiogroup" aria-label="起きる年" onKeyDown={onKey}>
        {model.cells.map((c) => {
          const on = c.year === selected;
          return (
            <button
              type="button"
              role="radio"
              key={c.year}
              aria-checked={on}
              tabIndex={on ? 0 : -1}
              class={`yc ${c.state}${on ? " is-sel" : ""}${c.provisional ? " prov" : ""}`}
              aria-label={c.label}
              title={c.label}
              onClick={() => onSelect(c.year)}
              data-year-cell={c.year}
              data-state={c.state}
            >
              <span class="yc-y">{c.year}</span>
              {!compact ? <span class="yc-a">{c.age !== null ? `${c.age}歳` : ""}</span> : null}
              <span class="yc-r" aria-hidden="true">
                {cellMark(c)}
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
}

/** 値が true になってから ms 経つまでは false のまま（短い計算で「計算しています」を一瞬出さない） */
export function useDelayed(flag: boolean, ms: number): boolean {
  const [late, setLate] = useState(false);
  useEffect(() => {
    if (!flag || ms <= 0) {
      setLate(false);
      return;
    }
    const t = setTimeout(() => setLate(true), ms);
    return () => clearTimeout(t);
  }, [flag, ms]);
  return flag && (late || ms <= 0);
}

/** 計算の待ちで「計算しています」を出すまでの時間（これより短い計算では出さない） */
export const LOADING_DELAY_MS = 300;

// ---- ② グラフ ----

export type ContingencyMode = "assets" | "protection";
export const CONTINGENCY_MODES: readonly { id: ContingencyMode; label: string }[] = [
  { id: "assets", label: "資産の推移" },
  { id: "protection", label: "必要保障額の推移" },
];

/** 2つの系列の間の面（下は lower、上は upper。upper が上回るところだけ） */
function bandPath(upper: number[], lower: number[], s: Scale): string {
  const parts: string[] = [];
  let run: number[] = [];
  const flush = () => {
    if (run.length === 0) return;
    const top = run.map((i) => `${s.x(i).toFixed(1)} ${s.y(upper[i] as number).toFixed(1)}`);
    const bottom = [...run].reverse().map((i) => `${s.x(i).toFixed(1)} ${s.y(lower[i] as number).toFixed(1)}`);
    const w = s.band / 2;
    const first = run[0] as number;
    const last = run.at(-1) as number;
    parts.push(
      `M${(s.x(first) - w).toFixed(1)} ${s.y(upper[first] as number).toFixed(1)} L${top.join(" L")} L${(s.x(last) + w).toFixed(1)} ${s.y(upper[last] as number).toFixed(1)} L${(s.x(last) + w).toFixed(1)} ${s.y(lower[last] as number).toFixed(1)} L${bottom.join(" L")} L${(s.x(first) - w).toFixed(1)} ${s.y(lower[first] as number).toFixed(1)} Z`,
    );
    run = [];
  };
  upper.forEach((u, i) => {
    if (u > (lower[i] as number)) run.push(i);
    else flush();
  });
  flush();
  return parts.join(" ");
}

/** 死亡保険金の階段の面（年ごとの帯） */
function stepArea(values: number[], s: Scale): string {
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

const pick = (t: Series, key: string, n: number): number[] => (t[key] as number[] | undefined) ?? new Array<number>(n).fill(0);
const tickText = (t: number) => (t < 0 ? "▲" : "") + group(t);
const yen = (v: number) => `${man(v)}万円`;

/** グラフに描くもの: 資産の推移（万一の場合と万一なし）か、必要保障額の推移（その人が亡くなった場合） */
export type ContingencyChartSpec =
  | {
      kind: "assets";
      model: ChartModel;
      /** 年齢の人の呼び方 */
      who: string;
      /** 万一が起きる年（縦の点線と札） */
      eventYear: number;
      /** 固定した年（固定していなければ null） */
      pinnedYear: number | null;
      onSelectYear: (year: number | null) => void;
    }
  | {
      kind: "protection";
      model: ProtectionChartModel;
      /** 選んでいる「その年に亡くなった場合」の年（この人の死亡の場面を選んでいなければ null） */
      eventYear: number | null;
      /** 年を押した（その年に亡くなった場面にする） */
      onPick: (year: number) => void;
    };

interface TipItem {
  dot: "sel" | "sel2" | "base" | null;
  label: string;
  value: string;
  neg: boolean;
}

interface YearMark {
  dots: { y: number; cls: "sel" | "sel2" | "base" }[];
  head: string;
  lines: TipItem[][];
}

/** short: 「!」の段を設ける（グラフの面のすぐ下。その分だけ下の余白を広げ、年の目盛りの位置は変えない） */
function frameOf(w: number, h: number, fs: number, short = false): Frame {
  return { width: w, height: h, left: 74 * fs, right: 24 * fs, top: 26 * fs, bottom: (48 + (short ? SHORT_ROW : 0)) * fs };
}

/** 「!」を出すもの: 万一の場合と万一なし（万一なしは白抜き） */
function contingencySources(cm: ChartModel): ShortSource[] {
  return cm.depletions
    .filter((d) => cm.years.includes(d.year))
    .sort((a, b) => (a.series === b.series ? 0 : a.series === "current" ? -1 : 1))
    .map((d) => ({
      key: d.series,
      year: d.year,
      text: shortText(d.year, cm.ages[cm.years.indexOf(d.year)], d.series === "proposal" ? "万一の場合" : "万一なし"),
      ...(d.series === "current" ? { base: true } : {}),
    }));
}

/** 万一のときの大きなグラフ（見通しのグラフと同じ大きさ・同じ年の選び方）。height を渡すとその高さで描く（小窓の中の表示） */
export function ContingencyChart({ spec, height }: { spec: ContingencyChartSpec; height?: number }) {
  const box = useRef<HTMLDivElement>(null);
  const svg = useRef<SVGSVGElement>(null);
  const tip = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<number | null>(null);
  const [tipSize, setTipSize] = useState<{ w: number; h: number } | null>(null);
  const [size, setSize] = useState<{ w: number; h: number; fs: number }>({ w: 1100, h: 520, fs: 1 });
  const skFocus = useEventFocus<number>();
  const skTip = useRef<HTMLDivElement>(null);
  const [skTipSize, setSkTipSize] = useState<{ w: number; h: number } | null>(null);
  useLayoutEffect(() => {
    const el = box.current;
    if (el === null) return;
    const measure = () => {
      const px = parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
      const w = Math.max(320, Math.round(el.clientWidth));
      const h = chartHeight(window.innerHeight, px);
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

  const m = spec.model;
  const years = m.years;
  const ages = m.ages;
  const n = years.length;
  const t = useTween(spec.kind === "assets" ? { "a.sel": spec.model.proposal, "a.base": spec.model.current } : { "p.need": spec.model.need, "p.nwa": spec.model.needWithAssets, "p.cov": spec.model.coverage });
  const fs = size.fs;
  // 金融資産が足りなくなる所（資産の推移だけ）。小窓の中の表示（縮めた表示）では「!」の段を設けず、点線だけを面の下の端まで引く
  const skList = spec.kind === "assets" ? contingencySources(spec.model) : [];
  const shortRow = height === undefined && skList.length > 0;
  const f = frameOf(size.w, height ?? size.h, fs, shortRow);
  const hv = hover !== null && years.includes(hover) ? hover : null;
  const event = spec.eventYear !== null && years.includes(spec.eventYear) ? spec.eventYear : null;
  // 資産の推移: 主画面と同じ（固定していればその年、なければカーソルの年）。
  // 必要保障額の推移: 選んでいる年が固定の代わり。カーソルを合わせた年はその間だけ見せる
  const pinned = spec.kind === "assets" ? (spec.pinnedYear !== null && years.includes(spec.pinnedYear) ? spec.pinnedYear : null) : event;
  const shown = spec.kind === "assets" ? shownYear(pinned, hv) : (hv ?? pinned);
  const selIdx = shown === null ? -1 : years.indexOf(shown);
  const atPin = pinned !== null && shown === pinned;
  const choose = (y: number | null) => {
    if (spec.kind === "assets") spec.onSelectYear(y);
    else if (y !== null) spec.onPick(y);
  };

  const onKey = (e: KeyboardEvent) => {
    if (spec.kind === "assets" && e.key === "Escape" && pinned !== null) {
      e.preventDefault();
      choose(null);
      return;
    }
    const dir = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
    if (dir === 0) return;
    const y = stepYear(years, pinned, hv, spec.kind === "assets" ? spec.eventYear : (years[0] ?? 0), dir);
    if (y !== undefined) {
      e.preventDefault();
      choose(y);
    }
  };
  // 固定中は、グラフの外にいても Esc で外せる（資産の推移だけ。引き出しなどが先に Esc を使ったときは何もしない）
  const unpin = spec.kind === "assets" && pinned !== null ? spec.onSelectYear : null;
  useEffect(() => {
    if (unpin === null) return;
    const onDoc = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA") return;
      unpin(null);
    };
    document.addEventListener("keydown", onDoc);
    return () => document.removeEventListener("keydown", onDoc);
  }, [unpin]);

  const yearAt = (e: MouseEvent): number | null => {
    const el = svg.current;
    if (el === null) return null;
    const r = el.getBoundingClientRect();
    const x = (e.clientX - r.left) * (r.width > 0 ? f.width / r.width : 1);
    const i = indexAt(x, f, n);
    return i === null ? null : (years[i] ?? null);
  };

  const body: preact.JSX.Element[] = [];
  let mark: YearMark | null = null;
  const eventMark = (s: Scale, label: string) => {
    if (event === null) return;
    const i = years.indexOf(event);
    body.push(
      <g key="event" data-event-year={event}>
        <line x1={s.x(i)} x2={s.x(i)} y1={f.top} y2={f.height - f.bottom} class="m-age" />
        <text x={s.x(i)} y={f.top - 8} class="m-age-t" text-anchor={i > n * 0.85 ? "end" : i < n * 0.15 ? "start" : "middle"}>
          {label}
        </text>
      </g>,
    );
  };

  let s: Scale;
  if (spec.kind === "assets") {
    const cm = spec.model;
    const sel = pick(t, "a.sel", n);
    const base = pick(t, "a.base", n);
    s = scale([sel, base], n, f);
    body.push(<path key="bb" d={areaBelow(base, s)} class="area-short" opacity={0.75} />);
    body.push(<path key="sb" d={areaBelow(sel, s)} class="area-short" />);
    body.push(<path key="sa" d={areaAbove(sel, s)} class="area-prop" />);
    eventMark(s, `万一（${spec.eventYear}年）`);
    body.push(<path key="lb" d={linePath(base, s)} class="line-base" />);
    body.push(<path key="ls" d={linePath(sel, s)} class="line-prop" />);
    if (selIdx >= 0) {
      const age = ages[selIdx];
      const ps = cm.proposal[selIdx] ?? 0;
      const pb = cm.current[selIdx] ?? 0;
      mark = {
        dots: [
          { y: s.y(base[selIdx] ?? 0), cls: "base" },
          { y: s.y(sel[selIdx] ?? 0), cls: "sel" },
        ],
        head: `${years[selIdx]}年${age != null ? `（${spec.who}${age}歳）` : ""}`,
        lines: [
          [
            { dot: "sel", label: "万一の場合", value: yen(ps), neg: ps < 0 },
            { dot: "base", label: "万一なし", value: yen(pb), neg: pb < 0 },
          ],
        ],
      };
    }
  } else {
    const pm = spec.model;
    const need = pick(t, "p.need", n);
    const nwa = pick(t, "p.nwa", n);
    const cov = pick(t, "p.cov", n);
    s = scale([need, nwa, cov], n, f);
    const ri = pm.reformFrom === null ? -1 : years.indexOf(pm.reformFrom);
    if (ri >= 0) body.push(<rect key="reform" x={s.x(ri) - s.band / 2} y={f.top} width={s.x(n - 1) - s.x(ri) + s.band} height={f.height - f.top - f.bottom} class="reform-band" />);
    body.push(<path key="cov" d={stepArea(cov, s)} class="area-cover" />);
    body.push(<path key="short" d={bandPath(nwa, cov, s)} class="area-short" />);
    eventMark(s, `${spec.eventYear}年に亡くなった場合`);
    body.push(<path key="need" d={linePath(need, s)} class="line-prop" />);
    body.push(<path key="nwa" d={linePath(nwa, s)} class="line-prop2" />);
    const ms = pm.maxShort;
    const msi = ms === null ? -1 : years.indexOf(ms.year);
    if (ms !== null && msi >= 0) {
      const right = msi > n / 2;
      body.push(
        <g key="maxshort">
          <circle cx={s.x(msi)} cy={s.y(nwa[msi] ?? 0)} r={4 * fs} class="dep-tri" />
          <text x={s.x(msi) + (right ? -10 : 10)} y={s.y(nwa[msi] ?? 0) - 8} class="dep-txt" text-anchor={right ? "end" : "start"}>
            ▲ 不足 最大{man(ms.amount)}万円（{ms.year}年）
          </text>
        </g>,
      );
    }
    if (selIdx >= 0) {
      const age = ages[selIdx];
      const a = pm.need[selIdx] ?? 0;
      const b = pm.needWithAssets[selIdx] ?? 0;
      const c = pm.coverage[selIdx] ?? 0;
      const second: TipItem[] = [{ dot: "base", label: "死亡保険金", value: yen(c), neg: false }];
      if (b > c) second.push({ dot: null, label: "▲ 不足", value: yen(b - c), neg: true });
      mark = {
        dots: [
          { y: s.y(cov[selIdx] ?? 0), cls: "base" },
          { y: s.y(nwa[selIdx] ?? 0), cls: "sel2" },
          { y: s.y(need[selIdx] ?? 0), cls: "sel" },
        ],
        head: `${years[selIdx]}年${age != null ? `（${age}歳）` : ""}に亡くなった場合`,
        lines: [
          [
            { dot: "sel", label: "必要保障額", value: yen(a), neg: false },
            { dot: "sel2", label: "金融資産を差し引くと", value: yen(b), neg: false },
          ],
          second,
        ],
      };
    }
  }

  const skXs = skList.map((m) => s.x(years.indexOf(m.year)));
  const skAt = shortRow ? shortXs(skXs, fs, f.left, f.width - f.right) : null;
  const skRowTop = f.height - f.bottom;
  const skCy = shortCenter(skRowTop, fs);
  const skNow = skFocus.on !== null ? skList[skFocus.on] : undefined;
  const skPlace =
    skNow !== undefined && skAt !== null && skFocus.on !== null
      ? placeAbove(skAt[skFocus.on] as number, skCy - SHORT_R * fs, skCy + SHORT_R * fs, skTipSize?.w ?? estimateWidth([skNow.text], 13 * fs), skTipSize?.h ?? 30 * fs, f.width, f.height)
      : null;
  useLayoutEffect(() => {
    const el = skTip.current;
    if (el === null) return;
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    if (w > 0 && h > 0 && (skTipSize === null || Math.abs(skTipSize.w - w) > 0.5 || Math.abs(skTipSize.h - h) > 0.5)) setSkTipSize({ w, h });
  });

  const pinTag = atPin ? (spec.kind === "assets" ? "固定中" : "選んだ年") : null;
  const tipLines = mark !== null ? [`${mark.head}${pinTag !== null ? ` ${pinTag}` : ""}`, ...mark.lines.map((l) => l.map((x) => `／${x.label} ${x.value}`).join(""))] : [];
  const tw = tipSize?.w ?? estimateWidth(tipLines, 13 * fs);
  const th = tipSize?.h ?? (tipLines.length * 19 + 12) * fs;
  const mx = selIdx >= 0 ? s.x(selIdx) : 0;
  const ys = mark?.dots.map((d) => d.y) ?? [0];
  const place = mark !== null ? placeTip(mx, Math.min(...ys), Math.max(...ys), tw, th, f.width, f.height) : null;
  useLayoutEffect(() => {
    const el = tip.current;
    if (el === null) return;
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    if (w > 0 && h > 0 && (tipSize === null || Math.abs(tipSize.w - w) > 0.5 || Math.abs(tipSize.h - h) > 0.5)) setTipSize({ w, h });
  });

  const label =
    spec.kind === "assets"
      ? "金融資産の推移のグラフ。カーソルを合わせるとその年の数字が出ます。クリックか左右の矢印キーで年を固定し、Esc で外します"
      : "必要保障額の推移のグラフ。カーソルを合わせるとその年に亡くなった場合の数字が出ます。クリックか左右の矢印キーで、その年に亡くなった場面にします";
  return (
    <div
      class={`chart main-chart cg-big${height !== undefined ? " compact" : ""}`}
      ref={box}
      tabIndex={0}
      onKeyDown={onKey}
      role="group"
      aria-label={label}
      data-cg-chart={spec.kind}
      data-shown-year={shown ?? undefined}
      data-pinned-year={pinned ?? undefined}
    >
      <svg
        ref={svg}
        viewBox={`0 0 ${f.width} ${f.height}`}
        width={f.width}
        height={f.height}
        role="img"
        aria-label={spec.kind === "assets" ? `金融資産の推移（${years[0]}年〜${years.at(-1)}年）` : `${spec.model.title}の必要保障額の推移（${years[0]}年〜${years.at(-1)}年）`}
      >
        <defs>
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
        {body}
        {skList.length > 0 ? <ShortLinesSvg list={skList} xs={skXs} at={skAt} top={s.y(0)} rowTop={skRowTop} fs={fs} /> : null}
        {mark !== null ? <line x1={mx} x2={mx} y1={f.top - 4} y2={f.height - f.bottom} class={`hv-guide${atPin ? " pinned" : ""}`} /> : null}
        {years.map((y, i) =>
          y % 5 === 0 ? (
            <g key={y}>
              <text x={s.x(i)} y={f.height - 28 * fs} class="axis-label" text-anchor="middle">
                {y}
              </text>
              {ages[i] != null ? (
                <text x={s.x(i)} y={f.height - 12 * fs} class="axis-label sub" text-anchor="middle">
                  {ages[i]}歳
                </text>
              ) : null}
            </g>
          ) : null,
        )}
        {mark !== null ? (
          <g class="hv-dots" data-year-mark>
            {mark.dots.map((d) => (
              <circle key={d.cls} cx={mx} cy={d.y} r={(d.cls === "sel" ? 6.5 : 6) * fs} class={`hv-dot ${d.cls}`} />
            ))}
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
            if (y === null) return;
            setHover(y);
            choose(spec.kind === "assets" ? togglePin(pinned, y) : y);
          }}
        />
        {/* 「!」の丸は、年を読む面より上に置く（カーソルを合わせられるように） */}
        {skAt !== null ? <ShortDotsSvg list={skList} at={skAt} rowTop={skRowTop} fs={fs} focus={skFocus} /> : null}
      </svg>
      {mark !== null && place !== null ? (
        <div
          ref={tip}
          class={`sel-lbl year-tip${atPin ? " pinned" : ""}`}
          style={{ left: `${((place.left / f.width) * 100).toFixed(3)}%`, top: `${((place.top / f.height) * 100).toFixed(3)}%` }}
          role={atPin ? "status" : undefined}
          data-year-tip={place.side}
        >
          <div class="yt-h">
            {mark.head}
            {pinTag !== null ? <span class="yt-pin">{pinTag}</span> : null}
            {unpin !== null && atPin ? (
              <button
                type="button"
                class="yt-unpin"
                aria-label="固定を外す"
                title="固定を外す（Esc でも外せます）"
                data-unpin
                onClick={(e) => {
                  e.stopPropagation();
                  unpin(null);
                }}
              >
                ×
              </button>
            ) : null}
          </div>
          {mark.lines.map((line, li) => (
            <div class="yt-v" key={li}>
              {line.map((it, j) => (
                <span class={it.dot === "base" ? "yt-b" : "yt-s"} key={it.label}>
                  {j > 0 ? "／" : ""}
                  {it.dot !== null ? <i class={`yt-dot ${it.dot}`} aria-hidden="true" /> : null}
                  {it.label} <b class={it.neg ? "neg" : ""}>{it.value}</b>
                </span>
              ))}
            </div>
          ))}
        </div>
      ) : null}
      {skNow !== undefined && skPlace !== null ? (
        <ShortTip text={skNow.text} tipRef={skTip} style={{ left: `${((skPlace.left / f.width) * 100).toFixed(3)}%`, top: `${((skPlace.top / f.height) * 100).toFixed(3)}%` }} />
      ) : null}
    </div>
  );
}

/** 凡例（場面の資産の推移） */
export function ScenarioLegend() {
  return (
    <div class="legend main-legend">
      <span class="lg">
        <i />
        万一の場合
      </span>
      <span class="lg base">
        <i />
        万一なし
      </span>
      <span class="lg short">
        <i />
        不足（▲）
      </span>
      <span class="hint">
        <span class="hint-long">グラフに合わせるとその年の数字。クリックで固定（もう一度クリックか Esc で外す）</span>
        <span class="hint-short">{TOUCH_HINT}</span>
      </span>
    </div>
  );
}

/** 凡例（必要保障額の推移） */
export function ProtectionLegend() {
  return (
    <div class="legend main-legend">
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
      <span class="hint">「この年に亡くなったら」を1年ずつずらした計算。年をクリックすると、その年に亡くなった場面にします</span>
    </div>
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

/** 選んだ年に亡くなった場合の数字の1行（必要保障額の推移の下） */
function ProtectionLine({ model, year }: { model: ProtectionChartModel; year: number }) {
  const i = model.years.indexOf(year);
  if (i < 0) return null;
  const need = model.need[i] as number;
  const nwa = model.needWithAssets[i] as number;
  const cov = model.coverage[i] as number;
  return (
    <div class="pline">
      <span class="y">{year}年に亡くなった場合</span>
      <span class="kv">
        必要保障額 <b>{man(need)}</b>万円
      </span>
      <span class="kv">
        金融資産を差し引くと <b>{man(nwa)}</b>万円
      </span>
      <span class="kv">
        死亡保険金 <b>{man(cov)}</b>万円
      </span>
      {nwa > cov ? (
        <span class="kv neg">
          ▲ 不足 <b>{man(nwa - cov)}</b>万円
        </span>
      ) : null}
    </div>
  );
}

const Parts = ({ parts }: { parts: VerdictPart[] }) => <>{parts.map((p, i) => (p.strong === true ? <b key={i}>{p.text}</b> : <span key={i}>{p.text}</span>))}</>;

export interface ContingencyChartCardProps {
  model: ContingencyModel;
  /** 「計算しています」を出すまでの時間（ミリ秒。既定は LOADING_DELAY_MS） */
  loadingAfter?: number;
  mode: ContingencyMode;
  onMode: (m: ContingencyMode) => void;
  /** 資産の推移で固定した年（固定していなければ null） */
  pinnedYear: number | null;
  onPinYear: (year: number | null) => void;
  /** 必要保障額の推移で年を押した（グラフの鍵と年） */
  onPick: (key: string, year: number) => void;
}

/** グラフの枠に出すもの（枠と、小窓の中の表示で同じ決め方） */
function cardView(model: ContingencyModel, mode: ContingencyMode) {
  const card = model.scenarios.find((c) => c.key === model.selected);
  const prot = card?.protection != null ? model.protection.charts.find((c) => c.key === card.protection) : undefined;
  const protOk = prot !== undefined || model.protection.status !== "ready";
  const m: ContingencyMode = mode === "protection" && !protOk ? "assets" : mode;
  const protEvent = prot !== undefined && card?.key.startsWith("death:") === true ? model.year : null;
  return { card, prot, protOk, m, protEvent, sm: model.scenario.model, stale: model.scenario.stale };
}

/** グラフの見出しの1文（資産の推移／必要保障額の推移） */
export function ContingencyVerdict({ model, mode }: { model: ContingencyModel; mode: ContingencyMode }) {
  const { card, prot, m, sm } = cardView(model, mode);
  if (m === "assets")
    return sm !== null ? (
      <p class={`verdict-line cg-verdict ${sm.verdict.tone}`} aria-live="polite" data-verdict>
        <Parts parts={sm.verdict.parts} />
        <span class="v-sub" data-headline>
          {sm.headline.label} <b class={sm.headline.amount < 0 ? "neg" : ""}>{yen(sm.headline.amount)}</b>（万一なしより {manDiff(sm.headline.diff)}万円。万一なし: {yen(sm.headline.currentAmount)}
          {sm.headline.currentNote !== null ? `・${sm.headline.currentNote}` : ""}）
        </span>
      </p>
    ) : (
      <p class="verdict-line cg-verdict" data-verdict>
        {card?.title ?? ""}
      </p>
    );
  return prot !== undefined ? (
    <p class={`verdict-line cg-verdict ${prot.maxShort !== null ? "down" : "flat"}`} aria-live="polite" data-verdict>
      <span>{prot.title}、</span>
      {prot.maxShort !== null ? <b>保障の不足は最大{man(prot.maxShort.amount)}万円（{prot.maxShort.year}年）</b> : <b>保障は足りています</b>}
      <span class="v-sub">{prot.sub}</span>
    </p>
  ) : (
    <p class="verdict-line cg-verdict" data-verdict>
      必要保障額の推移
    </p>
  );
}

/** グラフの枠（見通しの結果の枠と同じ形）: 結論の1文・グラフの切り替え・凡例・大きなグラフ・その下の内訳 */
export function ContingencyChartCard({ model, mode, onMode, pinnedYear, onPinYear, onPick, loadingAfter = LOADING_DELAY_MS }: ContingencyChartCardProps) {
  const { prot, protOk, m, protEvent, sm, stale } = cardView(model, mode);
  const loading = m === "assets" ? model.scenario.status === "loading" && sm === null : model.protection.status === "loading";
  // 短い計算（300ミリ秒未満）では「計算しています」を出さない（その間は同じ高さの空きを置く）
  const showLoading = useDelayed(loading, loadingAfter);
  const wait = showLoading ? (
    <p class="loading cg-loading" role="status">
      {m === "assets" ? "計算しています…" : "必要保障額の推移を計算しています…"}
    </p>
  ) : (
    <div class="cg-wait" aria-hidden="true" />
  );

  return (
    <section class="card chart-card cg-chart" aria-label="グラフ" aria-busy={loading} data-cg-card={m}>
      <div class="cc-head">
        <ContingencyVerdict model={model} mode={mode} />
        <div class="cc-tools">
          {m === "assets" && stale ? (
            <span class="provisional" title="計算が終わると置き換わります">
              確定前
            </span>
          ) : null}
          <span class="seg-g" role="group" aria-label="グラフの切り替え">
            {CONTINGENCY_MODES.map((x) => (
              <button type="button" key={x.id} aria-pressed={m === x.id} disabled={x.id === "protection" && !protOk} onClick={() => onMode(x.id)} data-chart-tab={x.id}>
                {x.label}
              </button>
            ))}
          </span>
          <PipButton />
        </div>
      </div>
      {m === "assets" ? (
        model.scenario.status === "error" ? (
          <p class="fatal">計算できませんでした（{model.scenario.error}）</p>
        ) : sm === null ? (
          wait
        ) : (
          <div class={stale ? "is-stale" : ""}>
            {sm.notices.map((tx) => (
              <p class="cg-notice" key={tx} data-notice>
                {tx}
              </p>
            ))}
            {sm.choice !== null ? (
              <p class="cg-choice" data-choice>
                {sm.choice}
              </p>
            ) : null}
            <ScenarioLegend />
            <ContingencyChart spec={{ kind: "assets", model: sm.chart, who: sm.who, eventYear: model.year, pinnedYear, onSelectYear: onPinYear }} />
            <Breakdown model={sm.breakdown} />
          </div>
        )
      ) : model.protection.status === "loading" ? (
        wait
      ) : model.protection.status === "error" ? (
        <p class="fatal">計算できませんでした（{model.protection.error}）</p>
      ) : prot === undefined ? (
        <p class="in-note">遺族（配偶者・子）がいないので、必要保障額は出しません。</p>
      ) : (
        <div data-protection={prot.key}>
          <ProtectionLegend />
          <ContingencyChart spec={{ kind: "protection", model: prot, eventYear: protEvent, onPick: (y) => onPick(prot.key, y) }} />
          {protEvent !== null ? <ProtectionLine model={prot} year={protEvent} /> : null}
          {prot.reformFrom !== null ? <p class="cg-notice">{prot.reformFrom}年から（2028年4月以後に亡くなる年）の遺族年金は、見直し前の制度で計算しています</p> : null}
        </div>
      )}
    </section>
  );
}

/** 小窓の中身（年ごとの結果の帯・凡例・グラフ）。元の枠と同じ部品で描く */
export function PipContingency({ model, mode, pinnedYear, onPinYear, onPick, height, strip }: Omit<ContingencyChartCardProps, "onMode"> & { height: number; strip: Omit<YearStripProps, "model" | "compact"> }) {
  const { prot, m, protEvent, sm } = cardView(model, mode);
  return (
    <div class="pip-chart" data-pip-chart="contingency">
      <YearStrip {...strip} model={model.strip} compact />
      {m === "assets" && sm !== null ? (
        <>
          <ScenarioLegend />
          <ContingencyChart height={height} spec={{ kind: "assets", model: sm.chart, who: sm.who, eventYear: model.year, pinnedYear, onSelectYear: onPinYear }} />
        </>
      ) : m === "protection" && prot !== undefined ? (
        <>
          <ProtectionLegend />
          <ContingencyChart height={height} spec={{ kind: "protection", model: prot, eventYear: protEvent, onPick: (y) => onPick(prot.key, y) }} />
        </>
      ) : null}
    </div>
  );
}
