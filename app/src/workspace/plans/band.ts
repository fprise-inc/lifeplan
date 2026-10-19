// 主画面のプランの帯（作業の層）: 帯に並べるプラン（現状＋最大5つ）、プランの文字（A・B…）、カードの提示用の値（PlanBandModel）、
// 全部のプランを色分けで重ねる表示の色の番号（assignColors）。
// 保存できるプランの数に上限は無い。帯に並べるプランは一覧から選ぶ（6つ目を並べると、選んでいない・基準でないプランを1つ帯から外す）。
// 画面の呼び方は「プラン」（表記は「プランB」）。コードの中の名前は proposal・plan のまま。以前の名前の頭の「B案」も読む
import type { EngineRequest, PreviewResult } from "../../engine/types.ts";
import type { PlanBandModel, PlanCardModel, PlanLineModel } from "../../presentation/model.ts";
import { balanceChart, depletionYear, displayYears, financialOf, sumByYear } from "../present.ts";
import { ageInYear, roles } from "../roles.ts";
import { cardMetrics, type DisplaySettings } from "../settings.ts";
import { metricsOf } from "./compare.ts";
import { HEAD, modernPlanName, planLabel, type Proposal } from "./plans.ts";

/** 現状（入力）の枠の名前。プランの ID と重ならない */
export const CURRENT = "current";
/** 帯に並べるプランの数（現状のほか） */
export const MAX_BAND = 5;

const LETTERS = "BCDEFGHIJKLMNOPQRSTUVWXYZ";

/** プランの文字と、帯に出す名前（名前の頭の「プランB」「B案」は文字にして外す）。現状は A */
export function planLetters(list: readonly Proposal[]): Map<string, { letter: string; name: string }> {
  const out = new Map<string, { letter: string; name: string }>([[CURRENT, { letter: "A", name: "現状" }]]);
  const used = new Set<string>(["A"]);
  const pending: Proposal[] = [];
  for (const p of list) {
    const m = HEAD.exec(p.name);
    const letter = m === null ? undefined : (m[1] ?? m[2]);
    if (m !== null && letter !== undefined && letter !== "A" && !used.has(letter)) {
      used.add(letter);
      out.set(p.id, { letter, name: modernPlanName(p.name.slice(m[0].length).trim()) });
    } else pending.push(p);
  }
  for (const p of pending) {
    const letter = [...LETTERS].find((l) => !used.has(l)) ?? String(out.size + 1);
    used.add(letter);
    out.set(p.id, { letter, name: modernPlanName(p.name.replace(/^(?:プラン[A-Z]|[A-Z]案)\s*/, "").trim()) });
  }
  for (const [id, v] of out) if (v.name === "") out.set(id, { ...v, name: planLabel(v.letter) });
  return out;
}

/**
 * 全部のプランを色分けで重ねる表示の色の番号（現状は 0、ほかは 1〜PLAN_COLORS）を、プランの内部 ID ごとに決めて持ち続ける。
 * - 一度決めた番号は、帯の中でほかのプランと重ならない限り変えない（基準を変えても、帯の並びを変えても、ほかのプランを外しても同じ色）
 * - 初めて帯に入るプランは、文字（B→1、C→2…、G→1…）の番号が空いていればそれを、ふさがっていれば空いている小さい番号を使う
 *   （文字は名前から読むので、名前を変えたりほかのプランを消したりすると変わることがある。番号は内部 ID に付けるので変わらない）
 * - 帯の外に出たプランの番号も覚えておき、戻ったときに空いていれば同じ色にする
 * 前の割り当て（prev）は書き換えず、新しい割り当てを返す
 */
export function assignColors(prev: ReadonlyMap<string, number>, band: readonly string[], letterOf: (id: string) => string | undefined, colors: number): Map<string, number> {
  const out = new Map(prev);
  out.set(CURRENT, 0);
  const taken = new Set<number>();
  const fresh: string[] = [];
  for (const id of band) {
    if (id === CURRENT) continue;
    const c = out.get(id);
    if (c !== undefined && c >= 1 && c <= colors && !taken.has(c)) taken.add(c);
    else fresh.push(id);
  }
  for (const id of fresh) {
    const l = letterOf(id);
    const i = l !== undefined ? LETTERS.indexOf(l) : -1;
    const want = i >= 0 ? (i % colors) + 1 : undefined;
    let c = want !== undefined && !taken.has(want) ? want : undefined;
    for (let k = 1; c === undefined && k <= colors; k++) if (!taken.has(k)) c = k;
    const pick = c ?? want ?? 1;
    taken.add(pick);
    out.set(id, pick);
  }
  return out;
}

