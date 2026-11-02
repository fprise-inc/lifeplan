// 万一のタブの保険の見え方（読むだけ。0055 の追記・0071 の追記）: 大きな病気の場面の「保険金・給付金」の契約ごと・給付ごとの内訳と、
// 必要保障額の推移の気づき（保険が切れる年と、その年の不足）。どちらも万一のタブがすでに計算した結果（選んだ場面・万一なし・必要保障額の推移）を
// 読むだけで、計算を増やさない。計算の結果は変えない
import type { EngineRequest, Illness, InsuranceContract, PreviewResult, ProtectionOutput, TableCell } from "../../engine/types.ts";
import type { BenefitDetailModel, ProtectionInsightModel } from "../../presentation/model.ts";
import type { WorkingHousehold } from "../input/household.ts";
import { defaultMaxDays } from "../input/insuranceKinds.ts";
import { contractLabel } from "../input/insuranceView.ts";
import { displayYears } from "../present.ts";
import { manText } from "./present.ts";
import { illnessOf, type Scenario } from "./requests.ts";

const under = (row: string, prefix: string) => row === prefix || row.startsWith(prefix + ".");
const LUMP = "cf.income.lumpSum.insurance";
const PERIODIC = "cf.income.other.insuranceBenefit";

export interface MedicalPart {
  coverage: string;
  benefit: string;
  /** 例: 「入院 20日」「手術 1回」「がん一時金」 */
  label: string;
  amount: number;
}

/**
 * 病気の想定で受け取る見込み（給付ごと。0円の給付は入れない。計算エンジンの insurance.policy と同じ決まり）。
 * 起きる月に保障が続いているかは見ない（呼ぶ側が計算の結果の額と比べる）
 */
export function medicalParts(c: InsuranceContract, member: string, ill: Illness): MedicalPart[] {
  const out: MedicalPart[] = [];
  for (const x of c.coverages ?? []) {
    if ((x.insured ?? c.insured) !== member) continue;
    let amount: number;
    let label: string;
    if (x.benefit === "hospitalDaily") {
      const days = Math.min(ill.hospitalDays ?? 0, x.maxDays ?? defaultMaxDays());
      amount = x.amount * days;
      label = `入院 ${days}日`;
    } else if (x.benefit === "surgery") {
      amount = x.amount * (ill.surgeries ?? 0);
      label = `手術 ${ill.surgeries ?? 0}回`;
    } else if (x.benefit === "cancerLump") {
      amount = ill.disease === "cancer" ? x.amount : 0;
      label = "がん一時金";
    } else if (x.benefit === "threeMajorLump") {
      amount = ill.disease === "cancer" || ill.disease === "heartStroke" ? x.amount : 0;
      label = "三大疾病一時金";
    } else continue;
    if (amount > 0) out.push({ coverage: x.id, benefit: x.benefit, label, amount });
  }
  return out;
}

/** 契約の名前（入力項目と同じ「種類と番号（被保険者）」） */
export function contractLabels(wh: WorkingHousehold): Map<string, string> {
  return new Map((wh.request.input.household.insuranceContracts ?? []).map((c, i) => [c.id, contractLabel(wh, c, i)]));
}

/** 病気の種類の言い方 */
const diseaseText = (d: Illness["disease"]) => (d === "cancer" ? "がん" : d === "heartStroke" ? "心疾患・脳卒中" : "そのほかの病気");

/** 大きな病気の場面の内訳の下の一文（病気の想定と、計算していない条件） */
export function illnessBenefitNote(wh: WorkingHousehold): string {
  const ill = illnessOf(wh.contingency.illness);
  return `保険金・給付金は、病気の想定（${diseaseText(ill.disease)}・入院${ill.hospitalDays ?? 0}日・手術${ill.surgeries ?? 0}回）で数えた見込みです（非課税）。2回目以降のがん一時金・先進医療などの細かい条件は計算していません。病気の想定は下の前提で直せます`;
}

