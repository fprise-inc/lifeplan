// 記入済みのシート（回答の一覧）を世帯データ（0008）に取り込む。
// - 読んだ値は、シート定義の変換表（項目キー → 入力項目ID）で世帯データの欄に写し、出どころ「ヒアリング」の値の箱にする（0008 の2）
// - 物ごとに候補（0008 の5。op: add）にする。FP が承認するまで現状に効かない。request は「すべての候補を承認したとき」の世帯
// - 不足（計算に要る欄が空）・矛盾・読めない値を知らせ、面談のチェックリストに載せる（「わからない」も載せる。0018 の6）
// - 空欄・「わからない」を目安で補った欄には、入力の画面の「推定あり」（0008 の 2026-10-11 の追記の2）と同じ印を付ける:
//   値の箱を持つ欄は state: estimated（わからないは unknown＋substitute）、値の箱を持たない欄は assumed（欄のキー → 理由）
import { answerKey, type Answer, type FilledSheet } from "./answers.ts";
import { axisOf, itemByKey, type SheetDefinition, type SheetItem } from "./definition.ts";
import { bonusShareEstimate, businessEstimate, careerStartMonth, healthRateEstimate, livingEstimate, residentTaxEstimate, residentTaxYear, salaryEstimate, smrEstimate, type Estimate } from "./estimates.ts";
import { issue, type Issue } from "./issues.ts";
import { addMonths, ageAt, reachedMonth, ymIndex } from "./months.ts";
import type {
  Account,
  Debt,
  EducationStage,
  EmploymentPeriod,
  EngineRequest,
  Goal,
  Household,
  InsuranceContract,
  LivingExpense,
  Member,
  PensionRecord,
  Relation,
  Residence,
  ResidentTaxAssessment,
  RetirementBenefit,
  SavingsCheck,
  ValueBox,
} from "./types.ts";
import { parseValue } from "./values.ts";

export interface ImportOptions {
  /** 計算基準月（"YYYY-MM"） */
  readonly baseMonth: string;
  /** 物の ID を作る（UUID 第4版。省略は crypto.randomUUID） */
  readonly newId?: () => string;
}

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
}

/** 計算の要求のうち、世帯ごとに変わらない部分の既定（app/src/workspace/input/household.ts の DEFAULT_ASSUMPTIONS と同じ） */
export const DEFAULT_ASSUMPTIONS = {
  investmentReturn: { default: "0.01" },
  wageGrowth: { default: "0.01" },
  inflation: { default: "0.01" },
  pensionMacroSlide: { default: "0.004" },
};

type Got<T> =
  | { readonly status: "value"; readonly value: T; readonly review?: readonly string[] }
  | { readonly status: "blank" | "unknown" | "notApplicable" | "invalid" };

const SALARIED = new Set(["regular", "contract", "partTime", "civilServant", "executive"]);
const MAIN_JOB = new Set(["regular", "contract", "civilServant", "executive"]);

