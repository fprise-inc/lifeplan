// 世帯の外の家族（0035 の4・8）: 介護・親のカードで足した親の印・家計を1つにする期間の欄・生活費の目安の人数・開いたときの知らせ
import { describe, expect, it } from "vitest";
import { barNotices, type BarInputs } from "../src/workspace/header/status.ts";
import { allFields, type GroupDef } from "../src/workspace/input/form.ts";
import { householdSize } from "../src/workspace/input/estimates.ts";
import { fromRequest, type WorkingHousehold } from "../src/workspace/input/household.ts";
import { addMember } from "../src/workspace/input/stages/family.ts";
import { buildStage } from "../src/workspace/input/stages/index.ts";
import { fieldAddress, fieldStatus } from "../src/workspace/input/valueState.ts";
import { boxAt, writeAt } from "../src/workspace/plans/diffs.ts";
import { eventsOf, walletDepletions } from "../src/workspace/present.ts";
import { buildCatalog } from "../src/workspace/plans/items.ts";
import { diffRows, fieldMark, planView, recordPlanEdit, revertField } from "../src/workspace/plans/planEdit.ts";
import { roles } from "../src/workspace/roles.ts";
import { modelHousehold, preview } from "./helpers.ts";

// 世帯の外の家族は介護・親のカードに出す（家族のカードは読むだけの1行。0045）
const groups = (wh: WorkingHousehold): GroupDef[] => buildStage("care", wh).sections.flatMap((s) => s.groups);
// 親のお金の操作は区画「親のお金が持つか」（見ていない人の「＋ 見る」は区画の操作、見ている人の操作はその人のお金のまとまり）
const walletActions = (wh: WorkingHousehold, id: string) => {
  const sec = buildStage("care", wh).sections.find((s) => s.key === "care/wallet")!;
  return [...sec.actions, ...(sec.groups.find((g) => g.key === `care/wallet/${id}`)?.actions ?? [])];
};

describe("介護・親のカードの世帯の外の家族", () => {
  it("親を足すと世帯の外の家族の印（本人の家族・家計を1つにする期間なし）が付く", () => {
    const wh = fromRequest(modelHousehold("salariedCoupleTwoKids"));
    const self = wh.request.input.household.members.find((m) => m.kind === "self")!;
    const next = addMember(wh, "parent");
    const p = next.request.input.household.members.at(-1)!;
    expect(p.kind).toBe("parent");
    expect(p.outside).toEqual({ of: self.id, periods: [] });
  });

  it("家計を1つにする期間を足し、収入を世帯に入れると、その間の親の年金が世帯の収入に入る", () => {
    const wh = fromRequest(modelHousehold("parentCare"));
    const parent = wh.request.input.household.members.find((m) => m.kind === "parent")!;
    const g = groups(wh).find((x) => x.key === `family/${parent.id}`)!;
    expect(g.note).toContain("世帯の外の家族");
    const add = g.actions.find((a) => a.key === `family/${parent.id}/outside/addPeriod`)!;
    const withPeriod = add.run(wh);
    const fields = allFields(buildStage("care", withPeriod));
    const income = fields.find((f) => f.key === `family/${parent.id}/outside/income`)!;
    const on = income.set(withPeriod, true);
    expect(on.request.input.household.members.find((m) => m.id === parent.id)!.outside!.periods[0]).toMatchObject({ living: true, income: true });
    const pension = (r: ReturnType<typeof preview>) => r.table.filter((c) => c.member === parent.id && c.row.startsWith("cf.income")).reduce((s, c) => s + c.amount, 0);
    expect(pension(preview(wh.request))).toBe(0);
    expect(pension(preview(on.request))).toBeGreaterThan(0);
  });

  it("生活費の目安の人数は、世帯の外の家族を生活費の人数に入れる期間だけ数える", () => {
    const wh = fromRequest(modelHousehold("parentCare"));
    const h = wh.request.input.household;
    const base = wh.request.input.baseMonth;
    const n = householdSize(h, base);
    const parent = h.members.find((m) => m.kind === "parent")!;
    const living = { ...h, members: h.members.map((m) => (m.id === parent.id ? { ...m, outside: { ...m.outside!, periods: [{ from: null, to: null, living: true, income: false }] } } : m)) };
    expect(householdSize(living, base)).toBe(n + 1);
  });
});

