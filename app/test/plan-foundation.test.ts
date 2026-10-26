// 差分の土台（0035 の3・4・5・12、0036 の4・6・7・8）: 並びの要素の ID・外した要素・鍵の選び方・下書き・わからない・戻す・世帯の外の家族・
// 万一の前提・オフの差分・値の状態の欄の検査
import { describe, expect, it } from "vitest";
import type { EngineRequest } from "../src/engine/types.ts";
import { candidateRows } from "../src/workspace/ai/model.ts";
import { fromRequest, mutate, withElementIds, type WorkingHousehold } from "../src/workspace/input/household.ts";
import { boxAt, writeAt, type PlanDiff } from "../src/workspace/plans/diffs.ts";
import { buildCatalog, type Catalog } from "../src/workspace/plans/items.ts";
import { applyPlan, changesOf, diffKey, dropChange, effectiveValues, normalizeValues, overwritePlan, PLAN_SLOT, sameValues, savePlan, type Proposal } from "../src/workspace/plans/plans.ts";
import { roles } from "../src/workspace/roles.ts";
import { bodyObject, EMPTY_CARRY, fromBody, type BodyState } from "../src/workspace/store/body.ts";
import { toStoredBody } from "../src/workspace/store/format017.ts";
import { modelHousehold, preview } from "./helpers.ts";

type Obj = Record<string, unknown>;
const NOW = "2026-10-26T10:00:00.000Z";
const box = (value: unknown) => ({ value, state: "confirmed", origin: { kind: "manual" } });
let seq = 0;
const uid = () => `00000000-0000-4000-8000-${String((seq += 1)).padStart(12, "0")}`;
function mk(p: Partial<PlanDiff> & Pick<PlanDiff, "op" | "target">): PlanDiff {
  return { id: uid(), item: null, at: [], value: null, before: null, enabled: true, origin: { kind: "manual" }, note: null, ...p };
}
function open(id = "salariedCoupleTwoKids"): { wh: WorkingHousehold; cat: Catalog; self: string } {
  const req = modelHousehold(id);
  const self = roles(req).find((r) => r.key === "self")!.member.id;
  const wh = fromRequest(req);
  return { wh, cat: buildCatalog(wh, self, null), self };
}
function withPlans(wh: WorkingHousehold, plans: { id: string; base?: string; diffs: PlanDiff[] }[]): WorkingHousehold {
  return { ...wh, proposals: plans.map((p): Proposal => ({ id: p.id, name: p.id, createdAt: NOW, updatedAt: NOW, base: p.base ?? null, tags: [], diffs: p.diffs })) };
}
const state = (wh: WorkingHousehold): BodyState => ({ wh, workspace: { template: null, band: [], base: "current", selected: "current", shownItems: [] }, display: { result: {}, balance: {} } as unknown as BodyState["display"], carry: EMPTY_CARRY });
const roundTrip = (s: BodyState): BodyState => fromBody(JSON.stringify(bodyObject(s)));

