// 世帯の一覧の行を1行にそろえる（0244）: 行に見せるのは「開く」（見本は「この見本をもとに顧客を作る」も）と「ほかの操作」だけ。
// ほかの操作は「ほかの操作」の中（閉じている間は hidden）。開いている行は「開く」の場所に「開いています」。見本の一覧に「アプリ」の印を出さない。
// 見本を写す操作の名前は「複製する」、名前に付けるのは「（複製）」。「ほかの操作」は Esc の受け手として重ねる（0239。上の1つだけ閉じる）
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { h } from "preact";
import { renderToString } from "preact-render-to-string";
import { describe, expect, it, vi } from "vitest";
import type { StoredHousehold } from "../src/engine/host.ts";
import { DEMO_HOUSEHOLDS } from "../src/workspace/catalog.ts";
import { COPY_SAMPLE_TITLE, HouseholdPanel, copyRequest, type HouseholdPanelProps } from "../src/workspace/store/HouseholdPanel.tsx";
import { DEFAULT_CATEGORIES, shelfItems } from "../src/workspace/store/numbering.ts";

/** 描いている間に重ねると言った Esc の受け手（出している物だけを見る。close-x.test.ts と同じ見方） */
const declared = vi.hoisted(() => ({ list: [] as { close: (() => void) | null; on: boolean }[] }));
vi.mock("../src/presentation/CloseX.tsx", async (original) => {
  const real = await original<typeof import("../src/presentation/CloseX.tsx")>();
  return { ...real, useEscClose: (close: (() => void) | null, on = true) => void declared.list.push({ close, on }) };
});

const src = join(dirname(fileURLToPath(import.meta.url)), "..", "src");
const read = (...p: string[]) => readFileSync(join(src, ...p), "utf8");

const row = (customerNo: string, label: Partial<StoredHousehold> = {}): StoredHousehold => ({ id: `id-${customerNo}`, customerNo, summary: "本人・配偶者", createdAt: "2026-11-01T00:00:00Z", updatedAt: "2026-11-21T01:54:00Z", updatedBy: null, openBy: [], forks: 0, ...label });
const list = [row("A0042", { category: "A", serial: 42 }), row("A0042-1", { category: "A", serial: 42, branch: "1" }), row("K-2019-42", { category: "A" }), row("C0007", { category: "C", serial: 7, fictional: true })];
// 見本は番号を持たない（表示の番号は空。行の目印は見本の ID。0247）
const own = { ...row("", { sample: { name: "夫婦のみ・研修用", traits: [], family: 2, age: 3 } }), id: "own-1" };
const shelf = shelfItems(
  DEMO_HOUSEHOLDS.map((d) => ({ id: d.id, sampleNo: d.sampleNo, title: d.title, traits: d.traits })),
  [own],
);
const base: HouseholdPanelProps = {
  status: { state: "ready", firstRun: false, recoveryAcknowledged: true, recoveryVerifiedAt: null, lastOpened: null, deletionsPending: 0, deletionsCompleted: 0 },
  unavailable: null,
  error: null,
  list,
  currentId: null,
  categories: [...DEFAULT_CATEGORIES],
  shelf,
  currentSample: null,
  currentShape: null,
  unsavedTitle: null,
  onOpen: () => undefined,
  onCreate: () => undefined,
  onSaveCurrent: () => undefined,
  onRename: async () => null,
  onSetCategory: async () => null,
  onAssignSerial: async () => null,
  onMakeSample: async () => null,
  onMakeClient: async () => null,
  onSaveCategories: async () => null,
  onDelete: async () => null,
  onOpenSample: () => undefined,
  onCustomerFromSample: () => undefined,
  onCopySample: () => undefined,
  onUpdateSample: async () => null,
  onRecovery: () => undefined,
  onClose: () => undefined,
};

const render = (over: Partial<HouseholdPanelProps> = {}) => {
  declared.list = [];
  const html = renderToString(h(HouseholdPanel, { ...base, ...over }));
  return { html, esc: declared.list.filter((d) => d.on) };
};
/** 1行の HTML（data-household-row / data-sample-row の行） */
const rowHtml = (html: string, attr: string, no: string) => {
  const at = html.indexOf(`${attr}="${no}"`);
  if (at < 0) throw new Error(`行がありません: ${no}`);
  return html.slice(html.lastIndexOf("<tr", at), html.indexOf("</tr>", at));
};
/** 行の操作の欄のうち、「ほかの操作」の中を除いた、見えている物の名前（ボタンと「開いています」） */
const shown = (r: string) =>
  [...(r.slice(r.indexOf('class="pl-ops hh-ops"')).replace(/<span class="hh-more-list"[^>]*>[\s\S]*?<\/span><\/span>/g, "").matchAll(/>([^<>]+)<\/(button|span)>/g))].map((m) => m[1]);
