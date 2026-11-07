// 保険のカード（0055）: 契約ごとに簡易（目安で）と詳細（証券どおり）。
// - 簡易は1契約5欄: 種類（ひな形）・被保険者・保険料（払い方つき）・主な保障の額（種類で給付が変わる1欄）・終わり。ほかは推定（ひな形の標準の値）。
//   終わりは、定期の保険は保障の終わり、終身の保険は払込の終わり、満期・年金のある保険は両方（0078 の endLevels）
// - 詳細: 名前・契約者・契約年月・受取人・受け取るお金の税（読むだけ）・満期金などの受取人・保険料控除の区分と新旧・払込の終わり・更新・
//   払込免除・解約の月と解約返戻金・保障の明細（被保険者・給付の種類・額・期間・推移の形・最低保証の月数・免責の月数・年数・限度日数）
// - 保険料と保障の額は目安を作らない（新しい契約でも未入力の警告。必要保障額との過不足は万一のタブで見る）
// - 推定の値は物の値の状態の欄に行で持つ。推定のまま（出どころ auto）の値だけ、種類・被保険者・契約年月を直したときに入れ直す
// - 外貨建て・変額は円の目安の形だけ（計算エンジンの insurance.simple.estimate）
// - 低解約返戻金型終身保険・アカウント型（0055 の追記 2026-11-03）: 運用の計算は入れず、設計書の数字を写す。低解約返戻金型は払込中の率と
//   払込が終わった時の率（目安の値の推定）と、詳細の年齢ごとの率の点。アカウント型は払込が終わった時の積立金と払込の後の扱い
import type { Coverage, Household, InsuranceContract, Member } from "../../../engine/types.ts";
import { addMonths } from "../../levers.ts";
import type { Address } from "../../store/readings.ts";
import { byId, field, plain, removeAction, resolveTimepoint, timepointField, type ActionDef, type FieldDef, type Finder, type GroupDef, type Option, type SectionDef, type StageDef } from "../form.ts";
import { mutate, newId, type WorkingHousehold } from "../household.ts";
import {
  at,
  defaultMaxDays,
  deathTaxText,
  defaultEnd,
  defaultPayUntil,
  estRow,
  isAuto,
  isAutoStandard,
  KIND_GROUPS,
  KIND_OPTIONS,
  KINDS,
  kindDef,
  lowCvBasis,
  lowCvRate,
  kindOf,
  mainCoverage,
  putRowIn,
  regimeOf,
  rowIn,
  STANDARD,
  surgeryRatio,
  surgeryBasis,
  UNENTERED_MAIN,
  UNENTERED_PREMIUM,
  youngestChild,
  type KindDef,
} from "../insuranceKinds.ts";
import { ADULTS_WHO, BENEFITS, DEDUCTION_TYPES, memberLabel, memberOptions, PREMIUM_FREQUENCY, WORDS } from "../labels.ts";
import { monthsBetween } from "../loanMath.ts";
import { formatYearMonth } from "../units.ts";
import type { InsuranceAccountInput } from "../../../engine/types.ts";
import { CHECK_DOCUMENTS } from "../checkDocuments.ts";

type Obj = Record<string, unknown>;
const contracts = (h: Household) => h.insuranceContracts;
const withAddress = (f: FieldDef, a: (wh: WorkingHousehold) => Address | null): FieldDef => ({ ...f, address: a });
const inHousehold = (m: Member) => m.outside === undefined;

/** 計算に使う給付（受け取りを計算する種類） */
const COMPUTED = new Set(["death", "incomeProtection", "incapacity", "highDisability", "maturity", "annuity", "survival"]);
/** 計算の型ごとに、主契約に持てる計算に使う給付 */
const MAIN_BENEFITS: Readonly<Record<string, readonly string[]>> = {
  "insurance.term": ["death", "highDisability", "incapacity"],
  "insurance.wholeLife": ["death", "highDisability", "maturity"],
  "insurance.incomeProtection": ["incomeProtection", "highDisability", "incapacity"],
  "insurance.medical": [],
  "insurance.cancer": [],
  "insurance.education": ["maturity", "survival"],
  "insurance.privateAnnuity": ["annuity"],
  "insurance.foreignCurrency": ["death", "highDisability", "maturity", "annuity"],
  "insurance.variable": ["death", "highDisability", "maturity"],
  "insurance.nonLife": [],
};
/** 給付の種類（三大疾病一時金を足した一覧） */
export const COVERAGE_BENEFITS = [...BENEFITS.filter((b) => b.value !== "other"), { value: "threeMajorLump", label: "三大疾病一時金（がん・心疾患・脳卒中）" }, { value: "other", label: "その他（計算に入りません）" }];
const MEDICAL = new Set(["hospitalDaily", "surgery", "cancerLump", "threeMajorLump"]);
/** 主な保障の額といっしょに直る値（種類ごと） */
const SIDE: Partial<Record<string, string>> = {
  endowment: "満期金もいっしょに直します",
  decreasingTerm: "減る形の数表もいっしょに作り直します",
  medical: "推定のままの手術の額（入院日額の10倍）もいっしょに直します",
};
const SAVINGS_TEMPLATES = new Set(["insurance.wholeLife", "insurance.education", "insurance.privateAnnuity"]);
const FUND_TEMPLATES = new Set(["insurance.foreignCurrency", "insurance.variable"]);

// ---- 推定の値を入れる・入れ直す ----

/** 主な保障の終わりの当て先の欄（個人年金は受け取りの始まり） */
const endPath = (k: KindDef): "from" | "to" => (k.main?.benefit === "annuity" ? "from" : "to");

/** 推定のまま（行が auto）か */
const autoRow = (c: Obj, item: string, path: readonly string[] = []) => isAuto(rowIn(c, item, path));

const memberWord = (h: Household, id: string): string => {
  const m = h.members.find((x) => x.id === id);
  return m === undefined ? "家族" : (({ self: "ご本人", spouse: "配偶者", child: "子" }) as Record<string, string>)[m.kind] ?? "家族";
};

/**
 * ひな形の既定を入れる（新しい契約は全部、種類を変えたときは推定のままの値だけ入れ直す）。主な保障は同じ意味の給付があれば引き継ぎ、
 * 無ければ0円の主契約を未入力の警告で置く。前の種類の主な保障で新しい型に無い計算に使う給付は外し、医療の給付は特約に回して残す
 */
export function applyKind(h: Household, c: InsuranceContract, next: KindDef, fresh: boolean): void {
  const prev = kindOf(c);
  const o = c as unknown as Obj;
  const oldMain = fresh ? undefined : mainCoverage(c, prev);
  c.subtype = next.kind;
  c.template = next.template;
  // 円の目安の形
  if (next.estimate === true) c.simple = { ...(c.simple ?? {}), estimate: true };
  else if (c.simple?.estimate !== undefined) {
    const { estimate: _e, ...rest } = c.simple;
    void _e;
    if (Object.keys(rest).length > 0) c.simple = rest;
    else delete c.simple;
  }
  // 被保険者（学資保険は末の子。推定のままなら入れ直す）
  if (next.child === true && (fresh || autoRow(o, "insurance.insured"))) {
    const kid = youngestChild(h);
    if (kid !== undefined) {
      c.insured = kid.id;
      putRowIn(o, "insurance.insured", [], estRow("standard", `${STANDARD}（学資保険: 末の子）`));
    }
  }
  if (fresh || autoRow(o, "insurance.policyholder")) setHolder(h, c);
  // 主な保障
  const allowed = new Set(MAIN_BENEFITS[next.template] ?? [...COMPUTED]);
  let covs = [...(c.coverages ?? [])];
  if (oldMain !== undefined && oldMain.benefit !== next.main?.benefit) {
    if (MEDICAL.has(oldMain.benefit) || oldMain.benefit === "other") covs = covs.map((x) => (x.id === oldMain.id ? { ...x, role: "rider" } : x));
    else if (COMPUTED.has(oldMain.benefit) && !allowed.has(oldMain.benefit)) {
      covs = covs.filter((x) => x.id !== oldMain.id);
      for (const p of ["amount", "to", "from"]) putRowIn(o, "insurance.coverages", [oldMain.id, p], undefined);
    }
  }
  // 主契約のほかの計算に使う給付で、新しい型に無いもの（死亡保障を医療保険に変えたときの死亡保険金など）は外す。特約は残す
  covs = covs.filter((x) => !(x.role === "main" && COMPUTED.has(x.benefit) && !allowed.has(x.benefit) && x.benefit !== next.main?.benefit));
  c.coverages = covs;
  let main = mainCoverage(c, next);
  const endDef = defaultEnd(h, next, c.insured);
  if (next.main !== null && main === undefined) {
    main = { id: newId(), role: "main", benefit: next.main.benefit, amount: 0, from: { at: c.contractDate }, to: null };
    if (endPath(next) === "from") {
      main.from = endDef.tp ?? { at: c.contractDate };
      main.years = 10;
    } else main.to = endDef.tp;
    covs.unshift(main);
    putRowIn(o, "insurance.coverages", [main.id, "amount"], estRow("standard", UNENTERED_MAIN));
    putRowIn(o, "insurance.coverages", [main.id, endPath(next)], estRow("standard", endDef.basis));
  } else if (main !== undefined && (fresh || autoRow(o, "insurance.coverages", [main.id, endPath(next)]))) {
    if (endPath(next) === "from") main.from = endDef.tp ?? { at: c.contractDate };
    else main.to = endDef.tp;
    putRowIn(o, "insurance.coverages", [main.id, endPath(next)], estRow("standard", endDef.basis));
  }
  if (main !== undefined && main.role !== "main") main.role = "main";
  // 養老保険: 満期金は死亡保険金と同じ額・同じ終わり
  if (next.kind === "endowment" && main !== undefined) syncMaturity(c, main);
  // 医療保険: 手術の特約（入院日額の10倍の推定）
  if (next.kind === "medical" && !covs.some((x) => x.benefit === "surgery") && main !== undefined) {
    const s: Coverage = { id: newId(), role: "rider", benefit: "surgery", amount: main.amount * surgeryRatio(), from: { at: c.contractDate }, to: null };
    covs.push(s);
    putRowIn(o, "insurance.coverages", [s.id, "amount"], estRow("standard", surgeryBasis(main.amount)));
  }
  if (covs.length === 0) delete c.coverages;
  // 逓減定期: 減る形の数表（はじめの額から毎年同じ額ずつ減る）
  if (main !== undefined && main.benefit === "death") {
    if (next.decreasing === true) setDecreasing(h, c, main, true);
    else if (prev.decreasing === true && !fresh) setDecreasing(h, c, main, false);
  }
  // 払込の終わり・控除の区分・新旧の制度
  if (fresh || autoRow(o, "insurance.premium", ["payUntil"])) {
    const p = defaultPayUntil(h, next, c.insured);
    c.premium.payUntil = c.premium.frequency === "single" ? null : p.tp;
    putRowIn(o, "insurance.premium", ["payUntil"], estRow("standard", p.basis));
  }
  if (fresh || autoRow(o, "insurance.deductionCategory", ["type"])) {
    fitRegime(c, next.deduction);
    putRowIn(o, "insurance.deductionCategory", ["type"], estRow("standard", `${STANDARD}（${next.label}）`));
  }
  fitLowCv(c, next);
  fitAccount(c, next);
}

