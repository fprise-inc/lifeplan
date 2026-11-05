// 画面の中で編集する世帯（作業の層）。計算エンジンに渡す要求（0008 の形の世帯と前提条件）と、
// エンジンに渡さない画面の側の値（FP が付ける呼び名・定年後の予定の条件・FP用のメモ・万一の想定の前提・FPが足した項目・保存した項目）を1つにまとめる。
// 保存・暗号化はまだ無い（次の回。世帯ファイルの封筒 0011 に入れる）。アプリを閉じると消える
import type { ExtValue } from "../../../../report/src/index.ts";
import type { Box, EmploymentPeriod, EngineRequest, Household, Member, PensionRecord, Timepoint } from "../../engine/types.ts";
import { addMonths, ageAt, ageReachedMonth, parseYm, type Reemployment } from "../levers.ts";
import { emptyPlan, planFromRequest, type ContingencyPlan } from "../contingency/planData.ts";
import { startLiving } from "./livingStages.ts";
import type { Proposal } from "../plans/plans.ts";
import type { HearingLog } from "../hearing/sheet.ts";
import type { StatementLog } from "../../../../statement/src/index.ts";
import type { Snapshot } from "../snapshots/snapshots.ts";
import type { MigrationLog } from "../store/migrations.ts";
import type { RecheckMark } from "./recheck.ts";
import type { NoticeAck } from "./noticeAck.ts";
import type { ItemChoice } from "./itemChoice.ts";
import { giveElementIds, lacksElementIds, randomId } from "../store/elementIds.ts";
import { isAutoSmr } from "./smr.ts";
import type { LivingPart } from "./livingParts.ts";
import { isOfficeBasisText } from "../../../../hearing/src/statistics.ts";
import { officeNow } from "../office/current.ts";

/** 定年の後に働くときの条件（D: 入力画面の「定年後の予定」。主画面の「働く最後の年齢」を延ばすときにも使う） */
export interface PostRetirement {
  /** 定年（今の勤め先を辞める年齢）。この年齢に達する月の前月までが今の勤め先 */
  fromAge: number;
  /** 定年後の働き方。null は「働かない」（延ばすときは今の働き方のまま延ばす） */
  type: "contract" | "partTime" | "selfEmployed" | null;
  /** 定年後の年収（円。自営業は事業の所得） */
  annualSalary: number | null;
  standardMonthlyRemuneration?: number;
}

/** 開いたときの知らせ（0035 の8） */
export interface HouseholdNotice {
  id: string;
  kind: "outsideFamily" | "unresolvedDiffs" | "smrBlank" | "livingUnknown" | "unknownEstimated" | "carLoanEstimated" | "livingAllowance" | "petTemplate" | "compatibilityDropped" | "neutralEstimates" | "planEndYearShared" | "cryptoAccounts" | string;
  members?: string[];
  count?: number;
  /** smrBlank・livingUnknown・unknownEstimated・carLoanEstimated・cryptoAccounts: プランの差分を変えた数 */
  plans?: number;
  /** livingAllowance: 前の内訳の仕送りの月額の合計 */
  amount?: number;
  /** neutralEstimates: 推定のままの給与・賞与・退職一時金の数（新しい目安で入れ直す物。0118） */
  estimates?: number;
  /** planEndYearShared: 表の最後の年の差分を外したプランの名前（0043 の追記 2026-11-05） */
  names?: string[];
  /** planEndYearShared: 外した差分の年（そのプランで入れていた表の最後の年） */
  years?: number[];
  /** planEndYearShared: 現状の表の最後の年（どのプランもこの年で終わる） */
  endYear?: number;
}

