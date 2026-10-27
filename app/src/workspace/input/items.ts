// 入力のホームの項目（作業の層）: 14の項目のカードと、FP がホームに出した物のピン。
// - カードに出すのは「イラスト＋名前＋要約の数字1つ＋状態」まで。状態は4つ（入力済み・推定で計算中・未入力〔0円の所あり〕・当てはまらない）で、
//   欄の値の状態（valueState.ts。0041）と入っていない物（fill.ts の gapsOf。確かめの一覧のいちばん上と同じ）から決め、色だけに頼らずに見せる（InputView.tsx）
// - 1つの物は1つのカードにだけ出す（ほかのカードは読むだけの1行。readLines.ts）。どのカードに出すかは段階の定義（stages/）が決める
// - ピン: 「＋ 項目を追加」で足した物と、まとまりの「📌 ホームに出す」で出した物（addedItems。世帯ファイルの形は今のまま、意味だけを変えた。0045）。
//   物は種類が属するカードにも出る。ピンを押すと、その物のまとまりだけを開く。進み具合には数えない。プランで足した物のピンは、そのプランの編集中だけ出る
// FP顧問料は「前提条件」のカードの中の欄のまとまり（stages/assumptions.ts）。車は「車」のカードの中で1台ずつ足す（stages/cars.ts）
import type { AdvisoryFee, Car, CareExpense, Household, Member, PeriodicExpense } from "../../engine/types.ts";
import { addMonths, ageAt, ageReachedMonth } from "../levers.ts";
import { resolveTimepoint } from "../timepoint.ts";
import { allFields, type SectionDef, type StageDef, type StageId } from "./form.ts";
import { educationStagesAddress, fillAll, gapsOf, retirementNotApplicable, type Gap } from "./fill.ts";
import { mutate, newId, standardBox, type AddedItem, type WorkingHousehold } from "./household.ts";
import { earners, memberLabel } from "./labels.ts";
import { rowAt } from "./rows.ts";
import { carDebts, upkeepAnnual } from "./stages/cars.ts";
import { outsideMembers } from "./stages/care.ts";
import { expenseCard, incomeCard, type MoneyCard } from "./moneyRows.ts";
import { childOfPeriodic, eventExpenses } from "./stages/events.ts";
import { buildStage, STAGE_ORDER } from "./stages/index.ts";
import { giftLines } from "./stages/inheritance.ts";
import { statementMonthsMissing } from "./stages/pension.ts";
import { totalViewOf } from "./savings/model.ts";
import { currentPeriod } from "./stages/work.ts";
import { fieldAddress, fieldStatus } from "./valueState.ts";

/** カードの状態: 入力済み・推定で計算中・未入力（0円の所あり）・当てはまらない */
export type ItemStatus = "done" | "est" | "missing" | "na";

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
}

export interface InputItem {
  /** カードの ID: 14の項目は段階の ID（family など）、ピンは `added:` で始まる */
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
  /** 推定・わからない（代わりの値）の欄の数 */
  estimated: number;
  /** 未入力（0円で計算中）の欄と、入っていない物の数 */
  missing: number;
  summary: Summary | null;
  /** ざっくり派の最初の5枚の1枚 */
  first: boolean;
  /** 最初の5枚のほかのカードの1行の案内（例: 「入れなくても計算できます（保障は無しで計算中）」）。案内の要らない状態なら null */
  hint: string | null;
  /** カードの上の「当てはまらない」の1押しで抜けられる */
  canNa: boolean;
  /** カードの上の「目安で入れる」の1押しで抜けられる（入っていない物を推定で埋められる） */
  canFill: boolean;
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

/** カードの並びと最初の5枚（事務所の設定で変えられる形。保存の場所は事務所の設定を作る回に決める） */
export interface CardLayout {
  order: readonly StageId[];
  first: readonly StageId[];
}

export const DEFAULT_LAYOUT: CardLayout = { order: STAGE_ORDER.map((s) => s.id), first: ["family", "work", "living", "savings", "housing"] };

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
  events: { group: "flows", color: "#BE5A86" },
  car: { group: "flows", color: "#5C7895" },
  care: { group: "flows", color: "#A86A50" },
  inheritance: { group: "assets", color: "#7E8A3A" },
  fee: { group: "flows", color: "#7E8A3A" },
  assumptions: { group: "premise", color: "#8A7560" },
};

const ART_COLOR: Record<AddedItem["art"], string> = { pet: "#B0704E", abroad: "#4F8FA6", events: BASE.events.color, car: BASE.car.color, fee: BASE.fee.color };

