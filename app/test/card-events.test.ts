// ライフイベントのカードの中身（0068）: ひな形（10。まとまりごとの小さなボタン、足した後も出す・「入れた（…）」）・予備費・子の成人式（ライフイベントに残す）・
// 子の結婚の援助（子ども・教育の子への援助を使う）・親の葬儀（聞かずに平均余命で推定）・法事・祝い金の時期・入る⇄出るの付け替え・基本生活費へ移す・
// 種類と表の行と毎月は選ばない・介護はここに出さない・この世帯の予定（ほかのカードを含む。重なる年）
import { describe, expect, it } from "vitest";
import type { Member, PeriodicExpense } from "../src/engine/types.ts";
import { allFields, type ActionDef, type FieldDef, type GroupDef, type StageDef } from "../src/workspace/input/form.ts";
import { fromRequest, mutate, type WorkingHousehold } from "../src/workspace/input/household.ts";
import { itemStage } from "../src/workspace/input/items.ts";
import { expenseCard, INCOME_KINDS, OUT_KINDS } from "../src/workspace/input/moneyRows.ts";
import { overlapYears, scheduleItems } from "../src/workspace/input/schedule.ts";
import { addCar } from "../src/workspace/input/stages/cars.ts";
import {
  addEventTemplate,
  addIncomeTemplate,
  addOtherExpense,
  addOutTemplate,
  addReserve,
  childOfPeriodic,
  expenseToIncome,
  incomeToExpense,
  livingMonthlyNow,
  moveToLiving,
  OUT_TEMPLATES,
  templateGroupOrder,
} from "../src/workspace/input/stages/events.ts";
import { buildStage } from "../src/workspace/input/stages/index.ts";
import { resolveTimepoint } from "../src/workspace/timepoint.ts";
import { fieldStatus } from "../src/workspace/input/valueState.ts";
import { modelHousehold, preview } from "./helpers.ts";

const open = (id: string): WorkingHousehold => fromRequest(modelHousehold(id));
const events = (wh: WorkingHousehold) => buildStage("events", wh);
const tpl = (key: string) => OUT_TEMPLATES.find((t) => t.key === key)!;
const statusOf = (wh: WorkingHousehold, suffix: string) => fieldStatus(allFields(events(wh)).find((f) => f.key.endsWith(suffix))!, wh).status;
const seq = (p = "e") => {
  let n = 0;
  return () => `00000000-0000-4000-8000-${p.padEnd(4, "0")}${String(++n).padStart(8, "0")}`;
};
/** 行の無い世帯（ライフイベントの行を外す） */
const bare = (id = "salariedCoupleTwoKids"): WorkingHousehold => {
  const wh = open(id);
  const h = wh.request.input.household;
  return { ...wh, request: { ...wh.request, input: { ...wh.request.input, household: { ...h, periodicExpenses: (h.periodicExpenses ?? []).filter((p) => expenseCard(h, p) !== "events"), incomeFlows: [] } } } };
};
const outSection = (wh: WorkingHousehold) => events(wh).sections.find((s) => s.key === "ev/periodic")!;
const chips = (wh: WorkingHousehold): GroupDef => outSection(wh).groups.find((g) => g.key === "ev/templates")!;
const chip = (wh: WorkingHousehold, key: string): ActionDef => chips(wh).actions.find((a) => a.key === `ev/template/${key}`)!;
const rowsOf = (wh: WorkingHousehold) => wh.request.input.household.periodicExpenses ?? [];
const ym = (wh: WorkingHousehold, p: { from: PeriodicExpense["from"] }) => resolveTimepoint(wh.request.input.household, p.from);
const groupOf = (wh: WorkingHousehold, id: string) => outSection(wh).groups.find((g) => g.key === `ev/${id}`)!;
const fieldIn = (g: GroupDef, suffix: string): FieldDef | undefined => g.fields.find((f) => f.key.endsWith(suffix));
const optionValues = (f: FieldDef | undefined) => (f !== undefined && f.kind === "select" ? f.options.map((o) => o.value) : []);

