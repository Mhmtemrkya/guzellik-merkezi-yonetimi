// Masaüstü kabuğu — her sayfa yüklenişinde (uzak panel dahil) çalışır. `window.__BA_STORE__`
// Rust tarafından betiğin önüne yazılır: true → Mac App Store derlemesi.
//
// Masaüstü uygulaması YALNIZ işletme paneli içindir (yönetici + personel + platform). Müşteri
// yüzeyleri (salon vitrini, müşteri randevu portalı, tanıtım/kayıt sayfaları) masaüstünde
// açılmaz; web sitesinde aynen durur. Web'i değiştirip yeniden yayınlamak yerine kapı burada.
//
// Store derlemesinde ek olarak dijital abonelik satın alma yüzeyleri (paket, ödeme) kapalıdır:
// App Store 3.1.1 uygulama içinden IAP dışı satın almaya yönlendirmeyi reddeder; iOS'ta aynı
// yüzeyler StorePolicy ile gizleniyor.
(function () {
  // Yalnız web paneli: yerel splash da `tauri://localhost` olduğu için protokol de kontrol edilir.
  var host = location.hostname;
  if (!/^https?:$/.test(location.protocol)) return;
  if (host !== 'beautyasist.com' && host !== 'localhost') return;
  var store = window.__BA_STORE__ === true;

  // İşletme paneli ve ona eşlik eden sayfalar. Bunların dışındaki her yol girişe döner.
  var PANEL = [
    '/login', '/change-password', '/panel', '/ekip', '/platform',
    '/imza', // tablet onam imza istasyonu (personel panelden açar)
    '/gizlilik', '/kvkk', '/hesap-silme', '/mesafeli-satis-sozlesmesi', '/teslimat-ve-iade',
  ];
  if (!store) PANEL.push('/odeme'); // doğrudan dağıtımda paket yenileme akışı korunur
  var STORE_BLOCKED = ['/panel/paket'];

  function under(path, prefix) {
    return path === prefix || path.indexOf(prefix + '/') === 0;
  }

  // İzin verilmeyen yol için gidilecek yer; izinliyse null. Giriş ekranı, oturum varsa
  // kullanıcıyı rolüne uygun panele kendisi geçirir.
  function redirectFor(path) {
    if (path == null) return null;
    if (store && STORE_BLOCKED.some(function (p) { return under(path, p); })) return '/login';
    if (PANEL.some(function (p) { return under(path, p); })) return null;
    return '/login';
  }

  function pathOf(url) {
    try { return new URL(url, location.href).pathname; } catch (_) { return null; }
  }

  // 1) Doğrudan açılan izinsiz sayfa (tam yükleme).
  var initial = redirectFor(location.pathname);
  if (initial) { location.replace(initial); return; }

  // 2) İstemci tarafı geçişler (Next.js router history API kullanır).
  ['pushState', 'replaceState'].forEach(function (name) {
    var original = history[name];
    history[name] = function (state, title, url) {
      if (url != null) {
        var target = redirectFor(pathOf(url));
        if (target) { location.replace(target); return; }
      }
      return original.apply(this, arguments);
    };
  });
  window.addEventListener('popstate', function () {
    var target = redirectFor(location.pathname);
    if (target) location.replace(target);
  });

  // 3) İzinsiz bağlantıya tıklama hiç gerçekleşmesin (Link geçişinden önce yakalanır).
  //    Store: yeni sekme (`_blank`) WebView'da hiçbir şey yapmaz → aynı pencerede gezinmeye
  //    çevrilir; dış adresi Rust'taki gezinme kancası sistem tarayıcısında açar.
  document.addEventListener('click', function (event) {
    var link = event.target && event.target.closest && event.target.closest('a[href]');
    if (!link) return;
    if (link.origin === location.origin && redirectFor(link.pathname)) {
      event.preventDefault();
      event.stopPropagation();
    } else if (store && link.target === '_blank' && !link.hasAttribute('download')) {
      event.preventDefault();
      location.href = link.href;
    }
  }, true);

  // 4) Panel dışına (vitrin, müşteri portalı, kayıt, tanıtım) giden bağlantılar görünmesin.
  var hidden = [
    'a[href^="/salon"]', 'a[href="/randevu"]', 'a[href^="/randevu/"]', 'a[href^="/kayit"]',
    'a[href^="/moduller"]', 'a[href^="/hediye-kart"]', 'a[href^="/destek"]', 'a[href^="/#"]',
  ];
  if (store) {
    // Satın alma yüzeyleri + kiosk ✕ butonu (Store'da normal pencere var, kırmızı düğme kapatır).
    hidden.push('a[href^="/odeme"]', 'a[href^="/panel/paket"]', 'button[aria-label="Tepsiye küçült"]');
  }
  var css = hidden.join(',') + '{display:none!important}' +
    // Ayrı kural: :has desteklenmeyen eski WebKit'te yalnız bu düşsün, üstteki gizleme kalsın.
    'p:has(> a[href^="/kayit"]){display:none!important}'; // "Hesabınız yok mu?" boşta kalmasın

  function onReady() {
    var style = document.createElement('style');
    style.textContent = css;
    document.head.appendChild(style);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', onReady);
  else onReady();
})();
