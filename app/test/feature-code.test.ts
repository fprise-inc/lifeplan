// 機能を有効にするコード（0110）: コードの入っていない FP には区画を出さない・入れた後の区画の名前と期限・期限が近い知らせ・
// 期限切れ（区画は出さず、データは消さない旨）・開発用のサーバーの代わりの確かめ（本体と同じ形。鍵はテストの中だけで作る）
import { describe, expect, it } from "vitest";
import { generateKeyPairSync, sign } from "node:crypto";
import { h } from "preact";
import { renderToString } from "preact-render-to-string";
import { OfficeSettingsPanel } from "../src/workspace/office/OfficeSettingsPanel.tsx";
import { DEFAULT_OFFICE_SETTINGS, loadOfficeStart } from "../src/workspace/office/settings.ts";
import { candidateChange, checkText, codeFor, combinedHiddenText, enabledLine, expiredFor, expiredText, featureErrorText, featureOn, NO_FEATURES, noticeCodes, renewText, type FeatureCandidateView, type FeatureCodeView, type FeatureStatus } from "../src/workspace/office/featureCodes.ts";
import { balanceTabModel } from "../src/workspace/balanceTab.ts";
import { addCode, applyFetch, applyNotices, dismissNotice, featureStatus, publicKeys, reference, revokedIds, todayJst, withoutRevokedKeys, type NoticeRecord } from "../scripts/devFeatureCode.ts";

// 切れた・止めたコードは、本体が記録を当てる前と同じく知らせを出す（notice）。消えたときは notice: false を渡す
const code = (over: Partial<FeatureCodeView> = {}): FeatureCodeView => ({ ref: "r1", id: "0001", name: "見本 花子", features: ["combinedBs"], issued: "2026-11-01", expires: "2027-05-31", state: "active", daysLeft: 211, notice: over.state === "expired" || over.state === "revoked", noticeSince: null, ...over });
const st = (codes: FeatureCodeView[], more: Partial<FeatureStatus> = {}): FeatureStatus => ({ today: "2026-11-01", active: codes.some((c) => c.state === "active" || c.state === "expiring") ? ["combinedBs"] : [], codes, invalid: [], ...more });
const panel = (features: FeatureStatus, combinedBs = true) =>
  renderToString(h(OfficeSettingsPanel, { value: { ...DEFAULT_OFFICE_SETTINGS, features: { combinedBs } }, onSave: async () => undefined, shared: false, onClose: () => undefined, features, onAddCode: async () => features, onRemoveCode: async () => features, onDismissNotice: async () => features, onCheckCodes: async () => features, onDecideCandidate: async () => features }));

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

describe("開発用のサーバーの代わりの取り下げの一覧（本体の crates/distribution と同じ形）", () => {
  const ck = generateKeyPairSync("ed25519");
  const rk = generateKeyPairSync("ed25519");
  const rawOf = (k: typeof ck) => (k.publicKey.export({ format: "der", type: "spki" }) as Buffer).subarray(12).toString("base64url");
  const keys = publicKeys([`test-1:${rawOf(ck)}`]);
  const rkeys = publicKeys([`rv-2026a:${rawOf(rk)}`]);
  const issue = (claims: Record<string, unknown>) => {
    const payload = Buffer.from(JSON.stringify({ v: 2, kid: "test-1", id: "0001", name: "見本 花子", features: ["combinedBs"], issued: "2026-11-01", ...claims }), "utf8");
    const sig = sign(null, Buffer.concat([Buffer.from("lifeplan-feature-code/1\0", "utf8"), payload]), ck.privateKey);
    return `LPFC1-${payload.toString("base64url")}.${sig.toString("base64url")}`;
  };
  // 配布の取り下げの一覧（封筒に取り下げ用の鍵で署名。中身は revoked.featureCodes と revoked.keys）
  const list = (serial: number, featureCodes: string[], key = rk.privateKey, kid = "rv-2026a", keys: string[] = []) => {
    const payload = JSON.stringify({ format: "fprise-lifeplan-revocations", formatVersion: "1.0", serial, issuedAt: "2026-11-01T00:00:00Z", expiresAt: "2027-01-30T00:00:00Z", revoked: { keys, featureCodes } });
    const sig = sign(null, Buffer.from(payload, "utf8"), key);
    return JSON.stringify({ format: "fprise-lifeplan-revocations-envelope", formatVersion: "1.0", payload, signatures: [{ keyId: kid, alg: "ed25519", sig: sig.toString("base64") }] });
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
    // 形の違う番号の一覧は受け付けない
    expect(applyFetch(r.saved, list(3, ["番号"]), rkeys).result).toBe("rejected");
  });

  it("コードの鍵を取り下げると、その鍵のコードは確かめられなくなる", () => {
    const c = issue({});
    const saved = list(1, [], rk.privateKey, "rv-2026a", ["test-1"]);
    const k2 = withoutRevokedKeys(keys, saved, rkeys);
    expect(featureStatus([c], k2, "2026-11-01").invalid[0]?.error).toBe("E_FEATURE_CODE_KEY");
    // 確かめられない一覧では外さない
    expect(withoutRevokedKeys(keys, list(1, [], ck.privateKey, "rv-2026a", ["test-1"]), rkeys).size).toBe(1);
  });
});

