// 働き方と収入・退職金・企業年金・年金の見せ方（0141）: 詳細の欄の並びと名前・協会けんぽの支部の初めの値の印・定年と働く最後の人の固定・
// 退職一時金の目安の前提の1行・役員退職慰労金の式・種類の並びと「＋ 足す」の選択肢・制度が無い1押し・自営業の1行・勤続期間の空欄の意味・
// 年金の書類の額は円の欄・受け取り開始の空欄の意味・老齢厚生年金の欄は厚生年金の期間がある人だけ・書類の額の内訳
import { describe, expect, it } from "vitest";
import type { EmploymentPeriod, PensionRecord } from "../src/engine/types.ts";
import { withRefreshedEstimates } from "../src/workspace/input/estimates.ts";
import { retirementNotApplicable } from "../src/workspace/input/fill.ts";
import { allFields, type FieldDef, type StageId, type Val } from "../src/workspace/input/form.ts";
import { blankHousehold, fromRequest, type WorkingHousehold } from "../src/workspace/input/household.ts";
import { documentAmount } from "../src/workspace/input/pensionEstimate.ts";
import { buildStage } from "../src/workspace/input/stages/index.ts";
import { amountHint, orderedKinds } from "../src/workspace/input/stages/retirement.ts";
import { hasEmployeePension } from "../src/workspace/input/stages/pension.ts";
import { modelHousehold } from "./helpers.ts";

