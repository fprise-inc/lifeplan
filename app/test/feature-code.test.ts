// 機能を有効にするコード（0110）: コードの入っていない FP には区画を出さない・入れた後の区画の名前と期限・期限が近い知らせ・
// 期限切れ（区画は出さず、データは消さない旨）・開発用のサーバーの代わりの確かめ（本体と同じ形。鍵はテストの中だけで作る）
import { describe, expect, it } from "vitest";
import { generateKeyPairSync, sign } from "node:crypto";
import { h } from "preact";
import { renderToString } from "preact-render-to-string";
import { OfficeSettingsPanel } from "../src/workspace/office/OfficeSettingsPanel.tsx";
import { DEFAULT_OFFICE_SETTINGS } from "../src/workspace/office/settings.ts";
import { candidateChange, checkText, codeFor, combinedHiddenText, enabledLine, expiredFor, expiredText, featureErrorText, featureOn, NO_FEATURES, renewText, type FeatureCandidateView, type FeatureCodeView, type FeatureStatus } from "../src/workspace/office/featureCodes.ts";
import { balanceTabModel } from "../src/workspace/balanceTab.ts";
import { addCode, applyFetch, featureStatus, publicKeys, reference, revokedIds, todayJst } from "../scripts/devFeatureCode.ts";

const code = (over: Partial<FeatureCodeView> = {}): FeatureCodeView => ({ ref: "r1", id: "0001", name: "見本 花子", features: ["combinedBs"], issued: "2026-11-01", expires: "2027-05-31", state: "active", daysLeft: 211, ...over });
const st = (codes: FeatureCodeView[], more: Partial<FeatureStatus> = {}): FeatureStatus => ({ today: "2026-11-01", active: codes.some((c) => c.state === "active" || c.state === "expiring") ? ["combinedBs"] : [], codes, invalid: [], ...more });
const panel = (features: FeatureStatus, combinedBs = true) =>
  renderToString(h(OfficeSettingsPanel, { value: { ...DEFAULT_OFFICE_SETTINGS, features: { combinedBs } }, onSave: async () => undefined, shared: false, onClose: () => undefined, features, onAddCode: async () => features, onRemoveCode: async () => features, onCheckCodes: async () => features, onDecideCandidate: async () => features }));

