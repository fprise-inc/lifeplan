// 入力項目のまとまり（中枠）と言葉をそろえる（0237）: 車・収益不動産・保険（詳細だけ）・働き方（詳細）の物1件を中枠に分け、
// 今返している自動車ローンを車の枠の中に出す。見せ方だけの変更で、欄のキー・画面の外で言う名前・ローンのデータの持ち方は変えない
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { checkList } from "../src/workspace/input/checkRows.ts";
import type { ActionDef, GroupDef, StageDef } from "../src/workspace/input/form.ts";
import { fromRequest, type WorkingHousehold } from "../src/workspace/input/household.ts";
import { findEntries } from "../src/workspace/input/inputSearch.ts";
import { inputItems } from "../src/workspace/input/items.ts";
import { buildStage, buildStages } from "../src/workspace/input/stages/index.ts";
import { fieldPlaces } from "../src/workspace/documents/resolve.ts";
import { planIndex } from "../src/workspace/plans/planEdit.ts";
import { REPO_DIR } from "../scripts/lib.ts";
import { modelHousehold } from "./helpers.ts";

type Req = ReturnType<typeof modelHousehold>;
type House = Req["input"]["household"];
const vary = (id: string, fn: (h: House) => void): WorkingHousehold => {
  const req = structuredClone(modelHousehold(id));
  fn(req.input.household);
  return fromRequest(req, {});
};
const groupsOf = (st: StageDef): GroupDef[] => st.sections.flatMap((s) => s.groups);
const actionsOf = (st: StageDef): ActionDef[] => st.sections.flatMap((s) => [...s.actions, ...s.groups.flatMap((g) => g.actions)]);
const carLoan = (h: House) => (h.debts ?? []).find((d) => d.kind === "car")!;
/** ローンの頭のまとまりが、どの車の枠の中に出ているか（車の枠の外なら null） */
const carOfLoan = (st: StageDef, debtId: string): string | null => groupsOf(st).find((g) => g.key === `housing/debt/${debtId}`)?.partOf ?? null;

// 車2台（ご本人・配偶者。どちらも今の車）と、ご本人の名義の自動車ローン1本の世帯
const BASE = "dualAssetsTwoKids";

