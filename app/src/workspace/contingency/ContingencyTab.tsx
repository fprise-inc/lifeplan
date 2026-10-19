// 万一のときの画面（作業の層）: 必要保障額の推移（大人ごと）・万一なし・選んだ想定を計算し、提示用の値を作って提示層の部品に渡す。
// 配置は見通しと同じ上から下の流れ: ① 場面の帯 → ② 年ごとの結果の帯（起きる年を選ぶ・1年ずつ見せる）→ ③ 大きなグラフ（資産の推移／必要保障額の推移）
// → ④ FP が直す前提の欄（対策の欄と同じ部品）。前提の欄までスクロールすると、②③が縮んで画面の上に付いてくる（ChartDock）。
// 見るプラン: 既定は現状（プランA）。切り替えると、場面の帯・年ごとの結果の帯・グラフ・必要保障額をそのプラン（保存していない変更を含む今の中身）で計算する。
// 想定の前提（遺族の生活費の割合など）は世帯に1つで、どのプランにも同じものを使う。グラフの枠の名前はプランごとに分け、プランを戻したときは前の結果をすぐ出す。
// 計算はアプリの側が持つ ContingencyEngine で行う（タブを切り替えても結果を捨てない。同じ内容ならすぐ出す）。
// 画面の側のエンジンで先に出し、本体の正の計算で置き換える（見通しと同じ二本立て）。FP用のメモは画面に出さず、上部の引き出しに置く
import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import type { HostApi } from "../../engine/host.ts";
import type { EngineRequest, PreviewResult } from "../../engine/types.ts";
import { ChartDock, useChartDock, type DockMode } from "../../presentation/ChartDock.tsx";
import { ContingencyChartCard, ContingencyVerdict, DockedContingency, ScenarioBand, YearStrip, type ContingencyMode, type YearStripProps } from "../../presentation/ContingencyView.tsx";
import type { ContingencyModel, ProtectionChartModel } from "../../presentation/model.ts";
import type { WorkingHousehold } from "../input/household.ts";
import { depletionYear, displayYears } from "../present.ts";
import { roles } from "../roles.ts";
import { CURRENT } from "../plans/band.ts";
import { YearSweep, type ContingencyEngine } from "./engine.ts";
import { contingencyInputSections, oldAgeChoiceField } from "./inputs.ts";
import { PremisePanel } from "./PremisePanel.tsx";
import { protectionChart, scenarioCards, scenarioModel, yearOptions, yearStripModel } from "./present.ts";
import { adults, chartRequests, defaultYear, keptSlots, planSlot, scenarioRequest, scenarios } from "./requests.ts";

/** 1年ずつ見せるときの、1年あたりの時間（ミリ秒） */
export const PLAY_STEP_MS = 1000;

/** 付いてくる部分のうち、グラフの外の高さ（文字の大きさ 16px のとき。見出し・年ごとの帯・凡例・余白） */
const DOCK_EXTRA = 165;

/** 画面の外（App）で持ち続ける、万一のときの画面の状態（タブを切り替えても戻る） */
export interface ContingencyUi {
  /** 選んでいる場面（death:self など。未選択は undefined） */
  selected?: string;
  mode: ContingencyMode;
  /** 見るプラン（プランの内部 ID。省略は現状のプランA） */
  plan?: string;
}

/** 見るプランの選択肢（現状と帯に並べたプラン） */
export interface PlanOption {
  id: string;
  letter: string;
  name: string;
}

/** プランの枠の数の上限（グラフの枠の結果を覚えておくプランの数。今のプランを含む） */
export const KEEP_PLANS = 4;

export interface ContingencyTabProps {
  wh: WorkingHousehold;
  host: HostApi | null;
  /** アプリの側が持つ計算（無ければ計算しない） */
  engine: ContingencyEngine | null;
  targetAge: number;
  onEdit: (w: WorkingHousehold) => void;
  ui: ContingencyUi;
  onUi: (u: ContingencyUi) => void;
  /** 操作中はグラフを上に表示（表示の設定: 出さない／小さく／大きく） */
  dock: DockMode;
  /** 付いてくるグラフの × */
  onDockOff: () => void;
  /** 開いたときの想定（URL の #scenario=death:self） */
  initialScenario?: string;
  /** 見るプランの選択肢（現状 CURRENT と帯のプラン）。無ければ現状だけ */
  plans?: readonly PlanOption[];
  /** プランの計算の要求（打ち手を当てた現状。保存していない変更を含む）。CURRENT は世帯の要求そのもの */
  requestOf?: (id: string) => EngineRequest;
  /** 開いたときに見るプラン（URL の #cgplan=B。帯の文字） */
  initialPlan?: string;
}

