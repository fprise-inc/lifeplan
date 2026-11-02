// 保険のカード（0055）: 簡易の5欄とひな形の推定・保険料と保障の額の未入力・種類を変えたときの入れ直し・学資保険・医療保険の手術・
// 逓減定期・家族特約・円の目安の形・解約返戻金・受取人・保険料と解約返戻金の行・病気の想定・古い世帯・
// 区画から移したもの（万一のタブの大きな病気の内訳・保険が切れる年の気づき・確かめの一覧の医療保険・がん保険の重なり）
import { describe, expect, it } from "vitest";
import type { InsuranceContract } from "../src/engine/types.ts";
import { contractLabels, illnessBenefitNote, illnessBenefits, lapseInsights } from "../src/workspace/contingency/insuranceLines.ts";
import { protectionChart, scenarioModel } from "../src/workspace/contingency/present.ts";
import { baseRequest, defaultYear, protectionRequest, scenarioRequest, scenarios } from "../src/workspace/contingency/requests.ts";
import { contingencyInputSections } from "../src/workspace/contingency/inputs.ts";
import { h } from "preact";
import { renderToString } from "preact-render-to-string";
import { ackedRows, checkList, checkCounts } from "../src/workspace/input/checkRows.ts";
import { CheckList, passesFilter } from "../src/workspace/input/CheckList.tsx";
import { readNoticeAcks, setNoticeAck } from "../src/workspace/input/noticeAck.ts";
import { allFields, type FieldDef } from "../src/workspace/input/form.ts";
import { fromRequest, type WorkingHousehold } from "../src/workspace/input/household.ts";
import { insuranceRequest, insuranceView } from "../src/workspace/input/insuranceView.ts";
import { buildStage } from "../src/workspace/input/stages/index.ts";
import { actionUnits, choiceSections, FREQUENT_HEADING, type GroupOpenState } from "../src/workspace/input/FieldViews.tsx";
import { InputPanel } from "../src/workspace/input/InputPanel.tsx";
import { KINDS } from "../src/workspace/input/insuranceKinds.ts";
import { ADD_CHOICE, addKey } from "../src/workspace/input/stages/insurance.ts";
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
  it("保険料と保障の額は目安を作らず未入力の警告。終わり・払込の終わり・控除の区分・契約年月は推定（ひな形の既定の値）", () => {
    const wh = action(family(), "ins/add");
    const c = contract(wh);
    expect(c).toMatchObject({ template: "insurance.term", subtype: "term", premium: { amount: 0, frequency: "monthly" }, deductionCategory: { type: "general", regime: "new" } });
    expect(c.coverages?.map((x) => `${x.role}:${x.benefit}:${x.amount}`)).toEqual(["main:death:0"]);
    expect(status(wh, "/premium").status).toBe("missing");
    expect(status(wh, "/main").status).toBe("missing");
    expect(status(wh, "/end")).toMatchObject({ status: "estimated", basis: "ひな形の既定の値（定期保険: 65歳）" });
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

describe("保険の入力項目の区画から移したもの（0055 の追記）: 万一のタブの内訳と気づき・確かめの一覧の注意", () => {
  it("大きな病気の場面: 内訳の「保険金・給付金」に契約ごと・給付ごとの額（計算の結果の額と同じ）と、数え方の一文", () => {
    let wh = action(family(), "ins/addMedical");
    wh = set(wh, "/main", 10000);
    wh = action(wh, "/addCoverage");
    const cid = contract(wh).coverages!.at(-1)!.id;
    wh = set(wh, `/cov/${cid}/benefit`, "cancerLump");
    wh = set(wh, `/cov/${cid}/amount`, 1000000);
    const sc = scenarios(wh).find((s) => s.kind === "illness" && s.member === self(wh).id)!;
    const year = wh.contingency.year ?? defaultYear(wh.request);
    const result = preview(scenarioRequest(wh, sc, year));
    const none = preview(baseRequest(wh.request));
    const details = illnessBenefits(wh, sc, year, result, none);
    expect(details).toEqual([{ label: "医療保険 1（ご本人）", parts: ["入院 20日 20万円", "手術 1回 10万円", "がん一時金 100万円"], firstYear: expect.any(Number), total: 1300000 }]);
    const m = scenarioModel({ req: wh.request, scenario: sc, year, result, none, targetAge: 95, choice: undefined, benefits: { details, note: illnessBenefitNote(wh) } });
    const row = m.breakdown.rows.find((r) => r.label === "保険金・給付金")!;
    expect(row.total).toBe(1300000);
    expect(row.details).toEqual(details);
    expect(m.breakdown.note).toContain("がん・入院20日・手術1回");
    // 限度日数で止まる・がん一時金は出ない（病気の種類を変える）
    const wh2: WorkingHousehold = { ...wh, contingency: { ...wh.contingency, illness: { disease: "other", hospitalDays: 90, surgeries: 0 } } };
    const d2 = illnessBenefits(wh2, sc, year, preview(scenarioRequest(wh2, sc, year)), none);
    expect(d2.map((d) => [d.parts, d.total])).toEqual([[["入院 60日 60万円"], 600000]]);
    // 死亡の場面には出さない
    const death = scenarios(wh).find((s) => s.kind === "death")!;
    const dm = scenarioModel({ req: wh.request, scenario: death, year, result: preview(scenarioRequest(wh, death, year)), none, targetAge: 95, choice: undefined, benefits: { details, note: "" } });
    expect(dm.breakdown.rows.some((r) => r.details !== undefined)).toBe(false);
    expect(dm.breakdown.note).toBeNull();
  });

  it("必要保障額の推移の気づき: 保険が切れる年と、その年の不足", () => {
    let wh = action(family(), "ins/add");
    wh = set(wh, "/premium", 3000);
    wh = set(wh, "/main", 10000000);
    const me = self(wh).id;
    const r = preview(protectionRequest(wh, me));
    const list = lapseInsights(r.protection!, me, contractLabels(wh));
    expect(list.length).toBe(1);
    const y = list[0]!.year;
    const py = r.protection!.members.find((m) => m.member === me)!.years.find((x) => x.year === y)!;
    const short = py.needWithAssets - py.coverage;
    expect(list[0]!.text).toBe(short > 0 ? `${y}年に定期保険 1（ご本人）が切れ、その年の不足は${Math.round(short / 10000).toLocaleString("ja-JP")}万円` : `${y}年に定期保険 1（ご本人）が切れます（その年も必要保障額は満たしています）`);
    expect(protectionChart(protectionRequest(wh, me), r.protection!, r, me, list)!.insights).toEqual(list);
  });

  it("確かめの一覧: 同じ方の医療保険・がん保険が2本以上なら確かめの注意（1本なら出さない）", () => {
    let wh = action(family(), "ins/addMedical");
    const overlap = (w: WorkingHousehold) => checkList(w).filter((r) => r.kind === "notice" && r.id.startsWith("notice:insurance/overlap/"));
    expect(overlap(wh)).toEqual([]);
    wh = action(wh, "ins/addMedical");
    const rows = overlap(wh);
    expect(rows.map((r) => [r.card, r.label])).toEqual([["insurance", "ご本人の医療保険が2本"]]);
    expect(rows[0]!.detail).toBe("ご本人の医療保険が2本あります（医療保険 1（ご本人）・医療保険 2（ご本人））。入院・手術の保障が重なっていないか、保険証券で確かめてください");
  });

  describe("確かめの注意の「確認した」（0055・0041 の追記）", () => {
    const overlap = (w: WorkingHousehold) => checkList(w).filter((r) => r.id.startsWith("notice:insurance/overlap/"));
    const press = (w: WorkingHousehold, rowId: string, key: string) => {
      const r = [...checkList(w), ...ackedRows(w)].find((x) => x.id === rowId);
      const a = r?.actions.find((x) => x.key === key);
      if (a === undefined) throw new Error(`no action ${key} on ${rowId}`);
      return a.run(w);
    };
    const two = () => action(action(family(), "ins/addMedical"), "ins/addMedical");
    const ids = (w: WorkingHousehold) => (w.request.input.household.insuranceContracts ?? []).map((c) => c.id);

    it("「確認した」を押すと、その重なりは確かめの注意に出なくなり、世帯に残る（値と計算は変えない）", () => {
      const wh = two();
      const [row] = overlap(wh);
      expect(row!.actions.map((a) => a.label)).toEqual(["確認した"]);
      const acked = press(wh, row!.id, "ack");
      expect(overlap(acked)).toEqual([]);
      expect(checkCounts(checkList(acked)).notice).toBe(checkCounts(checkList(wh)).notice - 1);
      expect(acked.noticeAcks).toEqual([{ id: row!.id.slice("notice:".length), of: [...ids(wh)].sort(), on: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/) as unknown as string }]);
      expect(acked.request).toEqual(wh.request);
      // 確認した注意の絞り込みに並び、「また出す」で戻る（欄ごと外れる）
      const listed = ackedRows(acked);
      expect(listed.map((r) => [r.id, r.label, r.actions.map((a) => a.label)])).toEqual([[row!.id, "ご本人の医療保険が2本", ["また出す"]]]);
      expect(listed[0]!.detail).toMatch(/^\d{4}-\d{2}-\d{2} に確認しました（ご本人の医療保険が2本あります/);
      const back = press(acked, row!.id, "unack");
      expect(overlap(back).map((r) => r.label)).toEqual(["ご本人の医療保険が2本"]);
      expect("noticeAcks" in back).toBe(false);
      expect(ackedRows(back)).toEqual([]);
    });

    it("重なりの中身（契約の組み合わせ）が変わるとまた出る。同じ組み合わせに戻れば出ない。ほかの方の重なりには当たらない", () => {
      const wh = two();
      const acked = press(wh, overlap(wh)[0]!.id, "ack");
      // 3本目を足すと出る（確認した注意の一覧からは消える）
      const three = action(acked, "ins/addMedical");
      expect(overlap(three).map((r) => r.label)).toEqual(["ご本人の医療保険が3本"]);
      expect(ackedRows(three)).toEqual([]);
      // 3本目を外して前の2本に戻ると、確認したままに読む
      const list = three.request.input.household.insuranceContracts!;
      const removed: WorkingHousehold = { ...three, request: { ...three.request, input: { ...three.request.input, household: { ...three.request.input.household, insuranceContracts: list.slice(0, 2) } } } };
      expect(overlap(removed)).toEqual([]);
      // 3本で確認した後に1本を外す（残る2本は確認した組み合わせと違う）と出る
      const ack3 = press(three, overlap(three)[0]!.id, "ack");
      expect(ack3.noticeAcks).toHaveLength(1);
      const minus: WorkingHousehold = { ...ack3, request: { ...ack3.request, input: { ...ack3.request.input, household: { ...ack3.request.input.household, insuranceContracts: list.slice(1) } } } };
      expect(overlap(minus).map((r) => r.label)).toEqual(["ご本人の医療保険が2本"]);
      // 配偶者の医療保険の重なりは、ご本人の「確認した」に当たらない
      const both = action(action(acked, "ins/addMedical"), "ins/addMedical");
      const cs = both.request.input.household.insuranceContracts!;
      cs[cs.length - 1]!.insured = spouse(both).id;
      cs[cs.length - 2]!.insured = spouse(both).id;
      const rows = overlap(both);
      expect(rows.map((r) => r.label)).toEqual(["配偶者の医療保険が2本"]);
    });

    it("印の読み方: 中身の並びは整えて持ち、形の合わない印・同じ注意の2つ目は捨てる。最後の印を外すと欄ごと外す（保存して読み戻すのは store.test.ts の 0.35 の形）", () => {
      const wh = two();
      const acked = press(wh, overlap(wh)[0]!.id, "ack");
      const a = acked.noticeAcks![0]!;
      expect(readNoticeAcks([{ ...a, of: [...a.of].reverse() }, a, { id: "x", of: [], on: a.on }, { id: "y", of: ["c"], on: "昨日" }, null])).toEqual([a]);
      expect("noticeAcks" in setNoticeAck(acked, a.id, a.of, null)).toBe(false);
      // 付け直すと置き換える（同じ注意の印は1つ）
      expect(setNoticeAck(acked, a.id, [...a.of, "z"], "2026-10-30").noticeAcks).toEqual([{ id: a.id, of: [...a.of, "z"].sort(), on: "2026-10-30" }]);
    });

    it("確かめの一覧の画面: 注意に「確認した」、確認した注意は状態の絞り込み「確認した注意」に並び「また出す」がある", () => {
      const wh = two();
      const html = renderToString(h(CheckList, { wh, onEdit: () => undefined, onOpen: () => undefined }));
      expect(html).toContain('data-ck-action="ack"');
      expect(html).not.toContain('value="acked"');
      const acked = press(wh, overlap(wh)[0]!.id, "ack");
      const html2 = renderToString(h(CheckList, { wh: acked, onEdit: () => undefined, onOpen: () => undefined }));
      expect(html2).not.toContain('data-ck-action="ack"');
      expect(html2).toContain('value="acked"');
      expect(html2).toContain("確認した注意 1");
      // 絞り込み「確認した注意」ではいつもの行を出さない
      expect(checkList(acked).every((r) => !passesFilter(r, { card: "", kind: "acked", origin: "", certainty: "" }, () => false))).toBe(true);
    });
  });
});

describe("追加のボタンは「＋ 保険契約を足す」の1つ（0055 の追記 2026-11-02）", () => {
  const addActions = (wh: WorkingHousehold) => stage(wh).sections.flatMap((x) => x.actions).filter((a) => a.choice?.key === ADD_CHOICE.key);
  const panel = (wh: WorkingHousehold, level: "simple" | "detail") => {
    const groupOpen: GroupOpenState = { isOpen: () => false, toggle: () => undefined };
    return renderToString(h(InputPanel, { wh, itemId: "insurance", level, onLevel: () => undefined, onSave: () => undefined, onClose: () => undefined, groupOpen }));
  };

  it("区画のボタンは1つにまとまり、前の4つのボタン（定期保険・医療保険・学資保険・損害保険）の名前は無い", () => {
    const wh = family();
    const units = actionUnits(stage(wh).sections[0]!.actions);
    expect(units).toHaveLength(1);
    const u = units[0]!;
    expect(u.kind).toBe("choice");
    if (u.kind !== "choice") return;
    expect(u.head.label).toBe("＋ 保険契約を足す");
    expect(u.list.map((a) => a.label)).not.toContain("＋ 保険契約（定期保険）");
    for (const level of ["simple", "detail"] as const) {
      const html = panel(wh, level);
      expect(html).toContain(`data-choice="${ADD_CHOICE.key}"`);
      expect(html).toContain("＋ 保険契約を足す");
      expect(html).not.toContain("＋ 保険契約（定期保険）");
      expect(html).not.toContain("＋ 医療保険");
      // 押す前は種類の一覧を出さない
      expect(html).not.toContain('data-action="ins/addMedical"');
    }
  });

  it("一覧は「よく使う」（定期保険・医療保険・学資保険）の後に、死亡の保障・病気・けが・貯める・受け取る・そのほかの見出しで並ぶ", () => {
    const secs = choiceSections(addActions(family()))!;
    expect(secs.map((x) => x.heading)).toEqual([FREQUENT_HEADING, "死亡の保障", "病気・けが", "貯める・受け取る", "そのほか"]);
    const labels = (heading: string) => secs.find((x) => x.heading === heading)!.list.map((a) => a.label);
    expect(labels(FREQUENT_HEADING)).toEqual(["定期保険", "医療保険", "学資保険"]);
    expect(labels("死亡の保障")).toEqual(["定期保険", "逓減定期保険", "収入保障保険", "終身保険", "養老保険", "団体保険（勤務先）"]);
    expect(labels("病気・けが")).toEqual(["医療保険", "がん保険", "三大疾病保険", "就業不能保険", "民間の介護保険"]);
    expect(labels("貯める・受け取る")).toEqual(["学資保険", "個人年金保険", "外貨建て保険（目安）", "変額保険（目安）"]);
    expect(labels("そのほか")).toEqual(["共済（総合・医療）", "損害保険"]);
    // 損害保険は「詳細」のときだけ
    expect(addActions(family()).find((a) => a.label === "損害保険")?.level).toBe("detail");
    expect(addActions(family()).filter((a) => a.label !== "損害保険").every((a) => a.level === "simple")).toBe(true);
    // 子がいなければ学資保険は出さない
    const single = fromRequest(modelHousehold("single25"));
    expect(addActions(single).some((a) => a.label === "学資保険")).toBe(false);
    expect(choiceSections(addActions(single))!.find((x) => x.heading === FREQUENT_HEADING)!.list.map((a) => a.label)).toEqual(["定期保険", "医療保険"]);
    // ほかの「＋」の選択肢（見出しなし）は今までどおりの横の並び
    expect(choiceSections([{ key: "a", label: "この年だけ", level: "simple", run: (w) => w, choice: { key: "x", label: "＋ 月額の変化" } }])).toBeNull();
  });

  it("一覧から選ぶと、その種類の既定で契約を1件足す（全部の種類）", () => {
    const base = family();
    const acts = addActions(base);
    for (const k of KINDS) {
      const a = acts.find((x) => x.key === addKey(k.kind))!;
      expect(a, k.kind).toBeDefined();
      const wh = a.run(base);
      const list = wh.request.input.household.insuranceContracts!;
      expect(list, k.kind).toHaveLength(1);
      expect(list[0], k.kind).toMatchObject({ subtype: k.kind, template: k.template });
      if (k.main !== null) expect(list[0]!.coverages?.find((x) => x.role === "main")?.benefit, k.kind).toBe(k.main.benefit);
    }
    // 前のボタンのキーはそのまま
    expect(["ins/add", "ins/addMedical", "ins/addEducation", "ins/addNonLife"].map((key) => acts.find((a) => a.key === key)?.label)).toEqual(["定期保険", "医療保険", "学資保険", "損害保険"]);
  });

  it("三大疾病保険: 主な保障は三大疾病一時金。保障も払込も終身・介護医療の控除。死亡も出る型は「＋ 保障」で死亡保険金を足す案内", () => {
    let wh = action(family(), "ins/add:threeMajor");
    const c = contract(wh);
    expect(c).toMatchObject({ template: "insurance.medical", subtype: "threeMajor", deductionCategory: { type: "careMedical" } });
    expect(c.coverages?.map((x) => `${x.role}:${x.benefit}:${x.amount}`)).toEqual(["main:threeMajorLump:0"]);
    expect(c.coverages?.[0]?.to).toBeNull();
    expect(c.premium.payUntil).toBeNull();
    expect(status(wh, "/main").status).toBe("missing");
    expect(status(wh, "/end")).toMatchObject({ status: "estimated", basis: "ひな形の既定の値（三大疾病保険: 終身）" });
    expect(fieldOf(wh, "/main").label).toBe("三大疾病一時金");
    expect(fieldOf(wh, "/main").help).toContain("「＋ 保障」で死亡保険金");
    // 計算: がん・心疾患・脳卒中で一時金、そのほかの病気では出ない
    wh = set(wh, "/main", 2000000);
    const received = (w: WorkingHousehold) => {
      const sc = scenarios(w).find((x) => x.kind === "illness" && x.member === self(w).id)!;
      const r = preview(scenarioRequest(w, sc, w.contingency.year ?? defaultYear(w.request)));
      return r.table.filter((t) => t.row === "cf.income.lumpSum.insurance" && t.object === contract(w).id).reduce((n, t) => n + t.amount, 0);
    };
    expect(received(wh)).toBe(2000000);
    expect(received({ ...wh, contingency: { ...wh.contingency, illness: { disease: "heartStroke" } } })).toBe(2000000);
    expect(received({ ...wh, contingency: { ...wh.contingency, illness: { disease: "other", hospitalDays: 10, surgeries: 0 } } })).toBe(0);
    // 死亡も出る型: 「＋ 保障」で死亡保険金を足すと、死亡の場面で受け取る
    wh = action(wh, "/addCoverage");
    const cid = contract(wh).coverages!.at(-1)!.id;
    wh = set(wh, `/cov/${cid}/benefit`, "death");
    wh = set(wh, `/cov/${cid}/amount`, 2000000);
    const death = scenarios(wh).find((x) => x.kind === "death" && x.member === self(wh).id)!;
    const r = preview(scenarioRequest(wh, death, wh.contingency.year ?? defaultYear(wh.request)));
    expect(r.table.filter((t) => t.object === contract(wh).id && t.amount > 0 && t.row.startsWith("cf.income.")).reduce((n, t) => n + t.amount, 0)).toBe(2000000);
  });
});
