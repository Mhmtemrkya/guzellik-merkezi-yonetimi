'use client'

import { Canvas, useFrame } from '@react-three/fiber'
import { Float, Sparkles, MeshDistortMaterial } from '@react-three/drei'
import { useMemo, useRef } from 'react'
import * as THREE from 'three'

/**
 * VolumetricBeam — vertical beam of light, additive and translucent.
 * Anchors the CTA visually like a stage spotlight.
 */
function VolumetricBeam() {
  const group = useRef<THREE.Group>(null)
  useFrame(({ clock }) => {
    if (!group.current) return
    const t = clock.getElapsedTime()
    group.current.rotation.y = Math.sin(t * 0.2) * 0.15
    group.current.scale.y = 1 + Math.sin(t * 1.4) * 0.04
  })
  return (
    <group ref={group} position={[0, 0, -2]}>
      {[1.4, 1.0, 0.7, 0.45].map((r, i) => (
        <mesh key={i} rotation={[0, 0, 0]}>
          <coneGeometry args={[r, 9, 32, 1, true]} />
          <meshBasicMaterial
            color={i % 2 === 0 ? '#f0aac2' : '#ffd3df'}
            transparent
            opacity={0.08 + i * 0.05}
            blending={THREE.AdditiveBlending}
            side={THREE.DoubleSide}
            depthWrite={false}
          />
        </mesh>
      ))}
    </group>
  )
}

/**
 * HoloRings — concentric rings rotating around the central token.
 */
function HoloRings() {
  const group = useRef<THREE.Group>(null)
  useFrame(({ clock }) => {
    if (!group.current) return
    const t = clock.getElapsedTime()
    group.current.rotation.z = t * 0.1
    group.current.rotation.x = Math.sin(t * 0.3) * 0.4
  })
  return (
    <group ref={group} position={[0, 0, -1]}>
      {[1.4, 1.85, 2.35].map((r, i) => (
        <mesh key={i} rotation={[Math.PI / 2 + i * 0.2, 0, i * 0.4]}>
          <torusGeometry args={[r, 0.012, 16, 96]} />
          <meshStandardMaterial
            color="#fff4f8"
            emissive={i === 1 ? '#f0aac2' : '#ffd3df'}
            emissiveIntensity={0.8}
            transparent
            opacity={0.75}
          />
        </mesh>
      ))}
    </group>
  )
}

/**
 * CentralToken — small distort orb at the center of the rings.
 */
function CentralToken() {
  const mesh = useRef<THREE.Mesh>(null)
  useFrame(({ clock }) => {
    if (!mesh.current) return
    const t = clock.getElapsedTime()
    mesh.current.rotation.x = t * 0.3
    mesh.current.rotation.y = t * 0.4
  })
  return (
    <Float speed={1.4} rotationIntensity={0.5} floatIntensity={0.5}>
      <mesh ref={mesh} position={[0, 0, -1]}>
        <icosahedronGeometry args={[0.65, 4]} />
        <MeshDistortMaterial
          color="#fff4f8"
          emissive="#f0aac2"
          emissiveIntensity={0.85}
          roughness={0.1}
          metalness={0.6}
          distort={0.42}
          speed={2.0}
        />
      </mesh>
    </Float>
  )
}

function ParticleBurst() {
  const ref = useRef<THREE.Points>(null)
  const count = 700
  const positions = useMemo(() => {
    const arr = new Float32Array(count * 3)
    for (let i = 0; i < count; i += 1) {
      const r = 4 + Math.random() * 6
      const theta = Math.random() * Math.PI * 2
      const y = (Math.random() - 0.5) * 6
      arr[i * 3] = r * Math.cos(theta)
      arr[i * 3 + 1] = y
      arr[i * 3 + 2] = r * Math.sin(theta) - 2
    }
    return arr
  }, [count])

  useFrame(({ clock }) => {
    if (!ref.current) return
    ref.current.rotation.y = clock.getElapsedTime() * 0.04
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
        color="#ffd3df"
        blending={THREE.AdditiveBlending}
      />
    </points>
  )
}

export default function CtaScene() {
  return (
    <Canvas
      dpr={[1, 1.6]}
      gl={{ antialias: true, alpha: true, powerPreference: 'high-performance' }}
      camera={{ position: [0, 0, 6], fov: 50 }}
      className="pointer-events-none"
    >
      <ambientLight intensity={0.55} color="#ffd3df" />
      <pointLight position={[3, 2, 4]} intensity={1.3} color="#f0aac2" />
      <pointLight position={[-3, -2, 3]} intensity={0.8} color="#fff4f8" />
      <fog attach="fog" args={['#160b12', 6, 16]} />
      <VolumetricBeam />
      <HoloRings />
      <CentralToken />
      <ParticleBurst />
      <Sparkles count={140} scale={[14, 10, 6]} size={3} speed={0.5} color="#fff4f8" opacity={0.7} />
    </Canvas>
  )
}
