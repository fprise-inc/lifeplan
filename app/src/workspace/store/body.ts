// 世帯ファイルの本文（0011 の2）を、画面の側の状態から組み立てる・読み取る。暗号化とファイルの読み書きは本体（0013・0016 の1）。
// 本文の区画（形式の版 0.10。β公開まではこの 0.x の形で、版を上げるときは本体の一方向の変換の段を足す。0011 の5）:
// - meta: 形式名・形式の版・保存日時・アプリの版・表示用の顧客番号、誰が直したか（保存した人・改訂の履歴・出てくるメンバーの表示名。本体が入れる。0023 の6）
// - household: 現状の世帯（計算の要求と、画面の側の値: 呼び名・定年後の予定・FP用のメモとその行ごとの書いた人・万一の想定の前提・足した項目など）。
//   0.9 から: 教育の目標の保育所の段の保育の時間・自治体の水準の割合と、給食費の選び方（0029。保育所の段の空の月額は収入から自動で計算する読み方）
// - proposals: 案（数に上限なし。0008 の5）。案の名前は `title` に入れる（0012 の禁止語の検査に当たらない名前）
// - hearing: ヒアリングの依頼・取り込み・同意の下書きの記録（0018。取り込みの記録・同意の記録への分け方は後の版）
// - workspace: 案の帯の並び・基準の案・選んだ案・対策に足した項目・出発点にした見本
// - display: 表示の設定（世帯ごと。タブごとの区画に分ける。0.8 から）:
//   - display.result: 結果のタブ（出す数字・○歳時点の年齢・グラフの比べ方・資産の推移の口座の内訳と運用の期間の帯）
//   - display.balance: 資産と負債のタブ（家計の体力の目安の幅 guide・時点を並べるときの既定の時点 points・この世帯で選んだ時点 columns）
//   0.7 までは display の直下に平らに置いていた（bsGuide・bsPoints・bsColumns と、なくした「操作中はグラフを上に表示」の dock）。
//   本体の変換の段（0.7 → 0.8）が区画へ移す。画面の側も、区画の無い本文は直下の値から読む
// - snapshots: 控え（0009 の2。PDF を書き出した時点・FP が残した時点の写し。0.3 から。控えが無ければ区画を作らない）。
//   0.10 から: 持ち帰り用のレポートを書き出した時点の写し（きっかけ takeaway と、載せたプラン・パスワードの有無だけの記録 takeaway。0030）
// - extDefinitions / ext: 拡張領域（0011 の4。読んだものをそのまま書き戻し、失わない）
// 保存しないもの: 提案書の宛名（0012 の2。出力のときだけ）、保存していない案の変更（「案として保存」「上書き」で保存する）、
// 画面の一時的な状態（開いているタブ・パネル・文字の大きさなど）
import type { EngineRequest } from "../../engine/types.ts";
import { emptyPlan } from "../contingency/planData.ts";
import type { HearingLog } from "../hearing/sheet.ts";
import type { WorkingHousehold } from "../input/household.ts";
import { CURRENT } from "../plans/band.ts";
import type { Proposal } from "../plans/plans.ts";
import { readSnapshots, type Snapshot } from "../snapshots/snapshots.ts";
import { readBsColumns, readBsGuide, readBsPoints } from "../balanceTab.ts";
import { DEFAULT_DISPLAY_SETTINGS, LAYOUT_CHOICES, METRIC_CHOICES, type BalanceSettings, type DisplaySettings, type MetricKey } from "../settings.ts";

/** 本文の形式の版（本体の household-store の migrate::CURRENT と同じ） */
export const BODY_FORMAT_VERSION = "0.10";

type StoredProposal = Omit<Proposal, "name"> & { title: string };

/** 表示の設定（タブごとの区画。0.8 から） */
export interface StoredDisplay {
  result: DisplaySettings;
  balance: BalanceSettings;
}

export interface SavedWorkspace {
  /** 出発点にした見本の世帯（目盛り・既定の値に使う）。空から作った世帯は null */
  template: string | null;
  band: string[];
  base: string;
  selected: string;
  shownItems: string[];
}

export interface HouseholdBody {
  meta?: Record<string, unknown>;
  household: Omit<WorkingHousehold, "proposals" | "hearing" | "snapshots">;
  proposals: StoredProposal[];
  hearing: HearingLog | null;
  /** 控え（0.3 から。無ければ区画ごと省く） */
  snapshots?: Snapshot[];
  workspace: SavedWorkspace;
  display: StoredDisplay;
  extDefinitions: Record<string, unknown>;
  ext: Record<string, unknown>;
}

/** 画面の側の状態（本文の中身） */
export interface BodyState {
  wh: WorkingHousehold;
  workspace: SavedWorkspace;
  display: StoredDisplay;
  /** 読んだ拡張領域（書き戻すため） */
  carry: { extDefinitions: Record<string, unknown>; ext: Record<string, unknown> };
}

