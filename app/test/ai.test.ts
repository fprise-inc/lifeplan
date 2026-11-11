// AI接続口の画面（0014・0015・0016）: 既定はオフ・同意の無い世帯は渡せない見せ方・AIからの候補は承認するまで世帯に入らない・
// AI が書いた文章は文字のまま・画面にパスや鍵が渡らない
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { h } from "preact";
import { renderToString } from "preact-render-to-string";
import { describe, expect, it } from "vitest";
import { APP_DIR } from "../scripts/lib.ts";
import type { AiCandidate, AiHost, AiHouseholdView, AiStatus } from "../src/engine/host.ts";
import { AiCandidates } from "../src/workspace/ai/AiCandidates.tsx";
import { AiConnectorPanel } from "../src/workspace/ai/AiConnectorPanel.tsx";
import { AiShareBand } from "../src/workspace/ai/AiShareBand.tsx";
import { AiRecords, AiSharePanel } from "../src/workspace/ai/AiSharePanel.tsx";
import { acceptCandidate, candidateRows, candidateValues, consentCoversDocuments, consentMethods, remainingText, savedInputOf, shareState, unsavedForAi } from "../src/workspace/ai/model.ts";
import { demoHousehold } from "../src/workspace/catalog.ts";
import { fromRequest } from "../src/workspace/input/household.ts";
import { buildCatalog } from "../src/workspace/plans/items.ts";
import { roles } from "../src/workspace/roles.ts";
import { DEFAULT_BALANCE_SETTINGS, DEFAULT_DISPLAY_SETTINGS } from "../src/workspace/settings.ts";
import { bodyOf, EMPTY_CARRY } from "../src/workspace/store/body.ts";
import { modelHousehold } from "./helpers.ts";

const NOW = "2026-10-19T01:00:00.000Z";
const no = async (): Promise<never> => Promise.reject("E");
const host: AiHost = { status: no, setEnabled: no, copySetup: no, household: no, recordConsent: no, startShare: no, stopShare: no, decide: no, takeDocuments: no };

const status = (over: Partial<AiStatus> = {}): AiStatus => ({
  enabled: false,
  running: false,
  problem: null,
  storeReady: true,
  connector: { found: true, version: "0.1.0", versionMatches: true },
  shares: [],
  setup: [{ client: "json", title: "JSON の設定ファイル", text: '{ "mcpServers": { "fprise-lifeplan": { "command": "<接続口の場所>", "args": ["mcp"] } } }' }],
  durations: [15, 60, 120, 240, 480],
  dev: false,
  ...over,
});

const view = (over: Partial<AiHouseholdView> = {}): AiHouseholdView => ({
  consentState: "none",
  consents: [],
  explanation: "説明文（架空）",
  explanationRef: "sha256:00",
  share: null,
  records: [],
  candidates: [],
  allowlistVersion: "reduced@1",
  fields: ["member.birth", "assumptions.inflation"],
  saved: true,
  ...over,
});

function open() {
  const req = modelHousehold("salariedCoupleTwoKids");
  const self = roles(req).find((r) => r.key === "self")!.member;
  const wh = fromRequest(req, { memo: ["架空のメモ"] });
  return { wh, cat: buildCatalog(wh, self.id, demoHousehold("salariedCoupleTwoKids") ?? null), self: self.id };
}

const candidate = (diffs: AiCandidate["diffs"], title = "物価の想定を下げるプラン"): AiCandidate => ({
  id: "c-1",
  source: "ai",
  shareId: "s-1",
  receivedAt: NOW,
  title,
  summary: "比較するため",
  diffs,
  origin: { kind: "ai", connector: "client 1.0" },
  status: "pending",
  decidedAt: null,
  decidedBy: null,
  planId: null,
});

