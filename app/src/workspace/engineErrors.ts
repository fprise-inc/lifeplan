// 計算が止まったときの画面の文。エンジンのエラーは符号と ID だけ（0005 の8）なので、画面で FP に分かる言葉にする。
// 制度データに値が無い（E_PARAM_NO_VALUE）ときは、どの値のどの時期が無いかと、避け方を出す（0003 の追記（2026-10-27））
import { PARAM_LABELS } from "../generated/labels.ts";

const DATE = /^(\d{4})-(\d{2})-\d{2}$/;

/**
 * 入力ではなく、その時のパソコンの重さで起きるエラー（時間切れ）。画面は「今の入力では」と書かず、「もう一度計算する」を出す。
 * 本体はもう2回まで自動でもう一度頼んでいる（engine/retry.ts。0180 の2）
 */
export const isHostBusy = (code: string | null | undefined): boolean => code === "E_HOST_TIMEOUT";

/** 時間切れのときの文（「計算できませんでした」を前に付けずに、この文だけを出す） */
export const HOST_BUSY_TEXT = "計算に時間がかかりすぎて、途中で止まりました。入力のせいではなく、パソコンの負荷が高いときに起きます。ほかのアプリを閉じるか、少し待ってから、もう一度計算してください（E_HOST_TIMEOUT）";

/** 「計算できませんでした」の後に続ける文。知らない符号は今までどおり（符号）だけ */
export function engineErrorText(code: string, ids: readonly string[], baseMonth: string | null): string {
  if (code === "E_HOST_TIMEOUT") return `。${HOST_BUSY_TEXT}`;
  // メモリーの上限: 入力で決まる（物がとても多い・表がとても長い）ので、もう一度頼んでも同じ
  if (code === "E_HOST_MEMORY") return "。計算に使えるメモリーの上限を超えました。表の最後の年が遠いか、物（口座・不動産・期間など）がとても多いと起きます（E_HOST_MEMORY）";
  // 金額が安全に扱える整数を超えた・率で割れない（-100% の率など）: 率の欄の範囲の外の値か、長すぎる表の期間で起きる（0098）
  if (code === "E_UNSAFE_INTEGER") return "。金額が大きくなりすぎて計算できません。運用の利回り・上昇率が高いか、表の最後の年が遠いと起きます。入力の確かめの一覧に出る範囲の外の率と、表の最後の年を見直してください（E_UNSAFE_INTEGER）";
  if (code === "E_ARGUMENT" && ids[0] === "rateDiv.zero") return "。計算に使えない率（-100% の上昇率など）が入っています。入力の確かめの一覧に出る範囲の外の率を見直してください（E_ARGUMENT）";
  const id = ids[0];
  if (code !== "E_PARAM_NO_VALUE" || id === undefined) return `（${code}）`;
  const label = PARAM_LABELS[id] ?? id;
  const m = DATE.exec(ids[1] ?? "");
  const when = m === null ? "" : `${Number(m[1])}年${Number(m[2])}月の時点の`;
  const what = `制度データに「${label}」の${when}値がありません`;
  // 計算基準月より前の時期: 前の年の所得から今年度の住民税を計算し直すときに要る（今年度の住民税の決定額があれば計算し直さない）
  const past = m !== null && baseMonth !== null && `${m[1]}-${m[2]}` < baseMonth;
  const hint = past
    ? "計算基準月より前の時期の値で、前の年の所得から今年度の住民税を計算し直すときなどに使います。「働き方と収入」の項目で、住民税（今年度の年税額）が空の人に入れると計算できます"
    : "制度データが持っている時期の外です。計算基準月や、入力した時点を見直してください";
  return `。${what}。${hint}（E_PARAM_NO_VALUE）`;
}
