import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { toast } from 'sonner';
import { ArrowRight, CheckCircle2, Sparkles } from 'lucide-react';
import { z } from 'zod';

const REVENUE_RANGES = [
  'Under $500K',
  '$500K – $1M',
  '$1M – $5M',
  '$5M – $10M',
  '$10M – $50M',
  '$50M+',
];

const HUB_USER_RANGES = ['1', '2 – 5', '6 – 10', '11 – 25', '25+'];

const USE_CASE_OPTIONS = [
  'Performance reporting & dashboards',
  'AI-driven optimization recommendations',
  'Creative production & briefs',
  'Campaign building & trafficking',
  'Client communication & call agendas',
  'Cross-channel attribution',
];

const signupSchema = z.object({
  name: z.string().trim().min(1, 'Name is required').max(100),
  company: z.string().trim().min(1, 'Company is required').max(150),
  email: z.string().trim().email('Valid email required').max(255),
  phone: z.string().trim().max(30).optional(),
  companyRevenue: z.string().optional(),
  numHubUsers: z.string().optional(),
  useCases: z.array(z.string()).default([]),
});

export default function SignupPage() {
  const navigate = useNavigate();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);

  const [form, setForm] = useState({
    name: '',
    company: '',
    email: '',
    phone: '',
    companyRevenue: '',
    numHubUsers: '',
    useCases: [] as string[],
  });

  const updateField = (field: keyof typeof form, value: any) =>
    setForm((prev) => ({ ...prev, [field]: value }));

  const toggleUseCase = (uc: string) => {
    setForm((prev) => ({
      ...prev,
      useCases: prev.useCases.includes(uc)
        ? prev.useCases.filter((x) => x !== uc)
        : [...prev.useCases, uc],
    }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    const parsed = signupSchema.safeParse(form);
    if (!parsed.success) {
      toast.error(parsed.error.errors[0]?.message || 'Please check your input');
      return;
    }

    setIsSubmitting(true);
    try {
      const [firstName, ...rest] = parsed.data.name.split(' ');
      const lastName = rest.join(' ') || '—';

      const { error } = await supabase.from('leads').insert({
        first_name: firstName,
        last_name: lastName,
        email: parsed.data.email,
        company_name: parsed.data.company,
        phone: parsed.data.phone || null,
        company_revenue: parsed.data.companyRevenue || null,
        num_hub_users: parsed.data.numHubUsers || null,
        use_cases: parsed.data.useCases,
        source: 'conference_signup',
        status: 'new',
      });

      if (error) throw error;

      // Fire welcome email (best-effort — don't block on errors)
      supabase.functions
        .invoke('send-welcome-email', {
          body: {
            email: parsed.data.email,
            name: parsed.data.name,
            company: parsed.data.company,
          },
        })
        .catch((err) => console.warn('Welcome email failed:', err));

      setSuccess(true);
    } catch (err: any) {
      console.error('Signup error:', err);
      toast.error(err.message || 'Something went wrong. Please try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  if (success) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-[hsl(222,47%,8%)] to-[hsl(222,47%,12%)] flex items-center justify-center p-4">
        <div className="w-full max-w-md text-center space-y-6">
          <div className="mx-auto h-16 w-16 rounded-full bg-emerald-500/20 flex items-center justify-center">
            <CheckCircle2 className="h-8 w-8 text-emerald-400" />
          </div>
          <h1 className="text-2xl font-bold text-white">You're on the list!</h1>
          <p className="text-white/60 leading-relaxed">
            Thanks {form.name.split(' ')[0]} — we just sent a welcome email to{' '}
            <span className="text-white font-medium">{form.email}</span> with your demo
            access link.
          </p>
          <p className="text-white/40 text-sm">
            Charles will follow up to schedule your walkthrough.
          </p>
          <Button
            variant="outline"
            className="bg-white/5 border-white/20 text-white hover:bg-white/10"
            onClick={() =>
              window.open('https://calendly.com/charles-connectpaidmedia/30min', '_blank')
            }
          >
            Book a call now
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-[hsl(222,47%,8%)] to-[hsl(222,47%,12%)] text-white">
      <div className="mx-auto max-w-md px-4 py-8 sm:py-12">
        {/* Header — mobile-first, no nav clutter */}
        <div className="mb-8 text-center">
          <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs text-white/70 mb-4">
            <Sparkles className="h-3 w-3 text-[hsl(94,55%,55%)]" />
            Connect Paid Media — The Hub
          </div>
          <h1 className="text-3xl sm:text-4xl font-bold tracking-tight leading-tight">
            Get early access
          </h1>
          <p className="text-white/60 text-sm sm:text-base mt-2 leading-relaxed">
            Tell us about your business and we'll send you a personalized demo.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-5">
          {/* Required */}
          <div className="space-y-1.5">
            <Label className="text-white/80 text-sm">
              Your name <span className="text-rose-400">*</span>
            </Label>
            <Input
              required
              autoComplete="name"
              inputMode="text"
              value={form.name}
              onChange={(e) => updateField('name', e.target.value)}
              className="bg-white/5 border-white/10 text-white placeholder:text-white/30 h-12 text-base"
              placeholder="Jane Smith"
            />
          </div>

          <div className="space-y-1.5">
            <Label className="text-white/80 text-sm">
              Company <span className="text-rose-400">*</span>
            </Label>
            <Input
              required
              autoComplete="organization"
              value={form.company}
              onChange={(e) => updateField('company', e.target.value)}
              className="bg-white/5 border-white/10 text-white placeholder:text-white/30 h-12 text-base"
              placeholder="Acme Co."
            />
          </div>

          <div className="space-y-1.5">
            <Label className="text-white/80 text-sm">
              Email <span className="text-rose-400">*</span>
            </Label>
            <Input
              type="email"
              required
              autoComplete="email"
              inputMode="email"
              value={form.email}
              onChange={(e) => updateField('email', e.target.value)}
              className="bg-white/5 border-white/10 text-white placeholder:text-white/30 h-12 text-base"
              placeholder="jane@acme.com"
            />
          </div>

          <div className="space-y-1.5">
            <Label className="text-white/80 text-sm">Phone</Label>
            <Input
              type="tel"
              autoComplete="tel"
              inputMode="tel"
              value={form.phone}
              onChange={(e) => updateField('phone', e.target.value)}
              className="bg-white/5 border-white/10 text-white placeholder:text-white/30 h-12 text-base"
              placeholder="+1 (555) 123-4567"
            />
          </div>

          <div className="space-y-1.5">
            <Label className="text-white/80 text-sm">Annual revenue</Label>
            <Select
              value={form.companyRevenue}
              onValueChange={(v) => updateField('companyRevenue', v)}
            >
              <SelectTrigger className="bg-white/5 border-white/10 text-white h-12 text-base">
                <SelectValue placeholder="Select range" />
              </SelectTrigger>
              <SelectContent>
                {REVENUE_RANGES.map((r) => (
                  <SelectItem key={r} value={r}>{r}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label className="text-white/80 text-sm">Number of Hub users</Label>
            <Select
              value={form.numHubUsers}
              onValueChange={(v) => updateField('numHubUsers', v)}
            >
              <SelectTrigger className="bg-white/5 border-white/10 text-white h-12 text-base">
                <SelectValue placeholder="How many on your team?" />
              </SelectTrigger>
              <SelectContent>
                {HUB_USER_RANGES.map((r) => (
                  <SelectItem key={r} value={r}>{r}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label className="text-white/80 text-sm">What do you want to use the Hub for?</Label>
            <div className="space-y-2">
              {USE_CASE_OPTIONS.map((uc) => (
                <label
                  key={uc}
                  className="flex items-start gap-3 rounded-lg border border-white/10 bg-white/5 p-3 cursor-pointer hover:bg-white/10 transition-colors"
                >
                  <Checkbox
                    checked={form.useCases.includes(uc)}
                    onCheckedChange={() => toggleUseCase(uc)}
                    className="mt-0.5 border-white/30 data-[state=checked]:bg-[hsl(94,55%,45%)] data-[state=checked]:border-[hsl(94,55%,45%)]"
                  />
                  <span className="text-sm text-white/80 leading-tight">{uc}</span>
                </label>
              ))}
            </div>
          </div>

          <Button
            type="submit"
            disabled={isSubmitting}
            className="w-full bg-[hsl(94,55%,40%)] hover:bg-[hsl(94,55%,35%)] text-white h-14 rounded-xl text-base gap-2 font-semibold mt-2"
          >
            {isSubmitting ? 'Submitting…' : 'Get my demo'}
            <ArrowRight className="h-4 w-4" />
          </Button>

          <p className="text-center text-xs text-white/40 pt-2">
            By signing up, you'll receive a welcome email with next steps.
          </p>
        </form>
      </div>
    </div>
  );
}
