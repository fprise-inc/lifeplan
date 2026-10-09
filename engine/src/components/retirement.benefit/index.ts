// 退職給付（0008 の追記・6.4）: 退職一時金・確定給付企業年金（DB）・公務員の退職手当と年金払い退職給付・国民年金基金・役員退職慰労金を、構成員ごとに同じ形で持つ。
// （iDeCo・企業型DC は account.ideco、小規模企業共済は account.mutualAid。一時金の退職所得の税は、どれも tax.retirementIncome が同じ部品で計算する）
// - 勤続期間: service（省略は働き方の期間 employment の始まり〜終わり）。役員等の勤続期間: officerService（省略は働き方の期間が役員のときその期間）
// - 支給の月: paidAt（省略は勤続期間の終わりの翌月）
// - 一時金の額: amount（見込み額）。省略のとき、公務員の退職手当は 俸給月額×支給率（勤続年数・退職の理由。制度データの表。調整額は含まない）、
//   役員退職慰労金は 最終報酬月額×役員の在任年数（1年未満切り上げ）×功績倍率。DB は amount を一時金で受けた場合の額とする
// - 受け取り方（receipt）: 一時金（lumpSum）・年金（annuity）・併用（mixed。一時金の割合 lumpShare）。年金は start の月から、1年に perYear 回
//   （省略は6回。12か月を等分した月）、years 年（null は終身）。年額は annualAmount、省略は（一時金の額×(1−一時金の割合)）を予定利率で
//   years 年の年金に直した額（元利均等。予定利率0なら等分）。年金払い退職給付・国民年金基金は年金だけ（年額を入れる）
// - 国民年金基金の掛金（contributions）は社会保険料（cf.taxSi.pension.fund。社会保険料控除）。DB の本人拠出は扱わない
// - 年金は公的年金等の雑所得（tax.publicPensionIncome が annuities を読む）
// - 死亡（改訂2。万一の想定 contingency.event）: 支給の月が死亡の月より後の一時金（年金で受ける予定の分を含む）は、死亡退職金として
//   死亡の月の翌月に遺族（死亡の当時の配偶者。いなければ子）が受け取る（相続税の対象のみなし相続財産。退職所得の税をかけない。知らせ N_INHERITANCE_TAX）。
//   額は見込み額を勤続の月数（死亡の月まで÷予定の終わりまで）で按分する（公務員の退職手当の見込みは死亡の月までの勤続年数の支給率）。
//   万一の想定に死亡退職金の額（survivor.deathBenefits.retirementAllowance）を入れたときは、ここでは出さない（contingency.lumpSum が出す）。
//   受け取り中の年金は死亡の月まで。保証期間の残りは死亡の月の翌月に一時金で遺族へ
import {
  addMonths,
  boxValue,
  childrenOf,
  defineComponent,
  parseYm,
  spousesAt,
  formatYm,
  monthOf,
  yearOf,
  yen,
  type AnnuityPayment,
  type ContingencyEventOutput,
  type MemberInput,
  type RelationInput,
  type EmploymentPeriodInput,
  type Flow,
  type MonthIndex,
  type RetirementBenefitInput,
  type RetirementBenefitOutput,
  type RetirementReceipt,
  type Yen,
} from "../../sdk/index.ts";

const P = { age: "civilServant.retirementAllowance.rate.retirementAge", voluntary: "civilServant.retirementAllowance.rate.voluntary" };
const LUMP_ROW: Readonly<Record<string, string>> = { db: "cf.income.lumpSum.db" };
const ANNUITY_ROW: Readonly<Record<string, string>> = {
  db: "cf.income.corporatePension.db",
  civilServantPension: "cf.income.corporatePension.publicServant",
  nationalPensionFund: "cf.income.corporatePension.nationalPensionFund",
};
const ANNUITY_ONLY: ReadonlySet<string> = new Set(["civilServantPension", "nationalPensionFund"]);
const LUMP_ONLY: ReadonlySet<string> = new Set(["lumpSum", "civilServantAllowance", "officerAllowance"]);

/** b の n 乗（整数） */
function powBig(b: bigint, n: number): bigint {
  let r = 1n;
  for (let i = 0; i < n; i++) r *= b;
  return r;
}

const byYm = (a: { ym: string }, b: { ym: string }) => (a.ym < b.ym ? -1 : a.ym > b.ym ? 1 : 0);

