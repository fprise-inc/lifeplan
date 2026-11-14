// 表の最後の年の標準（本人・配偶者のうち若い方が100歳になる年。子は含めない）: 新しい世帯で家族を足していったとき、
// アプリの見本の世帯を開いたとき（元のモデル世帯は表の長さがまちまち）、資産と負債のタブ・結果のタブの年の範囲
import { describe, expect, it } from "vitest";
import { h } from "preact";
import { renderToString } from "preact-render-to-string";
import { BalanceTab } from "../src/presentation/BalanceTab.tsx";
import { DEMO_HOUSEHOLDS } from "../src/workspace/catalog.ts";
import { balanceTabModel, bsPlan, DEFAULT_BS_GUIDE, DEFAULT_BS_POINTS } from "../src/workspace/balanceTab.ts";
import { allFields, type FieldDef } from "../src/workspace/input/form.ts";
import { blankHousehold, fromRequest, mutate, sampleRequest, standardEndYear, type WorkingHousehold } from "../src/workspace/input/household.ts";
import { endYearNotice, endYearOff } from "../src/workspace/input/stages/assumptions.ts";
import { addChildWithEducation, addMember, removeMember } from "../src/workspace/input/stages/family.ts";
import { buildStage } from "../src/workspace/input/stages/index.ts";
import { parseYearMonth } from "../src/workspace/input/units.ts";
import { applyStateOp, fieldStatus, typeValue } from "../src/workspace/input/valueState.ts";
import { EndYearNote } from "../src/workspace/tools/Insights.tsx";
import { displayYears } from "../src/workspace/present.ts";
import { modelHousehold, preview } from "./helpers.ts";

const fieldOf = (wh: WorkingHousehold, stage: "family" | "assumptions", key: string): FieldDef => {
  const f = allFields(buildStage(stage, wh)).find((x) => x.key === key);
  if (f === undefined) throw new Error(`欄が無い: ${key}`);
  return f;
};
const ids = (prefix: string) => {
  let n = 0;
  return () => `${prefix}-${++n}`;
};
const newest = (wh: WorkingHousehold) => wh.request.input.household.members.at(-1)!;

describe("新しい世帯の表の最後の年", () => {
  it("本人30歳・配偶者29歳・0歳の子: 若い方の大人（配偶者）が100歳になる年。子の100歳ではない", () => {
    const id = ids("m");
    let wh = blankHousehold("2026-10", id);
    const self = wh.request.input.household.members[0]!;
    wh = fieldOf(wh, "family", `family/${self.id}/birth`).set(wh, "1996-05");
    expect(wh.request.input.endYear).toBe(2096);
    wh = addMember(wh, "spouse", id);
    wh = fieldOf(wh, "family", `family/${newest(wh).id}/birth`).set(wh, "1997-01");
    expect(wh.request.input.endYear).toBe(2097);
    wh = addMember(wh, "child", id);
    wh = fieldOf(wh, "family", `family/${newest(wh).id}/birth`).set(wh, "2026-08");
    expect(wh.request.input.endYear).toBe(2097);
    expect(standardEndYear(wh.request.input.household)).toBe(2097);
    // 推定（標準の値）の印のまま
    expect(fieldStatus(fieldOf(wh, "assumptions", "assume/endYear"), wh).status).toBe("estimated");
  });

  it("単身なら本人が100歳になる年", () => {
    let wh = blankHousehold("2026-10", ids("s"));
    const self = wh.request.input.household.members[0]!;
    wh = fieldOf(wh, "family", `family/${self.id}/birth`).set(wh, "1999-06");
    expect(wh.request.input.endYear).toBe(2099);
  });
});

/** 生年月の欄に1文字ずつ打つ（画面と同じく、打つたびに読める値なら書く。途中の値も書く） */
const typeBirth = (wh: WorkingHousehold, id: string, text: string): WorkingHousehold => {
  for (let i = 1; i <= text.length; i++) {
    const v = parseYearMonth(text.slice(0, i));
    if (v !== null) wh = typeValue(fieldOf(wh, "family", `family/${id}/birth`), wh, v);
  }
  return wh;
};
const idsOf = (wh: WorkingHousehold) => wh.request.input.household.members.map((m) => m.id);

