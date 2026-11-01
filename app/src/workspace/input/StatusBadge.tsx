// カードの状態の印（色だけで区別しない: ✓／!／0／− の印と文字を必ず付ける）。まだ入れていない項目には札を出さない（カードは「まだ入っていません」の文で見せる）
import type { InputItem, ItemStatus } from "./items.ts";

export const STATUS_TEXT: Record<ItemStatus, string> = { done: "入力済み", est: "推定で計算中", missing: "未入力（0円の所あり）", na: "該当なし", empty: "まだ入れていない" };

export function statusText(item: Pick<InputItem, "status" | "estimated">): string {
  return item.status === "est" ? `推定で計算中（${item.estimated}項目）` : STATUS_TEXT[item.status];
}

export function StatusBadge({ item, mini }: { item: Pick<InputItem, "status" | "estimated">; mini?: boolean }) {
  if (item.status === "empty") return null;
  return <span class={`ih-st ${item.status}${mini === true ? " mini" : ""}`}>{mini === true ? STATUS_TEXT[item.status] : statusText(item)}</span>;
}
