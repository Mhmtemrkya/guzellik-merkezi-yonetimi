import 'package:flutter_test/flutter_test.dart';
import 'package:beautyasist_mobile/features/branches/branch_fee.dart';

Map<String, dynamic> _impact({bool trial = false, int branches = 3, String? period = 'monthly', bool currentYearly = true}) => {
      'planName': 'BeautyAsist',
      'trial': trial,
      'branches': branches,
      'currentMonthly': {'total': 3600},
      'nextMonthly': {'total': 2400},
      'nextYearly': {'total': 24000},
      'period': period,
      if (currentYearly) 'currentYearly': {'total': 36000},
    };

void main() {
  test('şube başına olmayan pakette etki yok', () {
    expect(BranchRemovalView.from(null), isNull);
  });

  test('aylık pakette sonraki aylık tutar bir şube eksik (web branchRemoval paritesi)', () {
    final view = BranchRemovalView.from(_impact())!;
    expect(view.headline, 'Sonraki ödemenizden itibaren aylık ücretiniz');
    expect([view.current, view.next, view.branchesAfter], [3600, 2400, 2]);
    expect(view.note, contains('iade yapılmaz'));
  });

  test('yıllık pakette yıllık tutarlar; bugünkü yıllık yoksa aylığa düşülür', () {
    final yearly = BranchRemovalView.from(_impact(period: 'yearly'))!;
    expect([yearly.headline, yearly.current, yearly.next], ['Sonraki ödemenizden itibaren yıllık ücretiniz', 36000, 24000]);
    final old = BranchRemovalView.from(_impact(period: 'yearly', currentYearly: false))!;
    expect([old.current, old.next], [3600, 2400]);
  });

  test('denemede ücret alınmaz; tek şubeden aşağı düşülmez', () {
    final view = BranchRemovalView.from(_impact(trial: true, branches: 1))!;
    expect(view.headline, startsWith('Deneme süresince ücret alınmaz'));
    expect(view.note, 'Silinen şube ilk ödemenizde hesaba katılmaz.');
    expect(view.branchesAfter, 1);
  });
}
