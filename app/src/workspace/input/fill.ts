// 入っていない物（未入力（0円で計算中）の物）と「推定で埋める」（0035 の11・0041）。
// - 古い世帯を開いても、ここの推定は自動で入れない（黙って書き換えない）。確かめの一覧とカードのパネルに「未入力」として出し、
//   FP が「推定で埋める」（1件ごと・カードごと・まとめて）を押したときだけ入れる。無いと決めたら「該当なし」
// - 新しく入れるとき（子を足す・会社員として入れる・働き方を正社員や公務員にする）は、最初から推定で入れる（ensure*）
// - 推定の目安は今ある関数（hearing/src/estimates.ts・教育の標準の進路の型）で作れる範囲だけ。作れない物は「推定で埋める」を出さない
import type { Box, CareExpense, EducationStage, EmploymentPeriod, Household, Member, RetirementBenefit, Timepoint } from "../../engine/types.ts";
import { careEstimate, fillsByEstimate, lifeExpectancy } from "../../../../hearing/src/estimates.ts";
import { masterAmount } from "../../../../hearing/src/statistics.ts";
import { presetNum, presetText } from "../../../../hearing/src/presets.ts";
import { addMonths, ageAt } from "../levers.ts";
import { resolveTimepoint, type StageId } from "./form.ts";
import { CHILD_LEAVES_AGE, isSchoolLinkedLeaves, LEAVES_BASIS, mutate, newId, type WorkingHousehold } from "./household.ts";
import { livingEstimate } from "./estimates.ts";
import { startLiving } from "./livingStages.ts";
import { memberLabel } from "./labels.ts";
import { putRow, rowAt, type StateRow } from "./rows.ts";
import { COURSE_PRESETS, defaultStages, nurseryFreeMonth, presetOf, STAGE_ORDER } from "./stages/education.ts";
import { isHigher, STAGE_START_AGE, stagePeriod, stageYears } from "./educationCost.ts";
import { amountsUnentered, fillMonths, pensionMembers, statementMonthsMissing, substituteMonths, switchPension } from "./stages/pension.ts";
import { benefitPeriod } from "./stages/retirement.ts";
import { estimateWorkEnd } from "./stages/work.ts";
import { currentPeriodId } from "../store/readings.ts";
import { missingUnemployment, putEstimate, UNEMPLOYMENT_BASIS, UNEMPLOYMENT_ITEM, unemploymentEstimate } from "./claims.ts";
import { AUTO_TYPES, autoKindOf, civilEstimate, COMPUTED, finalMonthlyAt, initialBenefit, isAutoBenefit, isUnenteredBox, KIND_SHORT, prevalenceText, reasonAt, rowOfBenefit, type BenefitKind } from "./retirementBenefits.ts";

type Obj = Record<string, unknown>;
/** 生年月を持つか（世帯の外の家族は生年月を省ける。0035 の4） */
export const hasBirth = (m: Member): boolean => (m.birth as Member["birth"] | undefined)?.birthYearMonth !== undefined;
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
  /** この推定の根拠（「推定で入れる」の説明に出す） */
  basis?: string;
  /**
   * 「推定で入れる」で入る中身の1行（例: 「賃貸・家賃 月8万円（よくある額）」）。押す前に何が入るかが分かるように、行の下に出す（0041 の追記 2026-11-06）
   */
  what?: string;
  /** 推定のほかに考えられる入れ方の案内（例: 持ち家なら住まい・ローンで入れる）。行の下に出す */
  alt?: string;
  /** 該当なし（FP が「無い」と決める） */
  none?: (wh: WorkingHousehold) => WorkingHousehold;
  /** 「該当なし」の言い方（例: 「勤め先に制度が無い」） */
  noneLabel?: string;
}

const estimatedRow = (method: string, basis: string): StateRow => ({ state: "estimated", origin: { kind: "auto" }, estimate: { method, basis } });
const notApplicableRow: StateRow = { state: "notApplicable", origin: { kind: "manual" } };

/** 中身の1行の額（万円で小数1桁まで） */
const manOf = (yen: number): string => `${(Math.round(yen / 1000) / 10).toLocaleString("ja-JP", { maximumFractionDigits: 1 })}万円`;

// ---- 教育 ----

/** 教育の進路を推定で入れたときの根拠（標準の進路の型。0010 の追記 2026-10-25） */
export const EDUCATION_BASIS = "既定の進路の型（幼稚園〜高校は公立、大学は私立・文系・自宅）";

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
  // 新しく入れる進路は、学校外の費用を「統計の平均で」で始める（行を足すときは「行で入れる」に切り替える。0062）
  return mutate(wh, (hh, req) => {
    (hh.goals ??= []).push({ id, kind: "education", owner: childId, education: { stages: stages.map((s) => ({ id: newId(), ...s })), outOfSchoolMode: "statistics" } });
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
    if (strip(next) !== strip(g.education.stages)) g.education.stages = next.map((s) => ({ id: newId(), ...s }));
  }
}

