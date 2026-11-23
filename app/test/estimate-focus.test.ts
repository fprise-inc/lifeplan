// 推定の欄の入り方と、「この値にする」と単位の並び（0254）:
// 1. 推定の値の欄に入ると、推定の数字を全部選んだ状態になる（そのまま打てば置き換わる。何も打たずに離れたら推定のまま）。FP が入れた値の欄は今までどおり
// 2. 欄の中は数字だけ・単位（年後・年ごと・万円など）は欄のすぐ右・「この値にする」は単位のさらに右（欄の中に入れない）
// 3. 空のまま離れたときの知らせは「空にはできません。値を入れてください」だけ（「「」は入れられないため…」と出さない）
// 4. 推定している選択肢（区切りボタン・選ぶ欄）は、点線・薄い色で選ばれた見た目
// 打つ・押す・選択の動きは見えないブラウザの通しのテスト（test/walkthrough/estimate-focus.test.ts）で確かめる
import { describe, expect, it } from "vitest";
import { h } from "preact";
import { renderToString } from "preact-render-to-string";
import { estimateSelectText, keptText } from "../src/workspace/input/estimateFocus.ts";
import { estOptionTitle, Field, FieldStateOps, rejectReason, whenNumber } from "../src/workspace/input/FieldViews.tsx";
import { allFields, type FieldDef } from "../src/workspace/input/form.ts";
import { blankHousehold, fromRequest, type WorkingHousehold } from "../src/workspace/input/household.ts";
import { addCar } from "../src/workspace/input/stages/cars.ts";
import { buildStage } from "../src/workspace/input/stages/index.ts";
import { applyStateOp, fieldStatus, typeValue } from "../src/workspace/input/valueState.ts";
import { parseWhen, showWhen, typingCtx, type WhenCtx } from "../src/workspace/input/when.ts";
import { SavingsPanel } from "../src/workspace/input/savings/SavingsPanel.tsx";
import { modelHousehold } from "./helpers.ts";

