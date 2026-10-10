// 答え合わせ（検証 L2）: 遺族年金・障害年金・死亡一時金・贈与税・保険の一時所得・高額療養費・高額介護サービス費（製品の制度データ）。
// 計算例と額は、日本年金機構・国税庁・厚生労働省・地方公共団体の公表資料の原本を取得して読んだもの（2026-10-09。写しは非公開のリポジトリ）。
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
const EX = "原本の額・計算例（2026-10-09 に取得して読んだ。写しは非公開のリポジトリ）";
const RULE = "原本の規則（額・率・区分）から作った例（2026-10-09 に取得して読んだ。写しは非公開のリポジトリ）";
const NENKIN_SURVIVOR = "https://www.nenkin.go.jp/service/jukyu/seido/izokunenkin/jukyu-yoken/20150401-04.html";
const NENKIN_SURVIVOR_EMP = "https://www.nenkin.go.jp/service/jukyu/seido/izokunenkin/jukyu-yoken/20150424.html";
const NENKIN_DISABILITY = "https://www.nenkin.go.jp/service/jukyu/seido/shougainenkin/jukyu-yoken/20150514.html";
const NENKIN_DISABILITY_EMP = "https://www.nenkin.go.jp/service/jukyu/seido/shougainenkin/jukyu-yoken/20150401-02.html";
const LUMP_TABLE = "https://www.city.hiroshima.lg.jp/living/hoken-nenkin/1021145/1006017/1025570/1012136.html";
const NTA4408 = "https://www.nta.go.jp/taxes/shiraberu/taxanswer/zoyo/4408.htm";
const NTA4103 = "https://www.nta.go.jp/taxes/shiraberu/taxanswer/sozoku/4103.htm";
const NTA4508 = "https://www.nta.go.jp/taxes/shiraberu/taxanswer/sozoku/4508.htm";
const NTA1755 = "https://www.nta.go.jp/taxes/shiraberu/taxanswer/shotoku/1755.htm";
const MHLW_HIGHCOST = "https://www.mhlw.go.jp/content/001726232.pdf";
const MHLW_CARE = "https://www.mhlw.go.jp/content/12300000/001119101.pdf";
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


const EX10 = "原本の額・計算例（2026-10-10 に取得して読んだ）";
const RULE10 = "原本の規則（額・率・区分）から作った例（2026-10-10 に取得して読んだ）";
const NENKIN_OLDAGE_GUIDE = "https://www.nenkin.go.jp/service/pamphlet/kyufu.files/LK03.pdf";
const NENKIN_SURVIVOR_GUIDE = "https://www.nenkin.go.jp/service/pamphlet/kyufu.files/LK03-3.pdf";
const NENKIN_UNIT_2026 = "https://www.nenkin.go.jp/service/jukyu/seido/kyotsu/nenkingaku/20150401-02.files/0804.pdf";
const NTA_GIFT_FORM = "https://www.nta.go.jp/taxes/tetsuzuki/shinsei/shinkoku/zoyo/yoshiki2025/pdf/001.pdf";

/** 65歳（1961年6月生まれ）の老齢基礎年金（2026年10月の年額）。定期便の月数と第1号の内訳 */
function basicWithExemptions(category1: Obj, basic: number): number {
  const A = uid("l2c.oa");
  const req = edit(household({ baseMonth: "2026-10", endYear: 2028, members: [member("l2c.oa", "self", "1961-06")] }), (h) => {
    h.pensionRecords = [{ id: uid("l2c.oar"), member: A, kind: "statementUnder50", asOf: "2026-05", months: { basic, employee: 0, category1 }, amounts: { employee: box(0) } }];
  });
  return entry<{ months: { month: string; basic: number }[] }>(req, "pension.oldAgeBase", { member: A }).months.find((m) => m.month === "2026-10")?.basic ?? -1;
}

/** 自営業の夫（1980年生まれ）が2026年10月に亡くなる。第1号の納付 paid か月と4分の1免除 quarter か月（どちらも記録の中）での死亡一時金 */
function deathLumpSumExempt(paid: number, quarter: number): number {
  const total = paid + quarter;
  const ym = (back: number) => {
    const m = 2026 * 12 + 9 - back; // 2026-10 の back か月前
    return `${Math.floor(m / 12)}-${String((m % 12) + 1).padStart(2, "0")}`;
  };
  const req = household({
    baseMonth: "2026-10",
    endYear: 2028,
    members: [member("l2c.h", "self", "1980-05", { sex: "male" }), member("l2c.w", "spouse", "1985-05")],
    relations: [{ type: "spouse", a: H, b: W, marriage: "legal", from: null, to: null }],
  });
  const r = edit(req, (h, input) => {
    h.employmentPeriods = [{ id: uid("l2c.p"), member: H, from: at("2026-10"), to: null, type: "unemployed" }];
    h.pensionRecords = [
      {
        id: uid("l2c.r"),
        member: H,
        kind: "history",
        asOf: "2026-09",
        history: [
          { from: ym(total), to: ym(quarter + 1), category: "national1" },
          { from: ym(quarter), to: ym(1), category: "national1ExemptQuarter" },
        ],
      },
    ];
    input.contingencies = [{ id: uid("l2c.cg"), kind: "death", member: H, occurs: at("2026-10") }];
  });
  return entry<SurvivorPensionOutput>(r, "pension.survivor", { member: W }).lumpSum;
}

