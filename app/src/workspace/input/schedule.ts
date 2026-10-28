// この世帯の予定（ライフイベントのカードの読むだけの区画。0068）: ほかのカードに置いた予定も含めて、世帯の予定を年の順に1行ずつ読む。
// 載せる物: 全部のカードのお金の行（最初の年。くり返しは「毎年」「n年ごと」）、車の購入・買い替え・手放す、住まいの購入・売却、
// 教育の入学（高校・大学）、退職給付の受け取り（時期が入っている物）、年金の受け取り開始、介護の始まり、名前つきの出来事（家族のカード）。
// 同じ年に1回の出るお金が2つ以上重なる年を拾う。額は今の値段（物価の伸びの前）。計算の結果ではなく入力から読む
import type { Household, PeriodicExpense } from "../../engine/types.ts";
import { addMonths, ageReachedMonth, parseYm } from "../levers.ts";
import { schoolEntryYear } from "../present.ts";
import { ageInYear, roles } from "../roles.ts";
import { resolveTimepoint } from "../timepoint.ts";
import type { WorkingHousehold } from "./household.ts";
import { memberLabel } from "./labels.ts";
import { cadenceOf, expenseCard, INCOME_KINDS, incomeCard, OUT_KINDS, type MoneyCard } from "./moneyRows.ts";
import { eventName, FP_EVENT_KINDS } from "./namedEvents.ts";
import { manYen } from "./readLines.ts";
import { childOfPeriodic } from "./stages/events.ts";

export interface ScheduleItem {
  year: number;
  /** 入るお金・出るお金・お金の無い予定 */
  dir: "入" | "出" | "—";
  name: string;
  /** 額と時期の文（「30万円・毎年」） */
  amount: string;
  /** 1回の出るお金（重なる年を拾うのに使う） */
  lump: boolean;
  /** 属するカードの名前 */
  card: string;
}

const CARD_LABEL: Record<MoneyCard, string> = {
  family: "家族",
  work: "働き方と収入",
  pension: "年金",
  living: "基本生活費",
  education: "子ども・教育",
  housing: "住まい・ローン",
  insurance: "保険",
  rental: "収益不動産",
  events: "ライフイベント",
  car: "車",
  care: "介護・親",
  inherit: "相続・贈与",
};

const yearOf = (ym: string | null): number | null => (ym === null ? null : parseYm(ym).y);

function cadenceText(h: Household, r: { from: PeriodicExpense["from"]; to?: PeriodicExpense["to"]; monthly?: boolean; everyYears: number }): string {
  const c = cadenceOf(h, r);
  if (c === "once") return "1回";
  if (c === "monthly") return "毎月";
  return r.everyYears === 1 ? "毎年" : `${r.everyYears}年ごと`;
}

