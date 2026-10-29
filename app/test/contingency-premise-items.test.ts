// 万一のタブの想定の前提を対策と同じ表示に（0085）: 選んでいる場面の項目だけ・場面ごとの既定の4つ・足す／外す・値を変えた項目は出す・
// 場面の札の条件・事務所の既定値（最初から出す項目・場面の帯・開いたときの場面・必要保障額の数え方）・就業不能と収入が減るの配偶者の働き方と年収（計算）
import { renderToString } from "preact-render-to-string";
import { h } from "preact";
import { describe, expect, it } from "vitest";
import { itemValued, premiseItems, resetItem, type PremiseItem } from "../src/workspace/contingency/inputs.ts";
import {
  DEFAULT_PREMISE_KINDS,
  pickScene,
  PREMISE_KINDS,
  premiseStartKinds,
  premiseStarts,
  premiseView,
  protectionOf,
  protectionText,
  readPremiseChoice,
  readProtectionSetting,
  readSceneChoice,
  sameProtection,
  withPremiseStart,
  withProtection,
  type PremiseKind,
} from "../src/workspace/contingency/premiseChoice.ts";
import { PremisePanel } from "../src/workspace/contingency/PremisePanel.tsx";
import { premiseFor, writePremise } from "../src/workspace/contingency/planPremise.ts";
import { scenarioCards } from "../src/workspace/contingency/present.ts";
import { scenarioRequest, scenarios, type Scenario } from "../src/workspace/contingency/requests.ts";
import { fromRequest, type WorkingHousehold } from "../src/workspace/input/household.ts";
import { applyOfficeDefaults, DEFAULT_OFFICE_SETTINGS, isDefaultSettings, readOfficeSettings } from "../src/workspace/office/settings.ts";
import { OfficeSettingsPanel } from "../src/workspace/office/OfficeSettingsPanel.tsx";
import { sumByYear } from "../src/workspace/present.ts";
import type { Proposal } from "../src/workspace/plans/plans.ts";
import { roles } from "../src/workspace/roles.ts";
import { modelHousehold, preview } from "./helpers.ts";

const open = (id: string): WorkingHousehold => fromRequest(modelHousehold(id));
const scOf = (wh: WorkingHousehold, key: string): Scenario => scenarios(wh).find((s) => s.key === key)!;
const itemsOf = (wh: WorkingHousehold, key: string) => premiseItems(wh, scOf(wh, key));
const shownOf = (wh: WorkingHousehold, key: string, o: { start?: ReadonlySet<PremiseKind>; added?: string[] } = {}) => {
  const items = itemsOf(wh, key);
  const by = new Map(items.map((it) => [it.kind, it]));
  return premiseView(
    items.map((it) => it.kind),
    o.start ?? premiseStartKinds({}),
    o.added ?? [],
    (k) => itemValued(by.get(k) as PremiseItem, wh),
  ).shown;
};
const fieldOf = (wh: WorkingHousehold, key: string, kind: PremiseKind, i = 0) => itemsOf(wh, key).find((it) => it.kind === kind)!.parts.flatMap((p) => p.fields)[i]!;
const panel = (wh: WorkingHousehold, key: string, added: string[] = []) =>
  renderToString(h(PremisePanel, { wh, scene: "場面", items: itemsOf(wh, key), start: premiseStartKinds({}), added, onAdd: () => undefined, onRemove: () => undefined, onDraft: () => undefined, onCommit: () => undefined }));

