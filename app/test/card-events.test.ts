// ライフイベントのカードの中身（0068）: ひな形（家族旅行・結婚・大きな買い物・予備費、祝い金・一時の給付金）・入る⇄出るの付け替え・
// 基本生活費へ移す・介護はここに出さない・この世帯の予定（ほかのカードを含む。重なる年）
import { describe, expect, it } from "vitest";
import { allFields, type StageDef } from "../src/workspace/input/form.ts";
import { fromRequest, type WorkingHousehold } from "../src/workspace/input/household.ts";
import { itemStage } from "../src/workspace/input/items.ts";
import { expenseCard } from "../src/workspace/input/moneyRows.ts";
import { overlapYears, scheduleItems } from "../src/workspace/input/schedule.ts";
import { addCar } from "../src/workspace/input/stages/cars.ts";
import { addEventTemplate, addIncomeTemplate, addReserve, expenseToIncome, incomeToExpense, livingMonthlyNow, moveToLiving, OUT_TEMPLATES } from "../src/workspace/input/stages/events.ts";
import { buildStage } from "../src/workspace/input/stages/index.ts";
import { fieldStatus } from "../src/workspace/input/valueState.ts";
import { modelHousehold, preview } from "./helpers.ts";

const open = (id: string): WorkingHousehold => fromRequest(modelHousehold(id));
const events = (wh: WorkingHousehold) => buildStage("events", wh);
const tpl = (key: string) => OUT_TEMPLATES.find((t) => t.key === key)!;
const statusOf = (wh: WorkingHousehold, suffix: string) => fieldStatus(allFields(events(wh)).find((f) => f.key.endsWith(suffix))!, wh).status;
/** 行の無い世帯（ライフイベントの行を外す） */
const bare = (): WorkingHousehold => {
  const wh = open("salariedCoupleTwoKids");
  const h = wh.request.input.household;
  return { ...wh, request: { ...wh.request, input: { ...wh.request.input, household: { ...h, periodicExpenses: (h.periodicExpenses ?? []).filter((p) => expenseCard(h, p) !== "events"), incomeFlows: [] } } } };
};

