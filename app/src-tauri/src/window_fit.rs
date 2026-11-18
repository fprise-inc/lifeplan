//! 起動時に、窓を、窓が出るモニターの作業領域（タスクバー・メニューバー・Dock を除いた領域）に収める（0225）。
//!
//! - 窓は tauri.conf.json で見えない状態（`visible: false`）で作り、ここで大きさと位置を決めてから見せる（一瞬大きく出てちらつかない）。
//! - 作業領域に収まる画面では、これまでどおり 1440×900（論理ピクセル）。収まらない画面では、収まる大きさに縮めて作業領域の中央に置く。
//! - 最小の大きさ（1024×700）が作業領域より大きい画面では、最小の大きさも作業領域に合わせて下げる（最小の大きさのせいではみ出さない）。
//! - モニターの情報が取れないとき・おかしな値のときは、何もしない（これまでどおりの大きさと位置で見せる）。
//!
//! 計算はすべて物理ピクセル（モニターの work_area は物理ピクセルで返る）。拡大率は、そのモニターの scale_factor を使う。

use tauri::{PhysicalPosition, PhysicalSize, Runtime, WebviewWindow};

/// 長方形（物理ピクセル。x・y は左上の角）
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Rect {
    pub x: i32,
    pub y: i32,
    pub width: u32,
    pub height: u32,
}

/// 窓の大きさと位置の決め方（物理ピクセル）
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Fit {
    /// 窓の中身（タイトルバー・枠を除く）の大きさ
    pub inner: (u32, u32),
    /// 窓の中身の最小の大きさ
    pub min_inner: (u32, u32),
    /// 窓の外側の左上の位置。`None` は動かさない（今の位置のままで作業領域に収まっている）
    pub outer_position: Option<(i32, i32)>,
}

fn to_physical(logical: f64, scale: f64) -> u32 {
    (logical * scale).round().max(0.0) as u32
}

/// 窓の大きさと位置を決める。
///
/// - `work`: 窓が出るモニターの作業領域
/// - `scale`: そのモニターの拡大率（1.0＝100%、1.5＝150%）
/// - `want`・`min`: 窓の中身の、望む大きさと最小の大きさ（論理ピクセル。tauri.conf.json の width・height と minWidth・minHeight）
/// - `frame`: 窓の外側と中身の差（タイトルバー・枠。物理ピクセル）
/// - `outer_position`: 今の窓の外側の左上の位置
///
/// 値がおかしい（作業領域が空・拡大率が正でない・枠だけで作業領域を超える）ときは `None`（何もしない）
pub fn fit(
    work: Rect,
    scale: f64,
    want: (f64, f64),
    min: (f64, f64),
    frame: (u32, u32),
    outer_position: (i32, i32),
) -> Option<Fit> {
    if !(scale.is_finite() && scale > 0.0) || work.width == 0 || work.height == 0 {
        return None;
    }
    if frame.0 >= work.width || frame.1 >= work.height {
        return None;
    }
    let room = (work.width - frame.0, work.height - frame.1);
    let want = (to_physical(want.0, scale), to_physical(want.1, scale));
    let min = (to_physical(min.0, scale), to_physical(min.1, scale));
    let inner = (want.0.min(room.0), want.1.min(room.1));
    let min_inner = (min.0.min(inner.0), min.1.min(inner.1));
    let outer = (inner.0 + frame.0, inner.1 + frame.1);
    let inside = i64::from(outer_position.0) >= i64::from(work.x)
        && i64::from(outer_position.1) >= i64::from(work.y)
        && i64::from(outer_position.0) + i64::from(outer.0)
            <= i64::from(work.x) + i64::from(work.width)
        && i64::from(outer_position.1) + i64::from(outer.1)
            <= i64::from(work.y) + i64::from(work.height);
    let outer_position = if inside {
        None
    } else {
        // outer は作業領域以下なので、余りは 0 以上
        let x = i64::from(work.x) + i64::from((work.width - outer.0) / 2);
        let y = i64::from(work.y) + i64::from((work.height - outer.1) / 2);
        Some((
            i32::try_from(x).unwrap_or(work.x),
            i32::try_from(y).unwrap_or(work.y),
        ))
    };
    Some(Fit {
        inner,
        min_inner,
        outer_position,
    })
}

