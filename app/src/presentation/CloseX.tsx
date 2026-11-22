// 重ねて出す物（帯の下の一覧・世帯の選択・中央のパネル・入力項目のパネル・右の引き出し・入力のホームの中で開く物・確かめの問い）の
// 閉じ方を1つにする部品（0239）。
// - 右上の丸い ×（`.x-btn`。見た目は styles/app.css）
// - Esc で閉じる。重ねて出しているときは、いちばん上（後から出した物）の1つだけを閉じる。横に並ぶ物（引き出し・届いた書類の枠）は
//   いつも下に置き、その中にいるときの Esc は、その枠が自分で受ける
// - 日本語の変換中・開いているプルダウン・文字を打つ欄にいるときの Esc では閉じない（欄にいても閉じる物は、呼ぶ側が typing で決める）
// 提示層の引き出し（根拠）も使うので提示層に置く。作業の層・エンジンは読み込まない
import { useEffect, useRef } from "preact/hooks";

/** × の読み上げ（what を渡すと「メモを閉じる（Esc）」） */
export const closeLabel = (what?: string): string => (what !== undefined ? `${what}を閉じる（Esc）` : "閉じる（Esc）");

/** 右上の ×。ほかの属性（data-* など）はそのままボタンに付ける */
export function CloseX({ onClose, what, disabled = false, ...rest }: { onClose: () => void; what?: string; disabled?: boolean; [attr: `data-${string}`]: string | boolean | undefined }) {
  return (
    <button type="button" class="x-btn" aria-label={closeLabel(what)} title="閉じる（Esc）" disabled={disabled} onClick={onClose} {...rest}>
      ×
    </button>
  );
}

/** 重ねて出している物の1つ。close が null の物は Esc で閉じない（選ばせる問いなど）が、下の物にも Esc を渡さない */
export interface EscLayer {
  close: (() => void) | null;
  /** 文字を打つ欄にいるときも閉じるか（閉じる前に打ちかけの値を決める物・欄の中身を残して閉じる物だけ） */
  typing: boolean;
}

/** 出した順（最後がいちばん上） */
const layers: { current: EscLayer }[] = [];

/** 重ねて出した物を足す（side: 横に並ぶ物は、いちばん下に足す）。返す関数で外す */
export function pushEscLayer(layer: { current: EscLayer }, side = false): () => void {
  if (side) layers.unshift(layer);
  else layers.push(layer);
  return () => {
    const i = layers.lastIndexOf(layer);
    if (i >= 0) layers.splice(i, 1);
  };
}

const NOT_TEXT = new Set(["checkbox", "radio", "button", "submit", "reset", "range", "file", "color", "image"]);
type Target = { tagName?: string; type?: string; isContentEditable?: boolean; matches?: (q: string) => boolean } | null;

/** 文字を打つ欄・選ぶ欄にいるか */
export function inTextField(target: unknown): boolean {
  const t = target as Target;
  if (t === null || typeof t !== "object") return false;
  if (t.tagName === "TEXTAREA" || t.tagName === "SELECT") return true;
  if (t.tagName === "INPUT") return !NOT_TEXT.has(String(t.type));
  return t.isContentEditable === true;
}

/** 選ぶ欄の一覧が開いているか（開いているかを聞けない画面では false。その画面は、開いている間の Esc をページに渡さない） */
function pickerOpen(target: unknown): boolean {
  const t = target as Target;
  if (t === null || typeof t !== "object" || t.tagName !== "SELECT" || typeof t.matches !== "function") return false;
  try {
    return t.matches(":open");
  } catch {
    return false;
  }
}

export type EscKey = Pick<KeyboardEvent, "key" | "defaultPrevented" | "isComposing" | "keyCode" | "target" | "preventDefault">;

/**
 * Esc を、いちばん上の物に渡す。中の部品（説明の「?」・選択肢の一覧など）が先に受けた Esc（defaultPrevented・伝えるのを止めたもの）は受けない。
 * 受けたら preventDefault して、後ろの画面の Esc（グラフの年の固定を外すなど）には渡さない
 */
export function escKey(e: EscKey): void {
  if (e.key !== "Escape" || e.defaultPrevented) return;
  const top = layers.at(-1)?.current;
  if (top === undefined) return;
  if (e.isComposing || e.keyCode === 229 || pickerOpen(e.target)) return;
  if (top.close === null) {
    e.preventDefault();
    return;
  }
  if (!top.typing && inTextField(e.target)) return;
  e.preventDefault();
  top.close();
}

// 読み込んだときに1回だけ付ける（後ろの画面が後から付ける Esc の受け手より先に受けるため）
if (typeof document !== "undefined") document.addEventListener("keydown", escKey);

/**
 * 出している間、Esc で閉じる物として重ねる。
 * onClose: 閉じる処理（描き直しのたびに新しい関数でよい）。null なら Esc で閉じない（下の物にも渡さない）
 * on: 出しているか（閉じている間は false）
 * how.typing: 文字を打つ欄にいるときも閉じる（既定は閉じない＝書きかけを守る）
 * how.side: 横に並ぶ物（右の引き出し・届いた書類の枠）。後から出しても、ほかの物の下に置く（その中にいるときの Esc は、枠の onKeyDown で受ける）
 */
export function useEscClose(onClose: (() => void) | null, on = true, how: { typing?: boolean; side?: boolean } = {}): void {
  const typing = how.typing === true;
  const side = how.side === true;
  const layer = useRef<EscLayer>({ close: onClose, typing });
  layer.current = { close: onClose, typing };
  useEffect(() => (on ? pushEscLayer(layer, side) : undefined), [on, side]);
}
