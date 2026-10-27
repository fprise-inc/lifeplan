// FP の道具（0074）の中身: 世帯の中身の一覧・次の1年に起きること・過ぎた予定・前回（控え）との入力の違い・気づきの知らせ。
// どれも世帯の物と計算の結果から読むだけで、世帯も計算も変えない（入力は増えない）
import type { EngineRequest, Member, PreviewResult, TableCell, Timepoint } from "../../engine/types.ts";
import { addMonths, ageReachedMonth, parseYm } from "../levers.ts";
import { resolveTimepoint } from "../timepoint.ts";
import { displayYears, financialOf } from "../present.ts";
import { fromRequest, type WorkingHousehold } from "../input/household.ts";
import { inputItems } from "../input/items.ts";
import { memberLabel } from "../input/labels.ts";
import { INCOME_KINDS } from "../input/moneyRows.ts";
import { formatYearMonth } from "../input/units.ts";
import { fieldValueText, objectCards, planIndex } from "../plans/planEdit.ts";
import { man } from "../../presentation/format.ts";

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
/** 入るお金の行が相続・贈与のカードの行か */
const inheritKind = (k: string | undefined) => INCOME_KINDS.find((x) => x.kind === k)?.card === "inherit";
const boxValue = (v: unknown): number | null => (typeof v === "number" ? v : isObj(v) && typeof v.value === "number" ? v.value : null);

// ---- 世帯の中身の一覧 ----

export interface ContentsRow {
  id: string;
  label: string;
  /** 額などの短い文（無ければ null） */
  text: string | null;
}

export interface ContentsSection {
  card: string;
  cardLabel: string;
  rows: ContentsRow[];
}

/** 物の額の短い文（口座の時価・行の額・ローンの残高か借入額・保険料など。無ければ null） */
function amountText(collection: string, o: Obj): string | null {
  if (collection === "insurance" && isObj(o.premium) && typeof o.premium.amount === "number") return `保険料 ${o.premium.amount.toLocaleString("ja-JP")}円（${o.premium.frequency === "monthly" ? "月" : o.premium.frequency === "annual" ? "年" : "1回"}）`;
  if (collection === "debt") {
    const b = boxValue(o.balance) ?? boxValue(o.principal);
    return b === null ? null : `${boxValue(o.balance) !== null ? "残高" : "借入額"} ${man(b)}万円`;
  }
  for (const k of ["marketValue", "amount", "monthly", "price"]) {
    const v = boxValue(o[k]);
    if (v !== null && v > 0) return `${k === "monthly" ? "月 " : ""}${v >= 10000 ? `${man(v)}万円` : `${v.toLocaleString("ja-JP")}円`}`;
  }
  return null;
}

/** 世帯の中身（人・収入・退職給付・口座と不動産・保険・ローン・出るお金・介護・相続と贈与…）をカードの順に。読むだけ */
export function householdContents(wh: WorkingHousehold): ContentsSection[] {
  const items = inputItems(wh);
  const base = wh.request.input.baseMonth;
  const sections = new Map<string, ContentsSection>(items.map((i) => [i.id, { card: i.id, cardLabel: i.label, rows: [] }]));
  for (const o of objectCards(wh)) {
    if (o.collection === "relation" || o.collection === "event" || o.collection === "savingsCheck" || o.collection === "premiumRate") continue;
    const card = o.card === "fee" ? "assumptions" : o.card;
    const sec = card === null ? undefined : sections.get(card);
    if (sec === undefined) continue;
    let text = amountText(o.collection, o.obj);
    if (o.collection === "member") {
      const m = o.obj as unknown as Member;
      const { y, m: mo } = parseYm(m.birth.birthYearMonth);
      const b = parseYm(base);
      const age = b.y - y - (b.m < mo ? 1 : 0);
      text = m.expected === true ? "これから生まれる予定" : `${age}歳${isObj(m.outside) ? "・世帯の外" : ""}`;
    }
    sec.rows.push({ id: o.id, label: o.label, text });
  }
  return [...sections.values()].filter((s) => s.rows.length > 0);
}

// ---- 次の1年に起きること ----

export interface YearEvent {
  /** 年月（YYYY-MM）か、年だけのとき null */
  ym: string | null;
  year: number;
  label: string;
  card: string | null;
}

const inWindow = (ym: string | null, from: string, to: string): ym is string => ym !== null && ym >= from && ym <= to;

/** 表の行が、ある年にはじめて正の値になった（その前の年は0）か */
function startsIn(table: readonly TableCell[], pred: (c: TableCell) => boolean, member: string | undefined, year: number): boolean {
  const sum = (y: number) => table.filter((c) => c.year === y && pred(c) && (member === undefined || c.member === member)).reduce((s, c) => s + c.amount, 0);
  return sum(year) > 0 && sum(year - 1) <= 0;
}

