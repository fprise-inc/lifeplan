// AI接続口の書類の候補の道具（propose_inputs）と、ウェブのチャット AI の答えを貼り付ける入口（0151）:
// 道具の入力の形と読み口の上限・種類の一覧がそろっていること、接続口のテストと同じ見本が読み口を通ること、届いた候補・貼り付けた答えが
// 読み取りの記録になるだけで現状を変えないこと、個人番号などの番号が残らないこと、同意の無い世帯では貼り付けられないこと
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { h } from "preact";
import { renderToString } from "preact-render-to-string";
import { describe, expect, it } from "vitest";
import { REPO_DIR } from "../scripts/lib.ts";
import type { AiDocumentProposal } from "../src/engine/host.ts";
import { fromRequest, type WorkingHousehold } from "../src/workspace/input/household.ts";
import { roles } from "../src/workspace/roles.ts";
import { bodyObject, fromBody, type BodyState } from "../src/workspace/store/body.ts";
import { readProposal } from "../src/workspace/documents/proposal.ts";
import { ingestAiProposals, pasteGate, readPasted } from "../src/workspace/documents/ai.ts";
import { withDocumentLog, withReading } from "../src/workspace/documents/log.ts";
import { NEW_OBJECT_KINDS } from "../src/workspace/documents/objects.ts";
import { AiDocumentBand, DocumentEntry, DocumentReview } from "../src/workspace/documents/DocumentReview.tsx";
import { PASTE_WARNING, PasteAnswer } from "../src/workspace/documents/PasteAnswer.tsx";
import { DOC_TYPES, LIMITS, PROPOSAL_CONTRACT } from "../src/workspace/documents/types.ts";
import { GUIDE_DOC_TYPES, guideText } from "../src/workspace/documents/guides.ts";
import { DEFAULT_DISPLAY_SETTINGS } from "../src/workspace/settings.ts";
import { modelHousehold } from "./helpers.ts";

const FIXTURES = join(REPO_DIR, "crates", "lifeplan", "tests", "fixtures", "propose-inputs");
const answer = (): Record<string, unknown> => JSON.parse(readFileSync(join(FIXTURES, "answer.json"), "utf8")) as Record<string, unknown>;
type Schema = { $defs: Record<string, { properties: Record<string, Record<string, unknown>>; required?: string[] }>; properties: Record<string, Record<string, unknown>> };
const schema = JSON.parse(readFileSync(join(FIXTURES, "input-schema.json"), "utf8")) as Schema;
const def = (name: string) => schema.$defs[name]!.properties;

