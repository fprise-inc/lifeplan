// 見本の PDF（report-pdf のコマンド）: PDF ができる・文字を抜き出すと主要な数字がエンジンの出力と一致する（0009 の「テストで確かめること」）。
// report-pdf をビルドしていなければ飛ばす（CI では REPORT_PDF_REQUIRED=1 で必須にする）
import { describe, expect, it } from "vitest";
import { buildProposalInput } from "../src/build.ts";
import type { ProposalInput, ReportLayout, ScenarioView } from "../src/input.ts";
import { exampleReport, type RenderResult, renderAndExtract, reportPdfBin, sampleFrame } from "../scripts/reportPdf.ts";
import { SAMPLES } from "../scripts/sampleBundles.ts";
import { byYear, man, normalize, ROWS, UUID, yenText } from "./helpers.ts";

const bin = reportPdfBin();
if (bin === null && process.env.REPORT_PDF_REQUIRED === "1") throw new Error("report-pdf がありません（cargo build --release -p report-pdf）");

/** ページの文字を空白で区切った並び */
const tokens = (s: string): string[] => s.split(/\s+/).filter((t) => t !== "");

const withLayout = (input: ProposalInput, layout: ReportLayout): ProposalInput => ({ ...input, layout });

/** meta.json の各ページの大きさから向き（L・P）を並べる */
const orientations = (r: { meta: { sizes: [number, number][] } }): string => r.meta.sizes.map(([w, h]) => (w > h ? "L" : "P")).join("");

/** 資産の推移の図の「!」（図の下の説明に出す文）。帳票の側（layout.typ の plan-shorts）と同じ決め方 */
const shortsOf = (input: ProposalInput): string[] => [
  ...(input.summary.proposal.depletion !== null ? [`提案 ${input.summary.proposal.depletion.label}`] : []),
  ...(input.summary.current.depletion !== null ? [`現状 ${input.summary.current.depletion.label}`] : []),
];
/** 万一のときの図の「!」（万一の場合と、万一なし＝提案の線） */
const contingencyShortsOf = (input: ProposalInput, sc: ScenarioView): string[] => [
  ...(sc.depletion !== null ? [`万一の場合 ${sc.depletion.label}`] : []),
  ...(input.summary.proposal.depletion !== null ? [`万一なし ${input.summary.proposal.depletion.label}`] : []),
];
/** ページの「!」が、段の丸と図の下の説明の丸で、印の数の2倍だけある。説明の一行は印があるときだけ。以前の「提案 不足」の札は無い */
function expectShorts(page: string, labels: string[]): void {
  const t = normalize(page);
  expect(tokens(page).filter((x) => x === "!").length).toBe(labels.length * 2);
  if (labels.length === 0) expect(t).not.toContain(normalize("金融資産が足りなくなる年"));
  else expect(t).toContain(normalize(`金融資産が足りなくなる年 ! ${labels.join(" ! ")}`));
  // 以前の札（「提案 不足」「現状 不足」）。要約の札の「現状 不足しない」は別の文
  expect(t).not.toMatch(/(提案|現状)不足(?!しない)/);
}