const BASE = "2026-10";
let n = 0;
const ids = () => () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`;

const fieldsOf = (wh: WorkingHousehold, stage: StageId): FieldDef[] => allFields(buildStage(stage, wh));
const fieldOf = (wh: WorkingHousehold, stage: StageId, key: string): FieldDef => {
  const f = fieldsOf(wh, stage).find((x) => x.key === key || x.key.endsWith(key));
  if (f === undefined) throw new Error(`欄が無い: ${key}`);
  return f;
};
const has = (wh: WorkingHousehold, stage: StageId, key: string) => fieldsOf(wh, stage).some((x) => x.key === key || x.key.endsWith(key));
const actionsOf = (wh: WorkingHousehold, stage: StageId) => buildStage(stage, wh).sections.flatMap((s) => [...s.actions, ...s.groups.flatMap((g) => g.actions)]);
const press = (wh: WorkingHousehold, stage: StageId, key: string) => {
  const a = actionsOf(wh, stage).find((x) => x.key === key);
  if (a === undefined) throw new Error(`ボタンが無い: ${key}`);
  return withRefreshedEstimates(a.run(wh));
};
const edit = (wh: WorkingHousehold, stage: StageId, key: string, v: Val) => withRefreshedEstimates(fieldOf(wh, stage, key).set(wh, v));
const periods = (wh: WorkingHousehold, member: string): EmploymentPeriod[] => (wh.request.input.household.employmentPeriods ?? []).filter((p) => p.member === member);

function started(type: "start" | "startSelf" | "start/executive" | "start/civilServant", birth = "1984-04"): { wh: WorkingHousehold; self: string } {
  let wh = withRefreshedEstimates(blankHousehold(BASE, ids()));
  const self = wh.request.input.household.members[0]!.id;
  wh = edit(wh, "family", `family/${self}/birth`, birth);
  return { wh: press(wh, "work", `work/${self}/${type}`), self };
}

describe("働き方と収入", () => {
  it("詳細の並びは年収 → 賞与 → 伸び率（年） → 統計の年齢カーブ。伸びの欄の名前は「伸び率（年）」", () => {
    const { wh, self } = started("start");
    const p = periods(wh, self)[0]!;
    const keys = fieldsOf(wh, "work").filter((f) => f.key.startsWith(`work/period/${p.id}/`)).map((f) => f.key.split("/").at(-1));
    const at = (k: string) => keys.indexOf(k);
    expect(at("annual")).toBeLessThan(at("bonus"));
    expect(at("bonus")).toBeLessThan(at("salaryGrowth"));
    expect(at("salaryGrowth")).toBeLessThan(at("salaryCurve"));
    expect(fieldOf(wh, "work", `work/period/${p.id}/salaryGrowth`).label).toBe("伸び率（年）");
  });

  it("協会けんぽの支部の初めの値（東京支部）は推定の印。選び直すと外れる", () => {
    const { wh, self } = started("start");
    const p = periods(wh, self)[0]!;
    const key = `work/period/${p.id}/branch`;
    expect(fieldOf(wh, "work", key).get(wh).assumed).toMatch(/^既定の値（東京支部。勤め先の所在地の都道府県を選んでください/);
    const w = edit(wh, "work", key, "kyokaikenpo.27");
    expect(fieldOf(w, "work", key).get(w).assumed ?? null).toBeNull();
  });

  it("定年・働く最後の年齢は、その人の年齢だけで入れる（「誰の年齢で」を出さない）", () => {
    const { wh, self } = started("start");
    expect(fieldOf(wh, "work", `work/${self}/mainEnd`).time!.when.who).toBe("fixed");
    expect(fieldOf(wh, "work", `work/${self}/retireAge`).time!.when.who).toBe("fixed");
  });

  it("定年後の予定のある人の今の期間の「終わり」は詳細に出さない（定年の欄と同じ物）。終わりの名前は「終わり」", () => {
    const { wh, self } = started("start");
    const [main, post] = periods(wh, self) as [EmploymentPeriod, EmploymentPeriod];
    expect(has(wh, "work", `work/period/${main.id}/to`)).toBe(false);
    expect(fieldOf(wh, "work", `work/period/${post.id}/to`).label).toBe("終わり");
    // 定年後の予定のある人は、働く最後の年齢を空にできない
    const f = fieldOf(wh, "work", `work/${self}/retireAge`);
    expect(f.time!.when.check!(wh, null)).toMatch(/^空にはできません/);
  });
});

describe("退職金・企業年金", () => {
  it("目安の退職一時金の欄の横に、勤続年数と期間・辞め方・制度のある会社の平均の1行", () => {
    const { wh } = started("start");
    const b = (wh.request.input.household.retirementBenefits ?? [])[0]!;
    expect(amountHint(wh, b.id)).toMatch(/^勤続\d+年（2006年4月〜2044年3月）・定年・制度のある会社の平均$/);
    // 額を入れたら出さない
    const w = edit(wh, "retirement", `retirement/${b.id}/amount`, 15000000);
    expect(amountHint(w, b.id)).toBeNull();
  });

  it("役員退職慰労金の見込みの計算は「最終報酬月額×在任年数×功績倍率＝額」（在任の月数は年に切り上げ）", () => {
    const wh = fromRequest(modelHousehold("sampleExecutive"));
    const b = (wh.request.input.household.retirementBenefits ?? []).find((x) => x.kind === "officerAllowance" && x.amount === undefined)!;
    expect(amountHint(wh, b.id)).toBe("120万円×在任24年×1.5倍＝4,320万円（見込みの計算）");
  });

  it("種類は勤め先の働き方で並べ、ほかは「ほかの種類」の見出しの下。「＋ 足す」は種類を選んでから", () => {
    expect(orderedKinds("selfEmployed")[0]).toBe("nationalPensionFund");
    expect(orderedKinds("executive").slice(0, 2)).toEqual(["officerAllowance", "lumpSum"]);
    expect(orderedKinds("civilServant").slice(0, 2)).toEqual(["civilServantAllowance", "civilServantPension"]);
    const { wh } = started("start");
    const b = (wh.request.input.household.retirementBenefits ?? [])[0]!;
    const kind = fieldOf(wh, "retirement", `retirement/${b.id}/kind`);
    const opts = kind.kind === "select" ? kind.options : [];
    expect(opts.slice(0, 2).map((o) => [o.value, o.group ?? null])).toEqual([
      ["lumpSum", null],
      ["db", null],
    ]);
    expect(opts.slice(2).every((o) => o.group === "ほかの種類")).toBe(true);
    // 自営業の人の「＋ 足す」は国民年金基金が先頭で、選んだ種類を足す
    const se = started("startSelf");
    const adds = actionsOf(se.wh, "retirement").filter((a) => a.choice?.key === `retirement/${se.self}/addKind`);
    expect(adds[0]!.label).toBe("国民年金基金");
    const w = press(se.wh, "retirement", `retirement/${se.self}/add/lumpSum`);
    expect((w.request.input.household.retirementBenefits ?? []).map((x) => x.kind)).toEqual(["lumpSum"]);
  });

  it("「勤め先に退職金の制度が無い」の1押しで目安を外して該当なし", () => {
    const { wh, self } = started("start");
    const b = (wh.request.input.household.retirementBenefits ?? [])[0]!;
    const w = press(wh, "retirement", `retirement/${b.id}/noPlan/remove`);
    expect(w.request.input.household.retirementBenefits ?? []).toEqual([]);
    expect(retirementNotApplicable(w, self)).toBe(true);
    // 額を入れた退職金には出さない
    const typed = edit(wh, "retirement", `retirement/${b.id}/amount`, 15000000);
    expect(actionsOf(typed, "retirement").some((a) => a.key === `retirement/${b.id}/noPlan/remove`)).toBe(false);
  });

  it("自営業の人には、小規模企業共済・iDeCo は貯蓄・運用で入れる旨の1行", () => {
    const se = started("startSelf");
    expect(fieldOf(se.wh, "retirement", `ro/retirement/${se.self}/self`).get(se.wh).value).toBe("貯蓄・運用で入れます");
    expect(has(started("start").wh, "retirement", "/self")).toBe(false);
  });

  it("勤続期間の空欄の意味に、空欄のとき使っている年月を添える", () => {
    const { wh } = started("start");
    const b = (wh.request.input.household.retirementBenefits ?? [])[0]!;
    const f = fieldOf(wh, "retirement", `retirement/${b.id}/service/from`);
    expect(f.time!.state(wh).read).toContain("2006年4月（勤め先の期間の始まり）");
  });
});

describe("年金", () => {
  it("書類から写す年金の額は円で入れる欄（書類の数字をそのまま打つ）", () => {
    let wh = fromRequest(modelHousehold("deferral"));
    const rec = (wh.request.input.household.pensionRecords ?? [])[0]!;
    for (const part of ["basic", "employee"]) {
      const f = fieldOf(wh, "pension", `pension/${rec.id}/amounts/${part}`);
      expect(f.kind === "yen" ? f.unit : null).toBe("yen");
    }
    wh = edit(wh, "pension", `pension/${rec.id}/amounts/basic`, 780000);
    expect((wh.request.input.household.pensionRecords ?? [])[0]!.amounts?.basic?.value).toBe(780000);
  });

  it("受け取り開始の灰色の文字は「空欄＝65歳から」", () => {
    const wh = fromRequest(modelHousehold("salariedCoupleTwoKids"));
    const f = fieldsOf(wh, "pension").find((x) => x.key.endsWith("/claim"))!;
    expect(f.blankMeans).toBe("65歳から");
    expect(f.example).toBe("空欄＝65歳から");
  });

  it("厚生年金の期間が無い人（自営業だけ）には、老齢厚生年金の受け取り開始を出さない", () => {
    const se = started("startSelf");
    const h = se.wh.request.input.household;
    expect(hasEmployeePension(h, h.members[0]!, undefined)).toBe(false);
    expect(fieldsOf(se.wh, "pension").some((f) => f.key.endsWith("/claim/employee"))).toBe(false);
    const sal = started("start");
    expect(fieldsOf(sal.wh, "pension").some((f) => f.key.endsWith("/claim/employee"))).toBe(true);
    // 推計の1行は、何から推計しているか
    expect(fieldOf(sal.wh, "pension", `pension/${sal.self}/mode`).get(sal.wh).hint).toBe("推計: 2006年4月からの働き方（正社員→契約社員・嘱託（再雇用など））で計算しています");
  });

  it("書類の額（見込額・今の年額）は、50歳以上の定期便・見込額・改定通知書だけ。50歳未満の定期便は加入月数から計算するので出さない", () => {
    const rec = (kind: string, basic: number, employee: number): PensionRecord => ({ id: "r", member: "m", kind, amounts: { basic: { value: basic, state: "confirmed", origin: { kind: "manual" } }, employee: { value: employee, state: "confirmed", origin: { kind: "manual" } } } }) as unknown as PensionRecord;
    expect(documentAmount(rec("statementOver50", 800000, 1250000))).toBe(2050000);
    expect(documentAmount(rec("statementUnder50", 0, 500000))).toBeNull();
    expect(documentAmount(undefined)).toBeNull();
  });
});
