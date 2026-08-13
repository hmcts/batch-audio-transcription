# Delete Transcription Records From The Homepage — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a user permanently delete a transcription record (audio file + transcript) from their homepage, with a confirmation prompt and success/error feedback.

**Architecture:** The backend `DELETE /api/v1/jobs/{job_id}` already deletes the DB row (which holds the transcript) and authorises the caller; we extend it to also delete the audio blob. The frontend gains a `deleteJob` client fn, a `DELETE` route handler, a confirmation modal, and a trash button per homepage row that removes the job from client state on success.

**Tech Stack:** Python 3 / FastAPI / SQLModel (backend); Next.js App Router / React / TypeScript / Radix + shadcn / sonner / Vitest / Playwright (frontend). Package manager: `pnpm` (frontend), `uv` (backend).

## Global Constraints

- **PR title format** (enforced by `pr-title-check`): `type(scope): description [DIAAT-272]`.
- **Backend lint/test:** `uv run ruff check .`, `uv run ruff format .`, `uv run pytest` — all must pass.
- **Frontend lint/test:** `pnpm check` (biome), `pnpm test:unit` (vitest) — all must pass.
- **Auth model:** endpoints depend on `get_current_user` → `AuthenticatedUser`; ownership is enforced by `_check_job_access(job, current_user)` (404 for a non-owner who is not a `SystemAdministrator`). Jobs are owned via `job.user_id`. This already satisfies **AC7** — no new authorisation code is required.
- **Frontend auth plumbing:** server-only backend calls take a `BackendAuthContext` as their final argument; route handlers build it with `getBackendAuthContext(request)`. Every new backend call must thread it.
- **Client fetch to own API routes** must go through `apiPath()` from `@/lib/base-path` (basePath is `/batch`).
- **Blob-delete failure semantics:** blob *not found* is idempotent success; a *genuine* storage error must fail the request (502) and leave the DB row intact (**AC6**).

---

### Task 1: Backend — `local_storage.delete()`

Add an idempotent delete to the dev-only local storage backend so the delete route can remove locally-stored audio.

**Files:**
- Modify: `src/transcription_svc/audio/local_storage.py`
- Test: `tests/unit/audio/test_local_storage.py`

**Interfaces:**
- Produces: `def delete(blob_name: str) -> None` — removes the on-disk file for `blob_name`; validates the name (raises `ValueError` on an invalid/traversal name); silently returns if the file is already absent.

- [ ] **Step 1: Write the failing tests**

Add to `tests/unit/audio/test_local_storage.py` (new test class at end of file):

```python
class TestDelete:
    def test_removes_stored_file(self, local_storage_dir):
        local_storage.save(b"audio", "uploads/caller-1/file.wav")
        local_storage.delete("uploads/caller-1/file.wav")
        with pytest.raises(FileNotFoundError):
            local_storage.read("uploads/caller-1/file.wav")

    def test_missing_file_is_a_noop(self):
        # Idempotent: deleting a file that was never stored must not raise.
        local_storage.delete("uploads/caller-1/never-existed.wav")

    def test_rejects_path_traversal(self):
        with pytest.raises(ValueError, match="invalid blob_name"):
            local_storage.delete("../../etc/passwd")
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `uv run pytest tests/unit/audio/test_local_storage.py::TestDelete -v`
Expected: FAIL with `AttributeError: module 'transcription_svc.audio.local_storage' has no attribute 'delete'`.

- [ ] **Step 3: Implement `delete`**

Add to `src/transcription_svc/audio/local_storage.py`, after the `read_range` function:

```python
def delete(blob_name: str) -> None:
    """Remove a locally-stored blob. Idempotent: a missing file is a no-op.

    Mirrors the Azure backend's not-found handling so a re-issued delete (or a
    job whose blob was already cleaned up) doesn't error.
    """
    target = _storage_root() / _flat_filename(blob_name)
    target.unlink(missing_ok=True)
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `uv run pytest tests/unit/audio/test_local_storage.py::TestDelete -v`
Expected: PASS (3 passed).

- [ ] **Step 5: Lint + commit**

```bash
uv run ruff format src/transcription_svc/audio/local_storage.py tests/unit/audio/test_local_storage.py
uv run ruff check src/transcription_svc/audio/local_storage.py
git add src/transcription_svc/audio/local_storage.py tests/unit/audio/test_local_storage.py
git commit -m "feat(storage): idempotent local_storage.delete for audio cleanup [DIAAT-272]"
```

---

### Task 2: Backend — delete the audio blob in `delete_job`

Extend the existing delete route to remove the audio blob (both storage backends), tighten `delete_blob` so a genuine error is distinguishable from not-found, and best-effort clean up an in-flight Azure batch job.

**Files:**
- Modify: `src/transcription_svc/audio/azure_utils.py` (`delete_blob` re-raises genuine errors)
- Modify: `src/transcription_svc/api/routes.py` (`delete_job`)
- Test: `tests/unit/api/test_routes.py` (`TestDeleteJob`)

**Interfaces:**
- Consumes: `local_storage.delete(blob_name)` (Task 1); `AsyncAzureBlobManager.delete_blob(blob_name) -> bool`; `delete_batch_job(job_url)` from `transcription_svc.audio.batch_client`.
- Produces: `DELETE /api/v1/jobs/{job_id}` now deletes audio + row; returns `204` on success, `502` (row left intact) on a genuine blob-storage error, `404` for a missing/unauthorised job.

