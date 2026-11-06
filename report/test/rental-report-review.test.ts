// 収益不動産を持つ見本の世帯（data/modelHouseholds/rentalSample.json。架空）で見つかった提案書の見え方の直し（0126）:
// キャッシュフロー表の抜粋に現状と提案の両方の出来事の年を載せる、ライフイベント表に物件の売却・大きな修繕を載せる、
// 表の行で住まいのローンと不動産のローンを分ける、減価償却が終わる年の書き方、バランスシートの不動産のローンの分け方
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Ajv2020 } from "ajv/dist/2020.js";
import { describe, expect, it } from "vitest";
import type { EngineRequest, ProposalBundle } from "../src/bundle.ts";
import { buildProposalInput } from "../src/build.ts";
import { bsHouseholdOf, bsSeries } from "../src/bsGroups.ts";
import { depreciationEndText } from "../src/rentalText.ts";
import { modelHousehold, REPORT_DIR, runAll } from "../scripts/engine.ts";
import { renderAndExtract, reportPdfBin, sampleFrame } from "../scripts/reportPdf.ts";
import { byYear, normalize } from "./helpers.ts";

const schema = JSON.parse(readFileSync(join(REPORT_DIR, "schema", "proposal-input.schema.json"), "utf8")) as object;
const validate = new Ajv2020({ allErrors: true, strict: true }).compile(schema);

const HEIGHTS = "a9a0f9af-56d3-4123-af5a-c0969d2fb9f8";
const LOAN = "26a240e9-79c4-478d-b52a-cafd73257991";
const MORTGAGE = "1a4ab6d6-d333-45e9-97c8-193f070433a8";
const current = modelHousehold("rentalSample");
// 提案: ご本人は60歳から65歳まで再雇用で働き、アパートを売るのも5年後（2046年10月）にする。現状の退職・売却の年（2041年）は提案の出来事に無い
const proposal = structuredClone(current) as EngineRequest;
{
  const h = proposal.input.household;
  const self = h.members.find((m) => m.kind === "self")!;
  const work = h.employmentPeriods.find((e) => e.member === self.id)!;
  h.employmentPeriods.push({ ...structuredClone(work), id: "0b6f6c1e-6a52-4a8e-9a3b-2f1d7c5e9a01", type: "contract", from: { at: "2041-08" }, to: { at: "2046-07" }, salary: { annual: { value: 4800000, state: "confirmed", origin: { kind: "manual" } }, bonus: { value: 0, state: "confirmed", origin: { kind: "manual" } } }, standardMonthlyRemuneration: { health: { value: 400000, state: "confirmed", origin: { kind: "manual" } }, pension: { value: 400000, state: "confirmed", origin: { kind: "manual" } } } } as typeof work);
  const heights = h.accounts.find((a) => a.id === HEIGHTS)!;
  (heights.property as { sale: unknown }).sale = { at: { at: "2046-10" } };
}
const [cur, prop] = runAll([current, proposal]);
const bundle: ProposalBundle = { document: { issuedOn: "2026-11-06", preparedBy: "見本FP事務所（架空）" }, current: cur!, proposal: prop!, targetAge: 95, layout: { orientation: "portrait", cashflow: "excerpt" } };
const input = buildProposalInput(bundle);

describe("キャッシュフロー表の抜粋の年と、ライフイベント表", () => {
  it("抜粋に必ず載せる年は、現状と提案の両方の出来事の年（現状の退職・売却の2041年と、提案の2046年）。JSON Schema に合う", () => {
    expect(validate(input), JSON.stringify(validate.errors)).toBe(true);
    const keys = input.cashflow.keyYears ?? [];
    expect(keys).toContain(2041);
    expect(keys).toContain(2046);
    // ライフイベント表（提案の出来事）には2041年の退職・売却は無い
    expect(input.events.find((e) => e.year === 2041)?.items ?? []).not.toContain("見本ハイツ（架空）を売却");
    // 抜粋の年はライフイベント表の年をすべて含む
    for (const e of input.events) expect(keys, String(e.year)).toContain(e.year);
  });

  it("ライフイベント表に、物件の売却と大きな修繕（その年に持っていて修繕する物）が載る", () => {
    const at = (y: number) => input.events.find((e) => e.year === y)?.items ?? [];
    expect(at(2046)).toContain("見本ハイツ（架空）を売却");
    expect(at(2029)).toContain("見本ハイツ（架空）の大きな修繕（外壁塗装・屋根の葺き替え 550万円）");
    expect(at(2036)).toContain("見本ハイツ（架空）の大きな修繕（給湯器・共用部の設備の更新 180万円）");
    // 持っていない物件の修繕は載せない（売った後の年に修繕を入れても出ない）
    const late = structuredClone(proposal) as EngineRequest;
    const hp = late.input.household.accounts.find((a) => a.id === HEIGHTS)!.property as { repairs: { at: unknown }[] };
    hp.repairs.push({ ...structuredClone(hp.repairs[0]!), id: "0b6f6c1e-6a52-4a8e-9a3b-2f1d7c5e9a02", at: { at: "2050-06" } } as (typeof hp.repairs)[number]);
    const [c2, p2] = runAll([current, late]);
    const i2 = buildProposalInput({ ...bundle, current: c2!, proposal: p2! });
    expect((i2.events.find((e) => e.year === 2050)?.items ?? []).some((t) => t.includes("大きな修繕"))).toBe(false);
  });
});

