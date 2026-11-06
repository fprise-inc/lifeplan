// 入力のホームの項目（作業の層）: 15の項目のカードと、FP がホームに出した物のピン。
// - カードに出すのは「イラスト＋名前＋要約の数字1つ＋状態」まで。状態は4つ（入力済み・推定で計算中・未入力〔0円の所あり〕・当てはまらない）と、
//   まだ何も入れていない項目の「まだ入れていない」で、欄の値の状態（valueState.ts。0041）と入っていない物（fill.ts の gapsOf。確かめの一覧のいちばん上と同じ）から決め、
//   色だけに頼らずに見せる（InputView.tsx）。抜けの赤い知らせは、入れ始めた項目にだけ出す（0045 の追記）
// - 1つの物は1つのカードにだけ出す（ほかのカードは読むだけの1行。readLines.ts）。どのカードに出すかは段階の定義（stages/）が決める
// - ピン: まとまりの「📌 ホームに出す」で出した物と、前の版の「＋ 項目を追加」で足した物（addedItems。世帯ファイルの形は今のまま、意味だけを変えた。0045）。
//   物は種類が属するカードにも出る。ピンを押すと、その物のまとまりだけを開く。進み具合には数えない。プランで足した物のピンは、そのプランの編集中だけ出る。
//   「＋ 項目を追加」はやめた（足せた留学・名前を付けた支出・介護の費用は、どれも元からある入力項目の中で入れられる）。代わりに入力のホームの
//   「探して開く」（inputSearch.ts）で、入れる入力項目の欄へ案内する。前に足した物とピンは今までどおり読み、計算し、ホームに出す（直す・外すはできる。0045 の 2026-11-04 の追記）
// FP顧問料は「前提条件」のカードの中の欄のまとまり（stages/assumptions.ts）。車は「車」のカードの中で1台ずつ足す（stages/cars.ts）
import type { AdvisoryFee, Car, CareExpense, Household, PeriodicExpense } from "../../engine/types.ts";
import { addMonths, ageAt } from "../levers.ts";
import { resolveTimepoint } from "../timepoint.ts";
import { allFields, type FieldDef, type SectionDef, type StageDef, type StageId } from "./form.ts";
import { educationStagesAddress, fillAll, gapsOf, retirementNotApplicable, type Gap } from "./fill.ts";
import { newId, type AddedItem, type WorkingHousehold } from "./household.ts";
import { earners, memberLabel } from "./labels.ts";
import { isRow, rowAt } from "./rows.ts";
import { carDebts, leaseAnnual, upkeepAnnual } from "./stages/cars.ts";
import { outsideMembers } from "./stages/care.ts";
import { isRentalProperty, rentalProperties } from "./stages/rental.ts";
import { expenseCard, incomeCard, type MoneyCard } from "./moneyRows.ts";
import { childOfPeriodic, eventExpenses } from "./stages/events.ts";
import { dreamRows } from "./dreams.ts";
import { buildStage, STAGE_ORDER } from "./stages/index.ts";
import { giftLines } from "./stages/inheritance.ts";
import { statementMonthsMissing } from "./stages/pension.ts";
import { totalViewOf } from "./savings/model.ts";
import { currentPeriod } from "./stages/work.ts";
import { endedLongAgo, fieldAddress, fieldStatus, holderOfField, isPremiseField } from "./valueState.ts";
import { ALWAYS_SHOWN, isHiddenIn } from "./itemChoice.ts";

/**
 * カードの状態: 入力済み・推定で計算中・未入力（0円の所あり）・当てはまらない・まだ入れていない（入れ始める前。赤い知らせを出さない）と、
 * 前提条件の入力項目だけの「既定の値で計算中」（前提を1つも打っていない・「この値にする」を押していない。灰色。0041 の追記 2026-11-06）
 */
export type ItemStatus = "done" | "est" | "missing" | "na" | "empty" | "std";

/** まとまり（項目が増えたときの見出し） */
export type ItemGroup = "familyIncome" | "flows" | "assets" | "premise";
export const ITEM_GROUPS: readonly { id: ItemGroup; label: string }[] = [
  { id: "familyIncome", label: "家族と収入" },
  { id: "flows", label: "お金の出入り" },
  { id: "assets", label: "資産と備え" },
  { id: "premise", label: "前提" },
];

/** カードのイラストの種類（app/src/assets/illustrations/ のファイル名か、その代わりの絵。illustrations.ts） */
export type Art = StageId | "pet" | "abroad";

/** 要約の数字1つ（例: 「年収 」「720」「万円」）。数字の部分を大きく見せる */
export interface Summary {
  pre?: string;
  main: string;
  unit?: string;
  /** 要約の下の小さな1行（相続・贈与の「相続税: かからない見込み」。計算の結果から。0060 の 2026-10-29 の追記） */
  note?: string;
}

/** 要約の文字の一片（small は小さく見せる pre・unit の部分） */
export interface SummaryPiece {
  text: string;
  small: boolean;
}

/**
 * 要約を「・」の区切りでまとまりに分ける（ホームで、まとまりの途中では折り返さず、区切りでだけ改行するため。0045 の 2026-10-29 の追記）。
 * 「・」は前のまとまりの終わりに付ける。かっこ（「（」〜「）」）はひとまとまりにして、その前で分ける（かっこの中の「・」では分けない）。各まとまりは見た目の違う一片の並び
 */
export function summarySegments(s: Summary): SummaryPiece[][] {
  const pieces: SummaryPiece[] = [
    ...(s.pre !== undefined ? [{ text: s.pre, small: true }] : []),
    { text: s.main, small: false },
    ...(s.unit !== undefined ? [{ text: s.unit, small: true }] : []),
  ];
  const segs: SummaryPiece[][] = [[]];
  let depth = 0;
  for (const p of pieces) {
    let buf = "";
    const flush = () => {
      if (buf !== "") (segs[segs.length - 1] as SummaryPiece[]).push({ text: buf, small: p.small });
      buf = "";
    };
    for (const ch of p.text) {
      // かっこの始まりの前でも改行できる（「月39.1万円」「（65歳から・推定）」）
      if ((ch === "（" || ch === "(") && depth === 0) {
        flush();
        if ((segs[segs.length - 1] as SummaryPiece[]).length > 0) segs.push([]);
      }
      buf += ch;
      if (ch === "（" || ch === "(") depth++;
      else if ((ch === "）" || ch === ")") && depth > 0) depth--;
      else if (ch === "・" && depth === 0) {
        flush();
        segs.push([]);
      }
    }
    flush();
  }
  return segs.filter((g) => g.length > 0);
}

