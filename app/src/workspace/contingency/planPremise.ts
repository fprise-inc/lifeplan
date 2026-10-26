// 万一の前提をプランごとに上書きする（0071・0036 の6 の3）: 万一のタブで見ているプランの前提は、全プラン共通の前提に、そのプランと土台の
// 万一の前提の差分を当てたもの。前提のパネルで「このプランだけ」を選んで直すと、変わった値ごとにそのプランの値を変える差分を作る・直す
// （共通・土台と同じ値に戻したら消す）。「全プラン共通」のまま直すと共通の前提を直す（上書きした値はそのまま）。
// 場面・起きる年・重ねる印は入力項目ID を持たないので、どちらを選んでいても共通を直す
import { newId, type WorkingHousehold } from "../input/household.ts";
import { chainOf, findPlan } from "../plans/plans.ts";
import { sameJson, type PlanDiff } from "../plans/diffs.ts";
import type { ContingencyPlan } from "./planData.ts";
import { applyPremiseDiffs, isPremiseDiff, premiseAddress, premisePath, premiseText, readPath, writePath } from "./premiseItems.ts";

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const box = (v: unknown) => ({ value: v === undefined ? null : structuredClone(v), state: "confirmed" as const, origin: { kind: "manual" as const } });
const unbox = (v: unknown): unknown => (isObj(v) && "state" in v ? v.value : v);

/** そのプラン（土台を含む）の万一の前提。現状（プランでない）は共通の前提 */
export function premiseFor(wh: WorkingHousehold, planId: string | null): ContingencyPlan {
  if (planId === null || findPlan(wh.proposals, planId) === undefined) return wh.contingency;
  return applyPremiseDiffs(wh.contingency, chainOf(wh.proposals, planId));
}

/** 2つの前提の違う値（場所と、後の値。省いた値は undefined） */
export function premiseChanges(a: unknown, b: unknown, path: string[] = []): { path: string[]; value: unknown }[] {
  if (sameJson(a ?? null, b ?? null)) return [];
  if ((isObj(a) || a === undefined) && (isObj(b) || b === undefined) && (isObj(a) || isObj(b))) {
    const x = isObj(a) ? a : {};
    const y = isObj(b) ? b : {};
    return [...new Set([...Object.keys(x), ...Object.keys(y)])].flatMap((k) => premiseChanges(x[k], y[k], [...path, k]));
  }
  return [{ path, value: b }];
}

const samePlace = (d: PlanDiff, item: string, at: readonly string[]) => d.op === "set" && isPremiseDiff(d) && d.item === item && d.at !== null && sameJson(d.at, at);

/**
 * プランの万一の前提の1つの値を直す: 土台（土台が無ければ共通）と同じ値なら自分の差分を消し、違えば作る・直す。
 * 入力項目ID を持たない場所（起きる年など）は共通の前提を直す
 */
export function setPremiseValue(wh: WorkingHousehold, planId: string, path: readonly string[], value: unknown): WorkingHousehold {
  const a = premiseAddress(path);
  const p = findPlan(wh.proposals, planId);
  if (a === null || p === undefined) return setCommonValue(wh, path, value);
  const base = readPath(premiseFor(wh, p.base), path);
  const own = p.diffs.find((d) => samePlace(d, a.item, a.at));
  const rest = p.diffs.filter((d) => !samePlace(d, a.item, a.at));
  const diffs: PlanDiff[] = sameJson(base ?? null, value ?? null)
    ? rest
    : [...rest, { id: own?.id ?? newId(), op: "set", target: { plan: "contingency" }, item: a.item, at: [...a.at], value: box(value), before: own?.before ?? box(readPath(wh.contingency, path)), enabled: true, origin: { kind: "manual" }, note: own?.note ?? null }];
  return { ...wh, proposals: wh.proposals.map((x) => (x.id === planId ? { ...x, diffs } : x)) };
}

/** 共通の前提の1つの値を直す */
export function setCommonValue(wh: WorkingHousehold, path: readonly string[], value: unknown): WorkingHousehold {
  const c = structuredClone(wh.contingency);
  writePath(c, path, value);
  return { ...wh, contingency: c };
}

/**
 * 前提のパネルで直した前提（next）を書く。shown は直す前に見せていた前提（そのプランの前提）。to "plan" はそのプランの差分に、
 * "common" は共通の前提に書く（変わった値ごと）
 */
export function writePremise(wh: WorkingHousehold, planId: string | null, shown: ContingencyPlan, next: ContingencyPlan, to: "plan" | "common"): WorkingHousehold {
  let out = wh;
  for (const c of premiseChanges(shown, next)) out = to === "plan" && planId !== null ? setPremiseValue(out, planId, c.path, c.value) : setCommonValue(out, c.path, c.value);
  return out;
}

/** その場所を共通に戻す（このプランの差分を消す。土台が上書きしていれば、共通の値に戻す差分を作る） */
export function revertPremise(wh: WorkingHousehold, planId: string, path: readonly string[]): WorkingHousehold {
  return setPremiseValue(wh, planId, path, readPath(wh.contingency, path));
}

/** 前提の欄の印: そのプランで共通と違う値か・このプランの差分か土台からか・共通の値の言い方 */
export interface PremiseMark {
  own: boolean;
  inherited: boolean;
  common: string;
}

/** 欄の場所の印（共通と同じなら null） */
export function premiseMark(wh: WorkingHousehold, planId: string | null, path: readonly string[], text: (v: unknown) => string): PremiseMark | null {
  if (planId === null) return null;
  const chain = chainOf(wh.proposals, planId);
  if (chain.length === 0) return null;
  const hits = chain.map((p) => ({ p, d: p.diffs.find((d) => d.enabled && d.op === "set" && isPremiseDiff(d) && d.item !== null && d.at !== null && sameJson(premisePath({ item: d.item, at: d.at }), [...path])) }));
  const last = [...hits].reverse().find((h) => h.d !== undefined);
  if (last === undefined) return null;
  const common = readPath(wh.contingency, path);
  if (sameJson(common ?? null, unbox(last.d?.value) ?? null)) return null;
  return { own: last.p.id === planId, inherited: last.p.id !== planId, common: text(common) };
}

/** そのプラン（土台を含む）で上書きしている万一の前提の数 */
export function overrideCount(wh: WorkingHousehold, planId: string | null): number {
  if (planId === null) return 0;
  return premiseChanges(wh.contingency, premiseFor(wh, planId)).length;
}

/** 違いの一覧の1行の言い方（万一の前提の差分） */
export function premiseDiffText(d: PlanDiff, wh: WorkingHousehold): { label: string; from: string; to: string } | null {
  if (!isPremiseDiff(d) || d.item === null || d.at === null) return null;
  const path = premisePath({ item: d.item, at: d.at });
  if (path === null) return null;
  const now = premiseText(path, readPath(wh.contingency, path));
  const to = premiseText(path, unbox(d.value));
  return { label: `万一の前提: ${now.label}`, from: `共通: ${now.text}`, to: to.text };
}
