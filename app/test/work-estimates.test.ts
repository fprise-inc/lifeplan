// 働き方・退職金・年金の推定と連動: 働き方の入口（1つのボタンの選択肢）、働く最後の年齢の推定（自営業は事務所の既定値・パートと契約65歳・役員70歳）、
// 種類を変えたときの推定の入れ直し、目安の定年をもう過ぎた人、過去の退職金の目安、定年後の年収（賞与込み）、パートの初めの値、
// 「＋ 働き方」の期間、終わりの無い働き方の注意、推定の額の丸め、取り込んだ世帯の働く最後、年金の書類の欄、企業年金を年金で受け取るとき
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { REPO_DIR } from "../scripts/lib.ts";
import type { EmploymentPeriod, EngineRequest } from "../src/engine/types.ts";
import { applyImport, approvalTime, importSheet } from "../src/workspace/hearing/sheet.ts";
import { checkList } from "../src/workspace/input/checkRows.ts";
import { withRefreshedEstimates } from "../src/workspace/input/estimates.ts";
import { fillRetirement } from "../src/workspace/input/fill.ts";
import { allFields, type FieldDef, type StageId, type Val } from "../src/workspace/input/form.ts";
import { blankHousehold, fromRequest, mutate, type WorkingHousehold } from "../src/workspace/input/household.ts";
import { buildStage } from "../src/workspace/input/stages/index.ts";
import { civilRetirementAge, lastAgeEstimate, SELF_EMPLOYED_END_ID, withWorkEndEstimates } from "../src/workspace/input/stages/work.ts";
import { readLevers } from "../src/workspace/levers.ts";
import { residentTaxEstimate, salaryEstimate } from "../../hearing/src/estimates.ts";
import { setOfficeEstimates } from "../../hearing/src/statistics.ts";
import { preview } from "./helpers.ts";

