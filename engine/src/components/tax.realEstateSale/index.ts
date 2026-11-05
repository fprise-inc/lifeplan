// 住まい以外の不動産を売ったときの譲渡所得（土地建物等の分離課税。租税特別措置法31条・32条）と税（0081）。
// - 名義の人×売った年ごとに、物件の譲渡所得（asset.realEstate の sale.gain。売却価格−〔取得費＋売却の費用〕）を長期と短期に分けて足す。
//   短期の損失は長期から、長期の損失は短期から引く（措置法31条1項・32条1項のかっこ書き）。引ききれない損失はほかの所得と通算せず、
//   繰り越さない（措置法31条1項後段・32条1項後段。損失は生じなかったものとみなす）。居住用の譲渡損失の特例は対象外
// - ほかの所得の損失は土地建物等の譲渡所得から引かない（措置法31条3項2号の読み替えで、損益通算の相手から長期譲渡所得を除く）
// - 課税長期・短期譲渡所得金額は1,000円未満を切り捨て（incomeTax.taxableIncome.rounding）、所得税＝短期×30%＋長期×15%（制度データ）、
//   復興特別所得税・防衛特別所得税はその額に率を掛けて足し、100円未満を切り捨てる。翌年3月（確定申告）に cf.taxSi.incomeTax.realEstateSale
// - 住民税＝（1,000円未満を切り捨てた額）×（短期9%・長期5%）を、翌年度の普通徴収の納期（6月・8月・10月・翌年1月。端数は最初の納期）に
//   cf.taxSi.residentTax.realEstateSale（売った年の翌年度の住民税。residentTax.annual の年のずれと同じ）
// - 仮の規約（知らせ N_ASSUMED realEstate.saleTaxSimplified）: 総所得金額から引ききれない所得控除を譲渡所得から引く扱い（措置法31条3項3号）、
//   特別控除・買換え・取得費加算などの特例、ほかの所得と合わせた申告での端数の処理、給与からの特別徴収は扱わない
// - 改訂2（0123）: 貸していない不動産の売る予定（asset.heldSale の土地建物等の分離課税の売却）の譲渡所得も、同じ名義の人×年に足す
//   （知らせは N_ASSUMED heldAsset.saleTaxSimplified）。売る予定の無い世帯の結果は同じ
import {
  defineComponent,
  formatYm,
  monthIndex,
  yen,
  type Flow,
  type HeldSaleOutput,
  type RealEstateOutput,
  type RealEstateSaleTaxOutput,
  type Yen,
} from "../../sdk/index.ts";

const P = {
  itLong: "incomeTax.landBuilding.longTerm.rate",
  itShort: "incomeTax.landBuilding.shortTerm.rate",
  rtLong: "residentTax.landBuilding.longTerm.rate",
  rtShort: "residentTax.landBuilding.shortTerm.rate",
  recon: "incomeTax.reconstructionSurtax.rate",
  defense: "incomeTax.defenseSurtax.rate",
  itTaxable: "incomeTax.taxableIncome.rounding",
  surtax: "incomeTax.surtax.rounding",
  itAmount: "incomeTax.taxAmount.rounding",
  rtTaxable: "residentTax.taxableIncome.rounding",
  rtLevy: "residentTax.incomeLevy.rounding",
  ordinary: "residentTax.installment.ordinary.rounding",
};

