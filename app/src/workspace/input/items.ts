// 入力のホームの項目（作業の層）: 12の項目と、FP が足した項目を、同じ形のカードにする。
// カードに出すのは「イラスト＋名前＋要約の数字1つ＋状態」まで。状態は世帯データ（と保存した項目の印）から決め、色だけに頼らずに見せる（InputView.tsx）
import type { AdvisoryFee, Car, CareExpense, Household, Member, PeriodicExpense } from "../../engine/types.ts";
import { addMonths, ageAt, ageReachedMonth } from "../levers.ts";
import type { StageDef, StageId } from "./form.ts";
import { estimatedBox, mutate, newId, type AddedItem, type WorkingHousehold } from "./household.ts";
import { memberLabel } from "./labels.ts";
import { addCar, carGroup } from "./stages/cars.ts";
import { careGroup, periodicGroup } from "./stages/events.ts";
import { addAdvisoryFee, feeGroups } from "./stages/fees.ts";
import { buildStage, stageStatus, STAGE_ORDER } from "./stages/index.ts";
import { currentPeriod } from "./stages/work.ts";

/** カードの状態: 入力済み・推定あり・未入力 */
export type ItemStatus = "done" | "est" | "none";

/** まとまり（項目が増えたときの見出し） */
export type ItemGroup = "familyIncome" | "flows" | "assets" | "premise";
export const ITEM_GROUPS: readonly { id: ItemGroup; label: string }[] = [
  { id: "familyIncome", label: "家族と収入" },
  { id: "flows", label: "お金の出入り" },
  { id: "assets", label: "資産と備え" },
  { id: "premise", label: "前提" },
];

/** カードのイラストの種類（app/src/assets/illustrations/ のファイル名） */
export type Art = StageId | "pet" | "abroad";

/** 要約の数字1つ（例: 「年収 」「720」「万円」）。数字の部分を大きく見せる */
export interface Summary {
  pre?: string;
  main: string;
  unit?: string;
}

export interface InputItem {
  /** カードの ID: 12の項目は段階の ID（family など）、足した項目は `added:` で始まる */
  id: string;
  label: string;
  /** 段階の説明（パネルの見出しの下） */
  lead: string;
  group: ItemGroup;
  /** 項目の色（帯・小さな四角・イラストの面だけに使う。文字には使わない） */
  color: string;
  art: Art;
  /** FP が足した項目なら、その記録 */
  added: AddedItem | null;
  status: ItemStatus;
  /** 推定・仮の値の欄の数 */
  estimated: number;
  summary: Summary | null;
}

/** 見出しで区切るのは、カード（項目）がこの数以上のとき（広い画面の4列で4段を超えるころ） */
export const GROUP_HEADINGS_FROM = 16;

interface BaseDef {
  group: ItemGroup;
  color: string;
}

const BASE: Record<StageId, BaseDef> = {
  family: { group: "familyIncome", color: "#C96B5C" },
  work: { group: "familyIncome", color: "#4A72B8" },
  pension: { group: "familyIncome", color: "#8467B0" },
  living: { group: "flows", color: "#C99A30" },
  education: { group: "flows", color: "#36917F" },
  housing: { group: "flows", color: "#5A9550" },
  insurance: { group: "assets", color: "#3B86AE" },
  savings: { group: "assets", color: "#D0843A" },
  events: { group: "flows", color: "#BE5A86" },
  car: { group: "flows", color: "#5C7895" },
  fee: { group: "flows", color: "#7E8A3A" },
  assumptions: { group: "premise", color: "#8A7560" },
};

const ART_COLOR: Record<AddedItem["art"], string> = { pet: "#B0704E", abroad: "#4F8FA6", events: BASE.events.color, car: BASE.car.color, fee: BASE.fee.color };

// ---- 要約の数字 ----

/** 円を万円の文字にする（1万円未満の端は、100万円未満なら小数1桁まで） */
export function manText(yen: number): string {
  const man = yen / 10000;
  if (Number.isInteger(man)) return man.toLocaleString("ja-JP");
  if (Math.abs(yen) < 1_000_000) return String(Math.round(man * 10) / 10);
  return Math.round(man).toLocaleString("ja-JP");
}

const claimedRefs = (wh: WorkingHousehold) => new Set(wh.addedItems.map((a) => a.ref));
const adults = (h: Household) => h.members.filter((m) => m.kind === "self" || m.kind === "spouse");
const EXPECTED_KINDS = new Set(["statementOver50", "receiving", "projection"]);

