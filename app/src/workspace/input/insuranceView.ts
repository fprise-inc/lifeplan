// 保険のカードの「保障の見え方」（0055。読むだけ）: 保険料の合計と総額・被保険者ごとの保障の階段・必要保障額との過不足と内訳・
// 保険料のうち貯まる分と元本割れ・病気の想定で受け取る見込み・気づき・必要保障額に合わせるボタンの候補。
// 計算は万一のタブと同じ要求（必要保障額の推移・大きな病気の想定）を画面の側で1回ずつ計算して読む（世帯は変えない）
import { useEffect, useMemo, useState } from "preact/hooks";
import type { EngineRequest, InsuranceContract, PreviewResult, ProtectionBreakdown } from "../../engine/types.ts";
import { adults, defaultYear, illnessOf, protectionRequest, scenarioRequest, scenarios } from "../contingency/requests.ts";
import type { WorkingHousehold } from "./household.ts";
import { isAuto, kindOf, mainCoverage, medicalParts, rowIn, UNENTERED_MAIN, type MedicalPart } from "./insuranceKinds.ts";
import { memberLabel } from "./labels.ts";
import { resolveTimepoint } from "../timepoint.ts";

type Obj = Record<string, unknown>;

export interface StepYear {
  year: number;
  /** 加入中の死亡保険金（一時金と収入保障の残り） */
  coverage: number;
  /** 必要保障額（金融資産を含まない） */
  need: number;
  /** 今の貯蓄を差し引いた必要保障額（既定の線） */
  needWithAssets: number;
  /** 契約ごとの死亡保険金 */
  by: { object: string; amount: number }[];
}

export interface MemberView {
  member: string;
  label: string;
  years: StepYear[];
  /** いちばん大きい不足（今の貯蓄を差し引いた線で。不足が無ければ null）と、いちばん少ない余り */
  worst: { year: number; shortfall: number } | null;
  least: { year: number; surplus: number } | null;
  /** 今亡くなった場合（最初の年）の内訳 */
  breakdown: { year: number; b: ProtectionBreakdown; expenses: number; resources: number } | null;
}

export interface SavingsLine {
  object: string;
  label: string;
  text: string;
}

export interface MedicalLine {
  object: string;
  label: string;
  parts: MedicalPart[];
  total: number;
}

export interface FitCandidate {
  object: string;
  label: string;
  member: string;
  amount: number;
  year: number;
}

export interface InsuranceView {
  premium: { monthly: number; annual: number; remaining: number; rises: string[]; ends: string[] };
  members: MemberView[];
  savings: SavingsLine[];
  medical: { heading: string; lines: MedicalLine[] } | null;
  notices: string[];
  fits: FitCandidate[];
  /** 契約の色の並び（保障の階段の凡例） */
  legend: { object: string; label: string }[];
}

type ByYear = { year: number; object: string; premium: number; deathBenefit: number; surrenderValue: number; paid?: number };
const byYearOf = (r: PreviewResult | null): ByYear[] => ((r?.summary as { insurance?: { byYear?: ByYear[] } } | null)?.insurance?.byYear ?? []) as ByYear[];
const man = (v: number) => `${Math.round(v / 10000).toLocaleString("ja-JP")}万円`;
const SAVINGS = new Set(["insurance.wholeLife", "insurance.education", "insurance.privateAnnuity", "insurance.foreignCurrency", "insurance.variable"]);
const PREMIUM_ROWS = (row: string) => row === "cf.expense.insurance" || row.startsWith("cf.expense.insurance.");

/** 契約の名前（名前か種類と番号） */
export function contractLabel(wh: WorkingHousehold, c: InsuranceContract, i: number): string {
  const name = c.label !== undefined && c.label !== "" ? c.label : kindOf(c).label;
  return `${name} ${i + 1}（${memberLabel(wh, c.insured)}）`;
}

/** 計算する要求: 大人ごとの必要保障額の推移と、本人の大きな病気の想定 */
export function insuranceRequests(wh: WorkingHousehold): { protection: { member: string; req: EngineRequest }[]; illness: { member: string; year: number; req: EngineRequest } | null } {
  const protection = adults(wh.request.input.household).map((a) => ({ member: a.member.id, req: protectionRequest(wh, a.member.id) }));
  const sc = scenarios(wh).find((s) => s.kind === "illness");
  const year = wh.contingency.year ?? defaultYear(wh.request);
  return { protection, illness: sc === undefined ? null : { member: sc.member, year, req: scenarioRequest(wh, sc, year) } };
}

