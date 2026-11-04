// 0117: 配布元の設定の [keys]（4種類の鍵）と [signing] の形の確かめと、CI のビルドの署名の段取り
// （秘密の値があれば署名し、無ければ署名せずに普通にビルドする）
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parse } from "smol-toml";
import { describe, expect, it } from "vitest";
import { REPO_DIR } from "../scripts/lib.ts";
import { keyProblems, signingPlan, signingProblems, type Signing } from "../scripts/signing.ts";

// 本物の道具（tauri signer generate）で作った使い捨ての鍵の公開鍵（crates/distribution のテストと同じもの。秘密鍵はどこにも置いていない）
const tauriPub = readFileSync(join(REPO_DIR, "crates", "distribution", "tests", "data", "tauri-throwaway.pub"), "utf8").trim();
const ed = (kid: string, fill: number) => `${kid}:${Buffer.alloc(32, fill).toString("base64url")}`;

const dist = parse(readFileSync(join(REPO_DIR, "config", "distribution.toml"), "utf8")) as unknown as { keys: Record<string, unknown>; dev_keys: Record<string, unknown>; signing: Signing };

const named: Signing = {
  mac_signing_identity: "Developer ID Application: Example Co. (ABCDE12345)",
  windows_method: "artifact-signing",
  windows_endpoint: "https://jpe.codesigning.azure.net",
  windows_account: "exampleaccount",
  windows_profile: "exampleprofile",
};
const allSecrets = {
  APPLE_CERTIFICATE: "x",
  APPLE_CERTIFICATE_PASSWORD: "x",
  APPLE_API_ISSUER: "x",
  APPLE_API_KEY: "x",
  APPLE_API_KEY_P8: "x",
  AZURE_CLIENT_ID: "x",
  AZURE_CLIENT_SECRET: "x",
  AZURE_TENANT_ID: "x",
  TAURI_SIGNING_PRIVATE_KEY: "x",
  TAURI_SIGNING_PRIVATE_KEY_PASSWORD: "",
};

describe("配布元の設定の [keys]（0017 の5・0117 の2）", () => {
  it("今の設定は形が正しい", () => {
    expect(keyProblems(dist.keys, dist.dev_keys)).toEqual([]);
    expect(signingProblems(dist.signing)).toEqual([]);
  });

  it("現用と次期の2本まで・書き方・役割をまたいだ同じ鍵を止める", () => {
    const ok = { app_update: [tauriPub], data: [ed("data-a", 1), ed("data-b", 2)], auto_delivery: [ed("auto-a", 3)], revocation: [ed("rev-a", 4)], feature_code: [ed("fc-a", 6)], feature_code_revocation: [ed("fr-a", 13)] };
    expect(keyProblems(ok)).toEqual([]);
    expect(keyProblems({ ...ok, data: [ed("data-a", 1), ed("data-b", 2), ed("data-c", 5)] }).join()).toContain("2 本まで");
    expect(keyProblems({ ...ok, app_update: ["data-a:xxx"] }).join()).toContain("tauri signer generate");
    expect(keyProblems({ ...ok, revocation: ["Rev:abc"] }).join()).toContain("鍵の名前:公開鍵");
    expect(keyProblems({ ...ok, auto_delivery: [ed("auto-a", 1)] }).join()).toContain("同じ公開鍵");
    expect(keyProblems({ ...ok, revocation: [ed("data-a", 9)] }).join()).toContain("重なっている");
    expect(keyProblems({ ...ok, feature_code: [ed("fc-a", 6), ed("fc-b", 7), ed("fc-c", 8)] }).join()).toContain("2 本まで");
    expect(keyProblems({ ...ok, feature_code: [ed("fc-a", 1)] }).join()).toContain("同じ公開鍵");
    // コードを止めるだけの鍵（0117 の追記 2026-11-04 の2）も同じ決まり。取り下げ用・コードの発行の鍵と同じ鍵は使えない
    expect(keyProblems({ ...ok, feature_code_revocation: [ed("fr-a", 13), ed("fr-b", 14), ed("fr-c", 15)] }).join()).toContain("2 本まで");
    expect(keyProblems({ ...ok, feature_code_revocation: [ed("fr-a", 4)] }).join()).toContain("同じ公開鍵");
    expect(keyProblems({ ...ok, feature_code_revocation: [ed("fr-a", 6)] }).join()).toContain("同じ公開鍵");
  });

  it("開発用の鍵（[dev_keys]）は dev- で始め、本番の鍵は dev- で始めない。本番と同じ鍵は使えない（0110 の追記 2026-11-04）", () => {
    const ok = { app_update: [], data: [], auto_delivery: [], revocation: [ed("rev-a", 4)], feature_code: [ed("fc-a", 6)], feature_code_revocation: [] };
    expect(keyProblems(ok, { feature_code: [ed("dev-1", 11)], revocation: [ed("dev-rv2", 12)], feature_code_revocation: [ed("dev-fr1", 16)] })).toEqual([]);
    expect(keyProblems(ok, { feature_code_revocation: [ed("fr-x", 16)] }).join()).toContain("dev- で始める");
    expect(keyProblems({ ...ok, feature_code: [ed("dev-1", 6)] }).join()).toContain("dev- で始めない");
    expect(keyProblems(ok, { feature_code: [ed("fc-x", 11)] }).join()).toContain("dev- で始める");
    expect(keyProblems(ok, { feature_code: [ed("dev-1", 6)] }).join()).toContain("同じ公開鍵");
    expect(keyProblems(ok, { app_update: [tauriPub] }).join()).toContain("app_update を書けない");
    expect(keyProblems(ok, { feature_codes: [] }).join()).toContain("知らない欄");
  });
});

