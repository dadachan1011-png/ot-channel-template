# BI Skill And Knowledge Index

The BI layer is split into fast lookup and planned analysis.

## Fast Lookup

Use `fast_lookup` for questions like:

- Which report contains this field?
- Where can I find this metric?
- Which report/path/sheet should I open first?

The fast BI tool should return:

- report name
- report path
- sheet/page
- matched field
- nearby/reference fields
- confidence and source evidence

It should not over-answer with filters, export steps, or full analysis unless the user asked for them.

## Planned Analysis

Use `planned_task` for:

- metric values
- trend analysis
- why a report is wrong
- field lineage uncertainty
- spreadsheet or exported file analysis
- anything where Codex needs to inspect actual files

## Data Contract

Do not publish real BI snapshots. Teams should provide their own sanitized index files under `memory/kb/bi/`, for example:

```text
memory/kb/bi/
  report_knowledge.json
  field_aliases.json
  report_usage_notes.md
```

The recommended index keys are:

- `report_name`
- `report_path`
- `page_or_sheet`
- `fields`
- `field_aliases`
- `filters`
- `business_notes`
- `last_verified_at`

## Skill Boundary

The skill should teach the agent how to locate the right report and how to format concise answers. It should not pretend to know values, SQL lineage, or live report state unless those data sources are actually connected.