describe("ライフイベントのひな形（小さなボタン。標準と詳細、行を足した後も出す）", () => {
  it("10のひな形を、まとまりごと（家族の節目・親・お墓・楽しみ・学び・備え）に標準で出す。上の1行で、当てはまるものだけと案内する", () => {
    const wh = bare("parentCare");
    const s = events(wh);
    expect(s.sections.map((x) => x.key)).toEqual(["ev/periodic", "money/events/in", "events/schedule"]);
    const g = chips(wh);
    expect(g.chips).toBe(true);
    expect(g.level).toBe("simple");
    expect(g.title).toBe("よくあるライフイベント（当てはまるものだけ足してください）");
    expect(g.actions.every((a) => a.level === "simple" && a.chip !== undefined)).toBe(true);
    expect(g.actions.map((a) => [a.chip!.group, a.label])).toEqual([
      ["家族の節目", "＋ 結婚の費用"],
      ["家族の節目", "＋ 子の成人式（振袖・スーツ・写真）"],
      ["家族の節目", "＋ 子の結婚の援助"],
      ["親・お墓", "＋ 親の葬儀（世帯が払う分）"],
      ["親・お墓", "＋ 法事"],
      ["親・お墓", "＋ お墓・仏壇"],
      ["楽しみ・学び", "＋ 特別な旅行"],
      ["楽しみ・学び", "＋ 大きな買い物（趣味の道具など）"],
      ["楽しみ・学び", "＋ 資格・学び直し"],
      ["備え", "＋ 予備費"],
    ]);
    // 外したひな形（家族旅行・長寿のお祝い）と、置かないひな形（孫の誕生のお祝い）
    expect(OUT_TEMPLATES.some((t) => /家族旅行|長寿|孫/u.test(t.label))).toBe(false);
    // 区画のボタンは「＋ ほかの支出を足す」の1つ（1回・何年ごと・その他のボタンはやめた）
    expect(outSection(wh).actions.map((a) => [a.key, a.label, a.level])).toEqual([["ev/addOther", "＋ ほかの支出を足す", "simple"]]);
    // 区画の説明: ふだんの旅行・帰省は基本生活費、ほかの物はそれぞれの入力項目
    expect(outSection(wh).note).toContain("ふだんの旅行・帰省は基本生活費に入れます。ここには特別な旅行を入れます");
    expect(outSection(wh).note).toContain("住まい・車・教育・介護・贈与はそれぞれの入力項目");
    // 入るお金のひな形も小さなボタン
    const inn = s.sections[1]!.groups.find((x) => x.key === "in/templates")!;
    expect(inn.chips).toBe(true);
    expect(inn.actions.map((a) => a.key)).toEqual(["in/template/weddingGift", "in/template/birthGift", "in/template/benefit"]);
    expect(inn.actions.find((a) => a.key === "in/template/birthGift")!.help).toContain("出産育児一時金は自動で計算します");
  });

  it("足したひな形は「入れた（年・額）」をボタンの横に出し、押せるまま（もう一度押すと、もう1行）", () => {
    const wh = addOutTemplate(bare(), "purchase", seq());
    const p = rowsOf(wh).at(-1)!;
    const year = Number(ym(wh, p)!.slice(0, 4));
    const c = chip(wh, "purchase");
    expect(c.chip!.added).toBe(`入れた（${year}年・50万円）`);
    expect(c.chip!.disabled).toBeUndefined();
    const again = c.run(wh);
    expect(rowsOf(again).filter((x) => x.label === "大きな買い物")).toHaveLength(2);
    expect(chip(again, "purchase").chip!.added).toBe(`入れた（${year}年・50万円、${year}年・50万円）`);
    // 行を足した後も、ほかのひな形は標準に残る
    expect(chip(again, "study").level).toBe("simple");
    // 額の無いひな形は「額は未入力」
    const trip = addOutTemplate(bare(), "specialTrip", seq());
    expect(chip(trip, "specialTrip").chip!.added).toMatch(/^入れた（\d{4}年・額は未入力）$/u);
  });

  it("額は推定（根拠はよくある目安）、額の無いひな形は未入力の警告。表の行はどれも一時的支出、優先度はひな形どおり（できればの物）", () => {
    let wh = bare();
    const ids = seq();
    for (const k of ["wedding", "purchase", "study", "specialTrip", "grave"]) wh = addOutTemplate(wh, k, ids);
    const byLabel = (l: string) => rowsOf(wh).find((p) => p.label === l)!;
    expect(byLabel("大きな買い物")).toMatchObject({ kind: "general", row: "cf.expense.lumpSum.other", everyYears: 1, priority: "want", amount: { value: 500000, state: "estimated" } });
    expect(byLabel("資格・学び直し")).toMatchObject({ priority: "want", amount: { value: 300000, state: "estimated" } });
    expect(byLabel("結婚の費用")).toMatchObject({ row: "cf.expense.lumpSum.other" });
    expect(byLabel("結婚の費用").priority).toBeUndefined();
    expect(byLabel("特別な旅行")).toMatchObject({ priority: "want" });
    for (const p of rowsOf(wh).filter((x) => expenseCard(wh.request.input.household, x) === "events")) expect(p.to).toEqual(p.from);
    const f = (id: string, suffix: string) => allFields(events(wh)).find((x) => x.key === `ev/${id}/${suffix}`)!;
    expect(fieldStatus(f(byLabel("大きな買い物").id, "amount"), wh)).toMatchObject({ status: "estimated", basis: "よくある額の目安（大きな買い物（趣味の道具など） 1回50万円。この世帯に合わせて直してください）" });
    for (const l of ["結婚の費用", "特別な旅行", "お墓・仏壇"]) expect(statusOf(wh, `${byLabel(l).id}/amount`)).toBe("missing");
    // 1回の行には何年ごとの欄も仮の印も無い
    expect(Object.keys(wh.assumed).some((k) => k.endsWith("/every"))).toBe(false);
    // 「?」の説明
    expect(tpl("grave").help).toContain("0〜300万円");
    expect(tpl("specialTrip").help).toContain("海外なら80万円・国内なら30万円");
    expect(() => preview(wh.request)).not.toThrow();
  });

  it("結婚の費用と結婚のお祝いの時期は、配偶者が家族に加わる時期（いなければ1年後）。出産のお祝いは生まれる予定の子が加わる月", () => {
    const wh0 = mutate(bare("single45"), (h) => {
      h.members.push({ id: "00000000-0000-4000-8000-0000000005f1", kind: "spouse", birth: { birthYearMonth: "1985-04", bornOnFirst: false }, sex: "female", joins: { at: "2028-06" }, leaves: null } as Member);
      h.members.push({ id: "00000000-0000-4000-8000-0000000005f2", kind: "child", birth: { birthYearMonth: "2029-09", bornOnFirst: false }, sex: "male", joins: { at: "2029-09" }, leaves: null, expected: true } as Member);
    });
    const wh = addOutTemplate(wh0, "wedding", seq());
    expect(rowsOf(wh).at(-1)).toMatchObject({ label: "結婚の費用", from: { at: "2028-06" }, to: { at: "2028-06" } });
    const gift = addIncomeTemplate(wh0, "結婚のお祝い", "00000000-0000-4000-8000-0000000000a1");
    expect(gift.request.input.household.incomeFlows!.at(-1)).toMatchObject({ label: "結婚のお祝い", kind: "celebration", from: { at: "2028-06" }, to: { at: "2028-06" } });
    const birth = addIncomeTemplate(wh0, "出産のお祝い", "00000000-0000-4000-8000-0000000000a2");
    expect(birth.request.input.household.incomeFlows!.at(-1)).toMatchObject({ from: { at: "2029-09" } });
    // 配偶者がもう家族なら1年後
    const later = addOutTemplate(bare(), "wedding", seq());
    expect(rowsOf(later).at(-1)!.from).toEqual({ at: "2027-10" });
    // 入るお金のひな形も、行を足した後に出し続け、「入れた」を出す
    const inn = events(gift).sections[1]!.groups.find((x) => x.key === "in/templates")!;
    expect(inn.actions.find((a) => a.key === "in/template/weddingGift")!.chip!.added).toBe("入れた（2028年・額は未入力）");
  });

  it("予備費は毎年、足したときの生活費の1か月分（写す。推定）", () => {
    const wh0 = bare();
    const monthly = Math.round(livingMonthlyNow(wh0) / 10000) * 10000;
    expect(monthly).toBeGreaterThan(0);
    const wh = addReserve(wh0, "00000000-0000-4000-8000-0000000000e4");
    const p = rowsOf(wh).find((x) => x.id.endsWith("e4"))!;
    expect(p).toMatchObject({ label: "予備費", everyYears: 1, to: null, row: "cf.expense.lumpSum.other", amount: { value: monthly, state: "estimated" } });
    expect((p.amount as { estimate?: { basis: string } }).estimate?.basis).toBe(`よくある額の目安（予備費 毎年、生活費の1か月分〔月${String(monthly / 10000)}万円〕。この世帯に合わせて直してください）`);
    expect(statusOf(wh, "e4/every")).toBe("estimated");
    const btn = chip(wh0, "reserve");
    expect(btn.label).toBe("＋ 予備費");
    expect(btn.help).toContain("生活費の1か月分");
  });

  it("当てはまる人のいないまとまり（親のいない世帯の親・お墓、子がいなくて結婚もしない世帯の家族の節目）は後ろに回す（隠さない）", () => {
    const h = (id: string) => bare(id).request.input.household;
    expect(templateGroupOrder(h("salariedCoupleTwoKids"))).toEqual(["family", "fun", "reserve", "parents"]);
    expect(templateGroupOrder(h("parentCare"))).toEqual(["family", "parents", "fun", "reserve"]);
    expect(templateGroupOrder(h("dualNoKids"))).toEqual(["fun", "reserve", "family", "parents"]);
    expect(chips(bare("dualNoKids")).actions).toHaveLength(10);
  });
});

