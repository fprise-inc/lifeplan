// 答え合わせ（検証 L2）: 公的年金・年金の税・休業の給付・国民年金の公式の計算例（製品の制度データ。原本での確認待ちの値）。
// 計算例は日本年金機構・厚生労働省・協会けんぽ・国税庁・市町村の公表資料から、検索の抜粋で読んだもの（原本は未取得）
import { runEngine } from "../../src/engine/run.ts";
import type { PensionOutput, PublicPensionIncomeOutput, ResidentTaxOutput, TotalIncomeOutput } from "../../src/sdk/contracts.ts";
import { box, household, member, period, realPacks, uid } from "../helpers.ts";
import type { L2Case } from "./cases.ts";

type Req = ReturnType<typeof household>;
const A = uid("l2p.a");
const B = uid("l2p.b");
const SUM = "検索の要約で読んだ計算例（原本は未取得）";
const NENKIN = "https://www.nenkin.go.jp/";
const run = (req: Req) => runEngine(req, realPacks(), { checkInternal: true });
const entry = <T>(req: Req, component: string, input: unknown, stubs?: Record<string, (i: unknown) => unknown>) =>
  runEngine(req, realPacks(), { checkInternal: true, entry: { component, input }, ...(stubs ? { stubs } : {}) }).entryOutput as T;
const withH = (req: Req, h: Record<string, unknown>) => {
  Object.assign(req.input.household as unknown as Record<string, unknown>, h);
  return req;
};
const rta = (member: string, fy = 2026) => ({ id: uid(`l2p.rta.${member}.${fy}`), member, fiscalYear: fy, amount: box(100000) });

/** 加入歴（第1号の納付済の月数）から老齢基礎年金（年額）を計算する */
function basicFromMonths(months: number, birth: string, base: string, at: string): number {
  // 60歳に達する月の前の月までの months か月を納付済にする（その後は60歳なので加入の月は増えない）
  const [y, m] = birth.split("-").map(Number) as [number, number];
  const end = (y + 60) * 12 + (m - 1) - 1;
  const start = end - (months - 1);
  const ym = (k: number) => `${Math.floor(k / 12)}-${String((k % 12) + 1).padStart(2, "0")}`;
  const from = ym(start);
  const toY = Math.floor(end / 12);
  const toM = (end % 12) + 1;
  const req = withH(household({ baseMonth: base, endYear: Number(at.slice(0, 4)) + 1, members: [member("l2p.a", "self", birth, { sex: "male" })] }), {
    pensionRecords: [{ id: uid("l2p.r"), member: A, kind: "history", asOf: `${toY}-${String(toM).padStart(2, "0")}`, history: [{ from, to: `${toY}-${String(toM).padStart(2, "0")}`, category: "national1" }] }],
    residentTaxAssessments: [rta(A, Number(base.slice(0, 4)))],
  });
  return entry<PensionOutput>(req, "pension.oldAge", { member: A }).months.find((x) => x.month === at)?.basic ?? -1;
}

/** 見込額（65歳から）と受給を始める月から、その月の老齢基礎年金の年額 */
function claimed(basic: number, claimAt: string, at: string): number {
  const req = withH(household({ baseMonth: "2026-04", endYear: Number(at.slice(0, 4)), members: [member("l2p.a", "self", "1961-05", { sex: "male" })] }), {
    pensionRecords: [{ id: uid("l2p.r"), member: A, kind: "projection", asOf: "2026-04", amounts: { basic: box(basic) }, claim: { basic: { at: claimAt } } }],
    residentTaxAssessments: [rta(A)],
  });
  return entry<PensionOutput>(req, "pension.oldAge", { member: A }).months.find((x) => x.month === at)?.basic ?? -1;
}

/** 在職老齢年金: 老齢厚生年金の年額と標準報酬月額・賞与（6・12月）から、2027年5月の支給の年額 */
function working(employee: number, std: number, bonus: number): number {
  const req = withH(
    household({
      baseMonth: "2026-04",
      endYear: 2027,
      members: [member("l2p.a", "self", "1960-01", { sex: "male" })],
      periods: [period("l2p.p", { member: "l2p.a", from: "2010-04", annual: std * 12, bonus, std: [std, std] })],
    }),
    { pensionRecords: [{ id: uid("l2p.r"), member: A, kind: "projection", asOf: "2026-04", amounts: { basic: box(800000), employee: box(employee) } }], residentTaxAssessments: [rta(A)] },
  );
  return entry<PensionOutput>(req, "pension.oldAge", { member: A }).months.find((x) => x.month === "2027-05")?.employee ?? -1;
}

