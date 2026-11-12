// 入力項目の選び方（世帯ごと・事務所の既定値）: どの入力項目を入力のホームに出すかと、入力項目を開いたときの入れ方（標準／詳細）。
// - 世帯ごとの選び方は世帯ファイルの household.itemChoice（形式 0.34 から。任意）。顧客ごとの事実（収益不動産を持つお客さまか）に結び付くので、
//   世帯といっしょに PC・事務所の共有フォルダを移る。事務所の既定値（office/settings.ts の items）は、空の世帯を作るときにだけ写す（0073 の写し方）
// - 非表示は見せ方だけ: 値も値の状態も保存した項目の印も変えない。非表示の項目は今までどおり推定か「無し」で計算する。
//   「当てはまらない」（その世帯には無いと FP が決めた。進み具合に数える）とは別の物
// - 値が入っている入力項目は、非表示にしてあってもホームに出す（黙って値を隠さない）。家族と前提条件はいつも出す
// - 入れ方の既定は「開いたときの入れ方」。パネルの切り替えはその場だけ（世帯を開いている間）で、世帯ファイルには書かない
import type { Level, StageId } from "./form.ts";
import type { WorkingHousehold } from "./household.ts";
import { STAGE_ORDER } from "./stages/index.ts";

export interface ItemChoice {
  /** 入力のホームに出さない入力項目（並びは標準の順）。値が入っている項目は、ここにあっても出す */
  hidden?: StageId[];
  /** 入力項目を開いたときの入れ方（詳細の項目だけ持つ。無い項目は標準） */
  levels?: Partial<Record<StageId, Level>>;
}

/** いつも出す入力項目（計算に必ず要る物があり、非表示にできない） */
export const ALWAYS_SHOWN: readonly StageId[] = ["family", "assumptions"];

const KNOWN = new Set<string>(STAGE_ORDER.map((s) => s.id));
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** 標準の順に並べる（知らない ID・重なりは捨てる） */
const inOrder = (ids: Iterable<string>): StageId[] => {
  const set = new Set(ids);
  return STAGE_ORDER.map((s) => s.id).filter((id) => set.has(id));
};

/** 読んだ値から選び方（形の合わない所は捨てる。何も無ければ空のオブジェクト） */
export function readItemChoice(v: unknown): ItemChoice {
  if (!isObj(v)) return {};
  const hidden = Array.isArray(v.hidden) ? inOrder(v.hidden.filter((x): x is string => typeof x === "string" && KNOWN.has(x) && !ALWAYS_SHOWN.includes(x as StageId))) : [];
  const levels: Partial<Record<StageId, Level>> = {};
  if (isObj(v.levels)) for (const id of inOrder(Object.keys(v.levels))) if (v.levels[id] === "detail") levels[id] = "detail";
  return { ...(hidden.length > 0 ? { hidden } : {}), ...(Object.keys(levels).length > 0 ? { levels } : {}) };
}

/** 何も決めていない（全部出す・全部標準で開く） */
export const isEmptyChoice = (c: ItemChoice | undefined | null): boolean => c === undefined || c === null || ((c.hidden ?? []).length === 0 && Object.keys(c.levels ?? {}).length === 0);

/** 同じ選び方か（形を確かめた後の並びで比較する。事務所の既定と世帯の選び方を比較する） */
export const sameChoice = (a: ItemChoice | undefined | null, b: ItemChoice | undefined | null): boolean => JSON.stringify(readItemChoice(a ?? {})) === JSON.stringify(readItemChoice(b ?? {}));

/** 非表示にしてある（値が入っていて出すかは見ない） */
export const isHiddenIn = (c: ItemChoice | undefined, id: string): boolean => (c?.hidden ?? []).includes(id as StageId);

/** 開いたときの入れ方（決めていなければ null） */
export const levelIn = (c: ItemChoice | undefined, id: string): Level | null => c?.levels?.[id as StageId] ?? null;

/** 出す・出さないを決める（いつも出す項目は変えない） */
export function withShown(c: ItemChoice | undefined, id: StageId, shown: boolean): ItemChoice {
  if (ALWAYS_SHOWN.includes(id)) return readItemChoice(c ?? {});
  const now = new Set(c?.hidden ?? []);
  if (shown) now.delete(id);
  else now.add(id);
  return readItemChoice({ ...(c ?? {}), hidden: [...now] });
}

/** 開いたときの入れ方を決める（標準は持たない） */
export function withLevel(c: ItemChoice | undefined, id: StageId, level: Level): ItemChoice {
  const levels: Partial<Record<StageId, Level>> = { ...(c?.levels ?? {}) };
  if (level === "detail") levels[id] = "detail";
  else delete levels[id];
  return readItemChoice({ ...(c ?? {}), levels });
}

/** 世帯の選び方を置き換える（空なら欄を持たない） */
export function setItemChoice(wh: WorkingHousehold, c: ItemChoice): WorkingHousehold {
  const { itemChoice: _old, ...rest } = wh;
  void _old;
  return isEmptyChoice(c) ? rest : { ...rest, itemChoice: readItemChoice(c) };
}
