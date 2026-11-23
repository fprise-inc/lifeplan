// プランの一覧の「! 要確認 n」（0250）: 押せるボタンで、カーソルを合わせたときは短い説明、押すと吹き出しに確かめることを1行ずつ出す。
// 文は対策の「変えたこと」と同じ（changesOf の reviewNote）。対策へ移るボタンは、呼ぶ側が渡したときだけ
import { h } from "preact";
import { renderToString } from "preact-render-to-string";
import { describe, expect, it } from "vitest";
import { demoHousehold } from "../src/workspace/catalog.ts";
import { fromRequest } from "../src/workspace/input/household.ts";
import { buildCatalog } from "../src/workspace/plans/items.ts";
import { PlanList } from "../src/workspace/plans/PlanList.tsx";
import { changesOf, savePlan, type ChangeRow } from "../src/workspace/plans/plans.ts";
import { ReviewMark, reviewMarkTitle } from "../src/workspace/plans/ReviewMark.tsx";
import { roles } from "../src/workspace/roles.ts";
import { modelHousehold } from "./helpers.ts";

const noop = () => undefined;
const rows: ChangeRow[] = [
  { key: "lever:livingMonthly", label: "基本生活費（月）", from: "30万円", to: "28万円", state: "changed", inherited: false, reviewNote: "現状のプランが 26万円→30万円 に変わりました" },
  { key: "diff:x", label: "外す: 負債", from: "—", to: "—", state: "gone", inherited: false, reviewNote: "このプランで外していた物は、現状のプランでももう無くなっています" },
];
const tag = (html: string) => html.match(/<button[^>]*data-plan-review-mark[^>]*>/)?.[0] ?? "";

describe("要確認の印", () => {
  it("閉じているとき: 押せるボタンで、件数・短い説明・aria-expanded=false。中身はまだ出さない", () => {
    const html = renderToString(h(ReviewMark, { rows, planName: "プランB" }));
    const b = tag(html);
    expect(b).toContain('type="button"');
    expect(b).toContain('aria-expanded="false"');
    expect(b).toContain(`title="${reviewMarkTitle(2)}"`);
    expect(reviewMarkTitle(2)).toBe("確かめること 2件。押すと一覧");
    expect(html).toMatch(/! 要確認 (<!-- -->)?2/);
    expect(html).not.toContain("data-plan-review-pop");
  });

  it("開いたとき: 確かめることを1行ずつ（項目の名前と、対策の一覧と同じ文）。閉じるのボタンと対策へ移るボタン", () => {
    const html = renderToString(h(ReviewMark, { rows, planName: "プランB", onShow: noop, initialOpen: true }));
    expect(tag(html)).toContain('aria-expanded="true"');
    expect(html).toContain('role="dialog"');
    expect(html).toContain('aria-label="プランBの要確認"');
    expect(html).toMatch(/確かめること（(<!-- -->)?2(<!-- -->)?件）/);
    expect(html.match(/data-plan-review-row/g)?.length).toBe(2);
    for (const r of rows) {
      expect(html).toContain(r.label);
      expect(html).toContain(r.reviewNote!);
    }
    expect(html).toContain("data-plan-review-close");
    expect(html).toContain('aria-label="要確認の一覧を閉じる（Esc）"');
    expect(html).toContain("対策で確かめる");
  });

  it("入力で直せないとき（onShow なし）は、対策へ移るボタンを出さない", () => {
    const html = renderToString(h(ReviewMark, { rows, planName: "プランB", initialOpen: true }));
    expect(html).not.toContain("data-plan-review-open");
  });
});

describe("プランの一覧の行", () => {
  function withReview() {
    const id = "salariedCoupleTwoKids";
    const req = modelHousehold(id);
    const self = roles(req).find((r) => r.key === "self")!.member;
    const wh0 = fromRequest(req);
    const cat = buildCatalog(wh0, self.id, demoHousehold(id) ?? null);
    const { wh } = savePlan(wh0, cat, { name: "プランB 生活費を28万円に", base: null, values: { "lever:livingMonthly": 280000 }, now: "2026-11-19T10:00:00.000Z" });
    return { wh, cat };
  }

  it("要確認が無いプランには印を出さない", () => {
    const { wh, cat } = withReview();
    const html = renderToString(h(PlanList, { wh, catalog: cat, letters: new Map(), band: [], onBand: noop, onEdit: noop, onReflect: noop, onClose: noop, stored: true }));
    expect(html).not.toContain("data-plan-review-mark");
  });

  it("差分を作った時点の値と現状が違うと、印のボタンが出て件数は changesOf の要確認の数", () => {
    const { wh: w, cat } = withReview();
    // 差分を作った時点の値を書き換えて、現状が変わったことにする
    const plan = w.proposals[0]!;
    const diffs = plan.diffs.map((d) => ({ ...d, before: 1 }));
    const wh = { ...w, proposals: [{ ...plan, diffs }] };
    const n = changesOf(wh.proposals, plan.id, wh, cat).filter((c) => c.state !== "ok").length;
    expect(n).toBeGreaterThan(0);
    const html = renderToString(h(PlanList, { wh, catalog: cat, letters: new Map(), band: [], onBand: noop, onEdit: noop, onReflect: noop, onClose: noop, stored: true }));
    expect(tag(html)).toContain(`title="${reviewMarkTitle(n)}"`);
  });
});