describe("場面ごとの既定の4つ（事務所が何も選んでいないとき）", () => {
  const wh = open("salariedCoupleTwoKids");
  it("選んでいる場面の項目だけを、既定の4つで出す", () => {
    expect(shownOf(wh, "death:self")).toEqual(["death:living", "death:work", "death:salary", "death:funeral"]);
    expect(shownOf(wh, "disability:self")).toEqual(["disability:grade", "disability:medical", "disability:medicalMonths", "disability:partner"]);
    expect(shownOf(wh, "illness:self")).toEqual(["illness:months", "illness:disease", "illness:hospitalDays", "illness:medical"]);
    expect(shownOf(wh, "income")).toEqual(["income:member", "income:ratio", "income:years", "income:partner"]);
    expect(shownOf(wh, "market")).toEqual(["market:drop", "market:classes", "market:recoveryYears", "market:recoveryCap"]);
    // ほかの場面の項目は出さない（前は全部の場面の欄を一度に並べていた）
    const html = panel(wh, "death:self");
    expect(html).not.toContain("仮定の等級");
    expect(html).not.toContain("下がる幅");
    expect(html).toContain("遺族の生活費の割合（子がいる間）");
    expect(html).not.toContain("必要保障額の出し方");
    expect(html).not.toContain("いつまでの資金を数えるか");
  });

  it("既定の組み合わせは1か所（DEFAULT_PREMISE_KINDS）で、どの場面も4つ。追加で出せる項目は一覧に載る", () => {
    for (const s of ["death", "disability", "illness", "income", "market"]) expect(DEFAULT_PREMISE_KINDS.filter((k) => k.startsWith(`${s}:`)), s).toHaveLength(4);
    const kinds = (key: string) => itemsOf(wh, key).map((it) => it.kind);
    expect(kinds("death:self")).toEqual(expect.arrayContaining(["death:allowance", "death:condolence", "death:workRelated", "death:reserve", "death:independence", "death:livingAfter", "market:stack"]));
    expect(kinds("illness:self")).toEqual(expect.arrayContaining(["illness:surgeries", "illness:medicalMonths", "illness:after"]));
    expect(kinds("disability:self")).toEqual(expect.arrayContaining(["disability:oldAgeChoice"]));
    expect(kinds("market")).toEqual(expect.arrayContaining(["market:stack"]));
    expect(PREMISE_KINDS.map((k) => k.kind)).toEqual(expect.arrayContaining([...DEFAULT_PREMISE_KINDS]));
  });

  it("団信は死亡（と就業不能）の場面の追加で出せる項目（住まい・ローンと同じ欄）", () => {
    const loan = open("survivorEmployeeLoan");
    const cl = itemsOf(loan, "death:self").find((it) => it.kind === "death:creditLife")!;
    expect(cl.parts[0]!.fields.some((f) => f.key.startsWith("housing/debt/"))).toBe(true);
    expect(shownOf(loan, "death:self")).not.toContain("death:creditLife");
    expect(shownOf(loan, "death:self", { added: ["death:creditLife"] })).toContain("death:creditLife");
  });

  it("世帯に当てはまらない項目は出さない（配偶者がいない・子がいない世帯の遺族の生活費は今の決まりのまま）", () => {
    const single = open("single45");
    expect(shownOf(single, "disability:self")).toEqual(["disability:grade", "disability:medical", "disability:medicalMonths"]);
    expect(shownOf(single, "income")).toEqual(["income:member", "income:ratio", "income:years"]);
    const noKids = open("dualNoKids");
    expect(panel(noKids, "death:self")).toContain("遺族の生活費の割合（子がいない世帯）");
    expect(itemsOf(noKids, "death:self").map((it) => it.kind)).not.toContain("death:livingAfter");
  });

  it("残された配偶者の年収は、働き方を選ぶまで動かせない（枠は出し、説明だけ）", () => {
    expect(itemsOf(wh, "death:self").find((it) => it.kind === "death:salary")!.inactive).toBeDefined();
    const w = fieldOf(wh, "death:self", "death:work").set(wh, "partTime");
    expect(itemsOf(w, "death:self").find((it) => it.kind === "death:salary")!.inactive).toBeUndefined();
    // 働き方を選ぶと、変える時期と何歳までを足せる
    expect(itemsOf(w, "death:self").map((it) => it.kind)).toContain("death:workWhen");
  });
});

