// 答え合わせ（検証 L2）: 遺族年金・障害年金・死亡一時金・贈与税・保険の一時所得・高額療養費・高額介護サービス費（製品の制度データ。原本での確認待ちの値）。
// 公的機関のサイトに作業の環境から届かなかったので、計算例と額は日本年金機構・国税庁・地方公共団体の公表資料を検索の抜粋で読んだもの（原本は未取得。2026-10-09）。
// 「計算例」はその額をそのまま、「規則から作った例」は規則（額・率・区分）を当てはめた例
import { runEngine } from "../../src/engine/run.ts";
import type { DisabilityPensionOutput, GiftTaxOutput, InsuranceIncomeOutput, SurvivorPensionOutput } from "../../src/sdk/contracts.ts";
import { box, household, member, period, realPacks, uid } from "../helpers.ts";
import type { L2Case } from "./cases.ts";

type Req = ReturnType<typeof household>;
type Obj = Record<string, unknown>;
type Flow = { row: string; ym: string; amount: number; object?: string; formula: string };
const H = uid("l2c.h");
const W = uid("l2c.w");
const EX = "検索の抜粋で読んだ公表資料の額・計算例（原本は未取得。2026-10-09）";
const RULE = "検索の抜粋で読んだ規則（額・率・区分）から作った例（原本は未取得。2026-10-09）";
const NENKIN_SURVIVOR = "https://www.nenkin.go.jp/service/jukyu/izokunenkin/jukyu-yoken/20150401-04.html";
const NENKIN_DISABILITY = "https://www.nenkin.go.jp/service/jukyu/shougainenkin/jukyu-yoken/20150514.html";
const NENKIN_LUMP = "https://www.nenkin.go.jp/service/jukyu/izokunenkin/jukyu-yoken/20150424.html";
const NTA4408 = "https://www.nta.go.jp/taxes/shiraberu/taxanswer/zoyo/4408.htm";
const NTA4103 = "https://www.nta.go.jp/taxes/shiraberu/taxanswer/sozoku/4103.htm";
const NTA4508 = "https://www.nta.go.jp/taxes/shiraberu/taxanswer/zoyo/4508.htm";
const NTA1755 = "https://www.nta.go.jp/taxes/shiraberu/taxanswer/shotoku/1755.htm";
const SUGINAMI = "https://www.city.suginami.tokyo.jp/s035/news/27125.html";
const MHLW_CARE = "https://www.mhlw.go.jp/content/000334526.pdf";
const at = (ym: string) => ({ at: ym });
const entry = <T>(req: Req, component: string, input: unknown) => runEngine(req, realPacks(), { checkInternal: true, entry: { component, input } }).entryOutput as T;
const edit = (req: Req, f: (h: Obj, input: Obj) => void): Req => {
  const r = JSON.parse(JSON.stringify(req)) as Req;
  const input = r.input as unknown as Obj;
  f(input.household as Obj, input);
  return r;
};
const rta = () => [{ id: uid("l2c.rta"), member: H, fiscalYear: 2026, amount: box(300000) }];

/** 会社員の夫（1980年生まれ）が2026年10月に亡くなる。妻の生年と子の生年を与え、2026年11月の遺族年金の月の値 */
function survivor(wifeBirth: string, children: string[]): SurvivorPensionOutput["months"][number] | undefined {
  const kids = children.map((b, i) => member(`l2c.k${i}`, "child", b));
  const req = household({
    baseMonth: "2026-10",
    endYear: 2028,
    members: [member("l2c.h", "self", "1980-05", { sex: "male" }), member("l2c.w", "spouse", wifeBirth), ...kids],
    relations: [
      { type: "spouse", a: H, b: W, marriage: "legal", from: null, to: null },
      ...children.flatMap((_, i) => [
        { type: "parentOf", parent: H, child: uid(`l2c.k${i}`) },
        { type: "parentOf", parent: W, child: uid(`l2c.k${i}`) },
      ]),
    ],
    periods: [period("l2c.p", { member: "l2c.h", from: "2003-04", annual: 6000000, std: [500000, 500000] })],
    residentTaxAssessments: rta(),
  });
  const r = edit(req, (_h, input) => (input.contingencies = [{ id: uid("l2c.cg"), kind: "death", member: H, occurs: at("2026-10") }]));
  return entry<SurvivorPensionOutput>(r, "pension.survivor", { member: W }).months.find((m) => m.month === "2026-11");
}

