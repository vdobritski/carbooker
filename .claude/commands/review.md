---
description: Review the current implementation with the reviewer agent (read-only)
argument-hint: [task file path, or leave empty to review the latest change]
---

Review the following Carbooker work: **$ARGUMENTS**

If no argument was given, review the most recent change.

You are the coordinator.

1. Work out exactly what is under review: which task file, which files were touched. Use
   the git diff if the project is a git repository; otherwise use the files the last
   `/implement` run reported.
2. Launch the `reviewer` subagent with that scope, the task file, and a reminder that it
   is read-only and should focus on requirement coverage and booking state consistency.
3. Report the findings to the user, most severe first, each with its concrete failure
   scenario. Include what the reviewer could not verify.
4. Ask the user which findings to fix. When they choose, fix them yourself if they are
   small, or run the `implementer` for anything larger. Never let the reviewer fix its
   own findings.

If the reviewer returns nothing, say plainly that the change passed review and what was
checked — do not manufacture findings to look thorough.
