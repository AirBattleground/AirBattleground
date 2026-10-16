import { KeyRound, MoreHorizontal, Pencil, Power, PowerOff } from "lucide-react";
import { Button } from "@7xen/ui/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@7xen/ui/components/ui/dropdown-menu";

export function RowActions({
  name,
  isActive,
  onEdit,
  onReset,
  onToggle,
  tour,
}: {
  name: string;
  isActive: boolean;
  onEdit: () => void;
  onReset: () => void;
  onToggle: () => void;
  tour?: string;
}) {
  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon-sm" aria-label={`Actions for ${name}`} data-tour={tour}>
          <MoreHorizontal />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48">
        <DropdownMenuLabel className="truncate">{name}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={onEdit}>
          <Pencil /> Edit details
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={onReset}>
          <KeyRound /> Reset password
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        {isActive ? (
          <DropdownMenuItem variant="destructive" onSelect={onToggle}>
            <PowerOff /> Disable login
          </DropdownMenuItem>
        ) : (
          <DropdownMenuItem onSelect={onToggle}>
            <Power /> Enable login
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