describe("並びの要素の ID（0035 の5）: 番号で当てない", () => {
  it("開いた世帯の並びの要素は ID を持ち、画面で足した要素には新しい ID が付く（ほかの要素の ID は変わらない）", () => {
    const { wh } = open();
    const stages = wh.request.input.household.livingExpenses![0]!.stages!;
    expect(stages.every((s) => typeof (s as unknown as Obj).id === "string")).toBe(true);
    const before = stages.map((s) => (s as unknown as Obj).id);
    // 先頭に段を足す（画面の操作と同じく ID の無い要素）→ 世帯を置き換えるときに乱数の ID が付く
    const added = mutate(wh, (h) => {
      h.livingExpenses![0]!.stages!.unshift({ at: { at: "2030-04" }, label: "custom", ratio: "0.9" } as never);
    });
    const next = withElementIds(added.request, true).input.household.livingExpenses![0]!.stages!.map((s) => (s as unknown as Obj).id);
    expect(next.slice(1)).toEqual(before);
    expect(typeof next[0]).toBe("string");
    expect(before).not.toContain(next[0]);
  });

  it("土台で外した段への子のプランの値の差分は当てず、要確認にする（別の段に当たらない。0036 の7）", () => {
    const { wh, cat } = open();
    const living = wh.request.input.household.livingExpenses![0]!;
    const [s0, s1, s2] = living.stages!.map((s) => (s as unknown as Obj).id as string);
    const set = mk({ op: "set", target: { object: living.id }, item: "livingExpense.stages", at: [s1!, "ratio"], value: box("0.5"), before: box("0.8") });
    const w = withPlans(wh, [
      { id: "B", diffs: [mk({ op: "remove", target: { object: living.id }, item: "livingExpense.stages", at: [s1!], before: structuredClone(living.stages![1]) })] },
      { id: "C", base: "B", diffs: [set] },
    ]);
    const a = applyPlan(w, "C", cat);
    const out = a.request.input.household.livingExpenses![0]!.stages!.map((s) => s as unknown as Obj);
    expect(out.map((s) => s.id)).toEqual([s0, s2]);
    expect(out.map((s) => s.ratio)).toEqual([living.stages![0]!.ratio, living.stages![2]!.ratio]);
    expect(a.reviews.get(set.id)?.state).toBe("missing");
  });

  it("並びの先頭に要素を足しても、保存した差分は同じ要素に当たり、動かす項目のキーは新しい番号で読める", () => {
    const { wh, cat } = open();
    const living = wh.request.input.household.livingExpenses![0]!;
    const target = (living.stages![1] as unknown as Obj).id as string;
    const d = mk({ op: "set", target: { object: living.id }, item: "livingExpense.stages", at: [target, "ratio"], value: box("0.75"), before: box(living.stages![1]!.ratio) });
    const cur = withElementIds(
      mutate(wh, (h) => {
        h.livingExpenses![0]!.stages!.unshift({ at: { at: "2030-04" }, label: "custom", ratio: "0.9" } as never);
      }).request,
      true,
    );
    const w = withPlans({ ...wh, request: cur }, [{ id: "B", diffs: [d] }]);
    const cat2 = buildCatalog(w, cat.selfId, null);
    const out = applyPlan(w, "B", cat2).request.input.household.livingExpenses![0]!.stages!.map((s) => s as unknown as Obj);
    expect(out.find((s) => s.id === target)!.ratio).toBe("0.75");
    expect(out[0]!.ratio).toBe("0.9");
    expect(diffKey(d, w)).toBe(`field:living/${living.id}/stage/2/ratio`);
  });

  it("保存して読み戻しても、画面の中の要素の ID は変わらない", () => {
    const { wh } = open();
    const back = roundTrip(state(wh));
    expect(back.wh.request.input.household.livingExpenses).toEqual(wh.request.input.household.livingExpenses);
    expect(back.wh.request.input.household.relations).toEqual(wh.request.input.household.relations);
  });
});

describe("住宅ローンの借入額の差分（同じ当て先の鍵が2つ）", () => {
  it("保存して読み戻しても結果のタブの項目（loan:）で見え、上書きしても消えない", () => {
    const { wh, cat } = open("housingPurchase");
    const key = cat.items.find((i) => /^loan:.*:principal$/.test(i.key))!.key;
    const now = cat.byKey.get(key)!.read(wh) as number;
    const { wh: w1, id } = savePlan(wh, cat, { name: "B", base: null, values: { [key]: now - 5_000_000 }, now: NOW });
    const back = roundTrip(state(w1)).wh;
    const cat2 = buildCatalog(back, cat.selfId, null);
    expect(effectiveValues(back, id)).toEqual({ [key]: now - 5_000_000 });
    expect(changesOf(back.proposals, id, back, cat2).map((r) => [r.key, r.state])).toEqual([[key, "ok"]]);
    const w2 = overwritePlan(back, cat2, id, effectiveValues(back, id), NOW);
    expect(w2.proposals[0]!.diffs).toHaveLength(1);
  });
});

