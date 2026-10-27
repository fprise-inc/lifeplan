// 画面の大枠（作業の層）: 世帯を開き、案（現状＋帯に並べた案）を二本立てのエンジンで計算し、提示用の値を作って提示層の部品に渡す。
// 主画面の配置（2026-10-17 に決定）: 上から ① 案の帯 → ② グラフ（幅いっぱい・上下を大きく） → ③ 対策 → ④ 生涯キャッシュフロー表
import type { EngineRequest, PreviewResult } from "../engine/types.ts";
import { useCallback, useEffect, useMemo, useRef, useState } from "preact/hooks";
import { DualEngine } from "../engine/dual.ts";
import { devBrowserHost, isTauri, singleCompute, tauriHost, webEngine, type AiCandidate, type ForkInfo, type HostApi, type OfficeStatus, type PresenceView, type StorageNotice, type StoredHousehold, type StoredOpened, type StoreStatus, type WebEngine, type WebSession } from "../engine/host.ts";
import { isEngineError } from "../engine/types.ts";
import { ALL_ROWS, applyRowsView, forEngine, pickRow, viewMode, type RowsView } from "../engine/moneyRows.ts";
import { RowsViewBar } from "./RowsViewBar.tsx";
import { viewRows } from "./rowsView.ts";
import { CalcNotices } from "./CalcNotices.tsx";
import { noticeRows } from "./engineNotices.ts";
import { engineErrorText } from "./engineErrors.ts";
import { CompareTable } from "../presentation/Compare.tsx";
import { EvidencePanel, type EvidenceState } from "../presentation/EvidencePanel.tsx";
import { multiOn, type ChartLayout, type ChartMode } from "../presentation/MainChart.tsx";
import { ChartPip, closePip, openPip } from "../presentation/ChartPip.tsx";
import { CashflowTable, FeeNote, PipResult, ResultCard, ResultVerdictView } from "../presentation/MainView.tsx";
import { PlanBand } from "../presentation/PlanBand.tsx";
import { BalanceTab, type BsView } from "../presentation/BalanceTab.tsx";
import type { BsPlanModel, BsPrevModel } from "../presentation/model.ts";
import { balanceTabModel, bsPlan, bsPrev } from "./balanceTab.ts";
import { MONEY_THREE_NAME_CHOICES, moneyThreeModel } from "./moneyThree.ts";
import { snapshotDateText, TRIGGER_TEXT } from "./snapshots/snapshots.ts";
import { colorStyle, PLAN_COLORS } from "../presentation/planLines.tsx";
import { AiCandidates } from "./ai/AiCandidates.tsx";
import { AiConnectorPanel } from "./ai/AiConnectorPanel.tsx";
import { AiShareBand } from "./ai/AiShareBand.tsx";
import { AiSharePanel } from "./ai/AiSharePanel.tsx";
import { acceptCandidate as acceptAiCandidate, aiMessage, candidatePlanName, candidateRows, candidateValues, shareState, SHARE_STATE_TEXT } from "./ai/model.ts";
import { useAi } from "./ai/useAi.ts";
import { DEMO_HOUSEHOLDS, demoHousehold, type DemoHousehold } from "./catalog.ts";
import { seedDemo } from "./demoSeed.ts";
import { ContingencyEngine } from "./contingency/engine.ts";
import { ContingencyTab, type ContingencyUi } from "./contingency/ContingencyTab.tsx";
import { HearingTools } from "./hearing/HearingTools.tsx";
import { ReportTab } from "./report/ReportTab.tsx";
import { runWireCheck } from "./report/wirecheck.ts";
import { DisplaySettingsPanel } from "./DisplaySettingsPanel.tsx";
import { buildEvidence } from "./evidence.ts";
import { explainModel } from "./explain.ts";
import type { Level } from "./input/form.ts";
import { blankHousehold, fromRequest, sampleRequest, withElementIds, type WorkingHousehold } from "./input/household.ts";
import { InputView } from "./input/InputView.tsx";
import { addItem, saveItem } from "./input/items.ts";
import { withRefreshedEstimates } from "./input/estimates.ts";
import { applyOfficeDefaults, DEFAULT_OFFICE_SETTINGS, layoutOf, publishOfficeSettings, readOfficeSettings, type OfficeSettings } from "./office/settings.ts";
import { OfficeSettingsPanel } from "./office/OfficeSettingsPanel.tsx";
import { FpTools } from "./tools/FpTools.tsx";
import { Insights, useInheritanceFor } from "./tools/Insights.tsx";
import { pensionNotices } from "./input/stages/pension.ts";
import { withProvisionalHousing } from "./input/housingCredit.ts";
import { LeverCard, type FeeToggle, type LeverRow } from "./LeverPanel.tsx";
import { bandShown, donutPanes, donutShown, donutYear, investChart, investVerdict, stressRequests, STRESS_KEYS, type StressKey } from "./invest/present.ts";
import { InvestBar, DonutCard } from "./invest/InvestBar.tsx";
import { DrawdownCalc } from "./invest/DrawdownCalc.tsx";
import { advisoryFeeInCurrent, feeSummary, hasAdvisoryFee, LEVER_KEYS, type LeverKey } from "./levers.ts";
import { MemoDrawer } from "./MemoDrawer.tsx";
import { mixFromBuckets } from "./plans/allocation.ts";
import { addToBand, assignColors, bandModel, cleanBand, CURRENT, MAX_BAND, planLetters, planLinesModel, removeFromBand } from "./plans/band.ts";
import { compareTable, metricsOf } from "./plans/compare.ts";
import { usePlanPensions } from "./input/pensionEstimate.ts";
import { dependentRefRequest, dependentRefRows, useRefResult } from "./resultRows.ts";
import { addRate } from "./plans/decimal.ts";
import { ItemMenu, ItemRow } from "./plans/ItemControls.tsx";
import { amountRange, buildCatalog, leverSteps, type Catalog, type ItemValue, type MovableItem } from "./plans/items.ts";
import { PlanList } from "./plans/PlanList.tsx";
import { acknowledge, applyValues, changesOf, changesOfValues, dropChange, effectiveValues, findPlan, headLetter, modernPlanName, normalizeValues, overwritePlan, planLabel, reflectPlan, sameValues, savePlan, suggestName, valueOf, type Values } from "./plans/plans.ts";
import { cashflowTable, displayYears, eventsOf, toPresentation, withDiff } from "./present.ts";
import { withoutRemovedAssumptions } from "./surplus.ts";
import { roles } from "./roles.ts";
import { runContingencyCheck, runInputCheck, runPlansCheck, runSelfCheck } from "./selfcheck.ts";
import { ageMarkOf, DEFAULT_BALANCE_SETTINGS, DEFAULT_DISPLAY_SETTINGS, METRIC_CHOICES, shows, verdictMetrics, type BalanceSettings, type DisplaySettings, type MetricKey } from "./settings.ts";
import { Autosaver, type SaveState } from "./store/autosave.ts";
import { bodyOf, EMPTY_CARRY, fromBody, summaryOf, type BodyState } from "./store/body.ts";
import { ForkPanel, type ForkChoiceUi } from "./store/ForkPanel.tsx";
import { HouseholdPanel, storeMessage, copyRequest, defaultCategory } from "./store/HouseholdPanel.tsx";
import { editorsOf, mergeForkBodies, presenceText } from "./store/office.ts";
import { guessShape, sampleNoText, shelfItems, type Category, type CategoryEdit, type CategorySettings, type SampleInfo, type SampleRequest, type ShelfItem } from "./store/numbering.ts";
import { OfficePanel } from "./store/OfficePanel.tsx";
import { RecoveryPanel, type RecoveryMode } from "./store/RecoveryPanel.tsx";
import { StoragePanel } from "./store/StoragePanel.tsx";
import { keepSnapshots, makeSnapshot, type Snapshot, type SnapshotDraft } from "./snapshots/snapshots.ts";
import { keepStatements, withLog } from "./statement/model.ts";
import { StatementPanel } from "./statement/StatementPanel.tsx";
import type { StatementLog } from "../../../statement/src/index.ts";
import { SnapshotTools } from "./snapshots/SnapshotTools.tsx";
import { FpMenu, fpMenuGroups, officeShareText, storageText, type FpMenuAction } from "./header/FpMenu.tsx";
import { reviewTiming } from "./tools/FpTools.tsx";
import { formatYearMonth } from "./input/units.ts";
import { describeSnap, sameSnap, useHistoryBook, type AppSnap } from "./undo/appHistory.ts";
import { version as APP_VERSION } from "../../package.json";
import { installUndo, undoController } from "./undo/controller.ts";
import { UndoButtons } from "./undo/UndoButtons.tsx";
import { HouseholdDrop } from "./header/HouseholdDrop.tsx";
import { BasisLine, HouseholdNow } from "./header/HouseholdNow.tsx";
import { barAlerts, barNotices, saveText, type AlertKind, type BarInputs, type NoticeTarget } from "./header/status.ts";
import { TopBar } from "./header/TopBar.tsx";

type Tab = "input" | "main" | "balance" | "contingency" | "report";
/** FP のメニューから開く、入力のホームの中身 */
type FpOpen = null | "snapTake" | "snapList" | "contents" | "year" | "review" | "imports";
export const TABS: { id: Tab; label: string }[] = [
  { id: "input", label: "入力" },
  { id: "main", label: "結果" },
  { id: "balance", label: "資産と負債" },
  { id: "contingency", label: "万一のとき" },
  { id: "report", label: "提案書" },
];

