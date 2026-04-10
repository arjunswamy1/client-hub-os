interface Props {
  ad: {
    headline?: string;
    headline_2?: string;
    headline_3?: string;
    description?: string;
    description_2?: string;
    final_url?: string;
  };
}

export function GoogleAdPreview({ ad }: Props) {
  const displayUrl = ad.final_url
    ? new URL(ad.final_url).hostname.replace('www.', '')
    : 'example.com';

  const headlines = [ad.headline, ad.headline_2, ad.headline_3].filter(Boolean);

  if (headlines.length === 0 && !ad.description) {
    return (
      <p className="text-sm text-muted-foreground text-center py-8">
        Add headlines and descriptions to see a Google Ads preview.
      </p>
    );
  }

  return (
    <div className="space-y-4">
      <p className="text-xs text-muted-foreground">Google Search Ad Preview</p>

      {/* SERP-style preview */}
      <div className="border rounded-lg p-4 bg-white max-w-[600px] space-y-1">
        {/* Sponsored label + URL */}
        <div className="flex items-center gap-2">
          <span className="text-[11px] font-semibold text-foreground/60 bg-muted px-1.5 py-0.5 rounded">Sponsored</span>
        </div>
        <div className="flex items-center gap-1 mt-1">
          <div className="h-5 w-5 rounded-full bg-muted flex items-center justify-center">
            <span className="text-[9px] font-bold">{displayUrl.charAt(0).toUpperCase()}</span>
          </div>
          <div>
            <p className="text-xs text-foreground/70">{displayUrl}</p>
          </div>
        </div>

        {/* Headline */}
        <p className="text-lg text-[#1a0dab] hover:underline cursor-pointer leading-tight">
          {headlines.join(' | ')}
        </p>

        {/* Descriptions */}
        {ad.description && (
          <p className="text-sm text-foreground/70 leading-snug">
            {ad.description}
            {ad.description_2 && ` ${ad.description_2}`}
          </p>
        )}
      </div>

      {/* Mobile preview */}
      <div>
        <p className="text-xs text-muted-foreground mb-2">Mobile Preview</p>
        <div className="border rounded-lg p-3 bg-white max-w-[360px] space-y-1">
          <div className="flex items-center gap-1">
            <span className="text-[10px] font-semibold text-foreground/60 bg-muted px-1 py-0.5 rounded">Ad</span>
            <span className="text-[10px] text-foreground/50">{displayUrl}</span>
          </div>
          <p className="text-sm text-[#1a0dab] font-medium leading-tight">
            {headlines.slice(0, 2).join(' | ')}
          </p>
          {ad.description && (
            <p className="text-xs text-foreground/60 leading-snug line-clamp-2">{ad.description}</p>
          )}
        </div>
      </div>
    </div>
  );
}
