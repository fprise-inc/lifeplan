import { describe, expect, it } from "vitest";
import { addRule, bucketsOf, classify, emptyLog, merchantKey, splitByShare, workStyleAt, type ClassifiedRow, type HouseholdLike, type StatementAccount, type StatementLog, type StatementRow } from "../src/index.ts";
import { BASE_MONTH, buildLog, CHILD, HOUSEHOLD, SELF, SPOUSE } from "./helpers.ts";

type RowIn = Partial<StatementRow> & { date: string; merchant: string; amount: number };

/** 架空の行から記録を作る（口座ごとに1つの取り込み） */
function synth(accounts: (StatementAccount & { rows: RowIn[]; period?: { from: string; to: string } })[]): StatementLog {
  const log = emptyLog();
  return {
    ...log,
    accounts: accounts.map(({ rows, period, ...a }) => (void rows, void period, a)),
    imports: accounts.map((a, k) => {
      const rows: StatementRow[] = a.rows.map((r, i) => ({ line: i + 1, id: `r${i + 1}`, key: merchantKey(r.merchant), ...r }));
      const dates = rows.map((r) => r.date).sort();
      return {
        id: `imp-${a.id}`,
        kind: "statement" as const,
        at: `2026-10-20T10:00:0${k}+09:00`,
        account: a.id,
        file: { sha256: `sha256:${a.id}`, bytes: 1 },
        reader: { id: "csv", version: 1 },
        format: { fingerprint: "sha256:f", mapping: { headerRow: 0, columns: { date: 0, merchant: 1, amount: 2 }, sign: "expensePositive" as const }, source: "fp" as const },
        period: a.period ?? { from: dates[0] as string, to: dates[dates.length - 1] as string },
        rows,
        include: true,
      };
    }),
  };
}

const run = (log: StatementLog, household: HouseholdLike = HOUSEHOLD) => classify({ log, household, baseMonth: BASE_MONTH, office: [] });
const find = (rows: readonly ClassifiedRow[], merchant: string) => rows.filter((r) => r.row.merchant.startsWith(merchant));
const one = (rows: readonly ClassifiedRow[], merchant: string) => find(rows, merchant)[0] as ClassifiedRow;

