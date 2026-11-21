// AI 接続口から頼まれた Web のヒアリング（0125・0192）の発行と、世帯ファイルにまだ入っていない依頼（0222）。
// - 発行（runIssueJob）: 本体が受け取った AI の依頼（接続口が FP の画面と同じ関数で確かめた選び方）を、画面がもう一度同じ関数（checkSelection）で
//   確かめ、AI が書いた文（独自の質問・話題・書類の説明・名前・何のための問いか）の番号らしい所を書類の候補と同じ決まりで消してから、
//   FP の画面と同じ部品（issueRequest）で鍵を作って受け付けのサーバーに問いを置く。鍵の組・合言葉は画面の外に出さない
// - 置き場所: 渡された世帯の依頼で、その世帯を開いていれば世帯ファイル（FP が押して発行したときと同じ）。開いていない世帯の依頼と、世帯の
//   決まっていない依頼は、事務所データ（暗号化して保存。本体の office_hearing_*）に置く。開いていない世帯の依頼は、その世帯を開いたときに
//   世帯ファイルへ移す（世帯ファイルの hearing.web を書くのは画面だけ: 開いている世帯の保存とぶつからないように）
// - 世帯の決まっていない依頼は、答えを受け取る前に FP が「新しい世帯を作って取り込む」か「開いている世帯に取り込む」を選び、その世帯へ移してから、
//   今までの受け取り・取り込みの手順（WebRequests。「発行した URL」）で扱う
// - AI に返すのは数（聞く項目の数・お客さまの画面の数・所要時間）・期限・依頼番号と、見直しを含まない依頼だけ URL と案内文
//   （見直しを含む依頼は、URL の # の後ろの鍵で今の値が読めるので返さない。利用者の判断 2026-11-17）。顧客番号・世帯の内部 ID・呼び名は返さない
// - 上限: 世帯の決まっていない受け付け中の依頼は UNASSIGNED_LIMIT 件まで（本体の ai_share::hearing::UNASSIGNED_LIMIT と同じ）。
//   1時間の数の上限は本体（ai_share::hearing::HOURLY_LIMIT）
import { requestIdFrom } from "../../../../hearing/src/answers.ts";
import { issueRequest } from "../../../../hearing/src/web/fp.ts";
import { checkSelection, type WebSelection } from "../../../../hearing/src/web/packet.ts";
import type { RelayTransport } from "../../../../hearing/src/web/protocol.ts";
import { cleanText } from "../documents/privacy.ts";
import type { WorkingHousehold } from "../input/household.ts";
import { fromBody } from "../store/body.ts";
import { accepting, arrivalOf, estimateOf, invitationText, officeFace, prefillOf, removeOnServer, selectedCount, sheetOf, withWebEntry, type WebLogEntry, type WebOrigin } from "./web.ts";
import { AI_NAME_MAX, AI_PURPOSE_MAX } from "./aiSelection.ts";

/** 世帯の決まっていない、受け付け中の依頼の上限（本体の ai_share::hearing::UNASSIGNED_LIMIT と同じ） */
export const UNASSIGNED_LIMIT = 20;
/** 事務所の側の記録（AI が発行した依頼）を残す件数 */
export const AI_LOG_MAX = 200;
/** 何のための問いの既定の文（FP の画面と同じ） */
export const DEFAULT_PURPOSE = "ライフプランの作成と、家計・保険・資産運用のご相談のため";

/** 世帯ファイルにまだ入っていない依頼1件 */
export interface PendingWebRequest {
  entry: WebLogEntry;
  /** 渡された世帯の依頼なら、その世帯の内部ID（開いたときに世帯ファイルへ移す）。世帯の決まっていない依頼は null */
  householdId: string | null;
  /** 渡された世帯の顧客番号（画面に出すだけ。AI には返さない） */
  customerNo: string | null;
}

/** AI が発行した依頼の記録（事務所の側の記録。世帯の決まっていない依頼も残る。seen は FP が帯で確かめたか） */
export interface AiIssueLog {
  requestId: string;
  at: string;
  connector: string | null;
  /** new は世帯の決まっていない依頼、shared は渡された世帯の依頼 */
  household: "new" | "shared";
  customerNo: string | null;
  review: boolean;
  name: string;
  selectedCount: number;
  seen: boolean;
}

/** 事務所データの office_hearing の中身 */
export interface OfficeHearing {
  v: 1;
  requests: PendingWebRequest[];
  log: AiIssueLog[];
}

