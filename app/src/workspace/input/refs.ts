// 外した物を指す欄の片付け（0163）
// 世帯の中の物（人・働き方の期間・口座・保険・ローン・住まい・退職金・お金の行・出来事）は ID で互いを指す（0004・0008）。
// 物を外したあとに、外した物を指す欄が残ると、計算が止まる（人を指す欄。エンジンの E_ARGUMENT）か、その欄を黙って無視して結果が変わる。
// ここに「物の ID を指す欄」を1か所にまとめ、外した物を指す欄を、欄ごとの決まり（空にする・その行を外す・持ち主の物ごと外す・割合を残りで分け直す）で片付ける。
// - 片付けは「この操作で無くなった物」を指す欄だけ（前から指す先の無い欄は触らない。計算の知らせで出る）
// - 指す先に付いている物（持ち家 → その住宅ローン、勤め先 → その退職金、不動産 → その借入）は dependent。プランを直すときは、外したときの連鎖の
//   確かめ（0036 の8）で一緒に外すかを選ぶので、操作の中では片付けず、確かめの後に片付ける（keepRefs の dependents）
import { resolveTimepoint } from "../timepoint.ts";
import type { Household, Timepoint } from "../../engine/types.ts";
import type { WorkingHousehold } from "./household.ts";

type Obj = Record<string, unknown>;

/** 指す先の種類 */
export type RefTarget = "member" | "donor" | "event" | "period" | "account" | "debt" | "residence" | "benefit" | "moneyRow" | "coverage";

/** 物の ID を指す欄1つ（世帯の中の1か所） */
export interface RefSite {
  /** 欄の名前（スキーマの x-item か、無ければ「集まり.欄」。例: retirementBenefit.employment） */
  item: string;
  /** 指している ID */
  id: string;
  target: RefTarget;
  /** 欄を持つ物の ID（あれば） */
  holder: string | null;
  /** 指す先に付いている物か（プランを直すときは、連鎖の確かめの後に片付ける） */
  dependent: boolean;
  /** 指す先が無くなったときの片付け */
  fix: () => void;
}

const isObj = (v: unknown): v is Obj => v !== null && typeof v === "object" && !Array.isArray(v);
const list = (o: Obj, k: string): Obj[] => (Array.isArray(o[k]) ? (o[k] as unknown[]).filter(isObj) : []);
const str = (v: unknown): string | null => (typeof v === "string" ? v : null);
const idOf = (o: Obj): string | null => str(o.id);

/** 並び holder[key] から row を外す（空になったら emptied を呼ぶ） */
const dropRow = (holder: Obj, key: string, row: unknown, emptied?: () => void) => () => {
  if (!Array.isArray(holder[key])) return;
  holder[key] = (holder[key] as unknown[]).filter((x) => x !== row);
  if ((holder[key] as unknown[]).length === 0) emptied?.();
};
const clear = (o: Obj, key: string) => () => void delete o[key];

/**
 * 割合の並び（持ち家の名義と持分・死亡保険金の受取人）から row を外し、残りの割合を、外す前の合計に合わせて分け直す
 * （例: 夫婦の共有 50%・50% から配偶者を外すと、ご本人 100%）。残りが無ければ emptied を呼ぶ
 */
const dropShare = (holder: Obj, key: string, row: Obj, emptied: () => void) => () => {
  const rows = list(holder, key);
  const num = (r: Obj) => Number(r.share ?? 0);
  const total = rows.reduce((s, r) => s + num(r), 0);
  const rest = rows.filter((r) => r !== row);
  if (rest.length === 0) return emptied();
  const sum = rest.reduce((s, r) => s + num(r), 0);
  if (total > 0) {
    rest.forEach((r, i) => {
      // 最後の行は、丸めの端数を残さないよう合計から引いた値
      const v = i === rest.length - 1 ? total - rest.slice(0, -1).reduce((s, x) => s + Number(x.share), 0) : sum > 0 ? (num(r) * total) / sum : total / rest.length;
      r.share = String(Math.round(v * 1e6) / 1e6);
    });
  }
  holder[key] = rest;
};

