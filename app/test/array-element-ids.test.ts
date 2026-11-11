// 前は要素の ID を持たなかった並びの要素の ID（0206）: 器の資産の配分の行・器の利回りの段階の資産の配分の行・旧NISA の買付の年ごとの内訳・
// 借り換えとその新しい金利の段。開くとき（ID の無い古いデータ）は、画面がその要素を指していた決まった ID（場所から作る）と同じ ID を振り、
// 本体の 0.75 → 0.76 の変換の段も同じ ID を振る。画面で行を足す・外す・直しても、ほかの行の ID は変わらない
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { Account, EngineRequest } from "../src/engine/types.ts";
import { fromRequest, withElementIds, type WorkingHousehold } from "../src/workspace/input/household.ts";
import { addHomeRefinance } from "../src/workspace/input/stages/housingLoans.ts";
import { buildStage } from "../src/workspace/input/stages/index.ts";
import type { StageId } from "../src/workspace/input/form.ts";
import { buildCatalog } from "../src/workspace/plans/items.ts";
import { bodyOf, fromBody } from "../src/workspace/store/body.ts";
import { giveElementIds } from "../src/workspace/store/elementIds.ts";
import { migrationId, resolveKey } from "../src/workspace/store/readings.ts";
import { roles } from "../src/workspace/roles.ts";
import { modelHousehold } from "./helpers.ts";

const REPO = join(import.meta.dirname, "..", "..");
const FORMATS = join(REPO, "crates", "household-store", "tests", "fixtures", "household-format");
type Obj = Record<string, unknown>;
type Body = { household: { request: { input: { household: { accounts?: Obj[]; debts?: Obj[] } } } } };

/** 新しく ID を持つ並びの要素（器の ID・負債の ID と、並びの中の場所） */
function elementsOf(input: EngineRequest["input"] | Body["household"]["request"]["input"]): { place: string; el: Obj }[] {
  const h = input.household as { accounts?: Obj[]; debts?: Obj[] };
  const out: { place: string; el: Obj }[] = [];
  const list = (v: unknown): Obj[] => (Array.isArray(v) ? (v as Obj[]) : []);
  for (const a of h.accounts ?? []) {
    list(a.assetMix).forEach((el, i) => out.push({ place: `${a.id as string}/assetMix/${i}`, el }));
    list(a.lots).forEach((el, i) => out.push({ place: `${a.id as string}/lots/${i}`, el }));
    for (const s of list(a.returnStages)) list(s.assetMix).forEach((el, i) => out.push({ place: `${s.id as string}/assetMix/${i}`, el }));
  }
  for (const d of h.debts ?? []) {
    list(d.refinance).forEach((r, i) => {
      out.push({ place: `${d.id as string}/refinance/${i}`, el: r });
      list(r.rateSchedule).forEach((el, j) => out.push({ place: `${d.id as string}/refinance/${i}/rateSchedule/${j}`, el }));
    });
  }
  return out;
}

const sampleIds = () => readdirSync(join(REPO, "data", "modelHouseholds")).filter((f) => f.endsWith(".json")).map((f) => f.slice(0, -5));