describe("ライフイベントのひな形", () => {
  it("空のときは、よく使う出るお金・入るお金のボタンを簡易に出す", () => {
    const wh = bare();
    const s = events(wh);
    expect(s.sections.map((x) => x.key)).toEqual(["ev/periodic", "money/events/in", "events/schedule"]);
    const out = s.sections[0]!.actions.filter((a) => a.level === "simple").map((a) => a.key);
    expect(out).toEqual(expect.arrayContaining(["ev/template/travel", "ev/template/reserve", "ev/template/wedding", "ev/template/purchase", "ev/addOnce", "ev/addEvery"]));
    // ボタンは名前だけ（額を出さない）。家電の買い替えは基本生活費の年払いと重なるので置かない
    const labels = s.sections[0]!.actions.filter((a) => a.key.startsWith("ev/template/")).map((a) => a.label);
    expect(labels).toEqual(["＋ 家族旅行", "＋ 結婚の費用", "＋ リフォーム以外の大きな買い物", "＋ 予備費"]);
    expect(OUT_TEMPLATES.some((t) => t.key === "appliances")).toBe(false);
    const inn = s.sections[1]!.actions.filter((a) => a.level === "simple").map((a) => a.key);
    expect(inn).toEqual(expect.arrayContaining(["in/template/weddingGift", "in/template/birthGift", "in/template/benefit"]));
  });

  it("家族旅行は毎年30万円・大きな買い物は1回50万円（額と、くり返す行の何年ごとは推定。根拠はよくある目安）。結婚の費用は額が未入力の警告", () => {
    let wh = addEventTemplate(bare(), tpl("travel"), "00000000-0000-4000-8000-0000000000e1");
    wh = addEventTemplate(wh, tpl("purchase"), "00000000-0000-4000-8000-0000000000e2");
    wh = addEventTemplate(wh, tpl("wedding"), "00000000-0000-4000-8000-0000000000e3");
    const rows = wh.request.input.household.periodicExpenses!;
    expect(rows.find((p) => p.id.endsWith("e1"))).toMatchObject({ label: "家族旅行", kind: "general", everyYears: 1, to: null, amount: { value: 300000, state: "estimated" } });
    expect(rows.find((p) => p.id.endsWith("e2"))).toMatchObject({ label: "リフォーム以外の大きな買い物", amount: { value: 500000, state: "estimated" } });
    expect(rows.find((p) => p.id.endsWith("e3"))).toMatchObject({ label: "結婚の費用", row: "cf.expense.lumpSum.wedding" });
    const f = (suffix: string) => allFields(events(wh)).find((x) => x.key.endsWith(suffix))!;
    expect(fieldStatus(f("e1/amount"), wh)).toMatchObject({ status: "estimated", basis: "よくある額の目安（家族旅行 年30万円。この世帯に合わせて直してください）" });
    expect(fieldStatus(f("e1/every"), wh)).toMatchObject({ status: "estimated", basis: "よくある間隔の目安（家族旅行 毎年。この世帯に合わせて直してください）" });
    expect(fieldStatus(f("e2/amount"), wh)).toMatchObject({ status: "estimated", basis: "よくある額の目安（リフォーム以外の大きな買い物 1回50万円。この世帯に合わせて直してください）" });
    // 1回の行には何年ごとの欄も仮の印も無い
    expect(allFields(events(wh)).some((x) => x.key.endsWith("e2/every"))).toBe(false);
    expect(Object.keys(wh.assumed).some((k) => k.endsWith("e2/every"))).toBe(false);
    expect(statusOf(wh, "e3/amount")).toBe("missing");
    // 足したひな形はボタンから消え、ほかのひな形は詳細に回る
    const acts = events(wh).sections[0]!.actions;
    expect(acts.some((a) => a.key === "ev/template/travel")).toBe(false);
    expect(acts.find((a) => a.key === "ev/template/reserve")?.level).toBe("detail");
    expect(() => preview(wh.request)).not.toThrow();
  });

  it("予備費は毎年、足したときの生活費の1か月分（写す。推定）", () => {
    const wh0 = bare();
    const monthly = Math.round(livingMonthlyNow(wh0) / 10000) * 10000;
    expect(monthly).toBeGreaterThan(0);
    const wh = addReserve(wh0, "00000000-0000-4000-8000-0000000000e4");
    const p = wh.request.input.household.periodicExpenses!.find((x) => x.id.endsWith("e4"))!;
    expect(p).toMatchObject({ label: "予備費", everyYears: 1, to: null, amount: { value: monthly, state: "estimated" } });
    expect((p.amount as { estimate?: { basis: string } }).estimate?.basis).toBe(`よくある額の目安（予備費 毎年、生活費の1か月分〔月${String(monthly / 10000)}万円〕。この世帯に合わせて直してください）`);
    expect(statusOf(wh, "e4/every")).toBe("estimated");
    // ボタンは名前だけで、何が入るかは「?」に書く
    const btn = events(wh0).sections[0]!.actions.find((a) => a.key === "ev/template/reserve")!;
    expect(btn.label).toBe("＋ 予備費");
    expect(btn.help).toContain("生活費の1か月分");
  });

  it("祝い金・一時の給付金のひな形は、名前だけ入れて額は未入力の警告", () => {
    const wh = addIncomeTemplate(bare(), "出産のお祝い", "00000000-0000-4000-8000-0000000000e5");
    const f = wh.request.input.household.incomeFlows!.find((x) => x.id.endsWith("e5"))!;
    expect(f).toMatchObject({ label: "出産のお祝い", kind: "celebration" });
    expect(statusOf(wh, "e5/amount")).toBe("missing");
  });
});

