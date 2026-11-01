import * as THREE from '../lib/three/three.module.js';
import { OrbitControls } from '../lib/three/addons/controls/OrbitControls.js';

const SQ = 1;            // square size
const PIECE_Y = 0.02;    // piece base height above board
const LIGHT_SQ = 0xf0d9b5;
const DARK_SQ = 0xb58863;

let renderer, scene, camera, controls, raycaster, clock;
let dotNet = null;
let canvas = null;
let resizeObserver = null;
let boardMeshes = {};      // 'e4' -> mesh
let pieceMeshes = {};      // 'e4' -> group
let highlightGroup = null;
let coordGroup = null;
let animations = [];
let pieceGeoCache = {};    // type -> { geo, extras }
let animId = 0;
let flipped = false;
let lastTargets = [];      // cached legal targets of current selection (for drag validation)
let lastSelected = null;
let drag = null;           // {mesh, from, started, origin:Vector3}
let hoverSq = null;        // square under cursor while dragging
let hoverHl = null;        // hover highlight mesh
let dust = null;           // ambient particle field
let elapsed = 0;           // accumulated seconds for ambient motion
const parallax = { x: 0, y: 0 }; // pointer-driven camera drift, -1..1
let hoveredMesh = null;    // piece lifting under the cursor
let parked = { w: [], b: [] };   // captured meshes resting on the table

const PIECE_HEIGHT = { P: 0.55, N: 0.7, B: 0.75, R: 0.65, Q: 0.9, K: 1.0 };

function sqToVec(sq) {
    const file = sq.charCodeAt(0) - 97;       // a=0
    const rank = sq.charCodeAt(1) - 49;       // 1=0
    return new THREE.Vector3((file - 3.5) * SQ, 0, (3.5 - rank) * SQ);
}

function vecToSq(x, z) {
    const file = Math.round(x / SQ + 3.5);
    const rank = Math.round(3.5 - z / SQ);
    return String.fromCharCode(97 + file) + String.fromCharCode(49 + rank);
}

// ---- procedural piece geometry ----

function lathe(pts, segments = 24) {
    const geo = new THREE.LatheGeometry(pts.map(p => new THREE.Vector2(p[0], p[1])), segments);
    geo.computeVertexNormals();
    return geo;
}

function pawnGeo() {
    return lathe([
        [0, 0], [0.30, 0], [0.30, 0.04], [0.26, 0.06], [0.18, 0.10],
        [0.13, 0.16], [0.11, 0.30], [0.14, 0.34], [0.16, 0.36],
        [0.155, 0.42], [0.12, 0.44], [0.13, 0.46],
    ]).scale(1, 1, 1);
}

function pawnHead() {
    return new THREE.SphereGeometry(0.14, 16, 16);
}

function rookGeo() {
    return lathe([
        [0, 0], [0.32, 0], [0.32, 0.05], [0.28, 0.07], [0.22, 0.12],
        [0.19, 0.20], [0.19, 0.48], [0.24, 0.52], [0.26, 0.55],
        [0.26, 0.65], [0.20, 0.65], [0.20, 0.60], [0, 0.60],
    ]);
}

function bishopGeo() {
    return lathe([
        [0, 0], [0.30, 0], [0.30, 0.05], [0.26, 0.08], [0.17, 0.14],
        [0.12, 0.22], [0.10, 0.40], [0.15, 0.46], [0.18, 0.52],
        [0.17, 0.58], [0.12, 0.62], [0.135, 0.65],
    ]);
}

function bishopTop() {
    const s = new THREE.SphereGeometry(0.11, 16, 16);
    s.scale(1, 1.35, 1);
    return s;
}

function knightGeo() {
    return lathe([
        [0, 0], [0.32, 0], [0.32, 0.05], [0.27, 0.08], [0.20, 0.13],
        [0.16, 0.20], [0.15, 0.34], [0.20, 0.42], [0.17, 0.46],
    ]);
}

function knightHead() {
    // simple horse-head-ish: elongated box, tilted
    const g = new THREE.BoxGeometry(0.16, 0.42, 0.34);
    g.translate(0, 0.2, -0.03);
    const m = new THREE.Matrix4().makeRotationX(-0.35);
    g.applyMatrix4(m);
    return g;
}

function queenGeo() {
    return lathe([
        [0, 0], [0.32, 0], [0.32, 0.05], [0.28, 0.08], [0.19, 0.15],
        [0.13, 0.28], [0.11, 0.55], [0.15, 0.62], [0.19, 0.66],
        [0.21, 0.74], [0.19, 0.80], [0.14, 0.82], [0.16, 0.85],
    ]);
}

function queenTop() {
    return new THREE.SphereGeometry(0.09, 12, 12);
}

function kingGeo() {
    return lathe([
        [0, 0], [0.32, 0], [0.32, 0.05], [0.28, 0.08], [0.19, 0.15],
        [0.13, 0.28], [0.11, 0.58], [0.15, 0.64], [0.19, 0.68],
        [0.20, 0.76], [0.18, 0.84], [0.13, 0.88],
    ]);
}

function kingCrossV() { return new THREE.BoxGeometry(0.06, 0.22, 0.06); }
function kingCrossH() { return new THREE.BoxGeometry(0.16, 0.06, 0.06); }

const whiteMat = new THREE.MeshStandardMaterial({ color: 0xf1e6cf, roughness: 0.55, metalness: 0.05 });
const blackMat = new THREE.MeshStandardMaterial({ color: 0x48413a, roughness: 0.45, metalness: 0.2 });
const darkDetailMat = new THREE.MeshStandardMaterial({ color: 0x141210, roughness: 0.6 });

