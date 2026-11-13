// AI接続口（crates/lifeplan）に同梱する、計算の答えの年ごとの表（CSV・Markdown の文。0209）。比較の道具（compare）と同じ道で計算した
// 通りごとの表（表示の形の計算の出力）から、選んだ行・年・家族の年齢の列の表を作る:
// - 数字は画面と同じ関数で数える: 年は画面の表に出す年（present.ts の displayYears・yearsWithin）、年齢は表の年齢の行（summary.ts の summaryOf）、
//   住宅ローンの返済・残高・利息・金利と、公的年金・支出の内訳は比較の道具の系列と同じ関数（summary.ts の loanYearsOf・flowYearsOf）。
//   収入・税と社会保険料・支出・年間収支・金融資産・負債・不足は、比較の道具の系列（calc.rs の shape）と同じ行の足し方（同じになることを
//   接続口のテストで確かめる）。行の名前は比較の道具の系列の名前と同じ（chart.ts の SERIES_KEYS。0207）。万円は画面と同じ丸め（presentation/format.ts の toMan。四捨五入）
// - 表の下に必ず注を入れる: 通りの違い（当てたプランの変更。グラフの注と同じ。0211）・前提（物価上昇率・運用利回り）・相場などの想定・単位・
//   計算基準月と「将来の結果を約束するものではない」旨。「ファイナンシアで試算」の旨は credit を選んだときだけ（既定は入れない）
// - 年は年（fromYear・toYear）か本人の年齢（fromAge・toAge。画面の表の年齢の行と同じ年齢）で選ぶ。向きは年を行に（既定）か、年を列に（0211）
// - お客さまの名前・物の ID は入れない（列の名前は行の名前・家族の呼び方〔ご本人・配偶者・第1子…〕・通りの名前だけ）
// - 画面の部品（preact）・本体の命令は読まない（lint とまとめる道具が止める）。結果が OS で変わる Math の関数は使わない
import type { EngineRequest, PreviewResult, TableCell } from "../engine/types.ts";
import { group, toMan } from "../presentation/format.ts";
import { pctText } from "../workspace/plans/decimal.ts";
import { displayYears, yearsWithin } from "../workspace/present.ts";
import { EXPENSE_KEYS, INCOME_KEYS, SERIES, SERIES_KEYS, type SeriesKey } from "./chart.ts";
import { FLOW_FIELDS, summaryOf } from "./summary.ts";

/**
 * 選べる行（比較の道具の系列と同じ名前。expenseBreakdown は支出の内訳〔expense で始まる10個〕、incomeBreakdown は収入の内訳〔income で始まる8個。0211〕の
 * うち、どれかの通りに値のある物に開く）
 */
export const TABLE_ROWS = [...SERIES_KEYS, "expenseBreakdown", "incomeBreakdown"] as const;
export type TableRowKey = SeriesKey | "expenseBreakdown" | "incomeBreakdown";
/** まとめて選ぶ名前 → 開く内訳 */
const BREAKDOWNS: Record<"expenseBreakdown" | "incomeBreakdown", readonly SeriesKey[]> = { expenseBreakdown: EXPENSE_KEYS, incomeBreakdown: INCOME_KEYS };
/** 既定の行（収入・税と社会保険料・支出・年間収支・金融資産残高。年間収支＝収入−税と社会保険料−支出） */
export const DEFAULT_TABLE_ROWS: readonly TableRowKey[] = ["income", "taxSi", "expense", "net", "financialAssets"];

/** 行の名前（画面の表の行と同じ数え方の行は、画面の名前） */
export const ROW_LABELS: Partial<Record<SeriesKey, string>> = {
  income: "収入合計",
  takeHome: "手取り",
  taxSi: "税・社会保険料",
  expense: "支出",
  net: "年間収支",
  financialAssets: "金融資産残高",
  debt: "負債の残高",
  loanRepayment: "住宅ローンの返済",
  loanBalance: "住宅ローン残高",
  loanInterest: "住宅ローンの利息",
  loanRate: "住宅ローンの金利",
  pension: "公的年金",
  shortfall: "資金不足",
  nisaContribution: "NISAへの積立",
  nisaBalance: "NISAの残高",
};

export type TableUnit = "man" | "yen";
export type TableFormat = "csv" | "markdown";
/** 通りが2つ以上のときの並べ方: byRow（行ごとに通りを列に並べる）・byVariant（通りごとに表を分ける） */
export type TableLayout = "byRow" | "byVariant";
/** 表の向き: yearsDown（年を行に。既定）・yearsAcross（年を列に。画面のキャッシュフロー表と同じ向き。0211） */
export type TableOrientation = "yearsDown" | "yearsAcross";

