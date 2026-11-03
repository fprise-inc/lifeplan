// 給与・賞与の支払い（0008 の4 の働き方の期間から）。お金の動きは支払月（0003 の2）
// 昇給は賃金上昇率（前提）で暦年ごとに伸ばす。期間に昇給カーブ（salary.growth.curve。マスタデータの年齢ごとの係数）を書いたときは、
// その年の12月31日の年齢の係数と前の年の係数の比も掛ける（0008 の追記。標準報酬の定時決定は9月から等級を変える近似）。
// 読める昇給カーブは wageStats.default と、統計の年齢カーブ wageStats.curve.<雇用形態>.all.all.<企業規模>（改訂7。0116）。
// 改訂8: 統計の年齢カーブは男女計・学歴計だけにした（人の属性で推定の数字を分けない。0118）。性別・学歴で分けた値ID は読めない（世帯ファイルの変換の段が男女計・学歴計に直す）
// 期間に伸びの率（salary.growth.rate。改訂6。0040）を書いたときは、賃金上昇率の代わりにその率で暦年ごとに伸ばす（マイナスも書ける）
// 役員（executive）: 役員報酬は定期同額（年額を12か月に等分）、賞与は事前確定届出給与（届け出た支給月と額）として同じ形で入れ、
// 行は cf.income.salary.executive。会社の側の計算（役員報酬をいくらにするか・法人税・会社負担の社会保険料・退職金の財源）は入れない
// ストレステストの収入の減少（前提 incomeShocks。改訂5）: その構成員の from〜to の月の給与・賞与を ratio の割合だけ減らす（標準報酬月額は変えない近似）
import {
  boxValue,
  defineComponent,
  formatYm,
  monthIndex,
  parseYm,
  rate,
  RATE_ONE,
  yearOf,
  yen,
  type Bracket,
  type EmploymentPeriodInput,
  type Flow,
  type IncomeShock,
  type MemberInput,
  type Rate,
  type SalaryPayment,
  type Yen,
} from "../../sdk/index.ts";

const PAID: ReadonlySet<string> = new Set(["regular", "contract", "partTime", "civilServant", "executive"]);
const DEFAULT_BONUS_MONTHS = [6, 12];
/** 昇給カーブの値ID（マスタデータ master.wageStats。段階表の upTo が年齢、rate が係数） */
const CURVE = "wageStats.default";
/**
 * 統計の年齢カーブ（賃金構造基本統計調査の男女計・学歴計の企業規模ごと。0116・0118）の値ID。
 * 部品が読める値IDは params に書いた物だけ（0006）なので、ここで並べる
 */
const CURVE_SIZES = ["all", "large", "medium", "small"] as const;
const STAT_CURVES: readonly string[] = (["regular", "nonRegular"] as const).flatMap((e) => CURVE_SIZES.map((z) => `wageStats.curve.${e}.all.all.${z}`));

function coefficient(table: readonly Bracket[], age: number): Rate {
  for (const b of table) if (b.upTo === null || age <= b.upTo) return b.rate ?? RATE_ONE;
  return RATE_ONE;
}

