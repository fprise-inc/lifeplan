// 帳票の入力の組み立て（report/src/build.ts）: 形（JSON Schema）・内部 ID を含まない・数字がエンジンの出力と一致する
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Ajv2020 } from "ajv/dist/2020.js";
import { describe, expect, it } from "vitest";
import { buildProposalInput, percent } from "../src/build.ts";
import type { EngineRequest, ProposalBundle, Run } from "../src/bundle.ts";
import type { ProposalInput } from "../src/input.ts";
import { REPO_DIR, REPORT_DIR, run } from "../scripts/engine.ts";
import { SAMPLES } from "../scripts/sampleBundles.ts";
import { byYear, ROWS, UUID } from "./helpers.ts";

const schema = JSON.parse(readFileSync(join(REPORT_DIR, "schema", "proposal-input.schema.json"), "utf8")) as object;
const validate = new Ajv2020({ allErrors: true, strict: true }).compile(schema);

const built: { id: string; bundle: ProposalBundle; input: ProposalInput }[] = SAMPLES.map((s) => {
  const bundle = s.bundle();
  return { id: s.id, bundle, input: buildProposalInput(bundle) };
});

describe("帳票の入力", () => {
  for (const { id, bundle, input } of built) {
    describe(id, () => {
      it("JSON Schema に合う", () => {
        const ok = validate(input);
        expect(validate.errors ?? []).toEqual([]);
        expect(ok).toBe(true);
      });

      it("世帯の内部 ID（構成員・物の ID）を含まない", () => {
        expect(JSON.stringify(input)).not.toMatch(UUID);
      });

      it("金額はすべて円の整数", () => {
        const walk = (v: unknown): void => {
          if (typeof v === "number") expect(Number.isSafeInteger(v)).toBe(true);
          else if (Array.isArray(v)) v.forEach(walk);
          else if (v !== null && typeof v === "object") Object.values(v).forEach(walk);
        };
        walk(input);
      });

      it("キャッシュフロー表の合計の行と金融資産の推移がエンジンの出力と一致する", () => {
        for (const [side, run] of [["current", bundle.current], ["proposal", bundle.proposal]] as const) {
          const keys: Record<string, string> = { 収入合計: "incomeTotal", 支出合計: "expenseTotal", 年間収支: "net", 金融資産残高: "financial" };
          for (const [label, pred] of Object.entries(ROWS)) {
            const want = byYear(run.result, pred);
            const row = input.cashflow[side].rows.find((r) => r.key === keys[label]);
            expect(row?.cells).toEqual(input.basis.years.map((y) => want.get(y) ?? null));
          }
          const fin = byYear(run.result, ROWS.金融資産残高 as never);
          expect(input.assets[side]).toEqual(input.basis.years.map((y) => fin.get(y) ?? 0));
          expect(input.summary[side].totals).toEqual(run.result.summary.totals);
          expect(input.summary[side].financialAtTarget).toBe(fin.get(input.summary.target.year));
        }
        expect(input.summary.diffAtTarget).toBe(input.summary.proposal.financialAtTarget - input.summary.current.financialAtTarget);
      });

      it("バランスシート: 資産の合計＝負債の合計＋純資産。金融資産は金融資産残高、不動産・負債はエンジンの行のまま", () => {
        const views = [
          { view: input.basics.balance, run: bundle.current },
          ...(input.balanceSheet !== null ? [{ view: input.balanceSheet.proposal, run: bundle.proposal }] : []),
        ];
        expect(input.balanceSheet).not.toBeNull();
        for (const { view, run } of views) {
          const line = (list: typeof view.assets, label: string) => list.find((l) => l.label === label);
          const fin = byYear(run.result, (c) => c.row === "cf.balance.financial");
          // 不動産は土地と建物の行に分けて出る（合計は cf.balance.account.realEstate の下の行の合計）
          const re = byYear(run.result, (c) => c.row === "cf.balance.account.realEstate" || c.row.startsWith("cf.balance.account.realEstate."));
          /** 項目の直後の内訳（次の項目まで） */
          const subsOf = (list: typeof view.assets, label: string) => {
            const i0 = list.findIndex((l) => l.label === label);
            const out: typeof view.assets = [];
            for (let k = i0 + 1; k < list.length && list[k]!.kind === "sub"; k++) out.push(list[k]!);
            return out;
          };
          const debt = byYear(run.result, (c) => c.row.startsWith("cf.balance.debt."));
          view.points.forEach((p, i) => {
            const total = line(view.assets, "資産の合計")!.amounts[i]!;
            const liab = line(view.liabilities, "負債の合計")!.amounts[i]!;
            expect(total).toBe(liab + view.netWorth[i]!);
            const short = line(view.liabilities, "預金の不足")?.amounts[i] ?? 0;
            expect(line(view.assets, "金融資産")!.amounts[i]! - short).toBe(fin.get(p.year) ?? 0);
            expect(line(view.assets, "不動産")!.amounts[i]).toBe(re.get(p.year) ?? 0);
            expect(liab - short).toBe(debt.get(p.year) ?? 0);
            // 内訳の合計は金融資産・不動産（土地＋建物）
            expect(subsOf(view.assets, "金融資産").reduce((s2, l) => s2 + l.amounts[i]!, 0)).toBe(line(view.assets, "金融資産")!.amounts[i]);
            const reSubs = subsOf(view.assets, "不動産");
            if (reSubs.length > 0) expect(reSubs.reduce((s2, l) => s2 + l.amounts[i]!, 0)).toBe(line(view.assets, "不動産")!.amounts[i]);
          });
        }
        const bs = input.balanceSheet!;
        // 図（今・退職の年・75歳）: 箱の合計は左右で同じ（資産の合計＝負債の合計＋純資産）、純資産は抜粋の表と同じ年の値
        const fig = bs.figure;
        expect(fig.columns.length).toBeGreaterThanOrEqual(2);
        expect(fig.columns.length).toBeLessThanOrEqual(3);
        expect(fig.columns[0]).toMatchObject({ fact: true, point: { label: "今" } });
        expect(fig.columns.slice(1).every((c) => !c.fact)).toBe(true);
        for (const c of fig.columns) {
          const left = c.assets.reduce((s2, b) => s2 + b.amount, 0) + c.negative;
          const right = c.liabilities.reduce((s2, b) => s2 + b.amount, 0);
          expect(left).toBe(right);
          expect(c.assets.reduce((s2, b) => s2 + b.amount, 0)).toBe(c.totalAssets);
          expect(c.totalAssets).toBe(c.totalLiabilities + c.netWorth);
          expect(fig.scale).toBeGreaterThanOrEqual(Math.max(c.totalAssets, c.totalLiabilities));
          // 換金しにくい資産は土地・建物・車・その他の箱に分ける
          expect(c.assets.map((b) => b.key).every((k) => ["liquid", "market", "locked", "land", "building", "illiquidOther"].includes(k))).toBe(true);
          const landBox = c.assets.find((b) => b.key === "land")?.amount ?? 0;
          const buildingBox = c.assets.find((b) => b.key === "building")?.amount ?? 0;
          const t = bundle.proposal.result.table;
          const cell = (row: string) => t.filter((x) => x.row === row && x.year === c.point.year).reduce((s2, x) => s2 + x.amount, 0);
          expect(landBox).toBe(cell("cf.balance.account.realEstate.land"));
          expect(buildingBox).toBe(cell("cf.balance.account.realEstate.building"));
          const k = bs.proposal.points.findIndex((p) => p.year === c.point.year);
          expect(k).toBeGreaterThanOrEqual(0);
          expect(bs.proposal.netWorth[k]).toBe(c.netWorth);
        }
        expect(bs.netWorth.proposal).toHaveLength(input.basis.years.length);
        const years = bs.proposal.points.map((p) => p.year);
        expect([...years].sort((a, b) => a - b)).toEqual(years);
        expect(new Set(years).size).toBe(years.length);
        expect(bs.proposal.points[0]).toMatchObject({ label: "今" });
        // 抜粋の純資産は推移の同じ年の値
        bs.proposal.points.forEach((p, i) => {
          const k = input.basis.years.indexOf(p.year);
          if (k >= 0) {
            expect(bs.netWorth.proposal[k]).toBe(bs.proposal.netWorth[i]);
            expect(bs.netWorth.current[k]).toBe(bs.currentNetWorth[i]);
          }
        });
      });

      // 資産運用の見本（0026）は FP顧問料・打ち手ごとの効果を持たない
      it.skipIf(bundle.investment !== undefined)("FP顧問料の累計はエンジンの要約（summary.advisoryFee）のまま", () => {
        const fee = bundle.proposal.result.summary.advisoryFee;
        expect(fee?.total).toBeGreaterThan(0);
        expect(input.assumptions.advisoryFee?.total).toBe(fee?.total);
        expect(input.changes.fee?.total).toBe(fee?.total);
        expect(input.changes.fee?.diffAtTarget).toBe(input.summary.diffAtTarget);
      });

      it("提案での変更点の表に FP顧問料の累計の行は出さない（顧問料は目立たせない）", () => {
        expect(input.changes.metrics.map((m) => m.label).join("・")).not.toContain("顧問料");
      });

      it.skipIf(bundle.investment !== undefined)("打ち手ごとの効果の累計の最後は、提案と現状の差", () => {
        const steps = input.changes.steps ?? [];
        expect(steps.length).toBeGreaterThan(0);
        expect(steps.at(-1)?.cumulative).toBe(input.summary.diffAtTarget);
        expect(steps.reduce((s, x) => s + x.effect, 0)).toBe(input.summary.diffAtTarget);
      });
    });
  }

  it("資産運用（0026）: 口座ごとの推移は器ごとの残高の行の足し算、内訳は同じ年、相場が下がった場合の線は型を重ねた計算の金融資産のまま", () => {
    const { bundle, input } = built.find((b) => b.id === "investmentCouple") as (typeof built)[number];
    const inv = input.investment;
    expect(inv).not.toBeNull();
    expect(inv?.lasts.proposal).toMatch(/^\d+歳まで持つ$/);
    const years = input.basis.years;
    const fin = byYear(bundle.proposal.result as never, (c) => c.row === "cf.balance.financial");
    // 預金が不足しない年は、口座ごとの合計＝金融資産の合計
    const i = years.findIndex((y) => (fin.get(y) ?? 0) > 0);
    expect((inv?.accounts ?? []).reduce((s, a) => s + (a.values[i] ?? 0), 0)).toBe(fin.get(years[i] as number));
    expect(inv?.donut.year).toBe(bundle.investment?.donutYear);
    expect(inv?.donut.proposal.reduce((s, x) => s + x.amount, 0)).toBe(fin.get(inv?.donut.year as number));
    const md = input.marketDrop;
    expect(md?.lines.length).toBe(3);
    const first = byYear(bundle.investment?.stress?.[0]?.run.result as never, (c) => c.row === "cf.balance.financial");
    expect(md?.lines[0]?.values).toEqual(years.map((y) => first.get(y) ?? 0));
  });

  it("会社員の夫婦: 必要保障額・万一・繰下げ・住宅ローン・教育費・保険がエンジンの出力のまま", () => {
    const { bundle, input } = built.find((b) => b.id === "salariedCoupleTwoKids") as (typeof built)[number];
    const prot = bundle.protection?.result.protection;
    expect(input.contingency?.protection.map((p) => p.needWithAssets)).toEqual(prot?.members.map((m) => m.years.map((y) => y.needWithAssets)));
    expect(input.contingency?.protection.map((p) => p.coverage)).toEqual(prot?.members.map((m) => m.years.map((y) => y.coverage)));
    const death = bundle.contingencies?.[0]?.run.result;
    const surv = byYear(death as never, (c) => c.row === "cf.income.pension.survivor");
    expect(input.contingency?.scenarios[0]?.survivorPensionTotal).toBe([...surv.entries()].filter(([y]) => input.basis.years.includes(y)).reduce((s, [, v]) => s + v, 0));
    expect(input.contingency?.scenarios[0]?.notices.length).toBe(1);
    expect(input.assumptions.survivorReform).toBe(true);
    expect(input.retirement?.deferral?.options.map((o) => o.label)).toEqual(["65歳から受け取る", "70歳から受け取る"]);
    expect(input.housingLoan).not.toBeNull();
    expect(input.education?.grandTotal).toBe([...byYear(bundle.proposal.result, (c) => c.row.startsWith("cf.expense.education")).entries()].filter(([y]) => input.basis.years.includes(y)).reduce((s, [, v]) => s + v, 0));
    expect(input.insurance?.contracts[0]?.status).toBe("継続");
    expect(input.changes.fee?.diffWithoutFee).not.toBeNull();
  });

  it("FP顧問料の提案: 運用の前提の変更を除いた効果（運用の利回りの仮定だけで顧問料を上回って見せない）は、運用の前提の手前までの累計", () => {
    const { input } = built.find((b) => b.id === "advisoryFeeProposal") as (typeof built)[number];
    const steps = input.changes.steps ?? [];
    expect(steps.map((s) => s.investment)).toEqual([false, true]);
    expect(input.changes.excludingInvestment).toBe(steps[0]?.cumulative);
    expect(input.changes.excludingInvestment).toBeLessThan(0);
    expect(input.contingency).toBeNull();
  });

  it("Rust のテストの入力（crates/report-pdf/tests/fixtures）も JSON Schema に合う", () => {
    const fx = JSON.parse(readFileSync(join(REPO_DIR, "crates", "report-pdf", "tests", "fixtures", "advisoryFeeProposal.input.json"), "utf8")) as unknown;
    expect(validate(fx)).toBe(true);
    expect(JSON.stringify(fx)).not.toMatch(UUID);
  });
});

