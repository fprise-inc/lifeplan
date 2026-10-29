// お金の行の欄の直し（0044 の追記 2026-10-29）: 種類ごとの表の行の選択肢・前に選んだ行の残し方・相手の欄を出す種類・必要経費の欄の名前
import { describe, expect, it } from "vitest";
import { INCOME_KIND_DEFAULTS } from "../../engine/src/sdk/incomeKinds.ts";
import type { IncomeFlow, IncomeFlowKind, MoneyOutKind, PeriodicExpense } from "../src/engine/types.ts";
import { allFields, type FieldDef, type StageId } from "../src/workspace/input/form.ts";
import { fromRequest, mutate, type WorkingHousehold } from "../src/workspace/input/household.ts";
import {
  addExpense,
  addIncome,
  expenseCard,
  expenseRowChoices,
  incomeCard,
  incomeRowChoices,
  INCOME_KINDS,
  IN_ROWS,
  IN_ROWS_BY_KIND,
  LEGACY_ROW_SUFFIX,
  OUT_KINDS,
  OUT_ROWS,
  OUT_ROWS_BY_KIND,
  type MoneyCard,
} from "../src/workspace/input/moneyRows.ts";
import { buildStage } from "../src/workspace/input/stages/index.ts";
import { premiumLabel } from "../src/workspace/input/stages/insurance.ts";
import { modelHousehold, preview } from "./helpers.ts";

const stageOf = (c: MoneyCard): StageId => (c === "inherit" ? "inheritance" : c);
const wh0 = (): WorkingHousehold => fromRequest(modelHousehold("dualNoKids"), {});
const lastIncome = (w: WorkingHousehold): IncomeFlow => (w.request.input.household.incomeFlows ?? []).at(-1)!;
const lastExpense = (w: WorkingHousehold): PeriodicExpense => (w.request.input.household.periodicExpenses ?? []).at(-1)!;
const fieldsOf = (w: WorkingHousehold, card: MoneyCard): FieldDef[] => allFields(buildStage(stageOf(card), w));
const fieldOf = (w: WorkingHousehold, card: MoneyCard, key: string): FieldDef | undefined => fieldsOf(w, card).find((f) => f.key === key);
const optionsOf = (f: FieldDef | undefined): string[] => (f !== undefined && f.kind === "select" ? f.options.map((o) => o.value) : []);