- [ ] **Step 1: Tighten `delete_blob` to re-raise genuine errors**

In `src/transcription_svc/audio/azure_utils.py`, the current `delete_blob` swallows every exception into a `False` return, so a caller can't tell "already gone" from "storage is down". Change the broad handler to re-raise. Replace:

```python
        except ResourceNotFoundError:
            logger.warning(f"Blob not found: {container}/{blob_name}")
            return False
        except Exception as e:
            logger.error(f"Failed to delete blob {container}/{blob_name}: {e}")
            return False
        else:
            return True
```

with:

```python
        except ResourceNotFoundError:
            # Not found is idempotent success for callers: there is nothing
            # left to remove. Distinguished from a genuine storage error
            # (re-raised below) so a delete endpoint can 502 on the latter
            # while treating this as "already deleted".
            logger.warning(f"Blob not found: {container}/{blob_name}")
            return False
        except Exception as e:
            logger.error(f"Failed to delete blob {container}/{blob_name}: {e}")
            raise
        else:
            return True
```

Also update the method docstring's Returns section to note it raises on a genuine storage failure (edit the existing `Returns` block):

```python
        Returns
        -------
        bool
            True if the blob was deleted, False if it did not exist.

        Raises
        ------
        Exception
            On a genuine storage error (anything other than not-found), so
            callers can distinguish "already gone" from "delete failed".
```

- [ ] **Step 2: Write the failing tests**

Append to `TestDeleteJob` in `tests/unit/api/test_routes.py` (the class already imports `uuid`, `MagicMock`, `_make_job` at module scope). Note `_make_job()` sets `audio_blob_path=None` by default, so the existing `test_returns_204` still exercises the no-blob path.

```python
    def test_deletes_local_audio_blob(
        self, client, as_current_user, mocker, tmp_path, monkeypatch
    ):
        from transcription_svc.database.engine import get_session

        monkeypatch.setenv("AUDIO_STORAGE_BACKEND", "local")
        monkeypatch.setenv("LOCAL_AUDIO_STORAGE_DIR", str(tmp_path))
        get_settings.cache_clear()

        job = _make_job()
        job.audio_blob_path = "uploads/caller-1/file.wav"
        mocker.patch("transcription_svc.api.routes.get_job_by_id", return_value=job)
        delete_mock = mocker.patch("transcription_svc.api.routes.local_storage.delete")

        mock_session = MagicMock()
        client.app.dependency_overrides[get_session] = lambda: mock_session
        try:
            response = client.delete(f"/api/v1/jobs/{job.id}")
        finally:
            client.app.dependency_overrides.pop(get_session, None)
            get_settings.cache_clear()

        assert response.status_code == 204
        delete_mock.assert_called_once_with("uploads/caller-1/file.wav")
        mock_session.delete.assert_called_once_with(job)
        mock_session.commit.assert_called_once()

    def test_deletes_azure_audio_blob(self, client, as_current_user, mocker):
        from transcription_svc.database.engine import get_session

        job = _make_job()
        job.audio_blob_path = "uploads/caller-1/file.wav"
        mocker.patch("transcription_svc.api.routes.get_job_by_id", return_value=job)

        manager = mocker.AsyncMock()
        manager.delete_blob = mocker.AsyncMock(return_value=True)
        manager.__aenter__ = mocker.AsyncMock(return_value=manager)
        manager.__aexit__ = mocker.AsyncMock(return_value=False)
        mocker.patch("transcription_svc.api.routes.AsyncAzureBlobManager", return_value=manager)

        mock_session = MagicMock()
        client.app.dependency_overrides[get_session] = lambda: mock_session
        try:
            response = client.delete(f"/api/v1/jobs/{job.id}")
        finally:
            client.app.dependency_overrides.pop(get_session, None)

        assert response.status_code == 204
        manager.delete_blob.assert_awaited_once_with("uploads/caller-1/file.wav")
        mock_session.delete.assert_called_once_with(job)

    def test_missing_azure_blob_still_deletes_row(self, client, as_current_user, mocker):
        from transcription_svc.database.engine import get_session

        job = _make_job()
        job.audio_blob_path = "uploads/caller-1/file.wav"
        mocker.patch("transcription_svc.api.routes.get_job_by_id", return_value=job)

        manager = mocker.AsyncMock()
        manager.delete_blob = mocker.AsyncMock(return_value=False)  # not found
        manager.__aenter__ = mocker.AsyncMock(return_value=manager)
        manager.__aexit__ = mocker.AsyncMock(return_value=False)
        mocker.patch("transcription_svc.api.routes.AsyncAzureBlobManager", return_value=manager)

        mock_session = MagicMock()
        client.app.dependency_overrides[get_session] = lambda: mock_session
        try:
            response = client.delete(f"/api/v1/jobs/{job.id}")
        finally:
            client.app.dependency_overrides.pop(get_session, None)

        assert response.status_code == 204
        mock_session.delete.assert_called_once_with(job)

    def test_genuine_blob_error_returns_502_and_keeps_row(
        self, client, as_current_user, mocker
    ):
        from transcription_svc.database.engine import get_session

        job = _make_job()
        job.audio_blob_path = "uploads/caller-1/file.wav"
        mocker.patch("transcription_svc.api.routes.get_job_by_id", return_value=job)

        manager = mocker.AsyncMock()
        manager.delete_blob = mocker.AsyncMock(side_effect=RuntimeError("storage down"))
        manager.__aenter__ = mocker.AsyncMock(return_value=manager)
        manager.__aexit__ = mocker.AsyncMock(return_value=False)
        mocker.patch("transcription_svc.api.routes.AsyncAzureBlobManager", return_value=manager)

        mock_session = MagicMock()
        client.app.dependency_overrides[get_session] = lambda: mock_session
        try:
            response = client.delete(f"/api/v1/jobs/{job.id}")
        finally:
            client.app.dependency_overrides.pop(get_session, None)

        assert response.status_code == 502
        mock_session.delete.assert_not_called()
        mock_session.commit.assert_not_called()
```

