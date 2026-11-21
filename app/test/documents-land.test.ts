// 土地・建物の書類の読み取り（0235）: 固定資産税の課税明細書と路線価図（国税庁）を AI に読ませた答えを、相続税の試算の不動産ごとの欄（0231 の lands[]）の
// 候補にする。読み口の決まり（読む場所・伏せる情報・課税標準額を読まない・地積と価格の整え方・路線価図の記号の読み方）、書類の土地を今ある不動産に入れる、
// FP の承認が無いと入らない、承認しても値の状態の行を書かない、欄が無いときの理由、手引きと見本の答え
import { h } from "preact";
import { renderToString } from "preact-render-to-string";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { REPO_DIR } from "../scripts/lib.ts";
import { DocumentEntry, DocumentReview } from "../src/workspace/documents/DocumentReview.tsx";
import { pendingTotal, readDocumentLog, withDocumentLog, withReading } from "../src/workspace/documents/log.ts";
import { LAND_OBJECT_KIND, LEASEHOLD_RATIOS, maskPlace, normalizeArea, normalizeYen, parseRouteMark } from "../src/workspace/documents/land.ts";
import { readProposal, type ProposalContext } from "../src/workspace/documents/proposal.ts";
import { acceptCandidates, acceptObject, correctCandidate, docReview, linkObject, type Chosen } from "../src/workspace/documents/review.ts";
import { DOC_TYPES, LAND_ITEM, PROPOSAL_CONTRACT, readableDocsLine, type DocCandidate, type DocumentReading } from "../src/workspace/documents/types.ts";
import { bulkEligible } from "../src/workspace/review/rows.ts";
import { fromRequest, type WorkingHousehold } from "../src/workspace/input/household.ts";
import { landTargets, setDetailed } from "../src/workspace/input/inheritanceLand.ts";
import { roles } from "../src/workspace/roles.ts";
import type { InheritanceLandSetting } from "../src/engine/types.ts";
import { modelHousehold, readAnswerText } from "./helpers.ts";

