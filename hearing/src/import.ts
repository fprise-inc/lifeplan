// 記入済みのシート（回答の一覧）を世帯データ（0008）に取り込む。
// - 読んだ値は、シート定義の変換表（項目キー → 入力項目ID）で世帯データの欄に写し、出どころ「ヒアリング」の値の箱にする（0008 の2）
// - 物ごとに候補（0008 の5。op: add）にする。FP が承認するまで現状に効かない。request は「すべての候補を承認したとき」の世帯
// - 不足（計算に要る欄が空）・矛盾・読めない値を知らせ、面談のチェックリストに載せる（「わからない」も載せる。0018 の6）
// - 空欄・「わからない」を目安で補った欄には、入力の画面の「推定あり」（0008 の 2026-10-11 の追記の2）と同じ印を付ける:
//   値の箱を持つ欄は state: estimated（わからないは unknown＋substitute）、値の箱を持たない欄は assumed（欄のキー → 理由）
import full5 from "../sheets/full/5.json" with { type: "json" };
import { answerKey, type Answer, type FilledSheet } from "./answers.ts";
import { axisOf, itemByKey, type SheetDefinition, type SheetItem } from "./definition.ts";
import { bonusShareEstimate, businessEstimate, careerStartMonth, fillsByEstimate, HEARING_UNKNOWN_BASIS, NOT_FILLED_BASIS, healthRateEstimate, livingEstimate, residentTaxEstimate, residentTaxYear, retirementLumpSumEstimate, salaryEstimate, type Estimate } from "./estimates.ts";
import { currentMortgageRateEstimate, pctText, provisionalNewType } from "./housingEstimates.ts";
import { issue, type Issue } from "./issues.ts";
import { presetNum } from "./presets.ts";
import { monthsFromPayment, principalFromPayment, standardTermMonths } from "./loan.ts";
import { shareOfLand } from "./ownedHome.ts";
import { addMonths, ageAt, reachedMonth, ymIndex } from "./months.ts";
import type {
  Account,
  CareExpense,
  Debt,
  EducationStage,
  EmploymentPeriod,
  EngineRequest,
  Goal,
  Household,
  IncomeFlow,
  InsuranceContract,
  LivingExpense,
  Member,
  PensionRecord,
  PeriodicExpense,
  Relation,
  Residence,
  ResidentTaxAssessment,
  RetirementBenefit,
  SavingsCheck,
  ValueBox,
} from "./types.ts";
import { formatValue, parseValue, rangeEstimate, rateDoubt } from "./values.ts";

export interface ImportOptions {
  /** 計算基準月（"YYYY-MM"） */
  readonly baseMonth: string;
  /** 物の ID を作る（UUID 第4版。省略は crypto.randomUUID） */
  readonly newId?: () => string;
  /**
   * 記入の年月が、お客さまの書いた年月でなく送った月（Web のヒアリング。0125）のとき true。計算基準月より後でも、差が1年までは
   * 知らせない（計算基準月の時点の額として扱うのは同じ）
   */
  readonly filledOnIsSubmission?: boolean;
  /**
   * 分岐の問いの答え（Web のヒアリングだけ。0158）。Excel のシートには無い（省略）。取り込みの部品は世帯を知らないので、形を確かめて
   * 結果（ImportResult.gates）に写すだけ。今の世帯と照らして知らせるのはアプリの側（0139 の追記 2026-11-08）
   */
  readonly gates?: GateAnswersIn;
}

/** 分岐の問い: 配偶者の方がいるか・お子さまの人数・住宅ローンの本数・保険の件数・ご両親のことを答えるか（Web のヒアリング。0158） */
export type GateKind = "spouse" | "child" | "loan" | "policy" | "parent";
export const GATE_KINDS: readonly GateKind[] = ["spouse", "child", "loan", "policy", "parent"];
/** 分岐の問いの答え（配偶者の方・ご両親のことは 1 か 0、ほかは数。お客さまに聞いた問いだけ） */
export type GateAnswersIn = Readonly<Partial<Record<GateKind, number>>>;

/** 候補の中で、どの欄をシートのどの項目から入れたか */
export interface FieldRecord {
  readonly key: string;
  readonly index?: number;
  /** 入力項目ID（0004） */
  readonly item: string;
  /** 物の中の欄の場所（JSON Pointer） */
  readonly path: string;
  /** confirmed（記入どおり）・unknown（わからない＋代わりの値）・notApplicable・estimated（目安で補った）・assumed（値の箱の無い欄を仮の値で補った） */
  readonly state: "confirmed" | "unknown" | "notApplicable" | "estimated" | "assumed";
  readonly review?: readonly string[];
  /** 金額の範囲の答えから作った推定の値のとき、その範囲の段の言葉（state は estimated。値は範囲の真ん中） */
  readonly range?: string;
  /**
   * この欄の項目に答えが無い（空欄・「あとで」・形の違う値・このシートで聞いていない）。値は目安・仮の値・初めの値で補ったもの。
   * 取り込む側は、今の世帯に値があればそれを残す（今の値を空欄・0円・仮の値で上書きしない）
   */
  readonly noAnswer?: true;
  /** 仮の値（state が assumed）のとき、入力の画面の欄のキー（ImportResult.assumed のキー） */
  readonly uiKey?: string;
}

/** 0008 の5 の候補（ヒアリングから来た物の追加） */
export interface Candidate {
  readonly id: string;
  readonly target: { readonly object: string };
  /** 世帯データのどの一覧に足すか */
  readonly collection: keyof Household;
  /** 物の種類を表す入力項目ID */
  readonly item: string;
  readonly op: "add";
  readonly value: unknown;
  /** 一緒に足す関係（構成員のとき） */
  readonly related?: readonly Relation[];
  readonly enabled: true;
  readonly origin: { readonly kind: "hearing"; readonly ref: string };
  readonly source: "hearing";
  readonly sourceRef: string;
  /** 要確認の欄（名前の定義と位置の食い違い・数式など）を含む候補は needsReview（黙って当てはめない） */
  readonly status: "pending" | "needsReview";
  readonly fields: readonly FieldRecord[];
  readonly note: string | null;
}

/** 同意の記録の下書き（0014 の2。FP が取り込みを承認したときに id・日付・説明文の指紋を足して記録にする） */
export interface ConsentDraft {
  readonly kind: "purpose" | "familyInfo" | "externalAi";
  readonly decision: "given" | "refused";
  readonly method: "hearingSheet";
  readonly hearingRef: { readonly requestId: string; readonly sheetId: string; readonly sheetVersion: number };
}

/** 面談のチェックリストの1行 */
export interface ChecklistItem {
  readonly key: string;
  readonly index?: number;
  /** 見出しつきの項目名（例: 配偶者の方 給与の年収） */
  readonly label: string;
  readonly reason: "unknown" | "missing" | "invalid" | "review" | "contradiction";
  readonly message: string;
}

/** 取り込みの記録（0011 の imports の1件の下書き。伏せ字の処理はまだ。元の .xlsx は持たない） */
export interface ImportRecord {
  readonly kind: "hearing";
  readonly requestId: string;
  readonly sheetId: string;
  readonly sheetVersion: number;
  readonly layoutDigest: string;
  readonly exportedOn: string;
  readonly answers: readonly Answer[];
}

export interface ImportResult {
  /**
   * すべての候補を当てはめた計算の要求（新しい世帯）。出どころ「ヒアリング」の値の箱は、FP が承認するまで承認の記録（approval）を
   * 持たないので、このままでは計算エンジンが受け付けない（0008 の2）。承認したら approveAll で承認の記録を付ける
   */
  readonly request: EngineRequest;
  readonly candidates: readonly Candidate[];
  /** 値の箱を持たない欄に入れた仮の値（入力の画面の欄のキー → 理由。WorkingHousehold.assumed と同じ形） */
  readonly assumed: Readonly<Record<string, string>>;
  readonly issues: readonly Issue[];
  readonly checklist: readonly ChecklistItem[];
  readonly consents: readonly ConsentDraft[];
  /** FP 用のメモに入れる文（相談したいこと・学校名・予定など。計算には使わない） */
  readonly memo: readonly string[];
  /** 取り込み保留（知らない項目キー・拡張の項目 ext.*） */
  readonly pending: readonly Answer[];
  readonly record: ImportRecord;
  /**
   * ローンの入れ方の区分（入力の画面の住まい・ローンのカード。負債の ID → 「今の残高から」）。簡易版の残高と毎月の返済額から作った住宅ローンと、
   * 詳細版の会社からの借入金の残高から作った借入。
   * 画面の見せ方と逆算の決まりだけで、計算の要求には入れない
   */
  readonly loanEntry: Readonly<Record<string, "balance">>;
  /**
   * 分岐の問いの答え（Web のヒアリングで届いたものだけ。Excel は無い）。このシートに無い問い・数の範囲の外は捨てる。
   * 世帯の人や行は変えない（「0人」の答えでも今の子を消す候補は作らない。照らして知らせるのはアプリの側）
   */
  readonly gates?: GateAnswersIn;
}

/** 計算の要求のうち、世帯ごとに変わらない部分の既定（app/src/workspace/input/household.ts の DEFAULT_ASSUMPTIONS と同じ） */
export const DEFAULT_ASSUMPTIONS = {
  investmentReturn: { default: "0.01" },
  wageGrowth: { default: "0.01" },
  inflation: { default: "0.01" },
  pensionMacroSlide: { default: "0.004" },
};

/** 範囲の答えから作った値の印（範囲の段の言葉。上が開いた段は下の端を使った） */
interface FromRange {
  readonly label: string;
  readonly openTop: boolean;
}

type Got<T> =
  | { readonly status: "value"; readonly value: T; readonly review?: readonly string[]; readonly range?: FromRange }
  | { readonly status: "blank" | "unknown" | "notApplicable" | "invalid" };

const SALARIED = new Set(["regular", "contract", "partTime", "civilServant", "executive"]);
const MAIN_JOB = new Set(["regular", "contract", "civilServant", "executive"]);

/** シートの外の項目キーの表示名（簡易版のシートで聞かない欄を補ったときの知らせ・面談のチェックリストに使う。詳細版の今の版の言葉） */
const FALLBACK = full5 as unknown as SheetDefinition;
const FALLBACK_ITEMS = itemByKey(FALLBACK);

/** 項目キーの表示名（シート定義に無い項目は詳細版の言葉。どちらにも無ければキーのまま） */
export function keyLabel(def: SheetDefinition, key: string): string {
  return def.items.find((i) => i.key === key)?.label ?? FALLBACK_ITEMS.get(key)?.label ?? key;
}

/** シートで聞いていない項目の不足の知らせに添える文 */
const NOT_ASKED = "（このシートではお聞きしていません。面談で確かめてください）";

/** 範囲の答えの根拠の文 */
export const rangeBasis = (r: FromRange): string => `ヒアリングシートの範囲 ${r.label}${r.openTop ? "（上が開いた範囲なので下の端）" : "の真ん中"}`;

class Ctx {
  readonly issues: Issue[] = [];
  readonly checklist: ChecklistItem[] = [];
  readonly assumed: Record<string, string> = {};
  readonly pending: Answer[] = [];
  readonly memo: string[] = [];
  readonly consents: ConsentDraft[] = [];
  readonly candidates: Candidate[] = [];
  readonly loanEntry: Record<string, "balance"> = {};
  private readonly got = new Map<string, Got<number | string>>();
  private readonly items: Map<string, SheetItem>;
  private readonly fields = new Map<string, FieldRecord[]>();
  /** 読み替え（取り込みの手順が読む項目キー → 値を出したシートの項目キー）。簡易版の合計・範囲の答えなど */
  private readonly source = new Map<string, { key: string; index?: number }>();
  readonly ref: string;
  readonly def: SheetDefinition;
  readonly filled: FilledSheet;
  readonly newId: () => string;

  constructor(def: SheetDefinition, filled: FilledSheet, newId: () => string) {
    this.def = def;
    this.filled = filled;
    this.newId = newId;
    this.items = itemByKey(def);
    this.ref = filled.management.requestId;
    for (const a of filled.answers) this.read(a);
    this.fromRanges();
  }

  has(key: string): boolean {
    return this.items.has(key);
  }

  item(key: string): SheetItem {
    const it = this.items.get(key);
    if (it === undefined) throw new Error(`シート定義に無い項目: ${key}`);
    return it;
  }

  /** 読み替えをたどって、値を出したシートの項目 */
  src(key: string, index?: number): { key: string; index?: number } {
    let at: { key: string; index?: number } = { key, ...(index !== undefined ? { index } : {}) };
    for (let n = 0; n < 5; n++) {
      const s = this.source.get(answerKey(at.key, at.index));
      if (s === undefined) break;
      at = s;
    }
    return at;
  }

  /**
   * 取り込みの手順が読む項目（to）を、シートの別の項目（from）で読む: 値・状態を写し、知らせ・欄の記録は from の項目で出す。
   * from がシートに無ければ何もしない
   */
  alias(to: string, toIndex: number | undefined, from: string, fromIndex: number | undefined): void {
    if (!this.items.has(from)) return;
    const g = this.got.get(answerKey(from, fromIndex)) ?? { status: "blank" };
    this.got.set(answerKey(to, toIndex), g);
    this.source.set(answerKey(to, toIndex), { key: from, ...(fromIndex !== undefined ? { index: fromIndex } : {}) });
  }

  /** 見出しつきの項目名 */
  label(key: string, index?: number): string {
    const s = this.src(key, index);
    const def = this.items.has(s.key) ? this.def : FALLBACK;
    const it = this.items.get(s.key) ?? FALLBACK_ITEMS.get(s.key);
    const axis = axisOf(def, s.key);
    const head = axis !== null && s.index !== undefined ? `${axis.labels[s.index - 1] ?? `${s.index}番目`} ` : "";
    return `${head}${it?.label ?? s.key}`;
  }

  /** 知らせ・チェックリストの場所（読み替えた先のシートの項目） */
  at(key: string, index?: number): { key: string; index?: number } {
    return this.src(key, index);
  }

  private read(a: Answer): void {
    const it = this.items.get(a.key);
    if (it === undefined) {
      this.pending.push(a);
      this.issues.push(issue("info", "H_UNKNOWN_KEY", `シート定義に無い項目（${a.key}）は取り込み保留にしました`, a));
      return;
    }
    const at = { key: a.key, ...(a.index !== undefined ? { index: a.index } : {}) };
    const k = answerKey(a.key, a.index);
    if (a.status === "value") {
      if (a.raw === undefined) {
        this.got.set(k, { status: "blank" });
        return;
      }
      const p = parseValue(this.def, it, a.raw, a.raw2);
      if (!p.ok) {
        this.got.set(k, { status: "invalid" });
        this.issues.push(issue("error", "H_INVALID_VALUE", `${this.label(a.key, a.index)}: ${p.reason}（取り込みませんでした）`, at));
        this.check(a.key, a.index, "invalid", p.reason);
        return;
      }
      const review = [...(a.review ?? [])];
      // 率の欄のあり得る範囲より小さい値（% で打った値が 100分の1 で読まれた疑い）は、知らせて要確認にする（黙って使わない）
      const doubt = typeof p.value === "string" ? rateDoubt(it, p.value) : null;
      if (doubt !== null) {
        review.push(doubt);
        this.issues.push(issue("warning", "H_RATE_DOUBT", `${this.label(a.key, a.index)}: ${doubt}（要確認にしました）`, at));
      }
      this.got.set(k, { status: "value", value: p.value, ...(review.length > 0 ? { review } : {}) });
      if (review.length > 0) this.check(a.key, a.index, "review", review.join("・"));
      return;
    }
    if ((a.status === "unknown" || a.status === "notApplicable") && !it.states.includes(a.status)) {
      this.issues.push(issue("warning", "H_STATE_NOT_ALLOWED", `${this.label(a.key, a.index)}: 「${a.status === "unknown" ? "わからない" : "該当なし"}」は選べない項目です（空欄として扱いました）`, at));
      this.got.set(k, { status: "blank" });
      return;
    }
    this.got.set(k, { status: a.status });
    if (a.status === "unknown") {
      const doc = DOC_CHECK_ITEMS[a.key];
      this.check(a.key, a.index, "unknown", doc !== undefined ? `わからない（書類で確かめる: ${doc}）` : "わからない");
    }
  }

