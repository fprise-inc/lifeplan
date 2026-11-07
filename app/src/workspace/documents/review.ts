// 書類の確かめの画面の中身（0148 の2）: 読み取りの記録1通と今の世帯から、確かめの画面の行（共通の部品 review/rows.ts の形）と
// 新しい物・照合だけの値・知らせを作り、FP の操作（承認・まとめて承認・直す・入れない・物を足す・名義を選ぶ）を世帯と記録に当てる。
// 行は毎回作る（保存しない）。世帯の値を変える操作は新しい世帯（元に戻せる変更）と新しい記録の両方を返し、呼ぶ側が記録を先に入れる
import { sameVal, type FieldDef, type Val } from "../input/form.ts";
import type { WorkingHousehold } from "../input/household.ts";
import { addMonths } from "../levers.ts";
import { fieldValueText } from "../plans/planEdit.ts";
import { roles } from "../roles.ts";
import { STATUS_LABELS, fieldStatus } from "../input/valueState.ts";
import { formatYearMonth, parseInteger, parseYearMonth, rateFromPct, readYen } from "../input/units.ts";
import { findObject } from "../store/readings.ts";
import { CERTAINTY_LABELS, valueMeta } from "../input/checkRows.ts";
import { bulkEligible, type Compare, type ReviewRow, type RowEdit } from "../review/rows.ts";
import { coerce, createObject, metaFor, periodMismatch, writeFromDocument } from "./apply.ts";
import { NEW_OBJECT_KINDS } from "./objects.ts";
import { cleanValue, isPersonalNumberValue } from "./privacy.ts";
import { fieldPlaces, memberIdOf, placeByKey, resolveTarget, type FieldPlace, type Resolution } from "./resolve.ts";
import { readingScore, scoreTotals } from "./score.ts";
import { insuranceGaps, type GapList } from "./insuranceGaps.ts";
import { ITEM_LABELS } from "../../generated/labels.ts";
import { CONFIDENCE_LABELS, docTypeLabel, LIMITS, VIA_LABELS, type CandidateValue, type DocCandidate, type DocObject, type DocumentReading } from "./types.ts";

type Obj = Record<string, unknown>;

/** 当てる欄を FP が選んだ物（候補の ID → 欄のキー。画面の中だけ） */
export type Chosen = Readonly<Record<string, string>>;

export interface ObjectView {
  key: string;
  label: string;
  status: DocObject["status"];
  confidence: string;
  where: string | null;
  /** 同じ契約かもしれない今ある物の名前（黙ってまとめない。知らせるだけ） */
  similar: string[];
  /** 当てられる今ある物（「今の○○に当てる」。0154 の3） */
  links: LinkTarget[];
  /** 今ある物の呼び名（「今の住宅ローンに当てる」の「住宅ローン」） */
  noun: string;
  /** 今ある物に当てた（足していない）ときの、その物の名前 */
  linkedTo: string | null;
}

export interface ReferenceView {
  id: string;
  label: string;
  amount: number;
  /** アプリの計算（その年・名義の人の分）。比べられなければ null */
  calc: number | null;
  where: string | null;
}

export interface RowGroup {
  key: string;
  label: string;
  object: ObjectView | null;
  rows: ReviewRow[];
}

export interface DocReview {
  title: string;
  via: string;
  asOf: string | null;
  holder: string | null;
  holderOptions: { id: string; label: string }[];
  /** 名義の人が要る候補がある（名義を選ぶまで承認できない） */
  needsHolder: boolean;
  groups: RowGroup[];
  references: ReferenceView[];
  notices: string[];
  /** まとめて承認に入る行の ID */
  bulk: string[];
  pending: number;
  score: { matched: number; corrected: number; unreadable: number };
  /** 保険の入れ漏れの一覧（新しい保険の契約の候補がある書類だけ。0153 の3） */
  gaps: GapList | null;
}

/** 計算の結果の行の額（照合の値と比べる。その年・その人の分の合計。無ければ null） */
export type CalcOf = (row: string, year: number, member: string | null) => number | null;

const created = (r: DocumentReading): Map<string, string> => new Map(r.objects.flatMap((o) => (o.created !== undefined ? [[o.key, o.created] as const] : [])));

/**
 * 当てる欄が何本もあるとき、選択肢の値の候補は、その値を選択肢に持つ欄に絞る（年金の「入れ方」と「書類の種類」のように、同じ入力項目の
 * 選択の欄が2つあるとき。0152 の3）。1本に決まれば当てる
 */
