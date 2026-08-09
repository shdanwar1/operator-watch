import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { PIN_RE } from "@/lib/validation";

/** Shared 4-digit PIN entry dialog used across the admin application. */
export function PinDialog({
  open,
  title,
  onOpenChange,
  onSubmit,
}: {
  open: boolean;
  title: string;
  onOpenChange: (v: boolean) => void;
  onSubmit: (pin: string) => Promise<void>;
}) {
  const [pin, setPin] = useState("");
  const [confirm, setConfirm] = useState("");
  const [show, setShow] = useState(false);
  const valid = PIN_RE.test(pin) && pin === confirm;

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (!v) {
          setPin("");
          setConfirm("");
        }
        onOpenChange(v);
      }}
    >
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>Takes effect at the next sign-in.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label>New PIN</Label>
            <Input
              type={show ? "text" : "password"}
              inputMode="numeric"
              maxLength={4}
              value={pin}
              onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Confirm PIN</Label>
            <Input
              type={show ? "text" : "password"}
              inputMode="numeric"
              maxLength={4}
              value={confirm}
              onChange={(e) => setConfirm(e.target.value.replace(/\D/g, ""))}
            />
          </div>
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            <Checkbox checked={show} onCheckedChange={(v) => setShow(Boolean(v))} />
            Show PIN
          </label>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            disabled={!valid}
            onClick={async () => {
              try {
                await onSubmit(pin);
                setPin("");
                setConfirm("");
              } catch (e) {
                toast.error(e instanceof Error ? e.message : "Failed to set PIN");
              }
            }}
          >
            Save PIN
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
