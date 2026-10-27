// 標準の欄の見直し（0078）: 推定で補えて結果があまりぶれない欄は詳細へ、入れないと大きくぶれる欄は標準へ。世帯ファイルの形は変えず、
// 欄の置き場所（標準・詳細）と見せ方だけを変える。年収（賞与込み）の1欄は、年収・賞与の2つの値の箱に書き分ける
import { h } from "preact";
import { renderToString } from "preact-render-to-string";
import { describe, expect, it } from "vitest";
import type { Debt, EmploymentPeriod, EngineRequest } from "../src/engine/types.ts";
import { allFields, type FieldDef, type StageId } from "../src/workspace/input/form.ts";
import { fromRequest, mutate, type WorkingHousehold } from "../src/workspace/input/household.ts";
import { SavingsPanel } from "../src/workspace/input/savings/SavingsPanel.tsx";
import { Field } from "../src/workspace/input/FieldViews.tsx";
import { buildStage } from "../src/workspace/input/stages/index.ts";
import { creditActive, rateOutlookOf } from "../src/workspace/input/stages/housingLoans.ts";
import { endLevels } from "../src/workspace/input/stages/insurance.ts";
import { BONUS_SPLIT_METHOD } from "../src/workspace/input/stages/work.ts";
import { switchEntry } from "../src/workspace/input/stages/housingLoans.ts";
import { applyStateOp, fieldStatus } from "../src/workspace/input/valueState.ts";
import { salaryAge, salaryEstimate } from "../src/workspace/input/estimates.ts";
import { applyLevers, readLevers } from "../src/workspace/levers.ts";
import { modelHousehold, preview } from "./helpers.ts";

const open = (id: string): WorkingHousehold => fromRequest(modelHousehold(id));
const fieldsOf = (wh: WorkingHousehold, stage: StageId): FieldDef[] => allFields(buildStage(stage, wh));
const fieldOf = (wh: WorkingHousehold, stage: StageId, key: string): FieldDef => {
  const f = fieldsOf(wh, stage).find((x) => x.key === key);
  if (f === undefined) throw new Error(`欄が無い: ${key}`);
  return f;
};
const members = (wh: WorkingHousehold) => wh.request.input.household.members;
const periodOf = (wh: WorkingHousehold, member: string): EmploymentPeriod => (wh.request.input.household.employmentPeriods ?? []).find((p) => p.member === member) as EmploymentPeriod;

/** 標準に出る入れる欄（読むだけの行は数えない） */
function simpleFields(wh: WorkingHousehold, stage: StageId): FieldDef[] {
  const st = buildStage(stage, wh);
  return st.sections.filter((s) => s.level === "simple").flatMap((s) => s.groups.filter((g) => g.level === "simple").flatMap((g) => g.fields.filter((f) => f.level === "simple" && f.readOnly === undefined)));
}

/** 代表の世帯: 夫婦とも会社員・子2人・持ち家と住宅ローン1本・預貯金と NISA（見本の世帯の妻を会社員にした物） */
function representative(): WorkingHousehold {
  const req = structuredClone(modelHousehold("salariedCoupleTwoKids")) as EngineRequest;
  const hh = req.input.household;
  const spouse = hh.members.find((m) => m.kind === "spouse")!;
  for (const p of hh.employmentPeriods ?? [])
    if (p.member === spouse.id)
      Object.assign(p, {
        type: "regular",
        healthInsurance: { kind: "kyokaikenpo", insurer: "kyokaikenpo.11" },
        pensionCategory: "employee1",
        employer: { size: 300, weeklyHours: "40" },
        salary: { annual: { value: 4000000, state: "confirmed", origin: { kind: "manual" } }, bonus: { value: 800000, state: "confirmed", origin: { kind: "manual" } } },
      });
  return fromRequest(req);
}

describe("最初の5枚の標準の欄の数", () => {
  it("代表の世帯で、家族8・働き方と収入10・基本生活費4・住まい8〜9・貯蓄8（今の残高から入れたローンで合計38。配偶者の性別は詳細）", () => {
    let wh = representative();
    const count = (w: WorkingHousehold) => (["family", "work", "living", "housing", "savings"] as const).map((s) => simpleFields(w, s).length);
    expect(count(wh)).toEqual([8, 10, 4, 9, 8]);
    for (const d of wh.request.input.household.debts ?? []) wh = switchEntry(wh, d.id, "balance");
    expect(count(wh)).toEqual([8, 10, 4, 8, 8]);
    expect(count(wh).reduce((a, b) => a + b, 0)).toBe(38);
  });
});