class Ctx {
  readonly issues: Issue[] = [];
  readonly checklist: ChecklistItem[] = [];
  readonly assumed: Record<string, string> = {};
  readonly pending: Answer[] = [];
  readonly memo: string[] = [];
  readonly consents: ConsentDraft[] = [];
  readonly candidates: Candidate[] = [];
  private readonly got = new Map<string, Got<number | string>>();
  private readonly items: Map<string, SheetItem>;
  private readonly fields = new Map<string, FieldRecord[]>();
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
  }

  item(key: string): SheetItem {
    const it = this.items.get(key);
    if (it === undefined) throw new Error(`シート定義に無い項目: ${key}`);
    return it;
  }

  /** 見出しつきの項目名 */
  label(key: string, index?: number): string {
    const it = this.items.get(key);
    const axis = axisOf(this.def, key);
    const head = axis !== null && index !== undefined ? `${axis.labels[index - 1] ?? `${index}番目`} ` : "";
    return `${head}${it?.label ?? key}`;
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
      const review = a.review ?? [];
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
    if (a.status === "unknown") this.check(a.key, a.index, "unknown", "わからない");
  }

  check(key: string, index: number | undefined, reason: ChecklistItem["reason"], message: string): void {
    this.checklist.push({ key, ...(index !== undefined ? { index } : {}), label: this.label(key, index), reason, message });
  }

  get<T extends number | string>(key: string, index?: number): Got<T> {
    return (this.got.get(answerKey(key, index)) ?? { status: "blank" }) as Got<T>;
  }

  value<T extends number | string>(key: string, index?: number): T | null {
    const g = this.get<T>(key, index);
    return g.status === "value" ? g.value : null;
  }

  /** その項目に何か記入があるか（値・わからない・該当なしのどれか） */
  touched(key: string, index?: number): boolean {
    const g = this.get(key, index);
    return g.status === "value" || g.status === "unknown" || g.status === "invalid";
  }

  missing(key: string, index: number | undefined, message: string, level: "error" | "warning" = "warning"): void {
    this.issues.push(issue(level, "H_MISSING", `${this.label(key, index)}: ${message}`, { key, ...(index !== undefined ? { index } : {}) }));
    this.check(key, index, "missing", message);
  }

  contradiction(key: string, index: number | undefined, message: string, level: "error" | "warning" = "warning"): void {
    this.issues.push(issue(level, "H_CONTRADICTION", `${this.label(key, index)}: ${message}`, { key, ...(index !== undefined ? { index } : {}) }));
    this.check(key, index, "contradiction", message);
  }

  /** 欄の記録を物ごとにためる */
  field(objectId: string, key: string, index: number | undefined, item: string, path: string, state: FieldRecord["state"]): void {
    const g = this.get(key, index);
    const review = g.status === "value" ? g.review : undefined;
    const list = this.fields.get(objectId) ?? [];
    list.push({ key, ...(index !== undefined ? { index } : {}), item, path, state, ...(review !== undefined ? { review } : {}) });
    this.fields.set(objectId, list);
  }

  /** 値の箱を持たない欄を仮の値で補った印（入力の画面の欄のキー） */
  assume(uiKey: string, reason: string, at: { objectId: string; key: string; index?: number; item: string; path: string }): void {
    this.assumed[uiKey] = reason;
    this.field(at.objectId, at.key, at.index, at.item, at.path, "assumed");
    this.issues.push(issue("info", "H_ASSUMED", `${this.label(at.key, at.index)}: ${reason}`, { key: at.key, ...(at.index !== undefined ? { index: at.index } : {}) }));
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

  notApplicable<T>(): ValueBox<T> {
    return { state: "notApplicable", origin: { kind: "hearing", ref: this.ref } };
  }

  estimated(e: Estimate, method: "statistic" | "derived"): ValueBox<number> {
    return { value: e.value, state: "estimated", origin: { kind: "auto" }, estimate: { method, basis: e.basis } };
  }

  unknown(e: Estimate | null, method: "statistic" | "derived"): ValueBox<number> {
    return { state: "unknown", origin: { kind: "hearing", ref: this.ref }, ...(e !== null ? { substitute: this.estimated(e, method) } : {}) };
  }

  /**
   * 金額の欄を値の箱にする。空欄は目安で補い（estimated）、わからないは代わりの値つき（unknown）。目安が無ければ null（欄を作らない）
   */
  moneyBox(objectId: string, key: string, index: number | undefined, item: string, path: string, estimate: (() => Estimate | null) | null, method: "statistic" | "derived" = "statistic"): ValueBox<number> | null {
    const g = this.get<number>(key, index);
    if (g.status === "value") {
      this.field(objectId, key, index, item, path, "confirmed");
      return this.confirmed(g.value);
    }
    if (g.status === "notApplicable") {
      this.field(objectId, key, index, item, path, "notApplicable");
      return this.notApplicable();
    }
    const e = estimate?.() ?? null;
    if (g.status === "unknown") {
      if (e === null) return null;
      this.field(objectId, key, index, item, path, "unknown");
      return this.unknown(e, method);
    }
    if (e === null) return null;
    this.field(objectId, key, index, item, path, "estimated");
    this.issues.push(issue("info", "H_ESTIMATED", `${this.label(key, index)}: 空欄のため目安（${e.value.toLocaleString("ja-JP")}円）で補いました（${e.basis}）`, { key, ...(index !== undefined ? { index } : {}) }));
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
    c.contradiction("hs.meta.filledOn", undefined, `記入の年月が計算基準月より後です（計算基準月 ${options.baseMonth} の時点の額として扱いました）`);
    asOf = options.baseMonth;
  }

  const adults = importFamily(c, h, options.baseMonth);
  const periods = importWork(c, h, adults, options.baseMonth);
  importPension(c, h, adults, asOf);
  importHousing(c, h, adults, asOf, options.baseMonth);
  importEducation(c, h);
  importAssets(c, h, adults, periods, asOf);
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
  };
}

