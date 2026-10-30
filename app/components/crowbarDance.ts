/**
 * Choreography and skeleton for the Golden Crowbar stick-figure dancer.
 * Poses are keyframed joint angles joined by smooth splines. Every frame is a pure function of time,
 * so the renderer can sample the recent past for smears and afterimages without keeping history.
 */

export interface Point { x: number; y: number }

/** Stage units. The canvas scales this box to fit and anchors it to the floor. */
export const STAGE = { width: 420, height: 150, ground: 140 } as const;

/** The crag on the right edge, and the loose block the dancer pries off it. */
export const CRAG = {
  face: 386,
  outline: [[420, 140], [388, 140], [384, 118], [389, 96], [385, 74], [392, 52], [389, 30], [398, 12], [420, 6]],
  block: [[385, 74], [389, 96], [398, 94], [399, 78], [393, 72]],
  bolts: [[402, 120], [404, 92], [401, 64], [406, 38]],
} as const;

const BONE = { head: 6.5, neck: 2.5, torso: 25, upperArm: 14, forearm: 14, thigh: 19, shin: 19 } as const;
export const BAR_LENGTH = 50;

/**
 * Angles are degrees in the body frame of a figure facing right: 0 points down, 90 forward, 180 up.
 * Torso, upper arms, thighs and the crowbar are absolute; elbows add to the upper arm and knees bend back from the thigh.
 * Arm A is the near arm and always owns the crowbar; arm B reaches for it as `two` rises toward 1.
 */
export interface Pose {
  x: number;
  /** Height of the lowest body part above the floor; the hips are placed from this. */
  air: number;
  /** Whole-body rotation, for flips. */
  rot: number;
  /** Horizontal facing scale: 1 right, -1 left. Passing through zero reads as a paper-cutout spin. */
  f: number;
  torso: number;
  head: number;
  uaA: number;
  elA: number;
  uaB: number;
  elB: number;
  thA: number;
  knA: number;
  thB: number;
  knB: number;
  bar: number;
  /** Where hand A holds the crowbar, from the chisel end (0) to the hook (1). */
  grip: number;
  /** How far arm B has reached for the crowbar (0â€“1), and where along it that hand lands. */
  two: number;
  grip2: number;
  /** Stage position of the grip point while the crowbar is airborne. Derived for keys where it is held. */
  bx: number;
  by: number;
  /** Strength of afterimages for fast moves. */
  blur: number;
  /** Degrees of muscle tremor while straining against the lever. */
  strain: number;
}

export type DanceEffect = "step" | "land" | "slam" | "hook" | "creak" | "pry" | "drop" | "whack";

interface Key extends Partial<Pose> {
  /** Seconds after the previous key. */
  d: number;
  /** The crowbar is airborne at this key. */
  free?: boolean;
  /** Arrive and leave at rest, for hits and holds. */
  still?: boolean;
  /** The pose shown alone when motion is reduced. */
  rest?: boolean;
  fx?: DanceEffect;
}

interface Frame { t: number; pose: Pose; free: boolean; still: boolean; rest: boolean; fx?: DanceEffect }

const STANCE = { torso: 174, head: 0, thA: 24, knA: 34, thB: -20, knB: 18 };
const READY: Pose = {
  x: 70, air: 0, rot: 0, f: 1, ...STANCE,
  uaA: 25, elA: 70, uaB: 15, elB: 50,
  bar: 140, grip: 0.42, two: 1, grip2: 0.14, bx: 0, by: 0, blur: 0, strain: 0,
};
const CHANNELS = Object.keys(READY) as (keyof Pose)[];
/** Channels that may wind up by whole turns over the loop. */
const TURNING: (keyof Pose)[] = ["rot", "bar"];

const TUCK = { thA: 125, knA: 145, thB: 115, knB: 140 };
const CROUCH = { thA: 55, knA: 85, thB: 15, knB: 80 };