/** 帯にプランを足す（いっぱいなら、選んでいない・基準でないプランのうち最後のものを外す）。外したプランの ID も返す */
export function addToBand(band: readonly string[], id: string, keep: readonly string[]): { band: string[]; dropped: string | null } {
  if (band.includes(id)) return { band: [...band], dropped: null };
  if (band.length < MAX_BAND) return { band: [...band, id], dropped: null };
  const drop = [...band].reverse().find((x) => !keep.includes(x)) ?? (band.at(-1) as string);
  return { band: [...band.filter((x) => x !== drop), id], dropped: drop };
}

/** 帯を今のプランの一覧に合わせる（消えたプランを外し、5つまでにする） */
export function cleanBand(band: readonly string[], list: readonly Proposal[]): string[] {
  const ids = new Set(list.map((p) => p.id));
  return band.filter((x, i) => ids.has(x) && band.indexOf(x) === i).slice(0, MAX_BAND);
}

export interface BandInput {
  req: EngineRequest;
  /** 帯の枠（現状が先頭） */
  slots: string[];
  letters: Map<string, { letter: string; name: string }>;
  results: Map<string, PreviewResult | null>;
  modified: Set<string>;
  base: string;
  selected: string;
  settings: DisplaySettings;
  /** 色の番号（assignColors。無いプランは 0） */
  colors: ReadonlyMap<string, number>;
}

/** 全部のプランを色分けで重ねる表示の線（帯の順。プランの名前と色の番号と、金融資産・年間収支・純資産の数字だけ） */
export function planLinesModel(input: Omit<BandInput, "modified" | "settings">): PlanLineModel[] {
  const years = displayYears(input.req);
  return input.slots.map((slot) => {
    const l = input.letters.get(slot) ?? { letter: "?", name: "" };
    const r = input.results.get(slot) ?? null;
    const line = { key: l.letter, name: planLabel(l.letter), title: l.name, base: slot === input.base, selected: slot === input.selected, colorIndex: input.colors.get(slot) ?? 0 };
    if (r === null) return { ...line, financial: null, net: null, netWorth: null };
    const fin = financialOf(r.table);
    const net = sumByYear(r.table, (c) => c.row === "cf.net");
    return { ...line, financial: years.map((y) => fin.get(y) ?? 0), net: years.map((y) => net.get(y) ?? 0), netWorth: balanceChart(r.table, years, [], "").netWorth };
  });
}

export function bandModel(input: BandInput): PlanBandModel {
  const { req, letters, results, settings } = input;
  const years = displayYears(req);
  const self = roles(req).find((r) => r.key === "self");
  const last = years.at(-1) ?? req.input.endYear;
  const endAge = self !== undefined ? ageInYear(self.member, last) : null;
  const cards: PlanCardModel[] = input.slots.map((slot) => {
    const l = letters.get(slot) ?? { letter: "?", name: "" };
    const r = results.get(slot) ?? null;
    let shortAge: number | null | undefined;
    let status: string;
    if (r === null) {
      shortAge = undefined;
      status = "計算しています";
    } else {
      const dep = depletionYear(r.table, years);
      shortAge = dep === null ? null : self !== undefined ? ageInYear(self.member, dep) : dep;
      status = dep === null ? (endAge !== null ? `${endAge}歳まで足りる` : "最後まで足りる") : self !== undefined ? `${shortAge}歳で不足` : `${dep}年に不足`;
    }
    return {
      key: l.letter,
      letter: l.letter,
      name: l.name,
      shortAge,
      status,
      base: slot === input.base,
      shown: slot === input.selected,
      modified: input.modified.has(slot),
      metrics: r === null ? [] : cardMetrics(settings, metricsOf(req, r.table, settings.atAge)),
      colorIndex: input.colors.get(slot) ?? 0,
    };
  });
  const sel = letters.get(input.selected);
  return {
    cards,
    baseOptions: input.slots.map((slot) => {
      const l = letters.get(slot) ?? { letter: "?", name: "" };
      return { key: l.letter, label: `${planLabel(l.letter)} ${l.name}` };
    }),
    base: letters.get(input.base)?.letter ?? "A",
    addNote: sel !== undefined ? `${planLabel(sel.letter)}を写して動かす` : "",
  };
}
