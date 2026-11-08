// FP顧問料の料金の段階（0070 の追記 2026-11-08）: 払い方（月額⇄年額）を変えると段階も同じ払い方に直す・段階の欄は段階の払い方で出す・
// 段階に打っても年額と月額の両方を持たない・提案書の段階の文が計算と同じ月と額になる（年額の払う月・始まりと同じ月の段階）
import { describe, expect, it } from "vitest";
import type { EngineRequest, PreviewResult } from "../src/engine/types.ts";
import { forEngine } from "../src/engine/moneyRows.ts";
import { demoHousehold } from "../src/workspace/catalog.ts";
import { allFields, type FieldDef } from "../src/workspace/input/form.ts";
import { fromRequest, mutate, type WorkingHousehold } from "../src/workspace/input/household.ts";
import { addAdvisoryFee, feeStage } from "../src/workspace/input/stages/fees.ts";
import { CURRENT, planLetters } from "../src/workspace/plans/band.ts";
import { buildCatalog } from "../src/workspace/plans/items.ts";
import { effectiveValues, savePlan } from "../src/workspace/plans/plans.ts";
import { DEFAULT_CHAPTERS, planReport, reportInput, type ReportChoice } from "../src/workspace/report/assemble.ts";
import { roles } from "../src/workspace/roles.ts";
import { modelHousehold, preview } from "./helpers.ts";

const ID = "salariedCoupleTwoKids";
const NOW = "2026-11-08T10:00:00.000Z";
/** 事務所の料金表: 月1万円・3年目から月1.5万円（単発なし） */
const TABLE = { oneTime: 0, per: "month" as const, amount: 10000, steps: [{ year: 3, amount: 15000 }], onContingency: "stop" as const };

const fieldBy = (w: WorkingHousehold, re: RegExp): FieldDef => allFields(feeStage(w)).find((f) => re.test(f.key)) as FieldDef;
const rec = (w: WorkingHousehold) => w.request.input.household.advisoryFees!.at(-1)!.terms!.recurring!;
function feeByYear(req: EngineRequest): Record<number, number> {
  const out: Record<number, number> = {};
  for (const c of (preview(req) as unknown as { table: { row: string; year: number; amount: number }[] }).table) if (c.row.startsWith("cf.expense.advisoryFee")) out[c.year] = (out[c.year] ?? 0) + c.amount;
  return out;
}
function build(): WorkingHousehold {
  let w = fromRequest(modelHousehold(ID), {});
  w = addAdvisoryFee(w, undefined, TABLE);
  return mutate(w, (h) => void (h.advisoryFees!.at(-1)!.enabled = true));
}

describe("払い方を変えたときの料金の段階", () => {
  it("月額→年額: 段階も年額（月1.5万円→年18万円）になり、段階の欄に出る", () => {
    const w0 = build();
    const w = fieldBy(w0, /\/rec\/basis$/).set!(w0, "annual");
    expect(rec(w).annual).toBe(120000);
    expect(rec(w).revision!.steps![0]).not.toHaveProperty("monthly");
    expect(rec(w).revision!.steps![0]!.annual).toBe(180000);
    expect(fieldBy(w, /\/rec\/step\/.*\/annual$/).get(w).value).toBe(180000);
  });
  it("年額→月額に戻すと、段階も月額に戻る", () => {
    const w0 = build();
    let w = fieldBy(w0, /\/rec\/basis$/).set!(w0, "annual");
    w = fieldBy(w, /\/rec\/basis$/).set!(w, "monthly");
    expect(rec(w).monthly).toBe(10000);
    expect(rec(w).revision!.steps![0]).toMatchObject({ monthly: 15000 });
    expect(rec(w).revision!.steps![0]).not.toHaveProperty("annual");
  });
  it("年額に変えた後に段階の欄へ年額を打っても、二重に数えない（段階の年の翌年から年18万円）", () => {
    const w0 = build();
    let w = fieldBy(w0, /\/rec\/basis$/).set!(w0, "annual");
    w = fieldBy(w, /\/rec\/step\/.*\/annual$/).set!(w, 180000);
    const stepYear = Number((rec(w).revision!.steps![0]!.at as { at: string }).at.slice(0, 4));
    expect(feeByYear(w.request)[stepYear + 1]).toBe(180000);
  });
  it("前の版で払い方だけを変えた段階（年額の契約に月額の段階）は、段階の欄を月額で出し、打つと月額だけを持つ", () => {
    // 直す前の払い方の切り替えで残った形
    let w = mutate(build(), (h) => {
      const r = h.advisoryFees!.at(-1)!.terms!.recurring!;
      r.annual = 120000;
      delete r.monthly;
    });
    const f = fieldBy(w, /\/rec\/step\/[^/]+\/(annual|monthly)$/);
    expect(f.key.endsWith("/monthly")).toBe(true);
    expect(f.get(w).value).toBe(15000);
    w = f.set!(w, 16000);
    expect(rec(w).revision!.steps![0]).toMatchObject({ monthly: 16000 });
    expect(rec(w).revision!.steps![0]).not.toHaveProperty("annual");
  });
});

