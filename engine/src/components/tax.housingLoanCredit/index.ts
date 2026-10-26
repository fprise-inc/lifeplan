// 住宅借入金等特別控除（住宅ローン控除）の額（構成員×年分）。所得税の税額控除の差し込み口（incomeTax.annual）と、
// 住民税の住宅借入金等特別税額控除（residentTax.annual。所得税から引ききれなかった分を、上限まで翌年度の住民税から）に渡す。
// - 対象: 構成員が主債務者・連帯債務者の住宅ローン（debt.housing があり creditDisabled でない）。入居の年から控除期間（新築・既存と住宅の種類で
//   決まる年数）の間で、その年の12月31日に住んでいる年（housing.residence の住まいの期間）。合計所得金額が上限以下の年
//   （tax.incomeWithin。上限の判定だけを読む）。返済の期間（最初の返済から返し終えるまで）が10年未満になったら（繰上返済）、その年から受けない
// - 額: 年末残高×負担割合（連帯債務の share。主債務者だけなら1）を、取得対価×持分で止め、ローンを合わせて借入限度額で止めて控除率を掛け、
//   100円未満を切り捨てる。借入限度額・控除率・控除期間は入居の年月で選ぶ（basis anchor moveIn）。子育て世帯・若者夫婦世帯の上乗せは
//   入居の年の12月31日に40歳未満で配偶者がいる・40歳未満の配偶者がいる・19歳未満の扶養親族がいるか（子の構成員のうち、その年の合計所得金額が
//   扶養親族の所得の要件（incomeTax.dependentIncomeLimit）以下の子。tax.incomeWithin。改訂2）。
//   令和3年以前の入居など値の無い年は計算せず N_PARAM_MISSING で知らせる
// - 入居の年は確定申告で受ける（firstYear。還付は翌年3月。0003）。2年目からは年末調整で受ける（incomeTax.annual が判定）
// - 約束の版 1.1: 住民税の控除の上限の基礎に足す額の差し引き（residentBasicOffset。居住年が平成28年〜令和7年のとき48万円。地方税法附則5条の4）を添える
// 改訂3: 世帯の外の家族（0035 の4）の子は子育ての特例に数えない
import {
  ageMonth,
  defineComponent,
  isOutside,
  monthIndex,
  yearOf,
  yen,
  type DebtInput,
  type DebtScheduleOutput,
  type HousingLoanCreditOutput,
  type MemberInput,
  type RelationInput,
  type ResidenceInput,
  type Yen,
} from "../../sdk/index.ts";

const C = "incomeTax.housingLoanCredit";
const P = {
  rate: `${C}.rate`,
  income: `${C}.incomeLimit`,
  rounding: `${C}.rounding`,
  young: `${C}.childRearing.youngCoupleAge`,
  child: `${C}.childRearing.childAge`,
  residentRate: "residentTax.housingLoanCredit.rate",
  residentLimit: "residentTax.housingLoanCredit.limit",
  residentOffset: "residentTax.housingLoanCredit.basicDeductionOffset",
  dependentLimit: "incomeTax.dependentIncomeLimit",
};
const LIMITS = [
  "new.certified",
  "new.zeh",
  "new.energySaving",
  "new.other",
  "used.certified",
  "used.energySaving",
].flatMap((k) => [`${C}.limit.${k}`, `${C}.limit.${k}.childRearing`]);
const PERIODS = ["new", "newOther", "used", "usedOther"].map((k) => `${C}.period.${k}`);
/** 返済の期間がこれ未満になったら受けない（月） */
const MIN_TERM_MONTHS = 120;
const NONE: HousingLoanCreditOutput = { credit: yen(0), firstYear: false, residentRate: null, residentLimit: null };

