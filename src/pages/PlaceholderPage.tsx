import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Construction } from 'lucide-react';

export default function PlaceholderPage({ title }: { title: string }) {
  return (
    <div className="flex h-full items-center justify-center">
      <Card className="max-w-sm text-center">
        <CardHeader>
          <div className="mx-auto mb-2 rounded-full bg-accent p-3">
            <Construction className="h-6 w-6 text-muted-foreground" />
          </div>
          <CardTitle className="text-lg">{title}</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            This module is coming soon. It will be built in a future phase.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