/** 「ほかの操作」の中の物の名前（並びの順） */
const inside = (r: string) => {
  const m = /<span class="hh-more-list"[^>]*>([\s\S]*?)<\/span><\/span>/.exec(r);
  return m === null ? null : [...(m[1] ?? "").matchAll(/>([^<>]+)<\/button>/g)].map((x) => x[1]);
};
const moreHidden = (r: string) => /<span class="hh-more-list"[^>]*\shidden[\s>]/.test(r);

describe("顧客の一覧の行（0244）", () => {
  it("行に見せるのは「開く」と「ほかの操作」だけ。区分を変える・顧客番号を変える・見本に登録・完全削除は「ほかの操作」の中（閉じている）", () => {
    const { html } = render();
    const r = rowHtml(html, "data-household-row", "A0042");
    expect(shown(r)).toEqual(["開く", "ほかの操作"]);
    expect(inside(r)).toEqual(["区分を変える", "顧客番号を変える", "見本に登録", "完全削除"]);
    expect(moreHidden(r)).toBe(true);
    expect(r).toContain('aria-expanded="false"');
    // 「開く」は小さいボタン（ふつうの段）、完全削除は危ない段のリンク（0240）
    expect(r).toMatch(/<button type="button" class="btn small hh-open" data-open-household="A0042">開く<\/button>/);
    expect(r).toMatch(/class="link-btn danger" data-delete-household="A0042">完全削除</);
  });

  it("自由な番号の行は「通し番号を付ける」、架空の世帯の行は「お客さまの世帯にする」も「ほかの操作」の中。印（自由な番号・架空）は番号の右のまま", () => {
    const { html } = render();
    const free = rowHtml(html, "data-household-row", "K-2019-42");
    expect(shown(free)).toEqual(["開く", "ほかの操作"]);
    expect(inside(free)).toEqual(["区分を変える", "顧客番号を変える", "通し番号を付ける", "見本に登録", "完全削除"]);
    expect(free).toMatch(/<td><button[^>]*data-open-household-no="K-2019-42">K-2019-42<\/button><div class="hh-tags">.*自由な番号/);
    const fic = rowHtml(html, "data-household-row", "C0007");
    expect(inside(fic)).toEqual(["区分を変える", "顧客番号を変える", "お客さまの世帯にする", "見本に登録", "完全削除"]);
    expect(fic).toContain("data-household-fictional");
  });

  it("区分を使わないときは「区分を変える」が無い（ほかは同じ）", () => {
    const { html } = render({ categories: [], list: [row("0001", { serial: 1 })] });
    expect(inside(rowHtml(html, "data-household-row", "0001"))).toEqual(["顧客番号を変える", "見本に登録", "完全削除"]);
  });

  it("開いている世帯の行: 「開く」の場所に「開いています」（番号の右には出さない）。ほかの操作は同じ", () => {
    const { html } = render({ currentId: "id-A0042" });
    const r = rowHtml(html, "data-household-row", "A0042");
    expect(shown(r)).toEqual(["開いています", "ほかの操作"]);
    expect(r).toContain('<span class="hh-open hh-open-now" data-household-current="true">開いています</span>');
    expect(r).not.toContain('class="pl-tag">開いています');
    expect(r).toMatch(/<td><b>A0042<\/b><\/td>/);
    expect(inside(r)).toEqual(["区分を変える", "顧客番号を変える", "見本に登録", "完全削除"]);
    // ほかの行は「開く」のまま
    expect(shown(rowHtml(html, "data-household-row", "A0042-1"))).toEqual(["開く", "ほかの操作"]);
  });

  it("ほかの PC（ほかの人）が開いている行も同じ形（開いている人は別の列）。同期の衝突の写しは番号の欄のまま", () => {
    const shared = [row("A0042", { category: "A", serial: 42, openBy: [{ name: "担当B", since: "2026-11-21T00:00:00Z" }], updatedBy: "担当B", forks: 1 })];
    const { html } = render({ list: shared, officeState: "member", usage: "office" });
    const r = rowHtml(html, "data-household-row", "A0042");
    expect(shown(r)).toEqual(["開く", "ほかの操作"]);
    expect(r).toContain('data-household-presence="1"');
    expect(r).toMatch(/<td><button[^>]*data-open-household-no="A0042">A0042<\/button><button[^>]*data-household-forks="1"/);
  });

  it("「ほかの操作」を開いた行だけ中が見える（読み上げは開いている）。Esc の受け手として一覧の上に1つ重ね、閉じるのは「ほかの操作」だけ", () => {
    let closed = 0;
    const onClose = () => void closed++;
    const { html, esc } = render({ initialMore: "c:id-A0042", onClose });
    const r = rowHtml(html, "data-household-row", "A0042");
    expect(moreHidden(r)).toBe(false);
    expect(r).toContain('aria-expanded="true"');
    expect(r).toContain('class="link-btn hh-more-btn on"');
    expect(r).toMatch(/aria-controls="(hh-more-c_id-A0042)"[\s\S]*id="\1" role="group" aria-label="ほかの操作"/);
    expect(moreHidden(rowHtml(html, "data-household-row", "A0042-1"))).toBe(true);
    // 世帯の一覧と「ほかの操作」の2つ。「ほかの操作」の閉じる処理は、一覧を閉じない
    expect(esc).toHaveLength(2);
    expect(esc.filter((e) => e.close === onClose)).toHaveLength(1);
    const more = esc.find((e) => e.close !== onClose);
    expect(() => more?.close?.()).not.toThrow();
    expect(closed).toBe(0);
    // 閉じていれば、受け手は一覧の1つだけ
    expect(render().esc).toHaveLength(1);
  });

  it("開いている「ほかの操作」は一覧の中で1つだけ（状態は1つ）。タブを切り替える・中の操作を選ぶとたたむ", () => {
    const panel = read("workspace", "store", "HouseholdPanel.tsx");
    expect(panel).toContain("const [more, setMore] = useState<string | null>(p.initialMore ?? null);");
    expect(panel).toMatch(/const switchTab = \(t: HouseholdTab\) => \{\s*setMore\(null\);\s*setTab\(t\);/);
    expect(panel).not.toMatch(/onClick=\{\(\) => setTab\(/);
    // 「ほかの操作」の中の操作は、どれも pick（たたんでから進める）を通す
    const list = [...panel.matchAll(/<RowMore[\s\S]*?<\/RowMore>/g)].map((m) => m[0]);
    expect(list).toHaveLength(2);
    for (const m of list) {
      const clicks = [...m.matchAll(/onClick=\{([^}]*)/g)].map((x) => x[1] ?? "");
      expect(clicks.length).toBeGreaterThanOrEqual(3);
      for (const c of clicks) expect(c.startsWith("pick("), c).toBe(true);
    }
    // 外側を押すと閉じる（押した所が「ほかの操作」の中でなければ）
    expect(panel).toMatch(/document\.addEventListener\("click", outside, true\)/);
  });

  it("行の操作のフォーム（顧客番号を変える など）を出した行は、操作の代わりにフォーム（今までどおり）", () => {
    const panel = read("workspace", "store", "HouseholdPanel.tsx");
    expect(panel).toMatch(/\{rowForm\(h\) \?\? \(\s*<div class="pl-ops hh-ops">/);
  });
});

describe("見本の一覧の行（0244）", () => {
  it("行に見せるのは「開く」「この見本をもとに顧客を作る」「ほかの操作」。はじめから入っている見本の「ほかの操作」は「複製する」だけ", () => {
    const { html } = render({ initialTab: "samples" });
    const r = rowHtml(html, "data-sample-row", "salariedCoupleTwoKids");
    expect(shown(r)).toEqual(["開く", "この見本をもとに顧客を作る", "ほかの操作"]);
    expect(inside(r)).toEqual(["複製する"]);
    expect(moreHidden(r)).toBe(true);
    expect(r).toContain(`title="${COPY_SAMPLE_TITLE}" data-copy-sample="salariedCoupleTwoKids"`);
  });

  it("自分で作った見本の「ほかの操作」は 複製する・名前と項目を直す・完全削除（危ない段）", () => {
    const { html } = render({ initialTab: "samples" });
    const r = rowHtml(html, "data-sample-row", "own-1");
    expect(shown(r)).toEqual(["開く", "この見本をもとに顧客を作る", "ほかの操作"]);
    expect(inside(r)).toEqual(["複製する", "名前と項目を直す", "完全削除"]);
    expect(r).toMatch(/class="link-btn danger" data-delete-sample="own-1">完全削除</);
  });

  it("「アプリ」の印を出さない。開いている見本は「開く」の場所に「開いています」（番号の右には出さない）", () => {
    const { html } = render({ initialTab: "samples", currentSample: "salariedCoupleTwoKids" });
    expect(html).not.toContain("hh-app");
    expect(html).not.toMatch(/>アプリ<\/span>/);
    const r = rowHtml(html, "data-sample-row", "salariedCoupleTwoKids");
    // 見本番号の列は無い（行は名前から始まる。0247）
    expect(r).not.toContain("3-4-01");
    expect(r).toMatch(/<td class="hh-wrap"><span data-sample-name-cell[^>]*>会社員の夫婦と子2人<\/span><\/td>/);
    expect(shown(r)).toEqual(["開いています", "この見本をもとに顧客を作る", "ほかの操作"]);
    expect(r).toContain("data-sample-current");
    for (const id of shelf.map((s) => s.id)) expect(rowHtml(html, "data-sample-row", id)).not.toContain("hh-tags\"><span class=\"pl-tag");
  });

  it("保存の部品を使えないとき: はじめからの見本は「開く」だけ（ほかの操作も無い）。自分で作った見本は「ほかの操作」に 名前と項目を直す・完全削除", () => {
    const { html } = render({ initialTab: "samples", unavailable: "保存の部品を使えません" });
    const app = rowHtml(html, "data-sample-row", "salariedCoupleTwoKids");
    expect(shown(app)).toEqual(["開く"]);
    expect(inside(app)).toBeNull();
    expect(inside(rowHtml(html, "data-sample-row", "own-1"))).toEqual(["名前と項目を直す", "完全削除"]);
  });

  it("一覧の上の説明は「はじめから入っている見本」（「アプリ」と書かない）。見本に登録の案内は「ほかの操作」の中を指す", () => {
    const { html } = render({ initialTab: "samples" });
    expect(html).toContain("はじめから入っている見本は直せません。自分で作った見本は、名前・家族の形・項目を直せます。");
    expect(html).not.toContain("01〜09");
    expect(html).not.toContain("アプリに入っている見本");
    expect(html).toContain("「顧客」の一覧の行の「ほかの操作」の「見本に登録」から");
  });
});

describe("見本の「複製する」（0244）", () => {
  it("名前に「（複製）」を付ける（40字まで）。前に付けた「（写し）」の名前は変えない", () => {
    const app = shelf.find((s) => s.kind === "app");
    expect(app).toBeDefined();
    expect(copyRequest(app!)?.name).toBe(`${app!.name}（複製）`);
    expect(copyRequest({ ...app!, name: "あ".repeat(40) })?.name).toHaveLength(40);
    expect(copyRequest({ ...app!, name: "研修用（写し）" })?.name).toBe("研修用（写し）（複製）");
    expect(COPY_SAMPLE_TITLE).toBe("同じ家族の形・年代の新しい見本に複製します。メモと面談の履歴は複製しません");
    // 見本の名前は重ならない決まりなので（0247）、同じ名前があれば「（複製2）」…
    expect(copyRequest(app!, [`${app!.name}（複製）`])?.name).toBe(`${app!.name}（複製2）`);
    expect(copyRequest(app!, [`${app!.name}（複製）`, ` ${app!.name}（複製2） `])?.name).toBe(`${app!.name}（複製3）`);
    expect(copyRequest(app!)).toMatchObject({ family: app!.family, age: app!.age });
  });

  it("見本の帯のボタンも「複製する」。複製した後の知らせは「見本「名前」として複製しました」", () => {
    const app = read("workspace", "App.tsx");
    expect(app).toMatch(/title=\{COPY_SAMPLE_TITLE\} data-band-copy>\s*複製する\s*</);
    expect(app).toContain('`見本「${r.sample.name}」として複製しました${stripped ? "（メモと面談の履歴は複製していません）" : ""}。手直しは自動で保存します`');
  });

  it("画面に「写して手直しする」「（写し）」を付ける所が残っていない", () => {
    const files = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? files(join(dir, e.name)) : /\.tsx?$/.test(e.name) ? [join(dir, e.name)] : []));
    const left = files(src).filter((f) => /写して手直し|`[^`]*（写し）`/.test(readFileSync(f, "utf8")));
    expect(left).toEqual([]);
  });
});

describe("見た目（store.css。0244）", () => {
  const css = read("styles", "store.css");
  it("行の操作は折らない。「開く」と「開いています」は同じ幅の場所。「ほかの操作」を開いた行は上にそろえる。「アプリ」の印の決まりは消した", () => {
    expect(css).toMatch(/^\.hh-ops \{[^}]*flex-wrap: nowrap;[^}]*white-space: nowrap;/m);
    expect(css).toMatch(/^\.hh-open \{[^}]*min-width: 5\.6rem;/m);
    expect(css).toContain(".hh-more-list[hidden] { display: none; }");
    expect(css).toContain(".hh-list tr:has(.hh-more-list:not([hidden])) > td { vertical-align: top; }");
    expect(css).not.toContain(".hh-app");
    // 番号の右の印は番号と同じ行に（隣の列に重ねない）
    expect(css).toMatch(/^\.hh-list td:first-child \.hh-tags \{[^}]*flex-wrap: nowrap;/m);
  });
});
