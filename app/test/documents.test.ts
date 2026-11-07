// 書類の読み取りの土台（0148）: 読み口（答えの形の確かめ・番号を落とす）・候補の当て先・承認（値の出どころ・確かさ・承認の記録）・
// 直す・入れない・新しい物・まとめての承認の決まり・読み取りの成績・世帯ファイルの区画 documents・確かめの画面
import { h } from "preact";
import { renderToString } from "preact-render-to-string";
import { describe, expect, it } from "vitest";
import { allFields, type FieldDef } from "../src/workspace/input/form.ts";
import { fromRequest, type WorkingHousehold } from "../src/workspace/input/household.ts";
import { buildStages } from "../src/workspace/input/stages/index.ts";
import { applyStateOp, availableOps, fieldStatus } from "../src/workspace/input/valueState.ts";
import { docRequests } from "../src/workspace/input/docRequests.ts";
import { roles } from "../src/workspace/roles.ts";
import { bodyObject, BODY_FORMAT_VERSION, fromBody, type BodyState } from "../src/workspace/store/body.ts";
import { readProposal, readProposalText, type ProposalContext } from "../src/workspace/documents/proposal.ts";
import { cleanText, hasPersonalNumber, isPersonalNumberValue } from "../src/workspace/documents/privacy.ts";
import { hasDocuments, keepDocuments, pendingTotal, readDocumentLog, removable, withDocumentLog, withoutReading, withReading } from "../src/workspace/documents/log.ts";
import { fieldPlaces, resolveTarget } from "../src/workspace/documents/resolve.ts";
import { certaintyOf, createObject } from "../src/workspace/documents/apply.ts";
import { acceptCandidates, acceptObject, correctCandidate, docReview, rejectCandidates, rejectObject, reopenCandidate, withHolder } from "../src/workspace/documents/review.ts";
import { readingScore, scoreTotals, SCORE_CONTRACT } from "../src/workspace/documents/score.ts";
import { SAMPLE_DOCUMENTS } from "../src/workspace/documents/samples.ts";
import { DocumentEntry, DocumentReview, withSamples } from "../src/workspace/documents/DocumentReview.tsx";
import { ReviewTable } from "../src/workspace/review/ReviewTable.tsx";
import { bulkEligible, type ReviewRow } from "../src/workspace/review/rows.ts";
import { PROPOSAL_CONTRACT, type DocumentReading } from "../src/workspace/documents/types.ts";
import { DEFAULT_DISPLAY_SETTINGS } from "../src/workspace/settings.ts";
import { modelHousehold, preview } from "./helpers.ts";

