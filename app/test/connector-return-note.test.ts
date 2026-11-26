// AI接続口の表・グラフの前提の注の「運用利回り 年1%（資産ごとの指定が無いもの）」（0260 の追記 2026-11-26）:
// 提案書の前提の一覧と同じく、その率を計算に使う物（配分も利回りも入れていない運用の口座・資産の種類ごとの利回りが空欄の配分の種類・
// 保険の貯蓄型・必要保障額の逆算方式など）がある通りだけ書く。判定は1つの関数（engine/src/sdk/returnUse.ts の investmentReturnUsed）。
// 表は通りの要求を受け取るので table.ts の中で、グラフは名前と数字しか受け取らないので、接続口（chart.rs）が returnUsed で決めて
// 使わない通りには運用利回りを渡さない（ここでは returnUsed の答えと、渡さないときの注を確かめる）
import { describe, expect, it } from "vitest";
import { investmentReturnUsed } from "../../engine/src/sdk/returnUse.ts";
import { chartNotes, returnUsed, type ChartArgs, type ChartVariant } from "../src/connector/chart.ts";
import { table, type TableArgs, type TableOut, type TableVariant } from "../src/connector/table.ts";
import { forEngine } from "../src/engine/moneyRows.ts";
import type { EngineRequest } from "../src/engine/types.ts";
import { modelHousehold, preview } from "./helpers.ts";

const reqOf = (id: string, edit?: (r: EngineRequest) => void): EngineRequest => {
  const r = structuredClone({ trace: "none", input: modelHousehold(id).input }) as EngineRequest;
  edit?.(r);
  return r;
};
const variantOf = (req: EngineRequest, label: string): TableVariant => {
  const r = preview(forEngine(req));
  return { label, request: req, result: { table: r.table, summary: r.summary } };
};
const make = (a: TableArgs) => JSON.parse(table(JSON.stringify(a), "", "")) as TableOut;
const premiseNote = (out: TableOut) => (out.notes ?? []).find((n) => n.startsWith("前提"));
const accounts = (r: EngineRequest) => r.input.household.accounts as unknown as { kind: string; expectedReturn?: string; assetMix?: unknown }[];

/** 口座にすべて利回りが入っている世帯（運用の利回りを使わない） */
const ALL_RATED = "investmentCouple";
/** 利回りを入れていない運用の口座がある世帯（運用の利回りを使う） */
const UNRATED = "single45";

