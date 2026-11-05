// ヒアリングシート（0018）を入力のホームにつなぐ部分（作業の層）。シートの読み書きは hearing/ の部品が行い、ここは
// 「今の世帯から書き出す」「取り込んだ候補を今の世帯と照らして、新規・変更・矛盾に分ける」「承認した候補を現状に入れる」を受け持つ。
// - 返ってきたシート（.xlsx）は信用しない（0018 の6）。読み込みの安全は hearing/ の部品（.xlsx だけ・マクロや外部リンクを読まない・
//   数式を評価しない・大きさの上限・管理の値の照合）に任せ、ここでは候補を FP が承認するまで現状に入れない
// - 承認した値には承認の記録（by: fp・日時・候補）を付ける（0008 の2・5。hearing の approveAll）
// - 推定・仮の印は、入力の画面と同じ形（値の箱の estimated・WorkingHousehold.assumed）で入れる
import { carryRows } from "../input/rows.ts";
import { approveAll, createHearingSheet, exportableSheets, importHearingSheet, keyLabel, latestSheet, requestIdFrom, type Answer, type Candidate, type ChecklistItem, type ConsentDraft, type FieldRecord, type HearingRequest, type ImportRecord, type Issue, type OfficeInfo, type SheetDefinition } from "../../../../hearing/src/index.ts";
import type { EngineRequest as HearingEngineRequest } from "../../../../hearing/src/types.ts";
import { fillsByEstimate } from "../../../../hearing/src/estimates.ts";
import type { EngineRequest, Household, Member } from "../../engine/types.ts";
import { endYearForAge, followedEndAge, type WorkingHousehold } from "../input/household.ts";
import { fillEducation } from "../input/fill.ts";
import { memberLabels } from "../input/labels.ts";
import { withDeathEstimate } from "../input/stages/care.ts";
import { withEntry } from "../input/stages/housingLoans.ts";
import { roles } from "../roles.ts";
import type { WebLogEntry } from "./web.ts";

/** 世帯ごとのヒアリングの記録（世帯ファイル 0011 の取り込みの記録・同意の記録に入れるまでの、画面の中の置き場） */
export interface HearingLog {
  /** 書き出した依頼の記録（取り込むときに、これを正にして読む。0018 の5） */
  requests: HearingRequest[];
  /** 取り込みの記録（伏せ字の処理はまだ。元の .xlsx は持たない） */
  imports: (ImportRecord & { approvedAt: string })[];
  /** 同意の記録の下書き（0014。承認したときの日時つき） */
  consents: (ConsentDraft & { at: string })[];
  /** Web のヒアリングの依頼（0125。鍵の組・合言葉・受け取った答えと書類。世帯ファイルの中だけ。無い世帯は欄を持たない） */
  web?: WebLogEntry[];
}

export const emptyLog = (): HearingLog => ({ requests: [], imports: [], consents: [] });

export function logOf(wh: WorkingHousehold): HearingLog {
  return wh.hearing ?? emptyLog();
}

// ---- 書き出し ----

export interface ExportInput {
  definition: SheetDefinition;
  /** 前回の値を記入するか（0018 の9。暗号化されないシートに金額が載るので、画面で毎回警告してから） */
  prefill: boolean;
  /** 表示用の顧客番号（英数字・ハイフン・下線。氏名は入れない） */
  customerNo: string;
  office: OfficeInfo;
  appVersion: string;
  /** 書き出す日（YYYY-MM-DD） */
  exportedOn: string;
  /** 依頼番号の乱数（6バイト以上。アプリの側で作る） */
  random: Uint8Array;
  /** この世帯でお願いしたい書類（書類のお願いの一覧の見出し。1枚目の後ろに載る。0102） */
  requestedDocuments?: readonly string[];
}

export interface ExportOutput {
  bytes: Uint8Array;
  request: HearingRequest;
  issues: readonly Issue[];
}

/** 顧客番号の決まり（世帯の保存と同じ: 英数字・ハイフン・下線の16字まで。氏名は入れない） */
export const CUSTOMER_NO_PATTERN = /^[A-Za-z0-9_-]{1,16}$/;

