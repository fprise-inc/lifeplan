// 暗号資産を金融資産の器の種類にする（0122）: 貯蓄・運用の金融資産の「そのほか」から足す、欄（時点・積立・利回り。取得価額・資産の配分・
// 引き出せない期間は出さない）、取り崩しの順番に並べない、その他の資産から種類を変えたら増減率を利回りへ、資産と負債のタブで値動きのある運用、
// 相場の下落で選べる、探して開く、開いたときの知らせ
import { describe, expect, it } from "vitest";
import { h } from "preact";
import { renderToString } from "preact-render-to-string";
import type { Account } from "../src/engine/types.ts";
import { allFields, type FieldDef } from "../src/workspace/input/form.ts";
import { visible } from "../src/workspace/input/FieldViews.tsx";
import { fromRequest, type WorkingHousehold } from "../src/workspace/input/household.ts";
import { buildStage } from "../src/workspace/input/stages/index.ts";
import { accountMoreLabel } from "../src/workspace/input/stages/savings.ts";
import { SavingsPanel } from "../src/workspace/input/savings/SavingsPanel.tsx";
import { withdrawViewOf } from "../src/workspace/input/savings/model.ts";
import { findEntries, findInInput } from "../src/workspace/input/inputSearch.ts";
import { inputItems } from "../src/workspace/input/items.ts";
import { householdNoticeText } from "../src/workspace/header/status.ts";
import { addMarketDrop, CRYPTO_ASSET, hasInvested } from "../src/workspace/contingency/requests.ts";
import { MARKET_CLASS_OPTIONS } from "../src/workspace/contingency/inputs.ts";
import { breakdownOf } from "../src/workspace/invest/present.ts";
import { bsHouseholdOf, bsSeries } from "../../report/src/index.ts";
import { modelHousehold, preview } from "./helpers.ts";

const open = (): WorkingHousehold => fromRequest(modelHousehold("investmentCouple"));
const accountsSec = (wh: WorkingHousehold) => buildStage("savings", wh).sections.find((s) => s.key === "sav/accounts")!;
const fieldsOf = (wh: WorkingHousehold): Map<string, FieldDef> => new Map(allFields(buildStage("savings", wh)).map((f) => [f.key, f]));
const fieldOf = (wh: WorkingHousehold, key: string): FieldDef => {
  const f = fieldsOf(wh).get(key);
  if (f === undefined) throw new Error(`欄が無い: ${key}`);
  return f;
};
const addCrypto = (wh: WorkingHousehold): { wh: WorkingHousehold; a: Account } => {
  const next = accountsSec(wh).actions.find((x) => x.key === "sav/add/cryptoAsset")!.run(wh);
  const a = (next.request.input.household.accounts ?? []).filter((x) => x.kind === "cryptoAsset").at(-1) as Account;
  return { wh: next, a };
};
const accOf = (wh: WorkingHousehold, id: string) => (wh.request.input.household.accounts ?? []).find((x) => x.id === id) as Account;
const cell = (wh: WorkingHousehold, row: string, year: number) => preview(wh.request).table.filter((c) => c.row === row && c.year === year).reduce((s, c) => s + c.amount, 0);

describe("足す・欄（0122）", () => {
  it("金融資産の「そのほか」から足す（標準の4つには入れない）。名義は本人、残高は未入力の印", () => {
    const wh = open();
    const act = accountsSec(wh).actions.find((x) => x.key === "sav/add/cryptoAsset")!;
    expect(act.label).toBe("＋ 暗号資産");
    expect(visible("simple", act.level)).toBe(false);
    const html = renderToString(h(SavingsPanel, { wh, level: "simple", onEdit: () => undefined }));
    expect(html).toContain("そのほか ▾（財形・企業型DC・外貨預金・持株会・暗号資産・小規模企業共済・旧NISA など）");
    const { a } = addCrypto(wh);
    expect(a).toMatchObject({ kind: "cryptoAsset", contributions: [] });
    expect(a.marketValue?.state).not.toBe("confirmed");
    expect(a.assetMix).toBeUndefined();
    expect(a.costBasis).toBeUndefined();
  });

  it("欄: 種類・名義・残高・時点・積立・利回り。取得価額・資産の配分・引き出せない期間は出さない。利回りの空欄は0", () => {
    const { wh, a } = addCrypto(open());
    const keys = [...fieldsOf(wh).keys()].filter((k) => k.startsWith(`sav/${a.id}/`));
    expect(keys).toEqual([`sav/${a.id}/kind`, `sav/${a.id}/owner`, `sav/${a.id}/value`, `sav/${a.id}/asOf`, `sav/${a.id}/monthly`, `sav/${a.id}/rate`]);
    expect(fieldOf(wh, `sav/${a.id}/rate`).get(wh)).toMatchObject({ value: null, hint: "空欄: 年0.0%" });
    expect(fieldOf(wh, `sav/${a.id}/rate`).help).toContain("入れなければ0");
    const group = buildStage("savings", wh).sections.flatMap((s) => s.groups).find((g) => g.key === `sav/${a.id}`)!;
    expect(group.title).toMatch(/^暗号資産（/);
    expect(group.note).toContain("取り崩しには使いません");
    expect(buildStage("savings", wh).sections.flatMap((s) => s.groups).some((g) => g.key === `sav/${a.id}/addMix`)).toBe(false);
    expect(accountMoreLabel(a)).toBe("残高の時点を入れる");
  });

  it("その他の資産から種類を暗号資産に変えると、中身の細目を外し、評価額の増減率を利回りへ移す", () => {
    const wh0 = open();
    const sec = buildStage("savings", wh0).sections.find((s) => s.key === "sav/others")!;
    let wh = sec.actions.find((x) => x.key === "sav/add/otherAsset")!.run(wh0);
    const a = (wh.request.input.household.accounts ?? []).find((x) => x.kind === "otherAsset") as Account;
    wh = fieldOf(wh, `sav/${a.id}/subtype`).set(wh, "preciousMetal");
    wh = fieldOf(wh, `sav/${a.id}/growth`).set(wh, "0.03");
    wh = fieldOf(wh, `sav/${a.id}/kind`).set(wh, "cryptoAsset");
    const x = accOf(wh, a.id);
    expect(x.kind).toBe("cryptoAsset");
    expect(x.subtype).toBeUndefined();
    expect(x.valueGrowth).toBeUndefined();
    expect(x.expectedReturn).toBe("0.03");
  });
});