function bySelectValue(res: Resolution, c: DocCandidate): Resolution {
  if (res.kind !== "choose" || typeof c.value !== "string") return res;
  const v = c.value;
  const fit = res.places.filter((p) => p.field.kind === "select" && p.field.options.some((o) => o.value === v));
  if (fit.length === 1) return { kind: "field", place: fit[0] as FieldPlace };
  return fit.length > 1 ? { kind: "choose", places: fit } : res;
}

/**
 * 当てる欄が何本もあるとき、候補の値の形で入れられる欄に絞る（口座の「毎月の積立」〔円〕と「積立の終わり」〔時点〕のように、同じ入力項目の
 * 場所の無い欄が2つあるとき。0154 の4）。1本に決まれば当てる
 */
function byValueShape(wh: WorkingHousehold, res: Resolution, r: DocumentReading, c: DocCandidate): Resolution {
  // 人も物も書かない候補は、どの物の値かを書類からは決めない（1本でも FP が選ぶ。0152 の3）
  const t = c.target;
  if (res.kind !== "choose" || c.value === null || (t.member === undefined && t.object === undefined && t.newObject === undefined)) return res;
  const v = c.value;
  const fit = res.places.filter((p) => coerce(wh, r, p.field, v).ok);
  if (fit.length === 1) return { kind: "field", place: fit[0] as FieldPlace };
  return fit.length > 1 && fit.length < res.places.length ? { kind: "choose", places: fit } : res;
}

function resolve(wh: WorkingHousehold, places: readonly FieldPlace[], r: DocumentReading, c: DocCandidate, chosen: Chosen, made: ReadonlyMap<string, string> = created(r)): Resolution {
  const res = byValueShape(wh, bySelectValue(resolveTarget(wh, places, r, c.target, made), c), r, c);
  const pick = chosen[c.id] ?? null;
  if (res.kind === "choose" && pick !== null) {
    const p = res.places.find((x) => x.field.key === pick);
    if (p !== undefined) return { kind: "field", place: p };
  }
  return res;
}

const editOf = (f: FieldDef): RowEdit | null => {
  switch (f.kind) {
    case "yen":
      return { kind: "yen", unit: (f.unit ?? "man") === "man" ? "万円" : "円" };
    case "int":
      return { kind: "int", ...(f.suffix !== undefined ? { unit: f.suffix } : {}) };
    case "pct":
      return { kind: "pct", unit: "%" };
    case "decimal":
      return { kind: "decimal", ...(f.suffix !== undefined ? { unit: f.suffix } : {}) };
    case "select":
      return { kind: "select", options: f.options.map((o) => ({ value: o.value, label: o.label })) };
    case "ym":
      return { kind: "ym" };
    case "bool":
      return { kind: "bool" };
    case "text":
      return { kind: "text" };
    case "when":
      return { kind: "ym" };
  }
};

function compareOf(wh: WorkingHousehold, f: FieldDef, v: Val): Compare {
  const st = fieldStatus(f, wh);
  const cur = f.get(wh).value;
  if (cur === null || cur === "") return "fill";
  if (st.status === "confirmed") {
    return sameVal(cur, v, f.kind) ? "same" : "conflict";
  }
  if (st.status === "notApplicable") return "conflict";
  return "fill";
}

/**
 * 欄の値の言葉。円は書類と見比べられるように円の単位で丸めずに書く（入力の画面の「年32万円」のような丸めをしない）。ほかは入力の画面と同じ言葉
 */
function valueText(f: FieldDef, v: Val, wh: WorkingHousehold): string {
  if (f.kind === "yen" && typeof v === "number") return `${f.basis === "monthly" ? "月" : f.basis === "annual" ? "年" : ""}${v.toLocaleString("ja-JP")}円`;
  return fieldValueText(f, v, wh);
}

/** 欄に当てる前の値の言葉（書類の名義の人を指す値は、名義を選ぶまで「書類の名義の人」と見せる） */
const rawText = (v: CandidateValue | null): string | null => (v === null ? null : typeof v === "boolean" ? (v ? "はい" : "いいえ") : v === "holder" ? "書類の名義の人" : String(v));

