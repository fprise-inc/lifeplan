// 値の状態の直し（0041 の追記 2026-10-27）: 未入力の欄に打った値は0円でも確定・空欄のまま推定で計算する欄の「この値にする」と
// 「推定の値をまとめて使う」は推定の値を書いて確定・確定にできない推定（決まりの推定）は数えない
import { h } from "preact";
import { renderToString } from "preact-render-to-string";
import { describe, expect, it } from "vitest";
import { checkList, confirmAllEstimates, estimatedFields } from "../src/workspace/input/checkRows.ts";
import { Field, FieldStateOps, shouldCommitOnBlur } from "../src/workspace/input/FieldViews.tsx";
import { allFields, type FieldDef } from "../src/workspace/input/form.ts";
import { fromRequest, standardBox, type WorkingHousehold } from "../src/workspace/input/household.ts";
import { inputItems, itemStage } from "../src/workspace/input/items.ts";
import { applyStateOp, availableOps, fieldStatus, typeValue } from "../src/workspace/input/valueState.ts";
import { forEngine } from "../src/engine/moneyRows.ts";
import { modelHousehold, preview } from "./helpers.ts";

const open = (id: string) => fromRequest(modelHousehold(id));
const fields = (wh: WorkingHousehold): FieldDef[] => inputItems(wh).flatMap((i) => {
  const s = itemStage(wh, i.id);
  return s === null ? [] : allFields(s);
});

/** 値の入った円の値の箱の欄を1つ選び、「未入力（0円で計算中）」の印の0円にした世帯 */
function unentered(): { wh: WorkingHousehold; f: FieldDef } {
  const wh0 = open("salariedCoupleTwoKids");
  const f = fields(wh0).find((x) => x.boxed !== undefined && x.kind === "yen" && x.readOnly === undefined && typeof x.get(wh0).value === "number")!;
  const wh = f.boxed!.write(wh0, standardBox(0, "未入力（額を入れてください。0円で計算中）") as unknown as Record<string, unknown>);
  expect(fieldStatus(f, wh).status).toBe("missing");
  return { wh, f };
}

describe("未入力の欄に打った値は、0円でも確定にする", () => {
  it("打って入れる（typeValue）: 未入力の0円に0を打つと確定。欄の書き方（set）は同じ値なので変えない", () => {
    const { wh, f } = unentered();
    expect(f.set(wh, 0)).toBe(wh);
    const typed = typeValue(f, wh, 0);
    expect(fieldStatus(f, typed).status).toBe("confirmed");
    expect(f.boxed!.read(typed)).toMatchObject({ value: 0, state: "confirmed", origin: { kind: "manual" } });
    // 打った確定（根拠なし）なので、「この値にする」の確定と見分けられる
    expect(fieldStatus(f, typed).explicit).toBe(false);
  });

  it("未入力でない欄は今までどおり（推定・確定の欄に同じ値を打っても変えない）", () => {
    const { wh, f } = unentered();
    const est = f.boxed!.write(wh, standardBox(50000, "目安") as unknown as Record<string, unknown>);
    expect(typeValue(f, est, 50000)).toBe(est);
    const conf = typeValue(f, wh, 70000);
    expect(typeValue(f, conf, 70000)).toBe(conf);
  });

  it("欄の部品: 未入力の欄は空で見せる（入って離れるだけ・同じ文字は書かないまま）", () => {
    const { wh, f } = unentered();
    const html = renderToString(h(FieldStateOps.Provider, { value: (w: WorkingHousehold, x: FieldDef, op) => applyStateOp(w, x, op) }, h(Field, { f, wh, onEdit: () => undefined })));
    expect(html).toMatch(/ value[ />]/);
    expect(html).not.toMatch(/value="0"/);
    // 灰色の入力例は欄に収まる短い言葉（0円で計算中であることは「未入力」の印を押すと開く。0077）
    expect(html).toContain('placeholder="未入力"');
    // 入ったときの文字は空。空のまま離れたら書かない。0 を打って離れたら書く
    expect(shouldCommitOnBlur("", "")).toBe(false);
    expect(shouldCommitOnBlur("", "0")).toBe(true);
  });
});

describe("空欄のまま推定で計算する欄の確定", () => {
  const wh = open("investmentCouple");
  const blank = fields(wh).filter((f) => f.blankEstimate !== undefined && fieldStatus(f, wh).status === "estimated" && f.get(wh).value === null);

  it("iDeCo の受け取り方・受け取りを始める年齢は「この値にする」で推定の値を書いて確定になり、計算の結果は変わらない", () => {
    const payout = blank.filter((f) => /\/payout(Age)?$/.test(f.key));
    expect(payout.length).toBeGreaterThan(1);
    let w = wh;
    for (const f of payout) {
      expect(availableOps(f, w)).toContain("confirm");
      const next = applyStateOp(w, f, "confirm");
      expect(next).not.toBe(w);
      expect(fieldStatus(f, next).status).toBe("confirmed");
      expect(f.get(next).value).not.toBeNull();
      w = next;
    }
    expect(preview(forEngine(w.request)).table).toEqual(preview(forEngine(wh.request)).table);
  });

  it("「推定の値をまとめて使う」は、空欄が推定の欄も確定にする", () => {
    const r = confirmAllEstimates(wh);
    for (const f of blank) {
      // 数えない推定（学校の種類で決まる統計の平均。quietEstimate）はまとめて確定にしない（0062 の追記 2026-10-31）
      const stays = f.blankEstimate!(wh) === null || f.quietEstimate !== undefined;
      expect(fieldStatus(f, r.wh).status === "estimated", f.key).toBe(stays);
    }
  });

  it("推定が値でなく決まりの欄（積立をやめる年齢の空欄）は確定にできないので、操作も数も出さない", () => {
    const stop = fields(wh).find((f) => f.key === "sav/stopAge")!;
    expect(fieldStatus(stop, wh).status).toBe("estimated");
    expect(availableOps(stop, wh)).not.toContain("confirm");
    const row = checkList(wh).find((x) => x.fieldKey === "sav/stopAge");
    expect(row?.kind).toBe("estimated");
    expect(row?.actions).toEqual([]);
    expect(estimatedFields(wh).some((f) => f.key === "sav/stopAge")).toBe(true);
  });
});
