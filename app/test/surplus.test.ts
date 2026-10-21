// 黒字のうち貯まる割合（ゆとりの支出）・まとめた金融資産の運用しない分（0031）の画面の側: 基本生活費のカードの欄と時期で分ける目安・
// 貯蓄・運用の欄・動かす項目・キャッシュフロー表の行・根拠の一言・控えから見た実際の割合・見本の世帯のプラン。生活防衛資金はなくした（0031 の追記）
import { describe, expect, it } from "vitest";
import type { EngineRequest } from "../src/engine/types.ts";
import { bsPlan } from "../src/workspace/balanceTab.ts";
import { demoHousehold, type DemoHousehold } from "../src/workspace/catalog.ts";
import { seedDemo } from "../src/workspace/demoSeed.ts";
import { buildEvidence } from "../src/workspace/evidence.ts";
import { explainModel } from "../src/workspace/explain.ts";
import { allFields } from "../src/workspace/input/form.ts";
import { fromRequest, type WorkingHousehold } from "../src/workspace/input/household.ts";
import { editTotal, totalViewOf } from "../src/workspace/input/savings/model.ts";
import { buildStage } from "../src/workspace/input/stages/index.ts";
import { suggestionOf } from "../src/workspace/input/surplusSuggest.ts";
import { investVerdict, lastsAge } from "../src/workspace/invest/present.ts";
import { buildCatalog } from "../src/workspace/plans/items.ts";
import { applyValues, effectiveValues } from "../src/workspace/plans/plans.ts";
import { cashflowTable, displayYears } from "../src/workspace/present.ts";
import { actualSavingRatio, applyPreset, financialInputs, presetOf, presetPoints, surplusBreakdown, withoutRemovedAssumptions } from "../src/workspace/surplus.ts";
import { full, modelHousehold, preview } from "./helpers.ts";

const ID = "dualAssetsTwoKids";
const req = modelHousehold(ID);
const selfId = req.input.household.members.find((m) => m.kind === "self")!.id;
const wh0 = fromRequest(req);
const cat = buildCatalog(wh0, selfId, demoHousehold(ID) ?? null);
const field = (wh: WorkingHousehold, key: string) => allFields(buildStage("living", wh)).find((f) => f.key === key);
const section = (wh: WorkingHousehold) => buildStage("living", wh).sections.find((s) => s.key === "living/surplus")!;
const action = (wh: WorkingHousehold, key: string) => [...section(wh).groups.flatMap((g) => g.actions), ...section(wh).actions].find((a) => a.key === key);
const withPlanE = async () => {
  const demo = demoHousehold(ID) as DemoHousehold;
  const seeded = await seedDemo(wh0, cat, demo, { now: "2026-10-20T00:00:00.000Z", appVersion: "0.1.0" });
  const e = seeded.wh.proposals.find((p) => p.name.startsWith("プランE"));
  return { seeded, e: e!, req: applyValues(seeded.wh, effectiveValues(seeded.wh.proposals, e!.id), cat) as EngineRequest };
};

