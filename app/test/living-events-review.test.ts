// 基本生活費・ライフイベントの見せ方の見直し（設計記録 0142）: 退職後の段に70歳・80歳の推定の段がついてくる・段の見出しと割合の名前・
// 内訳の平均の行・総額の年額・黒字の割合の目安の名前と空欄・上限の置き場所・年1回のひな形（何年ごとの確定・スマホの台数・通院の説明）・
// 世帯の予定の額の無い行・夢の車の説明・結果の対策の文の子の名前
import { describe, expect, it } from "vitest";
import { withRefreshedEstimates } from "../src/workspace/input/estimates.ts";
import { allFields, type FieldDef, type GroupDef } from "../src/workspace/input/form.ts";
import { blankHousehold, mutate, type WorkingHousehold } from "../src/workspace/input/household.ts";
import { DREAM_TEMPLATES } from "../src/workspace/input/dreams.ts";
import { isAutoStage } from "../src/workspace/input/livingStages.ts";
import { scheduleItems } from "../src/workspace/input/schedule.ts";
import { addMember } from "../src/workspace/input/stages/family.ts";
import { buildStage } from "../src/workspace/input/stages/index.ts";
import { addAnnual, ANNUAL_TEMPLATES, phoneCount } from "../src/workspace/input/stages/living.ts";
import { applyStateOp, fieldStatus } from "../src/workspace/input/valueState.ts";
import { buildCatalog } from "../src/workspace/plans/items.ts";
import type { LivingExpense } from "../src/engine/types.ts";
import { fieldOf, put } from "./watch/cases.ts";
import { preview } from "./helpers.ts";

