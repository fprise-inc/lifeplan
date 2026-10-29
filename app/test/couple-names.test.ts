// 本人・配偶者の呼び方（0012 の追記 2026-10-29）: 性別によらず、本人は「ご本人」、配偶者は「配偶者」。
// 画面（呼び方・時点の読み）・帳票でそろう。性別の値はそのまま持つ（年金・平均余命などの計算に使う）
import { describe, expect, it } from "vitest";
import { roles as reportRoles } from "../../report/src/build.ts";
import { blankHousehold, type WorkingHousehold } from "../src/workspace/input/household.ts";
import { memberLabel } from "../src/workspace/input/labels.ts";
import { whenPeople } from "../src/workspace/input/namedEvents.ts";
import { addMember } from "../src/workspace/input/stages/family.ts";
import { roles } from "../src/workspace/roles.ts";

let n = 0;
const ids = () => () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`;

function couple(selfSex: "male" | "female", spouseSex: "male" | "female"): WorkingHousehold {
  const wh = addMember(blankHousehold("2026-10", ids()), "spouse", ids());
  const members = wh.request.input.household.members.map((m) => (m.kind === "self" ? { ...m, sex: selfSex } : m.kind === "spouse" ? { ...m, sex: spouseSex } : m));
  return { ...wh, request: { ...wh.request, input: { ...wh.request.input, household: { ...wh.request.input.household, members } } } };
}

describe("本人・配偶者の呼び方は性別によらない", () => {
  for (const [a, b] of [["male", "female"], ["female", "male"], ["female", "female"], ["male", "male"]] as const) {
    it(`本人が${a === "male" ? "男性" : "女性"}・配偶者が${b === "male" ? "男性" : "女性"}`, () => {
      const wh = couple(a, b);
      const h = wh.request.input.household;
      const self = h.members.find((m) => m.kind === "self")!;
      const spouse = h.members.find((m) => m.kind === "spouse")!;
      expect(self.sex).toBe(a);
      expect(spouse.sex).toBe(b);
      expect(roles(wh.request).map((r) => r.label)).toEqual(["ご本人", "配偶者"]);
      expect(reportRoles(wh.request).map((r) => r.label)).toEqual(["ご本人", "配偶者"]);
      expect(memberLabel(wh, self.id)).toBe("ご本人");
      expect(memberLabel(wh, spouse.id)).toBe("配偶者");
      const people = whenPeople(wh);
      expect(people.find((p) => p.id === self.id)?.label).toBe("ご本人");
      expect(people.find((p) => p.id === spouse.id)?.label).toBe("配偶者");
    });
  }

  it("1人の世帯の本人も「ご本人」", () => {
    const wh = blankHousehold("2026-10", ids());
    expect(roles(wh.request).map((r) => r.label)).toEqual(["ご本人"]);
  });
});