describe("表・グラフの注の運用利回りは、その率を使う物があるときだけ（0260 の追記）", () => {
  it("見本の前提: 口座にすべて利回りを入れた世帯は使わない・利回りを入れていない口座のある世帯は使う", () => {
    expect(investmentReturnUsed(reqOf(ALL_RATED).input)).toBe(false);
    expect(investmentReturnUsed(reqOf(UNRATED).input)).toBe(true);
  });

  it("表: 使わない通りは運用利回りを書かず、使う通りは書く。通りで違えば通りごと", () => {
    const rated = variantOf(reqOf(ALL_RATED), "基本");
    const off = make({ variants: [rated], baseMonth: rated.request.input.baseMonth, rows: ["takeHome", "net"] });
    expect(off.status).toBe("ok");
    expect(premiseNote(off)).toMatch(/^前提\u3000物価上昇率 年[0-9.]+%$/);
    expect(off.text).not.toContain("運用利回り 年");
    // 相場の想定の文（「運用利回りは前提のまま」）は今のまま
    expect(off.notes).toContain("相場などの想定\u3000なし（運用利回りは前提のまま）");

    const unrated = variantOf(reqOf(UNRATED), "基本");
    const on = make({ variants: [unrated], baseMonth: unrated.request.input.baseMonth, rows: ["takeHome", "net"] });
    // 物価上昇率を省いた入力の表は物価を書かない（今のまま）
    expect(premiseNote(on)).toMatch(/^前提\u3000(物価上昇率 年[0-9.]+%・)?運用利回り 年[0-9.]+%（資産ごとの指定が無いもの）$/);

    // 同じ世帯で、空欄だった口座の利回りを FP が入れた通り（B）は書かない
    const filled = variantOf(
      reqOf(UNRATED, (r) => {
        for (const a of accounts(r)) if (a.expectedReturn === undefined && a.assetMix === undefined) a.expectedReturn = "0.03";
      }),
      "B",
    );
    expect(investmentReturnUsed(filled.request.input)).toBe(false);
    const both = make({ variants: [unrated, filled], baseMonth: unrated.request.input.baseMonth, rows: ["net"] });
    const n = premiseNote(both) ?? "";
    expect(n).toMatch(/^前提\u3000基本: (物価上昇率 年[0-9.]+%・)?運用利回り 年[0-9.]+%（資産ごとの指定が無いもの）／B: (物価上昇率 年[0-9.]+%|—)$/);
  });

  it("表: 入れ方の違い（資産の配分で種類ごとの利回りが空欄・逆算方式の必要保障額）でも、使う物があれば書く", () => {
    // 口座にすべて利回りが入った世帯でも、1つの口座を「資産の配分」にして、その種類の利回りを空欄にすると使う
    const mixed = reqOf(ALL_RATED, (r) => {
      const a = accounts(r).find((x) => x.expectedReturn !== undefined && x.kind !== "deposit");
      if (a === undefined) throw new Error("利回りの入った運用の口座がありません");
      delete a.expectedReturn;
      a.assetMix = [{ assetClass: "equity.global", share: "1" }];
      delete (r.input.assumptions as { assetReturns?: Record<string, unknown> }).assetReturns?.["equity.global"];
    });
    expect(investmentReturnUsed(mixed.input)).toBe(true);
    expect(premiseNote(make({ variants: [variantOf(mixed, "基本")], baseMonth: mixed.input.baseMonth, rows: ["net"] }))).toContain("運用利回り 年");
    // 逆算方式の必要保障額（遺族の金融資産を運用の利回りで伸ばす）
    const reverse = reqOf(ALL_RATED, (r) => void ((r.input as { protection?: unknown }).protection = { method: "reverse" }));
    expect(investmentReturnUsed(reverse.input)).toBe(true);
  });

  it("表: 計算の基準の月が1〜3月の世帯でも同じ判定（年の数え方で注は変わらない）", () => {
    for (const month of ["01", "03"]) {
      const r = reqOf(ALL_RATED, (x) => void (x.input.baseMonth = `${x.input.baseMonth.slice(0, 4)}-${month}`));
      const out = make({ variants: [variantOf(r, "基本")], baseMonth: r.input.baseMonth, rows: ["net"] });
      expect(out.status).toBe("ok");
      expect(premiseNote(out)).not.toContain("運用利回り");
    }
  });

  it("グラフ: returnUsed は通りごとの要求で同じ判定を返す（計算しなかった通り・読めない形は「使う」）", () => {
    const got = JSON.parse(returnUsed(JSON.stringify([reqOf(ALL_RATED), reqOf(UNRATED), null, { input: "x" }]), "", "")) as boolean[];
    expect(got).toEqual([false, true, true, true]);
    expect(JSON.parse(returnUsed("{}", "", ""))).toEqual([]);
  });

  it("グラフ: 運用利回りを渡さない通りは注に書かない（渡す通りは今までどおり）", () => {
    const years = [2027, 2028];
    const v = (label: string, assumptions: ChartVariant["assumptions"]): ChartVariant => ({ label, series: years.map((year) => ({ year, financialAssets: 100 })), keyFigures: {}, assumptions });
    const a: ChartArgs = { kind: "assets", baseMonth: "2026-10", variants: [v("基本", { inflation: { default: "0.01" } }), v("B", { inflation: { default: "0.01" }, investmentReturn: { default: "0.01" } })] };
    expect(chartNotes(a).find((x) => x.startsWith("前提"))).toBe("前提\u3000A: 物価上昇率 年1%／B: 物価上昇率 年1%・運用利回り 年1%（資産ごとの指定が無いもの）");
    const none: ChartArgs = { ...a, variants: [a.variants[0]!, { ...a.variants[0]!, label: "B" }] };
    expect(chartNotes(none).find((x) => x.startsWith("前提"))).toBe("前提\u3000物価上昇率 年1%");
  });
});