  /**
   * 範囲の答え（moneyRange）: 金額の項目が空欄か「わからない」なら、範囲の真ん中（上が開いた段は下の端）を金額の項目の値として読む。
   * 値の箱には推定（確かさ「概算」）として入れ、確定にしない（box）。金額と範囲の両方があれば金額を使う
   */
  private fromRanges(): void {
    for (const r of this.def.items) {
      if (r.type !== "moneyRange" || r.rangeOf === undefined) continue;
      const base = r.rangeOf;
      const count = axisOf(this.def, r.key)?.count;
      for (let n = 1; n <= (count ?? 1); n++) {
        const index = count === undefined ? undefined : n;
        const g = this.get<string>(r.key, index);
        if (g.status !== "value") continue;
        const e = rangeEstimate(r, g.value);
        if (e === null) continue;
        const cur = this.get(base, index);
        if (cur.status === "value") {
          this.issues.push(issue("info", "H_IGNORED", `${this.label(r.key, index)}: 金額の記入があるので、範囲（${e.label}）は使いませんでした`, { key: r.key, ...(index !== undefined ? { index } : {}) }));
          continue;
        }
        if (cur.status === "notApplicable" || cur.status === "invalid") {
          this.contradiction(r.key, index, `${cur.status === "notApplicable" ? "「該当なし」" : "読めない金額"}と範囲（${e.label}）の両方があります（範囲は使いませんでした）`);
          continue;
        }
        this.got.set(answerKey(base, index), { status: "value", value: e.value, ...(g.review !== undefined ? { review: g.review } : {}), range: { label: e.label, openTop: e.openTop } });
        this.source.set(answerKey(base, index), { key: r.key, ...(index !== undefined ? { index } : {}) });
      }
    }
  }

  check(key: string, index: number | undefined, reason: ChecklistItem["reason"], message: string): void {
    const s = this.src(key, index);
    const text = reason === "missing" && !this.items.has(s.key) ? `${message}${NOT_ASKED}` : message;
    this.checklist.push({ key: s.key, ...(s.index !== undefined ? { index: s.index } : {}), label: this.label(key, index), reason, message: text });
  }

  get<T extends number | string>(key: string, index?: number): Got<T> {
    return (this.got.get(answerKey(key, index)) ?? { status: "blank" }) as Got<T>;
  }

  value<T extends number | string>(key: string, index?: number): T | null {
    const g = this.get<T>(key, index);
    return g.status === "value" ? g.value : null;
  }

  /** 範囲の答えから読んだ値か（範囲の段） */
  rangeOf(key: string, index?: number): FromRange | null {
    const g = this.get(key, index);
    return g.status === "value" ? (g.range ?? null) : null;
  }

  /** その項目に何か記入があるか（値・わからない・該当なしのどれか） */
  touched(key: string, index?: number): boolean {
    const g = this.get(key, index);
    return g.status === "value" || g.status === "unknown" || g.status === "invalid";
  }

  /** 不足の知らせ。シートで聞いていない項目（簡易版で詳細版の欄を補ったなど）は知らせだけにして、面談のチェックリストに載せる */
  missing(key: string, index: number | undefined, message: string, level: "error" | "warning" = "warning"): void {
    const s = this.src(key, index);
    const asked = this.items.has(s.key);
    this.issues.push(issue(asked ? level : "info", "H_MISSING", `${this.label(key, index)}: ${message}${asked ? "" : NOT_ASKED}`, s));
    this.check(key, index, "missing", message);
  }

  contradiction(key: string, index: number | undefined, message: string, level: "error" | "warning" = "warning"): void {
    this.issues.push(issue(level, "H_CONTRADICTION", `${this.label(key, index)}: ${message}`, this.src(key, index)));
    this.check(key, index, "contradiction", message);
  }

  /** 欄の記録を物ごとにためる（読み替えた項目は、値を出したシートの項目で記録する） */
  /**
   * answer: auto はその項目の答えの有無で決める。derived はこの項目が空欄でも、値はほかの答えから分けたもの（年収から分けた賞与など。今の値を
   * 残すと答えと合わなくなる）。notAsked は項目に答えがあっても、この欄はシートで聞いていない（介護が始まった年月など。今の値を残す）
   */
  field(objectId: string, key: string, index: number | undefined, item: string, path: string, state: FieldRecord["state"], uiKey?: string, answer: "auto" | "derived" | "notAsked" = "auto"): void {
    const g = this.get(key, index);
    const noAnswer = answer === "notAsked" || (answer === "auto" && g.status !== "value" && g.status !== "unknown" && g.status !== "notApplicable");
    const review = g.status === "value" ? g.review : undefined;
    const range = g.status === "value" ? g.range : undefined;
    const s = this.src(key, index);
    const list = this.fields.get(objectId) ?? [];
    // 範囲の答えから読んだ値は、記入どおり（confirmed）でも推定（範囲の真ん中）として記録する
    const fromRange = range !== undefined && (state === "confirmed" || state === "estimated");
    list.push({ key: s.key, ...(s.index !== undefined ? { index: s.index } : {}), item, path, state: fromRange ? "estimated" : state, ...(review !== undefined ? { review } : {}), ...(fromRange ? { range: range.label } : {}), ...(noAnswer ? { noAnswer: true as const } : {}), ...(uiKey !== undefined ? { uiKey } : {}) });
    this.fields.set(objectId, list);
  }

  /** 値の箱を持たない欄を仮の値で補った印（入力の画面の欄のキー） */
  assume(uiKey: string, reason: string, at: { objectId: string; key: string; index?: number; item: string; path: string; notAsked?: boolean }): void {
    this.assumed[uiKey] = reason;
    this.field(at.objectId, at.key, at.index, at.item, at.path, "assumed", uiKey, at.notAsked === true ? "notAsked" : "auto");
    this.issues.push(issue("info", "H_ASSUMED", `${this.label(at.key, at.index)}: ${reason}`, this.src(at.key, at.index)));
  }

  candidate(collection: keyof Household, item: string, value: { id: string }, related?: Relation[], note: string | null = null): void {
    const fields = this.fields.get(value.id) ?? [];
    const review = fields.some((f) => f.review !== undefined && f.review.length > 0);
    this.candidates.push({
      id: this.newId(),
      target: { object: value.id },
      collection,
      item,
      op: "add",
      value,
      ...(related !== undefined && related.length > 0 ? { related } : {}),
      enabled: true,
      origin: { kind: "hearing", ref: this.ref },
      source: "hearing",
      sourceRef: this.ref,
      status: review ? "needsReview" : "pending",
      fields,
      note,
    });
  }

  // ---- 値の箱 ----

  confirmed<T>(value: T): ValueBox<T> {
    return { value, state: "confirmed", origin: { kind: "hearing", ref: this.ref } };
  }

  /** 記入の値の箱: 金額をそのまま書いた値は確定、範囲の答えから読んだ値は推定（確かさ「概算」。根拠は範囲の段） */
  box(key: string, index: number | undefined, value: number): ValueBox<number> {
    const r = this.rangeOf(key, index);
    if (r === null) return this.confirmed(value);
    return { value, state: "estimated", origin: { kind: "hearing", ref: this.ref }, estimate: { method: "derived", basis: rangeBasis(r) }, certainty: "rough" };
  }

  notApplicable<T>(): ValueBox<T> {
    return { state: "notApplicable", origin: { kind: "hearing", ref: this.ref } };
  }

  estimated(e: Estimate, method: "statistic" | "derived"): ValueBox<number> {
    return { value: e.value, state: "estimated", origin: { kind: "auto" }, estimate: { method, basis: e.basis } };
  }

  /** 書類で確かめる（書類待ち。状態 unknown）。入力の画面で「書類で確かめる」を出す欄（DOC_CHECK_ITEMS）だけに使う */
  unknown(e: Estimate | null, method: "statistic" | "derived"): ValueBox<number> {
    return { state: "unknown", origin: { kind: "hearing", ref: this.ref }, ...(e !== null ? { substitute: this.estimated(e, method) } : {}) };
  }

  /**
   * シートの「わからない」を推定にした値の箱（書類で確かめる欄でない欄。0041 の追記 2026-10-31・0100）。根拠の頭に「ヒアリングで『わからない』」。
   * 面談のチェックリストには今までどおり載る（read）
   */
  unknownAsEstimate(key: string, index: number | undefined, e: Estimate, method: "statistic" | "derived"): ValueBox<number> {
    this.issues.push(issue("info", "H_ESTIMATED", `${this.label(key, index)}: 「わからない」のため目安（${e.value.toLocaleString("ja-JP")}円）の推定にしました（${e.basis}）`, this.src(key, index)));
    return this.estimated({ value: e.value, basis: `${HEARING_UNKNOWN_BASIS}。${e.basis}` }, method);
  }

  /**
   * 金額の欄を値の箱にする。空欄は目安で補い（estimated）、わからないも目安の推定（根拠の頭に「ヒアリングで『わからない』」）。目安が無ければ null（欄を作らない）。
   * 範囲の答えから読んだ値は推定（box）
   */
  moneyBox(objectId: string, key: string, index: number | undefined, item: string, path: string, estimate: (() => Estimate | null) | null, method: "statistic" | "derived" = "statistic"): ValueBox<number> | null {
    const g = this.get<number>(key, index);
    if (g.status === "value") {
      this.field(objectId, key, index, item, path, "confirmed");
      return this.box(key, index, g.value);
    }
    if (g.status === "notApplicable") {
      this.field(objectId, key, index, item, path, "notApplicable");
      return this.notApplicable();
    }
    const e = estimate?.() ?? null;
    if (g.status === "unknown") {
      if (e === null) return null;
      // 金額の欄（事業の所得など）は書類で確かめる欄でないので、「わからない」は推定にする（0041 の追記 2026-10-31）
      this.field(objectId, key, index, item, path, "estimated");
      return this.unknownAsEstimate(key, index, e, method);
    }
    if (e === null) return null;
    this.field(objectId, key, index, item, path, "estimated");
    this.issues.push(issue("info", "H_ESTIMATED", `${this.label(key, index)}: 空欄のため目安（${e.value.toLocaleString("ja-JP")}円）で補いました（${e.basis}）`, this.src(key, index)));
    return this.estimated(e, method);
  }
}

/** 記入済みのシートを世帯データの候補にする */
export function importAnswers(def: SheetDefinition, filled: FilledSheet, options: ImportOptions): ImportResult {
  const newId = options.newId ?? (() => crypto.randomUUID());
  const c = new Ctx(def, filled, newId);
  const h: Household = { members: [], relations: [], events: [], employmentPeriods: [], accounts: [], insuranceContracts: [] };
  let asOf = c.value<string>("hs.meta.filledOn") ?? options.baseMonth;
  if (c.value<string>("hs.meta.filledOn") === null) c.missing("hs.meta.filledOn", undefined, `記入の年月が無いため、計算基準月（${options.baseMonth}）の時点の額として扱いました`, "warning");
  else if (ymIndex(asOf) > ymIndex(options.baseMonth)) {
    // Web の答えの記入の年月は送った月（お客さまが選んだ年月ではない）。計算基準月が先月などのたびに知らせないよう、1年を超えて離れたときだけ知らせる
    if (options.filledOnIsSubmission !== true) c.contradiction("hs.meta.filledOn", undefined, `記入の年月が計算基準月より後です（計算基準月 ${options.baseMonth} の時点の額として扱いました）`);
    else if (ymIndex(asOf) - ymIndex(options.baseMonth) > 12) c.contradiction("hs.meta.filledOn", undefined, `お答えを送った年月（${ymText(asOf)}）が計算基準月（${options.baseMonth}）より1年を超えて後です（計算基準月の時点の額として扱いました。計算基準月を確かめてください）`);
    asOf = options.baseMonth;
  }

  simpleAliases(c);
  const adults = importFamily(c, h, options.baseMonth, asOf);
  importParents(c, h, adults, asOf, options.baseMonth);
  importInheritance(c, h, options.baseMonth);
  const periods = importWork(c, h, adults, options.baseMonth);
  importPension(c, h, adults, asOf);
  importHousing(c, h, adults, asOf, options.baseMonth);
  importEducation(c, h);
  importAssets(c, h, adults, periods, asOf);
  importCompany(c, h, adults, asOf);
  importInsurance(c, h, adults, options.baseMonth);
  importLiving(c, h, asOf, options.baseMonth);
  importMemoAndConsent(c);

  const youngestAdult = h.members.filter((m) => m.kind === "self" || m.kind === "spouse");
  const endYear = Math.max(...youngestAdult.map((m) => Number(reachedMonth(m, 100).slice(0, 4))));
  const request: EngineRequest = {
    trace: "none",
    input: {
      baseMonth: options.baseMonth,
      endYear,
      calcConventions: { aggregation: "cash", investmentTiming: "midYear", compatibility: null },
      household: h,
      assumptions: structuredClone(DEFAULT_ASSUMPTIONS),
    },
  };
  const m = filled.management;
  return {
    request,
    candidates: c.candidates,
    assumed: c.assumed,
    issues: c.issues,
    checklist: c.checklist,
    consents: c.consents,
    memo: c.memo,
    pending: c.pending,
    record: { kind: "hearing", requestId: m.requestId, sheetId: m.sheetId, sheetVersion: m.sheetVersion, layoutDigest: m.layoutDigest, exportedOn: m.exportedOn, answers: filled.answers },
    loanEntry: c.loanEntry,
    ...(options.gates !== undefined ? { gates: gatesOf(def, options.gates) } : {}),
  };
}

/**
 * 分岐の問いの答えの形を確かめる: 知っている問いで、このシートに関わる軸があり、数が 0〜繰り返しの数（配偶者の方・ご両親のことは 0 か 1）のものだけ。
 * 「答えない」（ご両親のこと 0）の下の問いは答えが届かないので、ほかの空欄と同じくお答えの無い所（今の値のまま）になる
 */
function gatesOf(def: SheetDefinition, g: GateAnswersIn): GateAnswersIn {
  const out: Partial<Record<GateKind, number>> = {};
  for (const k of GATE_KINDS) {
    const n = g[k];
    if (typeof n !== "number" || !Number.isInteger(n) || n < 0) continue;
    const axis = def.axes.find((a) => a.id === (k === "spouse" ? "adult" : k));
    if (axis === undefined) continue;
    const max = k === "spouse" || k === "parent" ? 1 : axis.count;
    if (n <= max) out[k] = n;
  }
  return out;
}

/**
 * シンプルの票（簡易版。大まかに聞く軽い票）の項目を、詳細版と同じ取り込みの手順で読むための読み替え（項目がシートに無ければ何もしない）。
 * - 年収（賞与を含む。自営業の方は事業の所得）: 働き方が自営業なら事業の所得、ほかは給与の年収として読む
 * - 預貯金・投資の合計（ご家族の合計）: ご本人の名義の預金・課税口座として読む（名義・口座の種類は仮。importAssets）
 * 範囲の答えは、その前に金額の項目へ読んである（Ctx の fromRanges）
 */
function simpleAliases(c: Ctx): void {
  const adults = c.def.axes.find((a) => a.id === "adult")?.count ?? 0;
  for (let n = 1; n <= adults; n++) {
    const type = c.value<string>("hs.work.type", n);
    c.alias(type === "selfEmployed" ? "hs.income.business" : "hs.income.salary", n, "hs.income.annual", n);
  }
  c.alias("hs.assets.deposit", 1, "hs.assets.depositTotal", undefined);
  c.alias("hs.assets.taxable", 1, "hs.assets.investTotal", undefined);
}

const ymText = (ym: string): string => `${ym.slice(0, 4)}年${Number(ym.slice(5, 7))}月`;

/** 年齢から仮の生年月（記入の年月にその満年齢の人の真ん中: 年齢×12＋6か月前） */
export function birthFromAge(asOf: string, age: number): string {
  return addMonths(asOf, -(age * 12 + 6));
}

const ageReason = (asOf: string, age: number, birth: string): string => `仮の値（ご記入の年月（${ymText(asOf)}）に${age}歳として、${ymText(birth)}生まれで計算。生年月は面談で確かめてください）`;

// ---- 家族 ----