describe("起動直後に事務所の既定値のパネルを開いたとき（#officedefaults）", () => {
  // 合算BS の「使う」の印の入力（renderToString の出力から。checked が付いているか）
  const mark = (html: string): string => /<input[^>]*data-office-feature="combinedBs"[^>]*>/.exec(html)?.[0] ?? "";
  const deferred = <T,>() => {
    let resolve!: (v: T) => void;
    let reject!: (e: unknown) => void;
    const promise = new Promise<T>((res, rej) => ((resolve = res), (reject = rej)));
    return { promise, resolve, reject };
  };
  const render = (value: typeof DEFAULT_OFFICE_SETTINGS, features: FeatureStatus) =>
    renderToString(h(OfficeSettingsPanel, { value, onSave: async () => undefined, shared: false, onClose: () => undefined, features }));

  it("事務所の既定値とコードの状態の両方を読み終わってから返す。読み終わった値で出すと、保存してある印が付いて出る", async () => {
    const d = deferred<unknown>();
    const f = deferred<FeatureStatus>();
    let done = false;
    const p = loadOfficeStart({ defaults: () => d.promise, featureStatus: () => f.promise }).then((r) => ((done = true), r));
    f.resolve(st([code()]));
    await new Promise((r) => setTimeout(r, 0));
    // コードの状態だけ先に届いても、まだ返さない（ここでパネルを出すと、既定の値で印が外れて見える）
    expect(done).toBe(false);
    expect(mark(render(DEFAULT_OFFICE_SETTINGS, st([code()])))).not.toContain("checked");
    d.resolve({ features: { combinedBs: true } });
    const r = await p;
    expect(r.settings?.features.combinedBs).toBe(true);
    expect(r.features?.active).toEqual(["combinedBs"]);
    expect(mark(render(r.settings!, r.features!))).toContain("checked");
  });

  it("読めなかったものは null（片方が読めなくても、もう片方を待って返す）", async () => {
    const r = await loadOfficeStart({ defaults: () => Promise.reject(new Error("E_STORE")), featureStatus: async () => st([code()]) });
    expect(r).toEqual({ settings: null, features: st([code()]) });
    const r2 = await loadOfficeStart({ defaults: async () => ({ features: { combinedBs: true } }), featureStatus: () => Promise.reject(new Error("E")) });
    expect(r2.settings?.features.combinedBs).toBe(true);
    expect(r2.features).toBeNull();
  });
});

