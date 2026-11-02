// 事務所の推定の値（0111）を変える前に、代表の世帯（アプリの見本の世帯。架空）で主な結果がどう変わるかを見る。
// 比べるのは、今の事務所の値と、変えようとしている値。どちらも、推定で埋まる欄（基本生活費・給与と賞与・事業所得）を推定のままとして入れ直し
// （空欄だった世帯なら入る値）、計算のときに引く値（介護・学校の費用の目安・平均余命など）は計算の要求の estimateValues で渡す。
// 物差しは案の比較と同じ（plans/compare.ts の metricsOf）: 90歳時点の金融資産・資産が尽きる年・生涯の支出の合計
import { businessEstimate, livingEstimate, salaryEstimate } from "../../../../hearing/src/estimates.ts";
import { withOfficeEstimates } from "../../../../hearing/src/statistics.ts";
import type { Box, EngineRequest, PreviewResult } from "../../engine/types.ts";
import { forEngine } from "../../engine/moneyRows.ts";
import { householdSize, salaryAge, withRefreshedEstimates } from "../input/estimates.ts";
import { sampleRequest } from "../input/household.ts";
import { metricsOf, type PlanMetrics } from "../plans/compare.ts";
import { engineNoFillOf, engineValuesOf, overridesOf, type OfficeEstimates } from "./estimates.ts";

/** 代表の世帯（アプリの見本。data/modelHouseholds の架空の世帯） */
export const PREVIEW_HOUSEHOLDS: readonly { id: string; title: string }[] = [
  { id: "salariedCoupleTwoKids", title: "会社員の夫婦と子2人" },
  { id: "sampleSelfEmployedFamily", title: "自営業の夫婦と子2人" },
  { id: "sampleSeniorCouple", title: "シニア夫婦・60代" },
];

/** 主な結果を見る年齢（本人） */
export const PREVIEW_AGE = 90;

export interface PreviewRow {
  id: string;
  title: string;
  before: PlanMetrics;
  after: PlanMetrics;
  /** 主な結果が変わったか */
  changed: boolean;
}

export interface PreviewDeps {
  /** 見本の世帯の計算の要求 */
  open: (id: string) => Promise<EngineRequest>;
  /** 計算（要求の並び → 結果。計算できなかった物は null） */
  compute: (reqs: readonly EngineRequest[]) => Promise<readonly (PreviewResult | null)[]>;
}

const auto = (value: number, basis: string): Box<number> => ({ value, state: "estimated", origin: { kind: "auto" }, estimate: { method: "statistic", basis } }) as Box<number>;

/**
 * 推定で埋まる欄を、今の推定の目安（重ねた事務所の値）で入れ直した要求。基本生活費（総額で入れる物）・給与と賞与・事業所得を推定の値にし、
 * そのほかの推定のままの値（進路・退職金の目安など）も入れ直す。世帯の欄が空欄だったら入る値で比べるため
 */
export function asEstimated(req: EngineRequest): EngineRequest {
  const r = structuredClone(req);
  const h = r.input.household;
  const base = r.input.baseMonth;
  for (const l of h.livingExpenses ?? []) {
    if (l.mode !== "total" && l.mode !== undefined) continue;
    const e = livingEstimate(householdSize(h, base));
    l.monthly = auto(e.value, e.basis);
  }
  for (const p of h.employmentPeriods ?? []) {
    const m = h.members.find((x) => x.id === p.member);
    if (m === undefined) continue;
    if (p.salary !== undefined) {
      const e = salaryEstimate(p.type, m.sex, { age: salaryAge(m, p, base) });
      if (e !== null) p.salary = { ...p.salary, annual: auto(e.annual.value, e.annual.basis), bonus: auto(e.bonus.value, e.bonus.basis) };
    }
    if (p.business !== undefined) {
      const e = businessEstimate();
      p.business = { ...p.business, income: auto(e.value, e.basis) };
    }
  }
  return withRefreshedEstimates({ request: r }).request;
}

/**
 * 事務所の値の組で、代表の世帯の要求を作る（推定の目安は重ねた値で入れ直し、計算のときに引く値は estimateValues で渡す。
 * 推定で埋めない、エンジンが引く統計の目安〔0111 の2回目〕も、その組の物を estimateNoFill で渡す）
 */
export function previewRequest(req: EngineRequest, e: OfficeEstimates): EngineRequest {
  const r = withOfficeEstimates(overridesOf(e), [], () => asEstimated(req));
  return forEngine({ ...r, input: { ...r.input, estimateValues: engineValuesOf(e), estimateNoFill: engineNoFillOf(e) } });
}

const sameMetrics = (a: PlanMetrics, b: PlanMetrics) => a.target === b.target && a.depletion === b.depletion && a.expense === b.expense;

/** 代表の世帯ごとに、今の値（before）と変えようとしている値（after）で計算した主な結果 */
export async function previewOfficeChange(deps: PreviewDeps, before: OfficeEstimates, after: OfficeEstimates): Promise<PreviewRow[]> {
  const reqs = await Promise.all(PREVIEW_HOUSEHOLDS.map(async (x) => sampleRequest(await deps.open(x.id))));
  const pairs = reqs.flatMap((r) => [previewRequest(r, before), previewRequest(r, after)]);
  const results = await deps.compute(pairs);
  const out: PreviewRow[] = [];
  PREVIEW_HOUSEHOLDS.forEach((x, i) => {
    const a = results[i * 2];
    const b = results[i * 2 + 1];
    const req = pairs[i * 2];
    if (a == null || b == null || req === undefined) return;
    const m0 = metricsOf(req, a.table, PREVIEW_AGE);
    const m1 = metricsOf(req, b.table, PREVIEW_AGE);
    out.push({ id: x.id, title: x.title, before: m0, after: m1, changed: !sameMetrics(m0, m1) });
  });
  return out;
}
