// 入力のホームのカードのイラスト（app/src/assets/illustrations/。ファイナンシアのために作成したイラスト、CC0）。
// ビルドでアプリに埋め込む（外から読み込まない。CSP の img-src 'self'。0016 の1）
import abroad from "../../assets/illustrations/abroad.webp";
import assumptions from "../../assets/illustrations/assumptions.webp";
import car from "../../assets/illustrations/car.webp";
import education from "../../assets/illustrations/education.webp";
import events from "../../assets/illustrations/events.webp";
import family from "../../assets/illustrations/family.webp";
import fee from "../../assets/illustrations/fee.webp";
import housing from "../../assets/illustrations/housing.webp";
import insurance from "../../assets/illustrations/insurance.webp";
import living from "../../assets/illustrations/living.webp";
import pension from "../../assets/illustrations/pension.webp";
import pet from "../../assets/illustrations/pet.webp";
import savings from "../../assets/illustrations/savings.webp";
import work from "../../assets/illustrations/work.webp";
import type { Art } from "./items.ts";

// 退職金・企業年金・介護・親・相続・贈与の専用の絵ができるまでは、近い絵を使う（働く人・年配の二人・相談の場面）
export const ILLUSTRATIONS: Record<Art, string> = { family, work, retirement: work, pension, living, education, housing, insurance, savings, events, car, care: pension, inheritance: fee, fee, assumptions, pet, abroad };
