// 年金の記録が無い人（働き方の期間からの推計）の受給を始める月（構成員の pensionClaim。0078）: 繰上げ・繰下げを推計でも読む。
// 省略は65歳に達した月の翌月（今までどおり）。記録があるときは記録の claim を使い、構成員の pensionClaim は読まない
import { describe, expect, it } from "vitest";
import { runEngine } from "../src/engine/run.ts";
import type { EngineRequest } from "../src/engine/types.ts";
import type { PensionOutput } from "../src/sdk/contracts.ts";
import { box, household, member, period, realPacks, uid } from "./helpers.ts";

type Obj = Record<string, unknown>;
const A = uid("pce.a");
const months = (req: EngineRequest) => (runEngine(req, realPacks(), { checkInternal: true, entry: { component: "pension.oldAgeBase", input: { member: A } } }).entryOutput as PensionOutput).months;
const first = (req: EngineRequest, part: "basic" | "employee") => months(req).find((x) => x[part] > 0)?.month;
const annualAt = (req: EngineRequest, ym: string) => {
  const m = months(req).find((x) => x.month === ym);
  return m === undefined ? 0 : m.basic + m.employee;
};

/** 1966年5月生まれの会社員（22歳から勤める）。記録は無い（推計） */
function single(claim?: Obj, records?: Obj[]): EngineRequest {
  const req = household({
    baseMonth: "2026-04",
    endYear: 2050,
    members: [member("pce.a", "self", "1966-05", { sex: "male", ...(claim !== undefined ? { pensionClaim: claim } : {}) })],
    periods: [period("pce.p", { member: "pce.a", from: "1989-04", to: "2031-03", annual: 6000000, bonus: 1000000 })],
    residentTaxAssessments: [{ id: uid("pce.rta"), member: A, fiscalYear: 2026, amount: box(300000) }],
  });
  if (records !== undefined) ((req.input as unknown as Obj).household as Obj).pensionRecords = records;
  return req;
}

describe("推計の受給を始める月（構成員の pensionClaim）", () => {
  it("省略は65歳に達した月の翌月", () => {
    expect(first(single(), "basic")).toBe("2031-06");
  });

  it("繰下げ（70歳）: その月から受け取り、額は増える。繰上げ（63歳）: その月から受け取り、額は減る", () => {
    const std = single();
    const late = single({ basic: { at: "2036-05" }, employee: { at: "2036-05" } });
    expect(first(late, "basic")).toBe("2036-05");
    expect(first(late, "employee")).toBe("2036-05");
    expect(annualAt(late, "2040-05")).toBeGreaterThan(annualAt(std, "2040-05"));
    const early = single({ basic: { at: "2029-05" }, employee: { at: "2029-05" } });
    expect(first(early, "basic")).toBe("2029-05");
    expect(annualAt(early, "2040-05")).toBeLessThan(annualAt(std, "2040-05"));
  });

  it("年金の記録があれば、記録の claim を使い、構成員の pensionClaim は読まない", () => {
    const rec = { id: uid("pce.rec"), member: A, kind: "projection", asOf: "2026-04", amounts: { basic: box(800000), employee: box(1000000) } };
    const withRec = single({ basic: { at: "2036-05" }, employee: { at: "2036-05" } }, [rec]);
    expect(first(withRec, "basic")).toBe("2031-06");
  });
});
