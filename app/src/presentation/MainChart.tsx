// 主画面のグラフ（提示層の部品）: 幅いっぱい・上下を大きく。重ねるのは基準の案（灰の点線）と選んだ案（藍の実線）の2本だけ。
// 切り替え: 資産の推移／収支の推移（選んだ案の積み上げ＋年間収支の線2本）／資産と負債の推移（選んだ案の積み上げ＋純資産の線2本）、
// 説明モード（収入 → 年金 → 支出 → 教育 → 住宅 → 資産の推移を1段ずつ足す）。
// 数字が変わると、線と面は前の形から新しい形へ補間して動く（tween.ts）。受け取るのは提示用の値だけ（0016 の2）。
// 年の選び方（yearPick.ts）: カーソルを合わせた年に、線の上の○（選んだ案＝藍の塗り、基準の案＝灰の白抜き）と小さな表示を出す。クリックで固定
import { useEffect, useLayoutEffect, useRef, useState } from "preact/hooks";
import { areaAbove, areaBelow, linePath, scale, type Frame, type Scale } from "./chart.ts";
import { group, man } from "./format.ts";
import type { AgeMark, BalanceChartModel, ChartModel, EventChip, ExplainModel, FlowChartModel, SeriesNames, StackSeries, Yen } from "./model.ts";
import { Pattern, Swatch } from "./StackChart.tsx";
import { useTween, type Series } from "./tween.ts";
import { estimateWidth, indexAt, placeTip, shownYear, stepYear, togglePin } from "./yearPick.ts";

export type ChartMode = "assets" | "flows" | "balance";
export const CHART_MODES: readonly { id: ChartMode; label: string }[] = [
  { id: "assets", label: "資産の推移" },
  { id: "flows", label: "収支の推移" },
  { id: "balance", label: "資産と負債の推移" },
];

/** グラフに渡す値（PresentationModel の一部） */
export interface MainChartModel {
  chart: ChartModel;
  flows: FlowChartModel;
  balance: BalanceChartModel;
  baseLines: { net: Yen[]; netWorth: Yen[] };
  events: EventChip[];
  names: SeriesNames;
  who: string;
  selectedYear: number;
}

/** グラフの高さ: 画面の高さに合わせる（ノートPCで約520px、大きい画面で最大700px。文字を大きくすると上下の帯の分を広く見る） */
export function chartHeight(innerHeight: number, fontPx: number): number {
  const h = innerHeight - 250 * (fontPx / 16);
  return Math.round(Math.max(420, Math.min(700, h)));
}

// ---- 補間する数字の束（系列の名前 → 年ごとの値）----

function flatten(m: MainChartModel, ex: ExplainModel | null): Series {
  const out: Record<string, readonly number[]> = { "a.sel": m.chart.proposal, "a.base": m.chart.current, "f.net": m.flows.net, "f.bnet": m.baseLines.net, "b.short": m.balance.shortfall, "b.nw": m.balance.netWorth, "b.bnw": m.baseLines.netWorth };
  for (const s of m.flows.income) out[`fi.${s.key}`] = s.values;
  for (const s of m.flows.expense) out[`fe.${s.key}`] = s.values;
  for (const s of m.balance.assets) out[`ba.${s.key}`] = s.values;
  for (const s of m.balance.debts) out[`bd.${s.key}`] = s.values;
  if (ex !== null) for (const k of ["work", "pension", "living", "education", "housing", "financial"] as const) out[`x.${k}`] = ex[k];
  return out;
}

const pick = (t: Series, key: string, n: number): number[] => (t[key] as number[] | undefined) ?? new Array<number>(n).fill(0);
const withValues = (list: StackSeries[], t: Series, prefix: string, n: number): StackSeries[] => list.map((s) => ({ ...s, values: pick(t, `${prefix}.${s.key}`, n) }));

// ---- 描く部品 ----

