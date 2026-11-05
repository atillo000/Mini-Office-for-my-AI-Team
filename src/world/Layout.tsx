import { useContext, useMemo } from 'react';
import { Html } from '@react-three/drei';
import { CanvasTexture, SRGBColorSpace } from 'three';
import { useOffice } from '../store';
import { rooms } from '../../shared/seed';
import type { RoomId } from '../../shared/types';
import { conferenceSeats } from '../../shared/office-seating';
import {
  Block,
  Chair,
  Cylinder,
  Desk,
  Laptop,
  Mug,
  Pendant,
  Plant,
  Shelf,
  Sofa,
  type V3,
} from './Furniture';
import { LabelPortal } from './labels';
import { surfaceTexture, type Surface } from './materials';
import { CoffeeService, CompactWorkstation, DiningSettings, TreadmillBelt } from './Interactions';

function Floor({
  id,
  x,
  z,
  width,
  depth,
  surface,
  color = '#ffffff',
}: {
  id: RoomId;
  x: number;
  z: number;
  width: number;
  depth: number;
  surface: Surface;
  color?: string;
}) {
  const focus = useOffice((s) => s.focus);
  const active = useOffice((s) => s.room === id);
  const labels = useOffice((s) => s.labels);
  const portal = useContext(LabelPortal);
  const map = useMemo(() => surfaceTexture(surface, width / 4, depth / 4), [surface, width, depth]);
  return (
    <group>
      <mesh
        position={[x, 0.065, z]}
        rotation={[-Math.PI / 2, 0, 0]}
        receiveShadow
        onClick={(e) => {
          e.stopPropagation();
          focus(id);
        }}
      >
        <planeGeometry args={[width, depth]} />
        <meshStandardMaterial
          color={color}
          map={map}
          roughness={surface === 'stone' ? 0.5 : 0.92}
        />
      </mesh>
      {active && (
        <>
          <Block
            position={[x, 0.085, z - depth / 2]}
            size={[width, 0.025, 0.045]}
            color="#779bc7"
          />
          <Block
            position={[x - width / 2, 0.085, z]}
            size={[0.045, 0.025, depth]}
            color="#779bc7"
          />
          <Block
            position={[x, 0.085, z + depth / 2]}
            size={[width, 0.025, 0.045]}
            color="#779bc7"
          />
          <Block
            position={[x + width / 2, 0.085, z]}
            size={[0.045, 0.025, depth]}
            color="#779bc7"
          />
        </>
      )}
      {labels && (
        <Html
          portal={portal}
          center
          position={[x, 0.1, z + depth / 2 - 0.4]}
          zIndexRange={[1, 0]}
          style={{ pointerEvents: 'none' }}
        >
          <div className={`room-tag ${active ? 'active' : ''}`}>
            {rooms.find((r) => r.id === id)?.name}
          </div>
        </Html>
      )}
    </group>
  );
}
function Glass({
  x,
  z,
  width,
  turn = false,
}: {
  x: number;
  z: number;
  width: number;
  turn?: boolean;
}) {
  return (
    <group position={[x, 0, z]} rotation={[0, turn ? Math.PI / 2 : 0, 0]}>
      <mesh position={[0, 1.55, 0]}>
        <boxGeometry args={[width, 2.95, 0.025]} />
        <meshPhysicalMaterial
          color="#b8d5ec"
          transparent
          opacity={0.11}
          roughness={0.07}
          metalness={0.18}
          depthWrite={false}
        />
      </mesh>
      {[-width / 2, width / 2].map((v) => (
        <Block
          key={v}
          position={[v, 1.55, 0]}
          size={[0.045, 3.1, 0.065]}
          color="#46505b"
          metalness={0.5}
        />
      ))}
      <Block position={[0, 3.06, 0]} size={[width, 0.045, 0.055]} color="#46505b" metalness={0.5} />
      <Block position={[0, 0.115, 0]} size={[width, 0.085, 0.06]} color="#68717c" />
      <Block
        position={[0, 1.12, 0.025]}
        size={[width, 0.055, 0.01]}
        color="#ffffff"
        roughness={0.15}
      />
    </group>
  );
}
function Sign({
  position,
  title,
  subtitle,
  width = 2.4,
  height = 0.8,
  background = '#243e5c',
  rotation = [0, 0, 0],
}: {
  position: V3;
  title: string;
  subtitle?: string;
  width?: number;
  height?: number;
  background?: string;
  rotation?: V3;
}) {
  const map = useMemo(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 768;
    canvas.height = 256;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = background;
    ctx.fillRect(0, 0, 768, 256);
    ctx.fillStyle = '#faf9f6';
    ctx.textAlign = 'center';
    ctx.font = '500 66px Segoe UI, Arial';
    ctx.fillText(title, 384, subtitle ? 119 : 153);
    if (subtitle) {
      ctx.fillStyle = '#adbdd0';
      ctx.font = '25px Segoe UI, Arial';
      ctx.fillText(subtitle, 384, 183);
    }
    const texture = new CanvasTexture(canvas);
    texture.colorSpace = SRGBColorSpace;
    return texture;
  }, [title, subtitle, background]);
  return (
    <mesh position={position} rotation={rotation}>
      <planeGeometry args={[width, height]} />
      <meshStandardMaterial map={map} roughness={0.65} />
    </mesh>
  );
}
function Architecture() {
  const night = useOffice((s) => s.night);
  return (
    <>
      <Block position={[0, -0.38, 0]} size={[27, 0.7, 19]} color="#9c978d" radius={0.16} />
      <Block position={[0, -0.06, 0]} size={[26.75, 0.12, 18.7]} color="#ebe8e2" />
      <Floor id="ceo" x={-9.5} z={-5.4} width={6.6} depth={7} surface="floor" color="#e7ceaf" />
      <Floor
        id="meeting"
        x={-2.2}
        z={-5.4}
        width={7.6}
        depth={7}
        surface="carpet"
        color="#6a7585"
      />
      <Floor id="cafe" x={5} z={-5.4} width={6.5} depth={7} surface="stone" />
      <Floor id="gym" x={10.7} z={-5.4} width={4.5} depth={7} surface="rubber" color="#7c8591" />
      <Floor id="studio" x={-5.5} z={4.3} width={14.4} depth={8.4} surface="floor" />
      <Floor id="lounge" x={5} z={4.3} width={6.3} depth={8.4} surface="floor" color="#e7d0af" />
      <Floor id="reception" x={10.7} z={4.3} width={4.5} depth={8.4} surface="stone" />
      <Block position={[0, 1.78, -9]} size={[26.7, 3.55, 0.2]} color="#f4f1ec" />
      <Block position={[-13.2, 1.65, -3]} size={[0.2, 3.3, 12.1]} color="#f4f1ec" />
      <Block position={[0, 0.19, -8.83]} size={[26.4, 0.27, 0.055]} color="#bcb4a7" />
      <Block position={[-13.04, 0.19, -3]} size={[0.055, 0.27, 11.9]} color="#bcb4a7" />
      {[-11.3, -7.8, -4.3, -0.8, 2.7, 6.2, 9.7].map((x) => (
        <group key={x}>
          <Block
            position={[x, 2.05, -8.86]}
            size={[2.65, 2.12, 0.075]}
            color="#b1cede"
            roughness={0.2}
          />
          <Block position={[x, 2.05, -8.79]} size={[2.7, 2.2, 0.06]} color="#626d78" />
          <Block
            position={[x, 2.05, -8.74]}
            size={[2.52, 2.02, 0.035]}
            color={night ? '#253b59' : '#bed7e8'}
            roughness={0.13}
          />
          <Block position={[x - 0.45, 2.05, -8.7]} size={[0.04, 2.04, 0.04]} color="#f2f1ee" />
          <Block position={[x, 2.55, -8.7]} size={[2.55, 0.045, 0.04]} color="#f2f1ee" />
          <Block position={[x, 1, -8.68]} size={[2.85, 0.11, 0.32]} color="#e9e5dd" />
        </group>
      ))}
      <Glass x={-6.1} z={-5.4} width={7} turn />
      <Glass x={1.7} z={-5.4} width={7} turn />
      <Glass x={8.35} z={-5.4} width={7} turn />
      {[-10.9, -3.1, 4.1, 11.2].map((x, i) => (
        <Glass key={x} x={x} z={-1.8} width={[3.5, 5.9, 4.5, 3.6][i]} />
      ))}
      <Glass x={1.7} z={4.9} width={7.2} turn />
      <Glass x={8.3} z={5.5} width={5.9} turn />
      <Block position={[0, 0.1, -0.72]} size={[26.4, 0.045, 0.035]} color="#b4b1ab" />
      <Block position={[0, 0.1, 0.18]} size={[26.4, 0.045, 0.035]} color="#b4b1ab" />
      <Block position={[0, 0.095, -0.25]} size={[26.4, 0.025, 0.8]} color="#e8e5df" />
      {[-7.6, 0.8, 7.6, 9.1].map((x) => (
        <Block key={x} position={[x, 0.1, -1.8]} size={[1.1, 0.03, 0.18]} color="#48515d" />
      ))}
      <Pendant x={-9.5} z={-5.8} width={2.2} />
      <Pendant x={-2.2} z={-5.8} width={3.7} />
      <Pendant x={5} z={-4.1} width={1.4} />
      {[-9, -5.5, -2].map((x) => (
        <Pendant key={x} x={x} z={3.8} width={2.3} />
      ))}
      <Pendant x={10.7} z={3.7} width={2.4} />
    </>
  );
}
function ExecutiveOffice() {
  return (
    <>
      <Block
        position={[-9.5, 0.105, -5.4]}
        size={[4.9, 0.035, 4.4]}
        color="#b6a898"
        surface="fabric"
        radius={0.08}
      />
      <Desk x={-9.5} z={-5.8} executive />
      <Shelf x={-10.5} z={-8.42} width={2.4} />
      <Plant x={-12} z={-7.5} />
      <Chair x={-11.7} z={-3.4} color="#af7650" rotation={-0.8} />
      <Cylinder position={[-11.7, 0.59, -4.5]} radius={0.42} height={0.06} color="#faf7ef" />
      <Cylinder position={[-11.7, 0.31, -4.5]} radius={0.045} height={0.5} color="#62503c" />
      <Sign
        position={[-12.99, 2.2, -5.4]}
        title="Make room"
        subtitle="FOR BIG IDEAS"
        width={2.5}
        height={1}
        rotation={[0, Math.PI / 2, 0]}
        background="#4f3c31"
      />
      <Block
        position={[-7.3, 0.5, -8.35]}
        size={[1.25, 0.9, 0.6]}
        color="#ffffff"
        surface="walnut"
      />
      <Plant x={-7.3} z={-8.3} scale={0.55} />
    </>
  );
}
function Conference() {
  return (
    <>
      <Block
        position={[-2.2, 0.99, -5.8]}
        size={[4.7, 0.17, 1.9]}
        color="#ffffff"
        surface="walnut"
        radius={0.35}
      />
      {[-3.65, -0.75].map((x) => (
        <Block
          key={x}
          position={[x, 0.52, -5.8]}
          size={[0.13, 0.95, 1.2]}
          color="#323b46"
          metalness={0.65}
        />
      ))}
      {conferenceSeats.map(([x, z], i) => (
        <Chair
          key={i}
          x={x}
          z={z}
          rotation={Math.atan2(-2.2 - x, -5.8 - z) + Math.PI}
          color="#324b6d"
        />
      ))}
      <Laptop position={[-3.3, 1.1, -5.6]} />
      <Mug position={[-1, 1.19, -5.5]} />
      <Block position={[-1.65, 1.09, -5.8]} size={[0.35, 0.025, 0.35]} color="#e4ded3" />
      <Cylinder position={[-2.2, 1.12, -5.8]} radius={0.13} height={0.075} color="#242b35" />
      <Block
        position={[-2.2, 2.17, -8.66]}
        size={[3.4, 1.76, 0.12]}
        color="#252d39"
        radius={0.06}
      />
      <Sign
        position={[-2.2, 2.17, -8.585]}
        title="Better together."
        subtitle="DESIGN  /  BUILD  /  REFINE"
        width={3.18}
        height={1.55}
        background="#1b3451"
      />
      <Plant x={-5.4} z={-8.1} />
      <Block position={[-5.7, 1.5, -6.8]} size={[0.07, 1.7, 1.5]} color="#d4d9dd" />
      <Block position={[-5.65, 1.5, -6.8]} size={[0.015, 1.54, 1.33]} color="#fffdf8" />
      <Laptop position={[-0.5, 1.1, -5.03]} />
    </>
  );
}
function Kitchen() {
  return (
    <>
      <CompactWorkstation x={2.5} z={-4.5} />
      <CoffeeService />
      <DiningSettings />
      <Block position={[4.8, 0.74, -8.02]} size={[5.2, 1.36, 1.28]} color="#d7cec2" />
      <Block
        position={[4.8, 1.47, -8.02]}
        size={[5.35, 0.13, 1.35]}
        color="#f9f6ef"
        surface="stone"
        roughness={0.32}
      />
      {[2.8, 3.85, 4.9, 5.95, 7].map((x, i) => (
        <group key={x}>
          <Block
            position={[x, 0.78, -7.365]}
            size={[0.96, 1.21, 0.035]}
            color={i % 2 ? '#b78d62' : '#c29a70'}
            surface="oak"
          />
          <Block
            position={[x, 1.23, -7.325]}
            size={[0.3, 0.025, 0.035]}
            color="#776046"
            metalness={0.65}
          />
        </group>
      ))}
      <Block
        position={[3.55, 1.545, -8]}
        size={[0.91, 0.035, 0.68]}
        color="#8d979d"
        metalness={0.65}
      />
      <Block position={[3.55, 1.56, -8]} size={[0.73, 0.015, 0.49]} color="#4e5e6a" />
      <mesh position={[3.8, 1.8, -8.23]} rotation={[0, 0, Math.PI / 2]}>
        <torusGeometry args={[0.18, 0.025, 8, 20, Math.PI]} />
        <meshStandardMaterial color="#aeb5bb" metalness={0.8} roughness={0.2} />
      </mesh>
      <Block position={[6.3, 1.84, -8]} size={[0.61, 0.62, 0.49]} color="#242c35" radius={0.06} />
      <Block position={[6.3, 1.85, -7.745]} size={[0.39, 0.18, 0.025]} color="#465464" />
      <Cylinder position={[6.3, 1.61, -7.7]} radius={0.13} height={0.035} color="#c7cbd0" />
      <Mug position={[6.3, 1.73, -7.69]} color="#e9e4db" />
      <Block position={[4.7, 2.68, -8.64]} size={[4.7, 0.1, 0.52]} color="#ffffff" surface="oak" />
      {[2.9, 3.4, 4, 4.5, 5].map((x, i) => (
        <Mug key={x} position={[x, 2.82, -8.6]} color={['#f1eee6', '#304f77', '#b45b3a'][i % 3]} />
      ))}
      <Block
        position={[7.55, 1.28, -5.95]}
        size={[0.86, 2.45, 1]}
        color="#c0c7cd"
        metalness={0.55}
        roughness={0.35}
      />
      <Block position={[7.55, 1.8, -5.43]} size={[0.75, 0.025, 0.02]} color="#5b6571" />
      <Block position={[7.87, 1.28, -5.42]} size={[0.035, 0.65, 0.045]} color="#555f6a" />
      <Cylinder position={[5, 0.94, -4.2]} radius={1.04} height={0.12} color="#b78d61" />
      <Cylinder position={[5, 0.5, -4.2]} radius={0.055} height={0.8} color="#303945" />
      <Cylinder position={[5, 0.12, -4.2]} radius={0.48} height={0.07} color="#303945" />
      <Chair x={3.5} z={-4.2} rotation={Math.PI / 2} color="#bb8b40" />
      <Chair x={6.5} z={-4.2} rotation={-Math.PI / 2} color="#bb8b40" />
      <Chair x={5} z={-2.9} color="#bb8b40" />
      <Mug position={[4.7, 1.1, -4.2]} color="#f1eee6" />
      <Mug position={[5.25, 1.1, -4.45]} color="#365573" />
      <Sign
        position={[5.6, 3.17, -8.74]}
        title="Coffee & company"
        width={2.7}
        height={0.42}
        background="#685142"
      />
    </>
  );
}
function Wellness() {
  return (
    <>
      <TreadmillBelt />
      <Block
        position={[10.5, 0.21, -6.65]}
        size={[1.38, 0.25, 2.85]}
        color="#282e37"
        radius={0.12}
      />
      <Block position={[10.5, 0.35, -6.55]} size={[1.03, 0.035, 2.33]} color="#4f5763" />
      {[-0.56, 0.56].map((v) => (
        <group key={v}>
          <Block
            position={[10.5 + v, 1.11, -7.55]}
            size={[0.07, 1.7, 0.08]}
            color="#9ba4af"
            metalness={0.7}
          />
          <Block position={[10.5 + v, 1.39, -7.1]} size={[0.075, 0.08, 0.92]} color="#333d49" />
        </group>
      ))}
      <Block
        position={[10.5, 1.92, -7.58]}
        size={[1.31, 0.27, 0.43]}
        color="#343e4d"
        rotation={[-0.18, 0, 0]}
      />
      <Block position={[10.5, 1.96, -7.35]} size={[0.5, 0.15, 0.02]} color="#66b4d5" glow />
      <Block
        position={[11.35, 0.11, -3.7]}
        size={[1.3, 0.055, 2]}
        color="#38628b"
        surface="rubber"
        radius={0.12}
      />
      <Block position={[9.35, 0.7, -4.55]} size={[0.7, 0.16, 1.25]} color="#a34c36" radius={0.1} />
      <Block position={[9.35, 0.42, -4.55]} size={[0.14, 0.65, 1.1]} color="#3c4654" />
      {[-0.4, 0.4].map((v) => (
        <group key={v}>
          <Cylinder
            position={[9.3 + v, 0.25, -3.15]}
            radius={0.043}
            height={0.52}
            color="#a1a9af"
            rotation={[Math.PI / 2, 0, 0]}
          />
          {[-0.24, 0.24].map((z) => (
            <Cylinder
              key={z}
              position={[9.3 + v, 0.25, -3.15 + z]}
              radius={0.15}
              height={0.1}
              color="#303641"
              rotation={[Math.PI / 2, 0, 0]}
            />
          ))}
        </group>
      ))}
      <Sign
        position={[10.7, 3.14, -8.73]}
        title="A healthy balance."
        width={2.8}
        height={0.5}
        background="#535c68"
      />
      <Plant x={12} z={-7.8} />
    </>
  );
}
function Studio() {
  return (
    <>
      {[-9, -5.5, -2].map((x, i) => (
        <group key={x}>
          <Desk x={x} z={2} variant={i} />
          <Desk x={x} z={5.5} variant={i + 3} />
        </group>
      ))}
      <Shelf x={-12.5} z={1.8} width={0.7} />
      <Plant x={-12} z={7.6} />
      <Plant x={0.7} z={7.7} />
      <Plant x={0.7} z={1.3} />
      <Block position={[-12.95, 1.65, 0]} size={[0.06, 1.3, 2.5]} color="#b6a38b" />
      <Sign
        position={[-12.9, 1.66, 0]}
        title="Make good things."
        subtitle="A LITTLE PROGRESS, EVERY DAY."
        width={2.25}
        height={1.15}
        background="#294865"
        rotation={[0, Math.PI / 2, 0]}
      />
    </>
  );
}
function LoungeAndReception() {
  return (
    <>
      <Block
        position={[5, 0.105, 4.6]}
        size={[4.85, 0.035, 5.15]}
        color="#d6c4ad"
        surface="fabric"
        radius={0.1}
      />
      {[-2, -1.7, 1.7, 2].map((v) => (
        <Block key={v} position={[5 + v, 0.13, 4.6]} size={[0.035, 0.008, 4.9]} color="#a08262" />
      ))}
      <Sofa x={5.4} z={2.2} color="#ad5b35" />
      <Sofa x={6.6} z={5.1} rotation={-Math.PI / 2} color="#304d6f" />
      <Block
        position={[5, 0.56, 5.2]}
        size={[1.85, 0.12, 1.3]}
        color="#ffffff"
        surface="walnut"
        radius={0.22}
      />
      {[-0.65, 0.65].map((x) => (
        <Block
          key={x}
          position={[5 + x, 0.32, 5.2]}
          size={[0.065, 0.5, 0.83]}
          color="#9b7950"
          metalness={0.6}
        />
      ))}
      <Block position={[4.8, 0.67, 5.25]} size={[0.66, 0.06, 0.51]} color="#b96242" />
      <Block position={[4.75, 0.71, 5.2]} size={[0.51, 0.03, 0.4]} color="#e9e0d3" />
      <Mug position={[5.4, 0.75, 4.9]} color="#f0e8da" />
      <CompactWorkstation x={4} z={4} />
      <Chair x={2.9} z={4.8} rotation={-Math.PI / 2} color="#8c765f" />
      <Chair x={7.5} z={7.2} color="#8c765f" />
      <Plant x={2.6} z={2} />
      <Shelf x={4.3} z={7.7} width={2.7} />
      <Cylinder position={[2.7, 0.15, 6.25]} radius={0.24} height={0.07} color="#353c45" />
      <Cylinder
        position={[2.7, 1.23, 6.25]}
        radius={0.027}
        height={2.1}
        color="#a78551"
        metalness={0.6}
      />
      <mesh position={[2.7, 2.29, 6.25]}>
        <coneGeometry args={[0.44, 0.4, 24, 1, true]} />
        <meshStandardMaterial color="#e3d8c5" side={2} />
      </mesh>
      <Block position={[10.6, 0.86, 3.6]} size={[3.1, 1.55, 1.15]} color="#dcd7cc" radius={0.12} />
      {Array.from({ length: 18 }, (_, i) => (
        <Block
          key={i}
          position={[9.2 + i * 0.165, 0.87, 4.19]}
          size={[0.055, 1.3, 0.045]}
          color="#ffffff"
          surface="oak"
        />
      ))}
      <Block
        position={[10.6, 1.68, 3.6]}
        size={[3.2, 0.13, 1.25]}
        color="#ffffff"
        surface="walnut"
      />
      <Block position={[10.4, 1.99, 3.35]} size={[0.85, 0.54, 0.075]} color="#293443" />
      <Block position={[10.4, 1.72, 3.35]} size={[0.2, 0.1, 0.25]} color="#576474" />
      <Sign
        position={[10.7, 1.03, 4.225]}
        title="Mini AI Office"
        width={1.76}
        height={0.46}
        background="#64513d"
      />
      <Chair x={10.5} z={2.4} rotation={Math.PI} />
      <Plant x={12.2} z={6.5} />
      <Sofa x={10.5} z={7.2} color="#b9a58d" />
      <Block position={[12.5, 0.35, 1.3]} size={[0.7, 0.6, 0.85]} color="#b08a60" />
      <Block position={[12.5, 0.69, 1.3]} size={[0.63, 0.06, 0.8]} color="#ddcbb2" />
    </>
  );
}
function Courtyard() {
  const focus = useOffice((s) => s.focus);
  return (
    <>
      <Block position={[0, -0.47, 11.3]} size={[27, 0.48, 4.6]} color="#8b8173" radius={0.16} />
      <Block
        position={[0, -0.2, 11.3]}
        size={[26.8, 0.06, 4.4]}
        color="#d5cbbc"
        onClick={(e) => {
          e.stopPropagation();
          focus('courtyard');
        }}
      />
      {[-10, -7, 7, 10].map((x) => (
        <group key={x}>
          <Block
            position={[x, -0.12, 11.1]}
            size={[2.5, 0.12, 3.5]}
            color="#527b38"
            radius={0.06}
          />
          <Block position={[x, 0.04, 11]} size={[1.65, 0.45, 1.65]} color="#b9ada0" />
          <Block position={[x, 0.28, 11]} size={[1.43, 0.025, 1.43]} color="#5d4531" />
          <Plant x={x} z={11} scale={1.8} />
        </group>
      ))}
      {[-3.1, -1.55, 0, 1.55, 3.1].map((x) => (
        <Block key={x} position={[x, -0.14, 11.2]} size={[1.38, 0.06, 3.9]} color="#e6dfd4" />
      ))}
      <Block position={[0, -0.02, 9.5]} size={[5, 0.16, 0.7]} color="#b6a690" />
      {[-4.7, 4.7].map((x) => (
        <group key={x}>
          {[0, 1, 2].map((i) => (
            <Block
              key={i}
              position={[x, 0.43, 11.45 + i * 0.2]}
              size={[2.4, 0.1, 0.15]}
              color="#ffffff"
              surface="oak"
            />
          ))}
          {[0, 1, 2].map((i) => (
            <Block
              key={i}
              position={[x, 0.71 + i * 0.16, 12.05]}
              size={[2.4, 0.12, 0.08]}
              color="#ffffff"
              surface="oak"
            />
          ))}
          {[-0.85, 0.85].map((v) => (
            <Block
              key={v}
              position={[x + v, 0.22, 11.8]}
              size={[0.09, 0.48, 0.7]}
              color="#3d444a"
              metalness={0.5}
            />
          ))}
        </group>
      ))}
      {[-11.8, -5.8, 5.8, 11.8].map((x) => (
        <group key={x}>
          <Block position={[x, 0.24, 12.7]} size={[0.17, 0.8, 0.17]} color="#3b424a" />
          <Block position={[x, 0.59, 12.7]} size={[0.18, 0.07, 0.18]} color="#fff0cd" glow />
        </group>
      ))}
    </>
  );
}
export default function Layout() {
  return (
    <group>
      <Architecture />
      <ExecutiveOffice />
      <Conference />
      <Kitchen />
      <Wellness />
      <Studio />
      <LoungeAndReception />
      <Courtyard />
    </group>
  );
}
