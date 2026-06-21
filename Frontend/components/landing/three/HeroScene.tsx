'use client'

import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { Float, Sparkles, MeshDistortMaterial } from '@react-three/drei'
import { useMemo, useRef } from 'react'
import * as THREE from 'three'

type Vec3 = [number, number, number]

/**
 * WaveGrid — animated wireframe plane that gently undulates.
 * Each vertex is offset on Z by a layered sine field tied to time.
 */
function WaveGrid() {
  const mesh = useRef<THREE.Mesh>(null)
  const geom = useMemo(() => new THREE.PlaneGeometry(28, 14, 90, 50), [])
  const positions = useMemo(() => {
    const original = (geom.attributes.position.array as Float32Array).slice()
    return original
  }, [geom])

  useFrame(({ clock }) => {
    if (!mesh.current) return
    const t = clock.getElapsedTime()
    const pos = mesh.current.geometry.attributes.position
    for (let i = 0; i < pos.count; i += 1) {
      const x = positions[i * 3] ?? 0
      const y = positions[i * 3 + 1] ?? 0
      const z =
        Math.sin(x * 0.4 + t * 0.6) * 0.35 +
        Math.cos(y * 0.6 + t * 0.5) * 0.28 +
        Math.sin((x + y) * 0.18 + t * 0.4) * 0.18
      pos.setZ(i, z)
    }
    pos.needsUpdate = true
    mesh.current.rotation.z = Math.sin(t * 0.05) * 0.04
  })

  return (
    <mesh ref={mesh} geometry={geom} position={[0, -3.4, -2]} rotation={[-Math.PI / 2.6, 0, 0]}>
      <meshBasicMaterial color="#f0aac2" wireframe transparent opacity={0.45} />
    </mesh>
  )
}

/**
 * GlassPanel — a thin transparent rectangle that floats in 3D.
 * Reads like a dashboard card pulled out of the page.
 */
interface GlassPanelProps {
  position: Vec3
  rotation: Vec3
  width: number
  height: number
  color: string
  accent: string
}

function GlassPanel({ position, rotation, width, height, color, accent }: GlassPanelProps) {
  const mesh = useRef<THREE.Group>(null)
  useFrame(({ clock }) => {
    if (!mesh.current) return
    const t = clock.getElapsedTime()
    mesh.current.rotation.y = rotation[1] + Math.sin(t * 0.4) * 0.06
    mesh.current.position.y = position[1] + Math.sin(t * 0.5 + position[0]) * 0.08
  })
  return (
    <group ref={mesh} position={position} rotation={rotation}>
      <mesh>
        <boxGeometry args={[width, height, 0.04]} />
        <meshPhysicalMaterial
          color={color}
          transmission={0.85}
          thickness={0.6}
          roughness={0.18}
          metalness={0.1}
          ior={1.3}
          clearcoat={0.9}
          clearcoatRoughness={0.12}
          transparent
          opacity={0.5}
        />
      </mesh>
      {/* accent bar */}
      <mesh position={[-width / 2 + 0.18, height / 2 - 0.18, 0.03]}>
        <boxGeometry args={[0.45, 0.06, 0.01]} />
        <meshStandardMaterial color={accent} emissive={accent} emissiveIntensity={1} />
      </mesh>
      {/* small inner row */}
      <mesh position={[0, 0, 0.025]}>
        <boxGeometry args={[width * 0.78, 0.04, 0.005]} />
        <meshStandardMaterial color="#fff4f8" emissive="#ffd3df" emissiveIntensity={0.4} transparent opacity={0.6} />
      </mesh>
      <mesh position={[0, -0.25, 0.025]}>
        <boxGeometry args={[width * 0.55, 0.04, 0.005]} />
        <meshStandardMaterial color="#fff4f8" emissive="#ffd3df" emissiveIntensity={0.3} transparent opacity={0.45} />
      </mesh>
    </group>
  )
}

/**
 * IridescentOrb — replaces the previous solid orb with a distorting
 * physical sphere. Sits behind the headline as a subtle anchor.
 */
function IridescentOrb() {
  const mesh = useRef<THREE.Mesh>(null)
  useFrame(({ clock }) => {
    if (!mesh.current) return
    const t = clock.getElapsedTime()
    mesh.current.rotation.x = t * 0.1
    mesh.current.rotation.y = t * 0.15
  })
  return (
    <Float speed={1} rotationIntensity={0.3} floatIntensity={0.7}>
      <mesh ref={mesh} position={[0, 0.2, -3.5]}>
        <icosahedronGeometry args={[1.6, 4]} />
        <MeshDistortMaterial
          color="#fff4f8"
          emissive="#f0aac2"
          emissiveIntensity={0.45}
          roughness={0.18}
          metalness={0.4}
          distort={0.4}
          speed={1.6}
          transparent
          opacity={0.92}
        />
      </mesh>
    </Float>
  )
}

function Beams() {
  return (
    <group position={[0, 0, -6]}>
      {[-3.2, 0, 3.2].map((x, i) => (
        <mesh key={i} position={[x, 0, 0]} rotation={[0, 0, Math.PI / 2]}>
          <cylinderGeometry args={[0.02, 0.02, 18, 12]} />
          <meshBasicMaterial color="#f0aac2" transparent opacity={0.18} />
        </mesh>
      ))}
    </group>
  )
}

/**
 * Cursor-reactive camera dolly — small parallax that follows the mouse.
 */
function CameraParallax() {
  const { camera } = useThree()
  const target = useRef({ x: 0, y: 0 })
  useFrame(({ mouse }) => {
    target.current.x += (mouse.x * 0.35 - target.current.x) * 0.05
    target.current.y += (mouse.y * 0.2 - target.current.y) * 0.05
    camera.position.x = target.current.x
    camera.position.y = target.current.y
    camera.lookAt(0, 0, 0)
  })
  return null
}

export default function HeroScene() {
  return (
    <Canvas
      dpr={[1, 1.6]}
      gl={{ antialias: true, alpha: true, powerPreference: 'high-performance' }}
      camera={{ position: [0, 0, 6.5], fov: 50 }}
      className="pointer-events-none"
    >
      <ambientLight intensity={0.55} color="#ffd3df" />
      <pointLight position={[5, 4, 4]} intensity={1.4} color="#f0aac2" />
      <pointLight position={[-5, -2, 3]} intensity={0.8} color="#fff4f8" />
      <fog attach="fog" args={['#160b12', 7, 18]} />
      <CameraParallax />
      <Beams />
      <WaveGrid />
      <IridescentOrb />
      <GlassPanel
        position={[-3.4, 1.3, -1.5]}
        rotation={[0, 0.32, -0.12]}
        width={2.4}
        height={1.4}
        color="#3a1a2a"
        accent="#f0aac2"
      />
      <GlassPanel
        position={[3.4, -0.9, -1.5]}
        rotation={[0, -0.36, 0.1]}
        width={2.4}
        height={1.4}
        color="#2a1320"
        accent="#ffd3df"
      />
      <GlassPanel
        position={[-2.6, -1.7, -0.5]}
        rotation={[0, 0.22, 0.08]}
        width={1.6}
        height={0.9}
        color="#2a1320"
        accent="#ffd3df"
      />
      <GlassPanel
        position={[2.8, 1.7, -0.5]}
        rotation={[0, -0.28, -0.06]}
        width={1.6}
        height={0.9}
        color="#3a1a2a"
        accent="#f0aac2"
      />
      <Sparkles count={140} scale={[16, 10, 8]} size={3} speed={0.4} color="#fff4f8" opacity={0.7} />
    </Canvas>
  )
}
