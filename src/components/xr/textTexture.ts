import * as THREE from 'three';

/**
 * Creates a Three.js texture from text rendered on an HTML canvas.
 * Works everywhere — no drei/troika dependency.
 */
export function createTextTexture(
  text: string,
  options: {
    width?: number;
    height?: number;
    fontSize?: number;
    color?: string;
    bgColor?: string;
    align?: CanvasTextAlign;
    fontWeight?: string;
    padding?: number;
  } = {}
): THREE.CanvasTexture {
  const {
    width = 256,
    height = 64,
    fontSize = 24,
    color = '#ffffff',
    bgColor = 'transparent',
    align = 'center',
    fontWeight = 'normal',
    padding = 8,
  } = options;

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d')!;

  // Background
  if (bgColor !== 'transparent') {
    ctx.fillStyle = bgColor;
    ctx.fillRect(0, 0, width, height);
  }

  // Text
  ctx.fillStyle = color;
  ctx.font = `${fontWeight} ${fontSize}px Arial, sans-serif`;
  ctx.textAlign = align;
  ctx.textBaseline = 'middle';

  const x = align === 'center' ? width / 2 : align === 'right' ? width - padding : padding;

  // Word wrap for long text
  const words = text.split(' ');
  const lines: string[] = [];
  let currentLine = '';

  for (const word of words) {
    const testLine = currentLine ? `${currentLine} ${word}` : word;
    if (ctx.measureText(testLine).width > width - padding * 2 && currentLine) {
      lines.push(currentLine);
      currentLine = word;
    } else {
      currentLine = testLine;
    }
  }
  lines.push(currentLine);

  const lineHeight = fontSize * 1.2;
  const startY = height / 2 - ((lines.length - 1) * lineHeight) / 2;

  lines.forEach((line, i) => {
    ctx.fillText(line, x, startY + i * lineHeight);
  });

  const texture = new THREE.CanvasTexture(canvas);
  texture.needsUpdate = true;
  return texture;
}
