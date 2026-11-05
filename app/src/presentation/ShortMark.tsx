// 金融資産が足りなくなる所の印（提示層の共通の部品）: 主画面のグラフ（MainChart.tsx）と万一のときのグラフ（ContingencyView.tsx）で同じ見た目・同じ動きにする。
// - 「!」の丸は、できごとの丸の段のすぐ上の専用の細い段に置く（いつも同じ高さ。できごとと同じ年でも上下に分かれ、重ならない）
// - 線が0を切る所（前の年の金額と足りなくなる年の金額を直線で結んで0になる所。crossIndex）から「!」まで赤い点線を引く。点線の上端には印を置かない。
//   「!」の丸も同じ横の位置を基準に置く（資産の線が無い収支の推移では、足りなくなる年の位置）。札の文の年・年齢は初めて足りなくなる年
// - 近い年（同じ年）の「!」が重なるときは少し横にずらす（点線は0の線から段の上の端までまっすぐ下ろし、そこから丸へ折る）
// - カーソルを合わせる・キーボードでフォーカスする・押す（タッチ）と、「○歳（○年）で金融資産が足りなくなります」の札を、できごとの札と同じ見た目で出す
// - 読み上げは aria-label（<title> は使わない。ブラウザの小さな表示と二重になるため）
import type { JSX, Ref } from "preact";
import { spreadX } from "./chart.ts";
import type { useEventFocus } from "./EventDot.tsx";

/** 「!」の丸の半径（文字の大きさ fs に比例。16px のとき 8.5px） */
export const SHORT_R = 8.5;
/** 「!」の段の高さ（16px のとき）。丸の直径と、上の余白 3px・下の余白 2px（その下にできごとの丸の段の余白が続く） */
export const SHORT_ROW = 2 * SHORT_R + 5;

/** 段の上の端から丸の中心まで（16px のとき） */
export const shortCenter = (rowTop: number, fs: number): number => rowTop + (3 + SHORT_R) * fs;

/** 1つの「!」（どの年・だれの・どの色か）。位置は描く側が決める */
export interface ShortSource {
  key: string;
  /** 初めて足りなくなる年（札の文の年） */
  year: number;
  /** 線が0を切る所（年の番号を小数で。crossIndex） */
  cross: number;
  /** 札の文 */
  text: string;
  /** 丸の塗り（全部のプランを重ねる表示のプランの色）。省略は赤 */
  color?: string;
  /** 基準のプラン（白抜き。年の印の基準の○と同じ決まり） */
  base?: boolean;
}

/** 札の文（例: 「79歳（2058年）で金融資産が足りなくなります」。who を渡すと頭に添える） */
export function shortText(year: number, age: number | null | undefined, who?: string): string {
  return `${who !== undefined && who !== "" ? `${who} ` : ""}${age != null ? `${age}歳（${year}年）` : `${year}年`}で金融資産が足りなくなります`;
}

/**
 * 線が0を切る所の位置（年の番号を小数で）: 前の年（i − 1）の金額と初めて足りなくなる年（i）の金額を直線で結び、0 になる所。
 * 前の年が無い（最初の年からマイナス）・前の年もマイナスのときは i
 */
export function crossIndex(v: readonly number[], i: number): number {
  const a = v[i - 1];
  const b = v[i];
  if (i <= 0 || a === undefined || b === undefined || a < 0 || b >= 0) return i;
  return i - 1 + a / (a - b);
}

/** 丸の x（線が0を切る所の位置 xs から。重なる丸は丸の直径＋少しの間隔で横に並べ直す） */
export function shortXs(xs: readonly number[], fs: number, lo: number, hi: number): number[] {
  return spreadX(xs, (2 * SHORT_R + 2) * fs, lo + SHORT_R * fs, hi - SHORT_R * fs);
}

type Focus = ReturnType<typeof useEventFocus<number>>;

/**
 * 点線（SVG）。xs: 線が0を切る所の x、top: 点線の上端（線が0を切る所の y）、rowTop: 「!」の段の上の端（グラフの面の下の端）、
 * at: 丸の x（shortXs。null は丸を描かない縮めた表示で、点線は面の下の端まで）。点線は年を読む面や線と同じく面の中に描き、丸より下に置く
 */
export function ShortLinesSvg({ list, xs, at, top, rowTop, fs }: { list: readonly ShortSource[]; xs: readonly number[]; at: readonly number[] | null; top: number; rowTop: number; fs: number }) {
  const end = shortCenter(rowTop, fs) - SHORT_R * fs;
  return (
    <g class="short-lines">
      {list.map((m, j) => {
        const x = (xs[j] as number).toFixed(1);
        const tail = at === null ? "" : `L${(at[j] as number).toFixed(1)} ${end.toFixed(1)}`;
        return <path key={m.key} d={`M${x} ${top.toFixed(1)}V${rowTop.toFixed(1)}${tail}`} class="dep-line" data-short-line={m.year} />;
      })}
    </g>
  );
}

/** 「!」の丸（SVG）。at: 丸の x（shortXs）、rowTop: 「!」の段の上の端。年を読む面より上に置く（カーソルを合わせられるように） */
export function ShortDotsSvg({ list, at, rowTop, fs, focus }: { list: readonly ShortSource[]; at: readonly number[]; rowTop: number; fs: number; focus: Focus }) {
  const r = SHORT_R * fs;
  const cy = shortCenter(rowTop, fs);
  return (
    <g class="shorts" data-shorts>
      {list.map((m, j) => (
        <g
          key={m.key}
          class={`sk${m.base === true ? " base" : ""}${focus.on === j ? " on" : ""}`}
          transform={`translate(${(at[j] as number).toFixed(1)},${cy.toFixed(1)})`}
          tabIndex={0}
          role="img"
          aria-label={m.text}
          data-short={m.year}
          data-short-key={m.key}
          {...focus.bind(j)}
        >
          <circle r={r} style={m.color !== undefined ? { fill: m.color, stroke: m.color } : undefined} {...(m.color !== undefined ? { "data-plan-color": m.color } : {})} />
          <text text-anchor="middle" dominant-baseline="central">
            !
          </text>
        </g>
      ))}
    </g>
  );
}

/** 札（できごとの札 .ev-tip と同じ見た目）。置き場所は使う側が style で渡す */
export function ShortTip({ text, style, tipRef }: { text: string; style: JSX.CSSProperties; tipRef?: Ref<HTMLDivElement> }) {
  return (
    <div ref={tipRef} class="year-tip ev-tip short" style={style} role="tooltip" data-short-tip>
      <div class="yt-h">
        <span class="ev-ic" aria-hidden="true">
          !
        </span>
        <span class="ev-t">{text}</span>
      </div>
    </div>
  );
}
