// AI 接続口から Web のヒアリングを使う（0222）: 選び方の一覧と確かめ（aiSelection.ts。接続口の同梱の JS と同じ関数）・画面の発行（aiHearing.ts の
// runIssueJob）・世帯ファイルにまだ入っていない依頼（事務所データ）・事務所のひな形の案・画面の帯と一覧・「事前ヒアリングを取り込む」の入口（追記 2026-11-20）
import { h, options as preactOptions, type VNode } from "preact";
import { renderToString } from "preact-render-to-string";
import { describe, expect, it } from "vitest";
import { handleApi } from "../../hearing/relay/handler.ts";
import { memoryStore } from "../../hearing/relay/store.ts";
import { answersOf, draftKey, initialDraft, openRequest, submitAnswers, type Draft, type RelayTransport } from "../../hearing/src/web/index.ts";
import { estimate } from "../../hearing/src/web/flow.ts";
import { checkSelection, packetBody, type WebSelection } from "../../hearing/src/web/packet.ts";
import { API_PREFIX } from "../../hearing/src/web/protocol.ts";
import { hearingCheck, hearingOptions } from "../src/connector/hearing.ts";
import { AiHearingBand, AiHearingEntry, AiHearingPanel, staleArrival } from "../src/workspace/ai/AiHearingIssued.tsx";
import { HearingTools } from "../src/workspace/hearing/HearingTools.tsx";
import type { HearingWebHost, SheetHost } from "../src/engine/host.ts";
import { arrivedNow, assignTo, EMPTY_OFFICE_HEARING, issuedCount, markSeen, unassignedArrived, moveInto, pendingFor, pruned, readOfficeHearing, readTemplateProposal, relayMessage, runIssueJob, scrubSelection, UNASSIGNED_LIMIT, unassignedAccepting, unseenCount, withIssued, withPending, type IssueJob, type OfficeHearing } from "../src/workspace/hearing/aiHearing.ts";
import { aiSelection, hearingOptions as options, type AiSelectionArgs, type AiSelectionContext } from "../src/workspace/hearing/aiSelection.ts";
import { checkAnswered, enteredKeys, estimateOf, filledCount, noteArrival, prefillOf, receiveWeb, selectedCount, sheetOf, statusOf, templateSelection, webLog, withWebEntry, type WebLogEntry } from "../src/workspace/hearing/web.ts";
import { baseSheet } from "../src/workspace/hearing/selection.ts";
import { WebRequests } from "../src/workspace/hearing/WebRequests.tsx";
import { HearingTemplateProposals } from "../src/workspace/office/HearingTemplateProposals.tsx";
import { bodyOf, fromBody } from "../src/workspace/store/body.ts";
import { blankHousehold, fromRequest, type WorkingHousehold } from "../src/workspace/input/household.ts";
import { withRefreshedEstimates } from "../src/workspace/input/estimates.ts";
import { modelHousehold } from "./helpers.ts";

const NOW = new Date("2026-11-17T09:00:00Z");
const NONE: AiSelectionContext = { filled: null, officeTemplates: null };

function relayFor(clock: { t: Date } = { t: NOW }) {
  const store = memoryStore();
  const t: RelayTransport = async (r) => {
    const headers: Record<string, string> = {};
    if (r.token !== undefined) headers.authorization = `Bearer ${r.token}`;
    const res = await handleApi(new Request(`https://relay.test${API_PREFIX}${r.path}`, { method: r.method, headers, ...(r.body !== undefined ? { body: r.body } : {}) }), { store, now: () => clock.t });
    return { status: res.status, body: await res.text() };
  };
  return { store, t, clock };
}

const config = async () => ({ pageUrl: "https://relay.test/h/", dev: true });
const job = (selection: unknown, o: Partial<IssueJob> = {}): IssueJob => ({ jobId: "j1", issue: { selection }, householdId: null, customerNumber: null, body: null, connector: "test-ai 1.0", receivedAt: NOW.toISOString(), ...o });
const sel = (a: AiSelectionArgs, ctx = NONE): WebSelection => {
  const r = aiSelection(a, ctx);
  if (r.selection === null) throw new Error(r.problems.join("\n"));
  return r.selection;
};
/** 値の入ったモデル世帯（見直し・足りない所だけに使う） */
const filledHousehold = (): WorkingHousehold => fromRequest(modelHousehold("salariedCoupleTwoKids"), {});

describe("選び方の一覧（get_hearing_options。FP の画面と同じ関数）", () => {
  it("票ごとの分野・項目（範囲の項目は並べず、金額の項目の range）・ひな形の数・書類・独自の質問の上限・数え方。ご相談したいことは選べず、これからの予定はひな形の既定で外す", () => {
    const o = options({}) as { sheets: { sheet: string; sections: { id: string; offInTemplate?: boolean; items: { key: string; range?: boolean; repeat?: string }[] }[] }[]; templates: { id: string; selectedCount?: number; screens?: number; minutes?: number; needsShare: boolean }[]; documents: { kind: string; owner: string }[]; custom: { max: number }; counting: string };
    expect(o.sheets.map((s) => s.sheet)).toEqual(["simple", "detail"]);
    const simple = o.sheets[0]!;
    const keys = simple.sections.flatMap((s) => s.items.map((i) => i.key));
    expect(keys).toContain("hs.income.annual");
    expect(keys).not.toContain("hs.income.annualRange");
    expect(keys).not.toContain("hs.meta.filledOn");
    expect(simple.sections.flatMap((s) => s.items).find((i) => i.key === "hs.income.annual")?.range).toBe(true);
    expect(simple.sections.find((s) => s.id === "parents")?.offInTemplate).toBe(true);
    expect(simple.sections.flatMap((s) => s.items).find((i) => i.key === "hs.family.child.birthYearMonth")?.repeat).toBe("child");
    // ひな形の数は FP の画面と同じ数え方（聞く項目の数・お客さまの最初の画面と同じ画面の数）
    const t = o.templates.find((x) => x.id === "simple")!;
    const fp = templateSelection("simple", withRefreshedEstimates(blankHousehold("2026-11")));
    expect(t.selectedCount).toBe(selectedCount(fp));
    expect(t.screens).toBe(estimateOf(null, fp)?.std.screens);
    expect(o.templates.find((x) => x.id === "review")).toMatchObject({ needsShare: true });
    expect(o.templates.find((x) => x.id === "review")?.selectedCount).toBeUndefined();
    expect(o.documents.find((d) => d.kind === "withholding")?.owner).toBe("required");
    expect(o.documents.find((d) => d.kind === "loanSchedule")?.owner).toBe("none");
    expect(keys).not.toContain("hs.consult.topics");
    expect(simple.sections.flatMap((s) => s.items).find((i) => i.key === "hs.plan.events")).toMatchObject({ offInTemplate: true });
    expect(JSON.stringify(o)).not.toContain('"topics"');
    expect(o.custom.max).toBe(10);
    expect(o.counting).toContain("夫婦と子2人");
  });

  it("渡された世帯があれば、項目ごとに今の値があるか（値は返さない）と見直し・足りない所だけの数", () => {
    const input = modelHousehold("salariedCoupleTwoKids").input;
    const out = JSON.parse(hearingOptions(JSON.stringify({ sheet: "detail" }), JSON.stringify({ input }), "")) as { sheets: { sections: { items: { key: string; filled?: boolean }[] }[] }[]; templates: { id: string; selectedCount?: number }[]; household?: unknown };
    const items = out.sheets[0]!.sections.flatMap((s) => s.items);
    expect(items.find((i) => i.key === "hs.family.adult.birthYearMonth")?.filled).toBe(true);
    expect(items.some((i) => i.filled === false)).toBe(true);
    expect(JSON.stringify(out)).not.toContain("1985");
    expect(out.templates.find((t) => t.id === "missing")?.selectedCount).toBeGreaterThan(0);
    expect(out.household).toBeDefined();
  });

  it("事務所のひな形は、アプリ本体の答えから（アプリが起動していなければ null）。前に保存したひな形の話題は使わない", () => {
    const office = JSON.stringify({ available: true, templates: [{ name: "初回", selection: { ...sel({ template: "simple" }), topics: ["教育費"] } }] });
    const out = JSON.parse(hearingOptions("{}", "", office)) as { officeTemplates: { name: string; sheet: string }[] };
    expect(out.officeTemplates).toEqual([expect.objectContaining({ name: "初回", sheet: "simple" })]);
    expect((JSON.parse(hearingOptions("{}", "", "")) as { officeTemplates: unknown }).officeTemplates).toBeNull();
    const r = JSON.parse(hearingCheck(JSON.stringify({ template: "初回" }), "", office)) as { selection: WebSelection };
    expect(r.selection.topics).toBeUndefined();
  });
});

