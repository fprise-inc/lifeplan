// AI接続口（crates/lifeplan）に同梱する、計算の答えの「主な数字」と家族の年齢（0194）。
// - 主な数字は、画面の「プランを比較」の比較の表と同じ関数（workspace/plans/compare.ts の metricsOf）で数える:
//   指定した年齢の時点の金融資産・資産が尽きる年・生涯の手取りの合計・生涯の支出の合計・金融資産がいちばん少ない年と額・住宅ローンの返済の合計。
//   住宅ローンの利息の合計（0205）は、画面に同じ数字が無いので、エンジンの要約の負債ごとの年ごとの利息（summary.loans）を、住宅ローンの返済の合計と
//   同じ年（画面の表に出す年）で足す
//   年齢の既定は、画面の表示の設定の既定（「○歳時点」の 95歳。workspace/settings.ts の DEFAULT_DISPLAY_SETTINGS。同じことをテストで確かめる）
// - 年ごとの家族の年齢は、画面のキャッシュフロー表の年齢の行と同じ関数（workspace/present.ts の ageRows）で、同じ呼び方・同じ「世帯にいる年」で出す
// - 65歳からの年金の月額（世帯の合計と人ごと。今の水準）は、画面の比較の表の年金の行（0075）と同じ写しの要求（input/pensionLines.ts の
//   pensionEstimateRequest）を pensionRequests で作り、接続口が計算の前の処理を当てて計算した結果を summarize に渡して、同じ関数
//   （pensionLines・planPensionOf）で数える（0199）
// - 接続口は、計算した表（表示の形の出力）と、計算の前の処理を当てる前の要求（数字の根拠と同じ）を渡す。返すのは JSON の文字
// - 計算のお知らせ（notices.ts。画面の結果のタブの「計算のお知らせ」と同じ関数・同じ文。0210）も、頼まれたときだけここで一緒に作る
// - 画面の部品（preact）・本体の命令・保存の部品は読まない（lint とまとめる道具が止める）
import type { EngineRequest, PreviewResult } from "../engine/types.ts";
import { anyClaimOf, modeOf, pensionEstimateRequest, pensionLines, pensionMembers, planPensionOf, type PensionLine } from "../workspace/input/pensionLines.ts";
import { metricsOf } from "../workspace/plans/compare.ts";
import { ageRows, displayYears, rowDefs, yearsWithin } from "../workspace/present.ts";
import { ageInYear, roles } from "../workspace/roles.ts";
import { noticesOf, type ConnectorNotice } from "./notices.ts";

/** 「○歳時点の金融資産」の年齢の既定（画面の表示の設定の既定と同じ） */
export const DEFAULT_AT_AGE = 95;

export interface SummaryArgs {
  /** 「○歳時点の金融資産」の年齢（本人）。最初の年齢が主な数字の年齢。省くと既定の年齢だけ */
  atAges?: number[];
  /**
   * 年金の見込みの写しの要求（pensionRequests）を計算の前の処理を当てて計算した結果（std は65歳から、claimed は受け取り開始を変えたまま。
   * 計算できなければ null）。省くと keyFigures に pension を入れない
   */
  pension?: { std: PreviewResult | null; claimed: PreviewResult | null };
  /**
   * 計算のお知らせ（画面の結果のタブと同じ文の行。notices.ts。0210）を返すか。full は画面の文つき、brief は文を省いて鍵だけ。
   * 省くと返さない
   */
  notices?: "full" | "brief";
}

/** 年金の見込みの人ごとの1行（AI に返す形。年齢の鍵・受け取り開始・年額・月額・推計か） */
export interface PensionPerson {
  who: string;
  from: string;
  annual: number | null;
  monthly: number | null;
  /** 書類が無く、働き方の期間から推計した額 */
  estimated: boolean;
}

/** 年金の見込み（画面の比較の表の年金の行と同じ。今の水準＝賃金・物価の伸びとマクロ経済スライドを外した額） */
export interface PensionFigures {
  /** 65歳からの世帯の合計の月額（受け取り中なら今の月額）。年額が出る人がいなければ null */
  monthly: number | null;
  /** 受け取り開始からの世帯の合計の月額（受け取り開始を変えた人がいなければ monthly と同じ） */
  claimedMonthly: number | null;
  /** 全員もう受け取っている */
  receiving: boolean;
  /** 受け取り開始を変えた人がいる */
  anyClaim: boolean;
  /** 人ごと（65歳から） */
  people: PensionPerson[];
  /** 人ごと（受け取り開始から。受け取り開始を変えた人がいるときだけ） */
  claimedPeople?: PensionPerson[];
}

