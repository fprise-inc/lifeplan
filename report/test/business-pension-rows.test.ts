// 提案書のキャッシュフロー表の「○○の事業所得」（人ごと）と「企業年金・個人年金」の行、家族の行に世帯の外の家族を出さない（アプリの表と同じ。0146）
import { describe, expect, it } from "vitest";
import type { ProposalBundle } from "../src/bundle.ts";
import { buildProposalInput } from "../src/build.ts";
import { ROW_NAMES } from "../src/rowNames.ts";
import { modelHousehold, runAll } from "../scripts/engine.ts";

const inputOf = (id: string) => {
  const req = modelHousehold(id);
  const [cur, prop] = runAll([req, req]);
  const bundle: ProposalBundle = { document: { issuedOn: "2026-11-07", preparedBy: "見本FP事務所（架空）" }, current: cur!, proposal: prop!, targetAge: 95, layout: { orientation: "portrait", cashflow: "full" } };
  return { input: buildProposalInput(bundle), result: cur!.result };
};

describe("事業所得と企業年金の行", () => {
  it("自営業の事業所得は「ご本人の事業所得」の行で、その他の収入に入れない（収入合計は同じ）", () => {
    const { input, result } = inputOf("sampleSelfEmployedFamily");
    const rows = input.cashflow.current.rows;
    const biz = rows.find((r) => r.key === "business:self")!;
    expect(biz.label).toBe("ご本人の事業所得");
    expect(ROW_NAMES.business).toBe("{person}の事業所得");
    const y = input.basis.years.indexOf(2027);
    const sum = result.table.filter((c) => c.year === 2027 && c.row.startsWith("cf.income.business")).reduce((s, c) => s + c.amount, 0);
    expect(biz.cells[y]).toBe(sum);
    const keys = rows.map((r) => r.key);
    const income = rows.filter((r) => r.kind === "value" && keys.indexOf(r.key) < keys.indexOf("incomeTotal"));
    expect(income.reduce((s, r) => s + (r.cells[y] ?? 0), 0)).toBe(rows.find((r) => r.key === "incomeTotal")!.cells[y]);
  });

  it("年金で受け取る企業年金・iDeCo などは「企業年金・個人年金」の行", () => {
    const { input, result } = inputOf("idecoPayout");
    const row = input.cashflow.current.rows.find((r) => r.key === "corporatePension")!;
    expect(row.label).toBe("企業年金・個人年金");
    const years = input.basis.years;
    const total = (y: number) => result.table.filter((c) => c.year === y && c.row.startsWith("cf.income.corporatePension")).reduce((s, c) => s + c.amount, 0);
    const y = years.find((x) => total(x) > 0)!;
    expect(row.cells[years.indexOf(y)]).toBe(total(y));
  });
});

describe("家族の行", () => {
  it("世帯の外の家族（介護・親で足した親）は家族の行に出さない", () => {
    const { input } = inputOf("parentMoney");
    expect(input.members.map((m) => m.label)).toEqual(["ご本人"]);
  });
});
