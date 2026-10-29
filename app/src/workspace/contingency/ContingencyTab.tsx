// 万一のときの画面（作業の層）: 必要保障額の推移（大人ごと）・万一なし・選んだ想定を計算し、提示用の値を作って提示層の部品に渡す。
// 配置は見通しと同じ上から下の流れ: ① 場面の帯 → ② 年ごとの結果の帯（起きる年を選ぶ・1年ずつ見せる）→ ③ 大きなグラフ（資産の推移／必要保障額の推移）
// → ④ FP が直す前提の欄（対策の欄と同じ部品）。グラフの見出しの「小窓」で、②③を小窓に出せる（ChartPip。前提の欄を動かしながら見る）。
// このタブに表示の設定は無い（結果のタブの表示の設定にも頼らない）
// 見るプラン: 既定は現状（プランA）。切り替えると、場面の帯・年ごとの結果の帯・グラフ・必要保障額をそのプラン（保存していない変更を含む今の中身）で計算する。
// 想定の前提（遺族の生活費の割合など）は世帯に1つ（全プラン共通）で、プランを見ているときは、そのプランで上書きした値（万一の前提の差分。0071）を
// 当てた前提を使う。前提のパネルの「直す先」で、共通を直すか、そのプランだけ直すかを選ぶ。グラフの枠の名前はプランごとに分け、プランを戻したときは前の結果をすぐ出す。
// 計算はアプリの側が持つ ContingencyEngine で行う（タブを切り替えても結果を捨てない。同じ内容ならすぐ出す）。
// 画面の側のエンジンで先に出し、本体の正の計算で置き換える（見通しと同じ二本立て）。FP用のメモは画面に出さず、上部の引き出しに置く
import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import type { HostApi } from "../../engine/host.ts";
import type { EngineRequest, PreviewResult } from "../../engine/types.ts";
import { ChartPip } from "../../presentation/ChartPip.tsx";
import { ContingencyChartCard, ContingencyVerdict, PipContingency, ScenarioBand, YearStrip, type ContingencyMode, type YearStripProps } from "../../presentation/ContingencyView.tsx";
import type { ContingencyModel, ProtectionChartModel } from "../../presentation/model.ts";
import type { WorkingHousehold } from "../input/household.ts";
import { depletionYear, displayYears } from "../present.ts";
import { roles } from "../roles.ts";
import { CURRENT } from "../plans/band.ts";
import { YearSweep, type ContingencyEngine } from "./engine.ts";
import { premiseItems, SCENE_NOTES } from "./inputs.ts";
import { pickScene, premiseStartKinds, protectionOf, protectionText, sameProtection, withProtection, type PremiseChoice, type ProtectionSetting, type SceneChoice } from "./premiseChoice.ts";
import { overrideCount, premiseFor, writePremise } from "./planPremise.ts";
import { PremisePanel } from "./PremisePanel.tsx";
import { protectionChart, scenarioCards, scenarioModel, scenarioTitle, yearOptions, yearStripModel } from "./present.ts";
import { contractLabels, illnessBenefitNote, illnessBenefits, lapseInsights } from "./insuranceLines.ts";
import { adults, chartRequests, defaultYear, keptSlots, planSlot, scenarioRequest, scenarios } from "./requests.ts";

/** 1年ずつ見せるときの、1年あたりの時間（ミリ秒） */
export const PLAY_STEP_MS = 1000;

/** 小窓のうち、グラフの外の高さ（文字の大きさ 16px のとき。上の帯・年ごとの帯・凡例・余白） */
const PIP_EXTRA = 165;

/** 画面の外（App）で持ち続ける、万一のときの画面の状態（タブを切り替えても戻る） */
export interface ContingencyUi {
  /** 選んでいる場面（death:self など。未選択は undefined） */
  selected?: string;
  mode: ContingencyMode;
  /** 見るプラン（プランの内部 ID。省略は現状のプランA） */
  plan?: string;
  /** 想定の前提に「＋ 動かす項目を追加」で足した項目の種類（足した順。0085。世帯ごとの作業の状態で、世帯ファイルには書かない） */
  premiseAdded?: string[];
  /** プランを見ているときに前提を直す先（省略は全プラン共通。0071） */
  premiseTo?: "common" | "plan";
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
  /** 開いたときの想定（URL の #scenario=death:self） */
  initialScenario?: string;
  /** 見るプランの選択肢（現状 CURRENT と帯のプラン）。無ければ現状だけ */
  plans?: readonly PlanOption[];
  /** プランの計算の要求（打ち手を当てた現状。保存していない変更を含む）。CURRENT は世帯の要求そのもの */
  requestOf?: (id: string) => EngineRequest;
  /** 開いたときに見るプラン（URL の #cgplan=B。帯の文字） */
  initialPlan?: string;
  /** 事務所の既定値（0085）: 想定の前提に最初から出す項目・場面の帯の並べ方・必要保障額の数え方。省略は既定 */
  office?: { premises: PremiseChoice; scenes: SceneChoice; protection: ProtectionSetting };
  /** 開いた直後に想定の前提の「＋ 動かす項目を追加」の一覧を開く（画面の確かめ用） */
  initialPremiseMenu?: boolean;
}

