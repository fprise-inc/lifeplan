// AIからの新しい世帯の候補（接続口の propose_household）: 読み口（番号らしい所を消す・知らない欄を読まない）・確かめの画面・作るときの形・
// 「架空」の印・架空の世帯は同意なしで渡せて、お客さまの世帯は今までどおり同意が要ること
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { h } from "preact";
import { renderToString } from "preact-render-to-string";
import { describe, expect, it } from "vitest";
import { REPO_DIR } from "../scripts/lib.ts";
import type { AiHost, AiHouseholdCandidate, AiHouseholdView, AiStatus, StoredHousehold } from "../src/engine/host.ts";
import type { EngineRequest } from "../src/engine/types.ts";
import { AiHouseholdCandidateBand, AiHouseholdCandidates } from "../src/workspace/ai/AiHouseholdCandidates.tsx";
import { approvalAt, householdOverview, noteMemo, readHouseholdCandidate, withAiOrigin } from "../src/workspace/ai/households.ts";
import { AiSharePanel } from "../src/workspace/ai/AiSharePanel.tsx";
import { shareState } from "../src/workspace/ai/model.ts";
import { pasteGate } from "../src/workspace/documents/ai.ts";
import { HouseholdNow } from "../src/workspace/header/HouseholdNow.tsx";
import { TopBar } from "../src/workspace/header/TopBar.tsx";
import { fromRequest } from "../src/workspace/input/household.ts";
import { DEFAULT_BALANCE_SETTINGS, DEFAULT_DISPLAY_SETTINGS } from "../src/workspace/settings.ts";
import { HouseholdPanel, MAKE_CLIENT_TEXT, type HouseholdPanelProps } from "../src/workspace/store/HouseholdPanel.tsx";
import { BODY_FORMAT_VERSION, bodyOf, EMPTY_CARRY, fromBody } from "../src/workspace/store/body.ts";
import { preview } from "./helpers.ts";

const CID = "0f8e7d6c-5b4a-4392-8170-6f5e4d3c2b1a";
/** 接続口の道具のテストと同じ見本の候補（crates/lifeplan/tests/fixtures/propose-household/proposal.json） */
const fixture = JSON.parse(readFileSync(join(REPO_DIR, "crates", "lifeplan", "tests", "fixtures", "propose-household", "proposal.json"), "utf8")) as { kind: "fictional"; title: string; note: string; input: EngineRequest["input"] };
const candidate = (over: Partial<AiHouseholdCandidate> = {}): AiHouseholdCandidate => ({ candidateId: CID, receivedAt: "2026-11-11T03:00:00Z", connector: "test-ai 1.0", kind: fixture.kind, title: fixture.title, note: fixture.note, input: structuredClone(fixture.input), ...over });
const no = async (): Promise<never> => Promise.reject("E");
const host: AiHost = { status: no, setEnabled: no, copySetup: no, household: no, recordConsent: no, startShare: no, stopShare: no, decide: no, takeDocuments: no, householdCandidates: no, discardHouseholdCandidate: no, createFromCandidate: no };

