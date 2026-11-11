// AI接続口（crates/lifeplan）に同梱する、計算の答えの年ごとの表（CSV・Markdown の文。0209）。比較の道具（compare）と同じ道で計算した
// 通りごとの表（表示の形の計算の出力）から、選んだ行・年・家族の年齢の列の表を作る:
// - 数字は画面と同じ関数で数える: 年は画面の表に出す年（present.ts の displayYears・yearsWithin）、年齢は表の年齢の行（summary.ts の summaryOf）、
//   住宅ローンの返済・残高・利息・金利は比較の道具の系列と同じ関数（summary.ts の loanYearsOf）、支出の内訳と公的年金は画面のキャッシュフロー表の
//   行の決め方（present.ts の rowDefs）。収入・税と社会保険料・支出・年間収支・金融資産・負債・不足は、比較の道具の系列（calc.rs の shape）と
//   同じ行の足し方（同じになることを接続口のテストで確かめる）。万円は画面と同じ丸め（presentation/format.ts の toMan。四捨五入）
// - 表の下に必ず注を入れる: 前提（物価上昇率・運用利回り）・相場などの想定・単位・計算基準月と「将来の結果を約束するものではない」旨。
//   「ファイナンシアで試算」の旨は credit を選んだときだけ（既定は入れない）
// - お客さまの名前・物の ID は入れない（列の名前は行の名前・家族の呼び方〔ご本人・配偶者・第1子…〕・通りの名前だけ）
// - 画面の部品（preact）・本体の命令は読まない（lint とまとめる道具が止める）。結果が OS で変わる Math の関数は使わない
import type { EngineRequest, PreviewResult, TableCell } from "../engine/types.ts";
import { group, toMan } from "../presentation/format.ts";
import { pctText } from "../workspace/plans/decimal.ts";
import { displayYears, rowDefs, yearsWithin, type RowDef } from "../workspace/present.ts";
import { summaryOf } from "./summary.ts";

/** 選べる行（比較の道具の系列と同じ名前。expenseBreakdown は画面の支出の行ごとに開く） */
export const TABLE_ROWS = ["income", "takeHome", "taxSi", "expense", "expenseBreakdown", "net", "financialAssets", "debt", "loanRepayment", "loanBalance", "loanInterest", "loanRate", "pension", "shortfall"] as const;
export type TableRowKey = (typeof TABLE_ROWS)[number];
/** 既定の行（収入・税と社会保険料・支出・年間収支・金融資産残高。年間収支＝収入−税と社会保険料−支出） */
export const DEFAULT_TABLE_ROWS: readonly TableRowKey[] = ["income", "taxSi", "expense", "net", "financialAssets"];

/** 行の名前（画面の表の行と同じ数え方の行は、画面の名前） */
export const ROW_LABELS: Record<Exclude<TableRowKey, "expenseBreakdown">, string> = {
  income: "収入合計",
  takeHome: "手取り",
  taxSi: "税・社会保険料",
  expense: "支出",
  net: "年間収支",
  financialAssets: "金融資産残高",
  debt: "負債残高",
  loanRepayment: "住宅ローンの返済",
  loanBalance: "住宅ローン残高",
  loanInterest: "住宅ローンの利息",
  loanRate: "住宅ローンの金利",
  pension: "公的年金",
  shortfall: "資金の不足",
};

export type TableUnit = "man" | "yen";
export type TableFormat = "csv" | "markdown";
/** 通りが2つ以上のときの並べ方: byRow（行ごとに通りを列に並べる）・byVariant（通りごとに表を分ける） */
export type TableLayout = "byRow" | "byVariant";

/** 通り1つ（接続口が compare と同じ道で計算した物） */
export interface TableVariant {
  label: string;
  /** 計算の前の処理を当てる前の要求（プランの変更・相場の想定を当てた後。主な数字・年齢と同じ） */
  request: EngineRequest;
  /** 表示の形の計算の出力のうち、表と要約（要約は住宅ローンの利息と金利の loans だけ使う） */
  result: { table: TableCell[]; summary?: unknown };
  /** 重ねた相場の想定・ストレステストの文 */
  stress?: string;
}

