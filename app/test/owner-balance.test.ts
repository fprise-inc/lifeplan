// 役員として働く人の家計の側（0105）: 自社株（出資額）・会社への貸付金・会社からの借入金・会社の借入の連帯保証の額の欄と、
// バランスシートの項目・図の外の点線の箱・家計の体力の目安の分母（生活費＋ローン返済）と段で目指す文
import { describe, expect, it } from "vitest";
import { h } from "preact";
import { renderToString } from "preact-render-to-string";
import { BalanceTab } from "../src/presentation/BalanceTab.tsx";
import { healthOf, monthSteps, monthsValue } from "../src/presentation/bsLayout.ts";
import { bsSeries, bsHouseholdOf } from "../../report/src/index.ts";
import { balanceTabModel, bsPlan, defaultGuideBasis, DEFAULT_BS_GUIDE, DEFAULT_BS_POINTS, readBsGuide } from "../src/workspace/balanceTab.ts";
import { fromRequest, type WorkingHousehold } from "../src/workspace/input/household.ts";
import { buildStage } from "../src/workspace/input/stages/index.ts";
import { executiveMembers, hasExecutive } from "../src/workspace/input/officer.ts";
import { modelHousehold, preview } from "./helpers.ts";
import type { EngineRequest } from "../src/engine/types.ts";

const noop = () => undefined;
const executive = (): EngineRequest => modelHousehold("executiveOwner");
const plain = (): EngineRequest => modelHousehold("civilServant");

function stage(wh: WorkingHousehold, id: string) {
  return buildStage(id as never, wh);
}
function action(wh: WorkingHousehold, id: string, key: string) {
  const st = stage(wh, id);
  for (const sec of st.sections) {
    const a = sec.actions.find((x) => x.key === key) ?? sec.groups.flatMap((g) => g.actions).find((x) => x.key === key);
    if (a !== undefined) return a;
  }
  return undefined;
}

describe("分け方の部品: 細目の項目（0105）", () => {
  const cell = (row: string, year: number, amount: number, object?: string) => ({ row, year, amount, ...(object !== undefined ? { object } : {}) });
  const table = [
    cell("cf.balance.account.deposit", 2026, 5_000_000),
    cell("cf.balance.account.otherAsset", 2026, 3_000_000, "shares"),
    cell("cf.balance.account.otherAsset", 2026, 5_000_000, "lend"),
    cell("cf.balance.account.otherAsset", 2026, 1_000_000, "gold"),
    cell("cf.balance.debt.other", 2026, 2_000_000, "borrow"),
    cell("cf.balance.debt.other", 2026, 700_000, "card"),
  ];
  const hh = bsHouseholdOf({
    accounts: [
      { id: "shares", kind: "otherAsset", subtype: "ownCompanyShares" },
      { id: "lend", kind: "otherAsset", subtype: "loanToCompany" },
      { id: "gold", kind: "otherAsset" },
    ],
    debts: [
      { id: "borrow", kind: "other", subtype: "companyLoan" },
      { id: "card", kind: "other", subtype: "cardLoan" },
    ],
  });
  const [a] = bsSeries(table, [2026], hh);

  it("自社株・会社への貸付金は換金しにくい資産、会社からの借入金はその他の負債の項目。足し算は変えない", () => {
    const by = Object.fromEntries(a!.lines.map((l) => [l.key, l]));
    expect(by.ownShares).toMatchObject({ label: "自社株（出資額）", group: "illiquid", amount: 3_000_000 });
    expect(by.loanToCompany).toMatchObject({ label: "会社への貸付金", group: "illiquid", amount: 5_000_000 });
    expect(by.otherAsset).toMatchObject({ amount: 1_000_000 });
    expect(by.companyLoan).toMatchObject({ label: "会社からの借入金", group: "debt", amount: 2_000_000 });
    expect(by.debtOther).toMatchObject({ amount: 700_000 });
    expect(a!.totalAssets).toBe(14_000_000);
    expect(a!.totalLiabilities).toBe(2_700_000);
    expect(a!.netWorth).toBe(a!.totalAssets - a!.totalLiabilities);
  });
});

