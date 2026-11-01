// 書類のお願い（0102）: 書類待ちの欄から作る送ってほしい書類の一覧（持ち主ごとにまとめる）・写す欄と代わりの値・書類の値を打つと消える・
// お客さまへの文（金額・番号を入れない）・ヒアリングシートの1枚目に載る・画面
import { h } from "preact";
import { renderToString } from "preact-render-to-string";
import { describe, expect, it } from "vitest";
import { readSheetXlsx, OFFICIAL_SHEETS, REQUESTED_DOCUMENTS_HEADING } from "../../hearing/src/index.ts";
import { unzip, text } from "../../xlsx/test/helpers.ts";
import { checkList } from "../src/workspace/input/checkRows.ts";
import { CheckList } from "../src/workspace/input/CheckList.tsx";
import { DocRequests } from "../src/workspace/input/DocRequests.tsx";
import { docRequests, docRequestTitles, MASK_NOTE, NAME_PLACEHOLDER, OFFICE_PLACEHOLDER, requestMessage, SAFE_SENDING } from "../src/workspace/input/docRequests.ts";
import { allFields, type FieldDef } from "../src/workspace/input/form.ts";
import { fromRequest, type WorkingHousehold } from "../src/workspace/input/household.ts";
import { addCar } from "../src/workspace/input/stages/cars.ts";
import { buildStage, buildStages } from "../src/workspace/input/stages/index.ts";
import { applyStateOp, availableOps, fieldStatus } from "../src/workspace/input/valueState.ts";
import { exportSheet, sheetFor } from "../src/workspace/hearing/sheet.ts";
import { modelHousehold, preview } from "./helpers.ts";

