import { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useOnboarding, useOnboardingToken } from '@/hooks/useOnboarding';
import { OnboardingHeader } from '@/components/onboarding/OnboardingHeader';
import { OnboardingSuccess } from '@/components/onboarding/OnboardingSuccess';
import { CampaignSection } from '@/components/onboarding/sections/CampaignSection';
import { CreativeSection } from '@/components/onboarding/sections/CreativeSection';
import { AccessSection } from '@/components/onboarding/sections/AccessSection';
import { OtherSection } from '@/components/onboarding/sections/OtherSection';

function CreateAccountStep({ tokenData, onAccountCreated }: {
  tokenData: any;
  onAccountCreated: () => void;
}) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const newErrors: Record<string, string> = {};
    if (!email) newErrors.email = 'Email is required';
    if (!password || password.length < 8) newErrors.password = 'Min 8 characters';
    if (password !== confirmPassword) newErrors.confirmPassword = 'Passwords do not match';
    if (Object.keys(newErrors).length > 0) { setErrors(newErrors); return; }

    setIsCreating(true);
    setErrors({});

    // Try sign up
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: {
          client_id: tokenData.client_id,
          onboarding_token_id: tokenData.id,
          is_client_user: true,
        },
      },
    });

    if (error) {
      // If user already exists, try to sign in
      if (error.message.includes('already registered') || error.message.includes('already exists')) {
        const { error: loginErr } = await supabase.auth.signInWithPassword({ email, password });
        if (loginErr) {
          setErrors({ email: 'Account exists. Check your password.' });
          setIsCreating(false);
          return;
        }
      } else {
        setErrors({ email: error.message });
        setIsCreating(false);
        return;
      }
    }

    // Create client_user record
    const { data: { user } } = await supabase.auth.getUser();
    if (user) {
      await supabase.from('client_users').upsert({
        user_id: user.id,
        client_id: tokenData.client_id,
        display_name: email.split('@')[0],
        onboarding_token_id: tokenData.id,
      }, { onConflict: 'user_id,client_id' });

      // Update token status
      await supabase
        .from('onboarding_tokens')
        .update({ status: 'onboarding' })
        .eq('id', tokenData.id);
    }

    setIsCreating(false);
    onAccountCreated();
  };

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

      <div className="max-w-[480px] mx-auto mt-12 px-5">
        <div className="bg-white rounded-xl shadow-[0_4px_24px_rgba(0,0,0,0.08)] overflow-hidden">
          <div className="bg-[#3CAB7A] px-8 py-8">
            <h1 className="text-2xl font-bold text-white">Create Your Client Hub Account</h1>
            <p className="mt-2 text-sm text-white/80">
              Welcome, {tokenData.client_name}! Create your account to begin onboarding.
            </p>
          </div>

          <form onSubmit={handleSubmit} className="px-8 py-8 space-y-5">
            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-semibold text-gray-900">Email</label>
              <input
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="you@company.com"
                className="w-full text-sm bg-gray-50 border-[1.5px] border-gray-300 rounded-lg px-4 py-3 outline-none focus:border-[#3CAB7A] focus:bg-white transition-all"
                required
              />
              {errors.email && <p className="text-xs text-red-500 font-medium">{errors.email}</p>}
            </div>

            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-semibold text-gray-900">Password</label>
              <input
                type="password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder="Min. 8 characters"
                className="w-full text-sm bg-gray-50 border-[1.5px] border-gray-300 rounded-lg px-4 py-3 outline-none focus:border-[#3CAB7A] focus:bg-white transition-all"
                required
                minLength={8}
              />
              {errors.password && <p className="text-xs text-red-500 font-medium">{errors.password}</p>}
            </div>

            <div className="flex flex-col gap-1.5">
              <label className="text-sm font-semibold text-gray-900">Confirm Password</label>
              <input
                type="password"
                value={confirmPassword}
                onChange={e => setConfirmPassword(e.target.value)}
                placeholder="Confirm your password"
                className="w-full text-sm bg-gray-50 border-[1.5px] border-gray-300 rounded-lg px-4 py-3 outline-none focus:border-[#3CAB7A] focus:bg-white transition-all"
                required
                minLength={8}
              />
              {errors.confirmPassword && <p className="text-xs text-red-500 font-medium">{errors.confirmPassword}</p>}
            </div>

            <button
              type="submit"
              disabled={isCreating}
              className="w-full bg-[#3CAB7A] text-white font-semibold text-sm py-3 rounded-lg hover:bg-[#2D8F63] transition-all disabled:opacity-50"
            >
              {isCreating ? 'Creating Account...' : 'Create Account & Start Onboarding'}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}

