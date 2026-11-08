import * as THREE from './node_modules/three/build/three.module.js';
// IRIS eye v0.2 - layered 3D eye (Three.js). Keys: 1-5 states, M mood, Esc quit.

const TAU = Math.PI * 2, rnd = (a, b) => a + Math.random() * (b - a);
const nz = (t, s) => (Math.sin(t * 0.37 + s) + Math.sin(t * 0.91 + s * 2.3) + Math.sin(t * 0.13 + s * 5.1)) / 3;
const label = document.getElementById('label');

// ---- Scene ----
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.setClearColor(0x02040a);
document.body.appendChild(renderer.domElement);
const CZ = 10;
const camera = new THREE.PerspectiveCamera(40, innerWidth / innerHeight, 0.1, 50);
camera.position.z = CZ;
const scene = new THREE.Scene();
const group = new THREE.Group();
scene.add(group);
const VIS = 2 * CZ * Math.tan(THREE.MathUtils.degToRad(20)); // visible height at z=0
const S = VIS * 0.94;   // base size of each layer (bigger number = bigger eye)
const RW = S * 0.459;   // world radius of the outer ring
const IRIS_D = 0.5, PUPIL_D = 0.25; // fraction of image width the iris disc / pupil disc fills
const CORNEA_D = 0.545; // how much of the image width the cornea dome fills
addEventListener('resize', () => {
  renderer.setSize(innerWidth, innerHeight);
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
});

// ---- Mood colours ----
const MOODS = {
  normal: [70, 200, 255], creative: [175, 105, 255], music: [215, 160, 255],
  dev: [95, 150, 255], warning: [255, 70, 70], deep: [235, 245, 255],
};
const moodNames = Object.keys(MOODS);
let moodIdx = 0;
const mc = MOODS.normal.slice(), tint = new THREE.Color();

// ---- States ----
const STATES = {
  idle:        { pupil: 0.32, glow: 0.55, spin: 1.0, converge: 0,    listen: 0, scan: 0, pulse: 0, expand: 1 },
  listening:   { pupil: 0.48, glow: 1.0,  spin: 1.4, converge: 1,    listen: 1, scan: 0, pulse: 0, expand: 1 },
  thinking:    { pupil: 0.20, glow: 0.85, spin: 4.5, converge: 0.25, listen: 0, scan: 1, pulse: 0, expand: 1 },
  speaking:    { pupil: 0.34, glow: 0.9,  spin: 1.5, converge: 0,    listen: 0, scan: 0, pulse: 1, expand: 1 },
  manifesting: { pupil: 0.32, glow: 1.0,  spin: 2.0, converge: 0,    listen: 0, scan: 0, pulse: 0, expand: 1.12 },
};
const st = Object.assign({}, STATES.idle);
let target = STATES.idle, labelTimer;
function showLabel(text, ms) {
  label.textContent = text; label.style.opacity = 0.6;
  clearTimeout(labelTimer); labelTimer = setTimeout(() => (label.style.opacity = 0), ms);
}
function setState(n) { if (STATES[n]) { target = STATES[n]; showLabel(n, 2500); } }
window.IRIS = { setState, setMood: (n) => { if (MOODS[n]) moodIdx = moodNames.indexOf(n); }, speakLevel: 0 };
addEventListener('keydown', (e) => {
if (e.target.tagName === 'INPUT') return;
  const map = { 1: 'idle', 2: 'listening', 3: 'thinking', 4: 'speaking', 5: 'manifesting' };
  if (map[e.key]) setState(map[e.key]);
  if (e.key.toLowerCase() === 'm') { moodIdx = (moodIdx + 1) % moodNames.length; showLabel(moodNames[moodIdx], 2000); }
});

