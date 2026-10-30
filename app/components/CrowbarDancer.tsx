import { useEffect, useRef } from "react";
import {
  BAR_LENGTH, BLOCK_PIVOT, CRAG, DANCE_DURATION, DANCE_EFFECTS, DANCE_REST_TIME, PRY_AT, STAGE,
  barPoint, blockTilt, drawDancer, poseAt, skeletonAt, solve,
} from "./crowbarDance";
import type { DanceEffect, Helmet, Point, Skeleton } from "./crowbarDance";

interface CrowbarDancerProps {
  className?: string;
  /** A helmet for the dancer, dropped onto his head whenever it changes. */
  helmet?: Helmet | null;
}

interface Particle {
  kind: "spark" | "dust" | "ring" | "flash" | "rock";
  x: number;
  y: number;
  vx: number;
  vy: number;
  age: number;
  life: number;
  size: number;
  spin: number;
  angle: number;
  shape?: Point[];
}

/** A falling rock scripted to meet the crowbar exactly when the swing lands. */
interface Incoming { from: Point; start: number; arrive: number; to: Point; shape: Point[] }

const GOLD = "#e2a72e";
const STONE = "#c9bea7";
const GRAVITY = 420;
/** Share of the claw's yank the block keeps as it breaks free; the rest is lost as the claw slips off. */
const CARRY = 0.6;
const SAMPLE = 1 / 70;

const effectTime = (fx: DanceEffect) => DANCE_EFFECTS.find((effect) => effect.fx === fx)?.t ?? 0;
const WHACK_AT = effectTime("whack");
const hookTip = (s: Skeleton) => barPoint(s, BAR_LENGTH - 2, 9);

function rockShape(radius: number): Point[] {
  const corners = 6 + Math.floor(Math.random() * 3);
  return Array.from({ length: corners }, (_, i) => {
    const angle = (i / corners) * Math.PI * 2 + Math.random() * 0.5;
    const r = radius * (0.7 + Math.random() * 0.4);
    return { x: Math.cos(angle) * r, y: Math.sin(angle) * r };
  });
}

const toPoints = (list: readonly (readonly [number, number])[]) => list.map(([x, y]) => ({ x, y }));
const CRAG_OUTLINE = toPoints(CRAG.outline);
const CRAG_BLOCK = toPoints(CRAG.block);
const BLOCK_CENTER = {
  x: CRAG_BLOCK.reduce((sum, p) => sum + p.x, 0) / CRAG_BLOCK.length,
  y: CRAG_BLOCK.reduce((sum, p) => sum + p.y, 0) / CRAG_BLOCK.length,
};
/** Where the block's centre sits once levered out by `tilt` radians around its pivot. */
const blockCenter = (tilt: number): Point => {
  const dx = BLOCK_CENTER.x - BLOCK_PIVOT.x;
  const dy = BLOCK_CENTER.y - BLOCK_PIVOT.y;
  return { x: BLOCK_PIVOT.x + dx * Math.cos(tilt) - dy * Math.sin(tilt), y: BLOCK_PIVOT.y + dx * Math.sin(tilt) + dy * Math.cos(tilt) };
};

/** Height of a newly given helmet above the head, `age` seconds after it was given: it falls on, then bounces once. */
function helmetDrop(age: number) {
  if (age < 0.32) return 20 * (1 - (age / 0.32) ** 2);
  if (age < 0.5) return 2.5 * Math.sin(((age - 0.32) / 0.18) * Math.PI);
  return 0;
}

function tracePolygon(ctx: CanvasRenderingContext2D, points: Point[]) {
  ctx.beginPath();
  points.forEach((p, i) => {
    if (i === 0) ctx.moveTo(p.x, p.y);
    else ctx.lineTo(p.x, p.y);
  });
  ctx.closePath();
}

/**
 * A small stick figure who dances with the Golden Crowbar, then cleans a loose block off a crag.
 * Purely decorative: hidden from assistive tech, paused offscreen, and frozen on one pose for reduced motion.
 */
