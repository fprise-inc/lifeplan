import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  // 拡張の束（sdk/examples/extensions/）が読む @lifeplan/sdk を、正本の src/sdk.ts につなぐ（0114 の9）
  resolve: { alias: { "@lifeplan/sdk": fileURLToPath(new URL("./src/sdk.ts", import.meta.url)) } },
  test: {
    include: ["test/**/*.test.ts"],
    testTimeout: 30000,
  },
});
