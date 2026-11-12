// 提案書の「ご家族の夢」の章（夢プラン。0103）: 順位・夢・時期・金額・計算に入れるか・払った後の金融資産と要約の1文、ライフイベント表の★
import { describe, expect, it } from "vitest";
import { buildProposalInput } from "../src/build.ts";
import type { EngineRequest, ProposalBundle } from "../src/bundle.ts";
import { CHAPTERS, hasMaterial, selectChapters } from "../src/chapters.ts";
import { dreamPaid, requestWithoutDreams } from "../src/dreams.ts";
import { modelHousehold, run } from "../scripts/engine.ts";
import { renderAndExtract, reportPdfBin, sampleFrame } from "../scripts/reportPdf.ts";
import { normalize } from "./helpers.ts";

const bin = reportPdfBin();

type Expense = NonNullable<EngineRequest["input"]["household"]["periodicExpenses"]>[number];

const id = (n: number) => `00000000-0000-4000-8000-0000000d00${String(n).padStart(2, "0")}`;

/** 夢を3件持つ世帯（2件目は計算に入れない。順位は並びと逆の所がある） */
function withDreams(): EngineRequest {
  const req = structuredClone(modelHousehold("salariedCoupleTwoKids"));
  const h = req.input.household;
  const self = h.members.find((m) => m.kind === "self")!;
  const box = (v: number) => ({ value: v, state: "confirmed", origin: { kind: "manual" } }) as unknown as Expense["amount"];
  const once = (n: number, label: string, at: string, v: number, dream: Expense["dream"]): Expense => ({ id: id(n), label, kind: "dream", row: "cf.expense.lumpSum.other", from: { at }, to: { at }, everyYears: 1, amount: box(v), dream }) as Expense;
  (h as { periodicExpenses?: Expense[] }).periodicExpenses = [
    ...(h.periodicExpenses ?? []),
    once(1, "憧れの車", "2030-04", 6000000, { rank: 2 }),
    once(2, "二拠点や別荘", "2040-04", 20000000, { rank: 3, include: false }),
    { ...once(3, "夫婦で海外旅行", "2031-04", 0, { rank: 1 }), from: { memberAge: { member: self.id, years: 65 } }, to: { memberAge: { member: self.id, years: 65 } } },
  ];
  return req;
}

/** アプリと同じく、計算に入れない夢を外して計算する（帳票の材料の要求は外す前のまま） */
const forEngine = (req: EngineRequest): EngineRequest => ({ ...req, input: { ...req.input, household: { ...req.input.household, periodicExpenses: (req.input.household.periodicExpenses ?? []).filter((p) => !(p.kind === "dream" && p.dream?.include === false)) } } });

function bundleOf(req: EngineRequest, withoutDreams = true): ProposalBundle {
  const r = { request: req, result: run(forEngine(req)).result };
  const nd = requestWithoutDreams(req);
  return {
    document: { issuedOn: "2026-10-19" },
    current: r,
    proposal: r,
    ...(withoutDreams && nd !== req ? { proposalWithoutDreams: { request: nd, result: run(forEngine(nd)).result } } : {}),
    layout: { orientation: "portrait", cashflow: "summary" },
  };
}

