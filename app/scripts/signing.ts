// 0117: 配布元の設定（config/distribution.toml）の [keys]（4種類の鍵の公開鍵）と [signing]（OS のコード署名の名前）の形の確かめと、
// CI のビルドで「秘密の値があれば署名する・無ければ署名せずにビルドする」ための Tauri の設定の上書きを作る部品。
// 秘密の値そのものは、ログにも上書きの設定にも書かない（環境変数の名前だけを扱う）。

/** 鍵の役割（0017 の5 の4種類と、機能を有効にするコードの発行の鍵〔0110 の追記 2026-11-04〕・コードを止めるだけの鍵〔0117 の追記 2026-11-04 の2〕）。
 * app_update は Tauri の公開鍵の文字列、ほかは「鍵の名前:公開鍵（base64url の43文字）」 */
export const KEY_ROLES = ["app_update", "data", "auto_delivery", "revocation", "feature_code", "feature_code_revocation"] as const;
export const MAX_KEYS_PER_ROLE = 2;
/** 開発用の鍵（[dev_keys]）の名前の前置き。[keys]（本番の鍵）の名前はこれで始めない（crates/distribution の DEV_KID_PREFIX と同じ） */
export const DEV_KID_PREFIX = "dev-";

export interface Signing {
  mac_signing_identity: string;
  windows_method: string;
  windows_endpoint: string;
  windows_account: string;
  windows_profile: string;
}

/** CI の秘密の値の名前（.github/workflows/app-bundle.yml と同じ） */
export const SECRET_NAMES = {
  mac: ["APPLE_CERTIFICATE", "APPLE_CERTIFICATE_PASSWORD"],
  notarize: ["APPLE_API_ISSUER", "APPLE_API_KEY", "APPLE_API_KEY_P8"],
  windows: ["AZURE_CLIENT_ID", "AZURE_CLIENT_SECRET", "AZURE_TENANT_ID"],
  updater: ["TAURI_SIGNING_PRIVATE_KEY", "TAURI_SIGNING_PRIVATE_KEY_PASSWORD"],
} as const;

const ED_KEY = /^[a-z0-9][a-z0-9-]{0,31}:[A-Za-z0-9_-]{43}$/;

/** Tauri の公開鍵の文字列（minisign の .pub を base64 にしたもの）の形か */
function isTauriPubkey(s: string): boolean {
  try {
    const text = Buffer.from(s, "base64").toString("utf8");
    const lines = text.split("\n");
    if (!lines[0]?.startsWith("untrusted comment:")) return false;
    const raw = Buffer.from(lines[1] ?? "", "base64");
    return raw.length === 42 && raw.subarray(0, 2).toString("latin1") === "Ed";
  } catch {
    return false;
  }
}

/** 公開鍵の中身（役割をまたいで同じ鍵を使っていないかを比べる）。形が違えば null */
function keyBytes(role: string, line: string): string | null {
  if (role === "app_update") {
    if (!isTauriPubkey(line)) return null;
    const lines = Buffer.from(line, "base64").toString("utf8").split("\n");
    return Buffer.from(lines[1] ?? "", "base64").subarray(10).toString("hex");
  }
  if (!ED_KEY.test(line)) return null;
  return Buffer.from(line.slice(line.indexOf(":") + 1), "base64url").toString("hex");
}

/** [keys]（本番の鍵）と [dev_keys]（開発用の鍵）の並びの形（本数・書き方・本番と開発用の名前の決まり・名前と公開鍵の重なり）の誤り。
 * 決まりは crates/distribution の KeyRing::from_config・with_dev と同じ（本体の build.rs もそちらで確かめる） */
