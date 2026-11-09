// pdf.js の計算の側（worker のまとめた JS）。画面と同じ所で動かす（CSP の worker-src 'none' のため、別の worker を作らない。0191）
declare module "pdfjs-dist/build/pdf.worker.mjs" {
  export const WorkerMessageHandler: unknown;
}