export interface InputItem {
  /** カードの ID: 15の項目は段階の ID（family など）、ピンは `added:` で始まる */
  id: string;
  label: string;
  /** 段階の説明（パネルの見出しの下） */
  lead: string;
  group: ItemGroup;
  /** 項目の色（帯・小さな四角・イラストの面だけに使う。文字には使わない） */
  color: string;
  art: Art;
  /** ピンなら、その記録 */
  added: AddedItem | null;
  status: ItemStatus;
  /** 推定・書類待ち（代わりの値）・仮の値の欄の数 */
  estimated: number;
  /** 推定・書類待ち・仮の値の欄の名前（入力項目の中の並び。「推定で計算中」の札の吹き出しに使う） */
  estimatedNames?: readonly string[];
  /** 未入力（0円で計算中）の欄と、入っていない物の数 */
  missing: number;
  summary: Summary | null;
  /** カードの1行の案内（例: 「入れなくても計算できます（保障は無しで計算中）」）。案内の要らない状態なら null */
  hint: string | null;
  /** カードの上の「当てはまらない」の1押しで抜けられる */
  canNa: boolean;
  /** カードの上の「目安で入れる」の1押しで抜けられる（入っていない物を推定で埋められる） */
  canFill: boolean;
  /** 値が入っている（項目に属する物があるか、FP が欄に入れた印がある）。非表示にしてあってもホームに出す */
  entered: boolean;
  /** 入力のホームに出さない（世帯の選び方で非表示にしてあり、値が入っていない。itemChoice.ts） */
  hidden: boolean;
}

/** ピン（ホームに出した物） */
export interface PinItem extends InputItem {
  added: AddedItem;
  /** 物が属するカード */
  owner: StageId;
  /** 現状には無く、編集中のプランで足した物 */
  planOnly: boolean;
}

/** 見出しで区切るのは、カード（項目）がこの数以上のとき（ピンは数えない） */
export const GROUP_HEADINGS_FROM = 16;

/** カードの並び（事務所の既定値で変えられる形。0073）。前にあった「最初の5枚」（first）はなくした（古い事務所データの first は読まない） */
export interface CardLayout {
  order: readonly StageId[];
}

export const DEFAULT_LAYOUT: CardLayout = { order: STAGE_ORDER.map((s) => s.id) };

/** 「当てはまらない」の1押しを出さない項目（どの世帯にもある物。家族・基本生活費・前提条件） */
const NO_NA: ReadonlySet<StageId> = new Set<StageId>(["family", "living", "assumptions"]);

/** 並び: 設定の順に、設定に無いカードを標準の順で後ろに足す（どのカードも1回ずつ） */
export function cardOrder(layout: CardLayout = DEFAULT_LAYOUT): StageId[] {
  const known = new Set(STAGE_ORDER.map((s) => s.id));
  const out = [...new Set(layout.order.filter((id) => known.has(id)))];
  for (const s of STAGE_ORDER) if (!out.includes(s.id)) out.push(s.id);
  return out;
}

interface BaseDef {
  group: ItemGroup;
  color: string;
}

const BASE: Record<StageId, BaseDef> = {
  family: { group: "familyIncome", color: "#C96B5C" },
  work: { group: "familyIncome", color: "#4A72B8" },
  retirement: { group: "familyIncome", color: "#5A63A8" },
  pension: { group: "familyIncome", color: "#8467B0" },
  living: { group: "flows", color: "#C99A30" },
  education: { group: "flows", color: "#36917F" },
  housing: { group: "flows", color: "#5A9550" },
  insurance: { group: "assets", color: "#3B86AE" },
  savings: { group: "assets", color: "#D0843A" },
  rental: { group: "assets", color: "#2F7F86" },
  events: { group: "flows", color: "#BE5A86" },
  car: { group: "flows", color: "#5C7895" },
  care: { group: "flows", color: "#A86A50" },
  inheritance: { group: "assets", color: "#7E8A3A" },
  fee: { group: "flows", color: "#7E8A3A" },
  assumptions: { group: "premise", color: "#8A7560" },
};

const ART_COLOR: Record<AddedItem["art"], string> = { pet: "#B0704E", abroad: "#4F8FA6", events: BASE.events.color, car: BASE.car.color, fee: BASE.fee.color };

/**
 * カードの1行の案内（未入力のとき: 何で計算しているか。推定で計算中のとき: 何の推定か）。
 * カードの上に出す。物があって0円の欄があるときは、共通の文
 */
const HINTS: Partial<Record<StageId, { missing?: string; est?: string }>> = {
  retirement: { missing: "入れなくても計算できます（退職金は無しで計算中）", est: "目安の退職金で計算中です" },
  pension: { est: "働き方の期間から推計して計算中です" },
  education: { missing: "入れなくても計算できます（教育費は無しで計算中）", est: "進路・奨学金などに推定のままの所があります（学費は学校の種類ごとの統計の平均で計算します）" },
  insurance: { missing: "入れなくても計算できます（保障は無しで計算中）" },
  rental: { missing: "入れなくても計算できます（貸している不動産は無しで計算中）" },
  events: { missing: "入れなくても計算できます（一時的な収支は無しで計算中）" },
  car: { missing: "入れなくても計算できます（車は無しで計算中）", est: "目安の値で計算中です" },
  care: { missing: "入れなくても計算できます（介護の費用は無しで計算中）" },
  inheritance: { missing: "入れなくても計算できます（受け取る相続・贈与は無しで計算中）" },
};
const HINT_ZERO = "0円で計算している所があります";
const HINT_EST = "推定の値で計算中です";

// ---- 要約の数字 ----

/** 円を万円の文字にする（1万円未満の端は、100万円未満なら小数1桁まで） */
export function manText(yen: number): string {
  const man = yen / 10000;
  if (Number.isInteger(man)) return man.toLocaleString("ja-JP");
  if (Math.abs(yen) < 1_000_000) return String(Math.round(man * 10) / 10);
  return Math.round(man).toLocaleString("ja-JP");
}

const adults = (h: Household) => h.members.filter((m) => m.kind === "self" || m.kind === "spouse");
const EXPECTED_KINDS = new Set(["statementOver50", "receiving", "projection"]);

function pensionSummary(h: Household): Summary | null {
  const recs = (h.pensionRecords ?? []).filter((r) => adults(h).some((m) => m.id === r.member));
  if (recs.length === 0) return null;
  const self = h.members.find((m) => m.kind === "self");
  const selfRec = recs.find((r) => r.member === self?.id);
  const at = resolveTimepoint(h, selfRec?.claim?.basic);
  const age = self !== undefined && at !== null ? ageAt(self, addMonths(at, -1)) : 65;
  // 定期便の加入月数が0か月のままなら、写した見込額を出さない（そのままでは年金を0円・少なく計算するため）
  if (recs.some(statementMonthsMissing)) return { main: "加入月数", unit: "が未入力" };
  if (recs.every((r) => EXPECTED_KINDS.has(r.kind) && r.amounts !== undefined)) {
    const annual = recs.reduce((s, r) => s + (r.amounts?.basic?.value ?? 0) + (r.amounts?.employee?.value ?? 0) + (r.amounts?.transitional?.value ?? 0) + (r.amounts?.special?.value ?? 0), 0);
    return { pre: "月", main: manText(Math.round(annual / 12)), unit: `万円（${age}歳から）` };
  }
  return { main: String(recs.length), unit: `人分（${age}歳から）` };
}

/**
 * 働き方と収入の要約: 「年収 720万円」（給与は賞与込み）。自営業だけの世帯は「事業所得 350万円」、給与と事業所得がどちらもあれば
 * 「年収 450万円・事業所得 200万円」（年収の基準は欄と同じ「税込み・賞与込み」。0041 の追記 2026-11-06）
 */
