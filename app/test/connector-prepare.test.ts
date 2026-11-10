// AI接続口の計算の前の処理（0184）: 接続口に同梱する prepare（src/connector/prepare.ts）が、画面がエンジンへ渡す前に当てる処理
// （engine/moneyRows.ts の forEngine。事務所の推定の値は、画面が事務所データを読んで publishOfficeSettings で入れた物）と同じ要求を作ること。
// 接続口のテスト（crates/lifeplan/tests/mcp_connector.rs の calculation_matches_the_screen_after_preparation）は、ここで作る見本
// （前処理が効く世帯・事務所の推定の値・画面の数字と根拠）を、本物の接続口に渡された世帯として MCP で計算させて比べる。
// 見本を作り直すときは LIFEPLAN_UPDATE_FIXTURES=1 で流す
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { prepare, type Applied } from "../src/connector/prepare.ts";
import { forEngine } from "../src/engine/moneyRows.ts";
import type { Debt, EngineRequest, IncomeFlow, PeriodicExpense, PreviewResult } from "../src/engine/types.ts";
import { buildEvidence } from "../src/workspace/evidence.ts";
import { EMPTY_ESTIMATES, withNoFill, withOfficeValue, type OfficeEstimates } from "../src/workspace/office/estimates.ts";
import { publishOfficeSettings, readOfficeSettings } from "../src/workspace/office/settings.ts";
import { full, modelHousehold, preview } from "./helpers.ts";

const REPO = join(import.meta.dirname, "..", "..");
const FIXTURE = join(REPO, "crates", "lifeplan", "tests", "fixtures", "prepare", "expected.json");

// 画面と同じく、事務所データを読んで今の事務所の値にする（App.tsx の putOfficeSettings）。テストの後は事務所の値を外す
const useOffice = (estimates: OfficeEstimates | null) => publishOfficeSettings(readOfficeSettings(estimates === null ? {} : { estimates }));
afterEach(() => useOffice(null));

const ON = "2026-11-02";
/** 事務所の推定の値（事務所データの defaults.estimates と同じ形）: 介護の期間と在宅の月額を変え、推定で埋めない目安を1つ。根拠の文は AI に渡らない */
const OFFICE: OfficeEstimates = withNoFill(withOfficeValue(withOfficeValue(EMPTY_ESTIMATES, "care.statistics.months", 120, "当事務所のお客さまの平均", ON), "care.statistics.monthlyHome", 80000, null, ON), "engine.education", true);

const box = (value: number) => ({ value, state: "confirmed" as const, origin: { kind: "manual" as const } });
const id = (n: number) => `00000000-0000-4000-8000-0000000b${String(n).padStart(4, "0")}`;

/** 前処理が効く世帯（親の介護の見本に、計算に入れない物を足す）。trace は none（接続口の calculate と同じ） */
function fixtureRequest(): EngineRequest {
  const req = structuredClone(modelHousehold("parentCare"));
  const h = req.input.household;
  const self = h.members.find((m) => m.kind === "self")!;
  const parent = h.members.find((m) => m.kind === "parent")!;
  const income = (n: number, o: Partial<IncomeFlow>): IncomeFlow => ({ id: id(n), kind: "inheritance", from: { at: "2034-04" }, to: { at: "2034-04" }, everyYears: 1, amount: box(8000000), ...o });
  // 当てにしない受け取る相続（計算に入れない）・当てにする相続（入れる）
  h.incomeFlows = [income(1, { likelihood: "uncertain" }), income(2, { likelihood: "likely", amount: box(1000000) })];
  // 当てにしない、相続で受け継ぐ借金（計算に入れない）
  const debt: Debt = { id: id(10), kind: "other", debtors: [{ member: self.id, role: "primary" }], principal: 2000000, start: { at: "2034-05" }, rateSchedule: [{ from: { at: "2034-05" }, type: "fixed", rate: "0.02" }], repayment: { method: "equalPayment", termMonths: 60 }, inheritedFrom: parent.id, likelihood: "uncertain" };
  h.debts = [debt];
  // 「計算に入れない」夢（外す）と、入れる夢
  const dream = (n: number, include: boolean, amount: number): PeriodicExpense => ({ id: id(n), kind: "dream", row: "cf.expense.lumpSum.other", from: { at: "2030-04" }, to: { at: "2030-04" }, everyYears: 1, amount: box(amount), dream: { rank: n - 19, include } });
  h.periodicExpenses = [dream(20, false, 3000000), dream(21, true, 500000)];
  return { trace: "none", input: req.input } as EngineRequest;
}

const prepared = (req: EngineRequest, office: OfficeEstimates | null) => JSON.parse(prepare(JSON.stringify(req), JSON.stringify(office))) as { request: EngineRequest; applied: Applied };

