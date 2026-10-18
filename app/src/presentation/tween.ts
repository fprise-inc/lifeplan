// グラフの補間（数字を動かす・案を切り替えると、線と面が前の形から新しい形へ約0.5秒で動く。行き過ぎない）。
// 計算はしない（受け取った数字の間を描くだけ）。補間しても、計算の待ち（先出し・正の計算）は変わらない
import { useEffect, useRef, useState } from "preact/hooks";

/** 補間の長さ（ミリ秒） */
export const TWEEN_MS = 520;

/**
 * 行き過ぎのない動き（0→1。初めは速く、終わりはゆっくり目標に着く。途中で 1 を超えない・0 を下回らない・戻らない）。
 * 少し上振れ・下振れして戻る動き（以前の easeOutBack）は、数字が一瞬その値になったように見えて誤解のもとになるのでやめた
 */
export function easeOutCubic(t: number): number {
  const u = Math.min(1, Math.max(0, t));
  return 1 - (1 - u) ** 3;
}

/** 補間する数字の束（系列の名前 → 年ごとの値） */
export type Series = Readonly<Record<string, readonly number[]>>;

/** a から b へ k（0→1）の位置の値。a に無い系列・長さの違う系列は b のまま */
export function lerpSeries(a: Series | null, b: Series, k: number): Record<string, number[]> {
  const out: Record<string, number[]> = {};
  for (const key of Object.keys(b)) {
    const to = b[key] as readonly number[];
    const from = a?.[key];
    out[key] = from === undefined || from.length !== to.length ? to.slice() : to.map((v, i) => (from[i] as number) + (v - (from[i] as number)) * k);
  }
  return out;
}

export function sameSeries(a: Series | null, b: Series): boolean {
  if (a === null) return false;
  const ka = Object.keys(a);
  if (ka.length !== Object.keys(b).length) return false;
  for (const key of ka) {
    const x = a[key] as readonly number[];
    const y = b[key];
    if (y === undefined || x.length !== y.length) return false;
    for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return false;
  }
  return true;
}

/** 動きを減らす設定（prefers-reduced-motion）か */
export function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/**
 * 受け取った数字の束を、前に描いた形から補間して返す（描く部品の中だけで使う。画面全体は描き直さない）。
 * - 動いている途中で新しい数字が来たら、今描いている形から新しい形へ動き直す（スライダーの先出しが続いても、つながって動く）
 * - 新しい数字が今の行き先と同じなら（先出しと正の計算が同じ数字のとき）、動きをそのまま続ける（置き換えで止まったり動き直したりしない）
 * - 動きを減らす設定のときは動かさない
 */
export function useTween(target: Series, opts: { reduce?: boolean; duration?: number } = {}): Series {
  const [, setFrame] = useState(0);
  const shown = useRef<Series>(target);
  const anim = useRef<{ from: Series; to: Series; t0: number; raf: number } | null>(null);
  const dest = useRef<Series>(target);
  const reduce = opts.reduce ?? prefersReducedMotion();
  const duration = opts.duration ?? TWEEN_MS;

  if (!sameSeries(dest.current, target)) {
    const from = shown.current;
    dest.current = target;
    if (reduce || typeof requestAnimationFrame !== "function") {
      if (anim.current !== null) cancelAnimationFrame(anim.current.raf);
      anim.current = null;
      shown.current = target;
    } else {
      if (anim.current !== null) cancelAnimationFrame(anim.current.raf);
      anim.current = { from, to: target, t0: performance.now(), raf: 0 };
    }
  } else if (anim.current === null) {
    // 同じ数字の新しい束（置き換え）: 形は変えずに持ち替える
    shown.current = target;
  }

  useEffect(() => {
    const a = anim.current;
    if (a === null || a.raf !== 0) return;
    const step = (now: number) => {
      const cur = anim.current;
      if (cur === null) return;
      const t = Math.min(1, (now - cur.t0) / duration);
      shown.current = t >= 1 ? cur.to : lerpSeries(cur.from, cur.to, easeOutCubic(t));
      if (t >= 1) anim.current = null;
      else cur.raf = requestAnimationFrame(step);
      setFrame((n) => n + 1);
    };
    a.raf = requestAnimationFrame(step);
  });
  useEffect(
    () => () => {
      if (anim.current !== null) cancelAnimationFrame(anim.current.raf);
    },
    [],
  );
  return shown.current;
}
