// 書類を読む AI 向けの説明書と書類ごとの手引き（0152）: SDK フォルダの文書の中の答えの見本が、1本目の読み口（readProposal）を
// 理由なしで通り、番号を1つも落とさず（見本に番号を入れていない）、入力の欄の一覧（fields.md）にある入力項目・場所だけを使い、
// 見本の世帯で FP が承認していくと、読めなかった欄のほかは全部が入力に入ること。欄の一覧が今の入力の画面の定義と同じであること。
// 読めるのは保険証券・ご契約内容のお知らせ・設計書だけ（0159）なので、手引きは保険の1つだけ
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildDocumentFields, DOCUMENT_FIELDS_PATH } from "../scripts/documentFields.ts";
import { REPO_DIR } from "../scripts/lib.ts";
import { readProposalText, type ProposalContext } from "../src/workspace/documents/proposal.ts";
import { acceptCandidates, acceptObject, docReview, type Chosen } from "../src/workspace/documents/review.ts";
import { DOC_TYPES, PROPOSAL_CONTRACT, type DocumentReading } from "../src/workspace/documents/types.ts";
import { fromRequest, type WorkingHousehold } from "../src/workspace/input/household.ts";
import { roles } from "../src/workspace/roles.ts";
import { modelHousehold } from "./helpers.ts";

const SDK = join(REPO_DIR, "sdk");
const SKILL = join(SDK, "skills", "read-documents");
const GUIDES = join(SKILL, "guides");
const AT = "2026-11-07T10:00:00+09:00";
let n = 0;
const newId = () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`;

const text = (path: string): string => readFileSync(path, "utf8");
const guideFiles = (): string[] =>
  readdirSync(GUIDES)
    .filter((f) => f.endsWith(".md"))
    .sort();

/** 文書の中の ```json の囲みのうち、答えの形（contract のある物）だけ */
function answers(md: string): string[] {
  return [...md.matchAll(/```json\n([\s\S]*?)```/gu)].map((m) => m[1] as string).filter((s) => s.includes('"contract"'));
}

const DOCS = (): { name: string; md: string }[] => [
  { name: "docs/document-reading.md", md: text(join(SDK, "docs", "document-reading.md")) },
  { name: "skills/read-documents/SKILL.md", md: text(join(SKILL, "SKILL.md")) },
  ...guideFiles().map((f) => ({ name: `skills/read-documents/guides/${f}`, md: text(join(GUIDES, f)) })),
  // AI接続口の道具（propose_inputs）のテストで道具に通す見本の答えも、手引きと同じ決まりにそろえる（0151）
  { name: "crates/lifeplan/tests/fixtures/propose-inputs/answer.json", md: `\`\`\`json\n${text(join(REPO_DIR, "crates", "lifeplan", "tests", "fixtures", "propose-inputs", "answer.json"))}\`\`\`` },
];

const open = (id: string): WorkingHousehold => fromRequest(modelHousehold(id));
const ctx = (wh: WorkingHousehold): ProposalContext => ({ via: "paste", at: AT, newId, connector: "テストの AI", members: roles(wh.request).map((r) => ({ key: r.key, id: r.member.id })) });

/** 欄の一覧の表の行（入力項目ID・場所・額の期間） */
function fieldRows(): { item: string; at: string[] | null; period: string }[] {
  const rows: { item: string; at: string[] | null; period: string }[] = [];
  for (const line of text(DOCUMENT_FIELDS_PATH).split("\n")) {
    const m = /^\| `([a-zA-Z.]+)`（[^|]*） \| ([^|]+) \| [^|]* \| [^|]* \| ([^|]*) \|/u.exec(line);
    if (m === null) continue;
    const at = (m[2] as string).trim();
    rows.push({ item: m[1] as string, at: at === "（なし）" ? null : (JSON.parse(at.replace(/^`|`$/gu, "")) as string[]).filter((x) => x !== "<ID>"), period: (m[3] as string).trim() });
  }
  return rows;
}

const PERIOD_WORDS: Record<string, string> = { annual: "年額", monthly: "月額", once: "1回の額・時点の額" };

describe("欄の一覧（fields.md）", () => {
  it("今の入力の画面の定義から作り直した物と同じ（違えば npm run gen:document-fields で書き直す）", () => {
    expect(text(DOCUMENT_FIELDS_PATH)).toBe(buildDocumentFields());
  });

  it("保険の契約の主な欄だけが載っている（0159。年金・給与・事業所得・ローンなどの欄は載せない）", () => {
    const rows = fieldRows();
    const keys = new Set(rows.map((r) => `${r.item}|${(r.at ?? []).join("/")}`));
    for (const k of ["insurance.label|", "insurance.contractDate|", "insurance.premium|frequency", "insurance.premium|amount", "insurance.coverages|amount", "insurance.deductionCategory|type"]) expect(keys).toContain(k);
    expect(rows.every((r) => r.item.startsWith("insurance."))).toBe(true);
    expect(text(DOCUMENT_FIELDS_PATH)).not.toMatch(/debt:mortgage|account:ideco/u);
  });
});

