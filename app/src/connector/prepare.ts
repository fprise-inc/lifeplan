// AI接続口（crates/lifeplan）に同梱する「計算の前の処理」（0184）。画面がエンジンへ渡す前に計算の要求に当てる処理（engine/moneyRows.ts の forEngine）を、
// 接続口の calculate・explain_value でも画面と同じ関数で当て、画面と接続口で数字をそろえる。当てるのは:
// - ふだんの計算に入れない物を外す（見込みが「不確実」の入るお金・出るお金・子への援助・相続で受け継ぐ借金と、「最初から計算に入れない」を選んだ夢）
// - 世帯に保存した表示だけの設定を外す（相続税の目安の設定・遺したい額。お金の流れに効かないので結果は変わらない）
// - 事務所の推定の値と推定で埋めない目安を足す（アプリ本体が渡した事務所データの defaults.estimates を、画面と同じ読み方で読む。
//   渡された世帯〔share_id〕のときだけ届く。見本の世帯・AIが組み立てた入力には事務所の値が無い）
// 当てない物: 結果の見方（区画「夢と予定」の物ごとの入れ外し。保存しない画面の見方で、既定は何も変えない）と、画面が比較するために足す別の枠
// （相場が下がった場合・FP顧問料の有無）。どれも保存した世帯の数字を変えない
// - 事務所の値は、画面と同じくモジュールの中に入れてから forEngine が読む（office/estimates.ts の publishOfficeEstimates）。
//   接続口は呼ぶごとに新しい実行環境を作るので、呼び出しをまたいで残らない
// - 画面の部品（preact）・本体の命令・保存の部品は読まない（lint とまとめる道具が止める）
import { dreamOff, excludedFromBase, forEngine } from "../engine/moneyRows.ts";
import type { EngineRequest } from "../engine/types.ts";
import { publishOfficeEstimates, readOfficeEstimates } from "../workspace/office/estimates.ts";

/** 当てた処理（接続口の答えの preparation。何も当てなければ空の並び。表示だけの設定を外したことは結果を変えないので数えない） */
export interface Applied {
  /** ふだんの計算に入れなかった入るお金の行の ID（見込みが不確実） */
  excludedIncomes: string[];
  /** ふだんの計算に入れなかった負債の ID（見込みが不確実な、相続で受け継ぐ借金） */
  excludedDebts: string[];
  /** ふだんの計算に入れなかった出るお金の行の ID（見込みが不確実。夢を除く） */
  excludedExpenses: string[];
  /** ふだんの計算に入れなかった子への援助の ID（見込みが不確実） */
  excludedGifts: string[];
  /** 「計算に入れない」を選んだ夢の ID */
  offDreams: string[];
  /** 足した事務所の推定の値の値ID */
  officeEstimateValues: string[];
  /** 足した推定で埋めない目安 */
  officeNoFill: string[];
}

/**
 * 計算の要求に、画面と同じ計算の前の処理を当てる。reqJson は計算の要求（trace と input）、officeJson は事務所データの defaults.estimates
 * （無ければ null）。戻り値は JSON の文字 { request, applied }
 */
export function prepare(reqJson: string, officeJson: string): string {
  const req = JSON.parse(reqJson) as EngineRequest;
  publishOfficeEstimates(readOfficeEstimates(JSON.parse(officeJson) as unknown));
  try {
    return JSON.stringify(preparedOf(req));
  } catch {
    // 形の違う入力（AI が組み立てた入力の誤りなど。画面の要求には無い）: 何も当てずに返し、エンジンの確かめに誤りの場所を答えさせる
    return JSON.stringify({ request: req, applied: NOTHING });
  }
}

const NOTHING: Applied = { excludedIncomes: [], excludedDebts: [], excludedExpenses: [], excludedGifts: [], offDreams: [], officeEstimateValues: [], officeNoFill: [] };

function preparedOf(req: EngineRequest): { request: EngineRequest; applied: Applied } {
  const out = forEngine(req);
  const h = req.input.household;
  const base = excludedFromBase(h);
  const had = req.input as unknown as Record<string, unknown>;
  const applied: Applied = {
    excludedIncomes: base.incomes,
    excludedDebts: base.debts,
    excludedExpenses: base.expenses,
    excludedGifts: base.gifts,
    offDreams: (h.periodicExpenses ?? []).filter(dreamOff).map((p) => p.id),
    officeEstimateValues: had.estimateValues === undefined && out.input.estimateValues !== undefined ? Object.keys(out.input.estimateValues).sort() : [],
    officeNoFill: had.estimateNoFill === undefined && out.input.estimateNoFill !== undefined ? [...out.input.estimateNoFill] : [],
  };
  return { request: out, applied };
}
