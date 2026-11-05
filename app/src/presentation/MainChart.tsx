// 主画面のグラフ（提示層の部品）: 幅いっぱい・上下を大きく。重ねるのは基準の案（灰の点線）と選んだ案（藍の実線）の2本だけ。
// 切り替え: 資産の推移／収支の推移（選んだ案の積み上げ＋年間収支の線2本）（資産と負債の推移は「資産と負債」のタブ。BalanceTab.tsx）、
// 説明モード（収入 → 年金 → 支出 → 教育 → 住宅 → 資産の推移を1段ずつ足す）。
// 数字が変わると、線と面は前の形から新しい形へ補間して動く（tween.ts）。受け取るのは提示用の値だけ（0016 の2）。
// 年の選び方（yearPick.ts）: カーソルを合わせた年に、線の上の○（選んだ案＝藍の塗り、基準の案＝灰の白抜き）と小さな表示を出す。クリックで固定。
// 比べ方（表示の設定）: 重ねる（既定。1つのグラフに2本）／左右に並べる（基準の案と選んだ案を2つのグラフにし、縦の目盛り・年の選択をそろえる）／
// 全部の案を色分けで重ねる（帯の全部の案を1つのグラフに。色・線の種類・線の端の印で描き分け、見た目は planLines.tsx。積み上げの棒は重ねられないので、
// 収支は年間収支の線で比べる）。
// x 軸の上の丸は年のイベント。カーソルを合わせるかキーボードで選ぶと、年と中身の小さな表示を出す。
// 金融資産が足りなくなる所は、できごとの丸の段のすぐ上の「!」の段に丸を置き、線が0を切る所から赤い点線でつなぐ（ShortMark.tsx）
import type { RefObject } from "preact";
import { useEffect, useId, useLayoutEffect, useRef, useState } from "preact/hooks";
import { areaAbove, areaBelow, eventRows, linePath, multiDomain, scale, scaleOf, spreadX, type Frame, type Scale } from "./chart.ts";
import { group, man } from "./format.ts";
import type { AgeMark, BaseCharts, ChartModel, EventChip, ExplainModel, FlowChartModel, InvestChartModel, PlanLineModel, SeriesNames, StackSeries, Yen } from "./model.ts";
import { EVENT_R, EventDotSvg, EventTip, eventLabel, useEventFocus } from "./EventDot.tsx";
import { lineOf, MULTI_WHAT, PlanMarker, PlanSwatch, planStyles, type PlanStyle } from "./planLines.tsx";
import { PeriodBand, stackAreas, stressPaths } from "./InvestLayers.tsx";
import { Pattern, Swatch } from "./StackChart.tsx";
import { useSwitchEase, useTween, type Series } from "./tween.ts";
import { estimateWidth, indexAt, placeAbove, placeTip, shownYear, stepYear, togglePin } from "./yearPick.ts";
import { AgeAxisSvg, ageExtra, yearHead } from "./AgeAxis.tsx";
import { crossIndex, SHORT_R, SHORT_ROW, ShortDotsSvg, ShortLinesSvg, ShortTip, shortCenter, shortText, shortXs, type ShortSource } from "./ShortMark.tsx";

export type ChartMode = "assets" | "flows";

export const CHART_MODES: readonly { id: ChartMode; label: string }[] = [
  { id: "assets", label: "資産の推移" },
  { id: "flows", label: "収支の推移" },
];

/** 比べ方: 重ねる（既定。基準の案と選んだ案）／左右に並べる（基準の案と選んだ案）／全部の案を色分けで重ねる */
export type ChartLayout = "overlay" | "side" | "all";

/** グラフに渡す値（PresentationModel の一部） */
export interface MainChartModel {
  chart: ChartModel;
  flows: FlowChartModel;
  baseLines: { net: Yen[] };
  baseCharts: BaseCharts;
  events: EventChip[];
  names: SeriesNames;
  who: string;
  selectedYear: number;
  /** 帯の全部の案の線（全部の案を色分けで重ねる表示のときだけ渡す） */
  plans?: PlanLineModel[];
  /** 資産運用（資産の推移に重ねる口座の内訳・運用の期間の帯・相場が下がった場合。0026） */
  invest?: InvestChartModel;
}

/** 全部の案を色分けで重ねる表示か（説明モードでは今のまま1本で説明する。線が1本も計算できていなければ重ねる表示） */
export function multiOn(layout: ChartLayout, explain: unknown, model: MainChartModel): boolean {
  return layout === "all" && explain === null && (model.plans ?? []).some((p) => p.financial !== null);
}

/** 全部の案を重ねる表示の補間の系列の名前（a: 金融資産、f: 年間収支） */
const multiKey = (key: string, mode: ChartMode) => `p.${key}.${mode === "flows" ? "f" : "a"}`;

/** グラフの高さ: 画面の高さに合わせる（ノートPCで約520px、大きい画面で最大700px。文字を大きくすると上下の帯の分を広く見る） */
export function chartHeight(innerHeight: number, fontPx: number): number {
  const h = innerHeight - 250 * (fontPx / 16);
  return Math.round(Math.max(420, Math.min(700, h)));
}

/** 左右に並べる表示: この幅（文字の大きさに比例）より狭い窓では縦に積む */
export const SIDE_STACK_BELOW = 880;

/** 左右に並べる表示の、1つのグラフの大きさと並べ方（w・h は重ねる表示のときの大きさ） */
export function sideLayout(w: number, h: number, fs: number): { stacked: boolean; gap: number; w: number; h: number } {
  const gap = Math.round(20 * fs);
  if (w < SIDE_STACK_BELOW * fs) return { stacked: true, gap, w, h: Math.max(340, Math.round(h * 0.72)) };
  return { stacked: false, gap, w: Math.max(300, Math.floor((w - gap) / 2)), h: Math.round(h * 0.9) };
}

// ---- 補間する数字の束（系列の名前 → 年ごとの値）----

function flatten(m: MainChartModel, ex: ExplainModel | null): Series {
  const out: Record<string, readonly number[]> = { "a.sel": m.chart.proposal, "a.base": m.chart.current, "f.net": m.flows.net, "f.bnet": m.baseLines.net };
  for (const s of m.flows.income) out[`fi.${s.key}`] = s.values;
  for (const s of m.flows.expense) out[`fe.${s.key}`] = s.values;
  // 基準の案の積み上げ（左右に並べる表示で使う。重ねる表示でも同じ束で補間しておき、切り替えても形がつながる）
  for (const s of m.baseCharts.flows.income) out[`bfi.${s.key}`] = s.values;
  for (const s of m.baseCharts.flows.expense) out[`bfe.${s.key}`] = s.values;
  if (ex !== null) for (const k of ["work", "pension", "living", "education", "housing", "financial"] as const) out[`x.${k}`] = ex[k];
  for (const p of m.plans ?? []) {
    if (p.financial !== null) out[multiKey(p.key, "assets")] = p.financial;
    if (p.net !== null) out[multiKey(p.key, "flows")] = p.net;
  }
  return out;
}

const pick = (t: Series, key: string, n: number): number[] => (t[key] as number[] | undefined) ?? new Array<number>(n).fill(0);
const withValues = (list: StackSeries[], t: Series, prefix: string, n: number): StackSeries[] => list.map((s) => ({ ...s, values: pick(t, `${prefix}.${s.key}`, n) }));

// ---- 左右に並べる表示: 1つの案だけのグラフの値 ----

export type PlanSide = "base" | "selected";

/** 線の終わり（proposalEnds・currentEnds）を入れ替えた ChartModel（省略の値は持たない） */
function withEnds(c: ChartModel, proposal: number | undefined, current: number | undefined): ChartModel {
  const { proposalEnds: _p, currentEnds: _c, ...rest } = c;
  void _p;
  void _c;
  return { ...rest, ...(proposal !== undefined ? { proposalEnds: proposal } : {}), ...(current !== undefined ? { currentEnds: current } : {}) };
}