/** 障害（初診日2025年1月・障害認定日2026年7月）の2026年8月の障害年金（子・配偶者なし） */
function disability(grade: 1 | 2 | 3, annual = 6000000, from = "2003-04"): DisabilityPensionOutput["months"][number] | undefined {
  const req = household({
    baseMonth: "2026-01",
    endYear: 2027,
    members: [member("l2c.h", "self", "1980-05", { sex: "male" })],
    periods: [period("l2c.p", { member: "l2c.h", from, annual, std: [Math.floor(annual / 12), Math.floor(annual / 12)] })],
  });
  const r = edit(req, (_h, input) => (input.contingencies = [{ id: uid("l2c.cg"), kind: "disability", member: H, occurs: at("2025-01"), grade }]));
  return entry<DisabilityPensionOutput>(r, "pension.disability", { member: H }).months.find((m) => m.month === "2026-08");
}

/** 自営業の夫（第1号の納付 months か月）が2026年10月に亡くなったときの死亡一時金（子のない妻） */
function deathLumpSum(months: number): number {
  const from = `${2026 - Math.floor(months / 12)}-10`;
  const req = household({
    baseMonth: "2026-10",
    endYear: 2028,
    members: [member("l2c.h", "self", "1980-05", { sex: "male" }), member("l2c.w", "spouse", "1985-05")],
    relations: [{ type: "spouse", a: H, b: W, marriage: "legal", from: null, to: null }],
  });
  const r = edit(req, (h, input) => {
    h.employmentPeriods = [{ id: uid("l2c.p"), member: H, from: at(from), to: null, type: "selfEmployed", business: { income: box(3000000) } }];
    h.pensionRecords = [{ id: uid("l2c.r"), member: H, kind: "history", asOf: "2026-09", history: [{ from, to: "2026-09", category: "national1" }] }];
    input.contingencies = [{ id: uid("l2c.cg"), kind: "death", member: H, occurs: at("2026-10") }];
  });
  return entry<SurvivorPensionOutput>(r, "pension.survivor", { member: W }).lumpSum;
}

/** 2026年の贈与（住宅購入の資金援助として受け取る。住宅取得等資金の非課税は指定のとき）の贈与税 */
function giftTax(gifts: Obj[]): number {
  const A = uid("l2c.a");
  const req = household({ baseMonth: "2026-01", endYear: 2028, members: [member("l2c.a", "self", "1995-01")] });
  const r = edit(req, (h) => {
    h.residences = [{ id: uid("l2c.home"), kind: "own", from: at("2026-04"), to: null, purchase: { price: 60000000, downPayment: 0, costs: 0, gifts: gifts.map((g) => ({ recipient: A, ...g })) }, ownership: [{ member: A, share: "1" }] }];
  });
  return entry<GiftTaxOutput>(r, "gift.tax", { member: A, year: 2026 }).tax;
}

/** 契約者＝受取人の学資保険の満期金（2030年8月）の一時所得のうち総所得金額に入れる額 */
function maturityIncluded(maturity: number, monthly: number): number {
  const req = household({ baseMonth: "2026-10", endYear: 2031, members: [member("l2c.h", "self", "1980-05", { sex: "male" })], residentTaxAssessments: rta() });
  const r = edit(req, (h) => {
    h.insuranceContracts = [
      {
        id: uid("l2c.ins"),
        template: "insurance.education",
        policyholder: H,
        insured: H,
        contractDate: "2020-08",
        currency: "JPY",
        premium: { amount: monthly, frequency: "monthly", payUntil: at("2030-08") },
        deductionCategory: { type: "general", regime: "new" },
        coverages: [{ id: uid("l2c.mat"), role: "main", benefit: "maturity", amount: maturity, to: at("2030-07") }],
      },
    ];
  });
  return entry<InsuranceIncomeOutput>(r, "insurance.income", { member: H, year: 2030 }).temporaryIncluded;
}