describe("新しい世帯の候補の読み口", () => {
  it("見本の候補は、そのまま読める（種類・題・推定したこと・入力）", () => {
    const { candidate: c, issues } = readHouseholdCandidate(candidate());
    expect(issues).toEqual([]);
    expect(c).not.toBeNull();
    expect(c?.kind).toBe("fictional");
    // 文字は書類の候補と同じく NFKC で整える（全角のかっこは半角になる）
    expect(c?.title).toBe(fixture.title.normalize("NFKC"));
    expect(c?.note).toBe(fixture.note.normalize("NFKC"));
    expect(c?.input).toEqual(fixture.input);
    expect(c?.masked).toBe(0);
    expect(c?.dropped).toBe(0);
    expect(c?.connector).toBe("test-ai 1.0");
  });

  it("番号らしい所を消す: 名前・メモの欄の文字は伏せ字にし、決まった形の欄の番号らしい値は落とす。ID・年月・率は消さない", () => {
    const input = structuredClone(fixture.input);
    const h = input.household as unknown as Record<string, unknown[]>;
    h.periodicExpenses = [{ id: "7a8b9c0d-1e2f-4a3b-8c4d-5e6f7a8b9c0d", row: "cf.expense.lumpSum.other", label: "旅行（会員番号 1234 5678 9012）", from: { at: "2027-08" }, to: { at: "2040-08" }, everyYears: 2, amount: { value: 300000, state: "confirmed", origin: { kind: "manual" } } }];
    (input.household.accounts as unknown as Record<string, unknown>[])[0]!.asOf = "0120123456789";
    const { candidate: c } = readHouseholdCandidate(candidate({ input, title: "口座番号 1234567 の世帯", note: "マイナンバー 1234-5678-9012 は書かない" }));
    expect(c).not.toBeNull();
    const pe = (c?.input.household as unknown as Record<string, Record<string, unknown>[]>).periodicExpenses![0]!;
    expect(pe.label).not.toContain("9012");
    expect(pe.label).toContain("●●●●");
    expect(pe.id).toBe("7a8b9c0d-1e2f-4a3b-8c4d-5e6f7a8b9c0d");
    expect((pe.from as { at: string }).at).toBe("2027-08");
    expect(c?.title).not.toContain("1234567");
    expect(c?.note).not.toContain("9012");
    expect((c?.input.household.accounts as unknown as Record<string, unknown>[])[0]!.asOf).toBeUndefined();
    expect(c?.masked).toBe(3);
    expect(c?.dropped).toBe(1);
    // 率・ID は消えない
    expect(c?.input.household.members.map((m) => m.id)).toEqual(fixture.input.household.members.map((m) => m.id));
    expect(c?.input.assumptions).toEqual(fixture.input.assumptions);
  });

  it("種類が分からなければお客さまの世帯として読む（同意が要る側）。家族のいない入力・形の違う ID は読まない", () => {
    expect(readHouseholdCandidate(candidate({ kind: "sample" as "client" })).candidate?.kind).toBe("client");
    expect(readHouseholdCandidate(candidate({ input: { household: { members: [] } } })).candidate).toBeNull();
    expect(readHouseholdCandidate(candidate({ input: "x" })).candidate).toBeNull();
    expect(readHouseholdCandidate(candidate({ candidateId: "x" })).candidate).toBeNull();
  });
});