/** 夫（厚生年金240月以上）と妻の世帯で、夫の老齢厚生年金の加算・妻の老齢基礎年金の月の年額 */
function couple(base: string, hBirth: string, wBirth: string, who: "h" | "w", at: string, wBasic = 600000): number {
  const req = withH(
    household({
      baseMonth: base,
      endYear: Number(at.slice(0, 4)),
      members: [member("l2p.a", "self", hBirth, { sex: "male" }), member("l2p.b", "spouse", wBirth)],
      relations: [{ type: "spouse", a: A, b: B, marriage: "legal", from: null, to: null }],
    }),
    {
      pensionRecords: [
        { id: uid("l2p.r"), member: A, kind: "projection", asOf: `${base.slice(0, 4)}-04`, months: { basic: 480, employee: 300 }, amounts: { basic: box(800000), employee: box(1000000) } },
        { id: uid("l2p.s"), member: B, kind: "projection", asOf: `${base.slice(0, 4)}-04`, months: { basic: 480, employee: 0 }, amounts: { basic: box(wBasic) } },
      ],
      residentTaxAssessments: [rta(A, Number(base.slice(0, 4))), rta(B, Number(base.slice(0, 4)))],
    },
  );
  const o = entry<PensionOutput>(req, "pension.oldAge", { member: who === "h" ? A : B });
  const m = o.months.find((x) => x.month === at);
  return (who === "h" ? m?.employee : m?.basic) ?? -1;
}

/** 年金生活者支援給付金（月額）。納付済の月数と、世帯全員が住民税非課税・所得基準以下とする */
function supportBenefit(basicMonths: number, exemptFull = 0): number {
  const req = withH(household({ baseMonth: "2026-10", endYear: 2027, members: [member("l2p.a", "self", "1958-01", { sex: "male" })] }), { residentTaxAssessments: [rta(A)] });
  const months = ["2026-10", "2026-11", "2026-12"].map((month) => ({ month, basic: 800000, employee: 0, special: 0, suspended: 0 }));
  const flows = entry<{ flows: { ym: string; amount: number }[] }>(req, "pension.supplementaryBenefit", { member: A }, {
    "pension.oldAge": () => ({ flows: [], payments: [], months }),
    "pension.record": () => ({ kind: "projection", fiscalYear: 2026, asOf: "2026-04", basicMonths, employeeMonths: 0, employee2059Months: 0, qualifyingMonths: basicMonths, amounts: { basic: null, employee: null, transitional: null, special: null }, months: [], ...(exemptFull > 0 ? { category1: { known: true, paid: basicMonths, exemptQuarter: 0, exemptHalf: 0, exemptThreeQuarters: 0, exemptFull, deferred: 0, pre2009: { exemptQuarter: 0, exemptHalf: 0, exemptThreeQuarters: 0, exemptFull: 0 } } } : {}) }),
    "residentTax.exemption": () => ({ perCapitaExempt: true, incomeLevyExempt: true, persons: 1 }),
    "tax.totalIncome": () => ({ total: 0, employment: 0, publicPension: 0 }),
    "tax.publicPensionIncome": () => ({ revenue: 700000, deduction: 700000, income: 0 }),
  }).flows;
  // 10・11月分を12月に払う
  return (flows.find((f) => f.ym === "2026-12")?.amount ?? -2) / 2;
}

/** 公的年金等に係る雑所得（その年の年金の収入と、給与の所得控除・所得） */
function pensionIncome(year: number, birth: string, revenue: number, salary?: { revenue: number; deduction: number; income: number }): PublicPensionIncomeOutput {
  const req = household({ baseMonth: `${year}-01`, endYear: year, members: [member("l2p.a", "self", birth)] });
  return entry<PublicPensionIncomeOutput>(req, "tax.publicPensionIncome", { member: A, year }, {
    "pension.oldAge": () => ({ flows: [], months: [], payments: [{ ym: `${year}-06`, part: "basic", amount: revenue, accrualYear: year }] }),
    "tax.employmentIncome": () => salary ?? { revenue: 0, deduction: 0, income: 0 },
  });
}