describe("足す・外す・値を変えた項目", () => {
  const wh = open("salariedCoupleTwoKids");
  it("足した項目は足した順に後ろへ。外すと消え、値は既定に戻す", () => {
    expect(shownOf(wh, "death:self", { added: ["death:reserve", "death:allowance"] })).toEqual(["death:living", "death:work", "death:salary", "death:funeral", "death:reserve", "death:allowance"]);
    const it = itemsOf(wh, "death:self").find((x) => x.kind === "death:reserve")!;
    const w = it.parts[0]!.fields[0]!.set(wh, 6);
    expect(w.contingency.survivor.reserveMonths).toBe(6);
    expect(resetItem(it, w).contingency).toEqual(wh.contingency);
    // 足していないが値が入っている項目も出す（外しても、値を変えていれば出る）
    expect(shownOf(w, "death:self")).toContain("death:reserve");
    const html = panel(w, "death:self");
    expect(html).toContain('data-premise-remove="cg/lump/reserve"');
    // 最初から出す項目は外せない
    expect(html).not.toContain('data-premise-remove="cg/living/before"');
  });

  it("事務所が外した項目は最初は出ない。値を変えると出る。事務所が足した項目は最初から出る", () => {
    const c = withPremiseStart(withPremiseStart({}, "death:funeral", false), "death:allowance", true);
    expect(c).toEqual({ shown: ["death:allowance"], hidden: ["death:funeral"] });
    const start = premiseStartKinds(c);
    expect(shownOf(wh, "death:self", { start })).toEqual(["death:living", "death:work", "death:salary", "death:allowance"]);
    const w = fieldOf(wh, "death:self", "death:funeral").set(wh, 2000000);
    expect(shownOf(w, "death:self", { start })).toEqual(["death:living", "death:work", "death:salary", "death:allowance", "death:funeral"]);
    expect(premiseStarts(c, "death:funeral")).toBe(false);
    expect(readPremiseChoice({ shown: ["death:allowance", "nope", 3], hidden: ["death:funeral", "death:allowance"] })).toEqual({ hidden: ["death:funeral", "death:allowance"] });
    expect(readPremiseChoice("x")).toEqual({});
  });

  it("プランだけで上書きした前提は、そのプランを見ているときに出す（前提を直す先は今のまま）", () => {
    const id = "00000000-0000-4000-8000-00000000c085";
    const saved: WorkingHousehold = { ...open("salariedCoupleTwoKids"), proposals: [{ id, name: "プランB", base: null, diffs: [], tags: [], createdAt: "2026-10-29T00:00:00Z", updatedAt: "2026-10-29T00:00:00Z", origin: { kind: "manual" } } as unknown as Proposal] };
    const base = saved;
    const plan = (w: WorkingHousehold) => ({ ...w, contingency: premiseFor(w, id) });
    const f = fieldOf(base, "death:self", "death:allowance");
    const next = writePremise(saved, id, saved.contingency, f.set(plan(saved), 5000000).contingency, "plan");
    expect(next.contingency).toEqual(saved.contingency);
    expect(shownOf(plan(next), "death:self")).toContain("death:allowance");
    expect(shownOf(next, "death:self")).not.toContain("death:allowance");
  });
});

describe("就業不能・収入が減るの配偶者の働き方と年収（計算。0085）", () => {
  const wh = open("protectionNeed");
  const spouse = wh.request.input.household.members.find((m) => m.kind === "spouse")!;
  const salaryOf = (w: WorkingHousehold, key: string, year: number) => sumByYear(preview(scenarioRequest(w, scOf(w, key), 2030)).table, (x) => x.row.startsWith("cf.income.salary") && x.member === spouse.id).get(year) ?? 0;
  const setWork = (w: WorkingHousehold, key: string, type: string, annual: number | null) => {
    const kind = key === "income" ? "income:partner" : "disability:partner";
    const w1 = fieldOf(w, key, kind, 0).set(w, type);
    return annual === null ? w1 : fieldOf(w1, key, kind, 1).set(w1, annual);
  };

  it.each(["disability:self", "income"])("%s: 起きた月の6か月後から、配偶者の働き方と年収を置き換える（要求の workChanges）", (key) => {
    const w = setWork(wh, key, "partTime", 1200000);
    const scene = key === "income" ? "income" : "disability";
    expect(w.contingency.partnerWork?.[scene]?.[spouse.id]).toEqual({ type: "partTime", annualSalary: 1200000 });
    const req = scenarioRequest(w, scOf(w, key), 2030);
    const ch = req.input.workChanges!;
    expect(ch).toHaveLength(1);
    expect(ch[0]).toMatchObject({ member: spouse.id, from: { at: "2030-07" }, type: "partTime" });
    expect(ch[0]!.salary?.annual.value).toBe(1200000);
    // 今の働き方のまま（既定）なら置き換えない
    expect(scenarioRequest(wh, scOf(wh, key), 2030).input.workChanges).toBeUndefined();
    expect(salaryOf(wh, key, 2031)).toBe(0);
    // 年収は賃金の伸びで伸ばす（2030年は7月からの6か月分）
    expect(salaryOf(w, key, 2031)).toBeGreaterThanOrEqual(1200000);
    expect(salaryOf(w, key, 2031)).toBeLessThan(1250000);
    expect(salaryOf(w, key, 2030)).toBeGreaterThanOrEqual(600000);
    expect(salaryOf(w, key, 2030)).toBeLessThan(625000);
    // 死亡の場面・ほかの場面には効かない
    expect(scenarioRequest(w, scOf(w, "death:self"), 2030).input.contingencies![0]!.survivor?.spouseWork).toBeUndefined();
    expect(scenarioRequest(w, scOf(w, "illness:self"), 2030).input.workChanges).toBeUndefined();
  });

  it("いつから・いつまでは死亡のときと同じ決まり（○か月後・何歳まで）。働かないにもできる", () => {
    let w = setWork(wh, "disability:self", "regular", 3000000);
    const when = itemsOf(w, "disability:self").find((it) => it.kind === "disability:partnerWhen")!.parts[0]!.fields;
    w = when.find((f) => f.key.endsWith("/after"))!.set(w, 0);
    w = itemsOf(w, "disability:self").find((it) => it.kind === "disability:partnerWhen")!.parts[0]!.fields.find((f) => f.key.endsWith("/until"))!.set(w, 60);
    const ch = scenarioRequest(w, scOf(w, "disability:self"), 2030).input.workChanges![0]!;
    expect(ch.from).toEqual({ at: "2030-01" });
    expect(ch.to).not.toBeNull();
    const none = setWork(wh, "income", "none", null);
    expect(scenarioRequest(none, scOf(none, "income"), 2030).input.workChanges![0]).toMatchObject({ type: "unemployed", from: { at: "2030-07" } });
  });

  it("想定の前提の枠: 働き方を選ぶと年収のスライダーが出る（1つの枠）", () => {
    expect(panel(wh, "disability:self")).toContain("data-premise-work");
    const w = setWork(wh, "disability:self", "partTime", 1200000);
    const html = panel(w, "disability:self");
    expect(html).toContain('data-premise-slider="cg/partner/disability/');
    expect(html).toContain("年120万円");
  });
});

