// 画面の道具の共通: 場所
import { join } from "node:path";

export const APP_DIR = join(import.meta.dirname, "..");
export const REPO_DIR = join(APP_DIR, "..");
export const ENGINE_DIST = join(REPO_DIR, "engine", "dist");
