// プランの差分の当て方（0036 の4・6・7）: 当て先で当てた値が、0.16 の欄の書き方で当てた値と同じであること
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { REPO_DIR } from "../scripts/lib.ts";
import type { EngineRequest } from "../src/engine/types.ts";
import { fromRequest, type WorkingHousehold } from "../src/workspace/input/household.ts";
import { applyAdvisoryFee, applyLevers, LEVER_KEYS, type LeverValues } from "../src/workspace/levers.ts";
import { writeAt, type PlanDiff } from "../src/workspace/plans/diffs.ts";
import { buildCatalog, reemploymentFor, type Catalog, type ItemValue } from "../src/workspace/plans/items.ts";
import { applyPlan, applyValues, changesOf, dropChange, effectiveValues, overwritePlan, reflectPlan, savePlan, type Proposal, type Values } from "../src/workspace/plans/plans.ts";
import { roles } from "../src/workspace/roles.ts";
import { resolveKey } from "../src/workspace/store/readings.ts";
import { modelHousehold, preview } from "./helpers.ts";

/** 欄の並びを問わずに比較する JSON */
const canon = (v: unknown): string => JSON.stringify(v, (_k, x: unknown) => (x !== null && typeof x === "object" && !Array.isArray(x) ? Object.fromEntries(Object.entries(x as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : 1))) : x));
const ids = readdirSync(join(REPO_DIR, "data", "modelHouseholds")).filter((f) => f.endsWith(".json")).map((f) => f.replace(/\.json$/, ""));

/** 数の値を少し動かした値（同じ型のまま） */
function nudge(v: ItemValue): ItemValue | undefined {
  if (typeof v === "number") return v === 0 ? 1 : v + (Number.isInteger(v) ? (Math.abs(v) >= 1000 ? 10000 : 1) : 0.5);
  if (typeof v === "string" && /^-?\d+(\.\d+)?$/.test(v)) return String(Number(v) + 0.001);
  if (typeof v === "boolean") return !v;
  return undefined;
}

describe("当て先で書いた値が、0.16 の欄の書き方と同じ", () => {
  it.each(ids)("%s", (id) => {
    const req = modelHousehold(id);
    const self = roles(req).find((r) => r.key === "self");
    if (self === undefined) return;
    const wh = fromRequest(req);
    const cat = buildCatalog(wh, self.member.id, null);
    const bad: string[] = [];
    for (const it of cat.items) {
      if (it.phase !== "field") continue;
      const r = resolveKey(it.key, wh.request.input as unknown as Record<string, unknown>);
      if (r === null || r.kind !== "address") continue;
      const v = nudge(it.read(wh));
      if (v === undefined) continue;
      const want = it.apply(wh, v).request;
      const input = structuredClone(wh.request.input) as unknown as Record<string, unknown>;
      const ok = writeAt(input, r.address, { value: v, state: "confirmed", origin: { kind: "manual" } });
      if (!ok || canon(input) !== canon(want.input)) bad.push(it.key);
    }
    expect(bad).toEqual([]);
  });
});

/** 0.16 の当て方（動かす項目のキーで、欄 → 対策 → FP顧問料）。差分の当て方を作り直す前の plans.ts の applyValues と同じ */
function legacyApply(wh: WorkingHousehold, values: Values, cat: Catalog): EngineRequest {
  let w = wh;
  for (const it of cat.items) if (it.phase === "field" && Object.hasOwn(values, it.key)) w = it.apply(w, values[it.key] ?? null);
  const lv: Partial<LeverValues> = {};
  for (const k of LEVER_KEYS) {
    const v = values[`lever:${k}`];
    if (typeof v === "number" && cat.byKey.has(`lever:${k}`)) lv[k] = v;
  }
  const r = reemploymentFor(wh, cat.selfId);
  let req = Object.keys(lv).length > 0 ? applyLevers(w.request, cat.selfId, lv, r !== undefined ? { reemployment: r } : {}) : w.request;
  const fee = values["lever:fee"];
  if (typeof fee === "boolean" && cat.byKey.has("lever:fee")) req = applyAdvisoryFee(req, fee);
  return req;
}

