// 明細の取り込み（0034・0180）: 同じ明細を別の口座に取り込もうとしたときの知らせ・期間の短い口座を混ぜたとき・返品で内訳が負になったとき。
// 作った架空の CSV で、画面と同じ部品（model.ts）を通して流す
import { describe, expect, it } from "vitest";
import { approvalTime } from "../src/workspace/hearing/sheet.ts";
import { fromRequest, type WorkingHousehold } from "../src/workspace/input/household.ts";
import { withRefreshedEstimates } from "../src/workspace/input/estimates.ts";
import { sameAsOtherAccount } from "../../statement/src/index.ts";
import { addAccount, addImport, analyze, approve, candidatesOf, logOf, readFile, withLog, type ReadOk } from "../src/workspace/statement/model.ts";
import { modelHousehold } from "./helpers.ts";

const AT = approvalTime(new Date(2026, 9, 23, 10, 0, 0));
let n = 0;
const seq = () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`;

const HEAD = "ご利用日,ご利用店名,ご利用者,支払区分,ご利用金額,今回お支払金額,お支払月";
const line = (d: string, shop: string, amount: number) => `${d},${shop},ご本人,1回払い,"${amount.toLocaleString("en-US")}","${amount.toLocaleString("en-US")}",2026年${Number(d.slice(5, 7)) % 12 + 1}月`;
const csv = (rows: string[]) => new TextEncoder().encode(`\uFEFF${HEAD}\n${rows.join("\n")}\n`);

async function readOk(bytes: Uint8Array): Promise<ReadOk> {
  const out = await readFile(bytes, "card", []);
  if (!out.ok) throw new Error(JSON.stringify(out.issues));
  return out;
}

function household(id = "salariedCoupleTwoKids"): { wh: WorkingHousehold; self: string } {
  const wh = withRefreshedEstimates(fromRequest(modelHousehold(id)));
  const self = wh.request.input.household.members.find((m) => m.kind === "self")!.id;
  return { wh, self };
}

/** 2026年1〜3月のカードの明細（食費と被服） */
function threeMonths(): string[] {
  const rows: string[] = [];
  for (const m of ["01", "02", "03"]) {
    rows.push(line(`2026/${m}/05`, "ひかりスーパー ショッピングセンター店", 30000));
    rows.push(line(`2026/${m}/20`, "ユニクロ みどり店", 5000));
  }
  rows.push(line("2026/01/01", "ひかりスーパー ショッピングセンター店", 100));
  rows.push(line("2026/03/31", "ひかりスーパー ショッピングセンター店", 100));
  return rows;
}

describe("同じ明細を別の口座に取り込もうとしたとき", () => {
  it("保存し直した同じ明細（指紋が変わる）を別の口座に入れようとすると、どの口座と何件同じかが分かる。FP が「別の明細として取り込む」を選べば今までどおり取り込む", async () => {
    const { wh, self } = household();
    let log = addAccount(logOf(wh), { kind: "card", label: "ご本人のカード", owner: self }, "acc-a");
    log = addAccount(log, { kind: "card", label: "ご本人のAカード（2回目）", owner: self }, "acc-b");
    const r = addImport(log, await readOk(csv(threeMonths())), { id: seq(), account: "acc-a", at: AT });
    if (!r.ok) throw new Error(r.reason);
    const one = analyze(withLog(wh, r.log), []).summary;
    // 保存し直して改行だけ変わったファイル
    const resaved = await readOk(new TextEncoder().encode(`\uFEFF${HEAD}\r\n${threeMonths().join("\r\n")}\r\n`));
    expect(sameAsOtherAccount(r.log, resaved.rows, "acc-b")).toEqual({ account: "acc-a", matched: 8, rows: 8 });
    // 同じ口座に入れ直すとき（期間の重なりは同じ口座の中で重ねない）は聞かない
    expect(sameAsOtherAccount(r.log, resaved.rows, "acc-a")).toBeNull();
    // 「別の明細として取り込む」: 0034 の8 のとおり別の口座の同じ行は重ねない（両方を数える）
    const r2 = addImport(r.log, resaved, { id: seq(), account: "acc-b", at: AT });
    if (!r2.ok) throw new Error(r2.reason);
    expect(analyze(withLog(wh, r2.log), []).summary.livingTotal).toBe(one.livingTotal * 2);
  });
});

describe("期間の短い口座", () => {
  it("12か月のカードと、25日分しかないカードを混ぜると、短い口座の名前を出して強い注意にし、生活費の候補を要確認にする", async () => {
    const { wh, self } = household();
    let log = addAccount(logOf(wh), { kind: "card", label: "ご本人のカード", owner: self }, "acc-a");
    log = addAccount(log, { kind: "card", label: "配偶者のカード", owner: self }, "acc-b");
    const year: string[] = [];
    for (let m = 1; m <= 12; m++) {
      const mm = String(m).padStart(2, "0");
      year.push(line(`2025/${mm}/01`, "ひかりスーパー ショッピングセンター店", 10000));
      year.push(line(`2025/${mm}/28`, "ひかりスーパー ショッピングセンター店", 10000));
    }
    let r = addImport(log, await readOk(csv(year)), { id: seq(), account: "acc-a", at: AT });
    if (!r.ok) throw new Error(r.reason);
    const short = [line("2025/12/01", "ひかりスーパー ショッピングセンター店", 40000), line("2025/12/10", "ユニクロ みどり店", 30000), line("2025/12/25", "ひかりスーパー ショッピングセンター店", 40000)];
    r = addImport(r.log, await readOk(csv(short)), { id: seq(), account: "acc-b", at: AT });
    if (!r.ok) throw new Error(r.reason);
    const wh2 = withLog(wh, r.log);
    const an = analyze(wh2, []);
    expect(an.summary.notices.find((x) => x.code === "S_VERY_SHORT_ACCOUNT")?.message).toContain("「配偶者のカード」0.8か月");
    const list = candidatesOf(wh2, an.summary, "00000000-0000-4000-8000-0000000000aa", seq);
    expect(list.find((c) => c.collection === "livingExpenses")?.status).toBe("needsReview");
  });
});

describe("返品の多い月", () => {
  it("期間の前に買った物の返品で内訳が負になると、知らせに出し、候補は「明細に出てこない」と書かずに今の値を残すと書く", async () => {
    const { wh, self } = household("unexplainedSpending");
    const log = addAccount(logOf(wh), { kind: "card", label: "ご本人のカード", owner: self }, "acc-a");
    const rows = [...threeMonths(), line("2026/01/10", "ユニクロ みどり店", -40000)];
    const r = addImport(log, await readOk(csv(rows)), { id: seq(), account: "acc-a", at: AT });
    if (!r.ok) throw new Error(r.reason);
    const wh2 = withLog(wh, r.log);
    const an = analyze(wh2, []);
    const cl = an.summary.living.find((l) => l.category === "clothing")!;
    expect(cl.monthly).toBe(0);
    expect(cl.negative).toBeLessThan(0);
    expect(an.summary.notices.map((x) => x.code)).toContain("S_NEGATIVE_LIVING");
    const before = wh2.request.input.household.livingExpenses?.[0]?.categories?.find((c) => c.category === "clothing")?.monthly.value;
    const list = candidatesOf(wh2, an.summary, "00000000-0000-4000-8000-0000000000aa", seq);
    const living = list.find((c) => c.collection === "livingExpenses")!;
    expect(living.note).toContain("返品・取り消しが多く月平均が0円以下になった内訳（被服・美容）は今の値を残します");
    expect(living.note).not.toMatch(/明細に出てこない内訳（[^）]*被服/u);
    const next = approve(wh2, list, new Set([living.id]), an.summary, "00000000-0000-4000-8000-0000000000aa", AT);
    expect(next.request.input.household.livingExpenses?.[0]?.categories?.find((c) => c.category === "clothing")?.monthly.value).toBe(before);
  });
});
