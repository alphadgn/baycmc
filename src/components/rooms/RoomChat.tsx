import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { LobbyChat } from "@/components/LobbyChat";

export function RoomChat({ roomId, roomName, open, onOpenChange }: { roomId: string; roomName: string; open: boolean; onOpenChange: (open: boolean) => void }) {
  return <Sheet open={open} onOpenChange={onOpenChange} modal={false}>
    <SheetContent side="right" className="top-[var(--app-header-h)] bottom-0 flex h-below-header w-full min-h-0 flex-col gap-3 p-3 sm:max-w-md" aria-describedby={undefined}>
      <SheetHeader className="shrink-0 pr-8"><SheetTitle>{roomName} · Chat</SheetTitle></SheetHeader>
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden"><LobbyChat key={roomId} channelName={`room:${roomId}`} membersTitle="Room members" emptyText="No room messages yet." /></div>
    </SheetContent>
  </Sheet>;
}