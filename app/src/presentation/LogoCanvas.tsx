// 事務所のロゴ（0121。提示層の部品）: 画像のバイト（base64 の文字）をキャンバスに描く。
// img の URL（blob:・data: を含む）にしない: 画面の CSP は img-src 'self' のままにする（0016）。createImageBitmap は
// 手元のバイトを絵にするだけで、URL を読み込まない。読めない画像は何も描かず、代わりの文字（名前）を出す側に任せる（onError）
import { useEffect, useRef } from "preact/hooks";

export interface LogoImage {
  mime: string;
  width: number;
  height: number;
  /** 画像のバイト（base64 の文字） */
  data: string;
}

/** 表示の大きさ（CSS の画素）: 高さをそろえ、横に長いロゴは maxWidth までに縮める */
export function logoBox(img: { width: number; height: number }, height: number, maxWidth: number): { w: number; h: number } {
  if (img.width <= 0 || img.height <= 0) return { w: 0, h: 0 };
  const w = (height * img.width) / img.height;
  if (w <= maxWidth) return { w: Math.round(w), h: height };
  return { w: maxWidth, h: Math.round((maxWidth * img.height) / img.width) };
}

export function LogoCanvas({ logo, height, maxWidth, label, class: cls, onError }: { logo: LogoImage; height: number; maxWidth: number; label: string; class?: string; onError?: () => void }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const box = logoBox(logo, height, maxWidth);
  useEffect(() => {
    const el = ref.current;
    if (el === null || typeof createImageBitmap !== "function") return;
    let live = true;
    const dpr = Math.max(1, Math.min(3, typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1));
    void (async () => {
      try {
        const bin = atob(logo.data);
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        const bmp = await createImageBitmap(new Blob([bytes], { type: logo.mime }));
        if (!live) return bmp.close();
        el.width = Math.max(1, Math.round(box.w * dpr));
        el.height = Math.max(1, Math.round(box.h * dpr));
        const ctx = el.getContext("2d");
        if (ctx === null) return bmp.close();
        ctx.imageSmoothingQuality = "high";
        ctx.clearRect(0, 0, el.width, el.height);
        ctx.drawImage(bmp, 0, 0, el.width, el.height);
        bmp.close();
      } catch {
        if (live) onError?.();
      }
    })();
    return () => {
      live = false;
    };
  }, [logo.data, box.w, box.h]);
  return <canvas ref={ref} class={cls} role="img" aria-label={label} style={{ width: `${box.w}px`, height: `${box.h}px` }} data-logo-canvas />;
}
