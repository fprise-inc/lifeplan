// 読み替え表と凍結した見本を、0.16 の画面の欄の定義・動かす項目の一覧から作る（readings.test.ts の作る手順だけが使う。0035 の9・12）。
// 入力画面を作り直して 0.16 の欄の定義が変わったら、このファイルは消す（作った表と見本は残る）
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { REPO_DIR } from "../scripts/lib.ts";
import type { EngineRequest } from "../src/engine/types.ts";
import { allFields, type ActionDef, type FieldDef, type StageDef } from "../src/workspace/input/form.ts";
import { blankHousehold, fromRequest, type WorkingHousehold } from "../src/workspace/input/household.ts";
import { buildStages } from "../src/workspace/input/stages/index.ts";
import { buildCatalog, type ItemValue } from "../src/workspace/plans/items.ts";
import { applyValues } from "../src/workspace/plans/plans.ts";
import { fromBody } from "../src/workspace/store/body.ts";
import { readAt, resolveAssumedKey, resolveKey, unbox, type AtStep, type Reading, type ReadingEntry } from "../src/workspace/store/readings.ts";

type Json = Record<string, unknown>;
type To = ReadingEntry["to"];
const isObj = (v: unknown): v is Json => typeof v === "object" && v !== null && !Array.isArray(v);
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g;
const NUMERIC = new Set(["yen", "int", "pct", "decimal"]);
const UNTIL = "0.16";

/**
 * 1つの値をそのまま書かない欄・物の場所が鍵から決まらない欄（手で決めた行）。
 * 合成の対策は 0036 の3、読み替えられない欄は要確認で残す（0036 の5）
 */
const OVERRIDES: Record<string, To> = {
  // 計算基準月の働き方の期間（鍵は構成員の ID だけ）
  "field:work/{member}/now/annual": { target: "object", find: "currentPeriod", item: "employment.salary.annual", at: [] },
  "field:work/{member}/now/bonus": { target: "object", find: "currentPeriod", item: "employment.salary.bonus", at: [] },
  "field:work/{member}/now/business": { target: "object", find: "currentPeriod", item: "employment.business.income", at: [] },
  "field:work/{member}/now/hiRate": { target: "object", find: "currentPeriod", item: "employment.healthInsurance.employeeRate", at: [] },
  // 主契約の死亡保険金（鍵は契約の ID だけ）
  "field:ins/{object}/death": { target: "object", item: "insurance.coverages", at: [{ where: { role: "main", benefit: "death" } }, "amount"] },
  // 積立をやめる年齢は、動かす項目の inv:stop と同じ合成の対策
  "field:sav/stopAge": { lever: "investStopAge" },
  // 1つの値をそのまま書かない欄（単位を直す・時点に直す・物を作る・複数の値を動かす）は、0.16 の欄の書き方で当てる合成の対策にする
  // （入力画面の作り直しで、当て先・出来事の差分に寄せる。0036 の3）
  "field:ev/car/{object}/down": { lever: "carDownPayment", object: true },
  "field:ev/car/{object}/firstIn": { lever: "carFirstPurchase", object: true },
  "field:ev/car/{object}/term": { lever: "carLoanYears", object: true },
  "field:ev/car/{object}/untilAge": { lever: "carUntilAge", object: true },
  "field:housing/debt/{object}/term": { lever: "loanTermYears", object: true },
  "field:ins/{object}/payUntil": { lever: "insurancePayUntilAge", object: true },
  "field:living/surplus/change/{n}/age": { lever: "surplusChangeAge", element: { target: "assumptions", item: "assumptions.surplusSaving", at: ["changes", { n: 1 }] } },
  "field:pension/{object}/claim": { lever: "pensionClaimAge", object: true },
  "field:pension/{object}/claim/basic": { lever: "pensionClaimAgeBasic", object: true },
  "field:pension/{object}/claim/employee": { lever: "pensionClaimAgeEmployee", object: true },
  "field:sav/{object}/monthly": { lever: "firstContributionMonthly", object: true },
  "field:sav/{object}/payoutAge": { lever: "payoutAge", object: true },
  "field:work/{member}/mainEnd": { lever: "mainEndAge", member: true },
  "field:work/{member}/residentTax": { lever: "residentTaxThisYear", member: true },
  "field:work/{member}/retireAge": { lever: "workEndAge", member: true },
  // 動かす項目（欄でないもの）
  "lever:retireAge": { lever: "retireAge" },
  "lever:pensionAge": { lever: "pensionAge" },
  "lever:nisaMonthly": { lever: "nisaMonthly" },
  "lever:livingMonthly": { lever: "livingMonthly" },
  "lever:fee": { lever: "advisoryFee" },
  "inv:monthly": { lever: "investMonthly" },
  "inv:rate": { lever: "investReturnShift" },
  "inv:stop": { lever: "investStopAge" },
  "inv:wStart": { lever: "drawdownStart" },
  "inv:wAmt": { lever: "drawdownAmount" },
  "inv:wRate": { lever: "drawdownRate" },
  "rates:shift": { lever: "loanRateShift" },
  "loan:{object}:prepay": { lever: "loanPrepay", object: true },
  "loan:{object}:rate": { lever: "loanRate", object: true },
  "loan:{object}:principal": { target: "object", item: "debt.principal", at: [] },
  "mix:{object}": { target: "object", item: "account.assetMix", at: [] },
  "surplus:ratio": { lever: "surplusRatio" },
  // 仮の印だけの欄（数の欄ではないもの）
  "assumed:family/{member}/birth": { target: "member", item: "member.birth", at: [], method: "standard" },
  "assumed:family/{member}/sex": { target: "member", item: "member.sex", at: [], method: "standard" },
  "assumed:housing/debt/{object}/credit": { target: "object", item: "debt.housing", at: [], method: "standard" },
  "assumed:housing/debt/{object}/principal": { target: "object", item: "debt.principal", at: [], method: "derived" },
};