describe("人ごとのひな形", () => {
  it("子の成人式: 20歳前の子ごとに20歳の時期で1行（1人15万円）。子の年齢で始まってもライフイベントに残す（子ども・教育に移さない）", () => {
    const wh = addOutTemplate(bare(), "comingOfAge", seq());
    const h = wh.request.input.household;
    const kids = h.members.filter((m) => m.kind === "child").sort((a, b) => a.birth.birthYearMonth.localeCompare(b.birth.birthYearMonth));
    const rows = rowsOf(wh).filter((p) => /成人式/u.test(p.label ?? ""));
    expect(rows.map((p) => p.from)).toEqual(kids.map((k) => ({ memberAge: { member: k.id, years: 20 } })));
    expect(rows[0]).toMatchObject({ label: "第1子の成人式", kind: "general", amount: { value: 150000, state: "estimated" } });
    for (const p of rows) {
      expect(childOfPeriodic(h, p)).toBeNull();
      expect(outSection(wh).groups.some((g) => g.key === `ev/${p.id}`)).toBe(true);
      expect((itemStage(wh, "education") as StageDef).sections.flatMap((s) => s.groups).some((g) => g.key === `ev/${p.id}`)).toBe(false);
    }
    // もう一度押すと、行の無い子だけに足す（どの子にもあれば全員に）
    expect(rowsOf(addOutTemplate(wh, "comingOfAge", seq("f"))).filter((p) => /成人式/u.test(p.label ?? ""))).toHaveLength(4);
    // 時期を式の月（年月）に直した子も、名前でその子の行と見る（生まれる予定の子を足してもう一度押すと、その子にだけ足す）
    const first = rows[0]!;
    const retimed = groupOf(wh, first.id).fields.find((f) => f.key === `ev/${first.id}/from`)!.time!.setWhen(wh, { at: "2033-01" }, "auto");
    const baby: Member = { id: "00000000-0000-4000-8000-0000000000b1", kind: "child", sex: "female", birth: { birthYearMonth: "2027-06", bornOnFirst: false }, joins: null, leaves: null, expected: true };
    const more = addOutTemplate(mutate(retimed, (hh) => void hh.members.push(baby)), "comingOfAge", seq("g"));
    const again = rowsOf(more).filter((p) => /成人式/u.test(p.label ?? ""));
    expect(again).toHaveLength(3);
    expect(again.filter((p) => p.label === "第1子の成人式").map((p) => p.from)).toEqual([{ at: "2033-01" }]);
    expect(again.at(-1)!.from).toEqual({ memberAge: { member: baby.id, years: 20 } });
    // 種類の無い古い行で子の年齢で始まる物（前の留学など）は、今までどおり子ども・教育
    const legacy = { ...rows[0]!, kind: undefined } as unknown as PeriodicExpense;
    expect(childOfPeriodic(h, legacy)).toBe(kids[0]!.id);
    // 子のいない世帯では押せない
    expect(chip(bare("dualNoKids"), "comingOfAge").chip).toMatchObject({ disabled: true, added: "（20歳前の子がいません）" });
  });

  it("子の結婚の援助: 子ども・教育の「子への援助（結婚資金）」に、30歳の時期で1人100万円（ライフイベントの行にはしない。ここには読むだけの行）", () => {
    const wh = addOutTemplate(bare(), "childWedding", seq());
    const h = wh.request.input.household;
    const gifts = (h.goals ?? []).flatMap((g) => (g.education?.gifts ?? []).map((x) => ({ owner: g.owner, ...x })));
    const kids = h.members.filter((m) => m.kind === "child");
    expect(gifts.map((g) => [g.owner, g.purpose, g.amount, g.at])).toEqual(expect.arrayContaining(kids.map((k) => [k.id, "wedding", 1000000, { memberAge: { member: k.id, years: 30 } }])));
    expect(gifts).toHaveLength(kids.length);
    expect(gifts.every((g) => g.donor === undefined)).toBe(true);
    expect(rowsOf(wh).some((p) => /結婚の援助/u.test(p.label ?? ""))).toBe(false);
    const ro = outSection(wh).groups.find((g) => g.key === "ro/events/childWedding")!;
    expect(ro.title).toBe("子への援助（結婚資金）");
    expect(ro.fields.map((f) => f.label).sort()).toEqual(["第1子の結婚の援助", "第2子の結婚の援助"]);
    expect(ro.fields.every((f) => f.readOnly === "この欄はここでは変えられません。「子ども・教育」の項目で入れます")).toBe(true);
    expect(chip(wh, "childWedding").chip!.added).toMatch(/^入れた（\d{4}年・100万円、\d{4}年・100万円）$/u);
    // 結果では結婚の費用の行に、子ごとに1回ずつ入る（子ども・教育の子への援助と同じ物。二重に数えない）
    const r = preview(wh.request);
    const before = preview(bare().request);
    const wed = (x: typeof r) => x.table.filter((c) => c.row === "cf.expense.lumpSum.wedding").reduce((s, c) => s + c.amount, 0);
    expect(wed(r) - wed(before)).toBeGreaterThan(0);
    // 教育の目標の無い、これからの学校がある子には足さない（進路を先に入れる）
    const noGoal = mutate(bare(), (hh) => void (hh.goals = []));
    expect(chip(noGoal, "childWedding").chip).toMatchObject({ disabled: true, added: "（先に子ども・教育で進路を入れてください）" });
  });

  it("親の葬儀: 聞かずに、親の年齢と性別の平均余命で時期を推定（仮の印）。亡くなる見込みがあればその時期。親がいなければ本人の年齢から", () => {
    const wh = addOutTemplate(bare("parentCare"), "funeral", seq());
    const h = wh.request.input.household;
    const parent = h.members.find((m) => m.kind === "parent")!;
    const p = rowsOf(wh).at(-1)!;
    expect(p).toMatchObject({ label: "母の葬儀", row: "cf.expense.lumpSum.other", amount: { value: 1200000, state: "estimated" } });
    expect(p.from.memberAge?.member).toBe(parent.id);
    const st = fieldStatus(allFields(events(wh)).find((f) => f.key === `ev/${p.id}/from`)!, wh);
    expect(st.status).toBe("estimated");
    expect(st.basis).toMatch(/^推定（母の年齢と性別から、厚生労働省「簡易生命表」の\d+歳の平均余命（女）/u);
    // 時期を直すと仮の印が外れる
    const timing = groupOf(wh, p.id).fields.find((f) => f.key === `ev/${p.id}/from`)!;
    const moved = timing.time!.setWhen(wh, { at: "2035-04" }, "auto");
    expect(moved.assumed[`ev/${p.id}/from`]).toBeUndefined();
    // 亡くなる見込みが入っていれば、その時期
    const withLeaves = mutate(bare("parentCare"), (hh) => void (hh.members.find((m) => m.kind === "parent")!.leaves = { at: "2031-03" }));
    expect(rowsOf(addOutTemplate(withLeaves, "funeral", seq())).at(-1)!.from).toEqual({ at: "2031-03" });
    // 親がいなければ、本人より30歳上の親とみて、その年齢の平均余命（男女の平均）から本人の年齢で置く
    const none = addOutTemplate(bare(), "funeral", seq());
    const q = rowsOf(none).at(-1)!;
    const self = none.request.input.household.members.find((m) => m.kind === "self")!;
    expect(q.label).toBe("親の葬儀");
    expect(q.from.memberAge?.member).toBe(self.id);
    expect(none.assumed[`ev/${q.id}/from`]).toMatch(/^推定（親の年齢を本人より30歳上とみて、厚生労働省「簡易生命表」の\d+歳の平均余命（男女の平均）/u);
    // 香典は入るお金。葬儀の費用の相続税の扱いは相続・贈与
    expect(tpl("funeral").help).toContain("香典は入るお金で入れられます");
    expect(tpl("funeral").help).toContain("相続・贈与の入力項目");
  });

  it("法事は葬儀の行の1年後（一周忌。年齢で持つ時期は年齢を1つ足す）、葬儀の行が無ければ1年後", () => {
    const w1 = addOutTemplate(bare("parentCare"), "funeral", seq());
    const funeral = rowsOf(w1).at(-1)!;
    const w2 = addOutTemplate(w1, "memorial", seq("f"));
    const m = rowsOf(w2).at(-1)!;
    expect(m).toMatchObject({ label: "法事", amount: { value: 200000 } });
    expect(m.from).toEqual({ memberAge: { ...funeral.from.memberAge!, years: funeral.from.memberAge!.years + 1 } });
    expect(w2.assumed[`ev/${m.id}/from`]).toBe("推定（母の葬儀の1年後〔一周忌〕）");
    const alone = addOutTemplate(bare("parentCare"), "memorial", seq());
    expect(rowsOf(alone).at(-1)!.from).toEqual({ at: "2027-10" });
  });
});