// ---- 低解約返戻金型・アカウント型（0055 の追記 2026-11-03） ----

/** 簡易の入力の欄を書く（undefined は外す。空になれば simple ごと外す） */
function setSimple<K extends keyof NonNullable<InsuranceContract["simple"]>>(c: InsuranceContract, key: K, v: NonNullable<InsuranceContract["simple"]>[K] | undefined): void {
  const next = { ...(c.simple ?? {}) };
  if (v === undefined) delete next[key];
  else next[key] = v;
  if (Object.keys(next).length > 0) c.simple = next;
  else delete c.simple;
}

export const UNENTERED_ACCOUNT = "未入力（払込が終わった時の積立金を入れてください。0円で計算中）";
export const UNENTERED_DESIGN = "未入力（設計書の額を入れてください。0円で計算中）";
const ACCOUNT_KEYS = ["value", "after", "deathBenefit", "annual", "years"] as const;
const lowCvHead = `${STANDARD}（低解約返戻金型終身保険`;

/**
 * 低解約返戻金型: 払込中の率・払込が終わった時の率を目安の値の推定で入れる（入っている率は変えない）。ほかの種類に変えたら、この型だけの値
 * （払込中の率・年齢ごとの率の点）を外し、推定のままの払込が終わった時の率も外す（終身保険などは返戻率の目安を作らない）
 */
function fitLowCv(c: InsuranceContract, next: KindDef): void {
  const o = c as unknown as Obj;
  if (next.kind === "lowSurrender") {
    if (c.simple?.returnRateDuring === undefined) {
      setSimple(c, "returnRateDuring", lowCvRate("during"));
      putRowIn(o, "insurance.simple", ["returnRateDuring"], estRow("standard", lowCvBasis("during")));
    }
    if (c.simple?.returnRate === undefined) {
      setSimple(c, "returnRate", lowCvRate("end"));
      putRowIn(o, "insurance.simple", ["returnRate"], estRow("standard", lowCvBasis("end")));
    }
    return;
  }
  if (c.simple?.returnRateDuring !== undefined) {
    setSimple(c, "returnRateDuring", undefined);
    putRowIn(o, "insurance.simple", ["returnRateDuring"], undefined);
  }
  for (const p of c.simple?.returnRatePoints ?? []) if (p.id !== undefined) for (const f of ["age", "rate"]) putRowIn(o, "insurance.simple", ["returnRatePoints", p.id, f], undefined);
  if (c.simple?.returnRatePoints !== undefined) setSimple(c, "returnRatePoints", undefined);
  // 推定のままの低解約返戻金型の率（払込が終わった時）は外す（終身保険・学資保険などは返戻率の目安を作らない。未入力の警告に戻る）
  if (c.simple?.returnRate !== undefined && isAuto(rowIn(o, "insurance.simple", ["returnRate"]), lowCvHead)) {
    setSimple(c, "returnRate", undefined);
    putRowIn(o, "insurance.simple", ["returnRate"], undefined);
  }
}

/** アカウント型: 積立の部分（払込が終わった時の積立金は未入力・払込の後は終身保険に移す）を置く。ほかの種類に変えたら外す */
function fitAccount(c: InsuranceContract, next: KindDef): void {
  const o = c as unknown as Obj;
  if (next.kind === "account") {
    if (c.simple?.account !== undefined) return;
    setSimple(c, "account", { value: 0, after: "wholeLife", deathBenefit: 0 });
    putRowIn(o, "insurance.simple", ["account", "value"], estRow("standard", UNENTERED_ACCOUNT));
    putRowIn(o, "insurance.simple", ["account", "after"], estRow("standard", `${STANDARD}（アカウント型: 払込の後は終身保険に移す。設計書のとおりに直してください）`));
    putRowIn(o, "insurance.simple", ["account", "deathBenefit"], estRow("standard", UNENTERED_DESIGN));
    return;
  }
  if (c.simple?.account === undefined) return;
  setSimple(c, "account", undefined);
  for (const f of ACCOUNT_KEYS) putRowIn(o, "insurance.simple", ["account", f], undefined);
}

/** 払込の後の扱いを選び直したときに、その扱いで使う欄を置く（入っている値は変えない。前の扱いの値も残す。年金の年数は省略で10年） */
function fitAccountAfter(o: Obj, a: InsuranceAccountInput): void {
  if (a.after === "wholeLife" && a.deathBenefit === undefined) {
    a.deathBenefit = 0;
    putRowIn(o, "insurance.simple", ["account", "deathBenefit"], estRow("standard", UNENTERED_DESIGN));
  }
  if (a.after === "annuity" && a.annual === undefined) {
    a.annual = 0;
    putRowIn(o, "insurance.simple", ["account", "annual"], estRow("standard", UNENTERED_DESIGN));
  }
}

/** 契約者の推定（被保険者。被保険者が子なら本人） */
function setHolder(h: Household, c: InsuranceContract): void {
  const insured = h.members.find((m) => m.id === c.insured);
  const self = h.members.find((m) => m.kind === "self");
  const child = insured?.kind === "child";
  c.policyholder = child && self !== undefined ? self.id : c.insured;
  putRowIn(c as unknown as Obj, "insurance.policyholder", [], estRow("standard", child ? "被保険者が子なのでご本人（推定）" : `被保険者（${memberWord(h, c.insured)}）と同じ（推定）`));
}

function syncMaturity(c: InsuranceContract, main: Coverage): void {
  const covs = c.coverages ?? [];
  const m = covs.find((x) => x.role === "main" && x.benefit === "maturity");
  if (m !== undefined) {
    m.amount = main.amount;
    m.to = main.to;
  } else covs.push({ id: newId(), role: "main", benefit: "maturity", amount: main.amount, from: { at: c.contractDate }, to: main.to });
  c.coverages = covs;
}

/** 減る形の数表を作る（true）・外す（false）。保険年度ごとに、はじめの額から毎年同じ額ずつ減る（保障の終わりの年度の次で0） */
export function setDecreasing(h: Household, c: InsuranceContract, cov: Coverage, on: boolean): void {
  const rows = (c.schedule?.rows ?? []).filter((r) => r.coverage !== cov.id || r.deathBenefit === undefined);
  if (on) {
    const end = resolveTimepoint(h, cov.to);
    if (end !== null) {
      const n = Math.max(1, Math.floor(monthsBetween(c.contractDate, end) / 12) + 1);
      for (let py = 1; py <= n; py++) rows.push({ coverage: cov.id, policyYear: py, deathBenefit: Math.floor((cov.amount * (n - py + 1)) / n) });
    }
  }
  if (rows.length > 0) c.schedule = { ...(c.schedule ?? {}), rows };
  else if (c.schedule !== undefined) {
    if (c.schedule.source !== undefined) c.schedule = { ...c.schedule, rows: [] };
    else delete c.schedule;
  }
}

/** 減る形か（保障の ID のある死亡保障の数表の行がある） */
export const isDecreasing = (c: InsuranceContract, cov: Coverage): boolean => (c.schedule?.rows ?? []).some((r) => r.coverage === cov.id && r.deathBenefit !== undefined);