describe("空の世帯から 本人30歳・配偶者29歳・第1子15歳・第2子13歳 を入れたとき（2026年10月）", () => {
  // 打ち方（西暦・区切り無し・和暦・斜線）と、家族を足す順（先に全員足す・本人を先に直す・1人ずつ足して直す）のどれでも、
  // 表の最後の年は標準（配偶者が100歳になる 2097年）で、推定のまま。途中で生年月が一時的に別の年になっても戻る
  const births: [string, string, string, string][] = [
    ["1996-05", "1997-01", "2011-04", "2013-06"],
    ["199605", "199701", "201104", "201306"],
    ["H8.5", "H9.1", "H23.4", "H25.6"],
    ["1996/5", "1997/1", "2011/4", "2013/6"],
  ];
  for (const b of births)
    for (const order of ["先に全員足す", "本人を先に直す", "1人ずつ"] as const)
      it(`${b[0]} の打ち方・${order}`, () => {
        let wh = blankHousehold("2026-10", ids(`f${order}`));
        if (order === "先に全員足す") {
          wh = addChildWithEducation(addChildWithEducation(addMember(wh, "spouse")));
          idsOf(wh).forEach((id, i) => (wh = typeBirth(wh, id, b[i]!)));
        } else if (order === "本人を先に直す") {
          wh = typeBirth(wh, idsOf(wh)[0]!, b[0]);
          wh = addChildWithEducation(addChildWithEducation(addMember(wh, "spouse")));
          idsOf(wh).slice(1).forEach((id, i) => (wh = typeBirth(wh, id, b[i + 1]!)));
        } else {
          wh = typeBirth(wh, idsOf(wh)[0]!, b[0]);
          wh = addMember(wh, "spouse");
          wh = typeBirth(wh, idsOf(wh)[1]!, b[1]);
          wh = addChildWithEducation(wh);
          wh = typeBirth(wh, idsOf(wh)[2]!, b[2]);
          wh = addChildWithEducation(wh);
          wh = typeBirth(wh, idsOf(wh)[3]!, b[3]);
        }
        expect(wh.request.input.household.members.map((m) => m.birth.birthYearMonth)).toEqual(["1996-05", "1997-01", "2011-04", "2013-06"]);
        expect(wh.request.input.endYear).toBe(2097);
        expect(fieldStatus(fieldOf(wh, "assumptions", "assume/endYear"), wh).status).toBe("estimated");
        expect(endYearOff(wh)).toBeNull();
      });

  it("足した子の続柄を配偶者にした・0歳の生年月を一時的に入れた・家族を外した、の後に直しても標準に戻る", () => {
    const id = ids("k");
    let wh = blankHousehold("2026-10", id);
    wh = typeBirth(wh, idsOf(wh)[0]!, "1996-05");
    // 配偶者のつもりで子を足し、続柄を配偶者に直す（子の初めの生年月は 2026年＝0歳なので、一時的に表は 2126年まで）
    wh = addChildWithEducation(wh, id);
    const p = idsOf(wh)[1]!;
    wh = fieldOf(wh, "family", `family/${p}/kind`).set(wh, "spouse");
    expect(wh.request.input.endYear).toBe(2126);
    // 0歳の生年月（2025年）を一時的に入れてから直す
    wh = typeBirth(wh, p, "2025-03");
    expect(wh.request.input.endYear).toBe(2125);
    wh = typeBirth(wh, p, "1997-01");
    expect(wh.request.input.endYear).toBe(2097);
    // 子を足して外す
    wh = addChildWithEducation(wh, id);
    wh = removeMember(wh, idsOf(wh)[2]!);
    expect(wh.request.input.endYear).toBe(2097);
    // 生年月の欄の「この値にする」（確定）は値を変えない
    wh = applyStateOp(wh, fieldOf(wh, "family", `family/${p}/birth`), "confirm");
    expect(wh.request.input.endYear).toBe(2097);
    expect(endYearOff(wh)).toBeNull();
  });

  it("人が入れた年・確定した年は、家族を直しても変えない（今の決まりのまま）", () => {
    let wh = blankHousehold("2026-10", ids("u"));
    wh = typeBirth(wh, idsOf(wh)[0]!, "1996-05");
    // 「年で決める…」で入れた年（0070 の追記 2026-11-13）
    const byYear = fieldOf(wh, "assumptions", "assume/endYear").set(wh, "year");
    const typed = fieldOf(byYear, "assumptions", "assume/endYear/year").set(byYear, 2090);
    expect(typeBirth(typed, idsOf(typed)[0]!, "1990-05").request.input.endYear).toBe(2090);
    const pinned = applyStateOp(wh, fieldOf(wh, "assumptions", "assume/endYear"), "confirm");
    expect(typeBirth(pinned, idsOf(pinned)[0]!, "1990-05").request.input.endYear).toBe(2096);
  });
});