describe("住まい以外の不動産（家賃収入・経費・土地と建物）", () => {
  const b = built.find((x) => x.id === "dualAssetsTwoKids");
  it("キャッシュフロー表に「家賃収入」「不動産の経費」の行があり、エンジンの行の合計と一致する。その他の収入・支出には入れない", () => {
    expect(b).toBeDefined();
    const { bundle, input } = b!;
    for (const [side, run] of [["current", bundle.current], ["proposal", bundle.proposal]] as const) {
      const rows = input.cashflow[side].rows;
      const rent = byYear(run.result, (c) => c.row === "cf.income.other.rental");
      const exp = byYear(run.result, (c) => c.row === "cf.expense.other.realEstate");
      expect(rows.find((r) => r.key === "rent")?.cells).toEqual(input.basis.years.map((y) => rent.get(y) ?? null));
      expect(rows.find((r) => r.key === "realEstateExpense")?.cells).toEqual(input.basis.years.map((y) => exp.get(y) ?? null));
      expect([...rent.values()].some((v) => v > 0)).toBe(true);
    }
    // 提案（60歳の年に売る）は、売った後に家賃収入が無い
    const sold = byYear(bundle.proposal.result, (c) => c.row === "cf.income.other.rental");
    expect(sold.get(2045) ?? 0).toBe(0);
    expect(byYear(bundle.current.result, (c) => c.row === "cf.income.other.rental").get(2045)).toBeGreaterThan(0);
  });

  it("バランスシートの表の不動産は土地と建物の内訳を持ち、建物は年とともに減り土地は残る", () => {
    const { input } = b!;
    const assets = input.balanceSheet!.proposal.assets;
    const land = assets.find((l) => l.label === "土地")!;
    const building = assets.find((l) => l.label === "建物")!;
    expect(land.kind).toBe("sub");
    expect(building.amounts.at(-1)!).toBeLessThan(building.amounts[0]!);
    expect(land.amounts.at(-1)!).toBeGreaterThan(0);
  });
});

