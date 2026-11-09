// 今住んでいる持ち家を買った値段から推計する（0176）: 標準では評価額を聞かず、買った値段（合計・うち土地・うち建物）と買った年月から
// 推定する。詳細の欄は「固定資産税・都市計画税」と「持ち家の評価」の中枠に分ける。購入の予定の土地は割合でなく金額で入れる。
// 直した所が戻ってこないことを確かめる
import { describe, expect, it } from "vitest";
import { h } from "preact";
import { renderToString } from "preact-render-to-string";
import type { Residence } from "../src/engine/types.ts";
import { allFields, type FieldDef, type GroupDef, type Level } from "../src/workspace/input/form.ts";
import { blankHousehold, fromRequest, mutate, type WorkingHousehold } from "../src/workspace/input/household.ts";
import { withProvisionalHousing } from "../src/workspace/input/housingCredit.ts";
import { withRefreshedEstimates } from "../src/workspace/input/estimates.ts";
import { InputPanel } from "../src/workspace/input/InputPanel.tsx";
import { fieldDomId } from "../src/workspace/input/FieldViews.tsx";
import { landOfShare, shareOfLand } from "../src/workspace/input/ownedHomeValue.ts";
import { MARKET_VALUE_HELP } from "../src/workspace/input/stages/housing.ts";
import { buildStage } from "../src/workspace/input/stages/index.ts";
import { modelHousehold, preview } from "./helpers.ts";

const BASE = "2026-10";
const noop = () => undefined;
const stageOf = (wh: WorkingHousehold) => buildStage("housing", wh);
const groups = (wh: WorkingHousehold): GroupDef[] => stageOf(wh).sections.flatMap((s) => s.groups);
const panel = (wh: WorkingHousehold, level: Level) => renderToString(h(InputPanel, { wh, itemId: "housing", level, onLevel: noop, onSave: noop, onClose: noop, groupOpen: { isOpen: () => false, toggle: noop } }));
function action(wh: WorkingHousehold, key: string): WorkingHousehold {
  const a = stageOf(wh)
    .sections.flatMap((x) => [...x.actions, ...x.groups.flatMap((g) => g.actions)])
    .find((x) => x.key === key || x.key.endsWith(key));
  if (a === undefined) throw new Error(`no action ${key}`);
  return withProvisionalHousing(a.run(wh));
}
const maybeField = (wh: WorkingHousehold, suffix: string): FieldDef | undefined => allFields(stageOf(wh)).find((x) => x.key.endsWith(suffix));
function fieldOf(wh: WorkingHousehold, suffix: string): FieldDef {
  const f = maybeField(wh, suffix);
  if (f === undefined) throw new Error(`no field ${suffix}`);
  return f;
}
const set = (wh: WorkingHousehold, suffix: string, v: Parameters<FieldDef["set"]>[1]): WorkingHousehold => withProvisionalHousing(fieldOf(wh, suffix).set(wh, v));
const owned = (wh: WorkingHousehold): Residence => (wh.request.input.household.residences ?? []).find((r) => r.kind === "own" && r.purchase === undefined)!;
const fresh = (): WorkingHousehold => action(blankHousehold(BASE), "housing/addOwn");
const cells = (wh: WorkingHousehold, row: string, year = 2026) =>
  preview(wh.request)
    .table.filter((c) => c.row === row && c.year === year && c.object === owned(wh).id)
    .reduce((s, c) => s + c.amount, 0);

describe("土地の値段と割合の読み替え（計算エンジンの切り捨てで、入れた額がそのまま出る）", () => {
  it.each([
    [15_000_000, 40_000_000],
    [12_340_000, 34_560_000],
    [1, 99_999_999],
    [33_333_333, 99_999_999],
  ])("土地 %i ÷ 合計 %i", (land, total) => {
    const s = shareOfLand(land, total);
    expect(s).toMatch(/^\d+(\.\d{1,12})?$/u);
    expect(landOfShare(total, s)).toBe(land);
  });
});