interface Instance {
  household: string;
  key: string;
  from: string;
  value: unknown;
  /** 1つの値をそのまま書いたとき: 書いた値と、書いた後の要求の input */
  wrote?: { v1: unknown; after: Json };
  /** 鍵と書いた場所から作った行（作れないときは理由） */
  auto?: To | string;
}

const itemsJson = JSON.parse(readFileSync(join(REPO_DIR, "engine", "src", "generated", "items.json"), "utf8")) as {
  collections: Record<string, string[]>;
  items: Record<string, { collection: string | null; path: string[] }>;
};
const collectionOfArray = new Map(Object.entries(itemsJson.collections).map(([c, p]) => [p.join("/"), c]));

function leaves(o: unknown, p: string[], out: Map<string, unknown>): void {
  if (Array.isArray(o)) {
    out.set([...p, "#len"].join("\u0000"), o.length);
    o.forEach((x, i) => leaves(x, [...p, String(i)], out));
  } else if (isObj(o)) for (const [k, v] of Object.entries(o)) leaves(v, [...p, k], out);
  else out.set(p.join("\u0000"), o);
}

/** 変わった値の場所（値の箱は箱の場所にまとめる）。1つの値だけが変わっていればその道 */
function changedPlace(before: Json, after: Json): string[][] {
  const a = new Map<string, unknown>();
  const b = new Map<string, unknown>();
  leaves(before, [], a);
  leaves(after, [], b);
  const out = new Map<string, string[]>();
  for (const k of new Set([...a.keys(), ...b.keys()])) {
    if (JSON.stringify(a.get(k)) === JSON.stringify(b.get(k))) continue;
    let path = k.split("\u0000");
    // 値の箱（state と origin を持つ物）の中の変化は、箱の場所に
    for (let i = path.length - 1; i > 0; i--) {
      const node = path.slice(0, i).reduce<unknown>((n, s) => (isObj(n) || Array.isArray(n) ? (n as Json)[s] : undefined), after);
      if (isObj(node) && typeof node.state === "string" && isObj(node.origin)) {
        path = path.slice(0, i);
        break;
      }
    }
    out.set(path.join("/"), path);
  }
  return [...out.values()];
}

/** 鍵の中の ID・番号を型に置き換える */
function patternOf(key: string, objectId: string | null, memberIds: ReadonlySet<string>): string {
  return key
    .replace(UUID, (u) => (u === objectId ? (memberIds.has(u) ? "{member}" : "{object}") : objectId === null && memberIds.has(u) ? "{member}" : "{id}"))
    .replace(/(?<=\/|^|:)\d+(?=\/|$|:)/g, "{n}");
}

