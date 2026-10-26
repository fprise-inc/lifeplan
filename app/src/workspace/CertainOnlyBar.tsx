// 確実な分だけで見る（0044・0036 の6）: 見込みが「不確か」の入るお金の行と、優先度が「希望」「夢」の出るお金の行を外した要求で、
// 結果のタブの全部のプランを計算し直して見る切り替え。保存しない（プランの差分にしない）。外す行が無い世帯では出さない
import type { EngineRequest } from "../engine/types.ts";
import { certainOnlyCounts } from "../engine/moneyRows.ts";

export function CertainOnlyBar({ req, on, onToggle }: { req: EngineRequest; on: boolean; onToggle: (on: boolean) => void }) {
  const c = certainOnlyCounts(req);
  if (!on && c.incomes === 0 && c.expenses === 0) return null;
  const parts = [...(c.incomes > 0 ? [`見込みが不確かな入るお金 ${c.incomes}件`] : []), ...(c.expenses > 0 ? [`優先度が希望・夢の出るお金 ${c.expenses}件`] : [])];
  return (
    <div class={`certain-bar${on ? " on" : ""}`} data-certain-only>
      <label>
        <input type="checkbox" checked={on} onChange={(e) => onToggle((e.currentTarget as HTMLInputElement).checked)} data-certain-toggle />
        確実な分だけで見る
      </label>
      <span class="certain-note">{on ? `${parts.join("・")}を外して計算しています（保存はしません）` : `${parts.join("・")}を外して見られます`}</span>
    </div>
  );
}