function pensionSummary(h: Household): Summary | null {
  const recs = (h.pensionRecords ?? []).filter((r) => adults(h).some((m) => m.id === r.member));
  if (recs.length === 0) return null;
  const self = h.members.find((m) => m.kind === "self");
  const selfRec = recs.find((r) => r.member === self?.id);
  const at = selfRec?.claim?.basic?.at;
  const age = self !== undefined && at !== undefined ? ageAt(self, addMonths(at, -1)) : 65;
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

function periodicSummary(p: PeriodicExpense): Summary {
  const amount = p.amount.value ?? 0;
  const once = p.everyYears === 1 && p.to?.at !== undefined && p.to.at === p.from.at;
  if (once) return { main: manText(amount), unit: "万円（1回）" };
  if (p.everyYears === 1) return { pre: "年", main: manText(amount), unit: "万円" };
  return { main: manText(amount), unit: `万円（${p.everyYears}年ごと）` };
}

function baseSummary(id: StageId, wh: WorkingHousehold): Summary | null {
  const h = wh.request.input.household;
  const claimed = claimedRefs(wh);
  switch (id) {
    case "family":
      return { main: String(h.members.filter((m) => m.expected !== true).length), unit: "人" };
    case "work":
      return workSummary(h, wh.request.input.baseMonth);
    case "pension":
      return pensionSummary(h);
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
      return list.length === 0 ? null : { main: manText(list.reduce((s, a) => s + (a.marketValue?.value ?? 0), 0)), unit: "万円" };
    }
    case "events": {
      const n = (h.periodicExpenses ?? []).filter((p) => !claimed.has(p.id)).length + (h.careExpenses ?? []).filter((c) => !claimed.has(c.id)).length;
      return n === 0 ? null : { main: String(n), unit: "件" };
    }
    case "car": {
      const n = (h.cars ?? []).filter((c) => !claimed.has(c.id)).length;
      return n === 0 ? null : { main: String(n), unit: "台" };
    }
    case "fee":
      return feeSummary((h.advisoryFees ?? []).filter((c) => !claimed.has(c.id)));
    case "assumptions": {
      const a = wh.request.input.assumptions;
      const inf = a?.inflation?.default;
      if (inf !== undefined) return { pre: "物価 ", main: (Number(inf) * 100).toFixed(1), unit: "%" };
      const ret = a?.investmentReturn?.default;
      return ret === undefined ? { main: "既定の値" } : { pre: "運用 ", main: (Number(ret) * 100).toFixed(1), unit: "%" };
    }
  }
}

/** 項目に物（入れた値）があるか。無くても、FP が保存すれば「入力済み（なし）」になる */
function baseHasData(id: StageId, wh: WorkingHousehold): boolean {
  const h = wh.request.input.household;
  const claimed = claimedRefs(wh);
  switch (id) {
    case "family":
      return h.members.length > 0;
    case "work":
      return adults(h).some((m) => (h.employmentPeriods ?? []).some((p) => p.member === m.id));
    case "pension":
      return (h.pensionRecords ?? []).length > 0;
    case "living":
      return (h.livingExpenses ?? []).length > 0;
    case "education":
      return (h.goals ?? []).some((g) => g.kind === "education");
    case "housing":
      return (h.residences ?? []).length > 0 || (h.debts ?? []).some((d) => d.kind === "mortgage");
    case "insurance":
      return (h.insuranceContracts ?? []).length > 0;
    case "savings":
      return (h.accounts ?? []).length > 0;
    case "events":
      return (h.periodicExpenses ?? []).some((p) => !claimed.has(p.id)) || (h.careExpenses ?? []).some((c) => !claimed.has(c.id));
    case "car":
      return (h.cars ?? []).some((c) => !claimed.has(c.id));
    case "fee":
      return (h.advisoryFees ?? []).some((c) => !claimed.has(c.id));
    case "assumptions":
      // 前提条件は計算に必ず要るので、既定の値（事務所の標準値ができるまでの仮の値）が入っている
      return wh.request.input.assumptions !== undefined;
  }
}

// ---- 足した項目 ----

type AddedObject = { kind: "periodic"; obj: PeriodicExpense } | { kind: "care"; obj: CareExpense } | { kind: "car"; obj: Car } | { kind: "fee"; obj: AdvisoryFee };

function addedObject(h: Household, a: AddedItem): AddedObject | null {
  if (a.kind === "periodic") {
    const obj = (h.periodicExpenses ?? []).find((x) => x.id === a.ref);
    return obj === undefined ? null : { kind: "periodic", obj };
  }
  if (a.kind === "care") {
    const obj = (h.careExpenses ?? []).find((x) => x.id === a.ref);
    return obj === undefined ? null : { kind: "care", obj };
  }
  if (a.kind === "car") {
    const obj = (h.cars ?? []).find((x) => x.id === a.ref);
    return obj === undefined ? null : { kind: "car", obj };
  }
  const obj = (h.advisoryFees ?? []).find((x) => x.id === a.ref);
  return obj === undefined ? null : { kind: "fee", obj };
}

