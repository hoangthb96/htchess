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
let animations = [];
let pieceGeoCache = {};    // type -> { geo, extras }
let animId = 0;

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
const blackMat = new THREE.MeshStandardMaterial({ color: 0x36322e, roughness: 0.5, metalness: 0.15 });

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
        case 'R': add(rookGeo(), 0); break;
        case 'N': {
            add(knightGeo(), 0);
            const head = add(knightHead(), 0.42);
            head.rotation.y = white ? -Math.PI / 2 : Math.PI / 2; // face opponent
            break;
        }
        case 'B': {
            add(bishopGeo(), 0);
            const top = add(bishopTop(), 0.72);
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
    return g;
}

// ---- scene ----

export function initScene(canvasEl, dotNetRef) {
    canvas = canvasEl;
    dotNet = dotNetRef;

    renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x1a1d24);
    scene.fog = new THREE.Fog(0x1a1d24, 35, 70);

    camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100);
    camera.position.set(0, 9.8, 8.6);

    controls = new OrbitControls(camera, canvas);
    controls.enablePan = false;
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.minDistance = 4;
    controls.maxDistance = 45;
    controls.maxPolarAngle = Math.PI / 2.1;
    controls.target.set(0, 0, 0);

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

    // ground
    const ground = new THREE.Mesh(
        new THREE.CircleGeometry(16, 48),
        new THREE.MeshStandardMaterial({ color: 0x232830, roughness: 1 })
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.32;
    ground.receiveShadow = true;
    scene.add(ground);

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

    raycaster = new THREE.Raycaster();
    clock = new THREE.Clock();

    canvas.addEventListener('pointerdown', onPointerDown);

    resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(canvas.parentElement || canvas);
    resize();
    renderer.setAnimationLoop(tick);

    if (dotNet) dotNet.invokeMethodAsync('SceneReady');
    return true;
}

function onPointerDown(e) {
    if (!dotNet) return;
    const rect = canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2(
        ((e.clientX - rect.left) / rect.width) * 2 - 1,
        -((e.clientY - rect.top) / rect.height) * 2 + 1
    );
    raycaster.setFromCamera(ndc, camera);
    // pieces first (groups contain meshes)
    const pieceList = Object.values(pieceMeshes).flatMap(gr => gr.children);
    let hits = raycaster.intersectObjects(pieceList, false);
    if (hits.length) {
        const sq = vecToSq(hits[0].object.parent.position.x, hits[0].object.parent.position.z);
        dotNet.invokeMethodAsync('SquareClicked', sq);
        return;
    }
    hits = raycaster.intersectObjects(Object.values(boardMeshes), false);
    if (hits.length) {
        dotNet.invokeMethodAsync('SquareClicked', hits[0].object.userData.square);
    }
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
    // add / relocate
    for (const p of pieces) {
        const existing = pieceMeshes[p.square];
        if (existing && existing.userData.type === p.type) continue;
        if (existing) { scene.remove(existing); delete pieceMeshes[p.square]; }
        const mesh = buildPiece(p.type, p.color === 'w');
        const v = sqToVec(p.square);
        mesh.position.set(v.x, PIECE_Y, v.z);
        mesh.userData.square = p.square;
        pieceMeshes[p.square] = mesh;
        scene.add(mesh);
    }
    animations = [];
}

export function applyMove(from, to, opts = {}) {
    const mover = pieceMeshes[from];
    if (!mover) return;

    // capture (normal or en passant via opts.capturedSquare)
    const capSq = opts.capturedSquare || (pieceMeshes[to] ? to : null);
    if (capSq && pieceMeshes[capSq]) {
        const victim = pieceMeshes[capSq];
        delete pieceMeshes[capSq];
        animations.push({ mesh: victim, kind: 'fade', t: 0 });
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
        const color = 'w'; // placeholder replaced below
        const isWhite = mover.children[0]?.material === whiteMat;
        const sq = to;
        animations.push({
            kind: 'promote', t: 0, sq, promoteTo: opts.promoteTo, white: isWhite, mesh: mover,
        });
    }
}

export function setHighlights(h) {
    // h: {selected?, targets[], check?, lastMove: [from,to]}
    highlightGroup.clear();
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
    if (h.lastMove) for (const s of h.lastMove) mk(s, 0x5b8bd6, 0.35);
    if (h.selected) mk(h.selected, 0xf7d154, 0.5);
    for (const s of h.targets || []) dot(s);
    if (h.check) mk(h.check, 0xd64545, 0.55, 0.96, 0.016);
}

export function flipBoard() {
    const az = controls.getAzimuthalAngle();
    const target = az > 0 ? 0 : Math.PI;
    camera.position.set(0, camera.position.y, camera.position.z > 0 ? -Math.abs(camera.position.z) : Math.abs(camera.position.z));
    controls.update();
}

function tick() {
    const dt = Math.min(clock.getDelta(), 0.05);
    const SPEED = 3.2;
    for (let i = animations.length - 1; i >= 0; i--) {
        const a = animations[i];
        a.t += dt * SPEED;
        if (a.kind === 'move') {
            const k = easeOut(Math.min(a.t, 1));
            a.mesh.position.lerpVectors(a.from, a.to, k);
            a.mesh.position.y = PIECE_Y + Math.sin(Math.min(a.t, 1) * Math.PI) * 0.35; // hop
            if (a.t >= 1) animations.splice(i, 1);
        } else if (a.kind === 'fade') {
            const k = Math.min(a.t * 1.4, 1);
            a.mesh.scale.setScalar(0.85 * (1 - k));
            a.mesh.position.y = PIECE_Y - k * 0.4;
            if (k >= 1) { scene.remove(a.mesh); animations.splice(i, 1); }
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
    controls.update();
    renderer.render(scene, camera);
}

function easeOut(t) { return 1 - Math.pow(1 - t, 3); }

function fitDistance() {
    const halfH = 4.9; // half board depth incl frame + headroom
    const halfW = 4.6; // half board width incl frame
    const v = THREE.MathUtils.degToRad(camera.fov / 2);
    return Math.max(halfH / Math.tan(v), halfW / (Math.tan(v) * camera.aspect)) * 1.06;
}

function resize() {
    const el = canvas.parentElement || canvas;
    const w = el.clientWidth, h = Math.max(el.clientHeight, 200);
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    // keep board fully visible: push camera out if too close for current aspect
    const dir = camera.position.clone().sub(controls.target);
    const dist = Math.max(dir.length(), fitDistance());
    camera.position.copy(controls.target).add(dir.normalize().multiplyScalar(dist));
    controls.minDistance = Math.min(4, fitDistance());
    controls.update();
}

export function _debug() {
    return camera ? {
        dist: +camera.position.distanceTo(controls.target).toFixed(2),
        aspect: +camera.aspect.toFixed(3),
        fit: +fitDistance().toFixed(2),
        pieces: Object.keys(pieceMeshes).length,
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
    controls?.dispose();
    renderer?.dispose();
    renderer = scene = camera = controls = null;
    pieceMeshes = {};
    boardMeshes = {};
    animations = [];
    dotNet = null;
}

// bridge for Blazor JS interop (module loaded via <script type="module" src="@Assets[...]">)
globalThis.chess3d = { initScene, setPieces, applyMove, setHighlights, flipBoard, dispose, _debug, _screenPos, _pick };
