// 相続税の試算（相続・贈与の入力項目の区画「相続税の試算」。0231）: チェックしない世帯は入力が増えない・チェックした世帯だけ不動産ごとの欄・
// 建物の固定資産税評価額の推定を計算の要求にだけ足す・「詳しく試算しますか」の一言・内訳の不動産の行・物を外したら設定の行も消す・
// チェックを外して入れ直すと同じ値で試算する・建てる・買う予定の物件（0232）は画面の推定を足さない
import { describe, expect, it } from "vitest";
import type { PreviewResult } from "../src/engine/types.ts";
import { forEngine } from "../src/engine/moneyRows.ts";
import { chartRequests, scenarios } from "../src/workspace/contingency/requests.ts";
import { allFields, type FieldDef, type StageDef } from "../src/workspace/input/form.ts";
import { fromRequest, type WorkingHousehold } from "../src/workspace/input/household.ts";
import { buildingEstimateOf, DETAILED_HELP, isDetailed, landTargets, setDetailed, withLandEstimates } from "../src/workspace/input/inheritanceLand.ts";
import { detailPrompt, inheritanceRequest, inheritanceView } from "../src/workspace/input/inheritanceLine.ts";
import { buildStage } from "../src/workspace/input/stages/index.ts";
import { refSites } from "../src/workspace/input/refs.ts";
import { modelHousehold, preview } from "./helpers.ts";

const stage = (wh: WorkingHousehold): StageDef => buildStage("inheritance", wh);
const keys = (wh: WorkingHousehold, level?: "simple"): string[] =>
  stage(wh)
    .sections.filter((s) => level === undefined || s.level === "simple")
    .flatMap((s) => s.groups.filter((g) => level === undefined || g.level === "simple").flatMap((g) => g.fields.filter((f) => level === undefined || f.level === "simple").map((f) => f.key)));
const fieldOf = (wh: WorkingHousehold, key: string): FieldDef => {
  const f = allFields(stage(wh)).find((x) => x.key === key);
  if (f === undefined) throw new Error(`no field ${key}`);
  return f;
};
const estimate = (wh: WorkingHousehold): PreviewResult => preview(forEngine(inheritanceRequest(wh.request)));

const rental = fromRequest(modelHousehold("rentalSample"));
const home = rental.request.input.household.residences!.find((r) => r.kind === "own")!;
const prop = rental.request.input.household.accounts!.find((a) => a.kind === "realEstate" && a.property?.rental !== undefined)!;

describe("相続税も試算しない世帯は入力が増えない", () => {
  it("区画「相続税の試算」は詳細の1つの欄（相続税も試算する）だけ。標準の欄は増えない", () => {
    const sec = stage(rental).sections.find((s) => s.key === "inherit/detail")!;
    expect(sec.level).toBe("detail");
    expect(sec.groups.flatMap((g) => g.fields.map((f) => f.key))).toEqual(["inherit/tax/detailed"]);
    expect(keys(rental, "simple").filter((k) => k.startsWith("inherit/land/") || k === "inherit/tax/detailed")).toEqual([]);
    expect(isDetailed(rental)).toBe(false);
  });

  it("チェックしない世帯の要求には建物の推定を足さず、毎回の計算の要求からは設定ごと外れる", () => {
    const req = inheritanceRequest(rental.request);
    expect(req.input.inheritanceTax?.lands).toBeUndefined();
    const on = setDetailed(rental, true);
    expect(forEngine(on.request).input.inheritanceTax).toBeUndefined();
  });
});