describe("家族: 呼び名は詳細・子の性別は出さない、子の独立は子ども・教育のカードの詳細に1つだけ", () => {
  it("本人の性別は標準、配偶者の性別と呼び名は詳細、子の性別は出さない。家族のカードに独立の欄は無く、子ども・教育のカードの詳細にある", () => {
    const wh = open("salariedCoupleTwoKids");
    const fam = fieldsOf(wh, "family");
    for (const m of members(wh)) {
      expect(fam.find((f) => f.key === `family/${m.id}/nickname`)?.level).toBe("detail");
      expect(fam.find((f) => f.key === `family/${m.id}/sex`)?.level).toBe(m.kind === "self" ? "simple" : m.kind === "child" ? undefined : "detail");
      expect(fam.some((f) => f.key === `family/${m.id}/leaves`)).toBe(false);
    }
    const child = members(wh).find((m) => m.kind === "child")!;
    const leaves = fieldOf(wh, "education", `family/${child.id}/leaves`);
    expect(leaves.level).toBe("detail");
    expect(leaves.label).toContain("独立の時期");
    // 書くと家族の値（member.leaves）が変わる
    const w2 = leaves.set(wh, "2045-03");
    expect(members(w2).find((m) => m.id === child.id)!.leaves).toEqual({ at: "2045-03" });
  });
});

