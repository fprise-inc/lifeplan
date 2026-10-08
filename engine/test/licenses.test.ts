// 0021: ライセンスの検査が GPL・LGPL・AGPL を止めること
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { checkLicenses, satisfied } from "../scripts/check-licenses.ts";

describe("ライセンスの検査", () => {
  it("SPDX の式を許可の一覧で判定する", () => {
    expect(satisfied("MIT")).toBe(true);
    expect(satisfied("(MIT OR Apache-2.0)")).toBe(true);
    expect(satisfied("MIT OR GPL-3.0-only")).toBe(true); // 許可の側を選べる
    expect(satisfied("MIT AND ISC")).toBe(true);
    expect(satisfied("MIT AND GPL-2.0")).toBe(false);
    expect(satisfied("GPL-3.0-or-later")).toBe(false);
    expect(satisfied("LGPL-2.1")).toBe(false);
    expect(satisfied("AGPL-3.0")).toBe(false);
    expect(satisfied("CC-BY-NC-4.0")).toBe(false);
  });

  it("node_modules の中の禁止・表示なしの部品を見つける", () => {
    const root = mkdtempSync(join(tmpdir(), "financia-lic-"));
    try {
      const pkg = (dir: string, json: object) => {
        mkdirSync(dir, { recursive: true });
        writeFileSync(join(dir, "package.json"), JSON.stringify(json));
      };
      pkg(join(root, "ok"), { name: "ok", version: "1.0.0", license: "MIT" });
      pkg(join(root, "gpl"), { name: "gpl", version: "1.0.0", license: "GPL-3.0" });
      pkg(join(root, "@scope", "lgpl"), { name: "@scope/lgpl", version: "1.0.0", license: "LGPL-3.0-only" });
      pkg(join(root, "ok", "node_modules", "agpl"), { name: "agpl", version: "1.0.0", license: "AGPL-3.0" });
      pkg(join(root, "none"), { name: "none", version: "1.0.0" });
      pkg(join(root, "dual"), { name: "dual", version: "1.0.0", license: "(MIT OR LGPL-2.1)" });
      const { problems } = checkLicenses(root);
      expect(problems.map((p) => p.split(":")[0]).sort()).toEqual(["@scope/lgpl@1.0.0", "agpl@1.0.0", "gpl@1.0.0", "none@1.0.0"]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
