// 表示の設定の案（propose_display_settings。0215）: 案を出せるのは事務所の既定値の見せ方の7つだけで、値は表示の設定の一覧の選べる値・値の形で
// 確かめ（知らない id・選べない値・空・重複・20文字を超える行の名前は、理由と近い候補を添えて断る）、反映すると前の値を事務所データに数件だけ残し、
// 前の値に戻せる。前の版の事務所データ（前の値の欄が無い）もそのまま読める
import { h } from "preact";
import { renderToString } from "preact-render-to-string";
import { describe, expect, it } from "vitest";
import { DisplayProposalsSection } from "../src/workspace/office/DisplayProposalsSection.tsx";
import { officeCurrent } from "../src/connector/display.ts";
import { buildDisplayCatalog, PROPOSABLE_DISPLAY_IDS, type ProposableDisplayId } from "../src/connector/displayCatalog.ts";
import { checkDisplayChanges, checkDisplayValue, closestOf, displayCheck, MAX_DISPLAY_NOTE } from "../src/connector/displayProposal.ts";
import { DISPLAY_HISTORY_MAX, readDisplayHistory } from "../src/workspace/office/displayHistory.ts";
import { applyDisplayValue, carryDisplayValue, displayNow, proposalRow, restoreDisplayValue, withDisplayValue } from "../src/workspace/office/displayProposals.ts";
import { DEFAULT_OFFICE_SETTINGS, readOfficeSettings, type OfficeSettings } from "../src/workspace/office/settings.ts";
import { STAGE_ORDER } from "../src/workspace/input/stageOrder.ts";

const AT = "2026-11-15T01:02:03.000Z";
const problems = (changes: unknown) => checkDisplayChanges(changes).problems.join("／");
const living = (label: string) => ({
  rows: [
    { kind: "group", label, categories: ["food", "utilities"] },
    { kind: "split", category: "recreation", parts: [{ label: "趣味", share: 40 }, { label: "旅行", share: 60 }] },
    { kind: "one", category: "other", label: "そのほか" },
  ],
});

/** 設定ごとの、既定と違う正しい案の値 */
const SAMPLES: Record<ProposableDisplayId, unknown> = {
  "input.order": [...STAGE_ORDER.map((s) => s.id)].reverse(),
  "input.items": { hidden: ["rental", "car"], levels: { work: "detail", car: "simple" } },
  "input.living": living("食費と光熱費"),
  "result.levers": ["lever:retireAge", "lever:nisaMonthly"],
  "contingency.premises": ["death:living", "death:funeral"],
  "contingency.scenes": ["death", "income"],
  "contingency.openScene": "income",
};

describe("案を出せる設定", () => {
  it("一覧の proposable は事務所の既定値の見せ方の7つで、世帯ごと・読むだけの設定は入らない", () => {
    const list = buildDisplayCatalog().settings;
    expect(list.filter((s) => s.proposable === true).map((s) => s.id)).toEqual([...PROPOSABLE_DISPLAY_IDS]);
    for (const s of list.filter((x) => x.proposable === true)) {
      expect(s.scope).not.toBe("household");
      expect(s.readOnly).toBeUndefined();
    }
  });

  it("7つ以外の id は、近い id か案を出せない理由を添えて断る", () => {
    expect(problems([{ id: "result.lever", value: [] }])).toContain("result.levers のことですか");
    expect(problems([{ id: "result.metrics", value: [] }])).toContain("世帯ごとの設定");
    expect(problems([{ id: "balance.guide", value: {} }])).toContain("資産と負債のタブ");
    expect(problems([{ id: "features.combinedBs", value: true }])).toContain("読むだけ");
    expect(problems([{ id: "assumptions.inflation", value: "0.02" }])).toContain("知らない設定の id");
    expect(problems([])).toContain("1件以上");
    expect(problems("x")).toContain("1件以上");
    const eight = [...PROPOSABLE_DISPLAY_IDS, "input.order"].map((id) => ({ id, value: SAMPLES[id as ProposableDisplayId] }));
    expect(problems(eight)).toContain("7件まで");
    expect(problems([{ id: "contingency.openScene", value: "income" }, { id: "contingency.openScene", value: "market" }])).toContain("同じ設定が2回");
    expect(problems([{ id: "contingency.openScene" }])).toContain("value がありません");
    expect(problems([{ id: "contingency.openScene", value: "income", note: "あ".repeat(MAX_DISPLAY_NOTE + 1) }])).toContain(`${MAX_DISPLAY_NOTE}文字まで`);
    // 断るときは、ほかの正しい案も出さない
    const r = checkDisplayChanges([{ id: "contingency.openScene", value: "income" }, { id: "result.metrics", value: [] }]);
    expect(r.changes).toEqual([]);
  });

  it("近い候補は、書き方の違い・1〜2文字の違い・名前の一部の順に探す", () => {
    expect(closestOf("Result_Levers", ["result.levers", "result.layout"])).toBe("result.levers");
    expect(closestOf("result.lever", ["result.levers", "result.layout"])).toBe("result.levers");
    expect(closestOf("lever:nisa", ["lever:retireAge", "lever:nisaMonthly"])).toBe("lever:nisaMonthly");
    expect(closestOf("zz", ["income"])).toBe(null);
  });
});

