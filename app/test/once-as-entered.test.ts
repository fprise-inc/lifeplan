// ライフイベントの1回のお金の行は、入れた額のまま（物価で増やさない）を既定にする（0008 の追記 2026-11-02）:
// 新しく足す1回の行・毎年から1回に変えた行に伸び方「変えない」を明示して書く（エンジンの既定〔省略は物価〕は変えない）。伸び方を持たない前の行は
// 今の読み方（物価）のまま。1回の行の欄は「額の入れ方」（その時の額のまま／今の値段で入れた（物価上昇率で増やす）／決まった率で増やす）、くり返す行は「伸び方」のまま。
// 相続・贈与の入力項目の1回の行（受け取る相続・受け取る贈与・あげる贈与）も同じ（0008 の追記 2026-11-03）
import { describe, expect, it } from "vitest";
import type { EngineRequest, IncomeFlow, PeriodicExpense } from "../src/engine/types.ts";
import { forEngine } from "../src/engine/moneyRows.ts";
import { addDream, DREAM_TEMPLATES } from "../src/workspace/input/dreams.ts";
import { allFields, type FieldDef, type GroupDef } from "../src/workspace/input/form.ts";
import { fromRequest, mutate, standardBox, type WorkingHousehold } from "../src/workspace/input/household.ts";
import { GROWTH_KINDS } from "../src/workspace/input/labels.ts";
import { addExpense, addIncome, expenseCard, ONCE_AMOUNT_KINDS } from "../src/workspace/input/moneyRows.ts";
import { addChildExpense } from "../src/workspace/input/stages/education.ts";
import { addIncomeTemplate, addOtherExpense, addOutTemplate, addReserve, OUT_TEMPLATES, addEventTemplate } from "../src/workspace/input/stages/events.ts";
import { buildStage } from "../src/workspace/input/stages/index.ts";
import { addMonths } from "../src/workspace/levers.ts";
import { modelHousehold, preview } from "./helpers.ts";

const seq = (p = "a"): (() => string) => {
  let n = 0;
  return () => `00000000-0000-4000-8000-${p.padEnd(4, "0")}${String(++n).padStart(8, "0")}`;
};
const ID = "00000000-0000-4000-8000-a00000000001";
/** ライフイベントの行の無い世帯 */
const bare = (id = "salariedCoupleTwoKids"): WorkingHousehold => {
  const wh = fromRequest(modelHousehold(id));
  const h = wh.request.input.household;
  return { ...wh, request: { ...wh.request, input: { ...wh.request.input, household: { ...h, periodicExpenses: (h.periodicExpenses ?? []).filter((p) => expenseCard(h, p) !== "events"), incomeFlows: [] } } } };
};
const events = (wh: WorkingHousehold) => buildStage("events", wh);
const fieldOf = (wh: WorkingHousehold, key: string): FieldDef => allFields(events(wh)).find((f) => f.key === key)!;
const groupOf = (wh: WorkingHousehold, key: string): GroupDef => events(wh).sections.flatMap((s) => s.groups).find((g) => g.key === key)!;
const expenseOf = (wh: WorkingHousehold, id = ID): PeriodicExpense => (wh.request.input.household.periodicExpenses ?? []).find((p) => p.id === id)!;
const incomeOf = (wh: WorkingHousehold, id = ID): IncomeFlow => (wh.request.input.household.incomeFlows ?? []).find((f) => f.id === id)!;
const labels = (f: FieldDef) => (f.kind === "select" ? f.options.map((o) => o.label) : []);
const values = (f: FieldDef) => (f.kind === "select" ? f.options.map((o) => o.value) : []);

/** 今から5年後（の同じ月） */
const in5 = (wh: WorkingHousehold) => addMonths(wh.request.input.baseMonth, 60);
const year5 = (wh: WorkingHousehold) => Number(in5(wh).slice(0, 4));
/** 行の額と時期を置く（1回は時期と終わりを同じ月に） */
function place(wh: WorkingHousehold, id: string, amount: number, list: "periodicExpenses" | "incomeFlows" = "periodicExpenses"): WorkingHousehold {
  return mutate(wh, (h) => {
    const r = (h[list] ?? []).find((x) => x.id === id)!;
    r.amount = standardBox(amount, "テストの額") as PeriodicExpense["amount"];
    const at = in5(wh);
    r.from = { at };
    if (r.to != null) r.to = { at };
  });
}
/** その年のその行の額（足した世帯と足す前の世帯の差） */
const cellDiff = (after: EngineRequest, before: EngineRequest, row: string, year: number): number => {
  const sum = (req: EngineRequest) =>
    preview(forEngine(req))
      .table.filter((c) => c.row === row && c.year === year)
      .reduce((s, c) => s + c.amount, 0);
  return sum(after) - sum(before);
};

