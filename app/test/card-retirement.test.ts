// 退職金・企業年金のカード（0057）: 人ごとに何件でも・種類ごとに要る欄・見込み額の欄だけで目安と額を分ける・新しい世帯の目安の自動・推定の入れ直し・
// 働き方を変えたときの扱い・確かめの注意・国民年金基金と年金払い退職給付の年額・公務員と役員の見込みの計算・受け取りの並びと決まりの知らせ・
// 死亡退職金の1行・古い世帯
import { describe, expect, it } from "vitest";
import type { EngineRequest, RetirementBenefit } from "../src/engine/types.ts";
import { checkList } from "../src/workspace/input/checkRows.ts";
import { withRefreshedEstimates } from "../src/workspace/input/estimates.ts";
import { gapsOf, retirementNotApplicable, retirementNotices } from "../src/workspace/input/fill.ts";
import { allFields, type FieldDef } from "../src/workspace/input/form.ts";
import { blankHousehold, fromRequest, mutate, type WorkingHousehold } from "../src/workspace/input/household.ts";
import { inputItems } from "../src/workspace/input/items.ts";
import { CIVIL_PENSION_FIXED, CIVIL_PENSION_LIFE, lumpEstimate } from "../src/workspace/input/retirementBenefits.ts";
import { lineups, overlapNotes, type LineupRow } from "../src/workspace/input/retirementLineup.ts";
import { rowAt } from "../src/workspace/input/rows.ts";
import { buildStage } from "../src/workspace/input/stages/index.ts";
import { applyStateOp, fieldStatus } from "../src/workspace/input/valueState.ts";
import { splitNote } from "../src/workspace/input/FieldViews.tsx";
import { modelHousehold, preview } from "./helpers.ts";

