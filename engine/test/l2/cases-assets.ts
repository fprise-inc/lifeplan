// 答え合わせ（検証 L2）: 住宅ローン控除・NISA・iDeCo・上場株式等の譲渡益の公式の計算例と規則（製品の制度データ）。
// 2026-10-09 に公式の原本（e-Gov法令検索の条文、国税庁・国土交通省・総務省・金融庁・厚生労働省の公表資料。写しは非公開のリポジトリ）を取得して読み直した。
// 「原本の計算例」は原本にある例・額をそのまま使った例、「原本の規則から作った例」は原本にある規則（上限額・率）をそのまま当てはめた例
import { runEngine } from "../../src/engine/run.ts";
import type { HousingLoanCreditOutput, IdecoAccountOutput, IdecoContributionOutput, ResidentTaxOutput } from "../../src/sdk/contracts.ts";
import { box, household, member, period, realPacks, uid } from "../helpers.ts";
import type { L2Case } from "./cases.ts";

type Req = ReturnType<typeof household>;
type Obj = Record<string, unknown>;
const A = uid("l2a.a");
const B = uid("l2a.b");
const SUM = "原本の計算例（2026-10-09 に取得して読んだ。写しは非公開のリポジトリ）";
const RULE = "原本の規則（上限額・率）から作った例（2026-10-09 に取得して読んだ。写しは非公開のリポジトリ）";
const MLIT = "https://www.mlit.go.jp/jutakukentiku/house/content/001887903.pdf";
const NTA_USED = "https://www.nta.go.jp/taxes/shiraberu/taxanswer/shotoku/1211-3.htm";
const NTA_HOUSING = "https://www.nta.go.jp/publication/pamph/koho/kurashi/html/05_1.htm";
const SOUMU = "https://www.soumu.go.jp/main_sosiki/jichi_zeisei/czaisei/czaisei_seido/090929.html";
const FSA = "https://www.fsa.go.jp/policy/nisa2/about/nisa2024/summary.pdf";
const DC_ORDER = "https://laws.e-gov.go.jp/api/2/law_data/413CO0000000248_20261201_507CO0000000442?response_format=xml";
const MHLW = "https://www.mhlw.go.jp/stf/seisakunitsuite/bunya/nenkin/kyoshutsu/ideco.html";
const NTA_SEC = "https://www.nta.go.jp/taxes/shiraberu/taxanswer/shotoku/1476.htm";
const run = (req: Req) => runEngine(req, realPacks(), { checkInternal: true });
const entry = <T>(req: Req, component: string, input: unknown, stubs?: Record<string, (i: unknown) => unknown>) =>
  runEngine(req, realPacks(), { checkInternal: true, entry: { component, input }, ...(stubs ? { stubs } : {}) }).entryOutput as T;
const at = (ym: string) => ({ at: ym });
const edit = (req: Req, f: (h: Obj, input: Obj) => void): Req => {
  const r = JSON.parse(JSON.stringify(req)) as Req;
  f((r.input as unknown as Obj).household as Obj, r.input as unknown as Obj);
  return r;
};
const cell = (r: ReturnType<typeof run>, row: string, year: number) =>
  (r.table as unknown as { row: string; year: number; amount: number }[]).filter((c) => c.row === row && c.year === year).reduce((s, c) => s + c.amount, 0);

/** 入居の年・住宅の種類・世帯（子育て・若者夫婦か）と年末残高から、所得税の住宅借入金等特別控除の額 */
function housingCredit(moveIn: string, propertyType: string, newBuild: boolean, balance: number, childRearing: boolean): number {
  const year = Number(moveIn.slice(0, 4));
  const req = edit(household({ baseMonth: `${year}-01`, endYear: year + 1, members: [member("l2a.a", "self", "1970-01")], events: [{ id: uid("l2a.mv"), kind: "moveIn", at: at(moveIn) }] }), (h) => {
    h.debts = [
      {
        id: uid("l2a.loan"),
        kind: "mortgage",
        debtors: [{ member: A, role: "primary" }],
        principal: balance,
        start: at(moveIn),
        rateSchedule: [{ from: at(moveIn), type: "fixed", rate: "0.01" }],
        repayment: { method: "equalPayment", termMonths: 420 },
        housing: { moveIn: uid("l2a.mv"), propertyType, newBuild, childRearing },
      },
    ];
  });
  return entry<HousingLoanCreditOutput>(req, "tax.housingLoanCredit", { member: A, year }, {
    "tax.incomeWithin": () => ({ within: true }),
    "debt.schedule": () => ({ flows: [], yearEnd: [{ year, balance, unpaidInterest: 0 }], firstPayment: `${year}-02`, payoff: null }),
  }).credit;
}