const open = (id: string) => fromRequest(modelHousehold(id));
let n = 0;
const ids = () => () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`;

/** 書類で確かめる欄を全部「書類で確かめる」にする（欄が増えることがあるので、増えなくなるまで） */
function allToDocs(wh0: WorkingHousehold): WorkingHousehold {
  let wh = wh0;
  for (let pass = 0; pass < 3; pass++)
    for (const st of buildStages(wh)) for (const f of allFields(st)) if (f.docCheck !== undefined && availableOps(f, wh).includes("unknown")) wh = applyStateOp(wh, f, "unknown");
  return wh;
}
const fieldByKey = (wh: WorkingHousehold, key: string): FieldDef => {
  for (const st of buildStages(wh)) for (const f of allFields(st)) if (f.key === key) return f;
  throw new Error(`no field ${key}`);
};

describe("送ってほしい書類の一覧", () => {
  it("書類待ちの欄を、書類と持ち主（人・ローン）ごとに1通にまとめ、写す欄と代わりの値を添える", () => {
    const wh = allToDocs(open("salariedCoupleTwoKids"));
    const reqs = docRequests(wh);
    expect(reqs.map((r) => r.title)).toEqual([
      "住民税の決定通知書（ご本人）",
      "住民税の決定通知書（配偶者）",
      "会社の退職金規程・制度の資料（ご本人）",
      "ねんきん定期便（ご本人）",
      "ねんきん定期便（配偶者）",
      "住宅ローンの返済予定表（ご本人）",
    ]);
    // 1通の中は、その書類で確かめる欄（加入月数の2つ・返済予定表の4つ）
    expect(reqs.find((r) => r.title === "ねんきん定期便（ご本人）")!.values.map((v) => v.field)).toEqual(["国民年金の加入月数", "厚生年金の加入月数"]);
    const loan = reqs.find((r) => r.doc === "住宅ローンの返済予定表")!;
    expect(loan.values.map((v) => v.field)).toEqual(["借入額", "金利（当初・年）", "返済期間", "今の残高"]);
    expect(loan.values[0]).toMatchObject({ card: "housing", value: "3,200万円", level: "simple" });
    expect(loan.values[3]).toMatchObject({ level: "detail" });
    // 確かめの一覧の書類待ちの行と、同じ数・同じ行
    const unknown = checkList(wh).filter((r) => r.kind === "unknown");
    expect(reqs.flatMap((r) => r.values.map((v) => v.rowId)).sort()).toEqual(unknown.map((r) => r.id).sort());
  });

  it("書類待ちが無ければ空。推定・確定の欄は載らない", () => {
    expect(docRequests(open("salariedCoupleTwoKids"))).toEqual([]);
  });

  it("書類の値を打つと、その欄は一覧から消え、書類の欄が全部埋まるとその書類も消える（#272 の確定）", () => {
    let wh = allToDocs(open("salariedCoupleTwoKids"));
    const pension = docRequests(wh).find((r) => r.title === "ねんきん定期便（ご本人）")!;
    const [basic, employee] = pension.values.map((v) => fieldByKey(wh, v.fieldKey!));
    wh = basic!.set(wh, 300);
    expect(fieldStatus(basic!, wh).status).toBe("confirmed");
    expect(docRequests(wh).find((r) => r.title === "ねんきん定期便（ご本人）")!.values.map((v) => v.field)).toEqual(["厚生年金の加入月数"]);
    wh = employee!.set(wh, 280);
    expect(docRequests(wh).some((r) => r.title === "ねんきん定期便（ご本人）")).toBe(false);
    // 代わりの値のまま「この値にする」でも消える
    const tax = docRequests(wh).find((r) => r.title === "住民税の決定通知書（配偶者）")!;
    const f = fieldByKey(wh, tax.values[0]!.fieldKey!);
    wh = applyStateOp(wh, f, "confirm");
    expect(docRequests(wh).some((r) => r.title === "住民税の決定通知書（配偶者）")).toBe(false);
    expect(() => preview(wh.request)).not.toThrow();
  });

  it("保険証券は契約ごと（種類の名前・被保険者）。自動車ローンの返済予定表は今返している自動車ローンごと（これから買う車のローンからは作らない）", () => {
    const req = modelHousehold("salariedCoupleTwoKids");
    req.input.household.insuranceContracts = [];
    let wh = fromRequest(req);
    const add = buildStage("insurance", wh).sections.flatMap((s) => [...s.actions, ...s.groups.flatMap((g) => g.actions)]).find((a) => a.key.endsWith("ins/addMedical"))!;
    wh = add.run(wh);
    const main = allFields(buildStage("insurance", wh)).find((f) => f.key.endsWith("/main"))!;
    wh = main.set(wh, 5000);
    wh = addCar(wh, ids());
    wh = allFields(buildStage("car", wh)).find((f) => f.key.endsWith("/pay"))!.set(wh, "loan");
    const surgery = allFields(buildStage("insurance", wh)).find((f) => f.docCheck === "保険証券")!;
    wh = applyStateOp(wh, surgery, "unknown");
    // これから買う車のローン（車の買い方）には書類で確かめるが無い
    expect(allFields(buildStage("car", wh)).filter((f) => f.item === "car.loan" && f.docCheck !== undefined)).toEqual([]);
    const addLoan = buildStage("car", wh).sections.flatMap((s) => s.actions).find((a) => a.key === "car/addCarLoan")!;
    wh = addLoan.run(wh);
    const debt = wh.request.input.household.debts!.find((d) => d.kind === "car")!;
    for (const k of ["rate", "term"]) wh = applyStateOp(wh, allFields(buildStage("car", wh)).find((f) => f.key === `housing/debt/${debt.id}/${k}`)!, "unknown");
    const titles = docRequests(wh).map((r) => r.title);
    expect(titles).toContain("保険証券（医療保険・ご本人）");
    expect(titles).toContain("自動車ローンの返済予定表（ご本人）");
    expect(docRequests(wh).find((r) => r.doc === "保険証券")!.values.map((v) => v.field)).toEqual(["手術（1回の額）"]);
    const car = docRequests(wh).find((r) => r.doc === "自動車ローンの返済予定表")!;
    expect(car.values.map((v) => v.fieldKey)).toEqual([`housing/debt/${debt.id}/rate`, `housing/debt/${debt.id}/term`]);
    expect(car.values.every((v) => v.card === "car")).toBe(true);
    expect(requestMessage(docRequests(wh))).toContain("・自動車ローンの返済予定表（ご本人）");
  });
});

describe("お客さまへのお願いの文", () => {
  const wh = allToDocs(open("salariedCoupleTwoKids"));
  const reqs = docRequests(wh);

  it("書類の名前と見たい所・番号を隠してよいこと・送り方の一言。お名前・事務所名が空なら置きかえる所の印", () => {
    const t = requestMessage(reqs);
    expect(t.startsWith(`${NAME_PLACEHOLDER}様\n`)).toBe(true);
    expect(t).toContain(OFFICE_PLACEHOLDER);
    for (const r of reqs) expect(t).toContain(`・${r.title}`);
    expect(t).toContain("（拝見したい所: 国民年金の加入月数、厚生年金の加入月数）");
    expect(t).toContain(MASK_NOTE);
    expect(t).toContain("証券番号・口座番号などは隠していただいてかまいません");
    expect(t).toContain("パスワード付きの圧縮ファイルをメールでお送りいただく必要はありません");
    expect(t).toContain("数字を写し終えたら削除いたします");
  });

  it("金額・代わりの値・ID は入れない。お名前・事務所名を入れればその言葉", () => {
    const t = requestMessage(reqs, { name: "山田", office: "サンプルFP事務所" });
    expect(t.startsWith("山田様\n")).toBe(true);
    expect(t).toContain("サンプルFP事務所です。");
    // 金額・月数・率の言葉も、代わりの値の数も入らない（数は欄の名前の年度だけ）
    expect(t).not.toMatch(/円|か月|%|年\b/u);
    for (const v of reqs.flatMap((r) => r.values)) if (v.value !== null) expect(t).not.toContain(v.value);
    expect(t.match(/\d+/gu)?.every((d) => d === "2026")).toBe(true);
    for (const m of wh.request.input.household.members) expect(t).not.toContain(m.id);
    expect(requestMessage([])).toBe("");
  });

  it("受け取り方の注意（FP 向け）は、パスワード付きの圧縮ファイル・アップロード専用のリンク・写し終えたら消す・画像を世帯に入れない", () => {
    expect(SAFE_SENDING.map((s) => s.title)).toEqual(["パスワード付きの圧縮ファイルをメールで受け取らない", "アップロード専用のリンクで受け取る", "写し終えたら消す", "書類の画像は世帯ファイルに入れない"]);
  });
});

describe("ヒアリングシートの1枚目に載る（0018 の追記）", () => {
  it("書き出しに渡すと「今回お願いしたい書類」に見出しが並び、取り込みは同じに読める", async () => {
    const wh = allToDocs(open("salariedCoupleTwoKids"));
    const docs = docRequestTitles(docRequests(wh));
    const o = { definition: sheetFor("detail"), prefill: false, customerNo: "A0001", office: { name: "", purpose: "", privacyContact: "" }, appVersion: "0.1.0", exportedOn: "2026-10-31", random: new Uint8Array(8) };
    const r = await exportSheet(wh, { ...o, requestedDocuments: docs });
    const intro = text((await unzip(r.bytes)).get("xl/worksheets/sheet1.xml"));
    expect(intro).toContain(REQUESTED_DOCUMENTS_HEADING);
    for (const d of docs) expect(intro).toContain(`・${d}`);
    const back = await readSheetXlsx(r.bytes, { definitions: OFFICIAL_SHEETS, requests: [r.request] });
    expect(back.ok).toBe(true);
    // 渡さなければ今までどおり
    const plain = await exportSheet(wh, o);
    expect(text((await unzip(plain.bytes)).get("xl/worksheets/sheet1.xml"))).not.toContain(REQUESTED_DOCUMENTS_HEADING);
  });
});

describe("画面", () => {
  it("書類のお願い: 書類ごとに写す欄・代わりの値・開く。文をコピーと受け取り方の注意", () => {
    const wh = allToDocs(open("salariedCoupleTwoKids"));
    const html = renderToString(h(DocRequests, { wh, onOpen: () => undefined }));
    expect(html).toContain("ねんきん定期便（ご本人）");
    expect(html).toContain("代わりの値 3,200万円");
    expect(html).toContain("data-dr-open");
    expect(html).toContain("data-dr-copy");
    expect(html).toContain("書類を安全に受け取るには");
    expect(html).not.toContain("カード");
    const none = renderToString(h(DocRequests, { wh: open("salariedCoupleTwoKids"), onOpen: () => undefined }));
    expect(none).toContain("書類待ちの欄はありません");
    expect(none).not.toContain("data-dr-copy");
  });

  it("確かめの一覧の書類待ちの見出しに「書類のお願いにまとめる」（渡したときだけ）", () => {
    const wh = allToDocs(open("salariedCoupleTwoKids"));
    const onEdit = () => undefined;
    const onOpen = () => undefined;
    expect(renderToString(h(CheckList, { wh, onEdit, onOpen, onDocRequests: () => undefined }))).toContain("data-ck-doc-requests");
    expect(renderToString(h(CheckList, { wh, onEdit, onOpen }))).not.toContain("data-ck-doc-requests");
  });
});
