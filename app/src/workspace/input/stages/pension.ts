// 3. 年金（0066）: 人ごとに入れ方の区分を3つ（推計／書類から／加入歴から）から選び、書類からのときは書類の種類（ねんきん定期便の
// 50歳未満・50歳以上、年金額改定通知書、見込額）を選ぶ。区分は画面の側（記録の型 kind から決まる）。
// - 推計に戻しても書類の記録は消さず、画面の側に残す（pensionKept。その入れ方に戻すと戻る）
// - 定期便の加入月数は「わからない」でよい（代わりの値: 国民年金＝20歳の月から作成年月まで〔60歳まで〕、厚生年金＝働き方の期間の厚生年金の月）
// - 受け取り開始（繰上げ・繰下げ）は基礎と厚生を別々に、時点の部品で月まで（0038）
// - 受け取っている遺族年金・障害年金（受け取る人・種類・年額・終わりの推定）と外国の年金は、お金の行（0044）で額を入れる
// - 世帯の外の家族（親など）の年金は介護・親のカード。このカードは本人・配偶者だけ
import type { Household, IncomeFlow, Member, PensionRecord, ReceivingPensionType, Timepoint } from "../../../engine/types.ts";
import { addMonths, ageAt, ageReachedMonth } from "../../levers.ts";
import { ageSwitchMonth } from "../../timepoint.ts";
import { byId, field, plain, removeAction, resolveTimepoint, timepointField, timeView, yenBox, type ActionDef, type FieldDef, type Finder, type GroupDef, type SectionDef, type StageDef } from "../form.ts";
import { formatYearMonth } from "../units.ts";
import { sameWhen } from "../when.ts";
import { estimatedBox, mutate, newId, periodsOf, standardBox, type WorkingHousehold } from "../household.ts";
import { DOCUMENT_KINDS, earners, HISTORY_CATEGORIES, memberLabel, PENSION_MODES } from "../labels.ts";
import { incomeGroups, moneySections } from "../moneyRows.ts";
import { readGroup, readLine } from "../readLines.ts";
import { putRow, type StateRow } from "../rows.ts";
import type { Address } from "../../store/readings.ts";

type Obj = Record<string, unknown>;
const records = (h: Household) => h.pensionRecords;
const recordOf = (h: Household, memberId: string) => (h.pensionRecords ?? []).find((r) => r.member === memberId);
const DOC_SET = new Set(["statementUnder50", "statementOver50", "receiving", "projection"]);
const STATEMENTS = new Set(["statementUnder50", "statementOver50"]);

/** 額をまだ入れていないときの印（0円の推定）の文。入れ方ごとに、写す書類を言う */
const UNENTERED: Record<string, string> = {
  statementUnder50: "未入力（0円で計算。ねんきん定期便の額を入れてください）",
  statementOver50: "未入力（0円で計算。ねんきん定期便の見込額を入れてください）",
  receiving: "未入力（0円で計算。年金額改定通知書の年金額（年額）を入れてください）",
  projection: "未入力（0円で計算。見込額（年額）を入れてください）",
};
const UNENTERED_TEXTS = new Set([...Object.values(UNENTERED), "未入力（0円で計算。定期便の額を入れてください）"]);
const unentered = (kind: string) => UNENTERED[kind] ?? UNENTERED.statementUnder50 as string;
type PensionAmount = NonNullable<NonNullable<PensionRecord["amounts"]>["basic"]>;
/** まだ額を入れていない印のままの箱（入れ方を変えたら、新しい入れ方の文に入れ替える） */
const isUnentered = (b: PensionAmount | undefined) => b !== undefined && b.state === "estimated" && b.value === 0 && UNENTERED_TEXTS.has((b as { estimate?: { basis?: string } }).estimate?.basis ?? "");

// ---- 入れ方の区分（推計／書類から／加入歴から） ----

export type PensionMode = "" | "document" | "history";

/** 記録の入れ方の区分（記録が無ければ推計） */
export const modeOf = (rec: PensionRecord | undefined): PensionMode => (rec === undefined ? "" : rec.kind === "history" ? "history" : "document");
const modeOfKind = (kind: string): PensionMode => (kind === "" ? "" : kind === "history" ? "history" : "document");

/** 書類からを選んだときの書類の種類の既定（年齢から: 65歳以上は改定通知書、50歳以上は定期便の50歳以上、それより下は定期便の50歳未満） */
export function defaultDocument(m: Member, baseMonth: string): string {
  const age = ageAt(m, baseMonth);
  return age >= 65 ? "receiving" : age >= 50 ? "statementOver50" : "statementUnder50";
}

/** 書類からの記録で、老齢基礎年金・老齢厚生年金の額がどちらもまだ入っていない（0円で計算中） */
export function amountsUnentered(rec: PensionRecord | undefined): boolean {
  return rec !== undefined && DOC_SET.has(rec.kind) && isUnentered(rec.amounts?.basic) && isUnentered(rec.amounts?.employee);
}

/** 残した前の記録（構成員ごと・入れ方ごとに1件） */
export const keptOf = (wh: WorkingHousehold, memberId: string): PensionRecord[] => wh.pensionKept?.[memberId] ?? [];

function withKept(wh: WorkingHousehold, memberId: string, list: PensionRecord[]): WorkingHousehold {
  if (keptOf(wh, memberId).length === 0 && list.length === 0) return wh;
  const next = { ...(wh.pensionKept ?? {}) };
  if (list.length === 0) delete next[memberId];
  else next[memberId] = list;
  const { pensionKept: _old, ...rest } = wh;
  void _old;
  return Object.keys(next).length === 0 ? rest : { ...rest, pensionKept: next };
}

/** 加入歴の初めの行を、働き方の期間から作る（加入歴から計算する型を選んだとき） */
function historyFromPeriods(h: Household, m: Member, asOf: string): NonNullable<PensionRecord["history"]> {
  const out: NonNullable<PensionRecord["history"]> = [];
  for (const p of periodsOf(h, m.id)) {
    const from = p.from.at;
    if (from === undefined || from > asOf) continue;
    const to = p.to?.at !== undefined && p.to.at < asOf ? p.to.at : asOf;
    const employee = p.pensionCategory !== undefined && p.pensionCategory !== "none";
    const annual = (p.salary?.annual.value ?? 0) + (p.salary?.bonus?.value ?? 0);
    out.push(employee ? { from, to, category: "employee", averageRemuneration: Math.round(annual / 12) } : { from, to, category: "national1" });
  }
  return out;
}

