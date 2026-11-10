// 2. 働き方と収入: 今の働き方と年収（簡易）、定年後の予定（再雇用の年収・何歳まで）、働き方 1・2…（詳細。働き方の期間の一覧）。退職金・企業年金は 3. のカード（retirement.ts）。ここは読むだけの1行
// 被保険者の種別（第1〜3号）は入れない（エンジンが働き方の期間から導く。0008 の4）
import type { Box, EmploymentPeriod, Household, Member } from "../../../engine/types.ts";
import type { Timepoint } from "../../../engine/types.ts";
import { addMonths, ageAt, ageReachedMonth, applyLevers, applyRetireMonth, readLevers } from "../../levers.ts";
import { resolveTimepoint } from "../../timepoint.ts";
import { businessEstimate, careerStartMonth, ensureResidentTax, residentTaxEstimate, residentTaxYear, salaryAge, salaryEstimate, smrEstimate, smrMonth } from "../estimates.ts";
import { isAutoSmr } from "../smr.ts";
import { healthRateEstimate, parseWageCurveId, reemploymentRatio, WAGE_CURVE_SIZES, wageCurveEmployment, wageCurveId, wageCurveRate, wageCurveTable, wageSizeClass, type WageCurveChoice, type WageSize } from "../../../../../hearing/src/estimates.ts";
import { afterWrite, byId, field, plain, rateBox, removeAction, timepointField, timeView, yenBox, type ActionDef, type FieldDef, type Finder, type GroupDef, type SectionDef, type StageDef, type Val } from "../form.ts";
import { boxBasis, estimatedBox, mutate, newId, periodsOf, reemploymentOf, type PostRetirement, type WorkingHousehold } from "../household.ts";
import { continuationApplies, CONTINUATION_BASIS, CONTINUATION_ITEM, defaultEndsWith, dropClaim, isEstimated, markNewPeriods, putEstimate, unemploymentApplies, unemploymentEstimate, UNEMPLOYMENT_BASIS, UNEMPLOYMENT_ITEM } from "../claims.ts";
import { adoptBenefits, ensureRetirement } from "../fill.ts";
import { earners, EMPLOYMENT_TYPES, HEALTH_INSURANCE, KYOKAI_BRANCHES, LEAVE_KINDS, memberLabel, PENSION_CATEGORY, POST_RETIREMENT_TYPES, WORDS } from "../labels.ts";
import { formatYearMonth } from "../units.ts";
import { readGroup, readLine } from "../readLines.ts";
import { GROWTH_RANGE, HEALTH_RATE_RANGE } from "../rateRanges.ts";
import { CHECK_DOCUMENTS } from "../checkDocuments.ts";
import { executiveMembers } from "../officer.ts";
import { presetNum, presetText } from "../../../../../hearing/src/presets.ts";
import { hasBusinessIncome, taxReturnFields } from "../taxReturn.ts";
import { declaredDependentWarn } from "../dependentLimit.ts";

/** 働き方の期間の時点は年月で持つ（定年・再雇用の見つけ方などが年月で読むため。0038） */
const PERIOD_MONTH_ONLY = "働き方の期間は年月で持ちます（年齢・「5年後」のように入れても、その年月にします）";

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
    // パートの週の時間は、年収の推定（時給×週15時間。preset.wage.partTime.weeklyHours）とそろえる
    employer: { size: type === "partTime" ? 50 : 100, weeklyHours: type === "partTime" ? String(presetNum("preset.wage.partTime.weeklyHours")) : "40" },
  };
}

/** 勤め先の従業員数・週の所定労働時間の初めの値の根拠（推定の印。「勤め先の社会保険: わからない」の判定がこの値で動くことが分かるように） */
const employerBasis = (type: string, what: "size" | "hours"): string => {
  const d = salariedDefaults(type).employer as { size: number; weeklyHours: string };
  return what === "size" ? `既定の値（${type === "partTime" ? "パートの" : ""}勤め先の従業員数・${d.size}人。社会保険の判定に使います）` : `既定の値（${type === "partTime" ? "パートの" : ""}週の所定労働時間・${d.weeklyHours}時間。社会保険の判定に使います）`;
};

/** 勤め先の初めの値（従業員数・週の時間）のままの期間に、推定の印を付ける（FP が直すとその欄の印は外れる） */
function markEmployerDefaults(wh: WorkingHousehold, p: EmploymentPeriod): WorkingHousehold {
  if (!SALARIED.has(p.type)) return wh;
  const marks: Record<string, string> = {};
  // 協会けんぽの支部の初めの値（東京支部）も、人が選んだ値と見分けられるように推定の印（直すと外れる）
  if (p.healthInsurance?.kind === "kyokaikenpo" && p.healthInsurance.insurer === DEFAULT_BRANCH) marks[`work/period/${p.id}/branch`] = BRANCH_BASIS;
  const d = salariedDefaults(p.type).employer;
  if (sameJson(p.employer, d)) {
    marks[`work/period/${p.id}/size`] = employerBasis(p.type, "size");
    marks[`work/period/${p.id}/hours`] = employerBasis(p.type, "hours");
  }
  return Object.keys(marks).length === 0 ? wh : { ...wh, assumed: { ...wh.assumed, ...marks } };
}

/** 協会けんぽの支部の初めの値と、その根拠（推定の印） */
const DEFAULT_BRANCH = "kyokaikenpo.13";
const BRANCH_BASIS = "既定の値（東京支部。勤め先の所在地の都道府県を選んでください。保険料率が支部ごとに違います）";

/** 健康保険が勤め先の種類（協会けんぽ・健保組合・共済）の配偶者がいるか（その月。パートの健康保険の初めの値を「家族の扶養」にするか） */
function spouseEmployeeHealth(h: Household, m: Member, month: string): boolean {
  return h.members
    .filter((x) => x.id !== m.id && (x.kind === "self" || x.kind === "spouse"))
    .some((x) => periodsOf(h, x.id).some((q) => (q.from.at ?? "") <= month && (q.to === null || (q.to.at ?? "9999-12") >= month) && q.healthInsurance !== undefined && ["kyokaikenpo", "union", "mutualAid"].includes(q.healthInsurance.kind)));
}

/**
 * パートの健康保険の初めの値: 配偶者が勤め先の健康保険のときだけ「家族の扶養」、ほかは国民健康保険（p を書き換える）。
 * 初めの値（家族の扶養）のままのときだけ直す
 */
function fixPartTimeHealth(h: Household, m: Member, p: EmploymentPeriod): void {
  if (p.type !== "partTime" || p.healthInsurance?.kind !== "dependent") return;
  if (!spouseEmployeeHealth(h, m, p.from.at ?? "")) p.healthInsurance = { kind: "national" };
}

/** 自動で入れた推定の値（出どころ auto のまま。FP が入れた値・確定の値ではない） */
const isAutoBox = (b: { state?: string; origin?: { kind?: string } } | undefined): boolean => b !== undefined && b.state === "estimated" && b.origin?.kind === "auto";
const sameJson = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/**
 * 働き方の種類を変える: その種類に要る欄を足し、要らない欄を外す（0008 の4・スキーマの条件）。
 * 給与の種類どうし（正社員→パートなど）で変えたときは、推定のままの年収・賞与を新しい種類の推定に入れ替え（推定のままの標準報酬月額は外す）、
 * 前の種類の初めの値のままの健康保険・厚生年金・勤め先も新しい種類の初めの値に入れ替える。FP が入れた値は残す（0008 の追記 2026-10-11 の2・2026-10-25）
 */
