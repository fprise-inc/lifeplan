// 土台のプランを外す・別のプランの値から保存するとき、写した差分を重ねても中身が変わらない（0036 の追記 2026-11-08・0177）。
// 土台で足した物を上のプランで外していると、1つのプランの中の当てる順（外す → 足す）で外すが空振りし、足すが物を戻していた。
// 性質: 土台のプランをどの順で外しても、残ったプランの計算の要求は変わらない。土台なしで保存し直しても同じ
import { describe, expect, it } from "vitest";
import { fromRequest, mutate, type WorkingHousehold } from "../src/workspace/input/household.ts";
import { addCar } from "../src/workspace/input/stages/cars.ts";
import { addAdvisoryFee } from "../src/workspace/input/stages/fees.ts";
import { buildCatalog, type Catalog } from "../src/workspace/plans/items.ts";
import { planView, recordPlanEdit, withoutObjects } from "../src/workspace/plans/planEdit.ts";
import { applyPlan, deletePlan, dropChange, effectiveDiffs, effectiveValues, savePlan, type Proposal } from "../src/workspace/plans/plans.ts";
import { roles } from "../src/workspace/roles.ts";
import { modelHousehold } from "./helpers.ts";

const NOW = "2026-11-08T00:00:00Z";
const plan = (id: string, base: string | null = null): Proposal => ({ id, name: `プラン${id}`, createdAt: NOW, updatedAt: NOW, base, tags: [], diffs: [] });

function setup(id = "salariedCoupleTwoKids"): { wh: WorkingHousehold; cat: Catalog } {
  const req = modelHousehold(id);
  const self = roles(req).find((r) => r.key === "self")!.member;
  const wh = { ...fromRequest(req, {}), proposals: [plan("B"), plan("C", "B"), plan("D", "C")] };
  return { wh, cat: buildCatalog(wh, self.id, null) };
}
/** プランの中身（計算の要求の入力。キーの順をそろえて比べる） */
/** キーの順をそろえ、空の並びの欄は無い欄と同じとみる（物をすべて外した集まり〔cars: []〕と、足さなかった集まりは同じ中身） */
const sorted = (v: unknown): unknown =>
  Array.isArray(v)
    ? v.map(sorted)
    : v !== null && typeof v === "object"
      ? Object.fromEntries(
          Object.entries(v)
            .filter(([, x]) => !(Array.isArray(x) && x.length === 0))
            .sort(([a], [b]) => (a < b ? -1 : 1))
            .map(([k, x]) => [k, sorted(x)]),
        )
      : v;
const content = (w: WorkingHousehold, cat: Catalog, id: string) => JSON.stringify(sorted(applyPlan(w, id, cat).request.input));
const edit = (w: WorkingHousehold, cat: Catalog, id: string, f: (v: WorkingHousehold) => WorkingHousehold) => {
  const v = planView(w, cat, id);
  return recordPlanEdit(w, cat, id, v, f(v));
};
const fees = (w: WorkingHousehold, cat: Catalog, id: string) => (applyPlan(w, id, cat).request.input.household.advisoryFees ?? []).map((c) => c.id);

