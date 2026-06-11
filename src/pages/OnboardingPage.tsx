import { useParams } from 'react-router-dom';
import { useOnboardingToken } from '@/hooks/useOnboarding';
import { KickoffIntro } from '@/components/onboarding/KickoffIntro';

export default function OnboardingPage() {
  const { token } = useParams<{ token: string }>();
  const { tokenData, isLoading, error } = useOnboardingToken(token);

  if (isLoading) {
    return (
      <div className="min-h-screen bg-[#F0F4F2] flex items-center justify-center">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-[#3CAB7A] border-t-transparent" />
      </div>
    );
  }

  if (error || !tokenData) {
    return (
      <div className="min-h-screen bg-[#F0F4F2] flex items-center justify-center">
        <div className="bg-white rounded-xl shadow-lg p-10 text-center max-w-md">
          <h1 className="text-xl font-bold text-gray-900 mb-2">Invalid Link</h1>
          <p className="text-sm text-gray-500">{error || 'This onboarding link is not valid.'}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#F0F4F2]">
      <div className="bg-[#111111] px-6 md:px-10 py-7 flex items-center gap-4">
        <div className="flex flex-col leading-none">
          <div className="text-[22px] font-extrabold tracking-wider text-white">
            CONNECT<span className="text-[#3CAB7A]">PAID</span>
          </div>
          <div className="text-[22px] font-extrabold tracking-[0.18em] text-white">
            MEDIA
          </div>
        </div>
      </div>

      <div className="max-w-[680px] mx-auto mt-12 px-5 pb-16">
        <KickoffIntro
          clientName={tokenData.client_name}
          videoUrl={(tokenData as any).kickoff_video_url}
          intro={(tokenData as any).kickoff_intro}
          actionItems={(tokenData as any).kickoff_action_items}
        />
      </div>
    </div>
  );
}
