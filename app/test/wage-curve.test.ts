// 統計の年齢カーブで増やす（0116）: 詳細の働き方の期間で、賃金構造基本統計調査の性別・学歴・企業規模の年齢カーブを選ぶ欄。
// 既定は使わない（前提条件の賃金上昇率だけ。今の世帯の計算の結果を変えない）。選ぶとエンジンの昇給カーブ（salary.growth.curve）に値ID を書く
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { EmploymentPeriod, EngineRequest } from "../src/engine/types.ts";
import { allFields, type FieldDef } from "../src/workspace/input/form.ts";
import { fromRequest, type WorkingHousehold } from "../src/workspace/input/household.ts";
import { buildStage } from "../src/workspace/input/stages/index.ts";
import { fieldAddress } from "../src/workspace/input/valueState.ts";
import { wageCurveRate, wageCurveTable } from "../../hearing/src/estimates.ts";
import { REPO_DIR } from "../scripts/lib.ts";
import { full, modelHousehold } from "./helpers.ts";

const open = (id: string): WorkingHousehold => fromRequest(modelHousehold(id));
const fields = (wh: WorkingHousehold): FieldDef[] => allFields(buildStage("work", wh));
const fieldOf = (wh: WorkingHousehold, key: string): FieldDef => {
  const f = fields(wh).find((x) => x.key === key);
  if (f === undefined) throw new Error(`欄が無い: ${key}`);
  return f;
};
const periodOf = (wh: WorkingHousehold, id: string): EmploymentPeriod => wh.request.input.household.employmentPeriods!.find((p) => p.id === id)!;
const wh0 = open("salariedCoupleTwoKids");
const self = wh0.request.input.household.members.find((m) => m.kind === "self")!;
const main = wh0.request.input.household.employmentPeriods!.find((p) => p.member === self.id && p.type === "regular")!;
const spouse = wh0.request.input.household.members.find((m) => m.kind === "spouse")!;
const part = wh0.request.input.household.employmentPeriods!.find((p) => p.member === spouse.id)!;
/** その人の給与・賞与（年額） */
const salaryIn = (req: EngineRequest, year: number, member = self.id) =>
  (full(req).flows as { row: string; ym: string; amount: number; member?: string }[]).filter((f) => f.row === "cf.income.salary" && f.member === member && f.ym.startsWith(`${year}-`)).reduce((s, f) => s + f.amount, 0);
const key = (p: EmploymentPeriod, k: string) => `work/period/${p.id}/${k}`;

describe("統計の年齢カーブ（既定は使わない）", () => {
  it("見本の世帯はどれも昇給カーブを持たない（既定の入れ方は前提条件の賃金上昇率だけ。開いて欄を作っても書き足さない）", () => {
    const dir = join(REPO_DIR, "data", "modelHouseholds");
    for (const name of readdirSync(dir).filter((f) => f.endsWith(".json"))) {
      const req = modelHousehold(name.replace(/\.json$/, ""));
      for (const p of req.input.household.employmentPeriods ?? []) expect((p.salary?.growth as { curve?: string } | undefined)?.curve, name).toBeUndefined();
      const wh = fromRequest(req);
      const before = JSON.stringify(wh.request.input.household.employmentPeriods);
      buildStage("work", wh);
      expect(JSON.stringify(wh.request.input.household.employmentPeriods)).toBe(before);
    }
  });

  it("欄は「使わない」で、詳細の正社員・契約の期間だけに出る（パートには出さない）", () => {
    const f = fieldOf(wh0, key(main, "salaryCurve"));
    expect(f.level).toBe("detail");
    expect(f.get(wh0).value).toBe("none");
    expect(fields(wh0).some((x) => x.key === key(part, "salaryCurve"))).toBe(false);
    // 学歴・企業規模は選んだ後だけ
    expect(fields(wh0).some((x) => x.key === key(main, "salaryCurveEducation"))).toBe(false);
    expect(fields(wh0).some((x) => x.key === key(main, "salaryCurveSize"))).toBe(false);
  });
});

