// 3. 退職金・企業年金（0057）: 辞めるときとその後にもらう勤め先・制度の給付（退職一時金・確定給付企業年金・公務員の退職手当と年金払い退職給付・
// 国民年金基金・役員退職慰労金）を、人ごとに何件でも。種類ごとに要る欄だけを出す。目安と額の違いは見込み額の欄だけで分ける（空欄は目安・
// 見込みの計算、額を打てば額。入れ方の選択の欄は置かない。0057 の 2026-10-29 の追記）
// - iDeCo・企業型DC・小規模企業共済の受け取りは口座の物の一部なので貯蓄・運用のカードで入れ、ここには読むだけで並べる。受け取りの順番と
//   間隔（退職所得控除の重なり）は、カードの下の「受け取りの並び」（retirementLineup.ts）で一緒に見る
// - 辞め方・勤続（働き方の期間）は働き方と収入のカードの物。ここは読むだけ（目安の元）
// - 区分「規程で」（会社の退職金規程の計算部品）は、計算部品の差し込み口を開く回に出す（今は出さない）
import type { Account, Household, Member, RetirementBenefit, Timepoint } from "../../../engine/types.ts";
import { addMonths, ageReachedMonth } from "../../levers.ts";
import type { Address } from "../../store/readings.ts";
import { byId, field, getPath, plain, resolveTimepoint, timepointField, yenBox, type ActionDef, type FieldDef, type Finder, type GroupDef, type SectionDef, type StageDef } from "../form.ts";
import { mutate, newId, periodsOf, type WorkingHousehold } from "../household.ts";
import { clearRetirementNone, fillRetirement, retirementNone, retirementNotApplicable } from "../fill.ts";
import { ACCOUNT_KINDS, EMPLOYMENT_TYPES, earners, memberLabel } from "../labels.ts";
import { readGroup, readLine } from "../readLines.ts";
import { regulationValue } from "../../../../../hearing/src/statistics.ts";
import {
  addKindOf,
  ANNUITY_ONLY,
  BENEFIT_KINDS,
  benefitAt,
  civilPensionFixedHalf,
  CIVIL_PENSION_FIXED,
  COMPUTED,
  convertBenefit,
  dbYearsBasis,
  endingOf,
  estRow,
  finalMonthlyAt,
  HAS_AMOUNT,
  initialBenefit,
  isEstimateBox,
  isUnenteredBox,
  KIND_SHORT,
  LUMP_ONLY,
  lumpShareBasis,
  lumpEstimate,
  lumpShareAt,
  multiplierAt,
  periodOf,
  reasonAt,
  spanOf,
  yearsAt,
  type BenefitKind,
} from "../retirementBenefits.ts";
import { putRow } from "../rows.ts";
import { amountText, formatYearMonth } from "../units.ts";
import { defaultPayoutAge, payoutAgeOf } from "../savings/model.ts";
import { currentPeriod } from "./work.ts";
import { CHECK_DOCUMENTS } from "../checkDocuments.ts";
import { presetNum, presetRate } from "../../../../../hearing/src/presets.ts";

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

/** 物の値の状態の行を、物そのものに書く（欄の after から） */
const putOwnRow = (target: Obj, a: Address, basis: string) => void putRow({ household: { retirementBenefits: [target] } }, a, estRow("standard", basis));

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
        ? "推定は見込みの計算（退職時の俸給月額×勤続年数と退職の理由の支給率。調整額は含みません）です"
        : b.kind === "officerAllowance"
          ? "推定は見込みの計算（最終報酬月額×役員の在任年数×功績倍率）です"
          : lumpEst
            ? "会社の見込み額の通知・退職金の規程の早見表の額を写します（定年の時点の額か、今辞めた場合の額かを確かめて）。推定は勤続年数・辞め方からの平均で、勤続や辞め方を直すと推定も直ります"
            : "定年の時点の額か、今辞めた場合の額かを確かめて写してください。0円は「該当なし」か0円と入れたときだけです",
    hint: (w) => amountHint(w, b.id),
  });
  // 勤め先がパートなどに変わったのに、FP が入れた退職一時金が残っている（前の勤め先の退職金として残す。文書の3-5）
  const kept = b.kind === "lumpSum" && p !== undefined && !ESTIMATE_FOR_WARN.has(p.type) && b.amount !== undefined && !isEstimateBox(b.amount) && !isUnenteredBox(b.amount);
  const warn = kept ? `勤め先の働き方が「${EMPLOYMENT_TYPES.find((o) => o.value === p.type)?.label ?? p.type}」になっています。前の勤め先の退職金として残しています` : null;
  // 見込み額は会社の規程・制度の資料で確かめる値（「書類で確かめる」を出す。0041 の追記 2026-10-31）
  const g: FieldDef = { ...f, docCheck: CHECK_DOCUMENTS.retirement };
  return withAddress(warn === null ? g : { ...g, get: (w) => ({ ...g.get(w), warn }) }, benefitAt(b.id, "retirementBenefit.amount"));
}