describe("値の確かめ（境目）", () => {
  it("正しい案は、今の値と同じ形にそろえる（並びは選べる値の順。標準は持たない）", () => {
    const r = checkDisplayChanges(PROPOSABLE_DISPLAY_IDS.map((id) => ({ id, value: SAMPLES[id], note: "  理由  " })));
    expect(r.problems).toEqual([]);
    expect(r.changes.map((c) => c.id)).toEqual([...PROPOSABLE_DISPLAY_IDS]);
    expect(r.changes.every((c) => c.note === "理由")).toBe(true);
    const v = (id: ProposableDisplayId) => r.changes.find((c) => c.id === id)?.value;
    expect(v("result.levers")).toEqual(["lever:retireAge", "lever:nisaMonthly"]);
    expect(checkDisplayValue("result.levers", ["lever:nisaMonthly", "lever:retireAge"])).toEqual({ ok: true, value: ["lever:retireAge", "lever:nisaMonthly"] });
    expect(v("input.items")).toEqual({ hidden: ["car", "rental"].sort((a, b) => STAGE_ORDER.findIndex((s) => s.id === a) - STAGE_ORDER.findIndex((s) => s.id === b)), levels: { work: "detail" } });
    expect(v("contingency.scenes")).toEqual(["death", "income"]);
  });

  it("選べない値・空の配列・重複・形の違う値は、理由と近い候補を添えて断る", () => {
    const bad = (id: ProposableDisplayId, value: unknown) => {
      const r = checkDisplayValue(id, value);
      expect(r.ok, JSON.stringify(value)).toBe(false);
      return r.ok ? "" : r.message;
    };
    expect(bad("result.levers", ["lever:nisa"])).toContain("lever:nisaMonthly「NISAの積立額（月）」のことですか");
    expect(bad("result.levers", "lever:retireAge")).toContain("並び");
    expect(bad("result.levers", ["lever:retireAge", "lever:retireAge"])).toContain("2回あります");
    expect(bad("contingency.scenes", [])).toContain("空の並びは選べません");
    expect(bad("contingency.openScene", "incom")).toContain("income「収入が減る」のことですか");
    expect(bad("contingency.openScene", ["income"])).toContain("選べる値にありません");
    expect(bad("input.order", ["family"])).toContain("足りない");
    expect(bad("input.order", [...STAGE_ORDER.map((s) => s.id), "family"])).toContain("2回あります");
    expect(bad("input.items", { hidden: ["family"] })).toContain("外せません");
    expect(bad("input.items", { hiden: ["car"] })).toContain("hidden のことですか");
    expect(bad("input.items", { levels: { work: "full" } })).toContain('"detail"');
    // 空の配列でも選べる設定（対策に最初から出す項目を何も出さない・どの入力項目も詳細にしない）は受ける
    expect(checkDisplayValue("result.levers", [])).toEqual({ ok: true, value: [] });
    expect(checkDisplayValue("contingency.premises", [])).toEqual({ ok: true, value: [] });
    expect(checkDisplayValue("input.items", {})).toEqual({ ok: true, value: { hidden: [], levels: {} } });
  });

  it("基本生活費の内訳の行の名前は20文字まで。制御文字・見えない書式の文字は通さない", () => {
    const twenty = "食".repeat(20);
    const ok = checkDisplayValue("input.living", living(twenty));
    expect(ok.ok).toBe(true);
    expect(ok.ok && (ok.value as { rows: { label?: string }[] }).rows[0]?.label).toBe(twenty);
    const msg = (label: string) => {
      const r = checkDisplayValue("input.living", living(label));
      return r.ok ? "" : r.message;
    };
    expect(msg("食".repeat(21))).toContain("21文字です（20文字まで）");
    // 前後の空白は数えない
    expect(checkDisplayValue("input.living", living(` ${twenty} `)).ok).toBe(true);
    for (const s of ["食費\n光熱", "食費\t", "食費​", "食費‮", "食費 ", "\u0007"]) expect(msg(s)).toContain("制御文字");
    expect(msg("   ")).toContain("空です");
  });

  it("基本生活費の内訳の並べ方の形（その他は隠せない・分けられない・内訳は1つの行に・割合は全部か無しで合計100）", () => {
    const m = (v: unknown) => {
      const r = checkDisplayValue("input.living", v);
      return r.ok ? "" : r.message;
    };
    expect(m({ rows: [{ kind: "one", category: "food" }] })).toContain("その他（other）は隠せません");
    expect(m({ rows: [{ kind: "split", category: "other", parts: [{ label: "a" }, { label: "b" }] }] })).toContain("分けられません");
    expect(m({ rows: [{ kind: "one", category: "food" }, { kind: "one", category: "food" }, { kind: "one", category: "other" }] })).toContain("ほかの行にもあります");
    expect(m({ rows: [{ kind: "group", label: "x", categories: ["food"] }, { kind: "one", category: "other" }] })).toContain("2つ以上");
    expect(m({ rows: [{ kind: "split", category: "food", parts: [{ label: "a", share: 50 }, { label: "b" }] }, { kind: "one", category: "other" }] })).toContain("どの行にも書くか");
    expect(m({ rows: [{ kind: "split", category: "food", parts: [{ label: "a", share: 50 }, { label: "b", share: 40 }] }, { kind: "one", category: "other" }] })).toContain("合計が100");
    expect(m({ rows: [{ kind: "split", category: "food", parts: [{ label: "a" }, { label: "a" }] }, { kind: "one", category: "other" }] })).toContain("2回あります");
    expect(m({ rows: [{ kind: "won", category: "food" }, { kind: "one", category: "other" }] })).toContain("one のことですか");
    expect(m({ rows: [{ kind: "one", category: "fod" }, { kind: "one", category: "other" }] })).toContain("food「食費」のことですか");
    expect(m({ rows: [{ kind: "one", category: "food", name: "x" }, { kind: "one", category: "other" }] })).toContain("知らない名前");
  });

  it("接続口の入口（plan.js の displayCheck）は、同じ答えを JSON の文字で返す", () => {
    const out = JSON.parse(displayCheck(JSON.stringify([{ id: "contingency.openScene", value: "income" }]), "", "")) as { changes: unknown[]; problems: string[] };
    expect(out).toEqual({ changes: [{ id: "contingency.openScene", value: "income" }], problems: [] });
    expect((JSON.parse(displayCheck("{", "", "")) as { problems: string[] }).problems[0]).toContain("読めません");
  });
});

