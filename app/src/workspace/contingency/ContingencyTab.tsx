// 万一の想定の画面（作業の層）: 開いたときに、必要保障額の推移（大人ごと）・万一なし・選んだ想定を本体で計算し（枠どうしは同時に）、
// 計算している間は「計算しています」を出す。提示用の値を作って提示層の部品に渡す。配置は主画面と同じ上から下の流れ:
// ① 場面の帯（場面と起きる年）→ ② 大きなグラフ（資産の推移／必要保障額の推移）→ ③ FP が直す前提の欄（対策の欄と同じ部品）。
// FP用のメモは画面に出さず、上部の引き出しに置く
import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import type { HostApi } from "../../engine/host.ts";
import { isEngineError, type EngineRequest, type PreviewResult } from "../../engine/types.ts";
import { ContingencyChartCard, ScenarioBand, type ContingencyMode } from "../../presentation/ContingencyView.tsx";
import type { ContingencyModel, ProtectionChartModel } from "../../presentation/model.ts";
import type { WorkingHousehold } from "../input/household.ts";
import { roles } from "../roles.ts";
import { contingencyInputSections, oldAgeChoiceField } from "./inputs.ts";
import { PremisePanel } from "./PremisePanel.tsx";
import { protectionChart, scenarioCards, scenarioModel, yearOptions } from "./present.ts";
import { adults, baseRequest, defaultYear, protectionRequest, scenarioRequest, scenarios } from "./requests.ts";

interface SlotState {
  rev: number;
  request: string;
  result: PreviewResult | null;
  resultRev: number;
  error: string | null;
}

export interface ContingencyTiming {
  /** 画面を開いて（または前提を変えて）から、必要保障額の推移が出るまで（ミリ秒） */
  ms: number;
  /** 本体の中の時間 */
  hostMs: number;
  slots: number;
  at: string;
}

