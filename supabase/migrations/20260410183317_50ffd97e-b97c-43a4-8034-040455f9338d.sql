
-- Drop the overly permissive insert policy
DROP POLICY IF EXISTS "Authenticated users can insert notifications" ON public.notifications;

-- Replace with a scoped policy: can insert notifications only if you have access to the brief's client
CREATE POLICY "Users insert notifications for accessible briefs" ON public.notifications
  FOR INSERT TO authenticated WITH CHECK (
    public.is_admin(auth.uid())
    OR brief_id IS NULL
    OR EXISTS (
      SELECT 1 FROM public.creative_briefs b
      WHERE b.id = notifications.brief_id
      AND public.has_client_access(auth.uid(), b.client_id)
    )
  );
