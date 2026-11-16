// 渡された世帯ごとの表示の設定の案（propose_display_settings の share_id。0213 の段B の後半）: 案を出せるのは世帯ごとの値を持つ13件で、
// 対策に足した項目（物の ID を含む）と事務所の既定値だけの設定は断る。値は事務所の既定値の案と同じ関数で確かめる。
// その世帯の結果のタブに「今 → 案」を出し、「反映する」を押した設定はこの世帯だけの値になる（事務所の既定値に従う印を外す）。
// 戻すのは元に戻すの履歴と「事務所の既定値に戻す」（世帯ファイルの形式は上げない）
import { h } from "preact";
import { renderToString } from "preact-render-to-string";
import { describe, expect, it } from "vitest";
import { householdCurrent } from "../src/connector/display.ts";
import { buildDisplayCatalog, HOUSEHOLD_PROPOSABLE_DISPLAY_IDS, PROPOSABLE_DISPLAY_IDS, type HouseholdProposableDisplayId } from "../src/connector/displayCatalog.ts";
import { checkDisplayChanges, checkDisplayValue, displayCheck } from "../src/connector/displayProposal.ts";
import type { AiDisplayPendingHousehold, AiHouseholdDisplayCandidate } from "../src/engine/host.ts";
import { AiDisplayCandidateBand } from "../src/workspace/ai/AiDisplayCandidateBand.tsx";
import { AiDisplayProposals } from "../src/workspace/ai/AiDisplayProposals.tsx";
import { householdProposalRow, withHouseholdValue, type HouseholdDisplayState } from "../src/workspace/ai/displayProposals.ts";
import { sameSnap, type AppSnap } from "../src/workspace/undo/appHistory.ts";
import { UndoHistory } from "../src/workspace/undo/history.ts";
import { fromRequest } from "../src/workspace/input/household.ts";
import { followsOffice, newHouseholdDisplay, OFFICE_DISPLAY_IDS, resolveDisplay, STANDARD_DISPLAY, withFollowOffice, withOwnChange, type DisplayPair, type StoredDisplay } from "../src/workspace/settings.ts";
import { bodyObject, fromBody, readDisplay } from "../src/workspace/store/body.ts";
import { modelHousehold } from "./helpers.ts";

const household = (changes: unknown) => checkDisplayChanges(changes, "household");
const bodyWith = (): string => JSON.stringify({ meta: { formatVersion: "0.80" }, household: { request: modelHousehold("salariedCoupleTwoKids") }, proposals: [], workspace: {}, display: {} });
const problems = (changes: unknown) => household(changes).problems.join("／");

/** 事務所の既定値（85歳時点・左右に並べる。ほかは提供元の既定） */
const OFFICE: DisplayPair = { result: { ...STANDARD_DISPLAY.result, atAge: 85, layout: "side" }, balance: STANDARD_DISPLAY.balance };
/** 新しく作った世帯（11件とも事務所の既定値に従う） */
const FOLLOWING: StoredDisplay = newHouseholdDisplay(OFFICE);
const state = (display: StoredDisplay = FOLLOWING): HouseholdDisplayState => ({ display, itemChoice: undefined, office: OFFICE });

/** 設定ごとの、正しい世帯ごとの案の値 */
const SAMPLES: Record<HouseholdProposableDisplayId, unknown> = {
  "input.items": { hidden: ["rental"], levels: { work: "detail" } },
  "result.metrics": ["takeHome", "assetsAtAge"],
  "result.atAge": 90,
  "result.layout": "all",
  "result.invBreakdown": true,
  "result.invPeriods": false,
  "balance.health": false,
  "balance.guide": { months: [3, 9], risk: [5, 30], debt: 40, basis: "living" },
  "balance.points": ["now", "age80"],
  "balance.columns": [{ point: "now" }, { year: 2045 }, { point: "retire" }],
  "balance.moneyThree.wording": "time",
  "balance.moneyThree.months": 3,
  "balance.moneyThree.years": 5,
};