describe("場面の札に条件を書く", () => {
  const wh = open("salariedCoupleTwoKids");
  const protection = { status: "loading" as const, charts: [], error: null, ms: null };
  const cards = (w: WorkingHousehold) => scenarioCards({ req: w.request, scenarios: scenarios(w), selected: "death:self", protection, grade: w.contingency.grade, plan: w.contingency });
  const titleOf = (w: WorkingHousehold, key: string) => cards(w).find((c) => c.key === key)!;
  // 呼び方は roles から（性別によらない呼び方に変わっても同じ）
  const spouseLabel = roles(wh.request).find((r) => r.key === "spouse")!.label;
  const selfLabel = roles(wh.request).find((r) => r.key === "self")!.label;
  it("収入が減る・相場の下落は条件を見出しに。条件を動かすと文字も変わる", () => {
    expect(titleOf(wh, "income").title).toBe("収入が2割減る（3年）");
    expect(titleOf(wh, "market").title).toBe("相場が3割下がる");
    const w = { ...wh, contingency: { ...wh.contingency, incomeDrop: { ratio: "0.3", years: 5, member: "spouse" as const }, market: { drop: "0.5" } } };
    expect(titleOf(w, "income").title).toBe(`${spouseLabel}の収入が3割減る（5年）`);
    expect(titleOf(w, "market").title).toBe("相場が5割下がる");
    expect(titleOf({ ...w, contingency: { ...w.contingency, incomeDrop: { member: "both" as const } } }, "income").title).toBe("2人の収入が2割減る（3年）");
  });
  it("就業不能・大きな病気は札の下の行に条件（配偶者の働き方・病気と期間・相場も下落）", () => {
    expect(titleOf(wh, "illness:self").status).toBe("がん・12か月働けない");
    const spouse = wh.request.input.household.members.find((m) => m.kind === "spouse")!;
    const w = { ...wh, contingency: { ...wh.contingency, stackMarket: true, illness: { disease: "heartStroke" as const, months: 6 }, partnerWork: { disability: { [spouse.id]: { type: "partTime" as const } } } } };
    expect(titleOf(w, "illness:self").status).toBe("心疾患・脳卒中・6か月働けない・相場も下落");
    expect(titleOf(w, "disability:self").status).toBe(`障害2級の仮定・${spouseLabel}はパート・相場も下落`);
    expect(titleOf(w, "disability:self").title).toBe(`${selfLabel}が働けなくなったら`);
  });
});

