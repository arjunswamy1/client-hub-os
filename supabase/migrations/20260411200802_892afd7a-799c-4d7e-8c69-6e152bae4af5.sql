UPDATE public.ringba_calls
SET revenue = CASE 
  WHEN converted = true THEN COALESCE((metadata->>'conversionAmount')::numeric, revenue)
  ELSE 0
END;