export const EMPTY_OFFICE_HEARING: OfficeHearing = { v: 1, requests: [], log: [] };

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** 事務所データの値を読む（読めない行は捨てる。欄の無い・空の事務所データは空） */
export function readOfficeHearing(v: unknown): OfficeHearing {
  if (!isObj(v) || v.v !== 1) return EMPTY_OFFICE_HEARING;
  const requests = (Array.isArray(v.requests) ? v.requests : []).filter(
    (r): r is PendingWebRequest => isObj(r) && isObj(r.entry) && isObj(r.entry.record) && typeof r.entry.record.requestId === "string" && (r.householdId === null || typeof r.householdId === "string"),
  );
  const log = (Array.isArray(v.log) ? v.log : []).filter((l): l is AiIssueLog => isObj(l) && typeof l.requestId === "string" && typeof l.at === "string").slice(-AI_LOG_MAX);
  return { v: 1, requests, log };
}

/** 世帯の決まっていない、受け付け中の依頼の数 */
export function unassignedAccepting(s: OfficeHearing, now: Date): number {
  return s.requests.filter((r) => r.householdId === null && accepting(r.entry, now)).length;
}

/** 帯に出す数（FP がまだ確かめていない、AI が発行した依頼） */
export function unseenCount(s: OfficeHearing): number {
  return s.log.filter((l) => !l.seen).length;
}

/** 「AI が発行した URL」の一覧に並ぶ行の数（記録と、記録の無い依頼） */
export function issuedCount(s: OfficeHearing): number {
  return s.log.length + s.requests.filter((r) => !s.log.some((l) => l.requestId === r.entry.record.requestId)).length;
}

/** 受け付け中の依頼に、答えか書類が届いていると分かっているか（確かめた結果。一覧の「届いています」・「発行した URL」の届いた数と同じ決め方） */
export function arrivedNow(e: WebLogEntry, now: Date): boolean {
  const a = arrivalOf(e.record.requestId);
  return a !== undefined && (a.answers || a.batches > 0) && accepting(e, now);
}

/** 世帯の決まっていない依頼で、答えか書類が届いている数（どの世帯の「発行した URL」にも並ばないので、表の下のリンクに添える） */
export function unassignedArrived(s: OfficeHearing, now: Date): number {
  return s.requests.filter((r) => r.householdId === null && arrivedNow(r.entry, now)).length;
}

export function markSeen(s: OfficeHearing): OfficeHearing {
  return { ...s, log: s.log.map((l) => (l.seen ? l : { ...l, seen: true })) };
}

/** 開いた世帯へ移す依頼（その世帯の依頼）と残り */
export function pendingFor(s: OfficeHearing, householdId: string): { take: PendingWebRequest[]; rest: OfficeHearing } {
  const take = s.requests.filter((r) => r.householdId === householdId);
  return { take, rest: { ...s, requests: s.requests.filter((r) => r.householdId !== householdId) } };
}

/** 世帯へ移す（同じ依頼番号が世帯にあれば、世帯の方を残す） */
export function moveInto(wh: WorkingHousehold, list: readonly PendingWebRequest[], existing: readonly string[]): WorkingHousehold {
  let out = wh;
  for (const r of list) if (!existing.includes(r.entry.record.requestId)) out = withWebEntry(out, r.entry);
  return out;
}

/** 世帯の決まっていない依頼を、世帯に結びつける（その世帯を開いたときに世帯ファイルへ移る） */
export function assignTo(s: OfficeHearing, requestId: string, householdId: string, customerNo: string | null): OfficeHearing {
  return { ...s, requests: s.requests.map((r) => (r.entry.record.requestId === requestId && r.householdId === null ? { ...r, householdId, customerNo } : r)) };
}

/** 依頼の記録を置き換える（取り消し・延長など） */
export function withPending(s: OfficeHearing, entry: WebLogEntry): OfficeHearing {
  return { ...s, requests: s.requests.map((r) => (r.entry.record.requestId === entry.record.requestId ? { ...r, entry } : r)) };
}

/** 取り消した・期限から90日を過ぎた世帯の決まっていない依頼を片付ける（記録 log は残す） */
export function pruned(s: OfficeHearing, now: Date): OfficeHearing {
  const keep = (r: PendingWebRequest) => {
    if (r.householdId !== null) return true;
    const end = Date.parse(r.entry.record.limitAt ?? r.entry.record.expiresAt);
    return !(r.entry.state === "cancelled" && Date.parse(r.entry.record.expiresAt) < now.getTime()) && !(Number.isFinite(end) && end + 30 * 86400_000 < now.getTime());
  };
  return { ...s, requests: s.requests.filter(keep) };
}