Add this import near the top of `tests/unit/api/test_routes.py` if not already present (it is used by the new local test):

```python
from transcription_svc.config.settings import get_settings
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `uv run pytest tests/unit/api/test_routes.py::TestDeleteJob -v`
Expected: the four new tests FAIL (blob never deleted / no 502 branch); `test_returns_204` still passes.

- [ ] **Step 4: Implement the route change**

In `src/transcription_svc/api/routes.py`, add the batch-client import alongside the existing audio imports (near line 36, after the `submission` import):

```python
from transcription_svc.audio.batch_client import delete_batch_job
```

Replace the body of `delete_job` (currently: load, 404-if-missing, `_check_job_access`, `session.delete`, `commit`, return 204) with:

```python
@router.delete("/jobs/{job_id}", status_code=204)
async def delete_job(
    job_id: UUID,
    session: Session = Depends(get_session),
    current_user: AuthenticatedUser = Depends(get_current_user),
) -> Response:
    """Permanently delete a job: its transcript (the DB row) and audio blob.

    Ownership is enforced by _check_job_access (404 for a non-owner who is
    not a SystemAdministrator). The audio blob is removed before the row so a
    genuine storage failure surfaces as a 502 with the record left intact,
    rather than orphaning audio behind a deleted row. A blob that's already
    gone is treated as success (idempotent). An in-flight Azure batch job is
    cleaned up best-effort so deleting a still-processing job doesn't leave it
    running.
    """
    job = get_job_by_id(session, job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    _check_job_access(job, current_user)

    if job.audio_blob_path:
        try:
            if get_settings().AUDIO_STORAGE_BACKEND == "local":
                local_storage.delete(job.audio_blob_path)
            else:
                async with AsyncAzureBlobManager() as blob_manager:
                    await blob_manager.delete_blob(job.audio_blob_path)
        except Exception as exc:  # noqa: BLE001 — surfaced to the caller as a 502
            logger.error("Failed to delete audio blob %s: %s", job.audio_blob_path, exc)
            raise HTTPException(
                status_code=502, detail="Failed to delete the audio file; job not deleted"
            ) from exc

    # Best-effort: an in-flight batch job would otherwise keep running on
    # Azure after its DB row is gone. Never blocks the delete.
    if job.batch_job_url:
        try:
            await delete_batch_job(job.batch_job_url)
        except Exception as exc:  # noqa: BLE001 — best-effort cleanup
            logger.warning("Could not delete batch job %s: %s", job.batch_job_url, exc)

    session.delete(job)
    session.commit()
    return Response(status_code=204)
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `uv run pytest tests/unit/api/test_routes.py::TestDeleteJob -v`
Expected: PASS (all `TestDeleteJob` tests, including the pre-existing `test_returns_204` and the legacy-user 404 test).

- [ ] **Step 6: Lint + full backend test + commit**

```bash
uv run ruff format src/transcription_svc tests/unit/api/test_routes.py
uv run ruff check src/transcription_svc tests/unit/api/test_routes.py
uv run pytest
git add src/transcription_svc/api/routes.py src/transcription_svc/audio/azure_utils.py tests/unit/api/test_routes.py
git commit -m "feat(jobs): delete audio blob and batch job when deleting a job [DIAAT-272]"
```

---

### Task 3: Frontend — `deleteJob` API client function

Add the server-only backend call, following the existing `getJob(jobId, auth)` pattern.

**Files:**
- Modify: `frontend/lib/api-client.ts`
- Test: `frontend/tests/unit/lib/api-client.test.ts`

**Interfaces:**
- Consumes: `backendFetch(path, init, auth)`; `BackendAuthContext`.
- Produces: `export async function deleteJob(jobId: string, auth: BackendAuthContext | null): Promise<void>` — issues `DELETE /api/v1/jobs/{jobId}`; resolves on `204`; throws `BackendApiError` (carrying the status) on non-2xx.

- [ ] **Step 1: Write the failing tests**

Add to `frontend/tests/unit/lib/api-client.test.ts`. First extend the import at the top to include `deleteJob` and `BackendApiError`:

```ts
import {
  acceptSegment,
  BackendApiError,
  colorForSpeaker,
  deleteJob,
  getJob,
  getJobAudio,
  listJobs,
  submitJob,
  uploadAndSubmit,
  uploadAudio,
} from "@/lib/api-client";
```

Then add a describe block:

```ts
describe("deleteJob", () => {
  it("issues a DELETE to the job endpoint and resolves on 204", async () => {
    const fetchMock = mockFetchOnce(null, { ok: true, status: 204 });

    await expect(deleteJob("job-1", null)).resolves.toBeUndefined();

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toContain("/api/v1/jobs/job-1");
    expect(init.method).toBe("DELETE");
  });

  it("throws BackendApiError with the status on failure", async () => {
    mockFetchOnce({ detail: "nope" }, { ok: false, status: 404 });

    await expect(deleteJob("job-1", null)).rejects.toMatchObject({
      name: "BackendApiError",
      status: 404,
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd frontend && pnpm vitest run tests/unit/lib/api-client.test.ts -t deleteJob`
Expected: FAIL — `deleteJob` is not exported.

- [ ] **Step 3: Implement `deleteJob`**

Add to `frontend/lib/api-client.ts` (e.g. directly after `getJob`). `backendFetch` already throws `BackendApiError` on non-2xx, so success needs no body parsing:

```ts
export async function deleteJob(
  jobId: string,
  auth: BackendAuthContext | null
): Promise<void> {
  // 204 No Content — backendFetch throws BackendApiError on any non-2xx, so a
  // clean return here means the job (transcript + audio) was deleted.
  await backendFetch(`/api/v1/jobs/${jobId}`, { method: "DELETE" }, auth);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd frontend && pnpm vitest run tests/unit/lib/api-client.test.ts -t deleteJob`
Expected: PASS (2 passed).

- [ ] **Step 5: Commit**

```bash
cd frontend && pnpm biome check --write lib/api-client.ts tests/unit/lib/api-client.test.ts
git add frontend/lib/api-client.ts frontend/tests/unit/lib/api-client.test.ts
git commit -m "feat(api-client): deleteJob backend call [DIAAT-272]"
```

---

### Task 4: Frontend — `DELETE` route handler

Add a `DELETE` export to the existing job route handler, mirroring the auth + error mapping of the `GET` handler.

**Files:**
- Modify: `frontend/app/api/jobs/[jobId]/route.ts`
- Test: `frontend/tests/unit/app/api/jobs/[jobId]/route.test.ts` (create)

**Interfaces:**
- Consumes: `deleteJob(jobId, auth)` (Task 3); `BackendApiError` from `@/lib/api-client`; `getBackendAuthContext`.
- Produces: `DELETE /api/jobs/{jobId}` → `204` on success; `404` (JSON `{ error }`) when the backend 404s; `502` (JSON `{ error }`) otherwise.

- [ ] **Step 1: Write the failing tests**

Create `frontend/tests/unit/app/api/jobs/[jobId]/route.test.ts` (mirrors the existing `tests/unit/app/api/jobs/route.test.ts` mocking style):

```ts
import { NextRequest } from "next/server";
import { describe, expect, it, vi } from "vitest";

const { mockDeleteJob, MockBackendApiError } = vi.hoisted(() => {
  class MockBackendApiError extends Error {
    status: number;
    constructor(message: string, status: number) {
      super(message);
      this.name = "BackendApiError";
      this.status = status;
    }
  }
  return { mockDeleteJob: vi.fn(), MockBackendApiError };
});

vi.mock("@/lib/api-client", () => ({
  deleteJob: mockDeleteJob,
  BackendApiError: MockBackendApiError,
}));

function makeRequest() {
  return new NextRequest("http://localhost/api/jobs/job-1", {
    method: "DELETE",
  });
}

const context = { params: Promise.resolve({ jobId: "job-1" }) };

describe("DELETE /api/jobs/[jobId]", () => {
  it("returns 204 on success and forwards jobId + auth", async () => {
    mockDeleteJob.mockResolvedValue(undefined);
    const { DELETE } = await import("@/app/api/jobs/[jobId]/route");

    const response = await DELETE(makeRequest(), context);

    expect(response.status).toBe(204);
    expect(mockDeleteJob).toHaveBeenCalledWith("job-1", {
      accessToken: null,
      clientPrincipal: null,
    });
  });

  it("maps a backend 404 to 404", async () => {
    mockDeleteJob.mockRejectedValue(new MockBackendApiError("nope", 404));
    const { DELETE } = await import("@/app/api/jobs/[jobId]/route");

    const response = await DELETE(makeRequest(), context);

    expect(response.status).toBe(404);
  });

  it("maps any other backend error to 502", async () => {
    mockDeleteJob.mockRejectedValue(new Error("boom"));
    const { DELETE } = await import("@/app/api/jobs/[jobId]/route");

    const response = await DELETE(makeRequest(), context);

    expect(response.status).toBe(502);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd frontend && pnpm vitest run "tests/unit/app/api/jobs/[jobId]/route.test.ts"`
Expected: FAIL — the route module has no `DELETE` export.

- [ ] **Step 3: Implement the `DELETE` handler**

Edit `frontend/app/api/jobs/[jobId]/route.ts`. Update the import line and append the handler:

```ts
import { type NextRequest, NextResponse } from "next/server";
import { BackendApiError, deleteJob, getJob } from "@/lib/api-client";
import { getBackendAuthContext } from "@/lib/auth-utils";
```

```ts
export async function DELETE(request: NextRequest, { params }: RouteContext) {
  const { jobId } = await params;
  const auth = getBackendAuthContext(request);
  try {
    await deleteJob(jobId, auth);
    return new NextResponse(null, { status: 204 });
  } catch (err) {
    if (err instanceof BackendApiError && err.status === 404) {
      return NextResponse.json({ error: "Job not found" }, { status: 404 });
    }
    console.error("Failed to delete job", err);
    return NextResponse.json(
      { error: "Failed to delete transcription job" },
      { status: 502 }
    );
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd frontend && pnpm vitest run "tests/unit/app/api/jobs/[jobId]/route.test.ts"`
Expected: PASS (3 passed).

- [ ] **Step 5: Commit**

```bash
cd frontend && pnpm biome check --write "app/api/jobs/[jobId]/route.ts" "tests/unit/app/api/jobs/[jobId]/route.test.ts"
git add "frontend/app/api/jobs/[jobId]/route.ts" "frontend/tests/unit/app/api/jobs/[jobId]/route.test.ts"
git commit -m "feat(api): DELETE /api/jobs/[jobId] route handler [DIAAT-272]"
```

---

### Task 5: Frontend — confirm dialog primitive + `DeleteJobButton`

Add the shadcn `AlertDialog` primitive (new Radix dep) and a self-contained delete button that opens the confirmation modal, calls the DELETE route, and reports success/error (AC1/AC2/AC5/AC6).

**Files:**
- Modify: `frontend/package.json` (add `@radix-ui/react-alert-dialog`)
- Create: `frontend/components/ui/alert-dialog.tsx`
- Create: `frontend/components/jobs-table/delete-job-button.tsx`
- Test: `frontend/tests/unit/components/delete-job-button.test.tsx` (create)

**Interfaces:**
- Consumes: `apiPath` from `@/lib/base-path`; `toast` from `sonner`; `Button`/`buttonVariants` from `@/components/ui/button`.
- Produces: `DeleteJobButton({ jobId, caseReference, onDeleted }: { jobId: string; caseReference: string; onDeleted: (jobId: string) => void })` — renders a trash icon button; on confirm issues `DELETE apiPath("/api/jobs/{jobId}")`; success → `toast.success` + `onDeleted(jobId)`; failure → `toast.error` (no callback).

- [ ] **Step 1: Add the Radix dependency**

```bash
cd frontend && pnpm add @radix-ui/react-alert-dialog@^1.1.6
```

Expected: `package.json` gains `"@radix-ui/react-alert-dialog"` under dependencies; `pnpm-lock.yaml` updates.

- [ ] **Step 2: Create the `AlertDialog` primitive**

Create `frontend/components/ui/alert-dialog.tsx` (standard shadcn wrapper, using this repo's `cn` and `buttonVariants`):

```tsx
"use client";

import * as AlertDialogPrimitive from "@radix-ui/react-alert-dialog";
import * as React from "react";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const AlertDialog = AlertDialogPrimitive.Root;
const AlertDialogTrigger = AlertDialogPrimitive.Trigger;
const AlertDialogPortal = AlertDialogPrimitive.Portal;

const AlertDialogOverlay = React.forwardRef<
  React.ElementRef<typeof AlertDialogPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof AlertDialogPrimitive.Overlay>
>(({ className, ...props }, ref) => (
  <AlertDialogPrimitive.Overlay
    ref={ref}
    className={cn(
      "fixed inset-0 z-50 bg-black/50 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
      className
    )}
    {...props}
  />
));
AlertDialogOverlay.displayName = "AlertDialogOverlay";

const AlertDialogContent = React.forwardRef<
  React.ElementRef<typeof AlertDialogPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof AlertDialogPrimitive.Content>
>(({ className, ...props }, ref) => (
  <AlertDialogPortal>
    <AlertDialogOverlay />
    <AlertDialogPrimitive.Content
      ref={ref}
      className={cn(
        "fixed left-1/2 top-1/2 z-50 grid w-full max-w-lg -translate-x-1/2 -translate-y-1/2 gap-4 border border-border bg-background p-6 shadow-lg rounded-lg",
        className
      )}
      {...props}
    />
  </AlertDialogPortal>
));
AlertDialogContent.displayName = "AlertDialogContent";

function AlertDialogHeader({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("flex flex-col space-y-2 text-left", className)}
      {...props}
    />
  );
}

function AlertDialogFooter({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "flex flex-col-reverse sm:flex-row sm:justify-end sm:space-x-2",
        className
      )}
      {...props}
    />
  );
}

const AlertDialogTitle = React.forwardRef<
  React.ElementRef<typeof AlertDialogPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof AlertDialogPrimitive.Title>
>(({ className, ...props }, ref) => (
  <AlertDialogPrimitive.Title
    ref={ref}
    className={cn("text-lg font-semibold", className)}
    {...props}
  />
));
AlertDialogTitle.displayName = "AlertDialogTitle";

const AlertDialogDescription = React.forwardRef<
  React.ElementRef<typeof AlertDialogPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof AlertDialogPrimitive.Description>
>(({ className, ...props }, ref) => (
  <AlertDialogPrimitive.Description
    ref={ref}
    className={cn("text-sm text-muted-foreground", className)}
    {...props}
  />
));
AlertDialogDescription.displayName = "AlertDialogDescription";

const AlertDialogAction = React.forwardRef<
  React.ElementRef<typeof AlertDialogPrimitive.Action>,
  React.ComponentPropsWithoutRef<typeof AlertDialogPrimitive.Action>
>(({ className, ...props }, ref) => (
  <AlertDialogPrimitive.Action
    ref={ref}
    className={cn(buttonVariants(), className)}
    {...props}
  />
));
AlertDialogAction.displayName = "AlertDialogAction";

const AlertDialogCancel = React.forwardRef<
  React.ElementRef<typeof AlertDialogPrimitive.Cancel>,
  React.ComponentPropsWithoutRef<typeof AlertDialogPrimitive.Cancel>
>(({ className, ...props }, ref) => (
  <AlertDialogPrimitive.Cancel
    ref={ref}
    className={cn(buttonVariants({ variant: "outline" }), className)}
    {...props}
  />
));
AlertDialogCancel.displayName = "AlertDialogCancel";

export {
  AlertDialog,
  AlertDialogTrigger,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogFooter,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogAction,
  AlertDialogCancel,
};
```

- [ ] **Step 3: Write the failing tests for `DeleteJobButton`**

Create `frontend/tests/unit/components/delete-job-button.test.tsx`:

```tsx
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DeleteJobButton } from "@/components/jobs-table/delete-job-button";

const { toastSuccess, toastError } = vi.hoisted(() => ({
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));
vi.mock("sonner", () => ({
  toast: { success: toastSuccess, error: toastError },
}));
vi.mock("@/lib/base-path", () => ({
  apiPath: (p: string) => `http://localhost${p}`,
}));

