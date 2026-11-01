// プランの帯から外す前の確かめ（中央のパネル。0096 の追記）: 外すプランに保存していない変更（結果のタブで動かした値）があるとき。
// 黙って捨てずに、上書き保存して外す・変更を捨てて外す・やめるを選ばせる（世帯を離れる前の確かめと同じ形。ChoicePanel）
import { ChoicePanel, type Choice } from "../ChoicePanel.tsx";
import type { UnsavedRemoval } from "./band.ts";
import { planLabel } from "./plans.ts";

export type BandDropChoice = "overwrite" | "discard" | "cancel";

export function BandDropDialog(p: { removal: UnsavedRemoval; onChoose: (c: BandDropChoice) => void }) {
  const r = p.removal;
  const name = planLabel(r.letter);
  const hide = r.mode === "hide";
  const choices: Choice<BandDropChoice>[] = hide
    ? [
        { key: "overwrite", label: "上書き保存して外す", note: `動かした値で${name}を上書きしてから、帯から外します`, primary: true },
        { key: "discard", label: "変更を捨てて外す", note: `${name}は保存した中身のまま一覧に残ります（元に戻す（↶）で戻せます）` },
        { key: "cancel", label: "やめる", note: "帯に残します" },
      ]
    : [
        ...(r.heirs.length > 0 ? [{ key: "overwrite" as const, label: "上書き保存してから外す", note: `${r.heirs.join("・")} は上書きした中身を引き継ぎます` }] : []),
        { key: "discard", label: "変更ごと外す", note: "元に戻す（↶）で戻せます", primary: r.heirs.length === 0 },
        { key: "cancel", label: "やめる", note: "帯に残します" },
      ];
  return (
    <ChoicePanel name="band-drop" title={`${name} に保存していない変更があります`} choices={choices} cancel="cancel" onChoose={p.onChoose}>
      <p>
        {hide
          ? `帯から外すと、結果のタブで動かした値（保存していない変更）はなくなります。${name}そのものは一覧に残ります。`
          : `${name}を外すと一覧からもなくなり、結果のタブで動かした値（保存していない変更）もなくなります。`}
      </p>
    </ChoicePanel>
  );
}
