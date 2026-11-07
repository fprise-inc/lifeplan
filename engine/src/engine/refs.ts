// 指す先の無い欄の知らせ（0163）: 世帯の物の ID を指す欄のうち、指す先が世帯に無い欄を、黙って無視せず N_INPUT_REQUIRED で知らせる。
// 構成員を指す欄のうち、計算の前提になる欄（働き方の期間・口座・保険の当事者・関係など）は、今までどおり E_ARGUMENT で止める（run.ts）。
// ここで見るのは、それ以外の欄（指す先が無いと、その欄が無いものとして計算する欄）。ID は ["reference.<欄>", 欄を持つ物の ID]（物が無い欄は欄だけ）
import type { EngineInput } from "./types.ts";

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => v !== null && typeof v === "object" && !Array.isArray(v);
const list = (o: unknown, k: string): Obj[] => (isObj(o) && Array.isArray(o[k]) ? (o[k] as unknown[]).filter(isObj) : []);
const str = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined);

export function danglingRefNotices(input: EngineInput): { code: string; ids: string[] }[] {
  const h = input.household as unknown as Obj;
  const ids = (k: string) => new Set(list(h, k).map((o) => str(o.id)).filter((x): x is string => x !== undefined));
  const members = ids("members");
  const periods = ids("employmentPeriods");
  const accounts = ids("accounts");
  const debts = ids("debts");
  const benefits = ids("retirementBenefits");
  const out = new Map<string, { code: string; ids: string[] }>();
  const check = (item: string, id: unknown, has: ReadonlySet<string>, holder: Obj | null) => {
    const v = str(id);
    if (v === undefined || has.has(v)) return;
    const hid = holder === null ? undefined : str(holder.id);
    const n = { code: "N_INPUT_REQUIRED", ids: [`reference.${item}`, ...(hid !== undefined ? [hid] : [])] };
    out.set(n.ids.join(","), n);
  };
  for (const b of list(h, "retirementBenefits")) check("retirementBenefit.employment", b.employment, periods, b);
  for (const p of list(h, "employmentPeriods")) check("employment.retirementBenefit", p.retirementBenefit, benefits, p);
  for (const d of list(h, "debts")) {
    for (const x of list(d, "debtors")) check("debt.debtors", x.member, members, d);
    if (isObj(d.creditLife) && Array.isArray(d.creditLife.covered)) for (const m of d.creditLife.covered) check("debt.creditLife", m, members, d);
    check("debt.property", d.property, accounts, d);
    check("debt.pairWith", d.pairWith, debts, d);
    if (isObj(d.housing)) for (const o of list(d.housing, "ownership")) check("debt.housing.ownership", o.member, members, d);
  }
  for (const r of list(h, "residences")) {
    for (const o of list(r, "ownership")) check("residence.ownership", o.member, members, r);
    if (isObj(r.purchase)) for (const g of list(r.purchase, "gifts")) check("residence.purchase.gifts.recipient", g.recipient, members, r);
  }
  for (const c of list(h, "insuranceContracts")) {
    const covs = new Set(list(c, "coverages").map((x) => str(x.id)).filter((x): x is string => x !== undefined));
    for (const x of list(c, "coverages")) check("insurance.coverages.insured", x.insured, members, c);
    if (isObj(c.schedule)) for (const r of list(c.schedule, "rows")) check("insurance.schedule.coverage", r.coverage, covs, c);
  }
  for (const f of list(h, "incomeFlows")) {
    check("incomeFlow.recipient", f.recipient, members, f);
    check("incomeFlow.counterparty", f.counterparty, members, f);
  }
  for (const e of list(h, "periodicExpenses")) {
    check("periodicExpense.payer", e.payer, members, e);
    check("periodicExpense.counterparty", e.counterparty, members, e);
    check("periodicExpense.object", e.object, accounts, e);
  }
  for (const g of list(h, "goals")) {
    check("goal.owner", g.owner, members, g);
    const ed = isObj(g.education) ? g.education : null;
    for (const x of list(ed, "gifts")) check("goal.education.gifts.payer", x.payer, members, g);
    for (const x of list(ed, "loans")) check("goal.education.loans.borrower", x.borrower, members, g);
  }
  for (const c of list(h, "cars")) check("car.owner", c.owner, members, c);
  for (const f of list(h, "advisoryFees")) check("advisoryFee.payer", f.payer, members, f);
  for (const b of list(h, "retirementBenefits")) check("retirementBenefit.member", b.member, members, b);
  const wd = isObj(input.assumptions) ? (input.assumptions as unknown as Obj).withdrawal : undefined;
  for (const o of list(wd, "order")) check("assumptions.withdrawal.order", o.object, accounts, null);
  return [...out.values()];
}