/** 前年分の所得税から引ききれなかった住宅借入金等特別控除と課税総所得金額等から、住民税の税額控除の額 */
function residentHousingCredit(remainder: number, taxable: number): number {
  const req = household({ baseMonth: "2026-01", endYear: 2027, members: [member("l2a.a", "self", "1970-01")] });
  const r = entry<ResidentTaxOutput>(req, "residentTax.annual", { member: A, fiscalYear: 2027 }, {
    "tax.totalIncome": () => ({ total: 6000000, employment: 6000000 }),
    "tax.deductions": () => ({ basic: 0, spouse: 0, spouseSpecial: 0, dependents: 0, specifiedRelative: 0, socialInsurance: 0, lifeInsurance: 0, earthquake: 0, smallBusiness: 0, total: 1000000, personalDiff: 0 }),
    "tax.housingLoanCreditYears": () => ({ from: 2026, to: 2038 }),
    "tax.housingLoanCredit": () => ({ credit: 300000, firstYear: false, residentRate: "0.05", residentLimit: 97500 }),
    "incomeTax.annual": () => ({ flows: [], total: 0, taxable, computedTax: 0, reconstructionSurtax: 0, defenseSurtax: 0, housingLoanCredit: 0, creditRemainder: remainder }),
  });
  return (r.housingLoanCredit?.municipal ?? 0) + (r.housingLoanCredit?.prefectural ?? 0);
}

/** 成長投資枠で買った簿価の分を売った年の翌年の、非課税保有限度額の残り */
function nisaFrameAfterSale(cost: number): number {
  const req = edit(household({ baseMonth: "2026-01", endYear: 2028, members: [member("l2a.a", "self", "1970-01")] }), (h, input) => {
    h.accounts = [
      { id: uid("l2a.dep"), kind: "deposit", owner: A, marketValue: box(0), asOf: "2025-12", contributions: [] },
      { id: uid("l2a.nisa"), kind: "nisa", owner: A, marketValue: box(cost), costBasis: box(cost), asOf: "2025-12", frame: { lifetimeUsedCost: cost, growthUsedCost: cost, asOfYear: 2025 }, contributions: [] },
    ];
    // 2027年に全部を売るだけの赤字（家賃）
    h.residences = [{ id: uid("l2a.rent"), kind: "rent", from: at("2027-01"), to: at("2027-12"), rent: { monthly: box(Math.ceil((cost * 2) / 12)) } }];
    (input.assumptions as Obj).investmentReturn = { default: "0" };
    (input.assumptions as Obj).withdrawal = { order: [{ kind: "nisa" }] };
  });
  return cell(run(req), "cf.balance.nisaFrame", 2028);
}

/** iDeCo の拠出限度額（月額）。勤め先の企業年金と事業主掛金・他制度掛金相当額を与える */
function idecoLimit(month: string, o: { category: "1" | "2" | "3"; dcEmployer?: number; db?: boolean; dbEquivalent?: number }): number {
  const self = member("l2a.a", "self", "1980-05");
  const members = [self];
  const periods: Obj[] = [];
  const relations: Obj[] = [];
  if (o.category === "2") periods.push(period("l2a.p", { member: "l2a.a", from: "2005-04", annual: 6000000, std: [500000, 500000], extra: { corporatePension: { db: o.db === true, dbEquivalentMonthly: o.dbEquivalent ?? 0 } } }));
  if (o.category === "3") {
    members.push(member("l2a.b", "spouse", "1978-05"));
    relations.push({ type: "spouse", a: A, b: B, marriage: "legal", from: null, to: null });
    periods.push(period("l2a.pb", { member: "l2a.b", from: "2005-04", annual: 6000000, std: [500000, 500000] }));
  }
  if (o.category === "1") periods.push({ id: uid("l2a.se"), member: A, from: at("2005-04"), to: null, type: "selfEmployed", business: { income: box(4000000) } });
  const accounts: Obj[] = [{ id: uid("l2a.i"), kind: "ideco", owner: A, marketValue: box(0), asOf: "2025-12", contributions: [{ from: at("2025-01"), to: null, monthly: 100000 }] }];
  if (o.dcEmployer !== undefined) accounts.push({ id: uid("l2a.dc"), kind: "corporateDc", owner: A, marketValue: box(0), asOf: "2025-12", contributions: [{ from: at("2025-01"), to: null, monthly: o.dcEmployer, payer: "employer" }] });
  const req = household({ baseMonth: "2026-01", endYear: 2028, members, relations, periods, accounts });
  return entry<IdecoContributionOutput>(req, "ideco.contribution", { member: A }).payments.filter((p) => p.ym === month && p.kind === "ideco").reduce((s, p) => s + p.amount, 0);
}

