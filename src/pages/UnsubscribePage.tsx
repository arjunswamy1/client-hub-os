import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { CheckCircle2, AlertCircle, Loader2 } from 'lucide-react';

type State = 'loading' | 'valid' | 'already' | 'invalid' | 'success' | 'error';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string;

export default function UnsubscribePage() {
  const [params] = useSearchParams();
  const token = params.get('token');
  const [state, setState] = useState<State>('loading');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!token) {
      setState('invalid');
      return;
    }
    (async () => {
      try {
        const res = await fetch(
          `${SUPABASE_URL}/functions/v1/handle-email-unsubscribe?token=${encodeURIComponent(token)}`,
          { headers: { apikey: SUPABASE_ANON_KEY } }
        );
        const data = await res.json();
        if (data?.valid === true) setState('valid');
        else if (data?.reason === 'already_unsubscribed') setState('already');
        else setState('invalid');
      } catch {
        setState('error');
      }
    })();
  }, [token]);

  const confirm = async () => {
    if (!token) return;
    setSubmitting(true);
    try {
      const { data, error } = await supabase.functions.invoke('handle-email-unsubscribe', {
        body: { token },
      });
      if (error) throw error;
      if (data?.success) setState('success');
      else if (data?.reason === 'already_unsubscribed') setState('already');
      else setState('error');
    } catch {
      setState('error');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-[hsl(222,47%,8%)] to-[hsl(222,47%,12%)] flex items-center justify-center p-4">
      <div className="w-full max-w-md rounded-2xl border border-white/10 bg-white/5 p-8 text-center space-y-5">
        <div className="text-xs font-semibold tracking-[0.18em] text-[hsl(94,55%,55%)]">
          CONNECT PAID MEDIA
        </div>

        {state === 'loading' && (
          <>
            <Loader2 className="h-8 w-8 mx-auto animate-spin text-white/60" />
            <p className="text-white/70">Checking your link…</p>
          </>
        )}

        {state === 'valid' && (
          <>
            <h1 className="text-2xl font-bold text-white">Unsubscribe from emails?</h1>
            <p className="text-white/60 leading-relaxed">
              You'll stop receiving updates from Connect Paid Media at this address.
            </p>
            <Button
              onClick={confirm}
              disabled={submitting}
              className="w-full bg-[hsl(94,55%,40%)] hover:bg-[hsl(94,55%,35%)] text-white h-12 rounded-xl"
            >
              {submitting ? 'Processing…' : 'Confirm unsubscribe'}
            </Button>
          </>
        )}

        {state === 'success' && (
          <>
            <CheckCircle2 className="h-10 w-10 mx-auto text-emerald-400" />
            <h1 className="text-2xl font-bold text-white">You're unsubscribed</h1>
            <p className="text-white/60">
              We won't send any more emails to this address.
            </p>
          </>
        )}

        {state === 'already' && (
          <>
            <CheckCircle2 className="h-10 w-10 mx-auto text-white/60" />
            <h1 className="text-2xl font-bold text-white">Already unsubscribed</h1>
            <p className="text-white/60">This address is already opted out.</p>
          </>
        )}

        {(state === 'invalid' || state === 'error') && (
          <>
            <AlertCircle className="h-10 w-10 mx-auto text-rose-400" />
            <h1 className="text-2xl font-bold text-white">
              {state === 'invalid' ? 'Invalid link' : 'Something went wrong'}
            </h1>
            <p className="text-white/60">
              {state === 'invalid'
                ? 'This unsubscribe link is invalid or expired.'
                : 'Please try again later or contact support.'}
            </p>
          </>
        )}
      </div>
    </div>
  );
}
