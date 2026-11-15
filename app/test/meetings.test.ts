// 面談の履歴（0182）とメモの置き場（FP のメニューの中。0016・0077 の追記）
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { h } from "preact";
import { renderToString } from "preact-render-to-string";
import { REPO_DIR } from "../scripts/lib.ts";
import { fpMenuGroups } from "../src/workspace/header/FpMenu.tsx";
import { applyImport, approvalTime, importSheet } from "../src/workspace/hearing/sheet.ts";
import { fromRequest, type WorkingHousehold } from "../src/workspace/input/household.ts";
import { MeetingTools } from "../src/workspace/meetings/MeetingTools.tsx";
import { hasContent, hasNotes, withoutNotes, intentOf, isMeetingDate, latestMeeting, mergeMeetingSections, newMeeting, putMeeting, readMeetings, sortedMeetings, withIntent, withMeetings, withoutMeeting, type Meeting } from "../src/workspace/meetings/meetings.ts";
import { keepSnapshots, makeSnapshot } from "../src/workspace/snapshots/snapshots.ts";
import { BODY_FORMAT_VERSION, bodyObject, bodyOf, EMPTY_CARRY, fromBody, type BodyState } from "../src/workspace/store/body.ts";
import { mergeForkBodies } from "../src/workspace/store/office.ts";
import { dropNotesOnPersist, stripNotesBeforeSample, type SampleNotesDeps } from "../src/workspace/store/sampleNotes.ts";
import { APP_SAMPLE_MEMO_TEXT, SAMPLE_NOTES_TEXT } from "../src/workspace/store/HouseholdPanel.tsx";
import { DEMO_HOUSEHOLDS } from "../src/workspace/catalog.ts";
import { FpTools, meetingForReview } from "../src/workspace/tools/FpTools.tsx";
import { describeSnap } from "../src/workspace/undo/appHistory.ts";
import { DEFAULT_BALANCE_SETTINGS, DEFAULT_DISPLAY_SETTINGS } from "../src/workspace/settings.ts";
import { CURRENT } from "../src/workspace/plans/band.ts";
import { modelHousehold } from "./helpers.ts";
import { markedMeetings } from "./meetingsFixture.ts";

const noop = () => undefined;
const wh0 = (): WorkingHousehold => fromRequest(modelHousehold("salariedCoupleTwoKids"), { memo: ["一行目"] });
const state = (wh: WorkingHousehold): BodyState => ({
  wh,
  workspace: { template: "salariedCoupleTwoKids", band: [], base: CURRENT, selected: CURRENT, shownItems: [] },
  display: { result: DEFAULT_DISPLAY_SETTINGS, balance: DEFAULT_BALANCE_SETTINGS },
  carry: EMPTY_CARRY,
});

