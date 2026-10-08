// 答え合わせ（検証 L2）: 公式の資料にある計算例を、製品の制度データと公式部品で計算し直す。
// 計算例は国税庁・地方公共団体・協会けんぽ・日本年金機構・厚生労働省の公表資料から読んだもの。前半は検索の抜粋で読んだもの（原本は未取得）、
// 「原本を取得して読んだ」と注記した例（2026-10-08）は原本（e-Gov法令検索の条文・公表資料）から読んだもの。
// status: "pass" は一致するはずの例、"knownMismatch" は扱いの違いが分かっている例（cause に原因）
import { runEngine } from "../../src/engine/run.ts";
import { rate } from "../../src/money/rate.ts";
import { mulRate } from "../../src/money/rounding.ts";
import { yen } from "../../src/money/yen.ts";
import { asRoundingRule, RegulationStore, type PackJson } from "../../src/regulation/reader.ts";
import type { DeductionsOutput, EmploymentIncomeOutput, IncomeTaxOutput, ResidentTaxOutput } from "../../src/sdk/contracts.ts";
import { parseDate } from "../../src/time/civil.ts";
import { household, member, period, realPacks, uid } from "../helpers.ts";
import { PENSION_CASES } from "./cases-pension.ts";

export interface L2Case {
  readonly id: string;
  readonly area: "所得税" | "住民税" | "社会保険" | "公的年金" | "給付";
  readonly title: string;
  readonly source: { readonly url: string; readonly note: string };
  readonly expected: number;
  readonly actual: () => number;
  readonly status: "pass" | "knownMismatch";
  readonly cause?: string;
}

const A = uid("l2.a");
const one = (year: number) => household({ baseMonth: `${year}-01`, endYear: year + 1, members: [member("l2.a", "self", "1980-01")] });
const entry = <T>(req: ReturnType<typeof household>, component: string, input: unknown, stubs?: Record<string, (i: unknown) => unknown>) =>
  runEngine(req, realPacks(), { checkInternal: true, entry: { component, input }, ...(stubs ? { stubs } : {}) }).entryOutput as T;
const DED0 = { basic: 0, spouse: 0, spouseSpecial: 0, dependents: 0, specifiedRelative: 0, socialInsurance: 0, lifeInsurance: 0, earthquake: 0, smallBusiness: 0 };

/** 合計所得金額と所得控除の合計を与えて所得税を計算する */
function incomeTax(year: number, total: number, deductions: number): IncomeTaxOutput {
  return entry<IncomeTaxOutput>(one(year), "incomeTax.annual", { member: A, year }, {
    "tax.totalIncome": () => ({ total, employment: total }),
    "tax.deductions": () => ({ ...DED0, total: deductions, personalDiff: 0 }),
  });
}

/** 合計所得金額・所得控除の合計・人的控除額の差の合計を与えて住民税を計算する */
function residentTax(fiscalYear: number, total: number, deductions: number, personalDiff: number): ResidentTaxOutput {
  return entry<ResidentTaxOutput>(one(fiscalYear - 1), "residentTax.annual", { member: A, fiscalYear }, {
    "tax.totalIncome": () => ({ total, employment: total }),
    "tax.deductions": () => ({ ...DED0, total: deductions, personalDiff }),
  });
}

/** その年の給与収入（賞与なし）から給与所得を計算する */
function employmentIncome(year: number, revenue: number): number {
  const req = household({ baseMonth: `${year}-01`, endYear: year, members: [member("l2.a", "self", "1980-01")], periods: [period("l2.p", { member: "l2.a", from: "2000-04", annual: revenue, std: [300000, 300000] })] });
  return entry<EmploymentIncomeOutput>(req, "tax.employmentIncome", { member: A, year }).income;
}

