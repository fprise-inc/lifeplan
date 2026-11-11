// 結果の表の行の足し（0075・0076）: プランの比較の表の年金の見込みの行、世帯の外の家族の年金の行の見出し、年間収支の赤字の出どころ
// （行を開くと出る子の行）、扶養の境目の参考の行。どれも計算の結果を読むだけで、お金の流れは変えない
import { h } from "preact";
import renderToString from "preact-render-to-string";
import { describe, expect, it } from "vitest";
import type { EngineRequest, Member, TableCell } from "../src/engine/types.ts";
import { CashflowTable } from "../src/presentation/MainView.tsx";
import { CompareTable } from "../src/presentation/Compare.tsx";
import type { TableRowModel } from "../src/presentation/model.ts";
import { fromRequest } from "../src/workspace/input/household.ts";
import { pensionEstimateRequest, pensionEstimateSummary, pensionLines, type PlanPension } from "../src/workspace/input/pensionEstimate.ts";
import { compareTable } from "../src/workspace/plans/compare.ts";
import { cashflowTable, displayYears, eventsOf, familyText, personLabel } from "../src/workspace/present.ts";
import { roles } from "../src/workspace/roles.ts";
import { deficitSources, dependentRefRequest, dependentRefRows, outsideName } from "../src/workspace/resultRows.ts";
import { dependentLimits } from "../../hearing/src/estimates.ts";
import { modelHousehold, preview } from "./helpers.ts";

const noop = () => undefined;
const cellsOf = (r: TableRowModel | undefined): (number | null)[] => {
  if (r === undefined) throw new Error("no row");
  if (r.kind === "value" || r.kind === "total") return r.cells.map((c) => c.amount);
  if (r.kind === "diff") return r.cells;
  throw new Error(`row ${r.key} has no cells`);
};
const parentOf = (req: EngineRequest): Member => req.input.household.members.find((m) => m.kind === "parent")!;
/** 親（世帯の外の家族）に家計を1つにする期間（収入を世帯に入れる）を足した見本 */
function withIncomePeriod(id: string, from: string, to: string): EngineRequest {
  const req = modelHousehold(id);
  const p = parentOf(req);
  p.outside = { ...p.outside!, periods: [{ id: "00000000-0000-4000-8000-0000000000a1", from: { at: from }, to: { at: to }, living: true, income: true }] };
  return req;
}
/** 月額（年額の合計÷12）。年金のカードの要約と同じ求め方 */
const monthly = (req: EngineRequest, keepClaims: boolean): number => {
  const lines = pensionLines({ request: req }, preview(pensionEstimateRequest(req, keepClaims)), keepClaims).filter((l) => l.annual !== null);
  return Math.round(lines.reduce((s, l) => s + (l.annual ?? 0), 0) / 12);
};

