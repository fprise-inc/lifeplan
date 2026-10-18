// 提案書の見本（画面の中の PDF の見本）: ページの縮小一覧・ページ送り・拡大と縮小。
// - 本体の見本はページごとの SVG（本体が PDF と同じ組版の結果から作る。文字は輪郭の図形）。拡大してもぼやけない。
//   CSP は変えない（img の data:・blob: は使わず、SVG を確かめてから文書の中に入れる。script・style・外への参照は捨てる）
// - 縮小一覧は小さい PNG（キャンバスに描く）
// - 一度作った帳票（組版の結果）は本体が持ち続け、画面は全ページを裏で先に読んでおく（表示中のページ → 隣のページ →
//   縮小一覧 → 残りのページの順）。読んだページは作り直すまで画面のメモリに置く（保存はしない）
// - ページ送りと拡大・縮小の操作はいつも見本の上に出す（見本だけがスクロールする）
import { useEffect, useLayoutEffect, useRef, useState } from "preact/hooks";
import type { HostApi, RenderInfo } from "../../engine/host.ts";
import { allowedSvgAttr, allowedSvgTag, percentOf, prefetchOrder, scaleOf, stepZoom, wheelZoom, type Zoom } from "./viewer.ts";

interface Props {
  host: HostApi;
  info: RenderInfo;
  /** 作り直すたびに増える（読んだページを捨てる合図） */
  version: number;
  /** 設定を変えて、見本が古くなった */
  stale: boolean;
  /** 作るときに先に読んだ1ページ目の SVG（同じものを読み直さない） */
  firstSvg: string | null;
}

/** 縮小一覧の PNG の倍率（1pt あたりの画素。本体の下限） */
const THUMB_SCALE = 0.5;

/** 本体が作った SVG を確かめて、この文書の要素にする（許可した要素と属性だけを残す） */
function parseSvg(text: string): SVGSVGElement | null {
  const doc = new DOMParser().parseFromString(text, "image/svg+xml");
  const root = doc.documentElement;
  if (root.localName !== "svg" || doc.getElementsByTagName("parsererror").length > 0) return null;
  const clean = (el: Element) => {
    for (const a of [...el.attributes]) if (!allowedSvgAttr(a.name, a.value)) el.removeAttribute(a.name);
    for (const c of [...el.children]) {
      if (allowedSvgTag(c.localName)) clean(c);
      else c.remove();
    }
  };
  clean(root);
  const svg = document.importNode(root, true) as unknown as SVGSVGElement;
  svg.setAttribute("role", "img");
  return svg;
}

const isField = (t: EventTarget | null) => t instanceof HTMLElement && (t.isContentEditable || ["INPUT", "SELECT", "TEXTAREA"].includes(t.tagName));

/** 縮小一覧の1枚 */
function Thumb({ bitmap, size }: { bitmap: ImageBitmap | undefined; size: [number, number] | undefined }) {
  const ref = useRef<HTMLCanvasElement | null>(null);
  useEffect(() => {
    const c = ref.current;
    if (c === null || bitmap === undefined) return;
    c.width = bitmap.width;
    c.height = bitmap.height;
    c.getContext("2d")?.drawImage(bitmap, 0, 0);
  }, [bitmap]);
  const land = size !== undefined && size[0] > size[1];
  return <canvas ref={ref} class={`rp-thumb${land ? " land" : ""}${bitmap === undefined ? " wait" : ""}`} aria-hidden="true" />;
}

