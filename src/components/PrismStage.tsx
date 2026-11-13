import { useEffect, useRef, type RefObject } from 'react';
import * as THREE from 'three';
import { createPrismMeshData } from '../lib/prismMesh';
import {
  buildSpectrum,
  computeLayout,
  computeLayoutForSlot,
  tracePrismOptics,
  type PrismLayout,
} from '../lib/prismOptics';
import {
  BG_BLEND_FRAG,
  BG_BLEND_VERT,
  COPY_TO_SCREEN_FRAG,
  GLASS_BACK_FRAG,
  GLASS_FRONT_FRAG,
  GLASS_VERT,
} from '../lib/prismShaders';

interface PrismStageProps {
  slotRef?: RefObject<HTMLElement | null>;
}

const FOV_DEG = 28;
const BG_SRGB: [number, number, number] = [14 / 255, 4 / 255, 16 / 255];

interface Mote {
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  phase: number;
  freq: number;
}

function createMotes(count = 48): Mote[] {
  const motes: Mote[] = [];
  for (let i = 0; i < count; i++) {
    const h1 = Math.sin(i * 127.1) * 43758.5453;
    const h2 = Math.sin(i * 269.5) * 43758.5453;
    const h3 = Math.sin(i * 419.2) * 43758.5453;
    const r1 = h1 - Math.floor(h1);
    const r2 = h2 - Math.floor(h2);
    const r3 = h3 - Math.floor(h3);
    motes.push({
      x: r1,
      y: r2,
      vx: (r3 - 0.5) * 0.008,
      vy: -0.004 - r1 * 0.008,
      r: 0.75 + r2 * 1.15,
      phase: r3 * Math.PI * 2,
      freq: 1.2 + r1 * 1.8,
    });
  }
  return motes;
}

function detectSoftwareGl(): boolean {
  try {
    const probe = document.createElement('canvas');
    const gl =
      probe.getContext('webgl2') ||
      probe.getContext('webgl') ||
      probe.getContext('experimental-webgl');
    if (!gl || !('getParameter' in gl)) return false;
    const wgl = gl as WebGLRenderingContext;
    const ext = wgl.getExtension('WEBGL_debug_renderer_info');
    if (!ext) return false;
    const rendererStr = String(wgl.getParameter(ext.UNMASKED_RENDERER_WEBGL) || '');
    return /SwiftShader|llvmpipe|Software Rasterizer/i.test(rendererStr);
  } catch {
    return false;
  }
}

