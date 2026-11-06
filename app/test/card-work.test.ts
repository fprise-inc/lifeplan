// 働き方と収入のカード: 辞め方・失業給付・高年齢雇用継続給付の欄（おまかせ＝推定は新しく作った期間だけ・期間が変わると入れ直す）、
// 新しい世帯の定年と定年後の再雇用の推定（公務員の定年・年収の割合）、古い世帯の確かめの一覧、働き方のお金の区画
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { REPO_DIR } from "../scripts/lib.ts";
import type { EmploymentPeriod, EngineRequest } from "../src/engine/types.ts";
import { continuationApplies, CONTINUATION_ITEM, ELDERLY_AGE, isEstimated, MIN_IDLE_MONTHS, missingUnemployment, unemploymentEstimate, UNEMPLOYMENT_ITEM } from "../src/workspace/input/claims.ts";
import { fillAll, gapsOf } from "../src/workspace/input/fill.ts";
import { allFields, type FieldDef, type StageDef, type Val } from "../src/workspace/input/form.ts";
import { blankHousehold, fromRequest, type WorkingHousehold } from "../src/workspace/input/household.ts";
import { withRefreshedEstimates } from "../src/workspace/input/estimates.ts";
import { buildStage } from "../src/workspace/input/stages/index.ts";
import { civilRetirementAge, reemploymentSalary } from "../src/workspace/input/stages/work.ts";
import { fieldAddress, fieldStatus } from "../src/workspace/input/valueState.ts";
import { readLevers } from "../src/workspace/levers.ts";
import { modelHousehold, preview } from "./helpers.ts";

