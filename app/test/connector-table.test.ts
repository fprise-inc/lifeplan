// AI接続口の年ごとの表（connector/table.ts。0209）: 画面のキャッシュフロー表（present.ts の cashflowTable）と同じ年・同じ年齢・同じ行の数字の表を、
// CSV・Markdown の文にすること。万円は画面と同じ丸め（presentation/format.ts の man）。表の下の注（前提・相場などの想定・単位・試算の時点と旨）が必ず入ること。
// 接続口のテスト（crates/lifeplan/tests/mcp_connector.rs の table_matches_compare）は、本物の接続口で同じ関数を動かし、compare の系列と同じ数字になることを確かめる
import { describe, expect, it } from "vitest";
import { EXPENSE_KEYS, SERIES } from "../src/connector/chart.ts";
import { flowYearsOf, type FlowYear } from "../src/connector/summary.ts";
import { table, TABLE_ROWS, type TableArgs, type TableOut, type TableVariant } from "../src/connector/table.ts";
import { forEngine } from "../src/engine/moneyRows.ts";
import type { EngineRequest } from "../src/engine/types.ts";
import { man } from "../src/presentation/format.ts";
import type { TableRowModel } from "../src/presentation/model.ts";
import { cashflowTable, displayYears, yearsWithin } from "../src/workspace/present.ts";
import { modelHousehold, preview } from "./helpers.ts";

const variantOf = (req: EngineRequest, label: string, stress?: string): TableVariant => {
  const r = preview(forEngine(req));
  return {
    label,
    request: req,
    result: { table: r.table, summary: r.summary },
    ...(stress !== undefined ? { stress } : {}),
  };
};
type ValueRow = Extract<TableRowModel, { kind: "value" | "total" }>;
const isValue = (r: TableRowModel | undefined): r is ValueRow => r !== undefined && (r.kind === "value" || r.kind === "total");
const make = (a: TableArgs) => JSON.parse(table(JSON.stringify(a), "", "")) as TableOut;

/** CSV を表（見出し・行）と注に分ける（表は最初の空の行まで。欄は囲みの無い物だけ） */
function parseCsv(text: string): {
  header: string[];
  rows: string[][];
  notes: string[];
} {
  const [body = "", foot = ""] = text.replace(/^\uFEFF/, "").split("\n\n");
  const [head = "", ...rows] = body.split("\n");
  return {
    header: head.split(","),
    rows: rows.map((r) => r.split(",")),
    notes: foot.split("\n").filter((l) => l !== ""),
  };
}

const req = {
  trace: "none",
  input: modelHousehold("salariedCoupleTwoKids").input,
} as EngineRequest;
const base = variantOf(req, "基本");
const result = preview(forEngine(req));
const shown = yearsWithin(result.table, displayYears(req));