/** 接続口の calculate の summary の years と同じ物（年ごとの年間収支と金融資産） */
const years = (r: PreviewResult) => {
  const by = new Map<number, { year: number; net: number; financialAssets: number }>();
  for (const c of r.table) {
    const y = by.get(c.year) ?? { year: c.year, net: 0, financialAssets: 0 };
    if (c.row === "cf.net") y.net += c.amount;
    if (c.row === "cf.balance.financial") y.financialAssets += c.amount;
    by.set(c.year, y);
  }
  return [...by.values()].sort((a, b) => a.year - b.year);
};

/** 接続口の calculate の totals と同じ物 */
const totals = (r: PreviewResult) => (r.summary as { totals: unknown }).totals;

/** 見本に入れる根拠の問い（行と年） */
const ASKS: { row: string; year: number }[] = [
  { row: "expenseOther", year: 2037 },
  { row: "lumpSum", year: 2030 },
  { row: "financial", year: 2036 },
];

describe("AI接続口の計算の前の処理（0184）", () => {
  it("画面がエンジンへ渡す要求と同じ物を作る（計算に入れない物を外し、事務所の推定の値を足す）", () => {
    const req = fixtureRequest();
    useOffice(OFFICE);
    const screen = forEngine(req);
    const got = prepared(req, OFFICE);
    expect(got.request).toEqual(screen);
    expect(got.applied).toEqual({ excludedIncomes: [id(1)], excludedDebts: [id(10)], offDreams: [id(20)], officeEstimateValues: ["care.statistics.monthlyHome", "care.statistics.months"], officeNoFill: ["education"] });
    // 前処理が数字を変える世帯であること（外した相続・夢、事務所の値）
    const raw = preview(req);
    const done = preview(screen);
    expect(years(done)).not.toEqual(years(raw));
    useOffice(null);
    expect(years(preview(forEngine(req)))).not.toEqual(years(done));
  });

  it("事務所の値が無ければ、画面の事務所の値が無いときと同じ（計算に入れない物だけを外す）", () => {
    const req = fixtureRequest();
    const got = prepared(req, null);
    expect(got.request).toEqual(forEngine(req));
    expect(got.request.input.estimateValues).toBeUndefined();
    expect(got.applied.officeEstimateValues).toEqual([]);
    // 世帯の要求そのものは変えない
    expect(req.input.household.incomeFlows?.length).toBe(2);
  });

  it("要求がもう事務所の値を持っていれば、画面と同じく足さない", () => {
    const req = fixtureRequest();
    req.input.estimateValues = { "care.statistics.months": 60 };
    const got = prepared(req, OFFICE);
    expect(got.request.input.estimateValues).toEqual({ "care.statistics.months": 60 });
    expect(got.applied.officeEstimateValues).toEqual([]);
    expect(got.applied.officeNoFill).toEqual(["education"]);
  });

  it("どのモデル世帯（見本の世帯）にも、当てても要求は変わらない（見本に事務所の値は無く、計算に入れない物も無い）", () => {
    const dir = join(REPO, "data", "modelHouseholds");
    const ids = readdirSync(dir).filter((f) => f.endsWith(".json")).map((f) => f.slice(0, -5));
    expect(ids.length).toBeGreaterThan(10);
    for (const x of ids) {
      const req = modelHousehold(x);
      const got = prepared(req, null);
      expect(got.request, x).toEqual(req);
      expect(Object.values(got.applied).every((l) => l.length === 0), x).toBe(true);
    }
  });

  it("接続口のテストの見本（画面の数字と根拠）が今の答えと同じ", () => {
    const req = fixtureRequest();
    useOffice(OFFICE);
    const sent = forEngine(req);
    const withOffice = preview(sent);
    // 画面の根拠のパネル（App.tsx の showEvidence）: 根拠の記録「全部」で計算するのは前処理の後の要求、読み方に渡すのは前の要求
    const fullReq = { ...req, trace: "full" as const };
    const out = full(forEngine(fullReq));
    const evidence = ASKS.map((a) => {
      const view = buildEvidence(out, fullReq, a.row, a.year);
      expect(view, `${a.row} ${a.year}`).not.toBeNull();
      return { ...a, evidence: view };
    });
    useOffice(null);
    const withoutOffice = preview(forEngine(req));
    const fixture = {
      input: req.input,
      officeEstimates: OFFICE,
      screen: { years: years(withOffice), totals: totals(withOffice) },
      screenWithoutOffice: { years: years(withoutOffice), totals: totals(withoutOffice) },
      evidence,
    };
    const text = `${JSON.stringify(fixture, null, 2)}\n`;
    if (process.env.LIFEPLAN_UPDATE_FIXTURES !== undefined) {
      mkdirSync(dirname(FIXTURE), { recursive: true });
      writeFileSync(FIXTURE, text);
    }
    expect(readFileSync(FIXTURE, "utf8"), "画面の数字か根拠が変わりました。LIFEPLAN_UPDATE_FIXTURES=1 で見本を作り直し、接続口のテスト（cargo test -p lifeplan）も流してください").toBe(text);
  });
});
