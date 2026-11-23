// まとまりの中の「＋」で足した物が、押したまとまりのすぐ下に並ぶ（0257）:
// - 相続・贈与の「あげる贈与」: 孫のまとまりのすぐ下に、その孫を相手にした行。相手が孫でない行（子・相手なし）は区画の上
// - 介護・親の「介護の費用」: 介護を受ける人ごとに続けて並べる（「＋ 次の段階」がほかの人の介護の後ろに出ない）
// - 住まい・ローンの住宅の購入: 「＋ ペアローン（配偶者の2本目）」の2本目が、1本目のすぐ後ろに出る（「住宅ローン」の区画に離れて出ない）
// - 車: 「＋ この車の続き」は押した車のすぐ後ろ。手放した後の移動の費用・古くなってからの修理費の行は、その車の枠の中
import { describe, expect, it } from "vitest";
import { allFields, type FieldDef, type GroupDef, type SectionDef, type StageDef, type StageId } from "../src/workspace/input/form.ts";
import { blankHousehold, fromRequest, type WorkingHousehold } from "../src/workspace/input/household.ts";
import { careLabel } from "../src/workspace/input/labels.ts";
import { addMember } from "../src/workspace/input/stages/family.ts";
import { addCareTemplate } from "../src/workspace/input/fill.ts";
import { addOutside, careByMember } from "../src/workspace/input/stages/care.ts";
import { buildStage } from "../src/workspace/input/stages/index.ts";
import { addAfterCar, addRepair, carRowsByCar } from "../src/workspace/input/stages/cars.ts";
import { fieldStatus } from "../src/workspace/input/valueState.ts";
import { modelHousehold } from "./helpers.ts";

