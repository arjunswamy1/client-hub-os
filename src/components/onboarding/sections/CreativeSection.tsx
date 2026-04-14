import { OnboardingField, OnboardingTextarea, FieldDivider } from '../OnboardingField';
import { SectionData } from '@/hooks/useOnboarding';

interface CreativeSectionProps {
  data: SectionData['creative'];
  onUpdate: (field: string, value: any) => void;
  onNext: () => void;
  onBack: () => void;
}

export function CreativeSection({ data, onUpdate, onNext, onBack }: CreativeSectionProps) {
  return (
    <div className="bg-white rounded-xl shadow-[0_4px_24px_rgba(0,0,0,0.08)] overflow-hidden">
      <div className="bg-[#3CAB7A] px-6 md:px-9 py-7">
        <div className="text-[11px] font-semibold uppercase tracking-[0.1em] text-white/70 mb-1.5">
          Section 2 of 4 — Optional
        </div>
        <div className="text-2xl font-bold text-white">Creative Overview</div>
        <div className="mt-2.5 text-sm text-white/80 leading-relaxed">
          This section is optional, but we like to ask — knowing that every client has specific needs. Share what you have and we'll take it from there.
        </div>
      </div>

      <div className="px-6 md:px-9 py-7 flex flex-col gap-7">
        <OnboardingField label="Example or Existing Landing Pages" hint="Paste URLs or describe pages you've used or like.">
          <OnboardingTextarea
            value={data.landing_pages || ''}
            onChange={v => onUpdate('landing_pages', v)}
            placeholder="https://..."
          />
        </OnboardingField>

        <FieldDivider />

        <OnboardingField label="Owned Domains We Should Use" hint="If none, we'll purchase one on your behalf.">
          <OnboardingTextarea
            value={data.domains || ''}
            onChange={v => onUpdate('domains', v)}
            placeholder="e.g. mysite.com, brandname.net..."
          />
        </OnboardingField>

        <FieldDivider />

        <OnboardingField label="Example Ads or Existing Creative" hint="Paste links, describe your current ads, or note what's worked before.">
          <OnboardingTextarea
            value={data.creative || ''}
            onChange={v => onUpdate('creative', v)}
            placeholder="Describe existing ads or share links..."
          />
        </OnboardingField>

        <FieldDivider />

        <OnboardingField label="Creative Guidelines & Restrictions" hint='Angles not approved, words or verbiage that can&apos;t appear in copy, compliance rules, etc. For example: "ACA ads may not mention subsidy."'>
          <OnboardingTextarea
            value={data.guidelines || ''}
            onChange={v => onUpdate('guidelines', v)}
            placeholder="List any restrictions, compliance rules, or creative do's and don'ts..."
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
