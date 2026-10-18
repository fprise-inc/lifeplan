// グラフの図形に付けた名前（class）に、見た目の決まり（CSS）が必ずあること。
// 決まりがない path は塗りが既定の黒になり、線のはずが黒い塊に見える。
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { APP_DIR } from "../scripts/lib.ts";

const read = (p: string) => readFileSync(join(APP_DIR, p), "utf-8");
const css = ["src/styles/app.css", "src/styles/wire.css"].map(read).join("\n");
const files = ["src/presentation/MainChart.tsx", "src/presentation/StackChart.tsx"];

describe("グラフの見た目の決まり", () => {
  it.each(files)("%s の path・polyline の class はすべて CSS に決まりがある", (f) => {
    const src = read(f);
    const names = new Set<string>();
    for (const m of src.matchAll(/<(?:path|polyline)\b[^>]*?\bclass="([^"]+)"/g)) for (const c of (m[1] ?? "").split(/\s+/)) if (c !== "") names.add(c);
    const missing = [...names].filter((c) => !new RegExp(`\\.${c}(?![\\w-])`).test(css));
    expect(missing).toEqual([]);
  });
});
