import 'package:beautyasist_mobile/core/theme/app_theme.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  testWidgets('BeautyAsist tema ve temel içerik yüklenir', (tester) async {
    await tester.pumpWidget(
      MaterialApp(
        theme: AppTheme.light,
        home: const Scaffold(body: Center(child: Text('BeautyAsist'))),
      ),
    );

    expect(find.text('BeautyAsist'), findsOneWidget);
    expect(find.byType(Scaffold), findsOneWidget);
  });
}