function rowOf(wh: WorkingHousehold, places: readonly FieldPlace[], r: DocumentReading, c: DocCandidate, chosen: Chosen, made?: ReadonlyMap<string, string>): ReviewRow {
  const res = resolve(wh, places, r, c, chosen, made);
  const source = { where: [c.source.page !== undefined ? `${c.source.page}ページ` : null, c.source.where ?? null].filter((x) => x !== null).join("・") || null, text: c.source.text ?? null };
  const base = { id: c.id, source, confidence: c.confidence, status: c.status, note: c.note ?? null, decidedBy: null };
  if (res.kind !== "field") {
    const label = res.kind === "choose" ? (res.places[0]?.field.label ?? itemLabel(c.target.item)) : itemLabel(c.target.item);
    return {
      ...base,
      group: c.target.newObject !== undefined ? (objectLabel(r, c.target.newObject) ?? "新しい物") : res.kind === "choose" ? (res.places[0]?.cardLabel ?? "") : "当てる欄が無い候補",
      label,
      current: null,
      incoming: { text: rawText(c.value), unreadable: c.unreadable === true },
      compare: null,
      problem: res.kind === "choose" ? "当てる欄を選んでください" : res.reason,
      correctable: false,
      structural: false,
      edit: null,
      ...(res.kind === "choose" ? { choices: res.places.map((p) => ({ id: p.field.key, label: `${p.cardLabel} › ${p.label}` })), chosen: chosen[c.id] ?? null } : {}),
    };
  }
  const { place } = res;
  const f = place.field;
  const st = fieldStatus(f, wh);
  const curVal = f.get(wh).value;
  const empty = curVal === null || curVal === "";
  const meta = valueMeta(f, wh);
  const current = {
    text: st.status === "missing" || empty ? null : valueText(f, curVal, wh),
    status: empty && st.status === "confirmed" ? null : `${STATUS_LABELS[st.status]}${st.status === "confirmed" && meta.certainty !== null ? `・${CERTAINTY_LABELS[meta.certainty]}` : ""}`,
  };
  const decidedValue = c.status === "corrected" ? (c.decided?.value ?? null) : c.value;
  const co = decidedValue === null ? null : coerce(wh, r, f, decidedValue);
  const incomingText = co === null ? null : co.ok ? valueText(f, co.value, wh) : rawText(decidedValue);
  const problem = c.unreadable === true && c.status === "pending" ? "読めませんでした。書類を見て「直す」で入れてください" : co !== null && !co.ok ? co.reason : periodMismatch(f, c);
  const edit = editOf(f);
  const row: ReviewRow = {
    ...base,
    group: c.target.newObject !== undefined ? (objectLabel(r, c.target.newObject) ?? place.cardLabel) : groupLabel(wh, place),
    label: place.label,
    current,
    incoming: { text: incomingText, unreadable: c.unreadable === true },
    compare: co !== null && co.ok ? compareOf(wh, f, co.value) : null,
    problem,
    correctable: edit !== null,
    structural: f.structural === true,
    edit,
    ...(chosen[c.id] !== undefined ? { chosen: chosen[c.id] as string } : {}),
  };
  if ((c.status === "accepted" || c.status === "corrected") && co !== null && co.ok) row.changedSince = row.compare !== "same";
  return row;
}

/** 入力項目の短い名前（登録簿の名前。当てる欄が無いときの行の名前） */
const itemLabel = (item: string): string => ITEM_LABELS[item] ?? item;

/** まとまりの見出し（カード › 物の名前か、まとまりの名前の前の部分） */
function groupLabel(wh: WorkingHousehold, p: FieldPlace): string {
  const t = p.address?.target;
  const o = t !== undefined && "object" in t ? findObject(wh.request.input as unknown as Obj, t.object) : undefined;
  const name = typeof o?.label === "string" && o.label !== "" ? o.label : null;
  return name !== null ? `${p.cardLabel} › ${name}` : p.cardLabel;
}

function objectLabel(r: DocumentReading, key: string): string | null {
  const o = r.objects.find((x) => x.key === key);
  if (o === undefined) return null;
  const name = r.candidates.find((c) => c.target.newObject === key && c.target.item === "insurance.label" && typeof c.value === "string")?.value ?? (o.kind.startsWith("insurance:") ? undefined : o.source.text);
  // 今ある物に当てた物は「書類の○○」（新しく足していない）
  const kind = o.linked === true ? `書類の${NEW_OBJECT_KINDS[o.kind]?.noun ?? "物"}` : (NEW_OBJECT_KINDS[o.kind]?.label ?? "新しい物");
  return typeof name === "string" && name !== "" ? `${kind}: ${name}` : kind;
}