/** 世帯の中の、物の ID を指す欄の全部（input は要求の入力。household と、相続税・必要保障額・前提条件の欄） */
export function refSites(input: Obj): RefSite[] {
  const out: RefSite[] = [];
  const h = isObj(input.household) ? input.household : {};
  const self = h.members !== undefined ? list(h, "members").find((m) => m.kind === "self") : undefined;
  const at = (item: string, id: unknown, target: RefTarget, holder: Obj | null, fix: () => void, dependent = false) => {
    const v = str(id);
    if (v !== null) out.push({ item, id: v, target, holder: holder === null ? null : idOf(holder), dependent, fix });
  };
  const top = (key: string) => (row: Obj) => dropRow(h, key, row);

  for (const m of list(h, "members")) if (isObj(m.outside)) at("member.outside", m.outside.of, "member", m, clear(m.outside, "of"));
  for (const r of list(h, "relations")) {
    for (const k of r.type === "spouse" ? ["a", "b"] : ["parent", "child"]) at(`relation.${k}`, r[k], "member", r, top("relations")(r));
  }
  for (const e of list(h, "events")) at("event.member", e.member, "member", e, top("events")(e));
  for (const p of list(h, "employmentPeriods")) {
    at("employment.member", p.member, "member", p, top("employmentPeriods")(p));
    at("employment.leaveChild", p.leaveChild, "member", p, clear(p, "leaveChild"));
    if (isObj(p.childcareShortHours)) at("employment.childcareShortHours", p.childcareShortHours.child, "member", p, clear(p, "childcareShortHours"));
    at("employment.retirementBenefit", p.retirementBenefit, "benefit", p, clear(p, "retirementBenefit"));
  }
  for (const a of list(h, "accounts")) at("account.owner", a.owner, "member", a, top("accounts")(a));
  for (const c of list(h, "insuranceContracts")) {
    at("insurance.policyholder", c.policyholder, "member", c, top("insuranceContracts")(c));
    at("insurance.insured", c.insured, "member", c, top("insuranceContracts")(c));
    // 満期金・年金の受取人（省略は契約者）
    at("insurance.annuitant", c.annuitant, "member", c, clear(c, "annuitant"));
    // 死亡保険金の受取人: 外した人の行を外し、残りの受取人で割合を分け直す（残りが無ければ受取人を省く＝死亡の当時の配偶者、いなければ子）
    for (const b of list(c, "beneficiaries")) at("insurance.beneficiaries", b.member, "member", c, dropShare(c, "beneficiaries", b, clear(c, "beneficiaries")));
    // 家族特約などの、外した人が被保険者の保障は、その保障ごと外す
    for (const v of list(c, "coverages")) at("insurance.coverages.insured", v.insured, "member", c, dropRow(c, "coverages", v));
    if (isObj(c.schedule)) for (const r of list(c.schedule, "rows")) at("insurance.schedule.coverage", r.coverage, "coverage", c, dropRow(c.schedule, "rows", r));
  }
  for (const key of ["residentTaxAssessments", "pensionRecords", "premiumAssessments"]) for (const x of list(h, key)) at(`${key}.member`, x.member, "member", x, top(key)(x));
  for (const b of list(h, "retirementBenefits")) {
    at("retirementBenefit.member", b.member, "member", b, top("retirementBenefits")(b));
    // 勤め先（働き方の期間）: 空にすると、勤続期間・受け取る時期を入れるまで計算に入らない（未入力の印と計算の知らせ）
    at("retirementBenefit.employment", b.employment, "period", b, clear(b, "employment"), true);
  }
  for (const c of list(h, "careExpenses")) {
    at("care.member", c.member, "member", c, top("careExpenses")(c));
    at("care.payer", c.payer, "member", c, clear(c, "payer"));
  }
  for (const g of list(h, "goals")) {
    at("goal.owner", g.owner, "member", g, top("goals")(g));
    const ed = isObj(g.education) ? g.education : null;
    if (ed !== null) {
      for (const x of list(ed, "gifts")) {
        at("goal.education.gifts.donor", x.donor, "donor", g, clear(x, "donor"));
        at("goal.education.gifts.payer", x.payer, "member", g, clear(x, "payer"));
      }
      // 教育ローンの借り手（親）: その借入ごと外す（借り手は欠かせない欄）
      for (const x of list(ed, "loans")) at("goal.education.loans.borrower", x.borrower, "member", g, dropRow(ed, "loans", x));
    }
  }
  for (const d of list(h, "debts")) {
    for (const x of list(d, "debtors")) at("debt.debtors", x.member, "member", d, dropRow(d, "debtors", x, top("debts")(d)));
    if (isObj(d.creditLife)) {
      const cl = d.creditLife;
      for (const id of Array.isArray(cl.covered) ? cl.covered : [])
        at("debt.creditLife", id, "member", d, () => {
          cl.covered = (Array.isArray(cl.covered) ? cl.covered : []).filter((x) => x !== id);
          if ((cl.covered as unknown[]).length === 0) delete d.creditLife;
        });
    }
    at("debt.inheritedFrom", d.inheritedFrom, "member", d, clear(d, "inheritedFrom"));
    at("debt.pairWith", d.pairWith, "debt", d, clear(d, "pairWith"));
    // 住まい以外の不動産の借入: 不動産を外したら、利息を経費にする先が無い（借入そのものは残す）
    at("debt.property", d.property, "account", d, clear(d, "property"), true);
    const hs = isObj(d.housing) ? d.housing : null;
    if (hs !== null) {
      // 住宅ローン控除の住まい: 持ち家を外したら空にする（ローンそのものは残す。プランを直すときは連鎖の確かめで一緒に外せる）
      at("debt.housing.residence", hs.residence, "residence", d, clear(hs, "residence"), true);
      for (const o of list(hs, "ownership")) at("debt.housing.ownership", o.member, "member", d, dropShare(hs, "ownership", o, clear(hs, "ownership")));
    }
  }
  for (const r of list(h, "residences")) {
    // 名義と持分: 外した人の持分を残りの人で分け直す。名義の人が誰もいなくなったら、ご本人が100%（新しい持ち家と同じ既定）
    for (const o of list(r, "ownership"))
      at("residence.ownership", o.member, "member", r, dropShare(r, "ownership", o, () => (self !== undefined && typeof self.id === "string" ? (r.ownership = [{ member: self.id, share: "1" }]) : delete r.ownership)));
    const pu = isObj(r.purchase) ? r.purchase : null;
    if (pu !== null)
      for (const g of list(pu, "gifts")) {
        at("residence.purchase.gifts.donor", g.donor, "donor", r, clear(g, "donor"));
        at("residence.purchase.gifts.recipient", g.recipient, "member", r, dropRow(pu, "gifts", g));
      }
  }
  for (const d of list(h, "donors")) at("donor.of", d.of, "member", d, clear(d, "of"));
  for (const f of list(h, "incomeFlows")) {
    at("incomeFlow.recipient", f.recipient, "member", f, clear(f, "recipient"));
    at("incomeFlow.counterparty", f.counterparty, "member", f, clear(f, "counterparty"));
  }
  for (const e of list(h, "periodicExpenses")) {
    at("periodicExpense.payer", e.payer, "member", e, clear(e, "payer"));
    at("periodicExpense.counterparty", e.counterparty, "member", e, clear(e, "counterparty"));
    at("periodicExpense.object", e.object, "account", e, clear(e, "object"));
  }
  for (const t of list(h, "transfers")) {
    at("transfer.from", t.from, "account", t, top("transfers")(t));
    at("transfer.to", t.to, "account", t, top("transfers")(t));
    at("transfer.linked", t.linked, "moneyRow", t, clear(t, "linked"));
  }
  for (const c of list(h, "cars")) at("car.owner", c.owner, "member", c, top("cars")(c));
  for (const f of list(h, "advisoryFees")) at("advisoryFee.payer", f.payer, "member", f, top("advisoryFees")(f));

  // 要求の入力の、世帯の外の欄
  const as = isObj(input.assumptions) ? input.assumptions : null;
  if (as !== null) {
    for (const s of list(as, "incomeShocks")) at("assumptions.incomeShocks", s.member, "member", null, dropRow(as, "incomeShocks", s));
    const wd = isObj(as.withdrawal) ? as.withdrawal : null;
    if (wd !== null) for (const o of list(wd, "order")) at("assumptions.withdrawal.order", o.object, "account", null, dropRow(wd, "order", o));
  }
  for (const c of list(input, "contingencies")) at("contingency.member", c.member, "member", null, dropRow(input, "contingencies", c));
  for (const p of list(input, "workChanges")) at("workChanges.member", p.member, "member", null, dropRow(input, "workChanges", p));
  const st = isObj(input.stressTest) ? input.stressTest : null;
  if (st !== null && isObj(st.params)) at("stressTest.member", st.params.member, "member", null, clear(st.params, "member"));
  const pr = isObj(input.protection) ? input.protection : null;
  if (pr !== null) for (const id of Array.isArray(pr.members) ? [...pr.members] : []) at("protection.members", id, "member", null, () => void (pr.members = (pr.members as unknown[]).filter((x) => x !== id)));
  const it = isObj(input.inheritanceTax) ? input.inheritanceTax : null;
  if (it !== null) {
    for (const key of ["members", "adopted"]) for (const id of Array.isArray(it[key]) ? [...(it[key] as unknown[])] : []) at(`inheritanceTax.${key}`, id, "donor", null, () => void (it[key] = (it[key] as unknown[]).filter((x) => x !== id)));
    at("inheritanceTax.lastSurvivor", it.lastSurvivor, "donor", null, clear(it, "lastSurvivor"));
    for (const key of ["heirCounts", "retirementAllowances"]) for (const x of list(it, key)) at(`inheritanceTax.${key}`, x.decedent, "donor", null, dropRow(it, key, x));
    for (const x of list(it, "overrides")) at("inheritanceTax.overrides", x.decedent, "donor", null, clear(x, "decedent"));
  }
  return out;
}