const AT = "2026-11-20T10:00:00+09:00";
let n = 0;
const newId = () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`;
const ctx = (wh: WorkingHousehold, o: Partial<ProposalContext> = {}): ProposalContext => ({ via: "ai", at: AT, newId, connector: "テストの AI", members: roles(wh.request).map((r) => ({ key: r.key, id: r.member.id })), ...o });

const base = fromRequest(modelHousehold("rentalSample"));
const on = setDetailed(base, true);
const home = base.request.input.household.residences!.find((r) => r.kind === "own")!;
const prop = base.request.input.household.accounts!.find((a) => a.kind === "realEstate" && a.property?.rental !== undefined)!;
const landOf = (wh: WorkingHousehold, object: string): InheritanceLandSetting | undefined => wh.request.input.inheritanceTax?.lands?.find((l) => l.object === object);

const GUIDES = join(REPO_DIR, "sdk", "skills", "read-documents", "guides");
const answerIn = (file: string): string => {
  const m = /```json\n([\s\S]*?)```/u.exec(readFileSync(join(GUIDES, file), "utf8"));
  return m![1] as string;
};

const statement = (values: unknown[], extra: Record<string, unknown> = {}) => ({ contract: PROPOSAL_CONTRACT, docType: "propertyTaxStatement", objects: [{ key: "s1", kind: LAND_OBJECT_KIND }], values, ...extra });
const routeMap = (values: unknown[], extra: Record<string, unknown> = {}) => ({ contract: PROPOSAL_CONTRACT, docType: "routePriceMap", objects: [{ key: "r1", kind: LAND_OBJECT_KIND }], values, ...extra });
const land = (name: string, value: unknown, o: Record<string, unknown> = {}) => ({ item: LAND_ITEM, at: ["lands", name], newObject: "s1", value, confidence: "high", source: { page: 1, where: "土地 価格" }, ...o });
const mark = (value: unknown, o: Record<string, unknown> = {}) => ({ item: LAND_ITEM, at: ["lands", "routeMark"], newObject: "r1", value, confidence: "high", source: { page: 12, where: "正面の路線の路線価", text: String(value) }, ...o });
const read = (wh: WorkingHousehold, raw: unknown): DocumentReading => {
  const r = readProposal(raw, ctx(wh));
  if (r.reading === null) throw new Error(JSON.stringify(r.issues));
  return r.reading;
};
const byName = (r: DocumentReading, name: string): DocCandidate[] => r.candidates.filter((c) => c.target.at?.[1] === name);
const rowsOf = (wh: WorkingHousehold, r: DocumentReading, chosen: Chosen = {}) => docReview(wh, r, chosen).groups.flatMap((g) => g.rows);
const linked = (wh: WorkingHousehold, r: DocumentReading, key: string, object: string): DocumentReading => {
  const x = linkObject(wh, r, key, object, AT);
  if (x === null) throw new Error("link");
  return x;
};

describe("路線価図の記号（国税庁の決まり。数は千円単位・記号は借地権割合）", () => {
  it("記号と割合は A 90%・B 80%・C 70%・D 60%・E 50%・F 40%・G 30%", () => {
    expect(LEASEHOLD_RATIOS).toEqual({ A: 90, B: 80, C: 70, D: 60, E: 50, F: 40, G: 30 });
    for (const k of Object.keys(LEASEHOLD_RATIOS)) expect(parseRouteMark(`100${k}`)).toEqual({ yen: 100_000, ratio: k });
    expect(Object.keys(LEASEHOLD_RATIOS).map((k) => LEASEHOLD_RATIOS[k as keyof typeof LEASEHOLD_RATIOS])).toEqual([90, 80, 70, 60, 50, 40, 30]);
  });

  it("千円単位の数を円にする（250 → 1㎡あたり 250,000円）。全角・小文字・空白・桁区切り・「千円」も読む", () => {
    expect(parseRouteMark("250C")).toEqual({ yen: 250_000, ratio: "C" });
    expect(parseRouteMark("２５０Ｃ")).toEqual({ yen: 250_000, ratio: "C" });
    expect(parseRouteMark("250c")).toEqual({ yen: 250_000, ratio: "C" });
    expect(parseRouteMark("２５０ｃ")).toEqual({ yen: 250_000, ratio: "C" });
    expect(parseRouteMark(" 250 C ")).toEqual({ yen: 250_000, ratio: "C" });
    expect(parseRouteMark("1,250A")).toEqual({ yen: 1_250_000, ratio: "A" });
    expect(parseRouteMark("250千円D")).toEqual({ yen: 250_000, ratio: "D" });
    expect(parseRouteMark("45")).toEqual({ yen: 45_000, ratio: null });
  });

  it("読めない記号（A〜G でない・0・数が無い・桁が多すぎる）は null", () => {
    for (const s of ["250H", "250CC", "C250", "0C", "", "倍率", "1234567A", "250.5C"]) expect(parseRouteMark(s), s).toBeNull();
  });
});

describe("課税明細書の地積・価格の整え方", () => {
  it("地積は ㎡ の10進の文字（小数2桁まで。3桁目からは切り捨て）。全角・桁区切り・㎡ を許す。0 は読まない", () => {
    expect(normalizeArea("165.29")).toEqual({ text: "165.29", truncated: false });
    expect(normalizeArea(165.29)).toEqual({ text: "165.29", truncated: false });
    expect(normalizeArea("１６５．２９㎡")).toEqual({ text: "165.29", truncated: false });
    expect(normalizeArea("210.00")).toEqual({ text: "210", truncated: false });
    expect(normalizeArea("165.10")).toEqual({ text: "165.1", truncated: false });
    // 持分をかけた地積（敷地 1,200㎡×持分 6,543/100,000 = 78.516）
    expect(normalizeArea("78.516")).toEqual({ text: "78.51", truncated: true });
    expect(normalizeArea("1,234.567")).toEqual({ text: "1234.56", truncated: true });
    for (const v of ["0", "0.00", 0, "-1", "abc", "12345678"]) expect(normalizeArea(v), String(v)).toBeNull();
  });

  it("価格は円の整数（桁区切り・「円」・全角を許す）。0円も読む。小数・負の数は読まない", () => {
    expect(normalizeYen(18_450_000)).toBe(18_450_000);
    expect(normalizeYen("18,450,000円")).toBe(18_450_000);
    expect(normalizeYen("１８，４５０，０００")).toBe(18_450_000);
    expect(normalizeYen(0)).toBe(0);
    expect(normalizeYen("0円")).toBe(0);
    for (const v of [-1, 1.5, "1.5", "abc", true]) expect(normalizeYen(v as never), String(v)).toBeNull();
  });
});

describe("読み口: 課税明細書", () => {
  it("手引きの見本は理由なしで通り、地積・価格・家屋の価格が候補になる（複数筆の合計・筆ごとの価格は照合だけ）", () => {
    const r = readAnswerText(answerIn("property-tax-statement.md"), ctx(on));
    expect(r.issues).toEqual([]);
    const reading = r.reading!;
    expect(reading.docType).toBe("propertyTaxStatement");
    expect(reading.asOf).toBe("2026-01");
    expect(reading.objects.map((o) => o.kind)).toEqual([LAND_OBJECT_KIND, LAND_OBJECT_KIND]);
    expect(reading.candidates.map((c) => [c.target.newObject, c.target.at?.[1], c.value])).toEqual([
      ["s1", "area", "165.29"],
      ["s1", "fixedValue", 18_450_000],
      ["s1", "buildingValue", 6_230_000],
      ["s2", "area", "210"],
      ["s2", "fixedValue", 15_120_000],
    ]);
    expect(reading.candidates.filter((c) => c.target.at?.[1] !== "area").every((c) => c.period === "once")).toBe(true);
    expect(reading.references.map((x) => x.amount)).toEqual([13_450_000, 5_000_000]);
    expect(reading.dropped).toBe(0);
  });

  it("課税標準額・税額の見出しの候補は読まない（倍率方式に使うのは価格〔固定資産税評価額〕）", () => {
    const r = readProposal(statement([land("fixedValue", 3_000_000, { source: { where: "固定 本年度課税標準額" } }), land("fixedValue", 4_000_000, { source: { where: "固定資産税 相当税額" } }), land("fixedValue", 18_000_000)]), ctx(on));
    expect(r.reading!.candidates.map((c) => c.value)).toEqual([18_000_000]);
    expect(r.issues).toContain("課税標準額・税額の候補（相続税の評価には「価格」〔固定資産税評価額〕を使います）");
  });

  it("所有者・納税義務者・所在・地番などの見出しの候補は落とし、文字の中の地番らしい所は伏せる（数だけ残す）", () => {
    const r = readProposal(
      statement(
        [
          land("area", "165.29", { source: { where: "所在地番", text: "架空町123番4" } }),
          land("area", "165.29", { source: { where: "納税義務者", text: "架空 太郎" } }),
          land("area", "165.29", { source: { where: "家屋番号" } }),
          land("area", "165.29", { source: { where: "土地 現況地積", text: "架空町1丁目2番3号 165.29" }, note: "12番地の3 の筆と足しました" }),
          land("fixedValue", "架空町5番6", { source: { where: "土地 価格" } }),
        ],
        { references: [{ label: "所在 架空町", amount: 1 }, { label: "土地 7番8 の価格", amount: 5_000_000 }] },
      ),
      ctx(on),
    );
    const reading = r.reading!;
    expect(reading.candidates).toHaveLength(1);
    const c = reading.candidates[0]!;
    expect(c.source.text).not.toMatch(/[0-9]番|丁目/u);
    expect(c.note).not.toMatch(/[0-9]番|丁目/u);
    expect(c.source.text).toContain("●●●●");
    expect(reading.references.map((x) => x.label)).toEqual(["土地 ●●●● の価格"]);
    expect(JSON.stringify(reading)).not.toMatch(/架空 太郎|123番4|5番6|7番8|所在 架空町/u);
    expect(reading.dropped).toBeGreaterThanOrEqual(5);
    expect(maskPlace("保険料 1,200円").masked).toBe(false);
  });

  it("地積の小数（持分をかけた値）は小数2桁までに切り捨てて添え書きに書く。価格0円は添え書きを付けて、まとめての承認に入れない", () => {
    const r = read(on, statement([land("area", "78.5204"), land("fixedValue", 0), land("buildingValue", "6,230,000円")]));
    expect(byName(r, "area")[0]!.value).toBe("78.52");
    expect(byName(r, "area")[0]!.note).toContain("小数3桁目から切り捨てました");
    expect(byName(r, "fixedValue")[0]!.value).toBe(0);
    expect(byName(r, "fixedValue")[0]!.confidence).toBe("medium");
    expect(byName(r, "fixedValue")[0]!.note).toContain("0円");
    expect(byName(r, "buildingValue")[0]!.value).toBe(6_230_000);
    const linkedR = linked(on, r, "s1", home.id);
    const zero = rowsOf(on, linkedR).find((x) => x.id === byName(r, "fixedValue")[0]!.id)!;
    expect(bulkEligible(zero)).toBe(false);
  });

  it("読めない値・読む場所でない候補・ほかの書類の欄は読まない", () => {
    const r = readProposal(
      statement([
        land("area", "abc"),
        land("fixedValue", "高い"),
        land("use", "residence"),
        land("routeMark", "250C"),
        { item: "insurance.premium", at: ["amount"], newObject: "s1", value: 1000 },
        land("area", null, { unreadable: true }),
      ]),
      ctx(on),
    );
    expect(r.reading!.candidates.map((c) => [c.target.at?.[1], c.unreadable === true])).toEqual([["area", true]]);
    expect(r.issues).toEqual(
      expect.arrayContaining([
        "地積として読めない候補（㎡の数で書いてください）",
        "価格として読めない候補（円の整数で書いてください）",
        'この書類で読めない場所の候補（読めるのは ["lands", "area"]・["lands", "fixedValue"]・["lands", "buildingValue"] だけです）',
        "相続税の試算の土地・建物の欄でない候補（この書類で読めるのは土地・建物の欄だけです）",
      ]),
    );
  });

  it("保険の書類の答えに土地の欄・書類の土地は書けない。土地の書類に保険の契約は書けない", () => {
    const a = readProposal({ contract: PROPOSAL_CONTRACT, docType: "insurancePolicy", values: [land("area", "100", { newObject: undefined })] }, ctx(on));
    expect(a.reading).toBeNull();
    expect(a.issues).toContain("保険の契約の欄でない候補（保険の書類で読めるのは保険の契約の欄だけです）");
    const b = readProposal({ contract: PROPOSAL_CONTRACT, docType: "insurancePolicy", objects: [{ key: "s1", kind: LAND_OBJECT_KIND }], values: [{ item: "insurance.label", newObject: "s1", value: "x" }] }, ctx(on));
    expect(b.issues).toContain("作れない種類の新しい物の候補");
    const c = readProposal(statement([land("area", "100")], { objects: [{ key: "s1", kind: "insurance:medical" }] }), ctx(on));
    expect(c.issues).toContain(`この書類で読めない種類の物の候補（土地・建物の書類の物は ${LAND_OBJECT_KIND} だけです）`);
  });

  it("土地の欄には人を書かない（書いても読まない）", () => {
    const r = read(on, statement([land("area", "100", { member: "self" })]));
    expect(r.candidates[0]!.target.member).toBeUndefined();
  });
});

describe("読み口: 路線価図", () => {
  it("手引きの見本（250C）は、土地の評価の入れ方・路線価 250,000円・借地権割合 C の3つの候補になる", () => {
    const r = readAnswerText(answerIn("route-price-map.md"), ctx(on));
    expect(r.issues).toEqual([]);
    const reading = r.reading!;
    expect(reading.candidates.map((c) => [c.target.at?.[1], c.value])).toEqual([
      ["method", "routePrice"],
      ["routePrice", 250_000],
      ["leaseholdRatio", "C"],
    ]);
    expect(byName(reading, "routePrice")[0]!.note).toContain("1平方メートルあたり250,000円");
    expect(byName(reading, "leaseholdRatio")[0]!.note).toContain("借地権割合 70%");
    // AI の添え書き（側方の路線）は残す
    expect(byName(reading, "routePrice")[0]!.note).toContain("側方の路線 200D");
  });

  it("記号の小文字・全角も同じに読む。ページ（図の番号）は残さない", () => {
    for (const v of ["250c", "２５０Ｃ", "２５０ｃ"]) {
      const r = read(on, routeMap([mark(v)]));
      expect(r.candidates.map((c) => c.value), v).toEqual(["routePrice", 250_000, "C"]);
      expect(r.candidates.every((c) => c.source.page === undefined)).toBe(true);
    }
  });

  it("読めなかった記号は、評価の入れ方のほかは読めなかった欄にする（推測で埋めない）。記号の無い路線価は借地権割合だけ読めなかった欄", () => {
    const blank = read(on, routeMap([mark(null, { unreadable: true })]));
    expect(blank.candidates.map((c) => [c.target.at?.[1], c.value, c.unreadable === true])).toEqual([
      ["method", "routePrice", false],
      ["routePrice", null, true],
      ["leaseholdRatio", null, true],
    ]);
    const bad = read(on, routeMap([mark("250H")]));
    expect(bad.candidates.map((c) => c.unreadable === true)).toEqual([false, true, true]);
    expect(bad.candidates[1]!.note).toContain("路線価図の記号として読めませんでした");
    const noRatio = read(on, routeMap([mark("45")]));
    expect(noRatio.candidates.map((c) => [c.value, c.unreadable === true])).toEqual([
      ["routePrice", false],
      [45_000, false],
      [null, true],
    ]);
  });

  it("数で書いた路線価（千円か円か分からない）は読まずに理由を出す", () => {
    const r = readProposal(routeMap([mark(250_000)]), ctx(on));
    expect(r.reading).toBeNull();
    expect(r.issues).toContain("路線価は、路線価図の記号のまま文字で書いてください（例「250C」。数は千円単位）");
  });

  it("路線価図で読める場所は記号だけ（路線価・借地権割合を直接書いた候補は読まない）", () => {
    const r = readProposal(routeMap([{ ...mark("250C"), at: ["lands", "routePrice"] }]), ctx(on));
    expect(r.reading).toBeNull();
    expect(r.issues[0]).toContain('["lands", "routeMark"]');
  });
});

describe("確かめの画面: 書類の土地を今ある不動産に入れ、FP が承認したものだけが入る", () => {
  const statementReading = () => read(on, JSON.parse(answerIn("property-tax-statement.md")));

  it("書類の土地は新しく足せない。入れられるのは持ち家と住まい以外の不動産（相続税の試算の対象と同じ並び）", () => {
    const r = statementReading();
    expect(acceptObject(on, r, "s1", AT)).toBeNull();
    const view = docReview(on, r);
    const g = view.groups.find((x) => x.object?.key === "s1")!;
    expect(g.object!.linkOnly).toBe(true);
    expect(g.object!.links.map((t) => t.id)).toEqual(landTargets(on.request.input.household).map((t) => t.object));
    expect(g.object!.similar).toEqual([]);
    expect(g.rows.every((x) => x.problem === "先に、どの不動産の書類かを選んでください")).toBe(true);
    expect(linkObject(on, r, "s1", "00000000-0000-4000-8000-ffffffffffff", AT)).toBeNull();
  });

  it("不動産を選ぶまで・承認するまでは、世帯は1文字も変わらない", () => {
    const r = statementReading();
    const before = JSON.stringify(on.request);
    const res = acceptCandidates(on, r, r.candidates.map((c) => c.id), {}, AT);
    expect(res.count).toBe(0);
    expect(res.failed).toContain("足していない物の候補");
    const l = linked(on, r, "s1", home.id);
    expect(JSON.stringify(on.request)).toBe(before);
    expect(l.objects.find((o) => o.key === "s1")).toMatchObject({ status: "accepted", created: home.id, linked: true });
  });

  it("持ち家に入れて承認すると、地積・家屋の価格が lands に入る。値の状態の行は書かず、どこに入れたかは読み取りの記録に残る", () => {
    const r = linked(on, statementReading(), "s1", home.id);
    const ids = r.candidates.filter((c) => c.target.newObject === "s1").map((c) => c.id);
    const res = acceptCandidates(on, r, ids, {}, AT);
    // 土地の価格は、評価の入れ方が時価×評価の割合のままなので入らない（理由を出す）
    expect(res.count).toBe(2);
    expect(res.failed).toEqual(["「土地の評価の入れ方」を「固定資産税評価額×倍率（倍率地域）」か「固定資産税評価額から推定（×8/7）」にすると入れられます（入力の「相続税の試算」で選びます）"]);
    expect(landOf(res.wh, home.id)).toEqual({ object: home.id, area: "165.29", buildingValue: 6_230_000 });
    expect(res.wh.request.input.valueStates).toBeUndefined();
    const area = res.reading.candidates.find((c) => c.target.at?.[1] === "area" && c.target.newObject === "s1")!;
    expect(area.status).toBe("accepted");
    expect(area.decided?.to).toEqual({ target: { plan: "input" }, item: LAND_ITEM, at: ["lands", home.id, "area"] });
  });

  it("評価の入れ方を固定資産税評価額から推定にすると、土地の価格も入る（倍率方式と同じ価格の欄）", () => {
    const r = linked(on, statementReading(), "s1", home.id);
    const withMethod = docReview(on, r); // 欄が無い理由の行
    const fixedId = r.candidates.find((c) => c.target.at?.[1] === "fixedValue" && c.target.newObject === "s1")!.id;
    expect(withMethod.groups.flatMap((g) => g.rows).find((x) => x.id === fixedId)!.problem).toContain("「土地の評価の入れ方」を");
    const m = setMethod(on, home.id, "fixedEstimate");
    const res = acceptCandidates(m, r, [fixedId], {}, AT);
    expect(res.count).toBe(1);
    expect(landOf(res.wh, home.id)?.fixedValue).toBe(18_450_000);
  });

  it("「相続税も試算する」にチェックしていない世帯では入らず、チェックすると入れられることを出す", () => {
    const r = linked(base, statementReading(), "s1", home.id);
    const s1 = new Set(r.candidates.filter((c) => c.target.newObject === "s1").map((c) => c.id));
    const rows = rowsOf(base, r).filter((x) => s1.has(x.id));
    expect(rows).toHaveLength(3);
    expect(rows.every((x) => x.problem === "相続・贈与の入力項目の「相続税も試算する（土地の評価・小規模宅地等の特例）」にチェックすると入れられます")).toBe(true);
    expect(acceptCandidates(base, r, r.candidates.map((c) => c.id), {}, AT).count).toBe(0);
  });

  it("2つのまとまり（自宅の敷地と貸している土地）は、それぞれの不動産に入る（複数筆の合計は1つの欄）", () => {
    let r = linked(on, statementReading(), "s1", home.id);
    r = linked(on, r, "s2", prop.id);
    const res = acceptCandidates(on, r, r.candidates.filter((c) => c.target.at?.[1] === "area").map((c) => c.id), {}, AT);
    expect(res.count).toBe(2);
    expect(landOf(res.wh, home.id)?.area).toBe("165.29");
    expect(landOf(res.wh, prop.id)?.area).toBe("210");
  });

  it("読めなかった欄は「直す」で入れる（直した値は手で入れた値）", () => {
    const r = linked(on, read(on, statement([land("area", null, { unreadable: true })])), "s1", home.id);
    const c = r.candidates[0]!;
    expect(rowsOf(on, r).find((x) => x.id === c.id)!.problem).toBe("読めませんでした。書類を見て「直す」で入れてください");
    const res = correctCandidate(on, r, c.id, "150.5", {}, AT);
    expect("error" in res).toBe(false);
    if ("error" in res) return;
    expect(landOf(res.wh, home.id)?.area).toBe("150.5");
    expect(res.reading.candidates[0]!.status).toBe("corrected");
  });

  it("不動産を書かない候補（書類の土地の無い答え）は、どの不動産の欄かを FP が選ぶ（1つしか無くても選ぶ）", () => {
    const r = read(on, { contract: PROPOSAL_CONTRACT, docType: "propertyTaxStatement", values: [{ item: LAND_ITEM, at: ["lands", "area"], value: "120", confidence: "high" }] });
    const row = rowsOf(on, r)[0]!;
    expect(row.problem).toBe("入れる欄を選んでください");
    expect(row.choices!.map((x) => x.id)).toEqual(landTargets(on.request.input.household).map((t) => `inherit/land/${t.object}/area`));
    const res = acceptCandidates(on, r, [r.candidates[0]!.id], { [r.candidates[0]!.id]: `inherit/land/${prop.id}/area` }, AT);
    expect(landOf(res.wh, prop.id)?.area).toBe("120");
  });

  it("AI接続で不動産の ID を書いた候補は、その不動産の欄に入る", () => {
    const r = read(on, { contract: PROPOSAL_CONTRACT, docType: "propertyTaxStatement", values: [{ item: LAND_ITEM, at: ["lands", "buildingValue"], object: home.id, value: 7_000_000, period: "once", confidence: "high" }] });
    const res = acceptCandidates(on, r, [r.candidates[0]!.id], {}, AT);
    expect(res.count).toBe(1);
    expect(landOf(res.wh, home.id)?.buildingValue).toBe(7_000_000);
  });
});

describe("確かめの画面: 路線価図", () => {
  const routeReading = () => read(on, JSON.parse(answerIn("route-price-map.md")));

  it("貸している物件に入れると、評価の入れ方を承認してから路線価が入り、借地権割合も入る", () => {
    const r = linked(on, routeReading(), "r1", prop.id);
    const [method, price, ratio] = r.candidates;
    // 評価の入れ方が路線価でないうちは、路線価の欄が無い
    expect(rowsOf(on, r).find((x) => x.id === price!.id)!.problem).toContain("「土地の評価の入れ方」を「路線価×面積（路線価地域）」にすると入れられます");
    const a = acceptCandidates(on, r, [method!.id, ratio!.id], {}, AT);
    expect(a.count).toBe(2);
    expect(landOf(a.wh, prop.id)).toMatchObject({ method: "routePrice", leaseholdRatio: "C" });
    const b = acceptCandidates(a.wh, a.reading, [price!.id], {}, AT);
    expect(b.count).toBe(1);
    expect(landOf(b.wh, prop.id)).toMatchObject({ method: "routePrice", routePrice: 250_000, leaseholdRatio: "C" });
  });

  it("持ち家に入れると、借地権割合は入れない（貸している物件だけの欄）ことを出す", () => {
    const r = linked(on, routeReading(), "r1", home.id);
    const ratio = r.candidates[2]!;
    expect(rowsOf(on, r).find((x) => x.id === ratio.id)!.problem).toBe("借地権割合は、貸している物件だけに入れます（貸家建付地の減額に使います）。自宅などの土地では使いません");
    const res = acceptCandidates(on, r, r.candidates.map((c) => c.id), {}, AT);
    expect(landOf(res.wh, home.id)?.leaseholdRatio).toBeUndefined();
    expect(landOf(res.wh, home.id)?.method).toBe("routePrice");
  });
});

/** 不動産の評価の入れ方を FP が入力の画面で選んだ形にする */
function setMethod(wh: WorkingHousehold, object: string, method: InheritanceLandSetting["method"]): WorkingHousehold {
  const req = structuredClone(wh.request);
  const t = req.input.inheritanceTax!;
  const lands = [...(t.lands ?? [])];
  const i = lands.findIndex((l) => l.object === object);
  if (i < 0) lands.push({ object, method });
  else lands[i] = { ...lands[i]!, method };
  t.lands = lands;
  return { ...wh, request: req };
}

describe("手引きの言葉", () => {
  it("手引きの言葉の決まり（画面と新しく書く AI への説明に使わない言葉）", () => {
    for (const f of ["property-tax-statement.md", "route-price-map.md"]) {
      const md = readFileSync(join(GUIDES, f), "utf8");
      for (const w of ["接続口", "当て", "比べ", "札", "カード", "窓"]) expect(md, `${f}: ${w}`).not.toContain(w);
    }
  });
});

describe("画面と世帯ファイルの記録", () => {
  it("確かめの画面: 書類の土地は「足す」を出さず、不動産の名前のボタンと「入れない」を出す。入口の見出しは保険・不動産", () => {
    const r = read(on, JSON.parse(answerIn("property-tax-statement.md")));
    const w = withDocumentLog(on, withReading(undefined, r));
    expect(pendingTotal(w)).toBe(r.candidates.length + r.objects.length);
    const html = renderToString(h(DocumentReview, { wh: w, calc: null, onChange: () => undefined, onClose: () => undefined, initial: r.id }));
    expect(html).toContain("固定資産税の課税明細書");
    expect(html).toContain("この書類の土地・建物を、どの不動産の値として入れますか");
    expect(html).toContain(`data-documents-object-link="s1:${home.id}"`);
    expect(html).toContain("「持ち家」に入れる");
    expect(html).not.toContain("data-documents-object-accept");
    const entry = renderToString(h(DocumentEntry, { wh: w, sample: false, onOpen: () => undefined, onSamples: () => undefined }));
    // 入口の見出しには書類の種類を書かず、すぐ下に書類の種類の一覧から作った1行を出す（0235 の追記 2026-11-20）。入口は「AI で書類を読み取る」の1つで、1行も1回だけ（0151 の追記 2026-11-20）
    expect(entry).toContain('<span class="hs-tools-h">AI で書類を読み取る</span>');
    expect(entry).toContain("読める書類: 保険の設計書・証券、固定資産税の課税明細書、路線価図");
    expect(entry.split("読める書類: ").length - 1).toBe(1);
    expect(readableDocsLine()).toBe(`読める書類: ${DOC_TYPES.map((d) => d.short).join("、")}`);
    expect(DOC_TYPES.every((d) => readableDocsLine().includes(d.short))).toBe(true);
  });

  it("読み取りの記録は世帯ファイルの区画に書いて読み戻しても変わらない（書類の種類・書類の土地・入れた不動産）", () => {
    const r = linked(on, read(on, JSON.parse(answerIn("route-price-map.md"))), "r1", prop.id);
    const log = withReading(undefined, r);
    const back = readDocumentLog(JSON.parse(JSON.stringify(log)));
    expect(back).toEqual(log);
    expect(back.readings[0]).toMatchObject({ docType: "routePriceMap", objects: [{ kind: LAND_OBJECT_KIND, status: "accepted", created: prop.id, linked: true }] });
    const tax = read(on, JSON.parse(answerIn("property-tax-statement.md")));
    const both = withReading(log, tax);
    expect(readDocumentLog(JSON.parse(JSON.stringify(both)))).toEqual(both);
  });
});