describe("プランの比較の表の年金の見込みの行（0075）", () => {
  it("65歳からの月額は、年金のカードの「年金の見込み」と同じ求め方・同じ額", () => {
    const req = modelHousehold("salariedCoupleTwoKids");
    const wh = fromRequest(req);
    const std = preview(pensionEstimateRequest(req, false));
    const card = pensionEstimateSummary(wh, std)!;
    const cur = preview(req);
    const p: PlanPension = { std: monthly(req, false), claimed: monthly(req, true), receiving: false, anyClaim: false };
    const t = compareTable(req, [{ name: "現状", table: cur.table }], 95, 0, [p]);
    const row = t.rows.find((r) => r.key === "pension65")!;
    expect(row.label).toBe("65歳からの年金（夫婦の月額・今の水準）");
    expect(row.cells[0]!.text).toBe(`${card.pre}${card.main}万円`.replace("夫婦で", ""));
    expect(row.cells[0]!.diff).toBeNull();
    // 受け取り開始を変えたプランが無ければ、受け取り開始からの行は出さない
    expect(t.rows.some((r) => r.key === "pensionClaimed")).toBe(false);
    // 年金の見込みを渡さなければ、今までの行だけ
    expect(compareTable(req, [{ name: "現状", table: cur.table }], 95).rows.some((r) => r.key.startsWith("pension"))).toBe(false);
  });

  it("プランの差は月額の差（そのプラン−基準）。年金が少なくても注意にしない。受け取り開始を変えたプランがあれば、その月額の行も出す", () => {
    const req = modelHousehold("deferral");
    const cur = preview(req);
    const a: PlanPension = { std: 241000, claimed: 241000, receiving: false, anyClaim: false };
    const b: PlanPension = { std: 229000, claimed: 268000, receiving: false, anyClaim: true };
    const t = compareTable(req, [{ name: "現状", table: cur.table }, { name: "B", table: cur.table }], 95, 0, [a, b]);
    const r65 = t.rows.find((r) => r.key === "pension65")!;
    expect(r65.cells.map((c) => c.text)).toEqual(["月24.1万円", "月22.9万円"]);
    expect(r65.cells[1]).toMatchObject({ diff: "▲1.2万円", bad: false });
    const rc = t.rows.find((r) => r.key === "pensionClaimed")!;
    expect(rc.label).toContain("繰下げ・繰上げを含む");
    expect(rc.cells[1]).toMatchObject({ text: "月26.8万円", diff: "+2.7万円" });
    // 求めている間の列は「計算しています…」、求められなかった列は「—」
    const t2 = compareTable(req, [{ name: "現状", table: cur.table }, { name: "B", table: cur.table }], 95, 0, [null, { std: null, claimed: null, receiving: false, anyClaim: false }]);
    expect(t2.rows.find((r) => r.key === "pension65")!.cells.map((c) => c.text)).toEqual(["計算しています…", "—"]);
    const html = renderToString(h(CompareTable, { model: t }));
    expect(html).toContain("65歳からの年金");
  });

  it("受け取り開始を変えた見本では、受け取り開始からの月額が65歳からより多い（繰下げ）", () => {
    const req = modelHousehold("deferral");
    expect(monthly(req, true)).toBeGreaterThan(monthly(req, false));
  });
});