const AT = "2026-11-07T10:00:00+09:00";
let n = 0;
const newId = () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`;
const open = (id = "salariedCoupleTwoKids"): WorkingHousehold => fromRequest(modelHousehold(id));
const members = (wh: WorkingHousehold) => roles(wh.request).map((r) => ({ key: r.key, id: r.member.id }));
const ctx = (wh: WorkingHousehold, o: Partial<ProposalContext> = {}): ProposalContext => ({ via: "reader", at: AT, newId, reader: { id: "test.reader", version: 1 }, members: members(wh), ...o });
const selfId = (wh: WorkingHousehold) => roles(wh.request).find((r) => r.key === "self")!.member.id;
const fieldByKey = (wh: WorkingHousehold, key: string): FieldDef => {
  for (const st of buildStages(wh)) for (const f of allFields(st)) if (f.key === key) return f;
  throw new Error(`no field ${key}`);
};
const read = (wh: WorkingHousehold, raw: unknown, o: Partial<ProposalContext> = {}): DocumentReading => {
  const r = readProposal(raw, ctx(wh, o));
  if (r.reading === null) throw new Error(JSON.stringify(r.issues));
  return r.reading;
};
const proposal = (values: unknown[], extra: Record<string, unknown> = {}) => ({ contract: PROPOSAL_CONTRACT, docType: "residentTaxNotice", holder: "self", values, ...extra });
const residentTax = (value: unknown, o: Record<string, unknown> = {}) => ({ item: "residentTaxAssessment.amount", member: "holder", value, period: "annual", source: { page: 1, where: "特別徴収税額（年額）", text: "特別徴収税額 318,000円" }, confidence: "high", ...o });
const body = (wh: WorkingHousehold): BodyState => ({ wh, workspace: { template: null, band: [], base: "current", selected: "current", shownItems: [] }, display: { result: DEFAULT_DISPLAY_SETTINGS, balance: fromBody(JSON.stringify({ household: { request: wh.request } })).display.balance }, carry: { extDefinitions: {}, ext: {} } });

/** 12桁の数（区切りは1字まで）。乱数の ID（UUID）の中の数字は除いて確かめる */
const TWELVE_RE = /\d(?:[\s\-./・]?\d){11}/u;
const UUIDS = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gu;
const hasTwelve = (s: string): boolean => TWELVE_RE.test(s.replace(UUIDS, ""));

describe("読み口: 答えの形を確かめる", () => {
  it("形の名前が違う・JSON でない・候補が無い答えは読まない", () => {
    const wh = open();
    expect(readProposal({ docType: "residentTaxNotice", values: [] }, ctx(wh)).reading).toBeNull();
    expect(readProposal("x", ctx(wh)).reading).toBeNull();
    expect(readProposal(proposal([]), ctx(wh)).issues).toContain("読める候補がありませんでした");
  });

  it("登録簿に無い入力項目・場所の書き方の違う候補・作れない種類の物は読まずに理由を残す（値・文字は理由に入れない）", () => {
    const wh = open();
    const r = readProposal(
      proposal([residentTax(318000), { item: "no.such.item", value: 1 }, { item: "pensionRecord.amounts", at: ["<script>"], value: 1 }, { item: "insurance.label", newObject: "zz", value: "x" }], { objects: [{ key: "zz", kind: "ufo:spaceship" }] }),
      ctx(wh),
    );
    expect(r.reading?.candidates).toHaveLength(1);
    expect(r.issues).toEqual(expect.arrayContaining(["登録簿に無い入力項目の候補", "場所の書き方が違う候補", "作れない種類の新しい物の候補"]));
    expect(r.issues.join("")).not.toContain("<script>");
  });

  it("答えの holder（続柄）を名義の人の初めの値にし、続柄の鍵・holder は候補の人として持つ", () => {
    const wh = open();
    const r = read(wh, proposal([residentTax(318000)]));
    expect(r.holder).toBe(selfId(wh));
    expect(r.candidates[0]?.target).toEqual({ item: "residentTaxAssessment.amount", member: "holder" });
    expect(r).toMatchObject({ kind: "document", docType: "residentTaxNotice", via: "reader", reader: { id: "test.reader", version: 1 }, dropped: 0 });
  });

  it("貼り付けた文から答えの JSON を取り出す（前後の文・```json の囲みがあってもよい）。大きすぎる文は読まない", () => {
    const wh = open();
    const text = `読み取りました。\n\`\`\`json\n${JSON.stringify(proposal([residentTax(318000)]))}\n\`\`\`\nご確認ください。`;
    const r = readProposalText(text, ctx(wh, { via: "paste", connector: "テストの AI" }));
    expect(r.reading?.candidates).toHaveLength(1);
    expect(r.reading?.ai).toEqual({ connector: "テストの AI" });
    expect(readProposalText("x".repeat(200_001), ctx(wh)).reading).toBeNull();
    expect(readProposalText("{ 途中で", ctx(wh)).issues[0]).toContain("JSON");
  });

  it("候補の数の上限を超えた分は読まない", () => {
    const wh = open();
    const r = readProposal(proposal(Array.from({ length: 320 }, () => residentTax(318000))), ctx(wh));
    expect(r.reading?.candidates).toHaveLength(300);
    expect(r.issues.some((x) => x.includes("多すぎる"))).toBe(true);
  });
});