describe("切れた・止めたの知らせは7日で消える（0110 の追記 2026-11-02）", () => {
  const ck = generateKeyPairSync("ed25519");
  const raw = (ck.publicKey.export({ format: "der", type: "spki" }) as Buffer).subarray(12).toString("base64url");
  const keys = publicKeys([`test-1:${raw}`]);
  const issue = (claims: Record<string, unknown>) => {
    const payload = Buffer.from(JSON.stringify({ v: 2, kid: "test-1", id: "0001", name: "見本 花子", features: ["combinedBs"], issued: "2026-11-01", ...claims }), "utf8");
    const sig = sign(null, Buffer.concat([Buffer.from("lifeplan-feature-code/1\0", "utf8"), payload]), ck.privateKey);
    return `LPFC1-${payload.toString("base64url")}.${sig.toString("base64url")}`;
  };
  const plus = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
  /** 開発用のサーバーの代わりで、その日の状態を読む（本体と同じく、読むたびに記録を当てる） */
  const reader = (codes: string[]) => {
    let records: NoticeRecord[] = [];
    return {
      read: (today: string, revoked: string[] = []): FeatureStatus => {
        const s = featureStatus(codes, keys, today, revoked);
        records = applyNotices(s, records);
        return s;
      },
      dismiss: (ref: string) => {
        const next = dismissNotice(records, ref);
        if (next === null) throw new Error("E_FEATURE_CODE_NOT_FOUND");
        records = next;
      },
      records: () => records,
    };
  };
  /** 事務所の既定値の知らせと、資産と負債のタブの一文が出ているか */
  const shown = (s: FeatureStatus) => {
    const html = panel(s);
    const tab = expiredFor(s, "combinedBs");
    expect(html.includes("data-feature-expired")).toBe(tab !== null);
    return tab !== null;
  };

  it("止めたと分かった日から7日の内は出る。8日目は出さない。コードは残り、止めたまま", () => {
    const c = issue({});
    const r = reader([c]);
    expect(shown(r.read("2026-11-01"))).toBe(false);
    const day1 = "2026-11-02";
    for (let n = 0; n < 7; n++) {
      const s = r.read(plus(day1, n), ["0001"]);
      expect(shown(s)).toBe(true);
      expect(combinedHiddenText(expiredFor(s, "combinedBs") as FeatureCodeView)).toContain("提供元が止めた");
    }
    expect(r.records()).toEqual([{ ref: reference(c), state: "revoked", since: day1, dismissed: false }]);
    const day8 = r.read(plus(day1, 7), ["0001"]);
    expect(shown(day8)).toBe(false);
    expect(day8.codes[0]?.state).toBe("revoked");
    expect(day8.codes[0]?.noticeSince).toBe(day1);
    expect(day8.active).toEqual([]);
    expect(panel(day8)).not.toContain("data-office-features");
  });

  it("閉じたら7日の内でも出さない。戻って再び止められたら、閉じた印も消えて再び出る", () => {
    const c = issue({});
    const r = reader([c]);
    const s1 = r.read("2026-11-02", ["0001"]);
    const html = panel(s1);
    expect(html).toContain(`data-feature-notice-dismiss="${reference(c)}"`);
    expect(html).toContain("閉じる");
    expect(html).toContain("このコードを外す");
    expect(html).toContain("この知らせは7日たつと消えます。");
    expect(html).toContain("次に確かめたときに自動で戻ります");
    r.dismiss(reference(c));
    expect(shown(r.read("2026-11-03", ["0001"]))).toBe(false);
    // 戻る（止めるのをやめた）: 使えて、記録は消える
    const back = r.read("2026-11-04");
    expect(back.active).toEqual(["combinedBs"]);
    expect(shown(back)).toBe(false);
    expect(r.records()).toEqual([]);
    // 再び止められた: 新しい日付で再び出る
    const again = r.read("2026-11-20", ["0001"]);
    expect(shown(again)).toBe(true);
    expect(again.codes[0]?.noticeSince).toBe("2026-11-20");
    expect(() => r.dismiss("0000000000000000")).toThrow("E_FEATURE_CODE_NOT_FOUND");
  });

  it("期限切れも同じ（分かった日から7日・閉じたら消える）", () => {
    const c = issue({ v: 1, expires: "2027-05-31" });
    const r = reader([c]);
    expect(shown(r.read("2027-06-01"))).toBe(true);
    expect(shown(r.read("2027-06-07"))).toBe(true);
    expect(shown(r.read("2027-06-08"))).toBe(false);
    const r2 = reader([c]);
    expect(shown(r2.read("2027-06-10"))).toBe(true);
    r2.dismiss(reference(c));
    expect(shown(r2.read("2027-06-10"))).toBe(false);
  });

  it("画面は本体の notice に従う（消えたコードの知らせ・タブの一文は出さない）", () => {
    const gone = code({ state: "revoked", expires: null, daysLeft: null, notice: false, noticeSince: "2026-11-02" });
    const s = st([gone]);
    expect(noticeCodes(s)).toEqual([]);
    expect(expiredFor(s, "combinedBs")).toBeNull();
    expect(panel(s)).not.toContain("data-feature-expired");
    // 消えた方と出す方があれば、出す方を知らせる
    const live = code({ ref: "r2", state: "expired", daysLeft: -2, notice: true });
    expect(expiredFor(st([gone, live]), "combinedBs")?.ref).toBe("r2");
  });
});