export interface WorkingHousehold {
  /** 計算エンジンに渡す要求（現状。入力の値） */
  request: EngineRequest;
  /** FP が付ける呼び名（任意。例: 上のお子さん）。構成員の ID → 呼び名。氏名は入れない（0012） */
  labelsByMember: Record<string, string>;
  /** 定年後の予定の条件。構成員の ID → 条件 */
  postRetirement: Record<string, PostRetirement>;
  /** FP用のメモ（顧客に見せない。画面には出さず、開いたときだけ見える引き出しに置く） */
  memo: string[];
  /** メモの行ごとの書いた人（事務所のメンバーの内部ID。`memo` と同じ並び。事務所で共有しているときだけ。0023 の6） */
  memoBy?: (string | null)[];
  /** 箱（0008 の2）を持たない項目に入れた仮の値。欄のキー → 理由。FP が入れ直すと消える */
  assumed: Record<string, string>;
  /** 万一の想定の前提（遺族の生活費の割合・働き方の変化・等級の仮定など）。万一の画面で要求を作るときに使う */
  contingency: ContingencyPlan;
  /** 入力のホームで FP が足した項目（物1件ずつのカード。items.ts）。並びは足した順 */
  addedItems: AddedItem[];
  /** FP が入力のパネルで保存した項目（カードの ID）。物が無い項目でも「入力済み（なし）」にするために使う */
  confirmed: string[];
  /**
   * ローンの入れ方の区分（0052。負債の ID → 借入額から principal・毎月の返済額から payment・今の残高から balance）。画面の見せ方と逆算の
   * 決まりだけで、計算の要求には入れない。無いローンは「借入額から」
   */
  loanEntry?: Record<string, LoanEntry>;
  /**
   * 前提と推定の一覧で「お客さまと確かめた」記録（0070。プランごと: 現状は "current"、プランはプランの ID → 一覧の行の印 → 確かめた日と
   * メモ）。画面の側の値で、計算の要求には入れない
   */
  agreed?: Record<string, Record<string, { on: string; note?: string }>>;
  /**
   * 年金の入れ方を切り替えたときに残した前の記録（0066。構成員の ID → 入れ方〔書類から・加入歴から〕ごとに1件）。「推計」に戻しても
   * 書類の数字を消さず、その入れ方に戻すと戻る（隠すだけで消さない）。画面の側の値で、計算の要求には入れない
   */
  pensionKept?: Record<string, PensionRecord[]>;
  /**
   * 基本生活費の内訳を分けた行の額（0109。livingParts.ts）: 事務所の並べ方で1つの内訳を分けた行（食費の自炊・外食など）の名前と月額。
   * 内訳の要素の ID（プランは「プランの ID:要素の ID」）→ 分けた行。計算には使わない（計算は内訳の額）。世帯ファイルでは拡張領域
   * ext.official.livingParts に置く（store/body.ts。household の区画には入れない）。分けていなければ欄を持たない
   */
  livingParts?: Record<string, LivingPart[]>;
  /**
   * 確かめの一覧の「次回確かめる」の印（0072。形式の版 0.29 から。recheck.ts）。行の ID・付けたときのカードと見出し・付けた日。
   * 画面の側の値で、計算の要求には入れない
   */
  recheck?: RecheckMark[];
  /**
   * 確かめの注意の「確認した」の印（形式の版 0.35 から。noticeAck.ts）: 注意の ID・確認したときの中身（注意を作った物の ID）・確認した日。
   * 同じ中身のあいだは、その注意を確かめの一覧に出さない。画面の側の値で、計算の要求には入れない。印が無ければ欄を持たない
   */
  noticeAcks?: NoticeAck[];
  /**
   * 入力項目の選び方（形式の版 0.34 から。itemChoice.ts）: 入力のホームに出さない入力項目と、開いたときの入れ方（標準／詳細）。
   * 見せ方だけの画面の側の値で、計算の要求には入れない。決めていなければ欄を持たない
   */
  itemChoice?: ItemChoice;
  /**
   * 拡張の束の入力欄の値（0114 の4。入力欄の key〔ext.<作成者>.<名前>〕→ 宣言の path のとおりの対）。世帯ファイルでは拡張領域 ext に置く
   * （store/body.ts が行き来する。household の区画には書かない）。合算BS の会社の入力は ext.official.combinedBs（形式 0.57 から。0.50〜0.56 は
   * household.companyBs）。画面の側の値で、計算の要求には入れない。何も無ければ欄を持たない
   */
  extValues?: Record<string, ExtValue>;
  /**
   * 案（0008 の5 のプランの層の「提案」）。現状からの差分だけを持ち、数に上限は付けない。保存の回で世帯ファイル（0011）の
   * 世帯データの proposals に入れる（いまは画面の中で持ち、アプリを閉じると消える）
   */
  proposals: Proposal[];
  /** ヒアリングシートの依頼・取り込み・同意の下書きの記録（0018。保存の回で世帯ファイルの取り込みの記録・同意の記録に入れる） */
  hearing?: HearingLog;
  /**
   * 開いたときの知らせ（0035 の8。世帯ファイルの形式を上げた段が書く。例: 親・祖父母を世帯の外の家族にした）。画面は1回見せ、
   * FP が押したら消す
   */
  notices?: HouseholdNotice[];
  /**
   * 控え（0009 の2。PDF を書き出した時点・FP が残した時点の写し）。作った後は変えない。世帯ファイルでは本文の区画 snapshots に置く
   * （App.tsx の bodyFor。household の区画には入れない）。元に戻す・やり直すの対象にしない
   */
  snapshots?: Snapshot[];
  /**
   * 明細の取り込みの記録（0034。口座・カードの呼び名と持ち主、取り込んだ行（番号を消した後）と FP が決めたこと、世帯の決まり）。
   * 世帯ファイルでは本文の区画 statements に置く（形式の版 0.14 から。確認シートの依頼の記録は 0.15 から、店ごとにまとめた行は 0.16 から）。元のファイルは持たない。元に戻す・やり直すの対象にしない
   */
  statements?: StatementLog;
  /**
   * 他のソフトからの移行の取り込みの記録（0113 の10。読み手・規則・辞書の版、伏せ字の後の抽出結果、参照値、移行メモ、移行元の数え方）。
   * 世帯ファイルでは本文の区画 migrations に置く（形式の版 0.56 から）。元のファイルは持たない。元に戻す・やり直すの対象にしない
   */
  migrations?: MigrationLog;
}

