// 3. 退職金・企業年金（0057）: 辞めるときとその後にもらう勤め先・制度の給付（退職一時金・確定給付企業年金・公務員の退職手当と年金払い退職給付・
// 国民年金基金・役員退職慰労金）を、人ごとに何件でも。退職給付1件ごとに入れ方（目安で／額で）を選び、種類ごとに要る欄だけを出す。
// - iDeCo・企業型DC・小規模企業共済の受け取りは口座の物の一部なので貯蓄・運用のカードで入れ、ここには読むだけで並べる。受け取りの順番と
//   間隔（退職所得控除の重なり）は、カードの下の「受け取りの並び」（retirementLineup.ts）で一緒に見る
// - 辞め方・勤続（働き方の期間）は働き方と収入のカードの物。ここは読むだけ（目安の元）
// - 区分「規程で」（会社の退職金規程の計算部品）は、計算部品の差し込み口を開く回に出す（今は出さない）
import type { Account, Household, Member, RetirementBenefit, Timepoint } from "../../../engine/types.ts";
import { addMonths, ageReachedMonth } from "../../levers.ts";
import type { Address } from "../../store/readings.ts";
import { byId, field, getPath, plain, resolveTimepoint, timepointField, yenBox, type ActionDef, type FieldDef, type Finder, type GroupDef, type SectionDef, type StageDef } from "../form.ts";
import { estimatedBox, mutate, newId, periodsOf, type WorkingHousehold } from "../household.ts";
import { clearRetirementNone, fillRetirement, retirementNone, retirementNotApplicable } from "../fill.ts";
import { ACCOUNT_KINDS, EMPLOYMENT_TYPES, earners, memberLabel } from "../labels.ts";
import { readGroup, readLine } from "../readLines.ts";
import { regulationValue } from "../../../../../hearing/src/statistics.ts";
import {
  addKindOf,
  ANNUITY_ONLY,
  BENEFIT_KINDS,
  benefitAt,
  civilEstimate,
  civilPensionFixedHalf,
  CIVIL_PENSION_FIXED,
  COMPUTED,
  convertBenefit,
  DB_YEARS_BASIS,
  EDUCATION_OPTIONS,
  estRow,
  finalMonthlyAt,
  HAS_AMOUNT,
  initialBenefit,
  isEstimateBox,
  isUnenteredBox,
  KIND_SHORT,
  LUMP_ONLY,
  LUMP_SHARE_BASIS,
  lumpEstimate,
  lumpShareAt,
  multiplierAt,
  periodOf,
  reasonAt,
  UNENTERED_AMOUNT,
  yearsAt,
  type BenefitKind,
} from "../retirementBenefits.ts";
import { putRow } from "../rows.ts";
import { formatYearMonth } from "../units.ts";
import { defaultPayoutAge, payoutAgeOf } from "../savings/model.ts";
import { currentPeriod } from "./work.ts";

type Obj = Record<string, unknown>;

/** 受け取りを読むだけで並べる口座の種類 */
export const DC_RECEIPT_KINDS: ReadonlySet<string> = new Set(["ideco", "corporateDc", "smallBusinessMutualAid"]);

const METHOD_TEXT: Readonly<Record<string, string>> = { lumpSum: "一時金", annuity: "年金", mixed: "一時金と年金の併用" };

const benefits = (h: Household) => h.retirementBenefits;
const withAddress = (f: FieldDef, a: Address): FieldDef => ({ ...f, address: () => a });
const man = (v: number): string => `${Math.round(v / 10000).toLocaleString("ja-JP")}万円`;

/** 退職金・企業年金のカードに出す人（本人・配偶者・働き方の期間のある人と、退職給付のある人） */
function people(h: Household): Member[] {
  const list = earners(h);
  for (const b of h.retirementBenefits ?? []) {
    const m = h.members.find((x) => x.id === b.member);
    if (m !== undefined && !list.includes(m)) list.push(m);
  }
  return list;
}

/** iDeCo・企業型DCの受け取りの読むだけの文（例: 一時金・65歳から） */
function receiptText(wh: WorkingHousehold, a: Account): string {
  if (a.kind === "smallBusinessMutualAid") return "受け取りは貯蓄・運用の項目の口座で";
  const h = wh.request.input.household;
  const age = payoutAgeOf(h, a);
  const method = a.payout === undefined ? "一時金（推定）" : (METHOD_TEXT[a.payout.method] ?? a.payout.method);
  return `${method}・${age ?? `${defaultPayoutAge(wh.request, a)}歳（推定）`}${age !== null ? "歳" : ""}から`;
}

