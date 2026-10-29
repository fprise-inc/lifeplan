// 保険のカード（0055）: 簡易の5欄とひな形の推定・保険料と保障の額の未入力・種類を変えたときの入れ直し・学資保険・医療保険の手術・
// 逓減定期・家族特約・円の目安の形・解約返戻金・受取人・保険料と解約返戻金の行・病気の想定・古い世帯
import { describe, expect, it } from "vitest";
import type { InsuranceContract } from "../src/engine/types.ts";
import { defaultYear, scenarioRequest, scenarios } from "../src/workspace/contingency/requests.ts";
import { contingencyInputSections } from "../src/workspace/contingency/inputs.ts";
import { checkList } from "../src/workspace/input/checkRows.ts";
import { allFields, type FieldDef } from "../src/workspace/input/form.ts";
import { fromRequest, type WorkingHousehold } from "../src/workspace/input/household.ts";
import { insuranceRequest, insuranceView } from "../src/workspace/input/insuranceView.ts";
import { buildStage } from "../src/workspace/input/stages/index.ts";
import { fieldStatus } from "../src/workspace/input/valueState.ts";
import { modelHousehold, preview } from "./helpers.ts";

const stage = (wh: WorkingHousehold) => buildStage("insurance", wh);
function action(wh: WorkingHousehold, key: string): WorkingHousehold {
  const a = stage(wh)
    .sections.flatMap((s) => [...s.actions, ...s.groups.flatMap((g) => g.actions)])
    .find((x) => x.key === key || x.key.endsWith(key));
  if (a === undefined) throw new Error(`no action ${key}`);
  return a.run(wh);
}
const fields = (wh: WorkingHousehold) => allFields(stage(wh));
function fieldOf(wh: WorkingHousehold, suffix: string, n = 0): FieldDef {
  const f = fields(wh).filter((x) => x.key.endsWith(suffix))[n];
  if (f === undefined) throw new Error(`no field ${suffix}`);
  return f;
}
const set = (wh: WorkingHousehold, suffix: string, v: Parameters<FieldDef["set"]>[1], n = 0) => fieldOf(wh, suffix, n).set(wh, v);
const status = (wh: WorkingHousehold, suffix: string, n = 0) => fieldStatus(fieldOf(wh, suffix, n), wh);
const contract = (wh: WorkingHousehold, n = 0): InsuranceContract => wh.request.input.household.insuranceContracts![n]!;

/** 会社員の夫婦と子2人（保険を外した見本） */
function family(): WorkingHousehold {
  const req = modelHousehold("salariedCoupleTwoKids");
  req.input.household.insuranceContracts = [];
  return fromRequest(req);
}
const self = (wh: WorkingHousehold) => wh.request.input.household.members.find((m) => m.kind === "self")!;
const spouse = (wh: WorkingHousehold) => wh.request.input.household.members.find((m) => m.kind === "spouse")!;