/**
 * 次の1年（計算の基準の月から12か月）に起きること: 年齢の節目（60・65・70・75歳）・保険の払込の終わり・更新・解約、ローンの金利が変わる時期・
 * 完済、子の入学（入学金の年）、年金の受け取りの始まり、介護の始まり、受け取る予定の相続・贈与、一時的な支出・収入。
 * 年月が決まる物は年月で、計算の結果から読む物（入学・年金・完済）は年で出す
 */
export function nextYearEvents(wh: WorkingHousehold, result: PreviewResult | null): YearEvent[] {
  const h = wh.request.input.household;
  const base = wh.request.input.baseMonth;
  const end = addMonths(base, 11);
  const out: YearEvent[] = [];
  const at = (t: Timepoint | null | undefined) => resolveTimepoint(h, t);
  const push = (ym: string, label: string, card: string | null) => out.push({ ym, year: parseYm(ym).y, label, card });
  for (const m of h.members) {
    if (m.kind !== "self" && m.kind !== "spouse") continue;
    for (const age of [60, 65, 70, 75]) {
      const ym = ageReachedMonth(m, age);
      if (inWindow(ym, base, end)) push(ym, `${memberLabel(wh, m.id)}が${age}歳`, "family");
    }
  }
  for (const c of h.insuranceContracts ?? []) {
    const name = typeof c.label === "string" && c.label !== "" ? `保険「${c.label}」` : "保険";
    const pay = at(c.premium.payUntil);
    if (inWindow(pay, base, end)) push(pay, `${name}の保険料の払込が終わる`, "insurance");
    for (const r of c.renewals ?? []) {
      const ym = at(r.at);
      if (inWindow(ym, base, end)) push(ym, `${name}の更新（保険料が変わる）`, "insurance");
    }
    const sur = at(c.surrender);
    if (inWindow(sur, base, end)) push(sur, `${name}を解約する予定`, "insurance");
  }
  for (const d of h.debts ?? []) {
    const name = typeof d.label === "string" && d.label !== "" ? `ローン「${d.label}」` : d.kind === "mortgage" ? "住宅ローン" : "ローン";
    (d.rateSchedule ?? []).slice(1).forEach((r) => {
      const ym = at(r.from);
      if (inWindow(ym, base, end)) push(ym, `${name}の金利が変わる（${r.type === "fixed" ? "固定" : "変動"}へ）`, "housing");
    });
  }
  for (const c of h.careExpenses ?? []) {
    const ym = at(c.from);
    if (inWindow(ym, base, end)) push(ym, `${memberLabel(wh, c.member)}の介護が始まる見込み`, "care");
  }
  for (const f of h.incomeFlows ?? []) {
    const ym = at(f.from);
    if (!inWindow(ym, base, end)) continue;
    const once = f.to !== null && at(f.to) === ym;
    const inherit = inheritKind(f.kind);
    if (inherit || once) push(ym, `${inherit ? "受け取る予定" : "入るお金"}「${f.label ?? ""}」${boxValue(f.amount) !== null && (boxValue(f.amount) as number) > 0 ? ` ${man(boxValue(f.amount) as number)}万円` : ""}`, null);
  }
  for (const p of h.periodicExpenses ?? []) {
    const ym = at(p.from as Timepoint | undefined);
    const once = p.to !== null && p.to !== undefined && at(p.to as Timepoint) === ym;
    if (inWindow(ym, base, end) && once) push(ym, `出るお金「${String(p.label ?? "")}」${(boxValue(p.amount) ?? 0) > 0 ? ` ${man(boxValue(p.amount) as number)}万円` : ""}`, "events");
  }
  if (result !== null) {
    const years = [...new Set([parseYm(base).y, parseYm(end).y])];
    const t = result.table;
    for (const y of years) {
      for (const m of h.members) {
        if (m.kind === "child" && startsIn(t, (c) => c.row === "cf.expense.education.entrance", m.id, y)) out.push({ ym: null, year: y, label: `${memberLabel(wh, m.id)}の入学（入学金の年）`, card: "education" });
        if ((m.kind === "self" || m.kind === "spouse") && startsIn(t, (c) => c.row === "cf.income.pension" || c.row.startsWith("cf.income.pension."), m.id, y)) out.push({ ym: null, year: y, label: `${memberLabel(wh, m.id)}の年金の受け取りが始まる`, card: "pension" });
      }
      for (const d of h.debts ?? []) {
        const bal = (yy: number) => t.filter((c) => c.year === yy && c.object === d.id && c.row.startsWith("cf.balance.debt")).reduce((s, c) => s + c.amount, 0);
        if (bal(y - 1) > 0 && bal(y) <= 0 && t.some((c) => c.year === y && c.row.startsWith("cf.balance.debt"))) out.push({ ym: null, year: y, label: `${d.kind === "mortgage" ? "住宅ローン" : "ローン"}${typeof d.label === "string" && d.label !== "" ? `「${d.label}」` : ""}の返済が終わる`, card: "housing" });
      }
    }
  }
  return out.sort((a, b) => (a.ym ?? `${a.year}-13`).localeCompare(b.ym ?? `${b.year}-13`));
}