/** 退職給付を書き換える（見つからなければ何もしない） */
function editBenefit(wh: WorkingHousehold, id: string, fn: (b: RetirementBenefit, h: Household) => void): WorkingHousehold {
  return mutate(wh, (h) => {
    const b = (h.retirementBenefits ?? []).find((x) => x.id === id);
    if (b !== undefined) fn(b, h);
  });
}

/** 物の値の状態の行を、物そのものに書く（欄の after から） */
const putOwnRow = (target: Obj, a: Address, basis: string) => void putRow({ household: { retirementBenefits: [target] } }, a, estRow("standard", basis));

// ---- 入れ方（目安で／額で）----

/** 目安を作れる退職給付か（会社員の退職一時金は統計、公務員・役員は見込みの計算） */
function hasEstimate(h: Household, b: RetirementBenefit): boolean {
  if (b.kind === "lumpSum") return lumpEstimate(h, b) !== null;
  if (b.kind === "civilServantAllowance") return civilEstimate(h, b) !== null || b.estimate?.finalMonthly !== undefined;
  return b.kind === "officerAllowance";
}

const MODE_OPTIONS = [
  { value: "estimate", label: "目安で" },
  { value: "amount", label: "額で" },
];

function modeOf(b: RetirementBenefit): "estimate" | "amount" {
  if (COMPUTED.has(b.kind)) return b.amount === undefined ? "estimate" : "amount";
  return isEstimateBox(b.amount) && (b.amount as { estimate?: { method?: string } }).estimate?.method === "statistic" ? "estimate" : "amount";
}

function modeField(b: RetirementBenefit, prefix: string): FieldDef {
  return field({
    key: `${prefix}/mode`,
    item: null,
    label: "入れ方",
    level: "simple",
    kind: "select",
    options: MODE_OPTIONS,
    // 物の形が変わる選択（額⇄目安。往復は別のテストで確かめる）
    structural: true,
    help: "切り替えても、入れた値は消えません",
    get: (w) => {
      const x = (w.request.input.household.retirementBenefits ?? []).find((y) => y.id === b.id);
      return { value: x === undefined ? null : modeOf(x) };
    },
    set: (w, v) =>
      editBenefit(w, b.id, (x, h) => {
        const m = h.members.find((y) => y.id === x.member);
        if (m === undefined) return;
        if (v === "estimate") {
          const prev = x.amount !== undefined && x.amount.state === "confirmed" && typeof x.amount.value === "number" ? x.amount.value : null;
          if (x.kind === "lumpSum") {
            const e = lumpEstimate(h, x);
            if (e === null) return;
            x.amount = estimatedBox(e.value, prev === null ? e.basis : `${e.basis}。前に入れていた額は ${man(prev)}`);
            return;
          }
          delete x.amount;
          if (x.estimate?.finalMonthly === undefined) {
            const fresh = initialBenefit(h, m, x.kind as BenefitKind, { id: x.id, ...(x.employment !== undefined ? { employment: x.employment } : {}) });
            x.estimate = { ...(fresh.estimate ?? {}), ...(x.estimate ?? {}) };
            x.valueStates = { ...((fresh.valueStates as Obj | undefined) ?? {}), ...((x.valueStates as Obj | undefined) ?? {}) };
          }
        } else if (v === "amount") {
          // 額で: 目安の額を初めの値として欄に置く（推定のまま。確定は「この値にする」か、額を打ったとき）。見込みの計算の種類は、額を入れるまで未入力
          if (x.kind === "lumpSum" && x.amount !== undefined && isEstimateBox(x.amount)) x.amount = { ...x.amount, estimate: { method: "standard", basis: `目安の額を初めの値にした（${(x.amount as unknown as { estimate: { basis: string } }).estimate.basis}）` } } as RetirementBenefit["amount"];
          else if (x.amount === undefined) x.amount = estimatedBox(0, `${UNENTERED_AMOUNT}。会社の見込み額・規程の早見表の額を入れてください`);
        }
      }),
  });
}

// ---- 欄 ----

const ESTIMATE_FOR_WARN = new Set(["regular", "contract", "civilServant", "executive"]);

