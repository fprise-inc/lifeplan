// 結果のタブの「足りる境目」（0221）: 利回りの5列ごとに、金融資産が最後まで尽きない、いちばん早い働く最後の年齢（ご本人）を二分探索で探す。
// - 列の作り方（今のプランの利回りを中心に1%刻み・0%より下と15%より上は出さず、その分を反対側に足す）
// - 二分探索の答えが、1歳ずつ振って探した答えと同じ。同じ年齢を2度計算せず、回数は 2＋log2(範囲の年齢の数) 以内
// - 本物のエンジンで: 境目の年齢は足り、1つ若い年齢は足りない。ますの要求は AI接続口の plan_changes（働く最後の年齢・運用の利回り）と同じ
// - どの年齢でも足りない列・いちばん若い年齢でも足りる列・出さない世帯（勤めの終わりが無い・もう退職した・働いていない）
// - 見た目: 閉じているときは小さな1行だけ、開くと表・今のプランの1行・配偶者の注、押せない（基準・現状を選んでいる）ときの注
import { describe, expect, it } from "vitest";
import { h } from "preact";
import { renderToString } from "preact-render-to-string";
import { applyPlan as connectorApplyPlan } from "../src/connector/plan.ts";
import { workingOf } from "../src/connector/working.ts";
import { forEngine } from "../src/engine/moneyRows.ts";
import type { EngineRequest } from "../src/engine/types.ts";
import { ageAt } from "../src/workspace/levers.ts";
import { buildCatalog, type Catalog } from "../src/workspace/plans/items.ts";
import { applyValues, type Values } from "../src/workspace/plans/plans.ts";
import type { WorkingHousehold } from "../src/workspace/input/household.ts";
import { ThresholdView, Threshold } from "../src/workspace/tools/Threshold.tsx";
import { answerText, cellValues, currentText, findThresholds, lastsToEnd, rateColumns, rateLabel, thresholdSetup, type ColumnAnswer, type Judge, type ThresholdSetup } from "../src/workspace/tools/threshold.ts";
import { modelHousehold, preview } from "./helpers.ts";

interface Opened {
  wh: WorkingHousehold;
  cat: Catalog;
}
function open(id: string, edit?: (req: EngineRequest) => void): Opened {
  const req = structuredClone(modelHousehold(id));
  edit?.(req);
  const w = workingOf(req, { sampleId: id });
  if (w === null) throw new Error("本人がいません");
  return { wh: w.wh, cat: buildCatalog(w.wh, w.self, w.demo) };
}
const cellReq = (o: Opened, values: Values, rate: string, age: number) => forEngine(applyValues(o.wh, cellValues(values, rate, age), o.cat));
/** 本物のエンジンの判定（1件ずつ計算する） */
const realJudge =
  (o: Opened, values: Values = {}, seen?: string[]): Judge =>
  async (cells) =>
    cells.map((c) => {
      seen?.push(`${c.rate}@${c.age}`);
      const r = cellReq(o, values, c.rate, c.age);
      return lastsToEnd(r, preview(r));
    });

describe("列の利回り", () => {
  it("今のプランの利回りを中心に1%刻みで5列（今が3%なら 1〜5%）", () => {
    expect(rateColumns("0.03", { min: -10, max: 15 })).toEqual(["0.01", "0.02", "0.03", "0.04", "0.05"]);
  });
  it("0%より下は出さず、その分を上に足す（今が0.1%なら 0.1〜4.1%、今が1%なら 0〜4%）", () => {
    expect(rateColumns("0.001", { min: -10, max: 15 })).toEqual(["0.001", "0.011", "0.021", "0.031", "0.041"]);
    expect(rateColumns("0.01", { min: -10, max: 15 })).toEqual(["0", "0.01", "0.02", "0.03", "0.04"]);
  });
  it("15%より上は出さず、その分を下に足す。今のプランの列はマイナスでも出す", () => {
    expect(rateColumns("0.14", { min: -10, max: 15 })).toEqual(["0.11", "0.12", "0.13", "0.14", "0.15"]);
    expect(rateColumns("-0.01", { min: -10, max: 15 })).toEqual(["-0.01", "0", "0.01", "0.02", "0.03"]);
  });
  it("見せ方は小数1桁で、.0 は付けない", () => {
    expect(["0", "0.03", "0.001", "0.0328"].map(rateLabel)).toEqual(["0%", "3%", "0.1%", "3.3%"]);
  });
});

