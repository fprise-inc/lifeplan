// 対策「毎月の生活費」のつまみ（0262）: 内訳で入れた行でも効く（内訳の値と推定の印はそのままで、合計をそろえる月額を書く）・計算基準月に当てはまる行を
// 動かす・月額で入れた段階も同じ割合で動かす・効かない形はつまみを押せない形にして理由を出す・下の文と基準は選んだプランを反映した世帯から。
// 動かさなければ1円も変わらない（見本とモデル世帯の全部）
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { REPO_DIR } from "../scripts/lib.ts";
import type { EngineRequest, LivingExpense } from "../src/engine/types.ts";
import { KNOWN_DEMOS } from "../src/workspace/catalog.ts";
import { fromRequest, type WorkingHousehold } from "../src/workspace/input/household.ts";
import { applyLevers, leverLivingOf, livingLeverBlock, livingTotalOf, readLevers } from "../src/workspace/levers.ts";
import { buildCatalog, type Catalog } from "../src/workspace/plans/items.ts";
import { planView, recordPlanEdit } from "../src/workspace/plans/planEdit.ts";
import { applyValues, changesOf, effectiveValues, normalizeValues, planValueOf, PLAN_SLOT, savePlan, type Values } from "../src/workspace/plans/plans.ts";
import { roles } from "../src/workspace/roles.ts";
import { modelHousehold, preview, screenYears } from "./helpers.ts";

const NOW = "2026-11-26T00:00:00Z";
const ids = readdirSync(join(REPO_DIR, "data", "modelHouseholds"))
  .filter((f) => f.endsWith(".json"))
  .map((f) => f.replace(/\.json$/, ""));
const box = (v: number) => ({ value: v, state: "confirmed", origin: { kind: "manual" } }) as LivingExpense["monthly"] & object;
const est = (v: number) => ({ value: v, state: "estimated", origin: { kind: "auto" }, estimate: { method: "statistic", basis: "同じ人数の世帯の平均" } }) as LivingExpense["monthly"] & object;
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

function open(id: string, edit?: (r: EngineRequest) => void): { wh: WorkingHousehold; cat: Catalog; self: string; req: EngineRequest } {
  const req = structuredClone(modelHousehold(id));
  edit?.(req);
  const self = roles(req).find((r) => r.key === "self")!.member.id;
  const wh = fromRequest(req);
  return { wh, cat: buildCatalog(wh, self, KNOWN_DEMOS.find((d) => d.id === id) ?? null), self, req };
}
const assets = (wh: WorkingHousehold, cat: Catalog, values: Values) => {
  const r = applyValues(wh, values, cat);
  return screenYears(preview(r), r).map((y) => y.financialAssets);
};
/** 生活費の行を内訳の入れ方にする（費目は推定と確定をまぜる） */
const toBreakdown = (l: LivingExpense) => {
  l.mode = "byCategory";
  l.categories = [
    { id: uuid(9101), category: "food", monthly: box(100000) },
    { id: uuid(9102), category: "utilities", monthly: est(25000) },
    { id: uuid(9103), category: "other", monthly: box(155000) },
  ];
};

describe("動かさなければ1円も変わらない（見本とモデル世帯の全部）", () => {
  it.each(ids)("%s: 見本のプランの値を反映した要求は、生活費の行が今までの書き方と同じ", (id) => {
    const { wh, cat, self } = open(id);
    const demo = KNOWN_DEMOS.find((d) => d.id === id);
    for (const values of [{}, ...(demo?.plans ?? []).map((p) => p.values as Values)]) {
      const got = applyValues(wh, values, cat);
      // 生活費のつまみを動かしていない: 生活費の行は現状のまま（そろえる月額を書かない）
      if (!Object.hasOwn(values, "lever:livingMonthly")) {
        const strip = (r: EngineRequest) => (r.input.household.livingExpenses ?? []).map((l) => ({ ...l, stages: (l.stages ?? []).map((s) => ({ ...s, at: null })) }));
        expect(strip(got)).toEqual(strip(wh.request));
        expect((got.input.household.livingExpenses ?? []).some((l) => l.categoryTotal !== undefined)).toBe(false);
        continue;
      }
      // 動かしたプラン（見本は総額の1行・割合の段階だけ）: 今までの書き方（最初の総額の行の月額を書く）と同じ
      const { "lever:livingMonthly": v, ...rest } = values;
      const old = applyValues(wh, rest, cat);
      const first = (old.input.household.livingExpenses ?? []).find((l) => l.mode === "total");
      if (first !== undefined && typeof v === "number" && v !== readLevers(old, self).livingMonthly) first.monthly = box(v);
      expect(got.input.household.livingExpenses).toEqual(old.input.household.livingExpenses);
    }
  });
});

