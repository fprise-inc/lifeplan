// 万一の想定の画面: 前提の欄の往復（世帯データ → 入力の表示 → 値を変える → 戻す）、要求の作り方、提示用の値がエンジンの結果と一致すること
import { renderToString } from "preact-render-to-string";
import { h } from "preact";
import { describe, expect, it } from "vitest";
import type { EngineRequest, ProtectionOutput } from "../src/engine/types.ts";
import { ContingencyChartCard, LOADING_DELAY_MS, ScenarioBand, YearStrip } from "../src/presentation/ContingencyView.tsx";
import type { ContingencyModel } from "../src/presentation/model.ts";
import { contingencyInputSections, oldAgeChoiceField } from "../src/workspace/contingency/inputs.ts";
import { planFromRequest } from "../src/workspace/contingency/planData.ts";
import { chosenCombinations, inheritanceText, protectionChart, scenarioCards, scenarioModel, yearOptions, yearStripModel } from "../src/workspace/contingency/present.ts";
import { PremisePanel } from "../src/workspace/contingency/PremisePanel.tsx";
import { baseRequest, chartRequests, protectionRequest, scenarioRequest, scenarios } from "../src/workspace/contingency/requests.ts";
import type { FieldDef, Val } from "../src/workspace/input/form.ts";
import { fromRequest, type WorkingHousehold } from "../src/workspace/input/household.ts";
import { sameRate } from "../src/workspace/input/units.ts";
import { sumByYear } from "../src/workspace/present.ts";
import { man } from "../src/presentation/format.ts";
import { modelHousehold, preview } from "./helpers.ts";

const open = (id: string, memo: string[] = []): WorkingHousehold => fromRequest(modelHousehold(id), { memo });
const planFields = (wh: WorkingHousehold): FieldDef[] => contingencyInputSections(wh).flatMap((s) => s.groups.flatMap((g) => g.fields));
const field = (wh: WorkingHousehold, key: string) => planFields(wh).find((f) => f.key === key) as FieldDef;

/** 前提の欄に入れる別の値 */
function other(f: FieldDef, v: Val): Val | undefined {
  if (f.kind === "pct") return v === "0.6" ? "0.65" : "0.6";
  if (f.kind === "yen") return v === null ? 2000000 : (v as number) + 10000;
  if (f.kind === "int") return v === null ? Math.max(f.min ?? 0, 6) : (v as number) + 1 <= (f.max ?? 999) ? (v as number) + 1 : (v as number) - 1;
  if (f.kind === "select") return f.options.find((o) => o.value !== v && o.value !== "")?.value;
  return undefined;
}