describe("ライフイベントの行の欄", () => {
  it("種類と表の行は選ばない（表の行は一時的支出）。時期は1回・年ごと（毎月は出さない）。優先度は標準", () => {
    const wh = addOtherExpense(bare(), "00000000-0000-4000-8000-0000000000b1");
    const p = rowsOf(wh).at(-1)!;
    expect(p).toMatchObject({ kind: "general", row: "cf.expense.lumpSum.other", amount: { value: 500000, state: "estimated" } });
    expect(p.label).toBeUndefined();
    const g = groupOf(wh, p.id);
    expect(g.title).toContain("一時的支出");
    expect(fieldIn(g, "/kind")).toBeUndefined();
    expect(allFields(events(wh)).some((f) => f.key === `ev/${p.id}/row`)).toBe(false);
    expect(optionValues(fieldIn(g, "/cadence"))).toEqual(["once", "repeat"]);
    expect(fieldIn(g, "/priority")!.level).toBe("simple");
    // 種類の名前は「ライフイベントの支出」（その他の支出は読めるが、ボタンでは足さない）
    expect(OUT_KINDS.find((k) => k.kind === "general")!.label).toBe("ライフイベントの支出");
  });

  it("名前の無い行は時期で呼ぶ（一時的支出・毎年の支出・3年ごとの支出）。前に毎月で入れた行は毎月のまま見せ、基本生活費へ案内する。前に選んだ別の表の行は読むだけ", () => {
    const id = "00000000-0000-4000-8000-0000000000b2";
    const w = (fn: (p: PeriodicExpense) => void) =>
      mutate(addOtherExpense(bare(), id), (h) => {
        fn((h.periodicExpenses ?? []).find((x) => x.id === id)!);
      });
    expect(groupOf(w((p) => ((p.to = null), (p.everyYears = 1))), id).title).toContain("毎年の支出");
    expect(groupOf(w((p) => ((p.to = null), (p.everyYears = 3))), id).title).toContain("3年ごとの支出");
    const monthly = w((p) => ((p.to = null), (p.monthly = true)));
    const g = groupOf(monthly, id);
    expect(g.title).toContain("毎月の支出");
    expect(g.note).toContain("毎月の支出は基本生活費の入力項目で入れます");
    expect(optionValues(fieldIn(g, "/cadence"))).toEqual(["once", "monthly", "repeat"]);
    const legacy = w((p) => void (p.row = "cf.expense.lumpSum.wedding"));
    const ro = groupOf(legacy, id).fields.find((f) => f.key === `ro/ev/${id}/row`)!;
    expect(ro.readOnly).toContain("前に選んだ行のまま計算します");
    expect(ro.get(legacy).value).toBe("結婚の費用");
  });
});

