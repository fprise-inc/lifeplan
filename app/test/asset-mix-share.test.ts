// 口座ごとの資産の配分の割合（0177）: 合計が100%でなくても計算は合計で割って按分する（1行だけならその資産クラスが100%）。
// 合計が100%でないときは、最初の行の割合の欄と確かめの一覧に知らせを出し、「合計を100%にする」で按分した割合に書き直せる
import { describe, expect, it } from "vitest";
import type { EngineRequest, TableCell } from "../src/engine/types.ts";
import { checkList } from "../src/workspace/input/checkRows.ts";
import { allFields, type FieldDef } from "../src/workspace/input/form.ts";
import { fromRequest, mutate, type WorkingHousehold } from "../src/workspace/input/household.ts";
import { expectedReturn } from "../src/workspace/plans/allocation.ts";
import { buildStage } from "../src/workspace/input/stages/index.ts";
import { modelHousehold, preview } from "./helpers.ts";

const ACC = "7fc64cf7-e50e-46f3-89f3-839d360b0667"; // dualAssetsTwoKids の課税口座（国内株式70%・国内債券30%）
type Mix = { assetClass: string; share: string }[];

function withMix(mix: Mix): EngineRequest {
  const req = structuredClone(modelHousehold("dualAssetsTwoKids"));
  (req.input.household.accounts!.find((x) => x.id === ACC) as { assetMix: Mix }).assetMix = mix;
  return req;
}
const balance2050 = (req: EngineRequest) => (preview(req).table as TableCell[]).filter((c) => c.object === ACC && c.row.startsWith("cf.balance") && c.year === 2050).reduce((s, c) => s + c.amount, 0);
const eq = (s: string) => ({ assetClass: "equity.domestic", share: s });
const bd = (s: string) => ({ assetClass: "bond.domestic", share: s });
const shareField = (w: WorkingHousehold): FieldDef => allFields(buildStage("savings", w)).find((f) => f.key.endsWith(`/mix/0/share`) && f.key.includes(ACC)) as FieldDef;

describe("計算: 割合は合計で割って按分する", () => {
  it("合計120%（70%を90%に打ち直しただけ）は 75%・25% と同じ", () => {
    expect(balance2050(withMix([eq("0.9"), bd("0.3")]))).toBe(balance2050(withMix([eq("0.75"), bd("0.25")])));
  });
  it("1行だけ50%は、0%の行を足したものと同じ（どちらも国内株式100%）", () => {
    expect(balance2050(withMix([eq("0.5")]))).toBe(balance2050(withMix([eq("0.5"), bd("0")])));
    expect(balance2050(withMix([eq("0.5")]))).toBe(balance2050(withMix([eq("1")])));
  });
  it("画面の利回りの目安もエンジンと同じ按分", () => {
    const req = withMix([eq("0.9"), bd("0.3")]);
    const norm = withMix([eq("0.75"), bd("0.25")]);
    const acc = (r: EngineRequest) => r.input.household.accounts!.find((x) => x.id === ACC)!;
    expect(expectedReturn(req, acc(req), 2030)).toBe(expectedReturn(norm, acc(norm), 2030));
  });
});

describe("入力: 合計が100%でないときの知らせ", () => {
  it("合計120%: 欄の下と確かめの一覧に知らせ。押すと按分した割合（75%・25%）に直す", () => {
    const w = fromRequest(withMix([eq("0.9"), bd("0.3")]));
    const st = shareField(w).get(w);
    expect(st.warn).toContain("合計が120%");
    expect(st.warn).toContain("国内株式75%");
    const rows = checkList(w).filter((r) => r.id.includes(ACC) && r.kind === "notice");
    expect(rows).toHaveLength(1);
    const fixed = st.warnFix!.run(w);
    // 直しても行の ID（0206）は変わらない
    const ids = w.request.input.household.accounts!.find((x) => x.id === ACC)!.assetMix!.map((m) => m.id);
    expect(ids.every((id) => typeof id === "string")).toBe(true);
    expect(fixed.request.input.household.accounts!.find((x) => x.id === ACC)!.assetMix).toEqual([{ ...eq("0.75"), id: ids[0] }, { ...bd("0.25"), id: ids[1] }]);
    expect(shareField(fixed).get(fixed).warn ?? null).toBeNull();
  });
  it("1行だけ50%: 知らせを出す（計算は100%）。合計100%なら知らせなし", () => {
    const one = fromRequest(withMix([eq("0.5")]));
    expect(shareField(one).get(one).warn).toContain("合計が50%");
    const ok = fromRequest(withMix([eq("0.7"), bd("0.3")]));
    expect(shareField(ok).get(ok).warn ?? null).toBeNull();
  });
  it("2行目を足した直後（0%）は合計100%のままで知らせなし。2行目を直すと知らせ", () => {
    let w = fromRequest(withMix([eq("1")]));
    w = mutate(w, (h) => void h.accounts!.find((x) => x.id === ACC)!.assetMix!.push(bd("0")));
    expect(shareField(w).get(w).warn ?? null).toBeNull();
    w = mutate(w, (h) => void (h.accounts!.find((x) => x.id === ACC)!.assetMix![1]!.share = "0.3"));
    expect(shareField(w).get(w).warn).toContain("合計が130%");
  });
});
