// 2. 働き方と収入: 今の働き方と年収（簡易）、定年後の予定（再雇用の年収・何歳まで）、働き方の期間の一覧（詳細）。退職金・企業年金は 3. のカード（retirement.ts）。ここは読むだけの1行
// 被保険者の種別（第1〜3号）は入れない（エンジンが働き方の期間から導く。0008 の4）
import type { Box, EmploymentPeriod, Household, Member } from "../../../engine/types.ts";
import type { Timepoint } from "../../../engine/types.ts";
import { addMonths, ageAt, ageReachedMonth, applyLevers, applyRetireMonth, readLevers } from "../../levers.ts";
import { resolveTimepoint } from "../../timepoint.ts";
import { businessEstimate, careerStartMonth, ensureResidentTax, residentTaxEstimate, residentTaxYear, salaryAge, salaryEstimate, smrEstimate, smrMonth } from "../estimates.ts";
import { healthRateEstimate } from "../../../../../hearing/src/estimates.ts";
import { byId, field, plain, rateBox, removeAction, timepointField, timeView, yenBox, type ActionDef, type FieldDef, type Finder, type GroupDef, type SectionDef, type StageDef, type Val } from "../form.ts";
import { boxBasis, estimatedBox, mutate, newId, periodsOf, reemploymentOf, type PostRetirement, type WorkingHousehold } from "../household.ts";
import { continuationApplies, CONTINUATION_BASIS, CONTINUATION_ITEM, defaultEndsWith, dropClaim, isEstimated, markNewPeriods, putEstimate, unemploymentApplies, unemploymentEstimate, UNEMPLOYMENT_BASIS, UNEMPLOYMENT_ITEM } from "../claims.ts";
import { ensureRetirement } from "../fill.ts";
import { earners, EMPLOYMENT_TYPES, HEALTH_INSURANCE, KYOKAI_BRANCHES, LEAVE_KINDS, memberLabel, PENSION_CATEGORY, POST_RETIREMENT_TYPES } from "../labels.ts";
import { formatYearMonth } from "../units.ts";
import { readGroup, readLine } from "../readLines.ts";

/** 働き方の期間の時点は年月で持つ（定年・再雇用の見つけ方などが年月で読むため。0038） */
const PERIOD_MONTH_ONLY = "働き方の期間は年月で持ちます（年齢・今からで入れても、その年月にします）";

/** 「○歳になる前の月まで」と言える月なら、その年齢（働く最後・定年の欄）。言えなければ null */
function ageBefore(m: Member, lastMonth: string): number | null {
  const age = ageAt(m, addMonths(lastMonth, 1));
  return addMonths(ageReachedMonth(m, age), -1) === lastMonth ? age : null;
}

const SALARIED = new Set(["regular", "contract", "partTime", "civilServant", "executive"]);
const periods = (h: Household) => h.employmentPeriods;

/** 計算基準月にしている働き方の期間。無ければ次に始まる期間、それも無ければ最後の期間 */
export function currentPeriod(h: Household, memberId: string, baseMonth: string): EmploymentPeriod | undefined {
  const ps = periodsOf(h, memberId);
  return (
    ps.find((p) => (p.from.at ?? "") <= baseMonth && (p.to === null || (p.to.at ?? "9999-12") >= baseMonth)) ??
    ps.find((p) => (p.from.at ?? "") > baseMonth) ??
    ps.at(-1)
  );
}

/** 給与の種類ごとの初めの値（健康保険・厚生年金・勤め先）。種類を変えたとき、前の種類の初めの値のままの欄はこの値に入れ替える */
function salariedDefaults(type: string): Pick<EmploymentPeriod, "healthInsurance" | "pensionCategory" | "employer"> {
  return {
    healthInsurance: fixHealthInsurance({ kind: type === "civilServant" ? "mutualAid" : type === "partTime" ? "dependent" : "kyokaikenpo" }),
    pensionCategory: type === "civilServant" ? "employee3" : type === "partTime" ? "none" : "employee1",
    employer: { size: type === "partTime" ? 50 : 100, weeklyHours: type === "partTime" ? "20" : "40" },
  };
}

/** 自動で入れた推定の値（出どころ auto のまま。FP が入れた値・確定の値ではない） */
const isAutoBox = (b: { state?: string; origin?: { kind?: string } } | undefined): boolean => b !== undefined && b.state === "estimated" && b.origin?.kind === "auto";
const sameJson = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/**
 * 働き方の種類を変える: その種類に要る欄を足し、要らない欄を外す（0008 の4・スキーマの条件）。
 * 給与の種類どうし（正社員→パートなど）で変えたときは、推定のままの年収・賞与・標準報酬月額を新しい種類の推定に入れ替え、
 * 前の種類の初めの値のままの健康保険・厚生年金・勤め先も新しい種類の初めの値に入れ替える。FP が入れた値は残す（0008 の追記 2026-10-11 の2・2026-10-25）
 */
export function convertPeriod(p: EmploymentPeriod, type: string, member: Member | undefined, baseMonth: string): EmploymentPeriod {
  const { salary, business, healthInsurance, pensionCategory, employer, standardMonthlyRemuneration, leaveKind, leaveChild, childcareShortHours, corporatePension, employmentInsuranceCovered, employeeInsurance, ...rest } = p;
  const out: EmploymentPeriod = { ...rest, type };
  const sex = member?.sex ?? "male";
  if (SALARIED.has(type)) {
    // 推定の年齢は、その期間の始まりと計算基準月の遅いほう（勤め先の規模は推定に使わない。規模は詳細で入れたときだけの決まり）
    const est = salaryEstimate(type, sex, member === undefined ? {} : { age: salaryAge(member, p, baseMonth) });
    const was = SALARIED.has(p.type) && p.type !== type ? salariedDefaults(p.type) : null;
    const now = salariedDefaults(type);
    const keep = <T,>(cur: T | undefined, before: T | undefined, next: T): T => (cur === undefined || (was !== null && sameJson(cur, before)) ? next : cur);
    out.healthInsurance = keep(healthInsurance, was?.healthInsurance, now.healthInsurance as NonNullable<EmploymentPeriod["healthInsurance"]>);
    out.pensionCategory = keep(pensionCategory, was?.pensionCategory, now.pensionCategory as NonNullable<EmploymentPeriod["pensionCategory"]>);
    out.employer = keep(employer, was?.employer, now.employer as NonNullable<EmploymentPeriod["employer"]>);
    const annual = est !== null ? estimatedBox(est.annual.value, est.annual.basis) : estimatedBox(0, "未入力");
    const bonus = est !== null ? estimatedBox(est.bonus.value, est.bonus.basis) : estimatedBox(0, "未入力");
    out.salary =
      salary === undefined
        ? { annual, bonus }
        : { ...salary, annual: isAutoBox(salary.annual) ? annual : salary.annual, ...(isAutoBox(salary.bonus) ? { bonus } : {}) };
    const smr = standardMonthlyRemuneration;
    out.standardMonthlyRemuneration = smr !== undefined && !(isAutoBox(smr.health) && isAutoBox(smr.pension)) ? smr : smrEstimate(out.salary.annual.value ?? 0, smrMonth(p, baseMonth));
    if (corporatePension !== undefined) out.corporatePension = corporatePension;
    if (employmentInsuranceCovered !== undefined) out.employmentInsuranceCovered = employmentInsuranceCovered;
    if (employeeInsurance !== undefined) out.employeeInsurance = employeeInsurance;
    if (childcareShortHours !== undefined) out.childcareShortHours = childcareShortHours;
  } else if (type === "selfEmployed") {
    const est = businessEstimate();
    out.business = business ?? { income: estimatedBox(est.value, est.basis) };
  } else if (type === "leave") {
    out.leaveKind = leaveKind ?? "childcare";
    if (leaveChild !== undefined) out.leaveChild = leaveChild;
  }
  return out;
}

/** 健保組合・共済の料率が分からないときの目安（被保険者の負担分。ヒアリングシートの取り込みと同じ hearing/src/estimates.ts の目安） */
const unionRate = (kind: "union" | "mutualAid", branch: string) => {
  const e = healthRateEstimate(kind, { branch });
  return { value: e.value, state: "estimated", origin: { kind: "auto" }, estimate: { method: "statistic", basis: e.basis } };
};

/** 健康保険の種類に要る欄をそろえる: 協会けんぽは支部、健保組合・共済は料率（スキーマの条件） */
export function fixHealthInsurance(hi: { kind: string; [key: string]: unknown }, defaultBranch = "kyokaikenpo.13"): { kind: string; [key: string]: unknown } {
  if (hi.kind === "kyokaikenpo") {
    hi.insurer ??= defaultBranch;
    delete hi.employeeRate;
    delete hi.careEmployeeRate;
    delete hi.childSupportEmployeeRate;
  } else {
    delete hi.insurer;
    if (hi.kind === "union" || hi.kind === "mutualAid") hi.employeeRate ??= unionRate(hi.kind, defaultBranch);
    else {
      delete hi.employeeRate;
      delete hi.careEmployeeRate;
      delete hi.childSupportEmployeeRate;
    }
  }
  return hi;
}