/**
 * エンジンの入力のスキーマ（engine/schemas/engine.input.json）で物の ID を指す欄（id の欄を除く）の全部。refSites はこのどれかを見る
 * （テストでスキーマと突き合わせる。欄が増えたら、片付けの決まりを決めてここと refSites に足す）
 */
export const SCHEMA_REF_FIELDS: readonly string[] = [
  "#account.owner",
  "#advisoryFee.payer",
  "#car.owner",
  "#careExpense.member",
  "#careExpense.payer",
  "#contingency.member",
  "#debt.creditLife.covered[]",
  "#debt.debtors[].member",
  // 住宅ローン控除の入居（名前つきの出来事）: 出来事は、指されている間は外せない（家族のカードの出来事の「外す」は指す欄が無いときだけ）ので片付けない
  "#debt.housing.moveIn",
  "#debt.housing.ownership[].member",
  "#debt.housing.residence",
  "#debt.inheritedFrom",
  "#debt.pairWith",
  "#debt.property",
  "#donor.of",
  "#employmentPeriod.childcareShortHours.child",
  "#employmentPeriod.leaveChild",
  "#employmentPeriod.member",
  "#employmentPeriod.retirementBenefit",
  "#event.member",
  "#goal.education.gifts[].donor",
  "#goal.education.gifts[].payer",
  "#goal.education.loans[].borrower",
  "#goal.owner",
  "#incomeFlow.counterparty",
  "#incomeFlow.recipient",
  "#insuranceContract.annuitant",
  "#insuranceContract.beneficiaries[].member",
  "#insuranceContract.coverages[].insured",
  "#insuranceContract.insured",
  "#insuranceContract.policyholder",
  "#insuranceContract.schedule.rows[].coverage",
  "#member.outside.of",
  "#pensionRecord.member",
  "#periodicExpense.counterparty",
  "#periodicExpense.object",
  "#periodicExpense.payer",
  "#premiumAssessment.member",
  "#relation.a",
  "#relation.b",
  "#relation.child",
  "#relation.parent",
  "#residence.ownership[].member",
  "#residence.purchase.gifts[].donor",
  "#residence.purchase.gifts[].recipient",
  "#residentTaxAssessment.member",
  "#retirementBenefit.employment",
  "#retirementBenefit.member",
  "#transfer.from",
  "#transfer.linked",
  "#transfer.to",
  ".assumptions.incomeShocks[].member",
  ".assumptions.withdrawal.order[].object",
  ".inheritanceTax.adopted[]",
  ".inheritanceTax.heirCounts[].decedent",
  ".inheritanceTax.lastSurvivor",
  ".inheritanceTax.members[]",
  ".inheritanceTax.overrides[].decedent",
  ".inheritanceTax.retirementAllowances[].decedent",
  ".protection.members[]",
  ".stressTest.params.member",
];