describe("表の行の選択肢は種類ごと", () => {
  it("どの種類も、既定の行（1回・くり返し）を含み、エンジンの表の行の一覧の中だけ", () => {
    const inAll = IN_ROWS.map((o) => o.value);
    for (const k of INCOME_KINDS) {
      const list = IN_ROWS_BY_KIND[k.kind] ?? inAll;
      const d = INCOME_KIND_DEFAULTS[k.kind];
      expect(list, k.kind).toContain(d.once);
      expect(list, k.kind).toContain(d.repeat);
      for (const r of list) expect(inAll, `${k.kind}: ${r}`).toContain(r);
    }
    const outAll = OUT_ROWS.map((o) => o.value);
    for (const k of OUT_KINDS) {
      const list = OUT_ROWS_BY_KIND[k.kind] ?? outAll;
      expect(list, k.kind).toContain(k.row);
      for (const r of list) expect(outAll, `${k.kind}: ${r}`).toContain(r);
    }
  });

  it("副業・雑所得は「副業」と「その他の収入」だけ。その他の入金は全部", () => {
    expect(incomeRowChoices({ kind: "sideJob" }).map((o) => o.label)).toEqual(["その他の収入", "副業"]);
    expect(incomeRowChoices({ kind: "other" }).length).toBe(IN_ROWS.length);
    expect(expenseRowChoices({ kind: "general" }).length).toBe(OUT_ROWS.length);
    expect(expenseRowChoices({}).length).toBe(OUT_ROWS.length);
  });

  it("画面の欄: 足した行の「キャッシュフロー表の行」は種類の一覧", () => {
    for (const k of INCOME_KINDS) {
      const w = addIncome(wh0(), k.kind);
      const f = lastIncome(w);
      const row = fieldOf(w, incomeCard(f), `in/${f.id}/row`);
      expect(optionsOf(row), k.kind).toEqual(incomeRowChoices({ kind: k.kind }).map((o) => o.value));
    }
    for (const k of OUT_KINDS) {
      const w = addExpense(wh0(), k.kind);
      const p = lastExpense(w);
      const row = fieldOf(w, expenseCard(w.request.input.household, p), `ev/${p.id}/row`);
      expect(optionsOf(row), k.kind).toEqual(expenseRowChoices({ kind: k.kind }).map((o) => o.value));
    }
  });

  it("前に選んだ、今は選べない行はそのまま残して見せ（添え書き付き）、計算もそのまま", () => {
    const w = mutate(addIncome(wh0(), "sideJob"), (h) => {
      const f = (h.incomeFlows ?? []).at(-1)!;
      f.row = "cf.income.pension";
      f.amount = { value: 30000, state: "confirmed", origin: { kind: "manual" } };
    });
    const f = lastIncome(w);
    const row = fieldOf(w, "work", `in/${f.id}/row`)!;
    expect(row.get(w).value).toBe("cf.income.pension");
    const opt = row.kind === "select" ? row.options.find((o) => o.value === "cf.income.pension") : undefined;
    expect(opt?.label.endsWith(LEGACY_ROW_SUFFIX)).toBe(true);
    expect(row.help).toContain("前に選んだ行");
    expect(f.row).toBe("cf.income.pension");
    expect(() => preview(w.request)).not.toThrow();
  });

  it("種類を選び直すと、その種類で選べない行は外す（既定の行に戻る）。選べる行は残す", () => {
    const w = mutate(addIncome(wh0(), "otherWork"), (h) => void ((h.incomeFlows ?? []).at(-1)!.row = "cf.income.salary"));
    const f = lastIncome(w);
    const kind = fieldOf(w, "work", `in/${f.id}/kind`)!;
    const w2 = kind.set(w, "sideJob" satisfies IncomeFlowKind);
    expect(lastIncome(w2).kind).toBe("sideJob");
    expect(lastIncome(w2).row).toBeUndefined();
    const w3 = mutate(addIncome(wh0(), "otherWork"), (h) => void ((h.incomeFlows ?? []).at(-1)!.row = "cf.income.other"));
    const g = lastIncome(w3);
    const w4 = fieldOf(w3, "work", `in/${g.id}/kind`)!.set(w3, "sideJob");
    expect(lastIncome(w4).row).toBe("cf.income.other");
    // 出るお金（表の行を必ず持つ）は、その種類の既定の行にする
    const e = addExpense(wh0(), "repair");
    const p = lastExpense(e);
    const e2 = mutate(e, (h) => void ((h.periodicExpenses ?? []).at(-1)!.row = "cf.expense.housing.maintenance"));
    const kindOut = fieldOf(e2, "housing", `ev/${p.id}/kind`);
    if (kindOut !== undefined && kindOut.kind === "select" && kindOut.options.length > 1) {
      const other = kindOut.options.find((o) => o.value !== "repair")!.value as MoneyOutKind;
      const e3 = kindOut.set(e2, other);
      const allowed = OUT_ROWS_BY_KIND[other] ?? OUT_ROWS.map((o) => o.value);
      expect(allowed).toContain(lastExpense(e3).row);
    }
  });
});

