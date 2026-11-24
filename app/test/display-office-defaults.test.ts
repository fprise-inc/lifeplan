// 結果のタブ・資産と負債のタブの表示の設定の事務所の既定値（0213 の段C）: 事務所データの display に11件の既定値を持ち、世帯ファイルでは
// 「事務所の既定値に従う」を印（display.followOffice）で持つ。印のある設定は事務所の既定値を読み、その世帯で値を変えると印を外してその世帯の値を持つ。
// 前の版の世帯（印の無い世帯ファイル）は、どの設定もその世帯の値のまま（事務所の既定値を変えても変わらない）。この世帯で並べる時点と
// 対策に足した項目は世帯だけ。AI は11件の事務所の既定値の案も出せ、承認の画面・前の値も同じ作りで効く
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { h } from "preact";
import { renderToString } from "preact-render-to-string";
import { describe, expect, it } from "vitest";
import { displayCurrent, householdCurrent, officeCurrent } from "../src/connector/display.ts";
import { buildDisplayCatalog, PROPOSABLE_DISPLAY_IDS } from "../src/connector/displayCatalog.ts";
import { checkDisplayChanges, checkDisplayValue } from "../src/connector/displayProposal.ts";
import { BalanceSettingsPanel } from "../src/presentation/BalanceTab.tsx";
import type { OfficeMarks } from "../src/presentation/OfficeMark.tsx";
import { DisplaySettingsPanel } from "../src/workspace/DisplaySettingsPanel.tsx";
import { DisplayDefaultsSection } from "../src/workspace/office/DisplayDefaultsSection.tsx";
import { DisplayProposalsSection } from "../src/workspace/office/DisplayProposalsSection.tsx";
import { readDisplayHistory } from "../src/workspace/office/displayHistory.ts";
import { applyDisplayValue, displayNow, proposalRow, restoreDisplayValue } from "../src/workspace/office/displayProposals.ts";
import { DEFAULT_OFFICE_SETTINGS, isDefaultSettings, readOfficeSettings, withOfficeDisplay, type OfficeSettings } from "../src/workspace/office/settings.ts";
import { bsPointsText } from "../src/workspace/report/ReportTab.tsx";
import {
  changedDisplayIds,
  DEFAULT_BALANCE_SETTINGS,
  DEFAULT_DISPLAY_SETTINGS,
  followsOffice,
  newHouseholdDisplay,
  OFFICE_DISPLAY_IDS,
  officeDisplayOf,
  officeDisplayStored,
  resolveDisplay,
  STANDARD_DISPLAY,
  withFollowOffice,
  withOwnChange,
  type DisplayPair,
  type StoredDisplay,
} from "../src/workspace/settings.ts";
import { BODY_FORMAT_VERSION, bodyObject, fromBody, readDisplay } from "../src/workspace/store/body.ts";
import { payloadFor } from "./takeawayFixture.ts";
import { modelHousehold } from "./helpers.ts";
import { REPO_DIR } from "../scripts/lib.ts";

const AT = "2026-11-15T01:02:03.000Z";

/** 事務所の既定値を決めた事務所（11件とも提供元の既定と違う値） */
const OFFICE_PAIR: DisplayPair = {
  result: { metrics: ["assetsAtAge", "minAssets"], atAge: 80, layout: "side", invBreakdown: true, invPeriods: false },
  balance: { health: false, guide: { basis: "living", months: [3, 9], risk: [5, 30], debt: 40 }, points: ["now", "age65", "age85"], columns: null, moneyThree: { months: 4, years: 7, wording: "time" } },
};
const office = (d: DisplayPair = OFFICE_PAIR): OfficeSettings => withOfficeDisplay(DEFAULT_OFFICE_SETTINGS, d);

/** この世帯の値（提供元の既定とも事務所の既定値とも違う値。並べる時点も選んだ形） */
const OWN: DisplayPair = {
  result: { metrics: ["takeHome"], atAge: 90, layout: "all", invBreakdown: false, invPeriods: true },
  balance: { health: true, guide: { months: [6, 18], risk: [20, 60], debt: 30 }, points: ["now", "retire", "age90"], columns: [{ point: "now" }, { year: 2042 }], moneyThree: { months: 8, years: 12, wording: "use" } },
};

