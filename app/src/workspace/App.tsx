// 画面の大枠（作業の層）: 世帯を開き、打ち手を当て、二本立てのエンジンで計算し、提示用の値を作って提示層の部品に渡す
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "preact/hooks";
import { DualEngine } from "../engine/dual.ts";
import { devBrowserHost, isTauri, tauriHost, webEngine, type HostApi, type WebSession } from "../engine/host.ts";
import { isEngineError, type EngineRequest } from "../engine/types.ts";
import { EvidencePanel, type EvidenceState } from "../presentation/EvidencePanel.tsx";
import { monthlyMan } from "../presentation/format.ts";
import { CashflowTable, GoalCards, MainCard } from "../presentation/MainView.tsx";
import { DEMO_HOUSEHOLDS, demoHousehold, type DemoHousehold } from "./catalog.ts";
import { buildEvidence } from "./evidence.ts";
import { LeverPanel, type LeverRow } from "./LeverPanel.tsx";
import { applyLevers, availableLevers, LEVER_KEYS, readLevers, type LeverKey, type LeverValues } from "./levers.ts";
import { toPresentation } from "./present.ts";
import { roles } from "./roles.ts";
import { runSelfCheck } from "./selfcheck.ts";

type Tab = "input" | "main" | "contingency" | "report";
const TABS: { id: Tab; label: string }[] = [
  { id: "input", label: "入力" },
  { id: "main", label: "主画面" },
  { id: "contingency", label: "万一の想定" },
  { id: "report", label: "提案書" },
];

