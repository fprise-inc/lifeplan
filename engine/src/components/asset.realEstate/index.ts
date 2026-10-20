// 住まい以外の不動産（不動産の器のうち中身 property を入れたもの）の評価額・家賃収入・経費・不動産所得・売却（0028）。
// - 評価額: 器の時価（asOf の時点の土地と建物の合計）を土地の割合（property.landShare → 前提 realEstateValuation.landShare → 目安 0.3。目安を
//   使ったら知らせ N_DEFAULT_USED）で分け、持ち家と同じ決まり（0025 の2。sdk の landBuildingValuer）で、土地は上昇率（器の valueGrowth →
//   前提 landGrowth → 物価上昇率）、建物は構造の耐用年数で定額で減らす。建った年の省略は取得の年（取得も無ければ時価の時点の年＝新築）
// - 家賃収入（cf.income.other.rental）: 貸している月ごとに、月額の家賃×(1−空室を見込む割合)。家賃は貸し始めの年（計算基準年より前なら
//   計算基準年）の額で、その後の年は家賃の変化率で動かす（省略は0）
// - 経費（cf.expense.other.realEstate）: 年額（持っている間。12か月に分ける。変化率の省略は0）と、受け取る家賃×割合（管理委託料など）の合計
// - 不動産所得（年ごと。名義の人。tax.totalIncome が合計所得金額に入れる）＝家賃収入−経費（貸している月の分）−減価償却費−借入の利息
//   - 減価償却費: 建物の取得価額（取得価額×(1−土地の割合)）×定額法の償却率（1÷耐用年数を小数3桁に切り上げ）。耐用年数は法定（木造22・
//     軽量鉄骨19・重量鉄骨34・鉄筋コンクリート47年）、中古（建った年が取得の年より前）は簡便法（経過年数を年で数え、全部過ぎていれば法定×0.2、
//     一部なら法定−経過＋経過×0.2。端数は切り捨て、2年未満は2年）。貸し始め（取得の月が後ならその月）から貸している月数で月割りし、
//     帳簿の残りが1円になるまで。取得の入力が無ければ減価償却費を入れない（知らせ N_INPUT_REQUIRED）
//   - 借入の利息: この不動産を指す負債（debt.property）の年ごとの利息（debt.schedule）の、貸している月数の分。土地の取得のための分（借入額の
//     うち建物の取得価額を超える分の割合。借入は建物から先に充てたとみなす）を landInterest として添える（損失のときに引けない分。tax.totalIncome）
// - 売却（property.sale）: その月に、売却価格（省略はその年の評価額）から売却の費用（割合 sale.costRate → 前提 saleCostRate → 目安 0.04）を
//   引いた手取りを、名義の人の一時金の収入（cf.income.lumpSum.realEstateSale）にする。売った年の年末には持っていない。貸すのは前の月まで。
//   譲渡所得の税は計算しない（知らせ N_NOT_SUPPORTED realEstate.saleTax）。借入の残りは返済の予定のまま（売るときに返すなら繰上返済で入れる）
// 計算基準年の2年前から計算する（前の年の所得で決まる住民税・国民健康保険料のため。お金の動きは計算基準月から）
import {
  addMonths,
  addYen,
  boxValue,
  defineComponent,
  formatYm,
  landBuildingValuer,
  LAND_SHARE,
  monthIndex,
  RATE_ONE,
  RATE_ZERO,
  SALE_COST_RATE,
  yearOf,
  yen,
  type AccountInput,
  type BuildingStructure,
  type DebtInput,
  type DebtScheduleOutput,
  type Flow,
  type MonthIndex,
  type Rate,
  type RealEstateOutput,
  type RealEstateValuationSetting,
  type Yen,
} from "../../sdk/index.ts";

/** 減価償却の法定耐用年数（住宅用の建物。減価償却資産の耐用年数等に関する省令の別表第一） */
export const TAX_USEFUL_LIFE: Readonly<Record<BuildingStructure, number>> = { wood: 22, lightSteel: 19, steel: 34, rc: 47 };

