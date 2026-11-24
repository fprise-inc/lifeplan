// 預金から移す（0258）: 貯蓄・運用の口座の表の「＋預金から移す」と行（時期・額・外す・時期の説明）、NISA の枠を超えた分の知らせ、
// 計算に入れない行（計算基準月より前・表の最後の年より後）、計算（移動の行）、資産配分の口座、プランの差分、欄の当て先
import { describe, expect, it } from "vitest";
import { h } from "preact";
import { renderToString } from "preact-render-to-string";
import type { Account, EngineRequest, PreviewResult } from "../src/engine/types.ts";
import { allFields, type FieldDef } from "../src/workspace/input/form.ts";
import { fromRequest, mutate, type WorkingHousehold } from "../src/workspace/input/household.ts";
import { buildStage } from "../src/workspace/input/stages/index.ts";
import { addMove, canMoveFromDeposit, editMove, moveOverText, moveRowsOf, nisaMoveOvers, removeMove, switchMethod } from "../src/workspace/input/savings/model.ts";
import { SavingsPanel } from "../src/workspace/input/savings/SavingsPanel.tsx";
import { fieldAddress } from "../src/workspace/input/valueState.ts";
import { buildCatalog } from "../src/workspace/plans/items.ts";
import { planView, recordPlanEdit } from "../src/workspace/plans/planEdit.ts";
import type { Proposal } from "../src/workspace/plans/plans.ts";
import { roles } from "../src/workspace/roles.ts";
import { modelHousehold, preview } from "./helpers.ts";

const MAN = 10_000;
/** 本人 1981年7月生まれ・計算基準月 2026年10月・表の最後の年 2081年。預金・NISA・iDeCo・企業型DC・課税口座 */
const open = (): WorkingHousehold => fromRequest(modelHousehold("investmentCouple"));
const acc = (wh: WorkingHousehold, kind: string): Account => (wh.request.input.household.accounts ?? []).find((a) => a.kind === kind) as Account;
const edit = (wh: WorkingHousehold, kind: string, f: (a: Account, base: string) => void): WorkingHousehold =>
  mutate(wh, (hh, r) => f((hh.accounts ?? []).find((a) => a.kind === kind) as Account, r.input.baseMonth));
/** 行を足して時期と額を入れる */
const withMoves = (wh: WorkingHousehold, kind: string, rows: readonly [string, number][]): WorkingHousehold =>
  edit(wh, kind, (a, base) => {
    for (const [ym, amount] of rows) {
      const id = addMove(wh.request.input.household, base, a);
      editMove(a, id, { ym, amount });
    }
  });
const flows = (r: PreviewResult, row: string, year: number) => r.table.filter((c) => c.row === row && c.year === year).reduce((s, c) => s + c.amount, 0);
const panel = (wh: WorkingHousehold, level: "simple" | "detail" = "simple") => renderToString(h(SavingsPanel, { wh, level, onEdit: () => undefined }));
const fieldsOf = (wh: WorkingHousehold): Map<string, FieldDef> => new Map(allFields(buildStage("savings", wh)).map((f) => [f.key, f]));
/** 預金を1億円にした世帯（移す額で預金が足りなくならない） */
const rich = (wh: WorkingHousehold): WorkingHousehold => edit(wh, "deposit", (a) => void (a.marketValue = { ...a.marketValue!, value: 100_000_000 }));
/** NISA の積立を外した世帯（枠の知らせを移す行だけで見る） */
const plainNisa = (): WorkingHousehold => edit(open(), "nisa", (a) => void (a.contributions = []));