/** 1つの値をそのまま書いた場所から、表の行を作る */
function autoEntry(key: string, path: string[], input: Json): { from: string; to: To } | string {
  const memberIds = new Set(((input.household as Json).members as Json[]).map((m) => m.id as string));
  let target: "object" | "member" | "assumptions" | "input";
  let collection: string | null;
  let rest: string[];
  let objectId: string | null = null;
  let node: unknown;
  if (path[0] === "household") {
    const arr = path[1] as string;
    collection = collectionOfArray.get(`household/${arr}`) ?? null;
    if (collection === null) return `物の集まりが分かりません: ${arr}`;
    const obj = ((input.household as Json)[arr] as Json[])[Number(path[2])] as Json;
    objectId = obj.id as string;
    target = arr === "members" ? "member" : "object";
    rest = path.slice(3);
    node = obj;
  } else {
    collection = null;
    target = path[0] === "assumptions" ? "assumptions" : "input";
    rest = path;
    node = input;
  }
  const keyIds: string[] = key.match(UUID) ?? [];
  if (objectId !== null && !keyIds.includes(objectId)) return "物の ID が鍵にありません";
  const cands = Object.entries(itemsJson.items).filter(([, p]) => p.collection === collection && p.path.every((s, i) => rest[i] === s));
  if (cands.length === 0) return `入力項目ID がありません: ${rest.join("/")}`;
  const [item, place] = cands.sort((x, y) => y[1].path.length - x[1].path.length)[0] as [string, { path: string[] }];
  for (const s of place.path) node = isObj(node) ? node[s] : undefined;
  const otherIds = keyIds.filter((u) => u !== objectId);
  const keyNums = [...key.matchAll(/(?<=\/|^|:)(\d+)(?=\/|$|:)/g)].map((m) => Number(m[1]));
  let used = 0;
  const at: AtStep[] = [];
  for (const seg of rest.slice(place.path.length)) {
    if (Array.isArray(node)) {
      const i = Number(seg);
      const el = node[i];
      if (isObj(el) && typeof el.id === "string") {
        const k = otherIds.indexOf(el.id);
        if (k < 0) return "要素の ID が鍵にありません";
        at.push({ id: k + 1 });
      } else if (used < keyNums.length) {
        if (keyNums[used] !== i) return `鍵の番号（${keyNums[used]}）と並びの番号（${i}）が違います`;
        used++;
        at.push({ n: used });
      } else at.push({ nth: i });
      node = el;
    } else {
      at.push(seg);
      node = isObj(node) ? node[seg] : undefined;
    }
  }
  if (used !== keyNums.length) return "鍵の番号の数が並びの数と合いません";
  return { from: patternOf(key, objectId, memberIds), to: { target, item, at } };
}

const sameValue = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b) || (typeof a === "string" && typeof b === "string" && /^-?\d+(\.\d+)?$/.test(a) && Number(a) === Number(b));

function bump(f: FieldDef, v: unknown): unknown {
  if (f.kind === "yen") return typeof v === "number" ? v + 12000 : 12000;
  if (f.kind === "int") {
    const n = typeof v === "number" ? v : (f.min ?? 1);
    return n + 1 <= (f.max ?? 1e9) ? n + 1 : n - 1;
  }
  const s = typeof v === "string" ? Number(v) : 0.01;
  return String(Math.round((s + 0.0125) * 10000) / 10000);
}

function bumpItem(v: ItemValue, kind: string): unknown {
  if (kind === "shift") return { add: "0.01", from: "2031-01" };
  if (kind === "outlook") return { adds: ["0.005", "0.01"] };
  if (kind === "mix") return [{ assetClass: "equity.global", share: "0.6" }, { assetClass: "cash.deposit", share: "0.4" }];
  if (typeof v === "number") return v + (v >= 1000 ? 10000 : 1);
  if (typeof v === "string") return String(Math.round((Number(v) + 0.0125) * 10000) / 10000);
  if (typeof v === "boolean") return !v;
  return null;
}

function actionsOf(stages: StageDef[]): ActionDef[] {
  return stages.flatMap((s) => s.sections.flatMap((sec) => [...sec.actions, ...sec.groups.flatMap((g) => g.actions)]));
}