/** 中古の建物の耐用年数（簡便法。経過年数は年で数える） */
export function usedLife(life: number, elapsed: number): number {
  if (elapsed <= 0) return life;
  // 0.2 を掛けて端数を切り捨てる＝5で割って切り捨てる
  const y = elapsed >= life ? Math.floor(life / 5) : life - elapsed + Math.floor(elapsed / 5);
  return Math.max(2, y);
}

/** 定額法の償却率（1÷耐用年数を小数3桁に切り上げ。率の文字列） */
export function straightLineRate(life: number): string {
  const k = Math.ceil(1000 / life);
  return k >= 1000 ? "1" : `0.${String(k).padStart(3, "0")}`;
}

const RENT = "conv.realEstate.rent";
const DEP = "conv.realEstate.depreciation";
const VAL = "conv.asset.valuation";

const minM = (a: MonthIndex, b: MonthIndex): MonthIndex => (a < b ? a : b);
const maxM = (a: MonthIndex, b: MonthIndex): MonthIndex => (a > b ? a : b);

/** 年の中で lo〜hi（両端を含む）に入る月の数 */
function monthsIn(y: number, lo: MonthIndex, hi: MonthIndex): number {
  const a = Math.max(lo, monthIndex(y, 1));
  const b = Math.min(hi, monthIndex(y, 12));
  return b >= a ? b - a + 1 : 0;
}

