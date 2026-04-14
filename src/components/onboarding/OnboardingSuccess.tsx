import { Check, Clock, Mail } from 'lucide-react';

export function OnboardingSuccess() {
  return (
    <div className="bg-white rounded-xl shadow-[0_4px_24px_rgba(0,0,0,0.08)] px-6 md:px-10 py-16 text-center">
      <div className="w-[72px] h-[72px] bg-[#EAF7F1] rounded-full flex items-center justify-center mx-auto mb-6">
        <Check className="w-9 h-9 text-[#3CAB7A]" strokeWidth={2.5} />
      </div>
      <h1 className="text-2xl md:text-[26px] font-bold text-gray-900 mb-3">
        Thank you — your onboarding is complete
      </h1>
      <p className="text-[15px] text-gray-500 leading-relaxed max-w-md mx-auto mb-10">
        Our team is now configuring your dashboard experience.
        You'll receive access shortly once everything is ready.
      </p>

      <div className="max-w-sm mx-auto space-y-4 text-left">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-full bg-[#EAF7F1] flex items-center justify-center shrink-0">
            <Check className="w-4 h-4 text-[#3CAB7A]" />
          </div>
          <span className="text-sm font-medium text-gray-700">Onboarding submitted</span>
        </div>
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-full bg-amber-50 flex items-center justify-center shrink-0">
            <Clock className="w-4 h-4 text-amber-500" />
          </div>
          <span className="text-sm font-medium text-gray-500">Dashboard setup in progress</span>
        </div>
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-full bg-blue-50 flex items-center justify-center shrink-0">
            <Mail className="w-4 h-4 text-blue-500" />
          </div>
          <span className="text-sm font-medium text-gray-500">Access email coming soon</span>
        </div>
      </div>
    </div>
  );
}