type Obj = Record<string, unknown>;
const BASE = "2026-10";
let n = 0;
const ids = () => () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`;
const open = (id: string) => fromRequest(modelHousehold(id));
const fields = (wh: WorkingHousehold, stage: Parameters<typeof buildStage>[0]) => allFields(buildStage(stage, wh));
const fieldOf = (wh: WorkingHousehold, stage: Parameters<typeof buildStage>[0], suffix: string): FieldDef => {
  const f = fields(wh, stage).find((x) => x.key.endsWith(suffix));
  if (f === undefined) throw new Error(`no field ${suffix}`);
  return f;
};
const runAction = (wh: WorkingHousehold, stage: Parameters<typeof buildStage>[0], keySuffix: string): WorkingHousehold => {
  for (const s of buildStage(stage, wh).sections) for (const a of [...s.actions, ...s.groups.flatMap((g) => g.actions)]) if (a.key.endsWith(keySuffix)) return a.run(wh);
  throw new Error(`no action ${keySuffix}`);
};
const benefitsOf = (wh: WorkingHousehold): RetirementBenefit[] => wh.request.input.household.retirementBenefits ?? [];
const rowTotal = (req: EngineRequest, prefix: string, object?: string) => preview(req).table.filter((c) => c.row.startsWith(prefix) && (object === undefined || c.object === object)).reduce((s, c) => s + c.amount, 0);
const input = (wh: WorkingHousehold) => wh.request.input as unknown as Obj;

/** 新しい世帯で本人を会社員として入れた（退職金の目安が自動で入る） */
function salaried(): { wh: WorkingHousehold; self: string } {
  const wh0 = blankHousehold(BASE, ids());
  const self = wh0.request.input.household.members[0]!.id;
  return { wh: withRefreshedEstimates(runAction(wh0, "work", `work/${self}/start`)), self };
}

describe("新しい世帯: 会社員・公務員の退職金を目安で自動で足す", () => {
  it("会社員として入れると、勤続・辞め方・学歴から退職一時金の目安が入り、確かめの注意（推定より上）に出る", () => {
    const { wh, self } = salaried();
    const b = benefitsOf(wh);
    expect(b).toHaveLength(1);
    expect(b[0]).toMatchObject({ kind: "lumpSum", member: self, amount: { state: "estimated", origin: { kind: "auto" }, estimate: { method: "statistic" } } });
    expect((b[0]!.amount as unknown as { estimate: { basis: string } }).estimate.basis).toMatch(/定年・大学・大学院卒とみなす/);
    expect(b[0]!.amount!.value).toBeGreaterThan(10000000);
    const rows = checkList(wh);
    const notice = rows.findIndex((r) => r.id.startsWith("notice:retirement/auto/"));
    expect(notice).toBeGreaterThanOrEqual(0);
    expect(rows[notice]!.detail).toMatch(/制度があるか確かめてください（制度がある企業は 74\.9%/);
    const firstEstimated = rows.findIndex((r) => r.kind === "estimated");
    expect(firstEstimated === -1 || notice < firstEstimated).toBe(true);
    expect(rowTotal(wh.request, "cf.income.lumpSum.retirement")).toBe(b[0]!.amount!.value);
  });

  it("「制度が無い（外す）」で外すと該当なしになり、もう自動で足さない。カードは当てはまらない", () => {
    const { wh, self } = salaried();
    const n0 = retirementNotices(wh).find((x) => x.id.startsWith("retirement/auto/"))!;
    const none = n0.actions.find((a) => a.key === "none")!.run(wh);
    expect(benefitsOf(none)).toEqual([]);
    expect(retirementNotApplicable(none, self)).toBe(true);
    expect(inputItems(none).find((i) => i.id === "retirement")?.status).toBe("na");
    // 働き方の種類を選び直しても足さない
    const type = fieldOf(none, "work", `work/${self}/now/type`);
    const again = type.set(type.set(none, "contract"), "regular");
    expect(benefitsOf(again)).toEqual([]);
    // 「＋ 足す」は該当なしの印を外して足す
    const added = runAction(none, "retirement", `retirement/${self}/add`);
    expect(benefitsOf(added)).toHaveLength(1);
    expect(retirementNotApplicable(added, self)).toBe(false);
  });

  it("「制度がある（この額で確定）」で確定にすると、注意は消え、根拠は残る", () => {
    const { wh } = salaried();
    const n0 = retirementNotices(wh)[0]!;
    const kept = n0.actions.find((a) => a.key === "keep")!.run(wh);
    expect(retirementNotices(kept)).toEqual([]);
    expect(benefitsOf(kept)[0]!.amount).toMatchObject({ state: "confirmed", estimate: { method: "statistic" } });
  });

  it("推定の連鎖: 辞める時期・辞め方・学歴を変えると、目安のままの額だけ入れ直す", () => {
    const { wh } = salaried();
    const b = benefitsOf(wh)[0]!;
    const v0 = b.amount!.value!;
    // 学歴（詳細）
    const edu = fieldOf(wh, "retirement", `retirement/${b.id}/education`);
    const w1 = withRefreshedEstimates(edu.set(wh, "highSchoolManual"));
    expect(benefitsOf(w1)[0]!.amount!.value).toBeLessThan(v0);
    expect((benefitsOf(w1)[0]!.amount as unknown as { estimate: { basis: string } }).estimate.basis).toMatch(/高校卒（現業職）/);
    // 辞め方（働き方の期間の終わり方。働き方と収入のカードの物を読むだけ）
    const w2 = withRefreshedEstimates(mutate(wh, (h) => void Object.assign(h.employmentPeriods![0]!, { endsWith: "voluntary" })));
    expect(benefitsOf(w2)[0]!.amount!.value).toBeLessThan(v0);
    expect((benefitsOf(w2)[0]!.amount as unknown as { estimate: { basis: string } }).estimate.basis).toMatch(/自己都合/);
    // FP が入れた額は入れ直さない
    const amount = fieldOf(wh, "retirement", `retirement/${b.id}/amount`);
    const typed = amount.set(wh, 15000000);
    const w3 = withRefreshedEstimates(edu.set(typed, "highSchoolManual"));
    expect(benefitsOf(w3)[0]!.amount).toMatchObject({ value: 15000000, state: "confirmed" });
  });

  it("正社員→パートにすると、目安のままの退職金は外す。FP が入れた額は残して注意を出す", () => {
    const { wh, self } = salaried();
    const type = fieldOf(wh, "work", `work/${self}/now/type`);
    expect(benefitsOf(type.set(wh, "partTime"))).toEqual([]);
    const b = benefitsOf(wh)[0]!;
    const typed = fieldOf(wh, "retirement", `retirement/${b.id}/amount`).set(wh, 8000000);
    const part = type.set(typed, "partTime");
    expect(benefitsOf(part)).toHaveLength(1);
    expect(fieldOf(part, "retirement", `retirement/${b.id}/amount`).get(part).warn).toMatch(/前の勤め先の退職金として残しています/);
  });

  it("公務員にすると退職手当の見込みの計算（最終の月給と理由は推定）で入り、計算エンジンが俸給月額×支給率で出す", () => {
    const wh0 = blankHousehold(BASE, ids());
    const self = wh0.request.input.household.members[0]!.id;
    const w = runAction(wh0, "work", `work/${self}/start`);
    const civil = withRefreshedEstimates(fieldOf(w, "work", `work/${self}/now/type`).set(w, "civilServant"));
    const b = benefitsOf(civil);
    expect(b).toHaveLength(1);
    expect(b[0]).toMatchObject({ kind: "civilServantAllowance", estimate: { reason: "retirementAge" } });
    expect(b[0]!.amount).toBeUndefined();
    const fm = fieldOf(civil, "retirement", `retirement/${b[0]!.id}/finalMonthly`);
    expect(fm.level).toBe("simple");
    expect(fieldStatus(fm, civil).status).toBe("estimated");
    expect(rowTotal(civil.request, "cf.income.lumpSum.retirement", b[0]!.id)).toBeGreaterThan(10000000);
    // 見込み額を打つと額で計算し、俸給月額は詳細へ。空欄に戻すと見込みの計算に戻る（最終の月給の推定は残っている）
    const amount = fieldOf(civil, "retirement", `retirement/${b[0]!.id}/amount`);
    const byAmount = amount.set(civil, 20000000);
    expect(rowTotal(byAmount.request, "cf.income.lumpSum.retirement", b[0]!.id)).toBe(20000000);
    expect(fieldOf(byAmount, "retirement", `retirement/${b[0]!.id}/finalMonthly`).level).toBe("detail");
    const back = fieldOf(byAmount, "retirement", `retirement/${b[0]!.id}/amount`).set(byAmount, null);
    expect(benefitsOf(back)[0]!.amount).toBeUndefined();
    expect(benefitsOf(back)[0]!.estimate?.finalMonthly).toBe(b[0]!.estimate!.finalMonthly);
  });
});

describe("人ごとに何件でも・種類ごとに要る欄", () => {
  it("2件目の既定は確定給付企業年金。年金で受けると年数の推定（10年）が入り、年金の行が出る", () => {
    const { wh, self } = salaried();
    const w2 = runAction(wh, "retirement", `retirement/${self}/add`);
    const db = benefitsOf(w2).find((b) => b.kind === "db")!;
    expect(db).toBeDefined();
    expect(fieldStatus(fieldOf(w2, "retirement", `retirement/${db.id}/amount`), w2).status).toBe("missing");
    const amt = fieldOf(w2, "retirement", `retirement/${db.id}/amount`).set(w2, 10000000);
    const ann = fieldOf(amt, "retirement", `retirement/${db.id}/method`).set(amt, "annuity");
    const x = benefitsOf(ann).find((b) => b.id === db.id)!;
    expect(x.receipt).toMatchObject({ method: "annuity", years: 10 });
    expect(rowAt(input(ann), { target: { object: db.id }, item: "retirementBenefit.receipt", at: ["years"] })).toMatchObject({ state: "estimated", estimate: { basis: "確定給付企業年金の年金の年数の標準の値（10年）" } });
    const annual = fieldOf(ann, "retirement", `retirement/${db.id}/annual`);
    expect(annual.get(ann).hint).toMatch(/年100万円（10年/);
    expect(rowTotal(ann.request, "cf.income.corporatePension.db", db.id)).toBe(10000000);
    // 併用は一時金の割合の推定（半分）
    const mixed = fieldOf(amt, "retirement", `retirement/${db.id}/method`).set(amt, "mixed");
    expect(benefitsOf(mixed).find((b) => b.id === db.id)!.receipt).toMatchObject({ lumpShare: "0.5", years: 10 });
    expect(rowTotal(mixed.request, "cf.income.lumpSum.db", db.id)).toBe(5000000);
  });

  it("種類を変えても、FP が入れた額・受け取る時期・名前は引き継ぐ", () => {
    const { wh } = salaried();
    const b = benefitsOf(wh)[0]!;
    let w = fieldOf(wh, "retirement", `retirement/${b.id}/amount`).set(wh, 12000000);
    w = fieldOf(w, "retirement", `retirement/${b.id}/label`).set(w, "架空の退職金");
    w = fieldOf(w, "retirement", `retirement/${b.id}/kind`).set(w, "db");
    expect(benefitsOf(w)[0]).toMatchObject({ kind: "db", label: "架空の退職金", amount: { value: 12000000, state: "confirmed" } });
  });

  it("国民年金基金: 年額は簡易に必ず出し、入れるまでは未入力（0円で計算中）。掛金は社会保険料に", () => {
    const wh0 = blankHousehold(BASE, ids());
    const self = wh0.request.input.household.members[0]!.id;
    const w = runAction(wh0, "work", `work/${self}/startSelf`);
    expect(benefitsOf(w)).toEqual([]);
    const npf = runAction(w, "retirement", `retirement/${self}/add`);
    const b = benefitsOf(npf)[0]!;
    expect(b.kind).toBe("nationalPensionFund");
    const annual = fieldOf(npf, "retirement", `retirement/${b.id}/annual`);
    expect(annual.level).toBe("simple");
    expect(fieldStatus(annual, npf).status).toBe("missing");
    expect(checkList(npf).some((r) => r.kind === "missing" && r.fieldKey === annual.key)).toBe(true);
    expect(rowTotal(npf.request, "cf.income.corporatePension.nationalPensionFund")).toBe(0);
    const filled = annual.set(npf, 240000);
    expect(rowTotal(filled.request, "cf.income.corporatePension.nationalPensionFund", b.id)).toBeGreaterThan(0);
    const contrib = fieldOf(filled, "retirement", `retirement/${b.id}/contrib`).set(filled, 30000);
    expect(benefitsOf(contrib)[0]!.contributions).toMatchObject({ monthly: 30000, from: { at: BASE } });
    expect(rowTotal(contrib.request, "cf.taxSi.pension.fund", b.id)).toBeGreaterThan(0);
  });

  it("年金払い退職給付: 終身の半分と有期の半分の2件で持ち、どちらも年額は未入力の警告", () => {
    const { wh, self } = salaried();
    const b = benefitsOf(wh)[0]!;
    const w = fieldOf(wh, "retirement", `retirement/${b.id}/kind`).set(wh, "civilServantPension");
    const list = benefitsOf(w).filter((x) => x.member === self && x.kind === "civilServantPension");
    expect(list.map((x) => x.label)).toEqual([CIVIL_PENSION_LIFE, CIVIL_PENSION_FIXED]);
    expect(list.map((x) => x.receipt?.years)).toEqual([null, 20]);
    for (const x of list) expect(fieldStatus(fieldOf(w, "retirement", `retirement/${x.id}/annual`), w).status).toBe("missing");
  });

  it("役員退職慰労金: 最終報酬月額（年収÷12）と功績倍率（1.0）の推定で、見込みの計算が出る", () => {
    const { wh, self } = salaried();
    const w0 = fieldOf(wh, "work", `work/${self}/now/type`).set(wh, "executive");
    const add = withRefreshedEstimates(runAction(w0, "retirement", `retirement/${self}/add`));
    const b = benefitsOf(add).find((x) => x.kind === "officerAllowance")!;
    expect(b.estimate?.multiplier).toBe("1");
    expect(fieldStatus(fieldOf(add, "retirement", `retirement/${b.id}/multiplier`), add).status).toBe("estimated");
    expect(b.estimate?.finalMonthly).toBeGreaterThan(0);
    expect(rowTotal(add.request, "cf.income.lumpSum.retirement", b.id)).toBeGreaterThan(0);
  });

  it("外すと、その人の退職給付が無くなったら該当なし", () => {
    const { wh, self } = salaried();
    const b = benefitsOf(wh)[0]!;
    const w = runAction(wh, "retirement", `retirement/${b.id}/remove`);
    expect(benefitsOf(w)).toEqual([]);
    expect(retirementNotApplicable(w, self)).toBe(true);
  });

  it("死亡退職金の1行: 説明の文（額は勤め先の規程・按分はこのアプリの目安。非課税限度額は制度データから）", () => {
    const { wh, self } = salaried();
    const line = fields(wh, "retirement").find((f) => f.key === `ro/retirement/${self}/death`);
    expect(line?.label).toBe("万一亡くなったときの扱い");
    const text = String(line?.get(wh).value);
    expect(text).toMatch(/^万一亡くなったときは、/);
    expect(text).toMatch(/勤め先の退職金の規程で決まります。このアプリでは、勤続の月数で按分した額を目安にします/);
    expect(text).toMatch(/死亡退職金の非課税限度額（500万円×法定相続人の数）/);
  });
});

describe("入れ方の選択の欄は置かない（見込み額の欄だけで目安と額を分ける。0057 の 2026-10-29 の追記）", () => {
  it("退職一時金: 入れ方の欄は無い。空欄は目安（入れ直す）、額を打てば額、空欄に戻すと目安に戻る", () => {
    const { wh } = salaried();
    const b = benefitsOf(wh)[0]!;
    expect(fields(wh, "retirement").some((f) => f.key.endsWith("/mode"))).toBe(false);
    const amount = fieldOf(wh, "retirement", `retirement/${b.id}/amount`);
    expect(amount.help).toMatch(/空欄のときは目安（勤続年数・辞め方・学歴からの平均）で計算/);
    const typed = amount.set(wh, 15000000);
    expect(benefitsOf(typed)[0]!.amount).toMatchObject({ value: 15000000, state: "confirmed" });
    const back = fieldOf(typed, "retirement", `retirement/${b.id}/amount`).set(typed, null);
    expect(benefitsOf(back)[0]!.amount).toMatchObject({ value: b.amount!.value, state: "estimated", estimate: { method: "statistic" } });
  });

  it("前の版の「額で」の跡: 額を打っていない退職一時金は目安に戻し、見込みの計算の種類の未入力の0円は見込みの計算に戻す", () => {
    const { wh } = salaried();
    const b = benefitsOf(wh)[0]!;
    const v0 = b.amount!.value!;
    const legacy = mutate(wh, (h) => {
      const x = h.retirementBenefits![0]!;
      x.amount = { value: 1, state: "estimated", origin: { kind: "auto" }, estimate: { method: "standard", basis: "目安の額を初めの値にした（前の目安）" } } as RetirementBenefit["amount"];
    });
    const after = withRefreshedEstimates(legacy);
    expect(benefitsOf(after)[0]!.amount).toMatchObject({ value: v0, state: "estimated", estimate: { method: "statistic" } });
    // 公務員の退職手当
    const wh0 = blankHousehold(BASE, ids());
    const self = wh0.request.input.household.members[0]!.id;
    const w = runAction(wh0, "work", `work/${self}/start`);
    const civil = withRefreshedEstimates(fieldOf(w, "work", `work/${self}/now/type`).set(w, "civilServant"));
    const c = benefitsOf(civil)[0]!;
    const zero = mutate(civil, (h) => void (h.retirementBenefits![0]!.amount = { value: 0, state: "estimated", origin: { kind: "auto" }, estimate: { method: "statistic", basis: "未入力（0円で計算）" } } as RetirementBenefit["amount"]));
    const fixed = withRefreshedEstimates(zero);
    expect(benefitsOf(fixed)[0]!.amount).toBeUndefined();
    expect(rowTotal(fixed.request, "cf.income.lumpSum.retirement", c.id)).toBeGreaterThan(10000000);
  });

  it("FP が入れた額（確定）は読み替えない", () => {
    const { wh } = salaried();
    const b = benefitsOf(wh)[0]!;
    const typed = fieldOf(wh, "retirement", `retirement/${b.id}/amount`).set(wh, 15000000);
    expect(benefitsOf(withRefreshedEstimates(typed))[0]!.amount).toMatchObject({ value: 15000000, state: "confirmed" });
  });
});

describe("該当なしは区画の見出しの下に出す（ボタンの名前に書かない。0057 の 2026-10-29 の追記）", () => {
  it("外して該当なしにした人の区画は「該当なし」の説明を持ち、足すボタンはふつうの名前", () => {
    const { wh, self } = salaried();
    const b = benefitsOf(wh)[0]!;
    const w = runAction(wh, "retirement", `retirement/${b.id}/remove`);
    const sec = buildStage("retirement", w).sections.find((s) => s.key === `retirement/${self}`)!;
    expect(splitNote(sec.note)).toMatchObject({ state: "該当なし" });
    expect(splitNote(sec.note).help).toMatch(/足すと、該当なしを外します/);
    expect(sec.actions.map((a) => a.label)).toEqual(["＋ 退職金・企業年金を足す"]);
    // 足すと該当なしの説明は消える
    const added = runAction(w, "retirement", `retirement/${self}/add`);
    expect(buildStage("retirement", added).sections.find((s) => s.key === `retirement/${self}`)!.note).toBeUndefined();
  });

  it("該当なしにしていない人（退職給付が無いだけ）は説明を持たない", () => {
    const wh0 = blankHousehold(BASE, ids());
    const self = wh0.request.input.household.members[0]!.id;
    const w = withRefreshedEstimates(runAction(wh0, "work", `work/${self}/start`));
    const part = fieldOf(w, "work", `work/${self}/now/type`).set(w, "partTime");
    expect(benefitsOf(part)).toEqual([]);
    expect(buildStage("retirement", part).sections.find((s) => s.key === `retirement/${self}`)?.note).toBeUndefined();
  });
});

describe("受け取りの並びと、退職所得控除の重なりの決まり", () => {
  it("企業型DCの一時金の5年後に退職一時金: 2026年以後は10年空けないと控除が引かれる（年数は制度データ）。税の列は結果から", () => {
    const wh = open("retirementSequence");
    const r = preview(wh.request);
    const ls = lineups(wh, r);
    const self = ls.find((l) => l.rows.some((x) => x.from === "savings"))!;
    expect(self.rows.map((x) => x.what)).toEqual(expect.arrayContaining(["企業型DCの一時金", "退職一時金"]));
    expect(self.notes.some((t) => /企業型DCの一時金（2031年）の5年後に退職一時金（2036年）: 2026年以後は、DC の一時金の後は10年空けないと/.test(t))).toBe(true);
    expect(self.rows.find((x) => x.what === "退職一時金")!.tax).not.toBeNull();
    // 結果が無ければ税は出さない
    expect(lineups(wh, null).flatMap((l) => l.rows).every((x) => x.tax === null)).toBe(true);
  });

  it("退職金の後の DC の一時金は20年、退職金どうしは5年、同じ年は合わせて1回", () => {
    const row = (what: string, year: number, dc: boolean): LineupRow => ({ ym: `${year}-04`, when: "", what, amount: "", tax: null, from: "retirement", lump: { year, dc } });
    expect(overlapNotes([row("退職一時金", 2030, false), row("iDeCo の一時金", 2045, true)])[0]).toMatch(/前の退職金から20年空けないと/);
    expect(overlapNotes([row("退職一時金", 2030, false), row("役員退職慰労金", 2033, false)])[0]).toMatch(/5年空けないと/);
    expect(overlapNotes([row("退職一時金", 2030, false), row("役員退職慰労金", 2036, false)])).toEqual([]);
    expect(overlapNotes([row("退職一時金", 2030, false), row("確定給付企業年金", 2030, false)])[0]).toMatch(/同じ年/);
  });

  it("公務員の退職手当（見込みの計算）は、額を結果から読む", () => {
    const wh0 = blankHousehold(BASE, ids());
    const self = wh0.request.input.household.members[0]!.id;
    const w = runAction(wh0, "work", `work/${self}/start`);
    const civil = withRefreshedEstimates(fieldOf(w, "work", `work/${self}/now/type`).set(w, "civilServant"));
    expect(lineups(civil, null)[0]!.rows[0]!.amount).toBe("見込みの計算");
    expect(lineups(civil, preview(civil.request))[0]!.rows[0]!.amount).toMatch(/万円$/);
  });
});

describe("古い世帯: 黙って書き換えない", () => {
  it("退職金の無い会社員は自動で足さず、未入力として出す。推定で埋めると目安が入る", () => {
    const req = modelHousehold("salariedCoupleTwoKids");
    delete req.input.household.retirementBenefits;
    const wh = fromRequest(req);
    expect(benefitsOf(withRefreshedEstimates(wh))).toEqual([]);
    const gap = gapsOf(wh).find((g) => g.card === "retirement")!;
    expect(gap).toBeDefined();
    const filled = gap.fill!(wh);
    expect(benefitsOf(filled)[0]!.amount).toMatchObject({ state: "estimated", estimate: { method: "statistic" } });
  });

  it("FP が入れた額のある見本の世帯は、開いても退職給付が変わらない（目安の入れ直しは推定のままの値だけ）", () => {
    for (const id of ["retirementSequence", "executiveOwner", "dualAssetsTwoKids"]) {
      const wh = open(id);
      expect(withRefreshedEstimates(wh).request.input.household.retirementBenefits).toEqual(wh.request.input.household.retirementBenefits);
    }
  });

  it("公務員の退職手当が0円の確定（前の版の「＋ 退職金を入れる」の跡）は確かめの注意に出し、見込みの計算にできる", () => {
    const { wh } = salaried();
    const b = benefitsOf(wh)[0]!;
    const w = mutate(wh, (h) => {
      const x = h.retirementBenefits![0]!;
      x.kind = "civilServantAllowance";
      x.amount = { value: 0, state: "confirmed", origin: { kind: "manual" } };
      h.employmentPeriods![0]!.type = "civilServant";
    });
    const zero = retirementNotices(w).find((x) => x.id === `retirement/zero/${b.id}`)!;
    expect(zero).toBeDefined();
    expect(checkList(w).some((r) => r.id === `notice:retirement/zero/${b.id}` && r.kind === "notice")).toBe(true);
    const fixed = zero.actions.find((a) => a.key === "compute")!.run(w);
    expect(benefitsOf(fixed)[0]!.amount).toBeUndefined();
    expect(benefitsOf(fixed)[0]!.estimate?.finalMonthly).toBeGreaterThan(0);
    expect(rowTotal(fixed.request, "cf.income.lumpSum.retirement", b.id)).toBeGreaterThan(0);
  });

  it("目安の関数は統計の写しから（勤め先・勤続が無ければ作らない）", () => {
    const { wh } = salaried();
    const h = wh.request.input.household;
    const b = benefitsOf(wh)[0]!;
    expect(lumpEstimate(h, b)?.value).toBe(b.amount!.value);
    expect(lumpEstimate(h, { member: b.member })).toBeNull();
    expect(lumpEstimate(h, { ...b, member: "nobody" })).toBeNull();
  });

  it("確定は明示の操作だけ: 目安の額のまま「この値にする」で確定（根拠は残る）", () => {
    const { wh } = salaried();
    const b = benefitsOf(wh)[0]!;
    const f = fieldOf(wh, "retirement", `retirement/${b.id}/amount`);
    expect(f.set(wh, b.amount!.value)).toBe(wh);
    const c = applyStateOp(wh, f, "confirm");
    expect(benefitsOf(c)[0]!.amount).toMatchObject({ state: "confirmed", estimate: { method: "statistic" } });
  });
});
