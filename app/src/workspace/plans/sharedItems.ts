// どのプランにも共通の項目（表の最後の年。0043 の追記 2026-11-05）の、前の版で作ったプランの差分を読むときに外す（世帯ファイルの形は変えない）。
// 前の画面では、プランを直している間に表の最後の年を変えると、そのプランの差分（set。当て先は要求の入力の plan.endYear）になっていた。
// 表の最後の年は世帯で1つにしたので、そのプランの表も現状の表の最後の年で終わる（plans.ts の applyDiffs は当てない）。黙って捨てないよう:
// - プランの差分のうち、表の最後の年を変える差分（と、人の年齢で入れる欄の合成の対策 endYearAge）を外す
// - 外したプランがあれば、開いたときの知らせ planEndYearShared（プランの数・名前・そのプランで入れていた年・現状の表の最後の年）を足す（同じ中身なら同じ ID。
//   保存した後は差分が無いので足さない）。控え（snapshots）の中身は変えない（作った後は変えない。0009 の2）
import type { WorkingHousehold } from "../input/household.ts";
import { migrationId } from "../store/readings.ts";
import { isSharedDiff, type PlanDiff } from "./diffs.ts";

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);

/** 差分の値の年（値の箱の value。読めなければ null） */
const yearOf = (d: PlanDiff): number | null => (isObj(d.value) && typeof d.value.value === "number" ? d.value.value : null);

/** 前の版で作った、表の最後の年を変えるプランの差分を外した世帯（外す物が無ければ同じ世帯） */
export function withoutSharedPlanDiffs(wh: WorkingHousehold): WorkingHousehold {
  if (!wh.proposals.some((p) => p.diffs.some(isSharedDiff))) return wh;
  const names: string[] = [];
  const years: number[] = [];
  const proposals = wh.proposals.map((p) => {
    const gone = p.diffs.filter(isSharedDiff);
    if (gone.length === 0) return p;
    names.push(p.name);
    const y = gone.map(yearOf).find((x) => x !== null);
    if (y !== undefined && y !== null) years.push(y);
    return { ...p, diffs: p.diffs.filter((d) => !isSharedDiff(d)) };
  });
  const id = migrationId(`notices/planEndYearShared/${names.join("/")}`);
  const fresh = !(wh.notices ?? []).some((x) => x.id === id);
  const notices = fresh ? [...(wh.notices ?? []), { id, kind: "planEndYearShared", plans: names.length, names, years, endYear: wh.request.input.endYear }] : wh.notices;
  return { ...wh, proposals, ...(notices !== undefined ? { notices } : {}) };
}
