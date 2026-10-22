// 試作（見比べて決めるための一時の仕組み）: バランスシートの図の箱の見た目を切り替える。製品の設定項目にはしない
// - "filled": 今の形（濃い色のベタ塗り・白い文字）
// - "outlined": 薄い塗り＋同じ色相の枠線＋濃い文字（お金の3つの分け方の図の左の柱と同じ考え）
// URL の #bs=outlined で枠線ありの版（ほかの鍵と & でつなげる。例: #tab=balance&bs=outlined）。書き換えるとすぐ切り替わる。
// どちらにするか決めたら、選ばなかった方とこの切り替え（このファイル）を外す
import { useEffect, useState } from "preact/hooks";

export type BsBoxStyle = "filled" | "outlined";

export function readBsBoxStyle(hash: string): BsBoxStyle {
  return hash.replace(/^#/, "").split("&").includes("bs=outlined") ? "outlined" : "filled";
}

const current = (): BsBoxStyle => (typeof location === "undefined" ? "filled" : readBsBoxStyle(location.hash));

/** 今の見た目（URL の # が変わると付いてくる） */
export function useBsBoxStyle(): BsBoxStyle {
  const [s, setS] = useState<BsBoxStyle>(current);
  useEffect(() => {
    const on = () => setS(current());
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);
  return s;
}

/** 枠線ありの版の薄い塗り（その色を白に 15% 混ぜる。お金の3つの分け方の図の薄い塗りと同じくらいの明るさ） */
export const tintOf = (color: string) => `color-mix(in srgb, ${color} 15%, #fff)`;
/** 枠線ありの版の枠線（その色を白に 72% 混ぜる。お金の3つの分け方の図の枠線と同じくらいの濃さ） */
export const edgeOf = (color: string) => `color-mix(in srgb, ${color} 72%, #fff)`;
/** 枠線の太さ（お金の3つの分け方の図と同じ） */
export const EDGE_W = 1.5;