describe("計算（0122）", () => {
  it("金融資産の合計に入り、積立で増え、取り崩しの順番には並ばない", () => {
    const added = addCrypto(open());
    const a = added.a;
    let wh = added.wh;
    wh = fieldOf(wh, `sav/${a.id}/value`).set(wh, 1_000_000);
    const y = Number(wh.request.input.baseMonth.slice(0, 4)) + 1;
    expect(cell(wh, "cf.balance.account.cryptoAsset", y)).toBe(1_000_000);
    const before = cell(open(), "cf.balance.financial", y);
    expect(cell(wh, "cf.balance.financial", y)).toBe(before + 1_000_000);
    wh = fieldOf(wh, `sav/${a.id}/monthly`).set(wh, 10_000);
    expect(cell(wh, "cf.balance.account.cryptoAsset", y)).toBeGreaterThan(1_000_000);
    const v = withdrawViewOf(wh.request);
    expect([...v.included, ...v.excluded].some((x) => x.id === a.id)).toBe(false);
    // 資産の推移の口座の内訳は「課税口座など」に入る
    const years = [y];
    const tax = breakdownOf(preview(wh.request).table, years).find((s) => s.key === "tax");
    expect(tax?.values[0]).toBeGreaterThanOrEqual(cell(wh, "cf.balance.account.cryptoAsset", y));
  });

  it("資産と負債のタブ: 値動きのある運用の項目「暗号資産」（金融資産に数える）", () => {
    const table = [
      { row: "cf.balance.account.deposit", year: 2026, amount: 5_000_000 },
      { row: "cf.balance.account.cryptoAsset", year: 2026, amount: 800_000, object: "btc" },
    ];
    const [at] = bsSeries(table, [2026], bsHouseholdOf({ accounts: [{ id: "btc", kind: "cryptoAsset" }] }));
    expect(at!.lines.map((l) => [l.key, l.label, l.group, l.amount])).toEqual([
      ["deposit", "預金", "liquid", 5_000_000],
      ["cryptoAsset", "暗号資産", "market", 800_000],
    ]);
    expect(at!.financial).toBe(5_800_000);
  });

  it("相場の下落: 下げる資産に「暗号資産」を選べる（既定には入れない）。選ぶと器ごと下げる", () => {
    expect(MARKET_CLASS_OPTIONS.find((o) => o.value === CRYPTO_ASSET)?.label).toBe("暗号資産");
    const added = addCrypto(open());
    expect(hasInvested(added.wh.request.input.household)).toBe(true);
    const req = structuredClone(added.wh.request);
    addMarketDrop(req, { market: { classes: [CRYPTO_ASSET], drop: "0.5" } } as never, 2030);
    expect(req.input.assumptions?.marketShocks).toEqual([{ year: 2030, drop: "0.5", kinds: ["cryptoAsset"] }]);
    const dflt = structuredClone(added.wh.request);
    addMarketDrop(dflt, {} as never, 2030);
    expect(JSON.stringify(dflt.input.assumptions?.marketShocks)).not.toContain("cryptoAsset");
  });
});

describe("探して開く・知らせ（0122）", () => {
  it("暗号資産・仮想通貨・ビットコインで、貯蓄・運用の暗号資産を出す（その他の資産には出さない）", () => {
    const { wh } = addCrypto(open());
    for (const q of ["暗号資産", "仮想通貨", "ビットコイン"]) {
      const hit = findInInput(findEntries(wh, inputItems(wh)), q)[0]!;
      expect(hit.card, q).toBe("savings");
      expect(hit.label, q).toContain("暗号資産");
    }
  });

  it("開いたときの知らせ: 移した数とプランの変更の数", () => {
    const t = householdNoticeText({ kind: "cryptoAccounts", count: 1, plans: 2 })!;
    expect(t.title).toBe("暗号資産を金融資産の口座にしました");
    expect(t.text).toContain("（1件とプランの変更 2件）");
    expect(t.text).toContain("取り崩しには使いません");
  });
});