describe("働き方と区分", () => {
  it("働き方の期間から基準の月の働き方を決める（○歳になった月の終わり・終わった期間・今の期間）", () => {
    expect(workStyleAt(HOUSEHOLD, SELF, BASE_MONTH)).toEqual(["employee"]);
    expect(workStyleAt(HOUSEHOLD, SELF, "2046-05")).toEqual(["none"]);
    expect(workStyleAt(HOUSEHOLD, SPOUSE, BASE_MONTH)).toEqual(["selfEmployed"]);
    expect(workStyleAt(HOUSEHOLD, SPOUSE, "2017-01")).toEqual(["employee"]);
    expect(workStyleAt(HOUSEHOLD, CHILD, BASE_MONTH)).toEqual(["none"]);
  });

  it("働き方ごとに選べる区分", () => {
    expect(bucketsOf(["employee"])).toEqual(["household", "reimbursable", "oneOff", "excluded"]);
    expect(bucketsOf(["selfEmployed"])).toEqual(["household", "business", "oneOff", "excluded"]);
    expect(bucketsOf(["executive"])).toEqual(["household", "company", "oneOff", "excluded"]);
    expect(bucketsOf(["none"])).toEqual(["household", "oneOff", "excluded"]);
    expect(bucketsOf(["employee", "selfEmployed"])).toEqual(["household", "reimbursable", "business", "oneOff", "excluded"]);
  });

  it("割合の按分: 事業の分は切り捨て、残りは家計。返品も同じ割合で戻す", () => {
    expect(splitByShare(8800, "0.6")).toEqual({ business: 5280, household: 3520 });
    expect(splitByShare(1001, "0.5")).toEqual({ business: 500, household: 501 });
    expect(splitByShare(-1001, "0.5")).toEqual({ business: -500, household: -501 });
    expect(splitByShare(1000, "1")).toEqual({ business: 1000, household: 0 });
    expect(splitByShare(1000, "0")).toBeNull();
    expect(splitByShare(1000, "1.5")).toBeNull();
    expect(splitByShare(1000, "60%")).toBeNull();
  });

  it("複数の働き方の世帯: 行の持ち主の働き方で区分が変わる（夫は会社員・妻は個人事業主）", () => {
    const log = synth([
      { id: "h", kind: "card", label: "夫のカード", owner: SELF, rows: [{ date: "2026-09-01", merchant: "NTTドコモ", amount: 8800, bucket: "business", share: "0.6", decidedAt: "x" }, { date: "2026-09-02", merchant: "架空タクシー", amount: 3000, bucket: "reimbursable", decidedAt: "x" }] },
      { id: "w", kind: "card", label: "妻のカード", owner: SPOUSE, rows: [{ date: "2026-09-01", merchant: "NTTドコモ", amount: 8800, bucket: "business", share: "0.6", decidedAt: "x" }, { date: "2026-09-02", merchant: "架空タクシー", amount: 3000, bucket: "reimbursable", decidedAt: "x" }] },
    ]);
    const rows = run(log);
    const [hDocomo, wDocomo] = find(rows, "NTTドコモ") as [ClassifiedRow, ClassifiedRow];
    const [hTaxi, wTaxi] = find(rows, "架空タクシー") as [ClassifiedRow, ClassifiedRow];
    // 夫（会社員）は事業を選べない → 自動の区分に戻し、印を付ける
    expect(hDocomo.bucket).toBe("household");
    expect(hDocomo.flags).toContain("bucketNotAllowed");
    expect(hDocomo.review).toBe(true);
    expect(hTaxi).toMatchObject({ bucket: "reimbursable", bucketSource: "fp", parts: { reimbursable: 3000 } });
    // 妻（個人事業主）は事業60%
    expect(wDocomo).toMatchObject({ bucket: "business", share: "0.6", parts: { business: 5280, household: 3520 } });
    expect(wTaxi.bucket).toBe("household");
    expect(wTaxi.flags).toContain("bucketNotAllowed");
  });

  it("行ごとに持ち主を変えられる（夫のカードの家族カードの行を妻にする）", () => {
    const log = synth([{ id: "h", kind: "card", label: "夫のカード", owner: SELF, rows: [{ date: "2026-09-01", merchant: "架空文具", amount: 2000, cardUser: "family", owner: SPOUSE, bucket: "business", share: "1", decidedAt: "x" }, { date: "2026-09-03", merchant: "架空文具", amount: 1000, cardUser: "family" }] }]);
    const rows = run(log);
    expect(rows[0]).toMatchObject({ owner: SPOUSE, bucket: "business", parts: { business: 2000 } });
    expect(rows[0]?.flags).not.toContain("familyCard");
    expect(rows[1]).toMatchObject({ owner: SELF });
    expect(rows[1]?.flags).toContain("familyCard");
  });

  it("FP が働き方を足せる（会社員の副業）", () => {
    const log = { ...synth([{ id: "h", kind: "card", label: "夫のカード", owner: SELF, rows: [{ date: "2026-09-01", merchant: "架空文具", amount: 2000, bucket: "business", share: "0.5", decidedAt: "x" }] }]), styles: { [SELF]: ["employee", "selfEmployed"] as const } };
    expect(run(log)[0]).toMatchObject({ bucket: "business", parts: { business: 1000, household: 1000 } });
  });

  it("法人役員は会社の経費", () => {
    const exec: HouseholdLike = { members: [{ id: SELF, kind: "self" }], employmentPeriods: [{ member: SELF, from: { at: "2010-01" }, to: null, type: "executive" }] };
    const log = synth([{ id: "h", kind: "card", label: "カード", owner: SELF, rows: [{ date: "2026-09-01", merchant: "架空会食", amount: 12000, bucket: "company", decidedAt: "x" }, { date: "2026-09-02", merchant: "ソフトバンク", amount: 6000 }] }]);
    const rows = run(log, exec);
    expect(rows[0]).toMatchObject({ bucket: "company", parts: { company: 12000 } });
    // 役員・個人事業主の通信・交通などは「区分が決まらない」の印
    expect(rows[1]?.flags).toContain("bucketUndecided");
  });

  it("世帯の決まり: 店の鍵の決まりは項目の決まりより強く、持ち主を決めた決まりはその人の行だけ", () => {
    let log = synth([
      { id: "w", kind: "card", label: "妻", owner: SPOUSE, rows: [{ date: "2026-09-01", merchant: "ソフトバンク", amount: 6000 }, { date: "2026-09-02", merchant: "NTTドコモ", amount: 8000 }] },
      { id: "h", kind: "card", label: "夫", owner: SELF, rows: [{ date: "2026-09-01", merchant: "ソフトバンク", amount: 6000 }] },
    ]);
    log = addRule(log, { id: "r1", match: { category: "communication" }, owner: SPOUSE, bucket: "business", share: "0.6", at: "x" });
    log = addRule(log, { id: "r2", match: { key: merchantKey("NTTドコモ") }, owner: SPOUSE, bucket: "business", share: "0.3", at: "x" });
    const rows = run(log);
    expect(rows[0]).toMatchObject({ bucketSource: "rule", parts: { business: 3600, household: 2400 } });
    expect(rows[1]).toMatchObject({ bucketSource: "rule", parts: { business: 2400, household: 5600 } });
    expect(rows[2]).toMatchObject({ bucketSource: "auto", bucket: "household" });
    // 同じ当て先・同じ持ち主の決まりは置き換える
    log = addRule(log, { id: "r3", match: { category: "communication" }, owner: SPOUSE, bucket: "household", at: "y" });
    expect(log.rules.map((r) => r.id)).toEqual(["r2", "r3"]);
  });
});