describe("土台で足した物を上のプランで外している（R5-001）", () => {
  function build() {
    const { wh, cat } = setup();
    const w1 = edit(wh, cat, "B", (v) => addAdvisoryFee(v, () => "6a1d1e7c-0000-4000-8000-000000000001"));
    return { w: edit(w1, cat, "C", (v) => withoutObjects(v, ["6a1d1e7c-0000-4000-8000-000000000001"])), cat };
  }
  it("土台を外しても、外した物は戻らない（写した足すと外すを打ち消す）", () => {
    const { w, cat } = build();
    expect(fees(w, cat, "C")).toEqual([]);
    const after = deletePlan(w, "B");
    expect(fees(after, cat, "C")).toEqual([]);
    expect(after.proposals.find((p) => p.id === "C")!.diffs).toEqual([]);
  });
  it("上のプランの値から、土台なしの新しいプランとして保存しても、外した物は入らない", () => {
    const { w, cat } = build();
    const r = savePlan(w, cat, { name: "E", base: null, values: effectiveValues(w, "C"), now: NOW });
    expect(fees(r.wh, cat, r.id)).toEqual([]);
  });
  it("引き継いだ足すを上のプランで「外す」（dropChange）にしても同じ", () => {
    const { wh, cat } = setup();
    const w1 = edit(wh, cat, "B", (v) => addAdvisoryFee(v, () => "6a1d1e7c-0000-4000-8000-000000000002"));
    const key = [...effectiveDiffs(w1, "C").keys()][0]!;
    const w2 = dropChange(w1, cat, "C", key);
    expect(fees(w2, cat, "C")).toEqual([]);
    expect(fees(deletePlan(w2, "B"), cat, "C")).toEqual([]);
  });
  it("上のプランの外すをオフにしてあれば物は残り、オンに戻すと（土台を外した後でも）外れる", () => {
    const { w, cat } = build();
    const off = { ...w, proposals: w.proposals.map((p) => (p.id === "C" ? { ...p, diffs: p.diffs.map((d) => ({ ...d, enabled: false })) } : p)) };
    const moved = deletePlan(off, "B");
    expect(fees(moved, cat, "C")).toEqual(["6a1d1e7c-0000-4000-8000-000000000001"]);
    const on = { ...moved, proposals: moved.proposals.map((p) => (p.id === "C" ? { ...p, diffs: p.diffs.map((d) => ({ ...d, enabled: true })) } : p)) };
    expect(fees(on, cat, "C")).toEqual([]);
  });
  it("土台で足した物の中の要素（料金の段階）を上のプランで外しても、土台を外して戻らない", () => {
    const { wh, cat } = setup();
    const id = "6a1d1e7c-0000-4000-8000-000000000003";
    const w1 = edit(wh, cat, "B", (v) => addAdvisoryFee(v, () => id, { oneTime: 0, per: "month", amount: 10000, steps: [{ year: 3, amount: 15000 }], onContingency: "stop" }));
    const w2 = edit(w1, cat, "C", (v) => mutate(v, (h) => void delete h.advisoryFees!.find((c) => c.id === id)!.terms!.recurring!.revision));
    const before = content(w2, cat, "C");
    expect(content(deletePlan(w2, "B"), cat, "C")).toBe(before);
  });
});

// ---- 性質のテスト: 3段のプラン（B ← C ← D）に、足す・外す・置き換え・並びの要素の足す外す・値の変更をばらばらに入れる ----