export function CrowbarDancer({ className, helmet = null }: CrowbarDancerProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  // Read by the running animation, so a new helmet doesn't restart the dance. The first one is already on.
  const helmetRef = useRef({ helmet, since: -Infinity });
  const redrawRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    if (helmetRef.current.helmet === helmet) return;
    helmetRef.current = { helmet, since: performance.now() };
    // Paused or reduced-motion canvases only repaint on demand.
    redrawRef.current?.();
  }, [helmet]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;

    const ink = getComputedStyle(canvas).color;
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let width = 0;
    let height = 0;
    let frame = 0;
    let stoppedAt = 0;
    let last = 0;
    let clock = 0;
    let loopTime = 0;
    let shake = 0;
    let particles: Particle[] = [];
    let incoming: Incoming | null = null;

    const spawn = (p: Partial<Particle> & Pick<Particle, "kind" | "x" | "y" | "life">) => {
      particles.push({ vx: 0, vy: 0, age: 0, size: 1, spin: 0, angle: 0, ...p });
    };
    const dust = (x: number, count: number, spread: number) => {
      for (let i = 0; i < count; i++) {
        const side = i % 2 ? 1 : -1;
        spawn({ kind: "dust", x: x + side * Math.random() * 4, y: STAGE.ground - 1, vx: side * (10 + Math.random() * spread), vy: -4 - Math.random() * 8, life: 0.5 + Math.random() * 0.4, size: 2 + Math.random() * 2 });
      }
    };
    const sparks = (at: Point, count: number, speed: number, bias = 0) => {
      for (let i = 0; i < count; i++) {
        const angle = -Math.PI / 2 + bias + (Math.random() - 0.5) * Math.PI * 1.1;
        const v = speed * (0.5 + Math.random() * 0.7);
        spawn({ kind: "spark", x: at.x, y: at.y, vx: Math.cos(angle) * v, vy: Math.sin(angle) * v, life: 0.3 + Math.random() * 0.35 });
      }
    };

    const trigger = (fx: DanceEffect, t: number) => {
      const s = skeletonAt(t);
      if (fx === "step") dust(s.footA.x, 2, 14);
      if (fx === "land") { dust(s.footA.x, 4, 24); dust(s.footB.x, 3, 20); }
      if (fx === "slam") {
        const hit = { x: hookTip(s).x, y: Math.min(hookTip(s).y, STAGE.ground) };
        sparks(hit, 16, 170);
        spawn({ kind: "ring", x: hit.x, y: STAGE.ground, life: 0.5, size: 55 });
        spawn({ kind: "flash", x: hit.x, y: hit.y, life: 0.16, size: 26 });
        dust(hit.x, 6, 40);
        shake = 1;
      }
      if (fx === "hook") sparks(hookTip(s), 4, 60, -Math.PI / 2);
      if (fx === "creak") {
        // Grit trickles out of the opening crack.
        for (let i = 0; i < 3; i++) {
          spawn({ kind: "rock", x: 397 + Math.random() * 2, y: 80 + Math.random() * 12, vx: -6 - Math.random() * 12, vy: -10, life: 0.9, size: 0.9, spin: 8, shape: rockShape(0.9) });
        }
        spawn({ kind: "dust", x: 396, y: 88, vx: -8, vy: 4, life: 0.6, size: 1.5 });
        shake = 0.12;
      }
      if (fx === "pry") {
        // The block leaves the wall where the claw left it, still moving and turning the way it was being carried.
        const before = blockTilt(t - 1 / 60);
        const tilt = blockTilt(t);
        const from = blockCenter(before);
        const at = blockCenter(tilt);
        const shape = CRAG_BLOCK.map((p) => ({ x: p.x - BLOCK_CENTER.x, y: p.y - BLOCK_CENTER.y }));
        const carry = 60 * CARRY;
        spawn({ kind: "rock", x: at.x, y: at.y, vx: (at.x - from.x) * carry, vy: (at.y - from.y) * carry, angle: tilt, spin: (tilt - before) * carry, life: 2.4, size: 9, shape });
        for (let i = 0; i < 5; i++) {
          const angle = -Math.PI * (0.55 + Math.random() * 0.4);
          const v = 40 + Math.random() * 60;
          spawn({ kind: "rock", x: 397, y: 76 + Math.random() * 18, vx: Math.cos(angle) * v, vy: Math.sin(angle) * v, life: 1.2, size: 1.2, spin: (Math.random() - 0.5) * 16, shape: rockShape(1 + Math.random()) });
        }
        dust(BLOCK_PIVOT.x - 2, 3, 18);
        spawn({ kind: "dust", x: 396, y: 84, vx: -14, vy: -6, life: 0.7, size: 3 });
        shake = 0.5;
      }
      if (fx === "drop") {
        const arrive = WHACK_AT;
        incoming = { from: { x: 372, y: -14 }, start: t, arrive, to: hookTip(skeletonAt(arrive)), shape: rockShape(6) };
      }
      if (fx === "whack" && incoming) {
        // Smash the falling rock to bits.
        const at = incoming.to;
        for (let i = 0; i < 6; i++) {
          const angle = -Math.PI * (0.15 + Math.random() * 0.7);
          const v = 70 + Math.random() * 110;
          const radius = 1.6 + Math.random() * 2;
          spawn({ kind: "rock", x: at.x, y: at.y, vx: Math.cos(angle) * v - 40, vy: Math.sin(angle) * v, life: 1.6, size: radius, spin: (Math.random() - 0.5) * 20, shape: rockShape(radius) });
        }
        sparks(at, 14, 160);
        spawn({ kind: "flash", x: at.x, y: at.y, life: 0.14, size: 22 });
        incoming = null;
        shake = 0.6;
      }
    };

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      width = rect.width;
      height = rect.height;
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      draw(0);
    };

    const step = (dt: number) => {
      for (const p of particles) {
        p.age += dt;
        if (p.kind === "spark" || p.kind === "rock") {
          p.vy += GRAVITY * dt;
          p.x += p.vx * dt;
          p.y += p.vy * dt;
          p.angle += p.spin * dt;
          // Rocks come to rest on their rough radius, held in `size`.
          const floor = STAGE.ground - (p.kind === "rock" ? p.size : 0);
          if (p.y > floor) {
            p.y = floor;
            p.vy *= p.kind === "rock" ? -0.35 : -0.3;
            p.vx *= 0.6;
            p.spin *= 0.6;
          }
        } else if (p.kind === "dust") {
          p.x += p.vx * dt;
          p.y += p.vy * dt;
          p.vx *= 1 - 2.5 * dt;
        }
      }
      particles = particles.filter((p) => p.age < p.life);
      shake = Math.max(0, shake - dt * 4);
    };

    const drawCrag = () => {
      ctx.save();
      tracePolygon(ctx, CRAG_OUTLINE);
      ctx.fillStyle = "#efe8da";
      ctx.fill();
      ctx.strokeStyle = ink;
      ctx.globalAlpha = 0.35;
      ctx.lineWidth = 1.2;
      ctx.stroke();
      ctx.globalAlpha = 0.5;
      ctx.fillStyle = "#8d8271";
      for (const [x, y] of CRAG.bolts) {
        ctx.beginPath();
        ctx.arc(x, y, 1.6, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    };

    // The block sits in the crag until it breaks free, and settles back in as the loop restarts.
    // It is drawn over the dancer so the claw tucks in behind it.
    const drawBlock = (t: number) => {
      if (t > PRY_AT) return;
      ctx.save();
      ctx.globalAlpha = Math.min(1, t / 0.6);
      ctx.translate(BLOCK_PIVOT.x, BLOCK_PIVOT.y);
      ctx.rotate(blockTilt(t));
      ctx.translate(-BLOCK_PIVOT.x, -BLOCK_PIVOT.y);
      tracePolygon(ctx, CRAG_BLOCK);
      ctx.fillStyle = STONE;
      ctx.fill();
      ctx.strokeStyle = ink;
      ctx.lineWidth = 1;
      ctx.globalAlpha *= 0.6;
      ctx.stroke();
      ctx.restore();
    };

    const drawRock = (x: number, y: number, angle: number, shape: Point[], alpha: number) => {
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(angle);
      ctx.globalAlpha = alpha;
      tracePolygon(ctx, shape);
      ctx.fillStyle = STONE;
      ctx.fill();
      ctx.strokeStyle = ink;
      ctx.lineWidth = 1;
      ctx.globalAlpha = alpha * 0.6;
      ctx.stroke();
      ctx.restore();
    };

    /** Golden arcs where the crowbar has just been, sampled from the recent past. */
    const drawSmear = (t: number) => {
      const samples = Array.from({ length: 8 }, (_, k) => skeletonAt(t - k * SAMPLE));
      ctx.save();
      ctx.fillStyle = "#f2c14e";
      for (const [from, to] of [[0.62, 1], [0, 0.32]] as const) {
        for (let k = 0; k < samples.length - 1; k++) {
          const a1 = barPoint(samples[k], from * BAR_LENGTH);
          const a2 = barPoint(samples[k], to * BAR_LENGTH);
          const b1 = barPoint(samples[k + 1], from * BAR_LENGTH);
          const b2 = barPoint(samples[k + 1], to * BAR_LENGTH);
          const moved = Math.hypot(a2.x - b2.x, a2.y - b2.y);
          if (moved < 1.4) continue;
          ctx.globalAlpha = Math.min(1, moved / 6) * 0.3 * (1 - k / samples.length);
          ctx.beginPath();
          ctx.moveTo(a1.x, a1.y);
          ctx.lineTo(a2.x, a2.y);
          ctx.lineTo(b2.x, b2.y);
          ctx.lineTo(b1.x, b1.y);
          ctx.closePath();
          ctx.fill();
        }
      }
      ctx.restore();
    };

    const drawParticles = () => {
      for (const p of particles) {
        const fade = 1 - p.age / p.life;
        ctx.save();
        if (p.kind === "spark") {
          ctx.strokeStyle = p.age < 0.08 ? "#fff6d6" : GOLD;
          ctx.globalAlpha = fade;
          ctx.lineWidth = 1.2;
          ctx.lineCap = "round";
          ctx.beginPath();
          ctx.moveTo(p.x, p.y);
          ctx.lineTo(p.x - p.vx * 0.025, p.y - p.vy * 0.025);
          ctx.stroke();
        } else if (p.kind === "dust") {
          ctx.fillStyle = "#b8a684";
          ctx.globalAlpha = fade * 0.35;
          ctx.beginPath();
          ctx.arc(p.x, p.y, p.size * (1 + p.age * 3), 0, Math.PI * 2);
          ctx.fill();
        } else if (p.kind === "ring") {
          const r = p.size * (1 - fade * fade);
          ctx.strokeStyle = GOLD;
          ctx.globalAlpha = fade * 0.7;
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.ellipse(p.x, p.y, r, r * 0.16, 0, 0, Math.PI * 2);
          ctx.stroke();
        } else if (p.kind === "flash") {
          const glow = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.size);
          glow.addColorStop(0, "rgba(255, 246, 214, 0.95)");
          glow.addColorStop(0.4, "rgba(242, 193, 78, 0.45)");
          glow.addColorStop(1, "rgba(242, 193, 78, 0)");
          ctx.globalAlpha = fade;
          ctx.fillStyle = glow;
          ctx.beginPath();
          ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
          ctx.fill();
        } else if (p.kind === "rock" && p.shape) {
          ctx.restore();
          drawRock(p.x, p.y, p.angle, p.shape, Math.min(1, fade * 3));
          continue;
        }
        ctx.restore();
      }
    };

    /** A star that runs along the crowbar now and then. */
    const drawGlint = (t: number, s: Skeleton) => {
      const phase = (t % 2.7) / 0.45;
      if (phase > 1) return;
      const at = barPoint(s, phase * (BAR_LENGTH - 6));
      const r = 4 * Math.sin(phase * Math.PI);
      ctx.save();
      ctx.fillStyle = "#fffbea";
      ctx.beginPath();
      ctx.moveTo(at.x, at.y - r);
      ctx.quadraticCurveTo(at.x, at.y, at.x + r, at.y);
      ctx.quadraticCurveTo(at.x, at.y, at.x, at.y + r);
      ctx.quadraticCurveTo(at.x, at.y, at.x - r, at.y);
      ctx.quadraticCurveTo(at.x, at.y, at.x, at.y - r);
      ctx.fill();
      ctx.restore();
    };

    const draw = (dt: number) => {
      const t = loopTime;
      const dpr = canvas.width / Math.max(1, width);
      const scale = Math.min(width / STAGE.width, height / STAGE.height);
      const offsetX = (width - STAGE.width * scale) / 2;
      const offsetY = height - STAGE.height * scale;
      const jolt = shake * 1.6;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.setTransform(dpr * scale, 0, 0, dpr * scale, dpr * (offsetX + Math.sin(clock * 97) * jolt * scale), dpr * (offsetY + Math.cos(clock * 83) * jolt * scale));

      const { pose, free } = poseAt(t);
      const s = solve(pose, free);
      const { helmet, since } = helmetRef.current;
      const helmetLift = reduceMotion ? 0 : helmetDrop((performance.now() - since) / 1000);

      // Floor, fading out at the edges, and the dancer's shadow.
      const floor = ctx.createLinearGradient(0, 0, STAGE.width, 0);
      floor.addColorStop(0, "rgba(226, 167, 46, 0)");
      floor.addColorStop(0.15, "rgba(226, 167, 46, 0.55)");
      floor.addColorStop(1, "rgba(226, 167, 46, 0.55)");
      ctx.fillStyle = floor;
      ctx.fillRect(0, STAGE.ground, STAGE.width, 1);
      const lift = Math.max(0, STAGE.ground - Math.max(s.footA.y, s.footB.y));
      ctx.save();
      ctx.globalAlpha = Math.max(0.04, 0.16 - lift * 0.002);
      ctx.fillStyle = ink;
      ctx.beginPath();
      ctx.ellipse(s.hip.x, STAGE.ground + 1, Math.max(8, 20 - lift * 0.15), 2.2, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();

      drawCrag();

      if (incoming) {
        const { from, to, start, arrive, shape } = incoming;
        const span = ((arrive - start) + DANCE_DURATION) % DANCE_DURATION;
        const elapsed = Math.min(span, ((t - start) + DANCE_DURATION) % DANCE_DURATION);
        // Ballistic path from `from` that reaches `to` at `arrive`.
        const vx = (to.x - from.x) / span;
        const vy = (to.y - from.y - 0.5 * GRAVITY * span * span) / span;
        drawRock(from.x + vx * elapsed, from.y + vy * elapsed + 0.5 * GRAVITY * elapsed * elapsed, elapsed * 6, shape, 1);
      }

      if (pose.blur > 0.02) {
        for (let k = 3; k >= 1; k--) drawDancer(ctx, skeletonAt(t - k * 0.045), ink, pose.blur * 0.14 * (4 - k) / 3, helmet, helmetLift);
      }
      drawSmear(t);
      drawDancer(ctx, s, ink, 1, helmet, helmetLift);
      drawGlint(t, s);
      drawBlock(t);
      drawParticles();
      if (dt > 0) step(dt);
    };

    const tick = (now: number) => {
      // Cap the step so a background tab or a long frame doesn't fling particles or skip effects wholesale.
      const dt = last ? Math.min(0.05, (now - last) / 1000) : 0;
      last = now;
      clock += dt;
      const previous = loopTime;
      loopTime = clock % DANCE_DURATION;
      for (const { t, fx } of DANCE_EFFECTS) {
        const crossed = previous <= loopTime ? t > previous && t <= loopTime : t > previous || t <= loopTime;
        if (dt > 0 && crossed) trigger(fx, t);
      }
      draw(dt);
      frame = requestAnimationFrame(tick);
    };

    const start = () => {
      if (frame || reduceMotion) return;
      // A helmet chosen while the dancer was scrolled away drops on when he comes back into view.
      if (helmetRef.current.since > stoppedAt) helmetRef.current.since = performance.now();
      last = 0;
      frame = requestAnimationFrame(tick);
    };
    const stop = () => {
      cancelAnimationFrame(frame);
      frame = 0;
      stoppedAt = performance.now();
    };

    if (reduceMotion) loopTime = DANCE_REST_TIME;
    redrawRef.current = () => draw(0);
    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(canvas);
    const visibility = new IntersectionObserver(([entry]) => (entry.isIntersecting ? start() : stop()));
    visibility.observe(canvas);

    return () => {
      redrawRef.current = null;
      stop();
      resizeObserver.disconnect();
      visibility.disconnect();
    };
  }, []);

  return <canvas ref={canvasRef} className={className} aria-hidden="true" />;
}