describe("世帯の外の家族のお金（0042）", () => {
  const CARE = "e1169764-5414-4445-b691-9df2bf027667";
  const careByHousehold = (r: ReturnType<typeof preview>) => r.table.filter((c) => c.object === CARE).reduce((s, c) => s + c.amount, 0);

  it("新しく足した親にはお金の欄を出し、預金・生活費は未入力（推定は入れない）。預金が空のあいだは計算が変わらない", () => {
    const wh = fromRequest(modelHousehold("parentCare"));
    const next = addMember(wh, "parent");
    const p = next.request.input.household.members.at(-1)!;
    expect(p.wallet).toEqual({});
    const fields = allFields(buildStage("care", next));
    for (const k of ["balance", "living"]) expect(fieldStatus(fields.find((f) => f.key === `family/${p.id}/wallet/${k}`)!, next).status).toBe("missing");
    expect(fieldStatus(fields.find((f) => f.key === `family/${p.id}/wallet/pension`)!, next).status).not.toBe("missing");
    expect(preview(next.request).summary).toEqual(preview(addMember(wh, "parent").request).summary);
  });

  it("前からの世帯（お金の欄が無い）は今と同じ。「＋ この人のお金を入れる」で欄を出し、預金を入れると介護の費用をまず親のお金から払う", () => {
    const wh = fromRequest(modelHousehold("parentCare"));
    const parent = wh.request.input.household.members.find((m) => m.kind === "parent")!;
    expect(parent.wallet).toBeUndefined();
    const opened = walletActions(wh, parent.id).find((a) => a.key === `family/${parent.id}/wallet/add`)!.run(wh);
    const f = (w: WorkingHousehold, k: string) => allFields(buildStage("care", w)).find((x) => x.key === `family/${parent.id}/wallet/${k}`)!;
    let w = f(opened, "balance").set(opened, 3000000);
    w = f(w, "living").set(w, 200000);
    const before = preview(wh.request);
    const after = preview(w.request);
    expect(careByHousehold(after)).toBeLessThan(careByHousehold(before));
    const dep = walletDepletions(after.summary);
    expect(dep).toEqual([{ member: parent.id, depleted: expect.stringMatching(/^\d{4}-\d{2}$/) as unknown as string }]);
    // 結果のできごとに「尽きる見込み」を出す
    const years = Array.from({ length: 2040 - 2026 + 1 }, (_, i) => 2026 + i);
    const chips = eventsOf(w.request, after.table, years, after.summary).filter((c) => c.icon === "親");
    expect(chips).toHaveLength(1);
    expect(chips[0]!.text).toContain("お母さまのお金が尽きる見込み");
    // 外すと元に戻る
    const removed = walletActions(w, parent.id).find((a) => a.key === `family/${parent.id}/wallet/remove`)!.run(w);
    expect(careByHousehold(preview(removed.request))).toBe(careByHousehold(before));
  });

  it("お金の欄は当て先（構成員・member.wallet・場所）を持ち、プランの差分で指せる。一時の入金を足して外せる", () => {
    const wh = fromRequest(modelHousehold("parentMoney"));
    const parent = wh.request.input.household.members.find((m) => m.kind === "parent")!;
    const fields = allFields(buildStage("care", wh));
    const balance = fields.find((x) => x.key === `family/${parent.id}/wallet/balance`)!;
    const a = fieldAddress(balance, wh)!;
    expect(a).toEqual({ target: { member: parent.id }, item: "member.wallet", at: ["balance"] });
    const input = structuredClone(wh.request.input) as unknown as Record<string, unknown>;
    expect(boxAt(input, a)?.value).toBe(5000000);
    expect(writeAt(input, a, { value: 4000000, state: "confirmed", origin: { kind: "manual" } })).toBe(true);
    expect(boxAt(input, a)?.value).toBe(4000000);
    const lump = parent.wallet!.lumpSums![0]!;
    expect(fieldAddress(fields.find((x) => x.key === `family/${parent.id}/wallet/lump/${lump.id}/amount`)!, wh)).toEqual({ target: { member: parent.id }, item: "member.wallet", at: ["lumpSums", lump.id, "amount"] });
    const acts = walletActions(wh, parent.id);
    const added = acts.find((x) => x.key === `family/${parent.id}/wallet/addLump`)!.run(wh);
    const ls = added.request.input.household.members.find((m) => m.id === parent.id)!.wallet!.lumpSums!;
    expect(ls).toHaveLength(2);
    expect(fieldStatus(allFields(buildStage("care", added)).find((x) => x.key === `family/${parent.id}/wallet/lump/${ls[1]!.id}/amount`)!, added).status).toBe("missing");
    const gone = walletActions(added, parent.id).find((x) => x.key === `family/${parent.id}/wallet/lump/${lump.id}/remove`)!.run(added);
    expect(gone.request.input.household.members.find((m) => m.id === parent.id)!.wallet!.lumpSums!.map((l) => l.id)).toEqual([ls[1]!.id]);
  });
});

