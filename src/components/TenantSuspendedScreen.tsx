import { AlertTriangle } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/contexts/AuthContext";

export function TenantSuspendedScreen() {
  const { signOut } = useAuth();

  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md border-border/40">
        <CardHeader className="text-center pb-3">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-amber-100 dark:bg-amber-900/30">
            <AlertTriangle className="h-6 w-6 text-amber-600 dark:text-amber-400" />
          </div>
          <CardTitle className="text-base font-medium">Account Temporarily Unavailable</CardTitle>
          <CardDescription className="mt-2">
            Your restaurant's account has been temporarily suspended. 
            This may be due to billing issues or administrative action.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="rounded-md bg-muted/50 p-4">
            <p className="text-sm text-muted-foreground">
              If you believe this is an error or need assistance, please contact support 
              at <span className="font-medium text-foreground">support@example.com</span>
            </p>
          </div>
          <Button
            variant="outline"
            className="w-full"
            onClick={signOut}
          >
            Sign Out
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