describe("動かす項目の値を当て先の差分で当てても、0.16 の当て方と同じ要求になる", () => {
  it.each(ids)("%s: すべての項目を一度に動かす", (id) => {
    const req = modelHousehold(id);
    const self = roles(req).find((r) => r.key === "self");
    if (self === undefined) return;
    const wh = fromRequest(req);
    const cat = buildCatalog(wh, self.member.id, null);
    const values: Values = {};
    for (const it of cat.items) {
      // 空欄のとき、ほかの前提と同じ値を見せる前提（教育費・厚生年金の調整率・土地の上昇率。0070）は、元の前提と別の値に動かす
      // （同じ値に動かすと、0.16 の当て方は「同じ値」とみなして書かない）
      const follows = it.key === "field:assume/educationInflation" || it.key === "field:assume/pensionMacroSlideEmployee" || it.key === "field:assume/realEstate/landGrowth";
      const v = nudge(it.read(wh));
      if (v !== undefined) values[it.key] = follows && typeof v === "string" ? String(Number(v) + 0.001) : v;
    }
    expect(canon(applyValues(wh, values, cat))).toBe(canon(legacyApply(wh, values, cat)));
  });
});

const NOW = "2026-10-26T10:00:00.000Z";
function open(id = "salariedCoupleTwoKids") {
  const req = modelHousehold(id);
  const self = roles(req).find((r) => r.key === "self")!.member;
  const wh = fromRequest(req);
  return { wh, cat: buildCatalog(wh, self.id, null) };
}
const box = (value: unknown) => ({ value, state: "confirmed", origin: { kind: "manual" } });
let seq = 0;
function mk(p: Partial<PlanDiff> & Pick<PlanDiff, "op" | "target">): PlanDiff {
  seq += 1;
  return { id: `00000000-0000-4000-8000-${String(seq).padStart(12, "0")}`, item: null, at: [], value: null, before: null, enabled: true, origin: { kind: "manual" }, note: null, ...p };
}
function withPlans(wh: WorkingHousehold, plans: { id: string; base?: string; diffs: PlanDiff[] }[]): WorkingHousehold {
  const ps: Proposal[] = plans.map((p) => ({ id: p.id, name: p.id, createdAt: NOW, updatedAt: NOW, base: p.base ?? null, tags: [], diffs: p.diffs }));
  return { ...wh, proposals: ps };
}

