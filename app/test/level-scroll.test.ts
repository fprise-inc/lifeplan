// 入力のパネルの標準・詳細のスクロールの位置（0078 の 2026-11-14 の追記）: 細かさごとに覚え、切り替えのボタンで戻ると元の位置に戻す。
// 初めて行く細かさは今までどおり（位置をそのまま）。欄へ移る切り替え（restore なし）は戻さない
import { describe, expect, it } from "vitest";
import { LevelScroll } from "../src/workspace/input/levelScroll.ts";

describe("標準・詳細のスクロールの位置", () => {
  it("標準→詳細→標準で、標準は元の位置・詳細も元の位置に戻る", () => {
    const ls = new LevelScroll();
    const box = { scrollTop: 300 };
    ls.leave("simple", "detail", box, true);
    ls.arrive(box);
    // 初めての詳細は今までどおり（位置をそのまま）
    expect(box.scrollTop).toBe(300);
    box.scrollTop = 1200;
    ls.leave("detail", "simple", box, true);
    ls.arrive(box);
    expect(box.scrollTop).toBe(300);
    box.scrollTop = 50;
    ls.leave("simple", "detail", box, true);
    ls.arrive(box);
    expect(box.scrollTop).toBe(1200);
    ls.leave("detail", "simple", box, true);
    ls.arrive(box);
    expect(box.scrollTop).toBe(50);
  });
  it("欄へ移る切り替え（restore なし）は戻さないが、元の細かさの位置は覚える", () => {
    const ls = new LevelScroll();
    const box = { scrollTop: 400 };
    ls.leave("simple", "detail", box, true);
    ls.arrive(box);
    box.scrollTop = 900;
    ls.leave("detail", "simple", box, true);
    ls.arrive(box);
    expect(box.scrollTop).toBe(400);
    // 一覧から詳細の欄へ移る: 詳細の前の位置（900）に戻さない（欄へのスクロールに任せる）
    ls.leave("simple", "detail", box, false);
    ls.arrive(box);
    expect(box.scrollTop).toBe(400);
    box.scrollTop = 1500;
    ls.leave("detail", "simple", box, true);
    ls.arrive(box);
    expect(box.scrollTop).toBe(400);
  });
  it("同じ細かさを押しても動かさない", () => {
    const ls = new LevelScroll();
    const box = { scrollTop: 200 };
    ls.leave("simple", "simple", box, true);
    ls.arrive(box);
    expect(box.scrollTop).toBe(200);
  });
});