function frameOf(w: number, h: number, fs: number, wideRight: boolean): Frame {
  return { width: w, height: h, left: 64 * fs, right: (wideRight ? 92 : 20) * fs, top: 26 * fs, bottom: 60 * fs };
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

export interface MainChartProps {
  model: MainChartModel;
  mode: ChartMode;
  explain: { model: ExplainModel; step: number } | null;
  ageMark: AgeMark | null;
  /** 固定した年（固定していなければ null）。表の同じ年が光る */
  pinnedYear: number | null;
  /** 年を固定する・外す（null） */
  onSelectYear: (year: number | null) => void;
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
}

export function MainChart({ model, mode, explain, ageMark, pinnedYear, onSelectYear }: MainChartProps) {
  const box = useRef<HTMLDivElement>(null);
  const svg = useRef<SVGSVGElement>(null);
  const tip = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<number | null>(null);
  const [tipSize, setTipSize] = useState<{ w: number; h: number } | null>(null);
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
  const same = model.names.same;
  const years = model.chart.years;
  const ages = model.chart.ages;
  const showMark = ageMark !== null && mode === "assets" && explain === null;
  const f = frameOf(size.w, size.h, size.fs, showMark);
  const fs = size.fs;
  const pinned = pinnedYear !== null && years.includes(pinnedYear) ? pinnedYear : null;
  const shown = explain === null ? shownYear(pinned, hover !== null && years.includes(hover) ? hover : null) : null;
  const selIdx = shown === null ? -1 : years.indexOf(shown);

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
  const aSel = pick(t, "a.sel", n);
  const aBase = pick(t, "a.base", n);
  let s: Scale;
  let body: preact.JSX.Element[] = [];
  let zeroLabels: [string, string] | null = null;
  let mark: YearMark | null = null;
  const at = (arr: readonly number[]) => `${man(arr[selIdx] ?? 0)}万円`;
  const sumAt = (list: StackSeries[]) => list.reduce((a, x) => a + Math.max(0, x.values[selIdx] ?? 0), 0);
  const keys: string[] = [];

  if (explain !== null && ex !== null) {
    const step = explain.step;
    const on = (k: string) => ex.steps.findIndex((x) => x.key === k) <= step;
    const now = (k: string) => ex.steps.findIndex((x) => x.key === k) === step;
    const work = pick(t, "x.work", n);
    const pension = pick(t, "x.pension", n);
    const living = pick(t, "x.living", n);
    const education = pick(t, "x.education", n);
    const housing = pick(t, "x.housing", n);
    const fin = pick(t, "x.financial", n);
    const up: StackSeries[] = [];
    if (on("income")) up.push({ key: "work", label: "給与・退職金などの収入", values: work });
    if (on("pension")) up.push({ key: "pension", label: "年金", values: pension });
    const down: StackSeries[] = [];
    if (on("expense")) down.push({ key: "living", label: "生活費・税など", values: living });
    if (on("education")) down.push({ key: "education", label: "教育費", values: education });
    if (on("housing")) down.push({ key: "housing", label: "住居費", values: housing });
    const showAssets = on("assets");
    const upTot = years.map((_, i) => up.reduce((a, x) => a + Math.max(0, x.values[i] ?? 0), 0));
    const downTot = years.map((_, i) => -down.reduce((a, x) => a + Math.max(0, x.values[i] ?? 0), 0));
    s = scale([upTot, downTot, showAssets ? fin : []], n, f);
    keys.push(...up.map((x) => x.key), ...down.map((x) => x.key));
    const stepKey: Record<string, string> = { work: "income", pension: "pension", living: "expense", education: "education", housing: "housing" };
    body = bars(up, down, s, n, undefined, (k) => (now(stepKey[k] ?? "") ? { cls: "ex-new", op: 1 } : { cls: "", op: 0.55 }));
    if (showAssets)
      body.push(
        <g key="fin" class={now("assets") ? "ex-new" : ""}>
          <path d={areaBelow(fin, s)} class="area-short" />
          <path d={linePath(fin, s)} class="line-prop" />
        </g>,
      );
    zeroLabels = ["↑ 入るお金", "↓ 出るお金"];
  } else if (mode === "flows") {
    const inc = withValues(model.flows.income, t, "fi", n);
    const exp = withValues(model.flows.expense, t, "fe", n);
    const net = pick(t, "f.net", n);
    const bnet = pick(t, "f.bnet", n);
    const upTot = years.map((_, i) => inc.reduce((a, x) => a + Math.max(0, x.values[i] ?? 0), 0));
    const downTot = years.map((_, i) => -exp.reduce((a, x) => a + Math.max(0, x.values[i] ?? 0), 0));
    s = scale([upTot, downTot, net, same ? [] : bnet], n, f);
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
    if (!same) body.push(<path key="bnet" d={linePath(bnet, s)} class="net-base" />);
    body.push(<path key="net" d={linePath(net, s)} class="net-sel" />);
    zeroLabels = ["↑ 収入", "↓ 支出"];
    if (selIdx >= 0)
      mark = {
        sel: s.y(net[selIdx] ?? 0),
        base: same ? null : s.y(bnet[selIdx] ?? 0),
        lead: "年間収支",
        selText: at(model.flows.net),
        baseText: same ? null : at(model.baseLines.net),
        extra: `収入 ${man(sumAt(model.flows.income))}万円・支出 ${man(sumAt(model.flows.expense))}万円（${model.names.selected}）`,
      };
  } else if (mode === "balance") {
    const as = withValues(model.balance.assets, t, "ba", n).filter((x) => model.balance.assets.find((y) => y.key === x.key)?.values.some((v) => v > 0));
    const ds = withValues(model.balance.debts, t, "bd", n).filter((x) => model.balance.debts.find((y) => y.key === x.key)?.values.some((v) => v > 0));
    const short = pick(t, "b.short", n).map((v) => -v);
    const nw = pick(t, "b.nw", n);
    const bnw = pick(t, "b.bnw", n);
    const upTot = years.map((_, i) => as.reduce((a, x) => a + Math.max(0, x.values[i] ?? 0), 0));
    const downTot = years.map((_, i) => -(ds.reduce((a, x) => a + Math.max(0, x.values[i] ?? 0), 0) + Math.max(0, short[i] ?? 0)));
    s = scale([upTot, downTot, nw, same ? [] : bnw], n, f);
    keys.push(...as.map((x) => x.key), ...ds.map((x) => x.key));
    body = bars(as, ds, s, n, short);
    if (!same) body.push(<path key="bnw" d={linePath(bnw, s)} class="net-base" />);
    body.push(<path key="nw" d={linePath(nw, s)} class="net-sel" />);
    zeroLabels = ["↑ 資産", "↓ 負債"];
    if (selIdx >= 0)
      mark = {
        sel: s.y(nw[selIdx] ?? 0),
        base: same ? null : s.y(bnw[selIdx] ?? 0),
        lead: "純資産",
        selText: at(model.balance.netWorth),
        baseText: same ? null : at(model.baseLines.netWorth),
        extra: `資産 ${man(sumAt(model.balance.assets))}万円・負債 ${man(sumAt(model.balance.debts) + Math.max(0, -(model.balance.shortfall[selIdx] ?? 0)))}万円（${model.names.selected}）`,
      };
  } else {
    s = scale(same ? [aSel] : [aSel, aBase], n, f);
    if (!same) body.push(<path key="bb" d={areaBelow(aBase, s)} class="area-short" opacity={0.75} />);
    body.push(<path key="sb" d={areaBelow(aSel, s)} class="area-short" />);
    body.push(<path key="sa" d={areaAbove(aSel, s)} class="area-prop" />);
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
    if (!same) body.push(<path key="lb" d={linePath(aBase, s)} class="line-base" />);
    body.push(<path key="ls" d={linePath(aSel, s)} class="line-prop" />);
    // 資産が尽きる年
    for (const d of model.chart.depletions) {
      const i = years.indexOf(d.year);
      if (i < 0 || (same && d.series === "current")) continue;
      const x = s.x(i);
      const y0 = s.y(0);
      const dy = d.series === "current" && !same ? 18 * fs : 0;
      body.push(
        <g key={`dep-${d.series}`}>
          <line x1={x} x2={x} y1={y0} y2={f.height - f.bottom} class="dep-line" />
          <path d={`M${x} ${y0 - 11} l8 13 h-16 z`} class={`dep-tri${d.series === "current" ? " base" : ""}`} />
          <text x={x + 10} y={y0 - 8 - dy} class="dep-txt">
            {d.label}
          </text>
        </g>,
      );
    }
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
        sel: s.y(aSel[selIdx] ?? 0),
        base: same ? null : s.y(aBase[selIdx] ?? 0),
        lead: "金融資産",
        selText: at(model.chart.proposal),
        baseText: same ? null : at(model.chart.current),
        extra: null,
      };
  }

  // ---- 年のイベント（x 軸の上の小さな丸）----
  const evCount = new Map<number, number>();
  for (const e of model.events) evCount.set(e.year, (evCount.get(e.year) ?? 0) + 1);
  const evSeen = new Map<number, number>();
  const evs = model.events.map((e, j) => {
    const i = years.indexOf(e.year);
    if (i < 0) return null;
    const k = evSeen.get(e.year) ?? 0;
    evSeen.set(e.year, k + 1);
    const cx = s.x(i) + (k - ((evCount.get(e.year) ?? 1) - 1) / 2) * 17 * fs;
    const cy = f.height - f.bottom + 13 * fs;
    return (
      <g key={j} class={`ev${e.short ? " short" : ""}`} transform={`translate(${cx.toFixed(1)},${cy.toFixed(1)})`}>
        <circle r={8.5 * fs} />
        <text text-anchor="middle" y={3.8 * fs}>
          {e.icon}
        </text>
        <title>{`${e.year}年 ${e.text}`}</title>
      </g>
    );
  });

  // ---- 年の印（線の上の○・細い縦の補助線）と小さな表示 ----
  const age = selIdx >= 0 ? ages[selIdx] : undefined;
  const head = selIdx >= 0 ? `${years[selIdx]}年${age != null ? `（${model.who}${age}歳）` : ""}` : "";
  const valueLine = mark !== null ? `${mark.lead} ● ${model.names.selected} ${mark.selText}${mark.baseText !== null ? `／○ ${model.names.base} ${mark.baseText}` : ""}` : "";
  const tipLines = mark !== null ? [`${head}${pinned !== null ? " 固定中" : ""}`, valueLine, ...(mark.extra !== null ? [mark.extra] : [])] : [];
  const tw = tipSize?.w ?? estimateWidth(tipLines, 13 * fs);
  const th = tipSize?.h ?? (tipLines.length * 19 + 12) * fs;
  const mx = selIdx >= 0 ? s.x(selIdx) : 0;
  const place = mark !== null ? placeTip(mx, Math.min(mark.sel, mark.base ?? mark.sel), Math.max(mark.sel, mark.base ?? mark.sel), tw, th, f.width, f.height) : null;
  // 表示の実際の大きさを測り直す（文字の大きさ・中身が変わったとき）
  useLayoutEffect(() => {
    const el = tip.current;
    if (el === null) return;
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    if (w > 0 && h > 0 && (tipSize === null || Math.abs(tipSize.w - w) > 0.5 || Math.abs(tipSize.h - h) > 0.5)) setTipSize({ w, h });
  });

  return (
    <div
      class="chart main-chart"
      ref={box}
      tabIndex={0}
      onKeyDown={onKey}
      role="group"
      aria-label="グラフ。カーソルを合わせるとその年の数字が出ます。クリックか左右の矢印キーで年を固定し、Esc で外します"
      data-main-chart={explain !== null ? "explain" : mode}
      data-shown-year={shown ?? undefined}
      data-pinned-year={pinned ?? undefined}
    >
      <svg ref={svg} viewBox={`0 0 ${f.width} ${f.height}`} width={f.width} height={f.height} role="img" aria-label={explain !== null ? "説明モードのグラフ" : (CHART_MODES.find((m) => m.id === mode)?.label ?? "グラフ")}>
        <defs>
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
        {mark !== null ? <line x1={mx} x2={mx} y1={f.top - 4} y2={f.height - f.bottom} class={`hv-guide${pinned !== null ? " pinned" : ""}`} /> : null}
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
        {evs}
        {years.map((y, i) =>
          y % 5 === 0 ? (
            <g key={y}>
              <text x={s.x(i)} y={f.height - f.bottom + 36 * fs} class="axis-label" text-anchor="middle">
                {y}
              </text>
              {ages[i] != null ? (
                <text x={s.x(i)} y={f.height - f.bottom + 52 * fs} class="axis-label sub" text-anchor="middle">
                  {ages[i]}歳
                </text>
              ) : null}
            </g>
          ) : null,
        )}
        {mark !== null ? (
          <g class="hv-dots" data-year-mark>
            {mark.base !== null ? <circle cx={mx} cy={mark.base} r={6 * fs} class="hv-dot base" /> : null}
            <circle cx={mx} cy={mark.sel} r={6.5 * fs} class="hv-dot sel" />
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
            onPointerMove={(e) => {
              const y = yearAt(e);
              if (y !== hover) setHover(y);
            }}
            onPointerLeave={() => setHover(null)}
            onClick={(e) => {
              const y = yearAt(e);
              if (y === null) return;
              setHover(y);
              onSelectYear(togglePin(pinned, y));
            }}
          />
        ) : null}
      </svg>
      {mark !== null && place !== null ? (
        <div
          ref={tip}
          class={`sel-lbl year-tip${pinned !== null ? " pinned" : ""}`}
          style={{ left: `${((place.left / f.width) * 100).toFixed(3)}%`, top: `${((place.top / f.height) * 100).toFixed(3)}%` }}
          role={pinned !== null ? "status" : undefined}
          data-year-tip={place.side}
        >
          <div class="yt-h">
            {head}
            {pinned !== null ? <span class="yt-pin">固定中</span> : null}
          </div>
          <div class="yt-v">
            {mark.lead !== "金融資産" ? <span class="yt-lead">{mark.lead}</span> : null}
            <span class="yt-s">
              <i class="yt-dot sel" aria-hidden="true" />
              {model.names.selected} <b class={(mark.selText.startsWith("▲") ? "neg" : "")}>{mark.selText}</b>
            </span>
            {mark.baseText !== null ? (
              <span class="yt-b">
                ／<i class="yt-dot base" aria-hidden="true" />
                {model.names.base} <b class={(mark.baseText.startsWith("▲") ? "neg" : "")}>{mark.baseText}</b>
              </span>
            ) : null}
          </div>
          {mark.extra !== null ? <div class="yt-x">{mark.extra}</div> : null}
        </div>
      ) : null}
    </div>
  );
}

