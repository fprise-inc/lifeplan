// 届いた書類を見る枠（0191）: 画面の右に出し、入力のパネルを開いたまま、書類を見ながら入力項目に打てるようにする。
// - 拡大・縮小（幅に合わせる・ボタン・Ctrl＋ホイール）・回転（90度ずつ）・つかんで動かす。PDF はページごとに絵にして出す（ページ送り）
// - 書類の画像は img の URL にしない（0016）。写真はバイトを createImageBitmap で、PDF は pdf.js でキャンバスに描く
// - 開いたファイルに「見た」の印を付ける（世帯ファイルの依頼の記録。0191）
// - Esc はこの枠だけを閉じる（入力のパネルは閉じない）
import { useEffect, useRef, useState } from "preact/hooks";
import { byDocument, docLabel, sizeText, type ReceivedFile } from "./receivedDocs.ts";
import type { ReceivedDocsState } from "./ReceivedDocs.tsx";
import { openPdf, type PdfDoc } from "./pdfPages.ts";
import { fileBytes } from "./web.ts";

const STEPS = [0.25, 0.33, 0.5, 0.67, 0.75, 0.9, 1, 1.25, 1.5, 2, 3, 4];
/** キャンバスの1辺の上限（画素。大きな写真を大きく拡大しても重くなりすぎないように） */
const MAX_SIDE = 8192;

type Source = { kind: "image"; bmp: ImageBitmap } | { kind: "pdf"; pdf: PdfDoc };

const dayTime = (iso: string) => new Date(iso).toLocaleString("ja-JP", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" });

/** 書類を描く: 拡大率（1 = 写真の1画素・PDF の1ポイントを画面の1点）と回し。描いた大きさ（画面の点）を返す */
async function draw(c: HTMLCanvasElement, src: Source, scale: number, rot: number, page: number): Promise<{ w: number; h: number } | null> {
  const dpr = Math.max(1, globalThis.devicePixelRatio || 1);
  if (src.kind === "pdf") {
    const size = await src.pdf.size(page, rot);
    const s = Math.min(scale * dpr, MAX_SIDE / Math.max(size.width, size.height));
    const out = await src.pdf.render(c, page, s, rot);
    if (out === null) return null;
    const k = scale / (s / dpr);
    return { w: (out.width / dpr) * k, h: (out.height / dpr) * k };
  }
  const { bmp } = src;
  const turned = rot % 180 !== 0;
  const w = turned ? bmp.height : bmp.width;
  const h = turned ? bmp.width : bmp.height;
  const s = Math.min(scale * dpr, MAX_SIDE / Math.max(w, h));
  c.width = Math.max(1, Math.round(w * s));
  c.height = Math.max(1, Math.round(h * s));
  const ctx = c.getContext("2d");
  if (ctx === null) return null;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, c.width, c.height);
  ctx.imageSmoothingQuality = "high";
  ctx.translate(c.width / 2, c.height / 2);
  ctx.rotate((rot * Math.PI) / 180);
  ctx.drawImage(bmp, (-bmp.width * s) / 2, (-bmp.height * s) / 2, bmp.width * s, bmp.height * s);
  return { w: w * scale, h: h * scale };
}

/** 回しを入れた、拡大率 1 のときの大きさ */
async function naturalSize(src: Source, rot: number, page: number): Promise<{ w: number; h: number }> {
  if (src.kind === "pdf") {
    const s = await src.pdf.size(page, rot);
    return { w: s.width, h: s.height };
  }
  const turned = rot % 180 !== 0;
  return { w: turned ? src.bmp.height : src.bmp.width, h: turned ? src.bmp.width : src.bmp.height };
}

