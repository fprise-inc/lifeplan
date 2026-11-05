// 収益不動産の見直し（2026-11-05。0079・0082 の追記）: 建物の無い種類（貸している土地・駐車場）の欄、標準の画面の不動産の一時の経費と
// 売却・大きな修繕の予定の入口、まだ入れていない物件の見出し、持ち始める時点の置き場所、貸し始め・貸し終わりの入れ方、物件のローンの団信の説明、
// 結果の収益不動産のタブの言葉（含み益・売ったときの手残りの目安・減価償却が終わる年・もう上回っています）
import { describe, expect, it } from "vitest";
import { h } from "preact";
import { renderToString } from "preact-render-to-string";
import type { RealEstateAnalysisProperty } from "../../report/src/index.ts";
import { depreciationEndText, deadCrossText } from "../../report/src/index.ts";
import { fieldDomId, groupUnits, headsWithMore, type GroupOpenState } from "../src/workspace/input/FieldViews.tsx";
import { allFields, type FieldDef, type StageDef } from "../src/workspace/input/form.ts";
import { blankHousehold, fromRequest, mutate, type WorkingHousehold } from "../src/workspace/input/household.ts";
import { InputPanel } from "../src/workspace/input/InputPanel.tsx";
import { buildStage } from "../src/workspace/input/stages/index.ts";
import { addRentalProperty, RENTAL_CREDIT_LIFE_HELP, rentalProperties } from "../src/workspace/input/stages/rental.ts";
import { analysisOf, propertyMetrics } from "../src/workspace/rentalTab.ts";
import { modelHousehold, preview } from "./helpers.ts";

