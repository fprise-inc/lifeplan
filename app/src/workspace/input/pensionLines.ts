// 年金の見込みの数え方（0067・0075）のうち、画面の状態（preact のフック）に依らない部分。年金のカードの「年金の見込み」・プランの比較の表の
// 年金の行（pensionEstimate.ts）と、AI接続口の主な数字（connector/summary.ts）が同じ関数で数える:
// - 写しの要求（今の水準・65歳から、か、受け取り開始を変えたまま）を作る（pensionEstimateRequest）
// - 写しの結果から、人ごとの老齢年金の年額（受け取り開始の年の次の年）を読む（pensionLines）と、世帯の合計の月額（monthlyOf）
// - 年金のカードに出す人（pensionMembers）・受け取り開始の月（claimMonth）・記録の入れ方の区分（modeOf）。入力の欄の定義（stages/pension.ts）から
//   移した（AI接続口に同梱する JS に入力の欄の定義まで入らないように。stages/pension.ts は同じ名前で出し直す）
import type { EngineRequest, Household, Member, PensionRecord, PreviewResult } from "../../engine/types.ts";
import { addMonths, ageAt, ageReachedMonth } from "../levers.ts";
import { resolveTimepoint } from "../timepoint.ts";
import { earners } from "./labels.ts";

// ---- 入れ方の区分（推計／書類から／加入歴から） ----

export type PensionMode = "" | "document" | "history";

/** 記録の入れ方の区分（記録が無ければ推計） */
export const modeOf = (rec: PensionRecord | undefined): PensionMode => (rec === undefined ? "" : rec.kind === "history" ? "history" : "document");

/** 受け取り開始の月 ↔ 年齢（その年齢に達した月の翌月から。0003・年金の決まり） */
export const claimMonth = (m: Member, age: number): string => addMonths(ageReachedMonth(m, age), 1);

/** 年金のカードに出す人（本人・配偶者。世帯の外の家族の年金は介護・親の項目） */
export const pensionMembers = (h: Household): Member[] => earners(h).filter((m) => (m.kind === "self" || m.kind === "spouse") && m.expected !== true && m.outside === undefined);

/** 年金の見込みの写しの要求（keepClaims が false なら受け取り開始を外して65歳からにする） */
export function pensionEstimateRequest(req: EngineRequest, keepClaims: boolean): EngineRequest {
  // 計算の要求は JSON の値なので、JSON で写す（AI接続口の固めた実行環境には structuredClone が無い）
  const out = JSON.parse(JSON.stringify(req)) as EngineRequest;
  delete out.input.contingencies;
  delete out.input.protection;
  delete out.input.inheritanceTax;
  const a = out.input.assumptions as Record<string, unknown> | undefined;
  if (a !== undefined) for (const k of ["wageGrowth", "inflation", "pensionMacroSlide", "pensionMacroSlideEmployee"]) delete a[k];
  if (!keepClaims) for (const r of out.input.household.pensionRecords ?? []) delete r.claim;
  out.trace = "none";
  return out;
}

/** 見込みの1行（人ごと） */
export interface PensionLine {
  member: string;
  /** 例: 「65歳から」「基礎70歳・厚生65歳から」「今」 */
  from: string;
  /** 年額（円）。結果に無ければ null */
  annual: number | null;
  /** もう受け取っている（受け取り開始が計算の基準の月より前） */
  receiving: boolean;
}

const year = (ym: string) => Number(ym.slice(0, 4));

/** 結果から、人ごとの老齢年金の年額（受け取り開始の年の次の年）。wh は要求だけを読む（プランの比較の表はプランの要求を渡す） */
export function pensionLines(wh: { request: EngineRequest }, r: PreviewResult | null, keepClaims: boolean): PensionLine[] {
  const req = wh.request.input;
  const h = req.household;
  const base = req.baseMonth;
  const out: PensionLine[] = [];
  for (const m of pensionMembers(h)) {
    const rec = (h.pensionRecords ?? []).find((x) => x.member === m.id);
    const std = claimMonth(m, 65);
    const claimOf = (part: "basic" | "employee") => (keepClaims ? (resolveTimepoint(h, rec?.claim?.[part] ?? null) ?? std) : std);
    const b = claimOf("basic");
    const e = claimOf("employee");
    const last = b > e ? b : e;
    const receiving = last <= base;
    const y = Math.max(year(last), year(base)) + 1;
    // 受け取り開始の月（その年齢に達した月の翌月）→「65歳」「66歳3か月」
    const age = (ym: string) => {
      const reach = addMonths(ym, -1);
      const yrs = ageAt(m, reach);
      const [ry, rm] = ageReachedMonth(m, yrs).split("-").map(Number) as [number, number];
      const mo = (year(reach) - ry) * 12 + (Number(reach.slice(5, 7)) - rm);
      return mo === 0 ? `${String(yrs)}歳` : `${String(yrs)}歳${String(mo)}か月`;
    };
    const from = receiving ? "今" : b === e ? `${age(b)}から` : `基礎${age(b)}・厚生${age(e)}から`;
    let annual: number | null = null;
    if (r !== null && y <= (req.endYear ?? 9999)) {
      annual = 0;
      for (const c of r.table) if (c.row === "cf.income.pension" && c.member === m.id && c.object === undefined && c.year === y) annual += c.amount;
    }
    out.push({ member: m.id, from, annual, receiving });
  }
  return out;
}

/** プランの比較の表の年金の行の1列（そのプランの要求の写しから。月額は世帯の合計・今の水準） */
export interface PlanPension {
  /** 65歳からの月額（受け取り開始を外した写し）。結果に無ければ null */
  std: number | null;
  /** 受け取り開始からの月額（受け取り開始を変えたままの写し。変えた人がいないプランは std と同じ）。結果に無ければ null */
  claimed: number | null;
  /** 全員もう受け取っている */
  receiving: boolean;
  /** 受け取り開始を変えた人がいる */
  anyClaim: boolean;
}

/** 写しの結果から、世帯の合計の月額（年額の合計÷12。年額が出ない人は数えない。誰も出なければ null） */
export function monthlyOf(lines: readonly PensionLine[]): number | null {
  const got = lines.filter((l) => l.annual !== null);
  return got.length === 0 ? null : Math.round(got.reduce((s, l) => s + (l.annual ?? 0), 0) / 12);
}

/** 受け取り開始を変えた人がいるか（変えたままの写しも求めるか） */
export const anyClaimOf = (req: EngineRequest): boolean => (req.input.household.pensionRecords ?? []).some((r) => r.claim !== undefined);

/** プランの比較の表の年金の行の1列を、写しの結果から作る（std は65歳からの写しの結果、claimed は受け取り開始を変えたままの写しの結果） */
export function planPensionOf(req: EngineRequest, std: PreviewResult | null, claimed: PreviewResult | null): PlanPension {
  const anyClaim = anyClaimOf(req);
  if (std === null) return { std: null, claimed: null, receiving: false, anyClaim };
  const sl = pensionLines({ request: req }, std, false);
  const cl = !anyClaim ? sl : claimed === null ? null : pensionLines({ request: req }, claimed, true);
  return { std: monthlyOf(sl), claimed: cl === null ? null : monthlyOf(cl), receiving: sl.length > 0 && sl.every((l) => l.receiving), anyClaim };
}
