// メモと面談の履歴も AI に渡す（0249）: 印・渡せない理由の文・伏せる言葉（保存しない）・AI に渡る文の確かめの画面・事務所の設定
import { h } from "preact";
import { renderToString } from "preact-render-to-string";
import { describe, expect, it } from "vitest";
import type { AiHost, AiHouseholdView, AiNotesPreview, AiStatus } from "../src/engine/host.ts";
import { MASK_WORDS_NOTE, MaskedText, NOTES_OPTION_TEXT, NotesOptions, NotesPreviewList } from "../src/workspace/ai/AiNotesOptions.tsx";
import { AiConnectorPanel } from "../src/workspace/ai/AiConnectorPanel.tsx";
import { AiSharePanel } from "../src/workspace/ai/AiSharePanel.tsx";
import { BulkOutcomeView } from "../src/workspace/ai/AiBulkShare.tsx";
import { maskWords, NOTES_BLOCKED_TEXT } from "../src/workspace/ai/model.ts";

const no = async (): Promise<never> => Promise.reject("E");
const host: AiHost = { status: no, setEnabled: no, copySetup: no, household: no, recordConsent: no, startShare: no, stopShare: no, decide: no, takeDocuments: no, householdCandidates: no, discardHouseholdCandidate: no, createFromCandidate: no, displayCandidates: no, takeDisplayChange: no, takeHouseholdDisplayChange: no, notesPreview: no, setNotesPolicy: no, setNotesDefault: no, setPrivacyPolicy: no };
const status = (over: Partial<AiStatus> = {}): AiStatus => ({ enabled: true, running: true, problem: null, storeReady: true, connector: { found: true, version: "0.1.0", versionMatches: true }, shares: [], setup: [], durations: [60], dev: false, ...over });
const view = (over: Partial<AiHouseholdView> = {}): AiHouseholdView => ({ consentState: "given", consentDocuments: true, consents: [], explanation: "説明文（架空）", explanationRef: "sha256:00", share: null, records: [], candidates: [], allowlistVersion: "reduced@1", fields: [], saved: true, aiUse: "consent", aiNotesUse: "consent", consentNotes: true, notesCount: 3, ...over });
const base = { ai: host, ids: ["h1"], on: true, onToggle: () => undefined, words: "", onWords: () => undefined, blocked: null, bulk: false };

describe("メモと面談の履歴の印", () => {
  it("渡せる世帯: 印・説明・伏せる言葉の欄（保存しない）・確かめのボタン", () => {
    const html = renderToString(h(NotesOptions, { ...base, count: 3 }));
    expect(html).toContain("メモと面談の履歴も渡す（メモと面談の記録 3件）");
    expect(html).toContain(NOTES_OPTION_TEXT);
    expect(html).toContain("伏せる言葉（お客さまの名字など。「、」で区切る）");
    expect(html).toContain(MASK_WORDS_NOTE);
    expect(html).toContain("保存しません");
    expect(html).toContain("AIに渡る文を確かめる");
    // 印を外していれば、伏せる言葉の欄は出さない
    expect(renderToString(h(NotesOptions, { ...base, on: false }))).not.toContain("data-ai-notes-words");
  });
  it("渡せない世帯: 印を押せず、理由の文を出す（前の版の同意・同意の記録なし・断った・撤回した）", () => {
    for (const k of ["consentWithoutNotes", "none", "refused", "withdrawn"]) {
      const html = renderToString(h(NotesOptions, { ...base, blocked: NOTES_BLOCKED_TEXT[k]! }));
      expect(html).toMatch(/<input type="checkbox" disabled[^>]*data-ai-notes-on/);
      expect(html).toContain(NOTES_BLOCKED_TEXT[k]!);
      expect(html).not.toContain("data-ai-notes-words");
    }
    expect(NOTES_BLOCKED_TEXT.consentWithoutNotes).toContain("前の版の説明");
  });
  it("伏せる言葉は「、」・読点・空白で区切る（重ねない・50語まで）", () => {
    expect(maskWords("田中、山田 , 田中\n佐藤")).toEqual(["田中", "山田", "佐藤"]);
    expect(maskWords("  ")).toEqual([]);
    expect(maskWords(Array.from({ length: 60 }, (_, i) => `w${i}`).join("、"))).toHaveLength(50);
  });
  it("確かめの画面: 伏せた所に印。名前らしい所が残っていそうな世帯は開いて先に（本体の並び）", () => {
    expect(renderToString(h(MaskedText, { text: "（名前）さんのご主人", spans: [[0, 4]] }))).toBe('<span class="ai-notes-text"><mark class="ai-masked" title="伏せた所">（名前）</mark>さんのご主人</span>');
    const list: AiNotesPreview[] = [
      { id: "a", customerNo: "A0002", texts: [{ item: "note.fp", author: "FP（メモ）", text: "ケンタが来年入学", spans: [] }], suspects: ["ケンタが来年"] },
      { id: "b", customerNo: "A0001", texts: [{ item: "meeting.fpOnly", author: "FP（面談の記録・FPだけの欄）", text: "面談の日: 2026-05-10\nFPのメモ: （名前）様は慎重", spans: [[23, 27]] }], suspects: [] },
    ];
    const html = renderToString(h(NotesPreviewList, { list, showNo: true }));
    expect(html.indexOf("A0002")).toBeLessThan(html.indexOf("A0001"));
    expect(html).toContain("名前らしい所が残っていそうです: ケンタが来年");
    expect(html).toContain("AIに渡る文です（伏せた所に印）");
    expect(html).toContain("FP（面談の記録・FPだけの欄）");
    expect(renderToString(h(NotesPreviewList, { list: [], showNo: false }))).toContain("メモと面談の記録はありません");
  });
});

