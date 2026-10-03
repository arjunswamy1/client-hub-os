ALTER TABLE public.client_daily_updates
  ADD COLUMN IF NOT EXISTS update_mode text NOT NULL DEFAULT 'performance'
    CHECK (update_mode IN ('performance','holding'));
COMMENT ON COLUMN public.client_daily_updates.update_mode IS 'performance = the day delivered; holding = no delivery on any spend source, the update says what CPM is working on.';