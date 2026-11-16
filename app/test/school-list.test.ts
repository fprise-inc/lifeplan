// 学校の一覧と学校名の欄（0010 の2・9、0217）: 一覧のデータの検査（学校コードの形・移行先の循環・別名の辞書）、探し方（部分一致・読み・略称・旧校名・
// 全角半角・カタカナひらがな・旧字体・段に合う学校種だけ・廃止した学校は出さない・同じ名前の学校の見分け）、学校名の欄（選ぶ・学校未定に戻す・
// 段に合わない学校は選べない・公立私立を合わせる・実データが無ければ平均で計算して使った平均を出す・廃止した学校の移行先・古い世帯）、
// ヒアリングシートの学校名の照合の土台
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import type { EngineRequest, EducationStage, Goal } from "../src/engine/types.ts";
import { withRefreshedEstimates } from "../src/workspace/input/estimates.ts";
import { allFields, type FieldDef } from "../src/workspace/input/form.ts";
import { blankHousehold, mutate, type WorkingHousehold } from "../src/workspace/input/household.ts";
import { hearingSchoolText, UNDECIDED } from "../src/workspace/input/schoolField.ts";
import "../src/workspace/input/schoolLoader.ts";
import { currentSchool, loadSchoolList, makeSchoolList, matchSchoolText, normalizeSchoolText, schoolDetail, searchSchools, type SchoolBundle, type SchoolList } from "../src/workspace/input/schools.ts";
import { addChildWithEducation, addMember } from "../src/workspace/input/stages/family.ts";
import { buildStage } from "../src/workspace/input/stages/index.ts";
import { checkDigit, checkSchoolRows, readSchoolPack } from "../scripts/schoolList.ts";
import { preview } from "./helpers.ts";

