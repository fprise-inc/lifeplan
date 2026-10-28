// 子の呼び方（0046 の追記 2026-10-28）: 番号は世帯の中の子（一緒に暮らす子）だけで「第1子」「第2子」…。
// 世帯の外の子は「離れて暮らす子」（2人以上なら生まれた順に「離れて暮らす子1」…）。呼び名を入れればそれを添える。
// 画面（呼び方・時点の読み）・結果（年齢の行・収入の行）・帳票でそろう
import { describe, expect, it } from "vitest";
import { roles as reportRoles } from "../../report/src/build.ts";
import { allFields, type FieldDef } from "../src/workspace/input/form.ts";
import { blankHousehold, type WorkingHousehold } from "../src/workspace/input/household.ts";
import { memberLabel } from "../src/workspace/input/labels.ts";
import { whenPeople } from "../src/workspace/input/namedEvents.ts";
import { addMember } from "../src/workspace/input/stages/family.ts";
import { addOutside } from "../src/workspace/input/stages/care.ts";
import { buildStage } from "../src/workspace/input/stages/index.ts";
import { familyText } from "../src/workspace/present.ts";
import { outsideName } from "../src/workspace/resultRows.ts";
import { roles } from "../src/workspace/roles.ts";

const BASE = "2026-10";
let n = 0;
const ids = () => () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`;

function fieldOf(wh: WorkingHousehold, stage: "family" | "care", key: string): FieldDef {
  const f = allFields(buildStage(stage, wh)).find((x) => x.key === key);
  if (f === undefined) throw new Error(`欄が無い: ${key}`);
  return f;
}

/** 夫婦・世帯の中の子2人（2016・2020年生まれ）・世帯の外の子（births の年の4月生まれ） */
function household(births: readonly string[]): { wh: WorkingHousehold; inside: string[]; apart: string[] } {
  let wh = blankHousehold(BASE, ids());
  const self = wh.request.input.household.members[0]!;
  wh = fieldOf(wh, "family", `family/${self.id}/birth`).set(wh, "1980-06");
  wh = addMember(wh, "spouse", ids());
  wh = addMember(wh, "child", ids());
  wh = addMember(wh, "child", ids());
  const kids = wh.request.input.household.members.filter((m) => m.kind === "child");
  wh = fieldOf(wh, "family", `family/${kids[0]!.id}/birth`).set(wh, "2020-04");
  wh = fieldOf(wh, "family", `family/${kids[1]!.id}/birth`).set(wh, "2016-04");
  for (const b of births) {
    const before = new Set(wh.request.input.household.members.map((m) => m.id));
    wh = addOutside(wh, "child");
    const added = wh.request.input.household.members.find((m) => !before.has(m.id))!;
    wh = fieldOf(wh, "care", `family/${added.id}/birth`).set(wh, b);
  }
  const ms = wh.request.input.household.members;
  return {
    wh,
    inside: [kids[1]!.id, kids[0]!.id],
    apart: births.map((b) => ms.find((m) => m.kind === "child" && m.outside !== undefined && m.birth.birthYearMonth === b)!.id),
  };
}

describe("子の呼び方: 番号は世帯の中の子だけ、世帯の外の子は「離れて暮らす子」", () => {
  it("世帯の外の子が上に生まれていても、世帯の中の子は第1子・第2子。世帯の外の子が1人なら番号を付けない", () => {
    const { wh, inside, apart } = household(["2008-04"]);
    expect(memberLabel(wh, inside[0])).toBe("第1子");
    expect(memberLabel(wh, inside[1])).toBe("第2子");
    expect(memberLabel(wh, apart[0])).toBe("離れて暮らす子");
    // 並びと鍵は生まれた順のまま（鍵は提示用で、呼び方と別）
    expect(roles(wh.request).filter((r) => r.member.kind === "child").map((r) => [r.key, r.label])).toEqual([
      ["child1", "離れて暮らす子"],
      ["child2", "第1子"],
      ["child3", "第2子"],
    ]);
  });

  it("世帯の外の子が2人以上なら、生まれた順に離れて暮らす子1・離れて暮らす子2。呼び名を入れればそれを添える", () => {
    const { wh, inside, apart } = household(["2010-04", "2006-04"]);
    expect(memberLabel(wh, apart[1])).toBe("離れて暮らす子1");
    expect(memberLabel(wh, apart[0])).toBe("離れて暮らす子2");
    expect(memberLabel(wh, inside[0])).toBe("第1子");
    const w2 = fieldOf(wh, "care", `family/${apart[1]!}/nickname`).set(wh, "前の結婚の子");
    expect(memberLabel(w2, apart[1])).toBe("離れて暮らす子1（前の結婚の子）");
    // 帳票の呼び方も同じ
    expect(reportRoles(wh.request).filter((r) => r.member.kind === "child").map((r) => r.label)).toEqual(["離れて暮らす子1", "離れて暮らす子2", "第1子", "第2子"]);
  });

  it("結果: 年齢の行・収入の行の呼び方（世帯の外の家族の呼び方）も離れて暮らす子。家族の年齢の文字も同じ", () => {
    const { wh, apart } = household(["2010-04", "2006-04"]);
    const m = (id: string) => wh.request.input.household.members.find((x) => x.id === id)!;
    expect(outsideName(wh.request, m(apart[1]!))).toBe("離れて暮らす子1");
    expect(outsideName(wh.request, m(apart[0]!))).toBe("離れて暮らす子2");
    const text = familyText(roles(wh.request), 2030);
    expect(text).toContain("第1子14歳");
    expect(text).not.toContain("第3子");
  });

  it("時点の読み: 「第1子」は世帯の中の上の子、「離れて暮らす子1」は世帯の外の上の子を指す", () => {
    const { wh, inside, apart } = household(["2010-04", "2006-04"]);
    const people = whenPeople(wh);
    const who = (name: string) => people.filter((p) => p.names.includes(name)).map((p) => p.id);
    expect(who("第1子")).toEqual([inside[0]]);
    expect(who("第2子")).toEqual([inside[1]]);
    expect(who("離れて暮らす子1")).toEqual([apart[1]]);
    expect(who("離れて暮らす子2")).toEqual([apart[0]]);
    expect(who("第3子")).toEqual([]);
  });

  it("世帯の外の子がいなければ今までどおり（第1子・第2子）", () => {
    const { wh, inside } = household([]);
    expect(roles(wh.request).filter((r) => r.member.kind === "child").map((r) => r.label)).toEqual(["第1子", "第2子"]);
    expect(memberLabel(wh, inside[1])).toBe("第2子");
  });
});
