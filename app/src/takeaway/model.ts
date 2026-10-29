// 持ち帰り用のレポート（0030）に入れてよい値（TakeawayPayload）。
// 作業の層（src/workspace/takeaway/build.ts）が、許可した項目だけを選んで作る別の型。提示層の PresentationModel と同じ考え方（0016 の2）。
// 次を含まない: FPのメモ、他の顧客の情報、カスタム計算の印、控え、AIの記録、事務所の設定（料金表の写しなど）、鍵、ファイルのパス、
// 氏名・顧客番号・世帯の内部ID などの識別子。計算の要求（EngineRequest）は sanitize.ts で自由記述と識別子を外し、物の ID を付け替えたもの。
// 宛名と事務所名は、書き出すときに FP が入れたものだけ（保存しない）。
import type { EngineRequest } from "../engine/types.ts";
import type { MoneyThreeSettings } from "../presentation/model.ts";

/** ファイルの形式の名前と版（中身の形を変えたら版を上げる） */
export const TAKEAWAY_FORMAT = "financia.takeaway";
export const TAKEAWAY_VERSION = 1;

/** 顧客が動かせるつまみ（結果の画面の対策の固定の項目と同じ） */
export type TakeawayLeverKey = "retireAge" | "pensionAge" | "nisaMonthly" | "livingMonthly";
export const TAKEAWAY_LEVER_KEYS: readonly TakeawayLeverKey[] = ["retireAge", "pensionAge", "nisaMonthly", "livingMonthly"];

export interface TakeawayLever {
  key: TakeawayLeverKey;
  /** 例: 「ご本人が働く最後の年齢」 */
  label: string;
  /** 年齢（1歳ずつ）か金額（1万円ずつ） */
  kind: "age" | "amount";
  min: number;
  max: number;
  step: number;
  /** 目盛りの数字を出す値 */
  ticks: number[];
  /** 金額の月額・年額の別 */
  per: "月" | "年" | "";
  /** スライダーの下の補足（例: 「60歳から再雇用（年収300万円）」） */
  note: string | null;
}

/** 定年の後に働き続けるときの働き方（働く最後の年齢を延ばすときに使う。workspace/levers.ts の Reemployment と同じ形） */
export interface TakeawayReemployment {
  fromAge: number;
  type: string;
  annualSalary: number;
  standardMonthlyRemuneration?: number;
}

export interface TakeawayPlan {
  /** 帯の文字（A は現状） */
  letter: string;
  /** 例: 「現状」「借入を500万円減らす」 */
  name: string;
  /** 計算の要求（自由記述と識別子を外し、物の ID を付け替えたもの） */
  request: EngineRequest;
}

export interface TakeawayPayload {
  format: typeof TAKEAWAY_FORMAT;
  version: typeof TAKEAWAY_VERSION;
  /** 作成日（YYYY-MM-DD） */
  createdOn: string;
  /** 事務所名（任意。個人の氏名は入れない） */
  office: string | null;
  /** 宛名（任意。書き出すときだけ入れて、保存しない） */
  addressee: string | null;
  /** 制度データの版（提案書の刻印と同じ書式） */
  dataSet: string;
  /** 必須の記載（提案書と同じ文） */
  notices: string[];
  /** 「○歳時点」の年齢（表示の設定） */
  targetAge: number;
  /** 載せるプラン。先頭は現状（A） */
  plans: TakeawayPlan[];
  /** FP の提案のプラン（帯の文字） */
  proposal: string;
  /** 基準のプラン（帯の文字。グラフの点線） */
  base: string;
  levers: {
    /** つまみが効く構成員（付け替えた ID） */
    self: string;
    reemployment: TakeawayReemployment | null;
    items: TakeawayLever[];
    /** FP顧問料の入れる・入れないを顧客が切り替えられるとき（契約の要約） */
    fee: { note: string } | null;
  };
  /** 載せる画面（結果のグラフはいつも載せる）。moneyThree（お金の3つの分け方。0032）は後から足した任意の欄（無ければ載せない） */
  views: { balance: boolean; table: boolean; moneyThree?: boolean };
  /**
   * お金の3つの分け方の何か月分・何年先まで・呼び方（FP が資産と負債のタブで決めた値。顧客は変えられない。0032）。
   * 後から足した任意の欄（画面の部品は同じファイルに入るので、版は 1 のまま）
   */
  moneyThree?: MoneyThreeSettings;
}

/** ファイルの中のデータ（パスワードを付けたときは、これを丸ごと暗号化する） */
export interface TakeawayData {
  payload: TakeawayPayload;
  /** その世帯の計算に必要な制度データ（パックの値をその世帯で使うものだけに絞ったもの） */
  packs: unknown[];
}

/** 顧客向けの注意書き（ファイルの画面に出す） */
export const TAKEAWAY_NOTES: readonly string[] = [
  "つまみを動かした結果も試算です。家計の見直しを決める前に、担当のFPにご相談ください。",
  "このファイルの中だけで計算します。入力した値や結果を、どこにも送りません。",
];
