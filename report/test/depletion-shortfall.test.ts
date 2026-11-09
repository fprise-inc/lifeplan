// 提案書の「金融資産が不足する年」は、使えるお金で払えなくなる年（計算エンジンの資金不足の行）。引き出せない iDeCo が残って
// 金融資産の合計が正でも尽きたとみる（アプリの結論と同じ。0179。R4-007）
import { expect, it } from "vitest";
import { buildProposalInput } from "../src/build.ts";
import type { EngineRequest, ProposalBundle } from "../src/bundle.ts";
import { modelHousehold, run } from "../scripts/engine.ts";
import { byYear } from "./helpers.ts";

it("一人暮らし45歳: 預金100万円・iDeCo 1,500万円で2027年末に仕事をやめると、預金が尽きる年が不足する年", () => {
  const req = structuredClone(modelHousehold("single45")) as unknown as { input: { endYear: number; household: { accounts: { kind: string; marketValue: { value: number } }[]; employmentPeriods: { to?: unknown }[] } } };
  const h = req.input.household;
  (h.accounts.find((a) => a.kind === "deposit") as { marketValue: { value: number } }).marketValue.value = 1_000_000;
  (h.accounts.find((a) => a.kind === "ideco") as { marketValue: { value: number } }).marketValue.value = 15_000_000;
  req.input.endYear = 2070;
  (h.employmentPeriods[0] as { to?: unknown }).to = { at: "2027-12" };
  const r = run(req as unknown as EngineRequest);
  const bundle: ProposalBundle = { document: { issuedOn: "2026-11-08" }, current: r, proposal: r, targetAge: 95, layout: { orientation: "portrait", cashflow: "summary" } };
  const input = buildProposalInput(bundle);
  const short = byYear(r.result, (c) => c.row === "cf.balance.shortfall");
  const first = input.basis.years.find((y) => (short.get(y) ?? 0) > 0) as number;
  expect(first).toBeDefined();
  expect(byYear(r.result, (c) => c.row === "cf.balance.financial").get(first) ?? 0).toBeGreaterThan(0);
  expect(input.summary.proposal.depletion?.year).toBe(first); // 前は金融資産がマイナスになる年（iDeCo を引き出せる60歳の後）か、尽きない
});
