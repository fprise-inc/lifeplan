// 画面の大枠（作業の層）: 世帯を開き、打ち手を当て、二本立てのエンジンで計算し、提示用の値を作って提示層の部品に渡す
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "preact/hooks";
import { DualEngine } from "../engine/dual.ts";
import { devBrowserHost, isTauri, tauriHost, webEngine, type HostApi, type WebSession } from "../engine/host.ts";
import { isEngineError, type EngineRequest } from "../engine/types.ts";
import { EvidencePanel, type EvidenceState } from "../presentation/EvidencePanel.tsx";
import { ExplainView } from "../presentation/ExplainView.tsx";
import { CHART_TABS, type ChartTab } from "../presentation/FlowCharts.tsx";
import { group } from "../presentation/format.ts";
import { CashflowTable, GoalCards, MainCard } from "../presentation/MainView.tsx";
import { DEMO_HOUSEHOLDS, demoHousehold, type DemoHousehold } from "./catalog.ts";
import { buildEvidence } from "./evidence.ts";
import { explainModel } from "./explain.ts";
import type { Level } from "./input/form.ts";
import { blankHousehold, fromRequest, type WorkingHousehold } from "./input/household.ts";
import { InputView } from "./input/InputView.tsx";
import { addItem, saveItem } from "./input/items.ts";
import { withRefreshedEstimates } from "./input/estimates.ts";
import { ContingencyTab } from "./contingency/ContingencyTab.tsx";
import { LeverPanel, type FeeToggle, type LeverRow } from "./LeverPanel.tsx";
import { advisoryFeeInCurrent, hasAdvisoryFee, LEVER_KEYS, type LeverKey } from "./levers.ts";
import { MemoDrawer } from "./MemoDrawer.tsx";
import { mixFromBuckets } from "./plans/allocation.ts";
import { addRate } from "./plans/decimal.ts";
import { ItemMenu, ItemRow } from "./plans/ItemControls.tsx";
import { buildCatalog, leverSteps, type Catalog, type ItemValue, type MovableItem } from "./plans/items.ts";
import { PlanBar } from "./plans/PlanBar.tsx";
import { acknowledge, applyValues, changesOf, changesOfValues, dropChange, effectiveValues, normalizeValues, overwritePlan, reflectPlan, sameValues, savePlan, suggestName, valueOf, type Values } from "./plans/plans.ts";
import { MAX_COMPARE, PlansTab } from "./plans/PlansTab.tsx";
import { toPresentation } from "./present.ts";
import { roles } from "./roles.ts";
import { runContingencyCheck, runInputCheck, runPlansCheck, runSelfCheck } from "./selfcheck.ts";

type Tab = "input" | "main" | "plans" | "contingency" | "report";
const TABS: { id: Tab; label: string }[] = [
  { id: "input", label: "入力" },
  { id: "main", label: "主画面" },
  { id: "plans", label: "案と比較" },
  { id: "contingency", label: "万一の想定" },
  { id: "report", label: "提案書" },
];

/** URL の # の後ろ（画面の確かめ用: #big・#household=…（blank は空の世帯）・#levers=65,65,30000,280000・#year=2047・#evidence=pension:self:2047・#selfcheck・#tab=input・#open=work（#stage=work も同じ）・#level=detail・#fee=off・#scenario=death:self・#memo・#add=pet,car（開発用のサーバーだけ: 項目を足して保存した状態で開く）・#chart=flows・#explain=2・
 * #items=loan,rate,shift,mix（開発用のサーバーだけ: 動かす項目を足す）・#seed=plans（開発用のサーバーだけ: 見本の案を5つ）・#seedopen・#addmenu・#save・#selfcheck=plans） */
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
  /** #selfcheck=plans: 案の保存と比較・グラフの切り替え・説明モードの自己確認 */
  selfcheckPlans?: boolean;
  /** 主画面のグラフ */
  chart?: ChartTab;
  /** 説明モードを開いた状態（段の番号。0 から） */
  explain?: number;
  /** 対策に足す動かす項目（開発用のサーバーだけ） */
  items?: string[];
  /** 見本の案を作る（開発用のサーバーだけ） */
  seed?: boolean;
  /** 見本の案の2つ目を開いた状態 */
  seedOpen?: boolean;
  addMenu?: boolean;
  save?: boolean;
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
    }
    else if (k === "chart" && CHART_TABS.some((t) => t.id === v)) out.chart = v as ChartTab;
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
    }
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

