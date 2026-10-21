// 黒字のうち貯まる割合（ゆとりの支出）と生活防衛資金・まとめた金融資産の運用しない分（0031）の画面の側: 前提条件の欄・貯蓄・運用の欄・
// 動かす項目・キャッシュフロー表の行・「○歳まで持つ」の判定・根拠の一言・控えから見た実際の割合・見本の世帯のプラン
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
import { investVerdict, lastsAge, reserveLine } from "../src/workspace/invest/present.ts";
import { buildCatalog } from "../src/workspace/plans/items.ts";
import { applyValues, effectiveValues } from "../src/workspace/plans/plans.ts";
import { cashflowTable, depletionYear, displayYears, lastingExcludesReserve } from "../src/workspace/present.ts";
import { actualSavingRatio, financialInputs, surplusBreakdown } from "../src/workspace/surplus.ts";
import { full, modelHousehold, preview } from "./helpers.ts";

const ID = "dualAssetsTwoKids";
const req = modelHousehold(ID);
const selfId = req.input.household.members.find((m) => m.kind === "self")!.id;
const wh0 = fromRequest(req);
const cat = buildCatalog(wh0, selfId, demoHousehold(ID) ?? null);
const field = (wh: WorkingHousehold, key: string) => allFields(buildStage("assumptions", wh)).find((f) => f.key === key);
const withPlanE = async () => {
  const demo = demoHousehold(ID) as DemoHousehold;
  const seeded = await seedDemo(wh0, cat, demo, { now: "2026-10-20T00:00:00.000Z", appVersion: "0.1.0" });
  const e = seeded.wh.proposals.find((p) => p.name.startsWith("プランE"));
  return { seeded, e: e!, req: applyValues(seeded.wh, effectiveValues(seeded.wh.proposals, e!.id), cat) as EngineRequest };
};

