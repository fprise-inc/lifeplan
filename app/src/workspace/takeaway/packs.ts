// 持ち帰り用のレポートに入れる制度データを、その世帯の計算に使うものだけに絞る（0030）。
// - 載せるプランを、顧客が動かせるつまみの端（いちばん小さい値・大きい値）と FP顧問料の入れる・入れないでも計算し、
//   根拠の記録の要約（trace: summary）に出てくる制度の値の ID だけを残す（パックの見出しは全部残す）
// - 絞った制度データで同じ要求を計算し直し、全部の制度データの結果と同じになることを確かめる。1つでも違えば全部の制度データを入れる
// - 計算エンジンは画面側のもの（開発用の webview の計算と同じまとめた JS）
import type { WebEngine } from "../../engine/host.ts";
import type { EngineRequest } from "../../engine/types.ts";

interface PackLike {
  pack: { packId: string };
  values: { id: string }[];
}

interface TraceSummary {
  trace?: { components?: { params?: { id: string }[] }[] };
  error?: unknown;
}

/** 根拠の記録の要約から、使った制度の値の ID を集める */
export function usedValueIds(engine: WebEngine, packsJson: string, requests: readonly EngineRequest[]): Set<string> | null {
  const ids = new Set<string>();
  const outs = JSON.parse(engine.runBatch(JSON.stringify(requests.map((r) => ({ ...r, trace: "summary" }))), packsJson, "{}")) as TraceSummary[] | { error: unknown };
  if (!Array.isArray(outs)) return null;
  for (const out of outs) {
    if (out.error !== undefined) return null;
    for (const c of out.trace?.components ?? []) for (const p of c.params ?? []) ids.add(p.id);
  }
  return ids;
}

export function prune(packs: readonly unknown[], ids: ReadonlySet<string>): unknown[] {
  return (packs as PackLike[]).map((p) => ({ ...p, values: p.values.filter((v) => ids.has(v.id)) }));
}

/** まとめて計算して、結果の表と要約を比べられる形にする（エラーは null） */
function results(engine: WebEngine, requests: readonly EngineRequest[], packsJson: string): (string | null)[] {
  const outs = JSON.parse(engine.runBatch(JSON.stringify(requests.map((r) => ({ ...r, trace: "none" }))), packsJson, '{"preview":true}')) as { error?: unknown; table?: unknown; summary?: unknown }[] | { error: unknown };
  if (!Array.isArray(outs)) return requests.map(() => null);
  return outs.map((r) => (r.error !== undefined ? null : JSON.stringify([r.table, r.summary])));
}

export interface PackChoice {
  packs: unknown[];
  /** 絞れたか（false は全部の制度データ） */
  pruned: boolean;
  /** 残した値の数と全部の値の数 */
  kept: number;
  total: number;
  /** 確かめに計算した要求の数 */
  checked: number;
}

/** 絞った制度データを作り、全部の制度データと同じ結果になることを確かめる */
export function choosePacks(engine: WebEngine, packsJson: string, requests: readonly EngineRequest[]): PackChoice {
  const all = JSON.parse(packsJson) as PackLike[];
  const total = all.reduce((s, p) => s + p.values.length, 0);
  const whole: PackChoice = { packs: all, pruned: false, kept: total, total, checked: requests.length };
  const ids = usedValueIds(engine, packsJson, requests);
  if (ids === null) return whole;
  const packs = prune(all, ids);
  const a = results(engine, requests, packsJson);
  const b = results(engine, requests, JSON.stringify(packs));
  if (a.some((x, i) => x === null || x !== b[i])) return whole;
  return { packs, pruned: true, kept: (packs as PackLike[]).reduce((s, p) => s + p.values.length, 0), total, checked: requests.length };
}
