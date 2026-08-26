/**
 * Tarayıcı oturumu üreten backend uçları. Bu liste BFF'nin refresh tokenı
 * JSON gövdesinden çıkarıp HttpOnly çereze taşıdığı güvenlik sınırıdır.
 */
const TOKEN_ISSUING_PATHS = new Set([
  '/api/auth/login',
  '/api/auth/login/verify',
  '/api/auth/refresh',
  '/api/auth/customer/otp/verify',
  '/api/public/signup/verify-phone',
])

export function isTokenIssuingPath(path: string): boolean {
  return TOKEN_ISSUING_PATHS.has(path)
}