describe("働き方と収入: 年収（賞与込み）の1欄", () => {
  const setup = () => {
    const wh = open("salariedCoupleTwoKids");
    const self = members(wh).find((m) => m.kind === "self")!;
    const total = fieldOf(wh, "work", `work/${self.id}/now/total`);
    return { wh, self, total };
  };

  it("標準は年収（賞与込み）だけ。年収（賞与を除く）・賞与・住民税は詳細", () => {
    const { wh, self, total } = setup();
    expect(total.level).toBe("simple");
    const now = fieldsOf(wh, "work").filter((f) => f.key.startsWith(`work/${self.id}/now/`) || f.key === `work/${self.id}/residentTax`);
    expect(now.filter((f) => f.level === "simple").map((f) => f.key.split("/").at(-1))).toEqual(["type", "total"]);
    expect(fieldOf(wh, "work", `work/${self.id}/residentTax`).level).toBe("detail");
    const pid = periodOf(wh, self.id).id;
    expect(fieldOf(wh, "work", `work/period/${pid}/annual`).level).toBe("detail");
    expect(fieldOf(wh, "work", `work/period/${pid}/bonus`).level).toBe("detail");
  });

  it("見せる値は年収と賞与の合計。同じ合計を入れ直しても世帯を変えない", () => {
    const { wh, self, total } = setup();
    const s = periodOf(wh, self.id).salary!;
    expect(total.get(wh).value).toBe(s.annual.value! + s.bonus!.value!);
    expect(total.set(wh, total.get(wh).value)).toBe(wh);
  });

  it("確定の賞与があれば、賞与はそのままで年収＝合計−賞与", () => {
    const { wh, self, total } = setup();
    const bonus = periodOf(wh, self.id).salary!.bonus!;
    const w = total.set(wh, 9000000);
    const s = periodOf(w, self.id).salary!;
    expect(s.bonus).toEqual(bonus);
    expect(s.annual).toMatchObject({ value: 9000000 - bonus.value!, state: "confirmed" });
  });

  it("賞与が推定（確定でない）なら、賃金の統計の割合で分ける。賞与は推定の印（出し方 derived）、年収は確定。統計を入れ直しても書き換えない", () => {
    const { wh: wh0, self, total } = setup();
    const wh = mutate(wh0, (hh) => {
      const p = (hh.employmentPeriods ?? []).find((x) => x.member === self.id)!;
      p.salary!.bonus = { value: 1, state: "estimated", origin: { kind: "auto" }, estimate: { method: "statistic", basis: "統計" } } as never;
    });
    const w = total.set(wh, 8000000);
    const s = periodOf(w, self.id).salary!;
    const est = salaryEstimate(periodOf(wh, self.id).type, self.sex, { age: salaryAge(self, periodOf(wh, self.id), wh.request.input.baseMonth) })!;
    const want = Math.round((8000000 * est.bonus.value) / (est.annual.value + est.bonus.value) / 1000) * 1000;
    expect(s.bonus).toMatchObject({ value: want, state: "estimated", origin: { kind: "auto" }, estimate: { method: BONUS_SPLIT_METHOD } });
    expect(s.annual).toMatchObject({ value: 8000000 - want, state: "confirmed", origin: { kind: "manual" } });
    expect(total.get(w).value).toBe(8000000);
    expect(total.get(w).hint).toContain("推定");
    expect(fieldStatus(total, w).status).toBe("confirmed");
    // 年収は確定でも賞与が推定なので、欄の名前の横に「推定」の印（押すと賞与の根拠）
    expect(total.get(w).partEstimated).toMatch(/^賞与は年収（賞与込み）800万円を、賃金の統計/);
    const html = renderToString(h(Field, { f: total, wh: w, onEdit: () => {} }));
    expect(html).toMatch(/class="help-btn help-mark badge est"[^>]*data-state="estimated">推定</);
    expect(html).toContain("推定: 賞与は年収（賞与込み）800万円を");
    // 賞与も確定なら印は出さない
    expect(total.get(wh0).partEstimated ?? null).toBeNull();
    expect(() => preview(w.request)).not.toThrow();
  });

  it("空にすると年収・賞与とも統計の推定。「この値にする」は合計をそのまま確定にする（推定のままの賞与もその値のまま確定）", () => {
    const { wh, self, total } = setup();
    const blank = total.set(wh, null);
    const s = periodOf(blank, self.id).salary!;
    expect(s.annual.state).toBe("estimated");
    expect(s.bonus!.state).toBe("estimated");
    expect(fieldStatus(total, blank).status).toBe("estimated");
    const shown = total.get(blank).value;
    const conf = applyStateOp(blank, total, "confirm");
    expect(fieldStatus(total, conf).status).toBe("confirmed");
    expect(total.get(conf).value).toBe(shown);
    expect(periodOf(conf, self.id).salary!.bonus).toMatchObject({ value: s.bonus!.value, state: "confirmed", estimate: { basis: (s.bonus as { estimate?: { basis?: string } }).estimate?.basis } });
    expect(total.get(conf).partEstimated ?? null).toBeNull();
    // 箱の読み書きは往復で同じ合計
    const box = total.boxed!.read(conf) as { value: number };
    expect((total.boxed!.read(total.boxed!.write(conf, box as never)) as { value: number }).value).toBe(box.value);
  });

  it("役員だけは標準でも月の報酬（年額）と賞与を分けて聞く（まとめた1欄は出さない）", () => {
    const wh = open("executiveOwner");
    const exec = members(wh).find((m) => (wh.request.input.household.employmentPeriods ?? []).some((p) => p.member === m.id && p.type === "executive"))!;
    const simple = simpleFields(wh, "work").filter((f) => f.key.startsWith(`work/${exec.id}/now/`)).map((f) => f.key.split("/").at(-1));
    expect(simple).toEqual(["type", "annual", "bonus"]);
    const annual = fieldOf(wh, "work", `work/${exec.id}/now/annual`);
    expect(annual.label).toContain("月の報酬");
    const w = annual.set(wh, 15000000);
    const p = (w.request.input.household.employmentPeriods ?? []).find((x) => x.member === exec.id && x.type === "executive")!;
    expect(p.salary!.annual).toMatchObject({ value: 15000000, state: "confirmed" });
    expect(p.salary!.bonus!.value).toBe(1200000);
  });

  it("見本の世帯は開いただけでは変わらない（年収・賞与の持ち方はそのまま）", () => {
    const { wh } = setup();
    expect(wh.request.input.household.employmentPeriods).toEqual(modelHousehold("salariedCoupleTwoKids").input.household.employmentPeriods);
  });
});

