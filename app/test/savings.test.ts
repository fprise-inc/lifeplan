// 資産運用の入力（0026）: 入れ方の切り替えと引き継ぎ・まだ分けていない分・期間を分けた積立・積立をやめる年・NISA の枠の見込み・
// 動かす項目（毎月の積立額・取り崩し）・資産の推移の値（口座の内訳・運用の期間の帯・何歳まで持つか）・取り崩しの計算
import { describe, expect, it } from "vitest";
import type { EngineRequest, PreviewResult } from "../src/engine/types.ts";
import { fromRequest } from "../src/workspace/input/household.ts";
import { accountsOf, dropDoneUnallocated, editTotal, hasUnallocated, methodOf, nisaHitOf, pooledOf, setStopAge, stepsOf, stopAgeOf, switchMethod, totalViewOf, unallocatedOf, writeSteps } from "../src/workspace/input/savings/model.ts";
import { maxDrawdown, withDrawdown } from "../src/workspace/invest/DrawdownCalc.tsx";
import { DEFAULT_DISPLAY_SETTINGS } from "../src/workspace/settings.ts";
import { bandOf, breakdownOf, donutShown, investVerdict, lastsAge, stressRequests } from "../src/workspace/invest/present.ts";
import { buildCatalog } from "../src/workspace/plans/items.ts";
import { modelHousehold } from "./helpers.ts";

const open = () => fromRequest(modelHousehold("investmentCouple"));
const selfId = (r: EngineRequest) => r.input.household.members.find((m) => m.kind === "self")?.id as string;

describe("入れ方の切り替え（合計・口座・資産配分）", () => {
  it("合計にすると口座の値を足したまとめた器を作り、口座の入力は消さない。口座に戻すとまだ分けていない分が0なら外す", () => {
    const wh = open();
    expect(methodOf(wh.request)).toBe("accounts");
    const t = switchMethod(wh, "total");
    expect(methodOf(t.request)).toBe("total");
    expect(pooledOf(t.request.input.household)?.marketValue?.value).toBe(11_400_000);
    expect(accountsOf(t.request.input.household).length).toBe(5);
    expect(totalViewOf(t.request).steps[0]?.monthly).toBe(57_000);
    const back = switchMethod(t, "accounts");
    expect(pooledOf(back.request.input.household)).toBeUndefined();
  });

  it("合計を増やして口座にすると「まだ分けていない」に差が入り、口座に入れると減って0で消える", () => {
    let wh = editTotal(switchMethod(open(), "total"), { value: 15_000_000 });
    wh = switchMethod(wh, "accounts");
    const un = unallocatedOf(wh.request);
    expect(un?.value).toBe(3_600_000);
    expect(hasUnallocated(un)).toBe(true);
    const req = structuredClone(wh.request);
    const tx = req.input.household.accounts?.find((a) => a.kind === "taxable");
    if (tx?.marketValue !== undefined) tx.marketValue.value = 800_000 + 3_600_000;
    expect(dropDoneUnallocated(req.input.household, req)).toBe(true);
    expect(pooledOf(req.input.household)).toBeUndefined();
  });
});