/**
 * 年金の見込みの写しの要求（画面の比較の表の年金の行と同じ。reqJson は計算の前の処理を当てる前の要求）。年金のカードに出す人がいなければ
 * std も null。戻り値は JSON の文字 { std, claimed }（接続口は、それぞれに計算の前の処理を当てて計算し、summarize の pension に渡す）
 */
export function pensionRequests(reqJson: string): string {
  const req = JSON.parse(reqJson) as EngineRequest;
  if (pensionMembers(req.input.household).length === 0) return JSON.stringify({ std: null, claimed: null });
  return JSON.stringify({ std: pensionEstimateRequest(req, false), claimed: anyClaimOf(req) ? pensionEstimateRequest(req, true) : null });
}

/** 年金の見込みを、画面の比較の表と同じ関数で数える（年金のカードに出す人がいなければ null） */
export function pensionOf(req: EngineRequest, p: NonNullable<SummaryArgs["pension"]>, keys: Record<string, string>): PensionFigures | null {
  if (pensionMembers(req.input.household).length === 0) return null;
  const plan = planPensionOf(req, p.std, p.claimed);
  const recs = req.input.household.pensionRecords ?? [];
  const person = (l: PensionLine): PensionPerson => ({
    who: keys[l.member] ?? "",
    from: l.from,
    annual: l.annual,
    // 人ごとの月額は、年金のカードと同じ丸め（年額÷12 を円に）
    monthly: l.annual === null ? null : Math.round(l.annual / 12),
    estimated: modeOf(recs.find((x) => x.member === l.member)) === "",
  });
  const out: PensionFigures = {
    monthly: plan.std,
    claimedMonthly: plan.claimed,
    receiving: plan.receiving,
    anyClaim: plan.anyClaim,
    people: p.std === null ? [] : pensionLines({ request: req }, p.std, false).map(person),
  };
  if (plan.anyClaim && p.claimed !== null) out.claimedPeople = pensionLines({ request: req }, p.claimed, true).map(person);
  return out;
}

/** 年ごとの住宅ローンの数字（0203。比較の道具の系列・グラフの返済額に使う） */
export interface LoanYear {
  /** 住宅ローンの返済（年額。繰上返済・手数料を含む。主な数字の住宅ローンの返済の合計と同じ数え方で、表に出す年の合計がその合計になる） */
  loanRepayment: number;
  /** 住宅ローン残高（年末。画面のキャッシュフロー表の「住宅ローン残高」の行と同じ） */
  loanBalance: number;
  /** 住宅ローンの利息（年額。返済のうち利息に充てた額。表に出す年の合計が keyFigures.loanInterest。0205） */
  loanInterest: number;
  /**
   * その年の住宅ローンの金利（その年の最後の返済に当てた金利。10進の文字。変動金利の上乗せを含む。0205）。返済の無い年と、金利の違う
   * 住宅ローンを2本以上返している年は null（ローンごとの金利は、エンジンの要約の loans）
   */
  loanRate: string | null;
}

/** エンジンの要約の、世帯の負債ごとの年ごとの利息と金利（0205。plan.cashflow の details.loans） */
export interface EngineLoan {
  object: string;
  kind: "mortgage" | "car" | "scholarship" | "other";
  years: { year: number; interest: number; rate: string }[];
  interestTotal: number;
}

/** エンジンの要約の負債ごとの年ごとの利息と金利（無ければ空） */
export function engineLoansOf(summary: unknown): EngineLoan[] {
  const l = (summary as { loans?: unknown } | null | undefined)?.loans;
  return Array.isArray(l) ? (l as EngineLoan[]) : [];
}

/**
 * 年ごとの住宅ローンの数字（表の年ごと）。返済は主な数字の住宅ローンの返済の合計（plans/compare.ts の metricsOf）と同じく
 * cf.expense.housing.loan の下の行、残高は画面の表の「住宅ローン残高」の行（present.ts の rowDefs の debt）の数え方。
 * 利息と金利は、エンジンの要約の住宅ローン（kind が mortgage）の年ごとの利息と金利（0205）
 */
export function loanYearsOf(req: EngineRequest, table: PreviewResult["table"], summary?: unknown): Record<string, LoanYear> {
  const debt = rowDefs(req).find((d) => d.key === "debt");
  const out: Record<string, LoanYear> = {};
  const at = (y: number) => (out[String(y)] ??= { loanRepayment: 0, loanBalance: 0, loanInterest: 0, loanRate: null });
  for (const c of table) {
    if (c.row === "cf.expense.housing.loan" || c.row.startsWith("cf.expense.housing.loan.")) at(c.year).loanRepayment += c.amount;
    else if (debt !== undefined && debt.match(c)) at(c.year).loanBalance += c.amount;
  }
  const rates = new Map<number, Set<string>>();
  for (const l of engineLoansOf(summary)) {
    if (l.kind !== "mortgage") continue;
    for (const e of l.years) {
      at(e.year).loanInterest += e.interest;
      rates.set(e.year, (rates.get(e.year) ?? new Set()).add(e.rate));
    }
  }
  for (const [y, r] of rates) if (r.size === 1) at(y).loanRate = [...r][0] as string;
  return out;
}