/** 段が計算基準月の前に終わっているか（保育園は3歳になった後の最初の4月から無償なので、その月が計算基準月までに来ていれば終わり） */
export function stageEnded(child: Member, s: EducationStage, baseMonth: string): boolean {
  if (s.stage === "nursery") {
    const free = nurseryFreeMonth(child);
    return free !== null && free <= baseMonth;
  }
  const p = stagePeriod(child, s);
  return p !== null && p.to < baseMonth;
}

/** 生年月を直したときに足すことのある段（幼稚園〜高校と大学） */
const LADDER = ["kindergarten", "elementary", "juniorHigh", "highSchool", "university"] as const;

/**
 * 子の生年月を直したときに、FP が直した進路の段を新しい年齢に合わせる（推定のままの進路は refreshEducation が入れ直す）。h をそのまま書き換える。
 * - 新しい年齢で終わった段（計算基準月より前に卒業した段・3歳の4月を過ぎた保育園）は外す（これからの費用に効かず、残すと年齢に合わない段が見える）
 * - 前の年齢では終わっていたので入っていなかった段（幼稚園〜高校・大学）は、新しい年齢でこれからなら足す。公立・私立は、段の並びが進路の型に
 *   当たればその型の値、当たらなければ標準の型（大学だけ私立〔文系・自宅〕）の値。FP が自分で外した段（前の年齢でもこれからだった段）は足さない
 * - 該当なしにした子は変えない
 */
export function alignEducationToAge(h: Household, childId: string, baseMonth: string, before: Member): void {
  const child = h.members.find((m) => m.id === childId && m.kind === "child");
  const g = child === undefined ? undefined : educationGoalOf(h, childId);
  if (child === undefined || g?.education === undefined) return;
  const row = rowAt({ household: h } as unknown as Obj, educationStagesAddress(g.id));
  if (row?.state === "notApplicable" || (row?.state === "estimated" && row.origin.kind === "auto")) return;
  const stages = g.education.stages;
  const preset = COURSE_PRESETS.find((p) => p.value === presetOf(stages));
  const kept = stages.filter((s) => !stageEnded(child, s, baseMonth));
  const hasHigher = stages.some((s) => isHigher(s.stage));
  const standard = defaultStages(child, baseMonth);
  const added: EducationStage[] = [];
  for (const stage of LADDER) {
    if (stages.some((s) => s.stage === stage) || (stage === "university" && hasHigher) || (stage === "highSchool" && stages.some((s) => s.stage === "kosen"))) continue;
    // 前の年齢でこの段が終わっていた（終わっていたので入っていなかった）段だけを足す
    const now = standard.find((s) => s.stage === stage);
    if (!stageEnded(before, { stage }, baseMonth) || now === undefined) continue;
    const sector = preset?.sectors[stage] ?? now.sector;
    added.push({ id: newId(), ...now, ...(sector !== undefined ? { sector } : {}) });
  }
  if (added.length === 0 && kept.length === stages.length) return;
  g.education.stages = [...kept, ...added].sort((a, b) => STAGE_ORDER.indexOf(a.stage) - STAGE_ORDER.indexOf(b.stage));
}


// ---- 子の独立（最後の学校の終わりに合わせる。0062 の追記 2026-10-30）----

/**
 * 子の最後の学校を出た翌月の4月の学年の年齢（独立の年齢。学年の区切りの年齢の時点で持つ）。段の始まりの年齢＋浪人の年数＋在学年数のいちばん大きい値。
 * 該当なし・段の無い子は null（今の独立のまま）
 */
export function schoolEndAge(h: Household, childId: string): number | null {
  const g = educationGoalOf(h, childId);
  const stages = (g?.education?.stages ?? []).filter((s) => s.stage !== "nursery");
  // 休学して1年の留学（0088）は、その段と後の段の終わりを1年ずつうしろにする
  const leaves = (g?.education?.abroad ?? []).filter((a) => a.kind === "leave");
  let end: number | null = null;
  let kosenEnd: number | null = null;
  for (const s of [...stages].sort((a, b) => (STAGE_START_AGE[a.stage] ?? 0) - (STAGE_START_AGE[b.stage] ?? 0))) {
    const nominal = STAGE_START_AGE[s.stage];
    if (nominal === undefined) continue;
    const shift = leaves.filter((a) => (STAGE_START_AGE[a.stage] ?? 99) <= nominal && stages.some((x) => x.stage === a.stage)).length;
    // 大学院は前の学校を出た後から（0089）
    const graduate = s.stage === "graduateMaster" || s.stage === "graduateDoctor" || s.stage === "graduateProfessional";
    // 高専の後の大学などは、高専を出た後から（0090）
    const afterKosen = isHigher(s.stage) && kosenEnd !== null;
    const start: number = afterKosen ? (kosenEnd as number) - shift : graduate && end !== null ? end - shift : nominal;
    const age = start + (s.delayYears ?? 0) + stageYears(s) + shift;
    if (s.stage === "kosen") kosenEnd = age;
    if (end === null || age > end) end = age;
  }
  return end;
}