/** 住民税（年金の所得の例）: 合計所得金額・所得控除・人的控除額の差を与える */
function residentTax(total: number, deductions: number, personalDiff: number): ResidentTaxOutput {
  const req = household({ baseMonth: "2026-06", endYear: 2027, members: [member("l2p.a", "self", "1956-01")] });
  return entry<ResidentTaxOutput>(req, "residentTax.annual", { member: A, fiscalYear: 2026 }, {
    "tax.totalIncome": () => ({ total, employment: 0, publicPension: total }),
    "tax.deductions": () => ({ basic: 0, spouse: 0, spouseSpecial: 0, dependents: 0, specifiedRelative: 0, socialInsurance: 0, lifeInsurance: 0, earthquake: 0, smallBusiness: 0, total: deductions, personalDiff }),
    "pension.oldAge": () => ({ flows: [], months: [], payments: [] }),
  });
}

/** 出産手当金（98日）: 休業の前12か月の標準報酬月額を、前の6か月と後の6か月で与える */
function maternity(first6: number, last6: number): number {
  const req = household({
    baseMonth: "2026-01",
    endYear: 2027,
    members: [member("l2p.a", "self", "1992-01")],
    periods: [
      period("l2p.p1", { member: "l2p.a", from: "2015-04", to: "2026-05", annual: first6 * 12, std: [first6, first6] }),
      period("l2p.p2", { member: "l2p.a", from: "2026-06", to: "2026-11", annual: last6 * 12, std: [last6, last6] }),
      { id: uid("l2p.l"), member: A, from: { at: "2026-12" }, to: { at: "2027-02" }, type: "leave", leaveKind: "maternity" },
    ],
  });
  const f = entry<{ flows: { formula: string; amount: number }[] }>(withH(req, { residentTaxAssessments: [rta(A)] }), "benefit.health", { member: A }).flows;
  return f.find((x) => x.formula === "benefit.health.maternityAllowance")?.amount ?? -1;
}

/** 育児休業給付金・出生後休業支援給付・育児時短就業給付: 月給（賞与なし）と休業の始まり */
function childcare(monthly: number, leaveFrom: string, formula: string, extraMembers: Record<string, unknown>[] = []): number {
  const req = household({
    baseMonth: "2026-01",
    endYear: 2027,
    members: [member("l2p.a", "self", "1990-01", { sex: "male" }), member("l2p.c", "child", leaveFrom), ...extraMembers],
    periods: [
      period("l2p.p1", { member: "l2p.a", from: "2015-04", to: "2025-12" === leaveFrom ? "2025-11" : prevMonth(leaveFrom), annual: monthly * 12, std: [300000, 300000] }),
      { id: uid("l2p.l"), member: A, from: { at: leaveFrom }, to: { at: leaveFrom }, type: "leave", leaveKind: "childcare", leaveChild: uid("l2p.c") },
      period("l2p.p2", { member: "l2p.a", from: nextMonth(leaveFrom), annual: monthly * 12, std: [300000, 300000] }),
    ],
  });
  const f = run(withH(req, { residentTaxAssessments: [rta(A, 2025), rta(A, 2026)] })).flows;
  return f.find((x) => x.formula === formula && x.member === A)?.amount ?? -1;
}
function nextMonth(ym: string): string {
  const [y, m] = ym.split("-").map(Number) as [number, number];
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`;
}
function prevMonth(ym: string): string {
  const [y, m] = ym.split("-").map(Number) as [number, number];
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`;
}

/** 育児時短就業給付（時短の前の賃金と時短中の賃金。2026年9月分） */
function shortHours(before: number, during: number): number {
  const req = household({
    baseMonth: "2026-06",
    endYear: 2027,
    members: [member("l2p.a", "self", "1990-01"), member("l2p.c", "child", "2025-12")],
    periods: [
      period("l2p.p1", { member: "l2p.a", from: "2015-04", annual: during * 12, std: [440000, 440000], extra: { childcareShortHours: { child: uid("l2p.c"), wageBefore: box(before) } } }),
    ],
  });
  const f = run(withH(req, { residentTaxAssessments: [rta(A)] })).flows;
  return f.find((x) => x.formula === "benefit.employment.shortHours" && x.ym === "2026-10")?.amount ?? -1;
}