/** 記録の型を変える。要る欄を足し、使わない欄を外す（受け取り開始と時点、同じ意味の欄の値の状態の行は残す） */
export function convertRecord(h: Household, m: Member, rec: PensionRecord | undefined, kind: string, baseMonth: string): PensionRecord | null {
  if (kind === "") return null;
  const asOf = rec?.asOf ?? addMonths(baseMonth, -1);
  const out: PensionRecord = { id: rec?.id ?? newId(), member: m.id, kind, asOf };
  // まだ額を入れていない印のままの箱は、新しい入れ方の文（写す書類）に入れ替える
  const placeholder = (b: PensionAmount | undefined) => (b === undefined || isUnentered(b) ? estimatedBox(0, unentered(kind)) : b);
  const amounts = { basic: placeholder(rec?.amounts?.basic), employee: placeholder(rec?.amounts?.employee) };
  if (STATEMENTS.has(kind)) {
    out.months = rec?.months ?? { basic: 0, employee: 0 };
    out.amounts = { ...rec?.amounts, ...amounts };
  } else if (kind === "receiving" || kind === "projection") {
    out.amounts = { ...rec?.amounts, ...amounts };
    if (rec?.months !== undefined) out.months = rec.months;
  } else if (kind === "history") {
    out.history = rec?.history ?? historyFromPeriods(h, m, asOf);
  }
  if (rec?.claim !== undefined) out.claim = rec.claim;
  if (rec?.valueStates !== undefined && rec.kind !== "history" && kind !== "history") out.valueStates = structuredClone(rec.valueStates);
  return out;
}

/**
 * 年金の入れ方を切り替える（0066）。target は記録の型（"" は推計、"history" は加入歴から、ほかは書類の種類）。
 * - 同じ区分の中（書類の種類を変える）は、同じ意味の欄（作成年月・加入月数）を引き継いで型を変える
 * - 区分を変えるときは、今の記録を画面の側に残し（pensionKept）、行き先の区分に残した記録があれば戻す（隠すだけで消さない）
 */
export function switchPension(wh: WorkingHousehold, memberId: string, target: string): WorkingHousehold {
  const h = wh.request.input.household;
  const m = h.members.find((x) => x.id === memberId);
  if (m === undefined) return wh;
  const base = wh.request.input.baseMonth;
  const cur = recordOf(h, memberId);
  const from = modeOf(cur);
  const to = modeOfKind(target);
  if ((cur === undefined && to === "") || (cur !== undefined && cur.kind === target)) return wh;
  let kept = keptOf(wh, memberId);
  let next: PensionRecord | null;
  if (cur !== undefined && from === to) next = convertRecord(h, m, cur, target, base);
  else {
    if (cur !== undefined) kept = [...kept.filter((r) => modeOf(r) !== from), structuredClone(cur)];
    if (to === "") next = null;
    else {
      const back = kept.find((r) => modeOf(r) === to);
      kept = kept.filter((r) => r !== back);
      if (back !== undefined) next = back.kind === target ? back : convertRecord(h, m, back, target, base);
      else {
        // 残した記録が無ければ、今の記録の時点・受け取り開始を引き継いで新しく作る（今の記録は残したので、別の ID にする）
        const seed: PensionRecord | undefined = cur === undefined ? undefined : { id: newId(), member: cur.member, kind: cur.kind, asOf: cur.asOf, ...(cur.claim !== undefined ? { claim: structuredClone(cur.claim) } : {}) };
        next = convertRecord(h, m, seed, target, base);
      }
    }
  }
  // 受け取り開始は入れ方をまたいで引き継ぐ（行き先に無いときだけ写す。推計の区分は構成員の pensionClaim、記録は claim。0078）
  if (next !== null && cur === undefined && next.claim === undefined && m.pensionClaim !== undefined) next = { ...next, claim: structuredClone(m.pensionClaim) };
  const w = mutate(wh, (hh) => {
    const others = (hh.pensionRecords ?? []).filter((r) => r.member !== memberId);
    hh.pensionRecords = next === null ? others : [...others, next];
    if (hh.pensionRecords.length === 0) delete hh.pensionRecords;
    const mm = hh.members.find((x) => x.id === memberId);
    if (next === null && cur?.claim !== undefined && mm !== undefined && mm.pensionClaim === undefined) mm.pensionClaim = structuredClone(cur.claim);
  });
  return withKept(w, memberId, kept);
}

// ---- 定期便の加入月数（わからないの代わりの値） ----

const monthsAddress = (recId: string, part: "basic" | "employee"): Address => ({ target: { object: recId }, item: "pensionRecord.months", at: [part] });
const MONTHS_ROW_KEYS = ["pensionRecord.months/basic", "pensionRecord.months/employee"];

/** ねんきん定期便の入れ方で、加入月数が国民年金・厚生年金とも0か月のまま（写していない。わからない・推定の印も無い） */
export function statementMonthsMissing(rec: PensionRecord | undefined): boolean {
  if (rec === undefined || !STATEMENTS.has(rec.kind)) return false;
  const states = rec.valueStates as Obj | undefined;
  if (states !== undefined && MONTHS_ROW_KEYS.some((k) => states[k] !== undefined)) return false;
  return (rec.months?.basic ?? 0) === 0 && (rec.months?.employee ?? 0) === 0;
}

const monthsBetween = (from: string, to: string): number => {
  const [fy, fm] = from.split("-").map(Number) as [number, number];
  const [ty, tm] = to.split("-").map(Number) as [number, number];
  return Math.max(0, (ty - fy) * 12 + (tm - fm) + 1);
};

/** 加入月数の代わりの値（国民年金＝20歳の月から作成年月まで〔60歳になる前の月まで〕、厚生年金＝その月までの働き方の期間の厚生年金の月） */
export function substituteMonths(h: Household, m: Member, asOf0: string | undefined, baseMonth: string): { basic: number; employee: number; basis: string } {
  const asOf = asOf0 ?? addMonths(baseMonth, -1);
  const from20 = ageReachedMonth(m, 20);
  const last = addMonths(ageReachedMonth(m, 60), -1);
  const end = asOf < last ? asOf : last;
  const basic = end < from20 ? 0 : Math.min(480, monthsBetween(from20, end));
  let employee = 0;
  for (const p of periodsOf(h, m.id)) {
    if (p.pensionCategory === undefined || p.pensionCategory === "none") continue;
    const a = resolveTimepoint(h, p.from);
    if (a === null || a > asOf) continue;
    const b0 = p.to == null ? asOf : resolveTimepoint(h, p.to);
    const b = b0 === null || b0 > asOf ? asOf : b0;
    employee += monthsBetween(a, b);
  }
  employee = Math.min(900, employee);
  return { basic, employee, basis: `代わりの値（国民年金は20歳の月から書類の作成年月まで〔60歳まで〕の${String(basic)}か月、厚生年金は働き方の期間の厚生年金の${String(employee)}か月）` };
}