/** 子の独立を最後の学校の終わりに合わせる（段の無い子は前の標準の22歳）。h をそのまま書き換える */
function linkLeaves(h: Household, m: Member): void {
  const years = schoolEndAge(h, m.id) ?? CHILD_LEAVES_AGE;
  const cur = m.leaves?.memberAge?.years;
  if (cur !== years || m.leaves?.memberAge?.ageSwitch !== "schoolYear") m.leaves = { memberAge: { member: m.id, years, ageSwitch: "schoolYear" } };
}

/** 推定の入れ直し: 最後の学校の終わりに合わせる形の子の独立を、今の進路に合わせる（年月などで入れた独立は変えない）。h をそのまま書き換える */
export function refreshLeaves(h: Household): void {
  for (const m of h.members) {
    if (m.kind !== "child" || m.leaves === undefined) continue;
    if (isSchoolLinkedLeaves(m)) {
      linkLeaves(h, m);
      continue;
    }
    // 独立の出来事（生活費の節目などが指す）を指す子は、出来事の時点が最後の学校の終わりに合わせる形なら、出来事を合わせる
    const t = m.leaves;
    const ev = t?.event === undefined || t.offset !== undefined ? undefined : (h.events ?? []).find((e) => e.id === t.event);
    if (ev === undefined || !isSchoolLinkedLeaves({ ...m, leaves: ev.at })) continue;
    const years = schoolEndAge(h, m.id) ?? CHILD_LEAVES_AGE;
    if (ev.at.memberAge?.years !== years) ev.at = { memberAge: { member: m.id, years, ageSwitch: "schoolYear" } };
  }
}

/** 前に年月などで入れた子の独立を、最後の学校の終わりに合わせる形にする（ボタン） */
export function leavesToSchool(wh: WorkingHousehold, id: string): WorkingHousehold {
  const next = mutate(wh, (h) => {
    const m = h.members.find((x) => x.id === id);
    if (m !== undefined) linkLeaves(h, m);
  });
  return { ...next, assumed: { ...next.assumed, [`family/${id}/leaves`]: LEAVES_BASIS } };
}

// ---- 退職金（0057。種類ごとの形と目安は retirementBenefits.ts）----

/** 働き方の期間の「退職給付」の当て先（該当なしの行を置く所） */
const benefitAddress = (periodId: string) => ({ target: { object: periodId }, item: "employment.retirementBenefit", at: [] as string[] });

/** 今の働き方で自動で足す退職給付の目安（正社員は退職一時金、公務員は退職手当の見込みの計算）。作れなければ null */
/** 退職金の「推定で入れる」の中身の1行 */
function retirementWhat(b: RetirementBenefit): string {
  const v = b.amount?.value;
  return typeof v === "number" && v > 0 ? `退職一時金 ${manOf(v)}（統計の平均）` : `${KIND_SHORT[b.kind as BenefitKind] ?? "退職金"}の見込み（退職手当の計算）`;
}

function retirementEstimate(h: Household, m: Member, p: EmploymentPeriod, baseMonth: string): { benefit: RetirementBenefit; basis: string } | null {
  const kind = autoKindOf(p.type);
  if (kind === null) return null;
  // 受け取り（勤め先を辞めた翌月）が計算の基準の月より前になる目安は足さない（もう受け取った退職金を、推定で将来の収入にしない。ホームの見込みにも入らない）
  const end = p.to === null ? null : resolveTimepoint(h, p.to);
  if (end !== null && addMonths(end, 1) < baseMonth) return null;
  const b = initialBenefit(h, m, kind, { id: "", employment: p.id });
  if (kind === "lumpSum") return isUnenteredBox(b.amount) ? null : { benefit: b, basis: (b.amount as unknown as { estimate: { basis: string } }).estimate.basis };
  if (b.estimate?.finalMonthly === undefined) return null;
  return { benefit: b, basis: civilEstimate(h, b)?.basis ?? "" };
}

