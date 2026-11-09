// 必要保障額の推移（6.3）: 構成員ごとに「この年に亡くなったら」を1年ずつずらした連続計算。差し込み口 slot.protection.method の公式の考え方。
// 改訂6（0170）: 遺族の収支は、亡くなる人がその月に亡くなる想定（万一の重ね）で世帯の全体を計算し直したお金の動き（ctx.deathScenario。
// 万一のタブの「死亡」の場面の表と同じ計算）から組み立てる。全体の計算は遺族ごとに1回だけ（最初の年に亡くなる想定。遺族が変わる年は
// その年にもう1回）にし、ほかの年は、その表の「亡くなる月の翌月から」の分を使う（どの年に亡くなっても、亡くなった後のお金の動きは、
// 前の年の所得で決まる税・保険料などのほかは同じとみなす）。亡くなる年ごとに変わる物（遺族年金・死亡退職金・確定拠出年金の死亡一時金・
// 加入中の死亡保険金・団信で消える返済の額・金融資産）は、年ごとに求める。改訂5までは万一なしの計算の部品の結果から組み立てていた
// （遺族の国保・国民年金・修学支援・亡くなった人の介護・家賃などがずれた。0005 の追記 2026-10-09 の「近似」を 0170 で狭めた）。
// 亡くなる月はその年の1月（計算基準年は計算基準月）。遺族は死亡の当時の配偶者（いなければ子）。
// - 積み上げ方式（標準）: 死亡の月の翌月から期間の終わり（標準は配偶者の平均余命。簡易生命表の主な年齢の値を年齢で補間。配偶者がいなければ末子の独立）までの
//   必要な資金から準備できる資金を引き、諸費用（整理資金・予備の生活資金（遺族の生活費の n か月分））を足す。金融資産（亡くなる年の前の年末）を
//   含めない額（need）と、含めて引いた額（needWithAssets）を出し、加入中の死亡保険金（亡くなった人が被保険者の契約の、亡くなる月の死亡保障額）と並べる。
//   名目の額で、割り引かない
//   - 必要な資金（場面の表の支出の行）: 生活費（基本生活費の行。遺族の割合・生活費の万一のときの扱いは場面の計算が当てる）・住居費（住居関連費と
//     負債の返済）・教育費・保険料・介護・税と社会保険料・そのほか（周期的な支出・FP顧問料・不動産の経費・車など）
//   - 準備できる資金: 遺族年金（年ごとに pension.survivor）・遺族の収入（遺族〔配偶者〕の収入と、世帯の名の収入・亡くなった人の名で続く収入
//     〔賃料・不動産の売却など〕）・公的な支援（児童手当・就学支援金と修学支援・奨学金の受け取り）
//   - 税と社会保険料は、遺族の名の物と、世帯の国保（国民健康保険・任意継続）と、亡くなった人の名で死亡の年の後に帰属する物（相続した物件の
//     賃料の所得税など）。亡くなった人の死亡の年までの所得の税（準確定申告・翌年の住民税）は数えない
//   - 現状の検算の差（使途不明金。expense.reconcile）は万一なしの計算の額（今の世帯の検算で、亡くなる年で変わらない）
//   - 数えない行: 子・世帯の外の家族の収入と税、取り崩して使うお金・ゆとりの支出・上場株式等と暗号資産の譲渡益の税・相続税（資産の残り方で
//     変わる）、死亡で受け取る一時金と保険（年ごとに別に求める）・整理資金（要求の値）
//   - 亡くなった人の車（改訂2）: 万一のときの扱い（onContingency。死亡に当てるもの）を入れていない車は数えない（入れた車と遺族の車は、場面の計算が割合を当てる）。
//     改訂7 からは場面の表のとおりに数える（下）
// - 逆算方式: 遺族の年ごとの収支で金融資産を前提の運用利回りで伸ばし、遺族（配偶者）が指定の年齢（省略は期間の終わり）になるまで残高が負に
//   ならない最小の保険金（死亡の月に受け取る）を求める（金融資産を含まない額と含む額）。指定の年齢が期間の終わりより後なら、その年齢まで見る（改訂6）
// - 遺族年金の2028年4月の見直しは作らない（pension.survivor の知らせ）
// - 内訳（改訂5・約束の版 1.1。0054）: 年ごとに、必要な資金を生活費・住居費・教育費・保険料・介護・税と社会保険料・そのほか（毎年の分）と
//   整理資金・予備の生活資金（一時の分）に、準備できる資金を遺族年金・遺族の収入・児童手当と教育の公的支援（毎年の分）と死亡退職金・
//   確定拠出年金の死亡一時金・弔慰金（一時の分）に分けて出す（breakdown。合計は expenses・resources と同じ）。団信で消える住宅ローンの
//   返済の額（万一なしの返済のうち、亡くなる月より前に借りた団信の対象の負債の分）も添える。加入中の死亡保険金は契約ごとの内訳（coverageBy）も出し、
//   家族特約など契約の被保険者でない人が被保険者の保障（insurance.policy の others）も、その人の死亡保障に数える
// - 死亡退職金（改訂6）: 見込み額を勤続の月数（死亡の月まで÷予定の終わりまで）で按分する。勤続の始まりより前に亡くなるなら0
// - 改訂7・約束の版 1.2（0173）:
//   - 小規模企業共済の死亡を事由とする共済金（亡くなる年の前の年末の残高。計算基準年は計算基準月の前の残高）を準備できる資金（一時の分）に数え、
//     内訳の lumpResources.mutualAidLump に出す。確定拠出年金の死亡一時金も、計算基準年は計算基準月の前の残高にした（前は0円）
//   - 亡くなった人の車も、場面の表のとおりに数える（前は「万一のときの扱い」を入れていない車を数えなかった。場面の計算は、亡くなった人の名義の物を
//     相続する人が持ち続ける。0173）
//   - 配偶者がいない（遺族が子）ときは、亡くなった人の器（不動産など）から相続した子の名で入る収入（家賃・売却の代金など）も遺族の収入に数える
//     （子の税は前と同じく数えない近似）
// - 改訂8（0173 の追記・利用者の判断 2026-11-09）: 亡くなった人の車で万一のときの扱いを入れていない物は、場面の計算で手放す（expense.car 改訂6。
//   買い替え・維持費が止まり、亡くなる前に組んだ自動車ローンの返済だけ遺族が続ける）。最初の年の表を後の年に使うと、その間に組んだローンの返済が
//   抜けるので、亡くなった後の買い替えが変わる車（扱いを入れていない亡くなる人の車と、死亡で「止める」「割合を変える」を入れた車）のローンを
//   亡くなる月までにいくつ組んだかでも表を分ける（その年にもう1回計算する）
import {
  addMonths,
  childrenOf,
  defineComponent,
  formatYm,
  monthIndex,
  parseYm,
  spousesAt,
  yearOf,
  yen,
  type AccountInput,
  type AnnualRow,
  type CarInput,
  type CarOutput,
  type DebtInput,
  type Flow,
  type FlowsResult,
  type IdecoAccountOutput,
  type InsuranceContractInput,
  type InsurancePolicyOutput,
  type MemberInput,
  type MonthIndex,
  type MutualAidOutput,
  type ProtectionRequest,
  type Rate,
  type RelationInput,
  type RetirementReceipt,
  type SurvivorPensionOutput,
  type Yen,
} from "../../sdk/index.ts";

