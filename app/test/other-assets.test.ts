// その他の資産の入口と中身（0120）: 貯蓄・運用の「その他の資産」の区画を何も無い世帯でも標準で出す（見出しと足すボタンだけ）、
// その他の資産の中身の細目（貴金属・暗号資産・美術品や骨董品・会員権・敷金や保証金・事業用の資産・その他）、資産と負債のタブ・提案書の
// バランスシートの行を中身ごとに分ける（同じ中身はまとめる）、細目は計算に使わない
import { describe, expect, it } from "vitest";
import { h } from "preact";
import { renderToString } from "preact-render-to-string";
import type { Account } from "../src/engine/types.ts";
import { allFields, type FieldDef } from "../src/workspace/input/form.ts";
import { visible } from "../src/workspace/input/FieldViews.tsx";
import { fromRequest, type WorkingHousehold } from "../src/workspace/input/household.ts";
import { buildStage } from "../src/workspace/input/stages/index.ts";
import { SavingsPanel } from "../src/workspace/input/savings/SavingsPanel.tsx";
import { inputItems } from "../src/workspace/input/items.ts";
import { OTHER_ASSET_OPTIONS } from "../src/workspace/input/labels.ts";
import { bsHouseholdOf, bsSeries } from "../../report/src/index.ts";
import { sheetOf } from "../../report/src/build.ts";
import { modelHousehold, preview } from "./helpers.ts";

const open = (): WorkingHousehold => fromRequest(modelHousehold("investmentCouple"));
const others = (wh: WorkingHousehold) => buildStage("savings", wh).sections.find((s) => s.key === "sav/others")!;
const fieldsOf = (wh: WorkingHousehold): Map<string, FieldDef> => new Map(allFields(buildStage("savings", wh)).map((f) => [f.key, f]));
const fieldOf = (wh: WorkingHousehold, key: string): FieldDef => {
  const f = fieldsOf(wh).get(key);
  if (f === undefined) throw new Error(`欄が無い: ${key}`);
  return f;
};
const addOther = (wh: WorkingHousehold): { wh: WorkingHousehold; a: Account } => {
  const next = others(wh).actions.find((x) => x.key === "sav/add/otherAsset")!.run(wh);
  const a = (next.request.input.household.accounts ?? []).filter((x) => x.kind === "otherAsset").at(-1) as Account;
  return { wh: next, a };
};
const accOf = (wh: WorkingHousehold, id: string) => (wh.request.input.household.accounts ?? []).find((x) => x.id === id) as Account;

describe("入口: 貯蓄・運用の「その他の資産」の区画（0120）", () => {
  it("何も無い世帯でも標準で出し、見出し・「?」の説明・足すボタン2つだけ（まとまりは無い）", () => {
    const wh = open();
    expect((wh.request.input.household.accounts ?? []).some((a) => a.kind === "otherAsset" || a.kind === "realEstate")).toBe(false);
    const sec = others(wh);
    expect(visible("simple", sec.level)).toBe(true);
    expect(sec.groups).toEqual([]);
    expect(sec.actions.map((a) => [a.key, a.label, visible("simple", a.level)])).toEqual([
      ["sav/add/realEstate", "＋ 貸していない不動産（土地・別荘など）", true],
      ["sav/add/otherAsset", "＋ その他の資産（貴金属・会員権など）", true],
    ]);
    const html = renderToString(h(SavingsPanel, { wh, level: "simple", onEdit: () => undefined }));
    expect(html).toContain('data-section="sav/others"');
    expect(html).toContain("＋ その他の資産（貴金属・会員権など）");
    // 説明の文は画面に常には出さない（「?」の中。0077）
    const part = html.slice(html.indexOf('data-section="sav/others"'));
    expect(part).toContain('class="help-pop" hidden');
    expect(part).not.toContain('class="in-note');
  });

  it("入力のホームの貯蓄・運用のカード: 不動産・その他の資産を入れたら、そのうちの額を下の小さな1行に出す（入れていなければ出さない）", () => {
    const card = (w: WorkingHousehold) => inputItems(w).find((x) => x.id === "savings")!;
    expect(card(open()).summary?.note).toBeUndefined();
    const added = addOther(open());
    const a = added.a;
    let wh = added.wh;
    wh = fieldOf(wh, `sav/${a.id}/value`).set(wh, 3_000_000);
    expect(card(wh).summary?.note).toBe("うち不動産・その他の資産 300万円");
  });
});

