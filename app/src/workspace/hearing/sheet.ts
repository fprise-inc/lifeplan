// ヒアリングシート（0018）を入力のホームにつなぐ部分（作業の層）。シートの読み書きは hearing/ の部品が行い、ここは
// 「今の世帯から書き出す」「取り込んだ候補を今の世帯と照らして、新規・変更・矛盾に分ける」「承認した候補を現状に入れる」を受け持つ。
// - 返ってきたシート（.xlsx）は信用しない（0018 の6）。読み込みの安全は hearing/ の部品（.xlsx だけ・マクロや外部リンクを読まない・
//   数式を評価しない・大きさの上限・管理の値の照合）に任せ、ここでは候補を FP が承認するまで現状に入れない
// - 承認した値には承認の記録（by: fp・日時・候補）を付ける（0008 の2・5。hearing の approveAll）
// - 推定・仮の印は、入力の画面と同じ形（値の箱の estimated・WorkingHousehold.assumed）で入れる
import { carryRows } from "../input/rows.ts";
import { approveAll, createHearingSheet, exportableSheets, importHearingSheet, keyLabel, latestSheet, requestIdFrom, type Answer, type Candidate, type ChecklistItem, type ConsentDraft, type FieldRecord, type GateAnswersIn, type GateKind, type HearingRequest, type ImportRecord, type Issue, type OfficeInfo, type SheetDefinition } from "../../../../hearing/src/index.ts";
import type { EngineRequest as HearingEngineRequest } from "../../../../hearing/src/types.ts";
import { fillsByEstimate } from "../../../../hearing/src/estimates.ts";
import { addMonths } from "../../../../hearing/src/months.ts";
import type { EngineRequest, Household, Member } from "../../engine/types.ts";
import { ITEM_LABELS } from "../../generated/labels.ts";
import { endYearForAge, followedEndAge, type WorkingHousehold } from "../input/household.ts";
import { fillEducation } from "../input/fill.ts";
import { EMPLOYMENT_TYPES, memberLabels, PENSION_CATEGORY } from "../input/labels.ts";
import { withDeathEstimate } from "../input/stages/care.ts";
import { withWorkEndEstimates } from "../input/stages/work.ts";
import { BLUE_DEDUCTIONS, TAX_RETURN_METHODS } from "../input/taxReturn.ts";
import { withEntry } from "../input/stages/housingLoans.ts";
import { roles } from "../roles.ts";
import { resolveTimepoint } from "../timepoint.ts";
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
 * 書き出すシートの種類: シンプル（大まかに聞く軽い票。basic）・詳細（full）・見直し（詳細のシートに前回の値を記入する。0018 の9）。
 * 既定はシンプル（Web のヒアリングのひな形の名前とそろえた。0192）
 */
export type SheetKind = "simple" | "detail" | "review";