/** 決まった種から作る乱数（mulberry32） */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type Op = (v: WorkingHousehold, r: () => number, id: () => string) => WorkingHousehold;
const pick = <T,>(xs: readonly T[], r: () => number): T | undefined => (xs.length === 0 ? undefined : xs[Math.floor(r() * xs.length)]);
const OPS: readonly [string, Op][] = [
  ["車を足す", (v, _r, id) => addCar(v, id)],
  ["顧問料の契約を足す", (v, _r, id) => addAdvisoryFee(v, id, { oneTime: 300000, per: "month", amount: 10000, steps: [{ year: 2, amount: 12000 }], onContingency: "stop" })],
  [
    "車か顧問料の契約を外す",
    (v, r) => {
      const h = v.request.input.household;
      const x = pick([...(h.cars ?? []), ...(h.advisoryFees ?? [])].map((o) => o.id), r);
      return x === undefined ? v : withoutObjects(v, [x]);
    },
  ],
  [
    "料金の段階を足す",
    (v, r, id) =>
      mutate(v, (h) => {
        const c = pick((h.advisoryFees ?? []).filter((x) => x.terms?.recurring !== undefined), r);
        const rec = c?.terms?.recurring;
        if (rec === undefined) return;
        ((rec.revision ??= {}).steps ??= []).push({ id: id(), at: { at: `${2030 + Math.floor(r() * 10)}-01` }, ...(rec.monthly !== undefined ? { monthly: 20000 } : { annual: 240000 }) });
      }),
  ],
  [
    "料金の段階を外す",
    (v, r) =>
      mutate(v, (h) => {
        const c = pick((h.advisoryFees ?? []).filter((x) => (x.terms?.recurring?.revision?.steps ?? []).length > 0), r);
        const rev = c?.terms?.recurring?.revision;
        if (rev?.steps === undefined) return;
        const gone = pick(rev.steps, r);
        rev.steps = rev.steps.filter((s) => s !== gone);
      }),
  ],
  [
    "顧問料の額を変える",
    (v, r) =>
      mutate(v, (h) => {
        const rec = pick(h.advisoryFees ?? [], r)?.terms?.recurring;
        if (rec?.monthly !== undefined) rec.monthly += 1000 * (1 + Math.floor(r() * 5));
      }),
  ],
  [
    "顧問料の払い方を変える（段階も一緒に）",
    (v, r) =>
      mutate(v, (h) => {
        const rec = pick(h.advisoryFees ?? [], r)?.terms?.recurring;
        if (rec?.monthly === undefined) return;
        rec.annual = rec.monthly * 12;
        delete rec.monthly;
        for (const s of rec.revision?.steps ?? [])
          if (s.monthly !== undefined) {
            s.annual = s.monthly * 12;
            delete s.monthly;
          }
      }),
  ],
  [
    "車の値を変える",
    (v, r) =>
      mutate(v, (h) => {
        const c = pick(h.cars ?? [], r) as { price?: number } | undefined;
        if (c !== undefined && typeof c.price === "number") c.price += 100000;
      }),
  ],
];

describe("性質: 土台をどの順で外しても、残ったプランの中身は変わらない", () => {
  const HOUSEHOLDS = ["salariedCoupleTwoKids", "advisoryFeeProposal", "sampleParentsCare"];
  const CASES = 40;
  for (const hid of HOUSEHOLDS)
    it(`${hid}（${CASES}通り）`, () => {
      const { wh, cat } = setup(hid);
      for (let seed = 1; seed <= CASES; seed++) {
        const r = rng(seed * 7919 + hid.length);
        let n = 0;
        const id = () => `7e57${String(seed).padStart(4, "0")}-0000-4000-8000-${String(++n).padStart(12, "0")}`;
        let w = wh;
        const log: string[] = [];
        for (const pid of ["B", "C", "D"])
          for (let k = 0; k < 1 + Math.floor(r() * 3); k++) {
            const [name, op] = pick(OPS, r)!;
            log.push(`${pid}: ${name}`);
            w = edit(w, cat, pid, (v) => op(v, r, id));
          }
        const why = `${hid} 種 ${seed}: ${log.join(" / ")}`;
        const c = content(w, cat, "C");
        const d = content(w, cat, "D");
        expect(content(deletePlan(w, "B"), cat, "C"), why).toBe(c);
        expect(content(deletePlan(w, "B"), cat, "D"), why).toBe(d);
        expect(content(deletePlan(w, "C"), cat, "D"), why).toBe(d);
        expect(content(deletePlan(deletePlan(w, "B"), "C"), cat, "D"), why).toBe(d);
        expect(content(deletePlan(deletePlan(w, "C"), "B"), cat, "D"), why).toBe(d);
        // D の中身を、土台なし・B を土台にして新しいプランとして保存し直しても同じ
        for (const base of [null, "B"]) {
          const s = savePlan(w, cat, { name: "E", base, values: effectiveValues(w, "D"), now: NOW });
          expect(content(s.wh, cat, s.id), `${why}（土台 ${base ?? "なし"} で保存）`).toBe(d);
        }
      }
    });
});