/** ローンの入れ方の区分（0052） */
export type LoanEntry = "principal" | "payment" | "balance";

/** FP が足した項目（今あるデータの型の物1件を、別のカードにする） */
export interface AddedItem {
  /** カードの ID（`added:` で始まる） */
  id: string;
  kind: "periodic" | "care" | "car" | "fee";
  /** 世帯の中の物の ID */
  ref: string;
  /** イラストの種類（足すときに選んだひな形） */
  art: "pet" | "abroad" | "events" | "car" | "fee";
}

/** 新しい物の ID（UUID 第4版。0004） */
export function newId(): string {
  return crypto.randomUUID();
}

export function confirmedBox(value: number): Box<number> {
  return { value, state: "confirmed", origin: { kind: "manual" } };
}

/** 統計などで補った値（0008 の2 の「推定」。自動で入った値なので出どころは auto） */
export function estimatedBox(value: number, basis: string): Box<number> & { estimate: { method: string; basis: string } } {
  return { value, state: "estimated", origin: { kind: "auto" }, estimate: { method: "statistic", basis } };
}

/** 目安のボタン・標準の値で入れた値（0035 の3 の推定の出し方 standard。「印の無い決まった値」にしない。0041） */
export function standardBox(value: number, basis: string): Box<number> & { estimate: { method: string; basis: string } } {
  return { value, state: "estimated", origin: { kind: "auto" }, estimate: { method: "standard", basis } };
}

/**
 * 目安のボタンの値の根拠の文。what が事務所の推定の値の根拠の文そのもの（0111）なら、包まずにそのまま（事務所の値から作った推定を、
 * 根拠の文が完全に同じかで見分けるため）
 */
export const presetBasis = (what: string): string => (isOfficeBasisText(what) ? what : `目安のボタンの値（${what}。この世帯に合わせて直してください）`);

/** 根拠の文を包む（事務所の推定の値の根拠の文そのものなら包まない。presetBasis と同じ決まり） */
export const wrapBasis = (basis: string, wrap: (b: string) => string): string => (isOfficeBasisText(basis) ? basis : wrap(basis));

