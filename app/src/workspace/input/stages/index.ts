// 入力の15項目（標準の順番: 家族 → 働き方と収入 → 退職金・企業年金 → 年金 → 基本生活費 → 子ども・教育 → 住まい・ローン → 保険 → 貯蓄・運用 →
// 収益不動産 → ライフイベント → 車 → 介護・親 → 相続・贈与 → 前提条件。もとの10項目の相対の順番は変えず、車と新しい3枚を間に入れた。0045。
// 収益不動産は貯蓄・運用の後に足した。0079）。
// 入力のホームでは、項目ごとのカード（items.ts）になる。並べ替えは事務所の設定の形（items.ts の CardLayout）で受ける。
// FP顧問料は前提条件の中の欄のまとまり（カードにしない。区画 fee は前提条件のパネルの中身を作るときにだけ使う）
import type { StageDef, StageId } from "../form.ts";
import { allFields } from "../form.ts";
import type { WorkingHousehold } from "../household.ts";
import { assumptionsStage } from "./assumptions.ts";
import { carStage } from "./cars.ts";
import { careStage } from "./care.ts";
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

export const STAGE_ORDER: readonly { id: StageId; label: string }[] = [
  { id: "family", label: "家族" },
  { id: "work", label: "働き方と収入" },
  { id: "retirement", label: "退職金・企業年金" },
  { id: "pension", label: "年金" },
  { id: "living", label: "基本生活費" },
  { id: "education", label: "子ども・教育" },
  { id: "housing", label: "住まい・ローン" },
  { id: "insurance", label: "保険" },
  { id: "savings", label: "貯蓄・運用" },
  { id: "rental", label: "収益不動産" },
  { id: "events", label: "ライフイベント" },
  { id: "car", label: "車" },
  { id: "care", label: "介護・親" },
  { id: "inheritance", label: "相続・贈与" },
  { id: "assumptions", label: "前提条件" },
];

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
  const stage = BUILDERS[id](wh);
  if (!MONEY_CARDS.has(id)) return stage;
  // ピンにした物も属するカードに出す（ピンは見せ方だけ。0045）
  const money = moneySections(wh, id as MoneyCard, {
    claimed: NONE_CLAIMED,
    ...(id === "work" ? { level: "simple" as const, inTitle: "入るお金" } : {}),
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