export function keyProblems(keys: Record<string, unknown>, devKeys: Record<string, unknown> = {}): string[] {
  const problems: string[] = [];
  const seenKid = new Set<string>();
  const seenKey = new Map<string, string>();
  for (const [section, table, dev] of [["keys", keys, false], ["dev_keys", devKeys, true]] as const) {
    for (const role of KEY_ROLES) {
      const list = table[role] ?? (dev ? [] : undefined);
      if (!Array.isArray(list) || !list.every((x) => typeof x === "string")) {
        problems.push(`config/distribution.toml: [${section}] の ${role} は文字列の配列にする`);
        continue;
      }
      if (dev && role === "app_update" && list.length > 0) {
        problems.push(`config/distribution.toml: [${section}] には app_update を書けない（アプリ更新用の鍵は開発用と見分けられない）`);
        continue;
      }
      if (list.length > MAX_KEYS_PER_ROLE) problems.push(`config/distribution.toml: [${section}] の ${role} は現用と次期の ${MAX_KEYS_PER_ROLE} 本まで`);
      list.forEach((line: string, i) => {
        const bytes = keyBytes(role, line);
        if (bytes === null) {
          problems.push(
            role === "app_update"
              ? `config/distribution.toml: [${section}] の app_update の ${i + 1} 本目は、tauri signer generate が出す公開鍵の文字列のまま書く`
              : `config/distribution.toml: [${section}] の ${role} の ${i + 1} 本目は「鍵の名前:公開鍵（base64url の43文字）」の形にする`,
          );
          return;
        }
        if (role !== "app_update") {
          const kid = line.slice(0, line.indexOf(":"));
          if (seenKid.has(kid)) problems.push(`config/distribution.toml: [${section}] の鍵の名前「${kid}」が重なっている`);
          seenKid.add(kid);
          if (kid.startsWith(DEV_KID_PREFIX) !== dev) problems.push(dev ? `config/distribution.toml: [${section}] の鍵の名前「${kid}」は ${DEV_KID_PREFIX} で始める（開発用の鍵）` : `config/distribution.toml: [${section}] の鍵の名前「${kid}」は ${DEV_KID_PREFIX} で始めない（${DEV_KID_PREFIX} は開発用の鍵の名前）`);
        }
        const other = seenKey.get(bytes);
        if (other !== undefined) problems.push(`config/distribution.toml: [${section}] の ${role} の ${i + 1} 本目と同じ公開鍵が ${other} にもある（役割ごと・本番と開発用で別の鍵にする）`);
        seenKey.set(bytes, `[${section}] の ${role}`);
      });
    }
  }
  for (const k of Object.keys(devKeys)) if (!(KEY_ROLES as readonly string[]).includes(k)) problems.push(`config/distribution.toml: [dev_keys] の ${k} は知らない欄`);
  return problems;
}

/** [signing] の形の誤り */
export function signingProblems(s: Partial<Signing> | undefined): string[] {
  if (s === undefined) return ["config/distribution.toml に [signing] がありません（0117 の5）"];
  const problems: string[] = [];
  for (const k of ["mac_signing_identity", "windows_method", "windows_endpoint", "windows_account", "windows_profile"] as const) {
    if (typeof s[k] !== "string") problems.push(`config/distribution.toml: [signing] の ${k} は文字列にする（使わないときは ""）`);
  }
  if (s.windows_method !== undefined && !["artifact-signing", "none"].includes(s.windows_method)) problems.push('config/distribution.toml: [signing] の windows_method は "artifact-signing" か "none"');
  if (s.mac_signing_identity && !/^Developer ID Application: .+ \([A-Z0-9]{10}\)$/.test(s.mac_signing_identity)) problems.push("config/distribution.toml: [signing] の mac_signing_identity は「Developer ID Application: <名前> (<チームID 10文字>)」の形にする");
  if (s.windows_endpoint && !/^https:\/\/[a-z0-9]+\.codesigning\.azure\.net\/?$/.test(s.windows_endpoint)) problems.push("config/distribution.toml: [signing] の windows_endpoint は https://<地域>.codesigning.azure.net の形にする");
  for (const k of ["windows_account", "windows_profile"] as const) {
    const v = s[k];
    if (v && !/^[A-Za-z][A-Za-z0-9-]{2,99}$/.test(v)) problems.push(`config/distribution.toml: [signing] の ${k} は英数字と「-」にする`);
  }
  return problems;
}

