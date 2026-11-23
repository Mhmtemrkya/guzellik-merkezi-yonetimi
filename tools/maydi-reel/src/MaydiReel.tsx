import { AbsoluteFill, Easing, Img, interpolate, staticFile, useCurrentFrame, useVideoConfig } from 'remotion'
import { CalendarDays, ChartNoAxesCombined, Check, Sparkles, WalletCards, type LucideIcon } from 'lucide-react'

/**
 * BeautyAsist ana sayfasındaki kaydırmalı Maydi videosu (Frontend/public/landing/reel-scrub*.mp4).
 * 22 Kas 2026'daki 1600×900 videonun birebir yeniden kurulumu; 4K (3840×2160) için çizilir (kullanıcı isteği 23 Kas 2026:
 * "Maydi videosu aşırı kalitesiz, 4K yap"). Tasarım 1600×900 koordinatlarındadır, sahne `zoom` ile büyütülür: yazı ve şekiller
 * vektör olarak hedef çözünürlükte çizilir. Video 12 sn'de kusursuz döner (son kare = ilk kare): ikonlar 12 sn'de bir tur,
 * ışık lekeleri 12 sn periyotlu.
 */

const W = 1600
const H = 900
const CX = 1158
const CY = 450
const OUTER = 350
const INNER = 275
const EASE_OUT = Easing.bezier(0.23, 1, 0.32, 1)

const navy = '#1a2150'

type Tone = { from: string; to: string; glow: string }
const tones: Record<'pink' | 'green' | 'blue' | 'amber', Tone> = {
  pink: { from: '#f2609a', to: '#c42f6c', glow: 'rgba(236,72,140,.55)' },
  green: { from: '#2fd08f', to: '#0e9466', glow: 'rgba(16,185,129,.5)' },
  blue: { from: '#5b95f5', to: '#2b5fd6', glow: 'rgba(59,130,246,.5)' },
  amber: { from: '#f8b334', to: '#d9790b', glow: 'rgba(245,158,11,.5)' },
}

function Tile({ icon: Icon, tone, size }: { icon: LucideIcon; tone: Tone; size: number }) {
  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: size * 0.26,
        background: `linear-gradient(150deg, ${tone.from}, ${tone.to})`,
        boxShadow: `0 ${size * 0.14}px ${size * 0.4}px -${size * 0.08}px ${tone.glow}, inset 0 2px 0 rgba(255,255,255,.28)`,
        display: 'grid',
        placeItems: 'center',
        color: '#fff',
      }}
    >
      <Icon size={size * 0.44} strokeWidth={1.9} />
    </div>
  )
}

/** Kartın giriş/çıkış hareketi: saydamlık + küçük kayma + hafif ölçek (yalnız transform/opacity). */
function useCard(frame: number, fps: number, inAt: number) {
  const enter = interpolate(frame, [inAt * fps, (inAt + 0.6) * fps], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: EASE_OUT })
  const exit = interpolate(frame, [10.4 * fps, 11.2 * fps], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: EASE_OUT })
  const shown = enter * (1 - exit)
  return {
    opacity: shown,
    transform: `translateY(${(1 - enter) * 16 - exit * 8}px) scale(${0.96 + 0.04 * shown})`,
  }
}

const card: React.CSSProperties = {
  position: 'absolute',
  display: 'flex',
  alignItems: 'center',
  gap: 20,
  padding: '0 24px',
  borderRadius: 22,
  background: 'rgba(255,248,251,.95)',
  boxShadow: '0 22px 50px -18px rgba(8,10,40,.55), inset 0 1px 0 rgba(255,255,255,.9)',
  fontFamily: '"Segoe UI Variable Display", "Segoe UI", system-ui, sans-serif',
  transformOrigin: 'center',
}