/** 契約1件の保険料控除（地震保険料控除など） */
function earthquakeDeduction(year: number, type: string, annual: number): number {
  const req = household({
    baseMonth: `${year}-01`, endYear: year, members: [member("l2.a", "self", "1980-01")],
    insuranceContracts: [{ id: uid("l2.c"), template: "insurance.nonLife", policyholder: A, insured: A, contractDate: "2005-01", currency: "JPY", premium: { amount: annual, frequency: "annual", payUntil: null }, deductionCategory: { type } }],
  });
  return entry<DeductionsOutput>(req, "tax.deductions", { member: A, year, regime: "incomeTax" }, { "tax.totalIncome": () => ({ total: 5000000, employment: 5000000 }) }).earthquake;
}

/** 標準報酬月額を与えた会社員の、ある月分の保険料（被保険者負担分）。保険料の部品だけを呼ぶ */
function premium(month: string, std: number, formula: string, insurer = "13", birth = "1980-01"): number {
  const req = household({
    baseMonth: "2026-01", endYear: 2027, members: [member("l2.a", "self", birth)],
    periods: [period("l2.p", { member: "l2.a", from: "2000-04", annual: std * 12, insurer, std: [std, std] })],
  });
  const component = formula.split(".").slice(0, 2).join(".");
  const flows = entry<{ flows: { formula: string; ym: string; amount: number }[] }>(req, component === "socialInsurance.care" ? "socialInsurance.health" : component, { member: A, fromYear: 2026 }).flows;
  // 月分の保険料は翌月の給与から控除する
  const [yy, mm] = month.split("-").map(Number) as [number, number];
  const paid = mm === 12 ? `${yy + 1}-01` : `${yy}-${String(mm + 1).padStart(2, "0")}`;
  return flows.filter((f) => f.formula === formula && f.ym === paid).reduce((s, f) => s + f.amount, 0);
}

/** 月給（賞与なし）から決まる標準報酬月額（健康保険・厚生年金）。被用者保険の資格の部品だけを呼ぶ */
function standardMonthly(month: string, monthlySalary: number, kind: "healthStd" | "pensionStd"): number {
  const req = household({
    baseMonth: "2026-01", endYear: 2030, members: [member("l2.a", "self", "1980-01")],
    periods: [period("l2.p", { member: "l2.a", from: "2000-04", annual: monthlySalary * 12 })],
  });
  const months = entry<{ months: { month: string; healthStd: number | null; pensionStd: number | null }[] }>(req, "socialInsurance.coverage", { member: A, fromYear: 2026 }).months;
  return months.find((m) => m.month === month)?.[kind] ?? -1;
}

/** 雇用保険料（月給・賞与の支払い1回分） */
function employmentInsurance(month: string, salaryMonthly: number, bonus: number, kind: "monthly" | "bonus"): number {
  const req = household({
    baseMonth: "2026-01", endYear: 2027, members: [member("l2.a", "self", "1980-01")],
    periods: [period("l2.p", { member: "l2.a", from: "2000-04", annual: salaryMonthly * 12, bonus: bonus * 2, std: [200000, 200000] })],
  });
  const flows = entry<{ flows: { formula: string; ym: string; amount: number }[] }>(req, "socialInsurance.employment", { member: A, fromYear: 2026 }).flows;
  return flows.find((f) => f.formula === `socialInsurance.employment.${kind}` && f.ym === month)?.amount ?? -1;
}

const NTA = "https://www.nta.go.jp/";
const KENPO = "https://www.kyoukaikenpo.or.jp/";
const NENKIN_R08 = "https://www.nenkin.go.jp/service/kounen/hokenryo/ryogaku/ryogakuhyo/20200825.files/R08ryougaku.pdf";
const YOKO = "https://www.city.yokohama.lg.jp/kurashi/koseki-zei-hoken/zeikin/y-shizei/kojin-shiminzei-kenminzei/kojin-shiminzei-shosai/kojinkeisan.html";
const OSAKA = "https://www.city.osaka.lg.jp/zaisei/page/";
const SUM = "検索の要約で読んだ計算例（原本は未取得）";
const TITLE = "検索結果の題名に出た原文の数字（原本は未取得）";
const DESIGNATED = "横浜市・大阪市は指定都市で、所得割の税率（市8%・道府県2%）と調整控除の率（市4%・道府県1%）の配分が違う。この部品は全国一律の標準税率（市町村6%・道府県4%、調整控除は3%・2%）で計算する";
const SURCHARGE = "横浜市の超過課税（県民税の所得割0.025%、均等割の上乗せ）を入れていない（全国一律の標準税率で計算する）";

