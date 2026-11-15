// 値の状態の操作を、意味のある欄にだけ・直接押せる形で出す（0041 の 2026-10-29 の追記。「わからない」は 2026-10-31 に「書類で確かめる」にし、
// 書類から写す欄だけにした）と、
// 「?」を説明する物のすぐ右に置く（0077 の 2026-10-29 の追記）
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { h } from "preact";
import { renderToString } from "preact-render-to-string";
import { Field, FieldStateOps, Group } from "../src/workspace/input/FieldViews.tsx";
import { FieldStateLine } from "../src/workspace/input/FieldStateLine.tsx";
import { allFields, type ActionDef, type FieldDef, type GroupDef } from "../src/workspace/input/form.ts";
import { fromRequest, type WorkingHousehold } from "../src/workspace/input/household.ts";
import { InputPanel } from "../src/workspace/input/InputPanel.tsx";
import { buildStages, STAGE_ORDER } from "../src/workspace/input/stages/index.ts";
import { addCar } from "../src/workspace/input/stages/cars.ts";
import { currentHomeLoan } from "../src/workspace/input/stages/housingLoans.ts";
import { applyStateOp, availableOps, fieldStatus, OP_LABELS } from "../src/workspace/input/valueState.ts";
import { REPO_DIR } from "../scripts/lib.ts";
import { modelHousehold } from "./helpers.ts";

const MODELS = readdirSync(join(REPO_DIR, "data", "modelHouseholds"))
  .filter((f) => f.endsWith(".json"))
  .map((f) => f.slice(0, -5));
const open = (m: string): WorkingHousehold => fromRequest(modelHousehold(m), {});
const noop = () => undefined;
let idn = 0;
const seq = () => () => `00000000-0000-4000-8000-${String(++idn).padStart(12, "0")}`;
/** 前提条件・表の期間の入力項目（FP が決める値） */
const PREMISE = /^(assumptions|plan)\./;
const MAY_BE_NONE = new Set(["employment.salary.bonus", "residentTaxAssessment.amount", "retirementBenefit.amount"]);