describe("持ち家（今住んでいる）の標準の欄", () => {
  it("標準では評価額を聞かず、買った年月（住み始め）・買った値段（合計）・うち土地・うち建物を出す", () => {
    const wh = fresh();
    expect(fieldOf(wh, "/from").label).toBe("買った年月（住み始め）");
    expect(fieldOf(wh, "/from").level).toBe("simple");
    expect(fieldOf(wh, "/valuation/value").label).toBe("買った値段（土地と建物の合計）");
    expect(fieldOf(wh, "/valuation/value").level).toBe("simple");
    expect(fieldOf(wh, "/valuation/land").level).toBe("simple");
    expect(fieldOf(wh, "/valuation/building").level).toBe("simple");
    const html = panel(wh, "simple");
    expect(html).not.toContain(">評価額<");
    expect(html).not.toContain("評価の入れ方");
    expect(html).not.toContain("土地の割合");
    expect(html).toContain(`id="${fieldDomId(fieldOf(wh, "/valuation/value").key)}"`);
  });

  it("合計と土地を入れると、土地は入れた額のまま・評価の時点は買った年月・評価額は推定（目安の読み）", () => {
    let wh = fresh();
    wh = set(wh, "/from", { at: "2015-04" });
    wh = set(wh, "/valuation/value", 40_000_000);
    wh = set(wh, "/valuation/land", 15_000_000);
    const v = owned(wh).valuation!;
    expect(v.basis).toBe("purchase");
    expect(v.asOf).toBe("2015-04");
    expect(landOfShare(40_000_000, v.landShare!)).toBe(15_000_000);
    expect(fieldOf(wh, "/valuation/building").get(wh).value).toBe(25_000_000);
    expect(String(fieldOf(wh, "/valuation/value").get(wh).hint)).toContain("2026年の評価額の目安（推定）");
    // 建物 2,500万円は木造22年のうち11年で半分（1−11/22）。土地は前提条件の上昇率で動く（下がらない）
    expect(cells(wh, "cf.balance.account.realEstate.building")).toBe(12_500_000);
    // 土地 1,500万円は物価上昇率（既定 年1%）で11年 → 約1,670万円
    expect(Math.round(cells(wh, "cf.balance.account.realEstate.land") / 100_000)).toBe(167);
  });

  it("土地と建物で入れても、建物から先に入れても、合計は土地＋建物になる。合計と建物なら土地は残り", () => {
    let a = set(fresh(), "/valuation/land", 15_000_000);
    a = set(a, "/valuation/building", 25_000_000);
    expect(owned(a).valuation!.value!.value).toBe(40_000_000);
    expect(fieldOf(a, "/valuation/land").get(a).value).toBe(15_000_000);
    let b = set(fresh(), "/valuation/building", 25_000_000);
    b = set(b, "/valuation/land", 15_000_000);
    expect(owned(b).valuation!.value!.value).toBe(40_000_000);
    expect(fieldOf(b, "/valuation/building").get(b).value).toBe(25_000_000);
    let c = set(fresh(), "/valuation/value", 40_000_000);
    c = set(c, "/valuation/building", 30_000_000);
    expect(fieldOf(c, "/valuation/land").get(c).value).toBe(10_000_000);
    // 合計を直すと、土地と建物は同じ割合のまま
    c = set(c, "/valuation/value", 48_000_000);
    expect(fieldOf(c, "/valuation/land").get(c).value).toBe(12_000_000);
    expect(fieldOf(c, "/valuation/building").get(c).value).toBe(36_000_000);
    // 土地だけ・建物だけを先に入れて合計を後から入れたときは、先に入れた額のまま
    let d = set(fresh(), "/valuation/land", 15_000_000);
    d = set(d, "/valuation/value", 40_000_000);
    expect(fieldOf(d, "/valuation/land").get(d).value).toBe(15_000_000);
    let e = set(fresh(), "/valuation/building", 25_000_000);
    e = set(e, "/valuation/value", 40_000_000);
    expect(fieldOf(e, "/valuation/building").get(e).value).toBe(25_000_000);
  });

  it("買った値段を空にすると、足した入れ方と時点も外す（足す前の形に戻る）。土地だけ・建物だけで入れた値段を空にしても同じ", () => {
    const wh = fresh();
    for (const [suffix, v] of [["/valuation/value", 40_000_000], ["/valuation/land", 15_000_000], ["/valuation/building", 25_000_000]] as const) {
      const back = set(set(wh, suffix, v), suffix, null);
      expect(owned(back).valuation, suffix).toBeUndefined();
      expect((owned(back) as { valueStates?: unknown }).valueStates, suffix).toBeUndefined();
    }
  });

  it("土地を入れなければ、目安の割合で分ける（空欄の読みに額を出す）", () => {
    const wh = set(fresh(), "/valuation/value", 40_000_000);
    const land = fieldOf(wh, "/valuation/land").get(wh);
    expect(land.value).toBeNull();
    expect(String(land.hint)).toContain("合計の30%");
    expect(owned(wh).valuation!.landShare).toBeUndefined();
  });

  it("買った年月は住み始めについてくる（入力の欄でも、住宅ローンの借りた年月で住み始めが動いて推定を入れ直したときも）", () => {
    let wh = set(fresh(), "/valuation/value", 40_000_000);
    expect(owned(wh).valuation!.asOf).toBe(BASE);
    wh = set(wh, "/from", { at: "2015-04" });
    expect(owned(wh).valuation!.asOf).toBe("2015-04");
    // 欄の外で住み始めが動いた（住宅ローンの借りた年月の連動など）
    wh = mutate(wh, (h) => void ((h.residences ?? []).find((r) => r.kind === "own")!.from = { at: "2012-10" }));
    wh = withRefreshedEstimates(wh);
    expect(owned(wh).valuation!.asOf).toBe("2012-10");
  });

  it("買った値段を入れると、目安のボタンの値の固定資産税を、買った値段からの推定にする", () => {
    let wh = set(fresh(), "/from", { at: "2015-04" });
    wh = set(wh, "/valuation/value", 40_000_000);
    const tax = owned(wh).propertyTax!.annual as { value: number; estimate?: { basis?: string } };
    expect(tax.estimate?.basis ?? "").toContain("固定資産税の推定");
    expect(tax.value).toBeGreaterThan(50_000);
    expect(tax.value).toBeLessThan(250_000);
  });

  it("モデル世帯（評価の時点が住み始めの前の版の世帯）も、標準に買った値段と土地の値段が入った形で出る", () => {
    const wh = fromRequest(modelHousehold("salariedCoupleTwoKids"));
    expect(fieldOf(wh, "/valuation/value").label).toBe("買った値段（土地と建物の合計）");
    expect(fieldOf(wh, "/valuation/value").get(wh).value).toBe(38_000_000);
    expect(fieldOf(wh, "/valuation/land").get(wh).value).toBe(13_300_000);
    expect(fieldOf(wh, "/valuation/building").get(wh).value).toBe(24_700_000);
  });
});

