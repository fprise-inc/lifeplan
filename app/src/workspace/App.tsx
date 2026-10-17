// 画面の大枠（作業の層）: 世帯を開き、打ち手を当て、二本立てのエンジンで計算し、提示用の値を作って提示層の部品に渡す
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "preact/hooks";
import { DualEngine } from "../engine/dual.ts";
import { devBrowserHost, isTauri, tauriHost, webEngine, type HostApi, type WebSession } from "../engine/host.ts";
import { isEngineError, type EngineRequest } from "../engine/types.ts";
import { EvidencePanel, type EvidenceState } from "../presentation/EvidencePanel.tsx";
import { group, monthlyMan } from "../presentation/format.ts";
import { CashflowTable, GoalCards, MainCard } from "../presentation/MainView.tsx";
import { DEMO_HOUSEHOLDS, demoHousehold, type DemoHousehold } from "./catalog.ts";
import { buildEvidence } from "./evidence.ts";
import type { Level } from "./input/form.ts";
import { blankHousehold, fromRequest, reemploymentOf, type WorkingHousehold } from "./input/household.ts";
import { InputView } from "./input/InputView.tsx";
import { addItem, saveItem } from "./input/items.ts";
import { withRefreshedEstimates } from "./input/estimates.ts";
import { ContingencyTab } from "./contingency/ContingencyTab.tsx";
import { LeverPanel, type FeeToggle, type LeverRow } from "./LeverPanel.tsx";
import { advisoryFeeInCurrent, applyAdvisoryFee, applyLevers, availableLevers, hasAdvisoryFee, LEVER_KEYS, readLevers, type LeverKey, type LeverValues } from "./levers.ts";
import { MemoDrawer } from "./MemoDrawer.tsx";
import { toPresentation } from "./present.ts";
import { roles } from "./roles.ts";
import { runContingencyCheck, runInputCheck, runSelfCheck } from "./selfcheck.ts";

type Tab = "input" | "main" | "contingency" | "report";
const TABS: { id: Tab; label: string }[] = [
  { id: "input", label: "入力" },
  { id: "main", label: "主画面" },
  { id: "contingency", label: "万一の想定" },
  { id: "report", label: "提案書" },
];

/** URL の # の後ろ（画面の確かめ用: #big・#household=…（blank は空の世帯）・#levers=65,65,30000,280000・#year=2047・#evidence=pension:self:2047・#selfcheck・#tab=input・#open=work（#stage=work も同じ）・#level=detail・#fee=off・#scenario=death:self・#memo・#add=pet,car（開発用のサーバーだけ: 項目を足して保存した状態で開く）） */
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
    }
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

/** 打ち手の目盛り: 見本の世帯の目盛りに、今の値（現状）を足す。見本の無い世帯は標準の目盛り */
export function leverSteps(demo: DemoHousehold | null, base: Partial<LeverValues>): Record<LeverKey, number[]> {
  const living = base.livingMonthly ?? 250000;
  const around = [-40000, -20000, 0, 20000].map((d) => Math.max(50000, Math.round((living + d) / 10000) * 10000));
  const std: Record<LeverKey, number[]> = { retireAge: [60, 62, 65, 68, 70], pensionAge: [60, 65, 68, 70, 75], nisaMonthly: [0, 10000, 30000, 50000], livingMonthly: around };
  const out = {} as Record<LeverKey, number[]>;
  for (const k of LEVER_KEYS) {
    const steps = new Set(demo?.steps[k] ?? std[k]);
    const b = base[k];
    if (b !== undefined) steps.add(b);
    out[k] = [...steps].sort((a, z) => a - z);
  }
  return out;
}

const pct = (r: string) => `${Math.round(Number(r) * 100)}%`;

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
  /** 見本の世帯（目盛り・最初の提案の既定）。空の世帯は null */
  demo: DemoHousehold | null;
  /** 画面の中で編集する世帯（現状） */
  wh: WorkingHousehold;
  selfId: string;
  baseLevers: Partial<LeverValues>;
  available: Set<LeverKey>;
}

function openedFrom(demo: DemoHousehold | null, wh: WorkingHousehold): Opened | null {
  const self = roles(wh.request).find((r) => r.key === "self");
  if (self === undefined) return null;
  return { demo, wh, selfId: self.member.id, baseLevers: readLevers(wh.request, self.member.id), available: availableLevers(wh.request, self.member.id) };
}