describe("世帯ごとの案を出せる設定", () => {
  it("一覧で世帯ごとの値を持つ設定から、対策に足した項目を除いた13件。並びは一覧の並び", () => {
    const cat = buildDisplayCatalog().settings;
    const own = cat.filter((s) => s.scope !== "office" && s.readOnly !== true && s.id !== "result.addedItems").map((s) => s.id);
    expect([...HOUSEHOLD_PROPOSABLE_DISPLAY_IDS]).toEqual(own);
    expect(cat.filter((s) => s.householdProposable === true).map((s) => s.id)).toEqual([...HOUSEHOLD_PROPOSABLE_DISPLAY_IDS]);
    // 対策に足した項目（物の ID を含む）は印が無く、どちらの案も出せない
    expect(cat.find((s) => s.id === "result.addedItems")?.householdProposable).toBeUndefined();
    // 結果のタブ・資産と負債のタブの11件は、事務所の既定値の案も世帯ごとの案も出せる
    for (const id of OFFICE_DISPLAY_IDS) {
      expect(PROPOSABLE_DISPLAY_IDS as readonly string[]).toContain(id);
      expect(HOUSEHOLD_PROPOSABLE_DISPLAY_IDS as readonly string[]).toContain(id);
    }
  });

  it("正しい案は今の値と同じ形にそろえる（13件を1回で出せる）", () => {
    const r = household(HOUSEHOLD_PROPOSABLE_DISPLAY_IDS.map((id) => ({ id, value: SAMPLES[id], note: " 理由 " })));
    expect(r.problems).toEqual([]);
    expect(r.changes.map((c) => c.id)).toEqual([...HOUSEHOLD_PROPOSABLE_DISPLAY_IDS]);
    expect(r.changes.find((c) => c.id === "result.metrics")?.value).toEqual(["assetsAtAge", "takeHome"]);
    expect(r.changes.find((c) => c.id === "balance.columns")?.value).toEqual(SAMPLES["balance.columns"]);
    expect(r.changes.find((c) => c.id === "input.items")?.value).toEqual({ hidden: ["rental"], levels: { work: "detail" } });
    expect(r.changes[0]?.note).toBe("理由");
    // 接続口の入口: 2つ目の引数が household のときだけ世帯ごとの案
    expect(JSON.parse(displayCheck(JSON.stringify([{ id: "balance.columns", value: null }]), "household", "")).problems).toEqual([]);
    expect(JSON.parse(displayCheck(JSON.stringify([{ id: "balance.columns", value: null }]), "", "")).problems.join("")).toContain("share_id に渡された世帯を書くと");
  });

  it("事務所の既定値だけの設定・対策に足した項目・読むだけの設定・知らない id は断る（ほかの正しい案も出さない）", () => {
    for (const id of ["input.order", "input.living", "result.levers", "contingency.premises", "contingency.scenes", "contingency.openScene"]) expect(problems([{ id, value: [] }]), id).toContain("事務所の既定値だけの設定");
    expect(problems([{ id: "result.addedItems", value: ["lever:retireAge"] }])).toContain("物の ID");
    expect(problems([{ id: "features.combinedBs", value: true }])).toContain("読むだけ");
    expect(problems([{ id: "result.atage", value: 85 }])).toContain("result.atAge のことですか");
    expect(problems([])).toContain("渡された世帯ごとの案を出せるのは");
    const tooMany = [...HOUSEHOLD_PROPOSABLE_DISPLAY_IDS, "result.atAge"].map((id) => ({ id, value: SAMPLES[id as HouseholdProposableDisplayId] }));
    expect(problems(tooMany)).toContain("13件まで");
    expect(household([{ id: "result.atAge", value: 85 }, { id: "result.levers", value: [] }]).changes).toEqual([]);
  });

  it("選べない値・範囲の外・この世帯で並べる時点の形の境目", () => {
    expect(problems([{ id: "result.atAge", value: 87 }])).toContain("選べる値にありません");
    expect(problems([{ id: "balance.moneyThree.months", value: 0 }])).toContain("範囲の外");
    expect(problems([{ id: "balance.moneyThree.years", value: 31 }])).toContain("範囲の外");
    expect(problems([{ id: "balance.health", value: "false" }])).toContain("true");
    // 並べる時点: null は既定のまま。2〜4つ・候補の鍵か決まった年・重ならない・知らない名前（物の ID などの入る所）は断る
    expect(checkDisplayValue("balance.columns", null)).toEqual({ ok: true, value: null });
    expect(checkDisplayValue("balance.columns", [{ point: "now" }, { year: 2300 }]).ok).toBe(true);
    expect(checkDisplayValue("balance.columns", [{ point: "now" }, { year: 1900 }]).ok).toBe(true);
    expect(problems([{ id: "balance.columns", value: [{ point: "now" }] }])).toContain("2〜4つ");
    expect(problems([{ id: "balance.columns", value: [{ point: "now" }, { point: "y5" }, { point: "y10" }, { point: "y20" }, { point: "age90" }] }])).toContain("2〜4つ");
    expect(problems([{ id: "balance.columns", value: [{ point: "now" }, { year: 2301 }] }])).toContain("1900〜2300");
    expect(problems([{ id: "balance.columns", value: [{ point: "now" }, { year: 2040.5 }] }])).toContain("1900〜2300");
    expect(problems([{ id: "balance.columns", value: [{ point: "now" }, { point: "retir" }] }])).toContain("retire「退職の年」のことですか");
    expect(problems([{ id: "balance.columns", value: [{ point: "now" }, { year: 2040, point: "retire" }] }])).toContain("どちらか1つだけ");
    expect(problems([{ id: "balance.columns", value: [{ year: 2040 }, { year: 2040 }] }])).toContain("2回あります");
    expect(problems([{ id: "balance.columns", value: [{ point: "now" }, { loanId: "x" }] }])).toContain("知らない名前");
    expect(problems([{ id: "balance.columns", value: "now" }])).toContain("null");
  });
});

