import * as THREE from 'three';
import { VRButton } from 'three/addons/webxr/VRButton.js';
import { XRControllerModelFactory } from 'three/addons/webxr/XRControllerModelFactory.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

let camera, scene, renderer, orbit;
const movementKeys = new Set();
const movementClock = new THREE.Clock();
const moveDirection = new THREE.Vector3();
const moveRight = new THREE.Vector3();
const worldUp = new THREE.Vector3(0, 1, 0);
const moveOffset = new THREE.Vector3();
const moveSpeed = 2.5; // meter per detik
const shapeFactories = [
  () => new THREE.BoxGeometry(0.3, 0.3, 0.3),
  () => new THREE.SphereGeometry(0.18, 32, 16),
  () => new THREE.ConeGeometry(0.16, 0.35, 32)
];
const shapeNames = ['Kubus', 'Bola', 'Kerucut'];
const controllers = [];
const interactables = []; // daftar objek yang boleh berinteraksi
const raycaster = new THREE.Raycaster();
const tempMatrix = new THREE.Matrix4();
const pointer = new THREE.Vector2();
const logBox = document.getElementById('log');
const lines = [];

// Log ke layar dan console, berguna sebagai bukti pengujian
function log(msg) {
  console.log(msg);
  lines.unshift(msg);
  lines.length = Math.min(lines.length, 5);
  logBox.textContent = lines.join(' | ');
}

function init() {
  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x1b1f2a);

  camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 50);
  camera.position.set(0, 1.6, 2);

  scene.add(new THREE.HemisphereLight(0xffffff, 0x444455, 1.5));
  const sun = new THREE.DirectionalLight(0xffffff, 1.5);
  sun.position.set(2, 4, 2);
  scene.add(sun);

  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(10, 10),
    new THREE.MeshStandardMaterial({ color: 0x2e3447 })
  );
  floor.rotation.x = -Math.PI / 2;
  scene.add(floor);
  scene.add(new THREE.GridHelper(10, 20, 0x555a6e, 0x3a3f52));

  // Tiga objek yang bisa disentuh/digenggam
  addObject(new THREE.BoxGeometry(0.3, 0.3, 0.3), 0xe74c3c, -0.6, 1.2, -1);
  addObject(new THREE.SphereGeometry(0.18, 32, 16), 0x3498db, 0, 1.2, -1);
  addObject(new THREE.ConeGeometry(0.16, 0.35, 32), 0x2ecc71, 0.6, 1.2, -1);

  renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(window.devicePixelRatio);
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.xr.enabled = true; // aktifkan WebXR
  document.body.appendChild(renderer.domElement);
  document.body.appendChild(VRButton.createButton(renderer));

  // Kontrol mouse untuk mode desktop (tidak aktif saat sesi XR)
  orbit = new OrbitControls(camera, renderer.domElement);
  orbit.target.set(0, 1.2, -1);
  orbit.update();

  setupControllers();

  window.addEventListener('resize', onResize);
  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  window.addEventListener('blur', () => movementKeys.clear());
  renderer.domElement.addEventListener('pointerdown', onPointerDown);
  renderer.setAnimationLoop(render);
}

function onKeyDown(event) {
  const key = event.key.toLowerCase();
  if (['w', 'a', 's', 'd'].includes(key)) {
    movementKeys.add(key);
    event.preventDefault();
  }
}

function onKeyUp(event) {
  movementKeys.delete(event.key.toLowerCase());
}

function moveWithWASD(deltaTime) {
  if (renderer.xr.isPresenting || movementKeys.size === 0) return;

  camera.getWorldDirection(moveDirection);
  moveDirection.y = 0;
  moveDirection.normalize();
  moveRight.crossVectors(moveDirection, worldUp).normalize();
  moveOffset.set(0, 0, 0);

  if (movementKeys.has('w')) moveOffset.add(moveDirection);
  if (movementKeys.has('s')) moveOffset.sub(moveDirection);
  if (movementKeys.has('d')) moveOffset.add(moveRight);
  if (movementKeys.has('a')) moveOffset.sub(moveRight);

  if (moveOffset.lengthSq() > 0) {
    moveOffset.normalize().multiplyScalar(moveSpeed * deltaTime);
    camera.position.add(moveOffset);
    orbit.target.add(moveOffset);
  }
}

function addObject(geometry, color, x, y, z) {
  const mesh = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ color }));
  mesh.position.set(x, y, z);
  mesh.userData.shapeIndex = Math.max(0, ['BoxGeometry', 'SphereGeometry', 'ConeGeometry'].indexOf(geometry.type));
  scene.add(mesh);
  interactables.push(mesh);
}

function changeObjectShape(object) {
  const nextIndex = (object.userData.shapeIndex + 1) % shapeFactories.length;
  const oldGeometry = object.geometry;

  object.geometry = shapeFactories[nextIndex]();
  object.userData.shapeIndex = nextIndex;
  oldGeometry.dispose();
  return shapeNames[nextIndex];
}