/** 指す先の種類ごとの、今ある物の ID */
export function targetIds(input: Obj): Record<RefTarget, Set<string>> {
  const h = isObj(input.household) ? input.household : {};
  const ids = (...keys: string[]) => new Set(keys.flatMap((k) => list(h, k).map(idOf)).filter((x): x is string => x !== null));
  const members = ids("members");
  return {
    member: members,
    donor: new Set([...members, ...ids("donors")]),
    event: ids("events"),
    period: ids("employmentPeriods"),
    account: ids("accounts"),
    debt: ids("debts"),
    residence: ids("residences"),
    benefit: ids("retirementBenefits"),
    moneyRow: ids("incomeFlows", "periodicExpenses"),
    coverage: new Set(list(h, "insuranceContracts").flatMap((c) => list(c, "coverages").map(idOf)).filter((x): x is string => x !== null)),
  };
}

/** 指す先の無い欄（外した物を指したままの欄。テストの見張りと、確かめに使う） */
export function danglingRefs(input: Obj): RefSite[] {
  const t = targetIds(input);
  return refSites(input).filter((s) => !t[s.target].has(s.id));
}

const isTimepoint = (v: unknown): v is Timepoint =>
  isObj(v) && Object.keys(v).length > 0 && Object.keys(v).every((k) => k === "at" || k === "memberAge" || k === "event" || k === "offset") && ("memberAge" in v || "event" in v);

