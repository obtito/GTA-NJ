import * as THREE from 'three';

/** Low-contrast, seamless brick atlas. One tile is 4 x 2 metres.
 * No tile-wide bump gradient: averaged mip normals otherwise form giant corrugations. */
export function makeMasonryTexture({ meterUV = false } = {}) {
  if (typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas'); canvas.width = 512; canvas.height = 256;
  const c = canvas.getContext('2d');
  c.fillStyle = '#6f746c'; c.fillRect(0, 0, 512, 256);
  let seed = 1366;
  const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
  for (let row = 0; row < 10; row++) for (let col = -1; col < 11; col++) {
    const x = col * 51.2 + (row % 2) * 25.6, y = row * 25.6;
    const shade = 133 + Math.floor(random() * 22);
    c.fillStyle = `rgb(${shade},${shade + 2},${shade - 6})`; c.fillRect(x + 1, y + 1, 49.2, 23.6);
    for (let i = 0; i < 12; i++) {
      c.fillStyle = random() > .5 ? '#ffffff0c' : '#151c130c';
      c.fillRect(x + 2 + random() * 44, y + 2 + random() * 18, 2 + random() * 8, 2);
    }
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace; texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  if (meterUV) texture.repeat.set(1 / 4, 1 / 2);
  texture.anisotropy = 8;
  return texture;
}