describe("個人番号などの番号は読まない・残さない", () => {
  const NUMBERS = ["123456789012", "1234 5678 9012", "1234-5678-9012", "１２３４５６７８９０１２", "1234.5678.9012", "1234/5678/9012"];

  it("12桁の数（区切り・全角も）を個人番号らしいとみなす。千億円以上の額も読み違いとして落とす", () => {
    for (const s of NUMBERS) {
      expect(hasPersonalNumber(`番号 ${s} です`)).toBe(true);
      expect(isPersonalNumberValue(s)).toBe(true);
    }
    expect(isPersonalNumberValue(123456789012)).toBe(true);
    expect(isPersonalNumberValue(5_800_000)).toBe(false);
    expect(hasPersonalNumber("支払金額 5,800,000")).toBe(false);
    expect(cleanText("個人番号 1234 5678 9012 給与 6,400,000", 80)).toEqual({ text: "個人番号 ●●●● 給与 6,400,000", masked: true });
    expect(cleanText("基礎年金番号:1234-567890", 80).text).not.toMatch(/\d{4}/u);
  });

  it("候補に入る前に落とす: 番号の値・番号の欄の候補は候補ごと、元の場所の文字・添え書き・照合の値の中の番号は消す。落とした数だけ残す", () => {
    const wh = open();
    const values = [
      residentTax(318000, { source: { where: "特別徴収税額", text: "特別徴収税額 318,000 個人番号 1234 5678 9012" }, note: "番号 123456789012 は読みません" }),
      ...NUMBERS.map((s) => residentTax(s)),
      residentTax(123456789012),
      residentTax(318000, { source: { where: "個人番号" } }),
      residentTax(318000, { source: { where: "基礎年金番号" } }),
      residentTax(318000, { source: { where: "証券番号" } }),
      { item: "insurance.label", member: "holder", value: "番号 1234-5678-9012 の契約" },
    ];
    const r = read(wh, proposal(values, { references: [{ label: "給与収入", amount: 6400000, source: { text: "6,400,000 マイナンバー 1234 5678 9012" } }, { label: "個人番号", amount: 1 }] }));
    expect(r.candidates).toHaveLength(1);
    expect(r.references).toHaveLength(1);
    expect(r.dropped).toBeGreaterThanOrEqual(NUMBERS.length + 6);
    const json = JSON.stringify(r);
    expect(hasTwelve(json)).toBe(false);
    for (const s of NUMBERS) expect(json).not.toContain(s);
    expect(r.candidates[0]?.source.text).toBe("特別徴収税額 318,000 個人番号 ●●●●");
  });

  it("世帯ファイルに書かれていた番号も、読むときに落とす・消す（候補ごと捨てる）", () => {
    const wh = open();
    const r = read(wh, proposal([residentTax(318000)]));
    const tampered = structuredClone(r) as unknown as { candidates: Record<string, unknown>[] };
    tampered.candidates.push({ ...tampered.candidates[0], id: newId(), value: "1234 5678 9012" });
    (tampered.candidates[0] as { source: { text: string } }).source.text = "個人番号 123456789012";
    const log = readDocumentLog({ version: 1, readings: [tampered] });
    expect(log.readings[0]?.candidates).toHaveLength(1);
    expect(hasTwelve(JSON.stringify(log))).toBe(false);
  });

  it("直す欄にも番号は入れられない", () => {
    const wh = open();
    const r = read(wh, proposal([residentTax(318000)]));
    const res = correctCandidate(wh, r, r.candidates[0]!.id, "1234 5678 9012", {}, AT);
    expect(res).toEqual({ error: "番号らしい値は入れられません" });
  });

  it("架空の見本も、読み口を通すと番号の候補が落ち、世帯ファイルに番号が残らない", () => {
    const wh = open();
    const { log } = withSamples(wh, AT, newId);
    expect(log?.readings).toHaveLength(SAMPLE_DOCUMENTS.length);
    expect(log!.readings.every((x) => x.via === "sample")).toBe(true);
    expect(log!.readings.reduce((s, x) => s + x.dropped, 0)).toBeGreaterThanOrEqual(3);
    const stored = JSON.stringify(bodyObject(body(withDocumentLog(wh, log))));
    expect(hasTwelve(stored)).toBe(false);
    expect(stored).not.toContain("0012345678");
  });
});