/** 世帯の予定（年の順。同じ年は入る → 出る → お金の無い予定の順） */
export function scheduleItems(wh: WorkingHousehold): ScheduleItem[] {
  const h = wh.request.input.household;
  const base = wh.request.input.baseMonth;
  const first = parseYm(base).y;
  const last = wh.request.input.endYear;
  const out: ScheduleItem[] = [];
  const add = (year: number | null, item: Omit<ScheduleItem, "year">) => {
    if (year !== null && year >= first && year <= last) out.push({ year, ...item });
  };
  // お金の行（全部のカード）
  for (const p of h.periodicExpenses ?? []) {
    const card = childOfPeriodic(h, p) !== null ? "education" : expenseCard(h, p);
    const c = cadenceText(h, p);
    const name = p.label !== undefined && p.label !== "" ? p.label : (OUT_KINDS.find((k) => k.kind === (p.kind ?? "general"))?.label ?? "出るお金");
    const v = p.amount.value;
    add(yearOf(resolveTimepoint(h, p.from)), { dir: "出", name, amount: `${v === null || v === undefined ? "額は未入力" : manYen(v)}・${c === "毎月" ? "月額・毎月" : c}`, lump: c === "1回", card: CARD_LABEL[card] });
  }
  for (const f of h.incomeFlows ?? []) {
    const c = cadenceText(h, f);
    const name = f.label !== undefined && f.label !== "" ? f.label : (INCOME_KINDS.find((k) => k.kind === f.kind)?.label ?? "入るお金");
    const v = f.amount.value;
    add(yearOf(resolveTimepoint(h, f.from)), { dir: "入", name, amount: `${v === null || v === undefined || v === 0 ? "額は未入力" : manYen(v)}・${c === "毎月" ? "月額・毎月" : c}`, lump: false, card: CARD_LABEL[incomeCard(f)] });
  }
  // 車の購入・買い替え・手放す
  for (const c of h.cars ?? []) {
    const who = memberLabel(wh, c.owner);
    const firstYm = resolveTimepoint(h, c.purchase.first);
    const untilYm = c.until == null ? null : resolveTimepoint(h, c.until);
    if (firstYm !== null) {
      for (let m = firstYm, k = 0; parseYm(m).y <= last && (untilYm === null || m <= untilYm); m = addMonths(m, 12 * c.purchase.everyYears), k++) {
        const net = Math.max(0, c.purchase.price - (k > 0 || c.purchase.owned === true ? (c.purchase.tradeIn ?? 0) : 0));
        add(parseYm(m).y, { dir: "出", name: `${c.purchase.owned === true || k > 0 ? "車の買い替え" : "車の購入"}（${who}）`, amount: `${manYen(net)}・下取りを引いた額`, lump: true, card: "車" });
      }
    }
    if (untilYm !== null) add(yearOf(untilYm), { dir: "—", name: `車を手放す（${who}）`, amount: "", lump: false, card: "車" });
  }
  // 住まいの購入・売却
  for (const r of h.residences ?? []) {
    if (r.purchase !== undefined) add(yearOf(resolveTimepoint(h, r.purchase.at)), { dir: "出", name: "住宅の購入", amount: `${manYen(r.purchase.price)}（物件の価格）`, lump: true, card: "住まい・ローン" });
    if (r.sale !== undefined && r.to != null) add(yearOf(resolveTimepoint(h, r.to)), { dir: "入", name: "住まいの売却", amount: r.sale.price !== undefined ? manYen(r.sale.price) : "", lump: false, card: "住まい・ローン" });
  }
  // 教育の入学（高校・大学）
  const rs = roles(wh.request);
  for (const g of h.goals ?? []) {
    if (g.kind !== "education") continue;
    const role = rs.find((r) => r.member.id === g.owner);
    if (role === undefined) continue;
    for (const s of g.education?.stages ?? []) {
      if (s.stage !== "highSchool" && s.stage !== "university") continue;
      add(schoolEntryYear(role.member.birth.birthYearMonth, role.member.birth.bornOnFirst, s.stage), { dir: "—", name: `${role.label} ${s.stage === "university" ? "大学" : "高校"}の入学`, amount: "", lump: false, card: "子ども・教育" });
    }
  }
  // 退職給付の受け取り（時期が入っている物）
  for (const b of h.retirementBenefits ?? []) {
    const at = b.paidAt ?? b.receipt?.start;
    if (at === undefined) continue;
    const v = b.amount?.value;
    add(yearOf(resolveTimepoint(h, at)), { dir: "入", name: `${b.label !== undefined && b.label !== "" ? b.label : "退職給付"}の受け取り（${memberLabel(wh, b.member)}）`, amount: typeof v === "number" ? manYen(v) : "", lump: false, card: "退職金・企業年金" });
  }
  // 年金の受け取り開始（本人・配偶者。記録の無い人は65歳になった翌月）
  for (const r of rs.filter((x) => x.member.kind === "self" || x.member.kind === "spouse")) {
    const rec = (h.pensionRecords ?? []).find((x) => x.member === r.member.id);
    const claim = rec?.claim?.basic;
    const ym = claim !== undefined ? resolveTimepoint(h, claim) : addMonths(ageReachedMonth(r.member, 65), 1);
    add(yearOf(ym), { dir: "—", name: `${r.label} 年金の受け取り開始`, amount: "", lump: false, card: "年金" });
  }
  // 介護の始まり
  for (const c of h.careExpenses ?? []) add(yearOf(resolveTimepoint(h, c.from)), { dir: "—", name: `介護の始まり（${memberLabel(wh, c.member)}）`, amount: "", lump: false, card: "介護・親" });
  // 名前つきの出来事（家族のカードで足した物）
  for (const e of h.events ?? []) if (FP_EVENT_KINDS.includes(e.kind)) add(yearOf(resolveTimepoint(h, e.at)), { dir: "—", name: eventName(wh, e), amount: "", lump: false, card: "家族" });
  const order = { 入: 0, 出: 1, "—": 2 } as const;
  return out.sort((a, b) => a.year - b.year || order[a.dir] - order[b.dir]);
}

/** 同じ年に1回の出るお金が2つ以上重なる年（「2034年: 車の買い替え・大学の入学・家電」の形の文。入学は同じ年の印に足す） */
export function overlapYears(items: readonly ScheduleItem[]): { year: number; names: string[] }[] {
  const years = new Map<number, string[]>();
  for (const x of items) if (x.lump) years.set(x.year, [...(years.get(x.year) ?? []), x.name]);
  return [...years]
    .filter(([, names]) => names.length >= 2)
    .map(([year, names]) => ({ year, names: [...names, ...items.filter((x) => x.year === year && x.dir === "—" && x.name.includes("入学")).map((x) => x.name)] }));
}

/** 予定の行の見出し（「2034年（本人52歳・配偶者50歳）」） */
export function yearLabel(wh: WorkingHousehold, year: number): string {
  const rs = roles(wh.request).filter((r) => r.member.kind === "self" || r.member.kind === "spouse");
  const ages = rs.map((r) => `${r.label}${ageInYear(r.member, year)}歳`);
  return ages.length === 0 ? `${year}年` : `${year}年（${ages.join("・")}）`;
}
