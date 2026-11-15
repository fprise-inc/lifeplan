// ポイント「退職から年金までの空白」の退職の年齢は、対策の「働く最後の年齢」と同じ読み方（仕事を終えた月の翌月の満年齢。0074 の追記 2026-11-14）。
// 誕生月より前の月に仕事を終える人も、「その年 − 生まれた年」の1歳多い年齢にしない
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { forEngine } from "../src/engine/moneyRows.ts";
import { readLevers } from "../src/workspace/levers.ts";
import { insights } from "../src/workspace/tools/fpTools.ts";
import { REPO_DIR } from "../scripts/lib.ts";
import { modelHousehold, preview } from "./helpers.ts";

describe("ポイントの退職の年齢", () => {
  it("誕生月（12月）より前の3月で仕事を終える人: 対策もポイントも61歳", () => {
    const req = forEngine(modelHousehold("executiveOwner"));
    const spouse = req.input.household.members.find((m) => m.kind === "spouse")!;
    expect(spouse.birth.birthYearMonth).toBe("1965-12");
    expect(readLevers(req, spouse.id).retireAge).toBe(61);
    const text = insights(req, preview(req)).find((i) => i.key === `retireGap:${spouse.id}`)!.text;
    expect(text).toContain("配偶者が61歳で退職してから");
  });

  it("見本の世帯のどれでも、ポイントの退職の年齢は対策の「働く最後の年齢」と同じ", () => {
    const names = readdirSync(join(REPO_DIR, "data", "modelHouseholds")).filter((f) => f.endsWith(".json")).map((f) => f.slice(0, -5));
    let seen = 0;
    for (const n of names) {
      const req = forEngine(modelHousehold(n));
      for (const i of insights(req, preview(req))) {
        if (!i.key.startsWith("retireGap:")) continue;
        const lever = readLevers(req, i.key.slice("retireGap:".length)).retireAge;
        expect(i.text, n).toContain(`${String(lever)}歳で退職`);
        seen++;
      }
    }
    expect(seen).toBeGreaterThan(2);
  });
});
