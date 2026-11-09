// 受け取った書類の PDF を、ページごとに絵にしてキャンバスに描く（0191）。pdf.js（Apache-2.0）を、開くときにだけ読み込む。
// - 画面の CSP（worker-src 'none'・script-src 'self'）のまま動かす: worker を作らず、計算の側を同じ所で動かす（globalThis.pdfjsWorker）。
//   eval は使わない。WebAssembly の読み手（JPEG 2000 など）は読み込まない（その形の画像は描けないことがある）
// - 文字の形（CMap・標準のフォント）は、アプリに同梱した public/pdfjs/ から読む（prepare-assets が写す。外へ通信しない）
// - 描くのはキャンバスだけ。注釈・リンク・フォーム・スクリプトの層は作らない（押せる物を出さない）
import type { PDFDocumentProxy, RenderTask } from "pdfjs-dist";

type PdfJs = typeof import("pdfjs-dist");
let lib: Promise<PdfJs> | null = null;

function load(): Promise<PdfJs> {
  lib ??= (async () => {
    const worker = await import("pdfjs-dist/build/pdf.worker.mjs");
    (globalThis as { pdfjsWorker?: unknown }).pdfjsWorker = worker;
    return await import("pdfjs-dist");
  })();
  return lib;
}

export interface PdfDoc {
  pages: number;
  /** ページ（1から）を、拡大率（1 = 72dpi の1ポイントを1画素）と回し（0・90・180・270）で描く。描いた大きさ（画素）を返す */
  render(canvas: HTMLCanvasElement, page: number, scale: number, rotation: number): Promise<{ width: number; height: number } | null>;
  /** ページの大きさ（ポイント。回しを入れた幅と高さ） */
  size(page: number, rotation: number): Promise<{ width: number; height: number }>;
  destroy(): void;
}

export async function openPdf(bytes: Uint8Array): Promise<PdfDoc> {
  const pdfjs = await load();
  const base = new URL(`${import.meta.env.BASE_URL}pdfjs/`, location.href).href;
  const loading = pdfjs.getDocument({
    data: bytes.slice(),
    cMapUrl: `${base}cmaps/`,
    cMapPacked: true,
    standardFontDataUrl: `${base}standard_fonts/`,
    enableXfa: false,
    stopAtErrors: false,
  });
  const doc: PDFDocumentProxy = await loading.promise;
  let task: RenderTask | null = null;
  return {
    pages: doc.numPages,
    async size(n, rotation) {
      const p = await doc.getPage(n);
      const v = p.getViewport({ scale: 1, rotation: (p.rotate + rotation) % 360 });
      return { width: v.width, height: v.height };
    },
    async render(canvas, n, scale, rotation) {
      task?.cancel();
      const p = await doc.getPage(n);
      const v = p.getViewport({ scale, rotation: (p.rotate + rotation) % 360 });
      canvas.width = Math.max(1, Math.floor(v.width));
      canvas.height = Math.max(1, Math.floor(v.height));
      const t = p.render({ canvas, viewport: v });
      task = t;
      try {
        await t.promise;
      } catch (e) {
        // 次の描きで止めたとき（RenderingCancelledException）は描いていない
        if (e instanceof Error && e.name === "RenderingCancelledException") return null;
        throw e;
      } finally {
        if (task === t) task = null;
      }
      return { width: canvas.width, height: canvas.height };
    },
    destroy() {
      task?.cancel();
      void loading.destroy();
    },
  };
}
