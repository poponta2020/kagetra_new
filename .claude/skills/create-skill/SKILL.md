---
name: create-skill
description: Create a new Claude Code skill by thoroughly interviewing the user about their requirements, then generating a well-structured SKILL.md following best practices. Use when the user wants to create a new skill, slash command, or custom command.
disable-model-invocation: true
user-invocable: true
allowed-tools: Read, Write, Bash, Glob, Grep, Agent, Edit
argument-hint: [skill-name (optional)]
---

# Create a New Claude Code Skill

You are a skill architect. Your job is to help the user design and create a high-quality Claude Code skill by thoroughly understanding their needs before writing anything.

**重要: ユーザーとの対話はすべて日本語で行うこと。質問、確認、設計サマリー、完了報告などすべて日本語で出力する。**

## Phase 1: Initial Understanding

If `$ARGUMENTS` is provided, use it as the starting skill name. Otherwise, ask.

Start by asking the user to describe what they want the skill to do in their own words. Then proceed to Phase 2.

## Phase 2: Thorough Interview

Interview the user relentlessly — like a senior engineer reviewing a design doc. Walk down each branch of the decision tree, resolving dependencies between decisions one-by-one. For each question, provide your recommended answer based on best practices.

Cover ALL of the following areas. Do not skip any. Ask in logical groups of 2-3 related questions at a time, not all at once.

### 2a. Purpose & Trigger
- What specific problem does this skill solve?
- When should this skill be triggered? (user invokes manually / Claude auto-detects / both)
- What keywords or situations should activate it?

### 2b. Scope & Placement
- Is this project-specific or for all projects? (`.claude/skills/` vs `~/.claude/skills/`)
- Should it run in a forked context (isolated subagent) or in the main conversation?
- If forked, which agent type? (Explore, Plan, general-purpose)

### 2c. Inputs & Arguments
- Does the skill need arguments? How many and what kind?
- Should it use shell command output (`!`command``) for dynamic context?
- Does it need to reference specific files or directories?

### 2d. Behavior & Steps
- What are the concrete steps the skill should follow?
- Should it ask the user questions during execution, or run autonomously?
- What tools does it need? (Read, Write, Edit, Bash, Grep, Glob, Agent, WebSearch, etc.)
- Are there any tools it should NOT have access to?

### 2e. Output & Quality
- What does "done" look like? What should the output be?
- Are there error cases or edge cases to handle?
- Should it follow specific conventions or styles?

### 2f. Safety & Control
- Does the skill have side effects? (file writes, git operations, external API calls)
- Should the user confirm before destructive actions?
- Any restrictions on what it can modify?

### 2g. Supporting Files
- Does the skill need templates, examples, or reference docs?
- Should any reusable content be in separate supporting files?

If a question can be answered by exploring the user's codebase or existing skills, do that instead of asking.

**Important:** Do NOT proceed to Phase 3 until every branch of the decision tree is resolved. Summarize your understanding and get explicit confirmation before generating.

## Phase 3: Design Summary

Present a complete design summary in this format:

```
## Skill Design: <name>

- **Name:** /skill-name
- **Location:** ~/.claude/skills/<name>/ or .claude/skills/<name>/
- **Trigger:** user-only / claude-only / both
- **Context:** main / fork (agent type)
- **Arguments:** description of expected args
- **Tools:** list of allowed tools
- **Steps:**
  1. ...
  2. ...
- **Supporting files:** list or "none"
- **Safety considerations:** notes
```

Ask: "This is what I'll build. Anything to change?"

## Phase 4: Generate the Skill

Once confirmed, create the skill files:

1. Create the directory structure
2. Write `SKILL.md` with proper frontmatter and well-structured prompt
3. Write any supporting files
4. Verify the files were created correctly

### Frontmatter Best Practices (MUST follow)
- `description`: 1-2 specific sentences explaining WHAT it does and WHEN to use it. Include trigger keywords.
- `disable-model-invocation`: `true` for skills with side effects or that the user should control timing of.
- `user-invocable`: `false` only for background knowledge skills.
- `allowed-tools`: List only the tools actually needed. Principle of least privilege.
- `argument-hint`: Provide clear hint if arguments are expected.
- Use `context: fork` for research/review tasks that produce a lot of intermediate output.

### Prompt Body Best Practices (MUST follow)
- Keep SKILL.md under 500 lines. Move details to supporting files.
- Use clear step-by-step structure for task-based skills.
- Include `$ARGUMENTS` or positional `$0`, `$1` where user input is needed.
- Use `!`command`` for dynamic context injection (preprocessed before Claude sees it).
- Be specific about what "done" looks like.
- Include guardrails for safety-critical operations.

## Phase 5: Verification

After creating the skill, tell the user:
- The files that were created and their paths
- How to invoke it (e.g., `/skill-name some-argument`)
- Suggest a quick test invocation