/**
 * 書き出すシートの種類: 通常（初回の前の軽い票。basic）・詳細（full）・見直し（詳細のシートに前回の値を記入する。0018 の9）。
 * 既定は通常
 */
export type SheetKind = "simple" | "detail" | "review";

export const SHEET_KINDS: readonly { value: SheetKind; label: string; note: string }[] = [
  { value: "simple", label: "通常（初回の前）", note: "ご家族・収入・住まい・貯蓄・生活費などを大まかに。金額は範囲でも答えられます（1〜2ページ）" },
  { value: "detail", label: "詳細", note: "源泉徴収票・ねんきん定期便・返済予定表・保険証券を見ながら書く票" },
  { value: "review", label: "見直し（前回の値つき）", note: "詳細の票に、今の入力の値を記入して書き出します（見直しの面談用）" },
];

/** 種類のシート定義（書き出せる最新の版） */
export function sheetFor(kind: SheetKind): SheetDefinition {
  const d = latestSheet(kind === "simple" ? "basic" : "full") ?? exportableSheets()[0];
  if (d === undefined) throw new Error("E_HEARING_NO_SHEET");
  return d;
}

export function defaultSheet(): SheetDefinition {
  return sheetFor("simple");
}

/** 今の世帯からヒアリングシートの .xlsx を作る（前回の値を記入するのは prefill のときだけ） */
export async function exportSheet(wh: WorkingHousehold, o: ExportInput): Promise<ExportOutput> {
  if (!CUSTOMER_NO_PATTERN.test(o.customerNo)) throw new Error("E_HEARING_CUSTOMER_NO");
  const r = await createHearingSheet({
    definition: o.definition,
    household: o.prefill ? { request: wh.request as unknown as HearingEngineRequest, assumed: wh.assumed } : null,
    requestId: requestIdFrom(o.random),
    customerNo: o.customerNo,
    office: o.office,
    appVersion: o.appVersion,
    exportedOn: o.exportedOn,
    ...(o.requestedDocuments !== undefined ? { requestedDocuments: o.requestedDocuments } : {}),
  });
  return { bytes: r.bytes, request: r.request, issues: r.issues };
}

/** 書き出した依頼の記録を世帯に残す */
export function withRequest(wh: WorkingHousehold, request: HearingRequest): WorkingHousehold {
  const log = logOf(wh);
  return { ...wh, hearing: { ...log, requests: [...log.requests.filter((r) => r.requestId !== request.requestId), request] } };
}

// ---- 取り込み: 候補を今の世帯と照らす ----

export type CandidateKind = "new" | "changed" | "same";

export interface FieldView {
  label: string;
  /** シートに書かれた値（わからない・該当なし・未回答も言葉で） */
  answer: string;
  /** 入力の画面と同じ印: 推定（目安で補った）・推定（範囲の真ん中。金額の範囲の答え）・仮（値の箱の無い欄の仮の値）・わからない・該当なし */
  mark: "estimated" | "range" | "assumed" | "unknown" | "notApplicable" | null;
  /** 印の理由（推定の根拠など） */
  note: string | null;
}

export interface CandidateView {
  id: string;
  /** 物の分野（家族・仕事と収入 …） */
  group: string;
  /** 例: ご本人の仕事と収入 */
  title: string;
  kind: CandidateKind;
  /** 要確認（名前の定義と位置の食い違い・数式など）。黙って当てはめない */
  review: boolean;
  /** 矛盾（シートの中で食い違う答え）の知らせ */
  contradictions: string[];
  fields: FieldView[];
  /** 変更のとき: 今の値と違う欄の数 */
  changedFields: number;
  note: string | null;
}

export interface ImportView {
  definition: SheetDefinition;
  candidates: CandidateView[];
  checklist: readonly ChecklistItem[];
  issues: readonly Issue[];
  memo: readonly string[];
  consents: readonly ConsentDraft[];
  pending: readonly Answer[];
  /** 承認に使う元の結果 */
  result: Extract<Awaited<ReturnType<typeof importHearingSheet>>, { ok: true }>;
  /** 候補の物 → 今の世帯の物（変更のとき）。構成員はここで対応づける */
  match: Map<string, string>;
}

