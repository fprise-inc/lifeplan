// 世帯を切り替える・アプリを閉じる前の、プランの保存していない変更（結果のタブで動かした値。0096 の追記）。
// 保存していない変更は世帯ファイルに入らないので、離れると消える。黙って捨てずに、上書き保存する・捨てる・やめるを選ばせる
import type { WorkingHousehold } from "../input/household.ts";
import { CURRENT, planLetters } from "./band.ts";
import type { Catalog } from "./items.ts";
import { overwritePlan, planLabel, type Values } from "./plans.ts";

/** 保存していない変更があるプランの名前（プランの一覧の順。例: プランB）。無ければ空で、聞かずに離れる */
export function unsavedPlanNames(wh: WorkingHousehold, modified: ReadonlySet<string>): string[] {
  const ls = planLetters(wh.proposals);
  return wh.proposals.filter((p) => p.id !== CURRENT && modified.has(p.id)).map((p) => planLabel(ls.get(p.id)?.letter ?? ""));
}

/**
 * 上書き保存して離れる: ids のプランを、それぞれの保存していない変更（drafts）で上書きし、その変更を空にする。
 * 元にしたプラン（土台）から先に上書きする（子のプランの差分は土台の上に作るので、土台を後で変えると子の中身がずれる）
 */
export function overwriteDrafts(wh: WorkingHousehold, cat: Catalog, drafts: Readonly<Record<string, Values>>, ids: readonly string[], now: string): { wh: WorkingHousehold; drafts: Record<string, Values> } {
  const byId = new Map(wh.proposals.map((p) => [p.id, p]));
  const depth = (id: string): number => {
    let n = 0;
    const seen = new Set<string>();
    for (let b = byId.get(id)?.base ?? null; b !== null && !seen.has(b); b = byId.get(b)?.base ?? null) {
      seen.add(b);
      n += 1;
    }
    return n;
  };
  const order = ids.filter((id) => drafts[id] !== undefined && byId.has(id)).sort((a, b) => depth(a) - depth(b));
  let out = wh;
  for (const id of order) out = overwritePlan(out, cat, id, drafts[id] as Values, now);
  const rest: Record<string, Values> = {};
  for (const [id, v] of Object.entries(drafts)) if (!order.includes(id)) rest[id] = v;
  return { wh: out, drafts: rest };
}
