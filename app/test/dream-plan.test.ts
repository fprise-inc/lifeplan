// 夢プラン（0103）: ライフイベントの入力項目のいちばん上の区画・夢のひな形（名前と時期だけ）・順位の上下・計算に入れる／入れない・
// ひとことメモ・古い「夢」（wish）の行を夢にする・結果の見方（理由「夢」・確実な分だけで外す）・夢を外した1回の計算と要約の1文・
// 目標の区画の夢のカード・子への援助の優先度
import { describe, expect, it } from "vitest";
import type { EngineRequest, PeriodicExpense } from "../src/engine/types.ts";
import { applyRowsView, certainOnly, forEngine, pickRow, viewCandidates, viewMode, withoutDreams } from "../src/engine/moneyRows.ts";
import { allFields, type GroupDef, type SectionDef } from "../src/workspace/input/form.ts";
import { fromRequest, mutate, type WorkingHousehold } from "../src/workspace/input/household.ts";
import { addDream, DREAM_TEMPLATES, dreamRows, moveDream, toDream } from "../src/workspace/input/dreams.ts";
import { expenseCard, periodicGroup } from "../src/workspace/input/moneyRows.ts";
import { scheduleItems } from "../src/workspace/input/schedule.ts";
import { addOutTemplate, eventExpenses } from "../src/workspace/input/stages/events.ts";
import { buildStage } from "../src/workspace/input/stages/index.ts";
import { fieldStatus } from "../src/workspace/input/valueState.ts";
import { viewRows } from "../src/workspace/rowsView.ts";
import { toPresentation } from "../src/workspace/present.ts";
import { addMonths } from "../src/workspace/levers.ts";
import { dreamSummary } from "../../report/src/dreams.ts";
import { modelHousehold, preview } from "./helpers.ts";

const seq = (p = "d"): (() => string) => {
  let n = 0;
  return () => `00000000-0000-4000-8000-${p.padEnd(4, "0")}${String(++n).padStart(8, "0")}`;
};
/** ライフイベントの行の無い世帯 */
const bare = (id = "salariedCoupleTwoKids"): WorkingHousehold => {
  const wh = fromRequest(modelHousehold(id));
  const h = wh.request.input.household;
  return { ...wh, request: { ...wh.request, input: { ...wh.request.input, household: { ...h, periodicExpenses: (h.periodicExpenses ?? []).filter((p) => expenseCard(h, p) !== "events"), incomeFlows: [] } } } };
};
const events = (wh: WorkingHousehold) => buildStage("events", wh);
const dreamSec = (wh: WorkingHousehold): SectionDef => events(wh).sections.find((s) => s.key === "ev/dreams")!;
const groupOf = (wh: WorkingHousehold, id: string): GroupDef => dreamSec(wh).groups.find((g) => g.key === `ev/${id}`)!;
const tpl = (key: string) => DREAM_TEMPLATES.find((t) => t.key === key)!;
const dreamsOf = (wh: WorkingHousehold) => dreamRows(wh.request.input.household);
const ids = ["00000000-0000-4000-8000-d00000000001", "00000000-0000-4000-8000-d00000000002", "00000000-0000-4000-8000-d00000000003"] as const;

/** 夢を3件足した世帯（旅行・憧れの車・学び直し・資格。額を入れる） */
function threeDreams(): WorkingHousehold {
  let wh = bare();
  wh = addDream(wh, tpl("trip"), ids[0]);
  wh = addDream(wh, tpl("car"), ids[1]);
  wh = addDream(wh, tpl("study"), ids[2]);
  return mutate(wh, (h) => {
    for (const [id, v] of [[ids[0], 1500000], [ids[1], 6000000], [ids[2], 400000]] as const) {
      const p = (h.periodicExpenses ?? []).find((x) => x.id === id)!;
      p.amount = { value: v, state: "confirmed", origin: { kind: "manual" } } as PeriodicExpense["amount"];
    }
  });
}