/**
 * 最初の5枚のほかのカードの1行の案内（未入力のとき: 何で計算しているか。推定で計算中のとき: 何の推定か）。
 * カードの上に出す。物があって0円の欄があるときは、共通の文
 */
const HINTS: Partial<Record<StageId, { missing?: string; est?: string }>> = {
  retirement: { missing: "入れなくても計算できます（退職金は無しで計算中）", est: "目安の退職金で計算中です" },
  pension: { est: "働き方の期間から推計して計算中です" },
  education: { missing: "入れなくても計算できます（教育費は無しで計算中）", est: "標準の進路の型で計算中です" },
  insurance: { missing: "入れなくても計算できます（保障は無しで計算中）" },
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

function workSummary(h: Household, baseMonth: string): Summary | null {
  let total = 0;
  let any = false;
  for (const m of adults(h)) {
    const p = currentPeriod(h, m.id, baseMonth);
    if (p === undefined) continue;
    any = true;
    total += (p.salary?.annual.value ?? 0) + (p.salary?.bonus?.value ?? 0) + (p.business?.income.value ?? 0);
  }
  if (!any) return null;
  return total > 0 ? { pre: "年収 ", main: manText(total), unit: "万円" } : { main: "収入なし" };
}

function livingSummary(h: Household): Summary | null {
  const l = (h.livingExpenses ?? [])[0];
  if (l === undefined) return null;
  const monthly = l.mode === "total" ? (l.monthly?.value ?? 0) : (l.categories ?? []).reduce((s, c) => s + (c.monthly.value ?? 0), 0);
  return { pre: "月", main: manText(monthly), unit: "万円" };
}

function educationSummary(h: Household): Summary | null {
  const goals = (h.goals ?? []).filter((g) => g.kind === "education");
  if (goals.length === 0) return null;
  const priv = goals.some((g) => (g.education?.stages ?? []).some((s) => s.sector === "private"));
  return { main: String(goals.length), unit: `人・${priv ? "私立あり" : "公立"}` };
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
  const upkeep = list.reduce((s, c) => s + upkeepAnnual(c), 0);
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

/** カードに属するお金の行の数（出るお金・入るお金。moneyRows.ts の区画。0044）。ライフイベントの出るお金は子の年齢で始まる行を除く */
function moneyRows(h: Household, card: MoneyCard): number {
  const out = card === "events" ? eventExpenses(h).length : (h.periodicExpenses ?? []).filter((p) => expenseCard(h, p) === card).length;
  return out + (h.incomeFlows ?? []).filter((f) => incomeCard(f) === card).length;
}
const inheritedDebts = (h: Household) => (h.debts ?? []).filter((d) => d.inheritedFrom !== undefined).length;

function baseSummary(id: StageId, wh: WorkingHousehold, inheritance: Summary | null | undefined, pension?: Summary | null): Summary | null {
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
      const others = list.filter((a) => a.kind === "realEstate" || a.kind === "otherAsset").reduce((s, a) => s + (a.marketValue?.value ?? 0), 0);
      return list.length === 0 ? null : { main: manText(totalViewOf(wh.request).value + others), unit: "万円" };
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
    case "care": {
      const n = (h.careExpenses ?? []).length;
      const k = outsideMembers(wh).length;
      const rows = moneyRows(h, "care");
      if (n === 0 && rows > 0) return { main: String(rows), unit: "件の仕送り・援助" };
      if (n > 0) return { main: String(n), unit: `件の介護${k > 0 ? `・世帯の外 ${k}人` : ""}` };
      return k > 0 ? { main: String(k), unit: "人（世帯の外の家族）" } : null;
    }
    case "inheritance": {
      // 相続税の目安（計算の結果から読むだけ。InputView が渡す）を先に出す
      if (inheritance != null) return inheritance;
      const rows = moneyRows(h, "inherit") + inheritedDebts(h);
      if (rows > 0) return { main: String(rows), unit: "件（受け取る予定・あげる贈与）" };
      const g = giftLines(wh);
      const n = g.receive.length + g.give.length;
      if (n > 0) return { main: String(n), unit: "件の援助" };
      const d = (h.donors ?? []).length;
      return d > 0 ? { main: String(d), unit: "人（贈与する人）" } : null;
    }
    case "fee":
      return feeSummary(h.advisoryFees ?? []);
    case "assumptions": {
      const a = wh.request.input.assumptions;
      const inf = a?.inflation?.default;
      if (inf !== undefined) return { pre: "物価 ", main: (Number(inf) * 100).toFixed(1), unit: "%" };
      const ret = a?.investmentReturn?.default;
      return ret === undefined ? { main: "既定の値" } : { pre: "運用 ", main: (Number(ret) * 100).toFixed(1), unit: "%" };
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
      return (h.accounts ?? []).length > 0;
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

/** カードの欄の数（推定・わからない／未入力）。同じ値を見せる欄（同じ当て先）は1つに数え、見せるだけの欄は数えない */
function fieldCounts(stage: StageDef, wh: WorkingHousehold): { estimated: number; missing: number } {
  let estimated = 0;
  let missing = 0;
  const seen = new Set<string>();
  for (const f of allFields(stage)) {
    if (f.readOnly !== undefined) continue;
    const a = fieldAddress(f, wh);
    const k = a !== null ? JSON.stringify(a) : `key:${f.key}`;
    if (seen.has(k)) continue;
    seen.add(k);
    const s = fieldStatus(f, wh).status;
    if (s === "missing") missing++;
    else if (s === "estimated" || s === "unknown") estimated++;
  }
  return { estimated, missing };
}

/**
 * カードの状態（4つ）:
 * 1. 未入力（0円の所あり）: 0円で計算している欄か、入っていない物がある。物が無く「当てはまらない」も決めていないときも
 * 2. 推定で計算中: 推定・わからない（代わりの値）の欄がある（前提条件の標準の値は数えない）
 * 3. 当てはまらない: 無いと決めてある（子がいない・退職金の制度が無いなど）か、物が無くて FP が保存した・「当てはまらない」を押した
 * 4. 入力済み: 物があり、上のどれでもない
 */
export function statusOf(c: { estimated: number; missing: number; hasData: boolean; confirmed: boolean; none: boolean; countEstimates?: boolean }): ItemStatus {
  if (c.missing > 0) return "missing";
  if (c.estimated > 0 && c.countEstimates !== false) return "est";
  if (c.none) return "na";
  if (c.hasData) return "done";
  return c.confirmed ? "na" : "missing";
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
const MONEY_STAGE: Readonly<Record<MoneyCard, StageId>> = { family: "family", work: "work", pension: "pension", living: "living", education: "education", housing: "housing", insurance: "insurance", savings: "savings", events: "events", car: "car", care: "care", inherit: "inheritance" };

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
      return `介護（${memberLabel(wh, o.obj.member)}）`;
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
    case "care":
      return o.obj.months !== undefined ? { main: String(o.obj.months), unit: "か月" } : { main: "期間は目安" };
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
    first: false,
    hint: null,
    canNa: false,
    canFill: false,
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
  /** 相続・贈与のカードの要約（相続税の目安。計算の結果から。inheritanceLine.ts） */
  inheritance?: Summary | null;
  /** 年金のカードの要約（夫婦の合計の月額。65歳から・推定。計算の結果から。pensionEstimate.ts） */
  pension?: Summary | null;
}

/** カードの入っていない物（確かめの一覧のいちばん上と同じ） */
const gapsFor = (gaps: readonly Gap[], id: string) => gaps.filter((g) => g.card === id);

/** 入力のホームの14枚のカード（ピンは pinItems） */
export function inputItems(wh: WorkingHousehold, opts: ItemOptions = {}): InputItem[] {
  const layout = opts.layout ?? DEFAULT_LAYOUT;
  const first = new Set(layout.first);
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
    const status = statusOf({ estimated, missing, hasData, confirmed: confirmed.has(id), none: declaredNone(id, wh), countEstimates: id !== "assumptions" });
    const isFirst = first.has(id);
    const hint = isFirst || (status !== "missing" && status !== "est") ? null : status === "est" ? (HINTS[id]?.est ?? HINT_EST) : hasData && c.missing > 0 ? HINT_ZERO : (HINTS[id]?.missing ?? HINT_ZERO);
    const canNa = !isFirst && status === "missing" && id !== "family" && id !== "assumptions" && (!hasData || (c.missing === 0 && own.every((g) => g.none !== undefined)));
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
      missing,
      summary: baseSummary(id, wh, opts.inheritance, opts.pension),
      first: isFirst,
      hint,
      canNa,
      canFill: !isFirst && status === "missing" && own.some((g) => g.fill !== undefined),
    };
  });
}

/** カード（14枚）かピンの1つ（パネルの見出し・状態に使う） */
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
}