describe("新しく足す1回の行は、入れた額のまま（伸び方「変えない」を書く）", () => {
  it("夢のひな形・夢を足す・家族の出来事のひな形・ほかの支出・入るお金のひな形は、どれも伸び方「変えない」", () => {
    const wh = bare();
    const id = seq();
    const dream = addDream(wh, DREAM_TEMPLATES.find((t) => t.key === "trip")!, ID);
    expect(expenseOf(dream).growth).toEqual({ kind: "none" });
    expect(expenseOf(addDream(wh, null, ID)).growth).toEqual({ kind: "none" });
    for (const key of ["wedding", "comingOfAge", "funeral", "memorial", "grave"]) {
      const w = addOutTemplate(wh, key, id);
      const added = (w.request.input.household.periodicExpenses ?? []).filter((p) => !(wh.request.input.household.periodicExpenses ?? []).some((x) => x.id === p.id));
      expect(added.length, key).toBeGreaterThan(0);
      for (const p of added) expect(p.growth, key).toEqual({ kind: "none" });
    }
    expect(expenseOf(addOtherExpense(wh, ID)).growth).toEqual({ kind: "none" });
    expect(expenseOf(addExpense(wh, "general", ID)).growth).toEqual({ kind: "none" });
    expect(expenseOf(addExpense(wh, "other", ID)).growth).toEqual({ kind: "none" });
    for (const label of ["結婚のお祝い", "出産のお祝い", "一時の給付金"]) expect(incomeOf(addIncomeTemplate(wh, label, ID)).growth, label).toEqual({ kind: "none" });
    for (const kind of ["celebration", "temporary", "saleGoods", "other"] as const) expect(incomeOf(addIncome(wh, kind, ID)).growth, kind).toEqual({ kind: "none" });
  });

  it("計算でも伸ばさない: 5年後に200万円の夢・支出・祝い金は、その年に200万円のまま", () => {
    const wh = bare();
    const y = year5(wh);
    const dream = place(addDream(wh, null, ID), ID, 2_000_000);
    expect(cellDiff(dream.request, wh.request, "cf.expense.lumpSum.other", y)).toBe(2_000_000);
    const other = place(addOtherExpense(wh, ID), ID, 2_000_000);
    expect(cellDiff(other.request, wh.request, "cf.expense.lumpSum.other", y)).toBe(2_000_000);
    const gift = place(addIncomeTemplate(wh, "結婚のお祝い", ID), ID, 2_000_000, "incomeFlows");
    expect(cellDiff(gift.request, wh.request, "cf.income.lumpSum.other", y)).toBe(2_000_000);
    // 「今の値段で入れた（物価上昇率で増やす）」を選ぶと、その時までの物価上昇率で増やす
    const f = fieldOf(dream, `ev/${ID}/growth`);
    const nominal = f.set(dream, "inflation");
    expect(expenseOf(nominal).growth).toEqual({ kind: "inflation" });
    expect(cellDiff(nominal.request, wh.request, "cf.expense.lumpSum.other", y)).toBeGreaterThan(2_000_000);
  });
});