describe("家計の体力の目安の分母と段で目指す文（0105）", () => {
  const y = { lines: [{ key: "deposit", label: "預金", group: "liquid" as const, amount: 3_000_000 }], living: 3_600_000, loanPay: 1_200_000, totalAssets: 3_000_000, totalLiabilities: 0, fact: true };

  it("分母を生活費＋ローン返済にすると、返済の分だけ月数が減る", () => {
    expect(healthOf(y, DEFAULT_BS_GUIDE).months.value).toBeCloseTo(10, 5);
    expect(healthOf(y, { ...DEFAULT_BS_GUIDE, basis: "livingLoan" }).months.value).toBeCloseTo(7.5, 5);
    expect(monthsValue(7.5, true).unit).toBe("か月分の生活費＋返済");
  });

  it("目安より少ないときは、段で目指す文（赤で煽らない）", () => {
    expect(monthSteps(1.5, 6, 12)).toBe("まず3か月分、次に6か月分を目指しましょう。");
    expect(monthSteps(4, 6, 12)).toBe("まず6か月分、次に12か月分を目指しましょう。");
    const low = healthOf({ ...y, lines: [{ key: "deposit", label: "預金", group: "liquid", amount: 450_000 }] }, DEFAULT_BS_GUIDE).months;
    expect(low.tone).toBe("low");
    expect(low.text.map((t) => t.text).join("")).toBe("目安（6〜12か月分）より少なめです。まず3か月分、次に6か月分を目指しましょう。");
  });

  it("分母は選んだときだけ保存し、選んでいなければ役員のいる世帯は生活費＋ローン返済", () => {
    expect(readBsGuide({ months: [6, 12], risk: [10, 40], debt: 50 }).basis).toBeUndefined();
    expect(readBsGuide({ months: [6, 12], risk: [10, 40], debt: 50, basis: "livingLoan" }).basis).toBe("livingLoan");
    expect(readBsGuide({ months: [6, 12], risk: [10, 40], debt: 50, basis: "other" }).basis).toBeUndefined();
    expect(hasExecutive(executive().input.household)).toBe(true);
    expect(defaultGuideBasis(executive())).toBe("livingLoan");
    expect(defaultGuideBasis(plain())).toBe("living");
  });
});