export default defineComponent<{ member: string }, { flows: Flow[]; payments: SalaryPayment[] }>({
  id: "income.salary",
  title: "給与・賞与",
  contract: "1.0",
  revision: 8,
  requires: {},
  params: [CURVE, ...STAT_CURVES],
  reads: [
    "member.birth",
    "employment.member",
    "employment.from",
    "employment.to",
    "employment.type",
    "employment.salary.annual",
    "employment.salary.bonus",
    "employment.salary.bonusMonths",
    "employment.salary.commutingMonthly",
    "employment.salary.growth",
    "assumptions.wageGrowth",
    "assumptions.incomeShocks",
  ],
  memberScope: ["employment"],
  input: "income.salary.input",
  output: "income.salary.output",
  compute(input, ctx) {
    const { base, end } = ctx.time;
    const baseYear = yearOf(base);
    // 前年・前々年の所得に対する住民税のため、計算基準月の2年前の1月から計算する（表に載るのは基準月以後だけ）
    const calcStart = monthIndex(baseYear - 2, 1);
    const periods = ctx
      .list<EmploymentPeriodInput>("employment")
      .filter((p) => p.member === input.member && PAID.has(p.type) && p.salary !== undefined);
    const birthYear = yearOf(parseYm(ctx.get<MemberInput>("member", input.member).birth.birthYearMonth));
    const flows: Flow[] = [];
    const payments: SalaryPayment[] = [];
    const shocks = (ctx.setting<readonly IncomeShock[]>("incomeShocks") ?? []).filter((x) => x.member === input.member).map((x) => ({ from: parseYm(x.from), to: parseYm(x.to), keep: ctx.rate.sub(RATE_ONE, ctx.rate.of(x.ratio)) }));
    const shock = (month: number, a: Yen): Yen => {
      let v = a;
      for (const sh of shocks) if (month >= sh.from && month <= sh.to && v > 0) v = ctx.money.mulRate(v, sh.keep, "conv.salary.monthly");
      return v;
    };
    for (const p of periods) {
      const from = ctx.time.resolve(p.from);
      const to = p.to === null ? end : ctx.time.resolve(p.to);
      const start = from < calcStart ? calcStart : from;
      const stop = to > end ? end : to;
      if (start > stop) continue;
      const sal = p.salary as NonNullable<EmploymentPeriodInput["salary"]>;
      const row = p.type === "executive" ? "cf.income.salary.executive" : "cf.income.salary";
      const annual0 = boxValue(sal.annual) ?? yen(0);
      const bonus0 = boxValue(sal.bonus) ?? yen(0);
      const commuting = boxValue(sal.commutingMonthly) ?? yen(0);
      const bonusMonths = [...(sal.bonusMonths ?? DEFAULT_BONUS_MONTHS)].sort((a, b) => a - b);
      // 入力の額は「期間の最初の年（計算基準年より前なら計算基準年）」の額。その後の年は賃金上昇率で伸ばす
      const refYear = Math.max(yearOf(from), baseYear);
      const curveId = sal.growth?.curve;
      const curve = curveId === undefined ? null : (ctx.at(monthIndex(refYear, 1)).paramBrackets(curveId) ?? null);
      const own = sal.growth?.rate === undefined ? null : ctx.rate.add(RATE_ONE, ctx.rate.of(sal.growth.rate));
      let annual = annual0;
      let bonus = bonus0;
      const grown = new Map<number, [Yen, Yen]>();
      for (let y = yearOf(start); y <= yearOf(stop); y++) {
        if (y > refYear) {
          let g = own ?? ctx.rate.add(RATE_ONE, ctx.assumption("wageGrowth", y, rate("0")));
          if (curve !== null) g = ctx.rate.mul(g, ctx.rate.div(coefficient(curve, y - birthYear), coefficient(curve, y - 1 - birthYear)));
          annual = ctx.money.mulRate(annual, g, "conv.salary.growth");
          bonus = ctx.money.mulRate(bonus, g, "conv.salary.growth");
        }
        grown.set(y, [annual, bonus]);
      }
      for (let y = yearOf(start); y <= yearOf(stop); y++) {
        const [a, b] = grown.get(y) as [Yen, Yen];
        // 年額を12か月に分ける（端数は12月）。賞与は支給月で等分（端数は最後の支給月）
        const monthly = ctx.money.allocate(a, [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1], "conv.salary.monthly", "last");
        const bonusParts = b > 0 ? ctx.money.allocate(b, bonusMonths.map(() => 1), "conv.salary.monthly", "last") : [];
        for (let m = 1; m <= 12; m++) {
          const month = monthIndex(y, m);
          if (month < start || month > stop) continue;
          const bi = bonusMonths.indexOf(m);
          const bonusAmount = shock(month, bi >= 0 && b > 0 ? (bonusParts[bi] as Yen) : yen(0));
          const salary = shock(month, monthly[m - 1] as Yen);
          const ym = formatYm(month);
          payments.push({ ym, period: p.id, salary, bonus: bonusAmount, commuting });
          if (salary > 0) {
            flows.push({ row, ym, amount: salary, accrualYear: y, member: input.member, object: p.id, formula: "income.salary.monthly" });
          }
          if (bonusAmount > 0) {
            flows.push({ row, ym, amount: bonusAmount, accrualYear: y, member: input.member, object: p.id, formula: "income.salary.bonus" });
          }
        }
      }
    }
    payments.sort((x, y) => (x.ym < y.ym ? -1 : x.ym > y.ym ? 1 : 0));
    return { flows, payments };
  },
});