/** 定年（今の勤め先）の期間: 定年後の予定の年齢の前月に終わる期間。無ければ定年後の予定がない */
function mainPeriod(h: Household, m: Member, post: PostRetirement | undefined): EmploymentPeriod | undefined {
  if (post === undefined) return undefined;
  const end = addMonths(ageReachedMonth(m, post.fromAge), -1);
  return periodsOf(h, m.id).find((p) => p.to?.at === end);
}

function setRetireAge(wh: WorkingHousehold, m: Member, age: number): WorkingHousehold {
  const post = wh.postRetirement[m.id];
  const request = applyLevers(wh.request, m.id, { retireAge: age }, (() => {
    const r = reemploymentOf(post);
    return r !== undefined ? { reemployment: r } : {};
  })());
  // 定年後の年収が推定のままなら、作り直した定年後の期間でも推定の箱のまま（打ち手は確定の箱で作るため）
  const was = postBox(wh.request.input.household, m, post);
  const next = { ...wh, request };
  return was !== undefined && isAutoBox(was.box) && was.box.value != null ? markPostSalary(next, m, was.box.value, boxBasis(was.box) ?? "推定") : next;
}

function setMainEnd(wh: WorkingHousehold, m: Member, age: number): WorkingHousehold {
  const post = wh.postRetirement[m.id];
  const main = mainPeriod(wh.request.input.household, m, post);
  if (post === undefined || main === undefined) return wh;
  const oldEnd = main.to?.at as string;
  const newEnd = addMonths(ageReachedMonth(m, age), -1);
  const next = mutate(wh, (h) => {
    const ps = periodsOf(h, m.id);
    const mp = ps.find((p) => p.id === main.id) as EmploymentPeriod;
    mp.to = { at: newEnd };
    // 定年の後の期間: 新しい定年の翌月から始める。新しい定年より前に終わる期間は外す
    const after = ps.filter((p) => (p.from.at ?? "") > oldEnd);
    const drop = new Set<string>();
    after.forEach((p, i) => {
      const end = p.to?.at ?? "9999-12";
      if (end <= newEnd) drop.add(p.id);
      else if (i === after.findIndex((x) => !drop.has(x.id) && (x.to?.at ?? "9999-12") > newEnd)) p.from = { at: addMonths(newEnd, 1) };
    });
    h.employmentPeriods = (h.employmentPeriods ?? []).filter((p) => !drop.has(p.id));
  });
  return { ...next, postRetirement: { ...next.postRetirement, [m.id]: { ...post, fromAge: age } } };
}

/** 定年の後の最初の期間 */
function postPeriod(h: Household, m: Member, post: PostRetirement | undefined): EmploymentPeriod | undefined {
  const main = mainPeriod(h, m, post);
  if (main?.to?.at === undefined) return undefined;
  const start = addMonths(main.to.at, 1);
  return periodsOf(h, m.id).find((p) => p.from.at === start);
}

// ---- 定年と定年後の再雇用の推定（新しい世帯。0047）----

/** 定年の推定の根拠 */
const MAIN_END_BASIS = "定年60歳（定年制の企業の多くが60歳）";
const CIVIL_END_BASIS = "公務員の定年（生まれた年度で61〜65歳。国家公務員法の改正の段階）";
const POST_TYPE_BASIS = "65歳までの雇用確保の決まりで、65歳まで再雇用";

/** 生まれた年度（4月2日〜翌年4月1日生まれ。1日生まれは前の日に年齢に達するので、4月1日生まれは前の年度） */
function birthFiscalYear(m: Member): number {
  const [y, mo] = m.birth.birthYearMonth.split("-").map(Number) as [number, number];
  return mo > 4 || (mo === 4 && !m.birth.bornOnFirst) ? y : y - 1;
}

/**
 * 公務員の定年の推定（生まれた年度ごと）: 定年は2023年度から2年ごとに1歳ずつ上がり2031年度に65歳（国家公務員法の改正）。
 * その年度の定年に達した年齢で辞めるとみなす（年度末でなく「その年齢になる前の月」の決まりにそろえる近似）
 */
export function civilRetirementAge(m: Member): number {
  const fy = birthFiscalYear(m);
  const limit = (year: number) => (year <= 2022 ? 60 : year >= 2031 ? 65 : 61 + Math.floor((year - 2023) / 2));
  for (let a = 60; a < 65; a++) if (limit(fy + a) <= a) return a;
  return 65;
}

/** 定年の推定（正社員は60歳、公務員は生まれた年度の定年） */
export const retirementAgeEstimate = (type: string, m: Member): { age: number; basis: string } => (type === "civilServant" ? { age: civilRetirementAge(m), basis: CIVIL_END_BASIS } : { age: 60, basis: MAIN_END_BASIS });

/**
 * 定年後の再雇用の年収の推定: 定年前の年収 ×（60〜64歳の平均÷55〜59歳の平均）。平均は同じ働き方・性別の年齢階級の表（hearing/src/estimates.ts）。
 * 表が無い働き方は null
 */
export function reemploymentSalary(type: string, m: Member, mainAnnual: number): { value: number; basis: string } | null {
  const after = salaryEstimate(type, m.sex, { age: 62 });
  const before = salaryEstimate(type, m.sex, { age: 57 });
  if (after === null || before === null || before.annual.value <= 0 || mainAnnual <= 0) return null;
  const ratio = after.annual.value / before.annual.value;
  const value = Math.round((mainAnnual * ratio) / 1000) * 1000;
  return { value, basis: `定年前の年収×${(ratio * 100).toFixed(0)}%（同じ働き方・性別の60〜64歳の平均÷55〜59歳の平均。賃金の統計の年齢階級の表）` };
}

const estKeys = (m: Member) => ({ mainEnd: `work/${m.id}/mainEnd`, postType: `work/${m.id}/postType`, retireAge: `work/${m.id}/retireAge` });

/** 定年後の期間の年収を推定の箱にする（打ち手が作った期間の箱は確定の箱なので、推定のときは推定の箱に直す） */
function markPostSalary(wh: WorkingHousehold, m: Member, value: number, basis: string): WorkingHousehold {
  const pp = postPeriod(wh.request.input.household, m, wh.postRetirement[m.id]);
  if (pp === undefined) return wh;
  return mutate(wh, (h) => {
    const x = (h.employmentPeriods ?? []).find((y) => y.id === pp.id);
    // 出し方は derived（ほかの値からの推定）。統計の推定（statistic）にすると、推定の入れ直しが再雇用の働き方の統計の値に置き換えるため
    if (x?.salary !== undefined) x.salary = { ...x.salary, annual: { value, state: "estimated", origin: { kind: "auto" }, estimate: { method: "derived", basis } } as Box<number> };
  });
}

/**
 * 新しく入れた正社員・公務員の定年と定年後の予定を推定で入れる: 定年（正社員60歳・公務員は生まれた年度の定年）、定年が65歳より前なら
 * 65歳まで再雇用（契約・嘱託）で年収は定年前の年収×60〜64歳の平均の割合。どれも仮の印（推定）で、FP が直したら外れる
 */
export function estimatePost(wh: WorkingHousehold, m: Member): WorkingHousehold {
  const h = wh.request.input.household;
  const main = currentPeriod(h, m.id, wh.request.input.baseMonth);
  if (main === undefined || (main.type !== "regular" && main.type !== "civilServant") || main.to?.at === undefined) return wh;
  const k = estKeys(m);
  const end = retirementAgeEstimate(main.type, m);
  const fromAge = ageAt(m, addMonths(main.to.at, 1));
  let w: WorkingHousehold = { ...wh, postRetirement: { ...wh.postRetirement, [m.id]: { fromAge, type: null, annualSalary: null } } };
  if (fromAge !== end.age) w = setMainEnd(w, m, end.age);
  const marks: Record<string, string> = { [k.mainEnd]: end.basis };
  // 今の勤め先の期間の辞め方は定年（推定。「60歳になる前の月まで」の期間は、エンジンの自動の決まりでは自己都合になるため書く）
  w = mutate(w, (hh) => {
    const x = (hh.employmentPeriods ?? []).find((y) => y.id === main.id);
    if (x === undefined || (x.endsWith !== undefined && !isEstimated(x, "employment.endsWith"))) return;
    x.endsWith = "retirement";
    const o = x as Record<string, unknown>;
    const states = (o.valueStates ??= {}) as Record<string, unknown>;
    states["employment.endsWith"] = { state: "estimated", origin: { kind: "auto" }, estimate: { method: "standard", basis: "今の勤め先を定年で辞める" } };
  });
  if (end.age < 65) {
    const cur = currentPeriod(w.request.input.household, m.id, w.request.input.baseMonth);
    const sal = reemploymentSalary(main.type, m, cur?.salary?.annual.value ?? 0);
    if (sal !== null) {
      w = { ...w, postRetirement: { ...w.postRetirement, [m.id]: { fromAge: end.age, type: "contract", annualSalary: sal.value } } };
      w = setRetireAge(w, m, 65);
      w = markPostSalary(w, m, sal.value, sal.basis);
      marks[k.postType] = POST_TYPE_BASIS;
      marks[k.retireAge] = POST_TYPE_BASIS;
    }
  }
  return { ...w, assumed: { ...w.assumed, ...marks } };
}

