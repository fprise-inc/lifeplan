// 子ども・教育の入力の推定の形（0062 の追記 2026-10-30）: 「（上書き）」「空欄なら〜」をやめ、空欄は推定（印・短い根拠・「この値にする」）で見せる。
// 在学年数は標準の年数を最初から見せ、専門学校だけ推定。浪人の「?」。保育の時間を出さない。子が払う分の課税の扱いを出さない。該当する万一。
// 奨学金の返す年数（返還年数算出表）
import { describe, expect, it } from "vitest";
import type { EngineRequest, Goal } from "../src/engine/types.ts";
import { withRefreshedEstimates } from "../src/workspace/input/estimates.ts";
import { stageStatistic } from "../src/workspace/input/educationCost.ts";
import { allFields, type FieldDef } from "../src/workspace/input/form.ts";
import { blankHousehold, mutate, type WorkingHousehold } from "../src/workspace/input/household.ts";
import { addChildWithEducation, addMember } from "../src/workspace/input/stages/family.ts";
import { addChildIncome, DELAY_HELP, jassoRepayYears } from "../src/workspace/input/stages/education.ts";
import { buildStage } from "../src/workspace/input/stages/index.ts";
import { applyStateOp, fieldStatus } from "../src/workspace/input/valueState.ts";
import { preview } from "./helpers.ts";