function addedLabel(wh: WorkingHousehold, o: AddedObject): string {
  if (o.kind === "periodic") return o.obj.label !== undefined && o.obj.label !== "" ? o.obj.label : "名前のない支出";
  if (o.kind === "care") return `介護（${memberLabel(wh, o.obj.member)}）`;
  if (o.kind === "car") return `車（${memberLabel(wh, o.obj.owner)}）`;
  return `FP顧問料（${memberLabel(wh, o.obj.payer)}）`;
}

function addedSummary(o: AddedObject): Summary {
  if (o.kind === "periodic") return periodicSummary(o.obj);
  if (o.kind === "care") return o.obj.months !== undefined ? { main: String(o.obj.months), unit: "か月" } : { main: "期間は目安" };
  if (o.kind === "car") return { main: manText(o.obj.purchase.price), unit: `万円・${o.obj.purchase.everyYears}年ごと` };
  return feeSummary([o.obj]) ?? { main: "—" };
}

const ADDED_STAGE: Record<AddedItem["kind"], StageId> = { periodic: "events", care: "events", car: "car", fee: "fee" };
const ADDED_LEAD: Record<AddedItem["kind"], string> = {
  periodic: "FP が足した項目です。名前・1回の額・時期・何年ごとかを入れます。",
  care: "FP が足した項目です。介護を受ける人・始まり・期間を入れます。",
  car: "FP が足した項目です。この1台の買い替えと維持費を入れます。",
  fee: "FP が足した項目です。この契約の単発と継続の料金を入れます。",
};

/** 足した項目のパネルの中身（物1件だけの区画）。物を外した後は空 */
function addedStage(wh: WorkingHousehold, a: AddedItem): StageDef {
  const h = wh.request.input.household;
  const o = addedObject(h, a);
  const label = o === null ? "外した項目" : addedLabel(wh, o);
  const groups =
    o === null
      ? []
      : o.kind === "periodic"
        ? [periodicGroup(wh, o.obj)]
        : o.kind === "care"
          ? [careGroup(wh, o.obj)]
          : o.kind === "car"
            ? [carGroup(wh, o.obj, (h.cars ?? []).indexOf(o.obj))]
            : feeGroups(wh, o.obj, (h.advisoryFees ?? []).indexOf(o.obj));
  return {
    id: ADDED_STAGE[a.kind],
    label,
    lead: ADDED_LEAD[a.kind],
    sections: [{ key: `added/${a.id}`, title: label, ...(o === null ? { note: "この項目の物を外しました。保存すると、カードがなくなります" } : {}), level: "simple", groups, actions: [] }],
  };
}

// ---- カードの一覧 ----

/** カードの状態: 推定・仮の値の欄が残る間は（保存しても）「推定あり」。物があるか FP が保存していれば「入力済み」。どちらでもなければ「未入力」 */
export function statusOf(estimated: number, hasData: boolean, confirmed: boolean): ItemStatus {
  if (estimated > 0) return "est";
  return hasData || confirmed ? "done" : "none";
}

/** カードの中身（パネルで開く欄の定義） */
export function itemStage(wh: WorkingHousehold, id: string): StageDef | null {
  if (id.startsWith("added:")) {
    const a = wh.addedItems.find((x) => x.id === id);
    return a === undefined ? null : addedStage(wh, a);
  }
  return STAGE_ORDER.some((s) => s.id === id) ? buildStage(id as StageId, wh) : null;
}

/** 入力のホームのカード（12の項目のあとに、足した項目を足した順に） */
export function inputItems(wh: WorkingHousehold): InputItem[] {
  const h = wh.request.input.household;
  const confirmed = new Set(wh.confirmed);
  const out: InputItem[] = STAGE_ORDER.map(({ id, label }) => {
    const stage = buildStage(id, wh);
    const st = stageStatus(stage, wh);
    const def = BASE[id];
    return { id, label, lead: stage.lead, group: def.group, color: def.color, art: id, added: null, status: statusOf(st.estimated, baseHasData(id, wh), confirmed.has(id)), estimated: st.estimated, summary: baseSummary(id, wh) };
  });
  for (const a of wh.addedItems) {
    const o = addedObject(h, a);
    const stage = addedStage(wh, a);
    const st = stageStatus(stage, wh);
    out.push({
      id: a.id,
      label: stage.label,
      lead: stage.lead,
      group: "flows",
      color: ART_COLOR[a.art],
      art: a.art,
      added: a,
      status: statusOf(st.estimated, o !== null, confirmed.has(a.id)),
      estimated: st.estimated,
      summary: o === null ? null : addedSummary(o),
    });
  }
  return out;
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
  none: number;
}