export function DocViewer({ rd, beside }: { rd: ReceivedDocsState; beside: boolean }) {
  const cur = rd.files.find((f) => f.file.fileId === rd.viewing) ?? null;
  const box = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const root = useRef<HTMLElement>(null);
  const [src, setSrc] = useState<{ id: string; s: Source } | null>(null);
  const [fail, setFail] = useState<string | null>(null);
  /** 拡大率（"fit" は幅に合わせる） */
  const [zoom, setZoom] = useState<number | "fit">("fit");
  const [shownScale, setShownScale] = useState(1);
  const [rot, setRot] = useState(0);
  const [page, setPage] = useState(1);
  const [width, setWidth] = useState(0);
  const id = cur?.file.fileId ?? null;
  const drag = useDrag(box);

  // 開いている間は、入力のパネルを左に寄せる（横に並べる）
  useEffect(() => {
    document.documentElement.classList.add("doc-side");
    return () => document.documentElement.classList.remove("doc-side");
  }, []);

  // 枠の幅（幅に合わせるとき描き直す）
  useEffect(() => {
    const el = box.current;
    if (el === null) return;
    // 描き直しで出たスクロールの棒で幅が少し変わっても、描き直しを繰り返さない（次の描きの前に、8点より大きく変わったときだけ）
    let frame = 0;
    const ro = new ResizeObserver(() => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => setWidth((w) => (Math.abs(w - el.clientWidth) > 8 ? el.clientWidth : w)));
    });
    ro.observe(el);
    setWidth(el.clientWidth);
    return () => {
      cancelAnimationFrame(frame);
      ro.disconnect();
    };
  }, []);

  // ファイルを読む（写真は絵に、PDF は pdf.js で開く）
  useEffect(() => {
    if (cur === null) return;
    let live = true;
    let made: Source | null = null;
    setFail(null);
    setRot(0);
    setPage(1);
    setZoom("fit");
    void (async () => {
      try {
        const bytes = fileBytes(cur.file);
        made = cur.file.mime === "application/pdf" ? { kind: "pdf", pdf: await openPdf(bytes) } : { kind: "image", bmp: await createImageBitmap(new Blob([bytes], { type: cur.file.mime })) };
        if (!live) return release(made);
        setSrc({ id: cur.file.fileId, s: made });
      } catch {
        if (live) {
          setSrc(null);
          setFail(cur.file.mime === "image/heic" ? "この画面では表示できない形です（HEIC）。「保存」して、写真のアプリで開いてください。" : "この書類を絵にできませんでした（壊れているか、対応していない形です）。「保存」して、ほかのアプリで開いてください。");
        }
      }
    })();
    return () => {
      live = false;
      if (made !== null) release(made);
    };
  }, [id]);

  // 描く（拡大・回し・ページ・枠の幅が変わったとき）
  useEffect(() => {
    const c = canvas.current;
    if (src === null || c === null || src.id !== id) return;
    let live = true;
    void (async () => {
      try {
        const n = await naturalSize(src.s, rot, page);
        const fit = Math.max(0.05, (width - 24) / n.w);
        const scale = zoom === "fit" ? Math.min(fit, src.s.kind === "image" ? 1 : 4) : zoom;
        const out = await draw(c, src.s, scale, rot, page);
        if (!live || out === null) return;
        c.style.width = `${out.w}px`;
        c.style.height = `${out.h}px`;
        setShownScale(scale);
        rd.markViewed(src.id);
      } catch {
        if (live) setFail("この書類を絵にできませんでした。「保存」して、ほかのアプリで開いてください。");
      }
    })();
    return () => {
      live = false;
    };
  }, [src, zoom, rot, page, width]);

  // 開いたら枠に移る（キーボードで拡大・回しができるように）
  useEffect(() => {
    root.current?.focus({ preventScroll: true });
  }, [id]);

  if (cur === null) return null;
  const pages = src?.id === id && src.s.kind === "pdf" ? src.s.pdf.pages : 1;
  const zoomBy = (dir: 1 | -1) => {
    const now = zoom === "fit" ? shownScale : zoom;
    const next = dir > 0 ? STEPS.find((x) => x > now + 0.001) : [...STEPS].reverse().find((x) => x < now - 0.001);
    setZoom(next ?? now);
  };
  // 切り替えの並びは書類ごと（同じ書類の1枚目・2枚目…を続けて）
  const others = byDocument(rd.files).flatMap((g) => g.files);
  const at = others.findIndex((f) => f.file.fileId === id);
  const step = (d: number) => {
    const n = others[at + d];
    if (n !== undefined) rd.view(n.file.fileId);
  };
  return (
    <aside
      ref={root}
      class={`dv${beside ? " beside" : ""}`}
      role="dialog"
      aria-modal="false"
      aria-label="届いた書類"
      tabIndex={-1}
      data-doc-viewer={id ?? ""}
      data-doc-page={page}
      data-doc-rotation={rot}
      data-doc-zoom={Math.round(shownScale * 100)}
      onKeyDown={(e) => {
        if (e.target instanceof HTMLSelectElement && e.key !== "Escape") return;
        if (e.key === "Escape") {
          e.preventDefault();
          e.stopPropagation();
          rd.view(null);
        } else if (e.key === "+" || e.key === "=") zoomBy(1);
        else if (e.key === "-") zoomBy(-1);
        else if (e.key === "0") setZoom("fit");
        else if (e.key === "r" || e.key === "R") setRot((rot + (e.shiftKey ? 270 : 90)) % 360);
        else if (e.key === "PageDown" && page < pages) setPage(page + 1);
        else if (e.key === "PageUp" && page > 1) setPage(page - 1);
        else return;
        e.preventDefault();
      }}
    >
      <div class="dv-head">
        <b class="dv-title">届いた書類</b>
        <button type="button" class="btn small" disabled={at <= 0} onClick={() => step(-1)} aria-label="前のファイル" data-dv-prev-file>
          ‹
        </button>
        <select
          class="dv-pick"
          value={id ?? ""}
          aria-label="見る書類"
          onChange={(e) => rd.view((e.currentTarget as HTMLSelectElement).value)}
          data-dv-pick
        >
          {others.map((f) => (
            <option key={f.file.fileId} value={f.file.fileId}>
              {fileLabel(f)}
            </option>
          ))}
        </select>
        <button type="button" class="btn small" disabled={at < 0 || at >= others.length - 1} onClick={() => step(1)} aria-label="次のファイル" data-dv-next-file>
          ›
        </button>
        <button type="button" class="dv-close" onClick={() => rd.view(null)} aria-label="書類を閉じる" data-dv-close>
          ×
        </button>
      </div>
      <div class="dv-tools" role="toolbar" aria-label="書類の見え方">
        <button type="button" class="btn small" onClick={() => zoomBy(-1)} aria-label="縮小" data-dv-zoom-out>
          −
        </button>
        <span class="dv-zoom" aria-live="polite">
          {Math.round(shownScale * 100)}%
        </span>
        <button type="button" class="btn small" onClick={() => zoomBy(1)} aria-label="拡大" data-dv-zoom-in>
          ＋
        </button>
        <button type="button" class={`btn small${zoom === "fit" ? " on" : ""}`} onClick={() => setZoom("fit")} aria-pressed={zoom === "fit"} data-dv-fit>
          幅に合わせる
        </button>
        <button type="button" class="btn small" onClick={() => setRot((rot + 90) % 360)} title="右に90度回します（R キー）" data-dv-rotate>
          ↻ 回す
        </button>
        {pages > 1 ? (
          <span class="dv-pages" data-dv-pages={pages}>
            <button type="button" class="btn small" disabled={page <= 1} onClick={() => setPage(page - 1)} aria-label="前のページ" data-dv-prev-page>
              ‹ 前
            </button>
            <span aria-live="polite">
              {page} / {pages} ページ
            </span>
            <button type="button" class="btn small" disabled={page >= pages} onClick={() => setPage(page + 1)} aria-label="次のページ" data-dv-next-page>
              次 ›
            </button>
          </span>
        ) : null}
        {rd.canSave ? (
          <button type="button" class="btn small" onClick={() => void rd.save([cur])} title={rd.names.get(cur.file.fileId)} data-dv-save>
            保存
          </button>
        ) : null}
      </div>
      <p class="dv-meta" data-dv-meta>
        {cur.file.mime === "application/pdf" ? "PDF" : "写真"}・{sizeText(cur.file.bytes)}・{dayTime(cur.receivedAt)} に受け取り・{cur.file.savedAt !== undefined ? "自分のフォルダに保存済み" : "まだ保存していません"}
      </p>
      {rd.note !== null ? (
        <p class="dv-meta" role="status">
          {rd.note}
        </p>
      ) : null}
      <div
        ref={box}
        class="dv-box"
        onWheel={(e) => {
          if (!e.ctrlKey && !e.metaKey) return;
          e.preventDefault();
          zoomBy(e.deltaY < 0 ? 1 : -1);
        }}
        {...drag}
      >
        {fail !== null ? (
          <p class="rp-note" role="alert">
            {fail}
          </p>
        ) : null}
        <canvas ref={canvas} class="dv-canvas" aria-label={`${docLabel(cur)}の${cur.file.mime === "application/pdf" ? `${page}ページ目` : "画像"}`} hidden={fail !== null} />
      </div>
    </aside>
  );
}

