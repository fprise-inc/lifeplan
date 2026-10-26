// 保険のカード（0055）: 契約ごとに簡易（目安で）と詳細（証券どおり）。
// - 簡易は1契約5欄: 種類（ひな形）・被保険者・保険料（払い方つき）・主な保障の額（種類で給付が変わる1欄）・終わり。ほかは推定（ひな形の標準の値）
// - 詳細: 名前・契約者・契約年月・受取人・受け取るお金の税（読むだけ）・満期金などの受取人・保険料控除の区分と新旧・払込の終わり・更新・
//   払込免除・解約の月と解約返戻金・保障の明細（被保険者・給付の種類・額・期間・推移の形・最低保証の月数・免責の月数・年数・限度日数）
// - 保険料と保障の額は目安を作らない（新しい契約でも未入力の警告。必要保障額に合わせるボタンは保障の見え方の区画）
// - 推定の値は物の値の状態の欄に行で持つ。推定のまま（出どころ auto）の値だけ、種類・被保険者・契約年月を直したときに入れ直す
// - 外貨建て・変額は円の目安の形だけ（計算エンジンの insurance.simple.estimate）
import type { Coverage, Household, InsuranceContract, Member } from "../../../engine/types.ts";
import { addMonths } from "../../levers.ts";
import type { Address } from "../../store/readings.ts";
import { byId, field, plain, removeAction, resolveTimepoint, timepointField, type ActionDef, type FieldDef, type Finder, type GroupDef, type SectionDef, type StageDef } from "../form.ts";
import { mutate, newId, type WorkingHousehold } from "../household.ts";
import {
  at,
  DEFAULT_MAX_DAYS,
  deathTaxText,
  defaultEnd,
  defaultPayUntil,
  estRow,
  isAuto,
  KIND_OPTIONS,
  kindDef,
  kindOf,
  mainCoverage,
  putRowIn,
  regimeOf,
  rowIn,
  STANDARD,
  SURGERY_RATIO,
  surgeryBasis,
  UNENTERED_MAIN,
  UNENTERED_PREMIUM,
  youngestChild,
  type KindDef,
} from "../insuranceKinds.ts";
import { BENEFITS, DEDUCTION_TYPES, memberLabel, memberOptions, PREMIUM_FREQUENCY } from "../labels.ts";
import { monthsBetween } from "../loanMath.ts";
import { formatYearMonth, formatYen } from "../units.ts";

type Obj = Record<string, unknown>;
const contracts = (h: Household) => h.insuranceContracts;
const withAddress = (f: FieldDef, a: (wh: WorkingHousehold) => Address | null): FieldDef => ({ ...f, address: a });
const man = (v: number) => `${formatYen(Math.round(v / 10000) * 10000, "man")}万円`;
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
  return m === undefined ? "家族" : (({ self: "本人", spouse: "配偶者", child: "子" }) as Record<string, string>)[m.kind] ?? "家族";
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
    const s: Coverage = { id: newId(), role: "rider", benefit: "surgery", amount: main.amount * SURGERY_RATIO, from: { at: c.contractDate }, to: null };
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
}

