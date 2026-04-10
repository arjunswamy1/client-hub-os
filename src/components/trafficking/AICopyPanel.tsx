import { useState } from 'react';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Sparkles, Loader2, Copy, Check } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useTraffickingAdMutations } from '@/hooks/useTrafficking';
import { useToast } from '@/hooks/use-toast';

interface Props {
  ad: any;
  onClose: () => void;
  clientId: string;
}

interface CopyOption {
  field: string;
  option_number: number;
  text: string;
  reasoning: string;
}

export function AICopyPanel({ ad, onClose, clientId }: Props) {
  const [isGenerating, setIsGenerating] = useState(false);
  const [options, setOptions] = useState<CopyOption[]>([]);
  const [appliedFields, setAppliedFields] = useState<Set<string>>(new Set());
  const { updateAd } = useTraffickingAdMutations(clientId);
  const { toast } = useToast();

  const generateCopy = async () => {
    setIsGenerating(true);
    setOptions([]);
    try {
      const { data, error } = await supabase.functions.invoke('generate-ad-copy', {
        body: {
          client_id: clientId,
          ad_id: ad.id,
          platform: ad.platform,
          campaign_name: ad.campaign?.name,
          format: ad.format,
          current_copy: {
            primary_text: ad.primary_text,
            headline: ad.headline,
            description: ad.description,
          },
        },
      });

      if (error) throw error;

      if (data?.options) {
        setOptions(data.options);
      }
      if (data?.error) {
        toast({ title: 'AI Error', description: data.error, variant: 'destructive' });
      }
    } catch (e: any) {
      toast({ title: 'Error', description: e.message, variant: 'destructive' });
    } finally {
      setIsGenerating(false);
    }
  };

  const applyOption = (option: CopyOption) => {
    const fieldMap: Record<string, string> = {
      'Primary Text': 'primary_text',
      'Headline': 'headline',
      'Description': 'description',
    };
    const dbField = fieldMap[option.field] || option.field.toLowerCase().replace(/ /g, '_');
    updateAd.mutate({
      id: ad.id,
      [dbField]: option.text,
    });
    setAppliedFields(prev => new Set([...prev, `${option.field}_${option.option_number}`]));
    toast({ title: `${option.field} updated` });
  };

  const groupedOptions = options.reduce((acc, opt) => {
    if (!acc[opt.field]) acc[opt.field] = [];
    acc[opt.field].push(opt);
    return acc;
  }, {} as Record<string, CopyOption[]>);

  return (
    <Sheet open onOpenChange={() => onClose()}>
      <SheetContent className="w-[480px] sm:max-w-[480px] overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-primary" />
            AI Copy Generator
          </SheetTitle>
          <p className="text-xs text-muted-foreground">
            Generates ad copy based on historical performance data for this client.
          </p>
        </SheetHeader>

        {/* Context */}
        <div className="mt-4 p-3 bg-muted/50 rounded-lg space-y-1">
          <p className="text-xs font-medium">Context</p>
          <p className="text-xs text-muted-foreground">Ad: {ad.ad_name}</p>
          {ad.campaign?.name && <p className="text-xs text-muted-foreground">Campaign: {ad.campaign.name}</p>}
          <p className="text-xs text-muted-foreground">Platform: {ad.platform}</p>
        </div>

        {/* Generate button */}
        <div className="mt-4">
          <Button onClick={generateCopy} disabled={isGenerating} className="w-full">
            {isGenerating ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Analyzing performance data & generating copy...
              </>
            ) : options.length > 0 ? (
              <>
                <Sparkles className="h-4 w-4 mr-2" />
                Regenerate
              </>
            ) : (
              <>
                <Sparkles className="h-4 w-4 mr-2" />
                Generate AI Copy
              </>
            )}
          </Button>
        </div>

        {/* Results */}
        {Object.keys(groupedOptions).length > 0 && (
          <div className="mt-6 space-y-6">
            {Object.entries(groupedOptions).map(([field, opts]) => (
              <div key={field}>
                <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">{field}</h4>
                <div className="space-y-3">
                  {opts.map((opt) => {
                    const key = `${opt.field}_${opt.option_number}`;
                    const isApplied = appliedFields.has(key);
                    return (
                      <div key={key} className="border rounded-lg p-3 space-y-2">
                        <div className="flex items-start justify-between">
                          <Badge variant="outline" className="text-[10px]">Option {opt.option_number}</Badge>
                          <Button
                            size="sm"
                            variant={isApplied ? 'default' : 'outline'}
                            className="h-7 text-xs"
                            onClick={() => applyOption(opt)}
                            disabled={isApplied}
                          >
                            {isApplied ? (
                              <><Check className="h-3 w-3 mr-1" /> Applied</>
                            ) : (
                              <><Copy className="h-3 w-3 mr-1" /> Use This</>
                            )}
                          </Button>
                        </div>
                        <p className="text-sm">{opt.text}</p>
                        {opt.reasoning && (
                          <p className="text-[11px] text-muted-foreground italic">📊 {opt.reasoning}</p>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