const pensionCases: [number, number, string][] = [
  [88000, 8052, TITLE], [98000, 8967, SUM], [104000, 9516, SUM], [150000, 13725, SUM], [300000, 27450, SUM],
  [360000, 32940, SUM], [470000, 43005, SUM], [500000, 45750, SUM], [590000, 53985, SUM], [620000, 56730, SUM], [650000, 59475, SUM],
];

const ORIG = "原本を取得して読んだ（2026-10-08。写しは非公開のリポジトリ）";
const EGOV_SH10 = "https://laws.e-gov.go.jp/api/2/law_data/340AC0000000033_20280101_508AC0000000012?response_format=xml";
const EGOV_SO8 = "https://laws.e-gov.go.jp/api/2/law_data/332AC0000000026_20261201_508AC0000000012?response_format=xml";
const EGOV_KH = "https://laws.e-gov.go.jp/api/2/law_data/211AC0000000070_20261001_507AC0000000087?response_format=xml";
const NENKIN_R8 = "https://www.nenkin.go.jp/service/kounen/hokenryo/ryogaku/ryogakuhyo/20200825.files/R08ryougaku.pdf";
const MHLW_JOGEN = "https://www.mhlw.go.jp/stf/seisakunitsuite/bunya/0000147284_00024.html";

export const CASES: readonly L2Case[] = [
  // 以下は原本（e-Gov法令検索の条文、日本年金機構・協会けんぽ・厚生労働省の公表資料）を取得して読んだ例（2026-10-08）
  { id: "it.salary.2028.1000000", area: "所得税", title: "令和10年分: 給与収入 1,000,000円の給与所得（別表第五の69.1万〜202.6万円未満は収入−69万円）", source: { url: EGOV_SH10, note: ORIG }, expected: 310000, actual: () => employmentIncome(2028, 1000000), status: "pass" },
  { id: "it.salary.2028.2036000", area: "所得税", title: "令和10年分: 給与収入 2,036,000円の給与所得（別表第五の 2,036,000〜2,040,000円の区分）", source: { url: EGOV_SH10, note: ORIG }, expected: 1345200, actual: () => employmentIncome(2028, 2036000), status: "pass" },
  { id: "it.salary.2028.3000000", area: "所得税", title: "令和10年分: 給与収入 3,000,000円の給与所得（別表第五の 3,000,000〜3,004,000円の区分）", source: { url: EGOV_SH10, note: ORIG }, expected: 2020000, actual: () => employmentIncome(2028, 3000000), status: "pass" },
  { id: "it.salary.2028.2030000", area: "所得税", title: "令和10年分: 給与収入 2,030,000円の給与所得（別表第五の 2,028,000〜2,032,000円の区分）", source: { url: EGOV_SH10, note: ORIG }, expected: 1338000, actual: () => employmentIncome(2028, 2030000), status: "knownMismatch", cause: "別表第五は202.6万円から2,000円・4,000円の刻みになるが、この部品は控除額が定額（69万円）の段では収入を刻みで切り下げない。202.6万〜203.3万円で最大2,000円ほど多くなる（計算部品の扱い。データは条文どおり）" },
  { id: "it.salary.2026.2192000", area: "所得税", title: "令和8年分: 給与収入 2,192,000円の給与所得（措置法29条の4第2項3号: 219.1万〜219.3万円は145.1万円）", source: { url: EGOV_SO8, note: ORIG }, expected: 1451000, actual: () => employmentIncome(2026, 2192000), status: "knownMismatch", cause: "措置法29条の4第2項の219.1万〜220万円の区分（145.1万・145.3万・145.6万円）をこの部品は扱わず、収入−74万円で計算する。最大2,000円ほど多くなる（計算部品の扱い）" },
  { id: "si.std.health.650000", area: "社会保険", title: "月給 650,000円の健康保険の標準報酬月額（健康保険法40条の第35級）", source: { url: EGOV_KH, note: ORIG }, expected: 650000, actual: () => standardMonthly("2026-10", 650000, "healthStd"), status: "pass" },
  { id: "si.std.health.1400000", area: "社会保険", title: "月給 1,400,000円の健康保険の標準報酬月額（第50級・139万円）", source: { url: EGOV_KH, note: ORIG }, expected: 1390000, actual: () => standardMonthly("2026-10", 1400000, "healthStd"), status: "pass" },
  { id: "si.std.pension.2026", area: "社会保険", title: "月給 800,000円の厚生年金の標準報酬月額（2026年10月。第32級・65万円）", source: { url: NENKIN_R8, note: ORIG }, expected: 650000, actual: () => standardMonthly("2026-10", 800000, "pensionStd"), status: "pass" },
  { id: "si.std.pension.2027", area: "社会保険", title: "月給 800,000円の厚生年金の標準報酬月額（2027年9月。第33級・68万円）", source: { url: MHLW_JOGEN, note: ORIG }, expected: 680000, actual: () => standardMonthly("2027-09", 800000, "pensionStd"), status: "pass" },
  { id: "si.std.pension.2028", area: "社会保険", title: "月給 800,000円の厚生年金の標準報酬月額（2028年9月。第34級・71万円）", source: { url: MHLW_JOGEN, note: ORIG }, expected: 710000, actual: () => standardMonthly("2028-09", 800000, "pensionStd"), status: "pass" },
  { id: "si.std.pension.2029", area: "社会保険", title: "月給 800,000円の厚生年金の標準報酬月額（2029年9月。第35級・75万円）", source: { url: MHLW_JOGEN, note: ORIG }, expected: 750000, actual: () => standardMonthly("2029-09", 800000, "pensionStd"), status: "pass" },
  { id: "si.std.pension.2029.700000", area: "社会保険", title: "月給 700,000円の厚生年金の標準報酬月額（2029年9月。第34級・71万円）", source: { url: MHLW_JOGEN, note: ORIG }, expected: 710000, actual: () => standardMonthly("2029-09", 700000, "pensionStd"), status: "pass" },

  // 所得税
  { id: "it.rate.7000000", area: "所得税", title: "課税所得 7,000,000円の所得税（復興特別所得税の前）", source: { url: `${NTA}taxes/shiraberu/taxanswer/shotoku/2260.htm`, note: SUM }, expected: 974000, actual: () => incomeTax(2026, 7000000, 0).computedTax, status: "pass" },
  { id: "it.rate.3370000", area: "所得税", title: "課税所得 3,370,000円の所得税（確定申告の手引きの例）", source: { url: `${NTA}taxes/shiraberu/shinkoku/tebiki/2025/03/order4/3-4_45.htm`, note: `${SUM}。手引きの年分は特定できず` }, expected: 246500, actual: () => incomeTax(2025, 3370000, 0).computedTax, status: "pass" },
  { id: "it.no1000.tax", area: "所得税", title: "所得300万円・所得控除176万円（令和8年分）→ 課税所得 1,240,000円の所得税", source: { url: `${NTA}taxes/shiraberu/taxanswer/shotoku/1000.htm`, note: SUM }, expected: 62000, actual: () => incomeTax(2026, 3000000, 1760000).computedTax, status: "pass" },
  { id: "it.no1000.surtax", area: "所得税", title: "同じ例の復興特別所得税", source: { url: `${NTA}taxes/shiraberu/taxanswer/shotoku/1000.htm`, note: SUM }, expected: 1302, actual: () => incomeTax(2026, 3000000, 1760000).reconstructionSurtax, status: "pass" },
  { id: "it.surtax.176500", area: "所得税", title: "基準所得税額 176,500円の復興特別所得税（1円未満切り捨て）", source: { url: `${NTA}taxes/shiraberu/shinkoku/tebiki/2025/03/order4/3-4_45.htm`, note: SUM }, expected: 3706, actual: () => incomeTax(2025, 2740000, 0).reconstructionSurtax, status: "pass" },
  { id: "it.salary.5000000", area: "所得税", title: "給与収入 5,000,000円（令和8年分）の給与所得", source: { url: `${NTA}publication/pamph/koho/kurashi/html/02_1.htm`, note: SUM }, expected: 3560000, actual: () => employmentIncome(2026, 5000000), status: "pass" },
  { id: "it.salary.5000000.tax", area: "所得税", title: "同じ例: 給与所得 3,560,000円・所得控除 2,880,000円の所得税及び復興特別所得税（100円未満切り捨て）", source: { url: `${NTA}publication/pamph/koho/kurashi/html/02_1.htm`, note: SUM }, expected: 34700, actual: () => incomeTax(2026, 3560000, 2880000).total, status: "pass" },
  { id: "it.salary.5812500", area: "所得税", title: "給与収入 5,812,500円（令和8年分）の給与所得（4,000円単位）", source: { url: `${NTA}taxes/tetsuzuki/shinsei/annai/shinkoku/pdf/r08/zeigakuhyo.pdf`, note: SUM }, expected: 4209600, actual: () => employmentIncome(2026, 5812500), status: "pass" },
  { id: "it.earthquake.longTerm", area: "所得税", title: "旧長期損害保険料 17,000円の地震保険料控除", source: { url: `${NTA}law/shitsugi/shotoku/05/68.htm`, note: `${SUM}。公式の例は1つの契約で地震保険料1万円と旧長期1.7万円を払い、旧長期を選ぶ例。この部品は契約ごとに区分を1つ持つので、旧長期の分だけで試す` }, expected: 13500, actual: () => earthquakeDeduction(2026, "longTermNonLife", 17000), status: "pass" },
  // 住民税
  { id: "rt.yokohama.salary", area: "住民税", title: "横浜市 令和8年度: 給与収入 5,500,000円の給与所得", source: { url: YOKO, note: SUM }, expected: 3960000, actual: () => employmentIncome(2025, 5500000), status: "pass" },
  { id: "rt.yokohama.taxable", area: "住民税", title: "横浜市 令和8年度: 給与所得 3,960,000円・所得控除 1,522,800円の課税標準", source: { url: YOKO, note: SUM }, expected: 2437000, actual: () => residentTax(2026, 3960000, 1522800, 150000).taxable, status: "pass" },
  { id: "rt.yokohama.credit", area: "住民税", title: "横浜市 令和8年度: 調整控除（市・県の合計。最低額 2,500円）", source: { url: YOKO, note: SUM }, expected: 2500, actual: () => { const r = residentTax(2026, 3960000, 1522800, 150000); return r.adjustmentCredit.municipal + r.adjustmentCredit.prefectural; }, status: "pass" },
  { id: "rt.yokohama.forest", area: "住民税", title: "横浜市 令和8年度: 森林環境税", source: { url: YOKO, note: SUM }, expected: 1000, actual: () => residentTax(2026, 3960000, 1522800, 150000).forestEnvironmentTax, status: "pass" },
  { id: "rt.yokohama.levy", area: "住民税", title: "横浜市 令和8年度: 所得割の合計（市 192,900円＋県 48,800円）", source: { url: YOKO, note: SUM }, expected: 241700, actual: () => { const r = residentTax(2026, 3960000, 1522800, 150000); return r.incomeLevy.municipal + r.incomeLevy.prefectural; }, status: "knownMismatch", cause: `${SURCHARGE}。標準税率では 241,100円` },
  { id: "rt.yokohama.perCapita", area: "住民税", title: "横浜市 令和8年度: 均等割の合計（市 3,900円＋県 1,300円）", source: { url: YOKO, note: SUM }, expected: 5200, actual: () => { const r = residentTax(2026, 3960000, 1522800, 150000); return r.perCapita.municipal + r.perCapita.prefectural; }, status: "knownMismatch", cause: `${SURCHARGE}。標準税率では 4,000円` },
  { id: "rt.yokohama.pension.credit", area: "住民税", title: "横浜市 令和8年度（年金を受け取る人）: 課税標準 620,000円・人的控除額の差 5万円の調整控除", source: { url: YOKO, note: SUM }, expected: 2500, actual: () => { const r = residentTax(2026, 1200000, 580000, 50000); return r.adjustmentCredit.municipal + r.adjustmentCredit.prefectural; }, status: "pass" },
  { id: "rt.osaka.salary", area: "住民税", title: "大阪市 令和8年度: 給与収入 5,436,629円の給与所得（4,000円単位）", source: { url: `${OSAKA}0000384109.html`, note: SUM }, expected: 3908800, actual: () => employmentIncome(2025, 5436629), status: "pass" },
  { id: "rt.osaka.taxable", area: "住民税", title: "大阪市 令和8年度: 給与所得 3,908,800円・所得控除 1,737,193円の課税総所得金額", source: { url: `${OSAKA}0000384109.html`, note: SUM }, expected: 2171000, actual: () => residentTax(2026, 3908800, 1737193, 150000).taxable, status: "pass" },
  { id: "rt.osaka.gross", area: "住民税", title: "大阪市 令和8年度: 税率を掛けた所得割の合計（市 173,680円＋府 43,420円）", source: { url: `${OSAKA}0000384109.html`, note: SUM }, expected: 217100, actual: () => { const r = residentTax(2026, 3908800, 1737193, 150000); return r.grossLevy.municipal + r.grossLevy.prefectural; }, status: "pass" },
  { id: "rt.osaka.credit", area: "住民税", title: "大阪市 令和8年度: 調整控除（市・府の合計）", source: { url: `${OSAKA}0000384109.html`, note: SUM }, expected: 2500, actual: () => { const r = residentTax(2026, 3908800, 1737193, 150000); return r.adjustmentCredit.municipal + r.adjustmentCredit.prefectural; }, status: "pass" },
  { id: "rt.osaka.levy", area: "住民税", title: "大阪市 令和8年度: 差し引いた所得割の合計（市 83,800円＋府 20,900円）", source: { url: `${OSAKA}0000384109.html`, note: SUM }, expected: 104700, actual: () => { const r = residentTax(2026, 3908800, 1737193, 150000); return r.incomeLevy.municipal + r.incomeLevy.prefectural; }, status: "knownMismatch", cause: "例は住宅借入金等特別税額控除（97,500円）と寄附金税額控除（12,338円）を含む。この2つの税額控除はまだ作っていない" },
  { id: "rt.osaka.credit.small", area: "住民税", title: "大阪市: 課税標準 381,000円・人的控除額の差 15万円の調整控除（市民税）", source: { url: `${OSAKA}0000383147.html`, note: `${SUM}。どのページの例かを特定できず` }, expected: 6000, actual: () => residentTax(2026, 381000 + 430000, 430000, 150000).adjustmentCredit.municipal, status: "knownMismatch", cause: `${DESIGNATED}。この部品の市町村民税の分は 4,500円（合計は 7,500円）` },
  { id: "rt.osaka.exemption", area: "住民税", title: "大阪市 令和8年度: 単身で給与収入 110万円以下は均等割・所得割とも非課税", source: { url: `${OSAKA}0000384084.html`, note: SUM }, expected: 0, actual: () => residentTax(2026, 1100000 - 650000, 430000, 50000).total, status: "pass" },
  // 社会保険
  ...pensionCases.map(([std, half, note]): L2Case => ({
    id: `si.pension.${std}`, area: "社会保険", title: `厚生年金保険料 標準報酬月額 ${std.toLocaleString("ja-JP")}円の折半額（令和8年度の保険料額表）`,
    source: { url: NENKIN_R08, note }, expected: half, actual: () => premium("2026-05", std, "socialInsurance.pension.monthly"), status: "pass",
  })),
  { id: "si.health.hokkaido.r8", area: "社会保険", title: "協会けんぽ北海道支部 令和8年度: 標準報酬月額30万円の健康保険料（労使折半後）", source: { url: `${KENPO}~/media/Files/hokkaido/hyogikai/r7_003_1-6.pdf`, note: SUM }, expected: 15420, actual: () => premium("2026-03", 300000, "socialInsurance.health.monthly", "01"), status: "pass" },
  { id: "si.health.hokkaido.r7", area: "社会保険", title: "協会けんぽ北海道支部 令和7年度: 標準報酬月額30万円の健康保険料（労使折半後）", source: { url: `${KENPO}~/media/Files/hokkaido/hyogikai/r7_003_1-6.pdf`, note: SUM }, expected: 15465, actual: () => premium("2026-01", 300000, "socialInsurance.health.monthly", "01"), status: "pass" },
  { id: "si.care.chiba.r7", area: "社会保険", title: "協会けんぽ千葉支部: 標準報酬月額34万円の介護保険料（令和7年度、折半額）", source: { url: `${KENPO}shibu/chiba/assets/20260115_shiryou2-3.pdf`, note: SUM }, expected: 2703, actual: () => premium("2026-01", 340000, "socialInsurance.care.monthly", "12", "1980-01"), status: "pass" },
  { id: "si.care.chiba.r8", area: "社会保険", title: "協会けんぽ千葉支部: 標準報酬月額34万円の介護保険料（令和8年度、折半額）", source: { url: `${KENPO}shibu/chiba/assets/20260115_shiryou2-3.pdf`, note: SUM }, expected: 2754, actual: () => premium("2026-03", 340000, "socialInsurance.care.monthly", "12", "1980-01"), status: "pass" },
  { id: "si.employment.r8.monthly", area: "社会保険", title: "雇用保険 令和8年度（一般の事業）: 月給 200,000円の被保険者負担", source: { url: "https://www.mhlw.go.jp/www2/topics/seido/daijin/hoken/980916_3.htm", note: SUM }, expected: 1000, actual: () => employmentInsurance("2026-05", 200000, 450000, "monthly"), status: "pass" },
  { id: "si.employment.r8.bonus", area: "社会保険", title: "雇用保険 令和8年度（一般の事業）: 賞与 450,000円の被保険者負担", source: { url: "https://www.mhlw.go.jp/www2/topics/seido/daijin/hoken/980916_3.htm", note: SUM }, expected: 2250, actual: () => employmentInsurance("2026-06", 200000, 450000, "bonus"), status: "pass" },
  {
    id: "si.employment.rounding", area: "社会保険", title: "雇用保険の端数（賃金 255,935円×4/1,000＝1,023.74円 → 1,024円。料率は当時のもの）",
    source: { url: "https://www.mhlw.go.jp/new-info/kobetu/roudou/gyousei/hoken/2020/dl/keizoku-20.pdf", note: SUM }, expected: 1024,
    actual: () => {
      const si = realPacks().find((p) => p.pack.packId === "regulation.socialInsurance") as unknown as PackJson;
      const rule = asRoundingRule(new RegulationStore([si as never]).select("employmentInsurance.employeeShare.rounding", parseDate("2026-05-01")));
      return mulRate(yen(255935), rate("0.004"), rule).value;
    },
    status: "pass",
  },
  ...PENSION_CASES,
];

/** 合格率（pass の例のうち一致した数）と、扱いの違いが分かっている例 */
export function l2Summary(): { total: number; passed: number; mismatches: { id: string; expected: number; actual: number; cause: string }[]; failures: { id: string; expected: number; actual: number | string }[] } {
  let passed = 0;
  const mismatches: { id: string; expected: number; actual: number; cause: string }[] = [];
  const failures: { id: string; expected: number; actual: number | string }[] = [];
  for (const c of CASES) {
    let actual: number | string;
    try {
      actual = c.actual();
    } catch (e) {
      actual = String(e);
    }
    if (actual === c.expected) passed++;
    else if (c.status === "knownMismatch" && typeof actual === "number") mismatches.push({ id: c.id, expected: c.expected, actual, cause: c.cause ?? "" });
    else failures.push({ id: c.id, expected: c.expected, actual });
  }
  return { total: CASES.length, passed, mismatches, failures };
}