function buildPiece(type, white) {
    const mat = white ? whiteMat : blackMat;
    const g = new THREE.Group();
    const h = PIECE_HEIGHT[type];

    const add = (geo, y = 0, sy = 1) => {
        const mesh = new THREE.Mesh(geo, mat);
        mesh.position.y = y;
        if (sy !== 1) mesh.scale.y = sy;
        mesh.castShadow = true;
        g.add(mesh);
        return mesh;
    };

    switch (type) {
        case 'P':
            add(pawnGeo(), 0);
            add(pawnHead(), 0.62);
            break;
        case 'R': {
            add(rookGeo(), 0);
            // merlons: four teeth around the rim so the rook reads as a castle tower
            const tooth = new THREE.BoxGeometry(0.09, 0.1, 0.07);
            for (let i = 0; i < 4; i++) {
                const t = new THREE.Mesh(tooth, mat);
                const a = i * Math.PI / 2;
                t.position.set(Math.cos(a) * 0.215, 0.68, Math.sin(a) * 0.215);
                t.rotation.y = -a;
                t.castShadow = true;
                g.add(t);
            }
            break;
        }
        case 'N': {
            add(knightGeo(), 0);
            const head = add(knightHead(), 0.42);
            head.rotation.y = white ? -Math.PI / 2 : Math.PI / 2; // face opponent
            break;
        }
        case 'B': {
            add(bishopGeo(), 0);
            const top = add(bishopTop(), 0.72);
            // mitre slit: thin dark groove across the head
            const slit = new THREE.Mesh(new THREE.BoxGeometry(0.025, 0.16, 0.13), darkDetailMat);
            slit.position.set(0, 0.78, 0);
            slit.rotation.z = 0.5;
            g.add(slit);
            break;
        }
        case 'Q': {
            add(queenGeo(), 0);
            add(queenTop(), 0.92);
            break;
        }
        case 'K': {
            add(kingGeo(), 0);
            const v = add(kingCrossV(), 0.98);
            const hh = add(kingCrossH(), 0.98);
            break;
        }
    }
    // normalize scale so all pieces share consistent board fit
    g.scale.setScalar(0.85);
    g.traverse(o => { if (o.isMesh) { o.castShadow = true; } });
    g.userData.type = type;
    g.userData.isWhite = white;
    return g;
}

// ---- scene ----

// procedural walnut grain — dark base, faint streaks and a few soft knots
function woodTexture() {
    const c = document.createElement('canvas');
    c.width = c.height = 512;
    const g = c.getContext('2d');
    g.fillStyle = '#251a11';
    g.fillRect(0, 0, 512, 512);
    for (let i = 0; i < 110; i++) {
        const y = Math.random() * 512, h = 1 + Math.random() * 2.5;
        g.fillStyle = Math.random() < 0.55 ? 'rgba(0,0,0,0.10)' : 'rgba(122,84,50,0.07)';
        g.fillRect(0, y, 512, h);
    }
    for (let i = 0; i < 9; i++) {
        const x = Math.random() * 512, y = Math.random() * 512, r = 9 + Math.random() * 22;
        const rad = g.createRadialGradient(x, y, 1, x, y, r);
        rad.addColorStop(0, 'rgba(58,38,20,0.4)');
        rad.addColorStop(1, 'rgba(58,38,20,0)');
        g.fillStyle = rad;
        g.beginPath();
        g.ellipse(x, y, r * 1.7, r * 0.8, Math.random() * 3, 0, 7);
        g.fill();
    }
    const t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(2.6, 2.6);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
}

// soft warm disc — fakes a light pool so the board reads as lit, not floating
function glowTexture() {
    const c = document.createElement('canvas');
    c.width = c.height = 256;
    const g = c.getContext('2d');
    const rad = g.createRadialGradient(128, 128, 8, 128, 128, 128);
    rad.addColorStop(0, 'rgba(255,205,140,0.34)');
    rad.addColorStop(0.55, 'rgba(255,190,120,0.10)');
    rad.addColorStop(1, 'rgba(255,190,120,0)');
    g.fillStyle = rad;
    g.fillRect(0, 0, 256, 256);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
}

