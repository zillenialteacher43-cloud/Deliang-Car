import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { RacingAudio } from './audio';
import { CarRig, createSupercarRig } from './carModel';
import { RACE_MAPS } from './maps';
import {
  BuiltTrack,
  buildMapEnvironmentTexture,
  buildRaceTrack,
} from './trackBuilder';
import {
  CAMERA_OPTIONS,
  CameraMode,
  ControlInput,
  MapId,
  MinimapEntity,
  RaceTelemetry,
} from './types';

interface AiRacer {
  id: string;
  name: string;
  colorCss: string;
  rig: CarRig;
  splineProgress: number; // 0..1 wrapped on spline
  unwrappedProgress: number; // continuous lap progress (-0.02..3.0+)
  laneOffset: number;
  baseSpeed: number;
  currentSpeed: number;
  lap: number;
}

interface SmokeParticle {
  active: boolean;
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  age: number;
  maxAge: number;
  scale: number;
}

const SpeedEffectShader = {
  uniforms: {
    tDiffuse: { value: null },
    uSpeedFactor: { value: 0.0 },
    uNitro: { value: 0.0 },
  },
  vertexShader: `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: `
    uniform sampler2D tDiffuse;
    uniform float uSpeedFactor;
    uniform float uNitro;
    varying vec2 vUv;

    void main() {
      vec2 dir = vUv - 0.5;
      float dist = length(dir);
      float aberration = (uSpeedFactor * 0.0022 + uNitro * 0.0038) * smoothstep(0.18, 0.72, dist);

      float r = texture2D(tDiffuse, vUv - dir * aberration).r;
      float g = texture2D(tDiffuse, vUv).g;
      float b = texture2D(tDiffuse, vUv + dir * aberration).b;

      vec3 col = vec3(r, g, b);
      float vig = 1.0 - smoothstep(0.45, 0.95, dist) * (0.16 + uSpeedFactor * 0.14);
      col *= vig;
      gl_FragColor = vec4(col, 1.0);
    }
  `,
};

// Pre-allocated math helpers (zero GC in render loop)
const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _v3 = new THREE.Vector3();
const _camTargetPos = new THREE.Vector3();
const _camTargetLook = new THREE.Vector3();
const _camCurPos = new THREE.Vector3();
const _camCurLook = new THREE.Vector3();
const _dummyObj = new THREE.Object3D();

export class RacingEngine {
  private container: HTMLElement;
  private renderer: THREE.WebGLRenderer;
  private composer: EffectComposer | null = null;
  private speedPass: ShaderPass | null = null;
  private bloomPass: UnrealBloomPass | null = null;

  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private isSoftwareGl: boolean;
  private maxAnisotropy: number;

  private sunLight: THREE.DirectionalLight;
  private hemiLight: THREE.HemisphereLight;
  private streetPointLights: THREE.PointLight[] = [];
  private envMapTexture: THREE.Texture | null = null;

  private currentMapId: MapId = 'alpine';
  private track: BuiltTrack | null = null;

  private playerRig: CarRig;
  private aiRacers: AiRacer[] = [];

  private smokeMesh: THREE.InstancedMesh;
  private smokeParticles: SmokeParticle[] = [];
  private smokeCursor = 0;
  private smokeSpawnTimer = 0;

  private skidMesh: THREE.InstancedMesh;
  private skidCursor = 0;
  private skidCount = 260;
  private skidTimer = 0;

  private isPlaying = false;
  private isPaused = false;
  private cameraMode: CameraMode = 'chase';
  private cameraInitialized = false;
  private currentFov = 64;

  private playerPos = new THREE.Vector3();
  private playerYaw = 0;
  private playerForwardSpeed = 0;
  private playerLateralSpeed = 0;
  private playerSteerAngle = 0;
  private playerPitch = 0;
  private playerRoll = 0;
  private playerWheelSpin = 0;
  private playerBrakeHeat = 0;
  private playerNitro = 100;
  private playerTrackIdx = 0;
  private playerProgress = 0;
  private playerUnwrappedProgress = 0;
  private playerLap = 1;
  private lapTimeMs = 0;
  private bestLapMs: number | null = null;
  private totalTimeMs = 0;
  private countdownTimer = 0;
  private raceFinished = false;
  private attractAngle = 0;
  private elapsedSeconds = 0;

  private input: ControlInput = {
    throttle: false,
    brake: false,
    left: false,
    right: false,
    handbrake: false,
    nitro: false,
  };

  private audio = new RacingAudio();
  private onTelemetry: (t: RaceTelemetry) => void;
  private onContextStatus?: (lost: boolean) => void;
  private telemetryAccumulator = 0;

  private clock = new THREE.Clock();
  private frameId = 0;
  private disposed = false;
  private resizeObserver: ResizeObserver;

  constructor(options: {
    container: HTMLElement;
    initialMap: MapId;
    initialColorHex: number;
    initialAccentHex: number;
    onTelemetry: (t: RaceTelemetry) => void;
    onContextStatus?: (lost: boolean) => void;
  }) {
    this.container = options.container;
    this.currentMapId = options.initialMap;
    this.onTelemetry = options.onTelemetry;
    this.onContextStatus = options.onContextStatus;

    this.isSoftwareGl = (() => {
      const gl = document.createElement('canvas').getContext('webgl2');
      if (!gl) return true;
      const ext = gl.getExtension('WEBGL_debug_renderer_info');
      const param = ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER;
      const gpu = String(gl.getParameter(param));
      gl.getExtension('WEBGL_lose_context')?.loseContext();
      return /SwiftShader|llvmpipe|softpipe|Software|Basic Render/i.test(gpu);
    })();

    const width = this.container.clientWidth || window.innerWidth;
    const height = this.container.clientHeight || window.innerHeight;

    this.renderer = new THREE.WebGLRenderer({
      antialias: !this.isSoftwareGl,
      powerPreference: 'high-performance',
    });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.08;
    this.renderer.setPixelRatio(
      this.isSoftwareGl ? 1 : Math.min(window.devicePixelRatio, 2)
    );
    this.renderer.shadowMap.enabled = !this.isSoftwareGl;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.setSize(width, height);

    this.maxAnisotropy = this.renderer.capabilities.getMaxAnisotropy();

    const canvas = this.renderer.domElement;
    canvas.style.display = 'block';
    canvas.style.width = '100%';
    canvas.style.height = '100%';
    this.container.appendChild(canvas);

    canvas.addEventListener('webglcontextlost', this.handleContextLost);
    canvas.addEventListener('webglcontextrestored', this.handleContextRestored);

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(64, width / Math.max(1, height), 0.1, 1400);

    // Lighting Rig
    this.hemiLight = new THREE.HemisphereLight(0x93c5fd, 0x3b5c34, 0.9);
    this.scene.add(this.hemiLight);

    this.sunLight = new THREE.DirectionalLight(0xfff3d6, 2.35);
    this.sunLight.castShadow = !this.isSoftwareGl;
    this.sunLight.shadow.mapSize.set(2048, 2048);
    this.sunLight.shadow.camera.near = 5;
    this.sunLight.shadow.camera.far = 360;
    const d = 78;
    this.sunLight.shadow.camera.left = -d;
    this.sunLight.shadow.camera.right = d;
    this.sunLight.shadow.camera.top = d;
    this.sunLight.shadow.camera.bottom = -d;
    this.sunLight.shadow.bias = -0.0005;
    this.sunLight.shadow.normalBias = 0.02;
    this.scene.add(this.sunLight);
    this.scene.add(this.sunLight.target);

    // Pooled dynamic streetlamp PointLights for bright Midnight circuit lighting
    for (let i = 0; i < 4; i++) {
      const pl = new THREE.PointLight(i % 2 === 0 ? 0xffdf9e : 0xdbeafe, 0, 68, 1.3);
      this.scene.add(pl);
      this.streetPointLights.push(pl);
    }

    // Player Car + 3 Competitive AI Rivals
    this.playerRig = createSupercarRig({
      paintHex: options.initialColorHex,
      accentHex: options.initialAccentHex,
      isPlayer: true,
      isSoftwareGl: this.isSoftwareGl,
      maxAnisotropy: this.maxAnisotropy,
    });
    this.scene.add(this.playerRig.root);

    const aiConfigs = [
      { id: 'ai-1', name: 'Rival 1', hex: 0xfacc15, accent: 0x0f172a, css: '#facc15', lane: 2.8, speed: 57 },
      { id: 'ai-2', name: 'Rival 2', hex: 0x38bdf8, accent: 0xffffff, css: '#38bdf8', lane: -2.8, speed: 52 },
      { id: 'ai-3', name: 'Rival 3', hex: 0xa855f7, accent: 0xe2e8f0, css: '#a855f7', lane: 2.8, speed: 47 },
    ];
    for (const cfg of aiConfigs) {
      const rig = createSupercarRig({
        paintHex: cfg.hex,
        accentHex: cfg.accent,
        isPlayer: false,
        isSoftwareGl: this.isSoftwareGl,
        maxAnisotropy: this.maxAnisotropy,
      });
      this.scene.add(rig.root);
      this.aiRacers.push({
        id: cfg.id,
        name: cfg.name,
        colorCss: cfg.css,
        rig,
        splineProgress: 0,
        unwrappedProgress: 0,
        laneOffset: cfg.lane,
        baseSpeed: cfg.speed,
        currentSpeed: 0,
        lap: 1,
      });
    }

    // Tire Smoke Particle Pool
    const smokeCount = 56;
    const smokeGeo = new THREE.SphereGeometry(0.42, 8, 8);
    const smokeMat = new THREE.MeshStandardMaterial({
      color: 0xe2e8f0,
      transparent: true,
      opacity: 0.4,
      roughness: 1,
      depthWrite: false,
    });
    this.smokeMesh = new THREE.InstancedMesh(smokeGeo, smokeMat, smokeCount);
    this.smokeMesh.frustumCulled = false;
    for (let i = 0; i < smokeCount; i++) {
      this.smokeParticles.push({
        active: false,
        pos: new THREE.Vector3(0, -100, 0),
        vel: new THREE.Vector3(),
        age: 0,
        maxAge: 0.7,
        scale: 1,
      });
      _dummyObj.position.set(0, -100, 0);
      _dummyObj.scale.setScalar(0.001);
      _dummyObj.updateMatrix();
      this.smokeMesh.setMatrixAt(i, _dummyObj.matrix);
    }
    this.smokeMesh.instanceMatrix.needsUpdate = true;
    this.scene.add(this.smokeMesh);

    // Persistent Skid Marks Pool
    const skidGeo = new THREE.PlaneGeometry(0.36, 1.35);
    skidGeo.rotateX(-Math.PI / 2);
    const skidMat = new THREE.MeshBasicMaterial({
      color: 0x090b10,
      transparent: true,
      opacity: 0.56,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    });
    this.skidMesh = new THREE.InstancedMesh(skidGeo, skidMat, this.skidCount);
    this.skidMesh.frustumCulled = false;
    this.clearSkidMarks();
    this.scene.add(this.skidMesh);

    if (!this.isSoftwareGl) {
      this.composer = new EffectComposer(this.renderer);
      this.composer.addPass(new RenderPass(this.scene, this.camera));

      this.bloomPass = new UnrealBloomPass(
        new THREE.Vector2(width, height),
        0.34,
        0.42,
        0.92
      );
      this.composer.addPass(this.bloomPass);

      this.speedPass = new ShaderPass(SpeedEffectShader);
      this.composer.addPass(this.speedPass);

      this.composer.addPass(new OutputPass());
    }

    this.loadMap(this.currentMapId, false);

    if (!this.isSoftwareGl) {
      this.renderer.compile(this.scene, this.camera);
    }

    this.resizeObserver = new ResizeObserver(() => this.handleResize());
    this.resizeObserver.observe(this.container);

    this.clock.start();
    this.tick();
  }

  private clearSkidMarks(): void {
    _dummyObj.position.set(0, -100, 0);
    _dummyObj.rotation.set(0, 0, 0);
    _dummyObj.scale.setScalar(0.001);
    _dummyObj.updateMatrix();
    for (let i = 0; i < this.skidCount; i++) {
      this.skidMesh.setMatrixAt(i, _dummyObj.matrix);
    }
    this.skidMesh.instanceMatrix.needsUpdate = true;
    this.skidCursor = 0;
  }

  private stampSkidPair(pos: THREE.Vector3, yaw: number): void {
    const fwdX = Math.sin(yaw);
    const fwdZ = Math.cos(yaw);
    const rightX = -Math.cos(yaw);
    const rightZ = Math.sin(yaw);

    for (const side of [-0.98, 0.98]) {
      _dummyObj.position.set(
        pos.x - fwdX * 1.32 + rightX * side,
        pos.y + 0.036,
        pos.z - fwdZ * 1.32 + rightZ * side
      );
      _dummyObj.rotation.set(0, yaw, 0);
      _dummyObj.scale.set(1, 1, 1);
      _dummyObj.updateMatrix();
      this.skidMesh.setMatrixAt(this.skidCursor, _dummyObj.matrix);
      this.skidCursor = (this.skidCursor + 1) % this.skidCount;
    }
    this.skidMesh.instanceMatrix.needsUpdate = true;
  }

  private handleContextLost = (e: Event) => {
    e.preventDefault();
    this.onContextStatus?.(true);
  };

  private handleContextRestored = () => {
    this.onContextStatus?.(false);
  };

  private handleResize = () => {
    if (this.disposed) return;
    const w = this.container.clientWidth || window.innerWidth;
    const h = this.container.clientHeight || window.innerHeight;
    if (w <= 0 || h <= 0) return;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
    this.composer?.setSize(w, h);
    this.bloomPass?.resolution.set(w, h);
  };

  public loadMap(mapId: MapId, autoStartRace = false): void {
    this.currentMapId = mapId;
    const config = RACE_MAPS[mapId];

    if (this.track) {
      this.scene.remove(this.track.group);
      this.track.dispose();
      this.track = null;
    }
    this.clearSkidMarks();

    if (this.envMapTexture) {
      this.envMapTexture.dispose();
    }
    this.envMapTexture = buildMapEnvironmentTexture(this.renderer, config);
    this.scene.environment = this.envMapTexture;

    this.track = buildRaceTrack(config, this.maxAnisotropy, this.isSoftwareGl);
    this.scene.add(this.track.group);

    this.scene.fog = new THREE.FogExp2(config.fogColor, config.fogDensity);
    this.sunLight.color.setHex(config.sunColor);
    this.sunLight.intensity = config.sunIntensity;
    this.hemiLight.color.setHex(config.hemiSkyColor);
    this.hemiLight.groundColor.setHex(config.hemiGroundColor);
    this.hemiLight.intensity = config.hemiIntensity;

    const hlIntensity = config.isNight ? 92 : 0;
    if (this.playerRig.headLightLeft) this.playerRig.headLightLeft.intensity = hlIntensity;
    if (this.playerRig.headLightRight) this.playerRig.headLightRight.intensity = hlIntensity;
    if (this.playerRig.headlightBeams) this.playerRig.headlightBeams.visible = config.isNight;

    // Reset streetlamp point lights intensity
    for (const pl of this.streetPointLights) {
      pl.intensity = config.isNight ? 36 : 0;
    }

    this.resetGrid(autoStartRace);
  }

  public resetGrid(startCountdown = true): void {
    if (!this.track) return;
    const samples = this.track.samples;
    const segCount = samples.length;

    // 2x2 Staggered Grid behind start line (index 0)
    // Player starts P4 at segCount - 12 so overtaking rivals updates Posisi cleanly
    const playerSegBack = 12;
    const startIdx = (segCount - playerSegBack) % segCount;
    const s = samples[startIdx];
    this.playerPos.copy(s.point).addScaledVector(s.right, -2.8);
    this.playerPos.y = s.point.y;
    this.playerYaw = Math.atan2(s.tangent.x, s.tangent.z);
    this.playerForwardSpeed = 0;
    this.playerLateralSpeed = 0;
    this.playerSteerAngle = 0;
    this.playerPitch = 0;
    this.playerRoll = 0;
    this.playerBrakeHeat = 0;
    this.playerNitro = 100;
    this.playerTrackIdx = startIdx;
    this.playerProgress = startIdx / segCount;
    this.playerUnwrappedProgress = -playerSegBack / segCount;
    this.playerLap = 1;
    this.lapTimeMs = 0;
    this.bestLapMs = null;
    this.totalTimeMs = 0;
    this.raceFinished = false;
    this.countdownTimer = startCountdown ? 3.2 : 0;

    this.syncCarTransform(this.playerRig, this.playerPos, this.playerYaw, 0, 0, 0, 0, 0, false, false);
    this.playerRig.updateDash?.(0, 1, 0.2, 100);

    const gridOffsets = [
      { segBack: 3, lane: 2.8 },  // P1
      { segBack: 6, lane: -2.8 }, // P2
      { segBack: 9, lane: 2.8 },  // P3
    ];
    this.aiRacers.forEach((ai, idx) => {
      const slot = gridOffsets[idx];
      const aiIdx = (segCount - slot.segBack) % segCount;
      const aiSample = samples[aiIdx];
      ai.splineProgress = aiIdx / segCount;
      ai.unwrappedProgress = -slot.segBack / segCount;
      ai.lap = 1;
      ai.currentSpeed = 0;
      ai.laneOffset = slot.lane;
      _v1.copy(aiSample.point).addScaledVector(aiSample.right, ai.laneOffset);
      const aiYaw = Math.atan2(aiSample.tangent.x, aiSample.tangent.z);
      this.syncCarTransform(ai.rig, _v1, aiYaw, 0, 0, 0, 0, 0, false, false);
    });

    this.cameraInitialized = false;
    this.emitTelemetry();
  }

  public startRace(): void {
    this.audio.init();
    this.isPlaying = true;
    this.isPaused = false;
    this.clearSkidMarks();
    this.resetGrid(true);
  }

  public setPaused(paused: boolean): void {
    this.isPaused = paused;
    if (paused) {
      this.audio.update(0, 0, false, false, false);
    }
  }

  public setMuted(muted: boolean): void {
    this.audio.setMuted(muted);
  }

  public setCarColor(hex: number, _accentHex: number): void {
    this.playerRig.paintMaterial.color.setHex(hex);
  }

  public setCameraMode(mode: CameraMode): void {
    this.cameraMode = mode;
    this.cameraInitialized = false;
  }

  public cycleCamera(): CameraMode {
    const idx = CAMERA_OPTIONS.findIndex((c) => c.id === this.cameraMode);
    const next = CAMERA_OPTIONS[(idx + 1) % CAMERA_OPTIONS.length].id;
    this.cameraMode = next;
    this.cameraInitialized = false;
    return next;
  }

  public setInput(partial: Partial<ControlInput>): void {
    Object.assign(this.input, partial);
  }

  public resetCarToTrack(): void {
    if (!this.track) return;
    const s = this.track.samples[this.playerTrackIdx];
    this.playerPos.copy(s.point);
    this.playerYaw = Math.atan2(s.tangent.x, s.tangent.z);
    this.playerForwardSpeed = 0;
    this.playerLateralSpeed = 0;
  }

  private syncCarTransform(
    rig: CarRig,
    pos: THREE.Vector3,
    yaw: number,
    pitch: number,
    roll: number,
    steerAngle: number,
    wheelSpin: number,
    brakeHeat: number,
    isBraking: boolean,
    isNitro: boolean
  ): void {
    rig.root.position.copy(pos);
    rig.root.rotation.set(0, yaw, 0);
    rig.bodyTiltGroup.rotation.set(pitch, 0, roll);
    rig.frontLeftSteer.rotation.y = steerAngle;
    rig.frontRightSteer.rotation.y = steerAngle;
    rig.steeringWheel.rotation.z = -steerAngle * 2.4;
    rig.brakeDiscMaterial.emissiveIntensity = brakeHeat * 3.5;

    for (let i = 0; i < rig.wheelsSpin.length; i++) {
      rig.wheelsSpin[i].rotation.x = wheelSpin;
    }
    rig.tailLightMaterial.emissiveIntensity = isBraking ? 4.8 : 1.5;
    for (let i = 0; i < rig.nitroFlames.length; i++) {
      const f = rig.nitroFlames[i];
      f.visible = isNitro;
      if (isNitro) {
        f.scale.set(1, 1, 0.8 + Math.random() * 0.65);
      }
    }
  }

  private spawnSmoke(pos: THREE.Vector3, count = 1): void {
    for (let c = 0; c < count; c++) {
      const p = this.smokeParticles[this.smokeCursor];
      this.smokeCursor = (this.smokeCursor + 1) % this.smokeParticles.length;
      p.active = true;
      p.age = 0;
      p.maxAge = 0.55 + Math.random() * 0.35;
      p.scale = 0.7 + Math.random() * 0.65;
      p.pos.copy(pos);
      p.pos.x += (Math.random() - 0.5) * 0.6;
      p.pos.z += (Math.random() - 0.5) * 0.6;
      p.vel.set((Math.random() - 0.5) * 2.2, 1.1 + Math.random() * 1.4, (Math.random() - 0.5) * 2.2);
    }
  }

  private updateParticles(dt: number): void {
    let dirty = false;
    for (let i = 0; i < this.smokeParticles.length; i++) {
      const p = this.smokeParticles[i];
      if (!p.active) continue;
      dirty = true;
      p.age += dt;
      if (p.age >= p.maxAge) {
        p.active = false;
        _dummyObj.position.set(0, -100, 0);
        _dummyObj.scale.setScalar(0.001);
        _dummyObj.updateMatrix();
        this.smokeMesh.setMatrixAt(i, _dummyObj.matrix);
        continue;
      }
      p.pos.addScaledVector(p.vel, dt);
      const t = p.age / p.maxAge;
      const s = p.scale * (0.6 + t * 2.2) * (1 - t * 0.5);
      _dummyObj.position.copy(p.pos);
      _dummyObj.scale.setScalar(Math.max(0.01, s));
      _dummyObj.updateMatrix();
      this.smokeMesh.setMatrixAt(i, _dummyObj.matrix);
    }
    if (dirty) {
      this.smokeMesh.instanceMatrix.needsUpdate = true;
    }
  }

  private updatePhysics(dt: number): void {
    if (!this.track) return;
    const config = RACE_MAPS[this.currentMapId];
    const samples = this.track.samples;
    const segCount = samples.length;

    if (this.countdownTimer > 0) {
      this.countdownTimer = Math.max(0, this.countdownTimer - dt);
      const revTarget = this.input.throttle ? 0.78 : 0.15;
      this.audio.update(revTarget, 0, false, false, this.isPlaying);
      this.playerRig.updateDash?.(0, 1, revTarget, 100);
      return;
    }

    if (!this.raceFinished) {
      this.lapTimeMs += dt * 1000;
      this.totalTimeMs += dt * 1000;
    }

    const nearest = this.track.sampleNearest(this.playerPos, this.playerTrackIdx);
    this.playerTrackIdx = nearest.index;
    const halfW = config.trackWidth * 0.5;
    const isOffRoad = nearest.distFromCenter > halfW + 1.1;

    const wantsNitro = this.input.nitro && this.input.throttle && this.playerNitro > 2;
    const isNitroActive = wantsNitro && !this.raceFinished;
    if (isNitroActive) {
      this.playerNitro = Math.max(0, this.playerNitro - 24 * dt);
    } else {
      this.playerNitro = Math.min(100, this.playerNitro + 6.5 * dt);
    }

    const maxSpeed = isNitroActive ? 80 : isOffRoad ? 38 : 67;
    const accel = isNitroActive ? 47 : 29.5;
    const brakeDecel = 45;
    const reverseMax = -20;

    if (!this.raceFinished && this.input.throttle) {
      if (this.playerForwardSpeed < maxSpeed) {
        this.playerForwardSpeed += accel * dt;
      } else {
        this.playerForwardSpeed = THREE.MathUtils.damp(this.playerForwardSpeed, maxSpeed, 2.5, dt);
      }
    } else if (!this.raceFinished && this.input.brake) {
      if (this.playerForwardSpeed > 0.5) {
        this.playerForwardSpeed = Math.max(0, this.playerForwardSpeed - brakeDecel * dt);
      } else {
        this.playerForwardSpeed = Math.max(reverseMax, this.playerForwardSpeed - 20 * dt);
      }
    } else {
      const drag = isOffRoad ? 2.4 : 0.65;
      this.playerForwardSpeed = THREE.MathUtils.damp(this.playerForwardSpeed, 0, drag, dt);
    }

    if (this.input.handbrake && Math.abs(this.playerForwardSpeed) > 3) {
      this.playerForwardSpeed = THREE.MathUtils.damp(this.playerForwardSpeed, 0, 1.5, dt);
    }

    const isHardBraking = this.input.brake && this.playerForwardSpeed > 18;
    const targetHeat = isHardBraking ? Math.min(1, this.playerForwardSpeed / 55) : 0;
    this.playerBrakeHeat = THREE.MathUtils.damp(this.playerBrakeHeat, targetHeat, isHardBraking ? 4.5 : 1.6, dt);

    const steerInput = (this.input.left ? 1 : 0) - (this.input.right ? 1 : 0);
    const targetSteerAngle = this.raceFinished ? 0 : steerInput * 0.42;
    this.playerSteerAngle = THREE.MathUtils.damp(this.playerSteerAngle, targetSteerAngle, 12, dt);

    const speedRatio = Math.min(1, Math.abs(this.playerForwardSpeed) / 28);
    const highSpeedSteerFactor = 1 - Math.min(0.45, Math.abs(this.playerForwardSpeed) / 145);
    const reverseSign = this.playerForwardSpeed >= -0.2 ? 1 : -1;
    const yawRate = steerInput * 2.15 * speedRatio * highSpeedSteerFactor * reverseSign * (this.input.handbrake ? 1.34 : 1.0);
    if (!this.raceFinished) {
      this.playerYaw += yawRate * dt;
    }

    const driftTransfer = steerInput * Math.abs(this.playerForwardSpeed) * (this.input.handbrake ? 0.36 : 0.14);
    this.playerLateralSpeed = THREE.MathUtils.damp(
      this.playerLateralSpeed,
      driftTransfer,
      this.input.handbrake ? 2.8 : 7.5,
      dt
    );

    const isDrifting =
      Math.abs(this.playerForwardSpeed) > 16 &&
      (this.input.handbrake || Math.abs(this.playerLateralSpeed) > 5.5);

    const fwdX = Math.sin(this.playerYaw);
    const fwdZ = Math.cos(this.playerYaw);
    const rightX = -Math.cos(this.playerYaw);
    const rightZ = Math.sin(this.playerYaw);

    this.playerPos.x += (fwdX * this.playerForwardSpeed + rightX * this.playerLateralSpeed) * dt;
    this.playerPos.z += (fwdZ * this.playerForwardSpeed + rightZ * this.playerLateralSpeed) * dt;

    const postNearest = this.track.sampleNearest(this.playerPos, this.playerTrackIdx);
    this.playerTrackIdx = postNearest.index;
    const roadHeight = postNearest.sample.point.y;
    this.playerPos.y = THREE.MathUtils.damp(this.playerPos.y, roadHeight, 22, dt);

    const wallLimit = halfW + 2.7;
    if (Math.abs(postNearest.signedOffset) > wallLimit) {
      const sign = Math.sign(postNearest.signedOffset);
      const excess = Math.abs(postNearest.signedOffset) - wallLimit;
      this.playerPos.addScaledVector(postNearest.sample.right, -sign * excess);
      this.playerForwardSpeed *= 0.84;
      this.playerLateralSpeed *= -0.25;
      const trackYaw = Math.atan2(postNearest.sample.tangent.x, postNearest.sample.tangent.z);
      const diff = Math.atan2(Math.sin(trackYaw - this.playerYaw), Math.cos(trackYaw - this.playerYaw));
      this.playerYaw += diff * 0.18;
    }

    // Continuous unwrapped spline progress for accurate lap & position tracking
    const newProgress = postNearest.index / segCount;
    let deltaProg = newProgress - this.playerProgress;
    if (deltaProg < -0.5) deltaProg += 1.0;
    else if (deltaProg > 0.5) deltaProg -= 1.0;

    this.playerUnwrappedProgress += deltaProg;
    this.playerProgress = newProgress;

    const completedLaps = Math.max(0, Math.floor(this.playerUnwrappedProgress));
    const targetLap = completedLaps + 1;
    if (targetLap > this.playerLap && !this.raceFinished) {
      if (this.bestLapMs === null || this.lapTimeMs < this.bestLapMs) {
        this.bestLapMs = this.lapTimeMs;
      }
      this.lapTimeMs = 0;
      if (this.playerLap >= config.totalLaps) {
        this.raceFinished = true;
      } else {
        this.playerLap = targetLap;
      }
    }

    const targetPitch =
      (this.input.throttle ? -0.025 : 0) + (this.input.brake && this.playerForwardSpeed > 2 ? 0.045 : 0);
    const targetRoll = steerInput * speedRatio * 0.058;
    this.playerPitch = THREE.MathUtils.damp(this.playerPitch, targetPitch, 9, dt);
    this.playerRoll = THREE.MathUtils.damp(this.playerRoll, targetRoll, 9, dt);
    this.playerWheelSpin += (this.playerForwardSpeed / 0.38) * dt;

    if (isDrifting || isOffRoad || isHardBraking) {
      this.smokeSpawnTimer += dt;
      if (this.smokeSpawnTimer > 0.045) {
        this.smokeSpawnTimer = 0;
        _v1.set(
          this.playerPos.x - fwdX * 1.4,
          this.playerPos.y + 0.28,
          this.playerPos.z - fwdZ * 1.4
        );
        this.spawnSmoke(_v1, 1);
      }

      if (!isOffRoad && (isDrifting || isHardBraking)) {
        this.skidTimer += dt;
        if (this.skidTimer > 0.022) {
          this.skidTimer = 0;
          this.stampSkidPair(this.playerPos, this.playerYaw);
        }
      }
    }

    this.syncCarTransform(
      this.playerRig,
      this.playerPos,
      this.playerYaw,
      this.playerPitch,
      this.playerRoll,
      this.playerSteerAngle,
      this.playerWheelSpin,
      this.playerBrakeHeat,
      this.input.brake,
      isNitroActive
    );

    if (this.speedPass) {
      const speedNorm = THREE.MathUtils.clamp((Math.abs(this.playerForwardSpeed) - 32) / 42, 0, 1);
      this.speedPass.uniforms.uSpeedFactor.value = THREE.MathUtils.damp(
        this.speedPass.uniforms.uSpeedFactor.value,
        speedNorm,
        6,
        dt
      );
      this.speedPass.uniforms.uNitro.value = THREE.MathUtils.damp(
        this.speedPass.uniforms.uNitro.value,
        isNitroActive ? 1.0 : 0.0,
        8,
        dt
      );
    }

    // Update AI Racers using identical unwrapped progress logic
    const trackLen = this.track.totalLength;
    for (let i = 0; i < this.aiRacers.length; i++) {
      const ai = this.aiRacers[i];
      const curIdx = Math.floor(ai.splineProgress * segCount) % segCount;
      const aheadIdx = (curIdx + 16) % segCount;
      const curTan = samples[curIdx].tangent;
      const aheadTan = samples[aheadIdx].tangent;
      const cornerSharpness = 1 - Math.max(0, curTan.dot(aheadTan));
      const targetAiSpeed = ai.baseSpeed * (1 - cornerSharpness * 1.05);
      ai.currentSpeed = THREE.MathUtils.damp(ai.currentSpeed, Math.max(26, targetAiSpeed), 2.2, dt);

      const progStep = (ai.currentSpeed * dt) / trackLen;
      ai.unwrappedProgress += progStep;
      ai.splineProgress = (ai.splineProgress + progStep) % 1;
      ai.lap = Math.max(1, Math.floor(ai.unwrappedProgress) + 1);

      const sIdx = Math.floor(ai.splineProgress * segCount) % segCount;
      const sNext = (sIdx + 1) % segCount;
      const frac = ai.splineProgress * segCount - sIdx;

      _v1.lerpVectors(samples[sIdx].point, samples[sNext].point, frac);
      _v2.lerpVectors(samples[sIdx].right, samples[sNext].right, frac).normalize();
      _v3.lerpVectors(samples[sIdx].tangent, samples[sNext].tangent, frac).normalize();

      _v1.addScaledVector(_v2, ai.laneOffset);
      const aiYaw = Math.atan2(_v3.x, _v3.z);

      const dx = this.playerPos.x - _v1.x;
      const dz = this.playerPos.z - _v1.z;
      const distSq = dx * dx + dz * dz;
      const minSep = 3.2;
      if (distSq < minSep * minSep && distSq > 0.001) {
        const dist = Math.sqrt(distSq);
        const push = (minSep - dist) * 0.55;
        this.playerPos.x += (dx / dist) * push;
        this.playerPos.z += (dz / dist) * push;
        this.playerForwardSpeed *= 0.94;
      }

      this.syncCarTransform(
        ai.rig,
        _v1,
        aiYaw,
        0,
        0,
        0,
        (this.totalTimeMs * 0.001 * ai.currentSpeed) / 0.38,
        cornerSharpness > 0.14 ? 0.55 : 0,
        cornerSharpness > 0.12,
        false
      );
    }

    const speedKmh = Math.round(Math.abs(this.playerForwardSpeed) * 3.6);
    const gear = this.computeGear(speedKmh);
    const rpmRatio = this.computeRpmRatio(speedKmh, gear);
    this.audio.update(rpmRatio, speedKmh, isDrifting, isNitroActive, this.isPlaying && !this.isPaused);
    this.playerRig.updateDash?.(speedKmh, gear, rpmRatio, this.playerNitro);
  }

  private computeGear(speedKmh: number): number {
    if (speedKmh < 42) return 1;
    if (speedKmh < 82) return 2;
    if (speedKmh < 126) return 3;
    if (speedKmh < 172) return 4;
    if (speedKmh < 220) return 5;
    return 6;
  }

  private computeRpmRatio(speedKmh: number, gear: number): number {
    const mins = [0, 0, 38, 76, 118, 164, 210];
    const maxs = [0, 48, 88, 132, 178, 226, 290];
    const lo = mins[gear];
    const hi = maxs[gear];
    return THREE.MathUtils.clamp((speedKmh - lo) / Math.max(1, hi - lo), 0.18, 1.0);
  }

  private updateStreetLights(): void {
    const config = RACE_MAPS[this.currentMapId];
    if (!config.isNight || !this.track || this.track.lampPositions.length === 0) return;

    const lamps = this.track.lampPositions;
    // Find 4 closest lamps to player car
    const bestDist = [Infinity, Infinity, Infinity, Infinity];
    const bestIdx = [0, 0, 0, 0];

    for (let i = 0; i < lamps.length; i++) {
      const lp = lamps[i];
      const dx = lp.x - this.playerPos.x;
      const dz = lp.z - this.playerPos.z;
      const d2 = dx * dx + dz * dz;
      for (let slot = 0; slot < 4; slot++) {
        if (d2 < bestDist[slot]) {
          for (let shift = 3; shift > slot; shift--) {
            bestDist[shift] = bestDist[shift - 1];
            bestIdx[shift] = bestIdx[shift - 1];
          }
          bestDist[slot] = d2;
          bestIdx[slot] = i;
          break;
        }
      }
    }

    for (let slot = 0; slot < 4; slot++) {
      this.streetPointLights[slot].position.copy(lamps[bestIdx[slot]]);
    }
  }

  private updateCamera(dt: number): void {
    const config = RACE_MAPS[this.currentMapId];

    this.sunLight.position.set(
      this.playerPos.x + config.sunPosition[0],
      this.playerPos.y + config.sunPosition[1],
      this.playerPos.z + config.sunPosition[2]
    );
    this.sunLight.target.position.copy(this.playerPos);

    this.updateStreetLights();

    if (!this.isPlaying) {
      this.attractAngle += dt * 0.24;
      const rad = 8.4;
      _camTargetPos.set(
        this.playerPos.x + Math.sin(this.playerYaw + this.attractAngle) * rad,
        this.playerPos.y + 3.0,
        this.playerPos.z + Math.cos(this.playerYaw + this.attractAngle) * rad
      );
      _camTargetLook.set(this.playerPos.x, this.playerPos.y + 0.9, this.playerPos.z);

      if (!this.cameraInitialized) {
        _camCurPos.copy(_camTargetPos);
        _camCurLook.copy(_camTargetLook);
        this.cameraInitialized = true;
      } else {
        const lerpF = 1 - Math.exp(-5 * dt);
        _camCurPos.lerp(_camTargetPos, lerpF);
        _camCurLook.lerp(_camTargetLook, lerpF);
      }
      this.camera.position.copy(_camCurPos);
      this.camera.lookAt(_camCurLook);
      return;
    }

    const fwdX = Math.sin(this.playerYaw);
    const fwdZ = Math.cos(this.playerYaw);
    const rightX = -Math.cos(this.playerYaw);
    const rightZ = Math.sin(this.playerYaw);
    const speedRatio = Math.min(1, Math.abs(this.playerForwardSpeed) / 72);

    const shakeMag = speedRatio > 0.65 ? (speedRatio - 0.65) * 0.032 : 0;
    const shakeY = Math.sin(this.elapsedSeconds * 46) * shakeMag;
    const shakeX = Math.cos(this.elapsedSeconds * 37) * shakeMag * 0.6;

    let targetFov = 64;
    let posLambda = 11;
    let lookLambda = 16;

    if (this.cameraMode === 'chase') {
      _camTargetPos.set(
        this.playerPos.x - fwdX * 6.8 + shakeX,
        this.playerPos.y + 2.55 + shakeY,
        this.playerPos.z - fwdZ * 6.8
      );
      _camTargetLook.set(
        this.playerPos.x + fwdX * 10,
        this.playerPos.y + 1.05,
        this.playerPos.z + fwdZ * 10
      );
      targetFov = 64 + speedRatio * 15;
      posLambda = 11;
      lookLambda = 18;
    } else if (this.cameraMode === 'far') {
      _camTargetPos.set(
        this.playerPos.x - fwdX * 10.6 + shakeX,
        this.playerPos.y + 4.3 + shakeY,
        this.playerPos.z - fwdZ * 10.6
      );
      _camTargetLook.set(
        this.playerPos.x + fwdX * 14,
        this.playerPos.y + 1.1,
        this.playerPos.z + fwdZ * 14
      );
      targetFov = 66 + speedRatio * 12;
      posLambda = 9;
      lookLambda = 15;
    } else if (this.cameraMode === 'cockpit') {
      if (this.playerRig.cockpitEyeAnchor && this.playerRig.cockpitLookAnchor) {
        this.playerRig.root.updateMatrixWorld(true);
        this.playerRig.cockpitEyeAnchor.getWorldPosition(_camTargetPos);
        this.playerRig.cockpitLookAnchor.getWorldPosition(_camTargetLook);
        _camTargetPos.x += shakeX * 0.16;
        _camTargetPos.y += shakeY * 0.2;
      } else {
        const driverLat = -0.36;
        _camTargetPos.set(
          this.playerPos.x + rightX * driverLat - fwdX * 0.16 + shakeX * 0.2,
          this.playerPos.y + 1.07 + shakeY * 0.25,
          this.playerPos.z + rightZ * driverLat - fwdZ * 0.16
        );
        _camTargetLook.set(
          this.playerPos.x + rightX * (driverLat * 0.65) + fwdX * 24,
          this.playerPos.y + 0.96,
          this.playerPos.z + rightZ * (driverLat * 0.65) + fwdZ * 24
        );
      }
      targetFov = 70 + speedRatio * 9;
      posLambda = 140;
      lookLambda = 120;
    } else if (this.cameraMode === 'hood') {
      _camTargetPos.set(
        this.playerPos.x + fwdX * 0.35,
        this.playerPos.y + 1.38 + this.playerPitch * 0.6 + shakeY * 0.5,
        this.playerPos.z + fwdZ * 0.35
      );
      _camTargetLook.set(
        this.playerPos.x + fwdX * 26,
        this.playerPos.y + 1.15 - this.playerPitch * 4,
        this.playerPos.z + fwdZ * 26
      );
      targetFov = 72 + speedRatio * 12;
      posLambda = 48;
      lookLambda = 42;
    } else if (this.cameraMode === 'bumper') {
      _camTargetPos.set(
        this.playerPos.x + fwdX * 2.3,
        this.playerPos.y + 0.62 + shakeY * 0.4,
        this.playerPos.z + fwdZ * 2.3
      );
      _camTargetLook.set(
        this.playerPos.x + fwdX * 28,
        this.playerPos.y + 0.68,
        this.playerPos.z + fwdZ * 28
      );
      targetFov = 76 + speedRatio * 14;
      posLambda = 52;
      lookLambda = 46;
    } else {
      _camTargetPos.set(
        this.playerPos.x - fwdX * 17,
        this.playerPos.y + 21,
        this.playerPos.z - fwdZ * 17
      );
      _camTargetLook.set(
        this.playerPos.x + fwdX * 6,
        this.playerPos.y + 0.8,
        this.playerPos.z + fwdZ * 6
      );
      targetFov = 58;
      posLambda = 5.5;
      lookLambda = 9;
    }

    if (!this.cameraInitialized) {
      _camCurPos.copy(_camTargetPos);
      _camCurLook.copy(_camTargetLook);
      this.cameraInitialized = true;
    } else {
      _camCurPos.lerp(_camTargetPos, 1 - Math.exp(-posLambda * dt));
      _camCurLook.lerp(_camTargetLook, 1 - Math.exp(-lookLambda * dt));
    }

    this.currentFov = THREE.MathUtils.damp(this.currentFov, targetFov, 7, dt);
    if (Math.abs(this.camera.fov - this.currentFov) > 0.05) {
      this.camera.fov = this.currentFov;
      this.camera.updateProjectionMatrix();
    }

    this.camera.position.copy(_camCurPos);
    this.camera.lookAt(_camCurLook);
  }

  private emitTelemetry(): void {
    if (!this.track) return;
    const config = RACE_MAPS[this.currentMapId];
    const speedKmh = Math.round(Math.abs(this.playerForwardSpeed) * 3.6);
    const gear = this.computeGear(speedKmh);
    const rpmRatio = this.countdownTimer > 0 && this.input.throttle
      ? 0.78
      : this.computeRpmRatio(speedKmh, gear);

    let rank = 1;
    for (let i = 0; i < this.aiRacers.length; i++) {
      if (this.aiRacers[i].unwrappedProgress > this.playerUnwrappedProgress) {
        rank++;
      }
    }

    const bounds = this.track.minimapBounds;
    const span = bounds.maxX - bounds.minX;
    const toMini = (p: THREE.Vector3) => ({
      x: ((p.x - bounds.minX) / span) * 100,
      y: ((p.z - bounds.minZ) / span) * 100,
    });

    const entities: MinimapEntity[] = this.aiRacers.map((ai) => {
      const m = toMini(ai.rig.root.position);
      return { id: ai.id, x: m.x, y: m.y, isPlayer: false, color: ai.colorCss };
    });
    const pm = toMini(this.playerPos);
    entities.push({ id: 'player', x: pm.x, y: pm.y, isPlayer: true, color: '#ef4444' });

    const halfW = config.trackWidth * 0.5;
    const nearest = this.track.sampleNearest(this.playerPos, this.playerTrackIdx);

    this.onTelemetry({
      speedKmh,
      rpmRatio,
      gear,
      nitro: Math.round(this.playerNitro),
      isNitroActive: this.input.nitro && this.input.throttle && this.playerNitro > 2 && this.countdownTimer <= 0,
      isDrifting: Math.abs(this.playerForwardSpeed) > 16 && (this.input.handbrake || Math.abs(this.playerLateralSpeed) > 5.5),
      isOffRoad: nearest.distFromCenter > halfW + 1.1,
      lap: this.playerLap,
      totalLaps: config.totalLaps,
      position: rank,
      totalRacers: this.aiRacers.length + 1,
      lapTimeMs: this.lapTimeMs,
      bestLapMs: this.bestLapMs,
      totalTimeMs: this.totalTimeMs,
      countdown: Math.ceil(this.countdownTimer),
      raceFinished: this.raceFinished,
      minimapTrack: this.track.minimapPoints,
      minimapEntities: entities,
    });
  }

  private afterDraw(cb: () => void): void {
    const gl = this.renderer.getContext() as WebGL2RenderingContext;
    const sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
    gl.flush();
    const poll = () => {
      if (this.disposed) return;
      const state = sync && gl.getSyncParameter(sync, gl.SYNC_STATUS);
      if (state === gl.UNSIGNALED) {
        this.frameId = window.setTimeout(poll, 5);
      } else {
        if (sync) gl.deleteSync(sync);
        this.frameId = window.setTimeout(cb, 80);
      }
    };
    this.frameId = window.setTimeout(poll, 5);
  }

  private tick = (): void => {
    if (this.disposed) return;

    const rawDt = this.clock.getDelta();
    const dt = Math.min(rawDt, 0.05);
    this.elapsedSeconds += dt;

    this.track?.update(dt);

    if (this.isPlaying && !this.isPaused) {
      this.updatePhysics(dt);
      this.updateParticles(dt);
    }
    this.updateCamera(dt);

    if (this.composer && !this.isSoftwareGl) {
      this.composer.render();
    } else {
      this.renderer.render(this.scene, this.camera);
    }

    this.telemetryAccumulator += rawDt;
    if (this.telemetryAccumulator >= 0.05) {
      this.telemetryAccumulator = 0;
      this.emitTelemetry();
    }

    if (this.isSoftwareGl) {
      this.afterDraw(this.tick);
    } else {
      this.frameId = requestAnimationFrame(this.tick);
    }
  };

  public dispose(): void {
    this.disposed = true;
    cancelAnimationFrame(this.frameId);
    clearTimeout(this.frameId);
    this.resizeObserver.disconnect();

    const canvas = this.renderer.domElement;
    canvas.removeEventListener('webglcontextlost', this.handleContextLost);
    canvas.removeEventListener('webglcontextrestored', this.handleContextRestored);

    this.audio.dispose();
    this.playerRig.dispose();
    this.aiRacers.forEach((a) => a.rig.dispose());
    this.track?.dispose();
    this.smokeMesh.geometry.dispose();
    (this.smokeMesh.material as THREE.Material).dispose();
    this.skidMesh.geometry.dispose();
    (this.skidMesh.material as THREE.Material).dispose();
    this.envMapTexture?.dispose();
    this.composer?.dispose();

    this.renderer.dispose();
    if (canvas.parentElement === this.container) {
      this.container.removeChild(canvas);
    }
  }
}
