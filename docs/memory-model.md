# Memory Model

Use layered memory so reusable framework code stays separate from deploy-specific knowledge.

## Layers

- `memory/prompts/global.md`: global assistant style and operating principles.
- `memory/profiles/user.md`: owner preferences and private personalization.
- `memory/profiles/groups/<group-id>.md`: long-term group memory.
- `memory/profiles/direct/<user-id>.md`: direct-chat user memory.
- `memory/sessions/groups/<group-id>.jsonl`: recent group messages for short context.
- `memory/sessions/group-summaries/<group-id>/`: periodic summaries.
- `memory/pending/memory-candidates.jsonl`: candidate memories awaiting review.
- `memory/kb/`: business knowledge, BI indexes, playbooks, tool notes.

## Recommended Write Policy

- Group short context: append recent group messages; keep a bounded window.
- Group long-term memory: write automatically only after filtering for stable facts, or write after owner approval.
- User profile: require owner approval.
- Knowledge base: commit curated business facts, BI indexes, and playbooks.
- Pending candidates: review daily and prune rejected items.

## Privacy Rule

Treat `memory/` as runtime private data. Publish only `memory-template/`.
