// 見本の PDF（report-pdf のコマンド）: PDF ができる・文字を抜き出すと主要な数字がエンジンの出力と一致する（0009 の「テストで確かめること」）。
// report-pdf をビルドしていなければ飛ばす（CI では REPORT_PDF_REQUIRED=1 で必須にする）
import { describe, expect, it } from "vitest";
import { buildProposalInput } from "../src/build.ts";
import { renderAndExtract, reportPdfBin, sampleFrame } from "../scripts/reportPdf.ts";
import { SAMPLES } from "../scripts/sampleBundles.ts";
import { byYear, man, normalize, ROWS, UUID, yenText } from "./helpers.ts";

const bin = reportPdfBin();
if (bin === null && process.env.REPORT_PDF_REQUIRED === "1") throw new Error("report-pdf がありません（cargo build --release -p report-pdf）");

/** ページの文字を空白で区切った並び */
const tokens = (s: string): string[] => s.split(/\s+/).filter((t) => t !== "");

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

      it("キャッシュフロー表の合計の行が、エンジンの出力（万円に四捨五入）と一致する", () => {
        const years = input.basis.years;
        let checked = 0;
        for (const [side, run] of [["現状", bundle.current], ["提案", bundle.proposal]] as const) {
          for (const page of r.pages) {
            const m = /キャッシュフロー表（(現状|提案)）(\d{4})〜(\d{4})年/.exec(normalize(page));
            if (m === null || m[1] !== side) continue;
            const from = Number(m[2]);
            const to = Number(m[3]);
            const ys = years.filter((y) => y >= from && y <= to);
            const ts = tokens(page);
            for (const [label, pred] of Object.entries(ROWS)) {
              const want = byYear(run.result, pred);
              const expected = ys.filter((y) => want.has(y)).map((y) => man(want.get(y) as number));
              const at = ts.indexOf(label);
              expect(at, `${side} ${from}〜${to} ${label}`).toBeGreaterThanOrEqual(0);
              expect(ts.slice(at + 1, at + 1 + expected.length), `${side} ${from}〜${to} ${label}`).toEqual(expected);
              checked++;
            }
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
