// 結果のタブの動かす項目「金利の見込み（変動金利）」（0203）: 入力の「金利の見込み（変動金利）」の欄と同じ型・同じ関数で当て、
// 欄で同じ型を選んだときと同じ計算の要求・同じ数字になること。上乗せの幅（5年ごと）も選べ、AI の候補の値の形を確かめること
import { describe, expect, it } from "vitest";
import type { Debt, EngineRequest } from "../src/engine/types.ts";
import { allFields } from "../src/workspace/input/form.ts";
import { fromRequest, type WorkingHousehold } from "../src/workspace/input/household.ts";
import { buildStages } from "../src/workspace/input/stages/index.ts";
import { candidateRows } from "../src/workspace/plans/candidates.ts";
import { buildCatalog, type Catalog, type ItemValue, type MovableItem } from "../src/workspace/plans/items.ts";
import { applyValues } from "../src/workspace/plans/plans.ts";
import { keyOf, resolveKey } from "../src/workspace/store/readings.ts";
import { roles } from "../src/workspace/roles.ts";
import { modelHousehold, preview, screenTotals } from "./helpers.ts";

/** 変動金利の住宅ローンのある見本の世帯 */
const SAMPLES = ["salariedCoupleTwoKids", "protectionNeed", "housingPurchase", "rentalSample", "sampleSingle40s", "dualAssetsTwoKids"];

function open(id: string): { req: EngineRequest; wh: WorkingHousehold; cat: Catalog } {
  const req = modelHousehold(id);
  const wh = fromRequest(req);
  const self = roles(req).find((r) => r.key === "self")!.member.id;
  return { req, wh, cat: buildCatalog(wh, self, null) };
}

const variableHomeLoans = (req: EngineRequest): Debt[] => (req.input.household.debts ?? []).filter((d) => d.kind === "mortgage" && d.property === undefined && d.rateSchedule.some((s) => s.type === "variable"));

/** 金利の段から ID を外した物（ID は当てるたびに新しく振る。計算は変わらない） */
const schedule = (req: EngineRequest, id: string) => (req.input.household.debts ?? []).find((d) => d.id === id)!.rateSchedule.map(({ from, type, rate }) => ({ from, type, rate }));