const ids = () => {
  let n = 0;
  return () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}`;
};
const noop = () => undefined;
const fieldHtml = (wh: WorkingHousehold, f: FieldDef) => renderToString(h(FieldStateOps.Provider, { value: applyStateOp }, h(Field, { f, wh, onEdit: noop })));
const carField = (wh: WorkingHousehold, suffix: string) => allFields(buildStage("car", wh)).find((f) => f.key.endsWith(suffix)) as FieldDef;
/** 欄の中（.fld-c）の並び: 子の要素の頭の名前（input・単位・ボタン） */
const order = (html: string): string[] => {
  const c = /<div class="fld-c">([\s\S]*?)<\/div>/.exec(html)?.[1] ?? "";
  return [...c.matchAll(/<(input|select|span|button)\b([^>]*)>/g)].map((m) => {
    const cls = /class="([^"]*)"/.exec(m[2] ?? "")?.[1] ?? "";
    return `${m[1]}${cls !== "" ? `.${cls.split(" ")[0]}` : ""}`;
  });
};
/** 新しい車（買い替え・購入の時期と周期が推定）の世帯。基準月を変えて境目を見る */
const withCar = (base?: string) => {
  const req = modelHousehold("salariedCoupleTwoKids");
  if (base !== undefined) req.input.baseMonth = base;
  return addCar(fromRequest(req), ids());
};

describe("1. 推定の欄に入ったときに全部選ぶ文字", () => {
  it("推定の値が入っている欄はその値、空欄のまま推定で計算している欄は灰色の推定の値", () => {
    expect(estimateSelectText(true, "8", null)).toBe("8");
    expect(estimateSelectText(true, "", "5.2")).toBe("5.2");
    // 入っている値を優先（灰色の値は空欄のときだけ）
    expect(estimateSelectText(true, "47.2", "5.2")).toBe("47.2");
  });

  it("FP が入れた値の欄（推定でない）・選ぶ文字の無い推定の欄は null（今までどおり押した所に文字の位置）", () => {
    expect(estimateSelectText(false, "8", null)).toBeNull();
    expect(estimateSelectText(false, "", "5.2")).toBeNull();
    // 「空欄＝推定」のように値の無い推定の欄
    expect(estimateSelectText(true, "", null)).toBeNull();
    expect(estimateSelectText(true, "", "")).toBeNull();
  });
});

describe("2. 欄の中は数字だけ・単位は欄のすぐ右・「この値にする」は単位のさらに右", () => {
  it("買い替えの周期（推定）: 欄の中は「8」、右に「年ごと」、そのさらに右に「この値にする」", () => {
    const wh = withCar();
    const f = carField(wh, "/every");
    expect(fieldStatus(f, wh).status).toBe("estimated");
    const html = fieldHtml(wh, f);
    expect(html).toMatch(/<input [^>]*class="num"[^>]*value="\d+"/);
    expect(order(html)).toEqual(["span.fld-in", "input.num", "span.suffix", "button.fld-fill"]);
    expect(html).toMatch(/<span class="suffix">年ごと<\/span><button type="button" class="fld-fill"/);
    expect(html).not.toContain("fld-box");
    expect(html).not.toContain(" inside");
  });

  it("次の買い替えの時期（推定）: 欄の中は「3」、右に「年後」、そのさらに右に「この値にする」（欄の中に「3年後」と単位まで入れない）", () => {
    const wh = withCar();
    const f = carField(wh, "/first");
    expect(fieldStatus(f, wh).status).toBe("estimated");
    const html = fieldHtml(wh, f);
    expect(html).toMatch(/<input [^>]*class="when-in num-only"[^>]*value="3"/);
    expect(html).not.toMatch(/value="3年後"/);
    expect(html).toMatch(/<span class="suffix" data-when-unit="[^"]*">年後<\/span>/);
    const seq = order(html);
    expect(seq.indexOf("span.suffix")).toBe(seq.indexOf("input.when-in") + 1);
    expect(seq.indexOf("button.fld-fill")).toBeGreaterThan(seq.indexOf("span.suffix"));
  });

  it("FP が入れた値の欄も同じ並び（「この値にする」は出ない）", () => {
    let wh = withCar();
    const f = carField(wh, "/every");
    wh = typeValue(f, wh, 6);
    expect(fieldStatus(f, wh).status).toBe("confirmed");
    const html = fieldHtml(wh, f);
    expect(order(html)).toEqual(["span.fld-in", "input.num", "span.suffix"]);
    expect(html).toMatch(/value="6"/);
    expect(html).not.toContain("data-fill-estimate");
  });

  it("時点の欄の数字と単位の分け方: 「3年後」「65歳」だけ分け、ほかの形は欄の中にそのまま", () => {
    expect(whenNumber("3年後", "now")).toEqual({ num: "3", unit: "年後" });
    expect(whenNumber("12年後", "now")).toEqual({ num: "12", unit: "年後" });
    expect(whenNumber("65歳", "age")).toEqual({ num: "65", unit: "歳" });
    expect(whenNumber("3年2か月後", "now")).toBeNull();
    expect(whenNumber("今月", "now")).toBeNull();
    expect(whenNumber("65歳3か月", "age")).toBeNull();
    expect(whenNumber("65歳の誕生月", "age")).toBeNull();
    expect(whenNumber("配偶者65歳", "age")).toBeNull();
    // 入れ方の違い: 年月・出来事からは分けない（数字だけでは同じ時点に読めない）
    expect(whenNumber("2041-06", "ym")).toBeNull();
    expect(whenNumber("3年後", "event")).toBeNull();
    expect(whenNumber("65歳", "now")).toBeNull();
  });

  it("欄の中の数字だけを打ち直すと、同じ時点に読める（基準月が1〜3月の年も）", () => {
    for (const base of ["2026-10", "2027-01", "2027-03"]) {
      const wh = withCar(base);
      const f = carField(wh, "/first");
      const st = f.time!.state(wh);
      const raw = st.linked?.at ?? st.raw;
      const mode = st.ctx.mode ?? st.ctx.defaultMode;
      const ctx: WhenCtx = { ...st.ctx, mode, current: raw };
      const full = showWhen(raw, ctx);
      const parts = whenNumber(full, mode);
      expect(parts).not.toBeNull();
      const a = parseWhen(parts!.num, typingCtx(st.ctx, raw, mode));
      const b = parseWhen(full, typingCtx(st.ctx, raw, mode));
      expect(a.ok && b.ok).toBe(true);
      if (a.ok && b.ok) expect(a.tp).toEqual(b.tp);
    }
  });
});

describe("3. 空のまま離れたときの知らせ", () => {
  it("空のときは理由だけ（「「」は入れられないため…」と出さない）", () => {
    expect(keptText("", "空にはできません。値を入れてください")).toBe("空にはできません。値を入れてください");
    expect(keptText("  ", "空にはできません。値を入れてください")).toBe("空にはできません。値を入れてください");
    expect(keptText("　", "空にはできません。値を入れてください")).toBe("空にはできません。値を入れてください");
    expect(keptText("", "空にはできません。時点を入れてください")).toBe("空にはできません。時点を入れてください");
  });

  it("空でない文字は今までどおり、打った文字と前の値のままであることを出す", () => {
    expect(keptText("abc", "整数で入れてください")).toBe("「abc」は入れられないため、前の値のままです。整数で入れてください");
  });

  it("空にできない欄の理由は「空にはできません。値を入れてください」", () => {
    const wh = withCar();
    expect(rejectReason(carField(wh, "/every"), "")).toBe("空にはできません。値を入れてください");
  });
});

describe("4. 推定している選択肢は、点線・薄い色で選ばれた見た目", () => {
  it("カーソルを合わせたときの文は推定の根拠と、押すと確定になること", () => {
    expect(estOptionTitle("65歳に一時金で受け取る計算")).toBe("推定: 65歳に一時金で受け取る計算（押すと、この選択で確定します）");
    expect(estOptionTitle(null)).toContain("押すと、この選択で確定します");
  });

  it("iDeCo の受け取り方（貯蓄・運用の入力項目の区切りボタン）: 空欄なら「一時金」を推定の見た目、どれかを押せばふつうの選ばれた見た目", () => {
    let found = 0;
    for (const m of ["dualAssetsTwoKids", "investmentCouple", "single45", "idecoPayout"]) {
      const wh = fromRequest(modelHousehold(m));
      const html = renderToString(h(SavingsPanel, { wh, level: "simple", onEdit: noop }));
      for (const g of html.matchAll(/role="group" aria-label="[^"]*の受け取り方">([\s\S]*?)<\/span>/g)) {
        const block = g[1] ?? "";
        if (block.includes('aria-pressed="true"')) {
          // 選んだ欄はふつうの選ばれた見た目だけ（推定の見た目は無い）
          expect(block).not.toContain("is-est-opt");
          continue;
        }
        found++;
        expect(block).toMatch(/<button type="button" aria-pressed="false" class="is-est-opt" title="推定: [^"]*に一時金で受け取る計算（押すと、この選択で確定します）" data-est-option="lumpSum">一時金<\/button>/);
        expect(block.match(/is-est-opt/g)?.length).toBe(1);
      }
    }
    expect(found).toBeGreaterThan(0);
  });

  it("区切りボタンの欄で推定の値が入っているとき（申告の仕方など）は、その選択肢を点線・薄い色で選ばれた見た目。FP が選んだ値はふつうの塗り", () => {
    let found = 0;
    for (const m of ["sampleSelfEmployedFamily", "sampleSeniorRental", "sampleParentsCare"]) {
      const wh = fromRequest(modelHousehold(m));
      for (const stage of ["work", "housing", "savings", "family", "insurance", "living"] as const) {
        for (const f of allFields(buildStage(stage, wh))) {
          const html = fieldHtml(wh, f);
          if (!html.includes("data-seg")) continue;
          const st = fieldStatus(f, wh).status;
          if (st === "estimated" && f.get(wh).value !== null) {
            found++;
            expect(html).toMatch(/<button type="button" role="radio" (id="[^"]*" )?class="is-est-opt" aria-checked="true"/);
            // 押すと FP が選んだ値（推定の印が消える）
            const next = typeValue(f, wh, f.get(wh).value);
            expect(fieldStatus(f, next).status).toBe("confirmed");
            expect(fieldHtml(next, f)).not.toContain("is-est-opt");
          } else if (st === "confirmed") expect(html).not.toContain("is-est-opt");
        }
      }
    }
    expect(found).toBeGreaterThan(0);
  });

  it("選ぶ欄（区切りボタンの欄でない）の推定は、推定の選択肢を選ばれた見た目で出し、一覧には出さない", () => {
    let found = 0;
    for (const wh of [blankHousehold("2026-10", ids()), fromRequest(modelHousehold("dualAssetsTwoKids")), fromRequest(modelHousehold("investmentCouple")), fromRequest(modelHousehold("single45"))]) {
      for (const stage of ["family", "education", "work", "savings", "pension", "retirement", "housing", "car", "care"] as const) {
        for (const f of allFields(buildStage(stage, wh))) {
          const html = fieldHtml(wh, f);
          if (!html.includes("data-est-option")) continue;
          found++;
          expect(html).not.toContain("（推定:");
          expect(html).toMatch(/<option selected value disabled hidden>[^<]+<\/option>|class="is-est-opt"/);
        }
      }
    }
    expect(found).toBeGreaterThan(0);
  });
});
