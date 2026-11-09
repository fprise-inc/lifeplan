// 期間に健康保険を「扶養」と書いた人の給与が、扶養の基準（年130万円未満など）を超えるかの知らせ（0174 の追記）。
// 計算は FP が書いたとおり扶養（配偶者が第2号なら第3号）のままにし、入力を書き換えない。欄の下と確かめの一覧に知らせを出すだけ。
// - その期間の給与（年収＋賞与）を、表の年ごとに期間の増減率（無ければ前提の賃金上昇率）で伸ばした額で見る（計算エンジンの income.salary と
//   同じ暦年ごとの伸ばし方。統計の年齢カーブの係数は入れない目安）。ほかの期間の給与・年金は入れない
// - 基準は健康保険の扶養の基準（60歳以上は別の基準、19〜22歳の配偶者でない人は別の基準。後期高齢者医療の年齢からは見ない）
import type { EmploymentPeriod, Member } from "../../engine/types.ts";
import { dependentLimits } from "../../../../hearing/src/estimates.ts";
import { regulationValue } from "../../../../hearing/src/statistics.ts";
import { ageAt } from "../levers.ts";
import type { WorkingHousehold } from "./household.ts";

/** 基準を超える最初の年と、その年の給与・基準（超えなければ null） */
export function declaredDependentOverLimit(wh: WorkingHousehold, m: Member, p: EmploymentPeriod): { year: number; income: number; limit: number } | null {
  if (p.healthInsurance?.kind !== "dependent") return null;
  const num = (b: { value: unknown } | undefined): number => (typeof b?.value === "number" ? b.value : 0);
  const annual0 = num(p.salary?.annual as { value: unknown } | undefined) + num(p.salary?.bonus as { value: unknown } | undefined);
  if (annual0 <= 0) return null;
  const input = wh.request.input;
  const baseYear = Number(input.baseMonth.slice(0, 4));
  const from = p.from.at;
  const to = p.to === null ? null : (p.to.at ?? null);
  if (from === undefined) return null;
  const fromYear = Number(from.slice(0, 4));
  const lastYear = Math.min(input.endYear, to === null ? input.endYear : Number(to.slice(0, 4)));
  const refYear = Math.max(fromYear, baseYear);
  const wage = (input.assumptions as { wageGrowth?: { default?: string } } | undefined)?.wageGrowth?.default;
  const own = (p.salary as { growth?: { rate?: string } } | undefined)?.growth?.rate;
  const g = Number(own ?? wage ?? "0");
  const young = (id: string): number | null => {
    const v = regulationValue(id, `${baseYear}-04-01`);
    return typeof v === "number" ? v : null;
  };
  const youngLimit = young("socialInsurance.dependent.incomeLimitYoung");
  const youngFrom = young("socialInsurance.dependent.youngFromAge");
  const youngUntil = young("socialInsurance.dependent.youngUntilAge");
  let income = annual0;
  for (let y = refYear; y <= lastYear; y++) {
    if (y > refYear) income = Math.floor(income * (1 + g));
    if (y < baseYear) continue;
    // 年の初め（その年の1月）の年齢の基準（60歳になる年は、その年の1月にまだ60歳でなければ前の基準の目安）
    const age = ageAt(m, `${y}-01`);
    const lim = dependentLimits(age, `${y}-04-01`);
    if (lim === null || lim.health === null) continue;
    const isYoung = m.kind !== "self" && m.kind !== "spouse" && youngLimit !== null && youngFrom !== null && youngUntil !== null && age >= youngFrom && age < youngUntil;
    const limit = isYoung ? youngLimit : lim.health;
    if (income >= limit) return { year: y, income, limit };
  }
  return null;
}

const man = (n: number): string => {
  const v = Math.floor(n / 1000) / 10;
  return `${Number.isInteger(v) ? v.toLocaleString("ja-JP") : v.toFixed(1)}万円`;
};

/** 欄の下と確かめの一覧に出す文（超えなければ null） */
export function declaredDependentWarn(wh: WorkingHousehold, m: Member, p: EmploymentPeriod): string | null {
  const over = declaredDependentOverLimit(wh, m, p);
  if (over === null) return null;
  const baseYear = Number(wh.request.input.baseMonth.slice(0, 4));
  const when = over.year <= baseYear ? "" : `${over.year}年に、賃金の伸びで`;
  return `${when}収入が健康保険の扶養の基準（年${man(over.limit)}未満）を超えます（この期間の給与 年${man(over.income)}）。扶養（配偶者が厚生年金に入っていれば国民年金の第3号）のまま計算しています。扶養から外れるなら、健康保険の欄を国民健康保険などにしてください`;
}