/** 契約者の推定（被保険者。被保険者が子なら本人） */
function setHolder(h: Household, c: InsuranceContract): void {
  const insured = h.members.find((m) => m.id === c.insured);
  const self = h.members.find((m) => m.kind === "self");
  const child = insured?.kind === "child";
  c.policyholder = child && self !== undefined ? self.id : c.insured;
  putRowIn(c as unknown as Obj, "insurance.policyholder", [], estRow("standard", child ? "被保険者が子なので本人（推定）" : `被保険者（${memberWord(h, c.insured)}）と同じ（推定）`));
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
  putRowIn(o, "insurance.insured", [], estRow("standard", "本人（推定）"));
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

/** 払込の終わり（時点の部品。空欄は終身払い） */
function payUntilField(find: Finder, k: string, id: string, level: "simple" | "detail", label: string): FieldDef {
  return withAddress(
    timepointField({
      key: `${k}/payUntil`,
      item: "insurance.premium",
      label,
      level,
      find: (h, w) => (find(h, w) as InsuranceContract | undefined)?.premium as unknown as Obj | undefined,
      path: ["payUntil"],
      optional: true,
      nullText: "終身払い（一時払いは不要）",
      ageOf: (h) => h.members.find((m) => m.id === (h.insuranceContracts ?? []).find((x) => x.id === id)?.insured),
    }),
    () => at(id, "insurance.premium", ["payUntil"]),
  );
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
  // 種類（ひな形）
  fields.push(
    withAddress(
      field({
        key: `${k}/template`,
        item: "insurance.template",
        label: "種類",
        level: "simple",
        kind: "select",
        options: KIND_OPTIONS,
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
    ),
  );
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
  // 保険料（1回の額）と払い方
  fields.push(
    withAddress(
      plain({
        key: `${k}/premium`,
        item: "insurance.premium",
        label: "保険料（1回の額）",
        level: "simple",
        kind: "yen",
        basis: "once",
        find,
        path: ["premium", "amount"],
        unit: "yen",
        // 空にしたら0円の未入力に戻す（保険料の額は省けない）
        after: (_h, target, v) => {
          if (v !== null) return;
          (target as unknown as InsuranceContract).premium.amount = 0;
          putRowIn(target, "insurance.premium", ["amount"], estRow("standard", UNENTERED_PREMIUM));
        },
      }),
      () => at(c.id, "insurance.premium", ["amount"]),
    ),
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
  );
  // 主な保障の額（種類で給付が変わる1欄）と終わり
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
                if (s.benefit !== "surgery" || !isAuto(rowIn(o, "insurance.coverages", [s.id, "amount"]), STANDARD) || s.amount !== before * SURGERY_RATIO) continue;
                s.amount = m.amount * SURGERY_RATIO;
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
            label: ep === "from" ? "受け取りの始まり" : "終わり（保障の終わり）",
            level: "simple",
            find: findMain,
            path: [ep],
            ageOf: insuredOf,
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
    fields.push(payUntilField(find, k, c.id, "simple", "保険期間の終わり"));
  }

  // ---- 詳細 ----
  fields.push(
    withAddress(plain({ key: `${k}/label`, item: "insurance.label", label: "契約の表示名（保険会社・商品名など）", level: "detail", kind: "text", find, path: ["label"], optional: true, help: "表示だけに使います（持ち帰り用のレポート・AI に渡す範囲には入れません）" }), () => at(c.id, "insurance.label")),
    withAddress(plain({ key: `${k}/holder`, item: "insurance.policyholder", label: "契約者（保険料を払う人）", level: "detail", kind: "select", options: memberOptions(wh), find, path: ["policyholder"] }), () => at(c.id, "insurance.policyholder")),
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
    beneficiaryField(wh, c, find, k),
    taxField(c, k),
  );
  if ((c.coverages ?? []).some((x) => x.benefit === "maturity" || x.benefit === "annuity" || x.benefit === "survival"))
    fields.push(plain({ key: `${k}/annuitant`, item: "insurance.annuitant", label: "満期金・年金・祝金の受取人", level: "detail", kind: "select", options: memberOptions(wh, inHousehold), find, path: ["annuitant"], optional: true, fallback: c.policyholder, help: "空欄は契約者（契約者が受け取れば一時所得・雑所得、ほかの人なら贈与税）" }));
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
  if (kind.main !== null) fields.push(payUntilField(find, k, c.id, "detail", "払込の終わり"));
  fields.push(
    plain({ key: `${k}/waiver`, item: "insurance.waiver", label: "払込免除（被保険者の障害・就業不能で払込が止まる）", level: "detail", kind: "bool", find, path: ["waiver"], optional: true, fallback: false }),
    timepointField({ key: `${k}/surrender`, item: "insurance.surrender", label: "解約の月", level: "detail", find, path: ["surrender"], optional: true, absentWhenEmpty: true, nullText: "解約しない", ageOf: insuredOf, help: "その月に解約返戻金を受け取り、保障と払込が終わります" }),
  );
  // 解約返戻金（貯蓄型は返戻率、解約の月がある契約・円の目安の形は解約の月の額）
  if (SAVINGS_TEMPLATES.has(c.template)) fields.push(returnRateField(c, find, k));
  if (c.surrender !== undefined || (FUND_TEMPLATES.has(c.template) && c.simple?.estimate === true)) fields.push(surrenderAmountField(c, find, k));

  const tags = detailTags(wh, c);
  const notes = [kind.note, tags.length > 0 ? `詳細に入っている値: ${tags.join("・")}` : undefined].filter((x): x is string => x !== undefined);
  const actions: ActionDef[] = [removeAction(`${k}/remove`, "この契約を外す", "simple", (h) => void (h.insuranceContracts = (h.insuranceContracts ?? []).filter((x) => x.id !== c.id)))];
  if (FUND_TEMPLATES.has(c.template) && c.simple?.estimate !== true && (c.simple?.assetClass !== undefined || c.simple?.loadRate !== undefined))
    actions.push({
      key: `${k}/toEstimate`,
      label: "円の目安の形に直す",
      level: "simple",
      title: "積立金を前提の利回りで伸ばさず、入れた円の目安の額だけで計算します（資産クラス・積立に回らない割合の値は残します）",
      run: (w) => mutateC(w, (_h, x) => void (x.simple = { ...(x.simple ?? {}), estimate: true })),
    });
  const groups: GroupDef[] = [
    {
      key: k,
      title: `${c.label !== undefined && c.label !== "" ? c.label : kind.label} ${i + 1}（被保険者: ${memberLabel(wh, c.insured)}）`,
      ...(notes.length > 0 ? { note: notes.join("。") } : {}),
      level: "simple",
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
        timepointField({ key: `${kr}/at`, item: "insurance.renewals", label: "更新の月", level: "detail", find: findR, path: ["at"], ageOf: insuredOf }),
        plain({ key: `${kr}/premium`, item: "insurance.renewals", label: "更新後の保険料（1回の額）", level: "detail", kind: "yen", basis: "once", find: findR, path: ["premium"] }),
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

  // 保障の明細（詳細）
  (c.coverages ?? []).forEach((cov, j) => groups.push(coverageGroup(wh, c, cov, j, find)));
  groups.push({
    key: `${k}/addCov`,
    level: "detail",
    fields: [],
    actions: [
      {
        key: `${k}/addCoverage`,
        label: "＋ 保障（主契約・特約）",
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
        label: "＋ 更新（更新後の保険料）",
        level: "detail",
        run: (w) =>
          mutateC(w, (h, x) => {
            const last = (x.renewals ?? []).at(-1);
            const from = last !== undefined ? resolveTimepoint(h, last.at) : x.contractDate;
            (x.renewals ??= []).push({ id: newId(), at: { at: addMonths(from ?? x.contractDate, 120) }, premium: last?.premium ?? x.premium.amount });
          }),
      },
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
    options: [{ value: "", label: "省略（配偶者、いなければ子）" }, ...memberOptions(wh, inHousehold), ...EXTERNAL],
    optional: true,
    ...(multi ? { readOnly: "受取人が複数（割合つき）の契約です。証券どおりの割合のまま計算します" } : {}),
    help: "相続税の死亡保険金の非課税枠と税の区分に効きます",
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

/** 返戻率（貯蓄型。空は未入力の警告: 解約返戻金を0円で数えている） */
function returnRateField(c: InsuranceContract, find: Finder, k: string): FieldDef {
  return withAddress(
    field({
      key: `${k}/sv/rate`,
      item: "insurance.simple",
      label: "解約返戻率（払込の終わりの時点）",
      level: "detail",
      kind: "pct",
      optional: true,
      help: "払った保険料の累計に対する割合（設計書・お知らせの値）。資産と負債の推移の「保険の解約返戻金」と元本割れの表示に使います",
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
    help: c.surrender === undefined ? "先に解約の月を入れてください（その保険年度の解約返戻金として数えます）" : "お知らせ・設計書の解約返戻金。外貨建て・変額は円の目安（為替・運用で変わります）",
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
  const fields: FieldDef[] = [
    withAddress(
      field({
        key: `${kc}/insured`,
        item: "insurance.coverages",
        label: "被保険者（この保障の）",
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
      after: (h, target, v) => {
        const x = contractIn(h);
        const t = target as unknown as Coverage;
        // 給付の種類に合わない欄（限度日数・最低保証の月数など）は計算が読まないので残す（戻したときに消えない）
        if (x !== undefined && v !== "death" && (x.schedule?.rows ?? []).some((r) => r.coverage === t.id && r.deathBenefit !== undefined)) setDecreasing(h, x, t, false);
      },
    }),
    withAddress(
      plain({
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
      () => at(c.id, "insurance.coverages", [cov.id, "amount"]),
    ),
    timepointField({ key: `${kc}/from`, item: "insurance.coverages", label: cov.benefit === "annuity" ? "受け取りの始まり" : "保障の始まり", level: "detail", find: findCov, path: ["from"], ageOf: covInsured, mode: "ym" }),
    withAddress(
      timepointField({ key: `${kc}/to`, item: "insurance.coverages", label: "保障の終わり", level: "detail", find: findCov, path: ["to"], startPath: ["from"], ageOf: covInsured, optional: true, nullText: "終身", after: (h, target) => followDecreasing(h, target) }),
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
          { value: "decreasing", label: "毎年同じ額ずつ減る（逓減。終わりに0円）" },
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
  if (cov.benefit === "incapacity") fields.push(intField("waitingMonths", "免責の月数（給付が始まるまで）", "か月", 120, 0, "働けなくなった月の翌月から、この月数の後に給付が始まります"));
  if (cov.benefit === "annuity") fields.push(intField("years", "年金の年数", "年", 100, undefined, "空欄は保障の終わりまで"));
  if (cov.benefit === "survival") fields.push(intField("everyYears", "祝金の間隔", "年", 50, undefined, "保障の始まりから、この年ごとに受け取ります"));
  if (cov.benefit === "hospitalDaily") fields.push(intField("maxDays", "入院の1回の限度日数", "日", 1095, DEFAULT_MAX_DAYS, "病気の想定の入院の日数がこれを超えた分は受け取りません"));
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

/** 新しい契約のボタン */
const ADD_BUTTONS: readonly { key: string; label: string; kind: string; level: "simple" | "detail" }[] = [
  { key: "ins/add", label: "＋ 保険契約（定期保険）", kind: "term", level: "simple" },
  { key: "ins/addMedical", label: "＋ 医療保険", kind: "medical", level: "simple" },
  { key: "ins/addEducation", label: "＋ 学資保険", kind: "education", level: "simple" },
  { key: "ins/addNonLife", label: "＋ 損害保険（火災・自動車など）", kind: "nonLife", level: "detail" },
];

export function insuranceStage(wh: WorkingHousehold): StageDef {
  const h = wh.request.input.household;
  const list = h.insuranceContracts ?? [];
  const actions: ActionDef[] = ADD_BUTTONS.filter((b) => b.kind !== "education" || h.members.some((m) => m.kind === "child")).map((b) => ({
    key: b.key,
    label: b.label,
    level: b.level,
    run: (w: WorkingHousehold) =>
      mutate(w, (hh, req) => {
        const kind = kindDef(b.kind);
        if (kind === undefined) return;
        const c = newContract(hh, req.input.baseMonth, kind);
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
    lead: "加入中の保険契約。種類・被保険者・保険料・主な保障の額・終わりの5つで計算します。証券どおりの明細は「詳細」で入れます。",
    sections: [section],
  };
}

/** 主な保障の額を必要保障額に合わせる（保障の見え方の区画のボタン。推定の行に根拠を書く。1万円単位） */
export function fitToNeed(wh: WorkingHousehold, contractId: string, amount: number, year: number): WorkingHousehold {
  return mutate(wh, (h) => {
    const x = (h.insuranceContracts ?? []).find((y) => y.id === contractId);
    if (x === undefined) return;
    const kd = kindOf(x);
    const m = mainCoverage(x, kd);
    if (m === undefined || m.benefit !== "death") return;
    m.amount = Math.max(0, Math.ceil(amount / 10000) * 10000);
    if (isDecreasing(x, m)) setDecreasing(h, x, m, true);
    if (kd.kind === "endowment") syncMaturity(x, m);
    putRowIn(x as unknown as Obj, "insurance.coverages", [m.id, "amount"], estRow("derived", `必要保障額に合わせた（${year}年の不足 ${man(m.amount)}）`));
  });
}
