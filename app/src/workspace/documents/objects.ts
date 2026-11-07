// 書類から足す新しい物の種類（0148 の1・0154 の2・0159）: 物の候補の kind（「集まり:種類」）→ その物を足す入力項目のボタン。
// 足すときは入力の画面の「＋」と同じボタンを押した形で作り（その種類の既定・推定の印も同じ）、その中の欄に値の候補を当てる。
// 同じ種類の物がもうあれば、新しく足さずに「今ある物に当てる」も選べる（sameKind で今ある物を探す。0154 の3）。
// - 保険の契約（保険証券・ご契約内容のお知らせ・設計書）: insurance:<保険の種類の細目>
// 住宅ローン・iDeCo・小規模企業共済は、取り込みを外した書類（控除証明書など）の物なので足せない（0159。前の記録の物は RETIRED_OBJECT_KINDS で残す）
import { addKey } from "../input/stages/insurance.ts";
import { KINDS } from "../input/insuranceKinds.ts";
import type { StageId } from "../input/form.ts";

type Obj = Record<string, unknown>;

export interface NewObjectKind {
  /** 画面の見出し（例: 新しい保険契約（医療保険）） */
  label: string;
  /** 今ある物の呼び名（「今の住宅ローンに当てる」の「住宅ローン」） */
  noun: string;
  /** 物の集まり（世帯の household の欄） */
  collection: string;
  /** ボタンのある入力項目（段階） */
  stage: StageId;
  /** 足すボタンのキー（入力の画面の ActionDef.key） */
  action: string;
  /** 今ある物のうち、同じ種類の物（今ある物に当てる候補） */
  sameKind: (x: Obj) => boolean;
  /** 今ある物の持ち主の構成員の ID（書類の名義の人の物を先に並べる） */
  ownerOf: (x: Obj) => readonly string[];
}

const str = (v: unknown): string | null => (typeof v === "string" && v !== "" ? v : null);

const insuranceKinds = KINDS.map((k): [string, NewObjectKind] => [
  `insurance:${k.kind}`,
  {
    label: `新しい保険契約（${k.label}）`,
    noun: "保険契約",
    collection: "insuranceContracts",
    stage: "insurance" as StageId,
    action: addKey(k.kind),
    sameKind: (x) => x.subtype === k.kind || (x.subtype === undefined && typeof x.template === "string" && x.template.endsWith(`.${k.kind}`)),
    ownerOf: (x) => [str(x.insured), str(x.policyholder)].filter((m): m is string => m !== null),
  },
]);

export const NEW_OBJECT_KINDS: Readonly<Record<string, NewObjectKind>> = Object.fromEntries(insuranceKinds);

/**
 * 取り込みを外した書類（0159）で足せた物の種類。前の記録の物の候補を捨てずに残すためだけに持つ（読み口は受けない・足せない）。
 * 前の記録は確かめの画面で見るだけ
 */
export const RETIRED_OBJECT_KINDS: Readonly<Record<string, string>> = {
  "debt:mortgage": "住宅ローン",
  "account:ideco": "iDeCo",
  "account:smallBusinessMutualAid": "小規模企業共済",
};
