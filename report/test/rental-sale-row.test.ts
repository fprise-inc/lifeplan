// 提案書のキャッシュフロー表の「不動産の売却」の行（0128）: 収益不動産を売った手取りを「その他の収入」から分ける（アプリの表と同じ）
import { describe, expect, it } from "vitest";
import type { EngineRequest, ProposalBundle } from "../src/bundle.ts";
import { buildProposalInput } from "../src/build.ts";
import { ROW_NAMES } from "../src/rowNames.ts";
import { modelHousehold, runAll } from "../scripts/engine.ts";
import { renderAndExtract, reportPdfBin, sampleFrame } from "../scripts/reportPdf.ts";
import { byYear, normalize } from "./helpers.ts";

const HEIGHTS = "a9a0f9af-56d3-4123-af5a-c0969d2fb9f8";
const current = modelHousehold("rentalSample");
const noSale = structuredClone(current) as EngineRequest;
for (const a of noSale.input.household.accounts) if (a.property !== undefined) delete (a.property as { sale?: unknown }).sale;
const [cur, prop] = runAll([current, noSale]);
const bundle: ProposalBundle = { document: { issuedOn: "2026-11-06", preparedBy: "見本FP事務所（架空）" }, current: cur!, proposal: prop!, targetAge: 95, layout: { orientation: "portrait", cashflow: "full" } };
const input = buildProposalInput(bundle);
const years = input.basis.years;

describe("キャッシュフロー表の「不動産の売却」の行", () => {
  it("家賃収入のすぐ下にあり、売った年の手取り。その他の収入から外す（収入合計は同じ）", () => {
    const rows = input.cashflow.current.rows;
    const keys = rows.map((r) => r.key);
    expect(keys.indexOf("realEstateSale")).toBe(keys.indexOf("rent") + 1);
    const sale = rows.find((r) => r.key === "realEstateSale")!;
    expect(sale.label).toBe(ROW_NAMES.realEstateSale);
    const proceeds = byYear(cur!.result, (c) => c.row === "cf.income.lumpSum.realEstateSale" && c.object === HEIGHTS);
    const i = years.indexOf(2041);
    expect(sale.cells[i]).toBe(proceeds.get(2041));
    const income = rows.filter((r) => r.kind === "value" && keys.indexOf(r.key) < keys.indexOf("incomeTotal"));
    const total = rows.find((r) => r.key === "incomeTotal")!;
    for (const k of [i, years.indexOf(2030)]) expect(income.reduce((s, r) => s + (r.cells[k] ?? 0), 0)).toBe(total.cells[k]);
  });

  it("売る予定の無いプランの表には行が無い", () => {
    expect(input.cashflow.proposal.rows.map((r) => r.key)).not.toContain("realEstateSale");
  });
});

const BIN = reportPdfBin();
describe.skipIf(BIN === null)("PDF の収益不動産のまとめ", () => {
  it("全体と物件ごとのページに「年ごとの手残りとローン残高」のグラフがあり、表の「不動産の売却」の行が載る", () => {
    const r = renderAndExtract(BIN as string, input, sampleFrame(bundle, input));
    const all = r.pages.map(normalize);
    expect(all.some((t) => t.includes(normalize("全物件の年ごとの手残りとローン残高")))).toBe(true);
    expect(all.filter((t) => t.includes(normalize("年ごとの手残りとローン残高")) && t.includes(normalize("ローン残高（右の目盛り）"))).length).toBeGreaterThanOrEqual(2);
    expect(all.some((t) => t.includes(normalize("不動産の売却")))).toBe(true);
  });
});
