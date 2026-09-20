INSERT INTO public.client_verticals (client_id, vertical_id, label, ringba_patterns, meta_patterns, ringba_exact_match, position)
SELECT c.id, v.vid, v.lbl, v.pats, '{}'::text[], false, v.pos
FROM public.clients c,
     (VALUES
        ('pest-control', 'Pest Control', ARRAY['Pest Control*','*Pest Control*'], 3),
        ('final-expense', 'Final Expense', ARRAY['Final Expense*','*Final Expense*'], 4)
     ) AS v(vid, lbl, pats, pos)
WHERE c.slug = 'hablyte'
  AND NOT EXISTS (
    SELECT 1 FROM public.client_verticals x WHERE x.client_id = c.id AND x.vertical_id = v.vid
  );