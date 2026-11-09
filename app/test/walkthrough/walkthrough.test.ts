// 通しの入力のテスト: 3つの世帯を見えないブラウザで画面のキー入力（押す・打つ・Tab・保存）で最初から結果まで入れ、入れた値が世帯の中身と
// 計算の結果に届いたか、開いたパネルの文字に内部の名前が出ていないかを確かめる。見本の棚の主な世帯は、全部の入力項目のパネルを開いて結果のタブまで見る。
// 今ある不具合は「直す待ち」（it.fails。まだ落ちることを確かめる）にして CI を通す。直したまとまりが it.fails を it にする（直ったのに it.fails のままだと落ちる）。
// 決まりは設計記録 0132。流すのは FINANCIA_WALKTHROUGH=1 のときだけ（CI の通しの入力のジョブ・手元の npm run check:walkthrough）。ブラウザの場所は browser.ts
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { forEngine } from "../../src/engine/moneyRows.ts";
import type { EngineRequest, TableCell } from "../../src/engine/types.ts";
import type { WorkingHousehold } from "../../src/workspace/input/household.ts";
import { rowDefs } from "../../src/workspace/present.ts";
import { fromBody } from "../../src/workspace/store/body.ts";
import { preview } from "../helpers.ts";
import { subjectOf, watch } from "../watch/rules.ts";
import { browserPath, start, type Session } from "./browser.ts";
import { WALKTHROUGH } from "./fieldEffect.ts";
import { household1, household2, household3, household4, household5, openSample, walkPanels, type Notes } from "./households.ts";

const SHOTS = process.env.WALKTHROUGH_SHOTS;
const RUN = WALKTHROUGH && browserPath() !== null;
if (WALKTHROUGH && !RUN) console.log("見えないブラウザが見つからないので、通しの入力のテストを飛ばします（HEADLESS_BROWSER で場所を渡せます）");

