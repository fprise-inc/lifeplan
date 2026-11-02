// 住まい・ローンの見直し（0052・0077 の 2026-10-31 の追記）: 修繕・管理の費用の呼び方（建て方ごと）、家賃の変動率の目安、
// 住宅の購入を1件に、諸費用を標準に、完成する年、金利の種類を金利の前に・種類ごとの金利の目安（マスタデータ）、住宅ローンの中枠、修繕・リフォームの時期に毎月を出さない
import { describe, expect, it } from "vitest";
import { h } from "preact";
import { renderToString } from "preact-render-to-string";
import type { Debt, Residence } from "../src/engine/types.ts";
import { currentMortgageRateEstimate, mortgageRateEstimate } from "../../hearing/src/housingEstimates.ts";
import { masterValue } from "../../hearing/src/statistics.ts";
import { entryParts, groupUnits, headsWithMore } from "../src/workspace/input/FieldViews.tsx";
import { allFields, type FieldDef, type GroupDef, type Level } from "../src/workspace/input/form.ts";
import { blankHousehold, fromRequest, mutate, type WorkingHousehold } from "../src/workspace/input/household.ts";
import { withProvisionalHousing } from "../src/workspace/input/housingCredit.ts";
import { InputPanel } from "../src/workspace/input/InputPanel.tsx";
import { buildStage } from "../src/workspace/input/stages/index.ts";
import { maintenanceLabels } from "../src/workspace/input/stages/housing.ts";
import { rateRow } from "../src/workspace/input/stages/housingLoans.ts";
import { modelHousehold, preview } from "./helpers.ts";

const BASE = "2026-10";
const noop = () => undefined;
const stage = (wh: WorkingHousehold) => buildStage("housing", wh);
const groups = (wh: WorkingHousehold): GroupDef[] => stage(wh).sections.flatMap((s) => s.groups);
const panel = (wh: WorkingHousehold, level: Level, open: readonly string[] = []) =>
  renderToString(h(InputPanel, { wh, itemId: "housing", level, onLevel: noop, onSave: noop, onClose: noop, groupOpen: { isOpen: (k) => open.includes(k), toggle: noop } }));
function action(wh: WorkingHousehold, key: string): WorkingHousehold {
  const a = stage(wh)
    .sections.flatMap((x) => [...x.actions, ...x.groups.flatMap((g) => g.actions)])
    .find((x) => x.key === key || x.key.endsWith(key));
  if (a === undefined) throw new Error(`no action ${key}`);
  return withProvisionalHousing(a.run(wh));
}
function fieldOf(wh: WorkingHousehold, suffix: string): FieldDef {
  const f = allFields(stage(wh)).find((x) => x.key.endsWith(suffix));
  if (f === undefined) throw new Error(`no field ${suffix}`);
  return f;
}
const set = (wh: WorkingHousehold, suffix: string, v: Parameters<FieldDef["set"]>[1]): WorkingHousehold => withProvisionalHousing(fieldOf(wh, suffix).set(wh, v));
function salaried(): WorkingHousehold {
  let wh = blankHousehold(BASE);
  const start = buildStage("work", wh).sections[0]!.groups[0]!.actions.find((a) => a.key.endsWith("/start"))!;
  wh = start.run(wh);
  const annual = allFields(buildStage("work", wh)).find((f) => f.key.endsWith("/annual"))!;
  return annual.set(wh, 6000000);
}
const optionsOf = (f: FieldDef): string[] => ((f as { options?: readonly { value: string }[] }).options ?? []).map((o) => o.value);
const loan = (wh: WorkingHousehold): Debt => (wh.request.input.household.debts ?? []).find((d) => d.kind === "mortgage")!;
const owned = (wh: WorkingHousehold): Residence => (wh.request.input.household.residences ?? []).find((r) => r.kind === "own")!;