/** 世帯ファイルの本文（表示の設定だけの最小の形） */
const bodyWith = (display: unknown): string => JSON.stringify({ meta: { formatVersion: "0.78" }, household: { request: modelHousehold("salariedCoupleTwoKids") }, proposals: [], workspace: {}, display });

describe("事務所データの display（形の版 4）", () => {
  it("11件の事務所の既定値を持てる。提供元の既定と同じ欄は持たず、並べる時点は持たない。前の版の事務所データはそのまま読める", () => {
    const s = readOfficeSettings(JSON.parse(JSON.stringify(office())));
    expect(s.version).toBe(5);
    expect(officeDisplayOf(s.display)).toEqual(OFFICE_PAIR);
    // 標準と違う欄だけ（moneyThree は欄ごと）
    const part = withOfficeDisplay(DEFAULT_OFFICE_SETTINGS, { ...STANDARD_DISPLAY, result: { ...DEFAULT_DISPLAY_SETTINGS, atAge: 85 }, balance: { ...DEFAULT_BALANCE_SETTINGS, moneyThree: { ...DEFAULT_BALANCE_SETTINGS.moneyThree, years: 5 } } });
    expect(part.display).toEqual({ result: { atAge: 85 }, balance: { moneyThree: { years: 5 } } });
    expect(withOfficeDisplay(part, STANDARD_DISPLAY).display).toBeUndefined();
    expect(isDefaultSettings(withOfficeDisplay(part, STANDARD_DISPLAY))).toBe(true);
    expect(isDefaultSettings(part)).toBe(false);
    // 並べる時点（この世帯だけの設定）は事務所データに書いても読まない
    expect(officeDisplayOf({ balance: { columns: [{ point: "now" }, { year: 2040 }] } }).balance.columns).toBeNull();
    expect(officeDisplayStored({ ...OFFICE_PAIR, balance: { ...OFFICE_PAIR.balance, columns: [{ point: "now" }, { point: "retire" }] } })?.balance).not.toHaveProperty("columns");
    // 版 1〜3 の事務所データ（欄が無い）・読めない値は提供元の既定
    for (const v of [{ version: 3 }, { version: 1, levers: {} }, { display: "x" }, { display: { result: { atAge: 77, layout: "diagonal", metrics: ["x"] }, balance: { points: ["now"], moneyThree: { months: 999 } } } }]) {
      const r = readOfficeSettings(v);
      expect(r.display).toBeUndefined();
      expect(officeDisplayOf(r.display)).toEqual(STANDARD_DISPLAY);
    }
  });
});