describe("反映する（この世帯だけの値になる）", () => {
  it("従う印のある設定に反映すると印が外れ、値はその世帯の値になる。ほかの設定の印はそのまま", () => {
    expect(followsOffice(FOLLOWING, "result.atAge")).toBe(true);
    const next = withHouseholdValue(state(), "result.atAge", 90);
    expect(followsOffice(next.display, "result.atAge")).toBe(false);
    expect(next.display.result.atAge).toBe(90);
    expect(next.display.followOffice).toEqual(OFFICE_DISPLAY_IDS.filter((id) => id !== "result.atAge"));
    // 事務所の既定値を変えても、反映した設定はこの世帯の値のまま（ほかの印のある設定は従う）
    const office2: DisplayPair = { result: { ...OFFICE.result, atAge: 75, layout: "overlay" }, balance: OFFICE.balance };
    const shown = resolveDisplay(next.display, office2);
    expect(shown.result.atAge).toBe(90);
    expect(shown.result.layout).toBe("overlay");
  });

  it("事務所の既定値と同じ値の案でも、反映すれば印は外れる（今と同じ値の案は画面が「今と同じです」として反映を出さない）", () => {
    const row = householdProposalRow(state(), "result.atAge", 85);
    expect(row?.unchanged).toBe(true);
    const next = withHouseholdValue(state(), "result.atAge", 85);
    expect(followsOffice(next.display, "result.atAge")).toBe(false);
  });

  it("この世帯で並べる時点・入力項目の選び方は、世帯の値をそのまま書く（印は変えない）", () => {
    const cols = withHouseholdValue(state(), "balance.columns", [{ point: "now" }, { year: 2045 }]);
    expect(cols.display.balance.columns).toEqual([{ point: "now" }, { year: 2045 }]);
    expect(cols.display.followOffice).toEqual(FOLLOWING.followOffice);
    const items = withHouseholdValue(state(), "input.items", { hidden: ["rental"], levels: {} });
    expect(items.itemChoice).toEqual({ hidden: ["rental"] });
    expect(items.display).toBe(FOLLOWING);
  });

  it("「今」は画面に出している値で、事務所の既定値に従っているかを添える。「案」はその設定だけ当てた後の言葉", () => {
    const row = householdProposalRow(state(), "result.layout", "all");
    expect(row).toMatchObject({ now: "左右に並べる", nowFollows: true, next: "全部のプランを色分けで重ねる", unchanged: false, problem: null, value: "all" });
    const own = withOwnChange(FOLLOWING, resolveDisplay(FOLLOWING, OFFICE), { ...resolveDisplay(FOLLOWING, OFFICE), result: { ...OFFICE.result, layout: "overlay" } });
    expect(householdProposalRow(state(own), "result.layout", "all")?.nowFollows).toBe(false);
    // 事務所の既定値を持たない設定は印を添えない
    expect(householdProposalRow(state(), "balance.columns", [{ point: "now" }, { point: "retire" }])?.nowFollows).toBe(null);
    expect(householdProposalRow(state(), "balance.columns", null)?.unchanged).toBe(true);
    // 確かめられない案・案を出せない設定
    expect(householdProposalRow(state(), "result.atAge", 87)?.problem).toContain("選べる値にありません");
    expect(householdProposalRow(state(), "result.levers", [])).toBe(null);
    // 「今」は接続口の current.household と同じ読み方
    const now = householdCurrent({ display: FOLLOWING, itemChoice: null, shownItems: [] }, { display: OFFICE });
    expect(householdProposalRow(state(), "result.atAge", 90)?.now).toBe(now["result.atAge"]?.text);
  });
});

