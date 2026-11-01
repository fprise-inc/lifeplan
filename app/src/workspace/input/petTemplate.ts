// 「＋ 項目を追加」のペット（えさ・医療・保険の年18万円）をやめた後の、前の世帯のペットの行（読むときに使う。0106 の追記。世帯ファイルの形は変えない）。
// えさ・用品・ペット保険は基本生活費の「趣味・娯楽」（目安にもえさ・用品が入っている）、動物病院の費用は「年1回・数年に1回の支出」の「ペットの病気・けが」で入れる。
// 前に足したペットの行は、名前・額・期間を書き換えずにそのまま読み、計算にも使う（結果は変わらない）。消したり額を変えたりはしない。
// - 前のひな形で足した行（ピンの絵が pet の物）があれば、開いたときの知らせ petTemplate（行の数）を足す（同じ数なら同じ ID。既読は手元に残る）
import type { WorkingHousehold } from "./household.ts";
import { migrationId } from "../store/readings.ts";

/** 前のひな形「ペット」で足した行の ID（ピンの絵が pet で、行がまだある物） */
export function legacyPetRows(wh: WorkingHousehold): string[] {
  const rows = new Set((wh.request.input.household.periodicExpenses ?? []).map((p) => p.id));
  return [...new Set(wh.addedItems.filter((a) => a.art === "pet" && rows.has(a.ref)).map((a) => a.ref))];
}

/** 前のひな形のペットの行があれば、開いたときの知らせを足した世帯（無ければ同じ世帯） */
export function withLegacyPetNotice(wh: WorkingHousehold): WorkingHousehold {
  const count = legacyPetRows(wh).length;
  if (count === 0) return wh;
  const id = migrationId(`notices/petTemplate/${count}`);
  if ((wh.notices ?? []).some((x) => x.id === id)) return wh;
  return { ...wh, notices: [...(wh.notices ?? []), { id, kind: "petTemplate", count }] };
}