describe("世帯ファイルの「事務所の既定値に従う」の印（形式の版 0.80）", () => {
  it("印のある設定は事務所の既定値を読み、印の無い設定はこの世帯の値のまま", () => {
    const stored: StoredDisplay = { ...OWN, followOffice: ["result.atAge", "balance.guide", "balance.moneyThree.months"] };
    const shown = resolveDisplay(stored, OFFICE_PAIR);
    expect(shown.result).toEqual({ ...OWN.result, atAge: 80 });
    expect(shown.balance).toEqual({ ...OWN.balance, guide: OFFICE_PAIR.balance.guide, moneyThree: { ...OWN.balance.moneyThree, months: 4 } });
    // 印が全部なら、この世帯で並べる時点のほかは事務所の既定値と同じ
    const all = resolveDisplay({ ...OWN, followOffice: [...OFFICE_DISPLAY_IDS] }, OFFICE_PAIR);
    expect(all).toEqual({ ...OFFICE_PAIR, balance: { ...OFFICE_PAIR.balance, columns: OWN.balance.columns } });
  });

  it("前の版の世帯（印の無い世帯ファイル）は、今の値のまま「この世帯だけ」。事務所の既定値を変えても、保存し直しても変わらない", () => {
    const old = bodyWith({ result: OWN.result, balance: OWN.balance });
    const st = fromBody(old);
    expect(st.display.followOffice).toBeUndefined();
    for (const id of OFFICE_DISPLAY_IDS) expect(followsOffice(st.display, id)).toBe(false);
    // 事務所の既定値が提供元の既定のままでも、変えた後でも、見た目は今の値のまま
    expect(resolveDisplay(st.display, STANDARD_DISPLAY)).toEqual(OWN);
    expect(resolveDisplay(st.display, OFFICE_PAIR)).toEqual(OWN);
    // 既定と同じ値の世帯も（従う印を付けて読まない）。事務所の既定値を変えても変わらない
    const plain = fromBody(bodyWith({ result: DEFAULT_DISPLAY_SETTINGS, balance: DEFAULT_BALANCE_SETTINGS }));
    expect(plain.display.followOffice).toBeUndefined();
    expect(resolveDisplay(plain.display, OFFICE_PAIR)).toEqual(STANDARD_DISPLAY);
    // 書き戻しても印を書き足さない（欄を作らない）
    const again = bodyObject(st) as unknown as { display: Record<string, unknown> };
    expect(again.display).not.toHaveProperty("followOffice");
    expect(again.display.result).toEqual(OWN.result);
  });

  it("印は読み書きで残り、知らない id・世帯だけの設定・重なりは捨てる", () => {
    const st = fromBody(bodyWith({ ...OWN, followOffice: ["balance.points", "result.addedItems", "balance.columns", "x", "result.metrics", "balance.points"] }));
    expect(st.display.followOffice).toEqual(["result.metrics", "balance.points"]);
    const back = fromBody(JSON.stringify(bodyObject(st)));
    expect(back.display).toEqual(st.display);
    expect(readDisplay({ followOffice: "result.metrics" }).followOffice).toBeUndefined();
    expect(BODY_FORMAT_VERSION).toBe("0.90");
  });

  it("新しく作る世帯は11件とも事務所の既定値に従い、世帯の値にも作ったときの事務所の既定値を書く（前の版のアプリで開いても同じ見た目）", () => {
    const d = newHouseholdDisplay(OFFICE_PAIR);
    expect(d.followOffice).toEqual([...OFFICE_DISPLAY_IDS]);
    expect({ result: d.result, balance: d.balance }).toEqual(OFFICE_PAIR);
    expect(d.balance.columns).toBeNull();
    // 画面の確かめの URL で選んだ設定だけは従わない
    const h2 = newHouseholdDisplay(OFFICE_PAIR, { set: { ...STANDARD_DISPLAY, result: { ...DEFAULT_DISPLAY_SETTINGS, atAge: 70 } }, ids: ["result.atAge"] });
    expect(followsOffice(h2, "result.atAge")).toBe(false);
    expect(h2.result.atAge).toBe(70);
    expect(h2.followOffice).toHaveLength(OFFICE_DISPLAY_IDS.length - 1);
  });

  it("事務所の既定値を変えた後: 従う世帯は自然に従い、この世帯だけの設定・印の無い世帯は変わらない（そろえる操作は無い）", () => {
    const follower = newHouseholdDisplay(STANDARD_DISPLAY);
    const own1 = withOwnChange(follower, resolveDisplay(follower, STANDARD_DISPLAY), { ...STANDARD_DISPLAY, result: { ...DEFAULT_DISPLAY_SETTINGS, atAge: 90 } });
    expect(followsOffice(own1, "result.atAge")).toBe(false);
    expect(followsOffice(own1, "result.layout")).toBe(true);
    const after = { ...OFFICE_PAIR };
    expect(resolveDisplay(follower, after)).toEqual(after);
    const mixed = resolveDisplay(own1, after);
    expect(mixed.result.atAge).toBe(90);
    expect(mixed.result.layout).toBe("side");
    expect(mixed.balance.moneyThree).toEqual(after.balance.moneyThree);
    // 本文は変わらない（事務所の既定値を変えただけでは、作った世帯の世帯ファイルを書き換えない）
    const body = (d: StoredDisplay) => JSON.stringify(bodyObject({ ...fromBody(bodyWith({})), display: d }));
    expect(body(follower)).toBe(body(follower));
    expect(JSON.parse(body(follower)).display.result).toEqual(DEFAULT_DISPLAY_SETTINGS);
  });

  it("その世帯で変えた設定だけ印を外す。並べる時点は世帯の値。「事務所の既定値に戻す」で印を付け直し、今の事務所の既定値にする", () => {
    const d = newHouseholdDisplay(OFFICE_PAIR);
    const before = resolveDisplay(d, OFFICE_PAIR);
    const next = { ...before, balance: { ...before.balance, moneyThree: { ...before.balance.moneyThree, years: 15 }, columns: [{ point: "now" as const }, { point: "retire" as const }] } };
    expect(changedDisplayIds(before, next)).toEqual(["balance.moneyThree.years"]);
    const own = withOwnChange(d, before, next);
    expect(followsOffice(own, "balance.moneyThree.years")).toBe(false);
    expect(own.followOffice).toHaveLength(OFFICE_DISPLAY_IDS.length - 1);
    expect(own.balance.moneyThree).toEqual({ ...OFFICE_PAIR.balance.moneyThree, years: 15 });
    expect(own.balance.columns).toEqual([{ point: "now" }, { point: "retire" }]);
    // 同じ値に戻しても印は付かない（「事務所の既定値に戻す」で付ける）
    const same = withOwnChange(own, resolveDisplay(own, OFFICE_PAIR), resolveDisplay({ ...own, balance: { ...own.balance, moneyThree: OFFICE_PAIR.balance.moneyThree } }, OFFICE_PAIR));
    expect(followsOffice(same, "balance.moneyThree.years")).toBe(false);
    // 事務所の既定値に戻す: 印を付け、世帯の値も今の事務所の既定値に
    const changedOffice: DisplayPair = { ...OFFICE_PAIR, balance: { ...OFFICE_PAIR.balance, moneyThree: { ...OFFICE_PAIR.balance.moneyThree, years: 3 } } };
    const back = withFollowOffice(own, "balance.moneyThree.years", changedOffice);
    expect(back.followOffice).toEqual([...OFFICE_DISPLAY_IDS]);
    expect(back.balance.moneyThree.years).toBe(3);
    expect(back.balance.columns).toEqual([{ point: "now" }, { point: "retire" }]);
    // 前の版の世帯でも、設定ごとに戻せる（ほかの設定はその世帯の値のまま）
    const old = withFollowOffice(fromBody(bodyWith(OWN)).display, "result.layout", OFFICE_PAIR);
    expect(old.followOffice).toEqual(["result.layout"]);
    expect(resolveDisplay(old, OFFICE_PAIR).result).toEqual({ ...OWN.result, layout: "side" });
  });

  it("この世帯で並べる時点と対策に足した項目は、事務所の既定値にならない", () => {
    expect(OFFICE_DISPLAY_IDS).not.toContain("balance.columns");
    expect(OFFICE_DISPLAY_IDS).not.toContain("result.addedItems");
    const cat = buildDisplayCatalog().settings;
    for (const id of ["balance.columns", "result.addedItems"]) {
      const s = cat.find((x) => x.id === id)!;
      expect(s.scope).toBe("household");
      expect(s.proposable).toBeUndefined();
      expect(s.change.office).toBeUndefined();
      expect(checkDisplayChanges([{ id, value: id === "balance.columns" ? [{ point: "now" }, { point: "retire" }] : [] }]).problems.join("")).toContain("世帯だけの設定");
    }
    // 事務所の既定値が何でも、並べる時点はその世帯の値
    const shown = resolveDisplay({ ...OWN, followOffice: [...OFFICE_DISPLAY_IDS] }, { ...OFFICE_PAIR, balance: { ...OFFICE_PAIR.balance, columns: [{ point: "age90" }, { point: "age85" }] } });
    expect(shown.balance.columns).toEqual(OWN.balance.columns);
  });

  it("0.80 の見本の世帯ファイル（暗号を外した本文）を読める。印は3件、ほかはこの世帯の値", () => {
    const body = readFileSync(join(REPO_DIR, "crates", "household-store", "tests", "fixtures", "household-format", "0.80", "body.json"), "utf8");
    const st = fromBody(body);
    expect(st.display.followOffice).toEqual(["result.layout", "balance.health", "balance.moneyThree.years"]);
    const shown = resolveDisplay(st.display, OFFICE_PAIR);
    expect(shown.result.layout).toBe("side");
    expect(shown.balance.health).toBe(false);
    expect(shown.balance.moneyThree.years).toBe(7);
    expect(shown.result.atAge).toBe(st.display.result.atAge);
    // 0.78 の見本は印が無く、事務所の既定値を変えても変わらない
    const prev = fromBody(readFileSync(join(REPO_DIR, "crates", "household-store", "tests", "fixtures", "household-format", "0.78", "body.json"), "utf8"));
    expect(prev.display.followOffice).toBeUndefined();
    expect(resolveDisplay(prev.display, OFFICE_PAIR)).toEqual({ result: prev.display.result, balance: prev.display.balance });
  });
});

