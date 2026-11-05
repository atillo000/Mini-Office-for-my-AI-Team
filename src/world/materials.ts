import { CanvasTexture, RepeatWrapping, SRGBColorSpace } from 'three';
export type Surface = 'oak' | 'walnut' | 'floor' | 'stone' | 'fabric' | 'carpet' | 'rubber';
const textures = new Map<string, CanvasTexture>();
export function groundShadowTexture() {
  const cached = textures.get('ground-shadow');
  if (cached) return cached;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 512;
  const context = canvas.getContext('2d')!;
  context.shadowColor = 'rgba(35,29,23,.65)';
  context.shadowBlur = 42;
  context.fillStyle = '#231d17';
  context.fillRect(60, 70, 392, 372);
  const texture = new CanvasTexture(canvas);
  textures.set('ground-shadow', texture);
  return texture;
}
// Small, seeded material textures are generated locally; the office works offline.
export function surfaceTexture(kind: Surface, repeatX = 1, repeatY = 1) {
  const key = `${kind}:${repeatX}:${repeatY}`;
  const existing = textures.get(key);
  if (existing) return existing;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 512;
  const ctx = canvas.getContext('2d')!;
  let seed = 571;
  const random = () => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647;
  };
  if (kind === 'oak' || kind === 'walnut' || kind === 'floor') {
    ctx.fillStyle = kind === 'walnut' ? '#795034' : '#c49a6e';
    ctx.fillRect(0, 0, 512, 512);
    const boards = kind === 'floor' ? 8 : 1;
    for (let board = 0; board < boards; board++) {
      const y = (board * 512) / boards;
      ctx.fillStyle = `rgba(${kind === 'walnut' ? '45,22,9' : '255,239,205'},${0.025 + random() * 0.12})`;
      ctx.fillRect(0, y, 512, 512 / boards);
      for (let i = 0; i < 85; i++) {
        const lineY = y + (random() * 512) / boards;
        ctx.beginPath();
        ctx.moveTo(0, lineY);
        ctx.bezierCurveTo(
          160,
          lineY + random() * 4,
          330,
          lineY - random() * 4,
          512,
          lineY + random() * 2,
        );
        ctx.strokeStyle = `rgba(65,37,16,${random() * 0.13})`;
        ctx.lineWidth = 0.3 + random() * 0.8;
        ctx.stroke();
      }
      if (boards > 1) {
        ctx.fillStyle = '#825c3838';
        ctx.fillRect(0, y, 512, 1);
        ctx.fillRect((board % 3) * 170 + 70, y, 1, 64);
      }
    }
  } else {
    ctx.fillStyle = { stone: '#efede8', fabric: '#dedbd5', carpet: '#b1b3b8', rubber: '#697079' }[
      kind
    ];
    ctx.fillRect(0, 0, 512, 512);
    for (let i = 0; i < 15000; i++) {
      const value = random() > 0.5 ? 255 : 20;
      ctx.fillStyle = `rgba(${value},${value},${value},${random() * (kind === 'stone' ? 0.035 : 0.08)})`;
      ctx.fillRect(
        random() * 512,
        random() * 512,
        kind === 'fabric' ? 1 : 2,
        kind === 'fabric' ? 4 : 1,
      );
    }
    if (kind === 'stone') {
      ctx.strokeStyle = '#bfbcb742';
      ctx.lineWidth = 1;
      for (let i = 0; i <= 4; i++) {
        ctx.beginPath();
        ctx.moveTo(i * 128, 0);
        ctx.lineTo(i * 128, 512);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(0, i * 128);
        ctx.lineTo(512, i * 128);
        ctx.stroke();
      }
    }
  }
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  texture.wrapS = texture.wrapT = RepeatWrapping;
  texture.repeat.set(repeatX, repeatY);
  texture.anisotropy = 4;
  textures.set(key, texture);
  return texture;
}
