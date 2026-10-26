// 入っていない物（未入力（0円で計算中）の物）と「推定で埋める」（0035 の11・0041）。
// - 古い世帯を開いても、ここの推定は自動で入れない（黙って書き換えない）。確かめの一覧とカードのパネルに「未入力」として出し、
//   FP が「推定で埋める」（1件ごと・カードごと・まとめて）を押したときだけ入れる。無いと決めたら「該当なし」
// - 新しく入れるとき（子を足す・会社員として入れる・働き方を正社員や公務員にする）は、最初から推定で入れる（ensure*）
// - 推定の目安は今ある関数（hearing/src/estimates.ts・教育の標準の進路の型）で作れる範囲だけ。作れない物は「推定で埋める」を出さない
import type { Box, EducationStage, EmploymentPeriod, Household, Member, RetirementBenefit } from "../../engine/types.ts";
import { resolveTimepoint, type StageId } from "./form.ts";
import { mutate, newId, type WorkingHousehold } from "./household.ts";
import { livingEstimate } from "./estimates.ts";
import { startLiving } from "./livingStages.ts";
import { memberLabel } from "./labels.ts";
import { putRow, rowAt, type StateRow } from "./rows.ts";
import { defaultStages } from "./stages/education.ts";
import { currentPeriodId } from "../store/readings.ts";
import { missingUnemployment, putEstimate, UNEMPLOYMENT_BASIS, UNEMPLOYMENT_ITEM, unemploymentEstimate } from "./claims.ts";
import { AUTO_TYPES, autoKindOf, civilEstimate, COMPUTED, finalMonthlyAt, initialBenefit, isAutoBenefit, isUnenteredBox, KIND_SHORT, prevalenceText, reasonAt, rowOfBenefit, type BenefitKind } from "./retirementBenefits.ts";

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

// ---- 退職金（0057。種類ごとの形と目安は retirementBenefits.ts）----

/** 働き方の期間の「退職給付」の当て先（該当なしの行を置く所） */
const benefitAddress = (periodId: string) => ({ target: { object: periodId }, item: "employment.retirementBenefit", at: [] as string[] });

/** 今の働き方で自動で足す退職給付の目安（正社員は退職一時金、公務員は退職手当の見込みの計算）。作れなければ null */
function retirementEstimate(h: Household, m: Member, p: EmploymentPeriod): { benefit: RetirementBenefit; basis: string } | null {
  const kind = autoKindOf(p.type);
  if (kind === null) return null;
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
  const est = retirementEstimate(h, m, p);
  if (est === null) return wh;
  return mutate(wh, (hh, req) => {
    // 初めの形は仮の ID で作った（値の状態の行の鍵は物の ID を含まないので、ID を付け直すだけでよい）
    (hh.retirementBenefits ??= []).push(structuredClone({ ...est.benefit, id: newId() }));
    putRow(req.input as unknown as Obj, benefitAddress(p.id), undefined);
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
  return retirementNotApplicable(w, memberId) ? w : fillRetirement(w, memberId);
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
        label: `${who}の退職金（目安で足した物）`,
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
    if (p === undefined || !AUTO_TYPES.has(p.type) || (h.retirementBenefits ?? []).some((b) => b.member === m.id) || retirementNotApplicable(wh, m.id)) continue;
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
