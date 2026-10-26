// 入っていない物（未入力（0円で計算中）の物）と「推定で埋める」（0035 の11・0041）。
// - 古い世帯を開いても、ここの推定は自動で入れない（黙って書き換えない）。確かめの一覧とカードのパネルに「未入力」として出し、
//   FP が「推定で埋める」（1件ごと・カードごと・まとめて）を押したときだけ入れる。無いと決めたら「該当なし」
// - 新しく入れるとき（子を足す・会社員として入れる・働き方を正社員や公務員にする）は、最初から推定で入れる（ensure*）
// - 推定の目安は今ある関数（hearing/src/estimates.ts・教育の標準の進路の型）で作れる範囲だけ。作れない物は「推定で埋める」を出さない
import type { EducationStage, EmploymentPeriod, Household, Member } from "../../engine/types.ts";
import { retirementLumpSumEstimate, salaryEstimate } from "../../../../hearing/src/estimates.ts";
import { addMonths, ageAt, ageReachedMonth } from "../levers.ts";
import { resolveTimepoint, type StageId } from "./form.ts";
import { estimatedBox, mutate, newId, type WorkingHousehold } from "./household.ts";
import { livingEstimate } from "./estimates.ts";
import { startLiving } from "./livingStages.ts";
import { memberLabel } from "./labels.ts";
import { putRow, rowAt, type StateRow } from "./rows.ts";
import { defaultStages } from "./stages/education.ts";
import { currentPeriodId } from "../store/readings.ts";
import { missingUnemployment, putEstimate, UNEMPLOYMENT_BASIS, UNEMPLOYMENT_ITEM, unemploymentEstimate } from "./claims.ts";

type Obj = Record<string, unknown>;
const inputOf = (wh: WorkingHousehold): Obj => wh.request.input as unknown as Obj;

/** 計算基準月にしている働き方の期間（無ければ次に始まる期間、それも無ければ最後の期間。stages/work.ts の currentPeriod と同じ決まり） */
function currentPeriod(h: Household, memberId: string, baseMonth: string): EmploymentPeriod | undefined {
  const id = currentPeriodId({ household: h, baseMonth } as unknown as Obj, memberId);
  return id === null ? undefined : (h.employmentPeriods ?? []).find((p) => p.id === id);
}

/** カードを「当てはまらない」にする（保存した項目の印。物の無いカードは当てはまらないと読む。0035 の2） */
const markCard = (wh: WorkingHousehold, id: string): WorkingHousehold => (wh.confirmed.includes(id) ? wh : { ...wh, confirmed: [...wh.confirmed, id] });

/** 入っていない物1件（確かめの一覧のいちばん上・カードのパネルの上に出す） */
export interface Gap {
  id: string;
  card: StageId;
  /** 例: 「上のお子さんの教育費」 */
  label: string;
  /** 今どう計算しているか（「0円で計算しています」） */
  note: string;
  /** 推定で埋める（目安を作れないときは無い） */
  fill?: (wh: WorkingHousehold) => WorkingHousehold;
  /** この推定の根拠（「推定で埋める」の横に出す） */
  basis?: string;
  /** 該当なし（FP が「無い」と決める） */
  none?: (wh: WorkingHousehold) => WorkingHousehold;
  /** 「該当なし」の言い方（例: 「勤め先に制度が無い」） */
  noneLabel?: string;
}

const estimatedRow = (method: string, basis: string): StateRow => ({ state: "estimated", origin: { kind: "auto" }, estimate: { method, basis } });
const notApplicableRow: StateRow = { state: "notApplicable", origin: { kind: "manual" } };

// ---- 教育 ----

/** 教育の進路を推定で入れたときの根拠（標準の進路の型。0010 の追記 2026-10-25） */
export const EDUCATION_BASIS = "標準の進路の型（幼稚園〜高校は公立、大学は私立・文系・自宅）";

/** 子の進路の値の状態の行の当て先（進路の段の並び全体） */
export const educationStagesAddress = (goalId: string) => ({ target: { object: goalId }, item: "goal.education", at: ["stages"] });