describe("事務所の既定値: 万一のときのタブ（0085）", () => {
  it("場面の帯に並べる場面・開いたときの場面（最後に見た場面を優先。並べない種類なら並べるものの最初）", () => {
    const wh = open("salariedCoupleTwoKids");
    const all = scenarios(wh);
    expect(pickScene(all, {}, undefined).selected?.key).toBe("death:self");
    const c = readSceneChoice({ hidden: ["death", "nope"], open: "income" });
    expect(c).toEqual({ hidden: ["death"], open: "income" });
    expect(pickScene(all, c, undefined).list.map((s) => s.kind)).not.toContain("death");
    expect(pickScene(all, c, undefined).selected?.key).toBe("income");
    expect(pickScene(all, c, "market").selected?.key).toBe("market");
    expect(pickScene(all, c, "death:self").selected?.key).toBe("income");
    expect(pickScene(all, readSceneChoice({ hidden: ["death"], open: "death:spouse" }), undefined).selected?.key).toBe("disability:self");
    // 全部の種類を並べないことはできない
    expect(readSceneChoice({ hidden: ["death", "disability", "illness", "income", "market"] })).toEqual({});
    // 単身で本人の死亡が無い世帯は、並べるものの最初
    expect(pickScene(scenarios(open("single45")), {}, undefined).selected?.key).toBe("disability:self");
  });

  it("必要保障額の数え方を事務所の既定値に持ち、新しい世帯に写す（作った世帯は世帯の値のまま）", () => {
    const p = readProtectionSetting({ horizon: { kind: "age", age: 85 }, protection: { method: "reverse", reverseUntilAge: 200 } });
    expect(p).toEqual({ horizon: { kind: "age", age: 85 }, protection: { method: "reverse" } });
    expect(protectionText(p)).toBe("配偶者が85歳になるまで・逆算方式（遺族が平均余命まで）");
    expect(protectionText({})).toBe("配偶者の平均余命まで・積み上げ方式");
    expect(readProtectionSetting({ horizon: { kind: "lifeExpectancy" }, protection: { method: "accumulation" } })).toEqual({});
    const s = readOfficeSettings({ protection: p, premises: { hidden: ["death:funeral"] }, scenes: { open: "market" } });
    expect(s.protection).toEqual(p);
    expect(s.premises).toEqual({ hidden: ["death:funeral"] });
    expect(s.scenes).toEqual({ open: "market" });
    expect(isDefaultSettings(s)).toBe(false);
    expect(isDefaultSettings(readOfficeSettings({}))).toBe(true);
    // 欄の無い古い事務所データは既定のまま
    expect(readOfficeSettings({ levers: {} })).toMatchObject({ premises: {}, scenes: {}, protection: {} });
    const wh = open("salariedCoupleTwoKids");
    const made = applyOfficeDefaults(wh, s);
    expect(made.contingency.horizon).toEqual({ kind: "age", age: 85 });
    expect(made.contingency.protection).toEqual({ method: "reverse" });
    expect(protectionOf(made.contingency)).toEqual(p);
    expect(applyOfficeDefaults(wh, DEFAULT_OFFICE_SETTINGS).contingency).toEqual(wh.contingency);
    // 世帯の値が事務所と違うかどうか（万一のときのタブの1行）
    expect(sameProtection(protectionOf(wh.contingency), p)).toBe(false);
    expect(sameProtection(protectionOf(withProtection(wh.contingency, p)), p)).toBe(true);
    // 書き換えはほかの前提を変えない
    const back = withProtection(made.contingency, {});
    expect(back.horizon).toBeUndefined();
    expect(back.survivor).toEqual(made.contingency.survivor);
  });

  it("事務所の既定値のパネルに区画「万一のときのタブ」（場面の帯・開いたときの場面・場面ごとの項目・必要保障額の数え方）", () => {
    const html = renderToString(h(OfficeSettingsPanel, { value: DEFAULT_OFFICE_SETTINGS, onSave: async () => undefined, shared: false, onClose: () => undefined }));
    expect(html).toContain("万一のときのタブ");
    expect(html).toContain('data-office-scene-show="market"');
    expect(html).toContain('data-office-open-scene');
    expect(html).toContain('data-office-premise-show="death:living"');
    expect(html).toContain('data-office-horizon');
    expect(html).toContain('data-office-method');
  });
});