describe("提案書・持ち帰り用のレポートに出る設定", () => {
  it("事務所の既定値に従う世帯では、○歳時点の年齢・時点を並べるの既定・お金の3つの分け方が事務所の既定値で出る", () => {
    const shown = resolveDisplay(newHouseholdDisplay(STANDARD_DISPLAY), OFFICE_PAIR);
    // 提案書: 目標の年齢と、バランスシートの図の時点（ReportTab に渡す値と同じ）
    expect(shown.result.atAge).toBe(80);
    expect(bsPointsText(shown.balance.columns, shown.balance.points)).toBe("今・65歳・85歳");
    // 持ち帰り用のレポート: 目標の年齢とお金の3つの分け方
    const { payload } = payloadFor("salariedCoupleTwoKids", { targetAge: shown.result.atAge, moneyThree: shown.balance.moneyThree });
    expect(payload.targetAge).toBe(80);
    expect(payload.moneyThree).toEqual({ months: 4, years: 7, wording: "time" });
    // この世帯だけの値にした設定は、事務所の既定値を変えてもその値のまま
    const own = resolveDisplay({ ...OWN, followOffice: ["balance.points"] }, OFFICE_PAIR);
    expect(own.result.atAge).toBe(90);
    expect(bsPointsText(own.balance.columns, own.balance.points)).toBe("今・2042年");
    expect(bsPointsText(null, own.balance.points)).toBe("今・65歳・85歳");
  });
});