// ---- Layer art (drawn in code; any of these can later be replaced by a PNG) ----
const N = 1024, C = 512, Rr = 470;
function tex(draw) {
  const c = document.createElement('canvas'); c.width = c.height = N;
  const g = c.getContext('2d'); g.translate(C, C); draw(g);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; return t;
}
const circ = (g, r) => { g.beginPath(); g.arc(0, 0, r, 0, TAU); g.stroke(); };
const line = (g, a, r0, r1) => { g.beginPath(); g.moveTo(Math.cos(a) * r0, Math.sin(a) * r0); g.lineTo(Math.cos(a) * r1, Math.sin(a) * r1); g.stroke(); };
const glowDisc = (g, r0, r1, a0, a1) => {
  const gr = g.createRadialGradient(0, 0, r0, 0, 0, r1);
  gr.addColorStop(0, `rgba(255,255,255,${a0})`); gr.addColorStop(1, `rgba(255,255,255,${a1})`);
  g.fillStyle = gr; g.fillRect(-C, -C, N, N);
};
const T = {
  halo: (g) => { glowDisc(g, Rr * 0.45, C, 0.55, 0); },
  outer: (g) => {
    g.strokeStyle = 'rgba(255,255,255,.75)'; g.lineWidth = 5; circ(g, Rr);
    for (let i = 0; i < 72; i++) {
      const big = i % 6 === 0;
      g.lineWidth = big ? 4 : 2; g.strokeStyle = `rgba(255,255,255,${big ? 0.8 : 0.4})`;
      line(g, (i / 72) * TAU, Rr, Rr * (big ? 0.92 : 0.95));
    }
  },
  data: (g) => {
    g.strokeStyle = 'rgba(255,255,255,.6)'; g.lineWidth = 14;
    for (let i = 0; i < 22; i++) { const a = (i / 22) * TAU; g.beginPath(); g.arc(0, 0, Rr * 0.87, a, a + rnd(0.05, 0.16)); g.stroke(); }
  },
  logic: (g) => {
    g.strokeStyle = 'rgba(255,255,255,.3)'; g.lineWidth = 2; circ(g, Rr * 0.74);
    g.lineWidth = 8; g.strokeStyle = 'rgba(255,255,255,.8)'; g.fillStyle = '#fff';
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * TAU;
      g.beginPath(); g.arc(0, 0, Rr * 0.74, a, a + 0.75); g.stroke();
      g.beginPath(); g.arc(Math.cos(a + 0.75) * Rr * 0.74, Math.sin(a + 0.75) * Rr * 0.74, 9, 0, TAU); g.fill();
    }
  },
  listen: (g) => {
    g.strokeStyle = 'rgba(255,255,255,.9)'; g.lineWidth = 5; circ(g, Rr * 0.63);
    g.strokeStyle = 'rgba(255,255,255,.4)'; g.lineWidth = 2; circ(g, Rr * 0.66);
  },
  iris: (g) => {
    const ir = Rr * 0.54;
    const gr = g.createRadialGradient(0, 0, ir * 0.2, 0, 0, ir);
    gr.addColorStop(0, 'rgba(255,255,255,.7)'); gr.addColorStop(0.55, 'rgba(255,255,255,.22)'); gr.addColorStop(1, 'rgba(255,255,255,.06)');
    g.fillStyle = gr; g.beginPath(); g.arc(0, 0, ir, 0, TAU); g.fill();
    for (let i = 0; i < 260; i++) {
      g.strokeStyle = `rgba(255,255,255,${0.08 + Math.random() * 0.3})`; g.lineWidth = 1 + Math.random() * 2;
      line(g, rnd(0, TAU), ir * rnd(0.2, 0.5), ir * rnd(0.6, 1));
    }
    g.strokeStyle = 'rgba(255,255,255,.9)'; g.lineWidth = 4; circ(g, ir);
    g.strokeStyle = 'rgba(255,255,255,.35)'; g.lineWidth = 10; circ(g, ir * 0.58);
  },
  mood: (g) => { glowDisc(g, 0, Rr * 0.6, 0.8, 0); },
  pupil: (g) => {
    const pr = Rr * 0.54 * 0.5;
    g.fillStyle = '#000'; g.beginPath(); g.arc(0, 0, pr, 0, TAU); g.fill();
    g.strokeStyle = 'rgba(255,255,255,.9)'; g.lineWidth = 5; circ(g, pr);
    g.fillStyle = 'rgba(255,255,255,.6)'; g.beginPath(); g.arc(-pr * 0.3, -pr * 0.3, pr * 0.09, 0, TAU); g.fill();
  },