describe("夢プランの区画（ライフイベントの入力項目のいちばん上）", () => {
  it("区画「夢プラン」を出るお金より上に置く。説明に車・住まいの行き先、ひな形は8つ（ほかの「＋」のボタンと同じ大きさ・左の見出しなし）", () => {
    const wh = bare();
    const s = events(wh);
    expect(s.sections.map((x) => x.key)).toEqual(["ev/dreams", "ev/periodic", "money/events/in", "events/schedule"]);
    const d = dreamSec(wh);
    expect(d.title).toBe("夢プラン");
    expect(d.note).toContain("車・住まいそのものを夢にするときも、ここでは額と時期で入れます");
    expect(d.note).not.toContain("維持費・ローン");
    const chips = d.groups.find((g) => g.key === "ev/dreamTemplates")!;
    expect(chips.chips).toBe(true);
    expect(chips.chipsFull).toBe(true);
    expect(chips.title).toBe("こんな夢はありませんか");
    expect(chips.actions.every((a) => a.chip?.group === "")).toBe(true);
    expect(chips.actions.map((a) => a.label)).toEqual(["＋ 特別な旅行", "＋ 趣味を始める", "＋ 学び直し・資格", "＋ 憧れの車", "＋ 二拠点や別荘", "＋ 移住", "＋ 起業", "＋ 家族の記念"]);
    // ライフイベントの「楽しみ・学び」から移したひな形も、額は入れない（目安は「?」に書く）
    expect(tpl("trip").help).toContain("海外なら80万円・国内なら30万円ほどが目安");
    expect(tpl("trip").help).toContain("海外の旅行・記念の旅行など");
    expect(tpl("hobby").help).toContain("1回50万円ほどが目安");
    expect(tpl("study").help).toContain("1回30万円ほどが目安");
    expect([tpl("hobby").years, tpl("study").years, tpl("trip").age]).toEqual([1, 1, 65]);
    expect(d.actions.map((a) => a.label)).toEqual(["＋ 夢を足す"]);
  });

  it("ひな形は名前と時期だけ（額は未入力の警告）。時期はご本人の年齢か今から○年後で、仮の印。順位はいちばん下", () => {
    const wh = threeDreams();
    const self = wh.request.input.household.members.find((m) => m.kind === "self")!;
    const [trip, car, study] = dreamsOf(wh);
    expect([trip!.label, car!.label, study!.label]).toEqual(["特別な旅行", "憧れの車", "学び直し・資格"]);
    expect(trip!.from).toEqual({ memberAge: { member: self.id, years: 65 } });
    expect(car!.from).toEqual({ at: addMonths(wh.request.input.baseMonth, 36) });
    expect([trip, car, study].map((p) => [p!.kind, p!.row, p!.everyYears, p!.dream?.rank])).toEqual([
      ["dream", "cf.expense.lumpSum.other", 1, 1],
      ["dream", "cf.expense.lumpSum.other", 1, 2],
      ["dream", "cf.expense.lumpSum.other", 1, 3],
    ]);
    expect(wh.assumed[`ev/${ids[0]}/from`]).toBe("ひな形の仮の時期（ご本人65歳。この世帯に合わせて直してください）");
    expect(wh.assumed[`ev/${ids[1]}/from`]).toBe("ひな形の仮の時期（今から3年後。この世帯に合わせて直してください）");
    // 額は未入力（0円で計算中）の警告
    const fresh = addDream(bare(), tpl("move"), ids[0]);
    const amount = allFields(events(fresh)).find((f) => f.key === `ev/${ids[0]}/amount`)!;
    expect(fieldStatus(amount, fresh).status).toBe("missing");
    expect(dreamsOf(fresh)[0]!.amount.value).toBe(0);
    expect(groupOf(fresh, ids[0]).title).toMatch(/^夢1｜移住 額は未入力 \d{4}年\d+月$/u);
  });

  it("1件を1つの枠（まとまり1つ）。欄は名前・時期（1回／年ごと）・額・時期・ひとことメモ・計算に入れる。優先度・種類・表の行の欄は無い", () => {
    const wh = threeDreams();
    const g = groupOf(wh, ids[1]);
    expect(dreamSec(wh).groups.filter((x) => x.key.startsWith(`ev/${ids[1]}`))).toHaveLength(1);
    expect(g.fields.map((f) => f.label)).toEqual(["名前", "時期", "額", "時期", "ひとことメモ（なぜかなえたいか）", "計算に入れるか"]);
    const cadence = g.fields.find((f) => f.key.endsWith("/cadence"))!;
    expect(cadence.kind === "select" ? cadence.options.map((o) => o.value) : []).toEqual(["once", "repeat"]);
    expect(g.fields.some((f) => f.key.endsWith("/priority") || f.key.endsWith("/row") || f.key.endsWith("/kind"))).toBe(false);
    expect(g.title).toMatch(/^夢2｜憧れの車 600万円・1回 \d{4}年\d+月$/u);
    // 年ごとにすると、何年ごと・終わりの欄が出る
    const repeat = cadence.set(wh, "repeat");
    expect(groupOf(repeat, ids[1]).fields.map((f) => f.label)).toEqual(["名前", "時期", "年額", "初め", "何年ごと", "終わり", "ひとことメモ（なぜかなえたいか）", "計算に入れるか"]);
    // ひとことメモと計算に入れる
    const note = g.fields.find((f) => f.key.endsWith("/dreamNote"))!;
    const inc = g.fields.find((f) => f.key.endsWith("/dreamInclude"))!;
    // 選び方は「最初から計算に入れる」「最初から計算に入れない」の2つ（世帯ファイルは今までどおり真偽）
    expect(inc.kind === "select" ? inc.options.map((o) => o.label) : []).toEqual(["最初から計算に入れる", "最初から計算に入れない"]);
    expect(inc.get(wh).value).toBe("include");
    const w2 = inc.set(note.set(wh, "子どものころからの夢"), "exclude");
    expect(inc.get(w2).value).toBe("exclude");
    expect(dreamsOf(w2)[1]!.dream).toEqual({ rank: 2, note: "子どものころからの夢", include: false });
    expect(groupOf(w2, ids[1]).title).toMatch(/（最初から計算に入れない）$/u);
    // 入れるに戻すと、省略（入れる）に戻る
    expect(dreamsOf(inc.set(w2, "include"))[1]!.dream).toEqual({ rank: 2, note: "子どものころからの夢" });
  });

  it("順位は「↑ 上へ」「↓ 下へ」で動かす（いちばん上に上へ・いちばん下に下へは出さない）。順位は1から振り直す", () => {
    const wh = threeDreams();
    const acts = (id: string) => groupOf(wh, id).actions.map((a) => a.label);
    expect(acts(ids[0])).toEqual(["↓ 下へ", "外す"]);
    expect(acts(ids[1])).toEqual(["↑ 上へ", "↓ 下へ", "外す"]);
    expect(acts(ids[2])).toEqual(["↑ 上へ", "外す"]);
    const up = groupOf(wh, ids[2]).actions.find((a) => a.label === "↑ 上へ")!.run(wh);
    expect(dreamsOf(up).map((p) => [p.label, p.dream?.rank])).toEqual([
      ["特別な旅行", 1],
      ["学び直し・資格", 2],
      ["憧れの車", 3],
    ]);
    expect(moveDream(up, ids[0], -1)).toBe(up);
  });

  it("夢はふつうの出るお金の行に出さない（ライフイベントの行の数え方・ひな形の「入れた」に入れない）。この世帯の予定には★で出す", () => {
    const wh = threeDreams();
    expect(eventExpenses(wh.request.input.household)).toHaveLength(0);
    expect(events(wh).sections.find((s) => s.key === "ev/periodic")!.groups.some((g) => ids.some((id) => g.key === `ev/${id}`))).toBe(false);
    const names = scheduleItems(wh).map((x) => x.name);
    expect(names).toEqual(expect.arrayContaining(["★特別な旅行", "★憧れの車", "★学び直し・資格"]));
  });
});