/**
 * 加入月数を代わりの値で入れる（2つとも）。state "unknown" は欄の「わからない」と同じ（聞いたが分からない）、"estimated" は推定で埋める。
 * 写してある月数があれば変えない（0か月のままの定期便だけ）
 */
export function fillMonths(wh: WorkingHousehold, memberId: string, state: "unknown" | "estimated"): WorkingHousehold {
  const h = wh.request.input.household;
  const m = h.members.find((x) => x.id === memberId);
  const rec = recordOf(h, memberId);
  if (m === undefined || rec === undefined || !statementMonthsMissing(rec)) return wh;
  const sub = substituteMonths(h, m, rec.asOf, wh.request.input.baseMonth);
  const row: StateRow = state === "unknown" ? { state: "unknown", origin: { kind: "manual" }, estimate: { method: "derived", basis: sub.basis } } : { state: "estimated", origin: { kind: "auto" }, estimate: { method: "derived", basis: sub.basis } };
  return mutate(wh, (hh, req) => {
    const r = recordOf(hh, memberId) as PensionRecord;
    r.months = { ...(r.months ?? { basic: 0, employee: 0 }), basic: sub.basic, employee: sub.employee };
    for (const part of ["basic", "employee"] as const) putRow(req.input as unknown as Obj, monthsAddress(r.id, part), row);
  });
}

/** 加入月数が0か月のままのときの知らせ（年金のパネル・入力のカード・結果のタブで同じ文を使う） */
export function monthsMissingText(kind: string): string {
  return kind === "statementOver50"
    ? "加入月数が0か月のままです。このままでは受給資格期間（10年）に届かないため、見込額を入れても年金は0円で計算します。定期便の「加入期間」の月数を写すか、分からなければ「加入月数がわからない」で代わりの値にしてください"
    : "加入月数が0か月のままです。このままでは、これまでの加入の分を数えずに年金を少なく計算します（受給資格期間の10年に届かなければ0円）。定期便の「加入期間」の月数を写すか、分からなければ「加入月数がわからない」で代わりの値にしてください";
}

/** 結果のタブに出す、年金の入力の知らせ（加入月数が0か月のままの人） */
export function pensionNotices(wh: WorkingHousehold): string[] {
  const h = wh.request.input.household;
  return pensionMembers(h).flatMap((m) => {
    const rec = recordOf(h, m.id);
    if (rec === undefined || !statementMonthsMissing(rec)) return [];
    return [`${memberLabel(wh, m.id)}の年金: ねんきん定期便の加入月数が0か月のままです。${rec.kind === "statementOver50" ? "年金を0円で計算しています" : "年金を少なく計算しています"}。入力の「年金」で加入月数を入れてください`];
  });
}

// ---- 受け取り開始 ----

/** 受け取り開始の月 ↔ 年齢（その年齢に達した月の翌月から。0003・年金の決まり） */
export const claimMonth = (m: Member, age: number): string => addMonths(ageReachedMonth(m, age), 1);
const claimAge = (m: Member, at: string) => ageAt(m, addMonths(at, -1));

/**
 * 受け取り開始の欄（基礎・厚生とも／基礎だけ／厚生だけ）。prop は受け取り開始を持つ欄の名前: 年金の記録の claim か、
 * 記録の無い人（推計の区分）は構成員の pensionClaim（0078）
 */
