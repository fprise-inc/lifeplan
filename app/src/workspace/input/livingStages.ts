// 基本生活費の人数の数え方と、推定の段階（人数の変化と年齢から作る段。0049）。
// - 人数は「その月に世帯で暮らしている人」: 生まれている（予定の子は生まれた月から）・加わっている・離れていない・大学などの自宅外の在学の間でない・
//   施設の介護に入っていない。世帯の外の家族は、家計を1つにする期間で「生活費の人数に入れる」ときだけ数える（0035 の4）
// - 推定の段階: 人数の目安（家計調査の世帯人員別）が変わる月と、本人の退職・70歳・80歳に段を作る。割合はその月の目安÷今の目安
// - 段は推定（値の状態の行。出し方 derived）で入れ、元の入力が変わったら推定のままの段だけ入れ直す。FP が直した欄はその段のその欄だけ確定にする。
//   FP が外した推定の段は「該当なし」の行で覚えて、入れ直しで足し直さない
// - 新しい世帯は最初から入れる（household.ts の blankHousehold）。古い世帯は、FP が「推定で入れる」を押したときだけ（黙って書き換えない。0035 の11）
import type { Box, Household, LivingExpense, Member, Timepoint } from "../../engine/types.ts";
import { addMonths, ageAt, ageReachedMonth, derivedId, parseYm } from "../levers.ts";
import { schoolEntryYear } from "../present.ts";
import { resolveTimepoint } from "../timepoint.ts";
import { livingEstimate as livingBySize, livingStatistic } from "../../../../hearing/src/estimates.ts";
import { putRow, rowAt, type StateRow } from "./rows.ts";

type Obj = Record<string, unknown>;
type Stage = NonNullable<LivingExpense["stages"]>[number] & { id?: string };

/** 推定の段の根拠の文の頭（この頭の行を、推定の段の印として読む） */
export const AUTO_STAGE_BASIS = "推定の段階";
const AUTO_METHOD = "derived";

/** 退職・年齢の目安の水準（今の額を1とする。家計調査の世帯主の年齢階級別の比で確かめる前の目安） */
const AGE_LEVELS = { retired: 0.8, age70: 0.75, age80: 0.7 } as const;
export const AGE_LEVEL_BASIS = "退職後80%・70歳から75%・80歳から70%の目安（年齢階級別の統計で確かめる前）";

// ---- 人数の数え方 ----

const higherYears = (s: { stage: string; field?: string; years?: number }): number => s.years ?? (s.stage === "university" ? (s.field === "medical" ? 6 : 4) : 2);

/** 大学などの自宅外の在学の期間（始まりの月・終わりの次の月）。子ごと */
export function awayPeriods(h: Household): { goal: string; member: string; from: string; until: string }[] {
  const out: { goal: string; member: string; from: string; until: string }[] = [];
  for (const g of h.goals ?? []) {
    if (g.kind !== "education" || g.education === undefined) continue;
    const child = h.members.find((m) => m.id === g.owner);
    if (child === undefined) continue;
    for (const s of g.education.stages) {
      if ((s.stage !== "university" && s.stage !== "juniorCollege" && s.stage !== "vocational") || s.living !== "away") continue;
      const entry = schoolEntryYear(child.birth.birthYearMonth, child.birth.bornOnFirst, "university");
      if (entry === null) continue;
      const y = entry + (s.delayYears ?? 0);
      out.push({ goal: g.id, member: child.id, from: `${y}-04`, until: `${y + higherYears(s)}-04` });
    }
  }
  return out;
}

/** 施設の介護の始まり（その月から生活費の人数から外す）。在宅は外さない */
export function facilityStarts(h: Household): { care: string; member: string; from: string; until: string | null }[] {
  const out: { care: string; member: string; from: string; until: string | null }[] = [];
  for (const c of h.careExpenses ?? []) {
    if (c.place !== "facility") continue;
    const from = resolveTimepoint(h, c.from);
    if (from === null) continue;
    out.push({ care: c.id, member: c.member, from, until: c.months !== undefined ? addMonths(from, c.months) : null });
  }
  return out;
}

/**
 * その月に世帯で暮らしている人の数（生活費の人数）。now は計算基準月の数え方（予定の子は数えない）
 */
export function countAt(h: Household, month: string, o: { now?: boolean } = {}): number {
  const away = awayPeriods(h);
  const care = facilityStarts(h);
  return h.members.filter((m) => inHouseholdAt(h, m, month, o.now === true, away, care)).length;
}

