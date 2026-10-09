// 0005・0006 の追記（2回目の見直し）: セッションの古い・最新の印、区間ごとの計算（ctx.segments）、構成員ごとの依存（memberScope）、
// 部品の出力の月の一部への依存（ctx.callMonths）
import { describe, expect, it } from "vitest";
import { OFFICIAL_COMPONENTS } from "../src/components/index.ts";
import { createSession, runBatch, runJson, type EngineResult } from "../src/engine/run.ts";
import type { EngineRequest } from "../src/engine/types.ts";
import type { Replacement } from "../src/registry/assemble.ts";
import { defineComponent, type ComponentDefinition } from "../src/registry/define.ts";
import { monthIndex, type CoverageOutput, type MonthIndex } from "../src/sdk/index.ts";
import { clone, modelHousehold, realPacks } from "./helpers.ts";

const HASH = `sha256:${"0".repeat(64)}`;
const official = (id: string) => OFFICIAL_COMPONENTS.find((o) => o.def.id === id)!.def;
const replace = (component: ComponentDefinition): Replacement => ({ type: "replace", target: component.id, contract: "1", component, hash: HASH });
const salaryOf = (r: EngineRequest, i: number, value: number) => {
  const p = r.input.household.employmentPeriods[i] as unknown as { salary: { annual: { value: number } } };
  p.salary.annual.value = value;
  return r;
};

describe("セッションの枠と古い・最新の印（0005 の追記の目標3）", () => {
  const packsJson = JSON.stringify(realPacks());
  const base = modelHousehold("dualHighTwoKids");

  it("置いただけの枠は missing、計算した枠は fresh、要求が変わった枠は stale（前の結果は残る）", () => {
    const s = createSession(packsJson);
    expect(JSON.parse(s.set(JSON.stringify({ a: base, b: salaryOf(clone(base), 1, 5000000) })))).toEqual({
      a: { rev: 1, state: "missing" },
      b: { rev: 1, state: "missing" },
    });
    const first = JSON.parse(s.compute('["a"]', '{"preview":true}')) as Record<string, { rev: number; state: string; result: unknown }>;
    expect(Object.keys(first)).toEqual(["a"]);
    expect(first.a?.state).toBe("fresh");
    expect(JSON.parse(s.status())).toEqual({ a: { rev: 1, state: "fresh" }, b: { rev: 1, state: "missing" } });
    // 同じ要求を置き直しても番号は変わらない。変えると stale で、前の結果と先出しかどうかを返す
    s.set(JSON.stringify({ a: base }));
    expect(JSON.parse(s.status()).a).toEqual({ rev: 1, state: "fresh" });
    s.set(JSON.stringify({ a: salaryOf(clone(base), 0, 7100000) }));
    const stale = JSON.parse(s.results('["a"]')) as Record<string, { rev: number; resultRev: number; state: string; preview: boolean; result: unknown }>;
    expect(stale.a).toMatchObject({ rev: 2, resultRev: 1, state: "stale", preview: true });
    expect(JSON.stringify(stale.a?.result)).toBe(JSON.stringify(first.a?.result));
    // 省略すると古い枠と、まだの枠をすべて計算する
    const rest = JSON.parse(s.compute()) as Record<string, { rev: number; state: string }>;
    expect(Object.keys(rest).sort()).toEqual(["a", "b"]);
    expect(JSON.parse(s.status())).toEqual({ a: { rev: 2, state: "fresh" }, b: { rev: 1, state: "fresh" } });
    expect(JSON.parse(s.results('["a"]')).a.preview).toBe(false);
    // null で枠を消す。知らない枠は ID だけのエラー
    s.set(JSON.stringify({ b: null }));
    expect(Object.keys(JSON.parse(s.status()))).toEqual(["a"]);
    expect(JSON.parse(s.compute('["b"]'))).toEqual({ error: { code: "E_ARGUMENT", ids: ["session.ids"] } });
  });

  it("スライダーのように世帯の入力を何度も変えても、どの枠の結果も1件ずつ計算したときと同じ（想定をまたぐ使い回し・枠の番号の使い回し）", () => {
    const s = createSession(packsJson, '{"checkInternal":true}');
    const scenarios = (r: EngineRequest) => {
      const leave = clone(r);
      const m = leave.input.household.members[1] as unknown as { leaves: unknown };
      m.leaves = { at: "2027-04" };
      (leave.input.household.employmentPeriods[1] as unknown as { to: unknown }).to = { at: "2027-04" };
      return { s0: r, s1: leave };
    };
    for (const [k, v] of [5000000, 5100000, 5000000, 4000000, 1200000].entries()) {
      const slots = scenarios(salaryOf(clone(base), 1, v));
      if (k === 3) s.set(JSON.stringify({ s1: null }));
      s.set(JSON.stringify(slots));
      const out = JSON.parse(s.compute(undefined, '{"preview":true}')) as Record<string, { result: unknown }>;
      for (const [id, r] of Object.entries(slots)) {
        const full = JSON.parse(runJson(JSON.stringify(r), packsJson)) as EngineResult;
        expect(JSON.stringify(out[id]?.result)).toBe(JSON.stringify({ header: full.header, table: full.table }));
      }
    }
  });
});

