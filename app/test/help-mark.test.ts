// 説明の「?」の手直し（0077 の追記）: 「?」は丸の中央・少し小さく。開いた説明は選んでコピーでき、「?」から箱へ動かす途中で閉じない
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { h } from "preact";
import { renderToString } from "preact-render-to-string";
import { Help, HELP_GLYPH, HELP_LEAVE_MS, helpHoverGate, helpPlace } from "../src/presentation/Help.tsx";
import { APP_DIR } from "../scripts/lib.ts";

const CSS = readFileSync(join(APP_DIR, "src", "styles", "app.css"), "utf8");

/** 試しのタイマー（時を進めると、期限の来た物を呼ぶ） */
function fakeTimer() {
  let now = 0;
  let seq = 0;
  const jobs = new Map<number, { at: number; f: () => void }>();
  return {
    set: (f: () => void, ms: number) => {
      const id = ++seq;
      jobs.set(id, { at: now + ms, f });
      return id;
    },
    clear: (id: unknown) => {
      jobs.delete(id as number);
    },
    tick(ms: number) {
      now += ms;
      for (const [id, j] of [...jobs]) {
        if (j.at <= now) {
          jobs.delete(id);
          j.f();
        }
      }
    },
  };
}

function gate() {
  const t = fakeTimer();
  const seen: string[] = [];
  const g = helpHoverGate((e) => seen.push(e), t);
  return { g, t, seen };
}

describe("「?」の字は丸の中央", () => {
  const g = HELP_GLYPH;
  const nums = (s: string) => [...s.matchAll(/-?\d*\.?\d+/g)].map((m) => Number(m[0]));
  const [mx, my, r] = nums(g.path);
  const cx = mx! + r!;
  const cy = my!;
  it("字の外形（線の太さを含む）の中心が、描く範囲の中心（上下・左右とも）", () => {
    expect((g.ink.top + g.ink.bottom) / 2).toBeCloseTo(g.view / 2, 6);
    expect((g.ink.left + g.ink.right) / 2).toBeCloseTo(g.view / 2, 6);
  });
  it("外形の寸法は、線と点の寸法から出した値と同じ（書いた寸法と描く形がずれていない）", () => {
    expect(g.ink.top).toBeCloseTo(cy - r! - g.stroke / 2, 6);
    expect(g.ink.bottom).toBeCloseTo(g.dot.cy + g.dot.r, 6);
    expect(g.ink.left).toBeCloseTo(cx - r! - g.stroke / 2, 6);
    expect(g.ink.right).toBeCloseTo(cx + r! + g.stroke / 2, 6);
    // 弧の終わりは同じ円の上
    const a = /a([\d.]+) ([\d.]+) 0 1 1 ([\d.]+) ([\d.]+)/.exec(g.path)!;
    expect(Math.hypot(mx! + Number(a[3]) - cx, my! + Number(a[4]) - cy)).toBeCloseTo(r!, 2);
    // 点と軸は左右の中央
    expect(g.dot.cx).toBe(g.view / 2);
  });
  it("字は丸の内側に対して小さめ（高さが内側の6割に収まる）。軸と点の間はあける", () => {
    expect((g.ink.bottom - g.ink.top) / g.view).toBeLessThanOrEqual(0.6);
    const c = nums(/c(.*)$/.exec(g.path)![1]!);
    const stemEnd = my! + Number(/a[\d.]+ [\d.]+ 0 1 1 [\d.]+ ([\d.]+)/.exec(g.path)![1]) + c[5]! + g.stroke / 2;
    expect(g.dot.cy - g.dot.r - stemEnd).toBeGreaterThanOrEqual(1);
  });
  it("字ではなく SVG で描き、丸（ボタン）の内側いっぱいに広げる。どの文字の大きさでも em で決まるので同じ形", () => {
    const html = renderToString(h(Help, { label: "入力のホーム" }, "説明"));
    expect(html).toContain(`<svg class="help-q" viewBox="0 0 ${g.view} ${g.view}" aria-hidden="true"`);
    expect(html).not.toMatch(/<span aria-hidden="true">\?<\/span>/);
    expect(CSS).toMatch(/\.help-btn \{[^}]*box-sizing: border-box;[^}]*width: 1\.25em; height: 1\.25em;/);
    expect(CSS).toMatch(/\.help-btn > \.help-q \{ display: block; flex: none; width: 100%; height: 100%; \}/);
    // 置き場所ごとに変えるのは文字の大きさだけ（丸と字が一緒に大きさを変える）
    for (const m of CSS.matchAll(/\.help-btn \{[^}]*\}/g)) expect(m[0]).not.toMatch(/line-height: (?!1;)/);
  });
  it("印を押して開く形（「推定」の札など）は今のまま字で出す", () => {
    const html = renderToString(h(Help, { label: "根拠", mark: "推定", markClass: "badge est" }, "統計の目安"));
    expect(html).not.toContain("help-q");
    expect(html).toContain(">推定</button>");
  });
});