// ---- 家族 ----

/** 本人（1）と配偶者（2）。いなければ undefined */
type Adults = [Member, Member | undefined];

const SPOUSE_KEYS = [
  "hs.family.adult.sex",
  "hs.work.type",
  "hs.income.salary",
  "hs.income.business",
  "hs.pension.notice.type",
  "hs.assets.deposit",
  "hs.assets.nisa",
  "hs.assets.ideco",
];

function importFamily(c: Ctx, h: Household, baseMonth: string): Adults {
  const B = "hs.family.adult.birthYearMonth";
  const S = "hs.family.adult.sex";
  const baseYear = Number(baseMonth.slice(0, 4));

  const selfId = c.newId();
  const selfBirth = c.get<string>(B, 1);
  let birth: string;
  if (selfBirth.status === "value") {
    birth = selfBirth.value;
    c.field(selfId, B, 1, "member.birth", "/birth/birthYearMonth", "confirmed");
  } else {
    birth = `${baseYear - 40}-04`;
    if (selfBirth.status === "notApplicable") c.contradiction(B, 1, "ご本人の生年月に「該当なし」は選べません", "error");
    else c.missing(B, 1, "ご本人の生年月がありません（計算に必要です）", "error");
    c.assume(`family/${selfId}/birth`, "仮の値（40歳として計算）", { objectId: selfId, key: B, index: 1, item: "member.birth", path: "/birth/birthYearMonth" });
  }
  const self: Member = { id: selfId, kind: "self", birth: { birthYearMonth: birth, bornOnFirst: false }, sex: sexOf(c, selfId, S, 1, "male"), joins: null, leaves: null, expected: false };
  h.members.push(self);
  c.candidate("members", "member.kind", self);

  // 配偶者
  let spouse: Member | undefined;
  const sb = c.get<string>(B, 2);
  const spouseTouched = SPOUSE_KEYS.some((k) => c.get(k, 2).status === "value");
  if (sb.status === "notApplicable") {
    if (spouseTouched) c.contradiction(B, 2, "配偶者の方は「該当なし」ですが、配偶者の方の欄に記入があります（配偶者の方の欄は取り込みませんでした）");
  } else if (sb.status === "value" || spouseTouched) {
    const id = c.newId();
    let sBirth: string;
    if (sb.status === "value") {
      sBirth = sb.value;
      c.field(id, B, 2, "member.birth", "/birth/birthYearMonth", "confirmed");
    } else {
      sBirth = birth;
      c.missing(B, 2, "配偶者の方の欄に記入がありますが、生年月がありません");
      c.assume(`family/${id}/birth`, "仮の値（ご本人と同じ年月として計算）", { objectId: id, key: B, index: 2, item: "member.birth", path: "/birth/birthYearMonth" });
    }
    spouse = { id, kind: "spouse", birth: { birthYearMonth: sBirth, bornOnFirst: false }, sex: sexOf(c, id, S, 2, self.sex === "male" ? "female" : "male"), joins: null, leaves: null, expected: false };
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
    if (sexGot.status === "value") {
      sex = sexGot.value as "male" | "female";
      c.field(id, "hs.family.child.sex", n, "member.sex", "/sex", "confirmed");
    } else {
      c.assume(`family/${id}/sex`, expected ? "仮の値（出産予定）" : "仮の値", { objectId: id, key: "hs.family.child.sex", index: n, item: "member.sex", path: "/sex" });
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
  c.missing(key, index, "性別がありません（年金の計算に使います）");
  c.assume(`family/${id}/sex`, "仮の値", { objectId: id, key, index, item: "member.sex", path: "/sex" });
  return fallback;
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
    } else if (ra.status === "unknown" && MAIN_JOB.has(type)) {
      c.check("hs.work.retireAge", n, "unknown", "定年が決まっていない（今の勤め先で働き続けるとして計算します）");
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
        const e = healthRateEstimate(kind);
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
          sz = type === "partTime" ? 30 : 300;
          c.assume(`work/period/${id}/size`, `仮の値（${sz}人として計算）`, at("hs.work.employerSize", "employment.employer.size", "/employer/size"));
        }
        if (hours.status === "value") {
          hr = hours.value;
          c.field(id, "hs.work.weeklyHours", n, "employment.employer.weeklyHours", "/employer/weeklyHours", "confirmed");
        } else {
          hr = type === "partTime" ? "20" : "40";
          if (type === "partTime") c.missing("hs.work.weeklyHours", n, "パート・アルバイトの方の勤務時間がありません（社会保険の加入の判定に使います）");
          c.assume(`work/period/${id}/hours`, `仮の値（週${hr}時間として計算）`, at("hs.work.weeklyHours", "employment.employer.weeklyHours", "/employer/weeklyHours"));
        }
        p.employer = { size: sz, weeklyHours: hr };
      }
    }

    // 収入
    if (SALARIED.has(type)) importSalary(c, p, m, n);
    else if (c.get("hs.income.salary", n).status === "value") c.contradiction("hs.income.salary", n, "給与の記入がありますが、働き方が給与の働き方ではありません（取り込みませんでした）");
    if (type === "selfEmployed") {
      const b = c.moneyBox(id, "hs.income.business", n, "employment.business.income", "/business/income", () => businessEstimate());
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
  const e = residentTaxEstimate(salary, business);
  const st = c.get("hs.income.residentTax", n).status;
  const rid = c.newId();
  const amount = st === "unknown" ? c.unknown(e, "derived") : c.estimated(e, "derived");
  c.field(rid, "hs.income.residentTax", n, "residentTaxAssessment.amount", "/amount", st === "unknown" ? "unknown" : "estimated");
  const a: ResidentTaxAssessment = { id: rid, member: m.id, fiscalYear: fy, amount };
  (h.residentTaxAssessments ??= []).push(a);
  c.candidate("residentTaxAssessments", "residentTaxAssessment.amount", a);
}

