# Local Codex / Claude collaboration

`team.py` uses an installed Claude Code subscription session. It does not store credentials in this repository. Python standard library only.

```powershell
python tools/ai-team/team.py doctor
python tools/ai-team/team.py start --workspace . --prompt-file task.txt
python tools/ai-team/team.py ask --task TASK_ID --phase plan --prompt-file plan.txt
python tools/ai-team/team.py ask --task TASK_ID --phase implement --prompt-file implement.txt --write-path src/exact-file.ts
python tools/ai-team/team.py ask --task TASK_ID --phase review --prompt-file review.txt
```

Use exact file scopes for implementation. Planning and review are read-only. Optional validation commands must be exact local Node test/check commands; arbitrary shell commands are denied. Keep prompts free of credentials. Records live outside the checkout under the operating system's local application-data directory, partitioned by project.

Codex integrates changes, runs the project gates, and judges findings. A successful Claude process is not an approval. Completion requires an accepted final review and a passing test-evidence note after implementation. Maximum three review calls per task; calls have a bounded timeout and preserve partial work for inspection.

Use `--help` on `note`, `finish`, or any subcommand for the recorded integration/test workflow. A workspace must be inside this repository. An independent worktree can be placed beneath the repository when isolation is needed. Never grant the collaborator access to environment or authentication files.