describe("入力の欄と資産と負債のタブ（0105）", () => {
  it("役員のいない世帯には欄を出さない", () => {
    const wh = fromRequest(plain());
    expect(action(wh, "savings", "sav/add/ownCompanyShares")).toBeUndefined();
    expect(action(wh, "housing", "housing/add/companyLoan")).toBeUndefined();
    expect(JSON.stringify(stage(wh, "work").sections.map((s) => s.groups.map((g) => g.key)))).not.toContain("/officer");
  });

  it("役員の世帯で、自社株・貸付金・借入金・保証の額を入れると、BS の項目と点線の箱・分母に出て、借入金の返済だけが計算に入る", () => {
    let wh = fromRequest(executive());
    const officer = executiveMembers(wh.request.input.household)[0]!;
    const before = preview(wh.request);
    wh = action(wh, "savings", "sav/add/ownCompanyShares")!.run(wh);
    wh = action(wh, "savings", "sav/add/loanToCompany")!.run(wh);
    wh = action(wh, "housing", "housing/add/companyLoan")!.run(wh);
    const hh = wh.request.input.household;
    const [shares, lend] = (hh.accounts ?? []).filter((a) => a.subtype !== undefined);
    expect(shares).toMatchObject({ kind: "otherAsset", subtype: "ownCompanyShares", owner: officer.id });
    expect(lend).toMatchObject({ kind: "otherAsset", subtype: "loanToCompany", owner: officer.id });
    const loan = (hh.debts ?? []).find((d) => d.subtype === "companyLoan")!;
    expect(loan).toMatchObject({ kind: "other", debtors: [{ member: officer.id, role: "primary" }] });
    // 額を入れる（出資額 300万円・貸付金 500万円・借入金の残り 240万円で月5万円・保証 3,000万円）
    const req = structuredClone(wh.request);
    const h2 = req.input.household;
    const box = (v: number) => ({ value: v, state: "confirmed", origin: { kind: "manual" } });
    for (const a of h2.accounts ?? []) if (a.subtype === "ownCompanyShares") a.marketValue = box(3_000_000);
    for (const a of h2.accounts ?? []) if (a.subtype === "loanToCompany") a.marketValue = box(5_000_000);
    for (const d of h2.debts ?? []) if (d.subtype === "companyLoan") Object.assign(d, { balance: box(2_400_000), repayment: { method: "equalPayment", termMonths: 48 }, rateSchedule: [{ ...d.rateSchedule[0], rate: "0" }] });
    h2.members = h2.members.map((m) => (m.id === officer.id ? { ...m, companyGuarantee: box(30_000_000) } : m));
    const r = preview(req);
    const yr = Number(req.input.baseMonth.slice(0, 4)) + 1;
    const pay = r.table.filter((c) => c.object === loan.id && c.row === "cf.expense.debt.other" && c.year === yr).reduce((s, c) => s + c.amount, 0);
    expect(pay).toBe(600_000);
    // 保証の額は計算に使わない
    const noG = structuredClone(req);
    for (const m of noG.input.household.members) delete m.companyGuarantee;
    expect(preview(noG).table).toEqual(r.table);
    expect(before.table.length).toBeGreaterThan(0);

    const plan = bsPlan({ key: "A", letter: "A", name: "現状", title: "", base: true, req, table: r.table });
    const now = plan.years[0]!;
    const keys = now.lines.map((l) => l.key);
    expect(keys).toEqual(expect.arrayContaining(["ownShares", "loanToCompany", "companyLoan"]));
    expect(now.guarantee).toBe(30_000_000);
    expect(plan.years[1]!.guarantee).toBe(0);
    expect(plan.years[1]!.loanPay).toBeGreaterThanOrEqual(600_000);
    expect(now.notes.illiquid).toContain("自社株は出資額");

    const model = balanceTabModel({ plans: [plan], selected: "A", base: "A", guide: DEFAULT_BS_GUIDE, guideBasis: defaultGuideBasis(req), pointDefaults: DEFAULT_BS_POINTS, columns: null, prevChoices: [], prev: { status: "idle", model: null }, provisional: false, who: "ご本人" });
    const html = renderToString(h(BalanceTab, { model, band: null, onPrev: noop, onGuide: noop, onColumns: noop, onPointDefaults: noop }));
    expect(html).toContain("data-bs-guarantee");
    expect(html).toContain("保証を含めると純資産は");
    expect(html).toContain(`${Math.round((now.netWorth - 30_000_000) / 10000).toLocaleString("ja-JP")}万円`);
    expect(html).toContain('data-bs-basis="livingLoan"');
    expect(html).toContain("生活費＋ローン返済 月");
  });

  it("働き方と収入の役員の区画に、保証の額の欄を出す", () => {
    const wh = fromRequest(executive());
    const officer = executiveMembers(wh.request.input.household)[0]!;
    const g = stage(wh, "work").sections.flatMap((s) => s.groups).find((x) => x.key === `work/${officer.id}/officer`)!;
    expect(g.fields.map((f) => f.item)).toEqual(["member.companyGuarantee"]);
    const next = g.fields[0]!.set(wh, 12_000_000);
    expect(next.request.input.household.members.find((m) => m.id === officer.id)?.companyGuarantee?.value).toBe(12_000_000);
  });
});
