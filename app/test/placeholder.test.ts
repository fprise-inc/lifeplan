// 欄の灰色の入力例（placeholder）が欄の幅に収まること（0077）: 見本の世帯と空の世帯で、どのカードのパネルも標準・詳細で描き、
// 入力例のある欄をすべて集めて、欄の種類ごとの幅の目安（placeholder.ts）と比較する。収まらない例は短くするか「?」の中へ
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { h } from "preact";
import { renderToString } from "preact-render-to-string";
import { blankHousehold, fromRequest, type WorkingHousehold } from "../src/workspace/input/household.ts";
import { InputPanel } from "../src/workspace/input/InputPanel.tsx";
import { STAGE_ORDER } from "../src/workspace/input/stages/index.ts";
import { fittingPlaceholder, fitsIn, roomOf, textEm } from "../src/workspace/input/placeholder.ts";
import { REPO_DIR } from "../scripts/lib.ts";
import { modelHousehold } from "./helpers.ts";

const noop = () => undefined;
const MODELS = readdirSync(join(REPO_DIR, "data", "modelHouseholds"))
  .filter((f) => f.endsWith(".json"))
  .map((f) => f.slice(0, -5));

/** パネルの中の、入力例のある欄（class と入力例） */
function placeholders(wh: WorkingHousehold, card: string, level: "simple" | "detail"): { cls: string; text: string }[] {
  const html = renderToString(h(InputPanel, { wh, itemId: card, level, onLevel: noop, onSave: noop, onClose: noop }));
  const out: { cls: string; text: string }[] = [];
  for (const m of html.matchAll(/<input\b([^>]*)>/g)) {
    const attrs = m[1] ?? "";
    const text = /placeholder="([^"]*)"/.exec(attrs)?.[1];
    if (text === undefined || text === "") continue;
    out.push({ cls: /class="([^"]*)"/.exec(attrs)?.[1] ?? "", text: text.replace(/&amp;/g, "&").replace(/&quot;/g, '"') });
  }
  return out;
}

describe("幅の目安", () => {
  it("全角は1字 1em・半角は 0.65em", () => {
    expect(textEm("未入力")).toBe(3);
    expect(textEm("例: 60歳")).toBeCloseTo(1 + 0.65 + 0.3 + 0.65 * 2 + 1);
    // 前の「未入力（0円で計算中）」は数の欄（8.3em）に収まらなかった
    expect(fitsIn("num", "未入力（0円で計算中）")).toBe(false);
  });
  it("欄の種類ごとの幅（数の欄・時点の欄・年月・文字・貯蓄の表）", () => {
    expect(roomOf("num")).toBe(8.3);
    expect(roomOf("num bad")).toBe(8.3);
    expect(roomOf("when-in")).toBe(9.3);
    expect(roomOf("sv-n s est")).toBe(3.4);
    expect(roomOf("unknown")).toBeNull();
  });
  it("収まる最初の候補を選ぶ（空欄＝の例が長ければ、入れ方の例）", () => {
    expect(fittingPlaceholder("when-in", "空欄＝最後まで", "例: 60歳")).toBe("空欄＝最後まで");
    expect(fittingPlaceholder("when-in", "空欄＝受け取らない（残高のまま持つ）", "例: 60歳")).toBe("例: 60歳");
    expect(fittingPlaceholder("num", "とても長い説明の文で欄に入らない")).toBe("");
  });
});

describe("どのカードのパネルの入力例も、欄の幅に収まる", () => {
  const households: [string, WorkingHousehold][] = [["空の世帯", blankHousehold("2026-10")], ...MODELS.map((m) => [m, fromRequest(modelHousehold(m), {})] as [string, WorkingHousehold])];
  it.each(households)("%s", (_name, wh) => {
    const over: string[] = [];
    let seen = 0;
    for (const s of STAGE_ORDER)
      for (const level of ["simple", "detail"] as const)
        for (const p of placeholders(wh, s.id, level)) {
          seen++;
          if (!fitsIn(p.cls, p.text)) over.push(`${s.label}（${level}）: [${p.cls}] ${p.text}（${textEm(p.text).toFixed(1)}em > ${String(roomOf(p.cls))}em）`);
        }
    expect(seen).toBeGreaterThan(0);
    expect(over).toEqual([]);
  });
});