/** 今ある物の名前（名前が無ければ種類と持ち主） */
function existingLabel(wh: WorkingHousehold, kind: string, x: Obj): string {
  const k = NEW_OBJECT_KINDS[kind];
  if (typeof x.label === "string" && x.label !== "") return x.label;
  const noun = kind.startsWith("insurance:") ? (k?.label.replace(/^新しい保険契約（(.*)）$/u, "$1") ?? "契約") : (k?.noun ?? "物");
  const names = new Map(roles(wh.request).map((m) => [m.member.id, m.label]));
  const who = (k?.ownerOf(x) ?? []).map((m) => names.get(m)).find((n) => n !== undefined);
  return who !== undefined ? `${noun}（${who}）` : noun;
}

export interface LinkTarget {
  id: string;
  label: string;
}

/**
 * 物の候補を当てられる今ある物（同じ集まり・同じ種類。書類の名義の人の物を先に）。この記録のほかの物の候補で足した・当てた物も含める
 * （1通の書類の何件かの契約が同じ今の物になることは無いが、選ぶのは FP）
 */
export function linkTargets(wh: WorkingHousehold, r: DocumentReading, o: DocObject): LinkTarget[] {
  const k = NEW_OBJECT_KINDS[o.kind];
  if (k === undefined) return [];
  const list = (wh.request.input.household as unknown as Obj)[k.collection];
  if (!Array.isArray(list)) return [];
  const own = (x: Obj) => r.holder !== undefined && k.ownerOf(x).includes(r.holder);
  return (list as Obj[])
    .filter((x) => typeof x.id === "string" && k.sameKind(x))
    .sort((a, b) => Number(own(b)) - Number(own(a)))
    .map((x) => ({ id: x.id as string, label: existingLabel(wh, o.kind, x) }));
}

/** 同じ物かもしれない今ある物（同じ集まり・同じ種類で、名義の人の物。名義を選ぶ前は同じ種類の物の全部。保険は被保険者か契約者） */
function similarOf(wh: WorkingHousehold, r: DocumentReading, o: DocObject): string[] {
  const k = NEW_OBJECT_KINDS[o.kind];
  if (k === undefined || o.status === "accepted") return [];
  const list = (wh.request.input.household as unknown as Obj)[k.collection];
  if (!Array.isArray(list)) return [];
  return (list as Obj[]).filter((x) => k.sameKind(x) && (r.holder === undefined || k.ownerOf(x).includes(r.holder))).map((x) => existingLabel(wh, o.kind, x));
}

/** 当てた今ある物の名前（世帯から外れていれば null） */
function linkedName(wh: WorkingHousehold, o: DocObject): string | null {
  const k = NEW_OBJECT_KINDS[o.kind];
  const list = k === undefined ? undefined : (wh.request.input.household as unknown as Obj)[k.collection];
  const x = Array.isArray(list) ? (list as Obj[]).find((y) => y.id === o.created) : undefined;
  return x === undefined ? null : existingLabel(wh, o.kind, x);
}