/** 表が先に終わったプランの線: 値のある年（ends）までに切る */
const upTo = (v: Yen[], ends: number | undefined): Yen[] => (ends === undefined || ends >= v.length ? v : v.slice(0, Math.max(1, ends)));

/** その案だけを描く値（選んだ案＝基準の案として渡し、線を1本にする） */
export function planModel(m: MainChartModel, who: PlanSide): MainChartModel {
  if (who === "selected")
    return {
      ...m,
      chart: { ...withEnds(m.chart, m.chart.proposalEnds, m.chart.proposalEnds), current: m.chart.proposal, depletions: m.chart.depletions.filter((d) => d.series === "proposal") },
      baseLines: { net: m.flows.net },
      names: { ...m.names, base: m.names.selected, same: true },
    };
  const { invest: _invest, ...rest } = m;
  void _invest;
  return {
    ...rest,
    chart: { ...withEnds(m.chart, m.chart.currentEnds, m.chart.currentEnds), proposal: m.chart.current, depletions: m.chart.depletions.filter((d) => d.series === "current").map((d) => ({ ...d, series: "proposal" as const })) },
    flows: m.baseCharts.flows,
    events: m.baseCharts.events,
    names: { ...m.names, selected: m.names.base, same: true },
  };
}

const BASE_PREFIX: readonly [string, string][] = [
  ["bfi.", "fi."],
  ["bfe.", "fe."],
];

/** 補間した束を、その案だけのグラフの名前に読み替える（基準の案は基準の系列を選んだ案の名前で読む） */
export function planSeries(t: Series, who: PlanSide): Series {
  if (who === "selected") return t;
  const out: Record<string, readonly number[]> = {};
  for (const [k, v] of Object.entries(t)) {
    const hit = BASE_PREFIX.find(([from]) => k.startsWith(from));
    if (hit !== undefined) out[hit[1] + k.slice(hit[0].length)] = v;
    else if (!BASE_PREFIX.some(([, to]) => k.startsWith(to))) out[k] = v;
  }
  for (const [to, from] of [
    ["a.sel", "a.base"],
    ["f.net", "f.bnet"],
  ] as const)
    if (t[from] !== undefined) out[to] = t[from];
  return out;
}

// ---- 描く系列と縦の目盛り ----

/** 積み上げの合計（sign = −1 は下に積む。extra は下に足す正の額） */
function totals(list: StackSeries[], n: number, sign: 1 | -1, extra?: readonly number[]): number[] {
  return Array.from({ length: n }, (_, i) => sign * (list.reduce((a, x) => a + Math.max(0, x.values[i] ?? 0), 0) + Math.max(0, extra?.[i] ?? 0)));
}

function flowParts(m: MainChartModel, t: Series, n: number) {
  return { inc: withValues(m.flows.income, t, "fi", n), exp: withValues(m.flows.expense, t, "fe", n), net: pick(t, "f.net", n), bnet: pick(t, "f.bnet", n) };
}

/** 縦の目盛りを決める系列（説明モードの外）。左右に並べる表示では、もう一方の案の分も足して目盛りをそろえる */
export function scaleInputs(m: MainChartModel, t: Series, mode: ChartMode, n: number): number[][] {
  const same = m.names.same;
  if (mode === "flows") {
    const p = flowParts(m, t, n);
    return [totals(p.inc, n, 1), totals(p.exp, n, -1), p.net, same ? [] : p.bnet];
  }
  const aSel = pick(t, "a.sel", n);
  return same ? [aSel] : [aSel, pick(t, "a.base", n)];
}

// ---- 描く部品 ----

export { EVENT_R };

/** 丸と丸の間（中心の間隔） */
const eventGap = (fs: number) => (2 * EVENT_R + 3) * fs;

/**
 * right: 右の余白（文字の大きさ 16px のとき）。rows: 年のイベントの丸の段の数（2段のときは下の余白を1段分広げる）。
 * short: 「!」の段を設ける（できごとの丸の段のすぐ上。その分だけ下の余白を広げ、できごとの丸の段と年の目盛りの位置・大きさは変えない）。
 * ages: 年齢の段の数（夫婦は2段。増えた段の分だけ下の余白を広げる。AgeAxis.tsx）
 */
function frameOf(w: number, h: number, fs: number, right: number, rows = 1, short = false, ages = 1): Frame {
  // rows = 0: 年のイベントの丸を描かない（縮めた表示。年と年齢の目盛りの分だけ空ける。「!」の段も設けない）
  return { width: w, height: h, left: 64 * fs, right: right * fs, top: 26 * fs, bottom: ((rows === 0 ? 44 : 70 + (rows - 1) * (2 * EVENT_R + 3) + (short ? SHORT_ROW : 0)) + ageExtra(ages)) * fs };
}

/** 一番下の「!」の段の上の端（グラフの面の下の端）。できごとの丸の段はこの段の下 */
const shortRowTop = (f: Frame) => f.height - f.bottom;
/** できごとの丸の段の上の端（「!」の段があればその下） */
const eventRowTop = (f: Frame, short: boolean, fs: number) => f.height - f.bottom + (short ? SHORT_ROW * fs : 0);

/** 資産が尽きる年（金融資産がはじめてマイナスになる年の番号。尽きなければ -1） */
const firstShort = (v: readonly number[]) => v.findIndex((x) => x < 0);

/**
 * 「!」を出すもの（金融資産が足りなくなる所）。説明モードは選んだプランだけ、全部のプランを重ねる表示は各プラン（プランの色。隠したプランは出さない）、
 * それ以外は選んだプランと基準のプラン（基準は白抜き。同じプランのときは1つ）
 */
export function shortSources(model: MainChartModel, opt: { explain: boolean; multi: MultiState | null }): ShortSource[] {
  const { years, ages } = model.chart;
  const at = (y: number) => ages[years.indexOf(y)];
  if (opt.multi !== null && !opt.explain) {
    const styles = planStyles(model.plans ?? []);
    return (model.plans ?? []).flatMap((p) => {
      const i = p.financial === null ? -1 : firstShort(p.financial.slice(0, p.ends ?? p.financial.length));
      const y = years[i];
      if (i < 0 || y === undefined || opt.multi?.hidden.includes(p.key) === true) return [];
      return [{ key: `p-${p.key}`, year: y, cross: crossIndex(p.financial ?? [], i), text: shortText(y, ages[i], p.name), color: (styles.get(p.key) as PlanStyle).color }];
    });
  }
  const same = model.names.same;
  return model.chart.depletions
    .filter((d) => (opt.explain ? d.series === "proposal" : !(same && d.series === "current")))
    .sort((a, b) => (a.series === b.series ? 0 : a.series === "current" ? -1 : 1))
    .map((d) => ({
      key: d.series,
      year: d.year,
      cross: crossIndex(d.series === "proposal" ? model.chart.proposal : model.chart.current, years.indexOf(d.year)),
      text: shortText(d.year, at(d.year), same || opt.explain ? undefined : d.series === "proposal" ? model.names.selected : model.names.base),
      ...(d.series === "current" && !same && !opt.explain ? { base: true } : {}),
    }));
}

/** 年のイベントの丸の置き場所（x と段）。x は年の位置から、重なる丸は横に並べ直す（狭いグラフでは2段にする） */
function eventLayout(events: readonly EventChip[], years: readonly number[], f: Frame, fs: number): { x: number[]; row: number[]; rows: number } {
  const n = years.length;
  const band = n > 0 ? (f.width - f.left - f.right) / n : 0;
  const xs = events.map((e) => f.left + band * (years.indexOf(e.year) + 0.5));
  const gap = eventGap(fs);
  const row = eventRows(xs, gap, gap * 0.5);
  const x = new Array<number>(xs.length).fill(0);
  for (const r of [0, 1]) {
    const ids = xs.map((_, i) => i).filter((i) => row[i] === r);
    const placed = spreadX(
      ids.map((i) => xs[i] as number),
      gap,
      f.left,
      f.width - EVENT_R * fs - 2,
    );
    ids.forEach((id, k) => (x[id] = placed[k] as number));
  }
  return { x, row, rows: row.some((r) => r === 1) ? 2 : 1 };
}

