// 構成員の呼び方（顧客の名前は持たない・出さない。0012）: ご本人・配偶者・第1子・第2子・離れて暮らす子 など
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
  /** 世帯に加わる月（結婚の予定・これから生まれる子など。年齢・出来事で決めた時点も解いた年月）。最初からいる人は null */
  joins: string | null;
}

export function roles(req: EngineRequest): Role[] {
  const h = req.input.household;
  return rolesOf(req).map((r) => ({ ...r, leaves: resolveTimepoint(h, r.member.leaves), joins: resolveTimepoint(h, r.member.joins) }));
}

function rolesOf(req: EngineRequest): Omit<Role, "leaves" | "joins">[] {
  const ms = req.input.household.members;
  const self = ms.find((m) => m.kind === "self");
  const spouse = ms.find((m) => m.kind === "spouse");
  const out: Omit<Role, "leaves" | "joins">[] = [];
  if (self !== undefined) out.push({ key: "self", label: "ご本人", member: self });
  if (spouse !== undefined) out.push({ key: "spouse", label: "配偶者", member: spouse });
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

/**
 * その年に世帯にいるか（年齢を出すか）: 生まれていて、加わる年より後でなく、抜ける年より前でない。
 * 加わる年・抜ける年は、月が年の途中でもその年を含める（年齢は各年12月末の年齢）。結婚の予定の配偶者は加わる年から出す
 */
export function presentInYear(r: Role, y: number): boolean {
  const leave = leaveYear(r);
  const join = r.joins === null ? null : parseYm(r.joins).y;
  return ageInYear(r.member, y) >= 0 && (join === null || y >= join) && (leave === null || y <= leave);
}