/** 本人（1）と配偶者（2）。いなければ undefined */
type Adults = [Member, Member | undefined];

const SPOUSE_KEYS = [
  "hs.family.adult.sex",
  "hs.work.type",
  "hs.income.salary",
  "hs.income.business",
  "hs.income.taxReturn",
  "hs.pension.notice.type",
  "hs.assets.deposit",
  "hs.assets.nisa",
  "hs.assets.ideco",
  "hs.company.shares",
  "hs.company.loanToCompany",
  "hs.company.loanFromCompany",
  "hs.company.guarantee",
];

function importFamily(c: Ctx, h: Household, baseMonth: string, asOf: string): Adults {
  const B = "hs.family.adult.birthYearMonth";
  const A = "hs.family.adult.age";
  const S = "hs.family.adult.sex";
  const baseYear = Number(baseMonth.slice(0, 4));
  /** 生年月の記入（年齢と食い違えば知らせる）、無ければ年齢からの仮の生年月。どちらも無ければ null */
  const birthOf = (id: string, n: number): string | null => {
    const b = c.get<string>(B, n);
    const age = c.get<number>(A, n);
    if (b.status === "value") {
      c.field(id, B, n, "member.birth", "/birth/birthYearMonth", "confirmed");
      if (age.status === "value" && Math.abs(ageAt({ birth: { birthYearMonth: b.value, bornOnFirst: false } }, asOf) - age.value) > 1) c.contradiction(A, n, "生年月と年齢が合いません（生年月を使いました）");
      return b.value;
    }
    if (age.status !== "value") return null;
    const birth = birthFromAge(asOf, age.value);
    c.assume(`family/${id}/birth`, ageReason(asOf, age.value, birth), { objectId: id, key: A, index: n, item: "member.birth", path: "/birth/birthYearMonth" });
    return birth;
  };

  const selfId = c.newId();
  const selfBirth = c.get<string>(B, 1);
  const fromSheet = birthOf(selfId, 1);
  let birth: string;
  if (fromSheet !== null) {
    birth = fromSheet;
  } else {
    birth = `${baseYear - 40}-04`;
    if (selfBirth.status === "notApplicable" || c.get(A, 1).status === "notApplicable") c.contradiction(selfBirth.status === "notApplicable" ? B : A, 1, `ご本人の${selfBirth.status === "notApplicable" ? "生年月" : "年齢"}に「該当なし」は選べません`, "error");
    else c.missing(B, 1, "ご本人の生年月がありません（計算に必要です）", "error");
    c.assume(`family/${selfId}/birth`, "仮の値（40歳として計算）", { objectId: selfId, key: B, index: 1, item: "member.birth", path: "/birth/birthYearMonth" });
  }
  const self: Member = { id: selfId, kind: "self", birth: { birthYearMonth: birth, bornOnFirst: false }, sex: sexOf(c, selfId, S, 1, "male"), joins: null, leaves: null, expected: false };
  companyGuarantee(c, self, 1);
  taxReturn(c, self, 1);
  h.members.push(self);
  c.candidate("members", "member.kind", self);

  // 配偶者
  let spouse: Member | undefined;
  const sb = c.get<string>(B, 2);
  const sa = c.get<number>(A, 2);
  const spouseTouched = SPOUSE_KEYS.some((k) => c.get(k, 2).status === "value");
  if (sb.status === "notApplicable" || (sb.status !== "value" && sa.status === "notApplicable")) {
    if (spouseTouched) c.contradiction(sb.status === "notApplicable" ? B : A, 2, "配偶者の方は「該当なし」ですが、配偶者の方の欄に記入があります（配偶者の方の欄は取り込みませんでした）");
  } else if (sb.status === "value" || sa.status === "value" || spouseTouched) {
    const id = c.newId();
    let sBirth: string;
    const given = birthOf(id, 2);
    if (given !== null) {
      sBirth = given;
    } else {
      sBirth = birth;
      c.missing(B, 2, "配偶者の方の欄に記入がありますが、生年月がありません");
      c.assume(`family/${id}/birth`, "仮の値（ご本人と同じ年月として計算）", { objectId: id, key: B, index: 2, item: "member.birth", path: "/birth/birthYearMonth" });
    }
    spouse = { id, kind: "spouse", birth: { birthYearMonth: sBirth, bornOnFirst: false }, sex: sexOf(c, id, S, 2, self.sex === "male" ? "female" : "male"), joins: null, leaves: null, expected: false };
    companyGuarantee(c, spouse, 2);
    taxReturn(c, spouse, 2);
    h.members.push(spouse);
    const mg = c.get<string>("hs.family.spouse.marriage");
    let marriage: "legal" | "deFacto" = "legal";
    if (mg.status === "value") {
      marriage = mg.value as "legal" | "deFacto";
      c.field(id, "hs.family.spouse.marriage", undefined, "member.kind", "/related/0/marriage", "confirmed");
    } else if (mg.status === "notApplicable") {
      c.contradiction("hs.family.spouse.marriage", undefined, "配偶者の方の生年月がありますが、ご結婚の形が「該当なし」です（法律上の婚姻として取り込みました）");
    }
    const rel: Relation = { type: "spouse", a: selfId, b: id, marriage, from: null, to: null };
    h.relations.push(rel);
    c.candidate("members", "member.kind", spouse, [rel]);
  } else if (c.get("hs.family.spouse.marriage").status === "value") {
    c.contradiction("hs.family.spouse.marriage", undefined, "ご結婚の形に記入がありますが、配偶者の方の生年月がありません");
  }

  // 子
  const axis = c.def.axes.find((a) => a.id === "child");
  for (let n = 1; n <= (axis?.count ?? 0); n++) {
    const g = c.get<string>("hs.family.child.birthYearMonth", n);
    if (g.status !== "value") {
      if (c.get("hs.family.child.sex", n).status === "value") c.missing("hs.family.child.birthYearMonth", n, "性別がありますが、生年月がありません（このお子さまは取り込みませんでした）");
      continue;
    }
    const id = c.newId();
    const b = g.value;
    c.field(id, "hs.family.child.birthYearMonth", n, "member.birth", "/birth/birthYearMonth", "confirmed");
    const expected = ymIndex(b) > ymIndex(baseMonth);
    if (expected) c.field(id, "hs.family.child.birthYearMonth", n, "member.expected", "/expected", "confirmed");
    if (ymIndex(b) - ymIndex(self.birth.birthYearMonth) < 15 * 12) c.contradiction("hs.family.child.birthYearMonth", n, "お子さまとご本人の年の差が15歳より小さくなっています");
    if (ymIndex(b) - ymIndex(baseMonth) > 18) c.contradiction("hs.family.child.birthYearMonth", n, "出産予定が1年半より先になっています");
    const sexGot = c.get<string>("hs.family.child.sex", n);
    let sex: "male" | "female" = "female";
    // 性別は推定するものではないので、記入が無くても推定・仮の印は付けない（初めの値をそのまま入れる）
    if (sexGot.status === "value") {
      sex = sexGot.value as "male" | "female";
      c.field(id, "hs.family.child.sex", n, "member.sex", "/sex", "confirmed");
    }
    const child: Member = { id, kind: "child", birth: { birthYearMonth: b, bornOnFirst: false }, sex, joins: expected ? { at: b } : null, leaves: null, expected };
    h.members.push(child);
    const rels: Relation[] = [{ type: "parentOf", parent: selfId, child: id }];
    if (spouse !== undefined) rels.push({ type: "parentOf", parent: spouse.id, child: id });
    h.relations.push(...rels);
    c.candidate("members", "member.kind", child, rels);
  }
  return [self, spouse];
}

function sexOf(c: Ctx, id: string, key: string, index: number, fallback: "male" | "female"): "male" | "female" {
  const g = c.get<string>(key, index);
  if (g.status === "value") {
    c.field(id, key, index, "member.sex", "/sex", "confirmed");
    return g.value as "male" | "female";
  }
  // 記入が無いことは知らせる。性別は推定するものではないので、推定・仮の印は付けない（初めの値をそのまま入れる）
  c.missing(key, index, "性別がありません（年金の計算に使います）");
  return fallback;
}

// ---- ご両親（世帯の外の家族。入力の画面の介護・親のカードの区画A） ----

const P = "hs.family.parent";

/**
 * ご両親（ご本人のお父さま・お母さま、配偶者の方のお父さま・お母さま）を、世帯の外の家族（家計を世帯と別にする親）として取り込む。
 * 性別と誰の親かは欄で決まる。年齢があれば仮の生年月、無ければお子さま（本人・配偶者）の生年の30年前（介護・親のカードの「＋ 両家の親を足す」と同じ）。
 * 同居かは扶養と同居の欄（同居している）に入れる。亡くなる見込み・扶養・親のお金はシートで聞かない（亡くなる見込みは承認したときに画面の側で平均余命の推定を入れる）。
 * 詳細版の版3 からは、仕送り・援助・介護が始まっているかも聞く（importParentMoney）
 */
function importParents(c: Ctx, h: Household, adults: Adults, asOf: string, baseMonth: string): void {
  const axis = c.def.axes.find((a) => a.id === "parent");
  if (axis === undefined || !c.has(`${P}.alive`)) return;
  for (let n = 1; n <= axis.count; n++) {
    const alive = c.get<string>(`${P}.alive`, n);
    const age = c.get<number>(`${P}.age`, n);
    const co = c.get<string>(`${P}.cohabiting`, n);
    if (alive.status !== "value" && age.status !== "value" && co.status !== "value") continue;
    if (alive.status === "value" && alive.value === "deceased") {
      if (age.status === "value" || co.status === "value") c.contradiction(`${P}.alive`, n, "「亡くなっている」ですが、年齢などの記入があります（取り込みませんでした）");
      continue;
    }
    const side = n <= 2 ? adults[0] : adults[1];
    if (side === undefined) {
      c.contradiction(`${P}.alive`, n, "配偶者の方の記入がありませんが、配偶者の方のご両親の記入があります（取り込みませんでした）");
      continue;
    }
    const id = c.newId();
    let birth: string;
    if (age.status === "value") {
      birth = birthFromAge(asOf, age.value);
      c.assume(`family/${id}/birth`, ageReason(asOf, age.value, birth), { objectId: id, key: `${P}.age`, index: n, item: "member.birth", path: "/birth/birthYearMonth" });
      if (ymIndex(birth) > ymIndex(side.birth.birthYearMonth) - 15 * 12) c.contradiction(`${P}.age`, n, "ご両親とお子さまの年の差が15歳より小さくなっています");
    } else {
      birth = `${Number(side.birth.birthYearMonth.slice(0, 4)) - 30}-04`;
      c.assume(`family/${id}/birth`, `仮の値（${n <= 2 ? "ご本人" : "配偶者の方"}の生年の30年前）`, { objectId: id, key: `${P}.age`, index: n, item: "member.birth", path: "/birth/birthYearMonth" });
    }
    if (alive.status === "value") c.field(id, `${P}.alive`, n, "member.kind", "/kind", "confirmed");
    c.field(id, `${P}.alive`, n, "member.sex", "/sex", "confirmed");
    const m: Member = { id, kind: "parent", birth: { birthYearMonth: birth, bornOnFirst: false }, sex: n % 2 === 1 ? "male" : "female", joins: null, leaves: null, expected: false, outside: { of: side.id, periods: [] } };
    if (co.status === "value") {
      m.support = { dependent: false, cohabiting: co.value === "together" };
      c.field(id, `${P}.cohabiting`, n, "member.support", "/support/cohabiting", "confirmed");
    }
    h.members.push(m);
    const asked = c.has(`${P}.care`);
    c.candidate("members", "member.kind", m, undefined, asked ? "亡くなる見込み・扶養・親のお金はシートでお聞きしていません。介護・親の項目で入れてください" : "亡くなる見込み・扶養・親のお金・介護の費用はシートでお聞きしていません。介護・親の項目で入れてください");
    importParentMoney(c, h, m, n, baseMonth);
  }
}

/**
 * ご両親への仕送り・ご両親からの援助（毎月）と、介護が始まっているか（詳細版の版3から。0059）。仕送りは相手をこの親にした仕送りの出るお金の行、
 * 援助は入るお金の行（援助・仕送りを受ける）にし、どちらも今の月から毎月（終わりは入れない。相手が亡くなる見込みの月で止まる）。伸び方は、画面で足す
 * 行と同じく、仕送り・援助の既定の「変えない」（額を決めて送るお金。0044 の追記 2026-11-10）。
 * 介護が始まっていれば、この親の介護の費用を1件（始まりは前の月〔始まった年月はシートで聞かない。仮の値〕・期間は統計の平均・月々の費用は記入の額）
 */
function importParentMoney(c: Ctx, h: Household, m: Member, n: number, baseMonth: string): void {
  const at = { at: baseMonth };
  const allowance = c.get<number>(`${P}.allowance`, n);
  if (allowance.status === "value" && allowance.value > 0) {
    const id = c.newId();
    const row: PeriodicExpense = { id, label: "仕送り", kind: "allowance", row: "cf.expense.other", from: at, to: null, everyYears: 1, monthly: true, amount: c.box(`${P}.allowance`, n, allowance.value), counterparty: m.id, growth: { kind: "none" } };
    c.field(id, `${P}.allowance`, n, "periodicExpense.amount", "/amount", "confirmed");
    (h.periodicExpenses ??= []).push(row);
    c.candidate("periodicExpenses", "periodicExpense.amount", row, undefined, "今の月から毎月としました。始まり・終わりは面談で確かめてください");
  }
  const support = c.get<number>(`${P}.support`, n);
  if (support.status === "value" && support.value > 0) {
    const id = c.newId();
    const flow: IncomeFlow = { id, label: "援助・仕送りを受ける", kind: "support", from: at, to: null, everyYears: 1, monthly: true, amount: c.box(`${P}.support`, n, support.value), counterparty: m.id, growth: { kind: "none" } };
    c.field(id, `${P}.support`, n, "incomeFlow.amount", "/amount", "confirmed");
    (h.incomeFlows ??= []).push(flow);
    c.candidate("incomeFlows", "incomeFlow.amount", flow, undefined, "今の月から毎月としました。始まり・終わりは面談で確かめてください");
  }
  const care = c.get<string>(`${P}.care`, n);
  if (care.status === "value" && (care.value === "home" || care.value === "facility")) {
    const id = c.newId();
    const ce: CareExpense = { id, member: m.id, from: { at: addMonths(baseMonth, -1) }, place: care.value };
    c.field(id, `${P}.care`, n, "care.place", "/place", "confirmed");
    c.assume(`ev/care/${id}/from`, "仮の値（介護が始まっている。始まった年月はシートでお聞きしていません）", { objectId: id, key: `${P}.care`, index: n, item: "care.from", path: "/from", notAsked: true });
    const monthly = c.get<number>(`${P}.careMonthly`, n);
    if (monthly.status === "value") {
      ce.otherMonthly = c.box(`${P}.careMonthly`, n, monthly.value);
      c.field(id, `${P}.careMonthly`, n, "care.otherMonthly", "/otherMonthly", "confirmed");
    }
    (h.careExpenses ??= []).push(ce);
    c.candidate("careExpenses", "care.place", ce, undefined, "介護の期間・一時費用・介護保険のサービスの額は、空欄のまま統計の平均で推定します。面談で確かめてください");
  } else if (c.get<number>(`${P}.careMonthly`, n).status === "value") c.contradiction(`${P}.careMonthly`, n, "介護が始まっていないのに、介護の費用の記入があります（取り込みませんでした）");
}

/**
 * 受け取る予定の相続・贈与（詳細版の版3から）: 「ある」なら、相続・遺贈の入るお金の行を1件（時期は記入の年の1月・無ければ1年後、額は目安の額・
 * 無ければ未入力）。見込みは「当てにしない」（基本の計算に入れない。面談で確かめて「確実」にする）。相手（誰から）はシートで聞かない
 */