/** アプリ本体が接続口に渡す形（計算の入力・定年後の条件・画面の入力の進み具合。0222 の追記 2026-11-19） */
const sharedOf = (wh: WorkingHousehold): string =>
  JSON.stringify({ input: wh.request.input, postRetirement: wh.postRetirement, enteredState: { confirmed: wh.confirmed.length, addedItems: wh.addedItems.length, assumed: Object.keys(wh.assumed) } });
/** 接続口の答えで、詳細の票の項目のうち今の値がある物 */
const aiFilled = (wh: WorkingHousehold): string[] => {
  const out = JSON.parse(hearingOptions(JSON.stringify({ sheet: "detail" }), sharedOf(wh), "")) as { sheets: { sections: { items: { key: string; filled?: boolean }[] }[] }[] };
  return out.sheets[0]!.sections.flatMap((s) => s.items).filter((i) => i.filled === true).map((i) => i.key).sort();
};
/** 画面の答え（詳細の票の項目のうち今の値がある物。接続口が並べる項目だけ） */
const screenFilled = (wh: WorkingHousehold): string[] => {
  const listed = new Set((JSON.parse(hearingOptions(JSON.stringify({ sheet: "detail" }), "", "")) as { sheets: { sections: { items: { key: string }[] }[] }[] }).sheets[0]!.sections.flatMap((s) => s.items.map((i) => i.key)));
  return [...enteredKeys(wh, baseSheet("detail"))].filter((k) => listed.has(k)).sort();
};
const aiReview = (wh: WorkingHousehold) => JSON.parse(hearingCheck(JSON.stringify({ template: "review" }), sharedOf(wh), "")) as { selection: WebSelection | null; problems: string[] };
const confirmKeys = (sel: WebSelection | null | undefined): string[] => (sel?.sections ?? []).flatMap((s) => s.items).filter((i) => i.mode === "confirm").map((i) => i.key).sort();

describe("今の値があるか: 画面と AI で同じ答え（同じ関数 enteredKeys。0222 の追記 2026-11-19）", () => {
  it("作ったばかりの世帯: 画面も AI も「値なし」（初めの値・仮の値を入力した値と数えない）。見直しも確かめてもらう項目なし", () => {
    for (const wh of [blankHousehold("2026-11"), withRefreshedEstimates(blankHousehold("2026-11"))]) {
      expect(filledCount(wh)).toBe(0);
      expect(aiFilled(wh)).toEqual([]);
      expect(screenFilled(wh)).toEqual([]);
      expect(confirmKeys(templateSelection("review", wh))).toEqual([]);
      expect(confirmKeys(aiReview(wh).selection)).toEqual([]);
    }
  });

  it("一部だけ入れた世帯（入力項目を1つ保存した・足した）: 画面も AI も同じ項目に値あり", () => {
    const base = withRefreshedEstimates(blankHousehold("2026-11"));
    const saved: WorkingHousehold = { ...base, confirmed: ["family"] };
    expect(filledCount(saved)).toBeGreaterThan(0);
    expect(aiFilled(saved)).toEqual(screenFilled(saved));
    expect(aiFilled(saved)).toContain("hs.family.adult.birthYearMonth");
    expect(confirmKeys(aiReview(saved).selection)).toEqual(confirmKeys(templateSelection("review", saved)));
    // 仮の値を入れた欄は、画面も AI も書き出さない（値ありと読まない）
    expect(aiFilled(base)).toEqual(screenFilled(base));
  });

  it("見直しのひな形: 値の入った世帯で、画面と AI の確かめてもらう項目が同じ", () => {
    const wh = filledHousehold();
    expect(aiFilled(wh)).toEqual(screenFilled(wh));
    expect(aiFilled(wh).length).toBeGreaterThan(5);
    const r = aiReview(wh);
    expect(r.problems).toEqual([]);
    expect(r.selection?.sections).toEqual(templateSelection("review", wh).sections);
    expect(confirmKeys(r.selection).length).toBeGreaterThan(5);
  });
});