/** 確かめの画面の中身を作る */
export function docReview(wh: WorkingHousehold, r: DocumentReading, chosen: Chosen = {}, calc: CalcOf | null = null, others: readonly DocumentReading[] = []): DocReview {
  const places = fieldPlaces(wh);
  const groups = new Map<string, RowGroup>();
  const objectViews = new Map<string, ObjectView>();
  const gaps = insuranceGaps(wh, r);
  for (const o of r.objects) {
    // 同じ契約かもしれない今ある物: 同じ種類・同じ人の物と、入れ漏れの一覧で保険会社・種類・契約年月・保険料の2つ以上が合った物（0153 の3）
    const matched = o.status === "pending" ? (gaps?.rows.find((g) => g.key === o.key)?.matches.map((m) => m.label) ?? []) : [];
    objectViews.set(o.key, {
      key: o.key,
      label: objectLabel(r, o.key) ?? "新しい物",
      status: o.status,
      confidence: CONFIDENCE_LABELS[o.confidence],
      where: o.source.where ?? null,
      similar: [...new Set([...similarOf(wh, r, o), ...matched])],
      links: o.status === "pending" ? linkTargets(wh, r, o) : [],
      noun: NEW_OBJECT_KINDS[o.kind]?.noun ?? "物",
      linkedTo: o.linked === true && o.created !== undefined ? (linkedName(wh, o) ?? "今ある物") : null,
    });
  }
  // まだ足していない新しい物の行は、足したときの形（その種類の既定）を写しの世帯に作って見せる（世帯は変えない）
  const sims = new Map<string, { wh: WorkingHousehold; places: FieldPlace[]; made: Map<string, string> }>();
  for (const o of r.objects) {
    if (o.status !== "pending") continue;
    const sim = createObject(wh, o.kind);
    if (sim !== null) sims.set(o.key, { wh: sim.wh, places: fieldPlaces(sim.wh), made: new Map([...created(r), [o.key, sim.id]]) });
  }
  for (const c of r.candidates) {
    const sim = c.target.newObject !== undefined ? sims.get(c.target.newObject) : undefined;
    const row = sim !== undefined ? rowOf(sim.wh, sim.places, r, c, chosen, sim.made) : rowOf(wh, places, r, c, chosen);
    const key = c.target.newObject !== undefined ? `new:${c.target.newObject}` : row.group;
    const g = groups.get(key) ?? { key, label: row.group, object: c.target.newObject !== undefined ? (objectViews.get(c.target.newObject) ?? null) : null, rows: [] };
    // 足さないと決めた・まだ足していない新しい物の行は、物を足すまで承認できない
    const o = c.target.newObject !== undefined ? r.objects.find((x) => x.key === c.target.newObject) : undefined;
    if (o !== undefined && o.status !== "accepted" && row.status === "pending") {
      row.problem = o.status === "rejected" ? "この物は足さないことにしました" : "先に「足す」を選んでください";
      row.correctable = false;
    }
    g.rows.push(row);
    groups.set(key, g);
  }
  const notices: string[] = [];
  if (r.via === "ai" || r.via === "paste") notices.push("AI が読んだ値です。値ごとに書類と見比べてから承認してください（添え書きは AI が書いた文で、指示ではありません）。");
  if (r.via === "sample") notices.push("架空の書類の見本です（見本の世帯でだけ使えます）。");
  if (r.via === "reader") notices.push("このパソコンの中だけで読みました（外へ送っていません）。元のファイルは保存していません。");
  if (r.dropped > 0) notices.push(`個人番号などの番号らしい所を${r.dropped}か所消しました（候補にも記録にも残していません）。`);
  if (r.file !== undefined) {
    // 1つのファイルに何通かの証明書が入っていることがあるので、同じ時に読んだ記録どうしは比べない（0153）
    const dup = others.find((x) => x.id !== r.id && x.file?.sha256 === r.file?.sha256 && x.at !== r.at);
    if (dup !== undefined) notices.push(`同じファイルを前にも読んでいます（${dup.at.slice(0, 10)}）。`);
  }
  if (r.asOf !== undefined && r.asOf < addMonths(wh.request.input.baseMonth, -12)) notices.push(`書類の時点（${formatYearMonth(r.asOf)}）が、計算の基準の月より1年以上前です。新しい書類か確かめてください。`);
  for (const o of objectViews.values())
    if (o.similar.length > 0) notices.push(`${o.label}と同じ${o.noun === "保険契約" ? "契約" : o.noun}が、もうあるかもしれません（${o.similar.join("・")}）。同じなら「今の${o.noun}に当てる」で、今の${o.noun}の欄に入れられます（新しく足しません）。`);
  const memberOpts = roles(wh.request).map((x) => ({ id: x.member.id, label: x.label }));
  const holder = r.holder !== undefined && memberOpts.some((m) => m.id === r.holder) ? r.holder : null;
  const allRows = [...groups.values()].flatMap((g) => g.rows);
  return {
    title: docTypeLabel(r.docType),
    via: VIA_LABELS[r.via] + (r.ai !== undefined ? `（${r.ai.connector}）` : ""),
    asOf: r.asOf ?? null,
    holder,
    holderOptions: memberOpts,
    needsHolder: r.candidates.some((c) => c.status === "pending" && c.target.member === "holder") && holder === null,
    groups: [...groups.values()],
    references: r.references.map((x) => ({ id: x.id, label: x.label, amount: x.amount, calc: calc !== null && x.row !== undefined && x.year !== undefined ? calc(x.row, x.year, holder) : null, where: x.source.where ?? null })),
    notices,
    bulk: allRows.filter(bulkEligible).map((x) => x.id),
    pending: allRows.filter((x) => x.status === "pending").length + r.objects.filter((o) => o.status === "pending").length,
    score: scoreTotals(readingScore(r)),
    gaps,
  };
}