describe("結果のタブの下書き（@plan）", () => {
  it("つまみを動かして戻しても、キーに戻せない差分のあるプランは保存した中身と同じに見える", () => {
    const { wh, cat } = open();
    const debt = wh.request.input.household.debts![0]!;
    const added = { ...structuredClone(debt), id: uid() };
    const { wh: w1, id } = savePlan(wh, cat, { name: "B", base: null, values: { "lever:livingMonthly": 250_000 }, now: NOW });
    const w2 = { ...w1, proposals: w1.proposals.map((p) => (p.id === id ? { ...p, diffs: [...p.diffs, mk({ op: "add", target: { collection: "debt" }, value: added })] } : p)) };
    const saved = effectiveValues(w2, id);
    expect(saved[PLAN_SLOT]).toBe(id);
    const moved = normalizeValues({ ...saved, "lever:livingMonthly": 240_000 }, saved, w2, cat);
    expect(moved[PLAN_SLOT]).toBe(id);
    const back = normalizeValues({ ...moved, "lever:livingMonthly": 250_000 }, saved, w2, cat);
    expect(sameValues(back, saved, cat)).toBe(true);
  });
});

describe("値の箱を持たない欄の「わからない」「該当なし」（0035 の3）", () => {
  it("わからないは代わりの値と根拠の行、該当なしは省けない欄なら 0。エンジンの入力のスキーマを通る", () => {
    const { wh } = open();
    const debt = wh.request.input.household.debts![0]!;
    const est = { method: "statistic", basis: "架空の目安" };
    const input = structuredClone(wh.request.input) as unknown as Obj;
    expect(writeAt(input, { target: { object: debt.id }, item: "debt.principal", at: [] }, { state: "unknown", origin: { kind: "manual" }, substitute: { value: 2_000_000, state: "estimated", origin: { kind: "auto" }, estimate: est } })).toBe(true);
    const d = (input.household as { debts: Obj[] }).debts[0]!;
    expect(d.principal).toBe(2_000_000);
    expect(d.valueStates).toEqual({ "debt.principal": { state: "unknown", origin: { kind: "manual" }, estimate: est } });
    expect(() => preview({ ...wh.request, input: input as unknown as EngineRequest["input"] })).not.toThrow();
    expect(writeAt(input, { target: { object: debt.id }, item: "debt.principal", at: [] }, { state: "notApplicable", origin: { kind: "manual" } })).toBe(true);
    expect(d.principal).toBe(0);
    expect(() => preview({ ...wh.request, input: input as unknown as EngineRequest["input"] })).not.toThrow();
    // 行と欄から値の箱を組み立て直せる（戻す・確認したで使う）
    expect(boxAt(input, { target: { object: debt.id }, item: "debt.principal", at: [] })).toEqual({ state: "notApplicable", origin: { kind: "manual" } });
  });
});

describe("土台から来た一覧に無い欄の差分を戻す（0036 の8）", () => {
  it("戻す差分は値の箱で、当てた世帯はエンジンの入力のスキーマを通る", () => {
    const { wh, cat } = open();
    const ins = wh.request.input.household.insuranceContracts![0]!;
    const set = mk({ op: "set", target: { object: ins.id }, item: "insurance.premium", at: ["frequency"], value: box("annual"), before: box(ins.premium.frequency) });
    const w = withPlans(wh, [{ id: "B", diffs: [set] }, { id: "C", base: "B", diffs: [] }]);
    const row = changesOf(w.proposals, "C", w, cat).find((r) => r.key.startsWith("diff:"));
    expect(row).toBeDefined();
    const d = dropChange(w, cat, "C", row!.key);
    const back = d.proposals.find((p) => p.id === "C")!.diffs[0]!;
    expect(back.value).toEqual(box(ins.premium.frequency));
    const r = applyPlan(d, "C", cat).request;
    expect(r.input.household.insuranceContracts![0]!.premium.frequency).toBe(ins.premium.frequency);
    expect((r.input.household.insuranceContracts![0] as unknown as Obj).valueStates).toBeUndefined();
    expect(() => preview(r)).not.toThrow();
  });
});