export interface TableArgs {
  variants: TableVariant[];
  /** 計算基準月（YYYY-MM。試算の時点の文） */
  baseMonth: string;
  rows?: TableRowKey[];
  /** 年齢の列にする家族（年齢の鍵 self・spouse・child1…）。省くと全員、空の並びなら年齢の列なし */
  members?: string[];
  fromYear?: number;
  toYear?: number;
  /** 何年おき（最初の年と最後の年はいつも入る。既定1） */
  everyYears?: number;
  unit?: TableUnit;
  format?: TableFormat;
  layout?: TableLayout;
  /** CSV の頭に BOM（U+FEFF）を付ける（日本語の Windows の Excel で開くとき） */
  bom?: boolean;
  /** 注に「ファイナンシアで試算」の旨を入れる（既定 false） */
  credit?: boolean;
}

export interface TableOut {
  status: "ok" | "invalid";
  text?: string;
  reason?: string;
  layout?: TableLayout | "single";
  /** 列にした行の名前（支出の内訳は開いた後の行） */
  rows?: string[];
  years?: number[];
  /** 表の下の注（text にも入っている） */
  notes?: string[];
}

/** 列（数字の行1つ） */
interface Column {
  key: string;
  label: string;
  kind: "money" | "rate";
}

type Cell = number | string | null;

/** 通りごとの数字 */
interface VariantData {
  label: string;
  /** 画面の表に出す年（from・to で絞った後） */
  shown: number[];
  values: Map<number, Record<string, Cell>>;
  ages: Record<string, Record<string, number>>;
  members: { key: string; label: string }[];
  /** 値のある支出の内訳の行（画面の表と同じく、表に出す年のどこにも値の無い行は出さない） */
  breakdown: { key: string; label: string }[];
}

const under = (row: string, prefix: string) => row === prefix || row.startsWith(prefix + ".");

/** 支出の内訳の行: 画面の表の支出のまとまりの行のうち、税・社会保険料（別の行）の外の物 */
const expenseRows = (defs: readonly RowDef[]) => defs.filter((d) => d.group === "expense" && d.kind === "value" && d.key !== "taxSi");

/** 何年おき（最初の年と最後の年はいつも入る。接続口の calculate・compare と同じ選び方） */
export function everyYears(years: readonly number[], n: number): number[] {
  const first = years[0];
  const last = years[years.length - 1];
  if (first === undefined || n <= 1) return [...years];
  return years.filter((y) => (y - first) % n === 0 || y === last);
}

/** 1通りの年ごとの数字（選んだ行。画面の表に出す年） */
export function dataOf(v: TableVariant, a: Pick<TableArgs, "fromYear" | "toYear">): VariantData {
  const req = v.request;
  const table = v.result.table;
  const shown = yearsWithin(table, displayYears(req)).filter((y) => (a.fromYear === undefined || y >= a.fromYear) && (a.toYear === undefined || y <= a.toYear));
  const ys = new Set(shown);
  const s = summaryOf(req, v.result as PreviewResult);
  const defs = rowDefs(req);
  const pension = defs.filter((d) => d.key.startsWith("pension:"));
  const exp = expenseRows(defs);
  const values = new Map<number, Record<string, Cell>>();
  const zero = (): Record<string, Cell> => ({
    income: 0,
    taxSi: 0,
    expense: 0,
    net: 0,
    financialAssets: 0,
    debt: 0,
    shortfall: 0,
    pension: 0,
    ...Object.fromEntries(exp.map((d) => [`expense.${d.key}`, 0])),
  });
  const add = (r: Record<string, Cell>, k: string, n: number) => {
    r[k] = ((r[k] as number | undefined) ?? 0) + n;
  };
  for (const y of shown) values.set(y, zero());
  for (const c of table) {
    const r = values.get(c.year);
    if (r === undefined || !ys.has(c.year)) continue;
    // 比較の道具の系列（calc.rs の shape）と同じ行の足し方
    if (under(c.row, "cf.income")) add(r, "income", c.amount);
    else if (under(c.row, "cf.taxSi")) add(r, "taxSi", c.amount);
    else if (under(c.row, "cf.expense")) add(r, "expense", c.amount);
    else if (c.row === "cf.net") add(r, "net", c.amount);
    else if (c.row === "cf.balance.financial") add(r, "financialAssets", c.amount);
    else if (under(c.row, "cf.balance.debt")) add(r, "debt", c.amount);
    else if (c.row === "cf.balance.shortfall") add(r, "shortfall", c.amount);
    // 画面の表の行の決め方（公的年金は人ごとの年金の行の合計、支出の内訳は支出の行ごと）
    if (pension.some((d) => d.match(c))) add(r, "pension", c.amount);
    for (const d of exp) if (d.match(c)) add(r, `expense.${d.key}`, c.amount);
  }
  for (const [y, r] of values) {
    r.takeHome = (r.income as number) - (r.taxSi as number);
    const l = s.loanYears[String(y)];
    r.loanRepayment = l?.loanRepayment ?? 0;
    r.loanBalance = l?.loanBalance ?? 0;
    r.loanInterest = l?.loanInterest ?? 0;
    r.loanRate = l?.loanRate ?? null;
  }
  const breakdown = exp.filter((d) => shown.some((y) => (values.get(y)?.[`expense.${d.key}`] ?? 0) !== 0)).map((d) => ({ key: `expense.${d.key}`, label: d.label }));
  return {
    label: v.label,
    shown,
    values,
    ages: s.ages,
    members: s.members,
    breakdown,
  };
}