/** グラフの凡例（モードごと）。右端に操作の手がかり */
export function MainLegend({ model, mode, explain }: { model: MainChartModel; mode: ChartMode; explain: { model: ExplainModel; step: number } | null }) {
  const nm = model.names;
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
    items = [
      on("income") ? sw("work", "給与・退職金など") : null,
      on("pension") ? sw("pension", "年金") : null,
      on("expense") ? sw("living", "生活費・税など") : null,
      on("education") ? sw("education", "教育") : null,
      on("housing") ? sw("housing", "住宅") : null,
      on("assets") ? (
        <span class="lg" key="fin">
          <i />
          金融資産
        </span>
      ) : null,
    ];
  } else if (mode === "flows") {
    items = [
      ...model.flows.income.map((x) => sw(x.key, x.label)),
      ...model.flows.expense.map((x) => sw(x.key, x.label)),
      <span class="lg net" key="net">
        <i />
        年間収支 {nm.selected}
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
  } else if (mode === "balance") {
    items = [
      ...model.balance.assets.filter((x) => x.values.some((v) => v > 0)).map((x) => sw(x.key, x.label)),
      ...model.balance.debts.filter((x) => x.values.some((v) => v > 0)).map((x) => sw(x.key, x.label)),
      model.balance.shortfall.some((v) => v < 0) ? (
        <span class="lg short" key="short">
          <i />
          預金の不足（▲）
        </span>
      ) : null,
      <span class="lg net" key="nw">
        <i />
        純資産 {nm.selected}
      </span>,
      nm.same ? null : (
        <span class="lg base" key="bnw">
          <i />
          純資産 {nm.base}（基準）
        </span>
      ),
    ];
  } else {
    items = [
      <span class="lg" key="sel">
        <i />
        {nm.selected}
        {nm.same ? "（基準）" : "（選んだ案）"}
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
      <span class="hint">{explain !== null ? "説明モード: 「次へ」で1段ずつ足します" : "グラフに合わせるとその年の数字。クリックで固定（下の表の同じ年が光る。もう一度クリックか Esc で外す）"}</span>
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
  return (
    <div class="explain-bar" data-explain>
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
      {cur < last ? (
        <button type="button" class="btn primary" onClick={() => onStep(cur + 1)} data-explain-next>
          次へ →
        </button>
      ) : (
        <button type="button" class="btn primary" onClick={onClose} data-explain-close>
          終わる
        </button>
      )}
    </div>
  );
}