describe("候補の当て先", () => {
  it("人の候補は、その人の欄に当てる（今の働き方・住民税・年金の記録。年収は2つを合わせて見せる欄ではなく、当て先の値そのものの欄）", () => {
    const wh = open();
    const places = fieldPlaces(wh);
    const r = read(wh, proposal([residentTax(318000)]));
    const res = resolveTarget(wh, places, r, { item: "employment.salary.annual", member: "self" }, new Map());
    expect(res.kind).toBe("field");
    if (res.kind === "field") expect(res.place.label).toContain("賞与を除く");
    const tax = resolveTarget(wh, places, r, { item: "residentTaxAssessment.amount", member: "spouse" }, new Map());
    expect(tax.kind === "field" && tax.place.field.key.includes(roles(wh.request).find((x) => x.key === "spouse")!.member.id)).toBe(true);
    const months = resolveTarget(wh, places, r, { item: "pensionRecord.months", at: ["basic"], member: "self" }, new Map());
    expect(months.kind === "field" && months.place.label).toBe("ご本人の公的年金: 国民年金の加入月数");
    const asOf = resolveTarget(wh, places, r, { item: "pensionRecord.asOf", member: "self" }, new Map());
    expect(asOf.kind).toBe("field");
  });

  it("1つに決まらなければ FP が選ぶ。当てる欄・人・名義が無ければ理由を出す（黙って当てない）", () => {
    const wh = open();
    const places = fieldPlaces(wh);
    const r = read(wh, proposal([residentTax(318000)]));
    expect(resolveTarget(wh, places, r, { item: "pensionRecord.kind", member: "self" }, new Map()).kind).toBe("choose");
    expect(resolveTarget(wh, places, r, { item: "pensionRecord.amounts", at: ["basic"], member: "self" }, new Map())).toEqual({ kind: "missing", reason: "この世帯に、この値を入れる欄がありません" });
    expect(resolveTarget(open("single45"), fieldPlaces(open("single45")), r, { item: "residentTaxAssessment.amount", member: "spouse" }, new Map())).toMatchObject({ kind: "missing", reason: "当てる人がこの世帯にいません" });
    const noHolder = withHolder(wh, r, null);
    expect(resolveTarget(wh, places, noHolder, { item: "residentTaxAssessment.amount", member: "holder" }, new Map())).toMatchObject({ kind: "missing", reason: expect.stringContaining("書類の名義") });
    const view = docReview(wh, noHolder);
    expect(view.needsHolder).toBe(true);
    expect(view.bulk).toEqual([]);
  });
});