describe("DeleteJobButton", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("opens a confirmation dialog before deleting", async () => {
    const user = userEvent.setup();
    render(
      <DeleteJobButton jobId="job-1" caseReference="PA/1" onDeleted={vi.fn()} />
    );

    await user.click(screen.getByRole("button", { name: /delete/i }));

    expect(await screen.findByRole("alertdialog")).toBeDefined();
    expect(screen.getByText(/permanently delete/i)).toBeDefined();
  });

  it("deletes and reports success on confirm", async () => {
    const user = userEvent.setup();
    const onDeleted = vi.fn();
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 204 });
    vi.stubGlobal("fetch", fetchMock);

    render(
      <DeleteJobButton jobId="job-1" caseReference="PA/1" onDeleted={onDeleted} />
    );

    await user.click(screen.getByRole("button", { name: /delete/i }));
    await user.click(screen.getByRole("button", { name: /^delete$/i }));

    await waitFor(() => expect(onDeleted).toHaveBeenCalledWith("job-1"));
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("http://localhost/api/jobs/job-1");
    expect(init.method).toBe("DELETE");
    expect(toastSuccess).toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it("reports an error and keeps the job on failure", async () => {
    const user = userEvent.setup();
    const onDeleted = vi.fn();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, status: 502 })
    );

    render(
      <DeleteJobButton jobId="job-1" caseReference="PA/1" onDeleted={onDeleted} />
    );

    await user.click(screen.getByRole("button", { name: /delete/i }));
    await user.click(screen.getByRole("button", { name: /^delete$/i }));

    await waitFor(() => expect(toastError).toHaveBeenCalled());
    expect(onDeleted).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});
