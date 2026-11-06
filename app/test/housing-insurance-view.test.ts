// 住まい・ローン・保険の見せ方の手直し（0144）: 未入力の警告の欄を入るまで標準に出す共通の決まり、今の残高から入れる住宅ローンの
// 借りた年月と円で入れる毎月の返済額、住まい・ローン・保険の欄の言葉・並び・出し方。直した所が戻ってこないことを確かめる
import { describe, expect, it } from "vitest";
import { h } from "preact";
import { renderToString } from "preact-render-to-string";
import type { Debt, InsuranceContract, Residence } from "../src/engine/types.ts";
import { allFields, raiseFields, type FieldDef, type GroupDef, type Level, type StageDef } from "../src/workspace/input/form.ts";
import { blankHousehold, fromRequest, mutate, type WorkingHousehold } from "../src/workspace/input/household.ts";
import { withProvisionalHousing } from "../src/workspace/input/housingCredit.ts";
import { InputPanel } from "../src/workspace/input/InputPanel.tsx";
import { fieldDomId } from "../src/workspace/input/FieldViews.tsx";
import { InsuranceOverview } from "../src/workspace/input/InsuranceOverview.tsx";
import { readYen } from "../src/workspace/input/units.ts";
import { fieldStatus } from "../src/workspace/input/valueState.ts";
import { buildStage, housingMoneyLevel } from "../src/workspace/input/stages/index.ts";
import { creditEndedText, laterFloatingSteps, switchEntry } from "../src/workspace/input/stages/housingLoans.ts";
import { modelHousehold } from "./helpers.ts";

const BASE = "2026-10";
const noop = () => undefined;
const stageOf = (wh: WorkingHousehold, id: "housing" | "insurance" = "housing") => buildStage(id, wh);
const groups = (wh: WorkingHousehold, id: "housing" | "insurance" = "housing"): GroupDef[] => stageOf(wh, id).sections.flatMap((s) => s.groups);
const panel = (wh: WorkingHousehold, itemId: string, level: Level) => renderToString(h(InputPanel, { wh, itemId, level, onLevel: noop, onSave: noop, onClose: noop, groupOpen: { isOpen: () => false, toggle: noop } }));
function action(wh: WorkingHousehold, key: string, id: "housing" | "insurance" = "housing"): WorkingHousehold {
  const a = stageOf(wh, id)
    .sections.flatMap((x) => [...x.actions, ...x.groups.flatMap((g) => g.actions)])
    .find((x) => x.key === key || x.key.endsWith(key));
  if (a === undefined) throw new Error(`no action ${key}`);
  return withProvisionalHousing(a.run(wh));
}
const hasAction = (wh: WorkingHousehold, key: string, id: "housing" | "insurance" = "housing"): boolean =>
  stageOf(wh, id).sections.some((x) => [...x.actions, ...x.groups.flatMap((g) => g.actions)].some((a) => a.key === key || a.key.endsWith(key)));
function fieldOf(wh: WorkingHousehold, suffix: string, id: "housing" | "insurance" = "housing"): FieldDef {
  const f = allFields(stageOf(wh, id)).find((x) => x.key.endsWith(suffix));
  if (f === undefined) throw new Error(`no field ${suffix}`);
  return f;
}
const maybeField = (wh: WorkingHousehold, suffix: string, id: "housing" | "insurance" = "housing"): FieldDef | undefined => allFields(stageOf(wh, id)).find((x) => x.key.endsWith(suffix));
const set = (wh: WorkingHousehold, suffix: string, v: Parameters<FieldDef["set"]>[1], id: "housing" | "insurance" = "housing"): WorkingHousehold => withProvisionalHousing(fieldOf(wh, suffix, id).set(wh, v));
const optionsOf = (f: FieldDef): { value: string; label: string; group?: string }[] => (f as { options?: { value: string; label: string; group?: string }[] }).options ?? [];
const loan = (wh: WorkingHousehold): Debt => (wh.request.input.household.debts ?? []).find((d) => d.kind === "mortgage")!;
const owned = (wh: WorkingHousehold): Residence => (wh.request.input.household.residences ?? []).find((r) => r.kind === "own")!;
const couple = (): WorkingHousehold => fromRequest(modelHousehold("salariedCoupleTwoKids"));
const contracts = (wh: WorkingHousehold): InsuranceContract[] => wh.request.input.household.insuranceContracts ?? [];

