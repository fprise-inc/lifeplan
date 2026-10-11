// 根拠の表示（0006 の7）: 根拠の記録「全部」の出力から、1つのマス（表の行×年）の根拠を取り出す。
// 提示層に渡すのは EvidenceView（式・制度の値・出典・制度データの版）だけ。部品の指紋・入力の物の ID などは渡さない
import type { FullResult, TraceNode } from "../engine/types.ts";
import type { EngineRequest } from "../engine/types.ts";
import { PARAM_LABELS } from "../generated/labels.ts";
import type { EvidenceView } from "../presentation/model.ts";
import { group } from "../presentation/format.ts";
import { FORMULA_LABELS } from "./formulas.ts";
import { rowDefs } from "./present.ts";
import { ageInYear, leaveYear, roles } from "./roles.ts";

/** 制度の値を、表に出す文字に（表・段階は「表（n段）」） */
export function paramValueText(id: string, value: unknown): string {
  if (typeof value === "number") return id.endsWith("Months") || id.endsWith("maxMonths") ? `${group(value)}月` : group(value);
  if (typeof value === "string") return value === "notApplicable" ? "該当なし" : value;
  if (Array.isArray(value)) return `表（${value.length}段）`;
  if (value !== null && typeof value === "object") {
    const o = value as Record<string, unknown>;
    if (typeof o.rate === "string") return o.rate;
    if (typeof o.amount === "number") return `${group(o.amount)}円`;
    if (Array.isArray(o.brackets)) return `表（${o.brackets.length}段）`;
    return "表";
  }
  return String(value);
}

const MAX_PARAMS = 24;

/**
 * 呼び出しのノードから、使った制度の値を集める（近い順: その部品が直接読んだ値、次に内側の呼び出しが読んだ値。同じ値は1回だけ）
 */
export function collectParams(nodes: readonly TraceNode[], start: number, depth = 3): Extract<TraceNode, { type: "param" }>[] {
  const out = new Map<string, Extract<TraceNode, { type: "param" }>>();
  const seen = new Set<number>([start]);
  let level = [start];
  for (let d = 0; d <= depth && level.length > 0 && out.size < MAX_PARAMS; d++) {
    const next: number[] = [];
    for (const i of level) {
      const n = nodes[i];
      if (n === undefined) continue;
      if (n.type === "param") {
        if (!out.has(n.ref) && out.size < MAX_PARAMS) out.set(n.ref, n);
      } else if (n.type === "call") {
        for (const u of n.uses) {
          if (seen.has(u)) continue;
          seen.add(u);
          const c = nodes[u];
          // 直接読んだ値を先に
          if (c?.type === "param") {
            if (!out.has(c.ref) && out.size < MAX_PARAMS) out.set(c.ref, c);
          } else next.push(u);
        }
      }
    }
    level = next;
  }
  return [...out.values()];
}

export function buildEvidence(full: FullResult, req: EngineRequest, rowKey: string, year: number): EvidenceView | null {
  const def = rowDefs(req).find((d) => d.key === rowKey);
  if (def === undefined) return null;
  const byAccrual = full.header.calcConventions?.aggregation === "accrual";
  const breakdown = new Map<string, number>();
  const calls = new Set<number>();
  let total = 0;
  full.flows.forEach((f, i) => {
    const y = byAccrual ? f.accrualYear : Number(f.ym.slice(0, 4));
    if (y !== year || !def.match({ row: f.row, year: y, amount: f.amount, ...(f.member !== undefined ? { member: f.member } : {}) })) return;
    total += f.amount;
    breakdown.set(f.formula, (breakdown.get(f.formula) ?? 0) + f.amount);
    const t = full.trace.flows[i];
    if (t !== undefined) calls.add(t);
  });
  full.annual.forEach((a, i) => {
    if (a.year !== year || !def.match({ row: a.row, year: a.year, amount: a.amount, ...(a.member !== undefined ? { member: a.member } : {}) })) return;
    total += a.amount;
    breakdown.set(a.formula, (breakdown.get(a.formula) ?? 0) + a.amount);
    const t = full.trace.annual[i];
    if (t !== undefined) calls.add(t);
  });
  if (breakdown.size === 0) return null;
  const params = new Map<string, Extract<TraceNode, { type: "param" }>>();
  for (const c of calls) for (const p of collectParams(full.trace.nodes, c)) if (!params.has(p.ref) && params.size < MAX_PARAMS) params.set(p.ref, p);
  const rs = roles(req);
  const context = rs
    .filter((r) => ageInYear(r.member, year) >= 0 && (leaveYear(r.member) === null || year <= (leaveYear(r.member) as number)))
    .map((r) => `${r.label}${ageInYear(r.member, year)}歳`)
    .join("・");
  return {
    title: `${year}年 ${def.label}`,
    total,
    context,
    breakdown: [...breakdown.entries()].map(([formula, amount]) => ({ label: FORMULA_LABELS[formula]?.label ?? formula, amount })),
    formulas: [...breakdown.keys()].map((f) => FORMULA_LABELS[f]?.text ?? `計算式 ${f}`),
    params: [...params.values()].map((p) => ({
        label: PARAM_LABELS[p.id] ?? p.id,
        value: paramValueText(p.id, p.value),
        source: p.sources.map((s) => s.locator).filter((x): x is string => typeof x === "string" && x !== "").slice(0, 2).join("／") || "（出典の記載なし）",
        version: p.packVersion,
        appliesFrom: p.appliesFrom ?? "",
      })),
    note: byAccrual ? null : "表は受け取った年・支払った年で集計しています（年金は偶数月に前の2か月分を受け取ります）。",
  };
}