describe("住まい以外の不動産の物件ごとの数字（独自帳票の材料）", () => {
  const b = built.find((x) => x.id === "dualAssetsTwoKids")!;
  const { bundle, input } = b;
  const re = input.realEstate!;
  const sides = [["current", bundle.current], ["proposal", bundle.proposal]] as const;
  const objectsOf = (run: Run) => (run.request.input.household.accounts ?? []).filter((a) => a.kind === "realEstate" && a.property !== undefined).map((a) => a.id);

  it("物件ごとの家賃収入・経費の合計が、キャッシュフロー表の「家賃収入」「不動産の経費」の行と一致する。手残り＝家賃収入−経費−返済額", () => {
    for (const [side] of sides) {
      const props = re[side];
      expect(props.length).toBe(1);
      const rows = input.cashflow[side].rows;
      for (const [key, k] of [["rent", "rent"], ["realEstateExpense", "expenses"]] as const) {
        const want = rows.find((r) => r.key === key)!.cells.map((v) => v ?? 0);
        expect(input.basis.years.map((_, i) => props.reduce((s, p) => s + (p.years[i]?.[k] ?? 0), 0))).toEqual(want);
      }
      for (const p of props) {
        expect(p.years.map((y) => y.year)).toEqual(input.basis.years);
        for (const y of p.years) expect(y.cashAfterLoan).toBe(y.rent - y.expenses - y.loanRepayment);
        expect(p.totals.rent).toBe(p.years.reduce((s, y) => s + y.rent, 0));
        expect(p.totals.cashAfterLoan).toBe(p.years.reduce((s, y) => s + y.cashAfterLoan, 0));
      }
    }
  });

  it("評価額は表の土地と建物の行の物件の分、借入の残高と返済額はその物件を指す負債の行の分と一致する", () => {
    for (const [side, run] of sides) {
      const [id] = objectsOf(run);
      const loans = (run.request.input.household.debts ?? []).filter((d) => d.property === id).map((d) => d.id);
      expect(loans.length).toBe(1);
      const land = byYear(run.result, (c) => c.object === id && c.row === "cf.balance.account.realEstate.land");
      const building = byYear(run.result, (c) => c.object === id && c.row === "cf.balance.account.realEstate.building");
      const balance = byYear(run.result, (c) => loans.includes(c.object ?? "") && c.row.startsWith("cf.balance.debt"));
      const pay = byYear(run.result, (c) => loans.includes(c.object ?? "") && c.row.startsWith("cf.expense"));
      const p = re[side][0]!;
      p.years.forEach((y) => {
        expect(y.value === null ? null : [y.value.land, y.value.building, y.value.total]).toEqual(land.has(y.year) ? [land.get(y.year), building.get(y.year), (land.get(y.year) ?? 0) + (building.get(y.year) ?? 0)] : null);
        expect(y.held).toBe(y.value !== null);
        expect(y.loanBalance).toBe(balance.get(y.year) ?? 0);
        expect(y.loanRepayment).toBe(pay.get(y.year) ?? 0);
      });
      expect(p.owner).toEqual({ key: "self", label: "ご本人" });
      expect(p).toMatchObject({ key: "property1", label: "不動産1", use: "rental", structure: { key: "rc", label: "鉄筋コンクリート造" }, builtYear: 2008, acquisition: { price: 21000000, month: "2016-03" } });
    }
  });

  it("不動産所得の内訳はエンジンの出力のまま（不動産所得＝家賃収入−経費−減価償却費−利息）。貸していない年は null", () => {
    for (const [side, run] of sides) {
      const d = run.result.summary.realEstate![0]!;
      for (const y of re[side][0]!.years) {
        const e = d.income.find((x) => x.year === y.year);
        if (e === undefined) {
          expect([y.depreciation, y.interest, y.landInterest, y.income]).toEqual([null, null, null, null]);
          continue;
        }
        expect([y.depreciation, y.interest, y.landInterest, y.income]).toEqual([e.depreciation, e.interest, e.landInterest, e.income]);
        expect(e.income).toBe(e.rent - e.expenses - e.depreciation - e.interest);
        expect(e.rent).toBe(y.rent);
      }
    }
    expect(re.current[0]!.years.every((y) => y.income !== null)).toBe(true);
  });

  it("売却（提案は60歳の年に売る）: 手取りは表の一時金の収入の行と一致し、売った年の年末から持っていない。税の額の口は無い（null）", () => {
    expect(re.current[0]!.sale).toBeNull();
    const s = re.proposal[0]!.sale!;
    const year = Number(s.month.slice(0, 4));
    expect(s.proceeds).toBe(s.price - s.costs);
    expect(s.tax).toBeNull();
    expect(byYear(bundle.proposal.result, (c) => c.row === "cf.income.lumpSum.realEstateSale").get(year)).toBe(s.proceeds);
    const y = re.proposal[0]!.years;
    expect(y.find((x) => x.year === year - 1)?.held).toBe(true);
    expect(y.filter((x) => x.year >= year).every((x) => !x.held && x.loanBalance === 0)).toBe(true);
    expect(y.filter((x) => x.year > year).every((x) => x.rent === 0 && x.income === null)).toBe(true);
  });

  it("持っていない世帯・中身を入れていない不動産では空の配列。案の比較の各案にも物件ごとの数字が入る", () => {
    for (const x of built.filter((v) => v.id !== "dualAssetsTwoKids")) {
      const r = x.input.realEstate!;
      expect([r.current, r.proposal, ...r.plans.map((p) => p.properties)].every((ps) => ps.length === 0)).toBe(true);
      expect(r.plans.length).toBe(x.input.comparison?.columns.length ?? 0);
    }
    const strip = (r: Run): EngineRequest => {
      const q = structuredClone(r.request);
      for (const a of q.input.household.accounts ?? []) if (a.kind === "realEstate") delete (a as { property?: unknown }).property;
      return q;
    };
    const none = buildProposalInput({ ...bundle, current: run(strip(bundle.current)), proposal: run(strip(bundle.proposal)) });
    expect(none.realEstate).toEqual({ current: [], proposal: [], plans: [] });
    expect(validate(none)).toBe(true);
    const compared = buildProposalInput({ ...bundle, comparison: { base: 0, plans: [{ letter: "現", name: "現状", run: bundle.current }, { letter: "A", name: "売る", run: bundle.proposal }] } });
    expect(compared.realEstate!.plans.map((p) => [p.letter, p.properties.length])).toEqual([["現", 1], ["A", 1]]);
    expect(compared.realEstate!.plans[1]!.properties).toEqual(re.proposal);
    expect(validate(compared)).toBe(true);
    expect(JSON.stringify(compared.realEstate)).not.toMatch(UUID);
  });
});