describe("「?」から説明の箱へ動かす間は閉じない", () => {
  it("外れてもすぐには閉じず、待つ間に戻れば閉じない", () => {
    const { g, t, seen } = gate();
    g.enter();
    g.leave();
    t.tick(HELP_LEAVE_MS - 1);
    expect(seen).toEqual(["enter"]);
    g.enter(); // 箱（同じ包みの中）に入った
    t.tick(HELP_LEAVE_MS * 3);
    expect(seen).toEqual(["enter", "enter"]);
  });
  it("外れたまま待つと閉じる", () => {
    const { g, t, seen } = gate();
    g.enter();
    g.leave();
    t.tick(HELP_LEAVE_MS);
    expect(seen).toEqual(["enter", "leave"]);
  });
  it("待つ間は、「?」と箱のすき間を越えるのに足りる長さ。すき間は見えない帯でも埋める", () => {
    expect(HELP_LEAVE_MS).toBeGreaterThanOrEqual(200);
    expect(HELP_LEAVE_MS).toBeLessThanOrEqual(500);
    expect(CSS).toMatch(/\.help-pop::before \{ content: ""; position: absolute; left: 0; right: 0; height: 10px; \}/);
    expect(CSS).toMatch(/\.help-pop\[data-side="below"\]::before \{ top: -10px; \}/);
    expect(CSS).toMatch(/\.help-pop\[data-side="above"\]::before \{ bottom: -10px; \}/);
  });
});

describe("開いた説明の文を選んでコピーできる", () => {
  it("箱の中でドラッグして外へ出ても、押している間は閉じない。離したあと外にいれば、待ってから閉じる", () => {
    const { g, t, seen } = gate();
    g.enter();
    g.dragStart();
    g.leave();
    t.tick(HELP_LEAVE_MS * 5);
    expect(seen).toEqual(["enter"]);
    g.dragEnd();
    t.tick(HELP_LEAVE_MS - 1);
    expect(seen).toEqual(["enter"]);
    t.tick(1);
    expect(seen).toEqual(["enter", "leave"]);
  });
  it("箱の中で離したときは開いたまま", () => {
    const { g, t, seen } = gate();
    g.enter();
    g.dragStart();
    g.dragEnd();
    t.tick(HELP_LEAVE_MS * 5);
    expect(seen).toEqual(["enter"]);
  });
  it("箱の文は選べる（親が選べない設定でも）。押すとフォーカスが箱へ移り、「?」の外へ出たと見なさない", () => {
    expect(CSS).toMatch(/\.help-pop \{[^}]*user-select: text; -webkit-user-select: text;/);
    const html = renderToString(h(Help, { label: "保存" }, "説明"));
    expect(html).toMatch(/role="tooltip" class="help-pop"[^>]*tabindex="-1"/);
  });
});

