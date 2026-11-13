// 結果のタブの動かす項目「進路の型」（子ごと。0211）: 入力の子ども・教育の「進路の型」の欄と同じ型・同じ関数で当て、欄で同じ型を選んだときと
// 同じ計算の要求・同じ数字になること。AI の候補の値の形（型の名前・型の言葉）と、プランの持ち方（合成の対策 educationCourse）を確かめる
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { EngineRequest, Goal } from "../src/engine/types.ts";
import { allFields } from "../src/workspace/input/form.ts";
import { fromRequest, type WorkingHousehold } from "../src/workspace/input/household.ts";
import { buildStages } from "../src/workspace/input/stages/index.ts";
import { COURSE_PRESETS } from "../src/workspace/input/stages/education.ts";
import { candidateRefOf, candidateRows } from "../src/workspace/plans/candidates.ts";
import { buildCatalog, type Catalog, type MovableItem } from "../src/workspace/plans/items.ts";
import { leverKindOf } from "../src/workspace/plans/leverChoice.ts";
import { applyValues } from "../src/workspace/plans/plans.ts";
import { keyOf, resolveKey } from "../src/workspace/store/readings.ts";
import { roles } from "../src/workspace/roles.ts";
import { modelHousehold, preview, screenTotals } from "./helpers.ts";

const MODELS = readdirSync(join(import.meta.dirname, "../../data/modelHouseholds"))
  .filter((f) => f.endsWith(".json"))
  .map((f) => f.replace(/\.json$/, ""));

function open(id: string): { req: EngineRequest; wh: WorkingHousehold; cat: Catalog } {
  const req = modelHousehold(id);
  const wh = fromRequest(req);
  const self = roles(req).find((r) => r.key === "self")!.member.id;
  return { req, wh, cat: buildCatalog(wh, self, null) };
}

const educationGoals = (req: EngineRequest): Goal[] => (req.input.household.goals ?? []).filter((g) => g.kind === "education" && g.education !== undefined);

/** 教育の段から ID を外した物（比較のため） */
const stagesOf = (req: EngineRequest, goalId: string) => (req.input.household.goals ?? []).find((g) => g.id === goalId)!.education!.stages;