describe("相手（誰から・誰へ）は、人から来る（人へ行く）種類だけ", () => {
  it("副業・その他の働く収入・年金・給付などには出さない（受け取る人・伸び方…のまとまりの名前からも外す）", () => {
    for (const kind of ["sideJob", "otherWork", "saleBusiness", "unemployment", "survivorPension", "foreignPension", "benefit"] as IncomeFlowKind[]) {
      const w = addIncome(wh0(), kind);
      const f = lastIncome(w);
      const card = incomeCard(f);
      expect(fieldOf(w, card, `in/${f.id}/counterparty`), kind).toBeUndefined();
      const g = buildStage(stageOf(card), w).sections.flatMap((s) => s.groups).find((x) => x.key === `in/${f.id}/who`);
      expect(g?.title, kind).toBe("受け取る人・伸び方・万一のときの扱い・表の行");
    }
  });
  it("援助・仕送り・相続・贈与・その他の入金には出す", () => {
    for (const kind of ["support", "educationSupport", "inheritance", "giftReceived", "other"] as IncomeFlowKind[]) {
      const w = addIncome(wh0(), kind);
      const f = lastIncome(w);
      expect(fieldOf(w, incomeCard(f), `in/${f.id}/counterparty`), kind).toBeDefined();
    }
  });
  it("前に相手を入れた行は、出さない種類でも欄を残す", () => {
    const w = mutate(addIncome(wh0(), "sideJob"), (h) => void ((h.incomeFlows ?? []).at(-1)!.counterparty = "someone"));
    const f = lastIncome(w);
    expect(fieldOf(w, "work", `in/${f.id}/counterparty`)).toBeDefined();
  });
  it("出るお金: 修繕・車・教育費には出さず、仕送り・贈与・その他の支出には出す", () => {
    for (const kind of ["repair", "car", "education", "livingAnnual"] as MoneyOutKind[]) {
      const w = addExpense(wh0(), kind);
      const p = lastExpense(w);
      expect(fieldOf(w, expenseCard(w.request.input.household, p), `ev/${p.id}/counterparty`), kind).toBeUndefined();
    }
    for (const kind of ["allowance", "gift", "other"] as MoneyOutKind[]) {
      const w = addExpense(wh0(), kind);
      const p = lastExpense(w);
      expect(fieldOf(w, expenseCard(w.request.input.household, p), `ev/${p.id}/counterparty`), kind).toBeDefined();
    }
  });
});

describe("必要経費の欄の名前は、額と同じ単位で", () => {
  it("額の欄と同じ呼び方: 毎月の行は「必要経費（月額）」、毎年の行は「（年額）」、数年ごとの行は「（3年ごとの額）」、1回の行は「必要経費」", () => {
    const w = addIncome(wh0(), "sideJob");
    const f = lastIncome(w);
    const label = (x: WorkingHousehold) => fieldOf(x, "work", `in/${f.id}/cost`)?.label;
    expect(label(w)).toBe("必要経費（年額）");
    const cadence = fieldOf(w, "work", `in/${f.id}/cadence`)!;
    expect(label(cadence.set(w, "monthly"))).toBe("必要経費（月額）");
    expect(label(cadence.set(w, "once"))).toBe("必要経費");
    expect(fieldOf(w, "work", `in/${f.id}/cost`)?.help).toContain("受け取る額と同じく年額");
    const w3 = fieldOf(w, "work", `in/${f.id}/every`)!.set(w, 3);
    expect(label(w3)).toBe("必要経費（3年ごとの額）");
    expect(fieldOf(w3, "work", `in/${f.id}/amount`)?.label).toBe("3年ごとの額");
    const s = addIncome(wh0(), "saleBusiness");
    expect(fieldOf(s, "work", `in/${lastIncome(s).id}/cost`)?.label).toBe("取得費・譲渡の費用");
  });
});

describe("保険料の欄の名前は、払い方に合わせる（お金の行の額と同じ考え）", () => {
  it("月払いは「保険料（月額）」、年払いは「保険料（年額）」、一時払いは「保険料」。更新後の保険料も同じ", () => {
    expect(premiumLabel("保険料", "monthly")).toBe("保険料（月額）");
    expect(premiumLabel("保険料", "annual")).toBe("保険料（年額）");
    expect(premiumLabel("保険料", "single")).toBe("保険料");
    expect(premiumLabel("更新後の保険料", "monthly")).toBe("更新後の保険料（月額）");
    const w = fromRequest(modelHousehold("salariedCoupleTwoKids"), {});
    const c = w.request.input.household.insuranceContracts?.[0];
    expect(c).toBeDefined();
    if (c === undefined) return;
    const f = allFields(buildStage("insurance", w)).find((x) => x.key.endsWith("/premium") && x.label.startsWith("保険料"));
    expect(f?.label).toBe(premiumLabel("保険料", c.premium.frequency));
    expect(f?.label).not.toContain("1回の額");
  });
});