// ---- 過ぎた予定（見直しの流れの確かめ） ----

export interface PastItem {
  id: string;
  label: string;
  when: string;
  card: string | null;
}

/** 計算の基準の月より前に過ぎた、1回きりの予定（受け取る予定の相続・贈与・一時的な支出と収入）。済んだか・まだか・やめたかを確かめる */
export function pastPlans(wh: WorkingHousehold): PastItem[] {
  const h = wh.request.input.household;
  const base = wh.request.input.baseMonth;
  const at = (t: Timepoint | null | undefined) => resolveTimepoint(h, t);
  const out: PastItem[] = [];
  for (const f of h.incomeFlows ?? []) {
    const from = at(f.from);
    const to = f.to === null ? null : at(f.to);
    if (from !== null && to !== null && to < base) out.push({ id: f.id, label: `入るお金「${f.label ?? ""}」`, when: formatYearMonth(to), card: inheritKind(f.kind) ? "inheritance" : null });
  }
  for (const p of h.periodicExpenses ?? []) {
    const to = p.to === null || p.to === undefined ? null : at(p.to as Timepoint);
    if (to !== null && to < base) out.push({ id: p.id, label: `出るお金「${String(p.label ?? "")}」`, when: formatYearMonth(to), card: "events" });
  }
  return out;
}

// ---- 前回（控え）との入力の違い ----

export interface InputChange {
  key: string;
  card: string | null;
  cardLabel: string;
  label: string;
  before: string;
  after: string;
}

/**
 * 控えの現状の入力と、今の入力の違い（欄ごと。足した物・外した物は物ごとに1行）。向き先と入力項目ID（当て先）で比べるので、
 * 欄の並びや見せ方が変わっても同じ値は同じと読む
 */
export function inputChanges(prevReq: EngineRequest, wh: WorkingHousehold): InputChange[] {
  const prev = fromRequest(prevReq);
  const ip = planIndex([prev]);
  const inow = planIndex([wh]);
  const cards = new Map([...ip.cards, ...inow.cards]);
  const pObjs = new Map(objectCards(prev).map((o) => [o.id, o]));
  const nObjs = new Map(objectCards(wh).map((o) => [o.id, o]));
  const out: InputChange[] = [];
  for (const [id, o] of nObjs) if (!pObjs.has(id) && o.collection !== "relation") out.push({ key: `add:${id}`, card: o.card, cardLabel: cards.get(o.card ?? "") ?? "", label: o.label, before: "なし", after: "足した" });
  for (const [id, o] of pObjs) if (!nObjs.has(id) && o.collection !== "relation") out.push({ key: `remove:${id}`, card: o.card, cardLabel: cards.get(o.card ?? "") ?? "", label: o.label, before: "あった", after: "外した" });
  const onlyOne = (k: string) => {
    const t = JSON.parse(k.slice(0, k.indexOf("|"))) as Obj;
    const id = typeof t.object === "string" ? t.object : typeof t.member === "string" ? t.member : null;
    return id !== null && pObjs.has(id) !== nObjs.has(id);
  };
  for (const k of new Set([...ip.fields.keys(), ...inow.fields.keys()])) {
    if (onlyOne(k)) continue;
    const a = ip.fields.get(k);
    const b = inow.fields.get(k);
    const f = b?.field ?? a?.field;
    if (f === undefined || f.readOnly !== undefined) continue;
    const va = a === undefined ? null : a.field.get(prev).value;
    const vb = b === undefined ? null : b.field.get(wh).value;
    if (JSON.stringify(va ?? null) === JSON.stringify(vb ?? null)) continue;
    const card = b?.card ?? a?.card ?? null;
    const where = b?.where ?? a?.where;
    out.push({ key: k, card, cardLabel: cards.get(card ?? "") ?? "", label: where !== undefined && where !== f.label ? `${where}: ${f.label}` : f.label, before: fieldValueText(a?.field, va, prev), after: fieldValueText(b?.field, vb, wh) });
  }
  const order = new Map(inputItems(wh).map((i, n) => [i.id, n]));
  return out.sort((x, y) => (order.get(x.card ?? "") ?? 99) - (order.get(y.card ?? "") ?? 99));
}

/** 結果の違いの主な数（資産が尽きる年・ある年齢の金融資産） */
export interface ResultFigures {
  depletion: number | null;
  atAge: { age: number; year: number; amount: number } | null;
}