export default defineComponent<{ member: string; year: number }, HousingLoanCreditOutput>({
  id: "tax.housingLoanCredit",
  title: "住宅借入金等特別控除",
  contract: "1.1",
  revision: 3,
  requires: { "debt.schedule": ">=1 <2", "tax.incomeWithin": ">=1 <2" },
  params: [...Object.values(P), ...LIMITS, `${C}.limit.used.other`, ...PERIODS],
  reads: ["member.outside", "debt.kind", "debt.debtors", "debt.housing", "residence.to", "member.kind", "member.birth", "relation.type", "relation.a", "relation.b"],
  input: "tax.memberYear.input",
  output: "tax.housingLoanCredit.output",
  compute(input, ctx) {
    const { member, year } = input;
    const loans = ctx.list<DebtInput>("debt").filter(
      (d) => d.kind === "mortgage" && d.housing !== undefined && d.housing.creditDisabled !== true && d.debtors.some((x) => x.member === member && x.role !== "guarantor"),
    );
    if (loans.length === 0) return NONE;
    const dec = monthIndex(year, 12);
    let eligible = yen(0);
    let limit: Yen | null = null;
    let rateOf: string | null = null;
    let anchor: string | null = null;
    let firstYear = false;
    for (const d of loans) {
      const h = d.housing as NonNullable<DebtInput["housing"]>;
      const moveIn = ctx.time.resolve({ event: h.moveIn });
      const moveYear = yearOf(moveIn);
      if (year < moveYear) continue;
      const at = ctx.at(dec);
      const opts = { anchorEvent: h.moveIn };
      if (!at.has(P.rate, opts) || at.paramRate(P.rate, opts) === null) {
        ctx.notice("N_PARAM_MISSING", [P.rate]);
        continue;
      }
      const other = h.propertyType === "other";
      const period = at.paramCount(`${C}.period.${h.newBuild ? (other ? "newOther" : "new") : other ? "usedOther" : "used"}`, opts) ?? 0;
      if (year > moveYear + period - 1) continue;
      // 12月31日に住んでいるか
      if (h.residence !== undefined) {
        const r = ctx.list<ResidenceInput>("residence").find((x) => x.id === h.residence);
        if (r !== undefined && r.to !== null && ctx.time.resolve(r.to) < dec) continue;
      }
      const incomeLimit = at.paramYen(P.income, opts);
      if (incomeLimit !== null && !ctx.call<{ within: boolean }>("tax.incomeWithin", { member, year, limit: incomeLimit }).within) continue;
      const rep = ctx.call<DebtScheduleOutput>("debt.schedule", { object: d.id });
      if (rep.payoff !== null && ctx.time.resolve({ at: rep.payoff }) - ctx.time.resolve({ at: rep.firstPayment }) + 1 < MIN_TERM_MONTHS && yearOf(ctx.time.resolve({ at: rep.payoff })) <= year) continue;
      const balance = rep.yearEnd.find((e) => e.year === year)?.balance ?? yen(0);
      if (balance <= 0) continue;
      // 負担割合（連帯債務）
      const me = d.debtors.find((x) => x.member === member && x.role !== "guarantor") as DebtInput["debtors"][number];
      const joints = d.debtors.filter((x) => x.role === "joint");
      const shareText = me.share ?? (me.role === "primary" ? (joints.length === 0 ? "1" : null) : null);
      let share = shareText === null ? null : ctx.rate.of(shareText);
      if (share === null) {
        // 主債務者の割合を省略したときは、1から連帯債務者の割合を引いた残り
        let rest = ctx.rate.of("1");
        for (const j of joints) rest = ctx.rate.sub(rest, ctx.rate.of(j.share ?? "0"));
        share = rest;
      }
      let mine = ctx.money.mulRate(balance, share, "conv.exact");
      // 取得対価×持分で止める
      if (h.acquisitionCost !== undefined) {
        const own = h.ownership?.find((o) => o.member === member)?.share ?? (me.role === "primary" && (h.ownership ?? []).length === 0 ? "1" : "0");
        const cap = ctx.money.mulRate(h.acquisitionCost, ctx.rate.of(own), "conv.exact");
        if (mine > cap) mine = cap;
      }
      eligible = yen(eligible + mine);
      if (anchor === null) {
        anchor = h.moveIn;
        firstYear = year === moveYear;
        rateOf = at.paramRate(P.rate, opts) === null ? null : (at.param(P.rate, opts).entry.value as string);
        // 子育て世帯・若者夫婦世帯（入居の年の12月31日の現況）
        let childRearing = h.childRearing;
        if (childRearing === undefined) {
          const moveDec = monthIndex(moveYear, 12);
          const under = (id: string, ageId: string) => ageMonth(ctx, moveDec, ageId, id) > moveDec;
          const spouses = ctx
            .list<RelationInput>("relation")
            .flatMap((r) => (r.type === "spouse" && (r.a === member || r.b === member) ? [r.a === member ? r.b : r.a] : []));
          // 世帯の外の子は数えない（0035 の4）
          const kids = ctx.list<MemberInput>("member").filter((m) => m.kind === "child" && !isOutside(m) && yearOf(ctx.time.resolve({ at: m.birth.birthYearMonth })) <= moveYear);
          // 19歳未満の扶養親族（合計所得金額が扶養親族の要件以下の子）
          const depAt = ctx.at(monthIndex(moveYear, 1));
          const depLimit = depAt.has(P.dependentLimit) ? depAt.paramYen(P.dependentLimit) : null;
          const dependent = (id: string) => depLimit === null || ctx.call<{ within: boolean }>("tax.incomeWithin", { member: id, year: moveYear, limit: depLimit }).within;
          childRearing = (spouses.length > 0 && (under(member, P.young) || spouses.some((s) => under(s, P.young)))) || kids.some((k) => under(k.id, P.child) && dependent(k.id));
        }
        const key = `${C}.limit.${h.newBuild ? "new" : "used"}.${h.propertyType === "zeh" && !h.newBuild ? "certified" : h.propertyType}`;
        const id = key.endsWith(".used.other") || !childRearing ? key : `${key}.childRearing`;
        limit = at.paramYen(id, opts);
      }
    }
    if (anchor === null || limit === null || rateOf === null || eligible <= 0) return NONE;
    const at = ctx.at(dec);
    const opts = { anchorEvent: anchor };
    const base = eligible < limit ? eligible : limit;
    const credit = at.money.round(ctx.money.mulRate(base, ctx.rate.of(rateOf), "conv.exact"), P.rounding);
    const rr = at.paramRate(P.residentRate, opts);
    return {
      credit: credit > 0 ? credit : yen(0),
      firstYear,
      residentRate: rr === null ? null : (at.param(P.residentRate, opts).entry.value as string),
      residentLimit: at.paramYen(P.residentLimit, opts),
      ...(at.has(P.residentOffset, opts) && at.paramYen(P.residentOffset, opts) !== null ? { residentBasicOffset: at.paramYen(P.residentOffset, opts) as Yen } : {}),
    };
  },
});
