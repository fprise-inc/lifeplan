// 同じ当て先の欄を動かす項目は、動かす項目の一覧に1つだけ出す（保存したプランの値が、動かした項目に出る。計算に入る値と見えている値がそろう）
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { demoHousehold } from "../src/workspace/catalog.ts";
import { fromRequest } from "../src/workspace/input/household.ts";
import { buildCatalog } from "../src/workspace/plans/items.ts";
import { applyValues, effectiveValues, normalizeValues, savePlan, valueOf } from "../src/workspace/plans/plans.ts";
import { resolveKey } from "../src/workspace/store/readings.ts";
import { roles } from "../src/workspace/roles.ts";
import { REPO_DIR } from "../scripts/lib.ts";
import { modelHousehold } from "./helpers.ts";

const NOW = "2026-10-22T10:00:00.000Z";
const IDS = readdirSync(join(REPO_DIR, "data", "modelHouseholds")).filter((f) => f.endsWith(".json")).map((f) => f.slice(0, -5));

function open(id: string) {
  const req = modelHousehold(id);
  const self = roles(req).find((r) => r.key === "self")!.member;
  const wh = fromRequest(req, {});
  return { wh, cat: buildCatalog(wh, self.id, demoHousehold(id) ?? null) };
}

describe("同じ当て先の欄を動かす項目", () => {
  it("見本の世帯のどれでも、当て先の欄の項目は当て先ごとに1つ", () => {
    for (const id of IDS) {
      const { wh, cat } = open(id);
      const input = wh.request.input as unknown as Record<string, unknown>;
      const seen = new Map<string, string>();
      for (const it of cat.items) {
        if (!it.key.startsWith("field:")) continue;
        const r = resolveKey(it.key, input);
        if (r === null || r.kind !== "address") continue;
        const place = JSON.stringify([r.address.target, r.address.item, r.address.at]);
        expect(seen.get(place), `${id}: ${it.key}`).toBeUndefined();
        seen.set(place, it.key);
      }
    }
  });

  it("どの項目を動かして保存しても、その項目に保存した値が出て、もう一度動かした値が計算に入る（役員・自営業の今の働き方の年収）", () => {
    for (const id of ["executiveOwner", "selfEmployed"]) {
      const { wh, cat } = open(id);
      const items = cat.items.filter((i) => /^field:work\/.*\/(annual|business)$/.test(i.key));
      expect(items.length).toBeGreaterThan(0);
      for (const it of items) {
        const cur = it.read(wh) as number;
        const b = savePlan(wh, cat, { name: "プランB", base: null, values: { [it.key]: cur + 1_000_000 }, now: NOW });
        const saved = effectiveValues(b.wh, b.id);
        expect(valueOf(it, saved, b.wh), `${id}: ${it.key}`).toBe(cur + 1_000_000);
        const draft = normalizeValues({ ...saved, [it.key]: cur + 2_000_000 }, saved, b.wh, cat);
        expect(it.read({ ...b.wh, request: applyValues(b.wh, draft, cat) }), `${id}: ${it.key}`).toBe(cur + 2_000_000);
      }
    }
  });
});