describe("基本生活費のカードの欄（毎年の黒字のうち、貯金に回る割合）", () => {
  it("空欄なら前提を持たない（今まで通り）。割合を入れると assumptions.surplusSaving、消すと前提ごと外す", () => {
    const f = field(wh0, "living/surplus/ratio")!;
    expect(f.label).toBe("毎年の黒字のうち、貯金に回る割合");
    expect(f.get(wh0).value).toBeNull();
    const a = f.set(wh0, "0.6");
    expect(a.request.input.assumptions?.surplusSaving).toEqual({ ratio: "0.6" });
    const b = f.set(a, null);
    expect(b.request.input.assumptions?.surplusSaving).toBeUndefined();
    // 上限
    const c = field(wh0, "living/surplus/cap")!.set(wh0, 2_000_000);
    expect(c.request.input.assumptions?.surplusSaving).toEqual({ cap: 2_000_000 });
    // 外す
    expect(action(a, "living/surplus/clear")!.run(a).request.input.assumptions?.surplusSaving).toBeUndefined();
  });

  it("前提条件のカードには、黒字の割合と生活防衛資金の欄が無い", () => {
    const keys = allFields(buildStage("assumptions", wh0)).map((f) => `${f.key}:${f.item ?? ""}`);
    expect(keys.some((k) => k.includes("surplus") || k.includes("reserve") || k.includes("emergencyReserve"))).toBe(false);
  });

  it("目安の期間の区切り: 末子の独立（子の独立の月の最も遅いもの）と退職（働く最後の月の翌月）", () => {
    expect(presetPoints(req)).toEqual({ children: "2037-04", retirement: "2038-05" });
    // 子のいない世帯・今より前の時点は区切りにしない（目安のボタンを出さない）
    const noKids = structuredClone(req);
    noKids.input.household.members = noKids.input.household.members.filter((m) => m.kind !== "child");
    expect(presetPoints(noKids).children).toBeNull();
    const w = fromRequest(noKids);
    expect(action(w, "living/surplus/preset/children")).toBeUndefined();
    expect(action(w, "living/surplus/preset/retirement")).toBeDefined();
  });

  it("目安を選ぶと、この世帯の時点で期間が入る（はじめの割合は入れてあればそのまま）。選んでいる目安は押した状態", () => {
    const kids = action(wh0, "living/surplus/preset/children")!;
    expect(kids.label).toContain("子育て中と子の独立後で分ける");
    expect(kids.label).toContain("2037年");
    expect(kids.pressed).toBe(false);
    const a = kids.run(wh0);
    expect(a.request.input.assumptions?.surplusSaving).toEqual({ ratio: "0.5", changes: [{ from: { at: "2037-04" }, ratio: "0.8" }] });
    expect(presetOf(a.request)).toBe("children");
    expect(action(a, "living/surplus/preset/children")!.pressed).toBe(true);
    // 欄の名前は期間の呼び方になる。FP は数字だけ直せる
    expect(field(a, "living/surplus/ratio")!.label).toBe("末子の独立までの割合（〜2036年）");
    const after = field(a, "living/surplus/change/0/ratio")!;
    expect(after.label).toBe("末子の独立の後の割合");
    const a2 = after.set(field(a, "living/surplus/ratio")!.set(a, "0.45"), "0.7");
    expect(a2.request.input.assumptions?.surplusSaving).toEqual({ ratio: "0.45", changes: [{ from: { at: "2037-04" }, ratio: "0.7" }] });
    expect(presetOf(a2.request)).toBe("children");
    // 退職の前後へ: はじめの割合はそのまま、区切りは退職の時点
    const r = action(a2, "living/surplus/preset/retirement")!.run(a2);
    expect(r.request.input.assumptions?.surplusSaving).toEqual({ ratio: "0.45", changes: [{ from: { at: "2038-05" }, ratio: "0.8" }] });
    expect(field(r, "living/surplus/ratio")!.label).toBe("退職までの割合（〜2037年）");
    // ずっと同じ: 期間の組を外す（上限は残す）
    const same = action(field(r, "living/surplus/cap")!.set(r, 3_000_000), "living/surplus/preset/same")!.run(field(r, "living/surplus/cap")!.set(r, 3_000_000));
    expect(same.request.input.assumptions?.surplusSaving).toEqual({ ratio: "0.45", cap: 3_000_000 });
    expect(presetOf(same.request)).toBe("same");
    // 何も入れていないときの「ずっと同じ」は目安の60%
    expect(applyPreset(req, "same").input.assumptions?.surplusSaving).toEqual({ ratio: "0.6" });
    expect(applyPreset(req, "retirement").input.assumptions?.surplusSaving).toEqual({ ratio: "0.6", changes: [{ from: { at: "2038-05" }, ratio: "0.8" }] });
  });

  it("目安で入れた期間は計算にそのまま効く（独立の年の前は50%、独立の年から80%。取り崩しの計画の前の年）", () => {
    const er = applyPreset(req, "children");
    const r = preview(er);
    for (const [y, ratio] of [
      [2030, 0.5],
      [2036, 0.5],
      [2037, 0.8],
      [2040, 0.8],
    ] as const) {
      const b = surplusBreakdown(r.table, y);
      if (b.surplus <= 0) continue;
      expect(b.spend, String(y)).toBe(b.surplus - Math.floor(b.surplus * ratio));
    }
  });

  it("自分で組む: 本人の年齢で期間を足すと「本人の○歳から 80%」。年齢で直せる。目安ではなくなる", () => {
    const add = action(wh0, "living/surplus/addChange")!;
    const w = add.run(field(wh0, "living/surplus/ratio")!.set(wh0, "0.5"));
    const ch = w.request.input.assumptions?.surplusSaving?.changes ?? [];
    expect(ch).toHaveLength(1);
    expect(ch[0]!.ratio).toBe("0.8");
    expect(presetOf(w.request)).toBe("custom");
    expect(field(w, "living/surplus/ratio")!.label).toBe("はじめの割合");
    const age = field(w, "living/surplus/change/0/age")!;
    expect(age.get(w).value).toBeGreaterThan(40);
    const w2 = age.set(w, 60);
    expect(w2.request.input.assumptions?.surplusSaving?.changes?.[0]?.from).toEqual({ memberAge: { member: selfId, years: 60, months: 0 } });
    // 目安の区切りの年齢を書き換えると、自分で組む形になる
    const k = applyPreset(req, "children");
    const kw = field(fromRequest(k), "living/surplus/change/0/age")!.set(fromRequest(k), 55);
    expect(presetOf(kw.request)).toBe("custom");
  });
});

