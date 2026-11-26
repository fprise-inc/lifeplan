// 直せる見本（0247 の4・5・6。作る順の4段目）: セットの見本は最初に変えたときに直した版を作る・見るだけの開き方をやめる・
// セットの見本の「最初の状態に戻す」。見本の棚の並び（直した版・別の版・前の版・出していないセット）、帯の文とボタン、確認画面、
// 自動保存の流れ（作っている間の変更・作れなかったとき）、開いた直後の本文との比較の境目を確かめる
import { readFileSync } from "node:fs";
import { h } from "preact";
import { renderToString } from "preact-render-to-string";
import { describe, expect, it } from "vitest";
import type { StoredHousehold } from "../src/engine/host.ts";
import { fromRequest, type WorkingHousehold } from "../src/workspace/input/household.ts";
import { DEFAULT_FEATURES } from "../src/workspace/office/settings.ts";
import { keptSamplesText, NO_FEATURES } from "../src/workspace/office/featureCodes.ts";
import { CURRENT } from "../src/workspace/plans/band.ts";
import { SAMPLE_SETS, shownSampleSets } from "../src/workspace/samples/sets.ts";
import { DEFAULT_BALANCE_SETTINGS, DEFAULT_DISPLAY_SETTINGS } from "../src/workspace/settings.ts";
import { Autosaver, saveBeforeLeave, type SaveState, type Timers } from "../src/workspace/store/autosave.ts";
import { bodyOf, EMPTY_CARRY, type BodyState } from "../src/workspace/store/body.ts";
import { HouseholdPanel, copyRequest, STORE_MESSAGES, type HouseholdPanelProps } from "../src/workspace/store/HouseholdPanel.tsx";
import { LeaveDialog } from "../src/workspace/store/LeaveDialog.tsx";
import { editedCountsOf, shelfItemOf, shelfItems, type ShelfSet } from "../src/workspace/store/numbering.ts";
import { SAMPLE_BAND_TEXT, SAMPLE_CHANGED_MARK, SAMPLE_EDITABLE_NOTICE, SAMPLE_RESET_TEXT, SAMPLE_STALE_TEXT, SampleExistsDialog, SampleResetDialog } from "../src/workspace/store/SampleDialogs.tsx";
import { dropNotesOnPersist } from "../src/workspace/store/sampleNotes.ts";
import { sameBodyContent } from "../src/workspace/undo/reopen.ts";
import { modelHousehold } from "./helpers.ts";

const APP = readFileSync(new URL("../src/workspace/App.tsx", import.meta.url), "utf8");
const PANEL = readFileSync(new URL("../src/workspace/store/HouseholdPanel.tsx", import.meta.url), "utf8");

const SHOWN = shownSampleSets(SAMPLE_SETS, NO_FEATURES, DEFAULT_FEATURES);
const BASIC = SAMPLE_SETS.find((s) => s.id === "official.basic") as ShelfSet;
const OWNER = SAMPLE_SETS.find((s) => s.id === "official.corporateOwner") as ShelfSet;
const first = BASIC.samples[0]!;
const second = BASIC.samples[1]!;

/** 見本の棚の保存した見本（出どころつきは、セットの見本を直した版） */
const stored = (id: string, name: string, origin?: { set: string; id: string; rev?: number }, createdAt = "2026-11-20T00:00:00Z"): StoredHousehold => ({
  id,
  customerNo: "",
  summary: "本人",
  createdAt,
  updatedAt: "2026-11-25T00:00:00Z",
  updatedBy: null,
  openBy: [],
  forks: 0,
  sample: { name, traits: ["会社員"], family: 3, age: 4, ...(origin !== undefined ? { origin: { set: origin.set, id: origin.id, rev: origin.rev ?? 1 }, changed: true } : {}) },
});

