// 家族の入力項目の見せ方（0141）: 2人目からの子の仮の生年月・続柄の選択肢・呼び名の例・欄の並び・関係の1行・加わる時期の1欄・
// 離れて暮らす子と仕送り・世帯の外の家族の一覧・ひとり親の世帯・打っている間に子を並び替えない（保存で並べる）・生年月の入力例と年齢
import { describe, expect, it } from "vitest";
import { allFields, type FieldDef, type StageDef, type Val } from "../src/workspace/input/form.ts";
import { blankHousehold, fromRequest, mutate, type WorkingHousehold } from "../src/workspace/input/household.ts";
import { addChildWithEducation, addMember, CHILD_SPACING_MONTHS, familyKindOptions, panelOrder, singleParent, sortChildrenByBirth, spouseRelations } from "../src/workspace/input/stages/family.ts";
import { addOutside } from "../src/workspace/input/stages/care.ts";
import { buildStage } from "../src/workspace/input/stages/index.ts";
import { memberLabel } from "../src/workspace/input/labels.ts";
import { addMonths } from "../src/workspace/levers.ts";
import { modelHousehold, preview } from "./helpers.ts";

const BASE = "2026-10";
let n = 0;
const ids = () => () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`;

const stage = (wh: WorkingHousehold): StageDef => buildStage("family", wh);
const fieldOf = (wh: WorkingHousehold, key: string): FieldDef => {
  const f = allFields(stage(wh)).find((x) => x.key === key);
  if (f === undefined) throw new Error(`欄が無い: ${key}`);
  return f;
};
const hasField = (wh: WorkingHousehold, key: string) => allFields(stage(wh)).some((x) => x.key === key);
const set = (wh: WorkingHousehold, key: string, v: Val) => fieldOf(wh, key).set(wh, v);
const actions = (wh: WorkingHousehold) => stage(wh).sections.flatMap((s) => [...s.actions, ...s.groups.flatMap((g) => g.actions)]);
const action = (wh: WorkingHousehold, key: string) => {
  const a = actions(wh).find((x) => x.key === key);
  if (a === undefined) throw new Error(`ボタンが無い: ${key}`);
  return a;
};
const kids = (wh: WorkingHousehold) => wh.request.input.household.members.filter((m) => m.kind === "child" && m.outside === undefined);
const memberGroups = (wh: WorkingHousehold) => (stage(wh).sections.find((s) => s.key === "family/members")?.groups ?? []).filter((g) => /^family\/[^/]+$/.test(g.key)).map((g) => g.key.slice("family/".length));

function couple(): WorkingHousehold {
  let wh = blankHousehold(BASE, ids());
  const self = wh.request.input.household.members[0]!;
  wh = set(wh, `family/${self.id}/birth`, "1985-06");
  return addMember(wh, "spouse", ids());
}

describe("2人目からの子の仮の生年月", () => {
  it("1人目は今までどおり、2人目からは前の子の3年後（双子にしない）。基準の月を超えるなら基準の月", () => {
    let wh = couple();
    wh = addChildWithEducation(wh, ids());
    wh = addChildWithEducation(wh, ids());
    const [a, b] = kids(wh).map((m) => m.birth.birthYearMonth);
    expect(a).toBe("2017-04");
    expect(b).toBe(addMonths(a!, CHILD_SPACING_MONTHS));
    expect(b).toBe("2020-04");
    // 3年後が基準の月より後なら、基準の月
    wh = addChildWithEducation(wh, ids());
    wh = addChildWithEducation(wh, ids());
    expect(kids(wh).map((m) => m.birth.birthYearMonth)).toEqual(["2017-04", "2020-04", "2023-04", "2026-04"]);
    wh = addChildWithEducation(wh, ids());
    expect(kids(wh).at(-1)!.birth.birthYearMonth).toBe(BASE);
    // 生年月の仮の値の印は今までどおり
    expect(wh.assumed[`family/${kids(wh).at(-1)!.id}/birth`]).toBe("仮の値");
  });
});

describe("続柄・呼び名・欄の並び", () => {
  it("子の続柄は「子／その他の家族（同居の兄弟姉妹など）」だけ。配偶者は続柄を選ばない（2人目の配偶者を作らない）", () => {
    let wh = addChildWithEducation(couple(), ids());
    const sp = wh.request.input.household.members.find((m) => m.kind === "spouse")!;
    const child = kids(wh)[0]!;
    const f = fieldOf(wh, `family/${child.id}/kind`);
    expect(f.kind === "select" ? f.options.map((o) => o.value) : []).toEqual(["child", "other"]);
    expect(f.kind === "select" ? f.options[1]!.label : "").toBe("その他の家族（同居の兄弟姉妹など）");
    expect(hasField(wh, `family/${sp.id}/kind`)).toBe(false);
    // 前の版で別の続柄の人は、その続柄を残して見せる
    expect(familyKindOptions("grandparent").at(-1)).toEqual({ value: "grandparent", label: "祖父母（前に選んだ続柄）" });
    // 子を「その他の家族」にしても家族の入力項目に残る
    wh = set(wh, `family/${child.id}/kind`, "other");
    expect(memberGroups(wh)).toContain(child.id);
  });

  it("呼び名の例は続柄で変える（ご本人「例: 世帯主」・配偶者「例: パートナー」・子「例: 上のお子さん」）", () => {
    const wh = addChildWithEducation(couple(), ids());
    const ms = wh.request.input.household.members;
    const ph = (id: string) => {
      const f = fieldOf(wh, `family/${id}/nickname`);
      return f.kind === "text" ? f.placeholder : undefined;
    };
    expect(ph(ms.find((m) => m.kind === "self")!.id)).toBe("例: 世帯主");
    expect(ph(ms.find((m) => m.kind === "spouse")!.id)).toBe("例: パートナー");
    expect(ph(kids(wh)[0]!.id)).toBe("例: 上のお子さん");
  });

  it("詳細の並びは標準と同じ「続柄 → 生年月 → 性別」の後に「1日生まれ → 呼び名 → 関係 → 加わる時期」", () => {
    const wh = addChildWithEducation(couple(), ids());
    const group = (id: string) => stage(wh).sections.find((s) => s.key === "family/members")!.groups.find((g) => g.key === `family/${id}`)!;
    const sp = wh.request.input.household.members.find((m) => m.kind === "spouse")!;
    const tail = (k: string) => k.split("/").at(-1);
    expect(group(sp.id).fields.map((f) => tail(f.key))).toEqual(["birth", "sex", "bornOnFirst", "nickname", "relation", "joins"]);
    expect(group(kids(wh)[0]!.id).fields.map((f) => tail(f.key))).toEqual(["kind", "birth", "bornOnFirst", "nickname", "joins"]);
  });

  it("生年月の欄は年齢でも入れられ（ageInput）、入力例は過去の年月。生まれる予定の例は今から2年後", () => {
    let wh = couple();
    const self = wh.request.input.household.members[0]!;
    const birth = fieldOf(wh, `family/${self.id}/birth`);
    expect(birth.kind === "ym" ? birth.ageInput : undefined).toBe(true);
    expect(birth.example).toBe("例: 1985-04");
    wh = addChildWithEducation(wh, ids(), true);
    const expected = wh.request.input.household.members.find((m) => m.expected === true)!;
    expect(fieldOf(wh, `family/${expected.id}/birth`).example).toBe("例: 2028-10");
  });
});

describe("配偶者の関係の1行と、加わる時期の1欄", () => {
  it("関係の1行は「「詳細」の「夫婦の関係」で直せます」で、標準だけ（詳細では夫婦の関係のまとまりがすぐ下にある）", () => {
    const wh = couple();
    const sp = wh.request.input.household.members.find((m) => m.kind === "spouse")!;
    const rel = fieldOf(wh, `family/${sp.id}/relation`);
    expect(rel.readOnly).toBe("「詳細」の「夫婦の関係」で直せます");
    expect(rel.simpleOnly).toBe(true);
  });

  it("配偶者に加わる時期を入れると「これから加わる」になり、関係の始まりも同じ月。空にすると最初からに戻す", () => {
    let wh = couple();
    const sp = wh.request.input.household.members.find((m) => m.kind === "spouse")!;
    expect(hasField(wh, `family/${sp.id}/expected`)).toBe(false);
    wh = set(wh, `family/${sp.id}/joins`, "2028-04");
    const h = wh.request.input.household;
    const x = h.members.find((m) => m.id === sp.id)!;
    expect(x.expected).toBe(true);
    expect(x.joins).toEqual({ at: "2028-04" });
    expect(spouseRelations(h, sp.id)[0]!.from).toEqual({ at: "2028-04" });
    // 時期を直すと、合わせていた関係の始まりもついてくる
    wh = set(wh, `family/${sp.id}/joins`, "2029-01");
    expect(spouseRelations(wh.request.input.household, sp.id)[0]!.from).toEqual({ at: "2029-01" });
    // FP が関係の始まりを別の月にしたら、加わる時期を直しても関係の始まりは変えない
    wh = mutate(wh, (hh) => void (spouseRelations(hh, sp.id)[0]!.from = { at: "2028-10" }));
    wh = set(wh, `family/${sp.id}/joins`, "2029-06");
    expect(spouseRelations(wh.request.input.household, sp.id)[0]!.from).toEqual({ at: "2028-10" });
    wh = set(wh, `family/${sp.id}/joins`, null);
    const y = wh.request.input.household.members.find((m) => m.id === sp.id)!;
    expect(y.expected).toBe(false);
    expect(y.joins ?? null).toBeNull();
  });

  it("子に加わる時期を入れても「これから生まれる子」にしない（子の印はこれから生まれる子の意味）", () => {
    let wh = addChildWithEducation(couple(), ids());
    const c = kids(wh)[0]!;
    wh = set(wh, `family/${c.id}/joins`, "2027-04");
    const x = wh.request.input.household.members.find((m) => m.id === c.id)!;
    expect(x.expected).toBe(false);
    expect(x.joins).toEqual({ at: "2027-04" });
    expect(hasField(wh, `family/${c.id}/birth`)).toBe(true);
    expect(fieldOf(wh, `family/${c.id}/birth`).label).toBe("生年月");
  });

  it("前の版で「これから加わる」の印だけ付けた配偶者は、印を外せる欄を残す", () => {
    let wh = couple();
    const sp = wh.request.input.household.members.find((m) => m.kind === "spouse")!;
    wh = mutate(wh, (h) => void (h.members.find((m) => m.id === sp.id)!.expected = true));
    expect(fieldOf(wh, `family/${sp.id}/expected`).label).toBe("これから加わる（前の版の印）");
  });
});

describe("離れて暮らす子・世帯の外の家族・ひとり親", () => {
  it("家族の構成から「＋ 離れて暮らす子」で足せる（世帯の外の家族。介護・親の入力項目に並ぶ）。世帯の外の家族は年齢つきの1行", () => {
    let wh = addChildWithEducation(couple(), ids());
    wh = action(wh, "family/add/outsideChild").run(wh);
    const apart = wh.request.input.household.members.find((m) => m.kind === "child" && m.outside !== undefined)!;
    expect(memberGroups(wh)).not.toContain(apart.id);
    expect(allFields(buildStage("care", wh)).some((f) => f.key.includes(apart.id))).toBe(true);
    wh = addOutside(wh, "parent", { sex: "female", birthYear: 1937 });
    const line = fieldOf(wh, "ro/family/outside").get(wh).value as string;
    expect(line).toContain(`${memberLabel(wh, apart.id)}（`);
    expect(line).toMatch(/（89歳）/);
  });

  it("ひとり親の世帯（配偶者がいなくて一緒に暮らす子がいる）は、控除は計算に入れていて手当は入れていない1行と「＋ 児童扶養手当など」（0156）", () => {
    const wh = fromRequest(modelHousehold("sampleSingleParent"));
    expect(singleParent(wh)).toBe(true);
    expect(fieldOf(wh, "ro/family/singleParent").get(wh).value).toBe("控除は計算に入れています（手当は入れていません）");
    expect(fieldOf(wh, "ro/family/singleParent").readOnly).toMatch(/未婚・離婚・死別のどれでも/);
    expect(fieldOf(wh, "ro/family/singleParent").readOnly).not.toMatch(/今は計算に入れていません/);
    const benefit = actions(wh).find((a) => a.key.endsWith("/in/add/benefit"))!;
    expect(benefit.label).toBe("＋ 児童扶養手当など");
    expect(benefit.help).toMatch(/^児童扶養手当・自治体の手当/);
    // 夫婦の世帯では出さない
    const pair = addChildWithEducation(couple(), ids());
    expect(singleParent(pair)).toBe(false);
    expect(hasField(pair, "ro/family/singleParent")).toBe(false);
    expect(actions(pair).find((a) => a.key.endsWith("/in/add/benefit"))!.label).not.toBe("＋ 児童扶養手当など");
  });
});

describe("婚姻の状態（ひとり親控除・寡婦控除の判定。0156）", () => {
  const selfId = (wh: WorkingHousehold) => wh.request.input.household.members.find((m) => m.kind === "self")!.id;

  it("配偶者が世帯にいないご本人にだけ、詳細の欄「婚姻の状態」（空欄＝婚姻していない）。夫婦の世帯・配偶者には出さない", () => {
    const wh = fromRequest(modelHousehold("sampleSingleParent"));
    const f = fieldOf(wh, `family/${selfId(wh)}/marital`);
    expect(f.level).toBe("detail");
    expect(f.item).toBe("member.maritalStatus");
    expect(f.get(wh).value).toBe("");
    expect(f.blankMeans).toBe("婚姻していない");
    expect(f.kind === "select" ? f.options.map((o) => o.value) : []).toEqual(["", "unmarried", "divorced", "bereaved", "married"]);
    // 単身の世帯にも出る（寡婦控除の判定）
    const single = fromRequest(modelHousehold("sampleSingle40s"));
    expect(hasField(single, `family/${selfId(single)}/marital`)).toBe(true);
    const pair = couple();
    expect(allFields(stage(pair)).some((x) => x.key.endsWith("/marital"))).toBe(false);
  });

  it("選ぶと世帯の構成員に書き、空欄に戻すと欄を消す。「婚姻している（別居など）」ならひとり親の1行は「どちらも計算に入れていません」で、計算の結果も変わる", () => {
    const wh = fromRequest(modelHousehold("sampleSingleParent"));
    const key = `family/${selfId(wh)}/marital`;
    const married = set(wh, key, "married");
    expect(married.request.input.household.members.find((m) => m.kind === "self")!.maritalStatus).toBe("married");
    expect(fieldOf(married, "ro/family/singleParent").get(married).value).toBe("どちらも計算に入れていません（婚姻している）");
    const back = set(married, key, "");
    expect("maritalStatus" in back.request.input.household.members.find((m) => m.kind === "self")!).toBe(false);
    // 離婚・未婚は空欄と同じ結果（ひとり親控除）。婚姻している（別居など）は控除が無くなり、税が増える
    expect(preview(set(wh, key, "divorced").request).table).toEqual(preview(wh.request).table);
    expect(preview(married.request).table).not.toEqual(preview(wh.request).table);
  });
});

describe("打っている間に子を並び替えない（保存で生年月の順に並べる）", () => {
  it("下の子の生年月を上の子より前にしても、入力項目の並びは変わらない（Tab で次に進むと同じ子の欄に戻らない）", () => {
    let wh = addChildWithEducation(addChildWithEducation(couple(), ids()), ids());
    const [first, second] = kids(wh);
    const before = memberGroups(wh);
    expect(before.slice(-2)).toEqual([first!.id, second!.id]);
    wh = set(wh, `family/${second!.id}/birth`, "2012-05");
    expect(memberGroups(wh)).toEqual(before);
    expect(panelOrder(wh.request.input.household).map((m) => m.id)).toEqual(before);
    // 呼び名は生年月の順のまま
    expect(memberLabel(wh, second!.id)).toBe("第1子");
    // 保存のときに並べ直す（並びがそろっていれば同じ世帯を返す）
    const sorted = sortChildrenByBirth(wh);
    expect(memberGroups(sorted).slice(-2)).toEqual([second!.id, first!.id]);
    expect(sortChildrenByBirth(sorted)).toBe(sorted);
  });
});
