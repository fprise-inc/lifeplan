// 相続税の目安（0039）: 時点ごとに、亡くなる人の財産から相続税のだいたいの額を出す。お金の流れ（キャッシュフロー表）には入れない（表示だけ）。
// 要求の inheritanceTax を指定したときだけ、根の部品の後にエンジンが呼ぶ（必要保障額の推移と同じ。キャッシュフロー表の部品の結果を使い回す）。
// - 時点: 万一の想定（死亡）の無い要求では「いま本人・配偶者が亡くなったら」（now。亡くなる月は計算基準月）と「二人とも亡くなった後」
//   （bothAfter。表の最後の年の12月。後に亡くなる人は lastSurvivor、省略は年下の人、同じなら配偶者）。万一の想定（死亡）のある要求では、
//   その想定の時点（contingency）だけ
// - 財産（亡くなる人の名義の分）: 金融資産（いまは入力の時価、ほかの時点は財産を見る年の年末の残高。万一の想定は亡くなる年の前の年末）＋
//   不動産（年末の評価額×評価の割合。省略は 0.8＝時価の80%の推定。持ち家は名義の割合 ownership で分ける。持ち始める時点の前の不動産は
//   評価額の行が無いので入らない）＋車・その他の資産・保険の契約の権利（亡くなる人が被保険者でない契約の解約返戻金）＋死亡保険金
//   （亡くなる人が契約者で被保険者の契約）＋死亡退職金（退職給付の見込みを勤続の月数で按分。確定拠出年金・小規模企業共済の残高を含む）＋
//   相続時精算課税で贈与した財産（年ごとの基礎控除の後。gift.tax の settlementByGiver）−債務（負債の残高のうち亡くなる人の分。団信で消える分を
//   除く）−葬式の費用。名義の無い財産は unassignedShare（省略は夫婦なら半分、一人なら全部）。二人とも亡くなった後は夫婦の財産を合わせる
// - 非課税: 死亡保険金と死亡退職金のそれぞれ 500万円×法定相続人の数（制度データ）
// - 法定相続人: 配偶者（法律婚だけ。事実婚は入れない）＋第1順位 子（世帯の子と世帯の外の子。先に亡くなった子の子は代襲で親の分を分ける）、
//   子がいなければ第2順位 直系尊属（親、親がいなければ祖父母）、それもいなければ第3順位 兄弟姉妹。世帯の外の家族は構成員の印 outside か、
//   世帯の外の家族から作った贈与者（relative・leaves）から数える。亡くなる見込み（leaves）が亡くなる月以前の世帯の外の家族と、まだ生まれていない
//   子は数えない。誰の家族か（of）の無い世帯の外の家族は本人の家族と読む。養子（adopted）は実子がいれば1人・いなければ2人まで数える
//   （数えない養子は目安の分け方からも外す）。数は heirCounts で直せる（代襲・放棄など。直したときは、配偶者のほかを同じ順位で等分とみなす）
// - 税: 課税価格の合計−基礎控除（3,000万円＋600万円×法定相続人の数）を法定相続分で分け（1,000円未満切り捨て）、速算表を当てて合計
//   （100円未満切り捨て）。目安は法定相続分どおりに分けたとし、各人の税＝税の総額×法定相続分。配偶者の軽減は 配偶者の税×（配偶者の取得額と
//   「1億6,000万円か法定相続分の額の多い方」の小さい方）÷課税価格の合計。精算課税で払った贈与税は受け取った相続人の税から引き、引ききれない分は
//   還付（refund）。納める額は各人の100円未満を切り捨てる
// - FP が入れた額（overrides）があれば amount はその額（state: confirmed）。目安は消さずに並べる
// - 入れていない決まり（notIncluded）: 2割加算・小規模宅地等の特例・土地の評価の細部・一次と二次の分け方の比べ・暦年課税の贈与の加算・
//   相次相続控除・未成年者控除・障害者控除・受け取る側の目安（親の遺産の総額から）。当たりそうなとき（兄弟姉妹が相続人・持ち家がある・数えない
//   養子がいる・相続人でない人への精算課税の贈与）は cautions に出す
import {
  bracketFor,
  boxValue,
  defineComponent,
  formatYm,
  monthIndex,
  parseYm,
  yearOf,
  yen,
  type AccountInput,
  type AnnualRow,
  type ContingencyEventOutput,
  type DebtInput,
  type Flow,
  type GiftReceivedOutput,
  type GiftTaxOutput,
  type InsuranceContractInput,
  type InsurancePolicyOutput,
  type MemberInput,
  type MonthCtx,
  type MonthIndex,
  type RelationInput,
  type RetirementReceipt,
  type Yen,
} from "../../sdk/index.ts";

type Point = "now" | "bothAfter" | "contingency";