describe("選び方の確かめ（issue_hearing_url・propose_hearing_template の前。黙って直さない）", () => {
  const problems = (a: Record<string, unknown>, ctx = NONE) => aiSelection(a, ctx).problems.join("／");

  it("知らない項目は近い候補を添えて断る・混ぜられない票・範囲の項目・重なり・知らない名前", () => {
    expect(problems({ sheet: "simple", items: [{ key: "hs.income.anual" }] })).toContain("hs.income.annual のことですか");
    expect(problems({ template: "simple", sheet: "detail" })).toContain("混ぜられません");
    // 詳細の票だけの項目をシンプルに書く
    const detailOnly = (options({ sheet: "detail" }) as { sheets: { sections: { items: { key: string }[] }[] }[] }).sheets[0]!.sections.flatMap((s) => s.items.map((i) => i.key)).find((k) => !(options({ sheet: "simple" }) as { sheets: { sections: { items: { key: string }[] }[] }[] }).sheets[0]!.sections.some((s) => s.items.some((i) => i.key === k)))!;
    expect(problems({ sheet: "simple", items: [{ key: detailOnly }] })).toContain("混ぜられません");
    expect(problems({ sheet: "simple", items: [{ key: "hs.income.annualRange" }] })).toContain("range: true");
    expect(problems({ sheet: "simple", items: [{ key: "hs.income.annual" }, { key: "hs.income.annual" }] })).toContain("2回あります");
    expect(problems({ sheet: "simple", itmes: [] })).toContain("items のことですか");
    expect(problems({ sheet: "simple", items: [{ key: "hs.income.annual", mod: "ask" }] })).toContain("mode のことですか");
    expect(problems({ template: "simpel" })).toContain("simple のことですか");
  });

  it("見直し・足りない所だけ・確かめてもらう項目は、渡された世帯があるときだけ。今の値の無い項目は確かめにできない", () => {
    expect(problems({ template: "review" })).toContain("share_id");
    expect(problems({ template: "missing" })).toContain("share_id");
    expect(problems({ sheet: "detail", items: [{ key: "hs.family.adult.birthYearMonth", mode: "confirm" }] })).toContain("share_id");
    expect(problems({ sheet: "simple", items: [{ key: "hs.income.annual", mode: "confirm" }] }, { ...NONE, filled: ["hs.income.annual"] })).toContain("詳細の票だけ");
    expect(problems({ sheet: "detail", items: [{ key: "hs.family.adult.birthYearMonth", mode: "confirm" }] }, { ...NONE, filled: [] })).toContain("値が無い");
    // 足りない所だけ: 値のある項目（とその範囲）を外す
    const wh = filledHousehold();
    const filled = prefillOf(wh, sheetOf(templateSelection("detail", wh))!).filter((a) => a.status !== "blank").map((a) => a.key);
    const m = sel({ template: "missing" }, { ...NONE, filled });
    const keys = m.sections.flatMap((s) => s.items.map((i) => i.key));
    expect(keys).not.toContain("hs.family.adult.birthYearMonth");
    for (const k of keys) expect(filled).not.toContain(k);
    // 見直し: FP の画面のひな形と同じ選び方
    const r = sel({ template: "review" }, { ...NONE, filled });
    expect(r.sections).toEqual(templateSelection("review", wh).sections);
    expect(aiSelection({ template: "review" }, { ...NONE, filled }).review).toBe(true);
  });

  it("上限ちょうどは通り、超えると断る（独自の質問10問・書類15通・文の長さ）。制御文字・見えない書式の文字は断る", () => {
    const q = (n: number) => Array.from({ length: n }, (_, i) => ({ label: `質問${i + 1}` }));
    expect(aiSelection({ template: "simple", custom: q(10) }, NONE).selection).not.toBeNull();
    expect(problems({ template: "simple", custom: q(11) })).toContain("10問まで");
    expect(aiSelection({ template: "simple", custom: [{ label: "あ".repeat(120) }] }, NONE).selection).not.toBeNull();
    expect(problems({ template: "simple", custom: [{ label: "あ".repeat(121) }] })).toContain("120文字まで");
    expect(problems({ template: "simple", custom: [{ label: "改行\nあり" }] })).toContain("制御文字");
    expect(problems({ template: "simple", custom: [{ label: "見えない​文字" }] })).toContain("見えない書式");
    expect(problems({ template: "simple", custom: [{ label: "場所", answer: "choice", choices: ["事務所"] }] })).toContain("2〜8つ");
    const kinds = ["withholding", "payslip", "bonusSlip", "taxReturn", "companyAccounts", "residentTaxNotice", "retirementRules", "pensionNotice"];
    const docs15 = kinds.flatMap((k) => [{ kind: k, owner: "self" as const }, { kind: k, owner: "spouse" as const }]).slice(0, 15);
    expect(aiSelection({ template: "simple", documents: docs15 }, NONE).selection?.documents).toHaveLength(15);
    expect(problems({ template: "simple", documents: [...docs15, { kind: "deposits" }] })).toContain("15通まで");
    expect(problems({ template: "simple", documents: [{ kind: "withholdng" }] })).toContain("withholding のことですか");
    expect(problems({ template: "simple", documents: [{ kind: "loanSchedule", owner: "self" }] })).toContain("持ち主を選ばない");
    expect(problems({ template: "simple", documents: [{ kind: "other" }] })).toContain("title");
    // 話題はやめた（0192 の追記 2026-11-17）: 書くと知らない名前として断る。ご相談したいことは選べない
    expect(problems({ template: "simple", topics: ["教育費"] })).toContain("知らない名前です: topics");
    expect(problems({ sheet: "simple", items: [{ key: "hs.consult.topics" }] })).toContain("選べる項目にありません");
    expect(aiSelection({ sheet: "simple", items: [{ key: "hs.plan.events" }] }, NONE).selection).not.toBeNull();
    expect(problems({ template: "simple", name: "あ".repeat(41) })).toContain("40文字まで");
  });

  it("そろえた選び方は FP の画面の確かめ（checkSelection）を通り、範囲は既定で付き、人の書類は既定でご本人。数は FP の画面と同じ", () => {
    const s = sel({ sheet: "simple", items: [{ key: "hs.income.annual" }, { key: "hs.housing.rent", range: false }], documents: [{ kind: "withholding" }, { kind: "withholding" }], custom: [{ label: "面談の場所", answer: "yesNo" }], name: "初回" });
    expect(checkSelection(sheetOf(s)!, s)).toEqual([]);
    const keys = s.sections.flatMap((x) => x.items.map((i) => i.key));
    expect(keys).toContain("hs.income.annualRange");
    expect(keys).not.toContain("hs.housing.rentRange");
    expect(s.documents.map((d) => [d.title, d.owner])).toEqual([
      ["源泉徴収票（ご本人）", "self"],
      ["源泉徴収票（配偶者の方）", "spouse"],
    ]);
    expect(s.name).toBe("初回");
    const r = aiSelection({ sheet: "simple", items: [{ key: "hs.income.annual" }] }, NONE);
    expect(r.counts?.selectedCount).toBe(selectedCount(r.selection!));
    expect(r.counts?.screens).toBe(estimate(packetBody(sheetOf(r.selection!)!, r.selection!, { requestId: "R-COUNT1", expiresAt: "2099-01-01T00:00:00Z", office: { name: "", color: null, purpose: "", privacyContact: "" } })).screens);
    // 同じ選び方なら同じ独自の質問のキー（乱数を使わない）
    expect(sel({ template: "simple", custom: [{ label: "面談の場所" }] }).custom[0]!.key).toBe(sel({ template: "simple", custom: [{ label: "面談の場所" }] }).custom[0]!.key);
    // 接続口の同梱の入口も同じ答え
    const viaConnector = JSON.parse(hearingCheck(JSON.stringify({ sheet: "simple", items: [{ key: "hs.income.annual" }] }), "", "")) as { selection: WebSelection; summary: { sections: unknown[] } };
    expect(viaConnector.selection).toEqual(r.selection);
    expect(viaConnector.summary.sections).toHaveLength(1);
  });

  it("事務所のひな形から始める（名前は「カスタム: 名前」。項目を書けば「カスタム（名前から）」）", () => {
    const base = sel({ template: "simple", documents: [{ kind: "withholding" }] });
    const ctx = { ...NONE, officeTemplates: [{ name: "初回", selection: base }] };
    expect(sel({ template: "初回" }, ctx).name).toBe("カスタム: 初回");
    expect(sel({ template: "初回" }, ctx).documents).toHaveLength(1);
    expect(sel({ template: "初回", items: [{ key: "hs.income.annual" }] }, ctx).name).toBe("カスタム（初回から）");
    expect(problems({ template: "初回", sheet: "detail" }, ctx)).toContain("混ぜられません");
  });
});