```

- [ ] **Step 4: Run tests to verify they fail**

Run: `cd frontend && pnpm vitest run tests/unit/components/delete-job-button.test.tsx`
Expected: FAIL — `DeleteJobButton` does not exist.

- [ ] **Step 5: Implement `DeleteJobButton`**

Create `frontend/components/jobs-table/delete-job-button.tsx`:

```tsx
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
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `cd frontend && pnpm vitest run tests/unit/components/delete-job-button.test.tsx`
Expected: PASS (3 passed). (`Button` supports `variant="ghost"` and `size="icon"` — confirmed in `components/ui/button.tsx`.)

- [ ] **Step 7: Commit**

```bash
cd frontend && pnpm biome check --write components/ui/alert-dialog.tsx components/jobs-table/delete-job-button.tsx tests/unit/components/delete-job-button.test.tsx
git add frontend/package.json frontend/pnpm-lock.yaml frontend/components/ui/alert-dialog.tsx frontend/components/jobs-table/delete-job-button.tsx frontend/tests/unit/components/delete-job-button.test.tsx
git commit -m "feat(ui): delete-job button with confirmation dialog [DIAAT-272]"
```

---

### Task 6: Frontend — wire delete into the homepage tables

Add an Actions column to `JobsTable`, thread an `onDelete` callback through `FilterableJobsSection` down from `page.tsx`, and remove the deleted job from client state so both the "Transcripts" and "Uploads" sections update (AC4).