describe("承認・直す・入れない", () => {
  it("承認: 状態 確定・出どころ 取り込み（読み取りの記録の ID）・承認の記録（FP・日時・候補）・確かさ 書類で確認。計算できる", () => {
    const wh = open();
    const r = read(wh, proposal([residentTax(318000)]));
    const c = r.candidates[0]!;
    const res = acceptCandidates(wh, r, [c.id], {}, AT);
    expect(res.count).toBe(1);
    const f = fieldByKey(res.wh, `work/${selfId(wh)}/residentTax`);
    expect(f.get(res.wh).value).toBe(318000);
    expect(f.boxed!.read(res.wh)).toEqual({ value: 318000, state: "confirmed", origin: { kind: "import", ref: r.id }, approval: { by: "fp", at: AT, candidate: c.id }, certainty: "document" });
    expect(res.reading.candidates[0]).toMatchObject({ status: "accepted", decided: { at: AT } });
    expect(() => preview(res.wh.request)).not.toThrow();
    // 元の世帯は変えない
    expect(fieldByKey(wh, `work/${selfId(wh)}/residentTax`).get(wh).value).not.toBe(318000);
  });

  it("書類待ちの欄は承認で確定になり、書類のお願いの一覧から消える", () => {
    let wh = open();
    const f = fieldByKey(wh, `work/${selfId(wh)}/residentTax`);
    expect(availableOps(f, wh)).toContain("unknown");
    wh = applyStateOp(wh, f, "unknown");
    expect(fieldStatus(f, wh).status).toBe("unknown");
    expect(docRequests(wh).some((d) => d.title === "住民税の決定通知書（ご本人）")).toBe(true);
    const r = read(wh, proposal([residentTax(318000)]));
    expect(docReview(wh, r).groups[0]?.rows[0]).toMatchObject({ compare: "fill", current: { status: "書類待ち" } });
    const res = acceptCandidates(wh, r, [r.candidates[0]!.id], {}, AT);
    expect(fieldStatus(f, res.wh).status).toBe("confirmed");
    expect(docRequests(res.wh).some((d) => d.title === "住民税の決定通知書（ご本人）")).toBe(false);
  });

  it("今の確定の値と同じなら、値と出どころはそのままで、確かさだけを書類で確認にする", () => {
    const wh0 = open();
    const f = fieldByKey(wh0, `work/${selfId(wh0)}/residentTax`);
    const wh = f.set(wh0, 318000);
    expect(fieldStatus(f, wh).status).toBe("confirmed");
    const r = read(wh, proposal([residentTax(318000)]));
    expect(docReview(wh, r).groups[0]?.rows[0]?.compare).toBe("same");
    const res = acceptCandidates(wh, r, [r.candidates[0]!.id], {}, AT);
    expect(f.boxed!.read(res.wh)).toEqual({ value: 318000, state: "confirmed", origin: { kind: "manual" }, certainty: "document" });
  });

  it("AI の答えなら出どころは AI（名乗りつき）。値の箱でない欄は値の状態の行に印を付ける", () => {
    const wh = open();
    const r = read(wh, proposal([{ item: "pensionRecord.months", at: ["basic"], member: "self", value: 300, source: { where: "国民年金の加入月数" }, confidence: "high" }]), { via: "ai", connector: "テストの AI" });
    const res = acceptCandidates(wh, r, [r.candidates[0]!.id], {}, AT);
    expect(res.count).toBe(1);
    const rec = (res.wh.request.input.household.pensionRecords ?? []).find((x) => x.member === selfId(wh))! as unknown as { months: { basic: number }; valueStates: Record<string, unknown> };
    expect(rec.months.basic).toBe(300);
    expect(rec.valueStates["pensionRecord.months/basic"]).toEqual({ state: "confirmed", origin: { kind: "ai", ref: r.id, connector: "テストの AI" }, approval: { by: "fp", at: AT, candidate: r.candidates[0]!.id }, certainty: "document" });
    expect(() => preview(res.wh.request)).not.toThrow();
  });

  it("直す: 直した値を出どころ「手で入れた」（ref は記録）・確かさ「書類で確認」で入れ、直した値を記録に残す。成績は「直した」", () => {
    const wh = open();
    const r = read(wh, proposal([residentTax(318000)]));
    const res = correctCandidate(wh, r, r.candidates[0]!.id, "32.4万", {}, AT);
    if ("error" in res) throw new Error(res.error);
    const f = fieldByKey(res.wh, `work/${selfId(wh)}/residentTax`);
    expect(f.boxed!.read(res.wh)).toEqual({ value: 324000, state: "confirmed", origin: { kind: "manual", ref: r.id }, certainty: "document" });
    expect(res.reading.candidates[0]).toMatchObject({ status: "corrected", decided: { value: 324000 } });
    expect(scoreTotals(readingScore(res.reading))).toEqual({ matched: 0, corrected: 1, unreadable: 0 });
    expect(correctCandidate(wh, r, r.candidates[0]!.id, "abc", {}, AT)).toMatchObject({ error: expect.any(String) });
  });

  it("入れない: 世帯は変えず記録に残す。未決に戻せる。読み取りの記録は、現状に入れた候補が無いときだけ捨てられる", () => {
    const wh = open();
    const r = read(wh, proposal([residentTax(318000), residentTax(1000, { member: "spouse" })]));
    const rej = rejectCandidates(r, [r.candidates[0]!.id], AT);
    expect(rej.candidates[0]).toMatchObject({ status: "rejected", decided: { at: AT } });
    expect(reopenCandidate(rej, r.candidates[0]!.id).candidates[0]?.status).toBe("pending");
    expect(removable(rej)).toBe(true);
    const log = withReading(undefined, rej);
    expect(withoutReading(log, rej.id)).toBeUndefined();
    const acc = acceptCandidates(wh, rej, [r.candidates[1]!.id], {}, AT).reading;
    expect(removable(acc)).toBe(false);
    expect(withoutReading(withReading(undefined, acc), acc.id)?.readings).toHaveLength(1);
  });

  it("期間の違う額・読めなかった値・選択肢に無い値は承認できない（読めなかった値は直して入れられる）", () => {
    const wh = open();
    const r = read(wh, proposal([residentTax(26500, { period: "monthly" }), residentTax(null, { member: "spouse", unreadable: true })]));
    const rows = docReview(wh, r).groups.flatMap((g) => g.rows);
    expect(rows[0]?.problem).toContain("書類の額は月額、欄は年額です");
    expect(rows[1]).toMatchObject({ problem: expect.stringContaining("読めませんでした"), correctable: true, incoming: { unreadable: true } });
    expect(acceptCandidates(wh, r, r.candidates.map((c) => c.id), {}, AT).count).toBe(0);
    const fixed = correctCandidate(wh, r, r.candidates[1]!.id, "21万", {}, AT);
    expect("error" in fixed).toBe(false);
    if (!("error" in fixed)) expect(scoreTotals(readingScore(fixed.reading))).toEqual({ matched: 0, corrected: 0, unreadable: 1 });
  });
});

