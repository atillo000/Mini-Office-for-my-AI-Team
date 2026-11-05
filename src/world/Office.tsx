import { Component, Suspense, useEffect, useMemo, useRef, type ReactNode } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { Environment, Lightformer } from '@react-three/drei';
import { ACESFilmicToneMapping, Color, Group, SRGBColorSpace } from 'three';
import { useOffice } from '../store';
import { rooms } from '../../shared/seed';
import Layout from './Layout';
import Character from './Characters';
import CameraRig from './CameraRig';
import { LabelPortal } from './labels';
import { groundShadowTexture } from './materials';
import { outfits } from '../../shared/appearance';
import OfficeActivity from '../components/OfficeActivity';

function Rain() {
  const group = useRef<Group>(null);
  const reduced = useOffice((s) => s.reduced);
  useFrame((_, dt) => {
    if (group.current && !reduced)
      for (const [i, drop] of group.current.children.entries()) {
        drop.position.y -= Math.min(dt, 0.1) * (7 + (i % 3));
        if (drop.position.y < 0) drop.position.y = 10;
      }
  });
  return (
    <group ref={group}>
      {Array.from({ length: 100 }, (_, i) => (
        <mesh key={i} position={[((i * 7.31) % 32) - 16, (i * 1.37) % 10, 9.5 + ((i * 3.17) % 6)]}>
          <boxGeometry args={[0.018, 0.28, 0.018]} />
          <meshBasicMaterial color="#9fb8ce" transparent opacity={0.45} />
        </mesh>
      ))}
    </group>
  );
}
function Scene() {
  const employees = useOffice((s) => s.employees);
  const night = useOffice((s) => s.night);
  const condition = useOffice((s) => s.snapshot?.weather.condition);
  const { scene, gl, size } = useThree();
  const rainy = condition === 'rainy';
  const groundShadow = useMemo(() => groundShadowTexture(), []);
  useEffect(() => {
    scene.background = new Color(night ? '#202936' : '#e7e5e1');
    gl.toneMappingExposure = night ? 1.1 : 1.05;
  }, [night, scene, gl]);
  return (
    <>
      <ambientLight intensity={night ? 0.17 : 0.52} />
      <hemisphereLight
        args={[night ? '#7085ab' : '#dce9ff', night ? '#302923' : '#938271', night ? 0.4 : 0.8]}
      />
      <directionalLight
        position={[-11, 24, 13]}
        intensity={night ? 0.45 : rainy ? 1.25 : condition === 'cloudy' ? 2.05 : 2.8}
        color={night ? '#99b8e5' : '#fff3e3'}
        castShadow
        shadow-mapSize={size.width < 700 ? [1024, 1024] : [2048, 2048]}
        shadow-camera-left={-24}
        shadow-camera-right={24}
        shadow-camera-top={24}
        shadow-camera-bottom={-24}
        shadow-camera-near={1}
        shadow-camera-far={65}
        shadow-normalBias={0.025}
        shadow-bias={-0.00008}
        shadow-radius={3}
      />
      <directionalLight position={[13, 9, -8]} intensity={night ? 0.1 : 0.55} color="#d5e6fc" />
      <Environment resolution={128} frames={1} environmentIntensity={night ? 0.11 : 0.48}>
        <Lightformer
          form="rect"
          intensity={3}
          color="#ffffff"
          position={[0, 8, -12]}
          rotation={[Math.PI / 4, 0, 0]}
          scale={[25, 8, 1]}
        />
        <Lightformer
          form="rect"
          intensity={2}
          color="#f3e6d5"
          position={[-12, 5, 0]}
          rotation={[0, Math.PI / 2, 0]}
          scale={[15, 6, 1]}
        />
        <Lightformer
          form="rect"
          intensity={1}
          color="#dae7f7"
          position={[12, 6, 2]}
          rotation={[0, -Math.PI / 2, 0]}
          scale={[12, 5, 1]}
        />
      </Environment>
      {night && (
        <>
          {[
            [-9.5, -5.8],
            [-2.2, -5.8],
            [5, -4.2],
            [-8, 3.8],
            [-2, 3.8],
            [5, 4.5],
            [10.5, 3.5],
          ].map(([x, z], i) => (
            <pointLight
              key={i}
              position={[x, 3, z]}
              color={i === 5 ? '#ffd59d' : '#ffe5bc'}
              intensity={i === 5 ? 11 : 20}
              distance={11}
              decay={2}
            />
          ))}
        </>
      )}
      <mesh position={[0, -0.755, 0]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[200, 200]} />
        <shadowMaterial opacity={night ? 0.12 : 0.17} color="#514539" />
      </mesh>
      <mesh position={[0, -0.748, 2.2]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[36, 31]} />
        <meshBasicMaterial
          map={groundShadow}
          transparent
          opacity={night ? 0.1 : 0.22}
          depthWrite={false}
          toneMapped={false}
        />
      </mesh>
      <Layout />
      {employees.map((e, i) => (
        <Character key={e.id} employee={e} index={i} />
      ))}
      {rainy && <Rain />}
      <CameraRig />
    </>
  );
}
class WorldBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? <Fallback /> : this.props.children;
  }
}
const roomColors: Record<string, string> = {
  studio: '#c5a17d',
  ceo: '#9b7350',
  meeting: '#75869e',
  cafe: '#d3c2a5',
  gym: '#7c8492',
  lounge: '#c1815b',
  reception: '#bdb6ab',
  courtyard: '#97a477',
};
export function Fallback() {
  const employees = useOffice((s) => s.employees);
  const select = useOffice((s) => s.select);
  const runtime = useOffice((s) => s.runtime);
  return (
    <div className="fallback-world">
      <span className="eyebrow">YOUR OFFICE · 2D VIEW</span>
      <div className="floorplan">
        {rooms.map((r) => (
          <section key={r.id} style={{ background: roomColors[r.id] + '35' }}>
            <h3>{r.name}</h3>
            {employees
              .filter((e) => (runtime[e.id]?.room || e.room) === r.id)
              .map((e) => (
                <button
                  key={e.id}
                  className="floor-worker"
                  onClick={() => select(e.id)}
                  style={{ background: (outfits[e.id]?.shirt || e.color) + '28' }}
                >
                  {e.name.split(' ')[0]}
                  <OfficeActivity runtime={runtime[e.id]} />
                </button>
              ))}
          </section>
        ))}
      </div>
      <p>Every employee and management tool is available in this lightweight view.</p>
    </div>
  );
}
export default function Office() {
  const reduced = useOffice((s) => s.reduced);
  const portal = useRef<HTMLDivElement>(null!);
  return (
    <>
      <div className="office-labels" ref={portal} />
      {reduced ? (
        <Fallback />
      ) : (
        <WorldBoundary>
          <Canvas
            orthographic
            shadows
            camera={{ position: [29, 32, 35.6], zoom: 25, near: 0.1, far: 180 }}
            dpr={[1, 1.5]}
            gl={{
              antialias: true,
              alpha: false,
              powerPreference: 'high-performance',
              toneMapping: ACESFilmicToneMapping,
              outputColorSpace: SRGBColorSpace,
            }}
          >
            <Suspense fallback={null}>
              <LabelPortal.Provider value={portal}>
                <Scene />
              </LabelPortal.Provider>
            </Suspense>
          </Canvas>
        </WorldBoundary>
      )}
    </>
  );
}
