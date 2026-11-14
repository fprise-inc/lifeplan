// 資産と負債のタブ: 家計の体力の目安を表示するか（このタブの表示の設定。display.balance.health。既定は表示する。0027 の 2026-11-13 の追記）。
// 表示しないときは、図の下の区画も「目安の幅を変える」も出さず、表示の設定の目安の幅の欄を畳む（幅は覚えたまま）。世帯ファイルに保存する（形式 0.77）
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { h } from "preact";
import { renderToString } from "preact-render-to-string";
import { BalanceSettingsPanel, BalanceTab } from "../src/presentation/BalanceTab.tsx";
import type { BsGuide, BsPlanModel } from "../src/presentation/model.ts";
import { balanceTabModel, bsPlan, DEFAULT_BS_GUIDE, DEFAULT_BS_POINTS } from "../src/workspace/balanceTab.ts";
import { fromRequest } from "../src/workspace/input/household.ts";
import { DEFAULT_BALANCE_SETTINGS, DEFAULT_DISPLAY_SETTINGS } from "../src/workspace/settings.ts";
import { BODY_FORMAT_VERSION, bodyOf, EMPTY_CARRY, fromBody, readDisplay } from "../src/workspace/store/body.ts";
import { modelHousehold, preview } from "./helpers.ts";

const noop = () => undefined;
const FORMATS = join(import.meta.dirname, "..", "..", "crates", "household-store", "tests", "fixtures", "household-format");

function planOf(id: string): BsPlanModel {
  const req = modelHousehold(id);
  return bsPlan({ key: "A", letter: "A", name: "プランA", title: "現状", base: true, req, table: preview(req).table });
}

const p = planOf("dualAssetsTwoKids");
const modelOf = (health?: boolean, guide: BsGuide = DEFAULT_BS_GUIDE) =>
  balanceTabModel({ plans: [p], selected: "A", base: "A", ...(health !== undefined ? { health } : {}), guide, pointDefaults: DEFAULT_BS_POINTS, columns: null, prevChoices: [], prev: { status: "idle", model: null }, provisional: false, who: "ご本人" });
const tab = (health: boolean | undefined, extra: Record<string, unknown> = {}) => renderToString(h(BalanceTab, { model: modelOf(health), band: null, onPrev: noop, onGuide: noop, onHealth: noop, onColumns: noop, onPointDefaults: noop, ...extra }));

