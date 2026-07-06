import 'package:flutter/widgets.dart';

/// Tablet/iPad duyarlılığı için ortak yardımcılar.
///
/// Kırılımlar Material yönergeleriyle uyumlu:
/// - telefon: < 600 (shortestSide)
/// - tablet dikey / küçük tablet: genişlik ≥ 700
/// - tablet yatay / büyük tablet (iPad yatay): genişlik ≥ 1100
extension ResponsiveContext on BuildContext {
  double get screenWidth => MediaQuery.sizeOf(this).width;

  /// Cihaz tablet mi (iPad / Android tablet)?
  bool get isTablet => MediaQuery.sizeOf(this).shortestSide >= 600;

  /// Yan navigasyon (rail) gösterilecek kadar geniş mi?
  bool get isWide => screenWidth >= 800;
}

/// Telefondaki kolon sayısını ekran genişledikçe kademeli artırır.
/// (2 → 3 → 4, 3 → 4 → 5 gibi.) Grid'lerde sabit crossAxisCount yerine kullanılır.
int gridCols(BuildContext context, int phoneCount) {
  final w = context.screenWidth;
  if (w >= 1100) return phoneCount + 2;
  if (w >= 700) return phoneCount + 1;
  return phoneCount;
}

/// Kolon sayısı ekranla artan ama kart YÜKSEKLİĞİ sabit kalan grid.
/// childAspectRatio'lu grid'ler tablette kartları devleştirir (geniş hücre →
/// orantılı yükseklik) ve içerik küçük kalır; sabit [height] bunu önler.
class AdaptiveStatGrid extends StatelessWidget {
  const AdaptiveStatGrid({
    required this.children,
    required this.phoneCols,
    required this.height,
    this.spacing = 10,
    super.key,
  });

  final List<Widget> children;
  final int phoneCols;
  final double height;
  final double spacing;

  @override
  Widget build(BuildContext context) => GridView(
        shrinkWrap: true,
        physics: const NeverScrollableScrollPhysics(),
        gridDelegate: SliverGridDelegateWithFixedCrossAxisCount(
          crossAxisCount: gridCols(context, phoneCols),
          crossAxisSpacing: spacing,
          mainAxisSpacing: spacing,
          mainAxisExtent: height,
        ),
        children: children,
      );
}

/// İçeriği tablet genişliğinde okunur tutar: geniş ekranda ortalayıp
/// [maxWidth] ile sınırlar, telefonda etkisizdir.
class ResponsiveCenter extends StatelessWidget {
  const ResponsiveCenter({required this.child, this.maxWidth = 860, super.key});

  final Widget child;
  final double maxWidth;

  @override
  Widget build(BuildContext context) => Center(
        child: ConstrainedBox(
          constraints: BoxConstraints(maxWidth: maxWidth),
          child: child,
        ),
      );
}
