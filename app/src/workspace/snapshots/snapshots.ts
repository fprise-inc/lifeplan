// 控え（0009 の2。作業の層）: 顧客に見せた時点・面談の区切りの時点の、現状とプランの写し。
// - 作るとき: 提案書の PDF を保存したとき（きっかけ「PDF書き出し」）と、FP が「この時点を残す」を押したとき（きっかけ「手動」）
// - 中身: 作った日時・きっかけ・メモ・計算の基準の月・その時点の現状とプランの全体の写し（保存していないプランの変更も含む）・アプリの版。
//   PDF のときは、提案にしたプラン・帳票の組み方・主な結果（帳票の入力の要約）・制度データの版も写す
// - 作った後は変えない（消すことはできる）。指紋（digest。中身の SHA-256）を持ち、一覧を開くたびに確かめる
// - 世帯ファイルの本文の区画 snapshots（0011 の2）に置く。宛名・担当の名前は入れない（0009 の3・0012）
// - まだ無いもの（次の回）: 実際に読んだ制度の値の写し（usedValues）・計算部品の版（components）・根拠の記録・宛名なしの PDF の暗号化した別ファイル
import type { CashflowLayout, Orientation, ProposalInput } from "../../../../report/src/index.ts";
import type { EngineRequest } from "../../engine/types.ts";
import type { ContingencyPlan } from "../contingency/planData.ts";
import type { WorkingHousehold } from "../input/household.ts";
import type { Proposal, Values } from "../plans/plans.ts";

export type SnapshotTrigger = "pdf" | "manual";

export const TRIGGER_TEXT: Record<SnapshotTrigger, string> = { pdf: "PDF書き出し", manual: "手動" };

/** メモの長さの上限 */
export const SNAPSHOT_MEMO_MAX = 80;

export interface Snapshot {
  id: string;
  /** 作った日時（ISO 8601。端末の時差つき） */
  createdAt: string;
  trigger: SnapshotTrigger;
  memo: string;
  /** 提案にしたプラン（PDF）・選んでいたプラン（手動）。帯の文字と名前はその時点のもの */
  plan: { id: string; letter: string; name: string } | null;
  /** 計算の基準の月 */
  baseMonth: string;
  /** その時点の現状とプランの全体の写し */
  inputs: {
    request: EngineRequest;
    proposals: Proposal[];
    contingency: ContingencyPlan;
    /** 保存していないプランの変更（プランの ID → 動かした値） */
    drafts: Record<string, Values>;
  };
  /** 提案書の PDF のとき: 載せた章・紙の向き・キャッシュフロー表の載せ方・目標の年齢・作成日 */
  report?: { chapters: string[]; orientation: Orientation; cashflow: CashflowLayout; targetAge: number | null; issuedOn: string };
  /** 提案書の PDF のとき: 主な結果（帳票の入力の要約）と制度データの版 */
  outputs?: { summary: ProposalInput["summary"]; dataSet: ProposalInput["assumptions"]["dataSet"] };
  appVersion: string;
  /** 中身（digest 以外）の指紋: "sha256:<16進>" */
  digest: string;
}

export type SnapshotDraft = Omit<Snapshot, "id" | "createdAt" | "digest" | "baseMonth" | "inputs" | "appVersion">;

/** キーの順をそろえた JSON（指紋の材料。保存して読み直しても同じ文字列になる） */
export function canonicalJson(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map((x) => canonicalJson(x === undefined ? null : x)).join(",")}]`;
  if (typeof v === "object" && v !== null) {
    const o = v as Record<string, unknown>;
    return `{${Object.keys(o)
      .filter((k) => o[k] !== undefined)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonicalJson(o[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(v);
}

async function sha256(text: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return `sha256:${[...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("")}`;
}

/** 控えの指紋（digest を除いた中身） */
export function snapshotDigest(s: Omit<Snapshot, "digest"> & { digest?: string }): Promise<string> {
  const { digest: _d, ...rest } = s;
  void _d;
  return sha256(canonicalJson(rest));
}

/** 端末の時差つきの ISO 8601（例: 2027-04-12T14:03:00+09:00） */
export function localIso(d: Date): string {
  const p = (n: number) => String(Math.abs(n)).padStart(2, "0");
  const off = -d.getTimezoneOffset();
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}${off >= 0 ? "+" : "-"}${p(Math.trunc(off / 60))}:${p(off % 60)}`;
}

/** 控えを作る（世帯の写しは深く写す。後で世帯を直しても控えは変わらない） */
export async function makeSnapshot(o: { wh: WorkingHousehold; drafts: Record<string, Values>; draft: SnapshotDraft; appVersion: string; now?: Date; id?: string }): Promise<Snapshot> {
  const body: Omit<Snapshot, "digest"> = structuredClone({
    id: o.id ?? crypto.randomUUID(),
    createdAt: localIso(o.now ?? new Date()),
    ...o.draft,
    memo: o.draft.memo.trim().slice(0, SNAPSHOT_MEMO_MAX),
    baseMonth: o.wh.request.input.baseMonth,
    inputs: { request: o.wh.request, proposals: o.wh.proposals, contingency: o.wh.contingency, drafts: o.drafts },
    appVersion: o.appVersion,
  });
  return { ...body, digest: await snapshotDigest(body) };
}

/** 控えの中身が作ったときのままか（指紋で確かめる） */
export async function verifySnapshot(s: Snapshot): Promise<boolean> {
  return typeof s.digest === "string" && (await snapshotDigest(s)) === s.digest;
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** 本文の区画 snapshots から読む（形の合わないものは捨てずに読めるものだけ。中身の確かめは verifySnapshot） */
export function readSnapshots(v: unknown): Snapshot[] {
  if (!Array.isArray(v)) return [];
  return v.filter((x): x is Snapshot => isObj(x) && typeof x.id === "string" && typeof x.createdAt === "string" && (x.trigger === "pdf" || x.trigger === "manual") && isObj(x.inputs));
}

/** 世帯ファイルの本文（JSON）に、控えの区画を足す（控えが無ければ区画を作らない） */
export function withSnapshotsSection(body: Record<string, unknown>, list: readonly Snapshot[] | undefined): Record<string, unknown> {
  return list === undefined || list.length === 0 ? body : { ...body, snapshots: list };
}

/** 本文の JSON から控えの区画を読む */
export function snapshotsOfBody(json: string): Snapshot[] {
  try {
    const b = JSON.parse(json) as unknown;
    return isObj(b) ? readSnapshots(b.snapshots) : [];
  } catch {
    return [];
  }
}

/** 世帯（現状）を置き換えるときに、今の控えを持ち越す（控えは元に戻す・やり直すの対象にしない。作った後は変えない） */
export function keepSnapshots(next: WorkingHousehold, cur: WorkingHousehold): WorkingHousehold {
  if (next.snapshots === cur.snapshots) return next;
  if (cur.snapshots === undefined || cur.snapshots.length === 0) {
    if (next.snapshots === undefined) return next;
    const { snapshots: _s, ...rest } = next;
    void _s;
    return rest;
  }
  return { ...next, snapshots: cur.snapshots };
}

/** 一覧に出す日時（例: 2027年4月12日 14:03） */
export function snapshotDateText(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(iso);
  return m === null ? iso : `${Number(m[1])}年${Number(m[2])}月${Number(m[3])}日 ${m[4]}:${m[5]}`;
}