describe("バランスシートの図の時点（画面の「資産と負債」のタブで並べている時点）", () => {
  const s = SAMPLES.find((x) => x.id === "dualAssetsTwoKids")!;
  const bundle = s.bundle();
  const base = Number(bundle.proposal.request.input.baseMonth.slice(0, 4));
  const self = bundle.proposal.request.input.household.members.find((m) => m.kind === "self")!;
  const birthY = Number(self.birth.birthYearMonth.slice(0, 4));
  const last = buildProposalInput(bundle).basis.years.at(-1)!;
  const years = (bs: ProposalInput["balanceSheet"]) => bs!.figure.columns.map((c) => c.point.year);

  it("並べ方を変えていない（時点の指定なし）: 今・退職の年・75歳。抜粋の表は今・10年後・退職の年・75歳・目標の年", () => {
    const input = buildProposalInput(bundle);
    const bs = input.balanceSheet!;
    const labels = bs.figure.columns.map((c) => c.point.label);
    expect(labels[0]).toBe("今");
    expect(labels[1]).toMatch(/^退職の年（ご本人\d+歳）$/);
    expect(labels[2]).toBe("ご本人75歳");
    expect(years(bs)[0]).toBe(base);
    expect(years(bs)[2]).toBe(birthY + 75);
    expect(bs.proposal.points.map((p) => p.year)).toEqual([base, base + 10, years(bs)[1], birthY + 75, input.summary.target.year]);
  });

  it("時点を変えた世帯: 図の年が並べた時点になり（年の順・同じ年は1つ・表の範囲の中）、抜粋の表は図の時点と目標の年を必ず含む", () => {
    const chosen = [
      { year: birthY + 85, name: "85歳" },
      { year: base + 8, name: "ローン完済" },
      { year: base, name: "今" },
      { year: birthY + 68, name: null },
    ];
    const input = buildProposalInput({ ...bundle, balancePoints: chosen });
    const bs = input.balanceSheet!;
    expect(years(bs)).toEqual([base, base + 8, birthY + 68, birthY + 85]);
    expect(bs.figure.columns.map((c) => c.point.label)).toEqual(["今", `ローン完済（ご本人${base + 8 - birthY}歳）`, "ご本人68歳", "ご本人85歳"]);
    expect(bs.figure.columns.map((c) => c.fact)).toEqual([true, false, false, false]);
    const table = bs.proposal.points.map((p) => p.year);
    for (const y of [...years(bs), input.summary.target.year]) expect(table).toContain(y);
    expect(table.length).toBeLessThanOrEqual(5);
    // 図の純資産は抜粋の表の同じ年の値
    for (const c of bs.figure.columns) expect(bs.proposal.netWorth[table.indexOf(c.point.year)]).toBe(c.netWorth);
    expect(validate(input)).toBe(true);
  });

  it("時点が2つなら図は2つ、抜粋の表は10年後で5列まで埋める。範囲の外・重なり・5つ目以降は落とす", () => {
    const two = buildProposalInput({ ...bundle, balancePoints: [{ year: base, name: "今" }, { year: birthY + 65, name: "65歳" }, { year: birthY + 65, name: "退職の年" }, { year: last + 5, name: "90歳" }] });
    expect(years(two.balanceSheet)).toEqual([base, birthY + 65]);
    expect(two.balanceSheet!.proposal.points.map((p) => p.year)).toEqual([...new Set([base, base + 10, birthY + 65, two.summary.target.year])].sort((a, b) => a - b));
    const many = buildProposalInput({ ...bundle, balancePoints: [0, 5, 10, 15, 20].map((d) => ({ year: base + d, name: null })) });
    expect(years(many.balanceSheet)).toEqual([base, base + 5, base + 10, base + 15]);
    // 表の範囲に1つも無ければ、既定（今・退職の年・75歳）
    const none = buildProposalInput({ ...bundle, balancePoints: [{ year: last + 1, name: null }] });
    expect(years(none.balanceSheet)).toEqual(years(buildProposalInput(bundle).balanceSheet));
  });
});