describe("期間を分けた積立と積立をやめる年", () => {
  it("NISA のつみたて投資枠は3つの期間（45〜49歳・50〜54歳・55歳〜）。積立をやめる年は空欄（退職の年まで）", () => {
    const wh = open();
    const h = wh.request.input.household;
    const nisa = accountsOf(h).find((a) => a.kind === "nisa");
    expect(stepsOf(h, wh.request.input.baseMonth, nisa!, "tsumitate")).toEqual([
      { fromAge: 45, monthly: 30000 },
      { fromAge: 50, monthly: 50000 },
      { fromAge: 55, monthly: 70000 },
    ]);
    expect(stopAgeOf(h)).toBeNull();
  });

  it("積立をやめる年を入れると、どの積立の最後の期間もその年齢の前の月で終わる（途中の期間はそのまま）", () => {
    const req = structuredClone(open().request);
    const h = req.input.household;
    setStopAge(h, req.input.baseMonth, 58);
    expect(stopAgeOf(h)).toBe(58);
    const nisa = accountsOf(h).find((a) => a.kind === "nisa")!;
    expect(stepsOf(h, req.input.baseMonth, nisa, "tsumitate").map((s) => s.fromAge)).toEqual([45, 50, 55]);
    expect(nisa.contributions?.filter((c) => c.tranche !== "growth").at(-1)?.to).toEqual({ at: "2039-06" });
    setStopAge(h, req.input.baseMonth, null);
    expect(stopAgeOf(h)).toBeNull();
  });

  it("期間を足す・消すと、積立の予定が書き換わる", () => {
    const req = structuredClone(open().request);
    const h = req.input.household;
    const dep = accountsOf(h).find((a) => a.kind === "deposit")!;
    writeSteps(h, req.input.baseMonth, dep, "all", [{ fromAge: 45, monthly: 10000 }, { fromAge: 52, monthly: 20000 }], null);
    expect(dep.contributions).toEqual([
      { from: { at: "2026-10" }, to: { at: "2033-06" }, monthly: 10000 },
      { from: { at: "2033-07" }, to: null, monthly: 20000 },
    ]);
  });
});

describe("NISA の枠の見込み", () => {
  it("積立を増やすと、生涯の枠を使い切る年を知らせる", () => {
    expect(nisaHitOf(open().request)).toBeNull();
    const req = structuredClone(open().request);
    const nisa = req.input.household.accounts?.find((a) => a.kind === "nisa");
    for (const c of nisa?.contributions ?? []) if (c.tranche !== "growth") c.monthly = 150_000;
    const hit = nisaHitOf(req);
    expect(hit?.kind).toBe("lifetime");
    expect(hit?.year).toBeGreaterThan(2030);
  });
});

describe("動かす項目（資産運用）", () => {
  it("毎月の積立額を増やすと、NISA のつみたて投資枠のどの期間にも同じだけ足す", () => {
    const wh = open();
    const cat = buildCatalog(wh, selfId(wh.request), null);
    const it = cat.byKey.get("inv:monthly")!;
    expect(it.read(wh)).toBe(57_000);
    const w = it.apply(wh, 77_000);
    const nisa = w.request.input.household.accounts?.find((a) => a.kind === "nisa");
    expect(nisa?.contributions?.filter((c) => c.tranche !== "growth").map((c) => c.monthly)).toEqual([50000, 70000, 90000]);
  });

  it("取り崩しの額・始める年齢・積立をやめる年齢・利回りは、案の前提と積立にだけ入る", () => {
    const wh = open();
    const cat = buildCatalog(wh, selfId(wh.request), null);
    const w1 = cat.byKey.get("inv:wAmt")!.apply(wh, 130_000);
    expect(w1.request.input.assumptions?.investment?.drawdown?.monthly).toBe(130_000);
    const w2 = cat.byKey.get("inv:wStart")!.apply(wh, 70);
    expect(w2.request.input.assumptions?.investment?.drawdown?.start).toEqual({ at: "2051-07" });
    const w3 = cat.byKey.get("inv:stop")!.apply(wh, 55);
    expect(stopAgeOf(w3.request.input.household)).toBe(55);
    const w4 = cat.byKey.get("inv:rate")!.apply(wh, "0.03");
    expect(w4.request.input.assumptions?.returnShifts?.length).toBe(1);
    expect(wh.request.input.assumptions?.returnShifts).toBeUndefined();
  });
});

/** 年ごとの金融資産から、結果の表の形にする（テスト用） */
const resultOf = (fin: Record<number, number>, extra: { row: string; year: number; amount: number }[] = []): PreviewResult => ({ table: [...Object.entries(fin).map(([y, v]) => ({ row: "cf.balance.financial", year: Number(y), amount: v })), ...extra] }) as unknown as PreviewResult;

