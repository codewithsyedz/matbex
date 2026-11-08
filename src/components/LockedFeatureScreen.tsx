import { Lock, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useNavigate } from "react-router-dom";
import { FeatureReadinessIndicator } from "@/components/FeatureReadinessIndicator";

interface LockedFeatureScreenProps {
  featureName: string;
  description?: string;
  featureKey?: string;
}

export function LockedFeatureScreen({ featureName, description, featureKey }: LockedFeatureScreenProps) {
  const navigate = useNavigate();

  return (
    <div className="flex items-center justify-center min-h-[60vh] p-6">
      <Card className="max-w-md w-full text-center">
        <CardHeader className="pb-3">
          <div className="mx-auto mb-4 h-16 w-16 rounded-full bg-muted flex items-center justify-center">
            <Lock className="h-8 w-8 text-muted-foreground" />
          </div>
          <CardTitle className="text-base font-medium flex items-center justify-center gap-2">
            {featureName} is a Pro Feature
            {featureKey && (
              <FeatureReadinessIndicator featureKey={featureKey} />
            )}
          </CardTitle>
          <CardDescription className="text-base">
            {description || `Upgrade to Pro to unlock ${featureName} and many other powerful features.`}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="text-sm text-muted-foreground space-y-2">
            <p className="flex items-center justify-center gap-2">
              <Sparkles className="h-4 w-4 text-primary" />
              Unlock all premium features
            </p>
            <p className="flex items-center justify-center gap-2">
              <Sparkles className="h-4 w-4 text-primary" />
              Priority support
            </p>
            <p className="flex items-center justify-center gap-2">
              <Sparkles className="h-4 w-4 text-primary" />
              Advanced analytics & reports
            </p>
          </div>
          <div className="flex flex-col sm:flex-row gap-2 pt-2">
            <Button 
              variant="outline" 
              className="flex-1"
              onClick={() => navigate(-1)}
            >
              Go Back
            </Button>
            <Button 
              className="flex-1"
              onClick={() => navigate("/billing")}
            >
              Upgrade to Pro
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}