describe("保存した世帯で表の最後の年が標準から外れているとき（前の版の見本の写しなど）", () => {
  /** 前の版で見本（100年分）を開いて保存し、子を直した世帯: 表の最後の年は 2125年のまま */
  const saved = (): WorkingHousehold =>
    mutate(fromRequest(modelHousehold("lifetime100Plan")), (h) => {
      const kids = h.members.filter((m) => m.kind === "child");
      kids[0]!.birth.birthYearMonth = "2011-04";
    });

  it("結果のタブの入力の確認に出し、押したときだけ既定にする（黙って直さない）", () => {
    const wh = saved();
    expect(wh.request.input.endYear).toBe(2125);
    expect(endYearOff(wh)).toEqual({ end: 2125, std: 2097, ages: "ご本人129歳・配偶者128歳" });
    expect(endYearNotice(wh)).toBe("表の最後の年が2125年（ご本人129歳・配偶者128歳）です。既定（2097年）にしますか");
    let fixed: WorkingHousehold | null = null;
    const vnode = EndYearNote({ wh, onFix: (n) => (fixed = n) });
    const html = renderToString(vnode!);
    expect(html).toContain("表の最後の年が2125年（ご本人129歳・配偶者128歳）です");
    expect(html).toContain("既定（2097年）にする");
    expect(wh.request.input.endYear).toBe(2125);
    // 押す（ボタンの onClick）
    type Props = { children?: unknown; onClick?: () => void; "data-end-year-fix"?: boolean };
    const kids = (vnode!.props as Props).children as { props: Props }[];
    kids.find((c) => c?.props?.["data-end-year-fix"] === true)!.props.onClick!();
    expect(fixed!.request.input.endYear).toBe(2097);
    expect(EndYearNote({ wh: fixed!, onFix: () => undefined })).toBeNull();
  });

  it("85〜105歳の内なら出さない", () => {
    const wh = mutate(saved(), (_h, req) => void (req.input.endYear = 2100));
    expect(endYearOff(wh)).toBeNull();
    expect(EndYearNote({ wh, onFix: () => undefined })).toBeNull();
  });
});

describe("アプリの見本の世帯を開いたとき", () => {
  it("どの見本も、表の最後の年を標準にそろえる（元のモデル世帯は変えない）", () => {
    for (const d of DEMO_HOUSEHOLDS) {
      const raw = modelHousehold(d.id);
      const before = raw.input.endYear;
      const opened = sampleRequest(raw);
      expect(opened.input.endYear, d.id).toBe(standardEndYear(raw.input.household));
      expect(raw.input.endYear, d.id).toBe(before);
      const wh = fromRequest(opened);
      expect(fieldStatus(fieldOf(wh, "assumptions", "assume/endYear"), wh).status, d.id).toBe("estimated");
      expect(endYearNotice(wh), d.id).toBeNull();
    }
  });

  it("100年分の見本（本人30歳の夫婦と0歳の子）は 2125年（本人129歳）でなく 2097年（配偶者100歳）まで", () => {
    const raw = modelHousehold("lifetime100Plan");
    expect(raw.input.endYear).toBe(2125);
    const req = sampleRequest(raw);
    expect(req.input.endYear).toBe(2097);
    expect(displayYears(req).at(-1)).toBe(2097);
    const p = bsPlan({ key: "A", letter: "A", name: "プランA", title: "現状", base: true, req, table: preview(req).table });
    // 資産と負債のタブの年のつまみ: 今（2026年・本人30歳）から表の最後の年（2097年・本人101歳）まで
    expect(p.years[0]).toMatchObject({ year: 2026, age: 30 });
    expect(p.years.at(-1)).toMatchObject({ year: 2097, age: 101 });
    expect(p.years.at(-1)!.members).toBe("ご本人101歳・配偶者100歳");
    expect(p.years.some((y) => y.year > 2097)).toBe(false);
    const model = balanceTabModel({ plans: [p], selected: "A", base: "A", guide: DEFAULT_BS_GUIDE, pointDefaults: DEFAULT_BS_POINTS, columns: null, prevChoices: [], prev: { status: "idle", model: null }, provisional: false, who: "ご本人" });
    const html = renderToString(h(BalanceTab, { model, band: null, onPrev: () => undefined, onGuide: () => undefined, onColumns: () => undefined, onPointDefaults: () => undefined }));
    const i = html.indexOf("data-bs-range");
    const input = html.slice(html.lastIndexOf("<input", i), html.indexOf(">", i));
    expect(input).toContain(`max="${p.years.length - 1}"`);
    // 目盛りの右の端は表の最後の年の年齢（101歳）。129歳などは出ない
    const scale = html.slice(html.indexOf("yb-scale"), html.indexOf("</div>", html.indexOf("yb-scale")));
    expect(scale).toContain("101歳");
    expect(scale).not.toMatch(/1(0[2-9]|[1-2]\d)歳/);
  });
});