function OnboardingSurvey({ clientId }: { clientId: string }) {
  const {
    sectionData, currentStep, isLoading, isSaving, isSubmitting, isComplete,
    updateSectionField, nextStep, prevStep, submitOnboarding,
  } = useOnboarding(clientId);

  const [errors, setErrors] = useState<Record<string, string>>({});

  const validateCampaign = () => {
    const e: Record<string, string> = {};
    const d = sectionData.campaign;
    if (!d.verticals?.length) e.verticals = 'Please select at least one vertical.';
    if (!d.states?.trim()) e.states = 'This field is required.';
    if (!d.calltimes?.trim()) e.calltimes = 'This field is required.';
    if (!d.kpi?.trim()) e.kpi = 'This field is required.';
    if (!d.budget?.trim()) e.budget = 'This field is required.';
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const validateAccess = () => {
    const e: Record<string, string> = {};
    const d = sectionData.access;
    if (!d.platforms?.length && !d.platforms_other?.trim()) e.platforms = 'Please select at least one platform.';
    if (!d.communication) e.communication = 'Please select a communication preference.';
    setErrors(e);
    return Object.keys(e).length === 0;
  };

  const handleNext = () => {
    if (currentStep === 0 && !validateCampaign()) return;
    if (currentStep === 2 && !validateAccess()) return;
    setErrors({});
    nextStep();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleBack = () => {
    setErrors({});
    prevStep();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleSubmit = () => {
    submitOnboarding();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-[#F0F4F2] flex items-center justify-center">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-[#3CAB7A] border-t-transparent" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#F0F4F2] pb-16">
      <OnboardingHeader currentStep={isComplete ? 4 : currentStep} isSaving={isSaving} />
      
      <div className="max-w-[680px] mx-auto mt-10 px-5">
        {isComplete ? (
          <OnboardingSuccess />
        ) : (
          <>
            {currentStep === 0 && (
              <CampaignSection
                data={sectionData.campaign}
                onUpdate={(f, v) => updateSectionField('campaign', f, v)}
                onNext={handleNext}
                errors={errors}
              />
            )}
            {currentStep === 1 && (
              <CreativeSection
                data={sectionData.creative}
                onUpdate={(f, v) => updateSectionField('creative', f, v)}
                onNext={handleNext}
                onBack={handleBack}
              />
            )}
            {currentStep === 2 && (
              <AccessSection
                data={sectionData.access}
                onUpdate={(f, v) => updateSectionField('access', f, v)}
                onNext={handleNext}
                onBack={handleBack}
                errors={errors}
              />
            )}
            {currentStep === 3 && (
              <OtherSection
                data={sectionData.other}
                onUpdate={(f, v) => updateSectionField('other', f, v)}
                onSubmit={handleSubmit}
                onBack={handleBack}
                isSubmitting={isSubmitting}
              />
            )}
          </>
        )}
      </div>
    </div>
  );
}

export default function OnboardingPage() {
  const { token } = useParams<{ token: string }>();
  const { tokenData, isLoading, error } = useOnboardingToken(token);
  const [isAuthenticated, setIsAuthenticated] = useState<boolean | null>(null);
  const [checkingAuth, setCheckingAuth] = useState(true);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setIsAuthenticated(!!session);
      setCheckingAuth(false);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_e, session) => {
      setIsAuthenticated(!!session);
    });

    return () => subscription.unsubscribe();
  }, []);

  if (isLoading || checkingAuth) {
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

  if (!isAuthenticated) {
    return <CreateAccountStep tokenData={tokenData} onAccountCreated={() => setIsAuthenticated(true)} />;
  }

  return <OnboardingSurvey clientId={tokenData.client_id} />;
}