cornea: (g) => {
    const cr = Rr * 0.54 * 1.1;
    const rg = g.createRadialGradient(0, 0, cr * 0.7, 0, 0, cr);
    rg.addColorStop(0, 'rgba(255,255,255,0)'); rg.addColorStop(1, 'rgba(255,255,255,.35)');
    g.fillStyle = rg; g.beginPath(); g.arc(0, 0, cr, 0, TAU); g.fill();
    g.strokeStyle = 'rgba(255,255,255,.5)'; g.lineWidth = 3; circ(g, cr);
    g.strokeStyle = 'rgba(255,255,255,.7)'; g.lineWidth = 14; g.lineCap = 'round';
    g.beginPath(); g.arc(0, 0, cr * 0.8, Math.PI * 1.15, Math.PI * 1.45); g.stroke();
  },
  overlay: (g) => {
    const gr = g.createConicGradient(0, 0, 0);
    gr.addColorStop(0, 'rgba(255,255,255,0)'); gr.addColorStop(0.78, 'rgba(255,255,255,0)'); gr.addColorStop(1, 'rgba(255,255,255,.8)');
    g.strokeStyle = gr; g.lineWidth = Rr * 0.14; circ(g, Rr * 0.76);
    g.strokeStyle = 'rgba(255,255,255,.5)'; g.lineWidth = 3; circ(g, Rr * 1.02);
  },
};

// ---- Layers: [name, depth z, size multiplier, base spin rad/s, additive, bursts/s, pauses/s] ----
const CFG = [
  ['halo', -1.5, 1.8, 0, 1, 0, 0],
  ['outer', -0.9, 1, 0.05, 1, 0.1, 0.06],
  ['data', -0.6, 1, -0.18, 1, 0.15, 0.1],
  ['logic', -0.3, 1, 0.25, 1, 0.15, 0.1],
  ['listen', -0.1, 1, 0, 1, 0, 0],
  ['iris', 0, 1, 0.06, 1, 0.08, 0.05],
  ['mood', 0.15, 1, 0, 1, 0, 0],
  ['pupil', 0.4, 1, 0, 0, 0, 0],
  ['cornea', 0.55, 1, 0, 1, 0, 0],
  ['overlay', 0.7, 1, 0.7, 1, 0, 0],
];
const L = {};
CFG.forEach(([k, z, m, spin, add, br, pr], i) => {
  const mat = new THREE.MeshBasicMaterial({
    map: tex(T[k]), transparent: true, depthTest: false, depthWrite: false,
    blending: add ? THREE.AdditiveBlending : THREE.NormalBlending,
  });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), mat);
  mesh.position.z = z; mesh.renderOrder = i; group.add(mesh);
  new THREE.TextureLoader().load(`./assets/${k}.png`, (t) => { t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; mat.map = t; mat.needsUpdate = true; }, undefined, () => {});
  L[k] = { mesh, mat, base: (S * m * (CZ - z)) / CZ, spin, br, pr, rot: rnd(0, TAU), boost: 0, boostT: 0, hold: 0, mul: 1, seed: rnd(0, 100) };
});

// ---- Layer 10 of the spec: particle field + constellations ----
const NP = 1000, pos = new Float32Array(NP * 3), colr = new Float32Array(NP * 3);
const P = Array.from({ length: NP }, () => ({ a: rnd(0, TAU), f: rnd(0.3, 1.4), s: rnd(-0.18, 0.18), z: rnd(-2, 2), k: rnd(0, 1), ph: rnd(0, TAU), al: rnd(0.25, 0.9) }));
const dotC = document.createElement('canvas'); dotC.width = dotC.height = 64;
const dg = dotC.getContext('2d'), dr = dg.createRadialGradient(32, 32, 0, 32, 32, 32);
dr.addColorStop(0, 'rgba(255,255,255,1)'); dr.addColorStop(1, 'rgba(255,255,255,0)');
dg.fillStyle = dr; dg.fillRect(0, 0, 64, 64);
const pgeo = new THREE.BufferGeometry();
pgeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
pgeo.setAttribute('color', new THREE.BufferAttribute(colr, 3));
const points = new THREE.Points(pgeo, new THREE.PointsMaterial({
  size: 0.05, map: new THREE.CanvasTexture(dotC), transparent: true, vertexColors: true,
  blending: THREE.AdditiveBlending, depthWrite: false, depthTest: false,
}));
points.renderOrder = 0.5; points.frustumCulled = false; group.add(points);

const NC = 46, cn = Array.from({ length: NC }, () => ({ x: rnd(-1, 1), y: rnd(-1, 1), z: rnd(-2, 1), ph: rnd(0, TAU) }));
const links = [];
cn.forEach((a, i) => {
  const d = cn.map((b, j) => [j, (a.x - b.x) ** 2 + (a.y - b.y) ** 2]).filter((o) => o[0] !== i).sort((p, q) => p[1] - q[1]);
  links.push([i, d[0][0]], [i, d[1][0]]);
});
const lp = new Float32Array(links.length * 6), lgeo = new THREE.BufferGeometry();
lgeo.setAttribute('position', new THREE.BufferAttribute(lp, 3));
const lmat = new THREE.LineBasicMaterial({ transparent: true, blending: THREE.AdditiveBlending, depthTest: false, depthWrite: false, opacity: 0.15 });
const lines = new THREE.LineSegments(lgeo, lmat);
lines.renderOrder = 0.4; lines.frustumCulled = false; group.add(lines);

