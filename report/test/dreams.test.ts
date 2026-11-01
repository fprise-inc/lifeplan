// 提案書の「ご家族の夢」の章（夢プラン。0103）: 順位・夢・時期・金額・計算に入れるかと要約の1文、ライフイベント表の★
import { describe, expect, it } from "vitest";
import { buildProposalInput } from "../src/build.ts";
import type { EngineRequest, ProposalBundle } from "../src/bundle.ts";
import { CHAPTERS, hasMaterial, selectChapters } from "../src/chapters.ts";
import { requestWithoutDreams } from "../src/dreams.ts";
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
    // 額はキャッシュフロー表と同じ2030年の額（物価の上昇などで伸ばした額。ご家族の夢の章は今の値段のまま）
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
  });
});