export function PrismStage({ slotRef }: PrismStageProps) {
  const stageRef = useRef<HTMLDivElement | null>(null);
  const glCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const fxCanvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const stageEl = stageRef.current;
    const glCanvas = glCanvasRef.current;
    const fxCanvas = fxCanvasRef.current;
    if (!stageEl || !glCanvas || !fxCanvas) return;

    const fxCtx = fxCanvas.getContext('2d');
    if (!fxCtx) return;

    const spectrum = buildSpectrum();
    const motes = createMotes(48);
    const reducedMotionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
    const isSoftwareGl = detectSoftwareGl();

    let W = Math.max(1, stageEl.clientWidth);
    let H = Math.max(1, stageEl.clientHeight);
    let dpr = Math.min(window.devicePixelRatio || 1, isSoftwareGl ? 1 : 2);
    let layout: PrismLayout = computeLayout(W, H);

    // Offscreen glow canvases
    const glowLo = document.createElement('canvas');
    const glowLoCtx = glowLo.getContext('2d');
    const glowHi = document.createElement('canvas');
    const glowHiCtx = glowHi.getContext('2d');

    // Aim & interaction state
    const defaultAim = { x: 0.44, y: 0.42 };
    const aim = { x: defaultAim.x, y: defaultAim.y };
    const target = { x: defaultAim.x, y: defaultAim.y };
    let interacting = false;
    let lastInteractAt = -1e9;
    const startTime = performance.now();
    let lastTick = startTime;
    let frameReqId = 0;
    let restTimerId = 0;
    let isVisible = true;
    let disposed = false;

    // Three.js WebGL2 state
    let webglActive = false;
    let renderer: THREE.WebGLRenderer | null = null;
    let fxTex: THREE.CanvasTexture | null = null;
    let rtBg: THREE.WebGLRenderTarget | null = null;
    let rtBack: THREE.WebGLRenderTarget | null = null;
    let rtFront: THREE.WebGLRenderTarget | null = null;
    let scenePrism: THREE.Scene | null = null;
    let camera: THREE.PerspectiveCamera | null = null;
    let prismMesh: THREE.Mesh | null = null;
    let prismGeo: THREE.BufferGeometry | null = null;
    let backMat: THREE.ShaderMaterial | null = null;
    let frontMat: THREE.ShaderMaterial | null = null;
    let quadScene: THREE.Scene | null = null;
    let quadCam: THREE.OrthographicCamera | null = null;
    let quadGeo: THREE.PlaneGeometry | null = null;
    let bgBlendMat: THREE.ShaderMaterial | null = null;
    let copyMat: THREE.ShaderMaterial | null = null;
    let quadMesh: THREE.Mesh | null = null;
    const worldPlanes: THREE.Vector4[] = Array.from({ length: 5 }, () => new THREE.Vector4());

    try {
      const gl2 = glCanvas.getContext('webgl2', {
        alpha: false,
        antialias: !isSoftwareGl,
        premultipliedAlpha: false,
        powerPreference: 'high-performance',
      });
      if (gl2) {
        renderer = new THREE.WebGLRenderer({
          canvas: glCanvas,
          context: gl2,
          alpha: false,
          antialias: !isSoftwareGl,
          powerPreference: 'high-performance',
        });
        renderer.autoClear = false;
        renderer.setPixelRatio(1);

        fxTex = new THREE.CanvasTexture(fxCanvas);
        fxTex.minFilter = THREE.LinearFilter;
        fxTex.magFilter = THREE.LinearFilter;
        fxTex.generateMipmaps = false;
        fxTex.flipY = true;

        const rtOpts: THREE.RenderTargetOptions = {
          minFilter: THREE.LinearFilter,
          magFilter: THREE.LinearFilter,
          format: THREE.RGBAFormat,
          type: THREE.HalfFloatType,
          depthBuffer: true,
        };
        rtBg = new THREE.WebGLRenderTarget(1, 1, rtOpts);
        rtBack = new THREE.WebGLRenderTarget(1, 1, rtOpts);
        rtFront = new THREE.WebGLRenderTarget(1, 1, rtOpts);

        scenePrism = new THREE.Scene();
        camera = new THREE.PerspectiveCamera(FOV_DEG, W / H, 10, 5000);

        backMat = new THREE.ShaderMaterial({
          vertexShader: GLASS_VERT,
          fragmentShader: GLASS_BACK_FRAG,
          side: THREE.BackSide,
          depthWrite: true,
          depthTest: true,
          uniforms: {
            uPlanes: { value: worldPlanes },
            uIor: { value: 1.54 },
            uF0: { value: 0.06 },
            uReflectionStrength: { value: 1.1 },
          },
        });

        frontMat = new THREE.ShaderMaterial({
          vertexShader: GLASS_VERT,
          fragmentShader: GLASS_FRONT_FRAG,
          side: THREE.FrontSide,
          depthWrite: true,
          depthTest: true,
          uniforms: {
            uBgTex: { value: rtBg.texture },
            uViewProj: { value: new THREE.Matrix4() },
            uPlanes: { value: worldPlanes },
            uIor: { value: 1.54 },
            uF0: { value: 0.06 },
            uReflectionStrength: { value: 1.1 },
            uSide: { value: layout.S },
            // Clear optical glass with delicate smoky wine-quartz depth
            uAbsorption: { value: new THREE.Vector3(0.06, 0.22, 0.16) },
          },
        });

        quadScene = new THREE.Scene();
        quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
        quadGeo = new THREE.PlaneGeometry(2, 2);

        bgBlendMat = new THREE.ShaderMaterial({
          vertexShader: BG_BLEND_VERT,
          fragmentShader: BG_BLEND_FRAG,
          depthTest: false,
          depthWrite: false,
          uniforms: {
            uFxTex: { value: fxTex },
            uBgSrgb: { value: new THREE.Vector3(...BG_SRGB) },
          },
        });

        copyMat = new THREE.ShaderMaterial({
          vertexShader: BG_BLEND_VERT,
          fragmentShader: COPY_TO_SCREEN_FRAG,
          depthTest: false,
          depthWrite: false,
          uniforms: {
            uTargetTex: { value: rtBg.texture },
          },
        });

        quadMesh = new THREE.Mesh(quadGeo, bgBlendMat);
        quadScene.add(quadMesh);

        // Keep #fx in layout/render tree without visible overlay so texImage2D stays live
        fxCanvas.style.opacity = '0';
        fxCanvas.style.visibility = 'hidden';
        fxCanvas.style.pointerEvents = 'none';
        webglActive = true;
      }
    } catch {
      webglActive = false;
    }

    const rebuildLayout = () => {
      const stageRect = stageEl.getBoundingClientRect();
      W = Math.max(1, stageRect.width || stageEl.clientWidth);
      H = Math.max(1, stageRect.height || stageEl.clientHeight);
      dpr = Math.min(window.devicePixelRatio || 1, isSoftwareGl ? 1 : 2);

      const slotEl = slotRef?.current;
      if (slotEl) {
        const slotRect = slotEl.getBoundingClientRect();
        const cx = slotRect.left - stageRect.left + slotRect.width / 2;
        const cy = slotRect.top - stageRect.top + slotRect.height / 2;
        const S = Math.min(slotRect.width * 0.88, slotRect.height * 0.88, 250);
        layout = computeLayoutForSlot(W, H, cx, cy, S);
      } else {
        layout = computeLayout(W, H);
      }

      const bw = Math.max(1, Math.round(W * dpr));
      const bh = Math.max(1, Math.round(H * dpr));

      fxCanvas.width = bw;
      fxCanvas.height = bh;

      if (webglActive && renderer && rtBg && rtBack && rtFront && camera && scenePrism) {
        if (fxTex) fxTex.dispose();
        fxTex = new THREE.CanvasTexture(fxCanvas);
        fxTex.minFilter = THREE.LinearFilter;
        fxTex.magFilter = THREE.LinearFilter;
        fxTex.generateMipmaps = false;
        fxTex.flipY = true;
        if (bgBlendMat) {
          bgBlendMat.uniforms.uFxTex.value = fxTex;
        }
      }

      const halfRes = isSoftwareGl ? 0.35 : 0.5;
      glowLo.width = Math.max(1, Math.round(W * halfRes));
      glowLo.height = Math.max(1, Math.round(H * halfRes));
      glowHi.width = Math.max(1, Math.round(W * 0.25));
      glowHi.height = Math.max(1, Math.round(H * 0.25));

      if (webglActive && renderer && rtBg && rtBack && rtFront && camera && scenePrism) {
        renderer.setSize(bw, bh, false);
        rtBg.setSize(bw, bh);
        rtBack.setSize(bw, bh);
        rtFront.setSize(bw, bh);

        const halfFovRad = (FOV_DEG * Math.PI) / 180 / 2;
        const camZ = H / 2 / Math.tan(halfFovRad);
        camera.aspect = W / H;
        camera.position.set(0, 0, camZ);
        camera.lookAt(0, 0, 0);
        camera.near = Math.max(10, camZ - layout.S * 3);
        camera.far = camZ + layout.S * 3;
        camera.updateProjectionMatrix();
        camera.updateMatrixWorld();

        if (prismMesh) scenePrism.remove(prismMesh);
        if (prismGeo) prismGeo.dispose();

        const meshData = createPrismMeshData(layout.S);
        prismGeo = new THREE.BufferGeometry();
        const strideBytes = 6 * 4;
        const interBuffer = new THREE.InterleavedBuffer(meshData.interleaved, 6);
        prismGeo.setAttribute('position', new THREE.InterleavedBufferAttribute(interBuffer, 3, 0));
        prismGeo.setAttribute('normal', new THREE.InterleavedBufferAttribute(interBuffer, 3, 3));
        prismGeo.setIndex(new THREE.BufferAttribute(meshData.indices, 1));
        void strideBytes;

        prismMesh = new THREE.Mesh(prismGeo, backMat!);
        const tx = layout.cx - W / 2;
        const ty = H / 2 - layout.cy;
        prismMesh.position.set(tx, ty, 0);
        prismMesh.updateMatrixWorld();
        scenePrism.add(prismMesh);

        for (let i = 0; i < 5; i++) {
          const p = meshData.planes[i];
          const wn = new THREE.Vector3(p.nx, p.ny, p.nz).normalize();
          const wo = p.offset + wn.x * tx + wn.y * ty;
          worldPlanes[i].set(wn.x, wn.y, wn.z, wo);
        }

        if (frontMat) {
          frontMat.uniforms.uSide.value = layout.S;
        }
      }
    };

    const draw2dOptics = (nowMs: number, dt: number) => {
      const traced = tracePrismOptics(layout, spectrum, aim.x, aim.y);

      fxCtx.save();
      fxCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
      fxCtx.clearRect(0, 0, W, H);

      // Subtle atmospheric champagne-wine halo behind the prism slot
      const ambientGrad = fxCtx.createRadialGradient(
        layout.cx,
        layout.cy,
        layout.S * 0.12,
        layout.cx,
        layout.cy,
        layout.S * 1.45
      );
      ambientGrad.addColorStop(0, 'rgba(255, 30, 102, 0.08)');
      ambientGrad.addColorStop(0.55, 'rgba(133, 13, 55, 0.035)');
      ambientGrad.addColorStop(1, 'rgba(14, 4, 16, 0)');
      fxCtx.fillStyle = ambientGrad;
      fxCtx.fillRect(0, 0, W, H);

      fxCtx.globalCompositeOperation = 'lighter';
      const beamScale = Math.max(0.75, layout.S / 320);

      // Incoming champagne-white ray fan
      const drawIncomingFan = (targetCtx: CanvasRenderingContext2D, scale: number) => {
        const inc = traced.incoming;
        const dx = inc.x1 - inc.x0;
        const dy = inc.y1 - inc.y0;
        const len = Math.hypot(dx, dy) || 1;
        const nx = -dy / len;
        const ny = dx / len;

        const wNear = 2.6 * scale;
        const wFar = 16.0 * scale;
        targetCtx.beginPath();
        targetCtx.moveTo(inc.x0 + nx * wFar, inc.y0 + ny * wFar);
        targetCtx.lineTo(inc.x1 + nx * wNear, inc.y1 + ny * wNear);
        targetCtx.lineTo(inc.x1 - nx * wNear, inc.y1 - ny * wNear);
        targetCtx.lineTo(inc.x0 - nx * wFar, inc.y0 - ny * wFar);
        targetCtx.closePath();

        const g = targetCtx.createLinearGradient(inc.x0, inc.y0, inc.x1, inc.y1);
        g.addColorStop(0, 'rgba(255, 224, 234, 0.08)');
        g.addColorStop(0.55, 'rgba(255, 236, 242, 0.22)');
        g.addColorStop(1, 'rgba(255, 250, 252, 0.48)');
        targetCtx.fillStyle = g;
        targetCtx.fill();

        const core = targetCtx.createLinearGradient(inc.x0, inc.y0, inc.x1, inc.y1);
        core.addColorStop(0, 'rgba(255, 232, 240, 0.14)');
        core.addColorStop(1, 'rgba(255, 255, 255, 0.86)');
        targetCtx.strokeStyle = core;
        targetCtx.lineWidth = 2.4 * scale;
        targetCtx.beginPath();
        targetCtx.moveTo(inc.x0, inc.y0);
        targetCtx.lineTo(inc.x1, inc.y1);
        targetCtx.stroke();
      };

      drawIncomingFan(fxCtx, beamScale);

      // Draw dispersed wavelength quads
      const drawSpectrumQuads = (targetCtx: CanvasRenderingContext2D, alphaMul: number) => {
        for (const group of traced.groups) {
          const baseAlpha = (group.inside ? 0.18 : 0.34) * alphaMul;

          for (let i = 0; i < spectrum.length - 1; i++) {
            const s0 = group.segments[i];
            const s1 = group.segments[i + 1];
            if (!s0 || !s1) continue;

            const sample = spectrum[i];
            const [r, g, b] = sample.balanced;
            const e = 0.5 * (s0.energy + s1.energy);
            const alpha = Math.min(1, baseAlpha * e * sample.weight * spectrum.length * 0.48);
            if (alpha < 0.002) continue;

            targetCtx.beginPath();
            targetCtx.moveTo(s0.x0, s0.y0);
            targetCtx.lineTo(s0.x1, s0.y1);
            targetCtx.lineTo(s1.x1, s1.y1);
            targetCtx.lineTo(s1.x0, s1.y0);
            targetCtx.closePath();

            const R = Math.round(r * 255);
            const G = Math.round(g * 255);
            const B = Math.round(b * 255);

            if (group.inside) {
              targetCtx.fillStyle = `rgba(${R}, ${G}, ${B}, ${alpha.toFixed(4)})`;
            } else {
              const mx0 = (s0.x0 + s1.x0) * 0.5;
              const my0 = (s0.y0 + s1.y0) * 0.5;
              const mx1 = (s0.x1 + s1.x1) * 0.5;
              const my1 = (s0.y1 + s1.y1) * 0.5;
              const grad = targetCtx.createLinearGradient(mx0, my0, mx1, my1);
              grad.addColorStop(0, `rgba(${R}, ${G}, ${B}, ${alpha.toFixed(4)})`);
              grad.addColorStop(0.55, `rgba(${R}, ${G}, ${B}, ${(alpha * 0.42).toFixed(4)})`);
              grad.addColorStop(1, `rgba(${R}, ${G}, ${B}, 0)`);
              targetCtx.fillStyle = grad;
            }
            targetCtx.fill();
          }
        }
      };

      drawSpectrumQuads(fxCtx, 1.0);

      // Two-stage downsampled glow bloom
      if (!isSoftwareGl && glowLoCtx && glowHiCtx) {
        const gScaleX = glowLo.width / W;
        const gScaleY = glowLo.height / H;

        glowLoCtx.save();
        glowLoCtx.setTransform(1, 0, 0, 1, 0, 0);
        glowLoCtx.clearRect(0, 0, glowLo.width, glowLo.height);
        glowLoCtx.scale(gScaleX, gScaleY);
        glowLoCtx.globalCompositeOperation = 'lighter';
        drawIncomingFan(glowLoCtx, beamScale * 1.4);
        drawSpectrumQuads(glowLoCtx, 0.85);
        glowLoCtx.restore();

        glowHiCtx.clearRect(0, 0, glowHi.width, glowHi.height);
        glowHiCtx.filter = 'blur(8px)';
        glowHiCtx.drawImage(glowLo, 0, 0, glowHi.width, glowHi.height);
        glowHiCtx.filter = 'none';

        fxCtx.globalAlpha = 0.42;
        fxCtx.filter = 'blur(8px)';
        fxCtx.drawImage(glowLo, 0, 0, W, H);
        fxCtx.filter = 'blur(14px)';
        fxCtx.globalAlpha = 0.28;
        fxCtx.drawImage(glowHi, 0, 0, W, H);
        fxCtx.filter = 'none';
        fxCtx.globalAlpha = 1;
      }

      // Edge intersection glints
      for (const glint of traced.glints) {
        const r = (18 + glint.energy * 16) * beamScale;
        const grad = fxCtx.createRadialGradient(glint.x, glint.y, 0, glint.x, glint.y, r);
        grad.addColorStop(0, `rgba(255, 240, 246, ${Math.min(0.65, 0.25 + glint.energy * 0.4)})`);
        grad.addColorStop(0.4, `rgba(255, 196, 218, ${Math.min(0.28, glint.energy * 0.22)})`);
        grad.addColorStop(1, 'rgba(255, 30, 102, 0)');
        fxCtx.fillStyle = grad;
        fxCtx.beginPath();
        fxCtx.arc(glint.x, glint.y, r, 0, Math.PI * 2);
        fxCtx.fill();
      }

      // Atmospheric dust motes near the incoming beam
      const inc = traced.incoming;
      const bdx = inc.x1 - inc.x0;
      const bdy = inc.y1 - inc.y0;
      const blen2 = bdx * bdx + bdy * bdy || 1;
      const tSec = nowMs * 0.001;

      for (const m of motes) {
        if (!reducedMotionQuery.matches) {
          m.x = (m.x + m.vx * dt + 1) % 1;
          m.y = (m.y + m.vy * dt + 1) % 1;
        }
        const px = m.x * W;
        const py = m.y * H;

        const proj = Math.max(0, Math.min(1, ((px - inc.x0) * bdx + (py - inc.y0) * bdy) / blen2));
        const cxPt = inc.x0 + bdx * proj;
        const cyPt = inc.y0 + bdy * proj;
        const distBeam = Math.hypot(px - cxPt, py - cyPt);
        const beamBoost = Math.exp(-(distBeam * distBeam) / (46 * 46));
        const flicker = 0.45 + 0.55 * Math.sin(tSec * m.freq + m.phase);
        const alpha = (0.04 + beamBoost * 0.48) * flicker;
        if (alpha < 0.015) continue;

        const hueMix = beamBoost > 0.25 ? '255, 232, 240' : '247, 140, 162';
        fxCtx.fillStyle = `rgba(${hueMix}, ${alpha.toFixed(3)})`;
        fxCtx.beginPath();
        fxCtx.arc(px, py, m.r * (1 + beamBoost * 0.45), 0, Math.PI * 2);
        fxCtx.fill();
      }

      // 2D fallback prism outline if WebGL2 is unavailable
      if (!webglActive) {
        const [v0, v1, v2] = layout.vertices;
        fxCtx.globalCompositeOperation = 'source-over';
        fxCtx.beginPath();
        fxCtx.moveTo(v0.x, v0.y);
        fxCtx.lineTo(v1.x, v1.y);
        fxCtx.lineTo(v2.x, v2.y);
        fxCtx.closePath();
        fxCtx.fillStyle = 'rgba(255, 214, 224, 0.05)';
        fxCtx.fill();
        fxCtx.strokeStyle = 'rgba(255, 214, 224, 0.32)';
        fxCtx.lineWidth = 1.5;
        fxCtx.stroke();
      }

      fxCtx.restore();
    };

    const renderThree = () => {
      if (
        !webglActive ||
        !renderer ||
        !fxTex ||
        !rtBg ||
        !rtBack ||
        !rtFront ||
        !scenePrism ||
        !camera ||
        !prismMesh ||
        !backMat ||
        !frontMat ||
        !quadScene ||
        !quadCam ||
        !quadMesh ||
        !bgBlendMat ||
        !copyMat
      ) {
        return;
      }

      fxTex.needsUpdate = true;

      // 1. Background blend pass (#0e0410 + incoming white beam + dispersed spectrum) -> rtBg
      quadMesh.material = bgBlendMat;
      renderer.setRenderTarget(rtBg);
      renderer.clear(true, true, false);
      renderer.render(quadScene, quadCam);

      // 2. Back-face TIR internal reflection pass -> rtBack
      prismMesh.material = backMat;
      renderer.setRenderTarget(rtBack);
      renderer.clear(true, true, false);
      renderer.render(scenePrism, camera);

      // 3. Draw background + rays onto screen first, then render refracting 3D prism front faces on top
      copyMat.uniforms.uTargetTex.value = rtBg.texture;
      quadMesh.material = copyMat;
      renderer.setRenderTarget(null);
      renderer.clear(true, true, false);
      renderer.render(quadScene, quadCam);

      frontMat.uniforms.uViewProj.value.multiplyMatrices(
        camera.projectionMatrix,
        camera.matrixWorldInverse
      );
      prismMesh.material = frontMat;
      renderer.clearDepth();
      renderer.render(scenePrism, camera);
    };

    const afterDraw = (tick: (now: number) => void) => {
      if (reducedMotionQuery.matches || !isVisible || disposed) return;
      if (isSoftwareGl) {
        window.clearTimeout(restTimerId);
        restTimerId = window.setTimeout(() => {
          if (!disposed && isVisible) {
            frameReqId = requestAnimationFrame(tick);
          }
        }, 220);
      } else {
        frameReqId = requestAnimationFrame(tick);
      }
    };

    const tick = (now: number) => {
      if (disposed || !isVisible) return;
      const dt = Math.min(0.05, Math.max(0.001, (now - lastTick) * 0.001));
      lastTick = now;

      const idleAge = (now - lastInteractAt) * 0.001;
      const isIdle = !interacting && idleAge > 4.5;
      const tSec = (now - startTime) * 0.001;

      if (reducedMotionQuery.matches) {
        target.x = defaultAim.x;
        target.y = defaultAim.y;
      } else if (layout.mobile || isIdle) {
        target.x = 0.44 + Math.sin(tSec * 0.42) * 0.22;
        target.y = 0.45 + Math.cos(tSec * 0.34) * 0.14;
      }

      const ease = 1 - Math.exp(-dt * (interacting ? 12 : 4.5));
      aim.x += (target.x - aim.x) * ease;
      aim.y += (target.y - aim.y) * ease;

      draw2dOptics(now, dt);
      renderThree();
      afterDraw(tick);
    };

    const setPointerTarget = (clientX: number, clientY: number) => {
      const rect = stageEl.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return;
      const nx = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
      const ny = Math.max(0, Math.min(1, (clientY - rect.top) / rect.height));
      target.x = ny;
      target.y = nx;
      interacting = true;
      lastInteractAt = performance.now();
    };

    const listenTarget = stageEl.parentElement || stageEl;
    const onPointerMove = (e: PointerEvent) => setPointerTarget(e.clientX, e.clientY);
    const onPointerDown = (e: PointerEvent) => setPointerTarget(e.clientX, e.clientY);
    const onPointerLeave = () => {
      interacting = false;
      lastInteractAt = performance.now();
    };
    const onTouchMove = (e: TouchEvent) => {
      if (e.touches[0]) {
        setPointerTarget(e.touches[0].clientX, e.touches[0].clientY);
      }
    };

    listenTarget.addEventListener('pointermove', onPointerMove, { passive: true });
    listenTarget.addEventListener('pointerdown', onPointerDown, { passive: true });
    listenTarget.addEventListener('pointerleave', onPointerLeave, { passive: true });
    listenTarget.addEventListener('touchmove', onTouchMove, { passive: true });

    const resizeObserver = new ResizeObserver(() => {
      rebuildLayout();
      if (reducedMotionQuery.matches) {
        draw2dOptics(performance.now(), 0.016);
        renderThree();
      }
    });
    resizeObserver.observe(stageEl);
    if (slotRef?.current) resizeObserver.observe(slotRef.current);

    const onWindowResize = () => rebuildLayout();
    window.addEventListener('resize', onWindowResize);

    const io = new IntersectionObserver(
      (entries) => {
        const nowVisible = entries[0]?.isIntersecting ?? true;
        const wasVisible = isVisible;
        isVisible = nowVisible;
        if (isVisible && !wasVisible && !reducedMotionQuery.matches && !disposed) {
          lastTick = performance.now();
          frameReqId = requestAnimationFrame(tick);
        }
      },
      { threshold: 0.01 }
    );
    io.observe(stageEl);

    rebuildLayout();
    draw2dOptics(performance.now(), 0.016);
    renderThree();
    if (!reducedMotionQuery.matches) {
      frameReqId = requestAnimationFrame(tick);
    }

    return () => {
      disposed = true;
      cancelAnimationFrame(frameReqId);
      window.clearTimeout(restTimerId);
      resizeObserver.disconnect();
      io.disconnect();
      window.removeEventListener('resize', onWindowResize);
      listenTarget.removeEventListener('pointermove', onPointerMove);
      listenTarget.removeEventListener('pointerdown', onPointerDown);
      listenTarget.removeEventListener('pointerleave', onPointerLeave);
      listenTarget.removeEventListener('touchmove', onTouchMove);

      if (prismGeo) prismGeo.dispose();
      if (backMat) backMat.dispose();
      if (frontMat) frontMat.dispose();
      if (quadGeo) quadGeo.dispose();
      if (bgBlendMat) bgBlendMat.dispose();
      if (copyMat) copyMat.dispose();
      if (fxTex) fxTex.dispose();
      if (rtBg) rtBg.dispose();
      if (rtBack) rtBack.dispose();
      if (rtFront) rtFront.dispose();
      if (renderer) renderer.dispose();
    };
  }, [slotRef]);

  return (
    <div ref={stageRef} className="prism-stage pointer-events-none" aria-hidden="true">
      <canvas id="gl" ref={glCanvasRef} />
      <canvas id="fx" ref={fxCanvasRef} />
    </div>
  );
}
