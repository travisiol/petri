/* The hero object: a glass petri dish with an amber agar and glowing colonies, built at runtime — no asset.
   Mounted into #dish when the home page renders, disposed when it leaves. Falls back to a still SVG without WebGL. */
import * as THREE from "three";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";

let live = null;
const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;

function fallback(el) {
  el.innerHTML = `<svg viewBox="0 0 640 640"><defs><radialGradient id="fg" cx="45%" cy="40%" r="60%"><stop offset="0" stop-color="#ffe3a8"/><stop offset=".6" stop-color="#f5a524"/><stop offset="1" stop-color="#5a3305"/></radialGradient><radialGradient id="fh" cx="50%" cy="50%" r="50%"><stop offset="0" stop-color="#f5a524" stop-opacity=".45"/><stop offset="1" stop-color="#f5a524" stop-opacity="0"/></radialGradient></defs><circle cx="320" cy="330" r="300" fill="url(#fh)"/><ellipse cx="320" cy="330" rx="230" ry="150" fill="url(#fg)"/><ellipse cx="320" cy="330" rx="230" ry="150" fill="none" stroke="rgba(255,255,255,.5)" stroke-width="6"/><ellipse cx="320" cy="300" rx="250" ry="160" fill="none" stroke="rgba(255,255,255,.28)" stroke-width="5"/><g fill="#1a1000" opacity=".8"><circle cx="250" cy="300" r="14"/><circle cx="360" cy="350" r="19"/><circle cx="400" cy="290" r="9"/><circle cx="290" cy="380" r="11"/><circle cx="330" cy="270" r="7"/></g></svg>`;
}

function dishProfile(r, h, t, lip) {
  // a hollow dish: outside wall up, over the lip, back down the inside, across the floor
  const pts = [];
  pts.push(new THREE.Vector2(0, 0), new THREE.Vector2(r - lip, 0), new THREE.Vector2(r, lip * .6), new THREE.Vector2(r, h - lip), new THREE.Vector2(r - lip * .4, h), new THREE.Vector2(r - t, h), new THREE.Vector2(r - t - lip * .3, h - lip), new THREE.Vector2(r - t, t + lip), new THREE.Vector2(r - t - lip, t), new THREE.Vector2(0, t));
  return new THREE.LatheGeometry(pts, 128);
}

