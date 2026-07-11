import 'package:beautyassist_mobile/core/theme/app_theme.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  testWidgets('BeautyAssist tema ve temel içerik yüklenir', (tester) async {
    await tester.pumpWidget(
      MaterialApp(
        theme: AppTheme.light,
        home: const Scaffold(body: Center(child: Text('BeautyAssist'))),
      ),
    );

    expect(find.text('BeautyAssist'), findsOneWidget);
    expect(find.byType(Scaffold), findsOneWidget);
  });
}