function amountField(wh: WorkingHousehold, b: RetirementBenefit, prefix: string, find: Finder): FieldDef {
  const h = wh.request.input.household;
  const label = "見込み額（一時金）";
  const lumpEst = b.kind === "lumpSum" && lumpEstimate(h, b) !== null;
  const p = periodOf(h, b);
  const f = yenBox({
    key: `${prefix}/amount`,
    item: "retirementBenefit.amount",
    label,
    level: "simple",
    basis: "once",
    find,
    path: ["amount"],
    optional: true,
    ...(lumpEst ? { estimate: (hh: Household) => lumpEstimate(hh, (hh.retirementBenefits ?? []).find((x) => x.id === b.id) ?? b) } : {}),
    help:
      b.kind === "civilServantAllowance"
        ? "空欄のときは見込みの計算（退職時の俸給月額×勤続年数と退職の理由の支給率。調整額は含みません）を使います"
        : b.kind === "officerAllowance"
          ? "空欄のときは見込みの計算（最終報酬月額×役員の在任年数×功績倍率）を使います"
          : "定年の時点の額か、今辞めた場合の額かを確かめて写してください。0円は「該当なし」か0円と入れたときだけです",
    hint: (w) => {
      const x = (w.request.input.household.retirementBenefits ?? []).find((y) => y.id === b.id);
      if (x === undefined || x.amount !== undefined || !COMPUTED.has(x.kind)) return null;
      return "見込みの計算で計算中（額は受け取りの並びに出ます）";
    },
  });
  // 勤め先がパートなどに変わったのに、FP が入れた退職一時金が残っている（前の勤め先の退職金として残す。文書の3-5）
  const kept = b.kind === "lumpSum" && p !== undefined && !ESTIMATE_FOR_WARN.has(p.type) && b.amount !== undefined && !isEstimateBox(b.amount) && !isUnenteredBox(b.amount);
  const warn = kept ? `勤め先の働き方が「${EMPLOYMENT_TYPES.find((o) => o.value === p.type)?.label ?? p.type}」になっています。前の勤め先の退職金として残しています` : null;
  return withAddress(warn === null ? f : { ...f, get: (w) => ({ ...f.get(w), warn }) }, benefitAt(b.id, "retirementBenefit.amount"));
}

/** 年金の年数（null は終身） */
function yearsField(b: RetirementBenefit, prefix: string, find: Finder): FieldDef {
  const options = [{ value: "life", label: "終身" }, ...[5, 10, 15, 20, 25, 30].map((n) => ({ value: String(n), label: `${n}年` }))];
  return withAddress(
    field({
      key: `${prefix}/years`,
      item: "retirementBenefit.receipt",
      label: "年金の年数",
      level: "detail",
      kind: "select",
      options,
      get: (w) => {
        const y = getPath(find(w.request.input.household, w), ["receipt", "years"]) as number | null | undefined;
        return { value: y === undefined ? null : y === null ? "life" : String(y) };
      },
      set: (w, v) =>
        mutate(w, (h) => {
          const x = find(h, w) as RetirementBenefit | undefined;
          if (x === undefined || v === null) return;
          x.receipt = { ...(x.receipt ?? {}), years: v === "life" ? null : Number(v) };
        }),
    }),
    yearsAt(b.id),
  );
}

/** 期間（勤続期間・役員の在任期間）の始まり・終わりの欄。片方を入れると、もう片方は勤め先の期間から埋める。空にすると期間ごと外す */
function spanFields(wh: WorkingHousehold, m: Member, b: RetirementBenefit, prefix: string, find: Finder, key: "service" | "officerService", label: string): FieldDef[] {
  const item = key === "service" ? "retirementBenefit.service" : "retirementBenefit.officerService";
  const complete = (h: Household, target: Obj, v: unknown) => {
    const x = target as RetirementBenefit;
    if (v === null) {
      delete x[key];
      return;
    }
    const span = x[key] as { from?: Timepoint; to?: Timepoint } | undefined;
    if (span === undefined) return;
    const p = periodOf(h, x);
    const fill = (tp: Timepoint | null | undefined): Timepoint | null => {
      const ym = resolveTimepoint(h, tp);
      return ym === null ? null : { at: ym };
    };
    const from = span.from ?? fill(p?.from) ?? { at: wh.request.input.baseMonth };
    const to = span.to ?? fill(p?.to ?? null) ?? { at: addMonths(ageReachedMonth(m, 60), -1) };
    x[key] = { from, to };
  };
  const ageOf = (h: Household) => h.members.find((x) => x.id === m.id);
  const one = (end: "from" | "to") =>
    withAddress(
      timepointField({ key: `${prefix}/${key}/${end}`, item, label: `${label}の${end === "from" ? "始まり" : "終わり"}`, level: "detail", find, path: [key, end], ageOf, mode: "ym", optional: true, absentWhenEmpty: true, nullText: `勤め先の期間の${end === "from" ? "始まり" : "終わり"}`, after: complete }),
      benefitAt(b.id, item, [end]),
    );
  return [one("from"), one("to")];
}