describe("つまみが効く", () => {
  it.each(ids)("%s: つまみがあれば、1万円動かすと金融資産が変わる（総額でも内訳でも）", (id) => {
    const { wh, cat, self } = open(id);
    const now = readLevers(wh.request, self).livingMonthly;
    if (now === undefined) {
      // つまみを出さないのは、生活費が無いか、計算基準月に当てはまる行の額が分からないときだけ
      expect(livingLeverBlock(wh.request)).not.toBeNull();
      return;
    }
    const a = assets(wh, cat, { "lever:livingMonthly": now - 10000 });
    const b = assets(wh, cat, { "lever:livingMonthly": now + 10000 });
    expect(a).not.toEqual(b);
  });

  it("現状が内訳の世帯（unexplainedSpending）にもつまみを出し、内訳の値はそのままで合計をそろえる", () => {
    const { wh, cat, self } = open("unexplainedSpending");
    const l = wh.request.input.household.livingExpenses![0]!;
    expect(l.mode).toBe("byCategory");
    const sum = (l.categories ?? []).reduce((s, c) => s + (c.monthly.value ?? 0), 0);
    expect(readLevers(wh.request, self).livingMonthly).toBe(sum);
    expect(cat.byKey.has("lever:livingMonthly")).toBe(true);
    const r = applyValues(wh, { "lever:livingMonthly": sum + 30000 }, cat);
    const m = r.input.household.livingExpenses![0]!;
    expect(m.categories).toEqual(l.categories);
    expect(m.categoryTotal?.value).toBe(sum + 30000);
    expect(readLevers(r, self).livingMonthly).toBe(sum + 30000);
    // 内訳の合計と同じ額に戻すと、そろえる月額を書かない
    expect(applyValues(wh, { "lever:livingMonthly": sum }, cat).input.household.livingExpenses![0]!.categoryTotal).toBeUndefined();
  });
});

describe("プランで生活費の入れ方を内訳にした（利用者の報告の形）", () => {
  const setup = () => {
    const { wh, cat, self, req } = open("sampleCoupleTwoKidsPeak");
    const s = savePlan(wh, cat, { name: "プランC", base: null, values: { "lever:retireAge": 66, "lever:nisaMonthly": 30000, "lever:livingMonthly": 290000 }, now: NOW });
    const before = planView(s.wh, cat, s.id);
    const r = structuredClone(before.request);
    toBreakdown(r.input.household.livingExpenses![0]!);
    const w = recordPlanEdit(s.wh, cat, s.id, before, { ...before, request: r });
    return { wh: w, cat, self, pid: s.id, req };
  };

  it("つまみを動かすと選んだプランの金融資産が変わる。費目の値と推定の印はそのまま", () => {
    const { wh, cat, pid } = setup();
    const v0 = effectiveValues(wh, pid);
    expect(typeof v0[PLAN_SLOT]).toBe("string");
    const a = assets(wh, cat, { ...v0, "lever:livingMonthly": 260000 });
    const b = assets(wh, cat, { ...v0, "lever:livingMonthly": 320000 });
    expect(a.every((x, i) => x >= (b[i] as number))).toBe(true);
    expect(a.at(-1)).toBeGreaterThan(b.at(-1) as number);
    const l = applyValues(wh, { ...v0, "lever:livingMonthly": 260000 }, cat).input.household.livingExpenses![0]!;
    expect(l.mode).toBe("byCategory");
    expect(l.categoryTotal?.value).toBe(260000);
    expect(l.categories!.map((c) => [c.category, c.monthly.value, c.monthly.state])).toEqual([
      ["food", 100000, "confirmed"],
      ["utilities", 25000, "estimated"],
      ["other", 155000, "confirmed"],
    ]);
  });

  it("つまみの値・基準・下の文は、選んだプランを反映した世帯から（プランの内訳の合計を見せ、その値に動かしても消えない）", () => {
    const { wh, cat, pid } = setup();
    const it = cat.byKey.get("lever:livingMonthly")!;
    const v0 = effectiveValues(wh, pid);
    // 保存したプランの値（29万円）。つまみを外したプランなら、プランの内訳の合計（28万円）を見せる（現状の30万円ではない）
    expect(planValueOf(it, v0, wh, cat)).toBe(290000);
    const { "lever:livingMonthly": _drop, ...noLever } = v0;
    void _drop;
    expect(planValueOf(it, noLever, wh, cat)).toBe(280000);
    // 現状と同じ30万円に動かしても、プランの内訳の合計（28万円）と違うので値として残る
    expect(normalizeValues({ ...noLever, "lever:livingMonthly": 300000 }, {}, wh, cat)["lever:livingMonthly"]).toBe(300000);
    // プランの内訳の合計と同じ額は残さない
    expect(Object.hasOwn(normalizeValues({ ...noLever, "lever:livingMonthly": 280000 }, {}, wh, cat), "lever:livingMonthly")).toBe(false);
    const view = { ...wh, request: applyValues(wh, { ...v0, "lever:livingMonthly": 260000 }, cat) };
    expect(it.note?.(260000, { view })).toBe("内訳（合計月28万円）を割合のまま月26万円にそろえます。子の独立後は85%、退職後は80%、80歳から70%");
    // 現状（総額）から作る文は今までどおり
    expect(it.note?.(300000)).toBe("子の独立後は85%、退職後は80%、80歳から70%");
  });

  it("変えたことの「内訳の月額（生活費）」は、費目ごとの額を出す（「食費: なし」にしない）", () => {
    const { wh, cat } = open("sampleCoupleTwoKidsPeak");
    const s = savePlan(wh, cat, { name: "プランC", base: null, values: { "lever:livingMonthly": 290000 }, now: NOW });
    const before = planView(s.wh, cat, s.id);
    const r = structuredClone(before.request);
    const l = r.input.household.livingExpenses![0]!;
    l.mode = "byCategory";
    l.categories = [
      { id: uuid(9601), category: "food", monthly: box(120000) },
      { id: uuid(9602), category: "other", monthly: box(170000) },
    ];
    const w = recordPlanEdit(s.wh, cat, s.id, before, { ...before, request: r });
    const row = changesOf(w.proposals, s.id, w, cat).find((c) => c.label === "内訳の月額（生活費）");
    expect(row).toBeDefined();
    expect(row!.to).toBe("食費: 月12万円・その他: 月17万円");
  });
});

