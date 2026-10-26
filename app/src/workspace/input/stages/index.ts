// 入力の14項目（標準の順番: 家族 → 働き方と収入 → 退職金・企業年金 → 年金 → 基本生活費 → 子ども・教育 → 住まい・ローン → 保険 → 貯蓄・運用 →
// ライフイベント → 車 → 介護・親 → 相続・贈与 → 前提条件。もとの10項目の相対の順番は変えず、車と新しい3枚を間に入れた。0045）。
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
  events: eventsStage,
  car: carStage,
  care: careStage,
  inheritance: inheritanceStage,
  fee: feeStage,
  assumptions: assumptionsStage,
};

/** お金の行（入るお金・出るお金。0044）の区画を後ろに置くカード（ライフイベント・基本生活費・家族は自分の区画の中に置く） */
const MONEY_CARDS: ReadonlySet<StageId> = new Set(["work", "pension", "education", "housing", "insurance", "savings", "car"]);

export function buildStage(id: StageId, wh: WorkingHousehold): StageDef {
  const stage = BUILDERS[id](wh);
  if (!MONEY_CARDS.has(id)) return stage;
  // ピンにした物も属するカードに出す（ピンは見せ方だけ。0045）
  const money = moneySections(wh, id as MoneyCard, { claimed: NONE_CLAIMED, ...(id === "work" ? { level: "simple" as const, inTitle: "入るお金（副業・その他の働く収入・売却代金など）" } : {}) });
  return money.length === 0 ? stage : { ...stage, sections: [...stage.sections, ...money] };
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
