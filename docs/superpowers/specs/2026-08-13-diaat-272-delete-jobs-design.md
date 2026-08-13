# DIAAT-272 — Delete transcription records from the homepage

## Problem

Users of the Batch Audio Transcription service accumulate audio files and
transcripts they no longer need, cluttering their homepage. They need a way to
permanently delete a transcription record — both the audio file and the
transcript — with a confirmation step and clear feedback.

## Acceptance criteria (from the ticket)

- **AC1** — A "Delete" action is available on a transcription record; selecting
  it presents a confirmation prompt before deletion occurs.
- **AC2** — The user must explicitly confirm before the audio file and
  transcript are removed.
- **AC3** — On confirmed, successful deletion the associated audio file **and**
  transcript are permanently removed from the service.
- **AC4** — After deletion, the item no longer appears in the homepage list.
- **AC5** — A success message is shown after a successful deletion.
- **AC6** — If deletion fails, an error message is shown and the item remains
  available.
- **AC7** — A user cannot delete a record they do not own; the action is
  unavailable or access is denied.

## Current state

- **Backend `DELETE /api/v1/jobs/{job_id}`** already exists
  (`src/transcription_svc/api/routes.py`). It authorises via `caller_id`
  (returns 404 when the job is not the caller's), deletes the DB row (which
  holds the transcript in the `dialogue_entries` JSONB column), and returns
  `204`. It does **not** delete the audio blob referenced by
  `job.audio_blob_path`, so AC3's "audio file permanently removed" is unmet.
- `AsyncAzureBlobManager.delete_blob()` exists
  (`src/transcription_svc/audio/azure_utils.py`) but is currently unused.
- The local-storage backend (`src/transcription_svc/audio/local_storage.py`)
  has no `delete()` function.
- There is **no** frontend delete flow: no `DELETE` route handler under
  `app/api/jobs/[jobId]`, no `deleteJob` client function, no delete button, no
  confirmation dialog.
- Toast infrastructure (`sonner`) is already wired via `<Toaster />` in
  `app/layout.tsx`; the UI uses Radix + shadcn primitives, and the shared
  `Button` already has a `destructive` variant.

## Decisions

- **Placement:** delete action on each job **row on the homepage** only (both
  the "Transcripts" and "Uploads" tables), not on the individual transcript
  detail page.
- **Scope:** any job is deletable regardless of status (including
  `PENDING`/`PROCESSING`).
- **Confirmation UX:** a proper accessible modal dialog (shadcn `AlertDialog`
  over `@radix-ui/react-alert-dialog`), not the browser's native `confirm()`.

## Design

### Backend

1. **Extend `delete_job`** in `routes.py`. Order of operations:
   1. Load job; if missing or `job.caller_id != caller.id` → `404` (unchanged;
      satisfies AC7).
   2. If `job.audio_blob_path` is set, delete the audio blob:
      - `AUDIO_STORAGE_BACKEND == "local"` → `local_storage.delete(path)`.
      - otherwise → `AsyncAzureBlobManager().delete_blob(path)`.
   3. If `job.batch_job_url` is set, best-effort `delete_batch_job(url)` so
      deleting an in-flight job does not orphan a running Azure batch job. This
      is non-blocking: failure is logged and does not fail the request.
   4. `session.delete(job)`; `commit`; return `204`.

2. **`delete_blob` failure semantics.** `delete_blob` is currently defined but
   unused, so its contract can be tightened for a clear delete path:
   - blob **not found** → treated as success (idempotent — nothing to remove);
   - a **genuine** storage error → the route returns **`502`** and does **not**
     delete the DB row, so the item remains and the frontend surfaces an error
     (AC6). The normal path removes both audio and transcript (AC3/AC4).

3. **`local_storage.delete(blob_name)`** — validate the blob name (reuse the
   existing `_validate_blob_name` guard), unlink the flat file, and ignore
   `FileNotFoundError` (idempotent, mirroring the Azure not-found handling).

### Frontend

4. **`deleteJob(jobId)`** in `lib/api-client.ts` (server-only): `DELETE
   /api/v1/jobs/{id}`, expecting `204` and no body. Reuses `backendFetch`,
   which already throws `BackendApiError` (carrying the status) on non-2xx.

5. **`DELETE` handler** added to `app/api/jobs/[jobId]/route.ts`: calls
   `deleteJob`, returns `204` on success; on `BackendApiError` maps the backend
   status (404 → 404, otherwise 502) with a JSON `{ error }` body.

6. **UI components:**
   - `components/ui/alert-dialog.tsx` — shadcn `AlertDialog` wrapper over a new
     `@radix-ui/react-alert-dialog` dependency.
   - `components/jobs-table/delete-job-button.tsx` (client) — a trash-icon
     button placed in a new trailing **Actions** column of `JobsTable`. It
     `stopPropagation`s so it never triggers the row's navigation. Clicking it
     opens the confirmation modal (AC1/AC2); confirming calls the homepage
     `DELETE` route.
     - **Success** → `toast.success` and invoke `onDelete(jobId)` (AC5).
     - **Failure** → `toast.error`; the row is left in place (AC6).
     - While the request is in flight the confirm button is disabled to prevent
       double submits.

7. **List update wiring (AC4).** Thread an `onDelete(jobId)` callback:
   `app/page.tsx` (owner of the `jobs` state) removes the job from state →
   `FilterableJobsSection` → `JobsTable` → `DeleteJobButton`. Because both the
   "Transcripts" and "Uploads" sections derive from the same `jobs` state,
   removing one job updates both at once. No refetch is required, but the next
   poll/refresh will also reflect the deletion.

### Authorisation (AC7)

Enforced server-side by the existing `caller_id` check (404 for a non-owner).
In this single-caller deployment every job listed on the homepage belongs to
the caller, so the delete action is always the owner's own — no per-row
gating is needed in the UI.

## Out of scope (YAGNI)

- Soft-delete / undo / trash.
- Bulk / multi-select delete.
- A dedicated per-action audit record for deletions.
- A delete action on the transcript detail page.

## Testing

- **Backend unit** (`tests/unit/api/test_routes.py`, extend `TestDeleteJob`):
  - existing authz `404` for a non-owner retained;
  - audio blob deletion is invoked with `job.audio_blob_path` (local and Azure
    backends);
  - blob **not found** still yields `204` and deletes the row;
  - a **genuine** blob-deletion error yields `502` and the row is **not**
    deleted;
  - `204` happy path still deletes the row and commits.
- **Frontend unit** (vitest): the `DELETE` route handler returns `204` on
  success and maps `BackendApiError` to the right status + `{ error }` body.
- **Frontend e2e** (playwright, in the style of `tests/e2e/dashboard.spec.ts`):
  clicking the row's delete control opens the confirm modal; confirming removes
  the row and shows a success toast; cancelling leaves the row in place.

## Definition of done

Per the repo `CLAUDE.md`: implemented and fully tested (automated + manual),
builds and tests green locally, app run locally and exercised with Playwright,
PR driven to green CI with Copilot comments addressed, merged to `main`,
deployed to dev and verified there (including the delete flow end-to-end against
a real record), manual-test notes added to the Jira ticket, and the worktree
deleted.