describe("新しい物（控除証明書の保険の契約など）", () => {
  const lifeRaw = () => SAMPLE_DOCUMENTS.find((s) => s.id === "lifeInsurance")!.raw;

  it("足すまでは承認できず、足した形（その種類の既定）を写しで見せる。足すと「＋」と同じ既定で契約ができ、値を当てられる", () => {
    const wh = open();
    const r = read(wh, lifeRaw(), { via: "sample", reader: { id: "sample.lifeInsurance", version: 1 } });
    expect(r.objects).toEqual([expect.objectContaining({ key: "c1", kind: "insurance:medical", status: "pending" })]);
    const v0 = docReview(wh, r);
    const g = v0.groups.find((x) => x.object !== null)!;
    expect(g.object?.label).toBe("新しい保険契約（医療保険）: 架空のあおば生命 医療保険");
    expect(g.rows.every((x) => x.problem === "先に「足す」を選んでください")).toBe(true);
    expect(g.rows.map((x) => x.incoming.text)).toEqual(["架空のあおば生命 医療保険", "ご本人", "2018年4月", "3,240円", "介護医療保険料"]);
    expect(v0.bulk).toEqual([]);
    expect(wh.request.input.household.insuranceContracts).toHaveLength(1);
    const added = acceptObject(wh, r, "c1", AT)!;
    expect(added.wh.request.input.household.insuranceContracts).toHaveLength(2);
    const v1 = docReview(added.wh, added.reading);
    // 確からしさが中の被保険者の行は、まとめての承認に入れない
    expect(v1.bulk).toHaveLength(4);
    const res = acceptCandidates(added.wh, added.reading, v1.bulk, {}, AT);
    expect(res.count).toBe(4);
    const c = res.wh.request.input.household.insuranceContracts!.find((x) => x.id === added.reading.objects[0]!.created)!;
    expect(c).toMatchObject({ label: "架空のあおば生命 医療保険", contractDate: "2018-04", premium: { amount: 3240 }, deductionCategory: { type: "careMedical" } });
    expect(() => preview(res.wh.request)).not.toThrow();
  });

  it("足さないにすると、その中の値の候補も入れないにする", () => {
    const wh = open();
    const r = rejectObject(read(wh, lifeRaw()), "c1", AT);
    expect(r.objects[0]?.status).toBe("rejected");
    expect(r.candidates.every((c) => c.status === "rejected")).toBe(true);
  });

  it("同じ種類・同じ人の契約がもうあれば知らせる（まとめない）", () => {
    const wh = open();
    const made = createObject(wh, "insurance:medical")!;
    const r = read(made.wh, lifeRaw());
    expect(docReview(made.wh, r).notices.some((x) => x.includes("同じ契約が、もうあるかもしれません"))).toBe(true);
    expect(docReview(wh, r).notices.some((x) => x.includes("同じ契約"))).toBe(false);
  });
});

describe("まとめての承認の決まり（共通の部品）", () => {
  const row = (o: Partial<ReviewRow>): ReviewRow => ({
    id: "r",
    group: "g",
    label: "l",
    current: { text: null, status: null },
    incoming: { text: "1", unreadable: false },
    compare: "fill",
    source: { where: null, text: null },
    confidence: "high",
    status: "pending",
    problem: null,
    correctable: true,
    structural: false,
    edit: null,
    ...o,
  });

  it("確からしさが高く、今の値が空・推定・書類待ちか同じ値の行だけ。違う値・中と低・種類を決める行・理由のある行・欄を選んでいない行は1つずつ", () => {
    expect(bulkEligible(row({}))).toBe(true);
    expect(bulkEligible(row({ compare: "same" }))).toBe(true);
    expect(bulkEligible(row({ compare: "conflict" }))).toBe(false);
    expect(bulkEligible(row({ confidence: "medium" }))).toBe(false);
    expect(bulkEligible(row({ structural: true }))).toBe(false);
    expect(bulkEligible(row({ problem: "x" }))).toBe(false);
    expect(bulkEligible(row({ choices: [{ id: "a", label: "a" }], chosen: null }))).toBe(false);
    expect(bulkEligible(row({ status: "accepted" }))).toBe(false);
    expect(bulkEligible(row({ incoming: { text: null, unreadable: true } }))).toBe(false);
  });

  it("今の確定の値と違う候補は、今の値と並べて「違う」を出し、まとめての承認に入れない", () => {
    const wh = open();
    const r = read(wh, SAMPLE_DOCUMENTS.find((s) => s.id === "withholding")!.raw);
    const rows = docReview(wh, r).groups.flatMap((g) => g.rows);
    expect(rows[0]).toMatchObject({ compare: "conflict", current: { text: "年6,200,000円" }, incoming: { text: "年5,200,000円" } });
    expect(docReview(wh, r).bulk).toEqual([]);
  });

  it("種類を決める欄（年金の記録の型など）は1つずつ。当てる欄を選ぶと承認できる", () => {
    const wh = open();
    const r = read(wh, proposal([{ item: "pensionRecord.kind", member: "self", value: "statementUnder50", source: { where: "見出し" }, confidence: "high" }], { docType: "pensionStatement" }));
    const v0 = docReview(wh, r).groups[0]!.rows[0]!;
    expect(v0.problem).toBe("当てる欄を選んでください");
    const kind = v0.choices!.find((c) => c.label.endsWith("書類の種類"))!;
    const v1 = docReview(wh, r, { [r.candidates[0]!.id]: kind.id }).groups[0]!.rows[0]!;
    expect(v1).toMatchObject({ structural: true, problem: null });
    expect(bulkEligible(v1)).toBe(false);
  });
});