function thisMonth(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export function App() {
  const initial = useMemo(() => parseHash(typeof location === "undefined" ? "" : location.hash), []);
  const [host, setHost] = useState<HostApi | null>(null);
  const [fatal, setFatal] = useState<string | null>(null);
  const [households, setHouseholds] = useState<DemoHousehold[]>([]);
  const [opened, setOpened] = useState<Opened | null>(null);
  const [levers, setLevers] = useState<Partial<LeverValues>>({});
  const [selectedYear, setSelectedYear] = useState<number | null>(initial.year ?? null);
  const [big, setBig] = useState(initial.big);
  const [tab, setTab] = useState<Tab>(initial.tab ?? "main");
  const [level, setLevel] = useState<Level>(initial.level ?? "simple");
  const [memoOpen, setMemoOpen] = useState(initial.memo === true);
  const openedRef = useRef<Opened | null>(null);
  const [evidence, setEvidence] = useState<EvidenceState | null>(null);
  const [, setTick] = useState(0);
  const dual = useRef<DualEngine | null>(null);
  const session = useRef<WebSession | null>(null);
  const leversRef = useRef(levers);
  leversRef.current = levers;
  const [feeOn, setFeeOn] = useState(initial.feeOff !== true);
  const feeRef = useRef(feeOn);
  feeRef.current = feeOn;

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

  const requestsFor = useCallback((o: Opened, values: Partial<LeverValues>, fee: boolean = feeRef.current): { current: EngineRequest; proposal: EngineRequest; alt?: EngineRequest } & Record<string, EngineRequest> => {
    // 主画面の打ち手は提案の差分として当てる（現状＝入力の値は変えない）。定年後の予定の条件は入力の値から
    const r = reemploymentOf(o.wh.postRetirement[o.selfId]);
    const levered = applyLevers(o.wh.request, o.selfId, values, r !== undefined ? { reemployment: r } : {});
    if (!hasAdvisoryFee(o.wh.request)) return { current: o.wh.request, proposal: levered };
    // FP顧問料: 提案の側の ON/OFF（現状は入力のまま）。一文に「入れた場合と入れない場合の差」を出すため、逆の案（alt）も計算する
    return { current: o.wh.request, proposal: applyAdvisoryFee(levered, fee), alt: applyAdvisoryFee(levered, !fee) };
  }, []);

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
      const baseLevers = o.baseLevers;
      let values: Partial<LeverValues> = { ...baseLevers, ...(o.demo?.firstProposal ?? {}) };
      if (hashLevers !== undefined) LEVER_KEYS.forEach((k, i) => (hashLevers[i] !== undefined && !Number.isNaN(hashLevers[i]) ? (values = { ...values, [k]: hashLevers[i] }) : null));
      for (const k of LEVER_KEYS) if (!o.available.has(k)) delete values[k];
      openedRef.current = o;
      leversRef.current = values;
      setOpened(o);
      setLevers(values);
      setEvidence(null);
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

  /** 入力の画面で世帯（現状）を変えた: 推定を入れ直し、打ち手のうち現状のままだったものは新しい現状に合わせ、計算し直す */
  const edit = useCallback(
    (next: WorkingHousehold) => {
      const o = openedRef.current;
      if (o === null || dual.current === null) return;
      const n = openedFrom(o.demo, withRefreshedEstimates(next));
      if (n === null) return;
      const values: Partial<LeverValues> = {};
      for (const k of LEVER_KEYS) {
        if (!n.available.has(k)) continue;
        const cur = leversRef.current[k];
        values[k] = cur === undefined || cur === o.baseLevers[k] ? n.baseLevers[k] : cur;
      }
      openedRef.current = n;
      leversRef.current = values;
      setOpened(n);
      setLevers(values);
      dual.current.slide("current", requestsFor(n, values));
    },
    [requestsFor],
  );

  const steps = useMemo(() => (opened === null ? null : leverSteps(opened.demo, opened.baseLevers)), [opened]);

  const slide = useCallback(
    (key: LeverKey, index: number) => {
      const o = opened;
      if (o === null || dual.current === null || steps === null) return;
      const v = steps[key][index];
      if (v === undefined || leversRef.current[key] === v) return;
      const values = { ...leversRef.current, [key]: v };
      leversRef.current = values;
      setLevers(values);
      const { current: _c, ...rest } = requestsFor(o, values);
      void _c;
      dual.current.slide("proposal", rest);
    },
    [opened, requestsFor, steps],
  );
  const release = useCallback(() => void dual.current?.release(), []);
  const toggleFee = useCallback(() => {
    const o = opened;
    if (o === null || dual.current === null) return;
    const fee = !feeRef.current;
    feeRef.current = fee;
    setFeeOn(fee);
    const { current: _c, ...rest } = requestsFor(o, leversRef.current, fee);
    void _c;
    dual.current.slide("proposal", rest);
    void dual.current.release();
  }, [opened, requestsFor]);
  const reset = useCallback(
    (to: "current" | "first") => {
      const o = opened;
      if (o === null || dual.current === null) return;
      const values = to === "current" ? { ...o.baseLevers } : { ...o.baseLevers, ...(o.demo?.firstProposal ?? {}) };
      for (const k of LEVER_KEYS) if (!o.available.has(k)) delete values[k];
      leversRef.current = values;
      setLevers(values);
      const fee = to === "current" ? advisoryFeeInCurrent(o.wh.request) : true;
      feeRef.current = fee;
      setFeeOn(fee);
      const { current: _c, ...rest } = requestsFor(o, values, fee);
      void _c;
      dual.current.slide("proposal", rest);
      void dual.current.release();
    },
    [opened, requestsFor],
  );

  const cur = dual.current?.view("current");
  const pro = dual.current?.view("proposal");
  const alt = dual.current?.view("alt");
  const model = useMemo(() => {
    if (opened === null || cur?.result == null || pro?.result == null) return null;
    const fee = hasAdvisoryFee(opened.wh.request) ? { on: feeOn, withFee: feeOn ? pro.result : (alt?.result ?? null), alt: alt?.result ?? null } : undefined;
    return toPresentation({
      base: opened.wh.request,
      proposal: requestsFor(opened, levers, feeOn).proposal,
      current: cur.result,
      proposed: pro.result,
      targetAge: opened.demo?.targetAge ?? 95,
      selectedYear,
      provisional: pro.source !== "canonical" || pro.stale,
      ...(fee !== undefined ? { fee } : {}),
    });
  }, [opened, levers, feeOn, cur?.result, pro?.result, pro?.source, pro?.stale, alt?.result, selectedYear, requestsFor]);

  const showEvidence = useCallback(
    async (rowKey: string, year: number) => {
      if (host === null || opened === null) return;
      const req = { ...requestsFor(opened, leversRef.current).proposal, trace: "full" as const };
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
    [host, opened, requestsFor],
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
      else void runSelfCheck(dual.current, host?.kind ?? "browser-dev");
    }
  }, [model, initial, showEvidence, host]);

  if (import.meta.env.DEV && dual.current !== null) (globalThis as { __financia?: unknown }).__financia = { timings: dual.current.timings, mismatches: () => dual.current?.mismatches };

  const who = model?.members[0]?.label ?? "本人";
  const leverNote = (k: LeverKey, v: number | undefined): string | null => {
    if (opened === null) return null;
    const h = opened.wh.request.input.household;
    if (k === "retireAge") {
      const p = opened.wh.postRetirement[opened.selfId];
      if (p?.type != null && p.annualSalary !== null) return `${p.fromAge}歳から${p.type === "selfEmployed" ? "自営業" : p.type === "partTime" ? "パート" : "再雇用"}（年収${Math.round(p.annualSalary / 10000)}万円）`;
      return null;
    }
    if (k === "pensionAge") return v === 65 ? "原則の65歳" : null;
    if (k === "nisaMonthly") return opened.demo?.notes?.nisaMonthly ?? "働いている間、毎月積み立てる";
    const st = (h.livingExpenses ?? []).find((l) => l.mode === "total")?.stages ?? [];
    const names: Record<string, string> = { childIndependence: "子の独立後は", retirement: "退職後は", age70: "70歳から", age80: "80歳から" };
    const parts = st.filter((s) => s.ratio !== undefined && names[s.label] !== undefined).map((s) => `${names[s.label]}${pct(s.ratio as string)}`);
    return parts.length > 0 ? parts.join("、") : null;
  };
  const leverRows: LeverRow[] =
    opened === null || steps === null
      ? []
      : LEVER_KEYS.filter((k) => opened.available.has(k)).map((k) => {
          const st = steps[k];
          const v = levers[k];
          const b = opened.baseLevers[k];
          return {
            key: k,
            label: LEVER_LABEL[k](who),
            steps: st,
            index: nearestIndex(st, v),
            baseIndex: nearestIndex(st, b),
            valueText: v !== undefined ? valueText(k, v) : "",
            stepText: (x: number) => stepText(k, x),
            baseText: b !== undefined ? valueText(k, b) : "",
            note: leverNote(k, v),
          };
        });

  const feeToggle: FeeToggle | null =
    opened !== null && hasAdvisoryFee(opened.wh.request) ? { on: feeOn, inCurrent: advisoryFeeInCurrent(opened.wh.request), note: feeSummary(opened.wh.request), onToggle: toggleFee } : null;

  const last = dual.current?.timings.filter((t) => t.kind === "preview").at(-1);
  const lastCanon = dual.current?.timings.filter((t) => t.kind === "canonical").at(-1);
  const error = cur?.error ?? pro?.error ?? null;

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
            <InputView wh={opened.wh} onSave={edit} level={level} onLevel={setLevel} {...(initial.open !== undefined ? { initialOpen: initial.open } : {})} />
          </>
        ) : tab === "contingency" && opened !== null ? (
          <ContingencyTab wh={opened.wh} host={host} targetAge={opened.demo?.targetAge ?? 95} onEdit={edit} {...(initial.scenario !== undefined ? { initialScenario: initial.scenario } : {})} />
        ) : tab === "report" ? (
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
              </aside>
              <MainCard model={model} onSelectYear={setSelectedYear} />
              <LeverPanel levers={leverRows} onSlide={slide} onRelease={release} onReset={reset} fee={feeToggle} />
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
      </main>
      {memoOpen && opened !== null ? <MemoDrawer wh={opened.wh} onEdit={edit} onClose={() => setMemoOpen(false)} /> : null}
      {evidence !== null ? <EvidencePanel state={evidence} onClose={() => setEvidence(null)} /> : null}
    </div>
  );
}
