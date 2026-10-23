// 画面の中で編集する世帯（作業の層）。計算エンジンに渡す要求（0008 の形の世帯と前提条件）と、
// エンジンに渡さない画面の側の値（FP が付ける呼び名・定年後の予定の条件・FP用のメモ・万一の想定の前提・FPが足した項目・保存した項目）を1つにまとめる。
// 保存・暗号化はまだ無い（次の回。世帯ファイルの封筒 0011 に入れる）。アプリを閉じると消える
import type { Box, EmploymentPeriod, EngineRequest, Household, Member } from "../../engine/types.ts";
import { addMonths, ageAt, ageReachedMonth, parseYm, type Reemployment } from "../levers.ts";
import { emptyPlan, planFromRequest, type ContingencyPlan } from "../contingency/planData.ts";
import { livingEstimate } from "./estimates.ts";
import type { Proposal } from "../plans/plans.ts";
import type { HearingLog } from "../hearing/sheet.ts";
import type { StatementLog } from "../../../../statement/src/index.ts";
import type { Snapshot } from "../snapshots/snapshots.ts";

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
   * 案（0008 の5 のプランの層の「提案」）。現状からの差分だけを持ち、数に上限は付けない。保存の回で世帯ファイル（0011）の
   * 世帯データの proposals に入れる（いまは画面の中で持ち、アプリを閉じると消える）
   */
  proposals: Proposal[];
  /** ヒアリングシートの依頼・取り込み・同意の下書きの記録（0018。保存の回で世帯ファイルの取り込みの記録・同意の記録に入れる） */
  hearing?: HearingLog;
  /**
   * 控え（0009 の2。PDF を書き出した時点・FP が残した時点の写し）。作った後は変えない。世帯ファイルでは本文の区画 snapshots に置く
   * （App.tsx の bodyFor。household の区画には入れない）。元に戻す・やり直すの対象にしない
   */
  snapshots?: Snapshot[];
  /**
   * 明細の取り込みの記録（0034。口座・カードの呼び名と持ち主、取り込んだ行（番号を消した後）と FP が決めたこと、世帯の決まり）。
   * 世帯ファイルでは本文の区画 statements に置く（形式の版 0.14 から）。元のファイルは持たない。元に戻す・やり直すの対象にしない
   */
  statements?: StatementLog;
}

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
  const smr = next.standardMonthlyRemuneration?.pension.value;
  return { fromAge: age, type, annualSalary: salary ?? null, ...(smr != null ? { standardMonthlyRemuneration: smr } : {}) };
}

/** 主画面の打ち手（働く最後の年齢）に渡す形 */
export function reemploymentOf(p: PostRetirement | undefined): Reemployment | undefined {
  if (p === undefined || p.type === null || p.annualSalary === null) return undefined;
  return { fromAge: p.fromAge, type: p.type, annualSalary: p.annualSalary, ...(p.standardMonthlyRemuneration !== undefined ? { standardMonthlyRemuneration: p.standardMonthlyRemuneration } : {}) };
}

/** 世帯の要求から、画面の中で編集する世帯を作る */
export function fromRequest(request: EngineRequest, extras: { memo?: string[]; postRetirement?: Record<string, PostRetirement> } = {}): WorkingHousehold {
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

/** 空の世帯（本人だけ）。生年月・性別は仮の値で、FP が入れ直すまで「仮」の印を出す */
export function blankHousehold(baseMonth: string, id: () => string = newId): WorkingHousehold {
  const selfId = id();
  const { y } = parseYm(baseMonth);
  const self: Member = { id: selfId, kind: "self", birth: { birthYearMonth: `${y - 40}-04`, bornOnFirst: false }, sex: "male", joins: null, leaves: null, expected: false };
  const request: EngineRequest = {
    trace: "none",
    input: {
      baseMonth,
      endYear: parseYm(ageReachedMonth(self, 100)).y,
      calcConventions: { aggregation: "cash", investmentTiming: "midYear", compatibility: null },
      household: { members: [self], relations: [], events: [], employmentPeriods: [], accounts: [], insuranceContracts: [], livingExpenses: [] },
      assumptions: structuredClone(DEFAULT_ASSUMPTIONS),
    },
  };
  // 基本生活費は統計の目安（推定）から始める（空欄でも計算できるように）
  const living = livingEstimate(request.input.household, baseMonth);
  request.input.household.livingExpenses = [{ id: id(), mode: "total", monthly: estimatedBox(living.value, living.basis) }];
  return {
    request,
    labelsByMember: {},
    postRetirement: {},
    memo: [],
    assumed: { [`family/${selfId}/birth`]: "仮の値（40歳として計算）", [`family/${selfId}/sex`]: "仮の値" },
    contingency: emptyPlan(),
    addedItems: [],
    confirmed: [],
    proposals: [],
  };
}

/** 表の最後の年: 一番若い大人（本人・配偶者）が100歳になる年まで（0008 の3 の標準）。子は含めない */
export function standardEndYear(h: Household): number {
  const adults = h.members.filter((m) => m.kind === "self" || m.kind === "spouse");
  return Math.max(...adults.map((m) => parseYm(ageReachedMonth(m, 100)).y));
}
