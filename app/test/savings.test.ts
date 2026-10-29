// 資産運用の入力（0026）: 入れ方の切り替えと引き継ぎ・まだ分けていない分・期間を分けた積立・積立をやめる年・NISA の枠の見込み・
// 動かす項目（毎月の積立額・取り崩し）・資産の推移の値（口座の内訳・運用の期間の帯・何歳まで持つか）・取り崩しの計算
import { describe, expect, it } from "vitest";
import type { EngineRequest, PreviewResult } from "../src/engine/types.ts";
import { fromRequest } from "../src/workspace/input/household.ts";
import { accountsOf, dropDoneUnallocated, editTotal, hasUnallocated, methodOf, nisaHitOf, pooledOf, setStopAge, stepsOf, stopAgeOf, stopEstimateOf, switchMethod, totalViewOf, unallocatedOf, writeSteps } from "../src/workspace/input/savings/model.ts";
import { allFields } from "../src/workspace/input/form.ts";
import { buildStage } from "../src/workspace/input/stages/index.ts";
import { lastsMatches, lastsText, maxDrawdown, maxMatches, USE_TARGETS, usedText, useOfLasts, useOfMax, useTargetKeys, useTargetText, withDrawdown, type CalcInputs, type LastsAnswer } from "../src/workspace/invest/DrawdownCalc.tsx";
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

describe("取り崩しの計算の答えと「対策に入れる」（何歳まで持つかの行にも出す。0026 の 2026-10-29 の追記）", () => {
  const inputs: CalcInputs = { method: "fixed", startAge: 65, amount: 15, permille: 40, target: 95 };
  const fixed: LastsAnswer = { method: "fixed", startAge: 65, amount: 15, permille: 40, age: 92 };
  it("何歳まで持つかの行の「対策に入れる」は、その行に入れた額（定額は毎月の円、定率は毎年の率）と始める年齢を入れる", () => {
    expect(useOfLasts(fixed)).toEqual({ method: "fixed", value: 150000, startAge: 65 });
    expect(useOfLasts({ method: "rate", startAge: 70, amount: 15, permille: 35, age: 100 })).toEqual({ method: "rate", value: "0.035", startAge: 70 });
    expect(useOfMax({ method: "fixed", startAge: 65, target: 95, v: 18 })).toEqual({ method: "fixed", value: 180000, startAge: 65 });
    expect(useOfMax({ method: "rate", startAge: 65, target: 95, v: 40 })).toEqual({ method: "rate", value: "0.04", startAge: 65 });
    expect(useOfMax({ method: "fixed", startAge: 65, target: 95, v: null })).toBeNull();
    expect(lastsText(fixed)).toBe("65歳から毎月15万円取り崩すと、金融資産は 92歳 まで持ちます");
  });
  it("入力を変えると古い答えは出さない（定率の答えを、定額を選んだ画面に出さない）", () => {
    expect(lastsMatches(fixed, inputs)).toBe(true);
    // 持たせる年齢は何歳まで持つかの答えに関係しない
    expect(lastsMatches(fixed, { ...inputs, target: 100 })).toBe(true);
    // 定額なら率を変えても答えは変わらない
    expect(lastsMatches(fixed, { ...inputs, permille: 50 })).toBe(true);
    for (const changed of [{ method: "rate" as const }, { startAge: 70 }, { amount: 20 }]) expect(lastsMatches(fixed, { ...inputs, ...changed }), JSON.stringify(changed)).toBe(false);
    const rate: LastsAnswer = { method: "rate", startAge: 65, amount: 15, permille: 40, age: 100 };
    expect(lastsMatches(rate, inputs)).toBe(false);
    expect(lastsMatches(rate, { ...inputs, method: "rate" })).toBe(true);
    expect(lastsMatches(rate, { ...inputs, method: "rate", permille: 45 })).toBe(false);
    const max = { method: "fixed" as const, startAge: 65, target: 95, v: 18 };
    expect(maxMatches(max, inputs)).toBe(true);
    // 額・率は持たせる年齢の行の答えに関係しない
    expect(maxMatches(max, { ...inputs, amount: 30 })).toBe(true);
    for (const changed of [{ method: "rate" as const }, { startAge: 70 }, { target: 100 }]) expect(maxMatches(max, { ...inputs, ...changed }), JSON.stringify(changed)).toBe(false);
  });
});