/** 区分ウ（標準報酬月額50万円）で医療費 monthly が続くときの n 回目（月）の自己負担（2026年8月診療分から） */
function highCost(monthly: number, n: number): number {
  const req = household({
    baseMonth: "2026-10",
    endYear: 2028,
    members: [member("l2c.h", "self", "1980-05", { sex: "male" })],
    periods: [period("l2c.p", { member: "l2c.h", from: "2003-04", annual: 6000000, std: [500000, 500000] })],
    residentTaxAssessments: rta(),
  });
  const r = edit(req, (_h, input) => (input.contingencies = [{ id: uid("l2c.cg"), kind: "incapacity", member: H, occurs: at("2026-11"), medical: { monthly, months: 6 } }]));
  const fs = entry<{ flows: Flow[] }>(r, "medical.highCost", { member: H }).flows;
  const ym = `2027-${String(n - 2).padStart(2, "0")}`;
  return n <= 2 ? fs.filter((f) => f.ym === `2026-${String(10 + n).padStart(2, "0")}`).reduce((s, f) => s + f.amount, 0) : fs.filter((f) => f.ym === ym).reduce((s, f) => s + f.amount, 0);
}

/** 介護保険の対象の費用（10割）が月 service の会社員（64歳・住民税の課税あり。1割負担）の自己負担の月額（高額介護サービス費の上限の後） */
function careCopay(service: number): number {
  const req = household({
    baseMonth: "2026-10",
    endYear: 2028,
    members: [member("l2c.h", "self", "1962-05", { sex: "male" })],
    periods: [period("l2c.p", { member: "l2c.h", from: "2003-04", annual: 6000000, std: [500000, 500000] })],
    residentTaxAssessments: rta(),
  });
  const r = edit(req, (h, input) => {
    (input.assumptions as Obj).inflation = { default: "0" };
    h.careExpenses = [{ id: uid("l2c.care"), member: H, from: at("2027-01"), months: 3, serviceMonthly: box(service), otherMonthly: box(0) }];
  });
  return entry<{ flows: Flow[] }>(r, "care.expense", {}).flows.filter((f) => f.ym === "2027-02").reduce((s, f) => s + f.amount, 0);
}