/** A tucked backflip from a crouch, travelling `dx` and landing in a crouch. Rotation leads height so it lands feet first. */
function backTuck(x: number, dx: number, rot: number, bar: number): Key[] {
  return [
    { d: 0.1, x: x + dx * 0.1, air: 10, rot: rot + 25, torso: 186, thA: 10, knA: 5, thB: 0, knB: 5, uaA: 160, elA: 10, uaB: 150, elB: 10, bar: bar + 20 },
    { d: 0.2, x: x + dx * 0.5, air: 40, rot: rot + 190, torso: 175, ...TUCK, uaA: 110, elA: 40, uaB: 100, elB: 40, bar: bar + 50, blur: 0.5 },
    { d: 0.16, x: x + dx * 0.85, air: 16, rot: rot + 330, thA: 40, knA: 50, thB: 25, knB: 45, uaA: 120, elA: 20, uaB: 110, elB: 20, bar: bar + 30, blur: 0.3 },
    { d: 0.12, x: x + dx, air: 0, rot: rot + 360, torso: 160, ...CROUCH, uaA: 30, elA: 50, uaB: -30, elB: 40, bar, blur: 0, fx: "land" },
  ];
}

// Bar angles for the toss: visible angle is bar + rot, so the catch lands hook-up after the backflip.
const TOSS = 95 + 720 + 220;
const CATCH = TOSS + 575;

