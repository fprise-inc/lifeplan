// 提示層の部品: 資産の推移のグラフに重ねる資産運用のもの（0026）。口座の内訳の積み上げの面・相場が下がった場合の細い線・
// 運用の期間の帯（積み立てる・据え置く・取り崩す。帯の切れ目はドラッグか ← → キーで動かせる）
import { useRef } from "preact/hooks";
import type { Scale } from "./chart.ts";
import type { InvestBandModel, StackSeries, StressLineModel, Yen } from "./model.ts";

/** 口座の内訳の積み上げの面（下から。マイナスは積まない） */
export function stackAreas(list: readonly StackSeries[], s: Scale, n: number): preact.JSX.Element[] {
  const acc = new Array<number>(n).fill(0);
  const out: preact.JSX.Element[] = [];
  for (const sr of list) {
    const lo = acc.slice();
    for (let i = 0; i < n; i++) acc[i] = (acc[i] ?? 0) + Math.max(0, sr.values[i] ?? 0);
    const top = acc.map((v, i) => `${s.x(i).toFixed(1)} ${s.y(v).toFixed(1)}`);
    const bottom = lo.map((v, i) => `${s.x(i).toFixed(1)} ${s.y(v).toFixed(1)}`).reverse();
    out.push(<path key={`ia-${sr.key}`} d={`M${top.join(" L")} L${bottom.join(" L")} Z`} class={`inv-area inv-${sr.key}`} data-inv-area={sr.key} />);
  }
  return out;
}

/** 相場が下がった場合の線と「○歳まで持つ」の札（札は線の終わり（尽きる手前）に置き、重なるときは縦にずらす） */
export function stressPaths(lines: readonly StressLineModel[], hidden: readonly string[], s: Scale, n: number, fs: number, top: number): preact.JSX.Element[] {
  const out: preact.JSX.Element[] = [];
  const labels: { key: string; x: number; y: number; text: string }[] = [];
  for (const l of lines) {
    if (l.values === null || hidden.includes(l.key)) continue;
    const v: Yen[] = l.values;
    const end = v.findIndex((x) => x < 0);
    const last = end < 0 ? n - 1 : Math.max(0, end - 1);
    const pts = v.slice(0, end < 0 ? n : end + 1).map((x, i) => `${i === 0 ? "M" : "L"}${s.x(i).toFixed(1)} ${s.y(Math.max(0, x)).toFixed(1)}`);
    out.push(<path key={`sl-${l.key}`} d={pts.join(" ")} class={`stress-line s-${l.key}`} data-stress-line={l.key} />);
    labels.push({ key: l.key, x: s.x(last), y: s.y(Math.max(0, v[last] ?? 0)), text: l.lasts });
  }
  labels.sort((a, b) => a.y - b.y);
  let prev = -Infinity;
  for (const lb of labels) {
    const y = Math.max(lb.y - 8 * fs, prev + 15 * fs, top + 12 * fs);
    prev = y;
    out.push(
      <text key={`st-${lb.key}`} x={lb.x - 4 * fs} y={y} text-anchor="end" class={`stress-txt s-${lb.key}`}>
        {lb.text}
      </text>,
    );
  }
  return out;
}

export interface BandProps {
  band: InvestBandModel;
  s: Scale;
  /** 年の数 */
  n: number;
  /** グラフの左右の余白（SVG と同じ） */
  left: number;
  width: number;
  /** x 軸の年の本人の年齢 */
  ages: readonly (number | null)[];
  /** 帯の切れ目を動かした（phase: 動かしている間は slide、離したら release）。動かせないときは undefined */
  onBand?: (which: "stop" | "wd", age: number, phase: "slide" | "release") => void;
}