/**
 * 年ごとの収支の内訳（0207。比較の道具の系列・グラフに使う）。支出の内訳は、画面のキャッシュフロー表の支出の行（present.ts の rowDefs）と同じ当て方で、
 * 医療・介護（cf.expense.care の下）だけを「その他の支出」から分けた物。内訳を全部足すと、年ごとの支出（expense。税・社会保険料を除く）になる
 */
export interface FlowYear {
  /** 公的年金（年額。画面の表の「○○の年金」の行の合計。企業年金・個人年金は入れない） */
  pension: number;
  /** 生活費（画面の表の「生活費」の行。車の費用・ゆとりの支出は入れない） */
  expenseLiving: number;
  /** ゆとりの支出（黒字のうち貯まらない分） */
  expenseSurplus: number;
  /** 住居費（ローン・税・修繕。住まい以外の不動産のローンの返済は入れない） */
  expenseHousing: number;
  /** 教育費 */
  expenseEducation: number;
  /** 保険料（車の保険は入れない） */
  expenseInsurance: number;
  /** 一時的支出（旅行・家電・冠婚葬祭など。車の買い替えは入れない） */
  expenseLumpSum: number;
  /** 車の費用（買い替え・維持費・ローンの返済） */
  expenseCar: number;
  /** 医療・介護（医療費の窓口の負担・介護の費用・施設の費用） */
  expenseCare: number;
  /** 住まい以外の不動産の経費・大きな修繕・ローンの返済 */
  expenseRealEstate: number;
  /** その他の支出（画面の表の「その他の支出」から医療・介護を除いた物。奨学金などの返済・FP への顧問料など） */
  expenseOther: number;
}

/** 年ごとの収支の内訳の数字の名前（FlowYear の鍵。接続口の answer.rs の FLOW_FIELDS と同じ並び） */
export const FLOW_FIELDS: readonly (keyof FlowYear)[] = [
  "pension",
  "expenseLiving",
  "expenseSurplus",
  "expenseHousing",
  "expenseEducation",
  "expenseInsurance",
  "expenseLumpSum",
  "expenseCar",
  "expenseCare",
  "expenseRealEstate",
  "expenseOther",
];

/** 画面の表の支出の行の鍵 → 内訳の名前（その他の支出は、医療・介護を分けてから） */
const EXPENSE_OF: Record<string, keyof FlowYear> = {
  living: "expenseLiving",
  surplusSpend: "expenseSurplus",
  housing: "expenseHousing",
  education: "expenseEducation",
  insurance: "expenseInsurance",
  lumpSum: "expenseLumpSum",
  car: "expenseCar",
  realEstateExpense: "expenseRealEstate",
  realEstateLoan: "expenseRealEstate",
  expenseOther: "expenseOther",
};

const under = (row: string, prefix: string): boolean => row === prefix || row.startsWith(`${prefix}.`);

/** 年ごとの収支の内訳（表の年ごと。0207） */
export function flowYearsOf(req: EngineRequest, table: PreviewResult["table"]): Record<string, FlowYear> {
  const defs = rowDefs(req).filter((d) => d.group === "expense" && d.kind === "value" && EXPENSE_OF[d.key] !== undefined);
  const out: Record<string, FlowYear> = {};
  const at = (y: number): FlowYear => (out[String(y)] ??= Object.fromEntries(FLOW_FIELDS.map((k) => [k, 0])) as unknown as FlowYear);
  for (const c of table) {
    if (under(c.row, "cf.income.pension")) at(c.year).pension += c.amount;
    if (!under(c.row, "cf.expense")) continue;
    const d = defs.find((x) => x.match(c));
    if (d === undefined) continue;
    const k = d.key === "expenseOther" && under(c.row, "cf.expense.care") ? "expenseCare" : (EXPENSE_OF[d.key] as keyof FlowYear);
    at(c.year)[k] += c.amount;
  }
  return out;
}

