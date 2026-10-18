// 画面の自己確認（開発用のサーバーのときだけ。#selfcheck=wire）: 提案書のタブで PDF を作る → 見本が出る → 保存する、
// 入力のホームでヒアリングシートを書き出す → 記入済みのシートを取り込む → 承認すると入力のホームのカードが変わる、を画面の操作で流し、
// 結果を開発用のサーバー（/__dev/report）に送る。保存先は本体・開発用のサーバーの FINANCIA_DEV_SAVE_DIR（開発のときだけの口）
const sleep = (ms: number) => fetch(`/__dev/sleep/${Math.round(ms)}`).then(() => undefined);

async function waitFor<T extends Element>(sel: string, timeoutMs = 60000, pred: (el: T) => boolean = () => true): Promise<T> {
  const t0 = performance.now();
  for (;;) {
    const el = document.querySelector<T>(sel);
    if (el !== null && pred(el)) return el;
    if (performance.now() - t0 > timeoutMs) throw new Error(`待ちきれません: ${sel}`);
    await sleep(50);
  }
}

async function stage(name: string, report: Record<string, unknown>, holdMs = 2500): Promise<void> {
  report.lastStage = name;
  await fetch("/__dev/report", { method: "POST", body: JSON.stringify(report, null, 2) }).catch(() => undefined);
  await fetch(`/__dev/stage/${encodeURIComponent(name)}`).catch(() => undefined);
  await sleep(holdMs);
}

function clickTab(label: string): void {
  const b = [...document.querySelectorAll<HTMLButtonElement>(".tabs button")].find((x) => x.textContent?.trim() === label);
  if (b === undefined) throw new Error(`タブ ${label}`);
  b.click();
}

const cards = () => Object.fromEntries([...document.querySelectorAll<HTMLElement>("[data-card]")].map((c) => [c.dataset.card ?? "", /s-(\w+)/.exec(c.className)?.[1] ?? ""]));

export async function runWireCheck(host: string): Promise<void> {
  const report: Record<string, unknown> = { host, userAgent: navigator.userAgent };
  try {
    // ---- 提案書 ----
    await waitFor(".main-stack");
    clickTab("提案書");
    await waitFor("[data-report-tab]");
    const name = document.querySelector<HTMLInputElement>("[data-report-addressee]");
    if (name !== null) {
      name.value = "見本 太郎";
      name.dispatchEvent(new Event("input", { bubbles: true }));
    }
    await sleep(100);
    const t0 = performance.now();
    (await waitFor<HTMLButtonElement>("[data-report-build]")).click();
    await waitFor("[data-report-ready]", 120000);
    const canvas = await waitFor<HTMLCanvasElement>("[data-report-canvas]", 20000, (c) => c.dataset.drawn !== undefined);
    report.report = {
      clickToPreviewMs: Math.round(performance.now() - t0),
      timings: (globalThis as { __financiaReport?: unknown }).__financiaReport,
      page: document.querySelector("[data-report-page]")?.textContent?.trim(),
      canvas: [canvas.width, canvas.height],
      busyShown: true,
      summary: document.querySelector("[data-report-ready]")?.textContent?.trim(),
    };
    await stage("report-preview", report);
    // 最後のページ（案の比較）
    const thumbs = document.querySelectorAll<HTMLButtonElement>(".rp-thumbs button");
    thumbs[thumbs.length - 1]?.click();
    await waitFor<HTMLCanvasElement>("[data-report-canvas]", 20000, (c) => c.dataset.drawn !== undefined);
    await sleep(400);
    await stage("report-last-page", report);
    // 章を減らした10ページ前後の提案書でも測る（作り直し）
    for (const id of ["events", "education", "insurance", "comparison", "basics"]) document.querySelector<HTMLInputElement>(`[data-report-chapter="${id}"]`)?.click();
    await sleep(200);
    const t1 = performance.now();
    (await waitFor<HTMLButtonElement>("[data-report-build]")).click();
    await waitFor("[data-report-busy]", 5000).catch(() => null);
    await waitFor<HTMLElement>("[data-report-ready]", 120000, () => document.querySelector("[data-report-busy]") === null);
    await waitFor<HTMLCanvasElement>("[data-report-canvas]", 20000, (c) => c.dataset.drawn !== undefined && c.dataset.drawn !== "1");
    report.reportShort = { clickToPreviewMs: Math.round(performance.now() - t1), timings: (globalThis as { __financiaReport?: unknown }).__financiaReport, summary: document.querySelector("[data-report-ready]")?.textContent?.trim() };
    await stage("report-short", report);
    (await waitFor<HTMLButtonElement>("[data-report-save]", 5000, (b) => !b.disabled)).click();
    (await waitFor<HTMLButtonElement>("[data-export-ok]", 5000)).click();
    const saved = await waitFor<HTMLElement>("[data-report-saved]", 30000);
    report.reportSave = { saved: saved.dataset.reportSaved, text: saved.textContent?.trim() };
    await stage("report-saved", report, 500);

    // ---- ヒアリングシート（空の世帯で）----
    clickTab("入力");
    await waitFor(".ih");
    const pick = document.querySelector<HTMLSelectElement>(".hh-pick select");
    if (pick !== null) {
      pick.value = "__blank__";
      pick.dispatchEvent(new Event("change", { bubbles: true }));
    }
    await sleep(800);
    await waitFor("[data-hearing-export]");
    const before = cards();
    const progressBefore = document.querySelector("[data-progress]")?.textContent?.trim();
    (await waitFor<HTMLButtonElement>("[data-hearing-export]")).click();
    (await waitFor<HTMLButtonElement>("[data-hearing-export-go]")).click();
    const hs = await waitFor<HTMLElement>("[data-hearing-saved]", 30000);
    report.hearingExport = { saved: hs.dataset.hearingSaved, text: hs.textContent?.trim() };
    await stage("hearing-exported", report, 500);
    (await waitFor<HTMLButtonElement>("[data-hearing-import]")).click();
    await waitFor("[data-hearing-review]", 30000);
    report.hearingReview = {
      candidates: [...document.querySelectorAll<HTMLElement>("[data-candidate]")].map((c) => c.dataset.candidate),
      marks: document.querySelectorAll("[data-hearing-review] .badge.est").length,
    };
    window.scrollTo(0, 0);
    await stage("hearing-review", report);
    (await waitFor<HTMLButtonElement>("[data-hearing-approve]")).click();
    const msg = await waitFor<HTMLElement>("[data-hearing-msg]", 10000);
    await sleep(600);
    const after = cards();
    report.hearingApprove = {
      message: msg.textContent?.trim(),
      progressBefore,
      progressAfter: document.querySelector("[data-progress]")?.textContent?.trim(),
      before,
      after,
      changedCards: Object.keys(after).filter((k) => after[k] !== before[k]),
      // 承認した後の世帯を計算できるか（計算できなければ「計算できませんでした」が出る）
      calcError: document.querySelector(".fatal")?.textContent?.trim() ?? null,
    };
    window.scrollTo(0, 0);
    await stage("hearing-approved", report);
    report.ok = true;
  } catch (e) {
    report.ok = false;
    report.error = e instanceof Error ? e.message : String(e);
  }
  await stage("done", report, 200);
}