interface Request {
  readonly points?: readonly Point[];
  readonly members?: readonly string[];
  readonly lastSurvivor?: string;
  readonly realEstateRatio?: string;
  readonly unassignedShare?: string;
  readonly funeral?: Yen;
  readonly adopted?: readonly string[];
  readonly heirCounts?: readonly { readonly decedent: string; readonly count: number }[];
  readonly retirementAllowances?: readonly { readonly decedent: string; readonly amount: Yen }[];
  readonly overrides?: readonly { readonly point: Point; readonly decedent?: string; readonly amount: Yen }[];
}

const P = {
  base: "inheritanceTax.basicDeduction.base",
  perHeir: "inheritanceTax.basicDeduction.perHeir",
  table: "inheritanceTax.rateTable",
  insurance: "inheritanceTax.lifeInsurance.exemptionPerHeir",
  retirement: "inheritanceTax.retirementAllowance.exemptionPerHeir",
  spouseFloor: "inheritanceTax.spouseReduction.floor",
  adoptedWith: "inheritanceTax.adoptedChildren.withNatural",
  adoptedWithout: "inheritanceTax.adoptedChildren.withoutNatural",
  taxableRound: "inheritanceTax.taxable.rounding",
  totalRound: "inheritanceTax.total.rounding",
  taxRound: "inheritanceTax.tax.rounding",
};

/** 不動産の評価の割合の推定（土地の路線価は公示価格等の8割程度を目途に定められる。国税庁の路線価等の公表資料。0039） */
export const REAL_ESTATE_RATIO = "0.8";

/** 目安に含めていない決まり（いつも同じ一覧） */
export const NOT_INCLUDED: readonly string[] = [
  "twentyPercentSurcharge",
  "smallLandSpecial",
  "landValuationDetail",
  "primarySecondaryComparison",
  "calendarGiftAddBack",
  "successiveInheritanceCredit",
  "minorCredit",
  "disabilityCredit",
  "receivingSideEstimate",
];

const FINANCIAL_EXCLUDED: ReadonlySet<string> = new Set(["realEstate", "insurance", "otherAsset", "ideco", "corporateDc", "smallBusinessMutualAid"]);
/** 死亡退職金と同じ扱い（退職手当金等）の器: 確定拠出年金の死亡一時金・小規模企業共済の死亡の共済金 */
const RETIREMENT_KINDS: ReadonlySet<string> = new Set(["ideco", "corporateDc", "smallBusinessMutualAid"]);

type Relation = "spouse" | "child" | "grandchild" | "parent" | "grandparent" | "sibling";

interface Heir {
  member: string;
  relation: Relation;
  outside: boolean;
  counted: boolean;
  adopted: boolean;
  representing?: string;
  /** 法定相続分（数えない養子は null） */
  share: [bigint, bigint] | null;
}

/** 親族の候補（構成員と、世帯の外の家族から作った贈与者） */
interface Person {
  id: string;
  kind: string;
  outside: boolean;
  /** 誰の家族か（世帯の外の家族。省略は null） */
  of: string | null;
  birth: MonthIndex | null;
  joins: MonthIndex | null;
  expected: boolean;
  /** 亡くなる見込み（世帯の外の家族だけ） */
  dies: MonthIndex | null;
}

const gcd = (a: bigint, b: bigint): bigint => {
  let x = a < 0n ? -a : a;
  let y = b < 0n ? -b : b;
  while (y !== 0n) [x, y] = [y, x % y];
  return x === 0n ? 1n : x;
};
const frac = (n: bigint, d: bigint): [bigint, bigint] => {
  const g = gcd(n, d);
  return [n / g, d / g];
};
const fmtFrac = (f: [bigint, bigint]) => `${f[0]}/${f[1]}`;

type PointResult = {
  point: Point;
  decedent: string;
  month: string;
  valuationYear: number;
  status: "ok" | "noHeirs" | "noData";
  assets: Record<
    "financial" | "realEstateMarket" | "realEstate" | "other" | "insurance" | "insuranceExempt" | "retirement" | "retirementExempt" | "settlementGifts" | "debts" | "funeral" | "taxablePrice",
    Yen
  >;
  heirs: { member: string; relation: Relation; outside: boolean; counted: boolean; share?: string; adopted?: boolean; representing?: string }[];
  heirCount: number;
  heirCountOverridden: boolean;
  basicDeduction: Yen;
  taxableEstate: Yen;
  totalTax: Yen;
  spouseReduction: Yen;
  settlementCredit: Yen;
  byHeir: { member?: string; count?: number; outside: boolean; acquisition: Yen; tax: Yen; spouseReduction: Yen; credit: Yen; payable: Yen; refund: Yen }[];
  payable: Yen;
  payableHousehold: Yen;
  payableOutside: Yen;
  refund: Yen;
  noTax: boolean;
  margin: Yen;
  amount: Yen;
  state: "estimated" | "confirmed";
  cautions: string[];
};