describe("画面の発行（runIssueJob）", () => {
  it("世帯の決まっていない依頼: 事務所データに置き、URL と案内文を返す。お客さまが開けて、顧客番号は空", async () => {
    const r = relayFor();
    const s = sel({ template: "simple", custom: [{ label: "面談の場所", answer: "choice", choices: ["事務所", "オンライン"] }] });
    const out = await runIssueJob(job(s), { transport: r.t, config, office: { name: "【架空】みらいFP事務所", color: null }, privacyContact: "", opened: null, now: NOW, random: new Uint8Array([1, 2, 3, 4, 5, 6]) }, EMPTY_OFFICE_HEARING);
    expect(out.place).toBe("office");
    expect(out.answer.ok).toBe(true);
    if (!out.answer.ok) return;
    expect(out.answer.url).toMatch(/^https:\/\/relay\.test\/h\/#1\./);
    expect(out.answer.invitation).toContain(out.answer.url);
    expect(out.answer.selectedCount).toBe(selectedCount(s));
    expect(out.answer.household).toBe("new");
    expect(out.entry?.origin).toEqual({ kind: "ai", at: out.entry?.record.issuedAt, connector: "test-ai 1.0" });
    expect(out.entry?.record.customerNo).toBe("");
    expect(JSON.stringify(out.answer)).not.toContain("secret");
    const opened = await openRequest(new URL(out.answer.url!).hash, r.t);
    expect(opened.packet.items.some((i) => i.label === "面談の場所")).toBe(true);
    expect(opened.packet.office.purpose).toBe("ライフプランの作成と、家計・保険・資産運用のご相談のため");
    const store = withIssued(EMPTY_OFFICE_HEARING, out.entry, null, null, out.log);
    expect(unassignedAccepting(store, NOW)).toBe(1);
    expect(unseenCount(store)).toBe(1);
    expect(unseenCount(markSeen(store))).toBe(0);
    // 読み直しても同じ（事務所データの形）
    expect(readOfficeHearing(JSON.parse(JSON.stringify(store)))).toEqual(store);
  });

  it("見直しを含む渡された世帯の依頼: 開いている世帯に置き、前回の値を問いに載せ、URL と案内文は返さない", async () => {
    const r = relayFor();
    const wh = filledHousehold();
    const filled = prefillOf(wh, sheetOf(templateSelection("detail", wh))!).filter((a) => a.status !== "blank").map((a) => a.key);
    const s = sel({ template: "review" }, { ...NONE, filled });
    const out = await runIssueJob(job(s, { householdId: "hh-1", customerNumber: "A0001" }), { transport: r.t, config, office: { name: "", color: null }, privacyContact: "", opened: { id: "hh-1", wh, readOnly: false }, now: NOW }, EMPTY_OFFICE_HEARING);
    expect(out.place).toBe("open");
    expect(out.answer.ok && out.answer.review).toBe(true);
    expect(out.answer.ok ? out.answer.url : "x").toBeUndefined();
    expect(out.answer.ok ? out.answer.invitation : "x").toBeUndefined();
    expect(out.answer.ok ? out.answer.message : "").toContain("URL と案内文は返しません");
    expect(out.entry?.record.customerNo).toBe("A0001");
    const o = await openRequest(new URL(out.entry!.record.url).hash, r.t);
    expect(o.packet.items.some((i) => i.prefill !== undefined)).toBe(true);
    // 世帯に置いて保存しても出どころが残る（形式 0.81）
    const back = fromBody(bodyOf({ ...fromBody(bodyOf(fromBody(JSON.stringify({ meta: { formatVersion: "0.81" }, household: { request: modelHousehold("salariedCoupleTwoKids") }, proposals: [], workspace: {}, display: {} })))), wh: withWebEntry(wh, out.entry!) }));
    expect(webLog(back.wh)[0]?.origin?.kind).toBe("ai");
  });

  it("開いていない世帯の見直し: 本体の帳面の本文から前回の値を作り、事務所データに世帯の印つきで置く。開いたら世帯ファイルへ移す", async () => {
    const r = relayFor();
    const wh = filledHousehold();
    const filled = prefillOf(wh, sheetOf(templateSelection("detail", wh))!).filter((a) => a.status !== "blank").map((a) => a.key);
    const s = sel({ sheet: "detail", items: [{ key: "hs.family.adult.birthYearMonth", mode: "confirm" }] }, { ...NONE, filled });
    const body = bodyOf(fromBody(JSON.stringify({ meta: { formatVersion: "0.81" }, household: { request: modelHousehold("salariedCoupleTwoKids") }, proposals: [], workspace: {}, display: {} })));
    const out = await runIssueJob(job(s, { householdId: "hh-2", customerNumber: "A0002", body }), { transport: r.t, config, office: { name: "", color: null }, privacyContact: "", opened: null, now: NOW }, EMPTY_OFFICE_HEARING);
    expect(out.place).toBe("office");
    const o = await openRequest(new URL(out.entry!.record.url).hash, r.t);
    expect(o.packet.items.find((i) => i.key === "hs.family.adult.birthYearMonth")?.prefill).toBeDefined();
    let store = withIssued(EMPTY_OFFICE_HEARING, out.entry, "hh-2", "A0002", out.log);
    // 見直しの依頼で世帯を読めなければ断る
    const no = await runIssueJob(job(s, { householdId: "hh-2", customerNumber: "A0002", body: null }), { transport: r.t, config, office: { name: "", color: null }, privacyContact: "", opened: null, now: NOW }, store);
    expect(no.answer.ok).toBe(false);
    // その世帯を開いた: 移す（ほかの世帯の依頼は残す）
    store = withIssued(store, { ...out.entry!, record: { ...out.entry!.record, requestId: "R-OTHER1" } }, null, null, null);
    const { take, rest } = pendingFor(store, "hh-2");
    expect(take).toHaveLength(1);
    expect(rest.requests.map((x) => x.entry.record.requestId)).toEqual(["R-OTHER1"]);
    const moved = moveInto(wh, take, []);
    expect(webLog(moved).map((e) => e.record.requestId)).toEqual([out.entry!.record.requestId]);
    // 同じ依頼番号がもう世帯にあれば、世帯の方を残す
    expect(webLog(moveInto(moved, take, [out.entry!.record.requestId]))).toHaveLength(1);
  });

  it("世帯の決まっていない依頼の上限: 19件までなら発行し、20件で断る。取り消した依頼は数えない", async () => {
    const r = relayFor();
    const s = sel({ template: "simple" });
    const one = await runIssueJob(job(s), { transport: r.t, config, office: { name: "", color: null }, privacyContact: "", opened: null, now: NOW }, EMPTY_OFFICE_HEARING);
    let store: OfficeHearing = EMPTY_OFFICE_HEARING;
    for (let i = 0; i < UNASSIGNED_LIMIT - 1; i++) store = withIssued(store, { ...one.entry!, record: { ...one.entry!.record, requestId: `R-${String(i).padStart(6, "0")}` } }, null, null, null);
    const ok = await runIssueJob(job(s), { transport: r.t, config, office: { name: "", color: null }, privacyContact: "", opened: null, now: NOW }, store);
    expect(ok.answer.ok).toBe(true);
    store = withIssued(store, ok.entry, null, null, null);
    expect(unassignedAccepting(store, NOW)).toBe(UNASSIGNED_LIMIT);
    const over = await runIssueJob(job(s), { transport: r.t, config, office: { name: "", color: null }, privacyContact: "", opened: null, now: NOW }, store);
    expect(over.answer).toMatchObject({ ok: false, code: "E_LIMIT" });
    // 渡された世帯の依頼は数えない
    const shared = await runIssueJob(job(s, { householdId: "hh-1" }), { transport: r.t, config, office: { name: "", color: null }, privacyContact: "", opened: null, now: NOW }, store);
    expect(shared.answer.ok).toBe(true);
    // 取り消した依頼は数えない
    const cancelled = withPending(store, { ...ok.entry!, state: "cancelled" });
    expect(unassignedAccepting(cancelled, NOW)).toBe(UNASSIGNED_LIMIT - 1);
  });

  it("本番の受け付けのサーバーが無い・つながらないときは、分かる文で断り、何も置かない", async () => {
    const s = sel({ template: "simple" });
    const none = await runIssueJob(job(s), { transport: relayFor().t, config: async () => ({ pageUrl: "", dev: false }), office: { name: "", color: null }, privacyContact: "", opened: null, now: NOW }, EMPTY_OFFICE_HEARING);
    expect(none.answer).toMatchObject({ ok: false, code: "E_HEARING_WEB_NO_RELAY" });
    expect(none.answer.ok ? "" : none.answer.message).toContain("受け付けのサーバーがまだ用意されていません");
    expect(none.entry).toBeNull();
    const down: RelayTransport = async () => {
      throw new Error("E_RELAY_UNREACHABLE");
    };
    const unreachable = await runIssueJob(job(s), { transport: down, config, office: { name: "", color: null }, privacyContact: "", opened: null, now: NOW }, EMPTY_OFFICE_HEARING);
    expect(unreachable.answer.ok ? "" : unreachable.answer.message).toContain("つながりませんでした");
    expect(relayMessage("E_HEARING_WEB_URL")).toContain("本番の受け付けのサーバー");
  });

  it("AI が書いた文の番号らしい所は消す（消した数を返す）。見直しは世帯の決まっていない依頼では使えない。形の違う選び方は断る", async () => {
    const r = relayFor();
    const s = sel({ template: "simple", custom: [{ label: "証券番号 123456789012 のご契約について" }] });
    const scrubbed = scrubSelection(s);
    expect(scrubbed.masked).toBe(1);
    expect(scrubbed.selection.custom[0]!.label).not.toContain("123456789012");
    const out = await runIssueJob(job(s), { transport: r.t, config, office: { name: "", color: null }, privacyContact: "", opened: null, now: NOW }, EMPTY_OFFICE_HEARING);
    expect(out.answer.ok && out.answer.masked).toBe(1);
    expect(JSON.stringify(out.entry?.record.selection)).not.toContain("123456789012");
    const wh = filledHousehold();
    const filled = prefillOf(wh, sheetOf(templateSelection("detail", wh))!).filter((a) => a.status !== "blank").map((a) => a.key);
    const review = sel({ template: "review" }, { ...NONE, filled });
    expect((await runIssueJob(job(review), { transport: r.t, config, office: { name: "", color: null }, privacyContact: "", opened: null, now: NOW }, EMPTY_OFFICE_HEARING)).answer.ok).toBe(false);
    expect((await runIssueJob(job({ base: { sheetId: "basic", version: 3 }, sections: [{ id: "nope", items: [] }], custom: [], documents: [] }), { transport: r.t, config, office: { name: "", color: null }, privacyContact: "", opened: null, now: NOW }, EMPTY_OFFICE_HEARING)).answer.ok).toBe(false);
  });

  it("世帯の決まっていない依頼を、開いている世帯・新しい世帯に結びつけて移し、そこで受け取り・取り込みができる", async () => {
    const r = relayFor();
    const s = sel({ template: "simple" });
    const out = await runIssueJob(job(s), { transport: r.t, config, office: { name: "", color: null }, privacyContact: "", opened: null, now: NOW }, EMPTY_OFFICE_HEARING);
    let store = withIssued(EMPTY_OFFICE_HEARING, out.entry, null, null, out.log);
    // お客さまが答える
    const o = await openRequest(new URL(out.entry!.record.url).hash, r.t);
    const d: Draft = { ...initialDraft(o.packet), gates: { spouse: 0, child: 0 }, answers: { [draftKey("hs.consent.purpose")]: { status: "value", raw: { kind: "text", text: "given" } }, [draftKey("hs.work.type", 1)]: { status: "value", raw: { kind: "text", text: "regular" } } } };
    await submitAnswers(o, answersOf(o.packet, d, NOW), r.t);
    for (const target of ["open", "new"] as const) {
      // 開いている世帯（値の入った世帯）か、新しく作った世帯（空の世帯）
      const wh = target === "open" ? filledHousehold() : withRefreshedEstimates(blankHousehold("2026-11"));
      const assigned = assignTo(store, out.entry!.record.requestId, `hh-${target}`, target === "open" ? "A0001" : "A0099");
      expect(assigned.requests[0]?.householdId).toBe(`hh-${target}`);
      const { take, rest } = pendingFor(assigned, `hh-${target}`);
      expect(rest.requests).toHaveLength(0);
      const moved = moveInto(wh, take, []);
      const e = webLog(moved)[0]!;
      expect(e.origin?.kind).toBe("ai");
      const got = await receiveWeb(moved, e, r.t, NOW);
      expect(got?.entry.received?.answers.length).toBeGreaterThan(0);
      expect(statusOf(got!.entry, NOW)).toBe("received");
    }
    // 結びつけは世帯の決まっていない依頼だけ（もう結びついた依頼は変えない）
    store = assignTo(store, out.entry!.record.requestId, "hh-a", null);
    expect(assignTo(store, out.entry!.record.requestId, "hh-b", null).requests[0]?.householdId).toBe("hh-a");
  });

  it("取り消した依頼は期限の後に片付ける（記録は残す）。90日を大きく過ぎた依頼も片付ける", async () => {
    const r = relayFor();
    const out = await runIssueJob(job(sel({ template: "simple" })), { transport: r.t, config, office: { name: "", color: null }, privacyContact: "", opened: null, now: NOW }, EMPTY_OFFICE_HEARING);
    const store = withPending(withIssued(EMPTY_OFFICE_HEARING, out.entry, null, null, out.log), { ...out.entry!, state: "cancelled" });
    expect(pruned(store, NOW).requests).toHaveLength(1);
    const later = new Date(NOW.getTime() + 31 * 86400_000);
    expect(pruned(store, later).requests).toHaveLength(0);
    expect(pruned(store, later).log).toHaveLength(1);
    const far = new Date(NOW.getTime() + 125 * 86400_000);
    expect(pruned(withIssued(EMPTY_OFFICE_HEARING, out.entry, null, null, null), far).requests).toHaveLength(0);
    expect(readOfficeHearing({ v: 2 })).toEqual(EMPTY_OFFICE_HEARING);
    expect(readOfficeHearing({ v: 1, requests: [{ entry: {} }, null], log: [{}] })).toEqual(EMPTY_OFFICE_HEARING);
  });
});

describe("事務所のひな形の案（propose_hearing_template）", () => {
  it("確かめて、番号らしい所を消し、見直しの項目は断る。同じ名前は置き換え、上限なら保存できない", () => {
    const s = sel({ template: "simple", custom: [{ label: "面談の場所" }] });
    const v = readTemplateProposal({ candidateId: "c1", name: "初回", selection: s }, [], 20);
    expect(v.problems).toEqual([]);
    expect(v.selection).not.toBeNull();
    expect(readTemplateProposal({ candidateId: "c1", name: "初回", selection: s }, [{ name: "初回" }], 20).replaces).toBe(true);
    expect(readTemplateProposal({ candidateId: "c1", name: "次", selection: s }, Array.from({ length: 20 }, (_, i) => ({ name: `t${i}` })), 20).full).toBe(true);
    const confirm = { ...s, base: { sheetId: "full", version: 5 }, sections: [{ id: "family", items: [{ key: "hs.family.adult.birthYearMonth", mode: "confirm" as const }] }], custom: [] };
    expect(readTemplateProposal({ candidateId: "c2", name: "見直し", selection: confirm }, [], 20).problems.join()).toContain("見直し");
    expect(readTemplateProposal({ candidateId: "c3", name: "x", selection: { base: {} } }, [], 20).selection).toBeNull();
  });

  it("承認の画面: 名前・票・聞く項目・書類・AI の理由と「ひな形として保存する」「捨てる」。保存できない案は理由と「捨てる」だけ", () => {
    const s = sel({ template: "simple", documents: [{ kind: "withholding" }] });
    const html = renderToString(h(HearingTemplateProposals, { candidates: [{ candidateId: "c1", receivedAt: "2026-11-17T01:00:00Z", connector: "test-ai 1.0", name: "初回", selection: s, note: "よく使う" }, { candidateId: "c2", receivedAt: "2026-11-17T01:00:00Z", connector: null, name: "壊れた", selection: { base: {} } }], templates: [], onSave: async () => undefined, onDiscard: async () => undefined }));
    expect(html).toContain("AIからのヒアリングのひな形の案");
    expect(html).not.toContain("接続口");
    expect(html).toContain("カスタム: ");
    expect(html).toContain("源泉徴収票（ご本人）");
    expect(html).toContain("よく使う");
    expect(html.match(/data-ai-hearing-template-save/g)).toHaveLength(1);
    expect(html.match(/data-ai-hearing-template-discard/g)).toHaveLength(2);
    expect(html).toContain("この案は保存できません");
    expect(renderToString(h(HearingTemplateProposals, { candidates: [], templates: [], onSave: async () => undefined, onDiscard: async () => undefined }))).toBe("");
  });
});

describe("画面: 帯・AI が発行した URL の一覧・依頼の一覧の出どころ", () => {
  it("帯は件数だけ（顧客番号を出さない）。0件なら出さない", () => {
    expect(renderToString(h(AiHearingBand, { count: 0, onOpen: () => undefined }))).toBe("");
    const html = renderToString(h(AiHearingBand, { count: 2, onOpen: () => undefined }));
    expect(html).toContain("AI が URL を発行しました（2件）");
    expect(html).not.toContain("接続口");
    expect(html).not.toContain("顧客番号");
  });

  it("一覧: 世帯の決まっていない依頼は取り込む世帯を選べ、開いていない世帯の依頼は開くボタン、移した依頼は場所だけ", async () => {
    const r = relayFor();
    const s = sel({ template: "simple" });
    const a = await runIssueJob(job(s), { transport: r.t, config, office: { name: "", color: null }, privacyContact: "", opened: null, now: NOW }, EMPTY_OFFICE_HEARING);
    const b = await runIssueJob(job(s, { householdId: "hh-2", customerNumber: "A0002" }), { transport: r.t, config, office: { name: "", color: null }, privacyContact: "", opened: null, now: NOW }, EMPTY_OFFICE_HEARING);
    let store = withIssued(EMPTY_OFFICE_HEARING, a.entry, null, null, a.log);
    store = withIssued(store, b.entry, "hh-2", "A0002", b.log);
    store = withIssued(store, null, null, null, { ...b.log!, requestId: "R-MOVED1", customerNo: "A0003" });
    const web = { config, call: r.t, saveDocument: async () => ({ saved: false }), saveDocuments: async () => ({ picked: false, saved: [], failed: 0, syncFolder: false, via: "folder" as const }) };
    const html = renderToString(h(AiHearingPanel, { store, web: web as never, officeName: "", opened: { id: "hh-9", customerNo: "A0009", readOnly: false }, onEntry: async () => undefined, onAssignOpened: async () => true, onCreate: async () => null, onOpenHousehold: () => undefined, onClose: () => undefined }));
    expect(html).toContain("AI が発行した URL");
    // 画面の文は「AI から」（利用者の判断 2026-11-18）
    expect(html).toContain("AI から発行した、Web のヒアリングの URL です。");
    expect(html).not.toContain("接続口");
    expect(html).toContain('data-ai-hearing-place="new"');
    expect(html).toContain("新しい世帯を作って取り込む");
    expect(html).toContain("開いている世帯（顧客番号 A0009）に取り込む");
    expect(html).toContain('data-ai-hearing-place="waiting"');
    expect(html).toContain("data-ai-hearing-open-household");
    expect(html).toContain('data-ai-hearing-place="household"');
    expect(html).toContain("顧客番号 A0003 の世帯の「URL の依頼」にあります");
    expect(html.match(/data-ai-hearing-cancel=""/g)?.length ?? html.match(/data-ai-hearing-cancel/g)?.length).toBeGreaterThan(0);
  });

  it("世帯の依頼の一覧の行に「出どころ AI」（FP の画面で発行した依頼には出さない）", async () => {
    const r = relayFor();
    const s = sel({ template: "simple" });
    const out = await runIssueJob(job(s), { transport: r.t, config, office: { name: "", color: null }, privacyContact: "", opened: null, now: NOW }, EMPTY_OFFICE_HEARING);
    const wh = withWebEntry(withWebEntry(withRefreshedEstimates(blankHousehold("2026-11")), out.entry!), { ...out.entry!, record: { ...out.entry!.record, requestId: "R-FP0001" }, origin: undefined } as WebLogEntry);
    const web = { config, call: r.t, saveDocument: async () => ({ saved: false }), saveDocuments: async () => ({ picked: false, saved: [], failed: 0, syncFolder: false, via: "folder" as const }) };
    const html = renderToString(h(WebRequests, { wh, web: web as never, officeName: "", appVersion: "0.1.0", onSave: () => undefined, saveNow: async () => true, onImport: () => undefined }));
    expect(html.match(/data-web-origin="ai"/g)).toHaveLength(1);
    expect(html).toContain("出どころ AI");
    expect(html).not.toContain("接続口");
  });
});

describe("FP の画面と同じ数（estimateOf と同じ）", () => {
  it("世帯の決まっていない依頼の所要時間は、FP の画面の発行と同じ数え方", async () => {
    const s = sel({ template: "simple" });
    const r = relayFor();
    const out = await runIssueJob(job(s), { transport: r.t, config, office: { name: "", color: null }, privacyContact: "", opened: null, now: NOW }, EMPTY_OFFICE_HEARING);
    expect(out.answer.ok && out.answer.minutes).toBe(estimateOf(null, s)?.std.minutes);
    expect(out.answer.ok && out.answer.screens).toBe(estimateOf(null, s)?.std.screens);
  });
});

describe("「事前ヒアリングを取り込む」の「AI が発行した URL」の入口（0222 の追記 2026-11-20）", () => {
  type Props = Record<string, unknown>;
  /** 描いた木の要素を集める（画面を描かずに、ボタンの操作を呼ぶため） */
  const capture = (node: VNode<any>): VNode<Props>[] => { // eslint-disable-line @typescript-eslint/no-explicit-any
    const out: VNode<Props>[] = [];
    const prev = preactOptions.vnode;
    preactOptions.vnode = (v) => {
      if (typeof v.type === "string") out.push(v as VNode<Props>);
      prev?.(v);
    };
    try {
      renderToString(node);
    } finally {
      preactOptions.vnode = prev;
    }
    return out;
  };
  const sheets = { save: async () => ({ saved: false }), open: async () => null } as unknown as SheetHost;
  const webOf = (t: RelayTransport) => ({ config, call: t, saveDocument: async () => ({ saved: false }), saveDocuments: async () => ({ picked: false, saved: [], failed: 0, syncFolder: false, via: "folder" as const }) }) as unknown as HearingWebHost;
  const tools = (store: OfficeHearing, web: HearingWebHost, aiOn: boolean, onOpen: () => void = () => undefined) =>
    h(HearingTools, { wh: withRefreshedEstimates(blankHousehold("2026-11")), sheets, onSave: () => undefined, webProps: { web, office: { name: "", color: null }, templates: [], onTemplates: async () => undefined, persisted: true, saveNow: async () => true }, aiIssued: { store, aiOn, onOpen } });
  /** 世帯の決まっていない依頼1件と、渡された世帯（開いていない）の依頼1件 */
  async function issued() {
    const r = relayFor();
    const s = sel({ template: "simple" });
    const ctx = { transport: r.t, config, office: { name: "", color: null }, privacyContact: "", opened: null, now: NOW };
    const a = await runIssueJob(job(s), ctx, EMPTY_OFFICE_HEARING);
    const b = await runIssueJob(job(s, { householdId: "hh-2", customerNumber: "A0002" }), ctx, EMPTY_OFFICE_HEARING);
    let store = withIssued(EMPTY_OFFICE_HEARING, a.entry, null, null, a.log);
    store = withIssued(store, b.entry, "hh-2", "A0002", b.log);
    return { r, store, a: a.entry!, b: b.entry! };
  }
  /** お客さまが答える */
  async function answer(entry: WebLogEntry, t: RelayTransport) {
    const o = await openRequest(new URL(entry.record.url).hash, t);
    const d: Draft = { ...initialDraft(o.packet), gates: { spouse: 0, child: 0 }, answers: { [draftKey("hs.consent.purpose")]: { status: "value", raw: { kind: "text", text: "given" } }, [draftKey("hs.work.type", 1)]: { status: "value", raw: { kind: "text", text: "regular" } } } };
    await submitAnswers(o, answersOf(o.packet, d, NOW), t);
  }
  /** 一覧の「届いたかを確かめる」と同じく、確かめた結果を覚える */
  async function check(entry: WebLogEntry, t: RelayTransport) {
    const a = await checkAnswered(entry, t);
    noteArrival(entry.record.requestId, a === null ? null : { answers: a.newAnswers, batches: a.batches, submitted: a.answered, at: NOW.toISOString() });
  }

  it("帯の有無に関係なく出る: 見た後（帯が消えた後）も「事前ヒアリングを取り込む」にボタンがあり、まだ見ていない URL があれば数を添える", async () => {
    const { r, store } = await issued();
    const web = webOf(r.t);
    // まだ見ていない: 帯も入口も出て、入口に数
    expect(renderToString(h(AiHearingBand, { count: unseenCount(store), onOpen: () => undefined }))).toContain("AI が URL を発行しました（2件）");
    const before = renderToString(tools(store, web, true));
    const take = before.slice(before.indexOf("data-hearing-take"));
    expect(take).toContain("data-ai-hearing-entry-open");
    expect(before).toContain("まだ見ていない URL（2件）");
    // 見た後: 帯は消えるが、入口は残る（数は添えない）
    const seen = markSeen(store);
    expect(renderToString(h(AiHearingBand, { count: unseenCount(seen), onOpen: () => undefined }))).toBe("");
    const after = renderToString(tools(seen, web, true));
    expect(after).toContain("data-ai-hearing-entry-open");
    expect(after).toContain("AI が発行した URL");
    expect(after).not.toContain("data-ai-hearing-entry-unseen");
    // 顧客番号を出さない（お客さまと一緒に見る画面。数だけ）
    expect(after).not.toContain("A0002");
    expect(after).not.toContain("接続口");
    // AI からの発行を受けない画面（aiIssued を渡さない）では出さない
    expect(renderToString(h(HearingTools, { wh: withRefreshedEstimates(blankHousehold("2026-11")), sheets, onSave: () => undefined, webProps: { web, office: { name: "", color: null }, templates: [], onTemplates: async () => undefined, persisted: true, saveNow: async () => true } }))).not.toContain("data-ai-hearing-entry");
  });

  it("押すと一覧が開く（帯の「確かめる」と同じ操作を呼ぶ）。一覧の行の数は、入口が数える記録の数と同じ", async () => {
    const { r, store } = await issued();
    let opened = 0;
    const btn = capture(tools(markSeen(store), webOf(r.t), true, () => opened++)).find((v) => "data-ai-hearing-entry-open" in v.props);
    expect(btn).toBeDefined();
    (btn!.props.onClick as () => void)();
    expect(opened).toBe(1);
    // 開いた一覧に並ぶ行の数（記録と、記録の無い依頼）
    const extra = withIssued(store, { ...store.requests[0]!.entry, record: { ...store.requests[0]!.entry.record, requestId: "R-NOLOG1" } }, null, null, null);
    expect(issuedCount(extra)).toBe(3);
    const panel = renderToString(h(AiHearingPanel, { store: extra, web: webOf(r.t), officeName: "", opened: null, onEntry: async () => undefined, onAssignOpened: async () => true, onCreate: async () => null, onOpenHousehold: () => undefined, onClose: () => undefined }));
    expect(panel.match(/data-ai-hearing-row=/g)).toHaveLength(issuedCount(extra));
  });

  it("世帯の決まっていない依頼に答えが届いたら、入口に数を出す（渡された世帯の依頼・取り消した依頼は数えない）", async () => {
    const { r, store, a, b } = await issued();
    const web = webOf(r.t);
    try {
      await check(a, r.t);
      await check(b, r.t);
      expect(unassignedArrived(store, NOW)).toBe(0);
      expect(renderToString(tools(store, web, true))).not.toContain("data-ai-hearing-entry-arrived");
      await answer(a, r.t);
      await answer(b, r.t);
      await check(a, r.t);
      await check(b, r.t);
      expect(arrivedNow(a, NOW)).toBe(true);
      expect(arrivedNow(b, NOW)).toBe(true);
      // 渡された世帯の依頼は、その世帯を開けば「URL の依頼」に並ぶので、ここでは数えない
      expect(unassignedArrived(store, NOW)).toBe(1);
      const html = renderToString(tools(markSeen(store), web, true));
      expect(html).toContain("世帯の決まっていない依頼に届いています（1件）");
      // 一覧の行の「届いています」と同じ決め方
      const panel = renderToString(h(AiHearingPanel, { store, web, officeName: "", opened: null, onEntry: async () => undefined, onAssignOpened: async () => true, onCreate: async () => null, onOpenHousehold: () => undefined, onClose: () => undefined }));
      expect(panel.match(/data-ai-hearing-arrived/g)).toHaveLength(2);
      // 取り消した依頼・期限の過ぎた依頼は数えない
      expect(unassignedArrived(withPending(store, { ...a, state: "cancelled" }), NOW)).toBe(0);
      expect(unassignedArrived(store, new Date(Date.parse(a.record.expiresAt) + 1000))).toBe(0);
      // 世帯に結びつけた依頼は数えない（その世帯の「URL の依頼」に移る）
      expect(unassignedArrived(assignTo(store, a.record.requestId, "hh-9", "A0009"), NOW)).toBe(0);
    } finally {
      noteArrival(a.record.requestId, null);
      noteArrival(b.record.requestId, null);
    }
  });

  it("入口を出したときに確かめ直すのは、まだ確かめていない依頼と、「まだ届いていない」と確かめてから5分を過ぎた依頼だけ", () => {
    const id = "R-STALE01";
    try {
      expect(staleArrival(id, NOW)).toBe(true);
      noteArrival(id, { answers: false, batches: 0, submitted: false, at: NOW.toISOString() });
      expect(staleArrival(id, new Date(NOW.getTime() + 60_000))).toBe(false);
      expect(staleArrival(id, new Date(NOW.getTime() + 5 * 60_000))).toBe(true);
      // 届いていると分かっている依頼は、確かめ直さない（一覧の「届いたかを確かめる」で確かめる）
      noteArrival(id, { answers: true, batches: 0, submitted: true, at: NOW.toISOString() });
      expect(staleArrival(id, new Date(NOW.getTime() + 60 * 60_000))).toBe(false);
    } finally {
      noteArrival(id, null);
    }
  });

  it("AI との接続がオフでも、記録が残っていれば出す（確かめて取り込める）。記録が0件なら、オンのときだけ出す", async () => {
    const { r, store } = await issued();
    const web = webOf(r.t);
    const off = renderToString(h(AiHearingEntry, { store: markSeen(store), web, aiOn: false, onOpen: () => undefined }));
    expect(off).toContain("data-ai-hearing-entry-open");
    expect(off).toContain("AI との接続はオフですが、発行済みの URL はここで確かめて取り込めます");
    expect(renderToString(h(AiHearingEntry, { store: markSeen(store), web, aiOn: true, onOpen: () => undefined }))).not.toContain("data-ai-hearing-entry-off");
    // 記録が0件: オフなら出さない、オンなら「まだありません」
    expect(renderToString(h(AiHearingEntry, { store: EMPTY_OFFICE_HEARING, web, aiOn: false, onOpen: () => undefined }))).toBe("");
    const none = renderToString(h(AiHearingEntry, { store: EMPTY_OFFICE_HEARING, web, aiOn: true, onOpen: () => undefined }));
    expect(none).toContain("data-ai-hearing-entry-open");
    expect(none).toContain("AI が発行した URL はまだありません");
  });
});
