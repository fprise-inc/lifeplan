// 対応範囲の一覧（docs/coverage。0183）: 形と参照が正しく、書いたときの部品の revision が今の部品と同じこと（部品を直したら一覧を見直す）
import { describe, expect, it } from "vitest";
import { OFFICIAL_DEFINITIONS } from "../src/components/index.ts";
import { componentRefs, loadCoverage } from "../scripts/coverage.ts";

const list = loadCoverage();
const entries = list.areas.flatMap((a) => a.entries);

describe("対応範囲の一覧（0183）", () => {
  it("形・参照（入力項目ID・制度の値ID・表の行ID・部品・関係する項目）が正しい", () => {
    expect(list.format).toBe("financia.coverage");
    expect(list.version).toMatch(/^[0-9a-f]{12}$/);
    expect(entries.length).toBeGreaterThanOrEqual(60);
  });

  it("書いたときの部品の revision が今の部品と同じ（部品の revision を上げたら、その部品を書いた項目を見直して数を合わせる）", () => {
    const now = new Map(OFFICIAL_DEFINITIONS.map((d) => [d.id, d.revision]));
    const stale = componentRefs(list)
      .filter((r) => now.get(r.component) !== r.revision)
      .map((r) => `${r.entry}: ${r.component} は一覧では revision ${r.revision}、今は ${now.get(r.component) ?? "（無い）"}`);
    expect(stale, `計算の部品が変わりました。docs/coverage の次の項目の説明が今の計算と合っているかを見直し、components の数を今の revision にしてください:\n${stale.join("\n")}`).toEqual([]);
  });

  it("よく聞かれる話題が入っている", () => {
    const words = entries.map((e) => [e.title, ...e.keywords].join(" "));
    for (const w of ["高額療養費", "iDeCo", "退職所得控除", "児童手当", "住宅ローン控除", "遺族年金", "相続税", "所得金額調整控除", "在職老齢年金"]) {
      expect(
        words.some((x) => x.includes(w)),
        w,
      ).toBe(true);
    }
  });

  it("3つの状態がそろっていて、まだ入っていない物も書いてある", () => {
    for (const s of ["included", "approximated", "notYet"]) expect(entries.some((e) => e.status === s)).toBe(true);
  });
});