describe("反映した後に戻す（世帯ファイルの形式は上げない）", () => {
  const wh = fromRequest(modelHousehold("salariedCoupleTwoKids"));
  const snap = (d: StoredDisplay): AppSnap => ({ wh, work: { band: [], base: "current", sel: "current", drafts: {} }, settings: d.result, bs: d.balance, follow: d.followOffice ?? [] });

  it("元に戻すの履歴: 反映は1件として積まれ、元に戻すと印も値も前に戻る", () => {
    const hi = new UndoHistory<AppSnap>({ same: sameSnap });
    const before = FOLLOWING;
    const after = withHouseholdValue(state(before), "result.atAge", 90).display;
    expect(hi.record(snap(before), snap(after), { label: "表示の設定" })).toBe("push");
    const back = hi.undo();
    expect(back?.state.settings.atAge).toBe(85);
    expect(back?.state.follow).toContain("result.atAge");
  });

  it("押す前が事務所の既定値だった設定は、「事務所の既定値に戻す」で印を付け直し、事務所の今の既定値に戻る", () => {
    const after = withHouseholdValue(state(), "result.layout", "all").display;
    const back = withFollowOffice(after, "result.layout", OFFICE);
    expect(followsOffice(back, "result.layout")).toBe(true);
    expect(resolveDisplay(back, OFFICE).result.layout).toBe("side");
    expect(back.followOffice).toEqual(FOLLOWING.followOffice);
  });

  it("反映した後の世帯ファイルの本文は今の形式のまま読み書きでき、印が外れたことが残る", () => {
    const after = withHouseholdValue(state(), "balance.health", false).display;
    const st = fromBody(bodyWith());
    const back = fromBody(JSON.stringify(bodyObject({ ...st, display: after })));
    const read = readDisplay(bodyObject(back).display);
    expect(back.display.balance.health).toBe(false);
    expect(read.balance.health).toBe(false);
    expect(read.followOffice).not.toContain("balance.health");
    expect(read.followOffice).toContain("result.atAge");
  });
});

const cand = (changes: AiHouseholdDisplayCandidate["changes"], id = "c-1"): AiHouseholdDisplayCandidate => ({ candidateId: id, receivedAt: "2026-11-16T01:02:03Z", connector: "test-ai 1", shareId: "s-1", householdId: "h-1", customerNumber: "A0042", alias: "共有中の世帯A", changes });
const no = async () => undefined;

