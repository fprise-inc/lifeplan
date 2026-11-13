// 面談の準備（0074）の中身: 世帯の中身の一覧・次の1年に起きること・過ぎた予定・前回（控え）との入力の違い・ポイント（結果のタブ）の知らせ。
// どれも世帯の物と計算の結果から読むだけで、世帯も計算も変えない（入力は増えない）
import type { EngineRequest, Member, PreviewResult, TableCell, Timepoint } from "../../engine/types.ts";
import { addMonths, ageReachedMonth, parseYm } from "../levers.ts";
import { resolveTimepoint } from "../timepoint.ts";
import { displayYears, financialOf } from "../present.ts";
import { fromRequest, type WorkingHousehold } from "../input/household.ts";
import { inputItems } from "../input/items.ts";
import { memberLabel, memberLabels } from "../input/labels.ts";
import { INCOME_KINDS, OUT_KINDS } from "../input/moneyRows.ts";
import { creditActive } from "../input/stages/housingLoans.ts";
import { amountText as yenText, formatYearMonth, wareki } from "../input/units.ts";
import { fieldValueText, objectCards, planIndex } from "../plans/planEdit.ts";
import { man, toMan } from "../../presentation/format.ts";
import { OFFICIAL_WORDING, type Wording } from "../resultTexts.ts";

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

/** 物の額の短い文（口座の時価・行の額・ローンの残高か借入額・保険料・介護の月々の費用・FP顧問料など。無ければ null）。額は欄の外の書き方（0131 の7） */
function amountText(collection: string, o: Obj): string | null {
  if (collection === "insurance" && isObj(o.premium) && typeof o.premium.amount === "number") {
    const f = o.premium.frequency;
    return `保険料 ${f === "monthly" || f === "annual" ? yenText(o.premium.amount, f === "monthly" ? "month" : "year") : `${yenText(o.premium.amount)}（1回）`}`;
  }
  if (collection === "debt") {
    const b = boxValue(o.balance) ?? boxValue(o.principal);
    return b === null ? null : `${boxValue(o.balance) !== null ? "残高" : "借入額"} ${yenText(b)}`;
  }
  if (collection === "care") return careText(o);
  if (collection === "advisoryFee") return feeText(o);
  for (const k of ["marketValue", "amount", "monthly", "price"]) {
    const v = boxValue(o[k]);
    if (v !== null && v > 0) return yenText(v, k === "monthly" ? "month" : undefined);
  }
  return null;
}

/** 介護の物: 在宅か施設か・月々の費用・期間（「施設・月13.8万円・55か月」。額・期間が未入力なら入っている所だけ） */
function careText(o: Obj): string | null {
  const parts = [o.place === "facility" ? "施設" : "在宅"];
  const monthly = (boxValue(o.serviceMonthly) ?? 0) + (boxValue(o.otherMonthly) ?? 0);
  if (monthly > 0) parts.push(yenText(monthly, "month"));
  if (typeof o.months === "number") parts.push(`${String(o.months)}か月`);
  return parts.join("・");
}

