// お客さまのページで書類のファイルを送る前に整える（0125）: 形は見出しのバイトで決め（SVG・HTML などは断る）、写真はブラウザの中で縮めて
// JPEG に描き直す（撮った場所などの付いた情報〔Exif〕も落ちる）。HEIC を描けないブラウザでは、大きさの上限の中ならそのまま送る。PDF はそのまま
import { DOCUMENT_LIMITS, sniffMime, type DocumentMime } from "../../../hearing/src/web/documents.ts";

export type Prepared = { ok: true; bytes: Uint8Array<ArrayBuffer>; mime: DocumentMime } | { ok: false; reason: string };

/** 選んだファイルの大きさの上限（縮める前。大きすぎるものは読まない） */
const RAW_MAX = 40 * 1024 * 1024;

async function shrink(bytes: Uint8Array<ArrayBuffer>, mime: DocumentMime): Promise<Uint8Array<ArrayBuffer> | null> {
  if (typeof createImageBitmap !== "function" || typeof document === "undefined") return null;
  try {
    const bmp = await createImageBitmap(new Blob([bytes], { type: mime }), { imageOrientation: "from-image" });
    const side = DOCUMENT_LIMITS.photoMaxSide;
    const k = Math.min(1, side / Math.max(bmp.width, bmp.height));
    const w = Math.max(1, Math.round(bmp.width * k));
    const h = Math.max(1, Math.round(bmp.height * k));
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (ctx === null) return null;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(bmp, 0, 0, w, h);
    bmp.close();
    const blob = await new Promise<Blob | null>((ok) => canvas.toBlob(ok, "image/jpeg", 0.85));
    return blob === null ? null : new Uint8Array(await blob.arrayBuffer());
  } catch {
    return null;
  }
}

export async function prepareFile(file: Blob): Promise<Prepared> {
  if (file.size > RAW_MAX) return { ok: false, reason: "ファイルが大きすぎます（写真は撮り直すか、PDF は 10MB までにしてください）" };
  const bytes = new Uint8Array(await file.arrayBuffer());
  const mime = sniffMime(bytes);
  if (mime === null) return { ok: false, reason: "この形のファイルは送れません。写真（JPEG・PNG・HEIC）か PDF を選んでください" };
  if (mime === "application/pdf") return bytes.length <= DOCUMENT_LIMITS.fileBytes ? { ok: true, bytes, mime } : { ok: false, reason: "PDF が大きすぎます（10MB まで）" };
  const small = await shrink(bytes, mime);
  if (small !== null && sniffMime(small) === "image/jpeg") return { ok: true, bytes: small, mime: "image/jpeg" };
  return bytes.length <= DOCUMENT_LIMITS.fileBytes ? { ok: true, bytes, mime } : { ok: false, reason: "写真が大きすぎます（10MB まで）" };
}
