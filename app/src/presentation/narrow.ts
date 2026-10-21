// 狭い画面（スマホの縦の画面の幅）かどうか（提示層の部品が共通に使う）。
// - 狭い画面では、グラフの中の札（資産が尽きる年の文字）を出さない・バランスシートの図の札を図の下の一覧に回す・グラフの使い方の文を短くする
// - アプリの広い画面では変わらない。決まりは画面の幅（グラフや図の枠の幅ではない）で見るので、広い画面で図を並べて小さくしても変わらない
import { useEffect, useState } from "preact/hooks";

/** 狭い画面の幅の決まり（640px 未満） */
export const NARROW_QUERY = "(max-width: 639.98px)";

function matches(): boolean {
  return typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia(NARROW_QUERY).matches;
}

/** 狭い画面か（窓の幅を変えたときも追う） */
export function useNarrow(): boolean {
  const [narrow, setNarrow] = useState(matches);
  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    const mq = window.matchMedia(NARROW_QUERY);
    const on = () => setNarrow(mq.matches);
    on();
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return narrow;
}
