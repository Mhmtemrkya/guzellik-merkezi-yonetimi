'use client'

import { Canvas, useFrame } from '@react-three/fiber'
import { Float, Sparkles } from '@react-three/drei'
import { useMemo, useRef } from 'react'
import * as THREE from 'three'

interface DustProps {
  count?: number
  color?: string
  radius?: number
}

function Dust({ count = 1200, color = '#ffd3df', radius = 14 }: DustProps) {
  const ref = useRef<THREE.Points>(null)
  const { positions } = useMemo(() => {
    const positions = new Float32Array(count * 3)
    for (let i = 0; i < count; i += 1) {
      const r = radius * Math.pow(Math.random(), 0.6) + 2
      const theta = Math.random() * Math.PI * 2
      const y = (Math.random() - 0.5) * radius * 1.4
      positions[i * 3] = r * Math.cos(theta)
      positions[i * 3 + 1] = y
      positions[i * 3 + 2] = r * Math.sin(theta) - 4
    }
    return { positions }
  }, [count, radius])

  useFrame((state) => {
    if (!ref.current) return
    const t = state.clock.getElapsedTime()
    ref.current.rotation.y = t * 0.05
    ref.current.rotation.x = Math.sin(t * 0.12) * 0.08
  })

  return (
    <points ref={ref}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[positions, 3]} />
      </bufferGeometry>
      <pointsMaterial
        size={0.05}
        sizeAttenuation
        depthWrite={false}
        transparent
        opacity={0.85}
        color={color}
        blending={THREE.AdditiveBlending}
      />
    </points>
  )
}

function FloatingOrbs() {
  const group = useRef<THREE.Group>(null)
  useFrame((state) => {
    if (!group.current) return
    const t = state.clock.getElapsedTime()
    group.current.rotation.y = t * 0.06
  })
  return (
    <group ref={group}>
      {Array.from({ length: 10 }).map((_, i) => {
        const angle = (i / 10) * Math.PI * 2
        const radius = 5 + (i % 3) * 0.8
        const y = ((i % 5) - 2) * 0.85
        const c = i % 3 === 0 ? '#f0aac2' : i % 3 === 1 ? '#ffd3df' : '#fff4f8'
        return (
          <Float key={i} speed={1 + (i % 4) * 0.3} rotationIntensity={0.4} floatIntensity={1.3}>
            <mesh position={[Math.cos(angle) * radius, y, Math.sin(angle) * radius - 3]}>
              <icosahedronGeometry args={[0.28 + (i % 3) * 0.08, 1]} />
              <meshStandardMaterial
                color={c}
                emissive={c}
                emissiveIntensity={0.65}
                roughness={0.2}
                metalness={0.7}
                transparent
                opacity={0.92}
              />
            </mesh>
          </Float>
        )
      })}
    </group>
  )
}

function CentralOrb() {
  const ref = useRef<THREE.Mesh>(null)
  useFrame((state) => {
    if (!ref.current) return
    const t = state.clock.getElapsedTime()
    ref.current.rotation.y = t * 0.18
    ref.current.rotation.x = Math.sin(t * 0.4) * 0.1
    ref.current.position.y = Math.sin(t * 0.5) * 0.2
  })
  return (
    <Float speed={1} rotationIntensity={0.3} floatIntensity={0.6}>
      <mesh ref={ref} position={[0, 0, -1]}>
        <icosahedronGeometry args={[1.6, 1]} />
        <meshPhysicalMaterial
          color="#fff4f8"
          emissive="#f0aac2"
          emissiveIntensity={0.4}
          roughness={0.15}
          metalness={0.55}
          transmission={0.45}
          thickness={1.5}
          ior={1.4}
          clearcoat={1}
          clearcoatRoughness={0.1}
        />
      </mesh>
    </Float>
  )
}

interface ParticleFieldProps {
  variant?: 'hero' | string
}

export default function ParticleField({ variant = 'hero' }: ParticleFieldProps) {
  return (
    <Canvas
      dpr={[1, 1.5]}
      gl={{ antialias: true, alpha: true, powerPreference: 'high-performance' }}
      camera={{ position: [0, 0, 8], fov: 50 }}
      className="pointer-events-none"
    >
      <ambientLight intensity={0.6} color="#ffd3df" />
      <pointLight position={[6, 4, 5]} intensity={1.4} color="#f0aac2" />
      <pointLight position={[-6, -2, 3]} intensity={0.85} color="#fff4f8" />
      <fog attach="fog" args={['#160b12', 9, 22]} />
      <Dust />
      <FloatingOrbs />
      {variant === 'hero' && <CentralOrb />}
      <Sparkles count={120} scale={[16, 10, 10]} size={3} speed={0.4} color="#fff4f8" opacity={0.6} />
    </Canvas>
  )
}
