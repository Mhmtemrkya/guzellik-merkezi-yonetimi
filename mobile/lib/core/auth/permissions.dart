import 'auth_session.dart';

/// Web/backend `Permissions` (Domain/Permissions.cs) mobil eşleniği.
/// İki seviye:
///  - SAYFA izni (ör. "Accounting") → sayfayı görme (tam eşleşme, web sidebar permissionKey gibi).
///  - İŞLEM izni (ör. "Accounting.Accounts") → sayfadaki yazma aksiyonu.
/// Yönetici rolleri her zaman tam yetkilidir; kurallar yalnızca Staff için işler.
abstract final class Perm {
  // Sayfa anahtarları
  static const customers = 'Customers';
  static const appointments = 'Appointments';
  static const waitlist = 'Waitlist';
  static const services = 'Services';
  static const giftCards = 'GiftCards';
  static const stock = 'Stock';
  static const cashRegister = 'CashRegister';
  static const cashClosing = 'CashClosing';
  static const accounting = 'Accounting';
  static const reports = 'Reports';
  static const notifications = 'Notifications';
  static const logs = 'Logs';
  static const settings = 'Settings';

  // İşlem anahtarları — backend PermissionEndpointFilter ile birebir
  static const customersManage = 'Customers.Manage';
  static const customersDelete = 'Customers.Delete';
  static const customersTags = 'Customers.Tags';
  static const appointmentsCreate = 'Appointments.Create';
  static const appointmentsStatus = 'Appointments.Status';
  static const waitlistManage = 'Waitlist.Manage';
  static const servicesManage = 'Services.Manage';
  static const giftCardsManage = 'GiftCards.Manage';
  static const stockManage = 'Stock.Manage';
  static const stockMovements = 'Stock.Movements';
  static const cashRegisterEntry = 'CashRegister.Entry';
  static const cashClosingClose = 'CashClosing.Close';
  static const accountingAdisyon = 'Accounting.Adisyon';
  static const accountingAccounts = 'Accounting.Accounts';
  static const accountingCollect = 'Accounting.Collect';
  static const accountingExpenses = 'Accounting.Expenses';
  static const notificationsSend = 'Notifications.Send';
  static const notificationsTemplates = 'Notifications.Templates';
}

extension PermissionChecks on SessionUser {
  /// Sayfa görme izni (web sidebar `permissions.has(permissionKey)` paritesi).
  /// Yalnızca Staff kısıtlanır; diğer roller tam yetkili.
  bool hasPage(String pageKey) {
    if (!isStaff) return true;
    return permissions
        .any((p) => p.toLowerCase() == pageKey.toLowerCase());
  }

  /// İşlem izni — backend `Permissions.IsActionAllowed` birebir portu
  /// (geriye uyumluluk: sayfa izni var + o sayfaya ait hiçbir işlem anahtarı
  /// atanmamışsa eski format sayılır ve tam yetkili kabul edilir).
  bool canAction(String actionKey) {
    if (!isStaff) return true;
    if (actionKey.isEmpty) return true;
    final lower = actionKey.toLowerCase();
    if (permissions.any((p) => p.toLowerCase() == lower)) return true;

    final dot = actionKey.indexOf('.');
    if (dot <= 0) return false;
    final pageKey = actionKey.substring(0, dot).toLowerCase();
    final hasPageKey = permissions.any((p) => p.toLowerCase() == pageKey);
    if (!hasPageKey) return false;
    final pagePrefix = '$pageKey.';
    return !permissions.any((p) => p.toLowerCase().startsWith(pagePrefix));
  }
}

/// Rota → sayfa izni eşlemesi (web ROUTE_PERMISSION_GUARDS paritesi).
/// Staff bu rotalara izinsiz gidemez; menüde de görünmez.
const Map<String, String> routePagePermissions = {
  '/customers': Perm.customers,
  '/customer-detail': Perm.customers,
  '/consultation': Perm.customers,
  '/treatment-journal': Perm.customers,
  '/appointments': Perm.appointments,
  '/waitlist': Perm.waitlist,
  '/services': Perm.services,
  '/packages': Perm.services,
  '/service-categories': Perm.services,
  '/sessions': Perm.services,
  '/campaigns': Perm.services,
  '/gift-cards': Perm.giftCards,
  '/stock': Perm.stock,
  '/stock-movements': Perm.stock,
  '/cash': Perm.cashRegister,
  '/cash-closing': Perm.cashClosing,
  '/accounting': Perm.accounting,
  '/sales': Perm.accounting,
  '/expenses': Perm.accounting,
  '/expense-categories': Perm.accounting,
  '/reports': Perm.reports,
  '/notifications': Perm.notifications,
  '/notification-logs': Perm.notifications,
  '/whatsapp': Perm.notifications,
  '/whatsapp-messages': Perm.notifications,
  '/logs': Perm.logs,
  '/settings': Perm.settings,
};
