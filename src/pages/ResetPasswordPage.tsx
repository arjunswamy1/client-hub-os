import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { toast } from 'sonner';

export default function ResetPasswordPage() {
  const [ready, setReady] = useState(false);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    // The recovery link delivers a session (hash or code exchange handled by supabase-js)
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session) setReady(true);
    });
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) setReady(true);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password.length < 8) { toast.error('Password must be at least 8 characters'); return; }
    if (password !== confirm) { toast.error('Passwords do not match'); return; }
    setIsLoading(true);
    try {
      const { error } = await supabase.auth.updateUser({
        password,
        data: { must_change_password: false },
      });
      if (error) throw error;
      toast.success('Password updated — you are signed in');
      navigate('/');
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <Card className="w-full max-w-sm">
        <CardHeader className="text-center">
          <img src="/logo.png" alt="Connect Paid Media" className="mx-auto mb-3 h-14 w-14 object-contain" />
          <CardTitle className="text-xl">Choose a new password</CardTitle>
          <CardDescription>
            {ready
              ? 'Enter a new password for your Connect Paid Media Hub account.'
              : 'Open this page from the password reset link in your email.'}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="new-password">New password</Label>
              <Input id="new-password" type="password" value={password} minLength={8} required
                onChange={e => setPassword(e.target.value)} placeholder="••••••••" disabled={!ready} autoFocus />
            </div>
            <div className="space-y-2">
              <Label htmlFor="confirm-password">Confirm new password</Label>
              <Input id="confirm-password" type="password" value={confirm} minLength={8} required
                onChange={e => setConfirm(e.target.value)} placeholder="••••••••" disabled={!ready} />
            </div>
            <Button type="submit" className="w-full" disabled={isLoading || !ready}>
              {isLoading ? 'Updating...' : 'Update password'}
            </Button>
          </form>
          <p className="mt-4 text-center text-sm text-muted-foreground">
            <button type="button" className="text-primary hover:underline" onClick={() => navigate('/auth')}>
              Back to sign in
            </button>
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
