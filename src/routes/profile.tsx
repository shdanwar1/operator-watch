import { createFileRoute, redirect, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { getGateStatus } from "@/lib/gate.functions";
import {
  verifyOperatorLogin,
  updateOperatorProfile,
  setOperatorHome,
  type OperatorProfile,
} from "@/lib/operators.functions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { GermanMobileInput } from "@/components/GermanMobileInput";
import { toast, Toaster } from "sonner";
import { ArrowLeft, LogIn, Save, Home, MapPin } from "lucide-react";

function stripDePrefix(v: string | null | undefined): string {
  if (!v) return "";
  const digits = v.replace(/\D+/g, "");
  if (digits.startsWith("49") && digits.length === 12) return digits.slice(2);
  if (digits.startsWith("0")) return digits.slice(1);
  return digits.slice(-10);
}


export const Route = createFileRoute("/profile")({
  beforeLoad: async () => {
    const { unlocked } = await getGateStatus();
    if (!unlocked) throw redirect({ to: "/unlock" });
  },
  head: () => ({
    meta: [
      { title: "Operator profile — Studio Operator" },
      { name: "description", content: "Edit your operator profile: username, password, mobile number, and magic word." },
    ],
  }),
  component: ProfilePage,
});

function ProfilePage() {
  const verifyLogin = useServerFn(verifyOperatorLogin);
  const updateProfile = useServerFn(updateOperatorProfile);

  const [loginUsername, setLoginUsername] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [loading, setLoading] = useState(false);

  const [operator, setOperator] = useState<OperatorProfile | null>(null);
  const [currentPassword, setCurrentPassword] = useState("");

  // Editable fields (blank = keep existing)
  const [username, setUsername] = useState("");
  const [mobile, setMobile] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [magicWord, setMagicWord] = useState("");
  const [saving, setSaving] = useState(false);

  async function login() {
    if (!loginUsername || !loginPassword) return toast.error("Enter your username and password");
    setLoading(true);
    try {
      const op = await verifyLogin({ data: { username: loginUsername, password: loginPassword } });
      setOperator(op);
      setCurrentPassword(loginPassword);
      setUsername(op.username);
      setMobile(stripDePrefix(op.mobile));
      setNewPassword("");
      setMagicWord("");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Login failed");
    } finally {
      setLoading(false);
    }
  }

  async function save() {
    if (!operator) return;
    if (mobile.length !== 10) return toast.error("Mobile number must be 10 digits");
    const fullMobile = `+49${mobile}`;
    setSaving(true);
    try {
      await updateProfile({
        data: {
          id: operator.id,
          current_password: currentPassword,
          username: username.trim().toLowerCase() !== operator.username ? username : undefined,
          new_password: newPassword || undefined,
          mobile: fullMobile,
          magic_word: magicWord || undefined,
        },
      });
      toast.success("Profile updated");
      if (newPassword) setCurrentPassword(newPassword);
      setNewPassword("");
      setMagicWord("");
      setOperator({
        ...operator,
        username: username.trim().toLowerCase() || operator.username,
        mobile: fullMobile,
      });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Update failed");
    } finally {
      setSaving(false);
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

        {!operator ? (
          <Card>
            <CardContent className="space-y-5 p-6">
              <div className="space-y-1">
                <h1 className="text-xl font-semibold tracking-tight">Edit profile</h1>
                <p className="text-sm text-muted-foreground">
                  Sign in with your operator username and password.
                </p>
              </div>
              <div className="space-y-2">
                <Label>Username</Label>
                <Input
                  autoCapitalize="none"
                  autoCorrect="off"
                  value={loginUsername}
                  onChange={(e) => setLoginUsername(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label>Password</Label>
                <Input
                  type="password"
                  value={loginPassword}
                  onChange={(e) => setLoginPassword(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !loading) login();
                  }}
                />
              </div>
              <Button className="w-full" size="lg" onClick={login} disabled={loading}>
                <LogIn className="mr-2 h-4 w-4" />
                {loading ? "Signing in…" : "Sign in"}
              </Button>
              <p className="text-center text-xs text-muted-foreground">
                No account?{" "}
                <Link to="/signup" className="underline hover:text-foreground">
                  Sign up
                </Link>
              </p>
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardContent className="space-y-5 p-6">
              <div className="space-y-1">
                <h1 className="text-xl font-semibold tracking-tight">
                  Editing {operator.username}
                </h1>
                <p className="text-sm text-muted-foreground">
                  Leave a field blank to keep it unchanged.
                </p>
              </div>

              <div className="space-y-2">
                <Label>Username</Label>
                <Input
                  autoCapitalize="none"
                  autoCorrect="off"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="profile-mobile">Mobile number</Label>
                <GermanMobileInput
                  id="profile-mobile"
                  value={mobile}
                  onChange={setMobile}
                />
              </div>


              <div className="space-y-2">
                <Label>New password</Label>
                <Input
                  type="password"
                  placeholder="Leave blank to keep current"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                />
              </div>

              <div className="space-y-2">
                <Label>Check-in magic word</Label>
                <Input
                  type="password"
                  placeholder="Leave blank to keep current"
                  value={magicWord}
                  onChange={(e) => setMagicWord(e.target.value)}
                />
              </div>

              <Button className="w-full" size="lg" onClick={save} disabled={saving}>
                <Save className="mr-2 h-4 w-4" />
                {saving ? "Saving…" : "Save changes"}
              </Button>

              <Button
                variant="ghost"
                className="w-full"
                onClick={() => {
                  setOperator(null);
                  setLoginPassword("");
                }}
              >
                Sign out
              </Button>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
