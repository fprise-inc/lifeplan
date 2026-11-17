// 結果の画面の名前（名前の一覧 `settings/terms.json` の `result:<区画>/<名前>`。0212 の追記 2026-11-17）: 区画「夢と予定」の
// まとまりの名前・列の名前・見込み（確実・不確実）・「ほか○件を見る」を、ここに1か所で書く。
// - 名前の一覧（app/scripts/textsCatalog.ts の buildTermsCatalog）はこの表から作り、画面（BigMoneyCard.tsx）もこの表から名前を出す
// - 数は差し込みの印（{count}。「件」まで入る）。事務所の名前にも同じ値が入る
// - 事務所の名前を当てるのは、承認したときの公式の名前が今の公式の名前と同じときだけ（表の行の名前 rowName と同じ決まり）
// - 名前はただの文字。差し込む値も字のまま入れ、印として読み直さない。事務所の名前であることは画面に出さない（お客さまと一緒に見る画面）
// 載せないもの: 行の名前（お客さまが入れた物の名前か、入力の選択肢の名前）・時期と金額の文字（値の書き方）・見出しの件数（「4/7件」）
import { fillName } from "../../../report/src/rowNames.ts";
import type { OfficeNames } from "./office/customTexts.ts";

export interface ResultTermDef {
  /** 名前の一覧の id（`result:<区画>/<名前>`） */
  readonly id: string;
  /** 画面のどこの名前か */
  readonly where: string;
  /** 公式の名前（差し込みの印つき） */
  readonly official: string;
  /** 使える差し込みの印と意味 */
  readonly vars: Readonly<Record<string, string>>;
  /** 数が入る印（名前の書き換えで落とすと、本体の検査が注意を出す） */
  readonly numberVars: readonly string[];
}

const WHERE = "結果のタブの対策の下の「夢と予定」";

const DEFS = [
  { id: "result:dreamsAndPlans/groupDreams", where: `${WHERE}のまとまりの名前（夢プランの夢）`, official: "ご家族の夢", vars: {}, numberVars: [] },
  { id: "result:dreamsAndPlans/groupPay", where: `${WHERE}のまとまりの名前（子への援助・1回と年ごとの出るお金・繰上返済・家の購入の頭金など）`, official: "支払いの予定", vars: {}, numberVars: [] },
  { id: "result:dreamsAndPlans/groupReceive", where: `${WHERE}のまとまりの名前（不確実な入るお金・受け取る相続と贈与・相続で受け継ぐ借金）`, official: "受け取りの予定", vars: {}, numberVars: [] },
  { id: "result:dreamsAndPlans/columnWhen", where: `${WHERE}の列の名前（時期）`, official: "時期", vars: {}, numberVars: [] },
  { id: "result:dreamsAndPlans/columnAmount", where: `${WHERE}の列の名前（金額）`, official: "金額", vars: {}, numberVars: [] },
  { id: "result:dreamsAndPlans/tagCertain", where: `${WHERE}の行の右に出す見込み（確実な物。入力の画面の見込みの選択肢は公式の名前のまま）`, official: "確実", vars: {}, numberVars: [] },
  { id: "result:dreamsAndPlans/tagUncertain", where: `${WHERE}の行の右に出す見込み（不確実な物。入力の画面の見込みの選択肢は公式の名前のまま）`, official: "不確実", vars: {}, numberVars: [] },
  {
    id: "result:dreamsAndPlans/more",
    where: `${WHERE}で、まとまりが多いときに残りを開くボタン（後ろに「▾」が付く）`,
    official: "ほか{count}を見る",
    vars: { count: "まだ出していない件数（例: 3件。「件」まで入る）" },
    numberVars: ["count"],
  },
] as const satisfies readonly ResultTermDef[];

export type ResultTermId = (typeof DEFS)[number]["id"];

/** 結果の画面の名前の表（一覧を作るビルドの段とテストが読む） */
export const RESULT_TERMS: readonly ResultTermDef[] = DEFS;

const BY_ID: ReadonlyMap<string, ResultTermDef> = new Map(RESULT_TERMS.map((d) => [d.id, d]));

/** 結果の画面の名前の当て方（公式の名前か、承認した事務所の名前） */
export type ResultNames = (id: ResultTermId, values?: Readonly<Record<string, string>>) => string;

/** 事務所の名前（承認した中身から作った物）を当てる。当てるのは、承認したときの公式の名前が今の公式の名前と同じ行の書き換えだけ */
export function resultNamesOf(names: OfficeNames): ResultNames {
  return (id, values = {}) => {
    const d = BY_ID.get(id) as ResultTermDef;
    const e = names.get(id);
    const use = e !== undefined && e.do === "replace" && e.text !== null && e.text.trim() !== "" && e.official === d.official ? e.text : d.official;
    return fillName(use, values);
  };
}

/** 公式の名前だけ（テストの既定） */
export const OFFICIAL_NAMES: ResultNames = resultNamesOf(new Map());