describe("資産の推移の値", () => {
  it("何歳まで持つか: 尽きる年の前の年の年齢。尽きなければ表の最後の年", () => {
    const req = open().request;
    const years = [2080, 2081];
    expect(lastsAge(req, resultOf({ 2080: 100, 2081: -5 }).table, years)).toBe(99);
    expect(lastsAge(req, resultOf({ 2080: 100, 2081: 5 }).table, years)).toBe(100);
    const v = investVerdict({ selected: "プランA", base: "プランA", same: true }, { req, table: resultOf({ 2080: 1, 2081: -1 }).table }, null, years);
    expect(v.parts.map((p) => p.text).join("")).toBe("金融資産は 99歳 まで持ちます");
    expect(v.sub[0]?.text).toBe("65歳から毎月17万円ずつ取り崩す場合");
  });

  it("口座の内訳は器の種類ごとの残高の行をまとめる（預金の不足は0として積む）", () => {
    const r = resultOf({}, [
      { row: "cf.balance.account.deposit", year: 2030, amount: -10 },
      { row: "cf.balance.account.nisa", year: 2030, amount: 300 },
      { row: "cf.balance.account.legacyNisa", year: 2030, amount: 50 },
      { row: "cf.balance.account.realEstate", year: 2030, amount: 999 },
    ]);
    expect(breakdownOf(r.table, [2030])).toEqual([{ key: "nisa", label: "NISA", values: [350] }]);
  });

  it("結果の画面の資産の内訳（ドーナツ）は「口座の内訳を表示」にチェックが入っているときだけ出す（既定は出さない）", () => {
    expect(donutShown(DEFAULT_DISPLAY_SETTINGS.invBreakdown, true, false)).toBe(false);
    expect(donutShown(true, true, false)).toBe(true);
    // チェックを出さない入れ方（合計）では出さない
    expect(donutShown(true, false, false)).toBe(false);
    // 全部のプランを色分けで重ねる表示では、チェックがオンのままでも出さない（チェックそのものを出さない）
    expect(donutShown(true, true, true)).toBe(false);
  });

  it("運用の期間の帯: 積み立てる（推定あり）・据え置く・取り崩す。積立額が変わる年に区切り", () => {
    const req = open().request;
    const ages = Array.from({ length: 30 }, (_, i) => 46 + i);
    const b = bandOf(req, ages);
    expect(b?.stopAge).toBe(60);
    expect(b?.estimated).toBe(true);
    expect(b?.accumEnd).toBe(14);
    expect(b?.wdStart).toBe(19);
    expect(b?.steps.map((s) => s.label)).toEqual(["月5.7万", "月7.7万", "月9.7万"]);
    expect(b?.wdSub).toBe("65歳〜 月17万円");
  });

  it("相場が下がった場合の3つの型（退職の年に株などが3割・取り崩しを始めてから10年 年0.5%・ずっと1%低い）", () => {
    const sr = stressRequests(open().request);
    expect(sr.drop.input.stressTest).toEqual({ template: "marketDropAtRetirement", params: { year: 2041, drop: "0.3", assetClasses: ["equity.domestic", "equity.global", "reit.domestic", "reit.global"] } });
    expect(sr.low.input.stressTest).toEqual({ template: "lowReturnPeriod", params: { year: 2046, years: 10, cap: "0.005" } });
    expect(sr.minus1.input.stressTest).toEqual({ template: "returnShortfall", params: { add: "-0.01" } });
  });
});

describe("取り崩しの計算（○歳まで持たせるなら毎月いくらまで）", () => {
  it("額を半分ずつ絞り込み、持つ最大の額（1万円の刻み）を返す。0でも届かなければ null", async () => {
    const req = open().request;
    const years = [2080];
    // 見本の計算: 毎月 X 万円なら、金融資産は 100−X（0未満で尽きる）
    const compute = async (r: EngineRequest) => {
      const m = (r.input.assumptions?.investment?.drawdown?.monthly ?? 0) / 10000;
      return resultOf({ 2080: 100 - m });
    };
    // 99歳（2080年）まで持てばよい: 2080年に0以上なら持つ
    expect(await maxDrawdown(compute, req, years, "fixed", 65, 99)).toBe(100);
    expect(withDrawdown(req, { method: "fixed", startAge: 65, monthly: 50000 }).input.assumptions?.investment?.drawdown?.monthly).toBe(50000);
    expect(await maxDrawdown(async () => resultOf({ 2080: -1 }), req, years, "fixed", 65, 100)).toBeNull();
  });
});
