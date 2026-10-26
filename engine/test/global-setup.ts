// テストの前に1回だけ: 制度データのパックを組み立てて、各テストのファイルに渡す（test/helpers.ts の realPacks・fictionalPacks）。
// 組み立て（YAML の読み込みと形式の検査）は1回で1秒ほどかかる。テストのファイルごとに組み立てると、
// 並べて流したときに各ファイルの最初のテストの時間がふくらみ、時間の上限に近づくため
import { join } from "node:path";
import type { TestProject } from "vitest/node";
import { ENGINE_DIR } from "../scripts/lib.ts";
import { buildPack, packDirs, type PackJson } from "../scripts/regulation.ts";

declare module "vitest" {
  export interface ProvidedContext {
    realPacks: PackJson[];
    fictionalPacks: PackJson[];
  }
}

/** 【架空の見本】テスト用の制度データ */
const FICTIONAL = ["testTax", "testSocialInsurance", "testPension", "testWageStats", "testNisaIdeco", "testHousing", "testRetirement", "testEducationSupport", "testEducationStatistics"];

export default function setup(project: TestProject): void {
  project.provide("realPacks", packDirs().map(buildPack));
  project.provide("fictionalPacks", FICTIONAL.map((n) => buildPack(join(ENGINE_DIR, "test", "fixtures", "regulation", n))));
}