describe.skipIf(bin === null)("見本の PDF", () => {
  for (const s of SAMPLES) {
    describe(s.id, () => {
      const bundle = s.bundle();
      const input = buildProposalInput(bundle);
      const frame = sampleFrame(bundle, input);
      const r = renderAndExtract(bin as string, input, frame);
      const all = normalize(r.pages.join("\n"));

      it("お金の3つの分け方の章（0032）: 3つの箱の名前と額（万円）、中身の一文が載る。見出しは画面と同じ言葉", () => {
        const m = input.moneyThree;
        if (m == null) return;
        const page = r.pages.find((p) => normalize(p).includes(normalize("いつ使うお金か")));
        expect(page).toBeDefined();
        const t = normalize(page as string);
        // 柱の見出しは画面と同じ言葉。分け方と置き場所のずれの印・凡例の説明は載せない
        expect(t).toContain(normalize("今どこにあるか"));
        expect(t).not.toContain(normalize("ずれている"));
        expect(t).not.toContain(normalize("（説明用）"));
        for (const b of m.boxes) {
          expect(t).toContain(normalize(b.name));
          expect(t).toContain(normalize(man(b.amount)));
        }
        expect(t).toContain(normalize(m.boxes[0].formula));
      });

      it("PDF ができ、各ページに刻印がある", () => {
        expect(r.pdf.subarray(0, 5).toString()).toBe("%PDF-");
        expect(r.meta.pages).toBe(r.pages.length);
        expect(r.meta.addressee?.page).toBe(1);
        const stamp = normalize(`制度データ ${frame.stamp.dataSetLabel} ／ 計算基準日 ${frame.stamp.baseMonth}`);
        r.pages.forEach((p) => expect(normalize(p)).toContain(stamp));
        for (const n of frame.notices) expect(all).toContain(normalize(n));
      });

      it("キャッシュフロー表（要約・年を行に）の各年の合計の行が、エンジンの出力（万円に四捨五入）と一致する", () => {
        const page = r.pages.find((p) => normalize(p).includes(normalize("キャッシュフロー表（要約）")));
        expect(page).toBeDefined();
        // 4桁で区切りの無い数字が年（金額は1,000以上なら区切りが入る）。年から次の年までが1行
        const ts = tokens(page as string);
        const keys = ["収入合計", "支出合計", "年間収支", "金融資産残高"] as const;
        let checked = 0;
        for (const y of input.basis.years) {
          const at = ts.indexOf(String(y));
          expect(at, String(y)).toBeGreaterThanOrEqual(0);
          let end = at + 1;
          // 行は数字だけ（年齢と金額）。次の年・数字でない文字（刻印など）の手前まで
          while (end < ts.length && !/^\d{4}$/.test(ts[end] as string) && /^▲?[\d,]+$/.test(ts[end] as string)) end++;
          const want = [bundle.current, bundle.proposal].flatMap((run) => keys.map((k) => byYear(run.result, ROWS[k] as never).get(y)).filter((v): v is number => v !== undefined).map(man));
          expect(ts.slice(end - want.length, end), String(y)).toEqual(want);
          checked++;
        }
        expect(checked).toBe(input.basis.years.length);
      });

      it("キャッシュフロー表（全部の行・横）の合計の行が、エンジンの出力（万円に四捨五入）と一致する", () => {
        const wide = renderAndExtract(bin as string, withLayout(input, { orientation: "landscape", cashflow: "full" }), frame);
        const years = input.basis.years;
        let checked = 0;
        for (const [side, run] of [["現状", bundle.current], ["提案", bundle.proposal]] as const) {
          for (const page of wide.pages) {
            // 1ページに年のかたまりの表が2つ入ることがある。見出し（表（現状） 2027〜2045 年）ごとに読む
            const ts = tokens(page);
            ts.forEach((t, i) => {
              const m = /^表（(現状|提案)）$/.exec(t);
              const span = /^(\d{4})〜(\d{4})$/.exec(ts[i + 1] ?? "");
              if (m === null || span === null || m[1] !== side) return;
              const from = Number(span[1]);
              const to = Number(span[2]);
              const ys = years.filter((y) => y >= from && y <= to);
              for (const [label, pred] of Object.entries(ROWS)) {
                const want = byYear(run.result, pred);
                const expected = ys.filter((y) => want.has(y)).map((y) => man(want.get(y) as number));
                const at = ts.indexOf(label, i);
                expect(at, `${side} ${from}〜${to} ${label}`).toBeGreaterThanOrEqual(0);
                expect(ts.slice(at + 1, at + 1 + expected.length), `${side} ${from}〜${to} ${label}`).toEqual(expected);
                checked++;
              }
            });
          }
        }
        expect(checked).toBeGreaterThanOrEqual(8);
      });

      it("要約の数字（目標の年の金融資産・FP顧問料の累計）がエンジンの出力と一致する", () => {
        const fin = byYear(bundle.proposal.result, ROWS.金融資産残高 as never).get(input.summary.target.year) as number;
        expect(all).toContain(`${man(fin)}万円`);
        // FP顧問料の累計は、顧問料の契約がある見本だけ（資産運用の見本は持たない）
        const fee = bundle.proposal.result.summary.advisoryFee?.total;
        if (fee !== undefined) expect(all).toContain(`累計は${yenText(fee)}`);
      });

      it("提案での変更点の章には FP顧問料の累計を出さない（顧問料込みの効果の一文だけ）", () => {
        const page = r.pages.find((p) => normalize(p).includes(normalize("提案での変更点")) && normalize(p).includes(normalize("FP顧問料込みの効果")));
        if (page === undefined) return;
        expect(normalize(page)).not.toContain(normalize("FP顧問料の累計"));
        expect(normalize(page)).not.toMatch(/までの累計/);
        expect(normalize(page)).toContain(normalize("FP顧問料を払っても"));
      });

      it("運用の期間の帯: 積立額の段の額がすべて文字として出る（箱に入らない段は帯の下の凡例に年といっしょに出す）", () => {
        const periods = bundle.investment?.periods;
        if (periods === undefined) return;
        const page = r.pages.find((p) => normalize(p).includes(normalize("運用の期間")));
        expect(page).toBeDefined();
        const text = normalize(page as string);
        for (const st of periods.steps) expect(text, st.label).toContain(normalize(st.label));
        // 凡例に出すときは、段の始まりの年も書く
        if (text.includes(normalize("積み立てる額"))) for (const st of periods.steps) expect(text).toContain(normalize(`${st.year}年〜`));
      });

      it("資産の推移の図（世帯サマリー・資産残高の推移・万一のとき）: 足りなくなる年に「!」が出て、図の下に年の説明が出る。足りなくならなければ出ない。「不足」の札は出さない", () => {
        const plan = shortsOf(input);
        // 世帯サマリーのページ（表の期間の合計の表といっしょ）と、資産残高の推移のページ（5年ごとの表といっしょ）。目次のページは除く
        for (const head of ["表の期間の合計", "5年ごとの金融資産残高"]) {
          const page = r.pages.find((p) => normalize(p).includes(normalize(head)));
          expect(page, head).toBeDefined();
          expectShorts(page as string, plan);
        }
        for (const sc of input.contingency?.scenarios ?? []) {
          const page = r.pages.find((p) => normalize(p).includes(normalize(sc.title)) && normalize(p).includes(normalize("万一が無い場合（提案）")));
          expect(page, sc.title).toBeDefined();
          expectShorts(page as string, contingencyShortsOf(input, sc));
        }
      });

      it("PDF の文字に内部 ID・提供元の名前が入らない", () => {
        expect(all).not.toMatch(UUID);
        for (const bad of ["ファイナンシア", "Financia", "FPライズ", "FPRISE"]) expect(all).not.toContain(bad);
      });
    });
  }
});

