// 推定の目安に使う統計・制度の値の写し（statistics.generated.ts。正本は data/ の YAML、0007）の型と引き方。
// 写しは scripts/statistics.ts が作る（手で書き換えない）。値の正しさ（出典・原本での確認）は正本の側で持つ
import { MASTER_VALUES, REGULATION_VALUES } from "./statistics.generated.ts";

/** 段階表の段（upTo 以下。最後は null）。amount・rate の無い段は「値を確かめられなかった段」 */
export interface BracketStep {
  readonly upTo: number | null;
  readonly amount?: number;
  readonly rate?: string;
}

/** 等級表の行（報酬月額が from 以上 below 未満なら額 amount） */
export interface GradeRow {
  readonly grade: number;
  readonly amount: number;
  readonly from: number;
  readonly below: number | null;
}

/** マスタデータの値（いちばん新しい行） */
export interface MasterValue {
  readonly title: string;
  readonly value: number | string | readonly BracketStep[];
  readonly rev: number;
  /** 原本と照らし合わせた行か（reviewed）。false は原本での確認待ち */
  readonly reviewed: boolean;
  readonly retrievedAt: string | null;
}

/** 制度データの適用期間ごとの行（to が null は次の行の前日まで） */
export interface DatedValue {
  readonly from: string;
  /** 保険者ごとの値（協会けんぽの支部など）の保険者のコード */
  readonly insurer?: string;
  readonly to: string | null;
  readonly rev: number;
  readonly value: number | string | readonly BracketStep[] | readonly GradeRow[];
}

export function masterValue(id: string): MasterValue | null {
  return MASTER_VALUES[id] ?? null;
}

/** マスタデータの額（定数）。無い・額でないときは null */
export function masterAmount(id: string): number | null {
  const v = masterValue(id)?.value;
  return typeof v === "number" ? v : null;
}

/**
 * 制度データのその日（YYYY-MM-DD）の値。適用開始の前なら最初の行、終わりの後は最後の行（延長の仮定。0007 の追記）。日が null なら最後の行。
 * 保険者ごとの値は insurer で選ぶ。
 * 推定の目安なので、行が無い日でも止めずに近い行を使う
 */
export function regulationValue(id: string, date: string | null, insurer?: string): DatedValue["value"] | null {
  const rows = (REGULATION_VALUES[id] ?? []).filter((r) => insurer === undefined || r.insurer === insurer);
  if (date === null) return rows.at(-1)?.value ?? null;
  let hit: DatedValue | undefined;
  for (const r of rows) if (r.from <= date) hit = r;
  return (hit ?? rows[0])?.value ?? null;
}

/** 段階表から、x の段（upTo 以下の最初の段） */
export function bracketStep(table: readonly BracketStep[], x: number): BracketStep | null {
  for (const s of table) if (s.upTo === null || x <= s.upTo) return s;
  return null;
}

/** 等級表から、報酬月額 r の等級の額 */
export function gradeAmount(rows: readonly GradeRow[], r: number): number | null {
  for (const g of rows) if (r >= g.from && (g.below === null || r < g.below)) return g.amount;
  return null;
}