const educationGoalOf = (h: Household, childId: string) => (h.goals ?? []).find((g) => g.kind === "education" && g.owner === childId);

/** 子の進路を推定（標準の進路の型）で入れる。もう進路があるか、これからの段が無ければ同じ世帯 */
export function fillEducation(wh: WorkingHousehold, childId: string): WorkingHousehold {
  const h = wh.request.input.household;
  const child = h.members.find((m) => m.id === childId && m.kind === "child");
  if (child === undefined || educationGoalOf(h, childId) !== undefined) return wh;
  const stages = defaultStages(child, wh.request.input.baseMonth);
  if (stages.length === 0) return wh;
  const id = newId();
  return mutate(wh, (hh, req) => {
    (hh.goals ??= []).push({ id, kind: "education", owner: childId, education: { stages } });
    putRow(req.input as unknown as Obj, educationStagesAddress(id), estimatedRow("standard", EDUCATION_BASIS));
  });
}

/** 子の教育費を「該当なし」にする（段の無い進路と、該当なしの行） */
function educationNone(wh: WorkingHousehold, childId: string): WorkingHousehold {
  const h = wh.request.input.household;
  if (educationGoalOf(h, childId) !== undefined) return wh;
  const id = newId();
  return mutate(wh, (hh, req) => {
    (hh.goals ??= []).push({ id, kind: "education", owner: childId, education: { stages: [] as EducationStage[] } });
    putRow(req.input as unknown as Obj, educationStagesAddress(id), notApplicableRow);
  });
}

/** 推定のままの進路を、子の生年月・計算基準月に合わせて入れ直す（推定の入れ直し。FP が直した進路は変えない）。h をそのまま書き換える */
export function refreshEducation(h: Household, baseMonth: string): void {
  const input = { household: h } as unknown as Obj;
  for (const g of h.goals ?? []) {
    if (g.kind !== "education" || g.education === undefined) continue;
    const row = rowAt(input, educationStagesAddress(g.id));
    if (row?.state !== "estimated" || row.origin.kind !== "auto") continue;
    const child = h.members.find((m) => m.id === g.owner);
    if (child === undefined) continue;
    const next = defaultStages(child, baseMonth);
    const strip = (s: readonly EducationStage[]) => JSON.stringify(s.map(({ id: _id, ...rest }) => rest));
    if (strip(next) !== strip(g.education.stages)) g.education.stages = next;
  }
}

// ---- 退職金 ----

const RETIREMENT_TYPES = new Set(["regular", "civilServant"]);
/** 働き方の期間の「退職給付」の当て先（該当なしの行を置く所） */
const benefitAddress = (periodId: string) => ({ target: { object: periodId }, item: "employment.retirementBenefit", at: [] as string[] });

/** 定年（期間の終わり。無ければ60歳の前月）・勤続年数・辞める年齢 */
function serviceOf(h: Household, m: Member, p: EmploymentPeriod): { to: string; years: number; age: number } | null {
  const from = resolveTimepoint(h, p.from);
  const to = (p.to !== null ? resolveTimepoint(h, p.to) : null) ?? addMonths(ageReachedMonth(m, 60), -1);
  if (from === null || to < from) return null;
  const [fy, fm] = from.split("-").map(Number) as [number, number];
  const [ty, tm] = to.split("-").map(Number) as [number, number];
  return { to, years: Math.floor(((ty - fy) * 12 + (tm - fm) + 1) / 12), age: ageAt(m, addMonths(to, 1)) };
}

/** 退職金の目安（会社員は統計の退職一時金、公務員は退職手当の見込みの計算に使う最終の月給の目安）。作れなければ null */
function retirementEstimate(h: Household, m: Member, p: EmploymentPeriod): { benefit: Obj; basis: string } | null {
  const s = serviceOf(h, m, p);
  if (s === null) return null;
  if (p.type === "regular") {
    const est = retirementLumpSumEstimate({ reason: "mandatory", yearsOfService: s.years, ageAtRetirement: s.age });
    if (est === null) return null;
    return { benefit: { kind: "lumpSum", amount: estimatedBox(est.value, est.basis) }, basis: est.basis };
  }
  const sal = salaryEstimate("civilServant", m.sex, { age: Math.max(18, s.age - 1) });
  if (sal === null) return null;
  const basis = `退職手当の見込みの計算（最終の月給は ${sal.annual.basis} を12で割った目安）`;
  return { benefit: { kind: "civilServantAllowance", estimate: { finalMonthly: Math.round(sal.annual.value / 12), reason: "retirementAge" }, valueStates: { "retirementBenefit.estimate": estimatedRow("derived", basis) } }, basis };
}