/// 見えない状態で作った窓を、窓が出るモニターの作業領域に収める（見せるのは呼び出し側）。
/// モニターの情報が取れないときは何もしない
pub fn fit_to_work_area<R: Runtime>(window: &WebviewWindow<R>, want: (f64, f64), min: (f64, f64)) {
    let monitor = match window.current_monitor() {
        Ok(Some(m)) => Some(m),
        _ => window.primary_monitor().ok().flatten(),
    };
    let Some(monitor) = monitor else {
        return;
    };
    let (Ok(outer), Ok(inner), Ok(position)) = (
        window.outer_size(),
        window.inner_size(),
        window.outer_position(),
    ) else {
        return;
    };
    let area = monitor.work_area();
    let work = Rect {
        x: area.position.x,
        y: area.position.y,
        width: area.size.width,
        height: area.size.height,
    };
    let frame = (
        outer.width.saturating_sub(inner.width),
        outer.height.saturating_sub(inner.height),
    );
    let Some(fit) = fit(
        work,
        monitor.scale_factor(),
        want,
        min,
        frame,
        (position.x, position.y),
    ) else {
        return;
    };
    // 最小の大きさを先に下げる（先に縮めると、元の最小の大きさで押し戻される）
    window
        .set_min_size(Some(PhysicalSize::new(fit.min_inner.0, fit.min_inner.1)))
        .ok();
    if (inner.width, inner.height) != fit.inner {
        window
            .set_size(PhysicalSize::new(fit.inner.0, fit.inner.1))
            .ok();
    }
    if let Some((x, y)) = fit.outer_position {
        window.set_position(PhysicalPosition::new(x, y)).ok();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const WANT: (f64, f64) = (1440.0, 900.0);
    const MIN: (f64, f64) = (1024.0, 700.0);

    /// Windows の枠（拡大率ごと。左右と下の見えない縁を含む。タイトルバー約 31×拡大率）
    fn win_frame(scale: f64) -> (u32, u32) {
        let border = (8.0 * scale).round() as u32;
        let title = (31.0 * scale).round() as u32;
        (border * 2, title + border)
    }

    /// 横幅 w・高さ h の画面の下に、高さ bar（物理）のタスクバー
    fn work_above_taskbar(w: u32, h: u32, bar: u32) -> Rect {
        Rect {
            x: 0,
            y: 0,
            width: w,
            height: h - bar,
        }
    }

    fn assert_inside(work: Rect, f: &Fit, frame: (u32, u32), pos: (i32, i32)) {
        let pos = f.outer_position.unwrap_or(pos);
        let outer = (f.inner.0 + frame.0, f.inner.1 + frame.1);
        assert!(pos.0 >= work.x && pos.1 >= work.y, "{f:?}");
        assert!(
            i64::from(pos.0) + i64::from(outer.0) <= i64::from(work.x) + i64::from(work.width),
            "{f:?}"
        );
        assert!(
            i64::from(pos.1) + i64::from(outer.1) <= i64::from(work.y) + i64::from(work.height),
            "{f:?}"
        );
        assert!(
            f.min_inner.0 <= f.inner.0 && f.min_inner.1 <= f.inner.1,
            "{f:?}"
        );
    }

    #[test]
    fn a_large_screen_keeps_1440x900_and_the_position() {
        // 2560×1440・100%（タスクバー 48）: これまでどおり 1440×900 で、位置も動かさない
        let work = work_above_taskbar(2560, 1440, 48);
        let frame = win_frame(1.0);
        let f = fit(work, 1.0, WANT, MIN, frame, (100, 80)).unwrap();
        assert_eq!(f.inner, (1440, 900));
        assert_eq!(f.min_inner, (1024, 700));
        assert_eq!(f.outer_position, None);
    }

    #[test]
    fn a_laptop_at_150_percent_shrinks_and_centers() {
        // 1920×1080・150%（論理で 1280×720）。タスクバーは論理 48＝物理 72 → 作業領域は 1920×1008（論理 1280×672）
        let work = work_above_taskbar(1920, 1080, 72);
        let frame = win_frame(1.5);
        let pos = (39, 39);
        let f = fit(work, 1.5, WANT, MIN, frame, pos).unwrap();
        assert_eq!(f.inner, (1920 - frame.0, 1008 - frame.1));
        // 最小の大きさ（論理 1024×700＝物理 1536×1050）の高さは作業領域を超えるので、窓の高さまで下げる。幅はそのまま
        assert_eq!(f.min_inner, (1536, 1008 - frame.1));
        assert_eq!(f.outer_position, Some((0, 0)));
        assert_inside(work, &f, frame, pos);
    }

    #[test]
    fn each_scale_on_a_1080p_screen_fits() {
        // 1920×1080 の画面（タスクバーは論理 48）を、拡大 100/125/150/175% で
        for scale in [1.0, 1.25, 1.5, 1.75] {
            let bar = (48.0 * scale) as u32;
            let work = work_above_taskbar(1920, 1080, bar);
            let frame = win_frame(scale);
            let pos = (26, 26);
            let f = fit(work, scale, WANT, MIN, frame, pos).unwrap();
            assert_inside(work, &f, frame, pos);
            let want = ((1440.0 * scale) as u32, (900.0 * scale) as u32);
            let min = ((1024.0 * scale) as u32, (700.0 * scale) as u32);
            let room = (work.width - frame.0, work.height - frame.1);
            // 望む大きさを超えず、入らない向きだけ作業領域いっぱいまで縮める
            assert_eq!(f.inner, (want.0.min(room.0), want.1.min(room.1)), "{scale}");
            assert_eq!(
                f.min_inner,
                (min.0.min(f.inner.0), min.1.min(f.inner.1)),
                "{scale}"
            );
            if scale == 1.0 {
                // 100% は 1440×900 が入る（これまでどおり。位置も動かさない）
                assert_eq!(f.inner, (1440, 900));
                assert_eq!(f.outer_position, None);
            } else {
                assert!(f.inner.1 < want.1, "{scale}");
            }
            if scale >= 1.5 {
                // 150% 以上は、最小の高さ（700）も入らないので下げる
                assert!(f.min_inner.1 < min.1, "{scale}");
            }
        }
    }

    #[test]
    fn exactly_fitting_and_one_pixel_short() {
        let frame = win_frame(1.0);
        // ちょうど: 作業領域＝1440×900＋枠。位置が左上なら、縮めず動かさない
        let exact = Rect {
            x: 0,
            y: 0,
            width: 1440 + frame.0,
            height: 900 + frame.1,
        };
        let f = fit(exact, 1.0, WANT, MIN, frame, (0, 0)).unwrap();
        assert_eq!(f.inner, (1440, 900));
        assert_eq!(f.outer_position, None);
        // ちょうどでも、ずれた位置なら、中央（ここでは左上）へ動かす
        let f = fit(exact, 1.0, WANT, MIN, frame, (10, 10)).unwrap();
        assert_eq!(f.inner, (1440, 900));
        assert_eq!(f.outer_position, Some((0, 0)));
        // 高さが 1px 足りない: 高さだけ 1px 縮める
        let short = Rect {
            height: exact.height - 1,
            ..exact
        };
        let f = fit(short, 1.0, WANT, MIN, frame, (0, 0)).unwrap();
        assert_eq!(f.inner, (1440, 899));
        assert_eq!(f.min_inner, (1024, 700));
        assert_inside(short, &f, frame, (0, 0));
        // 幅が 1px 足りない
        let narrow = Rect {
            width: exact.width - 1,
            ..exact
        };
        let f = fit(narrow, 1.0, WANT, MIN, frame, (0, 0)).unwrap();
        assert_eq!(f.inner, (1439, 900));
        assert_inside(narrow, &f, frame, (0, 0));
    }

    #[test]
    fn a_portrait_screen_narrows_the_width_and_the_minimum() {
        // 縦長の 1080×1920・100%: 幅を縮め、最小の幅（1024）も作業領域に合わせて下げる。高さは 900 のまま
        let work = work_above_taskbar(1080, 1920, 48);
        let frame = win_frame(1.0);
        let f = fit(work, 1.0, WANT, MIN, frame, (40, 40)).unwrap();
        assert_eq!(f.inner, (1080 - frame.0, 900));
        assert_eq!(f.min_inner, (1024, 700));
        assert_inside(work, &f, frame, (40, 40));
        // さらに狭い縦長（800×1280）: 最小の幅も下げる
        let work = work_above_taskbar(800, 1280, 48);
        let f = fit(work, 1.0, WANT, MIN, frame, (40, 40)).unwrap();
        assert_eq!(f.inner, (800 - frame.0, 900));
        assert_eq!(f.min_inner, (800 - frame.0, 700));
        assert_inside(work, &f, frame, (40, 40));
    }

    #[test]
    fn a_small_screen_lowers_the_minimum_on_both_axes() {
        // 1024×768・100%（タスクバー 40）: 最小の 1024×700 も入らないので、幅も高さも下げる
        let work = work_above_taskbar(1024, 768, 40);
        let frame = win_frame(1.0);
        let f = fit(work, 1.0, WANT, MIN, frame, (0, 0)).unwrap();
        assert_eq!(f.inner, (1024 - frame.0, 728 - frame.1));
        assert_eq!(f.min_inner, f.inner);
        assert_inside(work, &f, frame, (0, 0));
    }

    #[test]
    fn the_second_monitor_is_judged_by_its_own_work_area() {
        // 左に 2560×1440（100%）、右に 1920×1080（150%）。右のモニターの作業領域は x=2560 から
        let right = Rect {
            x: 2560,
            y: 0,
            width: 1920,
            height: 1008,
        };
        let frame = win_frame(1.5);
        // 右のモニターに出た窓（左上が x=2600）は、右のモニターの中央へ
        let f = fit(right, 1.5, WANT, MIN, frame, (2600, 40)).unwrap();
        assert_eq!(f.outer_position, Some((2560, 0)));
        assert_inside(right, &f, frame, (2600, 40));
        // 左にあるモニター（負の座標。x=-1920 から）でも同じ
        let left = Rect {
            x: -1920,
            y: 0,
            width: 1920,
            height: 1032,
        };
        let frame = win_frame(1.0);
        let f = fit(left, 1.0, WANT, MIN, frame, (-1800, 50)).unwrap();
        assert_eq!(f.inner, (1440, 900));
        assert_eq!(f.outer_position, None);
        let f = fit(left, 1.0, WANT, MIN, frame, (-600, 50)).unwrap();
        assert_inside(left, &f, frame, (-600, 50));
        assert_eq!(
            f.outer_position,
            Some((
                -1920 + ((1920 - 1440 - frame.0) / 2) as i32,
                (1032 - 900 - frame.1) as i32 / 2
            ))
        );
    }

    #[test]
    fn a_mac_work_area_without_the_menu_bar_and_dock() {
        // MacBook Air 13 インチ（1470×956 pt・Retina 2.0）。メニューバー 37pt・Dock 下 70pt を除いた作業領域。タイトルバー 28pt
        let scale = 2.0;
        let work = Rect {
            x: 0,
            y: 74,
            width: 2940,
            height: (956 - 37 - 70) * 2,
        };
        let frame = (0, 56);
        let f = fit(work, scale, WANT, MIN, frame, (0, 74)).unwrap();
        // 幅は 1440pt が入る。高さは作業領域（849pt）からタイトルバーを除いた 821pt まで縮める。最小の高さ 700pt はそのまま
        assert_eq!(f.inner, (2880, 1698 - 56));
        assert_eq!(f.min_inner, (2048, 1400));
        assert_inside(work, &f, frame, (0, 74));
        // 大きい Mac（1728×1117 pt）では、これまでどおり
        let work = Rect {
            x: 0,
            y: 74,
            width: 3456,
            height: (1117 - 37) * 2,
        };
        let f = fit(work, scale, WANT, MIN, frame, (200, 200)).unwrap();
        assert_eq!(f.inner, (2880, 1800));
        assert_eq!(f.outer_position, None);
    }

    #[test]
    fn odd_values_do_nothing() {
        let work = work_above_taskbar(1920, 1080, 48);
        let frame = win_frame(1.0);
        assert_eq!(fit(work, 0.0, WANT, MIN, frame, (0, 0)), None);
        assert_eq!(fit(work, f64::NAN, WANT, MIN, frame, (0, 0)), None);
        let empty = Rect { width: 0, ..work };
        assert_eq!(fit(empty, 1.0, WANT, MIN, frame, (0, 0)), None);
        // 枠だけで作業領域を超える
        assert_eq!(fit(work, 1.0, WANT, MIN, (1920, 10), (0, 0)), None);
    }
}