describe("口座の表の「＋預金から移す」（0258）", () => {
  it("何も入れていない口座は「＋預金から移す」の1行だけ（NISA は成長投資枠と添える）。iDeCo・企業型DC・収支が入る預金には出さない。標準でも詳細でも", () => {
    const wh = open();
    for (const level of ["simple", "detail"] as const) {
      const html = panel(wh, level);
      expect(html).toContain("毎月の積立・預金から移す");
      expect(html).toContain("＋預金から移す（成長投資枠）");
      expect((html.match(/data-move-add/g) ?? []).length).toBe(2);
      expect(html).not.toContain("data-move-row");
      expect(html).not.toContain("data-settlement-moves");
    }
    const h0 = wh.request.input.household;
    expect(["deposit", "ideco", "corporateDc"].map((k) => canMoveFromDeposit(h0, acc(wh, k)))).toEqual([false, false, false]);
    expect(["taxable", "nisa"].map((k) => canMoveFromDeposit(h0, acc(wh, k)))).toEqual([true, true]);
  });

  it("行を足す: 1行目は今月・0円、次からは前の行の1年後に同じ額。時期の右に「2年後・ご本人47歳」。外すと行が消え、全部外すと欄も無くなる", () => {
    let wh = edit(open(), "taxable", (a, base) => void addMove(open().request.input.household, base, a));
    expect(acc(wh, "taxable").fromDeposit).toEqual([{ id: expect.any(String), at: { at: "2026-10" }, amount: 0 }]);
    wh = edit(wh, "taxable", (a) => editMove(a, a.fromDeposit![0]!.id!, { amount: 1000 * MAN }));
    wh = edit(wh, "taxable", (a, base) => void addMove(wh.request.input.household, base, a));
    expect(acc(wh, "taxable").fromDeposit?.[1]).toMatchObject({ at: { at: "2027-10" }, amount: 1000 * MAN });
    wh = edit(wh, "taxable", (a) => editMove(a, a.fromDeposit![1]!.id!, { ym: "2028-10", amount: 2000 * MAN }));
    const rows = moveRowsOf(wh.request, acc(wh, "taxable"), "ご本人");
    expect(rows.map((r) => [r.ym, r.amount, r.when])).toEqual([
      ["2026-10", 1000 * MAN, "今月・ご本人45歳"],
      ["2028-10", 2000 * MAN, "2年後・ご本人47歳"],
    ]);
    const html = panel(wh);
    expect((html.match(/data-move-row=/g) ?? []).length).toBe(2);
    expect(html).toContain("2年後・ご本人47歳");
    // 収支が入る預金に、出す元であることを添える
    expect(html).toContain("ほかの口座へ「預金から移す」額は、この口座から出します");
    wh = edit(wh, "taxable", (a) => removeMove(a, a.fromDeposit![0]!.id!));
    expect(acc(wh, "taxable").fromDeposit).toHaveLength(1);
    wh = edit(wh, "taxable", (a) => removeMove(a, a.fromDeposit![0]!.id!));
    expect(acc(wh, "taxable").fromDeposit).toBeUndefined();
  });

  it("時期の境目: 計算基準月より前・表の最後の年より後の行は、計算に入れないことを出す（基準月ちょうど・最後の年の12月は入れる）", () => {
    const wh = withMoves(open(), "taxable", [
      ["2026-09", 100 * MAN],
      ["2026-10", 200 * MAN],
      ["2081-12", 300 * MAN],
      ["2082-01", 400 * MAN],
    ]);
    const rows = moveRowsOf(wh.request, acc(wh, "taxable"), "ご本人");
    expect(rows.map((r) => [r.ym, r.when, r.skipped !== null])).toEqual([
      ["2026-09", "1か月前", true],
      ["2026-10", "今月・ご本人45歳", false],
      ["2081-12", "55年2か月後・ご本人100歳", false],
      ["2082-01", "55年3か月後・ご本人100歳", true],
    ]);
    expect(rows[0]?.skipped).toBe("計算基準月より前なので、計算に入れていません（今の残高に入れてください）");
    expect(rows[3]?.skipped).toBe("表の最後の年（2081年）より後なので、計算に入れていません");
    const r = preview(wh.request);
    expect(flows(r, "cf.transfer.investment", 2026)).toBe(200 * MAN);
    expect(flows(r, "cf.transfer.investment", 2081)).toBe(300 * MAN);
  });

  it("基準月が1〜3月の世帯: 年をまたぐ時期の説明（11か月後・1年後）と、基準月の前の月（前の年の12月）は計算に入れない", () => {
    for (const base of ["2027-01", "2027-02", "2027-03"]) {
      const wh0 = mutate(open(), (_h, r) => void (r.input.baseMonth = base));
      const wh = withMoves(wh0, "taxable", [
        ["2026-12", 100 * MAN],
        [base, 200 * MAN],
        ["2028-01", 300 * MAN],
      ]);
      const rows = moveRowsOf(wh.request, acc(wh, "taxable"), "ご本人");
      expect(rows[0]?.skipped, base).not.toBeNull();
      expect(rows[1]?.when.startsWith("今月"), base).toBe(true);
      expect(rows[2]?.when, base).toBe(base === "2027-01" ? "1年後・ご本人46歳" : base === "2027-02" ? "11か月後・ご本人46歳" : "10か月後・ご本人46歳");
    }
  });

  it("NISA の年の枠: 成長投資枠 年240万円ちょうどは知らせなし、1円超えと500万円は超えた分を預金に残す知らせ（計算も同じ額）", () => {
    const exact = withMoves(plainNisa(), "nisa", [["2027-04", 240 * MAN]]);
    expect(nisaMoveOvers(exact.request, acc(exact, "nisa")).size).toBe(0);
    const one = withMoves(plainNisa(), "nisa", [["2027-04", 240 * MAN + 1]]);
    expect([...nisaMoveOvers(one.request, acc(one, "nisa")).values()]).toEqual([{ kind: "annual", amount: 1 }]);
    const big = withMoves(plainNisa(), "nisa", [["2027-04", 500 * MAN]]);
    const over = moveRowsOf(big.request, acc(big, "nisa"), "ご本人")[0]!.over!;
    expect(moveOverText(over)).toBe("この年の枠を超える 260万円は、預金に残しています（成長投資枠は年240万円）");
    expect(panel(big)).toContain("この年の枠を超える 260万円は、預金に残しています（成長投資枠は年240万円）");
    expect(flows(preview(big.request), "cf.transfer.nisa.growth", 2027)).toBe(240 * MAN);
    expect(flows(preview(big.request), "cf.transfer.investment", 2027)).toBe(0);
    // 年を分けると枠に入る
    const split = withMoves(plainNisa(), "nisa", [
      ["2027-04", 240 * MAN],
      ["2028-04", 240 * MAN],
    ]);
    expect(nisaMoveOvers(split.request, acc(split, "nisa")).size).toBe(0);
  });

  it("NISA の生涯の枠: 残り240万円ちょうどは知らせなし、1円超えは生涯の枠の知らせ", () => {
    const used = (wh: WorkingHousehold) => edit(wh, "nisa", (a) => void (a.frame = { lifetimeUsedCost: 1560 * MAN, growthUsedCost: 0, asOfYear: 2025 }));
    const exact = withMoves(used(plainNisa()), "nisa", [["2027-04", 240 * MAN]]);
    expect(nisaMoveOvers(exact.request, acc(exact, "nisa")).size).toBe(0);
    const one = withMoves(used(plainNisa()), "nisa", [["2028-04", 240 * MAN + 1]]);
    // 2028年は生涯の枠の残りが240万円（2027年に何も入れていない）。年の枠と同じ額なので年の枠の知らせ
    expect([...nisaMoveOvers(one.request, acc(one, "nisa")).values()][0]?.amount).toBe(1);
    const life = withMoves(used(plainNisa()), "nisa", [
      ["2027-04", 200 * MAN],
      ["2028-04", 100 * MAN],
    ]);
    const o = [...nisaMoveOvers(life.request, acc(life, "nisa")).values()];
    expect(o).toEqual([{ kind: "lifetime", amount: 60 * MAN }]);
    expect(moveOverText(o[0]!)).toBe("生涯の枠を超える 60万円は、預金に残しています（生涯の枠は1,800万円、うち成長投資枠は1,200万円）");
  });

  it("計算: 移した額は移動の行に出て、年間収支は変わらない。預金が足りないときは取り崩して補う（資金の不足は出ない）", () => {
    const base = rich(open());
    const wh = withMoves(base, "taxable", [
      ["2026-12", 1000 * MAN],
      ["2028-12", 2000 * MAN],
    ]);
    const r = preview(wh.request);
    const r0 = preview(base.request);
    expect(flows(r, "cf.transfer.investment", 2028) - flows(r0, "cf.transfer.investment", 2028)).toBe(2000 * MAN);
    expect(flows(r, "cf.net", 2028)).toBe(flows(r0, "cf.net", 2028));
    // 預金560万円から1,000万円を移す: 年末に取り崩しの順番で補う
    const short = withMoves(open(), "taxable", [["2026-12", 1000 * MAN]]);
    const rs = preview(short.request);
    expect(flows(rs, "cf.transfer.investment", 2026) - flows(preview(open().request), "cf.transfer.investment", 2026)).toBe(1000 * MAN);
    expect(flows(rs, "cf.balance.shortfall", 2026)).toBe(0);
  });

  it("資産配分の入れ方の口座でも働く（移した額に配分の利回りをかける）", () => {
    const alloc = switchMethod(rich(open()), "allocation");
    const wh = withMoves(alloc, "taxable", [["2027-01", 1000 * MAN]]);
    expect(panel(wh)).toContain("data-move-row=");
    const r = preview(wh.request);
    const r0 = preview(alloc.request);
    expect(flows(r, "cf.transfer.investment", 2027) - flows(r0, "cf.transfer.investment", 2027)).toBe(1000 * MAN);
    expect(flows(r, "cf.balance.account.taxable", 2027) - flows(r0, "cf.balance.account.taxable", 2027)).toBeGreaterThan(1000 * MAN);
  });

  it("欄: 行ごとに時期と額の欄があり、当て先は口座の account.fromDeposit の行の ID の中。欄から書き換えられる", () => {
    const wh = withMoves(open(), "taxable", [["2027-01", 1000 * MAN]]);
    const a = acc(wh, "taxable");
    const id = a.fromDeposit![0]!.id!;
    const fs = fieldsOf(wh);
    const at = fs.get(`sav/${a.id}/move/${id}/at`)!;
    const amount = fs.get(`sav/${a.id}/move/${id}/amount`)!;
    expect(at.get(wh).value).toBe("2027-01");
    expect(amount.get(wh).value).toBe(1000 * MAN);
    expect(fieldAddress(amount, wh)).toEqual({ target: { object: a.id }, item: "account.fromDeposit", at: [id, "amount"] });
    const w2 = at.set(amount.set(wh, 1500 * MAN), "2029-06");
    expect(acc(w2, "taxable").fromDeposit).toEqual([{ id, at: { at: "2029-06" }, amount: 1500 * MAN }]);
    // 口座ごとの詳細の区画には出さない（表で入れる）
    expect(panel(w2, "detail")).not.toContain("預金から移すの額");
  });
});

