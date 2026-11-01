// 「○歳時点の金融資産」で今より前の年齢: 表示の設定の年齢の選択肢に出さない。保存した設定・別の世帯の設定などで過ぎた年齢が残っていても
// 「0万円」にせず、表の最初の年（今）の年齢の時点として出す（カード・結論の2行目・グラフの印・見出し・比べる表）
import { describe, expect, it } from "vitest";
import { h } from "preact";
import { renderToString } from "preact-render-to-string";
import { DisplaySettingsPanel } from "../src/workspace/DisplaySettingsPanel.tsx";
import { compareTable, metricsOf } from "../src/workspace/plans/compare.ts";
import { displayYears, financialOf, firstAgeOf, toPresentation } from "../src/workspace/present.ts";
import { ageMarkOf, cardMetrics, DEFAULT_DISPLAY_SETTINGS, toggleMetric, verdictMetrics } from "../src/workspace/settings.ts";
import { modelHousehold, preview } from "./helpers.ts";

// 本人は1950年3月生まれ（計算基準月 2026-10 で76歳）。表の最初の年は 2027 年（77歳）
const req = modelHousehold("pensionCouple");
const res = preview(req);
const first = displayYears(req)[0]!;
const fin = financialOf(res.table);

describe("○歳時点の金融資産: 今より前の年齢", () => {
  it("表の最初の年の年齢が分かる", () => {
    expect(first).toBe(2027);
    expect(firstAgeOf(req)).toBe(77);
  });

  it("過ぎた年齢（60歳）でも0万円にせず、表の最初の年（77歳）の金融資産を出す", () => {
    const m = metricsOf(req, res.table, 60);
    expect(m.targetYear).toBe(first);
    expect(m.targetAge).toBe(77);
    expect(m.target).toBe(fin.get(first));
    expect(m.target).not.toBe(0);
    const s = { ...toggleMetric(DEFAULT_DISPLAY_SETTINGS, "assetsAtAge", true), atAge: 60 };
    expect(cardMetrics(s, m)[0]?.label).toBe("77歳時点");
    expect(verdictMetrics(s, { name: "現状", m }, null)[0]?.text).toContain("77歳時点");
    expect(ageMarkOf(s, req)).toEqual({ year: first, label: "77歳" });
    const p = toPresentation({ base: req, proposal: req, current: res, proposed: res, targetAge: 60, selectedYear: null, provisional: false, names: { selected: "現状", base: "現状", same: true } });
    expect(p.headline.label).toContain("77歳時点");
    expect(p.headline.amount).toBe(fin.get(first));
    expect(compareTable(req, [{ name: "現状", table: res.table }], 60).rows[0]?.cells[0]?.text).not.toBe("0万円");
  });

  it("今より後の年齢は今までどおり（選んだ年齢の年）", () => {
    const m = metricsOf(req, res.table, 90);
    expect(m.targetYear).toBe(1950 + 90);
    expect(m.targetAge).toBe(90);
  });

  it("表示の設定の年齢の選択肢に、過ぎた年齢を出さない（残っていた過ぎた年齢は、今の年齢で選んだ形に見せる）", () => {
    const noop = () => undefined;
    const s = { ...toggleMetric(DEFAULT_DISPLAY_SETTINGS, "assetsAtAge", true), atAge: 60 };
    const html = renderToString(h(DisplaySettingsPanel, { value: s, onChange: noop, onClose: noop, feeAvailable: false, firstAge: 77 }));
    const opts = [...html.matchAll(/<option[^>]*value="(\d+)"/g)].map((x) => Number(x[1]));
    expect(opts).toEqual([77, 80, 85, 90, 95, 100]);
    expect(html).toContain('<option selected value="77">');
    // 本人の年齢が分からないときは今までどおり
    const all = renderToString(h(DisplaySettingsPanel, { value: s, onChange: noop, onClose: noop, feeAvailable: false }));
    expect([...all.matchAll(/<option[^>]*value="(\d+)"/g)].map((x) => Number(x[1]))).toEqual([60, 65, 70, 75, 80, 85, 90, 95, 100]);
  });
});