describe("その他の資産の中身の細目（0120）", () => {
  it("中身の選択肢は6つと「その他」。空は「その他」（細目を書かない）", () => {
    expect(OTHER_ASSET_OPTIONS.map((o) => o.label)).toEqual(["貴金属（金・プラチナなど）", "暗号資産（ビットコインなど）", "美術品・骨董品", "会員権（ゴルフ・リゾートなど）", "敷金・保証金", "事業用の資産（設備・在庫など）", "その他"]);
    const { wh, a } = addOther(open());
    expect(a.subtype).toBeUndefined();
    expect(fieldOf(wh, `sav/${a.id}/subtype`).get(wh)).toMatchObject({ value: "other", implicit: true });
    expect(others(wh).groups[0]?.title).toMatch(/^その他の資産（/);
  });

  it("中身を選ぶと細目を書き、見出しが中身の名前になる。「その他」に戻すと細目を外す。種類を変えたら細目を外す", () => {
    const added = addOther(open());
    const a = added.a;
    let wh = added.wh;
    wh = fieldOf(wh, `sav/${a.id}/subtype`).set(wh, "preciousMetal");
    expect(accOf(wh, a.id).subtype).toBe("preciousMetal");
    expect(others(wh).groups[0]?.title).toMatch(/^貴金属（/);
    expect(fieldOf(wh, `sav/${a.id}/subtype`).help).toContain("買取の価格");
    // 増減率と種類の欄は残す（細目は計算に使わない）
    expect(fieldsOf(wh).has(`sav/${a.id}/growth`)).toBe(true);
    wh = fieldOf(wh, `sav/${a.id}/subtype`).set(wh, "other");
    expect(accOf(wh, a.id).subtype).toBeUndefined();
    wh = fieldOf(wh, `sav/${a.id}/subtype`).set(wh, "membership");
    wh = fieldOf(wh, `sav/${a.id}/kind`).set(wh, "realEstate");
    expect(accOf(wh, a.id)).toMatchObject({ kind: "realEstate" });
    expect(accOf(wh, a.id).subtype).toBeUndefined();
    expect(fieldsOf(wh).has(`sav/${a.id}/subtype`)).toBe(false);
  });

  it("役員の細目（自社株・会社への貸付金）には中身の欄を出さない（今までどおり）", () => {
    const wh = fromRequest(modelHousehold("executiveOwner"));
    const next = others(wh).actions.find((x) => x.key === "sav/add/ownCompanyShares")!.run(wh);
    const a = (next.request.input.household.accounts ?? []).find((x) => x.subtype === "ownCompanyShares") as Account;
    expect(fieldsOf(next).has(`sav/${a.id}/subtype`)).toBe(false);
    expect(fieldsOf(next).has(`sav/${a.id}/kind`)).toBe(false);
  });

  it("細目は計算に使わない（評価額・増減率・金融資産の範囲は細目で変わらない）", () => {
    const added = addOther(open());
    const a = added.a;
    let wh = added.wh;
    wh = fieldOf(wh, `sav/${a.id}/value`).set(wh, 2_000_000);
    wh = fieldOf(wh, `sav/${a.id}/growth`).set(wh, "0.02");
    const before = preview(wh.request).table;
    for (const s of ["preciousMetal", "cryptoAsset", "art", "membership", "securityDeposit", "businessAsset"]) {
      const w = fieldOf(wh, `sav/${a.id}/subtype`).set(wh, s);
      expect(accOf(w, a.id).subtype).toBe(s);
      expect(preview(w.request).table).toEqual(before);
    }
  });
});

describe("バランスシートの行を中身ごとに（0120）", () => {
  const cell = (row: string, year: number, amount: number, object?: string) => ({ row, year, amount, ...(object !== undefined ? { object } : {}) });
  const table = [
    cell("cf.balance.account.deposit", 2026, 5_000_000),
    cell("cf.balance.account.otherAsset", 2026, 1_000_000, "gold1"),
    cell("cf.balance.account.otherAsset", 2026, 2_000_000, "gold2"),
    cell("cf.balance.account.otherAsset", 2026, 500_000, "btc"),
    cell("cf.balance.account.otherAsset", 2026, 300_000, "deposit"),
    cell("cf.balance.account.otherAsset", 2026, 400_000, "misc"),
    cell("cf.balance.account.otherAsset", 2026, 3_000_000, "shares"),
    cell("cf.balance.account.car", 2026, 1_500_000, "car1"),
  ];
  const household = {
    accounts: [
      { id: "gold1", kind: "otherAsset", subtype: "preciousMetal" },
      { id: "gold2", kind: "otherAsset", subtype: "preciousMetal" },
      { id: "btc", kind: "otherAsset", subtype: "cryptoAsset" },
      { id: "deposit", kind: "otherAsset", subtype: "securityDeposit" },
      { id: "misc", kind: "otherAsset" },
      { id: "shares", kind: "otherAsset", subtype: "ownCompanyShares" },
    ],
  };

  it("資産と負債のタブの分け方: 中身ごとの項目（同じ中身はまとめる）。細目の無いものは「その他の資産」。合計は変わらない", () => {
    const [a] = bsSeries(table, [2026], bsHouseholdOf(household));
    const ill = a!.lines.filter((l) => l.group === "illiquid").map((l) => [l.key, l.label, l.amount]);
    expect(ill).toEqual([
      ["car", "車", 1_500_000],
      ["preciousMetal", "貴金属", 3_000_000],
      ["cryptoAsset", "暗号資産", 500_000],
      ["securityDeposit", "敷金・保証金", 300_000],
      ["otherAsset", "その他の資産", 400_000],
      ["ownShares", "自社株（出資額）", 3_000_000],
    ]);
    const [plain] = bsSeries(table, [2026], bsHouseholdOf({ accounts: [] }));
    expect(a!.totalAssets).toBe(plain!.totalAssets);
    expect(plain!.lines.find((l) => l.key === "otherAsset")?.amount).toBe(7_200_000);
  });

  it("提案書の年の抜粋の表: 同じ名前の行に分ける（世帯を渡さなければ今までどおり1行）", () => {
    const sheet = sheetOf(table, [{ year: 2026, label: "2026年末" }], household);
    expect(sheet.assets.filter((r) => r.kind === "item").map((r) => [r.label, r.amounts[0]])).toEqual([
      ["金融資産", 5_000_000],
      ["不動産", 0],
      ["車", 1_500_000],
      ["貴金属", 3_000_000],
      ["暗号資産", 500_000],
      ["敷金・保証金", 300_000],
      ["その他の資産", 400_000],
      ["自社株（出資額）", 3_000_000],
    ]);
    const old = sheetOf(table, [{ year: 2026, label: "2026年末" }]);
    expect(old.assets.filter((r) => r.label === "その他の資産").map((r) => r.amounts[0])).toEqual([7_200_000]);
    expect(sheet.netWorth).toEqual(old.netWorth);
  });
});
