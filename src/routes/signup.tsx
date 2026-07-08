import { createFileRoute, redirect, Link, useRouter } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { getGateStatus } from "@/lib/gate.functions";
import { signupOperator } from "@/lib/operators.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { toast, Toaster } from "sonner";
import { ArrowLeft, UserPlus } from "lucide-react";

export const Route = createFileRoute("/signup")({
  beforeLoad: async () => {
    const { unlocked } = await getGateStatus();
    if (!unlocked) throw redirect({ to: "/unlock" });
  },
  head: () => ({
    meta: [
      { title: "Sign up operator — Studio Operator" },
      { name: "description", content: "Create a new studio operator account." },
    ],
  }),
  component: SignupPage,
});

function SignupPage() {
  const router = useRouter();
  const signup = useServerFn(signupOperator);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [mobile, setMobile] = useState("");
  const [magicWord, setMagicWord] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function submit() {
    if (!username || !password || !mobile || !magicWord) {
      return toast.error("All fields are required");
    }
    setSubmitting(true);
    try {
      await signup({ data: { username, password, mobile, magic_word: magicWord } });
      toast.success(`Operator "${username}" created`);
      if (typeof window !== "undefined") {
        localStorage.setItem("lss_operator_name", username.toLowerCase());
      }
      await router.navigate({ to: "/" });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Sign up failed");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      <Toaster richColors position="top-center" />
      <div className="mx-auto max-w-md px-4 py-8 sm:py-12">
        <header className="mb-6 flex items-center gap-2">
          <Button variant="ghost" size="sm" asChild>
            <Link to="/">
              <ArrowLeft className="mr-1 h-4 w-4" /> Home
            </Link>
          </Button>
        </header>

        <Card>
          <CardContent className="space-y-5 p-6">
            <div className="space-y-1">
              <h1 className="text-xl font-semibold tracking-tight">Sign up as operator</h1>
              <p className="text-sm text-muted-foreground">
                Your username and magic word will be used to check in.
              </p>
            </div>

            <div className="space-y-2">
              <Label>Username</Label>
              <Input
                autoCapitalize="none"
                autoCorrect="off"
                placeholder="e.g. shad"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
              />
            </div>

            <div className="space-y-2">
              <Label>Password</Label>
              <Input
                type="password"
                placeholder="Used to edit your profile"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>

            <div className="space-y-2">
              <Label>Mobile number</Label>
              <Input
                type="tel"
                placeholder="+1 555 000 0000"
                value={mobile}
                onChange={(e) => setMobile(e.target.value)}
              />
            </div>

            <div className="space-y-2">
              <Label>Check-in magic word</Label>
              <Input
                type="password"
                placeholder="Short secret word for check-in"
                value={magicWord}
                onChange={(e) => setMagicWord(e.target.value)}
              />
              <p className="text-[11px] text-muted-foreground">
                Say this at check-in instead of a password.
              </p>
            </div>

            <Button className="w-full" size="lg" onClick={submit} disabled={submitting}>
              <UserPlus className="mr-2 h-4 w-4" />
              {submitting ? "Creating…" : "Create operator"}
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