/** 進み具合: 「○項目中○項目 入力済み」と、状態ごとの数 */
export function progressOf(items: readonly InputItem[]): Progress {
  return {
    total: items.length,
    done: items.filter((i) => i.status === "done").length,
    est: items.filter((i) => i.status === "est").length,
    none: items.filter((i) => i.status === "none").length,
  };
}

/** 保存: その項目を「保存した」印に足し、物を外した足した項目は一覧から外す */
export function saveItem(wh: WorkingHousehold, id: string): WorkingHousehold {
  const h = wh.request.input.household;
  const addedItems = wh.addedItems.filter((a) => addedObject(h, a) !== null);
  const alive = new Set([...STAGE_ORDER.map((s) => s.id as string), ...addedItems.map((a) => a.id)]);
  const confirmed = [...new Set([...wh.confirmed, id])].filter((x) => alive.has(x));
  return { ...wh, addedItems, confirmed };
}

// ---- ＋ 項目を追加 ----

const PRESET_BASIS = "ひな形の仮の値（入れ直すと確定）";

export interface AddOption {
  key: string;
  label: string;
  note: string;
  art: AddedItem["art"];
}

/** 足せる項目（今ある任意の項目の型。FP が自由な項目を作る仕組みは、拡張領域の約束（0011 の4・0016 の3）に沿って次の回） */
export const ADD_OPTIONS: readonly AddOption[] = [
  { key: "pet", label: "ペット", note: "毎年の費用（えさ・医療・保険）", art: "pet" },
  { key: "abroad", label: "留学", note: "1回の費用", art: "abroad" },
  { key: "periodic", label: "名前を付けた支出", note: "一時的な支出・n年ごとの支出", art: "events" },
  { key: "care", label: "介護の費用", note: "介護を受ける人・期間", art: "events" },
  { key: "car", label: "車（もう1台）", note: "別のカードで1台ずつ", art: "car" },
  { key: "fee", label: "FP顧問料（もう1件の契約）", note: "別のカードで契約ごと", art: "fee" },
];

/** 項目を足す: 物を1件作り、その物を指すカードの記録を足す（保存するまでは下書き） */
export function addItem(wh: WorkingHousehold, key: string, id: () => string = newId): { wh: WorkingHousehold; itemId: string } | null {
  const opt = ADD_OPTIONS.find((o) => o.key === key);
  if (opt === undefined) return null;
  const base = wh.request.input.baseMonth;
  const h = wh.request.input.household;
  const self = h.members.find((m) => m.kind === "self") ?? h.members[0];
  if (self === undefined) return null;
  const ref = id();
  let next: WorkingHousehold;
  let kind: AddedItem["kind"];
  if (key === "pet" || key === "abroad" || key === "periodic") {
    kind = "periodic";
    const at = addMonths(base, key === "abroad" ? 60 : 12);
    const p: PeriodicExpense =
      key === "pet"
        ? { id: ref, label: "ペット", row: "cf.expense.other", from: { at }, to: { at: addMonths(at, 14 * 12) }, everyYears: 1, amount: estimatedBox(180000, PRESET_BASIS) }
        : key === "abroad"
          ? { id: ref, label: "留学", row: "cf.expense.lumpSum.other", from: { at }, to: { at }, everyYears: 1, amount: estimatedBox(3500000, PRESET_BASIS) }
          : { id: ref, label: "新しい支出", row: "cf.expense.lumpSum.other", from: { at }, to: { at }, everyYears: 1, amount: estimatedBox(300000, PRESET_BASIS) };
    next = mutate(wh, (hh) => void (hh.periodicExpenses ??= []).push(p));
  } else if (key === "care") {
    kind = "care";
    const who: Member = h.members.find((m) => m.kind === "parent") ?? self;
    const at = who.kind === "self" ? ageReachedMonth(who, 80) : addMonths(base, 60);
    next = mutate(wh, (hh) => void (hh.careExpenses ??= []).push({ id: ref, member: who.id, from: { at }, months: 61, place: "home" }));
  } else if (key === "car") {
    kind = "car";
    next = addCar(wh, () => ref);
  } else {
    kind = "fee";
    next = addAdvisoryFee(wh, () => ref);
  }
  const itemId = `added:${id()}`;
  return { wh: { ...next, addedItems: [...next.addedItems, { id: itemId, kind, ref, art: opt.art }] }, itemId };
}
