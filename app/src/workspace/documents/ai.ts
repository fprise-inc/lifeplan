// AI から届いた書類の候補と、貼り付けた AI の答えを、読み取りの記録にする（0151）。
// - AI接続口の道具（propose_inputs）の答えは、本体がメモリの中に置いているだけ（世帯ファイルには書かない）。ここで読み口 readProposal
//   （番号を落とす決まり・登録簿にある入力項目だけ）を通して読み取りの記録にしてから、本体の承認待ちから外す
// - 貼り付けは readProposalText。外部AIへの提供の同意（0014）がある世帯（と見本の世帯）だけで使える。
//   同意は書類を AI に渡すことを含む説明（版2〜。0157）でのものに限る（版1の説明の同意では、取り直すまで使えない）
// - どちらも世帯の値は変えない（承認は確かめの画面）
import type { AiDocumentProposal } from "../../engine/host.ts";
import type { WorkingHousehold } from "../input/household.ts";
import { roles } from "../roles.ts";
import { withReading } from "./log.ts";
import { readProposal, readProposalText, type ProposalResult } from "./proposal.ts";
import { LIMITS, type DocumentLog, type DocumentReading } from "./types.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

/** 続柄の鍵 → 構成員の ID（答えの holder を名義の人の初めの値にする） */
export const memberKeys = (wh: WorkingHousehold): { key: string; id: string }[] => roles(wh.request).map((r) => ({ key: r.key, id: r.member.id }));

export interface AiIngest {
  log: DocumentLog | undefined;
  /** 本体の承認待ちから外してよい候補の ID（記録にした・前に記録した・読めなかった） */
  taken: string[];
  /** 記録にした読み取りの ID（候補の ID と同じ） */
  added: string[];
  /** 読めなかった答え（理由だけ。値・文字は入れない） */
  failed: { id: string; issues: string[] }[];
}

/**
 * AI接続口から届いた書類の候補を、読み取りの記録にする。読み取りの記録の ID は候補の ID にする（AIに渡した記録の proposals と同じ ID で、
 * どの答えから来た記録かを後でたどれる）。同じ候補をもう記録していれば足さない（本体から外し損ねたときの読み直し）
 */
export function ingestAiProposals(wh: WorkingHousehold, proposals: readonly AiDocumentProposal[], newId: () => string = () => crypto.randomUUID()): AiIngest {
  let log = wh.documents;
  const out: AiIngest = { log, taken: [], added: [], failed: [] };
  const members = memberKeys(wh);
  for (const p of proposals) {
    if (!UUID.test(p.candidateId)) continue;
    if ((log?.readings ?? []).some((r) => r.id === p.candidateId)) {
      out.taken.push(p.candidateId);
      continue;
    }
    const res = readProposal(p.answer, { via: "ai", at: p.receivedAt, newId, members, ...(p.connector !== null ? { connector: p.connector } : {}) });
    out.taken.push(p.candidateId);
    if (res.reading === null) {
      out.failed.push({ id: p.candidateId, issues: res.issues });
      continue;
    }
    const reading: DocumentReading = { ...res.reading, id: p.candidateId };
    log = withReading(log, reading);
    out.added.push(reading.id);
  }
  out.log = log;
  return out;
}

/**
 * 貼り付けの入口を使えるか: 見本の世帯はいつでも、保存した世帯は外部AIへの提供の同意があるときだけ。
 * 同意は書類を AI に渡すことを含む説明（版2〜）でのものに限る（`consentDocuments`。0157）
 */
export type PasteGate = { ok: true; sample: boolean } | { ok: false; reason: string };

export function pasteGate(o: { sample: boolean; saved: boolean; consentState: string | null; consentDocuments: boolean }): PasteGate {
  if (o.sample) return { ok: true, sample: true };
  if (!o.saved) return { ok: false, reason: "保存していない世帯では使えません。世帯を保存し、外部AIへの提供の同意を記録してから使ってください。" };
  if (o.consentState === "given" && o.consentDocuments) return { ok: true, sample: false };
  if (o.consentState === "given")
    return { ok: false, reason: "この世帯の同意は前の版の説明でいただいたもので、書類を AI に渡すことは含まれていません。書類を AI に渡す前に、お客さまに今の説明を見せて、同意を記録し直してください（「同意と共有を開く」）。計算に要る項目を AI に渡すことは、今の同意のまま続けられます。" };
  if (o.consentState === "refused") return { ok: false, reason: "お客さまは外部AIへの提供に同意しませんでした。書類は AI に渡さず、手で入れてください。" };
  if (o.consentState === "withdrawn") return { ok: false, reason: "お客さまは外部AIへの提供の同意を撤回しました。書類は AI に渡さず、手で入れてください。" };
  return { ok: false, reason: "外部AIへの提供の同意が記録されていません。書類を AI に渡す前に、同意を記録してください（「AI に資料を渡す」の「同意と共有を開く」）。" };
}

/** 貼り付けた AI の答えを読む（読み取りの記録にする前の形。reading が null なら取り込まない） */
export function readPasted(wh: WorkingHousehold, text: string, connector: string, at: string, newId: () => string = () => crypto.randomUUID()): ProposalResult {
  const name = connector.trim();
  if (text.trim() === "") return { reading: null, issues: ["AI の答えを貼り付けてください"] };
  if (name === "" || name.length > LIMITS.connector) return { reading: null, issues: [`使った AI の名前を入れてください（${LIMITS.connector}文字まで）`] };
  return readProposalText(text, { via: "paste", at, newId, connector: name, members: memberKeys(wh) });
}