export function boxBasis(b: Box<number> | undefined | null): string | null {
  if (b == null || b.state !== "estimated") return null;
  return (b as { estimate?: { basis?: string } }).estimate?.basis ?? "推定";
}

/** 世帯の要求を変える（元の値は変えない） */
export function mutate(wh: WorkingHousehold, fn: (h: Household, req: EngineRequest) => void): WorkingHousehold {
  const request = structuredClone(wh.request);
  fn(request.input.household, request);
  return { ...wh, request };
}

/**
 * 並びの要素に ID を振った要求（0035 の5。ID の無い要素が無ければそのまま）。`random` は画面で新しく足した要素（乱数の ID）、
 * 省くと ID の無い古いデータ（場所から決まった ID）
 */
export function withElementIds(request: EngineRequest, random = false): EngineRequest {
  const input = request.input as unknown as Record<string, unknown>;
  if (!lacksElementIds(input)) return request;
  const out = structuredClone(request);
  giveElementIds(out.input as unknown as Record<string, unknown>, random ? randomId : undefined);
  return out;
}

export function memberById(wh: WorkingHousehold, id: string): Member | undefined {
  return wh.request.input.household.members.find((m) => m.id === id);
}

export function periodsOf(h: Household, memberId: string): EmploymentPeriod[] {
  return (h.employmentPeriods ?? []).filter((e) => e.member === memberId).sort((a, b) => ((a.from.at ?? "") < (b.from.at ?? "") ? -1 : 1));
}

const MAIN_JOB = new Set(["regular", "civilServant", "executive", "contract"]);
const AFTER_JOB = new Set(["contract", "partTime", "selfEmployed"]);

/**
 * 世帯の働き方の期間から、定年後の予定を読み取る（入力画面ができる前の世帯・モデル世帯のため）。
 * 今の勤め先（正社員・公務員・役員・契約）の期間の終わりを定年とし、その次に続く期間（契約・パート・自営）があればその条件を写す
 */
export function inferPostRetirement(h: Household, member: Member): PostRetirement | null {
  const ps = periodsOf(h, member.id);
  const mainIdx = ps.findIndex((p, i) => MAIN_JOB.has(p.type) && p.to?.at !== undefined && (i === ps.length - 1 || AFTER_JOB.has((ps[i + 1] as EmploymentPeriod).type)));
  const main = ps[mainIdx];
  if (main?.to?.at === undefined) return null;
  const age = ageAt(member, addMonths(main.to.at, 1));
  if (age < 50 || age > 75) return null;
  const next = ps[mainIdx + 1];
  if (next === undefined || next.from.at !== addMonths(main.to.at, 1)) return { fromAge: age, type: null, annualSalary: null };
  const type = next.type as PostRetirement["type"];
  const salary = type === "selfEmployed" ? next.business?.income.value : next.salary?.annual.value;
  // 標準報酬月額は FP が入れた値だけを写す（推定のままの額を写すと、定年後の期間を作り直すときに確定の額として書いてしまう。0047 の追記 2026-10-29 の2）
  const smr = isAutoSmr(next.standardMonthlyRemuneration) ? undefined : next.standardMonthlyRemuneration?.pension.value;
  return { fromAge: age, type, annualSalary: salary ?? null, ...(smr != null ? { standardMonthlyRemuneration: smr } : {}) };
}

/** 主画面の打ち手（働く最後の年齢）に渡す形 */
export function reemploymentOf(p: PostRetirement | undefined): Reemployment | undefined {
  if (p === undefined || p.type === null || p.annualSalary === null) return undefined;
  return { fromAge: p.fromAge, type: p.type, annualSalary: p.annualSalary, ...(p.standardMonthlyRemuneration !== undefined ? { standardMonthlyRemuneration: p.standardMonthlyRemuneration } : {}) };
}

