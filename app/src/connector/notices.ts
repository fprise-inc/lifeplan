// AI接続口（crates/lifeplan）に同梱する「計算のお知らせ」（0210）。エンジンの知らせ（コードと ID だけ。0005 の8）を、画面の結果のタブの
// 「計算のお知らせ」と同じ関数（workspace/engineNotices.ts の noticeRows）で、画面と同じ文・種類・対象（人・物の呼び名）・年・内訳・入る入力項目の行にする。
// - 文の表は画面の1つだけ（engineNotices.ts の MESSAGES）。接続口の側に文を写さない
// - 種類は画面の閉じた1行の内訳と同じ短い名前（「入力が足りない」「計算に入れていない」「前提の外」「仮の値・推定」「データの確認待ち」）、
//   入力項目は入力のホームの名前（「年金」「住まい・ローン」など。画面の「入力で開く」の先）
// - 事務所の文（カスタム層の説明の文の差し替え）は当てない（公式の文）。事務所の設定で隠す知らせも隠さない
// - 物の呼び名は世帯の要求から作る（保険・口座の名前の欄が文字ならその名前。渡された世帯の縮約版では、名前は渡っていない）。物の ID は返さない
// - 画面の部品（preact）・本体の命令・保存の部品は読まない（lint とまとめる道具が止める）
import type { EngineRequest, PreviewResult } from "../engine/types.ts";
import { NOTICE_KINDS, noticeRows, type NoticeKind, type NoticeRow } from "../workspace/engineNotices.ts";
import { fromRequest } from "../workspace/input/household.ts";
import { STAGE_ORDER } from "../workspace/input/stageOrder.ts";

/** 種類の短い名前（画面の閉じた1行の内訳の言葉） */
export const KIND_SHORT: Readonly<Record<NoticeKind, string>> = Object.fromEntries(NOTICE_KINDS.map((k) => [k.id, k.short])) as Record<NoticeKind, string>;

/** 入力項目の名前（入力のホームの入力項目の名前） */
const ITEM_LABELS: ReadonlyMap<string, string> = new Map(STAGE_ORDER.map((s) => [s.id, s.label]));

/** 接続口に返す知らせの1行。brief では文 text の代わりに鍵 key を返し、内訳 parts（制度の値の名前など）も省く */
export interface ConnectorNotice {
  kind: string;
  text?: string;
  key?: string;
  subjects?: string[];
  years?: string;
  parts?: string[];
  item?: string;
}

/** 画面の知らせの行を、接続口に返す形にする（空の添え書きは省く） */
export function connectorNotice(r: NoticeRow, brief: boolean): ConnectorNotice {
  const item = r.card !== null ? ITEM_LABELS.get(r.card) : undefined;
  return {
    kind: KIND_SHORT[r.kind],
    ...(brief ? { key: r.key } : { text: r.text }),
    ...(r.subjects.length > 0 ? { subjects: r.subjects } : {}),
    ...(r.years !== null ? { years: r.years } : {}),
    ...(!brief && r.parts.length > 0 ? { parts: r.parts } : {}),
    ...(item !== undefined ? { item } : {}),
  };
}

/** 画面の知らせの行（1つの計算の結果。並びは画面と同じ種類の順） */
export function screenNoticeRows(req: EngineRequest, result: PreviewResult): NoticeRow[] {
  return noticeRows(fromRequest(req), [{ label: "", result, request: req }]);
}

/**
 * 計算の答えの知らせを、画面の結果のタブの「計算のお知らせ」と同じ行にする。req は計算の前の処理を当てる前の要求（物の呼び名を引く）、
 * result は表示の形の計算の出力。brief なら文と内訳を省いて鍵だけ
 */
export function noticesOf(req: EngineRequest, result: PreviewResult, brief = false): ConnectorNotice[] {
  return screenNoticeRows(req, result).map((r) => connectorNotice(r, brief));
}
