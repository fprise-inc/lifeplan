// お金の行の伸び方の既定を種類ごとに（0044 の追記 2026-11-10）: 額を取り決め・契約・制度で決める種類（仕送り・養育費・援助・毎年の贈与など）は
// 足したときに伸び方「変えない」を明示して書き、物やサービスの値段で決まる種類は今までどおり物価（伸び方を書かない。エンジンの既定）。
// エンジンの既定（省略は物価）は変えないので、伸び方を持たない前の行の数字は変わらない。種類・回数を選び直したときは、伸び方が前の既定のままなら
// 新しい既定に合わせ、FP が選んだ伸び方は残す
import { describe, expect, it } from "vitest";
import type { EngineRequest, IncomeFlow, IncomeFlowKind, MoneyOutKind, PeriodicExpense } from "../src/engine/types.ts";
import { forEngine } from "../src/engine/moneyRows.ts";
import { allFields, type FieldDef, type GroupDef, type StageId } from "../src/workspace/input/form.ts";
import { fromRequest, mutate, standardBox, type WorkingHousehold } from "../src/workspace/input/household.ts";
import { addExpense, addIncome, FLAT_IN_KINDS, FLAT_OLD_ROW_HINT, FLAT_OUT_KINDS, INCOME_KINDS, OUT_KINDS } from "../src/workspace/input/moneyRows.ts";
import { addChildIncome } from "../src/workspace/input/stages/education.ts";
import { addReceiving } from "../src/workspace/input/stages/pension.ts";
import { buildStage } from "../src/workspace/input/stages/index.ts";
import { addMonths } from "../src/workspace/levers.ts";
import { modelHousehold, preview } from "./helpers.ts";

const ID = "00000000-0000-4000-8000-a00000000001";
/** お金の行の無い世帯 */
const bare = (id = "salariedCoupleTwoKids"): WorkingHousehold => {
  const wh = fromRequest(modelHousehold(id));
  const h = wh.request.input.household;
  return { ...wh, request: { ...wh.request, input: { ...wh.request.input, household: { ...h, periodicExpenses: [], incomeFlows: [] } } } };
};
const expenseOf = (wh: WorkingHousehold, id = ID): PeriodicExpense => (wh.request.input.household.periodicExpenses ?? []).find((p) => p.id === id)!;
const incomeOf = (wh: WorkingHousehold, id = ID): IncomeFlow => (wh.request.input.household.incomeFlows ?? []).find((f) => f.id === id)!;
const fieldOf = (stage: StageId, wh: WorkingHousehold, key: string): FieldDef => {
  const f = allFields(buildStage(stage, wh)).find((x) => x.key === key);
  if (f === undefined) throw new Error(`no field ${key}`);
  return f;
};
const groupOf = (stage: StageId, wh: WorkingHousehold, key: string): GroupDef => buildStage(stage, wh).sections.flatMap((s) => s.groups).find((g) => g.key === key)!;
/** 伸び方を持たない前の行にする */
const legacyOf = (wh: WorkingHousehold, list: "periodicExpenses" | "incomeFlows", id = ID): WorkingHousehold => mutate(wh, (h) => void delete (h[list] ?? []).find((x) => x.id === id)!.growth);
/** その年のその行の額（足した世帯と足す前の世帯の差） */
const cellDiff = (after: EngineRequest, before: EngineRequest, row: string, year: number): number => {
  const sum = (req: EngineRequest) =>
    preview(forEngine(req))
      .table.filter((c) => c.row === row && c.year === year)
      .reduce((s, c) => s + c.amount, 0);
  return sum(after) - sum(before);
};

/** 種類ごとの新しい既定（報告の表と同じ。"none" は「変えない」、undefined は物価） */
const IN_EXPECTED: Record<IncomeFlowKind, "none" | undefined> = {
  inheritance: "none", // 1回（相続・贈与の入力項目の額の入れ方「その時の額のまま」）
  giftReceived: "none",
  support: "none",
  educationSupport: "none",
  childSupport: "none",
  propertyDivision: "none",
  householdContribution: "none",
  benefit: undefined,
  unemployment: "none",
  survivorPension: undefined,
  foreignPension: undefined,
  scholarshipGrant: "none",
  childPays: "none",
  sideJob: undefined,
  otherWork: undefined,
  saleBusiness: undefined,
  saleGoods: "none", // 1回（ライフイベントの入力項目）
  temporary: "none", // 1回（ライフイベントの入力項目）
  celebration: "none", // 1回（ライフイベントの入力項目）
  subsidy: "none",
  powerSale: "none",
  insuranceBenefit: "none",
  other: "none", // 1回（ライフイベントの入力項目）
};
const OUT_EXPECTED: Partial<Record<MoneyOutKind, "none" | undefined>> = {
  general: "none", // 1回（ライフイベントの入力項目）
  childSupport: "none",
  allowance: "none",
  gift: "none",
  education: undefined,
  repair: undefined,
  realEstateCost: undefined,
  livingAnnual: undefined,
  car: undefined,
  other: "none", // 1回（ライフイベントの入力項目）
  dream: "none", // 1回（夢プラン）
};