describe("入る⇄出るの付け替え・基本生活費へ移す・介護は出さない", () => {
  it("出るお金の行を入るお金にする（同じ名前・額・時期）、戻すと出るお金（表の行は1回でもくり返しでも一時的支出）", () => {
    const wh0 = addEventTemplate(bare(), tpl("purchase"), "00000000-0000-4000-8000-0000000000e6");
    const p = rowsOf(wh0).find((x) => x.id.endsWith("e6"))!;
    const wh = expenseToIncome(wh0, p.id, "00000000-0000-4000-8000-0000000000e7");
    expect(rowsOf(wh).some((x) => x.id === p.id)).toBe(false);
    const f = wh.request.input.household.incomeFlows!.find((x) => x.id.endsWith("e7"))!;
    expect(f).toMatchObject({ label: p.label, kind: "other", from: p.from, to: p.to, everyYears: p.everyYears, amount: p.amount });
    expect(events(wh).sections[1]!.groups[0]!.actions.some((a) => a.key.endsWith("/toExpense"))).toBe(true);
    const back = incomeToExpense(wh, f.id, "00000000-0000-4000-8000-0000000000e8");
    expect(rowsOf(back).find((x) => x.id.endsWith("e8"))).toMatchObject({ label: p.label, kind: "general", row: "cf.expense.lumpSum.other", amount: p.amount });
    const repeat = mutate(wh, (h) => void Object.assign(h.incomeFlows!.find((x) => x.id === f.id)!, { to: null, everyYears: 2 }));
    expect(rowsOf(incomeToExpense(repeat, f.id, "00000000-0000-4000-8000-0000000000e9")).at(-1)).toMatchObject({ row: "cf.expense.lumpSum.other", everyYears: 2 });
  });

  it("くり返す行は「基本生活費の項目へ移す」で基本生活費の行になる（表の行は基本生活費に含める。自動では移さない）", () => {
    const id = "00000000-0000-4000-8000-0000000000e9";
    const wh0 = addReserve(bare(), id);
    const head = groupOf(wh0, id);
    expect(head.actions.map((a) => a.key)).toEqual(expect.arrayContaining([`ev/${id}/toIncome`, `ev/${id}/toLiving`]));
    const wh = moveToLiving(wh0, id);
    expect(rowsOf(wh).find((p) => p.id === id)).toMatchObject({ kind: "livingAnnual", row: "cf.expense.living" });
    expect(outSection(wh).groups.some((g) => g.key === `ev/${id}`)).toBe(false);
    expect((itemStage(wh, "living") as StageDef).sections.flatMap((s) => s.groups).some((g) => g.key === `ev/${id}`)).toBe(true);
    // 基本生活費の年払いで選べる行（医療・介護など）はそのまま
    const med = moveToLiving(mutate(wh0, (h) => void (h.periodicExpenses!.find((p) => p.id === id)!.row = "cf.expense.care.medical")), id);
    expect(rowsOf(med).find((p) => p.id === id)!.row).toBe("cf.expense.care.medical");
  });

  it("介護の費用はライフイベントの出るお金に出さない（介護・親のカード）", () => {
    const wh = open("parentCare");
    expect(events(wh).sections[0]!.groups.some((g) => g.key.startsWith("ro/ev/care"))).toBe(false);
  });
});

