import * as THREE from 'three';
import {
  createAsphaltTextures,
  createBuildingFacadeTexture,
  createCheckeredTexture,
  createChevronSignTexture,
  createCurbTexture,
  createHighwayGantryTexture,
  createSkyDomeTexture,
  createTerrainTexture,
  createWaterNormalTexture,
} from './textures';
import { MapConfig, MinimapPoint } from './types';

export interface TrackSample {
  point: THREE.Vector3;
  tangent: THREE.Vector3;
  right: THREE.Vector3;
  progress: number; // 0..1
}

export interface BuiltTrack {
  group: THREE.Group;
  samples: TrackSample[];
  lampPositions: THREE.Vector3[];
  totalLength: number;
  minimapPoints: MinimapPoint[];
  minimapBounds: { minX: number; maxX: number; minZ: number; maxZ: number };
  update: (dt: number) => void;
  sampleNearest: (pos: THREE.Vector3, hintIndex?: number) => {
    index: number;
    sample: TrackSample;
    distFromCenter: number;
    signedOffset: number;
  };
  dispose: () => void;
}

export function buildMapEnvironmentTexture(
  renderer: THREE.WebGLRenderer,
  config: MapConfig
): THREE.Texture {
  const pmrem = new THREE.PMREMGenerator(renderer);
  const envScene = new THREE.Scene();

  const skyTex = createSkyDomeTexture(config.skyTopColor, config.skyHorizonColor, config.isNight);
  const dome = new THREE.Mesh(
    new THREE.SphereGeometry(50, 24, 16),
    new THREE.MeshBasicMaterial({ map: skyTex, side: THREE.BackSide })
  );
  envScene.add(dome);

  const groundDisc = new THREE.Mesh(
    new THREE.CircleGeometry(48, 24),
    new THREE.MeshBasicMaterial({ color: config.groundColor })
  );
  groundDisc.rotation.x = -Math.PI / 2;
  groundDisc.position.y = -4;
  envScene.add(groundDisc);

  const sunDir = new THREE.Vector3(...config.sunPosition).normalize().multiplyScalar(38);
  const sunOrb = new THREE.Mesh(
    new THREE.SphereGeometry(config.isNight ? 3.5 : 5.5, 12, 12),
    new THREE.MeshBasicMaterial({
      color: config.isNight ? 0xcbd5e1 : 0xffffff,
    })
  );
  sunOrb.position.copy(sunDir);
  envScene.add(sunOrb);

  if (config.isNight) {
    const neonColors = [0x38bdf8, 0xfde68a, 0xf59e0b, 0x60a5fa];
    for (let i = 0; i < 8; i++) {
      const angle = (i / 8) * Math.PI * 2;
      const strip = new THREE.Mesh(
        new THREE.BoxGeometry(2.5, 16, 2.5),
        new THREE.MeshBasicMaterial({ color: neonColors[i % neonColors.length] })
      );
      strip.position.set(Math.cos(angle) * 32, 7, Math.sin(angle) * 32);
      envScene.add(strip);
    }
  } else {
    const fillStrip = new THREE.Mesh(
      new THREE.PlaneGeometry(36, 10),
      new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide })
    );
    fillStrip.position.set(-sunDir.x * 0.6, 20, -sunDir.z * 0.6);
    fillStrip.lookAt(0, 0, 0);
    envScene.add(fillStrip);
  }

  const envTex = pmrem.fromScene(envScene, 0.035).texture;
  skyTex.dispose();
  dome.geometry.dispose();
  (dome.material as THREE.Material).dispose();
  groundDisc.geometry.dispose();
  (groundDisc.material as THREE.Material).dispose();
  sunOrb.geometry.dispose();
  (sunOrb.material as THREE.Material).dispose();
  pmrem.dispose();

  return envTex;
}