describe("カードならではの扱い（二重に数えない）", () => {
  it("銀行の明細のカード会社への引き落としは、カードの明細があれば除外、無ければ数えて知らせる", async () => {
    const withCard = await buildLog([
      { name: "card-year-utf8bom.csv", kind: "card", account: "cardA", owner: SELF },
      { name: "bank-utf8.csv", kind: "bank", account: "bank", owner: SELF },
    ]);
    const rows = run(withCard);
    const pays = find(rows, "ミツイスミトモカード");
    expect(pays).toHaveLength(12);
    expect(pays.every((r) => r.bucket === "excluded" && r.flags.includes("cardPaymentExcluded") && !r.review)).toBe(true);

    const bankOnly = await buildLog([{ name: "bank-utf8.csv", kind: "bank", account: "bank", owner: SELF }]);
    const kept = find(run(bankOnly), "ミツイスミトモカード");
    expect(kept.every((r) => r.bucket === "household" && r.flags.includes("cardPaymentKept") && r.review)).toBe(true);
  });

  it("カード会社を決めたカードの明細は、同じカード会社の引き落としだけを除外する", async () => {
    const log = await buildLog([
      { name: "card-year-utf8bom.csv", kind: "card", account: "cardA", owner: SELF },
      { name: "bank-utf8.csv", kind: "bank", account: "bank", owner: SELF },
    ]);
    const withIssuer = { ...log, accounts: log.accounts.map((a) => (a.id === "cardA" ? { ...a, issuer: "smbc" } : a)) };
    const rows = run(withIssuer);
    expect(find(rows, "ミツイスミトモカード").every((r) => r.flags.includes("cardPaymentExcluded"))).toBe(true);
    expect(one(rows, "ラクテンカード").flags).toContain("cardPaymentKept");
    // カード会社を決めていなければ、どの引き落としもそのカードの明細で覆う
    expect(one(run(log), "ラクテンカード").flags).toContain("cardPaymentExcluded");
  });

  it("引き落としの頃をカードの明細が覆っていなければ除外しない（期間の外）", () => {
    const log = synth([
      { id: "c", kind: "card", label: "カード", owner: SELF, rows: [{ date: "2026-01-05", merchant: "架空商店", amount: 1000 }], period: { from: "2026-01-01", to: "2026-01-31" } },
      { id: "b", kind: "bank", label: "銀行", owner: SELF, rows: [{ date: "2026-02-10", merchant: "ミツイスミトモカード", amount: 1000 }, { date: "2026-06-10", merchant: "ミツイスミトモカード", amount: 5000 }] },
    ]);
    const rows = run(log);
    expect(rows[1]?.flags).toContain("cardPaymentExcluded");
    expect(rows[2]?.flags).toContain("cardPaymentKept");
  });

  it("分割の2回目以降の行（月ごとの別の明細に同じ行）は二重に数えない", async () => {
    const log = await buildLog([
      { name: "card-sjis-2026-05.csv", kind: "card", account: "cardB", owner: SPOUSE },
      { name: "card-sjis-2026-06.csv", kind: "card", account: "cardB", owner: SPOUSE },
    ]);
    const tv = find(run(log), "カクウデンキ");
    expect(tv.map((r) => r.counted)).toEqual([true, false]);
    expect(tv[1]?.flags).toContain("duplicate");
  });

  it("同じ取り込みの中の同じ行は別の買い物として数え、別の取り込みの同じ行だけを重ねない", () => {
    const row = { date: "2026-09-01", merchant: "架空カフェ", amount: 500 };
    const log = synth([{ id: "c", kind: "card", label: "カード", owner: SELF, rows: [row, row] }]);
    const twice = { ...log, imports: [...log.imports, { ...(log.imports[0] as StatementLog["imports"][number]), id: "imp-c2", at: "2026-10-21T00:00:00+09:00", rows: [{ ...(log.imports[0]?.rows[0] as StatementRow) }, { ...(log.imports[0]?.rows[1] as StatementRow), id: "r2" }, { ...(log.imports[0]?.rows[0] as StatementRow), id: "r3" }] }] };
    const rows = run(twice);
    expect(rows.map((r) => r.counted)).toEqual([true, true, false, false, true]);
  });

  it("別の口座の同じ行は重ねない（夫婦が同じ店で同じ額を使った）", () => {
    const row = { date: "2026-09-01", merchant: "架空カフェ", amount: 500 };
    const rows = run(synth([{ id: "a", kind: "card", label: "A", owner: SELF, rows: [row] }, { id: "b", kind: "card", label: "B", owner: SPOUSE, rows: [row] }]));
    expect(rows.every((r) => r.counted)).toBe(true);
  });

  it("返品・取り消しは元の行と組にして数えない。元の行が無ければ差し引いて印を付ける", async () => {
    const log = await buildLog([{ name: "card-year-utf8bom.csv", kind: "card", account: "cardA", owner: SELF }]);
    const uniqlo = find(run(log), "ユニクロ");
    expect(uniqlo.map((r) => [r.row.amount, r.counted, r.flags.includes("refund")])).toEqual([
      [5990, false, true],
      [-5990, false, true],
    ]);
    const lone = run(synth([{ id: "c", kind: "card", label: "C", owner: SELF, rows: [{ date: "2026-09-01", merchant: "架空書店", amount: -1200 }] }]));
    expect(lone[0]).toMatchObject({ counted: true, parts: { household: -1200 } });
    expect(lone[0]?.flags).toContain("refundUnmatched");
    // 120日より前の行とは組にしない
    const old = run(synth([{ id: "c", kind: "card", label: "C", owner: SELF, rows: [{ date: "2026-01-01", merchant: "架空書店", amount: 1200 }, { date: "2026-09-01", merchant: "架空書店", amount: -1200 }] }]));
    expect(old.map((r) => r.counted)).toEqual([true, true]);
  });

  it("リボ払い・年会費", async () => {
    const rows = run(await buildLog([{ name: "card-year-utf8bom.csv", kind: "card", account: "cardA", owner: SELF }]));
    expect(one(rows, "架空リボショップ").flags).toContain("revolving");
    expect(one(rows, "年会費")).toMatchObject({ category: "cardFee", bucket: "oneOff" });
  });
});

