// 世帯ファイルの本文（0011 の2）を、画面の側の状態から組み立てる・読み取る。暗号化とファイルの読み書きは本体（0013・0016 の1）。
// 本文の区画（形式の版 0.20。β公開まではこの 0.x の形で、版を上げるときは本体の一方向の変換の段を足す。0011 の5）。
// 0.17 から（0035・0036）: 差分は当て先で、仮の印は物の値の状態の欄で、贈与者は世帯の外の家族の構成員で書き、並びの要素は ID を持つ。
// 0.18 から（0040）: 段階と例外の年（周期的な支出・家賃・修繕費・固定資産税・不動産の家賃と経費・器の利回り・資産配分）と、働き方の期間ごとの
// 伸び（給与・事業所得の年率）。足すだけの形（本体の変換の段は版だけを書き換える）
// 画面の中は 0.16 と同じ形のまま使い、ここで読み書きするときに format017.ts で直す（入力画面を作り直すまで）
// - meta: 形式名・形式の版・保存日時・アプリの版・表示用の顧客番号、誰が直したか（保存した人・改訂の履歴・出てくるメンバーの表示名。本体が入れる。0023 の6）
// - household: 現状の世帯（計算の要求と、画面の側の値: 呼び名・定年後の予定・FP用のメモとその行ごとの書いた人・万一の想定の前提・足した項目など）。
//   0.9 から: 教育の目標の保育所の段の保育の時間・自治体の水準の割合と、給食費の選び方（0029。保育所の段の空の月額は収入から自動で計算する読み方）
//   0.11 から: 前提の黒字のうち貯まる割合（surplusSaving）と、まとめた金融資産の器の運用しない分（uninvested。0031）。
//   0.12 から: 生活防衛資金（0.11 の前提 emergencyReserve）をなくした（本体の変換の段で捨てる。控えの中身は残り、計算するときに外す。0031 の追記）
//   0.19 から: 世帯の外の家族のお金 members[].wallet（預金・生活費・年金・一時の入金。0042。任意）
//   0.20 から: お金の行（0044。入るお金の行 incomeFlows、出るお金の行に足した月額・種類・相手・払う人・優先度・あげる贈与、口座の間の移し替えの
//   入れ物 transfers、相続で受け継ぐ借金の元の借り手・見込み・基本の計算に入れる。どれも任意）
// - proposals: 案（数に上限なし。0008 の5）。案の名前は `title` に入れる（0012 の禁止語の検査に当たらない名前）
// - hearing: ヒアリングの依頼・取り込み・同意の下書きの記録（0018。取り込みの記録・同意の記録への分け方は後の版）
// - workspace: 案の帯の並び・基準の案・選んだ案・対策に足した項目・出発点にした見本
// - display: 表示の設定（世帯ごと。タブごとの区画に分ける。0.8 から）:
//   - display.result: 結果のタブ（出す数字・○歳時点の年齢・グラフの比べ方・資産の推移の口座の内訳と運用の期間の帯）
//   - display.balance: 資産と負債のタブ（家計の体力の目安の幅 guide・時点を並べるときの既定の時点 points・この世帯で選んだ時点 columns、
//     0.13 から お金の3つの分け方 moneyThree（何か月分 months・何年先まで years・呼び方 wording。0032））
//   0.7 までは display の直下に平らに置いていた（bsGuide・bsPoints・bsColumns と、なくした「操作中はグラフを上に表示」の dock）。
//   本体の変換の段（0.7 → 0.8）が区画へ移す。画面の側も、区画の無い本文は直下の値から読む
// - snapshots: 控え（0009 の2。PDF を書き出した時点・FP が残した時点の写し。0.3 から。控えが無ければ区画を作らない）。
//   0.10 から: 持ち帰り用のレポートを書き出した時点の写し（きっかけ takeaway と、載せたプラン・パスワードの有無だけの記録 takeaway。0030）
// - statements: 明細の取り込みの記録（0034。0.14 から。取り込んでいない世帯は区画を作らない）。元のファイルは持たず、指紋・読み手・
//   列の対応付け・期間・番号を消した後の行と FP が決めたこと・世帯の決まり・働き方・候補を取り込んだ記録だけ。読むときは statement/ の
//   readLog で形を確かめる（形の合わないものは捨てる）。0.15 から: 前もってお客さまに印を付けてもらう確認シートの依頼の記録 requests
//   （依頼番号・書き出した日時・書き出したファイルの指紋・シートの番号 → 行の対応・取り込んだ記録）。0.16 から: 店ごとにまとめた
//   シートの1行は、同じ番号に複数の行を対応させる
// - extDefinitions / ext: 拡張領域（0011 の4。読んだものをそのまま書き戻し、失わない）
// 保存しないもの: 提案書の宛名（0012 の2。出力のときだけ）、保存していない案の変更（「案として保存」「上書き」で保存する）、
// 画面の一時的な状態（開いているタブ・パネル・文字の大きさなど）
import type { EngineRequest } from "../../engine/types.ts";
import { emptyPlan } from "../contingency/planData.ts";
import type { HearingLog } from "../hearing/sheet.ts";
import { withElementIds, type WorkingHousehold } from "../input/household.ts";
import { CURRENT } from "../plans/band.ts";
import type { Proposal } from "../plans/plans.ts";
import { readSnapshots, type Snapshot } from "../snapshots/snapshots.ts";
import { readBsColumns, readBsGuide, readBsPoints } from "../balanceTab.ts";
import { readMoneyThree } from "../moneyThree.ts";
import { readLog, type StatementLog } from "../../../../statement/src/index.ts";
import { fromStoredBody, OUTSIDE_KEPT, toStoredBody } from "./format017.ts";
import { DEFAULT_DISPLAY_SETTINGS, LAYOUT_CHOICES, METRIC_CHOICES, type BalanceSettings, type DisplaySettings, type MetricKey } from "../settings.ts";

