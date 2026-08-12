import 'package:flutter/material.dart';
import 'package:google_fonts/google_fonts.dart';

/// PANO PALETİ (web `globals.css` → "Dashboard paleti" ve `PanelKit` ile AYNI).
///
/// Kurallar web tarafıyla birebir:
///  • Kart YÜZÜ beyaz; renk doygun aksandan gelir, AÇIK TİNT KULLANILMAZ.
///  • Kuyu/inset yüzeyler nötr paper (#F7F6F6) — pembe tint değil.
///  • YEŞİL para rengidir (tahsilat/ciro); yalnız parasal göstergede kullanılır.
///  • İkincil metin en az #74616A — düşük opaklık okunmuyordu.
///
/// Bu sınıf mobilin TEK renk kaynağıdır: burada değişen ton bütün ekranlara geçer.
/// Ekranlarda ham hex yazmak, webde yapılan bir düzeltmenin mobile geçmemesini üretir.
abstract final class AppColors {
  static const background = Color(0xFFFFF7FA);
  static const surface = Color(0xFFFFFFFF);

  /// Kuyu/inset yüzey — paletin paper tonu (eskiden pembe tint #FFF0F5 idi).
  static const surfaceSoft = Color(0xFFF7F6F6);
  static const ink = Color(0xFF2A2027);
  static const muted = Color(0xFF74616A);

  /// Birincil aksan — paletin plum tonu (eskiden parlak pembe #EF6F94 idi).
  static const primary = Color(0xFFA5556E);
  static const primaryDark = Color(0xFF8C4460);

  /// Paletin pembesi — avatar/rozet zeminleri.
  static const rose = Color(0xFFF9A1B9);
  static const border = Color(0xFFEAD8DF);

  /// PARA rengi (tahsilat/ciro).
  static const success = Color(0xFF1E8C60);
  static const warning = Color(0xFFB88938);
  static const danger = Color(0xFFB23252);

  /// Paletin mavi ve mor aksanları — pano kartlarındaki mint/violet tonlarının karşılığı.
  static const mint = Color(0xFF1E4E8C);
  static const violet = Color(0xFF8E7882);
}

abstract final class AppTheme {
  static ThemeData get light {
    final base = ThemeData(
      useMaterial3: true,
      colorScheme: ColorScheme.fromSeed(
        seedColor: AppColors.primary,
        brightness: Brightness.light,
        surface: AppColors.surface,
      ),
    );
    final textTheme = GoogleFonts.interTextTheme(
      base.textTheme,
    ).apply(bodyColor: AppColors.ink, displayColor: AppColors.ink);
    return base.copyWith(
      scaffoldBackgroundColor: AppColors.background,
      textTheme: textTheme,
      appBarTheme: AppBarTheme(
        centerTitle: false,
        elevation: 0,
        scrolledUnderElevation: 0,
        backgroundColor: Colors.transparent,
        foregroundColor: AppColors.ink,
        titleTextStyle: GoogleFonts.manrope(
          color: AppColors.ink,
          fontSize: 21,
          fontWeight: FontWeight.w800,
        ),
      ),
      cardTheme: const CardThemeData(
        color: AppColors.surface,
        elevation: 0,
        margin: EdgeInsets.zero,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.all(Radius.circular(22)),
          side: BorderSide(color: AppColors.border),
        ),
      ),
      inputDecorationTheme: InputDecorationTheme(
        filled: true,
        fillColor: AppColors.surface,
        contentPadding: const EdgeInsets.symmetric(
          horizontal: 16,
          vertical: 15,
        ),
        hintStyle: const TextStyle(color: AppColors.muted),
        border: OutlineInputBorder(
          borderRadius: BorderRadius.circular(16),
          borderSide: const BorderSide(color: AppColors.border),
        ),
        enabledBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(16),
          borderSide: const BorderSide(color: AppColors.border),
        ),
        focusedBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(16),
          borderSide: const BorderSide(color: AppColors.primary, width: 1.5),
        ),
      ),
      filledButtonTheme: FilledButtonThemeData(
        style: FilledButton.styleFrom(
          minimumSize: const Size.fromHeight(52),
          backgroundColor: AppColors.primary,
          foregroundColor: Colors.white,
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(16),
          ),
          textStyle: const TextStyle(fontWeight: FontWeight.w700),
        ),
      ),
      navigationBarTheme: NavigationBarThemeData(
        height: 70,
        elevation: 0,
        backgroundColor: Colors.white,
        indicatorColor: AppColors.rose,
        labelTextStyle: WidgetStateProperty.resolveWith(
          (states) => TextStyle(
            color: states.contains(WidgetState.selected)
                ? AppColors.primaryDark
                : AppColors.muted,
            fontSize: 11,
            fontWeight: FontWeight.w700,
          ),
        ),
      ),
      snackBarTheme: SnackBarThemeData(
        behavior: SnackBarBehavior.floating,
        backgroundColor: AppColors.ink,
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(14)),
      ),
    );
  }
}

/// Düğme yardımcıları.
///
/// KRİTİK: [AppTheme] `filledButtonTheme`'inde `minimumSize: Size.fromHeight(52)` verir;
/// bu SONSUZ genişlik demektir (Size.fromHeight → Size(double.infinity, 52)) ve dikey
/// yerleşimde düğmelerin tam genişlik olmasını sağlar. Ancak aynı düğme bir [Row] içine
/// konduğunda satırın tamamını talep eder → yanındaki `Expanded` metin 0 piksele düşer ve
/// yazı HER HARF ALT ALTA görünür. Row içindeki düğmelerde [AppButtons.inline] kullanın:
/// yükseklik korunur, genişlik içeriğe göre daralır (tablet/telefon farkı olmadan).
abstract final class AppButtons {
  static ButtonStyle inline({double height = 44}) => ButtonStyle(
        minimumSize: WidgetStatePropertyAll(Size(0, height)),
      );
}
