// 入力のホームの「探して開く」（0045 の 2026-11-04 の追記）: 言葉から、それを入れる入力項目の欄を探す。
// 言い換えの辞書・文字のそろえ方・隠した入力項目・前の版で足した物・キーボードの動き・ホームの描画
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { h } from "preact";
import { renderToString } from "preact-render-to-string";
import { describe, expect, it } from "vitest";
import { REPO_DIR } from "../scripts/lib.ts";
import { fromRequest, type WorkingHousehold } from "../src/workspace/input/household.ts";
import { findKey } from "../src/workspace/input/InputFind.tsx";
import { FIND_LIMIT, findEntries, findInInput, foldText, type FindEntry, type FindHit } from "../src/workspace/input/inputSearch.ts";
import { InputView } from "../src/workspace/input/InputView.tsx";
import { setItemChoice, withShown } from "../src/workspace/input/itemChoice.ts";
import { inputItems, itemOf, shownItems } from "../src/workspace/input/items.ts";
import { SEARCH_WORDS } from "../src/workspace/input/searchWords.ts";
import { modelHousehold } from "./helpers.ts";
import { withLegacyAdded } from "./legacyAdded.ts";

const seq = () => {
  let n = 0;
  return () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`;
};
const open = (id: string) => fromRequest(modelHousehold(id), { memo: [] });
const entriesOf = (wh: WorkingHousehold): FindEntry[] => findEntries(wh, inputItems(wh));
const find = (wh: WorkingHousehold, q: string): FindHit[] => findInInput(entriesOf(wh), q);
const top = (wh: WorkingHousehold, q: string): FindHit => find(wh, q)[0]!;
const hide = (wh: WorkingHousehold, ...ids: string[]) => setItemChoice(wh, ids.reduce((c, id) => withShown(c, id as never, false), wh.itemChoice ?? {}));

describe("文字のそろえ方", () => {
  it("ひらがな・カタカナ・半角カナ・全角英数・大文字小文字・空白と区切りの記号の違いをそろえる", () => {
    expect(foldText("ＮＩＳＡ")).toBe("nisa");
    expect(foldText("ﾆｰｻ")).toBe(foldText("にーさ"));
    expect(foldText("ニーサ")).toBe(foldText("にーさ"));
    expect(foldText("ｉＤｅＣｏ")).toBe(foldText("iDeCo"));
    expect(foldText("退職金・企業年金")).toBe(foldText("退職金 企業年金"));
    expect(foldText("＋ 留学（第1子）")).toBe(foldText("留学第1子"));
  });

  it("書き方が違っても同じ欄に当たる（全角・半角カナ・ひらがな）", () => {
    const wh = open("salariedCoupleTwoKids");
    const want = top(wh, "NISA");
    for (const q of ["ＮＩＳＡ", "nisa", "ニーサ", "ﾆｰｻ", "にーさ"]) expect(top(wh, q).card, q).toBe("savings");
    expect(want).toMatchObject({ card: "savings", label: "＋ NISA", target: { kind: "action", key: "sav/add/nisa" } });
  });
});

describe("言い換えと欄の名前で当たる", () => {
  const wh = open("salariedCoupleTwoKids");
  const child = wh.request.input.household.members.find((m) => m.kind === "child")!;

  it("留学 → 子ども・教育のその子の「＋ 留学」（子が2人なら、どちらも人の名前つきで）", () => {
    const hits = find(wh, "留学").filter((x) => x.card === "education" && x.label === "＋ 留学");
    expect(hits.map((x) => x.where)).toEqual(["第1子", "第2子"]);
    expect(hits[0]!.target).toEqual({ kind: "action", key: `edu/${child.id}/money/out/abroad`, section: `edu/${child.id}` });
    // まとまりの題に人の名前が無い欄（奨学金・教育ローン）は、区画の題（人の名前）を前に付けて、子ごとに出す
    const loans = find(wh, "貸与の奨学金").filter((x) => x.label === "＋ 貸与の奨学金");
    expect(loans.map((x) => x.where)).toEqual(["第1子 › 奨学金・教育ローン（まだありません）", "第2子 › 奨学金・教育ローン（まだありません）"]);
  });

  it("学資保険 → 保険（「＋ 保険契約を足す」の中の選択肢。開くのはそのボタン）", () => {
    expect(top(wh, "学資保険")).toMatchObject({ card: "insurance", label: "学資保険", target: { kind: "action", key: "ins/new" } });
    expect(top(wh, "こども保険")).toMatchObject({ card: "insurance", label: "学資保険" });
  });

  it("NISA・iDeCo → 貯蓄・運用、親の介護 → 介護・親、養育費 → 家族、奨学金 → 子ども・教育（詳細の欄）、固定資産税 → 住まい・ローン（持ち家の欄。詳細）", () => {
    expect(top(wh, "iDeCo")).toMatchObject({ card: "savings", label: "＋ iDeCo" });
    expect(top(wh, "いでこ")).toMatchObject({ card: "savings", label: "＋ iDeCo" });
    expect(top(wh, "確定拠出年金").card).toBe("savings");
    expect(top(wh, "親の介護")).toMatchObject({ card: "care", label: "介護の費用", target: { kind: "section", key: "care/costs" } });
    expect(find(wh, "養育費").slice(0, 2).map((x) => [x.card, x.label])).toEqual([
      ["family", "＋ 養育費を受け取る"],
      ["family", "＋ 養育費を払う"],
    ]);
    const sch = top(wh, "奨学金");
    expect(sch).toMatchObject({ card: "education", level: "detail", where: "第1子" });
    const tax = top(wh, "固定資産税");
    expect(tax).toMatchObject({ card: "housing", label: "固定資産税・都市計画税", target: { kind: "field" }, level: "detail" });
    expect(tax.target.key).toMatch(/^housing\/res\/.+\/tax$/);
  });

  it("よく打つ言葉は読み（ひらがな）でも当たる（かな漢字の変換の前に打っている間も。読みの始まりまでも）", () => {
    expect(top(wh, "りゅうがく")).toMatchObject({ card: "education", label: "＋ 留学" });
    expect(top(wh, "リュウガク")).toMatchObject({ card: "education", label: "＋ 留学" });
    expect(top(wh, "がくしほけん")).toMatchObject({ card: "insurance", label: "学資保険" });
    expect(top(wh, "しょうがく").card).toBe("education");
    expect(top(wh, "こていしさんぜい").card).toBe("housing");
  });

  it("入れる物がまだ無い世帯では、その入力項目そのものを開く候補を出す（物は作らない）", () => {
    const single = open("single25");
    expect(top(single, "留学")).toMatchObject({ card: "education", target: { kind: "card", key: "education" } });
    expect(top(single, "学資保険")).toMatchObject({ card: "insurance", target: { kind: "card" } });
    expect(top(single, "車検")).toMatchObject({ card: "car", target: { kind: "card" } });
  });

  it("1文字の言い換え（金・親）は、同じ言葉のときだけ当てる（「奨学金」「年金」に貯蓄・運用のその他の資産を出さない）", () => {
    expect(find(wh, "奨学金").some((x) => x.card === "savings")).toBe(false);
    expect(find(wh, "年金").some((x) => x.card === "savings")).toBe(false);
    expect(top(wh, "金")).toMatchObject({ card: "savings", label: "その他の資産" });
  });

  it("候補は多くても8件。同じ入力項目・同じ名前・同じ物は1つ（同じ名前の欄は3件まで）。外すボタンは出さない。当たらなければ空", () => {
    for (const q of ["保険", "年金", "名義", "費用", "の"]) {
      const hits = find(wh, q);
      expect(hits.length, q).toBeLessThanOrEqual(FIND_LIMIT);
      const keys = hits.map((x) => `${x.card}|${foldText(x.label)}|${x.where ?? ""}`);
      expect(new Set(keys).size, q).toBe(keys.length);
      const per = new Map<string, number>();
      for (const x of hits) per.set(`${x.card}|${x.label}`, (per.get(`${x.card}|${x.label}`) ?? 0) + 1);
      expect(Math.max(...per.values()), q).toBeLessThanOrEqual(3);
    }
    expect(entriesOf(wh).some((e) => /外す$/.test(e.label))).toBe(false);
    expect(find(wh, "zzzz")).toEqual([]);
    expect(find(wh, "  ")).toEqual([]);
  });

  it("入力項目の名前そのもので探すと、その入力項目が先頭", () => {
    expect(top(wh, "年金")).toMatchObject({ card: "pension", target: { kind: "card" } });
    expect(top(wh, "相続・贈与")).toMatchObject({ card: "inheritance", target: { kind: "card" } });
  });
});

describe("言い換えの辞書", () => {
  it("どの行も、見本の世帯のどれかで入力項目の中の欄・ボタンに当たる（探す言葉の打ち間違いが無い）", () => {
    const models = readdirSync(join(REPO_DIR, "data", "modelHouseholds"))
      .filter((f) => f.endsWith(".json"))
      .map((f) => f.replace(/\.json$/, ""));
    const all = models.flatMap((m) => entriesOf(open(m)));
    for (const w of SEARCH_WORDS) {
      if (w.to === undefined) continue;
      for (const t of w.to) {
        const tf = foldText(t);
        expect(
          all.some((e) => e.card === w.card && e.target.kind !== "card" && e.f.label.includes(tf)),
          `${w.words[0]} → ${w.card}: ${t}`,
        ).toBe(true);
      }
    }
  });

  it("どの言い方も、候補に辞書の入力項目を出す", () => {
    const wh = open("salariedCoupleTwoKids");
    const es = entriesOf(wh);
    // 欄の名前に同じ言葉がある言い方（「贈与」「旅行」など）は、ほかの入力項目の欄が先になってもよい。辞書の入力項目が候補に入ることを確かめる
    for (const w of SEARCH_WORDS) for (const word of w.words) expect(findInInput(es, word).some((x) => x.card === w.card), `${word} → ${w.card}`).toBe(true);
  });
});

describe("隠した入力項目・前の版で足した物", () => {
  it("ホームに出していない入力項目の欄も探せ、印を付けて出す。開くとそのまま入力のパネルが開く（入力項目の選び方は変えない）", () => {
    const wh = hide(open("single25"), "insurance", "care");
    expect(shownItems(inputItems(wh)).some((i) => i.id === "insurance")).toBe(false);
    const hit = top(wh, "学資保険");
    expect(hit).toMatchObject({ card: "insurance", hidden: true });
    expect(top(wh, "親の介護")).toMatchObject({ card: "care", hidden: true });
    expect(itemOf(wh, "insurance")).not.toBeNull();
    // 開いた状態（パネル）を描ける。選び方はそのまま（値を入れて保存すると、今の決まりどおりホームに出る）
    const html = renderToString(h(InputView, { wh, onSave: () => undefined, level: "simple", initialOpen: "insurance" }));
    expect(html).toContain('role="dialog"');
    expect(wh.itemChoice?.hidden).toEqual(["insurance", "care"]);
    // 出している入力項目の候補には印を付けない
    expect(top(wh, "NISA").hidden).toBe(false);
  });

  it("前の版の「＋ 項目を追加」で足した物（名前を付けた支出・子を選ばない留学）は、物が属する入力項目の中で探せる", () => {
    const wh = withLegacyAdded(open("salariedCoupleTwoKids"), ["periodic", "abroad"], seq());
    const ev = find(wh, "新しい支出").find((x) => x.card === "events");
    expect(ev).toMatchObject({ card: "events", target: { kind: "group" } });
    expect(find(wh, "留学").some((x) => x.card === "events")).toBe(true);
    // ピンは別の候補にしない（物が属する入力項目の欄で当たる）
    expect(find(wh, "新しい支出").every((x) => !x.card.startsWith("added:"))).toBe(true);
  });
});

describe("キーボードと描画", () => {
  it("上下で選ぶ（端で回る）・閉じていれば開く・Enter で開く・Esc で閉じ、もう一度で言葉を消す", () => {
    expect(findKey("ArrowDown", true, 0, 3, "留学")).toEqual({ kind: "move", act: 1 });
    expect(findKey("ArrowDown", true, 2, 3, "留学")).toEqual({ kind: "move", act: 0 });
    expect(findKey("ArrowUp", true, 0, 3, "留学")).toEqual({ kind: "move", act: 2 });
    expect(findKey("ArrowDown", false, 0, 3, "留学")).toEqual({ kind: "reopen" });
    expect(findKey("ArrowDown", false, 0, 0, "")).toBeNull();
    expect(findKey("Enter", true, 1, 3, "留学")).toEqual({ kind: "pick", index: 1 });
    expect(findKey("Enter", true, 0, 0, "zzzz")).toBeNull();
    // 言葉を入れただけ（何も選んでいない）で Enter を押しても、最初の候補を開かない
    expect(findKey("Enter", true, -1, 3, "留学")).toBeNull();
    expect(findKey("ArrowDown", true, -1, 3, "留学")).toEqual({ kind: "move", act: 0 });
    expect(findKey("ArrowUp", true, -1, 3, "留学")).toEqual({ kind: "move", act: 2 });
    expect(findKey("Enter", false, 0, 3, "留学")).toBeNull();
    expect(findKey("Escape", true, 0, 3, "留学")).toEqual({ kind: "close" });
    expect(findKey("Escape", false, 0, 3, "留学")).toEqual({ kind: "clear" });
    expect(findKey("Escape", false, 0, 0, "")).toBeNull();
    expect(findKey("a", true, 0, 3, "留学")).toBeNull();
  });

  it("ホームの並びの最後に「探して開く」（入れる欄・候補の一覧）。言葉を入れて開くと「入力項目の名前 › 欄の名前」と物の名前を出す", () => {
    const wh = open("salariedCoupleTwoKids");
    const home = renderToString(h(InputView, { wh, onSave: () => undefined, level: "simple" }));
    expect(home).toContain('role="combobox"');
    expect(home).not.toContain("data-find-list");
    // 入力項目のカードの後ろ（並びの最後）
    expect(home.lastIndexOf("data-card=")).toBeLessThan(home.indexOf("data-find"));
    const html = renderToString(h(InputView, { wh, onSave: () => undefined, level: "simple", findQuery: "留学" }));
    expect(html).toContain("data-find-list");
    expect(html).toContain('data-find-card="education"');
    expect(html).toMatch(/<span class="c">子ども・教育<\/span><span class="sep" aria-hidden="true">›<\/span><span class="l">留学<\/span><small class="tag">足す<\/small>/);
    expect(html).toContain("<small>第1子</small>");
    expect(html).toContain('aria-selected="true"');
    const none = renderToString(h(InputView, { wh, onSave: () => undefined, level: "simple", findQuery: "zzzz" }));
    expect(none).toContain("見つかりません");
  });
});