describe("年金・退職金・基本生活費", () => {
  it("書類から: 加入月数は詳細。退職金の受け取る時期は詳細", () => {
    const wh = open("salariedCoupleTwoKids");
    const rec = wh.request.input.household.pensionRecords![0]!;
    expect(fieldOf(wh, "pension", `pension/${rec.id}/months/basic`).level).toBe("detail");
    expect(fieldOf(wh, "pension", `pension/${rec.id}/months/employee`).level).toBe("detail");
    expect(fieldsOf(wh, "retirement").filter((f) => f.key.endsWith("/paidAt")).every((f) => f.level === "detail")).toBe(true);
  });

  it("伸び方は詳細。段階のうち退職後の段の割合だけ標準", () => {
    const wh = open("salariedCoupleTwoKids");
    const l = wh.request.input.household.livingExpenses![0]!;
    expect(fieldOf(wh, "living", `living/${l.id}/growth`).level).toBe("detail");
    const simple = simpleFields(wh, "living").map((f) => f.label);
    expect(simple).toContain("退職後の生活費（今の額に対する割合）");
    const stageValues = fieldsOf(wh, "living").filter((f) => /\/stage\/\d+\/(ratio|monthly)$/.test(f.key));
    expect(stageValues.filter((f) => f.level === "simple")).toHaveLength(1);
  });
});

describe("年金: 推計の区分でも受け取り開始を標準に（構成員の pensionClaim。0078）", () => {
  const setup = () => {
    const req = structuredClone(modelHousehold("salariedCoupleTwoKids")) as EngineRequest;
    const self = req.input.household.members.find((m) => m.kind === "self")!;
    req.input.household.pensionRecords = (req.input.household.pensionRecords ?? []).filter((r) => r.member !== self.id);
    const wh = fromRequest(req);
    return { wh, self, f: fieldOf(wh, "pension", `pension/${self.id}/estimate/claim`) };
  };
  const pensionSum = (req: EngineRequest, from: number, to: number) => preview(req).table.filter((c) => c.row.startsWith("cf.income.pension") && c.year >= from && c.year <= to).reduce((s, c) => s + c.amount, 0);

  it("推計の人に受け取り開始の欄（標準）。空は65歳。70歳にすると構成員に持ち、計算は70歳から（65〜69歳の年金が0円になる）", () => {
    const { wh, self, f } = setup();
    expect(f.level).toBe("simple");
    expect(f.get(wh).value).toBe(65);
    const w = f.set(wh, 70);
    const m = w.request.input.household.members.find((x) => x.id === self.id)!;
    expect(m.pensionClaim).toEqual({ basic: { at: "2051-08" }, employee: { at: "2051-08" } });
    expect(f.get(w).value).toBe(70);
    const y65 = Number(self.birth.birthYearMonth.slice(0, 4)) + 66;
    expect(pensionSum(wh.request, y65, y65 + 2)).toBeGreaterThan(pensionSum(w.request, y65, y65 + 2));
    // 65歳に戻すと欄を消す（省略は65歳）
    expect(f.set(w, 65).request.input.household.members.find((x) => x.id === self.id)!.pensionClaim).toBeUndefined();
  });

  it("推計から書類からに切り替えると、受け取り開始を記録に引き継ぐ。結果のタブの受け取り開始も推計の人に使える", () => {
    const { wh, self, f } = setup();
    const w = f.set(wh, 68);
    const doc = fieldOf(w, "pension", `pension/${self.id}/mode`).set(w, "document");
    const rec = doc.request.input.household.pensionRecords!.find((r) => r.member === self.id)!;
    expect(rec.claim).toEqual(w.request.input.household.members.find((x) => x.id === self.id)!.pensionClaim);
    expect(readLevers(w.request, self.id).pensionAge).toBe(68);
    const moved = applyLevers(wh.request, self.id, { pensionAge: 67 });
    expect(moved.input.household.members.find((x) => x.id === self.id)!.pensionClaim?.basic).toEqual({ at: "2048-08" });
  });
});

