import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
);

Deno.serve(async () => {
  const users = [
    { email: 'omar@connectpaidmedia.com', password: 'ConnectPaidMedia123' },
  ];

  const results = [];

  for (const u of users) {
    const { data: authData, error: authError } = await supabase.auth.admin.createUser({
      email: u.email,
      password: u.password,
      email_confirm: true,
      user_metadata: { must_change_password: true },
    });

    if (authError) {
      results.push({ email: u.email, error: authError.message });
      continue;
    }

    // Link to team_members
    const { error: updateError } = await supabase
      .from('team_members')
      .update({ user_id: authData.user.id })
      .eq('email', u.email);

    results.push({ email: u.email, userId: authData.user.id, linked: !updateError });
  }

  return new Response(JSON.stringify(results, null, 2), {
    headers: { 'Content-Type': 'application/json' },
  });
});
