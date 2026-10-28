// 青色申告の純損失の繰越控除（所得税法70条1項・地方税法32条8項・313条8項。0081）。
// - 申告の仕方が青色（members[].taxReturn.method blue）の人だけ。白色の人は何もしない（引ききれない損失は捨てる。今までどおり）
// - 年ごとに、合計所得金額の部品（tax.totalIncome）の純損失（netLoss。損益通算をしても引ききれない損失）を、翌年以後
//   incomeTax.netLoss.carryforwardYears 年（3年）繰り越し、古い年の損失から順に、その年の総所得金額（total）から引く
// - 引くのは総所得金額だけ（退職所得・山林所得・分離課税の譲渡所得からは引かない。仮の規約）。損失を数えるのは、税・保険料の計算で
//   いちばん前に使う所得の年（計算基準月の年度の住民税の所得の年＝その年度の前の年）から。それより前の損失は入力が無いので数えない
// - 合計所得金額（tax.totalIncome の total）は繰越控除の前のまま（配偶者控除・扶養の所得の要件などの判定に使う）。所得税・住民税の課税所得と、
//   国民健康保険料・後期高齢者医療の保険料の所得割の基（総所得金額等）は、引いた後の額を使う（各部品が deducted を引く）
// - 毎年、確定申告書（青色申告）を出し続けるとみなす（要件を満たさない年は扱わない）
import { defineComponent, fiscalYearOf, monthIndex, yearOf, yen, type LossCarryforwardOutput, type MemberInput, type TotalIncomeOutput } from "../../sdk/index.ts";

const YEARS = "incomeTax.netLoss.carryforwardYears";

export default defineComponent<{ member: string }, LossCarryforwardOutput>({
  id: "tax.lossCarryforward",
  title: "純損失の繰越控除（青色申告）",
  contract: "1.0",
  revision: 1,
  requires: { "tax.totalIncome": ">=1 <2" },
  params: [YEARS],
  reads: ["member.taxReturn"],
  input: "member.input",
  output: "tax.lossCarryforward.output",
  compute(input, ctx) {
    const m = ctx.list<MemberInput>("member").find((x) => x.id === input.member);
    if (m?.taxReturn?.method !== "blue") return { byYear: [] };
    const first = fiscalYearOf(ctx.time.base) - 1;
    const last = yearOf(ctx.time.end);
    const carried: { year: number; amount: number }[] = [];
    const byYear: LossCarryforwardOutput["byYear"][number][] = [];
    for (let y = first; y <= last; y++) {
      const years = ctx.at(monthIndex(y, 1)).paramCount(YEARS);
      if (years === null) {
        ctx.notice("N_PARAM_MISSING", [YEARS]);
        return { byYear: [] };
      }
      // 繰り越せる年を過ぎた損失は捨てる
      for (let i = carried.length - 1; i >= 0; i--) if ((carried[i] as { year: number }).year < y - years) carried.splice(i, 1);
      const inc = ctx.call<TotalIncomeOutput>("tax.totalIncome", { member: input.member, year: y });
      let room = inc.total as number;
      let deducted = 0;
      for (const c of carried) {
        if (room <= 0) break;
        const d = Math.min(room, c.amount);
        c.amount -= d;
        room -= d;
        deducted += d;
      }
      for (let i = carried.length - 1; i >= 0; i--) if ((carried[i] as { amount: number }).amount <= 0) carried.splice(i, 1);
      const netLoss = inc.netLoss ?? yen(0);
      if (netLoss > 0) carried.push({ year: y, amount: netLoss });
      const remaining = carried.reduce((s, c) => s + c.amount, 0);
      if (netLoss > 0 || deducted > 0 || remaining > 0) byYear.push({ year: y, netLoss, deducted: yen(deducted), remaining: yen(remaining) });
    }
    return { byYear };
  },
});