describe("今返している自動車ローンは、名義の合う今の車の枠の中に出す", () => {
  it("ローンの名義と同じ名義の車の枠に出す。欄のキーと画面の外で言う名前は、ローンの区画にあったときのまま", () => {
    const wh = vary(BASE, () => undefined);
    const h = wh.request.input.household;
    const d = carLoan(h);
    const mine = (h.cars ?? []).find((c) => c.owner === d.debtors[0]!.member)!;
    const st = buildStage("car", wh);
    expect(carOfLoan(st, d.id)).toBe(`ev/car/${mine.id}`);
    expect(st.sections.some((s) => s.key === "car/loans")).toBe(false);
    const head = groupsOf(st).find((g) => g.key === `housing/debt/${d.id}`)!;
    expect(head).toMatchObject({ band: true, title: "今返しているローン（ご本人）", where: "自動車ローン（ご本人）" });
    expect(head.fields.every((f) => f.key.startsWith(`housing/debt/${d.id}/`))).toBe(true);
    // 車の枠の中の並び: 価格・買い方 → 今返しているローン → 足すボタン → 維持費
    const keys = groupsOf(st).map((g) => g.key);
    const at = (k: string) => keys.indexOf(k);
    expect(at(`ev/car/${mine.id}/band/price`)).toBeLessThan(at(head.key));
    expect(at(head.key)).toBeLessThan(at(`ev/car/${mine.id}/addNowLoan`));
    expect(at(`ev/car/${mine.id}/addNowLoan`)).toBeLessThan(at(`ev/car/${mine.id}/band/upkeep`));
  });

  it("同じ名義のローンが2本なら同じ車の枠に番号つきで、名義ごとのローンはそれぞれの車の枠に出す", () => {
    const two = vary(BASE, (h) => {
      h.debts!.push({ ...structuredClone(carLoan(h)), id: "22222222-2222-4222-8222-222222222222" });
    });
    const st = buildStage("car", two);
    const ds = (two.request.input.household.debts ?? []).filter((d) => d.kind === "car");
    expect(new Set(ds.map((d) => carOfLoan(st, d.id))).size).toBe(1);
    expect(ds.map((d) => groupsOf(st).find((g) => g.key === `housing/debt/${d.id}`)!.title)).toEqual(["今返しているローン 1（ご本人）", "今返しているローン 2（ご本人）"]);

    const each = vary(BASE, (h) => {
      const d = structuredClone(carLoan(h));
      d.id = "11111111-1111-4111-8111-111111111111";
      d.debtors[0]!.member = h.cars![1]!.owner;
      h.debts!.push(d);
    });
    const st2 = buildStage("car", each);
    const cars = each.request.input.household.cars ?? [];
    const ds2 = (each.request.input.household.debts ?? []).filter((d) => d.kind === "car");
    expect(ds2.map((d) => carOfLoan(st2, d.id))).toEqual([`ev/car/${cars[0]!.id}`, `ev/car/${cars[1]!.id}`]);
  });

  it("名義の合う今の車が無いローンは、車の区画の下の区画に残す（今の車が無い世帯は、今までの見出しと足すボタン）", () => {
    const other = vary(BASE, (h) => {
      carLoan(h).debtors[0]!.member = h.members.find((m) => m.kind === "child")!.id;
    });
    const st = buildStage("car", other);
    const d = carLoan(other.request.input.household);
    expect(carOfLoan(st, d.id)).toBeNull();
    const rest = st.sections.find((s) => s.key === "car/loans")!;
    expect(rest.title).toBe("ほかの自動車ローン（名義の合う今の車がありません）");
    expect(rest.groups.some((g) => g.key === `housing/debt/${d.id}`)).toBe(true);

    const noCar = vary(BASE, (h) => {
      h.cars = [];
    });
    const st2 = buildStage("car", noCar);
    const rest2 = st2.sections.find((s) => s.key === "car/loans")!;
    expect(rest2.title).toBe("今返している自動車ローン");
    expect(actionsOf(st2).filter((a) => a.key === "car/addCarLoan").map((a) => a.label)).toEqual(["＋ 自動車ローン"]);
    expect(rest2.groups.some((g) => g.key === `housing/debt/${carLoan(noCar.request.input.household).id}`)).toBe(true);
  });

  it("車の枠の中の「＋ 今返しているローン」は、その車の名義のローンを足す（ほかの中身は変えない）", () => {
    const wh = vary(BASE, (h) => {
      h.debts = (h.debts ?? []).filter((d) => d.kind !== "car");
    });
    const h0 = wh.request.input.household;
    const car2 = h0.cars![1]!;
    const add = actionsOf(buildStage("car", wh)).find((a) => a.key === `ev/car/${car2.id}/addNowLoan`)!;
    expect(add).toMatchObject({ label: "＋ 今返しているローン", level: "simple" });
    const w1 = add.run(wh);
    const h1 = w1.request.input.household;
    const fresh = (h1.debts ?? []).filter((d) => !(h0.debts ?? []).some((x) => x.id === d.id));
    expect(fresh).toHaveLength(1);
    expect(fresh[0]).toMatchObject({ kind: "car", debtors: [{ member: car2.owner, role: "primary" }] });
    expect({ ...h1, debts: (h1.debts ?? []).filter((d) => d.id !== fresh[0]!.id) }).toEqual(h0);
    // 足したローンは、その車の枠の中に出る
    expect(carOfLoan(buildStage("car", w1), fresh[0]!.id)).toBe(`ev/car/${car2.id}`);
  });
});

