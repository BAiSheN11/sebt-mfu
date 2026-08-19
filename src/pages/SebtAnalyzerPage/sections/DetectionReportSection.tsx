import { AlertTriangle, Eye, EyeOff, Ruler, ShieldAlert } from 'lucide-react';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import {
  type IDetectionReport,
  type IKeypointSummary,
  type KeypointStatus,
} from '@/data/sebt';
import { cn } from '@/lib/utils';

interface DetectionReportSectionProps {
  report: IDetectionReport | null;
}

function statusBadgeVariant(status: KeypointStatus) {
  switch (status) {
    case 'reliable':
      return 'bg-emerald-500/15 text-emerald-400 border-emerald-500/40';
    case 'uncertain':
      return 'bg-amber-500/15 text-amber-400 border-amber-500/40';
    case 'missing':
      return 'bg-red-500/15 text-red-400 border-red-500/40';
  }
}

function statusLabel(status: KeypointStatus) {
  switch (status) {
    case 'reliable':
      return 'Reliable';
    case 'uncertain':
      return 'Uncertain';
    case 'missing':
      return 'Missing';
  }
}

const GROUP_ORDER: Array<IKeypointSummary['group']> = ['head', 'upper_limb', 'torso', 'lower_limb'];
const GROUP_LABELS: Record<IKeypointSummary['group'], string> = {
  head: 'Head',
  upper_limb: 'Upper Limbs',
  torso: 'Torso / Hips',
  lower_limb: 'Lower Limbs',
};

