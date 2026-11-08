// 返ってきたシートの率の欄（住宅ローンの金利）: Excel で「0.625%」と打つと、値を 0.00625 にしてパーセントの書式を付ける。
// 書式を見て 0.625% と読む。書式が取れない（ほかのソフトで保存し直した・小数で打った）ときは、率の欄ごとにあり得る範囲で見分け、
// 怪しい値は知らせて要確認にする（黙って使わない）
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { importHearingSheet } from "../src/index.ts";
import { answerCells, type SheetDefinition } from "../src/definition.ts";
import { rateDoubt } from "../src/values.ts";
import { basic, editXlsx, full4, HEARING_DIR, setCell, setNumberFormat } from "./helpers.ts";

const ANS = "xl/worksheets/sheet2.xml";
const cases: [string, () => SheetDefinition][] = [
  ["full-4", full4],
  ["basic-1", basic],
];

for (const [name, defOf] of cases) {
  const def = defOf();
  const rowOf = (key: string, index?: number) => answerCells(def).find((c) => c.key === key && c.index === index)?.row as number;
  const sample = () => new Uint8Array(readFileSync(join(HEARING_DIR, "samples", `${name}-sample.xlsx`)));
  const ref = `C${rowOf("hs.loan.rate", 1)}`;
  const withRate = async (xml: string, fmt?: number | string) =>
    importHearingSheet(
      await editXlsx(sample(), (f) => {
        setCell(f, ANS, ref, xml);
        if (fmt !== undefined) setNumberFormat(f, ANS, ref, fmt);
      }),
      { baseMonth: "2026-10" },
    );
  const rateOf = (r: Awaited<ReturnType<typeof withRate>>) => {
    if (!r.ok) throw new Error("取り込めない");
    const debt = (r.request.input.household.debts ?? []).find((d) => d.kind === "mortgage") as unknown as { rateSchedule: { rate: string }[] };
    return debt.rateSchedule[0]?.rate;
  };
  const doubts = (r: Awaited<ReturnType<typeof withRate>>) => (r.ok ? { issues: r.issues.filter((i) => i.key === "hs.loan.rate" && i.level === "warning"), checklist: r.checklist.filter((c) => c.key === "hs.loan.rate" && c.reason === "review"), review: r.candidates.some((c) => c.status === "needsReview" && c.fields.some((x) => x.key === "hs.loan.rate")) } : null);

  describe(`${name}: 住宅ローンの金利の欄`, () => {
    it("Excel で「0.625%」と打ったセル（値 0.00625・パーセントの書式）を 0.625% と読む。知らせは出さない", async () => {
      for (const fmt of [10, 9, "0.000%"]) {
        const r = await withRate("<c><v>0.00625</v></c>", fmt);
        expect(rateOf(r), String(fmt)).toBe("0.00625");
        expect(doubts(r)?.issues, String(fmt)).toEqual([]);
        expect(doubts(r)?.review, String(fmt)).toBe(false);
      }
      // Excel が保存する形（2進の浮動小数点を 17 桁で書いた数）も、見えている桁で読む
      expect(rateOf(await withRate("<c><v>6.2500000000000003E-3</v></c>", 10))).toBe("0.00625");
      expect(rateOf(await withRate("<c><v>1.4750000000000001</v></c>"))).toBe("0.01475");
    });

    it("書式の無い数「0.625」はそのまま % の数として読む（今までどおり）", async () => {
      const r = await withRate("<c><v>0.625</v></c>");
      expect(rateOf(r)).toBe("0.00625");
      expect(doubts(r)?.issues).toEqual([]);
    });

    it("書式が取れない 0.00625 は、あり得る範囲より小さいので知らせて要確認にする（黙って使わない）", async () => {
      const r = await withRate("<c><v>0.00625</v></c>");
      const d = doubts(r);
      expect(d?.issues.length).toBe(1);
      expect(d?.issues[0]?.message).toContain("0.00625%");
      expect(d?.checklist.length).toBe(1);
      expect(d?.review).toBe(true);
    });

    it("パーセントの書式でも、読んだ率が小さすぎれば知らせる（「0.00625%」と打った）", async () => {
      const r = await withRate("<c><v>0.0000625</v></c>", 10);
      expect(rateOf(r)).toBe("0.0000625");
      expect(doubts(r)?.issues.length).toBe(1);
    });

    it("0% は知らせない（金利の無い借入れ）", async () => {
      const r = await withRate("<c><v>0</v></c>");
      expect(doubts(r)?.issues).toEqual([]);
    });
  });
}

describe("率の欄のあり得る範囲", () => {
  it("率の欄（percent）は 0.05% より小さい正の値を怪しいとみる。0 と範囲の中は怪しくない", () => {
    const item = full4().items.find((i) => i.key === "hs.loan.rate")!;
    expect(rateDoubt(item, "0.0000625")).not.toBeNull();
    expect(rateDoubt(item, "0.000499")).not.toBeNull();
    expect(rateDoubt(item, "0.0005")).toBeNull();
    expect(rateDoubt(item, "0.00625")).toBeNull();
    expect(rateDoubt(item, "0")).toBeNull();
    expect(rateDoubt(item, "0.2")).toBeNull();
  });

  it("シート定義の率の欄（percent）は、どの版も範囲の決まりを持つ", () => {
    for (const def of [basic(), full4()]) for (const item of def.items.filter((i) => i.type === "percent")) expect(rateDoubt(item, "0.00001"), item.key).not.toBeNull();
  });
});