const seq = () => {
  let n = 0;
  return () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`;
};
const noop = () => undefined;
const open = (id = "dualAssetsTwoKids"): WorkingHousehold => fromRequest(modelHousehold(id));
const stageOf = (wh: WorkingHousehold): StageDef => buildStage("rental", wh);
const fields = (wh: WorkingHousehold): FieldDef[] => allFields(stageOf(wh));
const fieldOf = (wh: WorkingHousehold, key: string): FieldDef => {
  const f = fields(wh).find((x) => x.key === key);
  if (f === undefined) throw new Error(`欄が無い: ${key}`);
  return f;
};
const opened = (keys: readonly string[]): GroupOpenState => ({ isOpen: (k) => keys.includes(k), toggle: noop });
const panel = (wh: WorkingHousehold, level: "simple" | "detail", keys: readonly string[] = []) =>
  renderToString(h(InputPanel, { wh, itemId: "rental", level, onLevel: noop, onSave: noop, onClose: noop, groupOpen: opened(keys) }));
const first = (wh: WorkingHousehold) => rentalProperties(wh.request.input.household)[0]!;
const setProp = (wh: WorkingHousehold, f: (p: Record<string, unknown>) => void) =>
  mutate(wh, (hh) => {
    const a = (hh.accounts ?? []).find((x) => x.kind === "realEstate" && x.property !== undefined)!;
    f(a.property as Record<string, unknown>);
  });

describe("建物の無い種類（貸している土地・駐車場）", () => {
  it("建物の構造・建った年・土地の割合を出さず、取得価額は「取得価額」。まとまりの名前は土地（駐車場は土地と設備）", () => {
    for (const kind of ["land", "parking"] as const) {
      const wh = setProp(open(), (p) => {
        p.kind = kind;
        delete p.landShare;
        delete p.structure;
        delete p.builtYear;
      });
      const k = `sav/${first(wh).id}/property`;
      const keys = fields(wh).map((f) => f.key);
      for (const x of ["structure", "builtYear", "landShare"]) expect(keys, `${kind} ${x}`).not.toContain(`${k}/${x}`);
      expect(fieldOf(wh, `${k}/acqPrice`).label).toBe("取得価額");
      expect(fieldOf(wh, `${k}/acqPrice`).help).toContain("減価償却はしません");
      const g = stageOf(wh).sections[0]!.groups.find((x) => x.key === `${k}/building`)!;
      expect(g.title).toBe(kind === "parking" ? "土地と設備" : "土地");
    }
  });

  it("駐車場は取得価額の内訳を土地と設備（舗装・機械式駐車設備など）で入れられ、設備の耐用年数を入れる。建物の内訳は出さない", () => {
    const wh = setProp(open(), (p) => {
      p.kind = "parking";
      delete p.landShare;
      p.acquisition = { price: 20000000, at: "2020-04", parts: { land: 18000000, equipment: 2000000 } };
    });
    const k = `sav/${first(wh).id}/property`;
    const keys = fields(wh).map((f) => f.key);
    expect(keys).toContain(`${k}/part/land`);
    expect(keys).toContain(`${k}/part/equipment`);
    expect(keys).not.toContain(`${k}/part/building`);
    expect(fieldOf(wh, `${k}/part/equipment`).label).toBe("取得価額の内訳: 設備（舗装・機械式駐車設備など）");
    expect(fieldOf(wh, `${k}/equipmentLife`)).toMatchObject({ label: "設備の耐用年数" });
    expect(fieldOf(wh, `${k}/equipmentLife`).help).toContain("アスファルト敷き10年");
  });

  it("前の版で土地の割合が入っている世帯は、黙って変えず欄を出して知らせる。「空にする」で全部を土地として計算する", () => {
    const wh = setProp(open(), (p) => {
      p.kind = "land";
      p.landShare = "0.3";
    });
    const k = `sav/${first(wh).id}/property`;
    expect(fields(wh).map((f) => f.key)).toContain(`${k}/structure`);
    const st = fieldOf(wh, `${k}/landShare`).get(wh);
    expect(st.value).toBe("0.3");
    expect(st.warn).toContain("今はこの割合で建物の分を減価償却しています");
    expect(st.warnFix?.label).toBe("空にする（全部を土地にする）");
    const fixed = st.warnFix!.run(wh);
    expect(first(fixed).property?.landShare).toBeUndefined();
    expect(fields(fixed).map((f) => f.key)).not.toContain(`${k}/landShare`);
    // 計算: 知らせの前は建物の分を償却し、空にすると償却しない
    const dep = (w: WorkingHousehold) => analysisOf(preview(w.request))!.properties[0]!.years.reduce((s, y) => s + (y.depreciation ?? 0), 0);
    expect(dep(wh)).toBeGreaterThan(0);
    expect(dep(fixed)).toBe(0);
  });
});

describe("標準の画面: 不動産の一時の経費と、売却・大きな修繕の予定の入口", () => {
  it("不動産の一時の経費（出るお金）の区画と、入れた行が標準でも見える", () => {
    let wh = open();
    expect(panel(wh, "simple")).toContain('data-section="money/rental/out"');
    const add = buildStage("rental", wh).sections.find((s) => s.key === "money/rental/out")!.actions[0]!;
    expect(add.level).toBe("simple");
    wh = add.run(wh);
    const row = (wh.request.input.household.periodicExpenses ?? []).find((p) => p.kind === "realEstateCost")!;
    expect(panel(wh, "simple")).toContain(`data-group="ev/${row.id}"`);
  });

  it("売却・大きな修繕の予定は、標準では専用の「▸ 売る予定・大きな修繕を入れる」で開く。物件の頭の「▸」は所在地・持分・メモなど", () => {
    const wh = open();
    const a = first(wh);
    const kp = `sav/${a.id}/property`;
    const groups = stageOf(wh).sections[0]!.groups;
    const units = groupUnits(groups);
    expect(units.get(`${kp}/sale`)).toBe(`${kp}/plans`);
    expect(units.get(`${kp}/repairs`)).toBe(`${kp}/plans`);
    expect(headsWithMore(groups).has(`${kp}/plans`)).toBe(true);
    expect(groups.find((g) => g.key === `sav/${a.id}`)?.moreLabel).toBe("所在地・持分・メモなどを入れる");
    const closed = panel(wh, "simple").replace(/<wbr\/?>/g, "");
    expect(closed).toContain("売る予定・大きな修繕を入れる");
    expect(closed).not.toContain(`id="${fieldDomId(`${kp}/sell`)}"`);
    // 開くと、売却と大きな修繕だけが出る（所在地は出ない）
    const html = panel(wh, "simple", [`${kp}/plans`]);
    expect(html).toContain(`id="${fieldDomId(`${kp}/sell`)}"`);
    expect(html).toContain(`data-action="${kp}/addRepair"`);
    expect(html).not.toContain(`id="${fieldDomId(`${kp}/location`)}"`);
    // 詳細では入口を出さず、売却・大きな修繕をそのまま出す
    const detail = panel(wh, "detail");
    expect(detail).not.toContain(`data-group="${kp}/plans"`);
    expect(detail).toContain(`id="${fieldDomId(`${kp}/sell`)}"`);
  });

  it("入口の見出しに、入っている予定（売る時期・大きな修繕の件数）を書く", () => {
    const wh = setProp(open(), (p) => {
      p.sale = { at: { at: "2036-03" } };
      p.repairs = [{ id: "00000000-0000-4000-8000-0000000000aa", at: { at: "2030-06" }, amount: 3000000 }];
    });
    const g = stageOf(wh).sections[0]!.groups.find((x) => x.key.endsWith("/property/plans"))!;
    expect(g.title).toBe("売却・大きな修繕の予定（2036年3月に売る・大きな修繕 1件）");
    expect(g.note).toBeUndefined();
  });
});

describe("細かい所", () => {
  it("まだ入れていない物件の見出しは「評価額は未入力」", () => {
    const wh = addRentalProperty(blankHousehold("2026-10", seq()));
    expect(stageOf(wh).sections[0]!.groups[0]!.title).toBe("物件1（評価額は未入力）");
  });

  it("持ち始める時点は物件の見出しのまとまり（評価額の時点の後）。貸し始め・貸し終わりの初めの入れ方はどちらも年月", () => {
    const wh = open();
    const a = first(wh);
    const groups = stageOf(wh).sections[0]!.groups;
    const head = groups.find((g) => g.key === `sav/${a.id}`)!;
    const keys = head.fields.map((f) => f.key);
    expect(keys.indexOf(`sav/${a.id}/property/holdFrom`)).toBe(keys.indexOf(`sav/${a.id}/asOf`) + 1);
    expect(groups.find((g) => g.key === `sav/${a.id}/property/building`)!.fields.some((f) => f.key.endsWith("/holdFrom"))).toBe(false);
    expect(fieldOf(wh, `sav/${a.id}/property/rentFrom`).time?.when.defaultMode).toBe("ym");
    expect(fieldOf(wh, `sav/${a.id}/property/rentTo`).time?.when.defaultMode).toBe("ym");
  });

  it("物件のローンの団信の「?」は収益物件のローン向けの文（住宅ローン・フラット35 の文ではない）", () => {
    const wh = open();
    const d = (wh.request.input.household.debts ?? []).find((x) => x.property === first(wh).id)!;
    const f = fieldOf(wh, `housing/debt/${d.id}/creditLife`);
    expect(f.help).toBe(RENTAL_CREDIT_LIFE_HELP);
    expect(f.help).not.toContain("フラット35");
  });
});

describe("結果の収益不動産のタブの言葉", () => {
  const wh = open();
  const p = analysisOf(preview(wh.request))!.properties[0]!;
  const y = p.years.find((x) => x.year === 2027)!;
  const metric = (ms: ReturnType<typeof propertyMetrics>, k: string) => ms.find((m) => m.key === k);

  it("含み益は評価額−帳簿価額。評価額−ローン残高は「売ったときの手残りの目安（ローン返済後）」で、費用・税を引かないことを「?」に書く", () => {
    const ms = propertyMetrics(p, y, { baseYear: 2026 });
    expect(y.unrealizedGain).toBe((y.value ?? 0) - (y.bookValue ?? 0));
    expect(metric(ms, "unrealizedGain")!.label).toBe("含み益");
    expect(metric(ms, "unrealizedGain")!.help).toContain("帳簿価額");
    expect(metric(ms, "equity")!.label).toBe("売ったときの手残りの目安（ローン返済後）");
    expect(metric(ms, "equity")!.help).toContain("譲渡所得の税は引いていません");
  });

  it("減価償却が終わる年が売るまでに来なければ、理由と見込みの年を書く。計算の最初の年から上回っていれば「もう上回っています」", () => {
    const sold: RealEstateAnalysisProperty = { ...p, depreciationEnd: { building: null, equipment: null }, depreciationEndIfContinued: { building: 2061, equipment: null }, exit: { ym: "2040-06", price: 1, costs: 0, proceeds: 1, loanPayoff: 0, tax: 0, net: 1 } };
    expect(metric(propertyMetrics(sold, y, { baseYear: 2026 }), "depreciationEnd")!.value).toBe("売るまでには終わりません（2061年に終わる見込み）");
    expect(depreciationEndText({ depreciationEnd: { building: null, equipment: null }, depreciationEndIfContinued: { building: 2061, equipment: null }, sells: false })).toBe("貸し終わるまでには終わりません（2061年に終わる見込み）");
    expect(depreciationEndText({ depreciationEnd: { building: 2050, equipment: 2035 }, sells: false })).toBe("建物 2050年・設備 2035年");
    expect(deadCrossText(2026, 2026)).toBe("もう上回っています");
    expect(deadCrossText(2030, 2026)).toBe("2030年");
    expect(metric(propertyMetrics({ ...p, acquisition: null, depreciationEnd: { building: null, equipment: null } }, y, { baseYear: 2026 }), "depreciationEnd")!.value).toBe("—（取得価額が未入力）");
  });

  it("貸している土地は築年数の指標を出さず、減価償却が終わる年は「建物が無いので、減価償却しません」", () => {
    const land = setProp(open(), (q) => {
      q.kind = "land";
      delete q.landShare;
    });
    const lp = analysisOf(preview(land.request))!.properties[0]!;
    expect(lp.builtYear).toBeNull();
    const ms = propertyMetrics(lp, lp.years.find((x) => x.year === 2027), { baseYear: 2026, landOnly: true });
    expect(metric(ms, "age")).toBeUndefined();
    expect(metric(ms, "depreciationEnd")!.value).toBe("—（建物が無いので、減価償却しません）");
  });
});
