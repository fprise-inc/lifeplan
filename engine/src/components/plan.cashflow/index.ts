// 計算のはじめに呼ぶ部品: お金の動きと年間収支（plan.flows）から、資産の器ごとの残高・運用益・取り崩しを年ごとに出す（0008 の9・0003 の3）。
// お金の動きを集めるのは plan.flows（運用利回りだけが変わったときに集め直さずに済むように分けた。0005 の追記）。
// - 決済口座（settlement の器。省略は最初の預金。預金が無ければ名義の無い預金）に、その年の収支（収入−税・社会保険料−支出）が入る。
//   積立（器の間の移動。NISA・課税口座・財形・持株会・積立預金。iDeCo・企業型DC の本人の掛金は ideco.contribution）は決済口座から出る
// - 運用益: 器ごとに、期首残高×年利＋その年の器への出入り×年利×1/2（0003 の3。年利は資産クラスの配分×資産クラスの利回り。accountReturnRate）。
//   iDeCo・企業型DC は account.ideco が計算する（受け取りの年齢まで引き出せない）
// - NISA: 積立は年間投資枠（つみたて・成長）と非課税保有限度額（簿価。成長投資枠は内数）の残りで止める。売った簿価の分の枠は翌年に復活する。
//   口座を開けるのはその年1月1日に18歳以上の年（生年月で判定。1月2日生まれは1年遅れる近似）。こどもNISA（2027年から）は年間投資枠と
//   非課税保有限度額で止め、成人の年からは成人の NISA になる（簿価は成人の枠に数える）
// - 旧NISA・ジュニアNISA: 買付の年ごとの内訳（lots）の非課税期間が終わった年の年末に、時価で課税口座へ移す（取得価額はその時価）。
//   ジュニアNISA は非課税期間（5年）の終わりと18歳（1月1日）の前の年の終わりの遅い方
// - 取り崩し: 決済口座の年末の残高が minimumDeposit（省略は0）を下回ったら、取り崩しの順序（assumptions.withdrawal.order。省略は
//   預金・外貨預金・財形・課税口座・暗号資産〔0124〕・持株会・旧NISA・NISA）の器から年末に売って補う。課税口座は売った額の取得価額（取得価額×売る額÷時価）との差に
//   上場株式等の譲渡益の税（所得税・復興特別所得税・防衛特別所得税と住民税。源泉徴収ありの特定口座とみなす）をかけ、手取りで足りるだけ売る。
//   引き出せない期間（withdrawalLockedUntil）の器・iDeCo・企業型DC・不動産は取り崩さない。補えなかった額は資金不足（cf.balance.shortfall）
// - 年ごとの行: 年間収支（譲渡益の税を引いた後）・運用益・金融資産の合計・器ごとの残高・負債の残高・NISA の非課税保有限度額の残り・資金不足
// - 小規模企業共済は account.mutualAid が残高と受け取りを計算する（掛金は決済口座から出る）。自動車ローン（expense.car）・教育ローンと
//   貸与の奨学金（education.cost）の年末残高も負債の残高（cf.balance.debt.other）に載せる
// - 現状の検算（expense.reconcile。年間収支を読むのでここで呼ぶ）の使途不明金を、お金の動きと年間収支に足す
// - 改訂7（約束の版 1.2）: ストレステストの資産の時価の下落（前提 marketShocks。その年の年末に器の時価をその割合だけ下げ、運用益に含める。
//   既定の器は預金・外貨預金・財形・不動産・保険・小規模企業共済を除く）。保険契約の解約返戻金を器ごとの残高の行（cf.balance.account.insurance。
//   契約の ID。金融資産の合計には入れない）に載せる。保障内容一覧・払込保険料の推移の材料と贈与税を details（エンジンが summary に写す）に出す
// - 改訂8: 持ち家の残高（cf.balance.account.realEstate）を housing.valuation の評価額（土地は上昇率、建物は耐用年数で減らす。売った年からは載せない）に
//   した。車の評価額（asset.car）を cf.balance.account.car に載せる。器の種類「その他の資産」（otherAsset。評価額の増減率 valueGrowth、省略は0）を足した。
//   不動産・車・その他の資産・保険の解約返戻金は、金融資産の合計に入れず、取り崩さない
// - 改訂9（約束の版 1.3。0026）: まとめた金融資産の器（pooled。合計の入れ方・まだ口座に分けていない分）は、決済口座の次に取り崩す（税なし）。
//   NISA のつみたて投資枠の年間の枠を超えた積立は、成長投資枠の残りに入れる。それも超えた分は、前提 investment.nisaOverflow が taxable なら
//   名義人の課税口座へ（無ければ作る）、省略・deposit なら決済口座に残す。iDeCo・企業型DC の受け取り（payout.destination が invest）は、
//   受け取った年に、受け取った額（税を引く前）を名義人の NISA（その年の枠の残り）へ、残りを課税口座へ移す。課税口座の税を毎年の運用益に
//   かける前提（investment.taxableTax が annual）では、運用益から上場株式等の税を引いて取得価額を時価にそろえる（税の行には出さない近似）。
//   取り崩しの計画（investment.drawdown）: 始まりの月から、毎月の額（fixed）か、年の初めの金融資産×率（rate）を金融資産から使う。
//   その年の収支の不足（年間収支−本人の掛金がマイナスの分）より多い分を「取り崩して使うお金」（cf.expense.living.drawdown）として年間収支から引く。
//   時価の下落に資産クラス（assetClasses）を書いたときは、配分のうちその資産クラスの割合だけ下げる
// - 改訂10: 不動産の評価額を土地と建物の行に分けた（cf.balance.account.realEstate.land・.building。持ち家は housing.valuation、住まい以外の
//   不動産で中身 property を入れた器は asset.realEstate）。中身の無い不動産の器は、今までどおり評価額の増減率で1行（cf.balance.account.realEstate）。
//   不動産の合計は cf.balance.account.realEstate の下の行の合計（0028）
// - 改訂11（0031）: 黒字のうち貯まる割合（前提 surplusSaving）。年間収支から一時金の収入（cf.income.lumpSum）を除いた額が黒字の年だけ、
//   黒字×割合（上限 cap。期間で変える changes）を貯まる額とし、残りを「ゆとりの支出」（cf.expense.living.surplus）として年間収支から引く（取り崩しの計画の前）。
//   まとめた金融資産の器の運用しない分（uninvested）は預金の利回りで、残りに器の利回りをかける
// - 改訂12（0031 の追記）: 生活防衛資金（改訂11の前提 emergencyReserve・器 reserve・行 cf.balance.financial.reserveTarget／usable）をなくした。
//   取り崩しの計画（investment.drawdown）がある年（始まりの年から）は、ゆとりの支出を差し引かない（計画が使うお金を決めているので二重に引かない）
// - 改訂13（0040）: 器の利回りの段階（returnStages。年ごとに器の利回りか資産の配分を変え、少しずつ移す）と例外の年（returnExceptions）。
//   資産配分の入れ方の段階（investment.allocation.stages）は、計算の前に運用する器の利回りの段階に写す（engine/investment.ts）。
//   資産クラスを書いた時価の下落は、その年の段の配分で割合を出す
// - 改訂14（約束の版 1.4。0042）: 世帯の外の家族のお金（member.wallet）を入れた人ごとの、尽きる見込みの月（outside.wallet）を details に出す
//   （エンジンが summary の outsideWallets に写す）
// - 改訂15（約束の版 1.5。0054）: details の保険の一覧に、年末までの払込保険料の累計（paid）・家族特約の人ごとの死亡保障額（others）・保障の行の被保険者（insured）を添える
// - 改訂16（約束の版 1.6。0009 の追記）: 住まい以外の不動産（asset.realEstate）の物件ごとの年末の評価額・不動産所得の内訳・売却を details の realEstate に写す
//   （エンジンが summary の realEstate に写す。帳票の入力の物件ごとの数字の材料。計算は変えない）
// - 改訂18（約束の版 1.7。0082）: 収益不動産の分析の数字（asset.realEstateAnalysis の出力のまま）を details の realEstateAnalysis に写す
//   （エンジンが summary の realEstateAnalysis に写す。計算は変えない）
// - 改訂19（約束の版 1.8。0104）: 子が返す貸与の奨学金（education.cost の childRepaid）を details の childScholarships に写す
//   （エンジンが summary の childScholarships に写す。返済は世帯のお金の動き・負債に入れない）
// - 改訂17（0081）: details の realEstate に、asset.realEstate の約束の版 1.1 の任意の欄（所得の区分 incomeKind・事業的規模の目安の units。
//   売却の譲渡所得の内訳は sale の中）も写す。計算は変えない
// - 改訂20（0122）: 器の種類「暗号資産」（cryptoAsset）を足した。金融資産の合計に入れ、残高は cf.balance.account.cryptoAsset。取り崩さない
//   （売ったときの利益は雑所得〔総合課税〕で、ほかの所得と合わせた税をここでは計算できないため）。器の利回りも資産の配分も無ければ利回りは0。
//   既定の時価の下落（kinds を書かない下落）の対象にする（資産クラスを書いた下落は、配分を入れた暗号資産だけ）。積立は cf.transfer.savings.cryptoAsset
// - 改訂21（0124）: 暗号資産を取り崩す（既定の順序では課税口座の次）。令和8年度税制改正の特定暗号資産の申告分離課税（制度データ incomeTax.cryptoAsset.rate・
//   residentTax.cryptoAsset.rate。2028年から）で、売った額の取得価額との差に所得税・復興特別所得税・防衛特別所得税と住民税をかけ、手取りで足りるだけ売る
//   （課税口座と同じ。税は売った年に引く近似）。税の行は cf.taxSi.incomeTax.cryptoAsset・cf.taxSi.residentTax.cryptoAsset。譲渡損失は名義人ごとに
//   incomeTax.cryptoAsset.lossCarryforwardYears 年（3年）繰り越し、同じ年と翌年以後の暗号資産の利益から古い順に引く（ほかの所得・課税口座とは通算しない）。
//   税率が無い年（2027年まで）と、売ったときの税の扱いが雑所得（cryptoTaxation が miscellaneous）の暗号資産は取り崩さない
import {
  accountReturnRate,
  accountMixAt,
  shockShare,
  type CarValuationOutput,
  type HousingValuationOutput,
  type RealEstateAnalysisOutput,
  type RealEstateOutput,
  addMonths,
  addYen,
  ageMonth,
  RATE_ONE,
  annualReturn,
  boxValue,
  defineComponent,
  formatYm,
  hasWallet,
  monthIndex,
  monthOf,
  netByYear,
  RATE_ZERO,
  yearOf,
  yen,
  type AccountInput,
  type AccountKind,
  type AnnualRow,
  type CashflowDetails,
  type DebtInput,
  type DebtScheduleOutput,
  type EducationCostOutput,
  type Flow,
  type GiftTaxOutput,
  type IdecoAccountOutput,
  type InsuranceContractInput,
  type InsurancePolicyOutput,
  type MarketShock,
  type InvestmentSetting,
  type IdecoContributionOutput,
  type MemberInput,
  type MonthIndex,
  type MutualAidOutput,
  type Rate,
  type SurplusSavingSetting,
  type Yen,
} from "../../sdk/index.ts";