/** URL の # の後ろ（画面の確かめ用: #big・#household=…（blank は空の世帯）・#levers=65,65,30000,280000・#year=2047・#evidence=pension:self:2047・#selfcheck・#tab=input・#open=work（#stage=work も同じ）・#level=detail・#fee=off・#scenario=death:self・#memo・#snapshots（入力のホームで控えの一覧を開く）・#fpmenu（上の帯の FP のメニューを開く）・#notices（結果のタブの計算の知らせを開く）・#report=takeaway（提案書のタブを持ち帰り用のレポートで開く）・#cgplan=B（万一のときの画面で見るプランの帯の文字）・#add=pet,periodic（開発用のサーバーだけ: 項目を足して保存した状態で開く）・#chart=flows・#explain=2・
 * #items=loan,rate,shift,mix,surplus（開発用のサーバーだけ: 動かす項目を足す）・#seed=plans（開発用のサーバーだけ: 見本の案を5つ）・#seedopen・#addmenu・#save・#selfcheck=plans・
 * #sel=C・#base=B（帯の案の文字）・#diff（表に差を表示）・#settings（表示の設定を開く）・#metrics=assetsAtAge,takeHome・#age=90・#compare（比較の表を開く）・#list（案の一覧を開く）・#scroll=table・#layout=side（グラフを左右に並べる）） */
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
  /** #snapshots: 入力のホームで控えの一覧を開いて開く */
  snapshots?: boolean;
  /** #fpmenu: 上の帯の FP のメニューを開いて開く（画面の確かめ用） */
  fpMenu?: boolean;
  /** 結果のタブの計算の知らせを開いた状態で開く（#notices） */
  notices?: boolean;
  /** #statement=review: 入力で明細のパネルをその手順で開く（閉じると基本生活費のパネルに戻る。0034。画面の確かめ用） */
  statement?: "accounts" | "import" | "review" | "result";
  /** #report=takeaway: 提案書のタブを「持ち帰り用のレポート」で開く（0030） */
  reportMode?: "pdf" | "takeaway";
  /** #cgplan=B: 万一のときの画面で見るプラン（帯の文字） */
  cgPlan?: string;
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
  /** 資産と負債のタブの見せ方（#bsview=three など）・年（#bsyear=2046）・カスタマイズで足した最初の見るもの（#bsopen=combined。足したものが無ければ家計のバランスシート）・表で見る（#bstable）・表示の設定を開く（#bssettings） */
  bsView?: BsView;
  bsYear?: number;
  bsOpen?: "combined";
  bsTable?: boolean;
  bsSettings?: boolean;
  /** #bsm3: 資産と負債のタブのお金の3つの分け方の区画へ移って開く（0032。画面の確かめ用） */
  bsM3?: boolean;
  /** #pip: 開いたタブのグラフを小窓で出した状態で開く（画面の確かめ用） */
  pip?: boolean;
  /** #stress: 相場が下がった場合を重ねて開く（0026） */
  stress?: boolean;
  /** #inv=breakdown,periods（口座の内訳・運用の期間の帯を出す）・#inv=noperiods（帯を外す）。画面の確かめ用 */
  inv?: string[];
  /** #mix=class: 資産の内訳を資産の種類ごとで開く */
  mix?: "class";
  /** #calc: 取り崩しの計算を開いて開く */
  calc?: boolean;
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
  /** グラフの比べ方 */
  layout?: ChartLayout;
} {
  const out: ReturnType<typeof parseHash> = { big: false, selfcheck: false };
  for (const part of hash.replace(/^#/, "").split("&")) {
    const [k, v] = part.split("=") as [string, string | undefined];
    if (k === "big") out.big = true;
    else if (k === "memo") out.memo = true;
    else if (k === "snapshots") out.snapshots = true;
    else if (k === "fpmenu") out.fpMenu = true;
    else if (k === "notices") out.notices = true;
    else if (k === "statement" && (v === "accounts" || v === "import" || v === "review" || v === "result")) out.statement = v;
    else if (k === "report" && (v === "takeaway" || v === "pdf")) out.reportMode = v;
    else if (k === "selfcheck") {
      out.selfcheck = true;
      if (v === "input") out.selfcheckInput = true;
      if (v === "contingency") out.selfcheckContingency = true;
      if (v === "plans") out.selfcheckPlans = true;
      if (v === "wire") out.selfcheckWire = true;
    } else if (k === "chart" && (v === "flows" || v === "assets")) out.chart = v;
    else if (k === "chart" && v === "balance") out.tab = "balance";
    else if (k === "bsview" && (v === "one" || v === "three" || v === "plans" || v === "prev")) out.bsView = v;
    else if (k === "bsyear" && v !== undefined && /^\d{4}$/.test(v)) out.bsYear = Number(v);
    else if (k === "bsopen" && v === "combined") out.bsOpen = "combined";
    else if (k === "bstable") out.bsTable = true;
    else if (k === "bssettings") out.bsSettings = true;
    else if (k === "bsm3") out.bsM3 = true;
    else if (k === "pip") out.pip = true;
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
    else if (k === "cgplan" && v !== undefined && /^[A-Z]$/.test(v)) out.cgPlan = v;
    else if (k === "diff") out.diff = true;
    else if (k === "settings") out.settings = true;
    else if (k === "metrics" && v !== undefined) out.metrics = v.split(",").filter((x): x is MetricKey => METRIC_CHOICES.some((c) => c.key === x));
    else if (k === "age" && v !== undefined && /^\d{2,3}$/.test(v)) out.age = Number(v);
    else if (k === "compare") out.compare = true;
    else if (k === "list") out.list = true;
    else if (k === "scroll" && v === "table") out.scroll = "table";
    else if (k === "layout" && (v === "side" || v === "overlay" || v === "all")) out.layout = v;
    else if (k === "stress") out.stress = true;
    else if (k === "inv" && v !== undefined) out.inv = v.split(",").filter((x) => /^[a-z]+$/.test(x));
    else if (k === "mix" && v === "class") out.mix = "class";
    else if (k === "calc") out.calc = true;
  }
  return out;
}

const BLANK = "__blank__";

/** 小窓のうち、グラフの外の高さ（文字の大きさ 16px のとき。上の帯・凡例・余白） */
const MAIN_PIP_EXTRA = 92;

export { feeSummary };

export { leverSteps };

interface Opened {
  /** 見本の世帯（目盛り・最初の提案の既定）。空の世帯は null */
  demo: DemoHousehold | null;
  /** 画面の中で編集する世帯（現状と案） */
  wh: WorkingHousehold;
  selfId: string;
  /** 動かす項目の一覧（現状から作る。現状が変わったら作り直す） */
  catalog: Catalog;
}

/**
 * 開いた世帯・入れ直した現状から、画面の状態を作る。住宅ローン控除の条件が無い住宅ローンには、ここで仮の条件を置く
 * （「仮」の印つき。開いた世帯でも置く。0008 の 2026-10-25 の追記）
 */
function openedFrom(demo: DemoHousehold | null, wh0: WorkingHousehold): Opened | null {
  // 画面で新しく足した並びの要素に ID を振る（乱数。番号で当てないため。0035 の5）
  const wh1 = withProvisionalHousing(wh0);
  const request = withElementIds(wh1.request, true);
  const wh = request === wh1.request ? wh1 : { ...wh1, request };
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
export const savedValues = (wh: WorkingHousehold, id: string): Values => (id === CURRENT ? {} : effectiveValues(wh, id));
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
  if (w.sel === CURRENT) return `${planLabel(letter(CURRENT))}（現状）は入力の画面で直します。上の帯で別のプランを選ぶか、「＋ このプランを元に作る」で新しいプランを作ってから動かしてください。`;
  if (w.sel === w.base) return "基準のプランは動かせません。上の帯で別のプランを選ぶか、「＋ このプランを元に作る」で新しいプランを作ってから動かしてください。";
  return null;
}

/** 運用の期間の帯の切れ目を動かせないときの短い理由（グラフの上のつまみの札。動かせるときは null。lockReason と同じ決まり） */
export function bandLockNote(w: Work): string | null {
  if (w.sel === CURRENT) return "現状は入力の画面で直します。別のプランを選ぶか『＋ このプランを元に作る』で動かせます";
  if (w.sel === w.base) return "基準のプランは動かせません。別のプランを選ぶか『＋ このプランを元に作る』で動かせます";
  return null;
}

/** 帯の文字 → 枠（案の ID か現状） */
export const slotOfLetter = (letters: Map<string, { letter: string }>, slots: readonly string[], letter: string): string | undefined => slots.find((id) => letters.get(id)?.letter === letter);

function thisMonth(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

const nowIso = () => new Date().toISOString();

const codeOf = (e: unknown) => (typeof e === "string" ? e : e instanceof Error ? e.message : "E_STORE");

/** 開いている保存した世帯（見本・保存していない世帯のときは null） */
interface StoredRef {
  id: string;
  customerNo: string;
  readOnly: boolean;
  /** 見本の世帯（自分で作った見本。0033） */
  sample?: SampleInfo;
  /** 読んだ拡張領域（書き戻して失わない。0011 の4） */
  carry: BodyState["carry"];
}

/** 世帯ファイルの本文（0011 の2）: 現状・案・案の帯の並び・対策に足した項目・表示の設定（保存していない案の変更は入れない）。控え（0009）は区画 snapshots に置く */
function bodyFor(o: Opened, w: Work, shownKeys: string[], s: DisplaySettings, bs: BalanceSettings, carry: BodyState["carry"]): string {
  return bodyOf({ wh: o.wh, workspace: { template: o.demo?.id ?? null, band: w.band, base: w.base, selected: w.sel, shownItems: shownKeys }, display: { result: s, balance: bs }, carry });
}

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
  /** 全部の案を色分けで重ねる表示で、凡例のクリックで一時的に隠している案（帯の文字。保存しない） */
  const [hiddenLines, setHiddenLines] = useState<string[]>([]);
  /** 全部のプランを色分けで重ねる表示の色の番号（プランの内部 ID → 番号）。ID は世帯をまたいでも重ならないので、アプリを開いている間持ち続ける */
  const colorMap = useRef<ReadonlyMap<string, number>>(new Map());
  const [scrollNonce, setScrollNonce] = useState(0);
  const [big, setBig] = useState(initial.big);
  const [tab, setTab] = useState<Tab>(initial.tab ?? "main");
  const [chartMode, setChartMode] = useState<ChartMode>(initial.chart ?? "assets");
  /** 相場が下がった場合を重ねる（最初は出さない。保存しない）と、一時的に外した線 */
  const [stressOn, setStressOn] = useState(initial.stress === true);
  const stressRef = useRef(initial.stress === true);
  const [stressHidden, setStressHidden] = useState<string[]>([]);
  /** 資産の内訳のドーナツの分け方 */
  const [donutBy, setDonutBy] = useState<"account" | "class">(initial.mix === "class" ? "class" : "account");
  const [explainStep, setExplainStep] = useState<number | null>(initial.explain ?? null);
  const [tableKey, setTableKey] = useState<string | null>(null);
  const [showDiff, setShowDiff] = useState(initial.diff === true);
  const [settings, setSettings] = useState<DisplaySettings>({ ...DEFAULT_DISPLAY_SETTINGS, ...(initial.metrics !== undefined ? { metrics: initial.metrics } : {}), ...(initial.age !== undefined ? { atAge: initial.age } : {}), ...(initial.layout !== undefined ? { layout: initial.layout } : {}), ...(initial.inv !== undefined ? { invBreakdown: initial.inv.includes("breakdown"), invPeriods: initial.inv.includes("periods") ? true : initial.inv.includes("noperiods") ? false : null } : {}) });
  /** 資産と負債のタブの表示の設定（結果のタブの表示の設定とは別） */
  const [bsSettings, setBsSettings] = useState<BalanceSettings>(DEFAULT_BALANCE_SETTINGS);
  const [settingsOpen, setSettingsOpen] = useState(initial.settings === true);
  const [panel, setPanel] = useState<null | "list" | "compare">(initial.compare === true ? "compare" : initial.list === true ? "list" : null);
  /** 知らせから開く入力のカード（n を変えると入力の画面を開き直す） */
  const [cardOpen, setCardOpen] = useState<{ id: string; n: number } | null>(null);
  /** 入力の画面でプランを直しているか（0036 の8）。直す対象は結果のタブで選んでいるプラン（work.sel）にそろえる。世帯を開いたときは現状 */
  const [inputPlanOn, setInputPlanOn] = useState(false);
  /** 画面下の知らせ。undo のときは「元に戻す」を添える（帯のカードの × でプランを外したときなど） */
  const [notice, setNotice] = useState<{ text: string; undo: boolean } | null>(null);
  // カードの入れ方の初め（#level=detail）。切り替えはカードごとに入力のホームの中で持つ（0077）
  const level: Level = initial.level ?? "simple";
  const [memoOpen, setMemoOpen] = useState(initial.memo === true);
  /** FP のメニュー（上の帯）から開いた、入力のホームの中身（控え・面談の準備・取り込む）。1つずつ開く */
  const [fpOpen, setFpOpen] = useState<FpOpen>(initial.snapshots === true ? "snapList" : null);
  // 世帯の保存（0011・0013）
  const [storeStatus, setStoreStatus] = useState<StoreStatus | null>(null);
  const [storeUnavailable, setStoreUnavailable] = useState<string | null>(null);
  const [storeChecked, setStoreChecked] = useState(false);
  const [storedList, setStoredList] = useState<StoredHousehold[]>([]);
  const [storedInfo, setStoredInfo] = useState<Omit<StoredRef, "carry"> | null>(null);
  /** 区分の一覧と、自分で作った見本の棚（0033） */
  const [categories, setCategories] = useState<Category[]>([]);
  /** 区分を使うかを決めたか（まだなら世帯の一覧で1回だけ聞く。読む前は聞かない） */
  const [categoriesDecided, setCategoriesDecided] = useState(true);
  const applyCategories = useCallback((c: CategorySettings) => {
    setCategories(c.categories);
    setCategoriesDecided(c.decided);
  }, []);
  const [storedSamples, setStoredSamples] = useState<StoredHousehold[]>([]);
  /** 自分で作った見本を開いている: view＝動かしても保存しない（閉じれば元どおり）、edit＝「この見本を直す」で保存している */
  const [sampleMode, setSampleMode] = useState<null | "view" | "edit">(null);
  /** 開いたときに見せる世帯の一覧のタブ */
  const [hhTab, setHhTab] = useState<"customers" | "samples">("customers");
  const [hhOpen, setHhOpen] = useState(false);
  const [hhError, setHhError] = useState<string | null>(null);
  const [recovery, setRecovery] = useState<RecoveryMode | null>(null);
  /** AI接続口の中央のパネル（事務所の設定・世帯の同意と共有） */
  const [aiPanel, setAiPanel] = useState<null | "connector" | "share">(null);
  // 事務所での共有（0023）
  const [officeStatus, setOfficeStatus] = useState<OfficeStatus | null>(null);
  const [officeOpen, setOfficeOpen] = useState(false);
  /** 事務所の既定値（0073。事務所データから読む。新しい世帯に写す・ホームの並び） */
  const [officeSettings, setOfficeSettings] = useState<OfficeSettings>(DEFAULT_OFFICE_SETTINGS);
  const officeSettingsRef = useRef<OfficeSettings>(DEFAULT_OFFICE_SETTINGS);
  const [officeSettingsOpen, setOfficeSettingsOpen] = useState(false);
  const putOfficeSettings = (v: OfficeSettings) => {
    officeSettingsRef.current = v;
    setOfficeSettings(v);
    publishOfficeSettings(v);
  };
  /** 明細のパネル（0034）を最初に開く手順（URL の #statement=review など。最初の1回だけ使う） */
  const statementStep = useRef(initial.statement);
  // 保存先（1人で2台の PC の同期フォルダ。0024）: パネル（"open" は2台目の PC として開く節を先に出す）と、保存先と同期の知らせ
  const [storageOpen, setStorageOpen] = useState<null | "default" | "open">(null);
  const [storageNotices, setStorageNotices] = useState<StorageNotice[]>([]);
  /** 開発用のビルドで、鍵をファイルに置いている（取り違えないよう札を出す） */
  const [devKeys, setDevKeys] = useState(false);
  /** 開いた世帯を、ほかのメンバーが開いている（自動保存を止めて開いている間） */
  const [presence, setPresence] = useState<PresenceView[] | null>(null);
  /** 開いている人がいるので自動保存を止めているときの、保存済みの本文 */
  const pausedBody = useRef<string | null>(null);
  /** 分岐を選ぶ画面 */
  const [fork, setFork] = useState<{ id: string; info: ForkInfo | null; busy: boolean; error: string | null } | null>(null);
  /** 開いた世帯のメンバーの表示名（世帯ファイルの記録から。メモの書いた人の表示に使う） */
  const [fileEditors, setFileEditors] = useState<Record<string, string>>({});
  const [saveState, setSaveState] = useState<SaveState>({ kind: "idle" });
  const storedRef = useRef<StoredRef | null>(null);
  const autosaver = useRef<Autosaver | null>(null);
  /** 保存した世帯ごとの、最後に保存した（読んだ）本文（開き直したときに元に戻すの履歴を続けてよいかの目安） */
  const savedBodies = useRef(new Map<string, string>());
  const shownRef = useRef<string[]>([]);
  const openedRef = useRef<Opened | null>(null);
  const workRef = useRef<Work>(work);
  workRef.current = work;
  const settingsRef = useRef<DisplaySettings>(settings);
  settingsRef.current = settings;
  const bsSettingsRef = useRef<BalanceSettings>(bsSettings);
  bsSettingsRef.current = bsSettings;
  shownRef.current = shown;
  const [evidence, setEvidence] = useState<EvidenceState | null>(null);
  const [, setTick] = useState(0);
  const dual = useRef<DualEngine | null>(null);
  const session = useRef<WebSession | null>(null);
  /** 画面の側のエンジンとパック（万一のときの計算で、別のセッションを作るため） */
  const webRef = useRef<{ web: WebEngine | null; packs: string | null }>({ web: null, packs: null });
  /** 万一のときの計算（アプリの側で持ち続ける。タブを切り替えても結果を捨てない） */
  const cgEngine = useRef<ContingencyEngine | null>(null);
  const [cgUi, setCgUi] = useState<ContingencyUi>({ mode: "assets" });
  const compareTimings = useRef<{ ms: number; hostMs: number; slots: number }[]>([]);
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ---- 元に戻す・やり直す: 世帯データ・案・表示の設定を変える setter を history.track で包む（世帯ごとの履歴）----
  const history = useHistoryBook<AppSnap<Work>>({
    read: () => (openedRef.current === null ? null : { wh: openedRef.current.wh, work: workRef.current, settings: settingsRef.current, bs: bsSettingsRef.current }),
    same: sameSnap,
    describe: describeSnap,
    apply: (s) => restore(s),
  });

  /** グラフで年を固定する・外す（固定したら表の同じ年の列まで横に動かす） */
  const pinYear = useCallback((y: number | null) => {
    setSelectedYear(y);
    if (y !== null) setScrollNonce((n) => n + 1);
  }, []);
  const say = useCallback((msg: string, undo = false) => {
    setNotice({ text: msg, undo });
    if (noticeTimer.current !== null) clearTimeout(noticeTimer.current);
    noticeTimer.current = setTimeout(() => setNotice(null), undo ? 6000 : 3200);
  }, []);
  useEffect(() => {
    undoController.notify = say;
    return installUndo(undoController);
  }, [say]);
  // 「元に戻す」を添えた知らせの後に別の変更が入ったら、「元に戻す」を引っ込める（その別の変更を戻してしまわない）
  useEffect(() => {
    if (notice?.undo !== true) return;
    return undoController.subscribe(() => setNotice((n) => (n !== null && n.undo ? { ...n, undo: false } : n)));
  }, [notice]);

  // 文字を大きくする: html の class の切り替えは上の帯（TopBar）が行う（切り替えた直後に帯の詰め方を測り直すため）

  // 起動: 本体（Tauri）か、開発用のサーバー（ブラウザでの確認）か
  useEffect(() => {
    void (async () => {
      try {
        const web = webEngine();
        const h = isTauri() ? tauriHost() : import.meta.env.DEV && web !== null ? devBrowserHost(web) : null;
        if (h === null) throw new Error("E_NO_HOST");
        const packs = await h.packs();
        webRef.current = { web, packs };
        if (web !== null) {
          const s = web.createSession(packs);
          // パックを読めなかったときは先出しを使わず、本体の計算だけにする
          session.current = s.status().startsWith('{"error"') ? null : s;
        }
        const ids = new Set(await h.listHouseholds());
        const list = DEMO_HOUSEHOLDS.filter((d) => ids.has(d.id));
        setHouseholds(list);
        // 世帯の保存: 初回はここで事務所の鍵と鍵置き場を作る（本体）
        try {
          const st = await h.store.status();
          setStoreStatus(st);
          if (st.state === "ready") {
            setStoredList(await h.store.list());
            void h.store.listSamples().then(setStoredSamples, () => undefined);
            void h.store.categories().then(applyCategories, () => undefined);
          }
          if (st.state === "needsRecovery") setRecovery("restore");
          else if (st.firstRun && !st.recoveryAcknowledged) setRecovery("first");
        } catch (e) {
          setStoreUnavailable(storeMessage(codeOf(e)));
        }
        void h.office.status().then(setOfficeStatus, () => undefined);
        void h.office.notices().then(setStorageNotices, () => undefined);
        void h.store.devFileKeys().then((dev) => {
          setDevKeys(dev);
          // 取り違えないよう、窓の名前にも出す（上の帯には出さない）
          if (dev) document.title = "ファイナンシア（開発用・鍵はファイル）";
        }, () => undefined);
        autosaver.current = new Autosaver(async (body) => {
          const sr = storedRef.current;
          const o = openedRef.current;
          if (sr === null || o === null) throw "E_STORE_NOT_OPEN";
          const at = (await h.store.save(sr.id, body, summaryOf(o.wh.request))).savedAt;
          savedBodies.current.set(sr.id, body);
          return at;
        }, setSaveState);
        setStoreChecked(true);
        setHost(h);
      } catch (e) {
        setFatal(e instanceof Error ? e.message : String(e));
      }
    })();
  }, []);

  // アプリを閉じる前に、自動保存の残りを書く（本体が閉じるときに呼ぶ。済んだら本体に知らせる）
  useEffect(() => {
    if (host === null || host.kind !== "tauri") return;
    const w = window as unknown as { __financiaBeforeClose?: () => void };
    w.__financiaBeforeClose = () => {
      void (async () => {
        try {
          await autosaver.current?.flush();
        } finally {
          await host.store.closeReady();
        }
      })();
    };
    const hide = () => void autosaver.current?.flush();
    window.addEventListener("pagehide", hide);
    return () => window.removeEventListener("pagehide", hide);
  }, [host]);

  // ---- 計算の要求（枠: 現状・帯の案。表示の設定で FP顧問料の一文を出すときは、選んだ案の顧問料を入れ替えた枠 alt も）----
  const reqCache = useRef(new Map<string, EngineRequest>());
  /**
   * 結果の見方（保存しない自動の差分。0044 の追記）: 「すべて入れる｜確実な分だけ」と物ごとの入れ外しを当てた要求で、全部の枠を計算する。
   * 確実な分だけは、見込みが「当てにしない」の入るお金と優先度が「できれば」の出るお金を外す。基本の計算に入れない物も、ここで入れて見られる
   */
  const viewRef = useRef<RowsView>(ALL_ROWS);
  const [rowsView, setRowsView] = useState<RowsView>(ALL_ROWS);
  /** 見方を当てる前の要求（プランの値を当てた世帯。見方の一覧に使う） */
  const rawCache = useRef(new Map<string, EngineRequest>());
  const rawReqOf = useCallback((o: Opened, values: Values): EngineRequest => {
    const key = JSON.stringify(values);
    const hit = rawCache.current.get(key);
    if (hit !== undefined) return hit;
    const applied = applyValues(o.wh, values, o.catalog);
    if (rawCache.current.size > 64) rawCache.current.clear();
    rawCache.current.set(key, applied);
    return applied;
  }, []);
  const reqOf = useCallback(
    (o: Opened, values: Values): EngineRequest => {
      const key = `${JSON.stringify(viewRef.current)}:${JSON.stringify(values)}`;
      const hit = reqCache.current.get(key);
      if (hit !== undefined) return hit;
      const r = applyRowsView(rawReqOf(o, values), viewRef.current);
      if (reqCache.current.size > 64) reqCache.current.clear();
      reqCache.current.set(key, r);
      return r;
    },
    [rawReqOf],
  );
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
      const out: Record<string, EngineRequest> = { [CURRENT]: applyRowsView(o.wh.request, viewRef.current) };
      for (const id of w.band) out[id] = reqOf(o, valuesOf(o.wh, w, id));
      const alt = altFor(o, w, s);
      if (alt !== null) out.alt = alt;
      // 相場が下がった場合（重ねているときだけ。選んだプランに3つの型を重ねた枠。0026）
      if (stressRef.current) {
        const sr = stressRequests(out[w.sel] as EngineRequest);
        for (const k of STRESS_KEYS) out[`stress:${k}`] = sr[k];
      }
      return out;
    },
    [reqOf, altFor],
  );

  /** 作業の状態を置き直して計算する。slide: 選んだ案の1枠だけ先出し、release: 先出しのあと正の計算、set: 全部の枠（帯が変わったとき） */
  const putWorkRaw = useCallback(
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
      // 相場が下がった場合の枠は、指を離してから計算し直す
      const stress = Object.entries(all).filter(([k]) => k.startsWith("stress:"));
      if (mode === "release" && stress.length > 0) void dual.current.set(Object.fromEntries(stress));
    },
    [requestsFor],
  );
  const putWork = useCallback(
    (w: Work, o: Opened | null = openedRef.current, mode: "slide" | "release" | "set" = "set") => history.track(() => putWorkRaw(w, o, mode)),
    [putWorkRaw, history],
  );

  const addOnce = useRef(false);
  const seedOnce = useRef(false);
  /** 開いた世帯を画面に置き、計算する（見本・空・保存した世帯で共通） */
  const install = useCallback(
    async (o: Opened, w: Work, shownKeys: string[], historyKey: string, keepHistory: boolean) => {
      if (host === null) return;
      openedRef.current = o;
      workRef.current = w;
      shownRef.current = shownKeys;
      // 元に戻すの履歴はその世帯のもの。開いた直後の状態は履歴に積まない
      if (keepHistory) history.select(historyKey);
      else history.reset(historyKey);
      setOpened(o);
      setWork(w);
      setShown(shownKeys);
      setTableKey(null);
      setEvidence(null);
      dual.current = new DualEngine({ session: session.current, host, onChange: () => setTick((t) => t + 1) });
      // 万一のときの計算は世帯ごと（別の世帯を開いたら捨てて、万一のときのタブを開いたときに作る。同じ世帯の中ではタブを切り替えても持ち続ける）
      cgEngine.current = null;
      setCgUi({ mode: "assets" });
      // 速さの計測: 帯の案と現状の枠を、開いてから正の計算がそろうまで（5案の比較の目標 3秒）
      const t0 = performance.now();
      const all = requestsFor(o, w, settingsRef.current);
      await dual.current.set(all);
      const canon = dual.current.timings.filter((t) => t.kind === "canonical").at(-1);
      compareTimings.current.push({ ms: performance.now() - t0, hostMs: canon?.hostMs ?? 0, slots: Object.keys(all).length });
      setTick((t) => t + 1);
    },
    [host, requestsFor, history],
  );

  /** 見本・空の世帯を開く（保存しない。保存するときは persistCurrent） */
  const open = useCallback(
    async (id: string, hashLevers?: number[]) => {
      if (host === null) return;
      await autosaver.current?.flush();
      setInputPlanOn(false);
      // 保存した世帯から離れる: 事務所で共有しているときの、自分の開いている印を消す（0023 の7）
      if (storedRef.current !== null) void host.store.leave().catch(() => undefined);
      storedRef.current = null;
      setStoredInfo(null);
      setPresence(null);
      setSampleMode(null);
      autosaver.current?.reset(null);
      let o: Opened | null;
      // 新しい世帯には事務所の既定値を写す（本人・配偶者の介護・前提条件の標準値・不動産の評価の割合。0073）
      if (id === BLANK) o = openedFrom(null, applyOfficeDefaults(withRefreshedEstimates(blankHousehold(thisMonth())), officeSettingsRef.current));
      else {
        const demo = demoHousehold(id);
        if (demo === undefined) return;
        // 表の最後の年は標準（本人・配偶者のうち若い方が100歳になる年）にそろえて開く
        const base = sampleRequest(await host.openHousehold(id));
        const self = roles(base).find((r) => r.key === "self");
        if (self === undefined) return;
        const re = demo.reemployment;
        const wh = fromRequest(base, { memo: demo.memo, ...(re !== undefined ? { postRetirement: { [self.member.id]: { ...re, type: re.type as "contract" } } } : {}) });
        o = openedFrom(demo, wh);
      }
      if (o === null) return;
      reqCache.current.clear();
      rawCache.current.clear();
      // 別の世帯を開いたら、結果の見方はすべて入れるに戻す
      viewRef.current = ALL_ROWS;
      setRowsView(ALL_ROWS);
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
      } else if (o.demo !== null && (o.demo.plans !== undefined || o.demo.snapshots !== undefined)) {
        // 見本に入れておいたプラン（帯に並べる）と控え（前回と比べるの見本）
        const seeded = await seedDemo(o.wh, o.catalog, o.demo, { now: nowIso(), appVersion: APP_VERSION });
        o = { ...o, wh: seeded.wh };
        band = seeded.band.slice(0, MAX_BAND);
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
      await install(o, w, shownKeys, id, false);
    },
    [host, install, initial],
  );

  /**
   * 本体が返した世帯を画面に入れる（開く・分岐を選んだ後）。`stored` を渡したときは、それを保存済みの本文として、
   * 画面の本文（r.body）との違いを自動保存で書く（分岐の「両方を残す」）
   */
  const loadStored = useCallback(
    async (r: StoredOpened, stored?: string) => {
      const st = fromBody(r.body);
      const demo = st.workspace.template !== null ? (demoHousehold(st.workspace.template) ?? null) : null;
      const o = openedFrom(demo, st.wh);
      if (o === null) throw new Error("E_BODY_SHAPE");
      reqCache.current.clear();
      rawCache.current.clear();
      // 別の世帯を開いたら、結果の見方はすべて入れるに戻す
      viewRef.current = ALL_ROWS;
      setRowsView(ALL_ROWS);
      const live = new Set(o.wh.proposals.map((x) => x.id));
      const band = st.workspace.band.filter((x) => live.has(x)).slice(0, MAX_BAND);
      const inBand = (x: string) => x === CURRENT || band.includes(x);
      const w: Work = { band, base: inBand(st.workspace.base) ? st.workspace.base : CURRENT, sel: inBand(st.workspace.selected) ? st.workspace.selected : (band[0] ?? CURRENT), drafts: {} };
      const shownKeys = st.workspace.shownItems.filter((k) => o.catalog.byKey.has(k));
      const sample = r.sample;
      storedRef.current = { id: r.id, customerNo: r.customerNo, readOnly: r.readOnly, carry: st.carry, ...(sample !== undefined ? { sample } : {}) };
      setStoredInfo({ id: r.id, customerNo: r.customerNo, readOnly: r.readOnly, ...(sample !== undefined ? { sample } : {}) });
      setFileEditors(editorsOf(r.body));
      settingsRef.current = st.display.result;
      setSettings(st.display.result);
      bsSettingsRef.current = st.display.balance;
      setBsSettings(st.display.balance);
      const loaded = bodyFor(o, w, shownKeys, st.display.result, st.display.balance, st.carry);
      // この画面で前に開いて保存したときと同じ中身なら、元に戻すの履歴を続きから使う（違えば空から）
      const keep = savedBodies.current.get(r.id) === loaded;
      savedBodies.current.set(r.id, loaded);
      // ほかのメンバーが開いているときは、自動保存を止めた状態で開く（「編集を始める」で始める。0023 の7）
      const others = r.othersOpen.length > 0 && !r.readOnly;
      // 自分で作った見本は、開いても保存しない（動かしても見本は変わらない。「この見本を直す」で保存を始める。0033）
      const viewSample = sample !== undefined;
      setSampleMode(viewSample ? "view" : null);
      setPresence(others && !viewSample ? r.othersOpen : null);
      pausedBody.current = others || viewSample ? (stored ?? loaded) : null;
      autosaver.current?.reset(r.readOnly || others || viewSample ? null : (stored ?? loaded));
      if (r.readOnly) setSaveState({ kind: "error", code: "E_STORE_READ_ONLY" });
      await install(o, w, shownKeys, `stored:${r.id}`, keep);
      if (stored !== undefined && stored !== loaded && !others && !viewSample) autosaver.current?.change(loaded);
    },
    [host, install],
  );

  /** 保存した世帯を開く（本体が復号して本文を返す） */
  const openStored = useCallback(
    async (id: string) => {
      if (host === null) return;
      await autosaver.current?.flush();
      await loadStored(await host.store.open(id));
    },
    [host, loadStored],
  );

  /** 見本を開く（アプリの見本は保存しない世帯として、自分で作った見本は保存しないで開く。動かしても見本は変わらない。0033） */
  const openSample = useCallback(async (item: ShelfItem) => (item.kind === "app" ? open(item.id) : openStored(item.id)), [open, openStored]);

  /** ほかのメンバーが開いている世帯で「編集を始める」（自動保存を始める。分岐になりうることは帯に書いてある） */
  const startEditing = useCallback(() => {
    const o = openedRef.current;
    const sr = storedRef.current;
    const base = pausedBody.current;
    setPresence(null);
    setSampleMode((m) => (m === "view" ? "edit" : m));
    pausedBody.current = null;
    if (o === null || sr === null || base === null) return;
    autosaver.current?.reset(base);
    autosaver.current?.change(bodyFor(o, workRef.current, shownRef.current, settingsRef.current, bsSettingsRef.current, sr.carry));
  }, []);

  /** 分岐を選ぶ画面を開く（保存のときに分岐を見つけた・同期の衝突の写しがある） */
  const openFork = useCallback(
    async (id: string) => {
      if (host === null) return;
      setFork({ id, info: null, busy: false, error: null });
      try {
        const info = await host.store.forkInfo(id);
        setFork({ id, info, busy: false, error: null });
      } catch (e) {
        setFork({ id, info: null, busy: false, error: storeMessage(codeOf(e)) });
      }
    },
    [host],
  );
  const chooseFork = useCallback(
    async (c: ForkChoiceUi) => {
      if (host === null || fork === null) return;
      setFork({ ...fork, busy: true, error: null });
      try {
        const o = openedRef.current;
        const sr = storedRef.current;
        const ours = o !== null && sr !== null ? bodyFor(o, workRef.current, shownRef.current, settingsRef.current, bsSettingsRef.current, sr.carry) : null;
        const r = await host.store.resolveFork(fork.id, c === "ours");
        if (c === "both" && ours !== null) {
          const m = mergeForkBodies(r.body, ours, () => crypto.randomUUID());
          await loadStored({ ...r, body: m.body }, r.body);
          say(m.added > 0 ? `相手の内容に、こちらのプランを${m.added}件足しました` : "こちらにだけあるプランはありませんでした。相手の内容を開きました");
        } else {
          await loadStored(r);
          say(c === "ours" ? "こちらの内容で保存しました（相手の内容はこのPCの中に残しました）" : "相手の内容を開きました（こちらの内容はこのPCの中に残しました）");
        }
        setFork(null);
        setStoredList(await host.store.list());
      } catch (e) {
        setFork({ ...fork, busy: false, error: storeMessage(codeOf(e)) });
      }
    },
    [host, fork, loadStored, say],
  );
  const chooseSyncCopies = useCallback(
    async (adopt: boolean) => {
      if (host === null || fork === null) return;
      setFork({ ...fork, busy: true, error: null });
      try {
        await host.store.resolveSyncCopies(fork.id, adopt);
        if (storedRef.current?.id === fork.id) await loadStored(await host.store.open(fork.id));
        setFork(null);
        setStoredList(await host.store.list());
        say(adopt ? "同期の衝突の写しを今の内容にしました（前の内容はこのPCの中に残しました）" : "同期の衝突の写しを片付けました（このPCの中に残しました）");
      } catch (e) {
        setFork({ ...fork, busy: false, error: storeMessage(codeOf(e)) });
      }
    },
    [host, fork, loadStored, say],
  );
  // 保存のときに分岐を見つけたら、選ぶ画面を出す
  useEffect(() => {
    const sr = storedRef.current;
    if (saveState.kind === "error" && saveState.code === "E_STORE_CONFLICT" && sr !== null && fork === null) void openFork(sr.id);
  }, [saveState, openFork, fork]);

  /**
   * いま開いている世帯（保存していない世帯・見本）を、新しい世帯として保存する。category は区分の記号、sample があれば見本として作る（0033）。
   * 見本から作るときも元の見本は変わらない（今の画面の中身を写した新しい世帯を作る）
   */
  const persistCurrent = useCallback(
    async (category?: string, sample?: SampleRequest) => {
      const o = openedRef.current;
      if (host === null || o === null) return;
      await autosaver.current?.flush();
      const body = bodyFor(o, workRef.current, shownRef.current, settingsRef.current, bsSettingsRef.current, EMPTY_CARRY);
      if (storedRef.current !== null) void host.store.leave().catch(() => undefined);
      const r = await host.store.create(body, summaryOf(o.wh.request), { ...(category !== undefined ? { category } : {}), ...(sample !== undefined ? { sample } : {}) });
      const info = { id: r.id, customerNo: r.customerNo, readOnly: false, ...(r.sample !== undefined ? { sample: r.sample } : {}) };
      storedRef.current = { ...info, carry: EMPTY_CARRY };
      setStoredInfo(info);
      setPresence(null);
      pausedBody.current = null;
      setSampleMode(r.sample !== undefined ? "edit" : null);
      savedBodies.current.set(r.id, body);
      autosaver.current?.reset(body, nowIso());
      setStoredList(await host.store.list());
      void host.store.listSamples().then(setStoredSamples, () => undefined);
      say(r.sample !== undefined ? `見本 ${r.customerNo} を作りました。手直しは自動で保存します` : `世帯 ${r.customerNo} として保存しました。これからは自動で保存します`);
    },
    [host, say],
  );

  // 起動: 前回の世帯を開く（無ければ見本）。画面の確かめ用の # があるときは見本
  const initialOnce = useRef(false);
  useEffect(() => {
    if (host === null || households.length === 0 || !storeChecked || initialOnce.current) return;
    initialOnce.current = true;
    const id = initial.household === "blank" ? BLANK : initial.household !== undefined && households.some((h) => h.id === initial.household) ? initial.household : (households[0] as DemoHousehold).id;
    const dev = initial.household !== undefined || initial.selfcheck || initial.seed === true || initial.add !== undefined;
    const last = !dev && storeStatus?.state === "ready" ? storeStatus.lastOpened : null;
    if (last !== null)
      void openStored(last).catch((e: unknown) => {
        setHhError(storeMessage(codeOf(e)));
        void open(id, initial.levers);
      });
    else void open(id, initial.levers);
  }, [host, households, open, openStored, initial, storeChecked, storeStatus]);

  // 自動保存: 保存した世帯の現状・案・帯の並び・足した項目・表示の設定が変わったら、少し待って保存する
  useEffect(() => {
    const sr = storedRef.current;
    if (opened === null || sr === null || sr.readOnly) return;
    autosaver.current?.change(bodyFor(opened, workRef.current, shown, settings, bsSettings, sr.carry));
  }, [opened, work.band, work.base, work.sel, shown, settings, bsSettings]);

  // ---- 世帯の一覧の操作 ----
  const refreshStore = useCallback(async () => {
    if (host === null) return;
    try {
      void host.office.status().then(setOfficeStatus, () => undefined);
      void host.office.notices().then(setStorageNotices, () => undefined);
      const st = await host.store.status();
      setStoreStatus(st);
      setStoredList(st.state === "ready" ? await host.store.list() : []);
      if (st.state === "ready") {
        void host.office.defaults().then((v) => putOfficeSettings(readOfficeSettings(v)), () => undefined);
        setStoredSamples(await host.store.listSamples());
        applyCategories(await host.store.categories());
      }
      setStoreUnavailable(null);
    } catch (e) {
      setStoreUnavailable(storeMessage(codeOf(e)));
    }
  }, [host]);
  // 復元キー・事務所の共有・保存先の画面を閉じたら、保存先と同期の通知を取り直す（保管した・見た通知を上の帯の通知から消す）
  const panelsOpen = recovery !== null || officeOpen || storageOpen !== null;
  useEffect(() => {
    if (host !== null && !panelsOpen) void host.office.notices().then(setStorageNotices, () => undefined);
  }, [host, panelsOpen]);
  const guard = useCallback(
    async (fn: () => Promise<void>) => {
      setHhError(null);
      try {
        await fn();
        setHhOpen(false);
      } catch (e) {
        setHhError(storeMessage(codeOf(e)));
      }
    },
    [],
  );
  const renameStored = useCallback(
    async (id: string, customerNo: string): Promise<string | null> => {
      if (host === null) return null;
      try {
        const r = await host.store.rename(id, customerNo);
        const sr = storedRef.current;
        if (sr !== null && sr.id === id) {
          sr.customerNo = r.customerNo;
          setStoredInfo({ id, customerNo: r.customerNo, readOnly: sr.readOnly });
        }
        setStoredList(await host.store.list());
        if (r.duplicate) say(`顧客番号を ${r.customerNo} にしました（同じ番号の世帯がほかにもあります）`);
        return null;
      } catch (e) {
        return storeMessage(codeOf(e));
      }
    },
    [host, say],
  );
  /** 区分を変える・通し番号を付ける・見本に登録する（番号が変わったら、開いている世帯の札も直す。0033） */
  const numberOp = useCallback(
    async (id: string, fn: () => Promise<{ customerNo: string; duplicate: boolean }>, done: (no: string) => string): Promise<string | null> => {
      if (host === null) return null;
      try {
        const r = await fn();
        const sr = storedRef.current;
        if (sr !== null && sr.id === id) {
          sr.customerNo = r.customerNo;
          setStoredInfo({ id, customerNo: r.customerNo, readOnly: sr.readOnly });
        }
        await refreshStore();
        say(r.duplicate ? `${done(r.customerNo)}（同じ番号の世帯がほかにもあります）` : done(r.customerNo));
        return null;
      } catch (e) {
        return storeMessage(codeOf(e));
      }
    },
    [host, say, refreshStore],
  );
  const deleteStored = useCallback(
    async (id: string, confirm: string): Promise<string | null> => {
      if (host === null) return null;
      const isOpen = storedRef.current?.id === id;
      try {
        if (isOpen) autosaver.current?.reset(null);
        await host.store.remove(id, confirm);
        savedBodies.current.delete(id);
        history.drop(`stored:${id}`);
        if (isOpen) {
          storedRef.current = null;
          setStoredInfo(null);
          if (households.length > 0) await open((households[0] as DemoHousehold).id);
        }
        await refreshStore();
        say("削除しました。アプリのバックアップからも完全に読めなくなるのは30日後です");
        return null;
      } catch (e) {
        if (isOpen && storedRef.current !== null && opened !== null) autosaver.current?.reset(bodyFor(opened, workRef.current, shownRef.current, settingsRef.current, bsSettingsRef.current, storedRef.current.carry));
        return storeMessage(codeOf(e));
      }
    },
    [host, households, open, refreshStore, say, opened, history],
  );

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
    (next: WorkingHousehold, nextWork?: Work) =>
      history.track(() => {
        const o = openedRef.current;
        if (o === null || dual.current === null) return;
        const n = openedFrom(o.demo, withRefreshedEstimates(keepStatements(keepSnapshots(next, o.wh), o.wh)));
        if (n === null) return;
        reqCache.current.clear();
        rawCache.current.clear();
        const w = fitWork(n, nextWork ?? workRef.current);
        openedRef.current = n;
        workRef.current = w;
        setOpened(n);
        setWork(w);
        const all = requestsFor(n, w, settingsRef.current);
        dual.current.retain(Object.keys(all));
        dual.current.slide(w.sel, all);
      }),
    [requestsFor, history],
  );
  /** 元に戻す・やり直す: 履歴の状態をそのまま入れる（推定は入れ直し済みの世帯なので、そのまま使う） */
  const restore = (s: AppSnap<Work>) => {
    const o = openedRef.current;
    if (o === null) return;
    // 控えは元に戻す・やり直すの対象にしない（作った後は変えない）。今の控えを持ち越す
    const sw = keepStatements(keepSnapshots(s.wh, o.wh), o.wh);
    const n = sw === o.wh ? o : sw.request === o.wh.request ? { ...o, wh: sw } : openedFrom(o.demo, sw);
    if (n === null) return;
    reqCache.current.clear();
    rawCache.current.clear();
    openedRef.current = n;
    settingsRef.current = s.settings;
    bsSettingsRef.current = s.bs;
    setOpened(n);
    setSettings(s.settings);
    setBsSettings(s.bs);
    putWorkRaw(fitWork(n, s.work), n, "set");
  };
  /** 入力の画面で世帯（現状）を変えた */
  const edit = useCallback((next: WorkingHousehold) => replaceCurrent(next), [replaceCurrent]);

  /** 控えを足す・外す（元に戻す・やり直すの履歴には積まない。作った後は変えない。保存した世帯なら自動保存で世帯ファイルに書く） */
  const putSnapshots = useCallback((f: (list: Snapshot[]) => Snapshot[]) => {
    const o = openedRef.current;
    if (o === null) return;
    const list = f(o.wh.snapshots ?? []);
    const { snapshots: _old, ...rest } = o.wh;
    void _old;
    const n: Opened = { ...o, wh: list.length > 0 ? { ...rest, snapshots: list } : rest };
    openedRef.current = n;
    setOpened(n);
  }, []);
  /** 明細の取り込みの記録を変える（元に戻す・やり直すの対象にしない。控えと同じ。0034） */
  const putStatements = useCallback((log: StatementLog | undefined) => {
    const o = openedRef.current;
    if (o === null) return;
    const { statements: _old, ...rest } = o.wh;
    void _old;
    const n: Opened = { ...o, wh: log !== undefined ? { ...rest, statements: log } : rest };
    openedRef.current = n;
    setOpened(n);
  }, []);
  /** 控えを作る（その時点の現状・プラン・保存していないプランの変更の写し。0009 の2） */
  const takeSnapshot = useCallback(
    async (draft: SnapshotDraft) => {
      const o = openedRef.current;
      if (o === null) return;
      const s = await makeSnapshot({ wh: o.wh, drafts: workRef.current.drafts, draft, appVersion: APP_VERSION });
      // 指紋を作っている間に別の世帯を開いたときは、残さない
      if (openedRef.current?.selfId !== o.selfId) return;
      putSnapshots((l) => [...l, s]);
    },
    [putSnapshots],
  );

  /** 案の一覧だけを変えた（名前・印・保存・外す）。現状は同じ */
  const setPlans = useCallback(
    (next: WorkingHousehold, nextWork?: Work) =>
      history.track(() => {
        const o = openedRef.current;
        if (o === null) return;
        const n = { ...o, wh: keepStatements(keepSnapshots(next, o.wh), o.wh) };
        reqCache.current.clear();
        rawCache.current.clear();
        openedRef.current = n;
        setOpened(n);
        putWork(fitWork(n, nextWork ?? workRef.current), n, "set");
      }),
    [putWork, history],
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
      if (it === undefined || (it.control.kind !== "age" && it.control.kind !== "range")) return;
      setValue(it.key, v);
    },
    [setValue],
  );
  const release = useCallback(() => void dual.current?.release(), []);
  /** 運用の期間の帯の切れ目を動かした: 選んだプランの「積立をやめる年齢」「取り崩しを始める年齢」を動かす（対策に出す。0026） */
  const onBand = useCallback(
    (which: "stop" | "wd", age: number, phase: "slide" | "release") => {
      const key = which === "stop" ? "inv:stop" : "inv:wStart";
      setShown((s) => (s.includes(key) ? s : [...s, key]));
      setValue(key, age, phase);
      if (phase === "release") void dual.current?.release();
    },
    [setValue],
  );
  /** 結果の見方を変える（全部の枠の要求を入れ替えて計算し直す。保存しない） */
  const putRowsView = useCallback(
    (v: RowsView) => {
      viewRef.current = v;
      setRowsView(v);
      putWorkRaw(workRef.current, openedRef.current, "set");
    },
    [putWorkRaw],
  );
  /** 相場が下がった場合を重ねる・やめる（枠を足す・外す） */
  const toggleStress = useCallback(
    (on: boolean) => {
      stressRef.current = on;
      setStressOn(on);
      if (!on) setStressHidden([]);
      putWorkRaw(workRef.current, openedRef.current, "set");
    },
    [putWorkRaw],
  );
  /** 取り崩しの計算・前回の控えの1回（本体の正の計算。同時に頼まれても1つずつ・同じ要求は1回） */
  const computeOne = useMemo(() => (host === null ? async (): Promise<PreviewResult | null> => null : singleCompute(host)), [host]);
  const putSettings = useCallback(
    (patch: Partial<DisplaySettings>) =>
      history.track(() => {
        const s = { ...settingsRef.current, ...patch };
        settingsRef.current = s;
        setSettings(s);
      }),
    [history],
  );
  /** 資産と負債のタブの表示の設定を変える（元に戻すの履歴に入る） */
  const putBsSettings = useCallback(
    (patch: Partial<BalanceSettings>) =>
      history.track(() => {
        const s = { ...bsSettingsRef.current, ...patch };
        bsSettingsRef.current = s;
        setBsSettings(s);
      }),
    [history],
  );
  const toggleFee = useCallback(() => {
    const o = openedRef.current;
    if (o === null) return;
    setValue("lever:fee", !feeOf(o, valuesOf(o.wh, workRef.current, workRef.current.sel)), "release");
  }, [setValue]);

  // ---- 案の操作 ----
  const letters = useMemo(() => (opened === null ? new Map<string, { letter: string; name: string }>() : planLetters(opened.wh.proposals)), [opened]);
  const letterOf = (id: string) => letters.get(id)?.letter ?? "?";
  /** 万一のときの画面で見るプランの選択肢（現状と帯のプラン）と、その計算の要求（保存していない変更を含む今の中身） */
  const cgPlans = useMemo(
    () => [CURRENT, ...work.band].map((id) => ({ id, letter: letters.get(id)?.letter ?? (id === CURRENT ? "A" : "?"), name: id === CURRENT ? "現状" : (letters.get(id)?.name ?? "") })),
    [work.band.join(","), letters],
  );
  const cgRequestOf = useCallback(
    (id: string): EngineRequest => {
      if (opened === null) throw new Error("E_NOT_OPEN");
      return id === CURRENT ? opened.wh.request : reqOf(opened, valuesOf(opened.wh, work, id));
    },
    [opened, work, reqOf],
  );

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
      say(r.dropped !== null ? `${msg}（帯は${MAX_BAND}つまでのため、${planLabel(ls.get(r.dropped)?.letter ?? "")}を帯から外しました。一覧に残っています）` : msg);
    },
    [setPlans, say],
  );
  // ---- AI接続口（0014・0015）: 状態と世帯の記録は本体から読む。AIからの候補は FP が承認したときだけプランになる ----
  const ai = useAi(host?.ai ?? null, storeStatus?.state === "ready", storedInfo?.id ?? null);
  const acceptCandidate = useCallback(
    async (c: AiCandidate, name: string) => {
      const o = openedRef.current;
      const w = workRef.current;
      const sr = storedRef.current;
      if (host === null || o === null || sr === null || sr.readOnly) return;
      const values = candidateValues(candidateRows(c, o.wh, o.catalog));
      if (Object.keys(values).length === 0) return;
      const r = acceptAiCandidate(o.wh, o.catalog, c, values, name.trim() || candidatePlanName(o.wh, o.catalog, values), nowIso());
      try {
        // 先に本体へ判断を記録する（承認待ちの候補だけ・1回だけ）。記録できたときだけプランを入れる
        ai.setView(await host.ai.decide(sr.id, c.id, true, r.id));
      } catch (e) {
        say(aiMessage(codeOf(e)));
        return;
      }
      const l = planLetters(r.wh.proposals).get(r.id);
      placeNew(w, r.wh, r.id, w.drafts, `AIからの候補を ${planLabel(l?.letter ?? "")}「${l?.name ?? name}」として保存しました`);
    },
    [host, ai, placeNew, say],
  );
  const rejectCandidate = useCallback(
    async (c: AiCandidate) => {
      const sr = storedRef.current;
      if (host === null || sr === null) return;
      try {
        ai.setView(await host.ai.decide(sr.id, c.id, false, null));
        say("AIからの候補を捨てました（記録に残ります）");
      } catch (e) {
        say(aiMessage(codeOf(e)));
      }
    },
    [host, ai, say],
  );
  const stopShare = useCallback(
    async (householdId: string) => {
      if (host === null) return;
      try {
        await host.ai.stopShare(householdId);
        say("AIへの共有を取り消しました");
      } catch (e) {
        say(aiMessage(codeOf(e)));
      }
      await ai.refresh();
    },
    [host, ai, say],
  );
  const aiShare = shareState(ai.status, storedInfo !== null ? ai.view : null);

  /** ＋ この案を元に作る: 選んでいる案（保存していない変更を含む）を写して新しい案を作り、そのまま選ぶ */
  const duplicate = useCallback(() => {
    const o = openedRef.current;
    const w = workRef.current;
    if (o === null) return;
    const src = w.sel;
    const srcLetter = planLetters(o.wh.proposals).get(src)?.letter ?? "A";
    const head = planLabel(headLetter(suggestName(o.wh.proposals, savedValues(o.wh, src), o.wh, o.catalog, src === CURRENT ? null : src)) ?? "");
    const r = savePlan(o.wh, o.catalog, { name: `${head} ${planLabel(srcLetter)}を元に`, base: src === CURRENT ? null : src, values: valuesOf(o.wh, w, src), now: nowIso() });
    const newLetter = planLetters(r.wh.proposals).get(r.id)?.letter ?? "";
    placeNew(w, r.wh, r.id, w.drafts, `${planLabel(srcLetter)}を写して ${planLabel(newLetter)} を作りました。下の対策で動かしてください`);
  }, [placeNew]);
  /** 入力の画面の編集の対象を選ぶ（0036 の8）: プランを選ぶと、結果のタブでもそのプランを選ぶ（帯に無ければ足す）。現状を選ぶと現状 */
  const selectInputPlan = useCallback(
    (id: string | null) => {
      const o = openedRef.current;
      const w = workRef.current;
      if (o === null) return;
      if (id === null) {
        setInputPlanOn(false);
        if (w.sel !== CURRENT) putWork({ ...w, sel: CURRENT }, o, "set");
        return;
      }
      const r = addToBand(w.band, id, [w.sel, w.base]);
      setInputPlanOn(true);
      putWork({ ...w, band: r.band, sel: id }, o, "set");
      if (r.dropped !== null) say(`帯は${MAX_BAND}つまでのため、${planLabel(planLetters(o.wh.proposals).get(r.dropped)?.letter ?? "")}を帯から外しました（一覧に残っています）`);
    },
    [putWork, say],
  );
  /** 入力の画面の「＋ 現状から新しいプラン」「このプランを土台に」「このプランを複製」: 作って、そのまま入力で直す */
  const newInputPlan = useCallback(
    (base: string | null, copyOf?: string) => {
      const o = openedRef.current;
      const w = workRef.current;
      if (o === null) return;
      const ls = planLetters(o.wh.proposals);
      const head = suggestName(o.wh.proposals, {}, o.wh, o.catalog);
      const src = copyOf !== undefined ? findPlan(o.wh.proposals, copyOf) : undefined;
      const name = src !== undefined ? `${head} ${planLabel(ls.get(src.id)?.letter ?? "")}の複製` : base !== null ? `${head} ${planLabel(ls.get(base)?.letter ?? "")}を土台に` : head;
      const r = savePlan(o.wh, o.catalog, { name, base: src !== undefined ? src.base : base, values: src !== undefined ? savedValues(o.wh, src.id) : {}, now: nowIso() });
      setInputPlanOn(true);
      const letter = planLetters(r.wh.proposals).get(r.id)?.letter ?? "";
      placeNew(w, r.wh, r.id, w.drafts, `${planLabel(letter)}を作りました。入力項目を開いて直すと、${planLabel(letter)}の差分になります`);
    },
    [placeNew],
  );
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
      placeNew(w, r.wh, r.id, drafts, `${planLabel(l?.letter ?? "")}「${l?.name ?? name}」として保存しました`);
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
    say(`${planLabel(planLetters(o.wh.proposals).get(w.sel)?.letter ?? "")}を上書きしました`);
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
  /** 帯のカードの × でプランを外す（確認の窓は出さず、知らせの「元に戻す」か ⌘Z で戻す。表示していたら基準のプランに戻す） */
  const removePlan = useCallback(
    (letter: string) => {
      const o = openedRef.current;
      const w = workRef.current;
      if (o === null) return;
      const id = slotOfLetter(planLetters(o.wh.proposals), [CURRENT, ...w.band], letter);
      const r = id === undefined ? null : removeFromBand(o.wh, w, id);
      if (r === null) return;
      if (r.sel !== w.sel) {
        const v = valuesOf(o.wh, w, r.sel);
        setShown((s) => [...new Set([...s, ...Object.keys(v).filter((k) => o.catalog.byKey.get(k)?.builtin === false)])]);
        setTableKey(null);
      }
      setPlans(r.wh, { ...w, band: r.band, sel: r.sel });
      say(r.message, true);
    },
    [setPlans, say],
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
  const resultOf = (id: string): PreviewResult | null => (views.get(id) ?? dual.current?.view(id) ?? null)?.result ?? null;
  const selRes = resultOf(work.sel);
  const baseRes = resultOf(work.base);
  const selView = views.get(work.sel) ?? null;
  const altRes = dual.current?.view("alt").result ?? null;
  const selValues = opened === null ? {} : valuesOf(opened.wh, work, work.sel);
  /** 結果の見方の一覧（選んでいるプランと現状の世帯から） */
  const viewList = useMemo(
    () => (opened === null ? [] : viewRows([rawReqOf(opened, valuesOf(opened.wh, work, work.sel)).input.household, opened.wh.request.input.household], rowsView)),
    [opened, work, rawReqOf, rowsView],
  );
  const selReq = useMemo(() => (opened === null ? null : reqOf(opened, valuesOf(opened.wh, work, work.sel))), [opened, work, reqOf, rowsView]);
  const baseReq = useMemo(() => (opened === null ? null : reqOf(opened, valuesOf(opened.wh, work, work.base))), [opened, work, reqOf, rowsView]);
  const feeOn = opened !== null && hasAdvisoryFee(opened.wh.request) ? feeOf(opened, selValues) : false;
  const names = { selected: planLabel(letterOf(work.sel)), base: planLabel(letterOf(work.base)), same: work.sel === work.base };
  const feeShown = opened !== null && shows(settings, "feeLine") && hasAdvisoryFee(opened.wh.request) && work.sel !== CURRENT;
  const provisional = selView?.source !== "canonical" || selView.stale;
  const model = useMemo(() => {
    if (opened === null || selReq === null || selRes === null || baseRes === null) return null;
    const fee = feeShown ? { on: feeOn, alt: altRes } : undefined;
    const m = toPresentation({ base: opened.wh.request, proposal: selReq, current: baseRes, proposed: selRes, targetAge: settings.atAge, selectedYear, provisional, names, ...(baseReq !== null ? { baseProposal: baseReq } : {}), ...(fee !== undefined ? { fee } : {}) });
    const extra = verdictMetrics(settings, { name: names.selected, m: metricsOf(opened.wh.request, selRes.table, settings.atAge) }, names.same ? null : { name: names.base, m: metricsOf(opened.wh.request, baseRes.table, settings.atAge) });
    return extra.length > 0 ? { ...m, result: { ...m.result, sub: [...m.result.sub, ...extra] } } : m;
  }, [opened, selReq, baseReq, selRes, baseRes, altRes, feeOn, feeShown, selectedYear, provisional, settings, names.selected, names.base, names.same]);
  const explain = useMemo(
    () => (explainStep === null || opened === null || selReq === null || selRes === null ? null : explainModel(selReq, selRes, settings.atAge)),
    [explainStep !== null, opened, selReq, selRes, settings.atAge],
  );
  const modified = useMemo(() => (opened === null ? new Set<string>() : modifiedSet(opened.wh, opened.catalog, work)), [opened, work]);
  // 全部のプランを色分けで重ねる表示の色の番号: プランの内部 ID ごとに決めて持ち続ける（基準・帯の並びを変えても同じ色。band.ts の assignColors）
  const colors = useMemo(() => {
    const m = assignColors(colorMap.current, work.band, (id) => letters.get(id)?.letter, PLAN_COLORS);
    colorMap.current = m;
    return m;
  }, [work.band, letters]);
  const band = opened === null ? null : bandModel({ req: opened.wh.request, slots, letters, results: new Map(slots.map((id) => [id, resultOf(id)])), modified, base: work.base, selected: work.sel, settings, colors });
  // 全部のプランを色分けで重ねる表示: 帯の全部のプランの線（プランの名前と色の番号と数字だけ）をグラフの値に足す
  const slotResults = slots.map((id) => resultOf(id));
  // 計算の知らせ（0064）: 帯の全部のプランの結果の知らせを、FP 向けの行にまとめる（結果のタブ）。現状の分は確かめの一覧にも出す
  const calcNotices = useMemo(
    () => (opened === null ? [] : noticeRows(opened.wh, slots.map((id, i) => ({ label: planLabel(letterOf(id)), result: slotResults[i] ?? null, ...(id === work.sel && selReq !== null ? { request: selReq } : {}) })))),
    [opened, selReq, work.sel, ...slots, ...slotResults],
  );
  // 気づき（0074）の相続税の目安: 結果のタブを見ている間だけ、選んでいるプランの要求で計算する
  const insightInheritance = useInheritanceFor(selReq, tab === "main", computeOne);
  const currentNotices = useMemo(() => (opened === null ? [] : noticeRows(opened.wh, [{ label: planLabel(letterOf(CURRENT)), result: resultOf(CURRENT) }])), [opened, resultOf(CURRENT)]);
  const openCard = (card: string) => {
    setTab("input");
    setCardOpen((c) => ({ id: card, n: (c?.n ?? 0) + 1 }));
  };
  // 資産と負債のタブ（家計のバランスシート。0027）: 帯の全部のプランの、今の年から表の最後の年までのバランスシート
  const bsPlans = useMemo(() => {
    if (tab !== "balance" || opened === null) return null;
    const out: BsPlanModel[] = [];
    slots.forEach((id, i) => {
      const r = slotResults[i];
      if (r == null) return;
      const req = id === work.sel ? selReq : id === work.base ? baseReq : reqOf(opened, valuesOf(opened.wh, work, id));
      if (req === null) return;
      const letter = letters.get(id)?.letter ?? "?";
      out.push(bsPlan({ key: letter, letter, name: planLabel(letter), title: id === CURRENT ? "現状" : (letters.get(id)?.name ?? ""), base: id === work.base, req, table: r.table }));
    });
    return out;
  }, [tab, opened, slots, work, letters, selReq, baseReq, reqOf, ...slotResults]);
  // 前回と比べる: 控え（新しい順）。選んだ控えだけを、控えの現状の入力で計算する（結果は控えを選び直すまで持つ）
  const bsSnaps = useMemo(() => [...(opened?.wh.snapshots ?? [])].sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0)), [opened?.wh.snapshots]);
  const bsPrevChoices = bsSnaps.map((x, i) => ({ key: `p${i + 1}`, label: `${snapshotDateText(x.createdAt).replace(/ .*$/, "")}の控え（${TRIGGER_TEXT[x.trigger]}）` }));
  const [bsPrevRun, setBsPrevRun] = useState<{ key: string; id: string; result: PreviewResult | null | "loading" } | null>(null);
  const onBsPrev = useCallback(
    (key: string) => {
      const s = bsSnaps[Number(key.slice(1)) - 1];
      if (s === undefined) return;
      setBsPrevRun({ key, id: s.id, result: "loading" });
      void computeOne(withoutRemovedAssumptions(s.inputs.request)).then(
        (r) => setBsPrevRun((cur) => (cur !== null && cur.key === key && cur.id === s.id ? { ...cur, result: r } : cur)),
        () => setBsPrevRun((cur) => (cur !== null && cur.key === key && cur.id === s.id ? { ...cur, result: null } : cur)),
      );
    },
    [bsSnaps, computeOne],
  );
  const bsPrevModel = useMemo((): { status: "idle" | "loading" | "ready"; model: BsPrevModel | null } => {
    if (bsPrevRun === null || opened === null || bsPlans === null) return { status: "idle", model: null };
    const i = Number(bsPrevRun.key.slice(1)) - 1;
    const s = bsSnaps[i];
    const actual = bsPlans.find((p) => p.key === (letters.get(CURRENT)?.letter ?? "A"))?.years[0];
    if (s === undefined || s.id !== bsPrevRun.id || actual === undefined) return { status: "idle", model: null };
    if (bsPrevRun.result === "loading") return { status: "loading", model: null };
    const r = bsPrevRun.result;
    const snapshot = r === null ? { error: "この控えの内容は、今の計算エンジン・制度データでは計算できませんでした（控えの時点が古いなど）。" } : { req: withoutRemovedAssumptions(s.inputs.request), table: r.table };
    return { status: "ready", model: bsPrev({ key: bsPrevRun.key, label: bsPrevChoices[i]?.label ?? "控え", createdAt: s.createdAt, baseMonth: opened.wh.request.input.baseMonth, actual, snapshot }) };
  }, [bsPrevRun, opened, bsPlans, bsSnaps, letters]);
  // 資産運用（資産の推移のとき。0026）: 口座の内訳・運用の期間の帯・相場が下がった場合の線
  const stressRes = STRESS_KEYS.map((k) => (stressOn ? resultOf(`stress:${k}`) : null));
  const investModel = useMemo(() => {
    if (model === null || selReq === null || selRes === null || chartMode !== "assets") return null;
    const stress = stressOn ? (Object.fromEntries(STRESS_KEYS.map((k, i) => [k, stressRes[i] ?? null])) as Record<StressKey, PreviewResult | null>) : null;
    return investChart({ sel: { req: selReq, res: selRes }, years: model.chart.years, ages: model.chart.ages, stress, view: { breakdown: settings.invBreakdown, band: bandShown(settings.invPeriods, selReq), stressHidden } });
  }, [model, selReq, selRes, chartMode, stressOn, settings.invBreakdown, settings.invPeriods, stressHidden, ...stressRes]);
  const chartModel = useMemo(() => {
    if (model === null || opened === null) return model;
    const m = investModel === null ? model : { ...model, invest: investModel };
    if (settings.layout !== "all") return m;
    return { ...m, plans: planLinesModel({ req: opened.wh.request, slots, letters, results: new Map(slots.map((id, i) => [id, slotResults[i] ?? null])), base: work.base, selected: work.sel, colors }) };
  }, [model, investModel, opened, settings.layout, slots, letters, work.base, work.sel, colors, ...slotResults]);
  // 全部のプランを色分けで重ねる表示か（グラフと同じ決まり）。この表示では、グラフの上の資産運用の切り替え（口座の内訳・運用の期間・相場が下がった場合）と
  // 資産の内訳（ドーナツ）を出さない。グラフもこの表示では口座の内訳・運用の期間の帯・相場が下がった場合の線を描かない（表示の設定の値はそのまま覚えておく）
  const multiView = chartModel !== null && multiOn(settings.layout, explain, chartModel);
  /** 結論の1文: 資産の推移のときは「金融資産は○歳まで持ちます」（0026） */
  const verdictView = useMemo(() => {
    if (model === null) return null;
    if (chartMode !== "assets" || opened === null || selReq === null || selRes === null || baseRes === null || baseReq === null) return model.result;
    const v = investVerdict(names, { req: selReq, table: selRes.table }, names.same ? null : { req: baseReq, table: baseRes.table }, model.chart.years);
    const extra = verdictMetrics(settings, { name: names.selected, m: metricsOf(opened.wh.request, selRes.table, settings.atAge) }, names.same ? null : { name: names.base, m: metricsOf(opened.wh.request, baseRes.table, settings.atAge) });
    return { ...v, sub: [...v.sub, ...extra] };
  }, [model, chartMode, opened, selReq, selRes, baseReq, baseRes, settings, names.selected, names.base, names.same]);
  // 資産の内訳（ドーナツ）: 基準のプランと選んだプランを同じ年で（グラフで固定した年。固定していなければ取り崩しを始める年）。
  // グラフの上の「口座の内訳を表示」にチェックが入っているときだけ出す（既定は出さない）
  const donutOn = donutShown(settings.invBreakdown, investModel !== null && investModel.breakdown !== null, multiView);
  // お金の3つの分け方（説明用。0032）: 選んでいるプランの、今の時点。資産と負債のタブの区画で使う
  const m3Model = useMemo(() => {
    if (tab !== "balance" || selReq === null || selRes === null) return null;
    try {
      return moneyThreeModel({ req: selReq, table: selRes.table, settings: bsSettings.moneyThree });
    } catch {
      return null;
    }
  }, [tab, selReq, selRes, bsSettings.moneyThree]);
  const [m3Flash, setM3Flash] = useState(initial.bsM3 === true ? 1 : 0);
  useEffect(() => {
    if (tab !== "balance" && m3Flash !== 0) setM3Flash(0);
  }, [tab]);
  const donut = useMemo(() => {
    if (!donutOn || model === null || selReq === null || selRes === null || baseReq === null || baseRes === null || chartMode !== "assets") return null;
    const fixed = selectedYear !== null && model.chart.years.includes(selectedYear) && model.selectedYear === selectedYear ? selectedYear : null;
    const year = fixed ?? donutYear(selReq, model.chart.years);
    const age = model.chart.ages[model.chart.years.indexOf(year)] ?? null;
    const panes = donutPanes({ base: { name: names.base, req: baseReq, table: baseRes.table }, sel: { name: names.selected, req: selReq, table: selRes.table }, same: names.same, year, age, who: model.who, by: donutBy });
    return <DonutCard panes={panes} by={donutBy} onBy={setDonutBy} note={fixed !== null ? "グラフで固定した年の内訳です（もう一度押すと外れます）" : "グラフで年を押して固定すると、その年の内訳になります（いまは取り崩しを始める年）"} />;
  }, [donutOn, model, selReq, selRes, baseReq, baseRes, chartMode, selectedYear, names.base, names.selected, names.same, donutBy]);
  const multiHidden = { hidden: hiddenLines, onToggle: (k: string) => setHiddenLines((h) => (h.includes(k) ? h.filter((x) => x !== k) : [...h, k])) };

  // 表: 見る案（既定は選んだ案）と、基準との差
  const tKey = tableKey !== null && slots.includes(tableKey) ? tableKey : work.sel;
  const tRes = resultOf(tKey);
  const tReq = opened === null ? null : tKey === work.sel ? selReq : reqOf(opened, valuesOf(opened.wh, work, tKey));
  // 扶養の境目の参考の行（扶養していると入れた世帯の外の親・祖父母がいるときだけ、その人の年金を写しの要求で求める。0075）
  const depReq = useMemo(() => (tab === "main" && tReq !== null ? dependentRefRequest(tReq) : null), [tab, tReq]);
  const depRes = useRefResult(depReq, computeOne);
  const table = useMemo(() => {
    if (opened === null || model === null || tRes === null || tReq === null) return null;
    const years = displayYears(opened.wh.request);
    let t = tKey === work.sel ? model.table : cashflowTable(tReq, tRes.table, years, "生涯キャッシュフロー表", eventsOf(tReq, tRes.table, years, tRes.summary));
    if (showDiff && tKey !== work.base && baseRes !== null) t = withDiff(tReq, t, tRes.table, baseRes.table, `差（${letterOf(tKey)}−${letterOf(work.base)}）`);
    if (depReq !== null && depRes !== null) t = { ...t, rows: [...t.rows, ...dependentRefRows(tReq, depRes.table, t.years)] };
    return t;
  }, [opened, model, tRes, tReq, tKey, work.sel, work.base, showDiff, baseRes, letters, depReq, depRes]);

  const showEvidence = useCallback(
    async (rowKey: string, year: number) => {
      if (host === null || tReq === null) return;
      const req = { ...tReq, trace: "full" as const };
      setMemoOpen(false);
      setEvidence({ status: "loading", title: `${year}年` });
      try {
        const full = await host.evidence(JSON.stringify(forEngine(req)));
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
          if (c.kind !== "age" && c.kind !== "range") return [];
          const v = valueOf(it, selValues, opened.wh);
          const b = valueOf(it, baseValues, opened.wh);
          const vn = typeof v === "number" ? v : undefined;
          const bn = typeof b === "number" ? b : undefined;
          const common = { key: it.key.slice(6) as LeverKey, label: it.label, valueText: it.text(v), baseText: it.text(b), note: it.note?.(v) ?? null };
          if (c.kind === "age") {
            // 年齢: 1歳ずつ。今の値・基準の値が範囲の外なら範囲を広げる（入力で直接入れたとき）
            const min = Math.min(c.min, vn ?? c.min, bn ?? c.min);
            const max = Math.max(c.max, vn ?? c.max, bn ?? c.max);
            return [{ ...common, slider: { kind: "age", min, max, value: vn ?? min, base: bn ?? min, ticks: c.ticks, stepText: c.tick } }];
          }
          // 金額: 1万円の刻み。今の値・基準の値が範囲の外なら範囲を広げる（数値の欄で直接入れたとき）
          const r = amountRange(c.min, c.max, vn, bn);
          return [{ ...common, slider: { kind: "amount", min: r.min, max: r.max, step: c.step, value: vn ?? r.min, base: bn ?? r.min, per: c.per ?? "", tick: c.tick } }];
        });
  const feeToggle: FeeToggle | null =
    opened !== null && hasAdvisoryFee(opened.wh.request) ? { on: feeOn, inBase: feeOf(opened, baseValues), note: feeSummary(opened.wh.request), onToggle: toggleFee } : null;

  const last = dual.current?.timings.filter((t) => t.kind === "preview").at(-1);
  const lastCanon = dual.current?.timings.filter((t) => t.kind === "canonical").at(-1);
  const errView = selView?.error != null ? selView : (views.get(work.base) ?? null);
  const error = errView?.error != null ? engineErrorText(errView.error, errView.errorIds, opened?.wh.request.input.baseMonth ?? null) : null;

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

  // 比較の表（現状と帯の案。基準の案との差）と、プランごとの年金の見込み（比較の表を開いている間だけ求める。0075）
  const compareResults = slots.map((id) => resultOf(id));
  const compareReqs = useMemo(() => (panel === "compare" && opened !== null ? slots.map((id) => cgRequestOf(id)) : null), [panel, opened, slots, cgRequestOf]);
  const planPensions = usePlanPensions(compareReqs, computeOne);
  const compareModel = useMemo(() => {
    if (panel !== "compare" || opened === null || compareResults.some((r) => r === null)) return null;
    return compareTable(
      opened.wh.request,
      slots.map((id, i) => ({ name: `${planLabel(letterOf(id))} ${letters.get(id)?.name ?? ""}`, table: (compareResults[i] as PreviewResult).table })),
      settings.atAge,
      Math.max(0, slots.indexOf(work.base)),
      planPensions,
    );
  }, [panel, opened, slots, work.base, settings.atAge, letters, planPensions, ...compareResults]);

  // 小窓はタブごと: 別のタブに移ったら閉じる（各タブのグラフの見出しから出し直す。位置と大きさは覚えている）
  const pipFirst = useRef(initial.pip === true);
  useEffect(() => {
    if (pipFirst.current) {
      pipFirst.current = false;
      openPip();
    } else closePip();
  }, [tab]);

  // 見本の棚（アプリの見本と自分で作った見本）と、いま開いている見本（0033）
  const shelf = useMemo(() => shelfItems(households, storedSamples), [households, storedSamples]);
  const currentSample = storedInfo?.sample !== undefined ? storedInfo.id : storedInfo === null && opened?.demo != null ? opened.demo.id : null;
  const sampleItem: ShelfItem | null = currentSample === null ? null : (shelf.find((i) => i.id === currentSample) ?? null);
  /** 保存している（見本を保存しないで開いているときは、保存していない扱い） */
  const savingStored = storedInfo !== null && sampleMode !== "view";
  const drawer = memoOpen || evidence !== null;
  const ageMark = opened === null ? null : ageMarkOf(settings, opened.wh.request);
  // 上の帯の札と通知（ふだんは出さない。header/status.ts）
  const barIn: BarInputs = {
    opened: opened !== null,
    stored: savingStored,
    save: saveState,
    paused: presence !== null,
    aiSharing: aiShare === "sharing",
    storage: storageNotices,
    showing: { recovery: recovery !== null, office: officeOpen, storage: storageOpen !== null },
    presence: presence !== null ? presenceText(presence) : null,
    message: storeMessage,
    household: opened?.wh.notices ?? [],
  };
  /** 開いたときの知らせを押した: その知らせを世帯から消し（1回だけ見せる。0035 の8）、扱う画面を開く */
  const openHouseholdNotice = (id: string, target: NoticeTarget) => {
    const o = openedRef.current;
    if (o !== null && o.wh.notices !== undefined) {
      const rest = o.wh.notices.filter((n) => `household:${n.id}` !== id);
      const { notices: _old, ...wh } = o.wh;
      void _old;
      setPlans(rest.length > 0 ? { ...wh, notices: rest } : wh);
    }
    if (target === "family") {
      setTab("input");
      setCardOpen((c) => ({ id: "family", n: (c?.n ?? 0) + 1 }));
    } else if (target === "plans") {
      setTab("main");
      setPanel("list");
    } else noticeActions[target]();
  };
  const toggleHousehold = () => {
    setHhError(null);
    // 自分で作った見本を開いているときは、見本の一覧から見せる（アプリの見本は起動したときにも開くので、顧客の一覧から）
    if (!hhOpen) setHhTab(storedInfo?.sample !== undefined ? "samples" : "customers");
    if (!hhOpen) void refreshStore();
    setHhOpen(!hhOpen);
  };
  const closeHousehold = () => setHhOpen(false);
  /** 世帯の選択のメニューを開いて、保存の状態の詳しい文を見せる */
  const showHousehold = () => {
    if (!hhOpen) toggleHousehold();
    window.scrollTo({ top: 0 });
  };
  const toPresence = () => document.querySelector("[data-presence-band]")?.scrollIntoView({ block: "center" });
  const openAiShare = () => {
    void ai.refresh();
    setAiPanel(storedInfo !== null ? "share" : "connector");
  };
  const openOffice = () => {
    void host?.office.status().then(setOfficeStatus, () => undefined);
    setOfficeOpen(true);
  };
  const alertActions: Record<AlertKind, () => void> = { saveError: showHousehold, readOnly: showHousehold, paused: toPresence, aiSharing: openAiShare };
  const openStorage = () => {
    void host?.office.status().then(setOfficeStatus, () => undefined);
    setStorageOpen("default");
  };
  const noticeActions: Record<NoticeTarget, () => void> = { recovery: () => setRecovery("manage"), restore: () => setRecovery("restore"), storage: openStorage, office: openOffice, households: showHousehold, presence: toPresence, family: () => setTab("input"), plans: () => setTab("main") };
  /** 入力で直しているプラン（取り込みは現状に入るので、このときは取り込みの中身に「現状に切り替える」を出す） */
  const inputPlanSel = opened !== null && inputPlanOn && work.sel !== CURRENT && opened.wh.proposals.some((p) => p.id === work.sel) ? work.sel : null;
  // FP のメニューで押した物: 入力のホームの中身は、入力のタブに切り替えてホームの上部に開く（パネルの入力は閉じる）。事務所の設定・AI は中央のパネル
  const pickFpMenu = (a: FpMenuAction) => {
    const home: Partial<Record<FpMenuAction, FpOpen>> = { snapTake: "snapTake", snapList: "snapList", contents: "contents", year: "year", review: "review", hearing: "imports" };
    if (a === "ai" && inputPlanSel === null) return openAiShare();
    if (a === "storage") return openStorage();
    if (a === "office") return openOffice();
    if (a === "officeDefaults") return setOfficeSettingsOpen(true);
    const to = home[a] ?? "imports";
    setFpOpen(to);
    if (tab !== "input") setTab("input");
    window.scrollTo({ top: 0 });
  };
  const save = saveText(savingStored, saveState, storeMessage, presence !== null);
  const basis = model === null ? null : { members: model.members.map((m) => `${m.label} ${m.age}歳`).join("・"), asOf: model.asOf };
  return (
    <div class={`app${drawer ? " has-drawer" : ""}`}>
      <TopBar
        tabs={TABS}
        tab={tab}
        onTab={setTab}
        household={
          host !== null
            ? {
                no: storedInfo?.sample !== undefined ? `見本 ${storedInfo.sample.no}` : storedInfo !== null ? storedInfo.customerNo : opened?.demo != null ? `見本 ${opened.demo.sampleNo}` : "新しい世帯",
                sub: storedInfo?.sample !== undefined ? storedInfo.sample.name : storedInfo !== null ? (opened !== null ? summaryOf(opened.wh.request) : "") : (opened?.demo?.title ?? ""),
                open: hhOpen,
                onToggle: toggleHousehold,
              }
            : null
        }
        alerts={barAlerts(barIn).map((a) => ({ id: a.kind, text: a.text, short: a.short, title: a.title, tone: a.tone, onClick: alertActions[a.kind] }))}
        notices={barNotices(barIn).map((n) => ({ id: n.id, text: n.text, action: n.action, onClick: n.id.startsWith("household:") ? () => openHouseholdNotice(n.id, n.target) : noticeActions[n.target] }))}
        tools={
          opened !== null ? (
            <>
              <UndoButtons />
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
              <FpMenu
                groups={fpMenuGroups({
                  snapshots: (opened.wh.snapshots ?? []).length,
                  review: ((t) => (t === null ? null : { last: formatYearMonth(t.last), next: formatYearMonth(t.next) }))(reviewTiming(opened.wh.snapshots ?? [])),
                  imports: host !== null ? { ai: storedInfo !== null } : null,
                  office: host !== null ? { storage: storageText(officeStatus?.state, officeStatus?.usage === "personal"), share: officeShareText(officeStatus?.state, officeStatus?.usage === "personal") } : null,
                })}
                onPick={pickFpMenu}
                {...(initial.fpMenu === true ? { initialOpen: true } : {})}
              />
            </>
          ) : null
        }
        big={big}
        onBig={setBig}
      />
      <AiShareBand shares={ai.status?.shares ?? []} detailed={tab === "input"} onStop={(id) => void stopShare(id)} onOpen={() => setAiPanel("connector")} />
      <main class="wrap">
        {presence !== null && storedInfo !== null ? (
          <div class="presence-band" role="status" data-presence-band>
            <span>
              <b>{presenceText(presence, undefined, officeStatus?.usage === "personal")}</b>。見ることはできます。同時に直すと分岐になり、どちらを残すか選ぶことになります。
            </span>
            <button type="button" class="btn" onClick={startEditing} data-start-editing>
              編集を始める
            </button>
            <span class="pl-sub">編集を始めるまで、この画面の変更は保存しません</span>
          </div>
        ) : null}
        {sampleItem !== null && opened !== null && host !== null ? (
          <div class="sample-band" role="status" data-sample-band={sampleItem.no}>
            <span>
              <b>
                見本 {sampleItem.no}「{sampleItem.name}」
              </b>
              （{sampleNoText(sampleItem.no)}・架空）を開いています。{sampleMode === "edit" ? "手直しは自動で保存します。" : "動かしても見本は変わりません（閉じれば元どおり。「最初に戻す」も使えます）。"}
            </span>
            {storeStatus?.state === "ready" && storeUnavailable === null ? (
              <>
                <button type="button" class="btn" onClick={() => void guard(() => persistCurrent(defaultCategory(categories)))} data-band-customer>
                  この見本をもとに顧客を作る
                </button>
                {sampleMode !== "edit" ? (
                  <button type="button" class="link-btn" onClick={() => void guard(async () => { const req = copyRequest(sampleItem); if (req !== null) await persistCurrent(undefined, req); })} data-band-copy>
                    写して手直しする
                  </button>
                ) : null}
                {sampleItem.kind === "own" && sampleMode === "view" ? (
                  <button type="button" class="link-btn" onClick={startEditing} data-band-edit>
                    この見本を直す
                  </button>
                ) : null}
              </>
            ) : null}
          </div>
        ) : null}
        {host !== null ? (
          <HouseholdDrop open={hhOpen} onClose={closeHousehold}>
            <HouseholdPanel
              now={
                opened !== null ? (
                  <HouseholdNow
                    title={storedInfo?.sample !== undefined ? `見本 ${storedInfo.sample.no}` : storedInfo !== null ? `顧客番号 ${storedInfo.customerNo}` : opened.demo !== null ? `見本 ${opened.demo.sampleNo}（${opened.demo.title}）` : "新しい世帯"}
                    members={basis?.members ?? null}
                    asOf={basis?.asOf ?? null}
                    save={{ ...save, state: !savingStored ? "unsaved" : presence !== null ? "paused" : saveState.kind }}
                    ai={ai.status?.enabled === true ? { text: SHARE_STATE_TEXT[aiShare].long, sharing: aiShare === "sharing", onOpen: storedInfo !== null ? openAiShare : null } : null}
                  />
                ) : null
              }
              status={storeStatus}
              unavailable={storeUnavailable}
              error={hhError}
              list={storedList}
              currentId={storedInfo?.id ?? null}
              categories={categories}
              categoriesDecided={categoriesDecided}
              shelf={shelf}
              currentSample={currentSample}
              currentShape={opened !== null ? guessShape(opened.wh.request) : null}
              unsavedTitle={opened !== null && storedInfo === null && opened.demo === null ? "新しい世帯" : null}
              initialTab={hhTab}
              onOpen={(id) => void guard(() => openStored(id))}
              onCreate={(category) =>
                void guard(async () => {
                  await open(BLANK);
                  await persistCurrent(category);
                })
              }
              onSaveCurrent={(category) => void guard(() => persistCurrent(category))}
              onRename={renameStored}
              onSetCategory={(id, code) => numberOp(id, () => host.store.setCategory(id, code), (no) => `区分を変えました（${no}）`)}
              onAssignSerial={(id) => numberOp(id, () => host.store.assignSerial(id), (no) => `通し番号を付けました（${no}）`)}
              onMakeSample={async (id, req) => {
                const err = await numberOp(id, () => host.store.makeSample(id, req), (no) => `見本 ${no} として見本の棚へ移しました`);
                // 開いている世帯を見本にしたときは、見本として開き直す（動かしても保存しない）
                if (err === null && storedRef.current?.id === id) await openStored(id).catch(() => undefined);
                return err;
              }}
              onSaveCategories={async (edits: CategoryEdit[]) => {
                try {
                  applyCategories(await host.store.setCategories(edits));
                  await refreshStore();
                  const sr = storedRef.current;
                  if (sr !== null) {
                    const now = (await host.store.list()).find((h) => h.id === sr.id);
                    if (now !== undefined && now.customerNo !== sr.customerNo) {
                      sr.customerNo = now.customerNo;
                      setStoredInfo({ id: sr.id, customerNo: now.customerNo, readOnly: sr.readOnly });
                    }
                  }
                  say("区分を保存しました");
                  return null;
                } catch (e) {
                  return storeMessage(codeOf(e));
                }
              }}
              onDelete={deleteStored}
              onOpenSample={(item) => void guard(() => openSample(item))}
              onCustomerFromSample={(item, category) =>
                void guard(async () => {
                  await openSample(item);
                  await persistCurrent(category);
                })
              }
              onCopySample={(item) =>
                void guard(async () => {
                  const req = copyRequest(item);
                  if (req === null) return;
                  await openSample(item);
                  await persistCurrent(undefined, req);
                })
              }
              onUpdateSample={async (id, name, traits) => {
                try {
                  await host.store.updateSample(id, name, traits);
                  setStoredSamples(await host.store.listSamples());
                  const sr = storedRef.current;
                  if (sr !== null && sr.id === id && sr.sample !== undefined) {
                    sr.sample = { ...sr.sample, name, traits };
                    setStoredInfo({ id, customerNo: sr.customerNo, readOnly: sr.readOnly, sample: sr.sample });
                  }
                  return null;
                } catch (e) {
                  return storeMessage(codeOf(e));
                }
              }}
              onRecovery={() => setRecovery(storeStatus?.state === "needsRecovery" ? "restore" : "manage")}
              onAiConnector={() => {
                void ai.refresh();
                setAiPanel("connector");
              }}
              onOfficeDefaults={() => setOfficeSettingsOpen(true)}
              aiEnabled={ai.status?.enabled === true}
              onOffice={() => {
                void host.office.status().then(setOfficeStatus, () => undefined);
                setOfficeOpen(true);
              }}
              officeState={officeStatus?.state ?? "off"}
              usage={officeStatus?.usage ?? null}
              storageNotices={storageNotices}
              onStorage={() => {
                void host.office.status().then(setOfficeStatus, () => undefined);
                setStorageOpen("default");
              }}
              onForks={(id) => void openFork(id)}
              onClose={closeHousehold}
            />
          </HouseholdDrop>
        ) : null}
        {fatal !== null ? <p class="fatal">起動できませんでした（{fatal}）</p> : null}
        {error !== null && tab !== "input" ? <p class="fatal">計算できませんでした{error}</p> : null}
        {tab === "input" && opened !== null ? (
          <>
            {error !== null ? <p class="fatal">今の入力では計算できませんでした{error}</p> : null}
            <InputView
              key={cardOpen?.n ?? 0}
              wh={opened.wh}
              onSave={edit}
              calcNotices={currentNotices}
              layout={layoutOf(officeSettings)}
              plans={{
                list: opened.wh.proposals.map((p) => ({ id: p.id, label: planLabel(letters.get(p.id)?.letter ?? ""), name: modernPlanName(p.name), color: colorStyle(colors.get(p.id) ?? 1).color })),
                sel: inputPlanSel,
                onSelect: selectInputPlan,
                onNew: (base) => newInputPlan(base),
                onCopy: (id) => newInputPlan(null, id),
                cat: opened.catalog,
                onSavePlan: (next) => setPlans(next),
                lock: modified.has(work.sel) ? "結果のタブに、このプランの保存していない変更があります。結果のタブで「上書き保存」か「変更を取り消す」をしてから、入力で直してください（入力で直すのは保存したプランです）" : null,
                onResults: () => setTab("main"),
              }}
              computeOne={computeOne}
              level={level}
              {...(cardOpen !== null ? { initialOpen: cardOpen.id } : initial.open !== undefined ? { initialOpen: initial.open } : {})}
              {...(host !== null
                ? {
                    statement: {
                      initialOpen: initial.statement !== undefined,
                      render: (back: (approved?: number) => void) => (
                        <StatementPanel
                          wh={opened.wh}
                          host={host.statements}
                          {...(storedInfo !== null && storedInfo.sample === undefined ? { customerNo: storedInfo.customerNo } : {})}
                          {...(statementStep.current !== undefined ? { initialStep: statementStep.current } : {})}
                          onLog={(log) => putStatements(withLog(opened.wh, log).statements)}
                          onApprove={(next) => {
                            // 取り込んだ記録（区画 statements）を先に入れ、現状の値は元に戻せる変更として入れる
                            putStatements(next.statements);
                            edit(next);
                          }}
                          onApproved={(n) => {
                            statementStep.current = undefined;
                            back(n);
                          }}
                          onClose={() => {
                            statementStep.current = undefined;
                            back();
                          }}
                        />
                      ),
                    },
                  }
                : {})}
              tools={
                <>
                  <SnapshotTools
                    list={opened.wh.snapshots ?? []}
                    stored={storedInfo !== null}
                    onTake={(memo) => takeSnapshot({ trigger: "manual", memo, plan: { id: work.sel, letter: letterOf(work.sel), name: work.sel === CURRENT ? "現状" : (letters.get(work.sel)?.name ?? "") } })}
                    onRemove={(id) => putSnapshots((l) => l.filter((x) => x.id !== id))}
                    bar={false}
                    mode={fpOpen === "snapTake" ? "take" : fpOpen === "snapList" ? "list" : null}
                    onMode={(m) => setFpOpen(m === "take" ? "snapTake" : m === "list" ? "snapList" : null)}
                  />
                  <FpTools
                    wh={opened.wh}
                    result={resultOf(CURRENT)}
                    computeOne={computeOne}
                    onOpen={openCard}
                    onSnapshot={(memo) => takeSnapshot({ trigger: "manual", memo, plan: { id: CURRENT, letter: letterOf(CURRENT), name: "現状" } })}
                    onBalance={() => setTab("balance")}
                    atAge={settings.atAge}
                    bar={false}
                    tool={fpOpen === "contents" || fpOpen === "year" || fpOpen === "review" ? fpOpen : null}
                    onTool={(t) => setFpOpen(t)}
                  />
                </>
              }
              importsOpen={fpOpen === "imports"}
              onImportsOpen={(o) => setFpOpen(o ? "imports" : null)}
              {...(host !== null
                ? {
                    imports: (
                      <>
                        <HearingTools wh={opened.wh} sheets={host.sheets} onSave={edit} />
                        {storedInfo !== null ? (
                          <div class="hs-tools" role="group" aria-label="AI に資料を渡す" data-imports-ai>
                            <span class="hs-tools-h">AI に資料を渡す</span>
                            <button type="button" class="btn" onClick={openAiShare} data-imports-ai-open>
                              {ai.status?.enabled === true ? "同意と共有を開く" : "AI接続口を開く"}
                            </button>
                            <span class="in-note">面談のメモ・文字起こし・前の帳票・財産の一覧などは、FP が使う AI に渡します。AI が読んだ値は候補として届き、承認したものだけが現状に入ります（外部AIへの同意がある世帯だけ）。</span>
                          </div>
                        ) : null}
                      </>
                    ),
                  }
                : {})}
            />
          </>
        ) : tab === "contingency" && opened !== null ? (
          <>
            {basis !== null ? <BasisLine {...basis} /> : null}
            <ContingencyTab
              wh={opened.wh}
              host={host}
              engine={host === null ? null : (cgEngine.current ??= new ContingencyEngine({ host, web: webRef.current.web, packs: webRef.current.packs }))}
              targetAge={opened.demo?.targetAge ?? 95}
              onEdit={edit}
              ui={cgUi}
              onUi={setCgUi}
              {...(initial.scenario !== undefined ? { initialScenario: initial.scenario } : {})}
              plans={cgPlans}
              requestOf={cgRequestOf}
              {...(initial.cgPlan !== undefined ? { initialPlan: initial.cgPlan } : {})}
            />
          </>
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
            bsPoints={bsSettings.points}
            bsColumns={bsSettings.columns}
            moneyThree={bsSettings.moneyThree}
            onSnapshot={takeSnapshot}
            {...(initial.reportMode !== undefined ? { initialMode: initial.reportMode } : {})}
          />
        ) : tab === "balance" && opened !== null ? (
          bsPlans === null || bsPlans.length === 0 || band === null || model === null ? (
            fatal === null ? <p class="loading">計算しています…</p> : null
          ) : (
            <>
              {basis !== null ? <BasisLine {...basis} /> : null}
              <BalanceTab
                model={balanceTabModel({
                  plans: bsPlans,
                  selected: letterOf(work.sel),
                  base: letterOf(work.base),
                  guide: bsSettings.guide,
                  pointDefaults: bsSettings.points,
                  columns: bsSettings.columns,
                  prevChoices: bsPrevChoices,
                  prev: bsPrevModel,
                  provisional: model.provisional,
                  who: model.who,
                })}
                band={<PlanBand model={band} onSelect={select} onBase={setBase} onAdd={duplicate} onRemove={removePlan} />}
                onPrev={onBsPrev}
                onGuide={(g) => putBsSettings({ guide: g })}
                onColumns={(c) => putBsSettings({ columns: c })}
                onPointDefaults={(k) => putBsSettings({ points: k })}
                moneyThree={{ model: m3Model, onSettings: (x) => putBsSettings({ moneyThree: { ...bsSettingsRef.current.moneyThree, ...x } }), flash: m3Flash, nameChoices: MONEY_THREE_NAME_CHOICES }}
                initial={{ ...(initial.bsView !== undefined ? { view: initial.bsView } : {}), ...(initial.bsYear !== undefined ? { year: initial.bsYear } : {}), ...(initial.bsOpen !== undefined ? { open: initial.bsOpen } : {}), ...(initial.bsTable === true ? { table: true } : {}), ...(initial.bsSettings === true ? { settings: true } : {}) }}
              />
            </>
          )
        ) : model === null || opened === null || band === null ? (
          fatal === null ? <p class="loading">計算しています…</p> : null
        ) : (
          <div class="main-stack">
            {basis !== null ? <BasisLine {...basis} /> : null}
            <ChartPip head={<ResultVerdictView model={verdictView ?? model.result} />} extra={MAIN_PIP_EXTRA}>
              {(height) => (
                <PipResult
                  model={chartModel ?? model}
                  multi={multiHidden}
                  provisional={model.provisional}
                  mode={chartMode}
                  layout={settings.layout}
                  explain={explain !== null && explainStep !== null ? { model: explain, step: explainStep } : null}
                  ageMark={ageMark}
                  pinnedYear={pinnedYear}
                  onSelectYear={pinYear}
                  height={height}
                />
              )}
            </ChartPip>
            {/* ① 案の帯 */}
            <PlanBand
              model={band}
              lineMarks={settings.layout === "all" && explainStep === null}
              onSelect={select}
              onBase={setBase}
              onAdd={duplicate}
              {...(explainStep === null ? { onRemove: removePlan } : {})}
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
            {storedInfo !== null && ai.view !== null ? <AiCandidates candidates={ai.view.candidates} wh={opened.wh} catalog={opened.catalog} onAccept={acceptCandidate} onReject={rejectCandidate} /> : null}
            {panel === "list" ? <PlanList wh={opened.wh} catalog={opened.catalog} letters={letters} band={work.band} onBand={toggleBand} onEdit={(w) => setPlans(w)} onReflect={reflect}
                  onOpenInput={(id) => {
                    selectInputPlan(id);
                    setPanel(null);
                    setTab("input");
                  }}
                  onClose={() => setPanel(null)}
                /> : null}
            {panel === "compare" ? (
              <section class="card compare-card" aria-label="プランの比較" data-compare>
                <div class="card-h">
                  <h2>
                    プランの比較（{slots.length}つ。基準: {planLabel(letterOf(work.base))}）
                  </h2>
                  <span class="aside">{compareModel === null ? "計算しています…" : "帯に並べたプランの主な数字。差はいつも「そのプラン−基準」"}</span>
                  <button type="button" class="btn" onClick={() => setPanel(null)}>
                    閉じる
                  </button>
                </div>
                {compareModel !== null ? <CompareTable model={compareModel} /> : null}
              </section>
            ) : null}
            {/* 結果の見方（0044 の追記。入れ外しできる物がある世帯だけ。保存しない） */}
            <RowsViewBar rows={viewList} view={rowsView} onMode={(c) => putRowsView(viewMode(c))} onPick={(r, inc) => putRowsView(pickRow(viewRef.current, r, inc))} />
            {/* ② グラフ */}
            <ResultCard
              model={chartModel ?? model}
              multi={multiHidden}
              verdict={verdictView ?? model.result}
              provisional={model.provisional}
              mode={chartMode}
              onMode={setChartMode}
              layout={settings.layout}
              explain={explain !== null && explainStep !== null ? { model: explain, step: explainStep } : null}
              onExplain={setExplainStep}
              ageMark={ageMark}
              pinnedYear={pinnedYear}
              onSelectYear={pinYear}
              {...(locked === null ? { onBand } : { bandLock: bandLockNote(work) ?? locked })}
              {...(investModel !== null && explain === null && !multiView
                ? {
                    bar: (
                      <InvestBar
                        invest={investModel}
                        canBreakdown={investModel.breakdown !== null}
                        onBreakdown={(on) => putSettings({ invBreakdown: on })}
                        onPeriods={(on) => putSettings({ invPeriods: on })}
                        stressOn={stressOn}
                        onStress={toggleStress}
                        onStressLine={(k) => setStressHidden((h) => (h.includes(k) ? h.filter((x) => x !== k) : [...h, k]))}
                      />
                    ),
                    ...(donut !== null ? { after: donut } : {}),
                  }
                : {})}
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
                      onChange={(s) =>
                        history.track(() => {
                          settingsRef.current = s;
                          setSettings(s);
                          // FP顧問料の一文の枠（alt）を足す・外す
                          putWork(workRef.current, openedRef.current, "set");
                        })
                      }
                      onClose={() => setSettingsOpen(false)}
                    />
                  ) : null}
                  {model.fee !== null ? <FeeNote model={model.fee} /> : null}
                  {pensionNotices(opened.wh).map((t) => (
                    <div class="fee-note input-notice" key={t} role="note" data-input-notice>
                      <span class="fee-tag">入力の確認</span>
                      <span>{t}</span>
                    </div>
                  ))}
                  <CalcNotices rows={calcNotices} onOpenCard={openCard} {...(initial.notices === true ? { initialOpen: true } : {})} />
                  {selReq !== null ? <Insights req={selReq} result={selRes} months={bsSettings.moneyThree.months} inheritance={insightInheritance} onYear={pinYear} onLevers={() => document.querySelector("[data-levers]")?.scrollIntoView({ block: "start", behavior: "smooth" })} /> : null}
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
              onOpenInput={
                work.sel !== CURRENT
                  ? () => {
                      selectInputPlan(work.sel);
                      setTab("input");
                    }
                  : null
              }
              suggested={planInfo.suggested}
              changes={planInfo.changes}
              onAck={work.sel !== CURRENT && !modified.has(work.sel) ? (k) => setPlans(acknowledge(opened.wh, opened.catalog, work.sel, k)) : null}
              onDrop={work.sel !== CURRENT && !modified.has(work.sel) ? (k) => setPlans(dropChange(opened.wh, opened.catalog, work.sel, k)) : null}
              {...(initial.save === true ? { initialSave: true } : {})}
              {...(selReq !== null && model !== null && (selReq.input.household.accounts ?? []).length > 0
                ? {
                    extra: (
                      <DrawdownCalc
                        key={work.sel}
                        req={selReq}
                        years={model.chart.years}
                        compute={computeOne}
                        locked={locked !== null}
                        {...(initial.calc === true ? { initialOpen: true } : {})}
                        onUse={(d) => {
                          const key = d.method === "fixed" ? "inv:wAmt" : "inv:wRate";
                          setShown((s) => [...new Set([...s, key, "inv:wStart"])]);
                          setValue("inv:wStart", d.startAge, "slide");
                          setValue(key, d.value, "release");
                        }}
                      />
                    ),
                  }
                : {})}
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
                corner={`${planLabel(letterOf(tKey))}「${letters.get(tKey)?.name ?? ""}」`}
                scrollNonce={scrollNonce}
                controls={{
                  plans: slots.map((id) => ({ key: letterOf(id), letter: letterOf(id) })),
                  shown: letterOf(tKey),
                  onShow: (l) => {
                    const id = slotOfLetter(letters, slots, l);
                    setTableKey(id === undefined || id === work.sel ? null : id);
                  },
                  diff: { on: showDiff, disabled: tKey === work.base, label: tKey === work.base ? "差を表示（基準のプランを表示中）" : `差を表示（${letterOf(tKey)}−${letterOf(work.base)}）` },
                  onDiff: setShowDiff,
                }}
              />
            ) : null}
            <div class="foot footnote">
              <span>{opened.demo !== null && storedInfo === null ? "架空のモデル世帯を" : "入力した世帯を"}、ファイナンシアの計算エンジン（開発版）で計算した結果です。制度データには原本での確認待ちの行があります。</span>
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
          {notice.text}
          {notice.undo ? (
            <button type="button" class="toast-act" onClick={() => undoController.run("undo")} data-toast-undo>
              元に戻す
            </button>
          ) : null}
        </div>
      ) : null}
      {memoOpen && opened !== null ? (
        <MemoDrawer
          wh={opened.wh}
          onEdit={edit}
          onClose={() => setMemoOpen(false)}
          me={storedInfo !== null && officeStatus?.state === "member" ? (officeStatus.members.find((m) => m.isMe)?.memberId ?? null) : null}
          names={{ ...fileEditors, ...Object.fromEntries((officeStatus?.members ?? []).map((m) => [m.memberId, m.name])) }}
        />
      ) : null}
      {evidence !== null ? <EvidencePanel state={evidence} onClose={() => setEvidence(null)} /> : null}
      {aiPanel === "connector" && host !== null ? <AiConnectorPanel ai={host.ai} status={ai.status} onStatus={ai.setStatus} onChanged={() => void ai.refresh()} onClose={() => setAiPanel(null)} /> : null}
      {aiPanel === "share" && host !== null && storedInfo !== null ? (
        <AiSharePanel
          ai={host.ai}
          householdId={storedInfo.id}
          customerNo={storedInfo.customerNo}
          status={ai.status}
          view={ai.view}
          onView={(v) => {
            ai.setView(v);
            void ai.refresh();
          }}
          onOpenConnector={() => setAiPanel("connector")}
          onClose={() => setAiPanel(null)}
        />
      ) : null}
      {officeSettingsOpen && host !== null ? (
        <OfficeSettingsPanel
          value={officeSettings}
          shared={officeStatus?.state === "member"}
          onSave={async (v) => {
            await host.office.putDefaults(v as unknown as Record<string, unknown>);
            putOfficeSettings(v);
          }}
          onClose={() => setOfficeSettingsOpen(false)}
        />
      ) : null}
      {officeOpen && host !== null ? (
        <OfficePanel
          office={host.office}
          status={officeStatus}
          onStatus={setOfficeStatus}
          onHouseholdsChanged={() => {
            void refreshStore();
            // 世帯を共有フォルダへ移した: 開いていた世帯は、移した先から開き直す
            const sr = storedRef.current;
            if (sr !== null) void openStored(sr.id).catch((e: unknown) => setHhError(storeMessage(codeOf(e))));
          }}
          onRecovery={() => setRecovery("first")}
          onStorage={() => {
            setOfficeOpen(false);
            setStorageOpen("default");
          }}
          onClose={() => {
            setOfficeOpen(false);
            void refreshStore();
          }}
        />
      ) : null}
      {storageOpen !== null && host !== null ? (
        <StoragePanel
          office={host.office}
          status={officeStatus}
          storeStatus={storeStatus}
          notices={storageNotices}
          focus={storageOpen === "open" ? "open" : null}
          onStatus={setOfficeStatus}
          onHouseholdsChanged={() => {
            void refreshStore();
            // 世帯を同期フォルダへ移した・この PC の中へ戻した: 開いていた世帯は、移した先から開き直す
            const sr = storedRef.current;
            if (sr !== null) void openStored(sr.id).catch((e: unknown) => setHhError(storeMessage(codeOf(e))));
          }}
          onRecovery={() => setRecovery("manage")}
          onOffice={() => {
            setStorageOpen(null);
            setOfficeOpen(true);
          }}
          onClose={() => {
            setStorageOpen(null);
            void refreshStore();
          }}
        />
      ) : null}
      {fork !== null && host !== null ? (
        <ForkPanel
          customerNo={storedList.find((h) => h.id === fork.id)?.customerNo ?? storedInfo?.customerNo ?? ""}
          info={fork.info}
          busy={fork.busy}
          error={fork.error}
          onChoose={(c) => void chooseFork(c)}
          onSyncCopies={(adopt) => void chooseSyncCopies(adopt)}
          onClose={() => setFork(null)}
        />
      ) : null}
      {recovery !== null && host !== null ? (
        <RecoveryPanel
          mode={recovery}
          store={host.store}
          status={storeStatus}
          shared={officeStatus?.state === "member"}
          personal={officeStatus?.state === "member" && officeStatus.usage === "personal"}
          onOpenSync={() => {
            setRecovery(null);
            setStorageOpen("open");
          }}
          onStorage={() => {
            setRecovery(null);
            setStorageOpen("default");
          }}
          onStatus={(st) => {
            setStoreStatus(st);
            // 事務所の復元キーを保管した・試して通った: 止めていた共有の操作の表示を戻す（0023 の5）
            void host.office.status().then(setOfficeStatus, () => undefined);
            if (recovery === "restore" && st.state === "ready") {
              setRecovery(null);
              void refreshStore();
            }
          }}
          onClose={() => setRecovery(null)}
        />
      ) : null}
      {devKeys ? (
        <span class="dev-keys" aria-label="開発用のビルドです。鍵を OS の保管庫ではなく、開発用のデータフォルダのファイルに置いています。本物の顧客データに使わないでください" data-keystore-dev>
          開発用・鍵はファイル
        </span>
      ) : null}
    </div>
  );
}