describe.skipIf(bin === null)("章を選んだ PDF とプランの比較のページ", () => {
  const s = SAMPLES[0] as (typeof SAMPLES)[number];
  const bundle = s.bundle();
  const input = buildProposalInput(bundle);
  const frame = sampleFrame(bundle, input);

  it("すべての章: プランの比較のページが入り、数字が帳票の入力と同じ", () => {
    const r = renderAndExtract(bin as string, input, frame);
    const all = normalize(r.pages.join("\n"));
    expect(all).toContain(normalize("プランの比較"));
    const target = input.comparison?.rows.find((x) => x.key === "target");
    for (const v of target?.values ?? []) expect(all).toContain(normalize(`${man(v as number)}万円`));
  });

  it("外した章は PDF に出ない（表紙と前提条件と注意書きは残る）", () => {
    const chosen = buildProposalInput({ ...bundle, chapters: ["summary", "changes"] });
    const r = renderAndExtract(bin as string, chosen, sampleFrame(bundle, chosen));
    const all = normalize(r.pages.join("\n"));
    expect(all).toContain(normalize("前提条件と注意書き"));
    expect(all).toContain(normalize("世帯サマリー"));
    expect(all).toContain(normalize("提案での変更点"));
    for (const t of ["キャッシュフロー表（現状）", "教育費の推移", "住宅ローン", "万一のとき", "プランの比較"]) expect(all, t).not.toContain(normalize(t));
    for (const n of frame.notices) expect(all).toContain(normalize(n));
    expect(r.pages.length).toBeLessThan(8);
  });
});