export default defineComponent<Record<string, never>, RealEstateOutput>({
  id: "asset.realEstate",
  title: "住まい以外の不動産（評価額・家賃収入・経費・不動産所得・売却）",
  contract: "1.0",
  revision: 1,
  requires: { "debt.schedule": ">=1 <2" },
  params: [],
  reads: ["account.kind", "account.owner", "account.marketValue", "account.asOf", "account.valueGrowth", "account.property", "debt.property", "debt.principal", "assumptions.inflation", "assumptions.realEstateValuation"],
  input: "empty.input",
  output: "asset.realEstate.output",
  compute(_input, ctx) {
    const { base, end } = ctx.time;
    const baseYear = yearOf(base);
    const endYear = yearOf(end);
    const calcStart = monthIndex(baseYear - 2, 1);
    const setting = ctx.setting<RealEstateValuationSetting>("realEstateValuation");
    const flows: Flow[] = [];
    const properties: RealEstateOutput["properties"][number][] = [];
    const debts = ctx.list<Pick<DebtInput, "id" | "property" | "principal">>("debt");
    for (const a of ctx.list<AccountInput>("account")) {
      const p = a.property;
      if (a.kind !== "realEstate" || p === undefined) continue;
      const owner = a.owner;
      const push = (m: MonthIndex, row: string, amount: Yen, formula: string) => {
        if (amount <= 0 || m < base || m > end) return;
        flows.push({ row, ym: formatYm(m), amount, accrualYear: yearOf(m), member: owner, object: a.id, formula });
      };
      // 評価額（土地と建物）
      const basis = boxValue(a.marketValue) ?? yen(0);
      const y0 = yearOf(ctx.time.resolve({ at: a.asOf }));
      const acqAt: MonthIndex | null = p.acquisition === undefined ? null : ctx.time.resolve({ at: p.acquisition.at });
      const shareText = p.landShare ?? setting?.landShare;
      if (shareText === undefined) ctx.notice("N_DEFAULT_USED", [a.id, "account.property.landShare"]);
      const share = shareText ?? LAND_SHARE;
      const structure = p.structure ?? "wood";
      const built = p.builtYear ?? (acqAt === null ? y0 : yearOf(acqAt));
      const growthOf = (y: number): Rate => (a.valueGrowth !== undefined ? ctx.rate.of(a.valueGrowth) : (ctx.assumptionIn("realEstateValuation", "landGrowth", y) ?? ctx.assumption("inflation", y, RATE_ZERO)));
      const valuer = landBuildingValuer(ctx, { basis, y0, share, structure, builtYear: built, setting, growthOf });
      const saleAt: MonthIndex | null = p.sale === undefined ? null : ctx.time.resolve(p.sale.at);
      const sold = saleAt !== null && saleAt <= end;
      // 持っている最後の月（売るならその前の月）
      const holdEnd: MonthIndex = sold && saleAt !== null ? addMonths(saleAt, -1) : end;
      const years: { year: number; land: Yen; building: Yen; value: Yen }[] = [];
      if (holdEnd >= base) {
        for (let y = baseYear; y <= endYear; y++) {
          if (monthIndex(y, 12) > holdEnd) break;
          const { land, building } = valuer.at(y);
          years.push({ year: y, land, building, value: addYen(land, building) });
        }
      }
      let sale: RealEstateOutput["properties"][number]["sale"] = null;
      if (sold && saleAt !== null && saleAt >= base) {
        const y = yearOf(saleAt);
        const lb = valuer.at(y);
        const value = addYen(lb.land, lb.building);
        const price = p.sale?.price ?? value;
        const costs = ctx.money.mulRate(price, ctx.rate.of(p.sale?.costRate ?? setting?.saleCostRate ?? SALE_COST_RATE), VAL);
        const proceeds = yen(Math.max(0, price - costs));
        sale = { ym: formatYm(saleAt), value, price, costs, proceeds };
        if (proceeds > 0) flows.push({ row: "cf.income.lumpSum.realEstateSale", ym: formatYm(saleAt), amount: proceeds, accrualYear: y, member: owner, object: a.id, formula: "asset.realEstate.sale" });
        ctx.notice("N_NOT_SUPPORTED", ["realEstate.saleTax"]);
      }

      // 貸している月（rFrom〜rTo。計算は計算基準年の2年前から）
      const r = p.rental;
      const rFrom: MonthIndex | null = r === undefined ? null : r.from !== undefined ? ctx.time.resolve(r.from) : (acqAt ?? calcStart);
      const rTo: MonthIndex | null = r === undefined ? null : r.to === undefined || r.to === null ? holdEnd : minM(ctx.time.resolve(r.to), holdEnd);
      const rented = (y: number) => (rFrom === null || rTo === null ? 0 : monthsIn(y, maxM(rFrom, calcStart), rTo));
      const keep = ctx.rate.sub(RATE_ONE, ctx.rate.of(r?.vacancyRate ?? "0"));
      const rentGrowth = ctx.rate.of(r?.growth ?? "0");
      const rentRef = rFrom === null ? baseYear : Math.max(yearOf(rFrom), baseYear);
      let rentMonthly = r === undefined ? yen(0) : (boxValue(r.monthly) ?? yen(0));
      let rentYear = rentRef;
      const rentFor = (y: number): Yen => {
        while (rentYear < y) {
          rentYear++;
          if (ctx.rate.compare(rentGrowth, RATE_ZERO) !== 0) rentMonthly = addYen(rentMonthly, ctx.money.mulRate(rentMonthly, rentGrowth, RENT));
        }
        return rentMonthly;
      };
      const e = p.expenses;
      const fixed0 = e?.annual === undefined ? yen(0) : (boxValue(e.annual) ?? yen(0));
      const expRate = e?.rate === undefined ? null : ctx.rate.of(e.rate);
      const expGrowth = ctx.rate.of(e?.growth ?? "0");
      let fixed = fixed0;
      let fixedYear = baseYear;
      const fixedFor = (y: number): Yen => {
        while (fixedYear < y) {
          fixedYear++;
          if (ctx.rate.compare(expGrowth, RATE_ZERO) !== 0) fixed = addYen(fixed, ctx.money.mulRate(fixed, expGrowth, RENT));
        }
        return fixed;
      };
      const rentByYear = new Map<number, Yen>();
      const expByYear = new Map<number, Yen>();
      for (let y = yearOf(calcStart); y <= endYear; y++) {
        const fixedParts = fixed0 > 0 ? ctx.money.allocate(fixedFor(y), [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1], "conv.flow.allocate", "last") : null;
        const monthlyRent = r !== undefined && rFrom !== null && rTo !== null ? ctx.money.mulRate(rentFor(Math.max(y, rentRef)), keep, RENT) : yen(0);
        let rentSum = yen(0);
        let expSum = yen(0);
        for (let mo = 1; mo <= 12; mo++) {
          const m = monthIndex(y, mo);
          if (m > holdEnd) break;
          if (m < calcStart) continue;
          const isRented = rFrom !== null && rTo !== null && m >= rFrom && m <= rTo;
          let exp = fixedParts === null ? yen(0) : (fixedParts[mo - 1] as Yen);
          if (isRented && monthlyRent > 0) {
            push(m, "cf.income.other.rental", monthlyRent, "asset.realEstate.rent");
            rentSum = addYen(rentSum, monthlyRent);
            if (expRate !== null) exp = addYen(exp, ctx.money.mulRate(monthlyRent, expRate, RENT));
          }
          push(m, "cf.expense.other.realEstate", exp, "asset.realEstate.expenses");
          if (isRented) expSum = addYen(expSum, exp);
        }
        rentByYear.set(y, rentSum);
        expByYear.set(y, expSum);
      }

      // 減価償却費（貸している月数で月割り。帳簿の残りが1円になるまで）
      const depByYear = new Map<number, Yen>();
      let buildingCost: Yen | null = null;
      if (r !== undefined && p.acquisition !== undefined && acqAt !== null && rFrom !== null && rTo !== null) {
        const price = p.acquisition.price;
        buildingCost = yen(price - ctx.money.mulRate(price, ctx.rate.of(share), VAL));
        const life = usedLife(TAX_USEFUL_LIFE[structure], yearOf(acqAt) - built);
        const annual = ctx.money.mulRate(buildingCost, ctx.rate.of(straightLineRate(life)), DEP);
        const start = maxM(acqAt, rFrom);
        let book = buildingCost;
        for (let y = yearOf(start); y <= endYear && book > 1; y++) {
          const months = monthsIn(y, start, rTo);
          if (months === 0) continue;
          const d0 = months === 12 ? annual : ctx.money.mulRatio(annual, months, 12, DEP);
          const d = yen(Math.min(d0, book - 1));
          book = yen(book - d);
          if (y >= yearOf(calcStart)) depByYear.set(y, d);
        }
      } else if (r !== undefined) ctx.notice("N_INPUT_REQUIRED", [a.id, "account.property.acquisition"]);

      // 借入の利息（この不動産を指す負債。貸している月数の分）と、そのうち土地の取得のための分
      const intByYear = new Map<number, Yen>();
      const landIntByYear = new Map<number, Yen>();
      if (r !== undefined) {
        for (const d of debts) {
          if (d.property !== a.id) continue;
          const out = ctx.call<DebtScheduleOutput>("debt.schedule", { object: d.id });
          const landPart = buildingCost === null || d.principal <= 0 ? 0 : Math.max(0, d.principal - buildingCost);
          for (const x of out.interest ?? []) {
            const months = rented(x.year);
            if (months === 0 || x.amount <= 0) continue;
            const i = months === 12 ? x.amount : ctx.money.mulRatio(x.amount, months, 12, RENT);
            intByYear.set(x.year, addYen(intByYear.get(x.year) ?? yen(0), i));
            if (landPart > 0) landIntByYear.set(x.year, addYen(landIntByYear.get(x.year) ?? yen(0), ctx.money.mulRatio(i, Math.min(landPart, d.principal), d.principal, RENT)));
          }
        }
      }
      const income: RealEstateOutput["properties"][number]["income"][number][] = [];
      if (r !== undefined) {
        for (let y = yearOf(calcStart); y <= endYear; y++) {
          if (rented(y) === 0) continue;
          const rent = rentByYear.get(y) ?? yen(0);
          const expenses = expByYear.get(y) ?? yen(0);
          const depreciation = depByYear.get(y) ?? yen(0);
          const interest = intByYear.get(y) ?? yen(0);
          const landInterest = landIntByYear.get(y) ?? yen(0);
          income.push({ year: y, rent, expenses, depreciation, interest, landInterest, income: yen(rent - expenses - depreciation - interest) });
        }
      }
      properties.push({ object: a.id, owner, years, income, sale });
    }
    return { flows, properties };
  },
});