describe("見本の棚の並び: セットの見本を直した版（0247 の5）", () => {
  it("直した版は、アプリの見本の行に入る（行を開くとその版が開く・「変えた内容あり」・最初の状態に戻せる）。直していない見本の行は今までどおり", () => {
    const shelf = shelfItems(SHOWN, [stored("e1", first.title, { set: "official.basic", id: first.id })], SAMPLE_SETS);
    const a = shelf.find((i) => i.kind === "app" && i.id === first.id)!;
    expect(a.edited).toEqual({ id: "e1", stale: false });
    expect(a.changed).toBe(true);
    expect(a.name).toBe(first.title);
    const b = shelf.find((i) => i.kind === "app" && i.id === second.id)!;
    expect(b.edited).toBeUndefined();
    expect(b.changed).toBeUndefined();
    // 直した版は「自分で作った見本」の所には出ない（行は増えない）
    expect(shelf.filter((i) => i.kind === "own")).toEqual([]);
    expect(shelf).toHaveLength(SHOWN.flatMap((s) => s.samples).length);
    expect(shelfItemOf(shelf, "e1")?.id).toBe(first.id);
  });
  it("セットの定義の中身の版（rev）が直した版の出どころの版より新しいときは「元の見本が新しくなっています」", () => {
    const sets = SHOWN.map((s) => ({ ...s, samples: s.samples.map((d) => (d.id === first.id ? { ...d, rev: 2 } : d)) }));
    const shelf = shelfItems(sets, [stored("e1", first.title, { set: "official.basic", id: first.id, rev: 1 })], sets);
    expect(shelf.find((i) => i.id === first.id)?.edited?.stale).toBe(true);
    expect(SAMPLE_STALE_TEXT).toBe("元の見本が新しくなっています（最初の状態に戻すと新しい中身になります）");
  });
  it("同じ出どころの版が2つ（同期の遅れ）: 作った日時の早い方を行に入れ、ほかは自分で作った見本の所に「（別の版）」で出す（消さない・最初の状態に戻すは出さない）", () => {
    const own = [stored("z-late", first.title, { set: "official.basic", id: first.id }, "2026-11-21T00:00:00Z"), stored("a-early", first.title, { set: "official.basic", id: first.id }, "2026-11-20T00:00:00Z")];
    const shelf = shelfItems(SHOWN, own, SAMPLE_SETS);
    expect(shelf.find((i) => i.id === first.id)?.edited?.id).toBe("a-early");
    const other = shelf.find((i) => i.id === "z-late")!;
    expect(other).toMatchObject({ kind: "own", name: `${first.title}（別の版）`, baseName: first.title, versionOf: "other" });
    expect(other.changed).toBeUndefined();
    // 作った日時が同じなら内部ID の小さい方
    const tie = shelfItems(SHOWN, [stored("b", first.title, { set: "official.basic", id: first.id }), stored("a", first.title, { set: "official.basic", id: first.id })], SAMPLE_SETS);
    expect(tie.find((i) => i.id === first.id)?.edited?.id).toBe("a");
    // 複製の名前は本体の名前から作る（「（別の版）」を名前に入れない）
    expect(copyRequest(other, [])?.name).toBe(`${first.title}（複製）`);
  });
  it("出していないセット（コードの無いときの法人経営者の見本）の直した版は出さない（消さない）。件数は数えて知らせに足す", () => {
    const owner = OWNER.samples[0]!;
    const own = [stored("o1", owner.title, { set: OWNER.id, id: owner.id })];
    const shelf = shelfItems(SHOWN, own, SAMPLE_SETS);
    expect(shelf.some((i) => i.id === "o1" || i.edited?.id === "o1")).toBe(false);
    expect(JSON.stringify(shelf)).not.toContain("法人経営者");
    expect(editedCountsOf(SAMPLE_SETS.filter((s) => s.feature !== undefined), own)).toEqual([{ name: "法人経営者の見本", count: 1 }]);
    expect(editedCountsOf(SAMPLE_SETS.filter((s) => s.feature !== undefined), [])).toEqual([]);
    expect(keptSamplesText([{ name: "法人経営者の見本", count: 1 }])).toBe("法人経営者の見本を直した版 1件も、消していません。");
    expect(keptSamplesText([])).toBe("");
    // コードがあれば、その行に入る
    const withCode = shelfItems(SAMPLE_SETS, own, SAMPLE_SETS);
    expect(withCode.find((i) => i.id === owner.id)?.edited?.id).toBe("o1");
  });
  it("セットの定義から無くなった見本の直した版は、自分で作った見本の所に出す（名前が重なるときだけ「（前の版）」）", () => {
    const gone = shelfItems(SHOWN, [stored("g1", "前にあった見本", { set: "official.basic", id: "sampleRemoved" }), stored("g2", second.title, { set: "official.retired", id: "x" })], SAMPLE_SETS);
    expect(gone.find((i) => i.id === "g1")).toMatchObject({ kind: "own", name: "前にあった見本", versionOf: "former" });
    expect(gone.find((i) => i.id === "g1")?.baseName).toBeUndefined();
    expect(gone.find((i) => i.id === "g2")).toMatchObject({ kind: "own", name: `${second.title}（前の版）`, baseName: second.title, versionOf: "former" });
  });
});

