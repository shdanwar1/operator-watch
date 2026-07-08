import { createFileRoute, useRouter, redirect, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { getGateStatus, unlockSite } from "@/lib/gate.functions";
import { signupOperator } from "@/lib/operators.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { GermanMobileInput } from "@/components/GermanMobileInput";
import { toast, Toaster } from "sonner";
import { Radio, LogIn, UserPlus } from "lucide-react";


export const Route = createFileRoute("/unlock")({
  beforeLoad: async () => {
    const { unlocked } = await getGateStatus();
    if (unlocked) throw redirect({ to: "/" });
  },
  component: Unlock,
  errorComponent: ({ error }) => (
    <div className="p-6 text-sm text-destructive">{error.message}</div>
  ),
});

function Unlock() {
  const router = useRouter();
  const unlock = useServerFn(unlockSite);
  const signup = useServerFn(signupOperator);

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(false);

  const [signupOpen, setSignupOpen] = useState(false);
  const [suUsername, setSuUsername] = useState("");
  const [suPassword, setSuPassword] = useState("");
  const [suMobile, setSuMobile] = useState("");
  const [suMagic, setSuMagic] = useState("");
  const [suLoading, setSuLoading] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    setError(false);
    try {
      const { ok } = await unlock({ data: { username, password } });
      if (ok) {
        await router.navigate({ to: "/" });
      } else {
        setError(true);
      }
    } finally {
      setLoading(false);
    }
  }

  async function onSignup(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!suUsername || !suPassword || !suMobile || !suMagic) {
      return toast.error("All fields are required");
    }
    setSuLoading(true);
    try {
      await signup({
        data: {
          username: suUsername,
          password: suPassword,
          mobile: suMobile,
          magic_word: suMagic,
        },
      });
      toast.success(`Operator "${suUsername}" created. You can sign in now.`);
      setUsername(suUsername);
      setPassword("");
      setSuUsername("");
      setSuPassword("");
      setSuMobile("");
      setSuMagic("");
      setSignupOpen(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Sign up failed");
    } finally {
      setSuLoading(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-5 py-10">
      <Toaster richColors position="top-center" />
      <Card className="w-full max-w-sm">
        <CardHeader>
          <div className="mb-2 flex h-11 w-11 items-center justify-center rounded-xl bg-primary text-primary-foreground">
            <Radio className="h-5 w-5" />
          </div>
          <CardTitle>Sign in</CardTitle>
          <CardDescription>Sign in with your operator account.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={onSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="username">Username</Label>
              <Input
                id="username"
                name="username"
                autoComplete="username"
                autoCapitalize="none"
                autoCorrect="off"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                name="password"
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </div>
            {error && (
              <p className="text-sm text-destructive">Incorrect username or password.</p>
            )}
            <Button type="submit" size="lg" className="w-full" disabled={loading}>
              <LogIn className="mr-2 h-4 w-4" />
              {loading ? "Signing in…" : "Sign in"}
            </Button>
          </form>

          <div className="mt-5 flex items-center justify-between text-xs text-muted-foreground">
            <Dialog open={signupOpen} onOpenChange={setSignupOpen}>
              <DialogTrigger asChild>
                <Button variant="outline" size="sm" className="h-8">
                  <UserPlus className="mr-1.5 h-3.5 w-3.5" />
                  Sign up operator
                </Button>
              </DialogTrigger>
              <DialogContent className="sm:max-w-sm">
                <DialogHeader>
                  <DialogTitle>New operator</DialogTitle>
                  <DialogDescription>Create your operator account.</DialogDescription>
                </DialogHeader>
                <form onSubmit={onSignup} className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="su-username">Username</Label>
                    <Input
                      id="su-username"
                      autoCapitalize="none"
                      autoCorrect="off"
                      placeholder="e.g. alex"
                      value={suUsername}
                      onChange={(e) => setSuUsername(e.target.value)}
                      required
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="su-password">Password</Label>
                    <Input
                      id="su-password"
                      type="password"
                      value={suPassword}
                      onChange={(e) => setSuPassword(e.target.value)}
                      required
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="su-mobile">Mobile number</Label>
                    <Input
                      id="su-mobile"
                      type="tel"
                      placeholder="+1 555 000 0000"
                      value={suMobile}
                      onChange={(e) => setSuMobile(e.target.value)}
                      required
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="su-magic">Check-in magic word</Label>
                    <Input
                      id="su-magic"
                      type="password"
                      placeholder="Short secret used to check in"
                      value={suMagic}
                      onChange={(e) => setSuMagic(e.target.value)}
                      required
                    />
                  </div>
                  <Button type="submit" size="lg" className="w-full" disabled={suLoading}>
                    <UserPlus className="mr-2 h-4 w-4" />
                    {suLoading ? "Creating…" : "Create operator"}
                  </Button>
                </form>
              </DialogContent>
            </Dialog>
            <Link to="/admin" className="underline hover:text-foreground">
              Admin view
            </Link>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
