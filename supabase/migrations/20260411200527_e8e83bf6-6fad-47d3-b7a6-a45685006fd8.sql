DELETE FROM public.ringba_calls 
WHERE (metadata->>'publisher') IS DISTINCT FROM 'CPM' 
   OR campaign_name NOT IN ('Premium Flights Call Flow', 'Pest Control US Call Flow', 'Potty US Call Flow');