// 見本の PDF（report-pdf のコマンド）: PDF ができる・文字を抜き出すと主要な数字がエンジンの出力と一致する（0009 の「テストで確かめること」）。
// report-pdf をビルドしていなければ飛ばす（CI では REPORT_PDF_REQUIRED=1 で必須にする）
import { describe, expect, it } from "vitest";
import { buildProposalInput } from "../src/build.ts";
import type { ProposalInput, ReportLayout } from "../src/input.ts";
import { renderAndExtract, reportPdfBin, sampleFrame } from "../scripts/reportPdf.ts";
import { SAMPLES } from "../scripts/sampleBundles.ts";
import { byYear, man, normalize, ROWS, UUID, yenText } from "./helpers.ts";

const bin = reportPdfBin();
if (bin === null && process.env.REPORT_PDF_REQUIRED === "1") throw new Error("report-pdf がありません（cargo build --release -p report-pdf）");

/** ページの文字を空白で区切った並び */
const tokens = (s: string): string[] => s.split(/\s+/).filter((t) => t !== "");

const withLayout = (input: ProposalInput, layout: ReportLayout): ProposalInput => ({ ...input, layout });

/** meta.json の各ページの大きさから向き（L・P）を並べる */
const orientations = (r: { meta: { sizes: [number, number][] } }): string => r.meta.sizes.map(([w, h]) => (w > h ? "L" : "P")).join("");

describe.skipIf(bin === null)("見本の PDF", () => {
  for (const s of SAMPLES) {
    describe(s.id, () => {
      const bundle = s.bundle();
      const input = buildProposalInput(bundle);
      const frame = sampleFrame(bundle, input);
      const r = renderAndExtract(bin as string, input, frame);
      const all = normalize(r.pages.join("\n"));

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
        const fee = bundle.proposal.result.summary.advisoryFee?.total as number;
        expect(all).toContain(`累計は${yenText(fee)}`);
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
