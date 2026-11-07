// 保険の入れ漏れの一覧（0153 の3）: 控除証明書などの書類にある保険の契約のうち、今の保険の入力に無さそうな契約を一覧にする。
// - 書類の契約ごとに、今ある契約と「保険会社（名前の中の会社名）・種類・契約年月・年間の保険料」を比べ、2つ以上が合えば「同じ契約かも」と知らせる
//   （黙ってまとめない。同じなら FP が「今の保険契約に当てる」を選ぶ。0154 の3）。1つも合わなければ「入力に無さそう」
// - 種類だけが同じ契約は、手がかりとして名前だけ添える（同じとはみなさない）
// - 一覧は画面を開くたびに今の世帯から作る（保存しない）。この記録で足した契約は「足しました」、足さないにした契約は「足さないにしました」
// - 読み手（控除証明書の XML）・AI の答え・貼り付けのどれでも、新しい保険の契約の候補があれば同じに作る
import type { InsuranceContract } from "../../engine/types.ts";
import type { WorkingHousehold } from "../input/household.ts";
import { kindDef, kindOf } from "../input/insuranceKinds.ts";
import { DEDUCTION_TYPES } from "../input/labels.ts";
import { formatYearMonth } from "../input/units.ts";
import type { CandidateValue, DocCandidate, DocumentReading } from "./types.ts";

export type GapStatus = "missing" | "maybe" | "added" | "linked" | "rejected";

export interface GapMatch {
  /** 今ある契約の名前（名前が無ければ種類） */
  label: string;
  /** 合った手がかり（保険会社・種類・契約年月・保険料） */
  reasons: string[];
}

export interface GapRow {
  /** 新しい物の候補の鍵 */
  key: string;
  label: string;
  kind: string;
  contractDate: string | null;
  /** 年間の保険料（月払いは12倍。分からなければ null） */
  annual: number | null;
  deduction: string | null;
  status: GapStatus;
  /** 同じ契約かもしれない今ある契約（2つ以上の手がかりが合ったもの） */
  matches: GapMatch[];
  /** 種類だけが同じ今ある契約（手がかりとして名前だけ） */
  sameKind: string[];
}

export interface GapList {
  rows: GapRow[];
  missing: number;
  maybe: number;
}

const decided = (c: DocCandidate): CandidateValue | null => (c.status === "corrected" ? (c.decided?.value ?? null) : c.value);

function valueOf(r: DocumentReading, key: string, item: string, at?: string): CandidateValue | null {
  const c = r.candidates.find((x) => x.target.newObject === key && x.target.item === item && (at === undefined || x.target.at?.[0] === at) && x.status !== "rejected");
  return c === undefined ? null : decided(c);
}

/** 比べるための名前の形（NFKC・空白と会社の種類の言葉を外す） */
const norm = (s: string): string =>
  s
    .normalize("NFKC")
    .replace(/株式会社|\(株\)|相互会社|保険会社/gu, "")
    .replace(/\s+/gu, "")
    .toLowerCase();

/** 名前の先頭の語（「会社名 保険の種類」の会社名）。2字より短ければ使わない */
function companyOf(label: string): string | null {
  const first = label.normalize("NFKC").trim().split(/\s+/u)[0] ?? "";
  const n = norm(first);
  return [...n].length >= 2 ? n : null;
}

const annualOf = (amount: number | null, frequency: string | null): number | null => (amount === null || amount <= 0 ? null : frequency === "monthly" ? amount * 12 : amount);
const near = (a: number, b: number): boolean => Math.abs(a - b) <= Math.max(1, Math.round(Math.max(a, b) * 0.03));

const deductionLabel = (v: CandidateValue | null): string | null => (typeof v === "string" ? (DEDUCTION_TYPES.find((o) => o.value === v)?.label ?? null) : null);

/** 書類の保険の契約の候補ごとの、入れ漏れの一覧（新しい保険の契約の候補が無ければ null） */
export function insuranceGaps(wh: WorkingHousehold, r: DocumentReading): GapList | null {
  const objects = r.objects.filter((o) => o.kind.startsWith("insurance:"));
  if (objects.length === 0) return null;
  const made = new Set(r.objects.flatMap((o) => (o.created !== undefined ? [o.created] : [])));
  const existing = (wh.request.input.household.insuranceContracts ?? []).filter((x) => !made.has(x.id));
  const rows = objects.map((o): GapRow => {
    const subtype = o.kind.slice("insurance:".length);
    const def = kindDef(subtype);
    const label = valueOf(r, o.key, "insurance.label");
    const date = valueOf(r, o.key, "insurance.contractDate");
    const amount = valueOf(r, o.key, "insurance.premium", "amount");
    const freq = valueOf(r, o.key, "insurance.premium", "frequency");
    const ded = valueOf(r, o.key, "insurance.deductionCategory", "type");
    const name = typeof label === "string" ? label : (def?.label ?? "保険の契約");
    const contractDate = typeof date === "string" && /^\d{4}-\d{2}$/u.test(date) ? date : null;
    const annual = annualOf(typeof amount === "number" ? amount : null, typeof freq === "string" ? freq : null);
    const company = typeof label === "string" ? companyOf(label) : null;
    const matches: GapMatch[] = [];
    const sameKind: string[] = [];
    for (const x of existing) {
      const xk = kindOf(x as Pick<InsuranceContract, "subtype" | "template">);
      const xl = typeof x.label === "string" && x.label !== "" ? x.label : xk.label;
      const reasons: string[] = [];
      if (company !== null && norm(xl).includes(company)) reasons.push("保険会社");
      const kindSame = xk.kind === subtype || (def !== undefined && xk.template === def.template && x.subtype === undefined);
      if (kindSame) reasons.push("種類");
      if (contractDate !== null && x.contractDate === contractDate) reasons.push("契約年月");
      const xa = annualOf(x.premium.amount, x.premium.frequency);
      if (annual !== null && xa !== null && near(annual, xa)) reasons.push("保険料");
      if (reasons.length >= 2) matches.push({ label: xl, reasons });
      else if (kindSame) sameKind.push(xl);
    }
    const status: GapStatus = o.status === "accepted" ? (o.linked === true ? "linked" : "added") : o.status === "rejected" ? "rejected" : matches.length > 0 ? "maybe" : "missing";
    return { key: o.key, label: name, kind: def?.label ?? "保険", contractDate, annual, deduction: deductionLabel(ded), status, matches, sameKind };
  });
  return { rows, missing: rows.filter((x) => x.status === "missing").length, maybe: rows.filter((x) => x.status === "maybe").length };
}

/** 一覧の1行の、今の保険の入力との比べの言葉 */
export function gapText(g: GapRow): string {
  switch (g.status) {
    case "added":
      return "足しました";
    case "linked":
      return "今の契約に当てました";
    case "rejected":
      return "足さないことにしました";
    case "maybe":
      return `同じ契約かもしれません: ${g.matches.map((m) => `${m.label}（${m.reasons.join("・")}が同じ）`).join("、")}`;
    case "missing":
      return `今の保険の入力に無さそうです${g.sameKind.length > 0 ? `（同じ種類の契約: ${g.sameKind.join("・")}）` : ""}`;
  }
}

export const gapDate = (g: GapRow): string => (g.contractDate !== null ? formatYearMonth(g.contractDate) : "—");