/** 退職金の目安を入れる（今の働き方が正社員・公務員で、その人の退職金がまだ無いとき）。該当なしの印は外す */
export function fillRetirement(wh: WorkingHousehold, memberId: string): WorkingHousehold {
  const h = wh.request.input.household;
  const m = h.members.find((x) => x.id === memberId);
  const p = m === undefined ? undefined : currentPeriod(h, m.id, wh.request.input.baseMonth);
  if (m === undefined || p === undefined || !AUTO_TYPES.has(p.type) || (h.retirementBenefits ?? []).some((b) => b.member === memberId)) return wh;
  const est = retirementEstimate(h, m, p, wh.request.input.baseMonth);
  if (est === null) return wh;
  const added = mutate(wh, (hh, req) => {
    // 初めの形は仮の ID で作った（値の状態の行の鍵は物の ID を含まないので、ID を付け直すだけでよい）
    (hh.retirementBenefits ??= []).push(structuredClone({ ...est.benefit, id: newId() }));
    putRow(req.input as unknown as Obj, benefitAddress(p.id), undefined);
  });
  // 勤め先の期間に終わりが無いと、受け取る時期が決まらず計算に入らない（0163）。働く最後の年齢の推定（定年など。0049）で期間の終わりを
  // 補い、推定の印を付ける（働き方を入れたときと同じ estimateWorkEnd。0175）
  return p.to === null ? estimateWorkEnd(added, memberId) : added;
}

/**
 * 勤め先（働き方の期間）を持たない退職金（勤め先の期間を外した後など。0163）を、働き方の期間を足した後に、退職給付を足すときと同じ既定の
 * 勤め先（benefitPeriod。0150）に付ける。付けるのは、勤め先が指す先の無い退職金と、勤め先も勤続期間も受け取る時期も無い（このままでは
 * 計算に入らない）退職金だけ。国民年金基金は勤め先を持たない
 */
export function adoptBenefits(wh: WorkingHousehold, memberId: string): WorkingHousehold {
  const h = wh.request.input.household;
  const m = h.members.find((x) => x.id === memberId);
  if (m === undefined) return wh;
  const ids = new Set((h.employmentPeriods ?? []).map((p) => p.id));
  const orphan = (b: RetirementBenefit) =>
    b.member === memberId &&
    b.kind !== "nationalPensionFund" &&
    (b.employment !== undefined ? !ids.has(b.employment) : b.service === undefined && b.paidAt === undefined && b.receipt?.start === undefined);
  const to = new Map<string, string>();
  for (const b of h.retirementBenefits ?? []) {
    if (!orphan(b)) continue;
    const p = benefitPeriod(h, m, wh.request.input.baseMonth, b.kind as BenefitKind);
    if (p !== undefined) to.set(b.id, p.id);
  }
  if (to.size === 0) return wh;
  return mutate(wh, (hh) => {
    for (const b of hh.retirementBenefits ?? []) {
      const p = to.get(b.id);
      if (p !== undefined) b.employment = p;
    }
  });
}

/** 退職金を「該当なし」（勤め先に制度が無い）にする: 今の働き方の期間に該当なしの行 */
export function retirementNone(wh: WorkingHousehold, memberId: string): WorkingHousehold {
  const p = currentPeriod(wh.request.input.household, memberId, wh.request.input.baseMonth);
  if (p === undefined) return wh;
  return mutate(wh, (_h, req) => void putRow(req.input as unknown as Obj, benefitAddress(p.id), notApplicableRow));
}

/** 今の働き方の退職金が「該当なし」か */
export function retirementNotApplicable(wh: WorkingHousehold, memberId: string): boolean {
  const p = currentPeriod(wh.request.input.household, memberId, wh.request.input.baseMonth);
  return p !== undefined && rowAt(inputOf(wh), benefitAddress(p.id))?.state === "notApplicable";
}

/** 今の働き方の「該当なし」の印を外す（退職給付を足したとき） */
export function clearRetirementNone(wh: WorkingHousehold, memberId: string): WorkingHousehold {
  if (!retirementNotApplicable(wh, memberId)) return wh;
  const p = currentPeriod(wh.request.input.household, memberId, wh.request.input.baseMonth);
  return p === undefined ? wh : mutate(wh, (_h, req) => void putRow(req.input as unknown as Obj, benefitAddress(p.id), undefined));
}

/**
 * 働き方を入れた・種類を変えたとき（0057）: 目安のまま（自動で足したまま）の退職給付のうち、勤め先の働き方に合わなくなった物
 * （正社員→パートなど）を外し、今の働き方が正社員・公務員になったら目安を最初から入れる（該当なしにしてあれば入れない）。
 * FP が額を入れた退職給付は残す（前の勤め先の退職金として。欄に注意を出す）
 */
export function ensureRetirement(wh: WorkingHousehold, memberId: string): WorkingHousehold {
  const h = wh.request.input.household;
  const stale = (h.retirementBenefits ?? []).filter((b) => {
    if (b.member !== memberId || !isAutoBenefit(b)) return false;
    const p = (h.employmentPeriods ?? []).find((x) => x.id === b.employment);
    return p === undefined || autoKindOf(p.type) !== b.kind;
  });
  const w = stale.length === 0 ? wh : mutate(wh, (hh) => void (hh.retirementBenefits = (hh.retirementBenefits ?? []).filter((b) => !stale.some((x) => x.id === b.id))));
  // 事務所の既定値で退職金を「推定で埋めない」欄にしたときは、目安を自動で入れない（確かめの一覧の「推定で埋める」で入れられる。0111）
  return retirementNotApplicable(w, memberId) || !fillsByEstimate("retirementBenefit.amount") ? w : fillRetirement(w, memberId);
}

