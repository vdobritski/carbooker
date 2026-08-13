---
description: Implement an approved task with the implementer agent
argument-hint: [task file path or task number]
---

Implement the following approved task for Carbooker: **$ARGUMENTS**

You are the coordinator.

1. Resolve the argument to a task file in `docs/tasks/` and read it. If no such task
   exists, or the work has not been planned and approved, stop and ask the user — do not
   improvise scope.
2. Check the task's dependencies are done. If a dependency is missing, say which one and
   stop.
3. Launch the `implementer` subagent with the task file path and a one-line statement of
   what "done" means for it. One task per run — do not batch several tasks into one agent.
4. When it returns, report to the user:
   - what changed (files, and any new migration)
   - what the implementer actually ran and observed — build result, what it exercised in
     the app, whether the booking consistency checks were run
   - anything it could not verify
   - anything it flagged as an unrelated problem it deliberately left alone
5. Suggest running `/review` on the change. Do not run it automatically.

If the implementer reports the task cannot be done within the current design, do not let
it redesign — bring that back to the user and offer to re-plan with `/plan`.