/** 積み上げの棒（上に積む系列と下に積む系列。下は正の額で渡す） */
function bars(up: StackSeries[], down: StackSeries[], s: Scale, n: number, hatchedDown?: number[], opacity?: (key: string) => { cls: string; op: number }): preact.JSX.Element[] {
  const w = Math.max(2, s.band * 0.72);
  const out: preact.JSX.Element[] = [];
  const layer = (list: StackSeries[], sign: 1 | -1) => {
    const acc = new Array<number>(n).fill(0);
    for (const sr of list) {
      const st = opacity?.(sr.key);
      const rects: preact.JSX.Element[] = [];
      for (let i = 0; i < n; i++) {
        const v = Math.max(0, sr.values[i] ?? 0);
        if (v === 0) continue;
        const a = acc[i] as number;
        acc[i] = a + v;
        const y1 = s.y(sign * a);
        const y2 = s.y(sign * (a + v));
        rects.push(<rect key={i} x={s.x(i) - w / 2} y={Math.min(y1, y2)} width={w} height={Math.max(0.5, Math.abs(y2 - y1))} fill={`url(#pt-${sr.key})`} class={`bar b-${sr.key}`} />);
      }
      out.push(
        <g key={`${sign}${sr.key}`} class={st?.cls} opacity={st?.op}>
          {rects}
        </g>,
      );
    }
    return acc;
  };
  layer(up, 1);
  const accDown = layer(down, -1);
  if (hatchedDown !== undefined)
    for (let i = 0; i < n; i++) {
      const hv = Math.max(0, hatchedDown[i] ?? 0);
      if (hv <= 0) continue;
      const a = accDown[i] as number;
      out.push(<rect key={`h${i}`} x={s.x(i) - w / 2} y={s.y(-a)} width={w} height={Math.max(0.5, s.y(-a - hv) - s.y(-a))} class="area-short" />);
    }
  return out;
}

const tickText = (t: number) => (t < 0 ? "▲" : "") + group(t);

/** 表示（HTML の小さな箱）の実際の大きさを測る（文字の大きさ・中身が変わったとき） */
function useBoxSize(ref: RefObject<HTMLElement>): { w: number; h: number } | null {
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (el === null) return;
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    if (w > 0 && h > 0 && (size === null || Math.abs(size.w - w) > 0.5 || Math.abs(size.h - h) > 0.5)) setSize({ w, h });
  });
  return size;
}

export interface MainChartProps {
  model: MainChartModel;
  mode: ChartMode;
  explain: { model: ExplainModel; step: number } | null;
  ageMark: AgeMark | null;
  /** 固定した年（固定していなければ null）。表の同じ年が光る */
  pinnedYear: number | null;
  /** 年を固定する・外す（null） */
  onSelectYear: (year: number | null) => void;
  /** 比べ方（省略は重ねる）。説明モードと、選んだ案が基準の案のときは重ねる表示（1つのグラフ） */
  layout?: ChartLayout;
  /** 高さ（px）を決めて描く（小窓の中の表示）。省略は画面の高さに合わせる */
  height?: number;
  /** 全部の案を色分けで重ねる表示の、凡例で強調している案と一時的に隠している案 */
  multi?: MultiState;
  /** 運用の期間の帯の切れ目を動かした（動かせないときは省略。0026） */
  onBand?: (which: "stop" | "wd", age: number, phase: "slide" | "release") => void;
  /** 運用の期間の帯の切れ目を動かせない理由（つまみの札。動かせるときは省略） */
  bandLock?: string;
}

export interface MultiState {
  focus: string | null;
  hidden: readonly string[];
}

/** 年の表示の中身（○の位置と文字） */
interface YearMark {
  /** 選んだ案の○の y */
  sel: number;
  /** 基準の案の○の y（同じ案のときは null） */
  base: number | null;
  /** 2行目の頭（例: 「年間収支」） */
  lead: string;
  selText: string;
  baseText: string | null;
  /** 3行目（例: 「収入 650万円・支出 770万円（B案）」） */
  extra: string | null;
  /** 表が先に終わった案の、その後の年（○を描かない） */
  selGone?: boolean;
  baseGone?: boolean;
}

export function MainChart({ model, mode, explain, ageMark, pinnedYear, onSelectYear, layout = "overlay", height, multi, onBand, bandLock }: MainChartProps) {
  const box = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<number | null>(null);
  const [size, setSize] = useState<{ w: number; h: number; fs: number }>({ w: 1100, h: 520, fs: 1 });
  // 幅は枠に合わせ、高さは画面の高さに合わせる（文字を大きくしたときも測り直す）
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

  const n = model.chart.years.length;
  const ex = explain?.model ?? null;
  const t = useTween(flatten(model, ex));
  const years = model.chart.years;
  const h = height ?? size.h;
  const compact = height !== undefined;
  // 縮めた表示で、左右に並べると縦に積む幅のときは、重ねる表示にする（縦に2つ積むと高くなりすぎる）
  const side = layout === "side" && explain === null && !model.names.same && !(compact && sideLayout(size.w, h, size.fs).stacked);
  const all = multiOn(layout, explain, model);
  const pinned = pinnedYear !== null && years.includes(pinnedYear) ? pinnedYear : null;
  const shown = explain === null ? shownYear(pinned, hover !== null && years.includes(hover) ? hover : null) : null;
  // 「!」の段: 出す「!」があるときだけ設ける（左右に並べる表示では、どちらかに出れば両方に設けて高さをそろえる。全部のプランを重ねる表示は、隠したプランも数えて隠しても高さが動かない）
  const shortRow =
    !compact &&
    (side
      ? (["base", "selected"] as const).some((who) => shortSources(planModel(model, who), { explain: false, multi: null }).length > 0)
      : shortSources(model, { explain: explain !== null, multi: all ? { focus: null, hidden: [] } : null }).length > 0);

  const onKey = (e: KeyboardEvent) => {
    if (explain !== null) return;
    if (e.key === "Escape" && pinned !== null) {
      e.preventDefault();
      onSelectYear(null);
      return;
    }
    const dir = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
    if (dir === 0) return;
    const y = stepYear(years, pinned, hover, model.selectedYear, dir);
    if (y !== undefined) {
      e.preventDefault();
      onSelectYear(y);
    }
  };
  // 固定中は、グラフの外にいても Esc で外せる（引き出しなどが先に Esc を使ったときは何もしない）
  useEffect(() => {
    if (pinned === null || explain !== null) return;
    const onDoc = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA") return;
      onSelectYear(null);
    };
    document.addEventListener("keydown", onDoc);
    return () => document.removeEventListener("keydown", onDoc);
  }, [pinned, explain, onSelectYear]);

  const modeLabel = explain !== null ? "説明モードのグラフ" : all ? MULTI_WHAT[mode].caption : (CHART_MODES.find((m) => m.id === mode)?.label ?? "グラフ");
  // 年の選択・固定・カーソルは、左右に並べたときも2つのグラフで同じ年にそろえる
  const common = {
    mode,
    explain,
    ageMark,
    pinned,
    shown,
    compact,
    shortRow,
    ...(onBand !== undefined ? { onBand } : {}),
    ...(bandLock !== undefined ? { bandLock } : {}),
    onHover: (y: number | null) => setHover((h) => (h === y ? h : y)),
    onPick: (y: number) => {
      setHover(y);
      onSelectYear(togglePin(pinned, y));
    },
  };

  let body: preact.JSX.Element;
  if (!side) body = <ChartPlot {...common} model={model} t={t} size={{ w: size.w, h, fs: size.fs }} scaleWith={[]} label={modeLabel} live={!compact} multi={all ? (multi ?? { focus: null, hidden: [] }) : null} />;
  else {
    const lay = compact ? { ...sideLayout(size.w, h, size.fs), h } : sideLayout(size.w, h, size.fs);
    const panes = (["base", "selected"] as const).map((who) => {
      const m = planModel(model, who);
      const pt = planSeries(t, who);
      return { who, m, t: pt, ext: scaleInputs(m, pt, mode, n) };
    });
    body = (
      <div class={`side-grid${lay.stacked ? " stacked" : ""}`} style={{ gap: `${lay.gap}px` }} data-side-grid={lay.stacked ? "stacked" : "row"}>
        {panes.map((p, i) => (
          <div class={`side-pane ${p.who}`} key={p.who} data-side={p.who}>
            <div class="side-h">
              <b>{p.m.names.selected}</b>
              <span class="side-tag">{p.who === "base" ? "基準" : "選んだプラン"}</span>
            </div>
            <ChartPlot {...common} model={p.m} t={p.t} size={{ w: lay.w, h: lay.h, fs: size.fs }} scaleWith={(panes[1 - i] as (typeof panes)[number]).ext} label={`${modeLabel}（${p.m.names.selected}）`} live={p.who === "selected" && !compact} />
          </div>
        ))}
      </div>
    );
  }

  return (
    <div
      class={`chart main-chart${side ? " side" : ""}${compact ? " compact" : ""}`}
      ref={box}
      tabIndex={0}
      onKeyDown={onKey}
      role="group"
      aria-label={`グラフ${side ? `（${model.names.base}と${model.names.selected}を左右に並べています）` : all ? "（全部のプランを色で描き分けて重ねています）" : ""}。カーソルを合わせるとその年の数字が出ます。クリックか左右の矢印キーで年を固定し、Esc で外します`}
      data-main-chart={explain !== null ? "explain" : mode}
      data-chart-layout={side ? "side" : all ? "all" : "overlay"}
      data-shown-year={shown ?? undefined}
      data-pinned-year={pinned ?? undefined}
    >
      {body}
    </div>
  );
}

