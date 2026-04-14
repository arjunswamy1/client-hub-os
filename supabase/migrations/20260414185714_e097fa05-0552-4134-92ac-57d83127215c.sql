ALTER TABLE public.creative_briefs DROP CONSTRAINT creative_briefs_creative_type_check;

ALTER TABLE public.creative_briefs ADD CONSTRAINT creative_briefs_creative_type_check CHECK (creative_type = ANY (ARRAY['static','video','carousel','story_reel','ugc','motion','display_banner','ott_ctv','other']));