export function initScene(canvasEl, dotNetRef) {
    canvas = canvasEl;
    dotNet = dotNetRef;

    renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x14161b);
    scene.fog = new THREE.Fog(0x14161b, 35, 70);

    camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100);
    camera.position.set(0, 9.7, 5.0);

    controls = new OrbitControls(camera, canvas);
    controls.enablePan = false;
    controls.enableRotate = false; // board stays fixed and centred — zoom only
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.minDistance = 4;
    controls.maxDistance = 45;
    controls.maxPolarAngle = Math.PI / 2.1;
    controls.target.set(0, -1.0, 0); // steeper look-down lifts the board toward vertical centre

    // lights
    scene.add(new THREE.HemisphereLight(0xd8e2ff, 0x40372c, 0.75));
    const sun = new THREE.DirectionalLight(0xfff2dd, 1.6);
    sun.position.set(6, 12, 4);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.camera.left = -7; sun.shadow.camera.right = 7;
    sun.shadow.camera.top = 7; sun.shadow.camera.bottom = -7;
    scene.add(sun);

    // board frame
    const frame = new THREE.Mesh(
        new THREE.BoxGeometry(8 * SQ + 0.9, 0.28, 8 * SQ + 0.9),
        new THREE.MeshStandardMaterial({ color: 0x4a3b2a, roughness: 0.7 })
    );
    frame.position.y = -0.16;
    frame.receiveShadow = true;
    scene.add(frame);

    // walnut table with a warm pool of light under the board
    const table = new THREE.Mesh(
        new THREE.CircleGeometry(30, 64),
        new THREE.MeshStandardMaterial({ map: woodTexture(), roughness: 0.85 })
    );
    table.rotation.x = -Math.PI / 2;
    table.position.y = -0.32;
    table.receiveShadow = true;
    scene.add(table);

    const pool = new THREE.Mesh(
        new THREE.PlaneGeometry(24, 24),
        new THREE.MeshBasicMaterial({
            map: glowTexture(), transparent: true, opacity: 0.5,
            depthWrite: false, blending: THREE.AdditiveBlending,
        })
    );
    pool.rotation.x = -Math.PI / 2;
    pool.position.y = -0.30;
    scene.add(pool);

    // dust motes drifting in the light
    {
        const n = 110, pos = new Float32Array(n * 3), seed = new Float32Array(n);
        for (let i = 0; i < n; i++) {
            pos[i * 3] = (Math.random() - 0.5) * 20;
            pos[i * 3 + 1] = 0.2 + Math.random() * 4.5;
            pos[i * 3 + 2] = (Math.random() - 0.5) * 20;
            seed[i] = Math.random() * 6.28;
        }
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
        dust = new THREE.Points(geo, new THREE.PointsMaterial({
            color: 0xc9a86a, size: 0.05, transparent: true, opacity: 0.45, depthWrite: false,
        }));
        dust.userData.seed = seed;
        scene.add(dust);
    }

    // 64 squares
    const sqGeo = new THREE.PlaneGeometry(SQ * 0.98, SQ * 0.98);
    for (let f = 0; f < 8; f++) {
        for (let r = 0; r < 8; r++) {
            const light = (f + r) % 2 === 1;
            const m = new THREE.Mesh(sqGeo, new THREE.MeshStandardMaterial({
                color: light ? LIGHT_SQ : DARK_SQ, roughness: 0.85,
            }));
            m.rotation.x = -Math.PI / 2;
            const sq = String.fromCharCode(97 + f) + String.fromCharCode(49 + r);
            const v = sqToVec(sq);
            m.position.set(v.x, 0, v.z);
            m.receiveShadow = true;
            m.userData.square = sq;
            scene.add(m);
            boardMeshes[sq] = m;
        }
    }

    highlightGroup = new THREE.Group();
    scene.add(highlightGroup);

    coordGroup = new THREE.Group();
    scene.add(coordGroup);
    rebuildCoords();

    raycaster = new THREE.Raycaster();
    clock = new THREE.Clock();

    canvas.addEventListener('pointerdown', onPointerDown);
    canvas.addEventListener('pointermove', onPointerMove);
    canvas.addEventListener('pointerleave', () => { parallax.x = 0; parallax.y = 0; clearHover(); });
    canvas.addEventListener('contextmenu', onContextMenu);
    window.addEventListener('pointerup', onPointerUp);
    window.addEventListener('keydown', onKeyNav);

    resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(canvas.parentElement || canvas);
    resize();
    renderer.setAnimationLoop(tick);

    if (dotNet) dotNet.invokeMethodAsync('SceneReady');
    return true;
}

function ndcFromEvent(e) {
    const rect = canvas.getBoundingClientRect();
    return new THREE.Vector2(
        ((e.clientX - rect.left) / rect.width) * 2 - 1,
        -((e.clientY - rect.top) / rect.height) * 2 + 1
    );
}

// raycast pieces first, then board squares -> {kind:'piece'|'square', sq, obj}
function pickAt(e) {
    raycaster.setFromCamera(ndcFromEvent(e), camera);
    const pieceList = Object.values(pieceMeshes).flatMap(gr => gr.children);
    let hits = raycaster.intersectObjects(pieceList, false);
    if (hits.length) {
        const o = hits[0].object;
        return { kind: 'piece', sq: vecToSq(o.parent.position.x, o.parent.position.z), group: o.parent };
    }
    hits = raycaster.intersectObjects(Object.values(boardMeshes), false);
    if (hits.length) return { kind: 'square', sq: hits[0].object.userData.square };
    return { kind: 'miss' };
}

// intersect ray with the board plane -> square name or null
function squareUnderRay(e) {
    raycaster.setFromCamera(ndcFromEvent(e), camera);
    const hits = raycaster.intersectObjects(Object.values(boardMeshes), false);
    return hits.length ? hits[0].object.userData.square : null;
}

function planePoint(e, y = 0) {
    raycaster.setFromCamera(ndcFromEvent(e), camera);
    const pt = new THREE.Vector3();
    return raycaster.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), -y), pt) ? pt : null;
}

function onContextMenu(e) { e.preventDefault(); }

const NAV_KEYS = { ArrowLeft: 'prev', ArrowRight: 'next', ArrowUp: 'start', ArrowDown: 'end', Home: 'start', End: 'end' };
function onKeyNav(e) {
    if (!dotNet) return;
    if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT' || e.target.tagName === 'TEXTAREA')) return;
    const dir = NAV_KEYS[e.key];
    if (dir) { e.preventDefault(); dotNet.invokeMethodAsync('NavKey', dir); }
}

function onPointerDown(e) {
    if (!dotNet) return;
    if (e.button === 2) { dotNet.invokeMethodAsync('RightClicked'); return; }
    if (e.button !== 0) return;
    const hit = pickAt(e);
    if (hit.kind === 'piece') {
        const mesh = pieceMeshes[hit.sq];
        if (mesh) {
            drag = { mesh, from: hit.sq, started: false, origin: mesh.position.clone(), x0: e.clientX, y0: e.clientY };
            controls.enabled = false; // dragging a piece must not orbit the board
        }
        dotNet.invokeMethodAsync('SquareClicked', hit.sq);
        return;
    }
    if (hit.kind === 'square') {
        dotNet.invokeMethodAsync('SquareClicked', hit.sq);
    }
}

