// 機能を有効にするコード（0110）: コードの入っていない FP には区画を出さない・入れた後の区画の名前と期限・期限が近い知らせ・
// 期限切れ（区画は出さず、データは消さない旨）・開発用のサーバーの代わりの確かめ（本体と同じ形。鍵はテストの中だけで作る）
import { describe, expect, it } from "vitest";
import { generateKeyPairSync, sign } from "node:crypto";
import { h } from "preact";
import { renderToString } from "preact-render-to-string";
import { OfficeSettingsPanel } from "../src/workspace/office/OfficeSettingsPanel.tsx";
import { DEFAULT_OFFICE_SETTINGS } from "../src/workspace/office/settings.ts";
import { codeFor, combinedHiddenText, enabledLine, expiredFor, featureErrorText, featureOn, NO_FEATURES, renewText, type FeatureCodeView, type FeatureStatus } from "../src/workspace/office/featureCodes.ts";
import { balanceTabModel } from "../src/workspace/balanceTab.ts";
import { addCode, featureStatus, publicKeys, reference, todayJst } from "../scripts/devFeatureCode.ts";

const code = (over: Partial<FeatureCodeView> = {}): FeatureCodeView => ({ ref: "r1", id: "0001", name: "見本 花子", features: ["combinedBs"], issued: "2026-11-01", expires: "2027-05-31", state: "active", daysLeft: 211, ...over });
const st = (codes: FeatureCodeView[]): FeatureStatus => ({ today: "2026-11-01", active: codes.some((c) => c.state !== "expired") ? ["combinedBs"] : [], codes, invalid: [] });
const panel = (features: FeatureStatus, combinedBs = true) =>
  renderToString(h(OfficeSettingsPanel, { value: { ...DEFAULT_OFFICE_SETTINGS, features: { combinedBs } }, onSave: async () => undefined, shared: false, onClose: () => undefined, features, onAddCode: async () => features, onRemoveCode: async () => features }));

describe("区画の出し方", () => {
  it("コードを入れていないと、法人の顧問向けの区画を出さない（印が付いたままの古い設定でも）。いちばん下に小さな入れ口だけ", () => {
    for (const html of [panel(NO_FEATURES, false), panel(NO_FEATURES, true)]) {
      expect(html).not.toContain("data-office-features");
      expect(html).not.toContain("合算BS（経営者個人と会社のバランスシート）を使う");
      expect(html).toContain("data-feature-code-open");
      expect(html).toContain("機能を有効にするコードを入れる");
      // 入れ口は保存のボタンより後ろ（いちばん下）
      expect(html.indexOf("data-feature-code-open")).toBeGreaterThan(html.indexOf("data-office-settings-save"));
    }
  });

  it("コードがあれば、区画に名前と期限を出す", () => {
    const html = panel(st([code()]));
    expect(html).toContain("data-office-features");
    expect(html).toContain("見本 花子さん向けに有効（期限 2027-05-31）");
    expect(html).not.toContain("data-feature-renew");
  });

  it("期限の30日前から更新の知らせ", () => {
    const c = code({ state: "expiring", daysLeft: 12 });
    expect(renewText(c)).toContain("あと12日");
    expect(renewText(code({ state: "expiring", daysLeft: 0 }))).toContain("今日（2027-05-31）まで");
    expect(renewText(code())).toBeNull();
    const html = panel(st([c]));
    expect(html).toContain("data-feature-renew");
    expect(html).toContain("新しいコードを受け取り");
  });

  it("期限が切れたら区画を出さない。データは消さない旨と、入れ直せば戻ることを知らせる", () => {
    const c = code({ state: "expired", daysLeft: -3 });
    const s = st([c]);
    expect(featureOn(s, "combinedBs")).toBe(false);
    expect(expiredFor(s, "combinedBs")).toEqual(c);
    const html = panel(s);
    expect(html).not.toContain("data-office-features");
    expect(html).toContain("data-feature-expired");
    expect(html).toContain("期限が切れました");
    expect(html).toContain("消していません");
    expect(html).toContain("新しいコードを入れると、また見られます");
    // 資産と負債のタブの知らせ
    expect(combinedHiddenText(c)).toContain("データは消していません");
    // 同じ機能の期限内のコードがあれば、切れた方の知らせは出さない
    const both = st([code({ ref: "r2", expires: "2027-11-30" }), c]);
    expect(expiredFor(both, "combinedBs")).toBeNull();
    expect(codeFor(both, "combinedBs")?.ref).toBe("r2");
    expect(panel(both)).not.toContain("data-feature-expired");
  });

  it("資産と負債のタブの知らせは、渡したときだけ", () => {
    const base = { plans: [], selected: "A", base: "A", guide: { months: 6 }, pointDefaults: [], columns: null, prevChoices: [], prev: { status: "idle" as const, model: null }, provisional: false, who: "ご本人" } as unknown as Parameters<typeof balanceTabModel>[0];
    expect(balanceTabModel(base).hiddenNote).toBeUndefined();
    expect(balanceTabModel({ ...base, hiddenNote: "x" }).hiddenNote).toBe("x");
  });

  it("入れられなかったときの文", () => {
    expect(featureErrorText("E_FEATURE_CODE_SIGNATURE")).toContain("正しくありません");
    expect(featureErrorText("E_FEATURE_CODE_EXPIRED")).toContain("期限が切れています");
    expect(featureErrorText("E_X")).toContain("E_X");
    expect(enabledLine(code())).toBe("見本 花子さん向けに有効（期限 2027-05-31）");
  });
});