function importInheritance(c: Ctx, h: Household, baseMonth: string): void {
  const I = "hs.inherit";
  if (!c.has(`${I}.expected`)) return;
  const expected = c.get<string>(`${I}.expected`);
  const year = c.get<number>(`${I}.year`);
  const amount = c.get<number>(`${I}.amount`);
  if (expected.status !== "value" || expected.value !== "yes") {
    if (year.status === "value" || amount.status === "value") c.contradiction(`${I}.expected`, undefined, "「ある」が選ばれていませんが、時期・額の記入があります（取り込みませんでした）");
    return;
  }
  const id = c.newId();
  const at = year.status === "value" ? { at: `${String(year.value)}-01` } : { at: addMonths(baseMonth, 12) };
  if (year.status === "value" && ymIndex(at.at) < ymIndex(baseMonth)) c.contradiction(`${I}.year`, undefined, "受け取る時期の見込みが今より前です");
  const box: ValueBox<number> = amount.status === "value" ? c.box(`${I}.amount`, undefined, amount.value) : { value: 0, state: "estimated", origin: { kind: "auto" }, estimate: { method: "standard", basis: "未入力（額を入れてください。0円で計算中）" } };
  const flow: IncomeFlow = { id, label: "相続・遺贈", kind: "inheritance", from: at, to: at, everyYears: 1, amount: box, likelihood: "uncertain" };
  c.field(id, `${I}.expected`, undefined, "incomeFlow.kind", "/kind", "confirmed");
  if (year.status === "value") c.field(id, `${I}.year`, undefined, "incomeFlow.from", "/from", "confirmed");
  else c.assume(`in/${id}/from`, "仮の値（受け取る時期の見込みの記入が無いため1年後）", { objectId: id, key: `${I}.year`, item: "incomeFlow.from", path: "/from" });
  // 額の記入が無ければ、お答えの無い欄（今の世帯に同じ行があれば今の額を残す。0139）
  c.field(id, `${I}.amount`, undefined, "incomeFlow.amount", "/amount", amount.status === "value" ? "confirmed" : "estimated");
  (h.incomeFlows ??= []).push(flow);
  c.candidate("incomeFlows", "incomeFlow.kind", flow, undefined, "見込みは「当てにしない」（基本の計算に入れない）で入れました。相手（誰から）・見込みは面談で確かめてください");
}

// ---- 働き方と収入 ----

function importWork(c: Ctx, h: Household, adults: Adults, baseMonth: string): Map<string, EmploymentPeriod> {
  const out = new Map<string, EmploymentPeriod>();
  adults.forEach((m, i) => {
    const n = i + 1;
    if (m === undefined) return;
    // 住民税（今年度の決定額。置き換え口）。働いていない人（年金の方など）にもある
    const rt = c.get<number>("hs.income.residentTax", n);
    if (rt.status === "value" || rt.status === "notApplicable") {
      const rid = c.newId();
      const amount = rt.status === "value" ? c.confirmed(rt.value) : c.notApplicable<number>();
      c.field(rid, "hs.income.residentTax", n, "residentTaxAssessment.amount", "/amount", rt.status === "value" ? "confirmed" : "notApplicable");
      const a: ResidentTaxAssessment = { id: rid, member: m.id, fiscalYear: residentTaxYear(baseMonth), amount };
      (h.residentTaxAssessments ??= []).push(a);
      c.candidate("residentTaxAssessments", "residentTaxAssessment.amount", a);
    }
  });
  adults.forEach((m, i) => {
    const n = i + 1;
    const typeGot = c.get<string>("hs.work.type", n);
    if (m === undefined) return;
    if (typeGot.status !== "value") {
      if (typeGot.status === "blank" || typeGot.status === "unknown") c.missing("hs.work.type", n, "働き方がありません（収入なしとして計算します）");
      else if (typeGot.status === "notApplicable" && n === 1) c.contradiction("hs.work.type", n, "ご本人の働き方に「該当なし」は選べません（収入なしとして計算します）");
      return;
    }
    const type = typeGot.value as EmploymentPeriod["type"];
    if (type === "unemployed") {
      for (const k of ["hs.income.salary", "hs.income.business"]) if (c.get(k, n).status === "value") c.contradiction(k, n, "「働いていない」ですが、収入の記入があります（取り込みませんでした）");
      return;
    }
    const id = c.newId();
    const at = (key: string, item: string, path: string) => ({ objectId: id, key, index: n, item, path });
    c.field(id, "hs.work.type", n, "employment.type", "/type", "confirmed");

    // 始まり
    const since = c.get<string>("hs.work.since", n);
    let from: string;
    if (since.status === "value") {
      from = since.value;
      c.field(id, "hs.work.since", n, "employment.from", "/from/at", "confirmed");
      if (ymIndex(from) > ymIndex(baseMonth)) c.contradiction("hs.work.since", n, "仕事を始めた年月が計算基準月より後です");
      if (ageAt(m, from) < 15) c.contradiction("hs.work.since", n, "仕事を始めた年月が15歳より前です");
    } else {
      from = MAIN_JOB.has(type) ? careerStartMonth(m.birth.birthYearMonth) : baseMonth;
      if (ymIndex(from) > ymIndex(baseMonth)) from = baseMonth;
      c.assume(`work/period/${id}/from`, MAIN_JOB.has(type) ? "仮の値（22歳の4月から）" : "仮の値（計算基準月から）", at("hs.work.since", "employment.from", "/from/at"));
    }

    // 終わり（定年）
    let to: string | null = null;
    const ra = c.get<number>("hs.work.retireAge", n);
    if (ra.status === "value") {
      to = addMonths(reachedMonth(m, ra.value), -1);
      c.field(id, "hs.work.retireAge", n, "employment.to", "/to/at", "confirmed");
      if (ymIndex(to) < ymIndex(baseMonth)) {
        // 定年の年齢に達した後も働いている（定年が年度末などで、達した月より後）: 今月まで働くとして取り込む
        c.contradiction("hs.work.retireAge", n, "定年の年齢を、もう過ぎています（計算基準月まで働くとして取り込みました。辞める月を面談で確かめてください）");
        to = baseMonth;
      }
    } else {
      // 終わりの無い期間も欄の記録を付ける: 答えが無い（空欄・「あとで」・このシートで聞いていない）なら、取り込む側は今の世帯の終わりを残す
      // （今の終わりを「無し」にして、働く最後の年齢の推定で置きかえない。0139）。「わからない」は答え（今の終わりが確定なら粗い答え）
      c.field(id, "hs.work.retireAge", n, "employment.to", "/to", ra.status === "unknown" ? "unknown" : "confirmed");
      if (ra.status === "unknown" && MAIN_JOB.has(type)) c.check("hs.work.retireAge", n, "unknown", "定年が決まっていない（今の勤め先で働き続けるとして計算します）");
    }

    const p: EmploymentPeriod = { id, member: m.id, from: { at: from }, to: to === null ? null : { at: to }, type };
    if (type === "leave") {
      p.leaveKind = "other";
      c.assume(`work/period/${id}/leaveKind`, "仮の値（休業の種類は面談で確かめる）", at("hs.work.type", "employment.leaveKind", "/leaveKind"));
    }

    // 健康保険・厚生年金
    if (type !== "selfEmployed" && type !== "leave") {
      const hi = c.get<string>("hs.work.healthInsurance", n);
      let kind: string;
      if (hi.status === "value") {
        kind = hi.value;
        c.field(id, "hs.work.healthInsurance", n, "employment.healthInsurance.kind", "/healthInsurance/kind", "confirmed");
        if (kind === "national" && MAIN_JOB.has(type)) c.contradiction("hs.work.healthInsurance", n, "勤め先にお勤めですが、国民健康保険になっています");
      } else {
        kind = type === "civilServant" ? "mutualAid" : type === "partTime" ? "dependent" : "kyokaikenpo";
        c.assume(`work/period/${id}/hi`, "仮の値（働き方からの目安）", at("hs.work.healthInsurance", "employment.healthInsurance.kind", "/healthInsurance/kind"));
      }
      p.healthInsurance = { kind };
      if (kind === "union" || kind === "mutualAid") {
        // 組合ごとの保険料率はシートで聞かない（顧客には分かりにくい）。目安で補い、推定の印を付ける
        const e = healthRateEstimate(kind, { month: baseMonth });
        p.healthInsurance.employeeRate = { value: e.value, state: "estimated", origin: { kind: "auto" }, estimate: { method: "statistic", basis: e.basis } };
        c.field(id, "hs.work.healthInsurance", n, "employment.healthInsurance.employeeRate", "/healthInsurance/employeeRate", "estimated");
      }
      if (kind === "kyokaikenpo") {
        const pref = c.get<string>("hs.work.prefecture", n);
        if (pref.status === "value") {
          p.healthInsurance.insurer = pref.value;
          c.field(id, "hs.work.prefecture", n, "employment.healthInsurance.insurer", "/healthInsurance/insurer", "confirmed");
        } else {
          p.healthInsurance.insurer = "kyokaikenpo.13";
          c.assume(`work/period/${id}/branch`, "仮の値（東京都の料率で計算）", at("hs.work.prefecture", "employment.healthInsurance.insurer", "/healthInsurance/insurer"));
        }
      }
      p.pensionCategory = kind === "kyokaikenpo" || kind === "union" ? "employee1" : kind === "mutualAid" ? "employee2" : MAIN_JOB.has(type) ? "employee1" : "none";
      c.field(id, "hs.work.type", n, "employment.pensionCategory", "/pensionCategory", "assumed");

      // 勤め先
      const size = c.get<number>("hs.work.employerSize", n);
      const hours = c.get<string>("hs.work.weeklyHours", n);
      if (size.status === "value" || hours.status === "value" || SALARIED.has(type)) {
        let sz: number;
        let hr: string;
        if (size.status === "value") {
          sz = size.value;
          c.field(id, "hs.work.employerSize", n, "employment.employer.size", "/employer/size", "confirmed");
        } else {
          sz = presetNum(type === "partTime" ? "preset.work.employerSize.partTime" : "preset.work.employerSize");
          c.assume(`work/period/${id}/size`, `仮の値（${sz}人として計算）`, at("hs.work.employerSize", "employment.employer.size", "/employer/size"));
        }
        if (hours.status === "value") {
          hr = hours.value;
          c.field(id, "hs.work.weeklyHours", n, "employment.employer.weeklyHours", "/employer/weeklyHours", "confirmed");
        } else {
          hr = String(presetNum(type === "partTime" ? "preset.work.weeklyHours.partTime" : "preset.work.weeklyHours"));
          if (type === "partTime") c.missing("hs.work.weeklyHours", n, "パート・アルバイトの方の勤務時間がありません（社会保険の加入の判定に使います）");
          c.assume(`work/period/${id}/hours`, `仮の値（週${hr}時間として計算）`, at("hs.work.weeklyHours", "employment.employer.weeklyHours", "/employer/weeklyHours"));
        }
        p.employer = { size: sz, weeklyHours: hr };
      }
    }

    // 収入
    if (SALARIED.has(type)) importSalary(c, p, m, n, baseMonth);
    else if (c.get("hs.income.salary", n).status === "value") c.contradiction("hs.income.salary", n, "給与の記入がありますが、働き方が給与の働き方ではありません（取り込みませんでした）");
    if (type === "selfEmployed") {
      const b = c.moneyBox(id, "hs.income.business", n, "employment.business.income", "/business/income", () => (fillsByEstimate("employment.business.income") ? businessEstimate() : null));
      if (b !== null) p.business = { income: b };
      if (c.get("hs.income.business", n).status === "blank") c.missing("hs.income.business", n, "事業の所得がありません");
    } else if (c.get("hs.income.business", n).status === "value") {
      c.contradiction("hs.income.business", n, "事業の所得の記入がありますが、働き方が自営業ではありません（取り込みませんでした）");
    }

    h.employmentPeriods.push(p);
    out.set(m.id, p);
    ensureResidentTax(c, h, p, m, n, baseMonth);
    c.candidate("employmentPeriods", "employment.type", p);

    // 退職金
    const ls = c.get<number>("hs.retirement.lumpSum", n);
    if (ls.status === "value") {
      const bid = c.newId();
      c.field(bid, "hs.retirement.lumpSum", n, "retirementBenefit.amount", "/amount", "confirmed");
      const rb: RetirementBenefit = { id: bid, member: m.id, kind: "lumpSum", employment: id, amount: c.confirmed(ls.value) };
      (h.retirementBenefits ??= []).push(rb);
      c.candidate("retirementBenefits", "retirementBenefit.kind", rb);
    } else if (ls.status === "unknown" && LUMP_SUM_TYPES.has(type)) {
      // 「わからない」は書類で確かめる（会社の退職金規程・制度の資料を見るまで、勤続年数と辞め方の目安を代わりに使う。0041 の追記 2026-10-31）
      const e = lumpSumSubstitute(m, p);
      if (e !== null) {
        const bid = c.newId();
        c.field(bid, "hs.retirement.lumpSum", n, "retirementBenefit.amount", "/amount", "unknown");
        const rb: RetirementBenefit = { id: bid, member: m.id, kind: "lumpSum", employment: id, amount: c.unknown(e, "statistic") };
        (h.retirementBenefits ??= []).push(rb);
        c.candidate("retirementBenefits", "retirementBenefit.kind", rb);
      }
    }
  });
  return out;
}

/**
 * 前の年に働いていた人に今年度の住民税（決定額）が無ければ、概算の推定を入れる（入力の画面の ensureResidentTax と同じ考え方）。
 * 計算エンジンは決定額が無いと前の年の所得から計算し直すが、古い年の社会保険の制度データが無いと止まるため
 */
function ensureResidentTax(c: Ctx, h: Household, p: EmploymentPeriod, m: Member, n: number, baseMonth: string): void {
  const fy = residentTaxYear(baseMonth);
  if ((h.residentTaxAssessments ?? []).some((a) => a.member === m.id && a.fiscalYear === fy)) return;
  const prev = Number(baseMonth.slice(0, 4)) - 1;
  const from = "at" in p.from ? p.from.at : baseMonth;
  const to = p.to !== null && "at" in p.to ? p.to.at : null;
  if (ymIndex(from) > ymIndex(`${prev}-12`) || (to !== null && ymIndex(to) < ymIndex(`${prev}-01`))) return;
  const val = (b: ValueBox<number> | undefined) => b?.value ?? b?.substitute?.value ?? 0;
  const salary = val(p.salary?.annual) + val(p.salary?.bonus);
  const business = val(p.business?.income);
  const e = residentTaxEstimate(salary, business, fy - 1);
  const st = c.get("hs.income.residentTax", n).status;
  const rid = c.newId();
  const amount = st === "unknown" ? c.unknown(e, "derived") : c.estimated(e, "derived");
  c.field(rid, "hs.income.residentTax", n, "residentTaxAssessment.amount", "/amount", st === "unknown" ? "unknown" : "estimated");
  const a: ResidentTaxAssessment = { id: rid, member: m.id, fiscalYear: fy, amount };
  (h.residentTaxAssessments ??= []).push(a);
  c.candidate("residentTaxAssessments", "residentTaxAssessment.amount", a);
}

