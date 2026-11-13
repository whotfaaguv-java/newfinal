import { useEffect, useRef } from 'react';

export function WineNebulaCanvas() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
    let animId = 0;
    let w = (canvas.width = window.innerWidth);
    let h = (canvas.height = window.innerHeight);

    const handleResize = () => {
      w = canvas.width = window.innerWidth;
      h = canvas.height = window.innerHeight;
    };
    window.addEventListener('resize', handleResize);

    const count = 48;
    const nodes = Array.from({ length: count }, () => ({
      x: Math.random() * w,
      y: Math.random() * h,
      vx: (Math.random() - 0.5) * 0.45,
      vy: (Math.random() - 0.5) * 0.45,
      radius: Math.random() * 1.8 + 0.6,
      pulse: Math.random() * Math.PI * 2,
      color: Math.random() > 0.35 ? '#ff1e66' : '#ffd6e0',
    }));

    const mouse = { x: -1000, y: -1000 };
    const handleMouseMove = (e: MouseEvent) => {
      mouse.x = e.clientX;
      mouse.y = e.clientY;
    };
    window.addEventListener('mousemove', handleMouseMove, { passive: true });

    let isVisible = false;
    const observer = new IntersectionObserver(
      (entries) => {
        const nowVisible = entries[0]?.isIntersecting ?? false;
        const wasVisible = isVisible;
        isVisible = nowVisible;
        if (isVisible && !wasVisible && !motionQuery.matches) {
          animId = requestAnimationFrame(loop);
        }
      },
      { threshold: 0.01 }
    );
    observer.observe(canvas);

    const drawFrame = () => {
      ctx.clearRect(0, 0, w, h);

      const grad = ctx.createRadialGradient(
        w * 0.7,
        h * 0.3,
        100,
        w * 0.5,
        h * 0.5,
        Math.max(w, h)
      );
      grad.addColorStop(0, '#10020a');
      grad.addColorStop(0.5, '#060107');
      grad.addColorStop(1, '#020003');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, w, h);

      for (let i = 0; i < nodes.length; i++) {
        const p = nodes[i];
        if (!motionQuery.matches) {
          p.x += p.vx;
          p.y += p.vy;
          p.pulse += 0.03;

          if (p.x < 0 || p.x > w) p.vx *= -1;
          if (p.y < 0 || p.y > h) p.vy *= -1;

          const dx = mouse.x - p.x;
          const dy = mouse.y - p.y;
          const dist = Math.hypot(dx, dy);
          if (dist < 120 && dist > 0.001) {
            const force = (1 - dist / 120) * 2;
            p.x -= (dx / dist) * force;
            p.y -= (dy / dist) * force;
          }
        }

        const currentR = Math.max(0.5, p.radius + Math.sin(p.pulse) * 0.4);
        ctx.beginPath();
        ctx.arc(p.x, p.y, currentR * 2.6, 0, Math.PI * 2);
        ctx.fillStyle = p.color === '#ff1e66' ? 'rgba(255, 30, 102, 0.16)' : 'rgba(255, 214, 224, 0.14)';
        ctx.fill();

        ctx.beginPath();
        ctx.arc(p.x, p.y, currentR, 0, Math.PI * 2);
        ctx.fillStyle = p.color;
        ctx.fill();

        for (let j = i + 1; j < nodes.length; j++) {
          const p2 = nodes[j];
          const d = Math.hypot(p.x - p2.x, p.y - p2.y);
          if (d < 140) {
            const alpha = (1 - d / 140) * 0.16;
            ctx.strokeStyle = `rgba(255, 30, 102, ${alpha})`;
            ctx.lineWidth = 0.65;
            ctx.beginPath();
            ctx.moveTo(p.x, p.y);
            ctx.lineTo(p2.x, p2.y);
            ctx.stroke();
          }
        }
      }
    };

    let isSoftwareGl = false;
    try {
      const probe = document.createElement('canvas');
      const gl = probe.getContext('webgl2') || probe.getContext('webgl');
      if (gl && 'getParameter' in gl) {
        const ext = (gl as WebGLRenderingContext).getExtension('WEBGL_debug_renderer_info');
        if (ext) {
          const str = String((gl as WebGLRenderingContext).getParameter(ext.UNMASKED_RENDERER_WEBGL) || '');
          isSoftwareGl = /SwiftShader|llvmpipe|Software Rasterizer/i.test(str);
        }
      }
    } catch {
      isSoftwareGl = false;
    }

    let restTimer = 0;
    const loop = () => {
      if (!isVisible) return;
      drawFrame();
      if (!motionQuery.matches) {
        if (isSoftwareGl) {
          window.clearTimeout(restTimer);
          restTimer = window.setTimeout(() => {
            if (isVisible) animId = requestAnimationFrame(loop);
          }, 220);
        } else {
          animId = requestAnimationFrame(loop);
        }
      }
    };
    drawFrame();

    return () => {
      observer.disconnect();
      window.removeEventListener('resize', handleResize);
      window.removeEventListener('mousemove', handleMouseMove);
      window.clearTimeout(restTimer);
      cancelAnimationFrame(animId);
    };
  }, []);

  return <canvas ref={canvasRef} className="fixed inset-0 w-full h-full pointer-events-none z-0" />;
}