describe("説明書と手引きの答えの見本", () => {
  it("手引きは保険の書類の1つだけで、読む欄・読まないもの・答えの見本を持つ。スキルの表の手引きはどれもある", () => {
    const files = guideFiles();
    expect(files).toEqual(["insurance-policy.md"]);
    for (const f of files) {
      const md = text(join(GUIDES, f));
      expect(md).toMatch(/## \d\. 読まないもの/u);
      expect(md).toMatch(/## \d\. 答えの見本（架空の値）/u);
      expect(answers(md).length).toBeGreaterThan(0);
    }
    const skill = text(join(SKILL, "SKILL.md"));
    for (const m of skill.matchAll(/\]\((guides\/[a-z-]+\.md|fields\.md|\.\.\/\.\.\/docs\/[a-z-]+\.md)\)/gu)) expect(() => readFileSync(join(SKILL, m[1] as string))).not.toThrow();
    for (const m of skill.matchAll(/`([a-zA-Z]+)`・?`?([a-zA-Z]+)?`? \| \[guides/gu)) for (const t of [m[1], m[2]]) if (t !== undefined) expect(DOC_TYPES.some((d) => d.value === t)).toBe(true);
  });

  it("答えの見本はどれも読み口を理由なしで通り、番号を落とさない（見本に番号・名前を入れていない）", () => {
    const wh = open("salariedCoupleTwoKids");
    let count = 0;
    for (const { name, md } of DOCS()) {
      for (const a of answers(md)) {
        const r = readProposalText(`読みました。\n\`\`\`json\n${a}\`\`\``, ctx(wh));
        expect(r.issues, name).toEqual([]);
        expect(r.reading, name).not.toBeNull();
        expect(r.reading!.dropped, name).toBe(0);
        expect(JSON.parse(a).contract).toBe(PROPOSAL_CONTRACT);
        count++;
      }
    }
    expect(count).toBeGreaterThanOrEqual(3);
  });

  it("見本の入力項目・場所は欄の一覧にあり、円の欄の期間は一覧の額の期間と同じ", () => {
    const rows = fieldRows();
    for (const { name, md } of DOCS()) {
      for (const a of answers(md)) {
        const raw = JSON.parse(a) as { values?: { item: string; at?: string[]; period?: string; value: unknown }[] };
        for (const v of raw.values ?? []) {
          const at = v.at ?? null;
          const hit = rows.filter((r) => r.item === v.item && JSON.stringify(r.at) === JSON.stringify(at));
          expect(hit.length, `${name}: ${v.item} ${JSON.stringify(at)}`).toBeGreaterThan(0);
          if (v.period !== undefined) expect(hit.map((r) => r.period), `${name}: ${v.item}`).toContain(PERIOD_WORDS[v.period]);
        }
      }
    }
  });
});

/** 見本ごとの、FP が承認していく世帯と、当てる欄を選ぶときの言葉 */
const WALKS: { file: string; index: number; household: string; choose?: string; missing?: string[] }[] = [
  { file: "insurance-policy.md", index: 0, household: "salariedCoupleTwoKids" },
  { file: "insurance-policy.md", index: 0, household: "single45" },
];

/**
 * FP が確かめの画面でする操作をまねる: 新しい物を足し、当てる欄が何本もある行は最初の選択肢（choose の言葉があればそれを含む物）を選び、
 * 承認できる行を1つずつ承認する（種類を決める行を承認すると、ほかの行の当て先が変わるので、進まなくなるまで繰り返す）
 */
function walk(wh0: WorkingHousehold, reading: DocumentReading, choose?: string): { wh: WorkingHousehold; reading: DocumentReading; failed: string[] } {
  let wh = wh0;
  let r = reading;
  for (const o of r.objects) {
    const a = acceptObject(wh, r, o.key, AT);
    if (a === null) throw new Error(`足せない物 ${o.kind}`);
    wh = a.wh;
    r = a.reading;
  }
  const chosen: Record<string, string> = {};
  let failed: string[] = [];
  for (let pass = 0; pass < 6; pass++) {
    let progressed = false;
    failed = [];
    for (const c of r.candidates) {
      if (c.status !== "pending" || c.unreadable === true) continue;
      const row = docReview(wh, r, chosen as Chosen)
        .groups.flatMap((g) => g.rows)
        .find((x) => x.id === c.id);
      if (row?.choices !== undefined && row.choices.length > 0 && chosen[c.id] === undefined) chosen[c.id] = (row.choices.find((x) => choose !== undefined && x.label.includes(choose)) ?? row.choices[0])!.id;
      const res = acceptCandidates(wh, r, [c.id], chosen as Chosen, AT);
      if (res.count === 1) {
        wh = res.wh;
        r = res.reading;
        progressed = true;
      } else failed.push(...res.failed);
    }
    if (!progressed) break;
  }
  return { wh, reading: r, failed };
}

describe("見本の世帯で FP が承認していくと、読めなかった欄のほかは全部が入力に入る", () => {
  for (const w of WALKS) {
    it(`${w.file} の見本 ${w.index + 1}（${w.household}）${w.missing !== undefined ? `。欄の無い候補: ${w.missing.join("・")}` : ""}`, () => {
      const wh = open(w.household);
      const a = answers(text(join(GUIDES, w.file)))[w.index] as string;
      const read = readProposalText(a, ctx(wh));
      const res = walk(wh, read.reading!, w.choose);
      const left = res.reading.candidates.filter((c) => c.status === "pending" && c.unreadable !== true);
      expect(left.map((c) => `${c.target.item} ${JSON.stringify(c.target.at ?? [])}`), JSON.stringify(res.failed)).toEqual(w.missing ?? []);
      if (w.missing !== undefined) expect([...new Set(res.failed)]).toEqual(["この世帯に、この値を入れる欄がありません"]);
      // 承認した値は、出どころ AI・確かさ「書類で確認」の値として入る
      expect(res.wh).not.toBe(wh);
      const stored = JSON.stringify(res.wh.request.input);
      expect(stored).toContain('"certainty":"document"');
    });
  }

  it("保険証券: 新しい終身保険が1件足され、主契約の死亡保険金・払い方・保険料・払込免除が入る（特約は照合だけ）", () => {
    const wh = open("salariedCoupleTwoKids");
    const a = answers(text(join(GUIDES, "insurance-policy.md")))[0] as string;
    const res = walk(wh, readProposalText(a, ctx(wh)).reading!);
    const before = new Set((wh.request.input.household.insuranceContracts ?? []).map((c) => c.id));
    const added = (res.wh.request.input.household.insuranceContracts ?? []).filter((c) => !before.has(c.id));
    expect(added).toHaveLength(1);
    const c = added[0] as unknown as { label: string; premium: { mode?: string; frequency?: string; amount: unknown }; coverages: { role: string; amount: unknown }[]; waiver?: boolean };
    expect(c.label).toBe("架空のさくら生命 終身保険");
    expect(JSON.stringify(c.premium)).toContain("8900");
    expect(JSON.stringify(c.coverages.find((x) => x.role === "main")?.amount)).toContain("3000000");
    expect(res.reading.references.map((x) => x.label)).toEqual(["特約: 定期保険特約 死亡保険金"]);
  });

  it("AI接続口の道具の見本の答え（医療保険・読めなかった欄つき）も、読めなかった欄のほかは全部が入る", () => {
    const wh = open("salariedCoupleTwoKids");
    const a = text(join(REPO_DIR, "crates", "lifeplan", "tests", "fixtures", "propose-inputs", "answer.json"));
    const res = walk(wh, readProposalText(a, ctx(wh)).reading!);
    expect(res.reading.candidates.filter((c) => c.status === "pending").map((c) => c.unreadable)).toEqual([true]);
  });
});

describe("当て先の決め方の足し（0152 の3）", () => {
  const reading = (wh: WorkingHousehold, values: unknown[], objects: unknown[] = []): DocumentReading =>
    readProposalText(JSON.stringify({ contract: PROPOSAL_CONTRACT, docType: "insurancePolicy", holder: "self", objects, values }), ctx(wh)).reading!;

  it("場所を書かない候補は場所の無い欄を先にする（保険の払い方）。明細の ID を除いた場所でも当たる（主契約の保障の額）", () => {
    const wh = open("salariedCoupleTwoKids");
    const r = reading(wh, [{ item: "insurance.premium", at: ["frequency"], newObject: "c1", value: "annual" }, { item: "insurance.coverages", at: ["amount"], newObject: "c1", value: 10000, period: "once" }], [{ key: "c1", kind: "insurance:term" }]);
    const added = acceptObject(wh, r, "c1", AT)!;
    const rows = docReview(added.wh, added.reading).groups.flatMap((g) => g.rows);
    expect(rows.map((x) => [x.label.split(": ").at(-1), x.problem])).toEqual([
      ["払い方", null],
      ["死亡保険金", null],
    ]);
  });

  it("人も物も書かない候補で世帯で1つの欄が無ければ、その入力項目の欄から FP が選ぶ（1本でも選ぶ）", () => {
    const wh = open("salariedCoupleTwoKids");
    const row = docReview(wh, reading(wh, [{ item: "insurance.premium", at: ["amount"], value: 15000, period: "once" }])).groups[0]!.rows[0]!;
    expect(row.problem).toBe("当てる欄を選んでください");
    expect(row.choices).toHaveLength(1);
  });

  it("同じ入力項目の選択の欄が何本も当たるときは、値を選択肢に持つ欄に絞る（保険料控除の区分と新旧の制度）", () => {
    const wh = open("salariedCoupleTwoKids");
    const contract = (wh.request.input.household.insuranceContracts ?? [])[0]!.id;
    const [type, regime] = docReview(wh, reading(wh, [{ item: "insurance.deductionCategory", object: contract, value: "careMedical" }, { item: "insurance.deductionCategory", object: contract, value: "old" }])).groups.flatMap((g) => g.rows);
    expect([type!.label.split(": ").at(-1), type!.problem]).toEqual(["保険料控除の区分", null]);
    expect([regime!.label.split(": ").at(-1), regime!.problem]).toEqual(["新旧の制度", null]);
  });
});
