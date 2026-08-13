"use client";

import { Trash2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
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
import { Button } from "@/components/ui/button";
import { apiPath } from "@/lib/base-path";

interface DeleteJobButtonProps {
  jobId: string;
  caseReference: string;
  onDeleted: (jobId: string) => void;
}

export function DeleteJobButton({
  jobId,
  caseReference,
  onDeleted,
}: DeleteJobButtonProps) {
  const [open, setOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const handleDelete = async () => {
    setDeleting(true);
    try {
      const response = await fetch(apiPath(`/api/jobs/${jobId}`), {
        method: "DELETE",
      });
      if (!response.ok) {
        throw new Error(`Delete failed: ${response.status}`);
      }
      toast.success(`"${caseReference}" deleted`);
      setOpen(false);
      onDeleted(jobId);
    } catch (err) {
      console.error(err);
      toast.error(`Could not delete "${caseReference}"`);
    } finally {
      setDeleting(false);
    }
  };

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          aria-label={`Delete ${caseReference}`}
          // The row is click-to-navigate; keep the click on the button.
          onClick={(e) => e.stopPropagation()}
          className="text-muted-foreground hover:text-destructive"
        >
          <Trash2 className="size-4" />
        </Button>
      </AlertDialogTrigger>
      {/* Portaled to <body>, so clicks inside never bubble to the row. */}
      <AlertDialogContent onClick={(e) => e.stopPropagation()}>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete this record?</AlertDialogTitle>
          <AlertDialogDescription>
            This will permanently delete the audio file and transcript for
            &ldquo;{caseReference}&rdquo;. This cannot be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            // Prevent Radix's default auto-close so the dialog stays open if
            // the request fails (the item must remain — AC6).
            onClick={(e) => {
              e.preventDefault();
              handleDelete();
            }}
            disabled={deleting}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            {deleting ? "Deleting…" : "Delete"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