describe.skipIf(bin === null)("紙の向きとキャッシュフロー表の載せ方", () => {
  const s = SAMPLES[0] as (typeof SAMPLES)[number];
  const bundle = s.bundle();
  const input = buildProposalInput(bundle);
  const frame = sampleFrame(bundle, input);

  it("標準は縦にそろえる・要約。全ページが A4 縦", () => {
    expect(input.layout).toEqual({ orientation: "portrait", cashflow: "summary" });
    const r = renderAndExtract(bin as string, input, frame);
    expect(orientations(r)).toMatch(/^P+$/);
    expect(orientations(r).length).toBe(r.pages.length);
  });

  for (const cashflow of ["summary", "excerpt", "full"] as const) {
    for (const orientation of ["portrait", "landscape"] as const) {
      it(`${orientation === "portrait" ? "縦" : "横"}にそろえる・${cashflow}: 全ページの向きが同じで、刻印と必須の記載がある`, () => {
        const r = renderAndExtract(bin as string, withLayout(input, { orientation, cashflow }), frame);
        expect(orientations(r)).toMatch(orientation === "portrait" ? /^P+$/ : /^L+$/);
        const all = normalize(r.pages.join("\n"));
        for (const n of frame.notices) expect(all).toContain(normalize(n));
        expect(r.meta.addressee?.page).toBe(1);
      });
    }
  }

  it("以前の形（mixed・全年）は、キャッシュフロー表だけ A4 横", () => {
    const r = renderAndExtract(bin as string, withLayout(input, { orientation: "mixed", cashflow: "full" }), frame);
    const o = orientations(r);
    expect(o).toContain("L");
    expect(o).toContain("P");
    r.pages.forEach((p, i) => {
      if (o[i] === "L") expect(normalize(p)).toMatch(/キャッシュフロー表/);
    });
  });

  it("要約は全年・全部の行よりページが少ない", () => {
    const summary = renderAndExtract(bin as string, withLayout(input, { orientation: "portrait", cashflow: "summary" }), frame);
    const full = renderAndExtract(bin as string, withLayout(input, { orientation: "portrait", cashflow: "full" }), frame);
    expect(summary.pages.length).toBeLessThan(full.pages.length);
  });
});

describe.skipIf(bin === null)("バランスシートの図の時点（画面で並べている時点）", () => {
  const s = SAMPLES.find((x) => x.id === "dualAssetsTwoKids") as (typeof SAMPLES)[number];
  const bundle = s.bundle();
  const base = Number(bundle.proposal.request.input.baseMonth.slice(0, 4));
  const self = bundle.proposal.request.input.household.members.find((m) => m.kind === "self");
  const birthY = Number(self?.birth.birthYearMonth.slice(0, 4));
  const pageOf = (pages: string[]) => pages.map(normalize).find((p) => p.includes(normalize("バランスシートの図（提案。")));

  it("並べ方を変えていない世帯: 今・退職の年・75歳の3つ", () => {
    const input = buildProposalInput(bundle);
    const page = pageOf(renderAndExtract(bin as string, input, sampleFrame(bundle, input)).pages);
    expect(page).toContain(normalize("バランスシートの図（提案。今・退職の年・75歳）"));
    expect(page).toContain(normalize("3つの時点で共通の縮尺"));
  });

  for (const orientation of ["portrait", "landscape"] as const) {
    it(`4つの時点（${orientation === "portrait" ? "縦" : "横"}）: 見出し・年・純資産がすべて図のページに出る`, () => {
      const chosen = [
        { year: base, name: "今" },
        { year: base + 8, name: "ローン完済" },
        { year: birthY + 68, name: "退職の年" },
        { year: birthY + 85, name: "85歳" },
      ];
      const input = withLayout(buildProposalInput({ ...bundle, balancePoints: chosen }), { orientation, cashflow: "summary" });
      const r = renderAndExtract(bin as string, input, sampleFrame(bundle, input));
      const page = pageOf(r.pages);
      expect(page).toBeDefined();
      expect(page).toContain(normalize("バランスシートの図（提案。今・ローン完済・退職の年・85歳）"));
      expect(page).toContain(normalize("4つの時点で共通の縮尺"));
      for (const c of input.balanceSheet!.figure.columns) {
        expect(page).toContain(normalize(`${c.point.year}年末`));
        expect(page).toContain(normalize(`純資産 ${man(c.netWorth)}万円`));
      }
      // 図の後の注記まで同じページに収まる
      expect(page).toContain(normalize("金融資産が尽きた後の足りない分"));
    });
  }
});