const BIN = reportPdfBin();
describe.skipIf(BIN === null)("PDF のキャッシュフロー表（抜粋）", () => {
  it("現状の表にも2041年の行が載る（退職金・売却の年）", () => {
    const r = renderAndExtract(BIN as string, input, sampleFrame(bundle, input));
    const pages = r.pages.filter((t) => normalize(t).includes(normalize("キャッシュフロー表（現状）")));
    expect(pages.length).toBeGreaterThan(0);
    expect(pages.join("\n")).toMatch(/(^|\s)2041(\s|$)/m);
  });
});

describe("表の行: 住まいのローンと不動産のローン", () => {
  const rows = (t: "current" | "proposal") => new Map(input.cashflow[t].rows.map((r) => [r.key, r]));
  const years = input.basis.years;

  it("「住宅ローン残高」は住まいのローンだけ、「不動産のローン残高」はアパートローン", () => {
    const r = rows("current");
    const mort = byYear(cur!.result, (c) => c.row.startsWith("cf.balance.debt") && c.object === MORTGAGE);
    const loan = byYear(cur!.result, (c) => c.row.startsWith("cf.balance.debt") && c.object === LOAN);
    expect(r.get("debt")?.label).toBe("住宅ローン残高");
    expect(r.get("debt")?.cells).toEqual(years.map((y) => mort.get(y) ?? null));
    expect(r.get("realEstateDebt")?.label).toBe("不動産のローン残高");
    expect(r.get("realEstateDebt")?.cells).toEqual(years.map((y) => loan.get(y) ?? null));
  });

  it("アパートローンの返済（売ったときの一括の返済を含む）は「不動産のローンの返済」の行で、「その他の支出」に入らない", () => {
    const r = rows("current");
    const pay = byYear(cur!.result, (c) => c.row.startsWith("cf.expense") && c.object === LOAN);
    expect(r.get("realEstateLoan")?.label).toBe("不動産のローンの返済");
    expect(r.get("realEstateLoan")?.cells).toEqual(years.map((y) => pay.get(y) ?? null));
    const other = r.get("expenseOther")?.cells ?? [];
    const i41 = years.indexOf(2041);
    // 2041年の「その他の支出」に、一括の返済（1,000万円を超える額）は入らない
    expect(other[i41] ?? 0).toBeLessThan(10_000_000);
  });
});

describe("減価償却が終わる年の書き方", () => {
  it("計算基準年までに終わった分は「設備は2024年に終わり」。これから終わる物を先に置く", () => {
    const p = input.rental?.properties.find((x) => x.label === "見本ハイツ（架空）");
    expect(p?.depreciationEndText).toBe("建物 2031年・設備は2024年に終わり");
    expect(depreciationEndText({ depreciationEnd: { building: 2031, equipment: 2030 }, sells: true, baseYear: 2026 })).toBe("建物 2031年・設備 2030年");
    expect(depreciationEndText({ depreciationEnd: { building: 2020, equipment: 2018 }, sells: true, baseYear: 2026 })).toBe("建物は2020年、設備は2018年に終わり");
    expect(depreciationEndText({ depreciationEnd: { building: 2020, equipment: null }, sells: true, baseYear: 2026 })).toBe("2020年に終わり");
    expect(depreciationEndText({ depreciationEnd: { building: null, equipment: 2024 }, depreciationEndIfContinued: { building: 2065, equipment: null }, sells: true, baseYear: 2026 })).toBe("建物 売るまでには終わりません（2065年に終わる見込み）・設備は2024年に終わり");
    // 計算基準年を渡さなければ、前の書き方のまま
    expect(depreciationEndText({ depreciationEnd: { building: 2031, equipment: 2024 }, sells: true })).toBe("建物 2031年・設備 2024年");
  });
});

describe("バランスシートの不動産のローン", () => {
  it("アパートローンは分け方も項目も「不動産のローン」（その他の負債に入れない）。年の表も「不動産のローン」の行", () => {
    const at = bsSeries(cur!.result.table, [2027], bsHouseholdOf(current.input.household))[0]!;
    const line = at.lines.find((l) => l.key === "propertyLoan");
    expect(line).toMatchObject({ group: "propertyLoan", label: "不動産のローン" });
    expect(at.lines.some((l) => l.group === "debt")).toBe(false);
    expect(at.totalAssets).toBe(at.totalLiabilities + at.netWorth);
    const fig = input.balanceSheet?.figure.columns[0];
    expect(fig?.liabilities.map((b) => b.key)).toEqual(["mortgage", "propertyLoan", "netWorth"]);
    const labels = (input.balanceSheet?.proposal.liabilities ?? []).map((x) => x.label);
    expect(labels).toContain("不動産のローン");
    expect(labels).not.toContain("その他の負債");
  });
});