function inHouseholdAt(h: Household, m: Member, month: string, now: boolean, away: ReturnType<typeof awayPeriods>, care: ReturnType<typeof facilityStarts>): boolean {
  if (now && m.expected === true) return false;
  if (m.birth.birthYearMonth > month) return false;
  const joins = resolveTimepoint(h, m.joins);
  if (joins !== null && joins > month) return false;
  const leaves = resolveTimepoint(h, m.leaves);
  if (leaves !== null && leaves <= month) return false;
  if (away.some((a) => a.member === m.id && a.from <= month && month < a.until)) return false;
  if (care.some((c) => c.member === m.id && c.from <= month && (c.until === null || month < c.until))) return false;
  if (m.outside === undefined) return true;
  return (m.outside.periods ?? []).some((p) => {
    const from = resolveTimepoint(h, p.from);
    const to = resolveTimepoint(h, p.to);
    return (from === null || from <= month) && (to === null || to >= month) && p.living !== false;
  });
}

// ---- 推定の段階 ----

/** 推定の段1つ（理由・時点・割合） */
export interface AutoStage {
  id: string;
  /** 理由の鍵（id の元。画面の見出しを作るのに使う） */
  reasons: string[];
  at: Timepoint;
  /** 解いた年月 */
  ym: string;
  ratio: string;
  label: "childIndependence" | "retirement" | "age70" | "age80" | "other";
  /** 人数（その月から） */
  people: number;
  basis: string;
}

/** 本人の退職の月（働く最後の翌月）。働き方の期間が無ければ65歳になる月。もう退職していれば null */
export function retireMonth(h: Household): string | null {
  const self = h.members.find((m) => m.kind === "self");
  if (self === undefined) return null;
  const ends = (h.employmentPeriods ?? []).filter((e) => e.member === self.id).map((e) => resolveTimepoint(h, e.to));
  const any = (h.employmentPeriods ?? []).some((e) => e.member === self.id);
  if (any && ends.some((x) => x === null)) return ageReachedMonth(self, 65);
  const last = ends
    .filter((x): x is string => x !== null)
    .sort()
    .at(-1);
  return last !== undefined ? addMonths(last, 1) : ageReachedMonth(self, 65);
}

function ageLevel(self: Member | undefined, retire: string | null, month: string): number {
  if (self === undefined) return 1;
  const age = ageAt(self, month);
  if (age >= 80) return AGE_LEVELS.age80;
  if (age >= 70) return AGE_LEVELS.age70;
  if (retire !== null && month >= retire) return AGE_LEVELS.retired;
  return 1;
}

const round2 = (x: number): string => {
  const v = Math.round(x * 100) / 100;
  return String(v);
};

/**
 * 推定の段（人数の目安が変わる月・本人の退職・70歳・80歳）。今より後で、表の最後の年までの月だけ。割合が前の段と同じ月は作らない
 */
export function autoStages(h: Household, baseMonth: string, endYear: number, livingId: string): AutoStage[] {
  const self = h.members.find((m) => m.kind === "self");
  const retire = retireMonth(h);
  const last = `${endYear}-12`;
  // 変わり目の候補（理由の鍵・時点・解いた年月・段の名前）
  const points: { reason: string; at: Timepoint; ym: string; label: AutoStage["label"] }[] = [];
  const push = (reason: string, at: Timepoint | null | undefined, label: AutoStage["label"] = "other") => {
    if (at == null) return;
    const ym = resolveTimepoint(h, at);
    if (ym === null || ym <= baseMonth || ym > last) return;
    points.push({ reason, at: at.at !== undefined ? { at: ym } : structuredClone(at), ym, label });
  };
  for (const m of h.members) {
    if (m.kind === "self") continue;
    if (m.birth.birthYearMonth > baseMonth) push(`birth/${m.id}`, { at: m.birth.birthYearMonth });
    if (m.joins != null) push(`joins/${m.id}`, m.joins);
    if (m.leaves != null) push(`leaves/${m.id}`, m.leaves, m.kind === "child" ? "childIndependence" : "other");
    for (const p of m.outside?.periods ?? []) {
      if (p.living === false) continue;
      const key = p.id ?? `${m.id}`;
      push(`outsideFrom/${key}`, p.from);
      const to = resolveTimepoint(h, p.to);
      if (to !== null) push(`outsideTo/${key}`, { at: addMonths(to, 1) });
    }
  }
  for (const a of awayPeriods(h)) {
    push(`awayFrom/${a.goal}`, { at: a.from });
    push(`awayTo/${a.goal}`, { at: a.until });
  }
  for (const c of facilityStarts(h)) {
    push(`care/${c.care}`, { at: c.from });
    if (c.until !== null) push(`careEnd/${c.care}`, { at: c.until });
  }
  if (self !== undefined) {
    if (retire !== null) push("retire", { at: retire }, "retirement");
    push("age70", { memberAge: { member: self.id, years: 70, months: 0 } }, "age70");
    push("age80", { memberAge: { member: self.id, years: 80, months: 0 } }, "age80");
  }
  // 同じ月の候補は1つの段にまとめる（段の名前は、退職・年齢・子の独立の順に、ほかは「その他」）
  const byMonth = new Map<string, typeof points>();
  for (const p of points) byMonth.set(p.ym, [...(byMonth.get(p.ym) ?? []), p]);
  const months = [...byMonth.keys()].sort();
  const n0 = countAt(h, baseMonth, { now: true });
  // 人数ごとの比は統計の表の額のままで出す（推定の額の千円単位の丸めで比を変えない）
  const est0 = livingStatistic(n0).value;
  const lvl0 = ageLevel(self, retire, baseMonth);
  const out: AutoStage[] = [];
  let prev = "1";
  for (const ym of months) {
    const ps = (byMonth.get(ym) ?? []).sort((a, b) => a.reason.localeCompare(b.reason));
    const n = countAt(h, ym);
    const lvl = ageLevel(self, retire, ym);
    const ratio = n === 0 ? "0" : round2((livingStatistic(n).value / est0) * (lvl / lvl0));
    if (ratio === prev) continue;
    prev = ratio;
    const label = (["retirement", "age70", "age80", "childIndependence"] as const).find((l) => ps.some((p) => p.label === l)) ?? "other";
    const head = ps.find((p) => p.label === label) ?? (ps[0] as (typeof ps)[number]);
    const peopleText = n === n0 ? `${n}人のまま` : `${n0}人→${n}人`;
    const ageText = lvl !== lvl0 ? `・${AGE_LEVEL_BASIS}` : "";
    out.push({
      id: derivedId(livingId, `auto/${head.reason}`),
      reasons: ps.map((p) => p.reason),
      at: head.at,
      ym,
      ratio,
      label,
      people: n,
      basis: `${AUTO_STAGE_BASIS}（人数の変化と年齢から。${peopleText}。家計調査の世帯人員別の目安の比${ageText}）`,
    });
  }
  return out;
}

