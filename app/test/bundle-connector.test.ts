// 0015 の追記（2026-11-19）: 配布物に AI接続の本体（lifeplan）を同梱する段取り（app/scripts/connector.ts）
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { appVersion, cargoVersion, connectorCargoVersion, connectorPlan, SIDECAR, sidecarFile, versionProblems } from "../scripts/connector.ts";
import { APP_DIR } from "../scripts/lib.ts";

describe("AI接続の本体の同梱（0015 の追記 2026-11-19）", () => {
  it("アプリの版と AI接続の本体の版がそろっている（違うと配布物で VERSION_MISMATCH になる）", () => {
    expect(versionProblems(appVersion(), connectorCargoVersion())).toEqual([]);
    // アプリ本体の Cargo.toml の版も同じにしておく（Tauri は tauri.conf.json の版を使うが、ずれると紛らわしい）
    expect(cargoVersion(readFileSync(join(APP_DIR, "src-tauri", "Cargo.toml"), "utf8"))).toBe(appVersion());
  });

  it("版がずれたら止める", () => {
    expect(versionProblems("0.2.0", "0.1.0").join()).toContain("そろえてください");
    expect(versionProblems(undefined, "0.1.0").join()).toContain("version がありません");
    expect(versionProblems("0.1.0", null).join()).toContain("version がありません");
  });

  it("Cargo.toml の [package] の version だけを読む（依存の version は読まない）", () => {
    expect(cargoVersion('[package]\nname = "x"\nversion = "1.2.3"\n\n[dependencies]\nfoo = { version = "9" }\n')).toBe("1.2.3");
    expect(cargoVersion('[dependencies]\nversion = "9"\n')).toBeNull();
  });

  it("Mac の universal は、2つのアーキテクチャで作って lipo でまとめる", () => {
    expect(connectorPlan(["--target", "universal-apple-darwin", "--bundles", "app,dmg"], "aarch64-apple-darwin")).toEqual({
      build: ["aarch64-apple-darwin", "x86_64-apple-darwin"],
      universal: true,
      bundled: "universal-apple-darwin",
    });
    expect(connectorPlan(["--target=universal-apple-darwin"], "x86_64-apple-darwin").universal).toBe(true);
  });

  it("--target が無ければ、この PC のターゲットで作る（Windows・Linux の CI）", () => {
    expect(connectorPlan(["--bundles", "nsis,msi"], "x86_64-pc-windows-msvc")).toEqual({ build: ["x86_64-pc-windows-msvc"], universal: false, bundled: "x86_64-pc-windows-msvc" });
    expect(connectorPlan(["--bundles", "deb"], "x86_64-unknown-linux-gnu").bundled).toBe("x86_64-unknown-linux-gnu");
    expect(connectorPlan(["-t", "aarch64-apple-darwin"], "x86_64-apple-darwin").build).toEqual(["aarch64-apple-darwin"]);
    expect(() => connectorPlan(["--target"], "x86_64-apple-darwin")).toThrow();
  });

  it("サイドカーの名前は Tauri の決まり（binaries/lifeplan-<ターゲット>、Windows は .exe）", () => {
    expect(SIDECAR).toBe("binaries/lifeplan");
    expect(sidecarFile("x86_64-pc-windows-msvc")).toBe("lifeplan-x86_64-pc-windows-msvc.exe");
    expect(sidecarFile("universal-apple-darwin")).toBe("lifeplan-universal-apple-darwin");
    expect(sidecarFile("x86_64-unknown-linux-gnu")).toBe("lifeplan-x86_64-unknown-linux-gnu");
  });

  it("tauri.conf.json には externalBin を書かない（開発用の起動と CI のテストのビルドがサイドカーを求めて止まらないように。配布のビルドだけ bundle.ts が足す）", () => {
    const conf = JSON.parse(readFileSync(join(APP_DIR, "src-tauri", "tauri.conf.json"), "utf8")) as { bundle: Record<string, unknown> };
    expect(conf.bundle.externalBin).toBeUndefined();
  });
});