export type ImportOutcome = { ok: true; view: ImportView } | { ok: false; issues: readonly Issue[] };

type Obj = Record<string, unknown> & { id: string };
type Lists = Record<string, Obj[]>;

const GROUP: Record<string, string> = {
  members: "家族",
  employmentPeriods: "仕事と収入",
  residentTaxAssessments: "住民税",
  pensionRecords: "公的年金",
  residences: "住まい",
  debts: "住宅ローン",
  goals: "教育",
  accounts: "貯蓄・投資",
  insuranceContracts: "保険",
  livingExpenses: "生活費",
  savingsChecks: "年間の貯蓄",
};

/** 構成員を指す欄（物の中で構成員の ID を持つ欄） */
const MEMBER_REFS = ["member", "owner", "insured", "policyholder", "payer", "child", "debtor", "beneficiary"];
/** 物の種類を表す欄（同じ種類どうしで対応づける） */
const KIND_FIELDS = ["kind", "type", "template", "mode", "stage"];

const lists = (h: Household): Lists => h as unknown as Lists;

/** 値の箱を値にし、ID・出どころ・承認・推定の根拠を外した形（同じ中身かを比べる） */
function plain(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(plain);
  if (v === null || typeof v !== "object") return v;
  const o = v as Record<string, unknown>;
  if ("state" in o && "origin" in o) return o.state === "confirmed" || o.state === "estimated" ? plain(o.value) : o.state;
  const out: Record<string, unknown> = {};
  // 住宅ローン控除の仮の条件の入居のイベント（moveIn）の ID は、取り込みのたびに新しくなるので比べない
  for (const k of Object.keys(o).sort()) if (k !== "id" && k !== "origin" && k !== "approval" && k !== "estimate" && k !== "moveIn") out[k] = plain(o[k]);
  return out;
}

/** 構成員の対応（取り込んだ側の ID → 今の世帯の ID）: 本人・配偶者は種類で、子は生まれの順で */
function memberMatch(cur: Household, imp: Household): Map<string, string> {
  const out = new Map<string, string>();
  for (const kind of ["self", "spouse"] as const) {
    const a = imp.members.find((m) => m.kind === kind);
    const b = cur.members.find((m) => m.kind === kind);
    if (a !== undefined && b !== undefined) out.set(a.id, b.id);
  }
  const kids = (h: Household) => h.members.filter((m) => m.kind === "child").sort((x, y) => (x.birth.birthYearMonth < y.birth.birthYearMonth ? -1 : 1));
  const ci = kids(cur);
  kids(imp).forEach((m, i) => {
    const c = ci[i];
    if (c !== undefined) out.set(m.id, c.id);
  });
  // 親（世帯の外の家族）: 誰の親か（今の世帯の本人・配偶者に読み替え）と性別で
  const used = new Set<string>();
  for (const a of imp.members.filter((m) => m.kind === "parent")) {
    const of = a.outside?.of === undefined ? undefined : (out.get(a.outside.of) ?? a.outside.of);
    const b = cur.members.find((x) => x.kind === "parent" && !used.has(x.id) && x.sex === a.sex && x.outside?.of === of);
    if (b === undefined) continue;
    out.set(a.id, b.id);
    used.add(b.id);
  }
  return out;
}

/** 親の欄のうち、シートで聞かない欄（亡くなる見込み・家計を1つにする期間・親のお金・扶養）は今の値を残す */
function keepParent(prev: Obj, next: Obj): Obj {
  const p = prev as unknown as Member;
  const n = next as unknown as Member;
  const out: Member = { ...p, birth: n.birth, sex: n.sex, ...(n.outside !== undefined ? { outside: { ...(p.outside ?? n.outside), ...(n.outside.of !== undefined ? { of: n.outside.of } : {}) } } : {}) };
  if (n.support?.cohabiting !== undefined) out.support = { ...(p.support ?? { dependent: false }), cohabiting: n.support.cohabiting };
  return out as unknown as Obj;
}