/** 退職給付1件の欄（種類ごとに要る欄だけ。文書の3-3 の表） */
function benefitFields(wh: WorkingHousehold, m: Member, b: RetirementBenefit, prefix: string): FieldDef[] {
  const h = wh.request.input.household;
  const find = byId(benefits, b.id);
  const fields: FieldDef[] = [];
  const kind = b.kind;
  const method = ANNUITY_ONLY.has(kind) ? "annuity" : LUMP_ONLY.has(kind) ? "lumpSum" : (b.receipt?.method ?? "lumpSum");
  const ageOf = (hh: Household) => hh.members.find((x) => x.id === m.id);
  // 種類（簡易。変えると種類ごとの初めの値にし、同じ意味の欄は引き継ぐ）
  fields.push(
    withAddress(
      field({
        key: `${prefix}/kind`,
        item: "retirementBenefit.kind",
        label: "種類",
        level: "simple",
        kind: "select",
        options: BENEFIT_KINDS.map((o) => ({ value: o.value, label: o.label })),
        structural: true,
        get: (w) => ({ value: ((find(w.request.input.household, w) as RetirementBenefit | undefined)?.kind as string | undefined) ?? null }),
        set: (w, v) =>
          mutate(w, (hh) => {
            const list = hh.retirementBenefits ?? [];
            const i = list.findIndex((x) => x.id === b.id);
            if (i < 0 || v === null) return;
            const next = convertBenefit(hh, list[i] as RetirementBenefit, String(v) as BenefitKind);
            list[i] = next;
            // 年金払い退職給付は終身の半分と有期の半分の2件で持つ（有期の半分が無ければ足す）
            if (next.kind === "civilServantPension" && !list.some((x) => x.member === next.member && x.kind === "civilServantPension" && x.label === CIVIL_PENSION_FIXED)) list.splice(i + 1, 0, civilPensionFixedHalf(m, newId(), next.employment));
          }),
      }),
      benefitAt(b.id, "retirementBenefit.kind"),
    ),
  );
  if (hasEstimate(h, b)) fields.push(modeField(b, prefix));
  if (HAS_AMOUNT.has(kind)) fields.push(amountField(wh, b, prefix, find));
  // 見込みの計算の欄（公務員の俸給月額と理由・役員の最終報酬月額と功績倍率）。目安で のときは簡易に出す
  if (COMPUTED.has(kind)) {
    fields.push(
      withAddress(
        plain({
          key: `${prefix}/finalMonthly`,
          item: "retirementBenefit.estimate",
          label: kind === "civilServantAllowance" ? "退職時の俸給月額" : "最終報酬月額",
          level: b.amount === undefined ? "simple" : "detail",
          kind: "yen",
          basis: "monthly",
          find,
          path: ["estimate", "finalMonthly"],
          help: kind === "civilServantAllowance" ? "給与明細の俸給（地域手当などの手当を除く）。推定は年齢の平均の給与月額の目安です" : "役員報酬の月額。推定は役員の期間の年収÷12です",
        }),
        finalMonthlyAt(b.id),
      ),
    );
    if (kind === "civilServantAllowance")
      fields.push(
        withAddress(
          plain({ key: `${prefix}/reason`, item: "retirementBenefit.estimate", label: "退職の理由", level: "detail", kind: "select", options: [{ value: "retirementAge", label: "定年・勧奨など" }, { value: "voluntary", label: "自己都合" }], find, path: ["estimate", "reason"], fallback: "retirementAge" }),
          reasonAt(b.id),
        ),
      );
    else fields.push(withAddress(plain({ key: `${prefix}/multiplier`, item: "retirementBenefit.estimate", label: "功績倍率", level: "detail", kind: "decimal", suffix: "倍", find, path: ["estimate", "multiplier"], help: "役員の地位でおよそ1.0〜3.0" }), multiplierAt(b.id)));
  }
  // 受け取る時期（詳細。空欄は勤め先を辞めた翌月。辞める月と違う人は少なく、ずれても運用益と税の差だけ。0078）
  const endYm = resolveTimepoint(h, b.service?.to ?? periodOf(h, b)?.to ?? null);
  fields.push(
    withAddress(
      timepointField({
        key: `${prefix}/paidAt`,
        item: "retirementBenefit.paidAt",
        label: ANNUITY_ONLY.has(kind) ? "支給の月" : "受け取る時期",
        level: "detail",
        find,
        path: ["paidAt"],
        ageOf,
        mode: "ym",
        optional: true,
        absentWhenEmpty: true,
        nullText: endYm !== null ? `勤め先を辞めた翌月（${formatYearMonth(addMonths(endYm, 1))}）` : "勤め先を辞めた翌月",
      }),
      benefitAt(b.id, "retirementBenefit.paidAt"),
    ),
  );
  // 受け取り方（DB だけ選ぶ）
  if (kind === "db") {
    fields.push(
      withAddress(
        plain({
          key: `${prefix}/method`,
          item: "retirementBenefit.receipt",
          label: "受け取り方",
          level: "simple",
          kind: "select",
          options: [
            { value: "lumpSum", label: "一時金" },
            { value: "annuity", label: "年金" },
            { value: "mixed", label: "一時金と年金の併用" },
          ],
          find,
          path: ["receipt", "method"],
          fallback: "lumpSum",
          after: (_h, target, v) => {
            const x = target as RetirementBenefit;
            if (v !== "annuity" && v !== "mixed") return;
            if (x.receipt?.years === undefined) {
              x.receipt = { ...(x.receipt ?? {}), years: 10 };
              putOwnRow(target, yearsAt(x.id), DB_YEARS_BASIS);
            }
            if (v === "mixed" && x.receipt.lumpShare === undefined) {
              x.receipt = { ...x.receipt, lumpShare: "0.5" };
              putOwnRow(target, lumpShareAt(x.id), LUMP_SHARE_BASIS);
            }
          },
        }),
        benefitAt(b.id, "retirementBenefit.receipt", ["method"]),
      ),
    );
    if (method === "mixed") fields.push(withAddress(plain({ key: `${prefix}/lumpShare`, item: "retirementBenefit.receipt", label: "一時金で受け取る割合", level: "simple", kind: "pct", find, path: ["receipt", "lumpShare"] }), lumpShareAt(b.id)));
  }
  // 年金の年額（年金で受けるとき。国民年金基金・年金払い退職給付は必ず。目安が無いので、入れるまでは未入力の警告）
  if (method !== "lumpSum") {
    const required = ANNUITY_ONLY.has(kind);
    fields.push(
      withAddress(
        plain({
          key: `${prefix}/annual`,
          item: "retirementBenefit.receipt",
          label: "年金の年額",
          level: "simple",
          kind: "yen",
          basis: "annual",
          find,
          path: ["receipt", "annualAmount"],
          ...(required ? {} : { optional: true }),
          help:
            kind === "nationalPensionFund"
              ? "加入員証・年金見込額のお知らせの年金額（1口目と2口目以降を合わせた年額）。入れるまでは0円で計算します"
              : kind === "civilServantPension"
                ? "共済組合の年金払い退職給付の見込額（終身の分と有期の分を、それぞれの行に）。旧職域加算は年金の項目の定期便の額に含めます。入れるまでは0円で計算します"
                : "年金見込額のお知らせの「年金で受けた場合の年額」。空欄のときは、一時金の額を年数と予定利率で年金に直した額です",
          hint: (v, w) => (v === null && !required ? annuityHint((w.request.input.household.retirementBenefits ?? []).find((x) => x.id === b.id) ?? b) : null),
        }),
        benefitAt(b.id, "retirementBenefit.receipt", ["annualAmount"]),
      ),
    );
    if (kind !== "nationalPensionFund") fields.push(yearsField(b, prefix, find));
    if (b.receipt?.years === null || b.receipt?.years === undefined)
      fields.push(
        withAddress(
          plain({ key: `${prefix}/guarantee`, item: "retirementBenefit.receipt", label: "保証期間", level: "detail", kind: "int", suffix: "年", min: 0, max: 40, find, path: ["receipt", "guaranteeYears"], optional: true, help: "空欄は保証なし。保証期間の残りは、万一のとき遺族に一時金で渡ります" }),
          benefitAt(b.id, "retirementBenefit.receipt", ["guaranteeYears"]),
        ),
      );
    fields.push(
      withAddress(
        timepointField({ key: `${prefix}/start`, item: "retirementBenefit.receipt", label: "年金の始まり", level: "detail", find, path: ["receipt", "start"], ageOf, optional: true, absentWhenEmpty: true, nullText: "支給の月から" }),
        benefitAt(b.id, "retirementBenefit.receipt", ["start"]),
      ),
    );
    fields.push(
      withAddress(
        field({
          key: `${prefix}/perYear`,
          item: "retirementBenefit.receipt",
          label: "1年の支払いの回数",
          level: "detail",
          kind: "select",
          options: [1, 2, 4, 6, 12].map((n) => ({ value: String(n), label: `年${n}回` })),
          get: (w) => {
            const v = getPath(find(w.request.input.household, w), ["receipt", "perYear"]) as number | undefined;
            return v === undefined ? { value: "6", implicit: true } : { value: String(v) };
          },
          set: (w, v) =>
            mutate(w, (hh) => {
              const x = find(hh, w) as RetirementBenefit | undefined;
              if (x === undefined) return;
              const { perYear: _drop, ...rest } = x.receipt ?? {};
              x.receipt = v === null || v === "6" ? rest : { ...rest, perYear: Number(v) as 1 | 2 | 4 | 6 | 12 };
            }),
        }),
        benefitAt(b.id, "retirementBenefit.receipt", ["perYear"]),
      ),
    );
    if (kind === "db") fields.push(withAddress(plain({ key: `${prefix}/rate`, item: "retirementBenefit.receipt", label: "予定利率", help: "一時金から年金に直すときの率です", level: "detail", kind: "pct", find, path: ["receipt", "conversionRate"], optional: true }), benefitAt(b.id, "retirementBenefit.receipt", ["conversionRate"])));
  }
  // 国民年金基金の本人の掛金（社会保険料控除）
  if (kind === "nationalPensionFund") {
    const base = wh.request.input.baseMonth;
    const start = resolveTimepoint(h, b.receipt?.start ?? null);
    const unpaid = b.contributions === undefined && (start === null || start > base);
    fields.push(
      withAddress(
        plain({
          key: `${prefix}/contrib`,
          item: "retirementBenefit.contributions",
          label: "本人の掛金（月額）",
          level: "simple",
          kind: "yen",
          basis: "monthly",
          find,
          path: ["contributions", "monthly"],
          optional: true,
          help: "社会保険料控除になります。払い終えたら空欄",
          hint: () => (unpaid ? "掛金を入れていないので、社会保険料控除を計算していません" : null),
          after: (_h, target, v) => {
            const x = target as RetirementBenefit;
            if (v === null) {
              delete x.contributions;
              return;
            }
            if (x.contributions !== undefined && (x.contributions as { from?: Timepoint }).from === undefined) {
              const end = addMonths(ageReachedMonth(m, 60), -1);
              x.contributions = { monthly: Number(v), from: { at: base }, to: { at: end < base ? base : end } };
            }
          },
        }),
        benefitAt(b.id, "retirementBenefit.contributions", ["monthly"]),
      ),
    );
    if (b.contributions !== undefined) {
      fields.push(withAddress(timepointField({ key: `${prefix}/contribFrom`, item: "retirementBenefit.contributions", label: "掛金の始まり", level: "detail", find, path: ["contributions", "from"], ageOf, mode: "ym" }), benefitAt(b.id, "retirementBenefit.contributions", ["from"])));
      fields.push(withAddress(timepointField({ key: `${prefix}/contribTo`, item: "retirementBenefit.contributions", label: "掛金の終わり", level: "detail", find, path: ["contributions", "to"], ageOf, mode: "ym", optional: true, nullText: "最後まで" }), benefitAt(b.id, "retirementBenefit.contributions", ["to"])));
    }
  }
  // 詳細: 名前・学歴・勤め先・勤続期間・役員の在任期間・障害による退職
  // 学歴に「わからない」は置かない（学歴がわからないことはほぼ無い。0041 の 2026-10-29 の追記）。選んでいなければ今までどおり大学・大学院卒の値で目安を出す
  fields.push(withAddress(plain({ key: `${prefix}/label`, item: "retirementBenefit.label", label: "名前", level: "detail", kind: "text", find, path: ["label"], optional: true, help: "例: 企業年金連合会の通算企業年金" }), benefitAt(b.id, "retirementBenefit.label")));
  if (kind === "lumpSum")
    fields.push(
      withAddress(
        plain({ key: `${prefix}/education`, item: "retirementBenefit.education", label: "学歴", level: "detail", kind: "select", options: [{ value: "", label: "選んでいない（大学・大学院卒の値で計算）" }, ...EDUCATION_OPTIONS.map((o) => ({ value: o.value, label: o.label }))], find, path: ["education"], optional: true, help: "目安の退職一時金は、学歴・職種で平均が違います" }),
        benefitAt(b.id, "retirementBenefit.education"),
      ),
    );
  const ps = periodsOf(h, m.id);
  if (ps.length > 0)
    fields.push(
      withAddress(
        plain({
          key: `${prefix}/employment`,
          item: "retirementBenefit.employment",
          label: "勤め先", help: "どの働き方の期間の退職金かを選びます",
          level: "detail",
          kind: "select",
          options: ps.map((p) => {
            const f = resolveTimepoint(h, p.from);
            const t = resolveTimepoint(h, p.to);
            return { value: p.id, label: `${EMPLOYMENT_TYPES.find((o) => o.value === p.type)?.label ?? p.type}（${f !== null ? formatYearMonth(f) : "?"}〜${t !== null ? formatYearMonth(t) : ""}）` };
          }),
          find,
          path: ["employment"],
        }),
        benefitAt(b.id, "retirementBenefit.employment"),
      ),
    );
  if (kind !== "nationalPensionFund" && kind !== "civilServantPension") fields.push(...spanFields(wh, m, b, prefix, find, "service", "勤続期間"));
  if (kind === "officerAllowance") fields.push(...spanFields(wh, m, b, prefix, find, "officerService", "役員の在任期間"));
  if (HAS_AMOUNT.has(kind)) fields.push(withAddress(plain({ key: `${prefix}/disability`, item: "retirementBenefit.disability", label: "障害者になったことによる退職", level: "detail", kind: "bool", find, path: ["disability"], optional: true, help: "退職所得控除が増えます" }), benefitAt(b.id, "retirementBenefit.disability")));
  return fields;
}

