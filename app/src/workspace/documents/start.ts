// 「この書類を読む」の入口（0154 の3・0159）: 書類のお願いの1通・入力の欄の「書類待ち」・保険の入力項目の見出しから、その書類の読み取りへ進む。
// - 読めるのは保険証券・ご契約内容のお知らせ・設計書だけ（0159）。ほかの書類のお願い・書類待ちには入口を出さない（書類を見て欄に打つ）
// - 入口は、書類の名義の人・書類の物（保険の契約）の初めの値を持つ
// - 読んだ記録には、名義の人が決まっていなければ初めの値を入れ、物を書かない候補（今ある物の欄の候補）には書類の物を当てる。新しい物の候補は黙ってまとめない
//   （確かめの画面で「今の○○に当てる」を選ぶ）。どれも確かめの画面で変えられる。世帯は変えない
import type { DocRequest } from "../input/docRequests.ts";
import { CHECK_DOCUMENTS } from "../input/checkDocuments.ts";
import type { WorkingHousehold } from "../input/household.ts";
import type { DocType, DocumentReading } from "./types.ts";

export interface DocStart {
  /** 見出し（書類の名前と持ち主。例: 保険証券（ご本人）） */
  title: string;
  /** 書類の種類（読み方の手引きを選ぶ） */
  docType: DocType;
  /** 書類の名義の人の初めの値（構成員の ID） */
  holder: string | null;
  /** 書類の物の初めの値（保険の契約の ID） */
  object: string | null;
}

/** 書類のお願いの書類の名前のうち、読み取りの入口を出す書類（保険証券だけ。0159） */
export const readableDoc = (doc: string): boolean => doc === CHECK_DOCUMENTS.surgery;

/** 書類のお願いの1通から、読み取りの入口を作る（その1通の持ち主を名義の人の初めの値にする）。読めない書類なら null */
export function docStartOf(req: Pick<DocRequest, "doc" | "title" | "holder" | "object">): DocStart | null {
  if (!readableDoc(req.doc)) return null;
  return { title: req.title, docType: "insurancePolicy", holder: req.holder, object: req.object };
}

/** 入力項目の見出しの「書類から読む」（保険だけ）の入口 */
export const STAGE_STARTS: Readonly<Record<string, { line: string; start: DocStart }>> = {
  insurance: {
    line: "保険証券・ご契約内容のお知らせ・設計書は、AI に読ませた答えを貼り付けて取り込めます",
    start: { title: "保険の書類", docType: "insurancePolicy", holder: null, object: null },
  },
};

/** 書類の物の集まり → その物の欄の入力項目の頭（保険の契約は insurance.） */
const OBJECT_ITEMS: Readonly<Record<string, string>> = { insuranceContracts: "insurance." };

/**
 * 入口の初めの値を、読んだ記録に入れる（名義の人が決まっていなければ入口の名義の人。人も物も書かない候補で、書類の物と同じ集まりの入力項目の候補には
 * 書類の物）。世帯は変えない
 */
export function withStart(wh: WorkingHousehold, r: DocumentReading, s: Pick<DocStart, "holder" | "object"> | null): DocumentReading {
  if (s === null) return r;
  let out = r;
  const members = new Set(wh.request.input.household.members.map((m) => m.id));
  if (out.holder === undefined && s.holder !== null && members.has(s.holder)) out = { ...out, holder: s.holder };
  const obj = s.object;
  if (obj !== null) {
    const h = wh.request.input.household as unknown as Record<string, unknown>;
    const coll = Object.keys(OBJECT_ITEMS).find((k) => Array.isArray(h[k]) && (h[k] as { id?: unknown }[]).some((x) => x.id === obj));
    const head = coll === undefined ? undefined : OBJECT_ITEMS[coll];
    if (head !== undefined)
      out = { ...out, candidates: out.candidates.map((c) => (c.status === "pending" && c.target.object === undefined && c.target.newObject === undefined && c.target.member === undefined && c.target.item.startsWith(head) ? { ...c, target: { ...c.target, object: obj } } : c)) };
  }
  return out;
}
