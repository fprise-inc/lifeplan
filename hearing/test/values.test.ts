// セルの値の読み方（金額は円の整数・率は 10進の文字。0002）
import { describe, expect, it } from "vitest";
import { itemByKey } from "../src/definition.ts";
import { formatValue, parseValue, shiftDecimal, parseDecimal } from "../src/values.ts";
import { basic } from "./helpers.ts";

const def = basic();
const items = itemByKey(def);
const it_ = (k: string) => items.get(k) as NonNullable<ReturnType<typeof items.get>>;
const num = (text: string) => ({ kind: "number" as const, text });
const txt = (text: string) => ({ kind: "text" as const, text });

describe("値の読み方", () => {
  it("万円の金額を円の整数にする（小数・全角・桁区切り・単位つきも）", () => {
    const salary = it_("hs.income.salary");
    expect(parseValue(def, salary, num("620"))).toEqual({ ok: true, value: 6200000 });
    expect(parseValue(def, salary, num("621.3456"))).toEqual({ ok: true, value: 6213456 });
    expect(parseValue(def, salary, num("621.34559999999999"))).toEqual({ ok: true, value: 6213456 });
    expect(parseValue(def, salary, txt("６２０万円"))).toEqual({ ok: true, value: 6200000 });
    expect(parseValue(def, salary, txt("1,200"))).toEqual({ ok: true, value: 12000000 });
    expect(parseValue(def, salary, num("6.2E2"))).toEqual({ ok: true, value: 6200000 });
    expect(parseValue(def, salary, txt("たくさん")).ok).toBe(false);
    expect(parseValue(def, salary, num("-5")).ok).toBe(false);
  });

  it("円の金額", () => {
    const rent = it_("hs.housing.rent");
    expect(parseValue(def, rent, num("98000"))).toEqual({ ok: true, value: 98000 });
    expect(parseValue(def, rent, txt("98,000円"))).toEqual({ ok: true, value: 98000 });
    expect(parseValue(def, rent, txt("9.8万")).ok).toBe(false);
  });

  it("金利の % を率の 10進の文字にする（浮動小数点を通さない）", () => {
    const rate = it_("hs.loan.rate");
    expect(parseValue(def, rate, num("0.625"))).toEqual({ ok: true, value: "0.00625" });
    expect(parseValue(def, rate, txt("1.2%"))).toEqual({ ok: true, value: "0.012" });
    expect(parseValue(def, rate, num("3"))).toEqual({ ok: true, value: "0.03" });
    expect(formatValue(rate, "0.00625").raw).toEqual(num("0.625"));
    expect(shiftDecimal(parseDecimal("12.5") as NonNullable<ReturnType<typeof parseDecimal>>, 2)).toBe("0.125");
  });

  it("年月は年の選択肢（和暦つき）と月の選択肢から", () => {
    const b = it_("hs.family.adult.birthYearMonth");
    expect(parseValue(def, b, txt("1985年（昭和60年）"), txt("4月"))).toEqual({ ok: true, value: "1985-04" });
    expect(parseValue(def, b, num("1985"), num("12"))).toEqual({ ok: true, value: "1985-12" });
    expect(parseValue(def, b, txt("1985年（昭和60年）")).ok).toBe(false);
    expect(parseValue(def, b, txt("昭和60年"), txt("4月")).ok).toBe(false);
    expect(parseValue(def, b, num("31138"), num("4")).ok).toBe(false);
    expect(formatValue(b, "2019-05")).toEqual({ raw: txt("2019年（令和元年）"), raw2: txt("5月") });
    expect(formatValue(b, "1989-01").raw).toEqual(txt("1989年（平成元年）"));
  });

  it("選択肢は言葉でも value でも受け、ほかは読めない", () => {
    const t = it_("hs.work.type");
    expect(parseValue(def, t, txt("会社員（正社員）"))).toEqual({ ok: true, value: "regular" });
    expect(parseValue(def, t, txt("regular"))).toEqual({ ok: true, value: "regular" });
    expect(parseValue(def, t, txt("社長")).ok).toBe(false);
  });

  it("整数・範囲", () => {
    const age = it_("hs.work.retireAge");
    expect(parseValue(def, age, num("65"))).toEqual({ ok: true, value: 65 });
    expect(parseValue(def, age, txt("65歳"))).toEqual({ ok: true, value: 65 });
    expect(parseValue(def, age, num("65.5")).ok).toBe(false);
    expect(parseValue(def, age, num("150")).ok).toBe(false);
  });

  it("万円の書き出しは端数を小数で残す", () => {
    const salary = it_("hs.income.salary");
    expect(formatValue(salary, 6213456).raw).toEqual(num("621.3456"));
    expect(formatValue(salary, 6200000).raw).toEqual(num("620"));
    expect(formatValue(it_("hs.expense.savings"), -300000).raw).toEqual(num("-30"));
  });
});
