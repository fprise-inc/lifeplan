// 毎月の積立額（今の額）: 積立が先の月から始まる世帯で今の額を上げると、今の月から積み立てる（先の期間も同じだけ増やす）
import { describe, expect, it } from "vitest";
import { demoHousehold } from "../src/workspace/catalog.ts";
import { fromRequest } from "../src/workspace/input/household.ts";
import { buildCatalog } from "../src/workspace/plans/items.ts";
import { applyValues } from "../src/workspace/plans/plans.ts";
import { addMonths } from "../src/workspace/levers.ts";
import { roles } from "../src/workspace/roles.ts";
import { modelHousehold } from "./helpers.ts";

describe("毎月の積立額（今の額）を上げる", () => {
  // advisoryFeeProposal: 本人の NISA のつみたて投資枠が 2027年1月から月5万円。今（計算基準の月）は積み立てていない
  const req = modelHousehold("advisoryFeeProposal");
  const self = roles(req).find((r) => r.key === "self")!.member;
  const wh = fromRequest(req, {});
  const cat = buildCatalog(wh, self.id, demoHousehold("advisoryFeeProposal") ?? null);
  const item = cat.byKey.get("inv:monthly")!;
  const base = wh.request.input.baseMonth;

  it("前提: 今の額は0、積立は先の月から", () => {
    expect(item.read(wh)).toBe(0);
    const nisa = wh.request.input.household.accounts!.find((a) => a.kind === "nisa")!;
    expect(nisa.contributions!.every((c) => (c.from.at ?? "") > base)).toBe(true);
  });

  it("0→2万円: 今の月から次の積立の前の月まで月2万円を足し、先の期間も2万円増やす。読み直すと今の額は2万円", () => {
    const next = applyValues(wh, { "inv:monthly": 20_000 }, cat);
    const nisa = next.input.household.accounts!.find((a) => a.kind === "nisa")!;
    const first = wh.request.input.household.accounts!.find((a) => a.kind === "nisa")!.contributions![0]!;
    expect(nisa.contributions).toContainEqual({ from: { at: base }, to: { at: addMonths(first.from.at!, -1) }, monthly: 20_000, tranche: first.tranche });
    expect(nisa.contributions!.find((c) => c.from.at === first.from.at)!.monthly).toBe(first.monthly + 20_000);
    expect(item.read({ ...wh, request: next })).toBe(20_000);
  });

  it("今の月にかかる積立がある世帯は今までどおり（期間を足さない）", () => {
    const r2 = modelHousehold("salariedCoupleTwoKids");
    const self2 = roles(r2).find((r) => r.key === "self")!.member;
    const w2 = fromRequest(r2, {});
    const c2 = buildCatalog(w2, self2.id, demoHousehold("salariedCoupleTwoKids")!);
    const it2 = c2.byKey.get("inv:monthly")!;
    const now = it2.read(w2) as number;
    const before = w2.request.input.household.accounts!.flatMap((a) => a.contributions ?? []).length;
    const next = applyValues(w2, { "inv:monthly": now + 20_000 }, c2);
    expect(next.input.household.accounts!.flatMap((a) => a.contributions ?? []).length).toBe(before);
    expect(it2.read({ ...w2, request: next })).toBe(now + 20_000);
  });
});