const KEYS: Key[] = [
  { d: 0, ...READY },
  // Bounce on the spot.
  { d: 0.38, thA: 34, knA: 52, thB: -12, knB: 34, bar: 148 },
  { d: 0.38, ...STANCE, bar: 140 },
  // Open into a one-handed figure-eight, stepping forward.
  { d: 0.28, torso: 170, uaA: 60, elA: 25, uaB: -45, elB: 35, two: 0, grip: 0.5, bar: 95 },
  { d: 0.34, x: 115, thA: -12, knA: 12, thB: 28, knB: 45, uaA: 82, elA: 6, bar: 95 + 360, blur: 0.5, fx: "step" },
  { d: 0.34, x: 160, ...STANCE, uaA: 78, elA: 10, bar: 95 + 720, blur: 0.5, fx: "step" },
  // Crouch, launch the crowbar skyward, backflip under it and catch.
  { d: 0.24, torso: 158, thA: 55, knA: 80, thB: 5, knB: 70, uaA: 35, elA: 45, uaB: -20, elB: 40, bar: 95 + 720 + 80, blur: 0 },
  { d: 0.16, air: 8, torso: 182, thA: 8, knA: 4, thB: -6, knB: 6, uaA: 172, elA: 0, uaB: 150, elB: 10, bar: TOSS },
  { d: 0.12, free: true, x: 156, air: 20, rot: 40, torso: 186, thA: 10, knA: 6, thB: 0, knB: 6, uaA: 165, uaB: 150, bar: TOSS + 60, bx: 166, by: 36 },
  { d: 0.26, free: true, x: 150, air: 44, rot: 200, torso: 175, ...TUCK, uaA: 110, elA: 40, uaB: 100, elB: 40, bar: TOSS + 290, bx: 160, by: 24, blur: 0.4 },
  { d: 0.2, free: true, x: 145, air: 16, rot: 330, thA: 40, knA: 50, thB: 25, knB: 45, uaA: 160, elA: 15, uaB: 120, elB: 30, bar: TOSS + 470, bx: 152, by: 34, blur: 0.2 },
  { d: 0.14, x: 142, air: 0, rot: 360, torso: 165, thA: 50, knA: 85, thB: 5, knB: 75, uaA: 165, elA: 15, uaB: 60, elB: 60, bar: CATCH, blur: 0, fx: "land" },
  // Wind the crowbar back over the shoulder, run, leap and slam it into the dirt.
  { d: 0.3, x: 150, ...STANCE, torso: 168, uaA: 150, elA: 30, uaB: 120, elB: 30, two: 1, grip: 0.25, grip2: 0.45, bar: CATCH + 80 },
  { d: 0.22, x: 195, torso: 160, thA: 55, knA: 65, thB: -35, knB: 80, uaA: 175, elA: 15, bar: CATCH + 90, blur: 0.2, fx: "step" },
  { d: 0.34, x: 245, air: 32, torso: 196, thA: 75, knA: 40, thB: -55, knB: 70, uaA: 200, elA: 5, uaB: 190, bar: CATCH + 70, blur: 0.5 },
  { d: 0.13, x: 272, air: 0, torso: 138, thA: 80, knA: 88, thB: -62, knB: 8, uaA: 75, elA: 10, uaB: 70, elB: 10, bar: CATCH - 125, blur: 0.5, still: true, fx: "slam" },
  { d: 0.3, torso: 142, blur: 0, still: true },
  // Low sweep with a paper-cutout spin.
  { d: 0.22, x: 280, torso: 160, thA: 85, knA: 125, thB: -15, knB: 135, uaA: 85, elA: 0, uaB: -60, elB: 20, two: 0, grip: 0.3, bar: CATCH - 80 },
  { d: 0.2, f: -1, x: 290, blur: 0.6 },
  { d: 0.2, f: 1, x: 298, blur: 0.4 },
  // Stride up to the crag, lift the crowbar over the loose block and drop the claw in behind it.
  { d: 0.3, x: 324, torso: 178, thA: 44, knA: 30, thB: 5, knB: 52, uaA: 116, elA: 17, uaB: 80, elB: 15, two: 1, grip: 0.1, grip2: 0.4, bar: CATCH - 44, blur: 0, fx: "step" },
  { d: 0.28, x: 334, torso: 172, thA: 40, knA: 4, thB: 10, knB: 64, uaA: 58, elA: 78, grip: 0.08, grip2: 0.32, bar: CATCH - 60, still: true, fx: "hook" },
  // Sit back on the lever with feet planted. The claw barely moves: the block resists, creaks, gives a hair...
  { d: 0.22, x: 335, torso: 186, thA: 57, knA: 35, thB: 11, knB: 71, uaA: 78, elA: 51, grip: 0.05, bar: CATCH - 62, strain: 0.4 },
  { d: 0.3, x: 335.5, torso: 193, thA: 66, knA: 50, thB: 12, knB: 79, uaA: 97, elA: 25, grip: 0.035, bar: CATCH - 63, head: 8, strain: 0.8, still: true, fx: "creak" },
  { d: 0.34, x: 337, torso: 198, thA: 74, knA: 66, thB: 10, knB: 84, uaA: 112, elA: 11, grip: 0.02, bar: CATCH - 64, head: 12, strain: 1.1, still: true, fx: "creak" },
  // ...then breaks loose all at once, riding the claw out of the wall, and he stumbles back as the load vanishes.
  { d: 0.08, x: 334, torso: 204, thA: 68, knA: 48, thB: 17, knB: 86, uaA: 73, elA: 78, bar: CATCH - 55, head: 0, strain: 0, blur: 0.4, fx: "pry" },
  { d: 0.2, x: 327, torso: 210, thA: 41, knA: 4, thB: -20, knB: 31, uaA: 83, elA: 106, grip: 0.05, bar: CATCH - 42, head: -10, blur: 0.2 },
  // A second rock rattles loose from above; step back and bat it away.
  { d: 0.26, x: 316, ...STANCE, torso: 176, uaA: 40, elA: 50, two: 0.6, grip: 0.3, grip2: 0.5, bar: CATCH - 30, head: -20, blur: 0, fx: "drop" },
  { d: 0.32, x: 310, torso: 186, thA: 30, knA: 40, thB: -30, knB: 25, uaA: 140, elA: 40, uaB: 130, elB: 40, two: 1, grip: 0.05, grip2: 0.2, bar: CATCH + 90, head: -15 },
  { d: 0.14, x: 318, torso: 160, thA: 45, knA: 50, thB: -35, knB: 10, uaA: 120, elA: 0, uaB: 115, elB: 0, bar: CATCH - 10, head: -10, blur: 0.6, fx: "whack" },
  { d: 0.24, torso: 150, uaA: 60, elA: 10, uaB: 55, elB: 10, bar: CATCH - 110, head: 0, blur: 0.2 },
  // Plant the crowbar and admire the cleaned route.
  { d: 0.36, x: 312, torso: 186, head: -10, thA: 18, knA: 2, thB: -18, knB: 2, uaA: 40, elA: 35, uaB: -20, elB: 80, two: 0, grip: 0.96, bar: CATCH + 10, blur: 0, still: true, rest: true },
  { d: 0.7, head: -14, still: true },
  // Two back tucks home.
  { d: 0.24, torso: 160, head: 0, ...CROUCH, uaA: 30, elA: 50, uaB: -30, elB: 40, grip: 0.5, bar: CATCH - 60 },
  ...backTuck(312, -120, 360, CATCH - 60),
  ...backTuck(192, -117, 720, CATCH - 60),
];
/** Seconds from the last key back into the first. */
const CLOSE = 0.4;