// ---- AI が書いた文の番号らしい所を消す（書類の候補・新しい世帯の候補と同じ決まり。documents/privacy.ts の cleanText） ----

/** 選び方の中の AI が書いた文（独自の質問・話題・書類の名前と説明・ひな形の名前）の番号らしい所を消す。消した数も返す */
export function scrubSelection(sel: WebSelection): { selection: WebSelection; masked: number } {
  let masked = 0;
  // 番号らしい所が無ければ、書いた文のまま（cleanText は全角の括弧なども直すので、消したときだけ置き換える）
  const clean = (t: string, max: number) => {
    const r = cleanText(t, max);
    if (!r.masked) return t;
    masked++;
    return r.text;
  };
  const selection: WebSelection = {
    ...sel,
    custom: sel.custom.map((c) => ({ ...c, label: clean(c.label, 120), ...(c.help !== undefined ? { help: clean(c.help, 300) } : {}), ...(c.choices !== undefined ? { choices: c.choices.map((x) => clean(x, 40)) } : {}) })),
    documents: sel.documents.map((d) => ({ ...d, title: clean(d.title, 80), purpose: clean(d.purpose, 200), where: clean(d.where, 200) })),
    ...(sel.topics !== undefined ? { topics: sel.topics.map((t) => clean(t, 30)) } : {}),
    ...(sel.name !== undefined ? { name: clean(sel.name, AI_NAME_MAX) } : {}),
  };
  return { selection, masked };
}

// ---- 発行（本体から届いた仕事） ----

/** 本体から届いた発行の仕事（host.ts の AiHearingJob と同じ形） */
export interface IssueJob {
  jobId: string;
  issue: { selection: unknown; purpose?: string };
  householdId: string | null;
  customerNumber: string | null;
  body: string | null;
  connector: string | null;
  receivedAt: string;
}

export interface IssueContext {
  transport: RelayTransport;
  config: () => Promise<{ pageUrl: string; dev: boolean }>;
  /** 事務所の見た目（名前と基調の色） */
  office: { name: string; color: string | null };
  /** 個人情報の窓口（FP の画面で入れた物。アプリを開いている間だけ覚える） */
  privacyContact: string;
  /** 開いている保存した世帯（閲覧だけなら readOnly） */
  opened: { id: string; wh: WorkingHousehold; readOnly: boolean } | null;
  now: Date;
  random?: Uint8Array;
}

/** 発行の答え（本体を通って AI に届く。ok でなければ message を AI に見せる） */
export type IssueAnswer =
  | {
      ok: true;
      requestId: string;
      expiresAt: string;
      selectedCount: number;
      screens: number | null;
      minutes: number | null;
      household: "new" | "shared";
      review: boolean;
      masked: number;
      url?: string;
      invitation?: string;
      message: string;
    }
  | { ok: false; code: string; message: string };

/** 発行した依頼をどこに置くか（open は開いている世帯に、office は事務所データに） */
export interface IssueOutcome {
  answer: IssueAnswer;
  entry: WebLogEntry | null;
  place: "open" | "office" | null;
  log: AiIssueLog | null;
}

/** 受け付けのサーバーの失敗の言葉（AI と FP に見せる） */
export function relayMessage(code: string): string {
  if (code === "E_HEARING_WEB_URL" || code === "E_HEARING_WEB_NO_RELAY")
    return "受け付けのサーバーがまだ用意されていません（この版のアプリには、本番の受け付けのサーバーの設定がありません）。URL は発行していません。";
  if (code === "E_RELAY_UNREACHABLE") return "受け付けのサーバーにつながりませんでした（インターネットにつながっているか確かめてください）。URL は発行していません。";
  if (code === "E_WEB_TOO_LARGE") return "問いが大きすぎます（項目・独自の質問・書類を減らしてください）。URL は発行していません。";
  return `発行できませんでした（${code}）。URL は発行していません。`;
}

/**
 * 本体から届いた発行の仕事を行う（置き場所への書き込みは呼ぶ側。書けなかったらサーバーから消す: cancelIssued）。
 * office は今の事務所データの依頼（上限を数える）
 */