describe("種類ごとの伸び方の既定（足したとき）", () => {
  it("入るお金・出るお金のどの種類も、表のとおりの伸び方を書く（変えないは明示、物価は書かない）", () => {
    const wh = bare();
    for (const k of INCOME_KINDS) {
      const g = incomeOf(addIncome(wh, k.kind, ID)).growth;
      expect(g, k.kind).toEqual(IN_EXPECTED[k.kind] === "none" ? { kind: "none" } : undefined);
    }
    for (const k of OUT_KINDS) {
      expect(k.kind in OUT_EXPECTED, k.kind).toBe(true);
      const g = expenseOf(addExpense(wh, k.kind, ID)).growth;
      expect(g, k.kind).toEqual(OUT_EXPECTED[k.kind] === "none" ? { kind: "none" } : undefined);
    }
    // 表に無い種類が増えたら、ここで既定を決める
    expect(Object.keys(IN_EXPECTED).sort()).toEqual(INCOME_KINDS.map((k) => k.kind).sort());
  });

  it("額を変えない種類は、くり返しの行でも変えない（1回の行の既定とは別に決まる）", () => {
    for (const k of FLAT_IN_KINDS) expect(IN_EXPECTED[k], k).toBe("none");
    for (const k of FLAT_OUT_KINDS) expect(OUT_EXPECTED[k], k).toBe("none");
    // 物やサービスの値段で決まる支出・働く収入・年金は物価のまま
    for (const k of ["education", "repair", "realEstateCost", "livingAnnual", "car"] as const) expect(FLAT_OUT_KINDS.has(k), k).toBe(false);
    for (const k of ["sideJob", "otherWork", "survivorPension", "foreignPension", "benefit"] as const) expect(FLAT_IN_KINDS.has(k), k).toBe(false);
  });

  it("入力項目の「＋」・ほかの入り口で足しても同じ（家族・介護・親・子ども・教育・年金）", () => {
    const wh = bare();
    const run = (stage: StageId, key: string) => {
      const before = new Set([...(wh.request.input.household.incomeFlows ?? []), ...(wh.request.input.household.periodicExpenses ?? [])].map((x) => x.id));
      const next = buildStage(stage, wh)
        .sections.flatMap((s) => [...s.actions, ...s.groups.flatMap((g) => g.actions)])
        .find((a) => a.key === key)!
        .run(wh);
      const h = next.request.input.household;
      return [...(h.incomeFlows ?? []), ...(h.periodicExpenses ?? [])].find((x) => !before.has(x.id))!;
    };
    expect(run("care", "money/care/out/add/allowance").growth).toEqual({ kind: "none" });
    expect(run("care", "money/care/in/add/support").growth).toEqual({ kind: "none" });
    expect(run("work", "money/work/in/add/sideJob").growth).toBeUndefined();
    expect(run("housing", "money/housing/in/add/powerSale").growth).toEqual({ kind: "none" });
    expect(run("housing", "money/housing/out/add/repair").growth).toBeUndefined();
    const child = wh.request.input.household.members.find((m) => m.kind === "child")!;
    for (const kind of ["educationSupport", "scholarshipGrant", "childPays"] as const) expect(incomeOf(addChildIncome(wh, child.id, kind, ID)).growth, kind).toEqual({ kind: "none" });
    // 受給中の遺族年金・障害年金は物価（年金は毎年改定される）
    expect(incomeOf(addReceiving(wh, "survivorBasic", ID)).growth).toBeUndefined();
  });

  it("計算: 月5万円の仕送りは5年後も年60万円のまま。前の行（伸び方なし）は今までどおり物価で伸びる。年払いの支出は物価で伸びる", () => {
    const wh = bare();
    const y = Number(wh.request.input.baseMonth.slice(0, 4)) + 5;
    const allowance = mutate(addExpense(wh, "allowance", ID), (h) => void ((h.periodicExpenses ?? [])[0]!.amount = standardBox(50_000, "テストの額") as PeriodicExpense["amount"]));
    expect(cellDiff(allowance.request, wh.request, "cf.expense.other", y)).toBe(600_000);
    expect(cellDiff(legacyOf(allowance, "periodicExpenses").request, wh.request, "cf.expense.other", y)).toBeGreaterThan(600_000);
    const annual = mutate(addExpense(wh, "livingAnnual", ID), (h) => void ((h.periodicExpenses ?? [])[0]!.amount = standardBox(100_000, "テストの額") as PeriodicExpense["amount"]));
    expect(cellDiff(annual.request, wh.request, "cf.expense.living", y)).toBeGreaterThan(100_000);
  });
});