export type Os = "macos" | "windows" | "linux";

export interface SigningPlan {
  /** tauri build の --config に渡す上書き */
  config: { bundle: Record<string, unknown> };
  /** tauri build に渡す環境変数から外す名前（空の秘密の値。空のまま渡すと Tauri が署名しようとして止まるため） */
  unset: string[];
  /** 何を署名し、何を飛ばしたか（秘密の値は入れない） */
  notes: string[];
  /** Windows の署名に使う道具を入れる必要があるか */
  needsArtifactSigningCli: boolean;
  /** 公証の鍵（.p8）を書き出す必要があるか（APPLE_API_KEY_P8 の中身を一時ファイルに書いて APPLE_API_KEY_PATH にする） */
  writeApiKeyFile: boolean;
}

const present = (env: Record<string, string | undefined>, names: readonly string[]) => names.every((n) => (env[n] ?? "") !== "");

/** OS と秘密の値の有無から、署名の段取りを決める（秘密の値が1つでも欠けたら、その署名は飛ばして普通にビルドする） */
export function signingPlan(os: Os, signing: Signing, env: Record<string, string | undefined>, productName: string): SigningPlan {
  const bundle: Record<string, unknown> = {};
  const unset: string[] = [];
  const notes: string[] = [];
  let needsArtifactSigningCli = false;
  let writeApiKeyFile = false;
  const drop = (names: readonly string[]) => {
    for (const n of names) if (n in env) unset.push(n);
  };

  // アプリ本体の更新のファイル（.sig）。秘密鍵があるときだけ作る（無いと Tauri のビルドが止まるため）
  if (present(env, ["TAURI_SIGNING_PRIVATE_KEY"])) {
    bundle.createUpdaterArtifacts = true;
    notes.push("更新のファイル: 署名する（TAURI_SIGNING_PRIVATE_KEY）");
  } else {
    bundle.createUpdaterArtifacts = false;
    drop(SECRET_NAMES.updater);
    notes.push("更新のファイル: 秘密鍵が無いので作らない");
  }

  if (os === "macos") {
    if (signing.mac_signing_identity !== "" && present(env, SECRET_NAMES.mac)) {
      bundle.macOS = { signingIdentity: signing.mac_signing_identity, hardenedRuntime: true };
      notes.push("Mac: Developer ID で署名する");
      if (present(env, SECRET_NAMES.notarize)) {
        writeApiKeyFile = true;
        notes.push("Mac: 公証する（App Store Connect の API キー）");
      } else {
        drop(SECRET_NAMES.notarize);
        notes.push("Mac: 公証の秘密の値が無いので公証しない");
      }
    } else {
      bundle.macOS = { signingIdentity: null };
      drop([...SECRET_NAMES.mac, ...SECRET_NAMES.notarize, "APPLE_SIGNING_IDENTITY"]);
      notes.push("Mac: 署名の名前か証明書が無いので署名しない");
    }
  } else {
    drop([...SECRET_NAMES.mac, ...SECRET_NAMES.notarize, "APPLE_SIGNING_IDENTITY"]);
  }

  if (os === "windows") {
    const named = signing.windows_method === "artifact-signing" && signing.windows_endpoint !== "" && signing.windows_account !== "" && signing.windows_profile !== "";
    if (named && present(env, SECRET_NAMES.windows)) {
      const endpoint = signing.windows_endpoint.replace(/\/$/, "");
      bundle.windows = { signCommand: `artifact-signing-cli -e ${endpoint} -a ${signing.windows_account} -c ${signing.windows_profile} -d ${productName} %1` };
      needsArtifactSigningCli = true;
      notes.push("Windows: Azure Artifact Signing で署名する");
    } else {
      drop(SECRET_NAMES.windows);
      notes.push(signing.windows_method === "none" ? "Windows: 署名しない設定" : "Windows: 署名の名前か秘密の値が無いので署名しない");
    }
  } else {
    drop(SECRET_NAMES.windows);
  }
  return { config: { bundle }, unset, notes, needsArtifactSigningCli, writeApiKeyFile };
}