/** 新しい契約（種類の既定。保険料・保障の額は未入力の警告） */
export function newContract(h: Household, base: string, kind: KindDef): InsuranceContract | null {
  const self = h.members.find((m) => m.kind === "self");
  if (self === undefined) return null;
  const date = addMonths(base, -12);
  const c: InsuranceContract = {
    id: newId(),
    template: kind.template,
    policyholder: self.id,
    insured: self.id,
    contractDate: date,
    currency: "JPY",
    premium: { amount: 0, frequency: kind.kind === "nonLife" ? "annual" : "monthly", payUntil: null },
    deductionCategory: { type: "general", regime: regimeOf(date) },
  };
  const o = c as unknown as Obj;
  putRowIn(o, "insurance.insured", [], estRow("standard", "ご本人（推定）"));
  putRowIn(o, "insurance.contractDate", [], estRow("standard", `${STANDARD}（1年前。2012年1月以後の契約は新制度の保険料控除。わかれば直してください）`));
  putRowIn(o, "insurance.premium", ["amount"], estRow("standard", UNENTERED_PREMIUM));
  applyKind(h, c, kind, true);
  return c;
}

/** 控除の区分に合わせて新旧の制度を付け外し */
function fitRegime(c: InsuranceContract, type: string): void {
  if (type === "general" || type === "careMedical" || type === "pension") c.deductionCategory = { type, regime: c.deductionCategory.regime ?? regimeOf(c.contractDate) };
  else c.deductionCategory = { type };
}

// ---- 欄 ----

/** 定期の保険（保障の終わりまで払う形）: 標準の「終わり」は保障の終わり */
const TERM_KINDS: ReadonlySet<string> = new Set(["term", "decreasingTerm", "incomeProtection", "incapacity", "mutualAid", "groupTerm"]);
/** 満期金・年金を受け取る保険と、アカウント型（保障の部分の終わりと、積立金が貯まり終わる払込の終わり）: 受け取りの時期と払込の終わりの両方が結果に効く */
const MATURITY_KINDS: ReadonlySet<string> = new Set(["endowment", "education", "privateAnnuity", "account"]);

/**
 * 保障の終わりと払込の終わりの欄の、標準・詳細（0078）。定期の保険は保障の終わり（払込は同じ月までが多い）、終身の保険（終身・医療・がん・
 * 介護・外貨建て・変額）は払込の終わり（保障は終身、払込は60歳・65歳などで終わる形が多く、結果に効く）。一時払いは払込の終わりを聞かない
 */
export function endLevels(kind: string, single: boolean): { coverage: "simple" | "detail"; premium: "simple" | "detail" } {
  if (TERM_KINDS.has(kind)) return { coverage: "simple", premium: "detail" };
  return { coverage: MATURITY_KINDS.has(kind) ? "simple" : "detail", premium: single ? "detail" : "simple" };
}

/** 払込の終わり（時点の部品。空欄は終身払い） */
function payUntilField(find: Finder, k: string, id: string, level: "simple" | "detail", label: string, nullText = "終身払い"): FieldDef {
  return withAddress(
    timepointField({
      key: `${k}/payUntil`,
      item: "insurance.premium",
      label,
      level,
      find: (h, w) => (find(h, w) as InsuranceContract | undefined)?.premium as unknown as Obj | undefined,
      path: ["payUntil"],
      optional: true,
      nullText,
      ageOf: (h) => h.members.find((m) => m.id === (h.insuranceContracts ?? []).find((x) => x.id === id)?.insured),
      who: ADULTS_WHO,
    }),
    () => at(id, "insurance.premium", ["payUntil"]),
  );
}

/** 保険料の欄の名前（払い方に合わせる。1回だけ払う一時払いは名前だけ） */
export function premiumLabel(what: string, frequency: InsuranceContract["premium"]["frequency"]): string {
  return frequency === "monthly" ? `${what}（月額）` : frequency === "annual" ? `${what}（年額）` : what;
}