export default defineComponent<{ request: Request }, { points: PointResult[]; notIncluded: readonly string[] }>({
  id: "inheritance.estimate",
  title: "相続税の目安（基礎控除・法定相続人・非課税・速算表・配偶者の軽減・精算課税の足し戻し）",
  contract: "1.0",
  revision: 1,
  requires: {
    "plan.cashflow": ">=1 <2",
    "insurance.policy": ">=1 <2",
    "retirement.receipts": ">=1 <2",
    "retirement.benefit": ">=1 <2",
    "contingency.event": ">=1 <2",
    "contingency.lumpSum": ">=1 <2",
    "gift.received": ">=1 <2",
    "gift.tax": ">=1 <2",
  },
  params: Object.values(P),
  reads: [
    "member.kind",
    "member.birth",
    "member.joins",
    "member.leaves",
    "member.expected",
    "member.outside",
    "relation.type",
    "relation.a",
    "relation.b",
    "relation.marriage",
    "relation.from",
    "relation.to",
    "relation.parent",
    "relation.child",
    "donor.kind",
    "donor.of",
    "donor.relative",
    "donor.leaves",
    "account.kind",
    "account.owner",
    "account.marketValue",
    "insurance.policyholder",
    "insurance.insured",
    "debt.debtors",
    "debt.creditLife",
    "residence.ownership",
    "goal.kind",
    "goal.owner",
  ],
  input: "inheritance.estimate.input",
  output: "inheritance.estimate.output",
  compute(input, ctx) {
    const req = input.request;
    const { base, end } = ctx.time;
    const baseYear = yearOf(base);
    const endYear = yearOf(end);
    const members = ctx.list<MemberInput>("member");
    const relations = ctx.list<RelationInput>("relation");
    const donors = ctx.list<{ id: string; kind: string; of?: string; relative?: string; leaves?: unknown }>("donor");
    const adults = members.filter((m) => m.outside === undefined && (m.kind === "self" || m.kind === "spouse"));
    const self = adults.find((m) => m.kind === "self") ?? adults[0];
    const adopted = new Set(req.adopted ?? []);
    const resolveTp = (tp: unknown): MonthIndex | null => (tp === null || tp === undefined ? null : ctx.time.resolve(tp as never));

    // 親族の候補
    const people: Person[] = [
      ...members.map(
        (m): Person => ({
          id: m.id,
          kind: m.kind,
          outside: m.outside !== undefined,
          of: m.outside?.of ?? null,
          birth: (m.birth as { birthYearMonth?: string } | undefined)?.birthYearMonth !== undefined ? parseYm((m.birth as { birthYearMonth: string }).birthYearMonth) : null,
          joins: resolveTp(m.joins),
          expected: m.expected,
          dies: m.outside !== undefined ? resolveTp(m.leaves) : null,
        }),
      ),
      ...donors.map(
        (d): Person => ({ id: d.id, kind: d.relative ?? d.kind, outside: true, of: d.of ?? null, birth: null, joins: null, expected: false, dies: resolveTp(d.leaves) }),
      ),
    ];
    const byId = new Map(people.map((p) => [p.id, p]));
    // 人の並びは入力の順（構成員、世帯の外の家族から作った贈与者の順）
    const inOrder = (ids: ReadonlySet<string>): string[] => people.filter((p) => ids.has(p.id)).map((p) => p.id);
    const alive = (id: string, D: MonthIndex): boolean => {
      const p = byId.get(id);
      if (p === undefined) return false;
      if (p.birth !== null && p.birth > D) return false;
      if (p.expected && p.joins !== null && p.joins > D) return false;
      if (p.dies !== null && p.dies <= D) return false;
      return true;
    };
    // 世帯の外の家族の「誰の家族か」（省略は本人）
    const ofOf = (p: Person): string | null => p.of ?? self?.id ?? null;
    const parentsGiven = relations.some((r) => r.type === "parentOf");
    const childrenOfX = (x: string): string[] => {
      const out = new Set<string>();
      for (const r of relations) if (r.type === "parentOf" && r.parent === x) out.add(r.child);
      const me = byId.get(x);
      if (!parentsGiven && me !== undefined && !me.outside && (me.kind === "self" || me.kind === "spouse")) {
        for (const p of people) if (!p.outside && p.kind === "child") out.add(p.id);
      }
      for (const p of people) if (p.outside && p.kind === "child" && ofOf(p) === x) out.add(p.id);
      return inOrder(out);
    };
    const parentsOfX = (x: string): string[] => {
      const out = new Set<string>();
      for (const r of relations) if (r.type === "parentOf" && r.child === x && byId.get(r.parent)?.kind !== "self" && byId.get(r.parent)?.kind !== "spouse") out.add(r.parent);
      for (const p of people) if (p.kind === "parent" && (p.outside ? ofOf(p) : self?.id) === x) out.add(p.id);
      return inOrder(out);
    };
    const ofKind = (x: string, kind: string): string[] => people.filter((p) => p.kind === kind && (p.outside ? ofOf(p) : self?.id) === x).map((p) => p.id);
    const legalSpouseAt = (x: string, D: MonthIndex): string | null => {
      for (const r of relations) {
        if (r.type !== "spouse" || r.marriage !== "legal" || (r.a !== x && r.b !== x)) continue;
        const from = resolveTp(r.from);
        const to = resolveTp(r.to);
        if ((from !== null && from > D) || (to !== null && to < D)) continue;
        const other = r.a === x ? r.b : r.a;
        if (alive(other, D)) return other;
      }
      return null;
    };

    /** 法定相続人（spouseAllowed は配偶者を数えるか。二人とも亡くなった後は数えない） */
    const heirsOf = (x: string, D: MonthIndex, spouseAllowed: boolean, childrenFrom: readonly string[] | null, at: MonthCtx): Heir[] => {
      const heirs: Heir[] = [];
      const spouse = spouseAllowed ? legalSpouseAt(x, D) : null;
      // 第1順位: 子（代襲は parentOf の関係でたどる）
      const childIds = childrenFrom ?? childrenOfX(x);
      const lines: { head: string; members: { id: string; representing?: string }[] }[] = [];
      for (const c of childIds) {
        if (c === x) continue;
        if (alive(c, D)) lines.push({ head: c, members: [{ id: c }] });
        else {
          const grand = inOrder(new Set(relations.flatMap((r) => (r.type === "parentOf" && r.parent === c && alive(r.child, D) ? [r.child] : []))));
          if (grand.length > 0) lines.push({ head: c, members: grand.map((g) => ({ id: g, representing: c })) });
        }
      }
      let others: Heir[] = [];
      if (lines.length > 0) {
        // 養子の数の制限（数えない養子は目安の分け方からも外す）
        const natural = lines.filter((l) => l.members.some((m) => m.representing !== undefined) || !adopted.has(l.head));
        const adoptedLines = lines.filter((l) => !natural.includes(l));
        const limit = (natural.length > 0 ? at.paramCount(P.adoptedWith) : at.paramCount(P.adoptedWithout)) ?? adoptedLines.length;
        const countedLines = [...natural, ...adoptedLines.slice(0, limit)];
        const n = BigInt(countedLines.length);
        for (const l of lines) {
          const counted = countedLines.includes(l);
          for (const m of l.members) {
            others.push({
              member: m.id,
              relation: m.representing !== undefined ? "grandchild" : "child",
              outside: byId.get(m.id)?.outside ?? false,
              counted,
              adopted: adopted.has(m.id),
              ...(m.representing !== undefined ? { representing: m.representing } : {}),
              share: counted ? [1n, n * BigInt(l.members.length)] : null,
            });
          }
        }
      } else {
        // 第2順位: 直系尊属（親、いなければ祖父母）
        let asc = parentsOfX(x).filter((p) => alive(p, D));
        let rel: Relation = "parent";
        if (asc.length === 0) {
          asc = ofKind(x, "grandparent").filter((p) => alive(p, D));
          rel = "grandparent";
        }
        if (asc.length === 0) {
          asc = ofKind(x, "sibling").filter((p) => alive(p, D));
          rel = "sibling";
        }
        others = asc.map((id) => ({ member: id, relation: rel, outside: byId.get(id)?.outside ?? true, counted: true, adopted: false, share: [1n, BigInt(asc.length)] }));
      }
      // 配偶者と組み合わせた法定相続分（民法900条）
      if (spouse !== null) {
        const rank = others.find((h) => h.counted)?.relation;
        const sp: [bigint, bigint] = rank === undefined ? [1n, 1n] : rank === "child" || rank === "grandchild" ? [1n, 2n] : rank === "sibling" ? [3n, 4n] : [2n, 3n];
        const rest: [bigint, bigint] = [sp[1] - sp[0], sp[1]];
        heirs.push({ member: spouse, relation: "spouse", outside: byId.get(spouse)?.outside ?? false, counted: true, adopted: false, share: sp });
        for (const h of others) if (h.share !== null) h.share = frac(rest[0] * h.share[0], rest[1] * h.share[1]);
      }
      for (const h of others) if (h.share !== null) h.share = frac(h.share[0], h.share[1]);
      return [...heirs, ...others];
    };

    // 年末の残高の行（plan.cashflow）
    const annual = ctx.call<{ annual: readonly AnnualRow[] }>("plan.cashflow", {}).annual;
    const rowsOf = (y: number) => annual.filter((a) => a.year === y && a.row.startsWith("cf.balance."));
    const accounts = ctx.list<AccountInput>("account");
    const contracts = ctx.list<InsuranceContractInput>("insurance");
    const debts = ctx.list<DebtInput>("debt");
    const residences = ctx.list<{ id: string; ownership?: readonly { member: string; share: string }[] }>("residence");
    const goals = ctx.list<{ id: string; kind: string; owner: string }>("goal");
    const realRatio = ctx.rate.of(req.realEstateRatio ?? REAL_ESTATE_RATIO);
    const policyOut = new Map<string, InsurancePolicyOutput>();
    const policy = (id: string) => {
      let o = policyOut.get(id);
      if (o === undefined) {
        o = ctx.call<InsurancePolicyOutput>("insurance.policy", { object: id });
        policyOut.set(id, o);
      }
      return o;
    };

    /** 亡くなる人（owners）の分の割合（名義の無い財産は unassigned） */
    const shareOf = (owner: string | null | undefined, owners: ReadonlySet<string>, unassigned: string): string | null => {
      if (owner === null || owner === undefined) return unassigned;
      return owners.has(owner) ? "1" : null;
    };
    const part = (amount: Yen, share: string | null): number => (share === null || amount <= 0 ? 0 : share === "1" ? amount : ctx.money.mulRate(amount, ctx.rate.of(share), "conv.exact"));

    const results: PointResult[] = [];
    const contingencyDeath = (() => {
      for (const m of members) {
        const ev = ctx.call<ContingencyEventOutput>("contingency.event", { member: m.id }).event;
        if (ev !== null && ev.kind === "death") return { member: m.id, month: parseYm(ev.month) };
      }
      return null;
    })();
    const wanted = (p: Point) => req.points === undefined || req.points.includes(p);
    const jobs: { point: Point; decedent: string; D: MonthIndex; V: number; opening: boolean; owners: Set<string>; spouseAllowed: boolean; childrenFrom: string[] | null }[] = [];
    if (contingencyDeath !== null) {
      if (wanted("contingency")) {
        const D = contingencyDeath.month;
        const y = yearOf(D);
        jobs.push({ point: "contingency", decedent: contingencyDeath.member, D, V: y > baseYear ? y - 1 : baseYear, opening: y <= baseYear, owners: new Set([contingencyDeath.member]), spouseAllowed: true, childrenFrom: null });
      }
    } else {
      if (wanted("now")) {
        const ids = req.members ?? adults.map((m) => m.id);
        for (const id of ids) jobs.push({ point: "now", decedent: id, D: base, V: baseYear, opening: true, owners: new Set([id]), spouseAllowed: true, childrenFrom: null });
      }
      if (wanted("bothAfter") && adults.length > 0) {
        const last =
          req.lastSurvivor ??
          [...adults].sort((a, b) => {
            const ba = byId.get(a.id)?.birth ?? 0;
            const bb = byId.get(b.id)?.birth ?? 0;
            return bb - ba || (a.kind === "spouse" ? -1 : 1);
          })[0]?.id;
        if (last !== undefined) {
          const kids = inOrder(new Set(adults.flatMap((a) => childrenOfX(a.id))));
          jobs.push({ point: "bothAfter", decedent: last, D: monthIndex(endYear, 12), V: endYear, opening: false, owners: new Set(adults.map((a) => a.id)), spouseAllowed: false, childrenFrom: kids });
        }
      }
    }

    for (const job of jobs) {
      const { point, decedent: X, D, V, opening, owners } = job;
      const at = ctx.at(D);
      const empty = (status: PointResult["status"]): PointResult => ({
        point,
        decedent: X,
        month: formatYm(D),
        valuationYear: V,
        status,
        assets: { financial: yen(0), realEstateMarket: yen(0), realEstate: yen(0), other: yen(0), insurance: yen(0), insuranceExempt: yen(0), retirement: yen(0), retirementExempt: yen(0), settlementGifts: yen(0), debts: yen(0), funeral: yen(0), taxablePrice: yen(0) },
        heirs: [],
        heirCount: 0,
        heirCountOverridden: false,
        basicDeduction: yen(0),
        taxableEstate: yen(0),
        totalTax: yen(0),
        spouseReduction: yen(0),
        settlementCredit: yen(0),
        byHeir: [],
        payable: yen(0),
        payableHousehold: yen(0),
        payableOutside: yen(0),
        refund: yen(0),
        noTax: true,
        margin: yen(0),
        amount: yen(0),
        state: "estimated",
        cautions: [],
      });
      if (!at.has(P.base)) {
        ctx.notice("N_PARAM_MISSING", [P.base, X]);
        results.push(empty("noData"));
        continue;
      }
      const cautions = new Set<string>();
      // 相続人
      const heirs = heirsOf(X, D, job.spouseAllowed, job.childrenFrom, at);
      const autoCount = heirs.filter((h) => h.counted).length;
      const given = req.heirCounts?.find((h) => h.decedent === X)?.count;
      const N = given ?? autoCount;
      if (heirs.some((h) => !h.counted)) cautions.add("adoptedLimit");
      if (heirs.some((h) => h.relation === "sibling" || h.relation === "grandparent")) cautions.add("twentyPercentSurcharge");
      const hasSpouse = heirs.some((h) => h.relation === "spouse") || (job.point === "bothAfter" ? false : legalSpouseAt(X, D) !== null);
      const unassigned = req.unassignedShare ?? (job.point === "bothAfter" || !hasSpouse || adults.length < 2 ? "1" : "0.5");

      // 財産
      let financial = 0;
      let realMarket = 0;
      let other = 0;
      let retirement = 0;
      let insurance = 0;
      let debtTotal = 0;
      const insuredByX = new Set(contracts.filter((c) => c.insured === X).map((c) => c.id));
      const rows = rowsOf(V);
      if (opening) {
        for (const a of accounts) {
          if (FINANCIAL_EXCLUDED.has(a.kind) && !RETIREMENT_KINDS.has(a.kind)) continue;
          const v = boxValue(a.marketValue) ?? yen(0);
          const s = shareOf(a.owner, owners, unassigned);
          if (RETIREMENT_KINDS.has(a.kind)) retirement += part(v, s);
          else financial += part(v, s);
        }
      }
      const residenceShare = (object: string | undefined): string | null | undefined => {
        const r = residences.find((x) => x.id === object);
        if (r === undefined || r.ownership === undefined || r.ownership.length === 0) return undefined;
        let sum = ctx.rate.of("0");
        for (const o of r.ownership) if (owners.has(o.member)) sum = ctx.rate.add(sum, ctx.rate.of(o.share));
        return ctx.rate.compare(sum, ctx.rate.of("0")) === 0 ? null : ctx.rate.toString(sum);
      };
      let hasHome = false;
      for (const a of rows) {
        const kind = a.row.slice("cf.balance.".length);
        if (kind.startsWith("account.")) {
          const k = kind.slice("account.".length);
          if (k.startsWith("realEstate")) {
            const rs = residenceShare(a.object);
            const s = rs !== undefined ? rs : shareOf(a.member, owners, unassigned);
            const v = part(a.amount, s);
            if (v > 0 && residences.some((r) => r.id === a.object)) hasHome = true;
            realMarket += v;
            continue;
          }
          if (k === "insurance") {
            // 亡くなる人が被保険者の契約は死亡保険金で数える
            if (a.object !== undefined && insuredByX.has(a.object)) continue;
            other += part(a.amount, shareOf(a.member, owners, unassigned));
            continue;
          }
          if (k === "car" || k === "otherAsset") {
            other += part(a.amount, shareOf(a.member, owners, unassigned));
            continue;
          }
          if (opening) continue;
          const v = part(a.amount, shareOf(a.member, owners, unassigned));
          if (RETIREMENT_KINDS.has(k)) retirement += v;
          else financial += v;
          continue;
        }
        if (kind.startsWith("debt.")) {
          const d = debts.find((x) => x.id === a.object);
          if (d === undefined) {
            debtTotal += part(a.amount, shareOf(a.member, owners, unassigned));
            continue;
          }
          const mine = d.debtors.filter((x) => owners.has(x.member) && x.role !== "guarantor");
          if (mine.length === 0) continue;
          const payers = d.debtors.filter((x) => x.role !== "guarantor");
          // 負担の割合（share。書いていなければ債務者の数で等分）
          let amount: Yen;
          if (mine.every((m) => m.share !== undefined)) {
            let share = ctx.rate.of("0");
            for (const m of mine) share = ctx.rate.add(share, ctx.rate.of(m.share as string));
            amount = ctx.money.mulRate(a.amount, share, "conv.exact");
          } else amount = ctx.money.mulRatio(a.amount, mine.length, payers.length, "conv.exact");
          // 団信で消える分（亡くなる人が対象で、事由に死亡がある）
          const cl = d.creditLife;
          if (cl !== undefined && cl.covered.includes(X) && (cl.events ?? ["death"]).includes("death") && a.row !== "cf.balance.debt.unpaidInterest") {
            const xs = d.debtors.find((x) => x.member === X)?.share;
            const ratio = cl.spouseJoint === true ? "1" : (cl.ratio ?? (d.debtors.length > 1 && xs !== undefined ? xs : "1"));
            amount = yen(Math.max(0, amount - ctx.money.mulRate(a.amount, ctx.rate.of(ratio), "conv.exact")));
          }
          debtTotal += amount;
        }
      }
      // 死亡保険金（亡くなる人が契約者で被保険者の契約。二人とも亡くなった後は夫婦のどちらかが契約者）
      for (const c of contracts) {
        if (c.insured !== X || !owners.has(c.policyholder) || (point !== "bothAfter" && c.policyholder !== X)) continue;
        const o = policy(c.id);
        if (point === "contingency") {
          for (const r of o.receipts) if (r.kind === "death" && r.taxClass === "inheritance") insurance += r.amount;
        } else insurance += o.years.find((e) => e.year === yearOf(D))?.deathBenefit ?? 0;
      }
      // 死亡退職金
      if (point === "contingency") {
        const flows: readonly Flow[] = [
          ...ctx.call<{ flows: readonly Flow[] }>("retirement.benefit", { member: X }).flows,
          ...ctx.call<{ flows: readonly Flow[] }>("contingency.lumpSum", {}).flows,
        ];
        for (const f of flows) {
          if (f.formula === "retirement.benefit.deathAllowance" || f.formula === "contingency.lumpSum.retirementAllowance") retirement += f.amount;
          else if (f.formula === "retirement.benefit.guaranteeRemainder") other += f.amount;
        }
      } else {
        const givenRa = req.retirementAllowances?.find((r) => r.decedent === X)?.amount;
        if (givenRa !== undefined) retirement += givenRa;
        else {
          for (const r of ctx.call<{ receipts: readonly RetirementReceipt[] }>("retirement.receipts", { member: X }).receipts) {
            const m = parseYm(r.ym);
            if (r.source !== "retirement" || m <= D) continue;
            const f = parseYm(r.serviceFrom);
            const t = parseYm(r.serviceTo);
            retirement += t > D && D >= f ? ctx.money.mulRatio(r.amount, D - f + 1, t - f + 1, "conv.retirement.estimate") : D < f ? 0 : r.amount;
          }
        }
      }
      // 相続時精算課税で贈与した財産と、払った贈与税（受け取った人ごと）
      let settlement = 0;
      const credits = new Map<string, number>();
      const defaultPayer = (recipient: string): string | undefined =>
        relations.flatMap((r) => (r.type === "parentOf" && r.child === recipient ? [r.parent] : []))[0] ?? members.find((m) => m.kind === "self")?.id;
      for (const m of members) {
        if (m.id === X) continue;
        const gifts = ctx.call<GiftReceivedOutput>("gift.received", { member: m.id }).gifts;
        // 精算課税は一度選ぶと同じ贈与者のその後の贈与にも当たる（gift.tax）ので、精算課税の贈与がある人は亡くなる月までの贈与の年をすべて見る
        if (!gifts.some((g) => g.method === "settlement")) continue;
        const years = [...new Set(gifts.filter((g) => parseYm(g.ym) <= D).map((g) => yearOf(parseYm(g.ym))))].sort((a, b) => a - b);
        for (const y of years) {
          const t = ctx.call<GiftTaxOutput>("gift.tax", { member: m.id, year: y });
          for (const e of t.settlementByGiver ?? []) {
            let giver = e.member;
            if (giver === undefined && e.giver.startsWith("household|")) {
              const goal = goals.find((g) => e.objects.includes(g.id));
              giver = goal !== undefined ? defaultPayer(goal.owner) : undefined;
            }
            if (giver !== X) continue;
            settlement += e.amount;
            credits.set(m.id, (credits.get(m.id) ?? 0) + e.tax);
          }
        }
      }
      const funeral = req.funeral ?? 0;

      // 非課税と課税価格
      const insExempt = Math.min(insurance, ctx.money.mulRatio(at.paramYen(P.insurance) ?? yen(0), N, 1, "conv.exact"));
      const retExempt = Math.min(retirement, ctx.money.mulRatio(at.paramYen(P.retirement) ?? yen(0), N, 1, "conv.exact"));
      const realEval = ctx.money.mulRate(yen(realMarket), realRatio, "conv.asset.valuation");
      const gross = financial + realEval + other + (insurance - insExempt) + (retirement - retExempt) + settlement;
      const T = at.money.round(yen(Math.max(0, gross - debtTotal - funeral)), P.taxableRound);
      const basic = yen((at.paramYen(P.base) ?? 0) + ctx.money.mulRatio(at.paramYen(P.perHeir) ?? yen(0), N, 1, "conv.exact"));
      const assets: PointResult["assets"] = {
        financial: yen(financial),
        realEstateMarket: yen(realMarket),
        realEstate: realEval,
        other: yen(other),
        insurance: yen(insurance),
        insuranceExempt: yen(insExempt),
        retirement: yen(retirement),
        retirementExempt: yen(retExempt),
        settlementGifts: yen(settlement),
        debts: yen(debtTotal),
        funeral: yen(funeral),
        taxablePrice: T,
      };
      if (hasHome) cautions.add("smallLandSpecial");
      const heirIds = new Set(heirs.filter((h) => h.counted).map((h) => h.member));
      if ([...credits.keys()].some((id) => !heirIds.has(id))) cautions.add("settlementGiftToNonHeir");
      const heirsOut = heirs.map((h) => ({
        member: h.member,
        relation: h.relation,
        outside: h.outside,
        counted: h.counted,
        ...(h.share !== null ? { share: fmtFrac(h.share) } : {}),
        ...(h.adopted ? { adopted: true } : {}),
        ...(h.representing !== undefined ? { representing: h.representing } : {}),
      }));
      const r: PointResult = { ...empty(N === 0 ? "noHeirs" : "ok"), assets, heirs: heirsOut, heirCount: N, heirCountOverridden: given !== undefined, basicDeduction: basic, margin: yen(basic - T), noTax: T <= basic };
      if (N === 0) {
        cautions.add("noHeirs");
        results.push({ ...r, cautions: [...cautions].sort() });
        continue;
      }
      // 税の総額を出す相続人と法定相続分（数を直したときは、配偶者のほかを同じ順位で等分とみなす）
      const spouseHeir = heirs.find((h) => h.relation === "spouse");
      type Slot = { member?: string; count?: number; outside: boolean; share: [bigint, bigint]; spouse: boolean };
      let slots: Slot[];
      if (given === undefined) slots = heirs.filter((h) => h.counted && h.share !== null).map((h) => ({ member: h.member, outside: h.outside, share: h.share as [bigint, bigint], spouse: h.relation === "spouse" }));
      else {
        const rest = Math.max(0, N - (spouseHeir !== undefined ? 1 : 0));
        const rank = heirs.find((h) => h.relation !== "spouse" && h.counted)?.relation ?? "child";
        const sp: [bigint, bigint] = spouseHeir === undefined ? [0n, 1n] : rest === 0 ? [1n, 1n] : rank === "child" || rank === "grandchild" ? [1n, 2n] : rank === "sibling" ? [3n, 4n] : [2n, 3n];
        slots = [];
        if (spouseHeir !== undefined) slots.push({ member: spouseHeir.member, outside: spouseHeir.outside, share: sp, spouse: true });
        if (rest > 0) slots.push({ count: rest, outside: heirs.some((h) => h.relation !== "spouse" && h.outside), share: frac(sp[1] - sp[0], sp[1]), spouse: false });
      }
      const taxable = yen(Math.max(0, T - basic));
      let total = 0;
      const table = at.paramBrackets(P.table);
      if (taxable > 0 && table !== null) {
        for (const s of slots) {
          const n = s.count ?? 1;
          // 1人あたりの取得金額（等分のまとめた行は人数で割る）
          const each = at.money.mulRatio(taxable, s.share[0], s.share[1] * BigInt(n), P.taxableRound);
          const b = bracketFor(table, each);
          const t = b.rate === undefined ? 0 : Math.max(0, ctx.money.mulRate(each, b.rate, "conv.tax.exact") - (b.amount ?? 0));
          total += t * n;
        }
      }
      const totalTax = at.money.round(yen(total), P.totalRound);
      const floor = at.paramYen(P.spouseFloor) ?? yen(0);
      let red = 0;
      let creditSum = 0;
      let payable = 0;
      let payableHousehold = 0;
      let payableOutside = 0;
      let refund = 0;
      const byHeir: PointResult["byHeir"] = [];
      for (const s of slots) {
        const acquisition = ctx.money.mulRatio(T, s.share[0], s.share[1], "conv.tax.allocate");
        const tax = ctx.money.mulRatio(totalTax, s.share[0], s.share[1], "conv.tax.allocate");
        let sRed = 0;
        if (s.spouse && T > 0) {
          const legal = ctx.money.mulRatio(T, s.share[0], s.share[1], "conv.tax.allocate");
          const lim = Math.min(acquisition, Math.max(floor, legal));
          // 相続税法19条の2: 相続税の総額×（配偶者の課税価格と「1億6,000万円か法定相続分の額の多い方」の小さい方）÷課税価格の合計
          sRed = Math.min(tax, ctx.money.mulRatio(totalTax, lim, T, "conv.tax.allocate"));
        }
        const credit = s.member !== undefined ? (credits.get(s.member) ?? 0) : 0;
        const before = tax - sRed;
        const pay = at.money.round(yen(Math.max(0, before - credit)), P.taxRound);
        const back = Math.max(0, credit - before);
        red += sRed;
        creditSum += credit;
        payable += pay;
        refund += back;
        if (s.outside) payableOutside += pay;
        else payableHousehold += pay;
        byHeir.push({
          ...(s.member !== undefined ? { member: s.member } : {}),
          ...(s.count !== undefined ? { count: s.count } : {}),
          outside: s.outside,
          acquisition,
          tax,
          spouseReduction: yen(sRed),
          credit: yen(credit),
          payable: pay,
          refund: yen(back),
        });
      }
      const override = req.overrides?.find((o) => o.point === point && (o.decedent === undefined || o.decedent === X));
      results.push({
        ...r,
        taxableEstate: taxable,
        totalTax,
        spouseReduction: yen(red),
        settlementCredit: yen(creditSum),
        byHeir,
        payable: yen(payable),
        payableHousehold: yen(payableHousehold),
        payableOutside: yen(payableOutside),
        refund: yen(refund),
        amount: override !== undefined ? override.amount : yen(payable),
        state: override !== undefined ? "confirmed" : "estimated",
        cautions: [...cautions].sort(),
      });
    }
    // 目安（推定）であることと、不動産の評価の割合に既定（時価の80%）を使ったこと
    if (results.some((p) => p.status === "ok")) ctx.notice("N_ESTIMATED", ["inheritanceTax.estimate"]);
    if (req.realEstateRatio === undefined && results.some((p) => p.assets.realEstateMarket > 0)) ctx.notice("N_DEFAULT_USED", ["inheritanceTax.realEstateRatio"]);
    return { points: results, notIncluded: NOT_INCLUDED };
  },
});
