// 基本生活費のカードの「実際の年間の貯蓄額」（答え合わせ。savingsChecks）の欄の下に出す1行（作業の層。0106 の追記。計算の結果を読むだけ）:
// 「計算では年 120万円、実際は年 95万円、差 ▲25万円」。
// - 計算の年間収支は、計算エンジン expense.reconcile が比較する額（年間収支を作る部品 plan.flows の、その年の年間収支。器の間の移動は貯蓄に含む）。
//   答え合わせを外した写しの要求で計算し、その年の年間収支（cf.net）に、年間収支から引いた後の行（ゆとりの支出・取り崩しの計画）を足し戻して求める
//   （どちらも plan.flows の年間収支の後で引く物。答え合わせの差はこの写しには入らない）
// - 比較する年は、確かめる年が計算基準年で、計算基準月が1月でなければ翌年（12か月そろう年。エンジンと同じ決まり）
// - 差は 実際 − 計算（足りなければ ▲）。実際のほうが少なければ、差を使途不明金として毎年の支出に入れている旨を根拠に書く
// - 写しの要求は答え合わせの欄を変えても同じなので、実際の額を打ち直しても計算し直さない
import { useEffect, useMemo, useState } from "preact/hooks";
import type { EngineRequest, PreviewResult, TableCell } from "../../engine/types.ts";
import { SURPLUS_ROW } from "../present.ts";
import type { FieldSuggestion } from "./FieldViews.tsx";
import type { WorkingHousehold } from "./household.ts";

interface Check {
  id: string;
  year: number;
  actualSavings: { value?: number | null };
  treatment: "addToLiving" | "keepUnexplained";
}

const checkOf = (wh: WorkingHousehold): Check | undefined => (wh.request.input.household as { savingsChecks?: Check[] }).savingsChecks?.[0];

/** 年間収支から引いた後の行（足し戻すと plan.flows の年間収支になる） */
const AFTER_NET_ROWS: ReadonlySet<string> = new Set([SURPLUS_ROW, "cf.expense.living.drawdown"]);

/** 答え合わせを外した写しの要求（計算の年間収支を求める。万一の想定・必要保障額・相続税の目安も外す） */
export function checkFreeRequest(req: EngineRequest): EngineRequest {
  const out = structuredClone(req);
  delete (out.input.household as { savingsChecks?: unknown }).savingsChecks;
  delete out.input.contingencies;
  delete out.input.protection;
  delete out.input.inheritanceTax;
  out.trace = "none";
  return out;
}

/** 比較する年（12か月そろう年）。計算の期間の外なら null */
export function comparedYear(req: EngineRequest, year: number): number | null {
  const [by, bm] = req.input.baseMonth.split("-").map(Number) as [number, number];
  const y = year === by && bm !== 1 ? year + 1 : year;
  return y < by || y > req.input.endYear ? null : y;
}

/** 計算の年間収支（答え合わせを外した写しの結果の表から） */
export function computedNet(table: readonly TableCell[], year: number): number {
  return table.reduce((s, c) => (c.year !== year ? s : c.row === "cf.net" ? s + c.amount : AFTER_NET_ROWS.has(c.row) ? s + c.amount : s), 0);
}

const man = (yen: number) => `${(Math.round(yen / 1000) / 10).toLocaleString("ja-JP")}万円`;
/** 差の書き方（プランの比較の仕方と同じ: +・▲・±0） */
const signedMan = (d: number) => (Math.round(d / 1000) === 0 ? "±0万円" : `${d > 0 ? "+" : "▲"}${man(Math.abs(d))}`);

/** 欄の下の1行と根拠。実際の額が無い・比較する年が無いときは null */
export function savingsCheckLine(wh: WorkingHousehold, table: readonly TableCell[]): FieldSuggestion | null {
  const c = checkOf(wh);
  const actual = c?.actualSavings.value;
  if (c === undefined || actual === undefined || actual === null) return null;
  const year = comparedYear(wh.request, c.year);
  if (year === null) return null;
  const computed = computedNet(table, year);
  const gap = computed - actual;
  const detail = [
    year === c.year ? `比較した年: ${year}年` : `比較した年: ${year}年（今年の途中から計算するので、12か月そろう翌年と比較しています）`,
    "計算の年間収支は、その年の収入から支出を引いた額です（積立・iDeCo など、貯蓄・運用への移動は貯蓄に含みます）",
    gap > 0
      ? `足りない ${man(gap)} を使途不明金として、毎年の支出に入れています（結果の表の「${c.treatment === "addToLiving" ? "基本生活費" : "その他の支出"}」の行）`
      : "実際のほうが計算より多い（か同じ）ので、差は支出に入れていません",
  ];
  return { text: `計算では年 ${man(computed)}、実際は年 ${man(actual)}、差 ${signedMan(actual - computed)}`, action: "", value: null, detail };
}

/** 実際の年間の貯蓄額の欄（入れる前・入れた後の2つ）のキー → 欄の下の1行。答え合わせが無い・計算できないときは空 */
export function useSavingsCheckLine(wh: WorkingHousehold, active: boolean, computeOne: ((req: EngineRequest) => Promise<PreviewResult | null>) | undefined): Record<string, FieldSuggestion> {
  const has = checkOf(wh) !== undefined;
  const job = useMemo(() => {
    if (!active || !has || computeOne === undefined) return null;
    const req = checkFreeRequest(wh.request);
    return { key: JSON.stringify(req), req };
  }, [active, has, computeOne, wh.request]);
  const [res, setRes] = useState<{ key: string; table: PreviewResult["table"] | null } | null>(null);
  useEffect(() => {
    if (job === null || computeOne === undefined || res?.key === job.key) return;
    let alive = true;
    void computeOne(job.req).then(
      (r) => alive && setRes({ key: job.key, table: r?.table ?? null }),
      () => alive && setRes({ key: job.key, table: null }),
    );
    return () => {
      alive = false;
    };
  }, [job?.key, computeOne]);
  return useMemo((): Record<string, FieldSuggestion> => {
    const c = checkOf(wh);
    // 計算し直している間は、前の結果で見せておく（数字が消えてちらつかないように）
    if (job === null || c === undefined || res === null || res.table === null) return {};
    const line = savingsCheckLine(wh, res.table);
    return line === null ? {} : { "savings/new/actual": line, [`savings/${c.id}/actual`]: line };
  }, [job, res, wh]);
}