describe("世帯の外の家族のお金をプランで直す（0043）", () => {
  const setup = () => {
    const req = modelHousehold("parentMoney");
    const wh0 = fromRequest(req, {});
    const wh: WorkingHousehold = { ...wh0, proposals: [{ id: "B", name: "プランB", createdAt: "2026-10-26T00:00:00Z", updatedAt: "2026-10-26T00:00:00Z", base: null, tags: [], diffs: [] }] };
    const cat = buildCatalog(wh, roles(req).find((r) => r.key === "self")!.member.id, null);
    const parent = wh.request.input.household.members.find((m) => m.kind === "parent")!;
    return { wh, cat, parent };
  };
  const fieldOf = (w: WorkingHousehold, key: string) => allFields(buildStage("care", w)).find((x) => x.key === key)!;

  it("預金を直すとそのプランの差分（構成員・member.wallet・balance）になり、欄に印が付き、戻すと消える。現状は変わらない", () => {
    const { wh, cat, parent } = setup();
    const view = planView(wh, cat, "B");
    const key = `family/${parent.id}/wallet/balance`;
    const edited = fieldOf(view, key).set(view, 2000000);
    const w = recordPlanEdit(wh, cat, "B", view, edited);
    expect(w.request).toEqual(wh.request);
    expect(w.proposals[0]!.diffs.map((d) => [d.op, d.target, d.item, d.at])).toEqual([["set", { member: parent.id }, "member.wallet", ["balance"]]]);
    const v2 = planView(w, cat, "B");
    expect(fieldOf(v2, key).get(v2).value).toBe(2000000);
    expect(fieldMark(w, cat, "B", fieldOf(v2, key), v2)?.kind).toBe("own");
    expect(diffRows(w, cat, "B").length).toBeGreaterThan(0);
    // プランの中では親のお金が早く尽きる
    const now = walletDepletions(preview(wh.request).summary)[0]!.depleted;
    const inPlan = walletDepletions(preview(v2.request).summary)[0]!.depleted;
    expect(inPlan < now).toBe(true);
    const back = revertField(w, cat, "B", fieldOf(v2, key), v2);
    expect(back.proposals[0]!.diffs).toEqual([]);
    expect(fieldMark(back, cat, "B", fieldOf(planView(back, cat, "B"), key), planView(back, cat, "B"))).toBeNull();
  });

  it("一時の入金をプランで足すと、並びの要素を足す差分になる。お金を外すと、その人のお金の欄の差分になる", () => {
    const { wh, cat, parent } = setup();
    const view = planView(wh, cat, "B");
    const added = walletActions(view, parent.id).find((a) => a.key === `family/${parent.id}/wallet/addLump`)!.run(view);
    const w = recordPlanEdit(wh, cat, "B", view, added);
    expect(w.request).toEqual(wh.request);
    const ds = w.proposals[0]!.diffs;
    expect(ds.map((d) => [d.op, d.item, d.at])).toEqual([["add", "member.wallet", ["lumpSums"]]]);
    expect(planView(w, cat, "B").request.input.household.members.find((m) => m.id === parent.id)!.wallet!.lumpSums).toHaveLength(2);
    const removed = walletActions(view, parent.id).find((a) => a.key === `family/${parent.id}/wallet/remove`)!.run(view);
    const w2 = recordPlanEdit(wh, cat, "B", view, removed);
    expect(w2.request).toEqual(wh.request);
    expect(w2.proposals[0]!.diffs.length).toBeGreaterThan(0);
    expect(w2.proposals[0]!.diffs.every((d) => d.item === "member.wallet" || d.item === null)).toBe(true);
    expect(planView(w2, cat, "B").request.input.household.members.find((m) => m.id === parent.id)!.wallet).toBeUndefined();
  });
});

describe("開いたときの知らせ（0035 の8）", () => {
  it("親を世帯の外の家族にした知らせを、通知に出す", () => {
    const i: BarInputs = { opened: true, stored: true, save: { kind: "idle" } as never, paused: false, aiSharing: false, storage: [], showing: { recovery: false, office: false, storage: false }, presence: null, message: (c) => c, household: [{ id: "n1", kind: "outsideFamily" }] };
    const ns = barNotices(i);
    expect(ns).toHaveLength(1);
    expect(ns[0]).toMatchObject({ id: "household:n1", target: "family", action: "介護・親のカード" });
    expect(ns[0]!.text).toContain("世帯の外の家族");
  });
});
