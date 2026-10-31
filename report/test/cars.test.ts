// 車を複数台持つ世帯の帳票の入力（ライフイベント表・キャッシュフロー表の車の行）と、推定の値の注意書き
import { describe, expect, it } from "vitest";
import { buildProposalInput, ESTIMATED_NOTE, hasEstimatedBox } from "../src/build.ts";
import type { EngineRequest, ProposalBundle, TableCell } from "../src/bundle.ts";
import type { CfTable } from "../src/input.ts";
import { modelHousehold, run } from "../scripts/engine.ts";
import { renderAndExtract, reportPdfBin, sampleFrame } from "../scripts/reportPdf.ts";
import { normalize } from "./helpers.ts";

const bin = reportPdfBin();

type Car = NonNullable<EngineRequest["input"]["household"]["cars"]>[number];

/** 車の見本（1台目は今の車を持っていて買い替え、2台目は配偶者の名義で現金で買う） */
function withCars(): EngineRequest {
  const req = structuredClone(modelHousehold("unexplainedSpending"));
  const h = req.input.household;
  const spouse = h.members.find((m) => m.kind === "spouse") ?? h.members[0]!;
  const second = {
    id: "0b8c7d6e-5f4a-4b3c-9d2e-1f0a9b8c7d6e",
    owner: spouse.id,
    purchase: { first: { at: "2030-09" }, everyYears: 10, price: 1800000 },
    upkeep: { annual: 300000 },
  } as unknown as Car;
  (h as { cars?: Car[] }).cars = [...(h.cars ?? []), second];
  return req;
}

function bundleOf(req: EngineRequest): ProposalBundle {
  const r = run(req);
  return { document: { issuedOn: "2026-10-19" }, current: r, proposal: r, chapters: undefined, layout: { orientation: "portrait", cashflow: "full" } };
}

const rowOf = (t: CfTable, label: string) => t.rows.find((r) => r.label === label);

describe("車を2台持つ世帯", () => {
  const req = withCars();
  const bundle = bundleOf(req);
  const input = buildProposalInput(bundle);
  const cars = req.input.household.cars ?? [];
  const table = bundle.proposal.result.table as TableCell[];

  it("キャッシュフロー表の「車」の行は、2台分の買い替え・維持費・ローンの合計（ほかの行と重ならない）", () => {
    const t = input.cashflow.proposal;
    const row = rowOf(t, "車の費用");
    expect(row).toBeDefined();
    const ids = new Set(cars.map((c) => c.id));
    input.basis.years.forEach((y, i) => {
      const want = table.filter((c) => c.year === y && c.object !== undefined && ids.has(c.object) && c.row.startsWith("cf.expense.")).reduce((s, c) => s + c.amount, 0);
      expect(row!.cells[i] ?? 0, String(y)).toBe(want);
    });
    // 2台目の車の支出も入っている（2030年の購入）
    const y2030 = input.basis.years.indexOf(2030);
    const second = table.filter((c) => c.year === 2030 && c.object === cars[1]!.id && c.row.startsWith("cf.expense.")).reduce((s, c) => s + c.amount, 0);
    expect(second).toBeGreaterThan(0);
    expect(row!.cells[y2030]).toBeGreaterThanOrEqual(second);
    // 支出の行の合計は支出合計と同じ（車の行を足しても二重に数えない）
    const total = rowOf(t, "支出合計")!;
    const keys = new Set(["living", "housing", "education", "insurance", "lumpSum", "car", "advisoryFee", "expenseOther", "taxSi"]);
    const expenseRows = t.rows.filter((r) => keys.has(r.key));
    expect(expenseRows.map((r) => r.key)).toContain("car");
    input.basis.years.forEach((y, i) => expect(expenseRows.reduce((s, r) => s + (r.cells[i] ?? 0), 0), String(y)).toBe(total.cells[i]));
  });

  it("ライフイベント表に、車ごとの買い替え（購入）の年が出る", () => {
    const items = input.events.flatMap((e) => e.items.map((t) => `${e.year}:${t}`));
    expect(items).toContain("2029:車1の買い替え");
    expect(items).toContain("2036:車1の買い替え");
    expect(items).toContain("2030:車2を購入");
    expect(items).toContain("2040:車2の買い替え");
  });

  it("車が1台なら「車」の名前で、車が無ければ車の行を出さない", () => {
    const one = buildProposalInput(bundleOf(modelHousehold("unexplainedSpending")));
    expect(one.events.flatMap((e) => e.items)).toContain("車の買い替え");
    const none = buildProposalInput(bundleOf(modelHousehold("salariedCoupleTwoKids")));
    expect(rowOf(none.cashflow.proposal, "車の費用")).toBeUndefined();
  });
});