describe("修繕・管理の費用の呼び方（建て方ごと）", () => {
  it("マンションは管理費・修繕積立金、戸建ては修繕の積み立て、建て方が無ければどちらにも当てはまる呼び方", () => {
    expect(maintenanceLabels({ style: "condo" }).amount).toBe("管理費・修繕積立金（毎月）");
    expect(maintenanceLabels({ style: "house" }).amount).toBe("修繕の積み立て（毎月）");
    expect(maintenanceLabels({}).amount).toBe("修繕・管理の費用（毎月）");
    let wh = action(salaried(), "housing/addOwn");
    expect(fieldOf(wh, "/maint").label).toBe("修繕・管理の費用（毎月）");
    wh = set(wh, "/style", "condo");
    expect(fieldOf(wh, "/maint").label).toBe("管理費・修繕積立金（毎月）");
    expect(fieldOf(wh, "/maintGrowth").label).toBe("管理費・修繕積立金の変動率（年）");
    wh = set(wh, "/style", "house");
    expect(fieldOf(wh, "/maint").label).toBe("修繕の積み立て（毎月）");
  });
});

describe("家賃の変動率", () => {
  it("年率（ほかの率の欄と同じ）。空欄なら統計の目安（民営家賃の10年の年平均）を知らせる。「当てる」は使わない", () => {
    const wh = action(salaried(), "housing/addRent");
    const f = fieldOf(wh, "/rentGrowth");
    expect(f.label).toBe("家賃の変動率（年）");
    expect(f.help).toContain("年あたりの率");
    expect(f.help).not.toContain("当て");
    const hint = f.get(wh).hint ?? "";
    expect(hint).toContain("消費者物価指数の民営家賃");
    expect(hint).toContain("2015〜2025年");
    expect(masterValue("housing.statistics.rentGrowth")?.reviewed).toBe(true);
    expect(set(wh, "/rentGrowth", "0.01") !== wh).toBe(true);
    expect(fieldOf(set(wh, "/rentGrowth", "0.01"), "/rentGrowth").get(set(wh, "/rentGrowth", "0.01")).hint ?? null).toBeNull();
  });
});

describe("住宅購入の予定は「住宅の購入」の1件", () => {
  it("「＋ 住宅購入の予定」で、購入の欄と住まいの欄が1つの物（住宅の購入）に入り、「住まい 2（持ち家）」を別に出さない", () => {
    const wh = action(action(salaried(), "housing/addRent"), "housing/addPurchase");
    const r = owned(wh);
    const k = `housing/res/${r.id}`;
    const gs = groups(wh);
    const head = gs.find((g) => g.key === k)!;
    expect(head.title).toBe("住宅の購入");
    expect(gs.filter((g) => g.title === "住宅の購入")).toHaveLength(1);
    expect(gs.some((g) => g.key === `${k}/purchase`)).toBe(false);
    expect(gs.some((g) => (g.title ?? "").startsWith("住まい 2"))).toBe(false);
    // 購入の欄は頭に（購入の時期・物件の価格・頭金・諸費用）。諸費用は標準
    expect(head.fields.slice(0, 4).map((f) => f.key.slice(k.length + 1))).toEqual(["purchase/at", "purchase/price", "purchase/down", "purchase/costs"]);
    expect(head.fields.find((f) => f.key.endsWith("/purchase/costs"))?.level).toBe("simple");
    // 標準でも「▸ 続きを見る」を開かずに諸費用が見える
    const html = panel(wh, "simple");
    expect(html).toContain("諸費用");
    // 援助は同じ物の枠の中
    const w2 = action(wh, `${k}/purchase/addGiftAction`);
    const shown = groups(w2).filter((g) => g.level === "simple");
    expect(entryParts(shown).get(`${k}/purchase/gift/0`)).toBe(k);
    expect(() => preview(w2.request)).not.toThrow();
  });
  it("住宅の購入の1件には住まいの種類の欄（住まい）を出さない（標準・詳細とも）。ふつうの住まいの1件には出す。購入をやめるときは「外す」", () => {
    const wh = action(action(salaried(), "housing/addRent"), "housing/addPurchase");
    const r = owned(wh);
    const k = `housing/res/${r.id}`;
    const gs = groups(wh);
    const head = gs.find((g) => g.key === k)!;
    expect(head.fields.some((f) => f.key === `${k}/kind`)).toBe(false);
    expect(head.actions.some((a) => a.key === `${k}/remove`)).toBe(true);
    const rent = (wh.request.input.household.residences ?? []).find((x) => x.purchase === undefined)!;
    expect(gs.find((g) => g.key === `housing/res/${rent.id}`)!.fields.some((f) => f.key === `housing/res/${rent.id}/kind`)).toBe(true);
    // 標準・詳細のどちらでも（欄そのものが無い）
    expect(allFields(stage(wh)).some((f) => f.key === `${k}/kind`)).toBe(false);
  });
  it("持ち家の評価: 購入の予定は「建物が完成する年」、今住んでいる家は「建物が建った年」。評価の基にする額の空欄は土地と建物に分けて減らすことを書く", () => {
    const wh = action(action(salaried(), "housing/addPurchase"), "housing/addOwn");
    const [now, buy] = [(wh.request.input.household.residences ?? []).find((r) => r.purchase === undefined)!, owned(wh)];
    expect(fieldOf(wh, `${buy.id}/valuation/builtYear`).label).toBe("建物が完成する年");
    expect(fieldOf(wh, `${now.id}/valuation/builtYear`).label).toBe("建物が建った年");
    expect(fieldOf(wh, `${buy.id}/valuation/value`).help).toContain("土地と建物に分けて");
  });
});

