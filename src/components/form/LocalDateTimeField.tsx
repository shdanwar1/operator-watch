import { TimeField } from "@/components/form/TimeField";
import {
  joinLocalDateTime,
  localDatePart,
  localTimePart,
  nudgeLocalDateTime,
} from "@/domain/time-entry";

function currentLocalDateTime(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  const date = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  return joinLocalDateTime(date, `${pad(now.getHours())}:${pad(now.getMinutes())}`);
}

/** Date and native time inputs with quick corrections and a current-time shortcut. */
export function LocalDateTimeField({
  id,
  label,
  value,
  onChange,
  disabled,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}) {
  const date = localDatePart(value);
  const time = localTimePart(value);

  return (
    <TimeField
      id={id}
      label={label}
      value={time}
      onChange={(nextTime) => onChange(joinLocalDateTime(date, nextTime))}
      disabled={disabled}
      dateValue={date}
      onDateChange={(nextDate) => onChange(joinLocalDateTime(nextDate, time))}
      onNudge={(delta) => {
        const next = nudgeLocalDateTime(value, delta);
        if (next) onChange(next);
      }}
      onNow={() => onChange(currentLocalDateTime())}
    />
  );
}