/** 細目で見分ける一覧（その他の資産の自社株・会社への貸付金、会社からの借入金。0105）。保険の細目は対応づけに使わない */
const SUBTYPE_COLLECTIONS = new Set(["accounts", "debts"]);

/** 連帯保証の額（0105）をシートで聞いていない（版1 のシート・空欄）ときは、今の値を残す */
function keepGuarantee(prev: Obj, next: Obj): Obj {
  return next.companyGuarantee === undefined && prev.companyGuarantee !== undefined ? { ...next, companyGuarantee: prev.companyGuarantee } : next;
}

/** 物の対応の鍵: 一覧・種類（その他の資産・ローンは細目も）・指している構成員（今の世帯の ID に読み替えたもの） */
function signature(collection: string, o: Obj, members: Map<string, string>): string {
  const parts: string[] = [collection];
  for (const k of KIND_FIELDS) if (typeof o[k] === "string") parts.push(`${k}=${o[k] as string}`);
  if (SUBTYPE_COLLECTIONS.has(collection) && typeof o.subtype === "string") parts.push(`subtype=${o.subtype}`);
  for (const k of MEMBER_REFS) if (typeof o[k] === "string") parts.push(`${k}=${members.get(o[k] as string) ?? (o[k] as string)}`);
  return parts.join("|");
}

/** ID の文字列を読み替える（物の中の構成員・物への参照） */
function remap<T>(v: T, ids: Map<string, string>): T {
  if (typeof v === "string") return (ids.get(v) ?? v) as T;
  if (Array.isArray(v)) return v.map((x) => remap(x, ids)) as T;
  if (v === null || typeof v !== "object") return v;
  const out: Record<string, unknown> = {};
  for (const [k, x] of Object.entries(v as Record<string, unknown>)) out[k] = remap(x, ids);
  return out as T;
}

function answerText(def: SheetDefinition, a: Answer | undefined, key?: string): string {
  // シートで聞いていない欄（簡易のシートで、詳細の欄を仮の値で補ったなど）
  if (a === undefined && key !== undefined && !def.items.some((i) => i.key === key)) return "（このシートでは聞いていない）";
  if (a === undefined || a.status === "blank") return "（空欄）";
  if (a.status === "unknown") return "わからない";
  if (a.status === "notApplicable") return "該当なし";
  const item = def.items.find((i) => i.key === a.key);
  const raw = a.raw;
  const text = raw === undefined ? "" : raw.kind === "bool" ? (raw.value ? "はい" : "いいえ") : raw.text;
  if (item === undefined) return text;
  if (item.type === "choice") return item.choices?.find((c) => c.value === text)?.label ?? text;
  if (item.type === "yearMonth") {
    // 年は「1986年（昭和61年）」の選択肢の言葉のこともあるので、西暦の4桁だけを読む
    const y = /\d{4}/.exec(text)?.[0] ?? text;
    const m = a.raw2 !== undefined && a.raw2.kind !== "bool" ? /\d{1,2}/.exec(a.raw2.text)?.[0] : undefined;
    return m !== undefined ? `${y}年${Number(m)}月` : `${y}年`;
  }
  if (item.type === "money" && item.unit !== undefined) {
    const n = Number(text);
    const body = Number.isFinite(n) ? n.toLocaleString("ja-JP") : text;
    return `${item.unit.basis === "monthly" ? "月" : item.unit.basis === "annual" ? "年" : ""}${body}${item.unit.scale === "manYen" ? "万円" : "円"}`;
  }
  if (item.type === "moneyRange") return item.ranges?.find((r) => r.label === text)?.label ?? text;
  if (item.type === "percent") return `${text}%`;
  return item.unitLabel !== undefined ? `${text}${item.unitLabel}` : text;
}