describe("反映する・前の値に戻す", () => {
  it("どの設定も、書いた値が今の値（get_display_settings と同じ読み方）になり、ほかの設定は変えない", () => {
    for (const id of PROPOSABLE_DISPLAY_IDS) {
      const r = checkDisplayValue(id, SAMPLES[id]);
      if (!r.ok) throw new Error(r.message);
      const s = withDisplayValue(DEFAULT_OFFICE_SETTINGS, id, r.value);
      const now = officeCurrent(s);
      expect(now[id]?.value, id).toEqual(r.value);
      expect(now[id]?.isDefault, id).toBe(false);
      for (const other of PROPOSABLE_DISPLAY_IDS.filter((x) => x !== id)) expect(now[other]?.isDefault, `${id} → ${other}`).toBe(true);
      // 事務所データに保存して読み直しても同じ
      expect(officeCurrent(readOfficeSettings(JSON.parse(JSON.stringify(s))))[id]?.value).toEqual(r.value);
    }
    // 場面の帯と開いたときの場面は同じ欄（scenes）だが、片方だけ変える
    const both = withDisplayValue(withDisplayValue(DEFAULT_OFFICE_SETTINGS, "contingency.scenes", ["death", "income"]), "contingency.openScene", "income");
    expect(both.scenes).toEqual({ hidden: ["disability", "illness", "market"], open: "income" });
    expect(withDisplayValue(both, "contingency.scenes", ["death", "disability", "illness", "income", "market"]).scenes).toEqual({ open: "income" });
    // 既定と同じ並びは持たない
    expect(withDisplayValue(DEFAULT_OFFICE_SETTINGS, "input.order", STAGE_ORDER.map((s) => s.id)).layout).toBeNull();
  });

  it("新しい世帯で出す入力項目は事務所の既定だけを変える（作った世帯は変えない）", () => {
    const base: OfficeSettings = { ...DEFAULT_OFFICE_SETTINGS, levers: { shown: ["lever:nisaMonthly"] }, assumptions: { inflation: "0.02" } };
    const next = applyDisplayValue(base, "input.items", { hidden: ["car"] }, AT, "ai");
    expect(next?.items).toEqual({ hidden: ["car"] });
    expect({ ...next, items: base.items, displayHistory: undefined }).toEqual({ ...base, displayHistory: undefined });
  });

  it("反映するごとに前の値を残し（設定ごとに直近3件）、前の値に戻すと戻す前の値も残す", () => {
    let s: OfficeSettings = DEFAULT_OFFICE_SETTINGS;
    const opens = ["income", "market", "death:spouse", "illness:self"];
    for (const [i, o] of opens.entries()) {
      const next = applyDisplayValue(s, "contingency.openScene", o, `2026-11-15T0${i}:00:00.000Z`, "ai");
      if (next === null) throw new Error(o);
      s = next;
    }
    expect(DISPLAY_HISTORY_MAX).toBe(3);
    // 4回反映したので、いちばん古い前の値（既定の death:self）は外れる
    expect(s.displayHistory?.["contingency.openScene"]?.map((e) => e.value)).toEqual(["income", "market", "death:spouse"]);
    expect(displayNow(s, "contingency.openScene").value).toBe("illness:self");
    // 今と同じ値は、設定も前の値も変えない
    expect(applyDisplayValue(s, "contingency.openScene", "illness:self", AT, "ai")).toBe(s);
    // 確かめられない値は反映しない
    expect(applyDisplayValue(s, "contingency.openScene", "nope", AT, "ai")).toBeNull();
    // 前の値に戻す（古い方の income）: 戻す前の値（illness:self）を restore で残す
    const back = restoreDisplayValue(s, "contingency.openScene", 0, AT);
    expect(displayNow(back as OfficeSettings, "contingency.openScene").value).toBe("income");
    expect(back?.displayHistory?.["contingency.openScene"]).toEqual([
      { value: "market", at: "2026-11-15T02:00:00.000Z", reason: "ai" },
      { value: "death:spouse", at: "2026-11-15T03:00:00.000Z", reason: "ai" },
      { value: "illness:self", at: AT, reason: "restore" },
    ]);
    expect(restoreDisplayValue(s, "contingency.openScene", 9, AT)).toBeNull();
    expect(restoreDisplayValue(s, "result.levers", 0, AT)).toBeNull();
  });

  it("前の値は事務所データに保存して読み直せ、読めない行・知らない設定は捨てる。前の版の事務所データは前の値なしで読む", () => {
    const s = applyDisplayValue(DEFAULT_OFFICE_SETTINGS, "result.levers", SAMPLES["result.levers"], AT, "ai") as OfficeSettings;
    const back = readOfficeSettings(JSON.parse(JSON.stringify(s)));
    expect(back.version).toBe(3);
    expect(back.displayHistory).toEqual({ "result.levers": [{ value: ["lever:retireAge", "lever:pensionAge", "lever:livingMonthly", "spouse:work"], at: AT, reason: "ai" }] });
    // 版 1・2 の事務所データ（前の値の欄が無い）
    for (const version of [1, 2]) {
      const old = readOfficeSettings({ version, levers: { shown: ["lever:nisaMonthly"] } });
      expect(old.version).toBe(3);
      expect(old.displayHistory).toBeUndefined();
      expect(old.levers).toEqual({ shown: ["lever:nisaMonthly"] });
    }
    // 読めない行・知らない設定・多すぎる行
    const h = readDisplayHistory({
      "result.levers": [{ value: ["lever:nisa"], at: AT, reason: "ai" }, { value: [], at: "昨日", reason: "ai" }, { value: [], at: AT, reason: "why" }, { value: ["lever:retireAge"], at: AT, reason: "restore" }],
      "balance.guide": [{ value: {}, at: AT, reason: "ai" }],
      "contingency.openScene": ["income", "market", "death:spouse", "illness:self", "income"].map((value) => ({ value, at: AT, reason: "ai" })),
    });
    expect(h).toEqual({
      "result.levers": [{ value: ["lever:retireAge"], at: AT, reason: "restore" }],
      "contingency.openScene": ["death:spouse", "illness:self", "income"].map((value) => ({ value, at: AT, reason: "ai" })),
    });
    expect(readDisplayHistory({})).toBeUndefined();
    expect(readDisplayHistory([])).toBeUndefined();
  });

  it("承認の画面の行: 今 → 案。今と同じ案・確かめられない案は分かるようにする", () => {
    const row = proposalRow(DEFAULT_OFFICE_SETTINGS, "result.levers", ["lever:nisaMonthly", "lever:retireAge"]);
    expect(row.problem).toBeNull();
    expect(row.now).toContain("働く最後の年齢（ご本人）");
    expect(row.next).toBe("働く最後の年齢（ご本人）・NISAの積立額（月）");
    expect(row.unchanged).toBe(false);
    expect(row.change).toBe("足す: NISAの積立額（月）／外す: 年金を受け取り始める年齢（ご本人）・毎月の生活費・配偶者の働き方と年収");
    expect(proposalRow(DEFAULT_OFFICE_SETTINGS, "contingency.openScene", "income").change).toBeNull();
    expect(proposalRow(DEFAULT_OFFICE_SETTINGS, "contingency.openScene", "death:self").unchanged).toBe(true);
    expect(proposalRow(DEFAULT_OFFICE_SETTINGS, "contingency.openScene", "x").problem).toContain("選べる値にありません");
    expect(proposalRow(DEFAULT_OFFICE_SETTINGS, "input.living", living("食費と光熱費")).next).toContain("食費と光熱費");
  });

  it("開いている画面の編集中の欄には、反映した設定と前の値だけを写す", () => {
    const draft: OfficeSettings = { ...DEFAULT_OFFICE_SETTINGS, assumptions: { inflation: "0.03" } };
    const saved = applyDisplayValue(DEFAULT_OFFICE_SETTINGS, "contingency.openScene", "income", AT, "ai") as OfficeSettings;
    const next = carryDisplayValue(draft, saved, "contingency.openScene");
    expect(next.assumptions).toEqual({ inflation: "0.03" });
    expect(next.scenes).toEqual({ open: "income" });
    expect(next.displayHistory).toEqual(saved.displayHistory);
  });
});