describe("未入力の警告の欄は、入るまで標準に出す（共通の決まり）", () => {
  it("詳細の欄を標準にし、詳細のまとまり・区画なら、まとまり・区画も標準にする（ほかの詳細の欄は今のまま）", () => {
    const f = (key: string, level: Level): FieldDef => ({ key, item: null, label: key, level, kind: "text", get: () => ({ value: null }), set: (w) => w });
    const st: StageDef = {
      id: "housing",
      label: "住まい・ローン",
      lead: "",
      sections: [{ key: "s", title: "s", level: "detail", actions: [], groups: [{ key: "g", level: "detail", actions: [], fields: [f("a", "detail"), f("b", "detail")] }] }],
    };
    expect(raiseFields(st, new Set())).toBe(st);
    const up = raiseFields(st, new Set(["a"]));
    expect(up.sections[0]!.level).toBe("simple");
    expect(up.sections[0]!.groups[0]!.level).toBe("simple");
    expect(up.sections[0]!.groups[0]!.fields.map((x) => x.level)).toEqual(["simple", "detail"]);
  });

  it("持ち家を足しただけ（評価額が未入力）なら、評価額が標準のパネルに出る。入れて開き直すと詳細に戻る", () => {
    let wh = action(blankHousehold(BASE), "housing/addOwn");
    const value = fieldOf(wh, "/valuation/value");
    expect(value.level).toBe("detail");
    expect(fieldStatus(value, wh).status).toBe("missing");
    expect(panel(wh, "housing", "simple")).toContain("持ち家の評価");
    expect(panel(wh, "housing", "simple")).toContain(`id="${fieldDomId(value.key)}"`);
    wh = set(wh, "/valuation/value", 35_000_000);
    expect(fieldStatus(fieldOf(wh, "/valuation/value"), wh).status).not.toBe("missing");
    expect(panel(wh, "housing", "simple")).not.toContain(`id="${fieldDomId(value.key)}"`);
  });
});

describe("今の残高から入れる住宅ローン", () => {
  const balanceLoan = (): WorkingHousehold => {
    const wh = couple();
    return switchEntry(wh, loan(wh).id, "balance");
  };
  it("借りた年月（入居の年月）を標準に1欄。入力例は過去の年月", () => {
    const wh = balanceLoan();
    const f = fieldOf(wh, `${loan(wh).id}/start`);
    expect(f.label).toBe("借りた年月（入居の年月）");
    expect(f.level).toBe("simple");
    expect(f.example).toBe("例: 2018-04");
    expect(fieldOf(wh, `${loan(wh).id}/balanceAsOf`).example).toBe("例: 2025-12");
  });
  it("毎月の返済額は円で入れる欄（書類の数字をそのまま打つ）。「9万」も9万円", () => {
    const wh = balanceLoan();
    const f = fieldOf(wh, `${loan(wh).id}/payment`);
    expect(f.kind).toBe("yen");
    expect((f as { unit?: string }).unit).toBe("yen");
    expect(readYen("72933", "yen")).toMatchObject({ yen: 72933 });
    expect(readYen("9万", "yen")).toMatchObject({ yen: 90000 });
  });
  it("控除の入居の年月は、未入力でも標準に上げない（標準の借りた年月で入れる。同じ欄を2つ並べない）", () => {
    const wh = action(action(blankHousehold(BASE), "housing/addOwn"), "housing/addMortgage");
    const moveIn = fieldOf(wh, `${loan(wh).id}/credit/moveIn`);
    expect(fieldStatus(moveIn, wh).status).toBe("missing");
    expect(moveIn.missingShownBy).toBe(`housing/debt/${loan(wh).id}/start`);
    expect(panel(wh, "housing", "simple")).not.toContain(`id="${fieldDomId(moveIn.key)}"`);
    expect(fieldOf(wh, `${loan(wh).id}/creditSummary`).get(wh).value).toContain("借りた年月（入居の年月）を入れるまで");
  });
  it("借入額から入れるローンは「借入の年月」のまま（今の残高からのときだけ名前を変えて標準に）", () => {
    const wh = couple();
    const f = fieldOf(wh, `${loan(wh).id}/start`);
    expect(f.label).toBe("借入の年月");
    const later = action(action(blankHousehold(BASE), "housing/addPurchase"), "housing/addMortgage");
    const d = (later.request.input.household.debts ?? []).find((x) => (x.start as { at: string }).at > BASE);
    if (d !== undefined) expect(fieldOf(later, `${d.id}/start`).example).toBeUndefined();
  });
});

