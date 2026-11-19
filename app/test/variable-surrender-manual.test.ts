// 変額保険を解約して保障と運用に分けるプランを、今の入力の欄で最後まで組み立てられるか（0233 の4）: 解約の月と解約返戻金（一時所得の税）・
// 掛け捨ての保険・NISA の積立を増やす・解約返戻金をまとめて成長投資枠と課税口座に入れる（年齢の期間で1年に分けて）・枠を超えた分の扱い。
// あわせて、解約の月の近くの説明の欄と、今から始まらない積立の期間が読み直しても残ること（savings/model.ts の writeSteps の直し）
import { h } from "preact";
import { renderToString } from "preact-render-to-string";
import { describe, expect, it } from "vitest";
import { GroupOpen, Section } from "../src/workspace/input/FieldViews.tsx";
import type { EngineRequest, InsuranceContract } from "../src/engine/types.ts";
import { allFields, type FieldDef } from "../src/workspace/input/form.ts";
import { fromRequest, mutate, type WorkingHousehold } from "../src/workspace/input/household.ts";
import { kindDef } from "../src/workspace/input/insuranceKinds.ts";
import { nisaHitOf, setInvestment, stepsOf, writeSteps } from "../src/workspace/input/savings/model.ts";
import { buildStage } from "../src/workspace/input/stages/index.ts";
import { newContract, surrenderNoteText } from "../src/workspace/input/stages/insurance.ts";
import { SURRENDER_CAUTIONS, SURRENDER_RATE_NOTE } from "../../report/src/variableSurrender.ts";
import { modelHousehold, preview } from "./helpers.ts";

const V = "5d0c2f9e-6a1b-4c3d-9e8f-0a1b2c3d4e5f";
const NISA = "67ddce00-82f5-4e75-8c85-3228f60d7030";

/** 会社員の夫婦と子2人（ご本人 1981年7月生まれ・NISA 月1万円）に、2016年4月から月2万円・65歳まで払う変額保険（目安の形・基本保険金額1000万円） */
function family(template = "insurance.variable"): WorkingHousehold {
  const req = modelHousehold("salariedCoupleTwoKids");
  const self = req.input.household.members.find((m) => m.kind === "self")!;
  req.input.household.insuranceContracts = [
    {
      id: V,
      template,
      subtype: template === "insurance.variable" ? "variable" : "foreignCurrency",
      policyholder: self.id,
      insured: self.id,
      contractDate: "2016-04",
      currency: "JPY",
      premium: { amount: 20000, frequency: "monthly", payUntil: { memberAge: { member: self.id, years: 65, months: 0 } } },
      deductionCategory: { type: "general", regime: "new" },
      coverages: [{ id: "0c5b7e4d-bf60-4182-8d34-5f6071829304", role: "main", benefit: "death", amount: 10000000, from: { at: "2016-04" }, to: null }],
      simple: { estimate: true },
    },
  ];
  return fromRequest(req);
}
const stage = (wh: WorkingHousehold) => buildStage("insurance", wh);
const fieldOf = (wh: WorkingHousehold, key: string): FieldDef => {
  const f = allFields(stage(wh)).find((x) => x.key === key);
  if (f === undefined) throw new Error(`no field ${key}`);
  return f;
};
const set = (wh: WorkingHousehold, key: string, v: Parameters<FieldDef["set"]>[1]) => fieldOf(wh, key).set(wh, v);
const contract = (wh: WorkingHousehold, id = V): InsuranceContract => wh.request.input.household.insuranceContracts!.find((c) => c.id === id)!;
const sum = (req: EngineRequest, f: (c: { row: string; year: number; object?: string }) => boolean) => preview(req).table.reduce((s, c) => (f(c) ? s + c.amount : s), 0);
const self = (wh: WorkingHousehold) => wh.request.input.household.members.find((m) => m.kind === "self")!;

/** (a) 2027年1月に解約し、解約の月の解約返戻金を入れる */
const surrender = (wh: WorkingHousehold, value: number) => set(set(wh, `ins/${V}/surrender`, { at: "2027-01" }), `ins/${V}/sv/amount`, value);

