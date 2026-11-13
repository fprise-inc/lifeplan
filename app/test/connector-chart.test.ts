// AI接続口のグラフ（connector/chart.ts。0203）: 比較した答えの通りごとの数字から、題・凡例・単位・前提の注・試算の旨と出典の入った SVG を作ること。
// 接続口のテスト（crates/lifeplan/tests/mcp_connector.rs の chart_compares_three_rate_paths）は、本物の接続口で同じ関数を動かし、PNG にもする
import { describe, expect, it } from "vitest";
import { chart, chartNotes, EXPENSE_KEYS, INCOME_KEYS, SERIES, SERIES_KEYS, seriesTitle, textWidth, wrap, type ChartArgs, type ChartVariant } from "../src/connector/chart.ts";
import { FLOW_FIELDS } from "../src/connector/summary.ts";

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

describe("比較した答えのグラフ", () => {
  for (const kind of ["assets", "repayment", "keyFigures"] as const) {
    it(`${kind}: 題・凡例・単位・前提の注・試算の旨と出典が入る`, () => {
      const out = draw(args(kind));
      expect(out.status).toBe("ok");
      const all = texts(out.svg);
      expect(out.svg).toMatch(/^<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg"/);
      expect(out.svg).toContain(`<title>${out.title}</title>`);
      expect(all[0]).toBe(out.title);
      for (const [i, l] of ["今のまま", "10年で+1%", "10年で+2%"].entries()) expect(all).toContain(`${"ABC"[i]}\u3000${l}`);
      expect(all).toContain("（万円）");
      const notes = all.filter((x) => x.startsWith("前提") || x.startsWith("単位は万円") || x.startsWith("通りの違い"));
      expect(notes.some((x) => x.startsWith("通りの違い"))).toBe(true);
      expect(notes.some((x) => x.includes("物価上昇率 年1%") && x.includes("運用利回り 年1%"))).toBe(true);
      expect(notes.some((x) => x.startsWith("単位は万円"))).toBe(true);
      // 出典は既定では入れない。試算の時点・将来を約束しない旨・相場の想定はいつも入る（0207）
      expect(all.some((x) => x.includes("ファイナンシアで試算"))).toBe(false);
      expect(all.some((x) => x.startsWith("2026年10月時点の入力による試算で、将来の結果を約束するものではありません"))).toBe(true);
      expect(all.some((x) => x.startsWith("相場などの想定"))).toBe(true);
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
    expect(draw(args("assets", { title: "変動金利の上がり方で比較した金融資産" })).title).toBe("変動金利の上がり方で比較した金融資産");
    const long = draw(args("assets", { title: "あ".repeat(60) }));
    expect(texts(long.svg).filter((x) => x.startsWith("あ")).length).toBeGreaterThan(1);
    const none = draw({ ...args("repayment"), variants: three.map((x) => ({ ...x, series: x.series.map((p) => ({ ...p, loanRepayment: 0 })) })) });
    expect(none.status).toBe("invalid");
    expect(draw({ ...args("assets"), kind: "pie" as never }).status).toBe("invalid");
  });

  it("住宅ローンの利息の推移（万円）と金利の推移（%）（0205）", () => {
    const withLoan = three.map((x, k) => ({
      ...x,
      series: x.series.map((p) => ({ ...p, ...(p.year <= 2050 ? { loanInterest: 150_000 + k * 50_000, loanRate: p.year < 2031 ? "0.0065" : k === 0 ? "0.0065" : k === 1 ? "0.011" : "0.016" } : {}) })),
      keyFigures: { ...x.keyFigures, loanInterest: 3_000_000 + k * 1_000_000 },
    }));
    const i = draw({ ...args("interest"), variants: withLoan });
    expect(i.status).toBe("ok");
    expect(i.title).toBe("住宅ローンの利息の推移の比較（年額）");
    expect(texts(i.svg)).toContain("（万円）");
    expect(texts(i.svg)).not.toContain("2055");
    expect(texts(i.svg).some((x) => x.startsWith("単位は万円（年額。返済のうち利息に充てた額"))).toBe(true);
    expect(i.alt).toContain("住宅ローンの利息の合計400万円");
    const r = draw({ ...args("rate"), variants: withLoan });
    expect(r.status).toBe("ok");
    expect(texts(r.svg)).toContain("（%）");
    // 縦の目盛りは % の数（0〜1.6% を 0.5% ごと）
    expect(texts(r.svg)).toContain("0.5");
    expect(texts(r.svg)).toContain("1.5");
    expect([...r.svg.matchAll(/data-line="([A-Z])"/g)].map((m) => m[1])).toEqual(["A", "B", "C"]);
    expect(texts(r.svg).some((x) => x.startsWith("単位は%"))).toBe(true);
    // 棒の数字に利息の合計
    const b = draw({ ...args("keyFigures", { figures: ["loanInterest"] }), variants: withLoan });
    expect(texts(b.svg)).toContain("住宅ローンの利息の合計");
    expect(texts(b.svg)).toContain("500");
    // 金利が1つに決まらない（null の）通りしか無ければ描かない
    expect(draw(args("rate")).status).toBe("invalid");
  });

  it("名前・ID は受け取らないので描かない（通りの名前と数字と本人の年齢だけ）", () => {
    const out = draw(args("assets"));
    expect(out.svg).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/);
    expect(texts(out.svg).filter((x) => /配偶者|第1子/.test(x))).toEqual([]);
  });

  it("前提の注: 通りで違えば通りごと、相場の想定も書く", () => {
    const n = chartNotes({ ...args("assets"), variants: [three[0]!, { ...three[1]!, assumptions: { inflation: { default: "0.02" } }, stress: "退職の直後に株などが下がる" }] });
    expect(n.find((x) => x.startsWith("前提"))).toBe("前提\u3000A: 物価上昇率 年1%・運用利回り 年1%（資産ごとの指定が無いもの）／B: 物価上昇率 年2%");
    expect(n).toContain("相場などの想定\u3000B: 退職の直後に株などが下がる");
    expect(n.find((x) => x.startsWith("通りの違い"))).toContain("A: 金利の見込み（変動金利） 今の金利のまま");
  });

  it("credit を true にしたときだけ「ファイナンシアで試算」の出典を入れる（0207）", () => {
    const on = texts(draw(args("assets", { credit: true })).svg);
    expect(on.some((x) => x.startsWith("ファイナンシアで試算（2026年10月時点の入力による試算で、将来の結果を約束するものではありません）"))).toBe(true);
    const off = chartNotes(args("assets"));
    expect(off.at(-1)).toBe("2026年10月時点の入力による試算で、将来の結果を約束するものではありません。");
    // 相場の想定を重ねていなければその旨、物価を省いた入力は 0%
    expect(off).toContain("相場などの想定\u3000相場の下落などは重ねていない（運用利回りのとおりに計算）");
    const noInfl = chartNotes({ ...args("assets"), variants: three.map((x) => ({ ...x, assumptions: { investmentReturn: { default: "0.03" } } })) });
    expect(noInfl.find((x) => x.startsWith("前提"))).toBe("前提\u3000物価上昇率 年0%・運用利回り 年3%（資産ごとの指定が無いもの）");
  });

  it("比較の道具のどの系列も折れ線にできる（series と field。0207）", () => {
    // 系列の名前は接続口の年ごとの数字と同じ（支出の内訳は summary.ts の FLOW_FIELDS と同じ並び）
    expect(FLOW_FIELDS.filter((k) => k.startsWith("expense"))).toEqual(EXPENSE_KEYS);
    expect(FLOW_FIELDS.filter((k) => k.startsWith("income"))).toEqual(INCOME_KEYS);
    for (const k of FLOW_FIELDS) expect(SERIES_KEYS).toContain(k);
    const withFlows = three.map((x, k) => ({
      ...x,
      series: x.series.map((p, i) => ({ ...p, net: (5 - i) * 300_000 * (k + 1), expenseEducation: p.year <= 2040 ? 1_000_000 + k * 500_000 : 0, takeHome: 6_000_000 })),
    }));
    const net = draw({ ...args("series"), field: "net", variants: withFlows });
    expect(net.status).toBe("ok");
    expect(net.title).toBe("年間収支の推移の比較（年額）");
    expect(net.svg).toContain('data-field="net"');
    expect(texts(net.svg)).toContain("↓ 0未満は赤字");
    expect(texts(net.svg).some((x) => x.startsWith("単位は万円（年額。収入 − 税・社会保険料 − 支出"))).toBe(true);
    const edu = draw({ ...args("series"), field: "expenseEducation", variants: withFlows });
    expect(edu.title).toBe(seriesTitle("expenseEducation"));
    // 教育費が無くなった後の年は描かない
    expect(texts(edu.svg)).not.toContain("2045");
    expect([...edu.svg.matchAll(/data-line="([A-Z])"/g)].map((m) => m[1])).toEqual(["A", "B", "C"]);
    // 値の無い系列・名前の違う系列は描かない
    expect(draw({ ...args("series"), field: "expenseCar", variants: withFlows }).status).toBe("invalid");
    expect(draw({ ...args("series"), field: "nope" as never }).status).toBe("invalid");
    // どの系列にも題と単位の言葉がある
    for (const k of SERIES_KEYS) expect(SERIES[k].title).not.toBe("");
  });

  it("支出の内訳は、表の期間の合計を通りごとの横の棒で並べる（0207）", () => {
    const withFlows = three.map((x, k) => ({
      ...x,
      series: x.series.map((p) => ({ ...p, expenseLiving: 3_000_000, expenseHousing: 1_200_000, expenseEducation: p.year <= 2040 ? 1_000_000 + k * 500_000 : 0, expenseCar: 0 })),
    }));
    const out = draw({ ...args("expenseBreakdown"), variants: withFlows });
    expect(out.status).toBe("ok");
    expect(out.title).toBe("支出の内訳の比較（表の期間の合計）");
    const bars = [...out.svg.matchAll(/data-bar="([a-zA-Z]+):([A-Z])"/g)].map((m) => `${m[1]}:${m[2]}`);
    // 0 の内訳（車）は出さない
    expect(bars).toEqual(["expenseLiving:A", "expenseLiving:B", "expenseLiving:C", "expenseHousing:A", "expenseHousing:B", "expenseHousing:C", "expenseEducation:A", "expenseEducation:B", "expenseEducation:C"]);
    // 教育費の合計（14年 × 100万・150万・200万）
    expect(texts(out.svg)).toContain("1,400");
    expect(texts(out.svg)).toContain("2,800");
    expect(texts(out.svg)).toContain("教育費");
    expect(out.alt).toContain("C（10年で+2%）: 生活費9,000万円・住居費（ローン・税・修繕）3,600万円・教育費2,800万円");
    expect(texts(out.svg).some((x) => x.startsWith("単位は万円（表の期間の合計"))).toBe(true);
    // 内訳の無い通りしか無ければ描かない
    expect(draw(args("expenseBreakdown")).status).toBe("invalid");
  });

  it("文字の幅の目安と折り返し", () => {
    expect(textWidth("あa", 10)).toBeCloseTo(15.6);
    expect(wrap("あいう・えお", 10, 40)).toEqual(["あいう・", "えお"]);
  });
});