describe("開発用のサーバーの代わりの確かめ（本体と同じ形）", () => {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const raw = (publicKey.export({ format: "der", type: "spki" }) as Buffer).subarray(12);
  const keys = publicKeys([`test-1:${raw.toString("base64url")}`]);
  const issue = (claims: Record<string, unknown>) => {
    const payload = Buffer.from(JSON.stringify({ v: 1, kid: "test-1", id: "0001", name: "見本 花子", features: ["combinedBs"], issued: "2026-11-01", expires: "2027-05-31", ...claims }), "utf8");
    const sig = sign(null, Buffer.concat([Buffer.from("lifeplan-feature-code/1\0", "utf8"), payload]), privateKey);
    return `LPFC1-${payload.toString("base64url")}.${sig.toString("base64url")}`;
  };

  it("本物で期限内のコードだけ入る。期限が近い・切れたを日本の日付で", () => {
    const c = issue({});
    const r = addCode([], `  ${c.slice(0, 30)}\n${c.slice(30)}`, keys, "2026-11-01");
    expect(r.ok).toBe(true);
    const codes = r.ok ? r.codes : [];
    expect(featureStatus(codes, keys, "2026-11-01").active).toEqual(["combinedBs"]);
    expect(featureStatus(codes, keys, "2027-05-01").codes[0]?.state).toBe("expiring");
    expect(featureStatus(codes, keys, "2027-05-31").active).toEqual(["combinedBs"]);
    const after = featureStatus(codes, keys, "2027-06-01");
    expect(after.active).toEqual([]);
    expect(after.codes[0]?.state).toBe("expired");
    expect(after.codes[0]?.ref).toBe(reference(c));
    expect(addCode([], c, keys, "2027-06-01")).toEqual({ ok: false, error: "E_FEATURE_CODE_EXPIRED" });
    // 書き換え・知らない鍵・知らない機能
    const [body, sig] = c.slice(6).split(".") as [string, string];
    const forged = Buffer.from(body, "base64url").toString("utf8").replace("2027-05-31", "2099-12-31");
    expect(addCode([], `LPFC1-${Buffer.from(forged).toString("base64url")}.${sig}`, keys, "2026-11-01")).toEqual({ ok: false, error: "E_FEATURE_CODE_SIGNATURE" });
    expect(addCode([], issue({ kid: "other" }), keys, "2026-11-01")).toEqual({ ok: false, error: "E_FEATURE_CODE_KEY" });
    expect(addCode([], issue({ features: ["unknownThing"] }), keys, "2026-11-01")).toEqual({ ok: false, error: "E_FEATURE_CODE_NO_FEATURE" });
    expect(addCode([], "LPFC1-xx", keys, "2026-11-01")).toEqual({ ok: false, error: "E_FEATURE_CODE_FORMAT" });
    // 更新のコードは古いコードを外す
    const renewed = issue({ id: "0002", expires: "2027-11-30" });
    const r2 = addCode(codes, renewed, keys, "2027-05-20");
    expect(r2.ok && r2.codes).toEqual([renewed]);
  });

  it("日本の今日（UTC+9）", () => {
    expect(todayJst(Date.parse("2026-11-01T14:59:59Z"))).toBe("2026-11-01");
    expect(todayJst(Date.parse("2026-11-01T15:00:00Z"))).toBe("2026-11-02");
  });
});