/**
 * 推定のままの定年後の予定を、今の勤め先の年収・働き方に合わせて入れ直す（働き方と収入のカードの欄・ボタンの後）。
 * 定年後の年収は、仮の印があれば定年前の年収×割合に。定年は、仮の印があって働き方が正社員・公務員なら、その働き方の推定に
 */
function followPost(before: WorkingHousehold, after: WorkingHousehold): WorkingHousehold {
  if (before === after) return after;
  let w = after;
  for (const m of earners(after.request.input.household)) {
    const k = estKeys(m);
    const post = w.postRetirement[m.id];
    const main = mainPeriod(w.request.input.household, m, post);
    if (post === undefined || main === undefined) continue;
    // 定年: 働き方を正社員⇄公務員に変えたら、その推定の定年に（定年後の予定の推定もそろえ直す）
    if (w.assumed[k.mainEnd] !== undefined && (main.type === "regular" || main.type === "civilServant")) {
      const want = retirementAgeEstimate(main.type, m);
      // 定年後の予定も推定のまま（仮の印がある）か、65歳の定年で定年後の予定が無いとき
      const postEstimated = w.assumed[k.postType] !== undefined || (post.type === null && post.fromAge >= 65);
      if (want.age !== post.fromAge && postEstimated) {
        // 推定の定年後の期間を外してから（働く最後＝今の定年）、新しい働き方の推定を入れ直す
        const cleared: WorkingHousehold = {
          ...w,
          assumed: Object.fromEntries(Object.entries(w.assumed).filter(([key]) => key !== k.postType && key !== k.retireAge)),
          postRetirement: { ...w.postRetirement, [m.id]: { ...post, type: null, annualSalary: null } },
        };
        w = estimatePost(setRetireAge(cleared, m, post.fromAge), m);
        continue;
      }
    }
    // 定年後の年収: 定年前の年収が変わったら
    const pb = postBox(w.request.input.household, m, post);
    if (pb !== undefined && isAutoBox(pb.box) && post.type === "contract") {
      const sal = reemploymentSalary(main.type, m, main.salary?.annual.value ?? 0);
      if (sal !== null && (sal.value !== pb.box.value || boxBasis(pb.box) !== sal.basis)) {
        w = { ...w, postRetirement: { ...w.postRetirement, [m.id]: { ...post, annualSalary: sal.value } } };
        w = markPostSalary(w, m, sal.value, sal.basis);
      }
    }
  }
  return w;
}

/** 働き方と収入のカードの欄・ボタンの後始末: 推定のままの定年後の予定を入れ直し、新しく作った期間に給付を受け取るかの推定を入れる */
const afterWorkEdit = (before: WorkingHousehold, after: WorkingHousehold): WorkingHousehold => markNewPeriods(before, followPost(before, after));

/** 定年後の期間の年収（事業所得）の箱 */
function postBox(h: Household, m: Member, post: PostRetirement | undefined): { period: EmploymentPeriod; box: Box<number>; path: string[] } | undefined {
  const pp = postPeriod(h, m, post);
  if (pp === undefined) return undefined;
  if (pp.salary !== undefined) return { period: pp, box: pp.salary.annual, path: ["salary", "annual"] };
  if (pp.business !== undefined) return { period: pp, box: pp.business.income, path: ["business", "income"] };
  return undefined;
}

/** 定年後の年収の欄: 値の箱は定年後の期間の年収（推定なら推定の印。確定は「✓ この値で確定」）。書くと定年後の予定の年収と期間の箱の両方を書く */
function postSalaryField(m: Member, type: PostRetirement["type"]): FieldDef {
  const item = type === "selfEmployed" ? "employment.business.income" : "employment.salary.annual";
  const write = (w: WorkingHousehold, box: Record<string, unknown> | undefined): WorkingHousehold => {
    const cur = w.postRetirement[m.id];
    if (cur === undefined || box === undefined) return w;
    const pb = postBox(w.request.input.household, m, cur);
    const value = typeof box.value === "number" ? box.value : cur.annualSalary;
    // 定年後の期間がまだ無い（働く最後を定年にしている）ときは、定年後の予定の年収だけ（働く最後を延ばすと、この年収で期間を足す）
    const next: WorkingHousehold = { ...w, postRetirement: { ...w.postRetirement, [m.id]: { ...cur, annualSalary: value } } };
    if (pb === undefined) return next;
    return mutate(next, (hh) => {
      const x = (hh.employmentPeriods ?? []).find((y) => y.id === pb.period.id) as EmploymentPeriod;
      if (pb.path[0] === "salary" && x.salary !== undefined) x.salary.annual = structuredClone(box) as unknown as Box<number>;
      if (pb.path[0] === "business" && x.business !== undefined) x.business.income = structuredClone(box) as unknown as Box<number>;
    });
  };
  return {
    ...field({
      key: `work/${m.id}/postSalary`,
      item,
      label: type === "selfEmployed" ? "定年後の事業所得（年額）" : "定年後の年収（年額・賞与を除く）",
      level: "simple",
      kind: "yen",
      basis: "annual",
      get: (w) => {
        const pb = postBox(w.request.input.household, m, w.postRetirement[m.id]);
        return { value: pb?.box.value ?? w.postRetirement[m.id]?.annualSalary ?? null, estimated: boxBasis(pb?.box) };
      },
      set: (w, v) => (v === null ? w : write(w, { value: Number(v), state: "confirmed", origin: { kind: "manual" } })),
    }),
    boxed: { read: (w) => postBox(w.request.input.household, m, w.postRetirement[m.id])?.box, write },
    address: (w) => {
      const pb = postBox(w.request.input.household, m, w.postRetirement[m.id]);
      return pb === undefined ? null : { target: { object: pb.period.id }, item, at: [] };
    },
  };
}