const DRAG_Y = 0.42;

function clearHover() {
    if (hoveredMesh) { hoveredMesh.userData.lift = false; hoveredMesh = null; }
}

function onPointerMove(e) {
    if (!dotNet || !scene) return;
    if (!drag) {
        const r = canvas.getBoundingClientRect();
        if (e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom) {
            // camera drift: the table lives in 3D, so the view leans a touch
            // with the pointer instead of staying glued down
            const n = ndcFromEvent(e);
            parallax.x = n.x; parallax.y = n.y;
            const hit = pickAt(e);
            canvas.style.cursor = hit.kind === 'piece' ? 'grab' : '';
            const m = hit.kind === 'piece' ? pieceMeshes[hit.sq] : null;
            if (m !== hoveredMesh) {
                clearHover();
                hoveredMesh = m;
                if (hoveredMesh) hoveredMesh.userData.lift = true;
            }
        }
        return;
    }
    if (!drag.started) {
        const dx = e.clientX - drag.x0, dy = e.clientY - drag.y0;
        if (dx * dx + dy * dy < 36) return; // 6px threshold: still a click
        drag.started = true;
        canvas.style.cursor = 'grabbing';
    }
    const pt = planePoint(e);
    if (pt) {
        drag.mesh.position.set(pt.x, DRAG_Y, pt.z);
        const sq = squareUnderRay(e);
        if (sq !== hoverSq) {
            hoverSq = sq;
            updateHoverHl();
        }
    }
}

function updateHoverHl() {
    if (hoverHl) { highlightGroup.remove(hoverHl); hoverHl.geometry.dispose(); hoverHl = null; }
    if (hoverSq && drag?.started) {
        const v = sqToVec(hoverSq);
        hoverHl = new THREE.Mesh(
            new THREE.PlaneGeometry(SQ * 0.96, SQ * 0.96),
            new THREE.MeshBasicMaterial({ color: 0xf7d154, transparent: true, opacity: 0.45, depthWrite: false })
        );
        hoverHl.rotation.x = -Math.PI / 2;
        hoverHl.position.set(v.x, 0.018, v.z);
        highlightGroup.add(hoverHl);
    }
}

function onPointerUp(e) {
    if (!drag) return;
    const d = drag; drag = null;
    controls.enabled = true;
    canvas.style.cursor = '';
    clearHover(); // hover re-picks on the next move; the dragged mesh keeps no lift
    if (hoverHl) { highlightGroup.remove(hoverHl); hoverHl.geometry.dispose(); hoverHl = null; }
    hoverSq = null;
    if (!d.started) return; // it was a plain click — pointerdown already handled

    const dropSq = scene ? squareUnderRay(e) : null;
    // snap the piece back unless the drop square is a real target of the selection
    const legal = dropSq && (dropSq === d.from || lastTargets.includes(dropSq));
    if (!legal) {
        const dest = d.origin.clone();
        animations.push({ mesh: d.mesh, kind: 'dragback', t: 0, from: d.mesh.position.clone(), to: dest });
    }
    if (dropSq && dotNet) dotNet.invokeMethodAsync('SquareClicked', dropSq);
}

// ---- state sync ----

export function setPieces(pieces) {
    // pieces: [{square:'e4', type:'P', color:'w'|'b'}, ...]
    const want = {};
    for (const p of pieces) want[p.square] = p;

    // remove gone pieces
    for (const sq of Object.keys(pieceMeshes)) {
        if (!want[sq]) {
            scene.remove(pieceMeshes[sq]);
            delete pieceMeshes[sq];
        }
    }
    // add / relocate — new meshes drop in from above, staggered
    let spawnIdx = 0;
    for (const p of pieces) {
        const existing = pieceMeshes[p.square];
        if (existing && existing.userData.type === p.type && existing.userData.isWhite === (p.color === 'w')) continue;
        if (existing) { scene.remove(existing); delete pieceMeshes[p.square]; }
        const mesh = buildPiece(p.type, p.color === 'w');
        const v = sqToVec(p.square);
        mesh.position.set(v.x, PIECE_Y + 0.75, v.z);
        mesh.userData.square = p.square;
        pieceMeshes[p.square] = mesh;
        scene.add(mesh);
        animations.push({ mesh, kind: 'drop', t: -spawnIdx++ * 0.07, from: mesh.position.clone(), to: new THREE.Vector3(v.x, PIECE_Y, v.z) });
    }
    // settle any in-flight tweens instantly before dropping the queue —
    // fades finish by removal or the half-shrunk ghost would linger in scene
    for (const a of animations) {
        if (a.kind === 'fade') scene.remove(a.mesh);
        else if (a.to && a.kind !== 'drop') {
            a.mesh.position.copy(a.to);
            if (a.toRot !== undefined) a.mesh.rotation.z = a.toRot;
        }
    }
    animations = animations.filter(a => a.kind === 'drop');
}

// captured pieces rest on the table in a loose row off the capturer's edge:
// black victims (taken by White) line up near rank 1, white victims off rank 8.
// They lie knocked over, like scooped-up pieces on a real table.
const PARK_X0 = -3.85, PARK_DX = 1.1;
const PARK_Y = -0.02; // table top (−0.32) + a lying piece's base radius
function parkSlotPos(victimColor, idx) {
    const sign = (victimColor === 'b' ? 1 : -1) * (flipped ? -1 : 1);
    return {
        x: PARK_X0 + (idx % 8) * PARK_DX,
        z: sign * (5.35 + Math.floor(idx / 8) * 0.62),
    };
}