/** 見本の世帯: モデル世帯・形式の見本・画面の「＋ 足す」の操作で物を足した世帯 */
function households(): Map<string, WorkingHousehold> {
  const out = new Map<string, WorkingHousehold>();
  const fx = join(REPO_DIR, "crates", "household-store", "tests", "fixtures", "household-format");
  for (const v of readdirSync(fx).filter((v) => /^\d+\.\d+$/.test(v)).sort()) out.set(`format-${v}`, fromBody(readFileSync(join(fx, v, "body.json"), "utf8")).wh);
  const dir = join(REPO_DIR, "data", "modelHouseholds");
  const models = readdirSync(dir).filter((f) => f.endsWith(".json")).sort();
  for (const f of models) out.set(`model-${f.slice(0, -5)}`, fromRequest(JSON.parse(readFileSync(join(dir, f), "utf8")) as EngineRequest));
  // 足す操作で物を足した世帯（空の世帯と、物の多いモデル世帯から）。ID は決まった並びで振る（見本を作り直しても同じにする）
  let seq = 0;
  const id = () => `00000000-0000-4000-8000-${String(++seq).padStart(12, "0")}`;
  const bases: [string, WorkingHousehold][] = [["blank", blankHousehold("2026-10", id)], ...["dualAssetsTwoKids", "housingPurchase", "elderCare", "advisoryFeeProposal", "investmentCouple"].map((n): [string, WorkingHousehold] => [n, out.get(`model-${n}`) as WorkingHousehold])];
  {
    const all = structuredClone(out.get("model-dualAssetsTwoKids") as WorkingHousehold);
    const classes = ["cash.deposit", "cash.foreign", "bond.domestic", "bond.global", "equity.domestic", "equity.global", "reit.domestic", "reit.global", "balanced", "commodity", "realEstate", "other"];
    (all.request.input.assumptions as unknown as Json).assetReturns = Object.fromEntries(classes.map((c, i) => [c, { default: `0.0${(i % 9) + 1}` }]));
    out.set("added-assetReturns", all);
  }
  const realId = crypto.randomUUID;
  try {
    (crypto as { randomUUID: () => string }).randomUUID = id as () => `${string}-${string}-${string}-${string}-${string}`;
    for (const [name, wh] of bases) {
      if (name === "blank") out.set("added-blank", wh);
      let n = 0;
      for (const a of actionsOf(buildStages(wh))) {
        if (a.danger === true || /remove|delete|clear|reset/i.test(a.key)) continue;
        let next: WorkingHousehold;
        try {
          next = a.run(wh);
        } catch {
          continue;
        }
        if (next === wh) continue;
        out.set(`added-${name}-${String(++n).padStart(2, "0")}`, next);
      }
    }
  } finally {
    (crypto as { randomUUID: typeof realId }).randomUUID = realId;
  }
  return out;
}