describe("古い「夢」（wish）の行は「できれば」で見せ、「夢にする」で移す", () => {
  it("優先度 wish の行に「夢にする」。押すと種類が夢・優先度を外す・いちばん下の順位・表の行は一時的支出（名前・額・時期はそのまま）", () => {
    const base = addDream(bare(), tpl("hobby"), ids[0]);
    const old: PeriodicExpense = { id: ids[1], label: "クルーズ旅行", kind: "general", row: "cf.expense.lumpSum.wedding", from: { at: "2032-04" }, to: { at: "2032-04" }, everyYears: 1, amount: { value: 900000, state: "confirmed", origin: { kind: "manual" } } as PeriodicExpense["amount"], priority: "wish" };
    const wh = mutate(base, (h) => void (h.periodicExpenses ??= []).push(old));
    const g = periodicGroup(wh, old, "events");
    const pr = g.fields.find((f) => f.key.endsWith("/priority"))!;
    expect(pr.get(wh).value).toBe("want");
    const btn = g.actions.find((a) => a.label === "夢にする")!;
    const moved = btn.run(wh);
    const p = dreamsOf(moved).find((x) => x.id === ids[1])!;
    expect(p).toMatchObject({ kind: "dream", row: "cf.expense.lumpSum.other", label: "クルーズ旅行", from: { at: "2032-04" }, dream: { rank: 2 } });
    expect(p.priority).toBeUndefined();
    expect(p.amount.value).toBe(900000);
    // 「できれば」（want）・「必ず」の行には出さない
    const want = { ...old, priority: "want" as const };
    expect(periodicGroup(mutate(base, (h) => void h.periodicExpenses!.push(want)), want, "events").actions.some((a) => a.label === "夢にする")).toBe(false);
    expect(toDream(moved, ids[1])).toEqual(moved);
  });
});