/** 計算の枠: 変わった枠だけを本体に送り、古い結果は捨てる（番号で照らし合わせる） */
function useSlots(host: HostApi | null, requests: Record<string, EngineRequest>, onTiming: (t: ContingencyTiming) => void): Record<string, SlotState> {
  const slots = useRef(new Map<string, SlotState>());
  const [, setTick] = useState(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const first = useRef(true);
  useEffect(() => {
    if (host === null) return;
    const changed: { id: string; rev: number; request: string }[] = [];
    for (const [id, req] of Object.entries(requests)) {
      const text = JSON.stringify(req);
      const s = slots.current.get(id);
      if (s === undefined) {
        slots.current.set(id, { rev: 1, request: text, result: null, resultRev: 0, error: null });
        changed.push({ id, rev: 1, request: text });
      } else if (s.request !== text) {
        s.rev++;
        s.request = text;
        changed.push({ id, rev: s.rev, request: text });
      }
    }
    if (changed.length === 0) return;
    setTick((t) => t + 1);
    const run = async () => {
      const t0 = performance.now();
      try {
        const res = await host.compute(changed);
        for (const c of changed) {
          const s = slots.current.get(c.id);
          const r = res.slots[c.id];
          if (s === undefined || r === undefined || s.rev !== c.rev) continue;
          if (isEngineError(r.result)) s.error = r.result.error.code;
          else {
            s.result = r.result;
            s.error = null;
          }
          s.resultRev = c.rev;
        }
        if (changed.some((c) => c.id.startsWith("prot:"))) onTiming({ ms: performance.now() - t0, hostMs: res.ms, slots: changed.length, at: new Date().toISOString() });
      } catch (e) {
        for (const c of changed) {
          const s = slots.current.get(c.id);
          if (s !== undefined && s.rev === c.rev) {
            s.error = typeof e === "string" ? e : "E_HOST";
            s.resultRev = c.rev;
          }
        }
      }
      setTick((t) => t + 1);
    };
    // 開いたときはすぐ。前提を打っている間は少し待ってから（打つたびに計算しない）
    if (timer.current !== null) clearTimeout(timer.current);
    if (first.current) {
      first.current = false;
      void run();
    } else timer.current = setTimeout(() => void run(), 250);
  }, [host, requests, onTiming]);
  return Object.fromEntries(slots.current.entries());
}

export interface ContingencyTabProps {
  wh: WorkingHousehold;
  host: HostApi | null;
  targetAge: number;
  onEdit: (w: WorkingHousehold) => void;
  /** 開いたときの想定（URL の #scenario=death:self） */
  initialScenario?: string;
}

const timings: ContingencyTiming[] = [];
export const contingencyTimings = (): readonly ContingencyTiming[] => timings;

export function ContingencyTab({ wh: saved, host, targetAge, onEdit, initialScenario }: ContingencyTabProps) {
  // 前提のスライダーを動かしている間は、画面の側の世帯（draft）で描いて計算する。指を離したら世帯に書く
  const [draft, setDraft] = useState<WorkingHousehold | null>(null);
  const wh = draft ?? saved;
  const commit = (w?: WorkingHousehold) => {
    const next = w ?? draft;
    setDraft(null);
    if (next !== null && next !== saved) onEdit(next);
  };
  const scs = useMemo(() => scenarios(wh), [wh]);
  const [selected, setSelected] = useState<string>(initialScenario !== undefined && scs.some((s) => s.key === initialScenario) ? initialScenario : (scs[0]?.key ?? ""));
  const sc = scs.find((s) => s.key === selected) ?? scs[0];
  const year = wh.contingency.year ?? defaultYear(wh.request);
  const [chartYear, setChartYear] = useState<number | null>(null);
  const [mode, setMode] = useState<ContingencyMode>("assets");
  const [lastMs, setLastMs] = useState<ContingencyTiming | null>(null);
  const opened = useRef(performance.now());

  const protMembers = useMemo(() => {
    const h = wh.request.input.household;
    const kids = h.members.some((m) => m.kind === "child");
    return adults(h)
      .filter((a) => a.spouse !== undefined || kids)
      .map((a) => a.member.id);
  }, [wh.request]);

  const requests = useMemo(() => {
    const r: Record<string, EngineRequest> = { none: baseRequest(wh.request) };
    protMembers.forEach((m, i) => (r[`prot:${i}`] = protectionRequest(wh, m)));
    if (sc !== undefined) r.sc = scenarioRequest(wh, sc, year);
    return r;
  }, [wh, protMembers, sc, year]);

  const firstDone = useRef(false);
  const onTiming = useMemo(
    () => (t: ContingencyTiming) => {
      // 開いたときの1回目は、画面を開いてからの時間で数える
      const fromOpen = firstDone.current ? t : { ...t, ms: performance.now() - opened.current };
      firstDone.current = true;
      timings.push(fromOpen);
      if (timings.length > 50) timings.shift();
      setLastMs(fromOpen);
    },
    [],
  );
  const slots = useSlots(host, requests, onTiming);

  const model: ContingencyModel = useMemo(() => {
    const charts: ProtectionChartModel[] = [];
    let protStatus: ContingencyModel["protection"]["status"] = "ready";
    let protError: string | null = null;
    protMembers.forEach((m, i) => {
      const s = slots[`prot:${i}`];
      if (s?.error != null) {
        protStatus = "error";
        protError = s.error;
      } else if (s?.result == null) {
        if (protStatus !== "error") protStatus = "loading";
      } else if (s.result.protection !== undefined) {
        const c = protectionChart(JSON.parse(s.request) as EngineRequest, s.result.protection, s.result, m);
        if (c !== null) charts.push(c);
      }
    });
    const none = slots.none;
    const sr = slots.sc;
    let scenario: ContingencyModel["scenario"] = { status: "loading", model: null, error: null, stale: false };
    if (sr?.error != null || none?.error != null) scenario = { status: "error", model: null, error: sr?.error ?? none?.error ?? null, stale: false };
    else if (sc !== undefined && sr?.result != null && none?.result != null)
      scenario = {
        status: "ready",
        model: scenarioModel({ req: wh.request, scenario: sc, year, result: sr.result, none: none.result, targetAge, choice: wh.contingency.oldAgeChoice[sc.member] }),
        error: null,
        stale: sr.resultRev !== sr.rev || none.resultRev !== none.rev,
      };
    const protection: ContingencyModel["protection"] = { status: protStatus, charts, error: protError, ms: lastMs?.ms ?? null };
    const sel = sc?.key ?? "";
    return {
      protection,
      scenarios: scenarioCards({ req: wh.request, scenarios: scs, selected: sel, protection, scenario, grade: wh.contingency.grade }),
      selected: sel,
      year,
      yearOptions: sc !== undefined ? yearOptions(wh.request, sc.member) : [],
      scenario,
    };
  }, [slots, protMembers, sc, scs, wh, year, targetAge, lastMs]);

  const setYear = (y: number) => commit({ ...wh, contingency: { ...wh.contingency, year: y } });
  const roleKey = useMemo(() => new Map(roles(wh.request).map((r) => [r.key, r.member.id])), [wh.request]);
  /** 必要保障額の推移で年を押した: その人の死亡の場面にして、起きる年をその年にする */
  const pick = (key: string, y: number) => {
    const member = roleKey.get(key);
    const s = scs.find((x) => x.kind === "death" && x.member === member);
    if (s !== undefined) setSelected(s.key);
    setChartYear(null);
    setYear(y);
  };
  const sections = useMemo(() => contingencyInputSections(wh), [wh]);
  const used = useMemo(() => {
    if (sc === undefined) return new Set<string>();
    return new Set(sc.kind === "death" ? ["cg/living", "cg/lump", "cg/work", "cg/creditLife"] : ["cg/disability", "cg/creditLife"]);
  }, [sc]);
  const extra =
    sc?.kind === "disability" && (wh.contingency.grade ?? 2) !== 0
      ? { section: "cg/disability", field: oldAgeChoiceField(sc.member), note: "自動で手取りが多い組み合わせを選びます。選び直すとその組み合わせで計算します" }
      : null;

  return (
    <div class="main-stack cg-stack">
      {/* ① 場面の帯 */}
      <ScenarioBand
        model={model}
        onSelect={(k) => {
          setSelected(k);
          setChartYear(null);
        }}
        onYear={(y) => {
          setChartYear(null);
          setYear(y);
        }}
      />
      {/* ② グラフ */}
      <ContingencyChartCard model={model} mode={mode} onMode={setMode} pinnedYear={chartYear} onPinYear={setChartYear} onPick={pick} />
      {/* ③ 想定の前提 */}
      <PremisePanel wh={wh} sections={sections} used={used} extra={extra} onDraft={setDraft} onCommit={commit} />
      {import.meta.env.DEV ? (
        <div class="foot footnote">
          <span class="perf" data-cg-perf>
            必要保障額の推移の計算: {lastMs !== null ? `${(lastMs.ms / 1000).toFixed(2)}秒（本体 ${(lastMs.hostMs / 1000).toFixed(2)}秒・枠 ${lastMs.slots}）` : "—"}／{host?.kind}
          </span>
        </div>
      ) : null}
    </div>
  );
}