const AT = "2026-11-07T10:00:00+09:00";
let n = 0;
const newId = () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`;
const open = (id = "salariedCoupleTwoKids"): WorkingHousehold => fromRequest(modelHousehold(id));
const members = (wh: WorkingHousehold) => roles(wh.request).map((r) => ({ key: r.key, id: r.member.id }));
const CID = "3f2b8c1e-4d5a-4b6c-8d7e-9f0a1b2c3d4e";
const CID2 = "7a6b5c4d-3e2f-4a1b-9c8d-7e6f5a4b3c2d";
const proposal = (o: Partial<AiDocumentProposal> = {}): AiDocumentProposal => ({ candidateId: CID, shareId: "s-1", householdId: "h-1", receivedAt: AT, connector: "test-ai 1.2", answer: answer(), ...o });
const body = (wh: WorkingHousehold): BodyState => ({ wh, workspace: { template: null, band: [], base: "current", selected: "current", shownItems: [] }, display: { result: DEFAULT_DISPLAY_SETTINGS, balance: fromBody(JSON.stringify({ household: { request: wh.request } })).display.balance }, carry: { extDefinitions: {}, ext: {} } });

/** 12桁の数（区切りは1字まで）。乱数の ID（UUID）の中の数字は除いて確かめる */
const UUIDS = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gu;
const hasTwelve = (s: string): boolean => /\d(?:[\s\-./・]?\d){11}/u.test(s.replace(UUIDS, ""));

/** 個人番号・証券番号を、値・見出し・元の場所の文字・添え書き・照合の値に混ぜた答え */
const withNumbers = () => {
  const a = answer();
  (a.values as unknown[]).push(
    { item: "insurance.label", newObject: "c1", value: "1234 5678 9012", source: { where: "保険種類" }, confidence: "high" },
    { item: "insurance.label", newObject: "c1", value: "AB-0012345678", source: { where: "証券番号" }, confidence: "high" },
    { item: "insurance.contractDate", newObject: "c1", value: "2019-07", source: { where: "契約日", text: "契約日 2019年7月1日 個人番号 1234-5678-9012" }, confidence: "high", note: "個人番号 123456789012 は書いていません" },
  );
  (a.references as unknown[]).push({ label: "個人番号", amount: 123456789012 });
  return a;
};

describe("道具の入力の形（接続口）と読み口の上限・種類の一覧がそろっている", () => {
  it("答えの形の名前・候補の上限・文字の長さが同じ", () => {
    const a = def("DocumentAnswerArg");
    expect(a.contract!.const).toBe(PROPOSAL_CONTRACT);
    expect(a.values!.maxItems).toBe(LIMITS.candidates);
    expect(a.objects!.maxItems).toBe(LIMITS.objects);
    expect(a.references!.maxItems).toBe(LIMITS.references);
    expect(def("DocSourceArg").where!.maxLength).toBe(LIMITS.where);
    expect(def("DocSourceArg").text!.maxLength).toBe(LIMITS.sourceText);
    expect(def("DocValueArg").note!.maxLength).toBe(LIMITS.note);
    expect(def("DocReferenceArg").label!.maxLength).toBe(LIMITS.label);
    expect(schema.properties.answer).toBeDefined();
    expect(schema.properties.share_id).toBeDefined();
  });

  it("書類の種類の一覧が同じで、新しい物の種類はどれも道具の形に合う", () => {
    expect((def("DocumentAnswerArg").docType!.enum as string[]).filter((x) => x !== null)).toEqual(DOC_TYPES.map((d) => d.value));
    const kind = new RegExp(def("DocObjectArg").kind!.pattern as string, "u");
    expect(Object.keys(NEW_OBJECT_KINDS).length).toBeGreaterThan(0);
    for (const k of Object.keys(NEW_OBJECT_KINDS)) expect(kind.test(k), k).toBe(true);
  });

  it("接続口のテストで道具に通した見本の答えが、読み口を理由なしで通る", () => {
    const wh = open();
    const r = readProposal(answer(), { via: "ai", at: AT, newId, connector: "test-ai 1.2", members: members(wh) });
    expect(r.issues).toEqual([]);
    expect(r.reading).not.toBeNull();
    expect(r.reading!.candidates).toHaveLength(8);
    expect(r.reading!.objects).toHaveLength(1);
    expect(r.reading!.references).toHaveLength(1);
    expect(r.reading!.candidates.filter((c) => c.unreadable === true)).toHaveLength(1);
    expect(r.reading!.dropped).toBe(0);
    expect(r.reading!.holder).toBe(members(wh).find((m) => m.key === "self")!.id);
  });
});

describe("AI接続口から届いた候補を、読み取りの記録にする", () => {
  it("候補の ID を記録の ID にし、AI が読んだ記録として入る。現状の値は変わらない", () => {
    const wh = open();
    const res = ingestAiProposals(wh, [proposal()], newId);
    expect(res.added).toEqual([CID]);
    expect(res.taken).toEqual([CID]);
    expect(res.failed).toEqual([]);
    const r = res.log!.readings[0]!;
    expect(r.id).toBe(CID);
    expect(r.via).toBe("ai");
    expect(r.ai).toEqual({ connector: "test-ai 1.2" });
    expect(r.at).toBe(AT);
    expect(r.candidates.every((c) => c.status === "pending")).toBe(true);
    const next = withDocumentLog(wh, res.log);
    expect(next.request).toBe(wh.request);
  });

  it("同じ候補は2回足さない（外し損ねても読み直すだけ）。読めない答えは理由を残して外す", () => {
    const wh = withDocumentLog(open(), ingestAiProposals(open(), [proposal()], newId).log);
    const again = ingestAiProposals(wh, [proposal(), proposal({ candidateId: CID2, answer: { contract: PROPOSAL_CONTRACT, values: [{ item: "no.such.item", value: 1 }] } })], newId);
    expect(again.added).toEqual([]);
    expect(again.taken).toEqual([CID, CID2]);
    expect(again.failed).toHaveLength(1);
    expect(again.failed[0]!.issues).toContain("登録簿に無い入力項目の候補");
    expect(again.log!.readings).toHaveLength(1);
    // 形の違う候補の ID は使わない
    expect(ingestAiProposals(open(), [proposal({ candidateId: "x" })], newId).taken).toEqual([]);
  });

  it("個人番号・証券番号は、記録にも保存した本文にも残らない", () => {
    const wh = open();
    const res = ingestAiProposals(wh, [proposal({ answer: withNumbers() })], newId);
    const r = res.log!.readings[0]!;
    expect(r.dropped).toBeGreaterThanOrEqual(4);
    const saved = JSON.stringify(bodyObject(body(withDocumentLog(wh, res.log))));
    expect(hasTwelve(JSON.stringify(res.log))).toBe(false);
    expect(hasTwelve(saved)).toBe(false);
    expect(saved).not.toContain("AB-0012345678");
    expect(saved).not.toContain("0012345678");
  });
});

describe("貼り付けの入口", () => {
  it("同意のある世帯と見本の世帯だけで使える", () => {
    expect(pasteGate({ sample: true, saved: false, consentState: null })).toEqual({ ok: true, sample: true });
    expect(pasteGate({ sample: false, saved: true, consentState: "given" })).toEqual({ ok: true, sample: false });
    for (const consentState of [null, "none", "refused", "withdrawn"]) {
      const g = pasteGate({ sample: false, saved: true, consentState });
      expect(g.ok, String(consentState)).toBe(false);
    }
    expect(pasteGate({ sample: false, saved: false, consentState: "given" }).ok).toBe(false);
  });

  it("前後の文や ```json の囲みがあっても読み、貼り付けた AI の記録になる。番号は残らない", () => {
    const wh = open();
    const text = `読み取りました。\n\`\`\`json\n${JSON.stringify(withNumbers(), null, 2)}\n\`\`\`\n確かめてください。`;
    const r = readPasted(wh, text, "  ウェブの AI  ", AT, newId);
    expect(r.reading).not.toBeNull();
    expect(r.reading!.via).toBe("paste");
    expect(r.reading!.ai).toEqual({ connector: "ウェブの AI" });
    expect(hasTwelve(JSON.stringify(r.reading))).toBe(false);
    expect(JSON.stringify(r.reading)).not.toContain("AB-0012345678");
  });

  it("読めない答え・形の違う答えは、理由を出して取り込まない", () => {
    const wh = open();
    const cases: [string, string, string][] = [
      ["", "AI", "AI の答えを貼り付けてください"],
      [JSON.stringify(answer()), "", "使った AI の名前を入れてください（60文字まで）"],
      ["すみません、読めませんでした。", "AI", "答えの JSON が見つかりません"],
      ['{"contract": "document-candidates@1", "values": [', "AI", "答えの JSON を読めません（途中で切れていないか確かめてください）"],
      ['{"contract": "document-candidates@1", "values": [}', "AI", "答えの JSON を読めません（途中で切れていないか確かめてください）"],
      [JSON.stringify({ ...answer(), contract: "other@1" }), "AI", `答えの形の名前（contract）が「${PROPOSAL_CONTRACT}」ではありません`],
      [JSON.stringify({ contract: PROPOSAL_CONTRACT, values: [{ item: "no.such.item", value: 1 }] }), "AI", "読める候補がありませんでした"],
    ];
    for (const [text, connector, why] of cases) {
      const r = readPasted(wh, text, connector, AT, newId);
      expect(r.reading, why).toBeNull();
      expect(r.issues, why).toContain(why);
    }
  });

  it("画面: 注意を出し、同意の無い世帯では理由を出して止める。読む前に伏せたことの確かめを求める", () => {
    const wh = open();
    const blocked = renderToString(h(PasteAnswer, { wh, gate: pasteGate({ sample: false, saved: true, consentState: "none" }), onOpenConsent: () => undefined, onRead: () => undefined, onClose: () => undefined }));
    expect(PASTE_WARNING).toContain("書類の中身は AI の会社に渡ります。お名前などを伏せて渡してください");
    expect(blocked).toContain("書類の中身は AI の会社に渡ります");
    expect(blocked).toContain("data-documents-paste-blocked");
    expect(blocked).toContain("外部AIへの提供の同意が記録されていません");
    expect(blocked).toContain("data-documents-paste-consent");
    expect(blocked).not.toContain("data-documents-paste-text");
    const ok = renderToString(h(PasteAnswer, { wh, gate: { ok: true, sample: false }, onRead: () => undefined, onClose: () => undefined }));
    expect(ok).toContain("data-documents-paste-text");
    expect(ok).toContain("data-documents-paste-masked");
    expect(ok).toMatch(/data-documents-paste-read[^>]*disabled|disabled[^>]*data-documents-paste-read/u);
    expect(ok).not.toContain("data-documents-paste-guide");
    const withGuide = renderToString(h(PasteAnswer, { wh, gate: { ok: true, sample: true }, guide: { options: GUIDE_DOC_TYPES, text: guideText }, onRead: () => undefined, onClose: () => undefined }));
    expect(withGuide).toContain("data-documents-paste-guide");
    expect(withGuide).toContain("data-documents-paste-guide-type");
    expect(withGuide).toContain("ねんきん定期便");
  });
});

