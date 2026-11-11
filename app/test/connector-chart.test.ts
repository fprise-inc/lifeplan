// AI接続口のグラフ（connector/chart.ts。0202）: 比べた答えの通りごとの数字から、題・凡例・単位・前提の注・試算の旨と出典の入った SVG を作ること。
// 接続口のテスト（crates/lifeplan/tests/mcp_connector.rs の chart_compares_three_rate_paths）は、本物の接続口で同じ関数を動かし、PNG にもする
import { describe, expect, it } from "vitest";
import { chart, chartNotes, textWidth, wrap, type ChartArgs, type ChartVariant } from "../src/connector/chart.ts";

const years = Array.from({ length: 30 }, (_, i) => 2027 + i);
const v = (label: string, k: number, extra: Partial<ChartVariant> = {}): ChartVariant => ({
  label,
  series: years.map((y, i) => ({ year: y, financialAssets: 12_000_000 - i * 600_000 * k, loanRepayment: y <= 2050 ? 990_000 + (y > 2036 ? k * 100_000 : 0) : 0 })),
  keyFigures: { assetsAtAge: [{ age: 95, amount: -17_860_000 * k }], minimum: { year: 2056, amount: -24_030_000 * k }, loanRepayment: 24_000_000 + k * 1_500_000, lifetimeTakeHome: 300_000_000, lifetimeExpense: 280_000_000 },
  assumptions: { inflation: { default: "0.01" }, investmentReturn: { default: "0.01" } },
  ...extra,
});
const three: ChartVariant[] = [
  v("今のまま", 1, { planChanges: [{ label: "住宅ローンの金利の見込み（変動金利）", to: "今の金利のまま" }] }),
  v("10年で+1%", 1.1, { planChanges: [{ label: "住宅ローンの金利の見込み（変動金利）", to: "10年で1%上がる（5年後に＋0.5%・10年後に＋1%）" }] }),
  v("10年で+2%", 1.2, { planChanges: [{ label: "住宅ローンの金利の見込み（変動金利）", to: "10年で2%上がる（5年後に＋1%・10年後に＋2%）" }] }),
];
const args = (kind: ChartArgs["kind"], more: Partial<ChartArgs> = {}): ChartArgs => ({ kind, baseMonth: "2026-10", variants: three, selfAges: Object.fromEntries(years.map((y) => [String(y), y - 1981])), ...more });
const draw = (a: ChartArgs) => JSON.parse(chart(JSON.stringify(a), "", "")) as { status: string; svg: string; title: string; alt: string; width: number; height: number; reason?: string };
/** SVG の文字（タグを外して、実体参照を戻す） */
const texts = (svg: string) => [...svg.matchAll(/<text[^>]*>([^<]*)<\/text>/g)].map((m) => (m[1] as string).replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">"));

