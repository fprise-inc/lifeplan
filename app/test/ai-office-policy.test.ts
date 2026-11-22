// AI接続を使える条件の画面の側（0226。利用者の判断 2026-11-18）: 判定は本体（ai_share::ai_use）の1か所で、画面は本体が返した aiUse を見せるだけ。
// 4通り（同意あり／答え無し＋確かめ済み／答え無し＋未確認／同意しない＋確かめ済み）を、上の帯の状態・同意と共有の画面で確かめる。
// 事務所の設定の画面には「事務所のプライバシーポリシーに AI の利用を書いている」を確かめた印と日時を出す
import { h } from "preact";
import { renderToString } from "preact-render-to-string";
import { describe, expect, it } from "vitest";
import type { AiHost, AiHouseholdView, AiStatus, AiUse } from "../src/engine/host.ts";
import { AiConnectorPanel } from "../src/workspace/ai/AiConnectorPanel.tsx";
import { AiRecords, AiSharePanel } from "../src/workspace/ai/AiSharePanel.tsx";
import { aiDocumentsUseOf, aiUseOf, shareState, SHARE_STATE_TEXT } from "../src/workspace/ai/model.ts";

const no = async (): Promise<never> => Promise.reject("E");
const host: AiHost = { status: no, setEnabled: no, setPrivacyPolicy: no, copySetup: no, household: no, recordConsent: no, startShare: no, stopShare: no, decide: no, takeDocuments: no, householdCandidates: no, discardHouseholdCandidate: no, createFromCandidate: no, displayCandidates: no, takeDisplayChange: no, takeHouseholdDisplayChange: no };

const status = (over: Partial<AiStatus> = {}): AiStatus => ({
  enabled: true,
  running: true,
  problem: null,
  storeReady: true,
  connector: { found: true, version: "0.1.0", versionMatches: true },
  shares: [],
  setup: [],
  durations: [15, 60],
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
  allowlistVersion: "reduced@2",
  fields: ["member.birth"],
  saved: true,
  ...over,
});

/** 本体が返す4通り（同意の状態と、本体が決めた判定） */
const CASES: { name: string; v: AiHouseholdView; use: AiUse }[] = [
  { name: "同意あり", v: view({ consentState: "given", consentDocuments: true, aiUse: "consent", aiDocumentsUse: "consent" }), use: "consent" },
  { name: "答え無し＋確かめ済み", v: view({ aiUse: "officePolicy", aiDocumentsUse: "officePolicy" }), use: "officePolicy" },
  { name: "答え無し＋未確認", v: view({ aiUse: "none", aiDocumentsUse: "none" }), use: "none" },
  { name: "同意しない＋確かめ済み", v: view({ consentState: "refused", aiUse: "refused", aiDocumentsUse: "refused" }), use: "refused" },
];

const panel = (v: AiHouseholdView) => renderToString(h(AiSharePanel, { ai: host, householdId: "h", customerNo: "A0001", status: status(), view: v, onView: () => undefined, onOpenConnector: () => undefined, onClose: () => undefined }));