/**
 * 無くなった人の年齢・無くなった出来事で決めた時点を、外す前の世帯で解いた年月に直す（外した後に解けない時点を残さない。0038）。
 * 直した数を返す
 */
function freezeGoneTimepoints(input: Obj, before: Household, goneMembers: ReadonlySet<string>, goneEvents: ReadonlySet<string>): number {
  let n = 0;
  const hit = (t: Timepoint) => (t.memberAge !== undefined && goneMembers.has(t.memberAge.member)) || (t.event !== undefined && goneEvents.has(t.event));
  const fix = (v: unknown): unknown => {
    if (isTimepoint(v) && hit(v)) {
      const ym = resolveTimepoint(before, v);
      if (ym === null) return v;
      n++;
      return { at: ym };
    }
    if (Array.isArray(v)) {
      for (let i = 0; i < v.length; i++) v[i] = fix(v[i]);
      return v;
    }
    if (isObj(v)) for (const [k, x] of Object.entries(v)) if (k !== "valueStates") v[k] = fix(x);
    return v;
  };
  fix(input.household);
  return n;
}

export interface KeepRefsOptions {
  /** 指す先に付いている物（dependent）の欄も片付ける。プランを直すときの連鎖の確かめの前は false */
  dependents?: boolean;
}

/**
 * 外した物を指す欄を片付けた要求の入力（after を書き換える）: before にあって after に無い物を指す欄を、欄ごとの決まりで片付ける。
 * 片付けで外れた物（人の口座・保険の保障など）を指す欄も、続けて片付ける。片付けた欄の数を返す
 */
export function dropRefsToGone(before: Obj, after: Obj, o: KeepRefsOptions = {}): number {
  const had = targetIds(before);
  const bh = (isObj(before.household) ? before.household : { members: [], events: [] }) as unknown as Household;
  let n = 0;
  for (let round = 0; round < 10; round++) {
    const now = targetIds(after);
    const gone = (t: RefTarget) => new Set([...had[t]].filter((x) => !now[t].has(x)));
    const g = Object.fromEntries((Object.keys(had) as RefTarget[]).map((t) => [t, gone(t)])) as Record<RefTarget, Set<string>>;
    const frozen = freezeGoneTimepoints(after, bh, g.member, g.event);
    const sites = refSites(after).filter((s) => (o.dependents !== false || !s.dependent) && g[s.target].has(s.id));
    for (const s of sites) s.fix();
    n += frozen + sites.length;
    if (frozen === 0 && sites.length === 0) break;
  }
  return n;
}

/** 操作の前後の世帯から、外した物を指す欄を片付けた世帯（片付ける欄が無ければ after のまま） */
export function keepRefs(before: WorkingHousehold, after: WorkingHousehold, o: KeepRefsOptions = {}): WorkingHousehold {
  if (before === after) return after;
  const b = before.request.input as unknown as Obj;
  const had = targetIds(b);
  const now = targetIds(after.request.input as unknown as Obj);
  if ((Object.keys(had) as RefTarget[]).every((t) => [...had[t]].every((x) => now[t].has(x)))) return after;
  const request = structuredClone(after.request);
  return dropRefsToGone(b, request.input as unknown as Obj, o) === 0 ? after : { ...after, request };
}