describe("住宅ローンの金利: 種類を金利の前に、種類ごとの目安（マスタデータ）", () => {
  it("新しい住宅ローンは変動金利の目安（マスタデータ）。種類を変えると、目安のままの金利をその種類の目安に入れ直す。入れた金利は変えない", () => {
    let wh = action(action(salaried(), "housing/addPurchase"), "housing/addMortgage");
    const d = loan(wh);
    const keys = allFields(stage(wh)).filter((f) => f.key.startsWith(`housing/debt/${d.id}/`)).map((f) => f.key.slice(`housing/debt/${d.id}/`.length));
    expect(keys.indexOf("rateType")).toBe(keys.indexOf("rate") - 1);
    expect(fieldOf(wh, `${d.id}/rateType`).level).toBe("simple");
    const v = mortgageRateEstimate("variable");
    const f = mortgageRateEstimate("fixed");
    expect(d.rateSchedule[0]?.rate).toBe(v.rate);
    expect(rateRow(wh, d)?.estimate?.basis).toContain(v.basis);
    expect(Number(f.rate)).toBeGreaterThan(Number(v.rate));
    wh = set(wh, `${d.id}/rateType`, "fixed");
    expect(loan(wh).rateSchedule[0]).toMatchObject({ type: "fixed", rate: f.rate });
    expect(rateRow(wh, loan(wh))?.estimate?.basis).toContain("全期間固定");
    wh = set(wh, `${d.id}/rateType`, "fixedPeriod");
    expect(rateRow(wh, loan(wh))?.estimate?.basis).toContain("固定期間選択型");
    wh = set(wh, `${d.id}/rate`, "0.012");
    wh = set(wh, `${d.id}/rateType`, "variable");
    expect(loan(wh).rateSchedule[0]).toMatchObject({ type: "variable", rate: "0.012" });
    expect(() => preview(wh.request)).not.toThrow();
  });
  it("変動金利の見込み（5年ごとの段）を選んだあとで種類を全期間固定にすると、見込みの段を外す（隠れた段で固定の金利が下がらない）", () => {
    let wh = action(action(salaried(), "housing/addPurchase"), "housing/addMortgage");
    const d = loan(wh);
    wh = set(wh, `${d.id}/rateOutlook`, "up1");
    expect(loan(wh).rateSchedule).toHaveLength(3);
    expect(fieldOf(wh, `${d.id}/rateType`).sideEffects).toContain("見込みの段");
    wh = set(wh, `${d.id}/rateType`, "fixed");
    expect(loan(wh).rateSchedule).toHaveLength(1);
    expect(loan(wh).rateSchedule[0]).toMatchObject({ type: "fixed", rate: mortgageRateEstimate("fixed").rate });
    expect(allFields(stage(wh)).some((f) => f.key.endsWith(`${d.id}/rateOutlook`))).toBe(false);
    // 金利の段階で入れた段（見込みの型に当たらない段）は外さない
    wh = set(wh, `${d.id}/rateType`, "variable");
    wh = set(wh, `${d.id}/rateOutlook`, "up2");
    const steps = loan(wh).rateSchedule;
    expect(steps).toHaveLength(3);
    wh = mutate(wh, (hh) => {
      const x = (hh.debts ?? []).find((y) => y.id === d.id);
      if (x !== undefined) x.rateSchedule = steps.map((s, i) => (i === 1 ? { ...s, rate: "0.03" } : s));
    });
    wh = set(wh, `${d.id}/rateType`, "fixedPeriod");
    expect(loan(wh).rateSchedule).toHaveLength(3);
    expect(() => preview(wh.request)).not.toThrow();
  });
  it("目安の金利はマスタデータの写しから（出典を確かめた値）", () => {
    for (const id of ["housing.statistics.mortgageRate.variable", "housing.statistics.mortgageRate.fixedPeriod10", "housing.statistics.mortgageRate.fixed"]) expect(masterValue(id)?.reviewed).toBe(true);
    expect(mortgageRateEstimate("fixed").basis).toContain("住宅金融支援機構");
    // 変動・固定期間選択型は主要な銀行の公表の金利の平均（画面の文に銀行の名前を出さない）
    expect(mortgageRateEstimate("variable").basis).toContain("主要な銀行が公表する");
    expect(mortgageRateEstimate("fixedPeriod").basis).toContain("当初10年");
    // 根拠の文は値の題名の頭（会社の名前を書かない題名）から作る
    for (const t of ["variable", "fixedPeriod"] as const) expect(mortgageRateEstimate(t).basis).toMatch(/（主要な銀行が公表する[^（]*の平均）$/);
  });
});