describe("どの行を動かすか（計算基準月に当てはまる行。境目）", () => {
  const twoRows = (firstTo: string, secondFrom: string) => (r: EngineRequest) => {
    const h = r.input.household;
    const l = h.livingExpenses![0]!;
    const l2 = structuredClone(l);
    l2.id = uuid(9201);
    (l2.stages ?? []).forEach((s, i) => (s.id = uuid(9210 + i)));
    l2.monthly = box(250000);
    l.to = { at: firstTo };
    l2.from = { at: secondFrom };
    h.livingExpenses!.push(l2);
  };

  it("終わりが計算基準月の行（その月まで）は当てはまる。計算基準月より前に終わった行は動かさず、次の行を動かす", () => {
    const at = open("sampleCoupleTwoKidsPeak", twoRows("2026-10", "2026-11"));
    expect(at.wh.request.input.baseMonth).toBe("2026-10");
    expect(leverLivingOf(at.wh.request.input.household, "2026-10")?.monthly?.value).toBe(300000);
    const before = open("sampleCoupleTwoKidsPeak", twoRows("2026-09", "2026-10"));
    const l = leverLivingOf(before.wh.request.input.household, "2026-10")!;
    expect(l.monthly?.value).toBe(250000);
    const r = applyLevers(before.wh.request, before.self, { livingMonthly: 270000 });
    expect(r.input.household.livingExpenses!.map((x) => x.monthly?.value)).toEqual([300000, 270000]);
    // 下の文: どの行を動かすか
    expect(before.cat.byKey.get("lever:livingMonthly")!.note?.(270000)).toMatch(/^毎月の生活費 2（2026年10月から）だけを動かします。/);
  });

  it("計算基準月に当てはまる行が無ければ、これから始まる最初の行。総額と内訳の両方が当てはまるときは総額の行", () => {
    const later = open("sampleCoupleTwoKidsPeak", (r) => (r.input.household.livingExpenses![0]!.from = { at: "2027-01" }));
    expect(leverLivingOf(later.wh.request.input.household, "2026-10")?.id).toBe(later.wh.request.input.household.livingExpenses![0]!.id);
    const both = open("sampleCoupleTwoKidsPeak", (r) => {
      const h = r.input.household;
      const b = structuredClone(h.livingExpenses![0]!);
      b.id = uuid(9301);
      (b.stages ?? []).forEach((s, i) => (s.id = uuid(9310 + i)));
      toBreakdown(b);
      h.livingExpenses = [b, h.livingExpenses![0]!];
    });
    expect(leverLivingOf(both.wh.request.input.household, "2026-10")?.mode).toBe("total");
  });

  it.each(["2027-01", "2027-03"])("計算基準月が %s（1〜3月）でも、始まりがその月の行を動かす", (base) => {
    const o = open("sampleCoupleTwoKidsPeak", (r) => {
      r.input.baseMonth = base;
      twoRows("2026-12", base)(r);
    });
    const r = applyLevers(o.wh.request, o.self, { livingMonthly: 220000 });
    expect(r.input.household.livingExpenses!.map((x) => x.monthly?.value)).toEqual([300000, 220000]);
    expect(assets(o.wh, o.cat, { "lever:livingMonthly": 220000 })).not.toEqual(assets(o.wh, o.cat, { "lever:livingMonthly": 280000 }));
  });
});

