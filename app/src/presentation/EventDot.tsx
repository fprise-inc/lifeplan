// 年のできごとの丸（提示層の共通の部品）: グラフの下の丸（MainChart.tsx）と、生涯キャッシュフロー表の「ライフイベント」の行（MainView.tsx）で同じ見た目・同じ動きにする。
// - 丸は半径 EVENT_R（文字の大きさに比例）。漢字は丸のちょうど真ん中（SVG は dominant-baseline: central、HTML は中央寄せの箱）
// - カーソルを合わせる・キーボードでフォーカスする・タップすると、「2031年 住宅購入」のような説明を、年の表示（.year-tip）と同じ見た目で出す
// - 読み上げは aria-label（<title> は使わない。ブラウザの小さな表示と二重になるため）
import type { JSX, Ref } from "preact";
import { useState } from "preact/hooks";
import type { EventChip } from "./model.ts";

/** 年のイベントの丸の半径（文字の大きさ fs に比例。16px のとき 12.5px） */
export const EVENT_R = 12.5;

/** 読み上げ・説明の文（例: 「2031年 住宅購入」） */
export const eventLabel = (e: EventChip): string => `${e.year}年 ${e.text}`;

/** 丸の上に出す説明の中身（グラフと表で同じ） */
export function EventTipBody({ chip }: { chip: EventChip }) {
  return (
    <div class="yt-h">
      <span class="ev-ic" aria-hidden="true">
        {chip.icon}
      </span>
      {chip.year}年 <span class="ev-t">{chip.text}</span>
    </div>
  );
}

/** 説明の箱（年の表示 .year-tip と同じ見た目）。置き場所は使う側が style で渡す */
export function EventTip({ chip, style, tipRef, fixed = false }: { chip: EventChip; style: JSX.CSSProperties; tipRef?: Ref<HTMLDivElement>; fixed?: boolean }) {
  return (
    <div ref={tipRef} class={`year-tip ev-tip${chip.short ? " short" : ""}${fixed ? " fixed" : ""}`} style={style} role="tooltip" data-ev-tip={chip.year}>
      <EventTipBody chip={chip} />
    </div>
  );
}

/** どの丸の説明を出しているか（カーソル・フォーカス・タップ）。key は丸を見分ける値 */
export function useEventFocus<K extends string | number>(): {
  on: K | null;
  bind: (key: K) => { onPointerEnter: () => void; onPointerLeave: () => void; onFocus: () => void; onBlur: () => void; onClick: () => void };
  clear: () => void;
} {
  const [on, setOn] = useState<K | null>(null);
  const off = (key: K) => setOn((c) => (c === key ? null : c));
  return {
    on,
    bind: (key) => ({ onPointerEnter: () => setOn(key), onPointerLeave: () => off(key), onFocus: () => setOn(key), onBlur: () => off(key), onClick: () => setOn(key) }),
    clear: () => setOn(null),
  };
}

type Handlers = ReturnType<ReturnType<typeof useEventFocus>["bind"]>;

/** グラフ（SVG）の丸: 中心 (x, y)、半径 r */
export function EventDotSvg({ chip, x, y, r, on, handlers }: { chip: EventChip; x: number; y: number; r: number; on: boolean; handlers: Handlers }) {
  return (
    <g class={`ev${chip.short ? " short" : ""}${on ? " on" : ""}`} transform={`translate(${x.toFixed(1)},${y.toFixed(1)})`} tabIndex={0} role="img" aria-label={eventLabel(chip)} data-ev={chip.year} {...handlers}>
      <circle r={r} />
      <text text-anchor="middle" dominant-baseline="central">
        {chip.icon}
      </text>
    </g>
  );
}

/** 表（HTML）の丸: グラフの丸と同じ大きさ（半径 EVENT_R を rem で）・同じ線・同じ漢字の置き方 */
export function EventDotHtml({ chip, on, handlers, dotRef }: { chip: EventChip; on: boolean; handlers: Handlers; dotRef?: Ref<HTMLSpanElement> }) {
  return (
    <span ref={dotRef} class={`ev-dot${chip.short ? " short" : ""}${on ? " on" : ""}`} tabIndex={0} role="img" aria-label={eventLabel(chip)} data-ev={chip.year} {...handlers}>
      <span class="ev-dot-t" aria-hidden="true">
        {chip.icon}
      </span>
    </span>
  );
}

/**
 * 表の丸の説明の置き場所（画面に対する固定の位置）: 丸の真上の中央。上に入らなければ下。左右は画面からはみ出さない。
 * rect: 丸の位置（getBoundingClientRect）、w・h: 説明の箱の大きさ、vw: 画面の幅
 */
export function placeFixedAbove(rect: { left: number; top: number; width: number; height: number }, w: number, h: number, vw: number, gap = 8): { left: number; top: number; below: boolean } {
  const pad = 4;
  const cx = rect.left + rect.width / 2;
  const left = Math.max(pad, Math.min(vw - pad - w, cx - w / 2));
  const above = rect.top - gap - h;
  if (above >= pad) return { left, top: above, below: false };
  return { left, top: rect.top + rect.height + gap, below: true };
}
