import { describe, expect, it } from "vitest";
import { buildEvidence, paramValueText } from "../src/workspace/evidence.ts";
import { applyLevers } from "../src/workspace/levers.ts";
import { demoHousehold } from "../src/workspace/catalog.ts";
import { roles } from "../src/workspace/roles.ts";
import { full, modelHousehold, preview } from "./helpers.ts";

const base = modelHousehold("salariedCoupleTwoKids");
const self = roles(base).find((r) => r.key === "self")!.member;
const demo = demoHousehold("salariedCoupleTwoKids")!;
const proposal = applyLevers(base, self.id, demo.firstProposal, { reemployment: demo.reemployment! });
const out = full(proposal);

describe("根拠の表示（0006 の7）", () => {
  it("年金のマス: 合計は表のマスと同じ、内訳は計算式ごと、使った制度の値と出典が出る", () => {
    const v = buildEvidence(out, proposal, "pension:self", 2047)!;
    const cell = preview(proposal).table.filter((c) => c.row.startsWith("cf.income.pension") && c.member === self.id && c.year === 2047).reduce((s, c) => s + c.amount, 0);
    expect(v.title).toBe("2047年 ご主人の年金");
    expect(v.total).toBe(cell);
    expect(v.breakdown.map((b) => b.label)).toEqual(["老齢基礎年金", "老齢厚生年金"]);
    expect(v.breakdown.reduce((s, b) => s + b.amount, 0)).toBe(v.total);
    expect(v.params.length).toBeGreaterThan(0);
    expect(v.params.some((p) => p.source.includes("国民年金法") || p.source.includes("厚生年金保険法"))).toBe(true);
    expect(v.params.every((p) => /^\d{4}\.\d+\.\d+$/.test(p.version))).toBe(true);
  });

  it("金融資産（年に1回決まる行）の根拠も出せる", () => {
    const v = buildEvidence(out, proposal, "financial", 2030)!;
    expect(v.breakdown[0]!.label).toBe("年末の金融資産");
  });

  it("提示してよい項目だけ: 部品の指紋・物の ID を含まない", () => {
    const json = JSON.stringify(buildEvidence(out, proposal, "pension:self", 2047));
    expect(json).not.toContain("sha256:");
    for (const m of proposal.input.household.members) expect(json).not.toContain(m.id);
  });

  it("値が無いマス・知らない行は null", () => {
    expect(buildEvidence(out, proposal, "pension:self", 2027)).toBeNull();
    expect(buildEvidence(out, proposal, "nope", 2047)).toBeNull();
  });

  it("制度の値の文字", () => {
    expect(paramValueText("pension.basic.maxMonths", 480)).toBe("480月");
    expect(paramValueText("x", 780900)).toBe("780,900");
    expect(paramValueText("x", [1, 2, 3])).toBe("表（3段）");
    expect(paramValueText("x", "0.005481")).toBe("0.005481");
    expect(paramValueText("x", "notApplicable")).toBe("該当なし");
  });
});