function claimFields(m: Member, find: Finder, prefix: string, prop: "claim" | "pensionClaim" = "claim", addr?: (part: "basic" | "employee" | null) => Address): FieldDef[] {
  type Holder = { claim?: PensionRecord["claim"]; pensionClaim?: PensionRecord["claim"] };
  const tpAge = (h: Household, t: Timepoint | undefined) => {
    const ym = t === undefined ? null : resolveTimepoint(h, t);
    return ym !== null ? claimAge(m, ym) : null;
  };
  // 整数の年齢で書き換えると年月の形になる時点（年齢・出来事で決めた時点、月まで決めた時点）の印。入力の画面は時点の部品で入れるので出さない
  const derived = (h: Household, t: Timepoint | undefined) => {
    if (t === undefined) return null;
    if (t.at === undefined) return "年齢・出来事で決めた時点";
    const ym = resolveTimepoint(h, t);
    return ym !== null && claimMonth(m, claimAge(m, ym)) !== ym ? "月まで決めた時点（年齢の整数に直すとずれる）" : null;
  };
  // 時点の部品（0038）: 既定は本人の年齢で「65歳」＝65歳になった翌月から。「66歳3か月」のように月まで、年月・出来事からでも入れられる。
  // 空欄は65歳から（標準）。60歳になった翌月から75歳になった翌月までの間だけ。結果のタブで動かす項目は年齢の整数のまま
  const lo = ageSwitchMonth(m, 60, 0, "monthAfterReach");
  const hi = ageSwitchMonth(m, 75, 0, "monthAfterReach");
  const std = (): Timepoint => ({ memberAge: { member: m.id, years: 65, ageSwitch: "monthAfterReach" } });
  const check = (w: WorkingHousehold, tp: Timepoint | null): string | null => {
    const ym = tp === null ? null : resolveTimepoint(w.request.input.household, tp);
    return ym !== null && (ym < lo || ym > hi) ? `受け取り開始は、60歳になった翌月（${formatYearMonth(lo)}）から75歳になった翌月（${formatYearMonth(hi)}）までの間で入れてください` : null;
  };
  /** 標準（65歳になった翌月）と同じ月の、出来事でない時点は省く（省略は標準） */
  const tidy = (h: Household, r: Holder) => {
    const claim = r[prop];
    if (claim === undefined) return;
    for (const part of ["basic", "employee"] as const) {
      const t = claim[part];
      if (t !== undefined && t.event === undefined && resolveTimepoint(h, t) === claimMonth(m, 65)) delete claim[part];
    }
    if (claim.basic === undefined && claim.employee === undefined) delete r[prop];
  };
  const rec0 = (w: WorkingHousehold): { claim?: PensionRecord["claim"] } | undefined => {
    const x = find(w.request.input.household, w) as Holder | undefined;
    return x === undefined ? undefined : { claim: x[prop] };
  };
  const common = { ageOf: (h: Household) => h.members.find((x) => x.id === m.id), mode: "age" as const, ageMeans: "after" as const, optional: true, nullText: "65歳から（標準）", fallback: () => std(), check };
  const writeClaim = (parts: readonly ("basic" | "employee")[]) => (w: WorkingHousehold, tp: Timepoint | null) =>
    mutate(w, (h) => {
      const r = find(h, w) as Holder | undefined;
      if (r === undefined) return;
      const claim = { ...r[prop] };
      for (const part of parts) {
        if (tp === null) delete claim[part];
        else claim[part] = structuredClone(tp);
      }
      r[prop] = claim;
      tidy(h, r);
    });
  const both = field({
    key: `${prefix}/claim`,
    item: "pensionRecord.claim",
    label: "受け取り開始（基礎・厚生とも）",
    level: "simple",
    kind: "int",
    suffix: "歳から",
    min: 60,
    max: 75,
    help: "65歳より前は繰上げ（減額）、後は繰下げ（増額）が付きます。「66歳3か月」のように月まで入れられます。基礎と厚生を別々にするのは詳細で。結果の対策でも動かせます（制度の変更で受け取り開始が遅くなる場合を試す欄ではありません）",
    time: timeView({ ...common, anchor: "pensionStart", read: (w) => rec0(w)?.claim?.basic ?? null, write: writeClaim(["basic", "employee"]) }),
    get: (w) => {
      const h = w.request.input.household;
      const r = rec0(w);
      const age = tpAge(h, r?.claim?.basic) ?? 65;
      const split = r?.claim !== undefined && !sameWhen(r.claim.basic ?? std(), r.claim.employee ?? std());
      const splitText = "基礎と厚生で別の時点です（詳細で見られます）。ここを直すと両方そろえます";
      return { value: age, derived: derived(h, r?.claim?.basic) ?? (split ? splitText : null), ...(split ? { warn: splitText } : {}), ...(r?.claim === undefined ? { implicit: true } : {}) };
    },
    set: (w, v) =>
      mutate(w, (h) => {
        const r = find(h, w) as Holder | undefined;
        if (r === undefined || v === null) return;
        if (Number(v) === 65) delete r[prop];
        else r[prop] = { basic: { at: claimMonth(m, Number(v)) }, employee: { at: claimMonth(m, Number(v)) } };
      }),
  });
  const one = (part: "basic" | "employee", label: string) =>
    field({
      key: `${prefix}/claim/${part}`,
      item: "pensionRecord.claim",
      label,
      level: "detail",
      kind: "int",
      suffix: "歳から",
      min: 60,
      max: 75,
      time: timeView({ ...common, read: (w) => rec0(w)?.claim?.[part] ?? null, write: writeClaim([part]) }),
      get: (w) => {
        const h = w.request.input.household;
        const r = rec0(w);
        return { value: tpAge(h, r?.claim?.[part]) ?? 65, derived: derived(h, r?.claim?.[part]), ...(r?.claim?.[part] === undefined ? { implicit: true } : {}) };
      },
      set: (w, v) =>
        mutate(w, (h) => {
          const r = find(h, w) as Holder | undefined;
          if (r === undefined || v === null) return;
          const claim = { ...r[prop] };
          if (Number(v) === 65) delete claim[part];
          else claim[part] = { at: claimMonth(m, Number(v)) };
          if (claim.basic === undefined && claim.employee === undefined) delete r[prop];
          else r[prop] = claim;
        }),
    });
  const fields = [both, one("basic", "老齢基礎年金の受け取り開始"), one("employee", "老齢厚生年金の受け取り開始")];
  if (addr === undefined) return fields;
  const parts = [null, "basic", "employee"] as const;
  return fields.map((f, i) => ({ ...f, address: () => addr(parts[i] ?? null) }));
}

// ---- 書類の欄 ----

const AMOUNT_LABEL: Record<string, [string, string]> = {
  statementUnder50: ["老齢基礎年金（これまでの加入実績に応じた額）", "老齢厚生年金（これまでの加入実績に応じた額）"],
  statementOver50: ["老齢基礎年金（65歳からの見込額）", "老齢厚生年金（65歳からの見込額）"],
  receiving: ["老齢基礎年金（今の年額）", "老齢厚生年金（今の年額・報酬比例部分）"],
  projection: ["老齢基礎年金（見込額）", "老齢厚生年金（見込額）"],
};

/** 額の欄の説明（写す書類の欄） */
const AMOUNT_HELP: Record<string, string> = {
  statementUnder50: "ねんきん定期便の「これまでの加入実績に応じた年金額」の欄の額。これからの加入の分は、働き方の期間から足します",
  statementOver50: "ねんきん定期便の「老齢年金の見込額」の欄の額（60歳まで今の加入を続けたときに65歳から受け取る額）",
  receiving:
    "年金額改定通知書の年金額（年額）。加給年金・振替加算は計算で足すので、除いて写します（二重になりません）。年金振込通知書の額（2か月分・税などを引いた後）ではありません",
  projection: "ねんきんネットの見込額の試算、または分かっている見込額（年額。65歳から受け取る額）。企業年金・基金の年金は含めません（退職金・企業年金の項目で入れます）",
};

const EXEMPT: [string, string][] = [
  ["paid", "第1号の納付済みの月数"],
  ["exemptFull", "全額免除の月数"],
  ["exemptThreeQuarters", "4分の3免除の月数"],
  ["exemptHalf", "半額免除の月数"],
  ["exemptQuarter", "4分の1免除の月数"],
  ["deferred", "納付猶予・学生納付特例の月数（追納していない分）"],
];

