import { Check, GitBranch, History } from "lucide-react";
import { format, parseISO } from "date-fns";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useDocsVersionContext } from "./DocsVersionContext";

export function DocsVersionSelector() {
  const { selected, setSelectedId, versions, current } = useDocsVersionContext();
  if (!versions.length) return null;

  return (
    <div className="flex flex-wrap items-center justify-center gap-3 mt-4 mb-2">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="sm" className="rounded-full font-mono text-xs gap-2">
            <GitBranch className="h-3.5 w-3.5" />
            v{selected?.version ?? "—"}
            {selected?.is_current && (
              <Badge variant="secondary" className="ml-1 h-4 px-1.5 text-[10px]">
                current
              </Badge>
            )}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="center" className="w-72">
          <DropdownMenuLabel className="flex items-center gap-2 text-xs">
            <History className="h-3.5 w-3.5" />
            Documentation release history
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          {versions.map((v) => (
            <DropdownMenuItem
              key={v.id}
              onSelect={() => setSelectedId(v.id)}
              className="flex items-start gap-2 py-2"
            >
              <Check
                className={`h-4 w-4 mt-0.5 ${selected?.id === v.id ? "opacity-100" : "opacity-0"}`}
              />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-mono text-sm font-medium">v{v.version}</span>
                  {v.is_current && (
                    <Badge variant="secondary" className="h-4 px-1.5 text-[10px]">
                      current
                    </Badge>
                  )}
                  <span className="text-[11px] text-muted-foreground ml-auto">
                    {format(parseISO(v.released_at), "MMM d, yyyy")}
                  </span>
                </div>
                {v.summary && (
                  <p className="text-xs text-muted-foreground mt-1 font-light line-clamp-2">
                    {v.summary}
                  </p>
                )}
                {(v.app_version || v.schema_version) && (
                  <div className="flex gap-1.5 mt-1.5">
                    {v.app_version && (
                      <Badge variant="outline" className="h-4 px-1.5 text-[10px] font-mono">
                        app {v.app_version}
                      </Badge>
                    )}
                    {v.schema_version && (
                      <Badge variant="outline" className="h-4 px-1.5 text-[10px] font-mono">
                        schema {v.schema_version}
                      </Badge>
                    )}
                  </div>
                )}
              </div>
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>

      {selected && current && selected.id !== current.id && (
        <Button
          variant="ghost"
          size="sm"
          className="text-xs h-7 rounded-full"
          onClick={() => setSelectedId(current.id)}
        >
          Back to current
        </Button>
      )}
    </div>
  );
}