**Files:**
- Modify: `frontend/components/jobs-table/jobs-table.tsx`
- Modify: `frontend/components/jobs-table/filterable-jobs-section.tsx`
- Modify: `frontend/app/page.tsx`
- Test: `frontend/tests/unit/components/jobs-table.test.tsx`, `frontend/tests/unit/app/dashboard.test.tsx`

**Interfaces:**
- Consumes: `DeleteJobButton` (Task 5).
- Produces: `JobsTable` and `FilterableJobsSection` both accept an optional `onDelete?: (jobId: string) => void`; `page.tsx` passes a handler that removes the job from `jobs` state.

- [ ] **Step 1: Write the failing tests**

Add to `frontend/tests/unit/components/jobs-table.test.tsx`. Add mocks for `sonner`, `base-path`, and `fetch` at the top of the file (after the existing `next/navigation` mock):

```tsx
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));
vi.mock("@/lib/base-path", () => ({
  apiPath: (p: string) => `http://localhost${p}`,
}));
```

Then add tests:

```tsx
it("renders a delete button for each job", () => {
  render(<JobsTable jobs={MOCK_JOBS} onDelete={vi.fn()} />);
  expect(screen.getAllByRole("button", { name: /delete/i }).length).toBe(
    MOCK_JOBS.length
  );
});

