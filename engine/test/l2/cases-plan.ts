// 答え合わせ（検証 L2）: 退職所得の税・教育の公的支援・児童手当・公務員の退職手当（製品の制度データ）。
// 2026-10-09 にこの作業の環境から公式のサイト（国税庁・文部科学省・日本学生支援機構・こども家庭庁など）に届かなかったので、計算例と規則は
// 検索の要約で読んだもの（原本は未取得）。「検索で読んだ計算例」はその額をそのまま、「検索で読んだ規則から作った例」は規則（額・率・区分）を当てはめた例
import { runEngine } from "../../src/engine/run.ts";
import type { RetirementIncomeOutput, RetirementReceipt } from "../../src/sdk/contracts.ts";
import { household, member, realPacks, uid } from "../helpers.ts";
import type { L2Case } from "./cases.ts";

type Req = ReturnType<typeof household>;
type Obj = Record<string, unknown>;
type Flow = { row: string; ym: string; amount: number; object?: string; formula: string };
const A = uid("l2p.a");
const EX = "検索で読んだ計算例（原本は未取得。2026-10-09）";
const RULE = "検索で読んだ規則（額・率・区分）から作った例（原本は未取得。2026-10-09）";
const NTA1420 = "https://www.nta.go.jp/taxes/shiraberu/taxanswer/shotoku/1420.htm";
const NTA_TABLE = "https://www.nta.go.jp/publication/pamph/gensen/zeigakuhyo2026/data/18.pdf";
const NTA_OVERLAP = "https://www.nta.go.jp/taxes/tetsuzuki/shinsei/annai/gensen/pdf/2026bun_03-2.pdf";
const MEXT_HE = "https://www.mext.go.jp/a_menu/koutou/hutankeigen/index.htm";
const MEXT_HS = "https://www.mext.go.jp/b_menu/activity/detail/2026/20260331.html";
const JASSO = "https://www.jasso.go.jp/shogakukin/about/kyufu/kingaku.html";
const CHILD = "https://www.pref.osaka.lg.jp/o090130/kateishien/teate/jite_202410.html";
const CAS = "https://www.cas.go.jp/jp/gaiyou/jimu/jinjikyoku/files/minkan_13_09.pdf";
const at = (ym: string) => ({ at: ym });
const quiet = (o: Obj = {}) => household({ baseMonth: "2027-01", endYear: 2045, members: [member("l2p.a", "self", "1975-05")], ...o }) as Req;
const entry = <T>(req: Req, component: string, input: unknown, stubs?: Record<string, (i: unknown) => unknown>) =>
  runEngine(req, realPacks(), { checkInternal: true, entry: { component, input }, ...(stubs ? { stubs } : {}) }).entryOutput as T;

/** 退職所得の税（その年の一時金を与える） */
function ret(year: number, receipts: Omit<RetirementReceipt, "object" | "source" | "amount">[] & { amount: number; source?: RetirementReceipt["source"] }[]): RetirementIncomeOutput {
  const rs = receipts.map((r, i) => ({ object: uid(`l2p.r${i}`), source: "retirement", ...r })) as unknown as RetirementReceipt[];
  return entry<RetirementIncomeOutput>(quiet(), "tax.retirementIncome", { member: A, year }, { "retirement.receipts": () => ({ receipts: rs }) });
}

/** 修学支援の区分（親1人の住民税の課税標準額と調整控除の額を与える） */
function category(taxable: number, adjustment: number): number {
  const C = uid("l2p.c");
  const req = household({ baseMonth: "2027-01", endYear: 2032, members: [member("l2p.a", "self", "1975-05"), member("l2p.c", "child", "2009-06")], relations: [{ type: "parentOf", parent: A, child: C }] });
  (req.input.household as unknown as Obj).goals = [{ id: uid("l2p.g"), kind: "education", owner: C, education: { stages: [{ stage: "university", sector: "national", living: "home" }] } }];
  const f = entry<{ flows: Flow[] }>(req, "education.support", { member: C }, {
    "residentTax.annual": () => ({ flows: [], total: 0, assessed: false, taxable, grossLevy: { municipal: 0, prefectural: 0 }, adjustmentCredit: { municipal: adjustment, prefectural: 0 }, incomeLevy: { municipal: 0, prefectural: 0 }, perCapita: { municipal: 0, prefectural: 0 }, forestEnvironmentTax: 0 }),
  }).flows;
  // 2028年4〜9月の給付型奨学金（国公立・自宅）の月額から区分を読む
  const grant = f.filter((x) => x.formula === "education.support.grant" && x.ym === "2028-05").reduce((s, x) => s + x.amount, 0);
  return { 29200: 1, 19500: 2, 9800: 3, 0: 0 }[grant] ?? -1;
}

