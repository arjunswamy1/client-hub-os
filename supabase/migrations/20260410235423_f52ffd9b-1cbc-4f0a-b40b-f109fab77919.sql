
ALTER TABLE public.creative_briefs DROP CONSTRAINT creative_briefs_objective_check;
ALTER TABLE public.creative_briefs ADD CONSTRAINT creative_briefs_objective_check CHECK (objective IS NULL OR objective = ANY (ARRAY['awareness','consideration','conversion','retargeting']));

ALTER TABLE public.creative_briefs DROP CONSTRAINT creative_briefs_creative_type_check;
ALTER TABLE public.creative_briefs ADD CONSTRAINT creative_briefs_creative_type_check CHECK (creative_type = ANY (ARRAY['static','video','carousel','story_reel','ugc','motion','other']));