describe("相続税も試算する世帯", () => {
  const on = setDetailed(rental, true);
  it("チェックすると区画が標準に出て、不動産ごとのまとまり（持ち家・物件）が並ぶ。外すと設定は残したまま区画は詳細の1つの欄に戻る", () => {
    const sec = stage(on).sections.find((s) => s.key === "inherit/detail")!;
    expect(sec.level).toBe("simple");
    const targets = landTargets(on.request.input.household);
    // 遺産の分け方（0250）のまとまりは、夫婦の世帯か子が2人以上の世帯だけ、不動産の前に出る
    expect(sec.groups.map((g) => g.key)).toEqual(["inherit/detail", "inherit/division", ...targets.map((t) => `inherit/land/${t.object}`)]);
    expect(keys(on)).toContain(`inherit/land/${home.id}/area`);
    expect(keys(on)).toContain(`inherit/land/${prop.id}/leasehold`);
    const withArea = fieldOf(on, `inherit/land/${home.id}/area`).set(on, "165.5");
    expect(withArea.request.input.inheritanceTax?.lands).toEqual([{ object: home.id, area: "165.5" }]);
    const off = setDetailed(withArea, false);
    expect(off.request.input.inheritanceTax?.detailed).toBeUndefined();
    expect(off.request.input.inheritanceTax?.lands).toEqual([{ object: home.id, area: "165.5" }]);
  });

  it("評価の入れ方で出る欄が変わる（路線価→路線価の欄、倍率→固定資産税評価額と倍率）。時価に戻すと入れ方の欄を消す", () => {
    const m = fieldOf(on, `inherit/land/${home.id}/method`);
    const route = m.set(on, "routePrice");
    expect(keys(route)).toContain(`inherit/land/${home.id}/routePrice`);
    const mult = m.set(on, "multiplier");
    expect(keys(mult)).toEqual(expect.arrayContaining([`inherit/land/${home.id}/fixedValue`, `inherit/land/${home.id}/multiplier`]));
    expect(m.set(route, "market").request.input.inheritanceTax?.lands).toBeUndefined();
  });

  it("取得する人を選ぶと「要件を満たす」の欄が出る（配偶者が自宅を取得するときは出さない）。二次の相続は別に選ぶ", () => {
    const a1 = fieldOf(on, `inherit/land/${home.id}/primary/acquirer`);
    expect(a1.get(on).value).toBeNull();
    const sp = a1.set(on, "spouse");
    expect(keys(sp)).not.toContain(`inherit/land/${home.id}/primary/met`);
    const co = fieldOf(on, `inherit/land/${home.id}/secondary/acquirer`).set(on, "cohabiting");
    expect(keys(co)).toContain(`inherit/land/${home.id}/secondary/met`);
    const met = fieldOf(co, `inherit/land/${home.id}/secondary/met`).set(co, true);
    expect(met.request.input.inheritanceTax?.lands?.[0]).toEqual({ object: home.id, secondary: { acquirer: "cohabiting", met: true } });
  });

  it("建物の固定資産税評価額を入れていない不動産は、計算の要求にだけ推定を足す（世帯には保存しない）", () => {
    const req = inheritanceRequest(on.request);
    const lands = req.input.inheritanceTax?.lands ?? [];
    const est = buildingEstimateOf(on.request, home.id);
    expect(est).not.toBeNull();
    expect(lands.find((l) => l.object === home.id)?.buildingEstimate).toBe(est);
    expect(on.request.input.inheritanceTax?.lands).toBeUndefined();
    // 入れた額があれば推定を足さない
    const entered = fieldOf(on, `inherit/land/${home.id}/building`).set(on, 8_000_000);
    expect(withLandEstimates(entered.request.input.inheritanceTax!, entered.request).lands?.find((l) => l.object === home.id)).toEqual({ object: home.id, buildingValue: 8_000_000 });
  });

  it("万一のタブの死亡の想定の要求にも推定を足す", () => {
    const death = scenarios(on).find((s) => s.kind === "death")!;
    const sc = chartRequests(on, "current", [], death, 2030)["current|sc"]!;
    expect(sc.input.inheritanceTax?.points).toEqual(["contingency"]);
    expect(sc.input.inheritanceTax?.lands?.some((l) => l.buildingEstimate !== undefined)).toBe(true);
  });

  it("内訳に不動産ごとの評価と特例の行を出し、含めていない一覧から小規模宅地等の特例を外す", () => {
    const w = fieldOf(on, `inherit/land/${home.id}/area`).set(on, "150");
    const v = inheritanceView(w, estimate(w));
    const now = v.points.find((p) => p.title.startsWith("いま"))!;
    expect(now.details.some((d) => d.startsWith("持ち家: 土地 ") && d.includes("特例 150㎡ −"))).toBe(true);
    expect(v.notIncluded).not.toContain("小規模宅地等の特例");
  });

  it("持ち家・物件を外したら、その不動産の設定の行も消す（片付けの一覧）", () => {
    const w = fieldOf(on, `inherit/land/${home.id}/area`).set(on, "150");
    const sites = refSites(w.request.input as never).filter((s) => s.item === "inheritanceTax.lands");
    expect(sites.map((s) => [s.id, s.target])).toEqual([[home.id, "residence"]]);
  });
});