describe("並びの要素の ID（0206）", () => {
  it("見本の世帯を開くと、資産の配分の行・買付の年ごとの内訳・借り換えとその金利の段が ID を持ち、ID は前に画面が指していた決まった ID と同じ", () => {
    let rows = 0;
    let keys = 0;
    for (const id of sampleIds()) {
      const raw = modelHousehold(id);
      const wh = fromRequest(raw);
      for (const { place, el } of elementsOf(wh.request.input)) {
        rows++;
        expect(el.id, `${id} ${place}`).toBe(migrationId(place));
      }
      // 動かす項目の当て先（場所 at）が、ID を振る前の世帯（決まった ID で指していた）と同じ: 保存したプランの差分・値の状態の欄は同じ行を指したまま
      const self = roles(raw).find((r) => r.key === "self");
      if (self === undefined) continue;
      for (const it of buildCatalog(wh, self.member.id, null).items) {
        if (!/\/(mix|lot|refinance|rstage)\//.test(it.key)) continue;
        keys++;
        expect(resolveKey(it.key, wh.request.input as unknown as Obj), `${id} ${it.key}`).toEqual(resolveKey(it.key, raw.input as unknown as Obj));
      }
    }
    expect(rows).toBeGreaterThan(50);
    expect(keys).toBeGreaterThan(60);
  });

  it("ID の無い借り換えの中の金利の段は借り換えの番号の場所から、ID のある借り換えの中はその ID から（決まった ID の作り方と同じ）。ID のある要素は変えない", () => {
    const input = {
      household: {
        debts: [
          {
            id: "d1",
            refinance: [
              { at: { at: "2030-01" }, rateSchedule: [{ from: { at: "2030-01" }, type: "fixed", rate: "0.01" }], termMonths: 120 },
              { id: "r2", at: { at: "2035-01" }, rateSchedule: [{ from: { at: "2035-01" }, type: "fixed", rate: "0.01" }, { id: "kept", from: { at: "2040-01" }, type: "fixed", rate: "0.02" }], termMonths: 120 },
            ],
          },
        ],
        accounts: [{ id: "a1", returnStages: [{ id: "s1", at: { at: "2040-01" }, assetMix: [{ assetClass: "cash.deposit", share: "1" }] }] }],
      },
    };
    giveElementIds(input as unknown as Obj);
    const [r1, r2] = input.household.debts[0]!.refinance as Obj[] as { id?: string; rateSchedule: { id?: string }[] }[];
    expect(r1!.id).toBe(migrationId("d1/refinance/0"));
    expect(r1!.rateSchedule[0]!.id).toBe(migrationId("d1/refinance/0/rateSchedule/0"));
    expect(r2!.id).toBe("r2");
    expect(r2!.rateSchedule.map((x) => x.id)).toEqual([migrationId("r2/rateSchedule/0"), "kept"]);
    expect((input.household.accounts[0]!.returnStages[0]!.assetMix[0] as { id?: string }).id).toBe(migrationId("s1/assetMix/0"));
  });

  it("0.75 の見本の世帯ファイル（ID の無い形）を読むと ID が付き、書き戻して読み直しても1文字も変わらない", () => {
    const text = readFileSync(join(FORMATS, "0.75", "body.json"), "utf8");
    const old = JSON.parse(text) as Body;
    expect(elementsOf(old.household.request.input).every(({ el }) => el.id === undefined)).toBe(true);
    const saved = bodyOf(fromBody(text));
    const stored = JSON.parse(saved) as Body;
    const els = elementsOf(stored.household.request.input);
    expect(els.length).toBeGreaterThan(10);
    for (const { place, el } of els) expect(el.id, place).toBe(migrationId(place));
    expect(bodyOf(fromBody(saved))).toBe(saved);
  });

  it("本体の 0.75 → 0.76 の段と同じ ID（0.76 の見本は、0.75 の見本に借り換えを足して本体が変換した形）", () => {
    const now = JSON.parse(readFileSync(join(FORMATS, "0.76", "body.json"), "utf8")) as Body;
    const before = JSON.parse(readFileSync(join(FORMATS, "0.75", "body.json"), "utf8")) as Body;
    const debt = before.household.request.input.household.debts!.find((d) => d.kind === "mortgage")!;
    debt.refinance = [{ at: { at: "2031-04" }, rateSchedule: [{ from: { at: "2031-04" }, type: "fixed", rate: "0.012" }], termMonths: 240, costs: 500000 }];
    giveElementIds(before.household.request.input as unknown as Obj);
    const pick = (b: Body) => elementsOf(b.household.request.input).map(({ place, el }) => [place, el.id]);
    expect(pick(now).length).toBeGreaterThan(10);
    expect(pick(before)).toEqual(pick(now));
    expect(now.household.request.input).toEqual(before.household.request.input);
  });
});

describe("画面で行を足す・外す・直しても、ほかの行の ID は変わらない（0206）", () => {
  const actionOf = (stage: StageId, wh: WorkingHousehold, key: string) => {
    const st = buildStage(stage, wh);
    const a = st.sections.flatMap((s) => [...s.actions, ...s.groups.flatMap((g) => g.actions)]).find((x) => x.key === key);
    if (a === undefined) throw new Error(`操作が無い: ${key}`);
    return a;
  };
  /** 画面が開き直すときと同じく、新しく足した要素に乱数の ID を振る（App.tsx の openedFrom） */
  const reopen = (wh: WorkingHousehold): WorkingHousehold => ({ ...wh, request: withElementIds(wh.request, true) });
  const ACC = "03c2def7-bbb4-4402-a039-abdb08cc570d"; // dualAssetsTwoKids の NISA（3行）
  const mixIds = (wh: WorkingHousehold) => (wh.request.input.household.accounts!.find((a) => a.id === ACC) as Account).assetMix!.map((m) => m.id);

  it("資産の配分の行: 外すと残りの行の ID はそのまま、足した行には新しい ID", () => {
    let wh = fromRequest(modelHousehold("dualAssetsTwoKids"));
    const [a, b, c] = mixIds(wh);
    wh = reopen(actionOf("savings", wh, `sav/${ACC}/mix/0/remove`).run(wh));
    expect(mixIds(wh)).toEqual([b, c]);
    wh = reopen(actionOf("savings", wh, `sav/${ACC}/addMixRow`).run(wh));
    const after = mixIds(wh);
    expect(after.slice(0, 2)).toEqual([b, c]);
    expect(after[2]).toMatch(/^[0-9a-f-]{36}$/);
    expect([a, b, c]).not.toContain(after[2]);
  });

  it("プランの資産運用の配分（全体の値）を当てても、同じ資産の種類の行の ID を引き継ぐ", () => {
    const wh = fromRequest(modelHousehold("dualAssetsTwoKids"));
    const self = roles(wh.request).find((r) => r.key === "self")!.member.id;
    const cat = buildCatalog(wh, self, null);
    const it = cat.items.find((x) => x.key === `mix:${ACC}`)!;
    const before = (wh.request.input.household.accounts!.find((a) => a.id === ACC) as Account).assetMix!;
    const turned = [...before].reverse().map((m) => ({ assetClass: m.assetClass, share: m.share }));
    const out = it.apply(wh, [...turned, { assetClass: "cash.deposit", share: "0" }]);
    const mix = (out.request.input.household.accounts!.find((a) => a.id === ACC) as Account).assetMix!;
    expect(mix.slice(0, 3).map((m) => m.id)).toEqual([...before].reverse().map((m) => m.id));
    expect(mix[3]!.id).toBeUndefined();
  });

  it("旧NISA の買付の年ごとの内訳: 足した行には新しい ID、外すとほかの行の ID はそのまま", () => {
    let wh = fromRequest(modelHousehold("nisaWithdrawal"));
    const acc = wh.request.input.household.accounts!.find((a) => Array.isArray((a as { lots?: unknown }).lots))!;
    const lotIds = (w: WorkingHousehold) => ((w.request.input.household.accounts!.find((a) => a.id === acc.id) as unknown as { lots?: { id?: string }[] }).lots ?? []).map((l) => l.id);
    const [first, second] = lotIds(wh);
    expect(first).toBe(migrationId(`${acc.id}/lots/0`));
    wh = reopen(actionOf("savings", wh, `sav/${acc.id}/addLotRow`).run(wh));
    const added = lotIds(wh)[2];
    expect(added).toMatch(/^[0-9a-f-]{36}$/);
    wh = reopen(actionOf("savings", wh, `sav/${acc.id}/lot/0/remove`).run(wh));
    expect(lotIds(wh)).toEqual([second, added]);
  });

  it("借り換え: 足した借り換えと金利の段には新しい ID、前の借り換えの ID はそのまま。外すとほかの借り換えの ID はそのまま", () => {
    let wh = fromRequest(modelHousehold("pairLoan"));
    const debt = wh.request.input.household.debts!.find((d) => (d.refinance ?? []).length > 0)!;
    const refis = (w: WorkingHousehold) => w.request.input.household.debts!.find((d) => d.id === debt.id)!.refinance ?? [];
    const old = refis(wh)[0]!;
    expect(old.id).toBe(migrationId(`${debt.id}/refinance/0`));
    wh = reopen(addHomeRefinance(wh, debt.id));
    const [kept, added] = refis(wh);
    expect(kept).toEqual(old);
    expect(added!.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(added!.rateSchedule[0]!.id).toMatch(/^[0-9a-f-]{36}$/);
    wh = reopen(actionOf("housing", wh, `housing/debt/${debt.id}/refinance/0/remove`).run(wh));
    expect(refis(wh)).toEqual([added]);
  });
});