const seq = () => {
  let n = 0;
  return () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`;
};
const fields = (wh: WorkingHousehold) => allFields(buildStage("education", wh));
const fieldOf = (wh: WorkingHousehold, suffix: string): FieldDef => {
  const f = fields(wh).find((x) => x.key.endsWith(suffix));
  if (f === undefined) throw new Error(`no field ${suffix}`);
  return f;
};
const goalOf = (wh: WorkingHousehold): Goal => (wh.request.input.household.goals ?? []).find((g) => g.kind === "education")!;
const sum = (req: EngineRequest, row: string) => preview(req).table.filter((c) => c.row === row).reduce((s, c) => s + c.amount, 0);

/** 本人40歳・配偶者・子（2016年5月生まれ。小学4年） */
function fresh(): WorkingHousehold {
  const id = seq();
  let wh = blankHousehold("2026-10", id);
  wh = mutate(wh, (h) => void (h.members[0]!.birth.birthYearMonth = "1986-06"));
  wh = withRefreshedEstimates(addMember(wh, "spouse", id));
  wh = withRefreshedEstimates(addChildWithEducation(wh, id));
  return withRefreshedEstimates(mutate(wh, (h) => void (h.members.find((m) => m.kind === "child")!.birth.birthYearMonth = "2016-05")));
}

describe("学費・入学金・仕送りは、空欄なら推定で見せる", () => {
  it("公立小学校の学校の費用は、給食費の国の負担軽減を引いた額を推定にし、「この値にする」で書いても計算は変わらない", () => {
    const wh = fresh();
    const g = goalOf(wh);
    const i = g.education!.stages.findIndex((s) => s.stage === "elementary");
    const f = fieldOf(wh, `edu/${g.id}/stage/${i}/annual`);
    const stat = stageStatistic(g.education!.stages[i]!)!;
    expect(f.label).toBe("学校の費用（年額）");
    const st = f.get(wh);
    expect(st.value).toBeNull();
    expect(st.estimated).toContain("統計の平均。学校教育費と給食費を足したもの");
    expect(st.estimated).toContain("給食費の国の負担軽減");
    expect(f.blankEstimate?.(wh)).toBe(stat.annual! - stat.lunchRelief);
    expect(stat.lunchRelief).toBeGreaterThan(0);
    const before = sum(wh.request, "cf.expense.education.school");
    const after = applyStateOp(wh, f, "confirm");
    expect(goalOf(after).education!.stages[i]!.annualOverride).toBe(stat.annual! - stat.lunchRelief);
    expect(fieldStatus(f, after).status).toBe("confirmed");
    // 年額の割り振り（12か月）と教育費の上昇率は同じなので、表の学校の費用は同じ（端数の差だけ）
    expect(Math.abs(sum(after.request, "cf.expense.education.school") - before)).toBeLessThan(100);
  });

  it("大学の入学金・自宅外の仕送りと初期費用も推定で見せる（「（上書き）」の名前にしない）", () => {
    let wh = fresh();
    const g = goalOf(wh);
    const u = g.education!.stages.findIndex((s) => s.stage === "university");
    wh = fieldOf(wh, `edu/${g.id}/stage/${u}/living`).set(wh, "away");
    for (const k of ["entrance", "boarding/monthly", "boarding/initial"]) {
      const f = fieldOf(wh, `edu/${g.id}/stage/${u}/${k}`);
      expect(f.label).not.toContain("上書き");
      expect(fieldStatus(f, wh).status).toBe("estimated");
      expect(f.blankEstimate?.(wh)).toBeGreaterThan(0);
    }
    expect(fieldOf(wh, `edu/${g.id}/stage/${u}/entrance`).get(wh).estimated).toBe("統計の平均の入学料（私立大学・文科系・令和7年度入学者）");
    // 「空欄: …」「空欄なら…」の言い方を残さない
    for (const f of fields(wh)) {
      expect(`${f.label}${f.help ?? ""}${f.get(wh).hint ?? ""}`, f.key).not.toMatch(/空欄[:：なは]|（上書き）/);
    }
  });
});

describe("在学年数・浪人・保育", () => {
  it("在学年数は標準の年数を最初から見せる（大学4年・医歯系6年）。専門学校は1つに決まらないので推定の2年", () => {
    let wh = fresh();
    const g = goalOf(wh);
    const u = g.education!.stages.findIndex((s) => s.stage === "university");
    expect(fieldOf(wh, `edu/${g.id}/stage/${u}/years`).get(wh)).toMatchObject({ value: 4, implicit: true });
    wh = fieldOf(wh, `edu/${g.id}/stage/${u}/field`).set(wh, "medical");
    expect(fieldOf(wh, `edu/${g.id}/stage/${u}/years`).get(wh).value).toBe(6);
    wh = fieldOf(wh, `edu/${g.id}/higher`).set(wh, "vocational");
    const y = fieldOf(wh, `edu/${g.id}/stage/${u}/years`);
    expect(y.get(wh)).toMatchObject({ value: null, hint: "2年（推定）" });
    expect(y.blankEstimate?.(wh)).toBe(2);
  });

  it("浪人の年数の「?」は、入学・在学・卒業・独立がずれることと、その間の費用を書く", () => {
    const wh = fresh();
    const g = goalOf(wh);
    const u = g.education!.stages.findIndex((s) => s.stage === "university");
    const f = fieldOf(wh, `edu/${g.id}/stage/${u}/delay`);
    expect(f.help).toBe(DELAY_HELP);
    expect(DELAY_HELP).toMatch(/入学・在学・卒業/);
    expect(DELAY_HELP).toMatch(/独立/);
    // 浪人1年で、独立も1年うしろ（最後の学校の終わり）
    const w = withRefreshedEstimates(f.set(wh, 1));
    expect(w.request.input.household.members.find((m) => m.kind === "child")!.leaves?.memberAge?.years).toBe(23);
  });

  it("保育園: 保育の時間は出さない（前に保育短時間を入れた世帯だけ出す）。保育料の水準は保育料のことと分かる名前", () => {
    const id = seq();
    let wh = blankHousehold("2026-10", id);
    wh = mutate(wh, (h) => void (h.members[0]!.birth.birthYearMonth = "1990-06"));
    wh = withRefreshedEstimates(addChildWithEducation(wh, id));
    wh = withRefreshedEstimates(mutate(wh, (h) => void (h.members.find((m) => m.kind === "child")!.birth.birthYearMonth = "2026-01")));
    const g = goalOf(wh);
    wh = fieldOf(wh, `edu/${g.id}/nursery`).set(wh, true);
    expect(fields(wh).some((f) => f.key.endsWith("/hours"))).toBe(false);
    expect(fieldOf(wh, "/feeRatio").label).toBe("保育料の水準（国の基準に対する割合）");
    const w2 = mutate(wh, (h) => void ((h.goals ?? []).find((x) => x.id === g.id)!.education!.stages[0]!.hours = "short"));
    expect(fields(w2).some((f) => f.key.endsWith("/hours"))).toBe(true);
  });
});

describe("この子のお金の行・万一のときの扱い・奨学金", () => {
  it("子が払う分・給付型の奨学金には「課税の扱い」を出さない（教育資金の援助には出す）", () => {
    let wh = fresh();
    const child = wh.request.input.household.members.find((m) => m.kind === "child")!.id;
    wh = addChildIncome(wh, child, "childPays", "00000000-0000-4000-8000-0000000000d1");
    wh = addChildIncome(wh, child, "scholarshipGrant", "00000000-0000-4000-8000-0000000000d2");
    wh = addChildIncome(wh, child, "educationSupport", "00000000-0000-4000-8000-0000000000d3");
    const keys = fields(wh).map((f) => f.key);
    expect(keys).not.toContain("in/00000000-0000-4000-8000-0000000000d1/tax");
    expect(keys).not.toContain("in/00000000-0000-4000-8000-0000000000d2/tax");
    expect(keys).toContain("in/00000000-0000-4000-8000-0000000000d3/tax");
  });

  it("万一のときの扱いの「該当する万一」（どの入力項目でも同じ名前）", () => {
    let wh = fresh();
    const child = wh.request.input.household.members.find((m) => m.kind === "child")!.id;
    wh = addChildIncome(wh, child, "educationSupport", "00000000-0000-4000-8000-0000000000d3");
    wh = fieldOf(wh, "in/00000000-0000-4000-8000-0000000000d3/on/mode").set(wh, "stop");
    expect(fieldOf(wh, "in/00000000-0000-4000-8000-0000000000d3/on/kinds").label).toBe("該当する万一");
  });

  it("返す年数は日本学生支援機構の返還年数算出表のとおり（144万円は13年・240万円は15年・480万円は20年）", () => {
    expect(jassoRepayYears(1440000)).toBe(13);
    expect(jassoRepayYears(2400000)).toBe(15);
    expect(jassoRepayYears(4800000)).toBe(20);
    expect(jassoRepayYears(150000)).toBe(5);
  });
});

describe("推定の値を入れた後に学校の種類を変える", () => {
  it("「この値にする」で入れた年額は、公立・私立を変えると外して新しい推定にする。自分で入れた額は残す", () => {
    const wh = fresh();
    const g = goalOf(wh);
    const u = g.education!.stages.findIndex((s) => s.stage === "university");
    const f = fieldOf(wh, `edu/${g.id}/stage/${u}/annual`);
    const w1 = applyStateOp(wh, f, "confirm");
    expect(goalOf(w1).education!.stages[u]!.annualOverride).toBeGreaterThan(0);
    const w2 = fieldOf(w1, `edu/${g.id}/stage/${u}/sector`).set(w1, "national");
    expect(goalOf(w2).education!.stages[u]!.annualOverride).toBeUndefined();
    const w3 = fieldOf(wh, `edu/${g.id}/stage/${u}/annual`).set(wh, 1500000);
    const w4 = fieldOf(w3, "/preset").set(w3, "allPublic");
    expect(goalOf(w4).education!.stages[u]!.annualOverride).toBe(1500000);
  });
});

describe("独立は最後の学校の終わり", () => {
  it("独立の出来事（生活費の節目が指す）を指す子は、出来事の時点を最後の学校の終わりに合わせる", () => {
    let wh = fresh();
    const child = wh.request.input.household.members.find((m) => m.kind === "child")!.id;
    wh = mutate(wh, (h) => {
      h.events = [...(h.events ?? []), { id: "ev-ind", kind: "independence", member: child, at: { memberAge: { member: child, years: 22, ageSwitch: "schoolYear" } } }];
      h.members.find((m) => m.id === child)!.leaves = { event: "ev-ind" };
    });
    const g = goalOf(wh);
    wh = withRefreshedEstimates(fieldOf(wh, `edu/${g.id}/higher`).set(wh, "none"));
    expect(wh.request.input.household.events!.find((e) => e.id === "ev-ind")!.at).toEqual({ memberAge: { member: child, years: 18, ageSwitch: "schoolYear" } });
  });
});

describe("推定の数え方（0062 の追記 2026-10-31）", () => {
  it("学校の種類で決まる統計の平均は、欄に推定の印を出すが、入力項目の状態・確かめの一覧・まとめて確定では数えない。推定のままの進路は子ごとに1つ数える", async () => {
    const { inputItems } = await import("../src/workspace/input/items.ts");
    const { checkList } = await import("../src/workspace/input/checkRows.ts");
    const { confirmAll } = await import("../src/workspace/input/valueState.ts");
    const wh = fresh();
    const g = goalOf(wh);
    const u = g.education!.stages.findIndex((s) => s.stage === "university");
    const annual = fieldOf(wh, `edu/${g.id}/stage/${u}/annual`);
    expect(fieldStatus(annual, wh).status).toBe("estimated");
    expect(annual.quietEstimate).toBeDefined();
    const edu = inputItems(wh).find((i) => i.id === "education")!;
    // 推定のまま数えるのは進路（推定の進路の型）の1つだけ
    expect(edu.estimated).toBe(1);
    const rows = checkList(wh).filter((r) => r.card === "education" && r.kind === "estimated");
    expect(rows.length).toBe(1);
    // まとめて確定にしても、統計の平均の欄は空欄のまま（学校の種類を変えれば推定が変わる）
    const all = confirmAll(wh, fields(wh));
    expect(goalOf(all.wh).education!.stages[u]!.annualOverride).toBeUndefined();
    // 進路を確かめる（型を選び直す）と、子ども・教育に推定のまま数える欄は無い
    const w2 = fieldOf(wh, "/preset").set(wh, "allPublic");
    expect(inputItems(w2).find((i) => i.id === "education")!.estimated).toBe(0);
  });
});