describe("新しい契約（簡易の5欄）", () => {
  it("保険料と保障の額は目安を作らず未入力の警告。終わり・払込の終わり・控除の区分・契約年月は推定（ひな形の標準の値）", () => {
    const wh = action(family(), "ins/add");
    const c = contract(wh);
    expect(c).toMatchObject({ template: "insurance.term", subtype: "term", premium: { amount: 0, frequency: "monthly" }, deductionCategory: { type: "general", regime: "new" } });
    expect(c.coverages?.map((x) => `${x.role}:${x.benefit}:${x.amount}`)).toEqual(["main:death:0"]);
    expect(status(wh, "/premium").status).toBe("missing");
    expect(status(wh, "/main").status).toBe("missing");
    expect(status(wh, "/end")).toMatchObject({ status: "estimated", basis: "ひな形の標準の値（定期保険: 65歳）" });
    expect(status(wh, "/payUntil", 0).status).toBe("estimated");
    expect(status(wh, "/date").status).toBe("estimated");
    expect(status(wh, "/deduction").status).toBe("estimated");
    // 簡易の欄は5つ（払い方を入れて6）
    expect(fields(wh).filter((f) => f.level === "simple" && f.key.startsWith(`ins/${c.id}/`)).map((f) => f.key.split("/").at(-1))).toEqual(["template", "insured", "premium", "freq", "main", "end"]);
    // 確かめの一覧の未入力に出る
    expect(checkList(wh).filter((r) => r.kind === "missing" && r.card === "insurance").map((r) => r.fieldKey?.split("/").at(-1))).toEqual(["premium", "main"]);
    // 計算できる（保険料0円・保障0円）
    expect(() => preview(wh.request)).not.toThrow();
  });

  it("値を打つと未入力の警告が消えて確定になる。終わりを直すと払込の終わり（保障の終わりと同じの推定）もいっしょに動く", () => {
    let wh = action(family(), "ins/add");
    wh = set(wh, "/premium", 4000);
    wh = set(wh, "/main", 20000000);
    expect(status(wh, "/premium").status).toBe("confirmed");
    expect(status(wh, "/main").status).toBe("confirmed");
    wh = set(wh, "/end", { memberAge: { member: self(wh).id, years: 60, months: 0 } });
    expect(contract(wh).premium.payUntil).toEqual({ memberAge: { member: self(wh).id, years: 60, months: 0 } });
    expect(status(wh, "/end").status).toBe("confirmed");
    expect(status(wh, "/payUntil").status).toBe("estimated");
    const r = preview(wh.request);
    expect(r.table.filter((t) => t.row.startsWith("cf.expense.insurance") && t.year === 2030).reduce((s, t) => s + t.amount, 0)).toBe(48000);
  });

  it("種類を変えると、推定のままの終わり・控除の区分を新しい種類に入れ直し、確定の値は変えない。確定の主な保障で同じ意味の給付は引き継ぐ", () => {
    let wh = action(family(), "ins/add");
    wh = set(wh, "/main", 10000000);
    wh = set(wh, "/template", "wholeLife");
    const c = contract(wh);
    expect(c.coverages?.[0]).toMatchObject({ benefit: "death", amount: 10000000, to: null });
    expect(status(wh, "/end").basis).toContain("終身");
    expect(c.premium.payUntil).toEqual({ memberAge: { member: self(wh).id, years: 65, months: 0 } });
    // 終わりを確定してから種類を変えると、終わりはそのまま
    wh = set(wh, "/end", { memberAge: { member: self(wh).id, years: 80, months: 0 } });
    wh = set(wh, "/template", "term");
    expect(contract(wh).coverages?.[0]?.to).toEqual({ memberAge: { member: self(wh).id, years: 80, months: 0 } });
    // 収入保障に変えると、主な保障は年金月額（未入力）になる
    wh = set(wh, "/template", "incomeProtection");
    expect(contract(wh).coverages?.map((x) => `${x.benefit}:${x.amount}`)).toEqual(["incomeProtection:0"]);
    expect(fieldOf(wh, "/main").label).toBe("年金月額");
    expect(status(wh, "/main").status).toBe("missing");
  });

  it("学資保険は被保険者が末の子・契約者が本人・満期は子の18歳（推定）", () => {
    const wh = action(family(), "ins/addEducation");
    const c = contract(wh);
    const kids = wh.request.input.household.members.filter((m) => m.kind === "child").sort((a, b) => (a.birth.birthYearMonth < b.birth.birthYearMonth ? 1 : -1));
    expect(c.insured).toBe(kids[0]!.id);
    expect(c.policyholder).toBe(self(wh).id);
    expect(c.coverages?.[0]).toMatchObject({ benefit: "maturity", to: { memberAge: { member: kids[0]!.id, years: 18 } } });
    expect(fieldOf(wh, "/main").label).toBe("満期金");
  });

  it("医療保険の手術の額は入院日額の10倍の推定で、推定のままなら入院日額を直すと入れ直す", () => {
    let wh = action(family(), "ins/addMedical");
    wh = set(wh, "/main", 5000);
    const surgery = () => contract(wh).coverages!.find((x) => x.benefit === "surgery")!;
    expect(surgery().amount).toBe(50000);
    wh = set(wh, "/main", 10000);
    expect(surgery().amount).toBe(100000);
    const kc = `/cov/${surgery().id}/amount`;
    expect(fieldStatus(fieldOf(wh, kc), wh).status).toBe("estimated");
    wh = set(wh, kc, 200000);
    wh = set(wh, "/main", 8000);
    expect(surgery().amount).toBe(200000);
  });

  it("損害保険は保険料だけ（主な保障の欄は無く、終わりは保険期間）", () => {
    const wh = action(family(), "ins/addNonLife");
    expect(contract(wh)).toMatchObject({ template: "insurance.nonLife", premium: { frequency: "annual" }, deductionCategory: { type: "none" } });
    expect(contract(wh).coverages).toBeUndefined();
    expect(fields(wh).some((f) => f.key.endsWith("/main"))).toBe(false);
    expect(fieldOf(wh, "/payUntil").label).toBe("保険期間の終わり");
  });
});

