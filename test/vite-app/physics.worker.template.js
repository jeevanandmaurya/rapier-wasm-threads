import RAPIER from "__PKG__";
try {
  await RAPIER.init({ threads: 4 });
  const world = new RAPIER.World({ x: 0, y: -9.81, z: 0 });
  world.createCollider(RAPIER.ColliderDesc.cuboid(20, 0.5, 20));
  for (let i = 0; i < 1000; i++) {
    const b = world.createRigidBody(RAPIER.RigidBodyDesc.dynamic().setTranslation((i % 10) - 5, 1 + Math.floor(i / 100), (Math.floor(i / 10) % 10) - 5));
    world.createCollider(RAPIER.ColliderDesc.ball(0.45), b);
  }
  for (let s = 0; s < 120; s++) world.step();
  postMessage({ ok: true, threads: RAPIER.threadCount(), version: RAPIER.version() });
} catch (e) {
  postMessage({ ok: false, error: String(e?.stack ?? e) });
}
