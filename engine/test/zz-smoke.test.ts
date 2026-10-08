import { it } from "vitest";
import { runEngine } from "../src/engine/run.ts";
import { box, fictionalPacks, household, member, period, uid } from "../test/helpers.ts";
it("smoke", () => {
  const req = household({
    baseMonth: "2026-04", endYear: 2045,
    members: [member("h", "self", "1962-05", { sex: "male" }), member("w", "spouse", "1965-08")],
    relations: [{ type: "spouse", a: uid("h"), b: uid("w"), marriage: "legal", from: null, to: null }],
    periods: [period("p1", { member: "h", from: "1985-04", to: "2027-03", annual: 6000000, bonus: 1000000 })],
  });
  (req.input.household as any).pensionRecords = [
    { id: uid("r1"), member: uid("h"), kind: "statementOver50", asOf: "2025-06", months: { basic: 480, employee: 480 }, amounts: { basic: box(800000), employee: box(1200000) } },
  ];
  const r = runEngine(req, fictionalPacks(), { checkInternal: true });
  const sum = (row: string, y: number) => (r.table as any[]).filter((c) => c.row === row && c.year === y).reduce((s, c) => s + c.amount, 0);
  for (const y of [2026, 2027, 2028, 2030, 2031, 2040]) console.log(y, ["cf.income.salary", "cf.income.pension", "cf.taxSi.incomeTax", "cf.taxSi.residentTax", "cf.taxSi.health", "cf.taxSi.care", "cf.taxSi.pension", "cf.net"].map((row) => `${row.split(".").pop()}=${row === "cf.net" ? r.annual.find((a) => a.row === row && a.year === y)?.amount : sum(row, y)}`).join(" "));
  console.log(JSON.stringify(r.header.notices));
});
it("debug", () => {
  const req = household({
    baseMonth: "2026-04", endYear: 2030,
    members: [member("h", "self", "1962-05", { sex: "male" }), member("w", "spouse", "1965-08")],
    relations: [{ type: "spouse", a: uid("h"), b: uid("w"), marriage: "legal", from: null, to: null }],
    periods: [period("p1", { member: "h", from: "1985-04", to: "2027-03", annual: 6000000, bonus: 1000000 })],
  });
  (req.input.household as any).pensionRecords = [
    { id: uid("r1"), member: uid("h"), kind: "statementOver50", asOf: "2025-06", months: { basic: 480, employee: 480 }, amounts: { basic: box(800000), employee: box(1200000) } },
  ];
  for (const y of [2027, 2028]) {
    const o = runEngine(req, fictionalPacks(), { checkInternal: true, entry: { component: "incomeTax.annual", input: { member: uid("h"), year: y } } }).entryOutput;
    const t = runEngine(req, fictionalPacks(), { checkInternal: true, entry: { component: "tax.totalIncome", input: { member: uid("h"), year: y } } }).entryOutput;
    const d = runEngine(req, fictionalPacks(), { checkInternal: true, entry: { component: "tax.deductions", input: { member: uid("h"), year: y, regime: "incomeTax" } } }).entryOutput;
    console.log(y, JSON.stringify(t), JSON.stringify(d), JSON.stringify(o));
  }
});
