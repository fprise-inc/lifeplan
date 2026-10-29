// 入るお金の行（0044）: 名前・種類・額（1回・月額。計算基準年の価格で伸び方で伸ばす）・時期（1回・n年ごと・毎月）・受け取る人・相手・
// 段階・例外の年・万一のときの扱いの行を、受け取りの月のお金の動きにする（表の行は種類の既定か row）。出るお金の行（expense.periodic）と同じ解き方。
// - 受け取る人が世帯の外の家族の行は、世帯のお金に入れない（その人のお金の見通しの側で読む）
// - 万一のときの扱いは、受け取る人を入れた行はその人の万一、入れていない行は世帯の万一（だれかの万一）の月の翌月から当てる
// - 課税の扱い（種類の既定か taxTreatment）ごとの所得を、税を受ける人（受け取る人。省略は本人）×年で出す（byMember）。合計所得金額
//   （tax.totalIncome）が一時所得・雑所得・事業所得を、給与所得（tax.employmentIncome）が給与の収入を、贈与税（gift.received）が
//   贈与税で見る行を読む。必要経費・取得費（cost）は1回の額と同じ基準で、受け取る額と同じ割合で伸ばして引く
// - 譲渡所得（分離。事業・出資持分の売却。一般株式等の税率）は、この部品が税を計算する: 年の譲渡所得（収入−取得費。年で合わせて0より
//   下げない）の1,000円未満を切り捨てた額×所得税の税率に復興特別所得税・防衛特別所得税を足して100円未満を切り捨て、翌年3月に
//   cf.taxSi.incomeTax.capitalGains。住民税（株式等譲渡所得割）は×住民税の税率で、翌年6月に cf.taxSi.residentTax.capitalGains。
//   合計所得金額の判定（控除の所得の要件など）には separate として足す（tax.totalIncome）
// - 相続税で見る行は所得税・住民税をかけない（相続税は計算しない。受け取る側の相続税の額は出るお金の行で入れる。知らせ）
// - 口座の間の移し替え（transfers）は入れ物だけで、あれば知らせを出して計算に入れない（0035 の2・7）
// - 改訂2（0044 の追記）: 相手（counterparty）が世帯の外の家族で亡くなる見込み（leaves）があれば、その月から受け取らない（亡くなった人から
//   援助は来ない）。行の終わりがそれより後なら、知らせ N_LIMIT_APPLIED（moneyRow.counterpartyDeath・相手）を出す。亡くなった後に受け取る物
//   （相続税で見る行・相続・遺族年金・保険の受け取り）は止めない。行の終わりの値は書き換えない
// - 約束の版 1.1（改訂3。0085）: 所得は課税の扱いの所得の区分（INCOME_CATEGORY_OF。表の行とは別）で集める。公的年金等以外の雑所得
//   （業務・その他を1つの区分として差し引いた額）を miscellaneousNet、事業所得を businessNet で、赤字（マイナス）のまま添える（その区分の行が
//   ある年だけ）。雑所得の赤字の差し引き・事業所得の損益通算は tax.totalIncome がする。前の欄（区分ごとに0円で止めた額）はそのまま出す
import {
  COUNTERPARTY_DEATH_TOPIC,
  counterpartyStop,
  defineComponent,
  formatYm,
  incomeCategory,
  incomeRow,
  incomeTreatment,
  isOutside,
  monthIndex,
  moneyRowPayments,
  boxValue,
  yearOf,
  yen,
  type ContingencyEvent,
  type ContingencyEventOutput,
  type Flow,
  type IncomeFlowInput,
  type IncomeFlowsOutput,
  type IncomeFlowsTaxRow,
  type MemberInput,
  type Yen,
} from "../../sdk/index.ts";