describe("世帯の一覧の見本の行と説明（0247 の4・6）", () => {
  const base: HouseholdPanelProps = {
    status: { state: "ready", firstRun: false, recoveryAcknowledged: true, recoveryVerifiedAt: null, lastOpened: null, deletionsPending: 0, deletionsCompleted: 0 },
    unavailable: null,
    error: null,
    list: [],
    currentId: null,
    categories: [],
    shelf: shelfItems(SHOWN, [stored("e1", first.title, { set: "official.basic", id: first.id }), stored("own-1", "研修用の見本")], SAMPLE_SETS),
    currentSample: null,
    currentShape: null,
    unsavedTitle: null,
    initialTab: "samples",
    onOpen: () => undefined,
    onCreate: () => undefined,
    onSaveCurrent: () => undefined,
    onRename: async () => null,
    onSetCategory: async () => null,
    onAssignSerial: async () => null,
    onMakeSample: async () => null,
    onSaveCategories: async () => null,
    onDelete: async () => null,
    onOpenSample: () => undefined,
    onResetSample: () => undefined,
    onCustomerFromSample: () => undefined,
    onCopySample: () => undefined,
    onUpdateSample: async () => null,
    onRecovery: () => undefined,
    onClose: () => undefined,
  };
  const rowOf = (html: string, id: string) => {
    const i = html.indexOf(`data-sample-row="${id}"`);
    expect(i, id).toBeGreaterThan(-1);
    return html.slice(i, html.indexOf("</tr>", i));
  };
  it("直した行には「変えた内容あり」と「最初の状態に戻す」。直していない行・最初の状態から変わっていない自分で作った見本には出さない。完全削除は自分で作った見本だけ", () => {
    const html = renderToString(h(HouseholdPanel, base));
    const edited = rowOf(html, first.id);
    expect(edited).toContain(`data-sample-edited="e1"`);
    expect(edited).toContain(SAMPLE_CHANGED_MARK);
    expect(edited).toContain(`data-reset-sample="${first.id}"`);
    expect(edited).toContain("最初の状態に戻す");
    expect(edited).not.toContain("data-delete-sample");
    const plain = rowOf(html, second.id);
    expect(plain).not.toContain(SAMPLE_CHANGED_MARK);
    expect(plain).not.toContain("data-reset-sample");
    const own = rowOf(html, "own-1");
    expect(own).not.toContain("data-reset-sample");
    expect(own).toContain('data-delete-sample="own-1"');
  });
  it("棚の説明は「直せません」「動かしても見本は変わりません」を言わず、変えた内容が残ることと「最初の状態に戻す」を言う", () => {
    const html = renderToString(h(HouseholdPanel, base));
    expect(html).not.toContain("直せません");
    expect(html).not.toContain("動かしても見本は変わりません");
    expect(html).not.toContain("閉じれば元どおり");
    expect(html).toContain("変えた内容はその見本に残ります（元の内容に戻すときは「最初の状態に戻す」）");
    // 事務所の共有では、直した内容が全員に出ることも
    const office = renderToString(h(HouseholdPanel, { ...base, officeState: "member", usage: "office" }));
    expect(office).toContain("はじめから入っている見本を直した内容は、事務所の全員に同じものが出ます。");
    expect(office).not.toContain("アプリに入っている見本");
    expect(STORE_MESSAGES.E_STORE_SAMPLE).not.toContain("直せません");
  });
  it("「見本は直せるようになりました」は、渡されたときだけ見本の所に出す（閉じるボタンつき）", () => {
    expect(SAMPLE_EDITABLE_NOTICE).toBe("見本は直せるようになりました。元に戻すときは「最初の状態に戻す」");
    expect(renderToString(h(HouseholdPanel, base))).not.toContain("data-sample-editable-notice");
    const html = renderToString(h(HouseholdPanel, { ...base, editableNotice: () => undefined }));
    expect(html).toContain(SAMPLE_EDITABLE_NOTICE);
    expect(html).toContain("data-sample-editable-close");
    // 前の版を使っていた人にだけ（はじめて使う人は初めての起動で閉じた印を付ける）
    expect(APP).toContain("const sampleEditableNotice = noticeLocalLoaded && storeStatus?.state === \"ready\" && !firstRun && noticeLocal.read[SAMPLE_EDITABLE_NOTICE_KEY] === undefined;");
    expect(APP).toContain("if (noticeLocalLoaded && firstRun && noticeLocalRef.current.read[SAMPLE_EDITABLE_NOTICE_KEY] === undefined) updateLocal(");
  });
  it("別の版の完全削除の確かめは、本体の名前（「（別の版）」を付けない名前）を入れる", () => {
    const shelf = shelfItems(SHOWN, [stored("a", first.title, { set: "official.basic", id: first.id }), stored("b", first.title, { set: "official.basic", id: first.id }, "2026-11-22T00:00:00Z")], SAMPLE_SETS);
    expect(PANEL).toContain("確認のため見本の名前（{s.baseName ?? s.name}）を入れてください");
    expect(PANEL).toContain("sampleNameKey(sampleDelete.value) !== sampleNameKey(s.baseName ?? s.name)");
    expect(shelf.find((i) => i.id === "b")?.baseName).toBe(first.title);
  });
});