describe("「詳しく試算しますか」の一言", () => {
  it("目安でかかりそうで、不動産を持つ世帯だけ（チェックした世帯には出さない）", () => {
    const r = estimate(rental);
    const likely = (r.inheritanceTax?.points ?? []).some((p) => p.status === "ok" && !p.noTax);
    expect(detailPrompt(rental, r) !== null).toBe(likely);
    expect(detailPrompt(setDetailed(rental, true), r)).toBeNull();
    const fake = { ...r, inheritanceTax: { points: [{ ...(r.inheritanceTax?.points[0] as object), status: "ok", state: "estimated", noTax: false }], notIncluded: [] } } as unknown as PreviewResult;
    expect(detailPrompt(rental, fake)).toContain("詳しく試算しますか");
    const none = fromRequest(modelHousehold("salariedCoupleTwoKids"));
    const noLand = { ...none, request: { ...none.request, input: { ...none.request.input, household: { ...none.request.input.household, residences: [], accounts: (none.request.input.household.accounts ?? []).filter((a) => a.kind !== "realEstate") } } } };
    expect(detailPrompt(noLand, fake)).toBeNull();
  });
});

describe("チェックを外しても入れた値は残り、チェックし直せば同じ値で試算する", () => {
  it("「?」の説明の最後の1文", () => {
    expect(DETAILED_HELP.endsWith("チェックを外しても入れた値は残り、チェックし直せば同じ値で試算します")).toBe(true);
    expect(fieldOf(rental, "inherit/tax/detailed").help).toBe(DETAILED_HELP);
  });

  it("入れた値（面積・路線価・取得する人）は外しても残り、入れ直すと同じ設定・同じ試算の結果", () => {
    const on = setDetailed(rental, true);
    const a = fieldOf(on, `inherit/land/${home.id}/area`).set(on, "180");
    const b = fieldOf(a, `inherit/land/${home.id}/method`).set(a, "routePrice");
    const c = fieldOf(b, `inherit/land/${home.id}/routePrice`).set(b, 220_000);
    const filled = fieldOf(c, `inherit/land/${prop.id}/primary/acquirer`).set(c, "successor");
    const off = setDetailed(filled, false);
    expect(fieldOf(off, "inherit/tax/detailed").get(off).value).toBe(false);
    expect(off.request.input.inheritanceTax?.lands).toEqual(filled.request.input.inheritanceTax?.lands);
    // 外している間の試算は、設定が無い世帯と同じ（不動産ごとの評価を出さない）
    const offPoints = estimate(off).inheritanceTax?.points ?? [];
    expect(offPoints.every((p) => (p as { lands?: unknown }).lands === undefined)).toBe(true);
    const again = setDetailed(off, true);
    expect(again.request.input.inheritanceTax).toEqual(filled.request.input.inheritanceTax);
    expect(estimate(again).inheritanceTax).toEqual(estimate(filled).inheritanceTax);
    expect(fieldOf(again, `inherit/land/${home.id}/routePrice`).get(again).value).toBe(220_000);
  });
});