describe("もう退職した人の積立をやめる年（エンジンの読み方と同じ）", () => {
  /** 本人が2020年12月に退職した世帯（計算基準月は2026年10月） */
  const retired = (drawdown = true) => {
    const req = structuredClone(modelHousehold("investmentCouple"));
    const p = (req.input.household.employmentPeriods ?? []).find((x) => x.member === selfId(req));
    if (p !== undefined) p.to = { at: "2020-12" };
    const inv = req.input.assumptions?.investment;
    if (!drawdown && inv !== undefined) delete inv.drawdown;
    return req;
  };
  const stopField = (req: EngineRequest) => {
    const wh = fromRequest(req);
    const stage = buildStage("savings", wh);
    const f = allFields(stage).find((x) => x.key === "sav/stopAge");
    const group = stage.sections.flatMap((s) => s.groups).find((g) => g.key === "sav/period");
    return { state: f?.get(wh), note: group?.note };
  };

  it("退職がこれからなら、空欄は退職の年まで", () => {
    expect(stopEstimateOf(modelHousehold("investmentCouple"))).toEqual({ age: 60, retired: false, until: "退職の年（60歳）" });
  });

  it("もう退職していれば、空欄は取り崩しを始める前まで（取り崩しの予定が無ければ最後まで）。欄にそう書く", () => {
    expect(stopEstimateOf(retired())).toEqual({ age: 65, retired: true, until: "取り崩しを始める前（65歳）" });
    expect(stopField(retired()).state?.estimated).toBe("退職の年はもう過ぎているので、空欄は取り崩しを始める前（65歳）まで積み立てる計算");
    expect(stopEstimateOf(retired(false))).toMatchObject({ retired: true, until: "最後" });
    expect(stopField(retired(false)).state?.hint).toBe("最後まで（推定）");
  });

  it("積立をやめる年齢が今の年齢以下なら、積立が計算に入っていないことを知らせる", () => {
    expect(stopField(retired()).note).toBeUndefined();
    const req = retired();
    setStopAge(req.input.household, req.input.baseMonth, 40);
    expect(stopField(req).note).toContain("積立は計算に入っていません");
  });
});

describe("「対策に入れる」で入れる先を押す前に知らせる（0026 の 2026-10-29 の追記）", () => {
  it("対策に無い項目は「足します」、もうある項目は「変えます」。定率は毎年の取り崩し率", () => {
    expect(useTargetText("fixed", () => false)).toBe("押すと、対策の「取り崩しを始める年齢」と「毎月の取り崩し額」を足します");
    expect(useTargetText("fixed", () => true)).toBe("押すと、対策の「取り崩しを始める年齢」と「毎月の取り崩し額」を変えます");
    expect(useTargetText("rate", (k) => k === "inv:wStart")).toBe("押すと、対策の「取り崩しを始める年齢」を変え、「毎年の取り崩し率」を足します");
    expect(useTargetKeys("rate")).toEqual(["inv:wStart", "inv:wRate"]);
  });
  it("押した後は入れた値を知らせる", () => {
    expect(usedText({ method: "fixed", value: 150000, startAge: 65 })).toBe("対策に入れました: 取り崩しを始める年齢 65歳・毎月の取り崩し額 15万円");
    expect(usedText({ method: "rate", value: "0.035", startAge: 70 })).toBe("対策に入れました: 取り崩しを始める年齢 70歳・毎年の取り崩し率 3.5%");
  });
  it("入れる先のキーは対策の項目のキーと名前にそろっている", () => {
    const wh = open();
    const cat = buildCatalog(wh, selfId(wh.request), null);
    for (const t of Object.values(USE_TARGETS)) expect(cat.byKey.get(t.key)?.label, t.key).toBe(t.label);
  });
});