/** 通り1つ（接続口が compare と同じ道で計算した物） */
export interface TableVariant {
  label: string;
  /** 計算の前の処理を当てる前の要求（プランの変更・相場の想定を当てた後。主な数字・年齢と同じ） */
  request: EngineRequest;
  /** 表示の形の計算の出力のうち、表と要約（要約は住宅ローンの利息と金利の loans だけ使う） */
  result: { table: TableCell[]; summary?: unknown };
  /** 当てたプランの変更（compare の planChanges のうち当てた物。項目の名前と後の値の文。注の「通りの違い」。グラフと同じ。0211） */
  planChanges?: { label: string; to: string }[];
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
  /** 本人がこの年齢になる年から・までの年（その年に迎える年齢。年の fromYear・toYear とは一緒に使わない。通りごとにその世帯の本人の年齢で選ぶ。0211） */
  fromAge?: number;
  toAge?: number;
  /** 何年おき（最初の年と最後の年はいつも入る。既定1） */
  everyYears?: number;
  unit?: TableUnit;
  format?: TableFormat;
  layout?: TableLayout;
  orientation?: TableOrientation;
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
  /** 値のある支出・収入の内訳（表に出す年のどこかに値のある物） */
  breakdown: SeriesKey[];
}

const under = (row: string, prefix: string) => row === prefix || row.startsWith(prefix + ".");

/** 列の名前（支出・収入の内訳は「支出の内訳: 」「収入の内訳: 」を頭に付けたグラフの題の言葉） */
const labelOf = (k: SeriesKey): string => (EXPENSE_KEYS.includes(k) ? `支出の内訳: ${SERIES[k].title}` : INCOME_KEYS.includes(k) ? `収入の内訳: ${SERIES[k].title}` : (ROW_LABELS[k] ?? SERIES[k].title));

/** 何年おき（最初の年と最後の年はいつも入る。接続口の calculate・compare と同じ選び方） */
export function everyYears(years: readonly number[], n: number): number[] {
  const first = years[0];
  const last = years[years.length - 1];
  if (first === undefined || n <= 1) return [...years];
  return years.filter((y) => (y - first) % n === 0 || y === last);
}