const BASE = "2026-10";
let n = 0;
const ids = () => () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`;

const fieldsOf = (wh: WorkingHousehold, stage: StageId = "work"): FieldDef[] => allFields(buildStage(stage, wh));
const fieldOf = (wh: WorkingHousehold, key: string, stage: StageId = "work"): FieldDef => {
  const f = fieldsOf(wh, stage).find((x) => x.key === key || x.key.endsWith(key));
  if (f === undefined) throw new Error(`欄が無い: ${key}`);
  return f;
};
const edit = (wh: WorkingHousehold, key: string, v: Val, stage: StageId = "work") => withRefreshedEstimates(fieldOf(wh, key, stage).set(wh, v));
const actionsOf = (wh: WorkingHousehold, stage: StageId = "work") => buildStage(stage, wh).sections.flatMap((s) => [...s.actions, ...s.groups.flatMap((g) => g.actions)]);
const press = (wh: WorkingHousehold, key: string, stage: StageId = "work") => {
  const a = actionsOf(wh, stage).find((x) => x.key === key);
  if (a === undefined) throw new Error(`ボタンが無い: ${key}`);
  return withRefreshedEstimates(a.run(wh));
};
const periods = (wh: WorkingHousehold, member: string): EmploymentPeriod[] =>
  (wh.request.input.household.employmentPeriods ?? []).filter((p) => p.member === member).sort((a, b) => (a.from.at ?? "").localeCompare(b.from.at ?? ""));
const selfOf = (wh: WorkingHousehold) => wh.request.input.household.members.find((m) => m.kind === "self")!;
/** その人の収入（給与・事業所得）が入る最後の年 */
const lastIncomeYear = (req: EngineRequest, member: string): number => {
  const ps = new Set((req.input.household.employmentPeriods ?? []).filter((p) => p.member === member).map((p) => p.id));
  const years = preview(req).table.filter((c) => c.object !== undefined && ps.has(c.object) && (c.row.startsWith("cf.income.salary") || c.row.startsWith("cf.income.business")) && c.amount > 0).map((c) => c.year);
  return Math.max(...years);
};

function newCustomer(birth: string): { wh: WorkingHousehold; self: string } {
  let wh = withRefreshedEstimates(blankHousehold(BASE, ids()));
  const self = selfOf(wh).id;
  wh = edit(wh, `family/${self}/birth`, birth, "family");
  return { wh, self };
}

afterEach(() => setOfficeEstimates({}));

describe("働き方の入口（「働き方を入れる」の1つのボタンの中の選択肢）", () => {
  it("選択肢は正社員・パート・契約・公務員・役員・自営業・休業中・働いていない。60歳からは再雇用・嘱託が先頭", () => {
    const { wh, self } = newCustomer("1980-06");
    const entry = actionsOf(wh).filter((a) => a.choice?.key === `work/${self}/entry`);
    expect(entry.map((a) => a.label)).toEqual(["正社員", "パート・アルバイト", "契約社員・嘱託（再雇用など）", "公務員", "会社役員", "自営業", "休業中（産休・育休・病気など）", "働いていない（専業主婦・主夫など）"]);
    expect(entry[0]!.key).toBe(`work/${self}/start`);
    expect(entry.find((a) => a.label === "自営業")!.key).toBe(`work/${self}/startSelf`);
    const old = newCustomer("1963-06");
    expect(actionsOf(old.wh).filter((a) => a.choice !== undefined)[0]!.label).toBe("契約社員・嘱託（再雇用など）");
  });

  it("働いていない: 働いていない期間（収入なし）を作り、終わりも推定も入れない", () => {
    const { wh, self } = newCustomer("1985-06");
    const w = press(wh, `work/${self}/start/unemployed`);
    expect(periods(w, self)).toMatchObject([{ type: "unemployed", from: { at: BASE }, to: null }]);
    expect(periods(w, self)[0]!.salary).toBeUndefined();
    expect(Object.keys(w.assumed).filter((k) => k.startsWith(`work/${self}`))).toEqual([]);
    expect(fieldOf(w, `work/${self}/retireAge`).get(w).warn ?? null).toBeNull();
  });
});

describe("自営業の働く最後の年齢（推定。事務所の既定値で変えられる）", () => {
  it("自営業として入れると70歳になる前の月まで（推定の印）。表は100歳まで続かない", () => {
    const { wh, self } = newCustomer("1980-06");
    const w = press(wh, `work/${self}/startSelf`);
    expect(periods(w, self)).toMatchObject([{ type: "selfEmployed", to: { at: "2050-05" } }]);
    expect(readLevers(w.request, self).retireAge).toBe(70);
    expect(fieldOf(w, `work/${self}/retireAge`).get(w)).toMatchObject({ value: 70, assumed: "既定の値（自営業の働く最後の年齢・70歳）" });
    expect(lastIncomeYear(w.request, self)).toBe(2050);
  });

  it("事務所の既定値で年齢を変えると、その年齢と事務所の根拠の文", () => {
    setOfficeEstimates({ [SELF_EMPLOYED_END_ID]: { value: 75, basis: "事務所の目安（75歳）" } });
    const { wh, self } = newCustomer("1980-06");
    const w = press(wh, `work/${self}/startSelf`);
    expect(readLevers(w.request, self).retireAge).toBe(75);
    expect(w.assumed[`work/${self}/retireAge`]).toContain("事務所の目安");
  });

  it("終わりを空に戻すと、確かめの注意「働く最後の年齢が決まっていません（○歳まで事業所得）」と、推定の年齢に戻すボタン", () => {
    const { wh, self } = newCustomer("1980-06");
    let w = press(wh, `work/${self}/startSelf`);
    const p = periods(w, self)[0]!;
    w = edit(w, `work/period/${p.id}/to`, null);
    expect(periods(w, self)[0]!.to).toBeNull();
    const st = fieldOf(w, `work/${self}/retireAge`).get(w);
    expect(st.warn).toBe(`働く最後の年齢が決まっていません（${w.request.input.endYear - 1980}歳まで事業所得を入れています）`);
    const row = checkList(w).find((r) => r.kind === "notice" && (r.detail ?? "").startsWith("働く最後の年齢が決まっていません"));
    expect(row).toBeDefined();
    const fixed = withRefreshedEstimates(row!.actions[0]!.run(w));
    expect(readLevers(fixed.request, self).retireAge).toBe(70);
  });
});

describe("働き方の種類を変えたときの推定の入れ直し", () => {
  it("自営業→公務員: 終わりの無い期間に公務員の定年（生まれた年度）を入れる", () => {
    const { wh, self } = newCustomer("1980-06");
    let w = press(wh, `work/${self}/startSelf`);
    const p = periods(w, self)[0]!;
    w = edit(w, `work/period/${p.id}/to`, null);
    w = edit(w, `work/${self}/now/type`, "civilServant");
    const age = civilRetirementAge(selfOf(w));
    expect(w.postRetirement[self]?.fromAge).toBe(age);
    expect(w.assumed[`work/${self}/mainEnd`]).toContain("公務員の定年");
    expect(periods(w, self).every((x) => x.to !== null)).toBe(true);
  });

  it("自営業（推定の70歳）→パート: 推定のままの終わりをパートの65歳に入れ直す。人が入れた終わりは残す", () => {
    const { wh, self } = newCustomer("1980-06");
    const w = edit(press(wh, `work/${self}/startSelf`), `work/${self}/now/type`, "partTime");
    expect(readLevers(w.request, self).retireAge).toBe(65);
    expect(w.assumed[`work/${self}/retireAge`]).toContain("パート・契約の働く最後の年齢");
    // 人が68歳と入れた終わりは、種類を変えても残す
    let x = edit(press(wh, `work/${self}/startSelf`), `work/${self}/retireAge`, 68);
    x = edit(x, `work/${self}/now/type`, "partTime");
    expect(readLevers(x.request, self).retireAge).toBe(68);
  });

  it("会社員→パート: 推定のままの定年（60歳）と再雇用の期間を外し、働く最後の年齢だけを65歳の推定に。年収はパートの推定", () => {
    const { wh, self } = newCustomer("1980-06");
    let w = press(wh, `work/${self}/start`);
    expect(periods(w, self)).toHaveLength(2);
    w = edit(w, `work/${self}/now/type`, "partTime");
    expect(periods(w, self)).toMatchObject([{ type: "partTime", to: { at: "2045-05" } }]);
    expect(w.postRetirement[self]).toBeUndefined();
    expect(w.assumed[`work/${self}/mainEnd`]).toBeUndefined();
    expect(w.assumed[`work/${self}/postType`]).toBeUndefined();
    expect(w.assumed[`work/${self}/retireAge`]).toContain("65歳");
    expect((periods(w, self)[0]!.salary?.annual as { estimate?: { basis?: string } }).estimate?.basis).toContain("短時間労働者");
    // 退職金の目安（正社員の物）も外れる
    expect((w.request.input.household.retirementBenefits ?? []).filter((b) => b.member === self)).toEqual([]);
    // 定年の欄は出さない
    expect(fieldsOf(w).some((f) => f.key === `work/${self}/mainEnd`)).toBe(false);
  });

  it("会社員→役員: 退任の年齢の目安（70歳）", () => {
    const { wh, self } = newCustomer("1980-06");
    const w = edit(press(wh, `work/${self}/start`), `work/${self}/now/type`, "executive");
    expect(readLevers(w.request, self).retireAge).toBe(70);
    expect(w.assumed[`work/${self}/retireAge`]).toContain("役員の退任の年齢");
  });

  it("FP が定年を入れた会社員をパートに変えても、定年（期間の終わり）はそのまま", () => {
    const { wh, self } = newCustomer("1980-06");
    let w = edit(press(wh, `work/${self}/start`), `work/${self}/mainEnd`, 62);
    w = edit(w, `work/${self}/postType`, "");
    w = edit(w, `work/${self}/now/type`, "partTime");
    expect(readLevers(w.request, self).retireAge).toBe(62);
  });
});

describe("目安の定年をもう過ぎている人（60歳以上）", () => {
  it("60歳で正社員を入れても、過去の定年・過去の退職金を推定しない（65歳まで・退職金は65歳で受け取る）", () => {
    const { wh, self } = newCustomer("1966-06");
    const w = press(wh, `work/${self}/start`);
    expect(periods(w, self)).toMatchObject([{ type: "regular", to: { at: "2031-05" } }]);
    expect(w.assumed[`work/${self}/mainEnd`]).toContain("目安の60歳を今の年齢〔60歳〕が過ぎているので");
    for (const b of w.request.input.household.retirementBenefits ?? []) expect(b.employment).toBe(periods(w, self)[0]!.id);
  });

  it("定年を過ぎた人の「契約社員・嘱託（再雇用など）」: 定年の前の月までの正社員と、今の再雇用（65歳まで・推定）を作り、退職金の目安と定年の欄は出さない", () => {
    const { wh, self } = newCustomer("1963-04");
    const w = press(wh, `work/${self}/start/contract`);
    expect(periods(w, self)).toMatchObject([
      { type: "regular", from: { at: "1985-04" }, to: { at: "2023-03" }, endsWith: "retirement" },
      { type: "contract", from: { at: "2023-04" }, to: { at: "2028-03" } },
    ]);
    expect(w.assumed[`work/${self}/retireAge`]).toContain("65歳");
    expect(w.assumed[`work/${self}/mainEnd`]).toBeUndefined();
    expect(w.request.input.household.retirementBenefits ?? []).toEqual([]);
    const keys = fieldsOf(w).map((f) => f.key);
    expect(keys).toContain(`work/${self}/retireAge`);
    expect(keys).not.toContain(`work/${self}/mainEnd`);
    expect(() => preview(w.request)).not.toThrow();
  });

  it("勤め先の期間がもう終わっている（定年の後）なら、退職金の目安を足さない", () => {
    const { wh, self } = newCustomer("1963-06");
    const w = mutate(wh, (h) => {
      h.employmentPeriods = [{ id: "p-main", member: self, from: { at: "1985-04" }, to: { at: "2023-05" }, type: "regular", salary: { annual: { value: 5000000, state: "confirmed", origin: { kind: "manual" } } } } as EmploymentPeriod];
    });
    expect((fillRetirement(w, self).request.input.household.retirementBenefits ?? []).length).toBe(0);
  });

  it("定年後の期間（再雇用）が今の働き方なら、定年・定年後の働き方・定年後の年収を出さず、働く最後の年齢だけ", () => {
    const { wh, self } = newCustomer("1963-06");
    const req = structuredClone(wh.request);
    const conf = (v: number) => ({ value: v, state: "confirmed", origin: { kind: "manual" } }) as never;
    req.input.household.employmentPeriods = [
      { id: "p-main", member: self, from: { at: "1985-04" }, to: { at: "2023-05" }, type: "regular", salary: { annual: conf(5000000) } } as EmploymentPeriod,
      { id: "p-re", member: self, from: { at: "2023-06" }, to: { at: "2028-05" }, type: "contract", salary: { annual: conf(3000000), bonus: conf(0) } } as EmploymentPeriod,
    ];
    const w = fromRequest(req);
    expect(w.postRetirement[self]).toMatchObject({ fromAge: 60, type: "contract" });
    const keys = fieldsOf(w).filter((f) => f.key.startsWith(`work/${self}/`) && !f.key.startsWith(`work/${self}/now`)).map((f) => f.key);
    expect(keys).toContain(`work/${self}/retireAge`);
    expect(keys).not.toContain(`work/${self}/mainEnd`);
    expect(keys).not.toContain(`work/${self}/postType`);
    expect(keys).not.toContain(`work/${self}/postSalary`);
  });
});

describe("定年後の年収（税込み・賞与込み）", () => {
  it("欄の名前は今の年収と同じ基準。根拠の文は「今の年収（賞与を除く）×割合」", () => {
    const { wh, self } = newCustomer("1980-06");
    const w = press(wh, `work/${self}/start`);
    const f = fieldOf(w, `work/${self}/postSalary`);
    expect(f.label).toBe("定年後の年収（税込み・賞与込み）");
    expect(f.get(w).estimated).toMatch(/^今の年収（賞与を除く）×\d+%/);
    const post = periods(w, self)[1]!;
    expect(f.get(w).value).toBe((post.salary?.annual.value ?? 0) + (post.salary?.bonus?.value ?? 0));
  });

  it("賞与が推定のままの定年後の期間に合計を入れると、統計の割合で賞与を分ける（世帯ファイルは年収と賞与の2つの箱）", () => {
    const { wh, self } = newCustomer("1980-06");
    let w = press(wh, `work/${self}/start`);
    const post = periods(w, self)[1]!;
    w = mutate(w, (h) => {
      const x = h.employmentPeriods!.find((p) => p.id === post.id)!;
      x.salary!.bonus = { value: 0, state: "estimated", origin: { kind: "auto" }, estimate: { method: "statistic", basis: "目安" } } as never;
    });
    w = edit(w, `work/${self}/postSalary`, 4000000);
    const s = periods(w, self)[1]!.salary!;
    expect((s.annual.value ?? 0) + (s.bonus?.value ?? 0)).toBe(4000000);
    expect(s.bonus?.value).toBeGreaterThan(0);
    expect((s.bonus?.value ?? 1) % 1000).toBe(0);
    expect(s.annual).toMatchObject({ state: "confirmed" });
    expect(s.bonus).toMatchObject({ state: "estimated" });
    expect(fieldOf(w, `work/${self}/postSalary`).get(w).value).toBe(4000000);
  });
});

describe("パートの初めの値と「＋ 働き方」", () => {
  it("パートの週の時間は15時間（年収の推定とそろえる）。従業員数・週の時間に推定の印。健康保険は配偶者が勤め先の保険のときだけ家族の扶養", () => {
    const { wh, self } = newCustomer("1985-06");
    const w = press(wh, `work/${self}/start/partTime`);
    const p = periods(w, self)[0]!;
    expect(p.employer).toEqual({ size: 50, weeklyHours: "15" });
    expect(fieldOf(w, `work/period/${p.id}/hours`).get(w).assumed).toContain("週の所定労働時間・15時間");
    expect(fieldOf(w, `work/period/${p.id}/size`).get(w).assumed).toContain("従業員数・50人");
    expect(p.healthInsurance?.kind).toBe("national");
    // 直すと、その欄の印は外れる
    const w2 = edit(w, `work/period/${p.id}/hours`, "25");
    expect(fieldOf(w2, `work/period/${p.id}/hours`).get(w2).assumed ?? null).toBeNull();
  });

  it("配偶者が会社員（協会けんぽ）なら、パートの健康保険は家族の扶養", () => {
    const { wh, self } = newCustomer("1985-06");
    let w = press(wh, `work/${self}/start`);
    w = press(w, "family/add/spouse", "family");
    const spouse = w.request.input.household.members.find((m) => m.kind === "spouse")!;
    w = press(w, `work/${spouse.id}/start/partTime`);
    expect(periods(w, spouse.id)[0]!.healthInsurance?.kind).toBe("dependent");
  });

  it("「＋ 働き方」の期間は始まりから5年。働く最後の年齢が変わったら推定の印を外す", () => {
    const { wh, self } = newCustomer("1980-06");
    let w = press(wh, `work/${self}/start`);
    expect(w.assumed[`work/${self}/retireAge`]).toBeDefined();
    w = press(w, `work/${self}/addPeriod`);
    const added = periods(w, self).at(-1)!;
    expect(added).toMatchObject({ type: "partTime", from: { at: "2045-06" }, to: { at: "2050-05" } });
    expect(w.assumed[`work/${self}/retireAge`]).toBeUndefined();
  });
});

describe("推定の額の丸め（千円単位）", () => {
  it("年収・賞与・事業所得・住民税の推定は千円単位", () => {
    for (const t of ["regular", "contract", "partTime", "civilServant", "executive"]) {
      const e = salaryEstimate(t, { age: 42 })!;
      expect(e.annual.value % 1000, t).toBe(0);
      expect(e.bonus.value % 1000, t).toBe(0);
    }
    expect(residentTaxEstimate(5_123_456, 0, 2025).value % 1000).toBe(0);
    expect(residentTaxEstimate(0, 2_187_654, 2025).value % 1000).toBe(0);
  });
});

describe("取り込んだ世帯の働く最後の年齢（終わりの無い期間に推定を入れる部品）", () => {
  it("ヒアリングシートから取り込んだ会社員・パートの終わりの無い期間に、定年・働く最後の推定を入れる", async () => {
    const wh = withRefreshedEstimates(blankHousehold(BASE, ids()));
    const r = await importSheet(new Uint8Array(readFileSync(join(REPO_DIR, "hearing", "samples", "basic-2-sample.xlsx"))), wh, ids());
    if (!r.ok) throw new Error("取り込めない");
    const imported = withRefreshedEstimates(applyImport(wh, r.view, new Set(r.view.candidates.map((c) => c.id)), approvalTime(new Date(2026, 9, 18, 10, 0, 0))).wh);
    expect((imported.request.input.household.employmentPeriods ?? []).some((p) => p.to === null)).toBe(true);
    const w = withRefreshedEstimates(withWorkEndEstimates(imported));
    expect((w.request.input.household.employmentPeriods ?? []).every((p) => p.to !== null)).toBe(true);
    for (const m of w.request.input.household.members.filter((x) => x.kind === "self" || x.kind === "spouse")) {
      const ps = periods(w, m.id);
      if (ps.length === 0) continue;
      const age = readLevers(w.request, m.id).retireAge!;
      expect(age, m.kind).toBeLessThan(80);
    }
    expect(() => preview(w.request)).not.toThrow();
  });

  it("休業中・働いていないには推定を入れない", () => {
    const { wh, self } = newCustomer("1985-06");
    expect(lastAgeEstimate("leave", selfOf(wh), BASE)).toBeNull();
    const w = withWorkEndEstimates(press(wh, `work/${self}/start/leave`));
    expect(periods(w, self)[0]!.to).toBeNull();
  });
});

describe("年金の書類の欄", () => {
  const docOf = (birth: string) => {
    const { wh, self } = newCustomer(birth);
    const w = press(wh, `work/${self}/start`);
    return { wh: withRefreshedEstimates(fieldOf(w, `pension/${self}/mode`, "pension").set(w, "document")), self };
  };

  it("50歳未満の定期便は老齢基礎年金の額を写さない（加入月数から計算する）。額を変えても見込みは動かないので欄を出さない", () => {
    const { wh, self } = docOf("1985-06");
    const rec = wh.request.input.household.pensionRecords![0]!;
    expect(rec.kind).toBe("statementUnder50");
    expect(rec.amounts?.basic).toBeUndefined();
    const keys = fieldsOf(wh, "pension").map((f) => f.key);
    expect(keys).toContain(`pension/${rec.id}/amounts/employee`);
    expect(keys).not.toContain(`pension/${rec.id}/amounts/basic`);
    void self;
  });

  it("定期便にした時点で、加入月数に代わりの値を推定の印で入れる（「書類で確かめる」のボタンは出さない）", () => {
    const { wh } = docOf("1985-06");
    const rec = wh.request.input.household.pensionRecords![0]!;
    expect(rec.months!.basic).toBeGreaterThan(0);
    expect(actionsOf(wh, "pension").some((a) => a.key.endsWith("/months/unknown"))).toBe(false);
    expect(fieldOf(wh, `pension/${rec.id}/months/basic`, "pension").get(wh).value).toBe(rec.months!.basic);
  });

  it("国民年金の加入月数の説明は、定期便の「年金加入期間 合計」（国民年金 計と厚生年金保険 計）を写すと言う", () => {
    const { wh } = docOf("1985-06");
    const rec = wh.request.input.household.pensionRecords![0]!;
    const help = fieldOf(wh, `pension/${rec.id}/months/basic`, "pension").help ?? "";
    expect(help).toContain("年金加入期間 合計");
    expect(help).toContain("「国民年金 計」だけでは足りません");
  });

  it("受給中（年金額改定通知書）は受け取り開始の欄を出さず、読むだけの1行「受給中」", () => {
    const { wh, self } = docOf("1985-06");
    const w = withRefreshedEstimates(fieldOf(wh, `pension/${self}/kind`, "pension").set(wh, "receiving"));
    const rec = w.request.input.household.pensionRecords![0]!;
    const keys = fieldsOf(w, "pension").map((f) => f.key);
    expect(keys.some((k) => k.startsWith(`pension/${rec.id}/claim`))).toBe(false);
    expect(fieldOf(w, `pension/${rec.id}/receivingNow`, "pension").get(w).value).toBe("受給中（今の年金額で計算）");
  });
});

describe("確定給付企業年金を年金で受け取る", () => {
  it("受け取り方が年金なら一時金の見込み額の欄を出さず、年金の年額を入れる欄にする（併用なら一時金の欄も）", () => {
    const { wh, self } = newCustomer("1980-06");
    let w = press(wh, `work/${self}/start`);
    const b = (w.request.input.household.retirementBenefits ?? []).find((x) => x.member === self)!;
    w = edit(w, `${b.id}/kind`, "db", "retirement");
    w = edit(w, `${b.id}/method`, "annuity", "retirement");
    // 一時金の額をまだ入れていない（未入力の印）企業年金
    w = mutate(w, (h) => {
      const x = (h.retirementBenefits ?? []).find((y) => y.id === b.id)!;
      x.amount = { value: 0, state: "estimated", origin: { kind: "auto" }, estimate: { method: "standard", basis: "未入力（0円で計算）" } } as never;
    });
    const keys = fieldsOf(w, "retirement").map((f) => f.key);
    expect(keys.some((k) => k.endsWith(`${b.id}/amount`))).toBe(false);
    expect(fieldOf(w, `${b.id}/annual`, "retirement").optional ?? false).toBe(false);
    const mixed = edit(w, `${b.id}/method`, "mixed", "retirement");
    expect(fieldsOf(mixed, "retirement").some((f) => f.key.endsWith(`${b.id}/amount`))).toBe(true);
  });
});
