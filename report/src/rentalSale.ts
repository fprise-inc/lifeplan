// 収益不動産の「売る年を変えた比べ」（0082）。アプリの結果の画面の収益不動産のタブと、提案書の収益不動産のまとめで同じ部品を使う。
// - 物件ごとに、売る年だけを変えた写しの要求を作り（世帯の物は変えない）、計算の結果から、税引後の手取り（エンジンの分析の数字の exit.net）と
//   表の最後の年の金融資産（cf.balance.financial）、その差（今の予定との差）、表の最後の年に持っている物件の評価額−ローン残高を読む。
// - 案: 売る予定があれば「今の予定・その5年前・その5年後・持ち続ける」、無ければ「持ち続ける（今の予定）・5年後に売る・10年後に売る」。
//   計算基準月より前・持ち始める前・表の最後の年より後になる案は作らない。
// - 5年前・5年後・新しく売る案は、その年の評価額で売るとする（今の予定に売却価格を入れていても、その額は使わない）。売却の費用の割合と
//   「売ったときにローンを返す」は今の予定のまま
// - 計算は1案ずつ全部を計算し直す（物件の分だけの近似にしない）。重さは物件の数×2〜3回の計算で、画面ではタブを開いている物件の分だけ求める
import type { EngineRequest } from "./bundle.ts";

type Account = EngineRequest["input"]["household"]["accounts"][number];

export type SaleVariantKey = "planned" | "earlier" | "later" | "hold" | "in5" | "in10";

export interface SaleVariant {
  key: SaleVariantKey;
  /** 例: 「2040年6月に売る（今の予定）」「持ち続ける」 */
  label: string;
  /** 売る年月（持ち続けるなら null） */
  ym: string | null;
  /** 今の予定（写しを作らず、そのプランの結果を使う） */
  current: boolean;
}

/** 結果の画面・提案書で読む計算の結果の形（preview でも同じ欄がある） */
export interface SaleResult {
  table: readonly { row: string; year: number; amount: number }[];
  summary: { realEstateAnalysis?: { properties: readonly { object: string; years: readonly { year: number; equity: number | null }[]; exit: { net: number } | null }[] } };
}

export interface SaleCompareRow {
  key: SaleVariantKey;
  label: string;
  ym: string | null;
  current: boolean;
  /** 税引後の手取り（売却価格−費用−売ったときの一括の返済−譲渡所得の税。持ち続けるなら null） */
  net: number | null;
  /** 表の最後の年の金融資産 */
  financialEnd: number;
  /** 今の予定との差（表の最後の年の金融資産） */
  diff: number;
  /** 表の最後の年に持っている物件の評価額−ローン残高（売っていれば null） */
  equityEnd: number | null;
}

export interface SaleCompare {
  object: string;
  /** 表の最後の年 */
  endYear: number;
  rows: SaleCompareRow[];
}

const ymOf = (y: number, m: number) => `${y}-${String(m).padStart(2, "0")}`;
const jaYm = (ym: string) => `${Number(ym.slice(0, 4))}年${Number(ym.slice(5, 7))}月`;

function resolveAt(tp: unknown): string | null {
  if (typeof tp === "object" && tp !== null && typeof (tp as { at?: unknown }).at === "string") return (tp as { at: string }).at;
  return null;
}

/** 物件（中身を入れた不動産の器で、家賃の入力があるもの）の売る年の案。今の予定の売却が時点の年月でなければ（年齢・できごとなど）、今の予定と持ち続けるだけ */
export function saleVariants(req: EngineRequest, object: string): SaleVariant[] {
  const a = (req.input.household.accounts ?? []).find((x) => x.id === object);
  const p = a?.property;
  if (a === undefined || p === undefined) return [];
  const base = req.input.baseMonth;
  const endYear = req.input.endYear;
  const holdFrom = resolveAt(p.holdFrom);
  const ok = (ym: string) => ym > base && ym <= ymOf(endYear, 12) && (holdFrom === null || ym > holdFrom);
  const planned = p.sale === undefined ? null : resolveAt(p.sale.at);
  if (p.sale !== undefined) {
    const out: SaleVariant[] = [];
    if (planned === null) return [{ key: "planned", label: "今の予定で売る", ym: null, current: true }, { key: "hold", label: "持ち続ける", ym: null, current: false }];
    const y = Number(planned.slice(0, 4));
    const m = Number(planned.slice(5, 7));
    const earlier = ymOf(y - 5, m);
    const later = ymOf(y + 5, m);
    if (ok(earlier)) out.push({ key: "earlier", label: `${jaYm(earlier)}に売る（5年前）`, ym: earlier, current: false });
    out.push({ key: "planned", label: `${jaYm(planned)}に売る（今の予定）`, ym: planned, current: true });
    if (ok(later)) out.push({ key: "later", label: `${jaYm(later)}に売る（5年後）`, ym: later, current: false });
    out.push({ key: "hold", label: "持ち続ける", ym: null, current: false });
    return out;
  }
  const by = Number(base.slice(0, 4));
  const bm = Number(base.slice(5, 7));
  const out: SaleVariant[] = [{ key: "hold", label: "持ち続ける（今の予定）", ym: null, current: true }];
  for (const [key, n] of [["in5", 5], ["in10", 10]] as const) {
    const ym = ymOf(by + n, bm);
    if (ok(ym)) out.push({ key, label: `${jaYm(ym)}に売る（${n}年後）`, ym, current: false });
  }
  return out;
}

/** 売る年だけを変えた写しの要求（今の予定の案は、そのままの要求） */
export function saleVariantRequest(req: EngineRequest, object: string, v: SaleVariant): EngineRequest {
  if (v.current) return req;
  const out = JSON.parse(JSON.stringify(req)) as EngineRequest;
  const a = (out.input.household.accounts ?? []).find((x) => x.id === object) as Account | undefined;
  const p = a?.property as (Account["property"] & { sale?: Record<string, unknown> }) | undefined;
  if (a === undefined || p === undefined) return out;
  const w = p as unknown as { sale?: Record<string, unknown> };
  if (v.ym === null) delete w.sale;
  else {
    const prev = w.sale ?? {};
    const next: Record<string, unknown> = { at: { at: v.ym } };
    if (prev.costRate !== undefined) next.costRate = prev.costRate;
    if (prev.repayLoan !== undefined) next.repayLoan = prev.repayLoan;
    w.sale = next;
  }
  return out;
}

/** 案ごとの計算の結果から比べの行を作る（results は variants と同じ並び。求められなかった案は null で、行に入れない） */
export function saleCompareOf(object: string, endYear: number, variants: readonly SaleVariant[], results: readonly (SaleResult | null)[]): SaleCompare | null {
  const fin = (r: SaleResult) => r.table.filter((c) => c.year === endYear && c.row === "cf.balance.financial").reduce((s, c) => s + c.amount, 0);
  const cur = variants.findIndex((v) => v.current);
  const base = cur < 0 ? null : (results[cur] ?? null);
  if (base === null) return null;
  const baseFin = fin(base);
  const rows: SaleCompareRow[] = [];
  variants.forEach((v, i) => {
    const r = results[i];
    if (r === null || r === undefined) return;
    const p = r.summary.realEstateAnalysis?.properties.find((x) => x.object === object);
    const last = p?.years.at(-1);
    const f = fin(r);
    rows.push({
      key: v.key,
      label: v.label,
      ym: v.ym,
      current: v.current,
      net: p?.exit?.net ?? null,
      financialEnd: f,
      diff: f - baseFin,
      equityEnd: last !== undefined && last.year === endYear ? last.equity : null,
    });
  });
  return { object, endYear, rows };
}
