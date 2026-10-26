// 万一の想定の前提（作業の層。画面の側に世帯といっしょに持つ）。
// 万一の想定（0008 の5 の contingencies）と必要保障額（要求の protection）は「層」なので、世帯の事実（入力の10段階）には入れず、
// 想定ごとの前提をここに持ち、万一の画面を開いたときに要求を作る（computeRequests.ts）。
// 障害の等級は「該当した場合」の仮定で、構成員の実在の状態としては持たない（6.3）
import type { EngineRequest, OldAgeChoice, SurvivorAssumptions } from "../../engine/types.ts";

/** 残された人の働き方の変化（その人の配偶者が亡くなった想定で使う） */
export interface SurvivorWork {
  /** keep は変えない。none は働かない */
  type: "keep" | "regular" | "contract" | "partTime" | "selfEmployed" | "none";
  /** 年収（賞与を除く。自営業は事業の所得）。省略は働き方ごとの目安 */
  annualSalary?: number;
  /** 亡くなった月の何か月後から（省略は6） */
  afterMonths?: number;
  /** 何歳まで（その年齢に達する月の前月まで。省略は65） */
  untilAge?: number;
}

export interface ContingencyPlan {
  /** 遺族の側の前提（生活費の割合・整理資金・予備の生活資金・死亡退職金・弔慰金）。必要保障額の推移と死亡の想定の両方に使う */
  survivor: SurvivorAssumptions;
  /** 必要保障額を累計する期間の終わり（省略は配偶者の平均余命） */
  horizon?: { kind: "lifeExpectancy" | "age" | "youngestIndependence"; age?: number };
  /** 残された人ごとの働き方の変化（構成員の ID → 変化） */
  work: Record<string, SurvivorWork>;
  /** 障害・就業不能の想定の等級（該当した場合の仮定）。0 は障害年金に当たらない就業不能。省略は2級 */
  grade?: 0 | 1 | 2 | 3;
  /** 障害・就業不能の想定の医療費（1か月・10割）と月数 */
  medical?: { monthly?: number; months?: number };
  /** 障害年金の65歳からの組み合わせを FP が選び直したもの（構成員の ID → 組み合わせ）。無ければ自動 */
  oldAgeChoice: Record<string, OldAgeChoice>;
  /** 想定の年（万一の画面で選んだ年。省略は計算基準年の翌年） */
  year?: number;
  /** 相場が下がったときの前提（下がる幅。省略は3割。0026） */
  market?: { drop?: string };
  /**
   * 大きな病気のときの前提（働けない月数・医療費（1か月・10割）と月数。省略は目安。0026）。病気の種類・入院の日数・手術の回数（0055。
   * 保険の医療・がんの給付の見込みに使う。省略は推定: がん・病気の種類ごとの入院の日数の目安・1回）
   */
  illness?: { months?: number; medicalMonthly?: number; medicalMonths?: number; disease?: "cancer" | "heartStroke" | "other"; hospitalDays?: number; surgeries?: number };
}

export function emptyPlan(): ContingencyPlan {
  return { survivor: {}, work: {}, oldAgeChoice: {} };
}

/** 世帯の要求に入っていた万一の想定・必要保障額の前提から、初めの前提を読む（開いた世帯は書き換えない） */
export function planFromRequest(req: EngineRequest): ContingencyPlan {
  const p = emptyPlan();
  const prot = req.input.protection;
  const c = req.input.contingencies?.[0];
  const sv = { ...(prot?.survivor ?? {}), ...(c?.survivor ?? {}) } as SurvivorAssumptions & { spouseWork?: unknown };
  delete sv.spouseWork;
  p.survivor = structuredClone(sv);
  if (prot?.horizon !== undefined) p.horizon = structuredClone(prot.horizon);
  if (c !== undefined && c.kind !== "death") {
    // 2級は省略の既定と同じなので持たない
    const g = c.grade ?? 0;
    if (g !== 2) p.grade = g;
    if (c.medical !== undefined) p.medical = { monthly: c.medical.monthly, months: c.medical.months };
    if (c.oldAgeChoice !== undefined) p.oldAgeChoice[c.member] = c.oldAgeChoice;
  }
  const at = c?.occurs.at;
  if (at !== undefined) p.year = Number(at.slice(0, 4));
  return p;
}