interface ChartPlotProps {
  model: MainChartModel;
  t: Series;
  mode: ChartMode;
  explain: { model: ExplainModel; step: number } | null;
  ageMark: AgeMark | null;
  pinned: number | null;
  /** ○と表示を出す年（固定した年か、カーソルを合わせた年） */
  shown: number | null;
  size: { w: number; h: number; fs: number };
  /** 縦の目盛りを決めるときに足す系列（左右に並べる表示で、もう一方の案の系列） */
  scaleWith: number[][];
  label: string;
  /** 固定したときに読み上げる（左右に並べる表示では片方だけ） */
  live: boolean;
  /** 縮めた表示（年のイベントの丸を描かない） */
  compact?: boolean;
  /** 「!」の段を設ける（MainChart が決める） */
  shortRow: boolean;
  /** 全部の案を色分けで重ねる表示（それ以外は null） */
  multi?: MultiState | null;
  onBand?: MainChartProps["onBand"];
  bandLock?: string;
  onHover: (year: number | null) => void;
  onPick: (year: number) => void;
}

/** 全部の案を重ねる表示の、選んだ年の1つの案の値 */
interface MultiRow {
  key: string;
  name: string;
  title: string;
  st: PlanStyle;
  /** 線の上の印の y（表が先に終わったプランの、その後の年は null で印を出さない） */
  y: number | null;
  text: string;
  neg: boolean;
  selected: boolean;
}