function importSalary(c: Ctx, p: EmploymentPeriod, m: Member, n: number, baseMonth: string): void {
  const id = p.id;
  const total = c.get<number>("hs.income.salary", n);
  const bonus = c.get<number>("hs.income.bonus", n);
  // 推定の年齢: 期間の始まりと計算基準月の遅いほう（勤め先の規模は推定に使わない。規模は詳細の入力で入れたときだけ使う決まり）
  const from = "at" in p.from && ymIndex(p.from.at) > ymIndex(baseMonth) ? p.from.at : baseMonth;
  const opts = { age: ageAt(m, from) };
  // 事務所の既定値で給与を推定で埋めない欄にしたときは、目安を使わない（空欄・「わからない」は未入力の0円。0111）
  const est = fillsByEstimate("employment.salary.annual") ? salaryEstimate(p.type, opts) : null;
  let annual: ValueBox<number>;
  let bonusBox: ValueBox<number>;
  if (total.status === "value") {
    c.field(id, "hs.income.salary", n, "employment.salary.annual", "/salary/annual", "confirmed");
    if (bonus.status === "value") {
      if (bonus.value > total.value) {
        c.contradiction("hs.income.bonus", n, "賞与が年収より多くなっています（賞与を0円として取り込みました）", "error");
        bonusBox = c.confirmed(0);
        annual = c.box("hs.income.salary", n, total.value);
      } else {
        c.field(id, "hs.income.bonus", n, "employment.salary.bonus", "/salary/bonus", "confirmed");
        bonusBox = c.confirmed(bonus.value);
        annual = c.box("hs.income.salary", n, total.value - bonus.value);
      }
    } else if (bonus.status === "notApplicable") {
      c.field(id, "hs.income.bonus", n, "employment.salary.bonus", "/salary/bonus", "confirmed");
      bonusBox = c.confirmed(0);
      annual = c.box("hs.income.salary", n, total.value);
    } else {
      // 賞与が分からない: 年収に統計の賞与の割合を当てて分ける（年収の側も、その分だけ推定になる）
      const share = bonusShareEstimate(p.type, total.value, opts) ?? { value: 0, basis: "賞与なしとみなした" };
      const tr = c.rangeOf("hs.income.salary", n);
      const rest: Estimate = { value: total.value - share.value, basis: tr !== null ? `${rangeBasis(tr)}（${total.value.toLocaleString("ja-JP")}円）から賞与の目安を引いた額` : `年収（記入）${total.value.toLocaleString("ja-JP")}円から賞与の目安を引いた額` };
      if (bonus.status === "unknown") {
        // 賞与・年収は書類で確かめる欄でないので、「わからない」は推定にする（0041 の追記 2026-10-31）
        bonusBox = c.unknownAsEstimate("hs.income.bonus", n, share, "derived");
        annual = c.estimated({ value: rest.value, basis: `${HEARING_UNKNOWN_BASIS}。${rest.basis}` }, "derived");
        c.field(id, "hs.income.bonus", n, "employment.salary.bonus", "/salary/bonus", "estimated");
      } else {
        bonusBox = c.estimated(share, "derived");
        // 範囲の答えから分けた年収は、出どころ「ヒアリング」の概算の推定（承認の記録が付く）
        annual = tr !== null ? { value: rest.value, state: "estimated", origin: { kind: "hearing", ref: c.ref }, estimate: { method: "derived", basis: rest.basis }, certainty: "rough" } : c.estimated(rest, "derived");
        // 賞与は年収の答えから分けた値（今の賞与を残すと、年収の答えと合計が合わなくなる）
        c.field(id, "hs.income.bonus", n, "employment.salary.bonus", "/salary/bonus", "estimated", undefined, "derived");
        c.issues.push(issue("info", "H_ESTIMATED", `${c.label("hs.income.bonus", n)}: 空欄のため、年収のうち ${share.value.toLocaleString("ja-JP")}円を賞与の目安としました`, { key: "hs.income.bonus", index: n }));
      }
    }
  } else {
    if (total.status === "notApplicable") c.contradiction("hs.income.salary", n, "給与の働き方ですが、給与の年収が「該当なし」です（目安で補いました）");
    // 推定で埋めない欄（0111）は「未入力」の印の0円（入力の画面の確かめの一覧で未入力に出る）
    const none = fillsByEstimate("employment.salary.annual") ? "目安なし" : NOT_FILLED_BASIS;
    const annualEst = est?.annual ?? { value: 0, basis: none };
    const bonusEst = est?.bonus ?? { value: 0, basis: none };
    if (total.status === "unknown" && est !== null) {
      annual = c.unknownAsEstimate("hs.income.salary", n, annualEst, "statistic");
      c.field(id, "hs.income.salary", n, "employment.salary.annual", "/salary/annual", "estimated");
    } else {
      if (total.status === "blank") c.missing("hs.income.salary", n, "給与の年収がありません（統計の平均で補いました）");
      annual = c.estimated(annualEst, "statistic");
      c.field(id, "hs.income.salary", n, "employment.salary.annual", "/salary/annual", "estimated");
    }
    if (bonus.status === "value") {
      bonusBox = c.confirmed(bonus.value);
      c.field(id, "hs.income.bonus", n, "employment.salary.bonus", "/salary/bonus", "confirmed");
    } else if (bonus.status === "notApplicable") {
      bonusBox = c.confirmed(0);
      c.field(id, "hs.income.bonus", n, "employment.salary.bonus", "/salary/bonus", "confirmed");
    } else {
      bonusBox = bonus.status === "unknown" && est !== null ? c.unknownAsEstimate("hs.income.bonus", n, bonusEst, "statistic") : c.estimated(bonusEst, "statistic");
      c.field(id, "hs.income.bonus", n, "employment.salary.bonus", "/salary/bonus", "estimated");
    }
  }
  p.salary = { annual, bonus: bonusBox };
  // 標準報酬月額は聞かず、書かない（空欄なら、計算エンジンが給与から毎年9月に決め直す。推定の額を書くと期間の間ずっと同じ額になり、
  // 昇給が保険料と厚生年金に入らない。入力の画面と同じ）
}

// ---- 書類で確かめる（前の「わからない」。0041 の追記 2026-10-31） ----

/**
 * シートの項目のうち、入力の画面で「書類で確かめる」を出す欄に入る物と、確かめる書類（入力の画面の checkDocuments.ts と同じ）。
 * ここの「わからない」は書類待ち（状態 unknown）で取り込み、面談のチェックリストに書類を添える。ほかの項目の「わからない」は推定にする
 */
const DOC_CHECK_ITEMS: Readonly<Record<string, string>> = {
  "hs.income.residentTax": "住民税の決定通知書",
  "hs.retirement.lumpSum": "会社の退職金規程・制度の資料",
  "hs.pension.months.total": "ねんきん定期便",
  "hs.pension.months.employee": "ねんきん定期便",
  "hs.loan.balance": "返済予定表",
  "hs.loan.balanceTotal": "返済予定表",
};

/** 退職一時金の目安を代わりにする働き方（入力の画面で、退職一時金の目安を出す会社員の働き方） */
const LUMP_SUM_TYPES = new Set(["regular", "contract"]);

/**
 * 退職一時金の代わりの値（入力の画面の retirementBenefits.ts の lumpEstimate と同じ考え方: 勤続は勤め先の働き方の期間〔終わりの無い期間は
 * 60歳になる前の月まで〕、辞め方は終わりが無いか60歳に達した月以後なら定年、ほかは自己都合。学歴では分けない。0118）
 */
function lumpSumSubstitute(m: Member, p: EmploymentPeriod): Estimate | null {
  const from = "at" in p.from ? p.from.at : null;
  const to = p.to === null ? addMonths(reachedMonth(m, 60), -1) : "at" in p.to ? p.to.at : null;
  if (from === null || to === null || ymIndex(to) < ymIndex(from)) return null;
  const years = Math.floor((ymIndex(to) - ymIndex(from) + 1) / 12);
  if (years <= 0) return null;
  const reason = p.to === null || ymIndex(to) >= ymIndex(reachedMonth(m, 60)) ? "mandatory" : "voluntary";
  const est = retirementLumpSumEstimate({ reason, yearsOfService: years, ageAtRetirement: ageAt(m, addMonths(to, 1)) });
  return est === null ? null : { value: est.value, basis: `${est.basis}（${reason === "mandatory" ? "定年" : "自己都合"}）` };
}

/**
 * 定期便の加入月数の代わりの値（入力の画面の pension.ts の substituteMonths と同じ: 国民年金＝20歳の月から書類の作成年月まで〔60歳になる前の月まで〕、
 * 厚生年金＝その月までの働き方の期間の厚生年金の月）
 */
function substituteMonths(h: Household, m: Member, asOf: string): { basic: number; employee: number; basis: string; basicBasis: string; employeeBasis: string } {
  const between = (a: string, b: string) => Math.max(0, ymIndex(b) - ymIndex(a) + 1);
  const from20 = reachedMonth(m, 20);
  const last = addMonths(reachedMonth(m, 60), -1);
  const end = ymIndex(asOf) < ymIndex(last) ? asOf : last;
  const basic = ymIndex(end) < ymIndex(from20) ? 0 : Math.min(480, between(from20, end));
  let employee = 0;
  for (const p of h.employmentPeriods ?? []) {
    if (p.member !== m.id || p.pensionCategory === undefined || p.pensionCategory === "none" || !("at" in p.from)) continue;
    const a = p.from.at;
    if (ymIndex(a) > ymIndex(asOf)) continue;
    const b0 = p.to === null ? asOf : "at" in p.to ? p.to.at : asOf;
    employee += between(a, ymIndex(b0) > ymIndex(asOf) ? asOf : b0);
  }
  employee = Math.min(900, employee);
  const b = `国民年金は20歳の月から書類の作成年月まで〔60歳まで〕の${String(basic)}か月`;
  const e = `厚生年金は働き方の期間の厚生年金の${String(employee)}か月`;
  // 2つとも代わりの値なら入力の画面の「加入月数を書類で確かめる」と同じ文。片方だけ（もう片方はシートの値）なら、その片方の文だけ
  return { basic, employee, basis: `代わりの値（${b}、${e}）`, basicBasis: `代わりの値（${b}）`, employeeBasis: `代わりの値（${e}）` };
}

// ---- 公的年金 ----

function importPension(c: Ctx, h: Household, adults: Adults, asOf: string): void {
  adults.forEach((m, i) => {
    const n = i + 1;
    if (m === undefined) return;
    const kind = c.get<string>("hs.pension.notice.type", n);
    const basic = c.get<number>("hs.pension.amount.basic", n);
    const employee = c.get<number>("hs.pension.amount.employee", n);
    if (kind.status !== "value") {
      if (basic.status === "value" || employee.status === "value") c.missing("hs.pension.notice.type", n, "年金の額がありますが、書類の種類がありません（取り込みませんでした）");
      return;
    }
    if (basic.status !== "value" && employee.status !== "value") {
      c.missing("hs.pension.amount.basic", n, "年金の額がありません（働き方から推計します）");
      return;
    }
    const id = c.newId();
    c.field(id, "hs.pension.notice.type", n, "pensionRecord.kind", "/kind", "confirmed");
    const asOfGot = c.get<string>("hs.pension.notice.asOf", n);
    let recAsOf = asOf;
    if (asOfGot.status === "value") {
      recAsOf = asOfGot.value;
      c.field(id, "hs.pension.notice.asOf", n, "pensionRecord.asOf", "/asOf", "confirmed");
      if (ymIndex(recAsOf) > ymIndex(asOf) + 1) c.contradiction("hs.pension.notice.asOf", n, "書類の作成年月が記入の年月より後です");
    } else {
      c.assume(`pension/${id}/asOf`, "仮の値（記入の年月）", { objectId: id, key: "hs.pension.notice.asOf", index: n, item: "pensionRecord.asOf", path: "/asOf" });
    }
    const rec: PensionRecord = { id, member: m.id, kind: kind.value as PensionRecord["kind"], asOf: recAsOf };
    if (rec.kind !== "receiving") {
      const total = c.get<number>("hs.pension.months.total", n);
      const emp = c.get<number>("hs.pension.months.employee", n);
      // 「わからない」は書類で確かめる（ねんきん定期便を見るまで代わりの値。入力の画面の「加入月数を書類で確かめる」と同じ。0041 の追記 2026-10-31）
      const sub = total.status === "unknown" || (total.status === "value" && emp.status === "unknown") ? substituteMonths(h, m, recAsOf) : null;
      const docRow = (basis: string) => ({ state: "unknown" as const, origin: { kind: "hearing" as const, ref: c.ref }, estimate: { method: "derived" as const, basis } });
      if (total.status === "unknown" && sub !== null) {
        const e = emp.status === "value" ? emp.value : sub.employee;
        rec.months = { basic: sub.basic, employee: e };
        const rows: Record<string, unknown> = { "pensionRecord.months/basic": docRow(emp.status === "value" || emp.status === "notApplicable" ? sub.basicBasis : sub.basis) };
        c.field(id, "hs.pension.months.total", n, "pensionRecord.months", "/months/basic", "unknown");
        if (emp.status === "value") c.field(id, "hs.pension.months.employee", n, "pensionRecord.months", "/months/employee", "confirmed");
        else if (emp.status !== "notApplicable") {
          rows["pensionRecord.months/employee"] = docRow(sub.basis);
          c.field(id, "hs.pension.months.employee", n, "pensionRecord.months", "/months/employee", "unknown");
        } else rec.months = { basic: sub.basic, employee: 0 };
        (rec as { valueStates?: Record<string, unknown> }).valueStates = rows;
      } else if (total.status === "value" && emp.status === "unknown" && sub !== null) {
        c.field(id, "hs.pension.months.total", n, "pensionRecord.months", "/months/basic", "confirmed");
        c.field(id, "hs.pension.months.employee", n, "pensionRecord.months", "/months/employee", "unknown");
        rec.months = { basic: total.value, employee: sub.employee };
        (rec as { valueStates?: Record<string, unknown> }).valueStates = { "pensionRecord.months/employee": docRow(sub.employeeBasis) };
      } else if (total.status === "value") {
        c.field(id, "hs.pension.months.total", n, "pensionRecord.months", "/months/basic", "confirmed");
        let e = 0;
        if (emp.status === "value") {
          e = emp.value;
          c.field(id, "hs.pension.months.employee", n, "pensionRecord.months", "/months/employee", "confirmed");
        } else if (emp.status !== "notApplicable") {
          c.assume(`pension/${id}/months`, "仮の値（厚生年金の加入期間を0か月として計算）", { objectId: id, key: "hs.pension.months.employee", index: n, item: "pensionRecord.months", path: "/months/employee" });
        }
        rec.months = { basic: total.value, employee: e };
        if (total.value > (ageAt(m, recAsOf) - 15) * 12 + 12) c.contradiction("hs.pension.months.total", n, "加入期間の合計が、年齢から考えられる長さを超えています");
      }
    }
    const amounts: NonNullable<PensionRecord["amounts"]> = {};
    if (basic.status === "value") {
      amounts.basic = c.confirmed(basic.value);
      c.field(id, "hs.pension.amount.basic", n, "pensionRecord.amounts", "/amounts/basic", "confirmed");
    }
    if (employee.status === "value") {
      amounts.employee = c.confirmed(employee.value);
      c.field(id, "hs.pension.amount.employee", n, "pensionRecord.amounts", "/amounts/employee", "confirmed");
    }
    rec.amounts = amounts;
    (h.pensionRecords ??= []).push(rec);
    c.candidate("pensionRecords", "pensionRecord.kind", rec);
  });
}

// ---- 住まいと住宅ローン ----