/** DB の年額の補助（一時金の額を年数と予定利率で年金に直した額。計算エンジンと同じ元利均等の式。予定利率0なら等分） */
function annuityHint(b: RetirementBenefit): string | null {
  const total = b.amount?.value;
  const years = b.receipt?.years;
  if (typeof total !== "number" || total <= 0 || years === undefined || years === null) return null;
  const share = b.receipt?.method === "mixed" ? 1 - Number(b.receipt.lumpShare ?? "0") : 1;
  const pv = total * share;
  const r = Number(b.receipt?.conversionRate ?? "0");
  const annual = r === 0 ? pv / years : (pv * r * (1 + r) ** years) / ((1 + r) ** years - 1);
  return `空欄: 一時金の額から 年${man(annual)}（${years}年・予定利率${(r * 100).toFixed(1)}%）`;
}

/** 外す。その人の退職給付が無くなったら、今の勤め先を「該当なし」にする（もう目安で足さない。文書の3-4） */
function removeBenefitAction(b: RetirementBenefit, prefix: string): ActionDef {
  return {
    key: `${prefix}/remove`,
    label: "外す",
    level: "simple",
    danger: true,
    run: (w) => {
      const next = mutate(w, (h) => void (h.retirementBenefits = (h.retirementBenefits ?? []).filter((x) => x.id !== b.id)));
      return (next.request.input.household.retirementBenefits ?? []).some((x) => x.member === b.member) ? next : retirementNone(next, b.member);
    },
  };
}

