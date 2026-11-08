import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from "@/components/ui/tooltip";
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { 
  Plus, 
  Layers, 
  Image, 
  UtensilsCrossed, 
  Clock, 
  MapPin, 
  Images, 
  MessageSquareQuote, 
  MousePointerClick,
  Code
} from "lucide-react";
import { usePageBlocks, BlockType, PageBlock, BlockContent } from "@/hooks/usePageBlocks";
import { SortableBlock } from "./SortableBlock";
import { BlockConfigDialog } from "./BlockConfigDialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

interface BlockEditorProps {
  pageId: string | null | undefined;
}

const BLOCK_TYPES: { type: BlockType; label: string; icon: React.ReactNode; description: string }[] = [
  { type: 'hero', label: 'Hero Section', icon: <Image className="h-4 w-4" />, description: 'Full-width visual anchor' },
  { type: 'menu', label: 'Live Menu', icon: <UtensilsCrossed className="h-4 w-4" />, description: 'Synchronized from inventory' },
  { type: 'hours', label: 'Operating Hours', icon: <Clock className="h-4 w-4" />, description: 'Display service windows' },
  { type: 'location', label: 'Location', icon: <MapPin className="h-4 w-4" />, description: 'Address and contact details' },
  { type: 'gallery', label: 'Gallery', icon: <Images className="h-4 w-4" />, description: 'Visual showcase grid' },
  { type: 'testimonials', label: 'Testimonials', icon: <MessageSquareQuote className="h-4 w-4" />, description: 'Guest endorsements' },
  { type: 'cta', label: 'Call to Action', icon: <MousePointerClick className="h-4 w-4" />, description: 'Conversion element' },
  { type: 'custom', label: 'Custom HTML', icon: <Code className="h-4 w-4" />, description: 'Embedded code block' },
];

export function BlockEditor({ pageId }: BlockEditorProps) {
  const { blocks, isLoading, addBlock, reorderBlocks, updateBlock, deleteBlock, toggleVisibility } = usePageBlocks(pageId);
  const [editingBlock, setEditingBlock] = useState<PageBlock | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    
    if (over && active.id !== over.id) {
      const oldIndex = blocks.findIndex((b) => b.id === active.id);
      const newIndex = blocks.findIndex((b) => b.id === over.id);
      const newOrder = arrayMove(blocks, oldIndex, newIndex);
      reorderBlocks(newOrder.map(b => b.id));
    }
  };

  const handleAddBlock = (type: BlockType) => {
    addBlock({ blockType: type });
  };

  if (isLoading) {
    return (
      <Card>
        <CardContent className="pt-6">
          <div className="space-y-3">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-16 bg-muted animate-pulse rounded-lg" />
            ))}
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <TooltipProvider>
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="p-2 rounded-md bg-primary/10">
                <Layers className="h-5 w-5 text-primary" />
              </div>
              <div>
                <CardTitle className="text-base font-medium">Page Blocks</CardTitle>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Drag to reorder, click to edit
                </p>
              </div>
            </div>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button size="sm" className="gap-2">
                  <Plus className="h-4 w-4" />
                  Add Block
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                {BLOCK_TYPES.map((block) => (
                  <DropdownMenuItem
                    key={block.type}
                    onClick={() => handleAddBlock(block.type)}
                    className="gap-3"
                  >
                    <div className="p-1.5 rounded bg-muted">
                      {block.icon}
                    </div>
                    <div className="flex-1">
                      <p className="font-medium text-sm">{block.label}</p>
                      <p className="text-xs text-muted-foreground">{block.description}</p>
                    </div>
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </CardHeader>
        <CardContent>
          {blocks.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              <Layers className="h-12 w-12 mx-auto mb-3 opacity-50" />
              <p className="font-medium">Awaiting your vision</p>
              <p className="text-sm">Add blocks to compose your landing experience</p>
            </div>
          ) : (
            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragEnd={handleDragEnd}
            >
              <SortableContext
                items={blocks.map(b => b.id)}
                strategy={verticalListSortingStrategy}
              >
                <div className="space-y-2">
                  {blocks.map((block) => (
                    <SortableBlock
                      key={block.id}
                      block={block}
                      blockMeta={BLOCK_TYPES.find(t => t.type === block.block_type)}
                      onEdit={() => setEditingBlock(block)}
                      onDelete={() => deleteBlock(block.id)}
                      onToggleVisibility={() => toggleVisibility({ blockId: block.id, isVisible: !block.is_visible })}
                    />
                  ))}
                </div>
              </SortableContext>
            </DndContext>
          )}
        </CardContent>
      </Card>

      {editingBlock && (
        <BlockConfigDialog
          block={editingBlock}
          open={!!editingBlock}
          onOpenChange={(open) => !open && setEditingBlock(null)}
          onSave={(content) => {
            updateBlock({ blockId: editingBlock.id, updates: { content } });
            setEditingBlock(null);
          }}
        />
      )}
    </TooltipProvider>
  );
}
