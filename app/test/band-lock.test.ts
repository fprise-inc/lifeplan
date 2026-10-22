// 運用の期間の帯の切れ目のつまみ: 基準のプラン・現状を表示しているときは動かせず、つまみに乗せる・フォーカスする・押すと理由の札を出す
import { describe, expect, it, vi } from "vitest";
import { h } from "preact";
import { renderToString } from "preact-render-to-string";
import type { Scale } from "../src/presentation/chart.ts";
import { bandHandle, nextBandTip, PeriodBand, type BandHandleProps, type BandTip } from "../src/presentation/InvestLayers.tsx";
import type { InvestBandModel } from "../src/presentation/model.ts";
import { bandLockNote, lockReason, type Work } from "../src/workspace/App.tsx";
import { CURRENT } from "../src/workspace/plans/band.ts";

const n = 40;
const s: Scale = { ticks: [], min: 0, max: 1, x: (i) => 60 + i * 20, y: () => 0, band: 20 };
const ages = Array.from({ length: n }, (_, i) => 45 + i);
const band: InvestBandModel = {
  accumEnd: 15,
  wdStart: 20,
  stopAge: 60,
  wdAge: 65,
  estimated: false,
  steps: [{ at: 0, label: "月5万" }],
  accumText: "積み立てる 45〜59歳",
  holdText: "据え置く",
  holdSub: "60〜64歳",
  wdText: "取り崩す",
  wdSub: "65歳〜 月10万円",
  minAge: 45,
  maxAge: 84,
};
const BASE_NOTE = "基準のプランは動かせません。別のプランを選ぶか『＋ このプランを元に作る』で動かせます";

const key = (k: string) => ({ key: k, preventDefault: vi.fn(), stopPropagation: vi.fn() });
const handleProps = (p: Partial<BandHandleProps>): BandHandleProps => ({ which: "stop", x: 360, age: 60, clamp: (_w, a) => Math.max(45, Math.min(65, a)), ageAtX: () => null, onTip: vi.fn(), ...p });
type Handlers = Record<string, (e: unknown) => void>;

describe("運用の期間の帯のつまみ: 基準のプランでは動かず理由の札が出る", () => {
  const ids = ["p1", "p2"];
  it("動かせない理由（短い文）は lockReason と同じ決まり: 基準のプラン・現状のときだけ", () => {
    const base: Work = { band: ids, base: "p1", sel: "p1", drafts: {} };
    const cur: Work = { band: ids, base: "p1", sel: CURRENT, drafts: {} };
    const other: Work = { band: ids, base: "p1", sel: "p2", drafts: {} };
    expect(bandLockNote(base)).toBe(BASE_NOTE);
    expect(bandLockNote(cur)).toBe("現状は入力の画面で直します。別のプランを選ぶか『＋ このプランを元に作る』で動かせます");
    expect(bandLockNote(other)).toBeNull();
    for (const w of [base, cur, other]) expect(bandLockNote(w) === null).toBe(lockReason(w, () => "A") === null);
  });

  it("基準のプラン: つまみは見えるまま aria-disabled（disabled にしない）で、読み上げは理由の札に結ぶ", () => {
    const html = renderToString(h(PeriodBand, { band, s, n, left: 60, width: 900, ages, lock: BASE_NOTE }));
    const handles = html.match(/<button[^>]*data-band-handle[^>]*>/g) ?? [];
    expect(handles).toHaveLength(2);
    const tip = /<div id="([^"]+)" class="year-tip pb-tip" role="tooltip" hidden[^>]*data-band-tip="true">([^<]*)<\/div>/.exec(html);
    expect(tip?.[2]).toBe(BASE_NOTE);
    for (const b of handles) {
      expect(b).toContain('class="pb-h locked"');
      expect(b).toContain('aria-disabled="true"');
      expect(b).not.toMatch(/\sdisabled(=|\s|>)/);
      expect(b).toContain(`aria-describedby="${tip?.[1]}"`);
      expect(b).toContain("今は動かせません");
    }
  });

  it("基準のプラン: ← → を押しても動かさず、乗せる・フォーカスする・タッチで押すと札を出す", () => {
    const onTip = vi.fn();
    const btn = bandHandle(handleProps({ onTip, tipId: "t" }));
    const on = btn.props as unknown as Handlers;
    const k = key("ArrowRight");
    on.onKeyDown!(k);
    expect(k.preventDefault).not.toHaveBeenCalled();
    on.onPointerEnter!({ pointerType: "mouse" });
    on.onFocus!(undefined);
    on.onPointerDown!({ pointerType: "touch" });
    on.onPointerEnter!({ pointerType: "touch" });
    expect(onTip.mock.calls.map((c) => (c[0] as { type: string }).type)).toEqual(["enter", "focus", "tap"]);
  });

  it("札の出し入れ: 乗せている間・フォーカスしている間だけ出し、タッチで押したものは押し直す・外を押すまで残る", () => {
    let t: BandTip = null;
    t = nextBandTip(t, { type: "enter", which: "stop" });
    expect(t).toEqual({ which: "stop", pinned: false });
    t = nextBandTip(t, { type: "leave", which: "stop" });
    expect(t).toBeNull();
    t = nextBandTip(t, { type: "focus", which: "wd" });
    expect(t).toEqual({ which: "wd", pinned: false });
    t = nextBandTip(t, { type: "blur", which: "wd" });
    expect(t).toBeNull();
    t = nextBandTip(t, { type: "tap", which: "stop" });
    expect(t).toEqual({ which: "stop", pinned: true });
    expect(nextBandTip(t, { type: "blur", which: "stop" })).toEqual(t);
    expect(nextBandTip(t, { type: "tap", which: "wd" })).toEqual({ which: "wd", pinned: true });
    expect(nextBandTip(t, { type: "tap", which: "stop" })).toBeNull();
    expect(nextBandTip(t, { type: "close" })).toBeNull();
  });

  it("別のプラン: 今どおり ← → で動き、札は出さない", () => {
    const html = renderToString(h(PeriodBand, { band, s, n, left: 60, width: 900, ages, onBand: () => undefined }));
    expect(html).not.toContain("aria-disabled");
    expect(html).not.toContain("data-band-tip");
    expect(html).toContain("← → で1歳ずつ動かす");
    const onBand = vi.fn();
    const onTip = vi.fn();
    const on = bandHandle(handleProps({ onBand, onTip })).props as unknown as Handlers;
    const k = key("ArrowRight");
    on.onKeyDown!(k);
    expect(k.preventDefault).toHaveBeenCalled();
    expect(onBand).toHaveBeenCalledWith("stop", 61, "release");
    on.onPointerEnter!({ pointerType: "mouse" });
    on.onFocus!(undefined);
    expect(onTip).not.toHaveBeenCalled();
  });
});