/** 1つのグラフ（SVG と、年の表示・イベントの表示） */
function ChartPlot({ model, t, mode, explain, ageMark, pinned, shown, size, scaleWith, label, live, compact = false, shortRow, multi = null, onBand, bandLock, onHover, onPick }: ChartPlotProps) {
  const svg = useRef<SVGSVGElement>(null);
  const tip = useRef<HTMLDivElement>(null);
  const evTipEl = useRef<HTMLDivElement>(null);
  const evFocus = useEventFocus<number>();
  const evOn = evFocus.on;
  const tipSize = useBoxSize(tip);
  const evTipSize = useBoxSize(evTipEl);
  const skTipEl = useRef<HTMLDivElement>(null);
  const skFocus = useEventFocus<number>();
  const skTipSize = useBoxSize(skTipEl);

  const n = model.chart.years.length;
  const ex = explain?.model ?? null;
  const same = model.names.same;
  const years = model.chart.years;
  const ages = model.chart.ages;
  const showMark = ageMark !== null && mode === "assets" && explain === null;
  // 資産運用（資産の推移のときだけ。説明モード・全部のプランを重ねる表示では出さない）
  const inv = mode === "assets" && explain === null && multi === null ? model.invest : undefined;
  const bandOn = inv !== undefined && inv.band !== null && inv.view.band && !compact;
  const fs = size.fs;
  // 小窓の中の表示では、年のイベントの丸を描かない（線と塗りの高さを残す。丸は元のグラフと表にある）。
  // 資産が尽きる年の「!」はできごとの丸の段に置かず、すぐ上の「!」の段に置く
  const evList = compact ? [] : model.events.filter((e) => years.includes(e.year) && e.icon !== "！");
  // 丸の横の位置は下の余白に関わらないので、先に段の数を決めてから枠を決める
  const isMulti = multi !== null && explain === null;
  // 右の余白: ○歳時点の印の数字（重ねる表示）か、線の右端のプランの文字と「基準」の札（全部のプランを重ねる表示）の分
  const right = isMulti ? 78 : showMark ? 92 : 20;
  // 全部のプランを重ねる表示で、目盛りが動いている途中に線が枠からはみ出さないように切り抜く
  const clipId = `mc-clip-${useId().replace(/[^A-Za-z0-9_-]/g, "")}`;
  const evLay = eventLayout(evList, years, frameOf(size.w, size.h, fs, right), fs);
  const axis = model.chart.axis;
  const f = frameOf(size.w, size.h, fs, right, compact ? 0 : evLay.rows, shortRow, axis.length);
  const selIdx = shown === null ? -1 : years.indexOf(shown);

  /** カーソル・指の位置から年を読む（SVG の座標に直す） */
  const yearAt = (e: MouseEvent): number | null => {
    const el = svg.current;
    if (el === null) return null;
    const r = el.getBoundingClientRect();
    const x = (e.clientX - r.left) * (r.width > 0 ? f.width / r.width : 1);
    const i = indexAt(x, f, n);
    return i === null ? null : (years[i] ?? null);
  };

  // ---- 系列（補間した値）----
  let s: Scale;
  let body: preact.JSX.Element[] = [];
  let zeroLabels: [string, string] | null = null;
  let mark: YearMark | null = null;
  const pEnds = model.chart.proposalEnds;
  const cEnds = model.chart.currentEnds;
  // 表が先に終わったプランの、その後の年は値が無い（「表は○年まで」）
  const past = (ends: number | undefined) => ends !== undefined && selIdx >= ends;
  const endText = (ends: number | undefined) => `表は${years[Math.max(0, (ends ?? 1) - 1)] ?? ""}年まで`;
  const at = (arr: readonly number[], ends?: number) => (past(ends) ? endText(ends) : `${man(arr[selIdx] ?? 0)}万円`);
  const sumAt = (list: StackSeries[]) => list.reduce((a, x) => a + Math.max(0, x.values[selIdx] ?? 0), 0);
  const keys: string[] = [];
  /** 全部のプランを重ねる表示の、選んだ年の各プランの値（帯の順） */
  let multiRows: MultiRow[] | null = null;
  /** 全部のプランを重ねる表示で、隠したために目盛りを決め直したか */
  let rescaled = false;

  // 全部のプランを重ねる表示の線と縦の目盛りの範囲（目盛りの動きのフックは、どの表示でも同じ順で呼ぶ）
  const mPlans = isMulti ? (model.plans ?? []) : [];
  const mStyles = planStyles(mPlans);
  const lines = mPlans.flatMap((p) => {
    const raw = lineOf(p, mode);
    return raw === null ? [] : [{ p, st: mStyles.get(p.key) as PlanStyle, v: pick(t, multiKey(p.key, mode), n), raw }];
  });
  const visible = lines.filter((l) => !(multi?.hidden ?? []).includes(l.p.key));
  // 縦の目盛りは、できるだけ隠したプランも含めて決める（少し隠しても目盛りが動かない）。隠した結果、残りの線がつぶれるときだけ
  // 表示中の線に合わせて決め直し、行き過ぎのない動きでなめらかにつなぐ（戻すと元の目盛りに戻る）
  const md = multiDomain([...lines.map((l) => l.v), ...scaleWith], [...visible.map((l) => l.v), ...scaleWith]);
  const eased = useSwitchEase(!isMulti ? "off" : md.rescaled ? `fit:${visible.map((l) => l.p.key).join(",")}` : "all", [md.domain.min, md.domain.max, md.domain.step], { animate: (a, b) => a !== "off" && b !== "off" });

  if (isMulti && multi !== null) {
    const what = MULTI_WHAT[mode];
    const [dMin, dMax] = eased.value as [number, number, number];
    // 動いている途中の目盛りの間隔は、動きの前半は前の間隔、後半は新しい間隔（目盛りの数が急に増えたり減ったりしない）
    const dStep = eased.from !== null && eased.k < 0.5 ? (eased.from[2] as number) : md.domain.step;
    s = scaleOf({ min: dMin, max: dMax, step: dStep }, n, f);
    rescaled = md.rescaled;
    if (rescaled)
      body.push(
        <text key="fit-t" x={f.width - f.right} y={f.top - 10} class="unit fit-t" text-anchor="end" data-scale-note>
          縦の目盛りを表示中の線に合わせています
        </text>,
      );
    // 0未満の範囲: 線には塗りを付けず、薄い地と言葉で示す（0の線は太く）
    if (s.min < 0) {
      const y0 = s.y(0);
      const y1 = s.y(s.min * 10000);
      body.push(<rect key="zone" x={f.left} y={y0} width={Math.max(0, f.width - f.left - f.right)} height={Math.max(0, y1 - y0)} class="multi-zone" />);
      // 言葉は範囲の下の端に置く（0の近くを通る線と重ならないように。範囲が狭ければ出さない）
      if (y1 - y0 > 28 * fs)
        body.push(
          <text key="zone-t" x={f.left + 6} y={y1 - 7 * fs} class="unit zone-t">
            ↓ {what.zone}
          </text>,
        );
    }
    if (showMark && ageMark !== null) {
      const i = years.indexOf(ageMark.year);
      if (i >= 0)
        body.push(
          <g key="mark">
            <line x1={s.x(i)} x2={s.x(i)} y1={f.top} y2={f.height - f.bottom} class="m-age" />
            <text x={s.x(i)} y={f.top - 8} class="m-age-t" text-anchor="middle">
              {ageMark.label}
            </text>
          </g>,
        );
    }
    // 重ね順: 基準のプラン → ほかのプラン → 選んだプラン → 強調しているプラン（いちばん上）
    const rank = (l: (typeof lines)[number]) => (multi.focus === l.p.key ? 3 : l.p.selected ? 2 : l.p.base ? 0 : 1);
    const order = [...visible].sort((a, b) => rank(a) - rank(b));
    const lastX = s.x(n - 1);
    // 線の右端のプランの文字（重なるときは縦にずらす）。基準のプランには「基準」の札を添える
    // 表が先に終わるプランの線は、その年で終える（端の丸と文字もそこに置く。後の年を 0 円として描かない）
    const lastOf = (l: (typeof lines)[number]) => Math.max(0, Math.min(n, l.p.ends ?? n) - 1);
    const endYs = spreadX(
      visible.map((l) => s.y(l.v[lastOf(l)] ?? 0)),
      15 * fs,
      f.top,
      f.height - f.bottom,
    );
    const endY = new Map(visible.map((l, i) => [l.p.key, endYs[i] as number]));
    for (const l of order) {
      const dim = multi.focus !== null && multi.focus !== l.p.key;
      body.push(
        <g key={`ml-${l.p.key}`} class={`ml${dim ? " dim" : ""}${multi.focus === l.p.key ? " hi" : ""}${l.p.selected ? " sel" : ""}${l.p.base ? " base" : ""}`} data-multi-line={l.p.key}>
          <g clip-path={`url(#${clipId})`}>
            <path d={linePath(l.v.slice(0, lastOf(l) + 1), s)} class="multi-line" stroke={l.st.color} />
            <PlanMarker x={s.x(lastOf(l))} y={s.y(l.v[lastOf(l)] ?? 0)} r={5.5 * fs} color={l.st.color} />
          </g>
          <text x={(lastOf(l) === n - 1 ? lastX : s.x(lastOf(l))) + 10 * fs} y={(lastOf(l) === n - 1 ? (endY.get(l.p.key) ?? 0) : s.y(l.v[lastOf(l)] ?? 0)) + 4.5 * fs} class="ml-end" fill={l.st.color} data-multi-end={lastOf(l) === n - 1 ? undefined : years[lastOf(l)]}>
            {l.p.key}
            {l.p.base ? (
              <tspan class="ml-end-base" dx={4 * fs}>
                基準
              </tspan>
            ) : null}
          </text>
        </g>,
      );
    }
    if (selIdx >= 0 && visible.length > 0) {
      multiRows = visible.map((l) => {
        // 表が先に終わったプランの、その後の年は値が無い（「表は○年まで」。丸は出さない）
        if (selIdx > lastOf(l)) return { key: l.p.key, name: l.p.name, title: l.p.title, st: l.st, y: null, text: `表は${years[lastOf(l)] ?? ""}年まで`, neg: false, selected: l.p.selected };
        const v = l.raw[selIdx] ?? 0;
        return { key: l.p.key, name: l.p.name, title: l.p.title, st: l.st, y: s.y(l.v[selIdx] ?? 0), text: `${man(v)}万円`, neg: v < 0, selected: l.p.selected };
      });
      const ys = multiRows.flatMap((r) => (r.y === null ? [] : [r.y]));
      if (ys.length === 0) ys.push(s.y(0));
      mark = { sel: Math.min(...ys), base: Math.max(...ys), lead: what.lead, selText: "", baseText: null, extra: null };
    }
  } else if (explain !== null && ex !== null) {
    const step = explain.step;
    const on = (k: string) => ex.steps.findIndex((x) => x.key === k) <= step;
    const now = (k: string) => ex.steps.findIndex((x) => x.key === k) === step;
    const work = pick(t, "x.work", n);
    const pension = pick(t, "x.pension", n);
    const living = pick(t, "x.living", n);
    const education = pick(t, "x.education", n);
    const housing = pick(t, "x.housing", n);
    const fin = pick(t, "x.financial", n);
    const stepOf: Record<string, string> = { work: "income", pension: "pension", living: "expense", education: "education", housing: "housing" };
    const allUp: StackSeries[] = [
      { key: "work", label: "給与・退職金などの収入", values: work },
      { key: "pension", label: "年金", values: pension },
    ];
    const allDown: StackSeries[] = [
      { key: "living", label: "生活費・税など", values: living },
      { key: "education", label: "教育費", values: education },
      { key: "housing", label: "住居費", values: housing },
    ];
    const up = allUp.filter((x) => on(stepOf[x.key] ?? ""));
    const down = allDown.filter((x) => on(stepOf[x.key] ?? ""));
    const showAssets = on("assets");
    // 目盛りは収入と支出を全部足した形で決めて、収入〜住宅の段を進めても0の線・目盛りが動かないようにする。
    // 資産の推移の段だけは金融資産の線も入る目盛りにする（棒の段から資産の大きさに合わせると棒が小さくなりすぎるため）
    s = scale([totals(allUp, n, 1), totals(allDown, n, -1), showAssets ? fin : []], n, f);
    keys.push(...up.map((x) => x.key), ...down.map((x) => x.key));
    body = bars(up, down, s, n, undefined, (k) => (now(stepOf[k] ?? "") ? { cls: "ex-new", op: 1 } : { cls: "", op: 0.55 }));
    if (showAssets)
      body.push(
        <g key="fin" class={now("assets") ? "ex-new" : ""}>
          <path d={areaBelow(fin, s)} class="area-short" />
          <path d={linePath(fin, s)} class="line-prop" />
        </g>,
      );
    zeroLabels = ["↑ 入るお金", "↓ 出るお金"];
  } else if (mode === "flows") {
    const { inc, exp, net, bnet } = flowParts(model, t, n);
    s = scale([...scaleInputs(model, t, mode, n), ...scaleWith], n, f);
    keys.push(...inc.map((x) => x.key), ...exp.map((x) => x.key));
    body = bars(inc, exp, s, n);
    // 赤字の年: 下の帯（赤のベタ塗り）。続く年のまとまりの初めに「▲」
    const bandY = f.height - f.bottom - 9;
    model.flows.net.forEach((v, i) => {
      if (v >= 0) return;
      body.push(<rect key={`f${i}`} x={s.x(i) - s.band / 2} y={bandY} width={s.band} height={9} class="flag-band" />);
      if (i === 0 || (model.flows.net[i - 1] ?? 0) >= 0)
        body.push(
          <text key={`ft${i}`} x={s.x(i) - s.band / 2} y={bandY - 3} class="flag-txt">
            ▲
          </text>,
        );
    });
    if (!same) body.push(<path key="bnet" d={linePath(upTo(bnet, cEnds), s)} class="net-base" />);
    body.push(<path key="net" d={linePath(upTo(net, pEnds), s)} class="net-sel" />);
    zeroLabels = ["↑ 収入", "↓ 支出"];
    if (selIdx >= 0)
      mark = {
        sel: s.y(past(pEnds) ? 0 : (net[selIdx] ?? 0)),
        base: same ? null : s.y(past(cEnds) ? 0 : (bnet[selIdx] ?? 0)),
        lead: "年間収支",
        ...(past(pEnds) ? { selGone: true } : {}),
        ...(past(cEnds) ? { baseGone: true } : {}),
        selText: at(model.flows.net, pEnds),
        baseText: same ? null : at(model.baseLines.net, cEnds),
        extra: `収入 ${man(sumAt(model.flows.income))}万円・支出 ${man(sumAt(model.flows.expense))}万円（${model.names.selected}）`,
      };
  } else {
    const aSel = pick(t, "a.sel", n);
    const aBase = pick(t, "a.base", n);
    s = scale([...scaleInputs(model, t, mode, n), ...scaleWith], n, f);
    if (!same) body.push(<path key="bb" d={areaBelow(upTo(aBase, cEnds), s)} class="area-short" opacity={0.75} />);
    body.push(<path key="sb" d={areaBelow(upTo(aSel, pEnds), s)} class="area-short" />);
    // 口座の内訳（表示の設定）: 口座ごとのベタ塗りの積み上げ。無ければ合計の1本の塗り（0026）
    const bd = inv !== undefined && inv.view.breakdown && inv.breakdown !== null && inv.breakdown.length > 0 ? inv.breakdown : null;
    if (bd !== null) body.push(...stackAreas(bd, s, n));
    else body.push(<path key="sa" d={areaAbove(upTo(aSel, pEnds), s)} class="area-prop" />);
    // 運用の期間の帯の切れ目の細い縦の線
    if (bandOn && inv?.band != null) {
      const b = inv.band;
      for (const [k, i] of [["acc", b.accumEnd], ["wd", b.wdStart]] as const) {
        if (i === null || i <= 0 || i >= n) continue;
        const x = s.x(i) - s.band / 2;
        body.push(<line key={`pl-${k}`} x1={x} x2={x} y1={f.top} y2={f.height - f.bottom} class="period-line" />);
      }
    }
    if (showMark && ageMark !== null) {
      const i = years.indexOf(ageMark.year);
      if (i >= 0)
        body.push(
          <g key="mark">
            <line x1={s.x(i)} x2={s.x(i)} y1={f.top} y2={f.height - f.bottom} class="m-age" />
            <text x={s.x(i)} y={f.top - 8} class="m-age-t" text-anchor="middle">
              {ageMark.label}
            </text>
          </g>,
        );
    }
    if (!same) body.push(<path key="lb" d={linePath(upTo(aBase, cEnds), s)} class="line-base" />);
    body.push(<path key="ls" d={linePath(upTo(aSel, pEnds), s)} class="line-prop" />);
    // 相場が下がった場合（重ねたときだけ）
    if (inv?.stress != null) body.push(...stressPaths(inv.stress, inv.view.stressHidden, s, n, fs, f.top));
    if (showMark && ageMark !== null) {
      const i = years.indexOf(ageMark.year);
      if (i >= 0) {
        const vs = aSel[i] ?? 0;
        const vb = aBase[i] ?? 0;
        const ys = s.y(vs);
        const yb = s.y(vb);
        const lx = f.width - f.right + 6;
        let ly = ys;
        let lb = yb;
        if (!same && Math.abs(ys - yb) < 18) {
          if (ys <= yb) {
            ly -= 9;
            lb += 9;
          } else {
            ly += 9;
            lb -= 9;
          }
        }
        if (!same) body.push(<circle key="db" cx={s.x(i)} cy={yb} r={5} class="dot-base" />);
        body.push(<circle key="ds" cx={s.x(i)} cy={ys} r={6} class="dot-sel" />);
        body.push(
          <text key="vs" x={lx} y={ly + 4} class={`val sel${vs < 0 ? " neg" : ""}`}>
            {model.names.selected} {man(model.chart.proposal[i] ?? 0)}
          </text>,
        );
        if (!same)
          body.push(
            <text key="vb" x={lx} y={lb + 4} class={`val base${vb < 0 ? " neg" : ""}`}>
              {model.names.base} {man(model.chart.current[i] ?? 0)}
            </text>,
          );
      }
    }
    if (selIdx >= 0)
      mark = {
        sel: s.y(past(pEnds) ? 0 : (aSel[selIdx] ?? 0)),
        base: same ? null : s.y(past(cEnds) ? 0 : (aBase[selIdx] ?? 0)),
        lead: "金融資産",
        ...(past(pEnds) ? { selGone: true } : {}),
        ...(past(cEnds) ? { baseGone: true } : {}),
        selText: at(model.chart.proposal, pEnds),
        baseText: same ? null : at(model.chart.current, cEnds),
        extra: null,
      };
  }

  // ---- 年のイベント（x 軸のすぐ下の丸）: 重なる丸は横に並べ直す。カーソル・フォーカスで年と中身を出す ----
  const evR = EVENT_R * fs;
  const evX = evLay.x;
  const evYs = evLay.row.map((r) => eventRowTop(f, shortRow, fs) + 4 * fs + evR + r * eventGap(fs));
  const evNow = evOn !== null ? evList[evOn] : undefined;
  const evs = evList.map((e, j) => <EventDotSvg key={`${e.year}-${e.icon}-${j}`} chip={e} x={evX[j] as number} y={evYs[j] as number} r={evR} on={evOn === j} handlers={evFocus.bind(j)} />);

  // ---- 金融資産が足りなくなる所: 「!」の段の丸と、線が0を切る所からの赤い点線（点線は資産の推移の線があるときだけ）----
  const skList = shortSources(model, { explain: explain !== null, multi: isMulti ? multi : null }).filter((m) => years.includes(m.year));
  const skLine = explain !== null && ex !== null ? ex.steps.findIndex((x) => x.key === "assets") <= explain.step : mode === "assets";
  // 横の位置: 線が0を切る所（資産の線が無い収支の推移では、足りなくなる年の位置）
  const skXs = skList.map((m) => s.x(skLine ? m.cross : years.indexOf(m.year)));
  const skAt = shortRow ? shortXs(skXs, fs, f.left, f.width - f.right) : null;
  const skRowTop = shortRowTop(f);
  const skNow = skFocus.on !== null ? skList[skFocus.on] : undefined;
  const skCy = shortCenter(skRowTop, fs);
  const skPlace =
    skNow !== undefined && skAt !== null && skFocus.on !== null
      ? placeAbove(skAt[skFocus.on] as number, skCy - SHORT_R * fs, skCy + SHORT_R * fs, skTipSize?.w ?? estimateWidth([skNow.text], 13 * fs), skTipSize?.h ?? 30 * fs, f.width, f.height)
      : null;

  // ---- 年の印（線の上の○・細い縦の補助線）と小さな表示 ----
  const age = selIdx >= 0 ? ages[selIdx] : undefined;
  // 年の目盛りの数字: ふつうは5年ごと。狭い幅（スマホの縦の画面）で5年の間が文字の幅より狭いときは10年ごと
  const labelStep = years.length > 5 && Math.abs(s.x(5) - s.x(0)) < 46 * fs ? 10 : 5;
  // 札の見出し: 年と家族全員の年齢（例: 「2045年 ご本人64歳・配偶者62歳・第1子35歳」。yearHead）
  const head = selIdx >= 0 ? yearHead(years[selIdx] as number, model.chart.family[selIdx] ?? (age != null ? `${model.who}${age}歳` : undefined)) : "";
  const valueLine = mark !== null ? `${mark.lead} ● ${model.names.selected} ${mark.selText}${mark.baseText !== null ? `／○ ${model.names.base} ${mark.baseText}` : ""}` : "";
  const tipLines =
    mark === null ? [] : multiRows !== null ? [`${head}${pinned !== null ? " 固定中" : ""}`, mark.lead, ...multiRows.map((r) => `●● ${r.name} ${r.title} ${r.text}`)] : [`${head}${pinned !== null ? " 固定中" : ""}`, valueLine, ...(mark.extra !== null ? [mark.extra] : [])];
  const tw = tipSize?.w ?? estimateWidth(tipLines, 13 * fs);
  const th = tipSize?.h ?? (tipLines.length * 19 + 12) * fs;
  const mx = selIdx >= 0 ? s.x(selIdx) : 0;
  const place = mark !== null ? placeTip(mx, Math.min(mark.sel, mark.base ?? mark.sel), Math.max(mark.sel, mark.base ?? mark.sel), tw, th, f.width, f.height) : null;
  // イベントの表示（丸の真上）
  const evText = evNow !== undefined ? eventLabel(evNow) : "";
  const evPlace =
    evNow !== undefined && evOn !== null ? placeAbove(evX[evOn] as number, (evYs[evOn] as number) - evR, (evYs[evOn] as number) + evR, evTipSize?.w ?? estimateWidth([evText], 13 * fs), evTipSize?.h ?? 30 * fs, f.width, f.height) : null;
  const pct = (v: number, of: number) => `${((v / of) * 100).toFixed(3)}%`;

  return (
    <>
    {bandOn && inv?.band != null ? <PeriodBand band={inv.band} s={s} n={n} left={f.left} width={f.width} ages={ages} {...(onBand !== undefined ? { onBand } : {})} {...(bandLock !== undefined ? { lock: bandLock } : {})} /> : null}
    <div class="plot">
      <svg ref={svg} viewBox={`0 0 ${f.width} ${f.height}`} width={f.width} height={f.height} role="img" aria-label={label} data-multi-scale={isMulti ? (rescaled ? "fit" : "all") : undefined}>
        <defs>
          {isMulti ? (
            <clipPath id={clipId}>
              <rect x={f.left - 2} y={f.top - 10} width={Math.max(0, f.width - f.left - f.right + 4)} height={Math.max(0, f.height - f.top - f.bottom + 20)} />
            </clipPath>
          ) : null}
          {keys.map((k) => (
            <Pattern key={k} k={k} />
          ))}
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
        {skLine && skList.length > 0 ? <ShortLinesSvg list={skList} xs={skXs} at={skAt} top={s.y(0)} rowTop={skRowTop} fs={fs} /> : null}
        {mark !== null ? <line x1={mx} x2={mx} y1={f.top - 4} y2={f.height - f.bottom} class={`hv-guide${pinned !== null ? " pinned" : ""}`} /> : null}
        {evNow !== undefined ? <line x1={s.x(years.indexOf(evNow.year))} x2={s.x(years.indexOf(evNow.year))} y1={f.top - 4} y2={f.height - f.bottom} class="hv-guide ev-guide" /> : null}
        {zeroLabels !== null ? (
          <>
            <text x={f.left + 6} y={s.y(0) - 6} class="unit">
              {zeroLabels[0]}
            </text>
            <text x={f.left + 6} y={s.y(0) + 16} class="unit">
              {zeroLabels[1]}
            </text>
          </>
        ) : null}
        <AgeAxisSvg years={years} axis={axis} x={s.x} show={(y) => y % labelStep === 0} yearY={f.height - (24 + ageExtra(axis.length)) * fs} left={f.left} fs={fs} />
        {mark !== null && multiRows !== null ? (
          <g class="hv-dots" data-year-mark>
            {multiRows.map((r) => (r.y === null ? null : <PlanMarker key={r.key} x={mx} y={r.y} r={6.5 * fs} color={r.st.color} cls="hv-mk" />))}
          </g>
        ) : mark !== null ? (
          <g class="hv-dots" data-year-mark>
            {mark.base !== null && mark.baseGone !== true ? <circle cx={mx} cy={mark.base} r={6 * fs} class="hv-dot base" /> : null}
            {mark.selGone !== true ? <circle cx={mx} cy={mark.sel} r={6.5 * fs} class="hv-dot sel" /> : null}
          </g>
        ) : null}
        {explain === null ? (
          <rect
            x={f.left}
            y={f.top - 4}
            width={Math.max(0, f.width - f.left - f.right)}
            height={Math.max(0, f.height - f.top + 4)}
            class="hit-area"
            data-hit-area
            onPointerMove={(e) => onHover(yearAt(e))}
            onPointerLeave={() => onHover(null)}
            onClick={(e) => {
              const y = yearAt(e);
              if (y !== null) onPick(y);
            }}
          />
        ) : null}
        {/* イベントの丸は、年を読む面より上に置く（カーソルを合わせられるように） */}
        <g class="evs">{evs}</g>
        {skAt !== null && skList.length > 0 ? <ShortDotsSvg list={skList} at={skAt} rowTop={skRowTop} fs={fs} focus={skFocus} /> : null}
      </svg>
      {mark !== null && place !== null && multiRows !== null ? (
        <div
          ref={tip}
          class={`sel-lbl year-tip multi-tip${pinned !== null ? " pinned" : ""}`}
          style={{ left: pct(place.left, f.width), top: pct(place.top, f.height) }}
          role={pinned !== null && live ? "status" : undefined}
          data-year-tip={place.side}
        >
          <div class="yt-h">
            {head}
            {pinned !== null ? (
              <>
                <span class="yt-pin">固定中</span>
                <button
                  type="button"
                  class="yt-unpin"
                  aria-label="固定を外す"
                  title="固定を外す（Esc でも外せます）"
                  data-unpin
                  onClick={(e) => {
                    e.stopPropagation();
                    onPick(pinned);
                  }}
                >
                  ×
                </button>
              </>
            ) : null}
          </div>
          <div class="yt-lead">{mark.lead}（帯の順）</div>
          <ul class="yt-rows">
            {multiRows.map((r) => (
              <li key={r.key} class={r.selected ? "sel" : ""} data-tip-plan={r.key}>
                <PlanSwatch style={r.st} w={26} h={12} />
                <span class="yt-n">{r.name}</span>
                <span class="yt-t">{r.title}</span>
                <b class={r.neg ? "neg" : ""}>{r.text}</b>
              </li>
            ))}
          </ul>
        </div>
      ) : mark !== null && place !== null ? (
        <div
          ref={tip}
          class={`sel-lbl year-tip${pinned !== null ? " pinned" : ""}`}
          style={{ left: pct(place.left, f.width), top: pct(place.top, f.height) }}
          role={pinned !== null && live ? "status" : undefined}
          data-year-tip={place.side}
        >
          <div class="yt-h">
            {head}
            {pinned !== null ? (
              <>
                <span class="yt-pin">固定中</span>
                <button
                  type="button"
                  class="yt-unpin"
                  aria-label="固定を外す"
                  title="固定を外す（Esc でも外せます）"
                  data-unpin
                  onClick={(e) => {
                    e.stopPropagation();
                    onPick(pinned);
                  }}
                >
                  ×
                </button>
              </>
            ) : null}
          </div>
          <div class="yt-v">
            {mark.lead !== "金融資産" ? <span class="yt-lead">{mark.lead}</span> : null}
            <span class="yt-s">
              <i class="yt-dot sel" aria-hidden="true" />
              {model.names.selected} <b class={mark.selText.startsWith("▲") ? "neg" : ""}>{mark.selText}</b>
            </span>
            {mark.baseText !== null ? (
              <span class="yt-b">
                ／<i class="yt-dot base" aria-hidden="true" />
                {model.names.base} <b class={mark.baseText.startsWith("▲") ? "neg" : ""}>{mark.baseText}</b>
              </span>
            ) : null}
          </div>
          {mark.extra !== null ? <div class="yt-x">{mark.extra}</div> : null}
        </div>
      ) : null}
      {evNow !== undefined && evPlace !== null ? <EventTip chip={evNow} tipRef={evTipEl} style={{ left: pct(evPlace.left, f.width), top: pct(evPlace.top, f.height) }} /> : null}
      {skNow !== undefined && skPlace !== null ? <ShortTip text={skNow.text} tipRef={skTipEl} style={{ left: pct(skPlace.left, f.width), top: pct(skPlace.top, f.height) }} /> : null}
    </div>
    </>
  );
}

