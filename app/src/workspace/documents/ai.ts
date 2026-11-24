// AI から届いた書類の候補を、読み取りの記録にする（0151）。
// - AI接続口の道具（propose_inputs）の答えは、本体がメモリの中に置いているだけ（世帯ファイルには書かない）。ここで読み口 readProposal
//   （番号を落とす決まり・登録簿にある入力項目だけ）を通して読み取りの記録にしてから、本体の承認待ちから外す
// - 世帯の値は変えない（承認は書類の読み取りの確認画面）
// - AI の答えを貼り付ける入口は、利用者の判断（2026-11-20）でなくした（0151 の追記）。前に貼り付けで読んだ記録（via: "paste"）は、そのまま読める
import type { AiDocumentProposal } from "../../engine/host.ts";
import type { WorkingHousehold } from "../input/household.ts";
import { roles } from "../roles.ts";
import { withReading } from "./log.ts";
import { readProposal } from "./proposal.ts";
import type { DocumentLog, DocumentReading } from "./types.ts";

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
