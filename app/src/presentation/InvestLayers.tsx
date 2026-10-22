// 提示層の部品: 資産の推移のグラフに重ねる資産運用のもの（0026）。口座の内訳の積み上げの面・相場が下がった場合の細い線・
// 運用の期間の帯（積み立てる・据え置く・取り崩す。帯の切れ目はドラッグか ← → キーで動かせる。基準のプラン・現状のときは動かせず、つまみに理由の札を出す）
import { useEffect, useId, useRef, useState } from "preact/hooks";
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
  /** 動かせないときの理由（つまみに乗せる・フォーカスする・押すと札で出す。動かせるときは省略） */
  lock?: string;
}

type Which = "stop" | "wd";

/** 動かせないつまみの理由の札の状態（出ていなければ null。pinned はタッチで押して出したもの） */
export type BandTip = { which: Which; pinned: boolean } | null;

/** 札の出し入れ: マウス（ペン）は乗せている間・キーボードはフォーカスしている間だけ出す。タッチは押すと出し、もう一度押す・外を押す・Esc で閉じる */
export function nextBandTip(t: BandTip, e: { type: "enter" | "leave" | "focus" | "blur" | "tap"; which: Which } | { type: "close" }): BandTip {
  switch (e.type) {
    case "enter":
    case "focus":
      return t?.pinned === true ? t : { which: e.which, pinned: false };
    case "leave":
    case "blur":
      return t === null || t.pinned ? t : null;
    case "tap":
      return t?.pinned === true && t.which === e.which ? null : { which: e.which, pinned: true };
    case "close":
      return null;
  }
}

export interface BandHandleProps {
  which: Which;
  /** つまみの位置（帯の左からの px） */
  x: number;
  age: number;
  /** 動かせる範囲に収める */
  clamp: (which: Which, age: number) => number;
  /** 画面の x の位置の年齢（グラフの外なら null） */
  ageAtX: (clientX: number) => number | null;
  onBand?: BandProps["onBand"];
  /** 動かせないときの理由の札の id（読み上げ用に aria-describedby で結ぶ） */
  tipId?: string;
  /** 動かせないときの札の出し入れ */
  onTip: (e: { type: "enter" | "leave" | "focus" | "blur" | "tap"; which: Which }) => void;
}

/** 帯の切れ目のつまみ。動かせないときは見えるまま薄くし（aria-disabled。disabled にすると乗せる・フォーカスが届かないことがある）、押しても動かさずに理由の札を出す */
export function bandHandle({ which, x, age, clamp, ageAtX, onBand, tipId, onTip }: BandHandleProps): preact.JSX.Element {
  const locked = onBand === undefined;
  const what = which === "stop" ? `積立をやめる年齢 ${age}歳` : `取り崩しを始める年齢 ${age}歳`;
  return (
    <button
      type="button"
      key={which}
      class={`pb-h${locked ? " locked" : ""}`}
      style={{ left: `${x}px` }}
      aria-label={locked ? `${what}（今は動かせません）` : `${what}（← → で1歳ずつ動かす）`}
      {...(locked ? { "aria-disabled": "true" } : {})}
      {...(locked && tipId !== undefined ? { "aria-describedby": tipId } : {})}
      data-band-handle={which}
      onPointerEnter={(e) => {
        if (locked && e.pointerType !== "touch") onTip({ type: "enter", which });
      }}
      onPointerLeave={(e) => {
        if (locked && e.pointerType !== "touch") onTip({ type: "leave", which });
      }}
      onFocus={() => {
        if (locked) onTip({ type: "focus", which });
      }}
      onBlur={() => {
        if (locked) onTip({ type: "blur", which });
      }}
      onPointerDown={(e) => {
        if (onBand === undefined) {
          if (e.pointerType === "touch") onTip({ type: "tap", which });
          return;
        }
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
}

/** 運用の期間の帯（グラフの上。x はグラフの年の位置にそろえる） */
export function PeriodBand({ band, s, n, left, width, ages, onBand, lock }: BandProps) {
  const ref = useRef<HTMLDivElement>(null);
  const tipId = `pb-tip-${useId().replace(/[^A-Za-z0-9_-]/g, "")}`;
  const [tip, setTip] = useState<BandTip>(null);
  const pinned = tip?.pinned === true;
  // タッチで押して出した札は、外を押す・Esc で閉じる
  useEffect(() => {
    if (!pinned) return;
    const close = (e: Event) => {
      if (e instanceof KeyboardEvent ? e.key === "Escape" : !(ref.current?.contains(e.target as Node) ?? false)) setTip(null);
    };
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", close);
    };
  }, [pinned]);
  // 動かせるようになったら（別のプランを選んだら）札を閉じる
  useEffect(() => {
    if (onBand !== undefined) setTip(null);
  }, [onBand]);
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
  const clamp = (which: Which, a: number) => {
    const lo = which === "stop" ? band.minAge : Math.max(band.minAge, band.stopAge);
    const hi = which === "stop" ? (band.wdAge ?? band.maxAge) : band.maxAge;
    return Math.max(lo, Math.min(hi, a));
  };
  const showTip = onBand === undefined && lock !== undefined;
  const common = { clamp, ageAtX, ...(onBand !== undefined ? { onBand } : {}), ...(showTip ? { tipId } : {}), onTip: (e: Parameters<BandHandleProps["onTip"]>[0]) => setTip((t) => nextBandTip(t, e)) };
  // 札はつまみの下に出す。つまみが帯の右寄りなら札の右端を、左寄りなら左端をつまみにそろえる
  const tipX = tip?.which === "wd" ? xw : xa;
  const tipShift = tipX > width * 0.6 ? "translateX(calc(-100% + 18px))" : tipX < width * 0.4 ? "translateX(-18px)" : "translateX(-50%)";
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
      {band.accumEnd > 0 ? bandHandle({ which: "stop", x: xa, age: band.stopAge, ...common }) : null}
      {band.wdStart !== null && band.wdAge !== null ? bandHandle({ which: "wd", x: xw, age: band.wdAge, ...common }) : null}
      {showTip ? (
        <div id={tipId} class={`year-tip pb-tip${pinned ? " pinned" : ""}`} role="tooltip" hidden={tip === null} style={{ left: `${tipX}px`, transform: tipShift }} data-band-tip>
          {lock}
        </div>
      ) : null}
    </div>
  );
}