// ---- 図の線の位置（見本の SVG から取り出す）----
type Pt = [number, number];
interface SvgLine {
  stroke: string;
  dash: string | null;
  transform: string;
  pts: Pt[];
}
/** SVG の線（折れ線だけ。d の「M 0 0」の後の相対の m・l・h・v を足していく。曲線を含む線は除く） */
function svgLines(svg: string): SvgLine[] {
  const out: SvgLine[] = [];
  for (const m of svg.matchAll(/<path [^>]*>/g)) {
    const tag = m[0];
    const attr = (k: string): string | null => new RegExp(` ${k}="([^"]*)"`).exec(tag)?.[1] ?? null;
    const stroke = attr("stroke");
    const d = attr("d");
    if (stroke === null || d === null || /[^MmLlHhVv\d\s.eE+-]/.test(d)) continue;
    const pts: Pt[] = [];
    let x = 0;
    let y = 0;
    for (const c of d.matchAll(/([MmLlHhVv])([^MmLlHhVv]*)/g)) {
      const n = (c[2] as string).trim().split(/\s+/).filter((t) => t !== "").map(Number);
      const op = c[1] as string;
      if (op === "M") [x, y] = [n[0] as number, n[1] as number];
      else if (op === "m" || op === "l") [x, y] = [x + (n[0] as number), y + (n[1] as number)];
      else if (op === "h") x += n[0] as number;
      else if (op === "v") y += n[0] as number;
      else continue;
      // 最初の「M 0 0」は起点を決めるだけ
      if (op !== "M") pts.push([x, y]);
    }
    out.push({ stroke, dash: attr("stroke-dasharray"), transform: attr("transform") ?? "", pts });
  }
  return out;
}
/** 「!」の点線（赤の丸い点の並び）と、資産の推移の線（選んだプランの実線と基準のプランの破線。点の数が年の数のもの） */
function shortLines(svg: string, n: number): { dotted: SvgLine[]; solid: SvgLine; dashed: SvgLine } {
  const lines = svgLines(svg);
  const dotted = lines.filter((l) => l.stroke === "#b42318" && l.dash === "1.2 2");
  const series = lines.filter((l) => l.pts.length === n && l.transform === dotted[0]?.transform);
  const solid = series.filter((l) => l.dash === null);
  const dashed = series.filter((l) => l.dash === "3 3");
  expect(solid.length).toBe(1);
  expect(dashed.length).toBe(1);
  return { dotted, solid: solid[0] as SvgLine, dashed: dashed[0] as SvgLine };
}
/** 線が0を切る所（前の年と足りなくなる年の金額を直線で結んで0になる所）の、図の上の点。前の年が無い・前の年もマイナスのときは、その年の点の x と y: null */
function crossAt(line: SvgLine, values: readonly number[], i: number): { x: number; y: number | null } {
  const a = values[i - 1];
  const b = values[i] as number;
  const p = line.pts[i] as Pt;
  if (i <= 0 || a === undefined || a < 0 || b >= 0) return { x: p[0], y: null };
  const q = line.pts[i - 1] as Pt;
  const t = a / (a - b);
  return { x: q[0] + (p[0] - q[0]) * t, y: q[1] + (p[1] - q[1]) * t };
}
/**
 * ページの「!」の点線の上端が、線が0を切る所にある（y は、その所の線の高さ＝0の線）。
 * 点線の下の端（丸の上の端）は、近い丸を並べ直したときも、元の位置（0を切る所）の平均を中心に置く
 */
