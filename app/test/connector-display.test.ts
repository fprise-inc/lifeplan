// AI接続口の表示の設定（get_display_settings。0213）: 一覧は画面の定数から作り（選べる種類・既定が画面と同じ）、結果のタブ・資産と負債のタブの
// 表示の設定の欄すべてに id があり、今の値は画面と同じ読み方（事務所の既定値の readOfficeSettings・世帯ファイルの本文の readDisplay と同じ答え）で、
// 計算の結果を変える設定は返さない。接続口に埋め込む JSON（crates/lifeplan/dist/display-catalog.json）は、作ってあればこの一覧と同じ
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { displayCurrent, householdCurrent, officeCurrent, readDisplaySettings, readOfficeDisplay } from "../src/connector/display.ts";
import { BALANCE_SETTING_IDS, buildDisplayCatalog, RESULT_SETTING_IDS } from "../src/connector/displayCatalog.ts";
import { DEFAULT_PREMISE_KINDS, OPEN_SCENES, PREMISE_KINDS, SCENE_KINDS } from "../src/workspace/contingency/premiseChoice.ts";
import { STAGE_ORDER } from "../src/workspace/input/stageOrder.ts";
import { layoutOf, readOfficeSettings } from "../src/workspace/office/settings.ts";
import { DEFAULT_LEVER_KINDS, LEVER_KINDS } from "../src/workspace/plans/leverChoice.ts";
import { DEFAULT_BALANCE_SETTINGS, DEFAULT_DISPLAY_SETTINGS, METRIC_CHOICES } from "../src/workspace/settings.ts";
import { readDisplay } from "../src/workspace/store/body.ts";
import { cardOrder } from "../src/workspace/input/items.ts";

const catalog = buildDisplayCatalog();
const byId = (id: string) => {
  const s = catalog.settings.find((x) => x.id === id);
  if (s === undefined) throw new Error(id);
  return s;
};

describe("表示の設定の一覧", () => {
  it("id は重ならず、選べる値と既定は画面の定数と同じ", () => {
    const ids = catalog.settings.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(catalog.summary.settings).toBe(ids.length);
    expect(byId("result.levers").choices?.map((c) => c.value)).toEqual(LEVER_KINDS.map((k) => k.kind));
    expect(byId("result.levers").default).toEqual([...DEFAULT_LEVER_KINDS]);
    expect(byId("contingency.premises").choices?.map((c) => c.value)).toEqual(PREMISE_KINDS.map((k) => k.kind));
    expect(byId("contingency.premises").default).toEqual([...DEFAULT_PREMISE_KINDS]);
    expect(byId("contingency.scenes").choices?.map((c) => c.value)).toEqual(SCENE_KINDS.map((k) => k.kind));
    expect(byId("contingency.openScene").choices?.map((c) => c.value)).toEqual(OPEN_SCENES.map((k) => k.key));
    expect(byId("input.order").default).toEqual(STAGE_ORDER.map((s) => s.id));
    expect(byId("result.metrics").choices?.map((c) => c.value)).toEqual(METRIC_CHOICES.map((c) => c.key));
    // いつも出す入力項目は外せない印
    expect(byId("input.items").choices?.filter((c) => c.fixed === true).map((c) => c.value)).toEqual(["family", "assumptions"]);
  });

  it("結果のタブ・資産と負債のタブの表示の設定の欄すべてに id がある（欄を足したら一覧にも足す）", () => {
    for (const k of Object.keys(DEFAULT_DISPLAY_SETTINGS)) expect(ids(RESULT_SETTING_IDS[k as keyof typeof RESULT_SETTING_IDS])).toBe(true);
    for (const k of Object.keys(DEFAULT_BALANCE_SETTINGS)) for (const id of BALANCE_SETTING_IDS[k as keyof typeof BALANCE_SETTING_IDS]) expect(ids(id)).toBe(true);
    function ids(id: string | undefined): boolean {
      return id !== undefined && catalog.settings.some((s) => s.id === id);
    }
  });

  it("どこで決めるか・変える所・お客さまに渡す物に出るか", () => {
    expect(byId("result.levers").scope).toBe("office");
    expect(byId("input.items").scope).toBe("both");
    expect(byId("input.items").officeEffect).toBe("newHouseholds");
    expect(byId("balance.columns").scope).toBe("household");
    expect(byId("features.combinedBs").readOnly).toBe(true);
    expect(byId("result.atAge").reaches).toMatchObject({ proposal: true, takeaway: true });
    expect(byId("balance.guide").reaches).toMatchObject({ proposal: false, takeaway: false });
    for (const s of catalog.settings) {
      if (s.scope !== "household") expect(s.change.office, s.id).toBeTruthy();
      if (s.scope !== "office") expect(s.change.household, s.id).toBeTruthy();
    }
  });

  it("計算の結果を変える設定は載せず、隠せない知らせを書く。言葉の決まり（比較・入力項目）", () => {
    const text = JSON.stringify(catalog);
    for (const k of ["assumptions", "estimates", "protection", "inheritLikelihood", "realEstateRatio", "endAge", "fee", "branding", "hearing"]) {
      expect(catalog.settings.some((s) => s.id.toLowerCase().includes(k.toLowerCase()) || JSON.stringify(s.stored).includes(`defaults.${k}`)), k).toBe(false);
    }
    expect(catalog.neverHidden.join("")).toContain("入力が足りない");
    expect(catalog.neverHidden.join("")).toContain("計算に入れていない");
    expect(catalog.neverHidden.join("")).toContain("注意");
    for (const w of ["比べ", "カード", "札"]) expect(text.includes(w), w).toBe(false);
  });

  it("接続口に埋め込む JSON は、作ってあればこの一覧と同じ", () => {
    const p = join(import.meta.dirname, "..", "..", "crates", "lifeplan", "dist", "display-catalog.json");
    if (!existsSync(p)) return;
    expect(JSON.parse(readFileSync(p, "utf8"))).toEqual(JSON.parse(JSON.stringify(catalog)));
  });
});