let n = 0;
const ids = () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`;

/** 新しい顧客: ご本人（1986年6月）・配偶者・子2人（2014年5月・2021年8月）。計算の基準は 2026年10月 */
function family(): WorkingHousehold {
  let wh = withRefreshedEstimates(blankHousehold("2026-10", ids));
  wh = mutate(wh, (h) => void (h.members[0]!.birth.birthYearMonth = "1986-06"));
  wh = withRefreshedEstimates(addMember(wh, "spouse", ids));
  wh = withRefreshedEstimates(addMember(wh, "child", ids));
  wh = withRefreshedEstimates(addMember(wh, "child", ids));
  const kids = wh.request.input.household.members.filter((m) => m.kind === "child").map((m) => m.id);
  return withRefreshedEstimates(
    mutate(wh, (h) => {
      h.members.find((m) => m.id === kids[0])!.birth.birthYearMonth = "2014-05";
      h.members.find((m) => m.id === kids[1])!.birth.birthYearMonth = "2021-08";
    }),
  );
}

const living = (wh: WorkingHousehold): LivingExpense => wh.request.input.household.livingExpenses![0]!;
const groups = (wh: WorkingHousehold): GroupDef[] => buildStage("living", wh).sections.flatMap((s) => s.groups);
const stageOf = (wh: WorkingHousehold, label: string) => living(wh).stages!.find((s) => s.label === label)!;
const retiredField = (f: FieldDef) => f.label === "退職後の生活費（今の額に対する割合）";

describe("退職後の段を直すと、推定の70歳・80歳の段がついてくる", () => {
  it("退職後を55%にすると、推定のままの70歳・80歳の段は「55% × 目安の比（75/80・70/80）」に入れ直す。退職直後より高くならない", () => {
    const wh = family();
    expect(stageOf(wh, "retirement").ratio).toBe("0.68");
    expect([stageOf(wh, "age70").ratio, stageOf(wh, "age80").ratio]).toEqual(["0.64", "0.6"]);
    const w = put(wh, "living", retiredField, "0.55");
    expect(stageOf(w, "retirement").ratio).toBe("0.55");
    expect(stageOf(w, "age70").ratio).toBe("0.52");
    expect(stageOf(w, "age80").ratio).toBe("0.48");
    // 推定の印のまま（根拠に、入れた退職後の割合に合わせたことを書く）
    const l = living(w);
    expect(isAutoStage(l, stageOf(w, "age70").id!)).toBe(true);
    const f70 = fieldOf(w, "living", (f) => f.key.endsWith(`/stage/${l.stages!.findIndex((s) => s.label === "age70")}/ratio`));
    expect(fieldStatus(f70, w).basis).toContain("入れた退職後の割合 55%");
    // 退職より前の段（子の独立）は変えない
    expect(living(w).stages!.filter((s) => s.label === "childIndependence").map((s) => s.ratio)).toEqual(["0.94", "0.85"]);
    expect(() => preview(w.request)).not.toThrow();
  });

  it("FP が直した70歳の段はそのまま。80歳の段（推定のまま）だけ退職後に合わせる", () => {
    const wh = family();
    const i70 = living(wh).stages!.findIndex((s) => s.label === "age70");
    const w1 = put(wh, "living", (f) => f.key.endsWith(`/stage/${i70}/ratio`), "0.7");
    const w2 = put(w1, "living", retiredField, "0.6");
    expect(stageOf(w2, "age70").ratio).toBe("0.7");
    expect(stageOf(w2, "age80").ratio).toBe("0.53");
  });

  it("月額で入れた退職後の段にも合わせる（今の額に対する割合に直して掛ける）", () => {
    const wh = family();
    const iR = living(wh).stages!.findIndex((s) => s.label === "retirement");
    const w1 = put(wh, "living", (f) => f.key.endsWith(`/stage/${iR}/mode`), "monthly");
    const base = living(w1).monthly!.value!;
    const w2 = put(w1, "living", (f) => f.key.endsWith(`/stage/${iR}/monthly`), Math.round(base * 0.5));
    expect(Number(stageOf(w2, "age70").ratio)).toBeCloseTo(0.47, 2);
  });
});

describe("段の見出し・割合の名前・欄の下の読み", () => {
  it("見出しに番号を付けない。標準に出す退職後の段は「退職後（2051年6月・ご本人65歳から）」、ほかは「第1子の独立（2037年4月・ご本人50歳から）」、70歳・80歳の段は年齢を1回だけ「70歳から（2056年6月）」", () => {
    const wh = family();
    const titles = groups(wh)
      .filter((g) => /\/stage\/\d+$/.test(g.key))
      .map((g) => [g.title, g.level]);
    expect(titles).toEqual([
      ["第1子の独立（2037年4月・ご本人50歳から）", "detail"],
      ["第2子の独立（2044年4月・ご本人57歳から）", "detail"],
      ["退職後（2051年6月・ご本人65歳から）", "simple"],
      ["70歳から（2056年6月）", "detail"],
      ["80歳から（2066年6月）", "detail"],
    ]);
    expect(titles.some(([t]) => /段階 \d/.test(t as string))).toBe(false);
  });

  it("毎月の生活費の「▸」は、標準に出ていない段を名前と数で（推定 4段）。段が無ければ「退職後などの段階を入れる」", () => {
    const wh = family();
    const main = groups(wh).find((g) => g.key === `living/${living(wh).id}`)!;
    expect(main.moreLabel).toBe("子の独立・70歳・80歳の段（推定 4段）を見る");
    const none = mutate(wh, (h) => void delete h.livingExpenses![0]!.stages);
    expect(groups(none).find((g) => g.key === `living/${living(none).id}`)!.moreLabel).toBe("退職後などの段階を入れる");
  });

  it("割合の名前は「今の額に対する割合」の1つ。退職後の欄の下に、直前の段との比と、その後の70歳・80歳の額（推定）", () => {
    const wh = family();
    const fs = allFields(buildStage("living", wh));
    const labels = new Set(fs.filter((f) => /\/stage\/\d+\/ratio$/.test(f.key)).map((f) => f.label));
    expect([...labels].sort()).toEqual(["今の額に対する割合", "退職後の生活費（今の額に対する割合）"]);
    expect(fs.some((f) => f.label.includes("最初の額"))).toBe(false);
    const mode = fs.find((f) => /\/stage\/\d+\/mode$/.test(f.key))!;
    expect(mode.kind === "select" ? mode.options.map((o) => o.label) : []).toEqual(["今の額に対する割合で", "月額で"]);
    expect(fieldOf(wh, "living", retiredField).get(wh).hint).toBe("＝月16.7万円（今の値段）。第2子の独立の後（月20.8万円）の80%。70歳から月15.7万円・80歳から月14.7万円（推定）");
  });
});

describe("内訳の平均の行・総額の年額・伸び率の名前", () => {
  it("内訳が推定のまま（平均から作った値）なら平均の行を出さない。FP が直した内訳だけ「同じ人数の世帯の平均 月○万円」を比較として出す", () => {
    const wh = put(family(), "living", (f) => f.key.endsWith("/mode") && f.item === "livingExpense.mode", "byCategory");
    const cats = allFields(buildStage("living", wh)).filter((f) => /\/cat\/\d+$/.test(f.key));
    expect(cats.length).toBeGreaterThan(5);
    for (const f of cats) expect(f.get(wh).hint ?? "", f.label).not.toContain("平均");
    const food = cats.find((f) => f.label === "食費")!;
    const w = withRefreshedEstimates(food.set(wh, 90_000));
    expect(fieldOf(w, "living", food.key).get(w).hint).toMatch(/^同じ人数の世帯の平均 月\d+(\.\d)?万円$/);
  });

  it("総額で入れるときも、欄の下に年額（「年294万円」の形）。内訳の合計の行も同じ書き方", () => {
    const wh = family();
    const f = fieldOf(wh, "living", (x) => x.label === "基本生活費（月額）");
    const m = living(wh).monthly!.value!;
    expect(f.get(wh).hint).toBe(`年${(Math.round((m * 12) / 1000) / 10).toLocaleString("ja-JP")}万円`);
  });

  it("決まった率の伸び方の率の欄は「伸び率（年）」", () => {
    const wh = put(family(), "living", (f) => f.item === "livingExpense.growth" && f.kind === "select", "rate");
    const labels = allFields(buildStage("living", wh)).filter((f) => f.item === "livingExpense.growth").map((f) => f.label);
    expect(labels).toContain("伸び率（年）");
    expect(labels.some((l) => l.includes("変動率"))).toBe(false);
  });
});

describe("毎年の黒字のうち、貯金に回る割合", () => {
  it("目安のボタンの名前に割合と区切りの年。空欄は「空欄＝100%」と、何が起きるかの1行（初めの値は100%のまま）", () => {
    const wh = family();
    const presets = groups(wh).find((g) => g.key === "living/surplus/presets")!.actions.map((a) => a.label);
    expect(presets[0]).toBe("ずっと同じ（目安 60%）");
    expect(presets[1]).toMatch(/^子育て中と独立後で分ける（\d+%→\d+%・2044年・ご本人57歳から）$/);
    expect(presets.at(-1)).toBe("カスタム");
    const ratio = fieldOf(wh, "living", "living/surplus/ratio");
    expect(ratio.blankMeans).toBe("100%");
    expect(ratio.get(wh)).toMatchObject({ value: null, hint: "黒字を全部貯金に回す計算です（実際より多めに出やすくなります）" });
    // 初めの値は変えない（空のまま＝100%で計算）
    expect(wh.request.input.assumptions?.surplusSaving).toBeUndefined();
  });

  it("「ご本人の年齢（この年から）」と、区画の下の「割合を外す（全部貯金に戻す）」（期間の「外す」と分ける）。上限は「▸ 上限を入れる」の中（入っていれば標準）", () => {
    let wh = family();
    const custom = groups(wh).find((g) => g.key === "living/surplus/presets")!.actions.find((a) => a.key === "living/surplus/preset/custom")!;
    wh = custom.run(wh);
    const fs = allFields(buildStage("living", wh));
    expect(fs.some((f) => f.label === "ご本人の年齢（この年から）")).toBe(true);
    expect(fs.some((f) => f.label.startsWith("本人の"))).toBe(false);
    const sec = buildStage("living", wh).sections.find((s) => s.key === "living/surplus")!;
    expect(sec.actions.find((a) => a.key === "living/surplus/clear")!.label).toBe("割合を外す（全部貯金に戻す）");
    const main = sec.groups.find((g) => g.key === "living/surplus/fields")!;
    expect(main.moreLabel).toBe("上限を入れる");
    expect(main.fields.find((f) => f.key === "living/surplus/cap")!.level).toBe("detail");
    const w = fieldOf(wh, "living", "living/surplus/cap").set(wh, 1_000_000);
    expect(fieldOf(w, "living", "living/surplus/cap").level).toBe("simple");
  });
});

describe("年1回・数年に1回の支出のひな形", () => {
  const tmpl = (key: string) => ANNUAL_TEMPLATES.find((t) => t.key === key)!;

  it("額の「この値にする」で、何年ごとの仮の印も一緒に外す（押す数を減らす。それまでは印を残す）", () => {
    const id = "00000000-0000-4000-8000-0000000000a1";
    const wh = addAnnual(family(), tmpl("homecoming"), id);
    expect(wh.assumed[`ev/${id}/every`]).toBeDefined();
    const amount = fieldOf(wh, "living", `ev/${id}/amount`);
    expect(fieldStatus(amount, wh).status).toBe("estimated");
    const w = applyStateOp(wh, amount, "confirm");
    expect(fieldStatus(fieldOf(w, "living", `ev/${id}/amount`), w).status).not.toBe("estimated");
    expect(w.assumed[`ev/${id}/every`]).toBeUndefined();
  });

  it("スマホは、大人と中学生以上の子の人数分の台数で1行（「スマホの買い替え（3台）」・1台分×3）", () => {
    // 2014年5月生まれの第1子は、2026年10月はまだ小学6年生（中学校は2027年4月から）: ご本人・配偶者の2台
    expect(phoneCount(family())).toBe(2);
    // 2013年5月生まれにすると中学1年生: ご本人・配偶者・第1子の3台。第2子（5歳）は数えない
    const wh = mutate(family(), (h) => void (h.members.filter((m) => m.kind === "child")[0]!.birth.birthYearMonth = "2013-05"));
    expect(phoneCount(wh)).toBe(3);
    const id = "00000000-0000-4000-8000-0000000000a2";
    const p = addAnnual(wh, tmpl("smartphone"), id).request.input.household.periodicExpenses!.find((x) => x.id === id)!;
    expect(p.label).toBe("スマホの買い替え（3台）");
    expect(p.amount.value).toBe(tmpl("smartphone").amount * 3);
    // 1人の世帯は1台（名前に台数を付けない）
    const single = withRefreshedEstimates(blankHousehold("2026-10", ids));
    expect(phoneCount(single)).toBe(1);
    expect(addAnnual(single, tmpl("smartphone"), id).request.input.household.periodicExpenses!.find((x) => x.id === id)!.label).toBe("スマホの買い替え");
  });

  it("「通院・歯の治療」の「?」に、毎月の通院・薬は内訳の医療費に入れること（二重にしない）", () => {
    expect(tmpl("medical").help).toContain("内訳の「医療費」");
    expect(tmpl("medical").help).toContain("二重");
  });
});

describe("ライフイベント・世帯の予定", () => {
  it("この世帯の予定で、額の無い出るお金も「額は未入力」（0万円と書かない）", () => {
    const wh = mutate(family(), (h) => {
      (h.periodicExpenses ??= []).push({ id: "00000000-0000-4000-8000-0000000000d1", kind: "dream", label: "特別な旅行", from: { at: "2029-04" }, to: { at: "2029-04" }, everyYears: 1, amount: { value: 0, state: "confirmed", origin: { kind: "manual" } }, dream: { rank: 1 } } as never);
    });
    const item = scheduleItems(wh).find((x) => x.name.includes("特別な旅行"))!;
    expect(item.amount.startsWith("額は未入力")).toBe(true);
  });

  it("夢の「憧れの車」の「?」に、車の入力項目の買い替えと同じ車なら差額を入れること", () => {
    expect(DREAM_TEMPLATES.find((t) => t.key === "car")!.help).toContain("差額");
  });

  it("結果の対策の生活費の文: 子の独立の段が2つなら「第1子の独立後は94%、第2子の独立後は85%」", () => {
    const wh = family();
    const self = wh.request.input.household.members.find((m) => m.kind === "self")!.id;
    const notes = buildCatalog(wh, self, null)
      .items.map((i) => (i.note === undefined ? null : typeof i.note === "function" ? i.note(living(wh).monthly!.value!) : i.note))
      .filter((x): x is string => typeof x === "string" && x.includes("独立後は"));
    expect(notes[0]).toBe("第1子の独立後は94%、第2子の独立後は85%、退職後は68%、70歳から64%、80歳から60%");
  });
});
