// Exercises the full rapier.js API (not just stepping) and reports numbers that must match between
// the threads build and the official single-threaded SIMD build of the same upstream version.
self.onmessage = async ({ data: { pkg, dim, threads, steps, url: override } }) => {
  try {
    const url = override ?? (pkg === "threads"
      ? `/dist/rapier${dim}d-threads/rapier.js`
      : `/node_modules/@dimforge/rapier${dim}d-simd-compat/dist/rapier.mjs`);
    const RAPIER = (await import(url)).default;
    await (pkg === "threads" ? RAPIER.init({ threads }) : RAPIER.init());
    self.postMessage({ type: "done", report: dim === 3 ? scene3d(RAPIER, steps) : scene2d(RAPIER, steps), pkg,
      threads: pkg === "threads" ? RAPIER.threadCount() : 1, version: RAPIER.version() });
  } catch (e) {
    self.postMessage({ type: "error", message: String(e?.stack ?? e), pkg });
  }
};

function rng(seed) {
  return () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
}
function median(a) { const s = [...a].sort((x, y) => x - y); return s[s.length >> 1]; }

function scene3d(R, steps) {
  const world = new R.World({ x: 0, y: -9.81, z: 0 });
  const rand = rng(7);
  world.createCollider(R.ColliderDesc.cuboid(40, 0.5, 40).setTranslation(0, -0.5, 0));
  for (const [x, z] of [[20, 0], [-20, 0], [0, 20], [0, -20]])
    world.createCollider(R.ColliderDesc.cuboid(x ? 0.5 : 20, 10, z ? 0.5 : 20).setTranslation(x, 10, z));
  // Sensor that counts what enters it.
  world.createCollider(R.ColliderDesc.cuboid(5, 1, 5).setTranslation(0, 1, 0).setSensor(true)
    .setActiveEvents(R.ActiveEvents.COLLISION_EVENTS));
  const bodies = [];
  let hooked = 0;
  for (let i = 0; i < 2500; i++) {
    const b = world.createRigidBody(R.RigidBodyDesc.dynamic()
      .setTranslation((rand() - 0.5) * 30, 2 + (i / 100) * 1.2, (rand() - 0.5) * 30)
      .setRotation({ x: rand() - 0.5, y: rand() - 0.5, z: rand() - 0.5, w: 1 }));
    const kind = i % 3;
    const cd = kind === 0 ? R.ColliderDesc.cuboid(0.4, 0.4, 0.4) : kind === 1 ? R.ColliderDesc.ball(0.45) : R.ColliderDesc.capsule(0.3, 0.3);
    cd.setActiveEvents(R.ActiveEvents.COLLISION_EVENTS);
    if (i % 25 === 0) { cd.setActiveHooks(R.ActiveHooks.FILTER_CONTACT_PAIRS); hooked++; }
    world.createCollider(cd, b);
    bodies.push(b);
  }
  // Joint chain hanging from a fixed anchor.
  let prev = world.createRigidBody(R.RigidBodyDesc.fixed().setTranslation(0, 25, 0));
  for (let i = 0; i < 40; i++) {
    const b = world.createRigidBody(R.RigidBodyDesc.dynamic().setTranslation(0.5 + i * 0.5, 25, 0));
    world.createCollider(R.ColliderDesc.ball(0.2), b);
    world.createImpulseJoint(R.JointData.spherical({ x: i ? 0.25 : 0, y: 0, z: 0 }, { x: -0.25, y: 0, z: 0 }), prev, b, true);
    prev = b;
    bodies.push(b);
  }
  // JS physics hooks: exercised via unsync-callbacks (always on the calling thread).
  let hookCalls = 0;
  const hooks = {
    filterContactPair() { hookCalls++; return R.SolverFlags.COMPUTE_IMPULSE; },
    filterIntersectionPair() { return true; },
  };
  const events = new R.EventQueue(true);
  let started = 0, sensorHits = 0;
  const times = [];
  for (let s = 0; s < steps; s++) {
    const t0 = performance.now();
    world.step(events, hooks);
    times.push(performance.now() - t0);
    events.drainCollisionEvents((h1, h2, start) => {
      if (!start) return;
      started++;
      if (world.getCollider(h1).isSensor() || world.getCollider(h2).isSensor()) sensorHits++;
    });
  }
  let sumY = 0, sleeping = 0;
  for (const b of bodies) { sumY += b.translation().y; if (b.isSleeping()) sleeping++; }
  const hit = world.castRay(new R.Ray({ x: 0, y: 50, z: 0 }, { x: 0, y: -1, z: 0 }), 100, true);
  let intersections = 0;
  world.intersectionsWithShape({ x: 0, y: 2, z: 0 }, { x: 0, y: 0, z: 0, w: 1 }, new R.Ball(3), () => { intersections++; return true; });
  const report = {
    bodies: bodies.length, hookedColliders: hooked, avgY: sumY / bodies.length, sleeping,
    collisionStarts: started, sensorHits, hookCalls, rayToi: hit?.timeOfImpact ?? null, intersections,
    stepMedianMs: median(times), stepMeanMs: times.reduce((a, b) => a + b, 0) / times.length,
  };
  events.free(); world.free();
  return report;
}

function scene2d(R, steps) {
  const world = new R.World({ x: 0, y: -9.81 });
  const rand = rng(7);
  world.createCollider(R.ColliderDesc.cuboid(60, 0.5).setTranslation(0, -0.5));
  const bodies = [];
  for (let i = 0; i < 4000; i++) {
    const b = world.createRigidBody(R.RigidBodyDesc.dynamic().setTranslation((rand() - 0.5) * 80, 1 + (i / 80) * 1.1));
    world.createCollider(i % 2 ? R.ColliderDesc.ball(0.45) : R.ColliderDesc.cuboid(0.4, 0.4), b);
    bodies.push(b);
  }
  const events = new R.EventQueue(true);
  const times = [];
  for (let s = 0; s < steps; s++) { const t0 = performance.now(); world.step(events); times.push(performance.now() - t0); }
  let sumY = 0;
  for (const b of bodies) sumY += b.translation().y;
  const report = { bodies: bodies.length, avgY: sumY / bodies.length, stepMedianMs: median(times), stepMeanMs: times.reduce((a, b) => a + b, 0) / times.length };
  events.free(); world.free();
  return report;
}