function contractGroups(wh: WorkingHousehold, c: InsuranceContract, i: number): GroupDef[] {
  const find = byId(contracts, c.id);
  const k = `ins/${c.id}`;
  const kind = kindOf(c);
  const main = mainCoverage(c, kind);
  const insuredOf = (h: Household) => h.members.find((m) => m.id === (h.insuranceContracts ?? []).find((x) => x.id === c.id)?.insured);
  const contractIn = (h: Household) => (h.insuranceContracts ?? []).find((x) => x.id === c.id);
  const mutateC = (w: WorkingHousehold, fn: (h: Household, x: InsuranceContract) => void) =>
    mutate(w, (h) => {
      const x = contractIn(h);
      if (x !== undefined) fn(h, x);
    });

  const fields: FieldDef[] = [];
  // 種類（ひな形）。選択肢は「＋ 保険契約を足す」の一覧と同じ見出しで分け、学資保険は子のいる世帯だけ（今の契約の種類はいつも出す）。
  // 標準では損害保険を出さない（足す一覧と同じ。今の契約が損害保険なら出す）: 標準だけの欄と、詳細の欄（損害保険も出す）の2つにする
  const hasChild = wh.request.input.household.members.some((m) => m.kind === "child");
  const kindOptions = (withNonLife: boolean) => KIND_OPTIONS.filter((o) => o.value === kind.kind || ((o.value !== "education" || hasChild) && (o.value !== "nonLife" || withNonLife)));
  const templateField = (key: string, level: "simple" | "detail", options: Option[], simpleOnly: boolean): FieldDef =>
    withAddress(
      field({
        key,
        item: "insurance.template",
        label: "種類",
        level,
        ...(simpleOnly ? { simpleOnly: true } : {}),
        kind: "select",
        options,
        structural: true,
        sideEffects: "推定のままの値は新しい種類の既定に入れ直します（確定の値はそのまま）",
        get: (w) => ({ value: kindOf(contractIn(w.request.input.household) ?? c).kind }),
        set: (w, v) => {
          const next = kindDef(String(v));
          if (next === undefined) return w;
          return mutateC(w, (h, x) => applyKind(h, x, next, false));
        },
      }),
      () => at(c.id, "insurance.subtype"),
    );
  const simpleKinds = kindOptions(false);
  const allKinds = kindOptions(true);
  if (simpleKinds.length === allKinds.length) fields.push(templateField(`${k}/template`, "simple", allKinds, false));
  else fields.push(templateField(`${k}/template`, "simple", simpleKinds, true), templateField(`${k}/templateAll`, "detail", allKinds, false));
  // 被保険者
  fields.push(
    withAddress(
      plain({
        key: `${k}/insured`,
        item: "insurance.insured",
        label: "被保険者",
        level: "simple",
        kind: "select",
        options: memberOptions(wh, inHousehold),
        find,
        path: ["insured"],
        after: (h, target) => {
          const x = target as unknown as InsuranceContract;
          const o = target;
          if (autoRow(o, "insurance.policyholder")) setHolder(h, x);
          const kd = kindOf(x);
          const m = mainCoverage(x, kd);
          if (m !== undefined && autoRow(o, "insurance.coverages", [m.id, endPath(kd)])) {
            const e = defaultEnd(h, kd, x.insured);
            if (endPath(kd) === "from") m.from = e.tp ?? { at: x.contractDate };
            else m.to = e.tp;
            putRowIn(o, "insurance.coverages", [m.id, endPath(kd)], estRow("standard", `${e.basis}・${memberWord(h, x.insured)}`));
            if (kd.decreasing === true && m.benefit === "death") setDecreasing(h, x, m, true);
          }
          if (autoRow(o, "insurance.premium", ["payUntil"])) {
            const p = defaultPayUntil(h, kd, x.insured);
            x.premium.payUntil = x.premium.frequency === "single" ? null : p.tp;
            putRowIn(o, "insurance.premium", ["payUntil"], estRow("standard", `${p.basis}・${memberWord(h, x.insured)}`));
          }
        },
      }),
      () => at(c.id, "insurance.insured"),
    ),
  );
  // 保険料と払い方。保険料の欄の名前は払い方に合わせる（月払いは「保険料（月額）」、年払いは「保険料（年額）」、一時払いは「保険料」。
  // お金の行の額の呼び方と同じ考え。0055 の 2026-10-29 の追記）
  fields.push(
    withAddress(
      plain({
        key: `${k}/premium`,
        item: "insurance.premium",
        label: premiumLabel("保険料", c.premium.frequency),
        level: "simple",
        kind: "yen",
        basis: "once",
        find,
        path: ["premium", "amount"],
        unit: "yen",
        ...(kind.kind === "account" ? { help: "保障の部分と積立の部分を合わせた保険料です" } : kind.kind === "foreignCurrency" ? { help: "外貨で払う保険料は、今の為替で円に直した額を入れます（為替で変わる目安です）" } : {}),
        // 空にしたら0円の未入力に戻す（保険料の額は省けない）
        after: (_h, target, v) => {
          if (v !== null) return;
          (target as unknown as InsuranceContract).premium.amount = 0;
          putRowIn(target, "insurance.premium", ["amount"], estRow("standard", UNENTERED_PREMIUM));
        },
      }),
      () => at(c.id, "insurance.premium", ["amount"]),
    ),
    // 当て先（insurance.premium の frequency）は、書類の読み取りの候補が払い方を当てるのに使う（0153）
    withAddress(
      plain({
        key: `${k}/freq`,
        item: "insurance.premium",
        label: "払い方",
        level: "simple",
        kind: "select",
        options: PREMIUM_FREQUENCY,
        find,
        path: ["premium", "frequency"],
        after: (_h, target, v) => {
          if (v === "single") (target as unknown as InsuranceContract).premium.payUntil = null;
        },
      }),
      () => at(c.id, "insurance.premium", ["frequency"]),
    ),
  );
  // 主な保障の額（種類で給付が変わる1欄）と終わり。標準の「終わり」は、定期の保険では保障の終わり、終身の保険では払込の終わりとして聞く。
  // 満期金・年金を受け取る保険（養老・学資・個人年金）は、受け取りの時期（保障の終わり・受け取りの始まり）と払込の終わりの両方を標準に出す（0078）
  const ends = endLevels(kind.kind, c.premium.frequency === "single");
  if (kind.main !== null) {
    const mk = kind.main;
    const findMain: Finder = (h) => {
      const x = contractIn(h);
      return x === undefined ? undefined : (mainCoverage(x, kindOf(x)) as unknown as Obj | undefined);
    };
    const legacyFund = FUND_TEMPLATES.has(c.template) && c.simple?.estimate !== true && (c.simple?.assetClass !== undefined || c.simple?.loadRate !== undefined);
    fields.push(
      withAddress(
        field({
          key: `${k}/main`,
          item: "insurance.coverages",
          label: mk.label,
          level: "simple",
          kind: "yen",
          basis: mk.basis,
          ...(mk.basis !== "once" || mk.benefit === "hospitalDaily" ? { unit: "yen" as const } : {}),
          ...(mk.help !== undefined ? { help: mk.help } : {}),
          ...(SIDE[kind.kind] !== undefined ? { sideEffects: SIDE[kind.kind] } : {}),
          get: (w) => {
            const m = findMain(w.request.input.household, w) as unknown as Coverage | undefined;
            // 主な保障の無い契約（保険料控除のためだけの契約・取り込んだ契約）は未入力の警告。値を打つと主契約を作る
            return { value: m?.amount ?? null, ...(m === undefined ? { estimated: UNENTERED_MAIN } : {}), ...(legacyFund ? { warn: "積立金を前提の利回りで伸ばしています（前の入れ方）。「円の目安の形に直す」で、入れた円の目安の額だけで計算します" } : {}) };
          },
          set: (w, v) =>
            mutateC(w, (h, x) => {
              const kd = kindOf(x);
              let m = mainCoverage(x, kd);
              if (m === undefined) {
                if (kd.main === null) return;
                m = { id: newId(), role: "main", benefit: kd.main.benefit, amount: 0, from: { at: x.contractDate }, to: null };
                (x.coverages ??= []).unshift(m);
              }
              const before = m.amount;
              m.amount = v === null ? 0 : Number(v);
              if (v === null) putRowIn(x as unknown as Obj, "insurance.coverages", [m.id, "amount"], estRow("standard", UNENTERED_MAIN));
              if (kd.kind === "endowment") syncMaturity(x, m);
              if (m.benefit === "death" && isDecreasing(x, m)) setDecreasing(h, x, m, true);
              // 医療保険: 推定のままの手術の額を入れ直す
              const o = x as unknown as Obj;
              for (const s of x.coverages ?? []) {
                if (s.benefit !== "surgery" || !isAutoStandard(rowIn(o, "insurance.coverages", [s.id, "amount"])) || s.amount !== before * surgeryRatio()) continue;
                s.amount = m.amount * surgeryRatio();
                putRowIn(o, "insurance.coverages", [s.id, "amount"], estRow("standard", surgeryBasis(m.amount)));
              }
            }),
        }),
        (w) => {
          const m = findMain(w.request.input.household, w) as unknown as Coverage | undefined;
          return m === undefined ? null : at(c.id, "insurance.coverages", [m.id, "amount"]);
        },
      ),
    );
    if (main !== undefined) {
      const ep = endPath(kind);
      fields.push(
        withAddress(
          timepointField({
            key: `${k}/end`,
            item: "insurance.coverages",
            label: ep === "from" ? "受け取りの始まり" : "保障の終わり",
            level: ends.coverage,
            find: findMain,
            path: [ep],
            ageOf: insuredOf,
            who: ADULTS_WHO,
            ...(ep === "to" ? { optional: true, nullText: "終身" } : {}),
            after: (h, target) => {
              const xc = contractIn(h);
              if (xc === undefined) return;
              const m = target as unknown as Coverage;
              const o = xc as unknown as Obj;
              // 払込の終わりが「保障の終わりと同じ」の推定のままなら、いっしょに動かす
              if (ep === "to" && isAuto(rowIn(o, "insurance.premium", ["payUntil"]), "保障の終わりと同じ") && xc.premium.frequency !== "single") {
                xc.premium.payUntil = m.to == null ? null : structuredClone(m.to);
                const ym = resolveTimepoint(h, m.to);
                putRowIn(o, "insurance.premium", ["payUntil"], estRow("standard", `保障の終わりと同じ（${ym === null ? "終身" : formatYearMonth(ym)}）`));
              }
              if (kindOf(xc).kind === "endowment") syncMaturity(xc, m);
              if (m.benefit === "death" && isDecreasing(xc, m)) setDecreasing(h, xc, m, true);
            },
          }),
          () => at(c.id, "insurance.coverages", [main.id, ep]),
        ),
      );
    }
  } else {
    // 保険料だけの契約（損害保険）: 終わりは保険期間（払込の終わり）
    fields.push(payUntilField(find, k, c.id, "simple", "保険期間の終わり", "終わりなし"));
  }

  // 終わりの2つ（保障の終わり・払込の終わり）と払込免除を続けて並べる。一時払いは払込の終わりが無いので出さない
  if (kind.main !== null && c.premium.frequency !== "single") fields.push(payUntilField(find, k, c.id, ends.premium, "払込の終わり"));
  fields.push(plain({ key: `${k}/waiver`, item: "insurance.waiver", label: "払込免除", help: "被保険者の障害・就業不能で払込が止まる契約に入れます", level: "detail", kind: "bool", find, path: ["waiver"], optional: true, fallback: false }));

  // ---- 詳細 ----
  // 受取人・死亡保険金の税は、死亡の保障（死亡保険金・収入保障。主契約か特約）のある契約だけ（入っている受取人は残して出す）
  const deathCover = (c.coverages ?? []).some((x) => x.benefit === "death" || x.benefit === "incomeProtection") || kind.main?.benefit === "death" || kind.main?.benefit === "incomeProtection" || c.simple?.account !== undefined;
  const showBenef = deathCover || (c.beneficiaries ?? []).length > 0;
  fields.push(
    withAddress(plain({ key: `${k}/label`, item: "insurance.label", label: "契約の表示名", level: "detail", kind: "text", find, path: ["label"], optional: true, help: "保険会社・商品名など。表示だけに使います（持ち帰り用のレポート・AI に渡す範囲には入れません）" }), () => at(c.id, "insurance.label")),
    withAddress(plain({ key: `${k}/holder`, item: "insurance.policyholder", label: "契約者", help: "保険料を払う人です", level: "detail", kind: "select", options: memberOptions(wh), find, path: ["policyholder"] }), () => at(c.id, "insurance.policyholder")),
    withAddress(
      plain({
        key: `${k}/date`,
        item: "insurance.contractDate",
        label: "契約年月",
        level: "detail",
        kind: "ym",
        find,
        path: ["contractDate"],
        help: "保険料控除の新旧の制度（2012年1月から新制度）と、払った保険料の累計に効きます",
        after: (_h, target) => {
          const x = target as unknown as InsuranceContract;
          if (x.deductionCategory.regime !== undefined && (autoRow(target, "insurance.deductionCategory", ["type"]) || autoRow(target, "insurance.deductionCategory", ["regime"]))) {
            x.deductionCategory = { ...x.deductionCategory, regime: regimeOf(x.contractDate) };
            putRowIn(target, "insurance.deductionCategory", ["regime"], estRow("standard", `契約年月（${formatYearMonth(x.contractDate)}）から`));
          }
          // 保障の始まりが前の契約年月のままなら合わせる
          for (const cov of x.coverages ?? []) if (cov.from?.at !== undefined && cov.from.at === c.contractDate) cov.from = { at: x.contractDate };
        },
      }),
      () => at(c.id, "insurance.contractDate"),
    ),
    ...(showBenef ? [beneficiaryField(wh, c, find, k), taxField(c, k)] : []),
  );
  if ((c.coverages ?? []).some((x) => x.benefit === "maturity" || x.benefit === "annuity" || x.benefit === "survival"))
    fields.push(plain({ key: `${k}/annuitant`, item: "insurance.annuitant", label: "満期金・年金・祝金の受取人", level: "detail", kind: "select", options: memberOptions(wh, inHousehold), find, path: ["annuitant"], optional: true, fallback: c.policyholder, help: "入れなければ契約者（契約者が受け取れば一時所得・雑所得、ほかの人なら贈与税）" }));
  fields.push(
    withAddress(plain({ key: `${k}/deduction`, item: "insurance.deductionCategory", label: "保険料控除の区分", level: "detail", kind: "select", options: DEDUCTION_TYPES, find, path: ["deductionCategory", "type"], after: (_h, target, v) => fitRegime(target as unknown as InsuranceContract, String(v)) }), () => at(c.id, "insurance.deductionCategory", ["type"])),
  );
  if (c.deductionCategory.regime !== undefined)
    fields.push(
      withAddress(
        plain({
          key: `${k}/regime`,
          item: "insurance.deductionCategory",
          label: "新旧の制度",
          level: "detail",
          kind: "select",
          options: [
            { value: "new", label: "新制度（2012年以後の契約）" },
            { value: "old", label: "旧制度" },
          ],
          find,
          path: ["deductionCategory", "regime"],
        }),
        () => at(c.id, "insurance.deductionCategory", ["regime"]),
      ),
    );
  fields.push(
    timepointField({ key: `${k}/surrender`, item: "insurance.surrender", label: "解約の月", level: "detail", find, path: ["surrender"], optional: true, absentWhenEmpty: true, nullText: "解約しない", ageOf: insuredOf, who: ADULTS_WHO, help: "その月に解約返戻金を受け取り、保障と払込が終わります" }),
  );
  // 解約返戻金（貯蓄型は返戻率、解約の月がある契約・円の目安の形は解約の月の額）。低解約返戻金型は払込中の率と払込が終わった時の率を標準に、
  // アカウント型は返戻率の代わりに積立の部分（払込が終わった時の積立金・払込の後の扱い）を標準に出す（0055 の追記 2026-11-03）
  if (c.simple?.account !== undefined) fields.push(...accountFields(c, k, contractIn));
  else if (SAVINGS_TEMPLATES.has(c.template)) {
    const low = kind.kind === "lowSurrender" || c.simple?.returnRateDuring !== undefined;
    if (low) fields.push(duringRateField(c, find, k));
    fields.push(returnRateField(c, find, k, low));
  }
  if (c.surrender !== undefined || (FUND_TEMPLATES.has(c.template) && c.simple?.estimate === true)) fields.push(surrenderAmountField(c, find, k));

  const tags = detailTags(wh, c);
  const notes = [kind.note, tags.length > 0 ? `詳細に入っている値: ${tags.join("・")}` : undefined].filter((x): x is string => x !== undefined);
  const actions: ActionDef[] = [removeAction(`${k}/remove`, WORDS.remove, "simple", (h) => void (h.insuranceContracts = (h.insuranceContracts ?? []).filter((x) => x.id !== c.id)))];
  if (FUND_TEMPLATES.has(c.template) && c.simple?.estimate !== true && (c.simple?.assetClass !== undefined || c.simple?.loadRate !== undefined))
    actions.push({
      key: `${k}/toEstimate`,
      label: "円の目安の形に直す",
      level: "simple",
      title: "積立金を運用で増やさず、入れた円の目安の額だけで計算します",
      run: (w) => mutateC(w, (_h, x) => void (x.simple = { ...(x.simple ?? {}), estimate: true })),
    });
  const groups: GroupDef[] = [
    {
      key: k,
      title: `${c.label !== undefined && c.label !== "" ? c.label : kind.label} ${i + 1}（被保険者: ${memberLabel(wh, c.insured)}）`,
      ...(notes.length > 0 ? { note: notes.join("。") } : {}),
      level: "simple",
      moreLabel: insuranceMoreLabel(kind.kind),
      fields,
      actions,
    },
  ];

  // 更新（詳細）
  (c.renewals ?? []).forEach((r, j) => {
    const rid = r.id;
    const findR: Finder = (h) => {
      const x = contractIn(h);
      return (rid !== undefined ? x?.renewals?.find((y) => y.id === rid) : x?.renewals?.[j]) as unknown as Obj | undefined;
    };
    const kr = `${k}/renew/${rid ?? j}`;
    groups.push({
      key: kr,
      title: `更新 ${j + 1}`,
      level: "detail",
      fields: [
        timepointField({ key: `${kr}/at`, item: "insurance.renewals", label: "更新の月", level: "detail", find: findR, path: ["at"], ageOf: insuredOf, who: ADULTS_WHO }),
        plain({ key: `${kr}/premium`, item: "insurance.renewals", label: premiumLabel("更新後の保険料", c.premium.frequency), level: "detail", kind: "yen", basis: "once", find: findR, path: ["premium"] }),
      ],
      actions: [
        removeAction(`${kr}/remove`, "外す", "detail", (h) => {
          const x = contractIn(h);
          if (x?.renewals === undefined) return;
          x.renewals = x.renewals.filter((y, n) => (rid !== undefined ? y.id !== rid : n !== j));
          if (x.renewals.length === 0) delete x.renewals;
        }),
      ],
    });
  });

  // 年齢ごとの解約返戻率の点（低解約返戻金型の詳細）
  const lowCv = kind.kind === "lowSurrender" || (c.simple?.returnRatePoints ?? []).length > 0;
  if (lowCv) groups.push(...ratePointGroups(wh, c));
  // 保障の明細（詳細）
  (c.coverages ?? []).forEach((cov, j) => groups.push(coverageGroup(wh, c, cov, j, find)));
  groups.push({
    key: `${k}/addCov`,
    level: "detail",
    fields: [],
    actions: [
      {
        key: `${k}/addCoverage`,
        label: "＋ 保障", help: "主契約か特約の保障を足します（最初の1つが主契約）",
        level: "detail",
        run: (w) =>
          mutateC(w, (_h, x) => {
            const role = (x.coverages ?? []).some((y) => y.role === "main") ? "rider" : "main";
            const cov: Coverage = { id: newId(), role, benefit: role === "main" ? (kindOf(x).main?.benefit ?? "death") : "hospitalDaily", amount: 0, from: { at: x.contractDate }, to: null };
            (x.coverages ??= []).push(cov);
            putRowIn(x as unknown as Obj, "insurance.coverages", [cov.id, "amount"], estRow("standard", UNENTERED_MAIN));
          }),
      },
      {
        key: `${k}/addRenewal`,
        label: "＋ 更新", help: "更新後の保険料を入れます",
        level: "detail",
        run: (w) =>
          mutateC(w, (h, x) => {
            const last = (x.renewals ?? []).at(-1);
            const from = last !== undefined ? resolveTimepoint(h, last.at) : x.contractDate;
            (x.renewals ??= []).push({ id: newId(), at: { at: addMonths(from ?? x.contractDate, 120) }, premium: last?.premium ?? x.premium.amount });
          }),
      },
      ...(lowCv
        ? [
            {
              key: `${k}/addRatePoint`,
              label: "＋ 年齢ごとの返戻率",
              help: "設計書の解約返戻金の推移の表から、払込が終わった後の年齢の率を2〜3点写します（点の間はまっすぐつなぎます）",
              level: "detail" as const,
              run: (w: WorkingHousehold) => mutateC(w, (h, x) => addRatePoint(h, x)),
            },
          ]
        : []),
    ],
  });
  return groups;
}