/** 伸び方を持たない前の仕送り・毎年の贈与の行のある世帯（見本の世帯から伸び方を外した形。見本の世帯は 2026-11-11 から「変えない」を持つ） */
const legacyParentsCare = (): WorkingHousehold => {
  const req = modelHousehold("sampleParentsCare");
  for (const p of req.input.household.periodicExpenses ?? []) delete p.growth;
  return fromRequest(req);
};

describe("見本の世帯の伸び方", () => {
  it("仕送り・毎年の贈与の行は「変えない」を持つ（0044 の追記 2026-11-11）", () => {
    const h = modelHousehold("sampleParentsCare").input.household;
    const rows = (h.periodicExpenses ?? []).filter((p) => p.kind === "allowance" || p.kind === "gift");
    expect(rows.map((p) => p.kind).sort()).toEqual(["allowance", "gift"]);
    for (const p of rows) expect(p.growth).toEqual({ kind: "none" });
  });
});

describe("既存の世帯の数字は変わらない", () => {
  it("伸び方の無い仕送り・毎年の贈与の行は、どの入力項目を開いても、額を直しても伸び方を書き換えない", () => {
    const wh = legacyParentsCare();
    const before = structuredClone(wh.request.input.household);
    for (const id of ["family", "work", "pension", "living", "education", "housing", "events", "car", "care", "inheritance"] as const) buildStage(id, wh);
    expect(wh.request.input.household).toEqual(before);
    const allowance = (wh.request.input.household.periodicExpenses ?? []).find((p) => p.kind === "allowance")!;
    expect(allowance.growth).toBeUndefined();
    const edited = fieldOf("care", wh, `ev/${allowance.id}/amount`).set(wh, 40_000);
    expect(expenseOf(edited, allowance.id).growth).toBeUndefined();
  });

  it("伸び方の無い前の行は「物価に合わせる」と見せ、物価で伸ばしていることを添える。「詳細あり」には数えない", () => {
    const wh = legacyParentsCare();
    const allowance = (wh.request.input.household.periodicExpenses ?? []).find((p) => p.kind === "allowance")!;
    const g = fieldOf("care", wh, `ev/${allowance.id}/growth`);
    expect(g.label).toBe("伸び方");
    expect(g.get(wh)).toMatchObject({ value: "inflation", hint: FLAT_OLD_ROW_HINT });
    expect(groupOf("care", wh, `ev/${allowance.id}`).note ?? "").not.toContain("伸び方");
    // 見せている「物価に合わせる」を入れ直しても書き換えない。「変えない」を選ぶと書く
    expect(expenseOf(g.set(wh, "inflation"), allowance.id).growth).toBeUndefined();
    expect(expenseOf(g.set(wh, "none"), allowance.id).growth).toEqual({ kind: "none" });
  });
});