const RAD = Math.PI / 180;
const dir = (deg: number): Point => ({ x: Math.sin(deg * RAD), y: Math.cos(deg * RAD) });
const at = (from: Point, length: number, deg: number): Point => {
  const d = dir(deg);
  return { x: from.x + d.x * length, y: from.y + d.y * length };
};
const angleOf = (from: Point, to: Point) => Math.atan2(to.x - from.x, to.y - from.y) / RAD;
const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));
const lerpAngle = (from: number, to: number, amount: number) => from + ((((to - from) % 360) + 540) % 360 - 180) * amount;

/** Shoulder and elbow angles that put a hand on `target`, elbow hanging below the line. */
function reach(shoulder: Point, target: Point) {
  const { upperArm: a, forearm: b } = BONE;
  const distance = clamp(Math.hypot(target.x - shoulder.x, target.y - shoulder.y), Math.abs(a - b) + 0.01, a + b - 0.01);
  const bend = Math.acos(clamp((a * a + distance * distance - b * b) / (2 * a * distance), -1, 1)) / RAD;
  const upper = angleOf(shoulder, target) - bend;
  return { upper, lower: angleOf(at(shoulder, a, upper), target) };
}

export interface Skeleton {
  hip: Point;
  neck: Point;
  head: Point;
  elbowA: Point;
  handA: Point;
  elbowB: Point;
  handB: Point;
  kneeA: Point;
  footA: Point;
  kneeB: Point;
  footB: Point;
  /** Crowbar chisel end, the axis along the bar, and the side its hook curls toward, in stage space. */
  barTail: Point;
  barU: Point;
  barV: Point;
}

export function solve(pose: Pose, free: boolean): Skeleton {
  const { rot } = pose;
  const hip = { x: 0, y: 0 };
  const neck = at(hip, BONE.torso, pose.torso + rot);
  const head = at(neck, BONE.neck + BONE.head, pose.torso + pose.head + rot);
  const elbowA = at(neck, BONE.upperArm, pose.uaA + rot);
  const handA = at(elbowA, BONE.forearm, pose.uaA + pose.elA + rot);
  const kneeA = at(hip, BONE.thigh, pose.thA + rot);
  const footA = at(kneeA, BONE.shin, pose.thA - pose.knA + rot);
  const kneeB = at(hip, BONE.thigh, pose.thB + rot);
  const footB = at(kneeB, BONE.shin, pose.thB - pose.knB + rot);
  const barDeg = pose.bar + rot;
  const grip = clamp(pose.grip, 0, 1) * BAR_LENGTH;

  let upperB = pose.uaB + rot;
  let lowerB = upperB + pose.elB;
  const two = free ? 0 : clamp(pose.two, 0, 1);
  if (two > 0) {
    const target = at(handA, (clamp(pose.grip2, 0, 1) * BAR_LENGTH) - grip, barDeg);
    const ik = reach(neck, target);
    upperB = lerpAngle(upperB, ik.upper, two);
    lowerB = lerpAngle(lowerB, ik.lower, two);
  }
  const elbowB = at(neck, BONE.upperArm, upperB);
  const handB = at(elbowB, BONE.forearm, lowerB);

  const lowest = Math.max(footA.y, footB.y, kneeA.y, kneeB.y, handA.y, handB.y, head.y + BONE.head);
  const hipY = STAGE.ground - Math.max(0, pose.air) - lowest;
  const f = clamp(pose.f, -1, 1);
  const place = (p: Point): Point => ({ x: pose.x + f * p.x, y: hipY + p.y });
  const axis = (deg: number): Point => { const d = dir(deg); return { x: f * d.x, y: d.y }; };

  const barU = axis(barDeg);
  const gripAt = free ? { x: pose.bx, y: pose.by } : place(handA);
  return {
    hip: place(hip), neck: place(neck), head: place(head),
    elbowA: place(elbowA), handA: place(handA), elbowB: place(elbowB), handB: place(handB),
    kneeA: place(kneeA), footA: place(footA), kneeB: place(kneeB), footB: place(footB),
    barTail: { x: gripAt.x - barU.x * grip, y: gripAt.y - barU.y * grip },
    barU,
    barV: axis(barDeg - 90),
  };
}

