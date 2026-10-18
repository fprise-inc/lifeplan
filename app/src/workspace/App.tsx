// 画面の大枠（作業の層）: 世帯を開き、案（現状＋帯に並べた案）を二本立てのエンジンで計算し、提示用の値を作って提示層の部品に渡す。
// 主画面の配置（2026-10-17 に決定）: 上から ① 案の帯 → ② グラフ（幅いっぱい・上下を大きく） → ③ 対策 → ④ 生涯キャッシュフロー表
import type { EngineRequest, PreviewResult } from "../engine/types.ts";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "preact/hooks";
import { DualEngine } from "../engine/dual.ts";
import { devBrowserHost, isTauri, tauriHost, webEngine, type HostApi, type WebSession } from "../engine/host.ts";
import { isEngineError } from "../engine/types.ts";
import { CompareTable } from "../presentation/Compare.tsx";
import { EvidencePanel, type EvidenceState } from "../presentation/EvidencePanel.tsx";
import { group } from "../presentation/format.ts";
import type { ChartMode } from "../presentation/MainChart.tsx";
import { CashflowTable, FeeNote, ResultCard } from "../presentation/MainView.tsx";
import { PlanBand } from "../presentation/PlanBand.tsx";
import { DEMO_HOUSEHOLDS, demoHousehold, type DemoHousehold } from "./catalog.ts";
import { ContingencyTab } from "./contingency/ContingencyTab.tsx";
import { HearingTools } from "./hearing/HearingTools.tsx";
import { ReportTab } from "./report/ReportTab.tsx";
import { runWireCheck } from "./report/wirecheck.ts";
import { DisplaySettingsPanel } from "./DisplaySettingsPanel.tsx";
import { buildEvidence } from "./evidence.ts";
import { explainModel } from "./explain.ts";
import type { Level } from "./input/form.ts";
import { blankHousehold, fromRequest, type WorkingHousehold } from "./input/household.ts";
import { InputView } from "./input/InputView.tsx";
import { addItem, saveItem } from "./input/items.ts";
import { withRefreshedEstimates } from "./input/estimates.ts";
import { LeverCard, type FeeToggle, type LeverRow } from "./LeverPanel.tsx";
import { advisoryFeeInCurrent, hasAdvisoryFee, LEVER_KEYS, type LeverKey } from "./levers.ts";
import { MemoDrawer } from "./MemoDrawer.tsx";
import { mixFromBuckets } from "./plans/allocation.ts";
import { addToBand, bandModel, cleanBand, CURRENT, MAX_BAND, planLetters } from "./plans/band.ts";
import { compareTable, metricsOf } from "./plans/compare.ts";
import { addRate } from "./plans/decimal.ts";
import { ItemMenu, ItemRow } from "./plans/ItemControls.tsx";
import { amountRange, buildCatalog, leverSteps, type Catalog, type ItemValue, type MovableItem } from "./plans/items.ts";
import { PlanList } from "./plans/PlanList.tsx";
import { acknowledge, applyValues, changesOf, changesOfValues, dropChange, effectiveValues, normalizeValues, overwritePlan, reflectPlan, sameValues, savePlan, suggestName, valueOf, type Values } from "./plans/plans.ts";
import { cashflowTable, displayYears, eventsOf, toPresentation, withDiff } from "./present.ts";
import { roles } from "./roles.ts";
import { runContingencyCheck, runInputCheck, runPlansCheck, runSelfCheck } from "./selfcheck.ts";
import { ageMarkOf, DEFAULT_DISPLAY_SETTINGS, METRIC_CHOICES, shows, verdictMetrics, type DisplaySettings, type MetricKey } from "./settings.ts";

type Tab = "input" | "main" | "contingency" | "report";
const TABS: { id: Tab; label: string }[] = [
  { id: "input", label: "入力" },
  { id: "main", label: "主画面" },
  { id: "contingency", label: "万一の想定" },
  { id: "report", label: "提案書" },
];

/** URL の # の後ろ（画面の確かめ用: #big・#household=…（blank は空の世帯）・#levers=65,65,30000,280000・#year=2047・#evidence=pension:self:2047・#selfcheck・#tab=input・#open=work（#stage=work も同じ）・#level=detail・#fee=off・#scenario=death:self・#memo・#add=pet,car（開発用のサーバーだけ: 項目を足して保存した状態で開く）・#chart=flows・#explain=2・
 * #items=loan,rate,shift,mix（開発用のサーバーだけ: 動かす項目を足す）・#seed=plans（開発用のサーバーだけ: 見本の案を5つ）・#seedopen・#addmenu・#save・#selfcheck=plans・
 * #sel=C・#base=B（帯の案の文字）・#diff（表に差を表示）・#settings（表示の設定を開く）・#metrics=assetsAtAge,takeHome・#age=90・#compare（比較の表を開く）・#list（案の一覧を開く）・#scroll=table） */
