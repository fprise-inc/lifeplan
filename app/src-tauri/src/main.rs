// Windows の本番のビルドでコンソールの窓を出さない
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    financia_app::run();
}