function workSummary(h: Household, baseMonth: string): Summary | null {
  let salary = 0;
  let business = 0;
  let any = false;
  for (const m of adults(h)) {
    const p = currentPeriod(h, m.id, baseMonth);
    if (p === undefined) continue;
    any = true;
    salary += (p.salary?.annual.value ?? 0) + (p.salary?.bonus?.value ?? 0);
    business += p.business?.income.value ?? 0;
  }
  if (!any) return null;
  if (salary > 0 && business > 0) return { pre: "年収 ", main: manText(salary), unit: `万円・事業所得 ${manText(business)}万円` };
  if (business > 0) return { pre: "事業所得 ", main: manText(business), unit: "万円" };
  return salary > 0 ? { pre: "年収 ", main: manText(salary), unit: "万円" } : { main: "収入なし" };
}

function livingSummary(h: Household): Summary | null {
  const l = (h.livingExpenses ?? [])[0];
  if (l === undefined) return null;
  const monthly = l.mode === "total" ? (l.monthly?.value ?? 0) : (l.categories ?? []).reduce((s, c) => s + (c.monthly.value ?? 0), 0);
  return { pre: "月", main: manText(monthly), unit: "万円" };
}

/** 要約に使う段の名前（私立になる最初の段。幼稚園・保育園は、ほかの段が全部公立のときだけ） */
const SCHOOL_NAMES: Readonly<Record<string, string>> = { kindergarten: "幼稚園", elementary: "小学校", juniorHigh: "中学", highSchool: "高校", kosen: "高専", university: "大学", juniorCollege: "短大", vocational: "専門学校", graduateMaster: "大学院", graduateDoctor: "大学院", graduateProfessional: "大学院" };
const HIGHER = new Set(["university", "juniorCollege", "vocational", "graduateMaster", "graduateDoctor", "graduateProfessional"]);

/** 子の私立になる最初の段（無ければ null） */
function firstPrivate(stages: readonly { stage: string; sector?: string }[]): string | null {
  const order = Object.keys(SCHOOL_NAMES);
  const priv = stages.filter((s) => s.sector === "private" && SCHOOL_NAMES[s.stage] !== undefined).sort((a, b) => order.indexOf(a.stage) - order.indexOf(b.stage));
  const school = priv.find((s) => s.stage !== "kindergarten");
  return (school ?? priv[0])?.stage ?? null;
}

/**
 * 子ども・教育の要約: 「2人・大学は私立」「2人・中学から私立 1人」「1人・公立」（私立になる最初の段を書く。前の「私立あり」は既定の型で
 * どの子も同じになり、何も伝えなかった。0041 の追記 2026-11-06）
 */
function educationSummary(h: Household): Summary | null {
  const goals = (h.goals ?? []).filter((g) => g.kind === "education");
  if (goals.length === 0) return null;
  const firsts = goals.map((g) => firstPrivate(g.education?.stages ?? []));
  const order = Object.keys(SCHOOL_NAMES);
  const earliest = firsts.filter((x): x is string => x !== null).sort((a, b) => order.indexOf(a) - order.indexOf(b))[0];
  if (earliest === undefined) return { main: String(goals.length), unit: "人・公立" };
  const n = firsts.filter((x) => x === earliest).length;
  const what = HIGHER.has(earliest) ? `${SCHOOL_NAMES[earliest] ?? ""}は私立` : `${SCHOOL_NAMES[earliest] ?? ""}から私立`;
  return { main: String(goals.length), unit: `人・${what}${goals.length > 1 && n < goals.length ? ` ${n}人` : ""}` };
}

function housingSummary(h: Household): Summary | null {
  const loans = (h.debts ?? []).filter((d) => d.kind === "mortgage");
  if (loans.length > 0) return { pre: "残高 ", main: manText(loans.reduce((s, d) => s + (d.balance?.value ?? d.principal), 0)), unit: "万円" };
  const r = (h.residences ?? [])[0];
  if (r === undefined) return null;
  if (r.kind === "rent" && (r.rent === undefined || r.rent.monthly.state === "notApplicable")) return { main: "家賃なし" };
  if (r.kind === "rent") return { pre: "家賃 月", main: manText(r.rent?.monthly.value ?? 0), unit: "万円" };
  return { main: "持ち家" };
}

/** 介護の費用1件の額（月の費用×か月＋はじめの費用。名目の額。期間を入れていなければ null） */
function careTotal(c: CareExpense): number | null {
  if (c.months === undefined) return null;
  return ((c.serviceMonthly?.value ?? 0) + (c.otherMonthly?.value ?? 0)) * c.months + (c.initial?.value ?? 0);
}

/** 介護の費用1件の月の額 */
const careMonthly = (c: CareExpense): number => (c.serviceMonthly?.value ?? 0) + (c.otherMonthly?.value ?? 0);

/**
 * 介護・親の要約: 「介護 約760万円（母）・親 4人」（介護の費用の総額〔月の費用×か月＋はじめの費用。名目。介護を受ける人の名前〕と、世帯の外の家族の人数）。
 * 期間を入れていない介護があれば総額の代わりに月の額。介護が無ければ仕送り・援助の件数か世帯の外の家族の人数（0041 の追記 2026-11-06）
 */
function careSummary(wh: WorkingHousehold): Summary | null {
  const h = wh.request.input.household;
  const list = h.careExpenses ?? [];
  const outside = outsideMembers(wh);
  const k = outside.length;
  const parents = outside.filter((m) => m.kind === "parent").length;
  const people = k === 0 ? "" : parents === k ? `・親 ${k}人` : `・世帯の外 ${k}人`;
  const rows = moneyRows(h, "care");
  if (list.length === 0 && rows > 0) return { main: String(rows), unit: `件の仕送り・援助${people}` };
  if (list.length > 0) {
    const who = [...new Set(list.map((c) => memberLabel(wh, c.member)))].join("・");
    const totals = list.map(careTotal);
    if (totals.every((t): t is number => t !== null)) return { pre: "介護 約", main: manText(totals.reduce((a, b) => a + b, 0)), unit: `万円（${who}）${people}` };
    return { pre: "介護 月", main: manText(list.reduce((a, c) => a + careMonthly(c), 0)), unit: `万円（${who}）${people}` };
  }
  return k > 0 ? { main: String(k), unit: parents === k ? "人（親）" : "人（世帯の外の家族）" } : null;
}

/** FP顧問料の要約の下の1行（「FP顧問料: 単発30万円＋月1万円（提案の側）」。前提条件の入力項目の札。0041 の追記 2026-11-06） */
export function feeNote(list: readonly AdvisoryFee[]): string | null {
  if (list.length === 0) return null;
  if (list.length > 1) return `FP顧問料: ${list.length}件（提案の側）`;
  const c = list[0] as AdvisoryFee;
  const one = (c.terms?.oneTime ?? []).reduce((s, o) => s + o.amount, 0);
  const r = c.terms?.recurring;
  const parts = [...(one > 0 ? [`単発${manText(one)}万円`] : []), ...(r?.monthly !== undefined ? [`月${manText(r.monthly)}万円`] : r?.annual !== undefined ? [`年${manText(r.annual)}万円`] : [])];
  return parts.length === 0 ? null : `FP顧問料: ${parts.join("＋")}（提案の側）`;
}

