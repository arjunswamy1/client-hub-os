import { OnboardingField, CheckboxGrid, RadioGroup, FieldDivider } from '../OnboardingField';
import { SectionData } from '@/hooks/useOnboarding';

const PLATFORMS = [
  'Meta', 'Google', 'Bing', 'Taboola', 'Outbrain',
  'Ringba', 'Redtrack', 'Retreaver', 'Leadsprosper',
];

const COMM_OPTIONS = ['Slack', 'Email', 'Teams', 'Telegram'];

const TEAM_EMAILS = [
  'charles@connectpaidmedia.com',
  'henry@connectpaidmedia.com',
  'omar@connectpaidmedia.com',
  'aj@connectpaidmedia.com',
];

interface AccessSectionProps {
  data: SectionData['access'];
  onUpdate: (field: string, value: any) => void;
  onNext: () => void;
  onBack: () => void;
  errors: Record<string, string>;
}

export function AccessSection({ data, onUpdate, onNext, onBack, errors }: AccessSectionProps) {
  return (
    <div className="bg-white rounded-xl shadow-[0_4px_24px_rgba(0,0,0,0.08)] overflow-hidden">
      <div className="bg-[#3CAB7A] px-6 md:px-9 py-7">
        <div className="text-[11px] font-semibold uppercase tracking-[0.1em] text-white/70 mb-1.5">
          Section 3 of 4
        </div>
        <div className="text-2xl font-bold text-white">Reporting + Account Access</div>
        <div className="mt-2.5 text-sm text-white/80 leading-relaxed">
          We want to be sure we have complete access to all necessary reporting to manage your campaigns effectively.
        </div>
      </div>

      {/* Info Block */}
      <div className="mx-6 md:mx-9 mt-7 bg-[#EAF7F1] border-l-4 border-[#3CAB7A] rounded-lg px-5 py-4">
        <div className="text-[13px] font-bold text-[#2D8F63] uppercase tracking-wide mb-2">Action Required</div>
        <div className="text-sm text-gray-700 leading-relaxed">
          Please send Admin access invites for all relevant platforms to the following team members:
        </div>
        <div className="flex flex-wrap gap-2 mt-2.5">
          {TEAM_EMAILS.map(email => (
            <span key={email} className="bg-white border border-[#3CAB7A] text-[#2D8F63] text-xs font-semibold px-3 py-1 rounded-full">
              {email}
            </span>
          ))}
        </div>
      </div>

      <div className="px-6 md:px-9 py-7 flex flex-col gap-7">
        <OnboardingField label="Platforms to Send Invites For" hint="Check all platforms you're currently using or plan to use." required error={errors.platforms}>
          <CheckboxGrid
            options={PLATFORMS}
            selected={data.platforms || []}
            onChange={v => onUpdate('platforms', v)}
            withOther
            otherValue={data.platforms_other || ''}
            onOtherChange={v => onUpdate('platforms_other', v)}
          />
        </OnboardingField>

        <FieldDivider />

        <OnboardingField label="Preferred Method of Communication" required error={errors.communication}>
          <RadioGroup
            options={COMM_OPTIONS}
            value={data.communication || null}
            onChange={v => onUpdate('communication', v)}
          />
        </OnboardingField>
      </div>

      <div className="flex justify-between px-6 md:px-9 py-6 border-t border-gray-100">
        <button onClick={onBack} className="text-gray-500 font-semibold text-sm px-7 py-3 rounded-lg border-[1.5px] border-gray-300 hover:border-gray-500 hover:text-gray-700 transition-all">
          ← Back
        </button>
        <button onClick={onNext} className="bg-[#3CAB7A] text-white font-semibold text-sm px-7 py-3 rounded-lg hover:bg-[#2D8F63] hover:-translate-y-0.5 hover:shadow-[0_4px_12px_rgba(60,171,122,0.35)] transition-all">
          Continue →
        </button>
      </div>
    </div>
  );
}