/** 運用の期間の帯（グラフの上。x はグラフの年の位置にそろえる） */
export function PeriodBand({ band, s, n, left, width, ages, onBand }: BandProps) {
  const ref = useRef<HTMLDivElement>(null);
  const edge = (i: number) => (i <= 0 ? s.x(0) - s.band / 2 : i >= n ? s.x(n - 1) + s.band / 2 : s.x(i) - s.band / 2);
  const x0 = edge(0);
  const xEnd = edge(n);
  const xa = edge(band.accumEnd);
  const xw = band.wdStart === null ? xEnd : edge(band.wdStart);
  const ageAtX = (clientX: number): number | null => {
    const el = ref.current;
    if (el === null) return null;
    const r = el.getBoundingClientRect();
    const x = (clientX - r.left) * (r.width > 0 ? width / r.width : 1);
    let best = 0;
    for (let i = 0; i < n; i++) if (Math.abs(edge(i) - x) < Math.abs(edge(best) - x)) best = i;
    return ages[best] ?? null;
  };
  const clamp = (which: "stop" | "wd", a: number) => {
    const lo = which === "stop" ? band.minAge : Math.max(band.minAge, band.stopAge);
    const hi = which === "stop" ? (band.wdAge ?? band.maxAge) : band.maxAge;
    return Math.max(lo, Math.min(hi, a));
  };
  const handle = (which: "stop" | "wd", x: number, age: number) => (
    <button
      type="button"
      class="pb-h"
      style={{ left: `${x}px` }}
      aria-label={which === "stop" ? `積立をやめる年齢 ${age}歳（← → で1歳ずつ動かす）` : `取り崩しを始める年齢 ${age}歳（← → で1歳ずつ動かす）`}
      disabled={onBand === undefined}
      data-band-handle={which}
      onPointerDown={(e) => {
        if (onBand === undefined) return;
        const el = e.currentTarget as HTMLElement;
        el.setPointerCapture?.(e.pointerId);
        el.classList.add("drag");
        let last = age;
        const move = (ev: PointerEvent) => {
          const a = ageAtX(ev.clientX);
          if (a === null) return;
          const v = clamp(which, a);
          if (v !== last) {
            last = v;
            onBand(which, v, "slide");
          }
        };
        const up = () => {
          el.classList.remove("drag");
          el.removeEventListener("pointermove", move);
          el.removeEventListener("pointerup", up);
          el.removeEventListener("pointercancel", up);
          onBand(which, last, "release");
        };
        el.addEventListener("pointermove", move);
        el.addEventListener("pointerup", up);
        el.addEventListener("pointercancel", up);
      }}
      onKeyDown={(e) => {
        if (onBand === undefined) return;
        const d = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
        if (d === 0) return;
        e.preventDefault();
        e.stopPropagation();
        onBand(which, clamp(which, age + d), "release");
      }}
    >
      <i aria-hidden="true" />
    </button>
  );
  const seg = (cls: string, a: number, b: number, body: preact.ComponentChildren) => (b - a > 0.5 ? (
    <div class={`pb-seg ${cls}${b - a < 140 ? " narrow" : ""}${b - a < 56 ? " tiny" : ""}`} style={{ left: `${a}px`, width: `${b - a}px` }}>
      {body}
    </div>
  ) : null);
  return (
    <div class="pband" ref={ref} style={{ width: `${width}px`, "--pl": `${left}px` }} data-period-band>
      {seg(
        "acc",
        x0,
        xa,
        <>
          <div class="pb-t">
            ↑ {band.accumText}
            {band.estimated ? <span class="pb-est">推定あり</span> : null}
          </div>
          <div class="pb-steps">
            {band.steps.map((st, i) => {
              const a = Math.max(x0, edge(st.at));
              const b = Math.min(xa, edge(band.steps[i + 1]?.at ?? band.accumEnd));
              return b - a > 2 ? (
                <span key={i} class="pb-step" style={{ left: `${a - x0}px`, width: `${b - a}px` }}>
                  {st.label}
                </span>
              ) : null;
            })}
          </div>
        </>,
      )}
      {seg(
        "hold",
        xa,
        xw,
        <>
          <div class="pb-t">→ {band.holdText}</div>
          <div class="pb-sub">{band.holdSub}</div>
        </>,
      )}
      {band.wdStart !== null
        ? seg(
            "wd",
            xw,
            xEnd,
            <>
              <div class="pb-t">↓ {band.wdText}</div>
              <div class="pb-sub">{band.wdSub}</div>
            </>,
          )
        : null}
      {band.accumEnd > 0 ? handle("stop", xa, band.stopAge) : null}
      {band.wdStart !== null && band.wdAge !== null ? handle("wd", xw, band.wdAge) : null}
    </div>
  );
}
