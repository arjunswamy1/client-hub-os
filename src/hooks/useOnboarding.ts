import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

export interface OnboardingToken {
  id: string;
  token: string;
  client_id: string;
  client_name: string;
  company: string | null;
  assigned_emails: string[];
  status: string;
}

export interface SectionData {
  campaign: Record<string, any>;
  creative: Record<string, any>;
  access: Record<string, any>;
  other: Record<string, any>;
}

const SECTIONS = ['campaign', 'creative', 'access', 'other'] as const;

export function useOnboarding(clientId: string | null) {
  const [sectionData, setSectionData] = useState<SectionData>({
    campaign: {},
    creative: {},
    access: {},
    other: {},
  });
  const [currentStep, setCurrentStep] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isComplete, setIsComplete] = useState(false);
  const autosaveTimer = useRef<NodeJS.Timeout | null>(null);

  // Load existing responses
  useEffect(() => {
    if (!clientId) return;
    const load = async () => {
      setIsLoading(true);
      const { data } = await supabase
        .from('onboarding_responses')
        .select('*')
        .eq('client_id', clientId);
      
      if (data && data.length > 0) {
        const loaded: any = { campaign: {}, creative: {}, access: {}, other: {} };
        let allComplete = true;
        data.forEach((r: any) => {
          loaded[r.section] = r.data || {};
          if (!r.completed_at) allComplete = false;
        });
        setSectionData(loaded);
        if (data.length === 4 && allComplete) {
          setIsComplete(true);
        } else {
          // Find first incomplete section
          const firstIncomplete = SECTIONS.findIndex(
            s => !data.find((r: any) => r.section === s && r.completed_at)
          );
          setCurrentStep(firstIncomplete >= 0 ? firstIncomplete : 0);
        }
      }
      setIsLoading(false);
    };
    load();
  }, [clientId]);

  const saveSectionData = useCallback(async (section: string, data: Record<string, any>, markComplete = false) => {
    if (!clientId) return;
    setIsSaving(true);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    const payload: any = {
      client_id: clientId,
      user_id: user.id,
      section,
      data,
      updated_at: new Date().toISOString(),
    };
    if (markComplete) payload.completed_at = new Date().toISOString();

    await supabase
      .from('onboarding_responses')
      .upsert(payload, { onConflict: 'client_id,section' });
    
    setIsSaving(false);
  }, [clientId]);

  const updateSectionField = useCallback((section: keyof SectionData, field: string, value: any) => {
    setSectionData(prev => ({
      ...prev,
      [section]: { ...prev[section], [field]: value },
    }));

    // Autosave after 2 seconds of inactivity
    if (autosaveTimer.current) clearTimeout(autosaveTimer.current);
    autosaveTimer.current = setTimeout(() => {
      setSectionData(current => {
        saveSectionData(section, current[section]);
        return current;
      });
    }, 2000);
  }, [saveSectionData]);

  const goToStep = useCallback(async (step: number) => {
    // Save current section before navigating
    const currentSection = SECTIONS[currentStep];
    await saveSectionData(currentSection, sectionData[currentSection]);
    setCurrentStep(step);
  }, [currentStep, sectionData, saveSectionData]);

  const nextStep = useCallback(async () => {
    const currentSection = SECTIONS[currentStep];
    await saveSectionData(currentSection, sectionData[currentSection], true);
    if (currentStep < 3) {
      setCurrentStep(currentStep + 1);
    }
  }, [currentStep, sectionData, saveSectionData]);

  const prevStep = useCallback(() => {
    if (currentStep > 0) setCurrentStep(currentStep - 1);
  }, [currentStep]);

  const submitOnboarding = useCallback(async () => {
    if (!clientId) return;
    setIsSubmitting(true);

    // Save final section
    const currentSection = SECTIONS[currentStep];
    await saveSectionData(currentSection, sectionData[currentSection], true);

    // Build context
    const fullContext = {
      campaign: sectionData.campaign,
      creative: sectionData.creative,
      access: sectionData.access,
      other: sectionData.other,
      derived: {
        primary_vertical: Array.isArray(sectionData.campaign.verticals) 
          ? sectionData.campaign.verticals[0] 
          : null,
        target_states: sectionData.campaign.states || null,
        budget_level: sectionData.campaign.budget || null,
        communication_preference: sectionData.access.communication || null,
      },
    };

    // Upsert client_context
    await supabase
      .from('client_context')
      .upsert({
        client_id: clientId,
        full_context: fullContext,
        last_updated: new Date().toISOString(),
      }, { onConflict: 'client_id' });

    // Update token status
    await supabase
      .from('onboarding_tokens')
      .update({ status: 'active' })
      .eq('client_id', clientId);

    // Trigger AI summary generation
    try {
      await supabase.functions.invoke('generate-client-summary', {
        body: { client_id: clientId, context: fullContext },
      });
    } catch (e) {
      console.warn('AI summary generation failed, will retry later', e);
    }

    setIsComplete(true);
    setIsSubmitting(false);
    toast.success('Onboarding submitted successfully!');
  }, [clientId, currentStep, sectionData, saveSectionData]);

  return {
    sectionData,
    currentStep,
    isLoading,
    isSaving,
    isSubmitting,
    isComplete,
    updateSectionField,
    nextStep,
    prevStep,
    goToStep,
    submitOnboarding,
  };
}

export function useOnboardingToken(token: string | undefined) {
  const [tokenData, setTokenData] = useState<OnboardingToken | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) { setIsLoading(false); setError('No token provided'); return; }
    const fetch = async () => {
      const { data, error: err } = await supabase
        .from('onboarding_tokens')
        .select('*')
        .eq('token', token)
        .maybeSingle();
      
      if (err || !data) {
        setError('Invalid or expired onboarding link.');
      } else if (data.status === 'expired') {
        setError('This onboarding link has expired.');
      } else {
        setTokenData(data as OnboardingToken);
      }
      setIsLoading(false);
    };
    fetch();
  }, [token]);

  return { tokenData, isLoading, error };
}