describe("AI接続口の状態（既定はオフ・同意が無ければ渡さない）", () => {
  it("設定がオフ・読めないときは「使わない」。同意の記録が無ければ「共有しない」", () => {
    expect(shareState(null, null)).toBe("off");
    expect(shareState(status(), view())).toBe("off");
    expect(shareState(status({ enabled: true }), view())).toBe("none");
    expect(shareState(status({ enabled: true }), view({ consentState: "withdrawn" }))).toBe("withdrawn");
    expect(shareState(status({ enabled: true }), view({ consentState: "given" }))).toBe("given");
    expect(shareState(status({ enabled: true }), view({ saved: false }))).toBe("unsaved");
    const share = { shareId: "s-1", alias: "共有中の世帯A", householdId: "h", customerNumber: "A0001", expiresInSec: 3500 };
    expect(shareState(status({ enabled: true }), view({ consentState: "given", share }))).toBe("sharing");
    expect(remainingText(3500)).toBe("残り59分");
    expect(remainingText(4320)).toBe("残り1時間12分");
  });

  it("事務所の設定のパネル: 既定はオフで、文面の接続口の場所は伏せてある", () => {
    const html = renderToString(h(AiConnectorPanel, { ai: host, status: status(), onStatus: () => undefined, onChanged: () => undefined, onClose: () => undefined }));
    expect(html).toContain("オフ（既定）");
    expect(html).toContain("&lt;接続口の場所>");
    expect(html).not.toMatch(/\/Users\/|\/Applications\/|Library\/Application Support|:\\\\/);
  });

  it("世帯のパネル: 同意が無いときは同意の記録の欄を出し、AIに渡すボタンは出さない", () => {
    const html = renderToString(h(AiSharePanel, { ai: host, householdId: "h", customerNo: "A0001", status: status({ enabled: true }), view: view(), onView: () => undefined, onOpenConnector: () => undefined, onClose: () => undefined }));
    expect(html).toContain("data-ai-consent-form");
    expect(html).toContain("同意を記録すると、渡せるようになります");
    expect(html).not.toContain("data-ai-share-start");
    // 同意があるときだけ、渡すボタンが出る
    const given = renderToString(h(AiSharePanel, { ai: host, householdId: "h", customerNo: "A0001", status: status({ enabled: true }), view: view({ consentState: "given", consentDocuments: true }), onView: () => undefined, onOpenConnector: () => undefined, onClose: () => undefined }));
    expect(given).toContain("data-ai-share-start");
    expect(given).not.toContain("data-ai-consent-form");
    expect(given).not.toContain("data-ai-consent-renew");
    expect(given).toContain("data-ai-withdraw-open");
    // AI接続口がオフなら、同意があっても渡せない
    const off = renderToString(h(AiSharePanel, { ai: host, householdId: "h", customerNo: "A0001", status: status(), view: view({ consentState: "given" }), onView: () => undefined, onOpenConnector: () => undefined, onClose: () => undefined }));
    expect(off).not.toContain("data-ai-share-start");
    expect(off).toContain("AI接続口はオフです（既定）");
  });

  it("世帯のパネル: 前の版の説明（書類を含まない）の同意は、渡せるまま、今の説明で記録し直す欄を出す（0157）", () => {
    const old = { id: "c-old", kind: "externalAi" as const, decision: "given" as const, obtainedOn: "2026-10-19", method: "paper" as const, externalAi: { company: "架空AI株式会社", country: "日本", noTrainingConfirmed: true }, scope: "reduced", fpConfirmed: true, recordedAt: NOW, origin: "thisOffice" as const };
    const html = renderToString(h(AiSharePanel, { ai: host, householdId: "h", customerNo: "A0001", status: status({ enabled: true }), view: view({ consentState: "given", consentDocuments: false, explanationVersion: 2, consents: [old] }), onView: () => undefined, onOpenConnector: () => undefined, onClose: () => undefined }));
    expect(html).toContain("data-ai-consent-renew");
    expect(html).toContain("data-ai-consent-form");
    expect(html).toContain("今の説明で同意を記録し直す");
    expect(html).toContain("説明（版2）");
    expect(html).toContain("前の版の説明（書類を含まない）");
    // 取り直しでは「同意しなかった」を記録しない（計算の項目まで止まるため）。撤回はできる
    expect(html).not.toContain("data-ai-record-refused");
    expect(html).toContain("data-ai-withdraw-open");
    // 計算の項目は渡せる。書類は渡さない注意を出す
    expect(html).toContain("data-ai-share-start");
    expect(html).toContain("data-ai-share-no-documents");
    const renewed = renderToString(h(AiSharePanel, { ai: host, householdId: "h", customerNo: "A0001", status: status({ enabled: true }), view: view({ consentState: "given", consentDocuments: true, consents: [old, { ...old, id: "c-new", documents: true }] }), onView: () => undefined, onOpenConnector: () => undefined, onClose: () => undefined }));
    expect(renewed).not.toContain("data-ai-consent-renew");
    expect(renewed).not.toContain("data-ai-share-no-documents");
    expect(renewed).toContain("書類の読み取りを含む");
  });

  it("同意は外部の AI サービスに渡すことへの同意1つ: どの AI の会社かは聞かない。前の版の記録の会社はそのまま出す（0172）", () => {
    const panel = (v: AiHouseholdView) => renderToString(h(AiSharePanel, { ai: host, householdId: "h", customerNo: "A0001", status: status({ enabled: true }), view: v, onView: () => undefined, onOpenConnector: () => undefined, onClose: () => undefined }));
    const none = panel(view());
    expect(none).toContain("data-ai-consent-form");
    expect(none).not.toContain("data-ai-company");
    expect(none).not.toContain("data-ai-country");
    expect(none).not.toContain("提供先のAIの会社");
    const c = { id: "c-1", kind: "externalAi" as const, decision: "given" as const, obtainedOn: "2026-11-08", method: "paper" as const, externalAi: { noTrainingConfirmed: true }, scope: "reduced", documents: true, fpConfirmed: true, recordedAt: NOW, origin: "thisOffice" as const };
    const given = panel(view({ consentState: "given", consentDocuments: true, consents: [c] }));
    expect(given).toContain("data-ai-share-start");
    expect(given).not.toContain("data-ai-share-company");
    expect(given).not.toContain("同意した会社");
    expect(given).not.toContain("提供先");
    // 記録の一覧: 会社を持たない行だけなら提供先の列を出さない。前の版の会社のある行は、そのまま出す
    expect(renderToString(h(AiRecords, { view: view({ consents: [c] }) }))).not.toContain("提供先");
    const old = { ...c, id: "c-old", documents: undefined, externalAi: { company: "架空AI株式会社", country: "日本", noTrainingConfirmed: true } };
    const records = renderToString(h(AiRecords, { view: view({ consents: [old, c] }) }));
    expect(records).toContain("提供先（前の記録）");
    expect(records).toContain("架空AI株式会社（日本）");
  });

  it("ヒアリングシートの同意欄で取った同意は書類を含まない。今の説明で取り直す欄を出し、取り直しではシートの同意欄を選ばせない（0172）", () => {
    expect(consentCoversDocuments("hearingSheet")).toBe(false);
    expect(consentCoversDocuments("paper")).toBe(true);
    expect(consentMethods(false).map((m) => m.value)).toContain("hearingSheet");
    expect(consentMethods(true).map((m) => m.value)).not.toContain("hearingSheet");
    const sheet = { id: "c-sheet", kind: "externalAi" as const, decision: "given" as const, obtainedOn: "2026-11-08", method: "hearingSheet" as const, externalAi: { company: "架空AI株式会社", country: "日本", noTrainingConfirmed: true }, scope: "reduced", fpConfirmed: true, recordedAt: NOW, origin: "thisOffice" as const };
    const html = renderToString(h(AiSharePanel, { ai: host, householdId: "h", customerNo: "A0001", status: status({ enabled: true }), view: view({ consentState: "given", consentDocuments: false, explanationVersion: 2, hearingSheetExplanation: "（任意）シートの文（架空）", consents: [sheet] }), onView: () => undefined, onOpenConnector: () => undefined, onClose: () => undefined }));
    expect(html).toContain("data-ai-consent-renew");
    expect(html).toContain("ヒアリングシートの同意欄でいただいたもの");
    expect(html).toContain("シートの同意欄の文（書類を含まない）");
    expect(html).toContain("今の説明で同意を記録し直す");
    expect(html).not.toContain('value="hearingSheet"');
    expect(html).toContain("data-ai-share-no-documents");
  });

  it("共有中の帯は、共有が無ければ出さない。入力の画面のほかでは顧客番号を出さない", () => {
    expect(renderToString(h(AiShareBand, { shares: [], detailed: true, onStop: () => undefined, onOpen: () => undefined }))).toBe("");
    const shares = [{ shareId: "s", alias: "共有中の世帯A", householdId: "h", customerNumber: "A0001", expiresInSec: 600 }];
    const html = renderToString(h(AiShareBand, { shares, detailed: true, onStop: () => undefined, onOpen: () => undefined }));
    expect(html).toContain("AIに渡しています");
    expect(html).toContain("A0001");
    // 顧客と一緒に見ることのある画面では、どの世帯かが分かる情報を出さない
    const brief = renderToString(h(AiShareBand, { shares, detailed: false, onStop: () => undefined, onOpen: () => undefined }));
    expect(brief).toContain("AIに渡しています（1件）");
    expect(brief).not.toContain("A0001");
    expect(brief).not.toContain("共有中の世帯A");
    // 「AI接続口の設定」はパネルを開くので、小窓が開く印を付ける
    for (const x of [html, brief]) expect(x.slice(x.indexOf("data-ai-band-open"))).toMatch(/^[^<]*AI接続口の設定<svg [^>]*data-pop-icon/);
  });

  it("保存していない入力の変更があるときだけ、共有中の帯に「保存するとAIにも反映されます」を出す（0184 の追記）", () => {
    const shares = [{ shareId: "s", alias: "共有中の世帯A", householdId: "h", customerNumber: "A0001", expiresInSec: 600 }];
    for (const detailed of [true, false]) {
      const base = { shares, detailed, onStop: () => undefined, onOpen: () => undefined };
      const on = renderToString(h(AiShareBand, { ...base, unsaved: true }));
      expect(on).toContain("data-ai-band-unsaved");
      expect(on).toContain("保存するとAIにも反映されます");
      for (const off of [renderToString(h(AiShareBand, { ...base, unsaved: false })), renderToString(h(AiShareBand, base))]) {
        expect(off).toContain("AIに渡しています");
        expect(off).not.toContain("data-ai-band-unsaved");
        expect(off).not.toContain("反映されます");
      }
      // 共有が無ければ、保存していない変更があっても帯ごと出さない
      expect(renderToString(h(AiShareBand, { ...base, shares: [], unsaved: true }))).toBe("");
      // ほかの人が開いていて自動保存を止めている間は、保存するのに「編集を始める」が要るので、そう書く（0023 の7）
      const paused = renderToString(h(AiShareBand, { ...base, unsaved: true, paused: true }));
      expect(paused).toContain("編集を始めて保存するとAIにも反映されます");
      expect(renderToString(h(AiShareBand, { ...base, unsaved: false, paused: true }))).not.toContain("反映されます");
    }
  });

  it("出すかは、AIに渡している世帯の保存した現状の入力と、画面の現状の入力を中身で比較して決める（0184 の追記）", () => {
    const { wh } = open();
    const body = (w: typeof wh) => bodyOf({ wh: w, workspace: { template: null, band: [], base: "current", selected: "current", shownItems: [] }, display: { result: DEFAULT_DISPLAY_SETTINGS, balance: DEFAULT_BALANCE_SETTINGS }, carry: EMPTY_CARRY });
    const saved = savedInputOf(body(wh));
    expect(saved).toBeDefined();
    // 保存したまま: 出さない（欄の並びが変わっても同じ中身なら出さない。本体は読み直して欄の並びを変えて書く）
    expect(unsavedForAi(true, saved, wh.request.input)).toBe(false);
    expect(unsavedForAi(true, saved, Object.fromEntries(Object.entries(wh.request.input).reverse()))).toBe(false);
    // 現状の入力を直してまだ保存していない: 出す
    const edited = { ...wh.request.input, endYear: wh.request.input.endYear + 1 };
    expect(unsavedForAi(true, saved, edited)).toBe(true);
    // 共有していない: 出さない
    expect(unsavedForAi(false, saved, edited)).toBe(false);
    // 保存すれば（保存した本文が今の入力になれば）出さない
    expect(unsavedForAi(true, savedInputOf(body({ ...wh, request: { ...wh.request, input: edited } })), edited)).toBe(false);
    // プランの保存していない変更・表示の設定は世帯の現状の入力に入らない（AIに渡らない）ので、本文が違っても出さない
    const otherDisplay = bodyOf({ wh, workspace: { template: null, band: [], base: "current", selected: "current", shownItems: ["x"] }, display: { result: { ...DEFAULT_DISPLAY_SETTINGS, atAge: 80 }, balance: DEFAULT_BALANCE_SETTINGS }, carry: EMPTY_CARRY });
    expect(unsavedForAi(true, savedInputOf(otherDisplay), wh.request.input)).toBe(false);
    // 保存した本文が分からない・読めない: 出さない
    expect(savedInputOf(undefined)).toBeUndefined();
    expect(savedInputOf("{")).toBeUndefined();
    expect(unsavedForAi(true, undefined, edited)).toBe(false);
  });
});