export function MaydiReel() {
  const frame = useCurrentFrame()
  const { fps, durationInFrames, width } = useVideoConfig()
  const t = frame / fps
  const loop = frame / durationInFrames // 0 → 1, 12 sn
  const zoom = width / W

  // Işık lekeleri: 12 sn'de bir tur süzülür (döngü kusursuz).
  const drift = (phase: number, amp: number) => Math.sin(2 * Math.PI * (loop + phase)) * amp
  // Maydi: 3 sn periyotlu hafif süzülme.
  const bob = Math.sin((2 * Math.PI * t) / 3) * 7

  const orbit: { icon: LucideIcon; tone: Tone; start: number }[] = [
    { icon: Sparkles, tone: tones.amber, start: -90 },
    { icon: CalendarDays, tone: tones.pink, start: 0 },
    { icon: WalletCards, tone: tones.green, start: 90 },
    { icon: ChartNoAxesCombined, tone: tones.blue, start: 180 },
  ]

  const appointment = useCard(frame, fps, 0.8)
  const cash = useCard(frame, fps, 2.8)
  const chart = useCard(frame, fps, 4.8)
  const reply = useCard(frame, fps, 6.8)

  const amount = Math.round(interpolate(frame, [3 * fps, 5 * fps], [0, 4850], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: EASE_OUT }))
  const bars = [0.38, 0.62, 0.48, 0.82, 0.62]
  const grow = (i: number) => interpolate(frame, [(5.2 + i * 0.12) * fps, (5.9 + i * 0.12) * fps], [0, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp', easing: EASE_OUT })

  return (
    <AbsoluteFill style={{ backgroundColor: '#0f1838' }}>
      <div style={{ position: 'absolute', left: 0, top: 0, width: W, height: H, zoom, overflow: 'hidden' }}>
        {/* Zemin: soldan lacivert, sağda pembe / mor / turuncu ışık. */}
        <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(100deg, #0f1838 0%, #131c44 38%, #1d1d52 70%, #241c55 100%)' }} />
        <div style={{ position: 'absolute', width: 980, height: 980, left: 820 + drift(0, 30), top: -420 + drift(0.25, 24), borderRadius: '50%', background: 'radial-gradient(circle, rgba(214,72,140,.55), rgba(214,72,140,0) 65%)' }} />
        <div style={{ position: 'absolute', width: 900, height: 900, left: 560 + drift(0.5, 26), top: 380 + drift(0.75, 20), borderRadius: '50%', background: 'radial-gradient(circle, rgba(112,84,230,.5), rgba(112,84,230,0) 65%)' }} />
        <div style={{ position: 'absolute', width: 640, height: 640, left: 1230 + drift(0.3, 22), top: 380 + drift(0.6, 18), borderRadius: '50%', background: 'radial-gradient(circle, rgba(233,140,48,.34), rgba(233,140,48,0) 65%)' }} />
        <div style={{ position: 'absolute', width: 620, height: 620, left: 400 + drift(0.1, 20), top: -260, borderRadius: '50%', background: 'radial-gradient(circle, rgba(255,255,255,.07), rgba(255,255,255,0) 65%)' }} />

        {/* Halkalar */}
        {[OUTER, INNER].map((r) => (
          <div key={r} style={{ position: 'absolute', left: CX - r, top: CY - r, width: r * 2, height: r * 2, borderRadius: '50%', border: '1.5px solid rgba(255,255,255,.13)' }} />
        ))}

        {/* Dış halkada dönen ikonlar: 12 sn'de bir tur, saat yönünde. */}
        {orbit.map(({ icon, tone, start }) => {
          const a = ((start + loop * 360) * Math.PI) / 180
          const x = CX + Math.cos(a) * OUTER
          const y = CY + Math.sin(a) * OUTER
          const tilt = Math.sin(a * 2) * 7
          return (
            <div key={start} style={{ position: 'absolute', left: x - 39, top: y - 39, transform: `rotate(${tilt}deg)` }}>
              <Tile icon={icon} tone={tone} size={78} />
            </div>
          )
        })}

        {/* Maydi */}
        <Img
          src={staticFile('maydi-konusuyor.png')}
          style={{ position: 'absolute', width: 418, height: 418, left: 967, top: 220 + bob, filter: 'drop-shadow(0 24px 30px rgba(6,8,30,.45))' }}
        />

        {/* Randevu kartı */}
        <div style={{ ...card, left: 1275, top: 130, width: 232, height: 107, ...appointment }}>
          <Tile icon={CalendarDays} tone={tones.pink} size={62} />
          <div>
            <div style={{ color: navy, fontSize: 28, fontWeight: 800, letterSpacing: '-.01em', lineHeight: 1.1 }}>10:30</div>
            <div style={{ color: '#4f4a66', fontSize: 20, marginTop: 4 }}>Cilt bakımı</div>
          </div>
        </div>

        {/* Kasa kartı */}
        <div style={{ ...card, left: 842, top: 197, width: 264, height: 112, ...cash }}>
          <Tile icon={WalletCards} tone={tones.green} size={62} />
          <div>
            <div style={{ color: navy, fontSize: 31, fontWeight: 800, letterSpacing: '-.01em', lineHeight: 1.1, fontVariantNumeric: 'tabular-nums' }}>
              ₺{amount.toLocaleString('tr-TR')}
            </div>
            <div style={{ color: '#4f4a66', fontSize: 20, marginTop: 4 }}>Bugünkü kasa</div>
          </div>
        </div>

        {/* Rapor kartı */}
        <div style={{ ...card, left: 1267, top: 572, width: 279, height: 118, gap: 18, ...chart }}>
          <Tile icon={ChartNoAxesCombined} tone={tones.blue} size={62} />
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 10, height: 72 }}>
            {bars.map((h, i) => (
              <div
                key={i}
                style={{
                  width: 22,
                  height: 72 * h,
                  borderRadius: 6,
                  transformOrigin: 'bottom',
                  transform: `scaleY(${grow(i)})`,
                  background: i === 3 ? 'linear-gradient(180deg, #e0457b, #b02a62)' : 'linear-gradient(180deg, #7fb2ff, #4a86ec)',
                }}
              />
            ))}
          </div>
        </div>

        {/* WhatsApp yanıtı */}
        <div style={{ ...card, left: 858, top: 647, width: 320, height: 83, background: 'rgba(225,248,222,.96)', justifyContent: 'space-between', ...reply }}>
          <div style={{ color: navy, fontSize: 26, fontWeight: 800 }}>Evet, geleceğim</div>
          <div style={{ width: 42, height: 42, borderRadius: '50%', background: 'linear-gradient(150deg, #2fd08f, #0e9466)', display: 'grid', placeItems: 'center', color: '#fff' }}>
            <Check size={24} strokeWidth={3} />
          </div>
        </div>
      </div>
    </AbsoluteFill>
  )
}