export async function runIssueJob(job: IssueJob, ctx: IssueContext, office: OfficeHearing): Promise<IssueOutcome> {
  const no = (code: string, message: string): IssueOutcome => ({ answer: { ok: false, code, message }, entry: null, place: null, log: null });
  const raw = job.issue.selection as WebSelection;
  if (!isObj(raw) || !isObj((raw as { base?: unknown }).base)) return no("E_SELECTION", "選び方の形が違います。URL は発行していません。");
  const def = sheetOf(raw);
  if (def === undefined) return no("E_SELECTION", "このアプリの版では使えない票です。URL は発行していません。");
  const first = checkSelection(def, raw);
  if (first.length > 0) return no("E_SELECTION", `選び方に直す所があります（${first.join("・")}）。URL は発行していません。`);
  const { selection, masked } = scrubSelection(raw);
  const again = checkSelection(def, selection);
  if (again.length > 0) return no("E_SELECTION", `番号らしい所を消したら、選び方が使えなくなりました（${again.join("・")}）。番号を書かずに出し直してください。URL は発行していません。`);
  const review = selection.sections.some((s) => s.items.some((i) => i.mode === "confirm"));
  if (job.householdId === null && review) return no("E_SELECTION", "確かめてもらう項目（見直し）は、渡された世帯の依頼だけで使えます。URL は発行していません。");
  if (job.householdId === null && unassignedAccepting(office, ctx.now) >= UNASSIGNED_LIMIT)
    return no("E_LIMIT", `世帯の決まっていない受け付け中の依頼が上限（${UNASSIGNED_LIMIT}件）です。FP がアプリで受け取るか取り消すまで、新しい依頼は発行できません（渡された世帯の依頼は発行できます）。`);
  const purposeIn = typeof job.issue.purpose === "string" && job.issue.purpose.trim() !== "" ? job.issue.purpose.trim().slice(0, AI_PURPOSE_MAX) : null;
  const purposeClean = purposeIn === null ? null : cleanText(purposeIn, AI_PURPOSE_MAX);
  const purposeRaw = purposeIn === null || purposeClean === null ? null : { text: purposeClean.masked ? purposeClean.text : purposeIn, masked: purposeClean.masked };
  // 渡された世帯: 開いていればその世帯、開いていなければ本体の帳面の本文（見直しの前回の値だけに使う）
  let wh: WorkingHousehold | null = null;
  if (job.householdId !== null) {
    if (ctx.opened !== null && ctx.opened.id === job.householdId) wh = ctx.opened.wh;
    else if (job.body !== null) {
      try {
        wh = fromBody(job.body).wh;
      } catch {
        wh = null;
      }
    }
    if (review && wh === null) return no("E_HOUSEHOLD", "見直しの前回の値を作るための世帯を読めませんでした。FP がアプリでその世帯を開いてから、もう一度呼んでください。URL は発行していません。");
  }
  let cfg: { pageUrl: string; dev: boolean };
  try {
    cfg = await ctx.config();
  } catch (e) {
    return no("E_HEARING_WEB_NO_RELAY", relayMessage(e instanceof Error ? e.message : String(e)));
  }
  if (cfg.pageUrl.trim() === "") return no("E_HEARING_WEB_NO_RELAY", relayMessage("E_HEARING_WEB_NO_RELAY"));
  const face = officeFace({ name: ctx.office.name, color: ctx.office.color, purpose: purposeRaw?.text ?? DEFAULT_PURPOSE, privacyContact: ctx.privacyContact });
  let record;
  try {
    ({ record } = await issueRequest({
      definition: def,
      selection,
      requestId: requestIdFrom(ctx.random ?? crypto.getRandomValues(new Uint8Array(6))),
      customerNo: job.householdId !== null ? (job.customerNumber ?? "") : "",
      office: face,
      now: ctx.now,
      pageUrl: cfg.pageUrl,
      ...(review && wh !== null ? { prefill: prefillOf(wh, def) } : {}),
      transport: ctx.transport,
    }));
  } catch (e) {
    const code = e instanceof Error ? e.message : String(e);
    return no(code, relayMessage(code));
  }
  const origin: WebOrigin = { kind: "ai", at: record.issuedAt, connector: job.connector };
  const entry: WebLogEntry = { record, state: "issued", origin };
  const place = job.householdId !== null && ctx.opened !== null && ctx.opened.id === job.householdId && !ctx.opened.readOnly ? "open" : "office";
  // お客さまの最初の画面・案内文と同じ数（見直しは前回の値に合わせて問いを飛ばすので、この世帯の数。0192 の追記 2026-11-17）
  const est = estimateOf(wh, selection)?.shown ?? null;
  const count = selectedCount(selection);
  const log: AiIssueLog = { requestId: record.requestId, at: record.issuedAt, connector: job.connector, household: job.householdId === null ? "new" : "shared", customerNo: job.customerNumber, review, name: selection.name ?? "", selectedCount: count, seen: false };
  const where = job.householdId === null ? "世帯の決まっていない依頼として、アプリの「AI が発行した URL」に置きました（答えが届いたら、FP が新しい世帯を作るか、開いている世帯に取り込むかを選びます）" : "その世帯の「発行した URL」に置きました（その世帯を開いていなければ、開いたときに移ります）";
  const head = `URL を発行しました（依頼番号 ${record.requestId}・期限 ${record.expiresAt.slice(0, 10)}）。${where}。アプリの上の帯に「AI が URL を発行しました」と出て、FP は取り消せます。`;
  const answer: IssueAnswer = review
    ? { ok: true, requestId: record.requestId, expiresAt: record.expiresAt, selectedCount: count, screens: est?.screens ?? null, minutes: est?.minutes ?? null, household: job.householdId === null ? "new" : "shared", review, masked, message: `${head}見直し（今の値を見せて確かめてもらう項目）を含むので、URL と案内文は返しません（URL の # の後ろの鍵で今の値を読めるため）。FP がアプリの「発行した URL」で案内文をコピーして送ります。` }
    : {
        ok: true,
        requestId: record.requestId,
        expiresAt: record.expiresAt,
        selectedCount: count,
        screens: est?.screens ?? null,
        minutes: est?.minutes ?? null,
        household: job.householdId === null ? "new" : "shared",
        review,
        masked,
        url: record.url,
        invitation: invitationText(entry, ctx.office.name, wh),
        message: `${head}URL と案内文は、FP がお客さまにメールなどで送るためだけに使ってください（アプリはメールを送りません。案内文の「〇〇様」は FP が直します）。`,
      };
  return { answer, entry, place, log };
}