describe("見本の帯（2026-11-25 の利用者の判断の文とボタン）", () => {
  it("帯の文は決まった文。直していない見本でも同じ文。「最初の状態に戻す」のボタンは、直した版を開いているときだけ帯の中に出す", () => {
    expect(SAMPLE_BAND_TEXT).toBe("数字を変えると、変えた内容はこの見本に残ります。元の内容に戻したいときは「最初の状態に戻す」を押してください。");
    expect(APP).toContain("（{shapeText(sampleItem.family, sampleItem.age)}・架空）を開いています。{SAMPLE_BAND_TEXT}");
    expect(APP).toMatch(/\{editedOpen \? \(\s*<button type="button" class="btn small" onClick=\{\(\) => setSampleReset\([^\n]*\)\} data-band-reset>\s*最初の状態に戻す\s*<\/button>\s*\) : null\}/);
    // 戻すのは開いている直した版（棚の一覧が古くても、開いている版の内部ID で戻す）。同じ出どころの2つ目の版には出さない
    expect(APP).toContain("edited: { id: storedInfo.id, stale: sampleItem.edited?.stale ?? false }");
    expect(APP).toContain("const editedOpen = storedSample?.origin !== undefined && sampleItem?.versionOf === undefined;");
    // 「複製する」はどの見本にも出す（前は直している間は出さなかった）
    expect(APP).toMatch(/data-band-copy>\s*複製する\s*</);
    for (const w of ["この見本を直す", "動かしても見本は変わりません", "「最初に戻す」も使えます", "data-band-edit", "sampleMode", "見本は開くたびに最初の中身から始まります"]) expect(APP, w).not.toContain(w);
  });
  it("最初の状態に戻す確認画面: 決まった文・ボタン。名前を打つ確かめは付けない", () => {
    expect(SAMPLE_RESET_TEXT).toBe("この見本を最初の状態に戻します。直した中身（プラン・控え・面談の履歴・メモ・読み取った書類）は消えます。取り消せません。残したいときは、先に「複製する」で自分の見本にしてください。");
    const html = renderToString(h(SampleResetDialog, { name: first.title, busy: false, error: null, onChoose: () => undefined }));
    expect(html).toContain(`見本「${first.title}」を最初の状態に戻す`);
    expect(html).toContain(SAMPLE_RESET_TEXT);
    expect(html).toContain('data-choice="reset"');
    expect(html).toContain('data-choice="cancel"');
    expect(html).not.toContain("<input");
  });
  it("ほかの人が先に直していたときに選ぶ画面: 先にある版を開く・今の中身を複製する・あとで選ぶ（今の変更は黙って捨てない）", () => {
    const html = renderToString(h(SampleExistsDialog, { name: first.title, by: "担当B", busy: false, error: null, onChoose: () => undefined }));
    expect(html).toContain("担当Bさんが先にこの見本を直して保存していたため");
    for (const c of ["open", "copy", "later"]) expect(html).toContain(`data-choice="${c}"`);
    expect(html).toContain("この画面で変えた内容は残りません");
    const anon = renderToString(h(SampleExistsDialog, { name: first.title, by: null, busy: false, error: null, onChoose: () => undefined }));
    expect(anon).toContain("ほかの人（ほかの PC）が先に");
  });
  it("離れる前の確かめ: ほかの人が先に直していたときは「保存し直す」の代わりに「どうするか選ぶ」。見出しは見本の名前", () => {
    const html = renderToString(h(LeaveDialog, { customerNo: "", label: `見本「${first.title}」`, code: "E_STORE_SAMPLE_EXISTS", action: "switch", busy: false, error: null, message: (c) => STORE_MESSAGES[c] ?? c, onChoose: () => undefined }));
    expect(html).toContain(`見本「${first.title}」の変更を保存できていません`);
    expect(html).toContain('data-choice="fork"');
    expect(html).toContain("どうするか選ぶ");
    expect(html).not.toContain('data-choice="retry"');
    expect(html).toContain("ほかの人が先にこの見本を直した版があります");
  });
  it("開発用の入口（#household=・#selfcheck・#seed・#documents=）で開いた見本は、変えても直した版を作らない", () => {
    expect(APP).toContain("const dev = initial.household !== undefined || initial.selfcheck || initial.seed === true || initial.documents !== undefined;");
    expect(APP).toContain("else void open(id, initial.levers, dev);");
    expect(APP).toContain("const set = o.demo !== null && !dev ? setOfSample(o.demo.id) : undefined;");
  });
  it("直した版・セットの見本から顧客を作るときは、メモと面談の履歴を写さない（直した版でも同じ。0182 の追記）", () => {
    const wh = { memo: ["例の文"], meetings: [] };
    expect(dropNotesOnPersist({ toSample: false, setSample: true }, wh)).toBe("notes");
    expect(dropNotesOnPersist({ toSample: false, setSample: false }, wh)).toBeNull();
  });
});