/** 退職金・企業年金のまとまり（人ごと。退職給付1件が1つのまとまり） */
export function benefitGroups(wh: WorkingHousehold, m: Member): GroupDef[] {
  const h = wh.request.input.household;
  const who = memberLabel(wh, m.id);
  return (h.retirementBenefits ?? [])
    .filter((b) => b.member === m.id)
    .map((b) => {
      const prefix = `retirement/${b.id}`;
      return { key: prefix, title: `${who}の${b.label ?? KIND_SHORT[b.kind] ?? "退職金・企業年金"}`, level: "simple", fields: benefitFields(wh, m, b, prefix), actions: [removeBenefitAction(b, prefix)] };
    });
}

/** 「＋ 退職金・企業年金を足す」（何件でも）。最初の1件で、今の働き方が正社員・公務員なら目安で入れる。種類の既定は働き方から */
export function addBenefitAction(wh: WorkingHousehold, m: Member): ActionDef {
  const none = retirementNotApplicable(wh, m.id);
  return {
    key: `retirement/${m.id}/add`,
    label: none ? "＋ 退職金・企業年金を足す（今は「該当なし」）" : "＋ 退職金・企業年金を足す",
    level: "simple",
    run: (w) => {
      const cleared = clearRetirementNone(w, m.id);
      const filled = fillRetirement(cleared, m.id);
      if (filled !== cleared) return filled;
      const h = cleared.request.input.household;
      const p = currentPeriod(h, m.id, cleared.request.input.baseMonth);
      const kind = addKindOf(p?.type, (h.retirementBenefits ?? []).filter((x) => x.member === m.id));
      return mutate(cleared, (hh) => {
        const b = initialBenefit(hh, m, kind, { id: newId(), ...(p !== undefined ? { employment: p.id } : {}) });
        (hh.retirementBenefits ??= []).push(b);
        if (kind === "civilServantPension") hh.retirementBenefits.push(civilPensionFixedHalf(m, newId(), b.employment));
      });
    },
  };
}