describe("世帯の外の家族（0035 の4）", () => {
  it("生年月の無い世帯の外の家族は、読んで保存しても中身を失わない", () => {
    const { wh, self } = open();
    const sib = uid();
    const body = bodyObject(state(wh)) as unknown as { household: { request: { input: { household: { members: Obj[] } } } } };
    const member = { id: sib, kind: "sibling", sex: "female", joins: null, leaves: { at: "2040-01" }, expected: false, outside: { of: self, periods: [{ id: uid(), from: { at: "2030-04" }, to: null, living: true, income: false }], employeeInsurance: true } };
    body.household.request.input.household.members.push(member);
    const s = fromBody(JSON.stringify(body));
    expect(s.wh.request.input.household.donors?.some((d) => d.id === sib)).toBe(true);
    const again = bodyObject(s) as unknown as typeof body;
    expect(again.household.request.input.household.members.find((m) => m.id === sib)).toEqual(member);
  });

  it("画面で足した親は、保存するときに世帯の外の家族の印（誰の家族か）を持つ", () => {
    const { wh, self } = open();
    const p = uid();
    const w = mutate(wh, (h) => {
      h.members.push({ id: p, kind: "parent", birth: { birthYearMonth: "1950-04", bornOnFirst: false }, sex: "female", joins: null, leaves: null, expected: false } as never);
    });
    const stored = toStoredBody(JSON.parse(JSON.stringify(bodyObject(state(w)))) as Obj) as unknown as { household: { request: { input: { household: { members: Obj[] } } } } };
    expect(stored.household.request.input.household.members.find((m) => m.id === p)!.outside).toEqual({ of: self, periods: [] });
  });
});

describe("万一の前提の差分・オフにした差分・値の状態の行", () => {
  it("万一の前提の差分は、まだ当てられない差分として見せる（物が無くなった、とは言わない）", () => {
    const { wh, cat } = open();
    const d = mk({ op: "set", target: { plan: "contingency" }, item: "contingency.kind", at: [], value: box("death"), before: null });
    const a = applyPlan(withPlans(wh, [{ id: "B", diffs: [d] }]), "B", cat);
    expect(a.reviews.get(d.id)?.state).toBe("pending");
  });

  it("オフにした差分は、上書きしても消えない", () => {
    const { wh, cat } = open();
    const { wh: w1, id } = savePlan(wh, cat, { name: "B", base: null, values: { "lever:livingMonthly": 250_000, "lever:retireAge": 65 }, now: NOW });
    const w2 = { ...w1, proposals: w1.proposals.map((p) => ({ ...p, diffs: p.diffs.map((d) => (diffKey(d, w1) === "lever:retireAge" ? { ...d, enabled: false } : d)) })) };
    const w3 = overwritePlan(w2, cat, id, { ...effectiveValues(w2, id), "lever:livingMonthly": 240_000 }, NOW);
    const ds = w3.proposals[0]!.diffs;
    expect(ds.find((d) => diffKey(d, w3) === "lever:retireAge")?.enabled).toBe(false);
    expect(ds).toHaveLength(2);
  });

  it("無い要素への仮の印は、保存するとき値の状態の行にしない（0035 の3）", () => {
    const { wh } = open();
    const living = wh.request.input.household.livingExpenses![0]!;
    const w = { ...wh, assumed: { [`living/${living.id}/stage/9/ratio`]: "無い段", [`living/${living.id}/stage/0/ratio`]: "仮の割合" } };
    const stored = toStoredBody(JSON.parse(JSON.stringify(bodyObject(state(w)))) as Obj) as unknown as { household: { assumed?: Obj; request: { input: { household: { livingExpenses: Obj[] } } } } };
    const states = stored.household.request.input.household.livingExpenses[0]!.valueStates as Obj;
    expect(Object.keys(states)).toHaveLength(1);
    expect(stored.household.assumed).toBeUndefined();
  });
});