const LIFE = "lifeTable.lifeExpectancy";
const START = "pension.normalStartAge";
const NOT_FINANCIAL: ReadonlySet<string> = new Set(["realEstate", "insurance"]);

type Breakdown = {
  expenses: { living: Yen; housing: Yen; education: Yen; premiums: Yen; care: Yen; taxSi: Yen; other: Yen };
  lump: { funeral: Yen; reserve: Yen };
  resources: { survivorPension: Yen; survivorIncome: Yen; publicSupport: Yen };
  lumpResources: { retirementAllowance: Yen; dcLump: Yen; condolence: Yen; mutualAidLump?: Yen };
  creditLife: Yen;
};

type Year = {
  breakdown: Breakdown;
  coverageBy?: { object: string; amount: Yen }[];
  year: number;
  death: string;
  horizon: number;
  need: Yen;
  needWithAssets: Yen;
  coverage: Yen;
  expenses: Yen;
  resources: Yen;
  lumpSum: Yen;
  assets: Yen;
};

/** 亡くなる年 y の前の年末の器の残高（計算基準年は、その年の初めの残高＝年末−掛金−運用益＋受け取り。改訂7） */
function balanceBefore(years: readonly { readonly year: number; readonly contributions: Yen; readonly payout: Yen; readonly returns: Yen; readonly closing: Yen }[], y: number): number {
  const prev = years.find((e) => e.year === y - 1);
  if (prev !== undefined) return prev.closing;
  const cur = years.find((e) => e.year === y);
  if (cur === undefined || years.some((e) => e.year < y)) return 0;
  return Math.max(0, cur.closing - cur.contributions - cur.returns + cur.payout);
}