describe("月額で入れた段階も同じ割合で動かす", () => {
  const monthlyStages = (r: EngineRequest) => {
    const l = r.input.household.livingExpenses![0]!;
    // 子の独立は月額、退職後は割合、本人の誕生月（80歳）の段は月額、節目が「その他」の段は割合
    l.stages = [
      { ...l.stages![0]!, ratio: undefined, monthly: box(255000) },
      l.stages![1]!,
      { ...l.stages![2]!, ratio: undefined, monthly: est(210000) },
      { id: uuid(9401), at: { at: "2030-04" }, label: "other", ratio: "0.9" },
    ].map((s) => Object.fromEntries(Object.entries(s).filter(([, v]) => v !== undefined)) as typeof s);
  };

  it("つまみの値と今の値の比で、月額の段階を動かす（割合の段階はそのまま。円未満は四捨五入）", () => {
    const { wh, self } = open("sampleCoupleTwoKidsPeak", monthlyStages);
    const r = applyLevers(wh.request, self, { livingMonthly: 270000 });
    const st = r.input.household.livingExpenses![0]!.stages!;
    expect(st.map((s) => s.monthly?.value ?? s.ratio)).toEqual([Math.round((255000 * 270000) / 300000), "0.8", Math.round((210000 * 270000) / 300000), "0.9"]);
    // 動かさなければ段階はそのまま
    expect(applyLevers(wh.request, self, { livingMonthly: 300000 }).input.household.livingExpenses![0]!.stages).toEqual(wh.request.input.household.livingExpenses![0]!.stages);
  });

  it("80歳（誕生月）の段まで、どの年も効く。下の文は月額の段階・節目が「その他」の段も書く", () => {
    const { wh, cat } = open("sampleCoupleTwoKidsPeak", monthlyStages);
    const a = assets(wh, cat, { "lever:livingMonthly": 260000 });
    const b = assets(wh, cat, { "lever:livingMonthly": 320000 });
    expect(a.slice(1).every((x, i) => x > (b[i + 1] as number))).toBe(true);
    expect(cat.byKey.get("lever:livingMonthly")!.note?.(300000)).toBe("子の独立後は月25.5万円、退職後は80%、80歳から月21万円、2030年4月から90%");
  });
});

describe("効かない形はつまみを押せない形にして理由を出す（空欄）", () => {
  it("生活費が無い・内訳が1つも無い・総額の月額が空なら理由を返す。効く形は null", () => {
    const base = modelHousehold("sampleCoupleTwoKidsPeak");
    expect(livingLeverBlock(base)).toBeNull();
    const none = structuredClone(base);
    none.input.household.livingExpenses = [];
    expect(livingLeverBlock(none)).toMatch(/毎月の生活費が入っていない/);
    const empty = structuredClone(base);
    empty.input.household.livingExpenses![0]!.mode = "byCategory";
    empty.input.household.livingExpenses![0]!.categories = [];
    expect(livingLeverBlock(empty)).toMatch(/内訳が1つも入っていない/);
    const blank = structuredClone(base);
    delete blank.input.household.livingExpenses![0]!.monthly;
    expect(livingLeverBlock(blank)).toMatch(/基本生活費（月額）が空/);
    const ended = structuredClone(base);
    ended.input.household.livingExpenses![0]!.to = { at: "2026-09" };
    expect(livingLeverBlock(ended)).toMatch(/当てはまる毎月の生活費が無い/);
    for (const r of [none, empty, blank, ended]) expect(readLevers(r, roles(r).find((x) => x.key === "self")!.member.id).livingMonthly).toBeUndefined();
  });

  it("推定の費目だけの内訳でも、合計（推定のまま）を今の値として読み、動かしても推定の印を変えない", () => {
    const { wh, self, cat } = open("sampleCoupleTwoKidsPeak", (r) => {
      const l = r.input.household.livingExpenses![0]!;
      l.mode = "byCategory";
      l.categories = [
        { id: uuid(9501), category: "food", monthly: est(90000) },
        { id: uuid(9502), category: "other", monthly: est(160000) },
      ];
    });
    expect(livingTotalOf(wh.request.input.household.livingExpenses![0]!)).toBe(250000);
    expect(readLevers(wh.request, self).livingMonthly).toBe(250000);
    const r = applyValues(wh, { "lever:livingMonthly": 230000 }, cat);
    expect(r.input.household.livingExpenses![0]!.categories!.every((c) => c.monthly.state === "estimated")).toBe(true);
    expect(r.input.household.livingExpenses![0]!.categoryTotal?.value).toBe(230000);
  });
});