/** 確かめの一覧の「確かめの注意」（0057）: 目安で自動で足した退職金（制度の無い勤め先もある）と、公務員・役員の0円の額 */
export interface RetirementNotice {
  id: string;
  label: string;
  detail: string;
  actions: { key: string; label: string; run: (wh: WorkingHousehold) => WorkingHousehold }[];
}

export function retirementNotices(wh: WorkingHousehold): RetirementNotice[] {
  const h = wh.request.input.household;
  const out: RetirementNotice[] = [];
  const drop = (id: string, memberId: string) => (w: WorkingHousehold) => {
    const next = mutate(w, (hh) => void (hh.retirementBenefits = (hh.retirementBenefits ?? []).filter((x) => x.id !== id)));
    return (next.request.input.household.retirementBenefits ?? []).some((x) => x.member === memberId) ? next : retirementNone(next, memberId);
  };
  const edit = (id: string, fn: (b: RetirementBenefit, hh: Household) => void) => (w: WorkingHousehold) =>
    mutate(w, (hh) => {
      const b = (hh.retirementBenefits ?? []).find((x) => x.id === id);
      if (b !== undefined) fn(b, hh);
    });
  for (const b of h.retirementBenefits ?? []) {
    const who = memberLabel(wh, b.member);
    if (isAutoBenefit(b)) {
      out.push({
        id: `retirement/auto/${b.id}`,
        label: `${who}の退職金（推定で足した物）`,
        detail: `勤め先に退職金の制度があるか確かめてください${prevalenceText()}。無ければ外すと「該当なし」になり、もう足しません`,
        actions: [
          {
            key: "keep",
            label: "制度がある（この額で確定）",
            run: edit(b.id, (x) => {
              if (x.kind === "lumpSum" && x.amount !== undefined) x.amount = { value: x.amount.value, state: "confirmed", origin: { kind: "manual" }, estimate: { method: "statistic", basis: basisOfBox(x.amount) } } as Box<number>;
              else {
                for (const a of [finalMonthlyAt(x.id), reasonAt(x.id)]) {
                  const basis = (rowOfBenefit(x, a) ?? rowOfBenefit(x, { target: { object: x.id }, item: "retirementBenefit.estimate", at: [] }))?.estimate?.basis ?? "推定";
                  putRow({ household: { retirementBenefits: [x] } }, a, { state: "confirmed", origin: { kind: "manual" }, estimate: { method: "derived", basis } });
                }
              }
            }),
          },
          { key: "none", label: "制度が無い（外す）", run: drop(b.id, b.member) },
        ],
      });
    }
    if (COMPUTED.has(b.kind) && b.amount !== undefined && b.amount.state === "confirmed" && b.amount.value === 0) {
      out.push({
        id: `retirement/zero/${b.id}`,
        label: `${who}の${KIND_SHORT[b.kind] ?? "退職金"}`,
        detail: "見込み額が0円の確定になっています（前の版の「＋ 退職金を入れる」で入った0円かもしれません）。見込みの計算にするか、無いなら「該当なし」にしてください",
        actions: [
          {
            key: "compute",
            label: "見込みの計算にする",
            run: edit(b.id, (x, hh) => {
              const m = hh.members.find((y) => y.id === x.member);
              if (m === undefined) return;
              const fresh = initialBenefit(hh, m, x.kind as BenefitKind, { id: x.id, ...(x.employment !== undefined ? { employment: x.employment } : {}) });
              delete x.amount;
              if (fresh.amount !== undefined) x.amount = fresh.amount;
              if (fresh.estimate !== undefined) x.estimate = { ...fresh.estimate, ...(x.estimate ?? {}) };
              if (fresh.valueStates !== undefined) x.valueStates = { ...(fresh.valueStates as Obj), ...((x.valueStates as Obj | undefined) ?? {}) };
            }),
          },
          { key: "none", label: "該当なし", run: edit(b.id, (x) => void (x.amount = { state: "notApplicable", origin: { kind: "manual" } } as unknown as Box<number>)) },
        ],
      });
    }
  }
  return out;
}

const basisOfBox = (x: Box<number>): string => (x as { estimate?: { basis?: string } }).estimate?.basis ?? "推定";

// ---- 住まい ----