function onResize() {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
}

function setupControllers() {
  const modelFactory = new XRControllerModelFactory();

  for (let i = 0; i < 2; i++) {
    const controller = renderer.xr.getController(i);
    controller.addEventListener('connected', (e) => {
      controller.userData.gamepad = e.data.gamepad; // untuk haptic dan thumbstick
      controller.add(buildRay());
      log('Controller ' + i + ' terhubung (' + e.data.handedness + ')');
    });
    controller.addEventListener('disconnected', () => controller.clear());
    controller.addEventListener('selectstart', onSelectStart);
    controller.addEventListener('selectend', onSelectEnd);
    controller.addEventListener('squeezestart', onSqueezeStart);
    scene.add(controller);
    controllers.push(controller);

    const grip = renderer.xr.getControllerGrip(i);
    grip.add(modelFactory.createControllerModel(grip));
    scene.add(grip);
  }
}

function buildRay() {
  const geometry = new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(0, 0, 0),
    new THREE.Vector3(0, 0, -1)
  ]);
  const line = new THREE.Line(geometry, new THREE.LineBasicMaterial({ color: 0xffffff }));
  line.name = 'ray';
  line.scale.z = 5; // panjang sinar 5 meter
  return line;
}

// Menghitung objek yang terkena sinar dari sebuah controller
function getIntersections(controller) {
  tempMatrix.identity().extractRotation(controller.matrixWorld);
  raycaster.ray.origin.setFromMatrixPosition(controller.matrixWorld);
  raycaster.ray.direction.set(0, 0, -1).applyMatrix4(tempMatrix);
  return raycaster.intersectObjects(interactables, false);
}

// Getaran singkat pada controller (jika perangkat mendukung)
function pulse(controller, strength = 0.5, ms = 80) {
  const gp = controller.userData.gamepad;
  const actuator = gp && gp.hapticActuators && gp.hapticActuators[0];
  if (actuator && actuator.pulse) actuator.pulse(strength, ms);
}

// Trigger ditekan: genggam objek yang terkena sinar
function onSelectStart(event) {
  const controller = event.target;
  const hits = getIntersections(controller);
  if (hits.length > 0) {
    const obj = hits[0].object;
    controller.attach(obj); // objek menjadi anak controller
    controller.userData.selected = obj;
    pulse(controller);
    log('GRAB: ' + obj.geometry.type);
  }
}

// Trigger dilepas: kembalikan objek ke scene di posisi terakhirnya
function onSelectEnd(event) {
  const controller = event.target;
  const obj = controller.userData.selected;
  if (obj) {
    scene.attach(obj); // posisi dunia tetap terjaga
    controller.userData.selected = undefined;
    log('RELEASE: ' + obj.geometry.type);
  }
}

// Grip ditekan: ubah bentuk objek yang terkena sinar
function onSqueezeStart(event) {
  const controller = event.target;
  const hits = getIntersections(controller);
  if (hits.length > 0) {
    const shapeName = changeObjectShape(hits[0].object);
    pulse(controller, 0.3, 50);
    log('SQUEEZE: bentuk menjadi ' + shapeName);
  }
}

function render() {
  const deltaTime = Math.min(movementClock.getDelta(), 0.05);
  moveWithWASD(deltaTime);

  // Reset sorotan semua objek
  interactables.forEach((o) => o.material.emissive.setHex(0x000000));

  controllers.forEach((c) => {
    const held = c.userData.selected;
    if (held) {
      // Objek sedang digenggam: sorot dan izinkan ubah skala dengan thumbstick
      held.material.emissive.setHex(0x222222);
      const gp = c.userData.gamepad;
      if (gp && gp.axes.length >= 4) {
        const y = gp.axes[3]; // sumbu Y thumbstick
        if (Math.abs(y) > 0.15) { // abaikan drift kecil
          held.scale.multiplyScalar(1 - y * 0.02).clampScalar(0.3, 3);
        }
      }
    } else if (c.children.length > 0) {
      // Controller sudah terhubung dan tidak memegang apa pun: cek hover
      const hits = getIntersections(c);
      if (hits.length > 0) hits[0].object.material.emissive.setHex(0x444444);
    }
  });

  if (!renderer.xr.isPresenting) orbit.update();
  renderer.render(scene, camera);
}

// Klik mouse pada mode desktop mengubah bentuk objek
function onPointerDown(e) {
  if (renderer.xr.isPresenting) return;
  pointer.set(
    (e.clientX / window.innerWidth) * 2 - 1,
    -(e.clientY / window.innerHeight) * 2 + 1
  );
  raycaster.setFromCamera(pointer, camera);
  const hits = raycaster.intersectObjects(interactables, false);
  if (hits.length > 0) {
    const shapeName = changeObjectShape(hits[0].object);
    log('CLICK (desktop): bentuk menjadi ' + shapeName);
  }
}

init();