function mount(el) {
  let renderer;
  try { renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: "high-performance" }); } catch { fallback(el); return; }
  renderer.setPixelRatio(Math.min(2, devicePixelRatio || 1)); renderer.setClearColor(0x000000, 0);
  renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = .82; renderer.outputColorSpace = THREE.SRGBColorSpace;
  el.innerHTML = ""; el.appendChild(renderer.domElement);
  const scene = new THREE.Scene();
  const pmrem = new THREE.PMREMGenerator(renderer); scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture; pmrem.dispose();
  const camera = new THREE.PerspectiveCamera(28, 1, 0.1, 50); camera.position.set(0, 3.9, 7.4); camera.lookAt(0, 0.05, 0);
  const key = new THREE.DirectionalLight(0xfff2dc, 1.1); key.position.set(-3, 5, 3); scene.add(key);
  const rim = new THREE.DirectionalLight(0xffc873, .6); rim.position.set(3, 2, -4); scene.add(rim);
  const glow = new THREE.PointLight(0xf5a524, 2.2, 5, 1.6); glow.position.set(0, .25, 0); scene.add(glow);
  scene.add(new THREE.AmbientLight(0x2a2418, .5));

  const group = new THREE.Group(); scene.add(group);
  const glass = new THREE.MeshPhysicalMaterial({ color: 0xffffff, transmission: 1, thickness: .25, roughness: .1, ior: 1.5, clearcoat: 1, clearcoatRoughness: .08, attenuationColor: new THREE.Color(0xf3d9b0), attenuationDistance: 1.6, envMapIntensity: .55, side: THREE.FrontSide });
  const base = new THREE.Mesh(dishProfile(1.62, .34, .06, .04), glass); group.add(base);
  const lid = new THREE.Mesh(dishProfile(1.7, .22, .05, .04), glass); lid.rotation.x = Math.PI; lid.position.set(.32, .78, -.2); lid.rotation.z = -.14; lid.rotation.y = .3; group.add(lid);

  const agar = new THREE.Mesh(new THREE.CylinderGeometry(1.54, 1.54, .12, 128), new THREE.MeshPhysicalMaterial({ color: 0xe8951c, roughness: .5, metalness: 0, emissive: new THREE.Color(0xc57a0a), emissiveIntensity: .2, clearcoat: .5, clearcoatRoughness: .3, sheen: .6, sheenColor: new THREE.Color(0xffd9a0), envMapIntensity: .35 }));
  agar.position.y = .12; group.add(agar);

  // colonies: clusters of small glowing domes on the agar
  const N = 260; const colonies = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 18, 12), new THREE.MeshStandardMaterial({ color: 0xffdfb0, roughness: .5, emissive: new THREE.Color(0xffc873), emissiveIntensity: .5 }), N);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3();
  const seed = (i) => { const x = Math.sin(i * 12.9898 + 78.233) * 43758.5453; return x - Math.floor(x); };
  const centers = [[.45, .3], [-.6, -.25], [-.15, .7], [.7, -.65], [-.85, .35], [.1, -.15]];
  const sizes = [];
  for (let i = 0; i < N; i++) {
    const c = centers[i % centers.length]; const a = seed(i) * Math.PI * 2; const d = Math.sqrt(seed(i + 1000)) * (.28 + .22 * seed(i + 2000));
    let x = c[0] + Math.cos(a) * d, z = c[1] + Math.sin(a) * d; const rr = Math.hypot(x, z); if (rr > 1.42) { x *= 1.42 / rr; z *= 1.42 / rr; }
    const r = .022 + seed(i + 3000) * .05 + (i % 23 === 0 ? .05 : 0); sizes.push(r);
    p.set(x, .18 - r * .35, z); s.set(r, r * .55, r); m.compose(p, q, s); colonies.setMatrixAt(i, m);
  }
  colonies.instanceMatrix.needsUpdate = true; group.add(colonies);
  // the halo under the dish
  const cv = document.createElement("canvas"); cv.width = cv.height = 256; const g = cv.getContext("2d"); const grad = g.createRadialGradient(128, 128, 0, 128, 128, 128); grad.addColorStop(0, "rgba(245,165,36,.9)"); grad.addColorStop(.35, "rgba(245,165,36,.35)"); grad.addColorStop(1, "rgba(245,165,36,0)"); g.fillStyle = grad; g.fillRect(0, 0, 256, 256);
  const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(cv), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: .32 })); halo.scale.set(4.8, 4.8, 1); halo.position.y = -.1; scene.add(halo);
  group.rotation.x = .08;

  const size = () => { const w = el.clientWidth || 640, h = el.clientHeight || 640; renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix(); };
  size(); const ro = new ResizeObserver(size); ro.observe(el);
  let raf = 0, t0 = performance.now();
  const frame = (now) => {
    if (!document.body.contains(renderer.domElement)) { dispose(); return; }
    const t = (now - t0) / 1000; if (!reduced) { group.rotation.y = t * .18; lid.position.y = .78 + Math.sin(t * .9) * .03; }
    for (let i = 0; i < N; i += 7) { const k = 1 + Math.sin(t * 1.3 + i) * .12; const r = sizes[i]; colonies.getMatrixAt(i, m); m.decompose(p, q, s); s.set(r * k, r * .55 * k, r * k); m.compose(p, q, s); colonies.setMatrixAt(i, m); }
    colonies.instanceMatrix.needsUpdate = true; glow.intensity = 2.1 + Math.sin(t * .7) * .35;
    renderer.render(scene, camera); raf = requestAnimationFrame(frame);
  };
  const dispose = () => { cancelAnimationFrame(raf); ro.disconnect(); renderer.dispose(); live = null; };
  live = { dispose, renderer, scene, camera, once: () => renderer.render(scene, camera) };
  window.__petriHero = live; // lets a headless capture render one frame while the tab is hidden
  raf = requestAnimationFrame(frame);
}

function tryMount() { const el = document.getElementById("dish"); if (!el || live) return; if (!window.WebGLRenderingContext) { fallback(el); return; } try { mount(el); } catch (e) { console.warn("hero", e); fallback(el); } }
window.addEventListener("petri:hero", tryMount);
tryMount();