describe("CI のビルドの署名の段取り（0117 の5）", () => {
  it("秘密の値が無ければ、どの OS も署名せずにビルドし、空の秘密の値は Tauri に渡さない", () => {
    const empty = { APPLE_CERTIFICATE: "", AZURE_CLIENT_ID: "", TAURI_SIGNING_PRIVATE_KEY: "" };
    const mac = signingPlan("macos", named, empty, "Financia");
    expect(mac.config.bundle).toEqual({ createUpdaterArtifacts: false, macOS: { signingIdentity: null } });
    expect(mac.unset).toEqual(expect.arrayContaining(["APPLE_CERTIFICATE", "TAURI_SIGNING_PRIVATE_KEY"]));
    const win = signingPlan("windows", named, empty, "Financia");
    expect(win.config.bundle).toEqual({ createUpdaterArtifacts: false });
    expect(win.needsArtifactSigningCli).toBe(false);
    expect(win.unset).toContain("AZURE_CLIENT_ID");
  });

  it("今の配布元の設定（名前が空）では、秘密の値があっても OS の署名はしない（更新のファイルの署名だけ）", () => {
    const mac = signingPlan("macos", dist.signing, allSecrets, "Financia");
    expect(mac.config.bundle).toEqual({ createUpdaterArtifacts: true, macOS: { signingIdentity: null } });
    const win = signingPlan("windows", dist.signing, allSecrets, "Financia");
    expect(win.config.bundle).toEqual({ createUpdaterArtifacts: true });
  });

  it("名前と秘密の値がそろえば、Mac は署名と公証、Windows は Azure Artifact Signing で署名する", () => {
    const mac = signingPlan("macos", named, allSecrets, "Financia");
    expect(mac.config.bundle).toEqual({ createUpdaterArtifacts: true, macOS: { signingIdentity: named.mac_signing_identity, hardenedRuntime: true } });
    expect(mac.writeApiKeyFile).toBe(true);
    expect(mac.unset).toContain("AZURE_CLIENT_ID");
    const win = signingPlan("windows", named, allSecrets, "Financia");
    expect(win.config.bundle.windows).toEqual({ signCommand: "artifact-signing-cli -e https://jpe.codesigning.azure.net -a exampleaccount -c exampleprofile -d Financia %1" });
    expect(win.needsArtifactSigningCli).toBe(true);
    expect(win.unset).toContain("APPLE_CERTIFICATE");
    // 証明書はあるが公証の鍵が無い: 署名だけして公証しない
    const noNotary = signingPlan("macos", named, { ...allSecrets, APPLE_API_KEY_P8: "" }, "Financia");
    expect(noNotary.writeApiKeyFile).toBe(false);
    expect(noNotary.unset).toContain("APPLE_API_KEY_P8");
    // 段取りの説明に秘密の値は入らない
    expect(JSON.stringify([mac, win])).not.toContain('"x"');
  });

  it("[signing] の形の誤りを止める", () => {
    expect(signingProblems(undefined).join()).toContain("[signing]");
    expect(signingProblems({ ...named, windows_method: "ev-token" }).join()).toContain("windows_method");
    expect(signingProblems({ ...named, mac_signing_identity: "Example" }).join()).toContain("Developer ID Application");
    expect(signingProblems({ ...named, windows_endpoint: "https://example.com" }).join()).toContain("codesigning.azure.net");
  });
});