/** 児童手当の月額（子の生年月と生まれの順の子を与え、その月の分） */
function childAllowance(children: string[], target: number, month: string): number {
  const members = [member("l2p.a", "self", "1985-01"), ...children.map((b, i) => member(`l2p.k${i}`, "child", b))];
  const f = entry<{ flows: Flow[] }>(household({ baseMonth: "2027-01", endYear: 2030, members }), "benefit.childAllowance", {}).flows;
  const m = Number(month.slice(5));
  const pay = m % 2 === 1 ? `${month.slice(0, 5)}${String(m + 1).padStart(2, "0")}` : `${month.slice(0, 5)}${String(m + 2).padStart(2, "0")}`;
  return f.filter((x) => x.ym === pay && x.object === uid(`l2p.k${target}`)).reduce((s, x) => s + x.amount, 0) / 2;
}

/** 国家公務員の退職手当の見込み（俸給月額×支給率） */
function civilAllowance(years: number, monthly: number, reason: "retirementAge" | "voluntary"): number {
  const req = quiet();
  const from = `${2035 - years}-04`;
  (req.input.household as unknown as Obj).retirementBenefits = [{ id: uid("l2p.cs"), member: A, kind: "civilServantAllowance", service: { from: at(from), to: at("2035-03") }, estimate: { finalMonthly: monthly, reason } }];
  return entry<{ receipts: { amount: number }[] }>(req, "retirement.benefit", { member: A }).receipts[0]?.amount ?? 0;
}

const s = (url: string, note: string) => ({ url, note });