describe("今返している住宅ローンの金利の目安（住宅ローン利用者の借入金利の中央値）", () => {
  it("今住んでいる家の住宅ローン（今の残高から）は、新しく借りるときの金利でなく利用者の中央値（約0.85%）。根拠の文に何の値かを書く", () => {
    const wh = action(action(salaried(), "housing/addOwn"), "housing/addMortgage");
    const d = loan(wh);
    const c = currentMortgageRateEstimate();
    expect(masterValue("housing.statistics.mortgageRate.current")?.reviewed).toBe(true);
    expect(c.rate).toBe("0.0085");
    expect(d.rateSchedule[0]).toMatchObject({ type: "variable", rate: c.rate });
    expect(Number(c.rate)).toBeLessThan(Number(mortgageRateEstimate("variable").rate));
    const basis = rateRow(wh, d)?.estimate?.basis ?? "";
    expect(basis).toContain("今返している住宅ローン 年0.85%");
    expect(basis).toContain("住宅ローン利用者の借入金利の中央値");
    expect(basis).toContain("住宅金融支援機構「住宅ローン利用者の実態調査」");
    expect(() => preview(wh.request)).not.toThrow();
  });
  it("今返している住宅ローンの金利の種類を変えると、目安のままなら種類ごとの目安（変動は中央値、固定は新しく借りるときの目安で代える）。入れた金利は変えない", () => {
    let wh = action(action(salaried(), "housing/addOwn"), "housing/addMortgage");
    const d = loan(wh);
    expect(fieldOf(wh, `${d.id}/rateType`).sideEffects).toContain("今返している住宅ローンの推定の金利（選んだ種類の分）に入れ直します");
    wh = set(wh, `${d.id}/rateType`, "fixed");
    expect(loan(wh).rateSchedule[0]).toMatchObject({ type: "fixed", rate: mortgageRateEstimate("fixed").rate });
    expect(currentMortgageRateEstimate("fixed").rate).toBe(mortgageRateEstimate("fixed").rate);
    const fixedBasis = rateRow(wh, loan(wh))?.estimate?.basis ?? "";
    expect(fixedBasis).toContain("今返している住宅ローン（全期間固定） 年");
    expect(fixedBasis).toContain("新しく借りるときの目安で代えています");
    wh = set(wh, `${d.id}/rateType`, "fixedPeriod");
    expect(loan(wh).rateSchedule[0]).toMatchObject({ type: "fixedPeriod", rate: mortgageRateEstimate("fixedPeriod").rate });
    expect(rateRow(wh, loan(wh))?.estimate?.basis).toContain("今返している住宅ローン（固定期間選択型・当初10年） 年");
    wh = set(wh, `${d.id}/rateType`, "variable");
    expect(loan(wh).rateSchedule[0]).toMatchObject({ type: "variable", rate: currentMortgageRateEstimate().rate });
    wh = set(wh, `${d.id}/rateType`, "fixed");
    expect(rateRow(wh, loan(wh))?.estimate?.basis).toContain("今返している住宅ローン");
    wh = set(wh, `${d.id}/rate`, "0.013");
    wh = set(wh, `${d.id}/rateType`, "variable");
    expect(loan(wh).rateSchedule[0]).toMatchObject({ type: "variable", rate: "0.013" });
  });
  it("これから家を買うときの住宅ローンは、今までどおり金利の種類ごとの目安（新しく借りるときの金利）", () => {
    const wh = action(action(salaried(), "housing/addPurchase"), "housing/addMortgage");
    const d = loan(wh);
    expect(d.rateSchedule[0]?.rate).toBe(mortgageRateEstimate("variable").rate);
    expect(rateRow(wh, d)?.estimate?.basis).toContain(mortgageRateEstimate("variable").basis);
    expect(rateRow(wh, d)?.estimate?.basis).not.toContain("今返している");
  });
});