describe("(a) 変額保険に解約の月を入れる", () => {
  it("解約の月の解約返戻金を入れると、その月に受け取り、保険料が止まる", () => {
    const wh = surrender(family(), 3000000);
    // 2016年4月から2027年1月までに終わった保険年度は10
    expect(contract(wh).schedule?.rows).toEqual([{ policyYear: 10, surrenderValue: 3000000 }]);
    expect(sum(wh.request, (c) => c.row === "cf.income.lumpSum.surrender" && c.year === 2027)).toBe(3000000);
    expect(sum(wh.request, (c) => c.row.startsWith("cf.expense.insurance") && c.object === V && c.year === 2028)).toBe(0);
  });

  it("払込総額（129か月×2万円＝258万円）を上回る分は一時所得（特別控除50万円・2分の1）で税が増え、下回れば増えない", () => {
    const tax = (wh: WorkingHousehold) => sum(wh.request, (c) => (c.row.startsWith("cf.taxSi.incomeTax") || c.row.startsWith("cf.taxSi.residentTax")) && c.year >= 2027 && c.year <= 2028);
    const under = tax(surrender(family(), 2500000));
    expect(tax(surrender(family(), 3000000))).toBe(under);
    expect(tax(surrender(family(), 4000000))).toBeGreaterThan(under);
  });

  it("解約の月の近くに、利回りをそろえる一言と注意の4つ（変額保険だけ。外貨建て保険・解約しない契約には出さない）", () => {
    const has = (wh: WorkingHousehold) => stage(wh).sections.some((s) => s.groups.some((g) => g.info?.text === surrenderNoteText()));
    expect(has(family())).toBe(false);
    const wh = surrender(family(), 3000000);
    expect(has(wh)).toBe(true);
    const g = stage(wh).sections.flatMap((s) => s.groups).find((x) => x.info?.text === surrenderNoteText())!;
    expect(g.placeIn).toEqual({ group: `ins/${V}`, after: `ins/${V}/surrender` });
    expect(surrenderNoteText().startsWith(SURRENDER_RATE_NOTE)).toBe(true);
    for (const t of SURRENDER_CAUTIONS) expect(surrenderNoteText()).toContain(t);
    expect(has(set(family("insurance.foreignCurrency"), `ins/${V}/surrender`, { at: "2027-01" }))).toBe(false);
  });

  it("解約の月の欄と同じ出し方: 標準で契約の「▸ 詳しく」を開いたときと詳細で、解約の月のすぐ後に出る。標準で閉じているときは出ない", () => {
    const wh = surrender(family(), 3000000);
    const sec = stage(wh).sections.find((s) => s.groups.some((g) => g.key === `ins/${V}`))!;
    const render = (level: "simple" | "detail", open: boolean) =>
      renderToString(h(GroupOpen.Provider, { value: { isOpen: (key: string) => open && key === `ins/${V}`, toggle: () => undefined } }, h(Section, { section: sec, wh, level, onEdit: () => undefined })));
    const at = (html: string) => ({ field: html.indexOf("解約の月"), note: html.indexOf("解約するときの注意") });
    for (const html of [render("simple", true), render("detail", false)]) {
      const p = at(html);
      expect(p.field).toBeGreaterThanOrEqual(0);
      expect(p.note).toBeGreaterThan(p.field);
      // 解約の月の欄の後、次の欄（解約の月の解約返戻金）の前
      expect(html.indexOf("解約の月の解約返戻金")).toBeGreaterThan(p.note);
    }
    const closed = render("simple", false);
    expect(closed).not.toContain("解約するときの注意");
  });
});