/** URL の # の後ろ（画面の確かめ用: #share・#household=…・#levers=65,65,30000,280000・#year=2047・#evidence=pension:self:2047・#selfcheck） */
export function parseHash(hash: string): { share: boolean; household?: string; levers?: number[]; year?: number; evidence?: { row: string; year: number }; selfcheck: boolean } {
  const out: ReturnType<typeof parseHash> = { share: false, selfcheck: false };
  for (const part of hash.replace(/^#/, "").split("&")) {
    const [k, v] = part.split("=") as [string, string | undefined];
    if (k === "share") out.share = true;
    else if (k === "selfcheck") out.selfcheck = true;
    else if (k === "household" && v !== undefined) out.household = v;
    else if (k === "levers" && v !== undefined) out.levers = v.split(",").map(Number);
    else if (k === "year" && v !== undefined) out.year = Number(v);
    else if (k === "evidence" && v !== undefined) {
      const i = v.lastIndexOf(":");
      out.evidence = { row: v.slice(0, i), year: Number(v.slice(i + 1)) };
    }
  }
  return out;
}

const LEVER_LABEL: Record<LeverKey, (who: string) => string> = {
  retireAge: (who) => `${who}が働く最後の年齢`,
  pensionAge: (who) => `${who}の年金の受け取り開始`,
  nisaMonthly: () => "NISAの積立額（月）",
  livingMonthly: () => "毎月の生活費",
};
const valueText = (k: LeverKey, v: number): string =>
  k === "retireAge" ? `${v}歳まで` : k === "pensionAge" ? `${v}歳から` : k === "nisaMonthly" ? (v === 0 ? "なし" : `月${monthlyMan(v)}`) : `月${monthlyMan(v)}`;
const stepText = (k: LeverKey, v: number): string => (k === "nisaMonthly" || k === "livingMonthly" ? (v === 0 ? "0" : `${v / 10000}万`) : String(v));

function nearestIndex(steps: number[], v: number | undefined): number {
  if (v === undefined) return 0;
  let best = 0;
  steps.forEach((s, i) => {
    if (Math.abs(s - v) < Math.abs((steps[best] as number) - v)) best = i;
  });
  return best;
}

interface Opened {
  demo: DemoHousehold;
  base: EngineRequest;
  selfId: string;
  baseLevers: Partial<LeverValues>;
  available: Set<LeverKey>;
}

export function App() {
  const initial = useMemo(() => parseHash(typeof location === "undefined" ? "" : location.hash), []);
  const [host, setHost] = useState<HostApi | null>(null);
  const [fatal, setFatal] = useState<string | null>(null);
  const [households, setHouseholds] = useState<DemoHousehold[]>([]);
  const [opened, setOpened] = useState<Opened | null>(null);
  const [levers, setLevers] = useState<Partial<LeverValues>>({});
  const [selectedYear, setSelectedYear] = useState<number | null>(initial.year ?? null);
  const [share, setShare] = useState(initial.share);
  const [tab, setTab] = useState<Tab>("main");
  const [evidence, setEvidence] = useState<EvidenceState | null>(null);
  const [, setTick] = useState(0);
  const dual = useRef<DualEngine | null>(null);
  const session = useRef<WebSession | null>(null);
  const leversRef = useRef(levers);
  leversRef.current = levers;

  // 共有用の表示: 文字の大きさ・線の太さは html の class で切り替える（描いた直後に。次の描画を待たない）
  useLayoutEffect(() => {
    document.documentElement.classList.toggle("share", share);
  }, [share]);

  // 起動: 本体（Tauri）か、開発用のサーバー（ブラウザでの確認）か
  useEffect(() => {
    void (async () => {
      try {
        const web = webEngine();
        const h = isTauri() ? tauriHost() : import.meta.env.DEV && web !== null ? devBrowserHost(web) : null;
        if (h === null) throw new Error("E_NO_HOST");
        const packs = await h.packs();
        if (web !== null) {
          const s = web.createSession(packs);
          // パックを読めなかったときは先出しを使わず、本体の計算だけにする
          session.current = s.status().startsWith('{"error"') ? null : s;
        }
        const ids = new Set(await h.listHouseholds());
        const list = DEMO_HOUSEHOLDS.filter((d) => ids.has(d.id));
        setHouseholds(list);
        setHost(h);
      } catch (e) {
        setFatal(e instanceof Error ? e.message : String(e));
      }
    })();
  }, []);

  const requestsFor = useCallback((o: Opened, values: Partial<LeverValues>) => {
    const proposal = applyLevers(o.base, o.selfId, values, o.demo.reemployment !== undefined ? { reemployment: o.demo.reemployment } : {});
    return { current: o.base, proposal };
  }, []);

  const open = useCallback(
    async (id: string, hashLevers?: number[]) => {
      if (host === null) return;
      const demo = demoHousehold(id);
      if (demo === undefined) return;
      const base = await host.openHousehold(id);
      const self = roles(base).find((r) => r.key === "self");
      if (self === undefined) return;
      const baseLevers = readLevers(base, self.member.id);
      const o: Opened = { demo, base, selfId: self.member.id, baseLevers, available: availableLevers(base, self.member.id) };
      let values: Partial<LeverValues> = { ...baseLevers, ...demo.firstProposal };
      if (hashLevers !== undefined) LEVER_KEYS.forEach((k, i) => (hashLevers[i] !== undefined && !Number.isNaN(hashLevers[i]) ? (values = { ...values, [k]: hashLevers[i] }) : null));
      for (const k of LEVER_KEYS) if (!o.available.has(k)) delete values[k];
      setOpened(o);
      setLevers(values);
      setEvidence(null);
      dual.current = new DualEngine({ session: session.current, host, onChange: () => setTick((t) => t + 1) });
      await dual.current.set(requestsFor(o, values));
    },
    [host, requestsFor],
  );

  useEffect(() => {
    if (host === null || households.length === 0) return;
    const id = initial.household !== undefined && households.some((h) => h.id === initial.household) ? initial.household : (households[0] as DemoHousehold).id;
    void open(id, initial.levers);
  }, [host, households, open, initial]);

  const slide = useCallback(
    (key: LeverKey, index: number) => {
      const o = opened;
      if (o === null || dual.current === null) return;
      const v = o.demo.steps[key][index];
      if (v === undefined || leversRef.current[key] === v) return;
      const values = { ...leversRef.current, [key]: v };
      leversRef.current = values;
      setLevers(values);
      dual.current.slide("proposal", { proposal: requestsFor(o, values).proposal });
    },
    [opened, requestsFor],
  );
  const release = useCallback(() => void dual.current?.release(), []);
  const reset = useCallback(
    (to: "current" | "first") => {
      const o = opened;
      if (o === null || dual.current === null) return;
      const values = to === "current" ? { ...o.baseLevers } : { ...o.baseLevers, ...o.demo.firstProposal };
      leversRef.current = values;
      setLevers(values);
      dual.current.slide("proposal", { proposal: requestsFor(o, values).proposal });
      void dual.current.release();
    },
    [opened, requestsFor],
  );

  const cur = dual.current?.view("current");
  const pro = dual.current?.view("proposal");
  const model = useMemo(() => {
    if (opened === null || cur?.result == null || pro?.result == null) return null;
    return toPresentation({
      base: opened.base,
      proposal: requestsFor(opened, levers).proposal,
      current: cur.result,
      proposed: pro.result,
      targetAge: opened.demo.targetAge,
      selectedYear,
      provisional: pro.source !== "canonical" || pro.stale,
    });
  }, [opened, levers, cur?.result, pro?.result, pro?.source, pro?.stale, selectedYear, requestsFor]);

  const showEvidence = useCallback(
    async (rowKey: string, year: number) => {
      if (host === null || opened === null) return;
      const req = { ...requestsFor(opened, leversRef.current).proposal, trace: "full" as const };
      setEvidence({ status: "loading", title: `${year}年` });
      try {
        const full = await host.evidence(JSON.stringify(req));
        if (isEngineError(full)) return setEvidence({ status: "error", title: `${year}年`, code: full.error.code });
        const view = buildEvidence(full, req, rowKey, year);
        setEvidence(view === null ? { status: "error", title: `${year}年`, code: "E_NO_EVIDENCE" } : { status: "ready", view });
      } catch (e) {
        setEvidence({ status: "error", title: `${year}年`, code: typeof e === "string" ? e : "E_HOST" });
      }
    },
    [host, opened, requestsFor],
  );

  // 画面の確かめ用（URL の #evidence=…・#selfcheck）。開発用のサーバーのときだけ
  const once = useRef(false);
  useEffect(() => {
    if (model === null || once.current) return;
    once.current = true;
    if (initial.evidence !== undefined) void showEvidence(initial.evidence.row, initial.evidence.year);
    if (import.meta.env.DEV && initial.selfcheck && dual.current !== null) void runSelfCheck(dual.current, host?.kind ?? "browser-dev");
  }, [model, initial, showEvidence, host]);

  if (import.meta.env.DEV && dual.current !== null) (globalThis as { __financia?: unknown }).__financia = { timings: dual.current.timings, mismatches: () => dual.current?.mismatches };

  const who = model?.members[0]?.label ?? "本人";
  const leverRows: LeverRow[] =
    opened === null
      ? []
      : LEVER_KEYS.filter((k) => opened.available.has(k)).map((k) => {
          const steps = opened.demo.steps[k];
          const v = levers[k];
          const b = opened.baseLevers[k];
          return {
            key: k,
            label: LEVER_LABEL[k](who),
            steps,
            index: nearestIndex(steps, v),
            baseIndex: nearestIndex(steps, b),
            valueText: v !== undefined ? valueText(k, v) : "",
            stepText: (x: number) => stepText(k, x),
            baseText: b !== undefined ? valueText(k, b) : "",
            note: opened.demo.notes?.[k] ?? (k === "pensionAge" && v === 65 ? "原則の65歳" : null),
          };
        });

  const last = dual.current?.timings.filter((t) => t.kind === "preview").at(-1);
  const lastCanon = dual.current?.timings.filter((t) => t.kind === "canonical").at(-1);
  const error = cur?.error ?? pro?.error ?? null;

  return (
    <>
      {share ? (
        <div class="share-banner" role="status">
          共有用の表示中（FP用のメモは隠れています）
        </div>
      ) : null}
      <header class="top">
        <span class="brand">
          <span class="brand-mark" aria-hidden="true" />
          ファイナンシア
        </span>
        {!share && households.length > 0 ? (
          <label class="hh-pick">
            <select value={opened?.demo.id ?? ""} onChange={(e) => void open((e.currentTarget as HTMLSelectElement).value)} aria-label="開く世帯">
              {households.map((h) => (
                <option value={h.id} key={h.id}>
                  {h.title}（架空）
                </option>
              ))}
            </select>
          </label>
        ) : null}
        {model !== null ? (
          <div class="hh">
            <span>{model.members.map((m) => `${m.label} ${m.age}歳`).join("・")}</span>
            {!share ? <span class="tag">{model.asOf}</span> : null}
          </div>
        ) : null}
        {!share ? (
          <nav class="tabs" aria-label="画面">
            {TABS.map((t) => (
              <button type="button" key={t.id} class={t.id === tab ? "on" : ""} aria-current={t.id === tab ? "page" : undefined} onClick={() => setTab(t.id)}>
                {t.label}
              </button>
            ))}
          </nav>
        ) : null}
        <button type="button" class="share-btn" aria-pressed={share} onClick={() => setShare(!share)} data-share-toggle>
          <span class="sw" aria-hidden="true" />
          <span class="lbl">共有用の表示{share ? " ON" : ""}</span>
        </button>
      </header>
      <main class="wrap">
        {fatal !== null ? <p class="fatal">起動できませんでした（{fatal}）</p> : null}
        {error !== null ? <p class="fatal">計算できませんでした（{error}）</p> : null}
        {tab !== "main" && !share ? (
          <section class="card placeholder">
            <h2>{TABS.find((t) => t.id === tab)?.label}</h2>
            <p>準備中です。</p>
          </section>
        ) : model === null ? (
          fatal === null ? <p class="loading">計算しています…</p> : null
        ) : (
          <>
            <div class="grid">
              <aside class="col-goals">
                <GoalCards model={model.goals} />
                {!share && opened !== null ? (
                  <section class="memo" aria-label="FP用のメモ">
                    <div class="memo-h">メモ（顧客には見せない）</div>
                    <ul>
                      {opened.demo.memo.map((m, i) => (
                        <li key={i}>{m}</li>
                      ))}
                    </ul>
                  </section>
                ) : null}
              </aside>
              <MainCard model={model} onSelectYear={setSelectedYear} />
              <LeverPanel levers={leverRows} onSlide={slide} onRelease={release} onReset={reset} />
            </div>
            <CashflowTable model={model.table} selectedYear={model.selectedYear} onSelectYear={setSelectedYear} onEvidence={(r, y) => void showEvidence(r, y)} />
            <div class="foot footnote">
              <span>架空のモデル世帯を、ファイナンシアの計算エンジン（開発版）で計算した結果です。制度データには原本での確認待ちの行があります。</span>
              {import.meta.env.DEV && !share ? (
                <span class="perf">
                  計算の速さ: 先出し {last !== undefined ? `${last.ms.toFixed(0)}ms` : "—"}／正の計算 {lastCanon !== undefined ? `${lastCanon.ms.toFixed(0)}ms（本体 ${lastCanon.hostMs?.toFixed(0) ?? "—"}ms）` : "—"}／{host?.kind}
                </span>
              ) : null}
            </div>
          </>
        )}
      </main>
      {evidence !== null ? <EvidencePanel state={evidence} onClose={() => setEvidence(null)} /> : null}
    </>
  );
}