describe("子ども・教育", () => {
  it("小学校・高校の公立・私立と大学の系統・学校外の費用の入れ方は詳細。中学・大学の公立・私立と進路の型は標準", () => {
    const wh = open("salariedCoupleTwoKids");
    const fs = fieldsOf(wh, "education");
    const goals = wh.request.input.household.goals!.filter((g) => g.kind === "education");
    for (const g of goals)
      g.education!.stages.forEach((s, i) => {
        const sector = fs.find((f) => f.key === `edu/${g.id}/stage/${i}/sector`);
        if (sector === undefined) return;
        expect(sector.level, s.stage).toBe(s.stage === "elementary" || s.stage === "highSchool" ? "detail" : "simple");
        if (s.stage === "university") expect(fs.find((f) => f.key === `edu/${g.id}/stage/${i}/field`)?.level).toBe("detail");
      });
    expect(fs.filter((f) => f.key.endsWith("/outMode")).every((f) => f.level === "detail")).toBe(true);
    expect(fs.filter((f) => f.key.endsWith("/preset")).every((f) => f.level === "simple")).toBe(true);
  });
});

describe("住まい・ローン", () => {
  it("建て方・固定資産税・評価・団信・借りる人・入居の年月は詳細", () => {
    const wh = open("salariedCoupleTwoKids");
    const fs = fieldsOf(wh, "housing");
    for (const tail of ["/style", "/tax", "/valuation/value", "/valuation/builtYear", "/creditLife", "/debtors", "/credit/moveIn"]) {
      const hit = fs.filter((f) => f.key.endsWith(tail));
      expect(hit.length, tail).toBeGreaterThan(0);
      expect(hit.every((f) => f.level === "detail"), tail).toBe(true);
    }
  });

  it("住宅の種類（控除）は入居から13年以内と購入の予定だけ標準", () => {
    const wh = open("salariedCoupleTwoKids");
    const d = wh.request.input.household.debts![0]!;
    const key = fieldsOf(wh, "housing").find((f) => f.label === "住宅の種類（控除）")!.key;
    expect(fieldOf(wh, "housing", key).level).toBe("simple");
    expect(creditActive(wh.request.input.household, d.housing, "2026-10")).toBe(true);
    expect(creditActive(wh.request.input.household, d.housing, "2031-10")).toBe(false);
    const later = mutate(wh, (_h, req) => void (req.input.baseMonth = "2031-10"));
    expect(fieldOf(later, "housing", key).level).toBe("detail");
    // 購入の予定（これから入居）は標準
    const buy = open("housingPurchase");
    expect(fieldsOf(buy, "housing").find((f) => f.label === "住宅の種類（控除）")?.level).toBe("simple");
  });

  it("変動金利の住宅ローンだけ、金利の見込みを標準に1欄。型を選ぶと今から5年ごとの段を置き、読み戻せる。今の金利のままは段を外す", () => {
    const wh = open("salariedCoupleTwoKids");
    const d = wh.request.input.household.debts![0]!;
    const f = fieldOf(wh, "housing", `housing/debt/${d.id}/rateOutlook`);
    expect(f.level).toBe("simple");
    // 見本の段（2031年・2036年）は型と違うので「金利の段階で入れている」
    expect(f.get(wh).value).toBe("custom");
    const up = f.set(wh, "up1");
    const debt = (w: WorkingHousehold) => w.request.input.household.debts!.find((x) => x.id === d.id) as Debt;
    expect(debt(up).rateSchedule.slice(1).map((s) => [s.from.at, s.rate, s.type])).toEqual([
      ["2031-10", "0.0115", "variable"],
      ["2036-10", "0.0165", "variable"],
    ]);
    expect(debt(up).rateSchedule.slice(1).every((s) => typeof s.id === "string")).toBe(true);
    expect(f.get(up).value).toBe("up1");
    expect(rateOutlookOf(up.request.input.household, debt(up), "2027-10")).toBe("up1");
    const flat = f.set(up, "flat");
    expect(debt(flat).rateSchedule).toHaveLength(1);
    expect(f.get(flat).value).toBe("flat");
    expect(() => preview(up.request)).not.toThrow();
    // 固定金利のローンには出さない
    const fixed = open("sampleSelfEmployedFamily");
    expect(fieldsOf(fixed, "housing").some((x) => x.key.endsWith("/rateOutlook"))).toBe(false);
  });
});