describe("1件ずつ渡す画面と事務所の設定", () => {
  it("渡すときに印を出し、前の版の同意なら理由の文と、同意を記録し直す案内を出す", () => {
    const ok = renderToString(h(AiSharePanel, { ai: host, householdId: "h", customerNo: "A0001", status: status(), view: view(), onView: () => undefined, onOpenConnector: () => undefined, onClose: () => undefined }));
    expect(ok).toContain("data-ai-notes-on");
    expect(ok).not.toContain("data-ai-notes-blocked");
    const old = renderToString(h(AiSharePanel, { ai: host, householdId: "h", customerNo: "A0001", status: status(), view: view({ aiNotesUse: "consentWithoutNotes", consentNotes: false }), onView: () => undefined, onOpenConnector: () => undefined, onClose: () => undefined }));
    expect(old).toContain(NOTES_BLOCKED_TEXT.consentWithoutNotes!);
    expect(old).toContain("data-ai-consent-renew-notes");
    expect(old).toContain("今の説明で同意を記録し直す");
    // 古い本体（判定を返さない）には印を出さない
    const legacy = renderToString(h(AiSharePanel, { ai: host, householdId: "h", customerNo: "A0001", status: status(), view: view({ aiNotesUse: undefined }), onView: () => undefined, onOpenConnector: () => undefined, onClose: () => undefined }));
    expect(legacy).not.toContain("data-ai-notes-on");
  });
  it("事務所の設定: 「面談の記録やメモ」の確かめ（プライバシーポリシーの確かめの後）と、印を最初から付けておく", () => {
    const html = renderToString(h(AiConnectorPanel, { ai: host, status: status({ privacyPolicyConfirmedAt: "2026-11-20T00:00:00Z", notesByDefault: false }), onStatus: () => undefined, onChanged: () => undefined, onClose: () => undefined }));
    expect(html).toContain("面談の記録やメモを AI で扱うことも、事務所のプライバシーポリシーに書いている");
    expect(html).toContain("メモと面談の履歴を渡す印を、最初から付けておく");
    expect(html).toContain("既定はオフです。オンにしても、世帯ごとに渡すときに外せます。");
    expect(html).not.toContain("FPのメモは渡しません");
    // プライバシーポリシーを確かめる前は押せない
    const before = renderToString(h(AiConnectorPanel, { ai: host, status: status(), onStatus: () => undefined, onChanged: () => undefined, onClose: () => undefined }));
    expect(before).toMatch(/<input type="checkbox" disabled[^>]*data-ai-notes-policy/);
  });
  it("まとめて渡した後: メモと面談の履歴も渡した世帯と、渡さなかった世帯", () => {
    const o = { ready: [ { id: "a", customerNo: "A0001", basis: "consent" as const, alias: "共有中の世帯A", notes: "consent" as const, notesShared: true }, { id: "b", customerNo: "A0002", basis: "officePolicy" as const, alias: "共有中の世帯B", notes: "none" as const, notesShared: false } ], already: [], blocked: [], limit: 50, active: 0 };
    const html = renderToString(h(BulkOutcomeView, { o, done: true, notes: true }));
    expect(html).toContain("メモと面談の履歴も渡した世帯: 1件（A0001）");
    expect(html).toContain("メモと面談の履歴は渡さなかった世帯（同意が前の版・同意の記録が無いなど。計算に要る項目だけ渡します）: 1件（A0002）");
  });
});
