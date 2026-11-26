// 事務所の既定値のパネルの文字の欄: 1文字ずつ続けて打っても、同じ欄に選択（フォーカス）が残って続けて打てるか。
// 事務所の名前は打つたびに左上の見本を描き直すので、描き直しでパネルへ選択が移ると続けて打てなくなる。日本語の変換中も切れないこと。
// 流すのは FINANCIA_WALKTHROUGH=1 のときだけ（見えないブラウザを使う。browser.ts）
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { browserPath, start, type Session } from "./browser.ts";
import { WALKTHROUGH } from "./fieldEffect.ts";

const RUN = WALKTHROUGH && browserPath() !== null;

describe.runIf(RUN)("事務所の既定値の文字の欄を続けて打つ", () => {
  let s: Session;
  beforeAll(async () => {
    s = await start();
    // 事務所の名前の欄は「事務所の見た目と機能」の画面（0261）
    await s.page.eval(`location.hash = "officedefaults=look"; location.reload(); return true`).catch(() => undefined);
    await s.page.until(`document.querySelector("[data-office-settings] [data-branding-name]")`, "事務所の既定値のパネルが出る", 60_000);
    await s.page.settle();
  }, 240_000);
  afterAll(async () => {
    await s?.close();
  });

  /** 欄に選択を移して、中を空にする */
  const focus = (sel: string) => s.page.eval<boolean>(`const el = document.querySelector(${JSON.stringify(sel)}); el.focus(); el.select?.(); return document.activeElement === el`);
  /** いま選択のある欄が sel の欄か・欄の文字 */
  const state = (sel: string) => s.page.eval<{ same: boolean; value: string }>(`const el = document.querySelector(${JSON.stringify(sel)}); return { same: document.activeElement === el, value: el?.value ?? "" }`);
  const wait = () => new Promise((r) => setTimeout(r, 120));

  it("事務所の名前: 1文字ずつ打っても同じ欄に選択が残り、打った文字が全部入る", async () => {
    const sel = "[data-office-settings] [data-branding-name]";
    expect(await focus(sel)).toBe(true);
    for (const c of "FP事務所ABC") {
      await s.page.insert(c);
      await wait();
      expect((await state(sel)).same).toBe(true);
    }
    expect((await state(sel)).value).toBe("FP事務所ABC");
  });

  it("事務所の名前: 日本語の変換中に描き直しがあっても変換が切れず、確定した文字が入る", async () => {
    const sel = "[data-office-settings] [data-branding-name]";
    expect(await focus(sel)).toBe(true);
    for (const t of ["ひ", "ひか", "ひかり"]) {
      await s.page.compose(t);
      await wait();
      expect(await state(sel)).toEqual({ same: true, value: t });
    }
    await s.page.insert("光");
    await wait();
    expect(await state(sel)).toEqual({ same: true, value: "光" });
    await s.page.insert("事務所");
    await wait();
    expect(await state(sel)).toEqual({ same: true, value: "光事務所" });
  });

  it("ほかの文字の欄（前提条件の％・料金表の金額）も続けて打てる", async () => {
    // 前提条件の既定値の画面へ移る（左の目次）
    await s.page.click("前提条件の既定値", { within: "panel" });
    const sels = await s.page.eval<string[]>(
      `return [...document.querySelectorAll("[data-office-settings] input[type=text]:not([data-branding-name]):not([disabled])")].filter((e) => e.offsetParent !== null).slice(0, 4).map((e, i) => { e.setAttribute("data-typing-test", String(i)); return "[data-typing-test='" + i + "']"; })`,
    );
    expect(sels.length).toBeGreaterThan(0);
    for (const sel of sels) {
      expect(await focus(sel)).toBe(true);
      for (const c of "12") {
        await s.page.insert(c);
        await wait();
        expect((await state(sel)).same).toBe(true);
      }
      expect((await state(sel)).value).toBe("12");
    }
  });
});
