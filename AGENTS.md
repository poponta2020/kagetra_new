# Codex repository instructions

- Read `CLAUDE.md` completely before planning or editing; it is the repository's canonical engineering instruction file.
- Read `.claude/project-profile.md` for commands, risk paths, documentation ownership, Definition of Done, and review policy.
- The shared devflow is installed by `.codex/cloud-setup.sh`; its canonical workflows live in `poponta2020/claude-devflow`, not in this repository.
- Use the shared devflow skills when the request maps to define-feature, implement, quickfix, review/fix, DoD, ship, or the other documented workflows.
- Treat CI pending as mergeable under the accepted project policy. A confirmed failing check still blocks shipping.
- Preserve unrelated user changes and untracked files. Do not introduce a second copy of shared skills into this repository.
- After implementation, update the canonical documentation selected by `.claude/project-profile.md` and run the documented verification commands.
