// 「この書類を読む」の入口（0154 の3・0159）: 書類のお願いの1通・入力の欄の「書類待ち」・保険の入力項目の見出しから、その書類の読み取りへ進む。
// - 読めるのは保険証券・ご契約内容のお知らせ・設計書だけ（0159）。ほかの書類のお願い・書類待ちには入口を出さない（書類を見て欄に打つ）
// - 読み方は AI で読み取る（保存した世帯）か、欄に打つ。AI の答えを貼り付ける道は、利用者の判断（2026-11-20）でなくした（0151 の追記）。
//   貼り付けの画面に渡していた書類の名義の人・書類の物の初めの値も、あわせてなくした（名義の人は確かめの画面で選ぶ）
import type { DocRequest } from "../input/docRequests.ts";
import { CHECK_DOCUMENTS } from "../input/checkDocuments.ts";
import type { DocType } from "./types.ts";

export interface DocStart {
  /** 見出し（書類の名前と持ち主。例: 保険証券（ご本人）） */
  title: string;
  /** 書類の種類 */
  docType: DocType;
}

/** 書類のお願いの書類の名前のうち、読み取りの入口を出す書類（保険証券だけ。0159） */
export const readableDoc = (doc: string): boolean => doc === CHECK_DOCUMENTS.surgery;

/** 書類のお願いの1通から、読み取りの入口を作る。読めない書類なら null */
export function docStartOf(req: Pick<DocRequest, "doc" | "title">): DocStart | null {
  if (!readableDoc(req.doc)) return null;
  return { title: req.title, docType: "insurancePolicy" };
}

/** 入力項目の見出しの「書類から読む」（保険だけ）の入口 */
export const STAGE_STARTS: Readonly<Record<string, { line: string; start: DocStart }>> = {
  insurance: {
    line: "保険証券・ご契約内容のお知らせ・設計書は、AI で読み取って取り込めます",
    start: { title: "保険の書類", docType: "insurancePolicy" },
  },
};