export function convertPeriod(p: EmploymentPeriod, type: string, member: Member | undefined, baseMonth: string): EmploymentPeriod {
  const { salary, business, healthInsurance, pensionCategory, employer, standardMonthlyRemuneration, leaveKind, leaveChild, childcareShortHours, corporatePension, employmentInsuranceCovered, employeeInsurance, ...rest } = p;
  const out: EmploymentPeriod = { ...rest, type };
  if (SALARIED.has(type)) {
    // 推定の年齢は、その期間の始まりと計算基準月の遅いほう（勤め先の規模は推定に使わない。規模は詳細で入れたときだけの決まり）
    const est = salaryEstimate(type, member === undefined ? {} : { age: salaryAge(member, p, baseMonth) });
    const was = SALARIED.has(p.type) && p.type !== type ? salariedDefaults(p.type) : null;
    const now = salariedDefaults(type);
    const keep = <T,>(cur: T | undefined, before: T | undefined, next: T): T => (cur === undefined || (was !== null && sameJson(cur, before)) ? next : cur);
    // パートの健康保険の初めの値は、配偶者の健康保険で「家族の扶養」か国民健康保険（fixPartTimeHealth）。どちらも初めの値として入れ替える
    const partDefault = p.type === "partTime" && sameJson(healthInsurance, { kind: "national" });
    out.healthInsurance = partDefault && p.type !== type ? (now.healthInsurance as NonNullable<EmploymentPeriod["healthInsurance"]>) : keep(healthInsurance, was?.healthInsurance, now.healthInsurance as NonNullable<EmploymentPeriod["healthInsurance"]>);
    out.pensionCategory = keep(pensionCategory, was?.pensionCategory, now.pensionCategory as NonNullable<EmploymentPeriod["pensionCategory"]>);
    out.employer = keep(employer, was?.employer, now.employer as NonNullable<EmploymentPeriod["employer"]>);
    const annual = est !== null ? estimatedBox(est.annual.value, est.annual.basis) : estimatedBox(0, "未入力");
    const bonus = est !== null ? estimatedBox(est.bonus.value, est.bonus.basis) : estimatedBox(0, "未入力");
    out.salary =
      salary === undefined
        ? { annual, bonus }
        : { ...salary, annual: isAutoBox(salary.annual) ? annual : salary.annual, ...(isAutoBox(salary.bonus) ? { bonus } : {}) };
    if (p.type !== type) convertCurve(out.salary, type);
    // 標準報酬月額は FP が入れた値だけを残す。推定は書かない（空欄なら給与からエンジンが毎年9月に決め直す。推定の額を書くと期間の間ずっと
    // 同じ額になり、昇給が保険料と厚生年金に入らない。0047 の追記 2026-10-29 の2）
    const smr = standardMonthlyRemuneration;
    if (smr !== undefined && !isAutoSmr(smr)) out.standardMonthlyRemuneration = smr;
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
export function fixHealthInsurance(hi: { kind: string; [key: string]: unknown }, defaultBranch = DEFAULT_BRANCH): { kind: string; [key: string]: unknown } {
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
/** 会社員の定年の目安（presets.ts。事務所の推定の値があればその値と根拠の文） */
const mainEnd = (): { age: number; basis: string } => {
  const id = "preset.work.retirementAge";
  const age = presetNum(id);
  return { age, basis: presetText(id, (v) => (Number(v) === 60 ? MAIN_END_BASIS : `定年${String(v)}歳`)) };
};
export const retirementAgeEstimate = (type: string, m: Member): { age: number; basis: string } => (type === "civilServant" ? { age: civilRetirementAge(m), basis: CIVIL_END_BASIS } : mainEnd());

/** 自営業の働く最後の年齢の目安の値ID（事務所の既定値で変えられる） */
export const SELF_EMPLOYED_END_ID = "preset.work.selfEmployedRetireAge";
/** パート・契約の働く最後の年齢の目安（65歳までの雇用確保の決まり） */
const PART_END = { age: 65, basis: "既定の値（パート・契約の働く最後の年齢・65歳。65歳までの雇用確保の決まりから）" };
/** 役員の退任の年齢の目安（役員の世帯の見本も70歳） */
const EXECUTIVE_END = { age: 70, basis: "既定の値（役員の退任の年齢・70歳）" };

/**
 * 目安の年齢がもう過ぎている人（今の年齢が目安以上）の働く最後の年齢: 65歳前なら65歳（65歳までの雇用確保の決まり）、65歳からは今から5年
 * （90歳まで。90歳に近い人は次の年齢）。目安の年齢になる前の月が計算の基準の月より前のときに使う
 */
function lateEnd(est: { age: number; basis: string }, m: Member, base: string): { age: number; basis: string } {
  if (addMonths(ageReachedMonth(m, est.age), -1) >= base) return est;
  const now = ageAt(m, base);
  const age = now < 65 ? 65 : Math.max(now + 1, Math.min(90, now + 5));
  return { age, basis: `既定の値（目安の${est.age}歳を今の年齢〔${now}歳〕が過ぎているので、${now < 65 ? "65歳までの雇用確保の決まりから65歳" : `今から${age - now}年の${age}歳`}まで）` };
}

/** 定年の推定（正社員・公務員）。目安の定年をもう過ぎている人は lateEnd（過去の定年を推定しない） */
export const mainEndEstimate = (type: string, m: Member, base: string): { age: number; basis: string } => lateEnd(retirementAgeEstimate(type, m), m, base);

/**
 * 働く最後の年齢の推定（期間の終わりの無い働き方・入れたときの終わり）: 正社員・公務員は定年（mainEndEstimate）、自営業は事務所の既定値（70歳）、
 * パート・契約は65歳、役員は70歳。休業中・働いていないは null（終わりを置かない）
 */
export function lastAgeEstimate(type: string, m: Member, base: string): { age: number; basis: string } | null {
  if (type === "regular" || type === "civilServant") return mainEndEstimate(type, m, base);
  if (type === "selfEmployed") {
    const age = presetNum(SELF_EMPLOYED_END_ID);
    return lateEnd({ age, basis: presetText(SELF_EMPLOYED_END_ID, (v) => `既定の値（自営業の働く最後の年齢・${String(v)}歳）`) }, m, base);
  }
  if (type === "partTime" || type === "contract") return lateEnd(PART_END, m, base);
  if (type === "executive") return lateEnd(EXECUTIVE_END, m, base);
  return null;
}

/**
 * 定年後の再雇用の年収の推定: 定年前の年収 ×（60〜64歳の平均÷55〜59歳の平均）。平均は同じ働き方の男女計の年齢階級の表（hearing/src/estimates.ts。
 * 人の属性で分けない。0118）。表が無い働き方は null
 */
export function reemploymentSalary(type: string, mainAnnual: number): { value: number; basis: string } | null {
  const ratio = salaryEstimate(type, { age: 62 }) === null ? null : reemploymentRatio(type);
  if (ratio === null || mainAnnual <= 0) return null;
  const value = Math.round((mainAnnual * ratio) / 1000) * 1000;
  return { value, basis: `今の年収（賞与を除く）×${(ratio * 100).toFixed(0)}%（同じ働き方の60〜64歳の平均÷55〜59歳の平均。賃金の統計の年齢階級の表〔男女計〕）` };
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
  const end = mainEndEstimate(main.type, m, wh.request.input.baseMonth);
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
    const sal = reemploymentSalary(main.type, cur?.salary?.annual.value ?? 0);
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
      const want = mainEndEstimate(main.type, m, w.request.input.baseMonth);
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
      const sal = reemploymentSalary(main.type, main.salary?.annual.value ?? 0);
      if (sal !== null && (sal.value !== pb.box.value || boxBasis(pb.box) !== sal.basis)) {
        w = { ...w, postRetirement: { ...w.postRetirement, [m.id]: { ...post, annualSalary: sal.value } } };
        w = markPostSalary(w, m, sal.value, sal.basis);
      }
    }
  }
  return w;
}

/** その人の働き方の期間の、いちばん遅い終わりの月（終わりの無い期間があれば null） */
function lastEndOf(h: Household, m: Member): string | null {
  const ps = periodsOf(h, m.id);
  if (ps.length === 0 || ps.some((p) => p.to === null)) return null;
  return ps.map((p) => resolveTimepoint(h, p.to)).filter((x): x is string => x !== null).sort().at(-1) ?? null;
}

/**
 * 働く最後の月が欄・ボタンで変わったのに、働く最後の年齢の推定の印が前のまま残っていれば外す（「＋ 働き方」で期間を足した・詳細で終わりを直したなど）。
 * 推定を入れ直す操作は印を書き直すので、印が同じ文のままのときだけ外す
 */
function dropStaleEndMarks(before: WorkingHousehold, after: WorkingHousehold): WorkingHousehold {
  let w = after;
  for (const m of earners(after.request.input.household)) {
    const key = estKeys(m).retireAge;
    const mark = before.assumed[key];
    if (mark === undefined || w.assumed[key] !== mark) continue;
    if (lastEndOf(before.request.input.household, m) === lastEndOf(w.request.input.household, m)) continue;
    w = { ...w, assumed: Object.fromEntries(Object.entries(w.assumed).filter(([k]) => k !== key)) };
  }
  return w;
}

/** 働き方と収入のカードの欄・ボタンの後始末: 推定のままの定年後の予定を入れ直し、新しく作った期間に給付を受け取るかの推定を入れる */
const afterWorkEdit = (before: WorkingHousehold, after: WorkingHousehold): WorkingHousehold => markNewPeriods(before, followPost(before, dropStaleEndMarks(before, after)));

const dropMarks = (wh: WorkingHousehold, keys: readonly string[]): WorkingHousehold => (keys.some((k) => wh.assumed[k] !== undefined) ? { ...wh, assumed: Object.fromEntries(Object.entries(wh.assumed).filter(([k]) => !keys.includes(k))) } : wh);

/**
 * 終わりを推定で入れた期間の、辞めた後の給付を受け取るかの推定（失業給付・高年齢雇用継続給付）。欄も行も無い期間だけ（新しく作った期間と同じ。
 * 終わりの無かった期間に終わりを置くと、辞めた後の給付が「未入力」にならないように）
 */
function markEndedClaims(wh: WorkingHousehold, memberId: string): WorkingHousehold {
  return mutate(wh, (h) => {
    for (const p of (h.employmentPeriods ?? []).filter((x) => x.member === memberId)) {
      const o = p as Record<string, unknown>;
      const rows = (o.valueStates ?? {}) as Record<string, unknown>;
      if (p.unemploymentClaim === undefined && rows[UNEMPLOYMENT_ITEM] === undefined && unemploymentApplies(h, p)) putEstimate(p, UNEMPLOYMENT_ITEM, unemploymentEstimate(h, p), UNEMPLOYMENT_BASIS);
      if (p.elderlyContinuationClaim === undefined && rows[CONTINUATION_ITEM] === undefined && continuationApplies(h, p)) putEstimate(p, CONTINUATION_ITEM, true, CONTINUATION_BASIS);
    }
  });
}

/**
 * 終わりの無い今の働き方の期間に、働く最後の年齢の推定を入れる（期間の終わりを置き、印は働く最後の年齢の欄・正社員と公務員は定年の欄）。
 * 正社員・公務員は定年と定年後の予定の推定（estimatePost）と退職金の目安（ensureRetirement）も。休業中・働いていない・終わりのある期間は何もしない
 */
export function estimateWorkEnd(wh: WorkingHousehold, memberId: string): WorkingHousehold {
  const h = wh.request.input.household;
  const m = h.members.find((x) => x.id === memberId);
  const base = wh.request.input.baseMonth;
  const cur = m === undefined ? undefined : currentPeriod(h, m.id, base);
  if (m === undefined || cur === undefined || cur.to !== null) return wh;
  const est = lastAgeEstimate(cur.type, m, base);
  if (est === null) return wh;
  const lastMonth = addMonths(ageReachedMonth(m, est.age), -1);
  // 期間の終わりを置く（働く最後の年齢の欄と同じく、退職の段の生活費・NISA の積立の終わりも合わせる）。打ち手が動かさなかったときは直接書く
  let w: WorkingHousehold = { ...wh, request: applyRetireMonth(wh.request, m.id, lastMonth) };
  if ((w.request.input.household.employmentPeriods ?? []).find((x) => x.id === cur.id)?.to === null)
    w = mutate(w, (hh) => {
      const x = (hh.employmentPeriods ?? []).find((y) => y.id === cur.id);
      if (x !== undefined) x.to = { at: lastMonth };
    });
  const k = estKeys(m);
  if (cur.type === "regular" || cur.type === "civilServant") {
    w = { ...w, postRetirement: { ...w.postRetirement, [m.id]: { fromAge: est.age, type: null, annualSalary: null } } };
    return markEndedClaims(estimatePost(ensureRetirement(w, m.id), m), m.id);
  }
  return markEndedClaims({ ...w, assumed: { ...w.assumed, [k.retireAge]: est.basis } }, m.id);
}

/** 取り込んだ世帯などで、終わりの無い今の働き方の期間の人（ご本人・配偶者）に働く最後の年齢の推定を入れる（estimateWorkEnd） */
export function withWorkEndEstimates(wh: WorkingHousehold, memberIds?: ReadonlySet<string>): WorkingHousehold {
  let w = wh;
  for (const m of earners(wh.request.input.household)) if (memberIds === undefined || memberIds.has(m.id)) w = estimateWorkEnd(w, m.id);
  return w;
}

/**
 * 働き方の種類を変えたときの、働く最後と定年の推定の入れ直し（今の働き方の期間だけ）。期間の終わりが無いか、終わりが推定のまま
 * （定年・働く最後の年齢の印がある）なら、推定のままの定年後の予定を外し、新しい種類の推定（正社員・公務員は定年と定年後の予定、自営業は
 * 事務所の既定値、パート・契約は65歳、役員は70歳）を入れ直す。FP が入れた終わり（印の無い終わり）は残す
 */
function refitWorkEnd(wh: WorkingHousehold, m: Member, periodId: string, beforeType: string): WorkingHousehold {
  const h = wh.request.input.household;
  const base = wh.request.input.baseMonth;
  const cur = currentPeriod(h, m.id, base);
  if (cur === undefined || cur.id !== periodId || cur.type === beforeType) return wh;
  const k = estKeys(m);
  const post = wh.postRetirement[m.id];
  const main = mainPeriod(h, m, post);
  const isMain = main?.id === cur.id;
  const lastOne = periodsOf(h, m.id).at(-1)?.id === cur.id;
  const estimated = cur.to === null || (isMain && wh.assumed[k.mainEnd] !== undefined) || (!isMain && lastOne && wh.assumed[k.retireAge] !== undefined && post === undefined);
  if (!estimated) return wh;
  let w = wh;
  // 推定のままの定年後の期間（再雇用）を外す（働く最後＝今の定年）
  if (isMain && post !== undefined && wh.assumed[k.postType] !== undefined) w = setRetireAge({ ...w, postRetirement: { ...w.postRetirement, [m.id]: { ...post, type: null, annualSalary: null } } }, m, post.fromAge);
  const { [m.id]: _drop, ...restPost } = w.postRetirement;
  void _drop;
  w = dropMarks({ ...w, postRetirement: restPost }, [k.mainEnd, k.postType, k.retireAge]);
  const est = lastAgeEstimate(cur.type, m, base);
  if (est === null) return w;
  w = { ...w, request: applyRetireMonth(w.request, m.id, addMonths(ageReachedMonth(m, est.age), -1)) };
  if (cur.type === "regular" || cur.type === "civilServant") {
    w = { ...w, postRetirement: { ...w.postRetirement, [m.id]: { fromAge: est.age, type: null, annualSalary: null } } };
    return markEndedClaims(estimatePost(w, m), m.id);
  }
  return markEndedClaims({ ...w, assumed: { ...w.assumed, [k.retireAge]: est.basis } }, m.id);
}

/** 定年後の期間の年収（事業所得）の箱 */
function postBox(h: Household, m: Member, post: PostRetirement | undefined): { period: EmploymentPeriod; box: Box<number>; path: string[] } | undefined {
  const pp = postPeriod(h, m, post);
  if (pp === undefined) return undefined;
  if (pp.salary !== undefined) return { period: pp, box: pp.salary.annual, path: ["salary", "annual"] };
  if (pp.business !== undefined) return { period: pp, box: pp.business.income, path: ["business", "income"] };
  return undefined;
}

/** 定年後の年収の欄: 値の箱は定年後の期間の年収（推定なら推定の印。確定は「この値にする」）。書くと定年後の予定の年収と期間の箱の両方を書く */
/**
 * 定年後の年収の欄: 値の箱は定年後の期間の年収（推定なら推定の印。確定は「この値にする」）。書くと定年後の予定の年収と期間の箱の両方を書く。
 * 給与の働き方は「定年後の年収（税込み・賞与込み）」（今の年収と同じ基準）。見せる値は定年後の期間の年収と賞与の合計で、合計を入れると、
 * 人が入れた賞与（確定）はそのまま、ほかは賃金の統計（定年後の働き方・定年の年齢）の年収と賞与の割合で賞与を分ける（賞与は推定の印。
 * 世帯ファイルは年収と賞与の2つの箱のまま）。定年後の予定の年収（annualSalary）は賞与を除く年収
 */
function postSalaryField(m: Member, type: PostRetirement["type"]): FieldDef {
  const item = type === "selfEmployed" ? "employment.business.income" : "employment.salary.annual";
  const salaried = type !== "selfEmployed";
  /** 定年後の期間の賞与（給与の働き方。無ければ0） */
  const bonusOf = (w: WorkingHousehold): { box: SalaryBox | undefined; value: number } => {
    const pb = postBox(w.request.input.household, m, w.postRetirement[m.id]);
    const b = salaried ? (pb?.period.salary?.bonus as SalaryBox | undefined) : undefined;
    return { box: b, value: boxValue(b) ?? 0 };
  };
  const writeBoxes = (w: WorkingHousehold, box: Record<string, unknown>, bonus: Record<string, unknown> | null): WorkingHousehold => {
    const cur = w.postRetirement[m.id];
    if (cur === undefined) return w;
    const pb = postBox(w.request.input.household, m, cur);
    const value = typeof box.value === "number" ? box.value : cur.annualSalary;
    // 定年後の期間がまだ無い（働く最後を定年にしている）ときは、定年後の予定の年収だけ（働く最後を延ばすと、この年収で期間を足す）
    const next: WorkingHousehold = { ...w, postRetirement: { ...w.postRetirement, [m.id]: { ...cur, annualSalary: value } } };
    if (pb === undefined) return next;
    return mutate(next, (hh) => {
      const x = (hh.employmentPeriods ?? []).find((y) => y.id === pb.period.id) as EmploymentPeriod;
      if (pb.path[0] === "salary" && x.salary !== undefined) {
        x.salary.annual = structuredClone(box) as unknown as Box<number>;
        if (bonus !== null) x.salary.bonus = structuredClone(bonus) as unknown as Box<number>;
      }
      if (pb.path[0] === "business" && x.business !== undefined) x.business.income = structuredClone(box) as unknown as Box<number>;
    });
  };
  /** 値の操作（この値にする・推定に戻すなど）の書き戻し: 見せている合計の箱から賞与を引いて年収の箱にする（賞与はそのまま） */
  const write = (w: WorkingHousehold, box: Record<string, unknown> | undefined): WorkingHousehold => {
    if (box === undefined) return w;
    if (!salaried) return writeBoxes(w, box, null);
    const bonus = bonusOf(w).value;
    const next: Record<string, unknown> = { ...structuredClone(box) };
    if (typeof box.value === "number" && box.value >= bonus) next.value = box.value - bonus;
    return writeBoxes(w, next, null);
  };
  /** 合計を入れたとき: 人が入れた賞与はそのまま、ほかは統計の割合で賞与を分ける */
  const setTotal = (w: WorkingHousehold, total: number): WorkingHousehold => {
    const cur = w.postRetirement[m.id];
    if (cur === undefined) return w;
    const confirmed: Record<string, unknown> = { state: "confirmed", origin: { kind: "manual" } };
    // 定年後の期間がまだ無い（働く最後を定年にしている）ときは、分けずに定年後の予定の年収にする（期間を足すときの年収）
    if (!salaried || type === null || postBox(w.request.input.household, m, cur) === undefined) return writeBoxes(w, { ...confirmed, value: total }, null);
    const b = bonusOf(w).box;
    // 確定の賞与（人が入れた額。打ち手で作った定年後の期間の0円も）はそのまま（今の年収の欄と同じ決まり）
    if (b !== undefined && b.state === "confirmed" && typeof b.value === "number" && b.value <= total) return writeBoxes(w, { ...confirmed, value: total - b.value }, null);
    const e = salaryEstimate(type, { age: cur.fromAge });
    const ratio = e === null || e.annual.value + e.bonus.value <= 0 ? 0 : e.bonus.value / (e.annual.value + e.bonus.value);
    const bonus = roundThousand(total * ratio);
    const basis = `定年後の年収（賞与込み）${manText(total)}を、賃金の統計の年収と賞与の割合（賞与 ${Math.round(ratio * 1000) / 10}%）で分けた額`;
    return writeBoxes(w, { ...confirmed, value: total - bonus }, { value: bonus, state: "estimated", origin: { kind: "auto" }, estimate: { method: BONUS_SPLIT_METHOD, basis } });
  };
  return {
    ...field({
      key: `work/${m.id}/postSalary`,
      item,
      label: salaried ? "定年後の年収（税込み・賞与込み）" : "定年後の事業所得（年額）",
      level: "simple",
      kind: "yen",
      basis: "annual",
      ...(salaried ? { help: "源泉徴収票の「支払金額」（賞与込み）にあたる額。賞与の内訳は「詳細」の定年後の働き方の期間で直せます（入れていなければ統計の割合で分けます）" } : {}),
      get: (w) => {
        const pb = postBox(w.request.input.household, m, w.postRetirement[m.id]);
        const bonus = bonusOf(w).value;
        const base = pb?.box.value ?? w.postRetirement[m.id]?.annualSalary ?? null;
        return { value: base === null ? null : base + bonus, estimated: boxBasis(pb?.box), ...(bonus > 0 ? { hint: `うち賞与 ${manText(bonus)}${boxBasis(bonusOf(w).box) !== null ? "（推定）" : ""}` } : {}) };
      },
      set: (w, v) => (v === null ? w : setTotal(w, Math.max(0, Math.round(Number(v))))),
    }),
    boxed: {
      read: (w) => {
        const box = postBox(w.request.input.household, m, w.postRetirement[m.id])?.box;
        if (box === undefined) return undefined;
        const bonus = bonusOf(w).value;
        return typeof box.value === "number" && bonus > 0 ? { ...structuredClone(box), value: box.value + bonus } : box;
      },
      write,
    },
    address: (w) => {
      const pb = postBox(w.request.input.household, m, w.postRetirement[m.id]);
      return pb === undefined ? null : { target: { object: pb.period.id }, item, at: [] };
    },
  };
}

/**
 * 終わりの無い今の働き方で収入が表の最後まで入る人の注意（確かめの一覧の「確かめの注意」にも出る）: 「働く最後の年齢が決まっていません
 * （100歳まで事業所得を入れています）」と、推定の年齢にするボタン。休業中・働いていないは出さない
 */
function openEnded(wh: WorkingHousehold, m: Member): { text: string; fix: string } | null {
  const h = wh.request.input.household;
  const base = wh.request.input.baseMonth;
  const cur = currentPeriod(h, m.id, base);
  if (cur === undefined || cur.to !== null) return null;
  const est = lastAgeEstimate(cur.type, m, base);
  if (est === null) return null;
  const endAge = ageAt(m, `${wh.request.input.endYear}-12`);
  return { text: `働く最後の年齢が決まっていません（${endAge}歳まで${cur.type === "selfEmployed" ? "事業所得" : "給与"}を入れています）`, fix: `${est.age}歳までにする（推定）` };
}

/** 働く最後の年齢を空にする: その人の最後の期間（いちばん遅い終わり）の終わりを外す（「終わりを決めていない」） */
function clearLastEnd(wh: WorkingHousehold, m: Member): WorkingHousehold {
  const h = wh.request.input.household;
  const last = periodsOf(h, m.id)
    .filter((p) => p.to !== null)
    .sort((a, b) => ((resolveTimepoint(h, a.to) ?? "") < (resolveTimepoint(h, b.to) ?? "") ? -1 : 1))
    .at(-1);
  if (last === undefined || periodsOf(h, m.id).some((p) => p.to === null)) return wh;
  return mutate(wh, (hh) => {
    const x = (hh.employmentPeriods ?? []).find((p) => p.id === last.id);
    if (x !== undefined) x.to = null;
  });
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
  // 今働いていない（働いていない・終わり無し）で、この後の働き方も無い人は、定年後の予定を出さない（これから働くなら「詳細」の「＋ 働き方」）
  const base0 = wh.request.input.baseMonth;
  const cur0 = currentPeriod(h, m.id, base0);
  if (cur0?.type === "unemployed" && cur0.to === null && !ps.some((p) => p.id !== cur0.id && (resolveTimepoint(h, p.from) ?? "") > base0)) return null;
  const post = wh.postRetirement[m.id];
  const main = mainPeriod(h, m, post);
  const who = memberLabel(wh, m.id);
  const fields: FieldDef[] = [];
  // 働く最後の年齢を空にできるのは、定年後の予定の無い人（空は最後の期間の終わりを外す。0133 の5 の注意と推定に戻すボタンが出る）
  const clearable = post === undefined;
  // 定年をもう過ぎている人（定年後の期間が今の働き方）は、定年・定年後の働き方・定年後の年収を出さず、働く最後の年齢だけ（今の年収は今の働き方の欄で直す）
  const retired = main?.to?.at !== undefined && main.to.at < wh.request.input.baseMonth;
  if (post !== undefined && main !== undefined && !retired) {
    fields.push(
      field({
        key: `work/${m.id}/mainEnd`,
        item: "employment.to",
        label: "定年",
        level: "simple",
        kind: "int",
        suffix: "歳",
        min: 40,
        max: 80,
        help: "今の勤め先を辞める年齢です。この年齢になる月の前月まで今の勤め先で働きます",
        get: (w) => ({ value: w.postRetirement[m.id]?.fromAge ?? null, assumed: w.assumed[`work/${m.id}/mainEnd`] ?? null }),
        set: (w, v) => (v === null ? w : setMainEnd(w, m, Number(v))),
        // 時点の部品（0038）: 「60歳」＝60歳になる前の月まで。年月でも入れられる（○歳になる前の月に当たる年月だけ）
        time: timeView({
          ageOf: (hh) => hh.members.find((x) => x.id === m.id),
          mode: "age",
          modes: ["age", "ym"],
          ageMeans: "before",
          // 定年はその人の年齢だけで入れる（「誰の年齢で」を出さない。0131 の6）
          who: "fixed",
          read: (w) => {
            const fromAge = w.postRetirement[m.id]?.fromAge;
            return fromAge === undefined ? null : { at: addMonths(ageReachedMonth(m, fromAge), -1) };
          },
          check: (w, tp) => {
            const ym = tp === null ? null : resolveTimepoint(w.request.input.household, tp);
            if (tp === null) return "空にはできません。年齢を入れてください";
            if (ym === null) return null;
            if (ageBefore(m, ym) === null) return `定年は「○歳になる前の月まで」で決めます（${formatYearMonth(ym)}は${ageAt(m, ym)}歳の途中です）。月まで決めるときは、「詳細」の「働き方 1・2…」の終わりで入れてください`;
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
          const est = type === null ? null : type === "selfEmployed" ? businessEstimate().value : (salaryEstimate(type, { age: cur.fromAge })?.annual.value ?? null);
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
      label: "働く最後の年齢",
      level: "simple",
      kind: "int",
      suffix: "歳まで",
      min: 40,
      max: 90,
      sideEffects: m.kind === "self" ? "退職後の生活費の節目と NISA の積立の終わりも、この年齢に合わせます" : "NISA の積立の終わりも、この年齢に合わせます",
      help: post?.type != null ? "定年より後の年齢にすると、定年後の働き方で働く期間を足します" : "この年齢になる月の前月まで働きます",
      get: (w) => {
        const v = readLevers(w.request, m.id).retireAge ?? null;
        const open = v === null ? openEnded(w, m) : null;
        return {
          value: v,
          hint: v === null ? "終わりを決めていない（最後まで）" : null,
          assumed: w.assumed[`work/${m.id}/retireAge`] ?? null,
          ...(open !== null ? { warn: open.text, warnFix: { label: open.fix, run: (ww: WorkingHousehold) => estimateWorkEnd(ww, m.id) } } : {}),
        };
      },
      set: (w, v) => (v === null ? w : setRetireAge(w, m, Number(v))),
      // 時点の部品（0038）: 「65歳」＝65歳になる前の月まで働く。年月（60歳の年度末など）でも入れられる。「5年後」と打っても年月に読む
      time: timeView({
        ageOf: (hh) => hh.members.find((x) => x.id === m.id),
        mode: "age",
        modes: ["age", "ym"],
        ageMeans: "before",
        who: "fixed",
        nullText: "終わりを決めていない（最後まで）",
        // 定年後の予定の無い人は、空にすると最後の期間の終わりを外す（詳細の今の期間の「終わり」は、この欄と同じ物なので出さない）
        ...(clearable ? { optional: true } : {}),
        read: (w) => lastEnd(w),
        check: (w, tp) => {
          if (tp === null) return clearable ? null : "空にはできません。働く最後の年齢か年月を入れてください（定年後の予定がある人は、定年後の働き方を「働かない」にすると定年が働く最後になります）";
          const ym = resolveTimepoint(w.request.input.household, tp);
          if (ym === null) return null;
          const age = ageAt(m, addMonths(ym, 1));
          return age < 40 || age > 90 ? "働く最後は40歳〜90歳の範囲で入れてください" : null;
        },
        write: (w, tp) => {
          if (tp === null) return clearable ? clearLastEnd(w, m) : w;
          const ym = resolveTimepoint(w.request.input.household, tp);
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
    note: "結果の画面の「働く最後の年齢」でも試せます。そこで動かしても、ここに入れた今の予定は変わりません",
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

/** 働き方の入口の選択肢（「働き方を入れる」の1つのボタンの中。選んだ種類で推定を入れて期間を作る） */
const ENTRY_TYPES: readonly { type: string; label: string }[] = [
  { type: "regular", label: "正社員" },
  { type: "partTime", label: "パート・アルバイト" },
  { type: "contract", label: "契約社員・嘱託（再雇用など）" },
  { type: "civilServant", label: "公務員" },
  { type: "executive", label: "会社役員" },
  { type: "selfEmployed", label: "自営業" },
  { type: "leave", label: "休業中（産休・育休・病気など）" },
  { type: "unemployed", label: "働いていない（専業主婦・主夫など）" },
];
const ENTRY_HELP =
  "今の働き方を選びます。年収は統計の目安、終わりは働く最後の年齢の目安（正社員・公務員は定年と65歳までの再雇用、自営業は事務所の既定値、パート・契約は65歳、役員は70歳）を推定で入れます。目安の年齢をもう過ぎている人は、今の働き方のまま65歳（65歳からは今から5年）までにします。どれも後から直せます";
/** 22歳の4月から始める働き方（勤めの期間は厚生年金の推計に使う）。ほかは計算の基準の月から */
const FROM_CAREER_START: ReadonlySet<string> = new Set(["regular", "contract", "civilServant", "executive", "selfEmployed"]);

/** 働き方を入れる（入口の選択肢）: 選んだ種類の期間を作り、年収・住民税・働く最後・定年と定年後の予定・退職金の目安を推定で入れる */
export function startWork(w: WorkingHousehold, m: Member, type: string): WorkingHousehold {
  const base = w.request.input.baseMonth;
  if (type === "contract") {
    const after = startReemployed(w, m);
    if (after !== null) return adoptBenefits(after, m.id);
  }
  const start = FROM_CAREER_START.has(type) ? careerStartMonth(m.birth.birthYearMonth) : base;
  const p = convertPeriod({ id: newId(), member: m.id, from: { at: start < base ? start : base }, to: null, type }, type, m, base);
  const working = type !== "unemployed" && type !== "leave";
  let next = mutate(w, (hh) => {
    fixPartTimeHealth(hh, m, p);
    (hh.employmentPeriods ??= []).push(p);
    if (working) ensureResidentTax(hh, m.id, base, newId);
  });
  // 勤め先を外した退職金は、足した期間を勤め先にする（0163）
  next = adoptBenefits(markEmployerDefaults(next, p), m.id);
  return estimateWorkEnd(next, m.id);
}

/**
 * 定年（会社員の目安）をもう過ぎた人の「契約社員・嘱託（再雇用など）」: 22歳の4月から定年の前の月までの正社員（辞め方は定年。厚生年金の推計と
 * 前の勤め先の企業年金の当て先に使う）と、定年の月からの今の再雇用（働く最後は推定。65歳前なら65歳まで）を作る。定年後の予定は定年の欄を出さない
 * 形（今の働き方が定年後の期間）。過去の勤め先の退職金の目安は足さない（受け取りが過去）。定年の前の人は null（ふつうの契約の期間）
 */
function startReemployed(w: WorkingHousehold, m: Member): WorkingHousehold | null {
  const base = w.request.input.baseMonth;
  const end = retirementAgeEstimate("regular", m);
  const mainLast = addMonths(ageReachedMonth(m, end.age), -1);
  const from = careerStartMonth(m.birth.birthYearMonth);
  if (mainLast >= base || from > mainLast) return null;
  const main = convertPeriod({ id: newId(), member: m.id, from: { at: from }, to: { at: mainLast }, type: "regular" }, "regular", m, base);
  main.endsWith = "retirement";
  (main as Record<string, unknown>).valueStates = { "employment.endsWith": { state: "estimated", origin: { kind: "auto" }, estimate: { method: "standard", basis: "今の勤め先を定年で辞めた（再雇用の前）" } } };
  const re = convertPeriod({ id: newId(), member: m.id, from: { at: addMonths(mainLast, 1) }, to: null, type: "contract" }, "contract", m, base);
  let next = mutate(w, (hh) => {
    (hh.employmentPeriods ??= []).push(main, re);
    ensureResidentTax(hh, m.id, base, newId);
  });
  next = markEmployerDefaults(markEmployerDefaults(next, main), re);
  next = { ...next, postRetirement: { ...next.postRetirement, [m.id]: { fromAge: end.age, type: "contract", annualSalary: re.salary?.annual.value ?? null } } };
  return estimateWorkEnd(next, m.id);
}

/**
 * 休業（育児・介護など）を挟んで続く、同じ種類の働き方の期間（同じ勤め先に戻った期間。0175）。今の期間の終わりの翌月から休業の期間が続き、
 * その翌月から同じ種類の期間が始まるもの。休業と戻った期間が何度続いても、順にたどる
 */
export function afterLeavePeriods(h: Household, periodId: string): EmploymentPeriod[] {
  const cur = (h.employmentPeriods ?? []).find((p) => p.id === periodId);
  if (cur === undefined) return [];
  const mine = (h.employmentPeriods ?? []).filter((p) => p.member === cur.member);
  const startingAfter = (p: EmploymentPeriod): EmploymentPeriod | undefined => {
    const end = p.to === null ? null : resolveTimepoint(h, p.to);
    if (end === null) return undefined;
    const next = addMonths(end, 1);
    return mine.find((x) => x.id !== p.id && resolveTimepoint(h, x.from) === next);
  };
  const out: EmploymentPeriod[] = [];
  let at: EmploymentPeriod = cur;
  for (;;) {
    let next = startingAfter(at);
    let leaves = 0;
    while (next !== undefined && next.type === "leave" && leaves < 10) {
      leaves++;
      next = startingAfter(next);
    }
    if (next === undefined || leaves === 0 || next.type !== cur.type || out.includes(next)) return out;
    out.push(next);
    at = next;
  }
}

const salaryValue = (b: Box<number> | undefined): number | null => (b === undefined ? null : (b.value ?? null));

/**
 * 今の期間の年収（標準の「年収（税込み・賞与込み）」）を直したら、休業を挟んで続く同じ勤め先の期間の年収と賞与も同じ額にする（H3-006 の案 (a)。0175）。
 * 休業の後の期間を FP が別に直していた（直す前の年収・賞与が今の期間と違う）ときは、一緒に直さない
 */
function followAcrossLeave(wh: WorkingHousehold, f: FieldDef, periodId: string): FieldDef {
  const later = afterLeavePeriods(wh.request.input.household, periodId);
  if (later.length === 0) return f;
  const from = later[0]?.from === undefined ? null : resolveTimepoint(wh.request.input.household, later[0].from);
  const wrapped = afterWrite(f, (before, after) => {
    const hb = before.request.input.household;
    const was = (hb.employmentPeriods ?? []).find((p) => p.id === periodId);
    const same = new Set(
      afterLeavePeriods(hb, periodId)
        .filter((p) => salaryValue(p.salary?.annual) === salaryValue(was?.salary?.annual) && salaryValue(p.salary?.bonus) === salaryValue(was?.salary?.bonus))
        .map((p) => p.id),
    );
    if (same.size === 0) return after;
    return mutate(after, (h) => {
      const now = (h.employmentPeriods ?? []).find((p) => p.id === periodId);
      if (now?.salary === undefined) return;
      for (const p of h.employmentPeriods ?? []) {
        if (!same.has(p.id)) continue;
        p.salary = { ...(p.salary ?? {}), annual: structuredClone(now.salary.annual), ...(now.salary.bonus !== undefined ? { bonus: structuredClone(now.salary.bonus) } : {}) } as NonNullable<EmploymentPeriod["salary"]>;
      }
    });
  });
  return { ...wrapped, sideEffects: `休業の後の同じ勤め先の期間（${from !== null ? `${formatYearMonth(from)}から` : "休業の後"}）も、年収が今と同じなら同じ額にします` };
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
      // 60歳からは、今の働き方（再雇用・嘱託）を先頭に（定年の後の人を正社員の定年・退職金の推定から始めない）
      actions: (ageAt(m, base) >= 60 ? [...ENTRY_TYPES.filter((e) => e.type === "contract"), ...ENTRY_TYPES.filter((e) => e.type !== "contract")] : ENTRY_TYPES).map((e) => ({
        key: e.type === "regular" ? `work/${m.id}/start` : e.type === "selfEmployed" ? `work/${m.id}/startSelf` : `work/${m.id}/start/${e.type}`,
        label: e.label,
        level: "simple" as const,
        choice: { key: `work/${m.id}/entry`, label: "働き方を入れる", help: ENTRY_HELP },
        run: (w: WorkingHousehold) => startWork(w, m, e.type),
      })),
    };
  const find = byId(periods, cur.id);
  // 詳しい欄は、詳細の「働き方 1・2…」のまとまりに出す（同じ期間を2か所に出さない）。このまとまりは標準のときだけ出す
  // 標準の年収は、休業を挟んで続く同じ勤め先の期間も一緒に直す（年収が今の期間と同じときだけ。H3-006・0175）
  const fields = periodFields(wh, m, cur, find, "simple", `work/${m.id}/now`)
    .filter((f) => f.level === "simple")
    .map((f) => (f.key === `work/${m.id}/now/total` ? followAcrossLeave(wh, f, cur.id) : f));
  const past = cur.from.at !== undefined && cur.from.at > base;
  // 標準の「▸ 詳しく」: 住民税と、この期間の詳しい欄（詳細の「働き方 1・2…」と同じ欄。期間の始まり・終わりと、年収・賞与の分け方は詳細で直す。0078 の追記）
  const shownItems = new Set(fields.map((f) => f.item));
  const openFields = [residentTaxField(wh, m), ...periodFields(wh, m, cur, find, "detail", `work/period/${cur.id}`).filter((f) => f.item !== null && !NOT_IN_NOW.has(f.item) && !shownItems.has(f.item))];
  return { key: `work/${m.id}/now`, title: `${who}の今の働き方`, ...(past ? { note: "今は働いていません。次に始まる働き方を出しています" } : {}), level: "simple", moreLabel: "住民税・社会保険などを入れる", fields, actions: [], openFields, simpleOnly: true };
}

/** 住民税（今年度の年税額）の欄。詳細では今の働き方の期間のまとまり、標準では今の働き方の「▸ 詳しく」に出す（欄の一覧には1回だけ） */
function residentTaxField(wh: WorkingHousehold, m: Member): FieldDef {
  const base = wh.request.input.baseMonth;
  const fy = residentTaxYear(base);
  const findTax: Finder = (hh) => ((hh.residentTaxAssessments ?? []) as { member: string; fiscalYear: number }[]).find((a) => a.member === m.id && a.fiscalYear === fy) as Record<string, unknown> | undefined;
  // 決定通知書を見るまでの「書類で確かめる」を出す（0041 の追記 2026-10-31）
  const f = yenBox({
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
    help: "住民税の決定通知書（給与明細の住民税×12）の額。入れなければ前の年の所得から概算します",
  });
  return { ...f, docCheck: CHECK_DOCUMENTS.residentTax, docFor: m.id };
}

/** 今の働き方の「▸ 詳しく」に出さない、期間の欄（期間の形・年収の分け方。標準の欄と2通りの入れ方にしない） */
const NOT_IN_NOW: ReadonlySet<string> = new Set(["employment.from", "employment.to", "employment.type", "employment.salary.annual", "employment.salary.bonus", "employment.leaveKind"]);

/** 働き方の期間1件の欄。簡易では種類・年収・賞与・健康保険、詳細では期間・従業員数・労働時間・標準報酬月額・厚生年金の種別も */
function periodFields(wh: WorkingHousehold, m: Member, p: EmploymentPeriod, find: Finder, level: "simple" | "detail", prefix: string): FieldDef[] {
  const fields: FieldDef[] = [];
  const d = "detail" as const;
  if (level === "detail") {
    fields.push(timepointField({ key: `${prefix}/from`, item: "employment.from", label: "始まり", level: "detail", find, path: ["from"], ageOf: (h) => h.members.find((x) => x.id === m.id), modes: ["age", "ym"], monthOnly: PERIOD_MONTH_ONLY, edge: "from" }));
    // 今の働き方の期間の終わりが、定年後の予定の「定年」か「働く最後の年齢」と同じ物なら出さない（同じ値を2か所で直さない）
    if (!endShownElsewhere(wh, m, p))
      fields.push(timepointField({
        key: `${prefix}/to`,
        item: "employment.to",
        label: "終わり",
        level: "detail",
        find,
        path: ["to"],
        ageOf: (h) => h.members.find((x) => x.id === m.id),
        modes: ["age", "ym"],
        ageMeans: "before",
        startPath: ["from"],
        monthOnly: PERIOD_MONTH_ONLY,
        optional: true,
        nullText: "終わりを決めていない",
      }));
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
      // 種類を変えたら、終わりが無いか推定のままなら働く最後・定年の推定を新しい種類で入れ直し（refitWorkEnd）、正社員・公務員にしたら退職金の目安を
      // 最初から入れる（その人の退職金が無く、該当なしにもしていないとき。fill.ts）。勤め先の初めの値のままの従業員数・週の時間には推定の印
      set: (w, v) => {
        const before = (find(w.request.input.household, w) as EmploymentPeriod | undefined)?.type ?? p.type;
        let next = mutate(w, (h, req) => {
          const list = h.employmentPeriods ?? [];
          const i = list.findIndex((x) => x.id === p.id);
          if (i >= 0 && v !== null) {
            const conv = convertPeriod(list[i] as EmploymentPeriod, String(v), m, req.input.baseMonth);
            if (conv.type !== before) fixPartTimeHealth(h, m, conv);
            list[i] = conv;
          }
          ensureResidentTax(h, m.id, req.input.baseMonth, newId);
        });
        next = ensureRetirement(refitWorkEnd(next, m, p.id, before), m.id);
        const now = (next.request.input.household.employmentPeriods ?? []).find((x) => x.id === p.id);
        if (now === undefined || now.type === before) return next;
        next = dropMarks(next, [`work/period/${p.id}/size`, `work/period/${p.id}/hours`]);
        return markEmployerDefaults(next, now);
      },
    }),
  );
  if (p.type === "leave") fields.push(plain({ key: `${prefix}/leaveKind`, item: "employment.leaveKind", label: "休業の種類", level, kind: "select", options: LEAVE_KINDS, find, path: ["leaveKind"] }));
  // 簡易の今の働き方が休業中なら、休業の終わり（戻る時期）。入れると、休業の後の期間（休業の前と同じ働き方）も作る
  if (p.type === "leave" && level === "simple") fields.push(leaveEndField(wh, m, p, find, prefix));
  if (p.type === "partTime" || p.type === "contract") fields.push(employeeInsuranceField(p, find, prefix, level));
  if (SALARIED.has(p.type)) {
    fields.push(
      // 標準（今の働き方）は年収（賞与込み）の1欄。賞与の内訳は詳細の「働き方 1・2…」の年収・賞与で直す（0078）。
      // 役員だけは標準でも役員報酬（月額。世帯ファイルは年額）と賞与を分けて聞く（社会保険料の上限が月の報酬と賞与で違い、まとめて統計の割合で分けると結果が大きくずれる）
      ...(level === "simple" && p.type === "executive"
        ? [
            officerMonthly(yenBox({ key: `${prefix}/annual`, item: "employment.salary.annual", label: "役員報酬（月額）", level, basis: "annual", find, path: ["salary", "annual"], estimate: () => salaryEstimate(p.type, { age: salaryAge(m, p, wh.request.input.baseMonth) })?.annual ?? null, help: "毎月の役員報酬の額（定期同額給与）。世帯ファイルには12か月分の年額で持ちます" })),
            yenBox({ key: `${prefix}/bonus`, item: "employment.salary.bonus", label: "賞与（年間の合計）", level, basis: "annual", find, path: ["salary", "bonus"], estimate: () => salaryEstimate(p.type, { age: salaryAge(m, p, wh.request.input.baseMonth) })?.bonus ?? null, help: "役員の賞与（事前確定届出給与など）の年間の合計。無ければ0" }),
          ]
        : level === "simple"
        ? [salaryTotalField(wh, m, p, find, prefix)]
        : [
            // 並びは年収 → 賞与 → 増減率 → 統計の年齢カーブ（額の2欄を続け、伸び方の欄は後ろ）
            yenBox({ key: `${prefix}/annual`, item: "employment.salary.annual", label: "年収（税込み・賞与を除く）", level, basis: "annual", find, path: ["salary", "annual"], estimate: () => salaryEstimate(p.type, { age: salaryAge(m, p, wh.request.input.baseMonth) })?.annual ?? null, help: "源泉徴収票の「支払金額」（賞与込み）から、賞与の明細の合計を引いた額" }),
            yenBox({ key: `${prefix}/bonus`, item: "employment.salary.bonus", label: "賞与（年間の合計）", level, basis: "annual", find, path: ["salary", "bonus"], estimate: () => salaryEstimate(p.type, { age: salaryAge(m, p, wh.request.input.baseMonth) })?.bonus ?? null }),
            growthField(wh, p, find, prefix, "salary", d),
            ...curveFields(wh, m, p, find, prefix),
          ]),
      dependentWarned(m, find, plain({
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
      })),
      ...(p.healthInsurance?.kind === "kyokaikenpo"
        ? [plain({ key: `${prefix}/branch`, item: "employment.healthInsurance.insurer", label: "協会けんぽの支部", level: d, kind: "select", options: KYOKAI_BRANCHES, find, path: ["healthInsurance", "insurer"], help: "勤め先の所在地の都道府県（保険料率が支部ごとに違います）" })]
        : []),
      ...(p.healthInsurance?.kind === "union" || p.healthInsurance?.kind === "mutualAid"
        ? [rateBox({ key: `${prefix}/hiRate`, item: "employment.healthInsurance.employeeRate", label: "健康保険料率（本人負担分）", level: d, ...HEALTH_RATE_RANGE, find, path: ["healthInsurance", "employeeRate"], help: "給与明細の健康保険料 ÷ 標準報酬月額 でも出せます" })]
        : []),
      plain({ key: `${prefix}/pc`, item: "employment.pensionCategory", label: "厚生年金", level: d, kind: "select", options: PENSION_CATEGORY, find, path: ["pensionCategory"] }),
      plain({ key: `${prefix}/size`, item: "employment.employer.size", label: "勤め先の従業員数", level: d, kind: "int", suffix: "人", min: 1, find, path: ["employer", "size"], help: "社会保険の適用拡大の判定に使います" }),
      plain({ key: `${prefix}/hours`, item: "employment.employer.weeklyHours", label: "週の所定労働時間", level: d, kind: "decimal", suffix: "時間", find, path: ["employer", "weeklyHours"] }),
      smrField(wh, find, prefix, "health"),
      smrField(wh, find, prefix, "pension"),
      { ...yenBox({ key: `${prefix}/commuting`, item: "employment.salary.commutingMonthly", label: "通勤手当（非課税・月額）", level: d, basis: "monthly", unit: "yen", find, path: ["salary", "commutingMonthly"], optional: true, help: "所得税・住民税はかかりませんが、社会保険料の報酬には入ります。入れなければ0円" }), address: () => ({ target: { object: p.id }, item: "employment.salary.commutingMonthly", at: [] }) },
      { ...plain({ key: `${prefix}/student`, item: "employment.student", label: "学生", level: d, kind: "bool", find, path: ["student"], optional: true, fallback: false, help: "学生は短時間の勤めの社会保険・雇用保険の対象から外れます" }), address: () => ({ target: { object: p.id }, item: "employment.student", at: [] }) },
      { ...plain({ key: `${prefix}/corpDb`, item: "employment.corporatePension", label: "勤め先に確定給付企業年金・共済などがある", level: d, kind: "bool", find, path: ["corporatePension", "db"], optional: true, fallback: false, help: "iDeCo の掛金の上限の判定に使います" }), address: () => ({ target: { object: p.id }, item: "employment.corporatePension", at: ["db"] }) },
    );
    if (p.corporatePension !== undefined && (p.corporatePension as { db?: boolean }).db === true)
      fields.push({ ...plain({ key: `${prefix}/corpDbMonthly`, item: "employment.corporatePension", label: "他制度掛金相当額（月額）", level: d, kind: "yen", basis: "monthly", find, path: ["corporatePension", "dbEquivalentMonthly"], optional: true, help: "勤め先から知らされる額。入れなければ、iDeCo の上限を他制度ありの決まりで見ます" }), address: () => ({ target: { object: p.id }, item: "employment.corporatePension", at: ["dbEquivalentMonthly"] }) });
  }
  if (p.type === "selfEmployed")
    fields.push(yenBox({ key: `${prefix}/business`, item: "employment.business.income", label: "事業所得（年額）", level, basis: "annual", find, path: ["business", "income"], estimate: () => businessEstimate(), help: "青色申告特別控除を引く前の事業所得の額。青色申告決算書の「青色申告特別控除前の所得金額」を写します（決算書が無ければ、申告書第一表の「事業（営業等）」の所得金額に「青色申告特別控除額」を足した額。申告書の所得金額は控除の後の額なので、そのまま写すと控除を2回引きます）。青色申告なら、控除は下の「確定申告」で選ぶと計算で引きます" }), growthField(wh, p, find, prefix, "business", d));
  if (level === "detail") fields.push(...claimFields(wh, m, p, find, prefix));
  return fields;
}

/**
 * 今の働き方の期間の終わりが、ほかの欄（定年後の予定の「定年」か「働く最後の年齢」）と同じ物か。同じなら詳細の「終わり」を出さない。
 * 今の期間がその人の最後の期間（終わりが働く最後の年齢）か、定年後の予定の定年で終わる期間（定年の欄を出しているとき）
 */
function endShownElsewhere(wh: WorkingHousehold, m: Member, p: EmploymentPeriod): boolean {
  const h = wh.request.input.household;
  const base = wh.request.input.baseMonth;
  if (currentPeriod(h, m.id, base)?.id !== p.id || p.to === null) return false;
  const post = wh.postRetirement[m.id];
  const main = mainPeriod(h, m, post);
  if (main?.id === p.id && !(main.to?.at !== undefined && main.to.at < base)) return true;
  const ym = resolveTimepoint(h, p.to);
  return ym !== null && periodsOf(h, m.id).every((q) => q.id === p.id || (q.to !== null && (resolveTimepoint(h, q.to) ?? "") < ym));
}

/**
 * 役員報酬を月額で入れる欄（世帯ファイルは年額のまま。見せる値は年額÷12〔円未満は四捨五入〕、書くときは×12）。退職金の最終報酬月額と単位をそろえる
 */
function officerMonthly(f: FieldDef): FieldDef {
  const toMonthly = (v: Val): Val => (typeof v === "number" ? Math.round(v / 12) : v);
  const toAnnual = (v: Val): Val => (v === null ? null : Number(v) * 12);
  const write = f.write;
  return {
    ...f,
    ...(f.kind === "yen" ? { basis: "monthly" as const } : {}),
    get: (w) => {
      const st = f.get(w);
      return { ...st, value: toMonthly(st.value) };
    },
    set: (w, v) => f.set(w, toAnnual(v)),
    ...(write !== undefined ? { write: (w: WorkingHousehold, v: Val) => write(w, toAnnual(v)) } : {}),
  } as FieldDef;
}

// ---- 標準報酬月額（0047 の追記 2026-10-29）----

type SmrKind = "health" | "pension";
type SmrBox = Box<number> & { estimate?: { method?: string; basis?: string } };
const SMR_LABEL: Record<SmrKind, string> = { health: "健康保険", pension: "厚生年金" };
/**
 * 勤め先の健康保険・厚生年金に入る期間か（空欄のときに目安を見せるか）。健康保険は種類が協会けんぽ・健保組合・共済、厚生年金は種別が入るもの。
 * 勤め先の社会保険を「入っていない」にした期間は見せない（パートの扶養など、標準報酬月額を使わない期間に推定の印を出さない）
 */
function smrCovered(x: EmploymentPeriod, kind: SmrKind): boolean {
  if ((x.employeeInsurance as { value?: boolean } | undefined)?.value === false) return false;
  if (kind === "health") return x.healthInsurance !== undefined && ["kyokaikenpo", "union", "mutualAid"].includes(x.healthInsurance.kind);
  return x.pensionCategory !== undefined && x.pensionCategory !== "none";
}
/** 非課税の通勤手当の月額（標準報酬月額の報酬に入る） */
const commutingOf = (x: EmploymentPeriod): number => (x.salary as { commutingMonthly?: Box<number> } | undefined)?.commutingMonthly?.value ?? 0;
/** 空欄のときの計算の仕方（エンジンの socialInsurance.coverage と同じ: 給与と通勤手当の月額を等級表に当て、毎年9月に4〜6月の平均で決め直す） */
export const SMR_BLANK_BASIS = "入れていないので、給与（賞与を除く年収÷12）と通勤手当の月額から等級表で決めて計算しています。昇給に合わせて、毎年9月にその年の4〜6月の平均で決め直します";

/**
 * 標準報酬月額の欄（健康保険・厚生年金）。世帯ファイルの置き換え口 employment.standardMonthlyRemuneration は健康保険と厚生年金の2つの箱がそろった形
 * （スキーマで両方が必須）なので、片方だけを書くときは、もう片方に、書いた額をその等級表に当てた推定（出どころ auto）を入れる。
 * - 空欄（置き換え口が無い）: 計算は給与からエンジンが決める（毎年決め直す）。欄にはその目安（今の年収と通勤手当の月額を等級表に当てた額）を推定の印で見せ、
 *   「この値にする」でその額を書ける。黙って世帯には書かない（書くと期間の間ずっと同じ額になり、昇給が標準報酬月額に入らないため）
 * - 空にする: もう片方も推定のまま（出どころ auto）なら置き換え口ごと外し（給与から計算に戻す）、そうでなければ、もう片方の額から推定した箱にする
 */
function smrField(wh: WorkingHousehold, find: Finder, prefix: string, kind: SmrKind): FieldDef {
  const item = "employment.standardMonthlyRemuneration";
  const other: SmrKind = kind === "health" ? "pension" : "health";
  const base = wh.request.input.baseMonth;
  const period = (w: WorkingHousehold) => find(w.request.input.household, w) as EmploymentPeriod | undefined;
  const boxOf = (x: EmploymentPeriod | undefined, k: SmrKind) => x?.standardMonthlyRemuneration?.[k] as SmrBox | undefined;
  /** 空欄のときの目安（今の年収と通勤手当の月額。年収が無ければ null） */
  const blank = (x: EmploymentPeriod | undefined): number | null => {
    const annual = x?.salary?.annual.value;
    if (x === undefined || annual == null || !smrCovered(x, kind)) return null;
    return smrEstimate(annual + commutingOf(x) * 12, smrMonth(x, base))[kind].value ?? null;
  };
  /** 片方の額から、もう片方の推定の箱（その額をもう片方の等級表に当てる） */
  const fromOther = (x: EmploymentPeriod, k: SmrKind, v: number): SmrBox => ({
    ...(smrEstimate(v * 12, smrMonth(x, base))[k] as SmrBox),
    estimate: { method: "derived", basis: `${SMR_LABEL[k === "health" ? "pension" : "health"]}の標準報酬月額（${v.toLocaleString("ja-JP")}円）を${SMR_LABEL[k]}の等級表で決めた推定` },
  });
  const put = (w: WorkingHousehold, box: Record<string, unknown> | undefined): WorkingHousehold =>
    mutate(w, (h, req) => {
      const x = find(h, { ...w, request: req }) as EmploymentPeriod | undefined;
      if (x === undefined) return;
      const cur = x.standardMonthlyRemuneration;
      const otherBox = cur?.[other] as SmrBox | undefined;
      if (box === undefined) {
        if (cur === undefined) return;
        // もう片方が無いか、片方を入れたときに作った推定（自動）なら、置き換え口ごと外す（給与から計算に戻る）
        if (otherBox === undefined || (otherBox.state === "estimated" && otherBox.origin.kind === "auto")) {
          delete x.standardMonthlyRemuneration;
          return;
        }
        // もう片方は FP が書いた箱（前の形式の「わからない（代わりの値）」・該当なしを含む）: 触らずに残し、こちらはその額から推定する。
        // 額の無い箱なら、こちらは今の給与から（スキーマは2つとも必須）
        const v = otherBox.value ?? (otherBox as { substitute?: Box<number> }).substitute?.value ?? null;
        const mineNow = typeof v === "number" ? fromOther(x, kind, v) : (smrEstimate((x.salary?.annual.value ?? 0) + commutingOf(x) * 12, smrMonth(x, base))[kind] as SmrBox);
        x.standardMonthlyRemuneration = { ...cur, [kind]: mineNow } as NonNullable<EmploymentPeriod["standardMonthlyRemuneration"]>;
        return;
      }
      const mine = structuredClone(box) as unknown as SmrBox;
      const v = typeof mine.value === "number" ? mine.value : (mine as { substitute?: { value?: number } }).substitute?.value;
      const otherNow = otherBox ?? (typeof v === "number" ? fromOther(x, other, v) : (smrEstimate((x.salary?.annual.value ?? 0) + commutingOf(x) * 12, smrMonth(x, base))[other] as SmrBox));
      x.standardMonthlyRemuneration = { [kind]: mine, [other]: otherNow } as unknown as NonNullable<EmploymentPeriod["standardMonthlyRemuneration"]>;
    });
  return {
    ...field({
      key: `${prefix}/${kind === "health" ? "smrH" : "smrP"}`,
      item,
      label: `標準報酬月額（${SMR_LABEL[kind]}）`,
      level: "detail",
      kind: "yen",
      basis: "monthly",
      unit: "yen",
      optional: true,
      help:
        kind === "health"
          ? "給与明細・標準報酬決定通知書の額。分からなければ入れずに推定のままにします（給与から計算し、昇給に合わせて毎年9月に決め直します）。入れると、この期間はずっとその額で計算します"
          : "給与明細・標準報酬決定通知書の額。分からなければ入れずに推定のままにします（給与から計算し、昇給に合わせて毎年9月に決め直します）。入れると、この期間はずっとその額で計算します。賞与の保険料と年金の額（標準賞与額）は、賞与（年間の合計）から計算します（千円未満を切り捨て、上限あり）",
      get: (w) => {
        const x = period(w);
        const b = boxOf(x, kind);
        if (b !== undefined) {
          const value = b.value ?? (b.state === "unknown" ? ((b as { substitute?: Box<number> }).substitute?.value ?? null) : null);
          return { value, estimated: boxBasis(b) ?? (b.state === "unknown" ? "書類待ち（代わりの値）" : null) };
        }
        const v = blank(x);
        return v === null ? { value: null } : { value: null, estimated: SMR_BLANK_BASIS, hint: `今の年収なら月 ${v.toLocaleString("ja-JP")}円（推定）`, blankHint: "今の年収から等級表で（毎年9月に決め直す）" };
      },
      set: (w, v) => put(w, v === null ? undefined : { value: Number(v), state: "confirmed", origin: { kind: "manual" } }),
      // 空欄のときだけ、目安を「この値にする」で書ける。「書類で確かめる」は出さない（分からなければ空欄のまま給与から計算するのが正しい。代わりの値を
      // 書くと期間の間ずっと同じ額になる。0041 の 2026-10-29 の追記の「推定のある欄だけ」の決まりで、空欄の目安は値を書く推定ではないため）
      ...(boxOf(period(wh), kind) === undefined ? { blankEstimate: (w: WorkingHousehold) => (boxOf(period(w), kind) === undefined ? blank(period(w)) : null) } : {}),
    }),
    // 空欄の目安は、給与から毎年決め直す決まり（確かめて確定にする値ではない）: 確かめの一覧・推定の数・まとめての確定に入れない
    // （欄の「推定」の印と「この値にする」は今のまま。通しの確かめで、値の無い「標準報酬月額 根拠 ▾」が働き方ごとに並んでいた）
    ...(boxOf(period(wh), kind) === undefined ? { quietEstimate: "給与から毎年決め直す標準報酬月額" } : {}),
    boxed: { read: (w) => boxOf(period(w), kind), write: put },
    address: (w) => {
      const x = period(w);
      return x === undefined ? null : { target: { object: x.id }, item, at: [kind] };
    },
  };
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
 * - 見せる値は2つの合計。状態は年収の箱の状態（推定・書類待ち・該当なし・確定）
 * - 合計を入れると: 賞与が確定（人が入れた・書類の値）で合計以下なら、賞与はそのままで年収＝合計−賞与。そうでなければ、賃金の統計（年齢・性別・
 *   働き方の平均）の年収と賞与の割合で賞与を分け（千円単位）、賞与は推定の印（出し方 derived）、年収は確定にする
 * - 空にすると、年収・賞与とも統計の推定に戻す（2つの欄を空にしたのと同じ）。前に入れた書類待ち（前の「わからない」）は年収の箱にある（賞与はそのまま）。
 *   「この値にする」（確定）は年収の箱と、推定のままの賞与をその値のまま確定にする（見えている合計を確定にする。0077 の追記）
 * - 年収が確定で賞与だけが推定なら、欄の名前の横に「推定」の印（partEstimated）
 */
function salaryTotalField(wh: WorkingHousehold, m: Member, p: EmploymentPeriod, find: Finder, prefix: string): FieldDef {
  const item = "employment.salary.annual";
  const stat = () => salaryEstimate(p.type, { age: salaryAge(m, p, wh.request.input.baseMonth) });
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
      // 「この値にする」（確定）は見えている合計を確定にする: 推定のままの賞与も、その値のまま確定にする（推定の根拠は残す。0077 の追記）
      else if (keepBonus && box.state === "confirmed" && s.bonus?.state === "estimated" && typeof s.bonus.value === "number") {
        const b = s.bonus as SalaryBox;
        s.bonus = { value: b.value, state: "confirmed", origin: { kind: "manual" }, estimate: { method: b.estimate?.method ?? "standard", basis: b.estimate?.basis ?? "推定" } } as unknown as Box<number>;
      } else if (!keepBonus) s.bonus = { ...structuredClone(box), value: 0, ...(sub !== undefined ? { substitute: { ...structuredClone(sub), value: 0 } } : {}) } as unknown as Box<number>;
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
      help: "源泉徴収票の「支払金額」（賞与込み）を写します。金額は「千」と「円」の枠をつなげて読み、「内」の額は足しません。年の途中で勤め始めた・辞めた年の票は1年分ではありません。賞与の内訳は「詳細」の「働き方 1・2…」で直せます（入れていなければ統計の割合で分けます）",
      get: (w) => {
        const { a, b } = boxes(w);
        const bv = boxValue(b);
        const basisA = boxBasis(a);
        const basisB = boxBasis(b);
        const estimated = basisA !== null ? (basisB !== null && b?.estimate?.method === "statistic" ? `年収: ${basisA}／賞与: ${basisB}` : basisA) : a?.state === "unknown" ? "書類待ち（代わりの値）" : null;
        // 年収は確定で賞与だけ推定（合計を入れて統計の割合で分けた・賞与が統計の推定のまま）なら、欄に「推定」の印を出す
        const partEstimated = basisA === null && a?.state === "confirmed" && basisB !== null ? `賞与は${basisB}` : null;
        return { value: total(w), estimated, partEstimated, hint: bv !== null && bv > 0 ? `うち賞与 ${manText(bv)}${basisB !== null ? "（推定）" : ""}` : null };
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
      label: "勤め先の社会保険",
      level,
      kind: "select",
      optional: true,
      options: [
        { value: "", label: "わからない（勤め先から判定）" },
        { value: "yes", label: "入っている" },
        { value: "no", label: "入っていない" },
      ],
      help: "健康保険と厚生年金です。給与明細で健康保険料・厚生年金保険料が引かれていれば「入っている」です",
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
    modes: ["ym", "age"],
    mode: "ym",
    monthOnly: PERIOD_MONTH_ONLY,
    optional: true,
    nullText: "戻る時期を決めていない",
    help: "入れると、翌月から休業の前と同じ働き方に戻ります（戻った後の働き方は、「詳細」の「働き方 1・2…」で直せます）",
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
  { value: "sickLeave", label: "休業のまま辞める" },
];
const endsWithLabel = (v: string) => ENDS_WITH.find((x) => x.value === v)?.label ?? v;

/** 辞め方の自動の値と、その理由（欄の選択肢に見せる。エンジンと同じ決まり: 辞める月が60歳以後か定年の出来事なら定年、ほかは自己都合） */
function autoEnding(h: Household, m: Member, p: EmploymentPeriod): { value: string; why: string } {
  const value = defaultEndsWith(h, m, p);
  if (value === "voluntary") return { value, why: "60歳前に辞めるので" };
  const to = p.to === null ? null : resolveTimepoint(h, p.to);
  return { value, why: to !== null && to >= ageReachedMonth(m, 60) ? "60歳以後に辞めるので" : "定年の出来事で辞めるので" };
}

/** 辞め方を推定の定年に戻す（定年後の予定の定年で辞める期間の「自動」。estimatePost と同じ印） */
const setRetirementEstimate = (w: WorkingHousehold, find: Finder): WorkingHousehold =>
  mutate(w, (hh, req) => {
    const x = find(hh, { ...w, request: req }) as EmploymentPeriod | undefined;
    if (x === undefined) return;
    x.endsWith = "retirement";
    const states = ((x as Record<string, unknown>).valueStates ??= {}) as Record<string, unknown>;
    states["employment.endsWith"] = { state: "estimated", origin: { kind: "auto" }, estimate: { method: "standard", basis: "今の勤め先を定年で辞める" } };
  });

/** 辞め方を書く（null は自動に戻す） */
const setEnding = (w: WorkingHousehold, find: Finder, v: string | null): WorkingHousehold =>
  mutate(w, (hh, req) => {
    const x = find(hh, { ...w, request: req }) as EmploymentPeriod | undefined;
    if (x === undefined) return;
    if (v === null) delete x.endsWith;
    else x.endsWith = v;
  });

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
      // おまかせ（推定）は期間の形から決める目安で、期間を変えると入れ直す: 確かめの一覧・推定の数・まとめての確定に入れない
      // （通しの確かめで、どの働き方の期間にも「辞めた後に失業給付を受け取る おまかせ（推定）」が並んでいた）
      quietEstimate: "期間の形から決める目安（期間を変えると入れ直す）",
      get: (w) => {
        const x = cur(w);
        if (x === undefined) return { value: null };
        if (isEstimated(x, o.item)) return { value: "auto", hint: `目安: ${x[prop] === true ? "受け取る" : "受け取らない"}` };
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
    // 定年後の予定の定年で終わる期間（今の勤め先）が、自動のままだと自己都合になるとき（「60歳になる前の月まで」の期間。0047 の追記）
    const post = wh.postRetirement[m.id];
    const atRetirement = mainPeriod(h, m, post)?.id === p.id && post !== undefined;
    // 定年後の予定の定年で辞める期間で、辞め方が推定の定年（か入れた値）なら、先頭の「自動」は推定の定年（選ぶと推定の定年に戻す）。
    // 選択肢の先頭と、選ばれている「定年（推定）」が食い違わないように。辞め方が空の前の世帯は、エンジンの自動の決まり（自己都合）のまま見せる
    const retireAuto = atRetirement && p.endsWith !== undefined;
    const auto = retireAuto ? { value: "retirement", why: "定年後の予定の定年で辞めるので" } : autoEnding(h, m, p);
    out.push(
      {
        ...field({
          key: `${prefix}/endsWith`,
          item: "employment.endsWith",
          label: "辞め方",
          level: "detail",
          kind: "select",
          optional: true,
          options: [{ value: "", label: `自動: ${endsWithLabel(auto.value)}（${auto.why}）` }, ...ENDS_WITH],
          help: "この期間の終わり方です（失業給付と退職金の推定に使います）。自動は、辞める月が60歳以後（か定年の出来事に合わせた期間）なら定年、それより前は自己都合です。「休業のまま辞める」は働けないまま辞める形で、失業給付は受けません",
          get: (w) => {
            const x = find(w.request.input.household, w) as EmploymentPeriod | undefined;
            if (x?.endsWith !== undefined) return { value: x.endsWith };
            const warn = atRetirement && auto.value === "voluntary" ? `定年後の予定では、この期間の終わりが定年（${post.fromAge}歳）です。自動のままだと、60歳になる前に辞めるので自己都合で計算します（退職金の目安・失業給付も自己都合）` : null;
            return { value: "", implicit: true, ...(warn !== null ? { warn, warnFix: { label: "辞め方を定年にする", run: (ww: WorkingHousehold) => setEnding(ww, find, "retirement") } } : {}) };
          },
          set: (w, v) => (retireAuto && (v === null || v === "") ? setRetirementEstimate(w, find) : setEnding(w, find, v === null || v === "" ? null : String(v))),
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

/** 健康保険の欄に、扶養と書いた期間の給与が扶養の基準を超えるときの知らせを足す（計算は扶養のまま。0174 の追記） */
function dependentWarned(m: Member, find: Finder, f: FieldDef): FieldDef {
  return {
    ...f,
    get: (w) => {
      const st = f.get(w);
      const x = find(w.request.input.household, w) as EmploymentPeriod | undefined;
      const who = w.request.input.household.members.find((q) => q.id === m.id) ?? m;
      const warn = x === undefined ? null : declaredDependentWarn(w, who, x);
      return warn !== null ? { ...st, warn } : st;
    },
  };
}

/**
 * この期間の増減率（年。0040。欄の名前は入力項目をまたぐ言葉の決まりの「増減率（年）」（年収は減ることもあるため。0130 の追記 2026-11-08））: 空欄は前提の賃金上昇率。給与は昇給カーブ（値ID）と率のどちらか一方なので、率を入れると昇給カーブの代わりになる。
 * 事業所得も同じ（昇給カーブは無い）
 */
function growthField(wh: WorkingHousehold, p: EmploymentPeriod, find: Finder, prefix: string, part: "salary" | "business", level: "simple" | "detail"): FieldDef {
  const item = part === "salary" ? "employment.salary.growth" : "employment.business.growth";
  const wage = (wh.request.input.assumptions as { wageGrowth?: { default?: string } } | undefined)?.wageGrowth?.default;
  return {
    ...field({
      key: `${prefix}/${part}Growth`,
      item,
      label: "増減率（年）",
      level,
      kind: "pct",
      ...GROWTH_RANGE,
      optional: true,
      help: part === "salary" ? "毎年この率で伸ばします（マイナスも入れられます）。入れなければ前提条件の賃金上昇率。入れると統計の年齢カーブは使いません" : "毎年この率で伸ばします（マイナスも入れられます）。入れなければ前提条件の賃金上昇率",
      get: (w) => {
        const x = find(w.request.input.household, w) as EmploymentPeriod | undefined;
        const g = (x?.[part] as { growth?: { rate?: string; curve?: string } } | undefined)?.growth;
        if (g?.rate !== undefined) return { value: g.rate };
        if (g?.curve !== undefined) return { value: null, hint: "空欄: 統計の年齢カーブ（年齢の係数の比）と前提条件の賃金上昇率" };
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

// ---- 統計の年齢カーブ（昇給カーブ。0116。0118 で男女計・学歴計だけにした）----

const CURVE_ITEM = "employment.salary.growth";
const CURVE_SIZE_LABEL: Readonly<Record<WageSize, string>> = { all: "企業規模計（分けない）", large: "1,000人以上", medium: "100〜999人", small: "10〜99人" };
/** 前からある既定の昇給カーブ（正社員・正職員 男女計 学歴計 企業規模計。60歳以後も下がる）。画面からは選ばないが、入っていれば見せる */
const LEGACY_CURVE = "wageStats.default";
const LEGACY_CHOICE: WageCurveChoice = { employment: "regular", size: "all" };

const curveOf = (p: EmploymentPeriod | undefined): string | undefined => (p?.salary?.growth as { curve?: string } | undefined)?.curve;
const choiceOf = (id: string | undefined): WageCurveChoice | null => (id === undefined ? null : id === LEGACY_CURVE ? null : parseWageCurveId(id));

/**
 * 働き方の種類を変えたときの統計の年齢カーブ: 正社員⇄契約・嘱託は、同じ企業規模の表に移す。
 * 選べない種類（パート・公務員・役員）にしたら外す（前提条件の賃金上昇率に戻る）
 */
function convertCurve(salary: NonNullable<EmploymentPeriod["salary"]>, type: string): void {
  const id = (salary.growth as { curve?: string } | undefined)?.curve;
  if (id === undefined) return;
  const employment = wageCurveEmployment(type);
  if (employment === null) {
    delete salary.growth;
    return;
  }
  const c = id === LEGACY_CURVE ? LEGACY_CHOICE : parseWageCurveId(id);
  if (c !== null && c.employment !== employment) salary.growth = { curve: wageCurveId({ ...c, employment }) };
}

/** 統計の年齢カーブの効き方の文（今の年齢の係数と55〜59歳の係数。エンジンと同じく、その年の12月31日の年齢で読む） */
function curveEffect(wh: WorkingHousehold, m: Member, p: EmploymentPeriod, id: string): string | null {
  const table = wageCurveTable(id);
  if (table === null) return null;
  const base = wh.request.input.baseMonth;
  const refYear = Math.max(Number((p.from.at ?? base).slice(0, 4)), Number(base.slice(0, 4)));
  const age = refYear - Number(m.birth.birthYearMonth.slice(0, 4));
  const now = wageCurveRate(table, age);
  const top = wageCurveRate(table, 59);
  const tail = id === LEGACY_CURVE ? "前の版の表で、60歳以後は下がります" : "60歳以後は伸ばしません";
  if (age >= 55 || now <= 0) return `${age}歳からは係数が変わらないので、前提条件の賃金上昇率の分だけ伸ばします（${tail}）`;
  return `係数 ${age}歳 ${now.toFixed(2)} → 55〜59歳 ${top.toFixed(2)}（今の年収の${(top / now).toFixed(2)}倍まで。前提条件の賃金上昇率の分は別に伸ばします。${tail}）`;
}

/**
 * 統計の年齢カーブで増やす（詳細の働き方の期間。給与の期間の正社員・契約・嘱託だけ。0116）: 賃金構造基本統計調査の年齢階級ごとの年収の比で、
 * 今の年収から将来の年収を出す（係数の比を毎年掛ける。エンジンの昇給カーブ salary.growth.curve）。既定は使わない（前提条件の賃金上昇率だけ）。
 * 表は男女計・学歴計（人の属性で推定の数字を分けない。0118）。企業規模は勤め先の属性なので、使うと選べる
 */
function curveFields(wh: WorkingHousehold, m: Member, p: EmploymentPeriod, find: Finder, prefix: string): FieldDef[] {
  const employment = wageCurveEmployment(p.type);
  const cur = curveOf(p);
  if (employment === null && cur === undefined) return [];
  const choice = choiceOf(cur);
  const address = () => ({ target: { object: p.id }, item: CURVE_ITEM, at: ["curve"] });
  const write = (w: WorkingHousehold, next: (c: WageCurveChoice) => WageCurveChoice) =>
    mutate(w, (h, req) => {
      const x = find(h, { ...w, request: req }) as EmploymentPeriod | undefined;
      const e = x === undefined ? null : wageCurveEmployment(x.type);
      if (x?.salary === undefined || e === null) return;
      const id = curveOf(x);
      const c = id === LEGACY_CURVE ? LEGACY_CHOICE : choiceOf(id);
      x.salary.growth = { curve: wageCurveId(next({ ...(c ?? { size: "all" }), employment: e })) };
    });
  const other = cur !== undefined && choice === null ? [{ value: "other", label: cur === LEGACY_CURVE ? "前の版の表で増やす（正社員・60歳以後も下がる）" : `ほかの表で増やす（${cur}）` }] : [];
  const out: FieldDef[] = [
    {
      ...field({
        key: `${prefix}/salaryCurve`,
        item: CURVE_ITEM,
        label: "統計の年齢カーブで増やす",
        level: "detail",
        kind: "select",
        options: [{ value: "none", label: "使わない" }, ...(employment !== null ? [{ value: "use", label: "統計の年齢カーブで増やす" }] : []), ...other],
        structural: true,
        help: "使わないときは、前提条件の賃金上昇率（か「増減率（年）」）で伸ばします。使うと、賃金構造基本統計調査（厚生労働省 令和7年）の年齢ごとの年収の比で、今の年収から毎年の年収を伸ばします（30〜34歳から40〜44歳へ、のように年齢の係数の比を掛けます）。前提条件の賃金上昇率の分も別に伸ばします。「増減率（年）」を入れていれば、その代わりに使います。表は性別・学歴で分けない全体の表です。60歳以後は伸ばしません（定年後の下がり方は定年後の予定で入れます）",
        get: (w) => {
          const x = find(w.request.input.household, w) as EmploymentPeriod | undefined;
          const id = curveOf(x);
          if (id === undefined) return { value: "none" };
          const c = choiceOf(id);
          const xm = w.request.input.household.members.find((y) => y.id === m.id) ?? m;
          const hint = x === undefined ? null : curveEffect(w, xm, x, id);
          return { value: c === null ? "other" : "use", hint };
        },
        set: (w, v) => {
          if (v === "other" || v === null) return w;
          if (v === "none")
            return mutate(w, (h, req) => {
              const x = find(h, { ...w, request: req }) as EmploymentPeriod | undefined;
              if (curveOf(x) !== undefined && x?.salary !== undefined) delete x.salary.growth;
            });
          return write(w, (c) => c);
        },
      }),
      address,
    },
  ];
  if (choice === null || employment === null) return out;
  out.push({
    ...field({
      key: `${prefix}/salaryCurveSize`,
      item: CURVE_ITEM,
      label: "年齢カーブの企業規模",
      level: "detail",
      kind: "select",
      options: WAGE_CURVE_SIZES.map((z) => ({ value: z, label: CURVE_SIZE_LABEL[z] })),
      help: "勤め先の企業全体の常用労働者数の区分。大きい企業ほど年齢で伸びる表です",
      get: (w) => {
        const x = find(w.request.input.household, w) as EmploymentPeriod | undefined;
        const value = choiceOf(curveOf(x))?.size ?? "all";
        const n = x?.employer?.size;
        return { value, hint: n === undefined ? null : `勤め先の従業員数（${n.toLocaleString("ja-JP")}人）なら「${CURVE_SIZE_LABEL[wageSizeClass(n)]}」` };
      },
      set: (w, v) => (v === null ? w : write(w, (c) => ({ ...c, size: v as WageSize }))),
    }),
    address,
  });
  return out;
}

/**
 * 詳細の働き方の期間のまとまり（その人の区画の中。「働き方 1」「働き方 2」…の順に、その下に足すボタン。0047 の追記）。
 * 今の働き方の期間（計算基準月にしている期間。無ければ次に始まる期間）には住民税の欄も置く（標準の「今の働き方」の詳しい欄と同じ欄）
 */
function periodListGroups(wh: WorkingHousehold, m: Member): GroupDef[] {
  const h = wh.request.input.household;
  const base = wh.request.input.baseMonth;
  const who = memberLabel(wh, m.id);
  const cur = currentPeriod(h, m.id, base);
  const ps = periodsOf(h, m.id);
  const groups: GroupDef[] = ps.map((p, i) => {
    const now = p.id === cur?.id && (p.from.at ?? "") <= base && (p.to === null || (p.to.at ?? "9999-12") >= base);
    const fields = periodFields(wh, m, p, byId(periods, p.id), "detail", `work/period/${p.id}`);
    return {
      key: `work/period/${p.id}`,
      title: `${who}の働き方 ${i + 1}${now ? "（今の働き方）" : ""}`,
      level: "detail",
      fields: p.id === cur?.id ? [...fields, residentTaxField(wh, m)] : fields,
      actions: [removeAction(`work/period/${p.id}/remove`, WORDS.remove, "detail", (hh) => void (hh.employmentPeriods = (hh.employmentPeriods ?? []).filter((x) => x.id !== p.id)))],
    };
  });
  // 期間が無い人は、今の働き方のまとまりの「会社員として入れる」などで始める（足すボタンも出す）
  groups.push({ key: `work/${m.id}/periods`, level: "detail", fields: [], actions: [addPeriodAction(wh, m, ps.length + 1)] });
  return groups;
}

function addPeriodAction(wh: WorkingHousehold, m: Member, n: number): ActionDef {
  return {
    key: `work/${m.id}/addPeriod`,
    label: `＋ ${memberLabel(wh, m.id)}の働き方 ${n}`,
    level: "detail",
    help: "正社員→育休→時短→退職→パート、定年→再雇用のように、働き方を期間に分けて並べます。期間は重ならないようにします。足した期間は、前の期間の次の月からパート・アルバイトで5年間です（種類・始まり・終わりは足した後に直せます）",
    run: (w) => {
      const ps = periodsOf(w.request.input.household, m.id);
      const lastEnd = ps.map((p) => p.to?.at).filter((x): x is string => x !== undefined).sort().at(-1);
      const from = lastEnd !== undefined ? addMonths(lastEnd, 1) : w.request.input.baseMonth;
      // 終わりは始まりから5年（90歳になる前の月まで。1か月だけの期間を作らない）
      const cap = addMonths(ageReachedMonth(m, 90), -1);
      const five = addMonths(from, 59);
      const to = five < cap ? five : cap < from ? from : cap;
      const p = convertPeriod({ id: newId(), member: m.id, from: { at: from }, to: { at: to }, type: "partTime" }, "partTime", m, w.request.input.baseMonth);
      const next = mutate(w, (hh, req) => {
        fixPartTimeHealth(hh, m, p);
        (hh.employmentPeriods ??= []).push(p);
        ensureResidentTax(hh, m.id, req.input.baseMonth, newId);
      });
      return adoptBenefits(markEmployerDefaults(next, p), m.id);
    },
  };
}

/**
 * 役員として働く人の、会社とのお金（0105）: 会社の借入の連帯保証の額（今の額）。負債には入れず、資産と負債のタブで図の外に見せる。
 * 自社株（出資額）・会社への貸付金は貯蓄・運用、会社からの借入金は住まい・ローンで入れる（ここは読むだけの1行で案内する）
 */
function officerGroup(wh: WorkingHousehold, m: Member): GroupDef | null {
  const h = wh.request.input.household;
  if (!executiveMembers(h).some((x) => x.id === m.id)) return null;
  const find = byId((x) => x.members, m.id);
  const k = `work/${m.id}/officer`;
  const owned = (h.accounts ?? []).filter((a) => a.owner === m.id && a.kind === "otherAsset" && (a.subtype === "ownCompanyShares" || a.subtype === "loanToCompany")).length;
  const borrowed = (h.debts ?? []).filter((d) => d.subtype === "companyLoan" && d.debtors.some((x) => x.member === m.id)).length;
  const guarantee = yenBox({ key: `${k}/guarantee`, item: "member.companyGuarantee", label: "会社の借入の連帯保証の額", level: "simple", basis: "once", find, path: ["companyGuarantee"], optional: true, help: "役員を務める会社の借入のうち、連帯保証している額（今の額）。負債の合計には入れず、資産と負債のタブで「保証を含めると純資産は○円」と別に見せます。計算には使いません" });
  return {
    key: k,
    title: `${memberLabel(wh, m.id)}の会社とのお金（役員）`,
    note: `自社株（出資額）と会社への貸付金は「貯蓄・運用」のその他の資産${owned > 0 ? `（${owned}件）` : ""}、会社からの借入金は「住まい・ローン」のほかのローン${borrowed > 0 ? `（${borrowed}件）` : ""}で入れます。会社の側の数字（会社の決算・会社の資産と負債）は入れません`,
    level: "simple",
    fields: [{ ...guarantee, address: () => ({ target: { member: m.id }, item: "member.companyGuarantee", at: [] }) }],
    actions: [],
  };
}

/**
 * 事業所得のある人（自営の働き方・事業所得の入るお金の行・事業所得の民泊・宿）の確定申告: 申告の仕方と青色申告特別控除（0155）。
 * 収益不動産の「申告」と同じ欄・同じ値（members[].taxReturn）。入れないと白色（控除なし）の推定。標準に出す（青色申告特別控除の有無で
 * 90歳の金融資産が500万円以上動く世帯があり、顧客が答えられる。0078 の決め方）
 */
function taxReturnGroup(wh: WorkingHousehold, m: Member): GroupDef | null {
  if (!hasBusinessIncome(wh.request.input.household, m.id)) return null;
  const k = `work/${m.id}/taxReturn`;
  return { key: k, title: `${memberLabel(wh, m.id)}の確定申告`, level: "simple", fields: taxReturnFields(wh, m.id, k, "simple", false), actions: [] };
}

export function workStage(wh: WorkingHousehold): StageDef {
  const h = wh.request.input.household;
  const people = earners(h);
  // 人ごとの区画: 標準は今の働き方 → 定年後の予定。詳細は働き方 1・2…（＋ 働き方を足す）→ 定年後の予定（今の働き方のまとまりは標準だけ。0047 の追記）
  const sections: SectionDef[] = people.map((m) => {
    const groups: GroupDef[] = [nowGroup(wh, m), ...periodListGroups(wh, m)];
    const tr = taxReturnGroup(wh, m);
    if (tr !== null) groups.push(tr);
    const r = retirementGroup(wh, m);
    if (r !== null) groups.push(r);
    const benefits = (h.retirementBenefits ?? []).filter((b) => b.member === m.id);
    // 退職金・企業年金は退職金・企業年金のカードに出す（ここは読むだけの1行）
    const ro = readGroup(`work/${m.id}/benefits`, undefined, benefits.length > 0 ? [readLine(`work/${m.id}/benefits`, "退職金・企業年金", `${benefits.length}件`, "退職金・企業年金")] : []);
    if (ro !== null) groups.push(ro);
    const og = officerGroup(wh, m);
    if (og !== null) groups.push(og);
    return { key: `work/${m.id}`, title: memberLabel(wh, m.id), level: "simple", groups, actions: [] };
  });
  // 欄・ボタンの後に、推定のままの定年後の予定を入れ直し、新しく作った期間に給付を受け取るかの推定を入れる
  const wrap = (sec: SectionDef): SectionDef => ({ ...sec, groups: sec.groups.map((g) => ({ ...g, fields: g.fields.map(wrapField), actions: g.actions.map(wrapAction), ...(g.openFields !== undefined ? { openFields: g.openFields.map(wrapField) } : {}) })), actions: sec.actions.map(wrapAction) });
  return { id: "work", label: "働き方と収入", lead: "今の働き方・年収と、定年後の予定。", sections: sections.map(wrap) };
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