describe("確かめの画面", () => {
  it("家族・収入・資産・住まい・ローン・生活費と、推定したこと・推定の値の数を出す", () => {
    const ov = householdOverview(fixture.input);
    expect(ov.family.map((r) => `${r.label} ${r.value}`)).toEqual(["ご本人 38歳・男性", "配偶者 36歳・女性"]);
    expect(ov.income.map((r) => r.label)).toEqual(["ご本人の正社員", "配偶者のパート・アルバイト"]);
    expect(ov.income[1]?.value).toContain("年収 100万円");
    expect(ov.assets).toEqual([{ label: "預金（ご本人）", value: "500万円" }]);
    expect(ov.housing[0]?.label).toBe("賃貸");
    expect(ov.housing[0]?.value).toContain("家賃 月10万円");
    expect(ov.loans).toEqual([]);
    expect(ov.living).toEqual([{ label: "毎月の生活費", value: "月25万円", estimated: true }]);
    expect(ov.estimatedCount).toBe(1);
    expect(ov.basis).toBe("2026年10月時点の計算・表は2083年まで");
  });

  it("画面: AI が書いた文は文字のまま（HTML にしない）。種類は AI の選んだ物が初めの値で、作るボタンと捨てるボタンがある", () => {
    const html = renderToString(h(AiHouseholdCandidates, { candidates: [candidate({ title: "<b>太字</b> の題" })], onCreate: async () => null, onDiscard: async () => null, onClose: () => undefined }));
    expect(html).toContain("data-ai-household-panel");
    expect(html).toContain("&lt;b>太字&lt;/b> の題");
    expect(html).not.toContain("<b>太字</b>");
    for (const sec of ["家族", "収入", "資産", "住まい", "ローン", "生活費"]) expect(html).toContain(`data-ai-household-section="${sec}"`);
    expect(html).toContain("ご本人");
    expect(html).toContain("月25万円");
    expect(html).toContain("data-ai-household-estimated");
    expect(html).toContain(fixture.note.normalize("NFKC").slice(0, 20));
    expect(html).toContain('data-ai-household-kind="fictional"');
    expect(html).toMatch(/<input type="radio"[^>]*checked[^>]*data-ai-household-kind-pick="fictional"/u);
    expect(html).toContain("data-ai-household-create");
    expect(html).toContain("data-ai-household-discard");
    expect(html).toContain("世帯の一覧に入ります");
    expect(html).not.toContain("data-ai-household-masked");
    // 確かめを渡すと、確かめが済むまで作れない
    const checking = renderToString(h(AiHouseholdCandidates, { candidates: [candidate()], check: async () => null, onCreate: async () => null, onDiscard: async () => null, onClose: () => undefined }));
    expect(checking).toContain('data-ai-household-check="checking"');
    expect(checking).toMatch(/<button[^>]*disabled[^>]*data-ai-household-create/u);
    // お客さまの世帯として届いた候補は、お客さまが初めの値
    const client = renderToString(h(AiHouseholdCandidates, { candidates: [candidate({ kind: "client" })], onCreate: async () => null, onDiscard: async () => null, onClose: () => undefined }));
    expect(client).toContain('data-ai-household-kind="client"');
    // 番号らしい所を消したら知らせる
    const masked = renderToString(h(AiHouseholdCandidates, { candidates: [candidate({ note: "口座番号 1234567 です" })], onCreate: async () => null, onDiscard: async () => null, onClose: () => undefined }));
    expect(masked).toContain("data-ai-household-masked");
    // 2件以上なら選べる
    const two = renderToString(h(AiHouseholdCandidates, { candidates: [candidate(), candidate({ candidateId: "1f8e7d6c-5b4a-4392-8170-6f5e4d3c2b1a", kind: "client" })], onCreate: async () => null, onDiscard: async () => null, onClose: () => undefined }));
    expect(two).toContain('data-ai-household-pick="1"');
  });

  it("帯: 届いた件数と開くボタンだけ（中身は出さない）。無ければ出さない", () => {
    const html = renderToString(h(AiHouseholdCandidateBand, { count: 2, onOpen: () => undefined }));
    expect(html).toContain("AIから新しい世帯の候補が届いています（2件）");
    expect(html).toContain("data-ai-household-band-open");
    expect(html).not.toContain(fixture.title);
    expect(renderToString(h(AiHouseholdCandidateBand, { count: 0, onOpen: () => undefined }))).toBe("");
  });
});