/** 提案書の FP顧問料の注と、提案の顧問料の年ごとの額 */
function reportOf(edit: (w: WorkingHousehold) => WorkingHousehold) {
  const req = modelHousehold(ID);
  const self = roles(req).find((r) => r.key === "self")!.member;
  let wh = fromRequest(req, { memo: [] });
  wh = edit(addAdvisoryFee(wh, undefined, TABLE));
  const cat = buildCatalog(wh, self.id, demoHousehold(ID) ?? null);
  const b = savePlan(wh, cat, { name: "プランB", base: null, values: { "lever:fee": true }, now: NOW });
  wh = b.wh;
  const letters = planLetters(wh.proposals);
  const ctx = { wh, catalog: cat, valuesOf: (pid: string) => (pid === CURRENT ? {} : effectiveValues(wh, pid)), letterOf: (pid: string) => letters.get(pid) ?? { letter: "?", name: "" } };
  const choice: ReportChoice = { proposal: b.id, compare: [CURRENT, b.id], base: CURRENT, chapters: DEFAULT_CHAPTERS, targetAge: 95, issuedOn: "2026-11-08", preparedBy: "" };
  const plan = planReport(ctx, choice);
  const results = Object.fromEntries(Object.entries(plan.requests).map(([k, r]) => [k, preview(forEngine(r))])) as Record<string, PreviewResult>;
  const fee: Record<number, number> = {};
  for (const c of (results.proposal as PreviewResult).table) if (c.row.startsWith("cf.expense.advisoryFee")) fee[c.year] = (fee[c.year] ?? 0) + c.amount;
  return { revision: reportInput(plan.bundle(results)).assumptions.advisoryFee!.contracts[0]!.recurring!.revision, fee };
}
const setRec = (f: (r: ReturnType<typeof rec>) => void) => (w: WorkingHousehold) => mutate(w, (h) => f(h.advisoryFees!.at(-1)!.terms!.recurring!));

describe("提案書の料金の段階の文は、計算と同じ月と額", () => {
  it("月額のまま: 「…から月15,000円」", () => {
    expect(reportOf((w) => w).revision).toMatch(/から月15,000円$/);
  });
  it("払い方を年額に変えた後: 「…から年180,000円」で、計算もその翌年から年18万円", () => {
    const { revision, fee } = reportOf((w) => fieldBy(w, /\/rec\/basis$/).set!(w, "annual"));
    const m = /^(\d{4})年(\d+)月から年180,000円$/.exec(revision ?? "");
    expect(m).not.toBeNull();
    expect(fee[Number(m![1]) + 1]).toBe(180000);
  });
  it("年額の段階を払う月と違う月に入れると、文は次の払う月（計算と同じ月）", () => {
    const { revision, fee } = reportOf(
      setRec((r) => {
        r.from = { at: "2027-01" };
        delete r.monthly;
        r.annual = 120000;
        r.revision = { steps: [{ id: "5d0c1f7e-6a8b-4c2d-9e3f-1a2b3c4d5e6f", at: { at: "2029-07" }, annual: 150000 }] };
      }),
    );
    expect(revision).toBe("2030年1月から年150,000円");
    expect([fee[2029], fee[2030]]).toEqual([120000, 150000]);
  });
  it("段階を始まりと同じ月にすると、文も計算も始まりから段階の額", () => {
    const { revision, fee } = reportOf(
      setRec((r) => {
        r.from = { at: "2027-01" };
        delete r.monthly;
        r.annual = 120000;
        r.revision = { steps: [{ id: "5d0c1f7e-6a8b-4c2d-9e3f-1a2b3c4d5e6f", at: { at: "2027-01" }, annual: 200000 }] };
      }),
    );
    expect(revision).toBe("2027年1月から年200,000円");
    expect(fee[2027]).toBe(200000);
  });
});