/** 定期便の加入月数の欄（0か月のまま〔写していない〕は空欄で見せる。空欄・わからないは代わりの値。0066） */
function monthsField(m: Member, rec: PensionRecord, part: "basic" | "employee", label: string, max: number, help?: string): FieldDef {
  const find = byId(records, rec.id);
  const a = monthsAddress(rec.id, part);
  return field({
    key: `pension/${rec.id}/months/${part}`,
    item: "pensionRecord.months",
    label,
    // 加入月数は詳細（空欄の代わりの値〔20歳から書類の年月まで・働き方の期間〕でほぼ当たる。0か月のままの知らせと「わからない」のボタンは標準にも出す。0078）
    level: "detail",
    kind: "int",
    suffix: "か月",
    min: 0,
    max,
    blankIsEstimate: true,
    ...(help !== undefined ? { help } : {}),
    address: () => a,
    get: (w) => {
      const r = find(w.request.input.household, w) as PensionRecord | undefined;
      const missing = statementMonthsMissing(r);
      return { value: missing ? null : (r?.months?.[part] ?? 0), ...(missing ? { warn: "0か月のままです（写していません）。見込額を入れても、加入月数を写すか「わからない」にするまでは年金を正しく計算できません" } : {}) };
    },
    set: (w, v) =>
      mutate(w, (h, req) => {
        const r = find(h, w) as PensionRecord | undefined;
        if (r === undefined) return;
        const months = { ...(r.months ?? { basic: 0, employee: 0 }) };
        if (v === null) {
          const sub = substituteMonths(h, m, r.asOf, req.input.baseMonth);
          months[part] = sub[part];
          r.months = months;
          putRow(req.input as unknown as Obj, a, { state: "estimated", origin: { kind: "auto" }, estimate: { method: "derived", basis: sub.basis } });
        } else {
          months[part] = Number(v);
          r.months = months;
        }
      }),
  });
}

function recordGroups(wh: WorkingHousehold, m: Member): GroupDef[] {
  const h = wh.request.input.household;
  const base = wh.request.input.baseMonth;
  const rec = recordOf(h, m.id);
  const who = memberLabel(wh, m.id);
  const kept = keptOf(wh, m.id);
  const modeField = field({
    key: `pension/${m.id}/mode`,
    item: "pensionRecord.kind",
    label: "年金の入れ方",
    level: "simple",
    kind: "select",
    options: PENSION_MODES,
    structural: true,
    help: "手元の書類で選びます。書類が無ければ推計のまま（働き方の期間から計算します）。切り替えても、前の入れ方の数字は消さずに残します",
    get: (w) => ({ value: modeOf(recordOf(w.request.input.household, m.id)) }),
    set: (w, v) => {
      const mode = String(v ?? "");
      const target = mode === "document" ? (keptOf(w, m.id).find((r) => modeOf(r) === "document")?.kind ?? defaultDocument(m, w.request.input.baseMonth)) : mode;
      return switchPension(w, m.id, target);
    },
  });
  if (rec === undefined) {
    const back = kept.map((r) => (r.kind === "history" ? "加入歴" : (DOCUMENT_KINDS.find((o) => o.value === r.kind)?.label ?? "書類")));
    return [
      {
        key: `pension/${m.id}`,
        title: `${who}の公的年金`,
        note: ["書類が無いので、働き方の期間（過去は22歳の4月から今の勤め先に勤めたとみなす）から加入歴を推計しています（推定）", ...(back.length > 0 ? [`前に入れた記録（${back.join("・")}）を残しています。入れ方を戻すと戻ります`] : [])].join("。"),
        level: "simple",
        // 推計でも受け取り開始は標準（繰上げ・繰下げで結果が大きく動く。記録の無い人は構成員の pensionClaim に持つ。0078）
        fields: [modeField, ...claimFields(m, byId((hh: Household) => hh.members, m.id), `pension/${m.id}/estimate`, "pensionClaim", (part) => ({ target: { member: m.id }, item: "member.pensionClaim", at: part === null ? [] : [part] }))],
        actions: [{ key: `pension/${m.id}/toDocument`, label: "書類の額で置き換える", level: "simple", run: (w) => modeField.set(w, "document") }],
      },
    ];
  }
  const find = byId(records, rec.id);
  const prefix = `pension/${rec.id}`;
  const fields: FieldDef[] = [modeField];
  if (DOC_SET.has(rec.kind))
    fields.push(
      field({
        key: `pension/${m.id}/kind`,
        item: "pensionRecord.kind",
        label: "書類の種類",
        level: "simple",
        kind: "select",
        options: DOCUMENT_KINDS,
        structural: true,
        help: "ねんきん定期便は50歳未満（これまでの加入実績の額）と50歳以上（65歳からの見込額）で中身が違います。種類を変えても作成年月・加入月数は引き継ぎ、額の欄の名前と説明を入れ替えます",
        get: (w) => ({ value: recordOf(w.request.input.household, m.id)?.kind ?? "" }),
        set: (w, v) => switchPension(w, m.id, String(v ?? "")),
      }),
    );
  fields.push(plain({ key: `${prefix}/asOf`, item: "pensionRecord.asOf", label: rec.kind === "history" ? "加入歴の終わりの月" : "書類の作成年月", level: "simple", kind: "ym", find, path: ["asOf"], help: "この月より後の加入は、働き方の期間から足します" }));
  if (STATEMENTS.has(rec.kind)) {
    fields.push(
      monthsField(m, rec, "basic", "国民年金の加入月数（年金額に反映する月）", 600, "定期便の「加入期間」の欄の国民年金（計）。免除・猶予の月は含めません。分からなければ「わからない」（代わりの値で計算）"),
      monthsField(m, rec, "employee", "厚生年金の加入月数", 900),
      plain({ key: `${prefix}/months/qualifying`, item: "pensionRecord.months", label: "受給資格期間の月数", level: "detail", kind: "int", suffix: "か月", min: 0, max: 900, find, path: ["months", "qualifying"], optional: true, help: "空欄なら、加入月数と免除・猶予の月数の合計" }),
    );
  }
  const labels = AMOUNT_LABEL[rec.kind];
  if (labels !== undefined) {
    const help = AMOUNT_HELP[rec.kind];
    fields.push(
      yenBox({ key: `${prefix}/amounts/basic`, item: "pensionRecord.amounts", label: labels[0], level: "simple", basis: "annual", find, path: ["amounts", "basic"], optional: true, ...(help !== undefined ? { help } : {}) }),
      yenBox({ key: `${prefix}/amounts/employee`, item: "pensionRecord.amounts", label: labels[1], level: "simple", basis: "annual", find, path: ["amounts", "employee"], optional: true, ...(help !== undefined ? { help } : {}) }),
      yenBox({ key: `${prefix}/amounts/transitional`, item: "pensionRecord.amounts", label: "経過的加算", level: "detail", basis: "annual", find, path: ["amounts", "transitional"], optional: true, help: "空欄なら加入月数から計算します" }),
      yenBox({ key: `${prefix}/amounts/special`, item: "pensionRecord.amounts", label: "特別支給の老齢厚生年金（報酬比例部分）", level: "detail", basis: "annual", find, path: ["amounts", "special"], optional: true, help: "空欄なら生年月と加入の記録から計算します（当たる生年月の人だけ）" }),
    );
  }
  fields.push(...claimFields(m, find, prefix));
  const missing = statementMonthsMissing(rec);
  const actions: ActionDef[] = missing ? [{ key: `${prefix}/months/unknown`, label: "加入月数がわからない（代わりの値で計算する）", level: "simple", run: (w) => fillMonths(w, m.id, "unknown") }] : [];
  const notes = [...(missing ? [monthsMissingText(rec.kind)] : []), ...(kept.length > 0 ? ["前の入れ方の記録を残しています（入れ方を戻すと戻ります）"] : [])];
  const groups: GroupDef[] = [{ key: `pension/${m.id}`, title: `${who}の公的年金`, ...(notes.length > 0 ? { note: notes.join("。") } : {}), level: "simple", fields, actions }];

  if (STATEMENTS.has(rec.kind)) {
    const c1 = rec.months?.category1;
    groups.push({
      key: `${prefix}/exempt`,
      title: `${who}の国民年金の免除・猶予（これまで）`,
      note: "定期便の加入期間の欄（第1号被保険者の月数と、免除・猶予の月数）を写します。追納した月は納付済みに数えます",
      level: c1 !== undefined ? "simple" : "detail",
      fields:
        c1 === undefined
          ? []
          : EXEMPT.map(([k, label]) =>
              plain({ key: `${prefix}/c1/${k}`, item: "pensionRecord.months", label, level: "simple", kind: "int", suffix: "か月", min: 0, max: 480, find, path: ["months", "category1", k], optional: k !== "paid" }),
            ),
      actions:
        c1 === undefined
          ? [
              {
                key: `${prefix}/c1/add`,
                label: "＋ 免除・猶予の月を入れる",
                level: "simple",
                run: (w) =>
                  mutate(w, (hh) => {
                    const r = recordOf(hh, m.id) as PensionRecord;
                    r.months = { ...(r.months ?? { basic: 0, employee: 0 }), category1: { paid: 0 } };
                  }),
              },
            ]
          : [
              removeAction(`${prefix}/c1/remove`, "免除・猶予の内訳を外す", "detail", (hh) => {
                const r = recordOf(hh, m.id) as PensionRecord;
                if (r.months !== undefined) delete r.months.category1;
              }),
            ],
    });
  }

  if (rec.kind === "history") {
    (rec.history ?? []).forEach((row, i) => {
      const findRow: Finder = (hh) => (recordOf(hh, m.id)?.history?.[i] as Record<string, unknown> | undefined) ?? undefined;
      const rp = `${prefix}/history/${i}`;
      groups.push({
        key: rp,
        title: `${who}の加入歴 ${i + 1}`,
        level: "detail",
        fields: [
          plain({ key: `${rp}/from`, item: "pensionRecord.history", label: "始まり", level: "detail", kind: "ym", find: findRow, path: ["from"] }),
          plain({ key: `${rp}/to`, item: "pensionRecord.history", label: "終わり", level: "detail", kind: "ym", find: findRow, path: ["to"] }),
          plain({ key: `${rp}/category`, item: "pensionRecord.history", label: "加入の種類", level: "detail", kind: "select", options: HISTORY_CATEGORIES, find: findRow, path: ["category"] }),
          ...(row.category === "employee"
            ? [plain({ key: `${rp}/avg`, item: "pensionRecord.history", label: "平均標準報酬額（月額・今の水準）", level: "detail", kind: "yen", basis: "monthly", find: findRow, path: ["averageRemuneration"], optional: true })]
            : []),
        ],
        actions: [
          removeAction(`${rp}/remove`, "この行を外す", "detail", (hh) => {
            const r = recordOf(hh, m.id) as PensionRecord;
            r.history = (r.history ?? []).filter((_, j) => j !== i);
          }),
        ],
      });
    });
    groups.push({
      key: `${prefix}/history/add`,
      level: "detail",
      fields: [],
      actions: [
        {
          key: `${prefix}/history/addRow`,
          label: "＋ 加入歴の行を足す",
          level: "detail",
          run: (w) =>
            mutate(w, (hh) => {
              const r = recordOf(hh, m.id) as PensionRecord;
              const last = (r.history ?? []).at(-1)?.to ?? addMonths(ageReachedMonth(m, 20), 0);
              (r.history ??= []).push({ from: addMonths(last, 1), to: r.asOf ?? base, category: "national1" });
            }),
        },
      ],
    });
  }
  return groups;
}