describe("読み取りの成績（数だけ）", () => {
  it("書類の種類・読み手と版・欄ごとの合った・直した・読めなかったの数だけで、値・文字・ID・日時を入れない", () => {
    const wh = open();
    let r = read(wh, proposal([residentTax(318000), residentTax(250000, { member: "spouse" }), { item: "pensionRecord.months", at: ["basic"], member: "self", value: null, unreadable: true }]));
    r = acceptCandidates(wh, r, [r.candidates[0]!.id], {}, AT).reading;
    const c = correctCandidate(wh, r, r.candidates[1]!.id, "26万", {}, AT);
    if ("error" in c) throw new Error(c.error);
    const s = readingScore(c.reading);
    expect(s).toEqual({
      contract: SCORE_CONTRACT,
      docType: "residentTaxNotice",
      via: "reader",
      reader: { id: "test.reader", version: 1 },
      fields: [
        { item: "pensionRecord.months", at: "basic", matched: 0, corrected: 0, unreadable: 1 },
        { item: "residentTaxAssessment.amount", matched: 1, corrected: 1, unreadable: 0 },
      ],
    });
    const json = JSON.stringify(s);
    for (const x of ["318000", "260000", "250000", r.id, AT, "特別徴収"]) expect(json).not.toContain(x);
  });
});

describe("世帯ファイルの区画 documents（形式 0.68）", () => {
  it("区画に置いて読み戻す。household の区画には入れない。読んでいない世帯は区画を作らない", () => {
    expect(BODY_FORMAT_VERSION).toBe("0.68");
    const wh = open();
    expect(bodyObject(body(wh)).documents).toBeUndefined();
    const r = read(wh, proposal([residentTax(318000)]));
    const acc = acceptCandidates(wh, r, [r.candidates[0]!.id], {}, AT);
    const w = withDocumentLog(acc.wh, withReading(undefined, acc.reading));
    const stored = bodyObject(body(w));
    expect(stored.documents?.readings).toHaveLength(1);
    expect((stored.household as Record<string, unknown>).documents).toBeUndefined();
    const back = fromBody(JSON.stringify(stored));
    expect(back.wh.documents).toEqual(w.documents);
    expect(hasDocuments(back.wh.documents)).toBe(true);
    // 承認の記録は候補を指している
    const f = fieldByKey(back.wh, `work/${selfId(wh)}/residentTax`);
    expect((f.boxed!.read(back.wh) as { approval: { candidate: string } }).approval.candidate).toBe(back.wh.documents!.readings[0]!.candidates[0]!.id);
    expect(certaintyOf(back.wh, f)).toBe("document");
  });

  it("形の合わない記録・候補は捨て、知らない欄（ファイル名など）は持たない", () => {
    const wh = open();
    const r = read(wh, proposal([residentTax(318000)]));
    const raw = { version: 1, readings: [{ ...r, fileName: "源泉徴収票.pdf", candidates: [...r.candidates, { id: "x" }] }, { kind: "document" }] };
    const log = readDocumentLog(raw);
    expect(log.readings).toHaveLength(1);
    expect(JSON.stringify(log)).not.toContain("源泉徴収票.pdf");
    expect(log.readings[0]?.candidates).toHaveLength(1);
  });

  it("元に戻す・やり直すでは記録を持ち越す（明細の取り込みの記録と同じ）。未決の数を数える", () => {
    const wh = open();
    const r = read(wh, proposal([residentTax(318000), residentTax(250000, { member: "spouse" })]));
    const cur = withDocumentLog(wh, withReading(undefined, r));
    expect(pendingTotal(cur)).toBe(2);
    expect(keepDocuments(wh, cur).documents).toBe(cur.documents);
    expect(keepDocuments(cur, wh).documents).toBeUndefined();
  });
});