describe("開いた説明はどこでも見切れない（body の直下に出す・画面の端で向きを変える。0077 の追記）", () => {
  const SRC = readFileSync(join(APP_DIR, "src", "presentation", "Help.tsx"), "utf8");
  const view = { w: 1400, h: 1000 };

  it("開いている間は箱を body の直下に描く（パネルの overflow・transform に切られない）。閉じている間は包みの中に隠して置く", () => {
    expect(SRC).toMatch(/document\.body\.appendChild\(host\.current\)/);
    expect(SRC).toMatch(/render\(box, host\.current\)/);
    expect(SRC).toMatch(/\{portal \? null : box\}/);
    // 閉じている形（文字列に描く）は前と同じく包みの中
    const html = renderToString(h(Help, { label: "根拠" }, "統計の目安"));
    expect(html).toMatch(/<span class="help">.*<span id="[^"]+" role="tooltip" class="help-pop" hidden/);
  });

  it("右の端: 画面の右から 8px 残して左へずらす。左の端: 8px から", () => {
    expect(helpPlace({ left: 1300, top: 100, bottom: 120 }, { w: 360, h: 80 }, view)).toEqual({ left: 1400 - 360 - 8, top: 126, side: "below" });
    expect(helpPlace({ left: -20, top: 100, bottom: 120 }, { w: 360, h: 80 }, view).left).toBe(8);
    // 画面より広い箱は無い（CSS で画面の幅 − 16px まで）が、来ても左の 8px から
    expect(helpPlace({ left: 500, top: 100, bottom: 120 }, { w: 1500, h: 80 }, view).left).toBe(8);
  });

  it("下に収まらなければ上へ。どちらにも収まらなければ広い方に出し、画面の中で止める", () => {
    expect(helpPlace({ left: 100, top: 900, bottom: 920 }, { w: 300, h: 200 }, view)).toEqual({ left: 100, top: 900 - 6 - 200, side: "above" });
    // 上も下も足りない（背の高い箱）: 広い方（下）に出して、画面の下の端で止める
    const tall = helpPlace({ left: 100, top: 300, bottom: 320 }, { w: 300, h: 900 }, view);
    expect(tall.side).toBe("below");
    expect(tall.top).toBe(1000 - 8 - 900);
    // 上の方が広いときは上に出し、画面の上の端で止める
    const up = helpPlace({ left: 100, top: 700, bottom: 720 }, { w: 300, h: 900 }, view);
    expect(up).toMatchObject({ side: "above", top: 8 });
  });

  it("transform のかかった枠の中の基準（origin）を引く", () => {
    expect(helpPlace({ left: 100, top: 100, bottom: 120 }, { w: 300, h: 80 }, view, { x: 40, y: 50 })).toEqual({ left: 60, top: 76, side: "below" });
  });

  it("画面の高さに収まらない箱は画面の高さで止めて中を動かす", () => {
    expect(CSS).toMatch(/\.help-pop\[data-tall\] \{ max-height: calc\(100vh - 16px\); overflow-y: auto; \}/);
    expect(CSS).toMatch(/\.help-pop \{[^}]*max-width: min\(26em, calc\(100vw - 16px\)\)/);
  });
});

describe("状態の印は文字だけ（枠・地の色なし。0077 の追記）", () => {
  const rule = (sel: string) => new RegExp(`(^|\\n)${sel.replace(/[.[\]()]/g, "\\$&")} \\{([^}]*)\\}`).exec(CSS)?.[2] ?? "";

  it("推定・わからない・該当なし・未入力の印に枠も地の色も無い。色は今の色", () => {
    expect(rule(".badge")).toMatch(/border: 0;/);
    expect(rule(".badge")).toMatch(/background: none;/);
    expect(rule(".badge.est")).toBe(" color: var(--base-ink); ");
    expect(rule(".badge.unk")).toBe(" color: var(--est-ink); ");
    expect(rule(".badge.na")).toBe(" color: var(--ink-2); ");
    expect(rule(".badge.missing")).toBe(" color: var(--short-ink); ");
    expect(CSS).not.toMatch(/\.badge[^{]*\{[^}]*dashed/);
  });

  it("押せる印は、カーソルを合わせる・開いている間だけ下線（「?」の丸の色の変わり方は当てない）", () => {
    expect(CSS).toMatch(/\.help-btn\.help-mark \{[^}]*border: 0;[^}]*background: none;[^}]*text-decoration: none;/);
    expect(CSS).toMatch(/\.help-btn\.help-mark:hover, \.help-btn\.help-mark\[aria-expanded="true"\] \{ text-decoration: underline; \}/);
    expect(CSS).toMatch(/\.help-btn:not\(\.help-mark\):hover/);
  });
});
