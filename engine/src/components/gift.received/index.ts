// 構成員が受け取る贈与（受け取る月の昇順。贈与・6.8）を集める:
// - 住宅購入の親からの資金援助（housing.residence の purchase.gifts）: 世帯の外からの贈与。住宅取得等資金の非課税を使う（省略は使う・省エネ等住宅でない）
// - 子への援助（教育の目標の gifts。結婚・住宅資金）: 世帯の親から子への贈与（世帯から出す。子の贈与税はキャッシュフロー表に載せない）。
//   住宅資金は住宅取得等資金の非課税を使う（省略は使う・省エネ等住宅でない）
// - 保険の受け取りのうち贈与税の区分のもの（insurance.policy。契約者・被保険者・受取人が違う死亡保険金、契約者でない人が受け取る満期金など）
// 贈与者の区分は、特例税率（直系尊属から18歳以上へ）の判定に使う（親・祖父母・世帯の親・その他）
// 世帯の外の贈与者（donors。0008 の追記 2026-10-10 の決定1）を指す贈与は donor に ID を残し、gift.tax が同じ贈与者からの贈与を合わせて数える。
// 贈与者の区分は、贈与者が「誰の親・祖父母か」（of）と受け取る人の関係から決める（受け取る人がその人か、その人の子なら直系尊属。
// その人の配偶者など、それ以外は「その他」＝一般税率）。教育の目標の援助で贈与者を指すものは、世帯からは出さない（education.cost）
// 改訂3: 世帯の外の家族（0035 の4）の構成員（生年月のある親など）も贈与者になれる
// 改訂4（0044）: 入るお金の行のうち課税の扱いが「贈与税で見る」の行（受け取る人。省略は本人。贈与者は相手）と、あげる贈与の出るお金の行
// （受け取る人は相手の世帯の外の家族。贈与者は払う人か本人。世帯から出し、受け取る人の贈与税は要約にだけ出す。生活費・教育費をその都度
// 払う贈与は非課税なので集めない）も集める。額は income.flows・expense.periodic のお金の動き（受け取り・支払いの月の額）
// 改訂5: あげる贈与の相手が世帯の子でも、直系尊属からの贈与として扱う（前は世帯の外の子・孫だけ）
import {
  defineComponent,
  formatYm,
  isOutside,
  incomeTreatment,
  type DonorInput,
  type Flow,
  type IncomeFlowInput,
  type PeriodicExpenseInput,
  type GiftReceived,
  type GiftReceivedOutput,
  type GoalInput,
  type InsuranceReceipt,
  type MemberInput,
  type RelationInput,
  type ResidenceInput,
} from "../../sdk/index.ts";