describe("万一の想定の前提の欄", () => {
  const MODELS = ["salariedCoupleTwoKids", "survivorEmployeeLoan", "protectionNeed", "incapacityDisability", "dualNoKids", "single45"];
  it.each(MODELS)("%s: 値を変えて戻すと元に戻る（前提だけが変わり、世帯の要求は変わらない）", (id) => {
    let wh = open(id);
    // 働き方の変化の欄を出すため、残された人の働き方を一度「正社員」にした世帯でも確かめる
    for (const pass of [0, 1]) {
      if (pass === 1) {
        for (const f of planFields(wh).filter((x) => x.key.endsWith("/type"))) wh = f.set(wh, "regular");
        wh = field(wh, "cg/horizon/kind").set(wh, "age");
      }
      const before = JSON.stringify(wh.request);
      for (const f of planFields(wh)) {
        const s = f.get(wh);
        // 同じ値を入れ直しても変わらない
        expect(f.set(wh, s.value), f.key).toEqual(wh);
        if (f.readOnly !== undefined || f.structural === true || f.key.startsWith("housing/")) continue;
        const v2 = other(f, s.value);
        if (v2 === undefined) continue;
        const w1 = f.set(wh, v2);
        const got = f.get(w1).value;
        if (f.kind === "pct") expect(sameRate(got as string, v2 as string), f.key).toBe(true);
        else expect(got, f.key).toBe(v2);
        expect(w1.request, f.key).toEqual(wh.request);
        expect(w1.contingency, f.key).not.toEqual(wh.contingency);
        const w2 = f.set(w1, s.implicit === true ? null : s.value);
        expect(w2, f.key).toEqual(wh);
      }
      expect(JSON.stringify(wh.request)).toBe(before);
    }
  });

  it("団信の欄は住まい・ローンの段階と同じ（どちらで直しても同じ住宅ローンが変わる）", () => {
    const wh = open("survivorEmployeeLoan");
    const debt = wh.request.input.household.debts!.find((d) => d.kind === "mortgage")!;
    const inc = planFields(wh).find((f) => f.key === `housing/debt/${debt.id}/clIncapacity`)!;
    expect(inc.get(wh).value).toBe(false);
    const w1 = inc.set(wh, true);
    expect(w1.request.input.household.debts!.find((d) => d.id === debt.id)!.creditLife!.events).toEqual(["death", "highDisability", "incapacity"]);
    expect(inc.set(w1, false)).toEqual(wh);
  });

  it("世帯に入っていた万一の想定・必要保障額の前提を、初めの前提として読む（世帯は書き換えない）", () => {
    const p1 = planFromRequest(modelHousehold("survivorEmployeeLoan"));
    expect(p1.survivor).toEqual({ funeral: 2000000, deathBenefits: { retirementAllowance: 6000000, condolence: 500000 } });
    expect(p1.year).toBe(2031);
    const p2 = planFromRequest(modelHousehold("protectionNeed"));
    expect(p2.survivor).toEqual({ funeral: 2000000, reserveMonths: 6 });
    const p3 = planFromRequest(modelHousehold("incapacityDisability"));
    expect(p3.grade).toBeUndefined(); // 2級（省略の既定）
    expect(p3.medical).toEqual({ monthly: 400000, months: 6 });
  });
});

describe("万一の画面の要求", () => {
  const wh = open("salariedCoupleTwoKids");
  const hh = wh.request.input.household;
  const self = hh.members.find((m) => m.kind === "self")!;
  const spouse = hh.members.find((m) => m.kind === "spouse")!;

  it("想定: 大人ごとの死亡と就業不能・大人ごとの大きな病気・収入が減る・（運用する口座があれば）相場の下落。万一なしは世帯の万一の想定・必要保障額の要求を外す", () => {
    expect(scenarios(wh).map((s) => s.label)).toEqual(["ご本人の死亡", "配偶者の死亡", "就業不能（ご本人）", "就業不能（配偶者）", "大きな病気（ご本人）", "大きな病気（配偶者）", "収入が減る", "相場の下落"]);
    expect(scenarios(open("investmentCouple")).map((s) => s.key)).toEqual(["death:self", "death:spouse", "disability:self", "disability:spouse", "illness:self", "illness:spouse", "income", "market"]);
    const b = baseRequest(modelHousehold("survivorEmployeeLoan"));
    expect(b.input.contingencies).toBeUndefined();
    expect(b.input.protection).toBeUndefined();
    expect(scenarios(open("single45")).map((s) => s.key)).toEqual(["disability:self", "illness:self", "income", "market"]);
  });

  it("前提（遺族の生活費の割合・整理資金・期間）は必要保障額と死亡の想定の両方に入る。残された配偶者の働き方は死亡の想定にだけ", () => {
    let w = field(wh, "cg/living/before").set(wh, "0.6");
    w = field(w, "cg/lump/funeral").set(w, 2000000);
    w = field(w, "cg/horizon/kind").set(w, "youngestIndependence");
    w = field(w, `cg/work/${spouse.id}/type`).set(w, "regular");
    w = field(w, `cg/work/${spouse.id}/salary`).set(w, 3600000);
    const p = protectionRequest(w, self.id);
    expect(p.input.protection).toEqual({ members: [self.id], method: "accumulation", survivor: { livingRatio: { beforeIndependence: "0.6" }, funeral: 2000000 }, horizon: { kind: "youngestIndependence" } });
    const sc = scenarios(w).find((s) => s.key === "death:self")!;
    const r = scenarioRequest(w, sc, 2030);
    const c = r.input.contingencies![0]!;
    expect(c).toMatchObject({ kind: "death", member: self.id, occurs: { at: "2030-01" }, survivor: { funeral: 2000000, livingRatio: { beforeIndependence: "0.6" } } });
    const work = c.survivor!.spouseWork![0]!;
    expect(work).toMatchObject({ member: spouse.id, from: { at: "2030-07" }, type: "regular" });
    expect(work.salary?.annual.value).toBe(3600000);
    // 計算でき、残された配偶者の給与が変わる
    const res = preview(r);
    const none = preview(scenarioRequest(wh, sc, 2030));
    const sal = (t: typeof res) => sumByYear(t.table, (x) => x.row.startsWith("cf.income.salary") && x.member === spouse.id).get(2032) ?? 0;
    expect(sal(res)).toBeGreaterThan(sal(none));
    expect(() => preview(p)).not.toThrow();
  });

  it("等級の仮定・医療費・組み合わせの選び直しは障害の想定にだけ入る（等級なしは就業不能）", () => {
    let w = field(wh, "cg/disability/grade").set(wh, "1");
    w = field(w, "cg/disability/medical").set(w, 300000);
    w = oldAgeChoiceField(self.id).set(w, "oldAge");
    const sc = scenarios(w).find((s) => s.key === "disability:self")!;
    expect(scenarioRequest(w, sc, 2028).input.contingencies![0]).toMatchObject({ kind: "disability", grade: 1, oldAgeChoice: "oldAge", medical: { monthly: 300000, months: 12 } });
    const w0 = field(w, "cg/disability/grade").set(w, "0");
    const c0 = scenarioRequest(w0, sc, 2028).input.contingencies![0]!;
    expect(c0.kind).toBe("incapacity");
    expect(c0.grade).toBeUndefined();
    expect(c0.oldAgeChoice).toBeUndefined();
    expect(() => preview(scenarioRequest(w0, sc, 2028))).not.toThrow();
  });
});

