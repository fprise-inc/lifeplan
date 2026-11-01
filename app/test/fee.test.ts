// 車・FP顧問料の入力と、主画面の対策「FP顧問料」の ON/OFF（提案の差分。現状は変えない）がエンジンの結果と一致すること
import { renderToString } from "preact-render-to-string";
import { h } from "preact";
import { describe, expect, it } from "vitest";
import { advisoryFeeSummary } from "../src/engine/types.ts";
import { FeeNote } from "../src/presentation/MainView.tsx";
import { demoHousehold } from "../src/workspace/catalog.ts";
import { allFields, type FieldDef } from "../src/workspace/input/form.ts";
import { fromRequest, mutate, type WorkingHousehold } from "../src/workspace/input/household.ts";
import { addCar, upkeepAnnual } from "../src/workspace/input/stages/cars.ts";
import { addAdvisoryFee } from "../src/workspace/input/stages/fees.ts";
import { buildStage } from "../src/workspace/input/stages/index.ts";
import { oneMinus } from "../src/workspace/input/units.ts";
import { advisoryFeeInCurrent, applyAdvisoryFee, applyLevers, hasAdvisoryFee } from "../src/workspace/levers.ts";
import { financialOf, toPresentation } from "../src/workspace/present.ts";
import { feeSummary } from "../src/workspace/App.tsx";
import { modelHousehold, preview } from "./helpers.ts";
import { carLoanRateEstimate } from "../../hearing/src/loanRates.ts";

