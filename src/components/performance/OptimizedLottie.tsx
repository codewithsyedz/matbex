import { useEffect, useRef, useState, memo } from "react";
import { DotLottiePlayer } from "@dotlottie/react-player";
import "@dotlottie/react-player/dist/index.css";
import { cn } from "@/lib/utils";

interface OptimizedLottieProps {
  /** URL to .lottie or .json animation file */
  src: string;
  /** CSS class for the container */
  className?: string;
  /** Whether animation should loop */
  loop?: boolean;
  /** Whether animation should autoplay when in viewport */
  autoplay?: boolean;
  /** Playback speed multiplier */
  speed?: number;
  /** Threshold for intersection observer (0-1) */
  threshold?: number;
  /** Root margin for intersection observer */
  rootMargin?: string;
  /** Callback when animation loads */
  onLoad?: () => void;
  /** Callback when animation completes */
  onComplete?: () => void;
}

/**
 * Performance-optimized Lottie animation component.
 * 
 * Features:
 * - Uses DotLottie player for 80% smaller file sizes
 * - Viewport-based initialization via IntersectionObserver
 * - Pauses animation when not visible to reduce CPU usage
 * - Memoized to prevent unnecessary re-renders
 */
export const OptimizedLottie = memo(function OptimizedLottie({
  src,
  className,
  loop = true,
  autoplay = true,
  speed = 1,
  threshold = 0.1,
  rootMargin = "50px",
  onLoad,
  onComplete,
}: OptimizedLottieProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [isInView, setIsInView] = useState(false);
  const [hasLoaded, setHasLoaded] = useState(false);

  // IntersectionObserver for viewport detection
  useEffect(() => {
    const element = containerRef.current;
    if (!element) return;

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          setIsInView(entry.isIntersecting);
        });
      },
      { threshold, rootMargin }
    );

    observer.observe(element);
    return () => observer.disconnect();
  }, [threshold, rootMargin]);

  const handleLoad = () => {
    setHasLoaded(true);
    onLoad?.();
  };

  return (
    <div 
      ref={containerRef} 
      className={cn("relative", className)}
      aria-hidden="true"
    >
      {/* Only render DotLottie when in viewport or already loaded */}
      {(isInView || hasLoaded) && (
        <DotLottiePlayer
          src={src}
          loop={loop}
          autoplay={autoplay && isInView}
          speed={speed}
          onEvent={(event) => {
            if (event === "ready") handleLoad();
            if (event === "complete") onComplete?.();
          }}
          className="w-full h-full"
        />
      )}
      
      {/* Placeholder while loading */}
      {!hasLoaded && (
        <div 
          className="absolute inset-0 bg-muted/20 animate-pulse rounded-lg"
          aria-label="Loading animation"
        />
      )}
    </div>
  );
});

export default OptimizedLottie;