describe("伸び方の既定が「変えない」の行の欄", () => {
  it("足した行は「変えない」と見せ、添え書きは出さず「詳細あり」にも数えない", () => {
    const wh = addExpense(bare(), "allowance", ID);
    const g = fieldOf("care", wh, `ev/${ID}/growth`);
    expect(g.get(wh).value).toBe("none");
    expect(g.get(wh).hint ?? null).toBeNull();
    expect(groupOf("care", wh, `ev/${ID}`).note ?? "").not.toContain("伸び方");
  });

  it("「物価に合わせる」を選ぶと明示して書き（前の行と区別する）、「詳細あり」に数える。計算は物価で伸びる", () => {
    const wh = addExpense(bare(), "allowance", ID);
    const next = fieldOf("care", wh, `ev/${ID}/growth`).set(wh, "inflation");
    expect(expenseOf(next).growth).toEqual({ kind: "inflation" });
    const g = fieldOf("care", next, `ev/${ID}/growth`).get(next);
    expect(g.value).toBe("inflation");
    expect(g.implicit ?? false).toBe(false);
    expect(g.hint ?? null).toBeNull();
    expect(groupOf("care", next, `ev/${ID}`).note).toContain("伸び方");
    const back = fieldOf("care", next, `ev/${ID}/growth`).set(next, "none");
    expect(expenseOf(back).growth).toEqual({ kind: "none" });
    const rate = fieldOf("care", next, `ev/${ID}/growth`).set(next, "rate");
    expect(expenseOf(rate).growth).toEqual({ kind: "rate", rate: "0.01" });
  });
});

describe("種類・回数を選び直したとき", () => {
  it("伸び方が前の種類の既定のままなら、新しい種類の既定に合わせる（手当 → 養育費 → 手当）", () => {
    const wh = addIncome(bare(), "benefit", ID);
    expect(incomeOf(wh).growth).toBeUndefined();
    const support = fieldOf("family", wh, `in/${ID}/kind`).set(wh, "childSupport");
    expect(incomeOf(support).growth).toEqual({ kind: "none" });
    const back = fieldOf("family", support, `in/${ID}/kind`).set(support, "benefit");
    expect(incomeOf(back).growth).toBeUndefined();
    // 働き方と収入: 副業 → 教育訓練給付など
    const side = addIncome(bare(), "sideJob", ID);
    expect(incomeOf(fieldOf("work", side, `in/${ID}/kind`).set(side, "unemployment")).growth).toEqual({ kind: "none" });
  });

  it("FP が選んだ伸び方は、種類を変えても残す", () => {
    const wh = addIncome(bare(), "benefit", ID);
    const rate = fieldOf("family", wh, `in/${ID}/growth`).set(wh, "rate");
    expect(incomeOf(fieldOf("family", rate, `in/${ID}/kind`).set(rate, "childSupport")).growth).toEqual({ kind: "rate", rate: "0.01" });
    const flat = addIncome(bare(), "childSupport", ID);
    const nominal = fieldOf("family", flat, `in/${ID}/growth`).set(flat, "inflation");
    expect(incomeOf(fieldOf("family", nominal, `in/${ID}/kind`).set(nominal, "benefit")).growth).toEqual({ kind: "inflation" });
  });

  it("伸び方の無い前の行は、種類を変えても書き換えない（前の行の物価のまま）", () => {
    const wh = legacyOf(addIncome(bare(), "childSupport", ID), "incomeFlows");
    expect(incomeOf(fieldOf("family", wh, `in/${ID}/kind`).set(wh, "householdContribution")).growth).toBeUndefined();
  });

  it("額を変えない種類は、回数を変えても「変えない」のまま（あげる贈与を毎年に・養育費を1回に）", () => {
    const gift = addExpense(bare(), "gift", ID);
    const yearly = fieldOf("inheritance", gift, `ev/${ID}/cadence`).set(gift, "repeat");
    expect(expenseOf(yearly).growth).toEqual({ kind: "none" });
    expect(fieldOf("inheritance", yearly, `ev/${ID}/growth`).label).toBe("伸び方");
    const support = addIncome(bare(), "childSupport", ID);
    expect(incomeOf(fieldOf("family", support, `in/${ID}/cadence`).set(support, "once")).growth).toEqual({ kind: "none" });
    // 物価の種類は、ライフイベント・相続・贈与の入力項目でなければ回数を変えても物価のまま
    const side = addIncome(bare(), "sideJob", ID);
    expect(incomeOf(fieldOf("work", side, `in/${ID}/cadence`).set(side, "once")).growth).toBeUndefined();
  });

  it("毎年の贈与（あげる贈与）は計算でも伸ばさない: 年110万円は5年後も110万円", () => {
    const wh = bare();
    const gift = mutate(addExpense(wh, "gift", ID), (h) => {
      const p = (h.periodicExpenses ?? [])[0]!;
      p.to = { at: addMonths(wh.request.input.baseMonth, 12 * 10) };
    });
    const y = Number(wh.request.input.baseMonth.slice(0, 4)) + 5;
    expect(cellDiff(gift.request, wh.request, "cf.expense.lumpSum.gift", y)).toBe(1_100_000);
  });
});
