// 対策の「外す」（0084 の4・追記 2026-11-12）: このプランで変えた値を現状のプランの値に戻し、最初から出さない項目は必ず対策から消える。
// 別のプランを元に作ったプラン（土台のプランが NISA を動かしている）で「外す」を押しても、保存した後・さらに写した後に土台の値が戻ってこない。
// 結果の画面の removeItem と同じ手順（backToCurrent → normalizeValues、出す項目は movedValues → leverView）で確かめる
import { describe, expect, it } from "vitest";
import { demoHousehold } from "../src/workspace/catalog.ts";
import { fromRequest, type WorkingHousehold } from "../src/workspace/input/household.ts";
import { buildCatalog, type Catalog } from "../src/workspace/plans/items.ts";
import { leverView, visibleKeys } from "../src/workspace/plans/leverChoice.ts";
import { applyValues, backToCurrent, changesOf, changesOfValues, effectiveValues, movedValues, normalizeValues, overwritePlan, savePlan, type Values } from "../src/workspace/plans/plans.ts";
import { roles } from "../src/workspace/roles.ts";
import { modelHousehold } from "./helpers.ts";

const NOW = "2026-11-12T10:00:00.000Z";
const ID = "salariedCoupleTwoKids";

function setup(): { wh: WorkingHousehold; cat: Catalog; b: string; c: string; extra: string[] } {
  const req = modelHousehold(ID);
  const self = roles(req).find((r) => r.key === "self")!.member;
  let wh = fromRequest(req, {});
  const cat = buildCatalog(wh, self.id, demoHousehold(ID)!);
  // プランB（現状から）: 見本の最初のプランと同じく NISA を月3万円に
  const b = savePlan(wh, cat, { name: "プランB", base: null, values: { "lever:retireAge": 65, "lever:nisaMonthly": 30_000, "lever:livingMonthly": 280_000 }, now: NOW });
  wh = b.wh;
  // プランC: 帯の「＋ このプランを元に作る」と同じく、B の中身を写して B を土台にする
  const c = savePlan(wh, cat, { name: "プランC Bを元に", base: b.id, values: effectiveValues(wh, b.id), now: NOW });
  wh = c.wh;
  // 足した3つ（積立をやめる年齢・3年ごとの支出の何年ごと・3年ごとの額）
  const ev = cat.items.filter((it) => /^field:ev\/.+\/(every|amount)$/.test(it.key)).map((it) => it.key);
  expect(ev).toHaveLength(2);
  return { wh, cat, b: b.id, c: c.id, extra: ["inv:stop", ...ev] };
}

/** 結果の画面の「外す」（App.tsx の removeItem）と同じ: 現状の値に戻してから、保存した値に合わせて整える */
const remove = (wh: WorkingHousehold, cat: Catalog, id: string, cur: Values, key: string): Values => normalizeValues(backToCurrent(cur, key, wh, cat), effectiveValues(wh, id), wh, cat);
/** 対策に出す項目（App.tsx と同じく、現状と違う値だけを渡す） */
const shownOf = (wh: WorkingHousehold, cat: Catalog, shown: string[], values: Values) => visibleKeys(leverView(cat, {}, shown, movedValues(values, wh, cat)));
const nisaOf = (wh: WorkingHousehold, cat: Catalog, values: Values) => cat.byKey.get("lever:nisaMonthly")!.read({ ...wh, request: applyValues(wh, values, cat) });