export default defineComponent<{ member: string }, RetirementBenefitOutput>({
  id: "retirement.benefit",
  title: "退職給付（退職一時金・DB・公務員・国民年金基金・役員退職慰労金）",
  contract: "1.0",
  revision: 2,
  requires: { "contingency.event": ">=1 <2" },
  params: Object.values(P),
  reads: [
    "member.kind",
    "relation.type",
    "relation.a",
    "relation.b",
    "relation.from",
    "relation.to",
    "relation.parent",
    "relation.child",
    "retirementBenefit.member",
    "retirementBenefit.kind",
    "retirementBenefit.employment",
    "retirementBenefit.service",
    "retirementBenefit.officerService",
    "retirementBenefit.paidAt",
    "retirementBenefit.amount",
    "retirementBenefit.estimate",
    "retirementBenefit.receipt",
    "retirementBenefit.contributions",
    "retirementBenefit.disability",
    "employment.member",
    "employment.from",
    "employment.to",
    "employment.type",
  ],
  memberScope: ["retirementBenefit", "employment"],
  input: "member.input",
  output: "retirement.benefit.output",
  compute(input, ctx) {
    const member = input.member;
    const { base, end } = ctx.time;
    const benefits = ctx.list<RetirementBenefitInput>("retirementBenefit");
    if (benefits.length === 0) return { flows: [], receipts: [], annuities: [], fundPaid: [] };
    const periods = ctx.list<EmploymentPeriodInput>("employment");
    // 万一の想定の死亡の月と、死亡退職金を受け取る遺族
    const ev = ctx.call<ContingencyEventOutput>("contingency.event", { member }).event;
    const death = ev !== null && ev.kind === "death" ? parseYm(ev.month) : null;
    const given = ev?.survivor?.deathBenefits?.retirementAllowance !== undefined;
    let heir = member;
    if (death !== null) {
      const relations = ctx.list<RelationInput>("relation");
      heir = spousesAt(ctx, relations, member, death)[0] ?? childrenOf(ctx.list<MemberInput>("member"), relations, member)[0]?.id ?? member;
    }
    const flows: Flow[] = [];
    const receipts: RetirementReceipt[] = [];
    const annuities: AnnuityPayment[] = [];
    const fundPaid: AnnuityPayment[] = [];
    const push = (m: MonthIndex, row: string, amount: Yen, object: string, formula: string, to: string = member) => {
      if (amount > 0 && m >= base && m <= end) flows.push({ row, ym: formatYm(m), amount, accrualYear: yearOf(m), member: to, object, formula });
    };
    for (const b of benefits) {
      const per = b.employment === undefined ? undefined : periods.find((p) => p.id === b.employment);
      const sFrom: MonthIndex | null = b.service !== undefined ? ctx.time.resolve(b.service.from) : per !== undefined ? ctx.time.resolve(per.from) : null;
      const sTo: MonthIndex | null = b.service !== undefined ? ctx.time.resolve(b.service.to) : per !== undefined && per.to !== null ? ctx.time.resolve(per.to) : null;
      const oFrom = b.officerService !== undefined ? ctx.time.resolve(b.officerService.from) : per?.type === "executive" ? sFrom : null;
      const oTo = b.officerService !== undefined ? ctx.time.resolve(b.officerService.to) : per?.type === "executive" ? sTo : null;
      const paidAt: MonthIndex | null = b.paidAt !== undefined ? ctx.time.resolve(b.paidAt) : sTo === null ? null : addMonths(sTo, 1);
      // 国民年金基金の掛金
      if (b.contributions !== undefined) {
        const from = ctx.time.resolve(b.contributions.from);
        const to0 = b.contributions.to === undefined || b.contributions.to === null ? end : ctx.time.resolve(b.contributions.to);
        const to = death !== null && death < to0 ? death : to0;
        for (let m = from < base ? base : from; m <= to && m <= end; m = addMonths(m, 1)) {
          if (b.contributions.monthly <= 0) break;
          fundPaid.push({ ym: formatYm(m), amount: b.contributions.monthly, object: b.id });
          push(m, "cf.taxSi.pension.fund", b.contributions.monthly, b.id, "retirement.benefit.fundContribution");
        }
      }
      // 一時金の額（見込み額。無ければ見込みの計算）
      let lump: Yen | null = boxValue(b.amount) ?? null;
      const months = sFrom !== null && sTo !== null && sTo >= sFrom ? sTo - sFrom + 1 : 0;
      if (lump === null && b.kind === "civilServantAllowance" && b.estimate?.finalMonthly !== undefined && paidAt !== null && months > 0) {
        const years = Math.ceil(months / 12);
        const id = b.estimate.reason === "voluntary" ? P.voluntary : P.age;
        const table = ctx.at(paidAt < base ? base : paidAt).paramBrackets(id) ?? [];
        const row = table.find((r) => r.upTo === null || years <= r.upTo);
        if (row?.rate !== undefined) lump = ctx.money.mulRate(b.estimate.finalMonthly, row.rate, "conv.retirement.estimate");
        else ctx.notice("N_INPUT_REQUIRED", [b.id, "retirementBenefit.amount"]);
        ctx.notice("N_NOT_SUPPORTED", ["civilServant.retirementAllowance.adjustmentAmount"]);
      }
      if (lump === null && b.kind === "officerAllowance" && b.estimate?.finalMonthly !== undefined && b.estimate.multiplier !== undefined && oFrom !== null && oTo !== null) {
        const years = Math.ceil((oTo - oFrom + 1) / 12);
        lump = ctx.money.mulRate(ctx.money.mulRatio(b.estimate.finalMonthly, years, 1, "conv.exact"), ctx.rate.of(b.estimate.multiplier), "conv.retirement.estimate");
      }
      const method = ANNUITY_ONLY.has(b.kind) ? "annuity" : LUMP_ONLY.has(b.kind) ? "lumpSum" : (b.receipt?.method ?? "lumpSum");
      if (lump === null && !(method === "annuity" && b.receipt?.annualAmount !== undefined)) {
        ctx.notice("N_INPUT_REQUIRED", [b.id, "retirementBenefit.amount"]);
        continue;
      }
      let total = lump ?? yen(0);
      // 死亡退職金: 支給の月が死亡の月より後の一時金（年金で受ける予定の分を含む）
      if (death !== null && paidAt !== null && paidAt > death && b.kind !== "civilServantPension" && b.kind !== "nationalPensionFund") {
        if (given) continue;
        // 見込み額は勤続の月数で按分（公務員の退職手当の見込みは、勤続期間が死亡の月で終わる働き方の期間から計算済み）
        if (boxValue(b.amount) !== null && boxValue(b.amount) !== undefined && sFrom !== null && sTo !== null && sTo > death && death >= sFrom) {
          total = ctx.money.mulRatio(total, death - sFrom + 1, sTo - sFrom + 1, "conv.retirement.estimate");
        }
        push(addMonths(death, 1), "cf.income.lumpSum.retirement", total, b.id, "retirement.benefit.deathAllowance", heir);
        if (total > 0) ctx.notice("N_INHERITANCE_TAX", ["retirementBenefit.deathAllowance", b.id]);
        continue;
      }
      const lumpPart = method === "lumpSum" ? total : method === "mixed" ? ctx.money.mulRate(total, ctx.rate.of(b.receipt?.lumpShare ?? "0"), "conv.retirement.annuity") : yen(0);
      if (lumpPart > 0 && paidAt !== null) {
        push(paidAt, LUMP_ROW[b.kind] ?? "cf.income.lumpSum.retirement", lumpPart, b.id, `retirement.benefit.lumpSum.${b.kind}`);
        receipts.push({
          ym: formatYm(paidAt),
          amount: lumpPart,
          object: b.id,
          source: "retirement",
          serviceFrom: formatYm(sFrom ?? paidAt),
          serviceTo: formatYm(sTo ?? addMonths(paidAt, -1)),
          ...(oFrom !== null && oTo !== null ? { officerFrom: formatYm(oFrom), officerTo: formatYm(oTo) } : {}),
          ...(b.disability === true ? { disability: true } : {}),
        });
      }
      if (method === "lumpSum") continue;
      // 年金
      const start = b.receipt?.start !== undefined ? ctx.time.resolve(b.receipt.start) : paidAt;
      if (start === null) continue;
      const years = b.receipt?.years ?? null;
      let annual: Yen;
      if (b.receipt?.annualAmount !== undefined) annual = b.receipt.annualAmount;
      else if (years === null) {
        ctx.notice("N_INPUT_REQUIRED", [b.id, "retirementBenefit.receipt.annualAmount"]);
        continue;
      } else {
        const pv = yen(total - lumpPart);
        const f = ctx.rate.fraction(ctx.rate.of(b.receipt?.conversionRate ?? "0"));
        if (f.num === 0n) annual = ctx.money.divInt(pv, years, "conv.retirement.annuity");
        else {
          // 元利均等の年額: PV×r×(1+r)^n÷((1+r)^n−1)（r＝num/den）
          const q = powBig(f.den + f.num, years);
          const d = powBig(f.den, years);
          annual = ctx.money.mulRatio(pv, f.num * q, f.den * (q - d), "conv.retirement.annuity");
        }
      }
      const perYear = b.receipt?.perYear ?? 6;
      const parts = ctx.money.allocate(annual, Array.from({ length: perYear }, () => 1), "conv.retirement.annuity", "first");
      const stop = years === null ? end : addMonths(start, 12 * years - 1);
      // 死亡の後は止まり、保証期間の残りは死亡の月の翌月に一時金で遺族へ
      const guaranteeEnd = b.receipt?.guaranteeYears === undefined ? null : addMonths(start, 12 * b.receipt.guaranteeYears - 1);
      let guaranteed = yen(0);
      for (let m = start; m <= stop && m <= end; m = addMonths(m, 12 / perYear)) {
        const k = Math.floor(((monthOf(m) - monthOf(start) + 12) % 12) / (12 / perYear));
        const amount = parts[k] as Yen;
        if (death !== null && m > death) {
          if (guaranteeEnd !== null && m <= guaranteeEnd) guaranteed = yen(guaranteed + amount);
          continue;
        }
        annuities.push({ ym: formatYm(m), amount, object: b.id });
        push(m, ANNUITY_ROW[b.kind] ?? "cf.income.corporatePension.db", amount, b.id, `retirement.benefit.annuity.${b.kind}`);
      }
      if (death !== null && guaranteed > 0) {
        push(addMonths(death, 1), "cf.income.lumpSum.retirement", guaranteed, b.id, "retirement.benefit.guaranteeRemainder", heir);
        ctx.notice("N_INHERITANCE_TAX", ["retirementBenefit.guaranteeRemainder", b.id]);
      }
    }
    receipts.sort(byYm);
    annuities.sort(byYm);
    fundPaid.sort(byYm);
    return { flows, receipts, annuities, fundPaid };
  },
});