// ---- 値の状態の行（段の割合。推定の段の印） ----
// 推定の段は、割合の欄に推定の行を持つ（時点は家族・進路・働き方の物から決まるので行を持たない）。FP が割合・時点・入れ方のどれかを直すと、
// その段の行を外す（その段だけ確定。0049）

/** 推定の段の割合の当て先 */
export const ratioAddress = (livingId: string, stageId: string) => ({ target: { object: livingId }, item: "livingExpense.stages", at: [stageId, "ratio"] });
const autoRow = (basis: string): StateRow => ({ state: "estimated", origin: { kind: "auto" }, estimate: { method: AUTO_METHOD, basis } });
const isAutoRow = (r: StateRow | undefined): boolean => r?.state === "estimated" && r.origin.kind === "auto" && r.estimate?.method === AUTO_METHOD && r.estimate.basis.startsWith(AUTO_STAGE_BASIS);
const wrap = (l: LivingExpense): Obj => ({ household: { livingExpenses: [l] } });

/** 推定の段か（FP が直していない） */
export function isAutoStage(l: LivingExpense, stageId: string): boolean {
  return isAutoRow(rowAt(wrap(l), ratioAddress(l.id, stageId)));
}

/** 推定の段の根拠の文（推定のままでなければ null） */
export function autoBasis(l: LivingExpense, stageId: string): string | null {
  const r = rowAt(wrap(l), ratioAddress(l.id, stageId));
  return r !== undefined && r.state === "estimated" ? (r.estimate?.basis ?? "推定") : null;
}

/** 段を FP が直した（その段の推定の行を外して確定にする） */
export function settleStage(l: LivingExpense, stageId: string): void {
  putRow(wrap(l), ratioAddress(l.id, stageId), undefined);
}

/** FP が外した推定の段（入れ直しで足し直さない） */
const dropAddress = (livingId: string, stageId: string) => ({ target: { object: livingId }, item: "livingExpense.stages", at: [stageId] });
const isDropped = (l: LivingExpense, stageId: string): boolean => rowAt(wrap(l), dropAddress(l.id, stageId))?.state === "notApplicable";

/** 推定の段階を入れ直す対象か（推定の段か、外した推定の段の印がある） */
export function autoActive(l: LivingExpense): boolean {
  const states = (l as { valueStates?: Record<string, StateRow> }).valueStates ?? {};
  return Object.entries(states).some(([k, r]) => k.startsWith("livingExpense.stages/") && (isAutoRow(r) || r.state === "notApplicable"));
}

/** 推定の段を外したことを覚える（stage はもう外した後でよい） */
export function rememberDropped(l: LivingExpense, stageId: string): void {
  const input = wrap(l);
  putRow(input, ratioAddress(l.id, stageId), undefined);
  putRow(input, dropAddress(l.id, stageId), { state: "notApplicable", origin: { kind: "manual" } });
}

