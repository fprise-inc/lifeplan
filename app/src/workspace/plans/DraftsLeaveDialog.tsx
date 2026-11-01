// 世帯を切り替える・アプリを閉じる前の確かめ（中央のパネル。0096 の追記）: プランに保存していない変更（結果のタブで動かした値）があるとき。
// 黙って捨てずに、上書き保存して離れる・変更を捨てて離れる・やめるを選ばせる（保存できていないときの確かめ・帯から外す前の確かめと同じ形）
import { ChoicePanel, type Choice } from "../ChoicePanel.tsx";

export type DraftsLeaveChoice = "overwrite" | "discard" | "cancel";

export function DraftsLeaveDialog(p: { names: readonly string[]; action: "switch" | "close"; onChoose: (c: DraftsLeaveChoice) => void }) {
  const verb = p.action === "close" ? "閉じる" : "切り替える";
  const plans = p.names.join("・");
  const choices: Choice<DraftsLeaveChoice>[] = [
    { key: "overwrite", label: `上書き保存して${verb}`, note: `動かした値で${plans}を上書きしてから${p.action === "close" ? "閉じます" : "切り替えます"}`, primary: true },
    { key: "discard", label: `変更を捨てて${verb}`, note: "プランは保存した中身のまま残ります" },
    { key: "cancel", label: "やめる", note: "この世帯を開いたままにします" },
  ];
  return (
    <ChoicePanel name="drafts-leave" title={`${plans} に保存していない変更があります`} choices={choices} cancel="cancel" onChoose={p.onChoose}>
      <p>結果のタブで動かした値（保存していない変更）は、世帯には保存されません。このまま{verb}と、なくなります。</p>
    </ChoicePanel>
  );
}
