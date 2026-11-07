// 保育料（0〜2歳。保育所・認定こども園などの保育認定）。子ごと。教育の目標の保育所の段（stage: nursery）を計算する（0029）。
// - 月額を入れた段は、その月額を教育費の上昇率で伸ばして毎月（3歳になった後の最初の4月から幼児教育・保育の無償化で0）
// - 月額を入れていない段は、世帯の収入から自動で計算する（目安）: 国の基準の上限（子ども・子育て支援法施行令4条2項。保育標準時間・短時間の表）を、
//   市町村民税所得割合算額（父母の市町村民税の所得割の合計。住宅借入金等特別税額控除などを引く前）の段階で引き、多子の軽減（13条・14条）と
//   ひとり親世帯等の軽減（4条2項6号・7号ただし書）を当て、自治体の水準として「国の基準に対する割合」（段の feeRatio。省略は目安の 0.8）を掛ける
//   - 所得割の年度: 4〜8月分は前年度、9〜3月分はその年度の住民税（施行令4条2項2号）。計算基準月に払っている住民税の年度より前にしない（改訂2）
//   - 父母がみな住民税（均等割）を課されない年度は0円（市町村民税世帯非課税者。4条2項8号）
//   - 多子の軽減: 小学校就学前で保育所・幼稚園などに通う子（負担額算定基準子ども）の年長の順で、2番目は国の基準の額×割合（0.5）、3番目以降は0円（13条）。
//     市町村民税所得割合算額が所得の上限（57,700円。ひとり親世帯等は77,101円）未満なら、年齢と通っているかを問わず世帯の子の年長の順で数える（14条。
//     ひとり親世帯等は2番目から0円）。きょうだいが通っているかは、その子の教育の目標の保育所・幼稚園の段で見る（保育所の段だけで幼稚園の段が無い子は、
//     就学まで保育所に通うとみなす）
//   - ひとり親世帯等: その月に世帯にいる子の親が1人で、その親が配偶者のない者のとき（在宅障害児のいる世帯などは扱わない）。配偶者のない者
//     （母子及び父子並びに寡婦福祉法6条1項）かは、ひとり親控除と同じ婚姻の状態の見方で決める（sdk の marriedAt。改訂5）
//   - 自動の額は制度の名目額なので、教育費の上昇率を当てない（0010 の5 と同じ考え方）。給付単価（公定価格）が上限より低い場合・自治体の独自の軽減の細部
//     （第1子からの無償化など）は扱わない。FP は月額を入れる（0 なら保育料なし）か、割合を変えて合わせる
// - 通い始め（from）の省略は、その子の育児休業（働き方の期間の leave・childcare）の終わりの翌月。育児休業の入力が無ければ1歳の学年の4月
// 改訂3: 世帯の外の家族（0035 の4）は世帯の子の数に入れない
// 改訂4（0029 の追記 2026-10-30）: 保育料とは別にかかるお金（教材・被服・保護者会・行事・通園など。段の extraAnnual。省略は統計の目安
//   education.statistics.nursery.extra）を、通い始めから3歳の4月の前の月まで毎月（年額÷12。教育費の上昇率で伸ばす）。表の行は学校の費用。
//   目安の値が無いパックでは数えない（知らせない。保育料の計算とは別の目安のため）
// 改訂5（0169）: 世帯にいる親が1人でも、その月に配偶者の関係（法律婚・事実婚。子の親でない再婚の相手も）がある親と、構成員の欄
//   maritalStatus が「婚姻している（別居など）」の親（終わった法律婚の関係が無いとき）は、ひとり親世帯等にしない（ひとり親控除の判定と同じ見方）
import {
  addMonths,
  bracketFor,
  defineComponent,
  formatYm,
  grownByYear,
  isOutside,
  marriedAt,
  monthIndex,
  monthOf,
  residentTaxYearOf,
  yearOf,
  yen,
  type Ctx,
  type EmploymentPeriodInput,
  type Flow,
  type FlowsResult,
  type GoalInput,
  type MemberInput,
  type MonthIndex,
  type RelationInput,
  type ResidentTaxOutput,
  type Yen,
} from "../../sdk/index.ts";