function feeSummary(list: AdvisoryFee[]): Summary | null {
  if (list.length === 0) return null;
  if (list.length > 1) return { main: String(list.length), unit: "件" };
  const c = list[0] as AdvisoryFee;
  const r = c.terms?.recurring;
  if (r?.annual !== undefined) return { pre: "年", main: manText(r.annual), unit: "万円" };
  if (r?.monthly !== undefined) return { pre: "月", main: manText(r.monthly), unit: "万円" };
  const one = (c.terms?.oneTime ?? []).reduce((s, o) => s + o.amount, 0);
  return { pre: "単発 ", main: manText(one), unit: "万円" };
}

/** 車のカードの要約: 「1台・維持費 年36万円」（維持費は内訳を年額にならした合計を、全部の車で足す） */
export function carSummary(list: readonly Car[]): Summary | null {
  if (list.length === 0) return null;
  // リース・長期レンタルの月額も、表の行「車の維持費」に入るので維持費に数える（0101）
  const upkeep = list.reduce((s, c) => s + upkeepAnnual(c) + leaseAnnual(c), 0);
  return { main: String(list.length), unit: `台・維持費 年${manText(upkeep)}万円` };
}

function periodicSummary(h: Household, p: PeriodicExpense): Summary {
  const amount = p.amount.value ?? 0;
  const once = p.everyYears === 1 && p.to != null && resolveTimepoint(h, p.to) !== null && resolveTimepoint(h, p.to) === resolveTimepoint(h, p.from);
  if (once) return { main: manText(amount), unit: "万円（1回）" };
  if (p.everyYears === 1) return { pre: "年", main: manText(amount), unit: "万円" };
  return { main: manText(amount), unit: `万円（${p.everyYears}年ごと）` };
}

/** 家族の要約: 世帯の人数（これから加わる人を除く）。世帯の外の家族は「＋親2」のように添える */
function familySummary(wh: WorkingHousehold): Summary {
  const outside = outsideMembers(wh);
  const inside = wh.request.input.household.members.filter((m) => m.expected !== true && !outside.includes(m)).length;
  if (outside.length === 0) return { main: String(inside), unit: "人" };
  const kinds = new Map<string, number>();
  for (const m of outside) {
    const k = m.kind === "parent" ? "親" : m.kind === "grandparent" ? "祖父母" : "ほか";
    kinds.set(k, (kinds.get(k) ?? 0) + 1);
  }
  return { main: String(inside), unit: `人（${[...kinds].map(([k, n]) => `＋${k}${n}`).join("・")}）` };
}

/** カードに属するお金の行の数（出るお金・入るお金。moneyRows.ts の区画。0044）。ライフイベントの出るお金は子の年齢で始まる行を除き、夢プランの夢を足す（0103） */
function moneyRows(h: Household, card: MoneyCard): number {
  const out = card === "events" ? eventExpenses(h).length + dreamRows(h).length : (h.periodicExpenses ?? []).filter((p) => expenseCard(h, p) === card).length;
  return out + (h.incomeFlows ?? []).filter((f) => incomeCard(f) === card).length;
}
const inheritedDebts = (h: Household) => (h.debts ?? []).filter((d) => d.inheritedFrom !== undefined).length;

/** お金の行の額を、1回の分と毎年の分に分けて足す（くり返す行は1回の額。毎月の行は年額にする） */
function lumpAndYearly(h: Household, list: readonly { amount: { value?: number | null }; from: PeriodicExpense["from"]; to?: PeriodicExpense["to"]; everyYears: number; monthly?: boolean }[]): { once: number; yearly: number } {
  let once = 0;
  let yearly = 0;
  for (const p of list) {
    const amount = p.amount.value ?? 0;
    const single = p.to != null && resolveTimepoint(h, p.to) !== null && resolveTimepoint(h, p.to) === resolveTimepoint(h, p.from);
    if (!single && p.everyYears === 1) yearly += p.monthly === true ? amount * 12 : amount;
    else once += amount;
  }
  return { once, yearly };
}

/** 「受け取る予定 3,000万円」「贈与 年110万円」の文の部品（額が0なら null） */
function amountPart(label: string, t: { once: number; yearly: number }): Summary | null {
  if (t.once > 0) return { pre: `${label} `, main: manText(t.once), unit: t.yearly > 0 ? `万円＋年${manText(t.yearly)}万円` : "万円" };
  if (t.yearly > 0) return { pre: `${label} 年`, main: manText(t.yearly), unit: "万円" };
  return null;
}
const partText = (s: Summary): string => `${s.pre ?? ""}${s.main}${s.unit ?? ""}`;

/**
 * 相続・贈与の要約: 入れた中身の額を短く1〜2つ（受け取る予定＝相続・遺贈と受ける贈与の行、贈与＝あげる贈与の行）。
 * 額が無ければ件数（受け継ぐ借入・ほかの項目の援助・贈与する人）。相続税の目安は要約の下の小さな1行（note）にする（0060 の 2026-10-29 の追記）
 */
function inheritanceSummary(wh: WorkingHousehold): Summary | null {
  const h = wh.request.input.household;
  const receive = amountPart("受け取る予定", lumpAndYearly(h, (h.incomeFlows ?? []).filter((f) => incomeCard(f) === "inherit")));
  const give = amountPart("贈与", lumpAndYearly(h, (h.periodicExpenses ?? []).filter((p) => expenseCard(h, p) === "inherit")));
  const first = receive ?? give;
  if (first !== null) return receive !== null && give !== null ? { ...first, unit: `${first.unit ?? ""}・${partText(give)}` } : first;
  const rows = moneyRows(h, "inherit") + inheritedDebts(h);
  if (rows > 0) return { main: String(rows), unit: "件（受け取る予定・あげる贈与）" };
  const g = giftLines(wh);
  const n = g.receive.length + g.give.length;
  if (n > 0) return { main: String(n), unit: "件の援助" };
  const d = (h.donors ?? []).length;
  return d > 0 ? { main: String(d), unit: "人（贈与する人）" } : null;
}