export function buildRaceTrack(
  config: MapConfig,
  maxAnisotropy: number,
  isSoftwareGl: boolean
): BuiltTrack {
  const group = new THREE.Group();
  const geometries: THREE.BufferGeometry[] = [];
  const materials: THREE.Material[] = [];
  const textures: THREE.Texture[] = [];
  const lampPositions: THREE.Vector3[] = [];

  const trackGeo = <T extends THREE.BufferGeometry>(g: T): T => {
    geometries.push(g);
    return g;
  };
  const trackMat = <T extends THREE.Material>(m: T): T => {
    materials.push(m);
    return m;
  };
  const trackTex = <T extends THREE.Texture>(t: T): T => {
    textures.push(t);
    return t;
  };

  const ctrlPoints = config.waypoints.map((p) => new THREE.Vector3(p[0], p[1], p[2]));
  const curve = new THREE.CatmullRomCurve3(ctrlPoints, true, 'centripetal', 0.5);
  const totalLength = curve.getLength();
  const segments = 460;
  const up = new THREE.Vector3(0, 1, 0);

  const samples: TrackSample[] = [];
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;

  for (let i = 0; i < segments; i++) {
    const u = i / segments;
    const pt = curve.getPointAt(u);
    const tan = curve.getTangentAt(u).normalize();
    const right = new THREE.Vector3().crossVectors(up, tan).normalize();
    samples.push({ point: pt, tangent: tan, right, progress: u });

    if (pt.x < minX) minX = pt.x;
    if (pt.x > maxX) maxX = pt.x;
    if (pt.z < minZ) minZ = pt.z;
    if (pt.z > maxZ) maxZ = pt.z;
  }

  const spanX = Math.max(1, maxX - minX);
  const spanZ = Math.max(1, maxZ - minZ);
  const span = Math.max(spanX, spanZ);
  const padX = (span - spanX) * 0.5;
  const padZ = (span - spanZ) * 0.5;
  const minimapBounds = {
    minX: minX - padX - 30,
    maxX: maxX + padX + 30,
    minZ: minZ - padZ - 30,
    maxZ: maxZ + padZ + 30,
  };
  const mapSpan = minimapBounds.maxX - minimapBounds.minX;
  const minimapPoints: MinimapPoint[] = [];
  for (let i = 0; i < segments; i += 4) {
    const p = samples[i].point;
    minimapPoints.push({
      x: ((p.x - minimapBounds.minX) / mapSpan) * 100,
      y: ((p.z - minimapBounds.minZ) / mapSpan) * 100,
    });
  }

  // 1. Road Asphalt Ribbon + Curbs + Guardrails
  const halfW = config.trackWidth * 0.5;
  const curbW = 1.65;
  const railOffset = halfW + curbW + 2.4;

  const roadPositions: number[] = [];
  const roadUvs: number[] = [];
  const roadIndices: number[] = [];

  const curbPositions: number[] = [];
  const curbUvs: number[] = [];
  const curbIndices: number[] = [];

  const railPositions: number[] = [];
  const railIndices: number[] = [];

  const uvRepeatLen = 13;

  for (let i = 0; i <= segments; i++) {
    const s = samples[i % segments];
    const distAlong = (i / segments) * totalLength;
    const vCoord = distAlong / uvRepeatLen;

    const leftPt = s.point.clone().addScaledVector(s.right, halfW);
    const rightPt = s.point.clone().addScaledVector(s.right, -halfW);
    roadPositions.push(leftPt.x, leftPt.y + 0.02, leftPt.z);
    roadPositions.push(rightPt.x, rightPt.y + 0.02, rightPt.z);
    roadUvs.push(0, vCoord, 1, vCoord);

    const lCurbIn = s.point.clone().addScaledVector(s.right, halfW);
    const lCurbOut = s.point.clone().addScaledVector(s.right, halfW + curbW);
    const rCurbIn = s.point.clone().addScaledVector(s.right, -halfW);
    const rCurbOut = s.point.clone().addScaledVector(s.right, -(halfW + curbW));

    curbPositions.push(
      lCurbOut.x, lCurbOut.y + 0.06, lCurbOut.z,
      lCurbIn.x, lCurbIn.y + 0.025, lCurbIn.z,
      rCurbIn.x, rCurbIn.y + 0.025, rCurbIn.z,
      rCurbOut.x, rCurbOut.y + 0.06, rCurbOut.z
    );
    const curbV = distAlong / 4.2;
    curbUvs.push(0, curbV, 1, curbV, 0, curbV, 1, curbV);

    const lRail = s.point.clone().addScaledVector(s.right, railOffset);
    const rRail = s.point.clone().addScaledVector(s.right, -railOffset);
    railPositions.push(
      lRail.x, lRail.y + 0.25, lRail.z,
      lRail.x, lRail.y + 0.96, lRail.z,
      rRail.x, rRail.y + 0.25, rRail.z,
      rRail.x, rRail.y + 0.96, rRail.z
    );

    if (i < segments) {
      const rBase = i * 2;
      roadIndices.push(rBase, rBase + 2, rBase + 1);
      roadIndices.push(rBase + 1, rBase + 2, rBase + 3);

      const cBase = i * 4;
      curbIndices.push(cBase, cBase + 4, cBase + 1);
      curbIndices.push(cBase + 1, cBase + 4, cBase + 5);
      curbIndices.push(cBase + 2, cBase + 6, cBase + 3);
      curbIndices.push(cBase + 3, cBase + 6, cBase + 7);

      railIndices.push(cBase, cBase + 4, cBase + 1);
      railIndices.push(cBase + 1, cBase + 4, cBase + 5);
      railIndices.push(cBase + 2, cBase + 3, cBase + 6);
      railIndices.push(cBase + 3, cBase + 7, cBase + 6);
    }
  }

  const { map: asphaltMap, roughnessMap: asphaltRoughMap, normalMap: asphaltNormalMap } =
    createAsphaltTextures(maxAnisotropy, config.asphaltWetness);
  trackTex(asphaltMap);
  trackTex(asphaltRoughMap);
  trackTex(asphaltNormalMap);

  const roadGeo = trackGeo(new THREE.BufferGeometry());
  roadGeo.setAttribute('position', new THREE.Float32BufferAttribute(roadPositions, 3));
  roadGeo.setAttribute('uv', new THREE.Float32BufferAttribute(roadUvs, 2));
  roadGeo.setIndex(roadIndices);
  roadGeo.computeVertexNormals();

  const roadMat = trackMat(
    new THREE.MeshStandardMaterial({
      map: asphaltMap,
      roughnessMap: asphaltRoughMap,
      normalMap: asphaltNormalMap,
      normalScale: new THREE.Vector2(1.15, 1.15),
      roughness: config.asphaltRoughness,
      metalness: config.asphaltWetness > 0.5 ? 0.28 : 0.04,
      envMapIntensity: config.asphaltWetness > 0.5 ? 1.75 : 0.85,
    })
  );
  const roadMesh = new THREE.Mesh(roadGeo, roadMat);
  roadMesh.receiveShadow = true;
  group.add(roadMesh);

  // Curbs
  const curbTex = trackTex(createCurbTexture(config.curbPrimary, config.curbSecondary, maxAnisotropy));
  const curbGeo = trackGeo(new THREE.BufferGeometry());
  curbGeo.setAttribute('position', new THREE.Float32BufferAttribute(curbPositions, 3));
  curbGeo.setAttribute('uv', new THREE.Float32BufferAttribute(curbUvs, 2));
  curbGeo.setIndex(curbIndices);
  curbGeo.computeVertexNormals();

  const curbMat = trackMat(
    new THREE.MeshStandardMaterial({
      map: curbTex,
      roughness: 0.65,
      metalness: 0.05,
    })
  );
  const curbMesh = new THREE.Mesh(curbGeo, curbMat);
  curbMesh.receiveShadow = true;
  group.add(curbMesh);

  // Guardrails
  const railGeo = trackGeo(new THREE.BufferGeometry());
  railGeo.setAttribute('position', new THREE.Float32BufferAttribute(railPositions, 3));
  railGeo.setIndex(railIndices);
  railGeo.computeVertexNormals();
  const railMat = trackMat(
    new THREE.MeshStandardMaterial({
      color: config.isNight ? 0x94a3b8 : 0xcbd5e1,
      metalness: 0.82,
      roughness: 0.3,
      side: THREE.DoubleSide,
    })
  );
  const railMesh = new THREE.Mesh(railGeo, railMat);
  railMesh.castShadow = !isSoftwareGl;
  railMesh.receiveShadow = true;
  group.add(railMesh);

  // Guardrail posts via InstancedMesh
  const postStep = 6;
  const postCount = Math.floor(segments / postStep) * 2;
  const postGeo = trackGeo(new THREE.BoxGeometry(0.18, 0.96, 0.18));
  const postMat = trackMat(new THREE.MeshStandardMaterial({ color: 0x475569, metalness: 0.72, roughness: 0.42 }));
  const postsMesh = new THREE.InstancedMesh(postGeo, postMat, postCount);
  const dummy = new THREE.Object3D();
  let pIdx = 0;
  for (let i = 0; i < segments; i += postStep) {
    const s = samples[i];
    for (const side of [1, -1]) {
      if (pIdx >= postCount) break;
      dummy.position.copy(s.point).addScaledVector(s.right, side * (railOffset + 0.12));
      dummy.position.y += 0.45;
      dummy.lookAt(dummy.position.clone().add(s.tangent));
      dummy.updateMatrix();
      postsMesh.setMatrixAt(pIdx++, dummy.matrix);
    }
  }
  postsMesh.instanceMatrix.needsUpdate = true;
  postsMesh.computeBoundingSphere();
  group.add(postsMesh);

  // 2. Corner Chevron Warning Boards on sharp turns
  const chevronTex = trackTex(createChevronSignTexture(maxAnisotropy));
  const chevronGeo = trackGeo(new THREE.BoxGeometry(3.2, 1.5, 0.14));
  const chevronMat = trackMat(
    new THREE.MeshStandardMaterial({
      map: chevronTex,
      emissive: config.isNight ? 0xf59e0b : 0x000000,
      emissiveMap: config.isNight ? chevronTex : null,
      emissiveIntensity: config.isNight ? 0.9 : 0,
      roughness: 0.4,
    })
  );
  const chevronCoords: { pos: THREE.Vector3; look: THREE.Vector3 }[] = [];
  for (let i = 10; i < segments - 10; i += 14) {
    const s0 = samples[i];
    const sNext = samples[(i + 10) % segments];
    const dot = s0.tangent.dot(sNext.tangent);
    if (dot < 0.92) {
      const crossY = s0.tangent.z * sNext.tangent.x - s0.tangent.x * sNext.tangent.z;
      const outsideSign = crossY > 0 ? -1 : 1;
      const pos = s0.point.clone().addScaledVector(s0.right, outsideSign * (railOffset + 1.4));
      pos.y += 1.6;
      const look = s0.point.clone().addScaledVector(s0.tangent, -12);
      chevronCoords.push({ pos, look });
    }
  }
  if (chevronCoords.length > 0) {
    const chevrons = new THREE.InstancedMesh(chevronGeo, chevronMat, chevronCoords.length);
    chevronCoords.forEach((c, idx) => {
      dummy.position.copy(c.pos);
      dummy.lookAt(c.look);
      dummy.scale.set(1, 1, 1);
      dummy.updateMatrix();
      chevrons.setMatrixAt(idx, dummy.matrix);
    });
    chevrons.instanceMatrix.needsUpdate = true;
    chevrons.computeBoundingSphere();
    group.add(chevrons);
  }

  // 3. Start / Finish Line, Gantry Arch & Pit Grandstands
  const startSample = samples[0];
  const checkeredTex = trackTex(createCheckeredTexture(maxAnisotropy));
  const startAngle = Math.atan2(startSample.tangent.x, startSample.tangent.z);

  const startStripGeo = trackGeo(new THREE.PlaneGeometry(config.trackWidth - 0.6, 4.2));
  startStripGeo.rotateX(-Math.PI / 2);
  const startStripMat = trackMat(
    new THREE.MeshStandardMaterial({
      map: checkeredTex,
      roughness: 0.52,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1,
    })
  );
  const startStrip = new THREE.Mesh(startStripGeo, startStripMat);
  startStrip.position.copy(startSample.point);
  startStrip.position.y += 0.04;
  startStrip.rotation.set(0, startAngle, 0);
  group.add(startStrip);

  const gantryGroup = new THREE.Group();
  gantryGroup.position.copy(startSample.point);
  gantryGroup.rotation.y = startAngle;

  const pillarGeo = trackGeo(new THREE.BoxGeometry(0.9, 9.4, 0.9));
  const steelMat = trackMat(new THREE.MeshStandardMaterial({ color: 0x1e293b, metalness: 0.78, roughness: 0.28 }));
  for (const sx of [-1, 1]) {
    const pillar = new THREE.Mesh(pillarGeo, steelMat);
    pillar.position.set(sx * (halfW + 2.2), 4.7, 0);
    pillar.castShadow = true;
    gantryGroup.add(pillar);
  }
  const beamGeo = trackGeo(new THREE.BoxGeometry(config.trackWidth + 5.8, 1.5, 1.2));
  const beam = new THREE.Mesh(beamGeo, steelMat);
  beam.position.set(0, 8.7, 0);
  beam.castShadow = true;
  gantryGroup.add(beam);

  const bannerGeo = trackGeo(new THREE.PlaneGeometry(config.trackWidth + 2, 1.2));
  const bannerMat = trackMat(
    new THREE.MeshStandardMaterial({
      map: checkeredTex,
      emissive: config.isNight ? 0x64748b : 0x000000,
      emissiveIntensity: 0.95,
      side: THREE.DoubleSide,
    })
  );
  const bannerF = new THREE.Mesh(bannerGeo, bannerMat);
  bannerF.position.set(0, 8.7, 0.62);
  gantryGroup.add(bannerF);

  const bannerB = new THREE.Mesh(bannerGeo, bannerMat);
  bannerB.position.set(0, 8.7, -0.62);
  gantryGroup.add(bannerB);

  const podMat = trackMat(
    new THREE.MeshStandardMaterial({
      color: 0xef4444,
      emissive: 0xef4444,
      emissiveIntensity: 2.6,
    })
  );
  const podGeo = trackGeo(new THREE.SphereGeometry(0.24, 12, 12));
  for (let l = -2; l <= 2; l++) {
    const pod = new THREE.Mesh(podGeo, podMat);
    pod.position.set(l * 1.15, 7.75, 0.62);
    gantryGroup.add(pod);
  }

  const standMat = trackMat(new THREE.MeshStandardMaterial({ color: 0x334155, roughness: 0.6, metalness: 0.3 }));
  const roofCanopyMat = trackMat(new THREE.MeshStandardMaterial({ color: 0xf8fafc, roughness: 0.45, metalness: 0.2 }));
  const standBaseGeo = trackGeo(new THREE.BoxGeometry(8, 6.5, 42));
  const standRoofGeo = trackGeo(new THREE.BoxGeometry(10, 0.4, 44));
  const stand = new THREE.Mesh(standBaseGeo, standMat);
  stand.position.set(halfW + 10.5, 3.2, -16);
  stand.castShadow = !isSoftwareGl;
  stand.receiveShadow = true;
  gantryGroup.add(stand);

  const standRoof = new THREE.Mesh(standRoofGeo, roofCanopyMat);
  standRoof.position.set(halfW + 9.2, 7.2, -16);
  standRoof.rotation.z = 0.14;
  gantryGroup.add(standRoof);

  group.add(gantryGroup);

  // 4. Sculpted Ground Terrain with Normal Map
  const { map: terrainMap, normalMap: terrainNormal } = createTerrainTexture(config.id, maxAnisotropy);
  trackTex(terrainMap);
  trackTex(terrainNormal);

  const terrainSize = 1500;
  const terrainRes = 112;
  const terrainGeo = trackGeo(new THREE.PlaneGeometry(terrainSize, terrainSize, terrainRes, terrainRes));
  terrainGeo.rotateX(-Math.PI / 2);

  const tPos = terrainGeo.attributes.position;
  for (let i = 0; i < tPos.count; i++) {
    const vx = tPos.getX(i);
    const vz = tPos.getZ(i);

    let bestIdx = 0;
    let bestDistSq = Infinity;
    for (let s = 0; s < segments; s += 4) {
      const sp = samples[s].point;
      const dx = vx - sp.x;
      const dz = vz - sp.z;
      const d2 = dx * dx + dz * dz;
      if (d2 < bestDistSq) {
        bestDistSq = d2;
        bestIdx = s;
      }
    }
    let roadY = samples[bestIdx].point.y;
    for (let k = -3; k <= 3; k++) {
      const idx = (bestIdx + k + segments) % segments;
      const sp = samples[idx].point;
      const dx = vx - sp.x;
      const dz = vz - sp.z;
      const d2 = dx * dx + dz * dz;
      if (d2 < bestDistSq) {
        bestDistSq = d2;
        roadY = sp.y;
      }
    }

    const dist = Math.sqrt(bestDistSq);
    const roadClearRadius = halfW + curbW + 3.0;

    if (dist < roadClearRadius) {
      tPos.setY(i, roadY - 0.14);
    } else {
      const blend = Math.min(1, (dist - roadClearRadius) / 38);
      let hills = 0;
      if (config.id === 'alpine') {
        hills =
          (Math.sin(vx * 0.015) * Math.cos(vz * 0.015) * 14 +
            Math.sin(vx * 0.035 + vz * 0.02) * 6 +
            Math.max(0, (dist - 180) * 0.14)) *
          blend;
      } else if (config.id === 'canyon') {
        hills =
          (Math.sin(vx * 0.018) * Math.sin(vz * 0.018) * 10 +
            Math.max(0, (dist - 160) * 0.12)) *
          blend;
      } else if (config.id === 'coastal') {
        const outerDrop = dist > 95 ? -Math.min(7, (dist - 95) * 0.08) : 0;
        hills = (Math.sin(vx * 0.02) * Math.cos(vz * 0.02) * 3.5 + outerDrop) * blend;
      } else {
        hills = -0.18 * blend;
      }
      tPos.setY(i, roadY - 0.14 + hills);
    }
  }
  terrainGeo.computeVertexNormals();

  const terrainMat = trackMat(
    new THREE.MeshStandardMaterial({
      map: terrainMap,
      normalMap: terrainNormal,
      normalScale: new THREE.Vector2(0.85, 0.85),
      roughness: config.id === 'midnight' ? 0.52 : 0.92,
      metalness: 0.02,
    })
  );
  const terrainMesh = new THREE.Mesh(terrainGeo, terrainMat);
  terrainMesh.receiveShadow = true;
  group.add(terrainMesh);

  let waterNormalTex: THREE.CanvasTexture | null = null;
  if (config.id === 'coastal') {
    waterNormalTex = trackTex(createWaterNormalTexture(maxAnisotropy));
    waterNormalTex.repeat.set(60, 60);
    const oceanGeo = trackGeo(new THREE.PlaneGeometry(2400, 2400));
    oceanGeo.rotateX(-Math.PI / 2);
    const oceanMat = trackMat(
      new THREE.MeshPhysicalMaterial({
        color: 0x0284c7,
        normalMap: waterNormalTex,
        normalScale: new THREE.Vector2(0.45, 0.45),
        roughness: 0.14,
        metalness: 0.25,
        clearcoat: 0.95,
        clearcoatRoughness: 0.08,
        envMapIntensity: 1.75,
      })
    );
    const ocean = new THREE.Mesh(oceanGeo, oceanMat);
    ocean.position.y = -1.85;
    ocean.receiveShadow = true;
    group.add(ocean);
  }

  // 5. Sky Dome + Sun / Moon Disc
  const skyTex = trackTex(
    createSkyDomeTexture(config.skyTopColor, config.skyHorizonColor, config.isNight)
  );
  const skyGeo = trackGeo(new THREE.SphereGeometry(950, 32, 20));
  const skyMat = trackMat(
    new THREE.MeshBasicMaterial({
      map: skyTex,
      side: THREE.BackSide,
      fog: false,
    })
  );
  const skyMesh = new THREE.Mesh(skyGeo, skyMat);
  group.add(skyMesh);

  const sunDir = new THREE.Vector3(...config.sunPosition).normalize();
  const celestialGeo = trackGeo(new THREE.SphereGeometry(config.isNight ? 20 : 34, 18, 18));
  const celestialMat = trackMat(
    new THREE.MeshBasicMaterial({
      color: config.isNight ? 0xe0f2fe : 0xfff7ed,
      fog: false,
    })
  );
  const celestial = new THREE.Mesh(celestialGeo, celestialMat);
  celestial.position.copy(sunDir).multiplyScalar(780);
  group.add(celestial);

  // 6. Map-Specific Landmarks & Perimeter Props (InstancedMesh)
  const isNearTrack = (x: number, z: number, minDist: number): boolean => {
    const minD2 = minDist * minDist;
    for (let s = 0; s < segments; s += 3) {
      const sp = samples[s].point;
      const dx = x - sp.x;
      const dz = z - sp.z;
      if (dx * dx + dz * dz < minD2) return true;
    }
    return false;
  };

  const getApproxGroundY = (x: number, z: number): number => {
    let bestD2 = Infinity;
    let bestY = 0;
    for (let s = 0; s < segments; s += 6) {
      const sp = samples[s].point;
      const d2 = (x - sp.x) * (x - sp.x) + (z - sp.z) * (z - sp.z);
      if (d2 < bestD2) {
        bestD2 = d2;
        bestY = sp.y;
      }
    }
    return bestY;
  };

  if (config.id === 'alpine') {
    const treeCount = 280;
    const trunkGeo = trackGeo(new THREE.CylinderGeometry(0.28, 0.42, 2.8, 7));
    trunkGeo.translate(0, 1.4, 0);
    const trunkMat = trackMat(new THREE.MeshStandardMaterial({ color: 0x4b3621, roughness: 0.9 }));
    const foliageGeo = trackGeo(new THREE.ConeGeometry(2.3, 6.2, 8));
    foliageGeo.translate(0, 5.2, 0);
    const foliageMat = trackMat(new THREE.MeshStandardMaterial({ color: 0x224c28, roughness: 0.85 }));

    const trunks = new THREE.InstancedMesh(trunkGeo, trunkMat, treeCount);
    const crowns = new THREE.InstancedMesh(foliageGeo, foliageMat, treeCount);
    trunks.castShadow = !isSoftwareGl;
    crowns.castShadow = !isSoftwareGl;

    let placed = 0;
    let attempts = 0;
    const colorTint = new THREE.Color();
    while (placed < treeCount && attempts < 2200) {
      attempts++;
      const angle = Math.random() * Math.PI * 2;
      const rad = 55 + Math.random() * 410;
      const px = Math.cos(angle) * rad;
      const pz = Math.sin(angle) * rad - 130;
      if (isNearTrack(px, pz, halfW + 14)) continue;

      const py = getApproxGroundY(px, pz);
      const scale = 0.85 + Math.random() * 0.65;
      dummy.position.set(px, py - 0.3, pz);
      dummy.rotation.set(0, Math.random() * Math.PI * 2, 0);
      dummy.scale.set(scale, scale, scale);
      dummy.updateMatrix();
      trunks.setMatrixAt(placed, dummy.matrix);
      crowns.setMatrixAt(placed, dummy.matrix);
      colorTint.setHSL(0.32 + (Math.random() - 0.5) * 0.04, 0.42, 0.22 + Math.random() * 0.08);
      crowns.setColorAt(placed, colorTint);
      placed++;
    }
    trunks.count = placed;
    crowns.count = placed;
    trunks.instanceMatrix.needsUpdate = true;
    crowns.instanceMatrix.needsUpdate = true;
    if (crowns.instanceColor) crowns.instanceColor.needsUpdate = true;
    trunks.computeBoundingSphere();
    crowns.computeBoundingSphere();
    group.add(trunks, crowns);

    const peakCount = 38;
    const peakGeo = trackGeo(new THREE.ConeGeometry(48, 88, 6));
    peakGeo.translate(0, 40, 0);
    const peakMat = trackMat(new THREE.MeshStandardMaterial({ color: 0x64748b, roughness: 0.85 }));
    const peaks = new THREE.InstancedMesh(peakGeo, peakMat, peakCount);
    for (let i = 0; i < peakCount; i++) {
      const a = (i / peakCount) * Math.PI * 2;
      const r = 460 + Math.random() * 140;
      dummy.position.set(Math.cos(a) * r, -5, Math.sin(a) * r - 130);
      dummy.rotation.set(0, Math.random() * Math.PI, 0);
      dummy.scale.set(0.8 + Math.random() * 0.9, 0.8 + Math.random() * 1.1, 0.8 + Math.random() * 0.9);
      dummy.updateMatrix();
      peaks.setMatrixAt(i, dummy.matrix);
    }
    peaks.instanceMatrix.needsUpdate = true;
    peaks.computeBoundingSphere();
    group.add(peaks);
  } else if (config.id === 'canyon') {
    const mesaCount = 95;
    const mesaGeo = trackGeo(new THREE.CylinderGeometry(8, 16, 38, 7));
    mesaGeo.translate(0, 17, 0);
    const mesaMat = trackMat(new THREE.MeshStandardMaterial({ color: 0xb45334, roughness: 0.9 }));
    const mesas = new THREE.InstancedMesh(mesaGeo, mesaMat, mesaCount);
    mesas.castShadow = !isSoftwareGl;

    let placed = 0;
    let attempts = 0;
    const tint = new THREE.Color();
    while (placed < mesaCount && attempts < 1400) {
      attempts++;
      const a = Math.random() * Math.PI * 2;
      const r = 80 + Math.random() * 440;
      const px = Math.cos(a) * r;
      const pz = Math.sin(a) * r - 140;
      if (isNearTrack(px, pz, halfW + 24)) continue;

      const py = getApproxGroundY(px, pz);
      dummy.position.set(px, py - 2, pz);
      dummy.rotation.set(0, Math.random() * Math.PI * 2, 0);
      dummy.scale.set(0.7 + Math.random() * 1.6, 0.5 + Math.random() * 1.6, 0.7 + Math.random() * 1.6);
      dummy.updateMatrix();
      mesas.setMatrixAt(placed, dummy.matrix);
      tint.setHSL(0.045 + (Math.random() - 0.5) * 0.02, 0.58, 0.38 + Math.random() * 0.12);
      mesas.setColorAt(placed, tint);
      placed++;
    }
    mesas.count = placed;
    mesas.instanceMatrix.needsUpdate = true;
    if (mesas.instanceColor) mesas.instanceColor.needsUpdate = true;
    mesas.computeBoundingSphere();
    group.add(mesas);
  } else if (config.id === 'midnight') {
    // 1. Lit Skyscrapers
    const facadeTex = trackTex(createBuildingFacadeTexture(maxAnisotropy));
    const bldgCount = 145;
    const bldgGeo = trackGeo(new THREE.BoxGeometry(1, 1, 1));
    bldgGeo.translate(0, 0.5, 0);
    const bldgMat = trackMat(
      new THREE.MeshStandardMaterial({
        map: facadeTex,
        emissiveMap: facadeTex,
        emissive: 0xffffff,
        emissiveIntensity: 1.35,
        roughness: 0.35,
        metalness: 0.65,
      })
    );
    const buildings = new THREE.InstancedMesh(bldgGeo, bldgMat, bldgCount);

    let placed = 0;
    let attempts = 0;
    while (placed < bldgCount && attempts < 1800) {
      attempts++;
      const a = Math.random() * Math.PI * 2;
      const r = 55 + Math.random() * 410;
      const px = Math.cos(a) * r;
      const pz = Math.sin(a) * r - 140;
      if (isNearTrack(px, pz, halfW + 22)) continue;

      const py = getApproxGroundY(px, pz);
      const w = 14 + Math.random() * 18;
      const h = 34 + Math.random() * 92;
      const d = 14 + Math.random() * 18;
      dummy.position.set(px, py - 1, pz);
      dummy.rotation.set(0, (Math.floor(Math.random() * 4) * Math.PI) / 2, 0);
      dummy.scale.set(w, h, d);
      dummy.updateMatrix();
      buildings.setMatrixAt(placed, dummy.matrix);
      placed++;
    }
    buildings.count = placed;
    buildings.instanceMatrix.needsUpdate = true;
    buildings.computeBoundingSphere();
    group.add(buildings);

    // 2. Dense Highway Streetlamps + Ground Glow Pools + Pooled PointLight Anchors
    const lampStep = 8;
    const lampCount = Math.floor(segments / lampStep);
    const poleGeo = trackGeo(new THREE.CylinderGeometry(0.13, 0.18, 8.2, 6));
    poleGeo.translate(0, 4.1, 0);
    const poleMat = trackMat(new THREE.MeshStandardMaterial({ color: 0x475569, metalness: 0.8, roughness: 0.3 }));
    const poles = new THREE.InstancedMesh(poleGeo, poleMat, lampCount);

    const armGeo = trackGeo(new THREE.BoxGeometry(2.8, 0.16, 0.18));
    const arms = new THREE.InstancedMesh(armGeo, poleMat, lampCount);

    const bulbGeo = trackGeo(new THREE.BoxGeometry(1.7, 0.26, 0.55));
    const bulbMat = trackMat(new THREE.MeshBasicMaterial({ color: 0xfff3c4 }));
    const bulbs = new THREE.InstancedMesh(bulbGeo, bulbMat, lampCount);

    // Soft additive light pool directly on the asphalt beneath each lamp!
    const poolGeo = trackGeo(new THREE.CircleGeometry(7.5, 16));
    poolGeo.rotateX(-Math.PI / 2);
    const poolMat = trackMat(
      new THREE.MeshBasicMaterial({
        color: 0xfde68a,
        transparent: true,
        opacity: 0.13,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      })
    );
    const lightPools = new THREE.InstancedMesh(poolGeo, poolMat, lampCount);

    let lIdx = 0;
    for (let i = 0; i < segments && lIdx < lampCount; i += lampStep) {
      const s = samples[i];
      const side = lIdx % 2 === 0 ? 1 : -1;
      const basePos = s.point.clone().addScaledVector(s.right, side * (railOffset + 1.1));
      dummy.position.copy(basePos);
      dummy.lookAt(basePos.clone().add(s.tangent));
      dummy.scale.set(1, 1, 1);
      dummy.updateMatrix();
      poles.setMatrixAt(lIdx, dummy.matrix);

      // Arm reaching over road
      dummy.position.copy(basePos).addScaledVector(s.right, -side * 1.4);
      dummy.position.y += 8.05;
      dummy.updateMatrix();
      arms.setMatrixAt(lIdx, dummy.matrix);

      // Lamp head
      const lampWorldPos = basePos.clone().addScaledVector(s.right, -side * 2.5);
      lampWorldPos.y += 7.9;
      dummy.position.copy(lampWorldPos);
      dummy.updateMatrix();
      bulbs.setMatrixAt(lIdx, dummy.matrix);

      lampPositions.push(lampWorldPos);

      // Asphalt light pool
      dummy.position.copy(s.point).addScaledVector(s.right, side * (halfW * 0.52));
      dummy.position.y += 0.04;
      dummy.rotation.set(0, 0, 0);
      dummy.updateMatrix();
      lightPools.setMatrixAt(lIdx, dummy.matrix);

      lIdx++;
    }
    poles.count = lIdx;
    arms.count = lIdx;
    bulbs.count = lIdx;
    lightPools.count = lIdx;
    poles.instanceMatrix.needsUpdate = true;
    arms.instanceMatrix.needsUpdate = true;
    bulbs.instanceMatrix.needsUpdate = true;
    lightPools.instanceMatrix.needsUpdate = true;
    poles.computeBoundingSphere();
    arms.computeBoundingSphere();
    bulbs.computeBoundingSphere();
    lightPools.computeBoundingSphere();
    group.add(poles, arms, bulbs, lightPools);

    // 3. Glowing Road Cat-Eye Reflectors along Center & Edges
    const studStep = 3;
    const studCount = Math.floor(segments / studStep) * 2;
    const studGeo = trackGeo(new THREE.BoxGeometry(0.24, 0.06, 0.36));
    const studMat = trackMat(new THREE.MeshBasicMaterial({ color: 0x38bdf8 }));
    const studs = new THREE.InstancedMesh(studGeo, studMat, studCount);
    let stIdx = 0;
    for (let i = 0; i < segments; i += studStep) {
      const s = samples[i];
      for (const side of [1, -1]) {
        if (stIdx >= studCount) break;
        dummy.position.copy(s.point).addScaledVector(s.right, side * (halfW - 0.5));
        dummy.position.y += 0.04;
        dummy.lookAt(dummy.position.clone().add(s.tangent));
        dummy.scale.set(1, 1, 1);
        dummy.updateMatrix();
        studs.setMatrixAt(stIdx++, dummy.matrix);
      }
    }
    studs.count = stIdx;
    studs.instanceMatrix.needsUpdate = true;
    studs.computeBoundingSphere();
    group.add(studs);

    // 4. Overhead Illuminated Expressway Gantries
    const gantryTex = trackTex(createHighwayGantryTexture(maxAnisotropy));
    const hwGantryMat = trackMat(
      new THREE.MeshStandardMaterial({
        map: gantryTex,
        emissiveMap: gantryTex,
        emissive: 0xffffff,
        emissiveIntensity: 0.9,
        side: THREE.DoubleSide,
      })
    );
    const hwSignGeo = trackGeo(new THREE.PlaneGeometry(14, 3.2));
    const hwBeamGeo = trackGeo(new THREE.BoxGeometry(config.trackWidth + 5, 0.5, 0.5));
    const hwPillarGeo = trackGeo(new THREE.BoxGeometry(0.55, 8.5, 0.55));
    for (let i = 75; i < segments - 40; i += 90) {
      const s = samples[i];
      const hwG = new THREE.Group();
      hwG.position.copy(s.point);
      hwG.rotation.y = Math.atan2(s.tangent.x, s.tangent.z);

      for (const sx of [-1, 1]) {
        const p = new THREE.Mesh(hwPillarGeo, steelMat);
        p.position.set(sx * (halfW + 2.2), 4.25, 0);
        hwG.add(p);
      }
      const b = new THREE.Mesh(hwBeamGeo, steelMat);
      b.position.set(0, 8.3, 0);
      hwG.add(b);

      const sign = new THREE.Mesh(hwSignGeo, hwGantryMat);
      sign.position.set(0, 8.2, -0.35);
      hwG.add(sign);
      group.add(hwG);
    }
  } else if (config.id === 'coastal') {
    const palmCount = 200;
    const trunkGeo = trackGeo(new THREE.CylinderGeometry(0.22, 0.36, 7.0, 7));
    trunkGeo.translate(0, 3.5, 0);
    const trunkMat = trackMat(new THREE.MeshStandardMaterial({ color: 0x7c5836, roughness: 0.9 }));
    const canopyGeo = trackGeo(new THREE.ConeGeometry(3.2, 2.2, 7));
    canopyGeo.translate(0, 7.2, 0);
    const canopyMat = trackMat(new THREE.MeshStandardMaterial({ color: 0x16a34a, roughness: 0.78 }));

    const trunks = new THREE.InstancedMesh(trunkGeo, trunkMat, palmCount);
    const canopies = new THREE.InstancedMesh(canopyGeo, canopyMat, palmCount);
    trunks.castShadow = !isSoftwareGl;
    canopies.castShadow = !isSoftwareGl;

    let placed = 0;
    let attempts = 0;
    while (placed < palmCount && attempts < 1800) {
      attempts++;
      const a = Math.random() * Math.PI * 2;
      const r = 45 + Math.random() * 290;
      const px = Math.cos(a) * r;
      const pz = Math.sin(a) * r - 140;
      if (isNearTrack(px, pz, halfW + 12)) continue;

      const py = getApproxGroundY(px, pz);
      if (py < -0.5) continue;
      const scale = 0.8 + Math.random() * 0.55;
      dummy.position.set(px, py - 0.2, pz);
      dummy.rotation.set((Math.random() - 0.5) * 0.14, Math.random() * Math.PI * 2, (Math.random() - 0.5) * 0.14);
      dummy.scale.set(scale, scale, scale);
      dummy.updateMatrix();
      trunks.setMatrixAt(placed, dummy.matrix);
      canopies.setMatrixAt(placed, dummy.matrix);
      placed++;
    }
    trunks.count = placed;
    canopies.count = placed;
    trunks.instanceMatrix.needsUpdate = true;
    canopies.instanceMatrix.needsUpdate = true;
    trunks.computeBoundingSphere();
    canopies.computeBoundingSphere();
    group.add(trunks, canopies);
  }

  const tmpDelta = new THREE.Vector3();
  const sampleNearest = (pos: THREE.Vector3, hintIndex?: number) => {
    let bestIdx = 0;
    let bestDistSq = Infinity;

    if (hintIndex !== undefined && hintIndex >= 0 && hintIndex < segments) {
      const windowRadius = 26;
      for (let offset = -windowRadius; offset <= windowRadius; offset++) {
        const idx = (hintIndex + offset + segments) % segments;
        const p = samples[idx].point;
        const dx = pos.x - p.x;
        const dz = pos.z - p.z;
        const d2 = dx * dx + dz * dz;
        if (d2 < bestDistSq) {
          bestDistSq = d2;
          bestIdx = idx;
        }
      }
      if (bestDistSq > 1600) {
        bestDistSq = Infinity;
        for (let i = 0; i < segments; i++) {
          const p = samples[i].point;
          const dx = pos.x - p.x;
          const dz = pos.z - p.z;
          const d2 = dx * dx + dz * dz;
          if (d2 < bestDistSq) {
            bestDistSq = d2;
            bestIdx = i;
          }
        }
      }
    } else {
      for (let i = 0; i < segments; i++) {
        const p = samples[i].point;
        const dx = pos.x - p.x;
        const dz = pos.z - p.z;
        const d2 = dx * dx + dz * dz;
        if (d2 < bestDistSq) {
          bestDistSq = d2;
          bestIdx = i;
        }
      }
    }

    const sample = samples[bestIdx];
    tmpDelta.subVectors(pos, sample.point);
    const signedOffset = tmpDelta.x * sample.right.x + tmpDelta.z * sample.right.z;
    return {
      index: bestIdx,
      sample,
      distFromCenter: Math.abs(signedOffset),
      signedOffset,
    };
  };

  return {
    group,
    samples,
    lampPositions,
    totalLength,
    minimapPoints,
    minimapBounds,
    update: (dt: number) => {
      if (waterNormalTex) {
        waterNormalTex.offset.x = (waterNormalTex.offset.x + dt * 0.04) % 1;
        waterNormalTex.offset.y = (waterNormalTex.offset.y + dt * 0.025) % 1;
      }
    },
    sampleNearest,
    dispose: () => {
      geometries.forEach((g) => g.dispose());
      materials.forEach((m) => m.dispose());
      textures.forEach((t) => t.dispose());
    },
  };
}
