// 欄ごとの効き目: 入力項目の欄の定義を全部たどり、見本・モデル世帯で、計算に使う欄を1つずつ動かして、結果（キャッシュフロー表〔資産と負債の行を含む〕・
// 相続税の目安・万一のとき〔ご本人の死亡〕）のどこかが変わることを確かめる。記録だけの欄は変わらないことを確かめる。
// 今「入れても効かない」欄は「直す待ちの一覧」（fieldEffectWatch.ts）に入れ、まだ効かないことを確かめる（直ったのに一覧に残っていると落ちる）。
// 計算の回数が多いので、入力項目で4つのファイルに分けて並べて流す（field-effect-*.test.ts）。CI では通しの入力と同じジョブで流す（FINANCIA_WALKTHROUGH=1）
import { readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { REPO_DIR } from "../../scripts/lib.ts";
import { forEngine } from "../../src/engine/moneyRows.ts";
import type { Timepoint } from "../../src/engine/types.ts";
import { demoHousehold } from "../../src/workspace/catalog.ts";
import { defaultYear, scenarioRequest, scenarios } from "../../src/workspace/contingency/requests.ts";
import { allFields, type FieldDef, type StageId, type Val } from "../../src/workspace/input/form.ts";
import { fromRequest, type WorkingHousehold } from "../../src/workspace/input/household.ts";
import { inheritanceRequest } from "../../src/workspace/input/inheritanceLine.ts";
import { buildStage } from "../../src/workspace/input/stages/index.ts";
import { addMonths } from "../../src/workspace/levers.ts";
import { modelHousehold, preview } from "../helpers.ts";
import { fieldShape, NOT_EFFECTIVE_YET, NOT_OBSERVED, RECORD_ONLY, shapeMatches, type ShapeRule } from "./fieldEffectWatch.ts";

/** 流すか（CI の通しの入力のジョブと、手元で npm run check:walkthrough のとき） */
export const WALKTHROUGH = process.env.FINANCIA_WALKTHROUGH === "1";

/**
 * たどる世帯: 見本の棚の世帯を先に（多くの欄はここで効き目が分かる）、残りのモデル世帯は、まだ効き目の分からない欄だけを見る。
 * 時間を延ばさないため、効かなかった欄は TRIES 件の世帯まで（記録だけの欄・この点検で見られない欄は1件）、1つの欄の動かし方は MOVES 通りまで試す
 */
const FIRST = ["salariedCoupleTwoKids", "sampleSingleParent", "sampleSeniorCouple", "sampleExecutive", "rentalSample", "sampleSelfEmployedFamily"];
const HOUSEHOLDS: readonly string[] =
  process.env.FIELD_EFFECT_ONLY !== undefined && process.env.FIELD_EFFECT_ONLY !== ""
    ? process.env.FIELD_EFFECT_ONLY.split(",")
    : [
        ...FIRST,
        ...readdirSync(join(REPO_DIR, "data", "modelHouseholds"))
          .filter((f) => f.endsWith(".json"))
          .map((f) => f.replace(/\.json$/, ""))
          .filter((id) => !FIRST.includes(id))
          .sort(),
      ];
const TRIES = 4;
const MOVES = 3;

function open(id: string): WorkingHousehold {
  const demo = demoHousehold(id);
  const req = modelHousehold(id);
  const self = req.input.household.members.find((m) => m.kind === "self")!;
  return fromRequest(req, demo?.reemployment !== undefined ? { postRetirement: { [self.id]: { ...demo.reemployment, type: demo.reemployment.type as "contract" } } } : {});
}

const addDecimal = (v: string, d: number): string => String(Math.round((Number(v) + d) * 1e6) / 1e6);

/** 欄の値の動かし方の候補（数は増やす・減らす、選ぶ欄は別の選択肢、時点は前後にずらす）。前から順に試し、どれかで結果が変われば効く */
function candidates(f: FieldDef, v: Val, wh: WorkingHousehold): Val[] {
  const base = wh.request.input.baseMonth;
  switch (f.kind) {
    case "yen": {
      if (v === null) return [1_200_000, 30_000_000, 50_000];
      const n = v as number;
      return [Math.round(n * 1.5) + 120_000, ...(n > 0 ? [0] : []), n + 30_000_000];
    }
    case "int": {
      const min = f.min ?? 0;
      const max = f.max ?? 1_000_000;
      const n = v === null ? null : (v as number);
      const raw = n === null ? [5, 40, 65, 1] : [n + 5, n - 5, n + 1, n - 1, n * 2, min, max];
      return [...new Set(raw.filter((x) => x >= min && x <= max && x !== n))];
    }
    case "pct":
    case "decimal": {
      const step = f.kind === "pct" ? 0.01 : 1;
      if (v === null) return [String(step * 2), String(step * 5)];
      return [addDecimal(String(v), step * 2), addDecimal(String(v), -step), "0"].filter((x) => x !== String(v) && Number(x) >= 0);
    }
    case "ym":
      return v === null ? [addMonths(base, 12), addMonths(base, -60)] : [addMonths(String(v), -12), addMonths(String(v), 12), addMonths(String(v), 60)];
    case "bool":
      return [v !== true];
    case "text":
      return [`${v ?? ""}x`];
    case "select":
      return f.options.filter((o) => o.value !== v && o.value !== "").map((o) => o.value);
    case "when":
      return [];
  }
}

/** 時点の欄の動かし方の候補（同じ形のまま前後に） */
function whenCandidates(t: Timepoint | null, base: string): Timepoint[] {
  if (t === null) return [{ at: addMonths(base, 24) }, { at: addMonths(base, 120) }];
  if (t.at !== undefined) return [{ at: addMonths(t.at, 12) }, { at: addMonths(t.at, -12) }, { at: addMonths(t.at, 60) }];
  if (t.memberAge !== undefined) return [1, -1, 5].map((d) => ({ memberAge: { ...t.memberAge!, years: t.memberAge!.years + d } }));
  const off = (t.offset?.years ?? 0) * 12 + (t.offset?.months ?? 0);
  return [12, 60, -12].map((d) => ({ event: t.event as string, offset: { months: off + d } }));
}

/** 結果の見え方: キャッシュフロー表（資産と負債の行を含む）・相続税の目安・万一のとき（ご本人の死亡。翌年に起きた場合）。後の物は前の物が同じときだけ計算する */
function outcome(wh: WorkingHousehold): (() => string)[] {
  const req = wh.request;
  const death = scenarios(wh).find((s) => s.kind === "death");
  return [
    () => JSON.stringify(preview(forEngine(req)).table),
    () => JSON.stringify(preview(forEngine(inheritanceRequest(req))).inheritanceTax ?? null),
    () => (death === undefined ? "" : JSON.stringify(preview(forEngine(scenarioRequest(wh, death, defaultYear(req)))).table)),
  ];
}

const safe = (fn: () => string): string => {
  try {
    return fn();
  } catch (e) {
    return `ERROR ${String(e).slice(0, 200)}`;
  }
};

/** 欄の値を書いた世帯（書けない・計算の要求が変わらないなら null） */
function written(f: FieldDef, wh: WorkingHousehold, c: Val | Timepoint): WorkingHousehold | null {
  try {
    const w1 = f.kind === "when" && f.time !== undefined ? f.time.setWhen(wh, c as Timepoint, "this") : f.set(wh, c as Val);
    return JSON.stringify(w1.request) === JSON.stringify(wh.request) ? null : w1;
  } catch {
    return null;
  }
}

export interface Seen {
  shape: string;
  label: string;
  /** 効いた世帯（効いたら、ほかの世帯は見ない） */
  effective: string | null;
  /** 書いたら計算の要求が変わった世帯 */
  wrote: string[];
  /** その欄がある世帯 */
  households: string[];
}

const matches = (rules: readonly ShapeRule[], shape: string) => rules.find((r) => shapeMatches(r, shape));

/** 入力項目ごとに、全部の世帯をたどる（形 → 見たこと） */
function sweep(stages: readonly StageId[]): Map<string, Seen> {
  const seen = new Map<string, Seen>();
  for (const id of HOUSEHOLDS) {
    const wh = open(id);
    const base = outcome(wh).map((o) => ({ o, v: null as string | null }));
    const baseAt = (i: number) => (base[i]!.v ??= safe(base[i]!.o));
    for (const stage of stages) {
      for (const f of allFields(buildStage(stage, wh))) {
        if (f.readOnly !== undefined) continue;
        const shape = fieldShape(stage, f.key);
        const s = seen.get(shape) ?? { shape, label: f.label, effective: null, wrote: [], households: [] };
        seen.set(shape, s);
        if (!s.households.includes(id)) s.households.push(id);
        if (s.effective !== null) continue;
        if (s.wrote.length >= (matches(RECORD_ONLY, shape) !== undefined || matches(NOT_OBSERVED, shape) !== undefined ? 1 : TRIES)) continue;
        const st = f.get(wh);
        const list: (Val | Timepoint)[] = (f.kind === "when" ? whenCandidates(st.when?.raw ?? null, wh.request.input.baseMonth) : candidates(f, st.value, wh)).slice(0, MOVES);
        for (const c of list) {
          const w1 = written(f, wh, c);
          if (w1 === null) continue;
          if (!s.wrote.includes(id)) s.wrote.push(id);
          const after = outcome(w1);
          if (after.some((o, i) => safe(o) !== baseAt(i))) {
            s.effective = id;
            break;
          }
        }
      }
    }
  }
  return seen;
}

/** 世帯を決めて、1つの欄（形）を動かしたら結果が変わるか（同じ形でも世帯で効き方が違う欄の、直す待ちの確かめに使う） */
export function effectIn(household: string, stage: StageId, shape: string): boolean {
  const wh = open(household);
  const base = outcome(wh).map(safe);
  const fs = allFields(buildStage(stage, wh)).filter((f) => fieldShape(stage, f.key) === shape);
  if (fs.length === 0) throw new Error(`${household} に ${shape} の欄がありません`);
  for (const f of fs) {
    const st = f.get(wh);
    const list: (Val | Timepoint)[] = f.kind === "when" ? whenCandidates(st.when?.raw ?? null, wh.request.input.baseMonth) : candidates(f, st.value, wh);
    for (const c of list) {
      const w1 = written(f, wh, c);
      if (w1 !== null && outcome(w1).some((o, i) => safe(o) !== base[i])) return true;
    }
  }
  return false;
}

/** 入力項目のまとまり1つ分のテスト（ファイルを分けて並べて流す） */
export function fieldEffectSuite(name: string, stages: readonly StageId[]): void {
  const inStages = (r: ShapeRule) => stages.some((s) => r.shape.startsWith(`${s}:`));
  let cached: Map<string, Seen> | null = null;
  // FIELD_EFFECT_DUMP=<フォルダ> で、たどった結果を JSON で書き出す（一覧を直すときの手がかり）
  const result = () => {
    if (cached !== null) return cached;
    cached = sweep(stages);
    const dump = process.env.FIELD_EFFECT_DUMP;
    if (dump !== undefined && dump !== "") writeFileSync(join(dump, `field-effect-${name}.json`), JSON.stringify([...cached.values()], null, 1));
    return cached;
  };
  const values = () => [...result().values()];

  describe.skipIf(!WALKTHROUGH)(`欄ごとの効き目（${stages.join("・")}）`, () => {
    it("計算に使う欄は、どれかの世帯で結果を変える", { timeout: 900_000 }, () => {
      const dead = values()
        .filter((s) => s.effective === null && s.wrote.length > 0 && !matches(RECORD_ONLY, s.shape) && !matches(NOT_EFFECTIVE_YET, s.shape) && !matches(NOT_OBSERVED, s.shape))
        .map((s) => `${s.shape}（${s.label}。${s.households.slice(0, 3).join("・")}）`);
      expect(dead, "動かしても結果が変わらない欄。記録だけの欄なら RECORD_ONLY、効くはずなら NOT_EFFECTIVE_YET、この点検で効き目を見られない（条件・見え方）なら NOT_OBSERVED へ（fieldEffectWatch.ts）").toEqual([]);
    });

    it("記録だけの欄は、動かしても結果を変えない", () => {
      const moved = values()
        .filter((s) => s.effective !== null && matches(RECORD_ONLY, s.shape) !== undefined)
        .map((s) => `${s.shape}（${s.label}。${s.effective}）`);
      expect(moved, "記録だけの一覧にあるのに結果が変わった欄（一覧から外す）").toEqual([]);
    });

    it("直す待ちの一覧の欄は、まだ効かない（直したら一覧から消す）", () => {
      const fixed = values()
        .filter((s) => s.effective !== null && matches(NOT_EFFECTIVE_YET, s.shape) !== undefined)
        .map((s) => `${s.shape}（${matches(NOT_EFFECTIVE_YET, s.shape)!.why}）`);
      expect(fixed, "直ったので、fieldEffectWatch.ts の NOT_EFFECTIVE_YET から消す").toEqual([]);
    });

    it("この点検で効き目を見られない欄は、本当に見られないままの物だけ（効いたら一覧から外す）", () => {
      const now = values()
        .filter((s) => s.effective !== null && matches(NOT_OBSERVED, s.shape) !== undefined)
        .map((s) => `${s.shape}（${s.effective}）`);
      expect(now).toEqual([]);
    });

    it("一覧の行は、どれも今の欄に当たる（古い行を残さない）", () => {
      const shapes = [...result().keys()];
      const stale = [...RECORD_ONLY, ...NOT_EFFECTIVE_YET, ...NOT_OBSERVED]
        .filter(inStages)
        .filter((r) => !shapes.some((x) => shapeMatches(r, x)))
        .map((r) => r.shape);
      expect(stale).toEqual([]);
    });
  });
}
