import 'package:beautyasist_mobile/core/auth/otp_message.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  test('demo instructions replace all delivery claims', () {
    const demo = 'Demo: No email, SMS or WhatsApp is sent. Enter 424242.';
    expect(customerOtpMessage({
      'isDemo': true,
      'message': demo,
      'hint': 'Kod e-posta adresinize gönderildi.',
    }), demo);
  });

  test('registration displays server delivery instructions', () {
    expect(customerOtpMessage({
      'message': 'Kod kayıt e-postanıza gönderildi.',
      'hint': 'Spam klasörünü kontrol edin.',
    }, registration: true),
        'Kod kayıt e-postanıza gönderildi. Spam klasörünü kontrol edin.');
  });

  test('ordinary responses never introduce a fixed demo code', () {
    final text = customerOtpMessage({}, registration: true);
    expect(text, contains('e-posta'));
    expect(text, isNot(contains('424242')));
  });
}