/** 手で進める時計（自動保存の待ちを、テストの中で押して進める） */
function manualTimers(): Timers & { fire: () => void } {
  let pending: (() => void) | null = null;
  return {
    set: (fn) => {
      pending = fn;
      return 1;
    },
    clear: () => {
      pending = null;
    },
    fire: () => {
      const f = pending;
      pending = null;
      f?.();
    },
  };
}

const settle = () => new Promise((r) => setTimeout(r, 0));

describe("最初に変えたときに直した版を作る（自動保存の流れ。0247 の5・0096）", () => {
  /** 画面と同じ形: 直した版が無いあいだは「作る」、できた後は「保存する」。作るのに時間がかかる間の変更も受ける */
  function harness(createResult: () => Promise<string>) {
    const calls: { kind: "create" | "save"; body: string }[] = [];
    let id: string | null = null;
    const states: SaveState[] = [];
    let release: (() => void) | null = null;
    const timers = manualTimers();
    const a = new Autosaver(
      async (body) => {
        if (id === null) {
          calls.push({ kind: "create", body });
          await new Promise<void>((r) => {
            release = r;
          });
          id = await createResult();
          return "2026-11-26T00:00:00Z";
        }
        calls.push({ kind: "save", body });
        return "2026-11-26T00:00:01Z";
      },
      (s) => states.push(s),
      10,
      timers,
    );
    return { a, calls, states, timers, release: () => release?.(), id: () => id };
  }
  it("開いた直後の本文と同じなら作らない。変えたら1回だけ作り、作っている間の変更は、できた後の最初の保存に入れる", async () => {
    const t = harness(async () => "e1");
    t.a.reset("base");
    t.a.change("base");
    t.timers.fire();
    await settle();
    expect(t.calls).toEqual([]);
    t.a.change("v1");
    t.timers.fire();
    await settle();
    expect(t.calls).toEqual([{ kind: "create", body: "v1" }]);
    // 作っている間にもう1つ変える
    t.a.change("v2");
    t.release();
    await settle();
    await settle();
    t.timers.fire();
    await settle();
    expect(t.calls).toEqual([
      { kind: "create", body: "v1" },
      { kind: "save", body: "v2" },
    ]);
    expect(t.a.unsaved).toBe(false);
  });
  it("作れなかったときは変更が残り（保存できていない）、離れる前に選ばせる。ほかの人が先に直していたら自動保存を止める（保存し直しても同じ）", async () => {
    const fail = harness(async () => {
      throw "E_STORE_SAMPLE_EXISTS";
    });
    fail.a.reset("base");
    fail.a.change("v1");
    fail.timers.fire();
    await settle();
    fail.release();
    await settle();
    await settle();
    expect(fail.a.unsaved).toBe(true);
    expect(fail.a.failure).toBe("E_STORE_SAMPLE_EXISTS");
    expect(fail.states.at(-1)).toEqual({ kind: "error", code: "E_STORE_SAMPLE_EXISTS" });
    // 止めたので、次の変更では作り直さない
    fail.a.change("v2");
    fail.timers.fire();
    await settle();
    expect(fail.calls).toHaveLength(1);
    // 離れる前: 黙って捨てず、選ばせる（ここでは「やめる」）
    const asked: string[] = [];
    expect(await saveBeforeLeave(fail.a, async (code) => (asked.push(code), "cancel"))).toBe(false);
    expect(asked).toEqual(["E_STORE_SAMPLE_EXISTS"]);
  });
  it("つまみを動かしただけ（保存していないプランの変更）は本文に入らないので作らない。入力のパネル・プランの保存・表示の設定の変更は本文が変わる", () => {
    const wh = fromRequest(modelHousehold("sampleDualAssetsInvest"), { memo: [] });
    const st = (w: WorkingHousehold, display = { result: DEFAULT_DISPLAY_SETTINGS, balance: DEFAULT_BALANCE_SETTINGS }): BodyState => ({ wh: w, workspace: { template: "sampleDualAssetsInvest", band: [], base: CURRENT, selected: CURRENT, shownItems: [] }, display, carry: EMPTY_CARRY });
    const base = bodyOf(st(wh));
    // 本文はプランの保存していない変更（work.drafts）を持たない（画面の bodyFor も渡さない）
    expect(APP).toContain("workspace: { template: o.demo?.id ?? null, band: w.band, base: w.base, selected: w.sel, shownItems: shownKeys }");
    expect(sameBodyContent(base, bodyOf(st(wh)))).toBe(true);
    // 入力のパネルで直した（現状が変わる）
    const edited = { ...wh, request: { ...wh.request, input: { ...wh.request.input, household: { ...wh.request.input.household, members: wh.request.input.household.members.map((m, i) => (i === 0 ? { ...m, name: "直した" } : m)) } } } };
    expect(sameBodyContent(base, bodyOf(st(edited as WorkingHousehold)))).toBe(false);
    // 表示の設定を変えた
    expect(sameBodyContent(base, bodyOf(st(wh, { result: { ...DEFAULT_DISPLAY_SETTINGS, atAge: 90 }, balance: DEFAULT_BALANCE_SETTINGS })))).toBe(false);
  });
  it("境目: 計算基準月が1〜3月・誕生月の前後でも、開いた直後の本文と同じ中身なら作らない（欄の並びの違いだけでは作らない）", () => {
    for (const baseMonth of ["2027-01", "2027-02", "2027-03", "2026-12", "2026-10"]) {
      const req = modelHousehold("sampleCoupleNoKids");
      const self = req.input.household.members.find((m) => m.kind === "self")!;
      const [, bm] = self.birth.birthYearMonth.split("-");
      for (const month of [baseMonth, `${baseMonth.slice(0, 4)}-${bm}`]) {
        const wh = fromRequest({ ...req, input: { ...req.input, baseMonth: month } }, { memo: [] });
        const st: BodyState = { wh, workspace: { template: "sampleCoupleNoKids", band: [], base: CURRENT, selected: CURRENT, shownItems: [] }, display: { result: DEFAULT_DISPLAY_SETTINGS, balance: DEFAULT_BALANCE_SETTINGS }, carry: EMPTY_CARRY };
        const body = bodyOf(st);
        // 欄の並びを変えた本文（本体が読み直して書いたときなど）も同じ中身
        const reordered = JSON.stringify(Object.fromEntries(Object.entries(JSON.parse(body) as Record<string, unknown>).reverse()));
        expect(sameBodyContent(body, reordered), month).toBe(true);
        expect(sameBodyContent(body, bodyOf({ ...st, wh: { ...wh, memo: ["足した"] } })), month).toBe(false);
      }
    }
  });
  it("画面: 直した版をまだ作っていない見本は、開いた直後と中身が同じなら開いた直後の本文を自動保存に渡す（作らない）", () => {
    expect(APP).toContain("autosaver.current?.change(sameBodyContent(b, p.base) ? p.base : b);");
    expect(APP).toContain("if (sr === null && o !== null && pendingSample.current !== null) return createEdited.current(body);");
    // 作れたら、保存した世帯に切り替える（画面は離れない・元に戻すの履歴は続ける）
    expect(APP).toContain("history.rename(`stored:${r.id}`);");
    expect(APP).toContain("sample: { name: d.title, traits: [...d.traits], family: d.family, age: d.age, origin: p.origin }");
  });
});