/** 1年ずつ見せている状態: from は見せ始める前に選んでいた年（止めると戻る） */
interface Play {
  status: "playing" | "paused";
  from: number;
  year: number;
}

export function ContingencyTab({ wh: saved, host, engine, targetAge, onEdit, ui, onUi, dock, onDockOff, initialScenario, plans, requestOf, initialPlan }: ContingencyTabProps) {
  // 前提のスライダーを動かしている間は、画面の側の世帯（draft）で描いて計算する。指を離したら世帯に書く
  const [draft, setDraft] = useState<WorkingHousehold | null>(null);
  const edited = draft ?? saved;
  // ---- 見るプラン（既定は現状）。前提は世帯のもの（edited.contingency）、計算の要求はそのプランのもの ----
  const wantPlan = ui.plan ?? (initialPlan !== undefined ? plans?.find((p) => p.letter === initialPlan)?.id : undefined);
  const planId = wantPlan !== undefined && wantPlan !== CURRENT && (plans ?? []).some((p) => p.id === wantPlan) && requestOf !== undefined ? wantPlan : CURRENT;
  const planReq = useMemo(() => (planId === CURRENT || requestOf === undefined ? saved.request : requestOf(planId)), [planId, saved.request, requestOf]);
  /** 計算に使う世帯（プランの要求＋世帯の前提）。前提の欄はこれを直さず、edited を直す */
  const wh = useMemo<WorkingHousehold>(() => (planReq === edited.request ? edited : { ...edited, request: planReq }), [edited, planReq]);
  const planSaved = useMemo<WorkingHousehold>(() => (planReq === saved.request ? saved : { ...saved, request: planReq }), [saved, planReq]);
  /** グラフの枠の名前（プランごとに分ける） */
  const slot = (name: string) => planSlot(planId, name);
  const recentPlans = useRef<string[]>([]);
  const commit = (w?: WorkingHousehold) => {
    const next = w === undefined ? draft : w.request === saved.request ? w : { ...w, request: saved.request };
    setDraft(null);
    if (next !== null && next !== saved) onEdit(next);
  };
  const [tick, setTick] = useState(0);
  useEffect(() => engine?.subscribe(() => setTick((t) => t + 1)), [engine]);

  const scs = useMemo(() => scenarios(wh), [wh]);
  const want = ui.selected ?? initialScenario;
  const sc = scs.find((s) => s.key === want) ?? scs[0];
  const [play, setPlay] = useState<Play | null>(null);
  const savedYear = wh.contingency.year ?? defaultYear(wh.request);
  const year = play?.year ?? savedYear;
  const [chartYear, setChartYear] = useState<number | null>(null);
  const mode = ui.mode;

  const protMembers = useMemo(() => {
    const h = wh.request.input.household;
    const kids = h.members.some((m) => m.kind === "child");
    return adults(h)
      .filter((a) => a.spouse !== undefined || kids)
      .map((a) => a.member.id);
  }, [wh.request]);

  // ---- グラフの枠（万一なし・必要保障額の推移・選んだ想定。枠の名前はプランごと）----
  const requests = useMemo(() => chartRequests(wh, planId, protMembers, sc, year), [wh, protMembers, sc, year, planId]);
  const dragging = draft !== null;
  useEffect(() => {
    if (engine === null) return;
    const c = engine.chart;
    // 最近見たプランの枠は残す（戻したときに前の結果をすぐ出す）。ほかのプランの枠は消す
    recentPlans.current = [planId, ...recentPlans.current.filter((p) => p !== planId)].slice(0, KEEP_PLANS);
    c.retain(keptSlots(c.ids(), requests, recentPlans.current));
    // 前提を動かしている間は選んだ想定の枠だけ先に出す（ほかの枠と正の計算は、操作が止まってから）
    if (dragging) c.slide(slot("sc"), requests);
    else void c.set(requests);
  }, [engine, requests, dragging]);

  // ---- 年ごとの結果の帯（世帯に書いた前提で。動かしている途中は計算し直さない）----
  const options = useMemo(() => (sc !== undefined ? yearOptions(planSaved.request, sc.member) : []), [planSaved.request, sc]);
  const sweepKey = useMemo(() => JSON.stringify({ r: planSaved.request, c: { ...planSaved.contingency, year: null }, s: sc?.key ?? "" }), [planSaved, sc]);
  const sweepList = useMemo(() => (sc === undefined ? [] : YearSweep.prepare(options.map((o) => ({ year: o.value, request: scenarioRequest(planSaved, sc, o.value) })))), [sweepKey, options.length]);
  const summarize = useMemo(() => {
    const years = displayYears(planSaved.request);
    return (r: PreviewResult) => depletionYear(r.table, years);
  }, [sweepKey]);
  useEffect(() => {
    if (engine === null) return;
    engine.sweep.want(sweepList, summarize, year);
    return () => engine.sweep.stop();
  }, [engine, sweepList, summarize]);

  // ---- 開いてから必要保障額の推移が出るまで（DEV の表示と自己確認）----
  const view = (id: string) => engine?.chart.view(id) ?? null;
  const opened = useRef({ t0: performance.now(), done: false, first: true });
  const protReady = protMembers.every((_, i) => view(slot(`prot:${i}`))?.result != null || view(slot(`prot:${i}`))?.error != null);
  if (!opened.current.done && protReady && engine !== null) {
    opened.current.done = true;
    engine.openings.push({ ms: performance.now() - opened.current.t0, cached: opened.current.first });
    if (engine.openings.length > 50) engine.openings.shift();
  }
  opened.current.first = false;

  const model: ContingencyModel = useMemo(() => {
    const charts: ProtectionChartModel[] = [];
    let protStatus: ContingencyModel["protection"]["status"] = "ready";
    let protError: string | null = null;
    protMembers.forEach((m, i) => {
      const s = view(slot(`prot:${i}`));
      const req = requests[slot(`prot:${i}`)];
      if (s?.error != null) {
        protStatus = "error";
        protError = s.error;
      } else if (s?.result == null || req === undefined) {
        if (protStatus !== "error") protStatus = "loading";
      } else if (s.result.protection !== undefined) {
        const c = protectionChart(req, s.result.protection, s.result, m);
        if (c !== null) charts.push(c);
      }
    });
    const none = view(slot("none"));
    const sr = view(slot("sc"));
    let scenario: ContingencyModel["scenario"] = { status: "loading", model: null, error: null, stale: false };
    if (sr?.error != null || none?.error != null) scenario = { status: "error", model: null, error: sr?.error ?? none?.error ?? null, stale: false };
    else if (sc !== undefined && sr?.result != null && none?.result != null)
      scenario = {
        status: "ready",
        model: scenarioModel({ req: wh.request, scenario: sc, year, result: sr.result, none: none.result, targetAge, choice: wh.contingency.oldAgeChoice[sc.member] }),
        error: null,
        stale: sr.stale || none.stale,
      };
    const last = engine?.openings.at(-1);
    const protection: ContingencyModel["protection"] = { status: protStatus, charts, error: protError, ms: last?.ms ?? null };
    const sel = sc?.key ?? "";
    const who = sc !== undefined ? (roles(planSaved.request).find((r) => r.member.id === sc.member)?.label ?? sc.who) : "";
    const noneRes = none?.result ?? null;
    return {
      protection,
      scenarios: scenarioCards({ req: wh.request, scenarios: scs, selected: sel, protection, grade: wh.contingency.grade }),
      selected: sel,
      year,
      strip: yearStripModel({
        options: options.map((o) => ({ value: o.value, age: o.age })),
        results: engine === null ? [] : sweepList.map((p) => engine.sweep.outcome(p.key)),
        who,
        noneDepletion: noneRes === null ? undefined : depletionYear(noneRes.table, displayYears(planSaved.request)),
        stale: dragging,
      }),
      scenario,
    };
    // view() は engine の中の結果を読む（engine の知らせのたびに tick が進むので、読み直す）
  }, [tick, engine, requests, protMembers, sc, scs, wh, year, targetAge, options, sweepList, dragging, planSaved.request, planId]);

  // ---- 年を選ぶ・1年ずつ見せる ----
  const setYear = (y: number) => {
    if (y === saved.contingency.year && draft === null) return;
    commit({ ...wh, contingency: { ...wh.contingency, year: y } });
  };
  const years = options.map((o) => o.value);
  useEffect(() => {
    if (play === null || play.status !== "playing") return;
    const t = setTimeout(() => {
      const next = years[years.indexOf(play.year) + 1];
      if (next === undefined) {
        // 最後の年まで見せたら終わる（最後の年を選んだまま）
        setPlay(null);
        setYear(play.year);
      } else setPlay({ ...play, year: next });
    }, PLAY_STEP_MS);
    return () => clearTimeout(t);
  }, [play, years.join(",")]);
  const strip: Omit<YearStripProps, "model" | "compact"> = {
    selected: year,
    play: play?.status ?? null,
    onSelect: (y) => {
      setPlay(null);
      setChartYear(null);
      setYear(y);
    },
    onPlay: () => {
      setChartYear(null);
      if (play !== null) setPlay({ ...play, status: "playing" });
      else if (years.length > 1) setPlay({ status: "playing", from: year, year: years[0] as number });
    },
    onPause: () => {
      if (play === null) return;
      setPlay({ ...play, status: "paused" });
      setYear(play.year);
    },
    onStop: () => {
      if (play === null) return;
      setPlay(null);
      setYear(play.from);
    },
  };

  const roleKey = useMemo(() => new Map(roles(wh.request).map((r) => [r.key, r.member.id])), [wh.request]);
  const selectScenario = (key: string) => {
    setPlay(null);
    setChartYear(null);
    onUi({ ...ui, selected: key });
  };
  /** 必要保障額の推移で年を押した: その人の死亡の場面にして、起きる年をその年にする */
  const pick = (key: string, y: number) => {
    const member = roleKey.get(key);
    const s = scs.find((x) => x.kind === "death" && x.member === member);
    if (s !== undefined && s.key !== sc?.key) onUi({ ...ui, selected: s.key });
    setPlay(null);
    setChartYear(null);
    setYear(y);
  };
  const planChoice =
    plans !== undefined && plans.length > 1 && requestOf !== undefined
      ? {
          options: plans.map((p) => ({ id: p.id, text: `プラン${p.letter}${p.id === CURRENT ? "（現状）" : p.name !== "" ? ` ${p.name}` : ""}` })),
          value: planId,
          onChange: (id: string) => {
            setPlay(null);
            setChartYear(null);
            const { plan: _p, ...rest } = ui;
            void _p;
            onUi(id === CURRENT ? rest : { ...rest, plan: id });
          },
        }
      : undefined;
  const sections = useMemo(() => contingencyInputSections(edited), [edited]);
  const used = useMemo(() => {
    if (sc === undefined) return new Set<string>();
    return new Set(sc.kind === "death" ? ["cg/living", "cg/lump", "cg/work", "cg/creditLife"] : ["cg/disability", "cg/creditLife"]);
  }, [sc]);
  const extra =
    sc?.kind === "disability" && (wh.contingency.grade ?? 2) !== 0
      ? { section: "cg/disability", field: oldAgeChoiceField(sc.member), note: "自動で手取りが多い組み合わせを選びます。選び直すとその組み合わせで計算します" }
      : null;

  // ---- 操作中はグラフを上に表示 ----
  const anchor = useRef<HTMLDivElement>(null);
  const controls = useRef<HTMLDivElement>(null);
  const docked = useChartDock(anchor, controls, dock, DOCK_EXTRA);
  const chartProps = { model, mode, pinnedYear: chartYear, onPinYear: setChartYear, onPick: pick };
  const last = engine?.openings.at(-1);
  const previews = engine?.sweep.timings.filter((t) => t.kind === "preview") ?? [];

  return (
    <div class="main-stack cg-stack">
      <ChartDock dock={docked} head={<ContingencyVerdict model={model} mode={mode} />} onClose={onDockOff}>
        {(height) => <DockedContingency {...chartProps} height={height} strip={strip} />}
      </ChartDock>
      {/* ① 場面の帯 */}
      <ScenarioBand model={model} onSelect={selectScenario} {...(planChoice !== undefined ? { plan: planChoice } : {})} />
      {/* ② 年ごとの結果の帯 */}
      <YearStrip {...strip} model={model.strip} />
      {/* ③ グラフ */}
      <div class="dock-anchor" ref={anchor}>
        <ContingencyChartCard {...chartProps} onMode={(m) => onUi({ ...ui, mode: m })} />
      </div>
      {/* ④ 想定の前提 */}
      <div class="dock-controls" ref={controls}>
        <PremisePanel wh={edited} sections={sections} used={used} extra={extra} onDraft={setDraft} onCommit={commit} />
      </div>
      {import.meta.env.DEV ? (
        <div class="foot footnote">
          <span class="perf" data-cg-perf>
            必要保障額の推移が出るまで: {last !== undefined ? `${(last.ms / 1000).toFixed(2)}秒${last.cached ? "（前の結果をそのまま）" : ""}` : "—"}／年ごとの帯 {model.strip.done}/{model.strip.total}年
            {previews.length > 0 ? `（先出し 1年あたり ${(previews.reduce((a, t) => a + t.ms, 0) / previews.length).toFixed(0)}ms）` : ""}／{host?.kind}
          </span>
        </div>
      ) : null}
    </div>
  );
}