describe("世帯として作るときの形", () => {
  it("値の出どころを AI にし、FP の承認の記録を付ける（アプリが自動で決める値は変えない）。元の入力は変えず、計算できるまま", () => {
    const at = approvalAt(new Date("2026-11-11T03:04:05.678Z"));
    expect(at).toBe("2026-11-11T03:04:05Z");
    const before = structuredClone(fixture.input);
    const withAuto = structuredClone(fixture.input);
    const p = (withAuto.household.employmentPeriods ?? [])[0] as unknown as { standardMonthlyRemuneration: { health: { origin: { kind: string } } } };
    p.standardMonthlyRemuneration.health.origin = { kind: "auto" };
    const out = withAiOrigin(withAuto, CID, "test-ai 1.0", at);
    expect(withAuto).not.toBe(out);
    const living = out.household.livingExpenses?.[0]?.monthly as unknown as Record<string, unknown>;
    expect(living.origin).toEqual({ kind: "ai", ref: CID, connector: "test-ai 1.0" });
    expect(living.approval).toEqual({ by: "fp", at, candidate: CID });
    expect(living.state).toBe("estimated");
    const auto = ((out.household.employmentPeriods ?? [])[0] as unknown as { standardMonthlyRemuneration: { health: Record<string, unknown> } }).standardMonthlyRemuneration.health;
    expect(auto.origin).toEqual({ kind: "auto" });
    expect(auto.approval).toBeUndefined();
    expect(fixture.input).toEqual(before);
    // 出どころを AI にしても、エンジンのスキーマに合い、同じ数字になる
    const a = preview({ trace: "none", input: fixture.input });
    const b = preview({ trace: "none", input: withAiOrigin(fixture.input, CID, null, at) });
    expect(b.summary).toEqual(a.summary);
  });

  it("本文: 今の形式の版で書き、家族は候補と同じ（本体が候補と同じ世帯かを確かめる）。推定したことは FP のメモの1行に入る", () => {
    const { candidate: c } = readHouseholdCandidate(candidate());
    if (c === null) throw new Error("読めない");
    const input = withAiOrigin(c.input, c.candidateId, c.connector, approvalAt());
    const wh = fromRequest({ trace: "none", input }, { memo: noteMemo(c) });
    const body = bodyOf({ wh, workspace: { template: null, band: [], base: "current", selected: "current", shownItems: [] }, display: { result: DEFAULT_DISPLAY_SETTINGS, balance: DEFAULT_BALANCE_SETTINGS }, carry: EMPTY_CARRY });
    const back = fromBody(body);
    expect(back.wh.request.input.household.members.map((m) => m.id).sort()).toEqual(fixture.input.household.members.map((m) => m.id).sort());
    expect(back.wh.memo[0]).toContain(fixture.title.normalize("NFKC"));
    expect(back.wh.memo[0]).toContain("推定したこと");
    expect((JSON.parse(body) as { meta?: { formatVersion?: string } }).meta?.formatVersion ?? BODY_FORMAT_VERSION).toBe(BODY_FORMAT_VERSION);
    expect(() => preview(back.wh.request)).not.toThrow();
  });
});

describe("「架空」の印", () => {
  const row = (no: string, over: Partial<StoredHousehold> = {}): StoredHousehold => ({ id: `id-${no}`, customerNo: no, summary: "本人・配偶者", createdAt: "2026-11-11T00:00:00Z", updatedAt: "2026-11-11T00:00:00Z", updatedBy: null, openBy: [], forks: 0, serial: Number(no.slice(1)), category: no[0], ...over });
  const base: HouseholdPanelProps = {
    status: { state: "ready", firstRun: false, recoveryAcknowledged: true, recoveryVerifiedAt: null, lastOpened: null, deletionsPending: 0, deletionsCompleted: 0 },
    unavailable: null,
    error: null,
    list: [row("C0001", { fictional: true }), row("C0002")],
    currentId: null,
    categories: [{ code: "C", name: "見込み客" }],
    shelf: [],
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
    onMakeClient: async () => null,
    onSaveCategories: async () => null,
    onDelete: async () => null,
    onOpenSample: () => undefined,
    onCustomerFromSample: () => undefined,
    onCopySample: () => undefined,
    onUpdateSample: async () => null,
    onRecovery: () => undefined,
    onClose: () => undefined,
  };

  it("世帯の一覧: 架空の世帯にだけ印と「お客さまの世帯にする」が出る（お客さまの世帯を架空にする操作は無い）", () => {
    const html = renderToString(h(HouseholdPanel, base));
    expect(html).toContain('data-household-fictional="C0001"');
    expect(html).not.toContain('data-household-fictional="C0002"');
    expect(html).toContain('data-make-client="C0001"');
    expect(html).not.toContain('data-make-client="C0002"');
    expect(html).not.toContain("架空にする");
    expect(MAKE_CLIENT_TEXT).toContain("架空の世帯に戻すことはできません");
    // 渡さなければ出さない
    const { onMakeClient: _x, ...rest } = base;
    void _x;
    expect(renderToString(h(HouseholdPanel, rest))).not.toContain("data-make-client=");
  });

  it("開いた世帯: 上の帯の世帯の箱と、開いている世帯の状態に印が出る", () => {
    const bar = (fictional: boolean) => renderToString(h(TopBar, { tabs: [{ id: "main", label: "結果" }], tab: "main", onTab: () => undefined, household: { no: "C0001", sub: "本人・配偶者", open: false, onToggle: () => undefined, fictional }, alerts: [], notices: { items: [], onRead: () => undefined }, tools: null, big: false, onBig: () => undefined }));
    expect(bar(true)).toContain("data-household-fictional");
    expect(bar(true)).toContain("架空の世帯");
    expect(bar(false)).not.toContain("data-household-fictional");
    const now = (fictional: boolean) => renderToString(h(HouseholdNow, { title: "顧客番号 C0001", fictional, members: null, asOf: null, save: { text: "保存しました", cls: "", state: "saved" }, ai: null }));
    expect(now(true)).toContain("data-household-now-fictional");
    expect(now(false)).not.toContain("data-household-now-fictional");
  });
});

