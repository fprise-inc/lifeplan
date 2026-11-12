// 対策の区画の「! 要確認 N」のボタン: 「変えたこと」のボタンと同じく押すたびに一覧を開け閉めする（aria-expanded を持つ）。
// 基準のプランを表示中で「変えたこと」のボタンが出ないときも、「要確認」だけで開け閉めできる。開いた一覧は要確認の行が先に並び、その上になぜ出ているかとボタンの使い分けの説明が出る
import { h } from "preact";
import { renderToString } from "preact-render-to-string";
import { describe, expect, it } from "vitest";
import { LeverCard, reviewGuide, type LeverCardProps } from "../src/workspace/LeverPanel.tsx";
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

describe("開いた一覧の、要確認の行の上の説明", () => {
  const row = (state: ChangeRow["state"]): ChangeRow => ({ key: state, label: state, from: "—", to: "—", state, inherited: false, reviewNote: "注" });

  it("現状のプランの値が変わった行だけなら、2つのボタンの使い分けを言う", () => {
    expect(reviewGuide([row("changed")], true, true)).toBe(
      "現状のプランが変わったため、このプランで変えていた所を確かめてください。このプランの値をそのまま使うときは「確認した（このまま）」、現状のプランに合わせるときは「この差分を外す」を選んでください。",
    );
  });

  it("外すボタンしか出ない種類だけなら、その説明だけ。アプリの更新で出た物はそう言う", () => {
    const only = reviewGuide([row("missing"), row("noOwner")], true, true)!;
    expect(only).toContain("現状のプランが変わったため");
    expect(only).toContain("これらの変更は計算に入っていません。要らなければ「この差分を外す」を選んでください。");
    expect(only).not.toContain("確認した（このまま）");
    expect(reviewGuide([row("retired")], true, true)).toMatch(/^アプリが更新されたため、/);
    expect(reviewGuide([row("gone"), row("unresolved")], true, true)).toMatch(/^現状のプランが変わったか、アプリが更新されたため、/);
  });

  it("両方の種類があれば両方を言う。ボタンが出ない（保存していない変更がある）ときは、保存か取り消しを促す", () => {
    const both = reviewGuide([row("changed"), row("exists")], true, true)!;
    expect(both).toContain("「確認した（このまま）」");
    expect(both).toContain("「この差分を外す」だけの行は、計算に入っていません。");
    expect(reviewGuide([row("changed")], false, false)).toContain("保存していない変更を保存するか取り消すと、ここで選べます。");
    expect(reviewGuide([], true, true)).toBeNull();
  });

  it("一覧を開くと、説明は最初の要確認の行の上に出る。要確認が無ければ出ない", () => {
    const html = card({ initialOpen: true, onAck: noop, onDrop: noop });
    const g = html.indexOf("data-plan-review-guide");
    expect(g).toBeGreaterThan(0);
    expect(g).toBeLessThan(html.indexOf('class="review"'));
    expect(card({ initialOpen: true, changes: changes.filter((c) => c.state === "ok") })).not.toContain("data-plan-review-guide");
  });
});
