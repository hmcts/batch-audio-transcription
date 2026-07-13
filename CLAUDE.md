# Definition of done

A change to this project is not done when tests pass locally. It's done when:

1. All CI checks are green on the PR (tests, lint/format, CodeQL, Alembic migration check, etc.), and any automated review comments (e.g. GitHub Copilot) have been addressed or explicitly rejected with a reason.
2. The PR is merged to `main`.
3. The change is deployed to dev via the existing pipeline (push a `deploy-dev-*` tag from the app repo) and the affected App Service(s) are confirmed running (`GET /health` on the API, the frontend's `/batch` route).
4. For anything touching the upload -> Speech Batch -> transcript pipeline specifically: verify end-to-end on dev with a real audio file — upload it through the deployed frontend, confirm the job reaches `COMPLETED`, and confirm the transcript renders in the app. A mocked/local-only test of this flow is not sufficient on its own.

Companion infra changes (in `batch-audio-transcription-infra`) follow the same bar: PR green, merged, and the corresponding `terraform apply` confirmed to have actually run (not just planned).