export function parseHash(hash: string): {
  /** 文字を大きくした状態で開く */
  big: boolean;
  household?: string;
  levers?: number[];
  year?: number;
  evidence?: { row: string; year: number };
  selfcheck: boolean;
  /** #selfcheck=input: 入力の画面の自己確認 */
  selfcheckInput?: boolean;
  tab?: Tab;
  /** 入力のホームで開くパネル（項目の ID） */
  open?: string;
  level?: Level;
  /** メモの引き出しを開いて開く */
  memo?: boolean;
  /** 入力のホームで足して保存した状態にする項目（開発用のサーバーだけ） */
  add?: string[];
  /** #fee=off: FP顧問料を入れない提案で開く */
  feeOff?: boolean;
  /** #scenario=death:self: 万一の画面で開く想定 */
  scenario?: string;
  /** #selfcheck=contingency: 万一の画面の自己確認 */
  selfcheckContingency?: boolean;
  /** #selfcheck=plans: 案の帯・対策・グラフの切り替え・説明モード・比較の表の自己確認 */
  selfcheckPlans?: boolean;
  /** #selfcheck=wire: 提案書の PDF とヒアリングシートの自己確認 */
  selfcheckWire?: boolean;
  /** 主画面のグラフ */
  chart?: ChartMode;
  /** 説明モードを開いた状態（段の番号。0 から） */
  explain?: number;
  /** 対策に足す動かす項目（開発用のサーバーだけ） */
  items?: string[];
  /** 見本の案を作る（開発用のサーバーだけ） */
  seed?: boolean;
  /** 見本の案の2つ目を選んだ状態 */
  seedOpen?: boolean;
  addMenu?: boolean;
  save?: boolean;
  /** 選ぶ案・基準の案（帯の文字） */
  sel?: string;
  base?: string;
  diff?: boolean;
  settings?: boolean;
  metrics?: MetricKey[];
  age?: number;
  compare?: boolean;
  list?: boolean;
  scroll?: "table";
} {
  const out: ReturnType<typeof parseHash> = { big: false, selfcheck: false };
  for (const part of hash.replace(/^#/, "").split("&")) {
    const [k, v] = part.split("=") as [string, string | undefined];
    if (k === "big") out.big = true;
    else if (k === "memo") out.memo = true;
    else if (k === "selfcheck") {
      out.selfcheck = true;
      if (v === "input") out.selfcheckInput = true;
      if (v === "contingency") out.selfcheckContingency = true;
      if (v === "plans") out.selfcheckPlans = true;
      if (v === "wire") out.selfcheckWire = true;
    } else if (k === "chart" && (v === "flows" || v === "balance" || v === "assets")) out.chart = v;
    else if (k === "explain" && v !== undefined && /^\d$/.test(v)) out.explain = Number(v);
    else if (k === "items" && v !== undefined) out.items = v.split(",").filter((x) => /^[a-z]+$/.test(x));
    else if (k === "seed" && v === "plans") out.seed = true;
    else if (k === "seedopen") out.seedOpen = true;
    else if (k === "addmenu") out.addMenu = true;
    else if (k === "save") out.save = true;
    else if (k === "fee" && v === "off") out.feeOff = true;
    else if (k === "add" && v !== undefined) out.add = v.split(",").filter((x) => /^[a-z]+$/.test(x));
    else if (k === "scenario" && v !== undefined) out.scenario = v;
    else if (k === "household" && v !== undefined) out.household = v;
    else if (k === "tab" && TABS.some((t) => t.id === v)) out.tab = v as Tab;
    else if ((k === "open" || k === "stage") && v !== undefined && /^[A-Za-z0-9:-]+$/.test(v)) out.open = v;
    else if (k === "level" && (v === "simple" || v === "detail")) out.level = v;
    else if (k === "levers" && v !== undefined) out.levers = v.split(",").map(Number);
    else if (k === "year" && v !== undefined) out.year = Number(v);
    else if (k === "evidence" && v !== undefined) {
      const i = v.lastIndexOf(":");
      out.evidence = { row: v.slice(0, i), year: Number(v.slice(i + 1)) };
    } else if ((k === "sel" || k === "base") && v !== undefined && /^[A-Z]$/.test(v)) out[k] = v;
    else if (k === "diff") out.diff = true;
    else if (k === "settings") out.settings = true;
    else if (k === "metrics" && v !== undefined) out.metrics = v.split(",").filter((x): x is MetricKey => METRIC_CHOICES.some((c) => c.key === x));
    else if (k === "age" && v !== undefined && /^\d{2,3}$/.test(v)) out.age = Number(v);
    else if (k === "compare") out.compare = true;
    else if (k === "list") out.list = true;
    else if (k === "scroll" && v === "table") out.scroll = "table";
  }
  return out;
}

const BLANK = "__blank__";

const manYen = (n: number) => (n % 10000 === 0 ? `${group(n / 10000)}万円` : `${group(n)}円`);

/** 対策「FP顧問料」の下の一文: 契約の中身の要約（例: 単発30万円＋年額12万円（2027年1月から）） */
export function feeSummary(req: EngineRequest): string {
  return (req.input.household.advisoryFees ?? [])
    .map((c) => {
      const parts: string[] = [];
      const one = (c.terms?.oneTime ?? []).reduce((s, o) => s + o.amount, 0);
      if (one > 0) parts.push(`単発${manYen(one)}`);
      const r = c.terms?.recurring;
      if (r !== undefined) {
        const from = r.from.at !== undefined ? `（${Number(r.from.at.slice(0, 4))}年${Number(r.from.at.slice(5))}月から）` : "";
        if (r.annual !== undefined) parts.push(`年額${manYen(r.annual)}${from}`);
        if (r.monthly !== undefined) parts.push(`月額${manYen(r.monthly)}${from}`);
      }
      return parts.join("＋");
    })
    .filter((x) => x !== "")
    .join("、");
}

export { leverSteps };

function nearestIndex(steps: number[], v: number | undefined): number {
  if (v === undefined) return 0;
  let best = 0;
  steps.forEach((s, i) => {
    if (Math.abs(s - v) < Math.abs((steps[best] as number) - v)) best = i;
  });
  return best;
}

interface Opened {
  /** 見本の世帯（目盛り・最初の提案の既定）。空の世帯は null */
  demo: DemoHousehold | null;
  /** 画面の中で編集する世帯（現状と案） */
  wh: WorkingHousehold;
  selfId: string;
  /** 動かす項目の一覧（現状から作る。現状が変わったら作り直す） */
  catalog: Catalog;
}

function openedFrom(demo: DemoHousehold | null, wh: WorkingHousehold): Opened | null {
  const self = roles(wh.request).find((r) => r.key === "self");
  if (self === undefined) return null;
  return { demo, wh, selfId: self.member.id, catalog: buildCatalog(wh, self.member.id, demo) };
}

/**
 * 主画面の作業の状態（0009 の1。画面の側の状態）: 帯に並べた案・基準の案・選んだ案と、案ごとの保存していない変更（動かした値の全部）。
 * 現状（A）は入力の値そのもので、主画面では動かさない
 */
export interface Work {
  band: string[];
  base: string;
  sel: string;
  drafts: Record<string, Values>;
}

const EMPTY_WORK: Work = { band: [], base: CURRENT, sel: CURRENT, drafts: {} };

/** 案の保存した中身（現状は空） */
export const savedValues = (wh: WorkingHousehold, id: string): Values => (id === CURRENT ? {} : effectiveValues(wh.proposals, id));
/** 案の今の中身（保存していない変更があればそれ） */
export const valuesOf = (wh: WorkingHousehold, w: Work, id: string): Values => w.drafts[id] ?? savedValues(wh, id);
/** 保存していない変更がある案 */
export function modifiedSet(wh: WorkingHousehold, cat: Catalog, w: Work): Set<string> {
  const out = new Set<string>();
  for (const [id, v] of Object.entries(w.drafts)) if (!sameValues(v, savedValues(wh, id), cat)) out.add(id);
  return out;
}

/** 選んだ案を動かせないときの理由（動かせるときは null） */
export function lockReason(w: Work, letter: (id: string) => string): string | null {
  if (w.sel === CURRENT) return `${letter(CURRENT)}案（現状）は入力の画面で直します。上の帯で別の案を選ぶか、「＋ この案を元に作る」で新しい案を作ってから動かしてください。`;
  if (w.sel === w.base) return "基準の案は動かせません。上の帯で別の案を選ぶか、「＋ この案を元に作る」で新しい案を作ってから動かしてください。";
  return null;
}

/** 帯の文字 → 枠（案の ID か現状） */
export const slotOfLetter = (letters: Map<string, { letter: string }>, slots: readonly string[], letter: string): string | undefined => slots.find((id) => letters.get(id)?.letter === letter);

function thisMonth(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

const nowIso = () => new Date().toISOString();

export function App() {
  const initial = useMemo(() => parseHash(typeof location === "undefined" ? "" : location.hash), []);
  const [host, setHost] = useState<HostApi | null>(null);
  const [fatal, setFatal] = useState<string | null>(null);
  const [households, setHouseholds] = useState<DemoHousehold[]>([]);
  const [opened, setOpened] = useState<Opened | null>(null);
  const [work, setWork] = useState<Work>(EMPTY_WORK);
  /** 対策に足した項目（固定の項目のほか）。並びは足した順 */
  const [shown, setShown] = useState<string[]>([]);
  const [menuOpen, setMenuOpen] = useState(initial.addMenu === true);
  const [selectedYear, setSelectedYear] = useState<number | null>(initial.year ?? null);
  const [scrollNonce, setScrollNonce] = useState(0);
  const [big, setBig] = useState(initial.big);
  const [tab, setTab] = useState<Tab>(initial.tab ?? "main");
  const [chartMode, setChartMode] = useState<ChartMode>(initial.chart ?? "assets");
  const [explainStep, setExplainStep] = useState<number | null>(initial.explain ?? null);
  const [tableKey, setTableKey] = useState<string | null>(null);
  const [showDiff, setShowDiff] = useState(initial.diff === true);
  const [settings, setSettings] = useState<DisplaySettings>({ ...DEFAULT_DISPLAY_SETTINGS, ...(initial.metrics !== undefined ? { metrics: initial.metrics } : {}), ...(initial.age !== undefined ? { atAge: initial.age } : {}) });
  const [settingsOpen, setSettingsOpen] = useState(initial.settings === true);
  const [panel, setPanel] = useState<null | "list" | "compare">(initial.compare === true ? "compare" : initial.list === true ? "list" : null);
  const [notice, setNotice] = useState<string | null>(null);
  const [level, setLevel] = useState<Level>(initial.level ?? "simple");
  const [memoOpen, setMemoOpen] = useState(initial.memo === true);
  const openedRef = useRef<Opened | null>(null);
  const workRef = useRef<Work>(work);
  workRef.current = work;
  const settingsRef = useRef<DisplaySettings>(settings);
  settingsRef.current = settings;
  const [evidence, setEvidence] = useState<EvidenceState | null>(null);
  const [, setTick] = useState(0);
  const dual = useRef<DualEngine | null>(null);
  const session = useRef<WebSession | null>(null);
  const compareTimings = useRef<{ ms: number; hostMs: number; slots: number }[]>([]);
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  /** グラフで年を固定する・外す（固定したら表の同じ年の列まで横に動かす） */
  const pinYear = useCallback((y: number | null) => {
    setSelectedYear(y);
    if (y !== null) setScrollNonce((n) => n + 1);
  }, []);
  const say = useCallback((msg: string) => {
    setNotice(msg);
    if (noticeTimer.current !== null) clearTimeout(noticeTimer.current);
    noticeTimer.current = setTimeout(() => setNotice(null), 3200);
  }, []);

  // 文字を大きくする: 文字の大きさ・線の太さは html の class で切り替える（描いた直後に。次の描画を待たない）
  useLayoutEffect(() => {
    document.documentElement.classList.toggle("big", big);
  }, [big]);

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

  // ---- 計算の要求（枠: 現状・帯の案。表示の設定で FP顧問料の一文を出すときは、選んだ案の顧問料を入れ替えた枠 alt も）----
  const reqCache = useRef(new Map<string, EngineRequest>());
  const reqOf = useCallback((o: Opened, values: Values): EngineRequest => {
    const key = JSON.stringify(values);
    const hit = reqCache.current.get(key);
    if (hit !== undefined) return hit;
    const r = applyValues(o.wh, values, o.catalog);
    if (reqCache.current.size > 64) reqCache.current.clear();
    reqCache.current.set(key, r);
    return r;
  }, []);
  const feeOf = (o: Opened, values: Values) => (typeof values["lever:fee"] === "boolean" ? (values["lever:fee"] as boolean) : advisoryFeeInCurrent(o.wh.request));
  const altFor = useCallback(
    (o: Opened, w: Work, s: DisplaySettings): EngineRequest | null => {
      if (!shows(s, "feeLine") || !hasAdvisoryFee(o.wh.request) || w.sel === CURRENT) return null;
      const v = valuesOf(o.wh, w, w.sel);
      return reqOf(o, { ...v, "lever:fee": !feeOf(o, v) });
    },
    [reqOf],
  );
  const requestsFor = useCallback(
    (o: Opened, w: Work, s: DisplaySettings): Record<string, EngineRequest> => {
      const out: Record<string, EngineRequest> = { [CURRENT]: o.wh.request };
      for (const id of w.band) out[id] = reqOf(o, valuesOf(o.wh, w, id));
      const alt = altFor(o, w, s);
      if (alt !== null) out.alt = alt;
      return out;
    },
    [reqOf, altFor],
  );

  /** 作業の状態を置き直して計算する。slide: 選んだ案の1枠だけ先出し、release: 先出しのあと正の計算、set: 全部の枠（帯が変わったとき） */
  const putWork = useCallback(
    (w: Work, o: Opened | null = openedRef.current, mode: "slide" | "release" | "set" = "set") => {
      workRef.current = w;
      setWork(w);
      if (o === null || dual.current === null) return;
      const all = requestsFor(o, w, settingsRef.current);
      if (mode === "set") {
        dual.current.retain(Object.keys(all));
        void dual.current.set(all);
        return;
      }
      const focus: Record<string, EngineRequest> = { [w.sel]: all[w.sel] as EngineRequest };
      if (all.alt !== undefined) focus.alt = all.alt;
      dual.current.slide(w.sel, focus);
      if (mode === "release") void dual.current.release();
    },
    [requestsFor],
  );

  const addOnce = useRef(false);
  const seedOnce = useRef(false);
  const open = useCallback(
    async (id: string, hashLevers?: number[]) => {
      if (host === null) return;
      let o: Opened | null;
      if (id === BLANK) o = openedFrom(null, withRefreshedEstimates(blankHousehold(thisMonth())));
      else {
        const demo = demoHousehold(id);
        if (demo === undefined) return;
        const base = await host.openHousehold(id);
        const self = roles(base).find((r) => r.key === "self");
        if (self === undefined) return;
        const re = demo.reemployment;
        const wh = fromRequest(base, { memo: demo.memo, ...(re !== undefined ? { postRetirement: { [self.member.id]: { ...re, type: re.type as "contract" } } } : {}) });
        o = openedFrom(demo, wh);
      }
      if (o === null) return;
      reqCache.current.clear();
      // 画面の確かめ用（#add=…）: 項目を足して保存した状態にする。開発用のサーバーのときだけ
      if (import.meta.env.DEV && initial.add !== undefined && !addOnce.current) {
        addOnce.current = true;
        let w = o.wh;
        for (const k of initial.add) {
          const r = addItem(w, k);
          if (r !== null) w = saveItem(r.wh, r.itemId);
        }
        o = openedFrom(o.demo, w) ?? o;
      }
      // 最初の案（見本の世帯の既定・URL の #levers）を「B案」として帯に置く。FP顧問料は既定で入れる（#fee=off で入れない）
      const first: Values = {};
      const fp = o.demo?.firstProposal ?? {};
      LEVER_KEYS.forEach((k, i) => {
        const hv = hashLevers?.[i];
        const v = hv !== undefined && !Number.isNaN(hv) ? hv : fp[k];
        if (v !== undefined) first[`lever:${k}`] = v;
      });
      if (hasAdvisoryFee(o.wh.request)) first["lever:fee"] = initial.feeOff !== true;
      const values = normalizeValues(first, {}, o.wh, o.catalog);
      let band: string[] = [];
      let shownKeys: string[] = [];
      if (import.meta.env.DEV && initial.seed === true && !seedOnce.current) {
        seedOnce.current = true;
        // 画面の確かめ用（開発用のサーバーだけ）: #seed=plans で見本の案を5つ作り、帯に並べる
        const seeded = seedPlans(o, values);
        o = { ...o, wh: seeded.wh };
        band = seeded.ids.slice(0, MAX_BAND);
        shownKeys = seeded.keys;
      } else if (Object.keys(values).length > 0) {
        const r = savePlan(o.wh, o.catalog, { name: suggestName(o.wh.proposals, values, o.wh, o.catalog), base: null, values, now: nowIso() });
        o = { ...o, wh: r.wh };
        band = [r.id];
      }
      if (import.meta.env.DEV) shownKeys = [...new Set([...devItems(o.catalog, initial.items ?? []), ...shownKeys])];
      const letters = planLetters(o.wh.proposals);
      const slots = [CURRENT, ...band];
      const pickSel = initial.sel !== undefined ? slotOfLetter(letters, slots, initial.sel) : initial.seedOpen === true ? band[1] : band[0];
      const pickBase = initial.base !== undefined ? slotOfLetter(letters, slots, initial.base) : undefined;
      const w: Work = { band, base: pickBase ?? CURRENT, sel: pickSel ?? band[0] ?? CURRENT, drafts: {} };
      openedRef.current = o;
      workRef.current = w;
      setOpened(o);
      setWork(w);
      setShown(shownKeys);
      setTableKey(null);
      setEvidence(null);
      dual.current = new DualEngine({ session: session.current, host, onChange: () => setTick((t) => t + 1) });
      // 速さの計測: 帯の案と現状の枠を、開いてから正の計算がそろうまで（5案の比較の目標 3秒）
      const t0 = performance.now();
      const all = requestsFor(o, w, settingsRef.current);
      await dual.current.set(all);
      const canon = dual.current.timings.filter((t) => t.kind === "canonical").at(-1);
      compareTimings.current.push({ ms: performance.now() - t0, hostMs: canon?.hostMs ?? 0, slots: Object.keys(all).length });
      setTick((t) => t + 1);
    },
    [host, requestsFor, initial],
  );

  useEffect(() => {
    if (host === null || households.length === 0) return;
    const id = initial.household === "blank" ? BLANK : initial.household !== undefined && households.some((h) => h.id === initial.household) ? initial.household : (households[0] as DemoHousehold).id;
    void open(id, initial.levers);
  }, [host, households, open, initial]);

  /** 作業の状態を新しい世帯（案の一覧）に合わせる: 消えた案を帯から外し、保存していない変更を整える */
  const fitWork = (o: Opened, w: Work): Work => {
    const band = cleanBand(w.band, o.wh.proposals);
    const live = new Set([CURRENT, ...o.wh.proposals.map((p) => p.id)]);
    const inBand = (id: string) => id === CURRENT || band.includes(id);
    const drafts: Record<string, Values> = {};
    for (const [id, v] of Object.entries(w.drafts)) {
      if (!live.has(id) || id === CURRENT) continue;
      const nv = normalizeValues(v, savedValues(o.wh, id), o.wh, o.catalog);
      if (!sameValues(nv, savedValues(o.wh, id), o.catalog)) drafts[id] = nv;
    }
    return { band, base: inBand(w.base) ? w.base : CURRENT, sel: inBand(w.sel) ? w.sel : (band[0] ?? CURRENT), drafts };
  };

  /** 現状（入力）を置き換える: 推定を入れ直し、動かす項目を作り直し、案を新しい現状に当て直して計算し直す */
  const replaceCurrent = useCallback(
    (next: WorkingHousehold, nextWork?: Work) => {
      const o = openedRef.current;
      if (o === null || dual.current === null) return;
      const n = openedFrom(o.demo, withRefreshedEstimates(next));
      if (n === null) return;
      reqCache.current.clear();
      const w = fitWork(n, nextWork ?? workRef.current);
      openedRef.current = n;
      workRef.current = w;
      setOpened(n);
      setWork(w);
      const all = requestsFor(n, w, settingsRef.current);
      dual.current.retain(Object.keys(all));
      dual.current.slide(w.sel, all);
    },
    [requestsFor],
  );
  /** 入力の画面で世帯（現状）を変えた */
  const edit = useCallback((next: WorkingHousehold) => replaceCurrent(next), [replaceCurrent]);

  /** 案の一覧だけを変えた（名前・印・保存・外す）。現状は同じ */
  const setPlans = useCallback(
    (next: WorkingHousehold, nextWork?: Work) => {
      const o = openedRef.current;
      if (o === null) return;
      const n = { ...o, wh: next };
      reqCache.current.clear();
      openedRef.current = n;
      setOpened(n);
      putWork(fitWork(n, nextWork ?? workRef.current), n, "set");
    },
    [putWork],
  );

  const setValue = useCallback(
    (key: string, v: ItemValue, mode: "slide" | "release" = "slide") => {
      const o = openedRef.current;
      const w = workRef.current;
      if (o === null || lockReason(w, () => "A") !== null) return;
      const it = o.catalog.byKey.get(key);
      if (it === undefined) return;
      const cur = valuesOf(o.wh, w, w.sel);
      const prev = valueOf(it, cur, o.wh);
      if (it.same(prev, v) && mode === "slide") return;
      const saved = savedValues(o.wh, w.sel);
      const nv = normalizeValues({ ...cur, [key]: v }, saved, o.wh, o.catalog);
      const drafts = { ...w.drafts };
      if (sameValues(nv, saved, o.catalog)) delete drafts[w.sel];
      else drafts[w.sel] = nv;
      putWork({ ...w, drafts }, o, mode);
    },
    [putWork],
  );

  const leverItemsOf = (o: Opened) => o.catalog.items.filter((it) => it.phase === "lever");
  /** 対策の固定の項目を動かした（v は値。目盛りのスライダーは目盛りの値、金額は1万円の刻みの円） */
  const slide = useCallback(
    (key: LeverKey, v: number) => {
      const o = openedRef.current;
      const it = o?.catalog.byKey.get(`lever:${key}`);
      if (it === undefined || (it.control.kind !== "steps" && it.control.kind !== "range")) return;
      setValue(it.key, v);
    },
    [setValue],
  );
  const release = useCallback(() => void dual.current?.release(), []);
  const toggleFee = useCallback(() => {
    const o = openedRef.current;
    if (o === null) return;
    setValue("lever:fee", !feeOf(o, valuesOf(o.wh, workRef.current, workRef.current.sel)), "release");
  }, [setValue]);

  // ---- 案の操作 ----
  const letters = useMemo(() => (opened === null ? new Map<string, { letter: string; name: string }>() : planLetters(opened.wh.proposals)), [opened]);
  const letterOf = (id: string) => letters.get(id)?.letter ?? "?";

  /** 帯のカードを押した: その案を選ぶ（グラフの実線・1文・対策・表がその案に替わる） */
  const select = useCallback(
    (letter: string) => {
      const o = openedRef.current;
      const w = workRef.current;
      if (o === null) return;
      const id = slotOfLetter(planLetters(o.wh.proposals), [CURRENT, ...w.band], letter);
      if (id === undefined || id === w.sel) return;
      const v = valuesOf(o.wh, w, id);
      setShown((s) => [...new Set([...s, ...Object.keys(v).filter((k) => o.catalog.byKey.get(k)?.builtin === false)])]);
      setTableKey(null);
      putWork({ ...w, sel: id }, o, "set");
    },
    [putWork],
  );
  const setBase = useCallback(
    (letter: string) => {
      const o = openedRef.current;
      const w = workRef.current;
      if (o === null) return;
      const id = slotOfLetter(planLetters(o.wh.proposals), [CURRENT, ...w.band], letter);
      if (id !== undefined) putWork({ ...w, base: id }, o, "set");
    },
    [putWork],
  );
  /** 新しい案を帯に足して選ぶ（帯がいっぱいなら、選んでいない・基準でない案を1つ帯から外す） */
  const placeNew = useCallback(
    (w: Work, wh: WorkingHousehold, id: string, drafts: Record<string, Values>, msg: string) => {
      const r = addToBand(w.band, id, [w.sel, w.base]);
      const ls = planLetters(wh.proposals);
      setPlans(wh, { ...w, band: r.band, sel: id, drafts });
      setTableKey(null);
      say(r.dropped !== null ? `${msg}（帯は${MAX_BAND}案までのため、${ls.get(r.dropped)?.letter ?? ""}案を帯から外しました。一覧に残っています）` : msg);
    },
    [setPlans, say],
  );
  /** ＋ この案を元に作る: 選んでいる案（保存していない変更を含む）を写して新しい案を作り、そのまま選ぶ */
  const duplicate = useCallback(() => {
    const o = openedRef.current;
    const w = workRef.current;
    if (o === null) return;
    const src = w.sel;
    const srcLetter = planLetters(o.wh.proposals).get(src)?.letter ?? "A";
    const head = suggestName(o.wh.proposals, savedValues(o.wh, src), o.wh, o.catalog, src === CURRENT ? null : src).replace(/^([A-Z]案).*$/, "$1");
    const r = savePlan(o.wh, o.catalog, { name: `${head} ${srcLetter}案を元に`, base: src === CURRENT ? null : src, values: valuesOf(o.wh, w, src), now: nowIso() });
    const newLetter = planLetters(r.wh.proposals).get(r.id)?.letter ?? "";
    placeNew(w, r.wh, r.id, w.drafts, `${srcLetter}案を写して ${newLetter}案 を作りました。下の対策で動かしてください`);
  }, [placeNew]);
  /** 案として保存: 選んでいる案の今の中身を新しい案にする（元の案は保存した内容のまま残す） */
  const saveNew = useCallback(
    (name: string) => {
      const o = openedRef.current;
      const w = workRef.current;
      if (o === null || w.sel === CURRENT) return;
      const r = savePlan(o.wh, o.catalog, { name, base: w.sel, values: valuesOf(o.wh, w, w.sel), now: nowIso() });
      const drafts = { ...w.drafts };
      delete drafts[w.sel];
      const l = planLetters(r.wh.proposals).get(r.id);
      placeNew(w, r.wh, r.id, drafts, `${l?.letter ?? ""}案「${l?.name ?? name}」として保存しました`);
    },
    [placeNew],
  );
  const overwrite = useCallback(() => {
    const o = openedRef.current;
    const w = workRef.current;
    if (o === null || w.sel === CURRENT) return;
    const drafts = { ...w.drafts };
    delete drafts[w.sel];
    setPlans(overwritePlan(o.wh, o.catalog, w.sel, valuesOf(o.wh, w, w.sel), nowIso()), { ...w, drafts });
    say(`${planLetters(o.wh.proposals).get(w.sel)?.letter ?? ""}案を上書きしました`);
  }, [setPlans, say]);
  const resetDraft = useCallback(() => {
    const o = openedRef.current;
    const w = workRef.current;
    if (o === null) return;
    const drafts = { ...w.drafts };
    delete drafts[w.sel];
    putWork({ ...w, drafts }, o, "release");
  }, [putWork]);
  /** 案の一覧で、帯に出す・外す */
  const toggleBand = useCallback(
    (id: string, on: boolean) => {
      const o = openedRef.current;
      const w = workRef.current;
      if (o === null) return;
      if (on) {
        if (w.band.length >= MAX_BAND) return;
        putWork({ ...w, band: [...w.band, id] }, o, "set");
      } else {
        const band = w.band.filter((x) => x !== id);
        const drafts = { ...w.drafts };
        delete drafts[id];
        putWork({ band, base: w.base === id ? CURRENT : w.base, sel: w.sel === id ? (band[0] ?? CURRENT) : w.sel, drafts }, o, "set");
      }
    },
    [putWork],
  );
  const reflect = useCallback(
    (planId: string) => {
      const o = openedRef.current;
      const w = workRef.current;
      if (o === null) return;
      const draft = w.drafts[planId];
      const useDraft = draft !== undefined && !sameValues(draft, savedValues(o.wh, planId), o.catalog);
      const next = useDraft ? { ...o.wh, request: applyValues(o.wh, draft, o.catalog) } : reflectPlan(o.wh, o.catalog, planId, nowIso());
      const drafts = { ...w.drafts };
      delete drafts[planId];
      replaceCurrent(next, { ...w, drafts });
      void dual.current?.release();
    },
    [replaceCurrent],
  );

  // ---- 提示用の値 ----
  const slots = useMemo(() => [CURRENT, ...work.band], [work.band]);
  const views = new Map(slots.map((id) => [id, dual.current?.view(id) ?? null]));
  const resultOf = (id: string): PreviewResult | null => views.get(id)?.result ?? null;
  const selRes = resultOf(work.sel);
  const baseRes = resultOf(work.base);
  const selView = views.get(work.sel) ?? null;
  const altRes = dual.current?.view("alt").result ?? null;
  const selValues = opened === null ? {} : valuesOf(opened.wh, work, work.sel);
  const selReq = useMemo(() => (opened === null ? null : reqOf(opened, valuesOf(opened.wh, work, work.sel))), [opened, work, reqOf]);
  const feeOn = opened !== null && hasAdvisoryFee(opened.wh.request) ? feeOf(opened, selValues) : false;
  const names = { selected: `${letterOf(work.sel)}案`, base: `${letterOf(work.base)}案`, same: work.sel === work.base };
  const feeShown = opened !== null && shows(settings, "feeLine") && hasAdvisoryFee(opened.wh.request) && work.sel !== CURRENT;
  const provisional = selView?.source !== "canonical" || selView.stale;
  const model = useMemo(() => {
    if (opened === null || selReq === null || selRes === null || baseRes === null) return null;
    const fee = feeShown ? { on: feeOn, withFee: feeOn ? selRes : altRes, alt: altRes } : undefined;
    const m = toPresentation({ base: opened.wh.request, proposal: selReq, current: baseRes, proposed: selRes, targetAge: settings.atAge, selectedYear, provisional, names, ...(fee !== undefined ? { fee } : {}) });
    const extra = verdictMetrics(settings, { name: names.selected, m: metricsOf(opened.wh.request, selRes.table, settings.atAge) }, names.same ? null : { name: names.base, m: metricsOf(opened.wh.request, baseRes.table, settings.atAge) });
    return extra.length > 0 ? { ...m, result: { ...m.result, sub: [...m.result.sub, ...extra] } } : m;
  }, [opened, selReq, selRes, baseRes, altRes, feeOn, feeShown, selectedYear, provisional, settings, names.selected, names.base, names.same]);
  const explain = useMemo(
    () => (explainStep === null || opened === null || selReq === null || selRes === null ? null : explainModel(selReq, selRes, settings.atAge)),
    [explainStep !== null, opened, selReq, selRes, settings.atAge],
  );
  const modified = useMemo(() => (opened === null ? new Set<string>() : modifiedSet(opened.wh, opened.catalog, work)), [opened, work]);
  const band = opened === null ? null : bandModel({ req: opened.wh.request, slots, letters, results: new Map(slots.map((id) => [id, resultOf(id)])), modified, base: work.base, selected: work.sel, settings });

  // 表: 見る案（既定は選んだ案）と、基準との差
  const tKey = tableKey !== null && slots.includes(tableKey) ? tableKey : work.sel;
  const tRes = resultOf(tKey);
  const tReq = opened === null ? null : tKey === work.sel ? selReq : reqOf(opened, valuesOf(opened.wh, work, tKey));
  const table = useMemo(() => {
    if (opened === null || model === null || tRes === null || tReq === null) return null;
    const years = displayYears(opened.wh.request);
    let t = tKey === work.sel ? model.table : cashflowTable(tReq, tRes.table, years, "生涯キャッシュフロー表", eventsOf(tReq, tRes.table, years));
    if (showDiff && tKey !== work.base && baseRes !== null) t = withDiff(tReq, t, tRes.table, baseRes.table, `差（${letterOf(tKey)}−${letterOf(work.base)}）`);
    return t;
  }, [opened, model, tRes, tReq, tKey, work.sel, work.base, showDiff, baseRes, letters]);

  const showEvidence = useCallback(
    async (rowKey: string, year: number) => {
      if (host === null || tReq === null) return;
      const req = { ...tReq, trace: "full" as const };
      setMemoOpen(false);
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
    [host, tReq],
  );

  // 画面の確かめ用（URL の #evidence=…・#selfcheck・#scroll=table）。開発用のサーバーのときだけ
  const once = useRef(false);
  useEffect(() => {
    if (model === null || once.current) return;
    once.current = true;
    if (initial.evidence !== undefined) void showEvidence(initial.evidence.row, initial.evidence.year);
    if (initial.scroll === "table")
      setTimeout(() => {
        document.querySelector("[data-cf-card]")?.scrollIntoView({ block: "start" });
        setScrollNonce((n) => n + 1);
      }, 300);
    if (import.meta.env.DEV && initial.selfcheck && dual.current !== null) {
      if (initial.selfcheckInput === true) void runInputCheck(() => dual.current, host?.kind ?? "browser-dev");
      else if (initial.selfcheckContingency === true) void runContingencyCheck(host?.kind ?? "browser-dev");
      else if (initial.selfcheckWire === true) void runWireCheck(host?.kind ?? "browser-dev");
      else if (initial.selfcheckPlans === true) void runPlansCheck(() => dual.current, host?.kind ?? "browser-dev", () => compareTimings.current);
      else void runSelfCheck(dual.current, host?.kind ?? "browser-dev");
    }
  }, [model, initial, showEvidence, host]);

  if (import.meta.env.DEV && dual.current !== null) (globalThis as { __financia?: unknown }).__financia = { timings: dual.current.timings, mismatches: () => dual.current?.mismatches, compare: compareTimings.current };

  const locked = lockReason(work, letterOf);
  /** 固定した年（グラフの○と表の光る列）。表示する年の外の年は固定しない */
  const pinnedYear = selectedYear !== null && model?.selectedYear === selectedYear ? selectedYear : null;
  const baseValues = opened === null ? {} : valuesOf(opened.wh, work, work.base);
  const leverRows: LeverRow[] =
    opened === null
      ? []
      : leverItemsOf(opened).flatMap((it): LeverRow[] => {
          const c = it.control;
          if (c.kind !== "steps" && c.kind !== "range") return [];
          const v = valueOf(it, selValues, opened.wh);
          const b = valueOf(it, baseValues, opened.wh);
          const vn = typeof v === "number" ? v : undefined;
          const bn = typeof b === "number" ? b : undefined;
          const common = { key: it.key.slice(6) as LeverKey, label: it.label, valueText: it.text(v), baseText: it.text(b), note: it.note?.(v) ?? null };
          if (c.kind === "steps")
            return [{ ...common, slider: { kind: "steps", steps: c.steps, index: nearestIndex(c.steps, vn), baseIndex: nearestIndex(c.steps, bn), stepText: c.tick } }];
          // 金額: 1万円の刻み。今の値・基準の値が範囲の外なら範囲を広げる（数値の欄で直接入れたとき）
          const r = amountRange(c.min, c.max, vn, bn);
          return [{ ...common, slider: { kind: "amount", min: r.min, max: r.max, step: c.step, value: vn ?? r.min, base: bn ?? r.min, per: c.per ?? "", tick: c.tick } }];
        });
  const feeToggle: FeeToggle | null =
    opened !== null && hasAdvisoryFee(opened.wh.request) ? { on: feeOn, inBase: feeOf(opened, baseValues), note: feeSummary(opened.wh.request), onToggle: toggleFee } : null;

  const last = dual.current?.timings.filter((t) => t.kind === "preview").at(-1);
  const lastCanon = dual.current?.timings.filter((t) => t.kind === "canonical").at(-1);
  const error = selView?.error ?? views.get(work.base)?.error ?? null;

  // 対策の「変えたこと」と保存の名前の例
  const planInfo = useMemo(() => {
    if (opened === null || work.sel === CURRENT) return { changes: [], suggested: "" };
    const v = valuesOf(opened.wh, work, work.sel);
    const changes = !modified.has(work.sel) ? changesOf(opened.wh.proposals, work.sel, opened.wh, opened.catalog) : changesOfValues(v, opened.wh, opened.catalog);
    return { changes, suggested: suggestName(opened.wh.proposals, v, opened.wh, opened.catalog, work.sel) };
  }, [opened, work, modified]);

  const shownSet = new Set(shown);
  const removeItem = (o: Opened, k: string) => {
    setShown((s) => s.filter((x) => x !== k));
    const w = workRef.current;
    const cur = valuesOf(o.wh, w, w.sel);
    if (lockReason(w, letterOf) !== null || !Object.hasOwn(cur, k)) return;
    const { [k]: _drop, ...rest } = cur;
    void _drop;
    const saved = savedValues(o.wh, w.sel);
    const nv = normalizeValues(rest, saved, o.wh, o.catalog);
    const drafts = { ...w.drafts };
    if (sameValues(nv, saved, o.catalog)) delete drafts[w.sel];
    else drafts[w.sel] = nv;
    putWork({ ...w, drafts }, o, "release");
  };
  const addedRows =
    opened === null
      ? []
      : shown
          .map((k) => opened.catalog.byKey.get(k))
          .filter((it): it is MovableItem => it !== undefined)
          .map((it) => (
            <ItemRow
              key={it.key}
              item={it}
              value={valueOf(it, selValues, opened.wh)}
              base={valueOf(it, baseValues, opened.wh)}
              baseLabel={`基準（${letterOf(work.base)}）`}
              wh={opened.wh}
              onSlide={(k, v) => setValue(k, v)}
              onRelease={release}
              onRemove={(k) => removeItem(opened, k)}
            />
          ));

  // 比較の表（現状と帯の案。基準の案との差）
  const compareResults = slots.map((id) => resultOf(id));
  const compareModel = useMemo(() => {
    if (panel !== "compare" || opened === null || compareResults.some((r) => r === null)) return null;
    return compareTable(
      opened.wh.request,
      slots.map((id, i) => ({ name: `${letterOf(id)}案 ${letters.get(id)?.name ?? ""}`, table: (compareResults[i] as PreviewResult).table })),
      settings.atAge,
      Math.max(0, slots.indexOf(work.base)),
    );
  }, [panel, opened, slots, work.base, settings.atAge, letters, ...compareResults]);

  const drawer = memoOpen || evidence !== null;
  const ageMark = opened === null ? null : ageMarkOf(settings, opened.wh.request);
  return (
    <div class={`app${drawer ? " has-drawer" : ""}`}>
      <header class="top">
        <span class="brand">
          <span class="brand-mark" aria-hidden="true" />
          ファイナンシア
        </span>
        {households.length > 0 ? (
          <label class="hh-pick">
            <select value={opened === null ? "" : (opened.demo?.id ?? BLANK)} onChange={(e) => void open((e.currentTarget as HTMLSelectElement).value)} aria-label="開く世帯">
              {households.map((h) => (
                <option value={h.id} key={h.id}>
                  {h.title}（架空）
                </option>
              ))}
              <option value={BLANK}>新しい世帯（空から入れる）</option>
            </select>
          </label>
        ) : null}
        {model !== null ? (
          <div class="hh">
            <span>{model.members.map((m) => `${m.label} ${m.age}歳`).join("・")}</span>
            <span class="tag">{model.asOf}</span>
          </div>
        ) : null}
        <nav class="tabs" aria-label="画面">
          {TABS.map((t) => (
            <button type="button" key={t.id} class={t.id === tab ? "on" : ""} aria-current={t.id === tab ? "page" : undefined} onClick={() => setTab(t.id)}>
              {t.label}
            </button>
          ))}
        </nav>
        {opened !== null ? (
          <button
            type="button"
            class="memo-btn"
            aria-expanded={memoOpen}
            onClick={() => {
              setEvidence(null);
              setMemoOpen(!memoOpen);
            }}
            data-memo-toggle
          >
            メモ{opened.wh.memo.length > 0 ? <span class="memo-n">{opened.wh.memo.length}</span> : null}
          </button>
        ) : null}
        <button type="button" class="big-btn" aria-pressed={big} onClick={() => setBig(!big)} data-big-toggle>
          <span class="sw" aria-hidden="true" />
          <span class="aa" aria-hidden="true">
            あ<b>あ</b>
          </span>
          <span>文字を大きくする</span>
        </button>
      </header>
      <main class="wrap">
        {fatal !== null ? <p class="fatal">起動できませんでした（{fatal}）</p> : null}
        {error !== null && tab !== "input" ? <p class="fatal">計算できませんでした（{error}）</p> : null}
        {tab === "input" && opened !== null ? (
          <>
            {error !== null ? <p class="fatal">今の入力では計算できませんでした（{error}）</p> : null}
            {opened.wh.proposals.length > 0 ? <p class="in-note plans-note">入力（現状）を直すと、保存した案（{opened.wh.proposals.length}件）にも反映されます。案が指していた物を外すと、その案に「要確認」が出ます。</p> : null}
            <InputView
              wh={opened.wh}
              onSave={edit}
              level={level}
              onLevel={setLevel}
              {...(initial.open !== undefined ? { initialOpen: initial.open } : {})}
              {...(host !== null ? { tools: <HearingTools wh={opened.wh} sheets={host.sheets} onSave={edit} /> } : {})}
            />
          </>
        ) : tab === "contingency" && opened !== null ? (
          <ContingencyTab wh={opened.wh} host={host} targetAge={opened.demo?.targetAge ?? 95} onEdit={edit} {...(initial.scenario !== undefined ? { initialScenario: initial.scenario } : {})} />
        ) : tab === "report" && opened !== null && host !== null ? (
          <ReportTab
            host={host}
            wh={opened.wh}
            catalog={opened.catalog}
            band={work.band}
            base={work.base}
            selected={work.sel}
            modified={modified}
            valuesOf={(id) => valuesOf(opened.wh, work, id)}
            letterOf={(id) => ({ letter: letterOf(id), name: id === CURRENT ? "現状" : (letters.get(id)?.name ?? "") })}
            targetAge={settings.atAge}
          />
        ) : model === null || opened === null || band === null ? (
          fatal === null ? <p class="loading">計算しています…</p> : null
        ) : (
          <div class="main-stack">
            {/* ① 案の帯 */}
            <PlanBand
              model={band}
              onSelect={select}
              onBase={setBase}
              onAdd={duplicate}
              links={
                <span class="band-links">
                  <button type="button" class="link-btn" aria-expanded={panel === "list"} onClick={() => setPanel(panel === "list" ? null : "list")} data-open-list>
                    一覧から選ぶ（{opened.wh.proposals.length}）
                  </button>
                  <button type="button" class="link-btn" aria-expanded={panel === "compare"} onClick={() => setPanel(panel === "compare" ? null : "compare")} data-open-compare>
                    比較の表を見る
                  </button>
                </span>
              }
            />
            {panel === "list" ? <PlanList wh={opened.wh} catalog={opened.catalog} letters={letters} band={work.band} onBand={toggleBand} onEdit={(w) => setPlans(w)} onReflect={reflect} onClose={() => setPanel(null)} /> : null}
            {panel === "compare" ? (
              <section class="card compare-card" aria-label="案の比較" data-compare>
                <div class="card-h">
                  <h2>
                    案の比較（{slots.length}案。基準: {letterOf(work.base)}案）
                  </h2>
                  <span class="aside">{compareModel === null ? "計算しています…" : "帯に並べた案の主な数字。差はいつも「その案−基準」"}</span>
                  <button type="button" class="btn" onClick={() => setPanel(null)}>
                    閉じる
                  </button>
                </div>
                {compareModel !== null ? <CompareTable model={compareModel} /> : null}
              </section>
            ) : null}
            {/* ② グラフ */}
            <ResultCard
              model={model}
              verdict={model.result}
              provisional={model.provisional}
              mode={chartMode}
              onMode={setChartMode}
              explain={explain !== null && explainStep !== null ? { model: explain, step: explainStep } : null}
              onExplain={setExplainStep}
              ageMark={ageMark}
              pinnedYear={pinnedYear}
              onSelectYear={pinYear}
              tools={
                <button type="button" class="set-btn" aria-expanded={settingsOpen} onClick={() => setSettingsOpen(!settingsOpen)} data-settings-open>
                  表示の設定{settings.metrics.length > 0 ? <span class="memo-n">{settings.metrics.length}</span> : null}
                </button>
              }
              below={
                <>
                  {settingsOpen ? (
                    <DisplaySettingsPanel
                      value={settings}
                      feeAvailable={hasAdvisoryFee(opened.wh.request)}
                      onChange={(s) => {
                        settingsRef.current = s;
                        setSettings(s);
                        // FP顧問料の一文の枠（alt）を足す・外す
                        putWork(workRef.current, openedRef.current, "set");
                      }}
                      onClose={() => setSettingsOpen(false)}
                    />
                  ) : null}
                  {model.fee !== null ? <FeeNote model={model.fee} /> : null}
                </>
              }
            />
            {/* ③ 対策 */}
            <LeverCard
              selected={names.selected}
              baseLetter={letterOf(work.base)}
              locked={locked}
              modified={modified.has(work.sel)}
              levers={leverRows}
              fee={feeToggle}
              onSlide={slide}
              onRelease={release}
              onReset={resetDraft}
              onOverwrite={work.sel !== CURRENT ? overwrite : null}
              onSaveNew={saveNew}
              suggested={planInfo.suggested}
              changes={planInfo.changes}
              onAck={work.sel !== CURRENT && !modified.has(work.sel) ? (k) => setPlans(acknowledge(opened.wh, opened.catalog, work.sel, k)) : null}
              onDrop={work.sel !== CURRENT && !modified.has(work.sel) ? (k) => setPlans(dropChange(opened.wh, opened.catalog, work.sel, k)) : null}
              {...(initial.save === true ? { initialSave: true } : {})}
              addRow={
                <div class="add-row">
                  {menuOpen ? (
                    <ItemMenu
                      catalog={opened.catalog}
                      shown={shownSet}
                      onPick={(k) => {
                        setShown((s) => [...s, k]);
                        setMenuOpen(false);
                      }}
                      onClose={() => setMenuOpen(false)}
                    />
                  ) : (
                    <button type="button" class="add-item-btn" onClick={() => setMenuOpen(true)} data-add-item>
                      ＋ 動かす項目を追加
                    </button>
                  )}
                </div>
              }
            >
              {addedRows}
            </LeverCard>
            {/* ④ 生涯キャッシュフロー表 */}
            {table !== null ? (
              <CashflowTable
                model={table}
                selectedYear={pinnedYear}
                onSelectYear={setSelectedYear}
                onEvidence={(r, y) => void showEvidence(r, y)}
                corner={`${letterOf(tKey)}案「${letters.get(tKey)?.name ?? ""}」`}
                scrollNonce={scrollNonce}
                controls={{
                  plans: slots.map((id) => ({ key: letterOf(id), letter: letterOf(id) })),
                  shown: letterOf(tKey),
                  onShow: (l) => {
                    const id = slotOfLetter(letters, slots, l);
                    setTableKey(id === undefined || id === work.sel ? null : id);
                  },
                  diff: { on: showDiff, disabled: tKey === work.base, label: tKey === work.base ? "差を表示（基準の案を表示中）" : `差を表示（${letterOf(tKey)}−${letterOf(work.base)}）` },
                  onDiff: setShowDiff,
                }}
              />
            ) : null}
            <div class="foot footnote">
              <span>{opened.demo !== null ? "架空のモデル世帯を" : "入力した世帯を"}、ファイナンシアの計算エンジン（開発版）で計算した結果です。制度データには原本での確認待ちの行があります。保存は次の版です。</span>
              {import.meta.env.DEV ? (
                <span class="perf">
                  計算の速さ: 先出し {last !== undefined ? `${last.ms.toFixed(0)}ms` : "—"}／正の計算 {lastCanon !== undefined ? `${lastCanon.ms.toFixed(0)}ms（本体 ${lastCanon.hostMs?.toFixed(0) ?? "—"}ms）` : "—"}／{host?.kind}
                </span>
              ) : null}
            </div>
          </div>
        )}
      </main>
      {notice !== null ? (
        <div class="toast on" role="status">
          {notice}
        </div>
      ) : null}
      {memoOpen && opened !== null ? <MemoDrawer wh={opened.wh} onEdit={edit} onClose={() => setMemoOpen(false)} /> : null}
      {evidence !== null ? <EvidencePanel state={evidence} onClose={() => setEvidence(null)} /> : null}
    </div>
  );
}

/** 画面の確かめ用（開発用のサーバーだけ）: #items=loan,rate,shift,mix で、よく使う項目を対策に足す */
function devItems(cat: Catalog, kinds: string[]): string[] {
  const out: string[] = [];
  for (const k of kinds) {
    const it = cat.items.find((x) => (k === "loan" ? /^loan:.*:(principal|prepay)$/.test(x.key) : k === "rate" ? /^loan:.*:rate$/.test(x.key) : k === "shift" ? x.key === "rates:shift" : k === "mix" ? x.key.startsWith("mix:") && x.control.kind === "mix" && x.control.accountKind !== "deposit" : false));
    if (it !== undefined) out.push(it.key);
  }
  return out;
}

/** 画面の確かめ用（開発用のサーバーだけ。#seed=plans）: 見本の案を5つ作る（借入・金利・配分・働き方・金利の上昇） */
function seedPlans(o: Opened, first: Values): { wh: WorkingHousehold; ids: string[]; keys: string[] } {
  const cat = o.catalog;
  const find = (re: RegExp) => cat.items.find((x) => re.test(x.key));
  const loan = find(/^loan:.*:(principal|prepay)$/);
  const rate = find(/^loan:.*:rate$/);
  const shift = cat.byKey.get("rates:shift");
  const mix = cat.items.find((x) => x.key.startsWith("mix:") && x.control.kind === "mix" && x.control.accountKind !== "deposit") ?? cat.items.find((x) => x.key.startsWith("mix:"));
  let wh = o.wh;
  const ids: string[] = [];
  const save = (name: string, values: Values, base: string | null, tags: string[]) => {
    const r = savePlan(wh, cat, { name, tags, base, values: normalizeValues(values, base === null ? {} : effectiveValues(wh.proposals, base), wh, cat), now: nowIso() });
    wh = r.wh;
    ids.push(r.id);
    return r.id;
  };
  const loanValue = loan === undefined ? {} : { [loan.key]: loan.key.endsWith(":prepay") ? 5_000_000 : (loan.read(wh) as number) - 5_000_000 };
  const b = save("B案 借入を500万円減らす", { ...first, ...loanValue }, null, ["住宅"]);
  const r0 = rate?.read(wh);
  save("C案 B案＋金利が0.5%上がる", { ...first, ...loanValue, ...(rate !== undefined && typeof r0 === "string" ? { [rate.key]: addRate(r0, "0.005") } : {}) }, b, ["住宅"]);
  save("D案 NISAを株式80%で", { ...first, ...(mix !== undefined ? { [mix.key]: mixFromBuckets(undefined, 80, 10) } : {}) }, null, ["運用"]);
  save("E案 70歳まで働く", { ...first, "lever:retireAge": 70, "lever:pensionAge": 70 }, null, ["老後"]);
  save("F案 変動金利が2030年から1%上がる", { ...first, ...(shift !== undefined ? { [shift.key]: { add: "0.01", from: "2030-01" } } : {}) }, null, ["住宅"]);
  return { wh, ids, keys: [loan?.key, rate?.key, shift?.key, mix?.key].filter((x): x is string => x !== undefined) };
}