// reconcile parked meshes with the session's captured lists (move, undo,
// review ply, FEN) — extras fade out, missing ones drop onto the table
let autoZoomed = false; // camera pushed itself out to reveal the parking rows

export function setCaptured(whiteVictims, blackVictims) {
    const had = parked.w.length + parked.b.length > 0;
    syncPark('w', whiteVictims || []);
    syncPark('b', blackVictims || []);
    // last parked piece gone (undo/new game/FEN): breathe the camera back in
    if (had && parked.w.length + parked.b.length === 0 && autoZoomed) {
        autoZoomed = false;
        resize();
        const dirN = camera.position.clone().sub(controls.target).normalize();
        camera.position.copy(controls.target).addScaledVector(dirN, anchorDist(BASE_ANCHORS, fitDistance()));
    }
}

function syncPark(color, want) {
    const list = parked[color];
    // a mismatch anywhere in the visible order means rebuild from that slot
    let cut = list.findIndex((m, i) => i >= want.length || m.userData.type !== want[i]);
    if (cut === -1) cut = list.length;
    for (let j = list.length - 1; j >= cut; j--) {
        const m = list.pop();
        animations.push({ mesh: m, kind: 'fade', t: 0 });
    }
    let spawned = 0;
    for (let i = list.length; i < want.length; i++) {
        const m = buildPiece(want[i], color === 'w');
        const s = parkSlotPos(color, i);
        m.position.set(s.x, PARK_Y + 0.8, s.z);
        m.rotation.y = (Math.random() - 0.5) * 0.5;
        const tip = (Math.random() < 0.5 ? -1 : 1) * (Math.PI / 2 + (Math.random() - 0.5) * 0.3);
        m.userData.isWhite = color === 'w';
        list.push(m);
        scene.add(m);
        animations.push({ mesh: m, kind: 'drop', t: -spawned++ * 0.06 - 0.05, from: m.position.clone(), to: new THREE.Vector3(s.x, PARK_Y, s.z), toRot: tip });
    }
}

export function applyMove(from, to, opts = {}) {
    const mover = pieceMeshes[from];
    if (!mover) return;

    // capture (normal or en passant via opts.capturedSquare): the victim hops
    // off the board and comes to rest on the table beside its capturer's edge
    const capSq = opts.capturedSquare || (pieceMeshes[to] ? to : null);
    if (capSq && pieceMeshes[capSq]) {
        const victim = pieceMeshes[capSq];
        delete pieceMeshes[capSq];
        const color = victim.userData.isWhite ? 'w' : 'b';
        const idx = parked[color].length;
        parked[color].push(victim);
        const s = parkSlotPos(color, idx);
        const tip = (Math.random() < 0.5 ? -1 : 1) * (Math.PI / 2 + (Math.random() - 0.5) * 0.3);
        animations.push({ mesh: victim, kind: 'park', t: 0, from: victim.position.clone(), to: new THREE.Vector3(s.x, PARK_Y, s.z), toRot: tip });
        victim.rotation.y = (Math.random() - 0.5) * 0.6;
    }

    // move
    delete pieceMeshes[from];
    pieceMeshes[to] = mover;
    mover.userData.square = to;
    const target = sqToVec(to);
    animations.push({ mesh: mover, kind: 'move', t: 0, from: mover.position.clone(), to: new THREE.Vector3(target.x, PIECE_Y, target.z) });

    // castling rook
    if (opts.rookFrom && opts.rookTo && pieceMeshes[opts.rookFrom]) {
        const rook = pieceMeshes[opts.rookFrom];
        delete pieceMeshes[opts.rookFrom];
        pieceMeshes[opts.rookTo] = rook;
        const rv = sqToVec(opts.rookTo);
        animations.push({ mesh: rook, kind: 'move', t: 0, from: rook.position.clone(), to: new THREE.Vector3(rv.x, PIECE_Y, rv.z) });
    }

    // promotion: swap model after landing
    if (opts.promoteTo) {
        animations.push({
            kind: 'promote', t: 0, sq: to, promoteTo: opts.promoteTo, white: mover.userData.isWhite, mesh: mover,
        });
    }
}

export function setHighlights(h) {
    // h: {selected?, targets[], check?, lastMove: [from,to], premove?: [from,to]}
    lastSelected = h.selected ?? null;
    lastTargets = h.targets || [];
    highlightGroup.clear();
    hoverHl = null;
    if (hoverSq && drag?.started) updateHoverHl();
    const mk = (sq, color, opacity, size = 0.96, y = 0.012) => {
        const v = sqToVec(sq);
        const m = new THREE.Mesh(
            new THREE.PlaneGeometry(SQ * size, SQ * size),
            new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false })
        );
        m.rotation.x = -Math.PI / 2;
        m.position.set(v.x, y, v.z);
        highlightGroup.add(m);
    };
    const dot = (sq) => {
        const v = sqToVec(sq);
        const geo = new THREE.CircleGeometry(0.12, 20);
        const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: 0x2e7d32, transparent: true, opacity: 0.85, depthWrite: false }));
        m.rotation.x = -Math.PI / 2;
        m.position.set(v.x, 0.014, v.z);
        highlightGroup.add(m);
    };
    if (h.lastMove) for (const s of h.lastMove) mk(s, 0xd6c94e, 0.45);
    if (h.selected) mk(h.selected, 0xffd83d, 0.62);
    for (const s of h.targets || []) dot(s);
    if (h.premove) for (const s of h.premove) mk(s, 0x9c4dc4, 0.4);
    if (h.check) mk(h.check, 0xd64545, 0.55, 0.96, 0.016);
}

