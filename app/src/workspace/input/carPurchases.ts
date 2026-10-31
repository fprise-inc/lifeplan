// 車の購入の年月（0101）: 計算エンジンの車の部品と同じ決まり（SDK の carPurchaseMonths）で、入力から読む。
// 車の一生の費用（車の入力項目の見出し）と、この世帯の予定（ライフイベントの入力項目）が使う
import { carPurchaseMonths, type CarReplaceRule } from "../../../../engine/src/sdk/cars.ts";
import type { Car, Household } from "../../engine/types.ts";
import { monthIndex, monthText, resolveTimepoint } from "../timepoint.ts";

/** 車の買い替えの決まりを、年月を解いた形にする（「○歳まで」が解けなければ買い替え続けると同じ） */
export function carReplaceRule(h: Pick<Household, "members" | "events">, c: Car): CarReplaceRule {
  const r = c.purchase?.replace;
  if (r === undefined || r.kind === "repeat") return "repeat";
  if (r.kind === "none") return "none";
  const last = resolveTimepoint(h, r.until);
  return last === null ? "repeat" : { lastAt: monthIndex(last) };
}

/**
 * 車の購入の年月（古い順。計算基準月より前も含む）。手放す月には買わない。表の最後の月（endYm）より後は数えない。
 * 買う車でない（リース）・最初の購入の時期が解けないときは空
 */
export function carPurchaseYms(h: Pick<Household, "members" | "events">, c: Car, endYm: string): string[] {
  const p = c.purchase;
  if (p === undefined) return [];
  const first = resolveTimepoint(h, p.first);
  if (first === null) return [];
  const release = c.until == null ? null : resolveTimepoint(h, c.until);
  return carPurchaseMonths({
    first: monthIndex(first),
    everyYears: p.everyYears,
    owned: p.owned === true,
    release: release === null ? null : monthIndex(release),
    end: monthIndex(endYm),
    replace: carReplaceRule(h, c),
  }).map((m) => monthText(m));
}