/** A point on the crowbar, `u` along it from the chisel end and `v` toward the hook. */
export function barPoint(s: Skeleton, u: number, v = 0): Point {
  return { x: s.barTail.x + s.barU.x * u + s.barV.x * v, y: s.barTail.y + s.barU.y * u + s.barV.y * v };
}

function buildTimeline(keys: Key[]) {
  let t = 0;
  let pose = READY;
  const frames: Frame[] = keys.map(({ d, free = false, still = false, rest = false, fx, ...channels }) => {
    t += d;
    pose = { ...pose, ...channels };
    return { t, pose, free, still, rest, fx };
  });

  // Close the loop on the first pose, wound forward by whole turns so spins and flips carry on rather than rewind.
  const first = frames[0].pose;
  const closing = { ...first };
  for (const channel of TURNING) closing[channel] = first[channel] + 360 * Math.round((pose[channel] - first[channel]) / 360);
  frames.push({ ...frames[0], t: t + CLOSE, pose: closing, fx: undefined });

  // Where the crowbar is in hand, its free-flight position is the hand, so release and catch are seamless.
  for (const frame of frames) {
    if (frame.free) continue;
    const s = solve(frame.pose, false);
    const grip = barPoint(s, clamp(frame.pose.grip, 0, 1) * BAR_LENGTH);
    frame.pose.bx = grip.x;
    frame.pose.by = grip.y;
  }

  // Catmull-Rom tangents over the closed loop; `still` keys stop dead.
  const n = frames.length - 1;
  const duration = frames[n].t;
  const tangents = frames.map((frame, i) => {
    const tangent = { ...frame.pose };
    for (const channel of CHANNELS) {
      const wind = frames[n].pose[channel] - frames[0].pose[channel];
      const prev = i > 0 ? frames[i - 1].pose[channel] : frames[n - 1].pose[channel] - wind;
      const prevT = i > 0 ? frames[i - 1].t : frames[n - 1].t - duration;
      const next = i < n ? frames[i + 1].pose[channel] : frames[1].pose[channel] + wind;
      const nextT = i < n ? frames[i + 1].t : frames[1].t + duration;
      tangent[channel] = frame.still ? 0 : (next - prev) / (nextT - prevT);
    }
    return tangent;
  });
  return { frames, tangents, duration };
}

const TIMELINE = buildTimeline(KEYS);

/** Length of one loop, in seconds. */
export const DANCE_DURATION = TIMELINE.duration;
/** Moments that trigger dust, sparks and rocks, in loop seconds. */
export const DANCE_EFFECTS = TIMELINE.frames.flatMap((frame) => frame.fx ? [{ t: frame.t, fx: frame.fx }] : []);
/** The pose held when motion is reduced. */
export const DANCE_REST_TIME = TIMELINE.frames.find((frame) => frame.rest)?.t ?? 0;

