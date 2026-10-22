// 図の箱の小さな札（提示層の部品）: バランスシートの図・お金の3つの分け方の図で、箱にカーソルを合わせる・キーボードで選ぶと、
// 箱の名前・金額（・あれば一言の補足）を出す。薄くて名前や金額を書けない箱（外貨預金・財形・小さい iDeCo など）も読めるように、
// 書けている箱にも同じ札を出す。見た目はグラフの年の札（.year-tip）と同じ。
// - マウス（ペン）: 乗せている間だけ出す。キーボード: フォーカスしている間だけ出す
// - タッチ: 乗せる操作が無いので、押すと出す（pinTap）。もう一度押す・外を押す・Esc で閉じる。バランスシートの図は押すと内訳の小窓が開くので、札は出さない
// - 札の位置は図の座標（viewBox）で渡し、図の枠に対する割合で置く（図が枠に合わせて縮んでもずれない）
import { useEffect, useRef, useState } from "preact/hooks";
import { man } from "./format.ts";
import type { Yen } from "./model.ts";

export interface FigTipData {
  /** 箱の鍵（同じ箱をもう一度押したら閉じる） */
  key: string;
  title: string;
  amount: Yen;
  /** 一言の補足（例: 「すぐ使えるお金のうち」） */
  note?: string;
  /** 内訳（キーボードで箱のまとまりを選んだとき） */
  rows?: { label: string; amount: Yen }[];
  /** 札の色見本（CSS の色） */
  swatch?: string;
  /** 札を置く位置（図の座標）。side が "r" なら x の右に、"l" なら x の左に置く。y は札の縦の真ん中 */
  x: number;
  y: number;
  side: "r" | "l";
}

/** 箱（の図形）に付ける手続き（どの SVG の要素にも付けられる形） */
export interface FigTipHandlers {
  onPointerEnter?: (e: PointerEvent) => void;
  onPointerLeave?: (e: PointerEvent) => void;
  onClick?: (e: MouseEvent) => void;
  onFocus?: () => void;
  onBlur?: () => void;
}

/** 札の状態と、箱に付ける手続き */
export function useFigTip(opts: { pinTap?: boolean } = {}) {
  const [tip, setTip] = useState<{ d: FigTipData; pinned: boolean } | null>(null);
  const wrap = useRef<HTMLDivElement>(null);
  const pinned = tip?.pinned === true;
  useEffect(() => {
    if (!pinned) return;
    const close = (e: Event) => {
      if (e instanceof KeyboardEvent ? e.key === "Escape" : !(wrap.current?.contains(e.target as Node) ?? false)) setTip(null);
    };
    document.addEventListener("click", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("click", close);
      document.removeEventListener("keydown", close);
    };
  }, [pinned]);
  /** 箱（の図形）に付ける: マウスで乗せる・外す。タッチで押す（pinTap のとき） */
  const hover = (d: FigTipData): FigTipHandlers => ({
    onPointerEnter: (e: PointerEvent) => {
      if (e.pointerType !== "touch") setTip((t) => (t?.pinned === true ? t : { d, pinned: false }));
    },
    onPointerLeave: (e: PointerEvent) => {
      if (e.pointerType !== "touch") setTip((t) => (t === null || t.pinned || t.d.key !== d.key ? t : null));
    },
    ...(opts.pinTap === true
      ? {
          onClick: (e: MouseEvent) => {
            e.stopPropagation();
            setTip((t) => (t?.pinned === true && t.d.key === d.key ? null : { d, pinned: true }));
          },
        }
      : {}),
  });
  /** 箱のまとまり（フォーカスできる要素）に付ける: フォーカスしている間だけ出す */
  const focus = (d: FigTipData): FigTipHandlers => ({
    onFocus: () => setTip((t) => (t?.pinned === true ? t : { d, pinned: false })),
    onBlur: () => setTip((t) => (t === null || t.pinned ? t : null)),
  });
  return { tip: tip?.d ?? null, pinned, wrap, hover, focus, hide: () => setTip(null) };
}

const pct = (v: number, of: number) => `${((v / Math.max(1, of)) * 100).toFixed(3)}%`;

/** 札（図の枠（position: relative）の中に置く）。読み上げは箱の aria-label が受け持つので、札は読み上げない */
export function FigTip({ d, W, H, pinned = false }: { d: FigTipData; W: number; H: number; pinned?: boolean }) {
  return (
    <div class={`year-tip fig-tip${pinned ? " pinned" : ""}`} style={{ left: pct(d.x, W), top: pct(d.y, H), transform: d.side === "r" ? "translate(0, -50%)" : "translate(-100%, -50%)" }} aria-hidden="true" data-fig-tip={d.key}>
      <div class="yt-h">
        {d.swatch !== undefined ? <i class="ft-sw" style={{ background: d.swatch }} /> : null}
        <span>{d.title}</span>
        <b class="num ft-am">
          {man(d.amount)}
          <small>万円</small>
        </b>
      </div>
      {d.rows !== undefined && d.rows.length > 0 ? (
        <ul class="ft-rows">
          {d.rows.map((r, i) => (
            <li key={i}>
              <span>{r.label}</span>
              <b class="num">
                {man(r.amount)}
                <small>万円</small>
              </b>
            </li>
          ))}
        </ul>
      ) : null}
      {d.note !== undefined && d.note !== "" ? <div class="yt-x ft-note">{d.note}</div> : null}
    </div>
  );
}
