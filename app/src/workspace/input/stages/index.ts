// 入力の10段階（標準の順番: 家族 → 働き方と収入 → 年金 → 基本生活費 → 子ども・教育 → 住まい・ローン → 保険 → 貯蓄・運用 → ライフイベント → 前提条件）
import type { StageDef, StageId } from "../form.ts";
import { allFields } from "../form.ts";
import type { WorkingHousehold } from "../household.ts";
import { assumptionsStage } from "./assumptions.ts";
import { educationStage } from "./education.ts";
import { eventsStage } from "./events.ts";
import { familyStage } from "./family.ts";
import { housingStage } from "./housing.ts";
import { insuranceStage } from "./insurance.ts";
import { livingStage } from "./living.ts";
import { pensionStage } from "./pension.ts";
import { savingsStage } from "./savings.ts";
import { workStage } from "./work.ts";

export const STAGE_ORDER: readonly { id: StageId; label: string }[] = [
  { id: "family", label: "家族" },
  { id: "work", label: "働き方と収入" },
  { id: "pension", label: "年金" },
  { id: "living", label: "基本生活費" },
  { id: "education", label: "子ども・教育" },
  { id: "housing", label: "住まい・ローン" },
  { id: "insurance", label: "保険" },
  { id: "savings", label: "貯蓄・運用" },
  { id: "events", label: "ライフイベント" },
  { id: "assumptions", label: "前提条件" },
];

const BUILDERS: Record<StageId, (wh: WorkingHousehold) => StageDef> = {
  family: familyStage,
  work: workStage,
  pension: pensionStage,
  living: livingStage,
  education: educationStage,
  housing: housingStage,
  insurance: insuranceStage,
  savings: savingsStage,
  events: eventsStage,
  assumptions: assumptionsStage,
};

export function buildStage(id: StageId, wh: WorkingHousehold): StageDef {
  return BUILDERS[id](wh);
}

export function buildStages(wh: WorkingHousehold): StageDef[] {
  return STAGE_ORDER.map((s) => buildStage(s.id, wh));
}

/** 段階の一覧に添える状態: 推定・仮の値の数、入っている物の数 */
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