describe("貼り付けで写す読み方の手引き（SDK フォルダの説明書・手引き・欄の一覧）", () => {
  const sdk = (...p: string[]) => readFileSync(join(REPO_DIR, "sdk", ...p), "utf8").trim();
  it("書類の種類ごとに、説明書・その書類の手引き・欄の一覧をそのまま写す。世帯のデータは入らない", () => {
    const pension = guideText("pensionStatement");
    expect(pension).toContain(sdk("docs", "document-reading.md"));
    expect(pension).toContain(sdk("skills", "read-documents", "guides", "pension.md"));
    expect(pension).toContain(sdk("skills", "read-documents", "fields.md"));
    expect(pension).not.toContain(sdk("skills", "read-documents", "guides", "withholding-slip.md"));
    expect(guideText("earthquakeInsuranceDeduction")).toContain(sdk("skills", "read-documents", "guides", "insurance-deduction.md"));
    expect(guideText("housingLoanBalance")).toContain(sdk("skills", "read-documents", "guides", "housing-loan.md"));
    const other = guideText("other");
    expect(other).toContain('docType を "other"');
    expect(other).toContain(sdk("skills", "read-documents", "fields.md"));
    for (const t of GUIDE_DOC_TYPES) {
      expect(DOC_TYPES.some((d) => d.value === t.value)).toBe(true);
      expect(hasTwelve(guideText(t.value))).toBe(false);
    }
    // 手引きのある書類の種類は、スキルの表の種類とそろう（その他を除く）
    const skill = sdk("skills", "read-documents", "SKILL.md");
    for (const t of GUIDE_DOC_TYPES.filter((x) => x.value !== "other")) expect(skill, t.value).toContain(`\`${t.value}\``);
  });

  it("説明書の使い方の表に、AI接続口の道具の名前が書いてある", () => {
    expect(sdk("docs", "document-reading.md")).toContain("`propose_inputs`");
  });
});