/**
 * 大きな病気の場面の「保険金・給付金」の契約ごとの内訳（万一なしとの差。内訳の表と同じ、翌年の額と起きた年からの累計）。
 * 給付ごとの額は、計算の結果の額と同じときだけ出す（保障の期間の外・契約の前の病気などで違うときは、契約の合計だけ）
 */
export function illnessBenefits(wh: WorkingHousehold, sc: Scenario, year: number, result: PreviewResult, none: PreviewResult, labels: ReadonlyMap<string, string> = contractLabels(wh)): BenefitDetailModel[] {
  if (sc.kind !== "illness") return [];
  const req: EngineRequest = wh.request;
  const years = displayYears(req);
  const last = years.at(-1) ?? req.input.endYear;
  const first = Math.min(year + 1, last);
  const ill = illnessOf(wh.contingency.illness);
  // 契約ごと・行（一時金か毎月の給付）ごと・年ごとの額（万一の場合 − 万一なし）
  const diff = new Map<string, { lump: Map<number, number>; periodic: Map<number, number> }>();
  const addCells = (cells: readonly TableCell[], sign: 1 | -1) => {
    for (const t of cells) {
      if (t.object === undefined || t.year < year) continue;
      const kind = under(t.row, LUMP) ? "lump" : under(t.row, PERIODIC) ? "periodic" : null;
      if (kind === null) continue;
      let d = diff.get(t.object);
      if (d === undefined) diff.set(t.object, (d = { lump: new Map(), periodic: new Map() }));
      d[kind].set(t.year, (d[kind].get(t.year) ?? 0) + sign * t.amount);
    }
  };
  addCells(result.table, 1);
  addCells(none.table, -1);
  const sum = (m: Map<number, number>) => [...m.values()].reduce((a, b) => a + b, 0);
  const out: BenefitDetailModel[] = [];
  for (const c of wh.request.input.household.insuranceContracts ?? []) {
    const d = diff.get(c.id);
    if (d === undefined) continue;
    const lump = sum(d.lump);
    const periodic = sum(d.periodic);
    const firstYear = (d.lump.get(first) ?? 0) + (d.periodic.get(first) ?? 0);
    if (lump === 0 && periodic === 0 && firstYear === 0) continue;
    const parts = medicalParts(c, sc.member, ill);
    const shown: { label: string; amount: number }[] = [];
    if (lump !== 0) shown.push(...(parts.reduce((a, x) => a + x.amount, 0) === lump ? parts : [{ label: "一時金", amount: lump }]));
    if (periodic !== 0) shown.push({ label: "働けない間の給付", amount: periodic });
    out.push({ label: labels.get(c.id) ?? "保険", parts: shown.map((x) => `${x.label} ${manText(x.amount)}`), firstYear, total: lump + periodic });
  }
  return out;
}

/**
 * 必要保障額の推移の気づき（構成員1人）: 保険が切れる年（前の年に死亡保険金のあった契約が、その年に無い）と、その年の不足
 * （今の貯蓄を差し引いた必要保障額 − 死亡保険金）。不足が無ければ「その年も必要保障額は満たしています」
 */
export function lapseInsights(out: ProtectionOutput, memberId: string, labels: ReadonlyMap<string, string>): ProtectionInsightModel[] {
  const m = out.members.find((x) => x.member === memberId);
  if (m === undefined) return [];
  const list: ProtectionInsightModel[] = [];
  for (let i = 1; i < m.years.length; i++) {
    const a = m.years[i - 1];
    const b = m.years[i];
    if (a === undefined || b === undefined) continue;
    const shortfall = b.needWithAssets - b.coverage;
    for (const x of a.coverageBy ?? []) {
      if (x.amount <= 0 || (b.coverageBy ?? []).some((y) => y.object === x.object && y.amount > 0)) continue;
      const name = labels.get(x.object) ?? "保険";
      list.push({ year: b.year, text: shortfall > 0 ? `${b.year}年に${name}が切れ、その年の不足は${manText(shortfall)}` : `${b.year}年に${name}が切れます（その年も必要保障額は満たしています）` });
    }
  }
  return list;
}