/** 退職金の目安を入れる（今の働き方が正社員・公務員で、その人の退職金がまだ無いとき）。該当なしの印は外す */
export function fillRetirement(wh: WorkingHousehold, memberId: string): WorkingHousehold {
  const h = wh.request.input.household;
  const m = h.members.find((x) => x.id === memberId);
  const p = m === undefined ? undefined : currentPeriod(h, m.id, wh.request.input.baseMonth);
  if (m === undefined || p === undefined || !RETIREMENT_TYPES.has(p.type) || (h.retirementBenefits ?? []).some((b) => b.member === memberId)) return wh;
  const est = retirementEstimate(h, m, p);
  if (est === null) return wh;
  return mutate(wh, (hh, req) => {
    (hh.retirementBenefits ??= []).push({ id: newId(), member: memberId, employment: p.id, ...est.benefit } as never);
    putRow(req.input as unknown as Obj, benefitAddress(p.id), undefined);
  });
}

/** 退職金を「該当なし」（勤め先に制度が無い）にする: 今の働き方の期間に該当なしの行 */
function retirementNone(wh: WorkingHousehold, memberId: string): WorkingHousehold {
  const p = currentPeriod(wh.request.input.household, memberId, wh.request.input.baseMonth);
  if (p === undefined) return wh;
  return mutate(wh, (_h, req) => void putRow(req.input as unknown as Obj, benefitAddress(p.id), notApplicableRow));
}

/** 今の働き方の退職金が「該当なし」か */
export function retirementNotApplicable(wh: WorkingHousehold, memberId: string): boolean {
  const p = currentPeriod(wh.request.input.household, memberId, wh.request.input.baseMonth);
  return p !== undefined && rowAt(inputOf(wh), benefitAddress(p.id))?.state === "notApplicable";
}

/** 新しく入れたとき: 今の働き方が正社員・公務員になったら、退職金の目安を最初から入れる（該当なしにしてあれば入れない） */
export function ensureRetirement(wh: WorkingHousehold, memberId: string): WorkingHousehold {
  return retirementNotApplicable(wh, memberId) ? wh : fillRetirement(wh, memberId);
}

// ---- 住まい ----

/** 賃貸の家賃を推定で入れたときの根拠（統計の家賃の目安はまだ無い。目安のボタンと同じ値） */
export const RENT_BASIS = "目安のボタンの値（家賃 月8万円。地域・人数の統計の目安はまだありません）";
export const RENT_STANDARD = 80000;

function fillHousing(wh: WorkingHousehold): WorkingHousehold {
  const h = wh.request.input.household;
  if ((h.residences ?? []).length > 0) return wh;
  return mutate(wh, (hh, req) => void (hh.residences ??= []).push({ id: newId(), kind: "rent", from: { at: req.input.baseMonth }, to: null, rent: { monthly: { value: RENT_STANDARD, state: "estimated", origin: { kind: "auto" }, estimate: { method: "standard", basis: RENT_BASIS } } } } as never));
}

// ---- 一覧 ----