function expectShortCross(svg: string, years: readonly number[], marks: { year: number; values: readonly number[]; base: boolean }[]): void {
  const { dotted, solid, dashed } = shortLines(svg, years.length);
  expect(dotted.length).toBe(marks.length);
  const want = marks.map((m) => crossAt(m.base ? dashed : solid, m.values, years.indexOf(m.year)));
  const tops = dotted.map((l) => l.pts[0] as Pt).sort((p, q) => p[0] - q[0]);
  const sorted = [...want].sort((p, q) => p.x - q.x);
  sorted.forEach((w, k) => {
    const top = tops[k] as Pt;
    expect(top[0]).toBeCloseTo(w.x, 2);
    if (w.y !== null) expect(top[1]).toBeCloseTo(w.y, 2);
  });
  const ends = dotted.map((l) => (l.pts.at(-1) as Pt)[0]);
  const mean = (v: number[]): number => v.reduce((a, b) => a + b, 0) / v.length;
  expect(mean(ends)).toBeCloseTo(mean(want.map((w) => w.x)), 2);
}

describe.skipIf(bin === null)("資産が足りなくなる所の「!」（年を変えた帳票の入力）", () => {
  const s = SAMPLES.find((x) => x.id === "salariedCoupleTwoKids") as (typeof SAMPLES)[number];
  const bundle = s.bundle();
  const input = buildProposalInput(bundle);
  const years = input.basis.years;
  const render = (x: ProposalInput) => renderAndExtract(bin as string, x, sampleFrame(bundle, x), { svg: true });
  const pageOf = (r: RenderResult, head: string): number => r.pages.findIndex((p) => normalize(p).includes(normalize(head)));
  const summaryPage = (x: ProposalInput) => {
    const r = renderAndExtract(bin as string, x, sampleFrame(bundle, x));
    return r.pages.find((p) => normalize(p).includes(normalize("表の期間の合計"))) as string;
  };
  /** 資産の推移の図の「!」（帳票の側の plan-shorts と同じ） */
  const planMarks = (x: ProposalInput) => [
    ...(x.summary.current.depletion !== null ? [{ year: x.summary.current.depletion.year, values: x.assets.current, base: true }] : []),
    ...(x.summary.proposal.depletion !== null ? [{ year: x.summary.proposal.depletion.year, values: x.assets.proposal, base: false }] : []),
  ];

  it("点線の上端と丸の基準の横の位置は、線が0を切る所（前の年と足りなくなる年の金額を結んだ直線が0になる所）。足りなくなる年の目盛りの位置ではない", () => {
    const r = render(input);
    const svgs = r.svgs as string[];
    for (const head of ["表の期間の合計", "5年ごとの金融資産残高"]) {
      const k = pageOf(r, head);
      expect(k, head).toBeGreaterThanOrEqual(0);
      expectShortCross(svgs[k] as string, years, planMarks(input));
    }
    // 見本では0を切る所が足りなくなる年の目盛りより左にある（前の年はまだプラス）
    for (const m of planMarks(input)) {
      const i = years.indexOf(m.year);
      expect(m.values[i - 1] as number).toBeGreaterThan(0);
    }
    for (const sc of input.contingency?.scenarios ?? []) {
      const k = r.pages.findIndex((p) => normalize(p).includes(normalize(sc.title)) && normalize(p).includes(normalize("万一が無い場合（提案）")));
      expect(k, sc.title).toBeGreaterThanOrEqual(0);
      const base = input.summary.proposal.depletion;
      expectShortCross(svgs[k] as string, years, [
        ...(base !== null ? [{ year: base.year, values: sc.withoutEvent, base: true }] : []),
        ...(sc.depletion !== null ? [{ year: sc.depletion.year, values: sc.withEvent, base: false }] : []),
      ]);
    }
  });

  it("前の年もマイナスのときは、点線をその年の位置に置く（図の下の説明の年はそのまま）", () => {
    const dep = input.summary.current.depletion as { year: number; label: string };
    const i = years.indexOf(dep.year) + 1;
    expect(input.assets.current[i - 1] as number).toBeLessThan(0);
    const later = { ...input, summary: { ...input.summary, current: { ...input.summary.current, depletion: { ...dep, year: years[i] as number } } } };
    const r = render(later);
    const k = pageOf(r, "表の期間の合計");
    expectShortCross((r.svgs as string[])[k] as string, years, planMarks(later));
    expect(normalize(r.pages[k] as string)).toContain(normalize(`現状 ${dep.label}`));
  });

  it("現状と提案が同じ年に足りなくなるときも、点線はそれぞれの線が0を切る所から下ろし、丸はその平均を中心に横に並べる", () => {
    const same = { ...input, summary: { ...input.summary, current: { ...input.summary.current, depletion: input.summary.proposal.depletion } } };
    const r = render(same);
    expectShortCross((r.svgs as string[])[pageOf(r, "表の期間の合計")] as string, years, planMarks(same));
  });

  it("見本の世帯は現状も提案も足りなくなる（以下の確かめの前提）", () => {
    expect(input.summary.current.depletion).not.toBeNull();
    expect(input.summary.proposal.depletion).not.toBeNull();
  });

  it("現状と提案が同じ年に足りなくなるときも、丸を2つ出す（横に並べる）", () => {
    const same = { ...input, summary: { ...input.summary, current: { ...input.summary.current, depletion: input.summary.proposal.depletion } } };
    expectShorts(summaryPage(same), shortsOf(same));
  });

  it("提案だけが足りなくならないときは、現状の丸（白抜き）だけを出す", () => {
    const only = { ...input, summary: { ...input.summary, proposal: { ...input.summary.proposal, depletion: null } } };
    expectShorts(summaryPage(only), [`現状 ${(input.summary.current.depletion as { label: string }).label}`]);
  });

  it("どちらも足りなくならないときは、丸も説明の一行も出さない", () => {
    const none = { ...input, summary: { ...input.summary, current: { ...input.summary.current, depletion: null }, proposal: { ...input.summary.proposal, depletion: null } } };
    expectShorts(summaryPage(none), []);
  });
});