export const CONTINGENCY_CASES: L2Case[] = [
  { id: "S-1", area: "遺族年金・障害年金", title: "遺族基礎年金（令和8年度・子2人の妻）: 847,300＋243,800×2 = 1,334,900円", source: { url: NENKIN_SURVIVOR, note: EX }, expected: 1334900, actual: () => survivor("1985-05", ["2018-06", "2021-06"])?.basic ?? -1, status: "pass" },
  { id: "S-2", area: "遺族年金・障害年金", title: "遺族基礎年金（令和8年度・子1人の妻）: 847,300＋243,800 = 1,091,100円", source: { url: NENKIN_SURVIVOR, note: EX }, expected: 1091100, actual: () => survivor("1985-05", ["2018-06"])?.basic ?? -1, status: "pass" },
  { id: "S-3", area: "遺族年金・障害年金", title: "中高齢寡婦加算（令和8年度・40歳以上で子のない妻）: 635,500円", source: { url: NENKIN_SURVIVOR, note: EX }, expected: 635500, actual: () => survivor("1980-08", [])?.widowAddition ?? -1, status: "pass" },
  { id: "S-4", area: "遺族年金・障害年金", title: "障害基礎年金1級（令和8年度）: 847,300×1.25 = 1,059,125円", source: { url: NENKIN_DISABILITY, note: EX }, expected: 1059125, actual: () => disability(1)?.basic ?? -1, status: "pass" },
  { id: "S-5", area: "遺族年金・障害年金", title: "障害基礎年金2級（令和8年度）: 847,300円", source: { url: NENKIN_DISABILITY, note: EX }, expected: 847300, actual: () => disability(2)?.basic ?? -1, status: "pass" },
  { id: "S-6", area: "遺族年金・障害年金", title: "障害厚生年金3級の最低保障（令和8年度）: 障害基礎年金2級×3/4 = 635,500円（加入が短く報酬比例の額が少ないとき）", source: { url: NENKIN_DISABILITY, note: RULE }, expected: 635500, actual: () => disability(3, 2400000, "2024-04")?.employee ?? -1, status: "pass" },
  { id: "S-7", area: "遺族年金・障害年金", title: "死亡一時金（第1号の納付36か月以上180か月未満）: 120,000円", source: { url: NENKIN_LUMP, note: EX }, expected: 120000, actual: () => deathLumpSum(60), status: "pass" },
  { id: "G-1", area: "贈与税", title: "暦年課税・一般税率: 500万円 → (500万−110万)×20%−25万 = 53万円", source: { url: NTA4408, note: EX }, expected: 530000, actual: () => giftTax([{ giver: "other", amount: 5000000, housingExemption: "none" }]), status: "pass" },
  { id: "G-2", area: "贈与税", title: "暦年課税・特例税率（直系尊属から18歳以上）: 500万円 → (500万−110万)×15%−10万 = 48.5万円", source: { url: NTA4408, note: EX }, expected: 485000, actual: () => giftTax([{ giver: "parent", amount: 5000000, housingExemption: "none" }]), status: "pass" },
  { id: "G-3", area: "贈与税", title: "一般100万円と特例400万円: 53万×1/5＋48.5万×4/5 = 49.4万円", source: { url: NTA4408, note: EX }, expected: 494000, actual: () => giftTax([{ giver: "other", amount: 1000000, housingExemption: "none" }, { giver: "parent", amount: 4000000, housingExemption: "none" }]), status: "pass" },
  { id: "G-4", area: "贈与税", title: "相続時精算課税（2024年以後）: 3,000万円 → (3,000万−110万−2,500万)×20% = 78万円", source: { url: NTA4103, note: RULE }, expected: 780000, actual: () => giftTax([{ giver: "parent", amount: 30000000, taxMethod: "settlement", housingExemption: "none" }]), status: "pass" },
  { id: "G-5", area: "贈与税", title: "住宅取得等資金の非課税（省エネ等住宅1,000万円）と基礎控除: 1,200万円 → (1,200万−1,000万−110万)×10% = 9万円", source: { url: NTA4508, note: RULE }, expected: 90000, actual: () => giftTax([{ giver: "parent", amount: 12000000, housingExemption: "energySaving" }]), status: "pass" },
  { id: "I-1", area: "保険", title: "満期金の一時所得: 満期金300万円・払込保険料240万円 → (300万−240万−50万)×1/2 = 5万円を総所得金額に", source: { url: NTA1755, note: RULE }, expected: 50000, actual: () => maturityIncluded(3000000, 20000), status: "pass" },
  { id: "M-1", area: "医療・介護", title: "高額療養費（2026年8月診療分から・区分ウ）: 医療費100万円 → 85,800＋(100万−286,000)×1% = 92,940円", source: { url: SUGINAMI, note: EX }, expected: 92940, actual: () => highCost(1000000, 1), status: "pass" },
  { id: "M-2", area: "医療・介護", title: "高額療養費の多数回該当（区分ウ）: 4回目から44,400円", source: { url: SUGINAMI, note: EX }, expected: 44400, actual: () => highCost(1000000, 4), status: "pass" },
  { id: "C-1", area: "医療・介護", title: "高額介護サービス費（課税所得380万円未満）: 1割負担 60,000円 → 上限 44,400円", source: { url: MHLW_CARE, note: RULE }, expected: 44400, actual: () => careCopay(600000), status: "pass" },
];