/** 候補の欄の印と理由（値の箱の推定の根拠・assumed の理由） */
function markOf(obj: Obj | undefined, f: Pick<FieldRecord, "path" | "state" | "range">, assumedNote: string | null): Pick<FieldView, "mark" | "note"> {
  const { path, state } = f;
  if (state === "estimated" || state === "unknown") {
    let v: unknown = obj;
    for (const seg of path.split("/").slice(1)) v = v !== null && typeof v === "object" ? (v as Record<string, unknown>)[seg] : undefined;
    const box = v as { estimate?: { basis?: string }; substitute?: { estimate?: { basis?: string } } } | undefined;
    const basis = box?.estimate?.basis ?? box?.substitute?.estimate?.basis ?? null;
    // 金額の範囲の答えから作った値: 推定（範囲の真ん中）。根拠は範囲の段
    if (f.range !== undefined && state === "estimated") return { mark: "range", note: basis ?? `ヒアリングシートの範囲 ${f.range}` };
    return { mark: state === "unknown" ? "unknown" : "estimated", note: basis };
  }
  if (state === "assumed") return { mark: "assumed", note: assumedNote };
  if (state === "notApplicable") return { mark: "notApplicable", note: null };
  return { mark: null, note: null };
}

/** 会社役員の方の会社とのお金の候補の名前（細目 → 名前。0105） */
const COMPANY_TITLES: Record<string, string> = {
  ownCompanyShares: "自社株（出資額）",
  loanToCompany: "会社への貸付金",
  companyLoan: "会社からの借入金",
};

/** 候補の分野（会社からの借入金は住宅ローンでなく「借入金」） */
function groupOf(c: Candidate): string {
  if (c.collection === "debts" && (c.value as Obj).subtype === "companyLoan") return "借入金";
  return GROUP[c.collection] ?? c.collection;
}

/** 候補の見出し（例: ご本人の仕事と収入・お子さま（2人目）・ご本人の会社からの借入金） */
function titleOf(c: Candidate, imp: EngineRequest): string {
  const group = groupOf(c);
  const label = new Map(roles(imp).map((r) => [r.member.id, r.label]));
  const v = c.value as Obj;
  const company = typeof v.subtype === "string" && (c.collection === "accounts" || c.collection === "debts") ? COMPANY_TITLES[v.subtype] : undefined;
  if (company !== undefined) {
    const who = c.collection === "debts" ? (v.debtors as { member: string }[] | undefined)?.[0]?.member : (v.owner as string | undefined);
    return who !== undefined && label.has(who) ? `${label.get(who) as string}の${company}` : company;
  }
  // 親・祖父母（世帯の外の家族）は父・母・義父・義母と呼ぶ（介護・親の項目と同じ）
  if (c.collection === "members" && (v.kind === "parent" || v.kind === "grandparent")) return memberLabels({ request: imp, assumed: {}, labelsByMember: {} } as unknown as WorkingHousehold).get(v.id) ?? "ご家族";
  if (c.collection === "members") return label.get(v.id) ?? "ご家族";
  for (const k of MEMBER_REFS) if (typeof v[k] === "string" && label.has(v[k] as string)) return `${label.get(v[k] as string) as string}の${group}`;
  return group;
}

/** 返ってきた .xlsx を読み、候補を今の世帯と照らした一覧にする（現状は変えない） */
export async function importSheet(bytes: Uint8Array, wh: WorkingHousehold, newId?: () => string): Promise<ImportOutcome> {
  const r = await importHearingSheet(bytes, { baseMonth: wh.request.input.baseMonth, requests: logOf(wh).requests, ...(newId !== undefined ? { newId } : {}) });
  if (!r.ok) return { ok: false, issues: r.issues };
  return { ok: true, view: viewOfResult(r, wh) };
}

