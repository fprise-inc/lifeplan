// 帳票の入力の組み立て（report/src/build.ts）: 形（JSON Schema）・内部 ID を含まない・数字がエンジンの出力と一致する
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Ajv2020 } from "ajv/dist/2020.js";
import { describe, expect, it } from "vitest";
import { buildProposalInput, percent } from "../src/build.ts";
import type { ProposalBundle } from "../src/bundle.ts";
import type { ProposalInput } from "../src/input.ts";
import { REPO_DIR, REPORT_DIR } from "../scripts/engine.ts";
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
          const re = byYear(run.result, (c) => c.row === "cf.balance.account.realEstate");
          const debt = byYear(run.result, (c) => c.row.startsWith("cf.balance.debt."));
          view.points.forEach((p, i) => {
            const total = line(view.assets, "資産の合計")!.amounts[i]!;
            const liab = line(view.liabilities, "負債の合計")!.amounts[i]!;
            expect(total).toBe(liab + view.netWorth[i]!);
            const short = line(view.liabilities, "預金の不足")?.amounts[i] ?? 0;
            expect(line(view.assets, "金融資産")!.amounts[i]! - short).toBe(fin.get(p.year) ?? 0);
            expect(line(view.assets, "不動産")!.amounts[i]).toBe(re.get(p.year) ?? 0);
            expect(liab - short).toBe(debt.get(p.year) ?? 0);
            // 内訳の合計は金融資産
            expect(view.assets.filter((l) => l.kind === "sub").reduce((s2, l) => s2 + l.amounts[i]!, 0)).toBe(line(view.assets, "金融資産")!.amounts[i]);
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
          expect(c.assets.map((b) => b.key).every((k) => ["liquid", "market", "locked", "illiquid"].includes(k))).toBe(true);
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