describe("年1回の支払い", () => {
  it("12か月分の明細の中で1回だけの年1回の印の支払い（自動車税・固定資産税）は「一時的」に", async () => {
    const rows = run(await buildLog([
      { name: "card-year-utf8bom.csv", kind: "card", account: "cardA", owner: SELF },
      { name: "bank-utf8.csv", kind: "bank", account: "bank", owner: SELF },
    ]));
    expect(one(rows, "自動車税")).toMatchObject({ bucket: "oneOff", annual: { confidence: "medium", everyYears: 1 } });
    expect(one(rows, "固定資産税")).toMatchObject({ bucket: "oneOff", annual: { confidence: "medium" } });
    // 印の無い3万円以上の1回だけの支払い（年払いの保険料）も候補
    expect(one(rows, "架空保険料")).toMatchObject({ bucket: "oneOff", annual: { confidence: "medium" } });
    // ふだんの買い物（食費）は年1回にしない
    expect(find(rows, "イオン").every((r) => r.annual === undefined)).toBe(true);
  });

  it("同じ店で約1年おき・似た額なら確かさ高、約2年おきなら2年に1回", () => {
    const rows = run(synth([{ id: "c", kind: "card", label: "C", owner: SELF, rows: [
      { date: "2024-06-10", merchant: "架空保険", amount: 48000 },
      { date: "2025-06-12", merchant: "架空保険", amount: 48000 },
      { date: "2026-06-11", merchant: "架空保険", amount: 50000 },
      { date: "2024-03-01", merchant: "架空車検センター", amount: 98000 },
      { date: "2026-03-05", merchant: "架空車検センター", amount: 102000 },
    ] }]));
    expect(one(rows, "架空保険").annual).toEqual({ confidence: "high", everyYears: 1 });
    expect(one(rows, "架空車検").annual).toEqual({ confidence: "high", everyYears: 2 });
  });

  it("期間が1年に足りないときは、高額の1回だけの支払いを「年1回かは分からない」として迷う行にする", () => {
    const rows = run(synth([{ id: "c", kind: "card", label: "C", owner: SELF, rows: [{ date: "2026-07-01", merchant: "架空ゴルフ用品", amount: 150000 }, { date: "2026-09-01", merchant: "架空商店", amount: 1000 }] }]));
    expect(rows[0]).toMatchObject({ bucket: "household", annual: { confidence: "low" }, review: true });
    expect(rows[0]?.flags).toContain("annualUnsure");
  });

  it("分割の買い物は年1回にせず、高額の印で見せる", () => {
    const rows = run(synth([{ id: "c", kind: "card", label: "C", owner: SELF, period: { from: "2025-10-01", to: "2026-09-30" }, rows: [{ date: "2026-01-15", merchant: "架空家電", amount: 240000, plan: { kind: "installment", count: 12 } }] }]));
    expect(rows[0]?.annual).toBeUndefined();
    expect(rows[0]?.flags).toContain("highAmount");
  });
});