describe("逓減定期・家族特約・円の目安の形・解約返戻金", () => {
  it("逓減定期は保険年度ごとの減る形の数表を作り、計算の死亡保障が毎年減る。はじめの額を直すと作り直す", () => {
    let wh = action(family(), "ins/add");
    wh = set(wh, "/template", "decreasingTerm");
    wh = set(wh, "/main", 30000000);
    const c = contract(wh);
    const rows = c.schedule!.rows.filter((r) => r.coverage === c.coverages![0]!.id);
    expect(rows[0]).toMatchObject({ policyYear: 1, deathBenefit: 30000000 });
    expect(rows.every((r, i) => i === 0 || (r.deathBenefit ?? 0) < (rows[i - 1]!.deathBenefit ?? 0))).toBe(true);
    expect(fieldOf(wh, `/cov/${c.coverages![0]!.id}/shape`).get(wh).value).toBe("decreasing");
    const by = (preview(wh.request).summary as { insurance: { byYear: { year: number; object: string; deathBenefit: number }[] } }).insurance.byYear.filter((x) => x.object === c.id);
    expect((by.find((x) => x.year === 2030)?.deathBenefit ?? 0) > (by.find((x) => x.year === 2040)?.deathBenefit ?? 0)).toBe(true);
    wh = set(wh, "/main", 20000000);
    expect(contract(wh).schedule!.rows[0]!.deathBenefit).toBe(20000000);
    wh = set(wh, `/cov/${c.coverages![0]!.id}/shape`, "constant");
    expect(contract(wh).schedule).toBeUndefined();
  });

  it("保障の行の被保険者（家族特約）を配偶者にでき、配偶者の死亡保障として数える", () => {
    let wh = action(family(), "ins/add");
    wh = set(wh, "/main", 10000000);
    wh = action(wh, "/addCoverage");
    const rider = contract(wh).coverages![1]!;
    wh = set(wh, `/cov/${rider.id}/benefit`, "death");
    wh = set(wh, `/cov/${rider.id}/amount`, 3000000);
    wh = set(wh, `/cov/${rider.id}/insured`, spouse(wh).id);
    expect(contract(wh).coverages![1]).toMatchObject({ insured: spouse(wh).id, amount: 3000000 });
    const by = (preview(wh.request).summary as { insurance: { byYear: { year: number; deathBenefit: number; others?: { member: string; deathBenefit: number }[] }[] } }).insurance.byYear.find((x) => x.year === 2030);
    expect(by).toMatchObject({ deathBenefit: 10000000, others: [{ member: spouse(wh).id, deathBenefit: 3000000 }] });
    // 契約の被保険者に戻すと欄を消す
    wh = set(wh, `/cov/${rider.id}/insured`, self(wh).id);
    expect(contract(wh).coverages![1]!.insured).toBeUndefined();
  });

  it("外貨建て・変額は円の目安の形（積立金を伸ばさない）。前の入れ方の契約は確かめの注意と「円の目安の形に直す」", () => {
    let wh = action(family(), "ins/add");
    wh = set(wh, "/main", 5000000);
    wh = set(wh, "/template", "variable");
    expect(contract(wh).simple).toEqual({ estimate: true });
    expect(fieldOf(wh, "/main").label).toBe("死亡保険金（円の目安）");
    wh = set(wh, "/template", "term");
    expect(contract(wh).simple).toBeUndefined();
    // 前の入れ方（積立金を伸ばす）の契約
    const req = structuredClone(wh.request);
    req.input.household.insuranceContracts![0] = { ...req.input.household.insuranceContracts![0]!, template: "insurance.variable", subtype: undefined, simple: { assetClass: "equity.global", loadRate: "0.1" } } as InsuranceContract;
    delete (req.input.household.insuranceContracts![0] as Record<string, unknown>).subtype;
    let old = fromRequest(req);
    expect(fieldOf(old, "/main").get(old).warn).toContain("積立金を前提の利回りで伸ばしています");
    expect(checkList(old).some((r) => r.kind === "notice" && r.detail?.includes("積立金を前提の利回り"))).toBe(true);
    old = action(old, "/toEstimate");
    expect(contract(old).simple).toEqual({ assetClass: "equity.global", loadRate: "0.1", estimate: true });
  });

  it("貯蓄型は返戻率が空なら未入力の警告（保障の明細のある契約だけ）。解約の月の額は数表のその保険年度の行に書く", () => {
    let wh = action(family(), "ins/add");
    wh = set(wh, "/template", "wholeLife");
    expect(status(wh, "/sv/rate").status).toBe("missing");
    wh = set(wh, "/sv/rate", "0.95");
    expect(contract(wh).simple?.returnRate).toBe("0.95");
    wh = set(wh, "/surrender", { at: "2040-04" });
    wh = set(wh, "/sv/amount", 1800000);
    const c = contract(wh);
    expect(c.schedule!.rows).toEqual([{ policyYear: 14, surrenderValue: 1800000 }]);
    expect(c.contractDate).toBe("2025-10");
    const r = preview(wh.request);
    expect(r.table.filter((t) => t.row === "cf.income.lumpSum.surrender" && t.year === 2040).reduce((s, t) => s + t.amount, 0)).toBe(1800000);
  });

  it("受取人は1人を選ぶ（世帯の外の続柄も）。死亡保険金の税は組から読むだけ", () => {
    let wh = action(family(), "ins/add");
    expect(fieldOf(wh, "/tax").get(wh).value).toBe("相続税（死亡保険金の非課税枠の対象）");
    wh = set(wh, "/benef", spouse(wh).id);
    expect(contract(wh).beneficiaries).toEqual([{ member: spouse(wh).id, share: "1" }]);
    wh = set(wh, "/benef", "ext:parent");
    expect(contract(wh).beneficiaries).toEqual([{ external: "parent", share: "1" }]);
    wh = set(wh, "/benef", "");
    expect(contract(wh).beneficiaries).toBeUndefined();
    wh = set(wh, "/holder", spouse(wh).id);
    wh = set(wh, "/benef", spouse(wh).id);
    expect(fieldOf(wh, "/tax").get(wh).value).toBe("所得税・住民税（一時所得）");
  });
});