function retirementGroup(wh: WorkingHousehold, m: Member): GroupDef | null {
  /** 働く最後の月（その人の働き方の期間の、いちばん遅い終わり） */
  const lastEnd = (w: WorkingHousehold): Timepoint | null => {
    const hh = w.request.input.household;
    return (
      periodsOf(hh, m.id)
        .map((p) => p.to)
        .filter((t): t is Timepoint => t !== null && resolveTimepoint(hh, t) !== null)
        .sort((a, b) => ((resolveTimepoint(hh, a) as string) < (resolveTimepoint(hh, b) as string) ? -1 : 1))
        .at(-1) ?? null
    );
  };
  const h = wh.request.input.household;
  const ps = periodsOf(h, m.id);
  if (ps.length === 0) return null;
  const post = wh.postRetirement[m.id];
  const main = mainPeriod(h, m, post);
  const who = memberLabel(wh, m.id);
  const fields: FieldDef[] = [];
  if (post !== undefined && main !== undefined) {
    fields.push(
      field({
        key: `work/${m.id}/mainEnd`,
        item: "employment.to",
        label: "定年（今の勤め先を辞める年齢）",
        level: "simple",
        kind: "int",
        suffix: "歳",
        min: 40,
        max: 80,
        help: "この年齢になる月の前月まで今の勤め先で働きます",
        get: (w) => ({ value: w.postRetirement[m.id]?.fromAge ?? null, assumed: w.assumed[`work/${m.id}/mainEnd`] ?? null }),
        set: (w, v) => (v === null ? w : setMainEnd(w, m, Number(v))),
        // 時点の部品（0038）: 「60歳」＝60歳になる前の月まで。年月でも入れられる（○歳になる前の月に当たる年月だけ）
        time: timeView({
          ageOf: (hh) => hh.members.find((x) => x.id === m.id),
          mode: "age",
          modes: ["age", "ym"],
          ageMeans: "before",
          read: (w) => {
            const fromAge = w.postRetirement[m.id]?.fromAge;
            return fromAge === undefined ? null : { at: addMonths(ageReachedMonth(m, fromAge), -1) };
          },
          check: (w, tp) => {
            const ym = tp === null ? null : resolveTimepoint(w.request.input.household, tp);
            if (tp === null) return "空にはできません。年齢を入れてください";
            if (ym === null) return null;
            if (ageBefore(m, ym) === null) return `定年は「○歳になる前の月まで」で決めます（${formatYearMonth(ym)}は${ageAt(m, ym)}歳の途中です）。月まで決めるときは、詳しく入れるの働き方の期間の終わりで入れてください`;
            const age = ageBefore(m, ym) as number;
            return age < 40 || age > 80 ? "定年は40歳〜80歳の範囲で入れてください" : null;
          },
          write: (w, tp) => {
            const ym = tp === null ? null : resolveTimepoint(w.request.input.household, tp);
            const age = ym === null ? null : ageBefore(m, ym);
            return age === null ? w : setMainEnd(w, m, age);
          },
        }),
      }),
      field({
        key: `work/${m.id}/postType`,
        item: "employment.type",
        label: "定年後の働き方",
        level: "simple",
        kind: "select",
        options: POST_RETIREMENT_TYPES,
        get: (w) => ({ value: w.postRetirement[m.id]?.type ?? "", assumed: w.assumed[`work/${m.id}/postType`] ?? null }),
        set: (w, v) => {
          const cur = w.postRetirement[m.id];
          if (cur === undefined) return w;
          const type = (v === "" || v === null ? null : v) as PostRetirement["type"];
          const est = type === null ? null : type === "selfEmployed" ? businessEstimate().value : (salaryEstimate(type, m.sex, { age: cur.fromAge })?.annual.value ?? null);
          const nextPost: PostRetirement = { ...cur, type, annualSalary: type === null ? null : (cur.annualSalary ?? est) };
          let next: WorkingHousehold = { ...w, postRetirement: { ...w.postRetirement, [m.id]: nextPost } };
          const pp = postPeriod(next.request.input.household, m, nextPost);
          if (pp !== undefined) {
            if (type === null) {
              // 定年後は働かない: 定年の後の期間を外す（働く最後の年齢は定年になる）
              next = setRetireAge(next, m, nextPost.fromAge);
            } else
              next = mutate(next, (hh) => {
                const list = hh.employmentPeriods ?? [];
                const i = list.findIndex((p) => p.id === pp.id);
                const conv = convertPeriod(list[i] as EmploymentPeriod, type, m, next.request.input.baseMonth);
                if (nextPost.annualSalary !== null) {
                  if (conv.salary !== undefined) conv.salary = { ...conv.salary, annual: { value: nextPost.annualSalary, state: "confirmed", origin: { kind: "manual" } } };
                  if (conv.business !== undefined) conv.business = { income: { value: nextPost.annualSalary, state: "confirmed", origin: { kind: "manual" } } };
                }
                list[i] = conv;
              });
          }
          return next;
        },
      }),
    );
    if (post.type !== null)
      fields.push(
        postSalaryField(m, post.type),
      );
  }
  fields.push(
    field({
      key: `work/${m.id}/retireAge`,
      item: "employment.to",
      label: "働く最後の年齢（現状の予定）",
      level: "simple",
      kind: "int",
      suffix: "歳まで",
      min: 40,
      max: 90,
      sideEffects: "退職後の生活費の節目と NISA の積立の終わりも、この年齢に合わせます",
      help: post?.type != null ? "定年より後の年齢にすると、定年後の働き方で働く期間を足します" : "この年齢になる月の前月まで働きます",
      get: (w) => {
        const v = readLevers(w.request, m.id).retireAge ?? null;
        return { value: v, hint: v === null ? "終わりを決めていない（最後まで）" : null, assumed: w.assumed[`work/${m.id}/retireAge`] ?? null };
      },
      set: (w, v) => (v === null ? w : setRetireAge(w, m, Number(v))),
      // 時点の部品（0038）: 「65歳」＝65歳になる前の月まで働く。年月（60歳の年度末など）・今からでも入れられる
      time: timeView({
        ageOf: (hh) => hh.members.find((x) => x.id === m.id),
        mode: "age",
        modes: ["age", "ym", "now"],
        ageMeans: "before",
        nullText: "終わりを決めていない（最後まで）",
        read: (w) => lastEnd(w),
        check: (w, tp) => {
          if (tp === null) return "空にはできません（終わりを外すときは、詳しく入れるの働き方の期間で）";
          const ym = resolveTimepoint(w.request.input.household, tp);
          if (ym === null) return null;
          const age = ageAt(m, addMonths(ym, 1));
          return age < 40 || age > 90 ? "働く最後は40歳〜90歳の範囲で入れてください" : null;
        },
        write: (w, tp) => {
          const ym = tp === null ? null : resolveTimepoint(w.request.input.household, tp);
          const now = lastEnd(w);
          // 同じ月なら何もしない（形だけ違う時点を入れ直しても、働き方の期間・生活費の節目を作り直さない）
          if (ym === null || (now !== null && resolveTimepoint(w.request.input.household, now) === ym)) return w;
          const age = ageBefore(m, ym);
          if (age !== null) return setRetireAge(w, m, age);
          const r = reemploymentOf(w.postRetirement[m.id]);
          return { ...w, request: applyRetireMonth(w.request, m.id, ym, r !== undefined ? { reemployment: r } : {}) };
        },
      }),
    }),
  );
  return {
    key: `work/${m.id}/retirement`,
    title: `${who}の定年後の予定`,
    note: "結果の対策「働く最後の年齢」でも動かせます。結果で動かした値は提案として持ち、ここ（現状）は変わりません",
    level: "simple",
    fields,
    actions:
      post === undefined && ps.some((p) => p.to?.at !== undefined)
        ? [
            {
              key: `work/${m.id}/addPost`,
              label: "定年後の予定を入れる",
              level: "simple",
              run: (w) => {
                const last = periodsOf(w.request.input.household, m.id).filter((p) => p.to?.at !== undefined).at(-1) as EmploymentPeriod;
                const age = ageAt(m, addMonths(last.to?.at as string, 1));
                return { ...w, postRetirement: { ...w.postRetirement, [m.id]: { fromAge: age, type: null, annualSalary: null } } };
              },
            },
          ]
        : [],
  };
}

function nowGroup(wh: WorkingHousehold, m: Member): GroupDef {
  const h = wh.request.input.household;
  const base = wh.request.input.baseMonth;
  const cur = currentPeriod(h, m.id, base);
  const who = memberLabel(wh, m.id);
  if (cur === undefined)
    return {
      key: `work/${m.id}/now`,
      title: `${who}の働き方`,
      note: "働き方が入っていません（収入なしで計算しています）",
      level: "simple",
      fields: [],
      actions: [
        {
          key: `work/${m.id}/start`,
          label: "会社員として入れる",
          level: "simple",
          run: (w) => {
            const from = careerStartMonth(m.birth.birthYearMonth);
            const to = addMonths(ageReachedMonth(m, 60), -1);
            const p = convertPeriod({ id: newId(), member: m.id, from: { at: from < base ? from : base }, to: { at: to }, type: "regular" }, "regular", m, base);
            const next = mutate(w, (hh) => {
              (hh.employmentPeriods ??= []).push(p);
              ensureResidentTax(hh, m.id, base, newId);
            });
            // 定年と定年後の予定は推定で入れる（正社員は60歳で定年、65歳まで再雇用。年収は定年前の年収×60〜64歳の平均の割合）
            return estimatePost(ensureRetirement({ ...next, postRetirement: { ...next.postRetirement, [m.id]: { fromAge: 60, type: null, annualSalary: null } } }, m.id), m);
          },
        },
        {
          key: `work/${m.id}/startSelf`,
          label: "自営業として入れる",
          level: "simple",
          run: (w) => {
            const from = careerStartMonth(m.birth.birthYearMonth);
            const p = convertPeriod({ id: newId(), member: m.id, from: { at: from < base ? from : base }, to: null, type: "selfEmployed" }, "selfEmployed", m, base);
            return mutate(w, (hh) => {
              (hh.employmentPeriods ??= []).push(p);
              ensureResidentTax(hh, m.id, base, newId);
            });
          },
        },
      ],
    };
  const find = byId(periods, cur.id);
  // 詳しい欄は「働き方の期間（詳しく）」に出す（同じ期間を2か所に出さない）
  const fields = periodFields(wh, m, cur, find, "simple", `work/${m.id}/now`).filter((f) => f.level === "simple");
  const fy = residentTaxYear(base);
  const findTax: Finder = (hh) => ((hh.residentTaxAssessments ?? []) as { member: string; fiscalYear: number }[]).find((a) => a.member === m.id && a.fiscalYear === fy) as Record<string, unknown> | undefined;
  fields.push(
    yenBox({
      key: `work/${m.id}/residentTax`,
      item: "residentTaxAssessment.amount",
      label: `住民税（${fy}年度の年税額）`,
      // 効くのは今年度の1年分だけで、決定通知書を写す書類の値なので詳細（空欄は前の年の所得から概算。0078）
      level: "detail",
      basis: "annual",
      find: findTax,
      path: ["amount"],
      optional: true,
      ensure: (hh) => {
        const a = { id: newId(), member: m.id, fiscalYear: fy, amount: { value: 0, state: "confirmed", origin: { kind: "manual" } } };
        ((hh.residentTaxAssessments ??= []) as unknown[]).push(a);
        return a as unknown as Record<string, unknown>;
      },
      estimate: (hh) => {
        const p = currentPeriod(hh, m.id, base);
        return residentTaxEstimate((p?.salary?.annual.value ?? 0) + (p?.salary?.bonus?.value ?? 0), p?.business?.income.value ?? 0, fy - 1);
      },
      help: "住民税の決定通知書（給与明細の住民税×12）の額。空欄なら前の年の所得から概算します",
    }),
  );
  const past = cur.from.at !== undefined && cur.from.at > base;
  return { key: `work/${m.id}/now`, title: `${who}の今の働き方`, ...(past ? { note: "今は働いていません。次に始まる働き方を出しています" } : {}), level: "simple", fields, actions: [] };
}