/** 取り込みの結果（Excel・Web のどちらでも同じ受け皿の結果）を、今の世帯と照らした一覧にする（現状は変えない） */
export function viewOfResult(r: ImportView["result"], wh: WorkingHousehold): ImportView {
  const imp = r.request as unknown as EngineRequest;
  const cur = wh.request.input.household;
  const members = memberMatch(cur, imp.input.household);
  const curLists = lists(cur);
  const used = new Set<string>();
  const match = new Map<string, string>(members);
  const assumedOf = (key: string) => r.assumed[key] ?? null;
  const contradictions = new Map<string, string[]>();
  for (const c of r.checklist) if (c.reason === "contradiction") contradictions.set(c.key, [...(contradictions.get(c.key) ?? []), c.message]);
  for (const i of r.issues) if (i.code === "H_CONTRADICTION" && i.key !== undefined) contradictions.set(i.key, [...new Set([...(contradictions.get(i.key) ?? []), i.message])]);

  const candidates: CandidateView[] = r.candidates.map((c) => {
    const v = c.value as Obj;
    let found: Obj | undefined;
    if (c.collection === "members") {
      const id = members.get(v.id);
      found = id === undefined ? undefined : cur.members.find((m) => m.id === id) as unknown as Obj | undefined;
    } else {
      const sig = signature(c.collection, v, members);
      found = (curLists[c.collection] ?? []).find((o) => !used.has(o.id) && signature(c.collection, o, new Map()) === sig);
      if (found !== undefined) {
        used.add(found.id);
        match.set(v.id, found.id);
      }
    }
    const mapped = remap(v, match);
    // 連帯保証の額をシートで聞いていない（版1・空欄）なら、今の値と比べない（承認しても今の値を残す。keepGuarantee）
    if (found !== undefined && c.collection === "members" && mapped.companyGuarantee === undefined && found.companyGuarantee !== undefined) {
      found = { ...found };
      delete found.companyGuarantee;
    }
    let changedFields = 0;
    if (found !== undefined) {
      for (const f of c.fields) {
        const at = (o: unknown) => f.path.split("/").slice(1).reduce<unknown>((x, seg) => (x !== null && typeof x === "object" ? (x as Record<string, unknown>)[seg] : undefined), o);
        if (JSON.stringify(plain(at(mapped))) !== JSON.stringify(plain(at(found)))) changedFields++;
      }
    }
    // 親はシートで聞いた欄（生年月・性別・同居か）だけで比べる（亡くなる見込みなど、聞かない欄は承認しても今の値を残す）
    const parent = c.collection === "members" && v.kind === "parent";
    const kind: CandidateKind = found === undefined ? "new" : changedFields > 0 || (!parent && JSON.stringify(plain(mapped)) !== JSON.stringify(plain({ ...found, id: v.id }))) ? "changed" : "same";
    const seen = new Set<string>();
    const fields: FieldView[] = [];
    const assumedKey = Object.keys(r.assumed).find((key) => key.includes(v.id));
    for (const f of c.fields) {
      const k = `${f.key}#${f.index ?? 0}`;
      const label = keyLabel(r.definition, f.key);
      const mark = markOf(v, f, assumedKey !== undefined ? assumedOf(assumedKey) : null);
      if (seen.has(k)) {
        // 同じ答えから補った別の欄（年収から標準報酬の目安など）は、印のあるものだけを1行足す
        if (mark.mark !== null && !fields.some((x) => x.label.startsWith(label) && x.mark === mark.mark)) fields.push({ label: `${label}から補った値`, answer: "目安", ...mark });
        continue;
      }
      seen.add(k);
      const a = r.record.answers.find((x) => x.key === f.key && (x.index ?? 0) === (f.index ?? 0));
      fields.push({ label, answer: answerText(r.definition, a, f.key), ...mark });
    }
    const cons = [...new Set(c.fields.flatMap((f) => contradictions.get(f.key) ?? []))];
    return { id: c.id, group: groupOf(c), title: titleOf(c, imp), kind, review: c.status === "needsReview", contradictions: cons, fields, changedFields, note: c.note };
  });
  return { definition: r.definition, candidates, checklist: r.checklist, issues: r.issues, memo: r.memo, consents: r.consents, pending: r.pending, result: r, match };
}

