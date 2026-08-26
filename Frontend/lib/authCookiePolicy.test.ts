import { describe, expect, it } from 'vitest'
import { isTokenIssuingPath } from './authCookiePolicy'

describe('isTokenIssuingPath', () => {
  it.each([
    '/api/auth/login',
    '/api/auth/login/verify',
    '/api/auth/refresh',
    '/api/auth/customer/otp/verify',
    '/api/public/signup/verify-phone',
  ])('%s yanıtındaki refresh tokenı HttpOnly çereze taşır', (path) => {
    expect(isTokenIssuingPath(path)).toBe(true)
  })

  it('oturum üretmeyen uçları token üreten uç saymaz', () => {
    expect(isTokenIssuingPath('/api/auth/login/scope')).toBe(false)
  })
})
