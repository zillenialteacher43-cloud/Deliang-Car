import React from 'react';
import { MinimapEntity, MinimapPoint } from '../game/types';

interface MinimapProps {
  track: MinimapPoint[];
  entities: MinimapEntity[];
}

export const Minimap: React.FC<MinimapProps> = ({ track, entities }) => {
  if (track.length === 0) return null;

  const pathD =
    track.map((pt, idx) => `${idx === 0 ? 'M' : 'L'} ${pt.x.toFixed(1)} ${pt.y.toFixed(1)}`).join(' ') + ' Z';

  const startPt = track[0];

  return (
    <div className="w-32 h-32 rounded-xl bg-[#0a0f1a]/88 border border-white/12 p-2 shadow-lg">
      <svg viewBox="-6 -6 112 112" className="w-full h-full overflow-visible">
        <path
          d={pathD}
          fill="none"
          stroke="rgba(148, 163, 184, 0.25)"
          strokeWidth="6.5"
          strokeLinejoin="round"
          strokeLinecap="round"
        />
        <path
          d={pathD}
          fill="none"
          stroke="rgba(241, 245, 249, 0.8)"
          strokeWidth="2.4"
          strokeLinejoin="round"
          strokeLinecap="round"
        />
        {startPt && (
          <circle cx={startPt.x} cy={startPt.y} r="3.2" fill="#f8fafc" stroke="#0f172a" strokeWidth="1" />
        )}
        {entities.map((ent) => (
          <circle
            key={ent.id}
            cx={ent.x}
            cy={ent.y}
            r={ent.isPlayer ? 4.4 : 3.2}
            fill={ent.color}
            stroke="#090d16"
            strokeWidth="1.2"
          />
        ))}
      </svg>
    </div>
  );
};
