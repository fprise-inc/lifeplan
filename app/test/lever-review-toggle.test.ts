// 対策の区画の「! 要確認 N」のボタン: 「変えたこと」のボタンと同じく押すたびに一覧を開け閉めする（aria-expanded を持つ）。
// 基準のプランを表示中で「変えたこと」のボタンが出ないときも、「要確認」だけで開け閉めできる。開いた一覧は要確認の行が先に並ぶ
import { h } from "preact";
import { renderToString } from "preact-render-to-string";
import { describe, expect, it } from "vitest";
import { LeverCard, type LeverCardProps } from "../src/workspace/LeverPanel.tsx";
import type { ChangeRow } from "../src/workspace/plans/plans.ts";

const noop = () => undefined;
const changes: ChangeRow[] = [
  { key: "living", label: "生活費", from: "月30万円", to: "月28万円", state: "ok", inherited: false, reviewNote: null },
  { key: "diff:1", label: "車の買い替え", from: "2030年", to: "2032年", state: "changed", inherited: true, reviewNote: "元のプランで変わりました" },
  { key: "retireAge", label: "働く最後の年齢", from: "60歳", to: "63歳", state: "ok", inherited: false, reviewNote: null },
];
const card = (over: Partial<LeverCardProps>) =>
  renderToString(
    h(LeverCard, { selected: "プランB", baseLetter: "A", locked: null, modified: false, levers: [], fee: null, onSlide: noop, onRelease: noop, onReset: noop, onOverwrite: null, onSaveNew: noop, suggested: "", changes, onAck: null, onDrop: null, ...over }),
  );
/** ボタンの開始タグ（data-* の印で探す） */
const tag = (html: string, mark: string) => html.match(new RegExp(`<button[^>]*${mark}[^>]*>`))?.[0] ?? "";

describe("対策の「! 要確認」のボタンの開け閉め", () => {
  it("閉じているときは「変えたこと」も「要確認」も aria-expanded が false で、一覧は出ない", () => {
    const html = card({});
    expect(tag(html, "data-plan-changes")).toContain('aria-expanded="false"');
    expect(tag(html, "data-plan-review")).toContain('aria-expanded="false"');
    expect(html).not.toContain('class="pb-list"');
  });

  it("開いているときは両方の aria-expanded が true で、要確認の行が一覧の先頭に来る（ほかの行の順はそのまま）", () => {
    const html = card({ initialOpen: true });
    expect(tag(html, "data-plan-changes")).toContain('aria-expanded="true"');
    expect(tag(html, "data-plan-review")).toContain('aria-expanded="true"');
    const order = ["車の買い替え", "生活費", "働く最後の年齢"].map((t) => html.indexOf(t));
    expect(order.every((i) => i > 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(html).toMatch(/<li class="review"><span class="pb-l">車の買い替え/);
  });

  it("基準のプランを表示中（動かせない）は「要確認」だけが出て、開け閉めの向き（▾・▴）と aria-expanded を持つ", () => {
    const closed = card({ locked: "基準のプラン" });
    expect(closed).not.toContain("data-plan-changes");
    expect(tag(closed, "data-plan-review")).toContain('aria-expanded="false"');
    expect(closed).toMatch(/! 要確認 <!-- -->1<!-- --> ▾|! 要確認 1 ▾/);
    const opened = card({ locked: "基準のプラン", initialOpen: true });
    expect(tag(opened, "data-plan-review")).toContain('aria-expanded="true"');
    expect(opened).toMatch(/! 要確認 <!-- -->1<!-- --> ▴|! 要確認 1 ▴/);
    expect(opened).toContain('class="pb-list"');
  });

  it("動かせるときの「要確認」には向きの印を付けない（「変えたこと」の側に出る）", () => {
    expect(card({})).not.toMatch(/要確認 (<!-- -->)?1(<!-- -->)? ?▾/);
  });

  it("要確認が無ければ「要確認」のボタンは出ない", () => {
    expect(card({ changes: changes.filter((c) => c.state === "ok") })).not.toContain("data-plan-review");
  });
});