describe("区間ごとの計算（ctx.segments）", () => {
  it("区間の at で読む値は、区間のどの月で ctx.at(m) を読んでも同じ（年・年度・境目の月で区切る）", () => {
    const mismatches: string[] = [];
    let segments = 0;
    const def = official("socialInsurance.pension");
    const probe = defineComponent({
      ...def,
      compute(input, ctx) {
        const from = monthIndex(2026, 10);
        const to = monthIndex(2080, 12);
        for (const opts of [{ params: [...def.params] }, { params: [...def.params], every: "fiscalYear" as const, breaks: [monthIndex(2030, 7)] }]) {
          const segs = ctx.segments(from, to, opts);
          segments += segs.length;
          let next: MonthIndex = from;
          for (const seg of segs) {
            if (seg.from !== next) mismatches.push(`gap ${seg.from}`);
            next = (seg.to + 1) as MonthIndex;
            if (opts.every === "fiscalYear" && seg.to - seg.from >= 12) mismatches.push(`fiscalYear ${seg.from}`);
            if (opts.breaks !== undefined && seg.from < monthIndex(2030, 7) && seg.to >= monthIndex(2030, 7)) mismatches.push(`break ${seg.from}`);
            for (let m = seg.from; m <= seg.to; m++) {
              for (const id of def.params) {
                if (JSON.stringify(seg.at.param(id).entry.value) !== JSON.stringify(ctx.at(m as MonthIndex).param(id).entry.value)) mismatches.push(`${id} ${m}`);
              }
            }
          }
          if (next !== to + 1) mismatches.push("end");
        }
        return def.compute(input as never, ctx);
      },
    }) as ComponentDefinition;
    runBatch([modelHousehold("lifetime100")], realPacks(), { checkInternal: true, replacements: [replace(probe)] });
    expect(segments).toBeGreaterThan(0);
    expect(mismatches).toEqual([]);
  });

  it("区間の at では、区間の値（params）に書いていない値は読めない", () => {
    const def = official("socialInsurance.pension");
    const bad = defineComponent({
      ...def,
      compute(input, ctx) {
        const [seg] = ctx.segments(monthIndex(2027, 1), monthIndex(2027, 12), { params: [def.params[0] as string] });
        seg?.at.param(def.params[1] as string);
        return def.compute(input as never, ctx);
      },
    }) as ComponentDefinition;
    expect(runBatch([modelHousehold("single25")], realPacks(), { replacements: [replace(bad)] })[0]).toEqual({
      error: { code: "E_PARAM_UNDECLARED", ids: ["socialInsurance.pension", def.params[1], "segment"] },
    });
  });
});

describe("構成員ごとの依存（memberScope）と、出力の月の一部への依存（ctx.callMonths）", () => {
  it("memberScope は、入力の member を持つ集まり（x-owner）で reads に書いたものだけ", () => {
    const def = official("income.salary");
    expect(() => defineComponent({ ...def, memberScope: ["relation"] })).toThrow("E_COMPONENT_DEFINITION");
    expect(() => defineComponent({ ...def, memberScope: ["account"] })).toThrow("E_COMPONENT_DEFINITION");
    expect(() => defineComponent({ ...def })).not.toThrow();
  });

  it("配偶者の年収だけを変えた要求では、本人の厚生年金保険料の部品を計算し直さない（結果は1件ずつと同じ）", () => {
    const calls = new Map<string, number>();
    const def = official("socialInsurance.pension");
    const counting = defineComponent({
      ...def,
      compute(input, ctx) {
        const m = (input as { member: string }).member;
        calls.set(m, (calls.get(m) ?? 0) + 1);
        return def.compute(input as never, ctx);
      },
    }) as ComponentDefinition;
    const base = { ...modelHousehold("dualHighTwoKids"), trace: "none" as const };
    const [self, spouse] = base.input.household.members.map((m) => m.id) as [string, string];
    const reqs = [base, salaryOf(clone(base), 1, 6100000), salaryOf(clone(base), 1, 6200000)];
    const opts = { checkInternal: true, replacements: [replace(counting)] };
    const batch = runBatch(reqs, realPacks(), opts);
    expect(calls.get(self)).toBe(1);
    expect(calls.get(spouse)).toBe(3);
    reqs.forEach((r, i) => expect(JSON.stringify(batch[i])).toBe(JSON.stringify(runBatch([r], realPacks(), opts)[0])));
  });

  it("ctx.callMonths は、出力の月の並びのうちその月の分だけを返す（年ごとの部品が全期間の出力の1年分を読む形）", () => {
    const def = official("socialInsurance.pension");
    const seen: string[] = [];
    const probe = defineComponent({
      ...def,
      compute(input, ctx) {
        const all = ctx.call<CoverageOutput>("socialInsurance.coverage", input).months;
        const part = ctx.callMonths<CoverageOutput["months"][number]>("socialInsurance.coverage", input, "months", monthIndex(2027, 1), monthIndex(2027, 12));
        const want = all.filter((x) => x.month >= "2027-01" && x.month <= "2027-12");
        seen.push(JSON.stringify(part) === JSON.stringify(want) && part.length === 12 ? "ok" : "ng");
        expect(() => ctx.callMonths("socialInsurance.coverage", input, "nothing", monthIndex(2027, 1), monthIndex(2027, 12))).toThrow("E_ARGUMENT");
        return def.compute(input as never, ctx);
      },
    }) as ComponentDefinition;
    runBatch([modelHousehold("single25")], realPacks(), { checkInternal: true, replacements: [replace(probe)] });
    expect(seen.length).toBeGreaterThan(0);
    expect(seen.every((x) => x === "ok")).toBe(true);
  });
});
