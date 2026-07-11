use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Manager, WindowEvent,
    webview::PageLoadEvent,
};

// Splash en az bu kadar görünsün ki açılışta "yanıp sönme" olmasın.
const MIN_SPLASH: Duration = Duration::from_millis(1200);
// Pencere ilk gösterildikten sonra kısa süreli odak oynamaları (splash kapanması vb.)
// oturum düşürmesin.
const FOCUS_GRACE: Duration = Duration::from_secs(3);

// Tepsiye küçülme / çıkış sırasında pencere odak kaybeder; bu sıradaki focus-lost
// olayları oturum düşürmesin (arka planda bildirim yoklaması sürsün diye oturum yaşar).
static SUPPRESS_FOCUS_LOST: AtomicBool = AtomicBool::new(false);

/// Ekran görüntüsü / ekran kaydı araçları pencereyi yakalayamasın (Windows).
/// `block=false` ile koruma kaldırılır — yönetici "personel ekran görüntüsü alabilir"
/// ayarını açtıysa panel bunu çağırır (web/mobil ile aynı iki seviyeli izin modeli).
#[cfg(windows)]
fn set_capture_block(window: &tauri::WebviewWindow, block: bool) {
    use windows_sys::Win32::UI::WindowsAndMessaging::SetWindowDisplayAffinity;
    const WDA_NONE: u32 = 0x00;
    const WDA_EXCLUDEFROMCAPTURE: u32 = 0x11;
    if let Ok(hwnd) = window.hwnd() {
        unsafe {
            SetWindowDisplayAffinity(hwnd.0 as _, if block { WDA_EXCLUDEFROMCAPTURE } else { WDA_NONE });
        }
    }
}

#[cfg(not(windows))]
fn set_capture_block(_window: &tauri::WebviewWindow, _block: bool) {}

fn block_capture(window: &tauri::WebviewWindow) {
    set_capture_block(window, true);
}

/// Panel (DesktopGuard) girişten sonra efektif ekran görüntüsü iznine göre çağırır:
/// Staff + izin kapalı → block=true, aksi halde block=false.
#[tauri::command]
fn set_screenshot_protection(app: tauri::AppHandle, block: bool) {
    if let Some(main) = app.get_webview_window("main") {
        set_capture_block(&main, block);
    }
}

/// ✕ butonu: uygulamayı kapatmak yerine tepsiye küçültür — gizli pencerede bildirim
/// yoklaması devam eder (WhatsApp/Discord modeli). Gerçek çıkış tepsi menüsünden.
#[tauri::command]
fn hide_to_tray(app: tauri::AppHandle) {
    SUPPRESS_FOCUS_LOST.store(true, Ordering::SeqCst);
    if let Some(main) = app.get_webview_window("main") {
        let _ = main.hide();
    }
}

fn show_main(app: &tauri::AppHandle) {
    if let Some(main) = app.get_webview_window("main") {
        SUPPRESS_FOCUS_LOST.store(false, Ordering::SeqCst);
        let _ = main.show();
        let _ = main.unminimize();
        let _ = main.set_focus();
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let started = Instant::now();
    let shown_at: Arc<Mutex<Option<Instant>>> = Arc::new(Mutex::new(None));
    let shown_for_events = shown_at.clone();
    // Autostart "--hidden" ile başlatır: pencere gösterilmez, tepside bekler,
    // bildirimler arka planda düşer.
    let start_hidden = std::env::args().any(|a| a == "--hidden");
    if start_hidden {
        SUPPRESS_FOCUS_LOST.store(true, Ordering::SeqCst);
    }

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            Some(vec!["--hidden"]),
        ))
        .invoke_handler(tauri::generate_handler![set_screenshot_protection, hide_to_tray])
        .setup(move |app| {
            // Açılışta otomatik başlatmayı kaydet (idempotent) — PC açılınca tepside hazır olur.
            {
                use tauri_plugin_autostart::ManagerExt;
                let _ = app.autolaunch().enable();
            }

            // Gizli başlangıçta splash'e gerek yok.
            if start_hidden {
                if let Some(splash) = app.get_webview_window("splash") {
                    let _ = splash.close();
                }
            }

            // Sistem tepsisi: sol tık pencereyi açar; menüden gerçek çıkış yapılır.
            let show = MenuItem::with_id(app, "show", "Paneli Aç", true, None::<&str>)?;
            let quit = MenuItem::with_id(app, "quit", "Çıkış", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show, &quit])?;
            TrayIconBuilder::with_id("beautyassist-tray")
                .icon(app.default_window_icon().expect("pencere ikonu yok").clone())
                .tooltip("BeautyAssist")
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "show" => show_main(app),
                    "quit" => {
                        SUPPRESS_FOCUS_LOST.store(true, Ordering::SeqCst);
                        app.exit(0);
                    }
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        show_main(tray.app_handle());
                    }
                })
                .build(app)?;
            Ok(())
        })
        .on_page_load(move |webview, payload| {
            if payload.event() != PageLoadEvent::Finished || webview.label() != "main" {
                return;
            }
            let app = webview.app_handle().clone();
            let elapsed = started.elapsed();
            let shown_at = shown_at.clone();
            std::thread::spawn(move || {
                if elapsed < MIN_SPLASH {
                    std::thread::sleep(MIN_SPLASH - elapsed);
                }
                if let Some(main) = app.get_webview_window("main") {
                    block_capture(&main);
                    if !start_hidden {
                        let _ = main.show();
                        let _ = main.set_focus();
                        // Grace süresi ilk gösterimden itibaren işler; sonraki sayfa
                        // yüklemeleri (login sonrası yönlendirme) süreyi sıfırlamasın.
                        let mut guard = shown_at.lock().unwrap();
                        if guard.is_none() {
                            *guard = Some(Instant::now());
                        }
                    }
                }
                if let Some(splash) = app.get_webview_window("splash") {
                    let _ = splash.close();
                }
            });
        })
        .on_window_event(move |window, event| {
            if window.label() != "main" {
                return;
            }
            match event {
                // Gizli başlayıp tepsiden açılma dahil: grace ilk odaklanmadan itibaren işler.
                WindowEvent::Focused(true) => {
                    let mut guard = shown_for_events.lock().unwrap();
                    if guard.is_none() {
                        *guard = Some(Instant::now());
                    }
                }
                WindowEvent::Focused(false) => {
                    if SUPPRESS_FOCUS_LOST.load(Ordering::SeqCst) {
                        return;
                    }
                    let armed = shown_for_events
                        .lock()
                        .unwrap()
                        .map_or(false, |t| t.elapsed() > FOCUS_GRACE);
                    if !armed {
                        return;
                    }
                    if let Some(main) = window.app_handle().get_webview_window("main") {
                        // Sayfa bu olayda oturumu düşürür, loglar ve ekranı bulanıklaştırır.
                        let _ = main.eval(
                            "window.dispatchEvent(new CustomEvent('desktop-focus-lost'))",
                        );
                        // Pencereyi öne geri çek: kullanıcı başka ekranda kalamaz.
                        let _ = main.unminimize();
                        let _ = main.set_focus();
                    }
                }
                _ => {}
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
