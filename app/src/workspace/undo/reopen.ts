// 世帯を開き直したときに、元に戻すの履歴を続けてよいか（世帯ごとの履歴。0097）。
// 続けてよいのは、開き直した中身が、この画面でその世帯を最後に持っていた中身（保存した・読んだ本文）と同じときだけ。
// 本体は保存した本文を読み直して書き戻すので、欄の並び（名前の順になる）と数の書き方は変わりうる。
// 文字列では比べず、読むときの整え（fromBody）を両方に当ててから、並びを見ずに中身で比べる
import { bodyObject, fromBody } from "../store/body.ts";

/** 世帯ファイルの本文の中身が同じか（欄の並び・数の書き方の違いは見ない。読めない本文は同じとしない） */
export function sameBodyContent(a: string, b: string): boolean {
  if (a === b) return true;
  try {
    return sameJson(bodyObject(fromBody(a)), bodyObject(fromBody(b)));
  } catch {
    return false;
  }
}

/**
 * 開き直したときの履歴: last はこの画面でその世帯を最後に持っていた本文（無ければ、この画面でまだ開いていない）、
 * loaded は今読んだ本文（画面に入れる形）。同じなら続きから、違えば空から
 */
export function reopenHistory(last: string | undefined, loaded: string): "continue" | "reset" {
  return last !== undefined && sameBodyContent(last, loaded) ? "continue" : "reset";
}

/** JSON の値が同じか: 欄の並びは見ない・値の無い欄は無いのと同じ・数は書き方の違い（読み直したときの最後の桁）を許す */
function sameJson(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a === "number" && typeof b === "number") return Math.abs(a - b) <= 1e-12 * Math.max(1, Math.abs(a), Math.abs(b));
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a)) {
    const bb = b as unknown[];
    return a.length === bb.length && a.every((x, i) => sameJson(x, bb[i]));
  }
  const ao = a as Record<string, unknown>;
  const bo = b as Record<string, unknown>;
  const ak = Object.keys(ao).filter((k) => ao[k] !== undefined);
  const bk = Object.keys(bo).filter((k) => bo[k] !== undefined);
  return ak.length === bk.length && ak.every((k) => Object.hasOwn(bo, k) && sameJson(ao[k], bo[k]));
}
