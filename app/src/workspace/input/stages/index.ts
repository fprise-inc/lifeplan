// 入力の15項目（標準の順番: 家族 → 働き方と収入 → 退職金・企業年金 → 年金 → 基本生活費 → 子ども・教育 → 住まい・ローン → 保険 → 貯蓄・運用 →
// 収益不動産 → ライフイベント → 車 → 介護・親 → 相続・贈与 → 前提条件。もとの10項目の相対の順番は変えず、車と新しい3枚を間に入れた。0045。
// 収益不動産は貯蓄・運用の後に足した。0079）。
// 入力のホームでは、項目ごとのカード（items.ts）になる。並べ替えは事務所の設定の形（items.ts の CardLayout）で受ける。
// FP顧問料は前提条件の中の欄のまとまり（カードにしない。区画 fee は前提条件のパネルの中身を作るときにだけ使う）
import type { ActionDef, FieldDef, GroupDef, StageDef, StageId } from "../form.ts";
import { afterWrite, allFields } from "../form.ts";
import { keepRefs } from "../refs.ts";
import type { WorkingHousehold } from "../household.ts";
import { assumptionsStage } from "./assumptions.ts";
import { carStage } from "./cars.ts";
import { careStage, followCareStarts } from "./care.ts";
import { educationStage } from "./education.ts";
import { eventsStage, NONE_CLAIMED } from "./events.ts";
import { familyStage } from "./family.ts";
import { feeStage } from "./fees.ts";
import { housingStage } from "./housing.ts";
import { inheritanceStage } from "./inheritance.ts";
import { insuranceStage } from "./insurance.ts";
import { livingStage } from "./living.ts";
import { pensionStage } from "./pension.ts";
import { rentalStage } from "./rental.ts";
import { retirementStage } from "./retirement.ts";
import { savingsStage } from "./savings.ts";
import { workStage } from "./work.ts";
import { moneySections, type MoneyCard } from "../moneyRows.ts";
import { STAGE_ORDER } from "../stageOrder.ts";

// 15項目の標準の順番と名前は stageOrder.ts（画面の部品を読まない所〔AI接続口の計算のお知らせ。0210〕からも読むので、段階の定義と分けた）
export { STAGE_ORDER };

const BUILDERS: Record<StageId, (wh: WorkingHousehold) => StageDef> = {
  family: familyStage,
  work: workStage,
  retirement: retirementStage,
  pension: pensionStage,
  living: livingStage,
  education: educationStage,
  housing: housingStage,
  insurance: insuranceStage,
  savings: savingsStage,
  rental: rentalStage,
  events: eventsStage,
  car: carStage,
  care: careStage,
  inheritance: inheritanceStage,
  fee: feeStage,
  assumptions: assumptionsStage,
};

/**
 * お金の行（入るお金・出るお金。0044）の区画を後ろに置くカード（ライフイベント・基本生活費・家族・子ども・教育・車・年金は自分の区画の中に置く。子ども・教育は子ごと）。
 * 収益不動産は不動産の一時の経費（大規模修繕・原状回復など。もとは貯蓄・運用の中。0079）。標準でも出す（行を入れても標準で見えなかった。0079 の 2026-11-05 の追記）
 */
const MONEY_CARDS: ReadonlySet<StageId> = new Set(["work", "housing", "insurance", "rental"]);
const RENTAL_MONEY_NOTE =
  "物件ごとに分けない、不動産にかかる一時的支出です。家計の支出として出ますが、不動産所得の経費には入れません。物件の大規模修繕・原状回復は、物件の「売却・大きな修繕の予定」で入れると、貸している間なら全額をその年の経費にします。毎年かかる経費は物件の「経費」の年額で入れます";

export function buildStage(id: StageId, wh: WorkingHousehold): StageDef {
  return withRefsKept(withCareStartsFollowed(buildRaw(id, wh)));
}

/**
 * どの項目の欄・ボタンの後にも、推定のままの介護の始まりを元の値（亡くなる見込み・その元の生年月と性別・前の段階など）についてこさせる
 * （care.ts の followCareStarts。0041 の追記 2026-11-11）。元の値は家族・介護・親など複数の項目にあるので、項目ごとでなくここで包む
 */