export const EMPTY_CARRY: BodyState["carry"] = { extDefinitions: {}, ext: {} };

export function bodyObject(s: BodyState): HouseholdBody {
  const { proposals, hearing, snapshots, ...household } = s.wh;
  return {
    household,
    proposals: proposals.map(({ name, ...p }) => ({ ...p, title: name })),
    hearing: hearing ?? null,
    ...(snapshots !== undefined && snapshots.length > 0 ? { snapshots } : {}),
    workspace: s.workspace,
    display: s.display,
    extDefinitions: s.carry.extDefinitions,
    ext: s.carry.ext,
  };
}

/** 本文の JSON（本体の store_create・store_save に渡す） */
export function bodyOf(s: BodyState): string {
  return JSON.stringify(bodyObject(s));
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);

/** 本文の JSON から画面の側の状態へ（形の合わない本文は E_BODY_SHAPE） */
export function fromBody(json: string): BodyState {
  const b = JSON.parse(json) as unknown;
  if (!isObj(b) || !isObj(b.household) || !isObj(b.household.request)) throw new Error("E_BODY_SHAPE");
  const { snapshots: _inHousehold, ...h } = b.household as unknown as Partial<WorkingHousehold> & { request: EngineRequest };
  void _inHousehold;
  const proposals: Proposal[] = (Array.isArray(b.proposals) ? (b.proposals as StoredProposal[]) : []).map(({ title, ...p }) => ({ ...p, name: title }));
  const wh: WorkingHousehold = {
    labelsByMember: {},
    postRetirement: {},
    memo: [],
    assumed: {},
    addedItems: [],
    confirmed: [],
    contingency: emptyPlan(),
    ...h,
    proposals,
    ...(isObj(b.hearing) ? { hearing: b.hearing as unknown as HearingLog } : {}),
  };
  const snapshots = readSnapshots(b.snapshots);
  if (snapshots.length > 0) wh.snapshots = snapshots;
  const w = isObj(b.workspace) ? b.workspace : {};
  const workspace: SavedWorkspace = {
    template: typeof w.template === "string" ? w.template : null,
    band: strings(w.band),
    base: typeof w.base === "string" ? w.base : CURRENT,
    selected: typeof w.selected === "string" ? w.selected : CURRENT,
    shownItems: strings(w.shownItems),
  };
  const display = readDisplay(b.display);
  return {
    wh,
    workspace,
    display,
    carry: { extDefinitions: isObj(b.extDefinitions) ? b.extDefinitions : {}, ext: isObj(b.ext) ? b.ext : {} },
  };
}

/**
 * 表示の設定を読む（タブごとの区画 display.result・display.balance。区画の無い 0.7 までの本文は直下の値から読む）。
 * 読めない値は既定。区画の中の知らない欄は持たない（なくした dock など）
 */
export function readDisplay(v: unknown): StoredDisplay {
  const d = isObj(v) ? v : {};
  const r = isObj(d.result) ? d.result : d;
  const bal = isObj(d.balance) ? d.balance : null;
  return {
    result: {
      metrics: strings(r.metrics).filter((k): k is MetricKey => METRIC_CHOICES.some((c) => c.key === k)),
      atAge: typeof r.atAge === "number" ? r.atAge : DEFAULT_DISPLAY_SETTINGS.atAge,
      layout: LAYOUT_CHOICES.some((c) => c.key === r.layout) ? (r.layout as DisplaySettings["layout"]) : DEFAULT_DISPLAY_SETTINGS.layout,
      invBreakdown: typeof r.invBreakdown === "boolean" ? r.invBreakdown : DEFAULT_DISPLAY_SETTINGS.invBreakdown,
      invPeriods: typeof r.invPeriods === "boolean" ? r.invPeriods : DEFAULT_DISPLAY_SETTINGS.invPeriods,
    },
    balance: {
      guide: readBsGuide(bal !== null ? bal.guide : d.bsGuide),
      points: readBsPoints(bal !== null ? bal.points : d.bsPoints),
      columns: readBsColumns(bal !== null ? bal.columns : d.bsColumns),
    },
  };
}

/** 一覧に出す構成の要約（続柄と人数だけ。氏名・年齢は入れない）。例: 本人・配偶者・子2人 */
export function summaryOf(req: EngineRequest): string {
  const ms = req.input.household.members;
  const parts: string[] = [];
  if (ms.some((m) => m.kind === "self")) parts.push("本人");
  if (ms.some((m) => m.kind === "spouse")) parts.push("配偶者");
  const kids = ms.filter((m) => m.kind === "child").length;
  if (kids > 0) parts.push(`子${kids}人`);
  const others = ms.filter((m) => m.kind !== "self" && m.kind !== "spouse" && m.kind !== "child").length;
  if (others > 0) parts.push(`ほか${others}人`);
  return parts.join("・");
}