describe("保険: 標準の「終わり」", () => {
  it("定期の保険は保障の終わり、終身の保険は払込の終わり、満期・年金のある保険は両方。一時払いは払込の終わりを聞かない", () => {
    expect(endLevels("term", false)).toEqual({ coverage: "simple", premium: "detail" });
    expect(endLevels("wholeLife", false)).toEqual({ coverage: "detail", premium: "simple" });
    expect(endLevels("medical", false)).toEqual({ coverage: "detail", premium: "simple" });
    expect(endLevels("privateAnnuity", false)).toEqual({ coverage: "simple", premium: "simple" });
    expect(endLevels("wholeLife", true)).toEqual({ coverage: "detail", premium: "detail" });
    const wh = open("salariedCoupleTwoKids");
    const simple = simpleFields(wh, "insurance").map((f) => f.label);
    expect(simple).toContain("払込の終わり");
    expect(simple).not.toContain("終わり（保障の終わり）");
  });
});

describe("貯蓄・運用", () => {
  it("預貯金の名義と積立をやめる年齢は詳細。利回りの説明に「費用を引いた後」", () => {
    const wh = open("salariedCoupleTwoKids");
    const fs = fieldsOf(wh, "savings");
    const dep = wh.request.input.household.accounts!.find((a) => a.kind === "deposit")!;
    const nisa = wh.request.input.household.accounts!.find((a) => a.kind === "nisa")!;
    expect(fs.find((f) => f.key === `sav/${dep.id}/owner`)?.level).toBe("detail");
    expect(fs.find((f) => f.key === `sav/${nisa.id}/owner`)?.level).toBe("simple");
    expect(fs.find((f) => f.key === "sav/stopAge")?.level).toBe("detail");
    expect(fs.find((f) => f.key === `sav/${nisa.id}/rate`)?.help).toContain("費用（信託報酬など）を引いた後");
  });

  it("画面: 標準では積立をやめる年齢を読むだけ・預貯金の名義を選ばない。詳細では入れられる", () => {
    const wh = open("salariedCoupleTwoKids");
    const simple = renderToString(h(SavingsPanel, { wh, level: "simple", onEdit: () => undefined }));
    const detail = renderToString(h(SavingsPanel, { wh, level: "detail", onEdit: () => undefined }));
    expect(simple).toContain("data-stop-age-read");
    expect(simple).not.toContain('data-num="stop-age"');
    expect(detail).not.toContain("data-stop-age-read");
    // 名義を選ぶ部品: 標準は預貯金の外の口座（NISA）だけ、詳細は全部の口座
    const owners = (html: string) => (html.match(/aria-label="[^"]*の名義"/g) ?? []).length;
    expect(owners(simple)).toBe(1);
    expect(owners(detail)).toBe(2);
  });
});

describe("ライフイベント・車・相続・前提条件", () => {
  it("ライフイベントの行の優先度・見込みは詳細（ほかのカードの行は標準のまま）。相続・贈与の行の名前は詳細", () => {
    const wh = open("salariedCoupleTwoKids");
    const ev = fieldsOf(wh, "events");
    const pri = ev.filter((f) => f.key.endsWith("/priority") || f.key.endsWith("/likelihood"));
    expect(pri.length).toBeGreaterThan(0);
    expect(pri.every((f) => f.level === "detail")).toBe(true);
    const inh = open("parentMoney");
    const names = fieldsOf(inh, "inheritance").filter((f) => f.label === "名前");
    expect(names.every((f) => f.level === "detail")).toBe(true);
  });

  it("車のローンの頭金・年数・金利は詳細。表の最後の年は、年で入れる欄も年齢で入れる欄も詳細", () => {
    const wh = open("dualAssetsTwoKids");
    const loanFields = fieldsOf(wh, "car").filter((f) => /\/(downRate|loanYears|rate)$/.test(f.key) && f.item === "car.loan");
    expect(loanFields.every((f) => f.level === "detail")).toBe(true);
    expect(fieldOf(wh, "assumptions", "assume/endYear").level).toBe("detail");
    const byAge = fieldsOf(wh, "assumptions").filter((f) => f.key.startsWith("assume/endYear/age/"));
    expect(byAge.length).toBe(2);
    expect(byAge.every((f) => f.level === "detail")).toBe(true);
  });
});
