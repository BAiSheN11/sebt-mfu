import {
  SEBT_DIRECTIONS,
  SEBT_DIRECTION_LABELS,
  type IDetectionReport,
  type SebtDirection,
} from '@/data/sebt';

interface SebtStarDiagramProps {
  report: IDetectionReport | null;
}

// Direction angle in degrees (0 = right/anterior, clockwise in top-down view)
// Anterior = front = 90° (top of star)
const DIRECTION_ANGLES: Record<SebtDirection, number> = {
  anterior: 90,
  anteromedial: 135,
  medial: 180,
  posteromedial: 225,
  posterior: 270,
  posterolateral: 315,
  lateral: 0,
  anterolateral: 45,
};

export default function SebtStarDiagram({ report }: SebtStarDiagramProps) {
  const cx = 150;
  const cy = 150;
  const outerR = 120;
  const innerR = 30;

  const getSeverityColor = (severity: 'high' | 'medium' | 'low') => {
    switch (severity) {
      case 'high':
        return '#f87171'; // red-400
      case 'medium':
        return '#fbbf24'; // amber-400
      case 'low':
        return '#34d399'; // emerald-400
    }
  };

  const impact = report?.sebtContext.directionFlawImpact;

  return (
    <div className="rounded-xl border border-border/50 bg-card/30 p-4">
      <div className="mb-3">
        <h3 className="text-sm font-semibold text-foreground">SEBT Star Pattern Reference</h3>
        <p className="text-xs text-muted-foreground">
          8 reach directions with flaw impact severity
        </p>
      </div>
      <div className="flex flex-col items-center gap-4 md:flex-row md:items-start">
        <svg viewBox="0 0 300 300" className="h-64 w-64 shrink-0">
          {/* Background circle */}
          <circle cx={cx} cy={cy} r={outerR + 5} fill="hsl(220 7% 12%)" stroke="hsl(220 5% 20%)" strokeWidth="1" />
          <circle cx={cx} cy={cy} r={outerR * 0.66} fill="none" stroke="hsl(220 5% 20%)" strokeWidth="0.5" strokeDasharray="2 3" />
          <circle cx={cx} cy={cy} r={outerR * 0.33} fill="none" stroke="hsl(220 5% 20%)" strokeWidth="0.5" strokeDasharray="2 3" />

          {/* Center point (stance foot) */}
          <circle cx={cx} cy={cy} r={5} fill="hsl(220 5% 40%)" />
          <text x={cx} y={cy + 18} textAnchor="middle" fill="hsl(215 8% 60%)" fontSize="9">
            Stance
          </text>

          {/* Star lines */}
          {SEBT_DIRECTIONS.map((dir) => {
            const angle = (DIRECTION_ANGLES[dir] * Math.PI) / 180;
            const x2 = cx + Math.cos(angle) * outerR;
            const y2 = cy - Math.sin(angle) * outerR;
            const severity = impact?.[dir]?.severity ?? 'high';
            const color = getSeverityColor(severity);
            return (
              <line
                key={dir}
                x1={cx + Math.cos(angle) * innerR}
                y1={cy - Math.sin(angle) * innerR}
                x2={x2}
                y2={y2}
                stroke={color}
                strokeWidth="2"
                opacity="0.7"
              />
            );
          })}

          {/* Direction endpoint markers + labels */}
          {SEBT_DIRECTIONS.map((dir) => {
            const angle = (DIRECTION_ANGLES[dir] * Math.PI) / 180;
            const x = cx + Math.cos(angle) * outerR;
            const y = cy - Math.sin(angle) * outerR;
            const labelX = cx + Math.cos(angle) * (outerR + 18);
            const labelY = cy - Math.sin(angle) * (outerR + 18);
            const severity = impact?.[dir]?.severity ?? 'high';
            const color = getSeverityColor(severity);
            const short = dir
              .split(/(?=[A-Z])/)
              .map((s) => s[0].toUpperCase())
              .join('');
            return (
              <g key={dir}>
                <circle cx={x} cy={y} r="5" fill={color} stroke="hsl(220 7% 12%)" strokeWidth="2" />
                <text
                  x={labelX}
                  y={labelY + 3}
                  textAnchor="middle"
                  fill={color}
                  fontSize="10"
                  fontWeight="bold"
                >
                  {short}
                </text>
              </g>
            );
          })}
        </svg>

        <div className="flex-1 space-y-1.5 text-xs">
          <div className="mb-2 font-semibold text-foreground">Flaw Impact by Direction</div>
          {SEBT_DIRECTIONS.map((dir) => {
            const info = impact?.[dir];
            const severity = info?.severity ?? 'high';
            const color = getSeverityColor(severity);
            return (
              <div key={dir} className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="size-2 shrink-0 rounded-full" style={{ backgroundColor: color }} />
                  <span className="truncate text-foreground">{SEBT_DIRECTION_LABELS[dir]}</span>
                </div>
                <div className="flex items-center gap-1">
                  {info?.flaw1 && <span className="text-[10px] text-red-400" title="Self-occlusion">Occ</span>}
                  {info?.flaw2 && <span className="text-[10px] text-red-400" title="Vertical blindness">Z</span>}
                  {info?.flaw3 && <span className="text-[10px] text-amber-400" title="Foreshortening">F</span>}
                </div>
              </div>
            );
          })}
          <div className="mt-2 border-t border-border/40 pt-2">
            <div className="text-[10px] text-muted-foreground">
              Occ = Self-occlusion · Z = Vertical blind · F = Foreshortening
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