/** 受取人（死亡保険金）。空は省略（死亡の当時の配偶者、いなければ子） */
const EXTERNAL = [
  { value: "ext:child", label: "子（世帯の外）" },
  { value: "ext:parent", label: "親（世帯の外）" },
  { value: "ext:sibling", label: "兄弟姉妹（世帯の外）" },
  { value: "ext:other", label: "その他（世帯の外）" },
];
function beneficiaryField(wh: WorkingHousehold, c: InsuranceContract, find: Finder, k: string): FieldDef {
  const multi = (c.beneficiaries ?? []).length > 1;
  return field({
    key: `${k}/benef`,
    item: "insurance.beneficiaries",
    label: "受取人（死亡保険金）",
    level: "detail",
    kind: "select",
    // 被保険者は死亡保険金の受取人にならない（入っている値なら残して出す）
    options: [{ value: "", label: "省略（配偶者、いなければ子）" }, ...memberOptions(wh, (m) => inHousehold(m) && (m.id !== c.insured || c.beneficiaries?.[0]?.member === m.id)), ...EXTERNAL],
    optional: true,
    ...(multi ? { readOnly: "受取人が複数（割合つき）の契約です。証券どおりの割合のまま計算します" } : {}),
    help: "保険金にかかる税（相続税・所得税・贈与税のどれになるか）と、相続税の非課税枠の計算に使います",
    get: (w) => {
      const x = find(w.request.input.household, w) as InsuranceContract | undefined;
      const b = x?.beneficiaries?.[0];
      if (b === undefined) return { value: "", implicit: true };
      return { value: b.member ?? `ext:${b.external ?? "other"}` };
    },
    set: (w, v) =>
      mutate(w, (h) => {
        const x = find(h, w) as InsuranceContract | undefined;
        if (x === undefined) return;
        const s = v === null ? "" : String(v);
        if (s === "") delete x.beneficiaries;
        else if (s.startsWith("ext:")) x.beneficiaries = [{ external: s.slice(4) as "child" | "parent" | "sibling" | "other", share: "1" }];
        else x.beneficiaries = [{ member: s, share: "1" }];
      }),
  });
}

/** 受け取るお金の税（読むだけ） */
function taxField(c: InsuranceContract, k: string): FieldDef {
  const receiver = c.beneficiaries?.[0]?.member ?? null;
  const text = (c.coverages ?? []).some((x) => x.benefit === "death" || x.benefit === "incomeProtection") ? deathTaxText(c, receiver) : "—";
  return field({ key: `${k}/tax`, item: null, label: "死亡保険金にかかる税", level: "detail", kind: "text", readOnly: "契約者・被保険者・受取人の組から決まります", get: () => ({ value: text }), set: (w) => w });
}

