// 「▸ 続きを見る」を押したときに何が変わったか分かるように（0078 の 2026-10-29 の追記）: 開いて新しく出た欄を少しの間だけ光らせ（動きを減らす設定では光らせない）、
// 欄が入れ替わる所（年金の受け取り開始）は短い1行で知らせる（閉じると元に戻ることも）
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { h } from "preact";
import { renderToString } from "preact-render-to-string";
import { openedParts } from "../src/presentation/revealAdded.ts";
import { swapNotesOf, type GroupOpenState } from "../src/workspace/input/FieldViews.tsx";
import { fromRequest, type WorkingHousehold } from "../src/workspace/input/household.ts";
import { InputPanel } from "../src/workspace/input/InputPanel.tsx";
import { buildStage } from "../src/workspace/input/stages/index.ts";
import { APP_DIR } from "../scripts/lib.ts";
import { modelHousehold } from "./helpers.ts";

const noop = () => undefined;
const src = (p: string) => readFileSync(join(APP_DIR, "src", p), "utf8");
const open = (m: string): WorkingHousehold => fromRequest(modelHousehold(m), {});
const panel = (wh: WorkingHousehold, card: string, level: "simple" | "detail", keys: readonly string[] = []) => {
  const groupOpen: GroupOpenState = { isOpen: (k) => keys.includes(k), toggle: noop };
  return renderToString(h(InputPanel, { wh, itemId: card, level, onLevel: noop, onSave: noop, onClose: noop, groupOpen }));
};

const wh = open("salariedCoupleTwoKids");
const pensionHead = buildStage("pension", wh)
  .sections.flatMap((s) => s.groups)
  .find((g) => g.fields.some((f) => f.simpleOnly === true && f.key.endsWith("/claim")));

describe("開いた中身を光らせる", () => {
  it("どの「▸ 続きを見る」も同じ部品（MoreToggle）で、開くときに revealOpened を呼ぶ（入力の区画のまとまり・貯蓄・運用の口座）", () => {
    const fv = src("workspace/input/FieldViews.tsx");
    expect(fv).toContain("if (!open) revealOpened(e.currentTarget, groupKey);");
    expect(fv.match(/<MoreToggle /g)?.length).toBe(1);
    expect(src("workspace/input/savings/SavingsPanel.tsx").match(/<MoreToggle /g)?.length).toBe(1);
    // 「▸ 続きを見る」の文字を書いているのは MoreToggle だけ
    expect(fv.match(/"▸ 続きを見る"/g)?.length).toBe(1);
    expect(src("workspace/input/savings/SavingsPanel.tsx")).not.toContain('"▸ 続きを見る"');
  });

  it("光らせるのは開いた中身（data-more-of）で、動きを減らす設定では光らせない", () => {
    const ra = src("presentation/revealAdded.ts");
    expect(ra).toContain("if (!reducedMotion()) glow(openedParts(els));");
  });

  it("入れ子の中身は外側だけを光らせる（二重に光らせない）", () => {
    type N = { name: string; kids: N[]; contains: (o: N) => boolean };
    const node = (name: string, kids: N[] = []): N => {
      const n: N = { name, kids, contains: (o) => n.kids.includes(o) || n.kids.some((k) => k.contains(o)) };
      return n;
    };
    const inner = node("中の変化");
    const body = node("開いた欄", [inner]);
    const member = node("課税の扱い");
    expect(openedParts([body, inner, member]).map((x) => x.name)).toEqual(["開いた欄", "課税の扱い"]);
  });

  it("開いた中身にはどれも data-more-of が付く（光らせる物を探せる）", () => {
    const key = pensionHead!.key;
    const html = panel(wh, "pension", "simple", [key]);
    expect(html).toContain(`<div class="grp-more-body" data-more-of="${key}">`);
  });
});

describe("欄が入れ替わる所は1行で知らせる", () => {
  it("年金: 開くと「受け取り開始を、基礎と厚生に分けて出しています（閉じると元に戻ります）」。閉じている間と詳細では出さない", () => {
    expect(pensionHead).toBeDefined();
    const key = pensionHead!.key;
    expect(swapNotesOf(pensionHead!, true)).toEqual(["受け取り開始を、基礎と厚生に分けて出しています"]);
    expect(swapNotesOf(pensionHead!, false)).toEqual([]);
    const opened = panel(wh, "pension", "simple", [key]);
    expect(opened).toContain(`<p class="grp-more-swap" data-more-of="${key}" data-more-swap="true">受け取り開始を、基礎と厚生に分けて出しています（閉じると元に戻ります）</p>`);
    // 知らせは開いた中身（老齢基礎年金・老齢厚生年金の欄）の前
    expect(opened.indexOf("data-more-swap")).toBeLessThan(opened.indexOf(`<div class="grp-more-body" data-more-of="${key}">`));
    expect(panel(wh, "pension", "simple")).not.toContain("data-more-swap");
    expect(panel(wh, "pension", "detail")).not.toContain("data-more-swap");
  });

  it("入れ替えの無い「▸ 続きを見る」（住宅ローンなど）は知らせを出さない", () => {
    const loan = wh.request.input.household.debts?.find((d) => d.kind === "mortgage");
    expect(panel(wh, "housing", "simple", [`housing/debt/${loan?.id ?? ""}`])).not.toContain("data-more-swap");
  });
});
