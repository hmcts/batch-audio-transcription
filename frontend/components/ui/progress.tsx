import { cn } from "@/lib/utils";

interface ProgressProps {
  value?: number;
  className?: string;
}

function Progress({ value = 0, className }: ProgressProps) {
  const clamped = Math.min(100, Math.max(0, value));
  return (
    <div
      role="progressbar"
      aria-valuenow={clamped}
      aria-valuemin={0}
      aria-valuemax={100}
      className={cn(
        "relative h-2 w-full overflow-hidden rounded-full bg-secondary",
        className
      )}
    >
      <div
        className="h-full bg-primary transition-all duration-300 ease-in-out"
        style={{ width: `${clamped}%` }}
      />
    </div>
  );
}

export { Progress };