/** 保障の見え方を組み立てる（計算の結果は呼ぶ側から） */
export function insuranceView(wh: WorkingHousehold, protection: readonly { member: string; result: PreviewResult | null }[], illness: { member: string; year: number; result: PreviewResult | null } | null): InsuranceView {
  const h = wh.request.input.household;
  const list = h.insuranceContracts ?? [];
  const labels = new Map(list.map((c, i) => [c.id, contractLabel(wh, c, i)]));
  const base = protection.find((p) => p.result !== null)?.result ?? null;
  const baseYear = Number(wh.request.input.baseMonth.slice(0, 4));
  // 保険料（入力から月・年の合計、計算の結果からこれから払う総額）
  let monthly = 0;
  for (const c of list) {
    if (c.premium.frequency === "monthly") monthly += c.premium.amount;
    else if (c.premium.frequency === "annual") monthly += Math.round(c.premium.amount / 12);
  }
  const remaining = (base?.table ?? []).filter((t) => PREMIUM_ROWS(t.row)).reduce((s, t) => s + t.amount, 0);
  const rises: string[] = [];
  const ends: string[] = [];
  for (const c of list) {
    const label = labels.get(c.id) ?? "";
    let prev = c.premium.amount;
    for (const r of c.renewals ?? []) {
      const ym = resolveTimepoint(h, r.at);
      if (ym !== null && r.premium > prev) rises.push(`${Number(ym.slice(0, 4))}年 ${label}（更新で ${prev.toLocaleString("ja-JP")}円 → ${r.premium.toLocaleString("ja-JP")}円）`);
      prev = r.premium;
    }
    const pu = resolveTimepoint(h, c.premium.payUntil);
    if (pu !== null && c.premium.frequency !== "single" && Number(pu.slice(0, 4)) >= baseYear) ends.push(`${Number(pu.slice(0, 4))}年 ${label}`);
  }
  const annual = monthly * 12;

  // 被保険者ごとの保障の階段と過不足
  const members: MemberView[] = [];
  for (const p of protection) {
    const pm = p.result?.protection?.members.find((m) => m.member === p.member);
    if (pm === undefined || pm.years.length === 0) continue;
    const years: StepYear[] = pm.years.map((y) => ({ year: y.year, coverage: y.coverage, need: y.need, needWithAssets: y.needWithAssets, by: y.coverageBy ?? [] }));
    let worst: MemberView["worst"] = null;
    let least: MemberView["least"] = null;
    for (const y of years) {
      const d = y.coverage - y.needWithAssets;
      if (d < 0 && (worst === null || -d > worst.shortfall)) worst = { year: y.year, shortfall: -d };
      if (d >= 0 && (least === null || d < least.surplus)) least = { year: y.year, surplus: d };
    }
    const first = pm.years[0];
    members.push({
      member: p.member,
      label: memberLabel(wh, p.member),
      years,
      worst,
      least,
      breakdown: first?.breakdown !== undefined ? { year: first.year, b: first.breakdown, expenses: first.expenses, resources: first.resources } : null,
    });
  }

  // 保険料のうち貯まる分・元本割れ（貯蓄型）
  const savings: SavingsLine[] = [];
  const rows = byYearOf(base);
  for (const c of list) {
    if (!SAVINGS.has(c.template)) continue;
    const label = labels.get(c.id) ?? "";
    const ys = rows.filter((r) => r.object === c.id && (r.paid ?? 0) > 0).sort((a, b) => a.year - b.year);
    const estimate = c.simple?.estimate === true ? "（目安）" : "";
    if (ys.length === 0) continue;
    if (ys.every((r) => r.surrenderValue === 0)) {
      // 保障の明細も数表も無い契約（保険料控除のためだけに入れた契約）には出さない（返戻率の欄の未入力の警告と同じ決まり）
      if (c.coverages === undefined && c.schedule === undefined) continue;
      savings.push({ object: c.id, label, text: `解約返戻金が未入力です（0円で数えています）。返戻率か解約の月の額を詳細で入れてください${estimate}` });
      continue;
    }
    const now = ys.find((r) => r.year === baseYear) ?? ys[0];
    const over = ys.find((r) => r.surrenderValue >= (r.paid ?? 0) && r.surrenderValue > 0);
    const rate = now !== undefined && (now.paid ?? 0) > 0 ? Math.floor((now.surrenderValue / (now.paid ?? 1)) * 100) : null;
    const head = now !== undefined ? `${now.year}年末: 払った保険料 ${man(now.paid ?? 0)}・解約返戻金 ${man(now.surrenderValue)}${rate !== null ? `（返戻率 ${rate}%）` : ""}` : "";
    const tail = over === undefined ? "。計算の終わりまで元本割れ" : over.year <= baseYear ? "。元本を上回っています" : `。${over.year - 1}年まで元本割れ（${over.year}年に払った保険料を上回る）`;
    savings.push({ object: c.id, label, text: `${head}${tail}${estimate}` });
  }

  // 病気の想定で受け取る見込み（本人の大きな病気の想定）
  let medical: InsuranceView["medical"] = null;
  if (illness !== null) {
    const ill = illnessOf(wh.contingency.illness);
    const disease = ill.disease === "cancer" ? "がん" : ill.disease === "heartStroke" ? "心疾患・脳卒中" : "そのほかの病気";
    const occurs = `${illness.year}年`;
    const lines: MedicalLine[] = [];
    for (const c of list) {
      const parts = medicalParts(c, illness.member, ill);
      if (parts.length === 0) continue;
      const fromEngine = (illness.result?.table ?? []).filter((t) => t.row === "cf.income.lumpSum.insurance" && t.object === c.id).reduce((s, t) => s + t.amount, 0);
      const sum = parts.reduce((s, x) => s + x.amount, 0);
      // 保障の期間の外・契約の前の病気は計算エンジンが受け取らない（そのときは計算の結果の額）
      lines.push({ object: c.id, label: labels.get(c.id) ?? "", parts: illness.result === null || fromEngine === sum ? parts : [], total: illness.result === null ? sum : fromEngine });
    }
    medical = { heading: `${memberLabel(wh, illness.member)}が${occurs}に大きな病気（${disease}・入院${ill.hospitalDays ?? 0}日・手術${ill.surgeries ?? 0}回）になった想定で受け取る見込み（非課税）`, lines };
  }

  // 気づき
  const notices: string[] = [];
  for (const m of members) {
    for (let i = 1; i < m.years.length; i++) {
      const a = m.years[i - 1] as StepYear;
      const b = m.years[i] as StepYear;
      const shortfall = b.needWithAssets - b.coverage;
      for (const x of a.by) {
        if (b.by.some((y) => y.object === x.object)) continue;
        notices.push(`${b.year}年に${labels.get(x.object) ?? "保険"}が切れ${shortfall > 0 ? `、その年の不足は${man(shortfall)}` : "ます（その年も必要保障額は満たしています）"}`);
      }
    }
  }
  const seen = new Map<string, number>();
  for (const c of list) {
    const k = kindOf(c);
    if (k.kind !== "medical" && k.kind !== "cancer") continue;
    const key = `${c.insured}|${k.kind}`;
    seen.set(key, (seen.get(key) ?? 0) + 1);
  }
  for (const [key, n] of seen) {
    if (n < 2) continue;
    const [who, kind] = key.split("|") as [string, string];
    notices.push(`同じ被保険者（${memberLabel(wh, who)}）に${kind === "medical" ? "医療保険" : "がん保険"}が${n}本あります（保障が重なっていないか確かめてください）`);
  }

  // 必要保障額に合わせる（死亡保障の主な保障が未入力の契約。その被保険者の最初の年の不足）
  const fits: FitCandidate[] = [];
  for (const c of list) {
    const k = kindOf(c);
    const mc = mainCoverage(c, k);
    if (mc === undefined || mc.benefit !== "death" || !isAuto(rowIn(c as unknown as Obj, "insurance.coverages", [mc.id, "amount"]), UNENTERED_MAIN.slice(0, 3))) continue;
    const m = members.find((x) => x.member === c.insured);
    const y = m?.years[0];
    if (m === undefined || y === undefined) continue;
    fits.push({ object: c.id, label: labels.get(c.id) ?? "", member: c.insured, amount: Math.max(0, y.needWithAssets - y.coverage), year: y.year });
  }
  const legend = list.filter((c) => members.some((m) => m.years.some((y) => y.by.some((b) => b.object === c.id)))).map((c) => ({ object: c.id, label: labels.get(c.id) ?? "" }));
  return { premium: { monthly, annual, remaining, rises, ends }, members, savings, medical, notices, fits, legend };
}