/** 画面の確かめ用（開発用のサーバーだけ）: #items=loan,rate,shift,mix,surplus で、よく使う項目を対策に足す */
function devItems(cat: Catalog, kinds: string[]): string[] {
  const out: string[] = [];
  for (const k of kinds) {
    const it = cat.items.find((x) => (k === "loan" ? /^loan:.*:(principal|prepay)$/.test(x.key) : k === "rate" ? /^loan:.*:rate$/.test(x.key) : k === "shift" ? x.key === "rates:shift" : k === "mix" ? x.key.startsWith("mix:") && x.control.kind === "mix" && x.control.accountKind !== "deposit" : k === "surplus" ? x.key === "surplus:ratio" : false));
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
    const r = savePlan(wh, cat, { name, tags, base, values: normalizeValues(values, base === null ? {} : effectiveValues(wh, base), wh, cat), now: nowIso() });
    wh = r.wh;
    ids.push(r.id);
    return r.id;
  };
  const loanValue = loan === undefined ? {} : { [loan.key]: loan.key.endsWith(":prepay") ? 5_000_000 : (loan.read(wh) as number) - 5_000_000 };
  const b = save("プランB 借入を500万円減らす", { ...first, ...loanValue }, null, ["住宅"]);
  const r0 = rate?.read(wh);
  save("プランC プランB＋金利が0.5%上がる", { ...first, ...loanValue, ...(rate !== undefined && typeof r0 === "string" ? { [rate.key]: addRate(r0, "0.005") } : {}) }, b, ["住宅"]);
  save("プランD NISAを株式80%で", { ...first, ...(mix !== undefined ? { [mix.key]: mixFromBuckets(undefined, 80, 10) } : {}) }, null, ["運用"]);
  save("プランE 70歳まで働く", { ...first, "lever:retireAge": 70, "lever:pensionAge": 70 }, null, ["老後"]);
  save("プランF 変動金利が2030年から1%上がる", { ...first, ...(shift !== undefined ? { [shift.key]: { add: "0.01", from: "2030-01" } } : {}) }, null, ["住宅"]);
  return { wh, ids, keys: [loan?.key, rate?.key, shift?.key, mix?.key].filter((x): x is string => x !== undefined) };
}