/** 書類の選び方の1行（書類の名前・持ち主・何枚目・受け取った日） */
function fileLabel(f: ReceivedFile): string {
  return `${docLabel(f)}${f.count > 1 ? ` ${f.index}/${f.count}` : ""}（${f.file.mime === "application/pdf" ? "PDF" : "写真"}・${new Date(f.receivedAt).toLocaleDateString("ja-JP", { month: "numeric", day: "numeric" })} 受け取り）`;
}

function release(s: Source): void {
  if (s.kind === "pdf") s.pdf.destroy();
  else s.bmp.close();
}

/** つかんで動かす（拡大したときに、枠の中を動かす） */
function useDrag(box: { current: HTMLDivElement | null }) {
  const from = useRef<{ x: number; y: number; left: number; top: number } | null>(null);
  return {
    onPointerDown: (e: PointerEvent) => {
      const el = box.current;
      if (el === null || e.button !== 0 || (el.scrollWidth <= el.clientWidth && el.scrollHeight <= el.clientHeight)) return;
      from.current = { x: e.clientX, y: e.clientY, left: el.scrollLeft, top: el.scrollTop };
      el.setPointerCapture(e.pointerId);
      el.classList.add("grabbing");
    },
    onPointerMove: (e: PointerEvent) => {
      const el = box.current;
      const f = from.current;
      if (el === null || f === null) return;
      el.scrollLeft = f.left - (e.clientX - f.x);
      el.scrollTop = f.top - (e.clientY - f.y);
    },
    onPointerUp: (e: PointerEvent) => {
      from.current = null;
      box.current?.releasePointerCapture(e.pointerId);
      box.current?.classList.remove("grabbing");
    },
  };
}