/** 置き場所に書けなかったとき: サーバーから消す（鍵を失った依頼を残さない） */
export async function cancelIssued(entry: WebLogEntry, t: RelayTransport): Promise<void> {
  try {
    await removeOnServer(entry, t);
  } catch {
    // つながらない: 期限（30日）で消える
  }
}

/** 事務所データに依頼と記録を足す */
export function withIssued(s: OfficeHearing, entry: WebLogEntry | null, householdId: string | null, customerNo: string | null, log: AiIssueLog | null): OfficeHearing {
  return {
    v: 1,
    requests: entry === null ? s.requests : [...s.requests.filter((r) => r.entry.record.requestId !== entry.record.requestId), { entry, householdId, customerNo }],
    log: log === null ? s.log : [...s.log, log].slice(-AI_LOG_MAX),
  };
}

// ---- 事務所のひな形の案（propose_hearing_template。0222） ----

/** 承認の画面に出すひな形の案（確かめた結果。problems があれば保存できない） */
export interface TemplateProposalView {
  candidateId: string;
  name: string;
  selection: WebSelection | null;
  problems: string[];
  masked: number;
  /** 同じ名前の事務所のひな形がある（保存すると置き換える） */
  replaces: boolean;
  /** ひな形がもう上限（置き換えでなければ保存できない） */
  full: boolean;
}

/** 届いたひな形の案を確かめる（画面と同じ関数。番号らしい所を消し、見直しの項目は断る。保存するときは templateForSave でそろえる） */
export function readTemplateProposal(c: { candidateId: string; name: string; selection: unknown }, templates: readonly { name: string }[], max: number): TemplateProposalView {
  const nameScrub = cleanText(c.name, AI_NAME_MAX);
  const nameClean = { text: nameScrub.masked ? nameScrub.text : c.name.trim().slice(0, AI_NAME_MAX), masked: nameScrub.masked };
  const base = { candidateId: c.candidateId, name: nameClean.text, replaces: templates.some((t) => t.name === nameClean.text), full: templates.length >= max };
  const raw = c.selection as WebSelection;
  if (!isObj(raw) || !isObj((raw as { base?: unknown }).base)) return { ...base, selection: null, problems: ["選び方の形が違います"], masked: 0 };
  const def = sheetOf(raw);
  if (def === undefined) return { ...base, selection: null, problems: ["このアプリの版では使えない票です"], masked: 0 };
  const { selection, masked } = scrubSelection(raw);
  const problems = checkSelection(def, selection);
  if (selection.sections.some((s) => s.items.some((i) => i.mode === "confirm"))) problems.push("確かめてもらう項目（見直し）は世帯に依るので、ひな形にできません");
  return { ...base, selection: problems.length > 0 ? null : selection, problems, masked: masked + (nameClean.masked ? 1 : 0) };
}