const BASE = "2026-10";
let n = 0;
const ids = () => () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`;

const stage = (wh: WorkingHousehold, id: "work" | "family" = "work"): StageDef => buildStage(id, wh);
const fieldOf = (wh: WorkingHousehold, key: string, id: "work" | "family" = "work"): FieldDef => {
  const f = allFields(stage(wh, id)).find((x) => x.key === key || x.key.endsWith(key));
  if (f === undefined) throw new Error(`欄が無い: ${key}`);
  return f;
};
const hasField = (wh: WorkingHousehold, key: string) => allFields(stage(wh)).some((x) => x.key === key);
/** 入力のパネルと同じく、欄・ボタンの後に推定を入れ直す */
const edit = (wh: WorkingHousehold, key: string, v: Val, id: "work" | "family" = "work") => withRefreshedEstimates(fieldOf(wh, key, id).set(wh, v));
const action = (wh: WorkingHousehold, key: string) => {
  const a = stage(wh).sections.flatMap((s) => [...s.actions, ...s.groups.flatMap((g) => g.actions)]).find((x) => x.key === key);
  if (a === undefined) throw new Error(`ボタンが無い: ${key}`);
  return withRefreshedEstimates(a.run(wh));
};
const periods = (wh: WorkingHousehold, member: string): EmploymentPeriod[] =>
  (wh.request.input.household.employmentPeriods ?? []).filter((p) => p.member === member).sort((a, b) => (a.from.at ?? "").localeCompare(b.from.at ?? ""));
const rowTotal = (req: EngineRequest, row: string) => preview(req).table.filter((c) => c.row === row).reduce((a, c) => a + c.amount, 0);

/** 新しい世帯: 本人（birth）を会社員として入れる */
function newWorker(birth = "1980-06"): { wh: WorkingHousehold; self: string } {
  let wh = blankHousehold(BASE, ids());
  const self = wh.request.input.household.members[0]!.id;
  wh = withRefreshedEstimates(fieldOf(wh, `family/${self}/birth`, "family").set(wh, birth));
  wh = action(wh, `work/${self}/start`);
  return { wh, self };
}

describe("推定の決まりはエンジンの SDK と同じ", () => {
  it("SDK の estimateUnemploymentClaim の決まり（3か月・65歳・休業のまま辞める）を写している", () => {
    // エンジンの SDK は画面の型の検査に入れない（生成物が要る）ので、本文の決まりの数と式を読んで突き合わせる
    const src = readFileSync(join(REPO_DIR, "engine", "src", "sdk", "helpers.ts"), "utf8");
    expect(src).toContain(`export const UNEMPLOYMENT_ESTIMATE_MIN_IDLE_MONTHS = ${MIN_IDLE_MONTHS};`);
    expect(src).toContain(`return o.ageAtLeaving < (o.elderlyAge ?? ${ELDERLY_AGE}) && o.idleMonths >= UNEMPLOYMENT_ESTIMATE_MIN_IDLE_MONTHS && o.endsWith !== "sickLeave";`);
  });

  it.each([
    [59, 120, undefined, true],
    [59, 2, undefined, false],
    [64, 3, undefined, true],
    [65, 12, undefined, false],
    [50, 12, "sickLeave", false],
    [50, 12, "involuntary", true],
  ] as const)("辞めた年齢 %i・次に働くまで %i か月・辞め方 %s", (age, idle, endsWith, want) => {
    // 画面の推定: 本人の期間を、その年齢で辞めて idle か月後に次の勤めを始める形にして同じ答えになる
    const { wh, self } = newWorker("1970-06");
    const h = structuredClone(wh.request.input.household);
    const end = `${1970 + age}-06`;
    const p: EmploymentPeriod = { id: "p1", member: self, from: { at: "2000-04" }, to: { at: end }, type: "regular", ...(endsWith !== undefined ? { endsWith } : {}) };
    const [y, m] = end.split("-").map(Number) as [number, number];
    const next = new Date(Date.UTC(y, m - 1 + idle + 1, 1));
    const q: EmploymentPeriod = { id: "p2", member: self, from: { at: `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, "0")}` }, to: null, type: "partTime" };
    h.employmentPeriods = [p, q];
    expect(unemploymentEstimate(h, p)).toBe(want);
  });
});

describe("新しい世帯: 定年と定年後の再雇用の推定", () => {
  it("会社員として入れると、60歳の定年・65歳まで再雇用（年収は定年前の年収×60〜64歳の平均の割合）を推定で入れる", () => {
    const { wh, self } = newWorker();
    const ps = periods(wh, self);
    expect(ps.map((p) => [p.type, p.to?.at])).toEqual([
      ["regular", "2040-05"],
      ["contract", "2045-05"],
    ]);
    expect(wh.postRetirement[self]).toMatchObject({ fromAge: 60, type: "contract" });
    const main = ps[0]!;
    const post = ps[1]!;
    const want = reemploymentSalary("regular", main.salary!.annual.value!)!;
    expect(want.value).toBeLessThan(main.salary!.annual.value!);
    expect(post.salary!.annual).toMatchObject({ value: want.value, state: "estimated", origin: { kind: "auto" } });
    // 欄は推定の印
    for (const k of ["mainEnd", "postType", "postSalary", "retireAge"]) expect(fieldStatus(fieldOf(wh, `work/${self}/${k}`), wh).status, k).toBe("estimated");
    expect(readLevers(wh.request, self).retireAge).toBe(65);
    expect(() => preview(wh.request)).not.toThrow();
  });

  it("定年前の年収を直すと、推定のままの定年後の年収も直る。定年後の年収を入れたら、その後は直さない", () => {
    const { wh, self } = newWorker();
    // 定年前の年収（賞与を除く）は、働き方の期間（詳しく）の欄で直す（標準の今の働き方は年収〔賞与込み〕の1欄。0078）
    const mainKey = `work/period/${periods(wh, self)[0]!.id}/annual`;
    const w1 = edit(wh, mainKey, 6000000);
    const post = () => periods(w1, self)[1]!;
    const want = reemploymentSalary("regular", 6000000)!;
    expect(post().salary!.annual.value).toBe(want.value);
    const w2 = edit(w1, `work/${self}/postSalary`, 3000000);
    const w3 = edit(w2, mainKey, 7000000);
    expect(periods(w3, self)[1]!.salary!.annual).toMatchObject({ value: 3000000, state: "confirmed" });
  });

  it("働く最後の年齢を変えても、推定のままの定年後の年収は推定の箱のまま", () => {
    const { wh, self } = newWorker();
    const w1 = edit(wh, `work/${self}/retireAge`, 63);
    const ps = periods(w1, self);
    expect(ps.at(-1)!.to?.at).toBe("2043-05");
    expect(ps.at(-1)!.salary!.annual.state).toBe("estimated");
    // 働く最後の欄の仮の印は外れる
    expect(w1.assumed[`work/${self}/retireAge`]).toBeUndefined();
  });

  it("公務員にすると、生まれた年度の定年（1967年度以降の生まれは65歳）。65歳の定年なら定年後の予定は入れない", () => {
    const { wh, self } = newWorker();
    const main = periods(wh, self)[0]!;
    const w1 = edit(wh, `work/period/${main.id}/type`, "civilServant");
    const ps = periods(w1, self);
    expect(ps.map((p) => [p.type, p.to?.at])).toEqual([["civilServant", "2045-05"]]);
    expect(w1.postRetirement[self]).toMatchObject({ fromAge: 65, type: null });
    // 正社員に戻すと、60歳の定年と再雇用に戻る
    const w2 = edit(w1, `work/period/${main.id}/type`, "regular");
    expect(periods(w2, self).map((p) => [p.type, p.to?.at])).toEqual([
      ["regular", "2040-05"],
      ["contract", "2045-05"],
    ]);
  });

  it("公務員の定年の段階（生まれた年度ごと）", () => {
    const m = (ym: string, bornOnFirst = false) => ({ id: "x", kind: "self", birth: { birthYearMonth: ym, bornOnFirst }, sex: "male" });
    expect(civilRetirementAge(m("1962-06"))).toBe(60);
    expect(civilRetirementAge(m("1963-06"))).toBe(61);
    expect(civilRetirementAge(m("1964-06"))).toBe(62);
    expect(civilRetirementAge(m("1965-06"))).toBe(63);
    expect(civilRetirementAge(m("1966-06"))).toBe(64);
    expect(civilRetirementAge(m("1967-06"))).toBe(65);
    // 早生まれは前の年度
    expect(civilRetirementAge(m("1964-02"))).toBe(61);
    expect(civilRetirementAge(m("1964-04", true))).toBe(61);
  });
});

describe("辞め方・失業給付・高年齢雇用継続給付の欄", () => {
  it("新しく作った期間は推定（おまかせ）。定年後に働かないにすると、定年の期間の推定が入れ直る。計算に入る", () => {
    const { wh, self } = newWorker();
    const [main, post] = periods(wh, self) as [EmploymentPeriod, EmploymentPeriod];
    // 定年の期間: 次の勤めがすぐ始まるので受け取らない（推定）。60〜64歳の月が無いので継続給付の欄は無い
    expect(main.unemploymentClaim).toBe(false);
    expect(isEstimated(main, UNEMPLOYMENT_ITEM)).toBe(true);
    expect(hasField(wh, `work/period/${main.id}/continuationClaim`)).toBe(false);
    // 再雇用の期間: 64歳で辞めて働かないので受け取る。60〜64歳で働くので継続給付も受け取る（推定）
    expect(post).toMatchObject({ unemploymentClaim: true, elderlyContinuationClaim: true });
    expect(continuationApplies(wh.request.input.household, post)).toBe(true);
    expect(fieldOf(wh, `work/period/${post.id}/unemploymentClaim`).get(wh)).toMatchObject({ value: "auto", hint: "目安: 受け取る" });
    expect(fieldStatus(fieldOf(wh, `work/period/${post.id}/unemploymentClaim`), wh).status).toBe("estimated");
    expect(rowTotal(wh.request, "cf.income.benefit.unemployment")).toBeGreaterThan(0);
    // 定年後は働かない: 定年の期間の後に働かないので、推定は受け取るに入れ直る
    const w1 = edit(wh, `work/${self}/postType`, "");
    const m1 = periods(w1, self)[0]!;
    expect(periods(w1, self)).toHaveLength(1);
    expect(m1.unemploymentClaim).toBe(true);
    expect(isEstimated(m1, UNEMPLOYMENT_ITEM)).toBe(true);
  });

  it("「受け取らない」を選ぶと推定の印が外れ、期間を変えても入れ直さない。「おまかせ」に戻すと推定に戻る", () => {
    const { wh } = newWorker();
    const post = periods(wh, wh.request.input.household.members[0]!.id)[1]!;
    const key = `work/period/${post.id}/unemploymentClaim`;
    const w1 = edit(wh, key, "no");
    const p1 = (w1.request.input.household.employmentPeriods ?? []).find((p) => p.id === post.id)!;
    expect(p1.unemploymentClaim).toBe(false);
    expect(isEstimated(p1, UNEMPLOYMENT_ITEM)).toBe(false);
    expect(fieldStatus(fieldOf(w1, key), w1).status).toBe("confirmed");
    // 表の行は失業の給付と高年齢雇用継続給付をまとめた行なので、減る
    expect(rowTotal(w1.request, "cf.income.benefit.unemployment")).toBeLessThan(rowTotal(wh.request, "cf.income.benefit.unemployment"));
    const w2 = edit(w1, key, "auto");
    expect((w2.request.input.household.employmentPeriods ?? []).find((p) => p.id === post.id)!.unemploymentClaim).toBe(true);
    // 継続給付も同じ
    const w3 = edit(w2, `work/period/${post.id}/continuationClaim`, "no");
    expect((w3.request.input.household.employmentPeriods ?? []).find((p) => p.id === post.id)!.elderlyContinuationClaim).toBe(false);
  });

  it("辞め方: 今の勤め先の定年の期間は「定年」（推定）、ほかの期間の空欄は自動（60歳以上は定年）。会社都合を選ぶと期間に書き、計算できる", () => {
    const { wh, self } = newWorker();
    const [main, post] = periods(wh, self) as [EmploymentPeriod, EmploymentPeriod];
    const f = fieldOf(wh, `work/period/${main.id}/endsWith`);
    expect(f.get(wh)).toMatchObject({ value: "retirement" });
    expect(fieldStatus(f, wh).status).toBe("estimated");
    const g = fieldOf(wh, `work/period/${post.id}/endsWith`);
    expect(g.get(wh)).toMatchObject({ value: "", implicit: true });
    expect(g.kind === "select" && g.options[0]!.label).toBe("自動: 定年（60歳以後に辞めるので）");
    const w1 = edit(wh, `work/period/${main.id}/endsWith`, "involuntary");
    expect(periods(w1, self)[0]!.endsWith).toBe("involuntary");
    expect(() => preview(w1.request)).not.toThrow();
    // 定年後の予定の定年で辞める期間の先頭の「自動」は推定の定年（選択肢の先頭と、推定の「定年」がそろう）。選ぶと推定の定年に戻す
    expect(f.kind === "select" && f.options[0]!.label).toBe("自動: 定年（定年後の予定の定年で辞めるので）");
    const back = edit(w1, `work/period/${main.id}/endsWith`, "");
    expect(back.request.input.household.employmentPeriods!.find((p) => p.id === main.id)!.endsWith).toBe("retirement");
    expect(fieldStatus(fieldOf(back, `work/period/${main.id}/endsWith`), back).status).toBe("estimated");
    // 定年後の予定の無い期間の「自動」は、今までどおり空に戻す（エンジンの自動の決まり）
    const w2 = edit(wh, `work/period/${post.id}/endsWith`, "voluntary");
    expect(edit(w2, `work/period/${post.id}/endsWith`, "").request.input.household.employmentPeriods!.find((p) => p.id === post.id)!.endsWith).toBeUndefined();
  });

  it("欄の当て先は期間の入力項目ID", () => {
    const { wh, self } = newWorker();
    const post = periods(wh, self)[1]!;
    expect(fieldAddress(fieldOf(wh, `work/period/${post.id}/unemploymentClaim`), wh)).toEqual({ target: { object: post.id }, item: UNEMPLOYMENT_ITEM, at: [] });
    expect(fieldAddress(fieldOf(wh, `work/period/${post.id}/continuationClaim`), wh)).toEqual({ target: { object: post.id }, item: CONTINUATION_ITEM, at: [] });
    expect(fieldAddress(fieldOf(wh, `work/period/${post.id}/endsWith`), wh)).toEqual({ target: { object: post.id }, item: "employment.endsWith", at: [] });
  });
});

describe("古い世帯: 失業給付は自動で入れず、確かめの一覧で知らせる", () => {
  it("開いても期間を書き換えない。推定で埋めると受け取る、受け取らないと決めると一覧から消える", () => {
    const wh = withRefreshedEstimates(fromRequest(modelHousehold("salariedCoupleTwoKids")));
    expect(JSON.stringify(wh.request.input.household.employmentPeriods)).toBe(JSON.stringify(modelHousehold("salariedCoupleTwoKids").input.household.employmentPeriods));
    const missing = missingUnemployment(wh.request.input.household);
    expect(missing.length).toBeGreaterThan(0);
    const gap = gapsOf(wh).find((g) => g.id === `work/unemployment/${missing[0]!.id}`)!;
    expect(gap).toMatchObject({ card: "work", noneLabel: "受け取らない" });
    expect(gap.label).toContain("失業給付");
    const filled = fillAll(wh, "work").wh;
    const p = (filled.request.input.household.employmentPeriods ?? []).find((x) => x.id === missing[0]!.id)!;
    expect(p.unemploymentClaim).toBe(true);
    expect(isEstimated(p, UNEMPLOYMENT_ITEM)).toBe(true);
    expect(rowTotal(filled.request, "cf.income.benefit.unemployment")).toBeGreaterThan(0);
    const none = gap.none!(wh);
    expect(gapsOf(none).some((g) => g.id === gap.id)).toBe(false);
    expect(rowTotal(none.request, "cf.income.benefit.unemployment")).toBe(0);
  });
});

describe("勤め先の社会保険・休業の終わり・健康保険の種類", () => {
  it("パートの勤め先の社会保険: 入っているにすると健康保険と厚生年金が勤め先の種類になり、保険料がかかる。わからないは上書きを外す", () => {
    const { wh, self } = newWorker();
    const main = periods(wh, self)[0]!;
    let w = edit(wh, `work/period/${main.id}/type`, "partTime");
    const before = rowTotal(w.request, "cf.taxSi.pension");
    const si = fieldOf(w, `work/${self}/now/si`);
    expect(si.level).toBe("simple");
    expect(si.get(w)).toMatchObject({ value: "", implicit: true });
    w = edit(w, `work/${self}/now/si`, "yes");
    const p = periods(w, self)[0]!;
    expect(p).toMatchObject({ employeeInsurance: { value: true, state: "confirmed" }, pensionCategory: "employee1", healthInsurance: { kind: "kyokaikenpo" } });
    expect(rowTotal(w.request, "cf.taxSi.pension")).toBeLessThan(before);
    expect(edit(w, `work/${self}/now/si`, "").request.input.household.employmentPeriods!.find((x) => x.id === p.id)!.employeeInsurance).toBeUndefined();
    // 健康保険の種類は詳細だけ
    expect(allFields(stage(w)).find((f) => f.key === `work/${self}/now/hi`)).toBeUndefined();
    expect(fieldOf(w, `work/period/${p.id}/hi`).level).toBe("detail");
  });

  it("休業中: 休業の終わりを入れると、翌月から休業の前と同じ働き方に戻る", () => {
    const { wh, self } = newWorker("1992-06");
    // 今から休業（育休）: 今の勤めを前の月で終え、今月から終わりの無い休業の期間
    const main = periods(wh, self)[0]!;
    const req = structuredClone(wh.request);
    req.input.household.employmentPeriods = [
      { ...structuredClone(main), to: { at: "2026-09" } },
      { id: "00000000-0000-4000-8000-0000000000aa", member: self, from: { at: "2026-10" }, to: null, type: "leave", leaveKind: "childcare" },
    ];
    let w: WorkingHousehold = { ...wh, request: req, postRetirement: {} };
    const leave = fieldOf(w, `work/${self}/now/leaveEnd`);
    expect(leave.level).toBe("simple");
    w = leave.set(w, "2027-09");
    const ps = periods(w, self);
    expect(ps.map((p) => [p.type, p.from.at, p.to?.at ?? null])).toEqual([
      ["regular", main.from.at, "2026-09"],
      ["leave", "2026-10", "2027-09"],
      ["regular", "2027-10", null],
    ]);
    expect(() => preview(w.request)).not.toThrow();
  });
});

describe("働き方のお金の行", () => {
  it("区画は簡易に出て、失業給付の行は「教育訓練給付など」（失業給付は働き方の期間で計算する）", () => {
    const { wh } = newWorker();
    const sec = stage(wh).sections.find((s) => s.key === "money/work/in")!;
    expect(sec.level).toBe("simple");
    expect(sec.actions.find((a) => a.key.endsWith("/unemployment"))!.label).toContain("教育訓練給付");
  });
});

describe("打ち手が足す期間の決まった ID", () => {
  it("どの元の ID からも UUID の形になる（符号つきの数で「-」が入らない）", async () => {
    const { derivedId } = await import("../src/workspace/levers.ts");
    const re = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-8[0-9a-f]{3}-[0-9a-f]{12}$/;
    for (let i = 0; i < 2000; i++) expect(derivedId(`00000000-0000-4000-8000-${String(i).padStart(12, "0")}`, "reemployment")).toMatch(re);
  });
});
