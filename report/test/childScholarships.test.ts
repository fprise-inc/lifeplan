// 子が返す貸与の奨学金（0104）の書き添え: 提案書の前提の注に、子ごとに返済の期間・月々の額・合計を1文で
import { describe, expect, it } from "vitest";
import { buildProposalInput } from "../src/build.ts";
import type { EngineRequest, ProposalBundle } from "../src/bundle.ts";
import { childScholarshipNotes } from "../src/childScholarships.ts";
import { modelHousehold, run } from "../scripts/engine.ts";

function bundleOf(req: EngineRequest): ProposalBundle {
  const r = { request: req, result: run(req).result };
  return { document: { issuedOn: "2026-11-01" }, current: r, proposal: r, layout: { orientation: "portrait", cashflow: "summary" } };
}

describe("子が返す貸与の奨学金の書き添え", () => {
  it("子ごとに1文（期間・月々の額・合計）。同じ子の2件は期間を広げ、最初の月の額と合計を足す", () => {
    const summary = {
      childScholarships: [
        { object: "g", member: "c2", principal: 2592000, monthly: 14838, from: "2037-10", to: "2045-12", total: 1468962 },
        { object: "g", member: "c2", principal: 600000, monthly: 5000, from: "2037-10", to: "2047-09", total: 600000 },
      ],
    };
    expect(childScholarshipNotes(summary, () => "第2子")).toEqual(["第2子の奨学金の返済（2037年10月〜2047年9月・月々約2万円・合計約207万円）は、第2子が返すので世帯の収支に入れていません"]);
    expect(childScholarshipNotes({}, () => "第1子")).toEqual([]);
  });

  it("モデル世帯（子が返す奨学金あり）の提案書の前提の注に出る。世帯で返すなら出ない", () => {
    const req = modelHousehold("educationTwoKids");
    const notes = buildProposalInput(bundleOf(req)).assumptions.notes;
    expect(notes.filter((n) => n.includes("奨学金の返済"))).toEqual(["第2子の奨学金の返済（2037年10月〜2045年12月・月々約1.5万円・合計約147万円）は、第2子が返すので世帯の収支に入れていません。"]);
    const household = structuredClone(req);
    for (const g of household.input.household.goals ?? []) for (const s of g.education?.scholarships ?? []) (s as { repaidBy?: string }).repaidBy = "household";
    expect(buildProposalInput(bundleOf(household)).assumptions.notes.some((n) => n.includes("奨学金の返済"))).toBe(false);
  });
});