/** 選んだ行を列にする（支出の内訳は、どれかの通りに値のある画面の支出の行ごと。並びは画面の表と同じ） */
function columnsOf(rows: readonly TableRowKey[], data: readonly VariantData[]): Column[] {
  const out: Column[] = [];
  for (const k of rows) {
    if (k === "expenseBreakdown") {
      const seen = new Set<string>();
      for (const d of data)
        for (const b of d.breakdown) {
          if (seen.has(b.key)) continue;
          seen.add(b.key);
          out.push({
            key: b.key,
            label: `支出の内訳: ${b.label}`,
            kind: "money",
          });
        }
      continue;
    }
    out.push({
      key: k,
      label: ROW_LABELS[k],
      kind: k === "loanRate" ? "rate" : "money",
    });
  }
  return out;
}

/** 年齢の列にする家族（選んだ鍵のうち、どれかの通りにいる人。並びは画面の表の年齢の行と同じ） */
function membersOf(want: readonly string[] | undefined, data: readonly VariantData[]): { key: string; label: string }[] {
  const out: { key: string; label: string }[] = [];
  for (const d of data)
    for (const m of d.members) {
      if (out.some((x) => x.key === m.key)) continue;
      if (want !== undefined && !want.includes(m.key)) continue;
      out.push(m);
    }
  return out;
}

const unitText = (u: TableUnit) => (u === "man" ? "万円" : "円");

/** 1つのマスの文字（CSV は数のまま〔負の数は -〕、Markdown は画面と同じく3桁ごとの区切りと ▲） */
function cellText(v: Cell | undefined, kind: Column["kind"], unit: TableUnit, format: TableFormat): string {
  if (v === undefined || v === null) return "";
  if (kind === "rate") return typeof v === "string" ? pctText(v, 4).replace(/%$/, "") : "";
  const n = typeof v === "number" ? (unit === "man" ? toMan(v) : v) : 0;
  if (format === "csv") return String(n);
  return (n < 0 ? "▲" : "") + group(n);
}