/** 働き方の期間1件の欄。簡易では種類・年収・賞与・健康保険、詳細では期間・従業員数・労働時間・標準報酬月額・厚生年金の種別も */
function periodFields(wh: WorkingHousehold, m: Member, p: EmploymentPeriod, find: Finder, level: "simple" | "detail", prefix: string): FieldDef[] {
  const fields: FieldDef[] = [];
  const d = "detail" as const;
  if (level === "detail") {
    fields.push(
      timepointField({ key: `${prefix}/from`, item: "employment.from", label: "始まり", level: "detail", find, path: ["from"], ageOf: (h) => h.members.find((x) => x.id === m.id), modes: ["age", "ym", "now"], monthOnly: PERIOD_MONTH_ONLY }),
      timepointField({
        key: `${prefix}/to`,
        item: "employment.to",
        label: "終わり（最後の月）",
        level: "detail",
        find,
        path: ["to"],
        ageOf: (h) => h.members.find((x) => x.id === m.id),
        modes: ["age", "ym", "now"],
        ageMeans: "before",
        startPath: ["from"],
        monthOnly: PERIOD_MONTH_ONLY,
        optional: true,
        nullText: "終わりを決めていない",
      }),
    );
  }
  fields.push(
    field({
      key: `${prefix}/type`,
      item: "employment.type",
      label: level === "simple" ? "働き方" : "種類",
      level,
      kind: "select",
      options: EMPLOYMENT_TYPES,
      structural: true,
      get: (w) => ({ value: (find(w.request.input.household, w)?.type as string | undefined) ?? null }),
      // 正社員・公務員にしたら、退職金の目安を最初から入れる（その人の退職金が無く、該当なしにもしていないとき。fill.ts）
      set: (w, v) =>
        ensureRetirement(
          mutate(w, (h, req) => {
            const list = h.employmentPeriods ?? [];
            const i = list.findIndex((x) => x.id === p.id);
            if (i >= 0 && v !== null) list[i] = convertPeriod(list[i] as EmploymentPeriod, String(v), m, req.input.baseMonth);
            ensureResidentTax(h, m.id, req.input.baseMonth, newId);
          }),
          m.id,
        ),
    }),
  );
  if (p.type === "leave") fields.push(plain({ key: `${prefix}/leaveKind`, item: "employment.leaveKind", label: "休業の種類", level, kind: "select", options: LEAVE_KINDS, find, path: ["leaveKind"] }));
  // 簡易の今の働き方が休業中なら、休業の終わり（戻る時期）。入れると、休業の後の期間（休業の前と同じ働き方）も作る
  if (p.type === "leave" && level === "simple") fields.push(leaveEndField(wh, m, p, find, prefix));
  if (p.type === "partTime" || p.type === "contract") fields.push(employeeInsuranceField(p, find, prefix, level));
  if (SALARIED.has(p.type)) {
    fields.push(
      // 標準（今の働き方）は年収（賞与込み）の1欄。賞与の内訳は詳細の「働き方の期間（詳しく）」の年収・賞与で直す（0078）。
      // 役員だけは標準でも月の報酬（年額）と賞与を分けて聞く（社会保険料の上限が月の報酬と賞与で違い、まとめて統計の割合で分けると結果が大きくずれる）
      ...(level === "simple" && p.type === "executive"
        ? [
            yenBox({ key: `${prefix}/annual`, item: "employment.salary.annual", label: "月の報酬（年額・賞与を除く）", level, basis: "annual", find, path: ["salary", "annual"], estimate: () => salaryEstimate(p.type, m.sex, { age: salaryAge(m, p, wh.request.input.baseMonth) })?.annual ?? null, help: "毎月の役員報酬の12か月分（定期同額給与）。空欄なら目安で計算します" }),
            yenBox({ key: `${prefix}/bonus`, item: "employment.salary.bonus", label: "賞与（年間の合計。事前確定届出給与など）", level, basis: "annual", find, path: ["salary", "bonus"], estimate: () => salaryEstimate(p.type, m.sex, { age: salaryAge(m, p, wh.request.input.baseMonth) })?.bonus ?? null, help: "役員の賞与（事前確定届出給与など）の年間の合計。無ければ0" }),
          ]
        : level === "simple"
        ? [salaryTotalField(wh, m, p, find, prefix)]
        : [
            yenBox({ key: `${prefix}/annual`, item: "employment.salary.annual", label: "年収（税込み・賞与を除く）", level, basis: "annual", find, path: ["salary", "annual"], estimate: () => salaryEstimate(p.type, m.sex, { age: salaryAge(m, p, wh.request.input.baseMonth) })?.annual ?? null, help: "源泉徴収票の支払金額から賞与を除いた額。空欄なら統計の目安で計算します" }),
            growthField(wh, p, find, prefix, "salary", d),
            yenBox({ key: `${prefix}/bonus`, item: "employment.salary.bonus", label: "賞与（年間の合計）", level, basis: "annual", find, path: ["salary", "bonus"], estimate: () => salaryEstimate(p.type, m.sex, { age: salaryAge(m, p, wh.request.input.baseMonth) })?.bonus ?? null }),
          ]),
      plain({
        key: `${prefix}/hi`,
        item: "employment.healthInsurance.kind",
        label: "健康保険",
        // 健康保険の種類は詳細だけ（働き方から推定。差は小さく、ざっくり入れるときは分からないことが多い）
        level: d,
        kind: "select",
        options: HEALTH_INSURANCE,
        find,
        path: ["healthInsurance", "kind"],
        structural: true,
        after: (h, t) => {
          const branch = (h.employmentPeriods ?? []).map((e) => e.healthInsurance?.insurer).find((x): x is string => typeof x === "string");
          fixHealthInsurance((t as EmploymentPeriod).healthInsurance as { kind: string }, branch);
        },
      }),
      ...(p.healthInsurance?.kind === "kyokaikenpo"
        ? [plain({ key: `${prefix}/branch`, item: "employment.healthInsurance.insurer", label: "協会けんぽの支部", level: d, kind: "select", options: KYOKAI_BRANCHES, find, path: ["healthInsurance", "insurer"], help: "勤め先の所在地の都道府県（保険料率が支部ごとに違います）" })]
        : []),
      ...(p.healthInsurance?.kind === "union" || p.healthInsurance?.kind === "mutualAid"
        ? [rateBox({ key: `${prefix}/hiRate`, item: "employment.healthInsurance.employeeRate", label: "健康保険料率（本人負担分）", level: d, find, path: ["healthInsurance", "employeeRate"], help: "給与明細の健康保険料 ÷ 標準報酬月額 でも出せます" })]
        : []),
      plain({ key: `${prefix}/pc`, item: "employment.pensionCategory", label: "厚生年金", level: d, kind: "select", options: PENSION_CATEGORY, find, path: ["pensionCategory"] }),
      plain({ key: `${prefix}/size`, item: "employment.employer.size", label: "勤め先の従業員数", level: d, kind: "int", suffix: "人", min: 1, find, path: ["employer", "size"], help: "社会保険の適用拡大の判定に使います" }),
      plain({ key: `${prefix}/hours`, item: "employment.employer.weeklyHours", label: "週の所定労働時間", level: d, kind: "decimal", suffix: "時間", find, path: ["employer", "weeklyHours"] }),
      yenBox({ key: `${prefix}/smrH`, item: "employment.standardMonthlyRemuneration", label: "標準報酬月額（健康保険）", level: d, basis: "monthly", unit: "yen", find, path: ["standardMonthlyRemuneration", "health"], optional: true, help: "空欄なら年収から計算します" }),
      yenBox({ key: `${prefix}/smrP`, item: "employment.standardMonthlyRemuneration", label: "標準報酬月額（厚生年金）", level: d, basis: "monthly", unit: "yen", find, path: ["standardMonthlyRemuneration", "pension"], optional: true }),
      { ...yenBox({ key: `${prefix}/commuting`, item: "employment.salary.commutingMonthly", label: "通勤手当（非課税・月額）", level: d, basis: "monthly", unit: "yen", find, path: ["salary", "commutingMonthly"], optional: true, help: "所得税・住民税はかかりませんが、社会保険料の報酬には入ります。空欄は該当なし" }), address: () => ({ target: { object: p.id }, item: "employment.salary.commutingMonthly", at: [] }) },
      { ...plain({ key: `${prefix}/student`, item: "employment.student", label: "学生", level: d, kind: "bool", find, path: ["student"], optional: true, fallback: false, help: "学生は短時間の勤めの社会保険・雇用保険の対象から外れます" }), address: () => ({ target: { object: p.id }, item: "employment.student", at: [] }) },
      { ...plain({ key: `${prefix}/corpDb`, item: "employment.corporatePension", label: "勤め先に確定給付企業年金・共済などがある（iDeCo の上限）", level: d, kind: "bool", find, path: ["corporatePension", "db"], optional: true, fallback: false, help: "iDeCo の掛金の上限の判定に使います" }), address: () => ({ target: { object: p.id }, item: "employment.corporatePension", at: ["db"] }) },
    );
    if (p.corporatePension !== undefined && (p.corporatePension as { db?: boolean }).db === true)
      fields.push({ ...plain({ key: `${prefix}/corpDbMonthly`, item: "employment.corporatePension", label: "他制度掛金相当額（月額）", level: d, kind: "yen", basis: "monthly", find, path: ["corporatePension", "dbEquivalentMonthly"], optional: true, help: "勤め先から知らされる額。空欄は iDeCo の上限を他制度ありの決まりで見ます" }), address: () => ({ target: { object: p.id }, item: "employment.corporatePension", at: ["dbEquivalentMonthly"] }) });
  }
  if (p.type === "selfEmployed")
    fields.push(yenBox({ key: `${prefix}/business`, item: "employment.business.income", label: "事業所得（年額）", level, basis: "annual", find, path: ["business", "income"], estimate: () => businessEstimate(), help: "確定申告書の所得金額（青色申告特別控除の前）" }), growthField(wh, p, find, prefix, "business", d));
  if (level === "detail") fields.push(...claimFields(wh, m, p, find, prefix));
  return fields;
}