const N = "educationSupport.nursery";
const P = {
  standard: `${N}.fee.standard`,
  short: `${N}.fee.short`,
  specifiedLimit: `${N}.fee.specified.limit`,
  specifiedAmount: `${N}.fee.specified.amount`,
  secondRatio: `${N}.multiChild.secondRatio`,
  lowIncomeLimit: `${N}.multiChild.lowIncomeLimit`,
};
const LEVY_ROUNDING = "residentTax.incomeLevy.rounding";
/** 保育料とは別にかかるお金の年額の統計の目安（0029 の追記 2026-10-30） */
const EXTRA = "education.statistics.nursery.extra";
/** 自治体の保育料の水準（国の基準に対する割合）の目安。根拠と限界は 0029 */
export const NURSERY_FEE_RATIO_DEFAULT = "preset.education.nurseryFeeRatio";

type EmploymentLeave = Pick<EmploymentPeriodInput, "member" | "type" | "leaveKind" | "leaveChild" | "from" | "to">;
type Stage = NonNullable<GoalInput["education"]>["stages"][number];

/** 保育所の段の通い始めの月（省略はその子の育児休業の終わりの翌月、無ければ1歳の学年の4月） */
function nurseryStart(ctx: Ctx, child: string, st: Stage, members: readonly MemberInput[]): MonthIndex {
  if (st.from !== undefined) return ctx.time.resolve(st.from);
  const children = members.filter((m) => m.kind === "child");
  const birthOf = (m: MemberInput) => ctx.time.resolve({ at: m.birth.birthYearMonth });
  let end: MonthIndex | null = null;
  for (const p of ctx.list<EmploymentLeave>("employment")) {
    if (p.type !== "leave" || p.leaveKind !== "childcare" || p.to === null) continue;
    let target = p.leaveChild;
    if (target === undefined) {
      // 休業の始まりに近い子（始まりの2か月後までに生まれた子のうち、いちばん遅く生まれた子）
      const start = ctx.time.resolve(p.from);
      const cands = children.filter((c) => birthOf(c) <= addMonths(start, 2)).sort((a, b) => birthOf(b) - birthOf(a));
      target = cands[0]?.id;
    }
    if (target !== child) continue;
    const to = ctx.time.resolve(p.to);
    if (end === null || to > end) end = to;
  }
  return end !== null ? addMonths(end, 1) : ctx.time.ageSwitch(child, { years: 1 }, "schoolYear");
}

