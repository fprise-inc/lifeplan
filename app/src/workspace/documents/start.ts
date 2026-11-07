// 「この書類を読む」の入口（0154 の3）: 書類のお願いの1通・入力の欄の「書類待ち」・入力項目（保険・年金）の見出しから、その書類の読み取りへ進む。
// - 入口は、書類の種類（読み方の手引き・電子データの読み手を選ぶ）と、書類の名義の人・書類の物（保険の契約・ローン）の初めの値を持つ
// - 読んだ記録には、名義の人が決まっていなければ初めの値を入れ、物を書かない候補（今ある物の欄の候補）には書類の物を当てる。新しい物の候補は黙ってまとめない
//   （確かめの画面で「今の○○に当てる」を選ぶ）。どれも確かめの画面で変えられる。世帯は変えない
import type { DocRequest } from "../input/docRequests.ts";
import { CHECK_DOCUMENTS } from "../input/checkDocuments.ts";
import type { WorkingHousehold } from "../input/household.ts";
import type { DocType, DocumentReading } from "./types.ts";

export interface DocStart {
  /** 見出し（書類の名前と持ち主。例: 住宅ローンの返済予定表（ご本人）） */
  title: string;
  /** 書類の種類（読み方の手引きを選ぶ） */
  docType: DocType;
  /** 同じ値をこのパソコンの中で読める電子データ（XML）の書類（無ければ読み手の入口を出さない） */
  xml: string | null;
  /** 書類の名義の人の初めの値（構成員の ID） */
  holder: string | null;
  /** 書類の物の初めの値（保険の契約・ローンの ID） */
  object: string | null;
}

/** 電子データ（XML）で読める書類の名前（入口の説明に出す） */
export const XML_DOCS = {
  insurance: "生命保険料・地震保険料の控除証明書",
  loan: "住宅ローンの年末残高等証明書・住宅借入金等特別控除証明書",
  pension: "国民年金保険料等の控除証明書",
  account: "小規模企業共済等掛金（iDeCo）の控除証明書",
  pensionSlip: "公的年金等の源泉徴収票",
} as const;

/** 書類のお願いの書類の名前 → 書類の種類と、電子データで読める書類 */
function kindOfDoc(doc: string): { docType: DocType; xml: string | null } {
  if (doc === CHECK_DOCUMENTS.pension) return { docType: "pensionStatement", xml: null };
  if (doc === CHECK_DOCUMENTS.residentTax) return { docType: "residentTaxNotice", xml: null };
  if (doc === CHECK_DOCUMENTS.surgery) return { docType: "insurancePolicy", xml: null };
  if (doc.endsWith(CHECK_DOCUMENTS.loan)) return { docType: "loanSchedule", xml: doc.startsWith("住宅ローン") ? XML_DOCS.loan : null };
  return { docType: "other", xml: null };
}

/** 書類のお願いの1通から、読み取りの入口を作る（その1通の持ち主を名義の人の初めの値にする） */
export function docStartOf(req: Pick<DocRequest, "doc" | "title" | "holder" | "object">): DocStart {
  return { title: req.title, ...kindOfDoc(req.doc), holder: req.holder, object: req.object };
}

/** 入力項目の見出しの「書類から読む」（保険・年金）の入口 */
export const STAGE_STARTS: Readonly<Record<string, { line: string; start: DocStart }>> = {
  insurance: {
    line: `保険証券・ご契約内容のお知らせは AI の答えを貼り付けて、${XML_DOCS.insurance}は電子データ（XML）をこのパソコンの中で読めます`,
    start: { title: "保険の書類", docType: "insurancePolicy", xml: XML_DOCS.insurance, holder: null, object: null },
  },
  pension: {
    line: `ねんきん定期便・年金額改定通知書は AI の答えを貼り付けて、${XML_DOCS.pensionSlip}・${XML_DOCS.pension}・${XML_DOCS.account}は電子データ（XML）をこのパソコンの中で読めます`,
    start: { title: "年金の書類", docType: "pensionStatement", xml: `${XML_DOCS.pensionSlip}・${XML_DOCS.pension}・${XML_DOCS.account}`, holder: null, object: null },
  },
};

/** 書類の物の集まり → その物の欄の入力項目の頭（保険の契約は insurance.・ローンは debt.） */
const OBJECT_ITEMS: Readonly<Record<string, string>> = { insuranceContracts: "insurance.", debts: "debt." };

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