export const SHEET_KINDS: readonly { value: SheetKind; label: string; note: string }[] = [
  { value: "simple", label: "シンプル", note: "ご家族・収入・住まい・貯蓄・生活費などを大まかに。金額は範囲でも答えられます（1〜2ページ）" },
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

/**
 * 候補の種類: 新規・変更・同じ・お答えなし（今の世帯にある物で、違う所がどれもお答えの無い欄〔空欄・「あとで」・聞いていない〕だけ。
 * 候補にせず、今の値のまま残す）
 */
export type CandidateKind = "new" | "changed" | "same" | "noAnswer";

/** 変更の候補の、今の値と届いた値の違う欄（物の中の場所ごと） */
export interface FieldDiff {
  /** 欄の名前（残高・借入額・返済期間 …） */
  label: string;
  /** 今の値（今の世帯の値を言葉で） */
  current: string;
  /** 届いた値（承認すると入る値を言葉で） */
  next: string;
  /** お答えが無い欄なので、承認しても今の値のまま */
  kept: boolean;
  /** 今の値が確定で、届いた値が範囲・推定・仮の値（今の値の方が詳しい） */
  rough: boolean;
  /** お答えが無いのは、頼んだ書類で分かる問いだから（「源泉徴収票（ご本人）を待っています」。0192）。それ以外は null */
  waiting: string | null;
}

export interface FieldView {
  label: string;
  /** シートに書かれた値（わからない・該当なし・未回答も言葉で） */
  answer: string;
  /** 入力の画面と同じ印: 推定（目安で補った）・推定（範囲の真ん中。金額の範囲の答え）・仮（値の箱の無い欄の仮の値）・わからない・該当なし */
  mark: "estimated" | "range" | "assumed" | "unknown" | "notApplicable" | null;
  /** 印の理由（推定の根拠など） */
  note: string | null;
  /** この項目に答えが無い（空欄・「あとで」・このシートでは聞いていない） */
  noAnswer: boolean;
  /** 変更の候補のとき、この項目から入る欄の「今 → 届いた値」 */
  diffs: FieldDiff[];
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
  /** 変更のとき: 今の値と違う欄の数（お答えの無い欄〔今の値のまま〕は数えない） */
  changedFields: number;
  note: string | null;
  /** 既定でチェックを外す理由（今の値の方が詳しい: 今の値が確定で、届いた値が範囲・推定・仮の値だけ）。null は外さない */
  keep: string | null;
  /** 記入どおりの値と一緒に、今の確定の値が範囲・推定・仮の値に置きかわる欄があるときの知らせ（既定で入れる） */
  caution: string | null;
  /** 働き方の種類が変わった（今の期間と届いた働き方の種類が違う）ときの、承認の入れ方。それ以外は null */
  work: WorkChange | null;
  /** お答えなしの物で、お答えの無い欄がどれも頼んだ書類で分かる問いのとき、その言葉（「源泉徴収票（ご本人）を待っています」。0192）。それ以外は null */
  waiting: string | null;
}

/**
 * 働き方の種類が変わったときの承認の入れ方: 今の期間を届いた働き方に置きかえる（今の入力が古かった）か、今の期間を届いた働き方を始めた
 * 年月の前の月で終えて、届いた働き方の期間を足す（転職・独立・役員になった）か
 */
export type WorkChangeMode = "replace" | "split";

export interface WorkChange {
  /** 今の働き方・届いた働き方（言葉） */
  current: string;
  next: string;
  /** 今の期間の始まり（YYYY-MM。解けなければ null） */
  currentFrom: string | null;
  /** 届いた働き方を始めた年月（YYYY-MM。答えが無ければ null） */
  nextFrom: string | null;
  /** 「終えて足す」の、今の期間の最後の月（YYYY-MM）。始めた年月の答えが無い・今の期間の始まりより後でないときは選べない（null） */
  splitEnd: string | null;
  /** 既定の入れ方（「終えて足す」が選べればそれ。選べなければ置きかえる） */
  mode: WorkChangeMode;
  /** 今の期間の終わりが働く最後の年齢・定年の推定（届いた働き方で推定し直す。推定の定年後の期間は外す） */
  endEstimated: boolean;
  /** 今の世帯の、この後の働き方の期間（FP が入れたもの。そのまま残す）の言葉。無ければ null */
  following: string | null;
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
  /** 分岐の答えが今の世帯と違うときの要確認の知らせ（Web のヒアリングだけ。Excel は空）。世帯の人や行は変えない */
  gates: GateNotice[];
}

/** 分岐の答え（お子さまの人数など）が今の世帯と違うときの知らせ（0139 の追記 2026-11-08） */
export interface GateNotice {
  gate: GateKind;
  /** 例: お子さまは0人とのお答え（今の世帯は2人） */
  text: string;
}

export type ImportOutcome = { ok: true; view: ImportView } | { ok: false; issues: readonly Issue[] };

type Obj = Record<string, unknown> & { id: string };
type Lists = Record<string, Obj[]>;

const GROUP: Record<string, string> = {
  members: "家族",
  employmentPeriods: "仕事と収入",
  retirementBenefits: "退職金",
  residentTaxAssessments: "住民税",
  pensionRecords: "公的年金",
  residences: "住まい",
  debts: "住宅ローン",
  goals: "教育",
  accounts: "貯蓄・投資",
  insuranceContracts: "保険",
  livingExpenses: "生活費",
  savingsChecks: "年間の貯蓄",
  careExpenses: "介護",
  incomeFlows: "入るお金",
  periodicExpenses: "出るお金",
};

/** 構成員を指す欄（物の中で構成員の ID を持つ欄） */
const MEMBER_REFS = ["member", "owner", "insured", "policyholder", "payer", "child", "debtor", "beneficiary", "counterparty"];
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

/** 取り込んだ子 → 何人目のお子さまの問いか（生年月の欄の記録の番号） */
function childSlots(candidates: readonly Candidate[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const c of candidates) {
    if (c.collection !== "members") continue;
    const f = c.fields.find((x) => x.key === "hs.family.child.birthYearMonth" && x.index !== undefined);
    if (f?.index !== undefined) out.set((c.value as Obj).id, f.index);
  }
  return out;
}

/**
 * 構成員の対応（取り込んだ側の ID → 今の世帯の ID）: 本人・配偶者は種類で、子は問いの順（何人目のお子さまの問いか）で、今の世帯の生まれの順の
 * 子に当てる（シートと Web の前回の値も生まれの順に並べている）。今の世帯にいない番目のお子さまは新規の家族（0139 の追記 2026-11-09。
 * 前は答えのある子だけを生まれの順に当てたので、3人目だけ答えると今の第1子に当たった）
 */
function memberMatch(cur: Household, imp: Household, candidates: readonly Candidate[]): Map<string, string> {
  const out = new Map<string, string>();
  for (const kind of ["self", "spouse"] as const) {
    const a = imp.members.find((m) => m.kind === kind);
    const b = cur.members.find((m) => m.kind === kind);
    if (a !== undefined && b !== undefined) out.set(a.id, b.id);
  }
  const kids = (h: Household) => h.members.filter((m) => m.kind === "child").sort((x, y) => (x.birth.birthYearMonth < y.birth.birthYearMonth ? -1 : 1));
  const slot = childSlots(candidates);
  const ci = kids(cur);
  kids(imp).forEach((m, i) => {
    const c = ci[(slot.get(m.id) ?? i + 1) - 1];
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

/**
 * 今の行をそのまま置きかえる（記録のある欄だけを重ねない）か: 親（シートで聞いた欄だけを keepParent で入れる）と、働き方の種類が変わった期間
 * （今の期間の種類に付いた欄〔標準報酬月額など〕は、届いた働き方に当てはまらない。0139 の7）だけ
 */
const replacesWhole = (collection: string, o: Obj, work: WorkChange | null): boolean => (collection === "members" && o.kind === "parent") || work !== null;

/** 並びの要素の種類を表す欄（同じ種類の要素どうしで、今の要素の ID と聞かない欄を残す） */
const ELEMENT_KINDS = ["stage", "kind", "type", "template"];

const isPlain = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v) && !isBox(v);

/**
 * 届いた並び（進路の学校の並びなど）を、今の並びの同じ種類の要素に重ねる: 並びの形（数と順）は届いた値、同じ種類の今の要素があれば、
 * その要素の ID と届いた値に無い欄（受験の費用など）を残す
 */
function mergeElements(prev: unknown, next: readonly unknown[]): unknown[] {
  const left = Array.isArray(prev) ? [...(prev as unknown[])] : [];
  return next.map((e) => {
    const i = isPlain(e) ? left.findIndex((p) => isPlain(p) && ELEMENT_KINDS.every((k) => p[k] === e[k])) : -1;
    if (i < 0) return structuredClone(e);
    const [p] = left.splice(i, 1);
    return { ...structuredClone(p as Record<string, unknown>), ...structuredClone(e as Record<string, unknown>) };
  });
}

/**
 * 一緒に入れる欄: 記録のある欄が入ると意味が変わるので、届いた値に合わせる欄（構成員の中だけ）。確定申告の仕方は申告の方法と青色申告特別控除で1つ
 * （白色の答えで今の控除を残さない）。子の生年月は、生まれる予定か・世帯に入る年月と組（生年月が計算基準月より後なら出産の予定）
 */
function togetherPaths(collection: string, next: Obj, applied: readonly FieldRecord[]): string[] {
  if (collection !== "members") return [];
  const out: string[] = [];
  if (applied.some((f) => f.path.startsWith("/taxReturn"))) out.push("/taxReturn");
  if (next.kind === "child" && applied.some((f) => f.path === "/birth/birthYearMonth")) out.push("/expected", "/joins");
  return out;
}

/** 時点の形（0003 の6: 絶対の年月・名前つきイベント・構成員の年齢のどれか）の値か */
const isTimepoint = (v: Record<string, unknown>): boolean => "at" in v || "event" in v || "memberAge" in v;

/** 年月の時点（{ at } のほかに、イベント・年齢などで決まる時点がある）の場所か: 場所が /at で終わり、今の時点が { at } の形でない */
function timepointPath(prev: Obj, path: string): string | null {
  if (!path.endsWith("/at")) return null;
  const tp = path.slice(0, -"/at".length);
  const v = valueAt(prev, tp);
  return isPlain(v) && "at" in v ? null : tp;
}

/**
 * 今の行に、記録のある欄だけを届いた行の値で重ねる（0139。全部の一覧で同じ。親と働き方の種類が変わった期間は replacesWhole）。シートで
 * 聞かない欄（標準報酬月額・企業年金・取得価額・資産の配分・住まいの評価と持ち分・塾・生活費の段階・解約返戻率・並びの要素の ID など）は
 * 今の値のまま。
 * - 途中の入れ物が今の行に無ければ、届いた値の入れ物ごと入れる
 * - 年月の時点がイベントなどで決まる欄（入居のイベントにつながる住み始めた年月など）は、解いた年月が同じなら今の時点のまま、違えば時点ごと届いた値に
 * - 並びの要素の欄（進路の学校など）は mergeElements
 * 返すのは重ねた行と、値を入れた欄（年月が同じで今のままにした欄は入れない）
 */
function patchRow(collection: string, prev: Obj, next: Obj, fields: readonly FieldRecord[], h: Household): { row: Obj; applied: FieldRecord[] } {
  const out = structuredClone(prev);
  const applied: FieldRecord[] = [];
  const arrays = new Set<string>();
  // 並びの要素ごと記録のある欄（/education/stages/2 など）を先に（要素の中の欄〔/education/stages/2/living〕は、重ねた後の並びに入れる）
  const element = (f: FieldRecord) => {
    const m = /^(.*)\/\d+$/.exec(f.path);
    return m !== null && Array.isArray(valueAt(next, m[1] ?? "")) ? (m[1] ?? "") : null;
  };
  for (const f of fields) {
    const list = element(f);
    if (list === null) continue;
    applied.push(f);
    if (arrays.has(list)) continue;
    arrays.add(list);
    putAt(out, list, mergeElements(valueAt(prev, list), valueAt(next, list) as unknown[]), next);
  }
  for (const f of fields) {
    if (element(f) !== null) continue;
    const tp = timepointPath(prev, f.path);
    if (tp !== null) {
      const now = valueAt(prev, tp);
      if (isPlain(now) && resolveTimepoint(h, now as Parameters<typeof resolveTimepoint>[1]) === valueAt(next, f.path)) continue;
      putAt(out, tp, valueAt(next, tp), next);
    } else {
      // 入れ物ごと記録のある欄（住宅ローン控除の条件など）は、届いた値に無い欄（取得価額・持ち分など、シートで聞かない欄）を今の値のまま残す
      const nv = valueAt(next, f.path);
      const pv = valueAt(prev, f.path);
      putAt(out, f.path, isPlain(nv) && isPlain(pv) && !isTimepoint(nv) && !isTimepoint(pv) ? { ...structuredClone(pv), ...structuredClone(nv) } : nv, next);
    }
    applied.push(f);
  }
  for (const p of togetherPaths(collection, next, applied)) putAt(out, p, valueAt(next, p), next);
  return { row: out, applied };
}

/** 物の中の場所に値を入れる（undefined は欄を外す）。途中の入れ物が無ければ、届いた行のその入れ物ごと入れる（届いた行にも無ければ入れない） */
function putAt(o: unknown, path: string, value: unknown, next: unknown): void {
  const segs = path.split("/").slice(1);
  let x = o as Record<string, unknown>;
  for (let i = 0; i < segs.length - 1; i++) {
    const seg = segs[i] as string;
    const child = x[seg];
    if (child === null || typeof child !== "object") {
      const sub = valueAt(next, `/${segs.slice(0, i + 1).join("/")}`);
      if (sub !== undefined) x[seg] = structuredClone(sub);
      return;
    }
    x = child as Record<string, unknown>;
  }
  const last = segs[segs.length - 1];
  if (last === undefined) return;
  if (value === undefined) delete x[last];
  else x[last] = structuredClone(value);
}

/**
 * 入力の画面の仮の印の、欄の場所ごとの最後の段（印のキーは「分野/物の ID/段」。取り込みの部品の仮の値の印と同じ）。記録のある欄の値を
 * 入れた行では、その欄の今の印だけを外す（ほかの欄の印は、値と一緒に残す）
 */
const MARK_SUFFIXES: Readonly<Record<string, Readonly<Record<string, readonly string[]>>>> = {
  members: { "/birth/birthYearMonth": ["birth", "joins", "expected"], "/sex": ["sex"] },
  employmentPeriods: { "/from/at": ["from"], "/leaveKind": ["leaveKind"], "/healthInsurance/kind": ["hi"], "/healthInsurance/insurer": ["branch"], "/employer/size": ["size"], "/employer/weeklyHours": ["hours"] },
  pensionRecords: { "/asOf": ["asOf"], "/months/employee": ["months"], "/months/basic": ["months"] },
  residences: { "/from/at": ["from"] },
  debts: { "/repayment/termMonths": ["term"], "/principal": ["fromBalance", "principal"], "/rateSchedule/0/rate": ["rate"], "/rateSchedule/0/type": ["rateType"], "/repayment/method": ["method"], "/debtors/0/member": ["debtor"], "/housing": ["credit"] },
  accounts: { "/owner": ["owner"], "/kind": ["kind"] },
  insuranceContracts: { "/policyholder": ["holder"], "/insured": ["insured"], "/contractDate": ["date"], "/premium/frequency": ["freq"], "/premium/payUntil": ["payUntil"], "/deductionCategory": ["deduction"] },
  careExpenses: { "/from": ["from"] },
  incomeFlows: { "/from": ["from"] },
  savingsChecks: { "/treatment": ["treatment"] },
};

/** 物の対応の鍵: 一覧・種類（その他の資産・ローンは細目も）・指している構成員（今の世帯の ID に読み替えたもの） */
function signature(collection: string, o: Obj, members: Map<string, string>): string {
  const parts: string[] = [collection];
  for (const k of KIND_FIELDS) if (typeof o[k] === "string") parts.push(`${k}=${o[k] as string}`);
  if (SUBTYPE_COLLECTIONS.has(collection) && typeof o.subtype === "string") parts.push(`subtype=${o.subtype}`);
  // 受け取る予定の相続・贈与は、シートで相手を聞かない（今の行に相手があっても同じ行として対応づける。0139）
  if (collection === "incomeFlows" && o.kind === "inheritance") return parts.join("|");
  for (const k of MEMBER_REFS) if (typeof o[k] === "string") parts.push(`${k}=${members.get(o[k] as string) ?? (o[k] as string)}`);
  return parts.join("|");
}

/** 働き方の期間の始まり・終わり（年月。解けなければ null） */
const fromOf = (h: Household, o: Obj): string | null => resolveTimepoint(h, o.from as Parameters<typeof resolveTimepoint>[1]);
const toOf = (h: Household, o: Obj): string | null => resolveTimepoint(h, o.to as Parameters<typeof resolveTimepoint>[1]);

/**
 * 今の世帯の、その人の今（計算基準月）にかかっている働き方の期間。ヒアリングの答えは「今の働き方」なので、種類が違っても同じ期間として
 * 対応づける（種類で分けると、今の期間を残したまま新しい期間が足され、給与が二重になった）。同じ種類の期間があればそれを先に
 */
function currentWork(h: Household, member: string, type: unknown, base: string, used: ReadonlySet<string>): Obj | undefined {
  const live = (lists(h).employmentPeriods ?? []).filter((o) => {
    if (used.has(o.id) || o.member !== member) return false;
    const from = fromOf(h, o);
    const to = toOf(h, o);
    return (from === null || from <= base) && (o.to === null || o.to === undefined || (to !== null && to >= base));
  });
  return live.find((o) => o.type === type) ?? live[0];
}

/** 終わりを推定で入れたときに足す、辞めた後の給付を受け取るかの推定（シートで聞かない。比べない） */
const AUTO_CLAIMS = [
  ["unemploymentClaim", "employment.unemploymentClaim"],
  ["elderlyContinuationClaim", "employment.elderlyContinuationClaim"],
] as const;

function withoutAutoClaims(o: Obj): Obj {
  const rows = o.valueStates as Record<string, { state?: string; origin?: { kind?: string } }> | undefined;
  if (rows === undefined) return o;
  const out: Obj = { ...o };
  const left = { ...rows };
  for (const [field, item] of AUTO_CLAIMS) {
    const row = left[item];
    if (row?.state !== "estimated" || row.origin?.kind !== "auto") continue;
    delete out[field];
    delete left[item];
  }
  if (Object.keys(left).length === 0) delete out.valueStates;
  else out.valueStates = left;
  return out;
}

/** 働く最後の年齢・定年の推定の印がある（今の終わりが推定。0133） */
const endEstimatedOf = (wh: WorkingHousehold, member: string): boolean => wh.assumed[`work/${member}/mainEnd`] !== undefined || wh.assumed[`work/${member}/retireAge`] !== undefined;

/** 推定の定年後の期間（定年後の予定の推定〔postType の印〕で、今の期間の終わりの次の月から始まる期間） */
function estimatedPostPeriods(wh: WorkingHousehold, member: string, cur: Obj): Obj[] {
  const h = wh.request.input.household;
  const end = toOf(h, cur);
  if (end === null || wh.assumed[`work/${member}/postType`] === undefined || wh.postRetirement[member] === undefined) return [];
  return (lists(h).employmentPeriods ?? []).filter((o) => o.member === member && o.id !== cur.id && fromOf(h, o) === addMonths(end, 1));
}

/** 今の期間の後に始まる働き方の期間（推定の定年後の期間を除く） */
function followingPeriods(wh: WorkingHousehold, member: string, cur: Obj, dropped: readonly Obj[]): Obj[] {
  const h = wh.request.input.household;
  const from = fromOf(h, cur) ?? "";
  return (lists(h).employmentPeriods ?? []).filter((o) => o.member === member && o.id !== cur.id && !dropped.some((d) => d.id === o.id) && (fromOf(h, o) ?? "") > from).sort((a, b) => ((fromOf(h, a) ?? "") < (fromOf(h, b) ?? "") ? -1 : 1));
}

/** 働き方の種類が変わったときの入れ方（今の期間 cur・届いた期間 v） */
function workChangeOf(wh: WorkingHousehold, c: Candidate, v: Obj, cur: Obj, labels: ReadonlyMap<string, string>, choices: ReadonlyMap<string, string>): WorkChange {
  const h = wh.request.input.household;
  const member = cur.member as string;
  const currentFrom = fromOf(h, cur);
  const answered = c.fields.some((f) => f.path === "/from/at" && f.noAnswer !== true && f.state === "confirmed");
  const nextFrom = answered ? ((v.from as { at?: string } | undefined)?.at ?? null) : null;
  const splitEnd = nextFrom !== null && currentFrom !== null && nextFrom > currentFrom && nextFrom <= wh.request.input.baseMonth ? addMonths(nextFrom, -1) : null;
  const endEstimated = endEstimatedOf(wh, member);
  const rest = followingPeriods(wh, member, cur, endEstimated ? estimatedPostPeriods(wh, member, cur) : []);
  const following = rest.length === 0 ? null : rest.map((o) => `${valueText(o.type, "/type", labels, choices)}（${(() => { const f = fromOf(h, o); return f === null ? "" : `${ymWords(f)}〜`; })()}）`).join("・");
  return { current: valueText(cur.type, "/type", labels, choices), next: valueText(v.type, "/type", labels, choices), currentFrom, nextFrom, splitEnd, mode: splitEnd !== null ? "split" : "replace", endEstimated, following };
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
function titleOf(c: Candidate, imp: EngineRequest, slots: ReadonlyMap<string, number>): string {
  const group = groupOf(c);
  // お子さまは何人目の問いの答えか（3人目だけ答えたお子さまは「第3子」。取り込んだ側の生まれの順〔第1子〕では呼ばない）
  const label = new Map([...roles(imp).map((r) => [r.member.id, r.label] as const), ...[...slots].map(([id, n]) => [id, `第${String(n)}子`] as const)]);
  const v = c.value as Obj;
  const company = typeof v.subtype === "string" && (c.collection === "accounts" || c.collection === "debts") ? COMPANY_TITLES[v.subtype] : undefined;
  if (company !== undefined) {
    const who = c.collection === "debts" ? (v.debtors as { member: string }[] | undefined)?.[0]?.member : (v.owner as string | undefined);
    return who !== undefined && label.has(who) ? `${label.get(who) as string}の${company}` : company;
  }
  // 親・祖父母（世帯の外の家族）は父・母・義父・義母と呼ぶ（介護・親の項目と同じ）
  if (c.collection === "members" && (v.kind === "parent" || v.kind === "grandparent")) return memberLabels({ request: imp, assumed: {}, labelsByMember: {} } as unknown as WorkingHousehold).get(v.id) ?? "ご家族";
  if (c.collection === "members") return label.get(v.id) ?? "ご家族";
  // ご両親の介護・仕送り・援助（詳細版の版3から）: 母の介護・母への仕送り・母からの援助。受け取る予定の相続は相手を聞かない
  const elders = memberLabels({ request: imp, assumed: {}, labelsByMember: {} } as unknown as WorkingHousehold);
  const elder = (id: unknown) => (typeof id === "string" ? imp.input.household.members.find((m) => m.id === id && (m.kind === "parent" || m.kind === "grandparent")) : undefined);
  if (c.collection === "careExpenses" && elder(v.member) !== undefined) return `${elders.get(v.member as string) ?? "親"}の介護`;
  if (c.collection === "periodicExpenses" && v.kind === "allowance") return elder(v.counterparty) !== undefined ? `${elders.get(v.counterparty as string) ?? "親"}への仕送り` : "仕送り";
  if (c.collection === "incomeFlows" && v.kind === "support") return elder(v.counterparty) !== undefined ? `${elders.get(v.counterparty as string) ?? "親"}からの援助` : "援助";
  if (c.collection === "incomeFlows" && v.kind === "inheritance") return "受け取る予定の相続・贈与";
  for (const k of MEMBER_REFS) if (typeof v[k] === "string" && label.has(v[k] as string)) return `${label.get(v[k] as string) as string}の${group}`;
  return group;
}

// ---- 今の値と届いた値を比べる（今の値を壊さない。お答えの無い欄は今の値のまま・今の方が詳しければ既定で残す） ----

/** 物の中の場所（JSON Pointer の形 /a/b/0）の値 */
function valueAt(o: unknown, path: string): unknown {
  return path
    .split("/")
    .slice(1)
    .reduce<unknown>((x, seg) => (x !== null && typeof x === "object" ? (x as Record<string, unknown>)[seg] : undefined), o);
}

/** 比べるための欄の値: 年月の時点がイベントなどで決まる欄（timepointPath）は、解いた年月 */
function fieldValue(o: Obj, path: string, h: Household): unknown {
  const tp = timepointPath(o, path);
  if (tp === null) return valueAt(o, path);
  const v = valueAt(o, tp);
  return isPlain(v) ? (resolveTimepoint(h, v as Parameters<typeof resolveTimepoint>[1]) ?? undefined) : undefined;
}

/** 物の中の場所の入れ物（最後の段の1つ前） */
function parentAt(o: unknown, path: string): { parent: Record<string, unknown>; last: string } | null {
  const segs = path.split("/").slice(1);
  const last = segs.pop();
  if (last === undefined) return null;
  const parent = segs.reduce<unknown>((x, seg) => (x !== null && typeof x === "object" ? (x as Record<string, unknown>)[seg] : undefined), o);
  return parent !== null && typeof parent === "object" ? { parent: parent as Record<string, unknown>, last } : null;
}

/** 物の中の場所に値を入れる（undefined は欄を外す。途中の入れ物が無ければ入れない） */
function setAt(o: unknown, path: string, value: unknown): void {
  const at = parentAt(o, path);
  if (at === null) return;
  if (value === undefined) delete at.parent[at.last];
  else at.parent[at.last] = structuredClone(value);
}

type Box = { state: string; value?: unknown; origin: unknown };
const isBox = (v: unknown): v is Box => v !== null && typeof v === "object" && "state" in v && "origin" in v;

/** 今の世帯のその欄に値があるか（値の箱は確定か推定のときだけ。未入力・わからない・該当なしは値なし） */
function hasValue(v: unknown): boolean {
  if (v === undefined || v === null) return false;
  return !isBox(v) || v.state === "confirmed" || v.state === "estimated";
}

/**
 * お答えの無い欄で、今の物の値を残せるか。値の箱は確定・推定・該当なし（FP が決めたもの）のとき、箱の無い欄は入れ物があれば
 * 欄が無い・なし（null）も今の値として残す。値の箱が未入力・わからないなら、補った値（目安など）を入れる
 */
function keepable(cur: Obj, path: string): boolean {
  const v = valueAt(cur, path);
  if (isBox(v)) return v.state === "confirmed" || v.state === "estimated" || v.state === "notApplicable";
  return v !== undefined || parentAt(cur, path) !== null;
}

/** 今の値が確定（推定・仮の印の無い値）か。値の箱は確定の状態、箱の無い欄は仮の印（assumed）が無いこと */
function isFirm(v: unknown, uiKey: string | null, assumed: Readonly<Record<string, string>>): boolean {
  if (!hasValue(v)) return false;
  if (isBox(v)) return v.state === "confirmed";
  return uiKey === null || assumed[uiKey] === undefined;
}

/** 欄の名前（入力項目IDと物の中の場所から。無ければ場所だけ・入力項目の名前の順） */
const PATH_LABELS: Readonly<Record<string, string>> = {
  "debt.repayment /repayment/termMonths": "返済期間",
  "debt.repayment /repayment/method": "返済の方法",
  "debt.rateSchedule /rateSchedule/0/rate": "金利",
  "debt.rateSchedule /rateSchedule/0/type": "金利の種類",
  "debt.debtors /debtors/0/member": "借りている人",
  "debt.start /start/at": "借りた年月",
  "debt.housing /housing": "住宅ローン控除の条件",
  "employment.type /type": "働き方",
  "employment.from /from/at": "仕事を始めた年月",
  "employment.to /to/at": "仕事を終える年月",
  "employment.to /to": "仕事を終える年月",
  "residence.from /from/at": "住み始めた年月",
  "pensionRecord.amounts /amounts/basic": "老齢基礎年金の額",
  "pensionRecord.amounts /amounts/employee": "老齢厚生年金の額",
  "pensionRecord.months /months/basic": "年金の加入期間（合計）",
  "pensionRecord.months /months/employee": "厚生年金の加入期間",
  "member.birth /birth/birthYearMonth": "生年月",
  "member.kind /related/0/marriage": "ご結婚の形",
  "member.support /support/cohabiting": "同居か",
  "member.taxReturn /taxReturn/method": "確定申告の仕方",
  "member.taxReturn /taxReturn/blueDeduction": "青色申告特別控除",
};

function pathLabel(f: Pick<FieldRecord, "path" | "item">, fallback: string): string {
  if (f.item === "goal.education") return `進路（${String(Number(/stages\/(\d+)/.exec(f.path)?.[1] ?? 0) + 1)}つ目の学校）`;
  return PATH_LABELS[`${f.item} ${f.path}`] ?? ITEM_LABELS[f.item] ?? fallback;
}

/** 決まった言葉の値（進路・金利・返済の方法など。シートの選択肢の言葉が無いとき） */
const WORDS: Readonly<Record<string, string>> = {
  kindergarten: "幼稚園",
  elementary: "小学校",
  juniorHigh: "中学校",
  highSchool: "高校",
  university: "大学",
  public: "公立",
  private: "私立",
  national: "国立",
  humanities: "文系",
  science: "理系",
  away: "自宅外",
  home: "自宅",
  variable: "変動金利",
  fixed: "固定金利",
  fixedPeriod: "固定期間選択",
  equalPayment: "元利均等",
  equalPrincipal: "元金均等",
};

const ymWords = (ym: string): string => `${ym.slice(0, 4)}年${Number(ym.slice(5, 7))}月`;

/** 世帯の値を言葉に（候補の「今 → 届いた値」の表示用。単位は欄の場所から） */
function valueText(v: unknown, path: string, labels: ReadonlyMap<string, string>, choices: ReadonlyMap<string, string>): string {
  if (v === undefined) return "入れていない";
  if (v === null) return "なし";
  if (isBox(v)) {
    if (v.state === "confirmed") return valueText(v.value, path, labels, choices);
    if (v.state === "estimated") return `${valueText(v.value, path, labels, choices)}（推定）`;
    if (v.state === "unknown") return "わからない";
    if (v.state === "notApplicable") return "該当なし";
    return "（未入力）";
  }
  if (typeof v === "boolean") return v ? "はい" : "いいえ";
  if (typeof v === "number") {
    if (path.endsWith("termMonths")) return `${String(v)}か月${v % 12 === 0 ? `（${String(v / 12)}年）` : ""}`;
    if (/months/i.test(path)) return `${String(v)}か月`;
    if (/hours/i.test(path)) return `${String(v)}時間`;
    if (path.endsWith("/size")) return `${String(v)}人`;
    return `${v.toLocaleString("ja-JP")}円`;
  }
  if (typeof v === "string") {
    if (/^\d{4}-\d{2}$/.test(v)) return ymWords(v);
    // 確定申告の仕方（0155）: 入力の画面と同じ言葉
    if (path.startsWith("/taxReturn/")) return [...TAX_RETURN_METHODS, ...BLUE_DEDUCTIONS].find((o) => o.value === v)?.label ?? v;
    // 厚生年金の種別・働き方（シートの選択肢に無い種類）: 入力の画面と同じ言葉
    if (path === "/pensionCategory") return PENSION_CATEGORY.find((o) => o.value === v)?.label ?? v;
    if (path === "/type" && !choices.has(v)) return EMPLOYMENT_TYPES.find((o) => o.value === v)?.label ?? v;
    const numeric = /^-?\d+(\.\d+)?$/.test(v);
    if (/rate/i.test(path) && numeric) return `${String(Math.round(Number(v) * 1e6) / 1e4)}%`;
    if (/hours/i.test(path) && numeric) return `${v}時間`;
    return labels.get(v) ?? choices.get(v) ?? WORDS[v] ?? v;
  }
  if (typeof v === "object" && typeof (v as { at?: unknown }).at === "string") return valueText((v as { at: string }).at, path, labels, choices);
  // 進路の1つ（学校・公立か私立か・文系か理系か・自宅か）
  if (typeof v === "object" && typeof (v as { stage?: unknown }).stage === "string") {
    const o = v as Record<string, unknown>;
    return ["stage", "sector", "field", "living"].flatMap((k) => (typeof o[k] === "string" ? [WORDS[o[k] as string] ?? (o[k] as string)] : [])).join("・");
  }
  return "（詳しい値）";
}

/** 今の世帯の、分岐の問いにあたる人数・本数・件数（配偶者の方は 1 か 0。住宅ローンは住まいのもの〔収益不動産のローンは数えない〕） */
export function gateCounts(h: Household): Record<Exclude<GateKind, "parent">, number> & { parent: number; parentRows: number } {
  const members = h.members ?? [];
  return {
    spouse: members.some((m) => m.kind === "spouse") ? 1 : 0,
    child: members.filter((m) => m.kind === "child").length,
    loan: (h.debts ?? []).filter((d) => d.kind === "mortgage" && d.property === undefined).length,
    policy: (h.insuranceContracts ?? []).length,
    parent: members.filter((m) => m.kind === "parent").length,
    // ご両親の区画の問いで入る行（仕送り・援助・介護の費用・受け取る予定の相続）
    parentRows:
      (h.periodicExpenses ?? []).filter((x) => x.kind === "allowance").length +
      (h.incomeFlows ?? []).filter((x) => x.kind === "support" || x.kind === "inheritance").length +
      (h.careExpenses ?? []).length,
  };
}

const GATE_UNIT: Readonly<Record<"child" | "loan" | "policy", { head: string; unit: string }>> = { child: { head: "お子さま", unit: "人" }, loan: { head: "住宅ローン", unit: "本" }, policy: { head: "保険", unit: "件" } };

/**
 * 分岐の答えを今の世帯と照らした要確認の知らせ（0139 の追記 2026-11-08）。同じなら出さない。人数・本数・件数の最後の段（4人以上など）は、
 * 今の世帯がそれ以上なら同じとみる。ご両親のことを「答えない」は、今の世帯にご両親か、ご両親の区画の行があるときだけ出す（無ければ何も変わらない）
 */
export function gateNotices(gates: GateAnswersIn | undefined, def: SheetDefinition, h: Household): GateNotice[] {
  if (gates === undefined) return [];
  const cur = gateCounts(h);
  const out: GateNotice[] = [];
  const s = gates.spouse;
  if (s !== undefined && s !== cur.spouse) out.push({ gate: "spouse", text: s === 0 ? "配偶者はいないとのお答え（今の世帯にはいます）" : "配偶者がいるとのお答え（今の世帯にはいません）" });
  for (const g of ["child", "loan", "policy"] as const) {
    const n = gates[g];
    if (n === undefined || n === cur[g]) continue;
    const max = def.axes.find((a) => a.id === g)?.count ?? 0;
    if (n === max && cur[g] >= n) continue;
    const u = GATE_UNIT[g];
    out.push({ gate: g, text: `${u.head}は${n}${u.unit}${n === max && max > 2 ? "以上" : ""}とのお答え（今の世帯は${cur[g]}${u.unit}）` });
  }
  if (gates.parent === 0 && (cur.parent > 0 || cur.parentRows > 0)) {
    out.push({ gate: "parent", text: `ご両親のことは答えないとのお答え（${cur.parent > 0 ? `今の世帯のご両親 ${cur.parent}人と、` : "今の世帯の"}仕送り・援助・介護・受け取る予定の相続の値は今のまま）` });
  }
  return out;
}

const PARENT_NEW_NOTE = "亡くなる見込みは、平均余命の推定（仮の値）で入れます（介護・親の項目で親を足したときと同じ）。扶養・親のお金・介護の費用はシートでお聞きしていません。介護・親の項目で入れてください";
const SALARY_KEEP_NOTE = "標準報酬月額・企業年金など、シートでお聞きしていない欄は今の値のままです。年収が大きく変わったときは、承認の後に入力の画面で確かめてください";
const PARENT_KEEP_NOTE = "亡くなる見込み・扶養・親のお金・介護の費用はシートでお聞きしていないので、今の値のままです";

/** 返ってきた .xlsx を読み、候補を今の世帯と照らした一覧にする（現状は変えない） */
export async function importSheet(bytes: Uint8Array, wh: WorkingHousehold, newId?: () => string): Promise<ImportOutcome> {
  const r = await importHearingSheet(bytes, { baseMonth: wh.request.input.baseMonth, requests: logOf(wh).requests, ...(newId !== undefined ? { newId } : {}) });
  if (!r.ok) return { ok: false, issues: r.issues };
  return { ok: true, view: viewOfResult(r, wh) };
}

/**
 * 取り込みの結果（Excel・Web のどちらでも同じ受け皿の結果）を、今の世帯と照らした一覧にする（現状は変えない）。
 * waiting は Web のヒアリングで頼んだ書類で分かる問い（項目キーか「キー#番号」→ 言葉）。お答えの無い欄を「書類を待っています」と言い分ける（0192）
 */
export function viewOfResult(r: ImportView["result"], wh: WorkingHousehold, waiting: ReadonlyMap<string, string> = new Map()): ImportView {
  const waitingOf = (key: string, index: number | undefined): string | null => waiting.get(`${key}#${index ?? 0}`) ?? waiting.get(key) ?? null;
  const imp = r.request as unknown as EngineRequest;
  const cur = wh.request.input.household;
  const members = memberMatch(cur, imp.input.household, r.candidates);
  const slots = childSlots(r.candidates);
  const curLists = lists(cur);
  const used = new Set<string>();
  const match = new Map<string, string>(members);
  const assumedOf = (key: string) => r.assumed[key] ?? null;
  const contradictions = new Map<string, string[]>();
  for (const c of r.checklist) if (c.reason === "contradiction") contradictions.set(c.key, [...(contradictions.get(c.key) ?? []), c.message]);
  for (const i of r.issues) if (i.code === "H_CONTRADICTION" && i.key !== undefined) contradictions.set(i.key, [...new Set([...(contradictions.get(i.key) ?? []), i.message])]);

  // 「今 → 届いた値」の言葉: 構成員の ID は呼び名（今の世帯と取り込んだ側の両方）、選ぶ答えは選択肢の言葉
  const names = new Map<string, string>([...roles(imp).map((x) => [x.member.id, x.label] as const), ...roles(wh.request).map((x) => [x.member.id, x.label] as const)]);
  const choicesOf = (key: string) => new Map((r.definition.items.find((i) => i.key === key)?.choices ?? []).map((x) => [x.value, x.label]));
  /** お答えの無い欄で今の値を残した項目（key#index）と、お答えの無い欄を補った値のまま入れる項目 */
  const keptKeys = new Set<string>();
  const filledKeys = new Set<string>();
  /** 候補ごと: 指している今の世帯の人・お答えの無い新しい行か・補った値のまま入れる項目 */
  const side = new Map<string, { refs: string[]; quietNew: boolean; filled: string[] }>();

  const candidates: CandidateView[] = r.candidates.map((c) => {
    const v = c.value as Obj;
    let found: Obj | undefined;
    if (c.collection === "members") {
      const id = members.get(v.id);
      found = id === undefined ? undefined : cur.members.find((m) => m.id === id) as unknown as Obj | undefined;
    } else if (c.collection === "employmentPeriods" && typeof v.member === "string") {
      // 働き方の期間: その人の今（計算基準月）にかかっている期間と、種類が違っても対応づける（0139 の追記 2026-11-07）
      found = currentWork(cur, members.get(v.member) ?? v.member, v.type, wh.request.input.baseMonth, used);
      if (found !== undefined) {
        used.add(found.id);
        match.set(v.id, found.id);
      }
    } else {
      const sig = signature(c.collection, v, members);
      found = (curLists[c.collection] ?? []).find((o) => !used.has(o.id) && signature(c.collection, o, new Map()) === sig);
      if (found !== undefined) {
        used.add(found.id);
        match.set(v.id, found.id);
      }
    }
    const mapped = remap(v, match);
    // 本人・配偶者・子の、シートで聞かない欄（連帯保証の額の版1・性別の記入が無いとき・世帯を離れる時期・確定申告の仕方の答えが無いとき など）は、
    // 記録のある欄だけを重ねる形（patchRow）で今の値のまま残るので、比べるのも重ねた後の行で
    const work = c.collection === "employmentPeriods" && found !== undefined && found.type !== v.type ? workChangeOf(wh, c, v, found, names, choicesOf("hs.work.type")) : null;
    // 定年の「わからない」「該当なし」（終わり無し）と、今の終わりが働く最後の年齢の推定（取り込みの後に入れた推定など）は同じとみる
    // （取り込み直しで「変わった」に出さない。承認しても推定が入り直す。0139 の追記 2026-11-07）。推定と一緒に入れた辞めた後の給付の推定も比べない
    const endEstimated = c.collection === "employmentPeriods" && found !== undefined && endEstimatedOf(wh, found.member as string);
    const sameOpenEnd = work === null && endEstimated && c.fields.some((f) => f.path === "/to" && f.noAnswer !== true) && mapped.to === null;
    if (found !== undefined && sameOpenEnd) found = withoutAutoClaims({ ...found, to: null });
    const parent = c.collection === "members" && v.kind === "parent";
    // 承認すると入る行: 今の行に、記録のある欄だけを重ねた形（親と働き方の種類が変わった期間は、届いた行。0139）
    const shaped = found === undefined || replacesWhole(c.collection, v, work) ? mapped : patchRow(c.collection, found, mapped, c.fields, cur).row;
    let changedFields = 0;
    let keptFields = 0;
    /** 記入どおりの値（範囲・推定・仮でない）で変わる欄の数 */
    let firmChanges = 0;
    const rough: string[] = [];
    const diffs = new Map<string, FieldDiff[]>();
    if (found !== undefined) {
      const h = cur;
      for (const f of c.fields) {
        const next = fieldValue(shaped, f.path, h);
        const cur = fieldValue(found, f.path, h);
        if (JSON.stringify(plain(next)) === JSON.stringify(plain(cur))) continue;
        const row = `${f.key}#${f.index ?? 0}`;
        const label = pathLabel(f, keyLabel(r.definition, f.key));
        // お答えの無い欄（空欄・「あとで」・聞いていない）は、今の値があれば承認しても今の値のまま（applyImport で戻す）。働き方の種類が
        // 変わり、今の終わりが推定なら、終わりは届いた働き方で推定し直す（残さない）
        const kept = f.noAnswer === true && keepable(found, f.path) && !(work?.endEstimated === true && f.path.startsWith("/to"));
        const uiKey = f.uiKey === undefined ? null : remap(f.uiKey.split("/"), match).join("/");
        const isRough = !kept && (f.state === "estimated" || f.state === "unknown" || f.state === "assumed") && isFirm(cur, uiKey, wh.assumed);
        if (kept) {
          keptFields++;
          keptKeys.add(row);
        } else changedFields++;
        if (isRough && !rough.includes(label)) rough.push(label);
        if (!kept && (f.state === "confirmed" || f.state === "notApplicable")) firmChanges++;
        const choices = choicesOf(f.key);
        diffs.set(row, [...(diffs.get(row) ?? []), { label, current: valueText(cur, f.path, names, choices), next: kept ? valueText(cur, f.path, names, choices) : valueText(next, f.path, names, choices), kept, rough: isRough, waiting: kept ? waitingOf(f.key, f.index) : null }]);
      }
    }
    const filled = c.fields.filter((f) => f.noAnswer === true && (found === undefined || !keepable(found, f.path))).map((f) => `${f.key}#${f.index ?? 0}`);
    // 今の世帯の人を指す新しい行で、どの欄にもお答えが無い（目安・推定で補っただけ。答えていない配偶者の方の住民税の推定など）なら、
    // ほかに同じ人の新しい行が無いときは作らない（下でお答えなしにする。0139 の追記 2026-11-09）
    const refs = MEMBER_REFS.map((k) => mapped[k]).filter((x): x is string => typeof x === "string");
    const quietNew = found === undefined && c.collection !== "members" && c.fields.length > 0 && c.fields.every((f) => f.noAnswer === true) && refs.length > 0 && refs.every((id) => cur.members.some((m) => m.id === id));
    side.set(c.id, { refs, quietNew, filled });
    // 親はシートで聞いた欄（生年月・性別・同居か）だけで比べる（亡くなる見込みなど、聞かない欄は承認しても今の値を残す）。
    // ほかの物は、記録のある欄だけを重ねた行で比べる（聞かない欄は承認しても今の値を残す。patchRow）
    const whole = !parent && found !== undefined && JSON.stringify(plain(shaped)) !== JSON.stringify(plain({ ...found, id: v.id }));
    const kind: CandidateKind = found === undefined ? "new" : changedFields > 0 ? "changed" : keptFields > 0 ? "noAnswer" : whole ? "changed" : "same";
    const seen = new Set<string>();
    const fields: FieldView[] = [];
    const assumedKey = Object.keys(r.assumed).find((key) => key.includes(v.id));
    for (const f of c.fields) {
      const k = `${f.key}#${f.index ?? 0}`;
      const label = keyLabel(r.definition, f.key);
      const mark = markOf(v, f, assumedKey !== undefined ? assumedOf(assumedKey) : null);
      if (seen.has(k)) {
        // 同じ答えから補った別の欄（年収から標準報酬の目安など）は、印のあるものだけを1行足す
        if (mark.mark !== null && !fields.some((x) => x.label.startsWith(label) && x.mark === mark.mark)) fields.push({ label: `${label}から補った値`, answer: "目安", ...mark, noAnswer: false, diffs: [] });
        continue;
      }
      seen.add(k);
      const a = r.record.answers.find((x) => x.key === f.key && (x.index ?? 0) === (f.index ?? 0));
      fields.push({ label, answer: answerText(r.definition, a, f.key), ...mark, noAnswer: f.noAnswer === true, diffs: kind === "changed" || kind === "noAnswer" ? (diffs.get(k) ?? []) : [] });
    }
    const cons = [...new Set(c.fields.flatMap((f) => contradictions.get(f.key) ?? []))];
    // 今の値が確定で、届いた値が範囲・推定・仮の値だけなら、既定で残す（チェックを外す）。記入どおりの値でも変わる欄があれば既定で入れ、
    // 仮の値などに置きかわる欄を知らせる
    const keep = kind === "changed" && rough.length > 0 && firmChanges === 0 ? `今の値の方が詳しいので残します（届いた${rough.join("・")}は範囲・推定・仮の値です）。届いた値にするなら、チェックを入れてください` : null;
    const caution = kind === "changed" && rough.length > 0 && firmChanges > 0 ? `${rough.join("・")}は、今の確定の値が範囲・推定・仮の値に置きかわります。今の値を残すなら、承認の後に入力の画面で直してください` : null;
    // 親: 新しく入る親は、亡くなる見込みを平均余命の推定（仮）で入れる（applyImport。介護・親の項目で親を足したときと同じ）。今いる親は聞かない欄を残す
    // 年収が変わっても、標準報酬月額など、シートでお聞きしていない欄は今の値のまま（patchRow）
    const salaryChanged = c.fields.some((f) => f.path === "/salary/annual" && (diffs.get(`${f.key}#${f.index ?? 0}`) ?? []).some((d) => !d.kept));
    const salaryNote = kind === "changed" && c.collection === "employmentPeriods" && work === null && found?.standardMonthlyRemuneration !== undefined && salaryChanged ? SALARY_KEEP_NOTE : null;
    const note = parent ? (found === undefined ? PARENT_NEW_NOTE : PARENT_KEEP_NOTE) : [c.note, salaryNote].filter((x): x is string => x !== null).join("。") || null;
    // お答えなしの物の、お答えの無い欄がどれも頼んだ書類で分かる問いなら「書類を待っています」と言い分ける
    const keptDiffs = [...diffs.values()].flat().filter((d) => d.kept);
    const waits = keptDiffs.length > 0 && keptDiffs.every((d) => d.waiting !== null) ? [...new Set(keptDiffs.map((d) => d.waiting as string))] : [];
    return { id: c.id, group: groupOf(c), title: titleOf(c, imp, slots), kind, review: c.status === "needsReview", contradictions: cons, fields, changedFields, note, keep, caution, work, waiting: kind === "noAnswer" && waits.length > 0 ? waits.join("・") : null };
  });
  // お答えの無い新しい行（上の quietNew）: 同じ人を指す新しい行（答えのある働き方など）がほかに無ければ、作らない（お答えなし）
  const newRefs = new Set(candidates.flatMap((x) => (x.kind === "new" && side.get(x.id)?.quietNew !== true ? (side.get(x.id)?.refs ?? []) : [])));
  for (const x of candidates) {
    const s = side.get(x.id);
    if (s?.quietNew === true && x.kind === "new" && !s.refs.some((id) => newRefs.has(id))) {
      const records = r.candidates.find((y) => y.id === x.id)?.fields ?? [];
      // 頼んだ書類で分かる問い（住民税の決定通知書など）なら「書類を待っています」と言い分ける（0192 と同じ）
      const waits = records.map((f) => waitingOf(f.key, f.index));
      const waiting = waits.length > 0 && waits.every((w) => w !== null) ? [...new Set(waits as string[])].join("・") : null;
      const none = valueText(undefined, "", names, new Map());
      x.kind = "noAnswer";
      x.fields = x.fields.map((f) => ({ ...f, diffs: f.noAnswer ? [{ label: f.label, current: none, next: none, kept: true, rough: false, waiting }] : [] }));
      x.waiting = waiting;
      for (const f of records) keptKeys.add(`${f.key}#${f.index ?? 0}`);
    } else for (const key of s?.filled ?? []) filledKeys.add(key);
  }
  // 今の値を残した項目の「記入がありません（0円として計算します）」などの知らせは、残した値と合わないので出さない
  // （同じ項目を、今の値の無い物で補った値のまま使うときは出す）
  const quiet = (key: string | undefined, index: number | undefined) => key !== undefined && keptKeys.has(`${key}#${index ?? 0}`) && !filledKeys.has(`${key}#${index ?? 0}`);
  const checklist = r.checklist.filter((x) => !(x.reason === "missing" && quiet(x.key, x.index)));
  const issues = r.issues.filter((x) => !((x.code === "H_MISSING" || x.code === "H_ESTIMATED" || x.code === "H_ASSUMED") && x.level !== "error" && quiet(x.key, x.index)));
  // 分岐の答え（Web だけ）が今の世帯と違えば知らせる。今の世帯の人・行を消す候補は作らない（FP が入力の画面で直す。0139 の追記 2026-11-08）
  return { definition: r.definition, candidates, checklist, issues, memo: r.memo, consents: r.consents, pending: r.pending, result: r, match, gates: gateNotices(r.gates, r.definition, cur) };
}

/**
 * 既定で承認する候補: 新規と変更（同じ中身の候補・要確認・矛盾のある候補・今の値の方が詳しい変更は、FP が選んだときだけ）。
 * お答えなしの物は候補にしない（今の値のまま）
 */
export function defaultSelection(view: ImportView): Set<string> {
  return new Set(view.candidates.filter((c) => (c.kind === "new" || c.kind === "changed") && !c.review && c.contradictions.length === 0 && c.keep === null).map((c) => c.id));
}

/** 働き方の種類が変わった候補の、候補の画面の言葉（見出し・2つの入れ方・添える知らせ） */
export function workChangeTexts(w: WorkChange): { head: string; split: string | null; replace: string; notes: string[] } {
  const since = w.currentFrom === null ? "" : `・${ymWords(w.currentFrom)}〜`;
  const notes: string[] = [];
  if (w.splitEnd === null) notes.push(`仕事を始めた年月のお答えが無い（または今の期間の始まりより前・計算基準月より後の）ため、今の期間を${w.next}に置きかえます`);
  if (w.endEstimated) notes.push("今の期間の終わりは働く最後の年齢の推定なので残しません（推定の定年後の期間は外し、定年のお答えが無ければ、届いた働き方で推定し直します）");
  if (w.following !== null) notes.push(`この後の働き方の期間（${w.following}）はそのまま残します。届いた働き方に終わりが無ければ、その前の月で終えます。届いた定年と重なるときは、承認の後に入力の画面で直してください`);
  return {
    head: `働き方が変わりました: 今 ${w.current} → 届いた値 ${w.next}`,
    split: w.splitEnd === null || w.nextFrom === null ? null : `今の期間（${w.current}${since}）を${ymWords(w.splitEnd)}で終えて、${w.next}の期間を${ymWords(w.nextFrom)}から足す（転職・独立・役員になったとき）`,
    replace: `今の期間を${w.next}に置きかえる（今の入力が古かったとき。今の期間の${w.current}は残りません）`,
    notes,
  };
}

/** 働き方の種類が変わった候補の、既定の入れ方（候補の ID → 入れ方） */
export function defaultWorkModes(view: ImportView): Map<string, WorkChangeMode> {
  return new Map(view.candidates.flatMap((c) => (c.work !== null ? [[c.id, c.work.mode] as const] : [])));
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
export function applyImport(wh: WorkingHousehold, view: ImportView, selected: ReadonlySet<string>, at: string, workModes?: ReadonlyMap<string, WorkChangeMode>): ApplyResult {
  const r = view.result;
  const approved = approveAll(r, at) as unknown as EngineRequest;
  const impLists = lists(approved.input.household);
  const request = structuredClone(wh.request);
  const h = request.input.household;
  const curLists = lists(h);
  // お答えなしの物（今の値のまま）は、選ばれていても入れない
  const noAnswer = new Set(view.candidates.filter((c) => c.kind === "noAnswer").map((c) => c.id));
  const chosen = r.candidates.filter((c) => selected.has(c.id) && !noAnswer.has(c.id));
  // 新しく入る構成員は、そのままの ID で入る。入らない（承認しなかった）新規の構成員を指す物は入れない
  const present = new Set([...h.members.map((m) => m.id), ...chosen.filter((c) => c.collection === "members").map((c) => (c.value as Obj).id)]);
  const imported = new Set(approved.input.household.members.map((m) => m.id));
  const ids = new Map(view.match);
  const skipped: string[] = [];
  let added = 0;
  let replaced = 0;
  const viewOf = new Map(view.candidates.map((c) => [c.id, c]));
  /** 働き方の種類が変わった候補の入れ方（「終えて足す」が選べなければ置きかえる） */
  const modeOf = (id: string): WorkChangeMode | null => {
    const w = viewOf.get(id)?.work ?? null;
    if (w === null) return null;
    const m = workModes?.get(id) ?? w.mode;
    return m === "split" && w.splitEnd === null ? "replace" : m;
  };
  // 「終えて足す」の期間は今の期間と別の物（取り込んだ ID のまま足す。退職金などの参照も新しい期間を指す）
  for (const c of chosen) if (modeOf(c.id) === "split") ids.delete(c.target.object);
  /** 推定の定年後の予定を外した人（働き方の種類が変わり、今の終わりが推定だった人） */
  const postDropped = new Set<string>();
  const dropped = new Set<string>();
  /** お答えの無い欄で今の値を残した所の、仮の印のキー（取り込んだ側の印は入れず、今の印を残す） */
  const keptUiKeys = new Set<string>();
  /** 働き方の期間の終わりを取り込んだ側の値にした人（今の終わりを残した人は入れない）。働く最後の年齢の推定と印はこの人だけ入れ直す */
  const endFromImport = new Set<string>();
  /** 世帯を離れる時期を今の値のまま残した構成員（亡くなる見込み・子の独立の推定の印も残す） */
  const keptLeaves = new Set<string>();
  /** 記録のある欄だけを重ねた行で、値を入れた欄の今の印（「/行の ID/段」で終わるキー、または「=」の後のキーそのもの） */
  const replacedMarks = new Set<string>();
  /** 記録のある欄だけを重ねた今の行 */
  const patchedRows = new Set<string>();
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
    // 働き方の種類が変わった（0139 の追記 2026-11-07）: 今の終わりが推定なら、推定の定年後の期間と予定を外し、届いた働き方で推定し直す。
    // 「終えて足す」は今の期間を届いた働き方を始めた年月の前の月で終え、届いた期間を足す
    const work = viewOf.get(c.id)?.work ?? null;
    const mode = modeOf(c.id);
    const oldId = view.match.get(c.target.object);
    const old = work === null || oldId === undefined ? undefined : list.find((o) => o.id === oldId);
    let following: Obj[] = [];
    if (work !== null && old !== undefined && typeof old.member === "string") {
      const member = old.member;
      const posts = work.endEstimated ? estimatedPostPeriods(wh, member, old) : [];
      for (const p of posts) {
        const i = list.findIndex((o) => o.id === p.id);
        if (i >= 0) list.splice(i, 1);
      }
      if (work.endEstimated) postDropped.add(member);
      following = followingPeriods(wh, member, old, posts);
      if (mode === "split" && work.splitEnd !== null) {
        const end = toOf(h, old);
        if (end === null || end > work.splitEnd) old.to = { at: work.splitEnd };
        // 届いた働き方に終わりが無く、今の世帯にこの後の期間（FP が入れた予定）があれば、その前の月で終える（重ねない）
        const next = following[0] === undefined ? null : fromOf(h, following[0]);
        if (obj.to === null && next !== null) obj.to = { at: addMonths(next, -1) };
        else if (obj.to === null) endFromImport.add(member);
        list.push(obj);
        added++;
        continue;
      }
    }
    const at = list.findIndex((o) => o.id === obj.id);
    // 住宅ローンの入居のイベント（住宅ローン控除の条件 debt.housing が指す）は、ローンといっしょに入れる。置き換えたローンの前のイベントは外す
    const moveIn = (o: Obj | undefined) => ((o?.housing as { moveIn?: string } | undefined)?.moveIn ?? null);
    const withMoveIn = (row: Obj, prev: Obj | undefined) => {
      if (c.collection !== "debts") return;
      const ev = moveIn(row);
      const src = ev === null ? undefined : (approved.input.household.events ?? []).find((e) => e.id === ev);
      if (src !== undefined && !(h.events ?? []).some((e) => e.id === src.id)) (h.events ??= []).push(remap(src, ids));
      const old = moveIn(prev);
      if (old !== null && old !== ev) dropped.add(old);
    };
    if (at >= 0) {
      // 前の物の値の状態の行のうち、取り込みで値が変わらない所の行（FP が決めた「該当なし」「わからない」・確定の記録）は残す。
      // 値が変わった所は取り込んだ値と承認の記録が正（0041）
      const prev = list[at] as Obj;
      // お答えの無い欄（空欄・「あとで」・聞いていない）は、今の値があれば今の値のまま（目安・仮の値・0円で上書きしない）。働き方の種類が
      // 変わり、今の終わりが推定なら、終わりは残さない（届いた働き方で推定し直す）
      const keepsEnd = (f: FieldRecord) => !(work?.endEstimated === true && f.path.startsWith("/to"));
      const kept = (f: FieldRecord) => f.noAnswer === true && keepable(prev, f.path) && keepsEnd(f);
      let merged: Obj;
      if (replacesWhole(c.collection, obj, work)) {
        merged = c.collection === "members" ? keepParent(prev, obj) : obj;
        for (const f of c.fields) if (kept(f)) setAt(merged, f.path, valueAt(prev, f.path));
      } else {
        // 記録のある欄だけを今の行に重ねる（0139 の追記 2026-11-09。前は行ごと置きかえ、シートで聞かない欄が消えた）。範囲・推定・仮の値の答えが
        // 今の値と同じなら、今の値（確定の状態・承認の記録・印）のまま
        const same = (f: FieldRecord) => f.state !== "confirmed" && f.state !== "notApplicable" && JSON.stringify(plain(fieldValue(obj, f.path, h))) === JSON.stringify(plain(fieldValue(prev, f.path, h)));
        const p = patchRow(c.collection, prev, obj, c.fields.filter((f) => !kept(f) && !same(f)), h);
        merged = p.row;
        patchedRows.add(merged.id);
        for (const f of c.fields) if (same(f) && f.uiKey !== undefined) keptUiKeys.add(f.uiKey);
        for (const f of p.applied) for (const sfx of MARK_SUFFIXES[c.collection]?.[f.path] ?? []) replacedMarks.add(`/${merged.id}/${sfx}`);
        for (const f of p.applied) if (f.uiKey !== undefined) replacedMarks.add(`=${remap(f.uiKey.split("/"), ids).join("/")}`);
      }
      for (const f of c.fields) if (kept(f) && f.uiKey !== undefined) keptUiKeys.add(f.uiKey);
      withMoveIn(merged, prev);
      carryRows(prev, merged, c.collection === "members" ? { member: merged.id } : { object: merged.id });
      if (c.collection === "members" && prev.leaves !== undefined && prev.leaves !== null && JSON.stringify(prev.leaves) === JSON.stringify(merged.leaves)) keptLeaves.add(merged.id);
      // 働き方の種類が変わり、届いた働き方に終わりが無いとき、今の世帯にこの後の期間（FP が入れた予定）があれば、その前の月で終える（重ねない）
      const next = work !== null && following[0] !== undefined ? fromOf(h, following[0]) : null;
      if (work !== null && merged.to === null && next !== null) merged.to = { at: addMonths(next, -1) };
      else if (c.collection === "employmentPeriods" && typeof merged.member === "string" && c.fields.some((f) => f.path.startsWith("/to") && !kept(f))) endFromImport.add(merged.member);
      list[at] = merged;
      replaced++;
    } else {
      withMoveIn(obj, undefined);
      list.push(obj);
      if (c.collection === "employmentPeriods" && typeof obj.member === "string") endFromImport.add(obj.member);
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
  const keptCurrent = new Set([...keptUiKeys].map((k) => remap(k.split("/"), ids).join("/")));
  /**
   * 今の印を残すか: 置き換えた物の印は外す（取り込んだ側の印が正）。ただし、今の値を残した欄の印、今のまま残した世帯を離れる時期の印、
   * 働く最後の年齢の推定の印（人ごと）は、期間の終わりを取り込んだ側の値にしたときだけ外す（構成員を置き換えただけでは外さない。0139）
   */
  const keepMark = (k: string): boolean => {
    if (keptCurrent.has(k)) return true;
    const work = /^work\/([^/]+)\/(mainEnd|postType|retireAge)$/.exec(k);
    if (work !== null) return !endFromImport.has(work[1] ?? "") && !postDropped.has(work[1] ?? "");
    const leaves = /^family\/([^/]+)\/leaves$/.exec(k);
    if (leaves !== null && keptLeaves.has(leaves[1] ?? "")) return true;
    if (replacedMarks.has(`=${k}`) || [...replacedMarks].some((m) => m.startsWith("/") && k.endsWith(m))) return false;
    // 記録のある欄だけを重ねた行（行ごと置きかえていない今の行）は、ほかの欄の印を残す
    return ![...touched].some((id) => !patchedRows.has(id) && k.includes(id));
  };
  for (const [k, v] of Object.entries(wh.assumed)) if (keepMark(k)) assumed[k] = v;
  for (const [k, v] of Object.entries(r.assumed)) {
    if (keptUiKeys.has(k)) continue;
    const c = chosen.find((x) => k.includes(x.target.object));
    if (c !== undefined) assumed[remap(k.split("/"), ids).join("/")] = v;
  }
  const log = logOf(wh);
  const memo = r.memo.length > 0 ? [...wh.memo, ...r.memo.map((m) => `ヒアリング（${r.record.requestId}）: ${m}`)] : wh.memo;
  const postRetirement = postDropped.size === 0 ? wh.postRetirement : Object.fromEntries(Object.entries(wh.postRetirement).filter(([k]) => !postDropped.has(k)));
  const next: WorkingHousehold = {
    ...wh,
    request,
    postRetirement,
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
  // 取り込んだ働き方（会社員・パートなど）に終わりが無ければ、働く最後の年齢の推定を入れる（画面で働き方を入れたときと同じ。シートで定年を聞いて
  // 答えがあれば終わりがあるので何もしない。働き方を取り込まなかった人は変えない）
  // 今の世帯の終わりを残した期間（定年の答えが無い）は、終わりが無くても推定を入れない（答えの無い所は今のまま。0139）
  const workers = endFromImport;
  if (workers.size > 0) filled = withWorkEndEstimates(filled, workers);
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