describe("書類で確かめる・該当なしは、意味のある欄にだけ出す", () => {
  it.each(MODELS)("%s: 出す操作はどれも押すと世帯が変わる。書類で確かめるは書類から写す欄（docCheck）だけ、該当なしは物そのものが無いことがある額だけ", (m) => {
    const wh = open(m);
    for (const stage of buildStages(wh))
      for (const f of allFields(stage)) {
        const s = fieldStatus(f, wh);
        const ops = availableOps(f, wh, s);
        for (const o of ops.filter((x) => x !== "confirm")) expect(applyStateOp(wh, f, o), `${stage.id} ${f.label} ${o}`).not.toBe(wh);
        if (ops.includes("unknown")) {
          expect(f.item === null || !PREMISE.test(f.item), `${f.label}: 前提に書類で確かめるは無い`).toBe(true);
          expect(f.docCheck, `${f.label}: 書類の無い欄に書類で確かめるは無い`).toBeDefined();
          // 代わりに使う値（今の値か、空欄の推定）がある
          expect(f.get(wh).value !== null || f.blankIsEstimate === true, f.label).toBe(true);
        }
        if (ops.includes("notApplicable")) {
          expect(f.blankIsEstimate, f.label).toBe(true);
          expect(MAY_BE_NONE.has(f.item ?? ""), f.label).toBe(true);
        }
      }
  });

  it("書類で確かめるを出す欄: 住民税・退職金の見込み額・年金の加入月数・今の住宅ローン・今の自動車ローン。出さない欄: 年収・賞与・車の費用・これから買う車のローン・基本生活費・前提条件など", () => {
    const seen = new Map<string, Set<string>>();
    for (const m of MODELS) {
      const wh = open(m);
      for (const stage of buildStages(wh))
        for (const f of allFields(stage)) for (const o of availableOps(f, wh)) if (o === "unknown" || o === "notApplicable") seen.set(f.item ?? f.key, (seen.get(f.item ?? f.key) ?? new Set()).add(o));
    }
    expect(seen.get("residentTaxAssessment.amount")).toEqual(new Set(["unknown", "notApplicable"]));
    expect(seen.get("retirementBenefit.amount")).toEqual(new Set(["unknown", "notApplicable"]));
    expect(seen.get("pensionRecord.months")).toEqual(new Set(["unknown"]));
    // 今の住宅ローンの借入額・金利・返済期間（見本の世帯の住宅ローンは借入の年月が計算の基準の月より前）
    for (const k of ["debt.principal", "debt.rateSchedule", "debt.repayment"]) expect(seen.get(k), k).toEqual(new Set(["unknown"]));
    // これから買う車のローン（車の買い方）には出さない（今の自動車ローンは debt.* の欄。0041 の追記 2026-11-01）
    expect(seen.get("car.loan")).toBeUndefined();
    // 賞与は該当なしだけ。年収・事業所得・車の費用・住まいの費用・基本生活費（0100）・お金の行には出さない
    expect(seen.get("employment.salary.bonus")).toEqual(new Set(["notApplicable"]));
    for (const k of seen.keys()) expect(k.startsWith("livingExpense."), k).toBe(false);
    for (const k of seen.keys()) expect(PREMISE.test(k), k).toBe(false);
    const ALLOWED = new Set(["residentTaxAssessment.amount", "retirementBenefit.amount", "retirementBenefit.receipt", "pensionRecord.months", "debt.principal", "debt.rateSchedule", "debt.repayment", "debt.balance", "insurance.coverages"]);
    for (const [k, ops] of seen) if (ops.has("unknown")) expect(ALLOWED.has(k), k).toBe(true);
    for (const k of ["employment.salary.annual", "employment.business.income", "car.purchase", "car.loan", "car.upkeep", "car.tax", "car.insurance", "car.inspection", "residence.rent", "residence.propertyTax", "residence.maintenance", "periodicExpense.amount", "account.marketValue", "insurance.premium"])
      expect(seen.get(k)?.has("unknown") ?? false, k).toBe(false);
  });

  it("書類で確かめるは今返している自動車ローンの欄に出し、これから買う車のローン（車の買い方の頭金・年数・金利）には出さない（0041 の追記 2026-11-01）", () => {
    const carFields = (w: WorkingHousehold) => allFields(buildStages(w).find((s) => s.id === "car")!);
    let wh = addCar(open("salariedCoupleTwoKids"), seq());
    wh = carFields(wh).find((x) => x.key.endsWith("/pay"))!.set(wh, "loan");
    const future = carFields(wh).filter((x) => x.item === "car.loan" && /\/(down|term|rate)$/.test(x.key));
    expect(future.map((x) => x.key.split("/").at(-1))).toEqual(["down", "term", "rate"]);
    for (const f of future) {
      expect(f.docCheck, f.label).toBeUndefined();
      expect(availableOps(f, wh), f.label).not.toContain("unknown");
    }
    // 今返している自動車ローン: 借入額・金利・返済期間・残高は返済予定表で確かめる（金利の種類には出さない）
    const add = buildStages(wh).find((s) => s.id === "car")!.sections.flatMap((s) => s.actions).find((a) => a.key === "car/addCarLoan")!;
    wh = add.run(wh);
    const debt = wh.request.input.household.debts!.find((d) => d.kind === "car")!;
    const loan = carFields(wh).filter((x) => x.key.startsWith(`housing/debt/${debt.id}/`));
    const doc = new Set(loan.filter((x) => x.docCheck !== undefined).map((x) => x.key.split("/").at(-1)));
    expect(doc).toEqual(new Set(["principal", "rate", "term", "balance"]));
    for (const x of loan.filter((f) => f.docCheck !== undefined)) expect(x.docCheck).toBe("返済予定表");
    expect(loan.find((x) => x.key.endsWith("/rateType"))?.docCheck).toBeUndefined();
    expect(availableOps(loan.find((x) => x.key.endsWith("/rate"))!, wh)).toContain("unknown");
    for (const f of carFields(wh)) for (const o of availableOps(f, wh).filter((x) => x !== "confirm")) expect(applyStateOp(wh, f, o), `${f.label} ${o}`).not.toBe(wh);
    // これから借りる自動車ローン（借入の年月が計算の基準の月より後）には出さない
    const later = { ...wh, request: { ...wh.request, input: { ...wh.request.input, household: { ...wh.request.input.household, debts: wh.request.input.household.debts!.map((d) => (d.id === debt.id ? { ...d, start: { at: "2028-04" } } : d)) } } } };
    expect(carFields(later).filter((x) => x.key.startsWith(`housing/debt/${debt.id}/`) && x.docCheck !== undefined)).toEqual([]);
  });

  it("住宅ローンの金利の種類（選ぶ欄）には書類で確かめるを出さない（金利・借入額・返済期間・残高には出す）", () => {
    let checked = 0;
    for (const m of MODELS) {
      const wh = open(m);
      for (const d of (wh.request.input.household.debts ?? []).filter((x) => currentHomeLoan(wh, x))) {
        const fields = allFields(buildStages(wh).find((s) => s.id === "housing")!).filter((f) => f.key.startsWith(`housing/debt/${d.id}/`));
        const type = fields.find((f) => f.key.endsWith("/rateType"));
        expect(type?.label, m).toBe("金利の種類");
        expect(type!.docCheck, m).toBeUndefined();
        expect(availableOps(type!, wh), m).not.toContain("unknown");
        expect(fields.find((f) => f.key.endsWith("/rate"))?.docCheck, m).toBe("返済予定表");
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(0);
  });

  it("学歴に「わからない」の選び方は無い（選んでいなければ今までどおり大学・大学院卒の値で目安）", () => {
    for (const m of MODELS) {
      const wh = open(m);
      for (const stage of buildStages(wh))
        for (const f of allFields(stage)) {
          if (f.item !== "retirementBenefit.education" || f.kind !== "select") continue;
          expect(f.options.map((o) => o.label).join("・")).not.toContain("わからない");
          expect(f.options[0]).toMatchObject({ value: "" });
        }
    }
  });
});

describe("値の状態の操作は直接押すリンク（開く形にしない・「など」を付けない）", () => {
  const html = (wh: WorkingHousehold, f: FieldDef) => renderToString(h(FieldStateOps.Provider, { value: applyStateOp }, h(Field, { f, wh, onEdit: noop })));
  it.each(MODELS)("%s: どの欄も、出す操作のリンクがその欄で使える操作と同じ（過不足なし）", (m) => {
    const wh = open(m);
    let n = 0;
    let wanted = 0;
    for (const stage of buildStages(wh))
      for (const f of allFields(stage)) {
        if (f.time !== undefined) continue;
        const out = html(wh, f);
        expect(out).not.toContain("data-op-menu");
        expect(out).not.toContain("わからない・該当なしなど");
        const links = [...out.matchAll(/<button type="button" class="link-btn"[^>]*data-op="(\w+)">([^<]*)<\/button>/g)];
        const want = availableOps(f, wh).filter((o) => o !== "confirm");
        expect(links.map((l) => l[1]), f.label).toEqual(want);
        for (const l of links) expect(l[2]).toBe(OP_LABELS[l[1] as keyof typeof OP_LABELS]);
        n += links.length;
        wanted += want.length;
      }
    // 操作の無い世帯もある（前は表の最後の年の欄の「推定に戻す」があった。表を何歳まで見るかの欄は（既定）を選んで戻す。0070 の追記 2026-11-13）
    expect(n).toBe(wanted);
  });
  it("専用の部品の欄（表の中も）も同じリンク。「…」でたたまない。書類で確かめるの説明に確かめる書類", () => {
    const wh = open("salariedCoupleTwoKids");
    const f = buildStages(wh)
      .flatMap((s) => allFields(s))
      .find((x) => x.item === "residentTaxAssessment.amount")!;
    const out = renderToString(h(FieldStateOps.Provider, { value: applyStateOp }, h(FieldStateLine, { f, wh, onEdit: noop, compact: true })));
    expect(out).not.toContain("…");
    expect(out).toContain('data-op="unknown">書類で確かめる</button>');
    expect(out).toContain("住民税の決定通知書で確かめるまで");
    expect(out).not.toContain("わからない");
  });
});

describe("「?」は説明する物のすぐ右", () => {
  const help = (label: string): ActionDef => ({ key: `a/${label}`, label: `＋ ${label}`, level: "simple", help: `${label}の説明の文`, run: (w) => w });
  const plainAct = (label: string): ActionDef => ({ key: `a/${label}`, label: `＋ ${label}`, level: "simple", run: (w) => w });
  const group = (g: Partial<GroupDef>): GroupDef => ({ key: "g", level: "simple", fields: [], actions: [], ...g });
  const wh = open(MODELS[0]!);
  const render = (g: GroupDef) => renderToString(h(Group, { group: g, wh, level: "simple", onEdit: noop }));

  it("ボタンの「?」はボタンと1つのまとまりで、ボタンのすぐ後ろ（次のボタンとの間に挟まらない）。説明の1行目にボタンの名前", () => {
    const out = render(group({ actions: [help("教育訓練給付など"), plainAct("副業・雑所得"), help("その他の働く収入")] }));
    const pairs = [...out.matchAll(/<span class="help-of" data-help-of="true"><button[^>]*>([^<]*)<\/button><span class="help">/g)].map((x) => x[1]);
    expect(pairs).toEqual(["＋ 教育訓練給付など", "＋ その他の働く収入"]);
    expect(out).toContain('data-help-for="true">＋ 教育訓練給付など</span>');
    // 説明の無いボタンはまとまりにしない
    expect(out).toMatch(/<button[^>]*data-action="a\/副業・雑所得"[^>]*>＋ 副業・雑所得<\/button>(?!<span class="help">)/);
  });

  it("ボタンの並びの説明（段階・例外の年）は、並びの右端。説明の1行目に、どのボタンの説明か", () => {
    const out = render(group({ note: "段階と例外の年の違いの説明", actions: [plainAct("月額の段階"), plainAct("月額の例外の年")] }));
    const i = out.indexOf('class="help-of all"');
    expect(i).toBeGreaterThan(-1);
    const block = out.slice(i);
    expect(block.indexOf("＋ 月額の例外の年")).toBeLessThan(block.indexOf('<span class="help">'));
    expect(out).toContain("「＋ 月額の段階」「＋ 月額の例外の年」");
    expect(out).toContain('aria-label="月額の段階・月額の例外の年の説明"');
  });

  it.each(MODELS)("%s: どのパネルでも、ボタンの左に「?」が来ない（並びの先頭が「?」でない・ボタンの「?」はボタンとまとまる）", (m) => {
    const w = open(m);
    for (const s of STAGE_ORDER)
      for (const level of ["simple", "detail"] as const) {
        const out = renderToString(h(InputPanel, { wh: w, itemId: s.id, level, onLevel: noop, onSave: noop, onClose: noop }));
        if (out === "") continue;
        expect(out, s.label).not.toMatch(/<div class="in-actions"><span class="help">/);
        // 欄の名前のすぐ右に「?」（状態の印はその後ろ）
        expect(out, s.label).not.toMatch(/<\/label><span class="help"><button type="button" class="help-btn help-mark[^"]*"[^>]*>[^<]*<\/button>(?:(?!<\/div>).)*<span class="help"><button type="button" class="help-btn" aria-label/);
        // 保存の「?」は保存のボタンのすぐ右（下の帯の左端に「?」だけを置かない）
        expect(out, s.label).toMatch(/<span class="help-of" data-help-of="true"><button type="button" class="btn primary"[^>]*data-save="true">保存<\/button><span class="help" data-help="save">/);
        expect(out, s.label).not.toMatch(/data-panel-note="true">(?:(?!<\/p>).)*data-help="save"/);
      }
  });
});