describe("住宅ローンの欄", () => {
  it("全期間固定なのに後に変動金利の段が残るなら、知らせと「後の金利の段階を外す」", () => {
    let wh = couple();
    wh = mutate(wh, (hh) => {
      const d = hh.debts!.find((x) => x.kind === "mortgage")!;
      d.rateSchedule[0]!.type = "fixed";
    });
    expect(laterFloatingSteps(wh.request.input.household, loan(wh))).toMatch(/年 .*%〔変動金利〕/);
    const st = fieldOf(wh, `${loan(wh).id}/rateType`).get(wh);
    expect(st.warn).toContain("全期間固定なのに、後の金利の段階");
    expect(st.warnFix?.label).toBe("後の金利の段階を外す");
    const fixed = st.warnFix!.run(wh);
    expect(loan(fixed).rateSchedule.every((s) => s.type === "fixed")).toBe(true);
    expect(fieldOf(fixed, `${loan(fixed).id}/rateType`).get(fixed).warn ?? null).toBeNull();
  });
  it("金利の段階で入れている文は、標準では「詳細」で直す、詳細では下の金利の段階で直す", () => {
    const wh = mutate(couple(), (hh) => {
      const d = hh.debts!.find((x) => x.kind === "mortgage")!;
      for (const s of d.rateSchedule) s.type = "fixed";
      d.rateSchedule.push({ ...d.rateSchedule[d.rateSchedule.length - 1]!, id: "c0000000-0000-4000-8000-000000000001", from: { at: "2040-01" } });
    });
    const simple = fieldOf(wh, `${loan(wh).id}/rateSteps`);
    expect(simple.simpleOnly).toBe(true);
    expect(simple.get(wh).value).toContain("「詳細」で直す");
    expect(fieldOf(wh, `${loan(wh).id}/rateStepsDetail`).get(wh).value).toContain("下の金利の段階で直す");
  });
  it("控除の期間が終わったローンは「控除の期間は終わっています」で詳細へ。住宅の種類の「?」の2027・2028年の話は入居が2024年からだけ", () => {
    const wh = mutate(couple(), (hh) => {
      const ev = hh.events!.find((e) => e.kind === "moveIn")!;
      ev.at = { at: "2012-04" };
    });
    const d = loan(wh);
    expect(creditEndedText(wh.request.input.household, d.housing, BASE)).toBe("控除の期間は終わっています（2012年4月入居・2021年まで）");
    const sum = fieldOf(wh, `${d.id}/creditSummary`);
    expect(sum.level).toBe("detail");
    expect(sum.get(wh).value).toBe("控除の期間は終わっています（2012年4月入居・2021年まで）");
    const kind = allFields(stageOf(wh)).find((f) => f.label === "住宅の種類（控除）")!;
    expect(kind.help).not.toContain("2028年");
    // 控除の期間の内（2016年入居の今）は今までどおり
    const now = couple();
    expect(creditEndedText(now.request.input.household, loan(now).housing, BASE)).toBeNull();
    expect(fieldOf(now, `${loan(now).id}/creditSummary`).level).toBe("simple");
  });
  it("「＋ 金利の段階」の既定の時点は、これから借りるローンは借入の月から数える", () => {
    let wh = action(blankHousehold(BASE), "housing/addMortgage");
    wh = set(wh, `${loan(wh).id}/start`, "2029-04");
    const n = loan(wh).rateSchedule.length;
    wh = action(wh, `${loan(wh).id}/addRate`);
    const added = loan(wh).rateSchedule[n]!;
    expect((added.from as { at: string }).at >= "2034-04").toBe(true);
  });
  it("ほかのローンの今の残高の「?」は、ローンの種類で写す書類を変える", () => {
    const card = action(blankHousehold(BASE), "housing/add/cardLoan");
    const d = (card.request.input.household.debts ?? [])[0]!;
    expect(fieldOf(card, `${d.id}/balance`).help).toContain("利用明細");
    const sch = action(blankHousehold(BASE), "housing/add/scholarship");
    const s = (sch.request.input.household.debts ?? [])[0]!;
    expect(fieldOf(sch, `${s.id}/balance`).help).toContain("返還");
  });
  it("配偶者のいる世帯の住宅ローンの名義は標準（ペアローンの入口と並べる）。単身の世帯は詳細", () => {
    const wh = couple();
    expect(fieldOf(wh, `${loan(wh).id}/debtors`).level).toBe("simple");
    const single = action(blankHousehold(BASE), "housing/addMortgage");
    expect(fieldOf(single, `${loan(single).id}/debtors`).level).toBe("detail");
  });
});