/** iDeCo の加入の始まりから、受け取りを始められる年齢（受け取りを始めた月の年齢） */
function idecoStartAge(enrolledSince: string): number {
  const req = household({
    baseMonth: "2026-01",
    endYear: 2060,
    members: [member("l2a.a", "self", "1981-06")],
    accounts: [{ id: uid("l2a.i"), kind: "ideco", owner: A, marketValue: box(1000000), asOf: "2025-12", enrolledSince, contributions: [], payout: { start: at("2041-07"), method: "lumpSum" } }],
  });
  const first = entry<IdecoAccountOutput>(req, "account.ideco", { member: A }).payments[0]?.ym ?? "0000-00";
  // 1981年6月生まれ: その月の年齢（達する日の月で1つ上がる）
  const [y, m] = first.split("-").map(Number) as [number, number];
  return y - 1981 - (m < 6 ? 1 : 0);
}

/** 課税口座（源泉徴収あり）で時価 2,000,000円・取得価額 1,000,000円を全部売ったときの譲渡益の税（所得税・復興特別所得税＋住民税） */
function capitalGainsTax(): number {
  const req = edit(household({ baseMonth: "2026-01", endYear: 2026, members: [member("l2a.a", "self", "1970-01")] }), (h, input) => {
    h.accounts = [
      { id: uid("l2a.dep"), kind: "deposit", owner: A, marketValue: box(0), asOf: "2025-12", contributions: [] },
      { id: uid("l2a.tx"), kind: "taxable", owner: A, marketValue: box(2000000), costBasis: box(1000000), asOf: "2025-12", contributions: [] },
    ];
    h.residences = [{ id: uid("l2a.rent"), kind: "rent", from: at("2026-01"), to: null, rent: { monthly: box(1000000) } }];
    (input.assumptions as Obj).investmentReturn = { default: "0" };
  });
  const r = run(req);
  return cell(r, "cf.taxSi.incomeTax.capitalGains", 2026) + cell(r, "cf.taxSi.residentTax.capitalGains", 2026);
}

