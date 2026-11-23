// 世帯をまとめて AI に渡す（0248）: 世帯の一覧の上の操作として出ること（見本の棚には出さない）・渡せない理由の文・上限・
// 渡した後の仮名と顧客番号の対応・保存していない変更の一言。渡せるかの判定は本体（1件ずつと同じ ai_use）で、画面は見せるだけ
import { h } from "preact";
import { renderToString } from "preact-render-to-string";
import { describe, expect, it } from "vitest";
import type { AiBulkOutcome, AiHost, AiStatus, StoredHousehold } from "../src/engine/host.ts";
import { AiBulkShare, BulkOutcomeView } from "../src/workspace/ai/AiBulkShare.tsx";
import { BULK_BLOCK_TEXT, BULK_LIMIT, BULK_MESSAGES, blockedCount, defaultSelection, numbersText, overLimit, sharedAmong } from "../src/workspace/ai/bulk.ts";
import { DEMO_HOUSEHOLDS } from "../src/workspace/catalog.ts";
import { HouseholdPanel, type HouseholdPanelProps } from "../src/workspace/store/HouseholdPanel.tsx";
import { DEFAULT_CATEGORIES, shelfItems } from "../src/workspace/store/numbering.ts";

const no = async (): Promise<never> => Promise.reject("E");
const host: AiHost = { status: no, setEnabled: no, copySetup: no, household: no, recordConsent: no, startShare: no, stopShare: no, decide: no, takeDocuments: no, householdCandidates: no, discardHouseholdCandidate: no, createFromCandidate: no, displayCandidates: no, takeDisplayChange: no, takeHouseholdDisplayChange: no, bulkCheck: no, bulkStart: no, bulkStop: no };
const status = (over: Partial<AiStatus> = {}): AiStatus => ({
  enabled: true,
  running: true,
  problem: null,
  storeReady: true,
  connector: { found: true, version: "0.1.0", versionMatches: true },
  shares: [],
  setup: [],
  durations: [15, 60, 120, 240, 480],
  dev: false,
  ...over,
});
const row = (customerNo: string, category = "A"): StoredHousehold => ({ id: `id-${customerNo}`, customerNo, summary: "本人", createdAt: "2026-10-21T00:00:00Z", updatedAt: "2026-10-21T00:00:00Z", updatedBy: null, openBy: [], forks: 0, category });
const list = [row("A0001"), row("A0002"), row("A0003"), row("C0004", "C")];
const outcome = (over: Partial<AiBulkOutcome> = {}): AiBulkOutcome => ({ ready: [], already: [], blocked: [], limit: 50, active: 0, ...over });
const mixed = outcome({
  ready: [{ id: "id-A0001", customerNo: "A0001", basis: "consent", alias: null }],
  already: [{ id: "id-A0002", customerNo: "A0002" }],
  blocked: [
    { reason: "refused", households: [{ id: "id-A0003", customerNo: "A0003" }] },
    { reason: "noBasis", households: [{ id: "id-C0004", customerNo: "C0004" }] },
  ],
});

describe("まとめて渡すときの決まり", () => {
  it("初めは、一覧の世帯が上限までならすべて選び、超えれば選ばない", () => {
    const ids = Array.from({ length: BULK_LIMIT }, (_, i) => `h${i}`);
    expect(defaultSelection(ids)).toEqual(ids);
    expect(defaultSelection([...ids, "over"])).toEqual([]);
  });
  it("上限: 選んだ数が上限ちょうどは通し、超えれば止める。共有中の世帯と合わせて超えるときも止める", () => {
    expect(overLimit(BULK_LIMIT, null)).toBeNull();
    expect(overLimit(BULK_LIMIT + 1, null)).toContain(`${BULK_LIMIT}件まで`);
    const r = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `h${i}`, customerNo: `A${i}`, basis: "consent" as const, alias: null }));
    expect(overLimit(10, outcome({ ready: r(10), active: 40 }))).toBeNull();
    expect(overLimit(10, outcome({ ready: r(10), active: 41 }))).toContain("共有中の世帯（41件）");
  });
  it("渡せない理由の文はすべての理由にある（「当てる」「比べ」「カード」「接続口」の言葉を使わない）", () => {
    for (const k of ["refused", "withdrawn", "noBasis", "sample", "notSaved", "readOnly", "openByOthers", "unreadable", "unknown"] as const) expect(BULK_BLOCK_TEXT[k]).toBeTruthy();
    const all = [...Object.values(BULK_BLOCK_TEXT), ...Object.values(BULK_MESSAGES)].join("");
    for (const bad of ["当て", "比べ", "カード", "接続口", "つなぐ"]) expect(all).not.toContain(bad);
  });
  it("顧客番号の並びと件数", () => {
    expect(numbersText([{ customerNo: "A1" }, { customerNo: "A2" }])).toBe("A1、A2");
    expect(numbersText([{ customerNo: "A1" }, { customerNo: "A2" }, { customerNo: "A3" }], 2)).toBe("A1、A2 ほか1件");
    expect(blockedCount(mixed)).toBe(2);
  });
  it("一覧の中の共有中の世帯（同じ世帯は1つ）", () => {
    const s = (id: string) => ({ shareId: `s-${id}`, alias: "共有中の世帯A", householdId: id, customerNumber: null, expiresInSec: 60 });
    expect(sharedAmong([s("id-A0001"), s("id-A0001"), s("other")], ["id-A0001", "id-A0002"])).toEqual(["id-A0001"]);
  });
});