describe("家計を1つにする親の年金の行（0075）", () => {
  it("世帯の外の家族の年金は、呼び方と「家計を1つにする間」を見出しに出した別の行。年齢の行も同じ呼び方", () => {
    const req = withIncomePeriod("parentMoney", "2028-01", "2032-12");
    const r = preview(req);
    const years = displayYears(req);
    const t = cashflowTable(req, r.table, years, "表");
    const row = t.rows.find((x) => x.key === "pension:other1");
    expect(row?.label).toBe("お母さまの年金（家計を1つにする間）");
    expect(row?.kind === "value" ? row.note : undefined).toContain("収入を世帯に入れる");
    // 家計を1つにする期間の年だけ
    const parent = parentOf(req).id;
    const inTable = new Map<number, number>();
    for (const c of r.table) if (c.row === "cf.income.pension" && c.member === parent) inTable.set(c.year, (inTable.get(c.year) ?? 0) + c.amount);
    expect([...inTable.keys()].sort()).toEqual([2028, 2029, 2030, 2031, 2032]);
    cellsOf(row).forEach((v, i) => expect(v ?? 0).toBe(inTable.get(years[i]!) ?? 0));
    expect(t.rows.find((x) => x.key === "pension:self")?.label).toBe("ご本人の年金");
    expect(t.rows.find((x) => x.key === "age:other1")?.label).toBe("お母さま");
  });

  it("同じ呼び方の世帯の外の家族が2人なら、誰の家族かを前に付ける", () => {
    const req = modelHousehold("salariedCoupleTwoKids");
    const h0 = req.input.household;
    const self = h0.members.find((m) => m.kind === "self")!;
    const spouse = h0.members.find((m) => m.kind === "spouse")!;
    const mother = (id: string, of: string): Member => ({ id, kind: "parent", birth: { birthYearMonth: "1950-04", bornOnFirst: false }, sex: "female", joins: null, leaves: null, expected: false, outside: { of, periods: [] } });
    h0.members.push(mother("00000000-0000-4000-8000-0000000000b1", self.id), mother("00000000-0000-4000-8000-0000000000b2", spouse.id));
    const [m1, m2] = h0.members.slice(-2) as [Member, Member];
    expect(outsideName(req, m1)).toBe("ご本人のお母さま");
    expect(outsideName(req, m2)).toBe("配偶者のお母さま");
    expect(outsideName(modelHousehold("parentMoney"), parentOf(modelHousehold("parentMoney")))).toBe("お母さま");
  });

  it("兄弟姉妹は「ご兄弟姉妹」、孫は「お孫さん」。誰の家族かで見分けられない2人以上は、足した順に番号（入力の画面の「孫1」と同じ決まり）", () => {
    const req = modelHousehold("salariedCoupleTwoKids");
    const h0 = req.input.household;
    const self = h0.members.find((m) => m.kind === "self")!;
    const spouse = h0.members.find((m) => m.kind === "spouse")!;
    let n = 0;
    const add = (kind: Member["kind"], of: string): Member => {
      const m: Member = { id: `00000000-0000-4000-8000-0000000000${String(++n).padStart(2, "0")}`, kind, birth: { birthYearMonth: "1990-04", bornOnFirst: false }, sex: "male", joins: null, leaves: null, expected: false, outside: { of, periods: [] } };
      h0.members.push(m);
      return m;
    };
    const one = add("sibling", self.id);
    const g1 = add("grandchild", self.id);
    expect([outsideName(req, one), outsideName(req, g1)]).toEqual(["ご兄弟姉妹", "お孫さん"]);
    const g2 = add("grandchild", self.id);
    expect([outsideName(req, g1), outsideName(req, g2)]).toEqual(["お孫さん1", "お孫さん2"]);
    // 誰の家族かで分けられる人は前に付け、同じ人の家族の中で見分けられないときだけ番号
    const s2 = add("sibling", self.id);
    const s3 = add("sibling", spouse.id);
    expect([one, s2, s3].map((m) => outsideName(req, m))).toEqual(["ご本人のご兄弟姉妹1", "ご本人のご兄弟姉妹2", "配偶者のご兄弟姉妹"]);
    // 表の年齢の行・グラフの家族の文も同じ呼び方。番号の後は年齢と続けないように間を空ける
    const years = displayYears(req);
    const labels = cashflowTable(req, preview(req).table, years, "表").rows.filter((r) => r.kind === "age").map((r) => r.label);
    expect(labels).toEqual(expect.arrayContaining(["お孫さん1", "お孫さん2", "ご本人のご兄弟姉妹1", "配偶者のご兄弟姉妹"]));
    expect(familyText(roles(req), years[0]!, undefined, (r) => personLabel(req, r))).toContain(`お孫さん1 ${String(years[0]! - 1990)}歳`);
  });

  it("世帯の外の家族のお金が尽きるできごとの文も同じ呼び方", () => {
    const req = modelHousehold("parentMoney");
    const r = preview(req);
    const evs = eventsOf(req, r.table, displayYears(req), r.summary);
    for (const e of evs.filter((x) => x.icon === "親")) expect(e.text).toMatch(/^お母さまのお金が尽きる見込み/);
  });
});

