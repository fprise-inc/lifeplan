// 自分で作った見本の「最初の状態」（0247 の6。作る順の5段目）: 一覧の行と帯の「最初の状態に戻す」「今の状態を最初の状態にする」、
// 確認画面の文、保存の答えの「変わっている」を画面に入れる流れ、戻す・今の状態を最初の状態にする前に保存していない変更を先に保存すること、
// 開いただけでは最初の状態から変わったことにならない境目（計算基準月が1〜3月・誕生月・入れ方の違い）を確かめる
import { readFileSync } from "node:fs";
import { h } from "preact";
import { renderToString } from "preact-render-to-string";
import { describe, expect, it } from "vitest";
import type { StoredHousehold } from "../src/engine/host.ts";
import { fromRequest, type WorkingHousehold } from "../src/workspace/input/household.ts";
import { DEFAULT_FEATURES } from "../src/workspace/office/settings.ts";
import { NO_FEATURES } from "../src/workspace/office/featureCodes.ts";
import { CURRENT } from "../src/workspace/plans/band.ts";
import { SAMPLE_SETS, shownSampleSets } from "../src/workspace/samples/sets.ts";
import { DEFAULT_BALANCE_SETTINGS, DEFAULT_DISPLAY_SETTINGS } from "../src/workspace/settings.ts";
import { Autosaver, type SaveState } from "../src/workspace/store/autosave.ts";
import { bodyOf, EMPTY_CARRY, fromBody, type BodyState } from "../src/workspace/store/body.ts";
import { HouseholdPanel, STORE_MESSAGES, type HouseholdPanelProps } from "../src/workspace/store/HouseholdPanel.tsx";
import { shelfItems, type ShelfSet } from "../src/workspace/store/numbering.ts";
import { OWN_SAMPLE_RESET_TEXT, SAMPLE_RESET_TEXT, SAMPLE_SET_INITIAL_TEXT, SampleResetDialog, SampleSetInitialDialog } from "../src/workspace/store/SampleDialogs.tsx";
import { sameBodyContent } from "../src/workspace/undo/reopen.ts";
import { modelHousehold } from "./helpers.ts";

const APP = readFileSync(new URL("../src/workspace/App.tsx", import.meta.url), "utf8");
const HOST = readFileSync(new URL("../src/engine/host.ts", import.meta.url), "utf8");

const SHOWN = shownSampleSets(SAMPLE_SETS, NO_FEATURES, DEFAULT_FEATURES);
const BASIC = SAMPLE_SETS.find((s) => s.id === "official.basic") as ShelfSet;
const first = BASIC.samples[0]!;

/** 見本の棚の保存した見本（changed は最初の状態から変わっているか。origin つきはセットの見本を直した版） */
const stored = (id: string, name: string, o: { changed?: boolean; origin?: { set: string; id: string }; group?: string } = {}): StoredHousehold => ({
  id,
  customerNo: "",
  summary: "本人",
  createdAt: "2026-11-20T00:00:00Z",
  updatedAt: "2026-11-25T00:00:00Z",
  updatedBy: null,
  openBy: [],
  forks: 0,
  sample: { name, traits: ["会社員"], family: 3, age: 4, ...(o.origin !== undefined ? { origin: { ...o.origin, rev: 1 } } : {}), ...(o.group !== undefined ? { group: o.group } : {}), ...(o.changed === true ? { changed: true } : {}) },
});

