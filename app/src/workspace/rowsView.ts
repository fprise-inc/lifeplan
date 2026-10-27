// 結果の見方の一覧（0044 の追記。保存しない）: 「すべて入れる｜確実な分だけ」と物ごとの入れ外しで、入れ外しできる物の名前・額・時期と、
// 今の見方で外しているかを並べる。物は選んでいるプランと現状の世帯の両方から集める（同じ物は選んでいるプランの方を見せる）
import type { Household } from "../engine/types.ts";
import { viewCandidates, viewExcluded, type RowsView, type ViewCandidate } from "../engine/moneyRows.ts";
import { debtParts, expenseName, incomeName, rowParts } from "./input/moneyRows.ts";

export interface ViewRow extends ViewCandidate {
  name: string;
  amount: string;
  when: string;
  /** 外れる理由の札（「当てにしない」「できれば」「基本の計算に入れない」） */
  tag: string;
  /** 今の見方で外しているか */
  excluded: boolean;
}

const TAG: Record<ViewCandidate["reason"], string> = { base: "基本の計算に入れない", uncertain: "当てにしない", priority: "できれば" };

/** 入れ外しできる物の一覧（households は見せる順。前の世帯にある物を優先する） */
export function viewRows(households: readonly Household[], v: RowsView): ViewRow[] {
  const seen = new Set<string>();
  const out: ViewRow[] = [];
  for (const h of households) {
    for (const c of viewCandidates(h)) {
      if (seen.has(c.key)) continue;
      seen.add(c.key);
      const parts = (() => {
        if (c.side === "in") {
          const f = (h.incomeFlows ?? []).find((x) => x.id === c.id);
          return f === undefined ? null : { name: incomeName(f), ...rowParts(h, f) };
        }
        if (c.side === "out") {
          const p = (h.periodicExpenses ?? []).find((x) => x.id === c.id);
          return p === undefined ? null : { name: expenseName(h, p), ...rowParts(h, p) };
        }
        const d = (h.debts ?? []).find((x) => x.id === c.id);
        return d === undefined ? null : { name: d.label !== undefined && d.label !== "" ? d.label : "相続で受け継ぐ借金", ...debtParts(h, d) };
      })();
      if (parts === null) continue;
      out.push({ ...c, ...parts, tag: TAG[c.reason], excluded: viewExcluded(c, v) });
    }
  }
  return out;
}