describe("面談の記録の形（0182）", () => {
  it("新しい記録は空の欄で、保険の意向はお客さまと見てよい欄に置く。意向をFPだけにすると、もう一方の欄からは外す", () => {
    const m = newMeeting("2026-11-09", "x");
    expect(m.shared.insurance).toEqual({ initial: "", final: "", reason: "" });
    expect(m.fpOnly.insurance).toBeUndefined();
    expect(intentOf(m).fpOnly).toBe(false);
    const fp = withIntent(m, { initial: "a", final: "b", reason: "" }, true);
    expect(fp.shared.insurance).toBeUndefined();
    expect(fp.fpOnly.insurance).toEqual({ initial: "a", final: "b", reason: "" });
    expect(withIntent(fp, intentOf(fp).intent, false).fpOnly.insurance).toBeUndefined();
    expect(hasContent(m)).toBe(false);
    expect(hasContent(fp)).toBe(true);
    expect(hasContent({ ...m, snapshot: "s1" })).toBe(true);
  });

  it("日の形（月の日数も見る）", () => {
    expect(isMeetingDate("2026-11-09")).toBe(true);
    expect(isMeetingDate("2026-02-29")).toBe(false);
    expect(isMeetingDate("2028-02-29")).toBe(true);
    expect(isMeetingDate("2026-11")).toBe(false);
  });

  it("読むときに形を確かめる: 形の合わない記録・同じ ID の2つ目を捨て、知らない欄（名前など）は持たない。意向が両方の欄にあれば FP だけの欄を残す", () => {
    const list = readMeetings({
      version: 1,
      records: [
        { id: "a", on: "2026-11-09", shared: { talked: "話", decided: 1, todo: "やる", insurance: { initial: "x" } }, fpOnly: { note: "メモ", insurance: { initial: "y" } }, name: "架空 太郎", phone: "000", snapshot: "s1", by: "u1" },
        { id: "a", on: "2026-11-10", shared: {}, fpOnly: {} },
        { id: "b", on: "2026-13-01", shared: {}, fpOnly: {} },
        { id: "", on: "2026-11-01" },
        "x",
      ],
    });
    expect(list).toEqual([{ id: "a", on: "2026-11-09", shared: { talked: "話", decided: "", todo: "やる" }, fpOnly: { note: "メモ", insurance: { initial: "y", final: "", reason: "" } }, snapshot: "s1", by: "u1" }]);
    expect(readMeetings(null)).toEqual([]);
    expect(readMeetings({ records: "x" })).toEqual([]);
  });

  it("新しい順・前回の面談・外す", () => {
    const list = [newMeeting("2026-10-01", "a"), newMeeting("2026-11-09", "b"), newMeeting("2026-11-09", "c")];
    expect(sortedMeetings(list).map((m) => m.id)).toEqual(["c", "b", "a"]);
    expect(latestMeeting(list)?.id).toBe("c");
    expect(latestMeeting([])).toBeNull();
    expect(withoutMeeting(list, "b").map((m) => m.id)).toEqual(["a", "c"]);
  });

  it("事務所で共有しているときは書いた人・最後に直した人を残す（メモの行ごとの書いた人と同じ考え方。0023 の6）。共有していなければ付けない", () => {
    const m = { ...newMeeting("2026-11-09", "a"), shared: { talked: "話", decided: "", todo: "" } };
    const one = putMeeting([], m, "u1");
    expect(one[0]).toMatchObject({ by: "u1" });
    expect(one[0]!.editedBy).toBeUndefined();
    // 書いた人が直しても、直した人は付けない
    expect(putMeeting(one, { ...one[0]!, shared: { ...m.shared, decided: "決" } }, "u1")[0]!.editedBy).toBeUndefined();
    const two = putMeeting(one, { ...one[0]!, shared: { ...m.shared, decided: "決" } }, "u2");
    expect(two[0]).toMatchObject({ by: "u1", editedBy: "u2" });
    // 画面から届いた書いた人は使わない（前の記録のまま）
    expect(putMeeting(two, { ...two[0]!, by: "偽" }, "u2")[0]!.by).toBe("u1");
    const plain = putMeeting([], m, null);
    expect(plain[0]!.by).toBeUndefined();
    expect(plain[0]!.editedBy).toBeUndefined();
  });
});