/** 万一のときの死亡退職金の1行（相続税の目安の非課税に入る。読むだけ） */
function deathLine(wh: WorkingHousehold, m: Member): FieldDef | null {
  if (!(wh.request.input.household.retirementBenefits ?? []).some((b) => b.member === m.id && HAS_AMOUNT.has(b.kind))) return null;
  const per = regulationValue("inheritanceTax.retirementAllowance.exemptionPerHeir", `${wh.request.input.baseMonth}-01`);
  const ex = typeof per === "number" ? `${man(per)}×法定相続人の数まで非課税` : "非課税の枠があります";
  return readLine(`retirement/${m.id}/death`, "万一亡くなったとき", `受け取る前の退職一時金は、勤続の月数で按分して死亡退職金として遺族へ（相続税は${ex}。相続税の目安に入ります）`, "相続・贈与");
}

export function retirementStage(wh: WorkingHousehold): StageDef {
  const h = wh.request.input.household;
  const sections: SectionDef[] = people(h).map((m) => {
    const groups = benefitGroups(wh, m);
    const d = deathLine(wh, m);
    const ro = d === null ? null : readGroup(`retirement/${m.id}/death`, undefined, [d]);
    if (ro !== null) groups.push(ro);
    return { key: `retirement/${m.id}`, title: memberLabel(wh, m.id), level: "simple", groups, actions: [addBenefitAction(wh, m)] };
  });
  const dc = (h.accounts ?? []).filter((a) => DC_RECEIPT_KINDS.has(a.kind));
  const kindLabel = (k: string) => ACCOUNT_KINDS.find((o) => o.value === k)?.label ?? k;
  const ro = readGroup(
    "retirement/dc",
    undefined,
    dc.map((a) => readLine(`retirement/dc/${a.id}`, `${kindLabel(a.kind)}（${memberLabel(wh, a.owner)}）`, receiptText(wh, a), "貯蓄・運用")),
  );
  if (ro !== null)
    sections.push({
      key: "retirement/dc",
      title: "iDeCo・企業型DC・小規模企業共済の受け取り",
      note: "退職金と同じ年や近い年に一時金で受け取ると、退職所得控除を分け合います。受け取りの順番と間隔は、下の「受け取りの並び」で見ます",
      level: "simple",
      groups: [ro],
      actions: [],
    });
  return {
    id: "retirement",
    label: "退職金・企業年金",
    lead: "辞めるときとその後にもらう勤め先・制度の給付（退職一時金・確定給付企業年金・公務員の退職手当・国民年金基金・役員退職慰労金）を、人ごとに何件でも入れます。",
    sections,
  };
}