describe("提示用の値がエンジンの結果と一致する", () => {
  const wh = open("salariedCoupleTwoKids");
  const req = wh.request;
  const self = req.input.household.members.find((m) => m.kind === "self")!;
  const spouse = req.input.household.members.find((m) => m.kind === "spouse")!;

  it("必要保障額の推移（金融資産を含む・含まない・死亡保険金）はエンジンの protection のまま", () => {
    for (const m of [self, spouse]) {
      const pr = protectionRequest(wh, m.id);
      const r = preview(pr);
      const out = r.protection as ProtectionOutput;
      const c = protectionChart(pr, out, r, m.id)!;
      const ys = out.members[0]!.years;
      expect(c.years).toEqual(ys.map((y) => y.year));
      expect(c.need).toEqual(ys.map((y) => y.need));
      expect(c.needWithAssets).toEqual(ys.map((y) => y.needWithAssets));
      expect(c.coverage).toEqual(ys.map((y) => y.coverage));
      // 2028年4月以後に亡くなる年からは、遺族年金の見直し前の知らせ
      expect(c.reformFrom).toBe(2029);
    }
  });

  it("死亡の想定: 主役の数字・遺族年金の内訳は表と一致し、2028年4月以後の死亡には見直し前の知らせを出す", () => {
    const sc = scenarios(wh).find((s) => s.key === "death:self")!;
    const none = preview(baseRequest(req));
    for (const year of [2027, 2030]) {
      const result = preview(scenarioRequest(wh, sc, year));
      const m = scenarioModel({ req, scenario: sc, year, result, none, targetAge: 95, choice: undefined });
      const target = Number(self.birth.birthYearMonth.slice(0, 4)) + 95;
      const fin = sumByYear(result.table, (c) => c.row === "cf.balance.financial");
      expect(m.headline.amount).toBe(fin.get(target));
      const sp = sumByYear(result.table, (c) => c.row === "cf.income.pension.survivor");
      const row = m.breakdown.rows.find((r) => r.label === "遺族年金")!;
      expect(row.firstYear).toBe(sp.get(year + 1));
      expect(row.total).toBe([...sp.entries()].filter(([y]) => y >= year && y >= 2027).reduce((s, [, v]) => s + v, 0));
      expect(m.notices.some((n) => n.includes("見直し前"))).toBe(year >= 2029);
      // 残された人の年金の月額の一言（エンジンの結果の年金の行を読むだけ。0071）
      const pen = sumByYear(result.table, (c) => c.member === spouse.id && c.row.startsWith("cf.income.pension"));
      expect(m.notices[0]).toContain(`月${man(Math.round((pen.get(year + 1) ?? 0) / 12))}万円（${year + 1}年。遺族年金を含む`);
      expect(m.chart.proposal).toEqual(m.chart.years.map((y) => fin.get(y) ?? 0));
    }
  });

  it("障害の想定: 65歳からの組み合わせ（自動は「選びました」、選び直しはその組み合わせ）", () => {
    const sc = scenarios(wh).find((s) => s.key === "disability:self")!;
    const none = preview(baseRequest(req));
    const auto = preview(scenarioRequest(wh, sc, 2027));
    const m = scenarioModel({ req, scenario: sc, year: 2027, result: auto, none, targetAge: 95, choice: undefined });
    expect(m.choice).toContain("手取りが多い組み合わせ");
    expect(m.choice).toContain("選びました");
    for (const c of ["oldAge", "disability"] as const) {
      const w = oldAgeChoiceField(self.id).set(wh, c);
      const r = preview(scenarioRequest(w, sc, 2027));
      expect(chosenCombinations(req, r.table, self.id).map((x) => x.combination)).toEqual([c]);
      const mm = scenarioModel({ req, scenario: sc, year: 2027, result: r, none, targetAge: 95, choice: c });
      expect(mm.choice).toContain("選び直した");
    }
  });

  it("提示層の部品で描ける。物の ID・FP用のメモは出ない", () => {
    const memoWh = open("salariedCoupleTwoKids", ["MEMO-MARK-cg"]);
    const sc = scenarios(memoWh).find((s) => s.key === "death:self")!;
    const pr = protectionRequest(memoWh, self.id);
    const r = preview(pr);
    const chart = protectionChart(pr, r.protection!, r, self.id)!;
    const none = preview(baseRequest(req));
    const result = preview(scenarioRequest(memoWh, sc, 2030));
    const protection: ContingencyModel["protection"] = { status: "ready", charts: [chart], error: null, ms: 100 };
    const scenario: ContingencyModel["scenario"] = { status: "ready", model: scenarioModel({ req, scenario: sc, year: 2030, result, none, targetAge: 95, choice: undefined }), error: null, stale: false };
    const model: ContingencyModel = {
      protection,
      scenarios: scenarioCards({ req, scenarios: scenarios(memoWh), selected: sc.key, protection, grade: undefined }),
      selected: sc.key,
      year: 2030,
      strip: yearStripModel({ options: yearOptions(req, self.id).map((o) => ({ value: o.value, age: o.age })), results: [], who: "ご本人", noneDepletion: undefined, stale: false }),
      scenario,
    };
    const card = (mode: "assets" | "protection") => renderToString(h(ContingencyChartCard, { model, mode, onMode: () => undefined, pinnedYear: 2030, onPinYear: () => undefined, onPick: () => undefined }));
    const html = renderToString(h(ScenarioBand, { model, onSelect: () => undefined })) + card("assets") + card("protection");
    expect(html).toContain("ご本人が亡くなったら");
    expect(html).toContain("保障の不足 最大");
    expect(html).toContain("2030年に亡くなった場合");
    expect(html).toContain("必要保障額の推移");
    expect(html).toContain("ご本人が2030年に亡くなった場合");
    expect(html).toContain("見直し前の制度");
    expect(html).not.toContain("MEMO-MARK");
    for (const m of req.input.household.members) expect(html).not.toContain(m.id);
  });

  it("計算中: 短い計算（300ミリ秒未満）では「計算しています」を出さず、同じ高さの空きを置く。長くかかるときだけ出す", () => {
    const wh = open("salariedCoupleTwoKids");
    const scs = scenarios(wh);
    const protection: ContingencyModel["protection"] = { status: "loading", charts: [], error: null, ms: null };
    const scenario: ContingencyModel["scenario"] = { status: "loading", model: null, error: null, stale: false };
    const strip = yearStripModel({ options: [{ value: 2030, age: 40 }], results: [{ state: "pending" }], who: "ご本人", noneDepletion: undefined, stale: false });
    const model: ContingencyModel = { protection, scenarios: scenarioCards({ req, scenarios: scs, selected: scs[0]!.key, protection, grade: undefined }), selected: scs[0]!.key, year: 2030, strip, scenario };
    expect(LOADING_DELAY_MS).toBe(300);
    // 描いた直後（待ちの時間の前）は出さない
    expect(renderToString(h(ScenarioBand, { model, onSelect: () => undefined }))).not.toContain("計算しています");
    expect(renderToString(h(YearStrip, { model: strip, selected: 2030, onSelect: () => undefined, play: null, onPlay: () => undefined, onPause: () => undefined, onStop: () => undefined }))).not.toContain("計算しています");
    for (const mode of ["assets", "protection"] as const) {
      const html = renderToString(h(ContingencyChartCard, { model, mode, onMode: () => undefined, pinnedYear: null, onPinYear: () => undefined, onPick: () => undefined }));
      expect(html).not.toContain("計算しています");
      expect(html).toContain("cg-wait");
      expect(html).toContain('aria-busy="true"');
    }
    // 待ちの時間が過ぎたら出す（待ちの時間を0にして描く）
    expect(renderToString(h(ScenarioBand, { model, onSelect: () => undefined, loadingAfter: 0 }))).toContain("計算しています");
    expect(renderToString(h(YearStrip, { model: strip, selected: 2030, onSelect: () => undefined, play: null, onPlay: () => undefined, onPause: () => undefined, onStop: () => undefined, loadingAfter: 0 }))).toContain("計算しています（0/1年）");
    for (const mode of ["assets", "protection"] as const) {
      const html = renderToString(h(ContingencyChartCard, { model, mode, onMode: () => undefined, pinnedYear: null, onPinYear: () => undefined, onPick: () => undefined, loadingAfter: 0 }));
      expect(html).toContain("計算しています");
    }
  });

  it("想定の前提の欄: 対策と同じ部品（スライダー・万円の数値の欄・既定の札）で描き、物の ID・FP用のメモは出ない", () => {
    const memoWh = open("salariedCoupleTwoKids", ["MEMO-MARK-pp"]);
    const sections = contingencyInputSections(memoWh);
    const html = renderToString(h(PremisePanel, { wh: memoWh, sections, used: new Set(["cg/living"]), extra: { section: "cg/disability", field: oldAgeChoiceField(self.id), note: "組み合わせ" }, onDraft: () => undefined, onCommit: () => undefined }));
    expect(html).toContain("想定の前提");
    expect(html).toContain('type="range"');
    expect(html).toContain("既定: 70%");
    expect(html).toContain("1万円ずつ");
    expect(html).toContain("この場面で使う");
    expect(html).toContain("65歳からの障害年金と老齢年金の組み合わせ");
    // 前提の欄は作業の層（FP が直す欄）。FP用のメモは出さない
    expect(html).not.toContain("MEMO-MARK");
  });
});

