// カードの状態の印（色だけで区別しない: ✓／!／点線の丸の印と文字を必ず付ける）
import type { InputItem, ItemStatus } from "./items.ts";

export const STATUS_TEXT: Record<ItemStatus, string> = { done: "入力済み", est: "推定あり", none: "未入力" };

export function statusText(item: Pick<InputItem, "status" | "estimated">): string {
  return item.status === "est" ? `推定あり（${item.estimated}項目）` : STATUS_TEXT[item.status];
}

export function StatusBadge({ item, mini }: { item: Pick<InputItem, "status" | "estimated">; mini?: boolean }) {
  return <span class={`ih-st ${item.status}${mini === true ? " mini" : ""}`}>{statusText(item)}</span>;
}