describe("ご家族の夢の章", () => {
  const req = withDreams();
  const input = buildProposalInput(bundleOf(req));

  it("順位の順に、夢・時期・金額（未入力は空）・計算に入れるか。要約の1文", () => {
    expect(input.dreams!.rows.map((r) => [r.rank, r.name, r.amount, r.included])).toEqual([
      [1, "夫婦で海外旅行", null, true],
      [2, "憧れの車", 6000000, true],
      [3, "二拠点や別荘", 20000000, false],
    ]);
    expect(input.dreams!.rows[0]!.when).toMatch(/^\d{4}年（ご本人65歳）$/u);
    expect(input.dreams!.rows[1]!.when).toMatch(/^2030年（ご本人\d+歳）$/u);
    expect(input.dreams!.summary).toMatch(/^計算に入れた夢（3件中2件）を入れ(ても\d+歳まで足ります|ると\d+歳で不足します（.+）)$/u);
  });

  it("払った後の金融資産: 計算に入れる夢で額があるときだけ、払う年の終わりの金融資産（キャッシュフロー表の金融資産と同じ）。入れない夢・額の無い夢は null", () => {
    const fin = (y: number) => bundleOf(req).proposal.result.table.filter((c) => c.row === "cf.balance.financial" && c.year === y).reduce((s, c) => s + c.amount, 0);
    expect(input.dreams!.rows.map((r) => r.paid ?? null)).toEqual([null, { count: 1, year: 2030, after: fin(2030), short: false }, null]);
  });

  it("払った後の金融資産（見本 3-4-06）: 何年ごとの夢は払う年のうちいちばん少ない年。計算に入れない3件は null", () => {
    const raw = modelHousehold("sampleFamilyDreams");
    const b = bundleOf(raw);
    const rows = buildProposalInput(b).dreams!.rows;
    const fin = new Map<number, number>();
    for (const c of b.proposal.result.table) if (c.row === "cf.balance.financial") fin.set(c.year, (fin.get(c.year) ?? 0) + c.amount);
    expect(rows.map((r) => [r.included, r.paid?.count ?? null])).toEqual([
      [true, 1],
      [true, 4],
      [true, 1],
      [true, 1],
      [false, null],
      [false, null],
      [false, null],
    ]);
    const car = rows[1]!.paid!;
    expect([2029, 2036, 2043, 2050]).toContain(car.year);
    for (const y of [2029, 2036, 2043, 2050]) expect(car.after).toBeLessThanOrEqual(fin.get(y)!);
    expect(car.after).toBe(fin.get(car.year));
    expect(rows.every((r) => r.paid == null || r.paid.short === false)).toBe(true);
  });

  it("払った後の金融資産の年の選び方: 不足する年があればその最初の年。払う年が表に無ければ null", () => {
    const id = "x";
    const cell = (row: string, year: number, amount: number, object?: string) => ({ row, year, amount, ...(object !== undefined ? { object } : {}) });
    const table = [
      ...[2030, 2035, 2040].map((y) => cell("cf.expense.lumpSum.other", y, 1_000_000, id)),
      cell("cf.balance.financial", 2030, 5_000_000),
      cell("cf.balance.financial", 2035, 1_000_000),
      cell("cf.balance.financial", 2040, 3_000_000),
      cell("cf.balance.shortfall", 2040, 200_000),
    ];
    expect(dreamPaid(id, table, [2030, 2035, 2040])).toEqual({ count: 3, year: 2040, after: 3_000_000, short: true });
    expect(dreamPaid(id, table, [2030, 2035])).toEqual({ count: 2, year: 2035, after: 1_000_000, short: false });
    expect(dreamPaid(id, table, [2041])).toBeNull();
    expect(dreamPaid("y", table, [2030, 2035, 2040])).toBeNull();
  });

  it("夢を外した計算が無いときは、要約の1文を出さない。夢の無い世帯・章を外したときは章を載せない", () => {
    expect(buildProposalInput(bundleOf(req, false)).dreams!.summary).toBeNull();
    const plain = buildProposalInput(bundleOf(structuredClone(modelHousehold("salariedCoupleTwoKids"))));
    expect(plain.dreams).toBeNull();
    expect(hasMaterial(plain, "dreams")).toBe(false);
    expect(CHAPTERS.map((c) => c.id).indexOf("dreams")).toBe(CHAPTERS.map((c) => c.id).indexOf("basics") + 1);
    expect(selectChapters(input, ["summary"]).dreams).toBeNull();
  });

  it("ライフイベント表: 計算に入れる夢に★。計算に入れない夢は載せない", () => {
    const items = input.events.flatMap((e) => e.items);
    // 額はキャッシュフロー表と同じ2030年の額（物価の上昇などで伸ばした額。ご家族の夢の章は入れた額のまま）
    const cf = bundleOf(req).proposal.result.table.filter((c) => c.object === id(1) && c.year === 2030).reduce((s, c) => s + c.amount, 0);
    expect(cf).toBeGreaterThan(6000000);
    expect(items).toContain(`★憧れの車（${(Math.round(cf / 1000) / 10).toLocaleString("ja-JP")}万円）`);
    expect(items.some((t) => t.startsWith("★夫婦で海外旅行"))).toBe(true);
    expect(items.some((t) => t.includes("二拠点や別荘"))).toBe(false);
  });
});