/** CSV の1つの欄（, " 改行 を含むときだけ囲む） */
const csvField = (s: string) => (/[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
/** Markdown の表の1つの欄 */
const mdField = (s: string) => s.replace(/\|/g, "\\|").replace(/[\r\n]+/g, " ");

function lines(format: TableFormat, header: string[], body: string[][]): string[] {
  if (format === "csv") return [header, ...body].map((r) => r.map(csvField).join(","));
  const row = (r: string[]) => `| ${r.map(mdField).join(" | ")} |`;
  return [row(header), `|${header.map((_, i) => (i === 0 ? " --- " : " ---: ")).join("|")}|`, ...body.map(row)];
}

/** 率の文（例: 年1%。年により変わるときは添える。グラフの注と同じ書き方） */
function rateNote(s: { default: string; byYear?: Record<string, string> } | undefined): string | null {
  if (s === undefined) return null;
  return `年${pctText(s.default)}${s.byYear !== undefined && Object.keys(s.byYear).length > 0 ? "（年により変わる）" : ""}`;
}

/** 表の下の注（前提・相場などの想定・単位・試算の時点と旨。必ず入る） */
export function tableNotes(a: TableArgs, cols: readonly Column[]): string[] {
  const notes: string[] = [];
  const many = a.variants.length > 1;
  const pre = (v: TableVariant) => {
    const asm = v.request.input.assumptions as
      | {
          inflation?: { default: string; byYear?: Record<string, string> };
          investmentReturn?: {
            default: string;
            byYear?: Record<string, string>;
          };
        }
      | undefined;
    const inf = rateNote(asm?.inflation);
    const ret = rateNote(asm?.investmentReturn);
    return [inf !== null ? `物価上昇率 ${inf}` : null, ret !== null ? `運用利回り ${ret}（資産ごとの指定が無いもの）` : null].filter((x) => x !== null).join("・");
  };
  const pres = a.variants.map(pre);
  if (pres.every((p) => p === pres[0])) notes.push(`前提\u3000${pres[0] || "—"}`);
  else notes.push(`前提\u3000${pres.map((p, i) => `${a.variants[i]?.label ?? ""}: ${p || "—"}`).join("／")}`);
  const none = "なし（運用利回りは前提のまま）";
  const stress = a.variants.map((v) => (v.stress !== undefined && v.stress !== "" ? v.stress : null));
  if (stress.every((s) => s === null)) notes.push(`相場などの想定\u3000${none}`);
  else if (!many) notes.push(`相場などの想定\u3000${stress[0] ?? none}`);
  else notes.push(`相場などの想定\u3000${a.variants.map((v, i) => `${v.label}: ${stress[i] ?? "なし"}`).join("／")}`);
  const unit = a.unit ?? "man";
  notes.push(`単位は${unitText(unit)}（年額・年末の残高${unit === "man" ? "。万円未満は四捨五入" : ""}）。年齢はその年に迎える年齢。`);
  // 行の意味（その行を選んだときだけ）
  const has = (k: string) => cols.some((c) => c.key === k);
  const terms = [
    has("takeHome") ? "手取り＝収入合計−税・社会保険料" : null,
    has("expense") ? `支出は税・社会保険料を除く${has("net") ? "（年間収支＝収入合計−税・社会保険料−支出）" : ""}` : null,
    cols.some((c) => c.key.startsWith("expense.")) ? "支出の内訳は画面のキャッシュフロー表の支出の行と同じ分け方" : null,
    has("debt") ? "負債残高は住宅ローン以外も含む負債の合計" : null,
    has("pension") ? "公的年金は世帯の合計（企業年金・個人年金は含まない）" : null,
    has("shortfall") ? "資金の不足は、預金と取り崩せる資産で払えなかった額" : null,
  ].filter((x) => x !== null);
  if (terms.length > 0) notes.push(`${terms.join("。")}。`);
  if (cols.some((c) => c.kind === "rate")) notes.push("住宅ローンの金利は%（その年の最後の返済に当てた金利。金利の違う住宅ローンを2本以上返している年と返済の無い年は空欄）。");
  const [y, m] = a.baseMonth.split("-");
  const when = `${Number(y)}年${Number(m)}月時点の入力による試算で、将来の結果を約束するものではありません`;
  notes.push(a.credit === true ? `ファイナンシアで試算（${when}）` : `${when}。`);
  return notes;
}

/** 年ごとの表（argsJson は TableArgs。戻り値は JSON の文字 TableOut） */
export function table(argsJson: string, _a: string, _b: string): string {
  void _a;
  void _b;
  const a = JSON.parse(argsJson) as TableArgs;
  const out = (o: TableOut) => JSON.stringify(o);
  if (a.variants.length === 0) return out({ status: "invalid", reason: "通りがありません。" });
  const rows = a.rows !== undefined && a.rows.length > 0 ? a.rows : DEFAULT_TABLE_ROWS;
  const bad = rows.filter((r) => !TABLE_ROWS.includes(r));
  if (bad.length > 0)
    return out({
      status: "invalid",
      reason: `rows に選べるのは ${TABLE_ROWS.join("・")} です（${bad.join("・")}）。`,
    });
  const unit: TableUnit = a.unit === "yen" ? "yen" : "man";
  const format: TableFormat = a.format === "markdown" ? "markdown" : "csv";
  const every = a.everyYears ?? 1;
  const data = a.variants.map((v) => dataOf(v, a));
  const cols = columnsOf(rows, data);
  const many = data.length > 1;
  const layout: TableLayout | "single" = !many ? "single" : a.layout === "byVariant" ? "byVariant" : "byRow";
  const notes = tableNotes({ ...a, unit }, cols);
  const u = unitText(unit);
  const head = (c: Column, suffix = "") => `${c.label}${suffix}（${c.kind === "rate" ? "%" : u}）`;
  const ageHead = (m: { label: string }) => `${m.label}（歳）`;
  const ageCells = (d: VariantData, y: number, ms: readonly { key: string }[]) => ms.map((m) => (d.ages[String(y)]?.[m.key] === undefined ? "" : String(d.ages[String(y)]?.[m.key])));
  const val = (d: VariantData, y: number, c: Column) => cellText(d.values.get(y)?.[c.key], c.kind, unit, format);
  const text: string[] = [];
  let years: number[];
  if (layout === "byVariant") {
    const ms = membersOf(a.members, data);
    const all = new Set<number>();
    if (format === "csv") {
      const body: string[][] = [];
      for (const d of data)
        for (const y of everyYears(d.shown, every)) {
          all.add(y);
          body.push([d.label, String(y), ...ageCells(d, y, ms), ...cols.map((c) => val(d, y, c))]);
        }
      text.push(...lines(format, ["通り", "年", ...ms.map(ageHead), ...cols.map((c) => head(c))], body));
    } else {
      for (const [i, d] of data.entries()) {
        const ys = everyYears(d.shown, every);
        ys.forEach((y) => all.add(y));
        if (i > 0) text.push("");
        text.push(`**${mdField(d.label)}**`, "");
        text.push(
          ...lines(
            format,
            ["年", ...ms.map(ageHead), ...cols.map((c) => head(c))],
            ys.map((y) => [String(y), ...ageCells(d, y, ms), ...cols.map((c) => val(d, y, c))]),
          ),
        );
      }
    }
    years = [...all].sort((x, y) => x - y);
  } else {
    // 1通り、または行ごとに通りを列に並べる（年は、どれかの通りの表に出す年。年齢は基本〔1つ目〕の世帯）
    const base = data[0] as VariantData;
    const ms = membersOf(a.members, [base]);
    years = everyYears(
      [...new Set(data.flatMap((d) => d.shown))].sort((x, y) => x - y),
      every,
    );
    if (layout === "single") {
      text.push(
        ...lines(
          format,
          ["年", ...ms.map(ageHead), ...cols.map((c) => head(c))],
          years.map((y) => [String(y), ...ageCells(base, y, ms), ...cols.map((c) => val(base, y, c))]),
        ),
      );
    } else if (format === "csv") {
      const header = ["年", ...ms.map(ageHead), ...cols.flatMap((c) => data.map((d) => head(c, `・${d.label}`)))];
      text.push(
        ...lines(
          format,
          header,
          years.map((y) => [String(y), ...ageCells(base, y, ms), ...cols.flatMap((c) => data.map((d) => val(d, y, c)))]),
        ),
      );
    } else {
      for (const [i, c] of cols.entries()) {
        if (i > 0) text.push("");
        text.push(`**${mdField(head(c))}**`, "");
        text.push(
          ...lines(
            format,
            ["年", ...ms.map(ageHead), ...data.map((d) => d.label)],
            years.map((y) => [String(y), ...ageCells(base, y, ms), ...data.map((d) => val(d, y, c))]),
          ),
        );
      }
    }
  }
  text.push("");
  if (format === "csv") text.push(...notes.map((n) => csvField(`※ ${n}`)));
  else text.push(...notes.map((n) => `※ ${n}  `));
  const body = `${text.join("\n")}\n`;
  return out({
    status: "ok",
    text: format === "csv" && a.bom === true ? `\uFEFF${body}` : body,
    layout,
    rows: cols.map((c) => c.label),
    years,
    notes,
  });
}