// ---- 年収（賞与込み）（0078）----

type SalaryBox = Box<number> & { substitute?: Box<number>; estimate?: { method?: string; basis?: string }; approval?: unknown };
const boxValue = (b: SalaryBox | undefined): number | null => (b === undefined ? null : (b.value ?? (b.state === "unknown" ? (b.substitute?.value ?? null) : null)));
const roundThousand = (v: number): number => Math.round(v / 1000) * 1000;
const manText = (v: number): string => `${(v / 10000).toLocaleString("ja-JP", { maximumFractionDigits: 1 })}万円`;
/** 合計から賞与を分けた推定の出し方（統計の推定〔statistic〕と分けて、統計を入れ直すときに書き換えない） */
export const BONUS_SPLIT_METHOD = "derived";

/**
 * 年収（賞与込み）の欄（標準の今の働き方。0078）。世帯ファイルは年収（賞与を除く）と賞与の2つの値の箱のまま（形を変えない）。
 * - 見せる値は2つの合計。状態は年収の箱の状態（推定・わからない・該当なし・確定）
 * - 合計を入れると: 賞与が確定（人が入れた・書類の値）で合計以下なら、賞与はそのままで年収＝合計−賞与。そうでなければ、賃金の統計（年齢・性別・
 *   働き方の平均）の年収と賞与の割合で賞与を分け（千円単位）、賞与は推定の印（出し方 derived）、年収は確定にする
 * - 空にすると、年収・賞与とも統計の推定に戻す（2つの欄を空にしたのと同じ）。確定・わからないの操作は年収の箱に当てる（賞与はそのまま）
 */
function salaryTotalField(wh: WorkingHousehold, m: Member, p: EmploymentPeriod, find: Finder, prefix: string): FieldDef {
  const item = "employment.salary.annual";
  const stat = () => salaryEstimate(p.type, m.sex, { age: salaryAge(m, p, wh.request.input.baseMonth) });
  const boxes = (w: WorkingHousehold) => {
    const x = find(w.request.input.household, w) as EmploymentPeriod | undefined;
    return { a: x?.salary?.annual as SalaryBox | undefined, b: x?.salary?.bonus as SalaryBox | undefined };
  };
  const total = (w: WorkingHousehold): number | null => {
    const { a, b } = boxes(w);
    const av = boxValue(a);
    return av === null ? null : av + (boxValue(b) ?? 0);
  };
  const edit = (w: WorkingHousehold, fn: (s: NonNullable<EmploymentPeriod["salary"]>) => void) =>
    mutate(w, (h) => {
      const x = find(h, w) as EmploymentPeriod | undefined;
      if (x?.salary !== undefined) fn(x.salary);
    });
  const bonusOf = (w: WorkingHousehold): number => boxValue(boxes(w).b) ?? 0;
  /** 状態を年収の箱に当てる（値は合計から賞与を引いた額） */
  const writeBox = (w: WorkingHousehold, box: Record<string, unknown> | undefined): WorkingHousehold => {
    if (box === undefined) return w;
    const bonus = bonusOf(w);
    const sub = box.substitute as SalaryBox | undefined;
    const shown = typeof box.value === "number" ? box.value : typeof sub?.value === "number" ? sub.value : null;
    // 合計が今の賞与より少ない額の箱（未入力の0円など）は、賞与を同じ状態の0円にして、年収に合計を置く（読み直すと同じ合計になる）
    const keepBonus = shown === null || shown >= bonus;
    const less = (v: number) => (keepBonus ? v - bonus : v);
    const next: Record<string, unknown> = { ...structuredClone(box) };
    if (typeof box.value === "number") next.value = less(box.value);
    if (sub !== undefined && typeof sub.value === "number") next.substitute = { ...structuredClone(sub), value: less(sub.value) };
    return edit(w, (s) => {
      s.annual = next as unknown as Box<number>;
      if (box.state === "notApplicable" && s.bonus !== undefined) s.bonus = { state: "notApplicable", origin: { kind: "manual" } } as unknown as Box<number>;
      else if (!keepBonus) s.bonus = { ...structuredClone(box), value: 0, ...(sub !== undefined ? { substitute: { ...structuredClone(sub), value: 0 } } : {}) } as unknown as Box<number>;
    });
  };
  return {
    ...field({
      key: `${prefix}/total`,
      item,
      label: "年収（税込み・賞与込み）",
      level: "simple",
      kind: "yen",
      basis: "annual",
      optional: true,
      blankIsEstimate: true,
      help: "源泉徴収票の支払金額（給与と賞与の合計）。賞与の内訳は詳細の「働き方の期間」で直せます（入れていなければ統計の割合で分けます）。空欄なら統計の目安で計算します",
      get: (w) => {
        const { a, b } = boxes(w);
        const bv = boxValue(b);
        const basisA = boxBasis(a);
        const basisB = boxBasis(b);
        const estimated = basisA !== null ? (basisB !== null && b?.estimate?.method === "statistic" ? `年収: ${basisA}／賞与: ${basisB}` : basisA) : a?.state === "unknown" ? "わからない（代わりの値）" : null;
        return { value: total(w), estimated, hint: bv !== null && bv > 0 ? `うち賞与 ${manText(bv)}${basisB !== null ? "（推定）" : ""}` : null };
      },
      set: (w, v) => {
        const e = stat();
        if (v === null)
          return edit(w, (s) => {
            if (e !== null) {
              s.annual = estimatedBox(e.annual.value, e.annual.basis);
              s.bonus = estimatedBox(e.bonus.value, e.bonus.basis);
            }
          });
        const sum = Math.max(0, Math.round(Number(v)));
        const b = boxes(w).b;
        // 人が入れた賞与（確定）は残す
        if (b !== undefined && b.state === "confirmed" && typeof b.value === "number" && b.value <= sum)
          return edit(w, (s) => void (s.annual = { value: sum - (b.value as number), state: "confirmed", origin: { kind: "manual" } }));
        const ratio = e === null || e.annual.value + e.bonus.value <= 0 ? 0 : e.bonus.value / (e.annual.value + e.bonus.value);
        const bonus = roundThousand(sum * ratio);
        const basis = e === null ? "賞与の統計の割合が無いので0円（合計を年収に入れています）" : `年収（賞与込み）${manText(sum)}を、賃金の統計の年収と賞与の割合（賞与 ${Math.round(ratio * 1000) / 10}%）で分けた額`;
        return edit(w, (s) => {
          s.annual = { value: sum - bonus, state: "confirmed", origin: { kind: "manual" } };
          s.bonus = { value: bonus, state: "estimated", origin: { kind: "auto" }, estimate: { method: BONUS_SPLIT_METHOD, basis } } as Box<number>;
        });
      },
    }),
    boxed: {
      read: (w) => {
        const { a } = boxes(w);
        if (a === undefined) return undefined;
        const bonus = bonusOf(w);
        return {
          ...structuredClone(a),
          ...(typeof a.value === "number" ? { value: a.value + bonus } : {}),
          ...(a.substitute !== undefined && typeof a.substitute.value === "number" ? { substitute: { ...structuredClone(a.substitute), value: a.substitute.value + bonus } } : {}),
        };
      },
      write: writeBox,
    },
    address: () => ({ target: { object: p.id }, item, at: [] }),
  };
}