describe("まとめて渡す画面", () => {
  const base = { ai: host, status: status(), households: list, currentId: null, currentUnsaved: false, onChanged: () => undefined };
  it("閉じているときはボタンだけ。AI との接続がオフ・本体が対応していない・世帯が無いときは出さない", () => {
    const html = renderToString(h(AiBulkShare, base));
    expect(html).toContain("data-ai-bulk-open");
    expect(html).toContain("選んだ世帯をまとめてAIに渡す");
    expect(html).not.toContain("data-ai-bulk-panel");
    expect(renderToString(h(AiBulkShare, { ...base, status: status({ enabled: false }) }))).toBe("");
    const { bulkStart: _s, ...old } = host;
    void _s;
    expect(renderToString(h(AiBulkShare, { ...base, ai: old }))).toBe("");
    expect(renderToString(h(AiBulkShare, { ...base, households: [] }))).toBe("");
  });
  it("一覧に共有中の世帯があれば、まとめて取り消すボタンを出す", () => {
    const shares = [{ shareId: "s-1", alias: "共有中の世帯A", householdId: "id-A0001", customerNumber: "A0001", expiresInSec: 600 }];
    const html = renderToString(h(AiBulkShare, { ...base, status: status({ shares }) }));
    expect(html).toContain('data-ai-bulk-shared="1"');
    expect(html).toContain("この一覧の共有をまとめて取り消す");
  });
  it("開くと: 選ぶ欄（初めはすべて）・確かめ（渡せる・もう共有中・渡せない理由ごとの件数と顧客番号）・申告と期限・注意", () => {
    const html = renderToString(h(AiBulkShare, { ...base, initialOpen: true, initialCheck: mixed }));
    expect(html).toContain("data-ai-bulk-panel");
    expect(html).toContain('data-ai-bulk-count="4"');
    expect(html).toContain('data-ai-bulk-pick="C0004"');
    expect(html).toContain('data-ai-bulk-ready="1"');
    expect(html).toContain("渡せる世帯: <b>1件</b>（A0001）");
    expect(html).toContain("もう共有中の世帯: 1件（A0002）");
    expect(html).toContain('data-ai-bulk-blocked="2"');
    expect(html).toContain("お客さまが「同意しない」と答えた世帯（1件）: A0003");
    expect(html).toContain("同意が記録されていない世帯（事務所のプライバシーポリシーも確かめていません）（1件）: C0004");
    expect(html).toContain("data-ai-bulk-destination");
    expect(html).toContain("1時間");
    expect(html).toContain("メモと面談の履歴の文は渡しません");
    expect(html).toContain("選んだ世帯をAIに渡す（1件）");
    expect(html).not.toContain("data-ai-bulk-over");
  });
  it("一覧が上限を超えるときは選ばずに始め、上限の文を出さない（選んだら出す）", () => {
    const many = Array.from({ length: BULK_LIMIT + 1 }, (_, i) => row(`A${String(i).padStart(4, "0")}`));
    const html = renderToString(h(AiBulkShare, { ...base, households: many, initialOpen: true }));
    expect(html).toContain('data-ai-bulk-count="0"');
    expect(html).not.toContain("data-ai-bulk-over");
  });
  it("共有中の世帯と合わせて上限を超える確かめなら、上限の文を出して渡すボタンを押せない", () => {
    const r = Array.from({ length: 4 }, (_, i) => ({ id: list[i]!.id, customerNo: list[i]!.customerNo, basis: "consent" as const, alias: null }));
    const html = renderToString(h(AiBulkShare, { ...base, initialOpen: true, initialCheck: outcome({ ready: r, active: 47 }) }));
    expect(html).toContain("data-ai-bulk-over");
    expect(html).toMatch(/<button type="submit" class="btn primary" disabled[ =>][^>]*data-ai-bulk-start/);
  });
  it("開いている世帯に保存していない変更があれば、保存した内容を渡すことを添える", () => {
    const html = renderToString(h(AiBulkShare, { ...base, currentId: "id-A0002", currentUnsaved: true, initialOpen: true }));
    expect(html).toContain("data-ai-bulk-unsaved");
    expect(html).toContain("開いている世帯（A0002）は、保存した内容を渡します。いまの入力の変更は、保存するまでAIの計算に入りません。");
    expect(html).toContain("A0002（開いています）");
    expect(renderToString(h(AiBulkShare, { ...base, currentId: "id-A0002", currentUnsaved: false, initialOpen: true }))).not.toContain("data-ai-bulk-unsaved");
  });
  it("渡した後: 件数と、AI に見える仮名と顧客番号の対応", () => {
    const done = outcome({ ready: [{ id: "id-A0001", customerNo: "A0001", basis: "consent", alias: "共有中の世帯A" }], blocked: mixed.blocked });
    const html = renderToString(h(BulkOutcomeView, { o: done, done: true }));
    expect(html).toContain("<b>1件</b>をAIに渡しました");
    expect(html).toContain("A0001 → 共有中の世帯A");
    expect(html).toContain("渡さなかった世帯: <b>2件</b>");
    expect(renderToString(h(BulkOutcomeView, { o: outcome(), done: true }))).toContain("渡した世帯はありません");
  });
});