it("calls onDelete after a confirmed deletion", async () => {
  const user = userEvent.setup();
  const onDelete = vi.fn();
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, status: 204 }));

  const oneJob = [MOCK_JOBS[0]];
  render(<JobsTable jobs={oneJob} onDelete={onDelete} />);

  await user.click(screen.getByRole("button", { name: /delete/i }));
  await user.click(screen.getByRole("button", { name: /^delete$/i }));

  await waitFor(() => expect(onDelete).toHaveBeenCalledWith(oneJob[0].id));
  vi.unstubAllGlobals();
});
```

Ensure the test file imports `waitFor`: `import { render, screen, waitFor } from "@testing-library/react";`.

Add to `frontend/tests/unit/app/dashboard.test.tsx` a test that a deleted job disappears from the list. The dashboard already mocks `sonner`, `next/navigation`, `base-path`. Add:

```tsx
it("removes a job from the list after it is deleted", async () => {
  const job = {
    id: "job-1",
    caseReference: "PA/00001/2026",
    tribunal: "First-tier Tribunal — Immigration and Asylum Chamber",
    audioFileName: "hearing.wav",
    uploadedAt: "2026-07-01T09:00:00Z",
    status: "COMPLETED",
    progressPercent: 100,
  };
  const fetchMock = vi.fn((url: string, init?: RequestInit) => {
    if (init?.method === "DELETE") {
      return Promise.resolve({ ok: true, status: 204 });
    }
    return Promise.resolve({ ok: true, json: () => Promise.resolve({ jobs: [job] }) });
  });
  vi.stubGlobal("fetch", fetchMock);
  const user = userEvent.setup();

  render(<DashboardPage />);
  // Case reference appears in both the Transcripts and Uploads sections.
  await waitFor(() => expect(screen.getAllByText("PA/00001/2026").length).toBeGreaterThan(0));

  await user.click(screen.getAllByRole("button", { name: /delete/i })[0]);
  await user.click(screen.getByRole("button", { name: /^delete$/i }));

  await waitFor(() =>
    expect(screen.queryByText("PA/00001/2026")).toBeNull()
  );
});
```

Add the imports `waitFor` and `userEvent` to `dashboard.test.tsx` if not already present:
`import { render, screen, waitFor } from "@testing-library/react";`
`import userEvent from "@testing-library/user-event";`

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd frontend && pnpm vitest run tests/unit/components/jobs-table.test.tsx tests/unit/app/dashboard.test.tsx`
Expected: FAIL — `JobsTable` has no `onDelete` prop / no delete button rendered.

- [ ] **Step 3: Add the Actions column to `JobsTable`**

In `frontend/components/jobs-table/jobs-table.tsx`:

Add the import:

```tsx
import { DeleteJobButton } from "@/components/jobs-table/delete-job-button";
```

Extend `JobsTableProps`:

```tsx
interface JobsTableProps {
  jobs: TranscriptionJob[];
  sortKey?: JobsSortKey;
  sortDirection?: SortDirection;
  onSortChange?: (key: JobsSortKey) => void;
  onDelete?: (jobId: string) => void;
}
```

Add `onDelete` to the destructured params of `JobsTable({ ... })`.

Add a header cell after the `Transcript` `<th>` (line ~119):

```tsx
            <th className="px-4 py-3 text-left font-semibold">
              <span className="sr-only">Actions</span>
            </th>
```

Add a trailing `<td>` after the Transcript-link `<td>` inside the row `map` (after the closing `</td>` at ~line 171):

```tsx
              <td className="px-4 py-3">
                {onDelete && (
                  <DeleteJobButton
                    jobId={job.id}
                    caseReference={job.caseReference}
                    onDeleted={onDelete}
                  />
                )}
              </td>
```

- [ ] **Step 4: Thread `onDelete` through `FilterableJobsSection`**

In `frontend/components/jobs-table/filterable-jobs-section.tsx`:

Extend the props interface:

```tsx
interface FilterableJobsSectionProps {
  title: string;
  jobs: TranscriptionJob[];
  onDelete?: (jobId: string) => void;
}
```

Destructure `onDelete` in the component signature, and pass it to `<JobsTable>` at the bottom:

```tsx
      <JobsTable
        jobs={sorted}
        sortKey={sortKey}
        sortDirection={sortDirection}
        onSortChange={handleSortChange}
        onDelete={onDelete}
      />
```

- [ ] **Step 5: Provide the handler in `page.tsx`**

In `frontend/app/page.tsx`, add a delete handler that removes the job from state, and pass it to both sections. After the `handleUpload` callback, add:

