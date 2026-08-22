import { useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { CheckCircle2, Loader2, XCircle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

type CallbackStatus = "working" | "done" | "error";

export default function MetaCallbackPage() {
  const [params] = useSearchParams();
  const [status, setStatus] = useState<CallbackStatus>("working");
  const [message, setMessage] = useState("Finishing your Meta Ads connection…");
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;

    const exchangeCode = async () => {
      const oauthError = params.get("error_description") || params.get("error");
      const code = params.get("code");
      const state = params.get("state");

      if (oauthError) {
        setStatus("error");
        setMessage(oauthError);
        return;
      }

      if (!code || !state) {
        setStatus("error");
        setMessage("Meta did not return the required authorization details.");
        return;
      }

      try {
        const { data, error } = await supabase.functions.invoke("meta-oauth-callback", {
          body: {
            code,
            state,
            redirect_uri: `${window.location.origin}/meta/callback`,
          },
        });

        if (error) throw error;
        if (data?.error) throw new Error(data.error);

        setStatus("done");
        setMessage(`Connected ${data?.account_name || "your Meta account"} successfully.`);
      } catch (error) {
        setStatus("error");
        setMessage(error instanceof Error ? error.message : "Could not complete the Meta connection.");
      }
    };

    void exchangeCode();
  }, [params]);

  return (
    <main className="flex min-h-screen items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            {status === "working" && <Loader2 className="h-5 w-5 animate-spin text-primary" />}
            {status === "done" && <CheckCircle2 className="h-5 w-5 text-primary" />}
            {status === "error" && <XCircle className="h-5 w-5 text-destructive" />}
            Meta Ads authorization
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">{message}</p>
          {status !== "working" && (
            <Button asChild className="w-full" variant={status === "done" ? "default" : "outline"}>
              <Link to="/rrm">Return to RRM dashboard</Link>
            </Button>
          )}
        </CardContent>
      </Card>
    </main>
  );
}