describe("世帯ファイルの本文の区画 meetings（形式 0.74）", () => {
  it("形式の版は 0.74", () => {
    expect(BODY_FORMAT_VERSION).toBe("0.77");
  });

  it("保存→読み込みで同じ。household の区画には書かない。記録が無ければ区画を作らない", () => {
    const list = markedMeetings();
    const s = state(withMeetings(wh0(), list));
    const obj = bodyObject(s) as unknown as { meetings?: { version: number; records: Meeting[] }; household: Record<string, unknown> };
    expect(obj.meetings).toEqual({ version: 1, records: list });
    expect(obj.household.meetings).toBeUndefined();
    const back = fromBody(bodyOf(s));
    expect(back.wh.meetings).toEqual(list);
    expect(bodyObject(back)).toEqual(bodyObject(s));
    expect((bodyObject(state(wh0())) as unknown as Record<string, unknown>).meetings).toBeUndefined();
    expect(fromBody(bodyOf(state(wh0()))).wh.meetings).toBeUndefined();
    // household の区画に紛れた欄は読まない
    const odd = JSON.parse(bodyOf(state(wh0()))) as { household: Record<string, unknown> };
    odd.household.meetings = list;
    expect(fromBody(JSON.stringify(odd)).wh.meetings).toBeUndefined();
  });

  it("事務所の共有の分岐で「両方を残す」: 相手の記録を土台に、こちらにだけある記録を足す。両方で直した記録は、こちらの分を写しにして足す", () => {
    const base = withMeetings(wh0(), [{ ...newMeeting("2026-10-01", "m-1"), shared: { talked: "共通", decided: "", todo: "" } }]);
    const theirs = withMeetings(base, [...(base.meetings ?? []), { ...newMeeting("2026-11-01", "m-t"), shared: { talked: "相手", decided: "", todo: "" } }]);
    const ours = withMeetings(base, [{ ...base.meetings![0]!, shared: { talked: "共通（こちらで直した）", decided: "", todo: "" } }, { ...newMeeting("2026-11-02", "m-o"), shared: { talked: "こちら", decided: "", todo: "" } }]);
    let i = 0;
    const m = mergeForkBodies(bodyOf(state(theirs)), bodyOf(state(ours)), () => `new${++i}`);
    const got = fromBody(m.body).wh.meetings ?? [];
    expect(got.map((x) => [x.id, x.shared.talked])).toEqual([
      ["m-1", "共通"],
      ["m-t", "相手"],
      ["new1", "共通（こちらで直した）"],
      ["m-o", "こちら"],
    ]);
    // 同じなら足さない。どちらにも無ければ区画を作らない
    expect(mergeMeetingSections({ records: [{ id: "a" }] }, { records: [{ id: "a" }] }, () => "z").added).toBe(0);
    expect((JSON.parse(mergeForkBodies(bodyOf(state(wh0())), bodyOf(state(wh0())), () => "z").body) as Record<string, unknown>).meetings).toBeUndefined();
  });

  it("控えの写しに面談の記録は入らず、控えを作っても・控えを持ち越しても記録は消えない", async () => {
    const wh = withMeetings(wh0(), markedMeetings());
    const snap = await makeSnapshot({ wh, drafts: {}, draft: { trigger: "manual", memo: "面談の記録（2026年11月9日）", plan: null }, appVersion: "0.1.0" });
    expect(JSON.stringify(snap)).not.toContain("MEETING-MARK");
    const withSnap = { ...wh, snapshots: [snap] };
    // 元に戻す・やり直すで控えを持ち越す（keepSnapshots）ときも、面談の記録はその状態のまま
    const back = keepSnapshots({ ...withSnap, snapshots: [] }, withSnap);
    expect(back.meetings).toEqual(wh.meetings);
    expect(fromBody(bodyOf(state(withSnap))).wh.meetings).toEqual(wh.meetings);
  });

  it("ヒアリングの取り込み（承認）でも面談の記録は消えない", async () => {
    const SIMPLE = new Uint8Array(readFileSync(join(REPO_DIR, "hearing", "samples", "basic-2-sample.xlsx")));
    const wh = withMeetings(wh0(), markedMeetings());
    let n = 0;
    const r = await importSheet(SIMPLE, wh, () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`);
    if (!r.ok) throw new Error(JSON.stringify(r.issues));
    const out = applyImport(wh, r.view, new Set(r.view.candidates.map((c) => c.id)), approvalTime(new Date(2026, 10, 9, 10, 0, 0)));
    expect(out.wh.meetings).toEqual(wh.meetings);
  });

  it("元に戻すの知らせの名前は「面談の履歴」", () => {
    const a = { wh: wh0(), work: { band: [], base: CURRENT, sel: CURRENT, drafts: {} }, settings: DEFAULT_DISPLAY_SETTINGS, bs: DEFAULT_BALANCE_SETTINGS };
    const b = { ...a, wh: withMeetings(a.wh, markedMeetings()) };
    expect(describeSnap(a, b, { control: null, dialog: null })).toBe("面談の履歴");
  });
});

describe("FP のメニューのメモ・面談の履歴（0016・0077 の追記・0182）", () => {
  it("メモは上の帯のボタンをやめ、FP のメニューの最初の見出しに。件数は行の横に。面談の履歴の件数と前回の日", () => {
    const g = fpMenuGroups({ notes: { memo: 3, meetings: 2, last: "2026年11月9日" }, snapshots: 1, review: null, imports: null, office: null });
    expect(g[0]!.id).toBe("notes");
    expect(g[0]!.label).toBe("メモ・面談の履歴");
    expect(g[0]!.items.map((i) => [i.action, i.label, i.note])).toEqual([
      ["memo", "メモ", "3件"],
      ["meetings", "面談の履歴（2件）", "前回 2026年11月9日"],
    ]);
    const none = fpMenuGroups({ notes: { memo: 0, meetings: 0, last: null }, snapshots: 0, review: null, imports: null, office: null });
    expect(none[0]!.items.map((i) => [i.label, i.note])).toEqual([
      ["メモ", "まだありません"],
      ["面談の履歴（0件）", undefined],
    ]);
  });

  it("上の帯にメモのボタンを置かない（App.tsx に memo-btn が無い）", () => {
    const src = readFileSync(join(REPO_DIR, "app", "src", "workspace", "App.tsx"), "utf8");
    expect(src).not.toContain('class="memo-btn"');
    expect(src).not.toContain("data-memo-toggle");
  });
});

describe("面談の履歴の画面", () => {
  const wh = withMeetings(wh0(), markedMeetings());
  const props = { wh, onSave: noop, onClose: noop, result: null, onOpen: noop };

  it("一覧: 新しい順に日と要点。名前・連絡先の欄は無い", () => {
    const html = renderToString(h(MeetingTools, props));
    expect(html).toContain("data-meeting-list");
    expect(html.indexOf("2026年11月9日")).toBeLessThan(html.indexOf("2026年10月1日"));
    expect(html).not.toMatch(/お名前|連絡先の欄|電話/);
  });

  it("1件を開く: お客さまと見てよい欄・FP だけの欄・保険の意向（置いた側に）。控えをつないでいなければそう書く", () => {
    const html = renderToString(h(MeetingTools, { ...props, focus: { id: "m-1", n: 1 } }));
    expect(html).toContain('data-meeting-view="m-1"');
    expect(html).toContain(`${"MEETING-MARK"}-shared-decided`);
    expect(html).toContain(`${"MEETING-MARK"}-fponly-note`);
    expect(html).toContain(`${"MEETING-MARK"}-intent-initial`);
    expect(html).toContain("控えをつないでいません");
    const fp = renderToString(h(MeetingTools, { ...props, focus: { id: "m-2", n: 1 } }));
    // FP だけにした意向は FP だけの欄の中
    const at = fp.indexOf("data-meeting-fp");
    expect(at).toBeGreaterThan(0);
    expect(fp.indexOf("MEETING-MARK-fpintent")).toBeGreaterThan(at);
  });

  it("FP だけの欄を隠す（お客さまと一緒に見るとき）: FP のメモと FP だけにした意向が画面に出ない", () => {
    for (const id of ["m-1", "m-2"]) {
      const html = renderToString(h(MeetingTools, { ...props, focus: { id, n: 1 }, initialHideFp: true }));
      expect(html).not.toContain("fponly");
      expect(html).not.toContain("MEETING-MARK-fpintent");
      expect(html).not.toContain("data-meeting-fp");
    }
    expect(renderToString(h(MeetingTools, { ...props, initialHideFp: true }))).not.toContain("fponly");
  });

  it("書いた人（事務所で共有しているとき）", () => {
    const by = withMeetings(wh0(), [{ ...markedMeetings()[0]!, by: "u1", editedBy: "u2" }]);
    const html = renderToString(h(MeetingTools, { ...props, wh: by, focus: { id: "m-1", n: 1 }, names: { u1: "担当A", u2: "担当B" } }));
    expect(html).toContain("書いた人 担当A");
    expect(html).toContain("最後に直した人 担当B");
  });

  it("つないだ控えがあれば、その日の控えを並べる（控えの時点の見込み・今の見込み・入力の違い）", async () => {
    const snap = await makeSnapshot({ wh: wh0(), drafts: {}, draft: { trigger: "manual", memo: "面談の記録", plan: null }, appVersion: "0.1.0" });
    const linked = { ...withMeetings(wh0(), [{ ...markedMeetings()[0]!, snapshot: snap.id }]), snapshots: [snap] };
    const html = renderToString(h(MeetingTools, { ...props, wh: linked, focus: { id: "m-1", n: 1 } }));
    expect(html).toContain("data-fp-review-figures");
    expect(html).toContain("控えの時点の見込み");
    expect(html).toContain("入力の違い");
    const gone = renderToString(h(MeetingTools, { ...props, wh: { ...linked, snapshots: [] }, focus: { id: "m-1", n: 1 } }));
    expect(gone).toContain("つないだ控えは外されています");
  });

  it("前回から変わったことから前回の面談の記録に飛べる（比較する控えをつないだ記録があればその記録）", async () => {
    const snap = await makeSnapshot({ wh: wh0(), drafts: {}, draft: { trigger: "manual", memo: "", plan: null }, appVersion: "0.1.0" });
    const list = [{ ...markedMeetings()[0]!, snapshot: snap.id }, markedMeetings()[1]!];
    expect(meetingForReview(list, snap.id)?.id).toBe("m-1");
    expect(meetingForReview(list, null)?.id).toBe("m-2");
    expect(meetingForReview([], null)).toBeNull();
    const w = { ...withMeetings(wh0(), list), snapshots: [snap] };
    const html = renderToString(h(FpTools, { wh: w, result: null, onOpen: noop, tool: "review", onTool: noop, bar: false, onMeeting: noop }));
    expect(html).toContain('data-fp-review-meeting="m-1"');
    expect(html).toContain("この控えの面談の記録を開く（2026年10月1日）");
    const plain = renderToString(h(FpTools, { wh: withMeetings(wh0(), list.slice(1)), result: null, onOpen: noop, tool: "review", onTool: noop, bar: false, onMeeting: noop }));
    expect(plain).toContain("前回の面談の記録を開く（2026年11月9日）");
    expect(renderToString(h(FpTools, { wh: wh0(), result: null, onOpen: noop, tool: "review", onTool: noop, bar: false, onMeeting: noop }))).not.toContain("data-fp-review-meeting");
  });
});


describe("見本にするときはメモと面談の履歴を外す（0182 の追記・0033）", () => {
  const withNotes = () => withMeetings({ ...wh0(), memo: ["お客さまのメモ"], memoBy: ["u1"] }, markedMeetings());

  it("外す物があるか・外した世帯（ほかの中身はそのまま）。外した世帯の本文には区画 meetings もメモも無い", () => {
    expect(hasNotes(wh0())).toBe(true);
    expect(hasNotes({ ...wh0(), memo: [] })).toBe(false);
    expect(hasNotes({ ...wh0(), memo: [], meetings: markedMeetings() })).toBe(true);
    const out = withoutNotes(withNotes());
    expect(out.memo).toEqual([]);
    expect(out.memoBy).toBeUndefined();
    expect(out.meetings).toBeUndefined();
    expect(out.request).toEqual(wh0().request);
    const body = bodyOf(state(out));
    expect(body).not.toContain("MEETING-MARK");
    expect(body).not.toContain("お客さまのメモ");
    expect((JSON.parse(body) as Record<string, unknown>).meetings).toBeUndefined();
  });

  const deps = (o: { open?: boolean; wh?: WorkingHousehold; writable?: boolean; saved?: boolean; opens?: boolean }) => {
    const calls: string[] = [];
    let isOpen = o.open ?? true;
    let cur: WorkingHousehold | null = o.wh ?? withNotes();
    const d: SampleNotesDeps = {
      isOpen: () => isOpen,
      open: async () => {
        calls.push("open");
        isOpen = o.opens ?? true;
        return isOpen;
      },
      current: () => cur,
      writable: () => o.writable ?? true,
      put: (wh) => {
        calls.push("put");
        cur = wh;
      },
      save: async () => {
        calls.push("save");
        return o.saved ?? true;
      },
      message: () => "読めません",
    };
    return { d, calls, cur: () => cur };
  };

  it("開いている世帯: 外して画面に入れ、すぐ保存してから見本にする", async () => {
    const t = deps({});
    expect(await stripNotesBeforeSample(t.d)).toBeNull();
    expect(t.calls).toEqual(["put", "save"]);
    expect(hasNotes(t.cur()!)).toBe(false);
  });

  it("開いていない世帯は先に開く。外す物が無ければ保存しない", async () => {
    const t = deps({ open: false, wh: { ...wh0(), memo: [] } });
    expect(await stripNotesBeforeSample(t.d)).toBeNull();
    expect(t.calls).toEqual(["open"]);
    expect(await stripNotesBeforeSample(deps({ open: false, opens: false }).d)).toBe("世帯を開けなかったので、見本にしていません");
  });

  it("書けない（ほかの人が開いている・読むだけ）・保存できなかったときは見本にしない（理由の文を返す）", async () => {
    const ro = deps({ writable: false });
    expect(await stripNotesBeforeSample(ro.d)).toBe("ほかの人が開いているため、メモと面談の履歴を外せません。見本にしていません");
    expect(ro.calls).toEqual([]);
    expect(await stripNotesBeforeSample(deps({ saved: false }).d)).toBe("メモと面談の履歴を外して保存できなかったので、見本にしていません");
  });

  it("画面の一言: 見本に登録するときの確認と、写して手直しするの説明。見本の写しを作るときも外す（App.tsx）", () => {
    expect(SAMPLE_NOTES_TEXT).toBe("メモと面談の履歴は外します（お客さまの記録を見本に残しません）。");
    const panel = readFileSync(join(REPO_DIR, "app", "src", "workspace", "store", "HouseholdPanel.tsx"), "utf8");
    expect(panel).toContain("data-make-sample-notes>{SAMPLE_NOTES_TEXT}");
    expect(panel).toContain("メモと面談の履歴は写しません");
    const app = readFileSync(join(REPO_DIR, "app", "src", "workspace", "App.tsx"), "utf8");
    expect(app).toMatch(/const strip = await stripNotesForSample\(id\);\s*if \(strip !== null\) return strip;\s*const err = await numberOp\(id, \(\) => host\.store\.makeSample/);
    expect(app).toContain("const stripped = dropNotesOnPersist({ toSample: sample !== undefined, stored: storedRef.current !== null, appSample: o0.demo !== null }, o0.wh);");
  });
});

describe("アプリに入っている見本の世帯から顧客を作るときは、見本のメモ（例の文）を写さない（0182 の追記）", () => {
  const memo = { ...wh0(), memo: ["退職金は規程の確認待ち（架空の例）"] };
  it("アプリの見本（保存していない）から顧客を作る: 外す。自分で作った見本（保存した見本）から・空の世帯・外す物が無いとき: 外さない。見本の写しを作る: 外す", () => {
    expect(dropNotesOnPersist({ toSample: false, stored: false, appSample: true }, memo)).toBe(true);
    expect(dropNotesOnPersist({ toSample: false, stored: true, appSample: true }, memo)).toBe(false);
    expect(dropNotesOnPersist({ toSample: false, stored: false, appSample: false }, memo)).toBe(false);
    expect(dropNotesOnPersist({ toSample: false, stored: false, appSample: true }, { ...memo, memo: [] })).toBe(false);
    expect(dropNotesOnPersist({ toSample: true, stored: true, appSample: false }, memo)).toBe(true);
    expect(dropNotesOnPersist({ toSample: true, stored: false, appSample: true }, { memo: [], meetings: markedMeetings() })).toBe(true);
  });

  it("アプリの見本の世帯はメモ（例の文）を持つ。外すと、作る顧客の本文にメモも面談の履歴も入らない", () => {
    const demo = DEMO_HOUSEHOLDS.find((d) => d.memo.length > 0);
    expect(demo).toBeDefined();
    const wh = fromRequest(modelHousehold(demo!.id), { memo: [...demo!.memo] });
    expect(dropNotesOnPersist({ toSample: false, stored: false, appSample: true }, wh)).toBe(true);
    const body = bodyOf(state(withoutNotes(wh)));
    for (const line of demo!.memo) expect(body).not.toContain(line);
  });

  it("画面の一言（アプリの見本から顧客を作るときだけ）", () => {
    expect(APP_SAMPLE_MEMO_TEXT).toBe("見本のメモ（例の文）は写しません");
    const panel = readFileSync(join(REPO_DIR, "app", "src", "workspace", "store", "HouseholdPanel.tsx"), "utf8");
    expect(panel).toContain('{s.kind === "app" ? `。${APP_SAMPLE_MEMO_TEXT}` : ""}');
    const app = readFileSync(join(REPO_DIR, "app", "src", "workspace", "App.tsx"), "utf8");
    expect(app).toContain('{...(sampleItem.kind === "app" ? { title: APP_SAMPLE_MEMO_TEXT } : {})} data-band-customer');
    expect(app).toContain('として保存しました${stripped ? "（見本のメモは写していません）" : ""}');
  });
});