describe("入る⇄出るの付け替え・基本生活費へ移す・介護は出さない", () => {
  it("出るお金の行を入るお金にする（同じ名前・額・時期）、戻すと出るお金", () => {
    const wh0 = addEventTemplate(bare(), tpl("purchase"), "00000000-0000-4000-8000-0000000000e6");
    const p = wh0.request.input.household.periodicExpenses!.find((x) => x.id.endsWith("e6"))!;
    const wh = expenseToIncome(wh0, p.id, "00000000-0000-4000-8000-0000000000e7");
    expect(wh.request.input.household.periodicExpenses!.some((x) => x.id === p.id)).toBe(false);
    const f = wh.request.input.household.incomeFlows!.find((x) => x.id.endsWith("e7"))!;
    expect(f).toMatchObject({ label: p.label, kind: "other", from: p.from, to: p.to, everyYears: p.everyYears, amount: p.amount });
    expect(events(wh).sections[1]!.groups[0]!.actions.some((a) => a.key.endsWith("/toExpense"))).toBe(true);
    const back = incomeToExpense(wh, f.id, "00000000-0000-4000-8000-0000000000e8");
    expect(back.request.input.household.periodicExpenses!.find((x) => x.id.endsWith("e8"))).toMatchObject({ label: p.label, kind: "general", row: "cf.expense.lumpSum.other", amount: p.amount });
  });

  it("くり返す行は「基本生活費のカードへ移す」で基本生活費の行になる（自動では移さない）", () => {
    const wh0 = addEventTemplate(bare(), tpl("travel"), "00000000-0000-4000-8000-0000000000e9");
    const id = "00000000-0000-4000-8000-0000000000e9";
    const head = events(wh0).sections[0]!.groups.find((g) => g.key === `ev/${id}`)!;
    expect(head.actions.map((a) => a.key)).toEqual(expect.arrayContaining([`ev/${id}/toIncome`, `ev/${id}/toLiving`]));
    const wh = moveToLiving(wh0, id);
    expect(events(wh).sections[0]!.groups.some((g) => g.key === `ev/${id}`)).toBe(false);
    expect((itemStage(wh, "living") as StageDef).sections.flatMap((s) => s.groups).some((g) => g.key === `ev/${id}`)).toBe(true);
  });

  it("介護の費用はライフイベントの出るお金に出さない（介護・親のカード）", () => {
    const wh = open("parentCare");
    expect(events(wh).sections[0]!.groups.some((g) => g.key.startsWith("ro/ev/care"))).toBe(false);
  });
});

describe("この世帯の予定（ほかのカードを含む）", () => {
  it("お金の行・車の買い替え・教育の入学・年金の受け取り開始を年の順に読む。1回の出るお金が重なる年を拾う", () => {
    const wh0 = addCar(open("salariedCoupleTwoKids"));
    const car = wh0.request.input.household.cars![0]!;
    const year = Number(wh0.request.input.baseMonth.slice(0, 4)) + 3;
    const wh = addEventTemplate(wh0, { ...tpl("purchase"), label: "大きな買い物" });
    const at = (id: string) => wh.request.input.household.periodicExpenses!.find((p) => p.label === id)!;
    // 大きな買い物を車の買い替えと同じ年にする
    const shifted = { ...wh, request: structuredClone(wh.request) };
    const p = shifted.request.input.household.periodicExpenses!.find((x) => x.id === at("大きな買い物").id)!;
    p.from = structuredClone(car.purchase.first);
    p.to = structuredClone(car.purchase.first);
    const items = scheduleItems(shifted);
    expect(items.map((x) => x.year)).toEqual([...items.map((x) => x.year)].sort((a, b) => a - b));
    expect(items.some((x) => x.name.startsWith("車の買い替え") && x.year === year && x.card === "車")).toBe(true);
    expect(items.some((x) => x.name.includes("大学の入学") && x.card === "子ども・教育")).toBe(true);
    expect(items.some((x) => x.name.includes("年金の受け取り開始"))).toBe(true);
    expect(overlapYears(items).find((o) => o.year === year)?.names).toEqual(expect.arrayContaining(["大きな買い物", expect.stringMatching(/^車の買い替え/)]));
    const sec = events(shifted).sections.find((s) => s.key === "events/schedule")!;
    expect(sec.level).toBe("detail");
    expect(sec.groups[0]!.note).toContain(`${year}年（`);
    expect(sec.groups[0]!.fields.every((f) => f.readOnly !== undefined)).toBe(true);
  });
});
