// 書類から足す新しい物の種類（0148 の1）: 物の候補の kind（「集まり:種類」）→ その物を足す入力項目のボタン。
// 足すときは入力の画面の「＋」と同じボタンを押した形で作り（その種類の既定・推定の印も同じ）、その中の欄に値の候補を当てる。
// 今は保険の契約だけ（控除証明書・保険証券の読み取りが使う）。ローン・口座などは、その読み手を作る回に足す（足すだけ）
import { addKey } from "../input/stages/insurance.ts";
import { KINDS } from "../input/insuranceKinds.ts";
import type { StageId } from "../input/form.ts";

export interface NewObjectKind {
  /** 画面の見出し（例: 新しい保険契約（医療保険）） */
  label: string;
  /** 物の集まり（世帯の household の欄） */
  collection: string;
  /** ボタンのある入力項目（段階） */
  stage: StageId;
  /** 足すボタンのキー（入力の画面の ActionDef.key） */
  action: string;
}

export const NEW_OBJECT_KINDS: Readonly<Record<string, NewObjectKind>> = Object.fromEntries(
  KINDS.map((k) => [`insurance:${k.kind}`, { label: `新しい保険契約（${k.label}）`, collection: "insuranceContracts", stage: "insurance" as StageId, action: addKey(k.kind) }]),
);
