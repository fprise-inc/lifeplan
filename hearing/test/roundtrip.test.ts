// 往復: モデル世帯 → シートに書き出し（.xlsx）→ 読み込み → 取り込み → もう一度書き出すと、同じ回答になる。
// 取り込んだ世帯は、本物の計算エンジンでそのまま計算できる
import { describe, expect, it } from "vitest";
import { approveAll, createHearingSheet, exportAnswers, importHearingSheet } from "../src/index.ts";
import { full, engineAvailable, idSeq, modelHousehold, modelNames, OFFICE, preview } from "./helpers.ts";

const def = full();

describe.each(modelNames())("モデル世帯 %s", (name) => {
  it("書き出し → 取り込み → 書き出しで、同じ回答になる", async () => {
    const req = modelHousehold(name);
    const sheet = await createHearingSheet({ definition: def, household: { request: req }, requestId: "R-7K3P9Q", customerNo: "A0001", office: OFFICE, appVersion: "0.1.0", exportedOn: "2026-10-17" });
    expect(sheet.request.prefilled).toBe(true);
    expect(sheet.issues.some((i) => i.code === "H_EXPORT_PREFILL")).toBe(true);
    const im = await importHearingSheet(sheet.bytes, { baseMonth: req.input.baseMonth, requests: [sheet.request], newId: idSeq(name) });
    if (!im.ok) throw new Error(JSON.stringify(im.issues));
    expect(im.issues.filter((i) => i.level === "error")).toEqual([]);
    const again = exportAnswers(def, im.request, { assumed: im.assumed });
    expect(again.answers).toEqual(sheet.filled.answers);

    // 元の世帯の主な値が、取り込んだ世帯に入っている
    const h0 = req.input.household;
    const h1 = im.request.input.household;
    const self0 = h0.members.find((m) => m.kind === "self");
    const self1 = h1.members.find((m) => m.kind === "self");
    expect(self1?.birth.birthYearMonth).toBe(self0?.birth.birthYearMonth);
    expect(h1.members.filter((m) => m.kind === "child").length).toBe(Math.min(4, h0.members.filter((m) => m.kind === "child").length));
    // 外から来た値は出どころ「ヒアリング」と依頼番号を持つ
    for (const c of im.candidates) expect(c.origin).toEqual({ kind: "hearing", ref: "R-7K3P9Q" });

    if (engineAvailable()) {
      const r = preview(approveAll(im, "2026-10-17T10:00:00+09:00"));
      expect(r.error, JSON.stringify(r.error)).toBeUndefined();
    }
  });
});
