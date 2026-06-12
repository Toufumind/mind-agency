# Agent Knowledge Base

Place your knowledge files here. Supported formats:
- `.md` (Markdown)
- `.txt` (Plain text)

Files will be automatically indexed for RAG (Retrieval-Augmented Generation).

## Usage

1. Add knowledge files to this directory
2. Call `POST /api/rag` with `{ "action": "index_knowledge", "agent": "me" }`
3. The RAG system will automatically search relevant context when generating responses

## Example

```
Agents/me/knowledge/
  ├── project-guide.md
  ├── api-reference.md
  └── troubleshooting.txt
```