/** 返戻率（貯蓄型。空は未入力の警告: 解約返戻金を0円で数えている）。低解約返戻金型は「払込が終わった時の解約返戻率」として標準に出す */
function returnRateField(c: InsuranceContract, find: Finder, k: string, low = false): FieldDef {
  return withAddress(
    field({
      key: `${k}/sv/rate`,
      item: "insurance.simple",
      label: low ? "払込が終わった時の解約返戻率" : "解約返戻率（払込の終わりの時点）",
      level: low ? "simple" : "detail",
      kind: "pct",
      optional: true,
      help: low
        ? "払込が終わった時の解約返戻金÷払った保険料の累計（設計書の値）。払込が終わった後は、この率のまま計算します（「詳細」で年齢ごとの率を足せます）"
        : "払った保険料の累計に対する割合（設計書・お知らせの値）。資産と負債の推移の「保険の解約返戻金」と元本割れの表示に使います",
      get: (w) => {
        const x = find(w.request.input.household, w) as InsuranceContract | undefined;
        const v = x?.simple?.returnRate ?? null;
        // 保障の明細か数表のある契約だけ未入力の警告（保険料控除のためだけの契約には出さない。計算エンジンの知らせと同じ決まり）
        const asks = v === null && x !== undefined && (x.coverages !== undefined || x.schedule !== undefined);
        return { value: v, ...(asks ? { estimated: "未入力（解約返戻金を0円で数えています〔資産と負債・保険料のうち貯まる分〕）" } : {}) };
      },
      set: (w, v) =>
        mutate(w, (h) => {
          const x = find(h, w) as InsuranceContract | undefined;
          if (x === undefined) return;
          if (v === null) {
            if (x.simple !== undefined) {
              const { returnRate: _r, ...rest } = x.simple;
              void _r;
              if (Object.keys(rest).length > 0) x.simple = rest;
              else delete x.simple;
            }
          } else x.simple = { ...(x.simple ?? {}), returnRate: String(v) };
        }),
    }),
    () => at(c.id, "insurance.simple", ["returnRate"]),
  );
}

/** 払込中の解約返戻率（低解約返戻金型。0055 の追記 2026-11-03） */
function duringRateField(c: InsuranceContract, find: Finder, k: string): FieldDef {
  return withAddress(
    field({
      key: `${k}/sv/during`,
      item: "insurance.simple",
      label: "払込中の解約返戻率",
      level: "simple",
      kind: "pct",
      optional: true,
      help: "払込中に解約したときの解約返戻金÷払った保険料の累計（設計書の値）。払込中は、この率で計算します",
      get: (w) => ({ value: (find(w.request.input.household, w) as InsuranceContract | undefined)?.simple?.returnRateDuring ?? null }),
      set: (w, v) =>
        mutate(w, (h) => {
          const x = find(h, w) as InsuranceContract | undefined;
          if (x !== undefined) setSimple(x, "returnRateDuring", v === null ? undefined : String(v));
        }),
    }),
    () => at(c.id, "insurance.simple", ["returnRateDuring"]),
  );
}

/** 年齢ごとの解約返戻率の点（低解約返戻金型の詳細。設計書の解約返戻金の推移の表から写す） */
function ratePointGroups(wh: WorkingHousehold, c: InsuranceContract): GroupDef[] {
  const contractIn = (h: Household) => (h.insuranceContracts ?? []).find((x) => x.id === c.id);
  return (c.simple?.returnRatePoints ?? []).flatMap((pt, j) => {
    const pid = pt.id;
    if (pid === undefined) return [];
    const findP: Finder = (h) => (contractIn(h)?.simple?.returnRatePoints ?? []).find((y) => y.id === pid) as unknown as Obj | undefined;
    const kp = `ins/${c.id}/sv/pt/${pid}`;
    const ageOf = memberLabel(wh, c.insured);
    return [
      {
        key: kp,
        title: `年齢ごとの解約返戻率 ${j + 1}`,
        level: "detail",
        fields: [
          withAddress(
            plain({ key: `${kp}/age`, item: "insurance.simple", label: `年齢（${ageOf}）`, level: "detail", kind: "int", suffix: "歳", min: 0, max: 120, find: findP, path: ["age"], help: "払込が終わった後の年齢を入れます（払込中の年齢の点は計算に使いません）" }),
            () => at(c.id, "insurance.simple", ["returnRatePoints", pid, "age"]),
          ),
          withAddress(
            plain({ key: `${kp}/rate`, item: "insurance.simple", label: "その年齢の時の解約返戻率", level: "detail", kind: "pct", find: findP, path: ["rate"], help: "その年齢の解約返戻金÷払った保険料の累計（設計書の解約返戻金の推移の表の値）。点の間は、まっすぐつないで計算します" }),
            () => at(c.id, "insurance.simple", ["returnRatePoints", pid, "rate"]),
          ),
        ],
        actions: [
          removeAction(`${kp}/remove`, "外す", "detail", (h) => {
            const x = contractIn(h);
            if (x?.simple?.returnRatePoints === undefined) return;
            const rest = x.simple.returnRatePoints.filter((y) => y.id !== pid);
            setSimple(x, "returnRatePoints", rest.length > 0 ? rest : undefined);
            for (const f of ["age", "rate"]) putRowIn(x as unknown as Obj, "insurance.simple", ["returnRatePoints", pid, f], undefined);
          }),
        ],
      },
    ];
  });
}

/** 年齢ごとの率の点を1つ足す（年齢は前の点か払込の終わりの10年後、率は前の点か払込が終わった時の率） */
function addRatePoint(h: Household, x: InsuranceContract): void {
  const pts = x.simple?.returnRatePoints ?? [];
  const last = pts.at(-1);
  const insured = h.members.find((m) => m.id === x.insured);
  const payEnd = resolveTimepoint(h, x.premium.payUntil);
  const endAge = insured === undefined || payEnd === null ? 65 : Math.floor(monthsBetween(insured.birth.birthYearMonth, payEnd) / 12);
  const age = Math.min(120, (last?.age ?? endAge) + 10);
  setSimple(x, "returnRatePoints", [...pts, { id: newId(), age, rate: last?.rate ?? x.simple?.returnRate ?? lowCvRate("end") }]);
}

/** アカウント型の積立の部分の欄（標準。0055 の追記 2026-11-03） */
function accountFields(c: InsuranceContract, k: string, contractIn: (h: Household) => InsuranceContract | undefined): FieldDef[] {
  const findA: Finder = (h) => contractIn(h)?.simple?.account as unknown as Obj | undefined;
  const a = c.simple?.account;
  const addr = (f: string) => () => at(c.id, "insurance.simple", ["account", f]);
  // 額は空にしたら0円の未入力に戻す（設計書の額は省けない）
  const yenField = (f: "value" | "deathBenefit" | "annual", label: string, help: string, basis: "once" | "annual", unentered: string): FieldDef =>
    withAddress(
      plain({
        key: `${k}/acct/${f}`,
        item: "insurance.simple",
        label,
        level: "simple",
        kind: "yen",
        basis,
        help,
        find: findA,
        path: [f],
        after: (h, target, v) => {
          if (v !== null) return;
          (target as unknown as Record<string, number>)[f] = 0;
          const x = contractIn(h);
          if (x !== undefined) putRowIn(x as unknown as Obj, "insurance.simple", ["account", f], estRow("standard", unentered));
        },
      }),
      addr(f),
    );
  const out: FieldDef[] = [
    yenField(
      "value",
      "払込が終わった時の積立金の目安",
      "設計書の「払込が終わった時の積立金」の額。積立金は契約の月からこの額まで毎年まっすぐ増えるものとして計算します（途中で解約したときの返戻金も、亡くなったときに受け取る積立金もこの線から）。利率が変わったときは、新しい設計書の数字に入れ直してください",
      "once",
      UNENTERED_ACCOUNT,
    ),
    withAddress(
      plain({
        key: `${k}/acct/after`,
        item: "insurance.simple",
        label: "払込が終わった後",
        level: "simple",
        kind: "select",
        structural: true,
        options: [
          { value: "wholeLife", label: "終身保険に移す" },
          { value: "annuity", label: "年金で受け取る" },
          { value: "surrender", label: "解約して受け取る" },
        ],
        help: "積立金をどうするか（設計書・お客さまの予定のとおり）。解約して受け取るなら、払込が終わった月に積立金を受け取り、契約は終わります",
        find: findA,
        path: ["after"],
        after: (h, target) => {
          const x = contractIn(h);
          if (x !== undefined) fitAccountAfter(x as unknown as Obj, target as unknown as InsuranceAccountInput);
        },
      }),
      addr("after"),
    ),
  ];
  if (a?.after === "wholeLife") out.push(yenField("deathBenefit", "終身保険の死亡保険金", "払込が終わった時に、積立金で終身保険に移した後の死亡保険金（設計書の額）", "once", UNENTERED_DESIGN));
  if (a?.after === "annuity") {
    out.push(yenField("annual", "年金の年額", "払込が終わった月から毎年受け取る年金の額（設計書の額）", "annual", UNENTERED_DESIGN));
    out.push(
      withAddress(
        plain({ key: `${k}/acct/years`, item: "insurance.simple", label: "年金の年数", level: "simple", kind: "int", suffix: "年", min: 1, max: 50, find: findA, path: ["years"], optional: true, fallback: 10, help: "年金を受け取る年数（入れなければ10年）" }),
        addr("years"),
      ),
    );
  }
  return out;
}

/** 解約の月の保険年度（計算エンジンと同じ数え方: 契約の月から満の年数） */
const surrenderYear = (h: Household, x: InsuranceContract): number | null => {
  const s = resolveTimepoint(h, x.surrender);
  return s === null ? null : Math.floor(monthsBetween(x.contractDate, s) / 12);
};

