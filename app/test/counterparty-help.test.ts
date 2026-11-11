// 入るお金の行の「相手（誰から）」の説明と、受け取る贈与の行で相手が「なし」のときの添え書き（0044 の追記）。
// あわせて、プルダウンの欄の説明を「選ばないとき」でなく画面に出る選択肢の名前で言う
import { describe, expect, it } from "vitest";
import type { IncomeFlow } from "../src/engine/types.ts";
import { allFields, type FieldDef, type StageId } from "../src/workspace/input/form.ts";
import { fromRequest, mutate, type WorkingHousehold } from "../src/workspace/input/household.ts";
import { addExpense, addIncome, expenseCard, expensePartyHelp, incomePartyHelp, type MoneyCard } from "../src/workspace/input/moneyRows.ts";
import { buildStage } from "../src/workspace/input/stages/index.ts";
import { modelHousehold } from "./helpers.ts";

const stageOf = (c: MoneyCard): StageId => (c === "inherit" ? "inheritance" : c);
const wh0 = (): WorkingHousehold => fromRequest(modelHousehold("dualNoKids"), {});
const lastIncome = (w: WorkingHousehold): IncomeFlow => (w.request.input.household.incomeFlows ?? []).at(-1)!;
const fieldOf = (w: WorkingHousehold, card: MoneyCard, key: string): FieldDef | undefined => allFields(buildStage(stageOf(card), w)).find((f) => f.key === key);
const setRow = (w: WorkingHousehold, change: (f: IncomeFlow) => void): WorkingHousehold => mutate(w, (h) => change((h.incomeFlows ?? []).at(-1)!));
/** 世帯の外の贈与者（ご本人の親）を足す */
const withDonor = (w: WorkingHousehold): WorkingHousehold =>
  mutate(w, (h) => {
    const self = h.members.find((m) => m.kind === "self")!;
    (h.donors ??= []).push({ id: "donor-1", kind: "parent", of: self.id });
  });

describe("相続・贈与の入力項目の「相手（誰から）」に説明が付く", () => {
  it("贈与を受ける行: 特例税率・一般税率・相続時精算課税の特別控除を言う（足す場所は区画の説明に任せる）", () => {
    const w = addIncome(wh0(), "giftReceived");
    const f = fieldOf(w, "inherit", `in/${lastIncome(w).id}/counterparty`);
    expect(f?.level).toBe("simple");
    expect(f?.help).toContain("「なし」でも計算できます");
    expect(f?.help).toContain("特例税率");
    expect(f?.help).toContain("一般税率");
    expect(f?.help).toContain("特別控除");
    // 足す場所は、すぐ下の区画「親・祖父母（相続の相手・贈与する人）」に書いてあるので欄の説明では言わない
    expect(f?.help).not.toContain("足します");
  });

  it("相続・遺贈の行: 税に効かないことと、受け取る時期の推定に使うことを言う（贈与税の話はしない）", () => {
    const w = addIncome(wh0(), "inheritance");
    const f = fieldOf(w, "inherit", `in/${lastIncome(w).id}/counterparty`);
    expect(f?.help).toContain("誰からの相続か");
    expect(f?.help).toContain("税に効きません");
    expect(f?.help).toContain("10か月後");
    expect(f?.help).not.toContain("特例税率");
  });

  it("説明は課税の扱いで決まる（相続の入力項目の外でも、贈与税で見る行なら贈与の説明）", () => {
    expect(incomePartyHelp({ kind: "support", taxTreatment: "gift" }, "care")).toContain("特例税率");
    expect(incomePartyHelp({ kind: "support" }, "care")).toContain("亡くなる見込み");
    expect(incomePartyHelp({ kind: "support" }, "care")).toContain("介護・親の項目の「世帯の外の家族」");
    expect(incomePartyHelp({ kind: "propertyDivision" }, "family")).toContain("前の配偶者");
  });

  it("ほかの入力項目の詳細の相手の欄も同じ考え方の説明", () => {
    const w = addIncome(wh0(), "support");
    const f = fieldOf(w, "care", `in/${lastIncome(w).id}/counterparty`);
    expect(f?.level).toBe("detail");
    expect(f?.help).toBe(incomePartyHelp({ kind: "support" }, "care"));
  });
});

describe("出るお金の行の「相手（誰へ）」にも説明が付く", () => {
  it("仕送り: 亡くなる見込みで止まる・その人のお金に入る・扶養の判定に使う", () => {
    const w = addExpense(wh0(), "allowance");
    const p = (w.request.input.household.periodicExpenses ?? []).at(-1)!;
    const card = expenseCard(w.request.input.household, p);
    const help = fieldOf(w, card, `ev/${p.id}/counterparty`)?.help ?? "";
    expect(help).toContain("誰への仕送りか");
    expect(help).toContain("その月から払いません");
    expect(help).toContain("その残高に入れます");
    expect(help).toContain("扶養");
  });

  it("家族の入力項目では、世帯の中の人は記録と言う。あげる贈与は今までの説明のまま", () => {
    expect(expensePartyHelp({ kind: "allowance" }, "family")).toContain("世帯の中の人を選んでも計算は変わりません");
    expect(expensePartyHelp({ kind: "other" }, "events")).toContain("誰へのお金か");
    expect(expensePartyHelp({ kind: "gift" }, "inherit")).toContain("贈与を受け取る人です");
  });
});

describe("受け取る贈与の行で相手が「なし」のときだけ添え書き", () => {
  const hintOf = (w: WorkingHousehold): string | null | undefined => fieldOf(w, "inherit", `in/${lastIncome(w).id}/counterparty`)?.get(w).hint;

  it("暦年課税で「なし」: 一般税率で計算すると添える", () => {
    const w = setRow(addIncome(wh0(), "giftReceived"), (f) => delete f.counterparty);
    expect(hintOf(w)).toBe("「なし」のときは一般税率で贈与税を計算します");
  });

  it("相続時精算課税で「なし」: この行だけで特別控除を数えると添える", () => {
    const w = setRow(addIncome(wh0(), "giftReceived"), (f) => {
      delete f.counterparty;
      f.giftMethod = "settlement";
    });
    expect(hintOf(w)).toContain("この行だけで相続時精算課税の特別控除");
  });

  it("相手を選んだら出さない", () => {
    const w = setRow(addIncome(withDonor(wh0()), "giftReceived"), (f) => (f.counterparty = "donor-1"));
    expect(hintOf(w)).toBeNull();
  });

  it("相続の行は「なし」でも出さない（税に効かない）", () => {
    const w = setRow(addIncome(wh0(), "inheritance"), (f) => delete f.counterparty);
    expect(hintOf(w)).toBeNull();
  });
});

describe("プルダウンの説明は画面に出る選択肢の名前で言う", () => {
  it("受け取る人: 既定の「世帯」のときの税と万一のときの扱い", () => {
    const w = addIncome(wh0(), "support");
    const help = fieldOf(w, "care", `in/${lastIncome(w).id}/recipient`)?.help ?? "";
    expect(help).toContain("「世帯」のときは、税はご本人の所得として計算し");
    expect(help).not.toContain("選ばない");
  });

  it("伸び方: 選択肢の名前で、物価に合わせる行にも変えない行にも合う言い方", () => {
    const w = addIncome(wh0(), "support");
    const help = fieldOf(w, "care", `in/${lastIncome(w).id}/growth`)?.help ?? "";
    expect(help).toContain("「物価に合わせる」は");
    expect(help).toContain("「変えない」は入れた額のまま");
    expect(help).toContain("新しく足すと「変えない」");
    expect(help).not.toContain("選ばない");
  });
});
