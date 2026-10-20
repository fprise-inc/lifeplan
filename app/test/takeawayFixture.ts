// テストの道具: 架空のモデル世帯から、持ち帰り用のレポートの中身とファイルを作る（本物のエンジン・本物の画面の部品）
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { demoHousehold } from "../src/workspace/catalog.ts";
import { fromRequest } from "../src/workspace/input/household.ts";
import { CURRENT, planLetters } from "../src/workspace/plans/band.ts";
import { buildCatalog } from "../src/workspace/plans/items.ts";
import { effectiveValues, savePlan } from "../src/workspace/plans/plans.ts";
import { roles } from "../src/workspace/roles.ts";
import { buildPayload, type TakeawayChoice } from "../src/workspace/takeaway/build.ts";
import type { TakeawayAssets } from "../src/workspace/takeaway/file.ts";
import { ENGINE_DIST } from "../scripts/lib.ts";
import { TAKEAWAY_OUT } from "../scripts/build-takeaway.ts";
import { modelHousehold } from "./helpers.ts";

export const NOW = "2026-10-21T10:00:00.000Z";

/** 目印の文字（FP用のメモ・呼び名・案の注記などに入れ、ファイルのどこにも出ないことを確かめる） */
export const MARK = "MARK-TAKEAWAY-SECRET";

export function openHousehold(id: string, opts: { marks?: boolean } = {}) {
  const req = modelHousehold(id);
  const self = roles(req).find((r) => r.key === "self")!.member;
  const demo = demoHousehold(id) ?? null;
  const re = demo?.reemployment;
  let wh = fromRequest(req, { memo: opts.marks === true ? [`${MARK}-memo`] : [], ...(re !== undefined ? { postRetirement: { [self.id]: { ...re, type: re.type as "contract" } } } : {}) });
  if (opts.marks === true) wh = { ...wh, labelsByMember: { [self.id]: `${MARK}-label` } };
  const cat = buildCatalog(wh, self.id, demo);
  const living = cat.byKey.get("lever:livingMonthly")!.read(wh) as number;
  const b = savePlan(wh, cat, { name: "プランB 生活費を見直してNISA", base: null, values: { "lever:livingMonthly": living - 20000, "lever:nisaMonthly": 30000, ...(cat.byKey.has("lever:fee") ? { "lever:fee": true } : {}) }, now: NOW });
  wh = b.wh;
  const c = savePlan(wh, cat, { name: "プランC 67歳まで働く", base: null, values: { "lever:retireAge": 67 }, now: NOW });
  wh = c.wh;
  const letters = planLetters(wh.proposals);
  const ctx = { wh, catalog: cat, valuesOf: (pid: string) => (pid === CURRENT ? {} : effectiveValues(wh.proposals, pid)), letterOf: (pid: string) => letters.get(pid) ?? { letter: "?", name: "" } };
  return { wh, cat, ctx, b: b.id, c: c.id, self };
}

export function choiceFor(o: ReturnType<typeof openHousehold>, over: Partial<TakeawayChoice> = {}): TakeawayChoice {
  return {
    proposal: o.b,
    compare: [CURRENT, o.b, o.c],
    base: CURRENT,
    band: [o.b, o.c],
    excluded: new Set(),
    views: { balance: true, table: true },
    addressee: "",
    office: "",
    targetAge: 95,
    createdOn: "2026-10-21",
    dataSet: "2026.10-00000000",
    ...over,
  };
}

export function payloadFor(id: string, over: Partial<TakeawayChoice> = {}, opts: { marks?: boolean } = {}) {
  const o = openHousehold(id, opts);
  return { o, payload: buildPayload(o.ctx, choiceFor(o, over)) };
}

export function assets(): TakeawayAssets {
  return {
    viewerJs: readFileSync(join(TAKEAWAY_OUT, "viewer.js"), "utf8"),
    viewerCss: readFileSync(join(TAKEAWAY_OUT, "viewer.css"), "utf8"),
    engineJs: readFileSync(join(ENGINE_DIST, "engine.js"), "utf8"),
    licenses: readFileSync(join(TAKEAWAY_OUT, "licenses.txt"), "utf8"),
  };
}