export interface Summary {
  /** 家族（年齢の鍵と呼び方。並びは画面の表の年齢の行と同じ） */
  members: { key: string; label: string }[];
  /** 年ごとの家族の年齢（年 → 鍵 → 年齢。世帯にいない人は入れない） */
  ages: Record<string, Record<string, number>>;
  /** 構成員の ID → 年齢の鍵（接続口が必要保障額・相続税の目安の人に鍵を添えるために使う。AI には返さない） */
  memberKeys: Record<string, string>;
  /** 年ごとの住宅ローンの数字（接続口が年ごとの数字の loanRepayment・loanBalance に写す。0203） */
  loanYears: Record<string, LoanYear>;
  /** 年ごとの収支の内訳（接続口が年ごとの数字の pension・expense〜 に写す。0207） */
  flowYears: Record<string, FlowYear>;
  keyFigures: {
    /** 数えた年（画面の表に出す年。計算基準月が年の途中なら翌年から） */
    years: { from: number; to: number } | null;
    assetsAtAge: { age: number; year: number; amount: number }[];
    depletion: { year: number; selfAge: number | null } | null;
    minimum: { year: number; amount: number; selfAge: number | null };
    lifetimeTakeHome: number;
    lifetimeExpense: number;
    loanRepayment: number;
    /** 住宅ローンの利息の合計（返済のうち利息に充てた額。住宅ローンの返済の合計と同じ年で数える。0205） */
    loanInterest: number;
    /** 年金の見込み（args の pension を渡したときだけ。年金のカードに出す人がいなければ null） */
    pension?: PensionFigures | null;
  };
  /** 計算のお知らせ（args の notices を渡したときだけ。画面の結果のタブの「計算のお知らせ」と同じ行。0210） */
  notices?: ConnectorNotice[];
}

/** 主な数字と年齢。resultJson は表示の形の計算の出力、reqJson は計算の前の処理を当てる前の要求 */
export function summarize(resultJson: string, reqJson: string, argsJson: string): string {
  const result = JSON.parse(resultJson) as PreviewResult;
  const req = JSON.parse(reqJson) as EngineRequest;
  const a = JSON.parse(argsJson) as SummaryArgs;
  return JSON.stringify(summaryOf(req, result, a));
}

export function summaryOf(req: EngineRequest, result: PreviewResult, a: SummaryArgs = {}): Summary {
  const table = result.table;
  const tableYears = [...new Set(table.map((c) => c.year))].sort((x, y) => x - y);
  const rows = ageRows(req, tableYears);
  const members: Summary["members"] = [];
  const ages: Summary["ages"] = {};
  for (const r of rows) {
    if (r.kind !== "age") continue;
    const key = r.key.replace(/^age:/, "");
    members.push({ key, label: r.label });
    r.ages.forEach((age, i) => {
      if (age === null) return;
      const y = String(tableYears[i]);
      (ages[y] ??= {})[key] = age;
    });
  }
  const rs = roles(req);
  const memberKeys: Record<string, string> = {};
  for (const r of rs) memberKeys[r.member.id] = r.key;
  const self = rs.find((r) => r.key === "self");
  const selfAge = (y: number) => (self === undefined ? null : ageInYear(self.member, y));
  const atAges = a.atAges !== undefined && a.atAges.length > 0 ? a.atAges : [DEFAULT_AT_AGE];
  const ms = atAges.map((age) => metricsOf(req, table, age));
  const m = ms[0]!;
  // 主な数字を数えた年（metricsOf と同じく、画面の表に出す年のうち、そのプランの表がある年）
  const counted = yearsWithin(table, displayYears(req));
  const shown = counted.length > 0 ? { from: counted[0]!, to: counted[counted.length - 1]! } : null;
  const loanYears = loanYearsOf(req, table, result.summary);
  // 住宅ローンの利息の合計: 主な数字の住宅ローンの返済の合計（metricsOf）と同じ年で足す
  const loanInterest = counted.reduce((a, y) => a + (loanYears[String(y)]?.loanInterest ?? 0), 0);
  return {
    members,
    ages,
    memberKeys,
    loanYears,
    flowYears: flowYearsOf(req, table),
    keyFigures: {
      years: shown,
      assetsAtAge: ms.map((x) => ({ age: x.targetAge, year: x.targetYear, amount: x.target })),
      depletion: m.depletion === null ? null : { year: m.depletion, selfAge: selfAge(m.depletion) },
      minimum: { year: m.min.year, amount: m.min.amount, selfAge: selfAge(m.min.year) },
      lifetimeTakeHome: m.takeHome,
      lifetimeExpense: m.expense,
      loanRepayment: m.loan,
      loanInterest,
      ...(a.pension !== undefined ? { pension: pensionOf(req, a.pension, memberKeys) } : {}),
    },
    ...(a.notices !== undefined ? { notices: noticesOf(req, result, a.notices === "brief") } : {}),
  };
}