describe("前にライフイベントの「楽しみ・学び」のひな形で足した行", () => {
  const box = (v: number) => ({ value: v, state: "confirmed", origin: { kind: "manual" } }) as PeriodicExpense["amount"];
  const row = (id: string, label: string, extra: Partial<PeriodicExpense> = {}): PeriodicExpense => ({ id, label, kind: "general", row: "cf.expense.lumpSum.other", from: { at: "2028-04" }, to: { at: "2028-04" }, everyYears: 1, amount: box(500000), priority: "want", ...extra });
  const dreamChip = (wh: WorkingHousehold, key: string) => dreamSec(wh).groups.find((g) => g.key === "ev/dreamTemplates")!.actions.find((a) => a.key === `ev/dream/template/${key}`)!;
  const old = [
    row(ids[0], "特別な旅行", { amount: box(800000) }),
    row(ids[1], "大きな買い物"),
    row(ids[2], "資格・学び直し", { amount: box(300000) }),
    // 前の「家族旅行」（毎年）は夢の旅行に数えない
    row("00000000-0000-4000-8000-d00000000009", "家族旅行", { to: null, amount: box(300000) }),
  ];
  const legacy = () => mutate(bare(), (h) => void (h.periodicExpenses ??= []).push(...structuredClone(old)));

  it("ふつうのライフイベントの行のまま（書き換えない）。夢のひな形の「入れた」に数える。行に「夢にする」", () => {
    const wh = legacy();
    expect(dreamsOf(wh)).toHaveLength(0);
    expect(eventExpenses(wh.request.input.household).map((p) => p.label)).toEqual(["特別な旅行", "大きな買い物", "資格・学び直し", "家族旅行"]);
    expect(dreamChip(wh, "trip").chip!.added).toBe("入れた（ライフイベントに1件）");
    expect(dreamChip(wh, "hobby").chip!.added).toBe("入れた（ライフイベントに1件）");
    expect(dreamChip(wh, "study").chip!.added).toBe("入れた（ライフイベントに1件）");
    expect(dreamChip(wh, "car").chip!.added).toBeUndefined();
    const out = events(wh).sections.find((s) => s.key === "ev/periodic")!;
    const acts = (id: string) => out.groups.find((g) => g.key === `ev/${id}`)!.actions.map((a) => a.label);
    for (const id of ids) expect(acts(id)).toContain("夢にする");
    expect(acts("00000000-0000-4000-8000-d00000000009")).not.toContain("夢にする");
    // 夢にすると夢の「入れた」の数に入り、ライフイベントの行から外れる
    const moved = out.groups.find((g) => g.key === `ev/${ids[0]}`)!.actions.find((a) => a.label === "夢にする")!.run(wh);
    expect(dreamsOf(moved).map((p) => [p.label, p.kind, p.amount.value])).toEqual([["特別な旅行", "dream", 800000]]);
    expect(dreamChip(moved, "trip").chip!.added).toBe("入れた（1件）");
    // 夢とライフイベントの行の両方
    const both = addDream(legacy(), tpl("hobby"), "00000000-0000-4000-8000-d0000000000a");
    expect(dreamChip(both, "hobby").chip!.added).toBe("入れた（2件。うちライフイベントに1件）");
    // 前のひな形の名前の夢も数える
    const prev = mutate(addDream(bare(), tpl("trip"), ids[0]), (h) => void (h.periodicExpenses!.find((p) => p.id === ids[0])!.label = "夫婦で海外旅行"));
    expect(dreamChip(prev, "trip").chip!.added).toBe("入れた（1件）");
    // 前にライフイベントで足した「特別な旅行」の行と、前の名前の夢を両方数える
    const mixed = mutate(prev, (h) => void h.periodicExpenses!.push(row(ids[1], "特別な旅行")));
    expect(dreamChip(mixed, "trip").chip!.added).toBe("入れた（2件。うちライフイベントに1件）");
  });
});

