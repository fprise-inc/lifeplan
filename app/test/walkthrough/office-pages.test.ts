// 事務所の既定値の7つの画面（0261）を、見えないブラウザで人と同じ操作で確かめる:
// 左の目次で行き来する・保存していない画面の印・どの画面で変えても1回の「保存」で全部入る（開き直して読む）・「キャンセル」で全部戻る（見た目の見本も）・
// 保存していない変更があるのに閉じるときの確かめ（設定を続ける・変更を捨てて閉じる・保存して閉じる）・狭い幅で目次が上の1行にたたまれる・
// 2か所で変えていた値（土地の割合）は推定の値の画面では読むだけで、前提条件の既定値の画面へ移る。
// 流すのは FINANCIA_WALKTHROUGH=1 のときだけ（browser.ts）
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { browserPath, start, type Session } from "./browser.ts";
import { WALKTHROUGH } from "./fieldEffect.ts";

const RUN = WALKTHROUGH && browserPath() !== null;

describe.runIf(RUN)("事務所の既定値の7つの画面", () => {
  let s: Session;
  /** パネルを開き直す（読み直した事務所の既定値で作る） */
  const reopen = async (page = "") => {
    await s.page.eval(`location.hash = ${JSON.stringify(page === "" ? "officedefaults" : `officedefaults=${page}`)}; location.reload(); return true`).catch(() => undefined);
    await s.page.until(`document.querySelector("[data-office-settings]")`, "事務所の既定値のパネルが出る", 60_000);
    await s.page.settle();
    // 初めの起動の復元キーの知らせ（開発用のサーバー）は閉じる
    if (await s.page.eval<boolean>(`return w.all("button").some((b) => w.txt(b) === "あとで保管する")`)) await s.page.click("あとで保管する");
  };
  const now = () => s.page.eval<string>(`return document.querySelector("[data-office-settings]")?.getAttribute("data-office-page-now") ?? ""`);
  const open = () => s.page.eval<boolean>(`return document.querySelector("[data-office-settings]") !== null`);
  const unsaved = () => s.page.eval<string[]>(`return [...document.querySelectorAll("[data-office-page-unsaved]")].map((b) => b.getAttribute("data-office-page-link"))`);
  const foot = () => s.page.eval<string>(`return w.txt(document.querySelector("[data-office-foot]"))`);
  const val = (sel: string) => s.page.eval<string>(`return document.querySelector(${JSON.stringify(sel)})?.value ?? ""`);
  const go = (name: string) => s.page.click(name, { within: "panel" });

  beforeAll(async () => {
    s = await start();
    await reopen();
  }, 240_000);
  afterAll(async () => {
    await s?.close();
  });

  it("初めて開くと「前提条件の既定値」。左の目次で7つの画面を行き来する", async () => {
    expect(await now()).toBe("premises");
    const pages: [string, string][] = [
      ["FP顧問料の料金表", "fee"],
      ["推定の値（統計・目安）", "estimates"],
      ["入力の画面", "input"],
      ["結果と万一の画面", "results"],
      ["事務所の見た目と機能", "look"],
      ["カスタム層", "custom"],
      ["前提条件の既定値", "premises"],
    ];
    for (const [name, id] of pages) {
      await go(name);
      expect(await now(), name).toBe(id);
      // 見えている画面は1つ
      expect(await s.page.eval<number>(`return [...document.querySelectorAll("[data-office-page]")].filter((e) => !e.hidden).length`)).toBe(1);
    }
    expect(await unsaved()).toEqual([]);
  });

  it("どの画面で変えても、目次に印が付き、1回の「保存」で全部入る（開き直すと残っている）", async () => {
    await s.page.type("物価上昇率", "2");
    expect(await unsaved()).toEqual(["premises"]);
    await go("FP顧問料の料金表");
    await s.page.type("単発の料金（相談料・プラン作成料）", "25");
    await go("入力の画面");
    await s.page.click("不確実", { within: "panel", exact: true });
    await go("推定の値（統計・目安）");
    await s.page.type("推定の値を探す", "1人の世帯の基本生活費");
    await s.page.click("変える", { within: "panel", row: "1人の世帯の基本生活費" });
    await s.page.type("事務所の値", "150000");
    await s.page.click("この値にする", { within: "panel" });
    await go("事務所の見た目と機能");
    await s.page.type("事務所の名前", "テスト事務所");
    // 見た目は保存の前から画面に映る（見本）
    expect(await s.page.eval<string>(`return w.txt(document.querySelector("header"))`)).toContain("テスト事務所");
    expect((await unsaved()).sort()).toEqual(["estimates", "fee", "input", "look", "premises"]);
    expect(await foot()).toContain("保存していない変更: 前提条件の既定値（1か所）・FP顧問料の料金表（1か所）・推定の値（統計・目安）（1か所）・入力の画面（1か所）・事務所の見た目と機能（1か所）");
    await s.page.click("保存", { within: "panel", exact: true });
    expect(await unsaved()).toEqual([]);
    expect(await foot()).toContain("保存しました");
    // 開き直す（アプリを読み直す）: どの画面の値も残っている。前回の画面は覚えていない（初めは前提条件の既定値）
    await reopen();
    expect(await now()).toBe("premises");
    expect(await val('[data-office-setting="inflation"]')).toBe("2");
    expect(await val("[data-office-fee-one]")).toBe("25");
    expect(await s.page.eval<string | null>(`return document.querySelector('[data-office-inherit="uncertain"]')?.getAttribute("aria-checked") ?? null`)).toBe("true");
    expect(await s.page.eval<boolean>(`return document.querySelector('[data-office-estimate-value="preset.living.single"]') !== null || w.txt(document.querySelector('[data-office-page-summary="estimates"]')).startsWith("事務所で変えた値 1件")`)).toBe(true);
    expect(await val("[data-branding-name]")).toBe("テスト事務所");
  });

  it("「キャンセル」で、どの画面で変えた所も全部戻る（見た目の見本も保存した見た目に戻る）", async () => {
    await s.page.type("物価上昇率", "3");
    await go("事務所の見た目と機能");
    await s.page.type("事務所の名前", "別の名前");
    expect(await s.page.eval<string>(`return w.txt(document.querySelector("header"))`)).toContain("別の名前");
    await s.page.click("キャンセル", { within: "panel", exact: true });
    expect(await open()).toBe(false);
    expect(await s.page.eval<string>(`return w.txt(document.querySelector("header"))`)).toContain("テスト事務所");
    await reopen();
    expect(await val('[data-office-setting="inflation"]')).toBe("2");
    expect(await val("[data-branding-name]")).toBe("テスト事務所");
  });

  it("保存していない変更があるのに閉じると、下の帯で確かめる（設定を続ける・変更を捨てて閉じる・保存して閉じる）", async () => {
    // 変えていなければ × ですぐ閉じる
    await s.page.click("事務所の既定値を閉じる（Esc）", { within: "panel" });
    expect(await open()).toBe(false);
    await reopen();
    await s.page.type("賃金上昇率", "1.5");
    await s.page.click("事務所の既定値を閉じる（Esc）", { within: "panel" });
    expect(await open()).toBe(true);
    expect(await foot()).toContain("保存していない変更があります（前提条件の既定値（1か所））。閉じると、この変更は消えます。");
    await s.page.click("設定を続ける", { within: "panel" });
    expect(await open()).toBe(true);
    expect(await val('[data-office-setting="wageGrowth"]')).toBe("1.5");
    // 背景を押しても同じ確かめ → 変更を捨てて閉じる
    await s.page.eval(`document.querySelector(".scrim").click(); return true`);
    await s.page.settle();
    expect(await foot()).toContain("閉じると、この変更は消えます");
    await s.page.click("変更を捨てて閉じる", { within: "panel" });
    expect(await open()).toBe(false);
    await reopen();
    expect(await val('[data-office-setting="wageGrowth"]')).toBe("");
    // Esc でも確かめ → 保存して閉じる
    await s.page.type("賃金上昇率", "1.5");
    await s.page.eval(`document.querySelector("[data-office-settings]").focus(); return true`);
    await s.page.escape();
    expect(await foot()).toContain("閉じると、この変更は消えます");
    await s.page.click("保存して閉じる", { within: "panel" });
    expect(await open()).toBe(false);
    await reopen();
    expect(await val('[data-office-setting="wageGrowth"]')).toBe("1.5");
  });

  it("土地の割合は推定の値の画面では読むだけ。「前提条件の既定値で変える」でその欄へ移る", async () => {
    await go("推定の値（統計・目安）");
    await s.page.type("推定の値を探す", "土地の割合");
    expect(await s.page.eval<boolean>(`return document.querySelector('[data-office-estimate-edit="preset.realEstate.landShare"]') !== null`)).toBe(false);
    await s.page.click("前提条件の既定値で変える", { within: "panel", row: "持ち家・不動産の評価: 土地の割合" });
    expect(await now()).toBe("premises");
    expect(await s.page.eval<string>(`return document.activeElement?.getAttribute("data-office-setting") ?? ""`)).toBe("realEstateValuation.landShare");
  });

  it("狭い幅では、左の目次が上の1行（選ぶ欄）にたたまれ、そこで画面を選べる", async () => {
    await s.page.viewport(720, 900);
    try {
      expect(await s.page.eval<string>(`return getComputedStyle(document.querySelector("[data-office-toc]")).display`)).toBe("none");
      expect(await s.page.eval<string>(`return getComputedStyle(document.querySelector("[data-office-toc-row]")).display`)).toBe("flex");
      // 選ぶ欄で選ぶ（選択肢の一覧はブラウザの外に出るので、値を選んで変更の出来事を送る）
      await s.page.eval(`const el = document.querySelector("[data-office-page-pick]"); el.value = "fee"; el.dispatchEvent(new Event("change", { bubbles: true })); return true`);
      await s.page.settle();
      expect(await now()).toBe("fee");
      // 狭い幅でもパネルが横にはみ出さない
      expect(await s.page.eval<boolean>(`const r = document.querySelector("[data-office-settings]").getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth`)).toBe(true);
    } finally {
      await s.page.viewport(1440, 1000);
    }
    expect(await s.page.eval<string>(`return getComputedStyle(document.querySelector("[data-office-toc]")).display`)).not.toBe("none");
  });
});