describe("比べた答えのグラフ", () => {
  for (const kind of ["assets", "repayment", "keyFigures"] as const) {
    it(`${kind}: 題・凡例・単位・前提の注・試算の旨と出典が入る`, () => {
      const out = draw(args(kind));
      expect(out.status).toBe("ok");
      const all = texts(out.svg);
      expect(out.svg).toMatch(/^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg"/);
      expect(out.svg).toContain(`<title>${out.title}</title>`);
      expect(all[0]).toBe(out.title);
      for (const [i, l] of ["今のまま", "10年で+1%", "10年で+2%"].entries()) expect(all).toContain(`${"ABC"[i]}　${l}`);
      expect(all).toContain("（万円）");
      const notes = all.filter((x) => x.startsWith("前提") || x.startsWith("単位は万円") || x.startsWith("ファイナンシアで試算") || x.startsWith("通りの違い"));
      expect(notes.some((x) => x.startsWith("通りの違い"))).toBe(true);
      expect(notes.some((x) => x.includes("物価上昇率 年1%") && x.includes("運用利回り 年1%"))).toBe(true);
      expect(notes.some((x) => x.startsWith("単位は万円"))).toBe(true);
      expect(all.some((x) => x.startsWith("ファイナンシアで試算（2026年10月時点の入力による試算"))).toBe(true);
      // 開き・閉じのそろった1つの SVG（PNG にするときに読めないと困る）
      expect((out.svg.match(/<text/g) ?? []).length).toBe((out.svg.match(/<\/text>/g) ?? []).length);
      expect(out.svg.trimEnd().endsWith("</svg>")).toBe(true);
      expect(out.alt).toContain("A（今のまま）");
    });
  }

  it("通りごとの線と、線の右端の通りの文字（色だけに頼らない）", () => {
    const out = draw(args("assets"));
    expect([...out.svg.matchAll(/data-line="([A-Z])"/g)].map((m) => m[1])).toEqual(["A", "B", "C"]);
    expect([...out.svg.matchAll(/data-end="([A-Z])"/g)].map((m) => m[1])).toEqual(["A", "B", "C"]);
    // 画面と同じ線の色（現状の青灰・青・橙）
    expect(out.svg).toContain('stroke="#4c5563"');
    expect(out.svg).toContain('stroke="#0072c6"');
    expect(out.svg).toContain('stroke="#d95f02"');
    // 0未満の範囲は言葉でも示す
    expect(texts(out.svg)).toContain("↓ 0未満は不足");
    // 年の目盛りと本人の年齢
    expect(texts(out.svg)).toContain("2030");
    expect(texts(out.svg)).toContain("ご本人");
  });

  it("暗い地では画面の暗い画面と同じ色", () => {
    const out = draw(args("assets", { theme: "dark" }));
    expect(out.svg).toContain('fill="#1f2329"');
    expect(out.svg).toContain('stroke="#4aa3ec"');
    expect(out.svg).not.toContain('stroke="#0072c6"');
  });

  it("返済額は返し終える年まで、棒は数字ごとに通りを並べて万円を書く", () => {
    const r = draw(args("repayment"));
    expect(texts(r.svg)).not.toContain("2055");
    const b = draw(args("keyFigures", { figures: ["loanRepayment", "assetsAtAge"] }));
    expect([...b.svg.matchAll(/data-bar="([a-zA-Z]+):([A-Z])"/g)].map((m) => `${m[1]}:${m[2]}`)).toEqual(["loanRepayment:A", "loanRepayment:B", "loanRepayment:C", "assetsAtAge:A", "assetsAtAge:B", "assetsAtAge:C"]);
    expect(texts(b.svg)).toContain("2,550");
    expect(texts(b.svg)).toContain("▲1,786");
    expect(texts(b.svg)).toContain("95歳時点の金融資産");
  });

  it("題は渡した物、長ければ折り返す。返済の無い世帯の返済額のグラフは作らない", () => {
    expect(draw(args("assets", { title: "変動金利の上がり方で比べた金融資産" })).title).toBe("変動金利の上がり方で比べた金融資産");
    const long = draw(args("assets", { title: "あ".repeat(60) }));
    expect(texts(long.svg).filter((x) => x.startsWith("あ")).length).toBeGreaterThan(1);
    const none = draw({ ...args("repayment"), variants: three.map((x) => ({ ...x, series: x.series.map((p) => ({ ...p, loanRepayment: 0 })) })) });
    expect(none.status).toBe("invalid");
    expect(draw({ ...args("assets"), kind: "pie" as never }).status).toBe("invalid");
  });

  it("名前・ID は受け取らないので描かない（通りの名前と数字と本人の年齢だけ）", () => {
    const out = draw(args("assets"));
    expect(out.svg).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/);
    expect(texts(out.svg).filter((x) => /配偶者|第1子/.test(x))).toEqual([]);
  });

  it("前提の注: 通りで違えば通りごと、相場の想定も書く", () => {
    const n = chartNotes({ ...args("assets"), variants: [three[0]!, { ...three[1]!, assumptions: { inflation: { default: "0.02" } }, stress: "退職の直後に株などが下がる" }] });
    expect(n.find((x) => x.startsWith("前提"))).toBe("前提　A: 物価上昇率 年1%・運用利回り 年1%（資産ごとの指定が無いもの）／B: 物価上昇率 年2%");
    expect(n).toContain("相場などの想定　B: 退職の直後に株などが下がる");
    expect(n.find((x) => x.startsWith("通りの違い"))).toContain("A: 金利の見込み（変動金利） 今の金利のまま");
  });

  it("文字の幅の目安と折り返し", () => {
    expect(textWidth("あa", 10)).toBeCloseTo(15.6);
    expect(wrap("あいう・えお", 10, 40)).toEqual(["あいう・", "えお"]);
  });
});
