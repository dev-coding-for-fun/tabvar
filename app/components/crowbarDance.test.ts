import { describe, expect, it } from "vitest";
import nomineeCopy from "../../docs/golden-crowbar-2026-nominees.md?raw";
import { BAR_LENGTH, BLOCK_PIVOT, CRAG, DANCE_DURATION, DANCE_EFFECTS, HELMETS, PRY_AT, STAGE, barPoint, blockTilt, skeletonAt } from "./crowbarDance";
import type { Point, Skeleton } from "./crowbarDance";

const STEP = 1 / 240;
const tracked = (s: Skeleton): Point[] => [
  s.hip, s.neck, s.head, s.elbowA, s.handA, s.elbowB, s.handB, s.kneeA, s.footA, s.kneeB, s.footB,
  barPoint(s, 0), barPoint(s, BAR_LENGTH),
];

describe("crowbar dance choreography", () => {
  it("never pops, including at the loop seam and the crowbar toss and catch", () => {
    const largestJump = (from: number, to: number, samples: number) => {
      let previous = tracked(skeletonAt(from));
      let largest = 0;
      for (let k = 1; k <= samples; k++) {
        const current = tracked(skeletonAt(from + ((to - from) * k) / samples));
        for (const [i, p] of current.entries()) largest = Math.max(largest, Math.hypot(p.x - previous[i].x, p.y - previous[i].y));
        previous = current;
      }
      return largest;
    };
    // Fast but continuous motion shrinks when sampled finer; a discontinuity keeps its full size.
    for (let t = -STEP; t <= DANCE_DURATION; t += STEP) {
      const jump = largestJump(t, t + STEP, 1);
      if (jump < 1) continue;
      expect(largestJump(t, t + STEP, 40), `pop at t=${t.toFixed(3)}s`).toBeLessThan(jump / 4);
    }
  });

  it("keeps the dancer on the stage and never below the floor", () => {
    for (let t = 0; t < DANCE_DURATION; t += STEP) {
      const s = skeletonAt(t);
      for (const p of tracked(s).slice(0, 11)) {
        expect(p.y).toBeLessThanOrEqual(STAGE.ground + 0.01);
        expect(p.x).toBeGreaterThan(0);
        expect(p.x).toBeLessThan(STAGE.width);
      }
    }
  });

  it("carries the loose block on the claw instead of passing through it", () => {
    const block = CRAG.block.map(([x, y]) => ({ x, y }));
    const inBlock = (p: Point) => {
      let inside = false;
      for (let i = 0, j = block.length - 1; i < block.length; j = i++) {
        const a = block[i];
        const b = block[j];
        if ((a.y > p.y) !== (b.y > p.y) && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
      }
      return inside;
    };
    // The shaft, the bend and the claw, from the chisel end round to the claw tip.
    const crowbar = (s: Skeleton) => [
      ...Array.from({ length: 21 }, (_, k) => barPoint(s, (k / 20) * (BAR_LENGTH - 9))),
      barPoint(s, BAR_LENGTH, 4), barPoint(s, BAR_LENGTH - 2, 9.5), barPoint(s, BAR_LENGTH - 5, 10),
    ];
    for (let t = 0; t <= PRY_AT; t += STEP / 2) {
      // Judge the crowbar in the block's own frame, undoing the tilt it has been levered out by.
      const tilt = -blockTilt(t);
      for (const p of crowbar(skeletonAt(t))) {
        const dx = p.x - BLOCK_PIVOT.x;
        const dy = p.y - BLOCK_PIVOT.y;
        const local = { x: BLOCK_PIVOT.x + dx * Math.cos(tilt) - dy * Math.sin(tilt), y: BLOCK_PIVOT.y + dx * Math.sin(tilt) + dy * Math.cos(tilt) };
        expect(inBlock(local), `crowbar inside the block at t=${t.toFixed(3)}s`).toBe(false);
      }
    }
    // It is levered out of the wall, not into it, and has come well clear by the time it breaks free.
    expect(blockTilt(PRY_AT)).toBeLessThan(-0.4);
    expect(blockTilt(PRY_AT + STEP)).toBe(0);
  });

  it("has a distinct helmet for every nominee", () => {
    const nominees = nomineeCopy.match(/^## /gm) ?? [];
    expect(nominees.length).toBeGreaterThan(0);
    expect(HELMETS.length).toBeGreaterThanOrEqual(nominees.length);
    expect(new Set(HELMETS.map(({ shell, stripe }) => `${shell}/${stripe}`)).size).toBe(HELMETS.length);
  });

  it("schedules each crag beat in order within the loop", () => {
    const order = DANCE_EFFECTS.map((effect) => effect.fx).filter((fx) => ["hook", "pry", "drop", "whack"].includes(fx));
    expect(order).toEqual(["hook", "pry", "drop", "whack"]);
    for (const { t } of DANCE_EFFECTS) {
      expect(t).toBeGreaterThan(0);
      expect(t).toBeLessThan(DANCE_DURATION);
    }
  });
});
