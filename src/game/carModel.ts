import * as THREE from 'three';
import {
  LiveDashTexture,
  createCarbonTexture,
  createCockpitDashTexture,
  createContactShadowTexture,
  createLeatherTexture,
} from './textures';

export interface CarRig {
  root: THREE.Group;
  bodyTiltGroup: THREE.Group;
  paintMaterial: THREE.MeshPhysicalMaterial;
  tailLightMaterial: THREE.MeshStandardMaterial;
  headLightMaterial: THREE.MeshStandardMaterial;
  brakeDiscMaterial: THREE.MeshStandardMaterial;
  steeringWheel: THREE.Group;
  nitroFlames: THREE.Mesh[];
  frontLeftSteer: THREE.Group;
  frontRightSteer: THREE.Group;
  wheelsSpin: THREE.Group[];
  headLightLeft?: THREE.SpotLight;
  headLightRight?: THREE.SpotLight;
  headlightBeams?: THREE.Group;
  cockpitEyeAnchor?: THREE.Object3D;
  cockpitLookAnchor?: THREE.Object3D;
  updateDash?: (speedKmh: number, gear: number, rpmRatio: number, nitro: number) => void;
  dispose: () => void;
}

export function createSupercarRig(options: {
  paintHex: number;
  accentHex: number;
  isPlayer: boolean;
  isSoftwareGl: boolean;
  maxAnisotropy?: number;
}): CarRig {
  const { paintHex, accentHex, isPlayer, isSoftwareGl, maxAnisotropy = 4 } = options;

  const root = new THREE.Group();
  const bodyTiltGroup = new THREE.Group();
  root.add(bodyTiltGroup);

  const geometries: THREE.BufferGeometry[] = [];
  const materials: THREE.Material[] = [];
  const textures: THREE.Texture[] = [];

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

  const carbonTex = trackTex(createCarbonTexture(maxAnisotropy));
  const leatherTex = trackTex(createLeatherTexture(maxAnisotropy));

  const paintMaterial = trackMat(
    new THREE.MeshPhysicalMaterial({
      color: paintHex,
      metalness: 0.84,
      roughness: 0.19,
      clearcoat: 1.0,
      clearcoatRoughness: 0.06,
      iridescence: 0.12,
      iridescenceIOR: 1.35,
      envMapIntensity: 1.75,
    })
  );

  const carbonMat = trackMat(
    new THREE.MeshStandardMaterial({
      map: carbonTex,
      color: 0xffffff,
      metalness: 0.35,
      roughness: 0.42,
      envMapIntensity: 1.2,
    })
  );

  const leatherMat = trackMat(
    new THREE.MeshStandardMaterial({
      map: leatherTex,
      color: 0xffffff,
      metalness: 0.05,
      roughness: 0.82,
    })
  );

  const matteTrimMat = trackMat(
    new THREE.MeshStandardMaterial({
      color: 0x10131a,
      metalness: 0.12,
      roughness: 0.74,
    })
  );

  const accentMat = trackMat(
    new THREE.MeshStandardMaterial({
      color: accentHex,
      metalness: 0.72,
      roughness: 0.22,
    })
  );

  const glassMat = trackMat(
    new THREE.MeshPhysicalMaterial({
      color: 0x0b1526,
      metalness: 0.08,
      roughness: 0.04,
      clearcoat: 1.0,
      clearcoatRoughness: 0.03,
      transparent: true,
      opacity: isPlayer ? 0.14 : 0.84,
      side: THREE.DoubleSide,
      depthWrite: false,
      envMapIntensity: 2.0,
    })
  );

  const chromeMat = trackMat(
    new THREE.MeshStandardMaterial({
      color: 0xe2e8f0,
      metalness: 0.96,
      roughness: 0.12,
      envMapIntensity: 1.6,
    })
  );

  const mirrorGlassMat = trackMat(
    new THREE.MeshStandardMaterial({
      color: 0x93c5fd,
      metalness: 0.98,
      roughness: 0.04,
      envMapIntensity: 2.2,
    })
  );

  const tireMat = trackMat(
    new THREE.MeshStandardMaterial({
      color: 0x14161b,
      metalness: 0.03,
      roughness: 0.88,
    })
  );

  const caliperMat = trackMat(
    new THREE.MeshStandardMaterial({
      color: 0xef4444,
      metalness: 0.45,
      roughness: 0.32,
    })
  );

  const brakeDiscMaterial = trackMat(
    new THREE.MeshStandardMaterial({
      color: 0x94a3b8,
      metalness: 0.85,
      roughness: 0.28,
      emissive: 0xff3b00,
      emissiveIntensity: 0,
    })
  );

  const headLightMaterial = trackMat(
    new THREE.MeshStandardMaterial({
      color: 0xffffff,
      emissive: 0xe0f2fe,
      emissiveIntensity: 3.4,
      roughness: 0.08,
      metalness: 0.1,
    })
  );

  const tailLightMaterial = trackMat(
    new THREE.MeshStandardMaterial({
      color: 0x7f1d1d,
      emissive: 0xff1e2d,
      emissiveIntensity: 1.6,
      roughness: 0.18,
      metalness: 0.1,
    })
  );

  // =========================================================================
  // 1. HOLLOW-CABIN SCULPTED CHASSIS (3 non-overlapping body sections!)
  //    Cabin zone z = [-0.68 .. +0.74], x = [-0.76 .. +0.76], y = [0.38 .. 1.22]
  //    is 100% open inside so interior & cockpit camera NEVER clip!
  // =========================================================================

  // 1A. Front Hood & Nose Bay (z = +0.74 to +2.29)
  const frontProfile = new THREE.Shape();
  frontProfile.moveTo(0.74, 0.28);
  frontProfile.lineTo(2.14, 0.25);
  frontProfile.lineTo(2.29, 0.42);
  frontProfile.quadraticCurveTo(2.16, 0.67, 1.46, 0.77);
  frontProfile.lineTo(0.74, 0.84);
  frontProfile.closePath();

  const bodyWidth = 1.84;
  const frontGeo = trackGeo(
    new THREE.ExtrudeGeometry(frontProfile, {
      depth: bodyWidth,
      bevelEnabled: true,
      bevelThickness: 0.12,
      bevelSize: 0.06,
      bevelSegments: 3,
      curveSegments: 10,
    })
  );
  frontGeo.rotateY(-Math.PI / 2);
  frontGeo.translate(bodyWidth / 2, 0, 0);
  frontGeo.computeVertexNormals();
  const frontMesh = new THREE.Mesh(frontGeo, paintMaterial);
  frontMesh.castShadow = true;
  frontMesh.receiveShadow = true;
  bodyTiltGroup.add(frontMesh);

  // 1B. Rear Engine Deck & Fascia (z = -2.28 to -0.68)
  const rearProfile = new THREE.Shape();
  rearProfile.moveTo(-2.15, 0.28);
  rearProfile.lineTo(-0.68, 0.28);
  rearProfile.lineTo(-0.68, 0.86);
  rearProfile.lineTo(-1.74, 0.86);
  rearProfile.lineTo(-2.22, 0.82);
  rearProfile.lineTo(-2.28, 0.44);
  rearProfile.closePath();

  const rearGeo = trackGeo(
    new THREE.ExtrudeGeometry(rearProfile, {
      depth: bodyWidth,
      bevelEnabled: true,
      bevelThickness: 0.12,
      bevelSize: 0.06,
      bevelSegments: 3,
      curveSegments: 8,
    })
  );
  rearGeo.rotateY(-Math.PI / 2);
  rearGeo.translate(bodyWidth / 2, 0, 0);
  rearGeo.computeVertexNormals();
  const rearMesh = new THREE.Mesh(rearGeo, paintMaterial);
  rearMesh.castShadow = true;
  rearMesh.receiveShadow = true;
  bodyTiltGroup.add(rearMesh);

  // 1C. Cabin Floor Pan (y = 0.26..0.38) + Outer Sculpted Doors (x = ±0.86, never blocking interior)
  const floorGeo = trackGeo(new THREE.BoxGeometry(1.94, 0.12, 1.56));
  const floorMesh = new THREE.Mesh(floorGeo, matteTrimMat);
  floorMesh.position.set(0, 0.31, 0.03);
  floorMesh.receiveShadow = true;
  bodyTiltGroup.add(floorMesh);

  const doorOuterGeo = trackGeo(new THREE.BoxGeometry(0.18, 0.56, 1.56));
  const sideSkirtGeo = trackGeo(new THREE.BoxGeometry(0.12, 0.09, 2.38));
  const sideVentGeo = trackGeo(new THREE.BoxGeometry(0.12, 0.24, 0.58));

  for (const sx of [-1, 1]) {
    const doorOuter = new THREE.Mesh(doorOuterGeo, paintMaterial);
    doorOuter.position.set(sx * 0.88, 0.58, 0.03);
    doorOuter.castShadow = true;
    doorOuter.receiveShadow = true;
    bodyTiltGroup.add(doorOuter);

    const skirt = new THREE.Mesh(sideSkirtGeo, carbonMat);
    skirt.position.set(sx * 0.99, 0.23, 0);
    bodyTiltGroup.add(skirt);

    const sideVent = new THREE.Mesh(sideVentGeo, carbonMat);
    sideVent.position.set(sx * 0.97, 0.56, -0.62);
    bodyTiltGroup.add(sideVent);
  }

  // Widebody Front & Rear Wheel Arch Fenders (placed cleanly outside cabin z-span)
  const frontArchGeo = trackGeo(new THREE.BoxGeometry(2.14, 0.34, 0.98));
  const frontArch = new THREE.Mesh(frontArchGeo, paintMaterial);
  frontArch.position.set(0, 0.56, 1.34);
  frontArch.castShadow = true;
  frontArch.receiveShadow = true;
  bodyTiltGroup.add(frontArch);

  const rearArchGeo = trackGeo(new THREE.BoxGeometry(2.14, 0.34, 0.98));
  const rearArch = new THREE.Mesh(rearArchGeo, paintMaterial);
  rearArch.position.set(0, 0.56, -1.32);
  rearArch.castShadow = true;
  rearArch.receiveShadow = true;
  bodyTiltGroup.add(rearArch);

  // Roof Canopy Shell (z = -0.66 to +0.26, y = 1.25)
  const roofGeo = trackGeo(new THREE.BoxGeometry(1.42, 0.06, 0.94));
  const roof = new THREE.Mesh(roofGeo, paintMaterial);
  roof.position.set(0, 1.26, -0.2);
  roof.castShadow = true;
  bodyTiltGroup.add(roof);

  if (isPlayer) {
    const linerGeo = trackGeo(new THREE.BoxGeometry(1.34, 0.025, 0.88));
    const liner = new THREE.Mesh(linerGeo, leatherMat);
    liner.position.set(0, 1.225, -0.2);
    bodyTiltGroup.add(liner);
  }

  const scoopGeo = trackGeo(new THREE.BoxGeometry(0.32, 0.08, 0.58));
  const scoop = new THREE.Mesh(scoopGeo, carbonMat);
  scoop.position.set(0, 1.32, -0.35);
  bodyTiltGroup.add(scoop);

  // Exact Windshield + A-Pillars connecting roof front (z=+0.26, y=1.25) to cowl (z=+0.76, y=0.85)
  // dz = 0.50, dy = 0.40 -> length = 0.64, angle = 0.674 rad
  const wsAngle = Math.atan2(0.4, 0.5);
  const wsLen = Math.hypot(0.5, 0.4);
  const wsCenterY = 1.05;
  const wsCenterZ = 0.51;

  const aPillarGeo = trackGeo(new THREE.BoxGeometry(0.06, 0.06, wsLen + 0.04));
  const bPillarGeo = trackGeo(new THREE.BoxGeometry(0.06, 0.42, 0.09));
  const roofRailGeo = trackGeo(new THREE.BoxGeometry(0.055, 0.055, 0.94));
  const cPillarGeo = trackGeo(new THREE.BoxGeometry(0.14, 0.08, 1.15));
  for (const sx of [-1, 1]) {
    const aPillar = new THREE.Mesh(aPillarGeo, leatherMat);
    aPillar.position.set(sx * 0.69, wsCenterY, wsCenterZ);
    aPillar.rotation.x = wsAngle;
    aPillar.rotation.y = sx * -0.05;
    bodyTiltGroup.add(aPillar);

    const bPillar = new THREE.Mesh(bPillarGeo, matteTrimMat);
    bPillar.position.set(sx * 0.72, 1.05, -0.58);
    bPillar.rotation.z = sx * 0.08;
    bodyTiltGroup.add(bPillar);

    const roofRail = new THREE.Mesh(roofRailGeo, matteTrimMat);
    roofRail.position.set(sx * 0.7, 1.24, -0.2);
    bodyTiltGroup.add(roofRail);

    const cPillar = new THREE.Mesh(cPillarGeo, paintMaterial);
    cPillar.position.set(sx * 0.66, 1.04, -1.24);
    cPillar.rotation.x = -0.38;
    cPillar.castShadow = true;
    bodyTiltGroup.add(cPillar);
  }

  const windshieldGeo = trackGeo(new THREE.PlaneGeometry(1.34, wsLen));
  const windshield = new THREE.Mesh(windshieldGeo, glassMat);
  windshield.position.set(0, wsCenterY, wsCenterZ);
  windshield.rotation.x = -Math.PI / 2 + wsAngle;
  windshield.renderOrder = 3;
  bodyTiltGroup.add(windshield);

  const sunStripGeo = trackGeo(new THREE.PlaneGeometry(1.32, 0.12));
  const sunStripMat = trackMat(
    new THREE.MeshBasicMaterial({
      color: 0x050810,
      transparent: true,
      opacity: 0.72,
      side: THREE.DoubleSide,
      depthWrite: false,
    })
  );
  const sunStrip = new THREE.Mesh(sunStripGeo, sunStripMat);
  sunStrip.position.set(0, 1.195, 0.33);
  sunStrip.rotation.x = -Math.PI / 2 + wsAngle;
  bodyTiltGroup.add(sunStrip);

  const rearGlassGeo = trackGeo(new THREE.PlaneGeometry(1.18, 1.05));
  const rearGlass = new THREE.Mesh(rearGlassGeo, glassMat);
  rearGlass.position.set(0, 1.04, -1.24);
  rearGlass.rotation.x = Math.PI / 2 - 0.38;
  rearGlass.renderOrder = 3;
  bodyTiltGroup.add(rearGlass);

  // =========================================================================
  // 2. FULL REALISTIC INTERIOR COCKPIT (Zero overlap, crisp driver framing!)
  // =========================================================================
  const steeringWheel = new THREE.Group();
  let dashLive: LiveDashTexture | null = null;
  let cockpitEyeAnchor: THREE.Object3D | undefined;
  let cockpitLookAnchor: THREE.Object3D | undefined;

  if (isPlayer) {
    // Upper Leather Dashboard Deck (z = +0.52 .. +0.76, y = 0.815 .. 0.89)
    const dashUpperGeo = trackGeo(new THREE.BoxGeometry(1.48, 0.075, 0.24));
    const dashUpper = new THREE.Mesh(dashUpperGeo, leatherMat);
    dashUpper.position.set(0, 0.855, 0.64);
    bodyTiltGroup.add(dashUpper);

    // Lower Carbon Dash & Footwell Firewall (z = +0.53 .. +0.75, y = 0.42 .. 0.82)
    const dashLowerGeo = trackGeo(new THREE.BoxGeometry(1.48, 0.4, 0.22));
    const dashLower = new THREE.Mesh(dashLowerGeo, carbonMat);
    dashLower.position.set(0, 0.62, 0.64);
    bodyTiltGroup.add(dashLower);

    // Driver Racing Pedals in Footwell
    const pedalGeo = trackGeo(new THREE.BoxGeometry(0.055, 0.11, 0.015));
    for (const [px, py] of [
      [0.29, 0.47],
      [0.39, 0.49],
    ]) {
      const pedal = new THREE.Mesh(pedalGeo, chromeMat);
      pedal.position.set(px, py, 0.51);
      pedal.rotation.x = -0.32;
      bodyTiltGroup.add(pedal);
    }

    // Unified Gauge Binnacle Group (prevents screen/hood tilt mismatch or z-fighting)
    const binnacleGroup = new THREE.Group();
    binnacleGroup.position.set(0.36, 0.905, 0.485);
    binnacleGroup.rotation.x = 0.09;

    const binnacleBackGeo = trackGeo(new THREE.BoxGeometry(0.4, 0.16, 0.03));
    const binnacleBack = new THREE.Mesh(binnacleBackGeo, matteTrimMat);
    binnacleGroup.add(binnacleBack);

    const binnacleTopGeo = trackGeo(new THREE.BoxGeometry(0.42, 0.024, 0.1));
    const binnacleTop = new THREE.Mesh(binnacleTopGeo, leatherMat);
    binnacleTop.position.set(0, 0.078, -0.035);
    binnacleGroup.add(binnacleTop);

    const cheekGeo = trackGeo(new THREE.BoxGeometry(0.022, 0.14, 0.08));
    for (const cx of [-0.19, 0.19]) {
      const cheek = new THREE.Mesh(cheekGeo, leatherMat);
      cheek.position.set(cx, 0.005, -0.03);
      binnacleGroup.add(cheek);
    }

    // Live Animated Digital Gauge Cluster Screen mounted cleanly in front of backing plate
    dashLive = createCockpitDashTexture(maxAnisotropy);
    textures.push(dashLive.texture);
    const dashScreenGeo = trackGeo(new THREE.PlaneGeometry(0.35, 0.13));
    const dashScreenMat = trackMat(
      new THREE.MeshBasicMaterial({
        map: dashLive.texture,
      })
    );
    const dashScreen = new THREE.Mesh(dashScreenGeo, dashScreenMat);
    dashScreen.position.set(0, 0, -0.017);
    dashScreen.rotation.y = Math.PI;
    binnacleGroup.add(dashScreen);
    bodyTiltGroup.add(binnacleGroup);

    // Unified Center Console Infotainment Panel (same parent group -> zero clipping)
    const centerGroup = new THREE.Group();
    centerGroup.position.set(0, 0.77, 0.495);
    centerGroup.rotation.x = 0.16;

    const centerFrameGeo = trackGeo(new THREE.BoxGeometry(0.27, 0.17, 0.03));
    const centerFrame = new THREE.Mesh(centerFrameGeo, matteTrimMat);
    centerGroup.add(centerFrame);

    const centerScreenGeo = trackGeo(new THREE.PlaneGeometry(0.23, 0.135));
    const centerScreenMat = trackMat(
      new THREE.MeshBasicMaterial({
        color: 0x0b1628,
      })
    );
    const centerScreen = new THREE.Mesh(centerScreenGeo, centerScreenMat);
    centerScreen.position.set(0, 0, -0.017);
    centerScreen.rotation.y = Math.PI;
    centerGroup.add(centerScreen);

    // Crisp horizontal accent line on infotainment screen
    const infoBarGeo = trackGeo(new THREE.PlaneGeometry(0.19, 0.012));
    const infoBarMat = trackMat(new THREE.MeshBasicMaterial({ color: 0x38bdf8 }));
    const infoBar = new THREE.Mesh(infoBarGeo, infoBarMat);
    infoBar.position.set(0, 0.04, -0.018);
    infoBar.rotation.y = Math.PI;
    centerGroup.add(infoBar);

    bodyTiltGroup.add(centerGroup);

    // Metallic A/C Vents on dash face (clear of center frame & binnacle & A-pillars)
    const ventRingGeo = trackGeo(new THREE.TorusGeometry(0.032, 0.007, 8, 16));
    for (const vx of [-0.55, -0.22, 0.62]) {
      const vent = new THREE.Mesh(ventRingGeo, chromeMat);
      vent.position.set(vx, 0.805, 0.512);
      bodyTiltGroup.add(vent);
    }

    // Center Tunnel + Sequential Shifter + Red Start/Stop Engine Button
    const tunnelGeo = trackGeo(new THREE.BoxGeometry(0.24, 0.22, 1.12));
    const tunnel = new THREE.Mesh(tunnelGeo, carbonMat);
    tunnel.position.set(0, 0.48, -0.02);
    bodyTiltGroup.add(tunnel);

    const shifterStickGeo = trackGeo(new THREE.CylinderGeometry(0.014, 0.018, 0.16, 10));
    const shifterStick = new THREE.Mesh(shifterStickGeo, chromeMat);
    shifterStick.position.set(0, 0.66, 0.16);
    shifterStick.rotation.x = -0.15;
    bodyTiltGroup.add(shifterStick);

    const shifterKnobGeo = trackGeo(new THREE.SphereGeometry(0.028, 12, 12));
    const shifterKnob = new THREE.Mesh(shifterKnobGeo, carbonMat);
    shifterKnob.position.set(0, 0.74, 0.15);
    bodyTiltGroup.add(shifterKnob);

    const startBtnGeo = trackGeo(new THREE.CylinderGeometry(0.018, 0.018, 0.014, 12));
    const startBtnMat = trackMat(
      new THREE.MeshStandardMaterial({
        color: 0xef4444,
        emissive: 0xdc2626,
        emissiveIntensity: 1.6,
      })
    );
    const startBtn = new THREE.Mesh(startBtnGeo, startBtnMat);
    startBtn.position.set(0.06, 0.595, 0.28);
    bodyTiltGroup.add(startBtn);

    // Steering Column & Ergonomic GT Racing Wheel (positioned below cluster sightline!)
    const columnGeo = trackGeo(new THREE.CylinderGeometry(0.034, 0.04, 0.28, 12));
    columnGeo.rotateX(Math.PI / 2);
    const column = new THREE.Mesh(columnGeo, matteTrimMat);
    column.position.set(0.36, 0.805, 0.37);
    column.rotation.x = 0.15;
    bodyTiltGroup.add(column);

    steeringWheel.position.set(0.36, 0.78, 0.235);
    steeringWheel.rotation.x = -0.22;

    const wheelRimGeo = trackGeo(new THREE.TorusGeometry(0.135, 0.02, 12, 28));
    const wheelRim = new THREE.Mesh(wheelRimGeo, leatherMat);
    steeringWheel.add(wheelRim);

    const spokeHorizGeo = trackGeo(new THREE.BoxGeometry(0.23, 0.038, 0.02));
    const spokeHoriz = new THREE.Mesh(spokeHorizGeo, carbonMat);
    spokeHoriz.position.set(0, -0.015, 0);
    steeringWheel.add(spokeHoriz);

    const spokeVertGeo = trackGeo(new THREE.BoxGeometry(0.044, 0.105, 0.02));
    const spokeVert = new THREE.Mesh(spokeVertGeo, carbonMat);
    spokeVert.position.set(0, -0.068, 0);
    steeringWheel.add(spokeVert);

    const wheelHubGeo = trackGeo(new THREE.CylinderGeometry(0.042, 0.042, 0.028, 16));
    wheelHubGeo.rotateX(Math.PI / 2);
    const wheelHub = new THREE.Mesh(wheelHubGeo, matteTrimMat);
    steeringWheel.add(wheelHub);

    const topStripeGeo = trackGeo(new THREE.BoxGeometry(0.022, 0.032, 0.042));
    const topStripe = new THREE.Mesh(topStripeGeo, accentMat);
    topStripe.position.set(0, 0.135, 0);
    steeringWheel.add(topStripe);

    const dialGeo = trackGeo(new THREE.CylinderGeometry(0.01, 0.01, 0.016, 10));
    dialGeo.rotateX(Math.PI / 2);
    const dialColors = [0x38bdf8, 0xf59e0b, 0xef4444];
    [-0.058, 0, 0.058].forEach((dx, i) => {
      const dMat = trackMat(
        new THREE.MeshStandardMaterial({
          color: dialColors[i],
          emissive: dialColors[i],
          emissiveIntensity: 0.85,
        })
      );
      const dial = new THREE.Mesh(dialGeo, dMat);
      dial.position.set(dx, -0.018, -0.016);
      steeringWheel.add(dial);
    });

    const paddleGeo = trackGeo(new THREE.BoxGeometry(0.028, 0.098, 0.008));
    for (const px of [-0.088, 0.088]) {
      const paddle = new THREE.Mesh(paddleGeo, chromeMat);
      paddle.position.set(px, 0.018, 0.022);
      paddle.rotation.z = px > 0 ? -0.15 : 0.15;
      steeringWheel.add(paddle);
    }

    bodyTiltGroup.add(steeringWheel);

    // Interior Door Cards (against inner door walls at x = ±0.76)
    const doorCardGeo = trackGeo(new THREE.BoxGeometry(0.05, 0.38, 1.25));
    const armrestGeo = trackGeo(new THREE.BoxGeometry(0.09, 0.06, 0.72));
    for (const sx of [-1, 1]) {
      const door = new THREE.Mesh(doorCardGeo, leatherMat);
      door.position.set(sx * 0.76, 0.62, 0.02);
      bodyTiltGroup.add(door);

      const arm = new THREE.Mesh(armrestGeo, carbonMat);
      arm.position.set(sx * 0.72, 0.61, 0.06);
      bodyTiltGroup.add(arm);
    }

    // Interior Rear-View Mirror (glass parented to housing so it rotates cleanly)
    const rvmStalkGeo = trackGeo(new THREE.CylinderGeometry(0.01, 0.01, 0.06, 8));
    const rvmStalk = new THREE.Mesh(rvmStalkGeo, matteTrimMat);
    rvmStalk.position.set(0, 1.2, 0.25);
    bodyTiltGroup.add(rvmStalk);

    const rvmHousingGeo = trackGeo(new THREE.BoxGeometry(0.22, 0.052, 0.036));
    const rvmHousing = new THREE.Mesh(rvmHousingGeo, matteTrimMat);
    rvmHousing.position.set(0, 1.175, 0.25);
    rvmHousing.rotation.y = -0.14;

    const rvmGlassGeo = trackGeo(new THREE.PlaneGeometry(0.195, 0.04));
    const rvmGlass = new THREE.Mesh(rvmGlassGeo, mirrorGlassMat);
    rvmGlass.position.set(0, 0, -0.019);
    rvmGlass.rotation.y = Math.PI;
    rvmHousing.add(rvmGlass);
    bodyTiltGroup.add(rvmHousing);

    // Bucket seats (placed cleanly behind driver eye z = -0.16)
    const seatBackGeo = trackGeo(new THREE.BoxGeometry(0.46, 0.62, 0.14));
    const seatBolsterGeo = trackGeo(new THREE.BoxGeometry(0.5, 0.14, 0.44));
    for (const sx of [-0.36, 0.36]) {
      const sBack = new THREE.Mesh(seatBackGeo, leatherMat);
      sBack.position.set(sx, 0.72, -0.45);
      sBack.rotation.x = -0.18;
      bodyTiltGroup.add(sBack);

      const sBase = new THREE.Mesh(seatBolsterGeo, leatherMat);
      sBase.position.set(sx, 0.43, -0.24);
      bodyTiltGroup.add(sBase);
    }

    // Exact Driver Cockpit Camera Anchors locked to bodyTiltGroup suspension
    cockpitEyeAnchor = new THREE.Object3D();
    cockpitEyeAnchor.position.set(0.36, 1.07, -0.16);
    bodyTiltGroup.add(cockpitEyeAnchor);

    cockpitLookAnchor = new THREE.Object3D();
    cockpitLookAnchor.position.set(0.24, 0.96, 24.0);
    bodyTiltGroup.add(cockpitLookAnchor);
  }

  // =========================================================================
  // 3. EXTERIOR AERO, WING, MIRRORS, LIGHTS & WHEELS
  // =========================================================================
  const splitterGeo = trackGeo(new THREE.BoxGeometry(2.12, 0.06, 0.58));
  const splitter = new THREE.Mesh(splitterGeo, carbonMat);
  splitter.position.set(0, 0.22, 2.1);
  splitter.castShadow = true;
  bodyTiltGroup.add(splitter);

  const diffuserGeo = trackGeo(new THREE.BoxGeometry(1.9, 0.22, 0.44));
  const diffuser = new THREE.Mesh(diffuserGeo, carbonMat);
  diffuser.position.set(0, 0.29, -2.14);
  bodyTiltGroup.add(diffuser);

  const stripeGeo = trackGeo(new THREE.BoxGeometry(0.22, 0.018, 1.48));
  const stripe = new THREE.Mesh(stripeGeo, accentMat);
  stripe.position.set(0, 0.77, 1.48);
  stripe.rotation.x = 0.085;
  bodyTiltGroup.add(stripe);

  const wingGeo = trackGeo(new THREE.BoxGeometry(2.18, 0.055, 0.38));
  const wing = new THREE.Mesh(wingGeo, carbonMat);
  wing.position.set(0, 1.24, -2.14);
  wing.rotation.x = -0.14;
  wing.castShadow = true;
  bodyTiltGroup.add(wing);

  const endplateGeo = trackGeo(new THREE.BoxGeometry(0.05, 0.25, 0.46));
  const pylonGeo = trackGeo(new THREE.BoxGeometry(0.05, 0.36, 0.18));
  for (const sx of [-1, 1]) {
    const endplate = new THREE.Mesh(endplateGeo, paintMaterial);
    endplate.position.set(sx * 1.09, 1.23, -2.14);
    bodyTiltGroup.add(endplate);

    const pylon = new THREE.Mesh(pylonGeo, carbonMat);
    pylon.position.set(sx * 0.48, 1.03, -2.06);
    pylon.rotation.x = -0.22;
    bodyTiltGroup.add(pylon);
  }

  // Sculpted Side Wing Mirrors (mirror glass parented cleanly inside housing)
  const mirrorGeo = trackGeo(new THREE.BoxGeometry(0.24, 0.095, 0.14));
  const wingMirrorGlassGeo = trackGeo(new THREE.PlaneGeometry(0.21, 0.075));
  for (const sx of [-1, 1]) {
    const mirror = new THREE.Mesh(mirrorGeo, carbonMat);
    mirror.position.set(sx * 1.03, 0.91, 0.54);
    mirror.rotation.y = sx * -0.2;

    if (isPlayer) {
      const mGlass = new THREE.Mesh(wingMirrorGlassGeo, mirrorGlassMat);
      mGlass.position.set(0, 0, -0.072);
      mGlass.rotation.y = Math.PI;
      mirror.add(mGlass);
    }
    bodyTiltGroup.add(mirror);
  }

  // Quad Chrome Exhaust Pipes + Nitro Flame Cones
  const exhaustGeo = trackGeo(new THREE.CylinderGeometry(0.075, 0.085, 0.28, 14));
  exhaustGeo.rotateX(Math.PI / 2);
  const flameGeo = trackGeo(new THREE.ConeGeometry(0.11, 0.85, 10));
  flameGeo.rotateX(-Math.PI / 2);
  const flameMat = trackMat(
    new THREE.MeshBasicMaterial({
      color: 0x38bdf8,
      transparent: true,
      opacity: 0.92,
    })
  );
  const nitroFlames: THREE.Mesh[] = [];

  for (const ex of [-0.52, -0.34, 0.34, 0.52]) {
    const pipe = new THREE.Mesh(exhaustGeo, chromeMat);
    pipe.position.set(ex, 0.32, -2.29);
    bodyTiltGroup.add(pipe);

    if (Math.abs(ex) > 0.45) {
      const flame = new THREE.Mesh(flameGeo, flameMat);
      flame.position.set(ex, 0.32, -2.74);
      flame.visible = false;
      bodyTiltGroup.add(flame);
      nitroFlames.push(flame);
    }
  }

  // Front Grille & LED Headlights
  const grilleGeo = trackGeo(new THREE.BoxGeometry(1.22, 0.2, 0.08));
  const grille = new THREE.Mesh(grilleGeo, matteTrimMat);
  grille.position.set(0, 0.38, 2.28);
  bodyTiltGroup.add(grille);

  const headGeo = trackGeo(new THREE.BoxGeometry(0.38, 0.08, 0.14));
  for (const sx of [-1, 1]) {
    const head = new THREE.Mesh(headGeo, headLightMaterial);
    head.position.set(sx * 0.75, 0.56, 2.2);
    head.rotation.y = sx * -0.22;
    bodyTiltGroup.add(head);
  }

  // Rear Full-Width LED Tail Light Bar
  const tailGeo = trackGeo(new THREE.BoxGeometry(1.8, 0.085, 0.08));
  const tailBar = new THREE.Mesh(tailGeo, tailLightMaterial);
  tailBar.position.set(0, 0.72, -2.28);
  bodyTiltGroup.add(tailBar);

  let headLightLeft: THREE.SpotLight | undefined;
  let headLightRight: THREE.SpotLight | undefined;
  let headlightBeams: THREE.Group | undefined;

  if (isPlayer) {
    headLightLeft = new THREE.SpotLight(0xe0f2fe, 0, 175, Math.PI / 4.8, 0.65, 1.0);
    headLightLeft.position.set(0.68, 0.68, 2.18);
    headLightLeft.target.position.set(0.5, -0.2, 28);
    bodyTiltGroup.add(headLightLeft);
    bodyTiltGroup.add(headLightLeft.target);

    headLightRight = new THREE.SpotLight(0xe0f2fe, 0, 175, Math.PI / 4.8, 0.65, 1.0);
    headLightRight.position.set(-0.68, 0.68, 2.18);
    headLightRight.target.position.set(-0.5, -0.2, 28);
    bodyTiltGroup.add(headLightRight);
    bodyTiltGroup.add(headLightRight.target);

    headlightBeams = new THREE.Group();
    const beamConeGeo = trackGeo(new THREE.ConeGeometry(4.2, 22, 16, 1, true));
    beamConeGeo.translate(0, -11, 0);
    beamConeGeo.rotateX(Math.PI / 2);
    const beamConeMat = trackMat(
      new THREE.MeshBasicMaterial({
        color: 0xdbeafe,
        transparent: true,
        opacity: 0.075,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
      })
    );
    for (const bx of [-0.72, 0.72]) {
      const cone = new THREE.Mesh(beamConeGeo, beamConeMat);
      cone.position.set(bx, 0.56, 2.25);
      headlightBeams.add(cone);
    }
    headlightBeams.visible = false;
    bodyTiltGroup.add(headlightBeams);
  }

  // Four Articulated Wheel Assemblies
  const wheelRadius = 0.38;
  const tireWidth = 0.33;
  const tireGeo = trackGeo(new THREE.CylinderGeometry(wheelRadius, wheelRadius, tireWidth, 26));
  tireGeo.rotateZ(Math.PI / 2);

  const rimGeo = trackGeo(new THREE.CylinderGeometry(0.26, 0.26, tireWidth + 0.02, 18));
  rimGeo.rotateZ(Math.PI / 2);

  const spokeGeo = trackGeo(new THREE.BoxGeometry(tireWidth + 0.03, 0.46, 0.04));
  const discGeo = trackGeo(new THREE.CylinderGeometry(0.21, 0.21, 0.05, 18));
  discGeo.rotateZ(Math.PI / 2);
  const caliperGeo = trackGeo(new THREE.BoxGeometry(0.085, 0.16, 0.11));

  const frontLeftSteer = new THREE.Group();
  frontLeftSteer.position.set(0.97, wheelRadius, 1.34);
  root.add(frontLeftSteer);

  const frontRightSteer = new THREE.Group();
  frontRightSteer.position.set(-0.97, wheelRadius, 1.34);
  root.add(frontRightSteer);

  const wheelsSpin: THREE.Group[] = [];

  const createWheel = (parent: THREE.Group, sideSign: number, isRear: boolean) => {
    const spinGroup = new THREE.Group();
    if (isRear) {
      spinGroup.position.set(sideSign * 0.99, wheelRadius, -1.32);
      root.add(spinGroup);
    } else {
      parent.add(spinGroup);
    }

    const tire = new THREE.Mesh(tireGeo, tireMat);
    tire.castShadow = true;
    spinGroup.add(tire);

    const rim = new THREE.Mesh(rimGeo, matteTrimMat);
    spinGroup.add(rim);

    for (let s = 0; s < 5; s++) {
      const spoke = new THREE.Mesh(spokeGeo, chromeMat);
      spoke.rotation.x = (s / 5) * Math.PI;
      spinGroup.add(spoke);
    }

    const disc = new THREE.Mesh(discGeo, brakeDiscMaterial);
    disc.position.x = -sideSign * 0.04;
    spinGroup.add(disc);

    const caliper = new THREE.Mesh(caliperGeo, caliperMat);
    if (isRear) {
      caliper.position.set(sideSign * 0.95, wheelRadius + 0.06, -1.16);
      root.add(caliper);
    } else {
      caliper.position.set(-sideSign * 0.04, 0.06, 0.15);
      parent.add(caliper);
    }

    wheelsSpin.push(spinGroup);
  };

  createWheel(frontLeftSteer, 1, false);
  createWheel(frontRightSteer, -1, false);
  createWheel(root, 1, true);
  createWheel(root, -1, true);

  // Contact Shadow Plane
  const shadowTex = trackTex(createContactShadowTexture());
  const contactShadowMat = trackMat(
    new THREE.MeshBasicMaterial({
      map: shadowTex,
      transparent: true,
      opacity: 0.68,
      depthWrite: false,
    })
  );
  const contactShadowGeo = trackGeo(new THREE.PlaneGeometry(2.85, 5.2));
  contactShadowGeo.rotateX(-Math.PI / 2);
  const contactShadow = new THREE.Mesh(contactShadowGeo, contactShadowMat);
  contactShadow.position.y = 0.025;
  root.add(contactShadow);

  return {
    root,
    bodyTiltGroup,
    paintMaterial,
    tailLightMaterial,
    headLightMaterial,
    brakeDiscMaterial,
    steeringWheel,
    nitroFlames,
    frontLeftSteer,
    frontRightSteer,
    wheelsSpin,
    headLightLeft,
    headLightRight,
    headlightBeams,
    cockpitEyeAnchor,
    cockpitLookAnchor,
    updateDash: dashLive ? dashLive.update : undefined,
    dispose: () => {
      geometries.forEach((g) => g.dispose());
      materials.forEach((m) => m.dispose());
      textures.forEach((t) => t.dispose());
    },
  };
}