describe("家計の体力の目安を表示するか（既定）", () => {
  it("既定は表示する（今までと同じ画面）。設定の鍵は display.balance.health", () => {
    expect(DEFAULT_BALANCE_SETTINGS.health).toBe(true);
    expect(modelOf().health).toBe(true);
    const html = tab(undefined);
    expect(html).toContain('class="bs-health wide"');
    expect((html.match(/data-health="/g) ?? []).length).toBe(4);
    expect(html).toContain("data-bs-guide-open");
  });
});

describe("表示しないとき", () => {
  it("1年ずつ見る: 区画も「目安の幅を変える」も出さない。図・年のつまみ・表で見る・推移のグラフは今まで通り", () => {
    const html = tab(false);
    for (const gone of ["data-bs-health", "data-health=", "data-bs-guide-open", "家計の体力の目安"]) expect(html).not.toContain(gone);
    const at = (s: string) => html.indexOf(s);
    expect(at("data-bs-figure")).toBeGreaterThan(0);
    expect(at("data-bs-yearbar")).toBeGreaterThan(at("data-bs-figure"));
    expect(at("data-bs-table")).toBeGreaterThan(at("data-bs-yearbar"));
    expect(at("data-bs-trend")).toBeGreaterThan(at("data-bs-table"));
  });

  it("ほかの見せ方（時点を並べる・その先の年）にも体力の目安は出ない", () => {
    expect(tab(false, { initial: { view: "three" } })).not.toContain("data-bs-health");
    expect(tab(true, { initial: { view: "three" } })).not.toContain("data-bs-health");
    expect(tab(false, { initial: { view: "one", year: p.years[5]!.year } })).not.toContain("data-bs-health");
  });
});

describe("このタブの表示の設定", () => {
  const panel = (health: boolean, onHealth?: (on: boolean) => void) => renderToString(h(BalanceSettingsPanel, { model: modelOf(health), onGuide: noop, ...(onHealth !== undefined ? { onHealth } : {}), onPointDefaults: noop, onClose: noop }));
  const box = (html: string) => html.match(/<input type="checkbox"[^>]*data-bs-health-setting[^>]*>/)?.[0] ?? null;

  it("表示するとき: 「家計の体力の目安を表示する」にチェックが入り、目安の幅の欄も出す（目安の幅と同じ区画）", () => {
    const html = panel(true, noop);
    expect(html).toContain("家計の体力の目安を表示する");
    expect(box(html)).toMatch(/checked/);
    const at = (s: string) => html.indexOf(s);
    expect(at("data-bs-health-setting")).toBeGreaterThan(at("data-bs-guide-setting"));
    expect(at('data-guide="months0"')).toBeGreaterThan(at("data-bs-health-setting"));
  });

  it("表示しないとき: チェックを外した形で、目安の幅の欄は畳む（幅は覚えたまま）", () => {
    const html = panel(false, noop);
    expect(box(html)).not.toBeNull();
    expect(box(html)).not.toMatch(/checked/);
    expect(html).not.toContain("data-guide=");
    expect(html).toContain("目安の幅は覚えておきます");
  });

  it("切り替えの手続きを渡さないときは、切り替えを出さない（目安の幅の欄は今まで通り）", () => {
    const html = panel(true);
    expect(box(html)).toBeNull();
    expect(html).toContain('data-guide="months0"');
  });

  it("タブの「表示の設定」を開いたときも同じ所に出る", () => {
    const html = tab(false, { initial: { settings: true } });
    expect(html).toContain("data-bs-settings");
    expect(box(html)).not.toBeNull();
  });
});

describe("保存（世帯ファイルの display.balance.health。形式 0.77）", () => {
  const wh = fromRequest(modelHousehold("dualAssetsTwoKids"));
  const ws = { template: null, band: [], base: "current", selected: "current", shownItems: [] };
  const save = (health: boolean) => bodyOf({ wh, workspace: ws, display: { result: DEFAULT_DISPLAY_SETTINGS, balance: { ...DEFAULT_BALANCE_SETTINGS, health, guide: { months: [3, 9], risk: [5, 30], debt: 40 } } }, carry: EMPTY_CARRY });

  it("表示しないと選んだら、本文の display.balance.health に false と書き、読み戻すと false。目安の幅も残る", () => {
    expect(BODY_FORMAT_VERSION).toBe("0.77");
    const text = save(false);
    const obj = JSON.parse(text) as { display: { balance: Record<string, unknown> } };
    expect(obj.display.balance.health).toBe(false);
    const back = fromBody(text).display.balance;
    expect(back.health).toBe(false);
    expect(back.guide).toEqual({ months: [3, 9], risk: [5, 30], debt: 40 });
    expect((JSON.parse(save(true)) as { display: { balance: Record<string, unknown> } }).display.balance.health).toBe(true);
  });

  it("欄の無い前の版の世帯・形の合わない値は表示する", () => {
    expect(readDisplay({ balance: { guide: DEFAULT_BS_GUIDE } }).balance.health).toBe(true);
    expect(readDisplay({ balance: { health: "no" } }).balance.health).toBe(true);
    expect(readDisplay({ balance: { health: 0 } }).balance.health).toBe(true);
    expect(readDisplay({}).balance.health).toBe(true);
    // 区画の無い 0.7 までの形
    expect(readDisplay({ bsGuide: DEFAULT_BS_GUIDE }).balance.health).toBe(true);
  });

  it("見本: 0.76 の世帯は欄が無く表示する。0.77 の見本は表示しない", () => {
    const of = (v: string) => fromBody(readFileSync(join(FORMATS, v, "body.json"), "utf8")).display.balance;
    expect(of("0.76").health).toBe(true);
    expect(of("0.77").health).toBe(false);
    // 目安の幅は版で変わらない
    expect(of("0.77").guide).toEqual(of("0.76").guide);
  });
});
