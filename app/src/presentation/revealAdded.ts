// 「＋」で足した物を見せる共通の部品（0077 の追記）: 「＋」のボタンで行・段・物を足したとき、足した物を
// 1) 画面の中に見えるようにスクロールし（見えているときは動かさない。なめらかに）、
// 2) 薄い色で光らせ（1.6秒でフェードして消える。動きを減らす設定では光らせるだけで、フェードしない）、
// 3) 最初の欄にフォーカスを移す（キーボードで続けて入れられる。フォーカスでは画面を動かさない）。
// 足した物は「押す前に無かった要素」で見つける（足す処理ごとに場所を知らせなくてよい。どの「＋」にも同じように効く）。
// 欄に入るだけでは値も状態も変えない（0041）ので、フォーカスを移しても下書きは変わらない

/** 足した物として探す要素（区画・まとまり・表の行・並びの1つ。ほかは data-reveal-item で印を付ける） */
export const REVEAL_ITEMS = ".in-section, .in-group, tr, li, [data-reveal-item]";
/** 探す範囲（押したボタンの近い祖先。無ければ文書全体） */
const ROOT = "[data-reveal-root]";
/** 光らせる時間（ミリ秒。app.css の .just-added のアニメーションと同じ） */
export const REVEAL_MS = 1600;
const FIELDS = "input:not([type=hidden]):not(:disabled), select:not(:disabled), textarea:not(:disabled)";

/**
 * 押す前に無かった要素から、足した物を選ぶ（DOM を読むだけ。テスト用に分けた）。
 * 新しい要素のうち、ほかの新しい要素の中に無い物（いちばん外側）だけを見る。欄のある物を先に、押したボタンに近い物（ボタンの前ならすぐ前、無ければすぐ後）を選び、
 * 同じ親の下で続けて足された物（1件の物が見出しのまとまりと中身のまとまりに分かれるときなど）もいっしょに返す
 */
export function pickAdded(fresh: readonly Element[], trigger: Element | null): Element[] {
  const outer = fresh.filter((e) => !fresh.some((o) => o !== e && o.contains(e)));
  if (outer.length === 0) return [];
  const withFields = outer.filter((e) => e.querySelector(FIELDS) !== null);
  const pool = withFields.length > 0 ? withFields : outer;
  let pick = pool[0] as Element;
  if (trigger !== null && trigger.isConnected) {
    const before = pool.filter((e) => (e.compareDocumentPosition(trigger) & 4) !== 0);
    const after = pool.filter((e) => (e.compareDocumentPosition(trigger) & 2) !== 0);
    pick = before.at(-1) ?? after[0] ?? pick;
  }
  // 同じ親の下で、選んだ物の前後に続けて足された物
  const run: Element[] = [pick];
  const set = new Set<Element>(outer);
  for (let p = pick.previousElementSibling; p !== null && set.has(p); p = p.previousElementSibling) run.unshift(p);
  for (let n = pick.nextElementSibling; n !== null && set.has(n); n = n.nextElementSibling) run.push(n);
  return run;
}

function reducedMotion(): boolean {
  return typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** スクロールする祖先（無ければ null＝窓） */
function scroller(el: Element): Element | null {
  for (let p = el.parentElement; p !== null; p = p.parentElement) {
    const oy = getComputedStyle(p).overflowY;
    if ((oy === "auto" || oy === "scroll") && p.scrollHeight > p.clientHeight) return p;
  }
  return null;
}

/** 見えていなければ見える所までスクロールする（見えているときは動かさない） */
function bringIntoView(first: Element, last: Element): void {
  const sc = scroller(first);
  const view = sc !== null ? sc.getBoundingClientRect() : { top: 0, bottom: innerHeight };
  const top = first.getBoundingClientRect().top;
  const bottom = last.getBoundingClientRect().bottom;
  const delta = scrollDelta(top, bottom, view.top, view.bottom);
  if (delta === 0) return;
  const opt: ScrollToOptions = { top: delta, behavior: reducedMotion() ? "auto" : "smooth" };
  if (sc !== null) sc.scrollBy(opt);
  else scrollBy(opt);
}

/** 端からの余白（px） */
const MARGIN = 12;

/**
 * 足した物（top〜bottom）を見える所（viewTop〜viewBottom）に入れるのに動かす量（0 は動かさない）。
 * 見えているときは動かさない。下にはみ出すときは下の端に、上にはみ出すときや見える所より背が高いときは頭（最初の欄）をそろえる
 */
export function scrollDelta(top: number, bottom: number, viewTop: number, viewBottom: number): number {
  if (top >= viewTop && bottom <= viewBottom) return 0;
  const tall = bottom - top > viewBottom - viewTop - 2 * MARGIN;
  if (tall || top < viewTop) return top - viewTop - MARGIN;
  return bottom - viewBottom + MARGIN;
}

function glow(els: readonly Element[]): void {
  const cls = reducedMotion() ? "just-added still" : "just-added";
  for (const e of els) {
    e.classList.remove("just-added", "still");
    // 続けて足したときも、光り直す
    void (e as HTMLElement).offsetWidth;
    e.classList.add(...cls.split(" "));
    setTimeout(() => e.classList.remove("just-added", "still"), REVEAL_MS);
  }
}

function focusFirst(els: readonly Element[], trigger: HTMLElement | null): void {
  for (const e of els) {
    const f = [...e.querySelectorAll<HTMLElement>(FIELDS)].find((x) => x.getClientRects().length > 0);
    if (f !== undefined) {
      f.focus({ preventScroll: true });
      return;
    }
  }
  // 欄の無い物は、押したボタンが消えたときだけ、足した物に移す（フォーカスが行き先をなくさないように）
  if (trigger === null || !trigger.isConnected) {
    const e = els[0] as HTMLElement;
    if (!e.hasAttribute("tabindex")) e.setAttribute("tabindex", "-1");
    e.focus({ preventScroll: true });
  }
}

/**
 * 「＋」のボタンを押すときに、足す処理の前に呼ぶ。描き直しの後に、足した物を見せる。
 * 使い方: onClick={(e) => { revealAdded(e.currentTarget); onEdit(a.run(wh)); }}
 */
export function revealAdded(trigger: Element, opts: { items?: string } = {}): void {
  if (typeof document === "undefined" || typeof requestAnimationFrame !== "function") return;
  const sel = opts.items ?? REVEAL_ITEMS;
  const root: ParentNode = trigger.closest(ROOT) ?? document;
  const before = new Set(root.querySelectorAll(sel));
  const btn = trigger instanceof HTMLElement ? trigger : null;
  // 描き直しは押した後の小さな処理で走るので、次の描画の後に見る
  requestAnimationFrame(() =>
    requestAnimationFrame(() => {
      const scope: ParentNode = (root as Node).isConnected ? root : document;
      const fresh = [...scope.querySelectorAll(sel)].filter((e) => !before.has(e));
      const got = pickAdded(fresh, btn);
      if (got.length === 0) return;
      bringIntoView(got[0] as Element, got.at(-1) as Element);
      glow(got);
      focusFirst(got, btn);
    }),
  );
}
