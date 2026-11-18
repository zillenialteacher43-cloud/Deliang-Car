import React, { useState } from 'react';
import {
  Camera,
  ChevronDown,
  ChevronUp,
  Flag,
  Gamepad2,
  Map as MapIcon,
  Pause,
  RotateCcw,
  Volume2,
  VolumeX,
  Zap,
} from 'lucide-react';
import { MAP_LIST } from '../game/maps';
import {
  CAMERA_OPTIONS,
  CAR_COLORS,
  CameraMode,
  ControlInput,
  MapId,
  RaceTelemetry,
} from '../game/types';
import { Minimap } from './Minimap';

interface RaceHUDProps {
  telemetry: RaceTelemetry;
  currentMap: MapId;
  cameraMode: CameraMode;
  carColorId: string;
  isMuted: boolean;
  isPlaying: boolean;
  isPaused: boolean;
  onSelectMap: (id: MapId) => void;
  onSelectCamera: (mode: CameraMode) => void;
  onSelectColor: (id: string) => void;
  onToggleMute: () => void;
  onResetCar: () => void;
  onRestartRace: () => void;
  onTogglePause: () => void;
  onTouchInput: (partial: Partial<ControlInput>) => void;
}

function formatMs(ms: number): string {
  const totalSec = Math.max(0, ms / 1000);
  const mins = Math.floor(totalSec / 60);
  const secs = Math.floor(totalSec % 60);
  const hundredths = Math.floor((ms % 1000) / 10);
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}.${String(hundredths).padStart(2, '0')}`;
}

export const RaceHUD: React.FC<RaceHUDProps> = ({
  telemetry,
  currentMap,
  cameraMode,
  carColorId,
  isMuted,
  isPlaying,
  isPaused,
  onSelectMap,
  onSelectCamera,
  onSelectColor,
  onToggleMute,
  onResetCar,
  onRestartRace,
  onTogglePause,
  onTouchInput,
}) => {
  const [dockCollapsed, setDockCollapsed] = useState(false);
  const [dockTab, setDockTab] = useState<'camera' | 'map' | 'garage'>('camera');
  const [showTouchPad, setShowTouchPad] = useState(false);

  const activeMap = MAP_LIST.find((m) => m.id === currentMap) ?? MAP_LIST[0];

  return (
    <div className="pointer-events-none fixed inset-0 z-10 flex flex-col justify-between p-4 sm:p-5">
      {/* Top Row: Telemetry (Left) & Minimap + Actions (Right) */}
      <div className="flex items-start justify-between gap-4">
        {/* Top-Left Telemetry */}
        <div className="pointer-events-auto rounded-xl bg-[#0a0f1a]/88 border border-white/12 px-4 py-3 shadow-lg">
          <div className="flex items-baseline gap-4">
            <div>
              <div className="text-[11px] font-medium text-slate-400">Posisi</div>
              <div className="font-display text-2xl font-bold text-white leading-tight font-mono-tabular">
                {telemetry.position}
                <span className="text-sm font-medium text-slate-400">/{telemetry.totalRacers}</span>
              </div>
            </div>
            <div className="h-8 w-px bg-white/10" />
            <div>
              <div className="text-[11px] font-medium text-slate-400">Lap</div>
              <div className="font-display text-2xl font-bold text-amber-400 leading-tight font-mono-tabular">
                {telemetry.lap}
                <span className="text-sm font-medium text-slate-400">/{telemetry.totalLaps}</span>
              </div>
            </div>
            <div className="h-8 w-px bg-white/10" />
            <div>
              <div className="text-[11px] font-medium text-slate-400">Waktu Lap</div>
              <div className="font-mono-tabular text-base font-semibold text-slate-100 leading-tight mt-0.5">
                {formatMs(telemetry.lapTimeMs)}
              </div>
              {telemetry.bestLapMs !== null && (
                <div className="font-mono-tabular text-[11px] text-emerald-400">
                  Terbaik {formatMs(telemetry.bestLapMs)}
                </div>
              )}
            </div>
          </div>
          <div className="mt-2 pt-2 border-t border-white/10 flex items-center gap-2 text-xs text-slate-300">
            <span className="font-medium text-white">{activeMap.name}</span>
            <span className="text-slate-500" aria-hidden="true">·</span>
            <span className="text-slate-400">{activeMap.terrainLabel}</span>
          </div>
        </div>

        {/* Top-Right Minimap & Action Icons */}
        {isPlaying && (
          <div className="pointer-events-auto flex items-start gap-2.5">
            <div className="flex flex-col gap-2">
              <button
                type="button"
                onClick={onTogglePause}
                title="Jeda / Menu (Esc)"
                className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#0a0f1a]/88 border border-white/12 text-slate-200 hover:bg-slate-800 hover:text-white transition-colors cursor-pointer"
              >
                <Pause className="w-4 h-4" />
              </button>
              <button
                type="button"
                onClick={onResetCar}
                title="Reset Posisi Mobil (R)"
                className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#0a0f1a]/88 border border-white/12 text-slate-200 hover:bg-slate-800 hover:text-white transition-colors cursor-pointer"
              >
                <RotateCcw className="w-4 h-4" />
              </button>
              <button
                type="button"
                onClick={() => setShowTouchPad((v) => !v)}
                title="Tampilkan Kontrol Layar"
                className={`flex h-10 w-10 items-center justify-center rounded-xl border transition-colors cursor-pointer ${
                  showTouchPad
                    ? 'bg-amber-500 border-amber-400 text-slate-950'
                    : 'bg-[#0a0f1a]/88 border-white/12 text-slate-200 hover:bg-slate-800'
                }`}
              >
                <Gamepad2 className="w-4 h-4" />
              </button>
            </div>
            <Minimap track={telemetry.minimapTrack} entities={telemetry.minimapEntities} />
          </div>
        )}
      </div>

      {/* Center Countdown / Status Alerts */}
      {isPlaying && !isPaused && telemetry.countdown > 0 && (
        <div className="pointer-events-none fixed inset-0 flex items-center justify-center">
          <div className="rounded-2xl bg-[#0a0f1a]/85 border border-white/15 px-10 py-6 text-center shadow-2xl">
            <div className="text-xs font-medium tracking-wider text-amber-400">Bersiap di Garis Start</div>
            <div className="font-display text-7xl font-bold text-white mt-1 font-mono-tabular">
              {telemetry.countdown}
            </div>
          </div>
        </div>
      )}

      {/* Race Finished Modal */}
      {isPlaying && telemetry.raceFinished && (
        <div className="pointer-events-auto fixed inset-0 z-30 flex items-center justify-center bg-black/55 p-4">
          <div className="w-full max-w-md rounded-2xl bg-[#0b101b] border border-white/15 p-6 shadow-2xl">
            <div className="flex items-center gap-3 text-amber-400">
              <Flag className="w-5 h-5" />
              <span className="text-sm font-semibold">Balapan Selesai</span>
            </div>
            <h2 className="font-display text-3xl font-bold text-white mt-2">
              Finis Posisi ke-{telemetry.position}
            </h2>
            <p className="text-sm text-slate-400 mt-1">
              Sirkuit {activeMap.name} · {telemetry.totalLaps} Lap
            </p>

            <div className="mt-5 grid grid-cols-2 gap-3 border-y border-white/10 py-4">
              <div>
                <div className="text-xs text-slate-400">Total Waktu</div>
                <div className="font-mono-tabular text-lg font-semibold text-white mt-0.5">
                  {formatMs(telemetry.totalTimeMs)}
                </div>
              </div>
              <div>
                <div className="text-xs text-slate-400">Lap Terbaik</div>
                <div className="font-mono-tabular text-lg font-semibold text-emerald-400 mt-0.5">
                  {telemetry.bestLapMs ? formatMs(telemetry.bestLapMs) : '—'}
                </div>
              </div>
            </div>

            <div className="mt-5 flex items-center gap-3">
              <button
                type="button"
                onClick={onRestartRace}
                className="flex-1 rounded-xl bg-amber-500 px-4 py-2.5 text-sm font-semibold text-slate-950 hover:bg-amber-400 transition-colors cursor-pointer"
              >
                Balapan Lagi
              </button>
              <button
                type="button"
                onClick={() => {
                  const idx = MAP_LIST.findIndex((m) => m.id === currentMap);
                  const nextMap = MAP_LIST[(idx + 1) % MAP_LIST.length].id;
                  onSelectMap(nextMap);
                }}
                className="flex-1 rounded-xl bg-slate-800 border border-white/12 px-4 py-2.5 text-sm font-semibold text-white hover:bg-slate-700 transition-colors cursor-pointer"
              >
                Peta Berikutnya
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Pause Overlay */}
      {isPlaying && isPaused && !telemetry.raceFinished && (
        <div className="pointer-events-auto fixed inset-0 z-30 flex items-center justify-center bg-black/55 p-4">
          <div className="w-full max-w-sm rounded-2xl bg-[#0b101b] border border-white/15 p-6 shadow-2xl">
            <h2 className="font-display text-2xl font-bold text-white">Balapan Dijeda</h2>
            <p className="text-sm text-slate-400 mt-1">{activeMap.name}</p>
            <div className="mt-5 flex flex-col gap-2.5">
              <button
                type="button"
                onClick={onTogglePause}
                className="w-full rounded-xl bg-amber-500 px-4 py-2.5 text-sm font-semibold text-slate-950 hover:bg-amber-400 transition-colors cursor-pointer"
              >
                Lanjutkan Balapan
              </button>
              <button
                type="button"
                onClick={onRestartRace}
                className="w-full rounded-xl bg-slate-800 border border-white/12 px-4 py-2.5 text-sm font-semibold text-white hover:bg-slate-700 transition-colors cursor-pointer"
              >
                Ulangi dari Start
              </button>
            </div>
            <div className="mt-5 pt-4 border-t border-white/10 text-xs text-slate-400 space-y-1">
              <div className="flex justify-between">
                <span>Gas / Rem</span>
                <span className="font-mono-tabular text-slate-200">W S / Panah</span>
              </div>
              <div className="flex justify-between">
                <span>Belok</span>
                <span className="font-mono-tabular text-slate-200">A D / Panah</span>
              </div>
              <div className="flex justify-between">
                <span>Nitro / Drift</span>
                <span className="font-mono-tabular text-slate-200">Shift / Spasi</span>
              </div>
              <div className="flex justify-between">
                <span>Ganti Kamera</span>
                <span className="font-mono-tabular text-slate-200">C atau 1–6</span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Optional On-Screen Touch / Mouse Controls */}
      {isPlaying && showTouchPad && !isPaused && (
        <div className="pointer-events-none flex items-end justify-between gap-4 mb-24 px-1">
          <div className="pointer-events-auto flex items-center gap-2">
            <button
              type="button"
              onPointerDown={() => onTouchInput({ left: true })}
              onPointerUp={() => onTouchInput({ left: false })}
              onPointerLeave={() => onTouchInput({ left: false })}
              className="h-14 w-16 rounded-xl bg-[#0a0f1a]/90 border border-white/15 text-base font-bold text-white active:bg-amber-500 active:text-slate-950 cursor-pointer"
            >
              Kiri
            </button>
            <button
              type="button"
              onPointerDown={() => onTouchInput({ right: true })}
              onPointerUp={() => onTouchInput({ right: false })}
              onPointerLeave={() => onTouchInput({ right: false })}
              className="h-14 w-16 rounded-xl bg-[#0a0f1a]/90 border border-white/15 text-base font-bold text-white active:bg-amber-500 active:text-slate-950 cursor-pointer"
            >
              Kanan
            </button>
          </div>
          <div className="pointer-events-auto flex items-center gap-2">
            <button
              type="button"
              onPointerDown={() => onTouchInput({ nitro: true, throttle: true })}
              onPointerUp={() => onTouchInput({ nitro: false, throttle: false })}
              onPointerLeave={() => onTouchInput({ nitro: false, throttle: false })}
              className="h-14 px-4 rounded-xl bg-sky-500/90 border border-sky-300/40 text-sm font-bold text-slate-950 active:bg-sky-400 cursor-pointer"
            >
              Nitro
            </button>
            <button
              type="button"
              onPointerDown={() => onTouchInput({ brake: true })}
              onPointerUp={() => onTouchInput({ brake: false })}
              onPointerLeave={() => onTouchInput({ brake: false })}
              className="h-14 px-5 rounded-xl bg-red-600/90 border border-red-400/40 text-sm font-bold text-white active:bg-red-500 cursor-pointer"
            >
              Rem
            </button>
            <button
              type="button"
              onPointerDown={() => onTouchInput({ throttle: true })}
              onPointerUp={() => onTouchInput({ throttle: false })}
              onPointerLeave={() => onTouchInput({ throttle: false })}
              className="h-14 px-6 rounded-xl bg-emerald-500/90 border border-emerald-300/40 text-sm font-bold text-slate-950 active:bg-emerald-400 cursor-pointer"
            >
              Gas
            </button>
          </div>
        </div>
      )}

      {/* Unified Collapsible Bottom Control Dock */}
      {isPlaying && (
        <div className="pointer-events-none flex flex-col items-center">
          <button
            type="button"
            onClick={() => setDockCollapsed((c) => !c)}
            className="pointer-events-auto mb-1.5 flex items-center gap-1.5 rounded-t-lg rounded-b-sm bg-[#0a0f1a]/90 border border-white/12 px-3 py-1 text-[11px] font-medium text-slate-300 hover:text-white transition-colors cursor-pointer"
          >
            {dockCollapsed ? (
              <>
                <ChevronUp className="w-3.5 h-3.5" />
                <span>Tampilkan Kontrol</span>
              </>
            ) : (
              <>
                <ChevronDown className="w-3.5 h-3.5" />
                <span>Sembunyikan Kontrol</span>
              </>
            )}
          </button>

          {!dockCollapsed && (
            <div className="pointer-events-auto w-full max-w-[940px] rounded-2xl bg-[#0a0f1a]/92 border border-white/14 px-4 py-3 shadow-2xl">
              <div className="flex flex-wrap items-center justify-between gap-4">
                {/* Speedometer & Nitro Gauge */}
                <div className="flex items-center gap-4 min-w-[230px]">
                  <div className="flex items-baseline gap-1.5">
                    <span className="font-display text-4xl font-bold text-white font-mono-tabular leading-none">
                      {telemetry.speedKmh}
                    </span>
                    <span className="text-xs font-medium text-slate-400">KM/H</span>
                  </div>
                  <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-slate-800/90 border border-white/10 font-display text-lg font-bold text-amber-400 font-mono-tabular">
                    {telemetry.gear}
                  </div>
                  <div className="flex flex-col gap-1.5 w-28">
                    {/* RPM Bar */}
                    <div className="h-1.5 w-full rounded-full bg-slate-800 overflow-hidden">
                      <div
                        className="h-full transition-[width] duration-75"
                        style={{
                          width: `${Math.round(telemetry.rpmRatio * 100)}%`,
                          backgroundColor: telemetry.rpmRatio > 0.85 ? '#ef4444' : '#f59e0b',
                        }}
                      />
                    </div>
                    {/* Nitro Bar */}
                    <div className="flex items-center gap-1.5">
                      <Zap className="w-3 h-3 text-sky-400 shrink-0" />
                      <div className="h-1.5 flex-1 rounded-full bg-slate-800 overflow-hidden">
                        <div
                          className="h-full bg-sky-400 transition-[width] duration-75"
                          style={{ width: `${telemetry.nitro}%` }}
                        />
                      </div>
                    </div>
                  </div>
                </div>

                {/* Dock Category Tabs */}
                <div className="flex items-center gap-1 rounded-lg bg-slate-900/90 p-1 border border-white/8">
                  <button
                    type="button"
                    onClick={() => setDockTab('camera')}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium whitespace-nowrap shrink-0 transition-colors cursor-pointer ${
                      dockTab === 'camera'
                        ? 'bg-amber-500 text-slate-950 font-semibold'
                        : 'text-slate-300 hover:text-white'
                    }`}
                  >
                    <Camera className="w-3.5 h-3.5" />
                    <span>Kamera [C]</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setDockTab('map')}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium whitespace-nowrap shrink-0 transition-colors cursor-pointer ${
                      dockTab === 'map'
                        ? 'bg-amber-500 text-slate-950 font-semibold'
                        : 'text-slate-300 hover:text-white'
                    }`}
                  >
                    <MapIcon className="w-3.5 h-3.5" />
                    <span>Ganti Peta</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setDockTab('garage')}
                    className={`px-3 py-1.5 rounded-md text-xs font-medium whitespace-nowrap shrink-0 transition-colors cursor-pointer ${
                      dockTab === 'garage'
                        ? 'bg-amber-500 text-slate-950 font-semibold'
                        : 'text-slate-300 hover:text-white'
                    }`}
                  >
                    Warna & Suara
                  </button>
                </div>

                {/* Active Tab Controls */}
                <div className="flex items-center gap-1.5 flex-wrap">
                  {dockTab === 'camera' &&
                    CAMERA_OPTIONS.map((cam) => (
                      <button
                        key={cam.id}
                        type="button"
                        onClick={() => onSelectCamera(cam.id)}
                        className={`px-2.5 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap shrink-0 border transition-colors cursor-pointer ${
                          cameraMode === cam.id
                            ? 'bg-white text-slate-950 border-white font-semibold'
                            : 'bg-slate-800/80 text-slate-300 border-white/10 hover:text-white hover:bg-slate-700'
                        }`}
                      >
                        {cam.shortLabel}
                      </button>
                    ))}

                  {dockTab === 'map' &&
                    MAP_LIST.map((m) => (
                      <button
                        key={m.id}
                        type="button"
                        onClick={() => onSelectMap(m.id)}
                        className={`px-2.5 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap shrink-0 border transition-colors cursor-pointer ${
                          currentMap === m.id
                            ? 'bg-white text-slate-950 border-white font-semibold'
                            : 'bg-slate-800/80 text-slate-300 border-white/10 hover:text-white hover:bg-slate-700'
                        }`}
                      >
                        {m.name}
                      </button>
                    ))}

                  {dockTab === 'garage' && (
                    <div className="flex items-center gap-2">
                      {CAR_COLORS.map((col) => (
                        <button
                          key={col.id}
                          type="button"
                          onClick={() => onSelectColor(col.id)}
                          title={col.name}
                          className={`h-7 w-7 rounded-full border-2 transition-transform cursor-pointer ${
                            carColorId === col.id
                              ? 'border-white scale-110'
                              : 'border-white/25 hover:scale-105'
                          }`}
                          style={{ backgroundColor: col.css }}
                        />
                      ))}
                      <div className="h-5 w-px bg-white/15 mx-1" />
                      <button
                        type="button"
                        onClick={onToggleMute}
                        title={isMuted ? 'Nyalakan Suara' : 'Bisukan Suara'}
                        className="flex h-8 w-8 items-center justify-center rounded-lg bg-slate-800 border border-white/12 text-slate-200 hover:text-white cursor-pointer"
                      >
                        {isMuted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
                      </button>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};