describe("建てる・買う予定の物件（0232）", () => {
  /** 物件に土地ごと買う予定を足す（建物の固定資産税評価額は推定の箱） */
  const planned = (() => {
    const on = setDetailed(rental, true);
    const req = structuredClone(on.request);
    const a = req.input.household.accounts!.find((x) => x.id === prop.id)!;
    a.property = { ...a.property!, planned: { type: "buy", at: { at: "2028-07" }, parts: { land: 20_000_000, building: 25_000_000 }, assessed: { value: 10_000_000, state: "confirmed", origin: { kind: "manual" } } } as never };
    return { ...on, request: req };
  })();

  it("画面の推定 buildingEstimate を足さない（計算エンジンが予定の欄の建物の固定資産税評価額を使う）。欄の空欄の意味も予定の欄", () => {
    expect(buildingEstimateOf(planned.request, prop.id)).toBeNull();
    const lands = inheritanceRequest(planned.request).input.inheritanceTax?.lands ?? [];
    expect(lands.find((l) => l.object === prop.id)?.buildingEstimate).toBeUndefined();
    expect(fieldOf(planned, `inherit/land/${prop.id}/building`).blankMeans).toContain("建てる・買う予定の欄");
  });

  it("予定の買う月が計算基準月の3年以内なら、貸付の3年の決まりの欄を出す（前からの貸し始めを入れていても、買う月から数える）", () => {
    const w = fieldOf(planned, `inherit/land/${prop.id}/use`).set(planned, "rental");
    expect(keys(w)).toContain(`inherit/land/${prop.id}/rentalContinued`);
    expect(keys(fieldOf(setDetailed(rental, true), `inherit/land/${prop.id}/use`).set(setDetailed(rental, true), "rental"))).not.toContain(`inherit/land/${prop.id}/rentalContinued`);
  });
});

describe("建物の評価の年ごとの動き（固定資産税の目安と同じ式。0181）", () => {
  const senior = setDetailed(fromRequest(modelHousehold("sampleSeniorRental")), true);
  const h = senior.request.input.household;
  const seniorHome = h.residences!.find((r) => r.kind === "own")!;
  const condo = h.accounts!.find((a) => a.kind === "realEstate" && a.property !== undefined)!;
  it("築年数で下限に届いた持ち家（1995年築の木造）は、いまも二人とも亡くなった後も同じ額で、内訳に「築年数による下限で横ばい」と書く。物件（2008年築の RC）は経過年数の補正率で下がる", () => {
    const r = estimate(senior);
    const pts = r.inheritanceTax?.points ?? [];
    const now = pts.find((p) => p.point === "now" && (p.lands?.length ?? 0) > 0)!;
    const both = pts.find((p) => p.point === "bothAfter")!;
    const homeNow = now.lands!.find((l) => l.object === seniorHome.id)!;
    const homeBoth = both.lands!.find((l) => l.object === seniorHome.id)!;
    expect(homeBoth.building).toBe(homeNow.building);
    expect(homeNow.buildingFloor).toBe(true);
    const condoNow = now.lands!.find((l) => l.object === condo.id)!;
    const condoBoth = both.lands!.find((l) => l.object === condo.id)!;
    expect(condoBoth.building).toBeLessThan(condoNow.building);
    expect(condoBoth.buildingFloor).toBeUndefined();
    const v = inheritanceView(senior, r);
    const lines = v.points.flatMap((p) => p.details);
    expect(lines.some((d) => d.startsWith("持ち家: ") && d.includes("固定資産税評価額の推定・築年数による下限で横ばい"))).toBe(true);
    expect(lines.some((d) => !d.startsWith("持ち家: ") && d.includes("築年数による下限"))).toBe(false);
  });
});