export default defineComponent<{ member: string }, FlowsResult>({
  id: "education.nurseryFee",
  title: "保育料（0〜2歳。収入から自動で計算）",
  contract: "1.0",
  revision: 5,
  requires: { "residentTax.annual": ">=1 <2" },
  params: [...Object.values(P), LEVY_ROUNDING, EXTRA],
  reads: [
    "member.outside",
    "goal.kind",
    "goal.owner",
    "goal.education",
    "member.kind",
    "member.birth",
    "member.joins",
    "member.leaves",
    "member.maritalStatus",
    "relation.type",
    "relation.parent",
    "relation.child",
    "relation.a",
    "relation.b",
    "relation.marriage",
    "relation.from",
    "relation.to",
    "employment.member",
    "employment.type",
    "employment.leaveKind",
    "employment.leaveChild",
    "employment.from",
    "employment.to",
    "assumptions.inflation",
    "assumptions.educationInflation",
  ],
  input: "member.input",
  output: "flows.output",
  compute(input, ctx) {
    const child = input.member;
    const goals = ctx.list<GoalInput>("goal").filter((g) => g.kind === "education" && g.education !== undefined);
    const own = goals.filter((g) => g.owner === child);
    if (!own.some((g) => (g.education?.stages ?? []).some((s) => s.stage === "nursery"))) return { flows: [] };
    const { base, end } = ctx.time;
    const baseYear = yearOf(base);
    const endYear = yearOf(end);
    const members = ctx.list<MemberInput>("member");
    const relations = ctx.list<RelationInput>("relation");
    const flows: Flow[] = [];
    const inHousehold = (m: MemberInput, at: MonthIndex): boolean => {
      // 世帯の外の家族は世帯にいない（0035 の4）
      if (isOutside(m)) return false;
      if (ctx.time.resolve({ at: m.birth.birthYearMonth }) > at) return false;
      if (m.joins !== null && ctx.time.resolve(m.joins) > at) return false;
      return m.leaves === null || ctx.time.resolve(m.leaves) > at;
    };
    const parentsOf = (c: string): string[] => {
      const ps = relations.filter((r): r is Extract<RelationInput, { type: "parentOf" }> => r.type === "parentOf" && r.child === c).map((r) => r.parent);
      return ps.length > 0 ? ps : members.filter((m) => m.kind === "self" || m.kind === "spouse").map((m) => m.id);
    };
    const earners = parentsOf(child);
    const byId = new Map(members.map((m) => [m.id, m]));
    // 市町村民税所得割合算額（年度ごと）と、父母がみな住民税を課されないか
    const levyCache = new Map<number, { levy: Yen; exempt: boolean }>();
    const householdLevy = (fy: number): { levy: Yen; exempt: boolean } => {
      const hit = levyCache.get(fy);
      if (hit !== undefined) return hit;
      const at = ctx.at(monthIndex(fy, 6));
      let levy = 0;
      let exempt = true;
      for (const id of earners) {
        const rt = ctx.call<ResidentTaxOutput>("residentTax.annual", { member: id, fiscalYear: fy });
        if (rt.total > 0) exempt = false;
        if (rt.assessed) {
          // 決定額だけが入っているとき: 住民税の額の10分の6（市町村民税の標準の割合）を所得割とみなす（均等割の分だけ多め）
          if (rt.total > 0) ctx.notice("N_APPROXIMATED", ["education.nurseryFee.assessedResidentTax"]);
          levy += ctx.money.mulRatio(rt.total, 6, 10, "conv.expense.share");
          continue;
        }
        // 調整控除の後・住宅借入金等特別税額控除の前の市町村民税の所得割（100円未満切り捨て）
        const before = rt.grossLevy.municipal - rt.adjustmentCredit.municipal;
        levy += before > 0 ? at.money.round(yen(before), LEVY_ROUNDING) : 0;
      }
      const r = { levy: yen(levy), exempt };
      levyCache.set(fy, r);
      return r;
    };
    /**
     * その月の保育料の所得割の年度（4〜8月は前年度、9〜3月はその年度）。計算基準月に払っている住民税の年度（residentTaxYearOf）より前にしない
     * （計算基準月が6〜8月の年の、その月から8月までの分は、その年度の住民税で決める。それより前の年度の住民税は表に無い）
     */
    const firstTaxYear = residentTaxYearOf(base);
    const taxYearOf = (m: MonthIndex): number => {
      const mo = monthOf(m);
      const fy = mo >= 4 ? yearOf(m) : yearOf(m) - 1;
      const y = mo >= 4 && mo <= 8 ? fy - 1 : fy;
      return y < firstTaxYear ? firstTaxYear : y;
    };
    const birthKey = (m: MemberInput) => ctx.time.resolve({ at: m.birth.birthYearMonth });
    const childOrder = members.filter((m) => m.kind === "child");
    /** 年長の順（生まれた月が同じなら構成員の並び） */
    const olderThan = (a: MemberInput, b: MemberInput) => birthKey(a) < birthKey(b) || (birthKey(a) === birthKey(b) && childOrder.indexOf(a) < childOrder.indexOf(b));
    const me = byId.get(child);
    if (me === undefined) return { flows: [] };
    /** きょうだいがその月に保育所・幼稚園などに通っているか（小学校就学前の子だけ） */
    const attending = (sib: MemberInput, m: MonthIndex): boolean => {
      if (m >= ctx.time.ageSwitch(sib.id, { years: 6 }, "schoolYear")) return false;
      const stages = goals.filter((g) => g.owner === sib.id).flatMap((g) => g.education?.stages ?? []);
      const kinder = stages.find((s) => s.stage === "kindergarten");
      if (kinder !== undefined && m >= addMonths(ctx.time.ageSwitch(sib.id, { years: 3 }, "schoolYear"), 12 * (kinder.delayYears ?? 0))) return true;
      const nursery = stages.find((s) => s.stage === "nursery");
      return nursery !== undefined && m >= nurseryStart(ctx, sib.id, nursery, members);
    };
    let auto = false;
    for (const g of own) {
      for (const st of g.education?.stages ?? []) {
        if (st.stage !== "nursery") continue;
        const free = ctx.time.ageSwitch(child, { years: 3 }, "schoolYear");
        const from = nurseryStart(ctx, child, st, members);
        const push = (m: MonthIndex, amount: Yen, formula: string) => {
          if (amount > 0 && m >= base && m <= end) flows.push({ row: "cf.expense.education.nursery", ym: formatYm(m), amount, accrualYear: yearOf(m), member: child, object: g.id, formula });
        };
        // 保育料とは別にかかるお金（計算基準年の価格の年額を12で割り、教育費の上昇率で伸ばす。改訂4）
        const at0 = ctx.at(base);
        // 事務所の既定値で「推定で埋めない」（学校の費用の目安。0111 の2回目）にしたときは、統計の目安を引かない
        const fills = ctx.fillsByEstimate("education");
        const extra = st.extraAnnual ?? (fills && at0.has(EXTRA) ? at0.paramYen(EXTRA) : null);
        if (st.extraAnnual === undefined && !fills && at0.has(EXTRA)) ctx.notice("N_INPUT_REQUIRED", [child, "goal.education.noFill"]);
        if (extra !== null && extra > 0) {
          const s = grownByYear(ctx, yen(extra), { kind: "inflation" }, baseYear, Math.max(endYear, baseYear), "educationInflation");
          for (let m = from < base ? base : from; m < free && m <= end; m = addMonths(m, 1)) {
            const y = yearOf(m) < baseYear ? baseYear : yearOf(m) > endYear ? endYear : yearOf(m);
            const amount = ctx.money.mulRatio(s.get(y) ?? yen(extra), 1, 12, "conv.expense.share");
            if (amount > 0) flows.push({ row: "cf.expense.education.school", ym: formatYm(m), amount, accrualYear: yearOf(m), member: child, object: g.id, formula: "education.nurseryFee.extra" });
          }
        }
        // 月額を入れた段（計算基準年の価格。教育費の上昇率で伸ばす）
        if (st.monthly !== undefined) {
          if (st.monthly === 0) continue;
          const s = grownByYear(ctx, yen(st.monthly), { kind: "inflation" }, baseYear, Math.max(endYear, baseYear), "educationInflation");
          for (let m = from; m < free; m = addMonths(m, 1)) push(m, s.get(yearOf(m) < baseYear ? baseYear : yearOf(m) > endYear ? endYear : yearOf(m)) ?? yen(st.monthly), "education.nurseryFee.input");
          continue;
        }
        // 自動の計算（目安）
        const ratio = ctx.rate.of(st.feeRatio ?? String(ctx.estimate(NURSERY_FEE_RATIO_DEFAULT)));
        const tableId = st.hours === "short" ? P.short : P.standard;
        for (let m = from < base ? base : from; m < free && m <= end; m = addMonths(m, 1)) {
          const at = ctx.at(m);
          if (!at.has(tableId)) {
            ctx.notice("N_PARAM_MISSING", [tableId, formatYm(m)]);
            continue;
          }
          auto = true;
          const { levy, exempt } = householdLevy(taxYearOf(m));
          if (exempt) continue;
          // ひとり親世帯等（その月に世帯にいる親が1人で、その親が婚姻していない。改訂5）
          const present = earners.flatMap((id) => {
            const p = byId.get(id);
            return p !== undefined && inHousehold(p, m) ? [p] : [];
          });
          const specified = present.length === 1 && !marriedAt(ctx, relations, present[0] as MemberInput, m);
          const specLimit = at.paramYen(P.specifiedLimit);
          let amount: Yen;
          if (specified && specLimit !== null && levy < specLimit) amount = at.paramYen(P.specifiedAmount) ?? yen(0);
          else amount = bracketFor(at.paramBrackets(tableId) ?? [], levy).amount ?? yen(0);
          // 多子の軽減
          const lowLimit = specified ? specLimit : at.paramYen(P.lowIncomeLimit);
          const low = lowLimit !== null && levy < lowLimit;
          const older = childOrder.filter((c) => c.id !== child && olderThan(c, me) && inHousehold(c, m) && (low || attending(c, m))).length;
          if (older >= 2 || (older === 1 && low && specified)) continue;
          if (older === 1) amount = at.money.mulRate(amount, at.paramRate(P.secondRatio) ?? ctx.rate.of("1"), "conv.expense.share");
          push(m, ctx.money.mulRate(amount, ratio, "conv.expense.share"), "education.nurseryFee.auto");
        }
      }
    }
    if (auto) ctx.notice("N_ESTIMATED", ["education.nurseryFee.auto", child]);
    return { flows };
  },
});