/** 場面の表の行の区画（必要な資金・準備できる資金） */
const SECTIONS = ["living", "housing", "education", "premiums", "care", "taxSi", "other", "survivorIncome", "publicSupport"] as const;
type Section = (typeof SECTIONS)[number];

/** 死亡で起きる受け取り・支払い（亡くなる年ごとに別に求めるので、場面の表からは数えない） */
const DEATH_FORMULAS: ReadonlySet<string> = new Set([
  "retirement.benefit.deathAllowance",
  "retirement.benefit.guaranteeRemainder",
  "account.ideco.deathLumpSum",
  "account.mutualAid.deathLumpSum",
  "insurance.policy.death",
  "insurance.policy.incomeProtection",
]);
const SKIP_ROWS: ReadonlySet<string> = new Set([
  // 保険の受け取り（加入中の死亡保険金として並べる）・整理資金（要求の値）
  "cf.income.lumpSum.insurance",
  "cf.income.other.insuranceBenefit",
  "cf.expense.lumpSum.funeral",
  // 資産の残り方で変わる行
  "cf.expense.living.drawdown",
  "cf.expense.living.surplus",
  "cf.taxSi.incomeTax.capitalGains",
  "cf.taxSi.residentTax.capitalGains",
  "cf.taxSi.incomeTax.cryptoAsset",
  "cf.taxSi.residentTax.cryptoAsset",
  "cf.taxSi.inheritanceTax",
]);
const PUBLIC_SUPPORT: ReadonlySet<string> = new Set(["cf.income.benefit.childAllowance", "cf.income.benefit.education", "cf.income.other.scholarship"]);
/** 世帯の国保（世帯主の名で出る） */
const isHouseholdHealth = (formula: string): boolean => formula.startsWith("socialInsurance.nationalHealth.") || formula.startsWith("socialInsurance.continuation.");

/** 支出の行の区画 */
function expenseSection(f: Flow): Section | null {
  const row = f.row;
  if (f.formula.startsWith("expense.car.")) return "other";
  if (row === "cf.expense.living.car") return "other";
  if (row.startsWith("cf.expense.living")) return "living";
  if (row.startsWith("cf.expense.housing") || row.startsWith("cf.expense.debt")) return "housing";
  if (row.startsWith("cf.expense.education")) return "education";
  if (row.startsWith("cf.expense.insurance")) return "premiums";
  if (row.startsWith("cf.expense.care")) return "care";
  if (row.startsWith("cf.expense")) return "other";
  return null;
}