function importHousing(c: Ctx, h: Household, adults: Adults, asOf: string, baseMonth: string): void {
  const type = c.get<string>("hs.housing.type");
  const rent = c.get<number>("hs.housing.rent");
  const loanAxis = c.def.axes.find((a) => a.id === "loan");
  const simpleLoan = ["hs.loan.monthlyTotal", "hs.loan.balanceTotal"].some((k) => {
    const g = c.get<number>(k);
    return g.status === "value" && g.value > 0;
  });
  const hasLoan = simpleLoan || Array.from({ length: loanAxis?.count ?? 0 }, (_, i) => c.get("hs.loan.debtor", i + 1).status === "value").some(Boolean);
  let ownId: string | null = null;
  if (type.status !== "value") {
    c.missing("hs.housing.type", undefined, "お住まいの種類がありません（住居費なしとして計算します）");
  } else {
    const t = type.value;
    if (t === "own" && rent.status === "value" && rent.value > 0) c.contradiction("hs.housing.rent", undefined, "持ち家ですが、家賃の記入があります（取り込みませんでした）");
    if ((t === "rent" || t === "company" || t === "family") && hasLoan) c.contradiction("hs.housing.type", undefined, "住宅ローンの記入がありますが、お住まいが持ち家ではありません");
    // 持ち家でない方の、家を買った年月・値段の記入は取り込まない（持ち家の方の問い。0176 の追記 2026-11-09）
    if (t !== "own" && PURCHASE_KEYS.some((k) => c.get(k).status === "value")) c.contradiction(PURCHASE_KEYS.find((k) => c.get(k).status === "value") as string, undefined, "持ち家ではありませんが、家を買った年月・値段の記入があります（取り込みませんでした）");
    if (t !== "family") {
      const id = c.newId();
      c.field(id, "hs.housing.type", undefined, "residence.kind", "/kind", "confirmed");
      const since = c.get<string>("hs.housing.since");
      // 持ち家の方は、家を買った年月を住み始めにする（入力の画面の「買った年月（住み始め）」。0176）。無ければ住み始めた年月
      const bought = t === "own" ? c.get<string>(BOUGHT) : ({ status: "blank" } as const);
      let from: string;
      let fromKey = "hs.housing.since";
      if (bought.status === "value") {
        from = bought.value;
        fromKey = BOUGHT;
        c.field(id, BOUGHT, undefined, "residence.from", "/from/at", "confirmed");
        if (since.status === "value" && since.value !== bought.value)
          c.issues.push(issue("info", "H_IGNORED", `${c.label("hs.housing.since")}: 家を買った年月（${ymText(bought.value)}）と違うため、家を買った年月を住み始めにしました`, { key: "hs.housing.since" }));
      } else if (since.status === "value") {
        from = since.value;
        c.field(id, "hs.housing.since", undefined, "residence.from", "/from/at", "confirmed");
      } else {
        from = baseMonth;
        if (t === "own" && c.has(BOUGHT)) fromKey = BOUGHT;
        c.assume(`housing/res/${id}/from`, "仮の値（計算基準月から）", { objectId: id, key: fromKey, item: "residence.from", path: "/from/at" });
      }
      const r: Residence = { id, kind: t === "own" ? "own" : "rent", from: { at: from }, to: null };
      let ok = true;
      if (t === "own") {
        const tax = c.moneyBox(id, "hs.housing.propertyTax", undefined, "residence.propertyTax", "/propertyTax/annual", null);
        if (tax !== null) r.propertyTax = { annual: tax };
        const mt = c.moneyBox(id, "hs.housing.maintenance", undefined, "residence.maintenance", "/maintenance/monthly", null);
        if (mt !== null) r.maintenance = { monthly: mt };
        const priced = ownedValuation(c, r, from, fromKey, baseMonth);
        if (c.get("hs.housing.propertyTax").status === "blank") c.check("hs.housing.propertyTax", undefined, "missing", priced ? "固定資産税が未記入（買った値段から目安を出します）" : "固定資産税が未記入");
      } else {
        const b = c.moneyBox(id, "hs.housing.rent", undefined, "residence.rent", "/rent/monthly", null);
        if (b === null || b.state === "notApplicable") {
          c.missing("hs.housing.rent", undefined, "賃貸・社宅ですが、家賃がありません（住居費なしとして計算します）", "error");
          ok = false;
        } else r.rent = { monthly: b };
      }
      if (ok) {
        (h.residences ??= []).push(r);
        c.candidate("residences", "residence.kind", r);
        if (r.kind === "own") ownId = r.id;
      }
    }
  }

  for (let n = 1; n <= (loanAxis?.count ?? 0); n++) importLoan(c, h, adults, n, asOf, baseMonth, ownId);
  importSimpleLoan(c, h, adults, asOf);
}

const BOUGHT = "hs.housing.purchaseMonth";
const PRICE = "hs.housing.purchasePrice";
const LAND = "hs.housing.purchaseLand";
/** 持ち家の方に聞く、家を買った年月・値段（シンプルの版3・詳細の版5 から。0176 の追記 2026-11-09） */
const PURCHASE_KEYS = [BOUGHT, PRICE, LAND];
const manText = (yen: number): string => `${(yen / 10000).toLocaleString("ja-JP", { maximumFractionDigits: 4 })}万円`;

/**
 * 今住んでいる持ち家の買った値段（0176 の追記 2026-11-09）: 入力の画面の標準の3欄（買った年月〔住み始め〕・買った値段・うち土地の値段）と同じ所に入れる。
 * - 買った値段 → valuation.value（範囲の答えは推定・確かさ概算）、その額の時点 → valuation.asOf（住み始め。計算基準月より後なら計算基準月）。
 *   評価の入れ方（valuation.basis: purchase）と住み始めについてくる印は、アプリが承認のときに入力の画面と同じ決まりで付ける
 *   （app/src/workspace/hearing/ownedHome.ts。入れ方を書いていない前の版の世帯の評価に、前回の値のまま答えた差が出ないように、ここでは書かない）
 * - うち土地の値段 → valuation.landShare（土地÷合計。入力の画面と同じ12桁の切り上げ）。空欄・わからない・該当なしなら書かず、前提条件の土地の割合で分ける。
 *   答えの無い欄にするので、今の世帯の土地の割合は残る（買った値段だけ答え直したときは、入力の画面で合計を直したときと同じく、同じ割合のまま）
 * - 買った値段が空欄・わからない・該当なしなら評価を書かない（今の世帯の評価はそのまま）。買った値段を取り込んだら true
 */
function ownedValuation(c: Ctx, r: Residence, from: string, fromKey: string, baseMonth: string): boolean {
  if (!c.has(PRICE)) return false;
  const price = c.get<number>(PRICE);
  const land = c.get<number>(LAND);
  if (price.status !== "value" || !(price.value > 0)) {
    if (land.status === "value") c.missing(PRICE, undefined, "土地の値段はありますが、買った値段（土地と建物の合計）がありません（土地の値段は取り込みませんでした）");
    else if (price.status === "blank") c.check(PRICE, undefined, "missing", "買った値段が未記入（今の家の評価額を推計できません）");
    return false;
  }
  const id = r.id;
  const v: NonNullable<Residence["valuation"]> = { value: c.box(PRICE, undefined, price.value), asOf: ymIndex(from) > ymIndex(baseMonth) ? baseMonth : from };
  c.field(id, PRICE, undefined, "residence.valuation", "/valuation/value", "confirmed");
  // その額の時点は住み始めと同じ答えから（買った年月が無ければ、住み始めと同じく仮の値。答えが無ければ今の世帯の時点を残す）
  c.field(id, fromKey, undefined, "residence.valuation", "/valuation/asOf", c.get(fromKey).status === "value" ? "confirmed" : "assumed");
  if (land.status === "value") {
    if (land.value > price.value) c.contradiction(LAND, undefined, `土地の値段（${manText(land.value)}）が買った値段（${manText(price.value)}）より大きいため、土地の値段は取り込みませんでした（合計の目安の割合で分けます）`);
    else {
      v.landShare = shareOfLand(land.value, price.value);
      // 合計が範囲の答えなら、割合も範囲の真ん中から出した推定
      c.field(id, LAND, undefined, "residence.valuation", "/valuation/landShare", c.rangeOf(PRICE) !== null ? "estimated" : "confirmed");
    }
  } else c.field(id, LAND, undefined, "residence.valuation", "/valuation/landShare", "estimated", undefined, "notAsked");
  r.valuation = v;
  return true;
}

/** 簡易版の住宅ローンに仮に置く金利（今返している住宅ローンの目安。入力の画面の今の残高から入れる住宅ローンの標準の値と同じ。housingEstimates.ts） */
const SIMPLE_LOAN_RATE = currentMortgageRateEstimate().rate;
const SIMPLE_LOAN_PCT = pctText(SIMPLE_LOAN_RATE);
const SIMPLE_LOAN_NOTE =
  "シンプルのシートの残高と毎月の返済額から置いた住宅ローンです（入れ方は「今の残高から」）。借りた年月・借入額・金利・返済期間は仮の値なので、面談で返済予定表を見て直してください。住宅ローン控除の条件はお聞きしていないため、控除は計算しません";

/**
 * 簡易版の住宅ローン（残高と毎月の返済額の合計）: 入力の画面の住まい・ローンのカードの「今の残高から」の形で1本にまとめて置く。
 * - 借りたのは記入の年月・借入額は残高（仮）、金利は今返している住宅ローンの目安（仮。種類は変動金利）、ローンの名義はご本人（仮）
 * - 残高と返済額があれば、仮の金利で返済期間を逆算する。返済額だけなら、標準の返済期間（35年・80歳まで）と仮の金利で残高を逆算する（推定）
 * - 残高だけなら、返済期間は標準の値（仮）
 */
function importSimpleLoan(c: Ctx, h: Household, adults: Adults, asOf: string): void {
  const PAY = "hs.loan.monthlyTotal";
  const BAL = "hs.loan.balanceTotal";
  if (!c.has(PAY) && !c.has(BAL)) return;
  const pay = c.get<number>(PAY);
  const bal = c.get<number>(BAL);
  const payV = pay.status === "value" && pay.value > 0 ? pay.value : null;
  const balV = bal.status === "value" && bal.value > 0 ? bal.value : null;
  if (payV === null && balV === null) {
    if (pay.status === "unknown" || bal.status === "unknown") c.check(BAL, undefined, "unknown", "住宅ローンの残高・返済額がわからない（面談で返済予定表を見て入れてください）");
    return;
  }
  const self = adults[0];
  const id = c.newId();
  const rate = Number(SIMPLE_LOAN_RATE);
  const key = balV !== null ? BAL : PAY;
  const at = (k: string, item: string, path: string) => ({ objectId: id, key: k, item, path });
  const std = standardTermMonths(self, asOf);
  let termMonths = std;
  let balance: ValueBox<number>;
  let amount: number;
  if (balV !== null) {
    amount = balV;
    balance = c.box(BAL, undefined, balV);
    c.field(id, BAL, undefined, "debt.balance", "/balance", "confirmed");
    const m = payV === null ? null : monthsFromPayment(balV, payV, rate);
    if (payV !== null && m !== null && m <= 600) {
      termMonths = m;
      c.assume(`housing/debt/${id}/term`, `逆算（残高 ${balV.toLocaleString("ja-JP")}円・毎月の返済額 ${payV.toLocaleString("ja-JP")}円・仮の金利 年${SIMPLE_LOAN_PCT}から ${m}か月）`, at(PAY, "debt.repayment", "/repayment/termMonths"));
    } else {
      if (payV !== null) c.contradiction(PAY, undefined, "毎月の返済額では、残高を返しきれない計算になります（返済期間は既定の値で計算しました。面談で確かめてください）");
      else c.check(PAY, undefined, pay.status === "unknown" ? "unknown" : "missing", "毎月の返済額が無いため、返済期間を既定の値で計算します");
      c.assume(`housing/debt/${id}/term`, `仮の値（返済期間${String(std / 12)}年。完済が80歳を超えないように）`, at(BAL, "debt.repayment", "/repayment/termMonths"));
    }
  } else {
    const p = payV as number;
    amount = principalFromPayment(p, rate, std) ?? 0;
    const basis = `毎月の返済額 ${p.toLocaleString("ja-JP")}円・仮の金利 年${SIMPLE_LOAN_PCT}・返済期間${String(std / 12)}年から逆算`;
    const e = c.estimated({ value: amount, basis }, "derived");
    balance = bal.status === "unknown" ? { state: "unknown", origin: { kind: "hearing", ref: c.ref }, substitute: e } : c.rangeOf(PAY) !== null ? { ...e, certainty: "rough" } : e;
    c.field(id, PAY, undefined, "debt.balance", "/balance", bal.status === "unknown" ? "unknown" : "estimated");
    c.assume(`housing/debt/${id}/term`, `仮の値（返済期間${String(std / 12)}年。完済が80歳を超えないように）`, at(PAY, "debt.repayment", "/repayment/termMonths"));
  }
  c.assume(`housing/debt/${id}/fromBalance`, "仮の値（残高の時点〔記入の年月〕から借りたとみなす。借りた年月・借入額は面談で確かめてください）", at(key, "debt.principal", "/principal"));
  c.field(id, key, undefined, "debt.start", "/start/at", "assumed");
  c.assume(`housing/debt/${id}/rate`, `仮の値（${currentMortgageRateEstimate().basis}として計算）`, at(key, "debt.rateSchedule", "/rateSchedule/0/rate"));
  c.assume(`housing/debt/${id}/debtor`, "仮の値（ご本人が借りているとして計算）", at(key, "debt.debtors", "/debtors/0/member"));
  const d: Debt = {
    id,
    kind: "mortgage",
    debtors: [{ member: self.id, role: "primary" }],
    principal: amount,
    start: { at: asOf },
    balance,
    balanceAsOf: asOf,
    rateSchedule: [{ from: { at: asOf }, type: "variable", rate: SIMPLE_LOAN_RATE }],
    repayment: { method: "equalPayment", termMonths },
  };
  (h.debts ??= []).push(d);
  c.loanEntry[id] = "balance";
  c.candidate("debts", "debt.kind", d, undefined, SIMPLE_LOAN_NOTE);
}

/**
 * 住宅ローン控除の仮の条件を置く最初の入居の年（平成26年。計算エンジンの控除の制度データがこの年の入居から。入力の画面の
 * app/src/workspace/input/housingCredit.ts と同じ決まり）
 */
const CREDIT_DATA_FROM_YEAR = 2014;
const CREDIT_ASSUMED = "仮の条件（入居は借入の年月・新築は省エネ基準適合住宅、中古は一般の住宅・持分は債務者が100%）で住宅ローン控除を計算しています";
/** 2028年からの入居の新築の仮の条件（省エネ基準適合住宅は控除が無いので ZEH水準省エネ住宅。入力の画面の CREDIT_ASSUMED_ZEH と同じ決まり） */
const CREDIT_ASSUMED_ZEH =
  "仮の条件（入居は借入の年月・新築はZEH水準省エネ住宅〔2028年からの入居の新築は、省エネ基準適合住宅だと控除がありません〕、中古は一般の住宅・持分は債務者が100%）で住宅ローン控除を計算しています。省エネ基準適合住宅なら、住宅の種類を選び直してください";
const PROPERTY_TYPE_TEXT: Readonly<Record<"energySaving" | "zeh" | "certified", string>> = { energySaving: "省エネ基準適合住宅", zeh: "ZEH水準省エネ住宅", certified: "認定住宅" };

