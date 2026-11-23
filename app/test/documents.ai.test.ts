// AI接続口の書類の候補の道具（propose_inputs。0151）:
// 道具の入力の形と読み口の上限・種類の一覧がそろっていること、接続口のテストと同じ見本が読み口を通ること、届いた候補が
// 読み取りの記録になるだけで現状を変えないこと、個人番号などの番号が残らないこと。
// AI の答えを貼り付ける入口は、利用者の判断（2026-11-20）でなくした（0151 の追記）。前に貼り付けで読んだ記録（via: "paste"）は、書類の読み取りの確認画面で今までどおり読めて承認できること
import { readdirSync, readFileSync } from "node:fs";
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
import { ingestAiProposals } from "../src/workspace/documents/ai.ts";
import { withDocumentLog, withReading } from "../src/workspace/documents/log.ts";
import { NEW_OBJECT_KINDS } from "../src/workspace/documents/objects.ts";
import { acceptCandidates, acceptObject } from "../src/workspace/documents/review.ts";
import { AiDocumentBand, DocumentEntry, DocumentReview } from "../src/workspace/documents/DocumentReview.tsx";
import { DOC_TYPES, LIMITS, PROPOSAL_CONTRACT } from "../src/workspace/documents/types.ts";
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
    expect(r.reading!.candidates).toHaveLength(9);
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
    const again = ingestAiProposals(wh, [proposal(), proposal({ candidateId: CID2, answer: { contract: PROPOSAL_CONTRACT, docType: "insurancePolicy", values: [{ item: "no.such.item", value: 1 }] } })], newId);
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

describe("SDK フォルダの説明書と手引き", () => {
  const sdk = (...p: string[]) => readFileSync(join(REPO_DIR, "sdk", ...p), "utf8").trim();
  it("手引きのある書類の種類は、読める書類の種類とスキルの表の種類とそろう（0159・0235）。外した書類の手引きは無い", () => {
    const skill = sdk("skills", "read-documents", "SKILL.md");
    for (const t of DOC_TYPES) expect(skill, t.value).toContain(`\`${t.value}\``);
    expect(readdirSync(join(REPO_DIR, "sdk", "skills", "read-documents", "guides")).sort()).toEqual(["insurance-policy.md", "property-tax-statement.md", "route-price-map.md"]);
  });

  it("説明書・スキルに、なくした貼り付けの入口が残っていない（2026-11-20）", () => {
    for (const f of [["docs", "document-reading.md"], ["skills", "read-documents", "SKILL.md"]]) {
      const md = sdk(...f);
      expect(md, f.join("/")).not.toContain("貼り付");
      expect(md, f.join("/")).not.toContain("ウェブのチャット");
    }
  });

  it("説明書の使い方の表に、AI接続口の道具の名前が書いてある", () => {
    expect(sdk("docs", "document-reading.md")).toContain("`propose_inputs`");
  });
});

describe("入口と帯", () => {
  it("入口は「AI で書類を読み取る」の1つ。貼り付けの入口は出ない（2026-11-20）", () => {
    const wh = open();
    for (const ai of [undefined, { connected: true, onOpen: () => undefined }]) {
      const html = renderToString(h(DocumentEntry, { wh, sample: true, ...(ai !== undefined ? { ai } : {}), onOpen: () => undefined, onSamples: () => undefined }));
      expect(html).toContain("AI で書類を読み取る");
      expect(html).not.toContain("貼り付け");
      expect(html).not.toContain("data-documents-paste");
      expect(html).not.toContain("data-imports-documents");
    }
  });

  it("AI から届いた未決の書類があれば帯を出し、書類の読み取りの確認画面で AI が読んだことを知らせる", () => {
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
    expect(review).toContain("AI が読んだ（接続した AI）");
  });

  it("前に貼り付けで読んだ記録（via: paste）は、世帯ファイルに書いて読み戻しても残り、書類の読み取りの確認画面に出て承認できる（入口をなくしても読めるまま）", () => {
    const wh0 = open();
    const pasted = readProposal(answer(), { via: "paste", at: AT, newId, connector: "ウェブの AI", members: members(wh0) }).reading!;
    const saved = JSON.stringify(bodyObject(body(withDocumentLog(wh0, withReading(wh0.documents, pasted)))));
    const back = fromBody(saved).wh;
    const r = back.documents!.readings.find((x) => x.id === pasted.id)!;
    expect(r.via).toBe("paste");
    expect(r.ai).toEqual({ connector: "ウェブの AI" });
    const review = renderToString(h(DocumentReview, { wh: back, calc: () => null, onChange: () => undefined, onClose: () => undefined, initial: pasted.id }));
    expect(review).toContain("AI が読んだ（貼り付け）");
    expect(review).toContain("AI が読んだ値です。値ごとに書類と比較してから承認してください");
    // 新しい物を足し、読めた値を承認すると、出どころ AI・確かさ「書類で確認」の値として現状に入る（貼り付けの記録も AI が読んだ記録と同じ扱い）
    let w = back;
    let rd = r;
    for (const o of rd.objects) {
      const res = acceptObject(w, rd, o.key, AT)!;
      w = res.wh;
      rd = res.reading;
    }
    const ids = rd.candidates.filter((c) => c.status === "pending" && c.unreadable !== true).map((c) => c.id);
    const done = acceptCandidates(w, rd, ids, {}, AT);
    expect(done.count).toBeGreaterThan(0);
    expect(done.reading.candidates.some((c) => c.status === "accepted")).toBe(true);
    expect(JSON.stringify(done.wh.request.input)).toContain('"certainty":"document"');
  });
});
