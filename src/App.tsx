import { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronRight, Play } from 'lucide-react';
import { RaceHUD } from './components/RaceHUD';
import { RacingEngine } from './game/RacingEngine';
import { MAP_LIST } from './game/maps';
import {
  CAMERA_OPTIONS,
  CAR_COLORS,
  CameraMode,
  ControlInput,
  MapId,
  RaceTelemetry,
} from './game/types';

const INITIAL_TELEMETRY: RaceTelemetry = {
  speedKmh: 0,
  rpmRatio: 0.18,
  gear: 1,
  nitro: 100,
  isNitroActive: false,
  isDrifting: false,
  isOffRoad: false,
  lap: 1,
  totalLaps: 3,
  position: 1,
  totalRacers: 4,
  lapTimeMs: 0,
  bestLapMs: null,
  totalTimeMs: 0,
  countdown: 0,
  raceFinished: false,
  minimapTrack: [],
  minimapEntities: [],
};

export default function App() {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const engineRef = useRef<RacingEngine | null>(null);

  const [isPlaying, setIsPlaying] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [currentMap, setCurrentMap] = useState<MapId>('alpine');
  const [cameraMode, setCameraMode] = useState<CameraMode>('chase');
  const [carColorId, setCarColorId] = useState<string>(CAR_COLORS[0].id);
  const [isMuted, setIsMuted] = useState(false);
  const [contextLost, setContextLost] = useState(false);
  const [telemetry, setTelemetry] = useState<RaceTelemetry>(INITIAL_TELEMETRY);

  const isPlayingRef = useRef(isPlaying);
  isPlayingRef.current = isPlaying;

  useEffect(() => {
    const container = mountRef.current;
    if (!container) return;

    const initialColor = CAR_COLORS[0];
    const engine = new RacingEngine({
      container,
      initialMap: 'alpine',
      initialColorHex: initialColor.hex,
      initialAccentHex: initialColor.accentHex,
      onTelemetry: (t) => setTelemetry(t),
      onContextStatus: (lost) => setContextLost(lost),
    });
    engineRef.current = engine;

    return () => {
      engine.dispose();
      engineRef.current = null;
    };
  }, []);

  const handleSelectMap = useCallback((mapId: MapId) => {
    setCurrentMap(mapId);
    setIsPaused(false);
    engineRef.current?.loadMap(mapId, isPlayingRef.current);
  }, []);

  const handleSelectCamera = useCallback((mode: CameraMode) => {
    setCameraMode(mode);
    engineRef.current?.setCameraMode(mode);
  }, []);

  const handleSelectColor = useCallback((id: string) => {
    const found = CAR_COLORS.find((c) => c.id === id);
    if (!found) return;
    setCarColorId(id);
    engineRef.current?.setCarColor(found.hex, found.accentHex);
  }, []);

  const handleStartRace = useCallback(() => {
    setIsPlaying(true);
    setIsPaused(false);
    engineRef.current?.startRace();
  }, []);

  const handleRestartRace = useCallback(() => {
    setIsPaused(false);
    engineRef.current?.startRace();
  }, []);

  const handleTogglePause = useCallback(() => {
    setIsPaused((prev) => {
      const next = !prev;
      engineRef.current?.setPaused(next);
      return next;
    });
  }, []);

  const handleToggleMute = useCallback(() => {
    setIsMuted((prev) => {
      const next = !prev;
      engineRef.current?.setMuted(next);
      return next;
    });
  }, []);

  const handleResetCar = useCallback(() => {
    engineRef.current?.resetCarToTrack();
  }, []);

  const handleTouchInput = useCallback((partial: Partial<ControlInput>) => {
    engineRef.current?.setInput(partial);
  }, []);

  // Keyboard bindings
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const code = e.code;
      const engine = engineRef.current;
      if (!engine) return;

      if (code === 'KeyW' || code === 'ArrowUp') {
        engine.setInput({ throttle: true });
      } else if (code === 'KeyS' || code === 'ArrowDown') {
        engine.setInput({ brake: true });
      } else if (code === 'KeyA' || code === 'ArrowLeft') {
        engine.setInput({ left: true });
      } else if (code === 'KeyD' || code === 'ArrowRight') {
        engine.setInput({ right: true });
      } else if (code === 'Space') {
        if (isPlayingRef.current) e.preventDefault();
        engine.setInput({ handbrake: true });
      } else if (code === 'ShiftLeft' || code === 'ShiftRight' || code === 'KeyN') {
        engine.setInput({ nitro: true });
      } else if (code === 'KeyC' && !e.repeat) {
        const nextCam = engine.cycleCamera();
        setCameraMode(nextCam);
      } else if (code === 'Digit1') {
        handleSelectCamera(CAMERA_OPTIONS[0].id);
      } else if (code === 'Digit2') {
        handleSelectCamera(CAMERA_OPTIONS[1].id);
      } else if (code === 'Digit3') {
        handleSelectCamera(CAMERA_OPTIONS[2].id);
      } else if (code === 'Digit4') {
        handleSelectCamera(CAMERA_OPTIONS[3].id);
      } else if (code === 'Digit5') {
        handleSelectCamera(CAMERA_OPTIONS[4].id);
      } else if (code === 'Digit6') {
        handleSelectCamera(CAMERA_OPTIONS[5].id);
      } else if (code === 'KeyR' && !e.repeat && isPlayingRef.current) {
        engine.resetCarToTrack();
      } else if (code === 'Escape' && !e.repeat && isPlayingRef.current) {
        handleTogglePause();
      }
    };

    const onKeyUp = (e: KeyboardEvent) => {
      const code = e.code;
      const engine = engineRef.current;
      if (!engine) return;

      if (code === 'KeyW' || code === 'ArrowUp') {
        engine.setInput({ throttle: false });
      } else if (code === 'KeyS' || code === 'ArrowDown') {
        engine.setInput({ brake: false });
      } else if (code === 'KeyA' || code === 'ArrowLeft') {
        engine.setInput({ left: false });
      } else if (code === 'KeyD' || code === 'ArrowRight') {
        engine.setInput({ right: false });
      } else if (code === 'Space') {
        engine.setInput({ handbrake: false });
      } else if (code === 'ShiftLeft' || code === 'ShiftRight' || code === 'KeyN') {
        engine.setInput({ nitro: false });
      }
    };

    const onBlur = () => {
      engineRef.current?.setInput({
        throttle: false,
        brake: false,
        left: false,
        right: false,
        handbrake: false,
        nitro: false,
      });
    };

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
    };
  }, [handleSelectCamera, handleTogglePause]);

  const activeMap = MAP_LIST.find((m) => m.id === currentMap) ?? MAP_LIST[0];

  return (
    <div className="relative w-screen h-screen overflow-hidden bg-[#080b12]">
      {/* Isolated WebGL Viewport Container */}
      <div ref={mountRef} className="fixed inset-0 w-full h-full" />

      {/* WebGL Context Lost Fallback */}
      {contextLost && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-[#080b12]/95 p-6">
          <div className="max-w-md rounded-2xl border border-white/15 bg-[#0e1422] p-6 text-center">
            <h2 className="font-display text-xl font-bold text-white">Koneksi Grafis 3D Terhenti</h2>
            <p className="mt-2 text-sm text-slate-300">
              Konteks WebGL terputus sementara. Silakan muat ulang halaman jika tampilan tidak pulih otomatis.
            </p>
          </div>
        </div>
      )}

      {/* Active Race HUD */}
      {isPlaying && (
        <RaceHUD
          telemetry={telemetry}
          currentMap={currentMap}
          cameraMode={cameraMode}
          carColorId={carColorId}
          isMuted={isMuted}
          isPlaying={isPlaying}
          isPaused={isPaused}
          onSelectMap={handleSelectMap}
          onSelectCamera={handleSelectCamera}
          onSelectColor={handleSelectColor}
          onToggleMute={handleToggleMute}
          onResetCar={handleResetCar}
          onRestartRace={handleRestartRace}
          onTogglePause={handleTogglePause}
          onTouchInput={handleTouchInput}
        />
      )}

      {/* Pre-Race Title & Circuit Selector Overlay (Leaves center 3D car showcase visible) */}
      {!isPlaying && (
        <div className="pointer-events-none fixed inset-0 z-20 flex flex-col justify-between p-5 sm:p-8">
          {/* Top-Left Brand Header */}
          <div className="pointer-events-auto max-w-xl">
            <div className="text-xs font-medium tracking-wider text-amber-400">
              Balapan Sirkuit 3D · 4 Peta & 6 Sudut Kamera
            </div>
            <h1 className="font-display text-4xl sm:text-5xl font-bold tracking-tight text-white mt-1 drop-shadow-md">
              Apex Horizon GT
            </h1>
            <p className="text-sm text-slate-200 mt-1.5 max-w-md drop-shadow">
              Pilih sirkuit balapan, sesuaikan warna mobil, dan ganti sudut kamera kapan saja saat melaju di lintasan.
            </p>
          </div>

          {/* Bottom Showcase Setup Bar */}
          <div className="pointer-events-auto w-full max-w-5xl self-center rounded-2xl bg-[#0a0f1a]/90 border border-white/14 p-4 sm:p-5 shadow-2xl">
            <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
              {/* Circuit Selector */}
              <div className="flex-1 min-w-0">
                <div className="text-xs font-medium text-slate-400 mb-2">
                  Pilih Sirkuit Balapan · <span className="text-slate-200">{activeMap.subtitle}</span>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  {MAP_LIST.map((m) => (
                    <button
                      key={m.id}
                      type="button"
                      onClick={() => handleSelectMap(m.id)}
                      className={`px-3 py-2.5 rounded-xl text-left border transition-colors cursor-pointer ${
                        currentMap === m.id
                          ? 'bg-amber-500 text-slate-950 border-amber-400'
                          : 'bg-slate-900/85 text-slate-200 border-white/10 hover:bg-slate-800'
                      }`}
                    >
                      <div className="text-xs font-bold truncate">{m.name}</div>
                      <div
                        className={`text-[11px] truncate mt-0.5 ${
                          currentMap === m.id ? 'text-slate-900/80' : 'text-slate-400'
                        }`}
                      >
                        {m.terrainLabel}
                      </div>
                    </button>
                  ))}
                </div>
              </div>

              <div className="hidden lg:block h-14 w-px bg-white/10" />

              {/* Car Paint & Launch Button */}
              <div className="flex flex-wrap sm:flex-nowrap items-center justify-between lg:justify-end gap-4 shrink-0">
                <div>
                  <div className="text-xs font-medium text-slate-400 mb-2">Warna Mobil</div>
                  <div className="flex items-center gap-2">
                    {CAR_COLORS.map((col) => (
                      <button
                        key={col.id}
                        type="button"
                        onClick={() => handleSelectColor(col.id)}
                        title={col.name}
                        className={`h-7 w-7 rounded-full border-2 transition-transform cursor-pointer ${
                          carColorId === col.id
                            ? 'border-white scale-110'
                            : 'border-white/25 hover:scale-105'
                        }`}
                        style={{ backgroundColor: col.css }}
                      />
                    ))}
                  </div>
                </div>

                <button
                  type="button"
                  onClick={handleStartRace}
                  className="flex items-center gap-2 rounded-xl bg-amber-500 px-6 py-3.5 text-sm font-bold text-slate-950 hover:bg-amber-400 transition-colors whitespace-nowrap shrink-0 cursor-pointer shadow-lg"
                >
                  <Play className="w-4 h-4 fill-current" />
                  <span>Mulai Balapan</span>
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            </div>

            <div className="mt-3 pt-3 border-t border-white/10 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-400">
              <span>Kontrol: W/A/S/D atau Panah untuk mengemudi · Spasi Drift · Shift Nitro</span>
              <span>Kamera saat balapan: Tekan C atau tombol 1–6</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
