// メモと面談の履歴も AI に渡す（0249）: 印・渡せない理由の文・伏せる言葉（保存しない）・AI に渡す中身の確認画面の画面・事務所の設定
import { h } from "preact";
import { renderToString } from "preact-render-to-string";
import { describe, expect, it } from "vitest";
import type { AiHost, AiHouseholdView, AiNotesPreview, AiStatus } from "../src/engine/host.ts";
import { MASK_WORDS_NOTE, MaskedText, NOTES_LOOK_FIRST, NOTES_OPTION_TEXT, NotesOptions, NotesPreviewList } from "../src/workspace/ai/AiNotesOptions.tsx";
import { AiConnectorPanel } from "../src/workspace/ai/AiConnectorPanel.tsx";
import { AiRecords, AiSharePanel, CONSENT_BEFORE_NOTES_TEXT } from "../src/workspace/ai/AiSharePanel.tsx";
import { BulkOutcomeView } from "../src/workspace/ai/AiBulkShare.tsx";
import { aiMessage, maskWords, NOTES_BLOCKED_TEXT, NOTES_PAUSED_SHORT, NOTES_PAUSED_TEXT, notesRecordText } from "../src/workspace/ai/model.ts";
import { AiShareBand } from "../src/workspace/ai/AiShareBand.tsx";
import { PERSONAL_INFO_NOTE } from "../src/workspace/ai/personalNote.ts";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { APP_DIR } from "../scripts/lib.ts";

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
    expect(html).toContain("AI に渡す中身の確認画面を開く");
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
    // 前の版の同意は、事務所の設定では渡せない（取り直しだけを案内する）
    expect(NOTES_BLOCKED_TEXT.consentWithoutNotes).toContain("同意を記録し直してください");
    expect(NOTES_BLOCKED_TEXT.consentWithoutNotes).not.toContain("事務所の設定");
  });
  it("伏せる言葉は「、」・読点・空白で区切る（重ねない・50語まで）", () => {
    expect(maskWords("田中、山田 , 田中\n佐藤")).toEqual(["田中", "山田", "佐藤"]);
    expect(maskWords("  ")).toEqual([]);
    expect(maskWords(Array.from({ length: 60 }, (_, i) => `w${i}`).join("、"))).toHaveLength(50);
  });
  it("AI に渡す中身の確認画面: 伏せた所に印。名前らしい所が残っていそうな世帯は開いて先に（本体の並び）", () => {
    expect(renderToString(h(MaskedText, { text: "（名前）さんのご主人", spans: [[0, 4]] }))).toBe('<span class="ai-notes-text"><mark class="ai-masked" title="伏せた所">（名前）</mark>さんのご主人</span>');
    const list: AiNotesPreview[] = [
      { id: "a", customerNo: "A0002", texts: [{ item: "note.fp", author: "FP（メモ）", text: "ケンタが来年入学", spans: [] }], suspects: ["ケンタが来年"] },
      { id: "b", customerNo: "A0001", texts: [{ item: "meeting.fpOnly", author: "FP（面談の記録・FPだけの欄）", text: "面談の日: 2026-05-10\nFPのメモ: （名前）様は慎重", spans: [[23, 27]] }], suspects: [] },
    ];
    const html = renderToString(h(NotesPreviewList, { list, showNo: true }));
    expect(html.indexOf("A0002")).toBeLessThan(html.indexOf("A0001"));
    expect(html).toContain("名前らしい所が残っていそうです: ケンタが来年");
    expect(html).toContain("AI に渡す中身の確認画面です。伏せた所に印があります。");
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
    expect(html).not.toContain("お名前・ご住所・FPのメモは渡しません");
    expect(html).toContain("前の版の説明で同意した世帯は、説明で「FPのメモは渡しません」とお伝えしているので、今の説明で同意を記録し直すまで渡せません");
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

describe("名前・連絡先を書かない案内・確認画面を見てから渡す・同意の日付（0249 の追記）", () => {
  it("メモと面談の記録の欄の近くと AI に渡す中身の確認画面に、名前・電話番号・メールアドレス・住所を書かない注意を出す（0249 の 10）", () => {
    expect(PERSONAL_INFO_NOTE).toBe("お客さまの名前・電話番号・メールアドレス・住所（番地）は書かないでください。AI に渡すときに一部は自動で伏せますが、伏せきれないことがあります。");
    for (const f of ["src/workspace/MemoDrawer.tsx", "src/workspace/meetings/MeetingTools.tsx"]) {
      expect(readFileSync(join(APP_DIR, f), "utf8"), f).toContain("{PERSONAL_INFO_NOTE}");
    }
    const list: AiNotesPreview[] = [{ id: "a", customerNo: "A0001", texts: [{ item: "note.fp", author: "FP（メモ）", text: "頭金の相談", spans: [] }], suspects: [] }];
    expect(renderToString(h(NotesPreviewList, { list, showNo: false }))).toContain(PERSONAL_INFO_NOTE);
  });
  it("AI に渡す中身の確認画面を、いまの伏せる言葉で開くまでは、メモと面談の履歴を渡せない", () => {
    const html = renderToString(h(NotesOptions, { ...base, looked: false }));
    expect(html).toContain(NOTES_LOOK_FIRST);
    expect(renderToString(h(NotesOptions, { ...base, looked: true }))).not.toContain("data-ai-notes-look-first");
    // 1件ずつの画面: 印を付けたまま、確認画面を開いていなければ「この世帯をAIに渡す」を押せない
    const panel = renderToString(h(AiSharePanel, { ai: host, householdId: "h", customerNo: "A0001", status: status({ notesByDefault: true }), view: view(), onView: () => undefined, onOpenConnector: () => undefined, onClose: () => undefined }));
    expect(panel).toMatch(/<button type="submit" class="btn primary" disabled[ =>][^>]*data-ai-share-start/);
    expect(panel).toContain("data-ai-notes-look-first");
  });
  it("同意を得た日が今の説明を出した日より前なら、メモと面談の記録を含まない同意として記録すると出す", () => {
    expect(CONSENT_BEFORE_NOTES_TEXT).toContain("含まない同意として記録します");
  });
  it("共有中にメモ・面談の記録が変わって、メモと面談の履歴だけ止めたことを出す（1件ずつの画面・共有中の帯）", () => {
    const share = { shareId: "s", alias: "共有中の世帯A", householdId: "h", customerNumber: "A0001", expiresInSec: 600 };
    const panel = (notesPaused: boolean) => renderToString(h(AiSharePanel, { ai: host, householdId: "h", customerNo: "A0001", status: status(), view: view({ share: { ...share, notesPaused } }), onView: () => undefined, onOpenConnector: () => undefined, onClose: () => undefined }));
    expect(panel(true)).toContain(NOTES_PAUSED_TEXT);
    expect(panel(false)).not.toContain("data-ai-sharing-notes-paused");
    expect(NOTES_PAUSED_TEXT).toContain("AI に渡す中身の確認画面を開き直して");
    expect(NOTES_PAUSED_TEXT).toContain("世帯の数字などは、そのまま渡しています");
    const band = renderToString(h(AiShareBand, { shares: [{ ...share, notesPaused: true }, { ...share, shareId: "t" }], detailed: true, onStop: () => undefined, onOpen: () => undefined }));
    expect(band.match(/data-ai-band-notes-paused/g)).toHaveLength(1);
    expect(band).toContain(NOTES_PAUSED_SHORT);
    // 顧客と一緒に見ることのある画面の短い帯は件数だけ
    const brief = renderToString(h(AiShareBand, { shares: [{ ...share, notesPaused: true }], detailed: false, onStop: () => undefined, onOpen: () => undefined }));
    expect(brief).toContain(`${NOTES_PAUSED_SHORT}（1件）`);
    expect(brief).not.toContain("A0001");
  });
  it("AI に渡した記録に、メモと面談の履歴を止めたこと（いつ・何が変わったか）と渡し直したことを出す（0249 の 11）", () => {
    const rec = { id: "r", kind: "household", shareId: "s-1", grantedAt: "2026-11-24T00:00:00Z", expiresAt: "2026-11-24T01:00:00Z", endedAt: null, endReason: null, scope: "reduced", allowlistVersion: "reduced@1", fields: [], householdRevision: "1", destinationDeclared: "AIのアプリ", consentAtGrant: { state: "given", recordId: null, warned: false }, reads: [], proposals: [] };
    const paused = { ...rec, notesPaused: { at: "2026-11-24T00:30:00Z", changed: ["memo", "meetings"] as ("memo" | "meetings")[] } };
    expect(notesRecordText(paused)).toContain("共有中にメモと面談の記録が変わったため、メモと面談の履歴を AI に渡すのを止めました（世帯の数字などは渡したまま）");
    const again = { ...rec, id: "r2", shareId: "s-2", notesResharedAfter: "s-1" };
    expect(notesRecordText(again)).toBe("メモと面談の履歴を止めた後に、AI に渡す中身の確認画面で見直して、渡し直しました");
    expect(notesRecordText(rec)).toBeNull();
    const html = renderToString(h(AiRecords, { view: view({ records: [paused, again] }) }));
    expect(html.match(/data-ai-record-notes/g)).toHaveLength(2);
  });
  it("見本・記録を書けなかった・確認画面を見ていないときの文", () => {
    expect(aiMessage("E_AI_SAMPLE")).toBe("見本の世帯は AI に渡せません");
    expect(aiMessage("E_AI_NOTES_NOT_LOOKED")).toContain("AI に渡す中身の確認画面を開く");
    expect(aiMessage("E_AI_NOT_WRITTEN")).toContain("渡すのをやめました");
  });
});