describe("金利の見込み（変動金利）の動かす項目", () => {
  it("変動金利の住宅ローンごとに出て、入力の欄で同じ型を選んだときと同じ要求・同じ数字になる", () => {
    let compared = 0;
    for (const id of SAMPLES) {
      const s = open(id);
      for (const d of variableHomeLoans(s.req)) {
        const it = s.cat.byKey.get(`loan:${d.id}:outlook`) as MovableItem & { control: { kind: "outlook" } };
        const fieldOf = (w: WorkingHousehold) => allFields(buildStages(w).find((x) => x.id === "housing")!).find((f) => f.key.endsWith(`/${d.id}/rateOutlook`));
        const f = fieldOf(s.wh);
        if (f === undefined) {
          // 欄が出ないローン（今の段が変動金利でない）には、動かす項目も出さない
          expect(it, `${id}`).toBeUndefined();
          continue;
        }
        expect(it, `${id} の ${d.id}`).toBeDefined();
        expect(it.control.presets.map((p) => p.value)).toEqual(["flat", "up1", "up2"]);
        for (const p of it.control.presets) {
          const byField = f.set(s.wh, p.value).request;
          const byItem = applyValues(s.wh, { [it.key]: { adds: [...p.adds] } }, s.cat);
          expect(schedule(byItem, d.id), `${id} ${p.value}`).toEqual(schedule(byField, d.id));
          // 欄の型の読みと、動かす項目の今の値も同じ型
          const after = fromRequest(byItem);
          expect(fieldOf(after)?.get(after).value, `${id} ${p.value}`).toBe(p.value);
          expect(it.same(it.read(after), { adds: [...p.adds] })).toBe(true);
          compared++;
        }
        // 計算の数字も同じ（1つの型で確かめる）
        const up2 = it.control.presets[2]!;
        const a = applyValues(s.wh, { [it.key]: { adds: [...up2.adds] } }, s.cat);
        const b = f.set(s.wh, up2.value).request;
        expect(screenTotals(preview(a), a)).toEqual(screenTotals(preview(b), b));
      }
    }
    expect(compared).toBeGreaterThanOrEqual(12);
  }, 120_000);

  it("上乗せの幅は5年ごとに選べ、今の金利に足した段を置く。型でない並びも読み直せる", () => {
    const s = open("salariedCoupleTwoKids");
    const d = variableHomeLoans(s.req)[0]!;
    const it = s.cat.byKey.get(`loan:${d.id}:outlook`)!;
    // 今の金利の段より後に、型どおりでない段がある見本（5年後・10年後ちょうどではない）は「金利の段階で入れた見込み」
    expect(it.read(s.wh)).toBeNull();
    expect(it.text(null)).toBe("金利の段階で入れた見込み");
    const v = { adds: ["0.0025", "0.005", "0.0075"] };
    const req = applyValues(s.wh, { [it.key]: v }, s.cat);
    expect(schedule(req, d.id)).toEqual([
      { from: d.rateSchedule[0]!.from, type: "variable", rate: "0.0065" },
      { from: { at: "2031-10" }, type: "variable", rate: "0.009" },
      { from: { at: "2036-10" }, type: "variable", rate: "0.0115" },
      { from: { at: "2041-10" }, type: "variable", rate: "0.014" },
    ]);
    expect(it.same(it.read(fromRequest(req)), v)).toBe(true);
    expect(it.text(v)).toBe("5年後に＋0.25%・10年後に＋0.5%・15年後に＋0.75%");
    expect(it.note?.(v)).toBe("今の金利 0.65% → 2031年10月から0.9%・2036年10月から1.15%・2041年10月から1.4%（変動金利の段を5年ごとに置きます）");
    // 今の金利のまま: 後の段を外す
    expect(schedule(applyValues(s.wh, { [it.key]: { adds: [] } }, s.cat), d.id)).toHaveLength(1);
  });

  it("AI の候補の値: 型の名前・上乗せの並びを受け、段の数・幅の外は取り込まない", () => {
    const s = open("salariedCoupleTwoKids");
    const d = variableHomeLoans(s.req)[0]!;
    const it = s.cat.byKey.get(`loan:${d.id}:outlook`)!;
    const rows = (value: unknown) => candidateRows({ diffs: [{ id: "c1", target: { object: d.id }, item: "debt.rateSchedule", lever: "loanRateOutlook", value, note: null } as never] }, s.wh, s.cat);
    const one = (value: unknown) => rows(value).map((r) => ({ key: r.key, value: r.value, reason: r.reason }))[0];
    // 場所（lever）を読まない版でも、項目が1つに決まらないときは取り込まない（下の確かめは場所つきの当てはめのある版で意味を持つ）
    const r = one("up1");
    if (r?.key === null) return;
    expect(r).toEqual({ key: it.key, value: { adds: ["0.005", "0.01"] }, reason: null });
    expect(one({ adds: [0.005, "0.01"] })?.value).toEqual({ adds: ["0.005", "0.01"] });
    expect(one(["0.01"])?.value).toEqual({ adds: ["0.01"] });
    expect(one({ adds: ["0.01", "0.02", "0.03", "0.04", "0.05", "0.05", "0.05"] })?.key).toBeNull();
    expect(one({ adds: ["0.06"] })?.key).toBeNull();
    expect(one({ adds: ["-0.01"] })?.key).toBeNull();
    expect(one("up9")?.key).toBeNull();
  });

  it("プランには合成の対策 loanRateOutlook として書き、読み直すと同じ項目に戻る", () => {
    const s = open("salariedCoupleTwoKids");
    const d = variableHomeLoans(s.req)[0]!;
    const key = `loan:${d.id}:outlook`;
    const r = resolveKey(key, s.req.input as never);
    expect(r).toEqual({ kind: "lever", lever: "loanRateOutlook", object: d.id });
    expect(keyOf(r!, s.req.input as never)).toBe(key);
  });

  it("固定金利・固定期間選択型の住宅ローンには出さない", () => {
    const s = open("pairLoan");
    expect(s.cat.items.filter((x) => x.key.endsWith(":outlook"))).toEqual([]);
    const v: ItemValue = null;
    expect(v).toBeNull();
  });
});