const ids = () => {
  let n = 0;
  return () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`;
};
const open = (id: string): WorkingHousehold => fromRequest(modelHousehold(id));
// 車・FP顧問料は、入力のホームでは別々の項目（カード）
const fields = (wh: WorkingHousehold): FieldDef[] => [...allFields(buildStage("car", wh)), ...allFields(buildStage("fee", wh))];
const fieldOf = (wh: WorkingHousehold, suffix: string) => fields(wh).find((f) => f.key.endsWith(suffix)) as FieldDef;

describe("車の入力", () => {
  it("目安の値で足す（推定の印）。値を入れると確定、空にすると目安に戻る", () => {
    const wh = addCar(open("salariedCoupleTwoKids"), ids());
    const car = wh.request.input.household.cars![0]!;
    expect(car.purchase!.owned).toBe(true);
    const price = fieldOf(wh, "/price");
    expect(price.get(wh)).toMatchObject({ value: 2500000 });
    expect(price.get(wh).estimated).toContain("新車の価格");
    const w1 = price.set(wh, 3000000);
    expect(price.get(w1)).toMatchObject({ value: 3000000, estimated: null });
    const w2 = price.set(w1, null);
    expect(price.get(w2).value).toBe(2500000);
    expect(price.get(w2).estimated).toContain("新車の価格");
    expect(() => preview(w1.request)).not.toThrow();
    // 車を入れると支出が増える
    const fin = (r: WorkingHousehold) => financialOf(preview(r.request).table).get(2040) ?? 0;
    expect(fin(w1)).toBeLessThan(fin(open("salariedCoupleTwoKids")));
  });

  it("ローン（頭金の割合・年数・金利）と維持費の入れ方（合計・内訳）、手放す年齢、万一のときの扱い", () => {
    let wh = addCar(open("salariedCoupleTwoKids"), ids());
    wh = fieldOf(wh, "/pay").set(wh, "loan");
    const down = fieldOf(wh, "/down");
    wh = down.set(wh, "0.25");
    expect(wh.request.input.household.cars![0]!.loan).toEqual({ share: "0.75", rate: carLoanRateEstimate().rate, termMonths: 60 });
    wh = fieldOf(wh, "/term").set(wh, 7);
    expect(wh.request.input.household.cars![0]!.loan!.termMonths).toBe(84);
    // ローンの目安は推定の印（借入8割・5年・金利はマスタデータの自動車ローンの目安）。打った欄は印が外れる
    expect(fieldOf(wh, "/rate").get(wh).assumed).toContain(carLoanRateEstimate().basis);
    expect(fieldOf(wh, "/down").get(wh).assumed).toBeNull();
    // 合計 → 内訳（年額の合計は変えない。合計の値は残す。0069）→ 合計（内訳の値は残す）
    const total = upkeepAnnual(wh.request.input.household.cars![0]!);
    wh = fieldOf(wh, "/upkeepMode").set(wh, "detail");
    const c1 = wh.request.input.household.cars![0]!;
    expect(c1.upkeepMode).toBe("detail");
    expect(c1.upkeep).toEqual({ annual: total });
    expect(upkeepAnnual(c1)).toBe(total);
    expect(fieldOf(wh, "/upkeepSum").get(wh).value).toBe(total);
    expect(fieldOf(wh, "/tax").get(wh).estimated).not.toBeNull();
    wh = fieldOf(wh, "/parking").set(wh, 120000);
    expect(upkeepAnnual(wh.request.input.household.cars![0]!)).toBe(total + 120000);
    expect(() => preview(wh.request)).not.toThrow();
    wh = fieldOf(wh, "/upkeepMode").set(wh, "total");
    expect(wh.request.input.household.cars![0]!.upkeep).toEqual({ annual: total });
    expect(wh.request.input.household.cars![0]!.parking).toEqual({ annual: 120000 });
    expect(upkeepAnnual(wh.request.input.household.cars![0]!)).toBe(total);
    // 手放す年齢は名義の人の年齢
    wh = fieldOf(wh, "/untilAge").set(wh, 75);
    const c2 = wh.request.input.household.cars![0]!;
    expect(c2.until).toEqual({ memberAge: { member: c2.owner, years: 75, months: 0 } });
    // 万一のときの扱い（エンジンの onContingency）
    wh = fieldOf(wh, "/on/mode").set(wh, "ratio");
    expect(wh.request.input.household.cars![0]!.onContingency).toEqual({ mode: "ratio", ratio: "0.5" });
    wh = fieldOf(wh, "/on/kinds").set(wh, "all");
    expect(wh.request.input.household.cars![0]!.onContingency?.kinds).toEqual(["death", "disability", "incapacity"]);
    wh = fieldOf(wh, "/on/mode").set(wh, "");
    expect(wh.request.input.household.cars![0]!.onContingency).toBeUndefined();
    expect(() => preview(wh.request)).not.toThrow();
  });

  it("頭金の割合は10進の文字列のまま（1−率）", () => {
    expect(oneMinus("0.2")).toBe("0.8");
    expect(oneMinus("0.401")).toBe("0.599");
    expect(oneMinus("1")).toBe("0");
    expect(oneMinus("0")).toBe("1");
  });
});

describe("FP顧問料の入力", () => {
  const std = (wh: WorkingHousehold) => fields(wh).filter((f) => f.level === "simple").map((f) => f.key.replace(/^ev\/fee\/[^/]+\//, ""));
  it("新しい契約は提案の側だけ（enabled: false）。料金表の標準（単発30万円・翌年の同じ月から月1万円・万一は止める）。払う人は本人", () => {
    let wh = addAdvisoryFee(open("salariedCoupleTwoKids"), ids());
    const c = wh.request.input.household.advisoryFees![0]!;
    const self = wh.request.input.household.members.find((m) => m.kind === "self")!;
    expect(c.enabled).toBe(false);
    expect(c.payer).toBe(self.id);
    expect(c.terms).toEqual({ oneTime: [{ at: { at: "2026-11" }, amount: 300000 }], recurring: { from: { at: "2027-11" }, monthly: 10000, onContingency: { mode: "stop" } } });
    expect(hasAdvisoryFee(wh.request)).toBe(true);
    expect(advisoryFeeInCurrent(wh.request)).toBe(false);
    expect(fieldOf(wh, "/inCurrent").get(wh).value).toBe(false);
    // 現状には入らない（現状の計算に顧問料の行が無い）
    expect(advisoryFeeSummary(preview(wh.request))).toBeNull();
    // 標準の欄は単発の料金と払う年月・継続の顧問料（月額）・終わり（と現状にも入れるか）。払う人・払い方・始まり・万一のときの扱いは詳細、値上げの率は無い
    expect(std(wh)).toEqual(["inCurrent", "one/0/amount", "one/0/at", "rec/monthly", "rec/to"]);
    expect(fields(wh).some((f) => f.key.endsWith("/payer") || f.key.endsWith("/rec/rate"))).toBe(false);
    expect(fieldOf(wh, "/rec/basis").level).toBe("detail");
    expect(fieldOf(wh, "/rec/from").level).toBe("detail");
    expect(fieldOf(wh, "/rec/on/mode").level).toBe("detail");
    wh = fieldOf(wh, "/rec/basis").set(wh, "annual");
    expect(wh.request.input.household.advisoryFees![0]!.terms!.recurring).toMatchObject({ annual: 120000, onContingency: { mode: "stop" } });
    wh = fieldOf(wh, "/inCurrent").set(wh, true);
    expect(wh.request.input.household.advisoryFees![0]!.enabled).toBeUndefined();
    expect(advisoryFeeSummary(preview(wh.request))?.total).toBeGreaterThan(300000);
    expect(feeSummary(wh.request)).toBe("単発30万円＋年額12万円（2027年11月から）");
  });

  it("事務所の料金表から写す: 払い方・○年目からの段階・万一のときの扱い。始まりを動かすと段階も動く", () => {
    const table = { oneTime: 200000, per: "month" as const, amount: 15000, steps: [{ year: 3, amount: 20000 }], onContingency: "continue" as const };
    let wh = addAdvisoryFee(open("salariedCoupleTwoKids"), ids(), table);
    const rec = () => wh.request.input.household.advisoryFees![0]!.terms!.recurring!;
    expect(wh.request.input.household.advisoryFees![0]!.terms!.oneTime).toEqual([{ at: { at: "2026-11" }, amount: 200000 }]);
    expect(rec()).toMatchObject({ from: { at: "2027-11" }, monthly: 15000, onContingency: { mode: "continue" } });
    expect(rec().revision!.steps!.map((x) => [x.at, x.monthly])).toEqual([[{ at: "2029-11" }, 20000]]);
    wh = fieldOf(wh, "/rec/from").set(wh, "2028-01");
    expect(rec().from).toEqual({ at: "2028-01" });
    expect(rec().revision!.steps![0]!.at).toEqual({ at: "2030-01" });
    // 単発の料金が0円の料金表は、単発を入れず翌月から
    const none = addAdvisoryFee(open("salariedCoupleTwoKids"), ids(), { ...table, oneTime: 0, steps: [] }).request.input.household.advisoryFees![0]!.terms!;
    expect(none.oneTime).toBeUndefined();
    expect(none.recurring!.from).toEqual({ at: "2026-11" });
  });

  it("以前に入れた値上げの率・本人のほかの払う人は黙って変えない（計算はそのまま。詳細で見る・外す）", () => {
    const wh = open("advisoryFeeProposal");
    const before = JSON.stringify(wh.request.input.household.advisoryFees);
    const c = wh.request.input.household.advisoryFees![0]!;
    expect(c.terms!.recurring!.revision).toEqual({ rate: "0.02" });
    const rate = fieldOf(wh, `ev/fee/${c.id}/rec/rate`);
    expect(rate.level).toBe("detail");
    expect(rate.get(wh).value).toBe("0.02");
    expect(JSON.stringify(wh.request.input.household.advisoryFees)).toBe(before);
    const stage = buildStage("fee", wh);
    const removeRate = stage.sections.flatMap((x) => x.groups.flatMap((g) => g.actions)).find((a) => a.key === `ev/fee/${c.id}/removeRate`)!;
    const cleared = removeRate.run(wh);
    expect(cleared.request.input.household.advisoryFees![0]!.terms!.recurring!.revision).toBeUndefined();
    const spouse = wh.request.input.household.members.find((m) => m.kind === "spouse")!;
    const other = mutate(wh, (h) => void (h.advisoryFees![0]!.payer = spouse.id));
    expect(fieldOf(other, `ev/fee/${c.id}/payer`).level).toBe("detail");
    expect(buildStage("fee", other).sections[0]!.groups[0]!.title).toContain("が払う");
    expect(buildStage("fee", wh).sections[0]!.groups[0]!.title).toBe("FP顧問料 1");
  });
});

describe("主画面の対策「FP顧問料」の ON/OFF", () => {
  const demo = demoHousehold("salariedCoupleTwoKids")!;
  const wh = addAdvisoryFee(open("salariedCoupleTwoKids"), ids());
  const base = wh.request;
  const self = base.input.household.members.find((m) => m.kind === "self")!;
  const levered = applyLevers(base, self.id, demo.firstProposal, { reemployment: demo.reemployment! });
  const on = applyAdvisoryFee(levered, true);
  const off = applyAdvisoryFee(levered, false);
  const current = preview(base);
  const pOn = preview(on);
  const pOff = preview(off);
  const target = Number(self.birth.birthYearMonth.slice(0, 4)) + 95;

  it("提案の差分として当て、現状（元の要求）は変えない", () => {
    expect(base.input.household.advisoryFees![0]!.enabled).toBe(false);
    expect(on.input.household.advisoryFees![0]!.enabled).toBeUndefined();
    expect(off.input.household.advisoryFees![0]!.enabled).toBe(false);
    expect(JSON.stringify(applyAdvisoryFee(base, false).input.household.advisoryFees)).toBe(JSON.stringify(base.input.household.advisoryFees));
  });

  it("ON と OFF の差が主役の数字と一文に出て、エンジンの結果と一致する", () => {
    const finC = financialOf(current.table).get(target) ?? 0;
    const finOn = financialOf(pOn.table).get(target) ?? 0;
    const finOff = financialOf(pOff.table).get(target) ?? 0;
    expect(finOff).toBeGreaterThan(finOn);
    const cum = advisoryFeeSummary(pOn)!.byYear.filter((b) => b.year <= target).at(-1)!.cumulative;
    expect(cum).toBeGreaterThan(0);
    expect(advisoryFeeSummary(pOff)).toBeNull();
    const mOn = toPresentation({ base, proposal: on, current, proposed: pOn, targetAge: 95, selectedYear: null, provisional: false, fee: { on: true, alt: pOff } });
    const mOff = toPresentation({ base, proposal: off, current, proposed: pOff, targetAge: 95, selectedYear: null, provisional: false, fee: { on: false, alt: pOn } });
    expect(mOn.headline.amount).toBe(finOn);
    expect(mOff.headline.amount).toBe(finOff);
    expect(mOn.headline.diff).toBe(finOn - finC);
    const text = (m: typeof mOn) => m.fee!.parts.map((p) => p.text).join("");
    const man = (n: number) => Math.round(Math.abs(n) / 10000).toLocaleString("en-US");
    // 一文には顧問料の累計の額を出さない
    expect(text(mOn)).not.toContain("累計");
    expect(text(mOff)).not.toContain("累計");
    expect(text(mOn)).not.toContain(`${man(cum)}万円）`);
    expect(text(mOn)).toContain(`${man(finOn - finC)}万円${finOn - finC >= 0 ? "多い" : "少ない"}`);
    expect(text(mOn)).toContain(`顧問料を除くと${man(finOff - finC)}万円`);
    expect(text(mOff)).toContain("FP顧問料を含めない試算です");
    expect(text(mOff)).toContain(`${man(finOn - finC)}万円`);
    // 提示層の部品で描くと一文が出る
    const html = renderToString(h(FeeNote, { model: mOn.fee! }));
    expect(html).toContain("顧問料込み");
    expect(html).toContain("data-fee-note");
  });

  it("顧問料の契約が無ければ一文は出さない", () => {
    const b = modelHousehold("salariedCoupleTwoKids");
    const p = preview(b);
    expect(toPresentation({ base: b, proposal: b, current: p, proposed: p, targetAge: 95, selectedYear: null, provisional: false }).fee).toBeNull();
  });
});