/** 賃貸の家賃を推定で入れたときの根拠（統計の家賃の目安はまだ無い。目安のボタンと同じ値。値は presets.ts の preset.housing.rent） */
export const rentBasis = (): string =>
  presetText("preset.housing.rent", (v) => `よくある額（家賃 月${(Number(v) / 10000).toLocaleString("ja-JP", { maximumFractionDigits: 4 })}万円。地域・人数の統計はまだありません）`);
export const rentStandard = (): number => presetNum("preset.housing.rent");

function fillHousing(wh: WorkingHousehold): WorkingHousehold {
  const h = wh.request.input.household;
  if ((h.residences ?? []).length > 0) return wh;
  return mutate(wh, (hh, req) => void (hh.residences ??= []).push({ id: newId(), kind: "rent", from: { at: req.input.baseMonth }, to: null, rent: { monthly: { value: rentStandard(), state: "estimated", origin: { kind: "auto" }, estimate: { method: "standard", basis: rentBasis() } } } } as never));
}

// ---- 介護（本人・配偶者は自動で入れない。未入力の警告と「目安で入れる」。介護・親の項目） ----

/** 亡くなる見込みの推定: 今の年齢の平均余命を足した年齢（年齢の時点で持つので、生年月を直すと合わせて動く）。生年月が無ければ null */
export function deathEstimate(m: Member, baseMonth: string): { point: Timepoint; age: number; basis: string } | null {
  if (!hasBirth(m)) return null;
  const age = Math.max(0, ageAt(m, baseMonth));
  const le = lifeExpectancy(age, m.sex);
  if (le === null) return null;
  const years = Math.floor(age + le.value);
  return { point: { memberAge: { member: m.id, years } }, age: years, basis: `推定（${le.basis}から ${String(years)}歳ごろ）` };
}

/** 亡くなる見込みの年月（入っていれば入れた時点、無ければ平均余命の推定） */
function deathMonth(h: Household, m: Member, baseMonth: string): string | null {
  const own = m.leaves !== null && m.leaves !== undefined ? resolveTimepoint(h, m.leaves) : null;
  if (own !== null) return own;
  const est = deathEstimate(m, baseMonth);
  return est === null ? null : resolveTimepoint({ ...h, members: [m] }, est.point);
}

/** その月が、その人の年齢の何か月目か（0〜11） */
function monthsInto(m: Member, ym: string): number {
  const [by, bm] = m.birth.birthYearMonth.split("-").map(Number) as [number, number];
  const [y, mo] = ym.split("-").map(Number) as [number, number];
  const diff = (y - by) * 12 + (mo - bm) + (m.birth.bornOnFirst ? 1 : 0);
  return ((diff % 12) + 12) % 12;
}

/**
 * 介護の目安の物（統計の期間で、亡くなる見込みの前に置く。今より前なら今の翌月から）。期間・額は空欄のまま（統計の平均の推定で計算し、
 * 欄に推定の印と「この値にする」を出す）。前は期間に統計の月数を入れた値として書いていた（推定の印が付かなかった。0041 の追記 2026-11-10）
 */
export function careTemplate(h: Household, m: Member, baseMonth: string, id: string = newId()): CareExpense {
  return { id, member: m.id, from: careTemplateStart(h, m, baseMonth).from, place: "home" };
}

/** 介護の物の始まりの欄の仮の印のキー（欄のキー。ヒアリングシートの取り込みの仮の値の印と同じ） */
export const careStartKey = (careId: string): string => `ev/care/${careId}/from`;

/**
 * 介護の目安の物の始まりと、その推定の根拠（始まりの欄の仮の印にする。0041 の追記 2026-11-11）。根拠は「推定（短い文。詳しい根拠）」の形で、
 * 短い文（careStartShort）は欄の横に出し、全部は「推定」の印を押すと開く。置き方は前のまま（亡くなる見込みから統計の平均の期間だけ前。
 * 今より前なら来月から。亡くなる見込みが出せなければ1年後）
 */
export function careTemplateStart(h: Household, m: Member, baseMonth: string): { from: Timepoint; basis: string } {
  // 置く時期を決める統計の期間（事務所の推定の値があればその値）。統計の写しが読めないとき（無い想定）の予備も同じ値から（直書きしない）
  const stat = careEstimate("home");
  const months = stat?.months ?? masterAmount("care.statistics.months") ?? 0;
  const source = `介護の期間の統計の平均（${String(months)}か月。${stat?.basis ?? "統計の平均"}）`;
  const death = deathMonth(h, m, baseMonth);
  const start = death === null ? addMonths(baseMonth, 12) : addMonths(death, -months);
  const soon = start <= baseMonth;
  const from: Timepoint = soon ? { at: addMonths(baseMonth, 1) } : hasBirth(m) ? { memberAge: { member: m.id, years: Math.max(0, ageAt(m, start)), months: monthsInto(m, start) } } : { at: start };
  const basis =
    death === null
      ? "推定（亡くなる見込みが無いため1年後。介護を受ける人の亡くなる見込みが出せないため、1年後に置いています）"
      : soon
        ? `推定（亡くなる見込みまでが統計の平均より短く、来月から。亡くなる見込みまでが${source}より短いため、来月に置いています）`
        : `推定（亡くなる見込みから統計の平均の期間を逆算。${source}を、介護を受ける人の亡くなる見込みの前に置いています）`;
  return { from, basis };
}

