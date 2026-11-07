// カードの状態の印（色だけで区別しない: ✓／!／0／−／＝ の印と文字を必ず付ける）。まだ入れていない項目には札を出さない（カードは「まだ入っていません」の文で見せる）
import type { InputItem, ItemStatus } from "./items.ts";

export const STATUS_TEXT: Record<ItemStatus, string> = { done: "入力済み", est: "推定で計算中", missing: "未入力（0円の所あり）", na: "該当なし", empty: "まだ入れていない", std: "既定の値で計算中" };

/**
 * パネルの見出しの札の文: 推定で計算中は欄の数を「か所」で添える（保存の下の「推定・仮の値のままの欄: ○か所」と同じ数。0041 の追記 2026-11-06）。
 * パネルで見えている推定の数（shown。「推定のままの値を『この値にする』（見えている ○か所）」と同じ数）が全体より少なければ、
 * 「推定で計算中（見えている 8か所・詳細を含め 34か所）」と2つの数を書く（通しの確かめ。0150。帯の数と見出しの数が食い違って見えないように）
 */
export function statusText(item: Pick<InputItem, "status" | "estimated">, shown?: number): string {
  if (item.status !== "est") return STATUS_TEXT[item.status];
  return shown !== undefined && shown < item.estimated ? `推定で計算中（見えている ${shown}か所・詳細を含め ${item.estimated}か所）` : `推定で計算中（${item.estimated}か所）`;
}

export function StatusBadge({ item, mini, shown }: { item: Pick<InputItem, "status" | "estimated">; mini?: boolean; shown?: number }) {
  if (item.status === "empty") return null;
  return <span class={`ih-st ${item.status}${mini === true ? " mini" : ""}`}>{mini === true ? STATUS_TEXT[item.status] : statusText(item, shown)}</span>;
}
