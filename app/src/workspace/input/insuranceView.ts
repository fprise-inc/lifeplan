// 保険の入力項目の「保険料と解約返戻金」（0055。読むだけ）: 保険料の合計とこれから払う総額・貯蓄型の解約返戻金の元本割れ。
// 必要保障額との過不足は万一のタブで見る（ここでは必要保障額を計算しない）。計算は万一の場面の無い要求を画面の側で1回だけ計算して読む（世帯は変えない）
import { useEffect, useMemo, useState } from "preact/hooks";
import type { EngineRequest, InsuranceContract, PreviewResult } from "../../engine/types.ts";
import { baseRequest } from "../contingency/requests.ts";
import type { WorkingHousehold } from "./household.ts";
import { kindOf } from "./insuranceKinds.ts";
import { memberLabel } from "./labels.ts";

export interface SavingsLine {
  object: string;
  label: string;
  text: string;
}

export interface InsuranceView {
  premium: { monthly: number; annual: number; remaining: number };
  savings: SavingsLine[];
}

type ByYear = { year: number; object: string; premium: number; deathBenefit: number; surrenderValue: number; paid?: number };
const byYearOf = (r: PreviewResult | null): ByYear[] => ((r?.summary as { insurance?: { byYear?: ByYear[] } } | null)?.insurance?.byYear ?? []) as ByYear[];
const SAVINGS = new Set(["insurance.wholeLife", "insurance.education", "insurance.privateAnnuity", "insurance.foreignCurrency", "insurance.variable"]);
const PREMIUM_ROWS = (row: string) => row === "cf.expense.insurance" || row.startsWith("cf.expense.insurance.");

/** 契約の名前（名前か種類と番号） */
export function contractLabel(wh: WorkingHousehold, c: InsuranceContract, i: number): string {
  const name = c.label !== undefined && c.label !== "" ? c.label : kindOf(c).label;
  return `${name} ${i + 1}（${memberLabel(wh, c.insured)}）`;
}

/** 確かめの注意の1行（確かめの一覧に出す。0055 の追記） */
export interface InsuranceNotice {
  id: string;
  label: string;
  detail: string;
  /** 重なりの中身（重なっている契約の ID。「確認した」の印と比べる。noticeAck.ts） */
  of: string[];
}

/**
 * 同じ方が保険の対象の医療保険・がん保険が2本以上（保障が重なっていないかの確かめ。0055 の追記で、保険の入力項目の区画から確かめの一覧へ移した）。
 * 値は変えない（2本とも続けるなら、そのままでよい）。2本とも続けると決めたときは、確かめの一覧の「確認した」で出さないようにできる
 * （同じ方・同じ種類の重なっている契約の組み合わせが同じあいだ。契約を足す・外す・種類や被保険者を変えると、組み合わせが変わってまた出る）
 */
export function insuranceOverlapNotices(wh: WorkingHousehold): InsuranceNotice[] {
  const list = wh.request.input.household.insuranceContracts ?? [];
  const groups = new Map<string, { member: string; kind: "medical" | "cancer"; names: string[]; ids: string[] }>();
  list.forEach((c, i) => {
    const k = kindOf(c).kind;
    if (k !== "medical" && k !== "cancer") return;
    const key = `${c.insured}|${k}`;
    const g = groups.get(key) ?? { member: c.insured, kind: k, names: [], ids: [] };
    g.names.push(contractLabel(wh, c, i));
    g.ids.push(c.id);
    groups.set(key, g);
  });
  const out: InsuranceNotice[] = [];
  for (const [key, g] of groups) {
    if (g.names.length < 2) continue;
    const who = memberLabel(wh, g.member);
    const what = g.kind === "medical" ? "医療保険" : "がん保険";
    const cover = g.kind === "medical" ? "入院・手術の保障" : "がんの保障";
    out.push({
      id: `insurance/overlap/${key}`,
      label: `${who}の${what}が${g.names.length}本`,
      detail: `${who}の${what}が${g.names.length}本あります（${g.names.join("・")}）。${cover}が重なっていないか、保険証券で確かめてください`,
      of: g.ids,
    });
  }
  return out;
}

/** 計算する要求（万一の場面・必要保障額・相続税の目安を外した、今のままの計算） */
export function insuranceRequest(wh: WorkingHousehold): EngineRequest {
  return baseRequest(wh.request);
}

/** 保険料と解約返戻金を組み立てる（計算の結果は呼ぶ側から） */
export function insuranceView(wh: WorkingHousehold, base: PreviewResult | null): InsuranceView {
  const list = wh.request.input.household.insuranceContracts ?? [];
  const labels = new Map(list.map((c, i) => [c.id, contractLabel(wh, c, i)]));
  const baseYear = Number(wh.request.input.baseMonth.slice(0, 4));
  // 保険料（入力から月・年の合計、計算の結果からこれから払う総額）
  let monthly = 0;
  for (const c of list) {
    if (c.premium.frequency === "monthly") monthly += c.premium.amount;
    else if (c.premium.frequency === "annual") monthly += Math.round(c.premium.amount / 12);
  }
  const remaining = (base?.table ?? []).filter((t) => PREMIUM_ROWS(t.row)).reduce((s, t) => s + t.amount, 0);

  // 解約返戻金の元本割れ（貯蓄型・円の目安の形。1契約1行）
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
      savings.push({ object: c.id, label, text: `解約返戻金が未入力です（0円で数えています）${estimate}` });
      continue;
    }
    const over = ys.find((r) => r.surrenderValue >= (r.paid ?? 0) && r.surrenderValue > 0);
    const text = over === undefined ? "計算の終わりまで元本割れ" : over.year <= baseYear ? "元本を上回っています" : `${over.year - 1}年まで元本割れ`;
    savings.push({ object: c.id, label, text: `${text}${estimate}` });
  }
  return { premium: { monthly, annual: monthly * 12, remaining }, savings };
}

/** 保険料と解約返戻金の計算（世帯が変わったら計算し直す）。計算の道が無ければ null のまま */
export function useInsuranceView(wh: WorkingHousehold, active: boolean, computeOne: ((req: EngineRequest) => Promise<PreviewResult | null>) | undefined): InsuranceView | null {
  const req = useMemo(() => (active && computeOne !== undefined && (wh.request.input.household.insuranceContracts ?? []).length > 0 ? insuranceRequest(wh) : null), [active, computeOne, wh]);
  const [res, setRes] = useState<InsuranceView | null>(null);
  useEffect(() => {
    if (req === null || computeOne === undefined) return;
    let alive = true;
    void computeOne(req)
      .catch(() => null)
      .then((r) => {
        if (alive) setRes(insuranceView(wh, r));
      });
    return () => {
      alive = false;
    };
  }, [req, computeOne, wh]);
  // 計算し直している間は、前の結果を見せておく（数字が消えてちらつかないように）
  return req === null ? null : res;
}
