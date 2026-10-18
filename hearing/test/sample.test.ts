// 見本のシート（架空の記入例）: リポジトリの .xlsx が JSON から作り直したものと同じで、取り込むと期待どおりの世帯になる（0018 の7）
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { approveAll, importHearingSheet } from "../src/index.ts";
import { engineAvailable, HEARING_DIR, idSeq, preview } from "./helpers.ts";
import { sampleBytes, type SampleFile } from "./sample.ts";

const NAME = "basic-1-sample";
const json = JSON.parse(readFileSync(join(HEARING_DIR, "samples", `${NAME}.json`), "utf8")) as SampleFile;
const xlsx = new Uint8Array(readFileSync(join(HEARING_DIR, "samples", `${NAME}.xlsx`)));

describe("見本のシート basic-1", () => {
  it("リポジトリの .xlsx は、記入例の JSON から作り直したものと同じ（npm run sample）", async () => {
    expect(Buffer.compare(Buffer.from(await sampleBytes(`${NAME}.json`, json)), Buffer.from(xlsx))).toBe(0);
  });

  it("取り込むと、エラーなしで期待どおりの世帯の候補になる", async () => {
    const r = await importHearingSheet(xlsx, { baseMonth: "2026-10", newId: idSeq("sample") });
    if (!r.ok) throw new Error(JSON.stringify(r.issues));
    expect(r.issues.filter((i) => i.level === "error")).toEqual([]);
    const h = r.request.input.household;
    expect(h.members.map((m) => `${m.kind}:${m.birth.birthYearMonth}${m.expected ? "（予定）" : ""}`)).toEqual(["self:1986-05", "spouse:1988-09", "child:2016-04", "child:2019-11", "child:2027-02（予定）"]);
    const [p1, p2] = h.employmentPeriods;
    expect(p1).toMatchObject({ type: "regular", from: { at: "2009-04" }, to: { at: "2051-04" }, healthInsurance: { kind: "kyokaikenpo", insurer: "kyokaikenpo.11" }, pensionCategory: "employee1", employer: { size: 850, weeklyHours: "40" } });
    expect(p1?.salary?.annual.value).toBe(4600000);
    expect(p2).toMatchObject({ type: "partTime", healthInsurance: { kind: "dependent" }, pensionCategory: "none", employer: { size: 60, weeklyHours: "22.5" }, salary: { annual: { value: 1050000 }, bonus: { value: 0 } } });
    expect(p2?.standardMonthlyRemuneration).toBeUndefined();
    expect(h.residentTaxAssessments?.map((a) => a.amount.state)).toEqual(["confirmed", "notApplicable"]);
    expect(h.pensionRecords).toHaveLength(1);
    expect(h.pensionRecords?.[0]).toMatchObject({ kind: "statementUnder50", asOf: "2026-05", months: { basic: 240, employee: 210 } });
    expect(h.residences?.[0]).toMatchObject({ kind: "own", from: { at: "2020-03" }, propertyTax: { annual: { value: 120000 } }, maintenance: { monthly: { state: "notApplicable" } } });
    expect(h.debts?.[0]).toMatchObject({ principal: 35000000, rateSchedule: [{ type: "variable", rate: "0.00625" }], repayment: { method: "equalPayment", termMonths: 420 }, balance: { value: 29800000 }, balanceAsOf: "2026-10" });
    expect(h.goals?.map((g) => g.education?.stages.map((s) => `${s.stage}:${s.sector}${s.field !== undefined ? `/${s.field}` : ""}`))).toEqual([
      ["elementary:public", "juniorHigh:public", "highSchool:public", "university:private/humanities"],
      ["elementary:public", "juniorHigh:private", "highSchool:public"],
    ]);
    expect(h.accounts.map((a) => `${a.kind}:${a.marketValue.value}:${a.contributions[0]?.monthly ?? 0}`)).toEqual(["deposit:3200000:0", "nisa:850000:30000", "ideco:600000:23000", "deposit:1500000:0"]);
    expect(h.insuranceContracts.map((c) => `${c.template}:${c.premium.amount}`)).toEqual(["insurance.incomeProtection:3800", "insurance.medical:2400", "insurance.education:11000"]);
    expect(h.insuranceContracts[0]?.coverages).toMatchObject([{ benefit: "incomeProtection", amount: 150000 }]);
    expect(h.insuranceContracts[2]?.insured).toBe(h.members[2]?.id);
    expect(h.livingExpenses?.[0]?.monthly).toMatchObject({ value: 260000, state: "confirmed" });
    expect(h.savingsChecks?.[0]).toMatchObject({ year: 2026, actualSavings: { value: 900000 } });
    expect(r.consents.map((c) => `${c.kind}:${c.decision}`)).toEqual(["purpose:given", "familyInfo:given", "externalAi:refused"]);
    expect(r.memo).toHaveLength(4);
    // わからない項目は面談のチェックリストに載る
    expect(r.checklist.filter((c) => c.reason === "unknown").map((c) => c.label)).toEqual([
      "お子さま3 性別",
      "ご本人 退職金の見込み額",
      "配偶者の方 いまの勤め先の定年（辞める予定の年齢）",
      "配偶者の方 お手元の書類",
      "お子さま2 高校の後",
    ]);
    if (engineAvailable()) expect(preview(approveAll(r, "2026-10-17T10:00:00+09:00")).error).toBeUndefined();
  });
});

describe("別のソフトで保存し直した見本", () => {
  it("openpyxl（Python の Excel の読み書きの部品）で開いて保存し直した見本を、元の見本と同じ世帯に取り込める", async () => {
    // test/fixtures/basic-1-sample.resaved-openpyxl.xlsx は、samples/basic-1-sample.xlsx を openpyxl 3.1.5 で load_workbook → save したもの
    const resaved = new Uint8Array(readFileSync(join(HEARING_DIR, "test", "fixtures", `${NAME}.resaved-openpyxl.xlsx`)));
    const a = await importHearingSheet(xlsx, { baseMonth: "2026-10", newId: idSeq("same") });
    const b = await importHearingSheet(resaved, { baseMonth: "2026-10", newId: idSeq("same") });
    if (!a.ok || !b.ok) throw new Error("読めない");
    expect(b.request).toEqual(a.request);
    expect(b.issues.map((i) => i.code)).toEqual(a.issues.map((i) => i.code));
  });
});