describe("世帯の表示の設定の画面の「事務所の既定値」「この世帯だけ」", () => {
  const marks = (d: StoredDisplay, seen: string[][] = []): OfficeMarks => ({
    follows: (id) => (OFFICE_DISPLAY_IDS as readonly string[]).includes(id) && followsOffice(d, id as (typeof OFFICE_DISPLAY_IDS)[number]),
    officeText: (id) => officeCurrent(office())[id]?.text ?? "",
    onReset: (ids) => seen.push([...ids]),
  });

  it("結果のタブ: 従う設定は「事務所の既定値」、この世帯だけの設定は「この世帯だけ」と「事務所の既定値に戻す」", () => {
    const d: StoredDisplay = { ...OWN, followOffice: ["result.metrics", "result.invPeriods"] };
    const html = renderToString(h(DisplaySettingsPanel, { value: resolveDisplay(d, OFFICE_PAIR).result, onChange: () => undefined, onClose: () => undefined, feeAvailable: false, office: marks(d) }));
    expect(html).toContain('data-display-office="result.metrics"');
    expect(html).toContain('data-display-office="result.invPeriods"');
    for (const id of ["result.atAge", "result.layout", "result.invBreakdown"]) {
      expect(html).toContain(`data-display-household="${id}"`);
      expect(html).toContain(`data-display-reset="${id}"`);
    }
    expect(html).not.toContain('data-display-reset="result.metrics"');
    expect(html).toContain("事務所の既定値に戻す");
    // 事務所の今の既定値を説明に出す
    expect(html).toContain("事務所の既定値は 80歳");
    // 印を渡さなければ出さない（今までどおり）
    expect(renderToString(h(DisplaySettingsPanel, { value: OWN.result, onChange: () => undefined, onClose: () => undefined, feeAvailable: false }))).not.toContain("この世帯だけ");
  });

  it("資産と負債のタブ: 既定の時点・家計の体力の目安・目安の幅・お金の3つの分け方の4つの設定に印を出す", () => {
    const d: StoredDisplay = { ...OWN, followOffice: ["balance.points", "balance.moneyThree.months"] };
    const b = resolveDisplay(d, OFFICE_PAIR).balance;
    const html = renderToString(
      h(BalanceSettingsPanel, {
        model: { health: b.health, guide: b.guide, guideBasis: "living", pointDefaults: b.points, pointChoices: [] } as unknown as Parameters<typeof BalanceSettingsPanel>[0]["model"],
        onGuide: () => undefined,
        onHealth: () => undefined,
        onPointDefaults: () => undefined,
        moneyThree: { value: b.moneyThree.wording, choices: [], onChange: () => undefined },
        office: marks(d),
        onClose: () => undefined,
      }),
    );
    expect(html).toContain('data-display-office="balance.points"');
    expect(html).toContain('data-display-office="balance.moneyThree.months"');
    for (const id of ["balance.health", "balance.guide", "balance.moneyThree.wording", "balance.moneyThree.years"]) expect(html).toContain(`data-display-household="${id}"`);
  });

  it("事務所の既定値の画面の区画: 11件を決められる（並べる時点・対策に足した項目は出さない）", () => {
    const html = renderToString(h(DisplayDefaultsSection, { value: OFFICE_PAIR, onChange: () => undefined }));
    expect(html).toContain("結果のタブ・資産と負債のタブの表示の設定");
    for (const k of ["data-office-display-metrics", "data-office-display-age", "data-office-display-layout", "data-office-inv-breakdown", "data-office-inv-periods", "data-office-display-points", "data-office-health", "data-guide-basis", "data-office-m3-names", "data-office-m3-months", "data-office-m3-years"]) expect(html).toContain(k);
    expect(html).toContain("世帯から決める");
    expect(html).not.toContain("この世帯で選んだ");
  });
});

