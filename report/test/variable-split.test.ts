// 変額保険を解約して保障と運用に分けるプラン（0233）の注意: 提案か比較のページのプランが、現状に解約の予定の無い変額保険を解約するときだけ、
// 「前提条件と注意書き」に頭の一文と注意の4つを載せる
import { describe, expect, it } from "vitest";
import { buildProposalInput } from "../src/build.ts";
import type { EngineRequest, ProposalBundle } from "../src/bundle.ts";
import { SPLIT_CAUTIONS, SPLIT_LEAD, splitCautionNotes, surrendersVariable } from "../src/variableSplit.ts";
import { modelHousehold, run } from "../scripts/engine.ts";

const V = "5d0c2f9e-6a1b-4c3d-9e8f-0a1b2c3d4e5f";

/** 見本の世帯に変額保険（2016年4月から月2万円・基本保険金額1000万円・円の目安の形）を入れる。surrender があれば解約の予定 */
function withVariable(surrender?: string, template = "insurance.variable"): EngineRequest {
  const req = modelHousehold("salariedCoupleTwoKids");
  const self = req.input.household.members.find((m) => m.kind === "self")!;
  (req.input.household as unknown as { insuranceContracts: unknown[] }).insuranceContracts = [
    {
      id: V,
      template,
      policyholder: self.id,
      insured: self.id,
      contractDate: "2016-04",
      currency: "JPY",
      premium: { amount: 20000, frequency: "monthly", payUntil: { memberAge: { member: self.id, years: 65, months: 0 } } },
      deductionCategory: { type: "general", regime: "new" },
      coverages: [{ id: "0c5b7e4d-bf60-4182-8d34-5f6071829304", role: "main", benefit: "death", amount: 10000000 }],
      simple: { estimate: true },
      schedule: { rows: [{ policyYear: 10, surrenderValue: 2000000 }] },
      ...(surrender !== undefined ? { surrender: { at: surrender } } : {}),
    },
  ];
  return req;
}

const bundleOf = (current: EngineRequest, proposal: EngineRequest, comparison?: EngineRequest[]): ProposalBundle => {
  const c = { request: current, result: run(current).result };
  const p = proposal === current ? c : { request: proposal, result: run(proposal).result };
  return {
    document: { issuedOn: "2026-11-19" },
    current: c,
    proposal: p,
    ...(comparison !== undefined ? { comparison: { base: 0, plans: comparison.map((r, i) => ({ letter: String.fromCharCode(65 + i), name: "プラン", run: r === current ? c : { request: r, result: run(r).result } })) } } : {}),
    layout: { orientation: "portrait", cashflow: "summary" },
  };
};
const expected = [SPLIT_LEAD, ...SPLIT_CAUTIONS.map((t) => `${t}。`)];

describe("変額保険を解約するプランの注意（提案書）", () => {
  it("現状に解約の予定の無い変額保険を、提案で解約するときだけ", () => {
    const now = withVariable();
    expect(surrendersVariable(now, withVariable("2026-10"))).toBe(true);
    expect(surrendersVariable(now, now)).toBe(false);
    // 現状でもう解約の予定がある・変額保険でない契約は出さない
    expect(surrendersVariable(withVariable("2030-01"), withVariable("2026-10"))).toBe(false);
    expect(surrendersVariable(withVariable(undefined, "insurance.wholeLife"), withVariable("2026-10", "insurance.wholeLife"))).toBe(false);
    expect(splitCautionNotes(now, [now])).toEqual([]);
    expect(splitCautionNotes(now, [now, withVariable("2026-10")])).toEqual(expected);
  });

  it("「前提条件と注意書き」の注に、頭の一文と注意の4つ（提案のプランが解約する）", () => {
    const now = withVariable();
    const notes = buildProposalInput(bundleOf(now, withVariable("2026-10"))).assumptions.notes;
    for (const n of expected) expect(notes).toContain(n);
    expect(buildProposalInput(bundleOf(now, now)).assumptions.notes.some((n) => n.includes("解約控除"))).toBe(false);
  });

  it("比較のページのプランが解約するときも載せる", () => {
    const now = withVariable();
    const notes = buildProposalInput(bundleOf(now, now, [now, withVariable("2026-10")])).assumptions.notes;
    expect(notes).toContain(SPLIT_LEAD);
  });
});