/** 介護の始まりの推定の根拠から、欄の横に出す短い文（「推定（短い文。…）」の短い文。その形でない根拠〔ヒアリングシートの仮の値など〕は null） */
export const careStartShort = (basis: string | undefined): string | null => /^推定（([^。）]+)。/.exec(basis ?? "")?.[1] ?? null;

/** 介護の目安の物を1件足す（始まりに推定の印を付ける。期間・額は空欄＝統計の平均の推定） */
export function addCareTemplate(wh: WorkingHousehold, memberId: string, id: string = newId()): WorkingHousehold {
  const m = wh.request.input.household.members.find((x) => x.id === memberId);
  if (m === undefined) return wh;
  const { from, basis } = careTemplateStart(wh.request.input.household, m, wh.request.input.baseMonth);
  const next = mutate(wh, (hh) => void (hh.careExpenses ??= []).push({ id, member: m.id, from, place: "home" }));
  return { ...next, assumed: { ...next.assumed, [careStartKey(id)]: basis } };
}

/** この人の介護の目安を入れる（この人の介護がもう有れば同じ世帯） */
export function fillCareFor(wh: WorkingHousehold, memberId: string): WorkingHousehold {
  const h = wh.request.input.household;
  if (!h.members.some((x) => x.id === memberId) || (h.careExpenses ?? []).some((c) => c.member === memberId)) return wh;
  return addCareTemplate(wh, memberId);
}

/** 本人・配偶者のうち、介護の費用がまだ無い人 */
export function adultsWithoutCare(h: Household): Member[] {
  return h.members.filter((m) => (m.kind === "self" || m.kind === "spouse") && m.expected !== true && !(h.careExpenses ?? []).some((c) => c.member === m.id));
}

/**
 * ご本人・配偶者の介護の費用を「入れない」と決めた印（保存した項目の印 confirmed に置く。入力項目の ID ではない）。
 * 介護・親の項目を保存しただけでは付けない（確定は明示の操作だけ）。帯の「該当なし（介護の費用を入れない）」・区画の「…の介護は入れない」・
 * 入力項目の「当てはまらない」の1押しで付ける。前の版で項目を保存しただけの世帯（印 "care" だけ）は、未入力に戻る
 */
export const ADULT_CARE_NONE = "care/adultsNone";

export const adultsCareDeclined = (wh: WorkingHousehold): boolean => wh.confirmed.includes(ADULT_CARE_NONE);

/** ご本人・配偶者の介護の費用を入れないと決める（介護・親の項目も保存した扱いにする） */
export function declineAdultsCare(wh: WorkingHousehold): WorkingHousehold {
  return markCard(markCard(wh, "care"), ADULT_CARE_NONE);
}

/** 本人・配偶者の介護の目安を入れる（まだ無い人だけ） */
export function fillAdultsCare(wh: WorkingHousehold): WorkingHousehold {
  return adultsWithoutCare(wh.request.input.household).reduce((w, m) => fillCareFor(w, m.id), wh);
}

/**
 * 本人・配偶者の介護の費用の入れ方の既定（事務所の設定で変えられる形。保存の場所は事務所の設定を作る回に決める。items.ts の CardLayout と同じ）。
 * warn: 自動で入れない（未入力の警告と「目安で入れる」の1押し）、fill: 新しい世帯では最初から目安で入れる
 */
export interface CareDefaults {
  selfAndSpouse: "warn" | "fill";
}
export const DEFAULT_CARE_DEFAULTS: CareDefaults = { selfAndSpouse: "warn" };