describe.skipIf(bin === null)("独自帳票の見本: 収益不動産のまとめ（sdk/examples/reports/rental-property-summary）", () => {
  const main = exampleReport("rental-property-summary");
  const sample = (id: string) => {
    const s = SAMPLES.find((x) => x.id === id) as (typeof SAMPLES)[number];
    const bundle = s.bundle();
    const input = buildProposalInput(bundle);
    return { input, r: renderAndExtract(bin as string, input, sampleFrame(bundle, input), { main }) };
  };

  it("賃貸に出しているマンションのある世帯: 物件の見出しと、年ごとの表の数字（万円）が帳票の入力の値で載る。刻印・必須の記載はアプリが確かめる", () => {
    const { input, r } = sample("dualAssetsTwoKids");
    const all = normalize(r.pages.join("\n"));
    expect(all).toContain(normalize("収益不動産のまとめ"));
    expect(all).toContain(normalize("不動産1（ご主人名義・鉄筋コンクリート造・2008年築・貸している）"));
    expect(r.meta.noticesPageAdded).toBe(false);
    const p = input.realEstate!.proposal[0]!;
    const y = p.years.find((x) => x.held)!;
    const row = [String(y.year), man(y.rent), man(y.expenses), man(y.depreciation!), man(y.interest!), man(y.income!), man(y.loanBalance), man(y.cashAfterLoan), man(y.value!.total)].join(" ");
    expect(r.pages.some((t) => t.replace(/\s+/g, " ").includes(row))).toBe(true);
    expect(all).toContain(normalize(`手取り ${man(p.sale!.proceeds)}万円`));
    expect(r.pages.join("\n")).not.toMatch(UUID);
  });

  it("住まい以外の不動産の無い世帯: 「ありません」の1ページ", () => {
    const { r } = sample("salariedCoupleTwoKids");
    expect(r.meta.pages).toBe(1);
    expect(normalize(r.pages[0] as string)).toContain(normalize("住まい以外の不動産はありません。"));
  });
});