/** 解約の月の解約返戻金（数表のその保険年度の行に書く。円の目安の形の契約はこれだけで解約返戻金を数える） */
function surrenderAmountField(c: InsuranceContract, find: Finder, k: string): FieldDef {
  return field({
    key: `${k}/sv/amount`,
    item: "insurance.schedule",
    label: "解約の月の解約返戻金（円）",
    level: "detail",
    kind: "yen",
    basis: "once",
    optional: true,
    help: c.surrender === undefined ? "先に解約の月を入れてください（その保険年度の解約返戻金として数えます）" : c.template === "insurance.foreignCurrency" ? "お知らせ・設計書の解約返戻金。外貨の額なら、今の為替で円に直した額を入れます（為替で変わる目安です）" : "お知らせ・設計書の解約返戻金。変額保険は円の目安（運用で変わります）",
    get: (w) => {
      const h = w.request.input.household;
      const x = find(h, w) as InsuranceContract | undefined;
      const py = x === undefined ? null : surrenderYear(h, x);
      const row = py === null ? undefined : x?.schedule?.rows.find((r) => r.policyYear === py && r.surrenderValue !== undefined && r.coverage === undefined);
      return { value: row?.surrenderValue ?? null };
    },
    set: (w, v) =>
      mutate(w, (h) => {
        const x = find(h, w) as InsuranceContract | undefined;
        if (x === undefined) return;
        const py = surrenderYear(h, x);
        if (py === null || py < 1) return;
        const rows = (x.schedule?.rows ?? []).filter((r) => !(r.policyYear === py && r.coverage === undefined && r.surrenderValue !== undefined && r.deathBenefit === undefined));
        if (v !== null) rows.push({ policyYear: py, surrenderValue: Number(v) });
        if (rows.length > 0) x.schedule = { ...(x.schedule ?? {}), rows };
        else delete x.schedule;
      }),
  });
}

/** 簡易で見せる札（詳細に入っている値） */
function detailTags(wh: WorkingHousehold, c: InsuranceContract): string[] {
  const out: string[] = [];
  const riders = (c.coverages ?? []).filter((x) => x.role === "rider").length;
  if (riders > 0) out.push(`特約 ${riders}件`);
  if ((c.renewals ?? []).length > 0) out.push(`更新 ${(c.renewals ?? []).length}回`);
  const s = resolveTimepoint(wh.request.input.household, c.surrender);
  if (s !== null) out.push(`解約 ${Number(s.slice(0, 4))}年`);
  if ((c.schedule?.rows ?? []).some((r) => r.coverage === undefined)) out.push("設計書の表");
  const b = c.beneficiaries?.[0];
  if (b !== undefined) out.push(`受取人: ${b.member !== undefined ? memberLabel(wh, b.member) : "世帯の外"}`);
  if ((c.coverages ?? []).some((x) => x.insured !== undefined && x.insured !== c.insured)) out.push("家族の保障あり");
  const pts = (c.simple?.returnRatePoints ?? []).length;
  if (pts > 0) out.push(`年齢ごとの返戻率 ${pts}点`);
  return out;
}

function coverageGroup(wh: WorkingHousehold, c: InsuranceContract, cov: Coverage, j: number, find: Finder): GroupDef {
  const contractIn = (h: Household) => (h.insuranceContracts ?? []).find((x) => x.id === c.id);
  const findCov: Finder = (h) => (contractIn(h)?.coverages ?? []).find((x) => x.id === cov.id) as unknown as Obj | undefined;
  const kc = `ins/${c.id}/cov/${cov.id}`;
  const covInsured = (h: Household) => h.members.find((m) => m.id === (cov.insured ?? contractIn(h)?.insured));
  const followDecreasing = (h: Household, target: Obj) => {
    const x = contractIn(h);
    const t = target as unknown as Coverage;
    if (x !== undefined && t.benefit === "death" && isDecreasing(x, t)) setDecreasing(h, x, t, true);
  };
  // 主契約の行（契約の上の欄で額と終わりを入れる保障）は、額と終わりを読むだけにする（同じ値を2か所で直せると、どちらが正か迷うため）
  const kd = kindOf(c);
  const mainRow = kd.main !== null && mainCoverage(c, kd)?.id === cov.id;
  const ep = endPath(kd);
  // 当て先は持たない（推定・未入力の印は上の欄だけに出す。同じ印を2か所に出さない）
  const readOnlyOf = (key: string, label: string, what: string, value: (h: Household) => string): FieldDef =>
    withAddress(
      field({ key, item: "insurance.coverages", label, level: "detail", kind: "text", readOnly: `契約の上の「${what}」で入れます（同じ値です）`, get: (w) => ({ value: `${value(w.request.input.household)}（上の「${what}」と同じ）` }), set: (w) => w }),
      () => null,
    );
  const covNow = (h: Household) => (contractIn(h)?.coverages ?? []).find((x) => x.id === cov.id);
  const endText = (h: Household, tp: Coverage["to"] | Coverage["from"] | undefined, none: string): string => {
    const ym = tp == null ? null : resolveTimepoint(h, tp);
    return ym === null ? none : formatYearMonth(ym);
  };
  const fields: FieldDef[] = [
    withAddress(
      field({
        key: `${kc}/insured`,
        item: "insurance.coverages",
        label: "被保険者",
        level: "detail",
        kind: "select",
        options: memberOptions(wh, inHousehold),
        help: "家族型の医療保険・家族特約は、ここで配偶者・子を選びます。保険料・控除は契約のまま",
        get: (w) => {
          const x = find(w.request.input.household, w) as InsuranceContract | undefined;
          const y = (x?.coverages ?? []).find((z) => z.id === cov.id);
          return { value: y?.insured ?? x?.insured ?? null, ...(y?.insured === undefined ? { implicit: true } : {}) };
        },
        set: (w, v) =>
          mutate(w, (h) => {
            const x = contractIn(h);
            const y = (x?.coverages ?? []).find((z) => z.id === cov.id);
            if (x === undefined || y === undefined) return;
            if (v === null || v === x.insured) delete y.insured;
            else y.insured = String(v);
          }),
      }),
      () => at(c.id, "insurance.coverages", [cov.id, "insured"]),
    ),
    plain({
      key: `${kc}/benefit`,
      item: "insurance.coverages",
      label: "給付の種類",
      level: "detail",
      kind: "select",
      options: COVERAGE_BENEFITS,
      find: findCov,
      path: ["benefit"],
      after: (h, target, v, w0) => {
        const x = contractIn(h);
        const t = target as unknown as Coverage;
        // 給付の種類に合わない欄（限度日数・最低保証の月数など）は計算が読まないので残す（戻したときに消えない）
        if (x !== undefined && v !== "death" && (x.schedule?.rows ?? []).some((r) => r.coverage === t.id && r.deathBenefit !== undefined)) setDecreasing(h, x, t, false);
        const before = (contractIn(w0.request.input.household)?.coverages ?? []).find((z) => z.id === cov.id)?.benefit;
        if (x !== undefined && before !== undefined && typeof v === "string" && before !== v) refitBenefit(h, x, t, before, v);
      },
    }),
    mainRow
      ? readOnlyOf(`${kc}/amount`, amountLabel(cov.benefit), kd.main?.label ?? "主な保障", (h) => {
          const a = covNow(h)?.amount;
          return a === undefined ? "—" : `${a.toLocaleString("ja-JP")}円`;
        })
      : withAddress(
      {
        ...plain({
        key: `${kc}/amount`,
        item: "insurance.coverages",
        label: amountLabel(cov.benefit),
        level: "detail",
        kind: "yen",
        basis: cov.benefit === "incomeProtection" || cov.benefit === "incapacity" ? "monthly" : cov.benefit === "annuity" ? "annual" : "once",
        find: findCov,
        path: ["amount"],
        ...(cov.benefit === "hospitalDaily" || cov.benefit === "surgery" || cov.benefit === "incomeProtection" || cov.benefit === "incapacity" || cov.benefit === "annuity" ? { unit: "yen" as const } : {}),
        after: (h, target) => followDecreasing(h, target),
        }),
        // 手術の1回の額は、保険証券で確かめる値（推定は入院日額の10倍。「書類で確かめる」を出す。0041 の追記 2026-10-31）
        ...(cov.benefit === "surgery" ? { docCheck: CHECK_DOCUMENTS.surgery } : {}),
      },
      () => at(c.id, "insurance.coverages", [cov.id, "amount"]),
    ),
    mainRow && ep === "from"
      ? readOnlyOf(`${kc}/from`, "受け取りの始まり", "受け取りの始まり", (h) => endText(h, covNow(h)?.from, "—"))
      : withAddress(
          timepointField({ key: `${kc}/from`, item: "insurance.coverages", label: cov.benefit === "annuity" ? "受け取りの始まり" : "保障の始まり", level: "detail", find: findCov, path: ["from"], ageOf: covInsured, who: ADULTS_WHO, mode: "ym" }),
          // 年金にしたときの受け取りの始まりの推定の印（refitBenefit）を欄に出す
          () => at(c.id, "insurance.coverages", [cov.id, "from"]),
        ),
    mainRow && ep === "to"
      ? readOnlyOf(`${kc}/to`, "保障の終わり", "保障の終わり", (h) => endText(h, covNow(h)?.to, "終身"))
      : withAddress(
          timepointField({ key: `${kc}/to`, item: "insurance.coverages", label: "保障の終わり", level: "detail", find: findCov, path: ["to"], startPath: ["from"], ageOf: covInsured, who: ADULTS_WHO, optional: true, nullText: "終身", after: (h, target) => followDecreasing(h, target) }),
          () => at(c.id, "insurance.coverages", [cov.id, "to"]),
        ),
  ];
  if (cov.benefit === "death")
    fields.push(
      field({
        key: `${kc}/shape`,
        item: "insurance.schedule",
        label: "保障の推移の形",
        level: "detail",
        kind: "select",
        options: [
          { value: "constant", label: "一定" },
          { value: "decreasing", label: "毎年同じ額ずつ減る（終わりに0円）" },
        ],
        sideEffects: "減る形にすると、保険年度ごとの死亡保障の数表を作ります（一定に戻すと外します）",
        get: (w) => {
          const x = find(w.request.input.household, w) as InsuranceContract | undefined;
          const y = (x?.coverages ?? []).find((z) => z.id === cov.id);
          return { value: x !== undefined && y !== undefined && isDecreasing(x, y) ? "decreasing" : "constant" };
        },
        set: (w, v) =>
          mutate(w, (h) => {
            const x = contractIn(h);
            const y = (x?.coverages ?? []).find((z) => z.id === cov.id);
            if (x === undefined || y === undefined) return;
            setDecreasing(h, x, y, v === "decreasing");
          }),
      }),
    );
  const intField = (name: "minimumMonths" | "waitingMonths" | "years" | "everyYears" | "maxDays", label: string, suffix: string, max: number, fallback: number | undefined, help: string) =>
    withAddress(
      plain({ key: `${kc}/${name}`, item: "insurance.coverages", label, level: "detail", kind: "int", suffix, min: name === "maxDays" || name === "years" || name === "everyYears" ? 1 : 0, max, find: findCov, path: [name], optional: true, ...(fallback !== undefined ? { fallback } : {}), help }),
      () => at(c.id, "insurance.coverages", [cov.id, name]),
    );
  if (cov.benefit === "incomeProtection") fields.push(intField("minimumMonths", "最低保証の月数", "か月", 600, 0, "亡くなった月から保障の終わりまでがこの月数より短くても、この月数は受け取ります"));
  if (cov.benefit === "incapacity") fields.push(intField("waitingMonths", "免責の月数", "か月", 120, 0, "働けなくなった月の翌月から、この月数の後に給付が始まります"));
  if (cov.benefit === "annuity") fields.push(intField("years", "年金の年数", "年", 100, undefined, "入れなければ保障の終わりまで"));
  if (cov.benefit === "survival") fields.push(intField("everyYears", "祝金の間隔", "年", 50, undefined, "保障の始まりから、この年ごとに受け取ります"));
  if (cov.benefit === "hospitalDaily") fields.push(intField("maxDays", "入院の1回の限度日数", "日", 1095, defaultMaxDays(), "病気の想定の入院の日数がこれを超えた分は受け取りません"));
  const who = cov.insured !== undefined && cov.insured !== c.insured ? `・被保険者: ${memberLabel(wh, cov.insured)}` : "";
  return {
    key: kc,
    title: `保障 ${j + 1}（${cov.role === "main" ? "主契約" : "特約"}${who}）`,
    ...(cov.benefit === "other" ? { note: "「その他」の給付は計算に入りません。受け取る見込みは入るお金の行で入れてください" } : {}),
    level: "detail",
    fields,
    actions: [
      removeAction(`${kc}/remove`, "外す", "detail", (h) => {
        const x = contractIn(h);
        if (x?.coverages === undefined) return;
        if (isDecreasing(x, cov)) setDecreasing(h, x, cov, false);
        x.coverages = x.coverages.filter((y) => y.id !== cov.id);
        const o = x as unknown as Obj;
        for (const p of ["amount", "to", "from", "insured"]) putRowIn(o, "insurance.coverages", [cov.id, p], undefined);
        if (x.coverages.length === 0) delete x.coverages;
      }),
    ],
  };
}

