// 構成員の呼び方（顧客の名前は持たない・出さない。0012）: ご主人・奥様・長男・長女 など
import type { EngineRequest, Member } from "../engine/types.ts";
import { parseYm } from "./levers.ts";

export interface Role {
  /** 提示用の鍵（物の ID を提示層に渡さないため）: self・spouse・child1 … */
  key: string;
  label: string;
  member: Member;
}

const ORDINAL_SON = ["長男", "次男", "三男", "四男", "五男"];
const ORDINAL_DAUGHTER = ["長女", "次女", "三女", "四女", "五女"];

export function roles(req: EngineRequest): Role[] {
  const ms = req.input.household.members;
  const self = ms.find((m) => m.kind === "self");
  const spouse = ms.find((m) => m.kind === "spouse");
  const out: Role[] = [];
  const coupleLabel = (m: Member) => (m.sex === "female" ? "奥様" : "ご主人");
  if (self !== undefined) out.push({ key: "self", label: spouse !== undefined ? coupleLabel(self) : "ご本人", member: self });
  if (spouse !== undefined) out.push({ key: "spouse", label: coupleLabel(spouse), member: spouse });
  const children = ms.filter((m) => m.kind === "child").sort((a, b) => (a.birth.birthYearMonth < b.birth.birthYearMonth ? -1 : 1));
  let sons = 0;
  let daughters = 0;
  children.forEach((m, i) => {
    const label = m.sex === "female" ? (ORDINAL_DAUGHTER[daughters++] ?? "お子さま") : (ORDINAL_SON[sons++] ?? "お子さま");
    out.push({ key: `child${i + 1}`, label, member: m });
  });
  ms.filter((m) => m.kind !== "self" && m.kind !== "spouse" && m.kind !== "child").forEach((m, i) => out.push({ key: `other${i + 1}`, label: "ご家族", member: m }));
  return out;
}

/** 各年12月末時点の年齢 */
export function ageInYear(m: Member, year: number): number {
  return year - parseYm(m.birth.birthYearMonth).y;
}

/** 世帯から抜ける年（独立など）。抜けない人は null */
export function leaveYear(m: Member): number | null {
  const at = m.leaves?.at;
  return at === undefined ? null : parseYm(at).y;
}