describe("生活防衛資金をなくした（0031 の追記）", () => {
  it("控えに残っている生活防衛資金の前提は、計算するときに外す（控えの中身は変えない）", () => {
    const old = structuredClone(req);
    (old.input.assumptions as Record<string, unknown>).emergencyReserve = { months: 6 };
    const w = withoutRemovedAssumptions(old);
    expect((w.input.assumptions as Record<string, unknown>).emergencyReserve).toBeUndefined();
    expect((old.input.assumptions as Record<string, unknown>).emergencyReserve).toEqual({ months: 6 });
    expect(preview(w).table.length).toBeGreaterThan(0);
    expect(withoutRemovedAssumptions(req)).toBe(req);
  });
});

describe("貯蓄・運用の欄（合計の入れ方の運用しない分）", () => {
  it("運用しない分を入れると、まとめた金融資産の器の uninvested（0 と空は外す）", () => {
    const t = editTotal(wh0, { value: 20_000_000, rate: "0.04" });
    const u = editTotal(t, { uninvested: 5_000_000 });
    const pooled = (u.request.input.household.accounts ?? []).find((a) => a.kind === "pooled")!;
    expect(pooled.uninvested).toBe(5_000_000);
    expect(editTotal(u, { uninvested: null }).request.input.household.accounts?.find((a) => a.kind === "pooled")?.uninvested).toBeUndefined();
    expect(totalViewOf(u.request).uninvested).toBeNull(); // 口座の入れ方のまま（合計の入れ方のときだけ見せる）
  });
});

describe("動かす項目", () => {
  it("黒字のうち貯まる割合（5% の刻み）。生活防衛資金の項目は無い", () => {
    const r = cat.byKey.get("surplus:ratio")!;
    expect(r.read(wh0)).toBe("1");
    expect(r.apply(wh0, "0.6").request.input.assumptions?.surplusSaving).toEqual({ ratio: "0.6" });
    expect(r.apply(wh0, "1")).toBe(wh0);
    expect(cat.byKey.has("reserve:months")).toBe(false);
    // 同じ欄を基本生活費の項目として重ねて出さない
    expect(cat.byKey.has("field:living/surplus/ratio")).toBe(false);
  });
});

