// 主画面の案の帯（作業の層）: 帯に並べる案（現状＋最大5案）、案の文字（A・B…）、カードの提示用の値（PlanBandModel）。
// 保存できる案の数に上限は無い。帯に並べる案は一覧から選ぶ（6つ目を並べると、選んでいない・基準でない案を1つ帯から外す）
import type { EngineRequest, PreviewResult } from "../../engine/types.ts";
import type { PlanBandModel, PlanCardModel, PlanLineModel } from "../../presentation/model.ts";
import { balanceChart, depletionYear, displayYears, financialOf, sumByYear } from "../present.ts";
import { ageInYear, roles } from "../roles.ts";
import { cardMetrics, type DisplaySettings } from "../settings.ts";
import { metricsOf } from "./compare.ts";
import type { Proposal } from "./plans.ts";

/** 現状（入力）の枠の名前。案の ID と重ならない */
export const CURRENT = "current";
/** 帯に並べる案の数（現状のほか） */
export const MAX_BAND = 5;

const LETTERS = "BCDEFGHIJKLMNOPQRSTUVWXYZ";

/** 案の文字と、帯に出す名前（名前の頭の「B案」は文字にして外す）。現状は A */
export function planLetters(list: readonly Proposal[]): Map<string, { letter: string; name: string }> {
  const out = new Map<string, { letter: string; name: string }>([[CURRENT, { letter: "A", name: "現状" }]]);
  const used = new Set<string>(["A"]);
  const pending: Proposal[] = [];
  for (const p of list) {
    const m = /^([B-Z])案(?:\s+|$)/.exec(p.name);
    if (m !== null && !used.has(m[1] as string)) {
      used.add(m[1] as string);
      out.set(p.id, { letter: m[1] as string, name: p.name.slice(m[0].length).trim() });
    } else pending.push(p);
  }
  for (const p of pending) {
    const letter = [...LETTERS].find((l) => !used.has(l)) ?? String(out.size + 1);
    used.add(letter);
    out.set(p.id, { letter, name: p.name.replace(/^[A-Z]案\s*/, "").trim() });
  }
  for (const [id, v] of out) if (v.name === "") out.set(id, { ...v, name: `${v.letter}案` });
  return out;
}

/** 帯に案を足す（いっぱいなら、選んでいない・基準でない案のうち最後のものを外す）。外した案の ID も返す */
export function addToBand(band: readonly string[], id: string, keep: readonly string[]): { band: string[]; dropped: string | null } {
  if (band.includes(id)) return { band: [...band], dropped: null };
  if (band.length < MAX_BAND) return { band: [...band, id], dropped: null };
  const drop = [...band].reverse().find((x) => !keep.includes(x)) ?? (band.at(-1) as string);
  return { band: [...band.filter((x) => x !== drop), id], dropped: drop };
}

/** 帯を今の案の一覧に合わせる（消えた案を外し、5つまでにする） */
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
}

/** 全部の案を色分けで重ねる表示の線（帯の順。案の名前と、金融資産・年間収支・純資産の数字だけ） */
export function planLinesModel(input: Omit<BandInput, "modified" | "settings">): PlanLineModel[] {
  const years = displayYears(input.req);
  return input.slots.map((slot) => {
    const l = input.letters.get(slot) ?? { letter: "?", name: "" };
    const r = input.results.get(slot) ?? null;
    const line = { key: l.letter, name: `${l.letter}案`, title: l.name, base: slot === input.base, selected: slot === input.selected };
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
    };
  });
  const sel = letters.get(input.selected);
  return {
    cards,
    baseOptions: input.slots.map((slot) => {
      const l = letters.get(slot) ?? { letter: "?", name: "" };
      return { key: l.letter, label: `${l.letter} ${l.name}` };
    }),
    base: letters.get(input.base)?.letter ?? "A",
    addNote: sel !== undefined ? `${sel.letter}案を写して動かす` : "",
  };
}