export function flipBoard() {
    flipped = !flipped;
    camera.position.z = -camera.position.z;
    controls.target.z = -controls.target.z;
    rebuildCoords();
    // parked captures swap sides with the viewpoint
    for (const c of ['w', 'b'])
        parked[c].forEach((m, i) => {
            const s = parkSlotPos(c, i);
            m.position.set(s.x, PARK_Y, s.z);
        });
    controls.update();
}

/// Explicit orientation (vs AI: sit on the human's side).
export function setOrientation(whiteView) {
    const wantFlipped = !whiteView;
    if (wantFlipped !== flipped) flipBoard();
}

// ---- board coordinates (a–h, 1–8 on the frame edge) ----

function labelMesh(text) {
    const c = document.createElement('canvas');
    c.width = c.height = 64;
    const x = c.getContext('2d');
    x.font = '600 44px "Segoe UI", system-ui, sans-serif';
    x.textAlign = 'center';
    x.textBaseline = 'middle';
    x.strokeStyle = 'rgba(0,0,0,0.55)';
    x.lineWidth = 6;
    x.strokeText(text, 32, 36);
    x.fillStyle = '#f0e9da';
    x.fillText(text, 32, 36);
    const tex = new THREE.CanvasTexture(c);
    tex.anisotropy = 4;
    const m = new THREE.Mesh(
        new THREE.PlaneGeometry(0.3, 0.3),
        new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false })
    );
    m.rotation.x = -Math.PI / 2;
    return m;
}

function rebuildCoords() {
    if (!coordGroup) return;
    coordGroup.clear();
    const edge = 8 * SQ / 2 + 0.42; // on the frame border
    for (let i = 0; i < 8; i++) {
        const x = (i - 3.5) * SQ, z = (3.5 - i) * SQ;
        const file = labelMesh(String.fromCharCode(97 + i));       // a–h, bottom edge
        file.position.set(x, 0.02, flipped ? -edge : edge);
        if (flipped) file.rotation.z = Math.PI;
        coordGroup.add(file);
        const rank = labelMesh(String.fromCharCode(49 + i));       // 1–8, left edge
        rank.position.set(flipped ? edge : -edge, 0.02, z);
        if (flipped) rank.rotation.z = Math.PI;
        coordGroup.add(rank);
    }
}

function tick() {
    const dt = Math.min(clock.getDelta(), 0.05);
    elapsed += dt;
    const SPEED = 3.2;
    for (let i = animations.length - 1; i >= 0; i--) {
        const a = animations[i];
        a.t += dt * SPEED;
        if (a.kind === 'move' || a.kind === 'park') {
            const k = easeOut(Math.min(a.t, 1));
            a.mesh.position.lerpVectors(a.from, a.to, k);
            a.mesh.position.y += Math.sin(Math.min(a.t, 1) * Math.PI) * (a.kind === 'park' ? 0.55 : 0.35); // hop
            if (a.toRot !== undefined) a.mesh.rotation.z = a.toRot * k; // knocked-over fall
            if (a.t >= 1) animations.splice(i, 1);
        } else if (a.kind === 'drop') {
            const k = a.t < 0 ? 0 : easeOut(Math.min(a.t, 1));
            a.mesh.position.lerpVectors(a.from, a.to, k);
            if (a.toRot !== undefined) a.mesh.rotation.z = a.toRot * k;
            if (a.t >= 1) animations.splice(i, 1);
        } else if (a.kind === 'fade') {
            const k = Math.min(a.t * 1.4, 1);
            a.mesh.scale.setScalar(0.85 * (1 - k));
            a.mesh.position.y = PIECE_Y - k * 0.4;
            if (k >= 1) { scene.remove(a.mesh); animations.splice(i, 1); }
        } else if (a.kind === 'dragback') {
            const k = easeOut(Math.min(a.t * 1.6, 1));
            a.mesh.position.lerpVectors(a.from, a.to, k);
            if (a.t * 1.6 >= 1) animations.splice(i, 1);
        } else if (a.kind === 'promote') {
            if (a.t >= 1) {
                // swap to promoted model
                const idx = pieceMeshes[a.sq];
                if (idx === a.mesh) {
                    scene.remove(a.mesh);
                    const nm = buildPiece(a.promoteTo, a.white);
                    const v = sqToVec(a.sq);
                    nm.position.set(v.x, PIECE_Y, v.z);
                    nm.userData.square = a.sq;
                    pieceMeshes[a.sq] = nm;
                    scene.add(nm);
                }
                animations.splice(i, 1);
            }
        }
    }

    // ambient life: dust drifts, the camera leans gently toward the pointer,
    // and the piece under the cursor rises a touch off its square
    if (dust) {
        const p = dust.geometry.attributes.position.array, s = dust.userData.seed;
        for (let i = 0; i < s.length; i++) {
            p[i * 3] += Math.sin(elapsed * 0.12 + s[i]) * 0.0016;
            p[i * 3 + 2] += Math.cos(elapsed * 0.1 + s[i] * 1.7) * 0.0016;
            p[i * 3 + 1] += Math.sin(elapsed * 0.2 + s[i] * 2.3) * 0.0009;
        }
        dust.geometry.attributes.position.needsUpdate = true;
    }
    const pk = Math.min(dt * 4, 1);
    controls.target.x += ((parallax.x * 0.28) - controls.target.x) * pk;
    controls.target.y += ((-1.0 - parallax.y * 0.12) - controls.target.y) * pk;
    // captures parked off-board: if any parked piece leaves the frame, the
    // camera breathes out on its own until the row is visible again
    if (parked.w.length || parked.b.length) {
        const v = new THREE.Vector3();
        let out = false;
        for (const c of ['w', 'b']) {
            for (const m of parked[c]) {
                v.copy(m.position); v.y += 0.5;
                v.project(camera);
                if (Math.abs(v.x) > 0.96 || Math.abs(v.y) > 0.97) { out = true; break; }
            }
            if (out) break;
        }
        const cur = camera.position.distanceTo(controls.target);
        // unless the player zoomed in deliberately (they chose the crop)
        if (out && cur > fitDistance() * 0.9 && cur < controls.maxDistance) {
            const dirN = camera.position.clone().sub(controls.target).normalize();
            camera.position.copy(controls.target).addScaledVector(dirN, Math.min(cur * (1 + dt * 1.8), controls.maxDistance));
            autoZoomed = true;
        }
    }
    for (const sq of Object.keys(pieceMeshes)) {
        const m = pieceMeshes[sq];
        if (animations.some(a => a.mesh === m) || (drag && drag.mesh === m)) continue;
        const ty = PIECE_Y + (m.userData.lift ? 0.07 : 0);
        if (Math.abs(m.position.y - ty) > 0.001)
            m.position.y += (ty - m.position.y) * Math.min(dt * 12, 1);
    }
    controls.update();
    renderer.render(scene, camera);
}

