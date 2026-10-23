// Adapted from Tremor Raw Card [v1.0.0] and ProgressBar [v0.0.3].
// https://github.com/tremorlabs/tremor — Apache-2.0; see LICENSE and NOTICE.
// Modified for Syntolk: scoped CSS replaces Tailwind/variants; no Slot dependency;
// progress values are finite and clamped, including an empty/zero-sized plan.
import { forwardRef, type ComponentPropsWithoutRef } from 'react';
import { Card } from './raw/components/Card/Card.js';
import { ProgressBar } from './raw/components/ProgressBar/ProgressBar.js';
import { usePartnerVisual } from './PartnerVisual.js';

export const TremorCard = forwardRef<HTMLDivElement, ComponentPropsWithoutRef<'div'>>(
  ({ className = '', ...props }, ref) => {
    const tremor=usePartnerVisual();
    return tremor?<Card ref={ref} className={`ph-card p-0 ${className}`} {...props}/>:<div ref={ref} className={`ph-card ${className}`} tremor-id="tremor-raw" {...props}/>;
  },
);
TremorCard.displayName = 'TremorCard';

interface ProgressBarProps extends ComponentPropsWithoutRef<'div'> {
  value?: number;
  max?: number;
}

export const TremorProgressBar = forwardRef<HTMLDivElement, ProgressBarProps>(
  ({ value = 0, max = 100, className = '', ...props }, ref) => {
    const tremor=usePartnerVisual();
    const safeMax = Number.isFinite(max) ? Math.max(0, max) : 0;
    const safeValue = Number.isFinite(value) ? Math.min(safeMax, Math.max(0, value)) : 0;
    if(tremor)return <ProgressBar ref={ref} value={safeValue} max={safeMax} showAnimation={false} className={className} {...props}/>;
    return (
      <div ref={ref} className={`ph-progress ${className}`} role="progressbar"
        aria-label="Progress bar" aria-valuemin={0} aria-valuemax={safeMax}
        aria-valuenow={safeValue} tremor-id="tremor-raw" {...props}>
        <div className="ph-progress__track">
          <div className="ph-progress__bar" style={{ width: `${safeMax ? safeValue / safeMax * 100 : 0}%` }} />
        </div>
      </div>
    );
  },
);
TremorProgressBar.displayName = 'TremorProgressBar';
