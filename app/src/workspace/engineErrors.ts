// 計算が止まったときの画面の文。エンジンのエラーは符号と ID だけ（0005 の8）なので、画面で FP に分かる言葉にする。
// 制度データに値が無い（E_PARAM_NO_VALUE）ときは、どの値のどの時期が無いかと、避け方を出す（0003 の追記（2026-10-27））
import { PARAM_LABELS } from "../generated/labels.ts";

const DATE = /^(\d{4})-(\d{2})-\d{2}$/;

/** 「計算できませんでした」の後に続ける文。知らない符号は今までどおり（符号）だけ */
export function engineErrorText(code: string, ids: readonly string[], baseMonth: string | null): string {
  const id = ids[0];
  if (code !== "E_PARAM_NO_VALUE" || id === undefined) return `（${code}）`;
  const label = PARAM_LABELS[id] ?? id;
  const m = DATE.exec(ids[1] ?? "");
  const when = m === null ? "" : `${Number(m[1])}年${Number(m[2])}月の時点の`;
  const what = `制度データに「${label}」の${when}値がありません`;
  // 計算基準月より前の時期: 前の年の所得から今年度の住民税を計算し直すときに要る（今年度の住民税の決定額があれば計算し直さない）
  const past = m !== null && baseMonth !== null && `${m[1]}-${m[2]}` < baseMonth;
  const hint = past
    ? "計算基準月より前の時期の値で、前の年の所得から今年度の住民税を計算し直すときなどに使います。「働き方と収入」のカードで、住民税（今年度の年税額）が空の人に入れると計算できます"
    : "制度データが持っている時期の外です。計算基準月や、入力した時点を見直してください";
  return `。${what}。${hint}（E_PARAM_NO_VALUE）`;
}