// ---- 勤め先の社会保険・休業の終わり（0047）----

/**
 * 勤め先の社会保険（パート・契約）: 入っている／入っていない／わからない（週の時間と勤め先の規模から判定）。エンジンの上書き employeeInsurance。
 * 入っているにしたら、健康保険・厚生年金が勤め先の種類でなければ協会けんぽ・厚生年金にする（エンジンは勤め先の種類のときだけ入ると読む）
 */
function employeeInsuranceField(p: EmploymentPeriod, find: Finder, prefix: string, level: "simple" | "detail"): FieldDef {
  return {
    ...field({
      key: `${prefix}/si`,
      item: "employment.employeeInsurance",
      label: "勤め先の社会保険（健康保険・厚生年金）",
      level,
      kind: "select",
      optional: true,
      options: [
        { value: "", label: "わからない（週の時間と勤め先の規模から判定）" },
        { value: "yes", label: "入っている" },
        { value: "no", label: "入っていない（家族の扶養・国民健康保険）" },
      ],
      help: "給与明細で健康保険料・厚生年金保険料が引かれていれば「入っている」です",
      sideEffects: "「入っている」にすると、健康保険と厚生年金も勤め先の種類（協会けんぽ・厚生年金）にします",
      get: (w) => {
        const x = find(w.request.input.household, w) as EmploymentPeriod | undefined;
        const b = x?.employeeInsurance as { value?: boolean } | undefined;
        return b?.value === undefined ? { value: "", implicit: true } : { value: b.value ? "yes" : "no" };
      },
      set: (w, v) =>
        mutate(w, (h) => {
          const x = find(h, w) as EmploymentPeriod | undefined;
          if (x === undefined) return;
          if (v === null || v === "") {
            delete x.employeeInsurance;
            return;
          }
          x.employeeInsurance = { value: v === "yes", state: "confirmed", origin: { kind: "manual" } };
          if (v === "yes") {
            const branch = (h.employmentPeriods ?? []).map((e) => e.healthInsurance?.insurer).find((y): y is string => typeof y === "string");
            if (x.healthInsurance === undefined || !["kyokaikenpo", "union", "mutualAid"].includes(x.healthInsurance.kind)) x.healthInsurance = fixHealthInsurance({ kind: "kyokaikenpo" }, branch);
            if (x.pensionCategory === undefined || x.pensionCategory === "none") x.pensionCategory = "employee1";
          }
        }),
    }),
    address: () => ({ target: { object: p.id }, item: "employment.employeeInsurance", at: [] }),
  };
}

/** 休業の終わり（戻る時期。休業の最後の月）。入れたら、翌月から休業の前と同じ働き方の期間を作る（もう次の期間があれば作らない） */
function leaveEndField(wh: WorkingHousehold, m: Member, p: EmploymentPeriod, find: Finder, prefix: string): FieldDef {
  const f = timepointField({
    key: `${prefix}/leaveEnd`,
    item: "employment.to",
    label: "休業の終わり（最後の月）",
    level: "simple",
    find,
    path: ["to"],
    ageOf: (h) => h.members.find((x) => x.id === m.id),
    modes: ["ym", "now", "age"],
    mode: "ym",
    monthOnly: PERIOD_MONTH_ONLY,
    optional: true,
    nullText: "戻る時期を決めていない",
    help: "入れると、翌月から休業の前と同じ働き方に戻ります（戻った後の働き方は、詳しく入れるの働き方の期間で直せます）",
    after: (h, t) => {
      const x = t as unknown as EmploymentPeriod;
      const end = x.to?.at;
      if (end === undefined) return;
      const mine = periodsOf(h, m.id);
      if (mine.some((q) => q.id !== x.id && (q.from.at ?? "") > end)) return;
      const before = mine.filter((q) => q.id !== x.id && q.type !== "leave" && (q.to?.at ?? "") < (x.from.at ?? "")).at(-1);
      const type = before?.type ?? "regular";
      const back = convertPeriod({ ...(before !== undefined ? structuredClone(before) : {}), id: newId(), member: m.id, from: { at: addMonths(end, 1) }, to: null, type } as EmploymentPeriod, type, m, wh.request.input.baseMonth);
      for (const k of ["valueStates", "endsWith", "unemploymentClaim", "elderlyContinuationClaim", "retirementBenefit"]) delete (back as Record<string, unknown>)[k];
      (h.employmentPeriods ??= []).push(back);
    },
  });
  return { ...f, address: () => ({ target: { object: p.id }, item: "employment.to", at: [] }) };
}

// ---- 辞め方と雇用保険の給付（0037・0047）----

const ENDS_WITH: readonly { value: string; label: string }[] = [
  { value: "retirement", label: "定年" },
  { value: "voluntary", label: "自己都合" },
  { value: "involuntary", label: "会社都合（解雇・倒産など）" },
  { value: "contractEnd", label: "契約満了" },
  { value: "sickLeave", label: "休業のまま辞める（病気などで働けない。失業給付は受けない）" },
];
const endsWithLabel = (v: string) => ENDS_WITH.find((x) => x.value === v)?.label ?? v;

/** 受け取るかの選択（おまかせ＝推定。期間が変わると入れ直す／受け取る／受け取らない） */
function claimField(o: { key: string; item: typeof UNEMPLOYMENT_ITEM | typeof CONTINUATION_ITEM; label: string; help: string; find: Finder; id: string; estimate: (h: Household, p: EmploymentPeriod) => boolean; basis: string }): FieldDef {
  const prop = o.item === UNEMPLOYMENT_ITEM ? "unemploymentClaim" : "elderlyContinuationClaim";
  const cur = (w: WorkingHousehold) => o.find(w.request.input.household, w) as EmploymentPeriod | undefined;
  return {
    ...field({
      key: o.key,
      item: o.item,
      label: o.label,
      level: "detail",
      kind: "select",
      options: [
        { value: "auto", label: "おまかせ（推定）" },
        { value: "yes", label: "受け取る" },
        { value: "no", label: "受け取らない" },
      ],
      help: o.help,
      get: (w) => {
        const x = cur(w);
        if (x === undefined) return { value: null };
        if (isEstimated(x, o.item)) return { value: "auto", hint: `推定: ${x[prop] === true ? "受け取る" : "受け取らない"}` };
        if (x[prop] === undefined) return { value: "no", hint: "入れていません（受け取らないで計算しています）", implicit: true };
        return { value: x[prop] === true ? "yes" : "no" };
      },
      set: (w, v) =>
        mutate(w, (h, req) => {
          const x = o.find(h, { ...w, request: req }) as EmploymentPeriod | undefined;
          if (x === undefined) return;
          if (v === "auto") return putEstimate(x, o.item, o.estimate(h, x), o.basis);
          dropClaim(x, o.item);
          (x as Record<string, unknown>)[prop] = v === "yes";
        }),
    }),
    address: () => ({ target: { object: o.id }, item: o.item, at: [] }),
  };
}