describe("(b)〜(d) 掛け捨ての保険・NISA の積立・解約返戻金をまとめて入れる", () => {
  /** (b) 定期保険を2027年1月から65歳まで、月4,000円・死亡保険金1000万円 */
  function withTerm(wh0: WorkingHousehold): WorkingHousehold {
    let id = "";
    let wh = mutate(wh0, (h, req) => {
      const c = newContract(h, req.input.baseMonth, kindDef("term")!)!;
      c.contractDate = "2027-01";
      id = c.id;
      (h.insuranceContracts ??= []).push(c);
    });
    wh = set(wh, `ins/${id}/premium`, 4000);
    wh = set(wh, `ins/${id}/main`, 10000000);
    return wh;
  }
  /** (c)(d) NISA: つみたて投資枠を46歳から月2.6万円に、成長投資枠に46歳の1年だけ月 lump/12 円（解約返戻金をまとめて入れる） */
  function withNisa(wh: WorkingHousehold, lumpPerMonth: number): WorkingHousehold {
    return mutate(wh, (h, req) => {
      const a = h.accounts!.find((x) => x.id === NISA)!;
      writeSteps(h, req.input.baseMonth, a, "tsumitate", [{ fromAge: 45, monthly: 10000 }, { fromAge: 46, monthly: 26000 }], null);
      writeSteps(h, req.input.baseMonth, a, "growth", [{ fromAge: 45, monthly: 0 }, { fromAge: 46, monthly: lumpPerMonth }, { fromAge: 47, monthly: 0 }], null);
    });
  }

  it("全部を入れたプランが計算でき、成長投資枠に46歳の1年（2027年7月〜2028年6月）だけ入る", () => {
    const wh = withNisa(withTerm(surrender(family(), 2400000)), 200000);
    const r = preview(wh.request);
    const growth = (y: number) => r.table.filter((c) => c.row === "cf.transfer.nisa.growth" && c.year === y).reduce((s, c) => s + c.amount, 0);
    expect(growth(2027)).toBe(6 * 200000);
    expect(growth(2028)).toBe(6 * 200000);
    expect(growth(2029)).toBe(0);
    const term = contract(wh, wh.request.input.household.insuranceContracts!.find((c) => c.template === "insurance.term")!.id);
    expect(r.table.filter((c) => c.row.startsWith("cf.expense.insurance") && c.object === term.id && c.year === 2028).reduce((s, c) => s + c.amount, 0)).toBe(48000);
  });

  it("今から始まらない成長投資枠の期間は、読み直しても46歳から（前は0円の期間を捨てて、今から始まる形に変わった）", () => {
    const wh = withNisa(family(), 200000);
    const h = wh.request.input.household;
    const a = h.accounts!.find((x) => x.id === NISA)!;
    expect(stepsOf(h, wh.request.input.baseMonth, a, "growth")).toEqual([
      { fromAge: 45, monthly: 0 },
      { fromAge: 46, monthly: 200000 },
      { fromAge: 47, monthly: 0 },
    ]);
    // 読み直して書き戻しても同じ
    const again = mutate(wh, (hh, req) => {
      const x = hh.accounts!.find((y) => y.id === NISA)!;
      writeSteps(hh, req.input.baseMonth, x, "growth", stepsOf(hh, req.input.baseMonth, x, "growth"), null);
    });
    expect(again.request.input.household.accounts!.find((x) => x.id === NISA)!.contributions).toEqual(a.contributions);
  });

  it("年240万円を超えてまとめて入れると NISA の枠の知らせが出て、超えた分は「NISA の枠を超えた分」の扱い（預金に残す／課税口座で続ける）", () => {
    // 600万円を46歳の1年で（月50万円）。2027年7月〜12月で300万円になり、成長投資枠の年240万円を超える
    const wh = withNisa(withTerm(surrender(family(), 6000000)), 500000);
    expect(nisaHitOf(wh.request)).toMatchObject({ kind: "annual" });
    const toTaxable = (w: WorkingHousehold) => sum(w.request, (c) => c.row === "cf.transfer.investment" && c.year === 2027);
    expect(toTaxable(wh)).toBe(0);
    const taxable = mutate(wh, (_h, req) => setInvestment(req, { nisaOverflow: "taxable" }));
    expect(toTaxable(taxable)).toBeGreaterThan(0);
    expect(self(wh).birth.birthYearMonth).toBe("1981-07");
  });
});