describe("AI接続口の年ごとの表（0209）", () => {
  it("年・年齢・行の数字が、画面のキャッシュフロー表と同じ（円）", () => {
    const out = make({
      variants: [base],
      baseMonth: req.input.baseMonth,
      rows: [...TABLE_ROWS],
      unit: "yen",
      everyYears: 1,
    });
    expect(out.status).toBe("ok");
    expect(out.layout).toBe("single");
    expect(out.years).toEqual([...shown]);
    const { header, rows } = parseCsv(out.text as string);
    const screen = cashflowTable(req, result.table, [...shown], "");
    const col = (name: string) => {
      const i = header.indexOf(name);
      expect(i, `${name} が見出しにありません: ${header.join(",")}`).toBeGreaterThan(0);
      return rows.map((r) => r[i]);
    };
    const screenRow = (key: string) => screen.rows.find((r) => r.key === key);
    const cells = (key: string) => {
      const r = screenRow(key);
      return isValue(r) ? r.cells.map((c) => String(c.amount ?? 0)) : shown.map(() => "0");
    };
    expect(rows.map((r) => Number(r[0]))).toEqual([...shown]);
    // 年齢の列は画面の表の年齢の行と同じ（世帯にいない年は空）
    for (const r of screen.rows.filter((x) => x.kind === "age")) {
      if (!("ages" in r)) continue;
      expect(col(`${r.label}（歳）`), r.label).toEqual(r.ages.map((a) => (a === null ? "" : String(a))));
    }
    expect(col("収入合計（円）")).toEqual(cells("incomeTotal"));
    expect(col("税・社会保険料（円）")).toEqual(cells("taxSi"));
    expect(col("年間収支（円）")).toEqual(cells("net"));
    expect(col("金融資産残高（円）")).toEqual(cells("financial"));
    expect(col("住宅ローン残高（円）")).toEqual(cells("debt"));
    // 支出の内訳は比較の道具の系列と同じ関数（flowYearsOf。画面の表の支出の行の当て方で、医療・介護だけを分けた物）の数字で、足すと支出になる
    const flows = flowYearsOf(req, result.table);
    const parts = EXPENSE_KEYS.map((k) => {
      const got = col(`支出の内訳: ${SERIES[k].title}（円）`);
      expect(got, k).toEqual(shown.map((y) => String(flows[String(y)]?.[k as keyof FlowYear] ?? 0)));
      return got.map(Number);
    });
    expect(parts.filter((p) => p.some((x) => x !== 0)).length).toBeGreaterThan(2);
    // 画面の表の「基本生活費」の行は、支出の内訳の生活費と同じ
    const living = screen.rows.find((r) => r.key === "living");
    expect(col(`支出の内訳: ${SERIES.expenseLiving.title}（円）`)).toEqual(cells(living?.key ?? "living"));
    const expense = col("支出（円）").map(Number);
    expense.forEach((e, i) => expect(parts.reduce((a, p) => a + (p[i] ?? 0), 0)).toBe(e));
    // 支出＋税・社会保険料は画面の「支出合計」、手取りは収入−税・社会保険料
    const tax = col("税・社会保険料（円）").map(Number);
    expect(expense.map((e, i) => String(e + (tax[i] ?? 0)))).toEqual(cells("expenseTotal"));
    const income = col("収入合計（円）").map(Number);
    expect(col("手取り（円）").map(Number)).toEqual(income.map((x, i) => x - (tax[i] ?? 0)));
    // 公的年金は人ごとの年金の行の合計
    const pens = screen.rows.filter((r): r is ValueRow => isValue(r) && r.key.startsWith("pension:"));
    expect(pens.length).toBeGreaterThan(0);
    expect(col("公的年金（円）")).toEqual(shown.map((_, i) => String(pens.reduce((a, r) => a + (r.cells[i]?.amount ?? 0), 0))));
    // 住宅ローンの金利は % の数（返済の無い年は空）
    expect(col("住宅ローンの金利（%）").some((x) => /^\d+(\.\d+)?$/.test(x ?? ""))).toBe(true);
  });

  it("万円は画面と同じ丸め。Markdown は画面と同じ書き方（3桁の区切り・▲）", () => {
    const out = make({
      variants: [base],
      baseMonth: req.input.baseMonth,
      rows: ["financialAssets", "net"],
      format: "markdown",
      everyYears: 1,
    });
    const screen = cashflowTable(req, result.table, [...shown], "");
    const fin = screen.rows.find((r) => r.key === "financial");
    if (!isValue(fin)) throw new Error("金融資産の行がありません");
    const lines = (out.text as string).split("\n").filter((l) => /^\| \d{4} \|/.test(l));
    expect(lines.length).toBe(shown.length);
    const finCol = lines.map((l) => l.split(" | ")[5]);
    expect(finCol).toEqual(fin.cells.map((c) => man(c.amount ?? 0)));
    expect(finCol.some((x) => x?.startsWith("▲"))).toBe(true);
    expect(out.text).toContain("| 年 | ご本人（歳） | 配偶者（歳） | 第1子（歳） | 第2子（歳） | 金融資産残高（万円） | 年間収支（万円） |");
    // CSV の万円は数のまま（負の数は -。区切りなし）
    const csv = parseCsv(
      make({
        variants: [base],
        baseMonth: req.input.baseMonth,
        rows: ["financialAssets"],
        everyYears: 1,
        members: [],
      }).text as string,
    );
    expect(csv.header).toEqual(["年", "金融資産残高（万円）"]);
    expect(csv.rows.map((r) => r[1])).toEqual(
      fin.cells.map((c) =>
        man(c.amount ?? 0)
          .replace(/,/g, "")
          .replace("▲", "-"),
      ),
    );
  });

  it("表の下に注（前提・相場などの想定・単位・試算の時点と旨）が必ず入る。「ファイナンシアで試算」は選んだときだけ", () => {
    const out = make({
      variants: [base],
      baseMonth: "2026-10",
      rows: ["takeHome", "expense", "net"],
    });
    const { notes } = parseCsv(out.text as string);
    expect(notes).toEqual((out.notes ?? []).map((n) => `※ ${n}`));
    expect(notes.some((n) => n.startsWith("※ 前提　物価上昇率 年"))).toBe(true);
    expect(notes).toContain("※ 相場などの想定　なし（運用利回りは前提のまま）");
    expect(notes.some((n) => n.startsWith("※ 単位は万円"))).toBe(true);
    expect(notes.some((n) => n.includes("手取り＝収入合計−税・社会保険料"))).toBe(true);
    expect(notes[notes.length - 1]).toBe("※ 2026年10月時点の入力による試算で、将来の結果を約束するものではありません。");
    expect(out.text).not.toContain("ファイナンシアで試算");
    const credited = make({
      variants: [base],
      baseMonth: "2026-10",
      credit: true,
    });
    expect(credited.notes?.[credited.notes.length - 1]).toBe("ファイナンシアで試算（2026年10月時点の入力による試算で、将来の結果を約束するものではありません）");
    // BOM は CSV で選んだときだけ
    expect(
      make({
        variants: [base],
        baseMonth: "2026-10",
        bom: true,
      }).text?.startsWith("\uFEFF"),
    ).toBe(true);
    expect(
      make({
        variants: [base],
        baseMonth: "2026-10",
        bom: true,
        format: "markdown",
      }).text?.startsWith("\uFEFF"),
    ).toBe(false);
    expect(make({ variants: [base], baseMonth: "2026-10" }).text?.startsWith("\uFEFF")).toBe(false);
  });

  it("何年おき・年の範囲（最初の年と最後の年はいつも入る）", () => {
    const out = make({
      variants: [base],
      baseMonth: "2026-10",
      everyYears: 5,
      fromYear: 2030,
      toYear: 2050,
    });
    expect(out.years).toEqual([2030, 2035, 2040, 2045, 2050]);
    const odd = make({ variants: [base], baseMonth: "2026-10", everyYears: 7 });
    const first = shown[0] as number;
    const last = shown[shown.length - 1] as number;
    expect(odd.years?.[0]).toBe(first);
    expect(odd.years?.[odd.years.length - 1]).toBe(last);
    expect(odd.years?.slice(0, -1).every((y) => (y - first) % 7 === 0)).toBe(true);
  });

  it("通りを並べる: 行ごとに通りを列に（byRow）、通りごとに分ける（byVariant）。通りごとの前提と相場などの想定を注に書く", () => {
    const hi = structuredClone(req);
    if (hi.input.assumptions === undefined) throw new Error("前提がありません");
    hi.input.assumptions.inflation = { default: "0.02" };
    const vs = [base, variantOf(hi, "物価2%", "退職の直後に株などが下がる")];
    const byRow = make({
      variants: vs,
      baseMonth: "2026-10",
      rows: ["financialAssets", "net"],
      members: ["self"],
    });
    expect(byRow.layout).toBe("byRow");
    const r = parseCsv(byRow.text as string);
    expect(r.header).toEqual(["年", "ご本人（歳）", "金融資産残高・基本（万円）", "金融資産残高・物価2%（万円）", "年間収支・基本（万円）", "年間収支・物価2%（万円）"]);
    expect(r.notes.some((n) => n.startsWith("※ 前提　基本: 物価上昇率 年1%") && n.includes("物価2%: 物価上昇率 年2%"))).toBe(true);
    expect(r.notes).toContain("※ 相場などの想定　基本: なし／物価2%: 退職の直後に株などが下がる");
    const byVariant = make({
      variants: vs,
      baseMonth: "2026-10",
      rows: ["financialAssets"],
      members: ["self"],
      layout: "byVariant",
    });
    const v = parseCsv(byVariant.text as string);
    expect(v.header).toEqual(["通り", "年", "ご本人（歳）", "金融資産残高（万円）"]);
    expect(v.rows.length).toBe(2 * (byVariant.years?.length ?? 0));
    expect(new Set(v.rows.map((x) => x[0]))).toEqual(new Set(["基本", "物価2%"]));
    // 同じ年の基本の数字は、byRow と byVariant で同じ
    const y0 = r.rows[0]?.[0];
    expect(v.rows.find((x) => x[0] === "基本" && x[1] === y0)?.[3]).toBe(r.rows[0]?.[2]);
    // Markdown は行ごと・通りごとに見出しの付いた表
    const md = make({
      variants: vs,
      baseMonth: "2026-10",
      rows: ["financialAssets", "net"],
      format: "markdown",
      members: [],
    }).text as string;
    expect(md).toContain("**金融資産残高（万円）**");
    expect(md).toContain("| 年 | 基本 | 物価2% |");
    const mdv = make({
      variants: vs,
      baseMonth: "2026-10",
      rows: ["financialAssets"],
      format: "markdown",
      layout: "byVariant",
      members: [],
    }).text as string;
    expect(mdv).toContain("**物価2%**");
    // 通りの名前の , " | は崩さない
    const odd = make({
      variants: [base, { ...vs[1]!, label: 'A,"B"|C' }],
      baseMonth: "2026-10",
      rows: ["net"],
      members: [],
    });
    expect(odd.text?.split("\n")[0]).toBe('年,年間収支・基本（万円）,"年間収支・A,""B""|C（万円）"');
    expect(
      make({
        variants: [base, { ...vs[1]!, label: "A|B" }],
        baseMonth: "2026-10",
        rows: ["net"],
        members: [],
        format: "markdown",
      }).text,
    ).toContain("| A\\|B |");
  });

  it("選べない行は理由を返す", () => {
    const out = make({
      variants: [base],
      baseMonth: "2026-10",
      rows: ["nope" as never],
    });
    expect(out.status).toBe("invalid");
    expect(out.reason).toContain("nope");
    expect(make({ variants: [], baseMonth: "2026-10" }).status).toBe("invalid");
  });
});