describe("年間収支の赤字の出どころ（行を開くと出る子の行。0076）", () => {
  it("赤字の年は、口座から取り崩して払った分（口座ごと・手取り）と家計の赤字に分け、子の行の合計は年間収支と同じ", () => {
    const req = modelHousehold("nisaWithdrawal");
    const r = preview(req);
    const years = displayYears(req);
    const t = cashflowTable(req, r.table, years, "表");
    const net = t.rows.find((x) => x.key === "net")!;
    if (net.kind !== "total") throw new Error("net");
    expect(net.children).toBeDefined();
    expect(net.note).toContain("▸");
    const kids = net.children!;
    expect(kids.some((k) => k.label.includes("NISA") && k.label.endsWith("から払った分（取り崩し）"))).toBe(true);
    years.forEach((y, i) => {
      const n = net.cells[i]!.amount ?? 0;
      const sum = kids.reduce((s, k) => s + (k.cells[i]!.amount ?? 0), 0);
      if (n < 0) expect(sum).toBe(n);
      else expect(kids.every((k) => k.cells[i]!.amount === null)).toBe(true);
      void y;
    });
    // 提示層の鍵に物の ID を入れない
    const ids = new Set((req.input.household.accounts ?? []).map((a) => a.id));
    for (const k of kids) expect([...ids].some((id) => k.key.includes(id))).toBe(false);
  });

  it("取り崩しで赤字を払った年が無ければ、子の行を持たない（今までの表のまま）", () => {
    const req = modelHousehold("nisaWithdrawal");
    const r = preview(req);
    const years = displayYears(req);
    const noWithdrawal: TableCell[] = r.table.filter((c) => !c.row.startsWith("cf.transfer.withdrawal"));
    expect(deficitSources(req, noWithdrawal, years)).toBeNull();
    const t = cashflowTable(req, noWithdrawal, years, "表");
    const net = t.rows.find((x) => x.key === "net")!;
    expect(net.kind === "total" ? net.children : "x").toBeUndefined();
  });

  it("表は閉じた形で出し、開く「▸」だけを置く（子の行は開いたときだけ）", () => {
    const req = modelHousehold("nisaWithdrawal");
    const r = preview(req);
    const t = cashflowTable(req, r.table, displayYears(req), "表");
    const html = renderToString(h(CashflowTable, { model: t, selectedYear: null, onSelectYear: noop, onEvidence: noop }));
    expect(html).toContain('data-row-open="net"');
    expect(html).toContain('aria-expanded="false"');
    expect(html).not.toContain("data-child-row");
  });
});

describe("扶養の境目の参考の行（0076）", () => {
  it("扶養していると入れた世帯の外の親がいるときだけ写しの要求を作り、世帯の物は変えない", () => {
    const req = modelHousehold("parentMoney");
    expect(parentOf(req).support?.dependent).toBe(true);
    const ref = dependentRefRequest(req)!;
    expect(parentOf(ref).outside?.periods).toEqual([expect.objectContaining({ from: null, to: null, income: true })]);
    expect(parentOf(req).outside?.periods).toEqual([]);
    const off = modelHousehold("parentMoney");
    parentOf(off).support = { dependent: false, cohabiting: true };
    expect(dependentRefRequest(off)).toBeNull();
    expect(dependentRefRequest(modelHousehold("salariedCoupleTwoKids"))).toBeNull();
  });

  it("年金は計算が世帯に入れるときと同じ額で、境目までは「境目−年金」（亡くなる見込みの年の後は出さない）", () => {
    const req = modelHousehold("parentMoney");
    const years = displayYears(req);
    const rows = dependentRefRows(req, preview(dependentRefRequest(req)!).table, years);
    expect(rows.map((r) => r.key)).toEqual(["group:ref", "depRef1", "depGap1"]);
    expect(rows[1]!.label).toBe("お母さまの年金（扶養の判定に使う額）");
    const pension = cellsOf(rows[1]);
    const gap = cellsOf(rows[2]);
    // 家計を1つにする期間（収入を世帯に入れる）にした年の世帯の表の額と同じ
    const inc = withIncomePeriod("parentMoney", "2029-01", "2029-12");
    const p = parentOf(inc).id;
    const v2029 = preview(inc).table.filter((c) => c.row === "cf.income.pension" && c.member === p && c.year === 2029).reduce((s, c) => s + c.amount, 0);
    expect(v2029).toBeGreaterThan(0);
    expect(pension[years.indexOf(2029)]).toBe(v2029);
    const m = parentOf(req);
    const i = years.indexOf(2029);
    const lim = dependentLimits(2029 - Number(m.birth.birthYearMonth.slice(0, 4)), "2029-12-01")!;
    expect(gap[i]).toBe(lim.taxPension - v2029);
    // 亡くなる見込みの年の後は空
    const dies = modelHousehold("parentMoney");
    parentOf(dies).leaves = { at: "2030-06" };
    const dr = dependentRefRows(dies, preview(dependentRefRequest(dies)!).table, years);
    expect(cellsOf(dr[1])[years.indexOf(2030)]).not.toBeNull();
    expect(cellsOf(dr[1])[years.indexOf(2031)]).toBeNull();
    expect(cellsOf(dr[2])[years.indexOf(2031)]).toBeNull();
  });
});
