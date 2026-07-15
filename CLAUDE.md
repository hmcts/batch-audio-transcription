# Agent workflow

- Implement work in subagents; keep the main agent for coordination only.
- Work in git worktrees, so subagents don't step on each other's changes.

# Definition of done

A change to this project is not done when tests pass locally. It's done when:

1. The code is implemented and fully tested, both in an automated way and manually.
2. The code builds and all tests pass locally.
3. The app is started locally and tested with Playwright.
4. A PR is created and driven to green — all CI checks are green (tests, lint/format, CodeQL, Alembic migration check, etc.), and all GitHub Copilot review comments have been addressed or explicitly rejected with a reason.
5. Once the PR is merged to `main`, the change is deployed to dev via the existing pipeline (push a `deploy-dev-*` tag from the app repo), tested using Playwright, and the affected App Service(s) are confirmed running (`GET /health` on the API, the frontend's `/batch` route).
6. If there are failures on the dev build or deploy, iterate until green.
7. Details of all manual testing performed are added as a comment on the relevant Jira ticket(s).
8. Worktrees used for the work are deleted.

For anything touching the upload -> Speech Batch -> transcript pipeline specifically: verify end-to-end on dev with a real audio file — upload it through the deployed frontend, confirm the job reaches `COMPLETED`, and confirm the transcript renders in the app. A mocked/local-only test of this flow is not sufficient on its own.

Companion infra changes (in `batch-audio-transcription-infra`) follow the same bar: PR green, merged, and the corresponding `terraform apply` confirmed to have actually run (not just planned).