describe("前提条件の欄（黒字の貯まり方と生活防衛資金）", () => {
  it("空欄なら前提を持たない（今まで通り）。割合を入れると assumptions.surplusSaving、消すと前提ごと外す", () => {
    const f = field(wh0, "assume/surplus/ratio")!;
    expect(f.get(wh0).value).toBeNull();
    const a = f.set(wh0, "0.6");
    expect(a.request.input.assumptions?.surplusSaving).toEqual({ ratio: "0.6" });
    const b = f.set(a, null);
    expect(b.request.input.assumptions?.surplusSaving).toBeUndefined();
    // 上限
    const c = field(wh0, "assume/surplus/cap")!.set(wh0, 2_000_000);
    expect(c.request.input.assumptions?.surplusSaving).toEqual({ cap: 2_000_000 });
  });

  it("期間で変える組を足すと、基本生活費の「子の独立」の時点から 80%。年齢で直せる", () => {
    const stage = buildStage("assumptions", wh0);
    const sec = stage.sections.find((s) => s.key === "assume/surplus")!;
    const add = sec.actions.find((x) => x.key === "assume/surplus/addChange")!;
    const w = add.run(field(wh0, "assume/surplus/ratio")!.set(wh0, "0.5"));
    const ch = w.request.input.assumptions?.surplusSaving?.changes ?? [];
    expect(ch).toHaveLength(1);
    expect(ch[0]!.ratio).toBe("0.8");
    const age = field(w, "assume/surplus/change/0/age")!;
    expect(age.get(w).value).toBeGreaterThan(40);
    const w2 = age.set(w, 60);
    expect(w2.request.input.assumptions?.surplusSaving?.changes?.[0]?.from).toEqual({ memberAge: { member: selfId, years: 60, months: 0 } });
  });

  it("生活防衛資金: 決め方（入れない・○か月分・金額）と、「○歳まで持つ」の判定に含めるか", () => {
    const mode = field(wh0, "assume/reserve/mode")!;
    expect(mode.get(wh0).value).toBe("none");
    const m = mode.set(wh0, "months");
    expect(m.request.input.assumptions?.emergencyReserve).toEqual({ months: 6 });
    const m12 = field(m, "assume/reserve/months")!.set(m, 12);
    expect(m12.request.input.assumptions?.emergencyReserve).toEqual({ months: 12 });
    const inc = field(m12, "assume/reserve/count")!.set(m12, "include");
    expect(inc.request.input.assumptions?.emergencyReserve).toEqual({ months: 12, countInLasting: true });
    const amt = field(inc, "assume/reserve/mode")!.set(inc, "amount");
    expect(amt.request.input.assumptions?.emergencyReserve).toEqual({ amount: 3_000_000, countInLasting: true });
    expect(field(amt, "assume/reserve/mode")!.set(amt, "none").request.input.assumptions?.emergencyReserve).toBeUndefined();
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
  it("黒字のうち貯まる割合（5% の刻み）と生活防衛資金の月数", () => {
    const r = cat.byKey.get("surplus:ratio")!;
    expect(r.read(wh0)).toBe("1");
    expect(r.apply(wh0, "0.6").request.input.assumptions?.surplusSaving).toEqual({ ratio: "0.6" });
    expect(r.apply(wh0, "1")).toBe(wh0);
    const m = cat.byKey.get("reserve:months")!;
    expect(m.read(wh0)).toBe(0);
    expect(m.apply(wh0, 6).request.input.assumptions?.emergencyReserve).toEqual({ months: 6 });
    expect(m.text(6)).toBe("生活費の6か月分");
    // 同じ欄を前提条件の項目として重ねて出さない
    expect(cat.byKey.has("field:assume/surplus/ratio")).toBe(false);
  });
});

describe("見本の世帯のプランE（黒字の6割・生活防衛資金6か月分）", () => {
  it("キャッシュフロー表に「ゆとりの支出」と「うち生活防衛資金」の行が出て、基本生活費には混ぜない", async () => {
    const { req: er } = await withPlanE();
    const r = preview(er);
    const years = displayYears(er);
    const t = cashflowTable(er, r.table, years, "プランE");
    const keys = t.rows.map((x) => x.key);
    expect(keys).toContain("surplusSpend");
    expect(keys).toContain("reserve");
    expect(keys.indexOf("surplusSpend")).toBe(keys.indexOf("living") + 1);
    // 現状には出ない
    const base = cashflowTable(req, preview(req).table, years, "現状");
    expect(base.rows.map((x) => x.key)).not.toContain("surplusSpend");
    // ゆとりの支出＝黒字−貯まる額（60%）
    const y = years.find((yy) => surplusBreakdown(r.table, yy).spend > 0)!;
    const b = surplusBreakdown(r.table, y);
    expect(b.spend).toBe(b.surplus - Math.floor(b.surplus * 0.6));
  });

  it("「金融資産は○歳まで持つ」は生活防衛資金を除いて判定し、金融資産は現状より少なくなる。結論の文に添える", async () => {
    const { req: er } = await withPlanE();
    const r = preview(er);
    const base = preview(req);
    const years = displayYears(er);
    expect(lastingExcludesReserve(r.table)).toBe(true);
    const a = lastsAge(er, r.table, years)!;
    const b = lastsAge(req, base.table, years)!;
    expect(a).toBeLessThanOrEqual(b);
    const fin = (t: typeof r.table, y: number) => t.filter((c) => c.row === "cf.balance.financial" && c.year === y).reduce((x, c) => x + c.amount, 0);
    expect(fin(r.table, 2050)).toBeLessThan(fin(base.table, 2050));
    // 資産の少ない世帯（会社員の夫婦と子2人）では、「○歳まで持つ」が短くなる（生活防衛資金を除くと、さらに1年早い）
    const sal = modelHousehold("salariedCoupleTwoKids");
    const salE = structuredClone(sal);
    Object.assign(salE.input.assumptions ?? {}, { surplusSaving: { ratio: "0.6" }, emergencyReserve: { months: 6 } });
    const ys = displayYears(sal);
    expect(lastsAge(salE, preview(salE).table, ys)!).toBeLessThan(lastsAge(sal, preview(sal).table, ys)!);
    const v = investVerdict({ selected: "プランE", base: "プランA", same: false }, { req: er, table: r.table }, { req, table: base.table }, years);
    expect(v.sub.map((x) => x.text).join("")).toContain("生活防衛資金（生活費の6か月分");
    expect(reserveLine(r.table, years)?.every((x) => x > 0)).toBe(true);
    // 含めて判定する前提なら、使えるお金の行は出ず、判定は金融資産のまま
    const inc = structuredClone(er);
    inc.input.assumptions!.emergencyReserve = { months: 6, countInLasting: true };
    const ri = preview(inc);
    expect(lastingExcludesReserve(ri.table)).toBe(false);
    expect(depletionYear(ri.table, years) ?? Infinity).toBeGreaterThanOrEqual(depletionYear(r.table, years) ?? Infinity);
  });

  it("資産と負債のタブ: すぐ使えるお金の中に生活防衛資金を分けて見せる", async () => {
    const { req: er } = await withPlanE();
    const p = bsPlan({ key: "E", letter: "E", name: "プランE", title: "", base: false, req: er, table: preview(er).table });
    const y0 = p.years[0]!;
    const line = y0.lines.find((l) => l.key === "reserve")!;
    expect(line.group).toBe("liquid");
    expect(line.label).toBe("生活防衛資金");
    expect(y0.notes.liquid).toContain("生活防衛資金");
    // 合計は合う
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
    const rv = buildEvidence(f, er, "reserve", years[0]!)!;
    expect(rv.note).toContain("基本生活費の6か月分");
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