/** 既定で承認する候補: 新規と変更（同じ中身の候補・要確認・矛盾のある候補は、FP が選んだときだけ） */
export function defaultSelection(view: ImportView): Set<string> {
  return new Set(view.candidates.filter((c) => c.kind !== "same" && !c.review && c.contradictions.length === 0).map((c) => c.id));
}

export interface ApplyResult {
  wh: WorkingHousehold;
  /** 現状に入れた候補の数（新規・変更） */
  added: number;
  replaced: number;
  /** 入れなかった候補（指している家族を承認しなかったなど）の見出し */
  skipped: string[];
}

/**
 * 承認した候補を現状に入れる: 承認の記録を付け（approveAll）、構成員と物の ID を今の世帯のものに読み替え、
 * 変更は今の物を置き換え、新規は足す。推定・仮の印（assumed）・メモ・同意の下書き・取り込みの記録も入れる
 */
export function applyImport(wh: WorkingHousehold, view: ImportView, selected: ReadonlySet<string>, at: string): ApplyResult {
  const r = view.result;
  const approved = approveAll(r, at) as unknown as EngineRequest;
  const impLists = lists(approved.input.household);
  const request = structuredClone(wh.request);
  const h = request.input.household;
  const curLists = lists(h);
  const chosen = r.candidates.filter((c) => selected.has(c.id));
  // 新しく入る構成員は、そのままの ID で入る。入らない（承認しなかった）新規の構成員を指す物は入れない
  const present = new Set([...h.members.map((m) => m.id), ...chosen.filter((c) => c.collection === "members").map((c) => (c.value as Obj).id)]);
  const imported = new Set(approved.input.household.members.map((m) => m.id));
  const ids = new Map(view.match);
  const skipped: string[] = [];
  let added = 0;
  let replaced = 0;
  const viewOf = new Map(view.candidates.map((c) => [c.id, c]));
  const dropped = new Set<string>();
  for (const c of chosen) {
    const src = (impLists[c.collection] ?? []).find((o) => o.id === c.target.object);
    if (src === undefined) continue;
    const obj = remap(src, ids);
    const refs = MEMBER_REFS.map((k) => obj[k]).filter((x): x is string => typeof x === "string");
    if (c.collection !== "members" && refs.some((id) => imported.has(id) && !present.has(id))) {
      skipped.push(viewOf.get(c.id)?.title ?? c.collection);
      continue;
    }
    const list = (curLists[c.collection] ??= []);
    const at = list.findIndex((o) => o.id === obj.id);
    // 住宅ローンの入居のイベント（住宅ローン控除の条件 debt.housing が指す）は、ローンといっしょに入れる。置き換えたローンの前のイベントは外す
    const moveIn = (o: Obj | undefined) => ((o?.housing as { moveIn?: string } | undefined)?.moveIn ?? null);
    if (c.collection === "debts") {
      const ev = moveIn(obj);
      const src = ev === null ? undefined : (approved.input.household.events ?? []).find((e) => e.id === ev);
      if (src !== undefined && !(h.events ?? []).some((e) => e.id === src.id)) (h.events ??= []).push(remap(src, ids));
      const old = at >= 0 ? moveIn(list[at]) : null;
      if (old !== null && old !== ev) dropped.add(old);
    }
    if (at >= 0) {
      // 前の物の値の状態の行のうち、取り込みで値が変わらない所の行（FP が決めた「該当なし」「わからない」・確定の記録）は残す。
      // 値が変わった所は取り込んだ値と承認の記録が正（0041）
      const prev = list[at] as Obj;
      const merged = c.collection === "members" ? (obj.kind === "parent" ? keepParent(prev, obj) : keepGuarantee(prev, obj)) : obj;
      carryRows(prev, merged, c.collection === "members" ? { member: merged.id } : { object: merged.id });
      list[at] = merged;
      replaced++;
    } else {
      list.push(obj);
      added++;
    }
    // 新しい構成員の関係（配偶者・親子）
    if (c.collection === "members" && at < 0) {
      for (const rel of c.related ?? []) {
        const rr = remap(rel, ids);
        const rels = (h.relations ??= []) as unknown[];
        if (!rels.some((x) => JSON.stringify(x) === JSON.stringify(rr))) rels.push(rr);
      }
    }
  }
  // 置き換えたローンの入居のイベントのうち、ほかから指されていないものを外す
  if (dropped.size > 0) {
    const rest = JSON.stringify({ ...h, events: [] });
    h.events = (h.events ?? []).filter((e) => !dropped.has(e.id) || rest.includes(e.id));
  }
  // 表の最後の年: 大人が入れ替わったら、一番若い大人が100歳（か選んだ年齢）になる年まで（0008 の3）。取り込む前に標準・選び方の年齢の年の
  // ままだった年だけ合わせる（人が年で入れた年・確定した年は変えない。家族の欄の追いかけ〔followStandards〕と同じ決まり。0070 の追記 2026-11-05）
  const endAge = followedEndAge(wh.request);
  if (chosen.some((c) => c.collection === "members") && endAge !== null) {
    const y = endYearForAge(h, endAge);
    if (Number.isFinite(y)) request.input.endYear = y;
  }
  // 推定・仮の印: 入れた物の assumed を、今の世帯の ID に読み替えて入れる。置き換えた物の古い印は外す
  const touched = new Set(chosen.map((c) => ids.get(c.target.object) ?? c.target.object));
  const assumed: Record<string, string> = {};
  for (const [k, v] of Object.entries(wh.assumed)) if (![...touched].some((id) => k.includes(id))) assumed[k] = v;
  for (const [k, v] of Object.entries(r.assumed)) {
    const c = r.candidates.find((x) => k.includes(x.target.object));
    if (c !== undefined && selected.has(c.id)) assumed[remap(k.split("/"), ids).join("/")] = v;
  }
  const log = logOf(wh);
  const memo = r.memo.length > 0 ? [...wh.memo, ...r.memo.map((m) => `ヒアリング（${r.record.requestId}）: ${m}`)] : wh.memo;
  const next: WorkingHousehold = {
    ...wh,
    request,
    assumed,
    memo,
    hearing: {
      ...log,
      imports: [...log.imports, { ...r.record, approvedAt: at }],
      consents: [...log.consents, ...r.consents.map((c) => ({ ...c, at }))],
    },
  };
  // 新しく入った子は、進路が取り込みに無ければ推定の進路（標準の型）で始める（子を足したときと同じ。0062）。
  // 新しく入った親は、亡くなる見込みを平均余命で入れる（仮の印。介護・親の項目で親を足したときと同じ。0059）
  const before = new Set(wh.request.input.household.members.map((m) => m.id));
  let filled = next;
  for (const m of h.members) {
    if (before.has(m.id)) continue;
    if (m.kind === "child" && fillsByEstimate("goal.education")) filled = fillEducation(filled, m.id);
    if (m.kind === "parent" && (m.leaves === null || m.leaves === undefined)) filled = withDeathEstimate(filled, m.id);
  }
  // 簡易のシートの残高と返済額から置いた住宅ローンは、ローンの入れ方を「今の残高から」にする（0052）
  for (const c of chosen) {
    if (c.collection !== "debts" || r.loanEntry[c.target.object] === undefined) continue;
    const id = ids.get(c.target.object) ?? c.target.object;
    if ((filled.request.input.household.debts ?? []).some((d) => d.id === id)) filled = withEntry(filled, id, r.loanEntry[c.target.object]);
  }
  return { wh: filled, added, replaced, skipped };
}

/** 承認の日時（時差つきの ISO 8601。秒まで。計算エンジンの approval.at の形） */
export function approvalTime(d: Date = new Date()): string {
  const p = (n: number) => String(Math.trunc(Math.abs(n))).padStart(2, "0");
  const off = -d.getTimezoneOffset();
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}${off >= 0 ? "+" : "-"}${p(off / 60)}:${p(off % 60)}`;
}

/** 依頼番号の乱数（6バイト） */
export function randomBytes(): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(6));
}

export type { HearingRequest, Issue, OfficeInfo, SheetDefinition };