function baseSummary(id: StageId, wh: WorkingHousehold, inheritanceTax: string | null | undefined, pension?: Summary | null): Summary | null {
  const h = wh.request.input.household;
  switch (id) {
    case "family":
      return familySummary(wh);
    case "work":
      return workSummary(h, wh.request.input.baseMonth);
    case "retirement": {
      const list = h.retirementBenefits ?? [];
      if (list.length === 0) return null;
      const total = list.reduce((s, b) => s + (b.amount?.value ?? 0), 0);
      return total > 0 ? { pre: "見込み ", main: manText(total), unit: "万円" } : { main: String(list.length), unit: "件" };
    }
    case "pension":
      return pension ?? pensionSummary(h);
    case "living":
      return livingSummary(h);
    case "education":
      return educationSummary(h);
    case "housing":
      return housingSummary(h);
    case "insurance": {
      const n = (h.insuranceContracts ?? []).length;
      return n === 0 ? null : { main: String(n), unit: "件" };
    }
    case "savings": {
      const list = h.accounts ?? [];
      // 金融資産は入れ方のとおりに数える（合計の入れ方で残した口座の値・まだ分けていない分を二重に足さない）＋不動産・その他の資産
      // （貸している不動産は収益不動産のカードで数える。0079）
      const own = list.filter((a) => !isRentalProperty(a));
      const others = own.filter((a) => a.kind === "realEstate" || a.kind === "otherAsset").reduce((s, a) => s + (a.marketValue?.value ?? 0), 0);
      // 不動産・その他の資産を入れていれば、そのうちの額を下の小さな1行に（0120。入れていなければ出さない）
      return own.length === 0 ? null : { main: manText(totalViewOf(wh.request).value + others), unit: "万円", ...(others > 0 ? { note: `うち不動産・その他の資産 ${manText(others)}万円` } : {}) };
    }
    case "rental": {
      const list = rentalProperties(h);
      if (list.length === 0) return moneyRows(h, "rental") > 0 ? { main: String(moneyRows(h, "rental")), unit: "件（一時の経費）" } : null;
      return { main: String(list.length), unit: `件・評価額 ${manText(list.reduce((s, a) => s + (a.marketValue?.value ?? 0), 0))}万円` };
    }
    case "events": {
      const n = moneyRows(h, "events");
      return n === 0 ? null : { main: String(n), unit: "件" };
    }
    case "car": {
      const s = carSummary(h.cars ?? []);
      if (s !== null) return s;
      const n = moneyRows(h, "car") + carDebts(h).length;
      return n === 0 ? null : { main: String(n), unit: "件" };
    }
    case "care":
      return careSummary(wh);
    case "inheritance": {
      // 主な表示は入れた中身。相続税の目安（計算の結果から読むだけ。InputView が渡す）は、入れた中身があるときだけ下の小さな1行に出す
      const s = inheritanceSummary(wh);
      return s !== null && inheritanceTax != null ? { ...s, note: inheritanceTax } : s;
    }
    case "fee":
      return feeSummary(h.advisoryFees ?? []);
    case "assumptions": {
      // 「物価 1.0%・運用 1.0%」（結果に一番効く運用利回りも出す）。FP顧問料の契約があれば下の小さな1行（0041 の追記 2026-11-06）
      const a = wh.request.input.assumptions;
      const inf = a?.inflation?.default;
      const ret = a?.investmentReturn?.default;
      const pct = (v: string) => (Number(v) * 100).toFixed(1);
      const fee = feeNote(h.advisoryFees ?? []);
      const note = fee !== null ? { note: fee } : {};
      if (inf !== undefined) return { pre: "物価 ", main: pct(inf), unit: ret !== undefined ? `%・運用 ${pct(ret)}%` : "%", ...note };
      return ret === undefined ? { main: "既定の値", ...note } : { pre: "運用 ", main: pct(ret), unit: "%", ...note };
    }
  }
}

/** 項目に物（入れた値）があるか。無くても、FP が保存するか「当てはまらない」を押せば「当てはまらない」になる */
function baseHasData(id: StageId, wh: WorkingHousehold): boolean {
  const h = wh.request.input.household;
  switch (id) {
    case "family":
      return h.members.length > 0;
    case "work":
      return adults(h).some((m) => (h.employmentPeriods ?? []).some((p) => p.member === m.id));
    case "retirement":
      return (h.retirementBenefits ?? []).length > 0;
    case "pension":
      return (h.pensionRecords ?? []).length > 0;
    case "living":
      return (h.livingExpenses ?? []).length > 0;
    case "education":
      return (h.goals ?? []).some((g) => g.kind === "education") || (h.periodicExpenses ?? []).some((p) => childOfPeriodic(h, p) !== null);
    case "housing":
      return (h.residences ?? []).length > 0 || (h.debts ?? []).some((d) => d.kind === "mortgage");
    case "insurance":
      return (h.insuranceContracts ?? []).length > 0;
    case "savings":
      return (h.accounts ?? []).some((a) => !isRentalProperty(a));
    case "rental":
      return rentalProperties(h).length > 0 || moneyRows(h, "rental") > 0;
    case "events":
      return moneyRows(h, "events") > 0;
    case "car":
      // 車・車のカードのお金の行（カーシェアなど）・今返している自動車ローン（0069）
      return (h.cars ?? []).length > 0 || moneyRows(h, "car") > 0 || carDebts(h).length > 0;
    case "care":
      return (h.careExpenses ?? []).length > 0 || outsideMembers(wh).length > 0 || moneyRows(h, "care") > 0;
    case "inheritance": {
      const g = giftLines(wh);
      return g.receive.length + g.give.length > 0 || (h.donors ?? []).length > 0 || moneyRows(h, "inherit") + inheritedDebts(h) > 0;
    }
    case "fee":
      return (h.advisoryFees ?? []).length > 0;
    case "assumptions":
      // 前提条件は計算に必ず要るので、既定の値（事務所の標準値ができるまでの仮の値）が入っている
      return wh.request.input.assumptions !== undefined;
  }
}

/** 物の単位で推定している数（年金の記録が無い人は、働き方の期間から推計している） */
function implicitEstimates(id: StageId, wh: WorkingHousehold): number {
  if (id !== "pension") return 0;
  const h = wh.request.input.household;
  return earners(h).filter((m) => !(h.pensionRecords ?? []).some((r) => r.member === m.id)).length;
}

/** 「無い」と決めてある（物が無くても、無いことを入れてある）: 子がいない・どの子も教育費なし、どの人も退職金の制度が無い */
function declaredNone(id: StageId, wh: WorkingHousehold): boolean {
  const h = wh.request.input.household;
  if (id === "education") {
    const kids = h.members.filter((m) => m.kind === "child");
    if (kids.length === 0) return (h.periodicExpenses ?? []).every((p) => childOfPeriodic(h, p) === null);
    const input = wh.request.input as unknown as Record<string, unknown>;
    return kids.every((c) => {
      const g = (h.goals ?? []).find((x) => x.kind === "education" && x.owner === c.id);
      return g !== undefined && (g.education?.stages ?? []).length === 0 && rowAt(input, educationStagesAddress(g.id))?.state === "notApplicable";
    });
  }
  if (id === "retirement") {
    if ((h.retirementBenefits ?? []).length > 0) return false;
    const base = wh.request.input.baseMonth;
    const working = adults(h).filter((m) => currentPeriod(h, m.id, base) !== undefined);
    return working.length > 0 && working.every((m) => retirementNotApplicable(wh, m.id));
  }
  return false;
}

/** 欄に FP が入れた印があるか: 出どころが自動（推定）でない値の箱か、値の状態の行（確定・書類待ち・該当なし・承認など） */
function touchedField(f: FieldDef, wh: WorkingHousehold, a: ReturnType<typeof fieldAddress>): boolean {
  const own = (v: unknown) => isRow(v) && v.origin.kind !== "auto";
  if (f.boxed !== undefined) return own(f.boxed.read(wh));
  return a !== null && own(rowAt(wh.request.input as unknown as Record<string, unknown>, a));
}