export function resultFigures(req: EngineRequest, r: PreviewResult, age: number): ResultFigures {
  const years = displayYears(req);
  const fin = financialOf(r.table);
  const self = req.input.household.members.find((m) => m.kind === "self");
  const depletion = years.find((y) => (fin.get(y) ?? 0) < 0) ?? null;
  if (self === undefined) return { depletion, atAge: null };
  const year = parseYm(ageReachedMonth(self, age)).y;
  return { depletion, atAge: years.includes(year) ? { age, year, amount: fin.get(year) ?? 0 } : null };
}

// ---- 気づきの知らせ（結果のタブ） ----

export interface Insight {
  key: string;
  title: string;
  text: string;
  year: number | null;
}

const sumBy = (t: readonly TableCell[], pred: (c: TableCell) => boolean): Map<number, number> => {
  const m = new Map<number, number>();
  for (const c of t) if (pred(c)) m.set(c.year, (m.get(c.year) ?? 0) + c.amount);
  return m;
};

/**
 * 気づき（決まりで数件。入力は増えない）: 預金が少なくなる年・赤字が続く・教育と介護が重なる・NISA の枠を使い切る年・相続税がかかる見込み。
 * months は「生活費の何か月分」（お金の3つの分け方の設定。既定は6か月）
 */
export function insights(req: EngineRequest, r: PreviewResult, opts: { months?: number; inheritanceTax?: number | null } = {}): Insight[] {
  const years = displayYears(req);
  const t = r.table;
  const out: Insight[] = [];
  const months = opts.months ?? 6;
  const deposit = sumBy(t, (c) => c.row === "cf.balance.account.deposit");
  const living = sumBy(t, (c) => c.row.startsWith("cf.expense.living") && !c.row.startsWith("cf.expense.living.surplus") && !c.row.startsWith("cf.expense.living.drawdown"));
  if (deposit.size > 0) {
    const y = years.find((yy) => (living.get(yy) ?? 0) > 0 && (deposit.get(yy) ?? 0) < ((living.get(yy) ?? 0) / 12) * months);
    if (y !== undefined) out.push({ key: "deposit", title: "預金が少なくなる年", text: `${y}年に預金が生活費の${months}か月分（${man(((living.get(y) ?? 0) / 12) * months)}万円）を下回ります（${man(deposit.get(y) ?? 0)}万円）`, year: y });
  }
  const net = sumBy(t, (c) => c.row === "cf.net");
  let run: number[] = [];
  for (const y of years) {
    if ((net.get(y) ?? 0) < 0) run.push(y);
    else if (run.length >= 3) break;
    else run = [];
  }
  if (run.length >= 3) out.push({ key: "deficit", title: "赤字が続く", text: `${run[0]}年から${run.at(-1)}年まで${run.length}年続けて年間収支が赤字です`, year: run[0] ?? null });
  const edu = sumBy(t, (c) => c.row.startsWith("cf.expense.education"));
  const care = sumBy(t, (c) => c.row.startsWith("cf.expense.care"));
  const both = years.filter((y) => (edu.get(y) ?? 0) > 0 && (care.get(y) ?? 0) > 0);
  if (both.length > 0) out.push({ key: "eduCare", title: "教育と介護が重なる", text: `${both[0]}年${both.length > 1 ? `から${both.length}年` : ""}、教育費と介護の費用が同じ年にかかります`, year: both[0] ?? null });
  const frame = new Map<string, Map<number, number>>();
  for (const c of t) {
    if (c.row !== "cf.balance.nisaFrame") continue;
    const k = c.member ?? "";
    const m = frame.get(k) ?? new Map<number, number>();
    m.set(c.year, (m.get(c.year) ?? 0) + c.amount);
    frame.set(k, m);
  }
  for (const [member, m] of frame) {
    const y = years.find((yy, i) => i > 0 && (m.get(yy) ?? 1) <= 0 && (m.get(years[i - 1] as number) ?? 0) > 0);
    if (y !== undefined) {
      const who = req.input.household.members.find((x) => x.id === member);
      out.push({ key: `nisa:${member}`, title: "NISA の枠を使い切る年", text: `${y}年に${who?.kind === "spouse" ? "配偶者の" : who?.kind === "self" ? "本人の" : ""}NISA の生涯の投資枠を使い切ります（その後の積立は課税口座で計算します）`, year: y });
    }
  }
  if (opts.inheritanceTax != null && opts.inheritanceTax > 0) out.push({ key: "inheritanceTax", title: "相続税がかかる見込み", text: `いま亡くなったときの相続税の目安は${man(opts.inheritanceTax)}万円です（相続・贈与のカード）`, year: null });
  return out;
}