describe("入口と帯", () => {
  it("「書類の読み取り」の1行に貼り付けの入口が出る", () => {
    const wh = open();
    expect(renderToString(h(DocumentEntry, { wh, sample: false, onOpen: () => undefined, onSamples: () => undefined, onPaste: () => undefined }))).toContain("AI の答えを貼り付ける");
    expect(renderToString(h(DocumentEntry, { wh, sample: false, onOpen: () => undefined, onSamples: () => undefined }))).not.toContain("data-documents-paste-open");
  });

  it("AI から届いた未決の書類があれば帯を出し、確かめの画面で AI が読んだことを知らせる", () => {
    const wh0 = open();
    expect(renderToString(h(AiDocumentBand, { wh: wh0, failed: { count: 0, issues: [] }, onOpen: () => undefined, onDismiss: () => undefined }))).toBe("");
    const wh = withDocumentLog(wh0, ingestAiProposals(wh0, [proposal()], newId).log);
    const band = renderToString(h(AiDocumentBand, { wh, failed: { count: 0, issues: [] }, onOpen: () => undefined, onDismiss: () => undefined }));
    expect(band).toContain("AI から書類の候補が届きました（1通");
    expect(band).toContain("data-documents-ai-band-open");
    const failed = renderToString(h(AiDocumentBand, { wh: wh0, failed: { count: 1, issues: ["登録簿に無い入力項目の候補"] }, onOpen: () => undefined, onDismiss: () => undefined }));
    expect(failed).toContain("登録簿に無い入力項目の候補");
    expect(failed).toContain("data-documents-ai-band-dismiss");
    const review = renderToString(h(DocumentReview, { wh, calc: () => null, onChange: () => undefined, onClose: () => undefined, initial: CID }));
    expect(review).toContain("AI が読んだ（AI接続口）");
    // 貼り付けた記録も同じ確かめの画面に出る
    const pasted = readPasted(wh0, JSON.stringify(answer()), "ウェブの AI", AT, newId).reading!;
    const wh2 = withDocumentLog(wh0, withReading(wh0.documents, pasted));
    expect(renderToString(h(DocumentReview, { wh: wh2, calc: () => null, onChange: () => undefined, onClose: () => undefined, initial: pasted.id }))).toContain("AI が読んだ（貼り付け）");
  });
});
