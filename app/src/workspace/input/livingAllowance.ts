// 基本生活費の内訳の仕送りをなくした後の、前の世帯の仕送り（読むときに使う。0106。世帯ファイルの形は変えない）。
// 仕送りは子ども・教育（子の在学中の自宅外の仕送り）・家族（離れて暮らす子）・介護・親（親への仕送り）の入力項目で入れるので、内訳の並びから外した。
// 前の世帯の仕送り（内訳 allowance）に値があるときは、値を書き換えずに「仕送り（前の内訳）」として内訳の最後に出し、そのまま計算する（結果は変わらない）。
// その他に足し込まないのは、FP が仕送りをほかの入力項目に移したときに、その他から引き忘れると二重に数えるため（欄を空にすれば消える）。
// - 内訳で入れている基本生活費に、値のある仕送りがあれば、開いたときの知らせ livingAllowance（数・月額の合計）を足す（同じ数と額なら同じ ID）
import type { WorkingHousehold } from "./household.ts";
import { migrationId } from "../store/readings.ts";

/** 内訳で入れている基本生活費の、前の内訳の仕送りの月額（値のある物だけ） */
export function legacyAllowances(wh: WorkingHousehold): number[] {
  return (wh.request.input.household.livingExpenses ?? [])
    .filter((l) => l.mode === "byCategory")
    .map((l) => (l.categories ?? []).find((c) => c.category === "allowance")?.monthly.value ?? 0)
    .filter((v) => v > 0);
}

/** 前の内訳の仕送りがあれば、開いたときの知らせを足した世帯（無ければ同じ世帯） */
export function withLegacyAllowanceNotice(wh: WorkingHousehold): WorkingHousehold {
  const list = legacyAllowances(wh);
  if (list.length === 0) return wh;
  const amount = list.reduce((s, v) => s + v, 0);
  const id = migrationId(`notices/livingAllowance/${list.length}/${amount}`);
  if ((wh.notices ?? []).some((x) => x.id === id)) return wh;
  return { ...wh, notices: [...(wh.notices ?? []), { id, kind: "livingAllowance", count: list.length, amount }] };
}
