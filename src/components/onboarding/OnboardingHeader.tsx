import { cn } from '@/lib/utils';
import { Check } from 'lucide-react';

const STEPS = [
  { label: 'Campaign', number: 1 },
  { label: 'Creative', number: 2 },
  { label: 'Access', number: 3 },
  { label: 'Other', number: 4 },
];

interface OnboardingHeaderProps {
  currentStep: number;
  isSaving?: boolean;
}

export function OnboardingHeader({ currentStep, isSaving }: OnboardingHeaderProps) {
  return (
    <>
      {/* Header */}
      <div className="bg-[#111111] px-6 md:px-10 py-7 flex items-center gap-4">
        <div className="flex flex-col leading-none">
          <div className="text-[22px] font-extrabold tracking-wider text-white">
            CONNECT<span className="text-[#3CAB7A]">PAID</span>
          </div>
          <div className="text-[22px] font-extrabold tracking-[0.18em] text-white">
            MEDIA
          </div>
        </div>
        <div className="w-px h-11 bg-white/15 mx-4 hidden md:block" />
        <div className="text-[13px] text-white/50 font-normal tracking-wide hidden md:block">
          Client Onboarding
        </div>
        {isSaving && (
          <div className="ml-auto text-xs text-white/40 animate-pulse">Saving...</div>
        )}
      </div>

      {/* Progress Steps */}
      <div className="bg-[#111111] px-6 md:px-10 pb-7">
        <div className="flex max-w-[640px]">
          {STEPS.map((step, i) => {
            const isDone = i < currentStep;
            const isActive = i === currentStep;
            return (
              <div key={step.label} className="flex flex-col items-center flex-1 relative">
                {i < STEPS.length - 1 && (
                  <div
                    className={cn(
                      "absolute top-[14px] left-1/2 w-full h-0.5 z-0",
                      isDone || isActive ? "bg-[#3CAB7A]" : "bg-white/15"
                    )}
                  />
                )}
                <div
                  className={cn(
                    "w-7 h-7 rounded-full flex items-center justify-center text-[11px] font-bold relative z-10 transition-all",
                    isDone && "bg-[#2D8F63] border-[#2D8F63] text-white border-2",
                    isActive && "bg-[#3CAB7A] border-[#3CAB7A] text-white border-2",
                    !isDone && !isActive && "bg-white/10 border-2 border-white/20 text-white/40"
                  )}
                >
                  {isDone ? <Check className="w-3.5 h-3.5" /> : step.number}
                </div>
                <div
                  className={cn(
                    "text-[10px] font-medium mt-1.5 text-center tracking-wider uppercase",
                    isDone && "text-white/55",
                    isActive && "text-[#3CAB7A]",
                    !isDone && !isActive && "text-white/35"
                  )}
                >
                  {step.label}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </>
  );
}