describe("今の値の読み方は画面と同じ", () => {
  const offices: unknown[] = [
    {},
    null,
    { layout: { order: ["work", "family", "nope"] }, items: { hidden: ["rental", "family"], levels: { work: "detail", car: "simple" } } },
    { levers: { shown: ["lever:nisaMonthly", "x"], hidden: ["spouse:work"] }, premises: { shown: ["death:reserve"] }, scenes: { hidden: ["death", "disability", "illness", "income", "market"], open: "income" } },
    { living: { rows: [{ kind: "group", label: "固定費", categories: ["utilities", "communication"] }, { kind: "one", category: "food" }] }, features: { combinedBs: "yes" } },
    { layout: "x", items: [], levers: 3, scenes: { hidden: ["market"] }, features: { combinedBs: true } },
  ];
  it.each(offices.map((o, i) => [i, o]))("事務所の既定値 %i", (_i, raw) => {
    const mine = readOfficeDisplay(raw);
    const screen = readOfficeSettings(raw);
    expect(mine.layout.order).toEqual(cardOrder(layoutOf(screen)));
    expect(mine.items).toEqual(screen.items);
    expect(mine.levers).toEqual(screen.levers);
    expect(mine.premises).toEqual(screen.premises);
    expect(mine.scenes).toEqual(screen.scenes);
    expect(mine.living).toEqual(screen.living);
    expect(mine.features).toEqual(screen.features);
  });

  const displays: unknown[] = [
    undefined,
    {},
    { result: { metrics: ["takeHome", "x"], atAge: 90, layout: "all", invBreakdown: true, invPeriods: false }, balance: { guide: { months: [3, 9], risk: [5, 50], debt: 40, basis: "livingLoan" }, points: ["now", "age65"], columns: [{ point: "now" }, { year: 2040 }], moneyThree: { months: 3, years: 20, wording: "time" } } },
    { metrics: ["minAssets"], atAge: 80, bsGuide: { months: [1, 2], risk: [0, 10], debt: 10 }, bsPoints: ["now", "retire"], bsColumns: null },
    { result: { layout: "bad", atAge: "95" }, balance: { health: false, guide: { months: [9, 3] }, points: ["now"], moneyThree: { months: 99 } } },
    { balance: { health: "no" } },
  ];
  it.each(displays.map((d, i) => [i, d]))("世帯ファイルの本文の表示の設定 %i", (_i, raw) => {
    expect(readDisplaySettings(raw)).toEqual(readDisplay(raw));
  });

  it("事務所の既定値の今の値: 足した・外した種類を一覧の並びで、言葉の要約つき", () => {
    const v = officeCurrent({ levers: { shown: ["lever:nisaMonthly"] }, scenes: { open: "market" }, features: { combinedBs: true }, featureCodes: ["combinedBs"] });
    expect(v["result.levers"]?.value).toEqual(["lever:retireAge", "lever:pensionAge", "lever:nisaMonthly", "lever:livingMonthly", "spouse:work"]);
    expect(v["result.levers"]?.isDefault).toBe(false);
    expect(v["result.levers"]?.text).toContain("NISAの積立額（月）");
    expect(v["contingency.openScene"]?.text).toBe("相場の下落");
    expect(v["features.combinedBs"]?.text).toContain("入っている");
    expect(v["input.order"]?.isDefault).toBe(true);
    expect(v["input.living"]?.isDefault).toBe(true);
    // 一覧に無い欄（計算の設定）は、届いても返さない
    const all = JSON.parse(displayCurrent(JSON.stringify({ assumptions: { inflation: "0.03" }, endAge: 95 }), "null", "")) as { office: Record<string, unknown>; household: unknown };
    expect(Object.keys(all.office).every((k) => catalog.settings.some((s) => s.id === k))).toBe(true);
    expect(JSON.stringify(all)).not.toContain("0.03");
    expect(all.household).toBeNull();
  });

  it("渡された世帯の今の値: 対策に足した項目は種類の名前で", () => {
    const v = householdCurrent({ shownItems: ["inv:rate", "loan:00000000-0000-4000-8000-000000000001:rate", "field:assume/inflation"], itemChoice: { hidden: ["car"] }, display: {} });
    expect(v["result.addedItems"]?.value).toEqual([
      { key: "inv:rate", kind: "inv:rate", label: "運用の利回り（預金を除く）" },
      { key: "loan:00000000-0000-4000-8000-000000000001:rate", kind: "loan:rate", label: "住宅ローンの金利" },
      { key: "field:assume/inflation", kind: null, label: "入力の欄から足した項目" },
    ]);
    expect(v["input.items"]?.text).toContain("出さない: 車");
    expect(v["result.atAge"]?.isDefault).toBe(true);
    expect(v["balance.columns"]?.text).toContain("既定のまま");
  });
});
