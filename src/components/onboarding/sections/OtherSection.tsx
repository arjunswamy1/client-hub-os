import { OnboardingField, OnboardingTextarea, FieldDivider } from '../OnboardingField';
import { SectionData } from '@/hooks/useOnboarding';

interface OtherSectionProps {
  data: SectionData['other'];
  onUpdate: (field: string, value: any) => void;
  onSubmit: () => void;
  onBack: () => void;
  isSubmitting: boolean;
}

export function OtherSection({ data, onUpdate, onSubmit, onBack, isSubmitting }: OtherSectionProps) {
  return (
    <div className="bg-white rounded-xl shadow-[0_4px_24px_rgba(0,0,0,0.08)] overflow-hidden">
      <div className="bg-[#3CAB7A] px-6 md:px-9 py-7">
        <div className="text-[11px] font-semibold uppercase tracking-[0.1em] text-white/70 mb-1.5">
          Section 4 of 4
        </div>
        <div className="text-2xl font-bold text-white">Other Info</div>
        <div className="mt-2.5 text-sm text-white/80 leading-relaxed">
          Almost done! Share any additional context that will help us hit the ground running.
        </div>
      </div>

      <div className="px-6 md:px-9 py-7 flex flex-col gap-7">
        <OnboardingField label="Previous Marketing Efforts" hint="Channels you've run on, challenges you've faced, opportunities you see, etc.">
          <OnboardingTextarea
            value={data.prev_efforts || ''}
            onChange={v => onUpdate('prev_efforts', v)}
            placeholder="Tell us about your history with paid media — what's worked, what hasn't..."
          />
        </OnboardingField>

        <FieldDivider />

        <OnboardingField label="Anything Else We Should Know?">
          <OnboardingTextarea
            value={data.other_info || ''}
            onChange={v => onUpdate('other_info', v)}
            placeholder="Any additional context, constraints, preferences, or goals..."
          />
        </OnboardingField>
      </div>

      <div className="flex justify-between px-6 md:px-9 py-6 border-t border-gray-100">
        <button onClick={onBack} className="text-gray-500 font-semibold text-sm px-7 py-3 rounded-lg border-[1.5px] border-gray-300 hover:border-gray-500 hover:text-gray-700 transition-all">
          ← Back
        </button>
        <button
          onClick={onSubmit}
          disabled={isSubmitting}
          className="bg-[#3CAB7A] text-white font-semibold text-sm px-7 py-3 rounded-lg hover:bg-[#2D8F63] hover:-translate-y-0.5 hover:shadow-[0_4px_12px_rgba(60,171,122,0.35)] transition-all disabled:opacity-50"
        >
          {isSubmitting ? 'Submitting...' : 'Submit Onboarding ✓'}
        </button>
      </div>
    </div>
  );
}