export default defineComponent<{ request: ProtectionRequest }, { method: "accumulation" | "reverse"; members: { member: string; survivor?: string; years: Year[] }[] }>({
  id: "protection.need",
  title: "必要保障額の推移（積み上げ方式・逆算方式）",
  contract: "1.2",
  revision: 8,
  requires: {
    "plan.cashflow": ">=1 <2",
    "expense.car": ">=1 <2",
    "debt.schedule": ">=1 <2",
    "insurance.policy": ">=1 <2",
    "pension.survivor": ">=1 <2",
    "retirement.receipts": ">=1 <2",
    "account.ideco": ">=1 <2",
    "account.mutualAid": ">=1 <2",
    "expense.reconcile": ">=1 <2",
  },
  params: [LIFE, START],
  reads: [
    "member.kind",
    "member.birth",
    "member.sex",
    "member.leaves",
    "relation.type",
    "relation.a",
    "relation.b",
    "relation.from",
    "relation.to",
    "relation.parent",
    "relation.child",
    "car.owner",
    "car.onContingency",
    "debt.debtors",
    "debt.creditLife",
    "debt.start",
    "insurance.insured",
    "account.kind",
    "account.owner",
    "account.marketValue",
    "assumptions.investmentReturn",
  ],
  replaceable: true,
  input: "protection.need.input",
  output: "protection.need.output",
  compute(input, ctx) {
    const req = input.request;
    const method = req.method ?? "accumulation";
    const { base, end } = ctx.time;
    const baseYear = yearOf(base);
    const endYear = yearOf(end);
    const N = end - base + 1;
    const members = ctx.list<MemberInput>("member");
    const relations = ctx.list<RelationInput>("relation");
    // 月ごとの額の累積（prefix[i] は計算基準月から i か月分の合計）
    const prefixOf = (flows: readonly Flow[], pick: (f: Flow) => boolean = () => true): number[] => {
      const arr = new Array<number>(N + 1).fill(0);
      for (const f of flows) {
        if (!pick(f)) continue;
        const i = parseYm(f.ym) - base;
        if (i < 0 || i >= N) continue;
        (arr as number[])[i + 1] = (arr[i + 1] as number) + f.amount;
      }
      for (let i = 1; i <= N; i++) arr[i] = (arr[i] as number) + (arr[i - 1] as number);
      return arr;
    };
    const sum = (p: readonly number[], a: MonthIndex, b: MonthIndex): number => {
      const i = Math.max(0, a - base);
      const j = Math.min(N - 1, b - base);
      return j < i ? 0 : (p[j + 1] as number) - (p[i] as number);
    };
    const kindOf = new Map(members.map((m) => [m.id, m.kind]));
    // 亡くなる人の器（相続した子の名で入る収入を遺族の収入に数える。改訂7）
    const accountsOf = (X: string): ReadonlySet<string> => new Set(ctx.list<Pick<AccountInput, "id" | "owner">>("account").filter((a) => a.owner === X).map((a) => a.id));
    // 場面の表（死亡の想定で全体を計算し直した表）を区画ごとの累積にする。遺族（配偶者）ごと
    type World = { sections: Record<Section, number[]>; lateTaxes: { m: MonthIndex; accrual: number; amount: number }[] };
    const worldOf = (X: string, D: MonthIndex, spouse: string | undefined): World => {
      // エンジンは必要保障額を求めるとき、いつも用意する（null は部品を単独で動かしたときだけ）
      const flows = ctx.deathScenario(X, D) ?? [];
      const own = accountsOf(X);
      const pick = new Map<Section, Flow[]>(SECTIONS.map((k) => [k, []]));
      const lateTaxes: World["lateTaxes"] = [];
      for (const f of flows) {
        if (SKIP_ROWS.has(f.row) || DEATH_FORMULAS.has(f.formula) || f.formula.startsWith("pension.survivor") || f.formula.startsWith("contingency.lumpSum") || f.formula.startsWith("expense.reconcile.")) continue;
        const who = f.member;
        let k: Section | null = null;
        if (f.row.startsWith("cf.expense")) k = expenseSection(f);
        else if (f.row.startsWith("cf.income")) {
          if (PUBLIC_SUPPORT.has(f.row)) k = "publicSupport";
          // 遺族（配偶者）・世帯の名の収入と、亡くなった人の名で続く収入（相続した物件の賃料・売却など）
          else if (who === undefined || who === X || (spouse !== undefined && who === spouse)) k = "survivorIncome";
          // 配偶者がいなければ、亡くなる人の器から相続した子の名で入る収入
          else if (spouse === undefined && f.object !== undefined && own.has(f.object)) k = "survivorIncome";
        } else if (f.row.startsWith("cf.taxSi")) {
          if (isHouseholdHealth(f.formula) && kindOf.get(who ?? "") !== "child") k = "taxSi";
          else if (spouse !== undefined && who === spouse) k = "taxSi";
          else if (who === X) lateTaxes.push({ m: parseYm(f.ym), accrual: f.accrualYear, amount: f.amount });
        }
        if (k !== null) (pick.get(k) as Flow[]).push(f);
      }
      // 現状の検算の差（使途不明金）は、万一なしの計算の額（今の世帯の検算。亡くなる年で変わらない）
      for (const f of reconcile) {
        const k = expenseSection(f);
        if (k !== null) (pick.get(k) as Flow[]).push(f);
      }
      const sections = {} as Record<Section, number[]>;
      for (const k of SECTIONS) sections[k] = prefixOf(pick.get(k) as Flow[]);
      return { sections, lateTaxes };
    };
    const worlds = new Map<string, World>();
    const reconcile = ctx.call<{ flows: readonly Flow[] }>("expense.reconcile", {}).flows;

    const debts = ctx.list<Pick<DebtInput, "id" | "debtors" | "creditLife" | "start">>("debt").map((d) => ({ d, start: ctx.time.resolve(d.start), p: prefixOf(ctx.call<FlowsResult>("debt.schedule", { object: d.id }).flows) }));
    const contracts = ctx.list<Pick<InsuranceContractInput, "id" | "insured">>("insurance");
    const policies = contracts.map((c) => ({ id: c.id, insured: c.insured, years: ctx.call<InsurancePolicyOutput>("insurance.policy", { object: c.id }).years }));
    // 金融資産（年末）
    const annual = ctx.call<{ annual: readonly AnnualRow[] }>("plan.cashflow", {}).annual;
    const financial = new Map(annual.filter((a) => a.row === "cf.balance.financial").map((a) => [a.year, a.amount]));
    let initial = 0;
    for (const a of ctx.list<Pick<AccountInput, "kind" | "marketValue">>("account")) if (!NOT_FINANCIAL.has(a.kind)) initial += a.marketValue.value ?? 0;
    const assetsAt = (y: number): number => (y > baseYear ? (financial.get(y - 1) ?? 0) : initial);

    // 平均余命（簡易生命表の主な年齢の値を補間。性別ごと）
    // 事務所の既定値で「推定で埋めない」にしたとき（0111 の2回目）は、平均余命の目安を引かない（期間は90歳まで。知らせ N_INPUT_REQUIRED）
    const lifeFills = ctx.fillsByEstimate("lifeExpectancy");
    const lifeMonths = (z: string, at: MonthIndex): number | null => {
      if (!lifeFills) return null;
      const m = ctx.at(at < base ? base : at);
      if (!m.has(LIFE, { member: z })) return null;
      const table = m.paramBrackets(LIFE, { member: z });
      if (table === null || table.length === 0) return null;
      const birth = parseYm((members.find((x) => x.id === z) as MemberInput).birth.birthYearMonth);
      const age = Math.floor((at - birth) / 12);
      let lo = table[0] as { upTo: number | null; rate?: Rate };
      let hi = lo;
      for (const r of table) {
        if (r.upTo === null) continue;
        if ((r.upTo as number) <= age) lo = r as typeof lo;
        if ((r.upTo as number) >= age) {
          hi = r as typeof hi;
          break;
        }
        hi = r as typeof hi;
      }
      const toMonths = (r: Rate) => {
        const f = ctx.rate.fraction(ctx.rate.mulInt(r, 12));
        return Number(f.num / f.den);
      };
      const e0 = lo.rate === undefined ? 0 : toMonths(lo.rate);
      const e1 = hi.rate === undefined ? e0 : toMonths(hi.rate);
      const a0 = (lo.upTo as number) ?? age;
      const a1 = (hi.upTo as number) ?? age;
      if (a1 === a0 || age <= a0) return age <= a0 ? e0 : e1;
      if (age >= a1) return e1;
      ctx.notice("N_ESTIMATED", ["lifeTable.interpolated"]);
      return Math.floor(e0 + ((e1 - e0) * (age - a0)) / (a1 - a0));
    };
    const ageMonthOf = (z: string, years: number) => addMonths(parseYm((members.find((x) => x.id === z) as MemberInput).birth.birthYearMonth), years * 12);

    // 亡くなった後の買い替えが変わる車の自動車ローンを借りた月（亡くなる人ごと。改訂8）
    const cars = ctx.list<Pick<CarInput, "id" | "owner" | "onContingency">>("car");
    const carLoans = new Map<string, Map<string, MonthIndex[]>>();
    const loanStartsOf = (owner: string): Map<string, MonthIndex[]> => {
      let m = carLoans.get(owner);
      if (m === undefined) {
        m = new Map();
        for (const l of ctx.call<CarOutput>("expense.car", { member: owner }).loans) if (l.start !== undefined) m.set(l.object, [...(m.get(l.object) ?? []), parseYm(l.start)]);
        carLoans.set(owner, m);
      }
      return m;
    };
    const changedLoans = (X: string): MonthIndex[] => {
      const out: MonthIndex[] = [];
      for (const c of cars) {
        const on = c.onContingency;
        const changes = on === undefined ? c.owner === X : on.mode !== "continue" && (on.kinds ?? ["death"]).includes("death");
        if (changes) out.push(...(loanStartsOf(c.owner).get(c.id) ?? []));
      }
      return out;
    };

    const targets = req.members ?? members.filter((m) => m.kind === "self" || m.kind === "spouse").map((m) => m.id);
    const out: { member: string; survivor?: string; years: Year[] }[] = [];
    for (const X of targets) {
      const xm = members.find((m) => m.id === X);
      if (xm === undefined) continue;
      const startAge = ctx.at(base).paramCount(START) ?? 65;
      const from = Math.max(req.fromYear ?? baseYear, baseYear);
      const to = Math.min(req.toYear ?? yearOf(ageMonthOf(X, startAge)), endYear);
      const years: Year[] = [];
      let survivorId: string | undefined;
      const xLoans = changedLoans(X);
      for (let y = from; y <= to; y++) {
        const D = (y === baseYear ? base : monthIndex(y, 1)) as MonthIndex;
        const xLeaves = xm.leaves === null ? null : ctx.time.resolve(xm.leaves);
        if (xLeaves !== null && xLeaves <= D) break;
        const spouse = spousesAt(ctx, relations, X, D)[0];
        const kids = childrenOf(members, relations, X).filter((c) => parseYm(c.birth.birthYearMonth) <= D);
        const Z = spouse ?? kids.sort((a, b) => (a.birth.birthYearMonth < b.birth.birthYearMonth ? -1 : 1))[0]?.id;
        if (Z === undefined) continue;
        survivorId = Z;
        // 期間の終わり
        let H: MonthIndex;
        const hz = req.horizon ?? { kind: "lifeExpectancy" };
        // 遺族が子（配偶者がいない）のときの「平均余命まで」は、子の平均余命ではなく末子の独立までにする（子の性別を計算に使わない。0054 の追記 2026-10-27）
        const byIndependence = hz.kind === "youngestIndependence" || spouse === undefined;
        if (hz.kind === "age" && hz.age !== undefined) H = ageMonthOf(Z, hz.age);
        else if (byIndependence) {
          H = D;
          for (const c of kids) {
            const own = c.leaves === null ? addMonths(ctx.time.ageSwitch(c.id, { years: req.survivor?.independenceAge ?? 22 }, "firstMarch31AfterReach"), 1) : ctx.time.resolve(c.leaves);
            if (own > H) H = own;
          }
        } else {
          const lm = lifeMonths(Z, D);
          if (lm === null) {
            ctx.notice("N_INPUT_REQUIRED", [lifeFills ? "lifeTable.lifeExpectancy" : "lifeTable.noFill", "protection.horizon"]);
            H = ageMonthOf(Z, 90);
          } else H = addMonths(D, lm);
        }
        if (H > end) {
          ctx.notice("N_PROTECTION_TRUNCATED", ["protection.horizon", String(endYear)]);
          H = end;
        }
        const A = addMonths(D, 1);
        // 逆算方式で目標の年齢が期間の終わりより後なら、その年齢まで年ごとの収支を作る（改訂6）
        const until = method === "reverse" && req.reverseUntilAge !== undefined ? ageMonthOf(Z, req.reverseUntilAge) : H;
        const last = (until > H ? (until > end ? end : until) : H) as MonthIndex;
        // 場面の表: 遺族（配偶者）と、亡くなる月までに組んだ（亡くなった後の買い替えが変わる車の）自動車ローンの数が同じ間は、最初に亡くなる年の表を使う
        const wKey = `${X}|${spouse ?? ""}|${xLoans.filter((s0) => s0 <= D).length}`;
        let w = worlds.get(wKey);
        if (w === undefined) {
          w = worldOf(X, D, spouse);
          worlds.set(wKey, w);
        }
        const world = w;
        const deathYear = yearOf(D);
        // 年ごとの必要な資金と準備できる資金（死亡の月の翌月から last まで。内訳と合計は H まで）
        const sp = [...ctx.call<SurvivorPensionOutput>("pension.survivor", { member: Z, death: { member: X, month: formatYm(D) } }).flows];
        // 配偶者が遺族厚生年金の受給権の無い夫（死亡の当時55歳未満）なら、遺族厚生年金は子が受け取る（pension.survivor 改訂6）
        if (spouse !== undefined && members.find((m) => m.id === spouse)?.sex !== "female") {
          for (const c of kids) for (const f of ctx.call<SurvivorPensionOutput>("pension.survivor", { member: c.id, death: { member: X, month: formatYm(D) } }).flows) sp.push(f);
        }
        const yearly: { year: number; exp: number; res: number }[] = [];
        const part = { living: 0, housing: 0, education: 0, premiums: 0, care: 0, taxSi: 0, other: 0, survivorPension: 0, survivorIncome: 0, publicSupport: 0, creditLife: 0 };
        // [a, b] の区画ごとの額
        const sums = (a: MonthIndex, b: MonthIndex) => {
          const v = (k: Section) => sum(world.sections[k], a, b);
          let taxSi = v("taxSi");
          // 亡くなった人の名で、死亡の年の後に帰属する税（相続した物件の賃料の所得税など）
          for (const x of world.lateTaxes) if (x.accrual > deathYear && x.m >= a && x.m <= b) taxSi += x.amount;
          let pension = 0;
          for (const f of sp) {
            const m = parseYm(f.ym);
            if (m >= a && m <= b) pension += f.amount;
          }
          // 団信で消える返済（万一なしの返済のうち、亡くなる月より前に借りた、団信の対象に亡くなる人がいる負債の分。表示だけ）
          let creditLife = 0;
          for (const { d, start, p } of debts) {
            const cl = d.creditLife;
            if (cl === undefined || start > D || !cl.covered.includes(X) || !(cl.events ?? ["death"]).includes("death")) continue;
            const share = d.debtors.find((x) => x.member === X)?.share;
            const ratio = cl.spouseJoint === true ? "1" : (cl.ratio ?? (d.debtors.length > 1 && share !== undefined ? share : "1"));
            const s0 = sum(p, a, b);
            creditLife += s0 === 0 ? 0 : ctx.money.mulRate(yen(s0), ctx.rate.of(ratio), "conv.expense.share");
          }
          return { living: v("living"), housing: v("housing"), education: v("education"), premiums: v("premiums"), care: v("care"), taxSi, other: v("other"), survivorPension: pension, survivorIncome: v("survivorIncome"), publicSupport: v("publicSupport"), creditLife };
        };
        let totalExp = 0;
        let totalRes = 0;
        for (let t = yearOf(A); t <= yearOf(last); t++) {
          const a = (t === yearOf(A) ? A : monthIndex(t, 1)) as MonthIndex;
          const b = (t === yearOf(last) ? last : monthIndex(t, 12)) as MonthIndex;
          const x = sums(a, b);
          const expOf = (q: typeof x) => q.living + q.other + q.housing + q.care + q.education + q.taxSi + q.premiums;
          const resOf = (q: typeof x) => q.publicSupport + q.survivorIncome + q.survivorPension;
          yearly.push({ year: t, exp: expOf(x), res: resOf(x) });
          // 内訳と合計は期間の終わり H まで
          if (a > H) continue;
          const q = b > H ? sums(a, H) : x;
          for (const k of Object.keys(part) as (keyof typeof part)[]) part[k] += q[k];
          totalExp += expOf(q);
          totalRes += resOf(q);
        }
        // 一時の資金: 死亡退職金（勤続の月数で按分。勤続の始まりより前に亡くなるなら0）・確定拠出年金の死亡一時金・弔慰金と、整理資金・予備の生活資金
        let retirementAllowance = 0;
        const given = req.survivor?.deathBenefits;
        if (given?.retirementAllowance !== undefined) retirementAllowance += given.retirementAllowance;
        else {
          for (const r of ctx.call<{ receipts: readonly RetirementReceipt[] }>("retirement.receipts", { member: X }).receipts) {
            const m = parseYm(r.ym);
            if (r.source !== "retirement" || m <= D) continue;
            const f = parseYm(r.serviceFrom);
            const tt = parseYm(r.serviceTo);
            if (D < f) continue;
            retirementAllowance += tt > D ? ctx.money.mulRatio(r.amount, D - f + 1, tt - f + 1, "conv.retirement.estimate") : r.amount;
          }
        }
        let dcLump = 0;
        for (const acc of ctx.call<IdecoAccountOutput>("account.ideco", { member: X }).accounts) dcLump += balanceBefore(acc.years, y);
        // 小規模企業共済の死亡を事由とする共済金（改訂7）
        let mutualAidLump = 0;
        for (const acc of ctx.call<MutualAidOutput>("account.mutualAid", { member: X }).accounts) mutualAidLump += balanceBefore(acc.years, y);
        const condolence = given?.condolence ?? 0;
        const lumpRes = retirementAllowance + dcLump + mutualAidLump + condolence;
        // 予備の生活資金: 遺族の生活費（場面の表の、死亡の月の翌月の基本生活費。万一のときの扱いの割合を当てた後）の n か月分
        const reserveMonthly = yen(sum(world.sections.living, A, A));
        const funeral = req.survivor?.funeral ?? 0;
        const reserve = ctx.money.mulRatio(reserveMonthly, req.survivor?.reserveMonths ?? 0, 1, "conv.exact");
        const lumpCost = funeral + reserve;
        const assets = assetsAt(y);
        let need: number;
        let needWithAssets: number;
        if (method === "accumulation") {
          need = Math.max(0, totalExp - totalRes + lumpCost - lumpRes);
          needWithAssets = Math.max(0, need - assets);
        } else {
          // 逆算方式: 遺族の年ごとの収支で残高を運用利回りで伸ばし、目標の年齢まで負にならない最小の保険金（二分探索）
          const lastYear = yearOf(until > last ? last : until);
          const ok = (start: number, L: number): boolean => {
            let bal = start + L + lumpRes - lumpCost;
            if (bal < 0) return false;
            for (const x of yearly) {
              if (x.year > lastYear) break;
              const r = ctx.assumption("investmentReturn", x.year);
              const net = x.res - x.exp;
              bal = bal + net + ctx.money.mulRate(yen(bal > 0 ? bal : 0), r, "conv.investment.return");
              if (bal < 0) return false;
            }
            return true;
          };
          const solve = (start: number): number => {
            if (ok(start, 0)) return 0;
            let lo = 0;
            let hi = 1000000;
            while (!ok(start, hi) && hi < 10000000000000) hi *= 2;
            while (hi - lo > 1000) {
              const mid = Math.floor((lo + hi) / 2 / 1000) * 1000;
              if (mid <= lo) break;
              if (ok(start, mid)) hi = mid;
              else lo = mid;
            }
            return hi;
          };
          need = solve(0);
          needWithAssets = solve(assets);
        }
        // 加入中の死亡保険金（亡くなる人が被保険者の契約の、亡くなる月の死亡保障額。家族特約などで X が被保険者の保障も。0054・改訂6）
        let coverage = 0;
        const coverageBy: { object: string; amount: Yen }[] = [];
        for (const p of policies) {
          const e = p.years.find((x) => x.year === y)?.start;
          const v = (p.insured === X ? (e?.deathBenefit ?? 0) : 0) + (e?.others?.find((o) => o.member === X)?.deathBenefit ?? 0);
          coverage += v;
          if (v > 0) coverageBy.push({ object: p.id, amount: yen(v) });
        }
        const breakdown: Breakdown = {
          expenses: { living: yen(part.living), housing: yen(part.housing), education: yen(part.education), premiums: yen(part.premiums), care: yen(part.care), taxSi: yen(part.taxSi), other: yen(part.other) },
          lump: { funeral: yen(funeral), reserve: yen(reserve) },
          resources: { survivorPension: yen(part.survivorPension), survivorIncome: yen(part.survivorIncome), publicSupport: yen(part.publicSupport) },
          lumpResources: { retirementAllowance: yen(retirementAllowance), dcLump: yen(dcLump), condolence: yen(condolence), ...(mutualAidLump > 0 ? { mutualAidLump: yen(mutualAidLump) } : {}) },
          creditLife: yen(part.creditLife),
        };
        years.push({
          year: y,
          death: formatYm(D),
          horizon: yearOf(H),
          need: yen(need),
          needWithAssets: yen(needWithAssets),
          coverage: yen(coverage),
          expenses: yen(totalExp + lumpCost),
          resources: yen(totalRes + lumpRes),
          lumpSum: yen(lumpCost),
          assets: yen(assets),
          breakdown,
          ...(coverageBy.length > 0 ? { coverageBy } : {}),
        });
      }
      out.push({ member: X, ...(survivorId !== undefined ? { survivor: survivorId } : {}), years });
    }
    return { method, members: out };
  },
});