describe("中枠に分けても、入力項目の画面の外では物の名前で言う", () => {
  const wh = vary(BASE, () => undefined);

  it("車・収益不動産・働き方の中枠は where に物の名前を持つ（見出しを短くした公的年金・確定申告も）", () => {
    const car = groupsOf(buildStage("car", wh)).filter((g) => g.band === true && g.key.includes("/band/"));
    expect(car.map((g) => g.title)).toEqual(expect.arrayContaining(["車と買い替え", "価格・買い方", "維持費"]));
    expect(car.every((g) => /^車 \d/.test(g.where ?? ""))).toBe(true);
    const work = groupsOf(buildStage("work", wh)).filter((g) => g.band === true && g.key.includes("/band/"));
    expect([...new Set(work.map((g) => g.title))]).toEqual(["期間と種類", "収入", "税・社会保険", "辞めるとき"]);
    expect(work.every((g) => (g.where ?? "").includes("働き方"))).toBe(true);
    const pension = groupsOf(buildStage("pension", wh)).filter((g) => g.title === "公的年金");
    expect(pension.map((g) => g.where)).toEqual(["ご本人の公的年金", "配偶者の公的年金"]);
  });

  it("確かめの一覧・入力の検索・書類の読み取り・プランの索引に、中枠の見出しだけの名前を出さない", () => {
    const bands = new Set(["車と買い替え", "価格・買い方", "維持費", "伸び方・万一のとき", "物件と評価額", "期間と種類", "収入", "税・社会保険", "辞めるとき", "公的年金", "確定申告"]);
    const check = checkList(wh).map((r) => r.label.split(": ")[0]!);
    expect(check.filter((x) => bands.has(x))).toEqual([]);
    const find = findEntries(wh, inputItems(wh)).filter((e) => e.target.kind === "field");
    expect(find.filter((e) => e.where !== null && bands.has(e.where)).map((e) => `${e.where}｜${e.label}`)).toEqual([]);
    expect(find.filter((e) => e.card === "car" && e.label === "車両の価格").map((e) => e.where)).toEqual(["車 1（ご本人・今の車）", "車 2（配偶者・今の車）"]);
    const places = fieldPlaces(wh).map((p) => p.label.split(" › ").at(-2) ?? "");
    expect(places.filter((x) => bands.has(x))).toEqual([]);
    const plan = [...planIndex([wh]).fields.values()].map((v) => v.where ?? "");
    expect(plan.filter((x) => bands.has(x))).toEqual([]);
  });
});

describe("保険の契約1件を中枠に分けるのは、詳細の画面で開く形だけ", () => {
  const wh = vary(BASE, () => undefined);
  const keysOf = (st: StageDef) => groupsOf(st).flatMap((g) => g.fields.map((f) => f.key)).sort();

  it("既定の形（標準の画面と、画面の外の一覧）は中枠なし。bands を付けた形は中枠ありで、欄と名前は同じ", () => {
    const plain = buildStage("insurance", wh);
    const banded = buildStage("insurance", wh, { bands: true });
    expect(groupsOf(plain).some((g) => g.key.includes("/band/"))).toBe(false);
    const titles = new Set(groupsOf(banded).filter((g) => g.key.includes("/band/")).map((g) => g.title));
    expect([...titles]).toEqual(expect.arrayContaining(["契約と保障", "保障の明細", "保険料"]));
    expect(keysOf(banded)).toEqual(keysOf(plain));
    const nameOf = (st: StageDef) => new Map(groupsOf(st).flatMap((g) => g.fields.map((f) => [f.key, g.where ?? g.title ?? ""] as const)));
    const a = nameOf(plain);
    for (const [k, v] of nameOf(banded)) expect([k, v]).toEqual([k, a.get(k)]);
  });
});

describe("足す・外すのボタンの言葉（「＋ 名詞」「外す」）", () => {
  const ids = readdirSync(join(REPO_DIR, "data", "modelHouseholds")).filter((f) => f.endsWith(".json")).map((f) => f.slice(0, -5)).sort();

  it("見本の世帯のどの入力項目にも、「＋ ○○を足す」「＋ ○○を入れる」「消す」「削除」のボタンが無い", () => {
    const bad = new Set<string>();
    for (const id of ids) {
      const wh = fromRequest(modelHousehold(id), {});
      for (const st of buildStages(wh))
        for (const a of actionsOf(st))
          for (const label of [a.label, a.choice?.label ?? ""]) if (/^＋.*を(足す|入れる)$/.test(label) || /消す|削除/.test(label)) bad.add(`${st.id}｜${label}`);
    }
    expect([...bad]).toEqual([]);
  });
});