/** 1年ずつ見せている状態: from は見せ始める前に選んでいた年（止めると戻る） */
interface Play {
  status: "playing" | "paused";
  from: number;
  year: number;
}

export function ContingencyTab({ wh: stored, host, engine, targetAge, onEdit, ui, onUi, initialScenario, plans, requestOf, initialPlan, office, initialPremiseMenu }: ContingencyTabProps) {
  // 前提のスライダーを動かしている間は、画面の側の世帯（draft）で描いて計算する。指を離したら世帯に書く
  const [draft, setDraft] = useState<WorkingHousehold | null>(null);
  // ---- 見るプラン（既定は現状）。前提はそのプランの前提（共通の前提に、そのプランの上書きを当てたもの）、計算の要求はそのプランのもの ----
  const wantPlan = ui.plan ?? (initialPlan !== undefined ? plans?.find((p) => p.letter === initialPlan)?.id : undefined);
  const planId = wantPlan !== undefined && wantPlan !== CURRENT && (plans ?? []).some((p) => p.id === wantPlan) && requestOf !== undefined ? wantPlan : CURRENT;
  /** 見ているプランの前提を入れた世帯（前提の欄・計算はこれを見る。書くときは stored の共通の前提かプランの差分へ） */
  const saved = useMemo<WorkingHousehold>(() => {
    if (planId === CURRENT) return stored;
    const c = premiseFor(stored, planId);
    return c === stored.contingency ? stored : { ...stored, contingency: c };
  }, [stored, planId]);
  const premiseTo = planId === CURRENT ? "common" : (ui.premiseTo ?? "common");
  const overrides = useMemo(() => overrideCount(stored, planId === CURRENT ? null : planId), [stored, planId]);
  const edited = draft ?? saved;
  const planReq = useMemo(() => (planId === CURRENT || requestOf === undefined ? saved.request : requestOf(planId)), [planId, saved.request, requestOf]);
  /** 計算に使う世帯（プランの要求＋世帯の前提）。前提の欄はこれを直さず、edited を直す */
  const wh = useMemo<WorkingHousehold>(() => (planReq === edited.request ? edited : { ...edited, request: planReq }), [edited, planReq]);
  const planSaved = useMemo<WorkingHousehold>(() => (planReq === saved.request ? saved : { ...saved, request: planReq }), [saved, planReq]);
  /** グラフの枠の名前（プランごとに分ける） */
  const slot = (name: string) => planSlot(planId, name);
  const recentPlans = useRef<string[]>([]);
  const commit = (w?: WorkingHousehold) => {
    const next = w ?? draft;
    setDraft(null);
    if (next === null || next === saved) return;
    // プランの要求を入れた世帯（年を選んだときなど）は、世帯の要求に戻す。前提の欄（団信）で直した要求はそのまま
    const request = next.request === planReq && planReq !== saved.request ? stored.request : next.request;
    // 前提の違いを、直す先（共通・このプランだけ）に書く
    const base = next.contingency === saved.contingency ? stored : writePremise(stored, planId === CURRENT ? null : planId, saved.contingency, next.contingency, premiseTo);
    if (request === stored.request && base === stored) return;
    onEdit({ ...stored, request, contingency: base.contingency, proposals: base.proposals });
  };
  const [tick, setTick] = useState(0);
  useEffect(() => engine?.subscribe(() => setTick((t) => t + 1)), [engine]);

  // 場面の帯に並べる場面と選んでいる場面（事務所の既定値。その世帯で最後に見た場面・URL の場面があればそちら。0085）
  const allScs = useMemo(() => scenarios(wh), [wh]);
  const { list: scs, selected: sc } = useMemo(() => pickScene(allScs, office?.scenes, ui.selected ?? initialScenario), [allScs, office?.scenes, ui.selected, initialScenario]);
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

  /** 保険の契約の名前（必要保障額の推移の気づき・大きな病気の場面の保険金・給付金の内訳。0055・0071 の追記） */
  const insLabels = useMemo(() => contractLabels(wh), [wh]);
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
        const c = protectionChart(req, s.result.protection, s.result, m, lapseInsights(s.result.protection, m, insLabels));
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
        model: scenarioModel({ req: wh.request, scenario: sc, year, result: sr.result, none: none.result, targetAge, choice: wh.contingency.oldAgeChoice[sc.member], plan: wh.contingency, ...(wh.contingency.market?.drop !== undefined ? { drop: wh.contingency.market.drop } : {}),
          ...(sc.kind === "illness" ? { benefits: { details: illnessBenefits(wh, sc, year, sr.result, none.result, insLabels), note: illnessBenefitNote(wh) } } : {}),
        }),
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
      scenarios: scenarioCards({ req: wh.request, scenarios: scs, selected: sel, protection, grade: wh.contingency.grade, plan: wh.contingency }),
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
  }, [tick, engine, requests, protMembers, sc, scs, wh, year, targetAge, options, sweepList, dragging, planSaved.request, planId, insLabels]);

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
  // ---- 想定の前提（選んでいる場面の項目だけ。最初から出す項目は事務所の既定値。0085）----
  const items = useMemo(() => premiseItems(edited, sc), [edited, sc]);
  const start = useMemo(() => premiseStartKinds(office?.premises), [office?.premises]);
  const added = ui.premiseAdded ?? [];
  // 必要保障額の数え方が事務所の既定値と違う世帯（前の世帯・世帯で直した値）: 小さな1行で知らせ、事務所の値にできる（勝手に書き換えない）
  const officeProt = office?.protection ?? {};
  const ownProt = protectionOf(stored.contingency);
  const protFoot = sameProtection(ownProt, officeProt) ? null : (
    <p class="in-note cg-prot-diff" data-cg-protection-diff>
      必要保障額の数え方: この世帯は「{protectionText(ownProt)}」です（事務所の既定値は「{protectionText(officeProt)}」）。
      <button type="button" class="link-btn" onClick={() => onEdit({ ...stored, contingency: withProtection(stored.contingency, officeProt) })} data-cg-protection-office>
        事務所の値にする
      </button>
    </p>
  );

  const chartProps = { model, mode, pinnedYear: chartYear, onPinYear: setChartYear, onPick: pick };
  const last = engine?.openings.at(-1);
  const previews = engine?.sweep.timings.filter((t) => t.kind === "preview") ?? [];

  return (
    <div class="main-stack cg-stack">
      <ChartPip head={<ContingencyVerdict model={model} mode={mode} />} extra={PIP_EXTRA}>
        {(height) => <PipContingency {...chartProps} height={height} strip={strip} />}
      </ChartPip>
      {/* ① 場面の帯 */}
      <ScenarioBand model={model} onSelect={selectScenario} {...(planChoice !== undefined ? { plan: planChoice } : {})} />
      {/* ② 年ごとの結果の帯 */}
      <YearStrip {...strip} model={model.strip} />
      {/* ③ グラフ */}
      <ContingencyChartCard {...chartProps} onMode={(m) => onUi({ ...ui, mode: m })} />
      {/* ④ 想定の前提 */}
      <PremisePanel
        wh={edited}
        scene={sc !== undefined ? scenarioTitle(sc) : null}
        sceneNote={sc !== undefined ? SCENE_NOTES[sc.kind] : null}
        items={items}
        start={start}
        added={added}
        onAdd={(k) => onUi({ ...ui, premiseAdded: [...added.filter((x) => x !== k), k] })}
        onRemove={(k) => onUi({ ...ui, premiseAdded: added.filter((x) => x !== k) })}
        onDraft={setDraft}
        onCommit={commit}
        foot={protFoot}
        {...(initialPremiseMenu === true ? { initialMenu: true } : {})}
        plan={
          planId === CURRENT
            ? null
            : {
                id: planId,
                name: plans?.find((p) => p.id === planId) !== undefined ? `プラン${plans.find((p) => p.id === planId)?.letter ?? ""}` : "このプラン",
                saved: stored.proposals.some((p) => p.id === planId),
                to: premiseTo,
                onTo: (t) => onUi({ ...ui, premiseTo: t }),
                overrides,
                stored,
                onRevert: (w) => {
                  setDraft(null);
                  onEdit(w);
                },
              }
        }
      />
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