describe("迷う行と自動の区分", () => {
  it("辞書で分からない店・高額・振替・収入・計算で出す税", async () => {
    const rows = run(await buildLog([
      { name: "card-year-utf8bom.csv", kind: "card", account: "cardA", owner: SELF },
      { name: "bank-utf8.csv", kind: "bank", account: "bank", owner: SELF },
    ]));
    expect(one(rows, "架空の謎の店")).toMatchObject({ category: null, bucket: "household", review: true });
    expect(one(rows, "架空の謎の店").flags).toContain("unknownMerchant");
    expect(find(rows, "給与").every((r) => r.category === "income" && r.bucket === "excluded")).toBe(true);
    const tax = run(synth([{ id: "b", kind: "bank", label: "B", owner: SELF, rows: [{ date: "2026-06-30", merchant: "住民税 架空市", amount: 30000 }] }]));
    expect(tax[0]).toMatchObject({ category: "tax", bucket: "excluded" });
    expect(tax[0]?.flags).toContain("engineTax");
  });

  it("FP が決めた行は迷う行から外れる（持ち主の働き方で選べない区分の印は残す）", () => {
    const rows = run(synth([{ id: "c", kind: "card", label: "C", owner: SELF, rows: [{ date: "2026-09-01", merchant: "架空の謎の店", amount: 4500, category: "recreation", decidedAt: "2026-10-21T00:00:00+09:00" }] }]));
    expect(rows[0]).toMatchObject({ category: "recreation", categorySource: "fp", review: false });
  });

  it("家計簿アプリの振替の印は振替（除外）", async () => {
    const log = await buildLog([{ name: "app-utf8bom.csv", kind: "app", account: "app", owner: null }]);
    const rows = run(log);
    expect(one(rows, "口座振替")).toMatchObject({ category: "transfer", categorySource: "transferMark", bucket: "excluded" });
    expect(one(rows, "架空マルシェ")).toMatchObject({ category: "food", categorySource: "sourceCategory" });
    // 持ち主の無い口座は働き方「なし」（家計・一時的・除外だけ）
    expect(one(rows, "架空マルシェ").allowed).toEqual(["household", "oneOff", "excluded"]);
  });

  it("家計簿アプリの書き出しの大項目と中項目で仕分ける（引き落とし・チャージは除外、引き出し・使途不明金は数える）", async () => {
    const log = await buildLog([{ name: "app-subcategory-utf8bom.csv", kind: "app", account: "app", owner: null }]);
    const rows = run(log);
    const got = (m: string) => [one(rows, m).category, one(rows, m).bucket];
    expect(got("架空駅前出張所")).toEqual(["cash", "household"]);
    expect(got("財布の残高の差")).toEqual(["cash", "household"]);
    expect(got("架空カードサービス")).toEqual(["transfer", "excluded"]);
    expect(got("架空ペイ")).toEqual(["transfer", "excluded"]);
    expect(got("架空ケア")).toEqual(["medical", "household"]);
    expect(got("架空ドラッグ")).toEqual(["medical", "household"]);
    expect(got("架空ライフ")).toEqual(["insurance", "household"]);
    expect(got("架空ブックス")).toEqual(["recreation", "household"]);
    expect(got("架空スタンド")).toEqual(["recreation", "household"]);
    expect(got("架空ゼミ")).toEqual(["education", "household"]);
    expect(got("架空教室")).toEqual(["education", "household"]);
    expect(got("架空シアター")).toEqual(["recreation", "household"]);
    expect(got("架空の給油所")).toEqual(["car", "household"]);
    expect(got("架空の宿")).toEqual(["lumpSum", "oneOff"]);
    // 中項目の無い現金・カードの行は、店の名前でも分からなければ迷う行（前のように黙って除外しない）
    expect(one(rows, "架空の手渡し")).toMatchObject({ category: null, bucket: "household", review: true });
    expect(one(rows, "架空の手渡し").flags).toContain("unknownMerchant");
  });

  it("外した取り込みは仕分けない", () => {
    const log = synth([{ id: "c", kind: "card", label: "C", owner: SELF, rows: [{ date: "2026-09-01", merchant: "架空商店", amount: 100 }] }]);
    expect(run({ ...log, imports: log.imports.map((i) => ({ ...i, include: false })) })).toEqual([]);
  });
});