const LK03 = `${NENKIN}service/pamphlet/kyufu.files/LK03.pdf`;
const ZR = `${NENKIN}tokusetsu/zairoukaisei.html`;
const KS = `${NENKIN}service/jukyu/seido/roureinenkin/kuriage-kurisage/20140421-02.html`;
const KAKYU = `${NENKIN}service/jukyu/seido/roureinenkin/kakyu-hurikae/20150401.html`;
const SB = `${NENKIN}section/faq/jukyu/seido/sonota-kyufu/shienkyufukin/kaiteitsuchi/keisan.html`;
const IK = "https://www.mhlw.go.jp/content/11600000/001461102.pdf";

export const PENSION_CASES: readonly L2Case[] = [
  { id: "pn.basic.full.r8", area: "公的年金", title: "老齢基礎年金の満額 令和8年度（昭和31年4月2日以後生まれ）", source: { url: LK03, note: SUM }, expected: 847300, actual: () => basicFromMonths(480, "1961-05", "2026-04", "2026-06"), status: "pass" },
  { id: "pn.basic.full.r8.old", area: "公的年金", title: "老齢基礎年金の満額 令和8年度（昭和31年4月1日以前生まれ）", source: { url: "https://www.mhlw.go.jp/content/12600000/001672868.pdf", note: SUM }, expected: 844900, actual: () => basicFromMonths(480, "1955-10", "2026-04", "2026-06"), status: "pass" },
  { id: "pn.basic.full.r7", area: "公的年金", title: "老齢基礎年金の満額 令和7年度（昭和31年4月2日以後生まれ）", source: { url: `${NENKIN}oshirase/taisetu/2025/202504/040102.html`, note: SUM }, expected: 831700, actual: () => basicFromMonths(480, "1959-05", "2025-10", "2025-10"), status: "pass" },
  {
    id: "pn.basic.455", area: "公的年金", title: "老齢基礎年金 令和8年度: 納付済400月・全額免除40月（1/2）・4分の3納付40月（7/8）＝455月分 → 803,170円", source: { url: LK03, note: `${SUM}。免除の月は入れないので、455月の納付済として試す` },
    expected: 803170, actual: () => basicFromMonths(455, "1961-05", "2026-04", "2026-06"), status: "pass",
  },
  { id: "pn.deferral.70", area: "公的年金", title: "繰下げ: 70歳0か月で +42%（老齢基礎年金 100万円 → 142万円）", source: { url: KS, note: SUM }, expected: 1420000, actual: () => claimed(1000000, "2031-06", "2031-06"), status: "pass" },
  { id: "pn.deferral.75", area: "公的年金", title: "繰下げ: 75歳で +84%（昭和27年4月2日以後生まれ）", source: { url: KS, note: SUM }, expected: 1840000, actual: () => claimed(1000000, "2036-06", "2036-06"), status: "pass" },
  { id: "pn.early.60", area: "公的年金", title: "繰上げ: 60歳0か月で −24%（昭和37年4月2日以後生まれは0.4%/月。この例の生年月日では0.5%/月）", source: { url: `${NENKIN}service/jukyu/seido/roureinenkin/kuriage-kurisage/20140421-01.html`, note: `${SUM}。生年月日（1961年5月）が昭和37年4月1日以前なので減額率は0.5%` }, expected: 700000, actual: () => claimed(1000000, "2021-06", "2026-06"), status: "pass" },
  { id: "pn.working.none", area: "公的年金", title: "在職老齢年金 令和8年度: 基本月額10万円＋総報酬月額相当額46万円は65万円以下 → 全額支給", source: { url: ZR, note: SUM }, expected: 1200000, actual: () => working(1200000, 460000, 0), status: "pass" },
  { id: "pn.working.stop", area: "公的年金", title: "在職老齢年金 令和8年度: 基本月額10万円・標準報酬月額47万円・標準賞与額132万円 → 支給月額8.5万円（年102万円）", source: { url: `${NENKIN}service/pamphlet/kyufu.html`, note: `${SUM}（在職老齢年金のパンフレット 2026年1月版）` }, expected: 1020000, actual: () => working(1200000, 470000, 1320000), status: "pass" },
  { id: "pn.supplement.r8", area: "公的年金", title: "加給年金額（配偶者）＋特別加算 令和8年度（受給権者が昭和18年4月2日以後生まれ）→ 423,700円", source: { url: KAKYU, note: SUM }, expected: 1000000 + 423700, actual: () => couple("2026-04", "1961-05", "1964-08", "h", "2026-06"), status: "pass" },
  {
    id: "pn.supplement.r8.existing", area: "公的年金", title: "加給年金額（配偶者）＋特別加算 令和8年度（受給権者が昭和31年4月1日以前生まれ。既裁定者でも新規裁定者の改定率）→ 423,700円",
    source: { url: KAKYU, note: `${SUM}。表の額は受給権者の生年月日の区分（特別加算）だけで決まり、既裁定者の改定率は使わない（厚生年金保険法44条2項・昭和60年改正法附則60条2項）` },
    expected: 1000000 + 423700, actual: () => couple("2026-04", "1955-05", "1963-08", "h", "2026-06"), status: "pass",
  },
  { id: "pn.transfer.r8", area: "公的年金", title: "振替加算 令和8年度水準（配偶者が昭和36年4月2日〜昭和41年4月1日生まれ）→ 16,335円", source: { url: KAKYU, note: `${SUM}（地方職員共済の例と同額）。妻が65歳になる令和9年度は改定率を前提で延ばし、物価・賃金の前提を置かないので令和8年度と同じ` }, expected: 600000 + 16335, actual: () => couple("2026-04", "1961-05", "1962-08", "w", "2027-09"), status: "pass" },
  { id: "pn.transfer.r7", area: "公的年金", title: "振替加算 令和7年度（配偶者が昭和30年4月2日〜昭和31年4月1日生まれ）→ 54,162円", source: { url: "https://www.shaho-net.co.jp/nenkin_guide/images/104_02.pdf", note: `${SUM}（令和7年度の表）` }, expected: 600000 + 54162, actual: () => couple("2025-10", "1953-05", "1955-10", "w", "2025-10"), status: "pass" },
  { id: "pn.supportBenefit.480", area: "公的年金", title: "年金生活者支援給付金 令和8年度: 納付済480月 → 月5,620円", source: { url: SB, note: SUM }, expected: 5620, actual: () => supportBenefit(480), status: "pass" },
  {
    id: "pn.supportBenefit.240", area: "公的年金", title: "年金生活者支援給付金 令和8年度: 納付済240月・全額免除60月 → 5,620×240/480＋847,300÷12×(60×1/6)/480 = 2,810＋1,471 = 月4,281円", source: { url: SB, note: SUM }, expected: 4281, actual: () => supportBenefit(240, 60), status: "pass",
  },
  // 年金の税
  { id: "pt.pensionIncome.matsudo", area: "公的年金", title: "松戸市: 年金収入 2,500,000円（65歳以上）の雑所得", source: { url: "https://www.city.matsudo.chiba.jp/kurashi/zeikin_top/kojiin/shikenminzei/kojin_keisan_nekin.html", note: SUM }, expected: 1400000, actual: () => pensionIncome(2025, "1953-01", 2500000).income, status: "pass" },
  {
    id: "pt.combinedLimit", area: "公的年金", title: "令和9年分から: 給与所得控除190万円＋公的年金等控除110万円＝300万円のとき、280万円を超える20万円を公的年金等控除から引く", source: { url: `${NENKIN}oshirase/taisetu/kojin/2026/202606/0617.html`, note: SUM },
    expected: 900000, actual: () => pensionIncome(2027, "1960-01", 2000000, { revenue: 8000000, deduction: 1900000, income: 6100000 }).deduction, status: "pass",
  },
  {
    id: "pt.incomeAdjustment", area: "公的年金", title: "所得金額調整控除: 給与所得控除後の給与等の金額 276万円・公的年金等に係る雑所得 90万円 → 10万円", source: { url: "https://www.nta.go.jp/taxes/shiraberu/taxanswer/shotoku/1411.htm", note: SUM },
    expected: 100000,
    actual: () =>
      entry<TotalIncomeOutput>(household({ baseMonth: "2026-01", endYear: 2026, members: [member("l2p.a", "self", "1958-01")] }), "tax.totalIncome", { member: A, year: 2026 }, {
        "tax.employmentIncome": () => ({ revenue: 4000000, deduction: 1240000, income: 2760000 }),
        "tax.publicPensionIncome": () => ({ revenue: 2000000, deduction: 1100000, income: 900000 }),
      }).adjustment ?? -1,
    status: "pass",
  },
  { id: "rt.matsudo.pension", area: "住民税", title: "松戸市 令和8年度: 年金の雑所得 1,400,000円・所得控除 1,260,000円・人的控除額の差 15万円の住民税", source: { url: "https://www.city.matsudo.chiba.jp/kurashi/zeikin_top/kojiin/shikenminzei/kojin_keisan_nekin.html", note: SUM }, expected: 12000, actual: () => residentTax(1400000, 1260000, 150000).total, status: "pass" },
  { id: "rt.okayama.levy", area: "住民税", title: "岡山市 令和8年度（年金の例）: 所得割の合計（市 21,500円＋県 5,300円）", source: { url: "https://www.city.okayama.jp/kurashi/0000005501.html", note: `${SUM}。岡山市は指定都市で配分が違うが、合計は同じ` }, expected: 26800, actual: () => { const r = residentTax(1400000, 1081000, 100000); return r.incomeLevy.municipal + r.incomeLevy.prefectural; }, status: "pass" },
  {
    id: "rt.okayama.total", area: "住民税", title: "岡山市 令和8年度（年金の例）: 年税額 32,300円", source: { url: "https://www.city.okayama.jp/kurashi/0000005501.html", note: SUM }, expected: 32300, actual: () => residentTax(1400000, 1081000, 100000).total, status: "knownMismatch",
    cause: "岡山県の超過課税（県民税の均等割の上乗せ500円）を入れていない（全国一律の標準税率で計算する。決定8）",
  },
  // 休業の給付
  { id: "bf.maternity.3780", area: "給付", title: "出産手当金: 標準報酬月額 16万円×6か月・18万円×6か月 → 日額 3,780円（×98日）", source: { url: "https://www.kyoukaikenpo.or.jp/benefit/childbirth/001/index.html", note: SUM }, expected: 3780 * 98, actual: () => maternity(160000, 180000), status: "pass" },
  { id: "bf.childcare.201000", area: "給付", title: "育児休業給付金: 休業開始時賃金日額 10,000円（賃金月額 30万円）×30日×67% → 201,000円", source: { url: IK, note: SUM }, expected: 201000, actual: () => childcare(300000, "2026-01", "benefit.employment.childcareLeave"), status: "pass" },
  { id: "bf.childcare.cap", area: "給付", title: "育児休業給付金の上限（2026年8月から）: 16,540円×30日×67% → 332,454円", source: { url: "https://www.mhlw.go.jp/content/11600000/001551858.pdf", note: SUM }, expected: 332454, actual: () => childcare(600000, "2026-08", "benefit.employment.childcareLeave"), status: "pass" },
  { id: "bf.postBirth.cap", area: "給付", title: "出生後休業支援給付の上限（2025年8月から）: 16,110円×28日×13% → 58,640円", source: { url: "https://www.mhlw.go.jp/content/001520023.pdf", note: SUM }, expected: 58640, actual: () => childcare(600000, "2026-01", "benefit.employment.postBirth"), status: "pass" },
  { id: "bf.shortHours", area: "給付", title: "育児時短就業給付: 時短の前 496,200円・時短中 445,000円 → 支給限度額 484,121円まで 39,121円", source: { url: "https://bestcalendar.jp/", note: `${SUM}。民間のサイトが厚生労働省の例として載せたもの（1経路）` }, expected: 39121, actual: () => shortHours(496200, 445000), status: "pass" },
  // 国民年金
  {
    id: "np.premium.r8", area: "社会保険", title: "国民年金保険料 令和8年度: 月額 17,920円", source: { url: `${NENKIN}service/kokunen/hokenryo/hokenryo.html`, note: SUM }, expected: 17920,
    actual: () => {
      const req = withH(household({ baseMonth: "2026-06", endYear: 2027, members: [member("l2p.a", "self", "1990-01")], periods: [{ id: uid("l2p.p"), member: A, from: { at: "2015-04" }, to: null, type: "selfEmployed", business: { income: box(3000000) } }] }), { residentTaxAssessments: [rta(A)] });
      return run(req).flows.find((f) => f.formula === "socialInsurance.nationalPension.monthly" && f.ym === "2026-07")?.amount ?? -1;
    },
    status: "pass",
  },
];
