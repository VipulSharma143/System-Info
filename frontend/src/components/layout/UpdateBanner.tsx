import { Sparkles } from 'lucide-react';
import Button from '../common/Button';
import { Callout } from '../common/States';

/** "A new version is available" strip shown above any page except Updates until dismissed. */
export default function UpdateBanner({
  version,
  onView,
  onDismiss,
}: {
  version: string;
  onView: () => void;
  onDismiss: () => void;
}) {
  return (
    <div className="mx-auto max-w-[1280px] px-6 pb-3.5 max-md:px-4">
      <Callout
        tone="info"
        icon={Sparkles}
        role="status"
        action={
          <span className="flex items-center gap-1">
            <Button variant="primary" size="sm" onClick={onView}>View details</Button>
            <Button variant="ghost" size="sm" onClick={onDismiss}>Dismiss</Button>
          </span>
        }
      >
        System Info <strong className="font-semibold">v{version}</strong> is ready to install.
      </Callout>
    </div>
  );
}