describe("二分探索", () => {
  it("どこに境目があっても、1歳ずつ探した答えと同じ。同じ年齢を2度計算せず、回数は 2＋log2(n) 以内", async () => {
    for (const [min, max] of [
      [50, 75],
      [60, 61],
      [64, 75],
    ] as const) {
      const n = max - min + 1;
      // 列ごとに違う境目（edge: その年齢から足りる。max+1 は どの年齢でも足りない）
      for (let edge = min; edge <= max + 1; edge++) {
        const edges = [edge, Math.min(max + 1, edge + 3), Math.max(min, edge - 2)];
        const rates = ["0.01", "0.02", "0.03"];
        const calls: string[] = [];
        const judge: Judge = async (cells) =>
          cells.map((c) => {
            calls.push(`${c.rate}@${c.age}`);
            return c.age >= (edges[rates.indexOf(c.rate)] as number);
          });
        const got = (await findThresholds({ rates, min, max }, judge)) as ColumnAnswer[];
        rates.forEach((r, i) => {
          const e = edges[i] as number;
          const a = got[i] as ColumnAnswer;
          const want = e === min ? { kind: "edge", age: min } : e > max ? { kind: "none", age: null } : { kind: "found", age: e };
          expect({ kind: a.kind, age: a.age }, `${min}-${max} 境目${e}`).toEqual(want);
          expect(a.computed).toBeLessThanOrEqual(2 + Math.ceil(Math.log2(n)));
          expect(calls.filter((c) => c.startsWith(`${r}@`)).length).toBe(a.computed);
        });
        expect(new Set(calls).size, "同じ年齢を2度計算しない").toBe(calls.length);
      }
    }
  });

  it("計算できなかった年齢に当たった列は「計算できませんでした」。ほかの列は続ける", async () => {
    const judge: Judge = async (cells) => cells.map((c) => (c.rate === "0.02" && c.age === 62 ? null : c.age >= 66));
    const got = (await findThresholds({ rates: ["0.01", "0.02"], min: 50, max: 75 }, judge)) as ColumnAnswer[];
    expect(got[0]).toMatchObject({ kind: "found", age: 66 });
    expect(got[1]?.kind).toBe("failed");
    expect(answerText(got[1] as ColumnAnswer, { min: 50, max: 75 })).toBe("計算できませんでした");
  });

  it("途中でやめる（選んでいるプラン・入力が変わった）と null で、その後は計算しない", async () => {
    let stopped = false;
    let n = 0;
    const judge: Judge = async (cells) => {
      n++;
      stopped = true;
      return cells.map((c) => c.age >= 60);
    };
    expect(await findThresholds({ rates: ["0.01"], min: 50, max: 75 }, judge, () => stopped)).toBeNull();
    expect(n).toBe(1);
  });
});