export function ReportViewer({ host, info, version, stale, firstSvg }: Props) {
  const n = info.pages;
  const [page, setPage] = useState(0);
  const [zoom, setZoom] = useState<Zoom>({ mode: "page" });
  const [view, setView] = useState<[number, number]>([0, 0]);
  const [tick, setTick] = useState(0);
  const [failed, setFailed] = useState<string | null>(null);
  const svgs = useRef(new Map<number, SVGSVGElement>());
  const thumbs = useRef(new Map<number, ImageBitmap>());
  const errors = useRef(new Map<number, string>());
  const pageRef = useRef(0);
  const viewport = useRef<HTMLDivElement | null>(null);
  const holder = useRef<HTMLDivElement | null>(null);
  const thumbList = useRef<HTMLDivElement | null>(null);
  /** ページを切り替えた時刻（表示までの時間を測る） */
  const switchedAt = useRef<number | null>(null);
  const timings = useRef<{ switches: number[]; prefetchedAllMs: number | null }>({ switches: [], prefetchedAllMs: null });

  const size = info.sizes[page] ?? [595, 842];
  const scale = scaleOf(zoom, view, size);
  const go = (i: number) => {
    const next = Math.max(0, Math.min(n - 1, i));
    if (next === pageRef.current) return;
    switchedAt.current = performance.now();
    pageRef.current = next;
    setPage(next);
  };

  // 作り直したら、読んだページを捨てて1ページ目から読み直す
  useEffect(() => {
    for (const b of thumbs.current.values()) b.close();
    svgs.current = new Map();
    thumbs.current = new Map();
    errors.current = new Map();
    pageRef.current = 0;
    setPage(0);
    setFailed(null);
    timings.current = { switches: [], prefetchedAllMs: null };
    if (firstSvg !== null) {
      const el = parseSvg(firstSvg);
      if (el !== null) svgs.current.set(0, el);
    }
    let live = true;
    const t0 = performance.now();
    // 裏で先に読む（1つずつ。表示中のページが変わったら、次に読むものを選び直す）
    void (async () => {
      for (;;) {
        if (!live) return;
        const cur = pageRef.current;
        const done = new Set([...svgs.current.keys(), ...errors.current.keys()]);
        const order = prefetchOrder(cur, n, done);
        const near = order.filter((i) => Math.abs(i - cur) <= 1);
        const thumb = [...Array(n).keys()].find((i) => !thumbs.current.has(i) && !errors.current.has(-1 - i));
        try {
          if (near[0] !== undefined) {
            const el = parseSvg(await host.report.pageSvg(near[0]));
            if (!live) return;
            if (el === null) errors.current.set(near[0], "E_REPORT_SVG");
            else svgs.current.set(near[0], el);
          } else if (thumb !== undefined) {
            try {
              const bmp = await createImageBitmap(await host.report.page(thumb, THUMB_SCALE));
              if (!live) return void bmp.close();
              thumbs.current.set(thumb, bmp);
            } catch {
              errors.current.set(-1 - thumb, "E_REPORT_PAGE");
            }
          } else if (order[0] !== undefined) {
            const el = parseSvg(await host.report.pageSvg(order[0]));
            if (!live) return;
            if (el === null) errors.current.set(order[0], "E_REPORT_SVG");
            else svgs.current.set(order[0], el);
          } else {
            timings.current.prefetchedAllMs = performance.now() - t0;
            if (import.meta.env.DEV) (globalThis as { __financiaReportView?: unknown }).__financiaReportView = timings.current;
            return;
          }
        } catch (e) {
          const i = near[0] ?? order[0];
          if (i !== undefined) errors.current.set(i, typeof e === "string" ? e : "E_REPORT_PAGE");
        }
        setTick((t) => t + 1);
      }
    })();
    return () => {
      live = false;
    };
  }, [host, version, n]);

  // 画面を離れたら縮小一覧の画像を捨てる
  useEffect(
    () => () => {
      for (const b of thumbs.current.values()) b.close();
    },
    [],
  );

  // 見本の枠の大きさ（ページ全体・幅に合わせるの倍率に使う）
  useLayoutEffect(() => {
    const el = viewport.current;
    if (el === null) return;
    const ro = new ResizeObserver(() => setView([el.clientWidth, el.clientHeight]));
    ro.observe(el);
    setView([el.clientWidth, el.clientHeight]);
    return () => ro.disconnect();
  }, []);

  // 表示中のページの SVG を入れ、倍率に合わせる
  useLayoutEffect(() => {
    const h = holder.current;
    if (h === null) return;
    const svg = svgs.current.get(page);
    const err = errors.current.get(page);
    setFailed(svg === undefined && err !== undefined ? err : null);
    if (svg === undefined) {
      h.replaceChildren();
      return;
    }
    svg.setAttribute("width", String(Math.round(size[0] * scale)));
    svg.setAttribute("height", String(Math.round(size[1] * scale)));
    svg.setAttribute("aria-label", `見本 ${page + 1}ページ目`);
    if (h.firstChild !== svg) {
      h.replaceChildren(svg);
      h.dataset.drawn = String(version);
      if (switchedAt.current !== null) {
        timings.current.switches.push(performance.now() - switchedAt.current);
        switchedAt.current = null;
        if (import.meta.env.DEV) (globalThis as { __financiaReportView?: unknown }).__financiaReportView = timings.current;
      }
    }
  }, [page, tick, scale, version]);

  // 縮小一覧は表示中のページが見える位置へ
  useEffect(() => {
    thumbList.current?.querySelector<HTMLElement>(`[data-thumb="${page}"]`)?.scrollIntoView({ block: "nearest" });
  }, [page]);

  // Ctrl/⌘＋ホイールで拡大・縮小（ページのほかの場所の拡大はしない）
  useEffect(() => {
    const el = viewport.current;
    if (el === null) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      setZoom((z) => ({ mode: "custom", scale: wheelZoom(scaleOf(z, [el.clientWidth, el.clientHeight], info.sizes[pageRef.current] ?? [595, 842]), e.deltaY) }));
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [info]);

  // ⌘＋／⌘−／⌘0、←→・PageUp／PageDown でページ送り（入力欄の中では使わない）
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = viewport.current;
      if (el === null) return;
      const cur = () => scaleOf(zoom, [el.clientWidth, el.clientHeight], info.sizes[pageRef.current] ?? [595, 842]);
      if (e.metaKey || e.ctrlKey) {
        if (e.key === "+" || e.key === "=" || e.key === ";") setZoom({ mode: "custom", scale: stepZoom(cur(), 1) });
        else if (e.key === "-") setZoom({ mode: "custom", scale: stepZoom(cur(), -1) });
        else if (e.key === "0") setZoom({ mode: "page" });
        else return;
        e.preventDefault();
        return;
      }
      if (isField(e.target) || e.altKey) return;
      if (e.key === "ArrowRight" || e.key === "PageDown") go(pageRef.current + 1);
      else if (e.key === "ArrowLeft" || e.key === "PageUp") go(pageRef.current - 1);
      else if (e.key === "Home") go(0);
      else if (e.key === "End") go(n - 1);
      else return;
      e.preventDefault();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [zoom, info, n]);

  const loaded = svgs.current.has(page);
  return (
    <div class="rp-viewer">
      <div class="rp-tools" role="toolbar" aria-label="見本の操作">
        <div class="rp-nav">
          <button type="button" class="btn" disabled={page === 0} onClick={() => go(page - 1)} aria-label="前のページ">
            ← 前へ
          </button>
          <label class="rp-pageno">
            <input
              type="number"
              min={1}
              max={n}
              value={page + 1}
              aria-label="ページ番号"
              onChange={(e) => {
                const v = Number((e.currentTarget as HTMLInputElement).value);
                if (Number.isFinite(v)) go(Math.round(v) - 1);
              }}
            />
            <span data-report-page>
              / {n}ページ
            </span>
          </label>
          <button type="button" class="btn" disabled={page >= n - 1} onClick={() => go(page + 1)} aria-label="次のページ">
            次へ →
          </button>
        </div>
        <div class="rp-zoom">
          <button type="button" class="btn" onClick={() => setZoom({ mode: "custom", scale: stepZoom(scale, -1) })} aria-label="縮小" title="縮小（⌘−）">
            −
          </button>
          <span class="rp-pct" aria-live="polite" data-report-zoom>
            {percentOf(scale)}%
          </span>
          <button type="button" class="btn" onClick={() => setZoom({ mode: "custom", scale: stepZoom(scale, 1) })} aria-label="拡大" title="拡大（⌘＋）">
            ＋
          </button>
          <button type="button" class={`btn${zoom.mode === "page" ? " on" : ""}`} aria-pressed={zoom.mode === "page"} onClick={() => setZoom({ mode: "page" })} title="ページ全体（⌘0）">
            ページ全体
          </button>
          <button type="button" class={`btn${zoom.mode === "width" ? " on" : ""}`} aria-pressed={zoom.mode === "width"} onClick={() => setZoom({ mode: "width" })}>
            幅に合わせる
          </button>
        </div>
      </div>
      <div class="rp-body">
        <div class="rp-thumbs" role="group" aria-label="ページの一覧" ref={thumbList}>
          {info.sizes.map((sz, i) => (
            <button type="button" key={i} class={i === page ? "on" : ""} aria-current={i === page ? "page" : undefined} aria-label={`${i + 1}ページ目`} onClick={() => go(i)} data-thumb={i}>
              <Thumb bitmap={thumbs.current.get(i)} size={sz} />
              <span>{i + 1}</span>
            </button>
          ))}
        </div>
        <div class={`rp-sheet${stale ? " stale" : ""}`} ref={viewport} tabIndex={0} aria-label="PDF の見本">
          <div class="rp-page" ref={holder} data-report-svg style={loaded ? undefined : { width: `${Math.round(size[0] * scale)}px`, height: `${Math.round(size[1] * scale)}px` }} />
          {!loaded && failed === null ? <p class="rp-loading">読み込んでいます…</p> : null}
          {failed !== null ? <p class="fatal rp-loading">見本を表示できませんでした（{failed}）</p> : null}
        </div>
      </div>
    </div>
  );
}