// ---- 操作 ----

export interface Applied {
  wh: WorkingHousehold;
  reading: DocumentReading;
  /** 入れた候補の数 */
  count: number;
  /** 入れられなかった候補の理由 */
  failed: string[];
}

const withCandidate = (r: DocumentReading, id: string, f: (c: DocCandidate) => DocCandidate): DocumentReading => ({ ...r, candidates: r.candidates.map((c) => (c.id === id ? f(c) : c)) });

const appliedTo = (p: FieldPlace): NonNullable<DocCandidate["decided"]>["to"] => (p.address === null ? undefined : (structuredClone(p.address) as NonNullable<DocCandidate["decided"]>["to"]));

/**
 * 候補を書類の値のまま承認する（1つでも、まとめてでも）。承認できない候補（理由のある行）は飛ばして failed に入れる
 */
export function acceptCandidates(wh: WorkingHousehold, r: DocumentReading, ids: readonly string[], chosen: Chosen, at: string): Applied {
  let w = wh;
  let reading = r;
  let count = 0;
  const failed: string[] = [];
  // 欄の定義は世帯を引数に読み書きするので、値を入れても作り直さない（物を足したときだけ作り直す。acceptObject の後は呼ぶ側が作り直す）
  const places = fieldPlaces(w);
  for (const id of ids) {
    const c = reading.candidates.find((x) => x.id === id);
    if (c === undefined || c.status !== "pending" || c.value === null) continue;
    if (c.target.newObject !== undefined && reading.objects.find((o) => o.key === c.target.newObject)?.status !== "accepted") {
      failed.push("足していない物の候補");
      continue;
    }
    const res = resolve(w, places, reading, c, chosen);
    if (res.kind !== "field") {
      failed.push(res.kind === "choose" ? "当てる欄を選んでいない候補" : res.reason);
      continue;
    }
    const f = res.place.field;
    const co = coerce(w, reading, f, c.value);
    const mismatch = periodMismatch(f, c);
    if (!co.ok || mismatch !== null) {
      failed.push(co.ok ? (mismatch as string) : co.reason);
      continue;
    }
    const next = writeFromDocument(w, f, co.value, metaFor(reading, c, at, "accept"));
    if (next === w && JSON.stringify(f.get(w).value) !== JSON.stringify(co.value)) {
      failed.push("欄に書けませんでした");
      continue;
    }
    w = next;
    const to = appliedTo(res.place);
    reading = withCandidate(reading, id, (x) => ({ ...x, status: "accepted", decided: { at, ...(to !== undefined ? { to } : {}) } }));
    count++;
  }
  return { wh: w, reading, count, failed: [...new Set(failed)] };
}

/** 直した文字を欄の値にする（読めなければ理由） */
export function parseEdit(wh: WorkingHousehold, r: DocumentReading, f: FieldDef, text: string): { ok: true; value: Val; stored: CandidateValue } | { ok: false; reason: string } {
  const t = text.trim();
  if (t === "") return { ok: false, reason: "値を入れてください" };
  if (isPersonalNumberValue(t)) return { ok: false, reason: "番号らしい値は入れられません" };
  let v: Val | null = null;
  switch (f.kind) {
    case "yen": {
      const y = readYen(t, f.unit ?? "man");
      if (!y.ok) return { ok: false, reason: y.reason };
      v = y.yen;
      break;
    }
    case "int":
      v = parseInteger(t);
      break;
    case "pct":
      v = rateFromPct(t.replace(/[%％]$/u, ""));
      break;
    case "decimal":
      v = /^-?\d+(\.\d+)?$/u.test(t) ? t : null;
      break;
    case "ym":
    case "when":
      v = parseYearMonth(t);
      break;
    case "bool":
      v = t === "true" ? true : t === "false" ? false : null;
      break;
    case "select": {
      const c = coerce(wh, r, f, t);
      v = c.ok ? c.value : null;
      break;
    }
    case "text":
      v = cleanValue(t, LIMITS.textValue).text;
      break;
  }
  if (v === null || (typeof v === "object" && v !== null)) return { ok: false, reason: "この欄の値として読めません" };
  return { ok: true, value: v, stored: v as CandidateValue };
}