export function poseAt(time: number): { pose: Pose; free: boolean } {
  const { frames, tangents, duration } = TIMELINE;
  const t = ((time % duration) + duration) % duration;
  let i = 0;
  while (i < frames.length - 2 && frames[i + 1].t <= t) i++;
  const a = frames[i];
  const b = frames[i + 1];
  const span = b.t - a.t;
  const s = span > 0 ? (t - a.t) / span : 0;
  const s2 = s * s;
  const s3 = s2 * s;
  const h00 = 2 * s3 - 3 * s2 + 1;
  const h10 = s3 - 2 * s2 + s;
  const h01 = -2 * s3 + 3 * s2;
  const h11 = s3 - s2;
  const pose = { ...a.pose };
  for (const channel of CHANNELS) {
    pose[channel] = h00 * a.pose[channel] + h10 * span * tangents[i][channel] + h01 * b.pose[channel] + h11 * span * tangents[i + 1][channel];
  }
  const tremor = Math.max(0, pose.strain);
  if (tremor > 0) {
    const phase = t * Math.PI * 2 * 13;
    pose.torso += tremor * Math.sin(phase);
    pose.uaA += tremor * 1.4 * Math.sin(phase + 1.7);
    pose.bar += tremor * 0.5 * Math.sin(phase + 0.6);
  }
  return { pose, free: a.free || b.free };
}

export function skeletonAt(time: number): Skeleton {
  const { pose, free } = poseAt(time);
  return solve(pose, free);
}

/** The tip of the crowbar's claw, which catches behind the loose block. */
export const clawPoint = (s: Skeleton) => barPoint(s, BAR_LENGTH - 5, 10);

const effectTime = (fx: DanceEffect) => DANCE_EFFECTS.find((effect) => effect.fx === fx)?.t ?? 0;
const HOOK_AT = effectTime("hook");
/** When the loose block breaks free of the crag. */
export const PRY_AT = effectTime("pry");
/** The block's lower outside corner, which it levers out around. */
export const BLOCK_PIVOT: Point = { x: CRAG.block[1][0], y: CRAG.block[1][1] };
const angleAround = (p: Point) => Math.atan2(p.y - BLOCK_PIVOT.y, p.x - BLOCK_PIVOT.x);

/**
 * Radians the loose block has been levered out around its pivot. From the hook until it breaks free,
 * the block turns with the claw, so the crowbar carries the block rather than passing through it.
 */
export function blockTilt(time: number): number {
  // Exact for times already inside the loop, so the pry moment itself still counts as held.
  const t = time - DANCE_DURATION * Math.floor(time / DANCE_DURATION);
  if (t < HOOK_AT || t > PRY_AT) return 0;
  return angleAround(clawPoint(skeletonAt(t))) - angleAround(clawPoint(skeletonAt(HOOK_AT)));
}

export function drawCrowbar(ctx: CanvasRenderingContext2D, s: Skeleton) {
  const L = BAR_LENGTH;
  const point = (u: number, v: number) => barPoint(s, u, v);
  const trace = () => {
    ctx.beginPath();
    const kink = point(-2.5, -1.8);
    ctx.moveTo(kink.x, kink.y);
    for (const p of [point(0, 0), point(L - 9, 0)]) ctx.lineTo(p.x, p.y);
    const c1 = point(L - 2, 0);
    const c2 = point(L + 2, 5);
    const end = point(L - 2, 9.5);
    ctx.bezierCurveTo(c1.x, c1.y, c2.x, c2.y, end.x, end.y);
    const claw = point(L - 5, 10);
    ctx.lineTo(claw.x, claw.y);
  };
  const tail = point(0, 0);
  const tip = point(L, 0);
  const gold = ctx.createLinearGradient(tail.x, tail.y, tip.x, tip.y);
  gold.addColorStop(0, "#c8901f");
  gold.addColorStop(0.55, "#f6d374");
  gold.addColorStop(1, "#e2a72e");

  ctx.save();
  // The crowbar may dig into the floor on a slam; never draw it underground.
  ctx.beginPath();
  ctx.rect(-STAGE.width, -STAGE.height, STAGE.width * 3, STAGE.ground + STAGE.height + 0.5);
  ctx.clip();
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  trace();
  ctx.strokeStyle = "#5e3f06";
  ctx.lineWidth = 4.6;
  ctx.stroke();
  ctx.strokeStyle = gold;
  ctx.lineWidth = 2.8;
  ctx.stroke();
  const shineFrom = point(3, -0.6);
  const shineTo = point(L - 12, -0.6);
  ctx.beginPath();
  ctx.moveTo(shineFrom.x, shineFrom.y);
  ctx.lineTo(shineTo.x, shineTo.y);
  ctx.strokeStyle = "rgba(255, 246, 214, 0.9)";
  ctx.lineWidth = 0.8;
  ctx.stroke();
  ctx.restore();
}

