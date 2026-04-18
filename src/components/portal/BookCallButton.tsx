import { Button } from '@/components/ui/button';
import { Calendar } from 'lucide-react';

const CALENDLY_URL = 'https://calendly.com/charles-connectpaidmedia/30min';

interface BookCallButtonProps {
  variant?: 'default' | 'outline' | 'ghost';
  size?: 'sm' | 'default' | 'lg';
  className?: string;
  label?: string;
}

export function BookCallButton({
  variant = 'default',
  size = 'sm',
  className,
  label = 'Book a call',
}: BookCallButtonProps) {
  return (
    <Button
      variant={variant}
      size={size}
      className={className}
      onClick={() => window.open(CALENDLY_URL, '_blank', 'noopener,noreferrer')}
    >
      <Calendar className="h-3.5 w-3.5" />
      {label}
    </Button>
  );
}
