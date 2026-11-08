import { useState, useEffect, useRef, memo, ImgHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

interface OptimizedImageProps extends Omit<ImgHTMLAttributes<HTMLImageElement>, 'onLoad'> {
  /** Primary image source */
  src: string;
  /** Alt text for accessibility */
  alt: string;
  /** Low-resolution placeholder (base64 or tiny URL) */
  placeholder?: string;
  /** CSS class for the container */
  className?: string;
  /** CSS class for the image */
  imageClassName?: string;
  /** Aspect ratio (e.g., "16/9", "1/1", "4/3") */
  aspectRatio?: string;
  /** Whether to use blur-up effect */
  blurUp?: boolean;
  /** Whether to lazy load */
  lazy?: boolean;
  /** Root margin for lazy loading */
  rootMargin?: string;
  /** Callback when image loads */
  onLoad?: () => void;
  /** Priority loading (skips lazy loading) */
  priority?: boolean;
}

/**
 * Performance-optimized image component with blur-up placeholders.
 * 
 * Features:
 * - Lazy loading via IntersectionObserver
 * - Blur-up transition from placeholder to full image
 * - Maintains aspect ratio to prevent layout shift
 * - Priority loading option for above-the-fold images
 */
export const OptimizedImage = memo(function OptimizedImage({
  src,
  alt,
  placeholder,
  className,
  imageClassName,
  aspectRatio = "16/9",
  blurUp = true,
  lazy = true,
  rootMargin = "200px",
  onLoad,
  priority = false,
  ...imgProps
}: OptimizedImageProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [isLoaded, setIsLoaded] = useState(false);
  const [shouldLoad, setShouldLoad] = useState(priority || !lazy);
  const [hasError, setHasError] = useState(false);

  // IntersectionObserver for lazy loading
  useEffect(() => {
    if (priority || !lazy) return;
    
    const element = containerRef.current;
    if (!element) return;

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            setShouldLoad(true);
            observer.disconnect();
          }
        });
      },
      { rootMargin }
    );

    observer.observe(element);
    return () => observer.disconnect();
  }, [lazy, priority, rootMargin]);

  const handleLoad = () => {
    setIsLoaded(true);
    onLoad?.();
  };

  const handleError = () => {
    setHasError(true);
  };

  // Generate inline placeholder if none provided
  const defaultPlaceholder = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 1 1'%3E%3Crect fill='%23f1f5f9' width='1' height='1'/%3E%3C/svg%3E";
  const placeholderSrc = placeholder || defaultPlaceholder;

  return (
    <div 
      ref={containerRef}
      className={cn(
        "relative overflow-hidden bg-muted/20",
        className
      )}
      style={{ aspectRatio }}
    >
      {/* Placeholder layer */}
      {blurUp && !isLoaded && (
        <img
          src={placeholderSrc}
          alt=""
          aria-hidden="true"
          className={cn(
            "absolute inset-0 w-full h-full object-cover",
            "filter blur-lg scale-110 transition-opacity duration-300",
            isLoaded ? "opacity-0" : "opacity-100"
          )}
        />
      )}

      {/* Main image */}
      {shouldLoad && !hasError && (
        <img
          src={src}
          alt={alt}
          loading={priority ? "eager" : "lazy"}
          decoding="async"
          onLoad={handleLoad}
          onError={handleError}
          className={cn(
            "absolute inset-0 w-full h-full object-cover",
            "transition-opacity duration-500",
            isLoaded ? "opacity-100" : "opacity-0",
            imageClassName
          )}
          {...imgProps}
        />
      )}

      {/* Error state */}
      {hasError && (
        <div className="absolute inset-0 flex items-center justify-center bg-muted">
          <span className="text-muted-foreground text-sm">Failed to load</span>
        </div>
      )}

      {/* Loading shimmer */}
      {!isLoaded && !hasError && shouldLoad && (
        <div 
          className="absolute inset-0 bg-gradient-to-r from-transparent via-white/20 to-transparent animate-shimmer"
          style={{ 
            backgroundSize: "200% 100%",
            animation: "shimmer 1.5s infinite linear"
          }}
        />
      )}
    </div>
  );
});

export default OptimizedImage;