/** 保障の見え方の計算（世帯が変わったら計算し直す）。計算の道が無ければ null のまま */
export function useInsuranceView(wh: WorkingHousehold, active: boolean, computeOne: ((req: EngineRequest) => Promise<PreviewResult | null>) | undefined): InsuranceView | null {
  const reqs = useMemo(() => (active && computeOne !== undefined && (wh.request.input.household.insuranceContracts ?? []).length > 0 ? insuranceRequests(wh) : null), [active, computeOne, wh]);
  const [res, setRes] = useState<{ reqs: ReturnType<typeof insuranceRequests>; view: InsuranceView } | null>(null);
  useEffect(() => {
    if (reqs === null || computeOne === undefined) return;
    let alive = true;
    const safe = (r: EngineRequest) => computeOne(r).catch(() => null);
    void Promise.all([Promise.all(reqs.protection.map((p) => safe(p.req))), reqs.illness === null ? Promise.resolve(null) : safe(reqs.illness.req)]).then(([prot, ill]) => {
      if (!alive) return;
      const view = insuranceView(
        wh,
        reqs.protection.map((p, i) => ({ member: p.member, result: prot[i] ?? null })),
        reqs.illness === null ? null : { member: reqs.illness.member, year: reqs.illness.year, result: ill },
      );
      setRes({ reqs, view });
    });
    return () => {
      alive = false;
    };
  }, [reqs, computeOne, wh]);
  // 計算し直している間は、前の結果を見せておく（数字が消えてちらつかないように）
  return reqs === null ? null : (res?.view ?? null);
}