/** 世帯の要求から、画面の中で編集する世帯を作る */
export function fromRequest(request0: EngineRequest, extras: { memo?: string[]; postRetirement?: Record<string, PostRetirement> } = {}): WorkingHousehold {
  const request = withElementIds(request0);
  const h = request.input.household;
  const post: Record<string, PostRetirement> = {};
  for (const m of h.members) {
    if (m.kind !== "self" && m.kind !== "spouse") continue;
    const p = extras.postRetirement?.[m.id] ?? inferPostRetirement(h, m);
    if (p !== null) post[m.id] = p;
  }
  return { request, labelsByMember: {}, postRetirement: post, memo: extras.memo ?? [], assumed: {}, contingency: planFromRequest(request), addedItems: [], confirmed: [], proposals: [] };
}

/** 計算の要求のうち、世帯ごとに変わらない部分の既定（前提条件は事務所の標準値ができるまでの仮の値。0008 の8） */
export const DEFAULT_ASSUMPTIONS = {
  investmentReturn: { default: "0.01" },
  wageGrowth: { default: "0.01" },
  inflation: { default: "0.01" },
  pensionMacroSlide: { default: "0.004" },
};

/**
 * 推定と呼ばない欄の仮の印のキーか: 性別（家族・世帯の外の家族）。性別は推定するものではないので、足すときに初めの値を普通の値として入れ、
 * 推定・仮の印（「この値にする」「推定に戻す」）を付けない。前の版の画面で付けた印が世帯ファイルに残っていれば、読むときに外す（withoutPlainMarks）
 */
export const isPlainValueKey = (key: string): boolean => /^family\/[^/]+\/sex$/.test(key);

/** 推定と呼ばない欄の値の状態の欄の行（構成員の性別の推定の行）か */
const isPlainValueState = (k: string, row: unknown): boolean =>
  k === "member.sex" && typeof row === "object" && row !== null && (row as { state?: unknown }).state === "estimated";

/**
 * 推定と呼ばない欄（性別）の仮の印と推定の行を外した世帯（読むときに使う。値はそのまま。世帯ファイルの形は変えない）。
 * 外す物が無ければ同じ世帯を返す
 */
export function withoutPlainMarks(wh: WorkingHousehold): WorkingHousehold {
  type WithStates = { valueStates?: Record<string, unknown> };
  const marked = Object.keys(wh.assumed).some(isPlainValueKey);
  const rows = wh.request.input.household.members.some((m) => Object.entries((m as WithStates).valueStates ?? {}).some(([k, v]) => isPlainValueState(k, v)));
  if (!marked && !rows) return wh;
  const assumed = marked ? Object.fromEntries(Object.entries(wh.assumed).filter(([k]) => !isPlainValueKey(k))) : wh.assumed;
  const next = rows
    ? mutate(wh, (h) => {
        for (const m of h.members as WithStates[]) {
          const states = m.valueStates;
          if (states === undefined) continue;
          for (const [k, v] of Object.entries(states)) if (isPlainValueState(k, v)) delete states[k];
          if (Object.keys(states).length === 0) delete m.valueStates;
        }
      })
    : wh;
  return { ...next, assumed };
}

/** 空の世帯（本人だけ）。生年月は仮の値で、FP が入れ直すまで「仮」の印を出す。性別は推定するものではないので、初めの値を普通の値として入れる（印を付けない） */
export function blankHousehold(baseMonth: string, id: () => string = newId): WorkingHousehold {
  const selfId = id();
  const { y } = parseYm(baseMonth);
  const self: Member = { id: selfId, kind: "self", birth: { birthYearMonth: `${y - 40}-04`, bornOnFirst: false }, sex: "male", joins: null, leaves: null, expected: false };
  const request: EngineRequest = {
    trace: "none",
    input: {
      baseMonth,
      endYear: endYearForAge({ members: [self] } as Household, defaultEndAge()),
      calcConventions: { aggregation: "cash", investmentTiming: "midYear", compatibility: null },
      household: { members: [self], relations: [], events: [], employmentPeriods: [], accounts: [], insuranceContracts: [], livingExpenses: [] },
      assumptions: structuredClone(DEFAULT_ASSUMPTIONS),
    },
  };
  // 基本生活費は統計の目安（推定）と、推定の段階（退職・70歳・80歳。家族を足すと子の誕生・独立なども）から始める（空欄でも計算できるように。0049）
  request.input.household.livingExpenses = [startLiving(request.input.household, baseMonth, request.input.endYear, id())];
  return {
    request,
    labelsByMember: {},
    postRetirement: {},
    memo: [],
    assumed: { [`family/${selfId}/birth`]: "仮の値（40歳として計算）" },
    contingency: emptyPlan(),
    addedItems: [],
    confirmed: [],
    proposals: [],
  };
}

