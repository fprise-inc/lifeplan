// 世帯をまとめて AI に渡す（0248）の画面の側の決まり: 渡せない理由の言葉・選び方の既定・上限の確かめ。
// 渡せるかの判定は本体（ai_share::ai_use。1件ずつと同じ関数。0226）で、画面は本体が返した確かめ（AiBulkOutcome）を見せるだけ
import type { AiBulkBlock, AiBulkOutcome, AiShareStatus } from "../../engine/host.ts";

/** 1回にまとめて渡せる世帯の数の上限（共有中の世帯と合わせて。本体の MAX_BULK_SHARES と同じ。本体の確かめが正） */
export const BULK_LIMIT = 50;

/** 渡せない理由（理由ごとに件数と顧客番号を並べる見出し） */
export const BULK_BLOCK_TEXT: Record<AiBulkBlock, string> = {
  refused: "お客さまが「同意しない」と答えた世帯",
  withdrawn: "お客さまが同意を撤回した世帯",
  noBasis: "同意が記録されていない世帯（事務所のプライバシーポリシーも確かめていません）",
  sample: "見本の世帯",
  notSaved: "保存していない世帯",
  readOnly: "閲覧だけで開く世帯（AIに渡した記録を残せません）",
  openByOthers: "ほかの人（ほかのPC）が開いている世帯（AIに渡した記録を書くと、相手の保存が分岐になるため。閉じてから渡してください）",
  unreadable: "開けなかった世帯",
  notWritten: "AIに渡した記録を書けなかった世帯（閲覧だけで開く世帯か、保存できない状態。渡していません）",
  closed: "渡した直後に閉じた世帯（ほかの PC で同意や中身が変わっていたなど。開いて確かめてください）",
  unknown: "見つからない世帯（削除したか、ほかの PC で移した可能性があります）",
};

/** 本体の失敗の符号のうち、まとめて渡すときだけのもの */
export const BULK_MESSAGES: Record<string, string> = {
  E_AI_BULK_LIMIT: `まとめて渡せるのは、共有中の世帯と合わせて${BULK_LIMIT}件までです。選ぶ世帯を減らすか、共有中の世帯を取り消してください`,
  E_AI_BULK_EMPTY: "渡す世帯を選んでください",
};

/** 1件の出し方: 顧客番号。番号の無い見本は「見本「名前」」（0247） */
export const householdText = (h: { customerNo: string; name?: string }): string => (h.customerNo !== "" ? h.customerNo : h.name !== undefined ? `見本「${h.name}」` : "（番号なし）");

/** 顧客番号を「、」でつなぐ（多いときは先頭だけと件数） */
export function numbersText(list: readonly { customerNo: string; name?: string }[], max = 20): string {
  const head = list.slice(0, max).map(householdText);
  return list.length > max ? `${head.join("、")} ほか${list.length - max}件` : head.join("、");
}

/** 渡せない世帯の数（理由をまたいだ合計） */
export const blockedCount = (o: AiBulkOutcome): number => o.blocked.reduce((n, g) => n + g.households.length, 0);

/** 初めに選んでおく世帯: 一覧の世帯が上限までならすべて、超えれば選ばない（FP が選ぶ） */
export function defaultSelection(ids: readonly string[]): string[] {
  return ids.length <= BULK_LIMIT ? [...ids] : [];
}

/**
 * 上限を超えるか（選んだ数そのものが上限を超える・確かめで渡せる世帯と共有中の世帯を合わせると超える）。
 * 超えるときはその文、超えなければ null
 */
export function overLimit(selected: number, check: AiBulkOutcome | null): string | null {
  if (selected > BULK_LIMIT) return `1回に選べるのは${BULK_LIMIT}件までです（いま${selected}件）。区分や番号で絞り込むか、選ぶ世帯を減らしてください。`;
  if (check !== null && check.active + check.ready.length > check.limit)
    return `共有中の世帯（${check.active}件）と合わせると${check.limit}件を超えます。選ぶ世帯を減らすか、共有中の世帯を取り消してください。`;
  return null;
}

/** 一覧の世帯のうち共有中の世帯（まとめて取り消す対象） */
export function sharedAmong(shares: readonly AiShareStatus[], ids: readonly string[]): string[] {
  const set = new Set(ids);
  return [...new Set(shares.filter((s) => set.has(s.householdId)).map((s) => s.householdId))];
}