describe("くり返す行は今のまま（伸び方の既定は物価）", () => {
  it("予備費（毎年）・くり返す行のひな形には伸び方を書かない。計算では物価で伸びる", () => {
    const wh = bare();
    expect(expenseOf(addReserve(wh, ID)).growth).toBeUndefined();
    expect(expenseOf(addOutTemplate(wh, "reserve", () => ID)).growth).toBeUndefined();
    expect(expenseOf(addEventTemplate(wh, { ...OUT_TEMPLATES.find((t) => t.key === "memorial")!, everyYears: 3 }, ID)).growth).toBeUndefined();
    const reserve = mutate(addReserve(wh, ID), (h) => {
      const p = h.periodicExpenses!.find((x) => x.id === ID)!;
      p.amount = standardBox(1_000_000, "テストの額") as PeriodicExpense["amount"];
      p.from = { at: in5(wh) };
    });
    expect(cellDiff(reserve.request, wh.request, "cf.expense.lumpSum.other", year5(wh))).toBeGreaterThan(1_000_000);
  });

  it("ライフイベント・相続・贈与以外の入力項目の1回の行（不動産の一時の経費・事業の売却代金・子ども・教育の留学）は今のまま", () => {
    const wh = bare();
    expect(expenseOf(addExpense(wh, "realEstateCost", ID)).growth).toBeUndefined();
    expect(incomeOf(addIncome(wh, "saleBusiness", ID)).growth).toBeUndefined();
    const child = wh.request.input.household.members.find((m) => m.kind === "child")!;
    expect(expenseOf(addChildExpense(wh, child.id, "abroad", ID)).growth).toBeUndefined();
  });
});

describe("時期を変えたとき", () => {
  it("年ごと→1回にすると「その時の額」を書き、1回→年ごとに戻すと物価に戻す", () => {
    const wh = addReserve(bare(), ID);
    expect(expenseOf(wh).growth).toBeUndefined();
    const once = fieldOf(wh, `ev/${ID}/cadence`).set(wh, "once");
    expect(expenseOf(once).growth).toEqual({ kind: "none" });
    expect(fieldOf(once, `ev/${ID}/growth`).label).toBe("額の入れ方");
    const back = fieldOf(once, `ev/${ID}/cadence`).set(once, "repeat");
    expect(expenseOf(back).growth).toBeUndefined();
    expect(fieldOf(back, `ev/${ID}/growth`).label).toBe("伸び方");
    // 入るお金の行も同じ
    const inc = addIncomeTemplate(bare(), "一時の給付金", ID);
    const rep = fieldOf(inc, `in/${ID}/cadence`).set(inc, "repeat");
    expect(incomeOf(rep).growth).toBeUndefined();
    expect(incomeOf(fieldOf(rep, `in/${ID}/cadence`).set(rep, "once")).growth).toEqual({ kind: "none" });
  });

  it("選んだ伸び方は時期を変えても残す（決まった率・物価に合わせるを選んだ行）", () => {
    const wh = mutate(addReserve(bare(), ID), (h) => void (h.periodicExpenses!.find((x) => x.id === ID)!.growth = { kind: "rate", rate: "0.02" }));
    const once = fieldOf(wh, `ev/${ID}/cadence`).set(wh, "once");
    expect(expenseOf(once).growth).toEqual({ kind: "rate", rate: "0.02" });
    const nominal = fieldOf(once, `ev/${ID}/growth`).set(once, "inflation");
    expect(expenseOf(nominal).growth).toEqual({ kind: "inflation" });
    expect(expenseOf(fieldOf(nominal, `ev/${ID}/cadence`).set(nominal, "repeat")).growth).toEqual({ kind: "inflation" });
  });
});

describe("伸び方を持たない前の1回の行は、今の読み方（物価）のまま", () => {
  /** 前の版で足した1回の行（伸び方を持たない） */
  const legacy = (): WorkingHousehold =>
    mutate(bare(), (h, req) => {
      const at = addMonths(req.input.baseMonth, 60);
      (h.periodicExpenses ??= []).push({ id: ID, label: "前の一時的支出", kind: "general", row: "cf.expense.lumpSum.other", from: { at }, to: { at }, everyYears: 1, amount: standardBox(2_000_000, "テストの額") as PeriodicExpense["amount"] });
    });

  it("画面は「今の値段で入れた（物価上昇率で増やす）」（選んでいない）と見せ、額・時期を直しても伸び方を書かない。計算は物価で伸びる", () => {
    const wh = legacy();
    const g = fieldOf(wh, `ev/${ID}/growth`);
    expect(g.label).toBe("額の入れ方");
    expect(g.get(wh)).toMatchObject({ value: "inflation", implicit: true });
    const edited = fieldOf(wh, `ev/${ID}/amount`).set(wh, 2_500_000);
    expect(expenseOf(edited).growth).toBeUndefined();
    const moved = fieldOf(edited, `ev/${ID}/from`).set(edited, addMonths(wh.request.input.baseMonth, 72));
    expect(expenseOf(moved).growth).toBeUndefined();
    expect(cellDiff(wh.request, bare().request, "cf.expense.lumpSum.other", year5(wh))).toBeGreaterThan(2_000_000);
    // 「詳細あり」に伸び方を出さない（前と同じ）
    expect(groupOf(wh, `ev/${ID}`).note ?? "").not.toContain("額の入れ方");
  });

  it("見本の世帯は、入力の画面を開いても行の伸び方を書き換えない", () => {
    for (const m of ["salariedCoupleTwoKids", "unexplainedSpending", "dualAssetsTwoKids"]) {
      const wh = fromRequest(modelHousehold(m));
      const before = JSON.stringify(wh.request.input.household);
      events(wh);
      buildStage("inheritance", wh);
      expect(JSON.stringify(wh.request.input.household), m).toBe(before);
    }
  });
});

