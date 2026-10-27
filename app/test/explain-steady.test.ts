// 説明モードで「次へ」を押しても、画面の位置が動かない（文の箱・凡例・ボタン・目盛り）
import { describe, expect, it } from "vitest";
import { h } from "preact";
import { renderToString } from "preact-render-to-string";
import { ExplainBar, MainChart, MainLegend } from "../src/presentation/MainChart.tsx";
import type { PresentationModel } from "../src/presentation/model.ts";
import { ResultCard } from "../src/presentation/MainView.tsx";
import { demoHousehold } from "../src/workspace/catalog.ts";
import { explainModel } from "../src/workspace/explain.ts";
import { applyLevers } from "../src/workspace/levers.ts";
import { toPresentation } from "../src/workspace/present.ts";
import { roles } from "../src/workspace/roles.ts";
import { modelHousehold, preview } from "./helpers.ts";

const noop = () => undefined;
const req = modelHousehold("salariedCoupleTwoKids");
const self = roles(req).find((r) => r.key === "self")!.member;
const demo = demoHousehold("salariedCoupleTwoKids")!;
const proposal = applyLevers(req, self.id, demo.firstProposal, { reemployment: demo.reemployment! });
const r = preview(proposal);
const ex = explainModel(proposal, r, 95);
const model: PresentationModel = toPresentation({ base: req, proposal, current: preview(req), proposed: r, targetAge: 95, selectedYear: 2031, provisional: false, names: { selected: "プランB", base: "プランA", same: false } });
const steps = ex.steps.map((_, i) => i);

/** 見えている・見えないの印（class・aria-hidden・data-verdict など）を除いた形。段で変わるのは印だけのはず */
const shape = (html: string) =>
  html
    .replace(/ class="[^"]*"/g, "")
    .replace(/ aria-(hidden|current|pressed)="[^"]*"/g, "")
    .replace(/ data-(verdict|ex-later)(="[^"]*")?/g, "")
    .replace(/ disabled(="[^"]*")?/g, "");

describe("説明モードの位置を動かさない", () => {
  const card = (step: number) => renderToString(h(ResultCard, { model, verdict: model.result, provisional: false, mode: "assets", onMode: noop, explain: { model: ex, step }, onExplain: noop, ageMark: null, pinnedYear: null, onSelectYear: noop }));

  it("説明の文の箱: 全部の段の文を同じ場所に重ね、今の段だけ見せる（箱の高さはいちばん長い段で決まり、段で変わらない）", () => {
    for (const i of steps) {
      const html = card(i);
      const box = /<p class="verdict-line ex-verdict"[^>]*>([\s\S]*?)<\/p>/.exec(html)![1]!;
      // 全部の段の文が入っている
      expect(box.match(/data-ex-say="/g)).toHaveLength(ex.steps.length);
      for (const s of ex.steps) expect(box).toContain(s.sentence[0]!.text);
      // 見えるのは今の段だけ（読み上げも今の段だけ）
      expect(box.match(/data-verdict/g)).toHaveLength(1);
      expect(box.match(/aria-hidden="true"/g)).toHaveLength(ex.steps.length - 1);
      expect(box).toMatch(new RegExp(`class="ex-say" data-verdict(="")? data-ex-say="${i}"`));
    }
    // 印を除けば、どの段でも同じ中身（高さが段で変わらない）
    const first = shape(/<p class="verdict-line ex-verdict"[\s\S]*?<\/p>/.exec(card(0))![0]);
    for (const i of steps) expect(shape(/<p class="verdict-line ex-verdict"[\s\S]*?<\/p>/.exec(card(i))![0])).toBe(first);
  });

  it("凡例: まだの段の印も場所を取っておき（見えなくするだけ）、段で並びが変わらない", () => {
    const legend = (step: number) => renderToString(h(MainLegend, { model, mode: "assets", explain: { model: ex, step } }));
    for (const i of steps) {
      const html = legend(i);
      expect(html.match(/class="lg[ "]/g)).toHaveLength(6);
      expect(html.match(/data-ex-later/g) ?? []).toHaveLength(ex.steps.length - 1 - i);
      expect(shape(html)).toBe(shape(legend(0)));
    }
  });

  it("帯: 「次へ」と「終わる」は同じ幅を取る（見えない方の文字で幅を取る）。最後の段でも「戻る」の位置が動かない", () => {
    const bar = (step: number) => renderToString(h(ExplainBar, { model: ex, step, onStep: noop, onClose: noop }));
    const mid = bar(0);
    expect(mid).toContain("data-explain-next");
    expect(mid).toMatch(/<span class="btn primary ex-sizer" aria-hidden="true">終わる<\/span>/);
    const last = bar(ex.steps.length - 1);
    expect(last).toContain("data-explain-close");
    expect(last).not.toContain("data-explain-next");
    expect(last).toMatch(/<span class="btn primary ex-sizer" aria-hidden="true">次へ →<\/span>/);
  });

  it("グラフ: 収入〜住宅の段では目盛り（0の線の位置・数字）が動かない。資産の推移の段だけ金融資産に合わせる", () => {
    const chart = (step: number) => renderToString(h(MainChart, { model, mode: "assets", explain: { model: ex, step }, ageMark: null, pinnedYear: null, onSelectYear: noop }));
    // 縦の目盛りの数字（左の軸の文字）と、その高さ
    const ticks = (html: string) => [...html.matchAll(/<text x="[\d.]+" y="([\d.-]+)" class="axis-label"[^>]*>([^<]*)<\/text>/g)].map((m) => `${m[2]}@${m[1]}`);
    const bars = ex.steps.findIndex((s) => s.key === "assets");
    const t0 = ticks(chart(0));
    expect(t0.length).toBeGreaterThan(2);
    for (let i = 1; i < bars; i++) expect(ticks(chart(i))).toEqual(t0);
    // 0の線（axis0）も収入〜住宅の段で同じ高さ
    const zero = (html: string) => /<line[^>]*y1="([\d.-]+)"[^>]*class="axis0"/.exec(html)?.[1];
    expect(zero(chart(0))).toBeDefined();
    for (let i = 1; i < bars; i++) expect(zero(chart(i))).toBe(zero(chart(0)));
  });
});