const P = {
  it: "incomeTax.generalShares.rate",
  rt: "residentTax.generalShares.rate",
  recon: "incomeTax.reconstructionSurtax.rate",
  defense: "incomeTax.defenseSurtax.rate",
  itTaxable: "incomeTax.taxableIncome.rounding",
  surtax: "incomeTax.surtax.rounding",
  itAmount: "incomeTax.taxAmount.rounding",
  rtTaxable: "residentTax.taxableIncome.rounding",
};

type Sums = { temporary: number; miscBusiness: number; miscOther: number; salary: number; business: number; capitalGains: number; misc: boolean; biz: boolean };

export default defineComponent<Record<string, never>, IncomeFlowsOutput>({
  id: "income.flows",
  title: "入るお金の行",
  contract: "1.1",
  revision: 3,
  requires: { "contingency.event": ">=1 <2" },
  params: Object.values(P),
  reads: [
    "member.kind",
    "member.outside",
    "member.leaves",
    "incomeFlow.counterparty",
    "incomeFlow.kind",
    "incomeFlow.taxTreatment",
    "incomeFlow.row",
    "incomeFlow.from",
    "incomeFlow.to",
    "incomeFlow.everyYears",
    "incomeFlow.monthly",
    "incomeFlow.amount",
    "incomeFlow.cost",
    "incomeFlow.growth",
    "incomeFlow.stages",
    "incomeFlow.exceptions",
    "incomeFlow.onContingency",
    "incomeFlow.recipient",
    "transfer.at",
    "assumptions.inflation",
  ],
  input: "empty.input",
  output: "income.flows.output",
  compute(_input, ctx) {
    const flows: Flow[] = [];
    const members = ctx.list<MemberInput>("member");
    const self = members.find((m) => m.kind === "self");
    if (ctx.list<{ id: string }>("transfer").length > 0) ctx.notice("N_NOT_SUPPORTED", ["transfers"]);
    const list = ctx.list<IncomeFlowInput>("incomeFlow");
    if (list.length === 0) return { flows, byMember: [] };
    const events = new Map<string, ContingencyEvent | null>();
    const eventOf = (id: string): ContingencyEvent | null => {
      if (!events.has(id)) events.set(id, ctx.call<ContingencyEventOutput>("contingency.event", { member: id }).event);
      return events.get(id) ?? null;
    };
    let household: ContingencyEvent | null | undefined;
    const householdEvent = (): ContingencyEvent | null => {
      if (household === undefined) {
        household = null;
        for (const m of members) {
          const ev = eventOf(m.id);
          if (ev !== null) {
            household = ev;
            break;
          }
        }
      }
      return household;
    };
    const sums = new Map<string, Sums>();
    const sumOf = (member: string, year: number): Sums => {
      const k = `${member}|${year}`;
      let s = sums.get(k);
      if (s === undefined) {
        s = { temporary: 0, miscBusiness: 0, miscOther: 0, salary: 0, business: 0, capitalGains: 0, misc: false, biz: false };
        sums.set(k, s);
      }
      return s;
    };
    let inheritanceSeen = false;
    for (const f of list) {
      const recipient = f.recipient === undefined ? undefined : members.find((m) => m.id === f.recipient);
      // 世帯の外の家族が受け取る行は、世帯のお金に入れない
      if (recipient !== undefined && isOutside(recipient)) continue;
      const tax = incomeTreatment(f);
      const category = incomeCategory(f);
      const row = incomeRow(ctx, f);
      const ev = f.onContingency === undefined ? null : recipient !== undefined ? eventOf(recipient.id) : householdEvent();
      const all = moneyRowPayments(ctx, f, ev, "conv.expense.share");
      // 相手が亡くなる見込みの月から受け取らない（亡くなった後に受け取る物は止めない）
      const afterDeath = tax === "inheritance" || f.kind === "inheritance" || f.kind === "survivorPension" || f.kind === "insuranceBenefit";
      const stop = afterDeath ? null : counterpartyStop(ctx, members, f.counterparty);
      const pays = stop === null ? all : all.filter((p) => p.month < stop);
      if (pays.length < all.length && f.counterparty !== undefined) ctx.notice("N_LIMIT_APPLIED", [COUNTERPARTY_DEATH_TOPIC, f.counterparty]);
      if (pays.length === 0) continue;
      if (tax === "inheritance") inheritanceSeen = true;
      const subject = recipient?.id ?? self?.id;
      const cost = boxValue(f.cost) ?? yen(0);
      for (const p of pays) {
        flows.push({ row, ym: formatYm(p.month), amount: p.amount, accrualYear: yearOf(p.month), ...(recipient !== undefined ? { member: recipient.id } : {}), object: f.id, formula: p.contingency ? "income.flows.contingency" : "income.flows.receipt" });
        if (subject === undefined || category === null) continue;
        // 必要経費・取得費は、受け取る額と同じ割合で伸ばす（段階・例外の年・万一の割合も同じ）
        const c = cost > 0 && p.base > 0 ? ctx.money.mulRatio(cost, p.amount, p.base, "conv.expense.share") : 0;
        const s = sumOf(subject, yearOf(p.month));
        const net = p.amount - c;
        if (category === "temporary") s.temporary += net;
        else if (category === "miscellaneous") {
          s.misc = true;
          if (tax === "miscBusiness") s.miscBusiness += net;
          else s.miscOther += net;
        } else if (category === "salary") s.salary += p.amount;
        else if (category === "business") {
          s.biz = true;
          s.business += net;
        } else s.capitalGains += net;
      }
    }
    if (inheritanceSeen) ctx.notice("N_NOT_SUPPORTED", ["incomeFlow.inheritanceTax"]);
    const byMember: IncomeFlowsTaxRow[] = [];
    let missing = false;
    for (const [k, s] of [...sums.entries()].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))) {
      const [member, y] = k.split("|") as [string, string];
      const year = Number(y);
      const clamp = (v: number): Yen => yen(v > 0 ? v : 0);
      const capitalGains = clamp(s.capitalGains);
      byMember.push({
        member,
        year,
        temporary: clamp(s.temporary),
        miscBusiness: clamp(s.miscBusiness),
        miscOther: clamp(s.miscOther),
        salary: clamp(s.salary),
        business: clamp(s.business),
        capitalGains,
        ...(s.misc ? { miscellaneousNet: yen(s.miscBusiness + s.miscOther) } : {}),
        ...(s.biz ? { businessNet: yen(s.business) } : {}),
      });
      if (capitalGains <= 0) continue;
      const at = ctx.at(monthIndex(year, 1));
      const itRate = at.paramRate(P.it);
      const rtRate = at.paramRate(P.rt);
      if (itRate === null || rtRate === null) {
        missing = true;
        continue;
      }
      const taxable = at.money.round(capitalGains, P.itTaxable);
      const baseTax = ctx.money.mulRate(taxable, itRate, "conv.tax.exact");
      const surtax = (id: string): Yen => {
        const r = at.paramRate(id);
        return r === null ? yen(0) : at.money.mulRate(baseTax, r, P.surtax);
      };
      const it = at.money.round(yen(baseTax + surtax(P.recon) + surtax(P.defense)), P.itAmount);
      const rt = ctx.money.mulRate(at.money.round(capitalGains, P.rtTaxable), rtRate, "conv.tax.exact");
      if (it > 0) flows.push({ row: "cf.taxSi.incomeTax.capitalGains", ym: formatYm(monthIndex(year + 1, 3)), amount: it, accrualYear: year, member, formula: "income.flows.capitalGainsTax" });
      if (rt > 0) flows.push({ row: "cf.taxSi.residentTax.capitalGains", ym: formatYm(monthIndex(year + 1, 6)), amount: rt, accrualYear: year, member, formula: "income.flows.capitalGainsResidentTax" });
    }
    if (missing) ctx.notice("N_PARAM_MISSING", [P.it, P.rt]);
    return { flows, byMember };
  },
});