/** グラフの凡例（モードごと）。右端に操作の手がかり */
export function MainLegend({ model, mode, explain, side = false }: { model: MainChartModel; mode: ChartMode; explain: { model: ExplainModel; step: number } | null; side?: boolean }) {
  // 左右に並べる表示: 案の名前は各グラフの上に出すので、凡例は線・積み上げの種類だけ
  const nm = side ? { ...model.names, same: true } : model.names;
  const sel = (label: string) => (side ? label : `${label} ${nm.selected}`);
  const base = nm.same ? null : (
    <span class="lg base">
      <i />
      {nm.base}（基準）
    </span>
  );
  const sw = (k: string, label: string) => (
    <span class="lg" key={k}>
      <Swatch k={k} />
      {label}
    </span>
  );
  let items: (preact.JSX.Element | null)[];
  if (explain !== null) {
    const step = explain.step;
    const on = (k: string) => explain.model.steps.findIndex((x) => x.key === k) <= step;
    // まだの段の印も場所を取っておく（見えなくするだけ）。段を進めても凡例の行の数・グラフの位置が動かない
    const exItem = (step: string, k: string, label: string, swatch: boolean) => (
      <span key={k} class={`lg${on(step) ? "" : " ex-later"}`} {...(on(step) ? {} : { "aria-hidden": true, "data-ex-later": "" })}>
        {swatch ? <Swatch k={k} /> : <i />}
        {label}
      </span>
    );
    items = [
      exItem("income", "work", "給与・退職金など", true),
      exItem("pension", "pension", "年金", true),
      exItem("expense", "living", "生活費・税など", true),
      exItem("education", "education", "教育", true),
      exItem("housing", "housing", "住宅", true),
      exItem("assets", "fin", "金融資産", false),
    ];
  } else if (mode === "flows") {
    items = [
      ...model.flows.income.map((x) => sw(x.key, x.label)),
      ...model.flows.expense.map((x) => sw(x.key, x.label)),
      <span class="lg net" key="net">
        <i />
        {sel("年間収支")}
      </span>,
      nm.same ? null : (
        <span class="lg base" key="bnet">
          <i />
          年間収支 {nm.base}（基準）
        </span>
      ),
      <span class="lg short" key="short">
        <i />
        赤字の年（▲）
      </span>,
    ];
  } else {
    items = [
      <span class="lg" key="sel">
        <i />
        {side ? "金融資産" : `${nm.selected}${nm.same ? "（基準）" : "（選んだプラン）"}`}
      </span>,
      base,
      <span class="lg short" key="short">
        <i />
        不足（▲）
      </span>,
    ];
  }
  return (
    <div class="legend main-legend">
      {items}
      {explain !== null ? (
        <span class="hint">説明モード: 「次へ」で1段ずつ足します</span>
      ) : side ? (
        <span class="hint">2つのグラフは縦の目盛りをそろえています</span>
      ) : null}
    </div>
  );
}