describe("対策の「外す」", () => {
  it("土台のプランが動かした NISA を外すと、対策から消え、現状（月1万円）に戻る。保存しても土台の月3万円に戻らない", () => {
    const { wh, cat, c, extra } = setup();
    const nisaNow = cat.byKey.get("lever:nisaMonthly")!.read(wh);
    expect(nisaNow).toBe(10_000);
    // 開いた直後: 既定でない4つ（値が入っている NISA と、足した3つ）が出ている
    let shown = [...extra];
    let cur = effectiveValues(wh, c);
    expect(cur["lever:nisaMonthly"]).toBe(30_000);
    for (const k of ["lever:nisaMonthly", ...extra]) expect(shownOf(wh, cat, shown, cur).has(k), k).toBe(true);
    // 4つとも「外す」
    for (const k of ["lever:nisaMonthly", ...extra]) {
      shown = shown.filter((x) => x !== k);
      if (Object.hasOwn(cur, k)) cur = remove(wh, cat, c, cur, k);
    }
    const after = shownOf(wh, cat, shown, cur);
    for (const k of ["lever:nisaMonthly", ...extra]) expect(after.has(k), k).toBe(false);
    // 既定の4つだけに戻る
    expect([...after]).toEqual(keysOfDefaults(wh, cat));
    // 計算も現状の月1万円。変えたことの一覧にも出ない
    expect(nisaOf(wh, cat, cur)).toBe(nisaNow);
    expect(changesOfValues(cur, wh, cat).map((r) => r.key)).not.toContain("lever:nisaMonthly");
    // 上書き保存しても、土台の月3万円に戻らない（前は値を消していたので、保存すると土台の値に戻って NISA が出直していた）
    const saved = overwritePlan(wh, cat, c, cur, NOW);
    const back = effectiveValues(saved, c);
    expect(shownOf(saved, cat, [], back).has("lever:nisaMonthly")).toBe(false);
    expect(nisaOf(saved, cat, back)).toBe(nisaNow);
    // 現状に戻した差分は、変えたことの一覧（保存したプラン）にも出さない
    expect(changesOf(saved.proposals, c, saved, cat).map((r) => r.key)).not.toContain("lever:nisaMonthly");
    // C を元にさらに作っても（プランとして保存・＋ このプランを元に作る）、月3万円は戻らない
    const d = savePlan(saved, cat, { name: "プランD", base: c, values: back, now: NOW });
    expect(nisaOf(d.wh, cat, effectiveValues(d.wh, d.id))).toBe(nisaNow);
  });

  it("現状から作ったプランで外すと、対策から消え、保存すると差分も残らない。保存する前に写して作ったプランにも元の値が戻らない", () => {
    const { wh, cat, b } = setup();
    // 保存していない間は、現状の値（月1万円）として持つ（保存した B は月3万円なので、消すと保存した値に戻ってしまう）
    const cur = remove(wh, cat, b, effectiveValues(wh, b), "lever:nisaMonthly");
    expect(cur["lever:nisaMonthly"]).toBe(10_000);
    expect(shownOf(wh, cat, [], cur).has("lever:nisaMonthly")).toBe(false);
    // 保存すると差分は残らない（現状と同じ値で土台も動かしていない）
    const saved = overwritePlan(wh, cat, b, cur, NOW);
    expect(Object.hasOwn(effectiveValues(saved, b), "lever:nisaMonthly")).toBe(false);
    // 保存する前の B（保存していない変更）を写して作ったプランも、B の保存した月3万円を受け継がない
    const d = savePlan(wh, cat, { name: "プランD", base: b, values: cur, now: NOW });
    expect(nisaOf(d.wh, cat, effectiveValues(d.wh, d.id))).toBe(10_000);
  });

  it("最初から出さない項目は、どれを外しても消える（足した項目・値が入っている項目のどちらも）", () => {
    const { wh, cat, c } = setup();
    const base = effectiveValues(wh, c);
    for (const it of cat.items) {
      if (leverView(cat, {}, [], {}).fixed.has(it.key)) continue;
      const moved = { ...base, [it.key]: base[it.key] ?? it.read(wh) };
      const cur = remove(wh, cat, c, moved, it.key);
      expect(shownOf(wh, cat, [], cur).has(it.key), it.key).toBe(false);
    }
  });
});

function keysOfDefaults(wh: WorkingHousehold, cat: Catalog): string[] {
  return [...visibleKeys(leverView(cat, {}, [], {}))];
}