describe("保険料と解約返戻金の行・病気の想定", () => {
  const computed = (wh: WorkingHousehold) => insuranceView(wh, preview(insuranceRequest(wh)));

  it("保険料の月・年の合計とこれから払う総額。必要保障額は計算しない。貯蓄型でない契約には解約返戻金の行を出さない", () => {
    let wh = action(family(), "ins/add");
    wh = set(wh, "/premium", 3000);
    expect(insuranceRequest(wh).input.protection).toBeUndefined();
    expect(insuranceRequest(wh).input.contingencies).toBeUndefined();
    const v = computed(wh);
    expect(v.premium.monthly).toBe(3000);
    expect(v.premium.annual).toBe(36000);
    expect(v.premium.remaining > 0).toBe(true);
    expect(v.savings).toEqual([]);
  });

  it("貯蓄型の契約だけ、解約返戻金の元本割れを1行（返戻率が空なら未入力の知らせ）", () => {
    let wh = action(family(), "ins/add");
    wh = set(wh, "/template", "wholeLife");
    wh = set(wh, "/premium", 10000);
    expect(computed(wh).savings.map((s) => s.text)).toEqual(["解約返戻金が未入力です（0円で数えています）"]);
    wh = set(wh, "/sv/rate", "0.95");
    const line = computed(wh).savings[0]!;
    expect(line.object).toBe(contract(wh).id);
    expect(line.text).toMatch(/^(\d{4}年まで元本割れ|計算の終わりまで元本割れ)$/);
    wh = set(wh, "/sv/rate", "1.2");
    expect(computed(wh).savings[0]!.text).toMatch(/^(\d{4}年まで元本割れ|元本を上回っています)$/);
  });

  it("病気の想定（がん・入院・手術）で受け取る保険金・給付金を計算エンジンが数える（万一のタブの大きな病気の場面）", () => {
    let wh = action(family(), "ins/addMedical");
    wh = set(wh, "/main", 10000);
    wh = action(wh, "/addCoverage");
    const cid = contract(wh).coverages!.at(-1)!.id;
    wh = set(wh, `/cov/${cid}/benefit`, "cancerLump");
    wh = set(wh, `/cov/${cid}/amount`, 1000000);
    const received = (w: WorkingHousehold) => {
      const sc = scenarios(w).find((s) => s.kind === "illness")!;
      const r = preview(scenarioRequest(w, sc, w.contingency.year ?? defaultYear(w.request)));
      return r.table.filter((t) => t.row === "cf.income.lumpSum.insurance" && t.object === contract(w).id).reduce((s, t) => s + t.amount, 0);
    };
    // 入院 20日 20万円＋手術 1回 10万円＋がん一時金 100万円
    expect(received(wh)).toBe(1300000);
    // 病気の種類を変える（万一のタブの前提）: 入院 60日（限度日数）
    const wh2: WorkingHousehold = { ...wh, contingency: { ...wh.contingency, illness: { disease: "other", hospitalDays: 90, surgeries: 0 } } };
    expect(received(wh2)).toBe(600000);
  });

  it("万一のタブの大きな病気の想定に病気の種類・入院の日数・手術の回数の欄があり、要求に病気の想定を入れる", () => {
    const wh = family();
    const keys = contingencyInputSections(wh).flatMap((s) => s.groups.flatMap((g) => g.fields.map((f) => f.key)));
    expect(keys).toEqual(expect.arrayContaining(["cg/illness/disease", "cg/illness/hospitalDays", "cg/illness/surgeries"]));
    const sc = scenarios(wh).find((s) => s.kind === "illness")!;
    expect(scenarioRequest(wh, sc, 2027).input.contingencies![0]!.illness).toEqual({ disease: "cancer", hospitalDays: 20, surgeries: 1 });
    const heart: WorkingHousehold = { ...wh, contingency: { ...wh.contingency, illness: { disease: "heartStroke" } } };
    expect(scenarioRequest(heart, sc, 2027).input.contingencies![0]!.illness).toEqual({ disease: "heartStroke", hospitalDays: 30, surgeries: 1 });
  });
});

