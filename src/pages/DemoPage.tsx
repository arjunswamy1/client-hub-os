import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { ArrowRight, BarChart3, Search, Zap, ShieldCheck } from "lucide-react";

const AD_SPEND_RANGES = [
  "Under $10,000",
  "$10,000 – $25,000",
  "$25,000 – $50,000",
  "$50,000 – $100,000",
  "$100,000 – $250,000",
  "$250,000+",
];

type Step = "landing" | "signup" | "creating";

export default function DemoPage() {
  const navigate = useNavigate();
  const [step, setStep] = useState<Step>("landing");
  const [form, setForm] = useState({
    firstName: "",
    lastName: "",
    email: "",
    companyName: "",
    monthlyAdSpend: "",
    password: "",
    confirmPassword: "",
  });
  const [isSubmitting, setIsSubmitting] = useState(false);

  const updateField = (field: string, value: string) =>
    setForm((prev) => ({ ...prev, [field]: value }));

  const handleSignup = async (e: React.FormEvent) => {
    e.preventDefault();
    if (form.password !== form.confirmPassword) {
      toast.error("Passwords do not match");
      return;
    }
    if (form.password.length < 8) {
      toast.error("Password must be at least 8 characters");
      return;
    }

    setIsSubmitting(true);
    setStep("creating");

    try {
      const { data, error } = await supabase.functions.invoke("demo-signup", {
        body: {
          firstName: form.firstName,
          lastName: form.lastName,
          email: form.email,
          companyName: form.companyName,
          monthlyAdSpend: form.monthlyAdSpend,
          password: form.password,
        },
      });

      if (error) throw error;
      if (data?.error) throw new Error(data.error);

      // Sign in the user
      const { error: signInError } = await supabase.auth.signInWithPassword({
        email: form.email,
        password: form.password,
      });

      if (signInError) throw signInError;

      toast.success("Welcome! Your demo dashboard is ready.");
      // Send to mobile-first demo dashboard with their tailored data
      const params = new URLSearchParams({
        company: form.companyName,
        spend: form.monthlyAdSpend,
      });
      navigate(`/demo/dashboard?${params.toString()}`);
    } catch (err: any) {
      toast.error(err.message || "Something went wrong");
      setStep("signup");
    } finally {
      setIsSubmitting(false);
    }
  };

  if (step === "creating") {
    return (
      <div className="min-h-screen bg-[hsl(222,47%,8%)] flex items-center justify-center">
        <div className="text-center space-y-4">
          <div className="h-10 w-10 mx-auto animate-spin rounded-full border-2 border-white border-t-transparent" />
          <p className="text-white/80 text-lg">Setting up your dashboard…</p>
          <p className="text-white/50 text-sm">This only takes a moment</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[hsl(222,47%,8%)] text-white">
      {/* Nav */}
      <nav className="flex items-center justify-between px-6 py-4 max-w-6xl mx-auto">
        <div className="flex items-center gap-2.5">
          <img
            src="/logo.png"
            alt="Connect Paid Media"
            className="h-8 w-8 rounded-lg object-contain"
          />
          <span className="font-semibold text-white/90">Connect Paid Media</span>
        </div>
        <Button
          variant="ghost"
          size="sm"
          className="text-white/60 hover:text-white hover:bg-white/10"
          onClick={() => navigate("/auth")}
        >
          Already have an account? Log in
        </Button>
      </nav>

      <div className="max-w-6xl mx-auto px-6">
        {step === "landing" && (
          <div className="py-20 space-y-20">
            {/* Hero */}
            <div className="text-center max-w-3xl mx-auto space-y-6">
              <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-4 py-1.5 text-sm text-white/70">
                <ShieldCheck className="h-3.5 w-3.5 text-[hsl(94,55%,45%)]" />
                Trusted by performance-driven brands
              </div>
              <h1 className="text-5xl sm:text-6xl font-bold tracking-tight leading-[1.1]">
                Expose Leaks in Your{" "}
                <span className="text-[hsl(94,55%,45%)]">Marketing Machine</span>
              </h1>
              <p className="text-xl text-white/60 max-w-2xl mx-auto leading-relaxed">
                See exactly where your ad spend is underperforming—and how to fix it.
                Get a live dashboard with real insights in under 60 seconds.
              </p>
              <Button
                size="lg"
                onClick={() => setStep("signup")}
                className="bg-[hsl(94,55%,35%)] hover:bg-[hsl(94,55%,30%)] text-white text-lg px-8 py-6 rounded-xl gap-2"
              >
                Get Your Free Dashboard Demo
                <ArrowRight className="h-5 w-5" />
              </Button>
            </div>

            {/* Features */}
            <div className="grid md:grid-cols-3 gap-8">
              {[
                {
                  icon: Search,
                  title: "Leak Detection",
                  desc: "AI scans every campaign, ad set, and creative to find exactly where budget is being wasted.",
                },
                {
                  icon: BarChart3,
                  title: "Cross-Channel Intelligence",
                  desc: "Unified view across Meta, Google, and call tracking—all in one dashboard.",
                },
                {
                  icon: Zap,
                  title: "Actionable Recommendations",
                  desc: "Not just data—specific fixes with projected impact so you know what to do next.",
                },
              ].map((f) => (
                <div
                  key={f.title}
                  className="rounded-2xl border border-white/10 bg-white/[0.03] p-8 space-y-4"
                >
                  <div className="h-10 w-10 rounded-xl bg-[hsl(94,55%,35%)]/20 flex items-center justify-center">
                    <f.icon className="h-5 w-5 text-[hsl(94,55%,45%)]" />
                  </div>
                  <h3 className="text-lg font-semibold">{f.title}</h3>
                  <p className="text-white/50 leading-relaxed">{f.desc}</p>
                </div>
              ))}
            </div>
          </div>
        )}

        {step === "signup" && (
          <div className="py-16 max-w-md mx-auto">
            <div className="text-center space-y-3 mb-8">
              <h2 className="text-3xl font-bold">Create Your Account</h2>
              <p className="text-white/50">
                Fill in your details to access your personalized demo dashboard.
              </p>
            </div>

            <form onSubmit={handleSignup} className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label className="text-white/70 text-sm">First Name</Label>
                  <Input
                    required
                    value={form.firstName}
                    onChange={(e) => updateField("firstName", e.target.value)}
                    className="bg-white/5 border-white/10 text-white placeholder:text-white/30"
                    placeholder="John"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label className="text-white/70 text-sm">Last Name</Label>
                  <Input
                    required
                    value={form.lastName}
                    onChange={(e) => updateField("lastName", e.target.value)}
                    className="bg-white/5 border-white/10 text-white placeholder:text-white/30"
                    placeholder="Smith"
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <Label className="text-white/70 text-sm">Email</Label>
                <Input
                  type="email"
                  required
                  value={form.email}
                  onChange={(e) => updateField("email", e.target.value)}
                  className="bg-white/5 border-white/10 text-white placeholder:text-white/30"
                  placeholder="john@company.com"
                />
              </div>

              <div className="space-y-1.5">
                <Label className="text-white/70 text-sm">Company Name</Label>
                <Input
                  required
                  value={form.companyName}
                  onChange={(e) => updateField("companyName", e.target.value)}
                  className="bg-white/5 border-white/10 text-white placeholder:text-white/30"
                  placeholder="Acme Corp"
                />
              </div>

              <div className="space-y-1.5">
                <Label className="text-white/70 text-sm">Monthly Ad Spend</Label>
                <Select
                  value={form.monthlyAdSpend}
                  onValueChange={(v) => updateField("monthlyAdSpend", v)}
                >
                  <SelectTrigger className="bg-white/5 border-white/10 text-white">
                    <SelectValue placeholder="Select a range" />
                  </SelectTrigger>
                  <SelectContent>
                    {AD_SPEND_RANGES.map((r) => (
                      <SelectItem key={r} value={r}>
                        {r}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label className="text-white/70 text-sm">Password</Label>
                <Input
                  type="password"
                  required
                  minLength={8}
                  value={form.password}
                  onChange={(e) => updateField("password", e.target.value)}
                  className="bg-white/5 border-white/10 text-white placeholder:text-white/30"
                  placeholder="Min 8 characters"
                />
              </div>

              <div className="space-y-1.5">
                <Label className="text-white/70 text-sm">Confirm Password</Label>
                <Input
                  type="password"
                  required
                  minLength={8}
                  value={form.confirmPassword}
                  onChange={(e) => updateField("confirmPassword", e.target.value)}
                  className="bg-white/5 border-white/10 text-white placeholder:text-white/30"
                  placeholder="Confirm your password"
                />
              </div>

              <Button
                type="submit"
                disabled={isSubmitting}
                className="w-full bg-[hsl(94,55%,35%)] hover:bg-[hsl(94,55%,30%)] text-white py-5 rounded-xl text-base gap-2"
              >
                {isSubmitting ? "Creating Account…" : "Access Your Dashboard"}
                <ArrowRight className="h-4 w-4" />
              </Button>

              <button
                type="button"
                onClick={() => setStep("landing")}
                className="w-full text-center text-sm text-white/40 hover:text-white/60 mt-2"
              >
                ← Back
              </button>
            </form>
          </div>
        )}
      </div>

      {/* Footer */}
      <footer className="border-t border-white/5 mt-20 py-8 px-6">
        <div className="max-w-6xl mx-auto text-center text-white/30 text-sm">
          © {new Date().getFullYear()} Connect Paid Media. All rights reserved.
        </div>
      </footer>
    </div>
  );
}