describe("確かめの画面", () => {
  it("1通の画面: 書類の種類・どこから・名義・知らせ（番号を消した数・見本）・読んだ所・行・照合だけの値・まとめて承認・成績", () => {
    const wh = open();
    const { log } = withSamples(wh, AT, newId);
    const w = withDocumentLog(wh, log);
    const first = log!.readings[0]!;
    const html = renderToString(h(DocumentReview, { wh: w, calc: () => 150000, onChange: () => undefined, onClose: () => undefined, initial: first.id }));
    expect(html).toContain("書類の読み取りの確かめ");
    expect(html).toContain("住民税の決定通知書");
    expect(html).toContain("架空の見本");
    expect(html).toContain("個人番号などの番号らしい所を");
    expect(html).toContain("書類から読んだ所");
    expect(html).toContain('data-review-compare="conflict"');
    expect(html).toContain("照合だけの値");
    expect(html).toContain("まとめて承認（0件）");
    expect(html).toContain("読み取りの成績: 合った 0・直した 0・読めなかった 0");
    expect(hasTwelve(html)).toBe(false);
    // 3通の書類を切り替えられる
    expect((html.match(/data-documents-reading=/gu) ?? []).length).toBe(3);
  });

  it("照合だけの値は、行・年があれば計算の額と差を並べる", () => {
    const wh = open();
    const r = read(wh, proposal([residentTax(318000)], { references: [{ label: "源泉徴収税額", amount: 152300, row: "cf.taxSi.incomeTax", year: 2026 }] }));
    const v = docReview(wh, r, {}, (row, year, member) => (row === "cf.taxSi.incomeTax" && year === 2026 && member === selfId(wh) ? 160000 : null));
    expect(v.references[0]).toMatchObject({ label: "源泉徴収税額", amount: 152300, calc: 160000 });
  });

  it("入口: 読んだ書類があれば確かめを開くボタン、見本の世帯でだけ架空の見本のボタン", () => {
    const wh = open();
    expect(renderToString(h(DocumentEntry, { wh, sample: false, onOpen: () => undefined, onSamples: () => undefined }))).not.toContain("data-documents-samples");
    expect(renderToString(h(DocumentEntry, { wh, sample: true, onOpen: () => undefined, onSamples: () => undefined }))).toContain("架空の書類の見本で試す");
    const w = withDocumentLog(wh, withSamples(wh, AT, newId).log);
    expect(renderToString(h(DocumentEntry, { wh: w, sample: false, onOpen: () => undefined, onSamples: () => undefined }))).toMatch(/読んだ書類を確かめる（未決 \d+件）/u);
  });

  it("共通の部品は、移行の画面の列（見出し・読んだ値・対応先・どこから決まったか）でも描ける。読んだ文字は文字のまま出す", () => {
    const rows: ReviewRow[] = [
      { id: "a", group: "家族", label: "<b>年齢</b>", current: { text: "45歳", status: "確定" }, incoming: { text: "46", unreadable: false }, compare: "conflict", source: { where: "1ページ", text: "<img src=x>" }, confidence: null, decidedBy: "規則", status: "pending", problem: null, correctable: false, structural: false, edit: null },
    ];
    const html = renderToString(h(ReviewTable, { rows, labels: { item: "見出し", current: "対応先の今の値", incoming: "読んだ値", source: "帳票の場所" }, decidedBy: true, selected: null, onSelect: () => undefined, onAccept: () => undefined, onCorrect: () => null, onReject: () => undefined }));
    expect(html).toContain("どこから決まったか");
    expect(html).toContain("規則");
    expect(html).toContain("&lt;b>年齢&lt;/b>");
    expect(html).not.toContain("<img");
  });
});
