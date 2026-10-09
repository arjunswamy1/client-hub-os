ALTER VIEW public.platform_connections_safe SET (security_invoker = on);
REVOKE ALL ON public.platform_connections_safe FROM anon;
GRANT SELECT ON public.platform_connections_safe TO authenticated;
GRANT SELECT ON public.platform_connections_safe TO service_role;