export const ASSET_CASES: readonly L2Case[] = [
  { id: "hl.2024.certified", area: "住宅ローン控除", title: "令和6年入居・新築の認定住宅・年末残高5,000万円 → 借入限度額4,500万円×0.7%＝31.5万円", source: { url: MLIT, note: RULE }, expected: 315000, actual: () => housingCredit("2024-04", "certified", true, 50000000, false), status: "pass" },
  { id: "hl.2024.certified.child", area: "住宅ローン控除", title: "同・子育て世帯（借入限度額5,000万円）→ 35万円", source: { url: MLIT, note: RULE }, expected: 350000, actual: () => housingCredit("2024-04", "certified", true, 50000000, true), status: "pass" },
  { id: "hl.2024.zeh", area: "住宅ローン控除", title: "令和6年入居・新築のZEH水準省エネ住宅 → 3,500万円×0.7%＝24.5万円", source: { url: MLIT, note: RULE }, expected: 245000, actual: () => housingCredit("2024-04", "zeh", true, 50000000, false), status: "pass" },
  { id: "hl.2024.zeh.child", area: "住宅ローン控除", title: "同・子育て世帯（4,500万円）→ 31.5万円", source: { url: MLIT, note: RULE }, expected: 315000, actual: () => housingCredit("2024-04", "zeh", true, 50000000, true), status: "pass" },
  { id: "hl.2024.energy", area: "住宅ローン控除", title: "令和6年入居・新築の省エネ基準適合住宅 → 3,000万円×0.7%＝21万円", source: { url: MLIT, note: RULE }, expected: 210000, actual: () => housingCredit("2024-04", "energySaving", true, 50000000, false), status: "pass" },
  { id: "hl.2024.energy.child", area: "住宅ローン控除", title: "同・子育て世帯（4,000万円）→ 28万円", source: { url: MLIT, note: RULE }, expected: 280000, actual: () => housingCredit("2024-04", "energySaving", true, 50000000, true), status: "pass" },
  { id: "hl.2026.used.other", area: "住宅ローン控除", title: "令和8年入居・既存のその他の住宅 → 2,000万円×0.7%＝14万円（控除限度額14万円）", source: { url: NTA_USED, note: SUM }, expected: 140000, actual: () => housingCredit("2026-04", "other", false, 30000000, false), status: "pass" },
  { id: "hl.2026.balance", area: "住宅ローン控除", title: "年末残高が限度額より少ない（2,345万6,789円）→ ×0.7%＝164,197円の100円未満を切り捨て 164,100円", source: { url: NTA_HOUSING, note: RULE }, expected: 164100, actual: () => housingCredit("2026-04", "zeh", true, 23456789, false), status: "pass" },
  { id: "hl.resident.cap", area: "住宅ローン控除", title: "住民税の控除（令和8年入居）: 所得税から引ききれない20万円、課税総所得金額等300万円 → 5%（15万円）と上限97,500円の小さい方", source: { url: SOUMU, note: RULE }, expected: 97500, actual: () => residentHousingCredit(200000, 3000000), status: "pass" },
  { id: "hl.resident.rate", area: "住宅ローン控除", title: "同・課税総所得金額等100万円 → 5%＝5万円（令和8年以後の入居は基礎控除の加算が無い。地方税法附則5条の4）", source: { url: SOUMU, note: RULE }, expected: 50000, actual: () => residentHousingCredit(200000, 1000000), status: "pass" },
  { id: "nisa.restore", area: "NISA・iDeCo", title: "成長投資枠で買った500万円（簿価）を売ると、翌年に非課税保有限度額が500万円復活（総枠1,800万円に戻る）", source: { url: FSA, note: `${RULE}。簿価残高方式（措置法37条の14第5項6号イの前年12月31日の購入の代価）` }, expected: 18000000, actual: () => nisaFrameAfterSale(5000000), status: "pass" },
  { id: "ideco.c2.noPlan.after", area: "NISA・iDeCo", title: "iDeCo 第2号・企業年金なし 2026年12月分から月62,000円", source: { url: DC_ORDER, note: SUM }, expected: 62000, actual: () => idecoLimit("2026-12", { category: "2" }), status: "pass" },
  { id: "ideco.c2.noPlan.before", area: "NISA・iDeCo", title: "同・2026年11月分まで月23,000円", source: { url: MHLW, note: SUM }, expected: 23000, actual: () => idecoLimit("2026-11", { category: "2" }), status: "pass" },
  { id: "ideco.c2.withPlan.after", area: "NISA・iDeCo", title: "iDeCo 第2号・企業型DCの事業主掛金 月30,000円 → 2026年12月分から 62,000円−30,000円＝月32,000円", source: { url: DC_ORDER, note: RULE }, expected: 32000, actual: () => idecoLimit("2026-12", { category: "2", dcEmployer: 30000 }), status: "pass" },
  { id: "ideco.c2.withPlan.before", area: "NISA・iDeCo", title: "同・2026年11月分まで min(20,000円, 55,000円−30,000円)＝月20,000円", source: { url: MHLW, note: RULE }, expected: 20000, actual: () => idecoLimit("2026-11", { category: "2", dcEmployer: 30000 }), status: "pass" },
  { id: "ideco.c1.after", area: "NISA・iDeCo", title: "iDeCo 第1号 2026年12月分から月75,000円", source: { url: DC_ORDER, note: SUM }, expected: 75000, actual: () => idecoLimit("2026-12", { category: "1" }), status: "pass" },
  { id: "ideco.c3.after", area: "NISA・iDeCo", title: "iDeCo 第3号 2026年12月分からも月23,000円", source: { url: DC_ORDER, note: SUM }, expected: 23000, actual: () => idecoLimit("2026-12", { category: "3" }), status: "pass" },
  { id: "ideco.startAge.55", area: "NISA・iDeCo", title: "55歳で加入（60歳までの通算加入者等期間5年）→ 受け取りは63歳から", source: { url: MHLW, note: RULE }, expected: 63, actual: () => idecoStartAge("2036-06"), status: "pass" },
  { id: "ideco.startAge.10y", area: "NISA・iDeCo", title: "通算加入者等期間10年以上 → 60歳から", source: { url: MHLW, note: SUM }, expected: 60, actual: () => idecoStartAge("2020-01"), status: "pass" },
  { id: "sec.gain.20315", area: "NISA・iDeCo", title: "上場株式等の譲渡益100万円（源泉徴収ありの特定口座）→ 所得税・復興特別所得税15.315%と住民税5%で203,150円", source: { url: NTA_SEC, note: RULE }, expected: 203150, actual: () => capitalGainsTax(), status: "pass" },
];