```tsx
  const handleDelete = useCallback((jobId: string) => {
    setJobs((prev) => prev.filter((job) => job.id !== jobId));
  }, []);
```

Update both `FilterableJobsSection` usages:

```tsx
          <FilterableJobsSection
            title="Transcripts"
            jobs={completedJobs}
            onDelete={handleDelete}
          />
```

```tsx
        <FilterableJobsSection title="Uploads" jobs={jobs} onDelete={handleDelete} />
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `cd frontend && pnpm vitest run tests/unit/components/jobs-table.test.tsx tests/unit/app/dashboard.test.tsx`
Expected: PASS. Then run the full unit suite:
Run: `cd frontend && pnpm test:unit`
Expected: PASS (no regressions).

- [ ] **Step 7: Lint + commit**

```bash
cd frontend && pnpm biome check --write components/jobs-table/jobs-table.tsx components/jobs-table/filterable-jobs-section.tsx app/page.tsx tests/unit/components/jobs-table.test.tsx tests/unit/app/dashboard.test.tsx
git add frontend/components/jobs-table/jobs-table.tsx frontend/components/jobs-table/filterable-jobs-section.tsx frontend/app/page.tsx frontend/tests/unit/components/jobs-table.test.tsx frontend/tests/unit/app/dashboard.test.tsx
git commit -m "feat(dashboard): delete records from the homepage tables [DIAAT-272]"
```

---

### Task 7: Local build, manual verification, and dev sign-off

Satisfy the repo's Definition of Done: full local build/tests green, manual local exercise, then dev deploy + verification and a Jira note. No production credentials are entered by the agent — the dev deploy runs through the existing pipeline.

**Files:** none (verification only).

- [ ] **Step 1: Full local test + lint, both stacks**

```bash
# backend (repo root)
uv run ruff check . && uv run ruff format --check . && uv run pytest
# frontend
cd frontend && pnpm check && pnpm test:unit && pnpm build
```

Expected: all green; `pnpm build` compiles with no type errors.

- [ ] **Step 2: Manual local exercise**

Start the app (`cd frontend && pnpm dev`) with the backend running (docker-compose or the API). On the homepage: confirm each row has a trash button; click it → the confirmation modal appears (AC1); Cancel leaves the row (AC2); confirm Delete → the row disappears from both "Transcripts" and "Uploads" (AC3/AC4) and a success toast shows (AC5). Simulate a failure (e.g. stop the backend) and confirm an error toast shows and the row remains (AC6).

- [ ] **Step 3: Open the PR and drive CI green**

```bash
git push -u origin feat/DIAAT-272-delete-jobs
gh pr create --title "feat(dashboard): delete transcription records from the homepage [DIAAT-272]" --body "$(cat <<'EOF'
Implements DIAAT-272 — users can permanently delete a transcription record (audio + transcript) from the homepage.

- Backend: DELETE /api/v1/jobs/{id} now removes the audio blob (local + Azure) and best-effort cleans up an in-flight batch job; genuine storage errors 502 with the record kept.
- Frontend: trash button per row → confirmation modal → success/error toast → optimistic removal from both homepage sections.
- AC7 authorisation is already enforced by _check_job_access.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

Address CI failures and Copilot review comments until green.

- [ ] **Step 4: Merge, deploy to dev, verify there**

After merge to `main`, deploy to dev via the existing pipeline (push a `deploy-dev-*` tag), then verify the delete flow on dev end-to-end against a real record (upload → COMPLETED → delete → gone), and confirm `GET /health` on the API and the frontend `/batch` route respond.

- [ ] **Step 5: Jira note + worktree cleanup**

Add a comment to DIAAT-272 detailing the manual testing performed (local + dev). Then remove the worktree:

```bash
git worktree remove /Users/hmcts/code/.worktrees/DIAAT-272-delete-jobs
```

---

## Self-Review

**Spec coverage:**
- AC1 (delete action + confirmation prompt) — Task 5 (`DeleteJobButton` + `AlertDialog`), Task 6 (rendered per row).
- AC2 (explicit confirm) — Task 5 (modal Cancel/Delete; Delete preventDefault + explicit handler).
- AC3 (audio + transcript permanently removed) — Task 2 (blob delete + row delete).
- AC4 (homepage updated) — Task 6 (`handleDelete` removes from shared `jobs` state → both sections).
- AC5 (success message) — Task 5 (`toast.success`).
- AC6 (failed deletion → error + item remains) — Task 2 (502, row kept) + Task 5 (dialog stays open, `toast.error`, no `onDeleted`).
- AC7 (authorisation) — existing `_check_job_access`; noted in Global Constraints and Task 2 docstring.

**Placeholder scan:** No TBD/TODO; all code steps show full code; the one advisory note (Button `size="icon"`) includes an explicit verify-and-fallback instruction.

**Type consistency:** `deleteJob(jobId, auth)` (Task 3) is consumed by the `DELETE` handler (Task 4). `DeleteJobButton` prop is `onDeleted` (Task 5); `JobsTable`/`FilterableJobsSection` prop is `onDelete` (Task 6), which is passed to `DeleteJobButton`'s `onDeleted` — names are intentionally distinct and wired consistently (`onDelete={onDelete}` → `<DeleteJobButton onDeleted={onDelete} />`). Backend: `local_storage.delete` (Task 1) consumed by the route (Task 2).