describe("プランで預金から移す（0258）", () => {
  const plan = (id: string): Proposal => ({ id, name: `プラン${id}`, createdAt: "2026-11-24T00:00:00Z", updatedAt: "2026-11-24T00:00:00Z", base: null, tags: [], diffs: [] });
  it("プランを直している間に行を足す・額を変える・外すと、そのプランの差分になり現状は変わらない。プランの計算に入る", () => {
    const req = modelHousehold("investmentCouple");
    const self = roles(req).find((r) => r.key === "self")!.member;
    const wh = { ...fromRequest(req, {}), proposals: [plan("B")] };
    const cat = buildCatalog(wh, self.id, null);
    const view = planView(wh, cat, "B");
    const added = withMoves(view, "taxable", [["2027-01", 1000 * MAN]]);
    let w = recordPlanEdit(wh, cat, "B", view, added);
    expect(acc(w, "taxable").fromDeposit).toBeUndefined();
    expect(w.proposals[0]?.diffs.some((d) => d.item === "account.fromDeposit")).toBe(true);
    let v2 = planView(w, cat, "B");
    expect(acc(v2, "taxable").fromDeposit?.map((r) => r.amount)).toEqual([1000 * MAN]);
    expect(flows(preview(v2.request as EngineRequest), "cf.transfer.investment", 2027) - flows(preview(req), "cf.transfer.investment", 2027)).toBe(1000 * MAN);
    // 額を変える
    const changed = edit(v2, "taxable", (a) => editMove(a, a.fromDeposit![0]!.id!, { amount: 3000 * MAN, ym: "2028-01" }));
    w = recordPlanEdit(w, cat, "B", v2, changed);
    v2 = planView(w, cat, "B");
    expect(acc(v2, "taxable").fromDeposit?.map((r) => [r.at, r.amount])).toEqual([[{ at: "2028-01" }, 3000 * MAN]]);
    expect(acc(w, "taxable").fromDeposit).toBeUndefined();
    // 外す
    const removed = edit(v2, "taxable", (a) => removeMove(a, a.fromDeposit![0]!.id!));
    w = recordPlanEdit(w, cat, "B", v2, removed);
    expect(acc(planView(w, cat, "B"), "taxable").fromDeposit ?? []).toEqual([]);
  });
});