/** 作業中の案（0009 の1。画面の側の状態）: 開いている案と、動かした値（案の中身の全部） */
interface Draft {
  opened: string | null;
  values: Values;
}

/** 開いている案の中身（作業中の値を整えるときの基準。土台の案が動かした項目は、現状と同じ値でも残す） */
const refValues = (o: Opened, opened: string | null): Values => (opened === null ? {} : effectiveValues(o.wh.proposals, opened));

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
  const [draft, setDraft] = useState<Draft>({ opened: null, values: {} });
  const [firstValues, setFirstValues] = useState<Values>({});
  /** 対策に足した項目（固定の項目のほか）。並びは足した順 */
  const [shown, setShown] = useState<string[]>([]);
  const [menuOpen, setMenuOpen] = useState(initial.addMenu === true);
  const [selectedYear, setSelectedYear] = useState<number | null>(initial.year ?? null);
  const [big, setBig] = useState(initial.big);
  const [tab, setTab] = useState<Tab>(initial.tab ?? "main");
  const [chartTab, setChartTab] = useState<ChartTab>(initial.chart ?? "assets");
  const [explainStep, setExplainStep] = useState<number | null>(initial.explain ?? null);
  const [compareSel, setCompareSel] = useState<string[]>([]);
  const [level, setLevel] = useState<Level>(initial.level ?? "simple");
  const [memoOpen, setMemoOpen] = useState(initial.memo === true);
  const openedRef = useRef<Opened | null>(null);
  const draftRef = useRef<Draft>(draft);
  draftRef.current = draft;
  const [evidence, setEvidence] = useState<EvidenceState | null>(null);
  const [, setTick] = useState(0);
  const dual = useRef<DualEngine | null>(null);
  const session = useRef<WebSession | null>(null);
  const compareTimings = useRef<{ ms: number; hostMs: number; slots: number }[]>([]);

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

  /** 枠の要求: 現状（入力の値）と、作業中の案（動かした値を現状に当てたもの）。FP顧問料の契約があれば、ON/OFF を入れ替えた案（alt）も */
  const requestsFor = useCallback((o: Opened, values: Values): { current: EngineRequest; proposal: EngineRequest; alt?: EngineRequest } & Record<string, EngineRequest> => {
    const proposal = applyValues(o.wh, values, o.catalog);
    if (!hasAdvisoryFee(o.wh.request)) return { current: o.wh.request, proposal };
    const fee = typeof values["lever:fee"] === "boolean" ? (values["lever:fee"] as boolean) : advisoryFeeInCurrent(o.wh.request);
    return { current: o.wh.request, proposal, alt: applyValues(o.wh, { ...values, "lever:fee": !fee }, o.catalog) };
  }, []);

  /** 作業中の案を置き直す（先出し）。release で正の計算 */
  const putDraft = useCallback(
    (d: Draft, o: Opened | null = openedRef.current, mode: "slide" | "release" | "set" = "slide") => {
      draftRef.current = d;
      setDraft(d);
      if (o === null || dual.current === null) return;
      const { current: _c, ...rest } = requestsFor(o, d.values);
      void _c;
      if (mode === "set") void dual.current.set(requestsFor(o, d.values));
      else {
        dual.current.slide("proposal", rest);
        if (mode === "release") void dual.current.release();
      }
    },
    [requestsFor],
  );

  const addOnce = useRef(false);
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
      // 最初の提案（見本の世帯の既定・URL の #levers）。FP顧問料は既定で提案に入れる（#fee=off で入れない）
      const first: Values = {};
      const fp = o.demo?.firstProposal ?? {};
      LEVER_KEYS.forEach((k, i) => {
        const hv = hashLevers?.[i];
        const v = hv !== undefined && !Number.isNaN(hv) ? hv : fp[k];
        if (v !== undefined) first[`lever:${k}`] = v;
      });
      if (hasAdvisoryFee(o.wh.request)) first["lever:fee"] = initial.feeOff !== true;
      let values = normalizeValues(first, {}, o.wh, o.catalog);
      let shownKeys: string[] = [];
      let sel: string[] = [];
      // 画面の確かめ用（開発用のサーバーだけ）: #items=loan,rate,shift,mix で項目を足す、#seed=plans で見本の案を5つ作る
      if (import.meta.env.DEV) {
        shownKeys = devItems(o.catalog, initial.items ?? []);
        if (initial.seed === true) {
          const seeded = seedPlans(o, values);
          o = { ...o, wh: seeded.wh };
          sel = seeded.ids;
          shownKeys = [...new Set([...shownKeys, ...seeded.keys])];
          if (initial.seedOpen === true && seeded.ids[1] !== undefined) values = effectiveValues(o.wh.proposals, seeded.ids[1]);
        }
      }
      setFirstValues(values);
      openedRef.current = o;
      setOpened(o);
      setShown(shownKeys);
      setCompareSel(sel);
      setEvidence(null);
      const d: Draft = { opened: initial.seedOpen === true && sel[1] !== undefined ? sel[1] : null, values };
      draftRef.current = d;
      setDraft(d);
      dual.current = new DualEngine({ session: session.current, host, onChange: () => setTick((t) => t + 1) });
      await dual.current.set(requestsFor(o, values));
    },
    [host, requestsFor, initial],
  );

  useEffect(() => {
    if (host === null || households.length === 0) return;
    const id = initial.household === "blank" ? BLANK : initial.household !== undefined && households.some((h) => h.id === initial.household) ? initial.household : (households[0] as DemoHousehold).id;
    void open(id, initial.levers);
  }, [host, households, open, initial]);

  /** 現状（入力）を置き換える: 推定を入れ直し、動かす項目を作り直し、作業中の案を新しい現状に合わせ、計算し直す。全部の案は差分なので、新しい現状に当て直される */
  const replaceCurrent = useCallback(
    (next: WorkingHousehold, nextDraft?: Draft) => {
      const o = openedRef.current;
      if (o === null || dual.current === null) return;
      const n = openedFrom(o.demo, withRefreshedEstimates(next));
      if (n === null) return;
      const d0 = nextDraft ?? draftRef.current;
      const opened2 = d0.opened !== null && n.wh.proposals.some((p) => p.id === d0.opened) ? d0.opened : null;
      const d: Draft = { opened: opened2, values: normalizeValues(d0.values, refValues(n, opened2), n.wh, n.catalog) };
      openedRef.current = n;
      draftRef.current = d;
      setOpened(n);
      setDraft(d);
      dual.current.slide("current", requestsFor(n, d.values));
    },
    [requestsFor],
  );
  /** 入力の画面で世帯（現状）を変えた */
  const edit = useCallback((next: WorkingHousehold) => replaceCurrent(next), [replaceCurrent]);

  /** 案だけを変えた（名前・印・保存・外す）。現状は同じなので計算し直さない */
  const setPlans = useCallback((next: WorkingHousehold) => {
    const o = openedRef.current;
    if (o === null) return;
    const n = { ...o, wh: next };
    openedRef.current = n;
    setOpened(n);
    const d = draftRef.current;
    if (d.opened !== null && !next.proposals.some((p) => p.id === d.opened)) {
      draftRef.current = { ...d, opened: null };
      setDraft(draftRef.current);
    }
  }, []);

  const setValue = useCallback(
    (key: string, v: ItemValue, mode: "slide" | "release" = "slide") => {
      const o = openedRef.current;
      if (o === null) return;
      const d = draftRef.current;
      const it = o.catalog.byKey.get(key);
      if (it === undefined) return;
      const prev = valueOf(it, d.values, o.wh);
      if (it.same(prev, v) && mode === "slide") return;
      putDraft({ ...d, values: normalizeValues({ ...d.values, [key]: v }, refValues(o, d.opened), o.wh, o.catalog) }, o, mode);
    },
    [putDraft],
  );

  const leverItemsOf = (o: Opened) => o.catalog.items.filter((it) => it.phase === "lever");

  const slide = useCallback(
    (key: LeverKey, index: number) => {
      const o = openedRef.current;
      const it = o?.catalog.byKey.get(`lever:${key}`);
      if (it === undefined || it.control.kind !== "steps") return;
      const v = it.control.steps[index];
      if (v !== undefined) setValue(it.key, v);
    },
    [setValue],
  );
  const release = useCallback(() => void dual.current?.release(), []);
  const toggleFee = useCallback(() => {
    const o = openedRef.current;
    if (o === null) return;
    const cur = draftRef.current.values["lever:fee"];
    const fee = typeof cur === "boolean" ? cur : advisoryFeeInCurrent(o.wh.request);
    setValue("lever:fee", !fee, "release");
  }, [setValue]);
  const reset = useCallback(
    (to: "current" | "first") => {
      const o = openedRef.current;
      if (o === null) return;
      const d = draftRef.current;
      putDraft({ ...d, values: to === "current" ? normalizeValues({}, refValues(o, d.opened), o.wh, o.catalog) : normalizeValues(firstValues, refValues(o, d.opened), o.wh, o.catalog) }, o, "release");
    },
    [putDraft, firstValues],
  );

  // ---- 案 ----
  const openPlan = useCallback(
    (id: string | null) => {
      const o = openedRef.current;
      if (o === null) return;
      const values = id === null ? {} : effectiveValues(o.wh.proposals, id);
      setShown((s) => [...new Set([...s, ...Object.keys(values).filter((k) => o.catalog.byKey.get(k)?.builtin === false)])]);
      putDraft({ opened: id, values }, o, "release");
    },
    [putDraft],
  );
  const saveNew = useCallback(
    (name: string, tags: string[]) => {
      const o = openedRef.current;
      if (o === null) return;
      const d = draftRef.current;
      const r = savePlan(o.wh, o.catalog, { name, tags, base: d.opened, values: d.values, now: nowIso() });
      setPlans(r.wh);
      const d2 = { opened: r.id, values: d.values };
      draftRef.current = d2;
      setDraft(d2);
    },
    [setPlans],
  );
  const overwrite = useCallback(() => {
    const o = openedRef.current;
    const d = draftRef.current;
    if (o === null || d.opened === null) return;
    setPlans(overwritePlan(o.wh, o.catalog, d.opened, d.values, nowIso()));
  }, [setPlans]);
  const reflect = useCallback(
    (planId: string | null) => {
      const o = openedRef.current;
      if (o === null) return;
      const d = draftRef.current;
      const useDraft = planId === null || (planId === d.opened && !sameValues(d.values, effectiveValues(o.wh.proposals, planId), o.catalog));
      const next = useDraft ? { ...o.wh, request: applyValues(o.wh, d.values, o.catalog) } : reflectPlan(o.wh, o.catalog, planId as string, nowIso());
      replaceCurrent(next, { opened: useDraft ? d.opened : planId, values: {} });
      void dual.current?.release();
    },
    [replaceCurrent],
  );

  const steps = useMemo(() => {
    const out = {} as Record<LeverKey, number[]>;
    for (const it of opened === null ? [] : leverItemsOf(opened)) if (it.control.kind === "steps") out[it.key.slice(6) as LeverKey] = it.control.steps;
    return out;
  }, [opened]);

  const cur = dual.current?.view("current");
  const pro = dual.current?.view("proposal");
  const alt = dual.current?.view("alt");
  const feeOn = opened !== null && hasAdvisoryFee(opened.wh.request) ? (typeof draft.values["lever:fee"] === "boolean" ? (draft.values["lever:fee"] as boolean) : advisoryFeeInCurrent(opened.wh.request)) : false;
  const proposalReq = useMemo(() => (opened === null ? null : requestsFor(opened, draft.values).proposal), [opened, draft, requestsFor]);
  const model = useMemo(() => {
    if (opened === null || proposalReq === null || cur?.result == null || pro?.result == null) return null;
    const fee = hasAdvisoryFee(opened.wh.request) ? { on: feeOn, withFee: feeOn ? pro.result : (alt?.result ?? null), alt: alt?.result ?? null } : undefined;
    return toPresentation({
      base: opened.wh.request,
      proposal: proposalReq,
      current: cur.result,
      proposed: pro.result,
      targetAge: opened.demo?.targetAge ?? 95,
      selectedYear,
      provisional: pro.source !== "canonical" || pro.stale,
      ...(fee !== undefined ? { fee } : {}),
    });
  }, [opened, proposalReq, feeOn, cur?.result, pro?.result, pro?.source, pro?.stale, alt?.result, selectedYear]);
  const explain = useMemo(() => (explainStep === null || opened === null || proposalReq === null || pro?.result == null ? null : explainModel(proposalReq, pro.result, opened.demo?.targetAge ?? 95)), [explainStep !== null, opened, proposalReq, pro?.result]);

  const showEvidence = useCallback(
    async (rowKey: string, year: number) => {
      const o = openedRef.current;
      if (host === null || o === null) return;
      const req = { ...requestsFor(o, draftRef.current.values).proposal, trace: "full" as const };
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
    [host, requestsFor],
  );

  // 画面の確かめ用（URL の #evidence=…・#selfcheck）。開発用のサーバーのときだけ
  const once = useRef(false);
  useEffect(() => {
    if (model === null || once.current) return;
    once.current = true;
    if (initial.evidence !== undefined) void showEvidence(initial.evidence.row, initial.evidence.year);
    if (import.meta.env.DEV && initial.selfcheck && dual.current !== null) {
      if (initial.selfcheckInput === true) void runInputCheck(() => dual.current, host?.kind ?? "browser-dev");
      else if (initial.selfcheckContingency === true) void runContingencyCheck(host?.kind ?? "browser-dev");
      else if (initial.selfcheckPlans === true) void runPlansCheck(() => dual.current, host?.kind ?? "browser-dev", () => compareTimings.current);
      else void runSelfCheck(dual.current, host?.kind ?? "browser-dev");
    }
  }, [model, initial, showEvidence, host]);

  if (import.meta.env.DEV && dual.current !== null) (globalThis as { __financia?: unknown }).__financia = { timings: dual.current.timings, mismatches: () => dual.current?.mismatches, compare: compareTimings.current };

  const leverRows: LeverRow[] =
    opened === null
      ? []
      : leverItemsOf(opened).flatMap((it) => {
          if (it.control.kind !== "steps") return [];
          const st = it.control.steps;
          const v = valueOf(it, draft.values, opened.wh);
          const b = it.read(opened.wh);
          const tick = it.control.tick;
          return [
            {
              key: it.key.slice(6) as LeverKey,
              label: it.label,
              steps: st,
              index: nearestIndex(st, typeof v === "number" ? v : undefined),
              baseIndex: nearestIndex(st, typeof b === "number" ? b : undefined),
              valueText: it.text(v),
              stepText: tick,
              baseText: it.text(b),
              note: it.note?.(v) ?? null,
            },
          ];
        });
  void steps;

  const feeToggle: FeeToggle | null =
    opened !== null && hasAdvisoryFee(opened.wh.request) ? { on: feeOn, inCurrent: advisoryFeeInCurrent(opened.wh.request), note: feeSummary(opened.wh.request), onToggle: toggleFee } : null;

  const last = dual.current?.timings.filter((t) => t.kind === "preview").at(-1);
  const lastCanon = dual.current?.timings.filter((t) => t.kind === "canonical").at(-1);
  const error = cur?.error ?? pro?.error ?? null;

  // 案の帯の材料
  const planInfo = useMemo(() => {
    if (opened === null) return null;
    const ref = refValues(opened, draft.opened);
    const modified = draft.opened !== null && !sameValues(draft.values, ref, opened.catalog);
    const changes = draft.opened !== null && !modified ? changesOf(opened.wh.proposals, draft.opened, opened.wh, opened.catalog) : changesOfValues(draft.values, opened.wh, opened.catalog);
    return { modified, changes, suggested: suggestName(opened.wh.proposals, draft.values, opened.wh, opened.catalog, draft.opened) };
  }, [opened, draft]);

  const shownSet = new Set(shown);
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
              value={valueOf(it, draft.values, opened.wh)}
              base={it.read(opened.wh)}
              wh={opened.wh}
              onSlide={(k, v) => setValue(k, v)}
              onRelease={release}
              onRemove={(k) => {
                setShown((s) => s.filter((x) => x !== k));
                const d = draftRef.current;
                if (Object.hasOwn(d.values, k)) {
                  const { [k]: _drop, ...rest } = d.values;
                  void _drop;
                  putDraft({ ...d, values: normalizeValues(rest, refValues(opened, d.opened), opened.wh, opened.catalog) }, opened, "release");
                }
              }}
            />
          ));

  const drawer = memoOpen || evidence !== null;
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
            <InputView wh={opened.wh} onSave={edit} level={level} onLevel={setLevel} {...(initial.open !== undefined ? { initialOpen: initial.open } : {})} />
          </>
        ) : tab === "contingency" && opened !== null ? (
          <ContingencyTab wh={opened.wh} host={host} targetAge={opened.demo?.targetAge ?? 95} onEdit={edit} {...(initial.scenario !== undefined ? { initialScenario: initial.scenario } : {})} />
        ) : tab === "plans" && opened !== null ? (
          <PlansTab
            wh={opened.wh}
            catalog={opened.catalog}
            host={host}
            targetAge={opened.demo?.targetAge ?? 95}
            selected={compareSel}
            onSelect={setCompareSel}
            onOpenPlan={(id) => {
              openPlan(id);
              setTab("main");
            }}
            onBaseNew={(id) => {
              openPlan(id);
              setTab("main");
            }}
            onReflect={(id) => reflect(id)}
            onEdit={setPlans}
            onTiming={(t) => {
              compareTimings.current.push(t);
              setTick((x) => x + 1);
            }}
          />
        ) : tab === "report" ? (
          <section class="card placeholder">
            <h2>{TABS.find((t) => t.id === tab)?.label}</h2>
            <p>準備中です。</p>
          </section>
        ) : model === null ? (
          fatal === null ? <p class="loading">計算しています…</p> : null
        ) : (
          <>
            {opened !== null && planInfo !== null ? (
              <PlanBar
                plans={opened.wh.proposals}
                opened={draft.opened}
                modified={planInfo.modified}
                changes={planInfo.changes}
                suggested={planInfo.suggested}
                onOpen={openPlan}
                onSaveNew={saveNew}
                onOverwrite={overwrite}
                onReflect={() => reflect(draft.opened)}
                onAck={(k) => draft.opened !== null && setPlans(acknowledge(opened.wh, opened.catalog, draft.opened, k))}
                onDrop={(k) => {
                  if (draft.opened === null) return;
                  const w = dropChange(opened.wh, opened.catalog, draft.opened, k);
                  setPlans(w);
                  if (!planInfo.modified) putDraft({ opened: draft.opened, values: effectiveValues(w.proposals, draft.opened) }, { ...opened, wh: w }, "release");
                }}
                onExplain={() => setExplainStep(0)}
                onCompare={() => {
                  if (draft.opened !== null && !compareSel.includes(draft.opened) && compareSel.length < MAX_COMPARE) setCompareSel([...compareSel, draft.opened]);
                  setTab("plans");
                }}
                {...(initial.save === true ? { initialSave: true } : {})}
              />
            ) : null}
            <div class="grid">
              <aside class="col-goals">
                <GoalCards model={model.goals} />
              </aside>
              <MainCard model={model} onSelectYear={setSelectedYear} chartTab={chartTab} onChartTab={setChartTab} />
              <LeverPanel levers={leverRows} onSlide={slide} onRelease={release} onReset={reset} fee={feeToggle}>
                {addedRows}
                {opened !== null ? (
                  menuOpen ? (
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
                  )
                ) : null}
              </LeverPanel>
            </div>
            <CashflowTable model={model.table} selectedYear={model.selectedYear} onSelectYear={setSelectedYear} onEvidence={(r, y) => void showEvidence(r, y)} />
            <div class="foot footnote">
              <span>{opened?.demo !== null ? "架空のモデル世帯を" : "入力した世帯を"}、ファイナンシアの計算エンジン（開発版）で計算した結果です。制度データには原本での確認待ちの行があります。保存は次の版です。</span>
              {import.meta.env.DEV ? (
                <span class="perf">
                  計算の速さ: 先出し {last !== undefined ? `${last.ms.toFixed(0)}ms` : "—"}／正の計算 {lastCanon !== undefined ? `${lastCanon.ms.toFixed(0)}ms（本体 ${lastCanon.hostMs?.toFixed(0) ?? "—"}ms）` : "—"}／{host?.kind}
                </span>
              ) : null}
            </div>
          </>
        )}
        {import.meta.env.DEV && tab === "plans" && compareTimings.current.length > 0 ? (
          <p class="perf footnote">比較の計算: {compareTimings.current.at(-1)?.slots}枠 {compareTimings.current.at(-1)?.ms.toFixed(0)}ms（本体 {compareTimings.current.at(-1)?.hostMs.toFixed(0)}ms）／{host?.kind}</p>
        ) : null}
      </main>
      {memoOpen && opened !== null ? <MemoDrawer wh={opened.wh} onEdit={edit} onClose={() => setMemoOpen(false)} /> : null}
      {evidence !== null ? <EvidencePanel state={evidence} onClose={() => setEvidence(null)} /> : null}
      {explainStep !== null && explain !== null ? <ExplainView model={explain} step={explainStep} onStep={setExplainStep} onClose={() => setExplainStep(null)} /> : null}
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