/** 入っていない物の一覧（古い世帯を開いたとき、自動で入れずにここに出す） */
export function gapsOf(wh: WorkingHousehold): Gap[] {
  const h = wh.request.input.household;
  const base = wh.request.input.baseMonth;
  const confirmed = new Set(wh.confirmed);
  const out: Gap[] = [];
  for (const c of h.members.filter((m) => m.kind === "child")) {
    if (educationGoalOf(h, c.id) !== undefined || defaultStages(c, base).length === 0) continue;
    out.push({
      id: `education/${c.id}`,
      card: "education",
      label: `${memberLabel(wh, c.id)}の教育費`,
      note: "進路が入っていないので、教育費を0円で計算しています",
      fill: (w) => fillEducation(w, c.id),
      basis: EDUCATION_BASIS,
      none: (w) => educationNone(w, c.id),
      noneLabel: "教育費なし",
    });
  }
  for (const m of h.members.filter((x) => x.kind === "self" || x.kind === "spouse")) {
    const p = currentPeriod(h, m.id, base);
    if (p === undefined || !RETIREMENT_TYPES.has(p.type) || (h.retirementBenefits ?? []).some((b) => b.member === m.id) || retirementNotApplicable(wh, m.id)) continue;
    const est = retirementEstimate(h, m, p);
    out.push({
      id: `work/retirement/${m.id}`,
      card: "retirement",
      label: `${memberLabel(wh, m.id)}の退職金`,
      note: "退職金が入っていないので、0円で計算しています",
      ...(est !== null ? { fill: (w: WorkingHousehold) => fillRetirement(w, m.id), basis: est.basis } : {}),
      none: (w) => retirementNone(w, m.id),
      noneLabel: "勤め先に制度が無い",
    });
  }
  // 失業給付を入れていない勤め（古い世帯。推定なら受け取る期間）: 推定で埋める（おまかせ）か、受け取らない
  for (const p of missingUnemployment(h)) {
    const to = resolveTimepoint(h, p.to);
    const when = to === null ? "" : `${Number(to.slice(0, 4))}年${Number(to.slice(5, 7))}月に辞めた後`;
    const edit = (w: WorkingHousehold, fn: (x: EmploymentPeriod, hh: Household) => void) =>
      mutate(w, (hh) => {
        const x = (hh.employmentPeriods ?? []).find((y) => y.id === p.id);
        if (x !== undefined) fn(x, hh);
      });
    out.push({
      id: `work/unemployment/${p.id}`,
      card: "work",
      label: `${memberLabel(wh, p.member)}の失業給付（${when}）`,
      note: "失業給付を入れていないので、受け取らないで計算しています",
      fill: (w) => edit(w, (x, hh) => putEstimate(x, UNEMPLOYMENT_ITEM, unemploymentEstimate(hh, x), UNEMPLOYMENT_BASIS)),
      basis: UNEMPLOYMENT_BASIS,
      none: (w) => edit(w, (x) => void (x.unemploymentClaim = false)),
      noneLabel: "受け取らない",
    });
  }
  if ((h.livingExpenses ?? []).length === 0) {
    const est = livingEstimate(h, base);
    out.push({
      id: "living",
      card: "living",
      label: "基本生活費",
      note: "基本生活費が入っていないので、0円で計算しています",
      fill: (w) => mutate(w, (hh, req) => void (hh.livingExpenses ??= []).push(startLiving(hh, base, req.input.endYear, newId()))),
      basis: est.basis,
    });
  }
  if ((h.residences ?? []).length === 0 && !(h.debts ?? []).some((d) => d.kind === "mortgage") && !confirmed.has("housing"))
    out.push({ id: "housing", card: "housing", label: "住居費", note: "住まいが入っていないので、住居費を0円で計算しています", fill: fillHousing, basis: RENT_BASIS, none: (w) => markCard(w, "housing"), noneLabel: "住居費なし" });
  if ((h.insuranceContracts ?? []).length === 0 && !confirmed.has("insurance"))
    out.push({ id: "insurance", card: "insurance", label: "保険", note: "保険が入っていません（保険料・保障を0円で計算しています。保障の額は目安で入れません）", none: (w) => markCard(w, "insurance"), noneLabel: "保険に入っていない" });
  return out;
}

/** 推定で埋める（まとめて。card を渡すとそのカードだけ） */
export function fillAll(wh: WorkingHousehold, card?: string): { wh: WorkingHousehold; count: number } {
  let w = wh;
  let count = 0;
  for (const g of gapsOf(wh)) {
    if (g.fill === undefined || (card !== undefined && g.card !== card)) continue;
    const next = g.fill(w);
    if (next !== w) count++;
    w = next;
  }
  return { wh: w, count };
}