describe("住宅ローンの1件の中枠（大枠 → 中枠）", () => {
  const wh = fromRequest(modelHousehold("salariedCoupleTwoKids"), {});
  const d = loan(wh);
  const k = `housing/debt/${d.id}`;
  it("1件の枠の中を、借入の内容・金利・返済・繰上返済・団体信用生命保険・住宅ローン控除の中枠に分ける（中枠は物の「▸ 続きを見る」の単位にしない）", () => {
    const sec = stage(wh).sections.find((s) => s.key === "housing/loans")!;
    const bands = sec.groups.filter((g) => g.band === true);
    expect(bands.map((g) => g.title)).toEqual(["借入の内容", "金利", "返済", "繰上返済", "団体信用生命保険", "住宅ローン控除"]);
    const units = groupUnits(sec.groups);
    for (const b of bands) expect(units.get(b.key)).toBe(k);
    expect(headsWithMore(sec.groups)).toEqual(new Set([k]));
    // 金利の段階は「金利」の中枠の中、繰上返済のボタンは「繰上返済」の中枠
    const parts = entryParts(sec.groups);
    expect(parts.get(`${k}/band/rate`)).toBe(k);
    expect(parts.get(`${k}/rate/1`)).toBe(`${k}/band/rate`);
    expect(bands.find((g) => g.title === "繰上返済")?.actions.map((a) => a.key)).toEqual([`${k}/addPrepay`]);
    // 欄のキーは今のまま
    expect(bands.find((g) => g.title === "金利")?.fields.map((f) => f.key.slice(k.length + 1))).toEqual(expect.arrayContaining(["rateType", "rate"]));
  });
  it("描くと、中枠は1件の枠の中に左の線と見出しで並び、「▸ 続きを見る」は枠の最後。詳細の中枠は開いたときだけ", () => {
    const html = panel(wh, "simple");
    const box = html.indexOf(`data-group="${k}"`);
    const band = html.indexOf(`class="in-group in-sub in-band" data-group="${k}/band/loan"`);
    const toggle = html.indexOf(`data-group-more="${k}"`);
    expect(box).toBeGreaterThan(0);
    expect(band).toBeGreaterThan(box);
    expect(toggle).toBeGreaterThan(html.indexOf(`data-group="${k}/band/credit"`));
    expect(html).not.toContain(`data-group="${k}/band/prepay"`);
    const opened = panel(wh, "simple", [k]);
    expect(opened).toContain(`data-group="${k}/band/prepay"`);
    expect(opened).toContain(`data-action="${k}/addPrepay"`);
    const detail = panel(wh, "detail");
    expect(detail).toContain(`data-group="${k}/band/creditLife"`);
  });
});