// ---- 受け取っている遺族年金・障害年金（お金の行。0044・0066） ----

export const RECEIVING_TYPES: readonly { value: ReceivingPensionType; label: string; survivor: boolean }[] = [
  { value: "survivorBasic", label: "遺族基礎年金", survivor: true },
  { value: "survivorEmployee", label: "遺族厚生年金", survivor: true },
  { value: "widow", label: "寡婦年金", survivor: true },
  { value: "disabilityBasic", label: "障害基礎年金", survivor: false },
  { value: "disabilityEmployee", label: "障害厚生年金", survivor: false },
];
const typeLabel = (t: ReceivingPensionType | undefined) => RECEIVING_TYPES.find((x) => x.value === t)?.label;
const isSurvivorType = (t: ReceivingPensionType | undefined) => RECEIVING_TYPES.find((x) => x.value === t)?.survivor === true;

/** 受け取っている年金の行の終わりの値の状態の行の鍵と当て先 */
const END_ROW = "incomeFlow.to";
const toAddress = (flowId: string): Address => ({ target: { object: flowId }, item: "incomeFlow.to", at: [] });

/** 受け取っている年金の行（種類が survivorPension の入るお金の行） */
export const receivingRows = (h: Household): IncomeFlow[] => (h.incomeFlows ?? []).filter((f) => f.kind === "survivorPension");

/** いちばん下の子（世帯の中の生まれている子） */
function youngestChild(h: Household): Member | undefined {
  return h.members.filter((m) => m.kind === "child" && m.outside === undefined && m.expected !== true).sort((a, b) => (a.birth.birthYearMonth < b.birth.birthYearMonth ? 1 : -1))[0];
}

/**
 * 受け取っている年金の終わりの推定（今の制度の決まり）: 遺族基礎年金は末子が18歳になった年度の末、寡婦年金は65歳になった月、
 * 30歳未満で子のない人の遺族厚生年金は5年、ほかは続く（null）。根拠の文は種類ごとに違う（種類を変えたら入れ直す）
 */