describe("世帯の一覧への置き方", () => {
  const panel: HouseholdPanelProps = {
    status: { state: "ready", firstRun: false, recoveryAcknowledged: true, recoveryVerifiedAt: null, lastOpened: null, deletionsPending: 0, deletionsCompleted: 0 },
    unavailable: null,
    error: null,
    list,
    currentId: null,
    categories: [...DEFAULT_CATEGORIES],
    shelf: shelfItems(
      DEMO_HOUSEHOLDS.map((d) => ({ id: d.id, sampleNo: d.sampleNo, title: d.title, traits: d.traits })),
      [],
    ),
    currentSample: null,
    currentShape: null,
    unsavedTitle: null,
    onOpen: () => undefined,
    onCreate: () => undefined,
    onSaveCurrent: () => undefined,
    onRename: async () => null,
    onSetCategory: async () => null,
    onAssignSerial: async () => null,
    onMakeSample: async () => null,
    onSaveCategories: async () => null,
    onDelete: async () => null,
    onOpenSample: () => undefined,
    onCustomerFromSample: () => undefined,
    onCopySample: () => undefined,
    onUpdateSample: async () => null,
    onRecovery: () => undefined,
    onClose: () => undefined,
  };
  it("顧客の一覧の絞り込みの結果に対する操作として、一覧の上に出す（見本の棚には出さない）", () => {
    let got: StoredHousehold[] = [];
    const html = renderToString(
      h(HouseholdPanel, {
        ...panel,
        aiBulk: (shown) => {
          got = shown;
          return h(AiBulkShare, { ai: host, status: status(), households: shown, currentId: null, currentUnsaved: false, onChanged: () => undefined });
        },
      }),
    );
    expect(got.map((x) => x.customerNo)).toEqual(["A0001", "A0002", "A0003", "C0004"]);
    expect(html.indexOf("data-ai-bulk-open")).toBeGreaterThan(html.indexOf("data-household-search"));
    expect(html.indexOf("data-ai-bulk-open")).toBeLessThan(html.indexOf('data-household-row="A0001"'));
    const shelf = renderToString(h(HouseholdPanel, { ...panel, initialTab: "samples", aiBulk: () => h("i", { "data-ai-bulk-open": "" }) }));
    expect(shelf).not.toContain("data-ai-bulk-open");
    // 渡さなければ出さない
    expect(renderToString(h(HouseholdPanel, panel))).not.toContain("data-ai-bulk");
  });
});
