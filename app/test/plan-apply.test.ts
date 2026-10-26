// プランの差分の当て方（0036 の4・6・7）: 当て先で当てた値が、0.16 の欄の書き方で当てた値と同じであること
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { REPO_DIR } from "../scripts/lib.ts";
import { fromRequest } from "../src/workspace/input/household.ts";
import { writeAt } from "../src/workspace/plans/diffs.ts";
import { buildCatalog, type ItemValue } from "../src/workspace/plans/items.ts";
import { roles } from "../src/workspace/roles.ts";
import { resolveKey } from "../src/workspace/store/readings.ts";
import { modelHousehold } from "./helpers.ts";

const ids = readdirSync(join(REPO_DIR, "data", "modelHouseholds")).filter((f) => f.endsWith(".json")).map((f) => f.replace(/\.json$/, ""));

/** 数の値を少し動かした値（同じ型のまま） */
function nudge(v: ItemValue): ItemValue | undefined {
  if (typeof v === "number") return v === 0 ? 1 : v + (Number.isInteger(v) ? (Math.abs(v) >= 1000 ? 10000 : 1) : 0.5);
  if (typeof v === "string" && /^-?\d+(\.\d+)?$/.test(v)) return String(Number(v) + 0.001);
  if (typeof v === "boolean") return !v;
  return undefined;
}

describe("当て先で書いた値が、0.16 の欄の書き方と同じ", () => {
  it.each(ids)("%s", (id) => {
    const req = modelHousehold(id);
    const self = roles(req).find((r) => r.key === "self");
    if (self === undefined) return;
    const wh = fromRequest(req);
    const cat = buildCatalog(wh, self.member.id, null);
    const bad: string[] = [];
    for (const it of cat.items) {
      if (it.phase !== "field") continue;
      const r = resolveKey(it.key, wh.request.input as unknown as Record<string, unknown>);
      if (r === null || r.kind !== "address") continue;
      const v = nudge(it.read(wh));
      if (v === undefined) continue;
      const want = it.apply(wh, v).request;
      const input = structuredClone(wh.request.input) as unknown as Record<string, unknown>;
      const ok = writeAt(input, r.address, { value: v, state: "confirmed", origin: { kind: "manual" } });
      if (!ok || JSON.stringify(input) !== JSON.stringify(want.input)) bad.push(it.key);
    }
    expect(bad).toEqual([]);
  });
});