function importLoan(c: Ctx, h: Household, adults: Adults, n: number, asOf: string, baseMonth: string, ownId: string | null): void {
  const debtor = c.get<string>("hs.loan.debtor", n);
  const others = ["hs.loan.principal", "hs.loan.start", "hs.loan.termYears", "hs.loan.rate"];
  if (debtor.status !== "value") {
    if (others.some((k) => c.get(k, n).status === "value")) c.missing("hs.loan.debtor", n, "住宅ローンの記入がありますが、ローンの名義がありません（取り込みませんでした）");
    return;
  }
  const member = debtor.value === "adult.2" ? adults[1] : adults[0];
  if (member === undefined) {
    c.contradiction("hs.loan.debtor", n, "ローンの名義が配偶者の方ですが、配偶者の方の記入がありません（取り込みませんでした）", "error");
    return;
  }
  const principal = c.value<number>("hs.loan.principal", n);
  const start = c.value<string>("hs.loan.start", n);
  const years = c.value<number>("hs.loan.termYears", n);
  const rate = c.value<string>("hs.loan.rate", n);
  const lacking = [
    principal === null ? "借入額" : null,
    start === null ? "借りた年月" : null,
    years === null ? "返済期間" : null,
    rate === null ? "金利" : null,
  ].filter((x): x is string => x !== null);
  if (lacking.length > 0 || principal === null || start === null || years === null || rate === null) {
    c.missing("hs.loan.debtor", n, `住宅ローンの ${lacking.join("・")} がありません（このローンは取り込みませんでした。面談で確かめてください）`, "error");
    return;
  }
  const id = c.newId();
  for (const [k, item, path] of [
    ["hs.loan.debtor", "debt.debtors", "/debtors/0/member"],
    ["hs.loan.principal", "debt.principal", "/principal"],
    ["hs.loan.start", "debt.start", "/start/at"],
    ["hs.loan.termYears", "debt.repayment", "/repayment/termMonths"],
    ["hs.loan.rate", "debt.rateSchedule", "/rateSchedule/0/rate"],
  ] as const) c.field(id, k, n, item, path, "confirmed");
  const at = (key: string, item: string, path: string) => ({ objectId: id, key, index: n, item, path });
  let rateType = c.value<string>("hs.loan.rateType", n);
  if (rateType === null) {
    rateType = "variable";
    c.assume(`housing/debt/${id}/rateType`, "仮の値（変動金利として計算）", at("hs.loan.rateType", "debt.rateSchedule", "/rateSchedule/0/type"));
  } else c.field(id, "hs.loan.rateType", n, "debt.rateSchedule", "/rateSchedule/0/type", "confirmed");
  let method = c.value<string>("hs.loan.method", n);
  if (method === null) {
    method = "equalPayment";
    c.assume(`housing/debt/${id}/method`, "仮の値（元利均等返済として計算）", at("hs.loan.method", "debt.repayment", "/repayment/method"));
  } else c.field(id, "hs.loan.method", n, "debt.repayment", "/repayment/method", "confirmed");
  const d: Debt = {
    id,
    kind: "mortgage",
    debtors: [{ member: member.id, role: "primary" }],
    principal,
    start: { at: start },
    rateSchedule: [{ from: { at: start }, type: rateType as "fixed" | "variable" | "fixedPeriod", rate }],
    repayment: { method: method as "equalPayment" | "equalPrincipal", termMonths: years * 12 },
  };
  const bal = c.get<number>("hs.loan.balance", n);
  if (bal.status === "value") {
    d.balance = c.confirmed(bal.value);
    d.balanceAsOf = asOf;
    c.field(id, "hs.loan.balance", n, "debt.balance", "/balance", "confirmed");
    if (bal.value > principal) c.contradiction("hs.loan.balance", n, "いまの残高が借入額より多くなっています");
  } else c.check("hs.loan.balance", n, bal.status === "unknown" ? "unknown" : "missing", "残高が無いため、借入額と金利から計算します（いまの金利を借りたときから使うため、ずれることがあります）");
  const cl = c.get<string>("hs.loan.creditLife", n);
  if (cl.status === "value" && cl.value === "covered") {
    d.creditLife = { covered: [member.id] };
    c.field(id, "hs.loan.creditLife", n, "debt.creditLife", "/creditLife/covered", "confirmed");
  }
  if (ymIndex(start) > ymIndex(baseMonth)) c.contradiction("hs.loan.start", n, "借りた年月が計算基準月より後です");
  if (ymIndex(start) + years * 12 <= ymIndex(baseMonth)) c.contradiction("hs.loan.termYears", n, "返済期間がもう終わっています");
  // 住宅ローン控除の条件（入居の年月・住宅の種類・持分）はシートで聞かないので、仮の条件で計算する（入力の画面と同じ。「仮」の印）
  let note = "住宅ローン控除の条件（入居の年月・住宅の種類・持分）はシートで聞いていません。";
  if (Number(start.slice(0, 4)) >= CREDIT_DATA_FROM_YEAR) {
    const ev = { id: c.newId(), kind: "moveIn", at: { at: start } };
    h.events.push(ev);
    // 新築は入居の月に控除のある最も控えめな種類（入力の画面の仮の条件と同じ決まり。2028年からの入居は ZEH水準省エネ住宅）
    const propertyType = provisionalNewType(start);
    d.housing = { ...(ownId !== null ? { residence: ownId } : {}), moveIn: ev.id, propertyType, newBuild: true };
    c.assume(`housing/debt/${id}/credit`, propertyType === "zeh" ? CREDIT_ASSUMED_ZEH : CREDIT_ASSUMED, at("hs.loan.start", "debt.housing", "/housing"));
    note += `入居は借りた年月・新築の${PROPERTY_TYPE_TEXT[propertyType]}・借りている方の持分100%とした仮の条件で控除を計算します（入力の画面では「仮」の印が付きます）。違うときは面談で確かめてください`;
  } else note += `${CREDIT_DATA_FROM_YEAR - 1}年以前に借りたローンの控除は計算しません`;
  (h.debts ??= []).push(d);
  c.candidate("debts", "debt.kind", d, undefined, note);
}

// ---- 教育 ----

const AFTER: Readonly<Record<string, EducationStage>> = {
  national: { stage: "university", sector: "national" },
  public: { stage: "university", sector: "public" },
  privateHumanities: { stage: "university", sector: "private", field: "humanities" },
  privateScience: { stage: "university", sector: "private", field: "science" },
  juniorCollege: { stage: "juniorCollege", sector: "private" },
  vocational: { stage: "vocational", sector: "private" },
};

function importEducation(c: Ctx, h: Household): void {
  const children = h.members.filter((m) => m.kind === "child");
  const axis = c.def.axes.find((a) => a.id === "child");
  const childIds = new Map<number, Member>();
  // 子の番号（シートの何番目か）→ 構成員。取り込まなかった番号は飛ばす
  let ci = 0;
  for (let n = 1; n <= (axis?.count ?? 0); n++) {
    if (c.get("hs.family.child.birthYearMonth", n).status === "value") childIds.set(n, children[ci++] as Member);
  }
  const keys = ["hs.education.elementary", "hs.education.juniorHigh", "hs.education.highSchool", "hs.education.after", "hs.education.living"];
  for (let n = 1; n <= (axis?.count ?? 0); n++) {
    const school = c.value<string>("hs.education.school", n);
    if (school !== null && school !== "") c.memo.push(`【考えている学校名（${c.label("hs.education.school", n).split(" ")[0]}）】${school}`);
    const any = keys.some((k) => c.get(k, n).status === "value");
    if (!any) continue;
    const child = childIds.get(n);
    if (child === undefined) {
      c.contradiction("hs.education.after", n, "教育の記入がありますが、このお子さまの生年月がありません（取り込みませんでした）");
      continue;
    }
    const id = c.newId();
    const stages: EducationStage[] = [];
    const simple: [string, string][] = [
      ["hs.education.elementary", "elementary"],
      ["hs.education.juniorHigh", "juniorHigh"],
      ["hs.education.highSchool", "highSchool"],
    ];
    for (const [k, stage] of simple) {
      const v = c.value<string>(k, n);
      if (v === null) continue;
      c.field(id, k, n, "goal.education", `/education/stages/${stages.length}`, "confirmed");
      stages.push({ stage, sector: v as "public" | "private" });
    }
    const after = c.get<string>("hs.education.after", n);
    if (after.status === "value") {
      const s: EducationStage = { ...(AFTER[after.value] as EducationStage) };
      c.field(id, "hs.education.after", n, "goal.education", `/education/stages/${stages.length}`, "confirmed");
      const living = c.value<string>("hs.education.living", n);
      if (living !== null) {
        s.living = living as "home" | "away";
        c.field(id, "hs.education.living", n, "goal.education", `/education/stages/${stages.length}/living`, "confirmed");
      }
      stages.push(s);
    } else if (c.get("hs.education.living", n).status === "value") {
      c.contradiction("hs.education.living", n, "通い方の記入がありますが、高校の後の進路がありません（取り込みませんでした）");
    }
    const g: Goal = { id, kind: "education", owner: child.id, education: { stages } };
    (h.goals ??= []).push(g);
    c.candidate("goals", "goal.education", g);
  }
}

// ---- 貯蓄・投資 ----

const ACCOUNT_KEYS: readonly [string, string, string | null][] = [
  ["hs.assets.deposit", "deposit", null],
  ["hs.assets.taxable", "taxable", null],
  ["hs.assets.nisa", "nisa", "hs.assets.nisaMonthly"],
  ["hs.assets.ideco", "ideco", "hs.assets.idecoMonthly"],
  ["hs.assets.corporateDc", "corporateDc", null],
];

function importAssets(c: Ctx, h: Household, adults: Adults, periods: Map<string, EmploymentPeriod>, asOf: string): void {
  adults.forEach((m, i) => {
    const n = i + 1;
    if (m === undefined) return;
    for (const [key, kind, monthlyKey] of ACCOUNT_KEYS) {
      const g = c.get<number>(key, n);
      const monthly = monthlyKey === null ? null : c.get<number>(monthlyKey, n);
      const hasMonthly = monthly !== null && monthly.status === "value" && monthly.value > 0;
      if (g.status !== "value" && g.status !== "unknown" && !hasMonthly) continue;
      const id = c.newId();
      let mv: ValueBox<number>;
      if (g.status === "value") {
        mv = c.box(key, n, g.value);
        c.field(id, key, n, "account.marketValue", "/marketValue", "confirmed");
      } else if (g.status === "unknown") {
        // 口座の残高は書類で確かめる欄でないので、「わからない」は推定にする（0041 の追記 2026-10-31）
        mv = c.unknownAsEstimate(key, n, { value: 0, basis: "残高がわからないため0円として計算" }, "derived");
        c.field(id, key, n, "account.marketValue", "/marketValue", "estimated");
      } else {
        mv = c.estimated({ value: 0, basis: "積立の記入があり残高の記入が無いため0円として計算" }, "derived");
        c.field(id, key, n, "account.marketValue", "/marketValue", "estimated");
      }
      const a: Account = { id, kind, owner: m.id, marketValue: mv, asOf, contributions: [] };
      // 簡易版のご家族の合計: 名義はご本人、投資は口座の種類も仮（内訳を聞いていない）
      const from = c.src(key, n).key;
      if (from === "hs.assets.depositTotal" || from === "hs.assets.investTotal" || from === "hs.assets.depositTotalRange" || from === "hs.assets.investTotalRange") {
        c.assume(`sav/${id}/owner`, "仮の値（ご家族の合計を、ご本人の名義として計算）", { objectId: id, key, index: n, item: "account.owner", path: "/owner" });
        if (kind === "taxable") c.assume(`sav/${id}/kind`, "仮の値（NISA・iDeCo・株・投資信託の合計を、課税口座の株式・投資信託として計算。内訳は面談で確かめて口座ごとに分けてください）", { objectId: id, key, index: n, item: "account.kind", path: "/kind" });
      }
      if (hasMonthly && monthlyKey !== null && monthly?.status === "value") {
        const until = periods.get(m.id)?.to ?? null;
        a.contributions.push({ from: { at: addMonths(asOf, 1) }, to: until, monthly: monthly.value });
        c.field(id, monthlyKey, n, "account.contributions", "/contributions/0/monthly", "confirmed");
      }
      h.accounts.push(a);
      c.candidate("accounts", "account.kind", a);
    }
  });
  if (!h.accounts.some((a) => a.kind === "deposit")) {
    // 決済口座（年の収支が入る預金）が無いと計算できないので、ご本人の預金を0円で置く
    const id = c.newId();
    const a: Account = { id, kind: "deposit", owner: adults[0].id, marketValue: c.estimated({ value: 0, basis: "預貯金の記入が無いため0円として計算" }, "derived"), asOf, contributions: [] };
    c.field(id, "hs.assets.deposit", 1, "account.marketValue", "/marketValue", "estimated");
    c.missing("hs.assets.deposit", 1, "預貯金の記入がありません（0円として計算します）");
    h.accounts.unshift(a);
    c.candidate("accounts", "account.kind", a);
  }
}

// ---- 会社役員の方の会社とのお金（0105） ----

const COMPANY_ACCOUNTS: readonly [string, NonNullable<Account["subtype"]>, string][] = [
  ["hs.company.shares", "ownCompanyShares", "出資額"],
  ["hs.company.loanToCompany", "loanToCompany", "会社への貸付金"],
];
const COMPANY_LOAN = "hs.company.loanFromCompany";
const COMPANY_LOAN_MONTHLY = "hs.company.loanFromCompanyMonthly";
/** 会社からの借入金の仮の利率（入力の画面の会社からの借入金の既定の値と同じ: 利息なし） */
const COMPANY_LOAN_RATE = "0";
/** 毎月の返済額が無いときの返済期間（入力の画面の「今の残高から」のほかのローンと同じ: 5年） */
const COMPANY_LOAN_TERM = 60;
/** 毎月の返済額から逆算した返済期間の仮の印の理由の頭（書き出しで、返済額を記入し直してよい期間かの見分けに使う） */
export const DERIVED_TERM = "逆算";
const COMPANY_LOAN_NOTE =
  "会社からの借入金の残高から置いた借入です（入れ方は「今の残高から」）。利率は契約で決めた率を入れてください（入れなければ利息なしで計算します）。借りた年月・借入額・返済期間は仮の値なので、面談で確かめてください";

/** 会社の借入の連帯保証の額（構成員の欄。負債には入れない） */
function companyGuarantee(c: Ctx, m: Member, n: number): void {
  const K = "hs.company.guarantee";
  if (!c.has(K)) return;
  const g = c.get<number>(K, n);
  if (g.status === "value") {
    m.companyGuarantee = c.confirmed(g.value);
    c.field(m.id, K, n, "member.companyGuarantee", "/companyGuarantee", "confirmed");
  } else if (g.status === "notApplicable") {
    m.companyGuarantee = c.notApplicable();
    c.field(m.id, K, n, "member.companyGuarantee", "/companyGuarantee", "notApplicable");
  } else if (g.status === "unknown") {
    // わからない（状態 unknown）。値の箱の決まりで代わりの値が要るので0円を置く（計算には使わない欄。面談のチェックリストには載る）
    m.companyGuarantee = c.unknown({ value: 0, basis: "連帯保証の額がわからないため0円（計算には使わない）" }, "derived");
    c.field(m.id, K, n, "member.companyGuarantee", "/companyGuarantee", "unknown");
  }
}

/** シートの確定申告の仕方の答え → 申告の仕方と青色申告特別控除の区分（0155） */
const TAX_RETURN_ANSWERS: Readonly<Record<string, NonNullable<Member["taxReturn"]>>> = {
  blueElectronic: { method: "blue", blueDeduction: "electronic" },
  blueDoubleEntry: { method: "blue", blueDeduction: "doubleEntry" },
  blueSimple: { method: "blue", blueDeduction: "simple" },
  white: { method: "white" },
};

/**
 * 確定申告の仕方（構成員の欄。自営業の方だけ。0155）。空欄・わからない・該当なしは入れない（入力の画面で白色の推定）。
 * 働き方が自営業でない人の答えは取り込まずに知らせる（事業所得の欄と同じ）
 */
function taxReturn(c: Ctx, m: Member, n: number): void {
  const K = "hs.income.taxReturn";
  if (!c.has(K)) return;
  const g = c.get<string>(K, n);
  if (g.status !== "value") return;
  if (c.value<string>("hs.work.type", n) !== "selfEmployed") {
    c.contradiction(K, n, "確定申告の仕方の記入がありますが、働き方が自営業ではありません（取り込みませんでした）");
    return;
  }
  const t = TAX_RETURN_ANSWERS[g.value];
  if (t === undefined) return;
  m.taxReturn = { ...t };
  c.field(m.id, K, n, "member.taxReturn", "/taxReturn/method", "confirmed");
  if (t.blueDeduction !== undefined) c.field(m.id, K, n, "member.taxReturn", "/taxReturn/blueDeduction", "confirmed");
}

/**
 * 自社株の出資額・会社への貸付金（その他の資産の器。細目つき）と、会社からの借入金（ほかのローン。細目 companyLoan）。
 * 借入金は入力の画面の「今の残高から」の形: 借りたのは記入の年月・借入額は残高（仮）、利率は利息なし（仮）、
 * 毎月の返済額があれば利息なしとして返済期間を逆算し、無ければ5年で返すとみなす（仮）
 */
function importCompany(c: Ctx, h: Household, adults: Adults, asOf: string): void {
  adults.forEach((m, i) => {
    const n = i + 1;
    if (m === undefined) return;
    for (const [key, subtype, what] of COMPANY_ACCOUNTS) {
      if (!c.has(key)) continue;
      const g = c.get<number>(key, n);
      if (g.status !== "value" && g.status !== "unknown") continue;
      const id = c.newId();
      let mv: ValueBox<number>;
      if (g.status === "value") {
        mv = c.box(key, n, g.value);
        c.field(id, key, n, "account.marketValue", "/marketValue", "confirmed");
      } else {
        mv = c.unknownAsEstimate(key, n, { value: 0, basis: `${what}がわからないため0円として計算` }, "derived");
        c.field(id, key, n, "account.marketValue", "/marketValue", "estimated");
      }
      const a: Account = { id, kind: "otherAsset", subtype, owner: m.id, marketValue: mv, asOf, contributions: [] };
      h.accounts.push(a);
      c.candidate("accounts", "account.kind", a);
    }
    importCompanyLoan(c, h, m, n, asOf);
  });
}

