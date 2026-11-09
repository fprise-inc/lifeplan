// 対策「FP顧問料」と契約ごとの「現状にも入れる」（0177）: 「現状にも入れる」の契約と提案の側だけの契約が両方あると、対策の今の値は
// 「今の契約だけ」（null）。「入れる」はすべての契約、「入れない」はどの契約も入れない。どちらもプランの差分になる
import { h } from "preact";
import { renderToString } from "preact-render-to-string";
import { describe, expect, it } from "vitest";
import type { EngineRequest } from "../src/engine/types.ts";
import { demoHousehold } from "../src/workspace/catalog.ts";
import { fromRequest, mutate, type WorkingHousehold } from "../src/workspace/input/household.ts";
import { addAdvisoryFee } from "../src/workspace/input/stages/fees.ts";
import { LeverCard } from "../src/workspace/LeverPanel.tsx";
import { advisoryFeeState } from "../src/workspace/levers.ts";
import { buildCatalog, type Catalog } from "../src/workspace/plans/items.ts";
import { applyPlan, applyValues, effectiveValues, normalizeValues, savePlan } from "../src/workspace/plans/plans.ts";
import { roles } from "../src/workspace/roles.ts";
import { modelHousehold } from "./helpers.ts";

const ID = "salariedCoupleTwoKids";
const NOW = "2026-11-08T00:00:00Z";
const noop = () => undefined;

/** 契約1（今の顧問契約。現状にも入れる）と契約2（提案の側だけ） */
function setup(): { wh: WorkingHousehold; cat: Catalog; c1: string; c2: string } {
  const req = modelHousehold(ID);
  const self = roles(req).find((r) => r.key === "self")!.member;
  let n = 0;
  const ids = () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`;
  let wh = fromRequest(req, {});
  wh = addAdvisoryFee(wh, ids);
  wh = addAdvisoryFee(wh, ids);
  wh = mutate(wh, (hh) => void (hh.advisoryFees![0]!.enabled = true));
  const [c1, c2] = wh.request.input.household.advisoryFees!.map((c) => c.id) as [string, string];
  return { wh, cat: buildCatalog(wh, self.id, demoHousehold(ID) ?? null), c1, c2 };
}
const enabledIn = (r: EngineRequest) => (r.input.household.advisoryFees ?? []).filter((c) => c.enabled !== false).map((c) => c.id);

describe("「現状にも入れる」の契約と提案の側だけの契約があるとき", () => {
  it("対策の今の値は「今の契約だけ」（入れる・入れないのどちらでもない）", () => {
    const { wh, cat } = setup();
    expect(advisoryFeeState(wh.request)).toBeNull();
    expect(cat.byKey.get("lever:fee")!.read(wh)).toBeNull();
    expect(cat.byKey.get("lever:fee")!.text(null)).toBe("今の契約だけ");
  });
  it("「入れる」にしたプランには、提案の側だけの契約も入る（保存して開いても）", () => {
    const { wh, cat, c1, c2 } = setup();
    const values = normalizeValues({ "lever:fee": true }, {}, wh, cat);
    expect(values).toEqual({ "lever:fee": true });
    expect(enabledIn(applyValues(wh, values, cat))).toEqual([c1, c2]);
    const b = savePlan(wh, cat, { name: "B", base: null, values, now: NOW });
    expect(enabledIn(applyPlan(b.wh, b.id, cat).request)).toEqual([c1, c2]);
    expect(effectiveValues(b.wh, b.id)).toEqual({ "lever:fee": true });
  });
  it("「入れない」にしたプランには、どの契約も入らない", () => {
    const { wh, cat } = setup();
    const b = savePlan(wh, cat, { name: "B", base: null, values: { "lever:fee": false }, now: NOW });
    expect(enabledIn(applyPlan(b.wh, b.id, cat).request)).toEqual([]);
  });
  it("「今の契約だけ」に戻すと、現状と同じ（差分にならない）。土台が「入れる」なら、今の契約だけに戻す差分になる", () => {
    const { wh, cat, c1 } = setup();
    expect(normalizeValues({ "lever:fee": null }, {}, wh, cat)).toEqual({});
    const b = savePlan(wh, cat, { name: "B", base: null, values: { "lever:fee": true }, now: NOW });
    const c = savePlan(b.wh, cat, { name: "C", base: b.id, values: { "lever:fee": null }, now: NOW });
    expect(enabledIn(applyPlan(c.wh, c.id, cat).request)).toEqual([c1]);
  });
  it("対策の行に「今の契約だけ」の選び方を出す（契約が全部同じ側なら出さない）", () => {
    const card = (fee: { on: boolean | null; inBase: boolean | null; mixed?: boolean }) =>
      renderToString(h(LeverCard, { selected: "プランB", baseLetter: "A", locked: false, modified: false, levers: [], fee: { ...fee, note: "単発30万円", onSet: noop }, onSlide: noop, onRelease: noop, onReset: noop, onOverwrite: noop, onSaveNew: noop, suggested: "", changes: [], onAck: null, onDrop: null, initialSave: true } as never));
    const mixed = card({ on: null, inBase: null, mixed: true });
    expect(mixed).toContain('data-fee-toggle="current"');
    expect(mixed).toMatch(/aria-pressed="true"[^>]*data-fee-toggle="current"/);
    expect(mixed).toContain("今の契約だけ");
    expect(card({ on: true, inBase: false })).not.toContain('data-fee-toggle="current"');
  });
});

describe("契約が全部同じ側のときは今までどおり", () => {
  it("どれも現状に入れていなければ「入れない」、全部入れていれば「入れる」", () => {
    const { wh } = setup();
    const none = mutate(wh, (hh) => void (hh.advisoryFees![0]!.enabled = false));
    expect(advisoryFeeState(none.request)).toBe(false);
    const all = mutate(wh, (hh) => void delete hh.advisoryFees![1]!.enabled);
    expect(advisoryFeeState(all.request)).toBe(true);
  });
});