describe("住まいの欄", () => {
  it("伸び方の率の欄は「伸び率（年）」。家賃の統計の目安は欄の下でなく「?」の中", () => {
    const rent = action(blankHousehold(BASE), "housing/addRent");
    const g = fieldOf(rent, "/rentGrowth");
    expect(g.label).toBe("家賃の伸び率（年）");
    expect(g.get(rent).hint ?? null).toBeNull();
    const own = action(blankHousehold(BASE), "housing/addOwn");
    expect(fieldOf(own, "/taxGrowth").label).toBe("固定資産税の伸び率（年）");
    expect(fieldOf(own, "/maintGrowth").label).toBe("修繕・管理の費用の伸び率（年）");
  });
  it("購入の1件の修繕・管理の費用の「?」は、購入の種類で呼び方が変わると書く（建て方の欄は無い）", () => {
    const wh = action(blankHousehold(BASE), "housing/addPurchase");
    expect(fieldOf(wh, "/maint").help).toContain("購入の種類を選ぶと");
  });
  it("住み終わりの後は、住み終わりのすぐ下に並べる", () => {
    let wh = action(blankHousehold(BASE), "housing/addOwn");
    wh = set(wh, `${owned(wh).id}/to`, "2040-03");
    const sale = groups(wh).find((g) => g.key === `housing/res/${owned(wh).id}/sale`)!;
    expect(sale.placeIn).toEqual({ group: `housing/res/${owned(wh).id}`, after: `housing/res/${owned(wh).id}/to` });
  });
  it("固定資産税の推定の段が3つを超えたら1つの表に畳む。割合を直した段は、ふつうの段の欄になる", () => {
    let wh = action(blankHousehold(BASE), "housing/addPurchase");
    const r = owned(wh);
    const stages = r.propertyTax?.stages ?? [];
    expect(stages.length).toBeGreaterThan(3);
    const fold = groups(wh).find((g) => g.key.endsWith("/propertyTax/autoStages"))!;
    expect(fold.title).toMatch(/^固定資産税の推定の変化（新築の軽減の終わり・3年ごとの評価替え・\d{4}〜\d{4}年・\d+件）$/);
    expect(fold.fields.length).toBe(stages.length);
    expect(fold.fields.every((f) => f.kind === "pct" && /^\d{4}年から$/.test(f.label))).toBe(true);
    expect(groups(wh).some((g) => g.key.includes("/propertyTax/stage/"))).toBe(false);
    const first = stages[0]!;
    wh = set(wh, `/propertyTax/stage/${first.id}/ratio`, "0.9");
    expect(groups(wh).some((g) => g.key.endsWith(`/propertyTax/stage/${first.id}`))).toBe(true);
    expect(groups(wh).find((g) => g.key.endsWith("/propertyTax/autoStages"))!.fields.length).toBe(stages.length - 1);
  });
  it("相続する家の見出しは「相続する家・○年○月から」。家賃なしの注記に、住まずに持つ実家・土地の入れ場所", () => {
    let wh = action(blankHousehold(BASE), "housing/addFree");
    const free = groups(wh).find((g) => g.title?.includes("家賃なし"))!;
    expect(free.note).toContain("貯蓄・運用の「貸していない不動産」");
    wh = action(wh, "/inherit");
    const title = groups(wh).find((g) => g.title?.includes("相続する家"))?.title ?? "";
    expect(title).toMatch(/^住まい 2（相続する家・\d{4}年\d{1,2}月から）$/);
  });
  it("購入の予定の評価の基にする額は「買った直後の評価額」で、空欄＝物件の価格", () => {
    const wh = action(blankHousehold(BASE), "housing/addPurchase");
    const f = fieldOf(wh, "/valuation/value");
    expect(f.label).toBe("買った直後の評価額");
    expect(f.blankMeans).toBe("物件の価格");
  });
  it("援助する人の候補がいなければ、その場で親・祖父母を足して援助する人にできる", () => {
    let wh = action(blankHousehold(BASE), "housing/addPurchase");
    wh = action(wh, "/addGiftAction");
    expect(fieldOf(wh, "/gift/0/donor").help).toContain("介護・親の項目");
    expect(hasAction(wh, "/gift/0/addDonor/parent")).toBe(true);
    wh = action(wh, "/gift/0/addDonor/parent");
    const parent = wh.request.input.household.members.find((m) => m.kind === "parent")!;
    expect(parent.outside).toBeDefined();
    expect(owned(wh).purchase?.gifts?.[0]?.donor).toBe(parent.id);
    expect(hasAction(wh, "/gift/0/addDonor/parent")).toBe(false);
  });
  it("修繕・リフォームは戸建て（建て方なし）の持ち家なら標準でもボタン。売電・修繕・リフォームローンは持ち家か購入の予定があるときだけ", () => {
    const rent = action(blankHousehold(BASE), "housing/addRent");
    expect(housingMoneyLevel(rent)("repair")).toBeNull();
    expect(housingMoneyLevel(rent)("powerSale")).toBeNull();
    expect(housingMoneyLevel(rent)("subsidy")).toBe("detail");
    expect(hasAction(rent, "money/housing/out/add/repair")).toBe(false);
    expect(hasAction(rent, "housing/add/renovation")).toBe(false);
    const own = action(blankHousehold(BASE), "housing/addOwn");
    expect(housingMoneyLevel(own)("repair")).toBe("simple");
    expect(housingMoneyLevel(own)("powerSale")).toBe("detail");
    expect(stageOf(own).sections.find((s) => s.key === "money/housing/out")?.level).toBe("simple");
    expect(hasAction(own, "housing/add/renovation")).toBe(true);
    const condo = set(own, "/style", "condo");
    expect(housingMoneyLevel(condo)("repair")).toBe("detail");
  });
});