const BASE = "2026-10";
const DATA = join(import.meta.dirname, "..", "..", "data", "schools");
const seq = () => {
  let n = 0;
  return () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`;
};

let list: SchoolList;
beforeAll(async () => {
  list = await loadSchoolList();
});

const codeOf = (name: string, kind?: string) => {
  const s = [...list.byCode.values()].find((x) => x.name === name && (kind === undefined || x.kind === kind));
  if (s === undefined) throw new Error(`no school ${name}`);
  return s.code;
};
const names = (r: { hits: { school: { name: string } }[] }) => r.hits.map((h) => h.school.name);

describe("学校の一覧のデータ（data/schools）", () => {
  const { rows, aliases, pack } = readSchoolPack(DATA);
  it("誤りが無い（学校コードの形・学校種と都道府県と設置区分の列・移行先の循環・別名の辞書の学校コード）", () => {
    const r = checkSchoolRows(rows, aliases);
    expect(r.errors).toEqual([]);
    // 検査数字の合わない学校コードは文部科学省の一覧にもある（誤りにしない）。急に増えたら取り込みの誤りを疑う
    expect(r.checkDigitMismatches.length).toBeLessThan(rows.length / 100);
  });
  it("全学校種（幼稚園〜各種学校）が入り、出典の版と取得日がある", () => {
    const kinds = new Set(rows.map((r) => r.kind));
    expect([...kinds].sort()).toEqual(["A1", "A2", "B1", "C1", "C2", "D1", "D2", "E1", "F1", "F2", "G1", "H1", "H2"]);
    expect(rows.length).toBeGreaterThan(55000);
    expect(pack.edition).toContain("令和8年5月1日時点");
    for (const s of pack.sources) {
      expect(s.url.startsWith("https://www.mext.go.jp/")).toBe(true);
      expect(s.retrievedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(s.sha256).toMatch(/^[0-9a-f]{64}$/);
    }
  });
  it("検査数字の計算（学校コードの取り扱いの別紙の例と、一覧の学校）", () => {
    expect(checkDigit("F11311010270")).toBe(0); // 東京大学 F113110102700
    expect(checkDigit("F12611010740")).toBe(7); // 京都大学 F126110107407
  });
  it("市区町村は所在地から切り出す（名前の中に市・町の字がある市も切り誤らない）", () => {
    const city = (name: string) => rows.find((r) => r.name === name)?.city;
    expect(city("東京大学")).toBe("文京区");
    expect(city("京都大学")).toBe("京都市左京区");
    expect(rows.filter((r) => r.city === "").length).toBeLessThan(10);
  });
});

describe("探し方", () => {
  it("文字のそろえ方: 全角半角・カタカナひらがな・旧字体・空白と中黒", () => {
    expect(normalizeSchoolText("ＡＢＣ　学園")).toBe("abc学園");
    expect(normalizeSchoolText("ノートルダム")).toBe(normalizeSchoolText("のーとるだむ"));
    expect(normalizeSchoolText("東京藝術大学")).toBe(normalizeSchoolText("東京芸術大学"));
    expect(normalizeSchoolText("駒ヶ根")).toBe(normalizeSchoolText("駒ケ根"));
  });
  it("部分一致で、全部一致・前方一致が先。段に合う学校種だけ（大学の段に附属高校は出ない）", () => {
    const r = searchSchools(list, "東京大学", { stage: "university" });
    expect(r.hits[0]?.school.name).toBe("東京大学");
    expect(r.hits.every((h) => h.school.kind === "F1")).toBe(true);
    const hs = searchSchools(list, "東京大学", { stage: "highSchool" });
    expect(hs.hits.every((h) => ["D1", "D2", "E1"].includes(h.school.kind))).toBe(true);
  });
  it("略称（辞書）・旧校名（廃止した学校の移行先）で引ける。廃止した学校そのものは出ない", () => {
    expect(searchSchools(list, "東大", { stage: "university" }).hits[0]?.school.name).toBe("東京大学");
    const r = searchSchools(list, "東京工業大学", { stage: "university" });
    expect(r.hits[0]?.school.name).toBe("東京科学大学");
    expect(r.hits[0]?.via).toBe("former");
    expect(names(r)).not.toContain("東京工業大学");
    expect(names(searchSchools(list, "医科歯科", { stage: "university" }))).toContain("東京科学大学");
  });
  it("一覧の移行後の学校コードで、廃止した学校から今の学校をたどれる（統合・改称）", () => {
    expect(currentSchool(list, codeOf("旭川大学", "F1"))?.name).toBe("旭川市立大学");
    expect(currentSchool(list, codeOf("東京工業大学", "F1"))?.name).toBe("東京科学大学");
    expect(names(searchSchools(list, "旭川大学", { stage: "university" }))).toContain("旭川市立大学");
  });
  it("カタカナの名前をひらがなで、旧字体で打っても引ける", () => {
    expect(names(searchSchools(list, "のーとるだむ", { stage: "university" })).some((n) => n.includes("ノートルダム"))).toBe(true);
    expect(names(searchSchools(list, "東京藝術大学", { stage: "university" }))).toContain("東京芸術大学");
  });
  it("同じ名前の学校が多いときは、都道府県・市区町村・設置者で見分ける（候補の2行目）", () => {
    const r = searchSchools(list, "さくら幼稚園", { stage: "kindergarten", limit: 50 });
    const same = r.hits.filter((h) => h.school.name === "さくら幼稚園");
    expect(same.length).toBeGreaterThan(5);
    // 全部一致の学校が先に並ぶ
    expect(r.hits.slice(0, same.length).every((h) => h.school.name === "さくら幼稚園")).toBe(true);
    // 名前が同じ学校どうしは、候補の2行目（都道府県・市区町村・国立公立私立・学校種）で見分けられる
    const subs = same.map((h) => schoolDetail(h.school));
    expect(new Set(subs).size).toBe(subs.length);
    expect(subs[0]).toMatch(/^.+[都道府県].+・(国立|公立|私立)・幼稚園$/);
  });
  it("インターナショナルスクールの段は各種学校も選べる。専門学校の段は専修学校・各種学校", () => {
    const vocational = searchSchools(list, "専門学校", { stage: "vocational", limit: 200 });
    expect(vocational.hits.every((h) => ["H1", "H2"].includes(h.school.kind))).toBe(true);
    const intl = searchSchools(list, "インターナショナル", { stage: "elementary", sector: "international", limit: 200 });
    expect(intl.hits.some((h) => h.school.kind === "H2")).toBe(true);
    expect(searchSchools(list, "インターナショナル", { stage: "elementary", sector: "private", limit: 200 }).hits.some((h) => h.school.kind === "H2")).toBe(false);
  });
  it("ヒアリングシートの自由記述の照合: そのまま探し、無ければ括弧・添え書きを外して探す", () => {
    expect(matchSchoolText(list, "京都大学（第一志望）", { stage: "university" }).hits[0]?.school.name).toBe("京都大学");
    expect(matchSchoolText(list, "京大、同志社", { stage: "university" }).hits[0]?.school.name).toBe("京都大学");
    expect(matchSchoolText(list, "まだ決めていない", { stage: "university" }).total).toBe(0);
  });
  it("小さな見本の一覧でも同じに動く（移行先の循環は今の学校なしと読む）", () => {
    const b: SchoolBundle = {
      pack: "master.education.schools",
      version: "test",
      edition: "test",
      cities: ["架空市"],
      schools: [
        ["F199310000001", "架空大学", 0],
        ["F199310000002", "旧架空大学", 0, "", "2025-05-01", "F199310000003"],
        ["F199310000003", "循環大学", 0, "", "2025-05-01", "F199310000002"],
      ],
      aliases: [["F199310000001", "カクダイ", "abbr"]],
    };
    const l = makeSchoolList(b);
    expect(currentSchool(l, "F199310000002")).toBeNull();
    expect(names(searchSchools(l, "かくだい", { stage: "university" }))).toEqual(["架空大学"]);
    expect(names(searchSchools(l, "循環", { stage: "university" }))).toEqual([]);
  });
});

/** 本人40歳・配偶者・子（2016年5月生まれ）の新しい世帯（推定の進路: 大学だけ私立） */
function fresh(): WorkingHousehold {
  const id = seq();
  let wh = blankHousehold(BASE, id);
  wh = mutate(wh, (h) => void (h.members[0]!.birth.birthYearMonth = "1986-06"));
  wh = withRefreshedEstimates(addMember(wh, "spouse", id));
  wh = withRefreshedEstimates(addChildWithEducation(wh, id));
  return withRefreshedEstimates(mutate(wh, (h) => void (h.members.find((m) => m.kind === "child")!.birth.birthYearMonth = "2016-05")));
}
const goalOf = (wh: WorkingHousehold): Goal => (wh.request.input.household.goals ?? []).find((g) => g.kind === "education")!;
const stagesOf = (wh: WorkingHousehold): EducationStage[] => goalOf(wh).education!.stages;
const stageIndex = (wh: WorkingHousehold, stage: string) => stagesOf(wh).findIndex((s) => s.stage === stage);
const fieldAt = (wh: WorkingHousehold, stage: string, part = "school"): FieldDef => {
  const key = `edu/${goalOf(wh).id}/stage/${stageIndex(wh, stage)}/${part}`;
  const f = allFields(buildStage("education", wh)).find((x) => x.key === key);
  if (f === undefined) throw new Error(`no field ${key}`);
  return f;
};
const eduTotal = (req: EngineRequest) => preview(req).table.filter((c) => c.row.startsWith("cf.expense.education")).reduce((s, c) => s + c.amount, 0);

describe("学校名の欄", () => {
  it("候補の一番上はいつも「学校未定（平均で計算）」。打った文字で候補が出る", () => {
    const wh = fresh();
    const f = fieldAt(wh, "university");
    expect(f.search?.fixed[0]).toEqual(UNDECIDED);
    expect(f.get(wh).value).toBe("");
    expect(f.search?.shown(wh)).toBe("学校未定（平均で計算）");
    const r = f.search!.find(wh, "早稲田");
    expect(r.items[0]?.label).toBe("早稲田大学");
    expect(r.items[0]?.sub).toContain("東京都");
  });
  it("選ぶと学校コードを段に持ち、学費は今までどおり平均で計算する（結果は変わらない）。使っている平均を欄の横に出す", () => {
    const wh = fresh();
    const before = eduTotal(wh.request);
    const code = codeOf("早稲田大学", "F1");
    const f = fieldAt(wh, "university");
    const next = f.set(wh, code);
    const st = stagesOf(next)[stageIndex(next, "university")]!;
    expect(st.school).toEqual({ school: code, unit: code, rows: [], source: { pack: "master.education.schools", version: list.version } });
    expect(st.sector).toBe("private");
    expect(eduTotal(next.request)).toBe(before);
    const g = fieldAt(next, "university").get(next);
    expect(g.value).toBe(code);
    expect(g.hint).toContain("学費の実データはまだ無いので");
    expect(g.hint).toContain("令和7年度入学者");
    expect(g.warn ?? null).toBeNull();
    expect(fieldAt(next, "university").search?.shown(next)).toBe("早稲田大学");
  });
  it("国立の学校を選ぶと、公立・私立の欄を国立に合わせ、大学の学費データで計算する（標準額のままの大学は標準額の計算と端数の数十円のほかは同じ。0219）", () => {
    const wh = fresh();
    const next = fieldAt(wh, "university").set(wh, codeOf("京都大学", "F1"));
    const st = stagesOf(next)[stageIndex(next, "university")]!;
    expect(st.sector).toBe("national");
    expect(fieldAt(next, "university").get(next).hint).toContain("京都大学の公式の学費の案内");
    const std = eduTotal(mutate(wh, (h) => void ((h.goals ?? []).find((g) => g.kind === "education")!.education!.stages.find((s) => s.stage === "university")!.sector = "national")).request);
    expect(Math.abs(eduTotal(next.request) - std)).toBeLessThanOrEqual(50);
  });
  it("「学校未定」に戻すと学校を外す（段の学校の値が無くなる）", () => {
    const wh = fresh();
    const picked = fieldAt(wh, "university").set(wh, codeOf("早稲田大学", "F1"));
    const back = fieldAt(picked, "university").set(picked, "");
    expect(stagesOf(back)[stageIndex(back, "university")]!.school).toBeUndefined();
    expect(fieldAt(back, "university").get(back).value).toBe("");
  });
  it("段に合わない学校・廃止した学校は選べない（理由を出し、世帯は変えない）", () => {
    const wh = fresh();
    const f = fieldAt(wh, "university");
    const hs = codeOf("早稲田大学高等学院", "D1");
    expect(f.refuse?.(wh, hs)).toContain("この学校の行では選べません");
    expect(f.set(wh, hs)).toBe(wh);
    const old = codeOf("東京工業大学", "F1");
    expect(f.refuse?.(wh, old)).toContain("廃止");
    expect(f.set(wh, old)).toBe(wh);
  });
  it("前に入った廃止した学校のコードは黙って書き換えず、移行先にするボタンを出す", () => {
    const wh = fresh();
    const old = codeOf("東京工業大学", "F1");
    const withOld = mutate(wh, (h) => {
      const st = (h.goals ?? []).find((g) => g.kind === "education")!.education!.stages.find((s) => s.stage === "university")!;
      st.school = { school: old, unit: old, rows: [], source: { pack: "master.education.schools", version: "2026.1.0" } } as unknown as EducationStage["school"];
    });
    const g = fieldAt(withOld, "university").get(withOld);
    expect(g.value).toBe(old);
    expect(g.warn).toContain("東京科学大学に移っています");
    const fixed = g.warnFix!.run(withOld);
    expect((stagesOf(fixed)[stageIndex(fixed, "university")]!.school as { school: string }).school).toBe(codeOf("東京科学大学", "F1"));
  });
  it("選んだ学校と公立・私立の欄が合わなくなったら知らせる", () => {
    const wh = fresh();
    const picked = fieldAt(wh, "university").set(wh, codeOf("早稲田大学", "F1"));
    const changed = mutate(picked, (h) => void ((h.goals ?? []).find((g) => g.kind === "education")!.education!.stages.find((s) => s.stage === "university")!.sector = "public"));
    expect(fieldAt(changed, "university").get(changed).warn).toContain("選んだ学校は私立ですが");
  });
  it("古い世帯（学校名が空）はそのまま読み、学校未定で見せる。学部・学科の一覧が無い学校には学部・学科の欄を出さない", () => {
    const wh = fresh();
    expect(stagesOf(wh).every((s) => s.school === undefined)).toBe(true);
    expect(fieldAt(wh, "highSchool").get(wh).value).toBe("");
    const picked = fieldAt(wh, "university").set(wh, codeOf("早稲田大学", "F1"));
    expect(() => fieldAt(picked, "university", "unit")).toThrow();
  });
  it("保育園の段には学校名の欄を出さない（保育所は学校コードが無い）", () => {
    const wh = fresh();
    const keys = allFields(buildStage("education", wh)).map((f) => f.key);
    const nursery = stagesOf(wh).findIndex((s) => s.stage === "nursery");
    if (nursery >= 0) expect(keys).not.toContain(`edu/${goalOf(wh).id}/stage/${nursery}/school`);
  });
  it("ヒアリングシートの学校名（取り込みの記録の元の文字）を、学校未定の欄に出して候補を探す言葉にする", () => {
    const wh = fresh();
    const child = wh.request.input.household.members.find((m) => m.kind === "child")!;
    const withHearing: WorkingHousehold = {
      ...wh,
      hearing: {
        requests: [],
        consents: [],
        imports: [
          {
            kind: "hearing",
            requestId: "r",
            sheetId: "full",
            sheetVersion: 5,
            layoutDigest: "x",
            exportedOn: "2026-10-01",
            approvedAt: "2026-10-02T00:00:00Z",
            answers: [
              { key: "hs.family.child.birthYearMonth", index: 1, status: "value", raw: { kind: "number", text: "2016" }, raw2: { kind: "number", text: "5" } },
              { key: "hs.education.school", index: 1, status: "value", raw: { kind: "text", text: "早稲田大学（第一志望）" } },
            ],
          },
        ],
      } as unknown as WorkingHousehold["hearing"],
    };
    expect(hearingSchoolText(withHearing, child.id)).toBe("早稲田大学（第一志望）");
    const f = fieldAt(withHearing, "university");
    expect(f.get(withHearing).hint).toBe("ヒアリングシートの学校名: 早稲田大学（第一志望）");
    const init = f.search!.initial!(withHearing)!;
    expect(init.title).toContain("早稲田大学（第一志望）");
    expect(matchSchoolText(list, init.query, { stage: "university" }).hits[0]?.school.name).toBe("早稲田大学");
  });
});
