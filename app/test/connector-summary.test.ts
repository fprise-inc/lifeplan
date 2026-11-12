// AI接続口の計算の答えの主な数字と家族の年齢（calculate の keyFigures・ages。0194）: 接続口に同梱する summarize（src/connector/summary.ts）が、
// 画面の「プランを比べる」の数え方（plans/compare.ts の metricsOf・compareTable）と、キャッシュフロー表の年齢の行（present.ts の ageRows）と同じ答えを返すこと。
// 接続口のテスト（crates/lifeplan/tests/mcp_connector.rs の calculate_key_figures_match_the_screen）は、ここで作る見本（画面の関数の答え）と、
// 本物の接続口が quickjs-ng で動かした答えを比べる。見本を作り直すときは LIFEPLAN_UPDATE_FIXTURES=1 で流す
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { DEFAULT_AT_AGE, engineLoansOf, pensionRequests, summarize, summaryOf, type Summary, type SummaryArgs } from "../src/connector/summary.ts";
import { forEngine } from "../src/engine/moneyRows.ts";
import type { EngineRequest } from "../src/engine/types.ts";
import { man } from "../src/presentation/format.ts";
import { pensionEstimateRequest, planPensionOf } from "../src/workspace/input/pensionLines.ts";
import { compareTable, metricsOf } from "../src/workspace/plans/compare.ts";
import { ageRows } from "../src/workspace/present.ts";
import { DEFAULT_DISPLAY_SETTINGS } from "../src/workspace/settings.ts";
import { modelHousehold, preview } from "./helpers.ts";

const REPO = join(import.meta.dirname, "..", "..");
const FIXTURE = join(REPO, "crates", "lifeplan", "tests", "fixtures", "calc-summary", "expected.json");

/** 接続口のテストと同じ見本の問い（見本の世帯・変更・年齢）。changes は接続口の JSON Patch の replace と同じ場所 */
const CASES: { name: string; sample: string; changes?: { op: "replace"; path: string; value: unknown }[]; atAges?: number[] }[] = [
  { name: "会社員の夫婦子2人（尽きる・ローンあり）", sample: "salariedCoupleTwoKids" },
  { name: "年齢を2つ・物価の想定を変える", sample: "salariedCoupleTwoKids", changes: [{ op: "replace", path: "/assumptions/inflation", value: { default: "0.005" } }], atAges: [65, 90] },
  { name: "家を買う", sample: "housingPurchase", atAges: [60] },
  { name: "単身", sample: "single25" },
  { name: "親の介護（世帯の外の家族）", sample: "sampleParentsCare" },
  { name: "必要保障額の見本", sample: "protectionNeed" },
  { name: "今より前の年齢（表の最初の年にする）", sample: "sampleSeniorCouple", atAges: [30, 120] },
];

/** 接続口と同じ要求（見本の世帯の input に変更を当てた物。trace は none。計算の前の処理を当てる前） */
function caseRequest(c: (typeof CASES)[number]): EngineRequest {
  const req = structuredClone(modelHousehold(c.sample));
  for (const x of c.changes ?? []) {
    const path = x.path.slice(1).split("/");
    let o = req.input as unknown as Record<string, unknown>;
    for (const k of path.slice(0, -1)) o = o[k] as Record<string, unknown>;
    o[path[path.length - 1]!] = x.value;
  }
  return { trace: "none", input: req.input } as EngineRequest;
}

/** 接続口と同じく、年金の見込みの写しの要求（pensionRequests）に計算の前の処理を当てて計算した結果（0199） */
export function pensionResults(req: EngineRequest): NonNullable<SummaryArgs["pension"]> {
  const r = JSON.parse(pensionRequests(JSON.stringify(req))) as { std: EngineRequest | null; claimed: EngineRequest | null };
  const run = (x: EngineRequest | null) => (x === null ? null : preview(forEngine(x)));
  return { std: run(r.std), claimed: run(r.claimed) };
}

/** 接続口の calculate と同じ問い（年金の見込みを含む） */
const ask = (req: EngineRequest, atAges?: number[]): Summary =>
  JSON.parse(summarize(JSON.stringify(preview(forEngine(req))), JSON.stringify(req), JSON.stringify({ ...(atAges !== undefined ? { atAges } : {}), pension: pensionResults(req) }))) as Summary;

/** 画面の比較の表の年金の月額の文（plans/compare.ts の monthlyMan と同じ丸め） */
const monthlyText = (v: number) => {
  const m = Math.round(v / 1000) / 10;
  return `月${Number.isInteger(m) ? String(m) : m.toFixed(1)}万円`;
};