/** 詳しい期間の欄: 辞め方・失業給付を受け取る（終わりのある雇用保険の勤め・休業）・高年齢雇用継続給付を受け取る（60〜64歳の月を含む勤め） */
function claimFields(wh: WorkingHousehold, m: Member, p: EmploymentPeriod, find: Finder, prefix: string): FieldDef[] {
  const h = wh.request.input.household;
  const out: FieldDef[] = [];
  if (unemploymentApplies(h, p)) {
    const auto = defaultEndsWith(h, m, p);
    out.push(
      {
        ...field({
          key: `${prefix}/endsWith`,
          item: "employment.endsWith",
          label: "辞め方（この期間の終わり方）",
          level: "detail",
          kind: "select",
          optional: true,
          options: [{ value: "", label: `自動（${endsWithLabel(auto)}）` }, ...ENDS_WITH],
          help: "失業給付の日数・給付制限に使います。自動は、60歳以上か定年の出来事なら定年、ほかは自己都合です",
          get: (w) => {
            const x = find(w.request.input.household, w) as EmploymentPeriod | undefined;
            return x?.endsWith !== undefined ? { value: x.endsWith } : { value: "", implicit: true };
          },
          set: (w, v) =>
            mutate(w, (hh, req) => {
              const x = find(hh, { ...w, request: req }) as EmploymentPeriod | undefined;
              if (x === undefined) return;
              if (v === null || v === "") delete x.endsWith;
              else x.endsWith = String(v);
            }),
        }),
        address: () => ({ target: { object: p.id }, item: "employment.endsWith", at: [] }),
      },
      claimField({
        key: `${prefix}/unemploymentClaim`,
        item: UNEMPLOYMENT_ITEM,
        label: "辞めた後に失業給付を受け取る",
        help: "雇用保険の基本手当（65歳以上で辞めたときは高年齢求職者給付金）。おまかせは、65歳未満で辞め、次に働くまで3か月以上あれば受け取ります。受け取る月は65歳前の老齢厚生年金が止まるので、年金のほうが多いときは「受け取らない」と比べてください",
        find,
        id: p.id,
        estimate: unemploymentEstimate,
        basis: UNEMPLOYMENT_BASIS,
      }),
    );
  }
  if (continuationApplies(h, p))
    out.push(
      claimField({
        key: `${prefix}/continuationClaim`,
        item: CONTINUATION_ITEM,
        label: "60〜64歳で高年齢雇用継続給付を受け取る",
        help: "60〜64歳の月の給与が60歳のときの75%未満に下がったときに受け取ります（要件と額は計算で判定します）。受け取る月は在職老齢年金に上乗せして年金の一部が止まります",
        find,
        id: p.id,
        estimate: () => true,
        basis: CONTINUATION_BASIS,
      }),
    );
  return out;
}

/**
 * この期間の伸び（年率。0040）: 空欄は前提の賃金上昇率。給与は昇給カーブ（値ID）と率のどちらか一方なので、率を入れると昇給カーブの代わりになる。
 * 事業所得も同じ（昇給カーブは無い）
 */
function growthField(wh: WorkingHousehold, p: EmploymentPeriod, find: Finder, prefix: string, part: "salary" | "business", level: "simple" | "detail"): FieldDef {
  const item = part === "salary" ? "employment.salary.growth" : "employment.business.growth";
  const wage = (wh.request.input.assumptions as { wageGrowth?: { default?: string } } | undefined)?.wageGrowth?.default;
  return {
    ...field({
      key: `${prefix}/${part}Growth`,
      item,
      label: "この期間の伸び（年率）",
      level,
      kind: "pct",
      optional: true,
      help: "毎年この率で伸ばします（マイナスも入れられます）。空欄は前提条件の賃金上昇率",
      get: (w) => {
        const x = find(w.request.input.household, w) as EmploymentPeriod | undefined;
        const g = (x?.[part] as { growth?: { rate?: string; curve?: string } } | undefined)?.growth;
        if (g?.rate !== undefined) return { value: g.rate };
        if (g?.curve !== undefined) return { value: null, hint: "空欄: 昇給カーブ（年齢の係数）と前提条件の賃金上昇率" };
        return { value: null, hint: `空欄: 前提条件の賃金上昇率${wage !== undefined ? `（年${(Number(wage) * 100).toFixed(1)}%）` : ""}` };
      },
      set: (w, v) =>
        mutate(w, (h, req) => {
          const x = find(h, { ...w, request: req }) as EmploymentPeriod | undefined;
          const o = x?.[part] as { growth?: { rate?: string; curve?: string } } | undefined;
          if (o === undefined) return;
          if (v === null) {
            if (o.growth?.rate !== undefined) delete o.growth;
          } else o.growth = { rate: String(v) };
        }),
    }),
    address: () => ({ target: { object: p.id }, item, at: ["rate"] }),
  };
}

function periodListGroups(wh: WorkingHousehold, m: Member): GroupDef[] {
  const h = wh.request.input.household;
  const who = memberLabel(wh, m.id);
  return periodsOf(h, m.id).map((p, i) => ({
    key: `work/period/${p.id}`,
    title: `${who}の働き方 ${i + 1}`,
    level: "detail",
    fields: periodFields(wh, m, p, byId(periods, p.id), "detail", `work/period/${p.id}`),
    actions: [removeAction(`work/period/${p.id}/remove`, "この期間を外す", "detail", (hh) => void (hh.employmentPeriods = (hh.employmentPeriods ?? []).filter((x) => x.id !== p.id)))],
  }));
}

function addPeriodAction(wh: WorkingHousehold, m: Member): ActionDef {
  return {
    key: `work/${m.id}/addPeriod`,
    label: `＋ ${memberLabel(wh, m.id)}の働き方の期間を足す`,
    level: "detail",
    run: (w) => {
      const ps = periodsOf(w.request.input.household, m.id);
      const lastEnd = ps.map((p) => p.to?.at).filter((x): x is string => x !== undefined).sort().at(-1);
      const from = lastEnd !== undefined ? addMonths(lastEnd, 1) : w.request.input.baseMonth;
      const p = convertPeriod({ id: newId(), member: m.id, from: { at: from }, to: { at: addMonths(ageReachedMonth(m, 65), -1) < from ? from : addMonths(ageReachedMonth(m, 65), -1) }, type: "partTime" }, "partTime", m, w.request.input.baseMonth);
      return mutate(w, (hh, req) => {
        (hh.employmentPeriods ??= []).push(p);
        ensureResidentTax(hh, m.id, req.input.baseMonth, newId);
      });
    },
  };
}

export function workStage(wh: WorkingHousehold): StageDef {
  const h = wh.request.input.household;
  const people = earners(h);
  const simple: SectionDef[] = people.map((m) => {
    const groups: GroupDef[] = [nowGroup(wh, m)];
    const r = retirementGroup(wh, m);
    if (r !== null) groups.push(r);
    const benefits = (h.retirementBenefits ?? []).filter((b) => b.member === m.id);
    // 退職金・企業年金は退職金・企業年金のカードに出す（ここは読むだけの1行）
    const ro = readGroup(`work/${m.id}/benefits`, undefined, benefits.length > 0 ? [readLine(`work/${m.id}/benefits`, "退職金・企業年金", `${benefits.length}件`, "退職金・企業年金")] : []);
    if (ro !== null) groups.push(ro);
    return { key: `work/${m.id}`, title: memberLabel(wh, m.id), level: "simple", groups, actions: [] };
  });
  const detail: SectionDef = {
    key: "work/periods",
    title: "働き方の期間（詳しく）",
    note: "正社員→育休→時短→退職→パート、定年→再雇用のように、期間を分けて並べます。期間は重ならないようにします",
    level: "detail",
    groups: people.flatMap((m) => periodListGroups(wh, m)),
    actions: people.map((m) => addPeriodAction(wh, m)),
  };
  // 欄・ボタンの後に、推定のままの定年後の予定を入れ直し、新しく作った期間に給付を受け取るかの推定を入れる
  const wrap = (sec: SectionDef): SectionDef => ({ ...sec, groups: sec.groups.map((g) => ({ ...g, fields: g.fields.map(wrapField), actions: g.actions.map(wrapAction) })), actions: sec.actions.map(wrapAction) });
  return { id: "work", label: "働き方と収入", lead: "今の働き方・年収と、定年後の予定。", sections: [...simple, detail].map(wrap) };
}

const wrapAction = (a: ActionDef): ActionDef => ({ ...a, run: (w) => afterWorkEdit(w, a.run(w)) });

/** 欄を書いた後の始末を足す。時点の部品で書く欄（定年・働く最後）は、値が変わったらその欄の仮の印も外す（field の書き方を通らないため） */
function wrapField(f: FieldDef): FieldDef {
  const time = f.time;
  return {
    ...f,
    set: (w, v) => afterWorkEdit(w, f.set(w, v)),
    ...(f.write !== undefined ? { write: (w: WorkingHousehold, v: Val) => afterWorkEdit(w, (f.write as NonNullable<FieldDef["write"]>)(w, v)) } : {}),
    ...(time !== undefined
      ? {
          time: {
            ...time,
            setWhen: (w: WorkingHousehold, tp: Timepoint | null, how: "auto" | "this") => {
              const next = time.setWhen(w, tp, how);
              if (next === w) return w;
              const own = w.assumed[f.key] !== undefined && next.assumed[f.key] === w.assumed[f.key] && f.get(next).value !== f.get(w).value;
              return afterWorkEdit(w, own ? { ...next, assumed: Object.fromEntries(Object.entries(next.assumed).filter(([k]) => k !== f.key)) } : next);
            },
          },
        }
      : {}),
  };
}
