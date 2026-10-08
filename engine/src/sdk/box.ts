// 0008 の2: 値の箱から計算に使う値を取り出す。わからない（unknown）は代わりの値、該当なし（notApplicable）は null
import type { ValueBox } from "../engine/types.ts";

export function boxValue<T>(box: ValueBox<T> | undefined): T | null {
  if (box === undefined) return null;
  switch (box.state) {
    case "confirmed":
    case "estimated":
      return box.value ?? null;
    case "unknown":
      return boxValue(box.substitute);
    default:
      return null;
  }
}