describe("本物のエンジンで", () => {
  it("salariedCoupleTwoKids: 境目の年齢では足り、1つ若い年齢では足りない。今の利回りの列は1歳ずつ振った答えと同じ", async () => {
    const o = open("salariedCoupleTwoKids");
    const s = thresholdSetup(o.wh, o.cat, {}) as ThresholdSetup;
    expect(s.rates).toEqual(["0.02", "0.03", "0.04", "0.05", "0.06"]);
    expect(s).toMatchObject({ rate: "0.04", age: 60, min: 50, max: 75, self: "ご本人" });
    expect(s.spouse).not.toBeNull();
    const got = (await findThresholds(s, realJudge(o))) as ColumnAnswer[];
    expect(got.map((a) => a.kind)).toEqual(["found", "found", "found", "found", "found"]);
    // 利回りが高いほど、早く退職しても足りる（遅くはならない）
    for (let i = 1; i < got.length; i++) expect(got[i]!.age as number).toBeLessThanOrEqual(got[i - 1]!.age as number);
    const ok = (rate: string, age: number) => {
      const r = cellReq(o, {}, rate, age);
      return lastsToEnd(r, preview(r));
    };
    for (const a of got) {
      expect(ok(a.rate, a.age as number), `${a.rate} ${a.age}歳`).toBe(true);
      expect(ok(a.rate, (a.age as number) - 1), `${a.rate} ${(a.age as number) - 1}歳`).toBe(false);
    }
    // 今の利回りの列: 1歳ずつ振ると、最初に足りる年齢が境目
    const scan: number[] = [];
    for (let age = s.min; age <= s.max; age++) if (ok("0.04", age)) scan.push(age);
    expect(got[2]!.age).toBe(scan[0]);
    // 今のプラン（60歳・4%）は境目より若いので、結果の見出しと同じく「最後まで足りない」
    const now = forEngine(applyValues(o.wh, {}, o.cat));
    expect(lastsToEnd(now, preview(now))).toBe(false);
  }, 120_000);

  it("ますの要求は、AI接続口の plan_changes（働く最後の年齢・運用の利回り）を当てた要求と同じ", () => {
    const o = open("salariedCoupleTwoKids");
    const self = o.cat.selfId;
    const req = modelHousehold("salariedCoupleTwoKids");
    for (const [rate, age] of [
      ["0.02", 64],
      ["0.06", 58],
    ] as const) {
      const out = JSON.parse(
        connectorApplyPlan(
          JSON.stringify(req),
          JSON.stringify([
            { target: self, item: "employment.to", value: age },
            { target: "assumptions", item: "assumptions.returnShifts", value: rate },
          ]),
          JSON.stringify({ args: { sampleId: "salariedCoupleTwoKids" }, office: null }),
        ),
      ) as { status: string; request: EngineRequest };
      expect(out.status).toBe("ok");
      expect(applyValues(o.wh, cellValues({}, rate, age), o.cat).input).toEqual(out.request.input);
    }
  });

  it("選んでいるプランの値に重ねる: プランで動かした生活費はそのまま、利回りと年齢だけをますの値にする", async () => {
    const o = open("salariedCoupleTwoKids");
    const plan: Values = { "lever:livingMonthly": 300_000, "inv:rate": "0.03", "lever:retireAge": 63 };
    const s = thresholdSetup(o.wh, o.cat, plan) as ThresholdSetup;
    expect(s).toMatchObject({ rate: "0.03", age: 63 });
    expect(s.rates).toEqual(["0.01", "0.02", "0.03", "0.04", "0.05"]);
    const v = cellValues(plan, "0.05", 61);
    expect(v).toEqual({ "lever:livingMonthly": 300_000, "inv:rate": "0.05", "lever:retireAge": 61 });
    expect(currentText(s, "プランB")).toBe("今のプラン（プランB）は 利回り3%・63歳まで働く");
  });

  it("どの年齢でも足りない列は「75歳まで働いても足りません」（計算は両端の2回）", async () => {
    const o = open("survivorEmployeeLoan");
    const s = thresholdSetup(o.wh, o.cat, {}) as ThresholdSetup;
    expect(s.max).toBe(75);
    const got = (await findThresholds(s, realJudge(o))) as ColumnAnswer[];
    expect(got.every((a) => a.kind === "none" && a.computed === 2)).toBe(true);
    expect(answerText(got[0] as ColumnAnswer, s)).toBe("75歳まで働いても足りません");
  }, 120_000);

  it("いちばん若い年齢でも足りる列は「○歳でも足ります」（○はスライダーの下の端。今の年齢の次）", async () => {
    const o = open("sampleSeniorCouple");
    const s = thresholdSetup(o.wh, o.cat, {}) as ThresholdSetup;
    const self = o.wh.request.input.household.members.find((m) => m.kind === "self")!;
    expect(s.min).toBe(Math.max(50, ageAt(self, o.wh.request.input.baseMonth) + 1));
    const got = (await findThresholds(s, realJudge(o))) as ColumnAnswer[];
    expect(got.every((a) => a.kind === "edge" && a.age === s.min && a.computed === 2)).toBe(true);
    expect(answerText(got[0] as ColumnAnswer, s)).toBe(`${s.min}歳でも足ります`);
  }, 120_000);
});