export default defineComponent<Record<string, never>, RealEstateSaleTaxOutput>({
  id: "tax.realEstateSale",
  title: "住まい以外の不動産の譲渡所得の税（分離課税）",
  contract: "1.0",
  revision: 2,
  requires: { "asset.realEstate": ">=1 <2", "asset.heldSale": ">=1 <2" },
  params: Object.values(P),
  reads: [],
  input: "empty.input",
  output: "tax.realEstateSale.output",
  compute(_input, ctx) {
    const sums = new Map<string, { member: string; year: number; short: number; long: number; objects: string[]; held: string[] }>();
    const add = (owner: string, object: string, s: { ym: string; gain?: Yen; term?: "long" | "short" }, held: boolean) => {
      if (s.gain === undefined || s.term === undefined) return;
      const year = Number(s.ym.slice(0, 4));
      const k = `${owner}|${year}`;
      const x = sums.get(k) ?? { member: owner, year, short: 0, long: 0, objects: [], held: [] };
      if (s.term === "long") x.long += s.gain;
      else x.short += s.gain;
      (held ? x.held : x.objects).push(object);
      sums.set(k, x);
    };
    for (const p of ctx.call<RealEstateOutput>("asset.realEstate", {}).properties) if (p.sale !== null) add(p.owner, p.object, p.sale, false);
    // 貸していない不動産の売る予定（0123）
    for (const s of ctx.call<HeldSaleOutput>("asset.heldSale", {}).sales) if (s.taxation === "landBuilding") add(s.owner, s.object, s, true);
    const flows: Flow[] = [];
    const byMember: RealEstateSaleTaxOutput["byMember"][number][] = [];
    let missing = false;
    for (const x of [...sums.values()].sort((a, b) => (a.member < b.member ? -1 : a.member > b.member ? 1 : a.year - b.year))) {
      for (const o of x.objects) ctx.notice("N_ASSUMED", [o, "realEstate.saleTaxSimplified"]);
      for (const o of x.held) ctx.notice("N_ASSUMED", [o, "heldAsset.saleTaxSimplified"]);
      // 短期と長期の間で損失を引く（引ききれない損失は無かったものとみなす）
      let short = x.short;
      let long = x.long;
      if (short < 0 && long > 0) {
        long = Math.max(0, long + short);
        short = 0;
      } else if (long < 0 && short > 0) {
        short = Math.max(0, short + long);
        long = 0;
      }
      const s = yen(Math.max(0, short));
      const l = yen(Math.max(0, long));
      const at = ctx.at(monthIndex(x.year, 1));
      let incomeTax = yen(0);
      let residentTax = yen(0);
      if (s + l > 0) {
        const r = { itLong: at.paramRate(P.itLong), itShort: at.paramRate(P.itShort), rtLong: at.paramRate(P.rtLong), rtShort: at.paramRate(P.rtShort) };
        if (r.itLong === null || r.itShort === null || r.rtLong === null || r.rtShort === null) {
          missing = true;
        } else {
          // 所得税（基準所得税額に復興特別所得税・防衛特別所得税を足し、100円未満を切り捨て）
          const part = (v: Yen, rate: typeof r.itLong) => (v > 0 ? ctx.money.mulRate(at.money.round(v, P.itTaxable), rate as NonNullable<typeof rate>, "conv.tax.exact") : yen(0));
          const base = yen(part(s, r.itShort) + part(l, r.itLong));
          const surtax = (id: string): Yen => {
            const rr = at.paramRate(id);
            return rr === null ? yen(0) : at.money.mulRate(base, rr, P.surtax);
          };
          incomeTax = at.money.round(yen(base + surtax(P.recon) + surtax(P.defense)), P.itAmount);
          // 住民税（翌年度。普通徴収の納期に分ける）
          const rat = ctx.at(monthIndex(x.year + 1, 6));
          const rpart = (v: Yen, rate: typeof r.rtLong) => (v > 0 ? ctx.money.mulRate(rat.money.round(v, P.rtTaxable), rate as NonNullable<typeof rate>, "conv.tax.exact") : yen(0));
          residentTax = rat.money.round(yen(rpart(s, r.rtShort) + rpart(l, r.rtLong)), P.rtLevy);
          if (incomeTax > 0) flows.push({ row: "cf.taxSi.incomeTax.realEstateSale", ym: formatYm(monthIndex(x.year + 1, 3)), amount: incomeTax, accrualYear: x.year, member: x.member, formula: "tax.realEstateSale.incomeTax" });
          if (residentTax > 0) {
            const ms = [monthIndex(x.year + 1, 6), monthIndex(x.year + 1, 8), monthIndex(x.year + 1, 10), monthIndex(x.year + 2, 1)];
            const parts = rat.money.allocate(residentTax, ms.map(() => 1), P.ordinary, "first");
            ms.forEach((m, i) => {
              const a = parts[i] as Yen;
              if (a > 0) flows.push({ row: "cf.taxSi.residentTax.realEstateSale", ym: formatYm(m), amount: a, accrualYear: x.year, member: x.member, formula: "tax.realEstateSale.residentTax" });
            });
          }
        }
      }
      byMember.push({ member: x.member, year: x.year, short: s, long: l, incomeTax, residentTax });
    }
    if (missing) ctx.notice("N_PARAM_MISSING", [P.itLong, P.itShort, P.rtLong, P.rtShort]);
    return { flows, byMember };
  },
});