describe("AI接続を使える条件の画面（0226）", () => {
  it("上の帯の状態は、本体の判定どおり（断った世帯は「同意しない」と答えたと分かる文）", () => {
    const got = CASES.map((c) => shareState(status(), c.v));
    expect(got).toEqual(["given", "office", "none", "refused"]);
    expect(SHARE_STATE_TEXT.office.long).toContain("事務所のプライバシーポリシーに沿って");
    expect(SHARE_STATE_TEXT.refused.long).toContain("「同意しない」と答えました");
    expect(SHARE_STATE_TEXT.refused.long).toContain("事務所の設定にかかわらず");
    for (const c of CASES) expect(aiUseOf(c.v)).toBe(c.use);
  });

  it("同意と共有の画面: 同意あり・確かめ済みは渡すボタンを出し、未確認・同意しないは理由を出してボタンを出さない", () => {
    const [given, office, none, refused] = CASES.map((c) => panel(c.v));
    expect(given).toContain("data-ai-share-start");
    expect(given).not.toContain("data-ai-share-office");
    // 答え無し＋確かめ済み: 渡せる。事務所のプライバシーポリシーで渡すことと、断られたら記録することを出す（同意の記録の欄は残す）
    expect(office).toContain("data-ai-share-start");
    expect(office).toContain("data-ai-share-office");
    expect(office).toContain("data-ai-consent-office");
    expect(office).toContain("data-ai-record-refused");
    expect(office).toContain("事務所のプライバシーポリシーに沿って渡します");
    // 答え無し＋未確認: 渡せない。同意を記録するか事務所の設定で確かめると渡せる
    expect(none).not.toContain("data-ai-share-start");
    expect(none).toContain('data-ai-share-blocked="none"');
    // 同意しない＋確かめ済み: 渡せない。お客さまが断ったことが分かる文
    expect(refused).not.toContain("data-ai-share-start");
    expect(refused).toContain('data-ai-share-blocked="refused"');
    expect(refused).toContain("お客さまが外部AIへの提供に「同意しない」と答えました。事務所の設定にかかわらず、この世帯は AI に渡せません。");
  });

  it("書類を含まない同意の世帯は、確かめ済みなら取り直しの注意を出さずに書類も渡せる。未確認なら今までどおり注意を出す", () => {
    const narrow = { consentState: "given" as const, consentDocuments: false, aiUse: "consent" as const };
    const covered = panel(view({ ...narrow, aiDocumentsUse: "officePolicy" }));
    expect(covered).not.toContain("data-ai-consent-renew=");
    expect(covered).toContain("data-ai-consent-renew-office");
    expect(covered).not.toContain("data-ai-share-no-documents");
    const notCovered = panel(view({ ...narrow, aiDocumentsUse: "consentWithoutDocuments" }));
    expect(notCovered).toContain("data-ai-consent-renew=");
    expect(notCovered).toContain("data-ai-share-no-documents");
  });

  it("判定を返さない本体（古い版）は、同意の状態だけで読む（事務所の設定は見ない側）", () => {
    expect(aiUseOf(view())).toBe("none");
    expect(aiUseOf(view({ consentState: "given" }))).toBe("consent");
    expect(aiDocumentsUseOf(view({ consentState: "given" }))).toBe("consentWithoutDocuments");
    expect(aiUseOf(view({ consentState: "refused", fictional: true }))).toBe("fictional");
  });

  it("共有の記録: 事務所のプライバシーポリシーで渡した記録は、そうと分かる言葉で出す", () => {
    const rec = { id: "r1", kind: "household", shareId: "s-1", grantedAt: "2026-11-18T01:00:00Z", expiresAt: "2026-11-18T02:00:00Z", endedAt: null, endReason: null, scope: "reduced", allowlistVersion: "reduced@2", fields: ["member.birth"], householdRevision: "generation-1", destinationDeclared: "Claude Desktop", consentAtGrant: { state: "officePolicy", recordId: null, warned: false }, reads: [], proposals: [] };
    const html = renderToString(h(AiRecords, { view: view({ records: [rec] }) }));
    expect(html).toContain("事務所のプライバシーポリシー（同意の記録なし・お客さまは断っていない）");
  });
});

describe("事務所の設定のプライバシーポリシーの確かめ（0226）", () => {
  const connector = (s: AiStatus) => renderToString(h(AiConnectorPanel, { ai: host, status: s, onStatus: () => undefined, onChanged: () => undefined, onClose: () => undefined }));

  it("確かめた印と日時を出す。未確認なら「まだ確かめていません」。画面に「接続口」の言葉を新しく出さない", () => {
    const off = connector(status({ privacyPolicyConfirmedAt: null }));
    expect(off).toContain("data-ai-privacy-policy");
    expect(off).toContain("事務所のプライバシーポリシーに、お客さまの情報を外部の AI サービスで扱うこと（AI を使った資料の読み取りや分析）を書いていることを確かめました");
    expect(off).toContain("まだ確かめていません。");
    expect(off).toContain("お客さまが「同意しない」と答えた世帯と、同意を撤回した世帯は、確かめた後も渡せません。");
    const on = connector(status({ privacyPolicyConfirmedAt: "2026-11-18T01:00:00Z" }));
    expect(on).toMatch(/確かめた日時: 2026年11月18日 \d\d:00/);
    // 新しく足した区画（見出しから共有中の世帯の前まで）の言葉
    const section = on.slice(on.indexOf("<h3>事務所のプライバシーポリシー</h3>"), on.indexOf("<h3>共有中の世帯</h3>"));
    expect(section).not.toContain("接続口");
    for (const w of ["当て", "比べ", "札", "カード"]) expect(section).not.toContain(w);
  });

  it("確かめる命令の無い本体では、印を押せない", () => {
    const old: AiHost = { ...host };
    delete old.setPrivacyPolicy;
    const html = renderToString(h(AiConnectorPanel, { ai: old, status: status(), onStatus: () => undefined, onChanged: () => undefined, onClose: () => undefined }));
    expect(html).toMatch(/<input type="checkbox" disabled data-ai-privacy-policy/);
  });
});
