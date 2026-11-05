import { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { Group } from 'three';
import { useOffice } from '../store';
import { Block, Chair, Cylinder, Laptop } from './Furniture';

export function CompactWorkstation({ x, z }: { x: number; z: number }) {
  return (
    <group>
      <Block position={[x, 1.06, z - 0.9]} size={[1.25, 0.1, 0.8]} color="#ffffff" surface="oak" />
      {[-0.5, 0.5].map((v) => (
        <Block key={v} position={[x + v, 0.55, z - 0.9]} size={[0.055, 1, 0.7]} color="#38485a" />
      ))}
      <Laptop position={[x, 1.14, z - 0.95]} />
      <Chair x={x} z={z} />
    </group>
  );
}
export function TreadmillBelt() {
  const stripes = useRef<Group>(null);
  useFrame((_, dt) => {
    const s = useOffice.getState();
    if (
      !s.speed ||
      !stripes.current ||
      !Object.values(s.runtime).some(
        (r) => r.resourceId === 'gym-treadmill' && r.state === 'EXERCISING',
      )
    )
      return;
    for (const stripe of stripes.current.children) {
      stripe.position.z += Math.min(dt, 0.05) * 1.4 * s.speed;
      if (stripe.position.z > 1.1) stripe.position.z = -1.1;
    }
  });
  return (
    <group ref={stripes} position={[10.5, 0.374, -6.55]}>
      {Array.from({ length: 9 }, (_, i) => (
        <mesh key={i} position={[0, 0, -1.04 + i * 0.26]}>
          <boxGeometry args={[0.9, 0.006, 0.018]} />
          <meshStandardMaterial color="#77828e" roughness={0.9} />
        </mesh>
      ))}
    </group>
  );
}
export function CoffeeService() {
  const steam = useRef<Group>(null);
  useFrame((_, dt) => {
    const speed = useOffice.getState().speed;
    if (!steam.current || !speed) return;
    for (const puff of steam.current.children) {
      puff.position.y += Math.min(dt, 0.05) * 0.12 * speed;
      if (puff.position.y > 0.35) puff.position.y = 0;
    }
  });
  const busy = useOffice((s) =>
    Object.values(s.runtime).some(
      (r) => r.resourceId === 'coffee-machine' && r.interaction === 'coffee',
    ),
  );
  return (
    <group>
      <mesh position={[6.52, 1.95, -7.74]}>
        <sphereGeometry args={[0.025, 8, 8]} />
        <meshBasicMaterial color={busy ? '#e5b269' : '#87aac3'} />
      </mesh>
      {busy && (
        <group ref={steam} position={[6.3, 1.88, -7.69]}>
          {[0, 1, 2].map((i) => (
            <mesh key={i} position={[i * 0.012, i * 0.12, 0]} scale={[0.8, 1.6, 0.8]}>
              <sphereGeometry args={[0.035, 8, 8]} />
              <meshBasicMaterial color="#eee9df" transparent opacity={0.12} depthWrite={false} />
            </mesh>
          ))}
        </group>
      )}
    </group>
  );
}
export function DiningSettings() {
  return (
    <>
      {[
        [4.55, -4.2],
        [5.45, -4.2],
        [5, -3.75],
      ].map(([x, z], i) => (
        <group key={i}>
          <Cylinder position={[x, 1.015, z]} radius={0.18} height={0.015} color="#eeeae2" />
          <Block position={[x, 1.045, z]} size={[0.16, 0.035, 0.12]} color="#b8814a" />
        </group>
      ))}
    </>
  );
}