/** カードの欄の数（推定・書類待ち／未入力と、FP が入れた印のある欄）。同じ値を見せる欄（同じ当て先）は1つに数え、見せるだけの欄は数えない */
function fieldCounts(stage: StageDef, wh: WorkingHousehold): { estimated: number; missing: number; touched: number; names: string[] } {
  let estimated = 0;
  let missing = 0;
  let touched = 0;
  const names: string[] = [];
  const seen = new Set<string>();
  for (const f of allFields(stage)) {
    if (f.readOnly !== undefined) continue;
    const a = fieldAddress(f, wh);
    const k = a !== null ? JSON.stringify(a) : `key:${f.key}`;
    if (seen.has(k)) continue;
    seen.add(k);
    const fs = fieldStatus(f, wh);
    const s = fs.status;
    if (s === "missing") missing++;
    else if (((s === "estimated" && f.quietEstimate === undefined) || s === "unknown") && !endedLongAgo(wh, holderOfField(f, wh))) {
      // ずっと前に終わった物（働き方の前の期間など）の推定は数えない（結果に効かない。確かめの一覧と同じ）
      estimated++;
      const name = fs.provisional === true ? `仮の値: ${f.label}` : f.label;
      if (!names.includes(name)) names.push(name);
    }
    if (touchedField(f, wh, a)) touched++;
  }
  return { estimated, missing, touched, names };
}

/**
 * 入れ始めた項目か（世帯ファイルの今の情報だけで決める。形は変えない）: 項目に属する物がある・FP が保存したか「当てはまらない」を押した
 * （保存した項目の印 confirmed）・無いと決めてある・欄に FP が入れた印（確定・書類待ち・該当なしの行など）がある・0円で計算している欄がある（欄は物の上にある）。
 * どれでもない項目は「まだ入れていない」で、入っていない物があっても赤い知らせを出さない（確かめの一覧では「まだ入れていない項目」にまとめる）
 */
export function startedOf(c: { hasData: boolean; confirmed: boolean; none: boolean; touched: number; fieldMissing: number }): boolean {
  return c.hasData || c.confirmed || c.none || c.touched > 0 || c.fieldMissing > 0;
}

/**
 * カードの状態（4つと、まだ入れていない）:
 * 0. まだ入れていない: 入れ始める前（startedOf が偽。started を渡したときだけ）で、下の 1 に当たるとき
 * 1. 未入力（0円の所あり）: 0円で計算している欄か、入っていない物がある。物が無く「当てはまらない」も決めていないときも
 * 2. 推定で計算中: 推定・書類待ち（代わりの値）・仮の値の欄がある（前提条件の標準の値は数えない）。前提条件は、既定の値のままなら「既定の値で計算中」（std）
 * 3. 当てはまらない: 無いと決めてある（子がいない・退職金の制度が無いなど）か、物が無くて FP が保存した・「当てはまらない」を押した
 * 4. 入力済み: 物があり、上のどれでもない
 */
export function statusOf(c: { estimated: number; missing: number; hasData: boolean; confirmed: boolean; none: boolean; countEstimates?: boolean; started?: boolean; standard?: boolean }): ItemStatus {
  const gap: ItemStatus = c.started === false ? "empty" : "missing";
  if (c.missing > 0) return gap;
  // 前提条件: 既定の値のまま（前提を1つも打っていない・「この値にする」を押していない）なら「既定の値で計算中」（0041 の追記 2026-11-06）
  if (c.standard === true && c.hasData) return "std";
  if (c.estimated > 0 && c.countEstimates !== false) return "est";
  if (c.none) return "na";
  if (c.hasData) return "done";
  return c.confirmed ? "na" : gap;
}

// ---- ピン ----

type AddedObject = { kind: "periodic"; obj: PeriodicExpense } | { kind: "care"; obj: CareExpense } | { kind: "car"; obj: Car } | { kind: "fee"; obj: AdvisoryFee };

function addedObject(h: Household, a: Pick<AddedItem, "kind" | "ref">): AddedObject | null {
  const find = <T extends { id: string }>(list: readonly T[] | undefined) => (list ?? []).find((x) => x.id === a.ref);
  switch (a.kind) {
    case "periodic": {
      const obj = find(h.periodicExpenses);
      return obj === undefined ? null : { kind: "periodic", obj };
    }
    case "care": {
      const obj = find(h.careExpenses);
      return obj === undefined ? null : { kind: "care", obj };
    }
    case "car": {
      const obj = find(h.cars);
      return obj === undefined ? null : { kind: "car", obj };
    }
    case "fee": {
      const obj = find(h.advisoryFees);
      return obj === undefined ? null : { kind: "fee", obj };
    }
  }
}

/** お金の行の区画のカード → 段階の ID */
const MONEY_STAGE: Readonly<Record<MoneyCard, StageId>> = { family: "family", work: "work", pension: "pension", living: "living", education: "education", housing: "housing", insurance: "insurance", rental: "rental", events: "events", car: "car", care: "care", inherit: "inheritance", savings: "savings" };

/** 物が属するカード（ふつうはライフイベント。種類のあるお金の行はその種類のカード、介護は介護・親、子の年齢で始まる支出は子ども・教育、車は車、FP顧問料は前提条件） */
function ownerOf(h: Household, a: Pick<AddedItem, "kind" | "ref">): StageId {
  switch (a.kind) {
    case "periodic": {
      const p = (h.periodicExpenses ?? []).find((x) => x.id === a.ref);
      if (p === undefined) return "events";
      return childOfPeriodic(h, p) !== null ? "education" : MONEY_STAGE[expenseCard(h, p)];
    }
    case "care":
      return "care";
    case "car":
      return "car";
    case "fee":
      return "assumptions";
  }
}

/** 物のまとまりのキー（段階の定義の、その物のまとまり。stages/events.ts・cars.ts・fees.ts） */
const groupPrefix = (a: Pick<AddedItem, "kind" | "ref">): string => (a.kind === "periodic" ? `ev/${a.ref}` : `ev/${a.kind}/${a.ref}`);

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const PIN_GROUPS: readonly { re: RegExp; kind: AddedItem["kind"]; art: AddedItem["art"] }[] = [
  { re: new RegExp(`^ev/care/(${UUID})$`), kind: "care", art: "events" },
  { re: new RegExp(`^ev/car/(${UUID})$`), kind: "car", art: "car" },
  { re: new RegExp(`^ev/fee/(${UUID})$`), kind: "fee", art: "fee" },
  { re: new RegExp(`^ev/(${UUID})$`), kind: "periodic", art: "events" },
];

/** ホームに出せる物のまとまりなら、そのピンの中身（「📌 ホームに出す」。世帯ファイルの足したカードの種類にある物だけ） */
export function pinOfGroup(groupKey: string): { kind: AddedItem["kind"]; ref: string; art: AddedItem["art"] } | null {
  for (const p of PIN_GROUPS) {
    const m = p.re.exec(groupKey);
    if (m !== null) return { kind: p.kind, ref: m[1] as string, art: p.art };
  }
  return null;
}