describe("差分の3つの種類と当てる順番（0036 の6）", () => {
  const { wh, cat } = open();
  const hh = wh.request.input.household;
  const debt = hh.debts![0]!;
  const ins = hh.insuranceContracts![0]!;
  const living = hh.livingExpenses![0]!;

  it("物を外す・足す・値を変える差分を当てると、エンジンの入力のスキーマを通り、計算できる", () => {
    const added = { ...structuredClone(debt), id: "00000000-0000-4000-8000-00000000aa01", principal: 3_000_000 };
    const w = withPlans(wh, [
      {
        id: "B",
        diffs: [
          mk({ op: "remove", target: { object: ins.id }, before: structuredClone(ins) }),
          mk({ op: "add", target: { collection: "debt" }, value: added }),
          mk({ op: "set", target: { object: added.id }, item: "debt.principal", at: [], value: box(2_500_000), before: null }),
          mk({ op: "set", target: { object: living.id }, item: "livingExpense.monthly", at: [], value: box(280_000), before: structuredClone(living.monthly) }),
        ],
      },
    ]);
    const a = applyPlan(w, "B", cat);
    const out = a.request.input.household;
    expect(out.insuranceContracts!.some((x) => x.id === ins.id)).toBe(false);
    expect(out.debts!.find((x) => x.id === added.id)!.principal).toBe(2_500_000);
    expect(out.livingExpenses![0]!.monthly).toEqual(box(280_000));
    expect([...a.reviews.values()].every((r) => r.state === "ok")).toBe(true);
    expect(() => preview(a.request)).not.toThrow();
    // 現状は変わらない
    expect(w.request.input.household.insuranceContracts).toHaveLength(1);
  });

  it("土台から順に当て、同じ当て先は後のプランが勝つ。合成の対策は1回だけ当てる", () => {
    const w = withPlans(wh, [
      { id: "B", diffs: [mk({ op: "set", target: { object: living.id }, item: "livingExpense.monthly", at: [], value: box(250_000), before: structuredClone(living.monthly) }), mk({ op: "set", target: { lever: "loanPrepay", object: debt.id }, item: "debt.prepayments", value: box(1_000_000) })] },
      { id: "C", base: "B", diffs: [mk({ op: "set", target: { object: living.id }, item: "livingExpense.monthly", at: [], value: box(230_000), before: structuredClone(living.monthly) }), mk({ op: "set", target: { lever: "loanPrepay", object: debt.id }, item: "debt.prepayments", value: box(2_000_000) })] },
    ]);
    const a = applyPlan(w, "C", cat);
    expect(a.request.input.household.livingExpenses![0]!.monthly).toEqual(box(230_000));
    // 繰上返済は子のプランの額で1回だけ（土台の額に重ねない）
    const before = wh.request.input.household.debts![0]!.prepayments ?? [];
    expect(a.request.input.household.debts![0]!.prepayments).toHaveLength(before.length + 1);
    expect(a.request.input.household.debts![0]!.prepayments!.at(-1)!.amount).toBe(2_000_000);
    // 結果のタブの値（動かす項目のキー）で当てても同じ
    expect(JSON.stringify(applyValues(w, effectiveValues(w, "C"), cat))).toBe(JSON.stringify(a.request));
  });

  it("要確認（0036 の7）: 場面ごとに当てるか・何と出すか", () => {
    const ghost = "00000000-0000-4000-8000-00000000ffff";
    const insChanged = { ...structuredClone(ins), id: ins.id, note: "別の物" };
    const dupe = structuredClone(debt);
    const orphan = { ...structuredClone(hh.accounts![0]!), id: "00000000-0000-4000-8000-00000000aa02", owner: ghost };
    const diffs = {
      setGone: mk({ op: "set", target: { object: ins.id }, item: "insurance.premium", at: [], value: box(1), before: null }),
      setChanged: mk({ op: "set", target: { object: living.id }, item: "livingExpense.monthly", at: [], value: box(270_000), before: box(310_000) }),
      removeGone: mk({ op: "remove", target: { object: ghost }, before: {} }),
      removeChanged: mk({ op: "remove", target: { object: ins.id }, before: insChanged }),
      addExists: mk({ op: "add", target: { collection: "debt" }, value: dupe }),
      addOrphan: mk({ op: "add", target: { collection: "account" }, value: orphan }),
      unresolved: mk({ op: "set", target: { plan: "assumptions" }, item: "screen", at: null, value: box(1), before: box(0), unresolved: true, legacy: { key: "field:old/unknown", target: { plan: "assumptions" }, item: "screen" } }),
    };
    const w = withPlans(wh, [{ id: "B", diffs: Object.values(diffs) }]);
    const a = applyPlan(w, "B", cat);
    const st = (d: PlanDiff) => a.reviews.get(d.id)?.state;
    // 外した物への値の set は当てない（外す → 足す → 値を変える の順）
    expect(st(diffs.setGone)).toBe("missing");
    expect(st(diffs.setChanged)).toBe("changed");
    expect(a.request.input.household.livingExpenses![0]!.monthly).toEqual(box(270_000));
    expect(st(diffs.removeGone)).toBe("gone");
    expect(st(diffs.removeChanged)).toBe("changed");
    expect(a.request.input.household.insuranceContracts).toHaveLength(0);
    expect(st(diffs.addExists)).toBe("exists");
    expect(a.request.input.household.debts).toHaveLength(1);
    expect(st(diffs.addOrphan)).toBe("noOwner");
    expect(st(diffs.unresolved)).toBe("unresolved");
    const rows = changesOf(w.proposals, "B", w, cat);
    expect(rows.filter((r) => r.state !== "ok").length).toBeGreaterThanOrEqual(6);
    expect(rows.find((r) => r.label.startsWith("読み替えられなかった差分"))?.reviewNote).toBe("アプリの更新で、この違いを今の形に読み替えられませんでした");
    // 要確認の文は「現状のプラン」と言い、内部の言い方（入力（現状）・差分・相手）を出さない
    const note = (d: PlanDiff) => a.reviews.get(d.id)?.note;
    expect(note(diffs.setGone)).toBe("現状のプランから、この物が無くなりました");
    expect(note(diffs.setChanged)).toMatch(/^現状のプランが .+→.+ に変わりました$/);
    expect(note(diffs.removeGone)).toBe("このプランで外していた物は、現状のプランでももう無くなっています");
    expect(note(diffs.removeChanged)).toBe("このプランで外していた物の中身が、現状のプランで変わりました");
    expect(note(diffs.addExists)).toBe("このプランで足していた物は、現状のプランにもう入っています");
    expect(note(diffs.addOrphan)).toBe("この物に関わる家族（名義・契約者など）が、現状のプランにいません");
    for (const r of rows.filter((x) => x.state !== "ok")) expect(r.reviewNote ?? "").not.toMatch(/入力（現状）|差分|相手/);
  });

  it("置き換えの組は一覧で1件に見せ、戻すと組ごとに外れる", () => {
    const next = { ...structuredClone(ins), id: "00000000-0000-4000-8000-00000000aa03" };
    const pair = "00000000-0000-4000-8000-00000000aa04";
    const w = withPlans(wh, [{ id: "B", diffs: [mk({ op: "remove", target: { object: ins.id }, before: structuredClone(ins), pair }), mk({ op: "add", target: { collection: "insurance" }, value: next, pair })] }]);
    const rows = changesOf(w.proposals, "B", w, cat);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.label.startsWith("置き換え")).toBe(true);
    const ids = applyPlan(w, "B", cat).request.input.household.insuranceContracts!.map((x) => x.id);
    expect(ids).toEqual([next.id]);
    const dropped = dropChange(w, cat, "B", rows[0]!.key);
    expect(dropped.proposals[0]!.diffs).toEqual([]);
  });

  it("値の箱を持たない欄への set は、値を欄に、状態を物の valueStates に書く（0036 の4）", () => {
    const est = { value: 2_000_000, state: "estimated", origin: { kind: "auto" }, estimate: { method: "statistic", basis: "架空の目安" } };
    const w = withPlans(wh, [{ id: "B", diffs: [mk({ op: "set", target: { object: debt.id }, item: "debt.principal", at: [], value: est, before: null })] }]);
    const out = applyPlan(w, "B", cat).request.input.household.debts![0]! as unknown as Record<string, unknown>;
    expect(out.principal).toBe(2_000_000);
    expect(out.valueStates).toEqual({ "debt.principal": { state: "estimated", origin: { kind: "auto" }, estimate: { method: "statistic", basis: "架空の目安" } } });
  });

  it("キーに戻せない差分は結果のタブの値（@plan）でも当たり、上書き・現状への反映で失わない", () => {
    const added = { ...structuredClone(debt), id: "00000000-0000-4000-8000-00000000aa05", principal: 1_000_000 };
    const { wh: w1, id } = savePlan(wh, cat, { name: "プランB", base: null, values: { "lever:livingMonthly": 250_000 }, now: NOW });
    const w2 = { ...w1, proposals: w1.proposals.map((p) => (p.id === id ? { ...p, diffs: [...p.diffs, mk({ op: "add", target: { collection: "debt" }, value: added })] } : p)) };
    const v = effectiveValues(w2, id);
    expect(v["@plan"]).toBe(id);
    expect(applyValues(w2, v, cat).input.household.debts!.some((x) => x.id === added.id)).toBe(true);
    const w3 = overwritePlan(w2, cat, id, { ...v, "lever:livingMonthly": 240_000 }, NOW);
    expect(w3.proposals[0]!.diffs.some((d) => d.op === "add")).toBe(true);
    const r = reflectPlan(w3, cat, id, NOW);
    expect(r.request.input.household.debts!.some((x) => x.id === added.id)).toBe(true);
    expect(r.proposals[0]!.diffs).toEqual([]);
  });

  it("土台で足した物を子のプランで戻すと、同じ物を外す差分になる（0036 の8）", () => {
    const added = { ...structuredClone(debt), id: "00000000-0000-4000-8000-00000000aa06" };
    const w = withPlans(wh, [{ id: "B", diffs: [mk({ op: "add", target: { collection: "debt" }, value: added })] }, { id: "C", base: "B", diffs: [] }]);
    const key = changesOf(w.proposals, "C", w, cat)[0]!.key;
    const d = dropChange(w, cat, "C", key);
    const c = d.proposals.find((p) => p.id === "C")!;
    expect(c.diffs).toMatchObject([{ op: "remove", target: { object: added.id }, item: null }]);
    expect(applyPlan(d, "C", cat).request.input.household.debts!.some((x) => x.id === added.id)).toBe(false);
  });
});