/** 表を何歳の年まで見るかの選び方（若い方の大人〔本人・配偶者〕がこの年齢になる年まで。0070 の追記 2026-11-05） */
export const END_AGES: readonly number[] = [90, 95, 100, 105];

/** 提供元の既定の年齢（若い方の大人が100歳になる年まで。0008 の3） */
export const STANDARD_END_AGE = 100;

/** 表の最後の年の既定の年齢: 事務所の既定値で選んでいればその年齢（0073 の追記 2026-11-05）、無ければ100歳 */
export const defaultEndAge = (): number => officeNow().endAge ?? STANDARD_END_AGE;

/** 若い方の大人（本人・配偶者）がその年齢になる年（子は含めない。大人がいなければ -Infinity） */
export function endYearForAge(h: Pick<Household, "members">, age: number): number {
  const adults = h.members.filter((m) => m.kind === "self" || m.kind === "spouse");
  return Math.max(...adults.map((m) => parseYm(ageReachedMonth(m, age)).y));
}

/** 表の最後の年: 一番若い大人（本人・配偶者）が既定の年齢（100歳か事務所の既定値の年齢）になる年まで（0008 の3 の標準）。子は含めない */
export function standardEndYear(h: Household): number {
  return endYearForAge(h, defaultEndAge());
}

/** 表の最後の年が、選び方の年齢（90・95・100・105歳）のどれかになる年なら、その年齢。どれでもなければ null */
export function endAgeOf(h: Pick<Household, "members">, endYear: number): number | null {
  return END_AGES.find((a) => endYearForAge(h, a) === endYear) ?? null;
}

const endYearPinned = (req: EngineRequest): boolean => (req.input as { valueStates?: Record<string, { state?: string }> }).valueStates?.["plan.endYear"]?.state === "confirmed";

/**
 * 家族を直したときに表の最後の年が付いていく年齢（0070 の追記 2026-11-05）: 確定していない表の最後の年が、選び方の年齢（90・95・100・105歳。
 * 既定の100歳を含む）のどれかになる年なら、その年齢（家族を直した後も、若い方がその年齢になる年にする）。選び方の外の年（人が年で入れた年）・
 * 確定した年は null（変えない）
 */
export function followedEndAge(req: EngineRequest): number | null {
  if (endYearPinned(req)) return null;
  return endAgeOf(req.input.household, req.input.endYear);
}

/**
 * アプリの見本の世帯を開くときの要求: 表の最後の年を標準（standardEndYear）にそろえる。
 * 見本の元のモデル世帯は、計算の確かめ・速さの計測にも使うので表の長さがまちまち（100年分の表など）で、そのまま開くと
 * 表が本人129歳まで続き、前提条件の標準の年とも食い違っていた。保存した世帯（見本を開いて保存した写しも）はこれを通さない（黙って書き換えない）
 */
export function sampleRequest(req: EngineRequest): EngineRequest {
  const std = standardEndYear(req.input.household);
  if (!Number.isFinite(std) || req.input.endYear === std) return req;
  const out = structuredClone(req);
  out.input.endYear = std;
  return out;
}

/** 子の独立の標準の年齢（子を足したときの初めの値） */
export const CHILD_LEAVES_AGE = 22;

/** 子の独立の前の標準の時点: 22歳になる月（年月で持っていた古い世帯の子が、まだ標準のままかを見分けるのに使う） */
export const standardLeaves = (child: Member): string => ageReachedMonth(child, CHILD_LEAVES_AGE);

/**
 * 子の独立の標準（新しく足す子と「標準に戻す」を押した子）: 22歳になった後の最初の3月末の翌月（大学を出る年度末の翌月＝22歳の後の最初の4月）。
 * 年齢の時点で持つので、生年月を直すと合わせて動く（追いかけが要らない）
 */
