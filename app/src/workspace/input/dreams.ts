// 夢プラン（やりたいこと。0103）の1件の作り方と並べ方: 夢は出るお金の行（periodicExpenses）の種類 dream で持ち、順位・計算に入れるか・ひとことメモを
// 行の dream に書く。表の行は一時的支出（ほかのライフイベントの行と同じ）。ふつうの行の優先度（必ず・できれば）とは別の物で、優先度の欄は持たない。
// 画面の区画は stages/events.ts（ライフイベントの入力項目のいちばん上）。このファイルは moneyRows.ts から読むので、moneyRows.ts を読まない
import type { Household, PeriodicExpense, Timepoint } from "../../engine/types.ts";
import { isDream } from "../../engine/moneyRows.ts";
import { addMonths, ageAt } from "../levers.ts";
import { mutate, newId, standardBox, type WorkingHousehold } from "./household.ts";

/** 夢の表の行（一時的支出。ほかのライフイベントの行と同じ） */
export const DREAM_ROW = "cf.expense.lumpSum.other";

/** 夢の額の未入力の印（ひな形は額を入れない） */
export const DREAM_UNENTERED = "未入力（額を入れてください。0円で計算中）";

/** 夢の並び（順位の順。順位の無い物・同じ順位は世帯の並びの順） */
export function dreamRows(h: Household): PeriodicExpense[] {
  const list = (h.periodicExpenses ?? []).map((p, i) => ({ p, i })).filter((x) => isDream(x.p));
  const rank = (p: PeriodicExpense) => p.dream?.rank ?? Number.MAX_SAFE_INTEGER;
  return list.sort((a, b) => rank(a.p) - rank(b.p) || a.i - b.i).map((x) => x.p);
}

/** 次に足す夢の順位（いちばん下） */
export function nextDreamRank(h: Household): number {
  const ds = dreamRows(h);
  return Math.max(ds.length, ...ds.map((p) => p.dream?.rank ?? 0)) + 1;
}

/** 夢の順位を並びの順に1から振り直す（変わる物だけ書く） */
function renumber(h: Household, order: readonly string[]): void {
  order.forEach((id, i) => {
    const p = (h.periodicExpenses ?? []).find((x) => x.id === id);
    if (p !== undefined && p.dream?.rank !== i + 1) p.dream = { ...p.dream, rank: i + 1 };
  });
}

/** 夢を1つ上（-1）・下（+1）へ動かす（順位を振り直す。端なら何もしない） */
export function moveDream(wh: WorkingHousehold, id: string, dir: -1 | 1): WorkingHousehold {
  const order = dreamRows(wh.request.input.household).map((p) => p.id);
  const i = order.indexOf(id);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= order.length) return wh;
  [order[i], order[j]] = [order[j] as string, order[i] as string];
  return mutate(wh, (h) => renumber(h, order));
}

/** 夢のひな形（名前と時期だけ。額は未入力の警告。0103）。時期は本人の年齢（その年齢を過ぎていれば1年後）か今から○年後 */
export interface DreamTemplate {
  key: string;
  label: string;
  /** 本人がこの年齢になる時期 */
  age?: number;
  /** 今から○年後 */
  years?: number;
  help?: string;
}

export const DREAM_TEMPLATES: readonly DreamTemplate[] = [
  { key: "trip", label: "夫婦で海外旅行", age: 65, help: "時期は仮に、ご本人が65歳になる月です（退職のころ）。行き先と額を入れてください" },
  { key: "secondHome", label: "二拠点や別荘", age: 60, help: "時期は仮に、ご本人が60歳になる月です。買う・借りるときの最初の費用を入れます。毎年の費用は「年ごと」にして入れます" },
  { key: "car", label: "憧れの車", years: 3, help: "時期は仮に今から3年後です。車の額を入れます。維持費・ローンは車の入力項目で入れます" },
  { key: "hobby", label: "趣味を始める", years: 1, help: "時期は仮に今から1年後です。道具・教室などの最初の費用を入れます。毎年かかるなら「年ごと」にします" },
  { key: "study", label: "学び直し", years: 1, help: "時期は仮に今から1年後です。学費・講座の費用を入れます" },
  { key: "business", label: "起業", years: 3, help: "時期は仮に今から3年後です。始めるときの費用を入れます。事業の収入は働き方と収入の入力項目で入れます" },
  { key: "move", label: "移住", age: 60, help: "時期は仮に、ご本人が60歳になる月です。引っ越し・家財などの費用を入れます。住まいの売り買い・家賃は住まいの入力項目で入れます" },
  { key: "anniversary", label: "家族の記念", years: 5, help: "時期は仮に今から5年後です。記念の旅行・写真・お祝いなど、名前の欄に中身を書きます" },
];

/** ひな形の時期と、その仮の印の文 */
export function dreamTiming(wh: WorkingHousehold, t: Pick<DreamTemplate, "age" | "years">): { from: Timepoint; basis: string } {
  const base = wh.request.input.baseMonth;
  const self = wh.request.input.household.members.find((m) => m.kind === "self");
  if (t.age !== undefined && self !== undefined && ageAt(self, base) < t.age) return { from: { memberAge: { member: self.id, years: t.age } }, basis: `ひな形の仮の時期（ご本人${String(t.age)}歳。この世帯に合わせて直してください）` };
  const years = t.years ?? 1;
  return { from: { at: addMonths(base, 12 * years) }, basis: `ひな形の仮の時期（今から${String(years)}年後。この世帯に合わせて直してください）` };
}

/**
 * 夢を足す（いちばん下の順位・1回・計算に入れる。額は未入力の警告）。ひな形なら名前と時期（仮の印つき）を入れる。
 * ひな形が無ければ名前は空で、時期は1年後
 */
export function addDream(wh: WorkingHousehold, t: DreamTemplate | null = null, id: string = newId()): WorkingHousehold {
  const timing = t === null ? null : dreamTiming(wh, t);
  const from: Timepoint = timing?.from ?? { at: addMonths(wh.request.input.baseMonth, 12) };
  const next = mutate(wh, (h) => {
    const p: PeriodicExpense = {
      id,
      ...(t !== null ? { label: t.label } : {}),
      kind: "dream",
      row: DREAM_ROW,
      from,
      to: structuredClone(from),
      everyYears: 1,
      amount: standardBox(0, DREAM_UNENTERED) as PeriodicExpense["amount"],
      dream: { rank: nextDreamRank(h) },
    };
    (h.periodicExpenses ??= []).push(p);
  });
  return timing === null ? next : { ...next, assumed: { ...next.assumed, [`ev/${id}/from`]: timing.basis } };
}

/**
 * ふつうの行を夢にする（古い値の優先度「夢」〔wish〕の行で FP が押す。0103）: 種類を夢にし、優先度を外し、いちばん下の順位にする。
 * 名前・額・時期はそのまま。表の行は一時的支出にする（夢はどれも一時的支出の行）
 */
export function toDream(wh: WorkingHousehold, id: string): WorkingHousehold {
  return mutate(wh, (h) => {
    const p = (h.periodicExpenses ?? []).find((x) => x.id === id);
    if (p === undefined || isDream(p)) return;
    const rank = nextDreamRank(h);
    p.kind = "dream";
    delete p.priority;
    p.row = DREAM_ROW;
    p.dream = { rank };
  });
}