function easeOut(t) { return 1 - Math.pow(1 - t, 3); }

function fitDistance() {
    // projected board depth is foreshortened by the steep camera pitch (~27°
    // off vertical); halfH below already includes that factor + frame margin
    const halfH = 4.75; // incl front coordinate row (near edge projects largest)
    // near edge (rank 1) is closer to the camera so it projects wider than
    // the geometric half-width — pad so a/h corner squares never clip
    const halfW = 5.0;
    const v = THREE.MathUtils.degToRad(camera.fov / 2);
    return Math.max(halfH / Math.tan(v), halfW / (Math.tan(v) * camera.aspect)) * 1.03;
}

// anchor sets: the board itself (frame, coordinate strip, piece tops) always
// fits; the parked-capture rows only bound the max zoom-out so the default
// view stays tight on the board and breathes out when material is taken
const BASE_ANCHORS = [
    [-4.95, 0, 5.15], [4.95, 0, 5.15], [-4.95, 0, -5.15], [4.95, 0, -5.15],
    [0, 1.5, -3.7], [0, 1.4, 3.7],
];
const PARK_ANCHORS = [
    [-4.4, 0.7, 6.35], [4.4, 0.7, 6.35], [-4.4, 0.7, -6.35], [4.4, 0.7, -6.35],
];

// step the camera out along its view axis until every anchor projects inside
// the viewport — anchors beat a flat half-extent because the near edge
// foreshortens differently at narrow aspects
function anchorDist(anchors, dist) {
    const dirN = camera.position.clone().sub(controls.target).normalize();
    const probe = new THREE.Vector3();
    for (let i = 0; i < 20; i++) {
        camera.position.copy(controls.target).addScaledVector(dirN, dist);
        camera.updateMatrixWorld(); // refresh matrixWorldInverse for .project()
        camera.updateProjectionMatrix();
        if (anchors.every(([x, y, z]) => {
            probe.set(x, y, z).project(camera);
            return Math.abs(probe.x) <= 0.96 && Math.abs(probe.y) <= 0.97;
        })) break;
        dist *= 1.04;
    }
    return dist;
}

function resize() {
    // measure the canvas itself: the parent's clientWidth includes padding
    // (mobile right gutter for the eval pill), which would corrupt aspect
    const w = canvas.clientWidth, h = Math.max(canvas.clientHeight, 200);
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    // a stale view offset from the previous resize() would poison the anchor
    // probe below — clear it, then re-solve after the distance is final
    camera.clearViewOffset();
    camera.updateProjectionMatrix();
    const dirN = camera.position.clone().sub(controls.target).normalize();
    const dist = anchorDist(BASE_ANCHORS, Math.max(camera.position.distanceTo(controls.target), fitDistance()));
    const parkDist = anchorDist(BASE_ANCHORS.concat(PARK_ANCHORS), dist);
    camera.position.copy(controls.target).addScaledVector(dirN, dist); // settle on board fit
    controls.minDistance = 5;
    controls.maxDistance = Math.max(dist, parkDist) * 1.15; // zoom allowed; parked rows always reachable
    // view offset lifts the projected board toward vertical centre — the fit
    // leaves room for the top clock, so raw centering lands the board low.
    // Probe the projected midpoint of the board's far/near edges (the near
    // edge projects larger, so centre-of-origin is not the visual centre),
    // then solve the exact offset (units vary with devicePixelRatio).
    const EDGE = 3.5; // square-centre depth — the span the eye reads as centred
    const projY = off => {
        camera.setViewOffset(w, h, 0, off, w, h);
        camera.updateProjectionMatrix();
        const far = new THREE.Vector3(0, 0, -EDGE).project(camera).y;
        const near = new THREE.Vector3(0, 0, EDGE).project(camera).y;
        return (2 - far - near) / 4; // screen-space fraction of the span midpoint
    };
    const y0 = projY(0), y1 = projY(50);
    const slope = (y1 - y0) / 50;
    if (Math.abs(slope) > 1e-6)
        camera.setViewOffset(w, h, 0, Math.round((0.5 - y0) / slope), w, h);
    controls.update();
    // hand the eval pill the board's projected left edge so it hugs the board
    // however wide the table fills around it
    const px = (new THREE.Vector3(-4.62, 0, 0).project(camera).x * 0.5 + 0.5) * w;
    const cr = canvas.getBoundingClientRect(), pr = canvas.parentElement.getBoundingClientRect();
    canvas.style.setProperty('--board-left', Math.max(8, Math.round(px + cr.left - pr.left - 26)) + 'px');
}

