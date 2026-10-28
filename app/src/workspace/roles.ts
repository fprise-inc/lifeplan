// 構成員の呼び方（顧客の名前は持たない・出さない。0012）: ご主人・奥様・第1子・第2子・離れて暮らす子 など
import type { EngineRequest, Member } from "../engine/types.ts";
import { parseYm } from "./levers.ts";
import { resolveTimepoint } from "./timepoint.ts";

export interface Role {
  /** 提示用の鍵（物の ID を提示層に渡さないため）: self・spouse・child1 … */
  key: string;
  label: string;
  member: Member;
  /** 世帯から抜ける月（独立など。年齢・出来事で決めた時点も解いた年月）。抜けない人は null */
  leaves: string | null;
}

export function roles(req: EngineRequest): Role[] {
  const h = req.input.household;
  return rolesOf(req).map((r) => ({ ...r, leaves: resolveTimepoint(h, r.member.leaves) }));
}

function rolesOf(req: EngineRequest): Omit<Role, "leaves">[] {
  const ms = req.input.household.members;
  const self = ms.find((m) => m.kind === "self");
  const spouse = ms.find((m) => m.kind === "spouse");
  const out: Omit<Role, "leaves">[] = [];
  const coupleLabel = (m: Member) => (m.sex === "female" ? "奥様" : "ご主人");
  if (self !== undefined) out.push({ key: "self", label: spouse !== undefined ? coupleLabel(self) : "ご本人", member: self });
  if (spouse !== undefined) out.push({ key: "spouse", label: coupleLabel(spouse), member: spouse });
  const children = ms.filter((m) => m.kind === "child").sort((a, b) => (a.birth.birthYearMonth < b.birth.birthYearMonth ? -1 : 1));
  // 子は性別によらず生まれた順に呼ぶ（予定の子も同じ。性別は計算に使わないので聞かない。0046 の追記 2026-10-27）。
  // 番号は世帯の中の子（一緒に暮らす子）だけで「第1子」「第2子」…。世帯の外の子は「離れて暮らす子」（2人以上なら生まれた順に「離れて暮らす子1」…）。
  // 鍵（child1 …）は世帯の外の子も含めた生まれた順のまま（0046 の追記 2026-10-28）
  const apart = children.filter((m) => m.outside !== undefined);
  let inside = 0;
  children.forEach((m, i) => {
    const label = m.outside !== undefined ? (apart.length > 1 ? `離れて暮らす子${apart.indexOf(m) + 1}` : "離れて暮らす子") : `第${++inside}子`;
    out.push({ key: `child${i + 1}`, label, member: m });
  });
  ms.filter((m) => m.kind !== "self" && m.kind !== "spouse" && m.kind !== "child").forEach((m, i) => out.push({ key: `other${i + 1}`, label: "ご家族", member: m }));
  return out;
}

/** 各年12月末時点の年齢 */
export function ageInYear(m: Member, year: number): number {
  return year - parseYm(m.birth.birthYearMonth).y;
}

/** 世帯から抜ける年（独立など）。抜けない人は null。年齢・出来事で決めた時点も解く（構成員だけを渡すと、本人の年齢と年月の形だけ解く） */
export function leaveYear(r: Role | Member): number | null {
  const at = "member" in r ? r.leaves : resolveTimepoint({ members: [r], events: [] }, r.leaves);
  return at === null ? null : parseYm(at).y;
}