describe("入るお金の種類の説明", () => {
  it("動産の売却（車以外）と一時所得の「?」", () => {
    const goods = INCOME_KINDS.find((k) => k.kind === "saleGoods")!;
    expect(goods.label).toBe("動産の売却（車以外）");
    expect(goods.help).toContain("実家じまい・遺品整理での家財や骨董品");
    expect(goods.help).toContain("1個30万円を超える貴金属・美術品などは税がかかることがあります（課税の扱いを選び直してください）");
    expect(goods.help).not.toMatch(/フリマ/u);
    expect(INCOME_KINDS.find((k) => k.kind === "temporary")!.help).toBe("懸賞の賞金・競馬の払戻し・法人からもらうお金など。生命保険の満期・解約は保険の項目で計算します");
  });
});

describe("この世帯の予定（ほかのカードを含む）", () => {
  it("お金の行・車の買い替え・教育の入学・年金の受け取り開始を年の順に読む。1回の出るお金が重なる年を拾う", () => {
    const wh0 = addCar(open("salariedCoupleTwoKids"));
    const car = wh0.request.input.household.cars![0]!;
    const year = Number(wh0.request.input.baseMonth.slice(0, 4)) + 3;
    const wh = addEventTemplate(wh0, tpl("purchase"));
    const at = (id: string) => rowsOf(wh).find((p) => p.label === id)!;
    // 大きな買い物を車の買い替えと同じ年にする
    const shifted = { ...wh, request: structuredClone(wh.request) };
    const p = shifted.request.input.household.periodicExpenses!.find((x) => x.id === at("大きな買い物").id)!;
    p.from = structuredClone(car.purchase!.first);
    p.to = structuredClone(car.purchase!.first);
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
    expect(sec.groups[0]!.fields.some((f) => String(f.get(shifted).value).startsWith("出るお金：大きな買い物（"))).toBe(true);
  });
});