export function receivingEnd(h: Household, f: Pick<IncomeFlow, "pensionType" | "recipient" | "from">): { to: Timepoint | null; basis: string } {
  const t = f.pensionType;
  const r = h.members.find((m) => m.id === f.recipient);
  const label = typeLabel(t) ?? "受け取っている年金";
  if (t === "survivorBasic") {
    const c = youngestChild(h);
    if (c !== undefined) {
      const to: Timepoint = { memberAge: { member: c.id, years: 18, ageSwitch: "firstMarch31AfterReach" } };
      return { to, basis: `${label}は、いちばん下の子が18歳になった年度の末（${formatYearMonth(resolveTimepoint(h, to) ?? "")}）まで（今の制度）` };
    }
    return { to: null, basis: `${label}: 子が入っていないので終わりを決められません。終わりを入れてください` };
  }
  if (t === "widow" && r !== undefined) {
    const to: Timepoint = { memberAge: { member: r.id, years: 65, ageSwitch: "reachMonth" } };
    return { to, basis: `${label}は、65歳になった月（${formatYearMonth(resolveTimepoint(h, to) ?? "")}）まで（今の制度）` };
  }
  if (t === "survivorEmployee" && r !== undefined && youngestChild(h) === undefined) {
    const from = resolveTimepoint(h, f.from);
    if (from !== null && ageAt(r, from) < 30) return { to: { at: addMonths(from, 59) }, basis: `${label}は、30歳未満で子のない人は5年（今の制度）` };
  }
  return { to: null, basis: `${label}は続く（再婚などで終わるときは終わりを入れてください）` };
}

/**
 * 終わりを推定のまま入れ直す（行が推定〔出どころ auto〕か、まだ行も終わりも無いとき）。target はお金の行そのもの。
 * 推定が「続く」（終わり無し）なら行を書かない（値の無い場所に行を書かない。0035 の12）
 */
function refreshEnd(h: Household, target: IncomeFlow): void {
  const states = { ...((target.valueStates as Obj | undefined) ?? {}) };
  const row = states[END_ROW] as StateRow | undefined;
  const auto = row !== undefined && row.state === "estimated" && row.origin.kind === "auto";
  if (!auto && !(row === undefined && target.to == null)) return;
  const e = receivingEnd(h, target);
  target.to = e.to;
  if (e.to === null) delete states[END_ROW];
  else states[END_ROW] = { state: "estimated", origin: { kind: "auto" }, estimate: { method: "standard", basis: e.basis } };
  if (Object.keys(states).length === 0) delete target.valueStates;
  else target.valueStates = states;
}

/** 受け取っている遺族年金・障害年金の行を足す（受け取る人は本人。今から。年額は未入力。終わりは種類の推定） */
export function addReceiving(wh: WorkingHousehold, type: ReceivingPensionType, id: string = newId()): WorkingHousehold {
  const self = wh.request.input.household.members.find((m) => m.kind === "self");
  return mutate(wh, (h, req) => {
    const f: IncomeFlow = {
      id,
      label: typeLabel(type) ?? "受給中の年金",
      kind: "survivorPension",
      pensionType: type,
      from: { at: req.input.baseMonth },
      to: null,
      everyYears: 1,
      amount: standardBox(0, "未入力（通知書の年額を入れてください。0円で計算中）"),
      ...(self !== undefined ? { recipient: self.id } : {}),
    };
    (h.incomeFlows ??= []).push(f);
    refreshEnd(h, f);
  });
}

/** 受け取る人が終わりより前に再婚する（配偶者の関係が始まる）月（遺族年金は受けられなくなる）。無ければ null */
function remarriageMonth(h: Household, f: IncomeFlow): string | null {
  if (!isSurvivorType(f.pensionType) || f.recipient === undefined) return null;
  const from = resolveTimepoint(h, f.from);
  const to = f.to == null ? null : resolveTimepoint(h, f.to);
  for (const r of h.relations ?? []) {
    if (r.type !== "spouse" || (r.a !== f.recipient && r.b !== f.recipient) || r.from === null) continue;
    const at = resolveTimepoint(h, r.from);
    if (at !== null && (from === null || at > from) && (to === null || at < to)) return at;
  }
  return null;
}