describe("AI接続口の主な数字と家族の年齢（0194）", () => {
  it("年齢の既定は、画面の表示の設定の既定と同じ", () => {
    expect(DEFAULT_AT_AGE).toBe(DEFAULT_DISPLAY_SETTINGS.atAge);
  });

  it("主な数字は、画面の「プランを比べる」と同じ数え方（metricsOf）で、比較の表の文字とも合う", () => {
    for (const c of CASES) {
      const req = caseRequest(c);
      const result = preview(forEngine(req));
      const got = ask(req, c.atAges);
      const ages = c.atAges ?? [DEFAULT_DISPLAY_SETTINGS.atAge];
      const ms = ages.map((a) => metricsOf(req, result.table, a));
      const m = ms[0]!;
      expect(got.keyFigures.assetsAtAge, c.name).toEqual(ms.map((x) => ({ age: x.targetAge, year: x.targetYear, amount: x.target })));
      expect(got.keyFigures.depletion?.year ?? null, c.name).toBe(m.depletion);
      expect(got.keyFigures.minimum, c.name).toMatchObject({ year: m.min.year, amount: m.min.amount });
      expect(got.keyFigures.lifetimeTakeHome, c.name).toBe(m.takeHome);
      expect(got.keyFigures.lifetimeExpense, c.name).toBe(m.expense);
      expect(got.keyFigures.loanRepayment, c.name).toBe(m.loan);
      // 比較の表（画面の「プランを比べる」）の文字と同じ数字
      const table = compareTable(req, [{ name: "現状", table: result.table }], ages[0]!);
      const cell = (key: string) => table.rows.find((r) => r.key === key)?.cells[0]?.text;
      expect(cell("target"), c.name).toBe(`${man(m.target)}万円`);
      expect(cell("depletion"), c.name).toBe(got.keyFigures.depletion === null ? "尽きない" : `${got.keyFigures.depletion.year}年（ご本人${got.keyFigures.depletion.selfAge}歳）`);
      expect(cell("min"), c.name).toBe(`${man(got.keyFigures.minimum.amount)}万円（${got.keyFigures.minimum.year}年）`);
    }
  });

  it("65歳からの年金の月額は、画面の比較の表の年金の行と同じ写しの要求・同じ数え方（0199）", () => {
    const cases = [...CASES, { name: "受け取り開始を変えた（繰下げ）", sample: "deferral" }, { name: "受け取り中", sample: "sampleSeniorCouple" }];
    let claimed = 0;
    for (const c of cases) {
      const req = caseRequest(c);
      const got = ask(req, (c as { atAges?: number[] }).atAges).keyFigures.pension;
      // 画面の比較の表（App.tsx の usePlanPensions と同じ写しの要求を、画面の計算〔forEngine〕で求めた年金の行）
      const anyClaim = (req.input.household.pensionRecords ?? []).some((r) => r.claim !== undefined);
      const std = preview(forEngine(pensionEstimateRequest(req, false)));
      const cl = anyClaim ? preview(forEngine(pensionEstimateRequest(req, true))) : null;
      const plan = planPensionOf(req, std, cl);
      const table = compareTable(req, [{ name: "現状", table: preview(forEngine(req)).table }], DEFAULT_AT_AGE, 0, [plan]);
      const row = (key: string) => table.rows.find((r) => r.key === key)?.cells[0]?.text;
      if (got === null || got === undefined) {
        expect(row("pension65"), c.name).toBe("—");
        continue;
      }
      expect(got.monthly, c.name).toBe(plan.std);
      expect(got.claimedMonthly, c.name).toBe(plan.claimed);
      expect(row("pension65"), c.name).toBe(got.monthly === null ? "—" : monthlyText(got.monthly));
      if (got.anyClaim) {
        claimed += 1;
        expect(row("pensionClaimed"), c.name).toBe(monthlyText(got.claimedMonthly!));
        expect(got.claimedPeople?.length, c.name).toBe(got.people.length);
      }
      // 世帯の月額は人ごとの年額の合計÷12（画面と同じ丸め）
      const annual = got.people.reduce((s, p) => s + (p.annual ?? 0), 0);
      expect(got.monthly, c.name).toBe(got.people.some((p) => p.annual !== null) ? Math.round(annual / 12) : null);
      expect(got.people.every((p) => ["self", "spouse"].includes(p.who)), c.name).toBe(true);
    }
    expect(claimed).toBeGreaterThan(0);
  });

  it("年ごとの年齢は、画面の表の年齢の行と同じ（同じ呼び方・世帯にいる年だけ）。世帯の物の ID は答えの鍵にしない", () => {
    for (const c of CASES) {
      const req = caseRequest(c);
      const result = preview(forEngine(req));
      const years = [...new Set(result.table.map((x) => x.year))].sort((a, b) => a - b);
      const got = ask(req, c.atAges);
      const rows = ageRows(req, years);
      expect(got.members.map((m) => m.label), c.name).toEqual(rows.map((r) => r.label));
      rows.forEach((r, i) => {
        if (r.kind !== "age") throw new Error("年齢の行ではありません");
        const key = got.members[i]!.key;
        expect(
          years.map((y) => got.ages[String(y)]?.[key] ?? null),
          `${c.name} ${r.label}`,
        ).toEqual(r.ages);
      });
      const text = JSON.stringify({ members: got.members, ages: got.ages, keyFigures: got.keyFigures });
      for (const m of req.input.household.members) expect(text).not.toContain(m.id);
      expect(Object.keys(got.memberKeys).sort()).toEqual(req.input.household.members.map((m) => m.id).sort());
    }
  });

  it("どのモデル世帯（見本の世帯）でも数えられ、本人の年齢が毎年ある", () => {
    const ids = readdirSync(join(REPO, "data", "modelHouseholds")).filter((f) => f.endsWith(".json")).map((f) => f.slice(0, -5));
    expect(ids.length).toBeGreaterThan(10);
    for (const id of ids) {
      const req = caseRequest({ name: id, sample: id });
      const r = summaryOf(req, preview(forEngine(req)));
      expect(r.keyFigures.years, id).not.toBeNull();
      expect(r.members[0]?.key, id).toBe("self");
      const { from, to } = r.keyFigures.years!;
      for (let y = from; y <= to; y++) expect(r.ages[String(y)]?.self, `${id} ${y}`).toBeTypeOf("number");
    }
  });

  it("住宅ローンの利息の合計と年ごとの利息・金利は、エンジンの要約の住宅ローンの数字を、住宅ローンの返済の合計と同じ年で足した物（0205）", () => {
    for (const sample of ["salariedCoupleTwoKids", "pairLoan", "housingPurchase", "single25"]) {
      const req = caseRequest({ name: sample, sample });
      const result = preview(forEngine(req));
      const got = summaryOf(req, result);
      const loans = engineLoansOf(result.summary).filter((l) => l.kind === "mortgage");
      const { from, to } = got.keyFigures.years!;
      let total = 0;
      for (const l of loans) for (const e of l.years) if (e.year >= from && e.year <= to) total += e.interest;
      expect(got.keyFigures.loanInterest, sample).toBe(total);
      // 返済のある年の利息は、返済の額より小さい（返済のうち利息に充てた額）
      for (const [y, v] of Object.entries(got.loanYears)) if (v.loanInterest > 0) expect(v.loanInterest, `${sample} ${y}`).toBeLessThan(v.loanRepayment);
    }
    // 変動金利の住宅ローン1本（今 0.65%・2031年4月 1.1%・2036年4月 1.6%）: その年の最後の返済に当てた金利
    const one = summaryOf(caseRequest({ name: "", sample: "salariedCoupleTwoKids" }), preview(forEngine(caseRequest({ name: "", sample: "salariedCoupleTwoKids" }))));
    expect([2027, 2030, 2031, 2035, 2036, 2040].map((y) => one.loanYears[String(y)]?.loanRate)).toEqual(["0.0065", "0.0065", "0.011", "0.011", "0.016", "0.016"]);
    expect(one.keyFigures.loanInterest).toBeGreaterThan(0);
    // 金利の違う住宅ローンを2本返している年（ペアローン: 固定1.85% と 固定期間選択1.2%）は null
    const pair = summaryOf(caseRequest({ name: "", sample: "pairLoan" }), preview(forEngine(caseRequest({ name: "", sample: "pairLoan" }))));
    expect(pair.loanYears["2030"]?.loanRate).toBeNull();
    // 住宅ローンの無い世帯は 0
    expect(summaryOf(caseRequest({ name: "", sample: "single25" }), preview(forEngine(caseRequest({ name: "", sample: "single25" })))).keyFigures.loanInterest).toBe(0);
  });

  it("接続口のテストの見本（画面の関数の答え）が今の答えと同じ", () => {
    const expected = CASES.map((c) => {
      const got = ask(caseRequest(c), c.atAges);
      return { ...c, expected: { members: got.members, ages: got.ages, keyFigures: got.keyFigures } };
    });
    const text = `${JSON.stringify(expected, null, 2)}\n`;
    if (process.env.LIFEPLAN_UPDATE_FIXTURES !== undefined) {
      mkdirSync(dirname(FIXTURE), { recursive: true });
      writeFileSync(FIXTURE, text);
    }
    expect(readFileSync(FIXTURE, "utf8"), "主な数字か年齢が変わりました。LIFEPLAN_UPDATE_FIXTURES=1 で見本を作り直し、接続口のテスト（cargo test -p lifeplan）も流してください").toBe(text);
  });
});