describe("承認の画面（その世帯の結果のタブ）", () => {
  it("「今 → 案」・事務所の既定値の印・AI の理由・「反映する」「捨てる」を出す。同じ世帯に2回届いた案は並べる", () => {
    const html = renderToString(
      h(AiDisplayProposals, {
        candidates: [cand([{ id: "result.layout", value: "all", note: "比較しやすくする" }, { id: "result.atAge", value: 85 }]), cand([{ id: "balance.columns", value: [{ point: "now" }, { point: "retire" }] }], "c-2")],
        state: state(),
        blocked: null,
        onApply: no,
        onDiscard: no,
      }),
    );
    expect(html).toContain("AIからの表示の設定の案（3件）");
    expect(html).toContain("data-ai-display-candidate=\"c-1\"");
    expect(html).toContain("data-ai-display-candidate=\"c-2\"");
    expect(html).toContain("左右に並べる");
    expect(html).toContain("全部のプランを色分けで重ねる");
    expect(html).toContain("data-ai-display-now-office");
    expect(html).toContain("今は事務所の既定値に従っています");
    expect(html).toContain("比較しやすくする");
    expect(html).toContain("data-ai-display-apply=\"result.layout\"");
    // 今と同じ値の案は「反映する」を出さない
    expect(html).toContain("今と同じです");
    expect(html).not.toContain("data-ai-display-apply=\"result.atAge\"");
    expect(html).toContain("data-ai-display-discard=\"result.atAge\"");
    expect(html).not.toMatch(/案A|B案|候補として保存/);
  });

  it("確かめられない案・案を出せない設定は「捨てる」だけ。閲覧だけで開いている世帯は反映できない", () => {
    const bad = renderToString(h(AiDisplayProposals, { candidates: [cand([{ id: "result.atAge", value: 87 }, { id: "result.levers", value: [] }])], state: state(), blocked: null, onApply: no, onDiscard: no }));
    expect(bad).toContain("この案は反映できません");
    expect(bad).not.toContain("data-ai-display-apply");
    const ro = renderToString(h(AiDisplayProposals, { candidates: [cand([{ id: "result.layout", value: "all" }])], state: state(), blocked: "閲覧だけで開いています", onApply: no, onDiscard: no }));
    expect(ro).toContain("閲覧だけで開いています");
    expect(ro).not.toContain("data-ai-display-apply");
    expect(ro).toContain("data-ai-display-discard");
    expect(renderToString(h(AiDisplayProposals, { candidates: [], state: state(), blocked: null, onApply: no, onDiscard: no }))).toBe("");
  });
});

describe("上の帯（どの世帯に案が届いているか）", () => {
  const pending: AiDisplayPendingHousehold[] = [
    { householdId: "h-1", customerNumber: "A0042", alias: "共有中の世帯A", count: 2 },
    { householdId: "h-2", customerNumber: "A0043", alias: "共有中の世帯B", count: 1 },
  ];
  const band = (p: Partial<Parameters<typeof AiDisplayCandidateBand>[0]>) =>
    renderToString(h(AiDisplayCandidateBand, { office: 0, households: pending, openedId: null, detailed: true, openedShown: false, onOpenOffice: () => undefined, onShowOpened: () => undefined, onOpenHousehold: () => undefined, ...p }));

  it("その世帯を開いていないときは、顧客番号と仮名と件数、「この世帯を開く」を出す", () => {
    const html = band({});
    expect(html).toContain("顧客番号 A0042");
    expect(html).toContain("共有中の世帯A");
    expect(html).toContain("data-ai-display-band-open-household=\"h-2\"");
  });

  it("開いている世帯は「開いている世帯」と出し、結果のタブで案を見ているときは帯に出さない", () => {
    const html = band({ openedId: "h-1" });
    expect(html).toContain("開いている世帯（2件）");
    expect(html).not.toContain("data-ai-display-band-household=\"h-1\"");
    const shown = band({ openedId: "h-1", openedShown: true, households: [pending[0]!] });
    expect(shown).toBe("");
  });

  it("顧客と一緒に見る画面では、ほかの世帯の顧客番号・仮名を出さず件数だけ。事務所の既定値の案は今までどおり", () => {
    const html = band({ openedId: "h-1", detailed: false, office: 3 });
    expect(html).not.toContain("A0043");
    expect(html).not.toContain("共有中の世帯B");
    expect(html).toContain("ほかの世帯（1世帯・1件");
    expect(html).toContain("事務所の既定値（3件）");
    expect(band({ households: [], office: 0 })).toBe("");
  });
});