/** 新しい世帯に、事務所の設定の既定を当てる（warn なら何もしない。古い世帯には当てない） */
export function applyCareDefaults(wh: WorkingHousehold, d: CareDefaults = DEFAULT_CARE_DEFAULTS): WorkingHousehold {
  return d.selfAndSpouse === "fill" ? fillAdultsCare(wh) : wh;
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
      what: "幼稚園〜高校は公立、大学は私立・文系・自宅（既定の進路の型）",
      none: (w) => educationNone(w, c.id),
      noneLabel: "教育費なし",
    });
  }
  for (const m of h.members.filter((x) => x.kind === "self" || x.kind === "spouse")) {
    const p = currentPeriod(h, m.id, base);
    if (p === undefined || !AUTO_TYPES.has(p.type) || (h.retirementBenefits ?? []).some((b) => b.member === m.id) || retirementNotApplicable(wh, m.id)) continue;
    // もう辞めた勤め先（受け取りが計算の基準の月より前）の退職金は、入っていなくても知らせない（推定で足さない。retirementEstimate）
    const ended = p.to === null ? null : resolveTimepoint(h, p.to);
    if (ended !== null && addMonths(ended, 1) < base) continue;
    const est = retirementEstimate(h, m, p, base);
    out.push({
      id: `work/retirement/${m.id}`,
      card: "retirement",
      label: `${memberLabel(wh, m.id)}の退職金`,
      note: "退職金が入っていないので、0円で計算しています",
      ...(est !== null ? { fill: (w: WorkingHousehold) => fillRetirement(w, m.id), basis: est.basis, what: retirementWhat(est.benefit) } : {}),
      none: (w) => retirementNone(w, m.id),
      noneLabel: "勤め先に制度が無い",
    });
  }
  // 年金（0066）: 書類から入れる形で額が2つとも入っていない人は、推計に戻す（書類の記録は消さずに残す）。定期便の加入月数が0か月のままの人は、
  // 代わりの値（20歳の月から作成年月まで・働き方の期間の厚生年金の月）を推定で入れる
  for (const m of pensionMembers(h)) {
    const rec = (h.pensionRecords ?? []).find((r) => r.member === m.id);
    if (rec === undefined) continue;
    if (amountsUnentered(rec))
      out.push({
        id: `pension/amounts/${m.id}`,
        card: "pension",
        label: `${memberLabel(wh, m.id)}の年金の額`,
        note: "書類から入れる形で、老齢基礎年金・老齢厚生年金の額がまだ入っていないので、年金を0円で計算しています",
        fill: (w) => switchPension(w, m.id, ""),
        basis: "働き方の期間から推計（書類の記録は残し、「書類から」に戻すと戻ります）",
        what: "働き方の期間から推計した額",
      });
    else if (statementMonthsMissing(rec))
      out.push({
        id: `pension/months/${m.id}`,
        card: "pension",
        label: `${memberLabel(wh, m.id)}のねんきん定期便の加入月数`,
        note: rec.kind === "statementOver50" ? "加入月数が0か月のままなので、年金を0円で計算しています" : "加入月数が0か月のままなので、年金を少なく計算しています",
        fill: (w) => fillMonths(w, m.id, "estimated"),
        basis: substituteMonths(h, m, rec.asOf, base).basis,
        what: "20歳の月から書類の作成年月までの月と、働き方の期間の厚生年金の月",
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
      what: "受け取る（受け取る期間はおまかせ）",
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
      what: `基本生活費 月${manOf(est.value)}（世帯の人数の統計の平均）`,
    });
  }
  if ((h.residences ?? []).length === 0 && !(h.debts ?? []).some((d) => d.kind === "mortgage") && !confirmed.has("housing"))
    out.push({
      id: "housing",
      card: "housing",
      label: "住居費",
      note: "住まいが入っていないので、住居費を0円で計算しています",
      fill: fillHousing,
      basis: rentBasis(),
      what: `賃貸・家賃 月${manOf(rentStandard())}（よくある額）`,
      alt: "持ち家なら、住まい・ローンを開いて持ち家を入れてください",
      none: (w) => markCard(w, "housing"),
      noneLabel: "住居費なし",
    });
  // 本人・配偶者の介護の費用（自動で入れない。外れると大きく誤るので、未入力の警告と「推定で入れる」。入れないと決めるのは「該当なし」を押したときだけで、
  // 介護・親の項目を保存しただけでは決めない〔母の介護を足して保存しても、ご本人・配偶者の未入力は残る〕）
  if (!confirmed.has(ADULT_CARE_NONE)) {
    const est = careEstimate("home");
    for (const m of adultsWithoutCare(h))
      out.push({
        id: `care/${m.id}`,
        card: "care",
        label: `${memberLabel(wh, m.id)}の介護の費用`,
        note: "介護の費用が入っていないので、0円で計算しています（自動では入れません）",
        fill: (w) => fillCareFor(w, m.id),
        ...(est !== null ? { basis: `${est.basis}・亡くなる見込み（簡易生命表の平均余命）の前の期間`, what: `在宅の介護 月${manOf(est.monthly)}・はじめの費用 ${manOf(est.initial)}（亡くなる見込みの前の期間。統計の平均）` } : {}),
        none: declineAdultsCare,
        noneLabel: "介護の費用を入れない",
      });
  }
  if ((h.insuranceContracts ?? []).length === 0 && !confirmed.has("insurance"))
    out.push({ id: "insurance", card: "insurance", label: "保険", note: "保険が入っていません（保険料・保障を0円で計算しています。保障の額は推定で入れません）", none: (w) => markCard(w, "insurance"), noneLabel: "保険に入っていない" });
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