/** 会社員の夫（1960年生まれ・在職中）が2026年10月に亡くなったときの、65歳以上の妻（wifeBirth）の2026年11月の経過的寡婦加算 */
function transitionalWidow(wifeBirth: string): number {
  const req = household({
    baseMonth: "2026-10",
    endYear: 2028,
    members: [member("l2c.h", "self", "1960-05", { sex: "male" }), member("l2c.w", "spouse", wifeBirth)],
    relations: [{ type: "spouse", a: H, b: W, marriage: "legal", from: null, to: null }],
    periods: [period("l2c.p", { member: "l2c.h", from: "1983-04", annual: 6000000, std: [500000, 500000] })],
    residentTaxAssessments: rta(),
  });
  const r = edit(req, (_h, input) => (input.contingencies = [{ id: uid("l2c.cg"), kind: "death", member: H, occurs: at("2026-10") }]));
  return entry<SurvivorPensionOutput>(r, "pension.survivor", { member: W }).months.find((m) => m.month === "2026-11")?.widowAddition ?? -1;
}

export const CONTINGENCY_CASES: L2Case[] = [
  { id: "S-1", area: "遺族年金・障害年金", title: "遺族基礎年金（令和8年度・子2人の妻）: 847,300＋243,800×2 = 1,334,900円", source: { url: NENKIN_SURVIVOR, note: RULE }, expected: 1334900, actual: () => survivor("1985-05", ["2018-06", "2021-06"])?.basic ?? -1, status: "pass" },
  { id: "S-2", area: "遺族年金・障害年金", title: "遺族基礎年金（令和8年度・子1人の妻）: 847,300＋243,800 = 1,091,100円", source: { url: NENKIN_SURVIVOR, note: RULE }, expected: 1091100, actual: () => survivor("1985-05", ["2018-06"])?.basic ?? -1, status: "pass" },
  { id: "S-3", area: "遺族年金・障害年金", title: "中高齢寡婦加算（令和8年度・40歳以上で子のない妻）: 635,500円", source: { url: NENKIN_SURVIVOR_EMP, note: EX }, expected: 635500, actual: () => survivor("1980-08", [])?.widowAddition ?? -1, status: "pass" },
  { id: "S-4", area: "遺族年金・障害年金", title: "障害基礎年金1級（令和8年度）: 847,300×1.25 = 1,059,125円", source: { url: NENKIN_DISABILITY, note: EX }, expected: 1059125, actual: () => disability(1)?.basic ?? -1, status: "pass" },
  { id: "S-5", area: "遺族年金・障害年金", title: "障害基礎年金2級（令和8年度）: 847,300円", source: { url: NENKIN_DISABILITY, note: EX }, expected: 847300, actual: () => disability(2)?.basic ?? -1, status: "pass" },
  { id: "S-6", area: "遺族年金・障害年金", title: "障害厚生年金3級の最低保障（令和8年度）: 障害基礎年金2級×3/4 = 635,500円（加入が短く報酬比例の額が少ないとき）", source: { url: NENKIN_DISABILITY_EMP, note: EX }, expected: 635500, actual: () => disability(3, 2400000, "2024-04")?.employee ?? -1, status: "pass" },
  { id: "S-7", area: "遺族年金・障害年金", title: "死亡一時金（第1号の納付36か月以上180か月未満）: 120,000円", source: { url: LUMP_TABLE, note: EX }, expected: 120000, actual: () => deathLumpSum(60), status: "pass" },
  { id: "G-1", area: "贈与税", title: "暦年課税・一般税率: 500万円 → (500万−110万)×20%−25万 = 53万円", source: { url: NTA4408, note: EX }, expected: 530000, actual: () => giftTax([{ giver: "other", amount: 5000000, housingExemption: "none" }]), status: "pass" },
  { id: "G-2", area: "贈与税", title: "暦年課税・特例税率（直系尊属から18歳以上）: 500万円 → (500万−110万)×15%−10万 = 48.5万円", source: { url: NTA4408, note: EX }, expected: 485000, actual: () => giftTax([{ giver: "parent", amount: 5000000, housingExemption: "none" }]), status: "pass" },
  { id: "G-3", area: "贈与税", title: "一般100万円と特例400万円: 53万×1/5＋48.5万×4/5 = 49.4万円", source: { url: NTA4408, note: EX }, expected: 494000, actual: () => giftTax([{ giver: "other", amount: 1000000, housingExemption: "none" }, { giver: "parent", amount: 4000000, housingExemption: "none" }]), status: "pass" },
  { id: "G-4", area: "贈与税", title: "相続時精算課税（2024年以後）: 3,000万円 → (3,000万−110万−2,500万)×20% = 78万円", source: { url: NTA4103, note: RULE }, expected: 780000, actual: () => giftTax([{ giver: "parent", amount: 30000000, taxMethod: "settlement", housingExemption: "none" }]), status: "pass" },
  { id: "G-5", area: "贈与税", title: "住宅取得等資金の非課税（省エネ等住宅1,000万円）と基礎控除: 1,200万円 → (1,200万−1,000万−110万)×10% = 9万円", source: { url: NTA4508, note: RULE }, expected: 90000, actual: () => giftTax([{ giver: "parent", amount: 12000000, housingExemption: "energySaving" }]), status: "pass" },
  { id: "S-8", area: "公的年金", title: "老齢基礎年金の免除の月（令和8年度・日本年金機構の計算例）: 納付400月・全額免除40月・4分の1免除40月 → 847,300×(400＋40×1/2＋40×7/8)/480 = 803,170円", source: { url: NENKIN_OLDAGE_GUIDE, note: EX10 }, expected: 803170, actual: () => basicWithExemptions({ paid: 400, exemptFull: 40, exemptQuarter: 40 }, 400), status: "pass" },
  { id: "S-9", area: "遺族年金・障害年金", title: "死亡一時金の月数（4分の1免除は3/4で数える）: 納付27月＋4分の1免除12月×3/4 = 36月 → 120,000円", source: { url: NENKIN_SURVIVOR_GUIDE, note: RULE10 }, expected: 120000, actual: () => deathLumpSumExempt(27, 12), status: "pass" },
  { id: "S-10", area: "遺族年金・障害年金", title: "死亡一時金の月数: 納付26月＋4分の1免除12月×3/4 = 35月（36月未満）→ 0円", source: { url: NENKIN_SURVIVOR_GUIDE, note: RULE10 }, expected: 0, actual: () => deathLumpSumExempt(26, 12), status: "pass" },
  { id: "S-11", area: "遺族年金・障害年金", title: "経過的寡婦加算（令和8年度・昭和5年4月2日〜昭和6年4月1日生まれの妻）: 517,162円", source: { url: NENKIN_UNIT_2026, note: EX10 }, expected: 517162, actual: () => transitionalWidow("1930-06"), status: "pass" },
  { id: "S-12", area: "遺族年金・障害年金", title: "経過的寡婦加算（令和8年度・昭和30年4月2日〜昭和31年4月1日生まれの妻）: 21,147円", source: { url: NENKIN_UNIT_2026, note: EX10 }, expected: 21147, actual: () => transitionalWidow("1955-06"), status: "pass" },
  { id: "G-6", area: "贈与税", title: "一般と特例の両方（国税庁の申告書の計算明細の例）: 特例500万円・一般1,000万円 → 366万×5/15＋450.5万×10/15（各1円未満切り捨て）= 4,223,333円 → 100円未満切り捨て 4,223,300円", source: { url: NTA_GIFT_FORM, note: EX10 }, expected: 4223300, actual: () => giftTax([{ giver: "parent", amount: 5000000, housingExemption: "none" }, { giver: "other", amount: 10000000, housingExemption: "none" }]), status: "pass" },
  { id: "I-1", area: "保険", title: "満期金の一時所得: 満期金300万円・払込保険料240万円 → (300万−240万−50万)×1/2 = 5万円を総所得金額に", source: { url: NTA1755, note: RULE }, expected: 50000, actual: () => maturityIncluded(3000000, 20000), status: "pass" },
  { id: "M-1", area: "医療・介護", title: "高額療養費（2026年8月診療分から・区分ウ）: 医療費100万円 → 85,800＋(100万−286,000)×1% = 92,940円", source: { url: MHLW_HIGHCOST, note: RULE }, expected: 92940, actual: () => highCost(1000000, 1), status: "pass" },
  { id: "M-2", area: "医療・介護", title: "高額療養費の多数回該当（区分ウ）: 4回目から44,400円", source: { url: MHLW_HIGHCOST, note: RULE }, expected: 44400, actual: () => highCost(1000000, 4), status: "pass" },
  { id: "C-1", area: "医療・介護", title: "高額介護サービス費（課税所得380万円未満）: 1割負担 60,000円 → 上限 44,400円", source: { url: MHLW_CARE, note: RULE }, expected: 44400, actual: () => careCopay(600000), status: "pass" },
];
