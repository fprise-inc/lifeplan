// テストの前に1回だけ: 制度データのパックを組み立てて、各テストのファイルに渡す（test/helpers.ts の realPacks・fictionalPacks）。
// 組み立て（YAML の読み込みと形式の検査）は1回で1秒ほどかかる。テストのファイルごとに組み立てると、
// 並べて流したときに各ファイルの最初のテストの時間がふくらみ、時間の上限に近づくため
import type { TestProject } from "vitest/node";
import type { PackJson } from "../scripts/regulation.ts";
import { buildFictionalPacks, buildRealPacks } from "./packs.ts";

declare module "vitest" {
  export interface ProvidedContext {
    realPacks: PackJson[];
    fictionalPacks: PackJson[];
  }
}

export default function setup(project: TestProject): void {
  project.provide("realPacks", buildRealPacks());
  project.provide("fictionalPacks", buildFictionalPacks());
}
