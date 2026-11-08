// 文と丸めの直し（0169）:
// - 入力の欄の金額の文（プランの差分・「現状:」）は、10万円以上の端数を対策の値の文と同じ万円の小数1桁にする（H6-013）
// - 事業所得の「?」: 青色申告特別控除の前の額を写すことと、申告書の所得金額をそのまま写すと控除を2回引くこと（H6-011）
// - 前の言葉が残っていた所（H7-006）
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { fieldText, leverValueText } from "../src/workspace/plans/items.ts";
import type { FieldDef } from "../src/workspace/input/form.ts";

const src = (p: string) => readFileSync(new URL(`../src/${p}`, import.meta.url), "utf8");
const yenField = (basis: "monthly" | "annual") => ({ key: "k", label: "l", kind: "yen", basis }) as unknown as FieldDef;

describe("金額の欄の文の丸め（H6-013）", () => {
  it("同じ値は対策の基準と同じ桁（月20.9万円）", () => {
    expect(fieldText(yenField("monthly"), 209000)).toBe("月20.9万円");
    expect(fieldText(yenField("monthly"), 209000)).toBe(leverValueText("livingMonthly", 209000));
    expect(fieldText(yenField("annual"), 1234567)).toBe("年123.5万円");
  });
  it("万円ちょうどと10万円未満は今までどおり", () => {
    expect(fieldText(yenField("monthly"), 210000)).toBe("月21万円");
    expect(fieldText(yenField("monthly"), 45000)).toBe("月45,000円");
  });
});

describe("文の直し（H6-011・H7-006）", () => {
  it("事業所得の「?」は控除の前の額で、申告書の額をそのまま写すと2回引くと書く", () => {
    const work = src("workspace/input/stages/work.ts");
    expect(work).not.toContain("確定申告書の所得金額（青色申告特別控除の前）");
    expect(work).toContain("そのまま写すと控除を2回引きます");
  });
  it("前の言葉を使わない", () => {
    expect(src("workspace/input/stages/work.ts")).not.toContain("この期間の伸び（年率）");
    expect(src("workspace/office/estimateCatalog.ts")).not.toContain("家賃の変動率（年）");
    expect(src("workspace/input/defaultMark.ts")).not.toContain("推定と同じ値を書き戻しても確定にしない");
  });
});