describe("承認の画面（事務所の既定値の「AIからの表示の設定の案」）", () => {
  const no = () => Promise.reject(new Error("no"));
  it("設定ごとに 今 → 案 と AI の理由を出し、「反映する」「捨てる」を置く。確かめられない案・今と同じ案は「捨てる」だけ", () => {
    const html = renderToString(
      h(DisplayProposalsSection, {
        value: DEFAULT_OFFICE_SETTINGS,
        candidates: [
          {
            candidateId: "c1",
            receivedAt: AT,
            connector: "test-ai 1",
            changes: [
              { id: "result.levers", value: ["lever:retireAge", "lever:nisaMonthly"], note: "NISA の相談が多い" },
              { id: "input.items", value: { hidden: ["car"] } },
              { id: "contingency.openScene", value: "death:self" },
              { id: "contingency.scenes", value: [] },
            ],
          },
        ],
        onApply: no,
        onDiscard: no,
        onRestore: no,
      }),
    );
    expect(html).toContain("AIからの表示の設定の案");
    expect(html).toContain('<span class="os-display-head">今</span>');
    expect(html).toContain('<span class="os-display-head">案</span>');
    expect(html).toContain("変わる所: 足す: NISAの積立額（月）／外す: 年金を受け取り始める年齢（ご本人）・毎月の生活費・配偶者の働き方と年収");
    expect(html).toContain("NISA の相談が多い");
    expect(html).toContain("test-ai 1");
    expect(html.match(/data-display-apply=/g)?.length).toBe(2);
    expect(html.match(/data-display-discard=/g)?.length).toBe(4);
    expect(html).toContain("新しく作る世帯にだけ効きます（作った世帯は変わりません）");
    expect(html).toContain("今と同じです");
    expect(html).toContain("この案は反映できません");
    // 作った世帯にもそろえる操作は出さない
    expect(html).not.toContain("そろえる");
  });

  it("前の値があれば「前の値に戻す」を新しい順に出す（案が無くても）", () => {
    let s = applyDisplayValue(DEFAULT_OFFICE_SETTINGS, "contingency.openScene", "income", "2026-11-15T01:00:00.000Z", "ai") as OfficeSettings;
    s = applyDisplayValue(s, "contingency.openScene", "market", "2026-11-15T02:00:00.000Z", "ai") as OfficeSettings;
    const html = renderToString(h(DisplayProposalsSection, { value: s, candidates: [], onApply: no, onDiscard: no, onRestore: no }));
    expect(html).toContain("前の値に戻す");
    expect(html).toContain("今: 相場の下落");
    const order = [...html.matchAll(/data-display-restore="([^"]+)"/g)].map((m) => m[1]);
    expect(order).toEqual(["contingency.openScene:1", "contingency.openScene:0"]);
    expect(renderToString(h(DisplayProposalsSection, { value: DEFAULT_OFFICE_SETTINGS, candidates: [], onApply: no, onDiscard: no, onRestore: no }))).toBe("");
  });
});