function withCareStartsFollowed(stage: StageDef): StageDef {
  const field = (f: FieldDef): FieldDef => afterWrite(f, followCareStarts);
  const action = (a: ActionDef): ActionDef => ({ ...a, run: (w) => followCareStarts(w, a.run(w)) });
  const group = (g: GroupDef): GroupDef => ({ ...g, fields: g.fields.map(field), actions: g.actions.map(action), ...(g.openFields !== undefined ? { openFields: g.openFields.map(field) } : {}) });
  return { ...stage, sections: stage.sections.map((s) => ({ ...s, groups: s.groups.map(group), actions: s.actions.map(action) })) };
}

/**
 * ボタンの操作で外した物（人・口座・保険の保障など）を指す欄を、操作の中で片付ける（0163）。指す先に付いている物（持ち家の住宅ローンなど）の
 * 欄は残し、入力のパネルが、プランを直すときの連鎖の確かめの後に片付ける
 */
function withRefsKept(stage: StageDef): StageDef {
  const wrap = (a: ActionDef): ActionDef => ({ ...a, run: (w) => keepRefs(w, a.run(w), { dependents: false }) });
  return { ...stage, sections: stage.sections.map((s) => ({ ...s, actions: s.actions.map(wrap), groups: s.groups.map((g) => ({ ...g, actions: g.actions.map(wrap) })) })) };
}

function buildRaw(id: StageId, wh: WorkingHousehold): StageDef {
  const stage = BUILDERS[id](wh);
  if (!MONEY_CARDS.has(id)) return stage;
  // ピンにした物も属するカードに出す（ピンは見せ方だけ。0045）
  const money = moneySections(wh, id as MoneyCard, {
    claimed: NONE_CLAIMED,
    // 働き方の入るお金は標準。売却代金（事業・出資持分）はめったに使わないので「＋」を詳細だけに出す
    ...(id === "work" ? { level: "simple" as const, inTitle: "入るお金", kindLevel: (kind: string) => (kind === "saleBusiness" ? ("detail" as const) : "simple") } : {}),
    ...(id === "rental" ? { level: "simple" as const, outTitle: "不動産の一時の経費（出るお金）", note: rentalMoneyNote(wh) } : {}),
    ...(id === "housing" ? { kindLevel: housingMoneyLevel(wh) } : {}),
  });
  return money.length === 0 ? stage : { ...stage, sections: [...stage.sections, ...money] };
}

/**
 * 住まいのお金の行のボタンの出し方: 売電・修繕・リフォームは、持ち家か購入の予定があるときだけ（賃貸・家賃なしだけの世帯には出さない）。
 * 戸建て（か建て方を選んでいない持ち家）の修繕・リフォームは標準でも出す（外壁・屋根などの大きな修繕を毎回聞くため。マンションは管理費・修繕積立金に含む）
 */
export function housingMoneyLevel(wh: WorkingHousehold): (kind: string) => "simple" | "detail" | null {
  const owned = (wh.request.input.household.residences ?? []).filter((r) => r.kind === "own");
  // 購入の予定は購入の種類（マンション・戸建て）で建て方が決まる。選んでいなければ戸建てかもしれないので標準に出す
  const house = owned.some((r) => r.style === "house" || (r.style === undefined && r.valuation?.structure !== "rc"));
  return (kind) => {
    if (kind !== "repair" && kind !== "powerSale") return "detail";
    if (owned.length === 0) return null;
    return kind === "repair" && house ? "simple" : "detail";
  };
}

function rentalMoneyNote(wh: WorkingHousehold): string {
  const none = !(wh.request.input.household.periodicExpenses ?? []).some((p) => p.kind === "realEstateCost");
  return `${none ? "まだありません。" : ""}${RENTAL_MONEY_NOTE}`;
}

export function buildStages(wh: WorkingHousehold): StageDef[] {
  return STAGE_ORDER.map((s) => buildStage(s.id, wh));
}

/** 段階（項目）の状態の材料: 推定・仮の値の欄の数、入っている欄の数 */
export interface StageStatus {
  id: StageId;
  estimated: number;
  filled: number;
}

export function stageStatus(stage: StageDef, wh: WorkingHousehold): StageStatus {
  let estimated = 0;
  let filled = 0;
  for (const f of allFields(stage)) {
    const s = f.get(wh);
    if (s.estimated != null || s.assumed != null) estimated++;
    else if (s.value !== null && s.value !== "" && s.implicit !== true) filled++;
  }
  return { id: stage.id, estimated, filled };
}