describe("見本の世帯のプランE（黒字の6割）", () => {
  it("キャッシュフロー表に「ゆとりの支出」の行が出て、基本生活費には混ぜない（生活防衛資金の行は無い）", async () => {
    const { req: er } = await withPlanE();
    const r = preview(er);
    const years = displayYears(er);
    const t = cashflowTable(er, r.table, years, "プランE");
    const keys = t.rows.map((x) => x.key);
    expect(keys).toContain("surplusSpend");
    expect(keys).not.toContain("reserve");
    expect(keys.indexOf("surplusSpend")).toBe(keys.indexOf("living") + 1);
    // 現状には出ない
    const base = cashflowTable(req, preview(req).table, years, "現状");
    expect(base.rows.map((x) => x.key)).not.toContain("surplusSpend");
    // ゆとりの支出＝黒字−貯まる額（60%）
    const y = years.find((yy) => surplusBreakdown(r.table, yy).spend > 0)!;
    const b = surplusBreakdown(r.table, y);
    expect(b.spend).toBe(b.surplus - Math.floor(b.surplus * 0.6));
  });

  it("「金融資産は○歳まで持つ」は金融資産で判定し、金融資産は現状より少なくなる", async () => {
    const { req: er } = await withPlanE();
    const r = preview(er);
    const base = preview(req);
    const years = displayYears(er);
    expect(r.table.some((c) => c.row === "cf.balance.financial.usable" || c.row === "cf.balance.financial.reserveTarget" || c.row === "cf.balance.account.reserve")).toBe(false);
    const a = lastsAge(er, r.table, years)!;
    const b = lastsAge(req, base.table, years)!;
    expect(a).toBeLessThanOrEqual(b);
    const fin = (t: typeof r.table, y: number) => t.filter((c) => c.row === "cf.balance.financial" && c.year === y).reduce((x, c) => x + c.amount, 0);
    expect(fin(r.table, 2050)).toBeLessThan(fin(base.table, 2050));
    // 取り崩しの計画（65歳から）がある年は、ゆとりの支出を差し引かない
    expect(r.table.filter((c) => c.row === "cf.expense.living.surplus" && c.year >= 2043).length).toBe(0);
    // 資産の少ない世帯（会社員の夫婦と子2人）では、「○歳まで持つ」が短くなる
    const sal = modelHousehold("salariedCoupleTwoKids");
    const salE = structuredClone(sal);
    Object.assign(salE.input.assumptions ?? {}, { surplusSaving: { ratio: "0.6" } });
    const ys = displayYears(sal);
    expect(lastsAge(salE, preview(salE).table, ys)!).toBeLessThan(lastsAge(sal, preview(sal).table, ys)!);
    const v = investVerdict({ selected: "プランE", base: "プランA", same: false }, { req: er, table: r.table }, { req, table: base.table }, years);
    expect(v.sub.map((x) => x.text).join("")).not.toContain("生活防衛資金");
  });

  it("資産と負債のタブ: 生活防衛資金の項目は出ない", async () => {
    const { req: er } = await withPlanE();
    const p = bsPlan({ key: "E", letter: "E", name: "プランE", title: "", base: false, req: er, table: preview(er).table });
    const y0 = p.years[0]!;
    expect(y0.lines.some((l) => l.key === "reserve")).toBe(false);
    expect(y0.notes.liquid).not.toContain("生活防衛資金");
    for (const y of p.years) expect(y.totalAssets).toBe(y.totalLiabilities + y.netWorth);
  });

  it("根拠の一言（何を差し引いたか）と説明モードの一文", async () => {
    const { req: er } = await withPlanE();
    const f = full(er);
    const years = displayYears(er);
    const y = years.find((yy) => surplusBreakdown(f.table, yy).spend > 0)!;
    const ev = buildEvidence(f, er, "surplusSpend", y)!;
    expect(ev.note).toContain("貯まる割合（60%）");
    expect(ev.formulas.join("")).toContain("ゆとりの支出 ＝ 黒字");
    const ex = explainModel(er, f, 95);
    const exp = ex.steps.find((s) => s.key === "expense")!;
    expect(exp.sentence.map((p) => p.text).join("")).toContain("ゆとりの支出");
  });
});

describe("控えから見た実際の割合", () => {
  it("見本の世帯の1年前の控え: 控えの時点の金融資産＋見込みの黒字と、今の金融資産を比べる（0〜100%・5% の刻み）", async () => {
    const { seeded } = await withPlanE();
    const snap = (seeded.wh.snapshots ?? []).find((s) => s.createdAt.startsWith("2025-10"))!;
    const t = preview(snap.inputs.request).table;
    const a = actualSavingRatio({ snapshot: { createdAt: snap.createdAt, req: snap.inputs.request, table: t }, current: req });
    expect(a.months).toBe(12);
    expect(a.start).toBe(financialInputs(snap.inputs.request));
    expect(a.now).toBe(financialInputs(req));
    expect(a.expectedSurplus).toBeGreaterThan(0);
    expect(a.ratio).not.toBeNull();
    expect(a.ratio!).toBeGreaterThanOrEqual(0);
    expect(a.ratio!).toBeLessThanOrEqual(1);
    expect(Math.round(a.ratio! * 100) % 5).toBe(0);
    // 割合＝（今−控えの時点−見込みの運用益）÷見込みの黒字 を切り下げたもの
    expect(a.ratio!).toBeLessThanOrEqual(Math.max(0, a.saved / a.expectedSurplus) + 1e-9);
    const s = suggestionOf(a, null);
    expect(s.text).toMatch(/^控えから見た実際の割合: \d+%$/);
    expect(s.action).toBe("入れる");
    expect(s.value).toBe(String(a.ratio));
    expect(s.detail.join("")).toContain("運用益");
    // 同じ値が入っていればボタンは出さない
    expect(suggestionOf(a, String(a.ratio)).value).toBeNull();
  });

  it("6か月に満たない控えからは出さない（理由を返す）", () => {
    const a = actualSavingRatio({ snapshot: { createdAt: "2026-08-01T10:00:00+09:00", req, table: preview(req).table }, current: req });
    expect(a.ratio).toBeNull();
    expect(a.reason).toContain("6か月");
  });
});
