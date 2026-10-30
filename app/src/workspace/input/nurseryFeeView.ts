// 子ども・教育のカードの「保育料（自動計算の目安）」（0029 の追記 2026-10-30。計算の結果を読むだけ）: 保育料の月額を入れていない保育園（2歳まで）の段の、
// 年ごとの保育料（計算エンジンの education.nurseryFee の自動の計算。国の基準×保育料の水準・多子・ひとり親・住民税の年度）を、月の平均の額で見せる。
// 世帯の物は変えない。計算の道が無い所（画面の確かめなど）では出さない
import { useEffect, useMemo, useState } from "preact/hooks";
import type { EngineRequest, PreviewResult } from "../../engine/types.ts";
import { addMonths } from "../levers.ts";
import { resolveTimepoint } from "../timepoint.ts";
import type { WorkingHousehold } from "./household.ts";
import { memberLabel } from "./labels.ts";
import { manText } from "./educationCost.ts";
import { nurseryDefaultStart, nurseryFreeMonth } from "./stages/education.ts";

export interface NurseryFeeLine {
  child: string;
  /** 例: 「第3子: 2027年 月平均2.4万円・2028年 月平均2.9万円」 */
  text: string;
}

/** 計算の結果から、保育料を自動で計算している段の年ごとの月の平均 */
export function nurseryFeeLines(wh: WorkingHousehold, r: PreviewResult | null): NurseryFeeLine[] {
  if (r === null) return [];
  const h = wh.request.input.household;
  const base = wh.request.input.baseMonth;
  const out: NurseryFeeLine[] = [];
  for (const g of h.goals ?? []) {
    if (g.kind !== "education") continue;
    const st = (g.education?.stages ?? []).find((s) => s.stage === "nursery");
    const child = h.members.find((m) => m.id === g.owner);
    if (st === undefined || st.monthly !== undefined || child === undefined) continue;
    const free = nurseryFreeMonth(child);
    const start = (st.from !== undefined ? resolveTimepoint(h, st.from) : null) ?? nurseryDefaultStart(h, child).ym;
    if (free === null) continue;
    const months = new Map<number, number>();
    for (let m = start < base ? base : start; m < free; m = addMonths(m, 1)) months.set(Number(m.slice(0, 4)), (months.get(Number(m.slice(0, 4))) ?? 0) + 1);
    const parts: string[] = [];
    for (const [y, n] of [...months.entries()].sort((a, b) => a[0] - b[0])) {
      const sum = r.table.filter((c) => c.row === "cf.expense.education.nursery" && c.object === g.id && c.year === y).reduce((a, c) => a + c.amount, 0);
      parts.push(`${y}年 ${sum === 0 ? "0円" : `月平均${manText(Math.round(sum / n))}`}`);
    }
    if (parts.length > 0) out.push({ child: child.id, text: `${memberLabel(wh, child.id)}: ${parts.join("・")}` });
  }
  return out;
}

/** 保育料の自動の計算の結果（子ども・教育のカードを開いているときだけ。世帯が変わったら計算し直す） */
export function useNurseryFee(wh: WorkingHousehold, active: boolean, computeOne: ((req: EngineRequest) => Promise<PreviewResult | null>) | undefined): NurseryFeeLine[] {
  const wanted = useMemo(() => active && computeOne !== undefined && (wh.request.input.household.goals ?? []).some((g) => (g.education?.stages ?? []).some((s) => s.stage === "nursery" && s.monthly === undefined)), [active, computeOne, wh]);
  const [lines, setLines] = useState<NurseryFeeLine[]>([]);
  useEffect(() => {
    if (!wanted || computeOne === undefined) return;
    let alive = true;
    const req = structuredClone(wh.request);
    req.trace = "none";
    void computeOne(req)
      .catch(() => null)
      .then((r) => {
        if (alive) setLines(nurseryFeeLines(wh, r));
      });
    return () => {
      alive = false;
    };
  }, [wanted, computeOne, wh]);
  return wanted ? lines : [];
}
