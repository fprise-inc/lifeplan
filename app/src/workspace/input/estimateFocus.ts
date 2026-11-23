// 推定の値の欄に入ったときの動き（0254）と、使えない文字のまま離れたときの知らせの組み立て。
// 欄の部品（FieldViews.tsx の Field・時点の欄）と、専用の部品の数の欄（貯蓄・運用の NumBox）で同じ動きにする

/**
 * 推定の値の欄（点線の枠・「推定」の印）に入ったときに、欄に入れて全部選ぶ文字。推定の欄でなければ null（今までどおり、押した所に文字の位置が来る）。
 * shown は欄に見えている文字（推定の値が入っている欄）、ghost は空欄のまま推定で計算している欄が灰色で見せている推定の値。
 * どちらも無い推定の欄（「空欄＝推定」の欄など）は選ぶ文字が無いので null
 */
export function estimateSelectText(estimated: boolean, shown: string, ghost: string | null): string | null {
  if (!estimated) return null;
  if (shown !== "") return shown;
  return ghost !== null && ghost !== "" ? ghost : null;
}

/**
 * 欄に推定の文字を入れて全部選ぶ（そのまま打てば置き換わり、← → で選択を外して一部を直せる）。
 * 描き直し（preact）で同じ文字を入れ直しても選択は消えない（値が同じなら DOM を書き換えない）
 */
export function selectEstimate(el: HTMLInputElement | null, text: string): void {
  if (el === null) return;
  if (el.value !== text) el.value = text;
  el.select();
}

/**
 * 推定の欄をマウスで押したとき: まだ欄に入っていなければ、押した所に文字の位置を置く既定の動きを止めて、欄に入れる（入ったときに全部選ぶ）。
 * 止めないと、押したときの文字の位置で選択が外れる（Chrome・WebKit とも、選んだ後のマウスの動きで選択が付け替わる）。
 * もう入っている欄は今までどおり（押した所に文字の位置が来る）
 */
export function enterEstimateByMouse(e: MouseEvent, estimated: boolean): void {
  const el = e.currentTarget as HTMLInputElement | null;
  if (!estimated || el === null || e.button !== 0 || el.ownerDocument.activeElement === el) return;
  e.preventDefault();
  el.focus();
}

/**
 * 使えない文字のまま欄を離れたときの知らせ: 「「○○」は入れられないため、前の値のままです。理由」。
 * 空のまま離れたときは、空の文字を「」と出さず、理由だけ（「空にはできません。値を入れてください」）
 */
export function keptText(typed: string, reason: string): string {
  return typed.trim() === "" ? reason : `「${typed}」は入れられないため、前の値のままです。${reason}`;
}