/** Colours for a climbing helmet: the shell and the band across its crown. */
export interface Helmet { shell: string; stripe: string }

/** One helmet per nominee, in ballot order. Keep at least as many as there are nominees so no two share one. */
export const HELMETS: readonly Helmet[] = [
  { shell: "#e4572e", stripe: "#ffd166" },
  { shell: "#2a9d8f", stripe: "#f4f1de" },
  { shell: "#3a86ff", stripe: "#ffbe0b" },
  { shell: "#8338ec", stripe: "#3bceac" },
  { shell: "#ff006e", stripe: "#fefae0" },
  { shell: "#06d6a0", stripe: "#073b4c" },
  { shell: "#f77f00", stripe: "#003049" },
  { shell: "#118ab2", stripe: "#ef476f" },
  { shell: "#9ef01a", stripe: "#2b2d42" },
  { shell: "#ffffff", stripe: "#d62828" },
  { shell: "#22223b", stripe: "#f2e9e4" },
  { shell: "#6d597a", stripe: "#ffb4a2" },
  { shell: "#b5179e", stripe: "#ffd6ff" },
  { shell: "#52b788", stripe: "#081c15" },
  { shell: "#e63946", stripe: "#f1faee" },
  { shell: "#4cc9f0", stripe: "#7209b7" },
];

/** A domed helmet on the head, lifted `lift` units off it along the head's up direction. */
function drawHelmet(ctx: CanvasRenderingContext2D, s: Skeleton, ink: string, helmet: Helmet, lift: number) {
  const up = Math.atan2(s.head.y - s.neck.y, s.head.x - s.neck.x);
  const x = s.head.x + Math.cos(up) * lift;
  const y = s.head.y + Math.sin(up) * lift;
  const r = BONE.head + 1.4;
  ctx.save();
  ctx.beginPath();
  ctx.arc(x, y, r, up - 1.75, up + 1.75);
  ctx.closePath();
  ctx.fillStyle = helmet.shell;
  ctx.fill();
  ctx.lineWidth = 0.8;
  ctx.globalAlpha *= 0.6;
  ctx.strokeStyle = ink;
  ctx.stroke();
  ctx.globalAlpha /= 0.6;
  ctx.beginPath();
  ctx.arc(x, y, r - 1.6, up - 0.85, up + 0.85);
  ctx.lineWidth = 1.5;
  ctx.lineCap = "butt";
  ctx.strokeStyle = helmet.stripe;
  ctx.stroke();
  ctx.restore();
}

/** Draws the figure and its crowbar, and a helmet if one is given. The far limbs are faded for depth. */
export function drawDancer(ctx: CanvasRenderingContext2D, s: Skeleton, ink: string, alpha = 1, helmet: Helmet | null = null, helmetLift = 0) {
  const limb = (width: number, ...points: Point[]) => {
    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y);
    for (const p of points.slice(1)) ctx.lineTo(p.x, p.y);
    ctx.lineWidth = width;
    ctx.stroke();
  };
  ctx.save();
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.strokeStyle = ink;
  ctx.fillStyle = ink;
  ctx.globalAlpha = alpha * 0.5;
  limb(2.8, s.hip, s.kneeB, s.footB);
  limb(2.6, s.neck, s.elbowB, s.handB);
  ctx.globalAlpha = alpha;
  limb(3.2, s.hip, s.neck);
  ctx.beginPath();
  ctx.arc(s.head.x, s.head.y, BONE.head, 0, Math.PI * 2);
  ctx.fill();
  if (helmet) drawHelmet(ctx, s, ink, helmet, helmetLift);
  drawCrowbar(ctx, s);
  limb(3, s.hip, s.kneeA, s.footA);
  limb(2.8, s.neck, s.elbowA, s.handA);
  ctx.restore();
}