/**
 * 見込み額の欄の横の1行: 目安の退職一時金は前提（勤続年数と期間・辞め方・制度のある会社の平均）、役員退職慰労金の見込みの計算は式と額
 * （最終報酬月額×在任年数×功績倍率。エンジンの retirement.benefit と同じく在任の月数を年に切り上げる）、公務員の退職手当は計算中の旨
 */
export function amountHint(wh: WorkingHousehold, id: string): string | null {
  const h = wh.request.input.household;
  const x = (h.retirementBenefits ?? []).find((y) => y.id === id);
  if (x === undefined) return null;
  const m = h.members.find((y) => y.id === x.member);
  const p = periodOf(h, x);
  if (x.kind === "lumpSum" && m !== undefined && (x.amount === undefined || isEstimateBox(x.amount))) {
    const span = spanOf(h, m, x, p);
    if (span === null || lumpEstimate(h, x) === null) return null;
    const reason = REASON_TEXT[endingOf(h, m, p)] ?? "自己都合";
    return `勤続${span.years}年（${formatYearMonth(span.from)}〜${formatYearMonth(span.to)}）・${reason}・制度のある会社の平均`;
  }
  if (x.amount !== undefined || !COMPUTED.has(x.kind)) return null;
  if (x.kind === "officerAllowance") {
    const fm = x.estimate?.finalMonthly;
    const mul = x.estimate?.multiplier;
    const from = resolveTimepoint(h, x.officerService?.from ?? (p?.type === "executive" ? (x.service?.from ?? p.from) : null));
    const to = resolveTimepoint(h, x.officerService?.to ?? (p?.type === "executive" ? (x.service?.to ?? p.to) : null));
    if (fm !== undefined && mul !== undefined && from !== null && to !== null && to >= from) {
      const [fy, fmo] = from.split("-").map(Number) as [number, number];
      const [ty, tmo] = to.split("-").map(Number) as [number, number];
      const years = Math.ceil(((ty - fy) * 12 + (tmo - fmo) + 1) / 12);
      return `${amountText(fm)}×在任${years}年×${Number(mul)}倍＝${amountText(Math.round(fm * years * Number(mul)))}（見込みの計算）`;
    }
  }
  return "見込みの計算で計算中（額は受け取りの並びに出ます）";
}