/** 候補を直して入れる（出どころは手で入れた・確かさは書類で確認） */
export function correctCandidate(wh: WorkingHousehold, r: DocumentReading, id: string, text: string, chosen: Chosen, at: string): Applied | { error: string } {
  const c = r.candidates.find((x) => x.id === id);
  if (c === undefined || c.status !== "pending") return { error: "この候補はもう決めています" };
  if (c.target.newObject !== undefined && r.objects.find((o) => o.key === c.target.newObject)?.status !== "accepted") return { error: "先に「足す」を選んでください" };
  const places = fieldPlaces(wh);
  const res = resolve(wh, places, r, c, chosen);
  if (res.kind !== "field") return { error: res.kind === "choose" ? "当てる欄を選んでください" : res.reason };
  const f = res.place.field;
  const p = parseEdit(wh, r, f, text);
  if (!p.ok) return { error: p.reason };
  const next = writeFromDocument(wh, f, p.value, metaFor(r, c, at, "correct"));
  if (next === wh && JSON.stringify(f.get(wh).value) !== JSON.stringify(p.value)) return { error: "欄に書けませんでした" };
  const to = appliedTo(res.place);
  const reading = withCandidate(r, id, (x) => ({ ...x, status: "corrected", decided: { at, value: p.stored, ...(to !== undefined ? { to } : {}) } }));
  return { wh: next, reading, count: 1, failed: [] };
}

/** 候補を入れない（世帯は変えない） */
export function rejectCandidates(r: DocumentReading, ids: readonly string[], at: string): DocumentReading {
  const set = new Set(ids);
  return { ...r, candidates: r.candidates.map((c) => (set.has(c.id) && c.status === "pending" ? { ...c, status: "rejected", decided: { at } } : c)) };
}

/** 入れないにした候補を未決に戻す */
export function reopenCandidate(r: DocumentReading, id: string): DocumentReading {
  return withCandidate(r, id, (c) => {
    if (c.status !== "rejected") return c;
    const { decided: _d, ...rest } = c;
    void _d;
    return { ...rest, status: "pending" };
  });
}

/** 新しい物を足す（その種類の「＋」と同じ既定で作る）。足せなければ null */
export function acceptObject(wh: WorkingHousehold, r: DocumentReading, key: string, at: string): Applied | null {
  const o = r.objects.find((x) => x.key === key);
  if (o === undefined || o.status !== "pending") return null;
  const made = createObject(wh, o.kind);
  if (made === null) return null;
  return { wh: made.wh, reading: { ...r, objects: r.objects.map((x) => (x.key === key ? { ...x, status: "accepted", created: made.id, decidedAt: at } : x)) }, count: 1, failed: [] };
}

/**
 * 新しい物を足さずに、今ある物に当てる（0154 の3）。その中の値の候補は、当てた物の欄に当たる（世帯は変えない。値は1つずつ承認する）。
 * 当てられない物（同じ種類でない・世帯に無い）なら null
 */
export function linkObject(wh: WorkingHousehold, r: DocumentReading, key: string, target: string, at: string): DocumentReading | null {
  const o = r.objects.find((x) => x.key === key);
  if (o === undefined || o.status !== "pending" || !linkTargets(wh, r, o).some((t) => t.id === target)) return null;
  return { ...r, objects: r.objects.map((x) => (x.key === key ? { ...x, status: "accepted", created: target, linked: true, decidedAt: at } : x)) };
}

/** 新しい物を足さない（その中の未決の値の候補も入れないにする） */
export function rejectObject(r: DocumentReading, key: string, at: string): DocumentReading {
  const objects = r.objects.map((x) => (x.key === key && x.status === "pending" ? { ...x, status: "rejected" as const, decidedAt: at } : x));
  return rejectCandidates({ ...r, objects }, r.candidates.filter((c) => c.target.newObject === key).map((c) => c.id), at);
}

/** 書類の名義の人を選ぶ（null は決めていない） */
export function withHolder(wh: WorkingHousehold, r: DocumentReading, member: string | null): DocumentReading {
  const { holder: _h, ...rest } = r;
  void _h;
  return member !== null && memberIdOf(wh, r, member) !== null ? { ...rest, holder: member } : rest;
}

/** 当てる欄の選択肢の欄（画面で選んだ欄のキー → 欄。テスト用） */
export const placeOf = (wh: WorkingHousehold, key: string): FieldPlace | undefined => placeByKey(fieldPlaces(wh), key);
