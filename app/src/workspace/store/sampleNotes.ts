// 世帯を見本にするとき（見本の棚へ移す。0033）に、メモと面談の履歴とお客さまから受け取った物の記録を外してから世帯ファイルに書く
// （0182 の追記・0247 の6）。画面（App.tsx）の開く・書く・保存するを受け取って順に呼ぶだけの部品（テストで確かめられるように切り出した）
import type { WorkingHousehold } from "../input/household.ts";
import { hasDocuments } from "../documents/log.ts";
import { hasNotes, withoutNotes } from "../meetings/meetings.ts";

/** お客さまから受け取った物の記録（Web のヒアリングの依頼〔受け取った答えと書類を含む〕・明細の取り込み・書類の読み取り）があるか（0247 の6） */
export function hasClientRecords(wh: Pick<WorkingHousehold, "hearing" | "statements" | "documents">): boolean {
  return (wh.hearing?.web?.length ?? 0) > 0 || wh.statements !== undefined || hasDocuments(wh.documents);
}

/**
 * 見本にするとき・見本を複製するときに外す物があるか（0182 の追記・0247 の6）: メモと面談の履歴と、お客さまから受け取った物の記録
 */
export function hasSampleRecords(wh: Pick<WorkingHousehold, "memo" | "meetings" | "hearing" | "statements" | "documents">): boolean {
  return hasNotes(wh) || hasClientRecords(wh);
}

/**
 * 見本にするとき・見本を複製するときに外す（0182 の追記・0247 の6。利用者の判断）: メモ（行ごとの書いた人を含む）・面談の履歴と、
 * お客さまから受け取った物の記録（Web のヒアリングの依頼の記録 hearing.web・明細の取り込みの記録 statements・書類の読み取りの記録 documents）。
 * ヒアリングシートの依頼・取り込み・同意の下書きの記録（hearing のほかの欄）と、ほかの中身はそのまま。外した後の本文が見本の最初の状態になる
 */
export function withoutSampleRecords(wh: WorkingHousehold): WorkingHousehold {
  const { statements: _s, documents: _d, ...rest } = withoutNotes(wh);
  void _s;
  void _d;
  if (rest.hearing?.web === undefined) return rest;
  const { web: _w, ...hearing } = rest.hearing;
  void _w;
  return { ...rest, hearing };
}

export interface SampleNotesDeps {
  /** その世帯をいま開いているか */
  isOpen: () => boolean;
  /** その世帯を開く（開けなければ false か例外） */
  open: () => Promise<boolean>;
  /** いま開いている世帯 */
  current: () => WorkingHousehold | null;
  /** 書けるか（読むだけ・ほかのメンバーが開いていて自動保存を止めているときは書けない） */
  writable: () => boolean;
  /** 画面の中身を入れ替える */
  put: (wh: WorkingHousehold) => void;
  /** すぐ保存する（書けたら true） */
  save: () => Promise<boolean>;
  /** 例外の文（世帯の一覧の文） */
  message: (e: unknown) => string;
}

/** 外す物が無い・外して書けたら null。書けなかったら、見本にしない理由の文 */
export async function stripNotesBeforeSample(d: SampleNotesDeps): Promise<string | null> {
  try {
    if (!d.isOpen() && !(await d.open())) return "世帯を開けなかったので、見本にしていません";
  } catch (e) {
    return d.message(e);
  }
  const wh = d.current();
  if (wh === null || !d.isOpen()) return "世帯を開けなかったので、見本にしていません";
  if (!hasSampleRecords(wh)) return null;
  if (!d.writable()) return "ほかの人が開いているため、メモと面談の履歴・お客さまから受け取った物の記録を外せません。見本にしていません";
  d.put(withoutSampleRecords(wh));
  return (await d.save()) ? null : "メモと面談の履歴・お客さまから受け取った物の記録を外して保存できなかったので、見本にしていません";
}

/**
 * 今の画面の中身を新しい世帯として保存するとき（persistCurrent）に、何を外すか（0182 の追記・0247 の5・6）:
 * - 見本として作る（見本の複製）とき: メモと面談の履歴と、お客さまから受け取った物の記録（見本にした後に読み取った架空の書類も）を外す（"records"）
 * - セットの見本（アプリに入っている見本と、それを直した版）から顧客を作るとき: メモと面談の履歴を外す（"notes"。見本のメモは例の文で、
 *   お客さまの記録ではない。直した版でも同じ）
 * - 自分で作った見本から顧客を作るとき・空の世帯: 外さない（見本にするときに外してある・何も無い）
 * setSample は、開いているのがセットの見本か（保存していないアプリの中の見本、または出どころのある見本）。外す物が無ければ null
 */
export function dropNotesOnPersist(o: { toSample: boolean; setSample: boolean }, wh: Pick<WorkingHousehold, "memo" | "meetings" | "hearing" | "statements" | "documents">): "records" | "notes" | null {
  if (o.toSample) return hasSampleRecords(wh) ? "records" : null;
  return o.setSample && hasNotes(wh) ? "notes" : null;
}

/** dropNotesOnPersist の答えのとおりに外した中身 */
export function strippedForPersist(how: "records" | "notes" | null, wh: WorkingHousehold): WorkingHousehold {
  return how === "records" ? withoutSampleRecords(wh) : how === "notes" ? withoutNotes(wh) : wh;
}