describe("AIからの候補（承認するまで世帯に入らない）", () => {
  it("主画面の項目に当てはまる変更だけをプランにし、当てはまらないものは理由つきで取り込まない", () => {
    const { wh, cat, self } = open();
    const c = candidate([
      { id: "d1", target: { plan: "assumptions" }, item: "assumptions.inflation", op: "set", value: "0.005", note: "低めに見る" },
      { id: "d2", target: { object: self }, item: "member.sex", op: "set", value: "male", note: null },
      { id: "d3", target: { plan: "assumptions" }, item: "assumptions.wageGrowth", op: "set", value: { nested: true }, note: null },
    ]);
    const rows = candidateRows(c, wh, cat);
    expect(rows.map((r) => r.reason === null)).toEqual([true, false, false]);
    const values = candidateValues(rows);
    expect(Object.keys(values)).toEqual(["field:assume/inflation"]);
    // 見るだけでは世帯もプランも変わらない
    expect(wh.proposals).toEqual([]);
  });

  it("FP が承認すると、出どころ AI・承認 FP の記録を持つプランが1つ増える（現状は変わらない）", () => {
    const { wh, cat } = open();
    const before = structuredClone(wh.request);
    const c = candidate([{ id: "d1", target: { plan: "assumptions" }, item: "assumptions.inflation", op: "set", value: { default: "0.005" }, note: null }]);
    const values = candidateValues(candidateRows(c, wh, cat));
    const r = acceptCandidate(wh, cat, c, values, "プランB 物価の想定を下げる", NOW);
    expect(r.wh.request).toEqual(before);
    expect(r.wh.proposals).toHaveLength(1);
    const plan = r.wh.proposals[0]!;
    expect(plan.source).toEqual({ kind: "ai", candidate: "c-1" });
    expect(plan.diffs[0]!.origin).toEqual({ kind: "ai", ref: "c-1", connector: "client 1.0" });
    expect(plan.diffs[0]!.approval).toEqual({ by: "fp", at: NOW, candidate: "c-1" });
  });

  it("配偶者の働き方と年収: 選択肢の働き方と、0〜上限の年収なら取り込み、そうでなければ取り込まない", () => {
    const { wh, cat } = open();
    const spouse = roles(wh.request).find((r) => r.key === "spouse")!.member.id;
    const work = cat.items.find((it) => it.control.kind === "work")!;
    expect(work.item).toBe("employment.type");
    const now = work.read(wh) as { type: string; annual: number };
    const diff = (id: string, value: unknown) => ({ id, target: { object: spouse }, item: "employment.type", op: "set" as const, value, note: null });
    const rows = candidateRows(
      candidate([
        diff("d1", { type: "partTime", annual: 1_200_000 }),
        diff("d2", { type: now.type, annual: now.annual }),
        diff("d3", { type: "宇宙飛行士", annual: 1_000_000 }),
        diff("d4", { type: "partTime", annual: -1 }),
        diff("d5", { type: "partTime" }),
      ]),
      wh,
      cat,
    );
    expect(rows[0]!.reason).toBeNull();
    expect(rows[0]!.value).toEqual({ type: "partTime", annual: 1_200_000 });
    expect(rows[0]!.to).not.toContain("{");
    expect(rows[1]!.reason).toBe("今と同じ値です");
    for (const r of rows.slice(2)) expect(r.reason).toBe("値の形がこの項目に合わないため、取り込みません");
    expect(Object.keys(candidateValues(rows))).toEqual([work.key]);
  });

  it("AI が書いた題名・説明・理由は文字のまま出す（HTML にしない）", () => {
    const { wh, cat } = open();
    const c = candidate([{ id: "d1", target: { plan: "assumptions" }, item: "assumptions.inflation", op: "set", value: "0.005", note: "<img src=x onerror=alert(1)>" }], "<script>alert(1)</script>");
    const html = renderToString(h(AiCandidates, { candidates: [c], wh, catalog: cat, onAccept: async () => undefined, onReject: async () => undefined }));
    expect(html).toContain("AIが書いた題名");
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;script>");
    // 判断済みの候補は出さない
    expect(renderToString(h(AiCandidates, { candidates: [{ ...c, status: "rejected" }], wh, catalog: cat, onAccept: async () => undefined, onReject: async () => undefined }))).toBe("");
  });

  it("共有の記録: 呼び出し元は参考情報として出し、接続先は申告として出す", () => {
    const html = renderToString(
      h(AiRecords, {
        view: view({
          records: [
            {
              id: "r1",
              kind: "household",
              shareId: "s-1",
              grantedAt: NOW,
              expiresAt: NOW,
              endedAt: NOW,
              endReason: "consentWithdrawn",
              scope: "reduced",
              allowlistVersion: "reduced@1",
              fields: ["member.birth"],
              householdRevision: "generation-2",
              destinationDeclared: "事務所のAIアプリ",
              consentAtGrant: { state: "given", recordId: "c", warned: false },
              reads: [{ firstAt: NOW, lastAt: NOW, count: 3, tool: "get_shared_household", fields: [], digest: "sha256:0123456789abcdef0123", caller: { connectorPid: 7, connectorExe: "lifeplan", parentExe: "ai-app", mcpClientDeclared: "client 1.0" } }],
              proposals: [],
            },
          ],
        }),
      }),
    );
    expect(html).toContain("認証ではありません");
    expect(html).toContain("同意の撤回");
    expect(html).toContain("事務所のAIアプリ");
    expect(html).toContain("3回");
  });
});