function importCompanyLoan(c: Ctx, h: Household, m: Member, n: number, asOf: string): void {
  if (!c.has(COMPANY_LOAN)) return;
  const bal = c.get<number>(COMPANY_LOAN, n);
  const pay = c.get<number>(COMPANY_LOAN_MONTHLY, n);
  const payV = pay.status === "value" && pay.value > 0 ? pay.value : null;
  if (bal.status !== "value" || bal.value <= 0) {
    if (payV !== null && bal.status !== "unknown") c.missing(COMPANY_LOAN, n, "毎月の返済額がありますが、残高がありません（取り込みませんでした）");
    return;
  }
  const id = c.newId();
  const at = (k: string, item: string, path: string) => ({ objectId: id, key: k, index: n, item, path });
  c.field(id, COMPANY_LOAN, n, "debt.balance", "/balance", "confirmed");
  let termMonths = COMPANY_LOAN_TERM;
  const months = payV === null ? null : monthsFromPayment(bal.value, payV, Number(COMPANY_LOAN_RATE));
  if (payV !== null && months !== null && months <= 600) {
    termMonths = months;
    c.assume(`housing/debt/${id}/term`, `${DERIVED_TERM}（残高 ${bal.value.toLocaleString("ja-JP")}円・毎月の返済額 ${payV.toLocaleString("ja-JP")}円・利息なしとして ${months}か月）`, at(COMPANY_LOAN_MONTHLY, "debt.repayment", "/repayment/termMonths"));
  } else {
    if (payV !== null) c.contradiction(COMPANY_LOAN_MONTHLY, n, "毎月の返済額では、残高を50年で返しきれない計算になります（返済期間は5年として計算しました。面談で確かめてください）");
    c.assume(`housing/debt/${id}/term`, "仮の値（毎月の返済額が無いため、5年で返すとみなしています）", at(COMPANY_LOAN, "debt.repayment", "/repayment/termMonths"));
  }
  c.assume(`housing/debt/${id}/fromBalance`, "仮の値（残高の時点〔記入の年月〕から借りたとみなす。借りた年月・借入額は面談で確かめてください）", at(COMPANY_LOAN, "debt.principal", "/principal"));
  c.field(id, COMPANY_LOAN, n, "debt.start", "/start/at", "assumed");
  c.assume(`housing/debt/${id}/rate`, "仮の値（会社からの借入の利率は契約で決めた率を入れてください。入れなければ利息なしで計算します）", at(COMPANY_LOAN, "debt.rateSchedule", "/rateSchedule/0/rate"));
  const d: Debt = {
    id,
    kind: "other",
    subtype: "companyLoan",
    debtors: [{ member: m.id, role: "primary" }],
    principal: bal.value,
    start: { at: asOf },
    balance: c.box(COMPANY_LOAN, n, bal.value),
    balanceAsOf: asOf,
    rateSchedule: [{ from: { at: asOf }, type: "fixed", rate: COMPANY_LOAN_RATE }],
    repayment: { method: "equalPayment", termMonths },
  };
  (h.debts ??= []).push(d);
  c.loanEntry[id] = "balance";
  c.candidate("debts", "debt.kind", d, undefined, COMPANY_LOAN_NOTE);
}

// ---- 保険 ----

/** 死亡保険金を主契約の死亡保障として取り込む保険の種類 */
export const DEATH_TEMPLATES: ReadonlySet<string> = new Set(["insurance.term", "insurance.wholeLife", "insurance.variable", "insurance.foreignCurrency"]);

function deductionOf(template: string, contractDate: string): InsuranceContract["deductionCategory"] {
  const regime = ymIndex(contractDate) >= ymIndex("2012-01") ? "new" : "old";
  if (template === "insurance.nonLife") return { type: "earthquake" };
  if (template === "insurance.medical" || template === "insurance.cancer") return { type: "careMedical", regime };
  if (template === "insurance.privateAnnuity") return { type: "pension", regime };
  return { type: "general", regime };
}

function importInsurance(c: Ctx, h: Household, adults: Adults, baseMonth: string): void {
  const axis = c.def.axes.find((a) => a.id === "policy");
  const children = h.members.filter((m) => m.kind === "child");
  const childAt = new Map<number, Member>();
  let ci = 0;
  const caxis = c.def.axes.find((a) => a.id === "child");
  for (let n = 1; n <= (caxis?.count ?? 0); n++) if (c.get("hs.family.child.birthYearMonth", n).status === "value") childAt.set(n, children[ci++] as Member);
  const person = (code: string): Member | undefined => {
    const [k, i] = code.split(".") as [string, string];
    if (k === "adult") return adults[Number(i) - 1];
    return childAt.get(Number(i));
  };
  for (let n = 1; n <= (axis?.count ?? 0); n++) {
    const t = c.get<string>("hs.insurance.type", n);
    if (t.status !== "value") {
      if (c.get("hs.insurance.premium", n).status === "value") c.missing("hs.insurance.type", n, "保険料の記入がありますが、保険の種類がありません（取り込みませんでした）");
      continue;
    }
    const premium = c.value<number>("hs.insurance.premium", n);
    if (premium === null) {
      c.missing("hs.insurance.premium", n, "保険料がありません（この保険は取り込みませんでした）", "error");
      continue;
    }
    const id = c.newId();
    const at = (key: string, item: string, path: string) => ({ objectId: id, key, index: n, item, path });
    c.field(id, "hs.insurance.type", n, "insurance.template", "/template", "confirmed");
    c.field(id, "hs.insurance.premium", n, "insurance.premium", "/premium/amount", "confirmed");
    const holderCode = c.value<string>("hs.insurance.policyholder", n);
    let holder = holderCode === null ? undefined : person(holderCode);
    if (holderCode !== null && holder === undefined) c.contradiction("hs.insurance.policyholder", n, "契約者に、記入の無い方が選ばれています（ご本人として取り込みました）");
    if (holder === undefined) {
      holder = adults[0];
      c.assume(`ins/${id}/holder`, "仮の値（ご本人）", at("hs.insurance.policyholder", "insurance.policyholder", "/policyholder"));
    } else c.field(id, "hs.insurance.policyholder", n, "insurance.policyholder", "/policyholder", "confirmed");
    const insuredCode = c.value<string>("hs.insurance.insured", n);
    let insured = insuredCode === null ? undefined : person(insuredCode);
    if (insuredCode !== null && insured === undefined) c.contradiction("hs.insurance.insured", n, "被保険者に、記入の無い方が選ばれています（契約者として取り込みました）");
    if (insured === undefined) {
      insured = holder;
      c.assume(`ins/${id}/insured`, "仮の値（契約者と同じ方）", at("hs.insurance.insured", "insurance.insured", "/insured"));
    } else c.field(id, "hs.insurance.insured", n, "insurance.insured", "/insured", "confirmed");
    let date = c.value<string>("hs.insurance.contractDate", n);
    if (date === null) {
      date = baseMonth;
      c.assume(`ins/${id}/date`, "仮の値（計算基準月）", at("hs.insurance.contractDate", "insurance.contractDate", "/contractDate"));
    } else c.field(id, "hs.insurance.contractDate", n, "insurance.contractDate", "/contractDate", "confirmed");
    let freq = c.value<string>("hs.insurance.frequency", n);
    if (freq === null) {
      freq = "monthly";
      c.assume(`ins/${id}/freq`, "仮の値（月払い）", at("hs.insurance.frequency", "insurance.premium", "/premium/frequency"));
    } else c.field(id, "hs.insurance.frequency", n, "insurance.premium", "/premium/frequency", "confirmed");
    const pu = c.get<number>("hs.insurance.payUntilAge", n);
    let payUntil: InsuranceContract["premium"]["payUntil"] = null;
    if (freq !== "single") {
      if (pu.status === "value") {
        payUntil = { memberAge: { member: insured.id, years: pu.value } };
        c.field(id, "hs.insurance.payUntilAge", n, "insurance.premium", "/premium/payUntil", "confirmed");
      } else if (pu.status === "notApplicable") {
        c.field(id, "hs.insurance.payUntilAge", n, "insurance.premium", "/premium/payUntil", "confirmed");
      } else {
        c.assume(`ins/${id}/payUntil`, "仮の値（終身払いとして計算）", at("hs.insurance.payUntilAge", "insurance.premium", "/premium/payUntil"));
      }
    }
    const template = t.value;
    const ic: InsuranceContract = {
      id,
      template,
      policyholder: holder.id,
      insured: insured.id,
      contractDate: date,
      currency: "JPY",
      premium: { amount: premium, frequency: freq as "monthly" | "annual" | "single", payUntil },
      deductionCategory: deductionOf(template, date),
    };
    c.assume(`ins/${id}/deduction`, "保険の種類と契約年月からの目安", at("hs.insurance.type", "insurance.deductionCategory", "/deductionCategory"));
    const death = c.get<number>("hs.insurance.deathBenefit", n);
    const monthlyB = c.get<number>("hs.insurance.monthlyBenefit", n);
    const coverages: NonNullable<InsuranceContract["coverages"]> = [];
    if (death.status === "value") {
      if (DEATH_TEMPLATES.has(template)) {
        coverages.push({ id: c.newId(), role: "main", benefit: "death", amount: death.value });
        c.field(id, "hs.insurance.deathBenefit", n, "insurance.coverages", "/coverages/0/amount", "confirmed");
      } else c.contradiction("hs.insurance.deathBenefit", n, "この種類の保険の死亡保険金は、面談で確かめて入力してください（取り込みませんでした）");
    }
    if (monthlyB.status === "value") {
      if (template === "insurance.incomeProtection") {
        coverages.push({ id: c.newId(), role: "main", benefit: "incomeProtection", amount: monthlyB.value });
        c.field(id, "hs.insurance.monthlyBenefit", n, "insurance.coverages", `/coverages/${coverages.length - 1}/amount`, "confirmed");
      } else c.contradiction("hs.insurance.monthlyBenefit", n, "収入保障保険ではありませんが、年金月額の記入があります（取り込みませんでした）");
    }
    if (coverages.length > 0) ic.coverages = coverages;
    h.insuranceContracts.push(ic);
    c.candidate("insuranceContracts", "insurance.template", ic, undefined, "特約・受取人・更新は、保険証券を見て面談で入力してください");
  }
}

// ---- 生活費と貯蓄 ----

function livingUnknownBox(c: Ctx, id: string, size: number): ValueBox<number> {
  const e = livingEstimate(size);
  c.field(id, "hs.expense.living", undefined, "livingExpense.monthly", "/monthly", "estimated");
  c.issues.push(issue("info", "H_ESTIMATED", `${c.label("hs.expense.living")}: 「わからない」のため目安（${e.value.toLocaleString("ja-JP")}円）の推定にしました（${e.basis}）`, c.src("hs.expense.living")));
  return c.estimated({ value: e.value, basis: `${HEARING_UNKNOWN_BASIS}。${e.basis}` }, "statistic");
}

function importLiving(c: Ctx, h: Household, asOf: string, baseMonth: string): void {
  const size = h.members.filter((m) => !m.expected && m.outside === undefined).length;
  const id = c.newId();
  // 基本生活費は「わからない」を持たない（0100）: シートの「わからない」は、統計の目安の推定（根拠に「ヒアリングで『わからない』」）にする。
  // 面談のチェックリストには今までどおり載る
  const g = c.get<number>("hs.expense.living");
  const unknown = g.status === "unknown";
  // 事務所の既定値で基本生活費を推定で埋めない欄にしたときは、空欄・「わからない」の基本生活費を入れない（確かめの一覧の未入力に出る。0111）
  if (g.status === "value" || g.status === "notApplicable" || fillsByEstimate("livingExpense.monthly")) {
    const box = unknown ? livingUnknownBox(c, id, size) : c.moneyBox(id, "hs.expense.living", undefined, "livingExpense.monthly", "/monthly", () => livingEstimate(size));
    const l: LivingExpense = { id, mode: "total", monthly: box as ValueBox<number> };
    h.livingExpenses = [l];
    c.candidate("livingExpenses", "livingExpense.monthly", l);
  } else {
    c.issues.push(issue("info", "H_ESTIMATED", `${c.label("hs.expense.living")}: 事務所の既定値で推定で埋めない欄なので、空欄のままにしました（入力の画面で入れてください）`, c.src("hs.expense.living")));
  }
  const sv = c.get<number>("hs.expense.savings");
  if (sv.status === "value") {
    const sid = c.newId();
    c.field(sid, "hs.expense.savings", undefined, "savingsCheck.actualSavings", "/actualSavings", "confirmed");
    const year = Math.max(Number(asOf.slice(0, 4)), Number(baseMonth.slice(0, 4)));
    const s: SavingsCheck = { id: sid, year, actualSavings: c.confirmed(sv.value), treatment: "keepUnexplained" };
    c.assume(`savings/${sid}/treatment`, "計算との差は「使途不明金として残す」にしました（生活費に足すかは面談で決める）", { objectId: sid, key: "hs.expense.savings", item: "savingsCheck.treatment", path: "/treatment" });
    h.savingsChecks = [s];
    c.candidate("savingsChecks", "savingsCheck.actualSavings", s);
  }
}

// ---- メモと同意 ----

const CONSENT_KIND: Readonly<Record<string, ConsentDraft["kind"]>> = {
  "hs.consent.purpose": "purpose",
  "hs.consent.familyInfo": "familyInfo",
  "hs.consent.externalAi": "externalAi",
};

/** メモに入れる金額の文（月18,000円・範囲の答えなら「1〜2万円（だいたいの範囲）」） */
function memoMoney(c: Ctx, it: SheetItem): string | null {
  const g = c.get<number>(it.key);
  if (g.status === "unknown") return "わからない";
  if (g.status === "notApplicable") return "該当なし";
  if (g.status !== "value") return null;
  const r = c.rangeOf(it.key);
  if (r !== null) return `${r.label}（だいたいの範囲）`;
  const raw = formatValue(it, g.value).raw;
  const shown = raw.kind === "bool" ? "" : Number(raw.text).toLocaleString("ja-JP");
  const basis = it.unit?.basis === "monthly" ? "月" : it.unit?.basis === "annual" ? "年" : "";
  return `${basis}${shown}${it.unit?.scale === "manYen" ? "万円" : "円"}`;
}

function importMemoAndConsent(c: Ctx): void {
  for (const it of c.def.items) {
    if (it.destination === "memo" && axisOf(c.def, it.key) === null) {
      // 計算に入れる先が無い金額（保険料の合計など）も、FP 用のメモに入れる（範囲の答えは金額の項目の側で書く）
      if (it.type === "moneyRange") continue;
      const v = it.type === "money" ? memoMoney(c, it) : c.value<string>(it.key);
      if (v !== null && v !== "") c.memo.push(`【${it.label}】${v}`);
    }
    if (it.destination === "consent") {
      const v = c.value<string>(it.key);
      const kind = CONSENT_KIND[it.key];
      if (v === null || kind === undefined) continue;
      const m = c.filled.management;
      c.consents.push({ kind, decision: v as "given" | "refused", method: "hearingSheet", hearingRef: { requestId: m.requestId, sheetId: m.sheetId, sheetVersion: m.sheetVersion } });
    }
  }
}

/**
 * FP が候補をすべて承認したときの計算の要求: 出どころ「ヒアリング」の値の箱に、承認の記録（by: fp・日時・候補の ID）を付ける（0008 の2・5）。
 * at は時差つきの ISO 8601（例: 2027-03-02T10:15:00+09:00）。一部だけの承認は、画面の承認の流れ（候補の当てはめ）を作るときに足す
 */
export function approveAll(result: Pick<ImportResult, "request" | "candidates">, at: string): EngineRequest {
  const request = structuredClone(result.request);
  const h = request.input.household as unknown as Record<string, unknown>;
  const byObject = new Map(result.candidates.map((c) => [c.target.object, c.id]));
  const stamp = (v: unknown, candidate: string): void => {
    if (v === null || typeof v !== "object") return;
    if (Array.isArray(v)) {
      for (const x of v) stamp(x, candidate);
      return;
    }
    const o = v as Record<string, unknown>;
    const origin = o.origin as { kind?: string } | undefined;
    if (typeof o.state === "string" && origin?.kind === "hearing") o.approval = { by: "fp", at, candidate };
    for (const x of Object.values(o)) stamp(x, candidate);
  };
  for (const list of Object.values(h)) {
    if (!Array.isArray(list)) continue;
    for (const obj of list as { id?: string }[]) {
      const cid = obj.id === undefined ? undefined : byObject.get(obj.id);
      if (cid !== undefined) stamp(obj, cid);
    }
  }
  return request;
}