describe("百分率の書式（数としては計算しない）", () => {
  it.each([
    ["0.01", "1%"],
    ["0.004", "0.4%"],
    ["0.0065", "0.65%"],
    ["0.7", "70%"],
    ["1", "100%"],
    ["0.125", "12.5%"],
    ["-0.02", "−2%"],
  ])("%s → %s", (a, b) => expect(percent(a)).toBe(b));
});

describe("黒字のうち貯まる割合（0031）", () => {
  const base = SAMPLES[0]!.bundle();
  const src = structuredClone(base.proposal.request);
  const req = { ...src, input: { ...src.input, assumptions: { ...src.input.assumptions, surplusSaving: { ratio: "0.6", changes: [{ from: { at: "2040-04" }, ratio: "0.8" }] } } } };
  const bundle: ProposalBundle = { ...base, proposal: run(req) };
  const input = buildProposalInput(bundle);

  it("キャッシュフロー表に「ゆとりの支出」の行。基本生活費には混ぜない。合計はエンジンの出力と一致。生活防衛資金の行は無い", () => {
    const rows = input.cashflow.proposal.rows;
    const spend = rows.find((r) => r.key === "surplusSpend");
    expect(spend?.label).toBe("ゆとりの支出");
    expect(spend?.cells).toEqual(input.basis.years.map((y) => byYear(bundle.proposal.result, (c) => c.row === "cf.expense.living.surplus").get(y) ?? null));
    expect(rows.some((r) => r.key === "reserve")).toBe(false);
    const living = rows.find((r) => r.key === "living")!;
    const y = input.basis.years.find((yy, i) => (spend?.cells[i] ?? 0) !== 0)!;
    const i = input.basis.years.indexOf(y);
    const allLiving = byYear(bundle.proposal.result, (c) => c.row.startsWith("cf.expense.living") && !c.row.startsWith("cf.expense.living.car")).get(y) ?? 0;
    expect(living.cells[i]).toBeLessThan(allLiving);
    expect(input.cashflow.current.rows.some((r) => r.key === "surplusSpend")).toBe(false);
    expect(validate(input)).toBe(true);
  });

  it("前提の一覧に割合（期間で変える組つき）。不足する年は金融資産で判定する", () => {
    const labels = input.assumptions.rates.map((r) => `${r.label}:${r.value}`).join("\n");
    expect(labels).toContain("黒字のうち貯まる割合:60%、2040年から80%");
    expect(labels).not.toContain("生活防衛資金");
    const fin = byYear(bundle.proposal.result, (c) => c.row === "cf.balance.financial");
    const dep = input.basis.years.find((yy) => (fin.get(yy) ?? 0) < 0) ?? null;
    expect(input.summary.proposal.depletion?.year ?? null).toBe(dep);
  });
});