export default defineComponent<{ member: string }, GiftReceivedOutput>({
  id: "gift.received",
  title: "受け取る贈与（集める）",
  contract: "1.2",
  revision: 5,
  requires: { "insurance.policy": ">=1 <2", "income.flows": ">=1 <2", "expense.periodic": ">=1 <2" },
  params: [],
  reads: [
    "member.outside",
    "residence.purchase",
    "residence.from",
    "goal.kind",
    "goal.owner",
    "goal.education",
    "insurance.policyholder",
    "member.kind",
    "relation.type",
    "relation.parent",
    "relation.child",
    "donor.kind",
    "donor.of",
    "incomeFlow.kind",
    "incomeFlow.taxTreatment",
    "incomeFlow.recipient",
    "incomeFlow.counterparty",
    "incomeFlow.giftMethod",
    "periodicExpense.gift",
    "periodicExpense.counterparty",
    "periodicExpense.payer",
  ],
  input: "member.input",
  output: "gift.received.output",
  compute(input, ctx) {
    const member = input.member;
    const gifts: GiftReceived[] = [];
    const donors = ctx.list<DonorInput>("donor");
    // 贈与者の区分（受け取る人から見て直系尊属なら parent・grandparent、そうでなければ other）
    // 世帯の外の家族の構成員（生年月のある親など。0035 の4）も贈与者になれる。続柄は構成員の種類と、誰の家族か（outside.of）から
    const outsideDonor = (id: string): DonorInput | undefined => {
      const m = ctx.list<MemberInput>("member").find((x) => x.id === id && isOutside(x));
      if (m === undefined) return undefined;
      return { id: m.id, kind: m.kind === "parent" || m.kind === "grandparent" ? m.kind : "other", ...(m.outside?.of !== undefined ? { of: m.outside.of } : {}) };
    };
    const donorGiver = (id: string): GiftReceived["giver"] => {
      const d = donors.find((x) => x.id === id) ?? outsideDonor(id);
      if (d === undefined || d.kind === "other") return "other";
      if (d.of === undefined || d.of === member) return d.kind;
      const members = ctx.list<MemberInput>("member");
      const relations = ctx.list<RelationInput>("relation");
      const parentsGiven = relations.some((x) => x.type === "parentOf");
      const childOf = parentsGiven
        ? relations.some((x) => x.type === "parentOf" && x.parent === d.of && x.child === member)
        : members.find((m) => m.id === member)?.kind === "child" && ["self", "spouse"].includes(members.find((m) => m.id === d.of)?.kind ?? "");
      return childOf ? "grandparent" : "other";
    };
    for (const r of ctx.list<ResidenceInput>("residence")) {
      const p = r.purchase;
      if (p === undefined) continue;
      const at = ctx.time.resolve(p.at ?? r.from);
      for (const g of p.gifts ?? []) {
        if (g.recipient !== member || g.amount <= 0) continue;
        const housing = g.housingExemption ?? "other";
        gifts.push({
          ym: formatYm(at),
          source: "housingPurchase",
          object: r.id,
          amount: g.amount,
          giver: g.donor !== undefined ? donorGiver(g.donor) : (g.giver ?? "parent"),
          giverMember: null,
          ...(g.donor !== undefined ? { donor: g.donor } : {}),
          method: g.taxMethod ?? "calendar",
          housing: housing === "none" ? null : housing,
          inflow: true,
        });
      }
    }
    for (const goal of ctx.list<GoalInput>("goal")) {
      if (goal.kind !== "education" || goal.owner !== member) continue;
      for (const g of goal.education?.gifts ?? []) {
        if (g.amount <= 0) continue;
        const housing = g.purpose === "housing" ? (g.housingExemption ?? "other") : "none";
        gifts.push({
          ym: formatYm(ctx.time.resolve(g.at)),
          source: "education",
          object: goal.id,
          amount: g.amount,
          giver: g.donor !== undefined ? donorGiver(g.donor) : "household",
          giverMember: g.donor !== undefined ? null : (g.payer ?? null),
          ...(g.donor !== undefined ? { donor: g.donor } : {}),
          method: g.taxMethod ?? "calendar",
          housing: housing === "none" ? null : housing,
          inflow: false,
        });
      }
    }
    // 入るお金の行のうち「贈与税で見る」行（受け取る人。省略は本人）
    const flowsOf = (out: { flows: readonly Flow[] }, id: string) => out.flows.filter((f) => f.object === id);
    const incomes = ctx.list<IncomeFlowInput>("incomeFlow").filter((f) => incomeTreatment(f) === "gift");
    if (incomes.length > 0) {
      const self = ctx.list<MemberInput>("member").find((m) => m.kind === "self")?.id;
      const out = ctx.call<{ flows: readonly Flow[] }>("income.flows", {});
      for (const f of incomes) {
        if ((f.recipient ?? self) !== member) continue;
        for (const x of flowsOf(out, f.id)) {
          if (x.row.startsWith("cf.taxSi.")) continue;
          gifts.push({
            ym: x.ym,
            source: "incomeFlow",
            object: f.id,
            amount: x.amount,
            giver: f.counterparty !== undefined ? donorGiver(f.counterparty) : "other",
            giverMember: null,
            ...(f.counterparty !== undefined ? { donor: f.counterparty } : {}),
            method: f.giftMethod ?? "calendar",
            housing: null,
            inflow: true,
          });
        }
      }
    }
    // あげる贈与（受け取る人は相手。世帯から出す。生活費・教育費をその都度払う贈与は非課税）
    const given = ctx.list<PeriodicExpenseInput>("periodicExpense").filter((e) => e.gift !== undefined && e.counterparty === member && e.gift.purpose !== "asNeeded");
    if (given.length > 0) {
      const members = ctx.list<MemberInput>("member");
      const me = members.find((m) => m.id === member);
      const self = members.find((m) => m.kind === "self")?.id ?? null;
      // 世帯の子と、世帯の外の子・孫（世帯の人の子・孫）なら直系尊属からの贈与（改訂5: 世帯の子も。あげる贈与の相手に世帯の子を選べるようにした）
      const direct = me !== undefined && (me.kind === "child" || me.kind === "grandchild");
      const out = ctx.call<{ flows: readonly Flow[] }>("expense.periodic", {});
      for (const e of given) {
        for (const x of flowsOf(out, e.id)) {
          gifts.push({
            ym: x.ym,
            source: "periodicExpense",
            object: e.id,
            amount: x.amount,
            giver: direct ? "household" : "other",
            giverMember: e.payer ?? self,
            method: e.gift?.method ?? "calendar",
            housing: e.gift?.purpose === "housing" ? "other" : null,
            inflow: false,
          });
        }
      }
    }
    // 保険の受け取りのうち贈与税の区分のもの
    const contracts = ctx.list<{ id: string }>("insurance");
    if (contracts.length > 0) {
      const members = ctx.list<MemberInput>("member");
      const relations = ctx.list<RelationInput>("relation");
      const parentsGiven = relations.some((x) => x.type === "parentOf");
      for (const c of contracts) {
        for (const r of ctx.call<{ receipts: readonly InsuranceReceipt[] }>("insurance.policy", { object: c.id }).receipts) {
          if (r.member !== member || r.taxClass !== "gift" || r.giver === undefined) continue;
          const giverKind = members.find((m) => m.id === r.giver)?.kind;
          const me = members.find((m) => m.id === member)?.kind;
          const isParent = parentsGiven ? relations.some((x) => x.type === "parentOf" && x.parent === r.giver && x.child === member) : me === "child" && (giverKind === "self" || giverKind === "spouse");
          gifts.push({
            ym: r.ym,
            source: "insurance",
            object: c.id,
            amount: r.amount,
            giver: isParent ? "household" : giverKind === "parent" && me !== "parent" ? "parent" : "other",
            giverMember: r.giver,
            method: "calendar",
            housing: null,
            inflow: true,
          });
        }
      }
    }
    gifts.sort((a, b) => (a.ym < b.ym ? -1 : a.ym > b.ym ? 1 : 0));
    return { gifts };
  },
});