describe("古い世帯", () => {
  it("開いても書き換えない（欄を読んで同じ値を書き戻しても変わらない）。前のボタンの値は確かめの注意", () => {
    for (const id of ["salariedCoupleTwoKids", "protectionNeed", "insuranceMaturityAnnuity"]) {
      const wh = fromRequest(modelHousehold(id));
      const before = JSON.stringify(wh.request);
      for (const f of fields(wh)) {
        if (f.readOnly !== undefined) continue;
        const v = f.get(wh).value;
        expect(JSON.stringify(f.set(wh, v).request), `${id} ${f.key}`).toBe(before);
      }
      expect(JSON.stringify(wh.request)).toBe(before);
    }
    const req = modelHousehold("salariedCoupleTwoKids");
    req.input.household.insuranceContracts = [
      { id: "00000000-0000-4000-8000-0000000000f1", template: "insurance.term", policyholder: req.input.household.members[0]!.id, insured: req.input.household.members[0]!.id, contractDate: "2025-10", currency: "JPY", premium: { amount: 5000, frequency: "monthly", payUntil: null }, deductionCategory: { type: "general", regime: "new" }, coverages: [{ id: "00000000-0000-4000-8000-0000000000f2", role: "main", benefit: "death", amount: 10000000, from: { at: "2025-10" }, to: null }] },
    ];
    const notices = checkList(fromRequest(req)).filter((r) => r.kind === "notice" && r.card === "insurance").map((r) => r.detail);
    expect(notices.some((d) => d?.includes("死亡保険金 1,000万円"))).toBe(true);
    expect(notices.some((d) => d?.includes("保険料 月5,000円"))).toBe(true);
  });
});