describe("欄の名前と選択肢", () => {
  it("ライフイベントの1回の行は「額の入れ方」（その時の額のまま＝既定／今の値段で入れた（物価上昇率で増やす）／決まった率で増やす）。くり返す行は「伸び方」", () => {
    const wh = addOtherExpense(bare(), ID);
    const g = fieldOf(wh, `ev/${ID}/growth`);
    expect(g.label).toBe("額の入れ方");
    expect(labels(g)).toEqual(["その時の額のまま", "今の値段で入れた（物価上昇率で増やす）", "決まった率で増やす"]);
    expect(values(g)).toEqual(["none", "inflation", "rate"]);
    expect(ONCE_AMOUNT_KINDS.map((o) => o.value).sort()).toEqual(GROWTH_KINDS.map((o) => o.value).sort());
    expect(g.get(wh).value).toBe("none");
    expect(g.help).toContain("その時に払う（受け取る）額をそのまま入れたとき");
    expect(g.help).toContain("今の値段で入れた額を、その時までの物価上昇率で増やします");
    expect(g.help).not.toContain("額は今の値段で入れます");
    // 額の欄の「?」も額の入れ方に合わせる
    expect(fieldOf(wh, `ev/${ID}/amount`).help).toContain("その時の額をそのまま入れます");
    expect(fieldOf(g.set(wh, "inflation"), `ev/${ID}/amount`).help).toContain("その時までの物価上昇率で増やして");
    // 詳細のまとまりの名前・「▸ …」の文
    expect(groupOf(wh, `ev/${ID}/who`).title).toBe("払う人・額の入れ方・万一のときの扱い");
    expect(groupOf(wh, `ev/${ID}`).moreLabel).toBe("払う人・額の入れ方を入れる");
    // 既定の「その時の額」は「詳細あり」に数えない。「今の値段で入れた（物価上昇率で増やす）」を選ぶと数える
    expect(groupOf(wh, `ev/${ID}`).note ?? "").not.toContain("額の入れ方");
    expect(groupOf(g.set(wh, "inflation"), `ev/${ID}`).note).toContain("額の入れ方");
    // 決まった率を選ぶと率の欄が出る
    const rate = g.set(wh, "rate");
    expect(expenseOf(rate).growth).toEqual({ kind: "rate", rate: "0.01" });
    expect(allFields(events(rate)).some((f) => f.key === `ev/${ID}/growthRate`)).toBe(true);
    // くり返す行
    const reserve = addReserve(bare(), ID);
    const r = fieldOf(reserve, `ev/${ID}/growth`);
    expect(r.label).toBe("伸び方");
    expect(values(r)).toEqual(GROWTH_KINDS.map((o) => o.value));
    expect(r.get(reserve).value).toBe("inflation");
    expect(groupOf(reserve, `ev/${ID}/who`).title).toBe("払う人・伸び方・万一のときの扱い");
  });

  it("入るお金の1回の行・夢も「額の入れ方」", () => {
    const wh = addIncomeTemplate(bare(), "結婚のお祝い", ID);
    const g = fieldOf(wh, `in/${ID}/growth`);
    expect(g.label).toBe("額の入れ方");
    expect(g.get(wh).value).toBe("none");
    expect(fieldOf(wh, `in/${ID}/amount`).help).toContain("その時の額をそのまま入れます");
    expect(groupOf(wh, `in/${ID}/who`).title).toContain("額の入れ方");
    const dream = addDream(bare(), null, ID);
    const d = fieldOf(dream, `ev/${ID}/growth`);
    expect(d.label).toBe("額の入れ方");
    expect(d.level).toBe("detail");
    expect(d.get(dream).value).toBe("none");
    expect(groupOf(dream, `ev/${ID}`).moreLabel).toBe("額の入れ方を選ぶ");
  });
});

