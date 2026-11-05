import { useContext, useRef } from 'react';
import { Html } from '@react-three/drei';
import { useFrame } from '@react-three/fiber';
import { Group, MathUtils } from 'three';
import type { Employee } from '../../shared/types';
import { outfits } from '../../shared/appearance';
import { useOffice } from '../store';
import { Block, Cylinder, Mug } from './Furniture';
import { LabelPortal } from './labels';
import { activityDescription, activityColor } from '../simulation/presentation';
import { ActivityIcon } from '../components/OfficeActivity';

function HandWeight() {
  return (
    <group rotation={[0, 0, Math.PI / 2]}>
      <Cylinder position={[0, 0, 0]} radius={0.025} height={0.3} color="#aeb8c4" metalness={0.7} />
      {[-0.14, 0.14].map((y) => (
        <Cylinder key={y} position={[0, y, 0]} radius={0.07} height={0.065} color="#343d4b" />
      ))}
    </group>
  );
}

function Head({ employee }: { employee: Employee }) {
  const outfit = outfits[employee.id];
  const hair = employee.hair;
  return (
    <group position={[0, 0.87, 0]}>
      <mesh castShadow scale={[0.94, 1.1, 0.93]}>
        <sphereGeometry args={[0.215, 20, 16]} />
        <meshStandardMaterial color={employee.skin} roughness={0.85} />
      </mesh>
      <mesh position={[0, 0.055, -0.015]} castShadow scale={[1, 0.91, 1]}>
        <sphereGeometry args={[0.222, 18, 12, 0, Math.PI * 2, 0, Math.PI * 0.59]} />
        <meshStandardMaterial color={hair} roughness={0.88} />
      </mesh>
      <Block
        position={[-0.025, 0.15, 0.105]}
        size={[0.32, 0.105, 0.18]}
        color={hair}
        rotation={[0, 0, -0.16]}
        radius={0.05}
      />
      {[-1, 1].map((side) => (
        <group key={side}>
          <mesh position={[side * 0.207, -0.01, 0]} scale={[0.55, 1, 0.65]}>
            <sphereGeometry args={[0.058, 10, 8]} />
            <meshStandardMaterial color={employee.skin} />
          </mesh>
          <mesh position={[side * 0.081, 0.018, 0.185]} scale={[1, 0.6, 0.42]}>
            <sphereGeometry args={[0.04, 10, 8]} />
            <meshStandardMaterial color="#f6f0e9" roughness={0.6} />
          </mesh>
          <mesh position={[side * 0.081, 0.018, 0.205]}>
            <sphereGeometry args={[0.018, 8, 8]} />
            <meshStandardMaterial color="#332c2a" />
          </mesh>
          <mesh position={[side * 0.075, 0.025, 0.22]}>
            <sphereGeometry args={[0.005, 6, 6]} />
            <meshBasicMaterial color="#ffffff" />
          </mesh>
          <Block
            position={[side * 0.081, 0.083, 0.188]}
            size={[0.071, 0.013, 0.016]}
            color={hair}
            rotation={[0, 0, side * 0.1]}
            radius={0.004}
          />
        </group>
      ))}
      <mesh position={[0, -0.035, 0.204]} scale={[0.65, 1, 0.9]}>
        <sphereGeometry args={[0.039, 10, 8]} />
        <meshStandardMaterial color={employee.skin} />
      </mesh>
      <Block
        position={[0, -0.112, 0.183]}
        size={[0.067, 0.011, 0.014]}
        color="#9b6358"
        radius={0.004}
      />
      {outfit?.glasses && (
        <group position={[0, 0.018, 0.217]}>
          {[-0.085, 0.085].map((x) => (
            <mesh key={x} position={[x, 0, 0]}>
              <torusGeometry args={[0.062, 0.009, 5, 16]} />
              <meshStandardMaterial color="#333a45" metalness={0.4} />
            </mesh>
          ))}
          <Block position={[0, 0, 0]} size={[0.05, 0.012, 0.012]} color="#333a45" />
        </group>
      )}
      {outfit?.style === 'bun' && (
        <mesh position={[0, 0.145, -0.19]} castShadow>
          <sphereGeometry args={[0.115, 12, 10]} />
          <meshStandardMaterial color={hair} />
        </mesh>
      )}
      {outfit?.style === 'ponytail' && (
        <mesh position={[0, -0.13, -0.23]} rotation={[0.35, 0, 0]} castShadow>
          <capsuleGeometry args={[0.085, 0.28, 4, 10]} />
          <meshStandardMaterial color={hair} />
        </mesh>
      )}
      {(outfit?.style === 'long' || outfit?.style === 'bob') && (
        <Block
          position={[0, outfit.style === 'long' ? -0.15 : -0.05, -0.16]}
          size={[0.41, outfit.style === 'long' ? 0.51 : 0.32, 0.19]}
          color={hair}
          radius={0.08}
        />
      )}
      {outfit?.style === 'short' && (
        <Block
          position={[0.13, 0.115, -0.045]}
          size={[0.16, 0.12, 0.28]}
          color={hair}
          rotation={[0, 0, 0.18]}
          radius={0.05}
        />
      )}
    </group>
  );
}
export default function Character({ employee, index }: { employee: Employee; index: number }) {
  const portal = useContext(LabelPortal);
  const root = useRef<Group>(null);
  const torso = useRef<Group>(null);
  const leftHip = useRef<Group>(null);
  const rightHip = useRef<Group>(null);
  const leftKnee = useRef<Group>(null);
  const rightKnee = useRef<Group>(null);
  const leftArm = useRef<Group>(null);
  const rightArm = useRef<Group>(null);
  const leftElbow = useRef<Group>(null);
  const rightElbow = useRef<Group>(null);
  const phase = useRef(index * 0.8);
  const sitBlend = useRef(1);
  const headPose = useRef<Group>(null);
  const cup = useRef<Group>(null);
  const spawned = useRef(false);
  const selected = useOffice((s) => s.selected === employee.id);
  const select = useOffice((s) => s.select);
  const labels = useOffice((s) => s.labels);
  const activity = useOffice((s) => s.runtime[employee.id]?.state || 'IDLE');
  const interaction = useOffice((s) => s.runtime[employee.id]?.interaction);
  const carrying = useOffice((s) => s.runtime[employee.id]?.carrying);
  const description = useOffice((s) => activityDescription(s.runtime[employee.id]));
  const runtime = useOffice.getState().runtime[employee.id];
  const hasMug = interaction === 'coffee' || carrying === 'mug';
  const outfit = outfits[employee.id] || {
    shirt: employee.color,
    trousers: '#344054',
    shoes: '#f1eeea',
    style: 'short',
  };
  useFrame((_, delta) => {
    if (!root.current || !torso.current) return;
    const dt = Math.min(delta, 0.05);
    const s = useOffice.getState();
    const rt = s.runtime[employee.id];
    const p = rt?.position || employee.desk;
    const state = rt?.state || 'IDLE';
    const action = rt?.interaction || 'none';
    const moving = s.speed > 0 && !s.reduced;
    const walking = state === 'WALKING';
    const running = action === 'treadmill';
    const gait = (walking && (rt?.blockedSeconds || 0) < 0.15) || running;
    if (moving) phase.current += dt * (gait ? 7.8 : 2.1) * s.speed;
    const t = phase.current;
    root.current.position.x = MathUtils.damp(root.current.position.x, p[0], 12, dt);
    root.current.position.z = MathUtils.damp(root.current.position.z, p[1], 12, dt);
    let elevation = rt?.elevation || 0;
    if (walking && (rt?.targetElevation || 0) > 0 && rt?.path.length === 1)
      elevation =
        (rt.targetElevation || 0) *
        Math.max(0, 1 - Math.hypot(p[0] - rt.path[0][0], p[1] - rt.path[0][1]) / 1.3);
    root.current.position.y = MathUtils.damp(root.current.position.y, 0.08 + elevation, 9, dt);
    let angle = rt?.heading ?? Math.PI;
    if (walking && rt?.path.length) angle = Math.atan2(rt.path[0][0] - p[0], rt.path[0][1] - p[1]);
    if (!spawned.current && rt) {
      root.current.position.set(p[0], 0.08 + elevation, p[1]);
      root.current.rotation.y = angle;
      spawned.current = true;
    }
    const turn =
      MathUtils.euclideanModulo(angle - root.current.rotation.y + Math.PI, Math.PI * 2) - Math.PI;
    root.current.rotation.y += turn * (1 - Math.exp(-dt * 8));
    const seated = !!rt?.seated && !walking;
    sitBlend.current = MathUtils.damp(sitBlend.current, seated ? 1 : 0, 7, dt);
    const sit = sitBlend.current;
    const hips = 0.82 - 0.17 * sit;
    const bounce = gait ? Math.abs(Math.sin(t)) * (running ? 0.05 : 0.035) : 0;
    torso.current.position.y = hips + bounce;
    torso.current.rotation.z = gait
      ? Math.sin(t) * 0.025
      : action === 'stretching'
        ? Math.sin(t) * 0.09
        : 0;
    if (headPose.current) {
      headPose.current.rotation.x =
        action === 'reading' ? 0.17 : action === 'listening' ? Math.sin(t) * 0.035 : 0;
      headPose.current.rotation.z = action === 'speaking' ? Math.sin(t * 1.5) * 0.04 : 0;
    }
    const legs = [leftHip, rightHip];
    const knees = [leftKnee, rightKnee];
    const arms = [leftArm, rightArm];
    const elbows = [leftElbow, rightElbow];
    for (let i = 0; i < 2; i++) {
      const swing = Math.sin(t + (i ? Math.PI : 0));
      if (legs[i].current) {
        legs[i].current!.position.y = hips + bounce;
        legs[i].current!.rotation.x =
          -0.95 * sit + (gait ? swing * (running ? 0.7 : 0.52) : 0) * (1 - sit);
      }
      if (knees[i].current)
        knees[i].current!.rotation.x =
          0.95 * sit + (gait ? Math.max(0, -swing) * (running ? 0.9 : 0.6) : 0) * (1 - sit);
      let arm = -0.08,
        elbow = -0.12,
        spread = 0;
      if (action === 'typing') {
        arm = -0.77 + Math.sin(t * 4 + i) * 0.035;
        elbow = -0.9 + Math.sin(t * 5 + i) * 0.08;
      } else if (gait) {
        arm = -swing * 0.48;
        elbow = running ? -1.25 : -0.15;
      } else if (action === 'weights') {
        arm = -0.12;
        elbow = -1.1 + Math.sin(t * 1.8 + i * 0.5) * 0.75;
      } else if (action === 'stretching') {
        arm = -0.4;
        elbow = -0.2;
        spread = (i ? 1 : -1) * (0.9 + Math.sin(t) * 0.65);
      } else if (
        (action === 'speaking' || action === 'chatting' || action === 'reporting') &&
        i === 0
      ) {
        arm = -0.5 + Math.sin(t) * 0.22;
        elbow = -0.9 + Math.sin(t * 1.8) * 0.25;
      } else if (action === 'reading' && state === 'RESTING') {
        arm = -0.6;
        elbow = -1.1;
      } else if (action === 'eating' && i === 1) {
        const bite = (Math.sin(t * 0.8) + 1) / 2;
        arm = -0.6 - bite * 0.65;
        elbow = -0.8 - bite * 0.7;
      }
      if (hasMug && i === 1) {
        const sip =
          !walking && (action === 'coffee' || action === 'chatting')
            ? (Math.sin(t * 0.65) + 1) / 2
            : 0;
        arm = -0.5 - 0.7 * sip;
        elbow = -0.7 - 0.9 * sip;
        if (cup.current) cup.current.rotation.x = -arm - elbow - sip * 0.3;
      }
      if (arms[i].current) {
        arms[i].current!.rotation.x = MathUtils.damp(arms[i].current!.rotation.x, arm, 12, dt);
        arms[i].current!.rotation.z = MathUtils.damp(arms[i].current!.rotation.z, spread, 12, dt);
      }
      if (elbows[i].current)
        elbows[i].current!.rotation.x = MathUtils.damp(
          elbows[i].current!.rotation.x,
          elbow,
          12,
          dt,
        );
    }
    if (cup.current) {
      const sip =
        !walking && (action === 'coffee' || action === 'chatting')
          ? (Math.sin(t * 0.65) + 1) / 2
          : 0;
      cup.current.rotation.x =
        -(rightArm.current?.rotation.x || 0) - (rightElbow.current?.rotation.x || 0) - sip * 0.3;
    }
  });
  return (
    <group
      ref={root}
      position={[employee.desk[0], 0.08, employee.desk[1]]}
      onClick={(e) => {
        e.stopPropagation();
        select(employee.id);
      }}
      onPointerOver={() => {
        document.body.style.cursor = 'pointer';
      }}
      onPointerOut={() => {
        document.body.style.cursor = 'auto';
      }}
    >
      {selected && (
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.012, 0]}>
          <ringGeometry args={[0.43, 0.49, 40]} />
          <meshBasicMaterial color="#4c86bf" />
        </mesh>
      )}
      {[leftHip, rightHip].map((ref, i) => (
        <group key={i} ref={ref} position={[i ? 0.14 : -0.14, 0.68, 0]}>
          <mesh position={[0, -0.19, 0]} castShadow>
            <capsuleGeometry args={[0.09, 0.24, 4, 10]} />
            <meshStandardMaterial color={outfit.trousers} roughness={0.9} />
          </mesh>
          <group ref={i ? rightKnee : leftKnee} position={[0, -0.39, 0]}>
            <mesh position={[0, -0.17, 0]} castShadow>
              <capsuleGeometry args={[0.072, 0.23, 4, 10]} />
              <meshStandardMaterial color={outfit.trousers} roughness={0.9} />
            </mesh>
            <Block
              position={[0, -0.37, 0.075]}
              size={[0.18, 0.13, 0.34]}
              color={outfit.shoes}
              radius={0.05}
            />
            <Block
              position={[0, -0.425, 0.07]}
              size={[0.185, 0.025, 0.33]}
              color="#d6d3cd"
              radius={0.015}
            />
          </group>
        </group>
      ))}
      <group ref={torso} position={[0, 0.68, 0]}>
        <Block
          position={[0, 0.025, 0]}
          size={[0.43, 0.15, 0.29]}
          color={outfit.trousers}
          radius={0.065}
        />
        <mesh position={[0, 0.34, 0]} castShadow scale={[1, 1, 0.62]}>
          <cylinderGeometry args={[0.285, 0.235, 0.57, 12]} />
          <meshStandardMaterial color={outfit.shirt} roughness={0.9} />
        </mesh>
        <Cylinder position={[0, 0.665, 0]} radius={0.075} height={0.14} color={employee.skin} />
        {outfit.jacket && (
          <>
            <Block position={[0, 0.49, 0.172]} size={[0.16, 0.26, 0.012]} color="#eee9df" />
            {[-1, 1].map((v) => (
              <Block
                key={v}
                position={[v * 0.105, 0.51, 0.175]}
                size={[0.075, 0.28, 0.023]}
                rotation={[0, 0, v * 0.27]}
                color={outfit.shirt}
              />
            ))}
            <Block position={[0.01, 0.26, 0.156]} size={[0.015, 0.015, 0.012]} color="#b9b1a5" />
          </>
        )}
        {employee.id === 'sophia' && (
          <>
            <Block position={[0, 0.42, 0.18]} size={[0.025, 0.3, 0.015]} color="#d4e0eb" />
            <Block position={[0, 0.26, 0.19]} size={[0.12, 0.14, 0.015]} color="#f0eee8" />
          </>
        )}
        {[leftArm, rightArm].map((ref, i) => (
          <group key={i} ref={ref} position={[i ? 0.305 : -0.305, 0.59, 0]}>
            <mesh position={[0, -0.13, 0]} castShadow>
              <capsuleGeometry args={[0.082, 0.15, 4, 10]} />
              <meshStandardMaterial color={outfit.shirt} roughness={0.9} />
            </mesh>
            <group ref={i ? rightElbow : leftElbow} position={[0, -0.29, 0]}>
              <mesh position={[0, -0.11, 0]} castShadow>
                <capsuleGeometry args={[0.06, 0.14, 4, 10]} />
                <meshStandardMaterial
                  color={outfit.jacket ? outfit.shirt : employee.skin}
                  roughness={0.8}
                />
              </mesh>
              <mesh position={[0, -0.26, 0.015]} scale={[0.8, 1, 0.65]} castShadow>
                <sphereGeometry args={[0.075, 10, 8]} />
                <meshStandardMaterial color={employee.skin} />
              </mesh>
              {i === 1 && hasMug && (
                <group ref={cup} position={[0, -0.26, 0.06]}>
                  <Mug color="#eae4d8" />
                </group>
              )}
              {interaction === 'weights' && (
                <group position={[0, -0.26, 0.015]}>
                  <HandWeight />
                </group>
              )}
              {i === 1 && interaction === 'eating' && (
                <Cylinder
                  position={[0, -0.31, 0.06]}
                  radius={0.012}
                  height={0.19}
                  color="#b8c3cc"
                  rotation={[Math.PI / 2, 0, 0]}
                  metalness={0.6}
                />
              )}
            </group>
          </group>
        ))}
        <group ref={headPose}>
          <Head employee={employee} />
        </group>
        {activity === 'RESTING' && interaction === 'reading' && (
          <group position={[0, 0.13, 0.33]} rotation={[-0.35, 0, 0]}>
            <Block size={[0.35, 0.035, 0.25]} color="#365a7c" />
            <Block position={[0, 0.023, 0]} size={[0.31, 0.012, 0.22]} color="#eee5d6" />
          </group>
        )}
        {interaction === 'eating' && (
          <group position={[0, 0.13, 0.34]}>
            <Cylinder position={[0, 0, 0]} radius={0.19} height={0.02} color="#f1eee6" />
            <Block position={[-0.06, 0.035, 0]} size={[0.12, 0.04, 0.12]} color="#bd843e" />
            <Block position={[0.07, 0.035, 0.035]} size={[0.12, 0.04, 0.1]} color="#769454" />
          </group>
        )}
      </group>
      {
        <Html portal={portal} position={[0, 2.16, 0]} center zIndexRange={[3, 1]}>
          <button
            className={`avatar-label worker-badge ${selected ? 'selected' : ''} ${!labels ? 'names-hidden' : ''}`}
            data-activity={activity}
            data-interaction={interaction || 'none'}
            aria-label={`${employee.name}: ${description} (simulated office activity)`}
            title={`${employee.name} · ${description} · simulated office life`}
            onClick={() => select(employee.id)}
          >
            {(labels || selected) && (
              <span className="avatar-name">{employee.name.split(' ')[0]}</span>
            )}
            <span className="activity-state" style={{ color: activityColor(runtime) }}>
              <ActivityIcon runtime={runtime} />
              <span className="activity-caption">{description}</span>
            </span>
            {selected && <span className="avatar-role">{employee.role}</span>}
          </button>
        </Html>
      }
    </group>
  );
}