/** 説明モードの帯（段の印・戻る・次へ）。キーの ← → と Esc でも動く */
export function ExplainBar({ model, step, onStep, onClose }: { model: ExplainModel; step: number; onStep: (i: number) => void; onClose: () => void }) {
  const last = model.steps.length - 1;
  const cur = Math.max(0, Math.min(last, step));
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA") return;
      if (e.key === "ArrowRight") {
        e.preventDefault();
        if (cur < last) onStep(cur + 1);
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        if (cur > 0) onStep(cur - 1);
      } else if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [cur, last, onStep, onClose]);
  // 段を変えたとき、グラフが画面の外にあるときだけ、見える所まで最小の量でスクロールする（画面の中なら動かさない）
  const bar = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const chart = bar.current?.closest("[data-result-card]")?.querySelector<HTMLElement>("[data-main-chart]");
    if (chart === null || chart === undefined) return;
    const r = chart.getBoundingClientRect();
    if (r.bottom <= 0 || r.top >= window.innerHeight) chart.scrollIntoView?.({ block: "nearest" });
  }, [cur]);
  return (
    <div class="explain-bar" ref={bar} data-explain>
      <ol class="ex-steps" aria-label="説明の段">
        {model.steps.map((x, i) => (
          <li key={x.key} class={i === cur ? "now" : i < cur ? "done" : ""} aria-current={i === cur ? "step" : undefined}>
            <button type="button" onClick={() => onStep(i)}>
              {i + 1} {x.title}
            </button>
          </li>
        ))}
      </ol>
      <span class="ex-gap" />
      <span class="ex-note">1段ずつ足して見せます（顧客と一緒に読む用）</span>
      <span class="ex-pos">
        {cur + 1} / {model.steps.length}
      </span>
      <button type="button" class="btn" disabled={cur === 0} onClick={() => onStep(cur - 1)} data-explain-prev>
        ← 戻る
      </button>
      {/* 「次へ」と「終わる」は同じ幅（見えない方の文字で幅を取る）。最後の段でも「戻る」の位置が動かない */}
      <span class="ex-go">
        {cur < last ? (
          <button type="button" class="btn primary" onClick={() => onStep(cur + 1)} data-explain-next>
            次へ →
          </button>
        ) : (
          <button type="button" class="btn primary" onClick={onClose} data-explain-close>
            終わる
          </button>
        )}
        <span class="btn primary ex-sizer" aria-hidden="true">
          {cur < last ? "終わる" : "次へ →"}
        </span>
      </span>
    </div>
  );
}