/** 辞め方の短い言葉（目安の前提の1行） */
const REASON_TEXT: Readonly<Record<string, string>> = { retirement: "定年", involuntary: "会社都合", voluntary: "自己都合", contractEnd: "契約満了", sickLeave: "自己都合" };

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
  // 空欄の意味は、空欄のとき使っている年月（勤め先の期間の始まり・終わり）を添える（「空欄: 2006年4月（勤め先の期間）」）
  const p0 = periodOf(wh.request.input.household, b);
  const blank = (end: "from" | "to") => {
    const ym = resolveTimepoint(wh.request.input.household, end === "from" ? (p0?.from ?? null) : (p0?.to ?? null));
    return ym !== null ? `${formatYearMonth(ym)}（勤め先の期間の${end === "from" ? "始まり" : "終わり"}）` : `勤め先の期間の${end === "from" ? "始まり" : "終わり"}`;
  };
  const one = (end: "from" | "to") =>
    withAddress(
      timepointField({ key: `${prefix}/${key}/${end}`, item, label: `${label}の${end === "from" ? "始まり" : "終わり"}`, level: "detail", find, path: [key, end], ageOf, mode: "ym", optional: true, absentWhenEmpty: true, nullText: blank(end), after: complete }),
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
        options: kindOptions(periodOf(h, b)?.type ?? currentPeriod(h, m.id, wh.request.input.baseMonth)?.type),
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
  // 確定給付企業年金を年金だけで受け取るときは、一時金の見込み額の欄を出さない（未入力にも数えない。年金の年額の欄で入れる）。
  // 一時金の額（入れた額・推定）があれば残して見せる（年金の年額が空欄のとき、その額から年金に直すため）
  const amountShown = !(kind === "db" && method === "annuity" && (b.amount === undefined || isUnenteredBox(b.amount)));
  if (HAS_AMOUNT.has(kind) && amountShown) fields.push(amountField(wh, b, prefix, find));
  // 見込みの計算の欄（公務員の俸給月額と理由・役員の最終報酬月額と功績倍率）。見込み額が空欄（見込みの計算で出す）のときは標準に出す
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
              x.receipt = { ...(x.receipt ?? {}), years: presetNum("preset.retirement.dbYears") };
              putOwnRow(target, yearsAt(x.id), dbYearsBasis());
            }
            if (v === "mixed" && x.receipt.lumpShare === undefined) {
              x.receipt = { ...x.receipt, lumpShare: presetRate("preset.retirement.dbLumpShare") };
              putOwnRow(target, lumpShareAt(x.id), lumpShareBasis());
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
    // 一時金の欄を出さないとき（確定給付企業年金を年金だけで受け取る）は、年金の年額を入れる欄にする（入れるまでは未入力）
    const required = ANNUITY_ONLY.has(kind) || !amountShown;
    fields.push(
      withAddress(
        {
          ...plain({
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
                : "年金見込額のお知らせの「年金で受けた場合の年額」。推定は、一時金の額を年数と予定利率で年金に直した額です",
          hint: (v, w) => (v === null && !required ? annuityHint((w.request.input.household.retirementBenefits ?? []).find((x) => x.id === b.id) ?? b) : null),
          }),
          // 企業年金の見込みの年額も、制度の資料で確かめる値
          docCheck: CHECK_DOCUMENTS.retirement,
        },
        benefitAt(b.id, "retirementBenefit.receipt", ["annualAmount"]),
      ),
    );
    if (kind !== "nationalPensionFund") fields.push(yearsField(b, prefix, find));
    if (b.receipt?.years === null || b.receipt?.years === undefined)
      fields.push(
        withAddress(
          plain({ key: `${prefix}/guarantee`, item: "retirementBenefit.receipt", label: "保証期間", level: "detail", kind: "int", suffix: "年", min: 0, max: 40, find, path: ["receipt", "guaranteeYears"], optional: true, help: "入れなければ保証なし。保証期間の残りは、万一のとき遺族に一時金で渡ります" }),
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
  // 詳細: 名前・勤め先・勤続期間・役員の在任期間・障害による退職（学歴の欄は置かない。目安は学歴を分けない値。人の属性で推定の数字を分けない。0118）
  fields.push(withAddress(plain({ key: `${prefix}/label`, item: "retirementBenefit.label", label: "名前", level: "detail", kind: "text", find, path: ["label"], optional: true, help: "例: 企業年金連合会の通算企業年金" }), benefitAt(b.id, "retirementBenefit.label")));
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

/** 勤め先の働き方ごとの、よく使う退職給付の種類（先頭に並べる。ほかは「ほかの種類」の見出しの下） */
const KINDS_BY_WORK: Readonly<Record<string, readonly BenefitKind[]>> = {
  regular: ["lumpSum", "db"],
  contract: ["lumpSum", "db"],
  partTime: ["lumpSum", "db"],
  civilServant: ["civilServantAllowance", "civilServantPension"],
  executive: ["officerAllowance", "lumpSum"],
  selfEmployed: ["nationalPensionFund"],
};

/** 働き方で並べた種類（世帯ファイルの種類は変えない。今の種類がほかの種類でも選べる） */
export function orderedKinds(type: string | undefined): BenefitKind[] {
  const top = KINDS_BY_WORK[type ?? ""] ?? KINDS_BY_WORK.regular!;
  return [...top, ...BENEFIT_KINDS.map((o) => o.value).filter((v) => !top.includes(v))];
}

function kindOptions(type: string | undefined): { value: string; label: string; group?: string }[] {
  const top = KINDS_BY_WORK[type ?? ""] ?? KINDS_BY_WORK.regular!;
  const label = (v: string) => BENEFIT_KINDS.find((o) => o.value === v)?.label ?? v;
  return orderedKinds(type).map((v) => (top.includes(v) ? { value: v, label: label(v) } : { value: v, label: label(v), group: "ほかの種類" }));
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
      // 目安の退職一時金には「勤め先に退職金の制度が無い」（1押しで該当なし。外すと同じ動き。制度の無い勤め先もあるため）
      const noPlan: ActionDef[] = b.kind === "lumpSum" && (b.amount === undefined || isEstimateBox(b.amount)) ? [{ ...removeBenefitAction(b, `${prefix}/noPlan`), label: "勤め先に退職金の制度が無い", danger: false, help: "この目安を外して「該当なし」にします（働き方を選び直しても、推定で足しません）" }] : [];
      return { key: prefix, title: `${who}の${b.label ?? KIND_SHORT[b.kind] ?? "退職金・企業年金"}`, level: "simple", moreLabel: benefitMoreLabel(b), fields: benefitFields(wh, m, b, prefix), actions: [...noPlan, removeBenefitAction(b, prefix)] };
    });
}

/**
 * 退職給付1件の「▸ 続きを見る」の文（0078 の追記 2026-11-01）: 種類で開く欄が違うので、種類ごとに代表の欄を書く。
 * 確定給付企業年金は、一時金で受け取るときは年金の欄が無いので退職一時金と同じ文
 */
export function benefitMoreLabel(b: Pick<RetirementBenefit, "kind" | "receipt">): string {
  const method = ANNUITY_ONLY.has(b.kind) ? "annuity" : LUMP_ONLY.has(b.kind) ? "lumpSum" : (b.receipt?.method ?? "lumpSum");
  if (b.kind === "officerAllowance") return "功績倍率・在任期間を入れる";
  if (b.kind === "civilServantAllowance") return "退職の理由・勤続期間を入れる";
  if (b.kind === "nationalPensionFund") return "保証期間・支給の月を入れる";
  return method === "lumpSum" ? "勤続期間・受け取る時期を入れる" : "年金の受け取り方を入れる";
}

/**
 * 「＋ 退職金・企業年金を足す」（何件でも）: 種類を選んでから足す（1つのボタンの中の選択肢。0040 の追記の choice）。種類は今の働き方で並べる
 * （会社員は退職一時金・確定給付企業年金、公務員は退職手当・年金払い退職給付、役員は役員退職慰労金・退職一時金、自営業は国民年金基金）。
 * 最初の1件で、今の働き方が正社員・公務員の目安の種類を選んだら目安で入れる。該当なしにしてあれば外して足す。
 * 先頭の選択肢の鍵は前のボタンと同じ（retirement/<人>/add）、ほかは retirement/<人>/add/<種類>
 */
export function addBenefitActions(wh: WorkingHousehold, m: Member): ActionDef[] {
  const h = wh.request.input.household;
  const p = currentPeriod(h, m.id, wh.request.input.baseMonth);
  const have = (h.retirementBenefits ?? []).filter((x) => x.member === m.id);
  const first = addKindOf(p?.type, have);
  const kinds = [first, ...orderedKinds(p?.type).filter((k) => k !== first)];
  const label = (k: string) => BENEFIT_KINDS.find((o) => o.value === k)?.label ?? k;
  // 該当なしにしてあることは、区画の見出しの下の「該当なし」で見せる（ボタンの名前には書かない。0057 の 2026-10-29 の追記）
  return kinds.map((kind, i) => ({
    key: i === 0 ? `retirement/${m.id}/add` : `retirement/${m.id}/add/${kind}`,
    label: label(kind),
    level: "simple" as const,
    choice: { key: `retirement/${m.id}/addKind`, label: "＋ 退職金・企業年金を足す", help: "種類を選んで足します。iDeCo・企業型DC・小規模企業共済は貯蓄・運用の入力項目で入れます" },
    run: (w: WorkingHousehold) => addBenefit(w, m, kind),
  }));
}

/** 「＋ 退職金・企業年金を足す」の先頭の選択肢（今の働き方の既定の種類。前の1つのボタンと同じ動き） */
export function addBenefitAction(wh: WorkingHousehold, m: Member): ActionDef {
  return addBenefitActions(wh, m)[0] as ActionDef;
}

/** 種類を決めて退職給付を1件足す（目安の種類なら目安で入れる） */
function addBenefit(w: WorkingHousehold, m: Member, kind: BenefitKind): WorkingHousehold {
  const cleared = clearRetirementNone(w, m.id);
  const filled = fillRetirement(cleared, m.id);
  if (filled !== cleared && (filled.request.input.household.retirementBenefits ?? []).some((b) => b.member === m.id && b.kind === kind)) return filled;
  const h = cleared.request.input.household;
  const p = currentPeriod(h, m.id, cleared.request.input.baseMonth);
  return mutate(cleared, (hh) => {
    const b = initialBenefit(hh, m, kind, { id: newId(), ...(p !== undefined ? { employment: p.id } : {}) });
    (hh.retirementBenefits ??= []).push(b);
    if (kind === "civilServantPension") hh.retirementBenefits.push(civilPensionFixedHalf(m, newId(), b.employment));
  });
}

/**
 * 万一のときの死亡退職金の説明の文（説明の欄。readLines.ts の infoNote）。額は勤め先の規程で決まるもので、勤続の月数での按分はこのアプリの目安の決まり
 * （万一のときのタブで額を入れられる）。非課税限度額は制度データ（相続税の死亡退職金の非課税限度額の法定相続人1人あたりの額）から
 */
export function deathLineText(baseMonth: string): string {
  const per = regulationValue("inheritanceTax.retirementAllowance.exemptionPerHeir", `${baseMonth}-01`);
  const ex = typeof per === "number" ? `死亡退職金の非課税限度額（${man(per)}×法定相続人の数）` : "死亡退職金の非課税限度額";
  return `万一亡くなったときは、受け取る前の退職金が死亡退職金として遺族に支払われることがあり、額は勤め先の退職金の規程で決まります。このアプリでは、勤続の月数で按分した額を目安にします（「万一のとき」のタブで額を入れられます）。相続税の目安では、${ex}を差し引きます`;
}

/** 死亡退職金の扱いの説明（区画の「?」の中。前は開いたままの説明の欄だった。長い説明は「?」へ） */
function deathNote(wh: WorkingHousehold, m: Member): string | null {
  if (!(wh.request.input.household.retirementBenefits ?? []).some((b) => b.member === m.id && HAS_AMOUNT.has(b.kind))) return null;
  return `万一亡くなったときの扱い: ${deathLineText(wh.request.input.baseMonth)}`;
}


/** 該当なしにしてある人の区画の説明（頭の「該当なし」は見出しの下に、残りは「?」の中に出る。FieldViews.tsx の splitNote） */
export const NONE_NOTE = "該当なし。退職金・企業年金は無いとしています（働き方を選び直しても、推定で足しません）。「＋ 退職金・企業年金を足す」で足すと、該当なしを外します";

export function retirementStage(wh: WorkingHousehold): StageDef {
  const h = wh.request.input.household;
  const sections: SectionDef[] = people(h).map((m) => {
    const groups = benefitGroups(wh, m);
    const d = deathNote(wh, m);
    // 自営業の人は、小規模企業共済・iDeCo の入れ場所の1行（口座の物なので貯蓄・運用の入力項目で入れる。受け取りは下の「受け取りの並び」に出る）
    if (currentPeriod(h, m.id, wh.request.input.baseMonth)?.type === "selfEmployed") {
      const line = readGroup(`retirement/${m.id}/self`, undefined, [readLine(`retirement/${m.id}/self`, "小規模企業共済・iDeCo", "貯蓄・運用で入れます", "貯蓄・運用")]);
      if (line !== null) groups.push(line);
    }
    // 退職給付を外して「該当なし」にしてある人は、見出しの下に「該当なし」と出す（説明は「?」の中。0057 の 2026-10-29 の追記）
    const none = benefitGroups(wh, m).length === 0 && retirementNotApplicable(wh, m.id);
    const note = none ? NONE_NOTE : d;
    return { key: `retirement/${m.id}`, title: memberLabel(wh, m.id), ...(note !== null ? { note } : {}), level: "simple", groups, actions: addBenefitActions(wh, m) };
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
