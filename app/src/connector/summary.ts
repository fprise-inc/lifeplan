// AI接続口（crates/lifeplan）に同梱する、計算の答えの「主な数字」と家族の年齢（0194）。
// - 主な数字は、画面の「プランを比べる」の比較の表と同じ関数（workspace/plans/compare.ts の metricsOf）で数える:
//   指定した年齢の時点の金融資産・資産が尽きる年・生涯の手取りの合計・生涯の支出の合計・金融資産がいちばん少ない年と額・住宅ローンの返済の合計。
//   年齢の既定は、画面の表示の設定の既定（「○歳時点」の 95歳。workspace/settings.ts の DEFAULT_DISPLAY_SETTINGS。同じことをテストで確かめる）
// - 年ごとの家族の年齢は、画面のキャッシュフロー表の年齢の行と同じ関数（workspace/present.ts の ageRows）で、同じ呼び方・同じ「世帯にいる年」で出す
// - 65歳からの年金の月額（世帯の合計と人ごと。今の水準）は、画面の比較の表の年金の行（0075）と同じ写しの要求（input/pensionLines.ts の
//   pensionEstimateRequest）を pensionRequests で作り、接続口が計算の前の処理を当てて計算した結果を summarize に渡して、同じ関数
//   （pensionLines・planPensionOf）で数える（0199）
// - 接続口は、計算した表（表示の形の出力）と、計算の前の処理を当てる前の要求（数字の根拠と同じ）を渡す。返すのは JSON の文字
// - 画面の部品（preact）・本体の命令・保存の部品は読まない（lint とまとめる道具が止める）
import type { EngineRequest, PreviewResult } from "../engine/types.ts";
import { anyClaimOf, modeOf, pensionEstimateRequest, pensionLines, pensionMembers, planPensionOf, type PensionLine } from "../workspace/input/pensionLines.ts";
import { metricsOf } from "../workspace/plans/compare.ts";
import { ageRows, displayYears, yearsWithin } from "../workspace/present.ts";
import { ageInYear, roles } from "../workspace/roles.ts";

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

export interface Summary {
  /** 家族（年齢の鍵と呼び方。並びは画面の表の年齢の行と同じ） */
  members: { key: string; label: string }[];
  /** 年ごとの家族の年齢（年 → 鍵 → 年齢。世帯にいない人は入れない） */
  ages: Record<string, Record<string, number>>;
  /** 構成員の ID → 年齢の鍵（接続口が必要保障額・相続税の目安の人に鍵を添えるために使う。AI には返さない） */
  memberKeys: Record<string, string>;
  keyFigures: {
    /** 数えた年（画面の表に出す年。計算基準月が年の途中なら翌年から） */
    years: { from: number; to: number } | null;
    assetsAtAge: { age: number; year: number; amount: number }[];
    depletion: { year: number; selfAge: number | null } | null;
    minimum: { year: number; amount: number; selfAge: number | null };
    lifetimeTakeHome: number;
    lifetimeExpense: number;
    loanRepayment: number;
    /** 年金の見込み（args の pension を渡したときだけ。年金のカードに出す人がいなければ null） */
    pension?: PensionFigures | null;
  };
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
  return {
    members,
    ages,
    memberKeys,
    keyFigures: {
      years: shown,
      assetsAtAge: ms.map((x) => ({ age: x.targetAge, year: x.targetYear, amount: x.target })),
      depletion: m.depletion === null ? null : { year: m.depletion, selfAge: selfAge(m.depletion) },
      minimum: { year: m.min.year, amount: m.min.amount, selfAge: selfAge(m.min.year) },
      lifetimeTakeHome: m.takeHome,
      lifetimeExpense: m.expense,
      loanRepayment: m.loan,
      ...(a.pension !== undefined ? { pension: pensionOf(req, a.pension, memberKeys) } : {}),
    },
  };
}
