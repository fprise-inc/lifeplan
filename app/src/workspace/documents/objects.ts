// 書類から足す新しい物の種類（0148 の1・0154 の2）: 物の候補の kind（「集まり:種類」）→ その物を足す入力項目のボタン。
// 足すときは入力の画面の「＋」と同じボタンを押した形で作り（その種類の既定・推定の印も同じ）、その中の欄に値の候補を当てる。
// 同じ種類の物がもうあれば、新しく足さずに「今ある物に当てる」も選べる（sameKind で今ある物を探す。0154 の3）。
// - 保険の契約（控除証明書・保険証券）: insurance:<保険の種類の細目>
// - 住宅ローン（年末残高等証明書・住宅借入金等特別控除証明書）: debt:mortgage（住まいの住宅ローンの「＋ 住宅ローン」）
// - iDeCo・小規模企業共済の口座（小規模企業共済等掛金控除証明書）: account:ideco・account:smallBusinessMutualAid（貯蓄・運用の「＋ iDeCo」「＋ 小規模企業共済」。
//   小規模企業共済のボタンは、足せる人〔事業所得・役員〕がいる世帯にだけある）
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
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);

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

const accountKinds = (["ideco", "smallBusinessMutualAid"] as const).map((kind): [string, NewObjectKind] => [
  `account:${kind}`,
  {
    label: kind === "ideco" ? "新しい iDeCo" : "新しい小規模企業共済",
    noun: kind === "ideco" ? "iDeCo" : "小規模企業共済",
    collection: "accounts",
    stage: "savings" as StageId,
    action: `sav/add/${kind}`,
    sameKind: (x) => x.kind === kind,
    ownerOf: (x) => [str(x.owner)].filter((m): m is string => m !== null),
  },
]);

const mortgage: NewObjectKind = {
  label: "新しい住宅ローン",
  noun: "住宅ローン",
  collection: "debts",
  stage: "housing" as StageId,
  action: "housing/addMortgage",
  // 住まいの住宅ローン（不動産の欄のローンは除く）
  sameKind: (x) => x.kind === "mortgage" && x.property === undefined,
  ownerOf: (x) => (Array.isArray(x.debtors) ? x.debtors.flatMap((d) => (isObj(d) && typeof d.member === "string" ? [d.member] : [])) : []),
};

export const NEW_OBJECT_KINDS: Readonly<Record<string, NewObjectKind>> = Object.fromEntries([...insuranceKinds, ["debt:mortgage", mortgage], ...accountKinds]);