/** 本文の形式の版（本体の household-store の migrate::CURRENT と同じ） */
export const BODY_FORMAT_VERSION = "0.20";

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
  household: Omit<WorkingHousehold, "proposals" | "hearing" | "snapshots" | "statements">;
  proposals: StoredProposal[];
  hearing: HearingLog | null;
  /** 控え（0.3 から。無ければ区画ごと省く） */
  snapshots?: Snapshot[];
  /** 明細の取り込みの記録（0.14 から。取り込んでいなければ区画ごと省く。0034） */
  statements?: StatementLog;
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
  /** 読んだ拡張領域（書き戻すため）。outside は贈与者に戻した世帯の外の家族の元の構成員（format017.ts の OUTSIDE_KEPT） */
  carry: { extDefinitions: Record<string, unknown>; ext: Record<string, unknown>; outside?: Record<string, unknown> };
}

export const EMPTY_CARRY: BodyState["carry"] = { extDefinitions: {}, ext: {} };

export function bodyObject(s: BodyState): HouseholdBody {
  const { proposals, hearing, snapshots, statements, ...household } = s.wh;
  return toStoredBody({
    household,
    proposals: proposals.map(({ name, ...p }) => ({ ...p, title: name })),
    hearing: hearing ?? null,
    ...(snapshots !== undefined && snapshots.length > 0 ? { snapshots } : {}),
    ...(statements !== undefined && hasStatements(statements) ? { statements } : {}),
    workspace: s.workspace,
    display: s.display,
    extDefinitions: s.carry.extDefinitions,
    ext: s.carry.ext,
    ...(s.carry.outside !== undefined && Object.keys(s.carry.outside).length > 0 ? { [OUTSIDE_KEPT]: s.carry.outside } : {}),
  } as unknown as Record<string, unknown>) as unknown as HouseholdBody;
}

/** 明細の取り込みの記録に、残す中身があるか（空の記録は区画を作らない） */
function hasStatements(l: StatementLog): boolean {
  return l.accounts.length > 0 || l.imports.length > 0 || l.rules.length > 0 || l.applied.length > 0 || Object.keys(l.styles ?? {}).length > 0 || (l.requests ?? []).length > 0;
}

/** 本文の JSON（本体の store_create・store_save に渡す） */
export function bodyOf(s: BodyState): string {
  return JSON.stringify(bodyObject(s));
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);

/** 本文の JSON から画面の側の状態へ（形の合わない本文は E_BODY_SHAPE） */
export function fromBody(json: string): BodyState {
  const raw = JSON.parse(json) as unknown;
  if (!isObj(raw) || !isObj(raw.household) || !isObj(raw.household.request)) throw new Error("E_BODY_SHAPE");
  const b = fromStoredBody(raw);
  if (!isObj(b.household) || !isObj(b.household.request)) throw new Error("E_BODY_SHAPE");
  const { snapshots: _inHousehold, statements: _st, ...h } = b.household as unknown as Partial<WorkingHousehold> & { request: EngineRequest };
  void _inHousehold;
  void _st;
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
    // 並びの要素に ID を振る（ID の無い古いデータは場所から決まった ID。0035 の5）
    request: withElementIds(h.request),
    proposals,
    ...(isObj(b.hearing) ? { hearing: b.hearing as unknown as HearingLog } : {}),
  };
  const snapshots = readSnapshots(b.snapshots);
  if (snapshots.length > 0) wh.snapshots = snapshots;
  if (isObj(b.statements)) {
    const statements = readLog(b.statements);
    if (hasStatements(statements)) wh.statements = statements;
  }
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
    carry: { extDefinitions: isObj(b.extDefinitions) ? b.extDefinitions : {}, ext: isObj(b.ext) ? b.ext : {}, ...(isObj(b[OUTSIDE_KEPT]) ? { outside: b[OUTSIDE_KEPT] } : {}) },
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
      moneyThree: readMoneyThree(bal !== null ? bal.moneyThree : undefined),
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
