import 'package:flutter/material.dart';

/// Visual style for an appointment/event card on the day timeline.
class EventStyle {
  const EventStyle({
    required this.bg,
    required this.border,
    required this.title,
    required this.sub,
    this.showCheck = false,
  });
  final Color bg;
  final Color border;
  final Color title;
  final Color sub;
  final bool showCheck;
}

abstract final class CalendarTheme {
  static const _green = EventStyle(
    bg: Color(0xFFEAF7EF),
    border: Color(0xFFC2E8CF),
    title: Color(0xFF2A7A50),
    sub: Color(0xFF4F9B72),
  );
  static const _greenChecked = EventStyle(
    bg: Color(0xFFEAF7EF),
    border: Color(0xFFC2E8CF),
    title: Color(0xFF2A7A50),
    sub: Color(0xFF4F9B72),
    showCheck: true,
  );
  static const _blue = EventStyle(
    bg: Color(0xFFEAF1FB),
    border: Color(0xFFCBDDF5),
    title: Color(0xFF2F5FA6),
    sub: Color(0xFF5C7FB0),
  );
  static const _gray = EventStyle(
    bg: Color(0xFFF1F1F3),
    border: Color(0xFFE0E0E4),
    title: Color(0xFF6B6B72),
    sub: Color(0xFF9A9AA0),
  );
  /// "Şu an işlemde" — mor kart (müşteri koltukta, hizmet uygulanıyor).
  static const _purple = EventStyle(
    bg: Color(0xFFF1EAFB),
    border: Color(0xFFD9C8F2),
    title: Color(0xFF6D3FBF),
    sub: Color(0xFF8B66C9),
  );
  static const timeOff = EventStyle(
    bg: Color(0xFFFDEFE0),
    border: Color(0xFFF6D5AE),
    title: Color(0xFFC9852F),
    sub: Color(0xFFC9852F),
  );

  static EventStyle styleFor(String status) {
    switch (status.toLowerCase()) {
      case 'completed':
        return _greenChecked;
      case 'confirmed':
        return _green;
      case 'inprogress':
        return _purple;
      case 'cancelled':
      case 'noshow':
        return _gray;
      case 'scheduled':
      case 'draft':
      default:
        return _blue;
    }
  }
}

abstract final class CalendarText {
  static const weekdayShort = [
    'Pzt',
    'Sal',
    'Çar',
    'Per',
    'Cum',
    'Cmt',
    'Paz',
  ];
  static const weekdayLong = [
    'Pazartesi',
    'Salı',
    'Çarşamba',
    'Perşembe',
    'Cuma',
    'Cumartesi',
    'Pazar',
  ];
  static const months = [
    'Ocak',
    'Şubat',
    'Mart',
    'Nisan',
    'Mayıs',
    'Haziran',
    'Temmuz',
    'Ağustos',
    'Eylül',
    'Ekim',
    'Kasım',
    'Aralık',
  ];

  static String longDate(DateTime d) =>
      '${d.day} ${months[d.month - 1]} ${d.year}, ${weekdayLong[d.weekday - 1]}';

  static String hm(DateTime d) =>
      '${d.hour.toString().padLeft(2, '0')}:${d.minute.toString().padLeft(2, '0')}';

  static String statusLabel(String status) {
    switch (status.toLowerCase()) {
      case 'scheduled':
        return 'Planlandı';
      case 'confirmed':
        return 'Onaylandı';
      case 'inprogress':
        return 'İşlemde';
      case 'completed':
        return 'Tamamlandı';
      case 'cancelled':
        return 'İptal Edildi';
      case 'noshow':
        return 'Gelmedi';
      case 'draft':
        return 'Taslak';
      default:
        return status;
    }
  }

  static Color statusColor(String status) {
    switch (status.toLowerCase()) {
      case 'confirmed':
      case 'completed':
        return const Color(0xFF2A7A50);
      case 'inprogress':
        return const Color(0xFF6D3FBF);
      case 'cancelled':
        return const Color(0xFFD34D68);
      case 'noshow':
        return const Color(0xFF8A8A90);
      default:
        return const Color(0xFF2F5FA6);
    }
  }

  /// Formats a number as Turkish Lira, e.g. 1250 -> "₺1.250,00".
  static String tl(num? value) {
    final v = (value ?? 0).toDouble();
    final negative = v < 0;
    final fixed = v.abs().toStringAsFixed(2);
    final parts = fixed.split('.');
    final intPart = parts[0];
    final buffer = StringBuffer();
    for (var i = 0; i < intPart.length; i++) {
      if (i > 0 && (intPart.length - i) % 3 == 0) buffer.write('.');
      buffer.write(intPart[i]);
    }
    return '${negative ? '-' : ''}₺$buffer,${parts[1]}';
  }
}
