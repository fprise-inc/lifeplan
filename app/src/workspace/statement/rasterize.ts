// 画像だけの PDF（スキャンした明細など）のページを、文字認識に渡す画像（PNG）にする（0034 の段階3）。描くのは pdf.js（受け取った書類の表示と同じ部品。
// worker を作らず、外へ通信しない）。描いた画像はパネルの中で読むときだけ持ち、どこにも保存しない
import { openPdf } from "../hearing/pdfPages.ts";

/** 描く細かさ（1インチあたりの点。字の高さが文字認識に足りるように 200） */
const DPI = 200;
/** 描く画像の長い辺の上限（画素）。文字認識の上限（10MB）を超えないように */
const MAX_SIDE = 3200;
/** 文字認識に渡す画像の大きさの上限（本体の statement_ocr と同じ 10MB） */
const MAX_BYTES = 10 * 1024 * 1024;

async function canvasBytes(canvas: HTMLCanvasElement): Promise<Uint8Array> {
  const blob = (type: string, q?: number) => new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, q));
  const png = await blob("image/png");
  if (png !== null && png.size <= MAX_BYTES) return new Uint8Array(await png.arrayBuffer());
  // 大きすぎる PNG は JPEG にする（スキャンの写真のような絵で PNG が大きくなるとき）
  const jpg = await blob("image/jpeg", 0.92);
  if (jpg === null) throw new Error("E_RASTERIZE");
  return new Uint8Array(await jpg.arrayBuffer());
}

/** PDF の最初の maxPages ページを画像にする（total は全部のページの数） */
export async function rasterizePdf(pdf: Uint8Array, maxPages: number): Promise<{ pages: Uint8Array[]; total: number }> {
  const doc = await openPdf(pdf);
  try {
    const pages: Uint8Array[] = [];
    const canvas = document.createElement("canvas");
    for (let n = 1; n <= Math.min(doc.pages, maxPages); n++) {
      const size = await doc.size(n, 0);
      const scale = Math.min(DPI / 72, MAX_SIDE / Math.max(1, size.width, size.height));
      const drawn = await doc.render(canvas, n, scale, 0);
      if (drawn === null) throw new Error("E_RASTERIZE");
      pages.push(await canvasBytes(canvas));
    }
    canvas.width = 0;
    canvas.height = 0;
    return { pages, total: doc.pages };
  } finally {
    doc.destroy();
  }
}

/** JPEG の EXIF の向き（1〜8。無ければ 1） */
export function jpegOrientation(b: Uint8Array): number {
  try {
    return readOrientation(b);
  } catch {
    return 1;
  }
}

function readOrientation(b: Uint8Array): number {
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  let i = 2;
  while (i + 4 < b.length && b[i] === 0xff) {
    const marker = b[i + 1] as number;
    const len = dv.getUint16(i + 2);
    if (marker === 0xe1 && String.fromCharCode(...b.subarray(i + 4, i + 10)) === "Exif\u0000\u0000") {
      const t = i + 10;
      const le = b[t] === 0x49;
      const u16 = (o: number) => dv.getUint16(t + o, le);
      const ifd = dv.getUint32(t + 4, le);
      const n = u16(ifd);
      for (let k = 0; k < n; k++) {
        const e = ifd + 2 + k * 12;
        if (t + e + 10 > b.length) break;
        if (u16(e) === 0x0112) return u16(e + 8);
      }
      return 1;
    }
    if (marker === 0xda) break;
    i += 2 + len;
  }
  return 1;
}

/** 文字認識に渡す前の画像の長い辺の上限（画素） */
const OCR_SIDE = 4096;

/**
 * 写真の向きをそろえてから文字認識に渡す（向きの印のある JPEG・HEIC・TIFF は、画面で向きを直した絵に描き直す。スクショ〔PNG〕はそのまま）。
 * 描けない画像はそのまま渡す（OS の文字認識が読む）
 */
export async function prepareImage(bytes: Uint8Array): Promise<Uint8Array> {
  const png = bytes[0] === 0x89 && bytes[1] === 0x50;
  const jpeg = bytes[0] === 0xff && bytes[1] === 0xd8;
  const gifOrBmp = (bytes[0] === 0x47 && bytes[1] === 0x49) || (bytes[0] === 0x42 && bytes[1] === 0x4d);
  if (png || gifOrBmp || (jpeg && jpegOrientation(bytes) <= 1)) return bytes;
  try {
    const bmp = await createImageBitmap(new Blob([bytes as Uint8Array<ArrayBuffer>]), { imageOrientation: "from-image" });
    const scale = Math.min(1, OCR_SIDE / Math.max(bmp.width, bmp.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bmp.width * scale));
    canvas.height = Math.max(1, Math.round(bmp.height * scale));
    canvas.getContext("2d")?.drawImage(bmp, 0, 0, canvas.width, canvas.height);
    bmp.close();
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.92));
    canvas.width = 0;
    canvas.height = 0;
    return blob === null || blob.size > MAX_BYTES ? bytes : new Uint8Array(await blob.arrayBuffer());
  } catch {
    return bytes;
  }
}