/** FP顧問料: 単発の料金と継続の顧問料（「単発30万円＋月1万円」。止めている契約は「（止めている）」） */
function feeText(o: Obj): string | null {
  const t = isObj(o.terms) ? o.terms : {};
  const parts: string[] = [];
  const once = Array.isArray(t.oneTime) ? t.oneTime.reduce((a: number, x: unknown) => a + (isObj(x) && typeof x.amount === "number" ? x.amount : 0), 0) : 0;
  if (once > 0) parts.push(`単発${yenText(once)}`);
  const r = isObj(t.recurring) ? t.recurring : null;
  if (r !== null && typeof r.monthly === "number" && r.monthly > 0) parts.push(yenText(r.monthly, "month"));
  else if (r !== null && typeof r.annual === "number" && r.annual > 0) parts.push(yenText(r.annual, "year"));
  if (parts.length === 0) return null;
  return `${parts.join("＋")}${o.enabled === false ? "（止めている）" : ""}`;
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
      // 予定の子は生まれる予定の年月も出す（家族の項目の生まれる予定の欄と同じ和暦）
      text = m.expected === true ? `これから生まれる予定（${wareki(m.birth.birthYearMonth)}）` : `${age}歳${isObj(m.outside) ? "・世帯の外" : ""}`;
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

/** 計算の基準の月より前に過ぎた、1回きりの予定（受け取る予定の相続・贈与・一時的支出と収入）。済んだか・まだか・やめたかを確かめる */
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
 * 控えの現状の入力と、今の入力の違い（欄ごと。足した物・外した物は物ごとに1行）。向き先と入力項目ID（当て先）で比較するので、
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

// ---- ポイントの知らせ（結果のタブ。前の名前は気づき） ----

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

/** 働いて得る収入の行（給与・役員報酬・事業の収入。再雇用・パートの給与も入る） */
const isWorkRow = (row: string) => row === "cf.income.salary" || row === "cf.income.salary.executive" || row === "cf.income.business";
/** 公的年金（老齢年金）の行（遺族年金・障害年金・企業年金は入れない） */
const PENSION_ROW = "cf.income.pension";

/** ご本人・配偶者の、表に出す年のうち働いて得る収入がある年と、年金の受け取りが始まる年 */
interface Adult {
  id: string;
  label: string;
  birthYear: number;
  /** 働いて得る収入のある年（昇順） */
  work: number[];
  /** 表の最初の年の働いて得る収入と、表の期間の合計 */
  firstIncome: number;
  totalIncome: number;
  /** 老齢年金の受け取りが始まる年（表の中に無ければ null） */
  pension: number | null;
}

function adultsOf(req: EngineRequest, t: readonly TableCell[], years: readonly number[]): Adult[] {
  const shown = new Set(years);
  const out: Adult[] = [];
  for (const m of req.input.household.members) {
    if (m.kind !== "self" && m.kind !== "spouse") continue;
    const work = new Map<number, number>();
    const pension = new Set<number>();
    for (const c of t) {
      if (c.member !== m.id || !shown.has(c.year) || c.amount <= 0) continue;
      if (isWorkRow(c.row)) work.set(c.year, (work.get(c.year) ?? 0) + c.amount);
      else if (c.row === PENSION_ROW) pension.add(c.year);
    }
    out.push({
      id: m.id,
      label: m.kind === "self" ? "ご本人" : "配偶者",
      birthYear: parseYm(m.birth.birthYearMonth).y,
      work: [...work.keys()].sort((a, b) => a - b),
      firstIncome: work.get(years[0] ?? NaN) ?? 0,
      totalIncome: [...work.values()].reduce((s, v) => s + v, 0),
      pension: years.find((y) => pension.has(y)) ?? null,
    });
  }
  return out;
}

/**
 * いまの家計の主な働き手: 表の最初の年の働いて得る収入が多い方（その年にどちらも無ければ、表の期間の合計が多い方）。
 * だれも働いて得る収入が無ければ null（年金で暮らしている世帯など）
 */
function mainEarner(adults: readonly Adult[]): Adult | null {
  const by = (f: (a: Adult) => number) => adults.filter((a) => f(a) > 0).sort((a, b) => f(b) - f(a))[0];
  return by((a) => a.firstIncome) ?? by((a) => a.totalIncome) ?? null;
}

// ---- 大きな支出が重なる年 ----

/** 大きな支出の1件（その年の額）。教育費は子ごと・介護は人ごと・夢やライフイベントの支出は行ごと・車の買い替えは車ごと */
export interface BigSpendItem {
  key: string;
  label: string;
  amount: number;
}

/** ある年の支出（決め方で選んだ大きな支出・支出の合計・前後の年のふだんの額・生活費） */
export interface BigSpendYear {
  year: number;
  /** 決め方の「大きな支出」の額以上の物（額の多い順） */
  items: BigSpendItem[];
  /** 支出の合計（税・社会保険料・黒字の貯まり・取り崩し・繰上返済を除く） */
  total: number;
  /** 前後5年（その年を除く）の支出の合計の中央値。比較する年が3つ未満なら null */
  usual: number | null;
  /** 生活費（黒字の貯まり・取り崩しを除く） */
  living: number;
}

/** 大きな支出が重なる年の決め方（差し替えられるように1つの形にする。見本の世帯での比較は 0074 の追記 2026-11-12） */
export interface OverlapRule {
  id: string;
  /** 決め方の説明（設計記録・比較の表に書く） */
  label: string;
  /** この額以上の支出を「大きな支出」と数える */
  minItem: number;
  hit: (y: BigSpendYear) => boolean;
}

const itemsTotal = (y: BigSpendYear) => y.items.reduce((s, x) => s + x.amount, 0);

export const OVERLAP_RULES = {
  /** 案1: 100万円以上の大きな支出が2件以上ある年 */
  count: { id: "count", label: "100万円以上の大きな支出が2件以上ある年", minItem: 1_000_000, hit: (y) => y.items.length >= 2 },
  /** 案2（採用）: 支出の合計が前後の年のふだんの額より2割以上多く、50万円以上の大きな支出が2件以上ある年 */
  usual: {
    id: "usual",
    label: "支出の合計が前後5年のふだんの額（中央値）より2割以上多く、50万円以上の大きな支出が2件以上ある年",
    minItem: 500_000,
    hit: (y) => y.items.length >= 2 && y.usual !== null && y.total >= y.usual * 1.2,
  },
  /** 案3: 50万円以上の大きな支出が2件以上あり、その合計がその年の生活費の半分以上の年 */
  living: { id: "living", label: "50万円以上の大きな支出が2件以上あり、その合計がその年の生活費の半分以上の年", minItem: 500_000, hit: (y) => y.items.length >= 2 && itemsTotal(y) >= y.living * 0.5 },
} satisfies Record<string, OverlapRule>;

/** ポイントに使う決め方 */
export const OVERLAP_RULE: OverlapRule = OVERLAP_RULES.usual;

const LUMP_LABEL: Record<string, string> = {
  "cf.expense.lumpSum.car": "車の買い替え",
  "cf.expense.lumpSum.wedding": "結婚の費用",
  "cf.expense.lumpSum.funeral": "葬儀の費用",
  "cf.expense.lumpSum.gift": "贈与・援助",
  "cf.expense.lumpSum.other": "一時的な支出",
  "cf.expense.other": "その他の支出",
};

/** 表の1つの値が、どの大きな支出の物か（大きな支出に数えない行は null）。ふだんの住まいの修繕費・生活費・ローンの返済・保険料などは数えない */
function bigItemOf(c: TableCell, h: EngineRequest["input"]["household"], names: ReadonlyMap<string, string>): { key: string; label: string } | null {
  const row = c.row;
  const who = (id: string | undefined) => (id === undefined ? "ご家族" : (names.get(id) ?? "ご家族"));
  // 出るお金の行（夢・ライフイベントの支出・修繕・リフォーム・留学など）は行ごと
  const p = (h.periodicExpenses ?? []).find((x) => x.id === c.object);
  if (p !== undefined && (row.startsWith("cf.expense.lumpSum") || row.startsWith("cf.expense.education") || row === "cf.expense.other" || row === "cf.expense.housing.maintenance")) {
    const label = typeof p.label === "string" && p.label !== "" ? p.label : (OUT_KINDS.find((k) => k.kind === p.kind)?.label ?? LUMP_LABEL[row] ?? "支出");
    return { key: `p:${p.id}`, label: p.kind === "dream" ? `夢「${label}」` : label };
  }
  if (row.startsWith("cf.expense.education")) {
    const g = (h.goals ?? []).find((x) => x.id === c.object);
    const child = g?.owner ?? c.member;
    return { key: `edu:${child ?? c.object ?? ""}`, label: child === undefined ? "教育費" : `${who(child)}の教育費` };
  }
  if (row.startsWith("cf.expense.care")) {
    const k = (h.careExpenses ?? []).find((x) => x.id === c.object);
    return { key: `care:${k?.member ?? c.member ?? c.object ?? ""}`, label: `${who(k?.member ?? c.member)}の介護` };
  }
  if (row.startsWith("cf.expense.housing.purchase")) return { key: `buy:${c.object ?? ""}`, label: "住まいの購入（頭金・諸費用）" };
  if (row.startsWith("cf.expense.lumpSum") || row === "cf.expense.other") return { key: `${row}:${c.object ?? ""}`, label: LUMP_LABEL[row] ?? "一時的な支出" };
  return null;
}

const median = (a: readonly number[]): number => {
  const s = [...a].sort((x, y) => x - y);
  const n = s.length;
  return n % 2 === 1 ? (s[(n - 1) / 2] as number) : ((s[n / 2 - 1] as number) + (s[n / 2] as number)) / 2;
};

/** 表に出す年ごとの支出（大きな支出は rule の額以上の物だけ）。読むだけ */
export function bigSpendByYear(req: EngineRequest, t: readonly TableCell[], rule: OverlapRule = OVERLAP_RULE): BigSpendYear[] {
  const years = displayYears(req);
  const h = req.input.household;
  const names = memberLabels(fromRequest(req));
  const items = new Map<number, Map<string, BigSpendItem>>();
  const total = new Map<number, number>();
  const living = new Map<number, number>();
  for (const c of t) {
    if (!c.row.startsWith("cf.expense.")) continue;
    if (c.row.startsWith("cf.expense.living.surplus") || c.row.startsWith("cf.expense.living.drawdown") || c.row === "cf.expense.housing.loan.prepayment") continue;
    total.set(c.year, (total.get(c.year) ?? 0) + c.amount);
    if (c.row.startsWith("cf.expense.living")) living.set(c.year, (living.get(c.year) ?? 0) + c.amount);
    const it = bigItemOf(c, h, names);
    if (it === null) continue;
    const m = items.get(c.year) ?? new Map<string, BigSpendItem>();
    const x = m.get(it.key) ?? { key: it.key, label: it.label, amount: 0 };
    x.amount += c.amount;
    m.set(it.key, x);
    items.set(c.year, m);
  }
  return years.map((year) => {
    const near = years.filter((y) => y !== year && Math.abs(y - year) <= 5).map((y) => total.get(y) ?? 0);
    return {
      year,
      items: [...(items.get(year)?.values() ?? [])].filter((x) => x.amount >= rule.minItem).sort((a, b) => b.amount - a.amount),
      total: total.get(year) ?? 0,
      usual: near.length >= 3 ? median(near) : null,
      living: living.get(year) ?? 0,
    };
  });
}

/** 大きな支出が重なる年（rule に当たる年。年の順） */
export function bigSpendOverlaps(req: EngineRequest, t: readonly TableCell[], rule: OverlapRule = OVERLAP_RULE): BigSpendYear[] {
  return bigSpendByYear(req, t, rule).filter((y) => rule.hit(y));
}

/** 前後の年より何割多いか（「約8割」「約2.3倍」。1割未満・比較する年が無ければ null） */
function moreText(y: BigSpendYear): string | null {
  if (y.usual === null || y.usual <= 0) return null;
  const r = y.total / y.usual;
  if (r < 1.1) return null;
  return r >= 2 ? `約${(Math.round(r * 10) / 10).toFixed(1)}倍に` : `約${String(Math.round((r - 1) * 10))}割多く`;
}

/** 年の並びの短い文（続く年は「2031〜2033年」、離れた年は「・」でつなぐ。4つ目のまとまりからは「など」） */
function yearsText(ys: readonly number[]): string {
  const runs: [number, number][] = [];
  for (const y of [...ys].sort((a, b) => a - b)) {
    const last = runs.at(-1);
    if (last !== undefined && y === last[1] + 1) last[1] = y;
    else runs.push([y, y]);
  }
  const parts = runs.slice(0, 3).map(([a, b]) => (a === b ? String(a) : `${String(a)}〜${String(b)}`));
  return `${parts.join("・")}年${runs.length > 3 ? "など" : ""}`;
}

function bigSpendInsight(req: EngineRequest, t: readonly TableCell[], rule: OverlapRule, w: Wording): Insight | null {
  const hits = bigSpendOverlaps(req, t, rule);
  if (hits.length === 0) return null;
  // いちばん大きく重なる年（大きな支出の合計が多い年）を出し、ほかの年は括弧に
  const peak = [...hits].sort((a, b) => itemsTotal(b) - itemsTotal(a) || a.year - b.year)[0] as BigSpendYear;
  const shown = peak.items.slice(0, 3).map((x) => `${x.label}${man(x.amount)}万円`);
  const list = `${shown.join("・")}${peak.items.length > 3 ? "など" : ""}`;
  const more = moreText(peak);
  const others = hits.filter((y) => y.year !== peak.year).map((y) => y.year);
  const rest = others.length === 0 ? "" : w.text("result:main/pointBigSpendOthers", { years: yearsText(others) });
  const at = { year: `${peak.year}年`, items: list, others: rest };
  return { key: "bigSpend", title: "大きな支出が重なる年", text: more !== null ? w.text("result:main/pointBigSpendMore", { ...at, more }) : w.text("result:main/pointBigSpend", at), year: peak.year };
}

// ---- 住宅ローン控除が終わる年 ----

/**
 * 住宅ローン控除を受けない計算の要求（控除の期間の中か、これから入居する住宅ローンの控除を止めた写し）。そういうローンが無ければ null。
 * 控除が終わる年と手取りの減り方は、この計算と今の計算の所得税・住民税の違いから読む（計算エンジンの表に控除の額の行は無い）
 */
export function withoutHousingCredit(req: EngineRequest): EngineRequest | null {
  const h = req.input.household;
  const active = (h.debts ?? []).filter((d) => d.housing !== undefined && creditActive(h, d.housing, req.input.baseMonth));
  if (active.length === 0) return null;
  const ids = new Set(active.map((d) => d.id));
  const q = structuredClone(req) as EngineRequest;
  for (const d of q.input.household.debts ?? []) if (ids.has(d.id) && d.housing !== undefined) (d.housing as { creditDisabled?: boolean }).creditDisabled = true;
  return q;
}

const TAX_ROWS = new Set(["cf.taxSi.incomeTax", "cf.taxSi.residentTax"]);

/** 住宅ローン控除を受ける（今の）計算と受けない計算の結果の組 */
export interface CreditPair {
  on: PreviewResult;
  off: PreviewResult;
}

function creditInsight(years: readonly number[], { on: r, off }: CreditPair, w: Wording): Insight | null {
  const tax = (t: readonly TableCell[], row: string) => sumBy(t, (c) => c.row === row);
  const itNow = tax(r.table, "cf.taxSi.incomeTax");
  const itOff = tax(off.table, "cf.taxSi.incomeTax");
  const allNow = sumBy(r.table, (c) => TAX_ROWS.has(c.row));
  const allOff = sumBy(off.table, (c) => TAX_ROWS.has(c.row));
  // 1,000円未満の違いは端数とみる
  const credited = (a: Map<number, number>, b: Map<number, number>) => years.filter((y) => (b.get(y) ?? 0) - (a.get(y) ?? 0) >= 1000);
  // 控除の最後の年: 所得税が軽くなる最後の年（所得税から引ききれない分の住民税の軽減は翌年・翌々年にずれて出るので、所得税で決める）
  const last = credited(itNow, itOff).at(-1) ?? credited(allNow, allOff).at(-1);
  if (last === undefined || last === years.at(-1)) return null;
  const amount = (allOff.get(last) ?? 0) - (allNow.get(last) ?? 0);
  return {
    key: "housingCredit",
    title: "住宅ローン控除が終わる年",
    text: w.text("result:main/pointHousingCredit", { year: `${last}年`, amount: `${man(amount)}万円` }),
    year: last,
  };
}

// ---- 退職から年金までの空白・退職後もローンが残る ----

function retireGapInsights(adults: readonly Adult[], w: Wording): Insight[] {
  const out: Insight[] = [];
  for (const a of adults) {
    const last = a.work.at(-1);
    // 年の単位で見るので、1年の違い（退職の翌年に年金が始まる）は月の違いのことがあり、出さない
    if (last === undefined || a.pension === null || a.pension - last < 2) continue;
    const partner = adults.find((x) => x.id !== a.id);
    const pw = partner === undefined ? [] : partner.work.filter((y) => y > last && y < (a.pension as number));
    const note =
      partner === undefined || pw.length === 0
        ? ""
        : pw.length === a.pension - last - 1
          ? w.text("result:main/pointRetireGapPartnerAll", { partner: partner.label })
          : w.text("result:main/pointRetireGapPartnerUntil", { partner: partner.label, year: `${String(pw.at(-1))}年` });
    out.push({
      key: `retireGap:${a.id}`,
      title: "退職から年金までの空白",
      text: w.text("result:main/pointRetireGap", { person: a.label, age: `${String(last - a.birthYear)}歳`, years: `${String(a.pension - last)}年`, note }),
      year: last + 1,
    });
  }
  return out;
}

const DEBT_NAME: Record<string, string> = { mortgage: "住宅ローン", car: "自動車ローン", scholarship: "奨学金", other: "その他のローン" };

function loanAfterRetireInsights(req: EngineRequest, t: readonly TableCell[], years: readonly number[], adults: readonly Adult[], w: Wording): Insight[] {
  const out: Insight[] = [];
  const end = years.at(-1);
  if (end === undefined) return out;
  for (const d of req.input.household.debts ?? []) {
    const debtor = d.debtors.find((x) => x.role === "primary") ?? d.debtors.find((x) => x.role !== "guarantor");
    const a = adults.find((x) => x.id === debtor?.member);
    const retire = a?.work.at(-1);
    if (a === undefined || retire === undefined || retire >= end) continue;
    const bal = sumBy(t, (c) => c.object === d.id && c.row.startsWith("cf.balance.debt"));
    const lastOwed = years.filter((y) => (bal.get(y) ?? 0) > 0).at(-1);
    if (lastOwed === undefined) continue;
    const name = `${DEBT_NAME[d.kind] ?? "ローン"}${typeof d.label === "string" && d.label !== "" ? `「${d.label}」` : ""}${adults.length > 1 ? `（${a.label}）` : ""}`;
    if (lastOwed === end) {
      out.push({ key: `loanAfterRetire:${d.id}`, title: "退職後もローンが残る", text: w.text("result:main/pointLoanToEnd", { loan: name, end: `${String(end)}年`, years: `${String(end - retire)}年` }), year: retire + 1 });
      continue;
    }
    // 年末の残高が0になる年が完済の年（繰上返済の予定も計算に入っている）
    const payoff = lastOwed + 1;
    if (payoff <= retire) continue;
    out.push({
      key: `loanAfterRetire:${d.id}`,
      title: "退職後もローンが残る",
      text:
        payoff - retire === 1
          ? w.text("result:main/pointLoanPayoffNext", { loan: name, age: `${String(payoff - a.birthYear)}歳`, year: `${String(payoff)}年` })
          : w.text("result:main/pointLoanPayoff", { loan: name, age: `${String(payoff - a.birthYear)}歳`, year: `${String(payoff)}年`, years: `${String(payoff - retire)}年` }),
      year: payoff,
    });
  }
  return out;
}

/**
 * ポイント（前の名前は気づき。決まりで数件。入力は増えない。0074 の追記 2026-11-12 で見直した）: 預金が少なくなる年・赤字が続く（働いている間）・
 * 大きな支出が重なる年・退職から年金までの空白・退職後もローンが残る・住宅ローン控除が終わる年・相続税がかかる見込み。
 * months は「生活費の何か月分」（お金の3つの分け方の設定。既定は6か月）。credit は住宅ローン控除を受ける・受けない計算の組（`withoutHousingCredit`。無ければ控除のポイントは出さない）。
 * overlapRule は大きな支出が重なる年の決め方（既定は OVERLAP_RULE）
 */
export function insights(req: EngineRequest, r: PreviewResult, opts: { months?: number; inheritanceTax?: number | null; credit?: CreditPair | null; overlapRule?: OverlapRule; wording?: Wording } = {}): Insight[] {
  // 文は結果の画面の文の表（resultTexts.ts の result:main/point…）から。事務所の文を承認していれば、その文に同じ値を差し込む（0212）
  const w = opts.wording ?? OFFICIAL_WORDING;
  const years = displayYears(req);
  const t = r.table;
  const out: Insight[] = [];
  const months = opts.months ?? 6;
  const deposit = sumBy(t, (c) => c.row === "cf.balance.account.deposit");
  const living = sumBy(t, (c) => c.row.startsWith("cf.expense.living") && !c.row.startsWith("cf.expense.living.surplus") && !c.row.startsWith("cf.expense.living.drawdown"));
  if (deposit.size > 0) {
    const y = years.find((yy) => (living.get(yy) ?? 0) > 0 && (deposit.get(yy) ?? 0) < ((living.get(yy) ?? 0) / 12) * months);
    if (y !== undefined) {
      const left = deposit.get(y) ?? 0;
      const reserve = man(((living.get(y) ?? 0) / 12) * months);
      const at = { year: `${y}年`, months: `${months}か月`, need: `${reserve}万円` };
      const text = toMan(left) <= 0 ? w.text("result:main/pointDepositGone", at) : w.text("result:main/pointDeposit", { ...at, deposit: `${man(left)}万円` });
      out.push({ key: "deposit", title: "預金が少なくなる年", text, year: y });
    }
  }
  // 赤字が続く: 働いている間（いまの主な働き手が働く最後の年まで）だけで見る。退職した後の赤字は貯めたお金の取り崩しで、出るのが当たり前なので出さない
  const adults = adultsOf(req, t, years);
  const workEnd = mainEarner(adults)?.work.at(-1);
  if (workEnd !== undefined) {
    const net = sumBy(t, (c) => c.row === "cf.net");
    let run: number[] = [];
    for (const y of years.filter((yy) => yy <= workEnd)) {
      if ((net.get(y) ?? 0) < 0) run.push(y);
      else if (run.length >= 3) break;
      else run = [];
    }
    if (run.length >= 3) out.push({ key: "deficit", title: "赤字が続く", text: w.text("result:main/pointDeficit", { from: `${run[0]}年`, to: `${run.at(-1)}年`, years: `${run.length}年` }), year: run[0] ?? null });
  }
  const big = bigSpendInsight(req, t, opts.overlapRule ?? OVERLAP_RULE, w);
  if (big !== null) out.push(big);
  out.push(...retireGapInsights(adults, w));
  out.push(...loanAfterRetireInsights(req, t, years, adults, w));
  if (opts.credit != null) {
    const c = creditInsight(years, opts.credit, w);
    if (c !== null) out.push(c);
  }
  if (opts.inheritanceTax != null && opts.inheritanceTax > 0) out.push({ key: "inheritanceTax", title: "相続税がかかる見込み", text: w.text("result:main/pointInheritanceTax", { amount: `${man(opts.inheritanceTax)}万円` }), year: null });
  return out;
}
