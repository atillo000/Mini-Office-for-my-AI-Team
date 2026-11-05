import { useEffect, useRef } from 'react';
import { OrbitControls } from '@react-three/drei';
import { useFrame, useThree } from '@react-three/fiber';
import { MathUtils, Vector3 } from 'three';
import type { OrbitControls as Controls } from 'three-stdlib';
import { rooms } from '../../shared/seed';
import { useOffice } from '../store';

export default function CameraRig() {
  const controls = useRef<Controls>(null);
  const { camera, size } = useThree();
  const version = useOffice((s) => s.focusVersion);
  const transition = useRef<{
    elapsed: number;
    duration: number;
    from: Vector3;
    to: Vector3;
    fromTarget: Vector3;
    toTarget: Vector3;
    fromZoom: number;
    toZoom: number;
  } | null>(null);
  const desiredZoom = useRef(camera.zoom);
  const initialized = useRef(false);
  const interacting = useRef(false);
  useEffect(() => {
    const room = rooms.find((r) => r.id === useOffice.getState().room);
    // Leave comfortable margins around the building and courtyard at every aspect ratio.
    const target = new Vector3(room?.center[0] ?? 0, 0.3, room?.center[1] ?? 1.6);
    const next = target.clone().add(new Vector3(29, 32, 34));
    const zoom = room
      ? Math.min(size.width / 14, size.height / 12, 52)
      : Math.min(size.width / 38, size.height / 27.5, 31);
    desiredZoom.current = zoom;
    if (!initialized.current) {
      camera.position.copy(next);
      camera.zoom = zoom;
      camera.updateProjectionMatrix();
      controls.current?.target.copy(target);
      controls.current?.update();
      initialized.current = true;
      return;
    }
    transition.current = {
      elapsed: 0,
      duration: 1.15,
      from: camera.position.clone(),
      to: next,
      fromTarget: controls.current?.target.clone() || new Vector3(),
      toTarget: target,
      fromZoom: camera.zoom,
      toZoom: zoom,
    };
  }, [version, size.width, size.height, camera]);
  useEffect(() => {
    const zoom = (event: Event) => {
      transition.current = null;
      interacting.current = false;
      desiredZoom.current = MathUtils.clamp(
        camera.zoom * (event as CustomEvent<number>).detail,
        5,
        90,
      );
    };
    window.addEventListener('office-zoom', zoom);
    return () => window.removeEventListener('office-zoom', zoom);
  }, [camera]);
  useFrame((_, delta) => {
    if (!controls.current) return;
    const step = transition.current;
    if (step) {
      step.elapsed += Math.min(delta, 0.05);
      const t = Math.min(step.elapsed / step.duration, 1);
      const ease = t * t * t * (t * (t * 6 - 15) + 10);
      camera.position.lerpVectors(step.from, step.to, ease);
      controls.current.target.lerpVectors(step.fromTarget, step.toTarget, ease);
      camera.zoom = MathUtils.lerp(step.fromZoom, step.toZoom, ease);
      if (t === 1) transition.current = null;
    } else if (!interacting.current)
      camera.zoom = MathUtils.damp(camera.zoom, desiredZoom.current, 10, Math.min(delta, 0.05));
    camera.updateProjectionMatrix();
    controls.current.update();
  });
  return (
    <OrbitControls
      ref={controls}
      makeDefault
      enableDamping
      dampingFactor={0.075}
      rotateSpeed={0.48}
      panSpeed={0.65}
      zoomSpeed={0.65}
      minPolarAngle={0.28}
      maxPolarAngle={1.18}
      minZoom={5}
      maxZoom={90}
      onStart={() => {
        transition.current = null;
        interacting.current = true;
        desiredZoom.current = camera.zoom;
      }}
      onEnd={() => {
        interacting.current = false;
        desiredZoom.current = camera.zoom;
      }}
    />
  );
}