// ---- 相続・贈与の入力項目の1回の行（0008 の追記 2026-11-03） ----

describe("相続・贈与の入力項目の1回の行も、入れた額のまま", () => {
  /** 相続・贈与の行も無い世帯 */
  const bareInherit = (): WorkingHousehold => {
    const wh = bare();
    const h = wh.request.input.household;
    return { ...wh, request: { ...wh.request, input: { ...wh.request.input, household: { ...h, periodicExpenses: (h.periodicExpenses ?? []).filter((p) => expenseCard(h, p) !== "inherit") } } } };
  };
  const inherit = (wh: WorkingHousehold) => buildStage("inheritance", wh);
  const inField = (wh: WorkingHousehold, key: string): FieldDef => allFields(inherit(wh)).find((f) => f.key === key)!;
  const inGroup = (wh: WorkingHousehold, key: string): GroupDef => inherit(wh).sections.flatMap((s) => s.groups).find((g) => g.key === key)!;
  /** 入力項目の「＋ …」で足して、足した行を返す */
  const addBy = (wh: WorkingHousehold, key: string): { wh: WorkingHousehold; row: IncomeFlow | PeriodicExpense } => {
    const h0 = wh.request.input.household;
    const ids = new Set([...(h0.incomeFlows ?? []), ...(h0.periodicExpenses ?? [])].map((x) => x.id));
    const next = inherit(wh).sections.flatMap((s) => s.actions).find((a) => a.key === key)!.run(wh);
    const h = next.request.input.household;
    return { wh: next, row: [...(h.incomeFlows ?? []), ...(h.periodicExpenses ?? [])].find((x) => !ids.has(x.id))! };
  };
  /** 前の版で足した1回の行（伸び方を持たない） */
  const legacyOf = (wh: WorkingHousehold, list: "periodicExpenses" | "incomeFlows"): WorkingHousehold => mutate(wh, (h) => void delete (h[list] ?? []).find((x) => x.id === ID)!.growth);

  it("受け取る相続・受け取る贈与・あげる贈与を足すと、伸び方「変えない」を書く（入力項目の「＋ …」で足しても同じ）", () => {
    const wh = bareInherit();
    expect(incomeOf(addIncome(wh, "inheritance", ID)).growth).toEqual({ kind: "none" });
    expect(incomeOf(addIncome(wh, "giftReceived", ID)).growth).toEqual({ kind: "none" });
    expect(expenseOf(addExpense(wh, "gift", ID)).growth).toEqual({ kind: "none" });
    for (const key of ["money/inherit/in/add/inheritance", "money/inherit/in/add/giftReceived", "money/inherit/out/add/gift"]) expect(addBy(wh, key).row.growth, key).toEqual({ kind: "none" });
  });

  it("計算でも伸ばさない: 5年後に受け取る相続2,000万円・あげる贈与110万円は、その年にその額のまま。前の行は物価で伸びる", () => {
    const wh = bareInherit();
    const y = year5(wh);
    const inh = place(addIncome(wh, "inheritance", ID), ID, 20_000_000, "incomeFlows");
    expect(cellDiff(inh.request, wh.request, "cf.income.lumpSum.inheritance", y)).toBe(20_000_000);
    expect(cellDiff(legacyOf(inh, "incomeFlows").request, wh.request, "cf.income.lumpSum.inheritance", y)).toBeGreaterThan(20_000_000);
    const gift = place(addExpense(wh, "gift", ID), ID, 1_100_000);
    expect(cellDiff(gift.request, wh.request, "cf.expense.lumpSum.gift", y)).toBe(1_100_000);
    expect(cellDiff(legacyOf(gift, "periodicExpenses").request, wh.request, "cf.expense.lumpSum.gift", y)).toBeGreaterThan(1_100_000);
    // 「今の値段で入れた（物価上昇率で増やす）」を選ぶと、その時までの物価上昇率で増やす
    const nominal = inField(gift, `ev/${ID}/growth`).set(gift, "inflation");
    expect(expenseOf(nominal).growth).toEqual({ kind: "inflation" });
    expect(cellDiff(nominal.request, wh.request, "cf.expense.lumpSum.gift", y)).toBeGreaterThan(1_100_000);
  });

  it("1回の行の欄は「額の入れ方」（その時の額のまま＝既定／今の値段で入れた（物価上昇率で増やす）／決まった率で増やす）", () => {
    const gift = addExpense(bareInherit(), "gift", ID);
    const g = inField(gift, `ev/${ID}/growth`);
    expect(g.label).toBe("額の入れ方");
    expect(labels(g)).toEqual(["その時の額のまま", "今の値段で入れた（物価上昇率で増やす）", "決まった率で増やす"]);
    expect(values(g)).toEqual(["none", "inflation", "rate"]);
    expect(g.get(gift).value).toBe("none");
    expect(inField(gift, `ev/${ID}/amount`).help).toContain("その時の額をそのまま入れます");
    expect(inGroup(gift, `ev/${ID}/who`).title).toBe("払う人・額の入れ方・万一のときの扱い");
    expect(inGroup(gift, `ev/${ID}`).note ?? "").not.toContain("額の入れ方");
    expect(inGroup(g.set(gift, "inflation"), `ev/${ID}`).note).toContain("額の入れ方");
    for (const kind of ["inheritance", "giftReceived"] as const) {
      const inc = addIncome(bareInherit(), kind, ID);
      const f = inField(inc, `in/${ID}/growth`);
      expect(f.label, kind).toBe("額の入れ方");
      expect(values(f), kind).toEqual(["none", "inflation", "rate"]);
      expect(f.get(inc).value, kind).toBe("none");
      expect(inField(inc, `in/${ID}/amount`).help, kind).toContain("その時の額をそのまま入れます");
      expect(inGroup(inc, `in/${ID}/who`).title, kind).toBe("受け取る人・額の入れ方・万一のときの扱い・表の行");
    }
  });

  it("時期を年ごとにすると物価に戻し（欄は「伸び方」）、1回に戻すと「その時の額」を書く", () => {
    const inc = addIncome(bareInherit(), "giftReceived", ID);
    const rep = inField(inc, `in/${ID}/cadence`).set(inc, "repeat");
    expect(incomeOf(rep).growth).toBeUndefined();
    expect(inField(rep, `in/${ID}/growth`).label).toBe("伸び方");
    expect(incomeOf(inField(rep, `in/${ID}/cadence`).set(rep, "once")).growth).toEqual({ kind: "none" });
    const gift = addExpense(bareInherit(), "gift", ID);
    const grep = inField(gift, `ev/${ID}/cadence`).set(gift, "repeat");
    expect(expenseOf(grep).growth).toBeUndefined();
    expect(expenseOf(inField(grep, `ev/${ID}/cadence`).set(grep, "once")).growth).toEqual({ kind: "none" });
  });

  it("伸び方を持たない前の行は「今の値段で入れた（物価上昇率で増やす）」（選んでいない）と見せ、額・時期を直しても伸び方を書かない", () => {
    const inc = legacyOf(place(addIncome(bareInherit(), "inheritance", ID), ID, 20_000_000, "incomeFlows"), "incomeFlows");
    const f = inField(inc, `in/${ID}/growth`);
    expect(f.label).toBe("額の入れ方");
    expect(f.get(inc)).toMatchObject({ value: "inflation", implicit: true });
    expect(inField(inc, `in/${ID}/amount`).help).toContain("その時までの物価上昇率で増やして");
    const edited = inField(inc, `in/${ID}/amount`).set(inc, 25_000_000);
    expect(incomeOf(edited).growth).toBeUndefined();
    const moved = inField(edited, `in/${ID}/from`).set(edited, addMonths(inc.request.input.baseMonth, 72));
    expect(incomeOf(moved).growth).toBeUndefined();
    expect(inGroup(inc, `in/${ID}`).note ?? "").not.toContain("額の入れ方");
    const gift = legacyOf(addExpense(bareInherit(), "gift", ID), "periodicExpenses");
    expect(inField(gift, `ev/${ID}/growth`).get(gift)).toMatchObject({ value: "inflation", implicit: true });
    expect(expenseOf(inField(gift, `ev/${ID}/amount`).set(gift, 1_200_000)).growth).toBeUndefined();
  });
});
