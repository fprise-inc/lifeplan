// 開発用のサーバーのときだけ（URL の #selfcheck）: 画面を実際に操作して、数字が変わること・共有用の表示に切り替わることと、
// 計算の速さを確かめ、開発用のサーバーに送る（vite.config.ts の /__dev/report。本番のビルドには入らない）
import type { DualEngine } from "../engine/dual.ts";

// 待ちは開発用のサーバーに任せる（窓が隠れると WebView のタイマーが止まることがあるため。通信の応答は届く）
const sleep = (ms: number) => fetch(`/__dev/sleep/${Math.round(ms)}`).then(() => undefined);

async function settle(dual: DualEngine, timeoutMs = 20000): Promise<void> {
  const t0 = performance.now();
  while (!dual.settled() && performance.now() - t0 < timeoutMs) await sleep(20);
  await sleep(50);
}

const text = (sel: string) => document.querySelector(sel)?.textContent?.trim() ?? null;

function median(xs: number[]): number | null {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)] ?? null;
}

async function moveLever(key: string, to: number): Promise<void> {
  const el = document.querySelector<HTMLInputElement>(`input[data-lever="${key}"]`);
  if (el === null) throw new Error(`lever ${key}`);
  let v = Number(el.value);
  while (v !== to) {
    v += v < to ? 1 : -1;
    el.value = String(v);
    el.dispatchEvent(new Event("input", { bubbles: true }));
    await sleep(30);
  }
  el.dispatchEvent(new Event("change", { bubbles: true }));
}

/** 区切り: ここまでの結果を送り、開発用のサーバーに知らせ、画面を撮る時間を待つ */
async function stage(name: string, report: Record<string, unknown>, holdMs = 1500): Promise<void> {
  report.lastStage = name;
  await fetch("/__dev/report", { method: "POST", body: JSON.stringify(report, null, 2) }).catch(() => undefined);
  await fetch(`/__dev/stage/${encodeURIComponent(name)}`).catch(() => undefined);
  await sleep(holdMs);
}

export async function runSelfCheck(dual: DualEngine, host: string): Promise<void> {
  const report: Record<string, unknown> = { host, userAgent: navigator.userAgent };
  try {
    await settle(dual);
    report.initial = { headline: text(".hero-num"), verdict: text(".verdict") };
    await stage("initial", report);
    // 共有用の表示
    const memoBefore = document.querySelector(".memo") !== null;
    const fsBefore = getComputedStyle(document.documentElement).fontSize;
    document.querySelector<HTMLButtonElement>("[data-share-toggle]")?.click();
    await sleep(200);
    report.share = {
      htmlClass: document.documentElement.className,
      banner: text(".share-banner"),
      memoBefore,
      memoAfter: document.querySelector(".memo") !== null,
      fontSizeBefore: fsBefore,
      fontSizeAfter: getComputedStyle(document.documentElement).fontSize,
      lineWidth: getComputedStyle(document.querySelector(".line-prop") as Element).strokeWidth,
    };
    await stage("share", report);
    document.querySelector<HTMLButtonElement>("[data-share-toggle]")?.click();
    await sleep(300);
    // 根拠のパネル（ご主人の年金の、受け取り開始の翌々年のマス）
    const cell = [...document.querySelectorAll<HTMLButtonElement>(".cellbtn")].find((b) => (b.getAttribute("aria-label") ?? "").includes("ご主人の年金"));
    if (cell !== undefined) {
      cell.click();
      const t0 = performance.now();
      while (document.querySelector(".ev-body") === null && performance.now() - t0 < 20000) await sleep(20);
      report.evidence = { ms: Math.round(performance.now() - t0), title: text("#ev-title"), params: document.querySelectorAll(".ev-params tbody tr").length };
      await stage("evidence", report);
      document.querySelector<HTMLButtonElement>(".ev-close")?.click();
      await sleep(300);
    }
    window.scrollTo(0, 0);
    const steps: Record<string, unknown>[] = [];
    // 打ち手を順に動かす（働く最後の年齢・年金の受け取り開始・NISA・生活費）
    for (const [key, to] of [["retireAge", 4], ["retireAge", 0], ["pensionAge", 3], ["nisaMonthly", 3], ["livingMonthly", 0], ["retireAge", 2]] as const) {
      const before = dual.timings.length;
      await moveLever(key, to);
      const previewHeadline = text(".hero-num");
      await settle(dual);
      const ts = dual.timings.slice(before);
      steps.push({
        key,
        to,
        previewHeadline,
        canonicalHeadline: text(".hero-num"),
        verdict: text(".verdict"),
        previewMs: ts.filter((t) => t.kind === "preview").map((t) => Math.round(t.ms * 10) / 10),
        releaseMs: ts.filter((t) => t.kind === "release").map((t) => Math.round(t.ms * 10) / 10),
        canonical: ts.filter((t) => t.kind === "canonical").map((t) => ({ ms: Math.round(t.ms), hostMs: Math.round(t.hostMs ?? 0) })),
      });
      report.steps = steps;
      await fetch("/__dev/report", { method: "POST", body: JSON.stringify(report, null, 2) }).catch(() => undefined);
    }
    report.steps = steps;
    await stage("moved", report);
    document.querySelector(".cf-card")?.scrollIntoView({ block: "start" });
    await stage("table", report);
    window.scrollTo(0, 0);
    const previews = dual.timings.filter((t) => t.kind === "preview").map((t) => t.ms);
    const canon = dual.timings.filter((t) => t.kind === "canonical");
    report.summary = {
      previewMedianMs: median(previews),
      previewMaxMs: previews.length > 0 ? Math.max(...previews) : null,
      previewCount: previews.length,
      canonicalMedianMs: median(canon.map((t) => t.ms)),
      canonicalHostMedianMs: median(canon.map((t) => t.hostMs ?? 0)),
      canonicalCount: canon.length,
      mismatches: dual.mismatches,
    };
    report.ok = true;
  } catch (e) {
    report.ok = false;
    report.error = String(e);
  }
  await fetch("/__dev/report", { method: "POST", body: JSON.stringify(report, null, 2) });
}
