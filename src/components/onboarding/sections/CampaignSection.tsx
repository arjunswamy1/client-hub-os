import { OnboardingField, CheckboxGrid, OnboardingTextInput, OnboardingTextarea, FieldDivider } from '../OnboardingField';
import { SectionData } from '@/hooks/useOnboarding';

const VERTICALS = [
  'Final Expense', 'Affordable Care Act', 'U65 Insurance', 'Medicare',
  'Solar', 'Auto', 'Debt Consolidation', 'Other',
];

interface CampaignSectionProps {
  data: SectionData['campaign'];
  onUpdate: (field: string, value: any) => void;
  onNext: () => void;
  errors: Record<string, string>;
}

export function CampaignSection({ data, onUpdate, onNext, errors }: CampaignSectionProps) {
  return (
    <div className="bg-white rounded-xl shadow-[0_4px_24px_rgba(0,0,0,0.08)] overflow-hidden">
      <div className="bg-[#3CAB7A] px-6 md:px-9 py-7">
        <div className="text-[11px] font-semibold uppercase tracking-[0.1em] text-white/70 mb-1.5">
          Section 1 of 4
        </div>
        <div className="text-2xl font-bold text-white">Campaign Setup</div>
        <div className="mt-2.5 text-sm text-white/80 leading-relaxed">
          We're looking forward to partnering with you. Please take a few minutes to fill out the questions below as we begin the onboarding process. Thanks so much for trusting us with your business!
        </div>
      </div>

      <div className="px-6 md:px-9 py-7 flex flex-col gap-7">
        <OnboardingField label="Vertical(s)" hint="Select all that apply." required error={errors.verticals}>
          <CheckboxGrid
            options={VERTICALS}
            selected={data.verticals || []}
            onChange={v => onUpdate('verticals', v)}
          />
        </OnboardingField>

        <FieldDivider />

        <OnboardingField label="States to Target" hint="List all states or regions you'd like to run campaigns in." required error={errors.states}>
          <OnboardingTextarea
            value={data.states || ''}
            onChange={v => onUpdate('states', v)}
            placeholder="e.g. California, Texas, Florida, New York..."
          />
        </OnboardingField>

        <FieldDivider />

        <OnboardingField label="Call Center Days / Times" hint="Include timezone." required error={errors.calltimes}>
          <OnboardingTextInput
            value={data.calltimes || ''}
            onChange={v => onUpdate('calltimes', v)}
            placeholder="e.g. Mon–Fri, 8am–8pm EST"
          />
        </OnboardingField>

        <FieldDivider />

        <OnboardingField label="Key Performance Indicators" hint="What are your cost-per-call or cost-per-policy goals?" required error={errors.kpi}>
          <OnboardingTextarea
            value={data.kpi || ''}
            onChange={v => onUpdate('kpi', v)}
            placeholder="e.g. Target cost per call: $25, cost per policy: $200..."
          />
        </OnboardingField>

        <FieldDivider />

        <OnboardingField label="Starting Daily Budget or Desired Calls Per Day" required error={errors.budget}>
          <OnboardingTextarea
            value={data.budget || ''}
            onChange={v => onUpdate('budget', v)}
            placeholder="e.g. $500/day budget, or 50 calls per day..."
          />
        </OnboardingField>
      </div>

      <div className="flex justify-end px-6 md:px-9 py-6 border-t border-gray-100">
        <button
          onClick={onNext}
          className="bg-[#3CAB7A] text-white font-semibold text-sm px-7 py-3 rounded-lg hover:bg-[#2D8F63] hover:-translate-y-0.5 hover:shadow-[0_4px_12px_rgba(60,171,122,0.35)] transition-all"
        >
          Continue →
        </button>
      </div>
    </div>
  );
}
