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

/**
 * 事務所の推定の値と、推定で埋めない入力欄（入力項目ID。fillsByEstimate）を入れる。知らない値ID は捨てる
 * （マスタデータの値と、コードの中の目安〔presets.ts。値ID は「preset.」で始まる。一覧に無い値ID は presets.ts が読まない〕）
 */
export function setOfficeEstimates(values: Readonly<Record<string, OfficeOverride>>, skip: Iterable<string> = []): void {
  office = Object.fromEntries(Object.entries(values).filter(([k]) => MASTER_VALUES[k] !== undefined || k.startsWith("preset.")));
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

/** ヒアリングシートの「わからない」を推定にした根拠の頭（estimates.ts の HEARING_UNKNOWN_BASIS。根拠の文は「<頭>。<推定の根拠>」） */
export const HEARING_UNKNOWN_HEAD = "ヒアリングで「わからない」";

/**
 * 事務所の推定の値の根拠の文（ids のうち最初の、事務所の値がある値の文。無ければ null）。事務所の値から作った推定は、この文だけを根拠にする
 * （ほかの文を足さない。isOfficeBasisText が完全に同じ文で見分けるため。0111 の 2026-11-02 の追記）
 */
export function officeBasisOf(...ids: readonly string[]): string | null {
  for (const id of ids) {
    const o = office[id];
    if (o !== undefined) return o.basis;
  }
  return null;
}

/**
 * 根拠の文が、事務所の推定の値の根拠の文とまったく同じか（前後の空白はそろえる。ヒアリングシートの「わからない」の頭を付けた文も同じ扱い）。
 * カスタム層の推定の根拠の書き換えより、事務所の値の根拠の文を優先する（0111）。文の一部で見分けないので、FP が短い文（「平均」など）を書いても、
 * 出典の長い文の公式の根拠と取り違えない
 */
export const isOfficeBasisText = (text: string | null | undefined): boolean => {
  if (typeof text !== "string") return false;
  const t = text.trim();
  if (t === "") return false;
  return Object.values(office).some((o) => {
    const b = o.basis.trim();
    return t === b || t === `${HEARING_UNKNOWN_HEAD}。${b}`;
  });
};

// ---- 推定の元の印（0111 の追記 2026-11-03。世帯ファイルの形式 0.54 から）----
// 推定の値の箱の estimate.source に、事務所の推定の値から作った推定かを持つ。無ければ公式の目安（統計・コードの中の目安）から作った推定
// （前の版の世帯の推定も公式の目安から作ったと読む）。印は画面が世帯を直したときに付ける（app/src/workspace/input/officeSource.ts）

/** 推定の元の印: 事務所の推定の値から作った推定（values は使った値ID → そのときの事務所の値の指紋） */
export interface EstimateSource {
  readonly kind: "office";
  readonly values: Readonly<Record<string, string>>;
}

/**
 * 事務所の値の指紋（値の JSON の FNV-1a 32ビットの16進8文字）。値が同じなら同じ。根拠の文・変えた日は入れない
 * （文だけを書き直しても、前に作った推定を「前の値から作った」としない）。暗号の指紋ではなく、同じ値かを見分けるだけ
 */
export function officeFingerprint(v: MasterValue["value"]): string {
  const s = JSON.stringify(v);
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

const sameBasis = (text: string, basis: string): boolean => {
  const t = text.trim();
  const b = basis.trim();
  return t !== "" && (t === b || t === `${HEARING_UNKNOWN_HEAD}。${b}`);
};

/**
 * 根拠の文から、今の事務所の推定の値の印を作る（根拠の文が事務所の値の根拠の文とまったく同じ値すべて。無ければ null）。
 * 事務所の値から作った推定の根拠は事務所の根拠の文そのものなので（officeBasisOf）、作った直後の推定はこれで見分けられる。
 * 同じ文の値が2つ以上あるとき（根拠の文を書かずに同じ月に変えた値など）は、その全部を印に入れる
 */
export function officeSourceOf(basis: string | null | undefined): EstimateSource | null {
  if (typeof basis !== "string") return null;
  const values: Record<string, string> = {};
  for (const [id, o] of Object.entries(office)) if (sameBasis(basis, o.basis)) values[id] = officeFingerprint(o.value);
  return Object.keys(values).length === 0 ? null : { kind: "office", values };
}

/** 推定の元の印の形か（世帯から読んだ値を確かめる） */
export const isEstimateSource = (v: unknown): v is EstimateSource => {
  if (typeof v !== "object" || v === null) return false;
  const s = v as { kind?: unknown; values?: unknown };
  return s.kind === "office" && typeof s.values === "object" && s.values !== null && !Array.isArray(s.values) && Object.keys(s.values).length > 0 && Object.values(s.values).every((x) => typeof x === "string");
};

/**
 * 印の値のうち、作った後に事務所の値が変わった・外された（公式に戻した）値ID。空なら今の事務所の値から作った推定。
 * 同じ文の値が2つ以上入った印は、どれか1つでも変わっていれば入る
 */
export function changedOfficeValues(s: EstimateSource): string[] {
  return Object.entries(s.values)
    .filter(([id, fp]) => {
      const o = office[id];
      return o === undefined || officeFingerprint(o.value) !== fp;
    })
    .map(([id]) => id);
}

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
