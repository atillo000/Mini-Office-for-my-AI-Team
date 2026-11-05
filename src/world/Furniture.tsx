import { useLayoutEffect, useMemo, useRef } from 'react';
import { RoundedBox } from '@react-three/drei';
import type { ThreeEvent } from '@react-three/fiber';
import { Color, InstancedMesh, Object3D } from 'three';
import { surfaceTexture, type Surface } from './materials';
export type V3 = [number, number, number];
export function Block({
  position = [0, 0, 0],
  size,
  color,
  radius = 0.045,
  rotation,
  onClick,
  surface,
  roughness = 0.65,
  metalness = 0,
  glow = false,
}: {
  position?: V3;
  size: V3;
  color: string;
  radius?: number;
  rotation?: V3;
  onClick?: (e: ThreeEvent<MouseEvent>) => void;
  surface?: Surface;
  roughness?: number;
  metalness?: number;
  glow?: boolean;
}) {
  const map = useMemo(() => (surface ? surfaceTexture(surface) : null), [surface]);
  return (
    <RoundedBox
      args={size}
      radius={Math.min(radius, ...size.map((v) => v / 3))}
      smoothness={2}
      bevelSegments={1}
      position={position}
      rotation={rotation}
      castShadow={!glow}
      receiveShadow
      onClick={onClick}
    >
      <meshStandardMaterial
        color={color}
        map={map}
        roughness={roughness}
        metalness={metalness}
        emissive={glow ? color : '#000000'}
        emissiveIntensity={glow ? 0.45 : 0}
      />
    </RoundedBox>
  );
}
export function Cylinder({
  position,
  radius,
  height,
  color,
  rotation,
  metalness = 0,
}: {
  position: V3;
  radius: number;
  height: number;
  color: string;
  rotation?: V3;
  metalness?: number;
}) {
  return (
    <mesh position={position} rotation={rotation} castShadow receiveShadow>
      <cylinderGeometry args={[radius, radius, height, 16]} />
      <meshStandardMaterial color={color} metalness={metalness} roughness={metalness ? 0.3 : 0.7} />
    </mesh>
  );
}
export function Plant({ x, z, scale = 1 }: { x: number; z: number; scale?: number }) {
  const leaves = useRef<InstancedMesh>(null);
  useLayoutEffect(() => {
    if (!leaves.current) return;
    const dummy = new Object3D();
    const color = new Color();
    for (let i = 0; i < 12; i++) {
      const angle = i * 2.399;
      const spread = 0.2 + (i % 3) * 0.08;
      dummy.position.set(Math.cos(angle) * spread, 0.85 + (i % 4) * 0.17, Math.sin(angle) * spread);
      dummy.rotation.set(Math.cos(angle) * 0.7, angle, Math.sin(angle) * 0.65);
      dummy.scale.set(0.13, 0.36, 0.07);
      dummy.updateMatrix();
      leaves.current.setMatrixAt(i, dummy.matrix);
      color.set(i % 3 === 0 ? '#28573b' : i % 2 ? '#447a46' : '#598c4b');
      leaves.current.setColorAt(i, color);
    }
    leaves.current.instanceMatrix.needsUpdate = true;
  }, []);
  return (
    <group position={[x, 0.065, z]} scale={scale}>
      <mesh position={[0, 0.26, 0]} castShadow>
        <cylinderGeometry args={[0.26, 0.2, 0.52, 24]} />
        <meshStandardMaterial color="#d5c3ad" roughness={0.85} />
      </mesh>
      <Cylinder position={[0, 0.52, 0]} radius={0.225} height={0.025} color="#453429" />
      <Cylinder position={[0, 0.94, 0]} radius={0.025} height={0.85} color="#5f6638" />
      <instancedMesh ref={leaves} args={[undefined, undefined, 12]} castShadow>
        <sphereGeometry args={[1, 10, 8]} />
        <meshStandardMaterial roughness={0.78} />
      </instancedMesh>
    </group>
  );
}
export function Chair({
  x,
  z,
  color = '#3e495a',
  rotation = 0,
  executive = false,
}: {
  x: number;
  z: number;
  color?: string;
  rotation?: number;
  executive?: boolean;
}) {
  return (
    <group position={[x, 0, z]} rotation={[0, rotation, 0]}>
      <Block
        position={[0, 0.66, 0]}
        size={[0.7, 0.14, 0.66]}
        color={color}
        surface="fabric"
        radius={0.09}
      />
      <Block
        position={[0, executive ? 1.15 : 1.06, 0.28]}
        size={[0.67, executive ? 0.93 : 0.72, 0.13]}
        color={color}
        surface="fabric"
        radius={0.12}
        rotation={[-0.09, 0, 0]}
      />
      <Block position={[0, 1.02, 0.36]} size={[0.15, 0.4, 0.07]} color="#30353b" />
      {[-0.39, 0.39].map((v) => (
        <group key={v}>
          <Block position={[v, 0.85, 0.05]} size={[0.065, 0.3, 0.08]} color="#343b44" />
          <Block position={[v, 1, -0.02]} size={[0.1, 0.065, 0.4]} color="#343b44" />
        </group>
      ))}
      <Cylinder
        position={[0, 0.36, 0]}
        radius={0.043}
        height={0.47}
        color="#8b929a"
        metalness={0.7}
      />
      {[0, 1, 2, 3, 4].map((i) => (
        <group key={i} rotation={[0, (i * Math.PI * 2) / 5, 0]}>
          <Block
            position={[0, 0.14, 0.22]}
            size={[0.065, 0.055, 0.48]}
            color="#545b65"
            metalness={0.5}
          />
          <Cylinder
            position={[0, 0.09, 0.43]}
            radius={0.075}
            height={0.065}
            rotation={[0, 0, Math.PI / 2]}
            color="#272b31"
          />
        </group>
      ))}
    </group>
  );
}
function Keyboard() {
  const keys = useRef<InstancedMesh>(null);
  useLayoutEffect(() => {
    const dummy = new Object3D();
    for (let i = 0; i < 40; i++) {
      dummy.position.set(-0.31 + (i % 10) * 0.068, 0, Math.floor(i / 10) * 0.061);
      dummy.updateMatrix();
      keys.current!.setMatrixAt(i, dummy.matrix);
    }
    keys.current!.instanceMatrix.needsUpdate = true;
  }, []);
  return (
    <group position={[0.04, 1.177, 0.26]}>
      <Block position={[0, -0.018, 0.09]} size={[0.77, 0.045, 0.3]} color="#333b45" radius={0.02} />
      <instancedMesh ref={keys} args={[undefined, undefined, 40]}>
        <boxGeometry args={[0.05, 0.015, 0.042]} />
        <meshStandardMaterial color="#d6dbe2" roughness={0.7} />
      </instancedMesh>
    </group>
  );
}
export function Mug({
  position = [0, 0, 0],
  color = '#f5f1e9',
}: {
  position?: V3;
  color?: string;
}) {
  return (
    <group position={position}>
      <mesh castShadow>
        <cylinderGeometry args={[0.095, 0.08, 0.2, 20]} />
        <meshStandardMaterial color={color} roughness={0.3} />
      </mesh>
      <Cylinder position={[0, 0.103, 0]} radius={0.075} height={0.008} color="#4c3020" />
      <mesh position={[0.105, 0.01, 0]} rotation={[0, Math.PI / 2, 0]}>
        <torusGeometry args={[0.065, 0.018, 6, 16]} />
        <meshStandardMaterial color={color} roughness={0.3} />
      </mesh>
    </group>
  );
}
export function TaskLamp({ x, z }: { x: number; z: number }) {
  return (
    <group position={[x, 1.15, z]}>
      <Cylinder position={[0, 0.025, 0]} radius={0.14} height={0.04} color="#303741" />
      <Block
        position={[0, 0.26, 0]}
        size={[0.035, 0.45, 0.035]}
        color="#414b58"
        rotation={[0, 0, -0.2]}
      />
      <Block
        position={[0.1, 0.48, 0]}
        size={[0.37, 0.07, 0.2]}
        color="#353e49"
        rotation={[0, 0, -0.08]}
      />
      <Block position={[0.1, 0.44, 0]} size={[0.28, 0.015, 0.15]} color="#fff0c9" glow />
    </group>
  );
}
export function Desk({
  x,
  z,
  rotation = 0,
  executive = false,
  variant = 0,
}: {
  x: number;
  z: number;
  rotation?: number;
  executive?: boolean;
  variant?: number;
}) {
  return (
    <group position={[x, 0, z]} rotation={[0, rotation, 0]}>
      <Block
        position={[0, 1.06, 0]}
        size={[executive ? 2.9 : 2.7, 0.13, 1.3]}
        color="#ffffff"
        surface={executive ? 'walnut' : 'oak'}
        radius={0.065}
      />
      {[-1.1, 1.1].map((v) => (
        <group key={v}>
          <Block position={[v, 0.55, 0]} size={[0.075, 1, 0.9]} color="#333d49" metalness={0.5} />
          <Block position={[v, 0.1, 0]} size={[0.12, 0.09, 1.02]} color="#333d49" />
        </group>
      ))}
      <Block
        position={[-0.82, 0.53, -0.02]}
        size={[0.48, 0.87, 0.79]}
        color={executive ? '#805a40' : '#e5e7eb'}
        surface={executive ? 'walnut' : undefined}
      />
      {[0.36, 0.64, 0.88].map((y) => (
        <Block
          key={y}
          position={[-0.82, y, 0.387]}
          size={[0.27, 0.025, 0.035]}
          color="#515862"
          metalness={0.6}
        />
      ))}
      <Block
        position={[0.2, 1.63, -0.3]}
        size={[1.2, 0.76, 0.075]}
        color="#252d38"
        radius={0.035}
      />
      <Block
        position={[0.2, 1.63, -0.254]}
        size={[1.1, 0.65, 0.012]}
        color={variant % 3 === 0 ? '#182d47' : variant % 3 === 1 ? '#223242' : '#273048'}
        glow
        radius={0.005}
      />
      {[0, 1, 2, 3, 4, 5].map((i) => (
        <Block
          key={i}
          position={[-0.13 + (i % 2) * 0.08, 1.85 - i * 0.082, -0.244]}
          size={[0.34 + (i % 3) * 0.11, 0.021, 0.006]}
          color={['#67b4ef', '#e6bf73', '#df91af', '#9fc9e9'][i % 4]}
          glow
          radius={0}
        />
      ))}
      <Block
        position={[0.2, 1.27, -0.3]}
        size={[0.07, 0.32, 0.065]}
        color="#3b444e"
        metalness={0.65}
      />
      <Block
        position={[0.2, 1.15, -0.27]}
        size={[0.48, 0.035, 0.29]}
        color="#414a55"
        metalness={0.5}
      />
      <Block
        position={[0.26, 1.135, 0.28]}
        size={[1.3, 0.014, 0.55]}
        color="#454b56"
        radius={0.04}
      />
      <Keyboard />
      <Block
        position={[0.78, 1.17, 0.35]}
        size={[0.13, 0.06, 0.21]}
        color="#e6e9ed"
        radius={0.05}
      />
      <Mug position={[-0.72, 1.25, 0.31]} color={variant % 2 ? '#b45d40' : '#f4f0e6'} />
      <TaskLamp x={-0.95} z={-0.37} />
      <Block
        position={[1.02, 1.145, -0.25]}
        size={[0.34, 0.045, 0.45]}
        color={variant % 2 ? '#a6503f' : '#35557b'}
      />
      <Block position={[1.02, 1.175, -0.24]} size={[0.27, 0.016, 0.36]} color="#eee6d8" />
      <Chair x={0} z={1} color={executive ? '#83553d' : '#3e495a'} executive={executive} />
    </group>
  );
}
export function Sofa({
  x,
  z,
  rotation = 0,
  color = '#b86139',
}: {
  x: number;
  z: number;
  rotation?: number;
  color?: string;
}) {
  return (
    <group position={[x, 0, z]} rotation={[0, rotation, 0]}>
      <Block
        position={[0, 0.4, 0]}
        size={[2.65, 0.48, 1.1]}
        color={color}
        surface="fabric"
        radius={0.15}
      />
      <Block
        position={[0, 0.93, -0.45]}
        size={[2.65, 0.75, 0.23]}
        color={color}
        surface="fabric"
        radius={0.12}
      />
      {[-1.22, 1.22].map((v) => (
        <Block
          key={v}
          position={[v, 0.76, 0]}
          size={[0.23, 0.53, 1.1]}
          color={color}
          surface="fabric"
          radius={0.1}
        />
      ))}
      {[-0.57, 0.57].map((v) => (
        <group key={v}>
          <Block
            position={[v, 0.67, 0.05]}
            size={[1.08, 0.2, 0.82]}
            color={color}
            surface="fabric"
            radius={0.1}
          />
          <Block
            position={[v, 1.08, -0.27]}
            size={[1.07, 0.53, 0.2]}
            color={color}
            surface="fabric"
            radius={0.1}
          />
        </group>
      ))}
      <Block
        position={[-0.84, 0.95, -0.11]}
        size={[0.39, 0.4, 0.15]}
        color="#e8ded0"
        surface="fabric"
        rotation={[0, 0, 0.2]}
        radius={0.08}
      />
      <Block
        position={[0.83, 0.95, -0.11]}
        size={[0.38, 0.4, 0.16]}
        color="#385773"
        surface="fabric"
        rotation={[0, 0, -0.16]}
        radius={0.08}
      />
      {[-1.05, 1.05].map((v) => (
        <Block key={v} position={[v, 0.13, 0]} size={[0.09, 0.25, 0.72]} color="#563f2e" />
      ))}
    </group>
  );
}
export function Shelf({ x, z, width = 2 }: { x: number; z: number; width?: number }) {
  return (
    <group position={[x, 0, z]}>
      <Block
        position={[0, 1.25, -0.23]}
        size={[width, 2.5, 0.055]}
        color="#503c2d"
        surface="walnut"
      />
      {[-1, 1].map((v) => (
        <Block
          key={v}
          position={[(v * width) / 2, 1.25, 0]}
          size={[0.09, 2.5, 0.47]}
          color="#ffffff"
          surface="oak"
        />
      ))}
      {[0.12, 0.87, 1.62, 2.5].map((y, i) => (
        <group key={y}>
          <Block position={[0, y, 0]} size={[width, 0.085, 0.52]} color="#ffffff" surface="oak" />
          {i < 3 &&
            Array.from({ length: Math.max(2, Math.floor(width * 3)) }, (_, j) => (
              <Block
                key={j}
                position={[-width / 2 + 0.22 + j * 0.2, y + 0.27, 0]}
                size={[0.13, 0.42 + (j % 3) * 0.04, 0.31]}
                color={['#304d72', '#a94937', '#d8b062', '#ded8cd', '#4a646d'][(i * 3 + j) % 5]}
                rotation={[0, 0, j === 0 ? 0.12 : 0]}
              />
            ))}
        </group>
      ))}
    </group>
  );
}
export function Laptop({ position, rotation = 0 }: { position: V3; rotation?: number }) {
  return (
    <group position={position} rotation={[0, rotation, 0]}>
      <Block position={[0, 0, 0]} size={[0.7, 0.035, 0.46]} color="#9da7b3" metalness={0.65} />
      <Block
        position={[0, 0.24, -0.19]}
        size={[0.7, 0.46, 0.035]}
        color="#3b4555"
        rotation={[-0.16, 0, 0]}
      />
      <Block
        position={[0, 0.24, -0.16]}
        size={[0.61, 0.36, 0.012]}
        color="#376497"
        glow
        rotation={[-0.16, 0, 0]}
      />
    </group>
  );
}
export function Pendant({ x, z, width = 1.6 }: { x: number; z: number; width?: number }) {
  return (
    <group position={[x, 0, z]}>
      <Cylinder position={[0, 3.63, 0]} radius={0.016} height={0.8} color="#3e444a" />
      <Block position={[0, 3.2, 0]} size={[width, 0.12, 0.22]} color="#303944" />
      <Block position={[0, 3.13, 0]} size={[width - 0.08, 0.025, 0.17]} color="#fff0cf" glow />
    </group>
  );
}