describe("修繕・リフォームの時期に「毎月」を出さない", () => {
  const repairOf = (wh: WorkingHousehold) => (wh.request.input.household.periodicExpenses ?? []).find((p) => p.kind === "repair")!;
  it("足した行は1回・年ごとだけ。前の版で毎月にした行は読めるように残し、知らせる", () => {
    let wh = action(salaried(), "housing/addOwn");
    const add = stage(wh)
      .sections.flatMap((s) => [...s.actions, ...s.groups.flatMap((g) => g.actions)])
      .find((a) => a.key.includes("repair"));
    expect(add).toBeDefined();
    wh = add!.run(wh);
    const p = repairOf(wh);
    const f = fieldOf(wh, `ev/${p.id}/cadence`);
    expect(optionsOf(f)).toEqual(["once", "repeat"]);
    const legacy = mutate(wh, (hh) => {
      const x = (hh.periodicExpenses ?? []).find((y) => y.id === p.id)!;
      x.monthly = true;
      x.everyYears = 1;
      x.to = null;
    });
    const g = fieldOf(legacy, `ev/${p.id}/cadence`);
    expect(optionsOf(g)).toEqual(["once", "monthly", "repeat"]);
    expect(g.get(legacy)).toMatchObject({ value: "monthly" });
    expect(g.get(legacy).hint).toContain("前の版");
  });
});

describe("奨学金・自動車ローンの金利の目安（マスタデータ master.loanRates）", () => {
  it("車の入力項目の自動車ローンと今返している自動車ローンは同じ目安。貸与の奨学金は、これから借りる分（子ども・教育）は今の利率、今返している分（ほかのローン）は過去の利率の平均", async () => {
    const { scholarshipRateEstimate, repayingScholarshipRateEstimate, carLoanRateEstimate } = await import("../../hearing/src/loanRates.ts");
    const { LOAN_SUBTYPES } = await import("../src/workspace/input/stages/housingLoans.ts");
    const { SCHOLARSHIP_BASIS } = await import("../src/workspace/input/stages/education.ts");
    expect(masterValue("loanRates.scholarship")?.reviewed).toBe(true);
    expect(masterValue("loanRates.scholarship.repaying")?.reviewed).toBe(true);
    expect(masterValue("loanRates.carLoan")?.reviewed).toBe(true);
    expect(SCHOLARSHIP_BASIS).toContain(scholarshipRateEstimate().basis);
    const r = repayingScholarshipRateEstimate();
    expect(r.rate).toBe("0.0075");
    expect(Number(r.rate)).toBeLessThan(Number(scholarshipRateEstimate().rate));
    expect(LOAN_SUBTYPES.find((s) => s.value === "scholarship")?.rate).toBe(r.rate);
    const wh = action(salaried(), "housing/add/scholarship");
    const d = wh.request.input.household.debts?.[0];
    expect(d?.rateSchedule[0]?.rate).toBe(r.rate);
    const basis = d === undefined ? "" : (rateRow(wh, d)?.estimate?.basis ?? "");
    expect(basis).toContain("今返している奨学金の利率の目安 年0.75%");
    expect(basis).toContain("日本学生支援機構");
    expect(basis).toContain("第一種なら種類で選んでください");
    // 第一種（無利子）を選ぶと、目安のままなら利率0%（0104）
    const free = set(wh, `${d?.id}/subtype`, "scholarshipFree");
    expect(free.request.input.household.debts?.[0]).toMatchObject({ kind: "scholarship", subtype: "scholarshipFree", rateSchedule: [{ rate: "0" }] });
    const back = set(free, `${d?.id}/subtype`, "scholarship");
    expect(back.request.input.household.debts?.[0]?.rateSchedule[0]?.rate).toBe(r.rate);
    expect(carLoanRateEstimate().basis).toMatch(/（主要な銀行が公表する[^（]*の平均）$/);
  });
});