describe("見本の世帯（会社員の夫婦と子・持ち家）を標準の欄だけで入れ直す", () => {
  it("評価の欄を消して、標準の買った値段と土地の値段だけを入れ直すと、資産と負債の不動産が元の世帯と同じになる（もっともらしい額）", () => {
    const orig = fromRequest(modelHousehold("salariedCoupleTwoKids"));
    const v0 = owned(orig).valuation!;
    // 評価の欄を外し、建った年・構造だけ残す（標準でしか入れない FP は、建った年は空欄のまま＝買った年の新築）
    let wh = mutate(orig, (h) => void ((h.residences ?? []).find((r) => r.kind === "own")!.valuation = { structure: "wood" }));
    wh = set(wh, "/valuation/value", 38_000_000);
    wh = set(wh, "/valuation/land", 13_300_000);
    wh = withRefreshedEstimates(wh);
    const v = owned(wh).valuation!;
    expect(v.asOf).toBe(v0.asOf);
    expect(landOfShare(38_000_000, v.landShare!)).toBe(13_300_000);
    for (const row of ["cf.balance.account.realEstate.land", "cf.balance.account.realEstate.building"])
      for (const y of [2026, 2036, 2046]) expect(cells(wh, row, y), `${row} ${String(y)}`).toBe(cells(orig, row, y));
    // 2026年: 建物は2,470万円を木造22年のうち10年分減らした約1,347万円、土地は1,330万円から上がる
    expect(Math.round(cells(wh, "cf.balance.account.realEstate.building") / 10_000)).toBe(1347);
    expect(cells(wh, "cf.balance.account.realEstate.land")).toBeGreaterThan(13_300_000);
  });
});

