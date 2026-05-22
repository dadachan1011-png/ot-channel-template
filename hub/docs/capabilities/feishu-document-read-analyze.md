# Feishu Document Read Analyze

## Capability

Read a Feishu wiki/doc link, extract document text, then ask the LLM to review the document logic.

## Trigger

- Message contains a `https://*.feishu.cn/wiki/...` link.
- Message also asks to open, inspect, analyze, judge logic, or find problems.

## Tool Order

1. `FEISHU_READ_COMMAND`
   - Preferred because it can reuse a local Feishu/Lark CLI or local login context.
   - Supports `{url}` and `{wikiToken}` placeholders.
   - The command should print either plain text or JSON with one of: `content`, `text`, `markdown`, `raw_content`, `items`, `blocks`, `children`.
2. Feishu Open Platform API
   - Uses `FEISHU_APP_ID` and `FEISHU_APP_SECRET`.
   - Resolves wiki node and reads doc/docx raw content or blocks.
3. Clear failure
   - If neither tool can read正文, reply with the missing capability instead of creating a Codex CLI task.

## Success Signal

- Non-empty document text is extracted.
- LLM receives the extracted text and returns a short logic review.

## Output Style

- First line: verdict.
- Then 3-5 key logic issues or risks.
- End with 1-3 concrete suggestions.

## Safety

- Read-only.
- Does not save document content.
- Does not modify local files or Feishu documents.