describe("AIに渡す: 架空の世帯は同意なしで、お客さまの世帯は同意が要る", () => {
  const status = (over: Partial<AiStatus> = {}): AiStatus => ({ enabled: true, running: true, problem: null, storeReady: true, connector: { found: true, version: "0.1.0", versionMatches: true }, shares: [], setup: [], durations: [15, 60], dev: false, ...over });
  const view = (over: Partial<AiHouseholdView> = {}): AiHouseholdView => ({ consentState: "none", consents: [], explanation: "説明文（架空）", explanationRef: "sha256:00", share: null, records: [], candidates: [], allowlistVersion: "reduced@1", fields: ["member.birth"], saved: true, ...over });
  const panel = (v: AiHouseholdView) => renderToString(h(AiSharePanel, { ai: host, householdId: "h", customerNo: "C0001", status: status(), view: v, onView: () => undefined, onOpenConnector: () => undefined, onClose: () => undefined }));

  it("状態: 架空の世帯は同意が無くても渡せる状態。お客さまの世帯は今までどおり", () => {
    expect(shareState(status(), view({ fictional: true }))).toBe("fictional");
    expect(shareState(status(), view())).toBe("none");
    expect(shareState(status(), view({ fictional: true, consentState: "given" }))).toBe("given");
    expect(shareState(status({ enabled: false }), view({ fictional: true }))).toBe("off");
    expect(shareState(status(), view({ fictional: true, saved: false }))).toBe("unsaved");
  });

  it("パネル: 架空の世帯は同意の欄を出さずに渡す欄を出す。お客さまの世帯は同意の欄だけで、渡す欄は出さない", () => {
    const f = panel(view({ fictional: true }));
    expect(f).toContain("data-ai-fictional-note");
    expect(f).toContain("data-ai-share-form");
    expect(f).not.toContain("data-ai-consent-form");
    expect(f).toContain("架空の世帯");
    const c = panel(view());
    expect(c).toContain("data-ai-consent-form");
    expect(c).not.toContain("data-ai-share-form");
    expect(c).not.toContain("data-ai-fictional-note");
  });

  it("書類の貼り付けの入口: 架空の世帯は見本と同じく使える。お客さまの世帯は同意が要る", () => {
    expect(pasteGate({ sample: true, saved: true, consentState: "none", consentDocuments: false }).ok).toBe(true);
    expect(pasteGate({ sample: false, saved: true, consentState: "none", consentDocuments: false }).ok).toBe(false);
  });
});
