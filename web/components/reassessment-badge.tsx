import { Badge } from "@/components/ui/badge";
import type { Prediction } from "@/lib/poc";

type Status = NonNullable<Prediction["reassessment"]>["status"];

const labels: Record<Status, string> = {
  supported: "展示後も有力",
  confirmed: "展示確認済み",
  cautious: "展示後は慎重",
};

const classes: Record<Status, string> = {
  supported: "badge-green reassessment-badge",
  confirmed: "badge-blue reassessment-badge",
  cautious: "badge-amber reassessment-badge",
};

export function ReassessmentBadge({
  status,
  waiting = false,
  compact = false,
  cutoffReached = false,
}: {
  status?: Status | null;
  waiting?: boolean;
  compact?: boolean;
  cutoffReached?: boolean;
}) {
  if (!status && !waiting) return null;
  return (
    <Badge
      variant="outline"
      className={`${status ? classes[status] : "badge-waiting reassessment-badge"}${compact ? " is-compact" : ""}`}
      title="朝に公開した買い目は変更していません"
    >
      {status ? labels[status] : cutoffReached ? "展示判定なし" : "展示評価待ち"}
    </Badge>
  );
}