/** 進み具合: 「14項目中 入力済み○・推定で計算中○・当てはまらない○」と、未入力（0円の所あり）の数（ピンは数えない） */
export function progressOf(items: readonly InputItem[]): Progress {
  const cards = items.filter((i) => i.added === null);
  const n = (s: ItemStatus) => cards.filter((i) => i.status === s).length;
  return { total: cards.length, done: n("done"), est: n("est"), missing: n("missing"), na: n("na") };
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

// ---- ＋ 項目を追加 ----

const PRESET_BASIS = "ひな形の仮の値（この世帯の額に直すか、このままなら「✓ 入れる」）";

export interface AddOption {
  key: string;
  label: string;
  note: string;
  art: AddedItem["art"];
}

/** 足せる項目（今ある任意の項目の型。FP が自由な項目を作る仕組みは、拡張領域の約束（0011 の4・0016 の3）に沿って次の回）。
 * 車は「車」のカードの中の「＋ もう1台」、FP顧問料は「前提条件」のカードの中の「＋ FP顧問料の契約」で足す */
export const ADD_OPTIONS: readonly AddOption[] = [
  { key: "pet", label: "ペット", note: "毎年の費用（えさ・医療・保険）", art: "pet" },
  { key: "abroad", label: "留学", note: "1回の費用", art: "abroad" },
  { key: "periodic", label: "名前を付けた支出", note: "一時的な支出・n年ごとの支出", art: "events" },
  { key: "care", label: "介護の費用", note: "介護を受ける人・期間", art: "events" },
];

/** 足すときの選択肢（留学は、子がいれば子ごとにも選べる。子を選ぶと、物は子ども・教育のカードのその子の所に入る） */
export function addOptions(wh: WorkingHousehold): AddOption[] {
  const kids = wh.request.input.household.members.filter((m) => m.kind === "child" && m.expected !== true);
  return ADD_OPTIONS.flatMap((o) =>
    o.key === "abroad" && kids.length > 0
      ? [...kids.map((c) => ({ ...o, key: `abroad:${c.id}`, label: `留学（${memberLabel(wh, c.id)}）`, note: "1回の費用。子ども・教育の項目に入ります" })), { ...o, label: "留学（子を選ばない）" }]
      : [o],
  );
}

/** 項目を足す: 物を1件、属するカードに作り、その物のピンを足す（保存するまでは下書き） */
export function addItem(wh: WorkingHousehold, key: string, id: () => string = newId): { wh: WorkingHousehold; itemId: string } | null {
  const [head, childId] = key.split(":") as [string, string | undefined];
  const opt = ADD_OPTIONS.find((o) => o.key === head);
  if (opt === undefined) return null;
  const base = wh.request.input.baseMonth;
  const h = wh.request.input.household;
  const self = h.members.find((m) => m.kind === "self") ?? h.members[0];
  if (self === undefined) return null;
  const child: Member | undefined = childId === undefined ? undefined : h.members.find((m) => m.id === childId && m.kind === "child");
  if (childId !== undefined && (child === undefined || head !== "abroad")) return null;
  const ref = id();
  let next: WorkingHousehold;
  let kind: "periodic" | "care";
  if (head === "pet" || head === "abroad" || head === "periodic") {
    kind = "periodic";
    const at = addMonths(base, head === "abroad" ? 60 : 12);
    // 子を選んだ留学は、その子の年齢で時期を持つ（20歳か、もう過ぎていれば来年の年齢）。子の年齢で始まる支出は子ども・教育のカードに出る
    const childAt = child === undefined ? null : { memberAge: { member: child.id, years: Math.max(20, ageAt(child, base) + 1) } };
    const p: PeriodicExpense =
      head === "pet"
        ? { id: ref, label: "ペット", row: "cf.expense.other", from: { at }, to: { at: addMonths(at, 14 * 12) }, everyYears: 1, amount: standardBox(180000, PRESET_BASIS) }
        : head === "abroad"
          ? // 子を選んだ留学は子ども・教育の出るお金の行（種類 教育費。0062）
            { id: ref, label: "留学", ...(childAt !== null ? { kind: "education" as const, row: "cf.expense.education" } : { row: "cf.expense.lumpSum.other" }), from: childAt ?? { at }, to: childAt ?? { at }, everyYears: 1, amount: standardBox(3500000, PRESET_BASIS) }
          : { id: ref, label: "新しい支出", row: "cf.expense.lumpSum.other", from: { at }, to: { at }, everyYears: 1, amount: standardBox(300000, PRESET_BASIS) };
    next = mutate(wh, (hh) => void (hh.periodicExpenses ??= []).push(p));
  } else {
    kind = "care";
    const who: Member = h.members.find((m) => m.kind === "parent") ?? self;
    const at = who.kind === "self" ? ageReachedMonth(who, 80) : addMonths(base, 60);
    next = mutate(wh, (hh) => void (hh.careExpenses ??= []).push({ id: ref, member: who.id, from: { at }, months: 61, place: "home" }));
  }
  const itemId = `added:${id()}`;
  return { wh: { ...next, addedItems: [...next.addedItems, { id: itemId, kind, ref, art: opt.art }] }, itemId };
}