describe("区画の出し方", () => {
  it("コードを入れていないと、法人経営者向けの区画を出さない（印が付いたままの古い設定でも）。いちばん下に小さな入れ口だけ", () => {
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

describe("期限なしのコードと、提供元が止めたコード（0110 の追記）", () => {
  it("期限なしのコードは「期限なし」と出し、更新の知らせを出さない", () => {
    const c = code({ expires: null, daysLeft: null });
    expect(enabledLine(c)).toBe("見本 花子さん向けに有効（期限なし）");
    expect(renewText(c)).toBeNull();
    // 期限なしがいちばん遅い
    expect(codeFor(st([code({ ref: "r2" }), c]), "combinedBs")?.ref).toBe("r1");
    expect(panel(st([c]))).toContain("期限なし");
  });

  it("止めたコードは区画を出さず、データは消さない旨と、止めるのをやめれば自動で戻ることを知らせる", () => {
    const c = code({ state: "revoked", expires: null, daysLeft: null });
    const s = st([c]);
    expect(featureOn(s, "combinedBs")).toBe(false);
    expect(expiredFor(s, "combinedBs")).toEqual(c);
    expect(expiredText(c)).toContain("提供元が止めました");
    expect(expiredText(c)).toContain("消していません");
    expect(expiredText(c)).toContain("自動で戻ります");
    expect(combinedHiddenText(c)).toContain("提供元が止めた");
    const html = panel(s);
    expect(html).not.toContain("data-office-features");
    expect(html).toContain("data-feature-revoked");
    // 止めた・切れたの両方があれば、止めた方を知らせる
    expect(expiredFor(st([code({ ref: "r2", state: "expired", daysLeft: -3 }), c]), "combinedBs")?.state).toBe("revoked");
  });

  it("止めた一覧の確かめの様子（コードを入れている FP にだけ出す）", () => {
    expect(checkText(undefined)).toBeNull();
    expect(checkText({ checkedAt: null, okAt: null, result: null, serial: null, listed: 0 })).toContain("まだ確かめていません");
    expect(checkText({ checkedAt: "2026-11-01T03:00:00Z", okAt: "2026-11-01T03:00:00Z", result: "ok", serial: 2, listed: 1 })).toBe("提供元が止めたコードの一覧は 2026-11-01 に確かめました。");
    // 日本の日付で出す（UTC の 15時は翌日）
    expect(checkText({ checkedAt: "2026-11-01T15:00:00Z", okAt: "2026-11-01T15:00:00Z", result: "ok", serial: 2, listed: 1 })).toContain("2026-11-02");
    const off = checkText({ checkedAt: "2026-11-03T00:00:00Z", okAt: "2026-10-30T00:00:00Z", result: "offline", serial: 2, listed: 1 }) ?? "";
    expect(off).toContain("つながりませんでした");
    expect(off).toContain("2026-10-30 に取れた一覧");
    expect(off).toContain("今の状態のまま");
    expect(checkText({ checkedAt: "2026-11-03T00:00:00Z", okAt: null, result: "offline", serial: null, listed: 0 })).toContain("どのコードも止めていません");
    expect(checkText({ checkedAt: "2026-11-03T00:00:00Z", okAt: null, result: "rejected", serial: null, listed: 0 })).toContain("署名ではなかった");
    const check = { checkedAt: "2026-11-01T03:00:00Z", okAt: "2026-11-01T03:00:00Z", result: "ok" as const, serial: 2, listed: 1 };
    expect(panel(st([code()], { check }))).toContain("data-feature-check-now");
    // コードを入れていなければ出さない
    expect(panel({ ...NO_FEATURES, check })).not.toContain("data-feature-check");
    expect(featureErrorText("E_FEATURE_CODE_REVOKED")).toContain("提供元が止めて");
  });

  it("AIからのコードの候補: 入れる前と後を並べ、押すまで入らない", () => {
    const cand: FeatureCandidateView = { id: "c1", receivedAt: "2026-11-01T03:00:00Z", connector: "test-ai 1", ok: true, error: null, name: "見本 花子", features: ["combinedBs"], expires: null, before: [], after: ["combinedBs"], replaces: 0 };
    expect(candidateChange(cand)).toEqual([{ feature: "合算BS（経営者個人と会社のバランスシート）", before: false, after: true }]);
    const html = panel({ ...NO_FEATURES, candidates: [cand] });
    expect(html).toContain("data-feature-candidate=\"c1\"");
    expect(html).toContain("このコードを入れる");
    expect(html).toContain("捨てる");
    expect(html).toContain("使えない");
    expect(html).toContain("見本 花子さん向け・期限なし");
    expect(html).toContain("確かめられない参考の情報");
    // まだ入っていないので、区画は出さない
    expect(html).not.toContain("data-office-features");
    // 入れられない候補は「入れる」を出さず、理由と「捨てる」だけ
    const bad = panel({ ...NO_FEATURES, candidates: [{ ...cand, ok: false, error: "E_FEATURE_CODE_SIGNATURE", name: null, after: [] }] });
    expect(bad).toContain("data-feature-candidate-error");
    expect(bad).not.toContain("data-feature-candidate-accept");
    expect(bad).toContain("data-feature-candidate-reject");
  });
});

describe("開発用のサーバーの代わりの止めた一覧（本体と同じ形）", () => {
  const ck = generateKeyPairSync("ed25519");
  const rk = generateKeyPairSync("ed25519");
  const rawOf = (k: typeof ck) => (k.publicKey.export({ format: "der", type: "spki" }) as Buffer).subarray(12).toString("base64url");
  const keys = publicKeys([`test-1:${rawOf(ck)}`]);
  const rkeys = publicKeys([`rv-1:${rawOf(rk)}`]);
  const issue = (claims: Record<string, unknown>) => {
    const payload = Buffer.from(JSON.stringify({ v: 2, kid: "test-1", id: "0001", name: "見本 花子", features: ["combinedBs"], issued: "2026-11-01", ...claims }), "utf8");
    const sig = sign(null, Buffer.concat([Buffer.from("lifeplan-feature-code/1\0", "utf8"), payload]), ck.privateKey);
    return `LPFC1-${payload.toString("base64url")}.${sig.toString("base64url")}`;
  };
  const list = (serial: number, revoked: string[], key = rk.privateKey, kid = "rv-1") => {
    const payload = JSON.stringify({ v: 1, serial, issued: "2026-11-01", revoked });
    const sig = sign(null, Buffer.concat([Buffer.from("lifeplan-feature-code-revocations/1\0", "utf8"), Buffer.from(payload, "utf8")]), key);
    return JSON.stringify({ format: "lifeplan-feature-code-revocations", kid, payload, sig: sig.toString("base64url") });
  };

  it("期限なしのコードは切れない。版 1 で期限の無いものは形が違う", () => {
    const c = issue({});
    const r = addCode([], c, keys, "2026-11-01");
    expect(r.ok).toBe(true);
    expect(featureStatus([c], keys, "2999-12-31").active).toEqual(["combinedBs"]);
    expect(featureStatus([c], keys, "2999-12-31").codes[0]?.expires).toBeNull();
    expect(addCode([], issue({ v: 1 }), keys, "2026-11-01")).toEqual({ ok: false, error: "E_FEATURE_CODE_FORMAT" });
  });

  it("一覧に載ると止まり、外れると戻る。つながらない・署名が合わない・古い一覧は無視する", () => {
    const c = issue({});
    let saved: string | null = null;
    // 一度も取れていない: 止めない
    expect(featureStatus([c], keys, "2026-11-01", revokedIds(saved, rkeys)).active).toEqual(["combinedBs"]);
    let r = applyFetch(saved, list(1, ["0001"]), rkeys);
    expect(r.result).toBe("ok");
    saved = r.saved;
    const stopped = featureStatus([c], keys, "2026-11-01", revokedIds(saved, rkeys));
    expect(stopped.active).toEqual([]);
    expect(stopped.codes[0]?.state).toBe("revoked");
    expect(addCode([], c, keys, "2026-11-01", revokedIds(saved, rkeys))).toEqual({ ok: false, error: "E_FEATURE_CODE_REVOKED" });
    // つながらない・偽の一覧・古い一覧: 止まったまま
    for (const f of [null, list(2, [], ck.privateKey), "<html>", list(0, [])]) {
      r = applyFetch(saved, f, rkeys);
      expect(r.saved).toBe(saved);
      expect(r.result).toBe(f === null ? "offline" : "rejected");
    }
    // 外した一覧: 戻る
    r = applyFetch(saved, list(2, []), rkeys);
    expect(r.result).toBe("ok");
    expect(featureStatus([c], keys, "2026-11-01", revokedIds(r.saved, rkeys)).active).toEqual(["combinedBs"]);
  });
});