export const standardLeavesPoint = (childId: string): Timepoint => ({ memberAge: { member: childId, years: CHILD_LEAVES_AGE, ageSwitch: "schoolYear" } });

/** 子の独立の標準の根拠の文（仮の印） */
export const LEAVES_BASIS = "既定（最後の学校を出た翌月の4月。大学なら22歳の後の最初の4月）";

/**
 * 子の独立が、最後の学校の終わりに合わせて決める形（その子の年齢・学年の区切りの時点。standardLeavesPoint の形）か。
 * 年月・出来事・ずらしで入れた独立と「独立しない」（null）は、FP が入れた値として合わせない
 */
export function isSchoolLinkedLeaves(m: Member): boolean {
  const t = m.leaves;
  if (t === undefined) return true;
  if (t === null) return false;
  const a = t.memberAge;
  return a !== undefined && a.member === m.id && a.ageSwitch === "schoolYear" && (a.months ?? 0) === 0 && t.at === undefined && t.event === undefined && t.offset === undefined;
}

/**
 * 標準の値を追いかける（0008 の追記 2026-10-25）: 家族の生年月・続柄を変えた・家族を足した・外した後に、
 * 変える前に標準の値のままだった値（表の最後の年・子の独立の年月）を、変えた後の標準の値に入れ直す。
 * 「人が入れた値か、まだ標準の値か」は世帯データに持たないので、今の値が変える前の標準の値と同じなら標準の値とみなす。
 * 標準と違う値（人が入れた値）と、この変更そのものが書き換えた値は変えない。表の最後の年は、選び方の年齢（90・95・100・105歳）の年のままなら
 * その年齢のまま付いていく（既定の100歳だけでなく、95歳を選んだ世帯も95歳のまま。0070 の追記 2026-11-05）
 */
export function followStandards(before: WorkingHousehold, after: WorkingHousehold): WorkingHousehold {
  const hb = before.request.input.household;
  const ha = after.request.input.household;
  const endBefore = before.request.input.endYear;
  // 表の最後の年は、選び方の年齢（既定の100歳を含む）の年のままなら、その年齢のまま付いていく（0070 の追記 2026-11-05）
  const age = followedEndAge(before.request);
  const stdAfter = age === null ? Number.NaN : endYearForAge(ha, age);
  const fixEnd = age !== null && Number.isFinite(stdAfter) && after.request.input.endYear === endBefore && stdAfter !== endBefore;
  // 独立の時点が子の独立の出来事を指している（出来事が正本。0038）なら、出来事の年月を見る
  const leavesAt = (h: Household, m: Member): Timepoint | null | undefined => {
    const t = m.leaves;
    if (t?.event === undefined || (t.offset?.years ?? 0) * 12 + (t.offset?.months ?? 0) !== 0) return t;
    return (h.events ?? []).find((e) => e.id === t.event)?.at;
  };
  const kids: { id: string; at: string; event?: string }[] = [];
  for (const m of ha.members) {
    const old = hb.members.find((x) => x.id === m.id);
    if (old === undefined || old.kind !== "child" || m.kind !== "child") continue;
    const was = leavesAt(hb, old)?.at;
    if (was === undefined || was !== standardLeaves(old) || JSON.stringify(m.leaves) !== JSON.stringify(old.leaves) || JSON.stringify(leavesAt(ha, m)) !== JSON.stringify(leavesAt(hb, old))) continue;
    const next = standardLeaves(m);
    if (next !== was) kids.push({ id: m.id, at: next, ...(m.leaves?.event !== undefined ? { event: m.leaves.event } : {}) });
  }
  if (!fixEnd && kids.length === 0) return after;
  return mutate(after, (h, req) => {
    if (fixEnd) req.input.endYear = stdAfter;
    for (const k of kids) {
      const e = k.event === undefined ? undefined : (h.events ?? []).find((x) => x.id === k.event);
      if (e !== undefined) e.at = { at: k.at };
      else {
        const m = h.members.find((x) => x.id === k.id);
        if (m !== undefined) m.leaves = { at: k.at };
      }
    }
  });
}