describe("未確認だった観点", () => {
  it("AI の候補の働き方の欄は、今の働き方の期間でも構成員でも当てはまる", () => {
    const { wh, cat, self } = open();
    const period = wh.request.input.household.employmentPeriods!.find((p) => p.member === self)!;
    const cand = (target: { object: string }) => ({ id: "c1", diffs: [{ id: "x1", target, item: "employment.salary.annual", value: { value: 7_000_000, state: "confirmed", origin: { kind: "ai" } }, note: null }] }) as never;
    for (const t of [{ object: period.id }, { object: self }]) {
      const rows = candidateRows(cand(t), wh, cat);
      expect(rows[0]!.key, `${JSON.stringify(t)} ${rows[0]!.reason}`).not.toBeNull();
    }
  });

  it("計算基準の月が変わって今の働き方の期間が別の期間になっても、差分は作った期間に当たる（新しい期間へ動かない）", () => {
    const { wh, cat, self } = open();
    const ps = wh.request.input.household.employmentPeriods!.filter((p) => p.member === self);
    const cur = ps[0]!;
    const d = mk({ op: "set", target: { object: cur.id }, item: "employment.salary.annual", at: [], value: box(7_000_000), before: structuredClone(cur.salary!.annual) });
    // 今の期間の後に別の期間を足し、計算基準の月をその期間に動かす
    const next = uid();
    const moved = mutate(wh, (h, req) => {
      const p = h.employmentPeriods!.find((x) => x.id === cur.id)!;
      p.to = { at: "2027-03" };
      h.employmentPeriods!.push({ ...structuredClone(p), id: next, from: { at: "2027-04" }, to: { at: "2041-06" } });
      req.input.baseMonth = "2027-10";
    });
    const w = withPlans(moved, [{ id: "B", diffs: [d] }]);
    const cat2 = buildCatalog(w, cat.selfId, null);
    const out = applyPlan(w, "B", cat2).request.input.household.employmentPeriods!;
    expect(out.find((p) => p.id === cur.id)!.salary!.annual.value).toBe(7_000_000);
    expect(out.find((p) => p.id === next)!.salary!.annual.value).toBe(cur.salary!.annual.value);
    expect(diffKey(d, w)).toBe(`field:work/period/${cur.id}/annual`);
  });
});

describe("世帯ファイルの検査（0035 の12）", () => {
  const ids = ["salariedCoupleTwoKids", "housingPurchase", "elderCare", "surplusSaving", "dualAssetsTwoKids"];
  it.each(ids)("%s: 値の状態の欄の鍵は登録簿にあり、値の箱と二重に書かず、欄のキー・動かす項目のキーを書かない", async (id) => {
    const { ITEM_PLACES } = await import("../src/generated/readings.ts");
    const { readAt } = await import("../src/workspace/store/readings.ts");
    const { wh, cat } = open(id);
    const values = Object.fromEntries(cat.items.slice(0, 5).map((it) => [it.key, it.read(wh)]));
    const w = savePlan({ ...wh, assumed: Object.fromEntries(cat.items.slice(0, 3).map((it) => [it.key.replace(/^field:/, ""), "仮の値"])) }, cat, { name: "B", base: null, values, now: NOW }).wh;
    const stored = bodyObject(state(w)) as unknown as { household: { request: { input: Obj } }; proposals: { diffs: Obj[] }[]; workspace: { shownItems: unknown[] } };
    const input = stored.household.request.input;
    const problems: string[] = [];
    const check = (states: unknown, target: (item: string) => Obj, owner: string) => {
      for (const key of Object.keys((states as Obj | undefined) ?? {})) {
        const [item, ...at] = key.split("/");
        if (ITEM_PLACES[item!] === undefined) problems.push(`${owner}: ${key} の入力項目ID が登録簿に無い`);
        const v = readAt(input, { target: target(item!) as never, item: item!, at });
        if (v !== null && typeof v === "object" && "state" in (v as Obj)) problems.push(`${owner}: ${key} を値の箱と二重に書いている`);
      }
    };
    check(input.valueStates, (item) => ({ plan: item.startsWith("assumptions.") ? "assumptions" : "input" }), "input");
    for (const [coll, list] of Object.entries(input.household as Obj)) if (Array.isArray(list)) for (const o of list as Obj[]) if (o.valueStates !== undefined) check(o.valueStates, () => (coll === "members" ? { member: o.id } : { object: o.id }), `${coll}/${String(o.id)}`);
    expect(problems).toEqual([]);
    expect(stored.proposals.flatMap((p) => p.diffs).every((d) => d.key === undefined)).toBe(true);
    expect(stored.workspace.shownItems.every((x) => typeof x !== "string")).toBe(true);
  });
});