function importSalary(c: Ctx, p: EmploymentPeriod, m: Member, n: number): void {
  const id = p.id;
  const total = c.get<number>("hs.income.salary", n);
  const bonus = c.get<number>("hs.income.bonus", n);
  const est = salaryEstimate(p.type, m.sex);
  let annual: ValueBox<number>;
  let bonusBox: ValueBox<number>;
  if (total.status === "value") {
    c.field(id, "hs.income.salary", n, "employment.salary.annual", "/salary/annual", "confirmed");
    if (bonus.status === "value") {
      if (bonus.value > total.value) {
        c.contradiction("hs.income.bonus", n, "賞与が年収より多くなっています（賞与を0円として取り込みました）", "error");
        bonusBox = c.confirmed(0);
        annual = c.confirmed(total.value);
      } else {
        c.field(id, "hs.income.bonus", n, "employment.salary.bonus", "/salary/bonus", "confirmed");
        bonusBox = c.confirmed(bonus.value);
        annual = c.confirmed(total.value - bonus.value);
      }
    } else if (bonus.status === "notApplicable") {
      c.field(id, "hs.income.bonus", n, "employment.salary.bonus", "/salary/bonus", "confirmed");
      bonusBox = c.confirmed(0);
      annual = c.confirmed(total.value);
    } else {
      // 賞与が分からない: 年収に統計の賞与の割合を当てて分ける（年収の側も、その分だけ推定になる）
      const share = bonusShareEstimate(p.type, m.sex, total.value) ?? { value: 0, basis: "賞与なしとみなした" };
      const rest: Estimate = { value: total.value - share.value, basis: `年収（記入）${total.value.toLocaleString("ja-JP")}円から賞与の目安を引いた額` };
      if (bonus.status === "unknown") {
        bonusBox = c.unknown(share, "derived");
        annual = { ...c.unknown(rest, "derived") };
        c.field(id, "hs.income.bonus", n, "employment.salary.bonus", "/salary/bonus", "unknown");
      } else {
        bonusBox = c.estimated(share, "derived");
        annual = c.estimated(rest, "derived");
        c.field(id, "hs.income.bonus", n, "employment.salary.bonus", "/salary/bonus", "estimated");
        c.issues.push(issue("info", "H_ESTIMATED", `${c.label("hs.income.bonus", n)}: 空欄のため、年収のうち ${share.value.toLocaleString("ja-JP")}円を賞与の目安としました`, { key: "hs.income.bonus", index: n }));
      }
    }
  } else {
    if (total.status === "notApplicable") c.contradiction("hs.income.salary", n, "給与の働き方ですが、給与の年収が「該当なし」です（目安で補いました）");
    const annualEst = est?.annual ?? { value: 0, basis: "目安なし" };
    const bonusEst = est?.bonus ?? { value: 0, basis: "目安なし" };
    if (total.status === "unknown") {
      annual = c.unknown(annualEst, "statistic");
      c.field(id, "hs.income.salary", n, "employment.salary.annual", "/salary/annual", "unknown");
    } else {
      if (total.status === "blank") c.missing("hs.income.salary", n, "給与の年収がありません（統計の目安で補いました）");
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
      bonusBox = bonus.status === "unknown" ? c.unknown(bonusEst, "statistic") : c.estimated(bonusEst, "statistic");
      c.field(id, "hs.income.bonus", n, "employment.salary.bonus", "/salary/bonus", bonus.status === "unknown" ? "unknown" : "estimated");
    }
  }
  p.salary = { annual, bonus: bonusBox };
  // 標準報酬月額は聞かない（年収からの目安。入力の画面と同じ）。厚生年金に入る働き方のときだけ
  if (p.pensionCategory !== undefined && p.pensionCategory !== "none") {
    const a = annual.value ?? annual.substitute?.value ?? 0;
    p.standardMonthlyRemuneration = smrEstimate(a);
    c.field(id, "hs.income.salary", n, "employment.standardMonthlyRemuneration", "/standardMonthlyRemuneration", "estimated");
  }
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
      if (total.status === "value") {
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
  const hasLoan = Array.from({ length: loanAxis?.count ?? 0 }, (_, i) => c.get("hs.loan.debtor", i + 1).status === "value").some(Boolean);
  let ownId: string | null = null;
  if (type.status !== "value") {
    c.missing("hs.housing.type", undefined, "お住まいの種類がありません（住居費なしとして計算します）");
  } else {
    const t = type.value;
    if (t === "own" && rent.status === "value" && rent.value > 0) c.contradiction("hs.housing.rent", undefined, "持ち家ですが、家賃の記入があります（取り込みませんでした）");
    if ((t === "rent" || t === "company" || t === "family") && hasLoan) c.contradiction("hs.housing.type", undefined, "住宅ローンの記入がありますが、お住まいが持ち家ではありません");
    if (t !== "family") {
      const id = c.newId();
      c.field(id, "hs.housing.type", undefined, "residence.kind", "/kind", "confirmed");
      const since = c.get<string>("hs.housing.since");
      let from: string;
      if (since.status === "value") {
        from = since.value;
        c.field(id, "hs.housing.since", undefined, "residence.from", "/from/at", "confirmed");
      } else {
        from = baseMonth;
        c.assume(`housing/res/${id}/from`, "仮の値（計算基準月から）", { objectId: id, key: "hs.housing.since", item: "residence.from", path: "/from/at" });
      }
      const r: Residence = { id, kind: t === "own" ? "own" : "rent", from: { at: from }, to: null };
      let ok = true;
      if (t === "own") {
        const tax = c.moneyBox(id, "hs.housing.propertyTax", undefined, "residence.propertyTax", "/propertyTax/annual", null);
        if (tax !== null) r.propertyTax = { annual: tax };
        const mt = c.moneyBox(id, "hs.housing.maintenance", undefined, "residence.maintenance", "/maintenance/monthly", null);
        if (mt !== null) r.maintenance = { monthly: mt };
        if (c.get("hs.housing.propertyTax").status === "blank") c.check("hs.housing.propertyTax", undefined, "missing", "固定資産税が未記入");
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
}

/**
 * 住宅ローン控除の仮の条件を置く最初の入居の年（令和4年。計算エンジンの控除の制度データがこの年の入居から。入力の画面の
 * app/src/workspace/input/housingCredit.ts と同じ決まり）
 */
const CREDIT_DATA_FROM_YEAR = 2022;
const CREDIT_ASSUMED = "仮の条件（入居は借入の年月・新築は省エネ基準適合住宅、中古は一般の住宅・持分は債務者が100%）で住宅ローン控除を計算しています";

function importLoan(c: Ctx, h: Household, adults: Adults, n: number, asOf: string, baseMonth: string, ownId: string | null): void {
  const debtor = c.get<string>("hs.loan.debtor", n);
  const others = ["hs.loan.principal", "hs.loan.start", "hs.loan.termYears", "hs.loan.rate"];
  if (debtor.status !== "value") {
    if (others.some((k) => c.get(k, n).status === "value")) c.missing("hs.loan.debtor", n, "住宅ローンの記入がありますが、借りている方がありません（取り込みませんでした）");
    return;
  }
  const member = debtor.value === "adult.2" ? adults[1] : adults[0];
  if (member === undefined) {
    c.contradiction("hs.loan.debtor", n, "借りている方が配偶者の方ですが、配偶者の方の記入がありません（取り込みませんでした）", "error");
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
  } else c.check("hs.loan.balance", n, bal.status === "unknown" ? "unknown" : "missing", "残高が無いため、借入額と金利から計算します（いまの金利を借りたときから当てるため、ずれることがあります）");
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
    d.housing = { ...(ownId !== null ? { residence: ownId } : {}), moveIn: ev.id, propertyType: "energySaving", newBuild: true };
    c.assume(`housing/debt/${id}/credit`, CREDIT_ASSUMED, at("hs.loan.start", "debt.housing", "/housing"));
    note += "入居は借りた年月・新築の省エネ基準適合住宅・借りている方の持分100%とした仮の条件で控除を計算します（入力の画面では「仮」の印が付きます）。違うときは面談で確かめてください";
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
        mv = c.confirmed(g.value);
        c.field(id, key, n, "account.marketValue", "/marketValue", "confirmed");
      } else if (g.status === "unknown") {
        mv = c.unknown({ value: 0, basis: "残高がわからないため0円として計算" }, "derived");
        c.field(id, key, n, "account.marketValue", "/marketValue", "unknown");
      } else {
        mv = c.estimated({ value: 0, basis: "積立の記入があり残高の記入が無いため0円として計算" }, "derived");
        c.field(id, key, n, "account.marketValue", "/marketValue", "estimated");
      }
      const a: Account = { id, kind, owner: m.id, marketValue: mv, asOf, contributions: [] };
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

function importLiving(c: Ctx, h: Household, asOf: string, baseMonth: string): void {
  const size = h.members.filter((m) => !m.expected).length;
  const id = c.newId();
  const box = c.moneyBox(id, "hs.expense.living", undefined, "livingExpense.monthly", "/monthly", () => livingEstimate(size));
  const l: LivingExpense = { id, mode: "total", monthly: box as ValueBox<number> };
  h.livingExpenses = [l];
  c.candidate("livingExpenses", "livingExpense.monthly", l);
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

function importMemoAndConsent(c: Ctx): void {
  for (const it of c.def.items) {
    if (it.destination === "memo" && axisOf(c.def, it.key) === null) {
      const v = c.value<string>(it.key);
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