describe("統計の年齢カーブを選ぶ", () => {
  it("性別の表を選ぶと値ID を書き、今の年収から係数の比で伸ばす（当て先は growth の curve）", () => {
    const f = fieldOf(wh0, key(main, "salaryCurve"));
    const wh = f.set(wh0, "male");
    expect(periodOf(wh, main.id).salary!.growth).toEqual({ curve: "wageStats.curve.regular.male.all.all" });
    expect(fieldAddress(f, wh)).toEqual({ target: { object: main.id }, item: "employment.salary.growth", at: ["curve"] });
    // 1981年7月生まれ: 2026年に45歳（45〜49歳）、2031年に50歳（50〜54歳）。2030→2031年の伸びは係数の比の分だけ大きい
    const t = wageCurveTable("wageStats.curve.regular.male.all.all")!;
    const ratio = (req: EngineRequest) => salaryIn(req, 2031) / salaryIn(req, 2030);
    expect(ratio(wh.request) / ratio(wh0.request)).toBeCloseTo(wageCurveRate(t, 50) / wageCurveRate(t, 49), 3);
    // 計算基準年の年収は変えない（今の年収から伸ばす）
    expect(salaryIn(wh.request, 2026)).toBe(salaryIn(wh0.request, 2026));
    // 効き方の文: 今の年齢の係数と 55〜59歳の係数
    const hint = fieldOf(wh, key(main, "salaryCurve")).get(wh).hint ?? "";
    expect(hint).toContain("45歳");
    expect(hint).toContain("55〜59歳");
    expect(hint).toContain("60歳以後は伸ばしません");
  });

  it("男女計の表は性別を使わない選び方。この人の性別と違う表には知らせを添える", () => {
    const f = fieldOf(wh0, key(main, "salaryCurve"));
    const opts = (f as FieldDef & { options: { value: string; label: string }[] }).options;
    expect(opts.find((o) => o.value === "all")?.label).toContain("性別を使わない");
    expect(opts.find((o) => o.value === "male")?.label).toContain("この人の性別");
    const all = f.set(wh0, "all");
    expect(periodOf(all, main.id).salary!.growth).toEqual({ curve: "wageStats.curve.regular.all.all.all" });
    expect(fieldOf(all, key(main, "salaryCurve")).get(all).hint).not.toContain("違う表");
    const female = f.set(wh0, "female");
    expect(fieldOf(female, key(main, "salaryCurve")).get(female).hint).toContain("この人の性別（男性）と違う表です");
  });

  it("学歴・企業規模を選ぶと値ID が変わる。勤め先の従業員数の区分を添える", () => {
    let wh = fieldOf(wh0, key(main, "salaryCurve")).set(wh0, "male");
    wh = fieldOf(wh, key(main, "salaryCurveEducation")).set(wh, "university");
    expect(periodOf(wh, main.id).salary!.growth).toEqual({ curve: "wageStats.curve.regular.male.university.all" });
    const size = fieldOf(wh, key(main, "salaryCurveSize"));
    expect(size.get(wh).hint).toContain("300人");
    expect(size.get(wh).hint).toContain("100〜999人");
    wh = size.set(wh, "large");
    expect(periodOf(wh, main.id).salary!.growth).toEqual({ curve: "wageStats.curve.regular.male.university.large" });
    // 性別を選び直しても学歴・企業規模は残す
    wh = fieldOf(wh, key(main, "salaryCurve")).set(wh, "all");
    expect(periodOf(wh, main.id).salary!.growth).toEqual({ curve: "wageStats.curve.regular.all.university.large" });
    expect(() => full(wh.request)).not.toThrow();
  });

  it("「この期間の伸び（年率）」を入れると年齢カーブの代わりになり、「使わない」で前提条件の賃金上昇率に戻る", () => {
    let wh = fieldOf(wh0, key(main, "salaryCurve")).set(wh0, "male");
    expect(fieldOf(wh, key(main, "salaryGrowth")).get(wh).hint).toContain("統計の年齢カーブ");
    wh = fieldOf(wh, key(main, "salaryGrowth")).set(wh, "0.02");
    expect(periodOf(wh, main.id).salary!.growth).toEqual({ rate: "0.02" });
    expect(fieldOf(wh, key(main, "salaryCurve")).get(wh).value).toBe("none");
    wh = fieldOf(wh, key(main, "salaryCurve")).set(wh, "female");
    expect(periodOf(wh, main.id).salary!.growth).toEqual({ curve: "wageStats.curve.regular.female.all.all" });
    wh = fieldOf(wh, key(main, "salaryCurve")).set(wh, "none");
    expect(periodOf(wh, main.id).salary!.growth).toBeUndefined();
    expect(salaryIn(wh.request, 2035)).toBe(salaryIn(wh0.request, 2035));
  });
});

describe("働き方の種類を変えたとき", () => {
  it("正社員→契約・嘱託は正社員・正職員以外の表（学歴計）に移し、学歴の欄は出さない。パートにすると外す", () => {
    let wh = fieldOf(wh0, key(main, "salaryCurve")).set(wh0, "male");
    wh = fieldOf(wh, key(main, "salaryCurveEducation")).set(wh, "university");
    wh = fieldOf(wh, key(main, "salaryCurveSize")).set(wh, "medium");
    wh = fieldOf(wh, key(main, "type")).set(wh, "contract");
    expect(periodOf(wh, main.id).salary!.growth).toEqual({ curve: "wageStats.curve.nonRegular.male.all.medium" });
    expect(fields(wh).some((x) => x.key === key(main, "salaryCurveEducation"))).toBe(false);
    expect(fieldOf(wh, key(main, "salaryCurve")).get(wh).value).toBe("male");
    expect(() => full(wh.request)).not.toThrow();
    wh = fieldOf(wh, key(main, "type")).set(wh, "regular");
    expect(periodOf(wh, main.id).salary!.growth).toEqual({ curve: "wageStats.curve.regular.male.all.medium" });
    wh = fieldOf(wh, key(main, "type")).set(wh, "partTime");
    expect(periodOf(wh, main.id).salary!.growth).toBeUndefined();
  });

  it("前からある既定の昇給カーブ（wageStats.default）は「前の版の表」として見せ、選び直せる", () => {
    const req = structuredClone(wh0.request);
    req.input.household.employmentPeriods!.find((p) => p.id === main.id)!.salary!.growth = { curve: "wageStats.default" };
    let wh = fromRequest(req);
    const f = fieldOf(wh, key(main, "salaryCurve"));
    expect(f.get(wh).value).toBe("other");
    expect((f as FieldDef & { options: { value: string; label: string }[] }).options.find((o) => o.value === "other")?.label).toContain("前の版の表");
    expect(f.get(wh).hint).toContain("60歳以後は下がります");
    wh = f.set(wh, "all");
    expect(periodOf(wh, main.id).salary!.growth).toEqual({ curve: "wageStats.curve.regular.all.all.all" });
  });
});