describe("働き方の入るお金", () => {
  it("「＋ 売却代金（事業・出資持分）」は詳細だけ。ほかの「＋」と区画は標準のまま", () => {
    const sec = buildStage("work", blankHousehold(BASE)).sections.find((s) => s.key === "money/work/in")!;
    expect(sec.level).toBe("simple");
    expect(sec.actions.find((a) => a.key === "money/work/in/add/saleBusiness")?.level).toBe("detail");
    expect(sec.actions.filter((a) => a.key !== "money/work/in/add/saleBusiness").every((a) => a.level === "simple")).toBe(true);
  });
});

describe("保険の欄", () => {
  const withKind = (key: string, base = blankHousehold(BASE)): WorkingHousehold => action(base, key, "insurance");
  it("死亡の保障の無い契約（医療保険）には受取人・死亡保険金の税を出さない。受取人の候補に被保険者を出さない", () => {
    const med = withKind("ins/addMedical");
    expect(maybeField(med, "/benef", "insurance")).toBeUndefined();
    expect(maybeField(med, "/tax", "insurance")).toBeUndefined();
    const term = withKind("ins/add", couple());
    const c = contracts(term).at(-1)!;
    const benef = fieldOf(term, `ins/${c.id}/benef`, "insurance");
    expect(optionsOf(benef).some((o) => o.value === c.insured)).toBe(false);
  });
  it("種類の選択肢は足す一覧と同じ見出しで分け、標準では損害保険を出さない（詳細の欄では出す）。学資保険は子のいる世帯だけ", () => {
    const wh = withKind("ins/add");
    const c = contracts(wh)[0]!;
    const simple = fieldOf(wh, `ins/${c.id}/template`, "insurance");
    expect(simple.simpleOnly).toBe(true);
    expect(optionsOf(simple).some((o) => o.value === "nonLife")).toBe(false);
    expect(optionsOf(simple).some((o) => o.value === "education")).toBe(false);
    expect(optionsOf(simple).find((o) => o.value === "term")?.group).toBe("死亡の保障");
    expect(optionsOf(fieldOf(wh, `ins/${c.id}/templateAll`, "insurance")).some((o) => o.value === "nonLife")).toBe(true);
    const kids = withKind("ins/add", couple());
    const k = contracts(kids).at(-1)!;
    expect(optionsOf(fieldOf(kids, `ins/${k.id}/template`, "insurance")).some((o) => o.value === "education")).toBe(true);
  });
  it("説明の文は欄の数を書かない。詳細の並びは保障の終わり→払込の終わり→払込免除→契約者", () => {
    const wh = withKind("ins/add:wholeLife");
    expect(stageOf(wh, "insurance").lead).not.toContain("5つ");
    const c = contracts(wh)[0]!;
    const keys = allFields(stageOf(wh, "insurance")).filter((f) => f.key.startsWith(`ins/${c.id}/`)).map((f) => f.key.slice(`ins/${c.id}/`.length));
    const at = (k: string) => keys.indexOf(k);
    expect(at("end")).toBeLessThan(at("payUntil"));
    expect(at("payUntil")).toBeLessThan(at("waiver"));
    expect(at("waiver")).toBeLessThan(at("holder"));
  });
  it("終身払いの払込の終わりは「空欄＝終身払い」。一時払いには払込の終わりの欄を出さない", () => {
    let wh = withKind("ins/addMedical");
    const c = contracts(wh)[0]!;
    expect(fieldOf(wh, `ins/${c.id}/payUntil`, "insurance").time?.when.nullText).toBe("終身払い");
    wh = set(wh, `ins/${c.id}/freq`, "single", "insurance");
    expect(maybeField(wh, `ins/${c.id}/payUntil`, "insurance")).toBeUndefined();
  });
  it("外貨建て保険の保険料・死亡保険金（円の目安）の「?」に、円への直し方", () => {
    const wh = withKind("ins/add:foreignCurrency");
    const c = contracts(wh)[0]!;
    expect(fieldOf(wh, `ins/${c.id}/premium`, "insurance").help).toContain("今の為替で円に直した額");
    expect(fieldOf(wh, `ins/${c.id}/main`, "insurance").help).toContain("円換算");
  });
  it("保障の明細の主契約の行は、額と終わりを読むだけ（上の欄と同じ値）", () => {
    const wh = withKind("ins/add");
    const c = contracts(wh)[0]!;
    const main = c.coverages![0]!;
    const amount = fieldOf(wh, `ins/${c.id}/cov/${main.id}/amount`, "insurance");
    const to = fieldOf(wh, `ins/${c.id}/cov/${main.id}/to`, "insurance");
    expect(amount.readOnly).toContain("同じ値");
    expect(to.readOnly).toContain("同じ値");
    // 上の欄で直すと、明細の行にも出る
    const w2 = set(wh, `ins/${c.id}/main`, 20_000_000, "insurance");
    expect(fieldOf(w2, `ins/${c.id}/cov/${main.id}/amount`, "insurance").get(w2).value).toBe("20,000,000円（上の「死亡保険金」と同じ）");
  });
  it("保険料の行の下に、必要保障額は万一のときのタブで見ることを1行（数字は出さない）", () => {
    const html = renderToString(h(InsuranceOverview, { view: { premium: { monthly: 5000, annual: 60000, remaining: 1_000_000 }, savings: [] } as never }));
    expect(html).toContain("必要保障額との過不足は、結果の「万一のとき」のタブで見ます");
  });
});