const N = {
  tsumitate: "nisa.annualLimit.tsumitate",
  growth: "nisa.annualLimit.growth",
  lifetime: "nisa.lifetimeLimit",
  lifetimeGrowth: "nisa.lifetimeLimit.growth",
  age: "nisa.eligibleAge",
  childAnnual: "nisa.child.annualLimit",
  childLifetime: "nisa.child.lifetimeLimit",
  childWithdrawal: "nisa.child.withdrawalAge",
  general: "nisa.legacy.generalPeriodYears",
  tsumitateYears: "nisa.legacy.tsumitatePeriodYears",
  junior: "nisa.junior.untilAge",
};
const T = {
  it: "incomeTax.listedSecurities.rate",
  rt: "residentTax.listedSecurities.rate",
  itRound: "incomeTax.listedSecurities.withholding.rounding",
  rtRound: "residentTax.listedSecurities.rounding",
  recon: "incomeTax.reconstructionSurtax.rate",
  defense: "incomeTax.defenseSurtax.rate",
};
/** 特定暗号資産の申告分離課税（0124。2027年までは制度なし＝値が無い） */
const C = {
  it: "incomeTax.cryptoAsset.rate",
  rt: "residentTax.cryptoAsset.rate",
  carry: "incomeTax.cryptoAsset.lossCarryforwardYears",
};

/** 残高に入れない器（不動産・保険の解約返戻金・その他の資産） */
const NOT_FINANCIAL: ReadonlySet<string> = new Set(["realEstate", "insurance", "otherAsset"]);
/** 既定の取り崩しの順序 */
const DEFAULT_ORDER: readonly AccountKind[] = ["deposit", "fxDeposit", "zaikei", "taxable", "cryptoAsset", "esop", "legacyNisa", "nisa"];
/** 取り崩さない器（受け取りの年齢までの iDeCo・企業型DC、不動産・その他の資産）。暗号資産は2028年から取り崩す（0124。雑所得の物は取り崩さない） */
const NEVER_WITHDRAWN: ReadonlySet<string> = new Set(["ideco", "corporateDc", "realEstate", "otherAsset"]);
const TRANSFER_ROW: Readonly<Record<string, string>> = {
  taxable: "cf.transfer.investment",
  zaikei: "cf.transfer.savings.zaikei",
  esop: "cf.transfer.savings.esop",
  deposit: "cf.transfer.savings.deposit",
  fxDeposit: "cf.transfer.savings.deposit",
  cryptoAsset: "cf.transfer.savings.cryptoAsset",
};

interface Lot {
  readonly vintage: number;
  readonly regime: "general" | "tsumitate" | "junior";
  cost: Yen;
  value: Yen;
}

interface Acc {
  readonly id: string | null;
  readonly input: AccountInput | null;
  /** 残高の行の器の種類（こどもNISA は成人の年から nisa） */
  kind: string;
  readonly owner: string | null;
  value: Yen;
  cost: Yen;
  /** NISA の取得価額のうち成長投資枠の分 */
  growthCost: Yen;
  lots: Lot[] | null;
  /** その年の器への出入り（運用益の計算に使う） */
  inflow: Yen;
  ret: Yen;
  /** 入力の無い器（エンジンが作った課税口座・NISA）の利回りの元にする器（0026） */
  like?: AccountInput | null;
  /** まとめた金融資産の器の運用しない分（0031） */
  uninvested?: Yen;
}

interface Frame {
  used: Yen;
  usedGrowth: Yen;
  restore: Yen;
  restoreGrowth: Yen;
}

/** 時価の下落の既定で下げない器 */
const SHOCK_EXEMPT: ReadonlySet<string> = new Set(["deposit", "fxDeposit", "zaikei", "realEstate", "insurance", "smallBusinessMutualAid", "otherAsset"]);
const under = (row: string, prefix: string) => row === prefix || row.startsWith(prefix + ".");

