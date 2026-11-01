// 結果の見方の一覧（0044 の追記。保存しない）: 「すべて入れる｜確実な分だけ」と物ごとの入れ外しで、入れ外しできる物の名前・額・時期と、
// 今の見方で外しているかを並べる。物は選んでいるプランと現状の世帯の両方から集める（同じ物は選んでいるプランの方を見せる）。
// 夢プランの1件は理由「夢」、子への援助の「できれば」は理由「できれば」で並ぶ（0103）
import type { Household } from "../engine/types.ts";
import { viewCandidates, viewExcluded, type RowsView, type ViewCandidate } from "../engine/moneyRows.ts";
import { debtParts, expenseName, incomeName, rowParts } from "./input/moneyRows.ts";
import { resolveTimepoint } from "./timepoint.ts";

export interface ViewRow extends ViewCandidate {
  name: string;
  amount: string;
  when: string;
  /** 外れる理由の札（「当てにしない」「できれば」「基本の計算に入れない」「夢」） */
  tag: string;
  /** 今の見方で外しているか */
  excluded: boolean;
}

const TAG: Record<ViewCandidate["reason"], string> = { base: "基本の計算に入れない", uncertain: "当てにしない", priority: "できれば", dream: "夢" };

const GIFT_PURPOSE: Record<string, string> = { wedding: "結婚資金", housing: "住宅資金", other: "援助" };

/** 子への援助の名前と額・時期（「第1子への援助（結婚資金）」） */
function giftParts(h: Household, id: string): { name: string; amount: string; when: string } | null {
  const kids = h.members.filter((m) => m.kind === "child" && m.outside === undefined).sort((a, b) => a.birth.birthYearMonth.localeCompare(b.birth.birthYearMonth));
  for (const g of h.goals ?? []) {
    const gift = (g.education?.gifts ?? []).find((x) => x.id === id);
    if (gift === undefined) continue;
    const n = kids.findIndex((m) => m.id === g.owner);
    const ym = resolveTimepoint(h, gift.at);
    const v = gift.amount;
    return {
      name: `${n >= 0 ? `第${String(n + 1)}子` : "子"}への援助（${GIFT_PURPOSE[gift.purpose] ?? "援助"}）`,
      amount: `${v >= 10000 && v % 1000 === 0 ? `${(v / 10000).toLocaleString("ja-JP", { maximumFractionDigits: 1 })}万円` : `${v.toLocaleString("ja-JP")}円`}・1回`,
      when: ym === null ? "" : `${String(Number(ym.slice(0, 4)))}年${String(Number(ym.slice(5, 7)))}月`,
    };
  }
  return null;
}

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
        if (c.side === "gift") return giftParts(h, c.id);
        const d = (h.debts ?? []).find((x) => x.id === c.id);
        return d === undefined ? null : { name: d.label !== undefined && d.label !== "" ? d.label : "相続で受け継ぐ借金", ...debtParts(h, d) };
      })();
      if (parts === null) continue;
      out.push({ ...c, ...parts, tag: TAG[c.reason], excluded: viewExcluded(c, v) });
    }
  }
  return out;
}