export function generate(): { entries: ReadingEntry[]; records: { household: string; key: string; reading: Reading; value: unknown }[]; households: Map<string, EngineRequest> } {
  const hs = households();
  const inst: Instance[] = [];
  const problems: string[] = [];
  for (const [name, wh] of hs) {
    const input = wh.request.input as unknown as Json;
    const memberIds = new Set(wh.request.input.household.members.map((m) => m.id));
    const stages = buildStages(wh);
    for (const f of stages.flatMap((s) => allFields(s))) {
      if (!NUMERIC.has(f.kind) || f.readOnly !== undefined || f.structural === true) continue;
      const key = `field:${f.key}`;
      const v0 = f.get(wh).value;
      const v1 = bump(f, v0);
      let after: WorkingHousehold;
      try {
        after = f.set(wh, v1 as never);
      } catch {
        inst.push({ household: name, key, from: patternOf(key, null, memberIds), value: v0, auto: "書けません" });
        continue;
      }
      const ch = changedPlace(input, after.request.input as unknown as Json);
      const one = ch.length === 1 && !(ch[0] as string[]).includes("#len") ? (ch[0] as string[]) : null;
      const stored = one === null ? undefined : unbox(one.reduce<unknown>((n, s) => (isObj(n) || Array.isArray(n) ? (n as Json)[s] : undefined), after.request.input));
      if (one !== null && sameValue(stored, v1)) {
        const auto = autoEntry(key, one, input);
        inst.push({ household: name, key, from: typeof auto === "string" ? patternOf(key, (key.match(UUID) ?? [])[0] ?? null, memberIds) : auto.from, value: v0, wrote: { v1, after: after.request.input as unknown as Json }, auto: typeof auto === "string" ? auto : auto.to });
      } else inst.push({ household: name, key, from: patternOf(key, (key.match(UUID) ?? [])[0] ?? null, memberIds), value: v0, auto: `1つの値をそのまま書きません（${ch.length}か所）` });
    }
    const selfId = wh.request.input.household.members.find((m) => m.kind === "self")?.id ?? "";
    const cat = buildCatalog(wh, selfId, null);
    for (const it of cat.items) {
      if (it.key.startsWith("field:")) continue;
      const v0 = it.read(wh);
      const v1 = bumpItem(v0, it.control.kind);
      const after = applyValues(wh, { [it.key]: v1 as ItemValue }, cat).input as unknown as Json;
      const firstId = (it.key.match(UUID) ?? [])[0] ?? null;
      inst.push({ household: name, key: it.key, from: patternOf(it.key, firstId, memberIds), value: v0, wrote: { v1, after } });
    }
    for (const k of Object.keys(wh.assumed)) {
      const firstId = (k.match(UUID) ?? [])[0] ?? null;
      inst.push({ household: name, key: `assumed:${k}`, from: patternOf(`assumed:${k}`, firstId, memberIds), value: null });
    }
  }
  // 行を決める: 手で決めた行が先、無ければ鍵と書いた場所から作った行（同じ型の全部で同じ行になること）
  const rows = new Map<string, To>();
  for (const x of inst) {
    const fixed = OVERRIDES[x.from];
    if (fixed !== undefined) {
      rows.set(x.from, fixed);
      continue;
    }
    if (x.key.startsWith("assumed:")) continue; // 欄の行で読む（resolveAssumedKey）
    if (typeof x.auto !== "object") {
      problems.push(`${x.from}: ${x.auto ?? "行がありません"}（${x.household}）`);
      continue;
    }
    const prev = rows.get(x.from);
    if (prev !== undefined && JSON.stringify(prev) !== JSON.stringify(x.auto)) problems.push(`${x.from}: 世帯で行が違います ${JSON.stringify(prev)} / ${JSON.stringify(x.auto)}（${x.household}）`);
    else rows.set(x.from, x.auto);
  }
  const entries: ReadingEntry[] = [...rows].map(([from, to]) => ({ from, until: UNTIL, to }));
  // 確かめて、見本の組を作る。形式の見本の世帯（消さない）を先に使い、残りの型は多くの型を持つ世帯から選ぶ（凍結する世帯を少なくする）
  const ok: { x: Instance; reading: Reading; value: unknown }[] = [];
  for (const x of inst) {
    const input = (hs.get(x.household) as WorkingHousehold).request.input as unknown as Json;
    const reading = x.key.startsWith("assumed:") ? resolveAssumedKey(x.key.slice(8), input, entries) : resolveKey(x.key, input, entries);
    if (reading === null) {
      problems.push(`${x.key}: 表で読めません（${x.household}）`);
      continue;
    }
    let value = x.value;
    if (reading.kind === "address") {
      const now = unbox(readAt(input, reading.address));
      if (x.key.startsWith("assumed:")) {
        if (now === undefined) problems.push(`${x.key}: 当て先に値がありません（${x.household}）`);
      } else if (now !== undefined && !sameValue(now, x.value)) problems.push(`${x.key}: 当て先の値 ${JSON.stringify(now)} が欄の値 ${JSON.stringify(x.value)} と違います（${x.household}）`);
      if (x.wrote !== undefined && !sameValue(unbox(readAt(x.wrote.after, reading.address)), x.wrote.v1)) problems.push(`${x.key}: 書いた値が当て先に入りません（${x.household}）`);
      // 見本に残す値は、当て先に入っている値（無ければ null。欄が既定の値を見せていても、データには無い）
      value = now ?? null;
    }
    ok.push({ x, reading, value: value ?? null });
  }
  const patternOfInst = (x: Instance) => (x.key.startsWith("assumed:") ? `assumed:${x.from.slice(8)}` : x.from);
  const byHousehold = new Map<string, Set<string>>();
  for (const o of ok) byHousehold.set(o.x.household, (byHousehold.get(o.x.household) ?? new Set()).add(patternOfInst(o.x)));
  const chosen = new Set([...byHousehold.keys()].filter((h) => h.startsWith("format-")));
  const covered = new Set([...chosen].flatMap((h) => [...(byHousehold.get(h) ?? [])]));
  const all = new Set(ok.map((o) => patternOfInst(o.x)));
  while ([...all].some((p) => !covered.has(p))) {
    const best = [...byHousehold].filter(([h]) => !chosen.has(h)).map(([h, ps]) => [h, [...ps].filter((p) => !covered.has(p)).length] as const).sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))[0];
    if (best === undefined || best[1] === 0) break;
    chosen.add(best[0]);
    for (const p of byHousehold.get(best[0]) ?? []) covered.add(p);
  }
  const per = new Map<string, number>();
  const records: { household: string; key: string; reading: Reading; value: unknown }[] = [];
  const used = new Set<string>();
  for (const o of ok.filter((o) => chosen.has(o.x.household)).sort((a, b) => Number(!a.x.household.startsWith("format-")) - Number(!b.x.household.startsWith("format-")))) {
    const p = patternOfInst(o.x);
    const n = per.get(p) ?? 0;
    if (n >= 2) continue;
    per.set(p, n + 1);
    records.push({ household: o.x.household, key: o.x.key, reading: o.reading, value: o.value });
    used.add(o.x.household);
  }
  if (problems.length > 0) throw new Error(`読み替え表を作れません:\n${[...new Set(problems)].join("\n")}`);
  const frozen = new Map<string, EngineRequest>();
  for (const h of used) if (!h.startsWith("format-")) frozen.set(h, (hs.get(h) as WorkingHousehold).request);
  return { entries, records, households: frozen };
}