describe("推定の値の注意書き", () => {
  it("推定の値があるときは「一部は統計の平均で補っています」とだけ書き、どの欄かは書かない", () => {
    const req = modelHousehold("salariedCoupleTwoKids");
    expect(hasEstimatedBox(req.input.household)).toBe(false);
    const plain = buildProposalInput(bundleOf(req));
    expect(plain.assumptions.notes).not.toContain(ESTIMATED_NOTE);
    // 画面が「推定の欄が残っている」と知らせたとき
    const flagged = buildProposalInput({ ...bundleOf(req), estimated: true });
    expect(flagged.assumptions.notes).toContain(ESTIMATED_NOTE);
    // 計算の要求の中に推定の値の箱があるとき
    const est = structuredClone(req);
    const living = est.input.household.livingExpenses?.find((l) => l.mode === "total");
    (living as unknown as { monthly: unknown }).monthly = { value: 280000, state: "estimated", origin: { kind: "auto" }, estimate: { method: "statistic", basis: "統計" } };
    expect(hasEstimatedBox(est.input.household)).toBe(true);
    const fromBox = buildProposalInput(bundleOf(est));
    expect(fromBox.assumptions.notes.filter((n) => n === ESTIMATED_NOTE)).toHaveLength(1);
    expect(JSON.stringify(fromBox)).not.toContain("統計の目安");
  });
});

describe.skipIf(bin === null)("車を2台持つ世帯の PDF", () => {
  it("全年のキャッシュフロー表に「車」の行、ライフイベント表に車ごとの買い替え、注意書きに推定の一文が出る", () => {
    const bundle = { ...bundleOf(withCars()), estimated: true };
    const input = buildProposalInput(bundle);
    const r = renderAndExtract(bin as string, input, sampleFrame(bundle, input));
    const all = normalize(r.pages.join("\n"));
    expect(all).toContain(normalize("車の費用"));
    expect(all).toContain(normalize("車1の買い替え"));
    expect(all).toContain(normalize("車2を購入"));
    expect(all).toContain(normalize(ESTIMATED_NOTE));
  });
});

describe("ライフイベント表に、ライフイベントの入力項目の行を出す（0068 の追記 2026-10-31）", () => {
  it("出るお金の行（1回は額、くり返しは最初の年に「毎年」「3年ごとに」）・入るお金の行・子への援助（結婚資金）", () => {
    const req = structuredClone(modelHousehold("salariedCoupleTwoKids"));
    const h = req.input.household as unknown as {
      members: { id: string; kind: string }[];
      periodicExpenses?: unknown[];
      incomeFlows?: unknown[];
      goals?: { kind: string; owner?: string; education?: { gifts?: unknown[] } }[];
    };
    const box = (value: number) => ({ value, state: "estimated", origin: { kind: "auto" }, estimate: { method: "standard", basis: "よくある額の目安" } });
    h.periodicExpenses = [
      ...(h.periodicExpenses ?? []),
      { id: "00000000-0000-4000-8000-0000000000c1", label: "特別な旅行", kind: "general", row: "cf.expense.lumpSum.other", from: { at: "2029-04" }, to: { at: "2029-04" }, everyYears: 1, amount: box(800000) },
      { id: "00000000-0000-4000-8000-0000000000c2", label: "予備費", kind: "general", row: "cf.expense.lumpSum.other", from: { at: "2027-10" }, to: null, everyYears: 1, amount: box(300000) },
      // ほかの入力項目の行（車の修理）は出さない
      { id: "00000000-0000-4000-8000-0000000000c3", label: "車の修理", kind: "car", row: "cf.expense.living.car", from: { at: "2028-01" }, to: { at: "2028-01" }, everyYears: 1, amount: box(100000) },
    ];
    h.incomeFlows = [{ id: "00000000-0000-4000-8000-0000000000c4", label: "結婚のお祝い", kind: "celebration", from: { at: "2030-06" }, to: { at: "2030-06" }, everyYears: 1, amount: box(300000) }];
    const child = h.members.find((m) => m.kind === "child")!;
    const goal = h.goals!.find((g) => g.kind === "education" && g.owner === child.id)!;
    goal.education!.gifts = [{ id: "00000000-0000-4000-8000-0000000000c5", at: { memberAge: { member: child.id, years: 30 } }, amount: 1000000, purpose: "wedding" }];
    const input = buildProposalInput(bundleOf(req));
    const items = input.events.flatMap((e) => e.items.map((t) => `${e.year}:${t}`));
    expect(items).toContain("2029:特別な旅行（80万円）");
    expect(items).toContain("2027:予備費（毎年30万円）");
    expect(items).toContain("2030:結婚のお祝い（受け取り 30万円）");
    expect(items).toContain("2042:第1子の結婚の援助（100万円）");
    // もとからある種類の無い3年ごとの行（名前なし）
    expect(items.some((t) => /^2027:くり返しの支出（3年ごとに/u.test(t))).toBe(true);
    expect(items.some((t) => t.includes("車の修理"))).toBe(false);
  });
});