describe("出さない世帯", () => {
  it("勤めの終わりが無い（対策に「働く最後の年齢」が出ない）世帯", () => {
    const o = open("single25");
    expect(o.cat.byKey.has("lever:retireAge")).toBe(false);
    expect(thresholdSetup(o.wh, o.cat, {})).toBeNull();
  });
  it("勤め・事業の収入が無い世帯（年金暮らし）", () => {
    const o = open("pensionCouple");
    expect(thresholdSetup(o.wh, o.cat, {})).toBeNull();
  });
  it("もう退職している（働き方の期間が計算基準月より前に終わっている）", () => {
    const o = open("sampleSingle40s", (req) => {
      const self = req.input.household.members.find((m) => m.kind === "self")!;
      req.input.household.employmentPeriods = (req.input.household.employmentPeriods ?? []).map((e) => (e.member === self.id ? { ...e, to: { at: "2025-03" } } : e));
    });
    expect(o.cat.byKey.has("lever:retireAge")).toBe(true);
    expect(thresholdSetup(o.wh, o.cat, {})).toBeNull();
  });
  it("見本の棚の世帯は、どれも出す（どれも勤めか事業の終わりがある）", () => {
    for (const id of ["sampleCoupleNoKids", "sampleExecutive", "sampleFamilyDreams", "sampleOwnerCompany", "sampleParentsCare", "sampleSelfEmployedFamily", "sampleSeniorCouple", "sampleSeniorRental", "sampleSingle20s", "sampleSingle40s", "sampleSingleParent"]) {
      const o = open(id);
      expect(thresholdSetup(o.wh, o.cat, {}), id).not.toBeNull();
    }
  });
});

describe("見た目", () => {
  const setup: ThresholdSetup = { rates: ["0.01", "0.02", "0.03", "0.04", "0.05"], rate: "0.03", age: 65, min: 50, max: 75, self: "ご本人", spouse: "配偶者" };
  const answers: ColumnAnswer[] = [
    { rate: "0.01", kind: "none", age: null, computed: 2 },
    { rate: "0.02", kind: "found", age: 68, computed: 7 },
    { rate: "0.03", kind: "found", age: 64, computed: 7 },
    { rate: "0.04", kind: "found", age: 61, computed: 7 },
    { rate: "0.05", kind: "edge", age: 50, computed: 2 },
  ];
  const view = (p: Partial<Parameters<typeof ThresholdView>[0]> = {}) =>
    renderToString(h(ThresholdView, { setup, plan: "プランB", locked: false, open: true, onToggle: () => undefined, answers, used: null, onUse: () => undefined, ...p }));

  it("閉じているときは「足りる境目 ▸」の1行だけ（計算もしない）", () => {
    const html = renderToString(h(Threshold, { setup, judge: async () => [], plan: "プランB", locked: false, onUse: () => undefined }));
    expect(html).toContain("足りる境目");
    expect(html).toContain("▸");
    expect(html).not.toContain("<table");
    expect(html).toContain('aria-expanded="false"');
  });

  it("開くと見出し・利回りの行・年齢の行・今のプランの1行・配偶者の注。今のプランの列は太字の印", () => {
    const html = view();
    expect(html).toContain("最後まで足りる、いちばん早い「働く最後の年齢」");
    for (const t of ["1%", "2%", "3%", "4%", "5%", "75歳まで働いても足りません", "68歳", "64歳", "61歳", "50歳でも足ります"]) expect(html).toContain(t);
    expect(html).toContain("今のプラン（プランB）は 利回り3%・65歳まで働く");
    expect(html).toContain("配偶者の働く年齢は今のままです（動かすのはご本人だけ）");
    // 利回りの見出しと年齢のますの2つ
    expect(html.match(/class="th-now"/g)?.length).toBe(2);
    // 足りない列は押せない（年齢が無い）。ほかの4列は押せる
    expect(html.match(/data-th-use=/g)?.length).toBe(4);
    expect(html).toContain("列を押すと、その利回りと年齢を対策に入れて比較できます（元に戻すで戻せます）");
    expect(html).not.toMatch(/比べ|札|カード/);
  });

  it("配偶者がいない世帯は配偶者の注を出さない", () => {
    expect(view({ setup: { ...setup, spouse: null } })).not.toContain("働く年齢は今のまま");
  });

  it("現状・基準のプランを選んでいるときは、表は出すが列は押せない（注で言う）", () => {
    const html = view({ locked: true });
    expect(html).not.toContain("data-th-use=");
    expect(html).toContain("列を押して対策に入れるのは、動かせるプランを選んだときです");
  });

  it("計算している間は「計算しています…」。押した列の答えのままなら「対策に入れました」", () => {
    expect(view({ answers: null }).match(/計算しています…/g)?.length).toBe(5);
    expect(view({ used: { rate: "0.04", age: 61 } })).toContain("対策に入れました: 働く最後の年齢 61歳・運用の利回り 年4%");
    expect(view({ used: { rate: "0.04", age: 62 } })).not.toContain("対策に入れました");
  });
});