export default defineComponent<Record<string, never>, { flows: readonly Flow[]; annual: AnnualRow[]; parts: readonly (readonly Flow[])[]; details?: CashflowDetails }>({
  id: "plan.cashflow",
  title: "キャッシュフロー表",
  contract: "1.8",
  revision: 21,
  requires: {
    "plan.flows": ">=1 <2",
    "outside.wallet": ">=1 <2",
    "insurance.policy": ">=1 <2",
    "gift.received": ">=1 <2",
    "gift.tax": ">=1 <2",
    "expense.reconcile": ">=1 <2",
    "expense.car": ">=1 <2",
    "education.cost": ">=1 <2",
    "account.mutualAid": ">=1 <2",
    "ideco.contribution": ">=1 <2",
    "account.ideco": ">=1 <2",
    "debt.schedule": ">=1 <2",
    "housing.valuation": ">=1 <2",
    "asset.realEstate": ">=1 <2",
    "asset.realEstateAnalysis": ">=1 <2",
    "asset.car": ">=1 <2",
  },
  params: [...Object.values(N), ...Object.values(T), ...Object.values(C)],
  reads: [
    "member.kind",
    "member.outside",
    "member.wallet",
    "account.kind",
    "account.owner",
    "account.marketValue",
    "account.costBasis",
    "account.cryptoTaxation",
    "account.assetMix",
    "account.settlement",
    "account.withdrawalLockedUntil",
    "account.contributions",
    "account.frame",
    "account.lots",
    "account.valueGrowth",
    "account.expectedReturn",
    "account.returnStages",
    "account.returnExceptions",
    "account.fee",
    "account.payout",
    "account.property",
    "account.uninvested",
    "debt.kind",
    "debt.debtors",
    "goal.kind",
    "goal.owner",
    "assumptions.investmentReturn",
    "assumptions.assetReturns",
    "assumptions.withdrawal",
    "assumptions.marketShocks",
    "assumptions.investment",
    "assumptions.returnShifts",
    "assumptions.surplusSaving",
    "insurance.template",
    "insurance.policyholder",
    "insurance.insured",
    "insurance.coverages",
  ],
  input: "empty.input",
  output: "plan.cashflow.output",
  compute(_input, ctx) {
    const { base, end } = ctx.time;
    const baseYear = yearOf(base);
    const endYear = yearOf(end);
    const collected = ctx.call<{ flows: readonly Flow[]; net: readonly { year: number; amount: Yen }[]; parts: readonly (readonly Flow[])[] }>("plan.flows", {});
    const net = new Map(collected.net.map((x) => [x.year, x.amount]));
    // 現状の検算の使途不明金（年間収支から引く）
    const reconciled = ctx.call<{ flows: readonly Flow[] }>("expense.reconcile", {}).flows;
    if (reconciled.length > 0) for (const [y, a] of netByYear(reconciled, ctx.conventions.aggregation, base, end)) net.set(y, yen((net.get(y) ?? 0) + a));
    const inputs = ctx.list<AccountInput>("account");
    const own: Flow[] = [];
    const annual: AnnualRow[] = [];
    const flow = (row: string, m: MonthIndex, amount: Yen, member: string | null, object: string | null, formula: string) => {
      if (amount === 0) return;
      own.push({ row, ym: formatYm(m), amount, accrualYear: yearOf(m), ...(member === null ? {} : { member }), ...(object === null ? {} : { object }), formula });
    };

    // 器（iDeCo・企業型DC は account.ideco）
    const accs: Acc[] = [];
    for (const a of inputs) {
      if (a.kind === "ideco" || a.kind === "corporateDc" || a.kind === "smallBusinessMutualAid") continue;
      // 中身を入れた不動産は asset.realEstate が評価する（土地と建物）
      if (a.kind === "realEstate" && a.property !== undefined) continue;
      const value = boxValue(a.marketValue) ?? yen(0);
      const cost = a.costBasis === undefined ? value : (boxValue(a.costBasis) ?? value);
      const lots = a.lots === undefined ? null : a.lots.map((l) => ({ vintage: l.vintageYear, regime: l.regime, cost: l.costBasis, value: l.marketValue }));
      accs.push({ id: a.id, input: a, kind: a.kind, owner: a.owner, value, cost, growthCost: yen(0), lots, inflow: yen(0), ret: yen(0) });
    }
    let settlement = accs.find((x) => x.input?.settlement === true) ?? accs.find((x) => x.kind === "deposit");
    if (settlement === undefined) {
      settlement = { id: null, input: null, kind: "deposit", owner: null, value: yen(0), cost: yen(0), growthCost: yen(0), lots: null, inflow: yen(0), ret: yen(0) };
      accs.unshift(settlement);
    }
    const D = settlement;
    // まとめた金融資産の器の運用しない分（0031）
    for (const x of accs) if (x.kind === "pooled" && x.input?.uninvested !== undefined && x.input.uninvested > 0) x.uninvested = x.input.uninvested;
    // NISA の枠（構成員ごと。frame が無ければ今の取得価額を消化した枠とみなす）
    const frames = new Map<string, Frame>();
    const frameOf = (owner: string): Frame => {
      let f = frames.get(owner);
      if (f === undefined) {
        f = { used: yen(0), usedGrowth: yen(0), restore: yen(0), restoreGrowth: yen(0) };
        frames.set(owner, f);
      }
      return f;
    };
    for (const x of accs) {
      if (x.kind !== "nisa" || x.owner === null) continue;
      const f = frameOf(x.owner);
      const given = x.input?.frame;
      f.used = addYen(f.used, given === undefined ? x.cost : given.lifetimeUsedCost);
      f.usedGrowth = addYen(f.usedGrowth, yen(given?.growthUsedCost ?? 0));
      x.growthCost = yen(given?.growthUsedCost ?? 0);
    }
    // 課税口座（旧NISA・ジュニアNISA の移し先。名義人の最初の課税口座。無ければ移す元の器の ID で作る）
    const taxableOf = (owner: string | null, from: Acc, like: AccountInput | null = null): Acc => {
      let t = accs.find((x) => x.kind === "taxable" && x.owner === owner);
      if (t === undefined) {
        t = { id: from.id, input: null, kind: "taxable", owner, value: yen(0), cost: yen(0), growthCost: yen(0), lots: null, inflow: yen(0), ret: yen(0), like };
        accs.push(t);
      }
      return t;
    };
    // 名義人の NISA（無ければ作る。iDeCo・企業型DC の受け取りを入れるとき。0026）
    const nisaOf = (owner: string, from: { id: string; like: AccountInput | null }): Acc => {
      let t = accs.find((x) => x.kind === "nisa" && x.owner === owner);
      if (t === undefined) {
        t = { id: from.id, input: null, kind: "nisa", owner, value: yen(0), cost: yen(0), growthCost: yen(0), lots: null, inflow: yen(0), ret: yen(0), like: from.like };
        accs.push(t);
      }
      return t;
    };
    const members = ctx.list<MemberInput>("member");
    const reach = new Map<string, MonthIndex>();
    const reachOf = (owner: string, id: string, at: MonthIndex): MonthIndex => {
      const key = `${owner}|${id}`;
      let m = reach.get(key);
      if (m === undefined) {
        m = ageMonth(ctx, at, id, owner);
        reach.set(key, m);
      }
      return m;
    };
    // その年1月1日に18歳以上か（成人の NISA）
    const adultIn = (owner: string, y: number) => reachOf(owner, N.age, monthIndex(y, 1)) < monthIndex(y, 1);

    // iDeCo・企業型DC（構成員ごと）と、本人が払う掛金（決済口座から出る）
    const dcYears = new Map<string, { kind: string; owner: string; byYear: Map<number, { closing: Yen; returns: Yen }> }>();
    const selfPaid = new Map<number, Yen>();
    // 受け取ったお金を運用に回す iDeCo・企業型DC の受け取り（年ごと。0026）
    const reinvest = new Map<number, { object: string; owner: string; ym: string; amount: Yen }[]>();
    for (const m of members) {
      const out = ctx.call<IdecoAccountOutput>("account.ideco", { member: m.id });
      for (const a of out.accounts) dcYears.set(a.object, { kind: a.kind, owner: m.id, byYear: new Map(a.years.map((y) => [y.year, { closing: y.closing, returns: y.returns }])) });
      for (const p of out.payments) {
        const a = inputs.find((x) => x.id === p.object);
        if (a?.payout?.destination !== "invest" || p.amount <= 0) continue;
        const py = Number(p.ym.slice(0, 4));
        reinvest.set(py, [...(reinvest.get(py) ?? []), { object: p.object, owner: m.id, ym: p.ym, amount: p.amount }]);
      }
      if (out.accounts.length === 0) continue;
      for (const p of ctx.call<IdecoContributionOutput>("ideco.contribution", { member: m.id }).payments) {
        if (p.payer !== "self") continue;
        const ym = ctx.time.resolve({ at: p.ym });
        if (ym < base) continue;
        selfPaid.set(yearOf(ym), addYen(selfPaid.get(yearOf(ym)) ?? yen(0), p.amount));
      }
    }
    // 小規模企業共済（構成員ごと。掛金は決済口座から出る）
    const mutualAid = new Map<string, { owner: string; byYear: Map<number, { closing: Yen; returns: Yen }> }>();
    for (const m of members) {
      const out = ctx.call<MutualAidOutput>("account.mutualAid", { member: m.id });
      for (const a of out.accounts) {
        mutualAid.set(a.object, { owner: m.id, byYear: new Map(a.years.map((y) => [y.year, { closing: y.closing, returns: y.returns }])) });
        for (const y of a.years) selfPaid.set(y.year, addYen(selfPaid.get(y.year) ?? yen(0), y.contributions));
      }
    }
    // 負債の年末残高と、購入した持ち家
    const debts: { d: Pick<DebtInput, "id" | "kind" | "debtors">; out: Pick<DebtScheduleOutput, "yearEnd"> }[] = ctx.list<DebtInput>("debt").map((d) => ({ d, out: ctx.call<DebtScheduleOutput>("debt.schedule", { object: d.id }) }));
    // ほかの部品が作った負債（自動車ローン・教育ローン・貸与の奨学金）
    for (const m of members) {
      for (const l of ctx.call<{ loans: readonly { object: string; yearEnd: DebtScheduleOutput["yearEnd"] }[] }>("expense.car", { member: m.id }).loans) {
        debts.push({ d: { id: l.object, kind: "car", debtors: [{ member: m.id, role: "primary" }] }, out: { yearEnd: l.yearEnd } });
      }
    }
    // 子が返す貸与の奨学金（education.cost の約束の版 1.1。世帯の負債に入れない。details に写す。0104）
    const childScholarships: NonNullable<EducationCostOutput["childRepaid"]>[number][] = [];
    const eduMembers = new Set<string>();
    for (const g of ctx.list<{ kind: string; owner: string }>("goal")) {
      if (g.kind !== "education") continue;
      const edu = ctx.call<EducationCostOutput>("education.cost", { member: g.owner });
      for (const l of edu.loans) {
        debts.push({ d: { id: l.object, kind: "other", debtors: [{ member: l.member, role: "primary" }] }, out: { yearEnd: l.yearEnd } });
      }
      if (!eduMembers.has(g.owner)) for (const c of edu.childRepaid ?? []) childScholarships.push(c);
      eduMembers.add(g.owner);
    }
    // 持ち家の評価額（年ごと）と車の評価額（金融資産の合計には入れない）
    const rentals = ctx.call<RealEstateOutput>("asset.realEstate", {}).properties;
    const homes = [...ctx.call<HousingValuationOutput>("housing.valuation", {}).properties, ...rentals].map((p) => ({ p, byYear: new Map(p.years.map((e) => [e.year, e])) }));
    const cars = ctx.call<CarValuationOutput>("asset.car", {}).cars.map((c) => ({ c, byYear: new Map(c.years.map((e) => [e.year, e.value])) }));

    // 積立の予定（器ごと・月ごと）
    const planned = new Map<number, { acc: Acc; m: MonthIndex; amount: Yen; tranche: string }[]>();
    for (const x of accs) {
      if (x.input === null || x.input.contributions.length === 0 || x === D) continue;
      for (const c of x.input.contributions) {
        const from = ctx.time.resolve(c.from);
        const to = c.to === null ? end : ctx.time.resolve(c.to);
        for (let m = from > base ? from : base; m <= to && m <= end; m = addMonths(m, 1)) {
          if (c.monthly <= 0) continue;
          const list = planned.get(yearOf(m)) ?? [];
          list.push({ acc: x, m, amount: c.monthly, tranche: c.tranche === "growth" ? "growth" : "tsumitate" });
          planned.set(yearOf(m), list);
        }
      }
    }

    // 取り崩しの順序（旧NISA・ジュニアNISA の移し先に作った課税口座も含めるため、取り崩すたびに器の一覧から決める）
    const setting = ctx.setting<{ order?: readonly ({ kind: string } | { object: string })[]; minimumDeposit?: Yen }>("withdrawal");
    const orderOf = (): Acc[] => {
      // まとめた金融資産の器（まだ口座に分けていない分）は、決済口座の次に取り崩す（0026）
      const order: Acc[] = accs.filter((x) => x.kind === "pooled" && x !== D);
      for (const o of setting?.order ?? DEFAULT_ORDER.map((kind) => ({ kind }))) {
        const hits = "object" in o ? accs.filter((x) => x.id === o.object && x.input !== null) : accs.filter((x) => (x.input === null ? x.kind : x.input.kind) === o.kind);
        for (const h of hits) if (h !== D && !order.includes(h) && !NEVER_WITHDRAWN.has(h.input?.kind ?? h.kind)) order.push(h);
      }
      return order;
    };
    const minimum = setting?.minimumDeposit ?? yen(0);
    const shocks = ctx.setting<readonly MarketShock[]>("marketShocks") ?? [];
    const invest = ctx.setting<InvestmentSetting>("investment");
    const overflowTaxable = invest?.nisaOverflow === "taxable";
    const taxAnnual = invest?.taxableTax === "annual";
    const dd = invest?.drawdown;
    const ddStart = dd === undefined ? null : ctx.time.resolve(dd.start);
    // 年の初めの金融資産（取り崩しの計画の率に使う。最初の年は入力の時価の合計）
    let openingFinancial = yen(0);
    for (const a of inputs) if (!NOT_FINANCIAL.has(a.kind)) openingFinancial = addYen(openingFinancial, boxValue(a.marketValue) ?? yen(0));
    // 黒字のうち貯まる割合（0031）: 始まりの組の後に、changes を from の年の順に重ねる（その年に当てはまる最後の組を使う）
    const surplusSet = ctx.setting<SurplusSavingSetting>("surplusSaving");
    const surplusRules: { year: number; ratio: Rate | null; cap: Yen | null }[] = [];
    if (surplusSet !== undefined) {
      const ruleOf = (r: { ratio?: string; cap?: Yen }) => ({ ratio: r.ratio === undefined ? null : ctx.rate.of(r.ratio), cap: r.cap === undefined ? null : r.cap });
      surplusRules.push({ year: baseYear, ...ruleOf(surplusSet) });
      const changes = (surplusSet.changes ?? []).map((c, i) => ({ i, year: yearOf(ctx.time.resolve(c.from)), ...ruleOf(c) }));
      changes.sort((a, b) => a.year - b.year || a.i - b.i);
      for (const c of changes) surplusRules.push({ year: c.year, ratio: c.ratio, cap: c.cap });
    }
    const surplusRuleOf = (y: number) => {
      let hit: (typeof surplusRules)[number] | null = null;
      for (const r of surplusRules) if (r.year <= y) hit = r;
      return hit;
    };
    const surplusOn = surplusRules.some((r) => (r.ratio !== null && ctx.rate.compare(r.ratio, RATE_ONE) < 0) || r.cap !== null);
    // 黒字から除く一時金の収入（退職金・満期金・相続・不動産の売却など。全部が貯まる）
    const lumpIncome = surplusOn ? netByYear(collected.flows.filter((f) => under(f.row, "cf.income.lumpSum")), ctx.conventions.aggregation, base, end) : new Map<number, Yen>();
    const depositRate = (y: number): Rate => accountReturnRate(ctx, { kind: "deposit" }, y);
    // 保険契約（解約返戻金・保障内容一覧・払込保険料の推移）
    const contracts = ctx.list<Pick<InsuranceContractInput, "id" | "template" | "policyholder" | "insured" | "coverages">>("insurance");
    const policies = contracts.map((c) => ({ c, out: ctx.call<InsurancePolicyOutput>("insurance.policy", { object: c.id }) }));
    let cappedNotice = false;
    // 器の年利: 不動産・その他の資産は評価額の増減率（valueGrowth）があればそれ。その他の資産と保険は、資産の配分が無ければ0
    // 譲渡益の税率（所得税・復興特別所得税・防衛特別所得税と住民税。課税口座を売るとき・毎年の運用益にかけるときだけ読む）
    const surtaxed = (at: ReturnType<typeof ctx.at>, itBase: Rate): Rate => {
      const recon = at.paramRate(T.recon) ?? RATE_ZERO;
      const defense = at.paramRate(T.defense) ?? RATE_ZERO;
      return ctx.rate.add(itBase, ctx.rate.add(ctx.rate.mul(itBase, recon), ctx.rate.mul(itBase, defense)));
    };
    const taxRatesAt = (at: ReturnType<typeof ctx.at>): [Rate, Rate] => [surtaxed(at, at.paramRate(T.it) ?? RATE_ZERO), at.paramRate(T.rt) ?? RATE_ZERO];
    // 特定暗号資産の申告分離課税の税率（0124）。制度の無い年（2027年まで）は null で、その年は暗号資産を取り崩さない
    const cryptoRatesAt = (at: ReturnType<typeof ctx.at>): [Rate, Rate] | null => {
      const it = at.paramRate(C.it);
      const rt = at.paramRate(C.rt);
      return it === null || rt === null ? null : [surtaxed(at, it), rt];
    };
    // 暗号資産の譲渡損失の繰越（名義人ごと。生じた年と額。0124）
    const cryptoLosses = new Map<string, { year: number; amount: Yen }[]>();
    const rateOf = (a: AccountInput, y: number): Rate => {
      if ((a.kind === "realEstate" || a.kind === "otherAsset") && a.valueGrowth !== undefined) return ctx.rate.of(a.valueGrowth);
      if ((a.kind === "insurance" || a.kind === "otherAsset") && a.assetMix === undefined) return RATE_ZERO;
      return accountReturnRate(ctx, a, y);
    };

    for (let y = baseYear; y <= endYear; y++) {
      const jan = monthIndex(y, 1);
      const dec = monthIndex(y, 12);
      const at = ctx.at(jan);
      const months = y === baseYear ? 13 - monthOf(base) : 12;
      for (const x of accs) {
        x.inflow = yen(0);
        x.ret = yen(0);
      }
      // 売った簿価の分の NISA の枠は翌年に復活する
      for (const f of frames.values()) {
        f.used = yen(f.used - f.restore);
        f.usedGrowth = yen(f.usedGrowth - f.restoreGrowth);
        f.restore = yen(0);
        f.restoreGrowth = yen(0);
      }
      // こどもNISA は成人の年から成人の NISA（簿価を成人の枠に数える）
      for (const x of accs) {
        if (x.kind !== "childNisa" || x.owner === null || !adultIn(x.owner, y)) continue;
        x.kind = "nisa";
        const f = frameOf(x.owner);
        f.used = addYen(f.used, x.cost);
      }
      // 1. 積立
      const used = new Map<string, { tsumitate: Yen; growth: Yen; child: Yen }>();
      const usedOf = (owner: string) => {
        let u = used.get(owner);
        if (u === undefined) {
          u = { tsumitate: yen(0), growth: yen(0), child: yen(0) };
          used.set(owner, u);
        }
        return u;
      };
      // 成人の NISA のその年の枠の残り（年間投資枠・非課税保有限度額。成長投資枠は成長の生涯の枠も）
      const nisaRoom = (owner: string, growth: boolean): number => {
        if (!adultIn(owner, y)) return 0;
        const f = frameOf(owner);
        const u = usedOf(owner);
        let room = Math.min((at.paramYen(growth ? N.growth : N.tsumitate) ?? 0) - (growth ? u.growth : u.tsumitate), (at.paramYen(N.lifetime) ?? 0) - f.used);
        if (growth) room = Math.min(room, (at.paramYen(N.lifetimeGrowth) ?? 0) - f.usedGrowth);
        return Math.max(0, room);
      };
      // 決済口座から器へ移す（積立・枠を超えた分・受け取りの運用）
      const move = (x: Acc, row: string, m: MonthIndex, amount: Yen, owner: string | null, formula: string) => {
        if (amount <= 0) return;
        flow(row, m, amount, owner, x.id, formula);
        x.inflow = addYen(x.inflow, amount);
        x.cost = addYen(x.cost, amount);
        D.inflow = yen(D.inflow - amount);
      };
      // NISA に入れる（つみたて投資枠 → 成長投資枠の順。growthFirst は成長投資枠だけ）。入らなかった額を返す
      const putNisa = (x: Acc, owner: string, amount: Yen, growthOnly: boolean, m: MonthIndex, formula: string): Yen => {
        let rest = amount;
        for (const growth of growthOnly ? [true] : [false, true]) {
          const put = yen(Math.min(rest, nisaRoom(owner, growth)));
          if (put <= 0) continue;
          const u = usedOf(owner);
          const f = frameOf(owner);
          if (growth) {
            u.growth = addYen(u.growth, put);
            f.usedGrowth = addYen(f.usedGrowth, put);
            x.growthCost = addYen(x.growthCost, put);
          } else u.tsumitate = addYen(u.tsumitate, put);
          f.used = addYen(f.used, put);
          move(x, growth ? "cf.transfer.nisa.growth" : "cf.transfer.nisa.tsumitate", m, put, owner, formula);
          rest = yen(rest - put);
        }
        return rest;
      };
      // NISA の枠を超えた分: 課税口座で続ける前提なら名義人の課税口座へ（0026）。そうでなければ決済口座に残す
      const overflow = (x: Acc, owner: string, amount: Yen, m: MonthIndex, formula: string) => {
        if (amount <= 0) return;
        cappedNotice = true;
        if (overflowTaxable) move(taxableOf(owner, x, x.input ?? x.like ?? null), "cf.transfer.investment", m, amount, owner, formula);
      };
      for (const p of planned.get(y) ?? []) {
        const x = p.acc;
        const owner = x.owner as string;
        if (x.kind === "childNisa") {
          const u = usedOf(owner);
          const annualLimit = at.paramYen(N.childAnnual);
          const lifetime = at.paramYen(N.childLifetime);
          const room = annualLimit === null || lifetime === null ? 0 : Math.min(annualLimit - u.child, lifetime - x.cost);
          const amount = yen(Math.max(0, Math.min(p.amount, room)));
          if (amount < p.amount) cappedNotice = true;
          u.child = addYen(u.child, amount);
          move(x, "cf.transfer.nisa.child", p.m, amount, owner, "plan.cashflow.contribution");
          continue;
        }
        if (x.kind === "nisa") {
          // つみたて投資枠の年間の枠を超えた分は成長投資枠の残りに入れ、それも超えた分は枠を超えた分の扱い（0026）
          const rest = putNisa(x, owner, p.amount, p.tranche === "growth", p.m, "plan.cashflow.contribution");
          overflow(x, owner, rest, p.m, "plan.cashflow.nisaOverflow");
          continue;
        }
        const row = TRANSFER_ROW[x.kind] ?? (x.kind === "pooled" ? "cf.transfer.savings.deposit" : null);
        if (x.kind === "legacyNisa" || x.kind === "juniorNisa" || row === null) {
          cappedNotice = true;
          continue;
        }
        move(x, row, p.m, p.amount, owner, "plan.cashflow.contribution");
      }
      // iDeCo・企業型DC の受け取りを運用に回す: 名義人の NISA（その年の枠の残り）へ、残りを課税口座へ（0026）
      for (const r of reinvest.get(y) ?? []) {
        const like = inputs.find((a) => a.id === r.object) ?? null;
        const m = ctx.time.resolve({ at: r.ym });
        const nisa = nisaOf(r.owner, { id: r.object, like });
        const rest = putNisa(nisa, r.owner, r.amount, false, m, "plan.cashflow.payoutReinvest");
        if (rest > 0) move(taxableOf(r.owner, nisa, like), "cf.transfer.investment", m, rest, r.owner, "plan.cashflow.payoutReinvest");
      }
      // 黒字のうち貯まる割合: 一時金の収入を除いた年間収支が黒字の年だけ、貯まらない分を「ゆとりの支出」として年間収支から引く（0031）
      // 取り崩しの計画がある年（始まりの年から）は差し引かない（計画が使うお金を決めているので、二重に差し引かない。0031 の追記）
      const drawdownYear = dd !== undefined && ddStart !== null && yearOf(ddStart) <= y;
      if (surplusOn && !drawdownYear) {
        const rule = surplusRuleOf(y);
        const n0 = net.get(y) ?? 0;
        const surplus = n0 - (lumpIncome.get(y) ?? 0);
        if (rule !== null && surplus > 0) {
          let saved = yen(surplus);
          if (rule.ratio !== null && ctx.rate.compare(rule.ratio, RATE_ONE) < 0) saved = ctx.rate.compare(rule.ratio, RATE_ZERO) <= 0 ? yen(0) : ctx.money.mulRate(yen(surplus), rule.ratio, "conv.surplus.saving");
          if (rule.cap !== null && saved > rule.cap) saved = rule.cap;
          const spend = yen(surplus - saved);
          if (spend > 0) {
            const first = y === baseYear ? base : jan;
            const parts = ctx.money.allocate(spend, Array.from({ length: 13 - monthOf(first) }, () => 1), "conv.flow.allocate", "first");
            parts.forEach((a, i) => flow("cf.expense.living.surplus", addMonths(first, i), a, null, null, "plan.cashflow.surplus"));
            net.set(y, yen(n0 - spend));
          }
        }
      }
      // 取り崩しの計画: 始まりの月から、毎月の額か年の初めの金融資産×率を使う。その年の収支の不足より多い分を年間収支から引く（0026）
      if (dd !== undefined && ddStart !== null && yearOf(ddStart) <= y) {
        const first = ddStart > (y === baseYear ? base : jan) ? ddStart : y === baseYear ? base : jan;
        const ddMonths = yearOf(first) === y ? 13 - monthOf(first) : 0;
        let want = yen(0);
        if (ddMonths > 0) {
          if (dd.method === "fixed") want = ctx.money.mulRatio(dd.monthly ?? yen(0), BigInt(ddMonths), 1n, "conv.flow.allocate");
          else if (dd.rate !== undefined && openingFinancial > 0) want = ctx.money.mulRatio(ctx.money.mulRate(openingFinancial, ctx.rate.of(dd.rate), "conv.flow.allocate"), BigInt(ddMonths), 12n, "conv.flow.allocate");
        }
        const shortage = Math.max(0, -((net.get(y) ?? 0) - (selfPaid.get(y) ?? 0)));
        const extra = yen(Math.max(0, want - shortage));
        if (extra > 0) {
          const parts = ctx.money.allocate(extra, Array.from({ length: ddMonths }, () => 1), "conv.flow.allocate", "first");
          parts.forEach((a, i) => flow("cf.expense.living.drawdown", addMonths(first, i), a, null, null, "plan.cashflow.drawdown"));
          net.set(y, yen((net.get(y) ?? 0) - extra));
        }
      }
      // 2. その年の収支と、本人が払う iDeCo・企業型DC の掛金
      D.inflow = yen(D.inflow + (net.get(y) ?? 0) - (selfPaid.get(y) ?? 0));
      // 3. 運用益
      for (const x of accs) {
        const opening = x.value;
        const spec = x.input ?? x.like ?? null;
        const r: Rate = x.input !== null ? rateOf(x.input, y) : accountReturnRate(ctx, { ...(x.like ?? {}), kind: x.kind }, y);
        // まとめた金融資産の器の運用しない分は預金の利回り、残りに器の利回り（0031）
        const idle = x.uninvested !== undefined && x.uninvested > 0 ? yen(Math.min(x.uninvested, Math.max(0, opening))) : yen(0);
        x.ret = idle > 0 ? addYen(annualReturn(ctx, yen(opening - idle), x.inflow, r, months), annualReturn(ctx, idle, yen(0), depositRate(y), months)) : annualReturn(ctx, opening, x.inflow, r, months);
        // 課税口座の税を毎年の運用益にかける前提: 運用益から税を引き、取得価額を時価にそろえる（0026）
        if (taxAnnual && x.kind === "taxable" && x.ret > 0) {
          const [itRate, rtRate] = taxRatesAt(at);
          x.ret = yen(x.ret - at.money.mulRate(x.ret, itRate, T.itRound) - at.money.mulRate(x.ret, rtRate, T.rtRound));
        }
        x.value = addYen(addYen(opening, x.inflow), x.ret);
        if (taxAnnual && x.kind === "taxable") x.cost = x.value;
        // ストレステスト: その年の年末に時価を下げる（運用益に含める）。資産クラスを書いた下落は、配分のうちその資産クラスの割合だけ（0026）
        for (const sh of shocks) {
          if (sh.year !== y || (sh.kinds !== undefined ? !sh.kinds.includes(x.kind as AccountKind) : SHOCK_EXEMPT.has(x.kind)) || x.value <= 0) continue;
          const mix = spec === null ? undefined : accountMixAt(ctx, spec, y);
          const share = shockShare(ctx, { kind: x.kind, ...(mix !== undefined ? { assetMix: mix } : {}) }, sh.assetClasses);
          if (share === null) continue;
          const exposed = x.uninvested !== undefined && x.uninvested > 0 ? yen(x.value - Math.min(x.uninvested, x.value)) : x.value;
          const drop = ctx.money.mulRate(exposed, ctx.rate.mul(ctx.rate.of(sh.drop), share), "conv.investment.return");
          x.value = yen(x.value - drop);
          x.ret = yen(x.ret - drop);
        }
        // 旧NISA・ジュニアNISA の内訳は、期首の時価の割合で年末の時価を分ける
        if (x.lots !== null && x.lots.some((l) => l.value > 0) && opening > 0) {
          const parts = ctx.money.allocate(x.value, x.lots.map((l) => l.value as number), "conv.flow.allocate", "first");
          x.lots.forEach((l, i) => (l.value = parts[i] as Yen));
        }
      }
      // 4. 非課税期間の終わり（年末に時価で課税口座へ）
      for (const x of accs) {
        if (x.lots === null || (x.kind !== "legacyNisa" && x.kind !== "juniorNisa")) continue;
        const keep: Lot[] = [];
        for (const l of x.lots) {
          let last: number;
          if (l.regime === "junior" || x.kind === "juniorNisa") {
            const reach18 = x.owner === null ? jan : reachOf(x.owner, N.junior, jan);
            last = Math.max(l.vintage + (at.paramCount(N.general) ?? 5) - 1, yearOf(reach18));
          } else last = l.vintage + (at.paramCount(l.regime === "tsumitate" ? N.tsumitateYears : N.general) ?? 5) - 1;
          if (last > y) {
            keep.push(l);
            continue;
          }
          const t = taxableOf(x.owner, x);
          t.value = addYen(t.value, l.value);
          t.cost = addYen(t.cost, l.value);
          x.value = yen(x.value - l.value);
          x.cost = yen(x.cost - l.cost > 0 ? x.cost - l.cost : 0);
          flow("cf.transfer.rollover", dec, l.value, x.owner, x.id, "plan.cashflow.rollover");
        }
        x.lots = keep;
      }
      // 5. 取り崩し
      let gainsTax = yen(0);
      let need = yen(minimum - D.value);
      if (need > 0) {
        // 譲渡益の税率（課税口座を売るときだけ読む）
        let rates: [Rate, Rate] | null = null;
        const taxRates = (): [Rate, Rate] => (rates ??= taxRatesAt(at));
        let cRates: [Rate, Rate] | null | undefined;
        const cryptoRates = (): [Rate, Rate] | null => (cRates === undefined ? (cRates = cryptoRatesAt(at)) : cRates);
        // 繰り越せる年を過ぎた暗号資産の譲渡損失を捨てる（繰り越せる年数が無い年は、残りをそのまま持つ）
        const carryYears = at.paramCount(C.carry);
        if (carryYears !== null) for (const list of cryptoLosses.values()) for (let i = list.length - 1; i >= 0; i--) if ((list[i] as { year: number }).year < y - carryYears) list.splice(i, 1);
        for (const x of orderOf()) {
          if (need <= 0) break;
          if (x.value <= 0) continue;
          const lock = x.input?.withdrawalLockedUntil;
          if (lock !== undefined && lock !== null && ctx.time.resolve(lock) >= dec) continue;
          // こどもNISA の払い出しは、その年3月31日に12歳である年（12歳に達する日がその年の3月31日以前）から
          if (x.kind === "childNisa" && (x.owner === null || at.paramCount(N.childWithdrawal) === null || reachOf(x.owner, N.childWithdrawal, jan) > monthIndex(y, 3))) continue;
          // 暗号資産は申告分離課税の年（2028年から）だけ、雑所得の物は取り崩さない（0124）
          const crypto = x.kind === "cryptoAsset";
          if (crypto && (x.input?.cryptoTaxation === "miscellaneous" || cryptoRates() === null)) continue;
          const taxed = x.kind === "taxable" || crypto;
          const lossKey = x.owner ?? "";
          const losses = crypto ? (cryptoLosses.get(lossKey) ?? []) : [];
          // 同じ名義人の、その年までに生じて繰り越している暗号資産の譲渡損失（その年の利益から引ける額）
          const carried = losses.reduce((sum, l) => sum + l.amount, 0);
          const costOf = (g: Yen) => (g >= x.value ? x.cost : ctx.money.mulRatio(x.cost, g, x.value, "conv.account.cost"));
          const taxOf = (g: Yen): [Yen, Yen] => {
            if (!taxed) return [yen(0), yen(0)];
            const gain = yen(g - costOf(g) - (crypto ? Math.min(Math.max(0, g - costOf(g)), carried) : 0));
            if (gain <= 0) return [yen(0), yen(0)];
            const [itRate, rtRate] = crypto ? (cryptoRates() as [Rate, Rate]) : taxRates();
            return [at.money.mulRate(gain, itRate, T.itRound), at.money.mulRate(gain, rtRate, T.rtRound)];
          };
          const netOf = (g: Yen) => {
            const [a, b] = taxOf(g);
            return g - a - b;
          };
          let g: Yen;
          if (netOf(x.value) <= need) g = x.value;
          else if (!taxed) g = need;
          else {
            // 手取りで足りる最も少ない売る額（二分探索）
            let lo = need as number;
            let hi = x.value as number;
            while (lo < hi) {
              const mid = Math.floor((lo + hi) / 2);
              if (netOf(yen(mid)) >= need) hi = mid;
              else lo = mid + 1;
            }
            g = yen(lo);
          }
          const sold = costOf(g);
          const [it, rt] = taxOf(g);
          // 暗号資産の譲渡損失は繰り越し、利益は繰り越した損失を古い順に使う（0124）
          if (crypto) {
            const gain = g - sold;
            if (gain < 0) cryptoLosses.set(lossKey, [...losses, { year: y, amount: yen(-gain) }]);
            else {
              let use = Math.min(gain, carried);
              for (const l of losses) {
                const take = Math.min(use, l.amount);
                l.amount = yen(l.amount - take);
                use -= take;
              }
              cryptoLosses.set(lossKey, losses.filter((l) => l.amount > 0));
            }
          }
          if (x.kind === "nisa" && x.owner !== null) {
            const f = frameOf(x.owner);
            const soldGrowth = x.growthCost > 0 ? ctx.money.mulRatio(x.growthCost, sold, x.cost > 0 ? x.cost : 1, "conv.account.cost") : yen(0);
            f.restore = addYen(f.restore, sold);
            f.restoreGrowth = addYen(f.restoreGrowth, soldGrowth);
            x.growthCost = yen(x.growthCost - soldGrowth);
          }
          if (x.lots !== null && x.lots.some((l) => l.value > 0) && x.lots.some((l) => l.cost > 0)) {
            const parts = ctx.money.allocate(yen(x.value - g), x.lots.map((l) => l.value as number), "conv.flow.allocate", "first");
            const costs = ctx.money.allocate(yen(x.cost - sold), x.lots.map((l) => l.cost as number), "conv.flow.allocate", "first");
            x.lots.forEach((l, i) => {
              l.value = parts[i] as Yen;
              l.cost = costs[i] as Yen;
            });
          }
          x.value = yen(x.value - g);
          x.cost = yen(x.cost - sold);
          flow("cf.transfer.withdrawal", dec, g, x.owner, x.id, "plan.cashflow.withdrawal");
          flow(crypto ? "cf.taxSi.incomeTax.cryptoAsset" : "cf.taxSi.incomeTax.capitalGains", dec, it, x.owner, x.id, crypto ? "plan.cashflow.cryptoGainsTax" : "plan.cashflow.capitalGainsTax");
          flow(crypto ? "cf.taxSi.residentTax.cryptoAsset" : "cf.taxSi.residentTax.capitalGains", dec, rt, x.owner, x.id, crypto ? "plan.cashflow.cryptoGainsTax" : "plan.cashflow.capitalGainsTax");
          gainsTax = yen(gainsTax + it + rt);
          const proceeds = yen(g - it - rt);
          D.value = addYen(D.value, proceeds);
          need = yen(need - proceeds);
        }
      }
      // 6. 年ごとの行
      const n = yen((net.get(y) ?? 0) - gainsTax);
      let financial = yen(0);
      let returns = yen(0);
      const balanceRow = (kind: string, amount: Yen, owner: string | null, object: string | null) =>
        annual.push({ row: `cf.balance.account.${kind}`, year: y, amount, ...(owner === null ? {} : { member: owner }), ...(object === null ? {} : { object }), formula: "plan.cashflow.account" });
      for (const x of accs) {
        balanceRow(x.kind, x.value, x.owner, x.id);
        if (NOT_FINANCIAL.has(x.kind)) continue;
        financial = addYen(financial, x.value);
        returns = addYen(returns, x.ret);
      }
      for (const [object, ma] of mutualAid) {
        const e = ma.byYear.get(y);
        if (e === undefined) continue;
        balanceRow("smallBusinessMutualAid", e.closing, ma.owner, object);
        financial = addYen(financial, e.closing);
        returns = addYen(returns, e.returns);
      }
      for (const { c, out } of policies) {
        const e = out.years.find((x) => x.year === y);
        if (e !== undefined && e.surrenderValue > 0) balanceRow("insurance", e.surrenderValue, c.policyholder, c.id);
      }
      for (const [object, dc] of dcYears) {
        const e = dc.byYear.get(y);
        if (e === undefined) continue;
        balanceRow(dc.kind, e.closing, dc.owner, object);
        financial = addYen(financial, e.closing);
        returns = addYen(returns, e.returns);
      }
      // 不動産（持ち家は housing.valuation、住まい以外は asset.realEstate の年末の評価額。土地と建物の行に分ける）と車（asset.car）
      for (const h of homes) {
        const v = h.byYear.get(y);
        if (v === undefined) continue;
        balanceRow("realEstate.land", v.land, h.p.owner, h.p.object);
        balanceRow("realEstate.building", v.building, h.p.owner, h.p.object);
      }
      for (const c of cars) {
        const v = c.byYear.get(y);
        if (v !== undefined) balanceRow("car", v, c.c.owner, c.c.object);
      }
      for (const { d, out } of debts) {
        const e = out.yearEnd.find((x) => x.year === y);
        if (e === undefined || (e.balance <= 0 && e.unpaidInterest <= 0)) continue;
        const member = (d.debtors.find((x) => x.role === "primary") ?? d.debtors[0])?.member;
        const who = member === undefined ? {} : { member };
        annual.push({ row: d.kind === "mortgage" ? "cf.balance.debt.mortgage" : "cf.balance.debt.other", year: y, amount: e.balance, ...who, object: d.id, formula: "plan.cashflow.debt" });
        if (e.unpaidInterest > 0) annual.push({ row: "cf.balance.debt.unpaidInterest", year: y, amount: e.unpaidInterest, ...who, object: d.id, formula: "plan.cashflow.debt" });
      }
      for (const [owner, f] of frames) {
        annual.push({ row: "cf.balance.nisaFrame", year: y, amount: yen(Math.max(0, (at.paramYen(N.lifetime) ?? 0) - f.used)), member: owner, formula: "plan.cashflow.nisaFrame" });
      }
      openingFinancial = financial;
      annual.push(
        { row: "cf.net", year: y, amount: n, formula: "plan.cashflow.net" },
        { row: "cf.balance.return", year: y, amount: returns, formula: "plan.cashflow.return" },
        { row: "cf.balance.financial", year: y, amount: financial, formula: "plan.cashflow.closing" },
      );
      if (D.value < 0) annual.push({ row: "cf.balance.shortfall", year: y, amount: yen(-D.value), formula: "plan.cashflow.shortfall" });
    }
    if (cappedNotice) ctx.notice("N_LIMIT_APPLIED", ["nisa.annualLimit"]);
    // parts は plan.flows のまま渡し、この部品の出したお金の動き（積立・取り崩し・譲渡益の税・移管）を足す（エンジンが表の集計を部品ごとに使い回す）
    if (reconciled.length > 0) for (const f of reconciled) own.push(f);
    const parts = own.length === 0 ? collected.parts : [...collected.parts, own];
    // 保障内容一覧と払込保険料の推移の材料・贈与税（エンジンが summary に写す）
    const details: CashflowDetails = {};
    if (policies.length > 0) {
      details.insurance = {
        contracts: policies.map(({ c }) => ({
          object: c.id,
          template: c.template,
          policyholder: c.policyholder,
          insured: c.insured,
          coverages: (c.coverages ?? []).map((x) => ({
            id: x.id,
            role: x.role,
            benefit: x.benefit,
            amount: x.amount,
            ...(x.from !== undefined ? { from: formatYm(ctx.time.resolve(x.from)) } : {}),
            ...(x.to !== undefined && x.to !== null ? { to: formatYm(ctx.time.resolve(x.to)) } : {}),
            ...(x.insured !== undefined && x.insured !== c.insured ? { insured: x.insured } : {}),
          })),
        })),
        byYear: policies.flatMap(({ c, out }) =>
          out.years.map((e) => ({ year: e.year, object: c.id, premium: e.premium, deathBenefit: e.deathBenefit, surrenderValue: e.surrenderValue, paid: e.paid, ...(e.others !== undefined ? { others: e.others } : {}) })),
        ),
      };
    }
    const gifts: NonNullable<CashflowDetails["gifts"]>[number][] = [];
    for (const m of members) {
      const years = new Set(ctx.call<{ gifts: readonly { ym: string }[] }>("gift.received", { member: m.id }).gifts.map((g) => Number(g.ym.slice(0, 4))));
      for (const gy of [...years].sort((a, b) => a - b)) {
        if (gy < baseYear || gy > endYear) continue;
        const t = ctx.call<GiftTaxOutput>("gift.tax", { member: m.id, year: gy });
        gifts.push({ year: gy, recipient: m.id, amount: t.amount, exempt: t.exempt, calendarTaxable: t.calendarTaxable, settlementTaxable: t.settlementTaxable, tax: t.tax, inCashflow: t.inCashflow });
      }
    }
    if (gifts.length > 0) details.gifts = gifts;
    // 世帯の外の家族のお金が尽きる見込みの月（0042）
    const wallets = members.filter(hasWallet).map((m) => ({ member: m.id, depleted: ctx.call<{ depleted: string | null }>("outside.wallet", { member: m.id }).depleted }));
    if (wallets.length > 0) details.outsideWallets = wallets;
    if (childScholarships.length > 0) details.childScholarships = childScholarships;
    // 住まい以外の不動産の物件ごとの数字（asset.realEstate の出力のまま。帳票の入力の材料）
    if (rentals.length > 0) details.realEstate = rentals.map((p) => ({ object: p.object, owner: p.owner, years: p.years, income: p.income, sale: p.sale, ...(p.incomeKind !== undefined ? { incomeKind: p.incomeKind } : {}), ...(p.units !== undefined ? { units: p.units } : {}) }));
    // 収益不動産の分析の数字（約束の版 1.7。0082。計算は変えない）
    if (rentals.length > 0) details.realEstateAnalysis = ctx.call<RealEstateAnalysisOutput>("asset.realEstateAnalysis", {});
    const hasDetails = details.insurance !== undefined || details.gifts !== undefined || details.outsideWallets !== undefined || details.realEstate !== undefined || details.childScholarships !== undefined;
    return { flows: own.length === 0 ? collected.flows : [...collected.flows, ...own], annual, parts, ...(hasDetails ? { details } : {}) };
  },
});