describe("AI の案（propose_display_settings）の11件", () => {
  it("一覧の11件は両方で決められ、事務所の既定値に従う世帯に効く（followers）。案を出せる", () => {
    const cat = buildDisplayCatalog().settings;
    for (const id of OFFICE_DISPLAY_IDS) {
      const s = cat.find((x) => x.id === id)!;
      expect(s.scope, id).toBe("both");
      expect(s.officeEffect, id).toBe("followers");
      expect(s.proposable, id).toBe(true);
      expect(s.change.office, id).toContain("結果のタブ・資産と負債のタブの表示の設定");
      expect(PROPOSABLE_DISPLAY_IDS as readonly string[]).toContain(id);
    }
    expect(PROPOSABLE_DISPLAY_IDS).toHaveLength(18);
  });

  it("選べる値・範囲の中の値は通り、今の値と同じ形にそろえる", () => {
    expect(checkDisplayValue("result.metrics", ["minAssets", "assetsAtAge"])).toEqual({ ok: true, value: ["assetsAtAge", "minAssets"] });
    expect(checkDisplayValue("result.metrics", [])).toEqual({ ok: true, value: [] });
    expect(checkDisplayValue("result.atAge", 85)).toEqual({ ok: true, value: 85 });
    expect(checkDisplayValue("result.invPeriods", null)).toEqual({ ok: true, value: null });
    expect(checkDisplayValue("result.invBreakdown", true)).toEqual({ ok: true, value: true });
    expect(checkDisplayValue("balance.points", ["age85", "now"])).toEqual({ ok: true, value: ["now", "age85"] });
    expect(checkDisplayValue("balance.guide", { months: [3, 9], risk: [5, 30], debt: 40 })).toEqual({ ok: true, value: { months: [3, 9], risk: [5, 30], debt: 40 } });
    expect(checkDisplayValue("balance.guide", { basis: "livingLoan", months: [0, 120], risk: [0, 100], debt: 100 })).toEqual({ ok: true, value: { basis: "livingLoan", months: [0, 120], risk: [0, 100], debt: 100 } });
    expect(checkDisplayValue("balance.moneyThree.months", 1)).toEqual({ ok: true, value: 1 });
    expect(checkDisplayValue("balance.moneyThree.wording", "time")).toEqual({ ok: true, value: "time" });
  });

  it("選べない値・範囲の外の値・形の違う値は、理由を添えて断る", () => {
    const bad = (id: string, value: unknown) => checkDisplayChanges([{ id, value }]).problems.join("／");
    expect(bad("result.metrics", ["takeHome", "assetAtAge"])).toContain("assetsAtAge");
    expect(bad("result.metrics", "takeHome")).toContain("並び");
    expect(bad("result.atAge", 77)).toContain("選べる値にありません");
    expect(bad("result.atAge", "90")).toContain("整数ではありません");
    expect(bad("result.atAge", 90.5)).toContain("整数ではありません");
    expect(bad("result.layout", "diagonal")).toContain("選べる値にありません");
    expect(bad("result.invBreakdown", "true")).toContain("true（表示する）か false");
    expect(bad("result.invPeriods", "auto")).toContain("選べる値にありません");
    expect(bad("balance.health", 1)).toContain("true");
    expect(bad("balance.points", ["now"])).toContain("2つ以上");
    expect(bad("balance.points", ["now", "y5", "y10", "y20", "age90"])).toContain("4つまで");
    expect(bad("balance.points", ["now", "now"])).toContain("2回");
    expect(bad("balance.guide", { months: [12, 6], risk: [10, 40], debt: 50 })).toContain("上限は下限より大きく");
    expect(bad("balance.guide", { months: [6, 121], risk: [10, 40], debt: 50 })).toContain("範囲の外");
    expect(bad("balance.guide", { months: [6, 12], risk: [10, 40], debt: 0 })).toContain("1〜100");
    expect(bad("balance.guide", { months: [6, 12], risk: [10, 40] })).toContain("debt");
    expect(bad("balance.guide", { months: [6, 12], risk: [10, 40], debt: 50, basis: "livng" })).toContain("living のことですか");
    expect(bad("balance.guide", { months: [6, 12], risk: [10, 40], debt: 50, depth: 1 })).toContain("debt のことですか");
    expect(bad("balance.moneyThree.months", 0)).toContain("範囲の外");
    expect(bad("balance.moneyThree.years", 31)).toContain("範囲の外");
    expect(bad("balance.moneyThree.wording", "usage")).toContain("選べる値にありません");
    // 断るときは、ほかの正しい案も出さない
    expect(checkDisplayChanges([{ id: "result.atAge", value: 80 }, { id: "result.atAge2", value: 80 }]).changes).toEqual([]);
  });

  it("承認の画面は「今 → 案」を出し、反映すると事務所データの display に書き、前の値（設定ごとに3件）に残し、戻せる", () => {
    const s0 = DEFAULT_OFFICE_SETTINGS;
    const row = proposalRow(s0, "result.atAge", 80);
    expect(row).toMatchObject({ now: "95歳", next: "80歳", unchanged: false, problem: null });
    expect(proposalRow(s0, "balance.guide", { months: [3, 9], risk: [5, 30], debt: 40 }).next).toContain("3〜9か月分");
    expect(proposalRow(s0, "result.atAge", 77).problem).toContain("選べる値にありません");
    expect(proposalRow(s0, "result.atAge", 95).unchanged).toBe(true);
    let s = applyDisplayValue(s0, "result.atAge", 80, AT, "ai")!;
    expect(s.display).toEqual({ result: { atAge: 80 } });
    expect(s.displayHistory?.["result.atAge"]).toEqual([{ value: 95, at: AT, reason: "ai" }]);
    s = applyDisplayValue(s, "balance.moneyThree.years", 7, AT, "ai")!;
    expect(s.display).toEqual({ result: { atAge: 80 }, balance: { moneyThree: { years: 7 } } });
    for (const age of [85, 90, 70]) s = applyDisplayValue(s, "result.atAge", age, AT, "ai")!;
    expect(s.displayHistory?.["result.atAge"]?.map((e) => e.value)).toEqual([80, 85, 90]);
    // 前の値に戻す（戻す前の値も残す）
    const r = restoreDisplayValue(s, "result.atAge", 0, AT)!;
    expect(displayNow(r, "result.atAge").value).toBe(80);
    expect(r.displayHistory?.["result.atAge"]?.at(-1)).toEqual({ value: 70, at: AT, reason: "restore" });
    // 保存して読み直しても同じ（事務所データの形の版 4。前の値は案と同じ関数で確かめて読む）
    const again = readOfficeSettings(JSON.parse(JSON.stringify(r)));
    expect(again.display).toEqual(r.display);
    expect(again.displayHistory).toEqual(r.displayHistory);
    expect(readDisplayHistory({ "result.atAge": [{ value: 77, at: AT, reason: "ai" }], "balance.columns": [{ value: null, at: AT, reason: "ai" }] })).toBeUndefined();
  });

  it("承認の画面: 11件の案も設定ごとに「今 → 案」と効き方（事務所の既定値に従う世帯に効く）を出す", () => {
    const html = renderToString(
      h(DisplayProposalsSection, {
        value: DEFAULT_OFFICE_SETTINGS,
        candidates: [{ candidateId: "c1", receivedAt: AT, connector: null, changes: [{ id: "result.atAge", value: 85, note: "85歳時点で話すことが多い" }, { id: "balance.moneyThree.months", value: 0 }] }],
        onApply: async () => DEFAULT_OFFICE_SETTINGS,
        onDiscard: async () => undefined,
        onRestore: async () => DEFAULT_OFFICE_SETTINGS,
      }),
    );
    expect(html).toContain("「○歳時点の金融資産」の年齢");
    expect(html).toContain("95歳");
    expect(html).toContain("85歳");
    expect(html).toContain("事務所の既定値に従う世帯にすぐ効きます");
    // 範囲の外の案は反映できない
    expect(html).toContain("この案は反映できません");
  });

  it("get_display_settings の current.office に11件、渡された世帯の current.household に従っているか（followsOffice）を入れる", () => {
    const o = officeCurrent(office());
    for (const id of OFFICE_DISPLAY_IDS) expect(o[id], id).toBeDefined();
    expect(o["result.atAge"]).toEqual({ value: 80, isDefault: false, text: "80歳" });
    expect(o["balance.moneyThree.months"]?.text).toBe("4か月分");
    expect(o["balance.columns"]).toBeUndefined();
    expect(officeCurrent(DEFAULT_OFFICE_SETTINGS)["result.atAge"]).toEqual({ value: 95, isDefault: true, text: "95歳" });
    // 世帯: 印のある設定は事務所の今の値で followsOffice: true、ほかは世帯の値で false。並べる時点・対策に足した項目には付けない
    const hh = householdCurrent({ display: { ...OWN, followOffice: ["result.atAge"] }, itemChoice: null, shownItems: [] }, office());
    expect(hh["result.atAge"]).toMatchObject({ value: 80, followsOffice: true });
    expect(hh["result.layout"]).toMatchObject({ value: "all", followsOffice: false });
    expect(hh["balance.columns"]?.followsOffice).toBeUndefined();
    expect(hh["result.addedItems"]?.followsOffice).toBeUndefined();
    // 接続口の入口でも同じ（事務所データの見せ方の欄と世帯の見せ方の区画から）
    const both = JSON.parse(displayCurrent(JSON.stringify(office()), JSON.stringify({ display: { ...OWN, followOffice: ["balance.guide"] }, itemChoice: null, shownItems: [] }), "")) as { office: Record<string, unknown>; household: Record<string, { value: unknown; followsOffice?: boolean }> };
    expect(both.household["balance.guide"]).toMatchObject({ value: OFFICE_PAIR.balance.guide, followsOffice: true });
    expect((both.office["balance.points"] as { value: unknown }).value).toEqual(["now", "age65", "age85"]);
  });
});