/** 画面に出る文字に、内部の名前（英字のキー・JSON・選択肢の生の値）が混ざっていないか。混ざっていた物を返す */
export function internalWords(text: string): string[] {
  const out = new Set<string>();
  for (const m of text.matchAll(/\b[a-z]+[A-Z][A-Za-z]*\b/g)) if (!["iDeCo"].includes(m[0])) out.add(m[0]);
  for (const m of text.matchAll(/\{"[a-zA-Z]/g)) out.add(m[0]);
  for (const m of text.matchAll(/\b(home|facility|regular|partTime|selfEmployed|contract|deposit|nisa|ideco|taxable|mortgage|statementUnder50|statementOver50|undefined|null|NaN)\b/g)) out.add(m[0]);
  return [...out];
}

/** 「○つ」の数え方が出ている所（0129 と同じく、括弧の中の「（4つ）」と2桁以上の「12つ」だけ。文の中の「1つにまとめる」は見ない） */
const tsuCounts = (text: string): string[] => [...text.matchAll(/[（(]\d+つ[）)]|\d{2,}つ/g)].map((m) => m[0]);

interface Done {
  notes: Notes;
  wh: WorkingHousehold;
  table: TableCell[];
  /** 結果のタブの表の行の名前 */
  rows: string[];
  /** 資産と負債のタブの文字 */
  bs: string;
  /** ありえない結果の見張り（0129 の決まり）に当たった所 */
  watched: { rule: string; problems: string[] }[];
}

const yearOf = (req: EngineRequest) => Number(req.input.baseMonth.slice(0, 4));
const sum = (t: TableCell[], prefix: string, year: number) => t.filter((c) => (c.row === prefix || c.row.startsWith(`${prefix}.`)) && c.year === year).reduce((a, c) => a + c.amount, 0);

describe.skipIf(!RUN)("通しの入力（画面のキー入力で世帯を入れて結果まで出す）", () => {
  let s: Session;
  beforeAll(async () => {
    s = await start();
  }, 600_000);
  afterAll(async () => {
    await s?.close();
  });

  /** 世帯を入れ終えたら、保存された本文・計算の結果・結果のタブの表の行・資産と負債のタブを読む */
  async function finish(name: string, notes: Notes): Promise<Done> {
    const wh = fromBody(await s.page.savedBody()).wh;
    const table = preview(forEngine(wh.request)).table;
    await s.page.click("結果", { exact: true });
    await s.page.until("document.querySelector('table')", "結果のタブの表");
    await s.page.shot(SHOTS, `${name}_結果`);
    const rows = await s.page.eval<string[]>(`return w.all("table tr").map((r) => w.txt(r.querySelector("th, td") ?? r)).filter((t) => t !== "" && !/^[\\d▲,]/.test(t))`);
    await s.page.click("資産と負債", { exact: true });
    await s.page.until("document.body.innerText.includes('バランスシート')", "資産と負債のタブ");
    await s.page.shot(SHOTS, `${name}_資産と負債`);
    const bs = await s.page.eval<string>(`return w.txt(document.querySelector("main") ?? document.body)`);
    await s.page.click("万一のとき", { exact: true });
    await s.page.settle();
    await s.page.shot(SHOTS, `${name}_万一のとき`);
    await s.page.click("入力", { exact: true });
    return { notes, wh, table, rows, bs, watched: watch(subjectOf(name, wh)) };
  }

  const panelChecks = (get: () => Done | Notes) => {
    const panels = () => {
      const d = get();
      return "panels" in d ? d.panels : d.notes.panels;
    };
    it("開いたパネルの文字に、内部の名前（英字のキー・JSON・生の値）が出ない", () => {
      const bad = Object.entries(panels()).flatMap(([k, t]) => internalWords(t).map((w) => `${k}: ${w}`));
      expect(bad).toEqual([]);
    });
    it("開いたパネルの文字に「○つ」の数え方が出ない（「○か所」「○件」にそろえる）", () => {
      const bad = Object.entries(panels()).flatMap(([k, t]) => tsuCounts(t).map((w) => `${k}: ${w}`));
      expect(bad).toEqual([]);
    });
  };

  /** 0129 の見張りの決まりを当てる。known は今ある不具合で当たる所（直す待ち。まだ当たることを it.fails で確かめる） */
  const watchChecks = (get: () => Done, known: readonly { rule: string; match: RegExp; what: string }[]) => {
    const hits = (k: { rule: string; match: RegExp }) => get().watched.filter((w) => w.rule === k.rule).flatMap((w) => w.problems.filter((p) => k.match.test(p)));
    it("ありえない結果の見張りの決まりに当たらない（直す待ちを除く）", () => {
      const rest = get().watched.flatMap((w) => w.problems.filter((p) => !known.some((k) => k.rule === w.rule && k.match.test(p))).map((p) => `${w.rule}: ${p}`));
      expect(rest, rest.join("\n")).toEqual([]);
    });
    for (const k of known)
      it.fails(`見張りの直す待ち: ${k.what}`, () => {
        expect(hits(k)).toEqual([]);
      });
  };

  describe("世帯① 会社員の夫婦と子2人・持ち家（住宅ローンあり）・標準の欄だけ", () => {
    let d: Done;
    beforeAll(async () => {
      d = await finish("世帯1", await household1(s.page));
    }, 600_000);
    const h = () => d.wh.request.input.household;

    it("家族4人の生年月が入る", () => {
      expect(h().members.map((m) => m.birth.birthYearMonth)).toEqual(["1988-05", "1990-08", "2020-06", "2023-02"]);
    });
    it("年収（賞与込み）550万円・400万円が入る", () => {
      const total = h()
        .employmentPeriods!.filter((p) => p.from !== undefined)
        .map((p) => (p.salary?.annual?.value ?? 0) + (p.salary?.bonus?.value ?? 0));
      expect(total).toContain(5_500_000);
      expect(total).toContain(4_000_000);
    });
    it("基本生活費 月30万円・住宅ローン 残高2,800万円 毎月9万円・預金500万円・NISA 200万円 月3万円が、世帯の中身と表に届く", () => {
      const y = yearOf(d.wh.request) + 1;
      expect(h().livingExpenses?.[0]?.monthly?.value).toBe(300_000);
      expect(h().debts?.[0]?.balance?.value).toBe(28_000_000);
      expect(sum(d.table, "cf.expense.housing.loan", y)).toBe(1_080_000);
      expect(h().accounts?.map((a) => [a.kind, a.marketValue?.value])).toEqual([
        ["deposit", 5_000_000],
        ["nisa", 2_000_000],
      ]);
      expect(sum(d.table, "cf.transfer.nisa", y)).toBe(360_000);
    });
    it("結果のタブに表が出て、給与の行がある", () => {
      expect(d.rows.some((r) => r.includes("給与"))).toBe(true);
    });
    it("円の欄（保険の年金月額）に「15万」と打つと 150,000円として入る", () => {
      const cov = h().insuranceContracts?.[0]?.coverages?.find((c) => c.benefit === "incomeProtection");
      expect(cov?.amount).toBe(150_000);
    });
    it("今の残高から入れた住宅ローンで借りた年月を入れても、入れた毎月の返済額・完済の年月は変わらず、持ち家の住み始めと控除の入居が借りた年月になる", () => {
      expect(d.notes.seen.loanPaymentAfterStart).toBe("90,000");
      expect(d.notes.seen.loanPayoffAfterStart).toBe("2058-03");
      const loan = h().debts![0]!;
      expect(loan.start).toEqual({ at: "2023-04" });
      // 完済の年月＝借りた年月＋返済期間
      expect(loan.repayment.termMonths).toBe((2058 - 2023) * 12 - 1);
      expect(h().residences!.find((r) => r.kind === "own")!.from).toEqual({ at: "2023-04" });
      expect(h().events?.find((e) => e.id === loan.housing?.moveIn)?.at).toEqual({ at: "2023-04" });
    });
    it("持ち家を標準の欄だけで入れても、持ち家の価値が資産に入り、純資産がマイナスにならない（評価額は未入力の警告なので標準に出る）", () => {
      expect(sum(d.table, "cf.balance.account.realEstate", yearOf(d.wh.request))).toBeGreaterThan(0);
      expect(d.bs).not.toContain("純資産がマイナスに");
    });
    panelChecks(() => d);
    watchChecks(() => d, []);
  });

  describe("世帯② 自営業のひとり親と子1人・賃貸・詳細も使う", () => {
    let d: Done;
    beforeAll(async () => {
      d = await finish("世帯2", await household2(s.page));
    }, 600_000);
    const h = () => d.wh.request.input.household;

    it("ご本人は女性、子は1人", () => {
      expect(h().members.find((m) => m.kind === "self")?.sex).toBe("female");
      expect(h().members.filter((m) => m.kind === "child").length).toBe(1);
    });
    it("事業所得 350万円が入り、表の事業所得に出て、70歳で終わる", () => {
      const self = h().members[0]!;
      const p = h().employmentPeriods!.find((x) => x.type === "selfEmployed");
      expect(p?.business?.income?.value).toBe(3_500_000);
      const y70 = Number(self.birth.birthYearMonth.slice(0, 4)) + 70;
      expect(sum(d.table, "cf.income.business", yearOf(d.wh.request) + 1)).toBeGreaterThan(3_000_000);
      expect(sum(d.table, "cf.income.business", y70 + 1)).toBe(0);
    });
    it("働き方と収入の確定申告で入れた青色申告（65万円）が入り、白色のときより所得税・住民税が下がる", () => {
      const self = h().members.find((m) => m.kind === "self")!;
      expect(self.taxReturn).toEqual({ method: "blue", blueDeduction: "electronic" });
      const white = structuredClone(d.wh.request);
      delete (white.input.household.members.find((m) => m.kind === "self") as { taxReturn?: unknown }).taxReturn;
      const table = preview(forEngine(white)).table;
      const y = yearOf(d.wh.request) + 2;
      expect(sum(table, "cf.taxSi.incomeTax", y)).toBeGreaterThan(sum(d.table, "cf.taxSi.incomeTax", y));
      expect(sum(table, "cf.taxSi.residentTax", y)).toBeGreaterThan(sum(d.table, "cf.taxSi.residentTax", y));
    });
    it("家賃 月7.5万円・奨学金 月5万円・iDeCo 80万円 月2.3万円・小規模企業共済 150万円 月3万円が入る", () => {
      expect(sum(d.table, "cf.expense.housing.rent", yearOf(d.wh.request) + 1)).toBe(900_000);
      const monthly = (v: number) => h().accounts!.find((a) => a.marketValue?.value === v)?.contributions?.[0]?.monthly ?? null;
      expect(h().accounts!.map((a) => a.marketValue?.value)).toEqual([2_000_000, 800_000, 1_500_000]);
      expect(h().accounts!.find((a) => a.marketValue?.value === 800_000)?.kind).toBe("ideco");
      expect([monthly(800_000), monthly(1_500_000)]).toEqual([23_000, 30_000]);
      expect(h().goals?.some((g) => JSON.stringify(g).includes("50000"))).toBe(true);
    });
    it("養育費・手当は、足したときの始まりが今月で、今年から表に入る", () => {
      expect(d.notes.seen.childSupportFrom).toBe(d.wh.request.input.baseMonth);
      expect(sum(d.table, "cf.income.other", yearOf(d.wh.request))).toBeGreaterThan(0);
    });
    it("結果の表で、事業所得が「ご本人の事業所得」の行に出る（「その他の収入」に入れない）", () => {
      expect(d.rows.some((r) => r.includes("事業所得"))).toBe(true);
      const defs = rowDefs(d.wh.request);
      const other = defs.find((x) => x.key === "incomeOther")!;
      expect(d.table.some((c) => c.row.startsWith("cf.income.business") && other.match(c))).toBe(false);
    });
    panelChecks(() => d);
    watchChecks(() => d, []);
  });

  describe("世帯③ 60代の夫婦・再雇用と企業年金・完済の持ち家・区分マンション1室・母の介護と相続", () => {
    let d: Done;
    beforeAll(async () => {
      d = await finish("世帯3", await household3(s.page));
    }, 900_000);
    const h = () => d.wh.request.input.household;
    const mother = () => h().members.find((m) => m.kind === "parent")!;

    it("年収 350万円（再雇用）・100万円（パート）が今の働き方に入る", () => {
      const now = h().employmentPeriods!.map((p) => [p.type, (p.salary?.annual?.value ?? 0) + (p.salary?.bonus?.value ?? 0)]);
      expect(now).toContainEqual(["contract", 3_500_000]);
      expect(now).toContainEqual(["partTime", 1_000_000]);
    });
    it("定期便（50歳以上）の加入月数と見込額が入り、年金の見込みが推計から変わる", () => {
      expect(h().pensionRecords?.map((r) => [r.kind, r.months?.basic, r.amounts?.employee?.value])).toEqual([
        ["statementOver50", 480, 1_230_000],
        ["statementOver50", 480, 900_000],
      ]);
      expect(d.notes.seen.pensionCardAfter).not.toBe(d.notes.seen.pensionCardBefore);
    });
    it("区分マンションの家賃（月7万円・空室率5%）が表の家賃収入に出る", () => {
      expect(sum(d.table, "cf.income.other.rental", yearOf(d.wh.request) + 1)).toBe(798_000);
    });
    it("母から相続 1,500万円・預金 2,500万円・課税口座 800万円が入る", () => {
      expect(h().incomeFlows?.find((f) => f.kind === "inheritance")?.amount.value).toBe(15_000_000);
      expect(h().accounts!.filter((a) => a.kind === "deposit" || a.kind === "taxable").map((a) => a.marketValue?.value)).toEqual([25_000_000, 8_000_000]);
    });
    it("パートに変えると、配偶者の年収の推定が正社員の推定から変わる", () => {
      expect(d.notes.seen.spouseAnnualPart).not.toBe(d.notes.seen.spouseAnnualBefore);
    });
    it("定年が計算の基準の月より前の人に、目安の退職一時金を足さない（受け取りが過去）", () => {
      expect(d.notes.seen.retirementCard).not.toMatch(/見込み/);
    });
    it("企業年金を年金で受け取るとき、一時金の欄を未入力に数えない", () => {
      expect(d.notes.seen.retirementCardAfter).not.toContain("未入力");
    });
    it("1995年に建った持ち家を、今買った新築の扱いで評価しない（建物の評価額が新築の額にならない）", () => {
      // 評価額 3,000万円の持ち家（1995年築の木造）。新築の扱いなら建物は土地の割合30%の残りの 2,100万円。今の時価で入れたので、
      // 土地の割合を建った年からの目安（68%）で分け、建物は 1,000万円より少ない
      const own = h().residences!.find((r) => r.kind === "own")!;
      const building = d.table.filter((c) => c.object === own.id && c.row === "cf.balance.account.realEstate.building" && c.year === yearOf(d.wh.request)).reduce((a, c) => a + c.amount, 0);
      expect(building).toBeGreaterThan(0);
      expect(building).toBeLessThan(10_000_000);
    });
    it("収益不動産の取得の年月を Backspace で消しても、取得価額が残る", () => {
      expect(d.notes.seen.acquisitionAfterClear).not.toBe("");
    });
    it("母の亡くなる見込みを直すと、相続の受け取る時期がついてくる", () => {
      expect(d.notes.seen.inheritWhenAfter).not.toBe(d.notes.seen.inheritWhenBefore);
    });
    it("介護を受ける人が亡くなった後は、介護の費用を払わない", () => {
      const leaves = mother().leaves?.memberAge?.years ?? 0;
      const deathYear = Number(mother().birth.birthYearMonth.slice(0, 4)) + leaves;
      const care = d.table.filter((c) => c.row.includes("care") && c.row.startsWith("cf.expense") && c.year > deathYear + 1);
      expect(care).toEqual([]);
    });
    it("結果の表で、企業年金が「企業年金・個人年金」の行に出る（「その他の収入」に入れない）", () => {
      expect(d.rows.some((r) => r.includes("企業年金"))).toBe(true);
    });
    panelChecks(() => d);
    watchChecks(() => d, [
      { rule: "pastRetirementEstimate", match: /db/, what: "定年の後に足した企業年金（年金で受け取る）の一時金の額が、推定0円・受け取りが過去のまま残る" },
    ]);
  });

  describe("世帯④ 賃貸から住宅を買う予定・購入の時期を画面で直す（標準の欄だけ）", () => {
    let d: Done;
    beforeAll(async () => {
      d = await finish("世帯4", await household4(s.page));
    }, 600_000);
    const h = () => d.wh.request.input.household;
    const bought = () => h().residences!.find((r) => r.purchase !== undefined)!;
    const rent = () => h().residences!.find((r) => r.kind === "rent")!;
    const loan = () => h().debts!.find((x) => x.kind === "mortgage")!;

    it("住宅ローンを足す前に購入の時期を直すと、前の賃貸の住み終わりが購入の前の月になり、足したローンの借入の年月は購入の時期", () => {
      expect(d.notes.seen.rentEndAfterFirst).toBe("2030-03");
      expect(d.notes.seen.loanStartAfterAdd).toBe("2030-04");
    });
    it("住宅ローンを足した後に購入の時期を直すと、前の賃貸の住み終わり・借入の年月がついてくる（画面のキー入力で）", () => {
      expect(d.notes.seen.rentEndAfterSecond).toBe("2031-09");
      expect(d.notes.seen.loanStartAfterSecond).toBe("2031-10");
      expect(d.notes.seen.purchasePanel).not.toContain("が違います");
    });
    it("保存した世帯で、購入の時期・購入した家の住み始め・前の賃貸の住み終わり・借入の年月と最初の金利の段・控除の入居がそろう", () => {
      expect(bought().purchase!.at).toEqual({ at: "2031-10" });
      expect(bought().from).toEqual({ at: "2031-10" });
      expect(rent().to).toEqual({ at: "2031-09" });
      expect(loan().start).toEqual({ at: "2031-10" });
      expect(loan().rateSchedule[0]!.from).toEqual({ at: "2031-10" });
      expect(h().events?.find((e) => e.id === loan().housing?.moveIn)?.at).toEqual({ at: "2031-10" });
    });
    it("借入の年月だけを手でずらすと、欄の下に知らせと「購入の時期に合わせる」が出て、押すと借入の年月が購入の時期に戻る", () => {
      expect(d.notes.seen.gapPanel).toContain("購入の時期（2031年10月）と借入の年月（2032年1月）が違います");
      expect(d.notes.seen.loanStartAfterFix).toBe("2031-10");
    });
    it("結果の表で、買う前の年（2030年）に住宅ローンの返済が無く、家賃を払う", () => {
      expect(sum(d.table, "cf.expense.housing.loan", 2030)).toBe(0);
      expect(sum(d.table, "cf.expense.housing.rent", 2030)).toBeGreaterThan(0);
    });
    panelChecks(() => d);
    watchChecks(() => d, []);
  });

  describe("世帯5: 住宅の購入の「どう買うか」（まだ選んでいない → 現金で買う → 住宅ローンを使う。0175）", () => {
    let d: Done;
    beforeAll(async () => {
      d = await finish("世帯5", await household5(s.page));
    }, 600_000);
    const h = () => d.wh.request.input.household;
    it("足した直後はまだ選んでいない: 「どう買うか」が空で、払い方が入っていないと知らせる（黙って現金とみなさない）", () => {
      expect(d.notes.seen.fundingUnselected).toBe("");
      expect(d.notes.seen.unselectedPanel).toContain("払い方が入っていません");
    });
    it("現金で買う: 頭金の欄が消え、保存した世帯は頭金＝物件の価格で住宅ローンが無い。結果の表で購入の年に物件の価格を払う", () => {
      expect(d.notes.seen.downAfterCash).toBe("（欄なし）");
      expect(d.notes.seen.cashPanel).not.toContain("払い方が入っていません");
      const cash = fromBody(d.notes.seen.cashBody!).wh;
      const r = cash.request.input.household.residences!.find((x) => x.purchase !== undefined)!;
      expect(r.purchase!.downPayment).toBe(r.purchase!.price);
      expect((cash.request.input.household.debts ?? []).filter((x) => x.kind === "mortgage")).toEqual([]);
      const y = Number((r.purchase!.at as { at: string }).at.slice(0, 4));
      const t = preview(forEngine(cash.request)).table;
      expect(sum(t, "cf.expense.housing.purchase.downPayment", y)).toBe(r.purchase!.price);
    });
    it("住宅ローンを使う: 同じパネルに借入額の欄が続けて出て、保存した世帯の住宅ローンは物件の価格−頭金を借りる", () => {
      expect(d.notes.seen.principalAfterLoan).not.toBe("（欄なし）");
      const r = h().residences!.find((x) => x.purchase !== undefined)!;
      const loans = (h().debts ?? []).filter((x) => x.kind === "mortgage");
      expect(loans).toHaveLength(1);
      expect(loans[0]!.principal).toBe(r.purchase!.price - (r.purchase!.downPayment ?? 0));
      expect(d.notes.seen.loanPanel).not.toContain("払い方が入っていません");
    });
    panelChecks(() => d);
    watchChecks(() => d, []);
  });

  // 見本の棚の主な世帯: 全部の入力項目のパネルを開いて閉じ、結果のタブまで出す（見本は保存しないので、世帯の中身の確かめはしない）
  describe.each([
    { no: "3-4-01", level: "標準" as const },
    { no: "4-3-01", level: "詳細" as const },
    { no: "5-6-01", level: "詳細" as const },
    { no: "3-5-01", level: "標準" as const },
  ])("見本 $no（$level）", ({ no, level }) => {
    let n: Notes;
    let rows: string[];
    beforeAll(async () => {
      await openSample(s.page, no);
      n = await walkPanels(s.page, level);
      await s.page.click("結果", { exact: true });
      await s.page.until("document.querySelector('table')", "結果のタブの表");
      rows = await s.page.eval<string[]>(`return w.all("table tr").map((r) => w.txt(r.querySelector("th, td") ?? r)).filter((t) => t !== "")`);
      await s.page.shot(SHOTS, `見本${no}_結果`);
      await s.page.click("入力", { exact: true });
    }, 300_000);
    it("全部の入力項目のパネルが開き、結果のタブに表が出る", () => {
      expect(Object.keys(n.panels).length).toBeGreaterThanOrEqual(10);
      expect(rows.some((r) => r.includes("年間収支"))).toBe(true);
    });
    panelChecks(() => n);
  });

  it("画面で JavaScript の例外が出ない", () => {
    expect(s.page.errors).toEqual([]);
  });
});