void ({} as EngineRequest);

describe("死亡の想定の相続税の目安（0039。表示だけ）", () => {
  const wh = open("salariedCoupleTwoKids");
  const sc = scenarios(wh).find((s) => s.key === "death:self")!;

  it("選んだ死亡の想定の要求にだけ目安を求め、年ごとの帯の要求と万一なしには入れない", () => {
    const r = chartRequests(wh, "current", [], sc, 2030);
    expect(r["current|sc"]?.input.inheritanceTax).toEqual({ points: ["contingency"] });
    expect(r["current|none"]?.input.inheritanceTax).toBeUndefined();
    expect(scenarioRequest(wh, sc, 2030).input.inheritanceTax).toBeUndefined();
    const dis = scenarios(wh).find((s) => s.kind === "disability")!;
    expect(chartRequests(wh, "current", [], dis, 2030)["current|sc"]?.input.inheritanceTax).toBeUndefined();
  });

  it("結果に目安の一文が出て、お金の流れ（表）は目安なしと同じ", () => {
    const r = chartRequests(wh, "current", [], sc, 2030);
    const withIt = preview(r["current|sc"]!);
    const without = preview(scenarioRequest(wh, sc, 2030));
    expect(withIt.table).toEqual(without.table);
    const text = inheritanceText(withIt);
    expect(text).toMatch(/^相続税の目安: /);
    expect(text).toContain("お金の流れには入れていません");
    expect(inheritanceText(without)).toBeNull();
  });
});
