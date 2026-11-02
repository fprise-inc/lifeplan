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
  /** 事務所の推定の値（0111）に置き換えた値か（題名は事務所の根拠の文） */
  readonly office?: true;
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

// ---- 事務所の推定の値（0111）----
// 事務所の既定値の画面で変えたマスタデータの値。画面（app）が事務所の既定値を読み込んだとき・保存したときに入れる。
// 推定の目安（estimates.ts など）はここを通して読むので、入力の画面とヒアリングシートの取り込みの両方に効く。
// 計算エンジンが計算のときに引く値（介護の目安・学校の費用の目安など）には、画面が計算の要求の estimateValues で同じ値を渡す

/** 事務所の値（公式の値と同じ形）と、推定の根拠の文（事務所の文か自動の文に、変えた年月を付けた文） */
export interface OfficeOverride {
  readonly value: MasterValue["value"];
  readonly basis: string;
}

let office: Readonly<Record<string, OfficeOverride>> = {};
let noFill: ReadonlySet<string> = new Set();

/** 事務所の推定の値と、推定で埋めない入力欄（入力項目ID。fillsByEstimate）を入れる。知らない値ID は捨てる */
export function setOfficeEstimates(values: Readonly<Record<string, OfficeOverride>>, skip: Iterable<string> = []): void {
  office = Object.fromEntries(Object.entries(values).filter(([k]) => MASTER_VALUES[k] !== undefined));
  noFill = new Set(skip);
}

/** 今の事務所の推定の値（値ID → 事務所の値と根拠の文） */
export const officeEstimates = (): Readonly<Record<string, OfficeOverride>> => office;

/** 今の推定で埋めない入力欄 */
export const noFillTargets = (): ReadonlySet<string> => noFill;

/** 事務所の推定の値を一時的に置き換えて run を呼ぶ（事務所の既定値の画面の「代表の世帯で差を見る」。終わると元に戻す） */
export function withOfficeEstimates<T>(values: Readonly<Record<string, OfficeOverride>>, skip: Iterable<string>, run: () => T): T {
  const was = { office, noFill };
  setOfficeEstimates(values, skip);
  try {
    return run();
  } finally {
    office = was.office;
    noFill = was.noFill;
  }
}

/** その入力欄を推定で埋めるか（事務所の既定値で「推定で埋めない」にした欄は false。空欄のまま「入力が足りない」の扱い） */
export const fillsByEstimate = (target: string): boolean => !noFill.has(target);

/** 根拠の文が事務所の推定の値の根拠の文を含むか（カスタム層の推定の根拠の書き換えより、事務所の値の根拠の文を優先する。0111） */
export const isOfficeBasisText = (text: string | null | undefined): boolean =>
  typeof text === "string" && text !== "" && Object.values(office).some((o) => text.includes(o.basis));

/** 公式の値（事務所の推定の値を当てない、写しのままの値） */
export function officialMasterValue(id: string): MasterValue | null {
  return MASTER_VALUES[id] ?? null;
}

/** 写しにあるマスタデータの値ID（事務所の既定値の画面の一覧） */
export const masterIds = (): readonly string[] => Object.keys(MASTER_VALUES);

/** マスタデータの値（事務所の推定の値があれば、その値。題名は事務所の根拠の文） */
export function masterValue(id: string): MasterValue | null {
  const m = MASTER_VALUES[id];
  if (m === undefined) return null;
  const o = office[id];
  return o === undefined ? m : { ...m, value: o.value, title: o.basis, reviewed: true, office: true };
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
