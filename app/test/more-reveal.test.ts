// 「▸ 続きを見る」を押したときに何が変わったか分かるように（0078 の 2026-10-29 の追記）: 開いて新しく出た欄を少しの間だけ光らせ（動きを減らす設定では光らせない）、
// 欄が入れ替わる所（年金の受け取り開始）は短い1行で知らせる（閉じると元に戻ることも）
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { h } from "preact";
import { renderToString } from "preact-render-to-string";
import { openedParts } from "../src/presentation/revealAdded.ts";
import { headsWithMore, swapNotesOf, type GroupOpenState } from "../src/workspace/input/FieldViews.tsx";
import { allFields, type ActionDef, type GroupDef, type StageId } from "../src/workspace/input/form.ts";
import { fromRequest, type WorkingHousehold } from "../src/workspace/input/household.ts";
import { InputPanel } from "../src/workspace/input/InputPanel.tsx";
import { buildStage } from "../src/workspace/input/stages/index.ts";
import { addAbroad } from "../src/workspace/input/stages/education.ts";
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
const groupsOf = (w: WorkingHousehold, stage: StageId): GroupDef[] => buildStage(stage, w).sections.flatMap((s) => s.groups);
const headsOf = (w: WorkingHousehold, stage: StageId): Set<string> => new Set(buildStage(stage, w).sections.flatMap((s) => [...headsWithMore(s.groups)]));
const actionsOf = (w: WorkingHousehold, stage: StageId): ActionDef[] => buildStage(stage, w).sections.flatMap((s) => [...s.actions, ...s.groups.flatMap((g) => g.actions)]);
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

  it("車: 開くと「買い替えに、「○歳まで買い替える」を足して出しています（閉じると元に戻ります）」。「○歳まで」を選んでいる車は、標準でも3つとも出すので知らせない", () => {
    const cw = open("dualAssetsTwoKids");
    const carHead = groupsOf(cw, "car").find((g) => g.fields.some((f) => f.simpleOnly === true && f.key.endsWith("/replace")));
    expect(carHead).toBeDefined();
    const key = carHead!.key;
    expect(headsOf(cw, "car").has(key)).toBe(true);
    expect(swapNotesOf(carHead!, true)).toEqual(["買い替えに、「○歳まで買い替える」を足して出しています"]);
    expect(swapNotesOf(carHead!, false)).toEqual([]);
    const opened = panel(cw, "car", "simple", [key]);
    expect(opened).toContain(`<p class="grp-more-swap" data-more-of="${key}" data-more-swap="true">買い替えに、「○歳まで買い替える」を足して出しています（閉じると元に戻ります）</p>`);
    expect(panel(cw, "car", "simple")).not.toContain("data-more-swap");
    expect(panel(cw, "car", "detail")).not.toContain("data-more-swap");
    // 「○歳まで買い替える」にした車
    const until = allFields(buildStage("car", cw)).find((f) => f.key === `${key}/replace`)!.set(cw, "until");
    const untilHead = groupsOf(until, "car").find((g) => g.key === key)!;
    expect(swapNotesOf(untilHead, true)).toEqual([]);
  });

  it("入れ替えの無い「▸ 続きを見る」（住宅ローンなど）は知らせを出さない", () => {
    const loan = wh.request.input.household.debts?.find((d) => d.kind === "mortgage");
    expect(panel(wh, "housing", "simple", [`housing/debt/${loan?.id ?? ""}`])).not.toContain("data-more-swap");
  });
});

describe("開いても中身が少ない所は「▸ 続きを見る」を付けず、標準で最初から出す", () => {
  /** そのまとまりに「▸ 続きを見る」が付かず、欄・ボタンがどれも標準 */
  const allShown = (w: WorkingHousehold, stage: StageId, g: GroupDef | undefined) => {
    expect(g).toBeDefined();
    expect(headsOf(w, stage).has(g!.key), g!.key).toBe(false);
    expect(g!.fields.every((f) => f.level === "simple"), g!.key).toBe(true);
    expect(g!.actions.every((a) => a.level === "simple"), g!.key).toBe(true);
  };

  it("国民年金の免除・猶予（これまで）: 「免除・猶予の内訳を外す」を最初から出す", () => {
    const add = actionsOf(wh, "pension").find((a) => a.key.endsWith("/c1/add"))!;
    const w = add.run(wh);
    const g = groupsOf(w, "pension").find((x) => x.actions.some((a) => a.key.endsWith("/c1/remove")));
    allShown(w, "pension", g);
  });

  it("毎年の黒字のうち貯金に回る割合: 「貯金に回る額の上限（年）」を最初から出す", () => {
    const w = open("surplusSaving");
    const g = groupsOf(w, "living").find((x) => x.key === "living/surplus/fields");
    allShown(w, "living", g);
    expect(g!.fields.some((f) => f.key === "living/surplus/cap")).toBe(true);
  });

  it("子の学校外の費用の入れ方（塾・習い事の行）: 「学校外の費用の入れ方」を最初から出す", () => {
    const goal = wh.request.input.household.goals!.find((g) => g.kind === "education")!;
    const w = allFields(buildStage("education", wh)).find((f) => f.key === `edu/${goal.id}/outMode`)!.set(wh, "rows");
    allShown(w, "education", groupsOf(w, "education").find((x) => x.key === `edu/${goal.id}/out`));
  });

  it("子の留学: 「万一のときの扱い」を最初から出す", () => {
    const goal = wh.request.input.household.goals!.find((g) => g.kind === "education")!;
    const w = addAbroad(wh, goal.id);
    allShown(w, "education", groupsOf(w, "education").find((x) => x.key.startsWith(`edu/${goal.id}/abroad/`)));
  });

  it("住まい（家賃なし）: 住み始め・住み終わりと「この家を相続する」を最初から出す", () => {
    const r = wh.request.input.household.residences![0]!;
    const w = allFields(buildStage("housing", wh)).find((f) => f.key === `housing/res/${r.id}/kind`)!.set(wh, "free");
    const g = groupsOf(w, "housing").find((x) => x.key === `housing/res/${r.id}`);
    allShown(w, "housing", g);
    expect(g!.fields.map((f) => f.label)).toEqual(expect.arrayContaining(["住み始め", "住み終わり"]));
    if ((w.request.input.household.residences ?? []).find((x) => x.id === r.id)?.to === null) expect(g!.actions.some((a) => a.label === "この家を相続する")).toBe(true);
    expect(panel(w, "housing", "simple")).toContain("この家を相続する");
  });

  it("金融資産のその他の資産・貸していない不動産など: 「評価額の時点」を最初から出す", () => {
    const w = open("dualAssetsTwoKids");
    const ids = (w.request.input.household.accounts ?? []).filter((a) => a.kind === "otherAsset" || (a.kind === "realEstate" && a.property === undefined)).map((a) => a.id);
    expect(ids.length).toBeGreaterThan(0);
    for (const id of ids) allShown(w, "savings", groupsOf(w, "savings").find((x) => x.key === `sav/${id}`));
  });

  it("FP顧問料（単発）: 「払う年月」を最初から出す", () => {
    const w = open("advisoryFeeProposal");
    const c = w.request.input.household.advisoryFees![0]!;
    allShown(w, "fee", groupsOf(w, "fee").find((x) => x.key === `ev/fee/${c.id}`));
  });
});