export default function DetectionReportSection({ report }: DetectionReportSectionProps) {
  if (!report) {
    return (
      <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border/50 bg-card/20 p-10 text-center">
        <EyeOff className="mb-3 size-10 text-muted-foreground" />
        <h3 className="mb-1 font-semibold text-foreground">No Detection Report</h3>
        <p className="max-w-sm text-sm text-muted-foreground">
          Upload a video or try Demo Mode to generate the keypoint detection report and flaw
          analysis.
        </p>
      </div>
    );
  }

  // Group keypoints by body region
  const grouped = GROUP_ORDER.map((g) => ({
    group: g,
    items: report.keypointSummaries.filter((k) => k.group === g),
  }));

  const flaw1 = report.threeFlaws.flaw1_selfOcclusion;
  const flaw2 = report.threeFlaws.flaw2_verticalBlindness;
  const flaw3 = report.threeFlaws.flaw3_foreshortening;

  return (
    <div className="space-y-6">
      {/* Report header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h2 className="text-lg font-bold text-foreground">Detection Report</h2>
          <p className="text-xs text-muted-foreground">
            {report.totalFrames} frames · {report.fps} fps · {report.duration.toFixed(1)}s ·{' '}
            {report.videoResolution.width}×{report.videoResolution.height}
            {report.isSimulated && ' · Simulated'}
          </p>
        </div>
        <Badge
          variant="outline"
          className={cn(
            'border-red-500/50 bg-red-500/10 text-red-400',
          )}
        >
          <ShieldAlert className="mr-1 size-3.5" />
          FAULTS DETECTED
        </Badge>
      </div>

      {/* Keypoint detection table */}
      <div className="rounded-xl border border-border/50 bg-card/30">
        <div className="border-b border-border/50 px-4 py-3">
          <h3 className="text-sm font-semibold text-foreground">Per-Keypoint Detection Summary</h3>
          <p className="text-xs text-muted-foreground">
            COCO 17 keypoint detection reliability across all frames
          </p>
        </div>
        <div className="max-h-[420px] overflow-y-auto">
          <Table>
            <TableHeader className="sticky top-0 bg-card/90 backdrop-blur-sm">
              <TableRow>
                <TableHead>Body Part</TableHead>
                <TableHead className="text-right">Avg Conf.</TableHead>
                <TableHead className="text-right">Detected</TableHead>
                <TableHead className="text-right">Missing</TableHead>
                <TableHead className="text-right">Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {grouped.map(({ group, items }) => (
                <>
                  <TableRow key={`group-${group}`} className="bg-muted/30">
                    <TableCell colSpan={5} className="py-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      {GROUP_LABELS[group]}
                    </TableCell>
                  </TableRow>
                  {items.map((kp) => (
                    <TableRow key={kp.name}>
                      <TableCell className="font-medium text-foreground">
                        {kp.bodyPartLabel}
                      </TableCell>
                      <TableCell className="text-right font-mono tabular-nums">
                        {(kp.avgConfidence * 100).toFixed(0)}%
                      </TableCell>
                      <TableCell className="text-right font-mono tabular-nums text-emerald-400">
                        {kp.framesDetected}
                      </TableCell>
                      <TableCell className="text-right font-mono tabular-nums text-red-400">
                        {kp.framesMissing}
                      </TableCell>
                      <TableCell className="text-right">
                        <Badge
                          variant="outline"
                          className={cn(statusBadgeVariant(kp.status))}
                        >
                          {statusLabel(kp.status)}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </>
              ))}
            </TableBody>
          </Table>
        </div>
      </div>

      {/* Three Flaws Analysis */}
      <div>
        <h3 className="mb-3 text-sm font-semibold text-foreground">Three Fatal Flaws Analysis</h3>
        <div className="space-y-3">
          {/* Flaw 1 — Self Occlusion */}
          <div className="rounded-xl border border-red-500/30 bg-red-500/5 p-4">
            <div className="mb-2 flex items-start gap-3">
              <div className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg bg-red-500/20 text-red-400">
                <EyeOff className="size-4.5" />
              </div>
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <h4 className="font-semibold text-foreground">
                    Flaw 1: Severe Self-Occlusion
                  </h4>
                  <Badge
                    variant="outline"
                    className="border-red-500/50 bg-red-500/10 text-red-400 text-[10px] uppercase"
                  >
                    Critical
                  </Badge>
                </div>
                <p className="text-xs text-red-300/80">
                  "The Disappearing Foot" — torso obscures stance foot and reaching leg
                </p>
              </div>
            </div>
            <p className="mb-3 text-sm text-muted-foreground">{flaw1.details}</p>
            <div className="flex flex-wrap gap-2">
              {flaw1.affectedKeypoints.map((k) => (
                <Badge
                  key={k}
                  variant="outline"
                  className="border-red-500/40 bg-red-500/10 text-red-300"
                >
                  {k.replace(/_/g, ' ')}
                </Badge>
              ))}
            </div>
            <div className="mt-3 flex items-center gap-3 rounded-lg bg-background/50 p-3">
              <div className="text-xs text-muted-foreground">Avg. absence rate</div>
              <div className="flex-1">
                <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full bg-red-500"
                    style={{ width: `${flaw1.avgAbsenceRate}%` }}
                  />
                </div>
              </div>
              <div className="font-mono text-sm font-bold text-red-400 tabular-nums">
                {flaw1.avgAbsenceRate.toFixed(1)}%
              </div>
            </div>
          </div>

          {/* Flaw 2 — Vertical Blindness */}
          <div className="rounded-xl border border-red-500/30 bg-red-500/5 p-4">
            <div className="mb-2 flex items-start gap-3">
              <div className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg bg-red-500/20 text-red-400">
                <AlertTriangle className="size-4.5" />
              </div>
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <h4 className="font-semibold text-foreground">
                    Flaw 2: Vertical Blindness
                  </h4>
                  <Badge
                    variant="outline"
                    className="border-red-500/50 bg-red-500/10 text-red-400 text-[10px] uppercase"
                  >
                    Critical
                  </Badge>
                </div>
                <p className="text-xs text-red-300/80">
                  "The Heel Lift" — Z-axis motion is invisible to 2D top-down camera
                </p>
              </div>
              <div className="rounded-md bg-red-600 px-2.5 py-1 font-bold text-red-50 text-xs tracking-wider shadow-lg shadow-red-900/30">
                BLIND
              </div>
            </div>
            <p className="mb-3 text-sm text-muted-foreground">{flaw2.details}</p>
            <div className="flex flex-wrap gap-2">
              {flaw2.affectedMovements.map((m) => (
                <Badge
                  key={m}
                  variant="outline"
                  className="border-red-500/40 bg-red-500/10 text-red-300"
                >
                  {m.replace(/_/g, ' ')}
                </Badge>
              ))}
            </div>
            <div className="mt-3 rounded-lg border border-red-500/30 bg-background/50 p-3">
              <div className="flex items-center gap-3 text-xs">
                <div className="flex size-6 shrink-0 items-center justify-center rounded bg-red-500/20 text-red-400">
                  Z
                </div>
                <div>
                  <div className="font-medium text-foreground">
                    Z-axis dimension: NOT MEASURABLE
                  </div>
                  <div className="text-muted-foreground">
                    Heel lift produces near-zero X/Y pixel displacement — undetectable from
                    single overhead 2D view.
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Flaw 3 — Foreshortening */}
          <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-4">
            <div className="mb-2 flex items-start gap-3">
              <div className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg bg-amber-500/20 text-amber-400">
                <Ruler className="size-4.5" />
              </div>
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <h4 className="font-semibold text-foreground">
                    Flaw 3: Extreme Foreshortening
                  </h4>
                  <Badge
                    variant="outline"
                    className="border-amber-500/50 bg-amber-500/10 text-amber-400 text-[10px] uppercase"
                  >
                    High
                  </Badge>
                </div>
                <p className="text-xs text-amber-300/80">
                  "Distorted Distances" — 2D pixel reach distances unreliable for real-world cm
                </p>
              </div>
              <div className="rounded-md bg-amber-600 px-2.5 py-1 font-bold text-amber-50 text-xs tracking-wider shadow-lg shadow-amber-900/30">
                UNRELIABLE
              </div>
            </div>
            <p className="mb-3 text-sm text-muted-foreground">{flaw3.details}</p>
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-lg bg-background/50 p-3">
                <div className="text-xs text-muted-foreground">Measured (pixels)</div>
                <div className="font-mono text-xl font-bold text-foreground tabular-nums">
                  {flaw3.pixelDistanceMeasured} px
                </div>
              </div>
              <div className="rounded-lg bg-background/50 p-3">
                <div className="text-xs text-muted-foreground">cm Conversion</div>
                <div className="font-mono text-xl font-bold text-amber-400 tabular-nums">
                  N/A
                </div>
                <div className="text-[10px] text-amber-400/70">cannot be calibrated</div>
              </div>
            </div>
            <div className="mt-3 flex flex-wrap gap-1.5">
              <span className="text-xs text-muted-foreground">Most affected directions: </span>
              {flaw3.affectedDirections.map((d) => (
                <Badge
                  key={d}
                  variant="outline"
                  className="border-amber-500/40 bg-amber-500/10 text-amber-300 capitalize"
                >
                  {d}
                </Badge>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Verdict */}
      <div className="rounded-xl border-2 border-red-500/40 bg-gradient-to-br from-red-500/10 via-background to-red-500/5 p-5">
        <div className="mb-2 flex items-center gap-2">
          <ShieldAlert className="size-5 text-red-400" />
          <h3 className="text-base font-bold text-red-400">Clinical Verdict</h3>
        </div>
        <p className="text-sm font-semibold text-foreground">{report.verdict}</p>
        <div className="mt-3 space-y-1.5 text-xs text-muted-foreground">
          <div className="flex gap-2">
            <span className="text-red-400">•</span>
            <span>
              <strong className="text-foreground">Self-occlusion:</strong> {flaw1.avgAbsenceRate.toFixed(1)}% average lower-limb keypoint absence
            </span>
          </div>
          <div className="flex gap-2">
            <span className="text-red-400">•</span>
            <span>
              <strong className="text-foreground">Vertical blindness:</strong> Z-axis (heel lift) completely undetectable
            </span>
          </div>
          <div className="flex gap-2">
            <span className="text-red-400">•</span>
            <span>
              <strong className="text-foreground">Foreshortening:</strong> 2D pixel distances cannot be reliably converted to cm
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