export const isPinned = (wh: WorkingHousehold, ref: string): boolean => wh.addedItems.some((a) => a.ref === ref);

/** ピンを出す・外す（外しても物は残る。物を外すのは物の所で） */
export function togglePin(wh: WorkingHousehold, pin: { kind: AddedItem["kind"]; ref: string; art: AddedItem["art"] }, id: () => string = newId): WorkingHousehold {
  if (!isPinned(wh, pin.ref)) return { ...wh, addedItems: [...wh.addedItems, { id: `added:${id()}`, kind: pin.kind, ref: pin.ref, art: pin.art }] };
  const gone = new Set(wh.addedItems.filter((a) => a.ref === pin.ref).map((a) => a.id));
  return { ...wh, addedItems: wh.addedItems.filter((a) => !gone.has(a.id)), confirmed: wh.confirmed.filter((c) => !gone.has(c)) };
}

function addedLabel(wh: WorkingHousehold, o: AddedObject): string {
  switch (o.kind) {
    case "periodic":
      return o.obj.label !== undefined && o.obj.label !== "" ? o.obj.label : "名前のない支出";
    case "care":
      // パネルの見出し（「母の介護（在宅）」）と同じ呼び方（0041 の追記 2026-11-06）
      return `${memberLabel(wh, o.obj.member)}の介護`;
    case "car":
      return `車（${memberLabel(wh, o.obj.owner)}）`;
    case "fee":
      return "FP顧問料";
  }
}

function addedSummary(h: Household, o: AddedObject): Summary | null {
  switch (o.kind) {
    case "periodic":
      return periodicSummary(h, o.obj);
    case "care": {
      // 「月13.8万円・55か月」（月の額と期間）
      const m = careMonthly(o.obj);
      return o.obj.months !== undefined ? { pre: "月", main: manText(m), unit: `万円・${o.obj.months}か月` } : { pre: "月", main: manText(m), unit: "万円・期間は目安" };
    }
    case "car":
      return carSummary([o.obj]);
    case "fee":
      return feeSummary([o.obj]);
  }
}

/** ピンのパネルの中身: 物が属するカードの、その物のまとまりだけ。物を外した後は空 */
function pinStage(wh: WorkingHousehold, a: AddedItem): StageDef {
  const h = wh.request.input.household;
  const o = addedObject(h, a);
  const owner = buildStage(ownerOf(h, a), wh);
  const prefix = groupPrefix(a);
  const label = o === null ? "外した項目" : addedLabel(wh, o);
  const sections: SectionDef[] =
    o === null
      ? [{ key: `added/${a.id}`, title: label, note: "この項目の物を外しました。保存すると、ピンがなくなります", level: "simple", groups: [], actions: [] }]
      : owner.sections
          .map(({ note: _note, ...s }): SectionDef => ({ ...s, groups: s.groups.filter((g) => g.key === prefix || g.key.startsWith(`${prefix}/`)), actions: [] }))
          .filter((s) => s.groups.length > 0);
  const where = STAGE_ORDER.find((s) => s.id === owner.id)?.label ?? owner.label;
  return { id: owner.id, label, lead: `ホームに出した物です（物は「${where}」の項目にあります）。`, sections };
}

/** ピン1つ（物を外した後も、パネルを閉じるまでは「外した項目」として返す） */
function pinItem(wh: WorkingHousehold, a: AddedItem, base: WorkingHousehold | undefined): PinItem {
  const h = wh.request.input.household;
  const o = addedObject(h, a);
  const stage = pinStage(wh, a);
  const c = fieldCounts(stage, wh);
  return {
    id: a.id,
    label: stage.label,
    lead: stage.lead,
    group: BASE[stage.id].group,
    color: ART_COLOR[a.art],
    art: a.art,
    added: a,
    owner: stage.id,
    planOnly: base !== undefined && o !== null && addedObject(base.request.input.household, a) === null,
    status: statusOf({ ...c, hasData: o !== null, confirmed: false, none: false }),
    estimated: c.estimated,
    missing: c.missing,
    summary: o === null ? null : addedSummary(h, o),
    hint: null,
    canNa: false,
    canFill: false,
    entered: o !== null,
    hidden: false,
  };
}

/**
 * ホームのピン（物がある物だけ。並びは出した順。同じ物のピンは1つ）。プランの編集中は、そのプランの中身（wh）で見るので、
 * そのプランで足した物のピンも出る（base に現状を渡すと planOnly の印が付く）
 */
export function pinItems(wh: WorkingHousehold, base?: WorkingHousehold): PinItem[] {
  const h = wh.request.input.household;
  const seen = new Set<string>();
  const out: PinItem[] = [];
  for (const a of wh.addedItems) {
    if (seen.has(a.ref) || addedObject(h, a) === null) continue;
    seen.add(a.ref);
    out.push(pinItem(wh, a, base));
  }
  return out;
}

// ---- カードの一覧 ----

/** カードの中身（パネルで開く欄の定義）。ピンはその物のまとまりだけ */
export function itemStage(wh: WorkingHousehold, id: string): StageDef | null {
  if (id.startsWith("added:")) {
    const a = wh.addedItems.find((x) => x.id === id);
    return a === undefined ? null : pinStage(wh, a);
  }
  return STAGE_ORDER.some((s) => s.id === id) ? buildStage(id as StageId, wh) : null;
}

export interface ItemOptions {
  layout?: CardLayout;
  /** 相続・贈与の入力項目の要約の下の小さな1行（相続税の目安。計算の結果から。inheritanceLine.ts） */
  inheritanceTax?: string | null;
  /** 年金のカードの要約（夫婦の合計の月額。65歳から・推定。計算の結果から。pensionEstimate.ts） */
  pension?: Summary | null;
}

/**
 * 前提条件が既定の値のままか: 前提の欄（前提条件の標準の値の欄。表の最後の年の決め方・年齢の欄・読むだけの欄を除く）に、FP が打った値・「この値にする」で
 * 確定にした値が1つも無い（0041 の追記 2026-11-06）。既定のままなら札は「既定の値で計算中」、1つでも入れれば「入力済み」
 */
export function premiseUntouched(stage: StageDef, wh: WorkingHousehold): boolean {
  return !allFields(stage).some((f) => {
    if (!isPremiseField(f) || f.readOnly !== undefined || f.key === "assume/endYear/choice" || f.key.startsWith("assume/endYear/age/")) return false;
    return fieldStatus(f, wh).status === "confirmed" && f.get(wh).implicit !== true;
  });
}

/** 「推定で計算中」の札の吹き出しに並べる欄の数（多ければ「ほか○か所」） */
export const EST_TIP_MAX = 5;

/**
 * 「推定で計算中」の札にカーソルを合わせる・フォーカスする・押すと出す、推定のままの欄の名前の短い一覧（0041 の追記 2026-11-06。
 * 札の下に1行を足す形はやめた〔カードがごちゃごちゃするため。利用者の判断〕）。名前の後ろの括弧の注は省く。名前が無ければ null
 */
export function estimatedList(names: readonly string[], count: number): { names: string[]; rest: number } | null {
  if (names.length === 0) return null;
  const shown = [...new Set(names.map((n) => n.replace(/（.*$/, "")))].slice(0, EST_TIP_MAX);
  return { names: shown, rest: Math.max(0, count - shown.length) };
}