describe("画面にパスや鍵が渡らない（0016 の1）", () => {
  it("AI接続口の命令に渡すのは、内部ID・設定の入切・文面の種類・同意の入力・期限・申告・候補の判断（受け取った書類の候補の ID を含む）だけ", () => {
    const src = readFileSync(join(APP_DIR, "src", "engine", "host.ts"), "utf8");
    const calls = [...src.matchAll(/invoke<[^>]*>\("(ai_[a-z_]+)"(?:, \{ ([^}]*) \})?\)/g)];
    expect(calls.map((c) => c[1]).sort()).toEqual(["ai_candidate_decide", "ai_consent_record", "ai_documents_taken", "ai_household", "ai_set_enabled", "ai_setup_copy", "ai_share_start", "ai_share_stop", "ai_status"]);
    const allowed = new Set(["id", "enabled", "client", "input", "minutes", "destination", "candidate", "accept", "plan"]);
    for (const c of calls) {
      const args = (c[2] ?? "").split(",").map((x) => x.trim()).filter((x) => x !== "");
      for (const a of args) expect(allowed.has(a), `${c[1]} の引数 ${a}`).toBe(true);
    }
  });

  it("本体の AI の命令は、パス・鍵を返す型を持たない（返すのは状態・記録・伏せた文面だけ）", () => {
    const rs = readFileSync(join(APP_DIR, "src-tauri", "src", "ai.rs"), "utf8");
    const sigs = [...rs.matchAll(/#\[tauri::command\]\s*pub async fn (ai_[a-z_]+)\(([^)]*)\)\s*->\s*([^{]+)\{/g)];
    expect(sigs.length).toBe(9);
    for (const [, name, args, ret] of sigs) {
      expect(`${args}`.toLowerCase(), name).not.toMatch(/path|dir|file|key/);
      expect(`${ret}`, name).not.toMatch(/PathBuf|String,|Vec<u8>/);
    }
  });

  it("AI接続口の画面の部品は、提示の層に入っていない（顧客に見せる画面に共有の状態を出さない）", () => {
    const files = readdirSync(join(APP_DIR, "src", "presentation"));
    for (const f of files) expect(readFileSync(join(APP_DIR, "src", "presentation", f), "utf8"), f).not.toMatch(/workspace\/ai|AiShare|aiShares/);
  });
});
