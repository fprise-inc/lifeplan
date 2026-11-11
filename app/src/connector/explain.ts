// AI接続口（crates/lifeplan）に同梱する「数字の根拠」の読み方（0183）。画面の根拠のパネル（workspace/evidence.ts）と同じ関数で、
// 計算エンジンの根拠の記録「全部」（trace: full）の出力から、1つのマス（表の行×年）の根拠を取り出す。
// - 接続口は、このファイルを入口にまとめた1つの JS（scripts/build-explain.ts）を、計算と同じ固めた実行環境（quickjs-ng）で動かす。
//   画面と接続口で根拠の文がずれないように、根拠の組み立ては画面の関数をそのまま使い、ここでは行の選び方と返す形だけを決める
// - 画面の部品（preact）・本体の命令・保存の部品は読まない（lint とまとめる道具が止める）
// - 返すのは根拠の表示の中身（画面と同じ）と、計算式ID・制度の値ID だけ。世帯の物の ID は返さない（行を選ぶときに受け取るだけ）
// - 同じ1つの JS に、計算の前の処理（prepare.ts。画面がエンジンへ渡す前に当てる処理。0184）も入れる。接続口は計算の前に prepare を、
//   根拠を読むときは画面と同じく処理の前の要求で explain を呼ぶ
// - 同じ1つの JS に、計算の答えの主な数字と家族の年齢（summary.ts。画面の「プランを比較」と表の年齢の行と同じ関数。0194）も入れる
// - 同じ1つの JS に、比較した答えのグラフ（chart.ts。画面のグラフと同じ座標・色の SVG。0203）も入れる
import type { EngineRequest, FullResult, TableCell } from "../engine/types.ts";
import { evidenceDetail } from "../workspace/evidence.ts";
import { displayYears, rowDefs, type RowDef } from "../workspace/present.ts";

export { prepare } from "./prepare.ts";
export { pensionRequests, summarize } from "./summary.ts";
export { chart } from "./chart.ts";

export interface ExplainArgs {
  /** 表の行の鍵（画面の行。例 taxSi・pension:self）か、キャッシュフロー表の行ID（cf. で始まる。calculate の table の row） */
  row?: string;
  /** row が cf. の行のとき、その行の member（calculate の table の member） */
  member?: string;
  /** row が cf. の行のとき、その行の object（calculate の table の object） */
  object?: string;
  year?: number;
  depth?: number;
  maxParams?: number;
}

const GROUPS: Record<RowDef["group"], string> = { income: "収入", expense: "支出", net: "収支", assets: "資産・負債" };

function rowInfo(d: RowDef) {
  return { key: d.key, label: d.label, group: GROUPS[d.group] };
}

/** 行の鍵か cf. の行から、画面の行を選ぶ（cf. の行は、その行のマスを含む画面の行） */
function resolve(defs: readonly RowDef[], a: ExplainArgs, year: number): RowDef | undefined {
  const row = a.row ?? "";
  if (!row.startsWith("cf.")) return defs.find((d) => d.key === row);
  const cell: TableCell = { row, year, amount: 0, ...(a.member !== undefined ? { member: a.member } : {}), ...(a.object !== undefined ? { object: a.object } : {}) };
  return defs.find((d) => d.kind === "value" && d.evidence && d.match(cell)) ?? defs.find((d) => d.evidence && d.match(cell));
}

/** 1つのマスの根拠。戻り値は JSON の文字（status: ok・chooseRow・chooseYear・totalRow・noValue） */
export function explain(fullJson: string, reqJson: string, argsJson: string): string {
  const full = JSON.parse(fullJson) as FullResult;
  const req = JSON.parse(reqJson) as EngineRequest;
  const a = JSON.parse(argsJson) as ExplainArgs;
  const defs = rowDefs(req);
  const rows = defs.filter((d) => d.evidence).map(rowInfo);
  const years = displayYears(req);
  const range = years.length > 0 ? { from: years[0], to: years[years.length - 1] } : null;
  if (a.row === undefined || a.row === "") return JSON.stringify({ status: "chooseRow", rows, years: range });
  const year = a.year;
  if (year === undefined || !Number.isInteger(year) || !years.includes(year)) return JSON.stringify({ status: "chooseYear", years: range });
  const def = resolve(defs, a, year);
  if (def === undefined) return JSON.stringify({ status: "chooseRow", unknownRow: a.row, rows, years: range });
  if (!def.evidence) return JSON.stringify({ status: "totalRow", row: rowInfo(def), rows });
  const d = evidenceDetail(full, req, def.key, year, undefined, { ...(a.depth !== undefined ? { depth: a.depth } : {}), ...(a.maxParams !== undefined ? { maxParams: a.maxParams } : {}) });
  if (d === null) return JSON.stringify({ status: "noValue", row: rowInfo(def), year });
  return JSON.stringify({ status: "ok", row: rowInfo(def), year, evidence: d.view, ids: { formulas: d.formulaIds, regulation: d.paramIds } });
}