function receivingGroups(wh: WorkingHousehold, f: IncomeFlow): GroupDef[] {
  const h = wh.request.input.household;
  const find = byId((hh) => hh.incomeFlows, f.id);
  const k = `in/${f.id}`;
  const at = (item: string): (() => Address) => () => ({ target: { object: f.id }, item, at: [] });
  const withA = (x: FieldDef, a: () => Address): FieldDef => ({ ...x, address: a });
  const people = h.members.filter((m) => m.outside === undefined && m.expected !== true && (m.kind === "self" || m.kind === "spouse" || m.kind === "child")).map((m) => ({ value: m.id, label: memberLabel(wh, m.id) }));
  const self = h.members.find((m) => m.kind === "self");
  const ageOf = (hh: Household) => hh.members.find((m) => m.id === (f.recipient ?? self?.id));
  const remarry = remarriageMonth(h, f);
  const fields: FieldDef[] = [
    withA(plain({ key: `${k}/recipient`, item: "incomeFlow.recipient", label: "受け取る人", level: "simple", kind: "select", options: people, find, path: ["recipient"], after: (hh, t) => refreshEnd(hh, t as unknown as IncomeFlow) }), at("incomeFlow.recipient")),
    withA(
      plain({
        key: `${k}/pensionType`,
        item: "incomeFlow.pensionType",
        label: "種類",
        level: "simple",
        kind: "select",
        options: [...(f.pensionType === undefined ? [{ value: "", label: "（種類を選んでいません）" }] : []), ...RECEIVING_TYPES.map((x) => ({ value: x.value, label: x.label }))],
        find,
        path: ["pensionType"],
        optional: true,
        help: "種類で終わりの推定が決まります（推定のままの終わりは、種類を変えると入れ直します）",
        after: (hh, t) => {
          const x = t as unknown as IncomeFlow;
          // 名前が種類の名前のままなら、新しい種類の名前にする
          if (x.pensionType !== undefined && (x.label === undefined || RECEIVING_TYPES.some((r) => r.label === x.label))) x.label = typeLabel(x.pensionType) ?? x.label;
          refreshEnd(hh, x);
        },
      }),
      at("incomeFlow.pensionType"),
    ),
    withA(
      yenBox({ key: `${k}/amount`, item: "incomeFlow.amount", label: "年額（通知書の額）", level: "simple", basis: "annual", find, path: ["amount"], help: "年金決定通知書・年金額改定通知書の年額。遺族年金・障害年金は非課税なので、公的年金等の源泉徴収票には載りません。今の値段（計算の基準の年の価格）で入れます" }),
      at("incomeFlow.amount"),
    ),
    withA(timepointField({ key: `${k}/from`, item: "incomeFlow.from", label: "計算に入れる始まり", level: "simple", find, path: ["from"], ageOf, help: "今受け取っていれば計算の基準の月のまま" }), at("incomeFlow.from")),
    withA(
      timepointField({
        key: `${k}/to`,
        item: "incomeFlow.to",
        label: "終わり",
        level: "simple",
        find,
        path: ["to"],
        startPath: ["from"],
        optional: true,
        nullText: "続く（最後まで）",
        ageOf,
        ...(remarry !== null ? { warn: () => `${formatYearMonth(remarry)}に再婚（配偶者の関係の始まり）を入れています。遺族年金は再婚で受けられなくなります。終わりを合わせてください（自動では合わせません）` } : {}),
      }),
      at("incomeFlow.to"),
    ),
  ];
  const actions: ActionDef[] = [];
  if (remarry !== null)
    actions.push({
      key: `${k}/endAtRemarriage`,
      label: "終わりを再婚の月に合わせる",
      level: "simple",
      run: (w) =>
        mutate(w, (hh, req) => {
          const x = (hh.incomeFlows ?? []).find((y) => y.id === f.id);
          if (x === undefined) return;
          x.to = { at: remarry };
          putRow(req.input as unknown as Obj, toAddress(f.id), undefined);
        }),
    });
  actions.push(removeAction(`${k}/remove`, "外す", "simple", (hh) => void (hh.incomeFlows = (hh.incomeFlows ?? []).filter((x) => x.id !== f.id))));
  const name = f.label !== undefined && f.label !== "" ? f.label : (typeLabel(f.pensionType) ?? "受給中の遺族年金・障害年金");
  const amount = f.amount.value ?? 0;
  const head: GroupDef = {
    key: k,
    title: `入｜${name}（${memberLabel(wh, f.recipient ?? self?.id ?? "")}） ${amount > 0 ? `年${(Math.round(amount / 1000) / 10).toLocaleString("ja-JP")}万円` : "年額を入れてください"}`,
    note:
      isSurvivorType(f.pensionType) || f.pensionType === undefined
        ? "額だけで計算します（非課税）。65歳からの自分の老齢厚生年金との調整（老齢厚生年金を先に受け、遺族厚生年金は差額）と、再婚などで受けられなくなることは計算に入っていません。65歳から額が変わるときは、詳細の段階で入れてください"
        : "額だけで計算します（非課税）。65歳からの老齢年金との組み合わせ（手取りの多い方を選ぶ）は計算に入っていません。65歳から額が変わるときは、詳細の段階で入れてください",
    level: "simple",
    fields,
    actions,
  };
  // 詳細（課税の扱い・伸び方・万一のときの扱い・表の行・段階と例外の年）はお金の行の部品のまま。受け取る人は上に出したので外す
  const detail = incomeGroups(wh, f, "pension")
    .slice(1)
    .map((g) => ({ ...g, fields: g.fields.filter((x) => x.key !== `${k}/recipient`) }));
  return [head, ...detail];
}

function receivingSection(wh: WorkingHousehold): SectionDef {
  const h = wh.request.input.household;
  const rows = receivingRows(h);
  const kids = youngestChild(h) !== undefined;
  return {
    key: "pension/receiving",
    title: "受け取っている遺族年金・障害年金",
    note: rows.length === 0 ? "まだありません（受け取っていれば、通知書の年額を入れます。万一のときの遺族年金・障害年金は万一の画面で見ます）" : "通知書の年額で入れます。万一のときの遺族年金・障害年金は万一の画面で見ます",
    level: "simple",
    groups: rows.flatMap((f) => receivingGroups(wh, f)),
    actions: [
      { key: "pension/receiving/add/survivor", label: "＋ 遺族年金を受け取っている", level: "simple", run: (w) => addReceiving(w, kids ? "survivorBasic" : "survivorEmployee") },
      { key: "pension/receiving/add/disability", label: "＋ 障害年金を受け取っている", level: "simple", run: (w) => addReceiving(w, "disabilityBasic") },
    ],
  };
}

// ---- カード ----

/** 年金のカードに出す人（本人・配偶者。世帯の外の家族の年金は介護・親のカード） */
export const pensionMembers = (h: Household): Member[] => earners(h).filter((m) => (m.kind === "self" || m.kind === "spouse") && m.expected !== true && m.outside === undefined);

export function pensionStage(wh: WorkingHousehold): StageDef {
  const h = wh.request.input.household;
  const sections: SectionDef[] = pensionMembers(h).map((m) => {
    const groups = recordGroups(wh, m);
    // 読むだけの1行: 企業年金・基金・退職金は退職金・企業年金のカード
    const benefits = (h.retirementBenefits ?? []).filter((b) => b.member === m.id);
    const ro = readGroup(`pension/${m.id}/benefits`, undefined, benefits.length > 0 ? [readLine(`pension/${m.id}/benefits`, "退職金・企業年金・基金", `${String(benefits.length)}件`, "退職金・企業年金")] : []);
    return { key: `pension/${m.id}`, title: memberLabel(wh, m.id), level: "simple" as const, groups: ro === null ? groups : [...groups, ro], actions: [] };
  });
  sections.push(receivingSection(wh));
  // 外国の年金（お金の行。円の額で。雑所得）。受け取っている遺族年金・障害年金は上の区画に出す
  const receiving = new Set(receivingRows(h).map((f) => f.id));
  for (const s of moneySections(wh, "pension", { claimed: receiving, level: "simple", inTitle: "外国の年金（円の額で）" }))
    sections.push({ ...s, ...(s.groups.length === 0 ? { note: "まだありません（外国で働いた期間の年金は、円に直した年額で入れます。課税は雑所得〔公的年金等〕）" } : {}), actions: s.actions.filter((a) => !a.key.endsWith("/survivorPension")) });
  return { id: "pension", label: "年金", lead: "ねんきん定期便・年金額改定通知書の数字を写します。無ければ働き方から推計します。", sections };
}