/** カードの入っていない物（確かめの一覧のいちばん上と同じ） */
const gapsFor = (gaps: readonly Gap[], id: string) => gaps.filter((g) => g.card === id);

/** 入力のホームの15枚のカード（ピンは pinItems） */
export function inputItems(wh: WorkingHousehold, opts: ItemOptions = {}): InputItem[] {
  const layout = opts.layout ?? DEFAULT_LAYOUT;
  const confirmed = new Set(wh.confirmed);
  const gaps = gapsOf(wh);
  const labels = new Map(STAGE_ORDER.map((s) => [s.id, s.label]));
  return cardOrder(layout).map((id) => {
    const stage = buildStage(id, wh);
    const c = fieldCounts(stage, wh);
    const own = gapsFor(gaps, id);
    const estimated = c.estimated + implicitEstimates(id, wh);
    const missing = c.missing + own.length;
    const hasData = baseHasData(id, wh);
    const none = declaredNone(id, wh);
    const started = startedOf({ hasData, confirmed: confirmed.has(id), none, touched: c.touched, fieldMissing: c.missing });
    const status = statusOf({ estimated, missing, hasData, confirmed: confirmed.has(id), none, countEstimates: id !== "assumptions", started, ...(id === "assumptions" ? { standard: premiseUntouched(stage, wh) } : {}) });
    // 未入力とまだ入れていない項目は、同じ1行の案内と1押し（まだ入れていない項目は、赤くしない控えめな見せ方で）。どの項目も同じ決まり。
    // 何が推定かは「推定で計算中」の札の吹き出し（estimatedNames。InputView.tsx）
    const open = status === "missing" || status === "empty";
    const hint = !open && status !== "est" ? null : status === "est" ? (HINTS[id]?.est ?? HINT_EST) : hasData && c.missing > 0 ? HINT_ZERO : (HINTS[id]?.missing ?? HINT_ZERO);
    const canNa = open && !NO_NA.has(id) && (!hasData || (c.missing === 0 && own.every((g) => g.none !== undefined)));
    const def = BASE[id];
    return {
      id,
      label: labels.get(id) ?? stage.label,
      lead: stage.lead,
      group: def.group,
      color: def.color,
      art: id,
      added: null,
      status,
      estimated,
      estimatedNames: c.names,
      missing,
      summary: baseSummary(id, wh, opts.inheritanceTax, opts.pension),
      hint,
      canNa,
      canFill: open && own.some((g) => g.fill !== undefined),
      entered: hasData || c.touched > 0,
      hidden: isHiddenIn(wh.itemChoice, id) && !ALWAYS_SHOWN.includes(id) && !(hasData || c.touched > 0),
    };
  });
}

/** 入力のホームに出す入力項目（非表示の項目を除く。値が入っている項目は非表示にしてあっても出す） */
export const shownItems = (items: readonly InputItem[]): InputItem[] => items.filter((i) => !i.hidden);

/** カード（15枚）かピンの1つ（パネルの見出し・状態に使う） */
export function itemOf(wh: WorkingHousehold, id: string, opts: ItemOptions = {}): InputItem | null {
  if (id.startsWith("added:")) {
    const a = wh.addedItems.find((x) => x.id === id);
    return a === undefined ? null : pinItem(wh, a, undefined);
  }
  return inputItems(wh, opts).find((i) => i.id === id) ?? null;
}

/** 見出しで区切った並び（見出しを出すかは項目の数で決める）。見出しを出さないときは1つのまとまり */
export function groupedItems(items: InputItem[]): { group: (typeof ITEM_GROUPS)[number] | null; items: InputItem[] }[] {
  if (items.length < GROUP_HEADINGS_FROM) return [{ group: null, items }];
  return ITEM_GROUPS.map((g) => ({ group: g, items: items.filter((i) => i.group === g.id) })).filter((x) => x.items.length > 0);
}

export interface Progress {
  total: number;
  done: number;
  est: number;
  missing: number;
  na: number;
  /** まだ入れていない（赤い数には入れない） */
  empty: number;
  /** 既定の値で計算中（前提条件の入力項目だけ） */
  std: number;
}

/** 進み具合: 「15項目中 入力済み○・推定で計算中○・当てはまらない○・まだ入れていない○」と、未入力（0円の所あり）の数（ピンは数えない） */
export function progressOf(items: readonly InputItem[]): Progress {
  const cards = items.filter((i) => i.added === null);
  const n = (s: ItemStatus) => cards.filter((i) => i.status === s).length;
  return { total: cards.length, done: n("done"), est: n("est"), missing: n("missing"), na: n("na"), empty: n("empty"), std: n("std") };
}

/**
 * 項目がまだ何も入っていない新しい世帯か（入力のホームにも「取り込む」の入口を出すとき）。
 * 保存した項目が無く、前提条件（事務所の標準で始まる）のほかに入力済みの項目が無く、足した物も無い。推定・既定の値だけのカードは「入っていない」と読む
 */
export function nothingEnteredYet(wh: WorkingHousehold, items: readonly InputItem[]): boolean {
  return wh.confirmed.length === 0 && wh.addedItems.length === 0 && items.every((i) => i.id === "assumptions" || (i.status !== "done" && i.status !== "std"));
}

/** カードを「当てはまらない」にする（1押し）: そのカードの入っていない物を「該当なし」にし、保存した項目の印を付ける（物の無いカードは当てはまらないと読む） */
export function notApplicableCard(wh: WorkingHousehold, id: string): WorkingHousehold {
  let w = wh;
  for (const g of gapsFor(gapsOf(wh), id)) if (g.none !== undefined) w = g.none(w);
  return w.confirmed.includes(id) ? w : { ...w, confirmed: [...w.confirmed, id] };
}

/** カードを「目安で入れる」（1押し）: そのカードの入っていない物を推定で埋める */
export const fillCard = (wh: WorkingHousehold, id: string): WorkingHousehold => fillAll(wh, id).wh;

/**
 * 保存: その項目を「保存した」印に足し（ピンは足さない）、物を外したピンは一覧から外す（プランで足した物のピンは残す）。
 * 古い世帯を開いただけでは呼ばない（保存したときだけ）
 */
export function saveItem(wh: WorkingHousehold, id: string): WorkingHousehold {
  const h = wh.request.input.household;
  // プランで足した物のピン（現状には物が無い）は残す（0036 の8）
  const inPlans = new Set(wh.proposals.flatMap((p) => p.diffs.map((d) => (d.op === "add" && typeof d.value === "object" && d.value !== null ? (d.value as { id?: unknown }).id : undefined))));
  const addedItems = wh.addedItems.filter((a) => addedObject(h, a) !== null || inPlans.has(a.ref));
  const alive = new Set([...STAGE_ORDER.map((s) => s.id as string), ...addedItems.map((a) => a.id)]);
  const mark = id.startsWith("added:") ? [] : [id];
  const confirmed = [...new Set([...wh.confirmed, ...mark])].filter((x) => alive.has(x));
  return { ...wh, addedItems, confirmed };
}