describe("「固定資産税・名義などを入れる」で開く欄", () => {
  it("固定資産税と持ち家の評価を見出しと1行の説明のある中枠に分け、買った値段で入れる家には評価額・時点・土地の割合を出さない", () => {
    const wh = set(set(fresh(), "/from", { at: "2015-04" }), "/valuation/value", 40_000_000);
    const gs = groups(wh);
    const main = gs.find((g) => g.title?.startsWith("住まい 1"))!;
    expect(main.moreLabel).toBe("固定資産税・名義などを入れる");
    const taxes = gs.find((g) => g.title === "固定資産税・都市計画税")!;
    expect(taxes.band).toBe(true);
    expect(taxes.summary).toBeTruthy();
    expect(taxes.fields.map((f) => f.key.split("/").at(-1))).toEqual(["tax", "taxGrowth"]);
    expect(main.fields.some((f) => f.key.endsWith("/tax"))).toBe(false);
    const val = gs.find((g) => g.title === "持ち家の評価")!;
    expect(val.band).toBe(true);
    expect(val.summary).toContain("推計");
    expect(val.fields.map((f) => f.label)).toEqual(["評価の入れ方", "建物の構造", "建物が建った年"]);
    expect(maybeField(wh, "/valuation/landShare")).toBeUndefined();
    expect(maybeField(wh, "/valuation/asOf")).toBeUndefined();
  });

  it("今の時価で入れる家は、評価額と土地の割合を中枠に出し、標準の買った値段は出さない。評価額の「?」に先の年の動き方と例", () => {
    let wh = set(fresh(), "/valuation/basis", "market");
    expect(fieldOf(wh, "/valuation/value").label).toBe("評価額");
    expect(fieldOf(wh, "/valuation/value").level).toBe("detail");
    expect(maybeField(wh, "/valuation/land")).toBeUndefined();
    expect(fieldOf(wh, "/from").label).toBe("住み始め");
    expect(fieldOf(wh, "/valuation/landShare").level).toBe("detail");
    const help = fieldOf(wh, "/valuation/value").help ?? "";
    expect(help).toBe(MARKET_VALUE_HELP);
    expect(help).toContain("耐用年数");
    expect(help).toContain("20%で止め");
    expect(help).toContain("土地の上昇率");
    expect(help).toContain("例:");
    // 評価額が未入力なら、入るまで標準に出る（0144 の決まりのまま）
    expect(panel(wh, "simple")).toContain(`id="${fieldDomId(fieldOf(wh, "/valuation/value").key)}"`);
    // 買った値段に戻すと、標準の買った値段の欄に戻る
    wh = set(wh, "/valuation/basis", "purchase");
    expect(fieldOf(wh, "/valuation/value").level).toBe("simple");
  });

  it("例の数字は計算エンジンと合う（2016年築の木造・今の時価3,500万円・土地50%: 建物は2034年に約640万円で止まる）", () => {
    let wh = set(fresh(), "/valuation/basis", "market");
    wh = set(wh, "/valuation/value", 35_000_000);
    wh = set(wh, "/valuation/builtYear", 2016);
    wh = set(wh, "/valuation/landShare", "0.5");
    const b = (y: number) => cells(wh, "cf.balance.account.realEstate.building", y);
    expect(Math.round((b(2026) - b(2027)) / 10000)).toBe(146);
    expect(Math.round(b(2034) / 1_000_000)).toBe(6);
    expect(b(2035)).toBe(b(2034));
  });
});

describe("住宅購入の予定の土地は、割合でなく金額で入れる", () => {
  const buying = (): WorkingHousehold => action(blankHousehold(BASE), "housing/addPurchase");
  const plan = (wh: WorkingHousehold): Residence => (wh.request.input.household.residences ?? []).find((r) => r.purchase !== undefined)!;
  it("「うち土地の値段」を入れると土地の割合に読み替える（物件の価格を直すと同じ割合のまま）。割合の欄は出さない", () => {
    let wh = buying();
    expect(maybeField(wh, "/valuation/landShare")).toBeUndefined();
    expect(fieldOf(wh, "/purchase/landPrice").label).toBe("うち土地の値段");
    wh = set(wh, "/purchase/price", 50_000_000);
    wh = set(wh, "/purchase/landPrice", 20_000_000);
    expect(plan(wh).valuation?.landShare).toBe("0.4");
    wh = set(wh, "/purchase/price", 60_000_000);
    expect(fieldOf(wh, "/purchase/landPrice").get(wh).value).toBe(24_000_000);
    wh = set(wh, "/purchase/landPrice", 21_000_000);
    expect(landOfShare(60_000_000, plan(wh).valuation!.landShare!)).toBe(21_000_000);
    // 空にすると目安の割合に戻る
    wh = set(wh, "/purchase/landPrice", null);
    expect(plan(wh).valuation?.landShare).toBeUndefined();
    expect(String(fieldOf(wh, "/purchase/landPrice").get(wh).hint)).toContain("物件の価格の30%");
  });
});