/**
 * 保険契約1件の「▸ 続きを見る」の文（0078 の追記 2026-11-01）: 種類で開く欄が違うので、種類ごとに代表の欄を書く。
 * 損害保険は保障の明細が出ない（保険料だけを計算する）ので、契約の欄で書く
 */
export function insuranceMoreLabel(kind: string): string {
  switch (kind) {
    case "nonLife":
      return "契約者・契約年月などを入れる";
    case "medical":
      return "手術・入院の限度日数などを入れる";
    case "incomeProtection":
      return "最低保証の月数などを入れる";
    case "incapacity":
      return "免責の月数などを入れる";
    case "education":
    case "endowment":
      return "受取人・解約返戻率などを入れる";
    case "privateAnnuity":
      return "年金の年数・受取人などを入れる";
    case "wholeLife":
      return "解約返戻率・保障の明細などを入れる";
    case "lowSurrender":
      return "年齢ごとの返戻率・受取人などを入れる";
    case "account":
      return "更新・特約・受取人などを入れる";
    default:
      return "契約者・保障の明細などを入れる";
  }
}

/** 給付の額の意味（一時金・年額・月額・日額）。給付の種類を変えて意味が変わったら、額をそのまま使わない */
function amountBasisOf(benefit: string): "once" | "annual" | "monthly" | "daily" {
  if (benefit === "annuity") return "annual";
  if (benefit === "incomeProtection" || benefit === "incapacity") return "monthly";
  return benefit === "hospitalDaily" ? "daily" : "once";
}

/**
 * 保障の給付の種類を変えたときの始末（0164）。額の意味が変わったら額を0円にして未入力の印（死亡保険金500万円を年金の年額にしない）。
 * 年金にしたら、受け取りの始まりを被保険者の65歳・年数を10年にして推定の印（個人年金保険のひな形と同じ。契約の月から一生分を確定で入れない）。
 * 年金から戻したら、保障の始まりを契約の月に戻して推定の印を外す
 */
function refitBenefit(h: Household, x: InsuranceContract, t: Coverage, before: string, after: string): void {
  const o = x as unknown as Obj;
  if (amountBasisOf(before) !== amountBasisOf(after)) {
    t.amount = 0;
    putRowIn(o, "insurance.coverages", [t.id, "amount"], estRow("standard", UNENTERED_MAIN));
  }
  if (after === "annuity") {
    const d = defaultEnd(h, kindDef("privateAnnuity") as KindDef, t.insured ?? x.insured);
    t.from = d.tp ?? { at: x.contractDate };
    putRowIn(o, "insurance.coverages", [t.id, "from"], estRow("standard", d.basis));
    if (t.years === undefined) {
      t.years = 10;
      putRowIn(o, "insurance.coverages", [t.id, "years"], estRow("standard", `${STANDARD}（個人年金保険: 10年）`));
    }
  } else if (before === "annuity") {
    t.from = { at: x.contractDate };
    putRowIn(o, "insurance.coverages", [t.id, "from"], undefined);
  }
}

function amountLabel(benefit: string): string {
  switch (benefit) {
    case "incomeProtection":
      return "年金月額";
    case "incapacity":
      return "就業不能の月額";
    case "annuity":
      return "年金の年額";
    case "hospitalDaily":
      return "入院日額（1日）";
    case "surgery":
      return "手術（1回の額）";
    default:
      return "金額";
  }
}

/**
 * 新しい契約のボタン（0055 の追記 2026-11-02）: 「＋ 保険契約を足す」の1つにまとめ、押すと種類を分類の見出しごとに並べた一覧を開く
 * （よく使う物は一覧の上にも出す）。選ぶとその種類の既定で契約を足す。学資保険は子がいるときだけ、損害保険は「詳細」のときだけ出す。
 * キーは前のボタンのまま（定期保険 ins/add・医療保険 ins/addMedical・学資保険 ins/addEducation・損害保険 ins/addNonLife）、ほかは ins/add:種類
 */
export const ADD_CHOICE = { key: "ins/new", label: "＋ 保険契約を足す", help: "種類を選ぶと、その種類の既定の値で契約を1件足します（保険料と保障の額は入れてください）。法人の契約の保険は入れません" } as const;
const OLD_KEYS: Readonly<Record<string, string>> = { term: "ins/add", medical: "ins/addMedical", education: "ins/addEducation", nonLife: "ins/addNonLife" };
export const addKey = (kind: string): string => OLD_KEYS[kind] ?? `ins/add:${kind}`;
const groupLabel = new Map(KIND_GROUPS.map((g) => [g.group, g.label]));

export function insuranceStage(wh: WorkingHousehold): StageDef {
  const h = wh.request.input.household;
  const list = h.insuranceContracts ?? [];
  const hasChild = h.members.some((m) => m.kind === "child");
  const actions: ActionDef[] = KINDS.filter((k) => !k.child || hasChild).map((k) => ({
    key: addKey(k.kind),
    label: k.label,
    level: k.kind === "nonLife" ? "detail" : "simple",
    choice: { ...ADD_CHOICE, group: groupLabel.get(k.group) ?? "そのほか", ...(k.frequent === true ? { frequent: true } : {}) },
    run: (w: WorkingHousehold) =>
      mutate(w, (hh, req) => {
        const c = newContract(hh, req.input.baseMonth, k);
        if (c !== null) (hh.insuranceContracts ??= []).push(c);
      }),
  }));
  const section: SectionDef = {
    key: "ins/contracts",
    title: "保険契約",
    ...(list.length === 0 ? { note: "保険に入っていなければ、何も入れなくても計算できます（保障は無しで計算します）" } : {}),
    level: "simple",
    groups: list.flatMap((c, i) => contractGroups(wh, c, i)),
    actions,
  };
  return {
    id: "insurance",
    label: "保険",
    lead: "加入中の保険契約。種類・被保険者・保険料と払い方・主な保障の額・終わりで計算します（満期金・年金のある保険は、受け取りと払込の終わりの両方）。証券どおりの明細は「詳細」で入れます。",
    sections: [section],
  };
}