const seq = () => {
  let n = 0;
  return () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`;
};
const section = (id: StageId, wh: WorkingHousehold, key: string): SectionDef => {
  const s = buildStage(id, wh).sections.find((x) => x.key === key);
  if (s === undefined) throw new Error(`no section ${key}`);
  return s;
};
const run = (id: StageId, wh: WorkingHousehold, key: string): WorkingHousehold => {
  const st: StageDef = buildStage(id, wh);
  const a = st.sections.flatMap((s) => [...s.actions, ...s.groups.flatMap((g) => g.actions)]).find((x) => x.key === key);
  if (a === undefined) throw new Error(`no action ${key}`);
  return a.run(wh);
};
const fieldOf = (id: StageId, wh: WorkingHousehold, key: string): FieldDef => {
  const f = allFields(buildStage(id, wh)).find((x) => x.key === key);
  if (f === undefined) throw new Error(`no field ${key}`);
  return f;
};
/** 区画の並びを、物ごとの1つの名前に縮める（行のまとまり ev/<id>/… は行の id、人のまとまり family/<id> は人の id） */
const owners = (groups: readonly GroupDef[], name: (k: string) => string | null): string[] =>
  groups.map((g) => name(g.key)).filter((x): x is string => x !== null).filter((x, i, xs) => xs[i - 1] !== x);

describe("相続・贈与の「あげる贈与」: 孫のまとまりのすぐ下に、その孫を相手にした行（0257）", () => {
  // 子1人（世帯の中）・贈与の相手の孫2人の世帯。基準の月は年の初め（1〜3月）でも同じ並び
  const setup = (base: string) => {
    const w0 = addMember(blankHousehold(base, seq()), "child");
    const w1 = run("inheritance", w0, "money/inherit/addGrandchild");
    const wh = run("inheritance", w1, "money/inherit/addGrandchild");
    const [g1, g2] = wh.request.input.household.members.filter((m) => m.kind === "grandchild");
    const child = wh.request.input.household.members.find((m) => m.kind === "child")!;
    return { wh, g1: g1!.id, g2: g2!.id, child: child.id };
  };
  const giftIds = (wh: WorkingHousehold) => (wh.request.input.household.periodicExpenses ?? []).filter((p) => p.kind === "gift").map((p) => p.id);
  const added = (before: WorkingHousehold, after: WorkingHousehold) => giftIds(after).find((id) => !giftIds(before).includes(id))!;
  const order = (wh: WorkingHousehold, names: Record<string, string>) =>
    owners(section("inheritance", wh, "inherit/give").groups, (k) => {
      const id = /^(?:ev|family)\/([^/]+)/.exec(k)?.[1];
      return id === undefined ? null : (names[id] ?? null);
    });

  it.each(["2026-10", "2027-02"])("基準の月 %s: 「＋ この孫へのあげる贈与」の行は押した孫のすぐ下。2人目の孫の行は2人目の下、相手が子の行は区画の上", (base) => {
    const { wh, g1, g2, child } = setup(base);
    // 2人目の孫で押す → 2人目のすぐ下（1人目の上には出ない）
    const a = run("inheritance", wh, `inherit/grandchild/${g2}/gift`);
    const r2 = added(wh, a);
    // 1人目の孫で押す → 1人目のすぐ下（2人目の孫のまとまりより上）
    const b = run("inheritance", a, `inherit/grandchild/${g1}/gift`);
    const r1 = added(a, b);
    // 区画の「＋ あげる贈与」で足して、相手を子に選び直す → 区画の上（孫のまとまりより前）
    const c0 = run("inheritance", b, "money/inherit/out/add/gift");
    const r0 = added(b, c0);
    const c = fieldOf("inheritance", c0, `ev/${r0}/counterparty`).set(c0, child);
    const names = { [g1]: "孫1", [g2]: "孫2", [r1]: "孫1への行", [r2]: "孫2への行", [r0]: "子への行" };
    expect(order(a, names)).toEqual(["孫1", "孫2", "孫2への行"]);
    expect(order(b, names)).toEqual(["孫1", "孫1への行", "孫2", "孫2への行"]);
    expect(order(c, names)).toEqual(["子への行", "孫1", "孫1への行", "孫2", "孫2への行"]);
    // 行の中の小さなまとまり（贈与の形・相手など。ev/<id>/…）も、その行の見出しのすぐ後ろに続く（行が分かれない）
    const keys = section("inheritance", c, "inherit/give").groups.map((g) => g.key);
    const rows = keys.map((k, i) => [k, i] as const).filter(([k]) => k === `ev/${r1}` || k.startsWith(`ev/${r1}/`));
    expect(rows.map(([, i]) => i)).toEqual(rows.map((_, j) => rows[0]![1] + j));
  });

  it("相手の推定のまま（区画の「＋ あげる贈与」の既定の相手が孫）も、FP が選んだ相手も、その孫の下。相手を空にした行・孫を外した行は区画の上", () => {
    const { wh, g1, g2 } = setup("2026-10");
    // 区画のボタン: 候補が2人以上なので、既定の相手（離れて暮らす孫の1人目）は推定の印のまま
    const a = run("inheritance", wh, "money/inherit/out/add/gift");
    const r = added(wh, a);
    expect(a.request.input.household.periodicExpenses!.find((p) => p.id === r)!.counterparty).toBe(g1);
    expect(fieldStatus(fieldOf("inheritance", a, `ev/${r}/counterparty`), a).status).toBe("estimated");
    const names = { [g1]: "孫1", [g2]: "孫2", [r]: "行" };
    expect(order(a, names)).toEqual(["孫1", "行", "孫2"]);
    // FP が2人目を選ぶ（推定の印が外れる）→ 2人目の下に移る
    const b = fieldOf("inheritance", a, `ev/${r}/counterparty`).set(a, g2);
    expect(fieldStatus(fieldOf("inheritance", b, `ev/${r}/counterparty`), b).status).not.toBe("estimated");
    expect(order(b, names)).toEqual(["孫1", "孫2", "行"]);
    // 相手を空（その他の人）にすると区画の上
    const c = fieldOf("inheritance", b, `ev/${r}/counterparty`).set(b, "");
    expect(order(c, names)).toEqual(["行", "孫1", "孫2"]);
    // 相手の孫を外すと、行は相手なしになって区画の上
    const d = run("inheritance", b, `family/${g2}/remove`);
    expect(order(d, names)).toEqual(["行", "孫1"]);
  });

  it("孫がいない世帯・相手が世帯の外の子の行は、今までどおり行の並び（時期の順）のまま", () => {
    const req = structuredClone(modelHousehold("sampleParentsCare"));
    const wh = fromRequest(req);
    const s = section("inheritance", wh, "inherit/give");
    const kid = wh.request.input.household.members.find((m) => m.kind === "grandchild" && m.outside !== undefined)!;
    const kidAt = s.groups.findIndex((g) => g.key === `family/${kid.id}`);
    // 孫を相手にした行は、どれも孫のまとまりより後ろ。それ以外の行は前
    const party = new Map((wh.request.input.household.periodicExpenses ?? []).map((p) => [p.id, p.counterparty]));
    s.groups.forEach((g, i) => {
      const id = /^ev\/([^/]+)/.exec(g.key)?.[1];
      if (id === undefined || !party.has(id)) return;
      expect(party.get(id) === kid.id ? i > kidAt : i < kidAt).toBe(true);
    });
    // 孫のいない空の世帯: 区画の「＋ あげる贈与」の行は区画のいちばん上（孫のまとまりは無い）
    const w0 = addMember(blankHousehold("2026-10", seq()), "child");
    const w1 = run("inheritance", w0, "money/inherit/out/add/gift");
    expect(section("inheritance", w1, "inherit/give").groups[0]!.key).toMatch(/^ev\//);
  });
});

describe("介護・親の「介護の費用」: 介護を受ける人ごとに続けて並べる（0257）", () => {
  const costs = (wh: WorkingHousehold) => section("care", wh, "care/costs").groups.filter((g) => /^ev\/care\/[^/]+$/.test(g.key));

  it("親の介護の「＋ 次の段階」: 2段階目は親の1段階目のすぐ下（ご本人の介護より前）。もう一度押すと3段階目が親の2段階目の下", () => {
    const wh = fromRequest(structuredClone(modelHousehold("parentCare")));
    const list = wh.request.input.household.careExpenses!;
    const parent = list[0]!;
    const self = list[1]!;
    expect(costs(wh).map((g) => g.key)).toEqual([`ev/care/${parent.id}`, `ev/care/${self.id}`]);
    const a = run("care", wh, `ev/care/${parent.id}/nextStage`);
    const second = a.request.input.household.careExpenses!.at(-1)!;
    expect(costs(a).map((g) => g.key)).toEqual([`ev/care/${parent.id}`, `ev/care/${second.id}`, `ev/care/${self.id}`]);
    // 見出しの段階の数え方（世帯の中の並びの順）と、画面の上からの順が同じ
    expect(costs(a).map((g) => g.title)).toEqual([careLabel(a, parent), careLabel(a, second), careLabel(a, self)]);
    expect(costs(a).map((g) => g.title?.match(/（\d段階目）/)?.[0] ?? "")).toEqual(["（1段階目）", "（2段階目）", ""]);
    const b = run("care", a, `ev/care/${second.id}/nextStage`);
    const third = b.request.input.household.careExpenses!.at(-1)!;
    expect(costs(b).map((g) => g.key)).toEqual([`ev/care/${parent.id}`, `ev/care/${second.id}`, `ev/care/${third.id}`, `ev/care/${self.id}`]);
    // ご本人の介護の次の段階は、ご本人の介護の下（いちばん下）
    const c = run("care", b, `ev/care/${self.id}/nextStage`);
    expect(costs(c).at(-2)!.key).toBe(`ev/care/${self.id}`);
  });

  it("人の順は、その人の介護が最初に出てくる順（並べ替えは人ごとにまとめるだけ。同じ人の段階の順は変えない）", () => {
    expect(careByMember([{ id: "a", member: "p" }, { id: "b", member: "s" }, { id: "c", member: "p" }, { id: "d", member: "s" }, { id: "e" }]).map((x) => x.id)).toEqual(["a", "c", "b", "d", "e"]);
    expect(careByMember([])).toEqual([]);
    // 空の世帯に親を足して介護を2人分: 人ごと
    const w0 = addOutside(blankHousehold("2027-01", seq()), "parent");
    const p = w0.request.input.household.members.find((m) => m.kind === "parent")!;
    const self = w0.request.input.household.members.find((m) => m.kind === "self")!;
    const w1 = addCareTemplate(addCareTemplate(w0, self.id), p.id);
    const first = w1.request.input.household.careExpenses!.find((c) => c.member === self.id)!;
    const w2 = run("care", w1, `ev/care/${first.id}/nextStage`);
    expect(costs(w2).map((g) => w2.request.input.household.careExpenses!.find((c) => g.key === `ev/care/${c.id}`)!.member)).toEqual([self.id, self.id, p.id]);
  });
});

describe("住まい・ローンの住宅の購入: ペアローンの2本目は1本目のすぐ後ろ（0257）", () => {
  it("1本目の借入の年月が購入の月と違う購入の予定でも、2本目は住宅の購入の中の1本目のすぐ後ろに出て、「住宅ローン」の区画には出ない", () => {
    const wh = fromRequest(structuredClone(modelHousehold("housingGiftFromParents")));
    const first = wh.request.input.household.debts!.find((d) => d.kind === "mortgage")!;
    const a = run("housing", wh, `housing/debt/${first.id}/addPair`);
    const pair = a.request.input.household.debts!.find((d) => d.pairWith === first.id)!;
    const res = section("housing", a, "housing/residences").groups.map((g) => g.key);
    const lastOfFirst = res.map((k, i) => [k, i] as const).filter(([k]) => k === `housing/debt/${first.id}` || k.startsWith(`housing/debt/${first.id}/`)).at(-1)![1];
    expect(res[lastOfFirst + 1]).toBe(`housing/debt/${pair.id}`);
    expect(section("housing", a, "housing/loans").groups.some((g) => g.key.startsWith(`housing/debt/${pair.id}`))).toBe(false);
    // 見出しは「この家の住宅ローン 1」「この家の住宅ローン 2」
    const titles = section("housing", a, "housing/residences").groups.filter((g) => g.key === `housing/debt/${first.id}` || g.key === `housing/debt/${pair.id}`).map((g) => g.title ?? "");
    expect(titles.map((t) => t.replace(/（.*$/, ""))).toEqual(["この家の住宅ローン 1", "この家の住宅ローン 2"]);
  });
});

describe("車: 「＋ この車の続き」は押した車のすぐ後ろ、車の出来事から始まる出るお金の行は、その車の枠の中（0257。利用者の判断）", () => {
  const carsSection = (wh: WorkingHousehold) => section("car", wh, "ev/cars");
  const heads = (wh: WorkingHousehold) => carsSection(wh).groups.filter((g) => /^ev\/car\/[^/]+$/.test(g.key)).map((g) => g.title ?? "");
  const carIds = (wh: WorkingHousehold) => (wh.request.input.household.cars ?? []).map((c) => c.id);
  /** その車の枠（見出しから次の車の見出しの前まで）のまとまりのキー */
  const frameOf = (wh: WorkingHousehold, carId: string): string[] => {
    const keys = carsSection(wh).groups.map((g) => g.key);
    const at = keys.indexOf(`ev/car/${carId}`);
    const next = keys.findIndex((k, i) => i > at && /^ev\/car\/[^/]+$/.test(k));
    return keys.slice(at, next < 0 ? undefined : next);
  };
  const rowIds = (wh: WorkingHousehold) => (wh.request.input.household.periodicExpenses ?? []).filter((p) => p.kind === "car").map((p) => p.id);
  const newRow = (before: WorkingHousehold, after: WorkingHousehold) => rowIds(after).find((id) => !rowIds(before).includes(id))!;
  const moneyKeys = (wh: WorkingHousehold) => buildStage("car", wh).sections.find((s) => s.key === "money/car/out")?.groups.map((g) => g.key) ?? [];

  it("ご本人の車1の続きは車1のすぐ後ろ（車 2）。配偶者の車は車 3 に繰り下がり、出来事の名前の番号も同じ。最後の車の続きはいちばん後ろ", () => {
    const wh = fromRequest(structuredClone(modelHousehold("dualAssetsTwoKids")));
    const [c1, c2] = carIds(wh);
    expect(heads(wh)).toEqual(["車 1（ご本人・今の車）", "車 2（配偶者・今の車）"]);
    const a = run("car", wh, `ev/car/${c1}/next`);
    const added = carIds(a).find((id) => id !== c1 && id !== c2)!;
    expect(carIds(a)).toEqual([c1, added, c2]);
    expect(heads(a)).toEqual(["車 1（ご本人・今の車）", "車 2（ご本人・これから買う車）", "車 3（配偶者・今の車）"]);
    // 続きの車の購入の時期は、車1を手放す出来事から（並びを変えても指す車は同じ）
    const first = a.request.input.household.cars!.find((c) => c.id === added)!.purchase!.first;
    expect(first.event).toBe(a.request.input.household.cars!.find((c) => c.id === c1)!.until!.event);
    // 配偶者の車（いちばん後ろ）の続きは、いちばん後ろ
    const b = run("car", a, `ev/car/${c2}/next`);
    expect(carIds(b).slice(0, 3)).toEqual([c1, added, c2]);
    expect(carIds(b)).toHaveLength(4);
  });

  it("「＋ 手放した後の移動の費用」の行は、その車の枠のいちばん下に出て、区画「出るお金」には出ない。区画の「＋」で足した行は今までどおり「出るお金」", () => {
    const wh = fromRequest(structuredClone(modelHousehold("dualAssetsTwoKids")));
    const st = buildStage("car", wh);
    const a0 = st.sections.flatMap((s) => s.groups.flatMap((g) => g.actions)).find((x) => x.key.endsWith("/afterCar"))!;
    const carId = /^ev\/car\/([^/]+)\//.exec(a0.key)![1]!;
    const a = a0.run(wh);
    const r = newRow(wh, a);
    const frame = frameOf(a, carId);
    expect(frame.at(-1) === `ev/${r}` || frame.at(-1)!.startsWith(`ev/${r}/`)).toBe(true);
    expect(frame).toContain(`ev/${r}`);
    expect(moneyKeys(a).some((k) => k.startsWith(`ev/${r}`))).toBe(false);
    // 押した「手放した後」のまとまり（ボタン）は消え、行がその場所に出る
    expect(frame.some((k) => k.endsWith("/afterCar"))).toBe(false);
    // 区画の「＋」の行（年月で入れる）は「出るお金」
    const b = run("car", a, "money/car/out/add/car");
    const r2 = newRow(a, b);
    expect(moneyKeys(b)).toContain(`ev/${r2}`);
    expect(carsSection(b).groups.some((g) => g.key.startsWith(`ev/${r2}`))).toBe(false);
  });

  it("「＋ 古くなってからの修理費」の行は、その車の「維持費」の後（「伸び方・万一のとき」の前）。続きの車の修理費は続きの車に、元の車の手放した後の行は元の車に", () => {
    const w0 = fromRequest(structuredClone(modelHousehold("deferral")));
    const w1 = run("car", w0, "ev/addCarNew");
    const st = buildStage("car", w1);
    const rep = st.sections.flatMap((s) => s.groups.flatMap((g) => g.actions)).find((x) => x.key.endsWith("/repair"))!;
    const carId = /^ev\/car\/([^/]+)\//.exec(rep.key)![1]!;
    const a = rep.run(w1);
    const r = newRow(w1, a);
    const frame = frameOf(a, carId);
    const at = frame.indexOf(`ev/${r}`);
    expect(at).toBeGreaterThan(frame.findIndex((k) => k.endsWith("/band/upkeep")));
    const fut = frame.findIndex((k) => k.endsWith("/band/future"));
    if (fut >= 0) expect(at).toBeLessThan(fut);
    expect(moneyKeys(a).some((k) => k.startsWith(`ev/${r}`))).toBe(false);
    // 続きの車: 元の車を手放す出来事から始まる。続きの車の修理費は続きの車の枠、元の車の手放した後の行（同じ出来事の翌月）は元の車の枠
    const wh = fromRequest(structuredClone(modelHousehold("dualAssetsTwoKids")));
    const [c1] = carIds(wh);
    const b = run("car", wh, `ev/car/${c1}/next`);
    const next = carIds(b)[1]!;
    const c = addRepair(b, next);
    const rr = newRow(b, c);
    const d = addAfterCar(c, c1!);
    const ra = newRow(c, d);
    const rows = carRowsByCar(d.request.input.household);
    expect(rows.upkeep.get(next)!.map((p) => p.id)).toEqual([rr]);
    expect(rows.after.get(c1!)!.map((p) => p.id)).toEqual([ra]);
    expect(frameOf(d, next)).toContain(`ev/${rr}`);
    expect(frameOf(d, c1!)).toContain(`ev/${ra}`);
  });
});