// ---- Life: gaze, flicks, flares, mouse ----
const mouse = { x: 0, y: 0, t: -99, e: 0 };
const look = { x: 0, y: 0 };
addEventListener('mousemove', (e) => {
  const nx = (e.clientX / innerWidth) * 2 - 1, ny = -((e.clientY / innerHeight) * 2 - 1);
  mouse.e = Math.min(1, mouse.e + Math.hypot(nx - mouse.x, ny - mouse.y) * 3);
  mouse.x = nx; mouse.y = ny; mouse.t = performance.now() / 1000;
});
const gaze = { x: 0, y: 0, tx: 0, ty: 0, mx: 0, my: 0 };
let nextSacc = 0, nextFlick = 2, nextFlare = 10, flick = 0, flare = 0, flickT = 0, flareT = 0, last = performance.now() / 1000;

function frame() {
  requestAnimationFrame(frame);
  const t = performance.now() / 1000, dt = Math.min(t - last, 0.05); last = t;
  const ease = (r) => 1 - Math.exp(-dt * r);

  for (const k in st) st[k] += (target[k] - st[k]) * ease(1 / 0.26);
  const mt = MOODS[moodNames[moodIdx]];
  for (let i = 0; i < 3; i++) mc[i] += (mt[i] - mc[i]) * 0.05;
  tint.setRGB(mc[0] / 255, mc[1] / 255, mc[2] / 255, THREE.SRGBColorSpace);
  mouse.e *= Math.exp(-dt * 1.5);
  const recentMouse = t - mouse.t < 4;
  look.x += ((recentMouse ? mouse.x : 0) - look.x) * ease(recentMouse ? 6 : 0.6);
  look.y += ((recentMouse ? mouse.y : 0) - look.y) * ease(recentMouse ? 6 : 0.6);

  // random life events
  if (t > nextSacc) {
    const recent = t - mouse.t < 4, a = rnd(0, TAU), r = Math.sqrt(Math.random()) * 0.5;
    nextSacc = t + (recent ? rnd(0.25, 0.8) : rnd(0.8, 3.2));
    gaze.tx = recent ? mouse.x * 0.8 + Math.cos(a) * 0.1 : Math.cos(a) * r;
    gaze.ty = recent ? mouse.y * 0.8 + Math.sin(a) * 0.1 : Math.sin(a) * r;
  }
  if (t > nextFlick) { nextFlick = t + rnd(0.6, 2); flickT = rnd(-0.16, 0.18); }
  if (t > nextFlare) { nextFlare = t + rnd(4, 9); flareT = 1; for (const k in L) L[k].boostT = Math.max(L[k].boostT, rnd(2, 4)); }
  flickT *= Math.exp(-dt * 3); flareT *= Math.exp(-dt * 0.7);
  flick += (flickT - flick) * ease(9); flare += (flareT - flare) * ease(5);
  gaze.mx += (gaze.tx - gaze.mx) * ease(9); gaze.my += (gaze.ty - gaze.my) * ease(9);
  gaze.x += (gaze.mx - gaze.x) * ease(16); gaze.y += (gaze.my - gaze.y) * ease(16);

  // each layer wanders: changing speed, random bursts, random pauses
  for (const k in L) {
    const l = L[k];
    l.boostT *= Math.exp(-dt * 0.8);
    if (Math.random() < dt * l.br) l.boostT = rnd(1.5, 4);
    l.boost += (l.boostT - l.boost) * ease(2.5);
    if (l.hold <= 0 && Math.random() < dt * l.pr) l.hold = rnd(0.6, 2.2);
    l.hold -= dt; l.mul += ((l.hold > 0 ? 0 : 1) - l.mul) * ease(2);
    l.rot += l.spin * (1 + 0.6 * nz(t, l.seed)) * (1 + l.boost) * l.mul * st.spin * dt;
    l.mesh.rotation.z = l.rot;
  }

  // speech pulse (simulated until real voice exists), breathing, tilt, parallax
  const sp = window.IRIS.useReal ? window.IRIS.speakLevel : st.pulse * (0.5 + 0.5 * Math.sin(t * 7.3) * Math.sin(t * 2.1 + 1));
  group.scale.setScalar((1 + Math.sin(t * 0.9) * 0.015 + sp * 0.03 + nz(t, 7) * 0.006) * st.expand);
  group.rotation.y += (look.x * 0.2 + Math.sin(t * 0.2) * 0.03 - group.rotation.y) * ease(3);
  group.rotation.x += (-look.y * 0.14 + Math.cos(t * 0.17) * 0.025 - group.rotation.x) * ease(3);
  camera.position.x += (look.x * 0.7 - camera.position.x) * ease(3);
  camera.position.y += (look.y * 0.45 - camera.position.y) * ease(3);
  camera.lookAt(0, 0, 0);

  // layer looks
  const set = (l, op, sc = 1) => { l.mat.opacity = Math.min(1, Math.max(0, op)); l.mesh.scale.setScalar(l.base * sc); l.mat.color.copy(tint); };
  const g = st.glow, lq = (t * 0.6) % 1, m = Math.max(0, (st.expand - 1) / 0.12), mp = (t * 0.35) % 1;
  set(L.halo, (0.35 + 0.45 * g) * (0.9 + 0.1 * Math.sin(t * 0.9)) * (1 + flare * 0.8), 1 + sp * 0.03 + flare * 0.1);
  set(L.outer, 0.75);
  set(L.data, 0.45 + st.scan * 0.4);
  set(L.logic, 0.7);
  set(L.listen, st.listen * 0.8 * (1 - lq * 0.6), 1 + lq * 0.12);
  set(L.iris, 0.55 + 0.4 * g + mouse.e * 0.2 + flare * 0.2, 0.496 / IRIS_D)
  set(L.mood, (0.25 + 0.5 * g) * (1 + flare * 1.2) + mouse.e * 0.15);
  set(L.pupil, 1, Math.max(0.2, st.pupil + flick + Math.sin(t * 0.6) * 0.015 + nz(t, 3) * 0.02 + sp * 0.04 - flare * 0.06) * 0.496 / PUPIL_D);
  set(L.overlay, Math.max(st.scan * 0.9, st.pulse * (0.25 + 0.4 * sp), m * 0.5 * (1 - mp)), 1 + st.pulse * sp * 0.05 + m * mp * 0.4);
  set(L.cornea, 0.55 + flare * 0.3 + mouse.e * 0.15, 0.533 / CORNEA_D);
  const tr = nz(t, 11) * 0.002 * S;
  L.iris.mesh.position.set(gaze.x * S * 0.02 + tr, gaze.y * S * 0.02, 0);
  L.mood.mesh.position.set(gaze.x * S * 0.025, gaze.y * S * 0.025, 0.15);
  L.pupil.mesh.position.set(gaze.x * S * 0.07 + tr, gaze.y * S * 0.07, 0.4);
  L.cornea.mesh.position.set(-gaze.x * S * 0.015, -gaze.y * S * 0.015, 0.55);

  // particles
  for (let i = 0; i < NP; i++) {
    const p = P[i]; p.a += p.s * dt * (0.6 + st.spin * 0.4);
    const f = p.f * (1 - st.converge * 0.5 * p.k) + Math.sin(t * 0.6 + p.ph) * 0.03;
    pos[i * 3] = Math.cos(p.a) * f * RW * 1.6; pos[i * 3 + 1] = Math.sin(p.a) * f * RW; pos[i * 3 + 2] = p.z;
    const b = p.al * (0.5 + 0.5 * Math.sin(t * 1.5 + p.ph)) * (0.6 + 0.4 * g);
    colr[i * 3] = tint.r * b; colr[i * 3 + 1] = tint.g * b; colr[i * 3 + 2] = tint.b * b;
  }
  pgeo.attributes.position.needsUpdate = true; pgeo.attributes.color.needsUpdate = true;

  // constellations
  const cp = (i) => [(cn[i].x + Math.sin(t * 0.1 + cn[i].ph) * 0.04) * RW * 2.2, (cn[i].y + Math.cos(t * 0.08 + cn[i].ph) * 0.04) * RW * 1.25, cn[i].z];
  links.forEach(([a, b], i) => { lp.set(cp(a), i * 6); lp.set(cp(b), i * 6 + 3); });
  lgeo.attributes.position.needsUpdate = true;
  lmat.opacity = 0.3 * (1 - 0.7 * Math.min(1, st.listen + st.scan)); lmat.color.copy(tint);

  renderer.render(scene, camera);
}
frame();