export const PLAN_CASES: readonly L2Case[] = [
  {
    id: "R-1",
    area: "退職所得",
    title: "勤続年数10年2か月は11年として退職所得控除額440万円（40万円×11年）",
    source: s(NTA1420, `${EX}。No.1420 の計算例`),
    expected: 4400000,
    actual: () => ret(2030, [{ ym: "2030-03", amount: 10000000, serviceFrom: "2020-01", serviceTo: "2030-02" }]).deduction,
    status: "pass",
  },
  {
    id: "R-2",
    area: "退職所得",
    title: "勤続30年・退職金2,000万円: 控除1,500万円、課税退職所得250万円、所得税 (250万×10%−97,500)×102.1%",
    source: s(NTA_TABLE, `${RULE}。退職所得の源泉徴収税額の速算表`),
    expected: 155702,
    actual: () => ret(2030, [{ ym: "2030-04", amount: 20000000, serviceFrom: "2000-04", serviceTo: "2030-03" }]).incomeTax,
    status: "pass",
  },
  {
    id: "R-3",
    area: "退職所得",
    title: "同じ例の住民税（課税退職所得250万円×市町村民税6%・道府県民税4%）",
    source: s("https://www.city.koto.lg.jp/060502/kurashi/zekin/kuminze/taisyoku25.html", `${RULE}。退職所得の分離課税（住民税）`),
    expected: 250000,
    actual: () => ret(2030, [{ ym: "2030-04", amount: 20000000, serviceFrom: "2000-04", serviceTo: "2030-03" }]).residentTax,
    status: "pass",
  },
  {
    id: "R-4",
    area: "退職所得",
    title: "短期退職手当等（勤続4年・800万円）: 控除160万円、150万円＋{800万−(300万＋160万)}＝490万円",
    source: s(NTA1420, `${RULE}。短期退職手当等の2分の1の上限（令和4年分以後）`),
    expected: 4900000,
    actual: () => ret(2030, [{ ym: "2030-04", amount: 8000000, serviceFrom: "2026-04", serviceTo: "2030-03" }]).income,
    status: "pass",
  },
  {
    id: "R-5",
    area: "退職所得",
    title: "特定役員退職手当等（役員等勤続3年・1,000万円）: 控除120万円、2分の1にせず880万円",
    source: s(NTA1420, `${RULE}。特定役員退職手当等`),
    expected: 8800000,
    actual: () => ret(2030, [{ ym: "2030-04", amount: 10000000, serviceFrom: "2027-04", serviceTo: "2030-03", officerFrom: "2027-04", officerTo: "2030-03" }]).income,
    status: "pass",
  },
  {
    id: "R-6",
    area: "退職所得",
    title: "前の一時金（500万円・勤続20年。控除800万円に満たない）は、500万円÷40万円＝12年（切り捨て）とみなして重複を調整",
    source: s(NTA_OVERLAP, `${EX}。前年以前の退職手当等の収入金額が控除額に満たない場合（施行令70条2項）`),
    expected: 12,
    actual: () =>
      ret(2029, [
        { ym: "2026-04", amount: 5000000, serviceFrom: "2006-04", serviceTo: "2026-03" },
        { ym: "2029-04", amount: 10000000, serviceFrom: "2006-04", serviceTo: "2029-03" },
      ]).overlapYears,
    status: "pass",
  },
  {
    id: "R-7",
    area: "退職所得",
    title: "確定拠出年金の一時金（2030年）の6年後に受ける退職金は、令和8年以後の9年内の規定で重複を調整する（重なる勤続25年）",
    source: s("https://www.zeiken.co.jp/news/15056624.php", `${RULE}。令和7年度改正（前年以前9年内）`),
    expected: 25,
    actual: () =>
      ret(2036, [
        { ym: "2030-06", amount: 15000000, serviceFrom: "2005-04", serviceTo: "2030-05", source: "dc" },
        { ym: "2036-04", amount: 20000000, serviceFrom: "2000-04", serviceTo: "2036-03" },
      ]).overlapYears,
    status: "pass",
  },
  {
    id: "R-8",
    area: "退職所得",
    title: "国家公務員の退職手当（定年・勤続35年）: 俸給月額40万円×支給率47.709",
    source: s(CAS, `${RULE}。調整率83.7/100 の後の最高の支給率（調整額は含まない）`),
    expected: 19083600,
    actual: () => civilAllowance(35, 400000, "retirementAge"),
    status: "pass",
  },
  {
    id: "E-1",
    area: "教育",
    title: "修学支援の区分: 支給額算定基準額が100円未満（住民税非課税相当）は第I区分",
    source: s(MEXT_HE, `${RULE}。支給額算定基準額＝課税標準額×6%−調整控除の額`),
    expected: 1,
    actual: () => category(0, 0),
    status: "pass",
  },
  {
    id: "E-2",
    area: "教育",
    title: "修学支援の区分: 課税標準額40万円・調整控除2,500円 → 基準額21,500円（25,600円未満）で第II区分",
    source: s(MEXT_HE, `${RULE}。第II区分は100円以上25,600円未満`),
    expected: 2,
    actual: () => category(400000, 2500),
    status: "pass",
  },
  {
    id: "E-3",
    area: "教育",
    title: "修学支援の区分: 課税標準額80万円・調整控除2,500円 → 基準額45,500円（51,300円未満）で第III区分",
    source: s(MEXT_HE, `${RULE}。第III区分は25,600円以上51,300円未満`),
    expected: 3,
    actual: () => category(800000, 2500),
    status: "pass",
  },
  {
    id: "E-4",
    area: "教育",
    title: "給付型奨学金の月額（第I区分・私立・自宅外）75,800円",
    source: s(JASSO, `${EX}。給付奨学金の支給額`),
    expected: 75800,
    actual: () => {
      const C = uid("l2p.c");
      const req = household({ baseMonth: "2027-01", endYear: 2032, members: [member("l2p.a", "self", "1975-05"), member("l2p.c", "child", "2009-06")], relations: [{ type: "parentOf", parent: A, child: C }] });
      (req.input.household as unknown as Obj).goals = [{ id: uid("l2p.g"), kind: "education", owner: C, education: { stages: [{ stage: "university", sector: "private", living: "away" }] } }];
      return entry<{ flows: Flow[] }>(req, "education.support", { member: C }).flows.filter((x) => x.formula === "education.support.grant" && x.ym === "2028-05").reduce((t, x) => t + x.amount, 0);
    },
    status: "pass",
  },
  {
    id: "E-5",
    area: "教育",
    title: "高等学校等就学支援金（私立の全日制、令和8年度から所得制限なし）の年額 457,200円",
    source: s(MEXT_HS, `${EX}。令和8年4月から`),
    expected: 457200,
    actual: () => {
      const C = uid("l2p.c");
      const req = household({ baseMonth: "2027-01", endYear: 2032, members: [member("l2p.a", "self", "1975-05"), member("l2p.c", "child", "2012-06")], relations: [{ type: "parentOf", parent: A, child: C }] });
      (req.input.household as unknown as Obj).goals = [{ id: uid("l2p.g"), kind: "education", owner: C, education: { stages: [{ stage: "highSchool", sector: "private" }] } }];
      return entry<{ flows: Flow[] }>(req, "education.support", { member: C }).flows.filter((x) => x.ym >= "2028-04" && x.ym <= "2029-03").reduce((t, x) => t + x.amount, 0);
    },
    status: "pass",
  },
  {
    id: "E-6",
    area: "教育",
    title: "児童手当の月額: 3歳未満の第1子 15,000円",
    source: s(CHILD, `${EX}。令和6年10月分から`),
    expected: 15000,
    actual: () => childAllowance(["2026-05"], 0, "2027-03"),
    status: "pass",
  },
  {
    id: "E-7",
    area: "教育",
    title: "児童手当の月額: 第3子は30,000円（22歳の年度末までの子を数える）",
    source: s(CHILD, `${EX}。多子加算`),
    expected: 30000,
    actual: () => childAllowance(["2006-05", "2012-05", "2020-05"], 2, "2027-03"),
    status: "pass",
  },
];