// ---- procedural sounds (WebAudio, no assets) ----

let actx = null;
function ac() {
    if (!actx) actx = new (window.AudioContext || window.webkitAudioContext)();
    if (actx.state === 'suspended') actx.resume();
    return actx;
}

function tone(freq, dur, type = 'sine', vol = 0.15, slide = 0, delay = 0) {
    const ctx = ac(), t = ctx.currentTime + delay;
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(freq + slide, 30), t + dur);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(ctx.destination);
    o.start(t); o.stop(t + dur + 0.02);
}

function thock(vol = 0.3, freq = 420, dur = 0.08, delay = 0) {
    const ctx = ac(), t = ctx.currentTime + delay;
    const len = Math.ceil(ctx.sampleRate * dur);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.2);
    const src = ctx.createBufferSource(); src.buffer = buf;
    const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = freq;
    const g = ctx.createGain(); g.gain.value = vol;
    src.connect(f).connect(g).connect(ctx.destination);
    src.start(t);
}

export function playSound(name) {
    try {
        switch (name) {
            case 'select':  tone(1150, 0.03, 'sine', 0.05); break;
            case 'move':    thock(0.32, 480); tone(190, 0.07, 'triangle', 0.18); break;
            case 'capture': thock(0.42, 260, 0.13); tone(130, 0.11, 'triangle', 0.24, -50); break;
            case 'castle':  thock(0.3, 480); thock(0.3, 480, 0.08, 0.11); break;
            case 'check':   tone(880, 0.08, 'square', 0.1); tone(1175, 0.13, 'square', 0.09, 0, 0.07); break;
            case 'promote': tone(523, 0.09, 'sine', 0.14); tone(784, 0.16, 'sine', 0.14, 0, 0.09); break;
            case 'illegal': tone(150, 0.14, 'sawtooth', 0.08, -50); break;
            case 'end':
                tone(523, 0.16, 'sine', 0.13); tone(659, 0.16, 'sine', 0.13, 0, 0.13); tone(784, 0.3, 'sine', 0.13, 0, 0.26);
                break;
        }
    } catch (e) { /* audio blocked until first gesture — fine */ }
}

export function _debug() {
    return camera ? {
        dist: +camera.position.distanceTo(controls.target).toFixed(2),
        aspect: +camera.aspect.toFixed(3),
        fit: +fitDistance().toFixed(2),
        pieces: Object.keys(pieceMeshes).length,
        viewOffset: camera.view ? { x: camera.view.offsetX, y: camera.view.offsetY } : null,
        target: controls ? { x: +controls.target.x.toFixed(2), y: +controls.target.y.toFixed(2), z: +controls.target.z.toFixed(2) } : null,
    } : 'no scene';
}

// debug: project a square to canvas pixel coords (for tests)
export function _screenPos(sq) {
    const v = sqToVec(sq);
    v.y = 0;
    v.project(camera);
    const r = canvas.getBoundingClientRect();
    return [r.left + (v.x + 1) / 2 * r.width, r.top + (1 - v.y) / 2 * r.height];
}

// debug: run the same raycast as pointerdown at client coords, report hit
export function _pick(clientX, clientY) {
    const rect = canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2(
        ((clientX - rect.left) / rect.width) * 2 - 1,
        -((clientY - rect.top) / rect.height) * 2 + 1
    );
    raycaster.setFromCamera(ndc, camera);
    const pieceList = Object.values(pieceMeshes).flatMap(gr => gr.children);
    let hits = raycaster.intersectObjects(pieceList, false);
    if (hits.length) {
        const o = hits[0].object;
        return 'piece:' + vecToSq(o.parent.position.x, o.parent.position.z);
    }
    hits = raycaster.intersectObjects(Object.values(boardMeshes), false);
    return hits.length ? 'square:' + hits[0].object.userData.square : 'miss';
}

export function dispose() {
    renderer?.setAnimationLoop(null);
    resizeObserver?.disconnect();
    canvas?.removeEventListener('pointerdown', onPointerDown);
    canvas?.removeEventListener('pointermove', onPointerMove);
    canvas?.removeEventListener('contextmenu', onContextMenu);
    window.removeEventListener('pointerup', onPointerUp);
    window.removeEventListener('keydown', onKeyNav);
    controls?.dispose();
    renderer?.dispose();
    renderer = scene = camera = controls = null;
    pieceMeshes = {};
    boardMeshes = {};
    animations = [];
    drag = null;
    dotNet = null;
}

// debug: ask .NET for session state (needs a JSInvokable DebugState on the page)
export function _state() {
    return dotNet ? dotNet.invokeMethodAsync('DebugState') : Promise.resolve('no dotNet');
}

// clipboard: navigator.clipboard is only available in secure contexts (localhost/https);
// on http://IP origins fall back to the execCommand path.
export function copyText(text) {
    if (navigator.clipboard?.writeText) return navigator.clipboard.writeText(text);
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.cssText = 'position:fixed;top:0;left:0;opacity:0';
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); } catch { }
    ta.remove();
    return Promise.resolve();
}

// bridge for debugging & legacy callers (primary path is IJSObjectReference)
globalThis.chess3d = { initScene, setPieces, setCaptured, applyMove, setHighlights, flipBoard, setOrientation, playSound, dispose, _debug, _screenPos, _pick, _state, copyText,
    _setupFen: (fen) => dotNet?.invokeMethodAsync('DebugSetupFen', fen) };
