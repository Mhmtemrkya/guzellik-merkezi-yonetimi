use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tauri::{Manager, WindowEvent, webview::PageLoadEvent};

// Splash en az bu kadar görünsün ki açılışta "yanıp sönme" olmasın.
const MIN_SPLASH: Duration = Duration::from_millis(1200);
// Pencere ilk gösterildikten sonra kısa süreli odak oynamaları (splash kapanması vb.)
// oturum düşürmesin.
const FOCUS_GRACE: Duration = Duration::from_secs(3);

/// Ekran görüntüsü / ekran kaydı araçları pencereyi yakalayamasın (Windows).
#[cfg(windows)]
fn block_capture(window: &tauri::WebviewWindow) {
    use windows_sys::Win32::UI::WindowsAndMessaging::SetWindowDisplayAffinity;
    const WDA_EXCLUDEFROMCAPTURE: u32 = 0x11;
    if let Ok(hwnd) = window.hwnd() {
        unsafe {
            SetWindowDisplayAffinity(hwnd.0 as _, WDA_EXCLUDEFROMCAPTURE);
        }
    }
}

#[cfg(not(windows))]
fn block_capture(_window: &tauri::WebviewWindow) {}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let started = Instant::now();
    let shown_at: Arc<Mutex<Option<Instant>>> = Arc::new(Mutex::new(None));
    let shown_for_events = shown_at.clone();

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
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
                    let _ = main.show();
                    let _ = main.set_focus();
                    // Grace süresi ilk gösterimden itibaren işler; sonraki sayfa
                    // yüklemeleri (login sonrası yönlendirme) süreyi sıfırlamasın.
                    let mut guard = shown_at.lock().unwrap();
                    if guard.is_none() {
                        *guard = Some(Instant::now());
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
            if let WindowEvent::Focused(false) = event {
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
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