const stageMonth = (h: Household, s: Stage): string => resolveTimepoint(h, s.at) ?? "9999-12";

/**
 * 推定の段階を入れ直す（l をそのまま書き換える）。start が true なら、推定の段がまだ無くても入れる（新しい世帯・「推定で入れる」を押したとき）。
 * 推定のままの段だけ書き換え・外し、FP が直した段・FP が足した段は変えない
 */
export function applyAutoStages(h: Household, baseMonth: string, endYear: number, l: LivingExpense, start = false): boolean {
  if (!start && !autoActive(l)) return false;
  const want = autoStages(h, baseMonth, endYear, l.id);
  const before = JSON.stringify(l);
  const input = wrap(l);
  const kept: Stage[] = [];
  const seen = new Set<string>();
  for (const s of (l.stages ?? []) as Stage[]) {
    const id = s.id;
    const auto = id !== undefined && isAutoStage(l, id);
    const w = id === undefined ? undefined : want.find((x) => x.id === id);
    if (id !== undefined && w !== undefined) seen.add(id);
    if (!auto) {
      kept.push(s);
      continue;
    }
    // もう要らない推定の段は外す
    if (w === undefined) {
      putRow(input, ratioAddress(l.id, id as string), undefined);
      continue;
    }
    s.at = structuredClone(w.at);
    s.ratio = w.ratio;
    s.label = w.label;
    putRow(input, ratioAddress(l.id, w.id), autoRow(w.basis));
    kept.push(s);
  }
  for (const w of want) {
    if (seen.has(w.id) || isDropped(l, w.id)) continue;
    kept.push({ id: w.id, at: structuredClone(w.at), label: w.label, ratio: w.ratio });
    putRow(input, ratioAddress(l.id, w.id), autoRow(w.basis));
  }
  kept.sort((a, b) => stageMonth(h, a).localeCompare(stageMonth(h, b)));
  if (kept.length > 0) l.stages = kept;
  else delete l.stages;
  return JSON.stringify(l) !== before;
}

/** 推定の段の見出しの文（理由から。名前は呼び名の関数で） */
export function autoStageTitle(stage: AutoStage, name: (memberId: string) => string, h: Household): string {
  const selfId = h.members.find((m) => m.kind === "self")?.id ?? "";
  const parts = stage.reasons.map((r) => {
    const [kind, id] = r.split("/") as [string, string | undefined];
    const careOf = (cid: string | undefined) => (h.careExpenses ?? []).find((c) => c.id === cid)?.member;
    const awayOf = (gid: string | undefined) => (h.goals ?? []).find((g) => g.id === gid)?.owner;
    const periodOwner = (pid: string | undefined) => h.members.find((m) => m.id === pid || (m.outside?.periods ?? []).some((p) => p.id === pid))?.id;
    switch (kind) {
      case "birth":
        return `${name(id ?? "")}の誕生`;
      case "joins":
        return `${name(id ?? "")}が加わる`;
      case "leaves":
        return `${name(id ?? "")}の独立`;
      case "outsideFrom":
        return `${name(periodOwner(id) ?? "")}と家計を1つにする`;
      case "outsideTo":
        return `${name(periodOwner(id) ?? "")}と家計を分ける`;
      case "awayFrom":
        return `${name(awayOf(id) ?? "")}の自宅外の在学`;
      case "awayTo":
        return `${name(awayOf(id) ?? "")}の自宅外の在学の終わり`;
      case "care":
        return `${name(careOf(id) ?? "")}の施設の介護`;
      case "careEnd":
        return `${name(careOf(id) ?? "")}の施設の介護の終わり`;
      case "retire":
        return `${name(selfId)}の退職`;
      case "age70":
        return `${name(selfId)}70歳`;
      case "age80":
        return `${name(selfId)}80歳`;
      default:
        return "節目";
    }
  });
  return [...new Set(parts)].join("・");
}

/** 段の時点の年（表示用） */
export const yearOfYm = (ym: string): number => parseYm(ym).y;

/**
 * 新しい生活費（総額の統計の推定と、推定の段階）。新しい世帯・「目安で入れる」「推定で埋める」で使う（古い世帯を開いただけでは作らない）
 */
export function startLiving(h: Household, baseMonth: string, endYear: number, id: string): LivingExpense {
  const est = livingBySize(countAt(h, baseMonth, { now: true }));
  const l: LivingExpense = { id, mode: "total", monthly: { value: est.value, state: "estimated", origin: { kind: "auto" }, estimate: { method: "statistic", basis: est.basis } } as Box<number> };
  applyAutoStages(h, baseMonth, endYear, l, true);
  return l;
}