describe("進路の型の動かす項目", () => {
  it("進路を入れた子ごとに出て、入力の欄で同じ型を選んだときと同じ要求・同じ数字になる", () => {
    let compared = 0;
    let computed = 0;
    for (const id of MODELS) {
      const s = open(id);
      for (const g of educationGoals(s.req)) {
        const it = s.cat.byKey.get(`edu:${g.id}:course`) as (MovableItem & { control: { kind: "choice" } }) | undefined;
        const fieldOf = (w: WorkingHousehold) => allFields(buildStages(w).find((x) => x.id === "education")!).find((f) => f.key === `edu/${g.id}/preset`);
        const f = fieldOf(s.wh);
        if (it === undefined) {
          // 欄が出ない子（教育の段が全部過ぎた子）か、型が決める段がもう全部終わっている子だけ
          continue;
        }
        expect(f, `${id} の ${g.id}`).toBeDefined();
        expect(it.control.options.map((o) => o.value)).toEqual(COURSE_PRESETS.map((p) => p.value));
        expect(it.target).toEqual({ object: g.id });
        expect(it.group).toBe("よく使う");
        // 今の値は欄の読みと同じ（型に当たらなければ null）
        const now = f!.get(s.wh).value;
        expect(it.read(s.wh), `${id}`).toBe(now === "" ? null : now);
        for (const p of COURSE_PRESETS) {
          const byField = f!.set(s.wh, p.value).request;
          const byItem = applyValues(s.wh, { [it.key]: p.value }, s.cat);
          expect(stagesOf(byItem, g.id), `${id} ${p.value}`).toEqual(stagesOf(byField, g.id));
          // 型が決める段は型のとおり。読み直すと欄と同じ型（もう過ぎた段がある子では、同じ段の並びになる前の型〔例: 高校から私立〕に読める）
          for (const st of stagesOf(byItem, g.id)) if (p.sectors[st.stage] !== undefined) expect(st.sector ?? "public", `${id} ${p.value} ${st.stage}`).toBe(p.sectors[st.stage]);
          const after = fromRequest(byItem);
          const read = fieldOf(after)?.get(after).value;
          expect(read, `${id} ${p.value}`).not.toBe("");
          expect(it.read(after)).toBe(read);
          compared++;
        }
        // 計算の数字も同じ（世帯ごとに1つの型で確かめる）
        if (computed < 4) {
          const a = applyValues(s.wh, { [it.key]: "juniorPrivate" }, s.cat);
          const b = f!.set(s.wh, "juniorPrivate").request;
          expect(screenTotals(preview(a), a)).toEqual(screenTotals(preview(b), b));
          computed++;
        }
      }
    }
    expect(compared).toBeGreaterThanOrEqual(5 * 10);
  }, 180_000);

  it("名前・文・補足: 名前に呼び名を入れず、型の言葉と、これからの学校の公立・私立を書く", () => {
    const s = open("salariedCoupleTwoKids");
    const items = s.cat.items.filter((x) => x.key.startsWith("edu:"));
    expect(items.map((x) => x.label)).toEqual(["第1子の進路の型", "第2子の進路の型"]);
    const it = items[0]!;
    expect(it.text("juniorPrivate")).toBe("中学から私立");
    expect(it.text(null)).toBe("段階ごとに選んだ進路（型に当たらない）");
    expect(it.note?.("allPublic")).toMatch(/^これからの学校: .*公立.*。学費は学校の種類ごとの統計の平均$/);
    expect(it.note?.("allPublic")).not.toContain("私立");
    // 私立にすると教育費が増える（型が段の公立・私立を変える）
    const base = screenTotals(preview(s.req), s.req).expense;
    const priv = applyValues(s.wh, { [it.key]: "allPrivate" }, s.cat);
    expect(screenTotals(preview(priv), priv).expense).toBeGreaterThan(base);
  });

  it("AI の候補の値: 型の名前・型の言葉を受け、知らない型は取り込まない。場所は合成の対策 educationCourse", () => {
    const s = open("salariedCoupleTwoKids");
    const it = s.cat.items.find((x) => x.key.startsWith("edu:"))!;
    const goalId = (it.target as { object: string }).object;
    const ref = candidateRefOf(it, s.wh, s.cat);
    expect(ref).toEqual({ target: goalId, lever: "educationCourse" });
    const one = (value: unknown) => candidateRows({ diffs: [{ id: "c1", target: { object: goalId }, item: "goal.education", lever: "educationCourse", value, note: null }] }, s.wh, s.cat).map((r) => ({ key: r.key, value: r.value, to: r.to }))[0];
    expect(one("juniorPrivate")).toEqual({ key: it.key, value: "juniorPrivate", to: "中学から私立" });
    expect(one("中学から私立")?.value).toBe("juniorPrivate");
    expect(one({ preset: "allPublic" })?.value).toBe("allPublic");
    expect(one("private")?.key).toBeNull();
    expect(one(3)?.key).toBeNull();
  });

  it("プランには合成の対策 educationCourse として書き、読み直すと同じ項目に戻る。事務所の既定値の種類は edu:course", () => {
    const s = open("salariedCoupleTwoKids");
    for (const g of educationGoals(s.req)) {
      const key = `edu:${g.id}:course`;
      const r = resolveKey(key, s.req.input as never);
      expect(r).toEqual({ kind: "lever", lever: "educationCourse", object: g.id });
      expect(keyOf(r!, s.req.input as never)).toBe(key);
      expect(leverKindOf(key)).toBe("edu:course");
    }
  });

  it("子のいない世帯・教育の段が全部過ぎた子には出さない", () => {
    expect(open("sampleCoupleNoKids").cat.items.filter((x) => x.key.startsWith("edu:"))).toEqual([]);
    for (const id of MODELS) {
      const s = open(id);
      for (const it of s.cat.items.filter((x) => x.key.startsWith("edu:"))) {
        const g = educationGoals(s.req).find((x) => `edu:${x.id}:course` === it.key);
        expect(g, `${id} ${it.key}`).toBeDefined();
      }
    }
  }, 60_000);
});
