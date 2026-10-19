// 世帯ファイルの本文（0011 の2）を、画面の側の状態から組み立てる・読み取る。暗号化とファイルの読み書きは本体（0013・0016 の1）。
// 本文の区画（形式の版 0.2。β公開まではこの 0.x の形で、版を上げるときは本体の一方向の変換の段を足す。0011 の5）:
// - meta: 形式名・形式の版・保存日時・アプリの版・表示用の顧客番号、誰が直したか（保存した人・改訂の履歴・出てくるメンバーの表示名。本体が入れる。0023 の6）
// - household: 現状の世帯（計算の要求と、画面の側の値: 呼び名・定年後の予定・FP用のメモとその行ごとの書いた人・万一の想定の前提・足した項目など）
// - proposals: 案（数に上限なし。0008 の5）。案の名前は `title` に入れる（0012 の禁止語の検査に当たらない名前）
// - hearing: ヒアリングの依頼・取り込み・同意の下書きの記録（0018。取り込みの記録・同意の記録への分け方は後の版）
// - workspace: 案の帯の並び・基準の案・選んだ案・対策に足した項目・出発点にした見本
// - display: 表示の設定（世帯ごと。出す数字・○歳時点の年齢・グラフの比べ方・操作中はグラフを上に表示）
// - extDefinitions / ext: 拡張領域（0011 の4。読んだものをそのまま書き戻し、失わない）
// 保存しないもの: 提案書の宛名（0012 の2。出力のときだけ）、保存していない案の変更（「案として保存」「上書き」で保存する）、
// 画面の一時的な状態（開いているタブ・パネル・文字の大きさなど）
import type { EngineRequest } from "../../engine/types.ts";
import { emptyPlan } from "../contingency/planData.ts";
import type { HearingLog } from "../hearing/sheet.ts";
import type { WorkingHousehold } from "../input/household.ts";
import { CURRENT } from "../plans/band.ts";
import type { Proposal } from "../plans/plans.ts";
import { DEFAULT_DISPLAY_SETTINGS, LAYOUT_CHOICES, METRIC_CHOICES, type DisplaySettings, type MetricKey } from "../settings.ts";

/** 本文の形式の版（本体の household-store の migrate::CURRENT と同じ） */
export const BODY_FORMAT_VERSION = "0.2";

type StoredProposal = Omit<Proposal, "name"> & { title: string };

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
  household: Omit<WorkingHousehold, "proposals" | "hearing">;
  proposals: StoredProposal[];
  hearing: HearingLog | null;
  workspace: SavedWorkspace;
  display: DisplaySettings;
  extDefinitions: Record<string, unknown>;
  ext: Record<string, unknown>;
}

/** 画面の側の状態（本文の中身） */
export interface BodyState {
  wh: WorkingHousehold;
  workspace: SavedWorkspace;
  display: DisplaySettings;
  /** 読んだ拡張領域（書き戻すため） */
  carry: { extDefinitions: Record<string, unknown>; ext: Record<string, unknown> };
}

export const EMPTY_CARRY: BodyState["carry"] = { extDefinitions: {}, ext: {} };

export function bodyObject(s: BodyState): HouseholdBody {
  const { proposals, hearing, ...household } = s.wh;
  return {
    household,
    proposals: proposals.map(({ name, ...p }) => ({ ...p, title: name })),
    hearing: hearing ?? null,
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
  const h = b.household as unknown as Partial<Omit<WorkingHousehold, "proposals" | "hearing">> & { request: EngineRequest };
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
  const w = isObj(b.workspace) ? b.workspace : {};
  const workspace: SavedWorkspace = {
    template: typeof w.template === "string" ? w.template : null,
    band: strings(w.band),
    base: typeof w.base === "string" ? w.base : CURRENT,
    selected: typeof w.selected === "string" ? w.selected : CURRENT,
    shownItems: strings(w.shownItems),
  };
  const d = isObj(b.display) ? b.display : {};
  const display: DisplaySettings = {
    ...DEFAULT_DISPLAY_SETTINGS,
    ...(d as Partial<DisplaySettings>),
    metrics: strings(d.metrics).filter((k): k is MetricKey => METRIC_CHOICES.some((c) => c.key === k)),
    atAge: typeof d.atAge === "number" ? d.atAge : DEFAULT_DISPLAY_SETTINGS.atAge,
    layout: LAYOUT_CHOICES.some((c) => c.key === d.layout) ? (d.layout as DisplaySettings["layout"]) : DEFAULT_DISPLAY_SETTINGS.layout,
    dock: typeof d.dock === "boolean" ? d.dock : DEFAULT_DISPLAY_SETTINGS.dock,
  };
  return {
    wh,
    workspace,
    display,
    carry: { extDefinitions: isObj(b.extDefinitions) ? b.extDefinitions : {}, ext: isObj(b.ext) ? b.ext : {} },
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
