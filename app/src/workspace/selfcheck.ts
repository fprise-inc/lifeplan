// 開発用のサーバーのときだけ（URL の #selfcheck）: 画面を実際に操作して、数字が変わること・文字を大きくできること・根拠が端の引き出しに出ることと、
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
    // 文字を大きくする（メモは画面に出さない。引き出しを開いたときだけ）
    const fsBefore = getComputedStyle(document.documentElement).fontSize;
    const lwBefore = getComputedStyle(document.querySelector(".line-prop") as Element).strokeWidth;
    document.querySelector<HTMLButtonElement>("[data-big-toggle]")?.click();
    await sleep(200);
    report.big = {
      htmlClass: document.documentElement.className,
      memoOnScreen: document.querySelector("[data-memo]") !== null,
      fontSizeBefore: fsBefore,
      fontSizeAfter: getComputedStyle(document.documentElement).fontSize,
      lineWidthBefore: lwBefore,
      lineWidthAfter: getComputedStyle(document.querySelector(".line-prop") as Element).strokeWidth,
    };
    await stage("big", report);
    document.querySelector<HTMLButtonElement>("[data-big-toggle]")?.click();
    await sleep(300);
    // 根拠のパネル（ご主人の年金の、受け取り開始の翌々年のマス）
    const cell = [...document.querySelectorAll<HTMLButtonElement>(".cellbtn")].find((b) => (b.getAttribute("aria-label") ?? "").includes("ご主人の年金"));
    if (cell !== undefined) {
      cell.click();
      const t0 = performance.now();
      while (document.querySelector(".ev-body") === null && performance.now() - t0 < 20000) await sleep(20);
      // 根拠のパネルは端の引き出し: グラフ・表と重ならないこと
      const box = (sel: string) => document.querySelector(sel)?.getBoundingClientRect();
      const drawer = box(".drawer.evidence");
      const chart = box(".chart");
      const table = box(".cf-wrap");
      const overlaps = (a?: DOMRect, b?: DOMRect) => a !== undefined && b !== undefined && a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
      report.evidence = { ms: Math.round(performance.now() - t0), title: text("#ev-title"), params: document.querySelectorAll(".ev-params tbody tr").length, coversChart: overlaps(drawer, chart), coversTable: overlaps(drawer, table), viewport: `${innerWidth}x${innerHeight}` };
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

/** 入力欄に打つ（打つ → 欄を離れる） */
async function typeInto(sel: string, value: string): Promise<boolean> {
  const el = document.querySelector<HTMLInputElement>(sel);
  if (el === null) return false;
  el.focus();
  await sleep(50);
  el.value = value;
  el.dispatchEvent(new Event("input", { bubbles: true }));
  await sleep(50);
  el.blur();
  return true;
}

const clickTab = (label: string) => [...document.querySelectorAll<HTMLButtonElement>(".tabs button")].find((b) => b.textContent?.includes(label))?.click();
const cardText = (id: string) => text(`[data-card="${id}"]`);

async function openCard(id: string): Promise<void> {
  document.querySelector<HTMLButtonElement>(`[data-card="${id}"]`)?.click();
  await sleep(300);
}
async function savePanel(): Promise<void> {
  document.querySelector<HTMLButtonElement>("[data-save]")?.click();
  await sleep(300);
}

/**
 * 入力のホームの自己確認（URL の #selfcheck=input）: カードのホームが出ること、カードを押すと中央のパネルが開くこと、
 * パネルで値を変えて保存すると、カード・進み具合・主画面が変わること、空の世帯から入れられること。開発用のサーバーのときだけ
 */
export async function runInputCheck(dual: () => DualEngine | null, host: string): Promise<void> {
  const report: Record<string, unknown> = { host, kind: "input", userAgent: navigator.userAgent };
  const wait = async () => {
    const d = dual();
    if (d !== null) await settle(d);
  };
  try {
    clickTab("入力");
    await sleep(300);
    report.initial = { progress: text("[data-progress]"), cards: document.querySelectorAll("[data-card]").length, living: cardText("living") };
    await stage("input-home", report);
    await openCard("living");
    report.panel = { title: text("#ip-title"), note: text("[data-panel-note]"), scrim: document.querySelector(".scrim") !== null };
    await stage("input-panel", report);
    report.typed = await typeInto('.ipanel input[id^="fld-living"][id$="_monthly"]', "26");
    await sleep(200);
    await savePanel();
    await wait();
    report.saved = { living: cardText("living"), progress: text("[data-progress]"), panelClosed: document.querySelector(".ipanel") === null };
    await stage("input-saved", report);
    clickTab("主画面");
    await sleep(300);
    await wait();
    report.main = { headline: text(".hero-num"), diff: text(".hero-diff") };
    await stage("main-after-input", report);
    // 空の世帯から
    const pick = document.querySelector<HTMLSelectElement>('select[aria-label="開く世帯"]');
    if (pick !== null) {
      pick.value = "__blank__";
      pick.dispatchEvent(new Event("change", { bubbles: true }));
    }
    await sleep(500);
    clickTab("入力");
    await sleep(300);
    await wait();
    report.blank = { progress: text("[data-progress]"), family: cardText("family"), members: text(".hh") };
    await openCard("family");
    await typeInto('.ipanel input[id^="fld-family"][id$="_birth"]', "1988-06");
    document.querySelector<HTMLButtonElement>('.ipanel [data-action="family/add/spouse"]')?.click();
    await sleep(200);
    await savePanel();
    await openCard("work");
    document.querySelector<HTMLButtonElement>('.ipanel [data-action$="/start"]')?.click();
    await sleep(300);
    await savePanel();
    await wait();
    report.blankFilled = { progress: text("[data-progress]"), family: cardText("family"), work: cardText("work"), members: text(".hh") };
    await stage("blank-work", report);
    report.ok = true;
  } catch (e) {
    report.ok = false;
    report.error = String(e);
  }
  await fetch("/__dev/report", { method: "POST", body: JSON.stringify(report, null, 2) });
}

/**
 * 万一の画面の自己確認（URL の #selfcheck=contingency）: 開いてから必要保障額の推移が出るまでの時間、障害の想定の組み合わせの一文、
 * 2028年4月以後の死亡の知らせ、文字を大きくしたときもメモが画面に出ないこと。開発用のサーバーのときだけ
 */
export async function runContingencyCheck(host: string): Promise<void> {
  const report: Record<string, unknown> = { host, kind: "contingency", userAgent: navigator.userAgent };
  const waitFor = async (pred: () => boolean, ms = 30000) => {
    const t0 = performance.now();
    while (!pred() && performance.now() - t0 < ms) await sleep(20);
    return Math.round(performance.now() - t0);
  };
  try {
    const t0 = performance.now();
    clickTab("万一の想定");
    await waitFor(() => document.querySelector(".cg-prot") !== null, 2000);
    report.loadingShown = document.querySelector(".cg-loading") !== null;
    await waitFor(() => document.querySelector(".pchart") !== null || document.querySelector(".cg-prot .fatal") !== null);
    report.protectionMs = Math.round(performance.now() - t0);
    await waitFor(() => document.querySelector(".cg-scenario .hero-num") !== null);
    await sleep(300);
    report.open = { perf: text("[data-cg-perf]"), headline: text(".cg-scenario .hero-num"), verdict: text(".cg-scenario .verdict"), charts: document.querySelectorAll(".pchart").length };
    await stage("cg-open", report);
    document.querySelector<HTMLButtonElement>('[data-scenario="disability:self"]')?.click();
    report.disabilityMs = await waitFor(() => document.querySelector("[data-choice]") !== null && document.querySelector(".cg-scenario .is-stale") === null);
    report.disability = { title: text(".cg-title"), choice: text("[data-choice]") };
    await stage("cg-disability", report);
    document.querySelector<HTMLButtonElement>('[data-scenario="death:self"]')?.click();
    await sleep(100);
    const sel = document.querySelector<HTMLSelectElement>("[data-scenario-year]");
    if (sel !== null) {
      sel.value = "2030";
      sel.dispatchEvent(new Event("change", { bubbles: true }));
    }
    report.deathMs = await waitFor(() => (text(".cg-title") ?? "").includes("2030") && document.querySelector(".cg-scenario .is-stale") === null);
    report.death2030 = { title: text(".cg-title"), notice: text("[data-notice]") };
    await stage("cg-death-2030", report);
    document.querySelector<HTMLButtonElement>("[data-big-toggle]")?.click();
    await sleep(300);
    report.big = { memo: document.querySelector("[data-memo]") !== null, inputs: document.querySelector(".cg-side") !== null, fontSize: getComputedStyle(document.documentElement).fontSize };
    await stage("cg-big", report);
    document.querySelector<HTMLButtonElement>("[data-big-toggle]")?.click();
    await sleep(200);
    report.ok = true;
  } catch (e) {
    report.ok = false;
    report.error = String(e);
  }
  await fetch("/__dev/report", { method: "POST", body: JSON.stringify(report, null, 2) });
}

/** スライダー（data-item）を1刻みずつ動かし、刻みごとの先出しの時間を集める */
async function moveItem(sel: string, to: number, dual: () => DualEngine | null, stepMs = 40): Promise<number[]> {
  const el = document.querySelector<HTMLInputElement>(sel);
  if (el === null) throw new Error(`item ${sel}`);
  const step = Number(el.step) || 1;
  const out: number[] = [];
  let v = Number(el.value);
  while (Math.abs(v - to) >= step / 2) {
    v += v < to ? step : -step;
    const before = dual()?.timings.length ?? 0;
    el.value = String(v);
    el.dispatchEvent(new Event("input", { bubbles: true }));
    const t = dual()?.timings.slice(before).find((x) => x.kind === "preview");
    if (t !== undefined) out.push(Math.round(t.ms * 10) / 10);
    await sleep(stepMs);
  }
  el.dispatchEvent(new Event("change", { bubbles: true }));
  return out;
}

/**
 * 案の自己確認（URL の #selfcheck=plans）: 動かす項目を足して動かす（先出しの時間）→ 案として保存 → 重ねる → 5案を比べる（比較の時間）→
 * 収支のグラフ → 資産と負債のグラフ → 説明モード。開発用のサーバーのときだけ
 */
export async function runPlansCheck(dual: () => DualEngine | null, host: string, compare: () => { ms: number; hostMs: number; slots: number }[]): Promise<void> {
  const report: Record<string, unknown> = { host, kind: "plans", userAgent: navigator.userAgent };
  const click = async (sel: string, ms = 300) => {
    const el = document.querySelector<HTMLElement>(sel);
    if (el === null) throw new Error(`click ${sel}`);
    el.click();
    await sleep(ms);
  };
  const wait = async () => {
    const d = dual();
    if (d !== null) await settle(d);
  };
  try {
    await wait();
    report.initial = { headline: text(".hero-num") };
    // 1. 動かす項目を足す（借入・金利・配分）
    await click("[data-add-item]");
    report.menuItems = document.querySelectorAll("[data-pick]").length;
    await stage("item-menu", report);
    const pickRe = async (re: RegExp) => {
      const b = [...document.querySelectorAll<HTMLButtonElement>("[data-pick]")].find((x) => re.test(x.dataset.pick ?? ""));
      if (b === undefined) return null;
      const key = b.dataset.pick ?? "";
      b.click();
      await sleep(200);
      return key;
    };
    const picked: string[] = [];
    for (const re of [/^loan:.*:(principal|prepay)$/, /^loan:.*:rate$/, /^mix:/]) {
      if (document.querySelector("[data-item-menu]") === null) await click("[data-add-item]");
      const k = await pickRe(re);
      if (k !== null) picked.push(k);
    }
    report.picked = picked;
    const loanKey = picked.find((k) => /^loan:/.test(k) && !k.endsWith(":rate"));
    const previews: Record<string, number[]> = {};
    if (loanKey !== undefined) {
      const el = document.querySelector<HTMLInputElement>(`input[data-item="${loanKey}"]`);
      const target = loanKey.endsWith(":prepay") ? 5_000_000 : Number(el?.value ?? 0) - 5_000_000;
      previews.loan = await moveItem(`input[data-item="${loanKey}"]`, target, dual);
      await wait();
    }
    report.afterLoan = { headline: text(".hero-num") };
    await stage("item-added", report);
    // 2. 案として保存
    await click("[data-plan-save]");
    report.suggestedName = (document.querySelector<HTMLInputElement>("[data-plan-save-form] input") as HTMLInputElement | null)?.value ?? null;
    await stage("plan-save", report);
    await click("[data-plan-save-form] button[type=submit]");
    // 3. 金利を上げて、土台に重ねて保存
    const rateKey = picked.find((k) => k.endsWith(":rate"));
    if (rateKey !== undefined) {
      const el = document.querySelector<HTMLInputElement>(`input[data-item="${rateKey}"]`);
      previews.rate = await moveItem(`input[data-item="${rateKey}"]`, Number(el?.value ?? 0) + 500, dual, 30);
      await wait();
      await click("[data-plan-save]");
      await click("[data-plan-save-form] button[type=submit]");
    }
    // 4. 配分を変えて、現状から保存
    const mixKey = picked.find((k) => k.startsWith("mix:"));
    if (mixKey !== undefined) {
      const sel = document.querySelector<HTMLSelectElement>("[data-plan-bar] select");
      if (sel !== null) {
        sel.value = "";
        sel.dispatchEvent(new Event("change", { bubbles: true }));
        await sleep(300);
        document.querySelector<HTMLButtonElement>(".pb-confirm .btn.danger")?.click();
        await sleep(300);
      }
      previews.mix = await moveItem(`input[data-item="${mixKey}:equity"]`, 80, dual, 30);
      await wait();
      await click("[data-plan-save]");
      await click("[data-plan-save-form] button[type=submit]");
    }
    // 5. 対策の固定の項目でも2つ
    for (const [lever, idx] of [["retireAge", 4], ["livingMonthly", 0]] as const) {
      const sel = document.querySelector<HTMLSelectElement>("[data-plan-bar] select");
      if (sel !== null) {
        sel.value = "";
        sel.dispatchEvent(new Event("change", { bubbles: true }));
        await sleep(300);
        document.querySelector<HTMLButtonElement>(".pb-confirm .btn.danger")?.click();
        await sleep(300);
      }
      await moveLever(lever, idx);
      await wait();
      await click("[data-plan-save]");
      await click("[data-plan-save-form] button[type=submit]");
    }
    report.previews = previews;
    const all = Object.values(previews).flat();
    report.previewSummary = { median: median(all), max: all.length > 0 ? Math.max(...all) : null, count: all.length };
    const canon = (dual()?.timings ?? []).filter((t) => t.kind === "canonical");
    report.canonicalSummary = { median: median(canon.map((t) => t.ms)), max: canon.length > 0 ? Math.max(...canon.map((t) => t.ms)) : null, hostMedian: median(canon.map((t) => t.hostMs ?? 0)), count: canon.length, mismatches: dual()?.mismatches ?? null };
    report.plans = [...document.querySelectorAll<HTMLOptionElement>("[data-plan-bar] select option")].map((o) => o.textContent);
    // 6. 収支のグラフ・資産と負債のグラフ
    await click('[data-chart-tab="flows"]');
    report.flows = { bars: document.querySelectorAll(".flow-chart .bar").length, flags: document.querySelectorAll(".flow-chart .flag-band").length };
    await stage("flows", report);
    await click('[data-chart-tab="balance"]');
    report.balance = { bars: document.querySelectorAll(".balance-chart .bar").length };
    await stage("balance", report);
    await click('[data-chart-tab="assets"]');
    // 7. 説明モード（3段目まで進める）
    await click("[data-explain-open]");
    await click("[data-explain-next]");
    await click("[data-explain-next]");
    report.explain = { sentence: text(".ex-sentence"), pos: text(".ex-pos") };
    await stage("explain", report);
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    await sleep(300);
    report.explainClosed = document.querySelector("[data-explain]") === null;
    // 8. 5案を比べる
    // 時間は「案を比べる」を押してから、5案と現状の線と数字の表が出るまで（案の計算はすべて本体で。前の結果は使わない）
    const n0 = compare().length;
    const t0 = performance.now();
    await click("[data-plan-compare]", 0);
    while (document.querySelector("[data-compare-pick]") === null && performance.now() - t0 < 5000) await sleep(5);
    const picks = [...document.querySelectorAll<HTMLInputElement>("[data-compare-pick]")];
    for (const p of picks.slice(0, 5)) {
      if (!p.checked) p.click();
      await sleep(30);
    }
    const want = Math.min(5, picks.length) + 1;
    while ((document.querySelector("[data-compare-table]") === null || document.querySelectorAll(".compare-chart .chart .cmp-line").length < want) && performance.now() - t0 < 20000) await sleep(20);
    report.compare = { ms: Math.round(performance.now() - t0), selected: document.querySelectorAll("[data-compare-pick]:checked").length, series: document.querySelectorAll(".compare-chart .chart .cmp-line").length, host: compare().slice(n0).map((t) => ({ ms: Math.round(t.ms), hostMs: Math.round(t.hostMs), slots: t.slots })) };
    await stage("compare", report, 2500);
    report.ok = true;
  } catch (e) {
    report.ok = false;
    report.error = String(e);
  }
  await fetch("/__dev/report", { method: "POST", body: JSON.stringify(report, null, 2) });
}
