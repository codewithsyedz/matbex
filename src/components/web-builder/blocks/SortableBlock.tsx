import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { GripVertical, Eye, EyeOff, Pencil, Trash2 } from "lucide-react";
import { PageBlock, BlockType, BlockContent } from "@/hooks/usePageBlocks";
import { cn } from "@/lib/utils";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

interface SortableBlockProps {
  block: PageBlock;
  blockMeta?: { type: BlockType; label: string; icon: React.ReactNode; description: string };
  onEdit: () => void;
  onDelete: () => void;
  onToggleVisibility: () => void;
}

export function SortableBlock({ 
  block, 
  blockMeta, 
  onEdit, 
  onDelete, 
  onToggleVisibility 
}: SortableBlockProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: block.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  const content = block.content as BlockContent;
  const getBlockPreview = () => {
    switch (block.block_type) {
      case 'hero':
        return (content.title as string) || 'Hero Section';
      case 'menu':
        const cats = (content.categories as string[]) || [];
        return cats.length > 0 ? `Categories: ${cats.join(', ')}` : 'All menu items';
      case 'hours':
        return 'Opening hours schedule';
      case 'location':
        return (content.address as string) || 'Location & contact';
      case 'gallery':
        const images = (content.images as unknown[]) || [];
        return `${images.length} photos`;
      case 'cta':
        return (content.heading as string) || 'Call to action';
      case 'testimonials':
        return 'Customer reviews';
      case 'custom':
        return 'Custom HTML block';
      default:
        return block.block_type;
    }
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        "flex items-center gap-3 p-3 rounded-lg border bg-card transition-all",
        isDragging && "opacity-50 shadow-lg",
        !block.is_visible && "opacity-60"
      )}
    >
      <button
        {...attributes}
        {...listeners}
        className="cursor-grab active:cursor-grabbing p-1 hover:bg-muted rounded"
      >
        <GripVertical className="h-4 w-4 text-muted-foreground" />
      </button>

      <div className="p-2 rounded-md bg-muted">
        {blockMeta?.icon}
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="font-medium text-sm">{blockMeta?.label || block.block_type}</span>
          {!block.is_visible && (
            <Badge variant="secondary" className="text-xs">Hidden</Badge>
          )}
          {block.block_type === 'menu' && (
            <Badge variant="outline" className="text-xs bg-emerald-500/10 text-emerald-600 border-emerald-500/20">
              Live Sync
            </Badge>
          )}
        </div>
        <p className="text-xs text-muted-foreground truncate">{getBlockPreview()}</p>
      </div>

      <div className="flex items-center gap-1">
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          onClick={onToggleVisibility}
        >
          {block.is_visible ? (
            <Eye className="h-4 w-4" />
          ) : (
            <EyeOff className="h-4 w-4" />
          )}
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8"
          onClick={onEdit}
        >
          <Pencil className="h-4 w-4" />
        </Button>
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 text-destructive hover:text-destructive"
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete Block?</AlertDialogTitle>
              <AlertDialogDescription>
                This will permanently remove the {blockMeta?.label} block from your page.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction onClick={onDelete} className="bg-destructive hover:bg-destructive/90">
                Delete
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </div>
  );
}