describe("計算と結果の見方", () => {
  const reqOf = (wh: WorkingHousehold): EngineRequest => wh.request;
  const lump = (r: ReturnType<typeof preview>, id: string) => r.table.filter((c) => c.object === id && c.row === "cf.expense.lumpSum.other").reduce((s, c) => s + c.amount, 0);

  it("入れる夢は一時的支出の行。「計算に入れない」夢は要求を作るときに外す（エンジンはふつうの行として計算する）", () => {
    const wh = mutate(threeDreams(), (h) => void (h.periodicExpenses!.find((p) => p.id === ids[1])!.dream!.include = false));
    const req = forEngine(reqOf(wh));
    expect((req.input.household.periodicExpenses ?? []).map((p) => p.id)).not.toContain(ids[1]);
    const r = preview(req);
    expect(lump(r, ids[0])).toBeGreaterThanOrEqual(1500000);
    expect(lump(r, ids[1])).toBe(0);
    expect(lump(r, ids[2])).toBeGreaterThanOrEqual(400000);
  });

  it("結果の見方: 夢は理由「夢」で並び、1件ずつ入れ外しできる。「確実な分だけ」は夢を外す。「計算に入れない」夢は、ここで入れて見られる", () => {
    const wh = mutate(threeDreams(), (h) => void (h.periodicExpenses!.find((p) => p.id === ids[1])!.dream!.include = false));
    const h = wh.request.input.household;
    const cs = viewCandidates(h).filter((c) => c.reason === "dream");
    expect(cs.map((c) => [c.id, c.off === true])).toEqual([
      [ids[0], false],
      [ids[1], true],
      [ids[2], false],
    ]);
    const rows = viewRows([h], viewMode(false));
    expect(rows.filter((r) => r.tag === "夢").map((r) => [r.name, r.excluded])).toEqual([
      ["特別な旅行", false],
      ["憧れの車", true],
      ["学び直し・資格", false],
    ]);
    // 確実な分だけ: 夢を全部外す
    const certain = certainOnly(reqOf(wh));
    expect((certain.input.household.periodicExpenses ?? []).some((p) => p.kind === "dream")).toBe(false);
    // 計算に入れない夢を入れて見る（要求の写しで include を true。世帯は変えない）
    const c1 = cs[1]!;
    const v = pickRow(viewMode(false), c1, true);
    const seen = forEngine(applyRowsView(reqOf(wh), v));
    expect((seen.input.household.periodicExpenses ?? []).find((p) => p.id === ids[1])?.dream?.include).toBe(true);
    expect(h.periodicExpenses!.find((p) => p.id === ids[1])!.dream!.include).toBe(false);
    // 入れている夢を1件だけ外す
    const off = applyRowsView(reqOf(wh), pickRow(viewMode(false), cs[0]!, false));
    expect((off.input.household.periodicExpenses ?? []).map((p) => p.id)).not.toContain(ids[0]);
  });

  it("夢を全部外した要求（要約の1回の計算）。計算に入る夢が無ければ同じ物", () => {
    const wh = threeDreams();
    const nd = withoutDreams(reqOf(wh));
    expect((nd.input.household.periodicExpenses ?? []).some((p) => p.kind === "dream")).toBe(false);
    const allOff = mutate(wh, (h) => h.periodicExpenses!.forEach((p) => (p.dream = { ...p.dream, include: false })));
    expect(withoutDreams(reqOf(allOff))).toBe(reqOf(allOff));
    const plain = reqOf(bare());
    expect(withoutDreams(plain)).toBe(plain);
  });

  it("要約の1文: 足りる・夢で不足・夢が無くても不足・一部を入れていない・どれも入れていない", () => {
    const base = { total: 3, included: 3, ageText: (y: number) => `${y - 1970}歳`, until: "100歳まで" };
    expect(dreamSummary({ ...base, withYear: null, withoutYear: null })).toBe("夢をすべて入れても100歳まで足ります");
    expect(dreamSummary({ ...base, withYear: 2052, withoutYear: null })).toBe("夢をすべて入れると82歳で不足します（入れなければ足ります）");
    expect(dreamSummary({ ...base, withYear: 2052, withoutYear: 2058 })).toBe("夢をすべて入れると82歳で不足します（入れなくても88歳で不足します）");
    expect(dreamSummary({ ...base, withYear: 2052, withoutYear: 2052 })).toBe("夢を入れなくても82歳で不足します（夢で不足の時期は変わりません）");
    expect(dreamSummary({ ...base, included: 2, withYear: null, withoutYear: null })).toBe("計算に入れた夢（3件中2件）を入れても100歳まで足ります");
    expect(dreamSummary({ ...base, included: 0, withYear: null, withoutYear: null })).toBe("夢はどれも計算に入れていません");
    expect(dreamSummary({ ...base, total: 0, included: 0, withYear: null, withoutYear: null })).toBeNull();
  });

  it("目標の区画: 夢のカード（順位・名前・時期・額・計算に入れるか）と要約の1文。前の「やりたいこと」の仮のカードは出さない", () => {
    const wh = mutate(threeDreams(), (h) => void (h.periodicExpenses!.find((p) => p.id === ids[2])!.dream!.include = false));
    const req = wh.request;
    const r = preview(forEngine(req));
    const nd = preview(forEngine(withoutDreams(req)));
    const m = toPresentation({ base: req, proposal: req, current: r, proposed: r, targetAge: 90, selectedYear: null, provisional: false, dreams: { raw: req, withoutDreams: nd } });
    const dreams = m.goals.cards.filter((c) => c.dream !== undefined);
    expect(dreams.map((c) => [c.category, c.title, c.amount, c.dream!.included])).toEqual([
      ["夢1", "特別な旅行", 1500000, true],
      ["夢2", "憧れの車", 6000000, true],
      ["夢3", "学び直し・資格", 400000, false],
    ]);
    expect(dreams[0]!.when).toMatch(/^\d{4}年（ご本人65歳）$/u);
    expect(m.goals.cards.some((c) => c.category === "やりたいこと")).toBe(false);
    expect(m.goals.dreamLine).toMatch(/^計算に入れた夢（3件中2件）を入れ(ても\d+歳まで足ります|ると\d+歳で不足します（.+）)$/u);
    // 夢の無い世帯は、入れる所を案内する1枚
    const plain = bare().request;
    const r0 = preview(plain);
    const m0 = toPresentation({ base: plain, proposal: plain, current: r0, proposed: r0, targetAge: 90, selectedYear: null, provisional: false });
    expect(m0.goals.cards.at(-1)).toMatchObject({ category: "夢", title: "まだ入れていません" });
    expect(m0.goals.dreamLine).toBeNull();
  });
});