/** 1通りの年ごとの数字（選んだ行。画面の表に出す年） */
export function dataOf(v: TableVariant, a: Pick<TableArgs, "fromYear" | "toYear" | "fromAge" | "toAge">): VariantData {
  const req = v.request;
  const table = v.result.table;
  const s = summaryOf(req, v.result as PreviewResult);
  // 本人の年齢で選ぶときは、画面の表の年齢の行と同じ年齢（その年に迎える年齢。本人が世帯にいない年は入らない。0211）
  const selfAge = (y: number) => s.ages[String(y)]?.self;
  const inAges = (y: number) => {
    if (a.fromAge === undefined && a.toAge === undefined) return true;
    const age = selfAge(y);
    return age !== undefined && (a.fromAge === undefined || age >= a.fromAge) && (a.toAge === undefined || age <= a.toAge);
  };
  const shown = yearsWithin(table, displayYears(req)).filter((y) => (a.fromYear === undefined || y >= a.fromYear) && (a.toYear === undefined || y <= a.toYear) && inAges(y));
  const ys = new Set(shown);
  const values = new Map<number, Record<string, Cell>>();
  const zero = (): Record<string, Cell> => ({
    income: 0,
    taxSi: 0,
    expense: 0,
    net: 0,
    financialAssets: 0,
    debt: 0,
    shortfall: 0,
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
  }
  for (const [y, r] of values) {
    r.takeHome = (r.income as number) - (r.taxSi as number);
    const l = s.loanYears[String(y)];
    r.loanRepayment = l?.loanRepayment ?? 0;
    r.loanBalance = l?.loanBalance ?? 0;
    r.loanInterest = l?.loanInterest ?? 0;
    r.loanRate = l?.loanRate ?? null;
    // 公的年金と支出の内訳（比較の道具の系列と同じ関数 flowYearsOf。画面の表の行の当て方で、医療・介護だけを「その他の支出」から分けた物）
    const f = s.flowYears[String(y)];
    for (const k of FLOW_FIELDS) r[k] = f?.[k] ?? 0;
  }
  const breakdown = [...EXPENSE_KEYS, ...INCOME_KEYS].filter((k) => shown.some((y) => (values.get(y)?.[k] ?? 0) !== 0));
  return {
    label: v.label,
    shown,
    values,
    ages: s.ages,
    members: s.members,
    breakdown,
  };
}

/** 選んだ行を列にする（expenseBreakdown・incomeBreakdown は、どれかの通りに値のある支出・収入の内訳。並びは系列の名前の並び） */
function columnsOf(rows: readonly TableRowKey[], data: readonly VariantData[]): Column[] {
  const out: Column[] = [];
  for (const k of rows) {
    if (k === "expenseBreakdown" || k === "incomeBreakdown") {
      for (const e of BREAKDOWNS[k]) if (data.some((d) => d.breakdown.includes(e)) && !out.some((c) => c.key === e)) out.push({ key: e, label: labelOf(e), kind: "money" });
      continue;
    }
    if (out.some((c) => c.key === k)) continue;
    out.push({ key: k, label: labelOf(k), kind: k === "loanRate" ? "rate" : "money" });
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

/**
 * 表の向きを変える（年を列にする。0211）: 1つ目の列（年・通り）が見出しの行になり、見出しの行が1つ目の列になる。
 * 中のマスは同じ文字のまま（数字・年齢・空欄を変えない）
 */
export function transpose(header: readonly string[], body: readonly (readonly string[])[]): { header: string[]; body: string[][] } {
  const rows = [header, ...body];
  const cols = header.map((_, j) => rows.map((r) => r[j] ?? ""));
  return { header: cols[0] ?? [], body: cols.slice(1) };
}

function lines(format: TableFormat, header0: string[], body0: string[][], across = false): string[] {
  const { header, body } = across ? transpose(header0, body0) : { header: header0, body: body0 };
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
  // 通りの違い（当てたプランの変更。グラフの注と同じ書き方。同じ項目は後の物〔その通りの値〕だけ。0211）。どの通りにも無ければ書かない
  if (a.variants.some((v) => (v.planChanges ?? []).length > 0)) {
    const changes = a.variants.map((v) => {
      const all = v.planChanges ?? [];
      const rows = all.filter((c, k) => !all.slice(k + 1).some((x) => x.label === c.label));
      const list = rows.map((c) => `${c.label.replace(/^住宅ローン(\s*\d+（[^）]*）)?の/, "")} ${c.to}`);
      return `${many ? `${v.label}: ` : ""}${list.length > 0 ? list.join("・") : "変更なし"}`;
    });
    notes.push(`通りの違い\u3000${changes.join("／")}`);
  }
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
    cols.some((c) => (EXPENSE_KEYS as readonly string[]).includes(c.key)) ? "支出の内訳は画面のキャッシュフロー表の支出の行と同じ分け方（医療・介護だけを「その他の支出」から分けた物。全部足すと支出）" : null,
    cols.some((c) => (INCOME_KEYS as readonly string[]).includes(c.key)) ? "収入の内訳は画面のキャッシュフロー表の収入の行と同じ分け方（給与・事業所得・公的年金は世帯の合計。家賃収入と不動産の売却は1つ。全部足すと収入合計）" : null,
    has("nisaContribution") ? "NISAへの積立はつみたて投資枠・成長投資枠・こどもNISA の年額の合計" : null,
    has("nisaBalance") ? "NISAの残高は年末の時価（こどもNISA・ジュニアNISA・旧NISA を含む）" : null,
    has("debt") ? "負債の残高は住宅ローン以外も含む負債の合計" : null,
    has("pension") ? "公的年金は世帯の合計（企業年金・個人年金は含まない）" : null,
    has("shortfall") ? "資金不足は、預金と取り崩せる資産で払えなかった額" : null,
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
  // 選んだ年（年齢）の範囲に表に出す年が無ければ、空の表を返さずに理由と表の年を返す（0211）
  if (data.every((d) => d.shown.length === 0)) {
    const v0 = a.variants[0] as TableVariant;
    const all = yearsWithin(v0.result.table, displayYears(v0.request));
    const span = all.length > 0 ? `表は${all[0]}年から${all[all.length - 1]}年まで` : "表に出す年がありません";
    const by = a.fromAge !== undefined || a.toAge !== undefined ? "本人の年齢（from_age・to_age）" : "年（from_year・to_year）";
    return out({ status: "invalid", reason: `選んだ${by}の範囲に、表に出す年がありません（${span}）。` });
  }
  const across = a.orientation === "yearsAcross";
  const linesAt = (f: TableFormat, h: string[], b: string[][]) => lines(f, h, b, across);
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
      text.push(...linesAt(format, ["通り", "年", ...ms.map(ageHead), ...cols.map((c) => head(c))], body));
    } else {
      for (const [i, d] of data.entries()) {
        const ys = everyYears(d.shown, every);
        ys.forEach((y) => all.add(y));
        if (i > 0) text.push("");
        text.push(`**${mdField(d.label)}**`, "");
        text.push(
          ...linesAt(
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
        ...linesAt(
          format,
          ["年", ...ms.map(ageHead), ...cols.map((c) => head(c))],
          years.map((y) => [String(y), ...ageCells(base, y, ms), ...cols.map((c) => val(base, y, c))]),
        ),
      );
    } else if (format === "csv") {
      const header = ["年", ...ms.map(ageHead), ...cols.flatMap((c) => data.map((d) => head(c, `・${d.label}`)))];
      text.push(
        ...linesAt(
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
          ...linesAt(
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
