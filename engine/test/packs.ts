// テストの制度データのパックの組み立て（test/global-setup.ts が流す前に1回だけ呼ぶ。vitest の外の道具（scripts/l2-report.ts など）は
// test/helpers.ts からその場で呼ぶ）
import { join } from "node:path";
import { ENGINE_DIR } from "../scripts/lib.ts";
import { buildPack, packDirs, type PackJson } from "../scripts/regulation.ts";

/** 製品の制度データ（data/regulation。原本での確認待ちの値を含む） */
export const buildRealPacks = (): PackJson[] => packDirs().map(buildPack);

/** 【架空の見本】テスト用の制度データ */
export const buildFictionalPacks = (): PackJson[] =>
  ["testTax", "testSocialInsurance", "testPension", "testWageStats", "testNisaIdeco", "testHousing", "testRetirement", "testEducationSupport", "testEducationStatistics"].map((n) =>
    buildPack(join(ENGINE_DIR, "test", "fixtures", "regulation", n)),
  );