describe("子への援助の優先度（必ず・できれば）", () => {
  it("子の結婚の援助のひな形は「できれば」。子ども・教育の援助の欄に優先度（省略は必ず）。「確実な分だけ」で「できれば」の援助を外す", () => {
    const wh = addOutTemplate(bare(), "childWedding", seq("a"));
    const h = wh.request.input.household;
    const gifts = (h.goals ?? []).flatMap((g) => g.education?.gifts ?? []);
    expect(gifts.length).toBeGreaterThan(0);
    expect(gifts.every((x) => x.priority === "want")).toBe(true);
    const edu = allFields(buildStage("education", wh)).filter((f) => /^edu\/.+\/gift\/\d+\/priority$/u.test(f.key));
    expect(edu.map((f) => f.get(wh).value)).toEqual(gifts.map(() => "want"));
    const cs = viewCandidates(h).filter((c) => c.side === "gift");
    expect(cs).toHaveLength(gifts.length);
    expect(viewRows([h], viewMode(true)).filter((r) => r.side === "gift").map((r) => [r.name, r.tag, r.excluded])).toEqual([
      ["第1子への援助（結婚資金）", "できれば", true],
      ["第2子への援助（結婚資金）", "できれば", true],
    ]);
    const wed = (x: ReturnType<typeof preview>) => x.table.filter((c) => c.row === "cf.expense.lumpSum.wedding").reduce((s, c) => s + c.amount, 0);
    expect(wed(preview(certainOnly(wh.request)))).toBe(wed(preview(bare().request)));
    expect(wed(preview(wh.request))).toBeGreaterThan(wed(preview(bare().request)));
    // 前の援助（優先度なし）は「必ず」のまま（確実な分だけでも外さない）
    const old = mutate(wh, (hh) => hh.goals!.forEach((g) => g.education?.gifts?.forEach((x) => delete x.priority)));
    expect(viewCandidates(old.request.input.household).some((c) => c.side === "gift")).toBe(false);
    expect(edu[0]!.get(old).value).toBe("need");
  });
});
