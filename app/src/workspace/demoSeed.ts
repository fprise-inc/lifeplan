// 見本の世帯を開いたときに、見本に入れておいたプランと控えを世帯に入れる（作業の層。catalog.ts の plans・snapshots）
// - プラン: 保存したプランとして足し、帯に並べる（基準は現状）
// - 控え: 今の世帯の残高・評価額をその時点の値に置き換えた写しを、決まった ID・作った日時で作る（指紋も作る。中身は架空）
import type { EngineRequest } from "../engine/types.ts";
import type { DemoHousehold, DemoSnapshot } from "./catalog.ts";
import type { WorkingHousehold } from "./input/household.ts";
import { normalizeValues, savePlan } from "./plans/plans.ts";
import type { Catalog } from "./plans/items.ts";
import { makeSnapshot, snapshotDigest, type Snapshot } from "./snapshots/snapshots.ts";

/** 残高・評価額を置き換えた要求（口座は時価、負債は残高。元の要求は変えない） */
export function withBalances(req: EngineRequest, balances: Readonly<Record<string, number>>): EngineRequest {
  const out = structuredClone(req);
  const h = out.input.household as unknown as {
    accounts?: { id: string; marketValue: { value: number } }[];
    debts?: { id: string; balance?: { value: number } }[];
  };
  for (const a of h.accounts ?? []) {
    const v = balances[a.id];
    if (v !== undefined) a.marketValue = { ...a.marketValue, value: v };
  }
  for (const d of h.debts ?? []) {
    const v = balances[d.id];
    if (v !== undefined && d.balance !== undefined) d.balance = { ...d.balance, value: v };
  }
  return out;
}

/** 見本の控えを1つ作る（作った日時は固定の文字列にして、指紋を作り直す） */
export async function demoSnapshot(wh: WorkingHousehold, s: DemoSnapshot, appVersion: string): Promise<Snapshot> {
  const past: WorkingHousehold = { ...wh, request: withBalances(wh.request, s.balances), proposals: [] };
  const snap = await makeSnapshot({ wh: past, drafts: {}, draft: { trigger: s.trigger, memo: s.memo, plan: null }, appVersion, now: new Date(s.createdAt), id: s.id });
  const fixed = { ...snap, createdAt: s.createdAt };
  return { ...fixed, digest: await snapshotDigest(fixed) };
}

/** 見本のプランと控えを世帯に入れる。band は帯に並べるプランの ID */
export async function seedDemo(wh: WorkingHousehold, cat: Catalog, demo: DemoHousehold, o: { now: string; appVersion: string }): Promise<{ wh: WorkingHousehold; band: string[] }> {
  let w = wh;
  const band: string[] = [];
  for (const p of demo.plans ?? []) {
    const r = savePlan(w, cat, { name: p.name, ...(p.tags !== undefined ? { tags: p.tags } : {}), base: null, values: normalizeValues(p.values, {}, w, cat), now: o.now });
    w = r.wh;
    band.push(r.id);
  }
  const snaps: Snapshot[] = [];
  for (const s of demo.snapshots ?? []) snaps.push(await demoSnapshot(wh, s, o.appVersion));
  if (snaps.length > 0) w = { ...w, snapshots: [...(w.snapshots ?? []), ...snaps] };
  return { wh: w, band };
}