const base: HouseholdPanelProps = {
  status: { state: "ready", firstRun: false, recoveryAcknowledged: true, recoveryVerifiedAt: null, lastOpened: null, deletionsPending: 0, deletionsCompleted: 0 },
  unavailable: null,
  error: null,
  list: [],
  currentId: null,
  categories: [],
  shelf: shelfItems(
    SHOWN,
    [stored("e1", first.title, { origin: { set: "official.basic", id: first.id } }), stored("own-changed", "研修用・変えた", { changed: true }), stored("own-same", "研修用・そのまま"), stored("former", "前の版の見本", { origin: { set: "official.basic", id: "removedSample" } })],
    SAMPLE_SETS,
  ),
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
  onSetSampleInitial: () => undefined,
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

describe("一覧の行（0247 の6）", () => {
  it("自分で作った見本で最初の状態から変わっている行だけ「最初の状態に戻す」と「今の状態を最初の状態にする」。変わっていない行には出さない", () => {
    const html = renderToString(h(HouseholdPanel, base));
    const changed = rowOf(html, "own-changed");
    expect(changed).toContain('data-reset-sample="own-changed"');
    expect(changed).toContain('data-set-sample-initial="own-changed"');
    expect(changed).toContain("今の状態を最初の状態にする");
    // 名前の右に「変えた内容あり」（セットの見本を直した版と同じ印）。変わっていない行には出さない
    expect(changed).toContain("data-sample-changed");
    const same = rowOf(html, "own-same");
    expect(same).not.toContain("data-reset-sample");
    expect(same).not.toContain("data-set-sample-initial");
    expect(same).not.toContain("data-sample-changed");
    // セットの見本を直した版は「最初の状態に戻す」だけ（最初の状態はアプリの中の見本。今の状態を最初の状態にはできない）
    const edited = rowOf(html, first.id);
    expect(edited).toContain(`data-reset-sample="${first.id}"`);
    expect(edited).not.toContain("data-set-sample-initial");
    // セットの定義から無くなった見本の直した版（前の版）は、どちらも出さない
    const former = rowOf(html, "former");
    expect(former).not.toContain("data-reset-sample");
    expect(former).not.toContain("data-set-sample-initial");
    // 本体の一覧の changed が、そのまま行に入る
    expect(base.shelf.find((i) => i.id === "own-changed")?.changed).toBe(true);
    expect(base.shelf.find((i) => i.id === "own-same")?.changed).toBeUndefined();
  });
  it("見本のグループ（欄だけ。画面はまだ出さない）: グループがあっても「自分で作った見本」の所に並び、名前は出さない", () => {
    const shelf = shelfItems(SHOWN, [stored("g1", "グループに入った見本", { group: "セミナー用" })], SAMPLE_SETS);
    const item = shelf.find((i) => i.id === "g1")!;
    expect(item.kind).toBe("own");
    const html = renderToString(h(HouseholdPanel, { ...base, shelf }));
    expect(rowOf(html, "g1")).not.toContain("セミナー用");
    expect(html).not.toContain("セミナー用");
    expect(HOST).toContain("group?: string;");
  });
});

describe("確認画面（0247 の6）", () => {
  it("自分で作った見本を戻す確認画面: 「取り消せません」の代わりに、戻す前の中身が直前の世代に1つだけ残ること（次に保存すると入れ替わる）を書く", () => {
    expect(OWN_SAMPLE_RESET_TEXT).toBe(
      "この見本を最初の状態（見本に登録・複製したとき、または「今の状態を最初の状態にする」を押したときの中身）に戻します。直した中身（プラン・控え・面談の履歴・メモ・読み取った書類）は消えます。戻す前の中身は、直前の世代として1つだけ残ります（次に保存すると入れ替わります）。残したいときは、先に「複製する」で別の見本にしてください。",
    );
    expect(OWN_SAMPLE_RESET_TEXT).not.toContain("取り消せません");
    const own = renderToString(h(SampleResetDialog, { name: "研修用", own: true, busy: false, error: null, onChoose: () => undefined }));
    expect(own).toContain("見本「研修用」を最初の状態に戻す");
    expect(own).toContain(OWN_SAMPLE_RESET_TEXT);
    expect(own).toContain("この見本の最初の状態の中身に置き換えます");
    expect(own).not.toContain("<input");
    // セットの見本を直した版は今までの文
    const set = renderToString(h(SampleResetDialog, { name: first.title, busy: false, error: null, onChoose: () => undefined }));
    expect(set).toContain(SAMPLE_RESET_TEXT);
    expect(set).not.toContain(OWN_SAMPLE_RESET_TEXT);
    expect(APP).toContain('own={sampleReset.item.kind === "own"}');
  });
  it("今の状態を最初の状態にする確認画面: 中身は変えない・今までの最初の状態には戻せなくなる", () => {
    expect(SAMPLE_SET_INITIAL_TEXT).toBe("この見本の今の中身を、最初の状態にします。これからは「最初の状態に戻す」を押すと、今の中身に戻ります。今までの最初の状態には戻せなくなります。");
    const html = renderToString(h(SampleSetInitialDialog, { name: "研修用", busy: false, error: "書けません", onChoose: () => undefined }));
    expect(html).toContain("見本「研修用」の今の状態を最初の状態にする");
    expect(html).toContain('data-choice="set"');
    expect(html).toContain('data-choice="cancel"');
    expect(html).toContain("見本の中身は変えません");
    expect(html).toContain("書けません");
  });
  it("最初の状態を今の版に直せないとき・変わっていないときの文", () => {
    expect(STORE_MESSAGES.E_STORE_SAMPLE_INITIAL).toBe("この見本の最初の状態を、この版のアプリで読める形に直せなかったため、戻していません（今の中身はそのままです）。アプリを更新してください");
    expect(STORE_MESSAGES.E_STORE_SAMPLE_NOT_CHANGED).toBe("この見本は最初の状態から変わっていません");
  });
});

describe("帯と流れ（0247 の6）", () => {
  it("帯: 自分で作った見本で最初の状態から変わっているときだけ、帯の中の押せるボタン「最初の状態に戻す」と「今の状態を最初の状態にする」", () => {
    expect(APP).toContain("const ownChangedOpen = storedSample !== undefined && storedSample.origin === undefined && storedSample.changed === true;");
    expect(APP).toMatch(/\{ownChangedOpen && storedInfo !== null \? \(\s*<>\s*<button type="button" class="btn small" onClick=\{\(\) => setSampleReset\([^\n]*\)\} data-band-reset>\s*最初の状態に戻す\s*<\/button>\s*<button type="button" class="link-btn" onClick=\{\(\) => setSampleSetInitial\([^\n]*\)\} data-band-set-initial>\s*今の状態を最初の状態にする\s*<\/button>/);
  });
  it("保存の答えの「変わっている」を、開いている世帯と見本の棚の一覧に入れる（帯と行のボタンが保存のたびにそろう）", () => {
    expect(HOST).toContain("sampleChanged?: boolean;");
    expect(APP).toContain("if (r.sampleChanged !== undefined) sampleChangedRef.current(sr.id, r.sampleChanged);");
    expect(APP).toContain("sampleChangedRef.current(id, r.sampleChanged ?? false);");
  });
  it("戻す・今の状態を最初の状態にする前に、保存していない変更を先に保存する。保存できなかったら止めずに知らせる（変更は残る。黙って捨てない）", () => {
    expect(APP).toContain("if (a.unsaved) throw a.failure ?? \"E_STORE\";");
    const reset = APP.slice(APP.indexOf("const chooseSampleReset = async"), APP.indexOf("const chooseSampleSetInitial = async"));
    expect(reset.indexOf("if (isOpen) paused = await saveAndPause();")).toBeGreaterThan(-1);
    expect(reset.indexOf("if (isOpen) paused = await saveAndPause();")).toBeLessThan(reset.indexOf("await host.store.sampleReset(id)"));
    // 戻した後は、戻した中身で開き直す（元に戻すの履歴は新しく始まる）
    expect(reset).toContain('if (out.kind === "restored") {');
    expect(reset).toContain("history.drop(`stored:${id}`);");
    expect(reset).toContain("if (isOpen) await loadStored(out.opened);");
    // 止める前に保存できなかったときは、自動保存を「保存済み」に戻さない（戻すと、保存していない変更を捨てたことになる）
    expect(reset).toContain("if (paused) {");
    const setInitial = APP.slice(APP.indexOf("const chooseSampleSetInitial = async"));
    expect(setInitial.indexOf("if (isOpen) paused = await saveAndPause();")).toBeLessThan(setInitial.indexOf("await host.store.sampleSetInitial(id)"));
  });
  it("自動保存: 保存に失敗した変更は flush の後も「保存していない」のまま（戻す前の確かめに使う）", async () => {
    const states: SaveState[] = [];
    let fail = true;
    const a = new Autosaver(
      async () => {
        if (fail) throw "E_STORE_IO";
        return "2026-11-26T00:00:00Z";
      },
      (s) => states.push(s),
      10,
    );
    a.reset("base");
    a.change("v1");
    await a.flush();
    expect(a.unsaved).toBe(true);
    expect(a.failure).toBe("E_STORE_IO");
    fail = false;
    await a.flush();
    expect(a.unsaved).toBe(false);
  });
});

describe("境目: 開いただけでは最初の状態から変わったことにならない（0247 の6）", () => {
  const state = (wh: WorkingHousehold, template = "sampleCoupleNoKids"): BodyState => ({ wh, workspace: { template, band: [], base: CURRENT, selected: CURRENT, shownItems: [] }, display: { result: DEFAULT_DISPLAY_SETTINGS, balance: DEFAULT_BALANCE_SETTINGS }, carry: EMPTY_CARRY });
  it("計算基準月が1〜3月・誕生月の前後でも、保存した本文を開いて書き直した本文は同じ中身（本体の比較で「変わっている」にならない）", () => {
    for (const baseMonth of ["2027-01", "2027-02", "2027-03", "2026-12", "2026-10"]) {
      const req = modelHousehold("sampleCoupleNoKids");
      const self = req.input.household.members.find((m) => m.kind === "self")!;
      const [, bm] = self.birth.birthYearMonth.split("-");
      for (const month of [baseMonth, `${baseMonth.slice(0, 4)}-${bm}`]) {
        const wh = fromRequest({ ...req, input: { ...req.input, baseMonth: month } }, { memo: [] });
        const saved = bodyOf(state(wh));
        const reopened = bodyOf(fromBody(saved));
        expect(sameBodyContent(saved, reopened), month).toBe(true);
      }
    }
  });
  it("入れ方の違い: つまみを動かしただけ（保存していないプランの変更）は本文に入らない。入力のパネルで直す・プランを保存する・表示の設定を変えると本文が変わる", () => {
    const wh = fromRequest(modelHousehold("sampleSingleParent"), { memo: [] });
    const saved = bodyOf(state(wh, "sampleSingleParent"));
    expect(sameBodyContent(saved, bodyOf(state(wh, "sampleSingleParent")))).toBe(true);
    const edited = { ...wh, request: { ...wh.request, input: { ...wh.request.input, household: { ...wh.request.input.household, members: wh.request.input.household.members.map((m, i) => (i === 0 ? { ...m, name: "直した" } : m)) } } } } as WorkingHousehold;
    expect(sameBodyContent(saved, bodyOf(state(edited, "sampleSingleParent")))).toBe(false);
    const withPlan = { ...wh, proposals: [...wh.proposals, { id: "p-new", name: "プランB", changes: [] }] } as unknown as WorkingHousehold;
    expect(sameBodyContent(saved, bodyOf(state(withPlan, "sampleSingleParent")))).toBe(false);
    expect(sameBodyContent(saved, bodyOf({ ...state(wh, "sampleSingleParent"), display: { result: { ...DEFAULT_DISPLAY_SETTINGS, atAge: 90 }, balance: DEFAULT_BALANCE_SETTINGS } }))).toBe(false);
  });
});
