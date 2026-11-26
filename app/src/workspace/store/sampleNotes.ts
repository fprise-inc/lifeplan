// 世帯を見本にするとき（見本の棚へ移す。0033）に、メモと面談の履歴を外してから世帯ファイルに書く（0182 の追記）。
// 画面（App.tsx）の開く・書く・保存するを受け取って順に呼ぶだけの部品（テストで確かめられるように切り出した）
import type { WorkingHousehold } from "../input/household.ts";
import { hasNotes, withoutNotes } from "../meetings/meetings.ts";

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
  if (!hasNotes(wh)) return null;
  if (!d.writable()) return "ほかの人が開いているため、メモと面談の履歴を外せません。見本にしていません";
  d.put(withoutNotes(wh));
  return (await d.save()) ? null : "メモと面談の履歴を外して保存できなかったので、見本にしていません";
}

/**
 * 今の画面の中身を新しい世帯として保存するとき（persistCurrent）に、メモと面談の履歴を外すか（0182 の追記・0247 の5）:
 * - 見本として作る（見本の複製）とき: 外す
 * - セットの見本（アプリに入っている見本と、それを直した版）から顧客を作るとき: 外す（見本のメモは例の文で、お客さまの記録ではない。直した版でも同じ）
 * - 自分で作った見本から顧客を作るとき・空の世帯: 外さない（見本にするときに外してある・何も無い）
 * setSample は、開いているのがセットの見本か（保存していないアプリの中の見本、または出どころのある見本）。外す物が無ければ false
 */
export function dropNotesOnPersist(o: { toSample: boolean; setSample: boolean }, wh: Pick<WorkingHousehold, "memo" | "meetings">): boolean {
  if (!hasNotes(wh)) return false;
  return o.toSample || o.setSample;
}
