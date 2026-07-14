import type { ApiEnvelope } from './types'
import { getCustomerSession, PortalApiError } from './customerPortalApi'

// Herkese açık salon vitrini istemcisi (/api/public/salons) — auth gerektirmez.
// Yorum gönderme müşteri oturumu ister (customerPortalApi ile aynı token deposu).
const API_BASE_URL: string = (process.env.NEXT_PUBLIC_API_BASE_URL || '/api/proxy').replace(/\/$/, '')

export interface PublicSalonListItem {
  slug: string
  name: string
  city: string | null
  coverImage: string | null
  logo: string | null
  salonAvg: number | null
  staffAvg: number | null
  reviewCount: number
  categories: string[]
  isFeatured?: boolean
}

export interface PublicSalonList {
  items: PublicSalonListItem[]
  total: number
  page: number
  pageSize: number
}

export interface PublicSalonService {
  id: string
  name: string
  durationMinutes: number
  price: number
  branchId: string | null
}

export interface PublicSalonServiceGroup {
  category: string
  items: PublicSalonService[]
}

export interface PublicSalonStaff {
  id: string
  fullName: string
  title: string
  photoUrl: string | null
  avgStars: number | null
  ratingCount: number
  branchId: string | null
}

export interface PublicSalonBranch {
  id: string
  name: string
  city: string | null
}

export interface PublicSalonAggregates {
  salonAvg: number | null
  staffAvg: number | null
  reviewCount: number
  /** 1..5 yıldız adetleri (indeks 0 → 1 yıldız). */
  starCounts: number[]
}

export interface PublicSalonDetail {
  slug: string
  name: string
  logo: string | null
  isFeatured?: boolean
  description: string | null
  address: string | null
  city: string | null
  instagram: string | null
  publicEmail: string | null
  publicPhone: string | null
  workingHoursText: string | null
  mapUrl: string | null
  sliderPhotos: string[]
  servicePhotos: string[]
  services: PublicSalonServiceGroup[]
  staff: PublicSalonStaff[]
  aggregates: PublicSalonAggregates
  branches: PublicSalonBranch[]
}

export interface PublicSalonReview {
  maskedName: string
  submittedAtUtc: string
  comment: string | null
  staffStars: number
  salonStars: number | null
  staffName: string
  serviceName: string | null
  branchName: string | null
}

export interface PublicSalonReviewList {
  items: PublicSalonReview[]
  total: number
  page: number
  pageSize: number
  /** Seçili şube filtresine göre hesaplanmış ortalama + yıldız dağılımı. */
  aggregates: PublicSalonAggregates | null
}

async function publicRequest<T>(path: string, options: { method?: string; body?: unknown; auth?: boolean } = {}): Promise<T> {
  const { method = 'GET', body, auth = false } = options
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (auth) {
    const session = getCustomerSession()
    if (!session?.accessToken) throw new PortalApiError('Oturum bulunamadı.', 401)
    headers.Authorization = `Bearer ${session.accessToken}`
  }
  const response = await fetch(`${API_BASE_URL}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  let envelope: ApiEnvelope<T> | null = null
  try {
    envelope = (await response.json()) as ApiEnvelope<T>
  } catch {
    /* gövdesiz yanıt */
  }
  if (!response.ok || !envelope?.success) {
    const message = envelope?.error?.message || 'İşlem tamamlanamadı. Lütfen tekrar deneyin.'
    throw new PortalApiError(message, response.status)
  }
  return envelope.data as T
}

export function listPublicSalons(params: { q?: string; city?: string; category?: string; page?: number; pageSize?: number } = {}): Promise<PublicSalonList> {
  const query = new URLSearchParams()
  if (params.q) query.set('q', params.q)
  if (params.city) query.set('city', params.city)
  if (params.category) query.set('category', params.category)
  if (params.page) query.set('page', String(params.page))
  if (params.pageSize) query.set('pageSize', String(params.pageSize))
  const qs = query.toString()
  return publicRequest<PublicSalonList>(`/api/public/salons/${qs ? `?${qs}` : ''}`)
}

export interface PublicSalonFacets {
  categories: string[]
  cities: string[]
}

/** Filtre seçenekleri — yayındaki kurumların gerçek hizmet kategorileri ve şehirleri. */
export function getPublicSalonFacets(): Promise<PublicSalonFacets> {
  return publicRequest<PublicSalonFacets>('/api/public/salons/facets')
}

export function getPublicSalon(slug: string): Promise<PublicSalonDetail> {
  return publicRequest<PublicSalonDetail>(`/api/public/salons/${encodeURIComponent(slug)}`)
}

export function getPublicSalonReviews(
  slug: string,
  page = 1,
  pageSize = 10,
  branchId?: string | null,
): Promise<PublicSalonReviewList> {
  const query = new URLSearchParams({ page: String(page), pageSize: String(pageSize) })
  if (branchId) query.set('branchId', branchId)
  return publicRequest<PublicSalonReviewList>(
    `/api/public/salons/${encodeURIComponent(slug)}/reviews?${query.toString()}`,
  )
}

/** Girişli müşterinin manuel yorumu — o salonda tamamlanmış randevusu olmalı. */
export function submitSalonReview(
  slug: string,
  input: { staffStars: number; salonStars: number; comment: string | null },
): Promise<PublicSalonReview> {
  return publicRequest<PublicSalonReview>(`/api/customer/salons/${encodeURIComponent(slug)}/review`, {
    method: 'POST',
    auth: true,
    body: input,
  })
}