describe.skipIf(bin === null)("ご家族の夢の PDF", () => {
  it("章「ご家族の夢」に、要約の1文と夢の表。ライフイベント表に★の説明", () => {
    const bundle = bundleOf(withDreams());
    const input = buildProposalInput(bundle);
    const r = renderAndExtract(bin as string, input, sampleFrame(bundle, input));
    const all = normalize(r.pages.join("\n"));
    expect(all).toContain("ご家族の夢");
    expect(all).toContain(normalize(input.dreams!.summary!));
    expect(all).toContain("夫婦で海外旅行");
    expect(all).toContain("入れない");
    expect(all).toContain("★はご家族の夢（夢プラン）です。");
    // ライフイベント表の額はキャッシュフロー表と同じその年の額（0068 の追記 2026-11-01）
    expect(all).toContain(normalize("金額は、キャッシュフロー表と同じく、その年の見込みの額（物価の上昇などを見込んだ額）です。"));
    expect(all).toContain(normalize(input.events.flatMap((e) => e.items).find((t) => t.startsWith("★憧れの車")) as string));
    // 払った後の金融資産の列と注記（計算に入れる夢だけ数字。キャッシュフロー表と同じく物価の上昇などを見込んだ計算の額）
    const dreamPage = normalize(r.pages.find((p) => normalize(p).includes(normalize("ご家族がかなえたいこと"))) ?? "");
    expect(dreamPage).toContain("払った後の金融資産");
    expect(dreamPage).toContain(normalize(`${(Math.round(input.dreams!.rows[1]!.paid!.after / 10000)).toLocaleString("ja-JP")}万円`));
    expect(dreamPage).toContain(normalize("物価の上昇などを見込んだ計算の額です"));
  });

  it("払った後の金融資産の欄の無い前の版の入力は、前と同じ5列で組む", () => {
    const bundle = bundleOf(withDreams());
    const input = buildProposalInput(bundle);
    const old = { ...input, dreams: { ...input.dreams!, rows: input.dreams!.rows.map((r) => { const o = { ...r }; delete o.paid; return o; }) } };
    const r = renderAndExtract(bin as string, old, sampleFrame(bundle, old));
    const dreamPage = normalize(r.pages.find((p) => normalize(p).includes(normalize("ご家族がかなえたいこと"))) ?? "");
    expect(dreamPage).toContain("憧れの車");
    expect(dreamPage).not.toContain("払った後の金融資産");
  });

  it("資金が不足する年の夢は、払った後の金融資産に「不足」を添える", () => {
    const req = withDreams();
    const big = req.input.household.periodicExpenses!.find((p) => p.id === id(1))!;
    (big.amount as { value: number }).value = 300_000_000;
    const bundle = bundleOf(req);
    const input = buildProposalInput(bundle);
    expect(input.dreams!.rows[1]!.paid).toMatchObject({ year: 2030, short: true });
    const r = renderAndExtract(bin as string, input, sampleFrame(bundle, input));
    const dreamPage = normalize(r.pages.find((p) => normalize(p).includes(normalize("ご家族がかなえたいこと"))) ?? "");
    expect(dreamPage).toContain(normalize("（不足）"));
  });
});
